// Public route offers and atomic travel outcomes. A preview never spends time or money.
const fail=(ok,message)=>{if(!ok)throw new Error(message);};
const key=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const str=(v,max=1600)=>typeof v==='string'&&v.length<=max;
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=525600;
const clone=v=>structuredClone(v);
const canonical=v=>JSON.stringify(v);
export const JOURNEY_SURFACE='$journeys'; // Cannot collide with a legacy surface identifier.
const routeKeys=['id','from','to','label','detail','via','minutesMin','minutesMax','costs','includesWaiting','quote'];
const transitKeys=['routeId','locationId','completed','elapsedMinutes','paidCosts','quote'];
const schemaObj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'},minutes={type:['integer','null'],minimum:0,maximum:525600};
const costsSchema={type:'array',maxItems:4,items:schemaObj({entityId:string,amount:{type:'number'}})};
export const journeysSchema={...schemaObj({routes:{type:'array',maxItems:6,items:schemaObj({id:string,from:string,to:string,label:string,detail:string,via:{type:'array',maxItems:8,items:string},minutesMin:minutes,minutesMax:minutes,costs:costsSchema,includesWaiting:{type:'boolean'},quote:string})},transit:{...schemaObj({routeId:string,locationId:string,completed:{type:'boolean'},elapsedMinutes:minutes,paidCosts:costsSchema,quote:string}),type:['object','null']}}),type:['object','null']};

function costsValid(costs){fail(Array.isArray(costs)&&costs.length<=4&&new Set(costs.map(c=>c.entityId)).size===costs.length,'路线费用格式无效。');for(const c of costs)fail(exact(c,['entityId','amount'])&&key(c.entityId)&&Number.isFinite(c.amount)&&c.amount>0&&c.amount<=1e9,'路线费用必须是明确的正数。');}
function witnessed(value,prose){fail(str(value.quote)&&value.quote.trim(),'出行记录缺少正文依据。');if(prose!==undefined)fail(prose.includes(value.quote),'出行记录缺少本轮正文依据。');}
function amountWitness(quote,amount){return [...quote.matchAll(/\d+(?:\.\d+)?/g)].some(m=>Number(m[0])===amount);}
export function validateJourneys(value,prose,{snapshot=false,entities=[],version=Infinity}={}){
 if(value==null)return;
 fail(exact(value,snapshot?['schemaVersion','routes','transit']:['routes','transit'])&&(!snapshot||value.schemaVersion===1),'出行记录格式无效。');
 fail(Array.isArray(value.routes)&&value.routes.length<=(snapshot?100:6)&&new Set(value.routes.map(r=>r.id)).size===value.routes.length,'路线列表无效。');
 const byId=new Map(entities.map(e=>[e.id,e]));
 for(const r of value.routes){
  fail(exact(r,snapshot?[...routeKeys,'sourceVersion','basis']:routeKeys)&&[r.id,r.from,r.to].every(key)&&r.from!==r.to&&str(r.label,100)&&r.label.trim()&&str(r.detail,600)&&Array.isArray(r.via)&&r.via.length<=8&&r.via.every(key)&&new Set([r.from,...r.via,r.to]).size===r.via.length+2,'路线字段无效。');
  fail((r.minutesMin===null&&r.minutesMax===null)||(integer(r.minutesMin)&&integer(r.minutesMax)&&r.minutesMin<=r.minutesMax),'路线耗时范围无效。');
  fail(typeof r.includesWaiting==='boolean','路线必须说明等待是否计入。');costsValid(r.costs);witnessed(r,prose);
  for(const n of [r.minutesMin,r.minutesMax])if(n!==null)fail(amountWitness(r.quote,n)&&/分钟/.test(r.quote),'路线耗时缺少正文依据，请按分钟记录。');
  for(const c of r.costs)fail(amountWitness(r.quote,c.amount),'路线费用缺少正文依据。');
  if(snapshot){
   fail(Number.isInteger(r.sourceVersion)&&r.sourceVersion>=0&&r.sourceVersion<=version&&exact(r.basis,['clock','conditions'])&&str(r.basis.clock,200)&&str(r.basis.conditions,40000),'路线来源无效。');
   for(const id of [r.from,...r.via,r.to])fail(byId.get(id)?.kind==='place','路线引用了不存在的地点。');
   fail(r.quote.includes(byId.get(r.from).name)&&r.quote.includes(byId.get(r.to).name)&&r.quote.includes(r.label),'路线缺少地点和名称依据。');
   for(const c of r.costs)fail(['meter','item'].includes(byId.get(c.entityId)?.kind)&&byId.get(c.entityId)?.value!==null,'费用引用了未知资源。');
  }
 }
 if(value.transit){const t=value.transit;fail(exact(t,snapshot?[...transitKeys,'sourceVersion']:transitKeys)&&key(t.routeId)&&key(t.locationId)&&typeof t.completed==='boolean'&&(t.elapsedMinutes===null||integer(t.elapsedMinutes)),'行进结果格式无效。');costsValid(t.paidCosts);witnessed(t,prose);if(t.elapsedMinutes!==null)fail(amountWitness(t.quote,t.elapsedMinutes)&&/分钟/.test(t.quote),'实际行程耗时缺少正文依据。');for(const c of t.paidCosts)fail(amountWitness(t.quote,c.amount),'实际支付缺少正文依据。');if(snapshot){fail(Number.isInteger(t.sourceVersion)&&t.sourceVersion<=version&&t.sourceVersion>=0&&byId.get(t.locationId)?.kind==='place'&&value.routes.some(r=>r.id===t.routeId),'行进结果引用无效。');}}
}

function conditionBasis(game,route){const feeIds=new Set(route.costs.map(c=>c.entityId));return canonical((game.entities??[]).filter(e=>e.kind==='meter'&&!feeIds.has(e.id)).map(e=>[e.id,e.value,e.status]).sort(([a],[b])=>a.localeCompare(b)));}
function carriedCost(state,cost){
 const e=state.game.entities.find(e=>e.id===cost.entityId);if(e?.kind!=='item')return true;
 if(state.inventory?.some(name=>name===e.name||name===`${e.name}${e.value}${e.unit}`))return true;
 const o=state.experience?.objects.find(o=>o.id===e.id),location=o?.fields.find(f=>f.key==='location')?.value;
 return o?.certainty==='confirmed'&&['随身','身上','你的身上','你身上','随身携带'].includes(location);
}
export function advanceJourneys(previous,update,game,version,clock=''){
 if(previous===undefined&&update==null)return undefined;
 validateJourneys(update);const next=clone(previous??{schemaVersion:1,routes:[],transit:null});
 for(const route of update?.routes??[]){const old=next.routes.find(r=>r.id===route.id);if(old)fail(old.from===route.from&&old.to===route.to,'同一路线的起终点不能被改写。');const record={...clone(route),sourceVersion:version,basis:{clock,conditions:conditionBasis(game,route)}};if(old)Object.assign(old,record);else next.routes.push(record);}
 if(update?.transit)next.transit={...clone(update.transit),sourceVersion:version};
 validateJourneys(next,undefined,{snapshot:true,entities:game.entities,version});return next;
}

export function clockMinutes(clock){if(clock?.precision!=='exact')return null;const match=clock.label?.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/);return match&&Number(match[1])<24&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):null;}
function clockDay(clock){
 const label=clock?.label??'',ordinal=label.match(/第\s*(\d+)\s*[日天]/);
 if(ordinal)return {kind:'ordinal',day:Number(ordinal[1])};
 const date=label.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})(?:日)?/);
 if(date){const [year,month,day]=date.slice(1).map(Number),stamp=Date.UTC(year,month-1,day),d=new Date(stamp);if(d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)return {kind:'date',day:stamp/86400000};}
 return null;
}
export function arrivalEstimate(clock,minutes){const start=clockMinutes(clock);if(start===null||minutes===null)return '';const total=start+minutes,days=Math.floor(total/1440);return `${days?`${days===1?'次日':days+'天后'} `:''}${String(Math.floor(total%1440/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
function roadBlocked(game,route){
 const path=[route.from,...route.via,route.to],roads=game.spatial?.relations?.filter(r=>r.kind==='route')??[];
 return path.slice(1).some((to,i)=>{const from=path[i],pair=roads.filter(r=>r.from===from&&r.to===to||r.from===to&&r.to===from);return pair.length&&!pair.some(r=>r.passage==='open'&&(r.from===from||r.bidirectional));});
}
export function journeyOptions(state,destination){
 const game=state.game??{},clock=state.experience?.clock,places=(game.entities??[]).filter(e=>e.kind==='place'),current=places.filter(p=>p.name===state.location);
 return (game.journeys?.routes??[]).filter(r=>(!destination||r.to===destination)&&current.length===1&&r.from===current[0].id).map(r=>{
  let reason='';
  if(roadBlocked(game,r))reason='路线已封闭或当前方向不可通行';
  else if(r.basis.clock!==(clock?.label??'')||r.basis.conditions!==conditionBasis(game,r)||(state.experience?.objects??[]).some(o=>o.sourceVersion>r.sourceVersion&&o.fields.some(f=>['condition','availability','duration'].includes(f.key))))reason='情况已有变化，需要重新核对耗时与费用';
  else if(r.costs.some(c=>(game.entities.find(e=>e.id===c.entityId)?.value??-1)<c.amount))reason='随身资源不足';
  else if(r.costs.some(c=>!carriedCost(state,c)))reason='支付所需物品尚未随身携带';
  const times=r.includesWaiting?[arrivalEstimate(clock,r.minutesMin),arrivalEstimate(clock,r.minutesMax)]:[];
  return {route:clone(r),available:!reason,reason,arrival:times[0]?(times[0]===times[1]?times[0]:times.join('–')):'',input:`沿${r.label}前往${places.find(p=>p.id===r.to)?.name||'目的地'}。`};
 });
}
export function resolveJourney(state,reference){
 const option=journeyOptions(state).find(o=>o.route.id===reference.actionId);fail(option,'这条路线不从当前位置出发，请查看最新地图。');fail(option.available,option.reason);
 return {reference:clone(reference),mode:'journey',input:option.input,effects:[],destination:null,location:state.location,journey:option.route};
}

export function settleJourney(before,update,receipt,{events=[],experience}={}){
 const route=receipt.journey,result=update?.journeys?.transit;fail(result&&result.routeId===route.id,'出行尚未给出实际停点。');
 const entities=[...before.game.entities,...(update.entities??[])],place=[...entities].reverse().find(e=>e.id===result.locationId);
 fail(place?.kind==='place'&&result.quote.includes(place.name),'实际停点缺少公开地点依据。');
 fail(result.completed?result.locationId===route.to:result.locationId!==route.to,'行程完成状态与实际位置不符。');
 fail(events.filter(e=>e.type==='location').every(e=>e.value===place.name),'正文与行程停点不一致。');
 fail(!events.some(e=>['item-add','item-remove'].includes(e.type)),'出行只授权移动，不能顺带交付或购买物品。');
 const elapsed=result.elapsedMinutes;
 if(route.minutesMin!==null){fail(integer(elapsed),'已计时的行程必须记录实际耗时。');fail(result.completed?elapsed>=route.minutesMin&&(!route.includesWaiting||elapsed<=route.minutesMax):!route.includesWaiting||elapsed<=route.minutesMax,'行程耗时超出当前路线报价。');}
 if(elapsed!==null){
  const c=experience?.clock;fail(c&&new RegExp(`(?:^|[^\\d])${elapsed}\\s*分钟(?:$|[^\\d])`).test(c.elapsed),'故事时钟与实际行程耗时不一致。');
  const start=clockMinutes(before.experience?.clock),end=clockMinutes(c);if(start!==null)fail(end!==null&&end===(start+elapsed)%1440,'抵达时刻与实际行程耗时不一致。');
  const fromDay=clockDay(before.experience?.clock),toDay=clockDay(c);if(start!==null&&fromDay)fail(toDay?.kind===fromDay.kind&&toDay.day===fromDay.day+Math.floor((start+elapsed)/1440),'抵达日期与实际行程耗时不一致。');
 }
 costsValid(result.paidCosts);
 for(const paid of result.paidCosts)fail(route.costs.some(c=>c.entityId===paid.entityId&&paid.amount<=c.amount),'实际费用超出已授权报价。');
 if(result.completed)fail(route.costs.every(c=>result.paidCosts.some(p=>p.entityId===c.entityId&&p.amount===c.amount)),'已完成行程的费用与报价不一致。');
 const feeIds=new Set(result.paidCosts.map(c=>c.entityId));
 for(const written of update.entities??[]){
  const old=before.game.entities.find(e=>e.id===written.id);
  if(old&&['meter','item'].includes(old.kind)&&!feeIds.has(old.id)){
   fail(written.value===old.value&&written.unit===old.unit&&written.max===old.max,'出行不能改变未授权费用的资源数量。');
   if(old.kind==='item')fail(written.status===old.status,'出行不能代替物品交付。');
  }
 }
 for(const written of experience?.objects??[]){const old=before.experience?.objects.find(e=>e.id===written.id);if(old&&['item','agreement'].includes(old.kind)){if(old.kind==='agreement')fail(written.status===old.status||['已取消','已失效','有争议'].includes(written.status),'前往目的地不代表接受或履行约定。');for(const field of written.fields??[])if(['owner','custodian'].includes(field.key))fail(field.value===old.fields.find(f=>f.key===field.key)?.value,'出行不能改变物品的所有者或保管者。');}}
 const effects=result.paidCosts.map(c=>{const e=before.game.entities.find(e=>e.id===c.entityId);fail(e&&e.value>=c.amount,'随身资源不足');return {entityId:e.id,beforeValue:e.value,value:Number((e.value-c.amount).toFixed(8)),beforeStatus:e.status,status:e.status};});
 return {...receipt,location:place.name,destination:result.locationId,effects};
}
