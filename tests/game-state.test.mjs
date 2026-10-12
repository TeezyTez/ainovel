import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';
import {publicSituation} from '../src/experience-state.js';
const world={id:'game',version:1,title:'故事',location:'门前',opening:'门前很安静。',identity:'访客',rules:[],characters:[]};
const entity=(id,kind,name,value=null)=>({id,kind,name,detail:'',status:'',value,max:null,unit:'',quote:`${name}${value??''}`});
const opening='你站在门前，有铜币3枚。通往庭院的门收取1枚铜币。';
const update=()=>({entities:[entity('coin','item','铜币',3),entity('yard','place','庭院'),entity('doorstep','place','门前')],surfaces:[{id:'door',kind:'map',title:'门',description:'',entityIds:['coin','yard','doorstep'],links:[{from:'doorstep',to:'yard',label:'门'}],actions:[{id:'enter',label:'进入庭院',input:'交出1枚铜币，进入庭院',mode:'apply',effects:[{entityId:'coin',delta:-1,status:null}],destination:'yard',disabledReason:''}],quote:'通往庭院的门收取1枚铜币'}]});
const make=()=>core.createSession(world);
const commit=(s,extras={})=>core.commitTurn(s,world,'行动',{requestId:crypto.randomUUID(),baseVersion:core.currentState(s).version,prose:opening,events:[],...extras});
const ref=s=>({branchId:s.activeBranch,version:core.currentState(s).version,surfaceId:'door',actionId:'enter'});
const archive=s=>({schemaVersion:1,worlds:[world],sessions:[s]});

test('legacy surfaces named journeys still execute and replay without being mistaken for travel quotes',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js'),s=make(),game=update();game.surfaces[0].id='journeys';
 commit(s,{game});const receipt=resolveGameAction(core.currentState(s),{...ref(s),surfaceId:'journeys'},{branchId:s.activeBranch});
 assert.equal(receipt.mode,'apply');commit(s,{gameAction:receipt});assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('contextual timeline, people and comparison surfaces survive commit and archive replay',()=>{
 for(const kind of ['timeline','people','comparison']){
  const s=make(),game=update();game.surfaces=[{...game.surfaces[0],kind,links:[],actions:[]}];
  commit(s,{game});assert.equal(core.currentState(s).game.surfaces[0].kind,kind);
  assert.doesNotThrow(()=>core.validateArchive(archive(s)));
 }
});

test('a public fact may be presented as a clue without changing its recorded identity or certainty',()=>{
 const s=make(),prose='舵链检修尚未完成。';
 const record={id:'repair',kind:'fact',name:'舵链检修',summary:prose,status:'待检查',certainty:'reported',fields:[],relatedIds:[],quote:prose};
 const exp={clock:null,objects:[record],stop:null,folded:[]};
 const game={entities:[{...entity('repair','clue','舵链检修'),status:'待检查',quote:prose}],surfaces:[]};
 commit(s,{prose,game,experience:exp});
 assert.equal(core.currentState(s).experience.objects[0].kind,'fact');
 assert.equal(core.currentState(s).experience.objects[0].certainty,'reported');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
 for(const kind of ['person','item','location'])assert.throws(()=>commit(s,{prose,game,experience:{...exp,objects:[{...record,kind}]}}));
 assert.throws(()=>commit(s,{prose,game,experience:{...exp,objects:[{...record,name:'另一个事实'}]}}));
});

test('typing an exact visible action uses the same receipt; ambiguous and hypothetical text never triggers it',async()=>{
 const {gameActionForInput}=await import('../src/game-state.js');const s=make();commit(s,{game:update()});const state=core.currentState(s);
 assert.deepEqual(gameActionForInput(state,'进入庭院。',s.activeBranch),ref(s));
 assert.deepEqual(gameActionForInput(state,'交出1枚铜币，进入庭院',s.activeBranch),ref(s));
 assert.equal(gameActionForInput(state,'如果进入庭院会怎样？',s.activeBranch),undefined);
 const duplicate=structuredClone(state);duplicate.game.surfaces.push({...duplicate.game.surfaces[0],id:'other'});
 assert.equal(gameActionForInput(duplicate,'进入庭院',s.activeBranch),undefined);
 const unavailable=structuredClone(state);unavailable.game.surfaces[0].actions[0].disabledReason='门已经关闭';
 assert.throws(()=>gameActionForInput(unavailable,'进入庭院',s.activeBranch),/不可用/);
});

test('game receipts preserve generic entities and render only current surfaces',()=>{
 const s=make();assert.equal(core.currentState(s).game,undefined);
 commit(s,{game:update()});assert.equal(core.currentState(s).game.entities[0].value,3);
 commit(s,{game:null});assert.equal(core.currentState(s).game.entities.length,3);assert.deepEqual(core.currentState(s).game.surfaces,[]);
});

test('deterministic actions freeze costs and location and archive replay rejects tampering',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make();commit(s,{game:update()});
 const before=structuredClone(core.currentState(s));const receipt=resolveGameAction(before,ref(s),{branchId:s.activeBranch});
 assert.equal(receipt.effects[0].value,2);assert.equal(receipt.location,'庭院');assert.deepEqual(core.currentState(s),before);
 commit(s,{prose:'你交出铜币，走进庭院。',game:null,gameAction:receipt});assert.equal(core.currentState(s).game.entities[0].value,2);assert.equal(core.currentState(s).location,'庭院');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
 const bad=structuredClone(archive(s));bad.sessions[0].branches[0].turns[1].gameAction.effects[0].value=99;assert.throws(()=>core.validateArchive(bad));
});

test('actions reject stale references, forged receipts and writer cost overrides without mutation',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make();commit(s,{game:update()});
 assert.throws(()=>resolveGameAction(core.currentState(s),{...ref(s),version:0},{branchId:s.activeBranch}));
 assert.throws(()=>resolveGameAction(core.currentState(s),{...ref(s),branchId:'other'},{branchId:s.activeBranch}));
 const action=resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}),before=JSON.stringify(s);
 assert.throws(()=>commit(s,{game:null,gameAction:{...action,effects:[]}}));
 assert.throws(()=>commit(s,{prose:'铜币99。',game:{entities:[entity('coin','item','铜币',99)],surfaces:[]},gameAction:action}));
 assert.throws(()=>commit(s,{game:null,gameAction:action,events:[{type:'location',value:'别处',visibility:'player'}]}));assert.equal(JSON.stringify(s),before);
});

test('game schema rejects invented evidence, unsafe IDs, negative quantities and arbitrary behavior',()=>{
 for(const mutate of [u=>u.entities[0].quote='不存在',u=>u.entities[0].id='__proto__',u=>u.entities[0].value=-1,u=>u.surfaces[0].script='alert(1)',u=>u.surfaces[0].actions[0].mode='execute',u=>u.surfaces[0].actions[0].effects[0].entityId='missing']){
  const s=make(),u=update();mutate(u);assert.throws(()=>commit(s,{game:u}));assert.equal(core.getBranch(s).turns.length,0);
 }
});

test('forks retain independent game state, rebind historical receipts and preserve polished evidence',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make();commit(s,{game:update()});
 commit(s,{game:null,gameAction:resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch})});
 const old=s.activeBranch,t=core.getBranch(s).turns[0];t.revisions=[{prose:t.prose,createdAt:Date.now()}];t.prose='门开了。';
 core.forkBranch(s,core.getBranch(s).turns.at(-1).id,'分支');assert.notEqual(s.activeBranch,old);assert.equal(core.currentState(s).game.entities[0].value,2);
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));core.currentState(s).game.entities[0].value=0;
 assert.equal(s.branches.find(b=>b.id===old).turns.at(-1).state.game.entities[0].value,2);
});

test('attempt actions never apply automatic effects and insufficient resources reject',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.surfaces[0].actions[0].mode='attempt';
 assert.throws(()=>commit(s,{game:u}));u.surfaces[0].actions[0].effects=[];u.surfaces[0].actions[0].destination=null;commit(s,{game:u});
 const receipt=resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch});assert.deepEqual(receipt.effects,[]);assert.equal(receipt.location,'门前');
 const poor=make(),v=update();v.entities[0]=entity('coin','item','铜币',0);commit(poor,{prose:opening.replace('铜币3','铜币0'),game:v});assert.throws(()=>resolveGameAction(core.currentState(poor),ref(poor),{branchId:poor.activeBranch}));
});

test('numeric grounding distinguishes 3 from 30 and accepts Chinese quantities',()=>{
 const s=make(),u=update();u.entities[0].quote='铜币30';assert.throws(()=>commit(s,{prose:opening.replace('铜币3','铜币30'),game:u}));
 u.entities[0].quote='铜币三枚';u.surfaces[0].quote='通往庭院的门收取一枚铜币';
 assert.doesNotThrow(()=>commit(s,{prose:'你站在门前，有铜币三枚。通往庭院的门收取一枚铜币。',game:u}));
});

test('merged receipts preserve unseen entities and refuse type replacement or missing references',()=>{
 const s=make();commit(s,{game:update()});
 commit(s,{prose:'庭院暂未开放。',game:{entities:[{...entity('yard','place','庭院'),status:'暂未开放',quote:'庭院暂未开放'}],surfaces:[]}});
 assert.equal(core.currentState(s).game.entities.find(e=>e.id==='coin').value,3);
 assert.throws(()=>commit(s,{prose:'铜币。',game:{entities:[entity('coin','actor','铜币')],surfaces:[]}}));
 const u=update();u.surfaces[0].entityIds.push('missing');assert.throws(()=>commit(s,{game:u}));
});

test('resource ceilings, surface version and duplicate effects cannot bypass deterministic rules',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();
 u.entities[0].max=3;u.surfaces[0].actions[0].effects[0].delta=1;commit(s,{game:u});
 assert.throws(()=>resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}));
 const bad=structuredClone(core.currentState(s));bad.game.surfaces[0].version=0;assert.throws(()=>resolveGameAction(bad,ref(s),{branchId:s.activeBranch}));
 const duplicates=update();duplicates.surfaces[0].actions[0].effects.push(duplicates.surfaces[0].actions[0].effects[0]);assert.throws(()=>commit(make(),{game:duplicates}));
});

test('one complete saved prose must witness the entire gameplay receipt',()=>{
 const s=make();commit(s,{game:update()});const t=core.getBranch(s).turns[0];
 t.prose='你有铜币3枚。';t.revisions=[{prose:'通往庭院的门收取1枚铜币。',createdAt:Date.now()}];
 assert.throws(()=>core.validateArchive(archive(s)));
 t.revisions.push({prose:opening,createdAt:Date.now()});assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('travel requires a current, unambiguous source place and an explicit map route',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');
 for(const mutate of [u=>u.surfaces[0].links=[],u=>u.surfaces[0].links[0]={from:'yard',to:'doorstep',label:'回程'},u=>{u.entities.push({...entity('other-door','place','门前')});u.surfaces[0].entityIds.push('other-door');}]){
  const s=make(),u=update();mutate(u);commit(s,{game:u});assert.throws(()=>resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}));
 }
 const s=make();commit(s,{game:update()});const bad=structuredClone(core.currentState(s));bad.location='别处';assert.throws(()=>resolveGameAction(bad,ref(s),{branchId:s.activeBranch}));
 const u=update();u.surfaces[0].kind='interaction';assert.throws(()=>commit(make(),{game:u}));
});

const experience=(amount,status='已知')=>({clock:null,objects:[{id:'coin',kind:'item',name:'铜币',summary:'铜币3枚',status,certainty:'confirmed',fields:[{key:'amount',label:'数量',value:amount}],relatedIds:[],quote:'铜币3'}],stop:null,folded:[]});
test('settled quantities reject conflicting experience and legacy events atomically',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make();commit(s,{game:update(),experience:experience('3'),events:[{type:'item-add',value:'铜币',visibility:'player'}]});
 const gameAction=resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}),before=JSON.stringify(s);
 assert.throws(()=>commit(s,{game:null,gameAction,experience:experience('3')}));
 assert.throws(()=>commit(s,{game:null,gameAction,events:[{type:'item-remove',value:'铜币',visibility:'player'}]}));
 assert.equal(JSON.stringify(s),before);
 commit(s,{game:null,gameAction,experience:experience('2')});assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('public situation replaces stale numeric fields and summaries with canonical game values',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.entities[0].detail='你有铜币3枚';
 commit(s,{game:u,experience:experience('3'),events:[{type:'item-add',value:'铜币',visibility:'player'}]});
 commit(s,{game:null,gameAction:resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch})});
 const coin=publicSituation(core.getBranch(s),world).objects.find(o=>o.id==='coin');
 assert.equal(coin.fields.find(f=>f.key==='amount').value,'2');assert.ok(!coin.summary.includes('3'));
 assert.equal(core.currentState(s).game.entities.find(e=>e.id==='coin').detail,'');
 assert.equal(publicSituation(core.getBranch(s),world).objects.filter(o=>o.kind==='item'&&o.name==='铜币').length,1);
 assert.equal(publicSituation(core.getBranch(s),world,core.getBranch(s).turns[0].id).objects.find(o=>o.id==='coin').fields.find(f=>f.key==='amount').value,'3');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('zero quantity removes matching legacy possession without granting unrelated game items',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.surfaces[0].actions[0].effects[0].delta=-3;u.surfaces[0].quote=opening;
 commit(s,{game:u,events:[{type:'item-add',value:'铜币',visibility:'player'}]});const gameAction=resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch});
 assert.throws(()=>commit(s,{game:null,gameAction,events:[{type:'item-add',value:'铜币',visibility:'player'}]}));
 commit(s,{game:null,gameAction});assert.deepEqual(core.currentState(s).inventory,[]);
 assert.equal(publicSituation(core.getBranch(s),world).objects.find(o=>o.id==='coin').status,'已耗尽');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('ordinary turns cannot contradict retained canonical game quantities',()=>{
 const s=make();commit(s,{game:update(),experience:experience('3')});
 assert.throws(()=>commit(s,{game:null,experience:experience('2')}));
 assert.throws(()=>commit(s,{game:null,events:[{type:'item-remove',value:'铜币',visibility:'player'}]}));
});

test('exact prior amount fields reconcile legacy quantity labels without interpreting prose',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make();commit(s,{game:update(),experience:experience('3'),events:[{type:'item-add',value:'铜币3',visibility:'player'}]});
 commit(s,{game:null,gameAction:resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch})});
 assert.deepEqual(core.currentState(s).inventory,['铜币']);
 const items=publicSituation(core.getBranch(s),world).objects.filter(o=>o.kind==='item');assert.equal(items.length,1);assert.equal(items[0].name,'铜币');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('decimal actions reach exact capacity without a floating point overflow',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.entities[0].value=0.1;u.entities[0].max=0.3;u.entities[0].quote='铜币0.1，上限0.3';u.surfaces[0].actions[0].effects[0].delta=0.2;u.surfaces[0].quote='门前通往庭院，增加0.2';
 commit(s,{prose:'铜币0.1，上限0.3。门前通往庭院，增加0.2。',game:u});
 assert.equal(resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}).effects[0].value,0.3);
 const excessive=structuredClone(core.currentState(s));excessive.game.surfaces[0].actions[0].effects[0].delta=0.20000000000000004;assert.throws(()=>resolveGameAction(excessive,ref(s),{branchId:s.activeBranch}));
});

test('explicit canonical statuses cannot be contradicted through the experience channel',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.surfaces[0].actions[0].effects[0].status='已支付';
 commit(s,{game:u});const gameAction=resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch});
 assert.throws(()=>commit(s,{game:null,gameAction,experience:experience('2','未支付')}));
 commit(s,{game:null,gameAction,experience:experience('2','已支付')});assert.equal(publicSituation(core.getBranch(s),world).objects.find(o=>o.id==='coin').status,'已支付');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('ordinary synonymous status labels remain compatible unless an action explicitly changes status',async()=>{
 const {resolveGameAction}=await import('../src/game-state.js');const s=make(),u=update();u.entities[0].status='当前持有';
 commit(s,{game:u,experience:experience('3','随身携带')});
 commit(s,{game:null,gameAction:resolveGameAction(core.currentState(s),ref(s),{branchId:s.activeBranch}),experience:experience('2','持有中')});
 assert.equal(publicSituation(core.getBranch(s),world).objects.find(o=>o.id==='coin').status,'当前持有');
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('game objectives preserve compatible agreement records and cannot reopen terminal agreements',()=>{
 const s=make(),objective={...entity('deliver','objective','送信约定'),status:'进行中'};
 const agreement=status=>({clock:null,objects:[{id:'deliver',kind:'agreement',name:'送信约定',summary:'送信约定',status,certainty:'confirmed',fields:[],relatedIds:[],quote:'送信约定'}],stop:null,folded:[]});
 commit(s,{prose:'送信约定。',game:{entities:[objective],surfaces:[]},experience:agreement('进行中')});
 assert.equal(publicSituation(core.getBranch(s),world).objects.find(o=>o.id==='deliver').kind,'agreement');
 commit(s,{prose:'送信约定。',game:{entities:[{...objective,status:'已履行'}],surfaces:[]},experience:agreement('已履行')});
 assert.throws(()=>commit(s,{prose:'送信约定。',game:{entities:[objective],surfaces:[]},experience:agreement('进行中')}));
 assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});

test('same-name objects retain distinct stable identities and independent quantities',()=>{
 const s=make(),exp=experience('3');exp.objects[0].id='my-key';exp.objects[0].name='钥匙';exp.objects[0].quote='钥匙3';exp.objects.push({...structuredClone(exp.objects[0]),id:'shop-key',fields:[{key:'amount',label:'数量',value:'9'}]});
 const game={entities:[entity('my-key','item','钥匙',3)],surfaces:[]};commit(s,{prose:'钥匙3。店内另有钥匙9。',game,experience:exp});
 const keys=publicSituation(core.getBranch(s),world).objects.filter(o=>o.name==='钥匙');assert.equal(keys.length,2);assert.equal(keys.find(o=>o.id==='shop-key').fields.find(f=>f.key==='amount').value,'9');
 commit(s,{prose:'钥匙3。店内另有钥匙9。',game:null,experience:{...exp,objects:[exp.objects[1]]}});
 assert.equal(publicSituation(core.getBranch(s),world).objects.filter(o=>o.name==='钥匙').length,2);assert.doesNotThrow(()=>core.validateArchive(archive(s)));
});
