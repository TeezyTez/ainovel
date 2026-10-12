import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGame,resolveGameAction} from '../src/game-state.js';
import {createSession,getBranch,commitTurn,currentState,validateArchive,forkBranch} from '../src/core.js';
import * as journey from '../src/journey-state.js';

const quote='修表铺到码头可走河岸小路，全程20分钟；或坐摆渡，全程15分钟，已含等船，费用2银币。你有现金6银币。现在是第9日14:00。';
const entity=(id,kind,name,value=null)=>({id,kind,name,value,max:null,unit:id==='cash'?'银币':'',detail:'',status:'已知',quote});
const route=(id,label,minutes,cost=0)=>({id,from:'shop',to:'dock',label,detail:'沿途已有道路',via:[],minutesMin:minutes,minutesMax:minutes,costs:cost?[{entityId:'cash',amount:cost}]:[],includesWaiting:true,quote});
const world={id:'journey-world',version:1,title:'送表',location:'修表铺',identity:'店主',opening:quote,rules:[],characters:[]};
export function journeyFixture(){
 const s=createSession(world,{},'real');
 commitTurn(s,world,'查看路线',{requestId:'setup',baseVersion:0,prose:quote,events:[],experience:{clock:{label:'第9日14:00',elapsed:'',precision:'exact',quote},objects:[],stop:null,folded:[]},game:{entities:[entity('shop','place','修表铺'),entity('dock','place','码头'),entity('bank','place','河岸'),entity('cash','meter','现金',6)],surfaces:[],journeys:{routes:[route('riverside','河岸小路',20),route('ferry','摆渡',15,2)],transit:null}}});
 return {s,world,ref:id=>({branchId:s.activeBranch,version:currentState(s).version,surfaceId:'journeys',actionId:id})};
}
function arrive(f,id='ferry',extra={}){
 const before=currentState(f.s),receipt=resolveGameAction(before,f.ref(id),{branchId:f.s.activeBranch}),minutes=id==='ferry'?15:20;
 const prose=`你到了码头，花了${minutes}分钟。现在是第9日14:${minutes}。${id==='ferry'?'付了2银币，现金还有4银币。':''}`;
 return {requestId:'travel',baseVersion:before.version,prose,events:[{type:'location',value:'码头',visibility:'player'}],gameAction:receipt,experience:{clock:{label:`第9日14:${minutes}`,elapsed:`${minutes}分钟`,precision:'exact',quote:prose},objects:[],stop:null,folded:[]},game:{entities:[],surfaces:[],journeys:{routes:[],transit:{routeId:id,locationId:'dock',completed:true,elapsedMinutes:minutes,paidCosts:id==='ferry'?[{entityId:'cash',amount:2}]:[],quote:prose}}},...extra};
}
test('route selection is a read-only quote and committed arrival settles money and time together',()=>{
 const f=journeyFixture(),before=JSON.stringify(f.s),receipt=resolveGameAction(currentState(f.s),f.ref('ferry'),{branchId:f.s.activeBranch});
 assert.equal(receipt.mode,'journey');assert.equal(JSON.stringify(f.s),before);
 commitTurn(f.s,world,receipt.input,arrive(f));const state=currentState(f.s);
 assert.equal(state.location,'码头');assert.equal(state.time,'第9日14:15');assert.equal(state.game.entities.find(e=>e.id==='cash').value,4);
 assert.throws(()=>commitTurn(f.s,world,receipt.input,arrive(f)),/过期|旧回合|已经|不存在|当前位置/);
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[f.s]}));
});
test('stale state, insufficient funds and changed body conditions cannot execute an old quote',()=>{
 const f=journeyFixture(),state=currentState(f.s);assert.throws(()=>resolveGameAction(state,{...f.ref('ferry'),version:0},{branchId:f.s.activeBranch}));
 const poor=structuredClone(state);poor.game.entities.find(e=>e.id==='cash').value=1;assert.throws(()=>resolveGameAction(poor,f.ref('ferry'),{branchId:f.s.activeBranch}),/不足/);
 const injured=structuredClone(state);injured.game.entities.push({...entity('ankle','meter','脚伤'),status:'扭伤',sourceVersion:state.version});assert.equal(journey.journeyOptions(injured,'dock')[0].available,false);
});
test('interrupted trip commits only actual time, payment and waypoint, not the destination',()=>{
 const f=journeyFixture(),p=arrive(f,'riverside');p.prose='走了8分钟，你在河岸停下。现在是第9日14:08。';p.events[0].value='河岸';p.experience.clock={label:'第9日14:08',elapsed:'8分钟',precision:'exact',quote:p.prose};p.game.journeys.transit={routeId:'riverside',locationId:'bank',completed:false,elapsedMinutes:8,paidCosts:[],quote:p.prose};
 commitTurn(f.s,world,p.gameAction.input,p);assert.equal(currentState(f.s).location,'河岸');assert.equal(currentState(f.s).game.journeys.transit.completed,false);
 forkBranch(f.s,getBranch(f.s).turns[0].id,'重走');assert.equal(currentState(f.s).location,'修表铺');assert.equal(currentState(f.s).game.entities.find(e=>e.id==='cash').value,6);
});
test('failed result cannot teleport, overcharge, fake clock or silently hand over an item',()=>{
 for(const mutate of [p=>p.game.journeys.transit.locationId='shop',p=>p.game.journeys.transit.paidCosts[0].amount=3,p=>p.experience.clock.label='第9日15:15',p=>p.experience.clock.label='第10日14:15',p=>p.events.push({type:'item-remove',value:'怀表',visibility:'player'})]){
  const f=journeyFixture(),before=JSON.stringify(f.s),p=arrive(f);mutate(p);assert.throws(()=>commitTurn(f.s,world,p.gameAction.input,p));assert.equal(JSON.stringify(f.s),before);
 }
});

test('a carried ticket pays atomically and is removed from the legacy inventory when exhausted',()=>{
 const f=journeyFixture(),q=quote+'你拿到船票1张，从修表铺坐摆渡到码头全程15分钟，费用船票1张。';
 const ticket={...entity('ticket','item','船票',1),unit:'张',quote:q};
 commitTurn(f.s,world,'拿票',{requestId:'ticket',baseVersion:1,prose:q,events:[{type:'item-add',value:'船票',visibility:'player'}],game:{entities:[ticket],surfaces:[],journeys:{routes:[{...route('ferry','摆渡',15),costs:[{entityId:'ticket',amount:1}],quote:q}],transit:null}}});
 const p=arrive(f);p.prose+='用掉船票1张。';p.game.journeys.transit.paidCosts=[{entityId:'ticket',amount:1}];p.game.journeys.transit.quote=p.prose;
 commitTurn(f.s,world,p.gameAction.input,p);assert.deepEqual(currentState(f.s).inventory,[]);assert.equal(currentState(f.s).game.entities.find(e=>e.id==='ticket').value,0);
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[f.s]}));
});
test('route records survive unrelated turns; clock changes invalidate old estimates and public projection is detached',()=>{
 const f=journeyFixture(),state=currentState(f.s),game=advanceGame(state.game,null,2);assert.equal(game.journeys.routes.length,2);
 const next={...state,version:2,game,experience:{...state.experience,clock:{...state.experience.clock,label:'第9日14:05'}}};assert.equal(journey.journeyOptions(next,'dock')[0].available,false);
 const options=journey.journeyOptions(state,'dock');options[0].route.label='changed';assert.equal(state.game.journeys.routes[0].label,'河岸小路');
});

test('travel cannot charge an unquoted resource through an ordinary entity update',()=>{
 const f=journeyFixture(),p=arrive(f,'riverside'),before=JSON.stringify(f.s);
 p.prose+='另外付了5银币，现金剩1银币。';p.game.entities=[{...entity('cash','meter','现金',1),quote:p.prose}];
 assert.throws(()=>commitTurn(f.s,world,p.gameAction.input,p),/费用|资源|授权/);assert.equal(JSON.stringify(f.s),before);
});

test('stored tickets and newly learned physical conditions cannot be ignored by a route offer',()=>{
 const f=journeyFixture(),state=structuredClone(currentState(f.s)),ticket={...entity('ticket','item','船票',1),unit:'张',sourceVersion:state.version};
 state.game.entities.push(ticket);state.game.journeys.routes[1].costs=[{entityId:'ticket',amount:1}];
 // Re-quote for these exact meters, isolating availability from condition expiry.
 state.game.journeys.routes[1].basis.conditions=state.game.journeys.routes[0].basis.conditions;
 assert.equal(journey.journeyOptions(state,'dock')[1].available,false);
 assert.match(journey.journeyOptions(state,'dock')[1].reason,/携带/);
 const injured=structuredClone(currentState(f.s));injured.version++;injured.experience.objects.push({id:'injury',kind:'resource',status:'脚伤',sourceVersion:injured.version,fields:[{key:'condition',value:'步行明显变慢'}]});
 assert.equal(journey.journeyOptions(injured,'dock')[0].available,false);assert.match(journey.journeyOptions(injured,'dock')[0].reason,/重新核对/);
});

test('other characters may withdraw a request during travel, but arrival cannot accept or fulfil it',()=>{
 for(const status of ['已取消','已约定','已履行']){
  const f=journeyFixture(),q='送表请求尚未接受。',request={id:'request',kind:'agreement',name:'送表请求',summary:q,status:'尚未接受',certainty:'reported',fields:[],relatedIds:[],quote:q};
  commitTurn(f.s,world,'听口信',{requestId:'request',baseVersion:1,prose:q,events:[],experience:{clock:null,objects:[request],stop:null,folded:[]}});
  const p=arrive(f);p.prose+='唐棠撤回了送表请求，表示回来自己取。';p.experience.objects=[{...request,status,quote:'唐棠撤回了送表请求，表示回来自己取。'}];
  const commit=()=>commitTurn(f.s,world,p.gameAction.input,p);
  if(status==='已取消'){assert.doesNotThrow(commit);assert.equal(currentState(f.s).experience.objects.find(o=>o.id==='request').status,status);}
  else assert.throws(commit,/约定/);
 }
});

test('a quoted journey across midnight advances exactly one day and survives archive replay',()=>{
 const f=journeyFixture(),q=quote+'现在是第9日23:55。';
 commitTurn(f.s,world,'夜间重新核对',{requestId:'night',baseVersion:1,prose:q,events:[],experience:{clock:{label:'第9日23:55',elapsed:'',precision:'exact',quote:q},objects:[],stop:null,folded:[]},game:{entities:[],surfaces:[],journeys:{routes:[{...route('ferry','摆渡',15,2),quote:q}],transit:null}}});
 const p=arrive(f);p.prose='你到了码头，花了15分钟。现在是第10日00:10。付了2银币，现金剩4银币。';p.game.journeys.transit.quote=p.prose;p.experience.clock={label:'第10日00:10',elapsed:'15分钟',precision:'exact',quote:p.prose};
 commitTurn(f.s,world,p.gameAction.input,p);assert.equal(currentState(f.s).time,'第10日00:10');assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[f.s]}));
});
