// Durable, public geography. Drawing coordinates are derived, never stored as facts.
const fail=(ok,message)=>{if(!ok)throw new Error(message);};
const key=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=(x,max=1600)=>typeof x==='string'&&x.length<=max;
const unique=xs=>new Set(xs).size===xs.length;
export const TERRAINS=['landmark','building','room','region','water','forest','mountain'];
export const BEARINGS={N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1],S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1]};
export const BEARING_NAMES={N:'北',NE:'东北',E:'东',SE:'东南',S:'南',SW:'西南',W:'西',NW:'西北'};
const siteKeys=['id','terrain','parentId','quote'],relationKeys=['id','from','to','kind','bearing','distanceMeters','passage','bidirectional','label','quote'];
const obj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const id={type:'string'},str={type:'string'},nullableId={type:['string','null']};
export const spatialSchema={...obj({
 sites:{type:'array',maxItems:16,items:obj({id,terrain:{type:'string',enum:TERRAINS},parentId:nullableId,quote:str})},
 relations:{type:'array',maxItems:24,items:obj({id,from:id,to:id,kind:{enum:['relative','route'],type:'string'},bearing:{type:['string','null'],enum:[...Object.keys(BEARINGS),null]},distanceMeters:{type:['number','null'],exclusiveMinimum:0,maximum:1e8},passage:{type:'string',enum:['open','blocked','unknown']},bidirectional:{type:'boolean'},label:str,quote:str})}
}),type:['object','null']};

export function validateSpatial(update,prose,{snapshot=false,version=Infinity,entities=[]}={}){
 if(update==null)return;
 fail(exact(update,snapshot?['schemaVersion','sites','relations']:['sites','relations'])&&(!snapshot||update.schemaVersion===1),'空间记录格式无效。');
 fail(Array.isArray(update.sites)&&update.sites.length<=(snapshot?200:16)&&Array.isArray(update.relations)&&update.relations.length<=(snapshot?500:24),'空间记录过多。');
 fail(unique(update.sites.map(s=>s.id))&&unique(update.relations.map(r=>r.id)),'空间记录标识重复。');
 const byId=new Map(entities.map(e=>[e.id,e]));
 const witness=r=>{fail(text(r.quote)&&r.quote.trim(),'空间记录缺少正文依据。');if(prose!==undefined)fail(prose.includes(r.quote),'空间记录缺少本轮正文依据。');if(snapshot)fail(Number.isInteger(r.sourceVersion)&&r.sourceVersion>=0&&r.sourceVersion<=version,'空间记录来源版本无效。');};
 for(const s of update.sites){
  fail(exact(s,snapshot?[...siteKeys,'sourceVersion']:siteKeys)&&key(s.id)&&TERRAINS.includes(s.terrain)&&(s.parentId===null||key(s.parentId)&&s.parentId!==s.id),'空间地点字段无效。');witness(s);
  if(snapshot){fail(byId.get(s.id)?.kind==='place'&&(s.parentId===null||byId.get(s.parentId)?.kind==='place'),'空间记录引用了不存在的地点。');fail(s.quote.includes(byId.get(s.id).name),'空间地点缺少名称依据。');if(s.parentId)fail(s.quote.includes(byId.get(s.parentId).name),'空间归属缺少正文依据。');}
 }
 for(const r of update.relations){
  fail(exact(r,snapshot?[...relationKeys,'sourceVersion']:relationKeys)&&key(r.id)&&key(r.from)&&key(r.to)&&r.from!==r.to&&['relative','route'].includes(r.kind)&&(r.bearing===null||Object.hasOwn(BEARINGS,r.bearing))&&(r.distanceMeters===null||Number.isFinite(r.distanceMeters)&&r.distanceMeters>0&&r.distanceMeters<=1e8)&&['open','blocked','unknown'].includes(r.passage)&&typeof r.bidirectional==='boolean'&&text(r.label,100),'空间关系字段无效。');
  fail(r.kind!=='relative'||r.bearing!==null&&r.passage==='unknown'&&!r.bidirectional,'相对方位不能充当通行许可。');witness(r);
  if(snapshot){fail(byId.get(r.from)?.kind==='place'&&byId.get(r.to)?.kind==='place','空间关系引用了不存在的地点。');fail(r.quote.includes(byId.get(r.from).name)&&r.quote.includes(byId.get(r.to).name),'空间关系缺少两端地点依据。');
   if(r.kind==='relative'){
    const claims=relativeClaims(entities,[r.quote]).filter(c=>c.from===r.from&&c.to===r.to);
    const relevant=r.quote.split(/[。！\n]/).filter(s=>s.includes(byId.get(r.from).name)&&s.includes(byId.get(r.to).name)).join('');
    const bearings=relevant.match(/东北|东南|西北|西南|东|西|南|北/g)||[];
    fail(claims.length?claims.some(c=>c.bearing===r.bearing&&(r.distanceMeters===null||c.distanceMeters===null||c.distanceMeters===r.distanceMeters)):!/(?:不在|并非|不位于|未必|假如|如果|可能|据说|听说)/.test(relevant)&&bearings.includes(BEARING_NAMES[r.bearing]),'方位或距离与正文地点关系不符。');
   }
   if(r.kind==='route'&&r.passage==='open'){const relevant=r.quote.split(/[。！\n]/).filter(s=>s.includes(byId.get(r.from).name)&&s.includes(byId.get(r.to).name)).join('');fail(!/(?:封锁|锁死|禁止通行|无法通行|不能通过|不通)/.test(relevant.replace(/(?:解除|取消|不再|没有)(?:封锁|锁死|禁止通行)|(?:封锁|禁止通行)(?:已|已经)?(?:解除|取消)/g,'')),'已封锁道路不能标为可通行。');}
  }
  if(r.bearing)fail(r.quote.includes(BEARING_NAMES[r.bearing]),'方位缺少正文依据。');
  if(r.distanceMeters!==null){const amounts=[...r.quote.matchAll(/(\d+(?:\.\d+)?)\s*(公里|千米|米)/g)].map(m=>Number(m[1])*(m[2]==='米'?1:1000));fail(amounts.includes(r.distanceMeters),'距离缺少正文测距依据。');}
 }
 if(snapshot){
  const sites=new Map(update.sites.map(s=>[s.id,s]));
  for(const s of update.sites){const seen=new Set([s.id]);let parent=s.parentId;while(parent){fail(!seen.has(parent),'空间归属形成循环。');seen.add(parent);parent=sites.get(parent)?.parentId;}}
  for(const r of update.relations.filter(r=>r.kind==='relative'))fail((sites.get(r.from)?.parentId??null)===(sites.get(r.to)?.parentId??null),'不同空间层级不能混用方位和比例。');
  // Run the same constraint solver used by rendering before accepting any facts.
  for(const scope of new Set([null,...update.sites.map(s=>s.parentId)]))solveFrame(entities,update,scope);
 }
}

export function advanceSpatial(previous,update,entities,nextVersion){
 if(previous===undefined&&update==null)return undefined;
 validateSpatial(update);
 const result=structuredClone(previous??{schemaVersion:1,sites:[],relations:[]});
 for(const kind of ['sites','relations'])for(const record of update?.[kind]??[]){
  const old=result[kind].find(r=>r.id===record.id);
  if(old){
   const stable=kind==='sites'?['parentId','terrain']:['from','to','kind','bearing','distanceMeters','bidirectional'];
   for(const k of stable)if(old[k]!==null&&!(k==='terrain'&&old[k]==='landmark'))fail(old[k]===record[k], '已有空间关系不能被重新生成改写。');
   Object.assign(old,structuredClone(record),{sourceVersion:nextVersion});
  }else result[kind].push({...structuredClone(record),sourceVersion:nextVersion});
 }
 validateSpatial(result,undefined,{snapshot:true,entities,version:nextVersion});return result;
}

// Difference constraints enforce all compass facts together, including cycles.
function axisCoordinates(ids,relations,axis){
 const values=new Map(ids.map(id=>[id,0])),edges=[];
 for(const r of relations){const sign=BEARINGS[r.bearing][axis];if(sign>0)edges.push([r.from,r.to,1]);else if(sign<0)edges.push([r.to,r.from,1]);else edges.push([r.from,r.to,0],[r.to,r.from,0]);}
 for(let i=0;i<=ids.length;i++){let changed=false;for(const [a,b,d] of edges)if(values.get(b)<values.get(a)+d){values.set(b,values.get(a)+d);changed=true;}if(!changed)return values;fail(i<ids.length,'地图方位相互矛盾，旧地理已保留。');}
 return values;
}
function measuredCoordinates(ids,relations){
 // A direct straight-line distance cannot exceed any path of other measured
 // distances. Reject provable conflicts before any numerical fallback.
 const indexById=new Map(ids.map((id,i)=>[id,i]));
 const upper=ids.map((_,i)=>Float64Array.from(ids.map((__,j)=>i===j?0:Infinity)));
 for(const r of relations){const a=indexById.get(r.from),b=indexById.get(r.to);upper[a][b]=upper[b][a]=Math.min(upper[a][b],r.distanceMeters);}
 for(let k=0;k<ids.length;k++)for(let i=0;i<ids.length;i++){if(!Number.isFinite(upper[i][k]))continue;for(let j=0;j<ids.length;j++)upper[i][j]=Math.min(upper[i][j],upper[i][k]+upper[k][j]);}
 for(const r of relations)fail(r.distanceMeters-upper[indexById.get(r.from)][indexById.get(r.to)]<Math.max(0.001,r.distanceMeters*1e-7),'地图测距违反距离约束，旧地理已保留。');
 const ordered=[...relations].sort((a,b)=>a.bearing.length-b.bearing.length||a.id.localeCompare(b.id));
 const x=axisCoordinates(ids,ordered,0),y=axisCoordinates(ids,ordered,1),unit=Math.min(...ordered.map(r=>r.distanceMeters));
 const positions=new Map(ids.map(id=>[id,{x:x.get(id)*unit,y:y.get(id)*unit}]));
 const groups=new Map(),components=[];
 // Exact cardinal constraints are rigid components, solved without iteration.
 for(const root of ids){if(groups.has(root))continue;const group=[root],index=components.length;groups.set(root,index);
  for(let i=0;i<group.length;i++){const id=group[i],p=positions.get(id);for(const r of ordered.filter(r=>r.bearing.length===1&&(r.from===id||r.to===id))){const sign=r.from===id?1:-1,to=sign===1?r.to:r.from,[dx,dy]=BEARINGS[r.bearing],next={x:p.x+dx*r.distanceMeters*sign,y:p.y+dy*r.distanceMeters*sign};if(groups.has(to)){const old=positions.get(to);fail(Math.hypot(old.x-next.x,old.y-next.y)<0.001,'地图测距相互矛盾，旧地理已保留。');}else{groups.set(to,index);group.push(to);positions.set(to,next);}}}components.push(group);
 }
 for(const r of ordered.filter(r=>groups.get(r.from)===groups.get(r.to))){const a=positions.get(r.from),b=positions.get(r.to);fail(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-r.distanceMeters)<Math.max(0.001,r.distanceMeters*1e-7),'地图测距相互矛盾，旧地理已保留。');}
 // Two measurements to an already rigid frame locate another component by
 // circle intersection; this also handles very thin, valid triangles exactly.
 for(let index=1;index<components.length;index++){
  const group=components[index],base=positions.get(group[0]),anchors=[];
  for(const r of ordered){const inside=group.includes(r.from)?r.from:group.includes(r.to)?r.to:null;if(!inside)continue;const outside=r.from===inside?r.to:r.from;if(groups.get(outside)>=index)continue;const p=positions.get(inside),a=positions.get(outside);anchors.push({x:a.x-(p.x-base.x),y:a.y-(p.y-base.y),radius:r.distanceMeters,r,inside,outside});}
  let placed=false;
  for(let i=0;i<anchors.length&&!placed;i++)for(let j=i+1;j<anchors.length&&!placed;j++){
   const a=anchors[i],b=anchors[j];if(groups.get(a.outside)!==groups.get(b.outside))continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<1e-8)continue;
   const along=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),height2=a.radius*a.radius-along*along;if(height2<-0.001)continue;
   const height=Math.sqrt(Math.max(0,height2));
   for(const sign of [1,-1]){const point={x:a.x+along*dx/d-sign*height*dy/d,y:a.y+along*dy/d+sign*height*dx/d};
    const valid=anchors.every(anchor=>{const r=anchor.r,p=positions.get(anchor.inside),outer=positions.get(anchor.outside),inner={x:p.x+point.x-base.x,y:p.y+point.y-base.y},from=r.from===anchor.inside?inner:outer,to=r.to===anchor.inside?inner:outer,[sx,sy]=BEARINGS[r.bearing];return Math.abs(Math.hypot(point.x-anchor.x,point.y-anchor.y)-anchor.radius)<0.001&&(sx===0?Math.abs(to.x-from.x)<0.001:(to.x-from.x)*sx>0)&&(sy===0?Math.abs(to.y-from.y)<0.001:(to.y-from.y)*sy>0);});
    if(valid){const shift={x:point.x-base.x,y:point.y-base.y};for(const id of group){const p=positions.get(id);p.x+=shift.x;p.y+=shift.y;}placed=true;break;}
   }
  }
 }
 // Cardinal bearings constrain an axis; diagonal bearings constrain a quadrant,
 // not a fabricated 45-degree angle. Project exact distance constraints until
 // they agree, then verify the residual before accepting the world facts.
 const desired=r=>{const a=positions.get(r.from),b=positions.get(r.to),[sx,sy]=BEARINGS[r.bearing];let dx=b.x-a.x,dy=b.y-a.y;
  if(!sx)return {dx:0,dy:sy*r.distanceMeters};if(!sy)return {dx:sx*r.distanceMeters,dy:0};
  dx=sx*Math.max(Math.abs(dx),r.distanceMeters*0.0001);dy=sy*Math.max(Math.abs(dy),r.distanceMeters*0.0001);const scale=r.distanceMeters/Math.hypot(dx,dy);return {dx:dx*scale,dy:dy*scale};};
 for(let n=0;n<1600;n++){let error=0;for(const r of ordered){const a=positions.get(r.from),b=positions.get(r.to),d=desired(r),dx=(b.x-a.x-d.dx)/2,dy=(b.y-a.y-d.dy)/2;error=Math.max(error,Math.hypot(dx,dy)/Math.max(1,r.distanceMeters));a.x+=dx;a.y+=dy;b.x-=dx;b.y-=dy;}if(error<1e-10)break;}
 // Non-convergence is not proof that the story is impossible. Keep the facts
 // and fall back to a bearing-only map rather than rejecting a valid turn.
 for(const r of ordered){const a=positions.get(r.from),b=positions.get(r.to),d=desired(r);if(Math.hypot(b.x-a.x-d.dx,b.y-a.y-d.dy)>=Math.max(0.001,r.distanceMeters*1e-7))return null;}
 // Translation is arbitrary; fix a stable origin so current position never
 // changes the layout and coordinate magnitudes stay bounded.
 const origin={...positions.get(ids[0])};for(const p of positions.values()){p.x-=origin.x;p.y-=origin.y;}return positions;
}
function solveFrame(entities,atlas,scope){
 const siteById=new Map((atlas?.sites??[]).map(s=>[s.id,s]));
 const places=entities.filter(e=>e.kind==='place'&&(siteById.get(e.id)?.parentId??null)===scope).sort((a,b)=>a.id.localeCompare(b.id));
 const ids=new Set(places.map(e=>e.id)),relations=(atlas?.relations??[]).filter(r=>r.kind==='relative'&&ids.has(r.from)&&ids.has(r.to));
 axisCoordinates([...ids],relations,0);axisCoordinates([...ids],relations,1);
 const components=[],seen=new Set();
 for(const start of [...ids]){if(seen.has(start))continue;const group=[],queue=[start];seen.add(start);while(queue.length){const id=queue.shift();group.push(id);for(const r of relations.filter(r=>r.from===id||r.to===id)){const to=r.from===id?r.to:r.from;if(!seen.has(to)){seen.add(to);queue.push(to);}}}components.push(group);}
 // Never pretend disconnected groups share a physical frame.
 components.sort((a,b)=>b.length-a.length||a[0].localeCompare(b[0]));
 const measured=relations.filter(r=>r.distanceMeters!==null),measuredSeen=new Set();
 for(const start of [...ids]){if(measuredSeen.has(start))continue;const group=[start];measuredSeen.add(start);for(let i=0;i<group.length;i++)for(const r of measured.filter(r=>r.from===group[i]||r.to===group[i])){const to=r.from===group[i]?r.to:r.from;if(!measuredSeen.has(to)){measuredSeen.add(to);group.push(to);}}const links=measured.filter(r=>group.includes(r.from));if(links.length)measuredCoordinates(group,links);}
 return {places,relations,components,siteById};
}
export function projectSpatialMap(game,{scope=null,anchorId=null}={}){
 const atlas=game.spatial??{sites:[],relations:[]},frame=solveFrame(game.entities??[],atlas,scope);
 const group=frame.components.find(g=>anchorId&&g.includes(anchorId))??frame.components[0]??[];
 const relations=frame.relations.filter(r=>group.includes(r.from));
 const x=axisCoordinates(group,relations,0),y=axisCoordinates(group,relations,1);
 const measured=relations.length>0&&relations.every(r=>r.distanceMeters!==null)?measuredCoordinates(group,relations):null;
 const metric=!!measured,positions=measured??new Map(group.map(id=>[id,{x:x.get(id),y:y.get(id)}]));
 return {...frame,scope,positions,metric,relations,routes:(atlas.relations??[]).filter(r=>r.kind==='route'&&group.includes(r.from)&&group.includes(r.to)),unplaced:frame.places.map(e=>e.id).filter(id=>!positions.has(id))};
}

// Conservative read-only recovery for legacy stories. No name guessing, vague
// left/right, rumours, route permissions or mutations of committed snapshots.
function relativeClaims(entities,sources){
 const places=entities.filter(e=>e.kind==='place'&&e.name.length>=2),relations=[];
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const sentence of [...new Set(sources.filter(s=>typeof s==='string').flatMap(s=>s.split(/[。！\n，；]/)))] ){
  if(/[“”「」]|听说|据说|似乎|可能|也许|如果|并不|并非|不在|不是/.test(sentence))continue;
  const mentioned=places.filter(p=>sentence.includes(p.name));
  for(const a of mentioned)for(const b of mentioned){if(a.id===b.id||places.filter(p=>p.name===a.name).length!==1||places.filter(p=>p.name===b.name).length!==1)continue;
   const direction='(?:以|正)?(东北|东南|西北|西南|东|西|南|北)(?![东西南北])(?:侧|面|方|边)?(?:约)?(?:(\\d+(?:\\.\\d+)?)\\s*(公里|千米|米))?';
   const match=sentence.match(new RegExp(`${escape(a.name)}(?:位于|坐落在|在)${escape(b.name)}(?:的)?${direction}`))||sentence.match(new RegExp(`${escape(b.name)}(?:的)?${direction}(?:处)?(?:是|就是|便是|有)${escape(a.name)}`))||sentence.match(new RegExp(`从${escape(b.name)}(?:出发)?(?:向|往|朝)${direction}[^。；，]{0,12}(?:到达|就是|便是)${escape(a.name)}`));
   if(!match)continue;const bearing=Object.keys(BEARING_NAMES).find(k=>BEARING_NAMES[k]===match[1]);
   relations.push({id:`recovered-${relations.length}`,from:b.id,to:a.id,kind:'relative',bearing,distanceMeters:match[2]?Number(match[2])*(match[3]==='米'?1:1000):null,passage:'unknown',bidirectional:false,label:'',quote:sentence});
  }
 }
 return relations;
}
export function recoverSpatial(entities,sources){
 const relations=relativeClaims(entities,sources);
 if(!relations.length)return undefined;
 const spatial={schemaVersion:1,sites:[],relations};
 try{projectSpatialMap({entities,spatial});return spatial;}catch{return undefined;}
}

export function publicSpatial(game,sources){
 const recovered=recoverSpatial(game.entities??[],sources);
 if(!game.spatial)return recovered;
 const merged=structuredClone(game.spatial);
 for(const candidate of recovered?.relations??[]){
  if(merged.relations.some(r=>r.kind==='relative'&&((r.from===candidate.from&&r.to===candidate.to)||(r.from===candidate.to&&r.to===candidate.from))))continue;
  const record={...candidate,id:`recovered-${candidate.from}-${candidate.to}`};
  const trial={...merged,relations:[...merged.relations,record]};
  try{for(const scope of new Set([null,...trial.sites.map(s=>s.parentId)]))projectSpatialMap({...game,spatial:trial},{scope});merged.relations.push(record);}catch{/* Committed geography always wins over a legacy projection. */}
 }
 return merged;
}
