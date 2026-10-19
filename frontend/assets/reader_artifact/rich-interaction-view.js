// Fixed rich views remain data-only; interactive views run inside an opaque artifact frame.
import {artifactFrame} from './interactive-artifact.js';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={table:'资料对照',chart:'数值比较',diagram:'关系与路径',cards:'展开思路',timeline:'事件顺序',illustration:'概念示意'};
const scalar=value=>value===null||['string','boolean'].includes(typeof value)||(typeof value==='number'&&Number.isFinite(value));
const number=(value,fallback=0,min=-2000,max=2000)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const round=value=>Number(value.toFixed(4));
const color=(value,fallback)=>['ink','muted','accent','soft','paper'].includes(value)?`var(--${value})`:value==='none'||/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value??'')?value:fallback;
const short=(text,max=16)=>{const chars=Array.from(String(text??''));return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');};
const lines=(label,max)=>{const chars=Array.from(String(label??'')),result=[];for(let i=0;i<chars.length;i+=max)result.push(chars.slice(i,i+max).join(''));return result.length?result:[''];};
const wrappedLabel=(label,x,baseY,max,boxHeight)=>{const parts=lines(label,max),first=baseY+(boxHeight-(parts.length-1)*17)/2+5;return `<text x="${x}" y="${round(first)}" text-anchor="middle" class="rich-diagram-label">${parts.map((part,i)=>`<tspan x="${x}" ${i?'dy="17"':''}>${escapeHtml(part)}</tspan>`).join('')}</text>`;};
const expandIcon='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8 3 3m13 5 5-5M8 16l-5 5m13-5 5 5"/></svg>';

export function renderRichView(node,{value=x=>x,esc=escapeHtml,plain=x=>x??'',index=0,busy=false,omitTitle=false,omitCaption=false,historical=false}={}){
  if(node?.type==='interactive'||node?.type==='react')return artifactFrame(node,{id:index,historical});
  if(!Object.hasOwn(labels,node?.type))return null;
  const title=node.title||labels[node.type],id='rich-'+String(index).replace(/[^a-zA-Z0-9-]/gu,c=>'_'+c.codePointAt(0).toString(16)+'_'),text=x=>esc(plain(x));
  const draft=prompt=>typeof prompt==='string'&&prompt.trim()?`<button type="button" class="btn compact rich-draft" data-rich-draft="${esc(prompt)}" ${busy?'disabled':''}><span data-rich-draft-label>写入草稿</span> <span aria-hidden="true">↗</span></button>`:'';
  const titleMarkup=omitTitle?'':`<div class="rich-view-title"><h4>${esc(title)}</h4>${title!==labels[node.type]?`<span class="rich-view-kind">${labels[node.type]}</span>`:''}</div>`,captionMarkup=!omitCaption&&node.caption?`<p>${esc(node.caption)}</p>`:'';
  const header=titleMarkup||captionMarkup?`<header class="rich-view-heading">${titleMarkup}${captionMarkup}</header>`:'';
  const frame=(body,attributes='')=>`<section class="rich-view rich-${node.type}" data-rich-kind="${node.type}" data-rich-id="${id}" aria-label="${esc(title)}" ${attributes}>${header}${body}</section>`;
  const scroll=(content,label,extra='')=>`<div class="rich-scroll ${extra}" role="region" aria-label="${esc(label)}" tabindex="0">${content}</div>`;
  const visual=(content,hint='可放大查看细节')=>`<div class="rich-visual" data-rich-visual="${esc(title)}">${content}<div class="rich-visual-tools"><span>${esc(hint)}</span><button type="button" class="rich-inspect" data-rich-expand aria-label="放大查看${esc(title)}">${expandIcon}<span>放大查看</span></button></div></div>`;

  if(node.type==='table'){
    const columns=node.columns,rows=value(node.rows);
    if(!Array.isArray(columns)||columns.length<1||columns.length>8||!Array.isArray(rows)||rows.length>50||rows.some(row=>!Array.isArray(row)||row.length>columns.length||row.some(cell=>!scalar(cell))))throw new Error('表格需要至多50行、每格为文字或数值的数据。');
    const table=`<table><caption class="rich-sr-only">${esc(title)}</caption><thead><tr>${columns.map((column,i)=>`<th scope="col" aria-sort="none"><button type="button" data-rich-sort="${i}" aria-label="按${esc(column)}排序">${esc(column)}<span aria-hidden="true">↕</span></button></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map((_,i)=>i===0?`<th scope="row">${text(row[i])}</th>`:`<td>${text(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const search=rows.length>5?'<details class="rich-table-search" data-rich-detail="table-search"><summary>筛选记录</summary><label><span class="rich-sr-only">筛选表格</span><input type="search" data-rich-filter placeholder="输入关键词查找" autocomplete="off"></label></details>':'';
    return frame(`<div class="rich-table-tools"><p data-rich-table-status role="status">${rows.length} 条记录</p>${search}</div>${scroll(table,title,'rich-table-scroll')}${columns.length>3?'<p class="rich-table-hint">左右滑动，查看更多内容</p>':''}<p class="rich-empty" data-rich-empty ${rows.length?'hidden':''}>没有匹配的记录。</p>`,'data-rich-table');
  }

  if(node.type==='chart'){
    if(!Array.isArray(node.items)||node.items.length>12)throw new Error('图表项目过多。');
    const items=node.items.map(item=>({...item,number:value(item.value)}));
    if(items.some(item=>typeof item.number!=='number'||!Number.isFinite(item.number)||Math.abs(item.number)>1e12))throw new Error('图表需要有限数值。');
    const min=Math.min(0,...items.map(item=>item.number)),max=Math.max(0,...items.map(item=>item.number)),span=max-min||1;
    const start=160,width=420,height=items.length*54+62,zero=round(start+(-min/span)*width),unit=node.unit?' '+esc(node.unit):'';
    const bars=items.map((item,i)=>{const y=28+i*54,end=round(start+(item.number-min)/span*width),x=Math.min(zero,end),w=round(Math.abs(end-zero));return `<g><text x="144" y="${y+18}" text-anchor="end" class="rich-chart-label">${esc(short(item.label,12))}</text><rect data-rich-bar="${item.number}" x="${x}" y="${y}" width="${w}" height="27" rx="4" class="rich-chart-bar ${item.number<0?'is-negative':''}"/><text x="600" y="${y+18}" class="rich-chart-number">${item.number}${unit}</text></g>`;}).join('');
    const chart=`<svg xmlns="http://www.w3.org/2000/svg" class="rich-chart-svg" viewBox="0 0 720 ${height}" aria-hidden="true" focusable="false"><line data-rich-zero="${zero}" x1="${zero}" x2="${zero}" y1="12" y2="${height-30}" class="rich-chart-axis"/>${bars}<text x="${zero}" y="${height-8}" text-anchor="middle" class="rich-chart-tick">0</text></svg>`;
    const values=`<dl class="rich-chart-values">${items.map(item=>`<div><dt>${esc(item.label)}</dt><dd>${item.number}${unit}</dd></div>`).join('')}</dl>`;
    const mobile=`<dl class="rich-chart-mobile">${items.map(item=>`<div><dt>${esc(item.label)}</dt><dd>${item.number}${unit}</dd><dd class="rich-chart-track" aria-hidden="true"><i class="rich-chart-mobile-zero" style="left:${round(-min/span*100)}%"></i><i class="rich-chart-mobile-bar ${item.number<0?'is-negative':''}" data-rich-mobile-bar="${item.number}" style="left:${round((Math.min(0,item.number)-min)/span*100)}%;width:${round(Math.abs(item.number)/span*100)}%"></i></dd></div>`).join('')}</dl>`;
    return frame(items.length?`${visual(`<div class="rich-chart-desktop">${chart}</div>${mobile}`,'数值以同一零点比较')}<details class="rich-details rich-chart-data" data-rich-detail="chart-data"><summary>查看全部数值</summary>${values}</details>`:'<p class="rich-empty">暂无可比较的数据。</p>');
  }

  if(node.type==='diagram'){
    const nodes=(node.nodes||[]).slice(0,12),edges=(node.edges||[]).slice(0,24),radial=node.layout==='radial'&&nodes.length>2;
    const dense=radial&&nodes.length>8,width=radial?(dense?1100:900):Math.max(240,Math.min(3,nodes.length)*240),height=radial?(dense?800:760):Math.max(160,Math.ceil(nodes.length/3)*150+10);
    const positions=new Map(nodes.map((item,i)=>{
      if(radial){const angle=(i-1)/Math.max(1,nodes.length-1)*Math.PI*2-Math.PI/2;return [item.id,i===0?{x:width/2,y:height/2}:{x:round(width/2+(dense?400:320)*Math.cos(angle)),y:round(height/2+(dense?320:290)*Math.sin(angle))}];}
      return [item.id,{x:120+i%3*240,y:80+Math.floor(i/3)*150}];
    }));
    const usableEdges=edges.filter(edge=>positions.has(edge.from)&&positions.has(edge.to));
    const pairCounts=new Map(),pairIndexes=new Map();
    for(const edge of usableEdges){const key=`${edge.from}\u0000${edge.to}`;pairCounts.set(key,(pairCounts.get(key)||0)+1);}
    const links=usableEdges.map((edge,i)=>{
      const a=positions.get(edge.from),b=positions.get(edge.to),dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy)||1;
      const pair=`${edge.from}\u0000${edge.to}`,pairIndex=pairIndexes.get(pair)||0;pairIndexes.set(pair,pairIndex+1);
      const parallel=(pairIndex-(pairCounts.get(pair)-1)/2)*22;
      const trim=Math.min(1,Math.min(dx?92/Math.abs(dx):Infinity,dy?31/Math.abs(dy):Infinity)),x1=round(a.x+dx*trim),y1=round(a.y+dy*trim),x2=round(b.x-dx*trim),y2=round(b.y-dy*trim);
      if(edge.from===edge.to)return `<path d="M ${a.x+80} ${a.y-20} C ${a.x+142} ${a.y-60}, ${a.x-142} ${a.y-60}, ${a.x-80} ${a.y-20}" class="rich-diagram-edge" marker-end="url(#${id}-arrow)" ${edge.dashed?'stroke-dasharray="6 5"':''}/>`;
      let path=`M ${x1} ${y1} L ${x2} ${y2}`,labelX=round((a.x+b.x)/2-dy/distance*12),labelY=dy===0?a.y-14:round((a.y+b.y)/2+dx/distance*12-5);
      if(parallel&&dy===0){path=`M ${x1} ${round(y1+parallel)} L ${x2} ${round(y2+parallel)}`;labelY=round(labelY+parallel);}
      else if(parallel){labelX=round(labelX-dy/distance*parallel);labelY=round(labelY+dx/distance*parallel);}
      // Flow connectors use the gaps between rows, leaving unrelated labels clear.
      if(!radial&&dy===0&&Math.abs(dx)>240){
        const lane=a.y-56-(i%3)*8;
        path=`M ${a.x} ${a.y-31} L ${a.x} ${lane} L ${b.x} ${lane} L ${b.x} ${b.y-31}`;labelX=(a.x+b.x)/2;labelY=lane-7;
      }else if(!radial&&dy!==0&&(dx!==0||Math.abs(dy)>150)){
        const direction=Math.sign(dy),startLane=a.y+direction*65,endLane=b.y-direction*65;
        if(Math.abs(dy)===150){const lane=(a.y+b.y)/2;path=`M ${a.x} ${a.y+direction*31} L ${a.x} ${lane} L ${b.x} ${lane} L ${b.x} ${b.y-direction*31}`;labelX=(a.x+b.x)/2;labelY=lane-7;}
        else{const gutter=dx<0?12:width-12;path=`M ${a.x} ${a.y+direction*31} L ${a.x} ${startLane} L ${gutter} ${startLane} L ${gutter} ${endLane} L ${b.x} ${endLane} L ${b.x} ${b.y-direction*31}`;labelX=(a.x+gutter)/2;labelY=startLane-7;}
      }
      const label=edge.label?`<text x="${labelX}" y="${labelY}" text-anchor="middle" class="rich-diagram-edge-label">${esc(short(edge.label,16))}</text>`:'';
      return `<path d="${path}" class="rich-diagram-edge" marker-end="url(#${id}-arrow)" ${edge.dashed?'stroke-dasharray="6 5"':''}/>${label}`;
    }).join('');
    const boxes=nodes.map((item,i)=>{const p=positions.get(item.id),lineCount=lines(item.label,11).length,boxHeight=Math.max(60,lineCount*17+14);return `<g transform="translate(${p.x-91} ${round(p.y-boxHeight/2)})"><rect width="182" height="${boxHeight}" rx="10" class="rich-diagram-node ${radial&&i===0?'is-center':''}"/>${wrappedLabel(item.label,91,0,11,boxHeight)}</g>`;}).join('');
    const diagram=`<svg xmlns="http://www.w3.org/2000/svg" class="rich-diagram-svg ${radial?'is-radial':''} ${dense?'is-dense':''}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" class="rich-diagram-arrow"/></marker></defs>${links}${boxes}</svg>`;
    const mobileLinks=items=>`<ul class="rich-mobile-links">${items.map(edge=>`<li class="rich-mobile-link${edge.dashed?' is-dashed':''}"><div><span>${esc(nodes.find(item=>item.id===edge.from).label)}</span><span class="rich-mobile-arrow" aria-label="${edge.dashed?'虚线关系':'关系'}">${edge.dashed?'⇢':'→'}</span><span>${esc(nodes.find(item=>item.id===edge.to).label)}</span></div>${edge.label?`<p>${esc(edge.label)}</p>`:''}</li>`).join('')}</ul>`;
    let mobile;
    if(!radial&&nodes.length<=4){
      const y=new Map(nodes.map((item,i)=>[item.id,42+i*112]));
      const mobilePairIndexes=new Map();
      const verticalLinks=usableEdges.map(edge=>{
        const from=y.get(edge.from),to=y.get(edge.to),direction=Math.sign(to-from)||1;
        const adjacent=Math.abs(to-from)===112;
        const pair=`${edge.from}\u0000${edge.to}`,pairIndex=mobilePairIndexes.get(pair)||0;mobilePairIndexes.set(pair,pairIndex+1);
        const parallel=(pairIndex-(pairCounts.get(pair)-1)/2)*22,connectorX=round(160+parallel/2);
        const path=from===to?`M 277 ${from-10} C 319 ${from-47}, 319 ${from+47}, 277 ${from+10}`:adjacent?`M ${connectorX} ${from+direction*27} L ${connectorX} ${to-direction*27}`:`M 277 ${from} L 307 ${from} L 307 ${to} L 277 ${to}`;
        return `<path d="${path}" class="rich-diagram-edge" marker-end="url(#${id}-mobile-arrow)" ${edge.dashed?'stroke-dasharray="6 5"':''}/>${adjacent&&edge.label?`<text x="${round(174+parallel/2)}" y="${round((from+to)/2+5+parallel)}" class="rich-diagram-edge-label">${esc(short(edge.label,8))}</text>`:''}`;
      }).join('');
      const verticalBoxes=nodes.map(item=>{const lineCount=lines(item.label,14).length,boxHeight=Math.max(52,lineCount*17+12);return `<g transform="translate(43 ${round(y.get(item.id)-boxHeight/2)})"><rect width="234" height="${boxHeight}" rx="9" class="rich-diagram-node"/>${wrappedLabel(item.label,117,0,14,boxHeight)}</g>`;}).join('');
      const crossings=usableEdges.filter(edge=>Math.abs(y.get(edge.from)-y.get(edge.to))!==112);
      mobile=`<div class="rich-diagram-mobile"><svg xmlns="http://www.w3.org/2000/svg" class="rich-diagram-mobile-flow" viewBox="0 0 320 ${Math.max(84,(nodes.length-1)*112+84)}" aria-hidden="true" focusable="false"><defs><marker id="${id}-mobile-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" class="rich-diagram-arrow"/></marker></defs>${verticalLinks}${verticalBoxes}</svg>${crossings.length?mobileLinks(crossings):''}</div>`;
    }else{
      const connected=new Set(usableEdges.flatMap(edge=>[edge.from,edge.to])),separate=nodes.filter(item=>!connected.has(item.id));
      mobile=`<div class="rich-diagram-mobile-list">${mobileLinks(usableEdges.slice(0,6))}${usableEdges.length>6?`<p class="rich-mobile-more">另有 ${usableEdges.length-6} 条关系，可在下方展开查看。</p>`:''}${separate.length?`<ul class="rich-mobile-unlinked">${separate.map(item=>`<li>${esc(item.label)}</li>`).join('')}</ul>`:''}</div>`;
    }
    const nodeDetails=`<div class="rich-node-list">${nodes.map(item=>`<article><h5>${esc(item.label)}</h5>${item.detail?`<p>${esc(item.detail)}</p>`:''}${draft(item.prompt)}</article>`).join('')}</div>`;
    const relationships=usableEdges.length?`<ul class="rich-edge-list">${usableEdges.map(edge=>`<li>${esc(nodes.find(item=>item.id===edge.from).label)} → ${esc(nodes.find(item=>item.id===edge.to).label)}${edge.label?'：'+esc(edge.label):''}</li>`).join('')}</ul>`:'';
    return frame(nodes.length?visual(`<div class="rich-diagram-desktop">${diagram}</div>${mobile}`,`${nodes.length} 个节点${usableEdges.length?' · '+usableEdges.length+' 条关系':''}`)+`<details class="rich-details rich-diagram-details" data-rich-detail="diagram-records"><summary>节点与关系 <span>${nodes.length}</span></summary>${nodeDetails}${relationships}</details>`:'<p class="rich-empty">暂无可连接的记录。</p>');
  }

  if(node.type==='cards'||node.type==='timeline'){
    const items=(node.items||[]).slice(0,12),timeline=node.type==='timeline';
    const content=items.map((item,i)=>`<${timeline?'li':'article'} class="rich-story-card">${timeline?`<span class="rich-timeline-dot" aria-hidden="true">${i+1}</span>`:''}<div class="rich-card-meta">${timeline&&item.time?`<span class="rich-time">${esc(item.time)}</span>`:''}${item.tag?`<span class="rich-tag">${esc(item.tag)}</span>`:''}</div><h5>${esc(item.title)}</h5><p>${esc(item.body)}</p>${draft(item.prompt)}</${timeline?'li':'article'}>`).join('');
    return frame(items.length?`<${timeline?'ol':'div'} class="${timeline?'rich-timeline-list':'rich-card-grid'}">${content}</${timeline?'ol':'div'}>`:'<p class="rich-empty">暂无记录。</p>');
  }

  const width=number(node.width,640,200,1000),height=number(node.height,360,120,800);
  const shapes=(node.elements||[]).slice(0,80).map(element=>{
    if(!['rect','circle','ellipse','line','path','text'].includes(element.shape))return '';
    const common=`fill="${color(element.fill,element.shape==='text'?'var(--ink)':['line','path'].includes(element.shape)?'none':'var(--soft)')}" stroke="${color(element.stroke,element.shape==='text'?'none':'var(--accent)')}" stroke-width="${number(element.strokeWidth,1.5,0,20)}"`;
    const fields=names=>names.map(([name,fallback=0,min=-2000,max=2000])=>`${name}="${number(element[name],fallback,min,max)}"`).join(' ');
    if(element.shape==='rect')return `<rect ${fields([['x'],['y'],['width',80,0],['height',60,0],['rx',8,0],['ry',number(element.rx,8,0),0]])} ${common}/>`;
    if(element.shape==='circle')return `<circle ${fields([['cx',width/2],['cy',height/2],['r',24,0]])} ${common}/>`;
    if(element.shape==='ellipse')return `<ellipse ${fields([['cx',width/2],['cy',height/2],['rx',40,0],['ry',24,0]])} ${common}/>`;
    if(element.shape==='line')return `<line ${fields([['x1'],['y1'],['x2',width],['y2',height]])} ${common}/>`;
    if(element.shape==='path')return typeof element.d==='string'&&element.d.length<=2000&&/^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]+$/.test(element.d)?`<path d="${esc(element.d)}" ${common}/>`:'';
    return `<text ${fields([['x',20],['y',30]])} font-size="${number(element.fontSize,18,8,80)}" ${common}>${esc(element.text)}</text>`;
  }).join('');
  return frame(visual(`<figure class="rich-illustration-figure"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(node.description)}</desc>${shapes}</svg><figcaption>${esc(node.description)}</figcaption></figure>`,'概念示意'));
}
