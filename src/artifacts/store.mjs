import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {ArtifactCommitSchema,ArtifactError,ArtifactImportSchema,ArtifactRecordSchema,ArtifactRestoreSchema,ArtifactSaveStateSchema,ArtifactScopeSchema,ArtifactStateSchema,canonicalArtifactJson,parseArtifactInput} from './protocol.mjs';

const MAX_MANIFEST_BYTES=16*1024*1024;
const locks=new Map();
export const hashArtifactValue=(value,limits)=>createHash('sha256').update(canonicalArtifactJson(value,limits)).digest('hex');
const clone=value=>structuredClone(value);
const conflict=()=>new ArtifactError('artifact_conflict','The artifact head or state changed. Reload the current artifact.',409);
const missing=()=>new ArtifactError('artifact_not_found','Artifact or revision was not found.',404);
function publicRecord(manifest){if(!manifest)return null;const {revisionStates,...record}=manifest;return clone(record);}
function replay(manifest,requestId,requestHash){
  const receipt=Object.hasOwn(manifest?.requests??{},requestId)?manifest.requests[requestId]:null;
  if(!receipt)return null;
  if(receipt.requestHash!==requestHash)throw new ArtifactError('request_conflict','This request ID was already used with different input.',409);
  return {...publicRecord(manifest),...clone(receipt.result)};
}
function checkExpected(manifest,{expectedHead,expectedStateRevision}){if((manifest?.head??null)!==expectedHead||(manifest?.stateRevision??0)!==expectedStateRevision)throw conflict();}

export class ArtifactStore{
  constructor(directory){if(typeof directory!=='string'||!directory.trim())throw new ArtifactError('invalid_artifact','Artifact directory is required.');this.directory=resolve(directory);}
  path(scope){const safe=parseArtifactInput(ArtifactScopeSchema,scope);return join(this.directory,hashArtifactValue(safe)+'.json');}
  async load(path){
    let contents;try{const info=await stat(path);if(info.size>MAX_MANIFEST_BYTES)throw new Error('Manifest exceeds storage limit.');contents=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    try{
      const manifest=JSON.parse(contents),{revisionStates,...record}=manifest;
      const parsed=parseArtifactInput(ArtifactRecordSchema,record);
      if(!parsed.revisions.some(revision=>revision.id===parsed.head))throw new Error('Head revision is absent.');
      const states={};for(const revision of parsed.revisions){if(Object.hasOwn(revisionStates??{},revision.id))states[revision.id]=parseArtifactInput(ArtifactStateSchema,revisionStates[revision.id]);}
      return {...parsed,revisionStates:states};
    }catch(error){throw new ArtifactError('artifact_corrupt','Artifact manifest is invalid: '+error.message,500);}
  }
  async read(scope){return publicRecord(await this.load(this.path(scope)));}
  async history(scope){return (await this.read(scope))?.revisions??[];}
  async transaction(scope,change,{signal}={}){
    const path=this.path(scope),previous=locks.get(path)??Promise.resolve();let release;
    const current=new Promise(resolveLock=>{release=resolveLock;});locks.set(path,current);
    await previous;
    let lock;
    try{
      signal?.throwIfAborted();
      await mkdir(this.directory,{recursive:true});
      // Also serialize separate Node processes. Dead-process locks are recovered;
      // a live owner is never forcibly unlocked merely for taking too long.
      const lockPath=path+'.lock',deadline=Date.now()+5000;
      for(;;){
        signal?.throwIfAborted();
        try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));break;}catch(error){
          if(error.code!=='EEXIST')throw error;
          try{
            let owner;try{owner=JSON.parse(await readFile(lockPath,'utf8'));}catch(parse){if(!(parse instanceof SyntaxError))throw parse;}
            if(Number.isSafeInteger(owner?.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(probe){if(probe.code==='ESRCH'){await unlink(lockPath);continue;}}}
            // A process may exit between exclusive creation and writing its PID.
            // Allow ample time for a live writer before recovering that gap.
            else if(Date.now()-(await stat(lockPath)).mtimeMs>30000){await unlink(lockPath);continue;}
          }catch(inspect){if(inspect.code==='ENOENT')continue;}
          if(Date.now()>=deadline)throw new ArtifactError('artifact_busy','Artifact is busy. Retry the request.',503);
          await new Promise(resolveWait=>setTimeout(resolveWait,10));
        }
      }
      signal?.throwIfAborted();
      const manifest=await this.load(path),outcome=await change(manifest);
      if(outcome.write){
        const contents=JSON.stringify(outcome.write);
        if(Buffer.byteLength(contents)>MAX_MANIFEST_BYTES)throw new ArtifactError('artifact_storage_limit','Artifact history has reached its storage limit.',413);
        const temporary=path+'.'+randomUUID()+'.tmp';let handle;
        try{handle=await open(temporary,'wx',0o600);await handle.writeFile(contents);await handle.sync();await handle.close();handle=null;signal?.throwIfAborted();await rename(temporary,path);}finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      }
      return clone(outcome.result);
    }finally{
      try{if(lock){await lock.close();await unlink(path+'.lock').catch(error=>{if(error.code!=='ENOENT')throw error;});}}
      finally{release();if(locks.get(path)===current)locks.delete(path);}
    }
  }
  async commit(scope,input,{signal}={}){
    const args=parseArtifactInput(ArtifactCommitSchema,input);
    return this.transaction(scope,manifest=>{
      const duplicate=replay(manifest,args.requestId,args.requestHash);if(duplicate)return {result:duplicate};
      checkExpected(manifest,args);
      if((manifest?.revisions.length??0)>=512)throw new ArtifactError('artifact_storage_limit','Artifact revision limit reached.',413);
      const revision={id:'rev_'+randomUUID(),parentId:manifest?.head??null,definition:args.definition,contentHash:hashArtifactValue(args.definition),createdAt:new Date().toISOString(),reason:args.reason??'edit'};
      if(args.sourceScope!==undefined)revision.sourceScope=args.sourceScope;
      const state=Object.hasOwn(args,'state')?args.state:(manifest?.state??{});
      const next={artifactId:manifest?.artifactId??'art_'+randomUUID(),head:revision.id,stateRevision:(manifest?.stateRevision??0)+1,state,revisions:[...(manifest?.revisions??[]),revision],requests:{...(manifest?.requests??{})},revisionStates:{...(manifest?.revisionStates??{}),[revision.id]:state}};
      if(manifest)next.revisionStates[manifest.head]=manifest.state;
      next.requests[args.requestId]={requestHash:args.requestHash,result:{artifactId:next.artifactId,head:next.head,stateRevision:next.stateRevision,state:clone(state)},createdAt:revision.createdAt};
      return {write:next,result:publicRecord(next)};
    },{signal});
  }
  async saveState(scope,input){
    const args=parseArtifactInput(ArtifactSaveStateSchema,input);
    return this.transaction(scope,manifest=>{
      if(!manifest)throw missing();
      if(manifest.artifactId!==args.artifactId||manifest.head!==args.revisionId||manifest.stateRevision!==args.expectedStateRevision)throw conflict();
      const next={...manifest,state:args.state,stateRevision:manifest.stateRevision+1,revisionStates:{...manifest.revisionStates,[manifest.head]:args.state}};
      return {write:next,result:publicRecord(next)};
    });
  }
  async importArchive(scope,input){
    const args=parseArtifactInput(ArtifactImportSchema,input);
    if(Buffer.byteLength(JSON.stringify(args.record))>10*1024*1024)throw new ArtifactError('invalid_artifact_archive','Artifact archive exceeds 10 MiB.');
    return this.transaction(scope,manifest=>{
      const duplicate=replay(manifest,args.requestId,args.requestHash);if(duplicate)return {result:duplicate};
      checkExpected(manifest,args);
      if((manifest?.revisions.length??0)+args.record.revisions.length>512)throw new ArtifactError('artifact_storage_limit','Artifact revision limit reached.',413);
      const existing=new Set((manifest?.revisions??[]).map(revision=>revision.id)),ancestry=new Set();
      for(const revision of args.record.revisions){
        if(existing.has(revision.id)||ancestry.has(revision.id)||revision.parentId!==null&&!ancestry.has(revision.parentId))throw new ArtifactError('invalid_artifact_archive','Imported revision identities or ancestry are invalid.');
        ancestry.add(revision.id);
      }
      if(!ancestry.has(args.record.head))throw new ArtifactError('invalid_artifact_archive','Imported artifact head is missing.');
      const revisionStates={...(manifest?.revisionStates??{})};
      if(manifest)revisionStates[manifest.head]=manifest.state;
      let firstRoot=true;
      const imported=args.record.revisions.map(revision=>{
        const result={...revision,contentHash:hashArtifactValue(revision.definition)};
        if(revision.parentId===null&&firstRoot){result.parentId=manifest?.head??null;firstRoot=false;}
        let state={};
        function initial(definition){if(!definition||typeof definition!=='object')return false;if(Object.hasOwn(definition,'initialState')){state=parseArtifactInput(ArtifactStateSchema,definition.initialState);return true;}for(const child of definition.view??definition.children??[])if(initial(child))return true;return false;}
        initial(revision.definition);revisionStates[revision.id]=state;return result;
      });
      revisionStates[args.record.head]=args.record.state;
      const next={artifactId:manifest?.artifactId??args.record.artifactId,head:args.record.head,stateRevision:(manifest?.stateRevision??0)+1,state:args.record.state,revisions:[...(manifest?.revisions??[]),...imported],requests:{...(manifest?.requests??{})},revisionStates};
      next.requests[args.requestId]={requestHash:args.requestHash,result:{artifactId:next.artifactId,head:next.head,stateRevision:next.stateRevision,state:clone(next.state)},createdAt:new Date().toISOString()};
      return {write:next,result:publicRecord(next)};
    });
  }
  async restore(scope,input){
    const args=parseArtifactInput(ArtifactRestoreSchema,input),requestHash=hashArtifactValue({operation:'restore',revisionId:args.revisionId,expectedHead:args.expectedHead,expectedStateRevision:args.expectedStateRevision});
    return this.transaction(scope,manifest=>{
      if(!manifest)throw missing();const duplicate=replay(manifest,args.requestId,requestHash);if(duplicate)return {result:duplicate};
      checkExpected(manifest,args);
      if(!manifest.revisions.some(revision=>revision.id===args.revisionId))throw missing();
      const next={...manifest,head:args.revisionId,stateRevision:manifest.stateRevision+1,state:clone(manifest.revisionStates[args.revisionId]??{}),requests:{...manifest.requests},revisionStates:{...manifest.revisionStates,[manifest.head]:manifest.state}};
      next.requests[args.requestId]={requestHash,result:{artifactId:next.artifactId,head:next.head,stateRevision:next.stateRevision,state:clone(next.state)},createdAt:new Date().toISOString()};
      return {write:next,result:publicRecord(next)};
    });
  }
}
