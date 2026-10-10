import {gameTurnView} from './game-ui.js';

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
  for(const object of objects){if(object.sourceVersion>version||!object.name)continue;const group=names.get(object.name)||[];group.push(object);names.set(object.name,group);}
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

function turnFooter(turn,index){
  const node=turn?.id||'';
  return `<footer class="reading-turn-footer"><span>${index===0?'故事开场':`回合 ${index}`}<span class="reading-location">${turn?.state?.location?' · '+esc(turn.state.location):''}</span></span><details class="turn-tools"><summary aria-label="${index===0?'开场':`回合 ${index}`}的记录选项">记录选项</summary><div class="reading-actions">${button('当时情况','historical-state','compact',`data-node="${esc(node)}"`)}${button('加书签','bookmark','compact',`data-node="${esc(node)}"`)}${button('从这里分支','fork','compact',`data-node="${esc(node)}"`)}</div></details></footer>`;
}

export function readerView({session={},branch={},world={},state={},situation={},busy=false,error='',notice='',settings={},intentMode='auto',focusMode=false,saveStatus='保存状态待确认',suggestions:providedSuggestions,references=[],page}={}) {
  const turns=branch.turns||[],last=turns.at(-1),ended=!!last?.ended,objects=situation.objects||[];
  const paged=settings.readingMode==='paged',pageIndex=Math.max(0,Math.min(turns.length,Number.isFinite(Number(page))?Math.trunc(Number(page)):turns.length));
  const shownTurns=turns.map((turn,index)=>({turn,index})).filter(({index})=>!paged||index+1===pageIndex);
  const pagination=paged?`<nav class="reading-pagination" aria-label="已保存正文翻页">${button('上一页','reading-prev','compact',`data-page="${pageIndex-1}" ${pageIndex===0?'disabled':''}`)}<label>已保存的正文<select id="reading-page" data-action="page-select" aria-label="选择已保存片段">${options([['0','故事开场'],...turns.map((t,i)=>[String(i+1),'回合 '+(i+1)])],String(pageIndex))}</select></label>${button('下一页','reading-next','compact',`data-page="${pageIndex+1}" ${pageIndex===turns.length?'disabled':''}`)}<p>翻页只阅读已有内容，不生成新故事。</p></nav>`:'';
  const fontSize=Math.min(30,Math.max(16,Number(settings.fontSize)||20));
  const lineHeight=Math.min(2.8,Math.max(1.5,Number(settings.lineHeight)||1.95));
  const width=Math.min(960,Math.max(440,Number(settings.width)||720));
  const paragraphGap={wide:'1.6em',compact:'.7em',normal:'1.15em'}[settings.paragraphGap]||'1.15em';
  const family=['sans','system'].includes(settings.fontFamily)?'var(--sans)':'var(--serif)';
  return `<div class="reading-experience ${focusMode?'reading-focus':''}" style="--reading-size:${fontSize}px;--reading-leading:${lineHeight};--reading-width:${width}px;--reading-font:${family};--reading-paragraph-gap:${paragraphGap}">
    <header class="reading-header" data-reader-live="header"><a href="#/stories" class="reading-back" aria-label="返回我的故事">← <span>我的故事</span></a><div class="reading-heading"><div class="reading-title">${esc(session.title||world.title||'我的故事')}</div><div class="reading-context">${settings.showTime===false?'':`<span>${esc(clockLabel(situation.clock))}</span><span aria-hidden="true"> · </span>`}<span>${esc(state.location||'地点尚未明确')}</span></div></div><div class="reading-header-end"><span class="reading-save" data-save>${esc(saveStatus)}</span></div></header>
    <main id="main" class="reader reading-paper"><header class="reading-chapter"><span class="reading-kicker">方糖 · ${esc(branch.name||'最初的故事')}</span><h1>${esc(world.title||session.title||'故事')}</h1><p>${esc(session.player?.name||'你')}的这一段经历</p></header>
    ${!paged||pageIndex===0?`<section class="opening prose reading-prose" id="turn-opening" aria-label="故事开场">${prose(branch.opening??world.opening,objects,0)}</section>${turnFooter(null,0)}`:''}
    <div data-reader-turns>${shownTurns.map(({turn,index})=>`<section class="turn reading-turn" id="turn-${esc(turn.id)}" data-turn="${esc(turn.id)}"><div class="reading-turn-heading"><span>回合 ${index+1}</span>${turn.experience?.clock?.label?`<span>${esc(turn.experience.clock.label)}${turn.experience.clock.elapsed?' · 经过 '+esc(turn.experience.clock.elapsed):''}</span>`:''}</div>${turn.input?`<details class="reading-input-record"><summary>你当时的选择</summary><p>${esc(turn.input).replaceAll('\n','<br>')}</p></details>`:''}<div class="prose reading-prose">${prose(turn.prose,objects,turn.state?.version)}</div>${(turn.experience?.folded||[]).map(fold=>`<details class="time-fold"><summary>${esc(fold.title||'这段时间的记录')}</summary>${fold.summary?`<p>${esc(fold.summary)}</p>`:''}<p class="small muted">以下为已保存的正文记录，展开不会生成新内容。</p><blockquote>${esc(fold.quote||'没有额外保存的细节。')}</blockquote></details>`).join('')}${turn.experience?.stop?.reason?`<p class="reading-stop-note">交回给你 · ${esc(turn.experience.stop.reason)}</p>`:''}${gameTurnView(turn,{currentVersion:state.version,branchId:branch.id,busy,ended,density:settings.interactionDensity||'adaptive',previousState:turns[index-1]?.state||branch.initialState,previousTurn:turns[index-1]})}${turnFooter(turn,index+1)}</section>`).join('')}</div>
    <div data-reader-live="pagination">${pagination}</div>
    <div data-reader-live="ending">${ended?`<section class="reading-ending"><span class="reading-kicker">这一段已经告一段落</span><h2>把这一页，留在这里。</h2><p>已有的正文可以随时回读。你也可以选择开启后日谈，或从某个片刻分支。</p><div class="reading-actions">${button('封存这一段','finish-experience','primary')}${button('回顾经历','history')}${session.mode==='demo'?'':button('自愿开启后日谈','epilogue')}</div></section>`:''}</div>
    <div id="reader-bottom" tabindex="-1"></div></main>
    <section data-reader-live="composer" class="composer-wrap reading-composer-wrap" aria-label="继续故事与行动"><div class="composer reading-composer">
      ${error?`<div role="alert" class="notice error reader-error">${esc(error)} ${!busy?'可输入“恢复进度”核对结果，或输入“重试”。':''}</div>`:''}${notice?`<p class="reading-notice" role="status">${esc(notice)}</p>`:''}
      <div data-history-notice hidden class="reading-history-notice"></div>
      <div data-selection-tools hidden class="reading-selection-tools" aria-label="选中文字的操作">${button('引用到草稿','selection-reference','compact')}${button('私人笔记','selection-note','compact')}${button('收藏片段','selection-clip','compact')}${button('问这段','selection-ask','compact')}${button('反馈问题','selection-feedback','compact')}</div>
      ${busy?'<p class="reading-generation" role="status">正在回应…</p>':''}
      <form id="action-form"><div class="reading-compose-box"><label class="hidden" for="action-input">行动、提问或继续阅读</label><textarea id="action-input" name="action" rows="1" maxlength="8000" placeholder="说点什么，或输入「继续」…" aria-label="行动、提问或继续阅读" title="${settings.sendEnter?'Enter 发送 · Shift + Enter 换行':'Enter 换行 · Ctrl / ⌘ + Enter 发送'}">${esc(branch.draft||'')}</textarea><div class="reading-send-row">${busy?'<button class="btn reading-send" type="button" data-action="cancel-generation" aria-label="停止生成" title="停止生成">■</button>':'<button class="btn reading-send" type="submit" aria-label="发送" title="发送">↑</button>'}</div></div></form>
      <div data-draft-references class="draft-references"></div>
      ${references.length?`<p class="reading-reference-note">已引用 ${references.length} 处原文，仅作为上下文，不等于角色已说出这些话。</p>`:''}
    </div></section><button class="btn new-content hidden" id="new-content" data-action="new-content">有新内容 ↓</button></div>`;
}

export function situationView({situation={},filter='all',query='',view='cards',sort='name',columns=['summary','status','certainty']}={}) {
  const objects=Array.isArray(situation.objects)?situation.objects:[],search=String(query).trim().toLocaleLowerCase();
  const currentVersion=situation.currentVersion??situation.version;
  const present=o=>o.kind==='person'&&o.certainty==='confirmed'&&Number.isSafeInteger(currentVersion)&&o.sourceVersion===currentVersion&&!!situation.currentLocation&&(o.fields||[]).some(f=>f.key==='location'&&f.value===situation.currentLocation);
  const filtered=objects.filter(o=>(filter==='all'||(filter==='present'?present(o):o.kind===filter))&&(!search||[o.name,o.summary,o.status,...(o.fields||[]).map(f=>plain(f.value))].join(' ').toLocaleLowerCase().includes(search))).slice().sort((a,b)=>sort==='updated'?(b.sourceVersion??-1)-(a.sourceVersion??-1)||String(a.name).localeCompare(String(b.name),'zh-CN'):String(a.name).localeCompare(String(b.name),'zh-CN'));
  const visibleColumns=new Set(columns);
  const kindOptions=[['all','全部资料'],['present','确认在场的人'],...Object.entries(kinds).filter(([key])=>objects.some(o=>o.kind===key))];
  const detail=o=>button(o.name||'未命名记录','object-detail','object-title',`data-object="${esc(o.id)}"`);
  return `<section class="situation-panel reading-panel"><p class="panel-context-label">${situation.historical?'历史快照 · 仅含当时已知内容':'当前分支 · 已知资料'}</p><div class="situation-summary"><p>${esc(situation.summary||'故事中的情况尚未明确记录，可以继续阅读已有正文。')}</p><span>${esc(clockLabel(situation.clock))}</span></div><p class="small muted">查询和筛选不会推进时间。没有记录，不代表不存在。</p>
    <form id="situation-form" class="situation-search"><label class="field">查找已知资料<input type="search" name="query" value="${esc(query)}" placeholder="人物、地点、物品或关键词" maxlength="500"></label><div class="situation-filters"><label class="field">类别<select name="filter">${options(kindOptions,filter)}</select></label><label class="field">呈现<select name="view">${options([['cards','卡片'],['table','表格'],['text','文字摘要']],view)}</select></label><label class="field">排序<select name="sort">${options([['name','名称'],['updated','最近记录']],sort)}</select></label><button type="submit" class="btn">筛选资料</button></div><details class="situation-columns"><summary>表格显示哪些内容</summary><div class="reading-actions">${[['summary','情况摘要'],['status','当前状态'],['certainty','依据性质']].map(([key,label])=>`<label><input type="checkbox" name="columns" value="${key}" ${visibleColumns.has(key)?'checked':''}> ${label}</label>`).join('')}</div></details></form>
    <p class="small muted" role="status">${filtered.length} 条已知记录</p>${filter==='present'?'<p class="small muted">只列出该回合正文明确记录在当前位置的人物。较早的地点记录和他人说法不能确认现在在场。</p>':''}${!filtered.length?`<div class="reading-empty">${filter==='present'?'当前记录尚未确认符合条件的在场人物；这不表示现场无人。':'当前已知资料中没有匹配的记录。可以换个关键词，或回看正文。'}</div>`:view==='table'?`<div class="situation-table-wrap" tabindex="0" role="region" aria-label="已知资料表，可横向滚动"><table class="situation-table"><thead><tr><th scope="col">对象</th><th scope="col">类别</th>${visibleColumns.has('certainty')?'<th scope="col">依据性质</th>':''}${visibleColumns.has('summary')?'<th scope="col">已知情况</th>':''}${visibleColumns.has('status')?'<th scope="col">当前状态</th>':''}</tr></thead><tbody>${filtered.map(o=>`<tr><th scope="row">${detail(o)}</th><td>${esc(kinds[o.kind]||'见闻')}</td>${visibleColumns.has('certainty')?`<td>${esc(certainty[o.certainty]||certainty.unknown)}</td>`:''}${visibleColumns.has('summary')?`<td>${esc(o.summary||'尚未明确')}</td>`:''}${visibleColumns.has('status')?`<td>${esc(o.status||'尚未明确')}</td>`:''}</tr>`).join('')}</tbody></table></div>`:view==='text'?`<ul class="situation-text-list">${filtered.map(o=>`<li>${detail(o)}<span class="record-certainty">${esc(certainty[o.certainty]||certainty.unknown)}</span><p>${esc(o.summary||o.status||'尚未明确')}</p></li>`).join('')}</ul>`:`<div class="situation-records">${filtered.map(o=>`<article class="situation-record"><div class="record-meta"><span>${esc(kinds[o.kind]||'见闻')}</span><span>${esc(certainty[o.certainty]||certainty.unknown)}</span></div><h3>${detail(o)}</h3><p>${esc(o.summary||'尚无进一步的公开记录。')}</p>${o.status?`<p class="record-status">${esc(o.status)}</p>`:''}</article>`).join('')}</div>`}</section>`;
}

export function objectView({object,branch={},notes={},historical=false,situation={}}={}) {
  if(!object)return '<section class="reading-panel"><p>当前可查资料中没有这条记录。它可能来自另一条分支，或来源已失效。</p></section>';
  const fields=(object.fields||[]).filter(f=>plain(f.value)!==''),note=Array.isArray(notes)?notes.findLast(n=>(n.reference?.objectId||n.objectId)===object.id)?.text:notes.objects?.[object.id]?.text??notes.objects?.[object.id]??'';
  const related=(situation.objects||[]).filter(o=>o.id!==object.id&&(object.relatedIds||[]).includes(o.id));
  return `<article class="object-panel reading-panel" data-object="${esc(object.id)}"><p class="panel-context-label">${historical?'历史快照 · ':''}${esc(kinds[object.kind]||'已知资料')} · ${esc(certainty[object.certainty]||certainty.unknown)}</p><h3>${esc(object.name)}</h3><p class="object-summary">${esc(object.summary||'尚未记录进一步的信息。')}</p>${object.status?`<p class="record-status">${esc(object.status)}</p>`:''}<p class="small muted">${historical?'这是回看节点当时已知的情况，可能与现在不同。':'这是当前分支最后记录的情况，不是对远方的实时探测。'}</p>${fields.length?`<dl class="object-fields">${fields.map(f=>`<div><dt>${esc(f.label||f.key)}</dt><dd>${esc(plain(f.value))}</dd></div>`).join('')}</dl>`:''}<div class="reading-actions">${sourceButton(branch,object.sourceVersion)}</div>${related.length?`<section class="object-relations"><h4>相关的已知记录</h4><p class="small muted">只显示已记录的关联，不代表确定的因果或未公开关系。</p><ul>${related.map(o=>`<li>${button(o.name,'object-detail','compact',`data-object="${esc(o.id)}"`)} <span class="small muted">${esc(kinds[o.kind]||'见闻')}</span></li>`).join('')}</ul></section>`:''}<section class="object-private"><h4>我的私人备注</h4><p>${esc(plain(note)||'还没有私人备注。')}</p><p class="small muted">备注只供你参考，不会成为角色知识或世界事实。</p>${button('编辑私人备注','note-object','compact',`data-object="${esc(object.id)}"`)}</section><div class="object-action"><p class="small muted">准备行动时，可以先围绕这条资料起草；发送后才会在故事里尝试。</p>${button('围绕它起草行动','draft-object','',`data-object="${esc(object.id)}"`)}</div></article>`;
}

export function historyView({branch={},query='',notes={},fromIndex=0,toIndex}={}) {
  const needle=String(query).trim().toLocaleLowerCase(),all=[{id:null,prose:branch.opening||'',input:'',index:0},...(branch.turns||[]).map((t,i)=>({...t,index:i+1}))];
  const limit=all.length-1,toBound=(value,fallback)=>value===undefined||value===null||value===''?fallback:Number.isFinite(Number(value))?Math.max(0,Math.min(limit,Math.trunc(Number(value)))):fallback;
  const first=toBound(fromIndex,0),last=toBound(toIndex,limit);
  const entries=all.filter(t=>t.index>=first&&t.index<=last&&(!needle||`${t.input}\n${t.prose}`.toLocaleLowerCase().includes(needle)));
  const rangeOptions=all.map(t=>[String(t.index),(t.index===0?'故事开场':'回合 '+t.index)+(t.experience?.clock?.label?' · '+t.experience.clock.label:'')]);
  return `<section class="history-panel reading-panel"><p class="panel-context-label">${esc(branch.name||'当前分支')} · 回看已发生的经历</p><p class="small muted">搜索覆盖本分支的全部已保存正文。回看和查看当时情况，不会倒退当前故事。</p><form id="history-form" class="history-search"><label class="field">搜索原文<input type="search" name="query" value="${esc(query)}" placeholder="人物、地点或记得的一句话" maxlength="500"></label><div class="history-range"><label class="field">从回合<select name="fromIndex">${options(rangeOptions,String(first))}</select></label><label class="field">到回合<select name="toIndex">${options(rangeOptions,String(last))}</select></label></div><p class="small muted history-range-note">按已保存回合选择范围，时间仅采用原文已有记录；不把“午后”等表述转换成虚构日期。</p><button class="btn" type="submit">搜索经历</button></form><p class="small muted" role="status">${entries.length} 段记录</p><ol class="history-entries">${entries.map(t=>`<li><div class="history-entry-label"><span>${t.index===0?'故事开场':`回合 ${t.index}`}</span>${t.experience?.clock?.label?`<span>${esc(t.experience.clock.label)}</span>`:''}</div>${t.input?`<p class="history-input">${esc(t.input)}</p>`:''}<p class="history-excerpt">${esc(t.prose.slice(0,280))}${t.prose.length>280?'…':''}</p><div class="reading-actions">${button('回看原文','history-jump','compact',`data-node="${esc(t.id||'')}"`)}${button('当时情况','historical-state','compact',`data-node="${esc(t.id||'')}"`)}${button('加书签','bookmark','compact',`data-node="${esc(t.id||'')}"`)}${button('从这里分支','fork','compact',`data-node="${esc(t.id||'')}"`)}</div></li>`).join('')}</ol>${entries.length?'':`<p class="reading-empty">${first>last?'起始回合在结束回合之后，请调整回顾范围。':'所选范围的已保存正文里没有匹配内容。'}</p>`}</section>`;
}

export function timeView({control={}}={}) {
  return `<section class="time-panel reading-panel"><p class="panel-context-label">一次有限的推进</p><p>说清你想等到哪里、做些什么。遇到需要你决定的事情，故事会停下来。</p><form id="time-form"><label class="field">这次想怎样度过<select name="kind">${options([['advance','让时间往前走'],['wait','等待一件事'],['delegate','按目标处理一段日常']],control.kind||'advance')}</select></label>${field('目标或希望发生的事','goal',control.goal,'例如：在店里整理工具，等雨小一点',true)}${field('到哪里停下','until',control.until,'例如：有人来访，或者雨停时')}<div class="time-presets"><span>快速填写上限</span><div class="reading-actions">${['半小时','到今天傍晚','当前场景结束'].map(limit=>button(limit,'time-preset','compact',`data-limit="${esc(limit)}"`)).join('')}</div><p class="small muted">只填入表单，不会发送或推进时间；提交前仍可修改。</p></div><div class="time-limit">${field('最多推进到什么时候','limit',control.limit||'到当前场景自然结束，或首次需要我作决定时','例如：最多等到傍晚',true)}<p class="small muted">不会连续生成直到目标成功；这次提交只生成一段有限结果。</p></div><details class="time-boundaries" ${control.forbidden||control.reserved?'open':''}><summary>底线与要亲自决定的事</summary>${field('这段时间不要做','forbidden',control.forbidden,'例如：不离开店铺，不花费钱财')}${field('这些情况交回给我','reserved',control.reserved||'重大承诺、借贷、关系表态或不可逆决定','例如：有人要求签约、改变关系或处置重要物品')}</details><p class="time-authorization">提交表示仅授权这一次、在以上范围内推进。默认不替你作出重大承诺；目标未发生时会如实停下。</p><div class="dialog-footer"><button class="btn primary" type="submit">按这个范围推进一次</button></div></form></section>`;
}
