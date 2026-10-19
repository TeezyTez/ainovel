// Declarative gameplay: model prose supplies evidence; only this module computes effects.
import {spatialSchema,validateSpatial,advanceSpatial} from './spatial-state.js';
import {journeysSchema,validateJourneys,advanceJourneys,resolveJourney,settleJourney,journeyOptions,JOURNEY_SURFACE} from './journey-state.js';
const fail=(ok,message)=>{if(!ok)throw new Error(message);};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=(x,max=800)=>typeof x==='string'&&x.length<=max;
const key=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const clone=x=>structuredClone(x);
const entityKinds=['meter','item','place','clue','objective','actor'];
export const GAME_SURFACE_KINDS=Object.freeze(['status','map','inventory','clues','objectives','interaction','timeline','people','comparison']);
const surfaceKinds=GAME_SURFACE_KINDS;
const entityKeys=['id','kind','name','detail','status','value','max','unit','quote'];
const surfaceKeys=['id','kind','title','description','entityIds','links','actions','quote'];
const actionKeys=['id','label','input','mode','effects','destination','disabledReason'];
const validNumber=x=>Number.isFinite(x)&&Math.abs(x)<=1e12;
const list=(x,limit)=>Array.isArray(x)&&x.length<=limit;
const unique=xs=>new Set(xs).size===xs.length;
const version=x=>Number.isInteger(x)&&x>=0;
const schemaObj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'},id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'},number={type:['number','null']};
const effectSchema=schemaObj({entityId:id,delta:{type:'number'},status:{type:['string','null']}});
const entitySchema=schemaObj({id,kind:{type:'string',enum:entityKinds},name:string,detail:string,status:string,value:number,max:number,unit:string,quote:string});
const actionSchema=schemaObj({id,label:string,input:string,mode:{type:'string',enum:['attempt','apply']},effects:{type:'array',maxItems:12,items:effectSchema},destination:{type:['string','null']},disabledReason:string});
const surfaceSchema=schemaObj({id,kind:{type:'string',enum:surfaceKinds},title:string,description:string,entityIds:{type:'array',maxItems:24,items:id},links:{type:'array',maxItems:24,items:schemaObj({from:id,to:id,label:string})},actions:{type:'array',maxItems:6,items:actionSchema},quote:string});
export const gameSchema={...schemaObj({entities:{type:'array',maxItems:12,items:entitySchema},surfaces:{type:'array',maxItems:3,items:surfaceSchema},spatial:spatialSchema,journeys:journeysSchema}),type:['object','null']};
const gameKeys=(value,snapshot=false)=>obj(value)&&['entities','surfaces',...(snapshot?['schemaVersion']:[])].every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>['entities','surfaces','spatial','journeys',...(snapshot?['schemaVersion']:[])].includes(k));

function entityValid(e,snapshot=false,currentVersion=Infinity){
 fail(exact(e,snapshot?[...entityKeys,'sourceVersion']:entityKeys),'游戏实体字段无效。');
 fail(key(e.id)&&entityKinds.includes(e.kind)&&str(e.name,120)&&e.name.trim()&&str(e.detail)&&str(e.status,120)&&str(e.unit,40)&&str(e.quote,1200)&&e.quote.trim(),'游戏实体文字或标识无效。');
 fail(e.value===null||(validNumber(e.value)&&e.value>=0),'游戏数值必须是已知的非负有限数。');
 fail(e.max===null||(validNumber(e.max)&&e.max>0&&e.value!==null&&e.value<=e.max),'游戏数值超出上限。');
 if(snapshot)fail(version(e.sourceVersion)&&e.sourceVersion<=currentVersion,'游戏实体来源版本无效。');
}
function surfaceValid(s,snapshot=false,currentVersion=Infinity){
 fail(exact(s,snapshot?[...surfaceKeys,'version']:surfaceKeys),'游戏界面字段无效。');
 fail(key(s.id)&&surfaceKinds.includes(s.kind)&&str(s.title,120)&&s.title.trim()&&str(s.description)&&str(s.quote,1600)&&s.quote.trim(),'游戏界面文字无效。');
 fail(list(s.entityIds,24)&&s.entityIds.every(key)&&unique(s.entityIds)&&list(s.links,24)&&list(s.actions,6)&&unique(s.actions.map(a=>a?.id)),'游戏界面引用或动作数量无效。');
 for(const l of s.links)fail(exact(l,['from','to','label'])&&s.entityIds.includes(l.from)&&s.entityIds.includes(l.to)&&str(l.label,120),'地图连接无效。');
 for(const a of s.actions){
  fail(exact(a,actionKeys)&&key(a.id)&&str(a.label,120)&&a.label.trim()&&str(a.input,500)&&a.input.trim()&&['attempt','apply'].includes(a.mode)&&str(a.disabledReason,240),'游戏动作字段无效。');
  fail(list(a.effects,12)&&unique(a.effects.map(e=>e?.entityId))&&(a.destination===null||key(a.destination)),'游戏动作效果无效。');
  for(const e of a.effects)fail(exact(e,['entityId','delta','status'])&&key(e.entityId)&&s.entityIds.includes(e.entityId)&&validNumber(e.delta)&&(e.status===null||str(e.status,120)),'动作引用或数值无效。');
  fail(a.mode!=='attempt'||(!a.effects.length&&a.destination===null),'尝试动作不能自动结算结果。');
  fail(a.destination===null||s.entityIds.includes(a.destination),'动作目的地不属于当前界面。');
  fail(a.destination===null||s.kind==='map','确定的移动动作必须来自地图。');
 }
 if(snapshot)fail(version(s.version)&&s.version===currentVersion,'游戏界面已过期。');
}
// Chinese prose often spells small counts out; accept exact numeral tokens, never substrings of larger numbers.
function numberIn(prose,n){
 const tokens=prose.match(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+/g)||[];
 const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 return tokens.some(token=>{
  if(/^\d/.test(token))return Number(token)===n;
  let total=0,part=0,digit=0;
  for(const c of token){if(c in digits)digit=digits[c];else{const unit={十:10,百:100,千:1000,万:10000}[c];if(unit===10000){total+=(part+digit)*unit;part=0;}else part+=(digit||1)*unit;digit=0;}}
  return total+part+digit===n;
 });
}
export function validateGameUpdate(update,prose){
 if(update==null)return update;
 fail(gameKeys(update)&&list(update.entities,12)&&list(update.surfaces,3),'游戏更新格式无效。');
 validateSpatial(update.spatial,prose);
 validateJourneys(update.journeys,prose);
 fail(unique(update.entities.map(e=>e?.id))&&unique(update.surfaces.map(s=>s?.id)),'游戏标识重复。');
 for(const e of update.entities){entityValid(e);if(prose!==undefined){fail(prose.includes(e.quote)&&e.quote.includes(e.name),'游戏实体缺少本轮正文依据。');for(const n of [e.value,e.max])if(n!==null)fail(numberIn(e.quote,n),'游戏数值缺少正文依据。');}}
 for(const s of update.surfaces){surfaceValid(s);if(prose!==undefined){fail(prose.includes(s.quote),'游戏界面缺少本轮正文依据。');for(const a of s.actions)for(const e of a.effects)if(e.delta!==0)fail(numberIn(s.quote,Math.abs(e.delta)),'动作数值缺少正文依据。');}}
 return update;
}
export function validateGameState(game,currentVersion){
 if(game===undefined)return game;
 fail(gameKeys(game,true)&&game.schemaVersion===1&&list(game.entities,200)&&list(game.surfaces,3),'游戏状态格式无效。');
 fail(unique(game.entities.map(e=>e?.id))&&unique(game.surfaces.map(s=>s?.id)),'游戏状态标识重复。');
 const v=currentVersion??Math.max(0,...game.entities.map(e=>e.sourceVersion),...game.surfaces.map(s=>s.version),...(game.spatial?.sites??[]).map(s=>s.sourceVersion),...(game.spatial?.relations??[]).map(r=>r.sourceVersion),...(game.journeys?.routes??[]).map(r=>r.sourceVersion),game.journeys?.transit?.sourceVersion??0);
 const entities=new Map(game.entities.map(e=>[e.id,e]));
 if(game.spatial!==undefined)validateSpatial(game.spatial,undefined,{snapshot:true,entities:game.entities,version:v});
 if(game.journeys!==undefined)validateJourneys(game.journeys,undefined,{snapshot:true,entities:game.entities,version:v});
 for(const e of game.entities)entityValid(e,true,v);
 for(const s of game.surfaces){surfaceValid(s,true,v);fail(s.entityIds.every(id=>entities.has(id)),'游戏界面引用了不存在的实体。');
  for(const l of s.links)fail(entities.get(l.from).kind==='place'&&entities.get(l.to).kind==='place','地图连接必须引用地点。');
  for(const a of s.actions){if(a.destination!==null)fail(entities.get(a.destination)?.kind==='place','动作目的地不是地点。');for(const e of a.effects)fail(e.delta===0||entities.get(e.entityId)?.value!==null,'动作无法修改未知数值。');}
 }
 return game;
}
export function advanceGame(previous,update,nextVersion,{clock=''}={}){
 if(previous===undefined&&update==null)return undefined;
 validateGameUpdate(update);if(previous!==undefined)validateGameState(previous);
 const game=clone(previous??{schemaVersion:1,entities:[],surfaces:[]});
 for(const e of update?.entities??[]){const i=game.entities.findIndex(old=>old.id===e.id);fail(i<0||game.entities[i].kind===e.kind,'已有游戏实体的类型不能改变。');const next={...clone(e),sourceVersion:nextVersion};if(i<0)game.entities.push(next);else game.entities[i]=next;}
 game.surfaces=(update?.surfaces??[]).map(s=>({...clone(s),version:nextVersion}));
 const spatial=advanceSpatial(previous?.spatial,update?.spatial,game.entities,nextVersion);
 if(spatial!==undefined)game.spatial=spatial;
 const journeys=advanceJourneys(previous?.journeys,update?.journeys,game,nextVersion,clock);
 if(journeys!==undefined)game.journeys=journeys;
 return validateGameState(game,nextVersion);
}
// Only exact, unique current offers share the deterministic button transaction.
// Other natural language remains a free attempt for the narrator to understand.
export function gameActionForInput(state,input,branchId){
 const normalize=s=>String(s).trim().replace(/[。！!]$/,'');
 const text=normalize(input),matches=[];
 for(const surface of state.game?.surfaces||[])for(const action of surface.actions){
  if(text===normalize(action.input)||text===normalize(action.label))matches.push({branchId,version:state.version,surfaceId:surface.id,actionId:action.id});
 }
 for(const option of journeyOptions(state))if(text===normalize(option.input))matches.push({branchId,version:state.version,surfaceId:JOURNEY_SURFACE,actionId:option.route.id});
 if(matches.length!==1)return undefined;
 resolveGameAction(state,matches[0],{branchId});return matches[0];
}
export function resolveGameAction(state,reference,{branchId}={}){
 fail(exact(reference,['branchId','version','surfaceId','actionId'])&&key(reference.branchId)&&(key(reference.surfaceId)||reference.surfaceId===JOURNEY_SURFACE)&&key(reference.actionId)&&version(reference.version),'游戏动作引用无效。');
 fail(branchId===reference.branchId&&state.version===reference.version,'这个操作属于旧回合或其他分支，请使用最新操作。');
 validateGameState(state.game,state.version);
 if(reference.surfaceId===JOURNEY_SURFACE||reference.surfaceId==='journeys'&&!state.game?.surfaces.some(s=>s.id==='journeys')&&state.game?.journeys?.routes.some(r=>r.id===reference.actionId))return resolveJourney(state,reference);
 const surface=state.game?.surfaces.find(s=>s.id===reference.surfaceId),action=surface?.actions.find(a=>a.id===reference.actionId);
 fail(action&&!action.disabledReason,'这个操作当前不可用。');
 if(action.destination!==null){
  const sources=state.game.entities.filter(e=>e.kind==='place'&&e.name===state.location&&surface.entityIds.includes(e.id));
  fail(sources.length===1&&surface.links.some(l=>l.from===sources[0].id&&l.to===action.destination),'地图缺少当前位置到目的地的明确路线。');
  const routes=state.game.spatial?.relations.filter(r=>r.kind==='route'&&((r.from===sources[0].id&&r.to===action.destination)||(r.bidirectional&&r.to===sources[0].id&&r.from===action.destination)))??[];
  const pairKnown=state.game.spatial?.relations.some(r=>r.kind==='route'&&[r.from,r.to].includes(sources[0].id)&&[r.from,r.to].includes(action.destination));
  if(pairKnown)fail(routes.some(r=>r.passage==='open'),'已记录路线受阻、单向或通行情况未知。');
 }
 const effects=action.effects.map(e=>{const entity=state.game.entities.find(x=>x.id===e.entityId);const value=e.delta===0?entity.value:addDecimal(entity.value,e.delta);
  fail(value===null||(validNumber(value)&&value>=0&&(entity.max===null||value<=entity.max)),'资源不足或操作超出数值上限。');
  return {entityId:e.entityId,beforeValue:entity.value,value,beforeStatus:entity.status,status:e.status??entity.status};
 });
 return {reference:clone(reference),mode:action.mode,input:action.input,effects,destination:action.destination,location:action.destination===null?state.location:state.game.entities.find(e=>e.id===action.destination).name};
}
// Add the exact decimal representations without binary floating point overshoot.
function addDecimal(a,b){
 const parts=n=>{const [mantissa,exponent='0']=String(n).split('e'),fraction=mantissa.split('.')[1]?.length??0;return {digits:BigInt(mantissa.replace('.','')),scale:fraction-Number(exponent)};};
 const x=parts(a),y=parts(b),scale=Math.max(x.scale,y.scale);
 return Number(`${x.digits*10n**BigInt(scale-x.scale)+y.digits*10n**BigInt(scale-y.scale)}e${-scale}`);
}
const canonical=x=>JSON.stringify(x,(_,v)=>obj(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const experienceKind={meter:'resource',item:'item',place:'location',clue:'clue',objective:'event',actor:'person'};
// A clue card may present a recorded fact; its certainty and original kind stay
// in experience. This does not alias physical objects, people or locations.
const compatibleExperienceKind=(gameKind,kind)=>gameKind==='objective'?['agreement','event'].includes(kind):gameKind==='clue'?['clue','fact'].includes(kind):experienceKind[gameKind]===kind;
// Only construct aliases from explicit structured fields; never extract amounts
// from arbitrary legacy labels or prose.
export function gameItemAliases(entity,experience){
 const aliases=new Set([entity.name]);
 if(entity.value!==null)aliases.add(`${entity.name}${entity.value}${entity.unit}`);
 const records=experience?.objects??[],record=records.find(o=>o.id===entity.id)??(records.filter(o=>o.kind==='item'&&o.name===entity.name).length===1?records.find(o=>o.kind==='item'&&o.name===entity.name):null);
 const amount=record?.fields.find(f=>f.key==='amount')?.value,unit=record?.fields.find(f=>f.key==='unit')?.value??'';
 if(amount){aliases.add(`${entity.name}${amount}`);if(unit&&!amount.endsWith(unit))aliases.add(`${entity.name}${amount}${unit}`);}
 return aliases;
}
export function applyGameTransaction(before,update,receipt,{branchId,events=[],experience}={}){
 let previous=before.game,location=before.location,effects=[];
 if(receipt!==undefined){
  let expected=resolveGameAction(before,receipt?.reference,{branchId});
  fail(canonical(expected)===canonical(receipt),'动作结算与已保存规则不一致。');
  if(expected.mode==='journey')expected=settleJourney(before,update,expected,{events,experience});
  effects=expected.effects;
  previous=clone(previous);
  for(const effect of expected.effects){const e=previous.entities.find(e=>e.id===effect.entityId),written=update?.entities?.find(x=>x.id===e.id);
   if(written)fail(written.value===effect.value&&written.status===effect.status&&written.max===e.max&&written.kind===e.kind&&written.unit===e.unit&&written.name===e.name,'正文更新不能覆写已结算的动作结果。');
   e.value=effect.value;e.status=effect.status;e.sourceVersion=before.version+1;
   if(!written)e.detail='';
  }
  location=expected.location;
  if(expected.destination!==null){fail(events.filter(e=>e.type==='location').every(e=>e.value===location),'正文位置与动作目的地不一致。');const written=update?.entities?.find(e=>e.id===expected.destination);fail(!written||written.name===location,'正文不能改写已结算的目的地。');}
 }
 // The affected values can already carry the next version, so merge validates the final snapshot.
 if(previous)previous={...previous,surfaces:[]};
 const game=advanceGame(previous,update,before.version+1,{clock:experience?.clock?.label??before.experience?.clock?.label??''});
 if(game){
  for(const e of game.entities){
   const identities=new Set([...(before.experience?.objects??[]),...(experience?.objects??[])].filter(o=>compatibleExperienceKind(e.kind,o.kind)&&o.name===e.name).map(o=>o.id));
   const matched=o=>o.id===e.id||(!identities.has(e.id)&&identities.size===1&&!game.entities.some(x=>x.id===o.id)&&compatibleExperienceKind(e.kind,o.kind)&&o.name===e.name&&game.entities.filter(x=>x.kind===e.kind&&x.name===e.name).length===1);
   for(const o of experience?.objects??[])if(matched(o)){
    fail(o.name===e.name&&compatibleExperienceKind(e.kind,o.kind),'情况记录不能改写已结算对象的身份。');
    const statusEffect=effects.find(effect=>effect.entityId===e.id&&effect.beforeStatus!==effect.status);
    if(statusEffect)fail(o.status===statusEffect.status,'情况记录状态与动作结算不一致。');
    const amount=o.fields.find(f=>f.key==='amount'),unit=o.fields.find(f=>f.key==='unit');
    if(amount&&e.value!==null){let value=amount.value.trim();if(e.unit&&value.endsWith(e.unit))value=value.slice(0,-e.unit.length).trim();fail(/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&Number(value)===e.value,'情况记录数量与动作结算不一致。');}
    if(unit)fail(unit.value===e.unit,'情况记录单位与动作结算不一致。');
   }
   if(e.kind==='item'&&e.value!==null)for(const event of events){
    const aliases=gameItemAliases(before.game?.entities.find(old=>old.id===e.id)??e,before.experience);
    const matched=event.entity?event.entity===e.id:aliases.has(event.value)&&game.entities.filter(x=>x.kind==='item'&&x.name===e.name).length===1;
    if(matched&&event.type==='item-add')fail(e.value>0,'背包增加与动作结算的零数量不一致。');
    if(matched&&event.type==='item-remove')fail(e.value===0,'背包移除与动作结算的剩余数量不一致。');
   }
  }
 }
 return {game,location,effects};
}
