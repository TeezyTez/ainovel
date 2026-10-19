import {projectSpatialMap,BEARING_NAMES} from './spatial-state.js';
import {currentMapPlace} from './map-layout.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const terrainNames={landmark:'地点',building:'建筑',room:'房间',region:'区域',water:'水域',forest:'林地',mountain:'山地'};
const displayName=value=>{
 const original=String(value??'').trim(),chars=[...original];
 if(chars.length<=18)return original;
 const first=original.split(/[，,。；;：:！？!?\n]/)[0].trim();
 return [...first].length>=3&&[...first].length<=18?first+'…':chars.slice(0,17).join('')+'…';
};
const distance=n=>n>=1000?`${Number((n/1000).toFixed(2))} 公里`:`${n} 米`;
const icon=kind=>{
 if(kind==='forest')return '<path d="M-25 20V-10m-12 8 12-24L-13-2Zm25 25V-15m-14 8 14-28L26-7Z M33 25V2m-10 3 10-20L43 5Z"/>';
 if(kind==='mountain')return '<path d="m-40 24 27-52 30 52m-8 0 19-37 21 37M-23-9l10 4 10-4"/>';
 if(kind==='water')return '<path d="M-42-10q10-10 20 0t20 0 20 0 20 0M-42 4q10-10 20 0t20 0 20 0 20 0M-42 18q10-10 20 0t20 0 20 0 20 0"/>';
 if(kind==='building')return '<path d="M-22 22V-10L0-26l22 16v32ZM-27-9 0-30 27-9M-6 22V5H6v17M-15-5h6m18 0h6"/>';
 if(kind==='room')return '<path d="M-30 22v-44h60v44H8m-16 0h-22M8 22V6a16 16 0 0 0-16 16"/>';
 if(kind==='region')return '<path d="M-30 24V0l14-12L0 0v24M-16-12v-13h25V8m0-4 17-14 14 13v27M-22 24h56"/>';
 return '<path d="M0 23V-25m0 1h25l-7 8 7 8H0M-12 24h24"/>';
};

export function spatialMapView(game,{location='',version=0,node='',scope,anchorId=null,links=[]}={}){
 const entities=game.entities??[],byId=new Map(entities.map(e=>[e.id,e])),places=entities.filter(e=>e.kind==='place');
 const sites=game.spatial?.sites??[],siteById=new Map(sites.map(s=>[s.id,s]));
 const current=currentMapPlace(places,location,version),selectedScope=scope===undefined?(siteById.get(current)?.parentId??null):scope||null;
 const projection=projectSpatialMap(game,{scope:selectedScope,anchorId:anchorId||current});
 const {positions,metric,routes,relations,unplaced}=projection,raw=[...positions.values()];
 const minX=Math.min(0,...raw.map(p=>p.x)),maxX=Math.max(0,...raw.map(p=>p.x)),minY=Math.min(0,...raw.map(p=>p.y)),maxY=Math.max(0,...raw.map(p=>p.y));
 const spanX=maxX-minX,spanY=maxY-minY,scale=metric?Math.min(620/(spanX||1),340/(spanY||1)) : Math.min(240,620/(spanX||1),320/(spanY||1));
 const points=new Map([...positions].map(([id,p])=>[id,{x:480+(p.x-(minX+maxX)/2)*scale,y:278+(p.y-(minY+maxY)/2)*scale}]));
 const scopeName=byId.get(selectedScope)?.name,scopeButton=(id,label,anchor='')=>`<button type="button" data-action="map-scope" data-scope="${esc(id)}" data-anchor="${esc(anchor)}" data-node="${esc(node)}"${(id||null)===selectedScope&&!anchor?' aria-current="page"':''}>${esc(label)}</button>`;
 const scopes=[...new Set(sites.map(s=>s.parentId).filter(Boolean))];
 const parent=siteById.get(selectedScope)?.parentId??null;
 const hierarchy=`<nav class="atlas-scopes" aria-label="地图区域">${scopeButton(null,'周边')}${selectedScope&&parent?scopeButton(parent,byId.get(parent)?.name||'上层'):''}${scopes.map(id=>scopeButton(id,byId.get(id)?.name||'区域')).join('')}</nav>`;
 const routeSvg=routes.map(r=>{
  const a=points.get(r.from),b=points.get(r.to),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,angle=Math.atan2(dy,dx)*180/Math.PI,x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  return `<g class="atlas-route atlas-route-${r.passage}"><title>${esc(r.label||'通路')} · ${r.passage==='blocked'?'已封锁':r.passage==='open'?'可通行':'通行情况未知'}</title><path class="atlas-road-bed" d="M${a.x} ${a.y}L${b.x} ${b.y}"/><path class="atlas-road-line" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>${r.passage==='blocked'?`<g transform="translate(${x} ${y}) rotate(${angle})"><path class="atlas-barrier" d="M-7-13V13M7-13V13M-10-8 10 8M-10 8 10-8"/></g>`:!r.bidirectional?`<path class="atlas-direction" d="M-7-5 0 0-7 5" transform="translate(${x} ${y}) rotate(${angle})"/>`:''}<text class="atlas-route-text" x="${x-dy/len*22}" y="${y+dx/len*22}">${esc(r.label||'通路')}${r.distanceMeters!==null?' · '+distance(r.distanceMeters):''}${r.passage==='blocked'?' · 封锁':''}</text></g>`;
 }).join('');
 const bearingSvg=relations.filter(r=>!routes.some(route=>(route.from===r.from&&route.to===r.to)||(route.from===r.to&&route.to===r.from))).map(r=>{const a=points.get(r.from),b=points.get(r.to);return `<g class="atlas-bearing"><path d="M${a.x} ${a.y}L${b.x} ${b.y}"/>${r.distanceMeters!==null?`<text x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2-15}">${distance(r.distanceMeters)}</text>`:''}</g>`;}).join('');
 const marks=[...points].map(([id,p])=>{
  const kind=siteById.get(id)?.terrain||'landmark',here=id===current;
  return `<g class="atlas-landmark atlas-${kind}${here?' atlas-here':''}" transform="translate(${p.x} ${p.y})"><ellipse class="atlas-terrain-wash" rx="56" ry="45"/><g class="atlas-symbol">${icon(kind)}</g>${here?'<circle class="atlas-position-halo" r="7" cy="-46"/><circle class="atlas-position-dot" r="3" cy="-46"/>':''}</g>`;
 }).join('');
 // Labels are UI overlays, not new geographic coordinates. Separate overlapping
 // labels with leaders while leaving the physical point in its original place.
 const labels=[],occupied=[];
 for(const [id,p] of points){
  const candidates=[[0,45],[-170,50],[170,50],[0,-115],[-170,-115],[170,-115],[0,145],[-170,145],[170,145]].map(([dx,dy])=>({x:Math.max(115,Math.min(845,p.x+dx)),y:Math.max(35,Math.min(500,p.y+dy))}));
  const {x,y}=candidates.find(candidate=>!occupied.some(q=>Math.abs(q.x-candidate.x)<205&&Math.abs(q.y-candidate.y)<100))||candidates[0];occupied.push({x,y});
  const e=byId.get(id),short=displayName(e.name),cue=[...String(e.name)].length===1?terrainNames[siteById.get(id)?.terrain]||'地点':'';labels.push(`${Math.abs(x-p.x)>3||Math.abs(y-p.y-45)>3?`<svg class="atlas-label-leader" viewBox="0 0 960 620" aria-hidden="true"><path d="M${p.x} ${p.y+24}L${x} ${y}"/></svg>`:''}<button type="button" class="atlas-place${id===current?' is-current':''}" data-action="game-inspect" data-entity="${esc(id)}" data-node="${esc(node)}" style="left:${x/9.6}%;top:${y/6.2}%"${id===current?' aria-current="location"':''} aria-label="查看地点：${esc(e.name)}" title="${esc(e.name+(e.detail?' — '+e.detail:''))}"><span class="atlas-place-name">${esc(short)}</span>${cue?`<small>${esc(cue)}</small>`:''}${id===current?'<small>你在这里</small>':''}</button>`);
 }
 const scaleMeters=metric?10**Math.floor(Math.log10(110/scale)):0;
 const scaleBar=metric?`<g class="atlas-scale" transform="translate(55 573)"><path d="M0-5V0H${scaleMeters*scale}V-5"/><text x="0" y="20">${distance(scaleMeters)}</text></g>`:'';
 const compass=relations.length?'<g class="atlas-compass" transform="translate(891 74)"><path d="M0-20-7 6 0 2 7 6Z"/><path d="M0 2V18"/><text x="0" y="-30">北</text></g>':'';
 const legacyLinks=links.filter(l=>byId.get(l.from)?.kind==='place'&&byId.get(l.to)?.kind==='place');
 const allRecords=[...(game.spatial?.relations??[]).filter(r=>projection.places.some(p=>p.id===r.from||p.id===r.to))];
 const recordText=r=>r.kind==='relative'?`${byId.get(r.to)?.name}在${byId.get(r.from)?.name}的${BEARING_NAMES[r.bearing]}方${r.distanceMeters!==null?' '+distance(r.distanceMeters):''}`:`${byId.get(r.from)?.name}${r.bidirectional?' ↔ ':' → '}${byId.get(r.to)?.name} · ${r.label||'通路'} · ${{open:'可通行',blocked:'已封锁',unknown:'通行未确认'}[r.passage]}`;
 const inspect=id=>`<button type="button" data-action="game-inspect" data-entity="${esc(id)}" data-node="${esc(node)}">${esc(byId.get(id)?.name)}</button>`;
 const sparse=!relations.length;
 const mapBody=sparse?`<div class="atlas-sparse"><div class="atlas-sparse-caption"><span>地点记录</span><p>${positions.size?'方位与距离，等待故事补全。':'这一区域还没有可定位的地点。'}</p></div>${labels.join('')}</div>`:`<div class="atlas-canvas" data-zoom="1"><svg class="atlas-geography" viewBox="0 0 960 620" aria-hidden="true" focusable="false"><rect class="atlas-neatline" x="22" y="22" width="916" height="576" rx="4"/><path class="atlas-graticule" d="M240 22V598M480 22V598M720 22V598M22 155H938M22 310H938M22 465H938"/>${bearingSvg}${routeSvg}${marks}${scaleBar}${compass}</svg>${labels.join('')}</div>`;
 return `<section class="spatial-atlas" data-map-node="${esc(node)}">${hierarchy}<div class="atlas-heading"><div><span class="atlas-eyebrow">${selectedScope?'区域地图':'已知地点'}</span><h4>${esc(scopeName||'周边地理')}</h4></div><span class="atlas-precision">${metric?'按记录距离示意':relations.length?(relations.every(r=>r.distanceMeters!==null)?'方位示意 · 测距待核对':'方位示意 · 距离未测定'):'地理信息待补充'}</span></div><div class="game-map-viewport atlas-viewport" tabindex="0" role="region" aria-label="${sparse?'已知地点记录':'可缩放的剧情地图'}">${mapBody}</div>${!sparse?`<div class="atlas-bottom"><div class="atlas-legend">${routes.length?'<span class="legend-road">通路</span>':''}<span class="legend-bearing">方位参照</span>${routes.some(r=>r.passage==='blocked')?'<span class="legend-blocked">封锁</span>':''}</div><div class="atlas-zoom" aria-label="地图缩放"><button type="button" data-action="map-zoom" data-factor="0.8" aria-label="缩小地图">−</button><button type="button" data-action="map-zoom" data-factor="reset" aria-label="适应地图">适应</button><button type="button" data-action="map-zoom" data-factor="1.25" aria-label="放大地图">＋</button></div></div>`:''}${unplaced.length?`<div class="atlas-unplaced"><span>方位未明</span>${unplaced.map(id=>scopeButton(selectedScope,byId.get(id)?.name,id)).join('')}</div>`:''}<details class="atlas-records"><summary>地理依据${allRecords.length?' · '+allRecords.length+' 条':''}</summary><p>地貌符号不代表精确边界；道路仅示意连接，查看地点不会移动角色。${!metric?'未知距离不按比例。':''}</p>${allRecords.map(r=>`<div class="atlas-record"><span>${esc(recordText(r))}</span><blockquote>${esc(r.quote)}</blockquote></div>`).join('')}${legacyLinks.length?`<p>旧记录中的连接尚不代表距离、方位或通行许可。</p><ul aria-label="正文已知的连接">${legacyLinks.map(l=>`<li>${inspect(l.from)} → ${inspect(l.to)} · ${esc(l.label)}</li>`).join('')}</ul>`:''}${projection.places.map(e=>`<div class="atlas-place-record">${inspect(e.id)}<span>${esc(terrainNames[siteById.get(e.id)?.terrain]||'地点')}${siteById.get(e.id)?.parentId?' · '+esc(byId.get(siteById.get(e.id).parentId)?.name):''}</span>${e.id===current?'<small>当前所在</small>':e.status?`<small>${esc(['当前位置','当前所在'].includes(e.status)?'已知地点':e.status)}</small>`:''}${e.detail?`<p>${esc(e.detail)}</p>`:''}</div>`).join('')}</details><button type="button" class="btn compact atlas-expand" data-action="game-map-expand" data-node="${esc(node)}">展开地图 ↗</button></section>`;
}
