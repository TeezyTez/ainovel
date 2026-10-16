import {createHash} from 'node:crypto';
import {ArtifactStore,hashArtifactValue} from './artifacts/store.mjs';
import {JobRegistry} from './artifacts/jobs.mjs';
import {ArtifactError,ArtifactImportSchema,RequestIdSchema,parseArtifactInput} from './artifacts/protocol.mjs';
import {ApiError} from './server-model.mjs';
import {canonical,DYNAMIC_PROMPT_VERSION,validateDefinition} from './dynamic-rules.js';
import {dynamicScope,preparationSource} from './server-dynamic.mjs';
import {cleanArtifactState} from './interactive-artifact.js';
import {migrateArtifactState} from './interaction-intent.mjs';
import {sanitizeArchive,remapArtifactArchive,MAX_ARTIFACT_ARCHIVE_BYTES} from './artifacts/archive.mjs';
import {validateArtifactScripts} from './server-interactive-artifact.mjs';

const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const scope=(owner,body)=>({owner,sessionId:body.sessionId,branchId:body.branchId});
const currentRevision=record=>record?.revisions.find(r=>r.id===record.head);
const nodes=definition=>{const found=[];function walk(values){for(const node of values??[]){if(['react','interactive'].includes(node.type))found.push(node);if(node.children)walk(node.children);}}walk(definition?.view);return found;};
const fail=(code,message,status=409)=>{throw new ApiError(status,code,message);};
// An import fingerprint covers an entire bounded archive plus request metadata;
// individual definition/state hashes retain their narrower default limits.
const archiveRequestHash=body=>hashArtifactValue(body,{maxDepth:42,maxNodes:100100,maxLength:MAX_ARTIFACT_ARCHIVE_BYTES+8192});

export class ArtifactService{
  constructor({ledger,dynamic,directory,verify}={}){this.ledger=ledger;this.dynamic=dynamic;this.store=new ArtifactStore(directory);this.jobs=new JobRegistry();this.verify=verify??this.verifyDefinition.bind(this);}
  key(owner,body){return hashArtifactValue(scope(owner,body));}
  async load(owner,body){const data=await this.ledger.load(owner,body.sessionId),branch=this.ledger.branch(data,body.branchId);return {data,branch};}
  compatible(revision,data,branch){return !!revision&&canonical(revision.sourceScope??revision.definition?.scope)===canonical({...dynamicScope(data.session,branch),...(revision.sourceScope?.sourceHash?{sourceHash:preparationSource(data,branch)}:{})});}
  metadata(record,data,branch){
    if(!record)return null;const revision=currentRevision(record);
    return {artifactId:record.artifactId,head:record.head,contentHash:revision.contentHash,stateRevision:record.stateRevision,state:record.state,compatible:this.compatible(revision,data,branch),revisions:record.revisions.map(r=>({id:r.id,parentId:r.parentId,createdAt:r.createdAt,reason:r.reason,title:r.definition?.title??'收起界面',compatible:this.compatible(r,data,branch)}))};
  }
  project(record,data,branch){
    const revision=currentRevision(record);if(!this.compatible(revision,data,branch))return;
    const definition=structuredClone(revision.definition),key=definition?digest(definition):null;
    if(definition){data.dynamicApprovals??={};data.dynamicApprovals[key]=true;if(definition.actions.some(a=>a.mode==='rule')){data.dynamicRuleSources??={};data.dynamicRuleSources[key]=preparationSource(data,branch);}}
    branch.dynamic={scope:dynamicScope(data.session,branch),intent:branch.dynamic?.intent??'',definition,digest:key,promptVersion:DYNAMIC_PROMPT_VERSION,reason:'',decisionReason:''};
  }
  async read(owner,body){
    // A failed projection write is recovered from the authoritative artifact manifest.
    return this.dynamic.locked(owner,body,async(data,branch)=>{const record=await this.store.read(scope(owner,body));if(record&&this.compatible(currentRevision(record),data,branch)&&branch.dynamic?.digest!==(currentRevision(record).definition?digest(currentRevision(record).definition):null)){this.project(record,data,branch);await this.ledger.save(owner,data);}return this.dynamic.response(data,branch,{artifact:this.metadata(record,data,branch)});},{activate:false});
  }
  async start(owner,body){
    parseArtifactInput(RequestIdSchema,body.requestId);await this.load(owner,body);
    const requestHash=hashArtifactValue(body),key=this.key(owner,body);
    const saved=await this.store.read(scope(owner,body)),receipt=saved?.requests[body.requestId];
    if(receipt&&receipt.requestHash!==requestHash)fail('REQUEST_CONFLICT','同一请求标识对应不同输入。');
    const existing=[...this.jobs.jobs.values()].find(job=>job.key===key&&job.requestId===body.requestId);
    if(receipt&&existing?.finishedAt){const original=await existing.done;return {...existing,done:Promise.resolve({...original,...await this.read(owner,body),committedRevision:receipt.result.head})};}
    return this.jobs.start(key,{requestId:body.requestId,requestHash,serializeResult:value=>({refresh:true,...(value.intentDecision?{intentDecision:value.intentDecision}:{}),...(value.artifact?{artifact:{head:value.artifact.head}}:{}),...(value.projectionPending?{projectionPending:true}:{})})},async(signal,emit,jobContext)=>{
      if(receipt)return {...await this.read(owner,body),committedRevision:receipt.result.head};
      const initial=await this.store.read(scope(owner,body)),revision=currentRevision(initial);
      const expectedHead=body.expectedHead===undefined?(initial?.head??null):body.expectedHead,expectedStateRevision=body.expectedStateRevision??initial?.stateRevision??0;
      if((initial?.head??null)!==expectedHead||(initial?.stateRevision??0)!==expectedStateRevision)fail('ARTIFACT_CONFLICT','作品或参数已改变，请恢复当前版本后重试。');
      const {data,branch}=await this.load(owner,body),prior=branch.dynamic;
      const artifactContext=initial?{artifactId:initial.artifactId,head:initial.head,contentHash:revision.contentHash}:prior?.definition?{artifactId:prior.definition.id,head:null,contentHash:null}:null;
      const ui={...body.ui};if(initial&&prior?.definition&&this.compatible(revision,data,branch))ui.artifact={id:prior.definition.id,digest:prior.digest,state:initial.state,error:typeof ui.artifact?.error==='string'?ui.artifact.error:''};
      const candidateState=(definition,migration)=>{const node=nodes(definition)[0],defaults=node&&Object.hasOwn(node,'initialState')?cleanArtifactState(node.initialState):{};return initial?migrateArtifactState(initial.state,defaults,migration):defaults;};
      let committed,commitSnapshot;
      const commitBoundary=jobContext?.commit?fn=>jobContext.commit(async()=>{try{return await fn();}catch(error){if(!committed)throw error;const {data,branch}=commitSnapshot;this.project(committed,data,branch);return this.dynamic.response(data,branch,{artifact:this.metadata(committed,data,branch),projectionPending:true});}}):undefined;
      const result=await this.dynamic.prepare(owner,{...body,ui},signal,{artifactContext,onProgress:emit,verifyCandidate:(definition,ctx)=>this.verify(definition,{...ctx,state:candidateState(definition,ctx.stateMigration)}),commitBoundary,beforeCommit:async(definition,ctx)=>{
        if(ctx.retained||ctx.reason)return {};
        signal.throwIfAborted();
        const nextState=candidateState(definition,ctx.stateMigration);
        committed=await this.store.commit(scope(owner,body),{requestId:body.requestId,requestHash,definition,expectedHead,expectedStateRevision,state:nextState,reason:(body.intent||'随当前场景整理').slice(0,2000),sourceScope:{...ctx.scope,sourceHash:preparationSource(ctx.data,ctx.branch)}},{signal});
        commitSnapshot={data:ctx.data,branch:ctx.branch};
        return {artifact:this.metadata(committed,ctx.data,ctx.branch)};
      }});
      if(!result.artifact){const current=await this.store.read(scope(owner,body)),loaded=await this.load(owner,body);result.artifact=this.metadata(current,loaded.data,loaded.branch);}
      if(body.inputRouting&&!result.intentDecision)fail('INVALID_INTENT',result.authoritativeBranch.dynamic?.reason||'暂时无法确认输入用途，草稿已保留。',422);
      return result;
    });
  }
  async verifyDefinition(definition,{signal,onProgress=()=>{},state}){
    for(const node of nodes(definition)){
      signal.throwIfAborted();let renderNode=node;
      if(node.type==='react'){onProgress({type:'stage',stage:'building'});const {compileReactArtifact}=await import('./server-artifact-build.mjs');renderNode=await compileReactArtifact(node);}
      onProgress({type:'stage',stage:'checking'});const {probeArtifact}=await import('./server-artifact-probe.mjs');
      for(const width of [390,1280]){const probe=await probeArtifact(renderNode,{signal,state,timeoutMs:15000,viewport:{width,height:800},smoke:true});if(!probe.ok)throw new Error('界面运行检查未通过：'+probe.errors.join('；').slice(0,1200));}
    }
  }
  async saveState(owner,body){
    return this.dynamic.locked(owner,body,async(data,branch)=>{const record=await this.store.read(scope(owner,body));
    if(!this.compatible(currentRevision(record),data,branch))fail('VERSION_CONFLICT','场景已改变，旧界面参数未写入。');
    const updated=await this.store.saveState(scope(owner,body),Object.fromEntries(['artifactId','revisionId','expectedStateRevision','state'].map(k=>[k,body[k]])));
    return {artifact:this.metadata(updated,data,branch)};},{activate:false});
  }
  async restore(owner,body){
    return this.dynamic.locked(owner,body,async(data,branch)=>{
      const record=await this.store.read(scope(owner,body)),revision=record?.revisions.find(r=>r.id===body.revisionId);
      if(!this.compatible(revision,data,branch))fail('VERSION_CONFLICT','这个版本属于先前场景，不能覆盖当前场景的界面。');
      const restored=await this.store.restore(scope(owner,body),Object.fromEntries(['revisionId','expectedHead','expectedStateRevision','requestId'].map(k=>[k,body[k]])));
      const current=await this.store.read(scope(owner,body));this.project(current,data,branch);await this.ledger.save(owner,data);return this.dynamic.response(data,branch,{artifact:this.metadata(current,data,branch),committedRevision:restored.head});
    },{activate:false});
  }
  async bundle(owner,body){
    const {data,branch}=await this.load(owner,body),definition=branch.dynamic?.definition;
    if(!definition||body.definitionDigest!==branch.dynamic.digest||canonical(definition.scope)!==canonical(dynamicScope(data.session,branch)))fail('VERSION_CONFLICT','交互图已更新，请重新打开。');
    const node=nodes(definition).find(n=>n.type==='react');if(!node)fail('ARTIFACT_NOT_FOUND','当前作品没有 React 视图。',404);
    const {compileReactArtifact}=await import('./server-artifact-build.mjs');return {node:await compileReactArtifact(node)};
  }
  async export(owner,body){await this.load(owner,body);const record=await this.store.read(scope(owner,body));return sanitizeArchive(record?[record]:[]);}
  async import(owner,body,signal=new AbortController().signal){
    parseArtifactInput(RequestIdSchema,body.requestId);
    const {data,branch}=await this.load(owner,body),source=preparationSource(data,branch),incoming=remapArtifactArchive(body.archive,{sessionId:body.sessionId,branchId:body.branchId});
    if(incoming.records.length!==1)fail('INVALID_ARTIFACT_ARCHIVE','请选择只包含一份作品的文件。',400);
    const requestHash=archiveRequestHash(body),args=parseArtifactInput(ArtifactImportSchema,{record:incoming.records[0],requestId:body.requestId,requestHash,expectedHead:body.expectedHead,expectedStateRevision:body.expectedStateRevision});
    const current=await this.store.read(scope(owner,body)),receipt=current?.requests[body.requestId];
    if(receipt){if(receipt.requestHash!==requestHash)fail('REQUEST_CONFLICT','同一请求标识对应不同输入。');return {...await this.read(owner,body),committedRevision:receipt.result.head};}
    if((current?.head??null)!==args.expectedHead||(current?.stateRevision??0)!==args.expectedStateRevision)fail('ARTIFACT_CONFLICT','作品或参数已改变，请恢复当前版本后重试。');
    const record=args.record,currentScope=dynamicScope(data.session,branch);
    for(const revision of record.revisions){signal.throwIfAborted();revision.sourceScope={...currentScope,sourceHash:source};if(revision.definition){revision.definition.scope=currentScope;validateDefinition(revision.definition,branch.turns.at(-1)?.state??branch.initialState);validateArtifactScripts(revision.definition);await this.verify(revision.definition,{signal,...(revision.id===record.head?{state:record.state}:{})});revision.contentHash=hashArtifactValue(revision.definition);}}
    return this.dynamic.locked(owner,body,async(data,branch)=>{
      if(preparationSource(data,branch)!==source)fail('VERSION_CONFLICT','场景已改变，导入作品未激活。');signal.throwIfAborted();
      const saved=await this.store.importArchive(scope(owner,body),{...args,record});
      const current=await this.store.read(scope(owner,body));this.project(current,data,branch);await this.ledger.save(owner,data);return this.dynamic.response(data,branch,{artifact:this.metadata(current,data,branch),committedRevision:saved.head});
    },{activate:false});
  }
  close(){for(const job of this.jobs.jobs.values())job.cancel();}
}
