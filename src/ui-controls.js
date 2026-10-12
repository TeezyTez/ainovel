// Shared presentation primitives; all actions still use the existing story controllers.
const paths={
  plus:'M12 5v14M5 12h14',more:'M5 12h.01M12 12h.01M19 12h.01',
  map:'m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
  status:'M3 12h4l3-8 4 16 3-8h4',
  inventory:'M5 8h14v13H5V8Zm3 0V6a4 4 0 0 1 8 0v2',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm7 0a4 4 0 0 1 0 8',
  timeline:'M6 3v18m0-15h12M6 12h9M6 18h12',
  clues:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  time:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  history:'M3 5v5h5M3 10a9 9 0 1 1 1 7m8-10v5l4 2',
  book:'M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-1 14h15',
  arrow:'M12 19V5m-6 6 6-6 6 6',play:'m8 5 11 7-11 7V5Z',
  back:'M19 12H5m7-7-7 7 7 7',check:'m5 12 4 4L19 6',
  compass:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4 5-2 6-6 2 2-6 6-2Z',
  layers:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm3 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
};
export const icon=name=>`<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.book}"/></svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function saveStatusView(status='保存状态待确认'){
  return status==='已保存在此设备'?`${icon('check')}<span class="sr-only">${esc(status)}</span>`:`<span>${esc(status)}</span>`;
}

export function readerTimeline(branch={}){
  const records=[{id:'',prose:branch.opening,experience:branch.initialState?.experience},...(branch.turns||[])];
  return `<section class="reader-timeline"><p class="small muted">按已发生的顺序 · 点击回看原文</p><ol>${records.map((turn,index)=>`<li><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-meta">${index?'回合 '+index:'故事开场'}${turn.experience?.clock?.label?' · '+esc(turn.experience.clock.label):''}</div><p>${esc(String(turn.prose||'尚无正文记录').slice(0,140))}${String(turn.prose||'').length>140?'…':''}</p><button type="button" class="text-button" data-action="history-jump" data-node="${esc(turn.id)}">回看这一段 ↗</button></li>`).join('')}</ol></section>`;
}

export function readerQuickTools({busy=false,ended=false,participation='act'}={}){
  const items=[['map','地图','map'],['status','状态','status'],['inventory','物品','inventory'],['interaction','人物','people'],['timeline','时间线','timeline'],['clues','线索','clues']];
  const entry=(label,action,symbol,attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${icon(symbol)}<span>${label}</span></button>`;
  return `<div id="reader-quick-tools" class="reader-quick-tools" popover="auto" aria-label="故事工具"><nav aria-label="按需使用的故事功能">
    <p class="quick-tools-label">查看</p>
    <div class="quick-tools-grid">${items.map(([kind,label,symbol])=>`<button type="button" data-action="reader-inspect" data-kind="${kind}">${icon(symbol)}<span>${label}</span></button>`).join('')}</div>
    <div class="quick-tools-list">${entry('整理当前处境','dynamic-prepare','compass')}${entry('周围','play-around','compass')}${entry('时间与日程','play-time','time')}${entry('手记','play-journal','book')}${entry('搜索与回顾','history','history')}</div>
    <div class="quick-tools-list quick-tools-section">${!busy&&!ended?entry('继续阅读','continue','play'):''}${entry('安排一段时间','time-control','time',busy||ended?'disabled':'')}${entry(participation==='observe'?'参与方式 · 旁观中':'参与方式','play-participation','people')}${participation==='observe'?entry('亲自接手','take-control','arrow'):''}</div>
    <details class="quick-tools-more"><summary>存档与设置</summary><div class="quick-tools-list">${entry('分支与存档','branches','layers')}${entry('导出正文','export-story','book')}${entry('导出存档','export-session','history')}${entry('阅读设置','reader-settings','settings')}${entry('更多故事选项','story-tools','more')}${entry('帮助','help','compass')}</div></details>
  </nav></div>`;
}
