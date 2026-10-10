import test from 'node:test';
import assert from 'node:assert/strict';
import * as direction from '../src/scene-direction.mjs';

const body=()=>({input:'继续',state:{version:7},recent:[],narrative:{threads:[{id:'missing',status:'open',question:'货物去哪了',openedAt:1,updatedAt:6}],recentBeats:[{kind:'progress',summary:'抵达门边看见一个人',methodId:'free'},{kind:'progress',summary:'走到路口继续观察',methodId:'free'}]}});
test('direction prioritizes old promises despite tiny progress and bounds new hooks',()=>{
  assert.equal(typeof direction.sceneDirection,'function');
  const b=body(),before=JSON.stringify(b),d=direction.sceneDirection(b);
  assert.deepEqual(d.payoffThreadIds,['missing']);
  assert.equal(d.maxNewThreads,0);assert.equal(d.mode,'deliver');
  assert.equal(JSON.stringify(b),before);
  delete b.narrative;assert.equal(direction.sceneDirection(b).maxNewThreads,1);
});
test('repetition ranking uses actual recent outcomes, not a same-location penalty',()=>{
  assert.equal(typeof direction.scenePriority,'function');
  const b=body();b.narrative.recentBeats=[{kind:'progress',summary:'林接过扳手，修好了灯。',methodId:'free'}];
  const repeated={kind:'payoff',threadId:null,payoff:'林接过扳手，修好了灯。'};
  const fresh={kind:'progress',threadId:null,payoff:'林把亮灯挂到窗口，晚归的人终于认出了渡口。'};
  assert.ok(direction.scenePriority(fresh,b)>direction.scenePriority(repeated,b));
  assert.equal(direction.sceneDirection(b).mode,'deliver');
});
test('rest intent does not mistake a negation or NPC dialogue for player rest',()=>{
  assert.equal(typeof direction.requestsRest,'function');
  assert.equal(direction.requestsRest('我不休息，继续追查。'),false);
  assert.equal(direction.requestsRest('我问他：“你要休息吗？”'),false);
  assert.equal(direction.requestsRest('等他睡醒，我再询问。'),false);
  assert.equal(direction.requestsRest('我拒绝邀约，回家休息。'),true);
  const b=body();b.input='我到河边休息。';assert.equal(direction.sceneDirection(b).mode,'rest');
  assert.ok(direction.scenePriority({kind:'rest',payoff:'坐在河边',threadId:null},b)>direction.scenePriority({kind:'payoff',payoff:'找到货物',threadId:'missing'},b));
});

test('permission reminders and waiting are not a payoff that outranks an actual consequence',()=>{
 const b=body();b.narrative={threads:[],recentBeats:[]};
 const empty={kind:'payoff',threadId:null,payoff:'她没有替你作答，等着你开口。'};
 const change={kind:'progress',threadId:null,payoff:'她把电台切到私用频道，拒绝向同僚报告刚才看到的能力。'};
 assert.ok(direction.scenePriority(change,b)>direction.scenePriority(empty,b));
});
