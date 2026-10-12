// Deterministic state-contract tests for design §10 / §13.
// All narrative proposals below are explicitly authored fixtures. No model is
// called and these tests are NOT evidence of real natural-language understanding,
// actual browser interaction, network reconnect handling, or visual acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commitTurn,currentState,getBranch,validateArchive,forkBranch} from '../src/core.js';
import {resolveGameAction,gameActionForInput} from '../src/game-state.js';
import {journeyOptions} from '../src/journey-state.js';
import {publicSituation} from '../src/experience-state.js';
import {aroundObjects,inventoryGroups,objectActions,journalConcerns} from '../src/play-views.js';
import {projectSpatialMap} from '../src/spatial-state.js';
import {publicArchive} from '../src/server-public-archive.mjs';
import {createWorkshopFixture,fixedProposal,experienceReceipt,experienceObject,gameEntity,watchRecord,requestRecord,personRecord,deliveryActions,interactionSurface,attemptAction,shopActions} from './fixtures/workshop-world.mjs';

const state=f=>currentState(f.session);
const branch=f=>getBranch(f.session);
const cash=f=>state(f).game.entities.find(e=>e.id==='cash').value;
const object=(f,id)=>state(f).experience.objects.find(o=>o.id===id);
const field=(o,key)=>o.fields.find(f=>f.key===key)?.value;
const ref=(f,surfaceId,actionId)=>({branchId:f.session.activeBranch,version:state(f).version,surfaceId,actionId});
const receipt=(f,surfaceId,actionId)=>resolveGameAction(state(f),ref(f,surfaceId,actionId),{branchId:f.session.activeBranch});
const event=(type,value,extra={})=>({type,value,visibility:'player',...extra});
const commit=(f,input,proposal)=>commitTurn(f.session,f.world,input,proposal);
const situation=f=>({...publicSituation(branch(f),f.world),currentVersion:state(f).version,currentLocation:state(f).location});
const assertArchive=f=>assert.doesNotThrow(()=>validateArchive(JSON.parse(JSON.stringify(f.archive))));

function prepareCarrier(f){
  const prose='你答应把表送到码头，拿起工作台上1只唐棠的怀表，收进随身的软布袋。怀表仍属于唐棠，现在由你保管。初秋第9日 14:00，阿岑留在修表铺。';
  commit(f,'我答应送表，并拿上怀表。',fixedProposal(f.session,'accept-and-take',prose,{events:[event('item-add','唐棠的怀表')],experience:experienceReceipt('初秋第9日 14:00',prose,{objects:[watchRecord(prose,{custodian:'你',location:'随身',status:'随身保管'}),requestRecord(prose,'已接受'),personRecord('acen','阿岑',prose)]}),game:{entities:[gameEntity('pocketwatch','item','唐棠的怀表',prose,{value:1,unit:'只',status:'随身保管'})],surfaces:[]}}));
}
function arrivalProposal(f,routeId){
  const r=receipt(f,'journeys',routeId),minutes=r.journey.minutesMin,paid=r.journey.costs.length>0;
  const prose=`你沿${r.journey.label}抵达码头，路上共用${minutes}分钟。现在是初秋第9日 14:${minutes}。${paid?'摆渡已付2银币，现金剩4银币。':'现金仍有6银币。'}你仍带着1只唐棠的怀表，唐棠在登船处排队；交表时按先前约定收4银币修理费。`;
  return fixedProposal(f.session,`arrival-${routeId}`,prose,{gameAction:r,events:[event('location','码头')],experience:experienceReceipt(`初秋第9日 14:${minutes}`,prose,{elapsed:`${minutes}分钟`,objects:[personRecord('tangtang','唐棠',prose,{location:'码头'})]}),game:{entities:[],surfaces:[deliveryActions(prose)],journeys:{routes:[],transit:{routeId,locationId:'dock',completed:true,elapsedMinutes:minutes,paidCosts:r.journey.costs,quote:prose}}}});
}
function deliver(f){
  const r=receipt(f,'handover','deliver-and-collect'),nextCash=cash(f)+4,label=state(f).time;
  const prose=`你将唐棠的怀表交还给唐棠，她当面付清4银币修理费。现金现在有${nextCash}银币，你持有的唐棠的怀表数量为0；怀表由唐棠自己保管，送表与收款都已完成。仍是${label}。`;
  const p=fixedProposal(f.session,'delivery-and-fee',prose,{gameAction:r,events:[event('item-remove','唐棠的怀表')],experience:experienceReceipt(label,prose,{objects:[watchRecord(prose,{custodian:'唐棠',location:'唐棠身上',status:'已归还',amount:0}),requestRecord(prose,'已履行'),experienceObject('repair-fee','agreement','修理费',prose,{status:'已履行',fields:{outcome:'已收到4银币'}}),personRecord('tangtang','唐棠',prose,{location:'码头'})]}),game:{entities:[],surfaces:[]}});
  commit(f,r.input,p);return p;
}

test('fixed real-mode opening: custody, pending request, confirmed people and read-only public routes',()=>{
  const f=createWorkshopFixture(),before=JSON.stringify(f.session),s=state(f),known=situation(f);
  assert.equal(f.session.mode,'real');assert.equal(s.time,'初秋第9日 14:00');assert.equal(s.location,'修表铺');assert.equal(cash(f),6);
  assert.equal(field(object(f,'pocketwatch'),'owner'),'唐棠');assert.equal(field(object(f,'pocketwatch'),'custodian'),'店铺');assert.deepEqual(s.inventory,[]);
  assert.equal(object(f,'delivery').status,'尚未接受');assert.equal(object(f,'person:acen').certainty,'confirmed');
  assert.deepEqual(aroundObjects({state:s,situation:known}).people.map(p=>p.id),['person:acen']);
  assert.deepEqual(inventoryGroups({state:s,situation:known}).carried,[]);
  assert.ok(!journalConcerns({situation:known}).some(o=>o.id==='delivery'));
  const offers=journeyOptions(s,'dock');assert.deepEqual(offers.map(o=>[o.route.id,o.route.minutesMin,o.route.costs[0]?.amount??0,o.arrival]),[['road',30,0,'14:30'],['river',20,0,'14:20'],['ferry',15,2,'14:15']]);
  for(const o of offers){assert.equal(o.available,true);receipt(f,'journeys',o.route.id);}
  const map=projectSpatialMap(s.game,{scope:'city',anchorId:'shop'});assert.equal(map.positions.size,7);assert.equal(map.unplaced.length,0);
  assert.equal(projectSpatialMap(s.game,{scope:null}).places[0].id,'city');
  const actions=objectActions({object:known.objects.find(o=>o.id==='pocketwatch'),situation:known,state:s,branch:branch(f)});assert.equal(actions[0].label,'拿起怀表');
  assert.equal(gameActionForInput(s,'为什么你认为我已经答应送表？',branch(f).id),undefined);
  assert.equal(JSON.stringify(f.session),before);assertArchive(f);
});

test('taking the watch is a current action and does not implicitly accept the request',()=>{
  const f=createWorkshopFixture(),r=receipt(f,'workbench','take-watch');
  const prose='你拿起1只唐棠的怀表，放进随身布袋；所有者仍是唐棠，现在由你保管。送表请求还没答应。仍是初秋第9日 14:00。';
  commit(f,r.input,fixedProposal(f.session,'take-only',prose,{gameAction:r,events:[event('item-add','唐棠的怀表')],experience:experienceReceipt('初秋第9日 14:00',prose,{objects:[watchRecord(prose,{custodian:'你',location:'随身',status:'随身保管'})]}),game:{entities:[],surfaces:[]}}));
  assert.equal(object(f,'delivery').status,'尚未接受');assert.equal(state(f).time,'初秋第9日 14:00');assert.equal(cash(f),6);
  assert.equal(inventoryGroups({state:state(f),situation:situation(f)}).carried[0].id,'pocketwatch');assertArchive(f);
});

test('A / A05 A11: one explicitly authored compound proposal carries the watch along the river; arrival does not deliver',()=>{
  const f=createWorkshopFixture();receipt(f,'journeys','river'); // Preview is read-only, not authority to take an item.
  const prose='你答应送表，拿起1只唐棠的怀表收进随身布袋，再沿河岸小路走了20分钟到达码头。现在是初秋第9日 14:20，现金仍有6银币。唐棠正在登船处排队；怀表仍属于唐棠，由你保管，交表时按约收4银币修理费。';
  // A free compound input can authorize both pickup and travel. Do not forge a
  // journey-button receipt: that receipt deliberately authorizes movement only.
  commit(f,'我去送，拿上怀表，沿河岸过去。',fixedProposal(f.session,'compound-river',prose,{events:[event('item-add','唐棠的怀表'),event('location','码头')],experience:experienceReceipt('初秋第9日 14:20',prose,{elapsed:'20分钟',objects:[watchRecord(prose,{custodian:'你',location:'随身',status:'随身保管'}),requestRecord(prose,'已接受'),personRecord('tangtang','唐棠',prose,{location:'码头'})]}),game:{entities:[gameEntity('pocketwatch','item','唐棠的怀表',prose,{value:1,unit:'只',status:'随身保管'})],surfaces:[deliveryActions(prose)],journeys:{routes:[],transit:{routeId:'river',locationId:'dock',completed:true,elapsedMinutes:20,paidCosts:[],quote:prose}}}}));
  assert.equal(state(f).time,'初秋第9日 14:20');assert.equal(state(f).location,'码头');assert.equal(cash(f),6);assert.deepEqual(state(f).inventory,['唐棠的怀表']);assert.equal(object(f,'delivery').status,'已接受');
  const before=JSON.stringify(f.session);assert.equal(aroundObjects({state:state(f),situation:situation(f)}).people[0].id,'person:tangtang');assert.equal(JSON.stringify(f.session),before);
  deliver(f);assert.equal(cash(f),10);assert.deepEqual(state(f).inventory,[]);assert.equal(object(f,'delivery').status,'已履行');assert.equal(field(object(f,'pocketwatch'),'owner'),'唐棠');assert.equal(field(object(f,'pocketwatch'),'custodian'),'唐棠');assertArchive(f);
});

test('B / A06: ferry uses the actual action resolver, charges once, survives archive replay and then collects the fee',()=>{
  const f=createWorkshopFixture();prepareCarrier(f);const p=arrivalProposal(f,'ferry'),oldRef=p.gameAction.reference;
  commit(f,p.gameAction.input,p);assert.equal(state(f).time,'初秋第9日 14:15');assert.equal(cash(f),4);assert.equal(state(f).location,'码头');assert.deepEqual(state(f).inventory,['唐棠的怀表']);
  const before=JSON.stringify(f.session);assert.throws(()=>commit(f,p.gameAction.input,p),/已经提交/);assert.throws(()=>resolveGameAction(state(f),oldRef,{branchId:branch(f).id}),/旧回合/);assert.equal(JSON.stringify(f.session),before);
  const saved=validateArchive(JSON.parse(JSON.stringify(f.archive))),restored={world:saved.worlds[0],session:saved.sessions[0],archive:saved};
  restored.session.updatedAt+=3*86400000;assert.equal(state(restored).time,'初秋第9日 14:15');assert.throws(()=>commit(restored,p.gameAction.input,p),/已经提交/);assert.equal(cash(restored),4);
  const delivered=deliver(restored);assert.equal(cash(restored),8);assert.throws(()=>commit(restored,delivered.gameAction.input,delivered),/已经提交/);assert.equal(cash(restored),8);assertArchive(restored);
});

test('C / A08: the fixed planner warns before confirmation; buying then arriving late preserves the watch',()=>{
  const f=createWorkshopFixture(),initial=structuredClone(state(f));
  const warning='材料铺的主发条每根3银币，采购需要15分钟。市集大路行程30分钟，合计45分钟，预计14:45抵达码头；唐棠说14:40离港。怀表仍在工作台，你可以带上它仍然这样走，或者调整安排。现在仍是初秋第9日 14:00。';
  const choice=interactionSurface('purchase-plan','这次出行的时间',['pocketwatch','cash','materials','dock'],[attemptAction('proceed','带上表，仍然这样走','我知道会晚到，拿上怀表，仍花3银币买主发条，再去码头。'),attemptAction('adjust','调整安排','先不采购，重新安排送表路线。')],warning);
  commit(f,'先去材料铺花不超过3银币买根主发条，再把表送到码头。',fixedProposal(f.session,'purchase-warning',warning,{experience:experienceReceipt('初秋第9日 14:00',warning,{stop:'预计晚于已知船班，等你决定是否仍这样走。'}),game:{entities:[],surfaces:[choice]}}));
  assert.equal(cash(f),initial.game.entities.find(e=>e.id==='cash').value);assert.equal(state(f).location,initial.location);assert.equal(state(f).time,initial.time);assert.deepEqual(state(f).inventory,[]);
  const r=receipt(f,'purchase-plan','proceed');assert.equal(r.mode,'attempt');assert.deepEqual(r.effects,[]);
  const prose='你确认照原安排走，拿上1只唐棠的怀表，在材料铺花3银币买到1根主发条。采购用了15分钟，大路步行用了30分钟，合计45分钟。初秋第9日 14:45，你抵达码头；14:40的船已经离港，唐棠已不在登船处。现金剩3银币，怀表仍由你随身保管，尚未交还。码头值班员正在收起登船绳，可以向他问下次船班。';
  commit(f,r.input,fixedProposal(f.session,'purchase-late-arrival',prose,{gameAction:r,events:[event('item-add','唐棠的怀表'),event('item-add','主发条'),event('location','码头')],experience:experienceReceipt('初秋第9日 14:45',prose,{elapsed:'45分钟',objects:[watchRecord(prose,{custodian:'你',location:'随身',status:'随身保管'}),requestRecord(prose,'未送达',{outcome:'抵达时船已离开；怀表仍由你保管'}),experienceObject('spring','item','主发条',prose,{fields:{owner:'你',custodian:'你',location:'随身',amount:1,unit:'根'}}),personRecord('tangtang','唐棠',prose,{location:'已离港，当前位置未知',status:'已离开',certainty:'reported'})]}),game:{entities:[gameEntity('cash','meter','现金',prose,{value:3,unit:'银币',status:'随身'}),gameEntity('pocketwatch','item','唐棠的怀表',prose,{value:1,unit:'只',status:'随身保管'}),gameEntity('spring','item','主发条',prose,{value:1,unit:'根',status:'随身'} )],surfaces:[interactionSurface('dock-next','码头的下一步',['dock'],[attemptAction('ask-next-boat','询问下一班船','向码头值班员询问下一班船，看看还能怎样联系唐棠。')],prose)],journeys:{routes:[],transit:{routeId:'road',locationId:'dock',completed:true,elapsedMinutes:30,paidCosts:[],quote:prose}}}}));
  assert.equal(state(f).time,'初秋第9日 14:45');assert.equal(cash(f),3);assert.equal(state(f).location,'码头');assert.deepEqual(state(f).inventory,['唐棠的怀表','主发条']);assert.equal(field(object(f,'pocketwatch'),'custodian'),'你');assert.equal(object(f,'delivery').status,'未送达');assert.equal(branch(f).turns.at(-1).ended,false);assertArchive(f);
});

test('D / A09: requesting delegation, acceptance, departure and reported completion are separate facts',()=>{
  const f=createWorkshopFixture();
  const request='你请阿岑替你送表，说他若不愿意就算了，自己留下看店。阿岑放下工具，还没有作答。唐棠的怀表仍在工作台，由店铺保管。仍是初秋第9日 14:00。';
  const delegated=(prose,status,fields={})=>experienceObject('delegation','agreement','请阿岑代送',prose,{status,fields:{source:'你当面向阿岑提出',...fields},relatedIds:['person:acen','pocketwatch']});
  commit(f,'我不去，请阿岑替我送。他不愿意就算了，我留下看店。',fixedProposal(f.session,'delegate-request',request,{experience:experienceReceipt('初秋第9日 14:00',request,{objects:[delegated(request,'等待回应'),personRecord('acen','阿岑',request)]})}));
  assert.equal(object(f,'delegation').status,'等待回应');assert.equal(field(object(f,'pocketwatch'),'custodian'),'店铺');assert.equal(state(f).location,'修表铺');
  const accepted='阿岑在修表铺点头：“我愿意替你送，交好后回来告诉你。”他还没拿表，也没有出门。仍是初秋第9日 14:00。';
  commit(f,'等阿岑回应。',fixedProposal(f.session,'delegate-accept',accepted,{experience:experienceReceipt('初秋第9日 14:00',accepted,{objects:[delegated(accepted,'已接受',{outcome:'阿岑已答应，尚未拿表或出发'}),personRecord('acen','阿岑',accepted)]})}));
  assert.equal(object(f,'delegation').status,'已接受');assert.equal(field(object(f,'pocketwatch'),'custodian'),'店铺');
  const departed='阿岑拿起1只唐棠的怀表包好，向你示意后从修表铺出门。怀表仍属于唐棠，现在交由阿岑保管。你留在修表铺看店；阿岑已出发，尚未回报，当前走到哪里你并不知道。仍是初秋第9日 14:00。';
  commit(f,'把表托他带去，我留下看店。',fixedProposal(f.session,'delegate-depart',departed,{experience:experienceReceipt('初秋第9日 14:00',departed,{objects:[delegated(departed,'已受托，尚未回报'),watchRecord(departed,{custodian:'阿岑',location:'交给阿岑时在修表铺，当前位置未知',status:'由阿岑保管'}),personRecord('acen','阿岑',departed,{location:'离店后位置未知',status:'已离开'})]}),game:{entities:[gameEntity('pocketwatch','item','唐棠的怀表',departed,{value:1,unit:'只',status:'由阿岑保管'})],surfaces:[]}}));
  assert.equal(state(f).location,'修表铺');assert.equal(cash(f),6);assert.equal(state(f).game.journeys.transit,null);assert.deepEqual(aroundObjects({state:state(f),situation:situation(f)}).people,[]);
  // A backend-only fact must not update the player's public experience or map.
  const hidden='你在修表铺整理修理单。十分钟过去，仍没收到阿岑的消息。现在是初秋第9日 14:10。';
  f.session.privateLedger=true;
  commit(f,'我继续看店，等有消息再说。',fixedProposal(f.session,'delegate-private-progress',hidden,{events:[{type:'fact',value:'阿岑在河岸路段，已替唐棠暂存码头取件牌。',visibility:'hidden'}],experience:experienceReceipt('初秋第9日 14:10',hidden,{elapsed:'10分钟'})}));
  const view=publicArchive({worlds:[f.world],session:f.session});assert.ok(!JSON.stringify(view).includes('码头取件牌'));assert.equal(currentState(view.session).location,'修表铺');assert.equal(object(f,'delegation').status,'已受托，尚未回报');
  const report='40分钟后，阿岑回到修表铺，把4银币放在柜台：“已经把怀表交还唐棠，她付清修理费后上船了。”现在是初秋第9日 14:50；现金共有10银币，店铺持有的唐棠的怀表数量为0。你直到这次回报才得知送达结果。';
  commit(f,'等阿岑回来向我说明结果，最多等到15:00。',fixedProposal(f.session,'delegate-report',report,{experience:experienceReceipt('初秋第9日 14:50',report,{elapsed:'40分钟',objects:[delegated(report,'已履行',{outcome:'阿岑回店回报：已交还并带回4银币'}),watchRecord(report,{custodian:'唐棠',location:'阿岑回报已交给唐棠',status:'已归还',amount:0}),personRecord('acen','阿岑',report),requestRecord(report,'已履行')]}),game:{entities:[gameEntity('cash','meter','现金',report,{value:10,unit:'银币',status:'随身'}),gameEntity('pocketwatch','item','唐棠的怀表',report,{value:0,unit:'只',status:'已归还'})],surfaces:[]}}));
  assert.equal(state(f).location,'修表铺');assert.equal(cash(f),10);assert.equal(object(f,'delegation').status,'已履行');assert.equal(state(f).game.journeys.transit,null);assertArchive(f);
});

test('E / A14: refusing leaves a quiet current action, keeps custody and does not invent an agreed reschedule',()=>{
  const f=createWorkshopFixture();
  const prose='你请阿岑下次遇见唐棠时转告：今天无法送表，愿意改天在店里交还。唐棠尚未回应改期。唐棠的怀表仍在修表铺工作台，由店铺保管。你转向柜台上待修的座钟，摆锤轻轻擦过木壳；窗外雨声很均匀。仍是初秋第9日 14:00。';
  const surface=interactionSurface('quiet-next','座钟与雨声',['deskclock'],[attemptAction('inspect','检查摆锤','检查待修的座钟，看看摆锤与木壳的间隙。')],prose);
  commit(f,'今天不送了，改天在店里交还。我先研究那座待修的钟。',fixedProposal(f.session,'decline-delivery',prose,{experience:experienceReceipt('初秋第9日 14:00',prose,{objects:[requestRecord(prose,'已拒绝',{outcome:'未承诺送表；改期提议尚待唐棠回应'}),watchRecord(prose)]}),game:{entities:[],surfaces:[surface]}}));
  assert.equal(object(f,'delivery').status,'已拒绝');assert.equal(field(object(f,'pocketwatch'),'custodian'),'店铺');assert.equal(cash(f),6);assert.ok(!journalConcerns({situation:situation(f)}).some(o=>o.id==='delivery'));
  const r=receipt(f,'quiet-next','inspect'),next='你在修表铺把待修的座钟移到灯下，发现摆锤挂片略微偏斜。先调整支架还是记录偏差，都可以慢慢决定。5分钟过去，现在是初秋第9日 14:05。';
  commit(f,r.input,fixedProposal(f.session,'quiet-inspection',next,{gameAction:r,experience:experienceReceipt('初秋第9日 14:05',next,{elapsed:'5分钟',objects:[experienceObject('clock-observation','clue','摆锤挂片偏斜',next)]}),game:{entities:[],surfaces:[interactionSurface('clock-next','继续修理',['deskclock'],[attemptAction('adjust','调整支架','试着调整待修的座钟的支架，观察摆锤。')],next)]}}));
  assert.equal(branch(f).turns.at(-1).ended,false);assert.equal(state(f).location,'修表铺');assert.equal(state(f).game.surfaces[0].actions.length,1);assert.equal(field(object(f,'pocketwatch'),'owner'),'唐棠');assertArchive(f);
});

test('A12 / A16: the separate operation archive stops at the second-day visit without spending the third day',()=>{
  const f=createWorkshopFixture({operation:true});assert.equal(f.session.mode,'real');assert.equal(state(f).time,'初秋第7日 14:00');
  const prose='照常开店两天，第一天日常支出1银币，第二天日常支出1银币，合计2银币，现金从6银币变成4银币，没有借款。现在是初秋第9日 14:00，门铃响起，唐棠站在修表铺门口：“我没来早吧？”你已在来访处停下，第三天还没开始。唐棠的怀表仍由店铺保管；你还没与她交谈、交表或收款。';
  commit(f,'正常开店三天，不借钱。她来取表时停，我自己聊。',fixedProposal(f.session,'operation-stop-day-two',prose,{experience:experienceReceipt('初秋第9日 14:00',prose,{elapsed:'2天',objects:[personRecord('tangtang','唐棠',prose),experienceObject('collection','agreement','到店取表的约定',prose,{status:'来访待接待',fields:{actualAt:'初秋第9日 14:00',outcome:'唐棠到店，等待你亲自接待'}}),experienceObject('expense-day-one','event','第一天日常支出',prose,{fields:{amount:1,unit:'银币',occurredAt:'第7日至第8日'}}),experienceObject('expense-day-two','event','第二天日常支出',prose,{fields:{amount:1,unit:'银币',occurredAt:'第8日至第9日'}})],stop:'唐棠已来访，按你的安排停下，让你亲自接待。',folded:[{id:'two-business-days',title:'这两天的日常记录',summary:'照常开店，两天各支出1银币，没有借款，未结算第三天。',quote:prose}]}),game:{entities:[gameEntity('cash','meter','现金',prose,{value:4,unit:'银币',status:'随身'})],surfaces:[shopActions(prose)]}}));
  assert.equal(state(f).time,'初秋第9日 14:00');assert.equal(cash(f),4);assert.equal(object(f,'repair-fee').status,'已约定');assert.equal(field(object(f,'pocketwatch'),'custodian'),'店铺');assert.equal(state(f).experience.objects.filter(o=>o.id.startsWith('expense-day-')).length,2);assert.ok(!object(f,'expense-day-three'));
  const restored=validateArchive(JSON.parse(JSON.stringify(f.archive)));restored.sessions[0].updatedAt+=10*86400000;assert.equal(currentState(restored.sessions[0]).time,'初秋第9日 14:00');assert.equal(currentState(restored.sessions[0]).experience.stop.reason,state(f).experience.stop.reason);assertArchive(f);
});

test('A13: an explicitly bounded wait can expire peacefully without a visitor or forced crisis',()=>{
  const f=createWorkshopFixture({operation:true});
  const prose='你在修表铺等了30分钟，整理过柜台，又把窗边的水渍擦干。到了约定上限初秋第7日 14:30，唐棠仍没有出现。你可以继续等待，改变安排，或再研究座钟；店里没有发生别的事。';
  commit(f,'留在店里等唐棠，最晚等到今天14:30；没来就停下。',fixedProposal(f.session,'bounded-wait-expired',prose,{experience:experienceReceipt('初秋第7日 14:30',prose,{elapsed:'30分钟',stop:'已经等到14:30，唐棠仍未出现。'}),game:{entities:[],surfaces:[interactionSurface('wait-next','接下来的安排',['shop'],[attemptAction('continue-wait','再等一会儿','再等15分钟，唐棠没来就停下。'),attemptAction('change-plan','改变安排','先不等了，继续研究柜台上的座钟。')],prose)]}}));
  assert.equal(state(f).time,'初秋第7日 14:30');assert.equal(cash(f),6);assert.ok(!aroundObjects({state:state(f),situation:situation(f)}).people.some(p=>p.id==='person:tangtang'));assert.equal(branch(f).turns.at(-1).ended,false);assert.equal(state(f).game.surfaces[0].actions.length,2);assertArchive(f);
});

test('A18: a branch from the fixed opening preserves original route costs and does not inherit another outcome',()=>{
  const f=createWorkshopFixture(),opening=branch(f).turns[0].id,original=branch(f).id;prepareCarrier(f);const p=arrivalProposal(f,'ferry');commit(f,p.gameAction.input,p);deliver(f);
  forkBranch(f.session,opening,'另一种送法');assert.equal(cash(f),6);assert.equal(state(f).location,'修表铺');assert.deepEqual(state(f).inventory,[]);assert.equal(object(f,'delivery').status,'尚未接受');assert.equal(state(f).game.journeys.transit,null);
  assert.equal(f.session.branches.find(b=>b.id===original).turns.at(-1).state.game.entities.find(e=>e.id==='cash').value,8);assertArchive(f);
});
