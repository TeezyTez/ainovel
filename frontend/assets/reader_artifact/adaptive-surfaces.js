// Presentation policy only. Reads committed public records; never changes a
// world, spends resources, runs a model or supplies an executable fallback.
const list=x=>Array.isArray(x)?x:[];
const fields=o=>list(o?.fields);
const visibleKeys=['id','kind','name','summary','detail','status','certainty','fields','relatedIds','quote','value','max','unit','sourceVersion'];
const publicRecord=o=>Object.fromEntries(visibleKeys.filter(k=>Object.hasOwn(o,k)).map(k=>[k,structuredClone(o[k])]));
const comparable=o=>JSON.stringify([o.kind,o.name,o.summary||o.detail||'',o.status,o.value,o.max,o.unit,fields(o)]);
const fingerprint=(surface,objects)=>JSON.stringify([surface.kind,surface.entityIds.map(id=>{const o=objects.find(o=>o.id===id);return [id,o?comparable(o):null];}),list(surface.links),list(surface.actions).map(a=>[a.input,a.effects,a.destination,a.disabledReason])]);
const temporal=o=>fields(o).some(f=>['scheduledAt','deadline','actualAt','occurredAt','duration'].includes(f.key)&&f.value);
const priorities={status:90,timeline:80,map:75,comparison:70,interaction:65,people:60,clues:55,objectives:50,inventory:45};
const reasons={status:'这些变化可能影响接下来的行动',timeline:'把时间、约定与实际进展放在一起',map:'把眼前涉及的地点与已知连接放在一起',comparison:'并排查看相关对象的差异',people:'理清此刻相关的人物',clues:'这些线索与当前情景有关',objectives:'查看当前事项的进展',inventory:'查看这次涉及的物品',interaction:'眼前可以参与的事情'};
function records(state={}){
 const objects=new Map(list(state.experience?.objects).filter(o=>o.sourceVersion<=state.version).map(o=>[o.id,publicRecord(o)]));
 for(const e of list(state.game?.entities).filter(e=>e.sourceVersion<=state.version))objects.set(e.id,{...objects.get(e.id),...publicRecord(e)});
 return [...objects.values()];
}
export function adaptiveSurfaces(turn={}, {previousState={},previousTurn,historical=false,density='adaptive',requested=null}={}){
 const state=turn.state||{},objects=records(state),oldObjects=records(previousState);
 const fresh=objects.filter(o=>o.sourceVersion===state.version&&(!oldObjects.some(old=>old.id===o.id)||comparable(o)!==comparable(oldObjects.find(old=>old.id===o.id))));
 const candidates=list(state.game?.surfaces).map((surface,index)=>({surface,objects:surface.entityIds.map(id=>objects.find(o=>o.id===id)).filter(Boolean),reason:reasons[surface.kind]||'相关资料',score:80-index*5,origin:'scene'}));
 const add=(kind,title,selected,extra={})=>{
  if(!selected.length||candidates.some(c=>c.surface.kind===kind))return;
  candidates.push({surface:{id:'context-'+kind,kind,title,description:'',entityIds:selected.map(o=>o.id),links:[],actions:[],version:state.version,...extra},objects:selected,reason:reasons[kind],score:priorities[kind],origin:'records'});
 };
 const meters=fresh.filter(o=>o.kind==='meter'&&oldObjects.some(old=>old.id===o.id)||o.kind==='resource'&&fields(o).some(f=>f.key==='condition'&&f.value));
 add('status','行动前，留意这些变化',meters);
 const temporalFresh=fresh.filter(o=>['agreement','event','objective'].includes(o.kind)&&temporal(o));
 if(temporalFresh.length){
  const related=new Set(temporalFresh.flatMap(o=>list(o.relatedIds)));
  add('timeline','此刻的时间与约定',objects.filter(o=>temporalFresh.some(f=>f.id===o.id)||related.has(o.id)&&temporal(o)).slice(0,6));
 }
 const comparison=fresh.filter(o=>['item','clue'].includes(o.kind));
 if(comparison.length>=2&&comparison.length<=4&&comparison.every(o=>o.kind===comparison[0].kind)&&['purpose','condition','availability','source'].some(key=>comparison.every(o=>fields(o).some(f=>f.key===key&&f.value))))add('comparison','放在一起看，更容易分辨',comparison);
 const people=fresh.filter(o=>['person','actor'].includes(o.kind));
 if(people.length>=3)add('people','这一幕里的人',people.slice(0,6));
 // Reuse only saved directed edges. This is a read-only reminder, never a
 // claim that yesterday's path is still safe or an old move is executable.
 if(!candidates.some(c=>c.surface.kind==='map')){
  const relevant=objects.filter(o=>o.kind==='place'&&o.name&&String(turn.prose||'').includes(o.name));
  const ids=new Set(relevant.map(o=>o.id));
  const links=[...new Map(list(previousState.game?.surfaces).filter(s=>s.kind==='map').flatMap(s=>list(s.links)).filter(l=>ids.has(l.from)&&ids.has(l.to)).map(l=>[JSON.stringify(l),l])).values()];
  if(relevant.length>=3&&links.length>=2)add('map','这一带的已知连接',relevant,{links,description:'沿用已保存的路线记录；是否仍可通行，以当前剧情为准。'});
 }
 const previousCandidates=previousTurn?adaptiveSurfaces(previousTurn,{historical:true}):[];
 const prior=previousCandidates.map(c=>fingerprint(c.surface,c.objects));
 const ordered=candidates.map(c=>({...c,repeated:prior.includes(fingerprint(c.surface,c.objects))})).sort((a,b)=>b.score-a.score);
 let remaining=historical||density==='reading'?0:2;
 return ordered.map(c=>{const explicit=requested&&(requested==='all'||requested===c.surface.kind),open=!historical&&(explicit||!c.repeated&&remaining>0);if(open&&!explicit)remaining--;return {...c,open};});
}
