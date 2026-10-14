import {gameTurnView} from './game-ui.js';
import {icon,readerQuickTools,readerTimeline,saveStatusView} from './ui-controls.js';
import {gameRecallView} from './game-ui.js';
import {gameRecallState} from './game-query.js';
import {publicSituation} from './experience-state.js';
import {dynamicView} from './dynamic-ui.js';
import {objectActionView,timeFormView,aroundView,inventoryView,journalView,timePanelView} from './play-views.js';
import {demoActions} from './demo.js';

// These views accept public, branch-scoped records. They never derive hidden world facts.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,classes='',attrs='')=>`<button type="button" class="btn ${classes}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
const kinds={person:'人物',item:'物品',agreement:'约定',clue:'线索',location:'地点',resource:'资源',event:'事件',fact:'见闻'};
const certainty={confirmed:'已确认',reported:'他人说法',inferred:'推测',unknown:'尚不明确'};
const options=(items,value)=>items.map(([key,label])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('');
const field=(label,name,value='',placeholder='',required=false)=>`<label class="field">${esc(label)}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="1500" ${required?'required':''}></label>`;
const plain=value=>typeof value==='string'||typeof value==='number'?String(value):'';
const clockLabel=clock=>plain(clock?.label)||'故事时间尚未明确';
const sourceNode=(branch,version)=>version===0?null:branch?.turns?.find(t=>t.state?.version===version)?.id;
const sourceButton=(branch,version)=>{
  const node=sourceNode(branch,version);
  return node===undefined?'<span class="small muted">来源尚未定位</span>':button(version===0?'回看开场来源':'回看原文来源','history-jump','compact',`data-node="${esc(node||'')}"`);
};

function prose(text,objects=[],version=Infinity) {
  const names=new Map();
  for(const object of objects){if(object.sourceVersion>version||!object.name||object.name.length<2)continue;const group=names.get(object.name)||[];group.push(object);names.set(object.name,group);}
  // Ambiguous names stay ordinary text; never attach the first matching array item.
  const candidates=[...names].filter(([,group])=>group.length===1).map(([name,[object]])=>({name,id:object.id})).sort((a,b)=>b.name.length-a.name.length);
  const used=new Set();
  return String(text??'').split(/\n\s*\n/).filter(Boolean).map(paragraph=>{
    let result='',at=0;
    while(at<paragraph.length){
      let match=null;
      for(const candidate of candidates){if(used.has(candidate.id))continue;const index=paragraph.indexOf(candidate.name,at);if(index>=0&&(!match||index<match.index))match={...candidate,index};}
      if(!match){result+=esc(paragraph.slice(at));break;}
      result+=esc(paragraph.slice(at,match.index))+`<button type="button" class="object-link" data-action="object-detail" data-object="${esc(match.id)}" aria-label="查看${esc(match.name)}的已知资料">${esc(match.name)}</button>`;
      used.add(match.id);at=match.index+match.name.length;
    }
    return `<p>${result.replaceAll('\n','<br>')}</p>`;
  }).join('');
}

function historicalInteraction(d,state,node='opening'){
  let content='';
  if(d){
    const title='当时的记录 · '+plain(d.title);
    if(state&&d.scope&&Array.isArray(d.view)){
      // Reuse the bounded data renderer with the recorded state, never today's facts.
      // Draft values were not snapshotted: do not substitute defaults for past choices.
      try{content=dynamicView({...d,title,fields:[],actions:[],steps:[]},state,{},0,{busy:true,closed:true})
        .replace('<details ','<details data-historical-rich ')
        .replace('</summary>','</summary><p class="reading-history-annotation">历史记录 · 只读。可以排序、筛选和放大查看。</p>')
        .replaceAll('这部分暂时无法显示；请补全输入，或重新整理。','这部分依赖当时未保存的选择，无法完整还原。');}catch{}
    }
    if(!content)content=`<details class="dynamic-operation-record" data-historical-rich><summary>${esc(title)}</summary><p>${esc(d.summary)}</p><p class="reading-history-annotation">历史记录 · 只读摘要。当时的状态未完整保存。</p></details>`;
  }
  return `<div data-history-interaction="${esc(node)}">${content}</div>`;
}
function turnFooter(turn,index){
  const node=turn?.id||'';
  return `<footer class="reading-turn-footer"><details class="turn-tools"><summary aria-label="${index===0?'开场':`回合 ${index}`}的记录选项" title="片段选项">${icon('more')}</summary><div class="reading-actions">${button('当时情况','historical-state','compact',`data-node="${esc(node)}"`)}${button('加书签','bookmark','compact',`data-node="${esc(node)}"`)}${button('从这里分支','fork','compact',`data-node="${esc(node)}"`)}</div></details></footer>`;
}

function playerLine(input){
  if(!input)return '';
  if(input==='让当前场景自然继续。')return '<p class="reading-continued">继续经历</p>';
  const quote=`<blockquote class="reading-player-line"><span class="reading-player-label">你</span><p>${esc(input).replaceAll('\n','<br>')}</p></blockquote>`;
  return input.length>200?`<details class="reading-input-record"><summary>${esc(input.slice(0,100))}… <span>展开</span></summary>${quote}</details>`:quote;
}

export function demoReadOnly(session={},world={}){
  return session.mode==='demo'&&demoActions(world,{step:0,flags:{}}).length===0;
}

export function pendingRecord(pending,error,busy,{readOnly=false,localDemo=false}={}){
  if(!pending&&!error)return '';
  const failure=plain(pending?.error)||error,status=failure||pending?.status==='error'?'error':pending?.status==='stopped'?'stopped':'waiting';
  const stage={preparing:'正在理解这一步',writing:'正在续写',checking:'正在核对情节',saving:'正在保存'}[pending?.stage]||'正在续写';
  const recovery=status!=='waiting'&&!busy&&!readOnly?`<div class="reading-pending-actions">${button('重试回应','retry-turn','primary')}${localDemo?'':button('核对已保存的结果','recover-turn')}</div>`:'';
  return `<section class="reading-pending is-${status}" aria-label="当前回应" data-pending-state="${status}">${playerLine(plain(pending?.input))}<div class="reading-pending-body"><div class="reading-pending-heading"><p ${status==='error'?'role="alert"':'role="status"'}>${status==='waiting'?'<span class="reading-pending-dot" aria-hidden="true"></span>'+stage:status==='stopped'?'已停止等待':'这次回应尚未完成'}</p>${status==='waiting'&&!readOnly?button('停止','cancel-generation','reading-pending-stop'):''}</div>${status==='error'?`<p class="reading-pending-message">${esc(failure||'暂时无法完成回应，请重试或核对已保存的结果。')}</p>`:status==='stopped'?`<p class="reading-pending-message">${localDemo?'你提交的文字已保留，可以重试或选择新的行动。':'你提交的文字已保留，可以核对结果或重试。'}</p>`:''}${recovery}</div></section>`;
}

export function readerView({session={},branch={},world={},state={},situation={},busy=false,pending=null,error='',notice='',settings={},intentMode='auto',focusMode=false,saveStatus='保存状态待确认',suggestions:providedSuggestions,references=[],page}={}) {
  const turns=branch.turns||[],last=turns.at(-1),ended=!!last?.ended,objects=situation.objects||[];
  const paged=settings.readingMode==='paged',pageIndex=Math.max(0,Math.min(turns.length,Number.isFinite(Number(page))?Math.trunc(Number(page)):turns.length));
  const shownTurns=turns.map((turn,index)=>({turn,index})).filter(({index})=>!paged||index+1===pageIndex);
  const pagination=paged?`<nav class="reading-pagination" aria-label="已保存正文翻页">${button('上一页','reading-prev','compact',`data-page="${pageIndex-1}" ${pageIndex===0?'disabled':''}`)}<label>已保存的正文<select id="reading-page" data-action="page-select" aria-label="选择已保存片段">${options([['0','故事开场'],...turns.map((t,i)=>[String(i+1),'回合 '+(i+1)])],String(pageIndex))}</select></label>${button('下一页','reading-next','compact',`data-page="${pageIndex+1}" ${pageIndex===turns.length?'disabled':''}`)}<p>翻页只阅读已有内容，不生成新故事。</p></nav>`:'';
  const fontSize=Math.min(30,Math.max(16,Number(settings.fontSize)||20));
  const lineHeight=Math.min(2.8,Math.max(1.5,Number(settings.lineHeight)||1.95));
  const width=Math.min(960,Math.max(440,Number(settings.width)||720));
  const paragraphGap={wide:'1.6em',compact:'.7em',normal:'1.15em'}[settings.paragraphGap]||'1.15em';
  const family=['sans','system'].includes(settings.fontFamily)?'var(--sans)':'var(--serif)';
  const historical=paged&&pageIndex<turns.length,orientationState=historical?(pageIndex?turns[pageIndex-1]?.state:branch.initialState):state;
  const orientationClock=historical?(branch.initialState?publicSituation(branch,world,pageIndex?turns[pageIndex-1].id:null).clock:null):situation.clock;
  const currentClock=plain(orientationClock?.label),orientation=[plain(orientationState?.location),settings.showTime!==false&&currentClock!=='故事时间未说明'?currentClock:''].filter(Boolean);
  const waiting=!!pending&&!error&&!pending.error&&!['error','stopped'].includes(pending.status);
  const readOnly=demoReadOnly(session,world),localDemo=session.mode==='demo'&&!readOnly,blocked=busy||waiting||ended||(!localDemo&&(!!pending||!!error));
  const demoSuggestions=session.mode==='demo'&&!readOnly&&!ended?(Array.isArray(providedSuggestions)?providedSuggestions:demoActions(world,state)).filter(s=>s?.id&&s?.text).slice(0,3):[];
  return `<div class="reading-experience ${focusMode?'reading-focus':''}" style="--reading-size:${fontSize}px;--reading-leading:${lineHeight};--reading-width:${width}px;--reading-font:${family};--reading-paragraph-gap:${paragraphGap}">
    <header class="reading-header" data-reader-live="header"><a href="#/stories" class="reading-back" aria-label="返回我的世界" title="我的世界">${icon('back')}</a><div class="reading-heading"><div class="reading-title">${esc(session.title||world.title||'我的世界')}</div>${orientation.length?`<div class="reading-context">${orientation.map(text=>`<span>${esc(text)}</span>`).join('<span aria-hidden="true" class="reading-context-dot">·</span>')}</div>`:''}</div><div class="reading-header-end"><span class="reading-save" data-save title="${esc(saveStatus)}">${saveStatusView(saveStatus)}</span><nav class="reading-header-tools" aria-label="故事查阅"><button type="button" class="reading-header-tool" data-action="reader-inspect" data-kind="all" aria-label="查阅故事资料" title="资料">${icon('layers')}<span>资料</span></button><button type="button" class="reading-header-tool" data-action="history" aria-label="回顾故事经历" title="回顾">${icon('history')}<span>回顾</span></button></nav><button type="button" class="reading-appearance" data-action="reader-settings" aria-label="显示设置" title="显示设置">${icon('typography')}</button></div></header>
    <main id="main" class="reader reading-paper">${!paged||pageIndex===0?`<header class="reading-chapter"><p class="reading-kicker">故事开场</p><h1>${esc(world.title||session.title||'故事')}</h1></header>`:`<h1 class="sr-only">${esc(world.title||session.title||'故事')} · 回合 ${pageIndex}</h1>`}
    ${!paged||pageIndex===0?`<section class="opening prose reading-prose" id="turn-opening" aria-label="故事开场">${prose(branch.opening??world.opening,objects,0)}</section>${historicalInteraction(branch.openingInteraction,branch.initialState)}${turnFooter(null,0)}`:''}
    <div data-reader-turns>${shownTurns.map(({turn,index})=>`<section class="turn reading-turn" id="turn-${esc(turn.id)}" data-turn="${esc(turn.id)}" aria-label="回合 ${index+1}"><div class="reading-turn-heading"><span class="reading-turn-number" title="回合 ${index+1}">${String(index+1).padStart(2,'0')}</span>${settings.showTime!==false&&turn.experience?.clock?.label?`<span>${esc(turn.experience.clock.label)}${turn.experience.clock.elapsed?' · '+esc(turn.experience.clock.elapsed):''}</span>`:''}</div>${playerLine(turn.input)}<div class="prose reading-prose">${prose(turn.prose,objects,turn.state?.version)}</div>${(turn.experience?.folded||[]).map(fold=>`<details class="time-fold"><summary>${esc(fold.title||'这段时间的记录')}</summary>${fold.summary?`<p>${esc(fold.summary)}</p>`:''}<blockquote>${esc(fold.quote||'没有额外保存的细节。')}</blockquote></details>`).join('')}${turn.experience?.stop?.reason?`<details class="reading-stop-note"><summary>此刻的提醒</summary><p>${esc(turn.experience.stop.reason)}</p></details>`:''}${turn.operation?`<details class="dynamic-operation-record"><summary>已保存的行动结果</summary><pre>${esc(turn.operation.receipt.result)}\n${turn.operation.receipt.changes.map(c=>esc((turn.state.game.entities.find(e=>e.id===c.entityId)?.name||c.entityId)+"："+c.before+" → "+c.after)).join("\n")}</pre></details>`:((branch.dynamic&&turn===last)?'':gameTurnView(turn,{currentVersion:state.version,branchId:branch.id,busy,ended,density:settings.interactionDensity||'reading',previousState:turns[index-1]?.state||branch.initialState,previousTurn:turns[index-1]}))}${historicalInteraction(turn.interactionSnapshot,turn.state,turn.id)}${turnFooter(turn,index+1)}</section>`).join('')}</div>
    <div data-reader-live="pagination">${pagination}</div>
    <div data-reader-live="ending">${ended?`<section class="reading-ending"><span class="reading-kicker">故事完结</span><h2>这一段，告一段落。</h2><p>已有的正文可以随时回读。你也可以选择开启后日谈，或从某个片刻分支。</p><div class="reading-actions">${button('封存这一段','finish-experience','primary')}${button('回顾经历','history')}${session.mode==='demo'?'':button('自愿开启后日谈','epilogue')}</div></section>`:''}</div>
    <div data-reader-live="pending">${pendingRecord(pending,error,busy,{readOnly,localDemo})}</div><div id="reader-bottom" tabindex="-1"></div></main>
    <section data-reader-live="composer" class="composer-wrap reading-composer-wrap" aria-label="继续故事与行动"><div class="composer reading-composer">
      ${notice?`<p class="reading-notice" role="status">${esc(notice)}</p>`:''}
      <div data-history-notice hidden class="reading-history-notice"></div>
      <div data-selection-tools hidden class="reading-selection-tools" aria-label="选中文字的操作">${readOnly?'':button('引用到草稿','selection-reference','compact')}${button('私人笔记','selection-note','compact')}${button('收藏片段','selection-clip','compact')}${readOnly?'':button('问这段','selection-ask','compact')}${button('反馈问题','selection-feedback','compact')}<button type="button" class="icon-button" data-action="dismiss-selection" aria-label="关闭选文工具">${icon('close')}</button></div>
      ${busy&&!pending?'<p class="reading-generation" role="status">正在处理…</p>':''}
      ${readerQuickTools({busy:blocked||readOnly||localDemo,ended:ended||readOnly,participation:session.preferences?.participation||'act'})}
      ${readOnly?`<div class="reading-readonly"><div><strong>只读开场</strong><p>这个世界没有预设剧情。连接模型后，可从世界页面开启自由游玩。</p></div><a class="btn" href="#/settings">连接模型</a><button type="button" class="reader-tools-trigger" popovertarget="reader-quick-tools" aria-label="打开故事工具" title="故事工具">${icon('plus')}</button></div>`:`
      ${!ended?`<div class="reading-composer-actions"><p>${session.mode==='demo'?'预设演示 · 选择建议后发送':waiting?'回应完成后可以继续，草稿会保留。':pending||error?'先核对或重试上一次回应，草稿会保留。':'让当前场景自然继续，保留你的草稿。'}</p>${button('继续经历','continue','reading-continue',blocked?'disabled':'')}</div>`:''}
      ${demoSuggestions.length?`<div class="reading-demo-suggestions" aria-label="当前预设行动">${demoSuggestions.map(s=>button(s.text,'suggest','reading-suggestion',`data-id="${esc(s.id)}" ${blocked?'disabled':''}`)).join('')}</div>`:''}
      <form id="action-form" data-story-blocked="${blocked?'true':'false'}"><div class="reading-compose-box"><button type="button" class="reader-tools-trigger" popovertarget="reader-quick-tools" aria-label="打开故事工具" title="故事工具">${icon('plus')}</button><label class="hidden" for="action-input">行动、提问或继续经历</label><textarea id="action-input" name="action" rows="1" maxlength="8000" placeholder="${ended?'这一段已完结；你的草稿仍可保留。':waiting?'可以先写下接下来的想法…':session.mode==='demo'?'选择建议后发送…':'你想说什么，或做些什么？'}" aria-label="行动、提问或继续经历" title="${settings.sendEnter?'Enter 发送 · Shift + Enter 换行':'Enter 换行 · Ctrl / ⌘ + Enter 发送'}">${esc(branch.draft||'')}</textarea><div class="reading-send-row">${busy&&!waiting?'<button class="btn reading-send" type="button" data-action="cancel-generation" aria-label="停止生成" title="停止生成"><span class="reading-stop-symbol" aria-hidden="true"></span></button>':`<button class="btn reading-send" type="submit" aria-label="发送" title="${ended?'这一段已完结':blocked?'先完成或核对当前回应':'发送'}" ${blocked||!branch.draft?.trim()?'disabled':''}>${icon('arrow')}</button>`}</div></div><div class="reading-compose-footer"><span>${ended?'故事已完结 · 已有草稿仍保留':waiting?'下一条草稿 · 当前回应完成后可发送':localDemo?'自由行动需要连接模型':pending||error?'草稿已保留 · 先处理上一次回应':'写下行动与对话，让故事继续'}</span><span class="reading-key-hint">${settings.sendEnter?'<kbd>Enter</kbd> 发送':'<kbd>Ctrl / ⌘</kbd> + <kbd>Enter</kbd> 发送'}</span></div></form>`}
      <div data-draft-references class="draft-references"></div>
      ${references.length?`<p class="reading-reference-note">已附上 ${references.length} 处引用</p>`:''}
    </div></section><button class="btn new-content hidden" id="new-content" data-action="new-content">有新内容 ↓</button></div>`;
}

export function readerRecallView({kind='all',state={},situation={},branch={},busy=false,query=''}={}) {
  const views={around:['周围',aroundView],inventory:['身上',inventoryView],journal:['手记',journalView],time:['时间与日程',timePanelView],timeline:['时间线',()=>readerTimeline(branch)]};
  const entry=views[kind];
  if(!entry)return gameRecallView(gameRecallState(state,situation),{kind,node:branch.turns?.at(-1)?.id||'opening'});
  const args={state,situation:{...situation,currentLocation:state.location,currentVersion:state.version},branch,personal:branch.personal||{},busy,ended:!!branch.turns?.at(-1)?.ended,query};
  return `<section class="reader-response" aria-label="${entry[0]}"><header class="reader-response-heading"><h2>${entry[0]}</h2><button type="button" class="icon-button" data-action="game-dismiss-recall" aria-label="收起${entry[0]}" title="收起">${icon('close')}</button></header>${kind==='around'?`<p class="reader-response-location">${esc(state.location||'当前位置尚未明确')}</p>`:''}${entry[1](args)}</section>`;
}

export function situationView({situation={},filter='all',query='',view='cards',sort='name',columns=['summary','status','certainty']}={}) {
  const objects=Array.isArray(situation.objects)?situation.objects:[],search=String(query).trim().toLocaleLowerCase();
  const currentVersion=situation.currentVersion??situation.version;
  const present=o=>o.kind==='person'&&o.certainty==='confirmed'&&Number.isSafeInteger(currentVersion)&&(o.locationVersion??o.sourceVersion)===currentVersion&&!!situation.currentLocation&&(o.fields||[]).some(f=>f.key==='location'&&f.value===situation.currentLocation);
  const filtered=objects.filter(o=>(filter==='all'||(filter==='present'?present(o):o.kind===filter))&&(!search||[o.name,o.summary,o.status,...(o.fields||[]).map(f=>plain(f.value))].join(' ').toLocaleLowerCase().includes(search))).slice().sort((a,b)=>sort==='updated'?(b.sourceVersion??-1)-(a.sourceVersion??-1)||String(a.name).localeCompare(String(b.name),'zh-CN'):String(a.name).localeCompare(String(b.name),'zh-CN'));
  const visibleColumns=new Set(columns);
  const kindOptions=[['all','全部资料'],['present','确认在场的人'],...Object.entries(kinds).filter(([key])=>objects.some(o=>o.kind===key))];
  const detail=o=>button(o.name||'未命名记录','object-detail','object-title',`data-object="${esc(o.id)}"`);
  return `<section class="situation-panel reading-panel"><p class="panel-context-label">${situation.historical?'历史快照 · 仅含当时已知内容':'当前分支 · 已知资料'}</p><div class="situation-summary"><p>${esc(situation.summary||'故事中的情况尚未明确记录，可以继续经历已有正文。')}</p>${!situation.summary?.includes(clockLabel(situation.clock))?`<span>${esc(clockLabel(situation.clock))}</span>`:''}</div><p class="small muted">没有记录，不代表不存在。</p>
    <form id="situation-form" class="situation-search"><label class="field">查找已知资料<input type="search" name="query" value="${esc(query)}" placeholder="人物、地点、物品或关键词" maxlength="500"></label><div class="situation-filters"><label class="field">类别<select name="filter">${options(kindOptions,filter)}</select></label><label class="field">呈现<select name="view">${options([['cards','卡片'],['table','表格'],['text','文字摘要']],view)}</select></label><label class="field">排序<select name="sort">${options([['name','名称'],['updated','最近记录']],sort)}</select></label><button type="submit" class="btn">筛选资料</button></div><details class="situation-columns"><summary>表格显示哪些内容</summary><div class="reading-actions">${[['summary','情况摘要'],['status','当前状态'],['certainty','依据性质']].map(([key,label])=>`<label><input type="checkbox" name="columns" value="${key}" ${visibleColumns.has(key)?'checked':''}> ${label}</label>`).join('')}</div></details></form>
    <p class="small muted" role="status">${filtered.length} 条已知记录</p>${filter==='present'?'<p class="small muted">只列出该回合正文明确记录在当前位置的人物。较早的地点记录和他人说法不能确认现在在场。</p>':''}${!filtered.length?`<div class="reading-empty">${filter==='present'?'当前记录尚未确认符合条件的在场人物；这不表示现场无人。':'当前已知资料中没有匹配的记录。可以换个关键词，或回看正文。'}</div>`:view==='table'?`<div class="situation-table-wrap" tabindex="0" role="region" aria-label="已知资料表，可横向滚动"><table class="situation-table"><thead><tr><th scope="col">对象</th><th scope="col">类别</th>${visibleColumns.has('certainty')?'<th scope="col">依据性质</th>':''}${visibleColumns.has('summary')?'<th scope="col">已知情况</th>':''}${visibleColumns.has('status')?'<th scope="col">当前状态</th>':''}</tr></thead><tbody>${filtered.map(o=>`<tr><th scope="row">${detail(o)}</th><td>${esc(kinds[o.kind]||'见闻')}</td>${visibleColumns.has('certainty')?`<td>${esc(certainty[o.certainty]||certainty.unknown)}</td>`:''}${visibleColumns.has('summary')?`<td>${esc(o.summary||'尚未明确')}</td>`:''}${visibleColumns.has('status')?`<td>${esc(o.status||'尚未明确')}</td>`:''}</tr>`).join('')}</tbody></table></div>`:view==='text'?`<ul class="situation-text-list">${filtered.map(o=>`<li>${detail(o)}<span class="record-certainty">${esc(certainty[o.certainty]||certainty.unknown)}</span><p>${esc(o.summary||o.status||'尚未明确')}</p></li>`).join('')}</ul>`:`<div class="situation-records">${filtered.map(o=>`<article class="situation-record"><div class="record-meta"><span>${esc(kinds[o.kind]||'见闻')}</span><span>${esc(certainty[o.certainty]||certainty.unknown)}</span></div><h3>${detail(o)}</h3><p>${esc(o.summary||'尚无进一步的公开记录。')}</p>${o.status&&o.status!=='已知'?`<p class="record-status">${esc(o.status)}</p>`:''}</article>`).join('')}</div>`}</section>`;
}

export function objectView({object,branch={},notes={},historical=false,situation={},state,busy=false,ended=false}={}) {
  if(!object)return '<section class="reading-panel"><p>当前可查资料中没有这条记录。它可能来自另一条分支，或来源已失效。</p></section>';
  const currentState=state||branch.turns?.at(-1)?.state||branch.initialState||{};
  const fields=(object.fields||[]).filter(f=>plain(f.value)!==''),note=Array.isArray(notes)?notes.findLast(n=>(n.reference?.objectId||n.objectId)===object.id)?.text:notes.objects?.[object.id]?.text??notes.objects?.[object.id]??'';
  const related=(situation.objects||[]).filter(o=>o.id!==object.id&&(object.relatedIds||[]).includes(o.id));
  const custody=object.kind==='item'?['owner','custodian','location'].map((key,i)=>`<span>${['所有者','保管者','位置'][i]}：${esc(fields.find(f=>f.key===key)?.value||'尚未明确')}</span>`).join(''):'';
  return `<article class="object-panel reading-panel play-panel" data-object="${esc(object.id)}"><p class="panel-context-label">${historical?'历史快照 · ':''}${esc(kinds[object.kind]||'已知资料')} · ${esc(certainty[object.certainty]||certainty.unknown)}</p>${busy?`<p class="play-snapshot" role="status">故事正在推进，以下截至${esc(situation.clock?.label||'最近有效节点')}。</p>`:''}<h3>${esc(object.name)}</h3><p class="object-summary">${esc(object.summary||'尚未记录进一步的信息。')}</p>${object.status&&object.status!=='已知'?`<p class="record-status">${esc(object.status)}</p>`:''}${custody?`<p class="play-object-custody">${custody}</p>`:''}<p class="small muted">${historical?'这是回看节点当时已知的情况，可能与现在不同。':'这是当前分支最后记录的情况，不是对远方的实时探测。'}</p>${objectActionView({object,branch,state:currentState,situation,historical,busy,ended})}<details class="play-object-records"><summary>${object.kind==='person'?'查看共同经历与记录':'查看来历与记录'}</summary><div class="reading-actions">${sourceButton(branch,object.sourceVersion)}</div>${fields.length?`<dl class="object-fields">${fields.map(f=>`<div><dt>${esc(f.label||f.key)}</dt><dd>${esc(plain(f.value))}</dd></div>`).join('')}</dl>`:''}${related.length?`<section class="object-relations"><h4>相关的已知记录</h4><p class="small muted">只显示已记录的关联，不代表确定的因果或未公开关系。</p><ul>${related.map(o=>`<li>${button(o.name,'object-detail','compact',`data-object="${esc(o.id)}"`)} <span class="small muted">${esc(kinds[o.kind]||'见闻')}</span></li>`).join('')}</ul></section>`:''}</details><details class="object-private"><summary>私人备注</summary><p>${esc(plain(note)||'还没有私人备注。')}</p>${button('编辑私人备注','note-object','compact',`data-object="${esc(object.id)}"`)}</details></article>`;
}

export function historyView({branch={},query='',notes={},fromIndex=0,toIndex}={}) {
  const needle=String(query).trim().toLocaleLowerCase(),all=[{id:null,prose:branch.opening||'',input:'',index:0},...(branch.turns||[]).map((t,i)=>({...t,index:i+1}))];
  const limit=all.length-1,toBound=(value,fallback)=>value===undefined||value===null||value===''?fallback:Number.isFinite(Number(value))?Math.max(0,Math.min(limit,Math.trunc(Number(value)))):fallback;
  const first=toBound(fromIndex,0),last=toBound(toIndex,limit);
  const entries=all.filter(t=>t.index>=first&&t.index<=last&&(!needle||`${t.input}\n${t.prose}`.toLocaleLowerCase().includes(needle)));
  const rangeOptions=all.map(t=>[String(t.index),(t.index===0?'故事开场':'回合 '+t.index)+(t.experience?.clock?.label?' · '+t.experience.clock.label:'')]);
  return `<section class="history-panel reading-panel"><p class="panel-context-label">${esc(branch.name||'当前分支')} · 回看已发生的经历</p><form id="history-form" class="history-search"><label class="field">搜索原文<input type="search" name="query" value="${esc(query)}" placeholder="人物、地点或记得的一句话" maxlength="500"></label><details class="history-range-options" ${first>0||last<limit?'open':''}><summary>限定回合范围</summary><div class="history-range"><label class="field">从回合<select name="fromIndex">${options(rangeOptions,String(first))}</select></label><label class="field">到回合<select name="toIndex">${options(rangeOptions,String(last))}</select></label></div></details><button class="btn" type="submit">搜索经历</button></form><p class="small muted" role="status">${entries.length} 段记录</p><ol class="history-entries">${entries.map(t=>`<li><div class="history-entry-label"><span>${t.index===0?'故事开场':`回合 ${t.index}`}</span>${t.experience?.clock?.label?`<span>${esc(t.experience.clock.label)}</span>`:''}</div>${t.input?`<p class="history-input">${esc(t.input)}</p>`:''}<p class="history-excerpt">${esc(t.prose.slice(0,280))}${t.prose.length>280?'…':''}</p><div class="reading-actions">${button('回看原文','history-jump','compact',`data-node="${esc(t.id||'')}"`)}${button('当时情况','historical-state','compact',`data-node="${esc(t.id||'')}"`)}${button('加书签','bookmark','compact',`data-node="${esc(t.id||'')}"`)}${button('从这里分支','fork','compact',`data-node="${esc(t.id||'')}"`)}</div></li>`).join('')}</ol>${entries.length?'':`<p class="reading-empty">${first>last?'起始回合在结束回合之后，请调整回顾范围。':'所选范围的已保存正文里没有匹配内容。'}</p>`}</section>`;
}

export function timeView(args={}) {
  return timeFormView(args);
}
