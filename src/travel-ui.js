import {gameRecallState} from './game-query.js';
import {resolveGameAction} from './game-state.js';
import {currentMapPlace,mapLayout} from './map-layout.js';
import {spatialMapView} from './spatial-map-view.js';
import {journeyOptions,clockMinutes} from './journey-state.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>typeof value==='string'?value.slice(0,200):'';
const bounded=(value,min,max,fallback=0)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const field=(object,key)=>(object?.fields??[]).find(f=>f.key===key)?.value||'';
const button=(label,action,attrs='')=>`<button type="button" class="btn compact" data-action="${action}" ${attrs}>${esc(label)}</button>`;

// Preferences are deliberately outside branch.personal and contain no world state.
export function normalizeTravelView(value={}){
 return {level:['place','region','world'].includes(value.level)?value.level:'region',selectedId:text(value.selectedId),routeId:text(value.routeId),panel:['detail','routes','known'].includes(value.panel)?value.panel:'detail',zoom:bounded(value.zoom,1,3,1),scrollLeft:bounded(value.scrollLeft,0,100000),scrollTop:bounded(value.scrollTop,0,100000),contentScroll:bounded(value.contentScroll,0,100000),anchorId:text(value.anchorId),scopeOverride:value.scopeOverride===null?null:typeof value.scopeOverride==='string'?text(value.scopeOverride):undefined,listOpen:value.listOpen===true};
}

export function travelWarnings(state,situation,route){
 const objects=situation?.objects??state.experience?.objects??[],destination=state.game?.entities?.find(e=>e.id===route.to),warnings=[];
 if(!destination)return warnings;
 const agreements=objects.filter(o=>o.kind==='agreement'&&['已接受','已答应','已约定','进行中','accepted','active'].includes(o.status)&&o.certainty==='confirmed'&&((o.relatedIds??[]).includes(destination.id)||field(o,'location')===destination.name));
 for(const agreement of agreements){
  if(/送|交还|归还|交付|带给/.test(agreement.name+' '+agreement.summary+' '+field(agreement,'purpose'))){
   for(const item of objects.filter(o=>o.kind==='item'&&(agreement.relatedIds??[]).includes(o.id))){
    const where=field(item,'location');
    if(!where||/^(身上|随身|背包|你身上)$/.test(where)||state.inventory?.includes(item.name))continue;
    if(!warnings.some(w=>w.itemId===item.id))warnings.push({kind:'item',itemId:item.id,text:`${item.name}${item.sourceVersion<state.version?'上次记载在':'还在'}${where}。`,draft:`先确认并带上${item.name}，再${`沿${route.label}前往${destination.name}`}。`});
   }
  }
  const deadline=field(agreement,'deadline'),start=clockMinutes(state.experience?.clock),label=state.experience?.clock?.label||'';
  const match=deadline.match(/^(?:(?:今天|今日|当天)\s*)?(\d{1,2}):(\d{2})$/),sameDate=label.replace(/\d{1,2}:\d{2}.*/, '').trim();
  const dated=!match&&sameDate&&deadline.startsWith(sameDate)?deadline.slice(sameDate.length).trim().match(/^(\d{1,2}):(\d{2})$/):null,clock=match||dated;
  if(clock&&start!==null&&route.includesWaiting&&route.minutesMax!==null&&Number(clock[1])<24&&Number(clock[2])<60){
   const limit=Number(clock[1])*60+Number(clock[2]);
   if(limit>=start&&start+route.minutesMax>limit)warnings.push({kind:'deadline',text:`按当前估计可能晚于「${agreement.name}」的已知约定：${deadline}。`});
  }
 }
 return warnings;
}

export function travelModel(state,situation={},preferences={},context={}){
 const view=normalizeTravelView(preferences),projection=gameRecallState(state,situation),game=projection.game;
 const uncertainPlaces=(situation.objects??[]).filter(o=>o.kind==='location'&&['reported','inferred','unknown'].includes(o.certainty)&&!state.game?.entities?.some(e=>e.id===o.id));
 const uncertainIds=new Set(uncertainPlaces.map(o=>o.id));
 const allPlaces=game.entities.filter(e=>e.kind==='place'&&!uncertainIds.has(e.id)),byId=new Map(allPlaces.map(p=>[p.id,p])),sites=game.spatial?.sites??[],siteById=new Map(sites.map(s=>[s.id,s]));
 const currentId=currentMapPlace(allPlaces,state.location,state.version),ancestors=[];
 let at=currentId;while(at&&!ancestors.includes(at)){ancestors.push(at);at=siteById.get(at)?.parentId;}
 const children=id=>allPlaces.filter(p=>siteById.get(p.id)?.parentId===id);
 const placeScope=ancestors.find(id=>siteById.get(id)?.terrain!=='region'&&children(id).length>=2),regionScope=ancestors.find(id=>siteById.get(id)?.terrain==='region')??siteById.get(currentId)?.parentId??null;
 if(view.level==='place'&&!placeScope)view.level='region';
 let scope=view.level==='world'?null:view.level==='place'?placeScope:regionScope;
 if(view.scopeOverride===null||byId.has(view.scopeOverride))scope=view.scopeOverride;
 const places=allPlaces.filter(p=>(siteById.get(p.id)?.parentId??null)===scope),ids=new Set(places.map(p=>p.id));
 const frameCurrent=ancestors.find(id=>ids.has(id))||currentId;
 if(view.selectedId&&!byId.has(view.selectedId)){view.selectedId='';view.routeId='';view.panel='detail';}
 if(view.selectedId===currentId&&view.panel==='routes'){view.panel='detail';view.routeId='';}
 const selected=byId.get(view.selectedId),routes=selected?journeyOptions(state,selected.id):[];
 const legacy=[];
 if(!context.historical&&selected)for(const surface of state.game?.surfaces??[]){if(surface.kind!=='map')continue;for(const action of surface.actions??[]){
  if(action.destination!==selected.id)continue;const ref={branchId:context.branchId||'preview',version:state.version,surfaceId:surface.id,actionId:action.id};let reason='';
  try{resolveGameAction(state,ref,{branchId:ref.branchId});}catch(error){reason=error.message;}
  legacy.push({surface,action,reason,ref});
 }}
 const links=[...(game.surfaces??[]).flatMap(s=>s.kind==='map'?s.links??[]:[]),...(game.spatial?.relations??[]).filter(r=>r.kind==='route'),...(state.game?.journeys?.routes??[]).flatMap(r=>{const path=[r.from,...r.via,r.to];return path.slice(1).map((to,i)=>({from:path[i],to,label:r.label}));})].filter(l=>ids.has(l.from)&&ids.has(l.to));
 const topology=!(game.spatial?.relations??[]).some(r=>r.kind==='relative'&&ids.has(r.from)&&ids.has(r.to));
 const transit=state.game?.journeys?.transit;
 return {state,game,situation,view,places,allPlaces,uncertainPlaces,currentId,frameCurrent,scope,scopeName:byId.get(scope)?.name||'已知地图',placeEnabled:!!placeScope,selected,routes,legacy,links,topology,transit:transit&&!transit.completed&&transit.locationId===currentId?transit:null,...context};
}

function topologyView(m){
 // Root by stable identity rather than player position: travel cannot rearrange roads.
 const sorted=[...m.places].sort((a,b)=>a.id.localeCompare(b.id)),layout=mapLayout(sorted,m.links,sorted[0]?.id),byId=new Map(m.places.map(p=>[p.id,p]));
 const edges=layout.edges.map(e=>{const a=layout.positions.get(e.from),b=layout.positions.get(e.to);return `<g><path d="M${a.x} ${a.y}L${b.x} ${b.y}"/><title>${esc(e.label||'已知连接')}</title></g>`;}).join('');
 const places=[...layout.positions].map(([id,p])=>{const entity=byId.get(id),current=id===m.frameCurrent;return `<button type="button" class="travel-map-place${current?' is-current':''}" data-action="travel-select" data-entity="${esc(id)}" aria-pressed="${id===m.view.selectedId}" style="left:${p.x/layout.width*100}%;top:${p.y/layout.height*100}%"><span>${esc(entity.name)}</span>${current?'<small>当前位置</small>':''}</button>`;}).join('');
 return `<div class="travel-map-caption"><strong>${esc(m.scopeName)}</strong><span>连接示意 · 不表示方向或距离</span></div><div class="atlas-viewport travel-topology-viewport" tabindex="0" role="region" aria-label="地图，可拖动；也可使用地点列表"><div class="atlas-canvas travel-topology-canvas" data-zoom="1" style="--travel-map-ratio:${layout.width} / ${layout.height}"><svg viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${edges}</svg>${places}${m.places.length?'':'<p class="travel-empty">这一层还没有已知地点。</p>'}</div></div>`;
}
function routeView(m){
 const byId=new Map(m.game.entities.map(e=>[e.id,e]));
 const cards=m.routes.map(option=>{
  const {route,arrival,available,reason}=option,time=route.minutesMin===null?'耗时未确认':`约 ${route.minutesMin}${route.minutesMin===route.minutesMax?'':'–'+route.minutesMax} 分钟`;
  const free=/免费|不花钱|无需付费|不收费/.test(route.quote),cost=route.costs.length?route.costs.map(c=>`${c.amount} ${byId.get(c.entityId)?.unit||byId.get(c.entityId)?.name||'已知资源'}`).join(' + '):free?'不花钱（当前报价）':'未记录费用';
  const deficits=route.costs.map(c=>{const e=byId.get(c.entityId),gap=c.amount-(e?.value??0);return gap>0?`还差 ${Number(gap.toFixed(8))} ${e?.unit||e?.name||'资源'}`:'';}).filter(Boolean);
  return `<article class="travel-route${m.view.routeId===route.id?' is-selected':''}">${button(route.label,'travel-route',`data-route="${esc(route.id)}" aria-pressed="${m.view.routeId===route.id}"${m.historical?' disabled':''}`)}<p class="travel-route-price">${esc(time)} · ${route.costs.length?'已知费用 ':''}${esc(cost)}</p><p>${route.includesWaiting?'已计入已知等待时间':'等待时间未计入，抵达时刻未确认'}</p>${arrival?`<p>按当前估计，约 ${esc(arrival)} 抵达</p>`:''}${route.via.length?`<p>途经：${route.via.map(id=>esc(byId.get(id)?.name||'已知地点')).join(' → ')}</p>`:''}${route.detail&&route.detail!==route.quote?`<p>${esc(route.detail)}</p>`:''}${deficits.length?`<p class="travel-warning">${esc(deficits.join('；'))}</p>`:''}${!available?`<p class="travel-warning">${esc(reason)}</p>`:''}<details><summary>路线依据</summary><blockquote>${esc(route.quote)}</blockquote></details></article>`;
 }).join('');
 const chosen=m.routes.find(o=>o.route.id===m.view.routeId),warnings=chosen?travelWarnings(m.state,m.situation,chosen.route):[];
 const warningHtml=warnings.map(w=>`<p class="travel-warning">${esc(w.text)}</p>${w.draft?button('先带上它（写入草稿）','travel-carry-draft',`data-item="${esc(w.itemId)}"`):''}`).join('');
 const legacy=m.legacy.map(({surface,action,reason})=>`<article class="travel-route"><strong>${esc(action.label)}</strong><p>已有行动 · 耗时与完整费用未确认</p>${reason?`<p class="travel-warning">${esc(reason)}</p>`:''}${button('按已有行动前往','game-act',`data-branch="${esc(m.branchId)}" data-version="${m.state.version}" data-surface="${esc(surface.id)}" data-action-id="${esc(action.id)}"${reason||m.busy?' disabled':''}`)}</article>`).join('');
 return `<div class="travel-routes">${cards||'<p>目前不知道具体路线。</p>'}${legacy}${!cards&&!legacy&&!m.historical?button('打听路线（写入草稿）','travel-ask'):''}${!m.historical&&chosen?`<div class="travel-departure">${warningHtml}${button(warnings.length?'仍然直接出发':`沿${chosen.route.label}出发`,'travel-depart',`data-route="${esc(chosen.route.id)}" data-branch="${esc(m.branchId)}" data-version="${m.state.version}"${!chosen.available||m.busy?' disabled':''}`)}${!chosen.available?button('重新核对路线（写入草稿）','travel-recheck'):''}</div>`:''}</div>`;
}

function unplacedView(m){
 if(m.view.level!=='world'||!m.uncertainPlaces.length)return '';
 return `<details class="travel-rumors"><summary>尚未定位的消息</summary>${m.uncertainPlaces.map(p=>`<p><strong>${esc(p.name)}</strong> · ${p.certainty==='reported'?'他人说法':'尚未确认'}</p><p>${esc(p.summary||'具体位置与路线尚不明确。')}</p>`).join('')}</details>`;
}
export function travelView(m){
 const {view,selected}=m,detail=selected?`<section class="travel-detail" data-selected-place="${esc(selected.id)}"><div class="travel-detail-heading"><h3>${esc(selected.name)}</h3>${button('取消选中','travel-clear','aria-label="取消选中地点"')}</div>${view.panel==='routes'?routeView(m):`<p>${esc(selected.detail||'目前只知道这个地点。')}</p>${selected.id===m.currentId?'<p class="small muted">你在这里</p>':''}<div class="travel-detail-actions">${!m.historical&&selected.id!==m.currentId?button('比较路线','travel-compare'):''}${button(view.panel==='known'?'收起已知情况':'查看已知情况','travel-known')}</div>${view.panel==='known'?`<dl><dt>已知状态</dt><dd>${esc(selected.status||'已知地点')}</dd></dl>${selected.quote?`<blockquote>${esc(selected.quote)}</blockquote>`:''}<p class="small muted">地点与消息按已保存的记录展示；人物位置以当前目击为准。</p>`:''}`}</section>`:'<div class="travel-detail travel-empty"><p>选一个地点，查看已知情况与路线。</p></div>';
 const map=m.topology?topologyView(m):spatialMapView(m.game,{location:m.allPlaces.find(p=>p.id===m.frameCurrent)?.name||m.state.location,version:m.state.version,scope:m.scope,anchorId:view.anchorId||m.frameCurrent,links:m.links});
 return `<section class="travel-panel" data-travel-panel data-history="${!!m.historical}"><div class="travel-status"><span>${m.historical?'历史视图 · 只读':'当前位置'} · ${esc(m.state.location||'地点未说明')}${m.state.experience?.clock?.label?' · '+esc(m.state.experience.clock.label):''}</span>${m.historical?button('返回当前地图','travel-current'):m.historyNode?button('查看当时地图','travel-history',`data-node="${esc(m.historyNode)}"`):''}</div>${m.busy?'<p class="travel-warning">故事正在推进，以下是最近已成立的情况；推进期间不能出发。</p>':''}<nav class="travel-levels" aria-label="地图层级">${[['place','当前场所'],['region','地区'],['world','世界']].map(([key,label])=>button(label,'travel-level',`data-level="${key}" aria-pressed="${view.level===key}"${key==='place'&&!m.placeEnabled?' disabled title="当前场所暂无分区"':''}`)).join('')}${button(view.listOpen?'收起地点列表':'地点列表','travel-list',`aria-expanded="${view.listOpen}"`)}</nav>${m.transit?`<p class="travel-transit">途中停在 ${esc(m.state.location)}。${esc(m.transit.quote)}<span>新的剩余路线需以当前停点核对。</span></p>`:''}<div class="travel-layout"><div class="travel-map-area">${map}<div class="travel-map-tools">${button('回到当前位置','travel-home')}${button('−','map-zoom','data-factor="0.8" aria-label="缩小地图"')}${button('适应','map-zoom','data-factor="reset"')}${button('＋','map-zoom','data-factor="1.25" aria-label="放大地图"')}</div><div class="travel-place-list"${view.listOpen?'':' hidden'} aria-label="这一层的已知地点">${m.places.map(p=>button(p.name,'travel-select',`data-entity="${esc(p.id)}" aria-pressed="${p.id===view.selectedId}"`)).join('')||'<p>这一层暂无已知地点。</p>'}</div></div>${detail}</div>${unplacedView(m)}</section>`;
}
