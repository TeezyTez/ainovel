import {createHash,randomUUID} from 'node:crypto';
import {ArtifactError,ArtifactRecordSchema,ArtifactRevisionSchema,canonicalArtifactJson,cleanArtifactJson,parseArtifactInput} from './protocol.mjs';

export const ARTIFACT_ARCHIVE_VERSION=1;
export const MAX_ARTIFACT_ARCHIVE_BYTES=10*1024*1024;
export const MAX_ARTIFACT_ARCHIVE_REVISIONS=64;
const fail=message=>{throw new ArtifactError('invalid_artifact_archive',message);};
const has=(value,key)=>Object.hasOwn(value,key);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>has(value,key)).map(key=>[key,value[key]]));
const privateKeys=new Set(['owner','requests','request','requesthash','requestid','receipt','receipts','operationreceipts','dynamicreceipts','secrets','secret','apikey','accesstoken','refreshtoken','token','password','credentials','credential','authorization','cookie','cookies']);
const authorityKeys=new Set(['rule','rules','effects','checks','targets','operation','operations','actionid','interactionid','definitiondigest','dynamicapprovals','dynamicrulesources','approvals','rulesources','authority','capabilities']);
const keyName=key=>key.replace(/[_-]/g,'').toLowerCase();

// Inspect descriptors before reading values. This also rejects oversized strings
// before JSON.stringify could allocate an unbounded escaped copy of the input.
function boundedJson(value){
  let nodes=0,bytes=0;
  function visit(item,depth){
    if(depth>40||++nodes>100000)fail('Artifact archive JSON is too complex.');
    if(typeof item==='string')bytes+=Buffer.byteLength(item,'utf8');
    else if(item&&typeof item==='object'){
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))){
        if(Array.isArray(item)&&key==='length')continue;
        bytes+=Buffer.byteLength(key,'utf8');
        if(!has(descriptor,'value'))fail('Artifact archive cannot contain accessors.');
        visit(descriptor.value,depth+1);
      }
    }
    if(bytes>MAX_ARTIFACT_ARCHIVE_BYTES)fail('Artifact archive exceeds 10 MiB.');
  }
  visit(value,0);
  const safe=cleanArtifactJson(value,{maxDepth:40,maxNodes:100000,maxLength:MAX_ARTIFACT_ARCHIVE_BYTES});
  if(Buffer.byteLength(JSON.stringify(safe),'utf8')>MAX_ARTIFACT_ARCHIVE_BYTES)fail('Artifact archive exceeds 10 MiB.');
  return safe;
}

function redact(value,stripAuthority=false){
  if(Array.isArray(value))return value.map(item=>redact(item,stripAuthority));
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value)){
    const name=keyName(key);
    if(privateKeys.has(name)||stripAuthority&&authorityKeys.has(name))continue;
    if(stripAuthority&&name==='actions'){result[key]=[];continue;}
    if(stripAuthority&&name==='mode'&&['rule','attempt'].includes(item))continue;
    if(stripAuthority&&name==='sourcehash')continue;
    result[key]=redact(item,stripAuthority);
  }
  return result;
}

function hash(definition){return createHash('sha256').update(canonicalArtifactJson(definition)).digest('hex');}

function sanitizeRecords(input){
  if(!Array.isArray(input)||input.length>MAX_ARTIFACT_ARCHIVE_REVISIONS)fail('Artifact archive records must be an array of at most 64 records.');
  let count=0;
  const artifacts=new Set(),revisions=new Set();
  return input.map(record=>{
    if(!record||typeof record!=='object'||Array.isArray(record)||!Array.isArray(record.revisions)||record.revisions.length===0)fail('Each archived artifact needs at least one revision.');
    count+=record.revisions.length;
    if(count>MAX_ARTIFACT_ARCHIVE_REVISIONS)fail('Artifact archive exceeds 64 total revisions.');
    const ancestry=new Set();
    const cleanRevisions=record.revisions.map(revision=>{
      if(!revision||typeof revision!=='object'||Array.isArray(revision))fail('Artifact revision is invalid.');
      const parsed=parseArtifactInput(ArtifactRevisionSchema,pick(revision,['id','parentId','definition','contentHash','createdAt','reason','sourceScope']));
      if(revisions.has(parsed.id))fail('Artifact archive contains duplicate revision identities.');
      if(parsed.parentId!==null&&!ancestry.has(parsed.parentId))fail('Artifact revision parent must precede its child.');
      ancestry.add(parsed.id);revisions.add(parsed.id);
      const definition=redact(parsed.definition);
      return {...parsed,definition,contentHash:hash(definition),...(has(parsed,'sourceScope')?{sourceScope:redact(parsed.sourceScope)}:{})};
    });
    const parsed=parseArtifactInput(ArtifactRecordSchema,{...pick(record,['artifactId','head','stateRevision','state']),revisions:cleanRevisions,requests:{}});
    if(artifacts.has(parsed.artifactId))fail('Artifact archive contains duplicate artifact identities.');
    if(!ancestry.has(parsed.head))fail('Artifact archive head revision is missing.');
    artifacts.add(parsed.artifactId);
    const {requests,...result}=parsed;
    return {...result,state:redact(result.state)};
  });
}

/** Export only public presentation data, with the current state from ArtifactStore.read(). */
export function sanitizeArchive(records){
  const safe=boundedJson(records);
  return boundedJson({version:ARTIFACT_ARCHIVE_VERSION,records:sanitizeRecords(safe)});
}

function validTarget(value){return typeof value==='string'&&value.length>0&&value.length<=256&&!['__proto__','prototype','constructor'].includes(value)&&!/[\u0000-\u001f]/.test(value);}

/** Pure remapping: callers still validate/build/probe before projecting any imported UI. */
export function remapArtifactArchive(envelope,{sessionId,branchId}={}){
  const safe=boundedJson(envelope);
  if(!safe||Array.isArray(safe)||safe.version!==ARTIFACT_ARCHIVE_VERSION)fail('Unsupported artifact archive version.');
  if(!validTarget(sessionId)||!validTarget(branchId))fail('Artifact archive target session and branch are invalid.');
  const exported=sanitizeArchive(safe.records);
  const remapScope=scope=>({...scope,sessionId,branchId});
  const records=exported.records.map(record=>{
    const revisionIds=new Map(record.revisions.map(revision=>[revision.id,'rev_'+randomUUID()]));
    const definitionIds=new Map();
    return {
      artifactId:'art_'+randomUUID(),head:revisionIds.get(record.head),stateRevision:0,state:redact(record.state,true),
      revisions:record.revisions.map(revision=>{
        const definition=redact(revision.definition,true);
        if(definition){
          if(typeof definition.id==='string'){
            if(!definitionIds.has(definition.id))definitionIds.set(definition.id,'imported_'+randomUUID());
            definition.id=definitionIds.get(definition.id);
          }
          // Dynamic definitions retain their fields/views but never actions.
          if(Array.isArray(definition.view)||has(definition,'actions'))definition.actions=[];
          if(definition.scope&&typeof definition.scope==='object'&&!Array.isArray(definition.scope))definition.scope=remapScope(definition.scope);
        }
        return {...revision,id:revisionIds.get(revision.id),parentId:revision.parentId===null?null:revisionIds.get(revision.parentId),definition,contentHash:hash(definition),...(has(revision,'sourceScope')?{sourceScope:remapScope(redact(revision.sourceScope,true))}:{})};
      }),
    };
  });
  // Re-apply shared definition/state bounds after namespace changes.
  return sanitizeArchive(records);
}
