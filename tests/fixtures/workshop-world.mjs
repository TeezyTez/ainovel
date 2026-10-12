// Fixed demonstration data from §10 of 方糖_核心游戏交互功能设计_2026-10-12.
// These constructors author explicit proposals; they do not interpret free text,
// call a model, or establish that a real model follows the scenario correctly.
import {createSession, commitTurn, currentState, validateArchive} from '../../src/core.js';

export const WORKSHOP_FIXTURE_NOTICE = '固定演示数据；测试使用手写 proposal 验证状态机制，不是实际模型语义理解或浏览器试玩通过报告。导入后 session.mode=real，自由输入交给已连接的真实模型。';
export const WORKSHOP_CONSTANTS = Object.freeze({day:9,start:'14:00',departure:'14:40',cash:6,repairFee:4,roadMinutes:30,riverMinutes:20,ferryMinutes:15,ferryCost:2,purchaseMinutes:15,springCost:3,dailyExpense:1});
export const placeNames = Object.freeze({shop:'修表铺',materials:'材料铺',market:'市集',river:'河岸',dock:'码头',southFerry:'南街渡口',northFerry:'码头渡口',city:'雨港'});
export const quote = Object.freeze({
  clock:'墙上的挂钟指着初秋第9日 14:00。',
  cash:'你清点过钱袋，现金有6银币；你的腿脚没有影响走路的不适。',
  watch:'唐棠的怀表有1只，秒针已经走稳；表属于唐棠，目前由店铺保管，放在修表铺的工作台上。',
  request:'刚离开的船员捎来唐棠的原话：“我坐14:40那班船，能麻烦你把表送到码头吗？”你尚未答应送表。',
  fee:'先前说好的修理费是4银币，交还怀表时收取，目前尚未收款。',
  acen:'阿岑就在修表铺收拾工具，抬头说：“店里我可以先看着。”',
  geography:'修表铺、材料铺、市集、河岸、码头、南街渡口和码头渡口都在雨港，是你熟悉的地方。',
  directions:'材料铺位于修表铺北面。市集位于材料铺东面。河岸位于修表铺东面。码头位于河岸东北面。南街渡口位于修表铺南面。码头渡口位于码头南面。',
  connections:'修表铺与材料铺之间的街道、材料铺与市集之间的街道、市集与码头之间的大路、修表铺与河岸之间的小路、河岸与码头之间的石阶、修表铺与南街渡口之间的街道、码头渡口与码头之间的步道都可以双向通行；南街渡口与码头渡口之间有双向摆渡。',
  road:'从修表铺沿市集大路经过材料铺和市集到码头，全程约30分钟，不花钱，路面平坦；途中采购另计时间。',
  river:'从修表铺沿河岸小路经过河岸到码头，全程约20分钟，不花钱，石阶湿滑；你今天走这条路没有额外阻碍。',
  ferry:'从修表铺乘摆渡经过南街渡口和码头渡口到码头，全程约15分钟，费用总共2银币，已包含两端步行、当前班次候船和下船时间。',
  purchase:'材料铺的主发条每根3银币，顺路采购另需15分钟；大路加采购总共45分钟，现在出发预计14:45到码头，比唐棠说的14:40晚。',
  north:'你听船员说北方港区在雨港北方，目前只知道大致方向，没有掌握具体路线。',
  quiet:'另一座待修的座钟还摆在修表铺柜台，摆锤偶尔擦到木壳；你可以先研究它。'
});

export const gameEntity=(id,kind,name,quoteText,{value=null,status='已知',detail='',unit=''}={})=>({id,kind,name,detail,status,value,max:null,unit,quote:quoteText});
const labels={owner:'所有者',custodian:'保管者',location:'位置',amount:'数量',unit:'单位',source:'来源',role:'身份',scheduledAt:'安排',deadline:'期限',condition:'条件',outcome:'结果',occurredAt:'发生时间',learnedAt:'获知时间',duration:'耗时',purpose:'用途'};
export const experienceObject=(id,kind,name,quoteText,{status='已知',certainty='confirmed',summary=quoteText,fields={},relatedIds=[]}={})=>({id,kind,name,summary,status,certainty,fields:Object.entries(fields).map(([key,value])=>({key,label:labels[key]??key,value:String(value)})),relatedIds,quote:quoteText});
export const experienceReceipt=(label,prose,{elapsed='',objects=[],stop=null,folded=[]}={})=>({clock:{label,elapsed,precision:'exact',quote:prose},objects,stop:stop?{reason:stop,quote:prose}:null,folded});
export const attemptAction=(id,label,input)=>({id,label,input,mode:'attempt',effects:[],destination:null,disabledReason:''});
export const applyAction=(id,label,input,effects)=>({id,label,input,mode:'apply',effects,destination:null,disabledReason:''});
export const interactionSurface=(id,title,entityIds,actions,quoteText)=>({id,kind:'interaction',title,description:'根据眼前情况可以采取的行动',entityIds,links:[],actions,quote:quoteText});
export const watchRecord=(quoteText,{custodian='店铺',location='修表铺',status='店铺保管',amount=1}={})=>experienceObject('pocketwatch','item','唐棠的怀表',quoteText,{status,fields:{owner:'唐棠',custodian,location,amount,unit:'只'},relatedIds:['person:tangtang']});
export const requestRecord=(quoteText,status='尚未接受',fields={})=>experienceObject('delivery','agreement','送表请求',quoteText,{status,certainty:status==='尚未接受'?'reported':'confirmed',fields:{source:'唐棠托船员的口信',scheduledAt:'初秋第9日 14:40离港',...fields},relatedIds:['person:tangtang','pocketwatch']});
export const personRecord=(id,name,quoteText,{location='修表铺',status='在场',certainty='confirmed',fields={}}={})=>experienceObject(`person:${id}`,'person',name,quoteText,{status,certainty,fields:{location,...fields}});

function route(id,label,minutes,via,cost,quoteText){return {id,from:'shop',to:'dock',label,detail:quoteText,via,minutesMin:minutes,minutesMax:minutes,costs:cost?[{entityId:'cash',amount:cost}]:[],includesWaiting:true,quote:quoteText};}
export function workshopRoutes(){return [route('road','市集大路',30,['materials','market'],0,quote.road),route('river','河岸小路',20,['river'],0,quote.river),route('ferry','摆渡',15,['southFerry','northFerry'],2,quote.ferry)];}
function workshopSpatial(){
  const sites=Object.entries(placeNames).map(([id])=>({id,terrain:id==='city'?'region':['river','southFerry','northFerry'].includes(id)?'water':['shop','materials'].includes(id)?'building':'landmark',parentId:id==='city'?null:'city',quote:quote.geography}));
  const compass=[['shop','materials','N'],['materials','market','E'],['shop','river','E'],['river','dock','NE'],['shop','southFerry','S'],['dock','northFerry','S']];
  const connections=[['shop','materials'],['materials','market'],['market','dock'],['shop','river'],['river','dock'],['shop','southFerry'],['southFerry','northFerry'],['northFerry','dock']];
  const relation=(from,to,kind,bearing,quoteText)=>({id:`${kind}-${from}-${to}`,from,to,kind,bearing,distanceMeters:null,passage:kind==='route'?'open':'unknown',bidirectional:kind==='route',label:kind==='route'?'已知通路':'相对方位',quote:quoteText});
  return {sites,relations:[...compass.map(([from,to,bearing])=>relation(from,to,'relative',bearing,quote.directions)),...connections.map(([from,to])=>relation(from,to,'route',null,quote.connections))]};
}

export function shopActions(quoteText=quote.watch){return interactionSurface('workbench','工作台',['pocketwatch'],[
  applyAction('take-watch','拿起怀表','拿起唐棠的怀表。',[{entityId:'pocketwatch',delta:0,status:'随身保管'}]),
  attemptAction('inspect-watch','仔细检查','仔细检查唐棠的怀表。')
],quoteText);}
export function deliveryActions(quoteText){return interactionSurface('handover','当面交还',['pocketwatch','cash'],[
  applyAction('deliver-and-collect','交还怀表，收取4银币','把唐棠的怀表交给她，收之前约好的4银币修理费。',[{entityId:'pocketwatch',delta:-1,status:'已归还'},{entityId:'cash',delta:4,status:null}])
],quoteText);}

export function workshopWorld({经营=false}={}){
  const opening=经营?'午后的修表铺很安静。唐棠先前约好了两天后来取表，你与阿岑正整理今天的修理单。':'怀表的秒针终于走稳了。船员刚刚送来唐棠的口信：“我坐14:40那班船。能麻烦你把表送到码头吗？”阿岑抬起头：“店里我可以先看着。”';
  return {id:经营?'workshop-operation-check':'workshop-delivery-check',version:1,title:经营?'雨港修表铺·平静经营':'雨港修表铺·送表',location:'修表铺',identity:'修表铺店主',opening,description:'独立固定演示档，来自2026-10-12核心游戏交互设计第10章。',tags:['生活','经营'],rules:[
    '本世界是固定演示数据，不代表所有故事规则。玩家扮演店主，自由输入由真实模型理解，不以关键词替代语义。',
    经营?'开始于初秋第7日14:00；唐棠约定两天后的第9日午后来取表，固定变体中在第9日14:00到店。':'开始于初秋第9日14:00；送表请求尚未接受。唐棠的14:40离港安排是船员转述；本演示无临时延误，固定事件为14:40离港。',
    '现金6银币；唐棠的怀表1只，属于唐棠，已修好，在修表铺工作台，由店铺保管，未随身携带。修理费已约定4银币，尚未收款。',
    '阿岑目前在修表铺，口信船员已离开；玩家无影响步行的身体异常。人物说法保留来源；未亲见、无回报时不得显示人物实时位置或结果。',
    '修表铺到码头：市集大路30分钟0银币，经过材料铺和市集；河岸小路20分钟0银币；摆渡15分钟2银币，已含两端步行和候船，不增收隐藏费用。报价按当前条件重新核对。',
    '材料铺采购主发条固定3银币，额外15分钟。大路采购总45分钟，14:45晚于离港时间：在执行前提示并等待玩家决定，不能到达才首次说明。',
    '一次拿起或交还物品在本档不跨越分钟刻度。地图预览不移动也不扣钱；前往仅授权移动，不表示交表或收款。按已有物品事实提供当前动作。',
    '代送先处理阿岑回应，再分别成立拿表、出发与交付；固定愿意变体可以让阿岑同意，但请求本身不代表完成。玩家留下看店，直到回报才得知结果。',
    '拒绝送表后保留怀表与正常生活；不要将玩家提出改期当作唐棠已同意，不制造强制危机或结束故事。',
    '平静经营固定日常支出每整天1银币。最多三天且唐棠来访时停的授权，在第二天实际来访处停下，仅结算两天2银币，不借款，不处理第三天，不代做关键交谈、交表或收款。',
    '条件等待必须有明确上限；没有来人时可到上限正常结束，不强制制造事件。时间推进只按已授权行为与实际停点。'
  ],characters:[{id:'acen',name:'阿岑',public:'修表铺学徒，开局在店里收拾工具。',secret:''},{id:'tangtang',name:'唐棠',public:'将怀表交给店铺修理的客人，约定修理费4银币。',secret:''}]};
}

export function fixedProposal(session,requestId,prose,{events=[],experience=null,game=null,gameAction}={}){
  return {requestId,baseVersion:currentState(session).version,prose,events,experience,game,...(gameAction?{gameAction}:{}),suggestions:[],ended:false};
}

export function createWorkshopFixture({operation=false}={}){
  const world=workshopWorld({经营:operation}),session=createSession(world,{name:'店主'},'real');
  session.preferences.participation='act';
  const clock=operation?'墙上的挂钟指着初秋第7日 14:00。':quote.clock;
  const request=operation?'唐棠先前与你约好两天后的初秋第9日午后来修表铺取表；到时由你亲自接待。':quote.request;
  const expense='账本写明，照常开店每整天的日常支出是1银币，目前没有借款。';
  const prose=[clock,quote.watch,quote.cash,request,quote.fee,quote.acen,quote.quiet,quote.geography,quote.directions,quote.connections,quote.road,quote.river,quote.ferry,operation?expense:quote.purchase,quote.north].join('\n\n');
  const entities=[...Object.entries(placeNames).map(([id,name])=>gameEntity(id,'place',name,quote.geography,{status:id==='shop'?'当前所在':'已到访'})),gameEntity('cash','meter','现金',quote.cash,{value:6,unit:'银币',status:'随身'}),gameEntity('pocketwatch','item','唐棠的怀表',quote.watch,{value:1,unit:'只',status:'店铺保管',detail:'已修好，属于唐棠；由店铺保管，在工作台上。'}),gameEntity('deskclock','item','待修的座钟',quote.quiet,{status:'待检查',detail:'修表铺柜台上另一件平静的修理工作。'})];
  const objects=[watchRecord(quote.watch),experienceObject('cash','resource','现金',quote.cash,{fields:{owner:'你',custodian:'你',location:'随身',amount:6,unit:'银币'}}),personRecord('acen','阿岑',quote.acen),personRecord('tangtang','唐棠',request,{location:operation?'尚未确认':'据口信，将到码头登船',status:'未在现场',certainty:'reported',fields:{source:operation?'先前约定':'船员转述'}}),operation?experienceObject('collection','agreement','到店取表的约定',request,{status:'已约定',fields:{scheduledAt:'初秋第9日午后',source:'先前当面约定'},relatedIds:['person:tangtang','pocketwatch']}):requestRecord(request),experienceObject('repair-fee','agreement','修理费',quote.fee,{status:'已约定',fields:{amount:4,unit:'银币',condition:'交还怀表时收取',outcome:'尚未收款'}}),experienceObject('deskclock','item','待修的座钟',quote.quiet,{status:'待检查',fields:{location:'修表铺',custodian:'店铺'}}),experienceObject('north-report','location','北方港区',quote.north,{certainty:'reported',status:'只知大致方向',fields:{location:'雨港北方，具体位置不明',source:'船员转述'}})];
  const quietSurface=interactionSurface('quiet-work','柜台上的座钟',['deskclock'],[attemptAction('study-clock','研究座钟','研究柜台上待修的座钟，先看看摆锤为什么擦到木壳。')],quote.quiet);
  commitTurn(session,world,'回到修表铺，确认眼前的情况。',fixedProposal(session,'workshop-initial',prose,{experience:experienceReceipt(operation?'初秋第7日 14:00':'初秋第9日 14:00',clock,{objects}),game:{entities,surfaces:[shopActions(),quietSurface],spatial:workshopSpatial(),journeys:{routes:workshopRoutes(),transit:null}}}));
  const archive={schemaVersion:1,worlds:[world],sessions:[session]};validateArchive(archive);
  return {world,session,archive};
}
