import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';
import {advanceNarrative, validateNarrative, narrativeForBranch} from '../src/narrative-state.js';
const prose = '她把收据留下。收据证明钱已还清。';
const thread = (id='receipt',status='open') => ({id,question:'款项是否还清？',stakes:'她能否保住书店',status,evidence:'她把收据留下。'});
const delta = (threads=[thread()]) => ({focus:'核对收据',beat:{kind:'progress',summary:'收据留下了',methodId:'consequence'},threads,opportunities:[{id:'talk',condition:'玩家愿意继续询问',idea:'可以谈谈开店的过去'}]});
const world = {id:'test',version:1,title:'书店',location:'书店',opening:'门开了。',identity:'店主',rules:[],characters:[]};
const setup = () => core.createSession(world);
const proposal = (s,id,n) => ({requestId:id,baseVersion:core.currentState(s).version,prose,events:[],...(n===undefined?{}:{narrative:n})});

test('evidenced updates preserve identity and input while candidates stay separate',()=>{
  const d=delta(),saved=structuredClone(d),a=advanceNarrative(null,d,prose,1,'test@1');
  assert.deepEqual(d,saved);assert.equal(a.schemaVersion,1);assert.equal(a.threads[0].openedAt,1);
  assert.equal(validateNarrative(a,1,'test@1'),a);
  const before=structuredClone(a),b=advanceNarrative(a,delta([{...thread('receipt','resolved'),evidence:'收据证明钱已还清。'}]),prose,2,'test@1');
  assert.deepEqual(a,before);assert.equal(b.threads[0].openedAt,1);assert.equal(b.threads[0].updatedAt,2);assert.equal(b.threads[0].status,'resolved');
  assert.equal(b.opportunities[0].idea,'可以谈谈开店的过去');
});
test('fabricated evidence, identity replacement, duplicate updates and terminal reopening fail',()=>{
  const a=advanceNarrative(null,delta(),prose,1,'test@1');
  for(const updates of [[{...thread(),evidence:'钱尚未还清。'}],[{...thread(),question:'另一个问题？'}],[thread(),thread()]]) assert.throws(()=>advanceNarrative(a,delta(updates),prose,2,'test@1'));
  for(const status of ['resolved','retired']){
    const b=advanceNarrative(a,delta([thread('receipt',status)]),prose,2,'test@1');
    for(const next of ['open','progressed','resolved'])assert.throws(()=>advanceNarrative(b,delta([thread('receipt',next)]),prose,3,'test@1'));
  }
  assert.throws(()=>advanceNarrative(null,delta([thread('new','resolved')]),prose,1,'test@1'));
});
test('strict bounded snapshots reject extra fields, invalid clocks and duplicate identifiers',()=>{
  const a=advanceNarrative(null,delta(),prose,1,'test@1');
  for(const mutate of [v=>v.authority=true,v=>v.turn=1.5,v=>v.worldKey='bad',v=>v.threads[0].openedAt=2,v=>v.threads.push(v.threads[0]),v=>v.recentBeats[0].turn=2,v=>v.opportunities[0].fact=true,v=>v.focus='x'.repeat(501)]){
    const b=structuredClone(a);mutate(b);assert.throws(()=>validateNarrative(b));
  }
  assert.throws(()=>validateNarrative(a,2));assert.throws(()=>validateNarrative(a,1,'test@2'));
  assert.throws(()=>advanceNarrative(a,delta([]),prose,3,'test@1'));
  assert.throws(()=>advanceNarrative(a,delta([]),prose,2,'test@2'));
  assert.throws(()=>advanceNarrative(a,{...delta([]),opportunities:[1,2,3,4]},prose,2,'test@1'));
});
test('open expectations never silently disappear and oldest completed records make space',()=>{
  let a=null;
  for(let turn=1;turn<=8;turn++)a=advanceNarrative(a,delta([thread('t'+turn)]),prose,turn,'test@1');
  assert.equal(a.threads.length,8);assert.equal(a.recentBeats.length,6);assert.equal(a.recentBeats[0].turn,3);
  assert.throws(()=>advanceNarrative(a,delta([thread('t9')]),prose,9,'test@1'));
  assert.throws(()=>advanceNarrative(a,delta([thread('t1','resolved'),thread('t9')]),prose,9,'test@1'));
  const resolved=advanceNarrative(a,delta([thread('t1','resolved')]),prose,9,'test@1');
  const b=advanceNarrative(resolved,delta([thread('t9')]),prose,10,'test@1');
  assert.equal(b.threads.length,8);assert.ok(!b.threads.some(t=>t.id==='t1'));assert.ok(b.threads.some(t=>t.id==='t9'));
  assert.deepEqual(b.threads.find(t=>t.id==='t2'),a.threads.find(t=>t.id==='t2'));
});
test('narrative commits atomically and cannot alter authoritative facts',()=>{
  const s=setup(),a=advanceNarrative(null,delta(),prose,1,'test@1'),p=proposal(s,'one',a);
  p.events=[{type:'item-add',value:'收据',visibility:'player'}];
  const before=JSON.stringify(s);assert.throws(()=>core.commitTurn(s,world,'查看',{...p,narrative:{...a,turn:2}}));assert.equal(JSON.stringify(s),before);
  const t=core.commitTurn(s,world,'查看',p);assert.deepEqual(t.narrative,a);assert.deepEqual(core.currentState(s).facts,[]);
  a.focus='外部修改';assert.equal(t.narrative.focus,'核对收据');
  const bad=advanceNarrative(t.narrative,delta([]),prose,2,'test@1');bad.threads=[];
  const committed=JSON.stringify(s);assert.throws(()=>core.commitTurn(s,world,'继续',proposal(s,'two',bad)));assert.equal(JSON.stringify(s),committed);
});
test('historical forks read only their final snapshot and rewritten worlds invalidate context',()=>{
  const s=setup(),a=advanceNarrative(null,delta(),prose,1,'test@1');
  const first=core.commitTurn(s,world,'查看',proposal(s,'one',a));
  core.commitTurn(s,world,'继续',proposal(s,'two',advanceNarrative(a,delta([thread('receipt','resolved')]),prose,2,'test@1')));
  const fork=core.forkBranch(s,first.id,'旧节点');assert.equal(narrativeForBranch(fork).threads[0].status,'open');
  core.commitTurn(s,world,'旧模式继续',proposal(s,'three'));assert.equal(narrativeForBranch(fork),null);
  const rewritten=core.forkBranch(s,first.id,'新版',{...world,version:2});assert.equal(narrativeForBranch(rewritten),null);
  assert.equal(rewritten.turns[0].narrative.worldKey,'test@1');
  assert.doesNotThrow(()=>core.validateArchive({schemaVersion:1,worlds:[world,{...world,version:2}],sessions:[s]}));
});
test('archives accept absent snapshots but reject malformed or unevidenced ones',()=>{
  const s=setup();core.commitTurn(s,world,'旧存档',proposal(s,'old'));
  const db={schemaVersion:1,worlds:[world],sessions:[s]};assert.doesNotThrow(()=>core.validateArchive(db));
  const a=advanceNarrative(null,delta(),prose,2,'test@1');core.commitTurn(s,world,'新回合',proposal(s,'new',a));
  assert.doesNotThrow(()=>core.validateArchive(db));
  for(const mutate of [n=>n.turn=1,n=>n.threads[0].evidence='正文没有这句话。',n=>n.worldKey='test@99']){
    const broken=structuredClone(db);mutate(broken.sessions[0].branches[0].turns[1].narrative);assert.throws(()=>core.validateArchive(broken));
  }
});
test('polished snapshots retain one complete original prose witness in revisions',()=>{
  const s=setup(),a=advanceNarrative(null,delta(),prose,1,'test@1');
  const t=core.commitTurn(s,world,'查看',proposal(s,'one',a));
  t.revisions=[{prose:t.prose,createdAt:Date.now()}];t.prose='她留下凭证，钱款已经结清。';
  const db={schemaVersion:1,worlds:[world],sessions:[s]};
  assert.doesNotThrow(()=>core.validateArchive(db));
  t.revisions[0].createdAt='bad';assert.throws(()=>core.validateArchive(db));
  t.revisions[0].createdAt=Date.now();t.revisions[0].prose='不相干的旧文字。';assert.throws(()=>core.validateArchive(db));
});
test('archive evidence cannot be assembled from incompatible polished versions',()=>{
  const s=setup(),updates=[thread('receipt'),{...thread('payment'),evidence:'收据证明钱已还清。'}];
  const t=core.commitTurn(s,world,'查看',proposal(s,'one',advanceNarrative(null,delta(updates),prose,1,'test@1')));
  t.prose='新的正文。';t.revisions=[{prose:'她把收据留下。',createdAt:Date.now()},{prose:'收据证明钱已还清。',createdAt:Date.now()}];
  assert.throws(()=>core.validateArchive({schemaVersion:1,worlds:[world],sessions:[s]}));
});
test('narrative clocks follow authoritative version even when display step differs',()=>{
  const s=setup();core.getBranch(s).initialState.step=10;
  const a=advanceNarrative(null,delta(),prose,1,'test@1');
  core.commitTurn(s,world,'查看',proposal(s,'one',a));
  assert.equal(core.currentState(s).step,11);assert.equal(narrativeForBranch(core.getBranch(s)).turn,1);
  assert.doesNotThrow(()=>core.validateArchive({schemaVersion:1,worlds:[world],sessions:[s]}));
});
