import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sanitizeArchive, remapArtifactArchive } from '../src/artifacts/archive.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function record() {
  const definition = { schemaVersion:1,id:'tool',revision:1,title:'分配工具',summary:'保留的作品',scope:{sessionId:'old-session',branchId:'old-branch',worldKey:'world@1',sceneId:'opening',baseVersion:0},fields:[],steps:[],actions:[],view:[{type:'text',text:'试算'}] };
  const revision = {id:'rev_first',parentId:null,definition,contentHash:hash(definition),createdAt:'2026-10-15T00:00:00.000Z',reason:'创建',sourceScope:{...definition.scope,sourceHash:'old-fingerprint'}};
  return {artifactId:'art_original',head:revision.id,stateRevision:9,state:{count:0,enabled:false,empty:[],nothing:null},revisions:[revision],requests:{receipt:{requestHash:'secret-hash',result:{artifactId:'art_original',head:revision.id,stateRevision:9,state:{}},createdAt:revision.createdAt}},owner:'private-owner',secrets:{apiKey:'sk-sensitive'},operationReceipts:[{secret:'receipt'}]};
}
const target = {sessionId:'new-session',branchId:'new-branch'};

test('export preserves bounded presentation history and state while removing owner, request receipts and credential metadata', () => {
  const original = record();
  original.revisions[0].definition.owner='private-owner';
  original.revisions[0].definition.metadata={apiKey:'sensitive',label:'visible'};
  original.revisions[0].sourceScope.owner='private-owner';
  original.state.accessToken='sensitive-token';
  const envelope=sanitizeArchive([original]);
  assert.equal(envelope.version,1);
  assert.equal(envelope.records.length,1);
  const exported=envelope.records[0];
  assert.deepEqual(exported.state,{count:0,enabled:false,empty:[],nothing:null});
  assert.deepEqual(exported.revisions[0].definition.metadata,{label:'visible'});
  for(const key of ['owner','requests','secrets','operationReceipts'])assert.equal(Object.hasOwn(exported,key),false);
  assert.doesNotMatch(JSON.stringify(envelope),/private-owner|sensitive|secret-hash|receipt/);
  assert.equal(original.state.accessToken,'sensitive-token');
});

test('imports create a fresh namespace on every import and remap revision lineage, head and source scope', () => {
  const original=record();
  original.revisions.push({...structuredClone(original.revisions[0]),id:'rev_second',parentId:'rev_first',reason:'修改'});
  original.head='rev_second';
  const exported=sanitizeArchive([original]);
  const first=remapArtifactArchive(exported,target).records[0], second=remapArtifactArchive(exported,target).records[0];
  assert.notEqual(first.artifactId,original.artifactId);
  assert.notEqual(first.artifactId,second.artifactId);
  assert.notEqual(first.head,original.head);
  assert.equal(first.head,first.revisions[1].id);
  assert.equal(first.revisions[1].parentId,first.revisions[0].id);
  assert.equal(first.revisions[0].parentId,null);
  assert.equal(first.revisions[0].definition.id,first.revisions[1].definition.id);
  assert.notEqual(first.revisions[0].definition.id,'tool');
  assert.equal(first.stateRevision,0);
  for(const revision of first.revisions) {
    for(const scope of [revision.sourceScope,revision.definition.scope]) {
      assert.equal(scope.sessionId,target.sessionId); assert.equal(scope.branchId,target.branchId);
      assert.equal(Object.hasOwn(scope,'sourceHash'),false);
    }
  }
  assert.equal(exported.records[0].artifactId,'art_original');
});

test('imported definitions and state cannot carry rules, actions, receipts or approvals', () => {
  const original=record(),definition=original.revisions[0].definition;
  definition.actions=[{id:'spend',mode:'rule',targets:['coin'],effects:[{kind:'delta',value:-3}],result:'spent'}];
  definition.rule={execute:true};
  definition.view.push({type:'group',children:[],actions:[{mode:'attempt'}],dynamicApprovals:{grant:true},receipt:{result:'paid'}});
  original.state.pending={actionId:'spend',effects:[{value:-3}],authorization:'approved',quantity:3};
  const imported=remapArtifactArchive(sanitizeArchive([original]),target).records[0];
  assert.deepEqual(imported.revisions[0].definition.actions,[]);
  assert.deepEqual(imported.revisions[0].definition.view[1],{type:'group',children:[],actions:[]});
  assert.deepEqual(imported.state.pending,{quantity:3});
  assert.doesNotMatch(JSON.stringify(imported),/"(?:rule|effects|actionId|receipt|dynamicApprovals|authorization)"/);
});

test('all revisions and current state reject unsafe JSON without invoking getters or serializers', () => {
  let invoked=0;
  const getter=Object.defineProperty({},'value',{enumerable:true,get(){invoked++;return 1;}});
  const serializer={toJSON(){invoked++;return {};}};
  const loop={};loop.self=loop;
  for(const unsafe of [JSON.parse('{"__proto__":{"polluted":true}}'),{bad:Infinity},{bad:undefined},getter,serializer,loop,new Date(),Array(2)]) {
    const definitionRecord=record(); definitionRecord.revisions.push({...structuredClone(definitionRecord.revisions[0]),id:'rev_unsafe',definition:unsafe});
    assert.throws(()=>sanitizeArchive([definitionRecord]));
    const stateRecord=record();stateRecord.state=unsafe;
    assert.throws(()=>sanitizeArchive([stateRecord]));
  }
  assert.equal(invoked,0);
  assert.equal({}.polluted,undefined);
});

test('unknown versions, missing heads, duplicate identities, missing parents and invalid targets are rejected', () => {
  const good=sanitizeArchive([record()]);
  for(const version of [undefined,0,2,'1'])assert.throws(()=>remapArtifactArchive({...good,version},target));
  assert.throws(()=>remapArtifactArchive({...good,records:'invalid'},target));
  assert.throws(()=>remapArtifactArchive(good,{sessionId:'',branchId:'new'}));
  assert.throws(()=>remapArtifactArchive(good,{sessionId:'new',branchId:'__proto__'}));
  const noHead=record();noHead.head='missing';assert.throws(()=>sanitizeArchive([noHead]));
  const noParent=record();noParent.revisions[0].parentId='missing';assert.throws(()=>sanitizeArchive([noParent]));
  const duplicate=record();duplicate.revisions.push(structuredClone(duplicate.revisions[0]));assert.throws(()=>sanitizeArchive([duplicate]));
  assert.throws(()=>sanitizeArchive([record(),record()]));
});

test('archives enforce 64 total revisions, 10MiB encoded bytes and existing state/definition limits', () => {
  const tooMany=record();tooMany.revisions=Array.from({length:65},(_,index)=>({...tooMany.revisions[0],id:`rev_${index}`,parentId:index?`rev_${index-1}`:null}));tooMany.head='rev_64';
  assert.throws(()=>sanitizeArchive([tooMany]));
  const huge=record();huge.metadata='界'.repeat(4*1024*1024);assert.throws(()=>sanitizeArchive([huge]));
  const state=record();state.state={text:'x'.repeat(6001)};assert.throws(()=>sanitizeArchive([state]));
  const definition=record();definition.revisions[0].definition={text:'x'.repeat(500001)};assert.throws(()=>sanitizeArchive([definition]));
});

test('source and legacy script strings stay inert and empty or null presentation archives are supported', () => {
  const original=record();original.revisions[0].definition.view.push({type:'react',title:'script',source:'globalThis.archiveExecuted = true; export default () => null;'});
  remapArtifactArchive(sanitizeArchive([original]),target);
  assert.equal(globalThis.archiveExecuted,undefined);
  const absent=record();absent.revisions[0].definition=null;
  assert.equal(remapArtifactArchive(sanitizeArchive([absent]),target).records[0].revisions[0].definition,null);
  assert.deepEqual(remapArtifactArchive(sanitizeArchive([]),target),{version:1,records:[]});
});
