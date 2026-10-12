import test from 'node:test';
import assert from 'node:assert/strict';
import {aroundObjects,inventoryGroups,journalConcerns,objectActions,timePanelView,timeControlFromInput,aroundView,inventoryView,journalView} from '../src/play-views.js';

const field=(key,value)=>({key,label:key,value});
const record=(id,kind,extra={})=>({id,kind,name:id,summary:'已知记录',status:'已知',certainty:'confirmed',sourceVersion:4,fields:[],relatedIds:[],...extra});
const person=record('person:acen','person',{fields:[field('location','修表铺')]});
const watch=record('item:watch','item',{name:'唐棠的怀表',fields:[field('owner','唐棠'),field('custodian','店铺'),field('location','工作台')]});
const state={version:4,location:'修表铺',inventory:[]};

test('surroundings require current confirmed evidence; old and reported people stay in records',()=>{
  const objects=[person,{...person,id:'person:old',sourceVersion:3},{...person,id:'person:status-only',locationVersion:3},{...person,id:'person:rumor',certainty:'reported'},watch,record('item:here','item',{fields:[field('location','修表铺')]}),record('location:old','location',{summary:'曾到达'})];
  const situation={objects,currentVersion:4,currentLocation:'修表铺'},before=JSON.stringify(situation);
  const view=aroundObjects({situation,state});
  assert.deepEqual(view.people.map(o=>o.id),['person:acen']);
  assert.deepEqual(view.items.map(o=>o.id),['item:here']);
  assert.deepEqual(view.exits,[]);
  assert.equal(JSON.stringify(situation),before);
  const html=aroundView({situation,state});
  assert.doesNotMatch(html,/person:old|person:rumor|item:watch|location:old/);
});

test('inventory separates actual carriage from known storage and preserves ownership',()=>{
  const key=record('item:key','item',{name:'钥匙',fields:[field('custodian','你')]}),held={...watch,fields:[field('owner','唐棠'),field('custodian','你'),field('location','随身')]};
  const situation={objects:[watch,key,record('item:unknown','item')]};
  const groups=inventoryGroups({situation,state:{...state,inventory:['钥匙']}});
  assert.deepEqual(groups.carried.map(o=>o.id),['item:key']);
  assert.deepEqual(groups.elsewhere.map(o=>o.id),['item:watch']);
  assert.deepEqual(groups.unlocated.map(o=>o.id),['item:unknown']);
  assert.equal(inventoryGroups({situation:{objects:[{...held,sourceVersion:3}]},state}).carried.length,0);
  const html=inventoryView({situation:{objects:[held]},state});
  assert.match(html,/唐棠/);assert.match(html,/所有者/);assert.match(html,/保管者/);
  assert.doesNotMatch(html,/属于你|你的财产/);
});

test('a current witnessed person in a detailed sublocation remains available without treating remote references as presence',()=>{
  const dockState={version:2,location:'码头',inventory:[],game:{entities:[{id:'dock',kind:'place',name:'码头'}]}};
  const present=record('person:tangtang','person',{name:'唐棠',status:'在场',sourceVersion:2,locationVersion:2,fields:[field('location','码头登船处附近')],relatedIds:['dock']});
  const objects=[present,{...present,id:'old',locationVersion:1},{...present,id:'reported',certainty:'reported'},{...present,id:'elsewhere',status:'等待登船',fields:[field('location','北方码头')]},{...present,id:'other-place',relatedIds:['another-dock']}];
  const situation={objects,currentVersion:2,currentLocation:'码头'};
  assert.deepEqual(aroundObjects({situation,state:dockState}).people.map(o=>o.id),['person:tangtang']);
  assert.equal(objectActions({object:present,situation,state:dockState})[0].kind,'talk');
});

test('journal does not turn an unanswered request into a player goal',()=>{
  const offered=record('request','agreement',{status:'尚未接受'}),accepted=record('promise','agreement',{status:'已答应'}),declined=record('declined','agreement',{status:'已拒绝'}),ongoing=record('objective','event',{status:'进行中'});
  const situation={objects:[offered,accepted,declined,ongoing]};
  assert.deepEqual(journalConcerns({situation}).map(o=>o.id),['promise']);
  assert.deepEqual(journalConcerns({situation,personal:{objects:{request:{followed:true},promise:{muted:true}}}}).map(o=>o.id),['request']);
  const html=journalView({situation,personal:{notes:[]}});
  assert.doesNotMatch(html,/data-object="request"|data-object="declined"|data-object="objective"/);
});

test('historical or distant objects never offer current touch actions',()=>{
  const situation={objects:[person,watch],currentVersion:4,currentLocation:'修表铺'};
  const remote=objectActions({object:watch,situation,state});
  assert.equal(remote.some(a=>a.kind==='game'||a.label.includes('检查')||a.label.includes('拿起')),false);
  const historical=objectActions({object:person,situation,state,historical:true});
  assert.equal(historical.some(a=>a.kind==='game'||a.kind==='talk'),false);
  const actions=objectActions({object:person,situation,state});
  assert.equal(actions[0].kind,'talk');assert.ok(actions.length<=2);
});

test('only a current validated action reference can execute an object shortcut',()=>{
  const entity={id:'item:watch',kind:'item',name:'唐棠的怀表',detail:'在你身上',status:'携带',value:1,max:null,unit:'只',quote:'唐棠的怀表',sourceVersion:4};
  const action={id:'inspect',label:'检查怀表',input:'仔细检查唐棠的怀表',mode:'attempt',effects:[],destination:null,disabledReason:''};
  const game={schemaVersion:1,entities:[entity],surfaces:[{id:'inventory',kind:'inventory',title:'怀表',description:'',entityIds:[entity.id],links:[],actions:[action],quote:'怀表',version:4}]};
  const s={...state,game,inventory:['唐棠的怀表']},situation={objects:[watch],currentVersion:4,currentLocation:state.location};
  const before=JSON.stringify(s),actions=objectActions({object:watch,situation,state:s,branch:{id:'b1'}});
  assert.deepEqual(actions[0].reference,{branchId:'b1',version:4,surfaceId:'inventory',actionId:'inspect'});
  assert.equal(actions[0].kind,'game');assert.equal(JSON.stringify(s),before);
  assert.equal(objectActions({object:watch,situation,state:s,branch:{id:'b1'},busy:true})[0].disabled,true);
  assert.equal(objectActions({object:watch,situation,state:{...s,version:5},branch:{id:'b1'}}).some(a=>a.kind==='game'&&!a.disabled),false);
});

test('time opens as a query, limits first schedules, and never invents a wait deadline',()=>{
  const objects=Array.from({length:5},(_,i)=>record('arrangement:'+i,'agreement',{status:'尚未答应',fields:[field('scheduledAt','14:40')]}));
  const html=timePanelView({situation:{clock:{label:'午后',precision:'approximate'},objects}});
  assert.doesNotMatch(html,/<form|type="submit"/);
  assert.equal((html.split('<details')[0].match(/data-object="arrangement:/g)||[]).length,3);
  assert.match(html,/data-action="play-time-mode"/);
  assert.throws(()=>timeControlFromInput({mode:'until',goal:'唐棠来店里'}),/最晚等到什么时候/);
  assert.throws(()=>timeControlFromInput({mode:'until',untilType:'time',goal:'唐棠来店里'}),/最晚等到什么时候/);
  assert.throws(()=>timeControlFromInput({mode:'skip',goal:'正常开店'}),/最晚/);
  const control=timeControlFromInput({mode:'until',goal:'唐棠来店里',limit:'最多两小时'});
  assert.equal(control.limit,'最多两小时');assert.equal(control.until,'唐棠来店里');
  assert.equal(timeControlFromInput({mode:'short',duration:'15分钟'}).limit,'15分钟');
  assert.equal(timeControlFromInput({mode:'skip',goal:'正常开店三天，不借钱；唐棠来时停下'}).limit,'正常开店三天，不借钱；唐棠来时停下');
});
