// Public, declarative scene components. Never infer rules, links or missing numbers.
import {resolveGameAction} from './game-state.js';
import {gameQuery} from './game-query.js';
import {mapLayout,currentMapPlace} from './map-layout.js';
import {adaptiveSurfaces} from './adaptive-surfaces.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const labels={status:'状态',map:'地点与路线',inventory:'物品',clues:'线索',objectives:'目标',interaction:'眼前的选择',timeline:'时间与约定',people:'相关人物',comparison:'对照与取舍'};
const kinds={meter:'状态',item:'物品',place:'地点',clue:'线索',objective:'目标',actor:'人物'};
const quantity=e=>numeric(e.value)?`${e.value}${numeric(e.max)?` / ${e.max}`:''}${e.unit?` ${e.unit}`:''}`:'';
const inspect=(e,node,label=e.name)=>`<button type="button" class="game-inspect" data-action="game-inspect" data-entity="${esc(e.id)}" data-node="${esc(node)}">${esc(label)}</button>`;
const detail=e=>`${e.detail?`<p class="game-detail">${esc(e.detail)}</p>`:''}${e.status?`<span class="game-entity-status">${esc(e.status)}</span>`:''}`;
function progress(e){
  if(!numeric(e.value)||!numeric(e.max)||e.max<=0)return '';
  return `<progress class="game-progress" value="${Math.max(0,Math.min(e.max,e.value))}" max="${e.max}" aria-label="${esc(e.name)}：${esc(quantity(e))}">${esc(quantity(e))}</progress>`;
}

function mapView(surface,entities,node,location,version){
  const resources=entities.filter(e=>e.kind!=='place');
  const places=entities.filter(e=>e.kind==='place'),current=currentMapPlace(places,location,version);
  entities=places.map(e=>({...e,status:e.id===current?'当前所在':['当前位置','当前所在'].includes(e.status)?'已知地点':e.status}));
  const connected=new Set(list(surface.links).flatMap(l=>[l.from,l.to]));
  const diagramEntities=connected.size?entities.filter(e=>connected.has(e.id)||e.id===current):entities;
  const unplaced=entities.length-diagramEntities.length;
  const {width,height,positions,edges:links}=mapLayout(diagramEntities,list(surface.links),current);
  const byId=new Map(entities.map(e=>[e.id,e]));
  const diagram=diagramEntities.length?`<div class="game-map-viewport" tabindex="0" role="region" aria-label="可滚动的地点路线图"><div class="game-map-canvas" style="width:${width}px;height:${height}px"><svg class="game-map-diagram" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${links.map(link=>{const a=positions.get(link.from),b=positions.get(link.to),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,x=b.x-dx/d*59,y=b.y-dy/d*59,angle=Math.atan2(dy,dx)*180/Math.PI;return `<g><title>${esc(link.label)}</title><line x1="${a.x}" y1="${a.y}" x2="${x}" y2="${y}"/><path class="game-map-arrow" d="M -7 -4 L 0 0 L -7 4" transform="translate(${x} ${y}) rotate(${angle})"/><text class="game-map-route-label" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2-5}"><tspan x="${(a.x+b.x)/2}">${esc((link.label||'已知连接').slice(0,6))}</tspan><tspan x="${(a.x+b.x)/2}" dy="15">${esc((link.label||'').slice(6,12))}${(link.label||'').length>12?'…':''}</tspan></text></g>`;}).join('')}${diagramEntities.map(e=>{const p=positions.get(e.id);return `<g${e.id===current?' class="game-map-current"':''}><circle cx="${p.x}" cy="${p.y-58}" r="5"/></g>`;}).join('')}</svg>${diagramEntities.map(e=>{const p=positions.get(e.id);return `<button type="button" class="game-map-node${e.id===current?' is-current':''}" data-action="game-inspect" data-entity="${esc(e.id)}" data-node="${esc(node)}" ${e.id===current?'aria-current="location"':''} style="left:${p.x}px;top:${p.y}px" title="${esc(e.name+' · '+(e.detail||e.status))}"><span class="game-map-node-label">${esc(e.name)}</span><span class="game-map-node-status">${esc(e.id===current?'你在这里':e.status||'已知地点')}</span></button>`;}).join('')}</div></div>`:'';
  return `<div class="game-map-toolbar"><span>${entities.length} 个已知地点 · ${links.length} 条连接</span><button type="button" class="btn compact" data-action="game-map-expand" data-node="${esc(node)}">展开地图 ↗</button></div><div class="game-map">${diagram}<details class="game-map-records"><summary>地点详情与完整路线${unplaced?` · ${unplaced} 个地点的连接未记录`:''}</summary><ol class="game-map-places">${entities.map(e=>`<li>${inspect(e,node)}${detail(e)}</li>`).join('')}</ol>${links.length?`<ul class="game-map-links" aria-label="正文已知的连接">${links.map(link=>`<li>${inspect(byId.get(link.from),node)}<span aria-hidden="true"> → </span><span class="game-sr-only">通向</span>${inspect(byId.get(link.to),node)}${link.label?`<span class="game-route-label">${esc(link.label)}</span>`:''}</li>`).join('')}</ul>`:''}</details></div>${!links.length?'<p class="game-empty-note">地点间的路线尚未明确，暂不连线。</p>':''}<p class="game-footnote">示意连接，不表示距离或实际方位。箭头沿用记录方向，不代表安全可达。点地点查看资料；窄屏可横向滑动。</p>${resources.length?`<div class="game-map-resources" aria-label="路线相关的已知资料">${resources.map(e=>`<div>${inspect(e,node)}${quantity(e)?`<span class="game-quantity">${esc(quantity(e))}</span>`:''}${detail(e)}</div>`).join('')}</div>`:''}`;
}

const certaintyLabels={confirmed:'已确认',reported:'他人说法',inferred:'推测',unknown:'尚不清楚'};
const fieldLabels={scheduledAt:'约定时间',actualAt:'实际时间',occurredAt:'发生时间',learnedAt:'获知时间',deadline:'截止条件',duration:'持续时间',condition:'条件',participants:'涉及人物',outcome:'结果',relationship:'已知关系',role:'身份',purpose:'用途',availability:'可用情况'};
const recordFields=e=>list(e.fields).filter(f=>f.value!==undefined&&f.value!=='');
const recordAttributes=e=>recordFields(e).length?`<dl class="game-record-fields">${recordFields(e).map(f=>`<div><dt>${esc(fieldLabels[f.key]||f.label||f.key)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`:'';
function recordsView(kind,entities,node){
 const source=e=>e.quote?`<details class="game-record-evidence"><summary>原文依据</summary><blockquote>${esc(e.quote)}</blockquote></details>`:'';
 const known=e=>`<span class="game-record-certainty">${esc(certaintyLabels[e.certainty]||'已记录')}</span>`;
 if(kind==='timeline')return `<div class="game-record-timeline"><p class="game-footnote">按记录顺序整理；预定与实际时间分开显示。</p><ol>${[...entities].sort((a,b)=>(a.sourceVersion||0)-(b.sourceVersion||0)).map(e=>`<li><article><header>${inspect(e,node)}${known(e)}</header>${detail({...e,detail:e.summary||e.detail})}${recordAttributes(e)}${source(e)}</article></li>`).join('')}</ol></div>`;
 if(kind==='comparison'){
  const columns=[...new Map(entities.flatMap(e=>recordFields(e).map(f=>[f.key,fieldLabels[f.key]||f.label||f.key]))).entries()];
  const rows=[['当前情况',e=>e.status||'尚未记录'],['已知信息',e=>e.summary||e.detail||'尚未记录'],['依据性质',e=>certaintyLabels[e.certainty]||'已记录'],...(entities.some(e=>quantity(e))?[['数量',e=>quantity(e)||'未知']]:[]),...columns.map(([key,label])=>[label,e=>recordFields(e).find(f=>f.key===key)?.value||'尚未记录'])];
  return `<div class="game-comparison" role="region" tabindex="0" aria-label="相关对象对照表"><table><thead><tr><th>比较项目</th>${entities.map(e=>`<th scope="col">${inspect(e,node)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,value])=>`<tr><th scope="row">${esc(label)}</th>${entities.map(e=>`<td>${esc(value(e))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="game-footnote">只比较已知资料，未记录的差异保持未知。</p>`;
 }
 return `<div class="game-people">${entities.map(e=>`<article><header><span class="game-person-mark" aria-hidden="true">${esc(e.name?.slice(0,1))}</span><div>${inspect(e,node)}${known(e)}</div></header>${detail({...e,detail:e.summary||e.detail})}${recordAttributes(e)}${source(e)}</article>`).join('')}</div>`;
}
function entitiesView(surface,entities,node,location,version){
  if(['timeline','people','comparison'].includes(surface.kind))return recordsView(surface.kind,entities,node);
  if(surface.kind==='map')return mapView(surface,entities,node,location,version);
  if(surface.kind==='status')return `<div class="game-meters">${entities.map(e=>`<div class="game-meter"><div class="game-meter-heading">${inspect(e,node)}${quantity(e)?`<strong>${esc(quantity(e))}</strong>`:''}</div>${progress(e)}${detail(e)}${recordAttributes(e)}</div>`).join('')}</div>`;
  if(surface.kind==='inventory')return `<ul class="game-inventory">${entities.map(e=>`<li><div class="game-item-mark" aria-hidden="true">${esc(e.name?.slice(0,1)||'物')}</div><div class="game-item-body">${inspect(e,node)}${detail(e)}</div>${quantity(e)?`<span class="game-quantity" aria-label="已知数量">${esc(quantity(e))}</span>`:''}</li>`).join('')}</ul>`;
  if(surface.kind==='clues')return `<div class="game-clues">${entities.map((e,i)=>`<article class="game-clue"><span class="game-clue-number">线索 ${String(i+1).padStart(2,'0')}</span>${inspect(e,node)}${detail(e)}${e.quote?`<blockquote>${esc(e.quote)}</blockquote>`:''}</article>`).join('')}</div>`;
  if(surface.kind==='objectives')return `<ol class="game-objectives">${entities.map(e=>`<li><span class="game-objective-point" aria-hidden="true"></span><div>${inspect(e,node)}${detail(e)}${quantity(e)?`<span class="game-objective-count">${esc(quantity(e))}</span>`:''}${progress(e)}</div></li>`).join('')}</ol>`;
  const compactResources=entities.length>0&&entities.length<=4&&entities.every(e=>['item','meter'].includes(e.kind));
  return `<div class="game-interaction-context${compactResources?' game-resource-context':''}">${entities.map(e=>`<div><span class="game-kind-label">${esc(kinds[e.kind]||'已知记录')}</span>${inspect(e,node)}${detail(e)}${quantity(e)?`<span class="game-quantity">${esc(quantity(e))}</span>`:''}</div>`).join('')}</div>`;
}

function actionsView(surface,game,context){
  const byId=new Map(list(game.entities).map(e=>[e.id,e]));
  return list(surface.actions).length?`<div class="game-actions">${list(surface.actions).map(action=>{
    let reason=context.readonlyReason||action.disabledReason||'';
    if(!reason&&context.state){
      try{resolveGameAction(context.state,{branchId:context.branchId,version:context.version,surfaceId:surface.id,actionId:action.id},{branchId:context.branchId});}
      catch(error){reason=error.message||'这个操作当前不可用。';}
    }
    const effects=list(action.effects).map(effect=>{
      const entity=byId.get(effect.entityId);if(!entity)return '';
      return `${numeric(effect.delta)&&effect.delta!==0?`<span class="game-effect ${effect.delta<0?'game-cost':'game-gain'}">${esc(entity.name)} ${effect.delta>0?'+':''}${effect.delta}${entity.unit?' '+esc(entity.unit):''}</span>`:''}${effect.status?`<span class="game-effect">${esc(entity.name)} → ${esc(effect.status)}</span>`:''}`;
    }).join('');
    const destination=byId.get(action.destination);
    return `<div class="game-action"><button type="button" class="btn game-action-button" data-action="game-act" data-surface="${esc(surface.id)}" data-action-id="${esc(action.id)}" data-version="${esc(context.version)}" data-branch="${esc(context.branchId)}" ${reason?'disabled aria-disabled="true"':''}><span>${esc(action.label)}</span><span class="game-action-mode">${action.mode==='apply'?'执行':'尝试'}</span></button>${effects||destination?`<div class="game-effects" aria-label="${action.mode==='apply'?'执行后变化':'尝试时的已知变化'}">${effects}${destination?`<span class="game-effect">${action.mode==='apply'?'前往':'尝试前往'} ${esc(destination.name)}</span>`:''}</div>`:''}${action.mode!=='apply'?'<p class="game-action-note">结果由后续故事确认。</p>':''}${reason?`<p class="game-action-note">${esc(reason)}</p>`:''}</div>`;
  }).join('')}</div>`:'';
}

function surfaceView(surface,game,context){
  if(!labels[surface.kind])return `<section class="game-surface"><h3>${esc(surface.title||'相关资料')}</h3><p>${esc(surface.description||surface.quote||'这种呈现暂不支持，请回看正文。')}</p><small>仅显示文字，没有执行组件操作。</small></section>`;
  const ids=new Set(list(surface.entityIds));
  const entities=(context.objects||list(game.entities).filter(e=>ids.has(e.id)).map(e=>({...context.state?.experience?.objects?.find(o=>o.id===e.id),...e}))).map(e=>({...e,detail:e.detail||e.summary||''}));
  const ctx={...context,readonlyReason:context.readonlyReason||(numeric(surface.version)&&surface.version!==context.version?'这个界面已过期，请查看最新回合。':'')};
  return `<section class="game-surface game-surface-${surface.kind}" aria-label="${esc(surface.title||labels[surface.kind])}"><header class="game-surface-header"><span class="game-surface-kind">${esc(labels[surface.kind])}</span><h3>${esc(surface.title||labels[surface.kind])}</h3>${surface.description?`<p>${esc(surface.description)}</p>`:''}</header>${entitiesView(surface,entities,context.node,context.state?.location,context.version)}${actionsView(surface,game,ctx)}${surface.quote?`<details class="game-evidence"><summary>原文依据</summary><blockquote>${esc(surface.quote)}</blockquote></details>`:''}</section>`;
}

function receiptView(receipt,game){
  if(!receipt)return '';
  const attempted=receipt.mode==='attempt',byId=new Map(list(game.entities).map(e=>[e.id,e]));
  const effects=attempted?'':list(receipt.effects).map(effect=>{
    const entity=byId.get(effect.entityId);if(!entity)return '';
    const value=numeric(effect.beforeValue)&&numeric(effect.value)&&effect.beforeValue!==effect.value?`<span>${effect.beforeValue} → ${effect.value}${entity.unit?' '+esc(entity.unit):''}</span>`:'';
    const status=typeof effect.beforeStatus==='string'&&typeof effect.status==='string'&&effect.beforeStatus!==effect.status?`<span>${esc(effect.beforeStatus||'未记录')} → ${esc(effect.status||'未记录')}</span>`:'';
    return value||status?`<li><strong>${esc(entity.name)}</strong>${value}${status}</li>`:'';
  }).join('');
  const destination=!attempted&&receipt.destination&&receipt.location?`<p class="game-receipt-location">已抵达 ${esc(receipt.location)}</p>`:'';
  return `<section class="game-receipt" aria-label="已保存的行动结算"><p><span>${attempted?'已尝试':'已完成'}</span> ${esc(receipt.input||receipt.label||'本次行动')}</p>${effects?`<ul>${effects}</ul>`:''}${destination}</section>`;
}

export function gameTurnView(turn={}, {currentVersion,branchId='',busy=false,ended=false,density='adaptive',previousState,previousTurn}={}){
  const game=turn.state?.game||{},surfaces=list(game.surfaces),version=turn.state?.version;
  const historical=!Number.isSafeInteger(currentVersion)||version!==currentVersion;
  const readonlyReason=historical?'历史记录，仅可查看。':ended?'这一段已经结束。':busy?'故事正在继续，请稍候。':'';
  const requested=gameQuery(turn.input),cards=adaptiveSurfaces(turn,{previousState,previousTurn,historical,density,requested}),explicit=requested&&(requested==='all'||cards.some(c=>c.surface.kind===requested));
  const folded=historical||(!explicit&&density==='reading');
  const content=receiptView(turn.gameAction,game)+cards.map(card=>`<details class="game-context-card" data-context-card="${esc(branchId+':'+turn.id+':'+card.surface.id+':'+(historical?'history':'current'))}"${card.open?' open':''}><summary><span class="game-context-label">${esc(labels[card.surface.kind]||'相关资料')}</span><span>${esc(card.surface.title||card.reason)}</span><span class="game-context-toggle">展开 / 收起</span></summary><p class="game-context-reason">${esc(card.reason)}</p>${surfaceView(card.surface,game,{state:turn.state,node:turn.id,version,branchId,readonlyReason,objects:card.objects})}</details>`).join('');
  return `<div data-reader-live="game-${esc(turn.id)}" class="game-turn">${content?folded?`<details class="game-history"><summary>${historical?'当时的玩法':'相关资料与操作'} · ${cards.length?cards.length+' 项记录':'行动结算'} <span>${historical?'只读':'按需展开'}</span></summary><div class="game-surfaces">${content}</div></details>`:`<div class="game-surfaces">${content}</div>`:''}</div>`;
}

export function gameInspectView(entity,game={}, {node=''}={}){
  if(!entity)return '<div class="reading-panel game-inspect-panel"><p>这条记录暂不可用。</p></div>';
  const links=list(game.surfaces).flatMap(s=>list(s.links)).filter(l=>l.from===entity.id||l.to===entity.id),byId=new Map(list(game.entities).map(e=>[e.id,e]));
  const related=[...new Set(links.map(l=>l.from===entity.id?l.to:l.from))].map(id=>byId.get(id)).filter(Boolean);
  return `<section class="reading-panel game-inspect-panel"><p class="panel-context-label">${esc(kinds[entity.kind]||'已知记录')} · 查看不会推进时间</p><h3>${esc(entity.name)}</h3>${detail(entity)}${quantity(entity)?`<p class="game-inspect-value">${esc(quantity(entity))}</p>`:''}${progress(entity)}${related.length?`<h4>已知连接</h4><div class="game-related">${related.map(e=>inspect(e,node)).join('')}</div>`:''}${entity.quote?`<blockquote>${esc(entity.quote)}</blockquote>`:''}</section>`;
}

export function gameRecallView(state={}, {kind='all',node=''}={}){
  const game=state.game||{},mapping={meter:'status',item:'inventory',place:'map',clue:'clues',objective:'objectives',actor:'interaction'};
  const surfaces=list(game.surfaces).filter(s=>labels[s.kind]&&(kind==='all'||s.kind===kind));
  if(kind==='all'||kind==='map'){
    const maps=surfaces.filter(s=>s.kind==='map'),places=list(game.entities).filter(e=>e.kind==='place');
    if(maps.length||places.length){
      const merged={id:'recall-map',kind:'map',title:maps.length===1?maps[0].title:'已知地图',description:maps.map(m=>m.description).filter(Boolean).join(' '),entityIds:[...new Set([...maps.flatMap(m=>list(m.entityIds)),...places.map(p=>p.id)])],links:[...new Map(maps.flatMap(m=>list(m.links)).map(l=>[JSON.stringify([l.from,l.to,l.label]),l])).values()],actions:[]};
      for(let i=surfaces.length-1;i>=0;i--)if(surfaces[i].kind==='map')surfaces.splice(i,1);
      surfaces.unshift(merged);
    }
  }
  const covered=new Set(surfaces.flatMap(s=>list(s.entityIds)));
  for(const [entityKind,surfaceKind] of Object.entries(mapping)){
    if(kind!=='all'&&kind!==surfaceKind)continue;
    const entities=list(game.entities).filter(e=>e.kind===entityKind&&!covered.has(e.id));
    if(entities.length)surfaces.push({id:`recall-${surfaceKind}`,kind:surfaceKind,title:`已知${labels[surfaceKind]}`,entityIds:entities.map(e=>e.id),links:[],actions:[]});
  }
  return `<aside class="game-recall" aria-label="唤出的已知玩法"><div class="game-recall-heading"><span>随时翻看</span><button type="button" class="btn game-dismiss-recall" data-action="game-dismiss-recall">收起</button><p>当前分支的已知资料 · 查看不推进时间</p></div>${surfaces.length?`<div class="game-surfaces">${surfaces.map(surface=>surfaceView({...surface,actions:[]},game,{state,node,version:state.version,readonlyReason:'查看模式'})).join('')}</div>`:'<p class="game-empty-note">这段故事还没有明确记录可用玩法。可以继续阅读，或在正文中表达你的行动。</p>'}</aside>`;
}
