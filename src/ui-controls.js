// Shared presentation primitives; all actions still use the existing story controllers.
// One optical grid, with quiet filled facets beneath the readable outline.
// All markup comes from these static definitions, including the data-icon value.
const glyph=(outline,accent='',detail='')=>({outline,accent,detail});
const icons={
  plus:glyph('M12 5v14M5 12h14','M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z'),
  more:glyph('M5 12h.01M12 12h.01M19 12h.01','M5 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm7 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm7 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'),
  map:glyph('m3.5 6 5.5-2.5 6 2.5 5.5-2.5v14.5L15 20.5 9 18l-5.5 2.5V6ZM9 3.5V18m6-12v14.5','m9 3.5 6 2.5v14.5L9 18Z','m5.5 10 1.5-.7m10 5.2 1.5-.7'),
  status:glyph('M3 12h4l3-7 4 14 3-7h4','M3 12h4l3-7 4 14 3-7h4v7H3Z','M3 6h2m14 0h2'),
  inventory:glyph('M5 8h14l1 11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1L5 8Zm3 0V6a4 4 0 0 1 8 0v2','M5 8h14l1 11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z','M9 12v1a3 3 0 0 0 6 0v-1'),
  people:glyph('M9 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-6 17v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2','M3 18.5a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2H3Z','M16 4a3.5 3.5 0 0 1 0 7m2 3a4.5 4.5 0 0 1 3 4.5v2'),
  timeline:glyph('M6 4v16m5-14h8m-8 6h5m-5 6h8','M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z','M4.5 6h3m-3 6h3m-3 6h3'),
  clues:glyph('M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l4.5 4.5','M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z','m10.5 7 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z'),
  time:glyph('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2','M12 3v9l6.8 5.9A9 9 0 0 0 12 3Z','M5.5 12H6m12 0h.5M12 18v.5'),
  history:glyph('M3.5 5v5h5m-5 0a8.5 8.5 0 1 1 1.7 7.4M12 7.5V12l3.5 2','M12 3.5V12l6.5 5.5A8.5 8.5 0 0 0 12 3.5Z'),
  book:glyph('M12 6c-2.5-2-5.5-2.4-9-1.5V19c3.5-.9 6.5-.5 9 1.5 2.5-2 5.5-2.4 9-1.5V4.5c-3.5-.9-6.5-.5-9 1.5Zm0 0v14.5','M12 6c2.5-2 5.5-2.4 9-1.5V19c-3.5-.9-6.5-.5-9 1.5Z','M6 8.5c1-.1 2 .1 3 .5m6 0c1-.4 2-.6 3-.5M6 12c1-.1 2 .1 3 .5m6 0c1-.4 2-.6 3-.5'),
  arrow:glyph('M12 19V5m-6 6 6-6 6 6','m6 11 6-6 6 6Z'),
  play:glyph('M8 4.5 19.5 12 8 19.5v-15Z','M8 4.5 19.5 12 8 19.5Z'),
  back:glyph('M19 12H5m6-6-6 6 6 6','m11 6-6 6 6 6Z'),
  check:glyph('m5.5 12 4.5 4.5L19 7','M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'),
  compass:glyph('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4 5-2.5 5.5L8 16l2.5-5.5L16 8Z','m16 8-2.5 5.5-3-3Z','M12 5.5V6m6 6h.5M12 18v.5M5.5 12H6'),
  layers:glyph('m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5','m12 3 9 5-9 5-9-5Z'),
  settings:glyph('M9.5 3h5l.5 2.2 1.2.7 2.1-.7 2.5 4.3-1.6 1.5v2l1.6 1.5-2.5 4.3-2.1-.7-1.2.7-.5 2.2h-5L9 18.8l-1.2-.7-2.1.7-2.5-4.3L4.8 13v-2L3.2 9.5l2.5-4.3 2.1.7L9 5.2 9.5 3Z','M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z','M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'),
  'arrow-up-right':glyph('M6 18 18 6M7 6h11v11','M12 6h6v6Z'),
  'arrow-right':glyph('M4.5 12h15m-6-6 6 6-6 6','m13.5 6 6 6-6 6Z'),
  'chevron-down':glyph('m6 9 6 6 6-6','m6 9 6 6 6-6Z'),
  sun:glyph('M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 2v1.5m0 17V22M2 12h1.5m17 0H22M5 5l1.1 1.1m11.8 11.8L19 19M5 19l1.1-1.1M17.9 6.1 19 5','M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'),
  moon:glyph('M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z','M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z','M17 3v3m-1.5-1.5h3'),
  spark:glyph('M10 3c.8 4.8 2.2 6.2 7 7-4.8.8-6.2 2.2-7 7-.8-4.8-2.2-6.2-7-7 4.8-.8 6.2-2.2 7-7Z','M10 3c.8 4.8 2.2 6.2 7 7-4.8.8-6.2 2.2-7 7-.8-4.8-2.2-6.2-7-7 4.8-.8 6.2-2.2 7-7Z','M19 3v4m-2-2h4m-3 11v5m-2.5-2.5h5'),
  close:glyph('m6.5 6.5 11 11m0-11-11 11','M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'),
  search:glyph('M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l4.5 4.5','M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z','M6.5 10.5a4 4 0 0 1 4-4'),
  typography:glyph('m3 18 5-13 5 13M5 13h6m9 5v-7m0 1a3.5 3.5 0 1 0 0 5','M8 5 5 13h6Z','M2 20.5h20'),
  orbit:glyph('M19.5 4.5c2.3 2.3.8 7.6-3.4 11.6S6.8 21.8 4.5 19.5s-.8-7.6 3.4-11.6 9.3-5.7 11.6-3.4ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z','M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z','M4.5 4.5c2.3-2.3 7.6-.8 11.6 3.4s5.7 9.3 3.4 11.6-7.6.8-11.6-3.4S2.2 6.8 4.5 4.5Z'),
  database:glyph('M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6','M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z','M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'),
};
export const icon=name=>{
  const key=typeof name==='string'&&Object.hasOwn(icons,name)?name:'book';
  const {outline,accent,detail}=icons[key];
  return `<svg class="ui-icon" data-icon="${key}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${accent?`<path class="icon-accent" d="${accent}" fill="currentColor" fill-opacity=".1" stroke="none"/>`:''}<path class="icon-outline" d="${outline}"/>${detail?`<path class="icon-detail" d="${detail}" opacity=".55"/>`:''}</svg>`;
};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function saveStatusView(status='保存状态待确认'){
  return status==='已保存在此设备'?`${icon('check')}<span class="sr-only">${esc(status)}</span>`:`<span>${esc(status)}</span>`;
}

export function readerTimeline(branch={}){
  const records=[{id:'',prose:branch.opening,experience:branch.initialState?.experience},...(branch.turns||[])];
  return `<section class="reader-timeline"><p class="small muted">按已发生的顺序 · 点击回看原文</p><ol>${records.map((turn,index)=>`<li><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-meta">${index?'回合 '+index:'故事开场'}${turn.experience?.clock?.label?' · '+esc(turn.experience.clock.label):''}</div><p>${esc(String(turn.prose||'尚无正文记录').slice(0,140))}${String(turn.prose||'').length>140?'…':''}</p><button type="button" class="text-button" data-action="history-jump" data-node="${esc(turn.id)}">回看这一段 ↗</button></li>`).join('')}</ol></section>`;
}

export function readerQuickTools({busy=false,ended=false,participation='act'}={}){
  const entry=(label,action,symbol,attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${icon(symbol)}<span>${label}</span></button>`;
  return `<div id="reader-quick-tools" class="reader-quick-tools" popover="auto" aria-label="故事工具"><nav aria-label="按需使用的故事功能">
    <p class="quick-tools-label">这一段，怎样继续</p>
    <div class="quick-tools-list">${!busy&&!ended?entry('继续经历','continue','play'):''}${entry('安排一段时间','time-control','time',busy||ended?'disabled':'')}${entry(participation==='observe'?'参与方式 · 旁观中':'参与方式','play-participation','people')}</div>
    <div class="quick-tools-list quick-tools-section">${entry('故事资料','reader-inspect','orbit','data-kind="all"')}${entry('回顾与搜索','history','history')}${entry('分支与存档','branches','layers')}</div>
    <details class="quick-tools-more"><summary>更多</summary><div class="quick-tools-list">${entry('导出正文','export-story','layers')}${entry('显示设置','reader-settings','settings')}${entry('故事选项','story-tools','more')}${entry('帮助','help','compass')}</div></details>
  </nav></div>`;
}

export function readerDossierNav(kind='all'){
 const items=[['all','概览'],['interaction','人物'],['map','地点'],['inventory','物品'],['clues','线索'],['status','状态'],['time','时间'],['journal','手记']];
 return `<nav class="reader-dossier-nav" aria-label="故事资料分类">${items.map(([id,label])=>`<button type="button" data-action="reader-inspect" data-kind="${id}" aria-pressed="${id===kind}">${label}</button>`).join('')}</nav>`;
}
