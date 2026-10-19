// Fixed source algorithms only: this module has no filesystem/network/database API.
import {canonical,resolveDynamic,validateDefinition,validateParams,publicContext} from './dynamic-rules.js';
import {validateGameState,validateGameUpdate,advanceGame,resolveGameAction,applyGameTransaction,gameActionForInput} from './game-state.js';
import {validateExperience,advanceExperience} from './experience-state.js';
const check=ok=>{if(!ok)throw Error('invalid_gameplay');};
const nil=v=>v===undefined||v===null;
const equal=(a,b)=>canonical(a)===canonical(b);
function stateShape(s,revision){
 check(s&&s.schemaVersion===1&&Object.keys(s).length===5&&['game','location','inventory','experience'].every(k=>Object.hasOwn(s,k))&&typeof s.location==='string'&&s.location.length<=2000&&Array.isArray(s.inventory)&&s.inventory.length<=2000&&s.inventory.every(x=>typeof x==='string'&&x.length<=2000));
 if(s.game!==null)validateGameState(s.game,revision);if(s.experience!==null)validateExperience(s.experience,undefined,{snapshot:true,version:revision});return s;
}
function sourceState(s,revision,facts){return {version:revision,game:s.game??undefined,location:s.location,inventory:s.inventory,experience:s.experience??undefined,facts:facts??[],time:s.experience?.clock?.label??''};}
function packed(s){return {schemaVersion:1,game:s.game??null,location:s.location??'',inventory:s.inventory??[],experience:s.experience??null};}
function resolve(before,definition,request,kind,branchId){
 if(kind==='dynamic')return resolveDynamic(before,definition,request);
 check(kind==='game'||kind==='journey');const receipt=resolveGameAction(before,request,{branchId});check(receipt.mode===(kind==='journey'?'journey':'apply'));return receipt;
}
function actionOf(receipt,kind,revision){
 const changes=kind==='dynamic'?receipt.changes.map(c=>({entity_id:c.entityId,kind:c.kind,before:c.before,after:c.after})):receipt.effects.flatMap(e=>[...(e.beforeValue===e.value?[]:[{entity_id:e.entityId,kind:'delta',before:e.beforeValue,after:e.value}]),...(e.beforeStatus===e.status?[]:[{entity_id:e.entityId,kind:'status',before:e.beforeStatus,after:e.status}])]);
 return {kind,action_id:kind==='dynamic'?receipt.actionId:receipt.reference.actionId,result:kind==='dynamic'?receipt.result:receipt.input,changes,destination:receipt.destination??null,journey:receipt.journey??null,base_revision:revision};
}
export function gameplay(request){
 if(request.op==='gameplay-validate-many'){check(Array.isArray(request.items)&&request.items.length<=64);for(const item of request.items)stateShape(item.state,item.revision);return {valid:true};}
 const revision=request.revision;check(Number.isSafeInteger(revision)&&revision>=0);
 if(request.op==='gameplay-validate'){return stateShape(request.value,revision);}
 const old=request.before??{schemaVersion:1,game:null,location:'',inventory:[],experience:null};stateShape(old,revision);
 const before=sourceState(old,revision,request.facts);
 if(request.op==='gameplay-attempt'){
  const d=request.definition,r=request.reference;
  check(r&&Object.keys(r).length===7&&['definitionDigest','scope','interactionId','revision','actionId','targets','params'].every(k=>Object.hasOwn(r,k)));
  validateDefinition(d,before);check(equal(d.scope,r.scope)&&d.scope.baseVersion===revision&&d.id===r.interactionId&&d.revision===r.revision);
  const action=d.actions.find(a=>a.id===r.actionId);check(action?.mode==='attempt'&&equal(action.targets,r.targets));validateParams(d,r.params,publicContext(before));return {valid:true};
 }
 if(request.op==='gameplay-match'){const reference=gameActionForInput(before,request.input,request.branchId);return reference?{reference,mode:resolveGameAction(before,reference,{branchId:request.branchId}).mode}:{reference:null,mode:''};}
 if(request.op==='gameplay-resolve'){
 const receipt=resolve(before,request.definition,request.reference,request.kind,request.branchId);
 return {action:actionOf(receipt,request.kind,revision),receipt};
 }
 if(request.op==='gameplay-baseline'){
 // An existing formal numeric ledger is never replaced by a presentation.
 if(request.before!==null&&request.before!==undefined)return old;
 const p=request.payload;check(p?.state?.version===revision&&p.scope?.baseVersion===revision);
 validateGameUpdate(p.sourceGame,request.prose);const game=advanceGame(undefined,p.sourceGame,revision,{clock:request.storyTime});
 const experience={schemaVersion:1,clock:request.storyTime?{label:request.storyTime,elapsed:'',precision:/\b\d{1,2}:\d{2}\b/.test(request.storyTime)?'exact':'unknown',quote:request.storyTime,sourceVersion:revision}:null,objects:[],stop:null,folded:[]};return packed({game,location:p.state.location,inventory:[],experience});
 }
 const update=request.update;check(nil(update)||(update.schemaVersion===1&&Object.keys(update).length===4&&['game','experience','events'].every(k=>Object.hasOwn(update,k))&&Array.isArray(update.events)&&update.events.length<=64));
 if(request.mode==='ask'){check(nil(update)&&nil(request.action));return {state:request.before??null,receipt:null};}
 validateGameUpdate(update?.game,request.prose);validateExperience(update?.experience,request.prose);
 const events=(update?.events??[]).map(e=>{check(e&&Object.keys(e).length===4&&['location','item-add','item-remove'].includes(e.type)&&typeof e.value==='string'&&e.value.length>0&&e.value.length<=2000&&(e.entityId===null||typeof e.entityId==='string')&&typeof e.quote==='string'&&e.quote.length>0&&request.prose.includes(e.quote)&&e.quote.includes(e.value));return {type:e.type,value:e.value,entity:e.entityId??undefined};});
 check(events.filter(e=>e.type==='location').length<=1);
 let experience=advanceExperience(before.experience,update?.experience,revision+1);
 if(experience?.clock)check(experience.clock.label===request.storyTime);
 let game,location=before.location,receipt=null;
 if(request.action){
 check(request.replay&&request.action.base_revision===revision);
 const expected=resolve(before,request.replay.definition,request.replay.reference,request.action.kind,request.branchId);
 check(equal(expected,request.replay.receipt)&&equal(actionOf(expected,request.action.kind,revision),request.action));
 if(request.action.kind==='dynamic'||request.action.kind==='game'){
  for(const written of update?.game?.entities??[]){const old=before.game.entities.find(e=>e.id===written.id);check(old&&['kind','name','unit','max'].every(k=>equal(old[k],written[k])));for(const [field,kind]of [['value','delta'],['status','status']]){const effect=request.action.changes.find(e=>e.entity_id===old.id&&e.kind===kind);check(equal(written[field],effect?effect.after:old[field]));}}
  for(const record of update?.experience?.objects??[]){const old=before.experience?.objects?.find(o=>o.id===record.id);check(old&&old.kind===record.kind&&old.name===record.name);for(const f of record.fields){if(['owner','custodian','location'].includes(f.key))check(f.value===old.fields.find(v=>v.key===f.key)?.value);}}
 }
 for(const written of update?.game?.entities??[])if(['meter','item'].includes(written.kind))check(before.game.entities.some(e=>e.id===written.id));
 if(request.action.kind==='dynamic'){
  let previous=structuredClone(before.game);for(const change of expected.changes){const entity=previous.entities.find(e=>e.id===change.entityId),written=update?.game?.entities?.find(e=>e.id===change.entityId),key=change.kind==='delta'?'value':'status';check(entity&&entity[key]===change.before);if(written)check(written[key]===change.after&&written.kind===entity.kind&&written.unit===entity.unit&&written.max===entity.max&&written.name===entity.name);entity[key]=change.after;entity.sourceVersion=revision+1;}
  // No second authority channel may undo deterministic changes.
  for(const change of expected.changes){const record=update?.experience?.objects?.find(o=>o.id===change.entityId);if(record){if(change.kind==='status')check(record.status===change.after);else{const amount=record.fields.find(f=>f.key==='amount');if(amount)check(Number(amount.value)===change.after);}}}
  check(!events.some(e=>e.type==='location'));for(const e of events){const item=previous.entities.find(x=>x.id===e.entity&&x.kind==='item');check(item&&expected.changes.some(c=>c.entityId===item.id)&&((e.type==='item-add'&&item.value>0)||(e.type==='item-remove'&&item.value===0)));}previous.surfaces=[];game=advanceGame(previous,update?.game,revision+1,{clock:experience?.clock?.label??before.time});receipt={...actionOf(expected,'dynamic',revision),revision:revision+1,location};
 }else{
  const settled=applyGameTransaction(before,update?.game,expected,{branchId:request.branchId,events,experience});game=settled.game;location=settled.location;
  const changes=settled.effects.flatMap(e=>[...(e.beforeValue===e.value?[]:[{entity_id:e.entityId,kind:'delta',before:e.beforeValue,after:e.value}]),...(e.beforeStatus===e.status?[]:[{entity_id:e.entityId,kind:'status',before:e.beforeStatus,after:e.status}])]);
  receipt={...request.action,changes,revision:revision+1,location,transit:update?.game?.journeys?.transit??null};
 }
 }else{game=advanceGame(before.game,update?.game,revision+1,{clock:experience?.clock?.label??before.time});}
 for(const e of events)if(e.type==='location'){if(request.action)check(e.value===location);location=e.value;}
 const inventory=[...before.inventory];for(const e of events){if(e.type==='item-add'&&!inventory.includes(e.value))inventory.push(e.value);if(e.type==='item-remove'){const i=inventory.indexOf(e.value);check(i>=0);inventory.splice(i,1);}}
 const state=packed({game,location,inventory,experience});stateShape(state,revision+1);return {state,receipt};
}
