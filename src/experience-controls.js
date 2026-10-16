import {resetReadingAppearance,captureReadingViewport,restoreReadingViewport,readingAppearance,readingAppearanceView,applyReadingAppearance,bindReadingComposer,focusActionInput} from './reader-comfort.js';
import {undoPolish} from './experience.js';
import {compareSituations} from './experience-compare.js';
import {publicSituation} from './experience-state.js';
import {readerView,situationView,objectView,historyView} from './reading-ui.js';
import {aroundObjects,aroundView,inventoryView,journalView,timePanelView,timeFormView,timeControlFromInput,participationView} from './play-views.js';
import {ensurePersonal,createReference,addAnnotation,removeAnnotation,toggleObjectFocus,muteReminder,setDraftContext,updateStoryMetadata,trashStory,restoreStory,resolveReadingAnchor,captureReadingAnchor,setReadingAnchor} from './personal-library.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,attrs='')=>`<button type="button" class="btn" data-action="${action}" ${attrs}>${label}</button>`;
const field=(label,name,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
const text=(label,name,value='',extra='')=>`<label class="field">${label}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;

// UI queries and personal notes never call the narrative generator.
export function createExperienceControls(api){
  let selection=null, selectedSnapshot=undefined, objectPanel=false, journalQuery='', situationOptions={filter:'all',query:'',view:'cards',sort:'name',columns:['summary','status','certainty']}, historyQuery='',historyFrom=0,historyTo='';
  const session=()=>api.sessionNow(), branch=()=>api.getBranch(session()), world=()=>api.sessionWorld(session());
  const state=()=>{const b=branch();return selectedSnapshot===null?b.initialState:(selectedSnapshot?b.turns.find(t=>t.id===selectedSnapshot):b.turns.at(-1))?.state||b.initialState;};
  const data=()=>({...publicSituation(branch(),world(),selectedSnapshot),historical:selectedSnapshot!==undefined,currentLocation:state().location,currentVersion:state().version});
  const busy=()=>!!api.busy?.(),ended=()=>!!branch().turns.at(-1)?.ended;
  const playArgs=()=>({situation:data(),state:state(),branch:branch(),personal:personal(),busy:busy(),ended:ended()});
  const mutateBranch=next=>{Object.assign(branch(),next);api.save();};
  const open=(title,html,submit,detail=false)=>{const snapshot=selectedSnapshot;api.openDialog(title,html,submit,{replace:detail&&objectPanel,onRestore:()=>{selectedSnapshot=snapshot;objectPanel=detail;}});objectPanel=detail;document.querySelector('#dialog').classList.add('experience-drawer');bindPanel();};
  const reset=()=>{selectedSnapshot=undefined;selection=null;};
  function viewSnapshot(snapshot){
    if(!session()||(snapshot!==undefined&&snapshot!==null&&(typeof snapshot!=='string'||!branch().turns.some(turn=>turn.id===snapshot))))throw new Error('这段历史快照已不可用，请重新选择片段。');
    selectedSnapshot=snapshot;selection=null;objectPanel=false;
  }
  function invalidate(){
    const dialog=document.querySelector('#dialog'),panel=dialog?.querySelector('[data-live-play]');
    // The dossier owns its tabs and snapshot. Its shell is refreshed by the app.
    if(dialog?.classList?.contains?.('reader-dossier'))return;
    if(!dialog?.open||!panel||selectedSnapshot!==undefined||!session())return;
    if(Number(panel.dataset.version)===state().version&&panel.dataset.busy===String(busy()))return;
    const views={around:['周围',aroundView],inventory:['身上',inventoryView],time:['时间',timePanelView]},entry=views[panel.dataset.livePlay];
    if(entry)open(entry[0],entry[1](playArgs()));
  }
  const personal=()=>ensurePersonal(branch());
  function showSituation(snapshot){
    if(snapshot!==undefined)selectedSnapshot=snapshot;
    const situation=data(),followed=situation.objects.filter(o=>personal().objects[o.id]?.followed);
    open(selectedSnapshot!==undefined?'当时的已知情况':'已知情况',(followed.length?`<section class="reading-panel"><h3>我关心的事</h3><div class="row">${followed.map(o=>btn(esc(o.name),'object-detail',`data-object="${esc(o.id)}"`)).join('')}</div></section>`:'')+situationView({situation,...situationOptions}),undefined);
  }
  function showObject(id){const object=data().objects.find(o=>o.id===id);if(!object){api.toast('这份资料已不在当前查询范围，请重新查看情况。');return;}
    const prefs=personal().objects?.[id]||{};
    open(object.name,objectView({object,...playArgs(),notes:personal().notes,historical:selectedSnapshot!==undefined})+`<details class="play-follow"><summary>我的关注</summary><div class="row">${btn(prefs.followed?'取消关注':'记为我在意的事','follow-object',`data-object="${esc(id)}"`)}${object.kind==='agreement'?btn(prefs.muted?'恢复到在意的事':'不再置顶','mute-object',`data-object="${esc(id)}"`):''}</div><p class="small muted">只改变手记显示；取消承诺需要在故事中表达。</p></details>`,undefined,true);
  }
  function showJournal(){if(api.showQuery){api.showQuery('journal',{query:journalQuery});return;}open('手记',journalView({...playArgs(),query:journalQuery}));}
  function showTime(){if(api.showQuery){api.showQuery('time');return;}open('时间',timePanelView(playArgs()));}
  function showTimeForm(mode){open({short:'等一会儿',until:'等到……',skip:'略过一段'}[mode]||'略过一段',timeFormView({...playArgs(),mode,control:{forbidden:session().preferences?.boundaries||''}}));}
  function addPlan(){const b=branch(),source=b.turns.at(-1),reference={turnId:source?.id||null,quote:(source?.prose||b.opening||world().opening||'').slice(0,1500)};
    open('写一个自己的打算',`<form>${text('我想做的事','plan','','required maxlength="4000"')}<p class="small muted">这是一条私人笔记。角色尚未采取行动，也没有答应任何人。</p><button type="submit" class="btn primary">记到手记</button></form>`,form=>{mutateBranch(addAnnotation(branch(),{...reference,note:'我的打算：'+String(form.get('plan')),kind:'note'}));showJournal();});}
  async function setParticipation(mode){
    if(!['act','observe'].includes(mode))return;
    const s=session(),b=branch();
    await api.cancelRequest?.();
    if(session()!==s||branch()!==b)return;
    s.preferences??={};s.preferences.participation=mode;api.save();
    document.querySelector('#dialog')?.close();api.refresh?.();
    if(mode==='act')focusActionInput();
    api.toast(mode==='act'?'已接手。草稿保留，发送后才会行动。':'接下来在已有底线内让故事安排；点继续故事才会推进。');
  }
  function showHistory(){open('经历回顾',historyView({branch:branch(),query:historyQuery,notes:personal(),fromIndex:historyFrom,toIndex:historyTo}));}
  function showComparison(){const branches=session().branches,opts=(chosen)=>branches.map(b=>'<option value="'+esc(b.id)+'" '+(b.id===chosen?'selected':'')+'>'+esc(b.name)+'</option>').join('');open('对照已记录的变化','<p>只对照两条分支中已保存的公开资料，不合并事实，也不推进故事。相同分支则对照上一回合和当前。</p><form id="compare-form"><label class="field">左侧<select name="left">'+opts(branches[0].id)+'</select></label><label class="field">右侧<select name="right">'+opts(branch().id)+'</select></label><button type="submit" class="btn">比较情况</button></form><div id="compare-result"></div>',f=>{const left=branches.find(b=>b.id===f.get('left')),right=branches.find(b=>b.id===f.get('right')),worldFor=b=>api.getDB().worlds.find(w=>w.id+'@'+w.version===b.worldKey),result=compareSituations(left,worldFor(left),left.id===right.id?(left.turns.at(-2)?.id||null):undefined,right,worldFor(right),undefined);document.querySelector('#compare-result').innerHTML='<p>左：'+esc(result.before)+'</p><p>右：'+esc(result.after)+'</p>'+result.changes.map(c=>'<article class="personal-entry"><h3>'+esc(c.after?.name||c.before?.name)+'</h3><p>原先：'+esc(c.before?c.before.summary+' · '+c.before.status:'未记录')+'</p><p>现在：'+esc(c.after?c.after.summary+' · '+c.after.status:'未记录')+'</p><details><summary>全部公开字段</summary><pre class="code-note">'+esc(JSON.stringify({before:c.before,after:c.after},null,2))+'</pre></details></article>').join('')+(result.changes.length?'':'<p>没有已记录的公开资料变化。</p>');});}
  function showNotes(){const p=personal(),entries=[...p.bookmarks,...p.clips,...p.notes].sort((a,b)=>b.createdAt-a.createdAt);
    open('书签、收藏与私人笔记',`<p class="small muted">只保存在你的这条分支里，不发送给人物或生成模型。</p>${entries.map(n=>`<article class="personal-entry"><blockquote>${esc(n.reference.quote)}</blockquote>${n.text?`<p>${esc(n.text)}</p>`:''}<div class="row">${btn('查看来源','history-jump',`data-node="${esc(n.reference.turnId||'')}"`)}${btn('移除这条记录','remove-note',`data-id="${esc(n.id)}"`)}</div></article>`).join('')||'<p>还没有记录。选中正文，可以引用、收藏或写一条私人笔记。</p>'}`);
  }
  function bindPanel(){
    const f=document.querySelector('#situation-form');if(f)f.onchange=e=>{if(e.target.matches('select,input[type=checkbox]')){const name=e.target.name;f.requestSubmit();document.querySelector('#situation-form')?.elements.namedItem(name)?.focus?.({preventScroll:true});}};if(f)f.onsubmit=e=>{e.preventDefault();const d=new FormData(f);situationOptions={filter:String(d.get('filter')||'all'),query:String(d.get('query')||''),view:String(d.get('view')||'cards'),sort:String(d.get('sort')||'name'),columns:d.getAll('columns').map(String)};showSituation();};
    const h=document.querySelector('#history-form');if(h)h.onchange=e=>{if(e.target.matches('select')){const name=e.target.name;h.requestSubmit();document.querySelector('#history-form')?.elements.namedItem(name)?.focus({preventScroll:true});}};if(h)h.onsubmit=e=>{e.preventDefault();const values=new FormData(h);historyQuery=String(values.get('query')||'');historyFrom=Number(values.get('fromIndex')||0);historyTo=values.get('toIndex')===''?'':Number(values.get('toIndex'));showHistory();};
    const j=document.querySelector('#play-journal-form');if(j)j.onsubmit=e=>{e.preventDefault();journalQuery=String(new FormData(j).get('query')||'');showJournal();};
    const t=document.querySelector('#time-form');if(t)t.onsubmit=e=>{
      e.preventDefault();
      if(busy()||ended()){api.toast('先等待当前故事停下，再安排下一段。');return;}
      if(t.dataset?.version!==undefined&&Number(t.dataset.version)!==state().version){api.toast('情况已经更新，请重新打开时间，核对后再等待。');return;}
      let control;
      try{control=timeControlFromInput(Object.fromEntries(new FormData(t)));}
      catch(error){api.toast(error.message);const limit=t.elements.namedItem('limit');if(limit&&/最晚/.test(error.message)){const fold=limit.closest?.('details');if(fold)fold.open=true;limit.focus();}return;}
      const input=`本次${{wait:'等待',delegate:'委托',advance:'推进'}[control.kind]||'推进'}：${control.goal}。到达：${control.until}；最多：${control.limit}。不能：${control.forbidden||'未经同意承担重大承诺、借贷、亲密关系或不可逆代价'}。遇到${control.reserved}，请在执行该决定前停下，让我接手。`;
      document.querySelector('#dialog').close();api.sendTurn('time',{input,control});
    };

  }
  function jump(node){document.querySelector('#dialog').close();api.showTurn(node);const el=node?document.getElementById('turn-'+node):document.querySelector('.opening');if(!el){api.toast('原段落已变更；经历记录仍可查看。');return;}el.scrollIntoView({block:'start',behavior:'instant'});el.setAttribute('tabindex','-1');el.focus({preventScroll:true});if(node!==branch().turns.at(-1)?.id){const notice=document.querySelector('[data-history-notice]');if(notice){notice.hidden=false;notice.innerHTML='正在回看较早片段；当前故事没有回退。 '+btn('回到最新','return-current');}}}
  function annotate(kind){if(!selection){api.toast('先选中一段正文。');return;}const ref={...selection};if(kind==='note')open('写一条私人笔记',`<form><blockquote>${esc(ref.quote)}</blockquote>${text('只给自己看的笔记','note','','required maxlength="4000"')}<div class="dialog-footer"><button class="btn primary" type="submit">保存笔记</button></div></form>`,d=>{mutateBranch(addAnnotation(branch(),{...ref,note:String(d.get('note')),kind}));document.querySelector('#dialog').close();api.toast('私人笔记已保存，不改变故事。');});else{mutateBranch(addAnnotation(branch(),{...ref,kind}));api.toast(kind==='clip'?'片段已加入私人收藏。':'书签已保存。');}}
  function setDraft(value){const b=branch();value=value&&b.draft?.trim()?b.draft+'\n'+value:value;b.draft=value;const el=document.querySelector('#action-input');if(el){el.value=value;el.dispatchEvent(new Event('input'));focusActionInput();}api.save();}
  function quoteSelection(){if(!selection)return;const reference=createReference(branch(),selection.turnId,selection.quote,selection.objectId||'');const refs=[...personal().draftReferences,reference].slice(-5);mutateBranch(setDraftContext(branch(),{references:refs,intent:personal().intent}));document.querySelector('#dialog').close();refreshReferences();focusActionInput();api.toast('已附上引用。');}
  function refreshReferences(){const host=document.querySelector('[data-draft-references]');if(host){const objects=data().objects;host.innerHTML=personal().draftReferences.map((r,i)=>{const object=objects.find(o=>o.id===r.objectId);return `<span class="reference-chip">${object?`${object.kind==='person'?'对':'关于'}${esc(object.name)}${object.kind==='person'?'说':''}`:'引用：'+esc(r.quote.slice(0,55))}<button type="button" aria-label="移除${object?'对象':'引用'} ${i+1}" data-action="remove-reference" data-index="${i}">×</button></span>`;}).join('');}}
  function showSettings(){const s=session(),d=api.getDB().settings;
    open('显示设置',`<form id="reader-settings-form">${readingAppearanceView(d,document.body.dataset.theme==='dark')}<details class="settings-extra"><summary>阅读与输入选项</summary><div class="row"><label><input type="checkbox" name="showTime" ${d.showTime!==false?'checked':''}> 显示故事时间</label><label><input type="checkbox" name="restReminder" ${d.restReminder?'checked':''}> 阅读半小时提醒休息</label><label><input type="checkbox" name="reducedMotion" ${d.reducedMotion?'checked':''}> 减少动画</label><label><input type="checkbox" name="sendEnter" ${d.sendEnter?'checked':''}> Enter发送</label></div><p class="small muted">默认 Enter 换行，Ctrl / ⌘ + Enter 发送。中文输入法确认候选不会发送。</p></details><details class="settings-extra"><summary>这段故事的叙述偏好</summary><p class="small muted">仅影响后续内容</p><label class="field">视角<select name="perspective">${['第二人称','第一人称','第三人称'].map(v=>`<option ${s.preferences.perspective===v?'selected':''}>${v}</option>`).join('')}</select></label>${field('这次大约有几分钟空闲（可留空）','availableMinutes',s.preferences.availableMinutes||'','type="number" min="1" max="180"')}<p class="small muted">作为后续篇幅与收束节奏偏好，不等于故事内经过的时间，也不会自动连续生成。</p>${field('篇幅','length',s.preferences.length,'maxlength="100"')}${text('本局偏好与底线','boundaries',s.preferences.boundaries||'','maxlength="2000" placeholder="例如：不写恋爱；保留我对交易和借贷的决定"')}</details><div class="dialog-footer">${btn('恢复默认外观','reset-reading')}<button type="submit" class="btn primary">完成</button></div></form>`,form=>{const anchor=readAnchor();Object.assign(d,{fontSize:Number(form.get('fontSize')),lineHeight:Number(form.get('lineHeight')),width:Number(form.get('width')),fontFamily:String(form.get('fontFamily')),paragraphGap:String(form.get('paragraphGap')),theme:String(form.get('theme')),readingMode:String(form.get('readingMode')),showTime:form.has('showTime'),restReminder:form.has('restReminder'),reducedMotion:form.has('reducedMotion'),sendEnter:form.has('sendEnter')});for(const k of ['perspective','length','boundaries','availableMinutes'])s.preferences[k]=String(form.get(k)||'');api.save();document.querySelector('#dialog').close();api.render(true);restoreAnchor(anchor);});
    bindAppearanceSettings();
  }
  function bindAppearanceSettings(){
    const form=document.querySelector('#reader-settings-form');if(!form)return;
    const d=api.getDB().settings;
    applyReadingAppearance(d);
    let revision=0;
    const apply=target=>{
      if(!target?.matches('[data-reader-setting]')||!target.checkValidity())return;
      const anchor=readAnchor(),viewport=captureReadingViewport(),name=target.name;
      const current=++revision;
      d[name]=['fontSize','lineHeight','width'].includes(name)?Number(target.value):target.value;
      if(name==='readingTheme'){d.theme=target.value==='night'?'dark':'light';form.elements.theme.value=d.theme;}
      if(name==='theme')delete d.readingTheme;
      api.applySettings();applyReadingAppearance(d);api.save();
      const a=readingAppearance(d,document.body.dataset.theme==='dark');
      form.querySelector('[data-reading-size]').textContent=a.fontSize;
      for(const button of form.querySelectorAll('[data-leading]'))button.setAttribute('aria-pressed',String(Number(button.dataset.leading)===a.lineHeight));
      for(const radio of form.querySelectorAll('[name=readingTheme]'))radio.checked=radio.value===a.readingTheme;
      if(name==='readingMode'){api.render(true);restoreAnchor(anchor);}
      else {const restore=()=>{if(current===revision&&form.isConnected)restoreReadingViewport(viewport);};requestAnimationFrame(restore);if(name==='fontFamily')document.fonts.ready.then(restore);}
    };
    form.oninput=event=>apply(event.target);
    form.onchange=event=>{if(event.target.matches('select,input[type=radio]'))apply(event.target);};
    form.addEventListener('click',event=>{
      const size=event.target.closest('[data-size-step]'),leading=event.target.closest('[data-leading]');
      if(size){const field=form.elements.fontSize;field.value=Math.max(16,Math.min(30,Number(field.value)+Number(size.dataset.sizeStep)));apply(field);}
      if(leading){const field=form.elements.lineHeight;field.value=leading.dataset.leading;apply(field);}
    });
  }
  function readAnchor(sourceBranch){const b=sourceBranch||(session()?branch():null);if(!b)return null;const nodes=document.querySelectorAll('.opening .prose p,.opening>p,.turn .prose p');let el;for(const node of nodes){if(node.getBoundingClientRect().bottom>100){el=node;break;}}if(!el)return null;const turn=el.closest('.turn'),paragraphs=[...el.parentElement.querySelectorAll('p')];try{return captureReadingAnchor(b,{turnId:turn?.id?.replace(/^turn-/, '')||null,paragraphIndex:paragraphs.indexOf(el),offset:el.getBoundingClientRect().top});}catch{return null;}}
  function restoreAnchor(anchor){if(!session())return;const resolved=resolveReadingAnchor(branch(),anchor);if(!resolved?.anchor)return;requestAnimationFrame(()=>{const a=resolved.anchor;api.showTurn(a.turnId);const host=a.turnId?document.getElementById('turn-'+a.turnId):document.querySelector('.opening');const prose=host?.matches('.prose')?host:host?.querySelector('.prose');const el=prose?.querySelectorAll('p')[a.paragraphIndex]||prose;if(el)window.scrollBy({top:el.getBoundingClientRect().top-(a.offset??100),behavior:'instant'});});}
  function captureSelection(){const selected=window.getSelection();if(!selected||selected.isCollapsed)return;const quote=selected.toString().trim();if(!quote||quote.length>4000)return;const node=selected.anchorNode?.parentElement,prose=node?.closest('.prose'),turn=node?.closest('.turn');if(!prose||!document.querySelector('#main')?.contains(prose))return;if(!prose.contains(selected.focusNode))return;selection={turnId:turn?.id.replace(/^turn-/,'')||null,quote,objectId:''};const bar=document.querySelector('[data-selection-tools]');if(bar)bar.hidden=false;}
  function help(){open('帮助',`<div class="stack"><section><h3>一个输入框，就能进入故事</h3><p>写行动、说对白，或输入「继续」。查看地图、状态、物品，可以直接提问，也可以点击输入框旁的「+」，选择地图、物品、时间或手记。</p></section><details><summary>阅读、时间与分支</summary><p>查看资料不会推进故事。想略过一段时间，可从「+」打开时间与日程，选择等待或略过，写下目标与上限。回看原文不会回档；每段正文的记录选项可以创建分支。</p></details><details><summary>笔记与引用</summary><p>选中正文可引用、收藏或写笔记。私人笔记不发送给模型；附在输入框里的引用会随你的下一次输入发送。</p></details><details><summary>保存与模型</summary><p>暂不支持云同步。浏览器记录和本机服务数据共同保存进度；导出的 JSON 不能单独迁移全部新开局。生成会使用已连接模型的账号额度。</p></details><details><summary>记录问题</summary><p>以下反馈只保存在本机，可自行导出。</p>${btn('记录问题','local-feedback')}${btn('查看记录','feedback-history')}</details></div>`);}
  function handle(action,target){
    if(action==='dismiss-selection'){selection=null;const bar=document.querySelector('[data-selection-tools]');if(bar)bar.hidden=true;return true;}
    const s=session();if(action==='help'){reset();help();return true;}
    if(action==='local-feedback'){open('本机反馈草稿',`<form>${text('问题或建议','message','','required maxlength="4000"')}<p class="small muted">默认不附故事内容。保存后可查看或导出，不会自动发送。</p><button class="btn primary" type="submit">保存反馈</button></form>`,d=>{const db=api.getDB();db.feedback??=[];db.feedback.push({id:crypto.randomUUID(),text:String(d.get('message')),createdAt:Date.now(),status:'仅保存在本机，未发送'});api.save();document.querySelector('#dialog').close();api.toast('已保存在本机。');});return true;}
    if(action==='export-feedback'){api.download('人生复本-本机反馈.json',JSON.stringify(api.getDB().feedback||[],null,2),'application/json');return true;}
    if(action==='feedback-history'){const entries=api.getDB().feedback||[];open('本机反馈记录',(entries.length?btn('导出这些反馈','export-feedback'):'')+entries.map(x=>`<article><p>${esc(x.text)}</p><small>${esc(x.status)}</small></article>`).join('')||'<p>还没有本机反馈。</p>');return true;}
    if(['pin-story','trash-story','delete-story','restore-story','story-note'].includes(action)){const story=api.getDB().sessions.find(x=>x.id===target.dataset.id);if(!story)return true;
      if(action==='story-note')open('整理这段故事',`<form>${field('名称','title',story.title,'required maxlength="100"')}${field('分组（可留空）','group',story.personal?.group||'','maxlength="100"')}${text('私人备注','note',story.personal?.note||'','maxlength="4000"')}<button class="btn primary" type="submit">保存</button></form>`,d=>{Object.assign(story,updateStoryMetadata(story,Object.fromEntries(d)));api.save();document.querySelector('#dialog').close();api.render(true);});
      else if(action==='trash-story'||action==='delete-story')api.confirmAction('移入回收箱','故事及全部分支仍保留，可从回收箱恢复。不会永久删除。',()=>{Object.assign(story,trashStory(story));api.save();api.render(true);},'移入回收箱');
      else{Object.assign(story,action==='restore-story'?restoreStory(story):updateStoryMetadata(story,{pinned:!story.personal?.pinned}));api.save();api.render(true);}return true;}
    if(!s)return false;
    try{
      if(action==='play-time'||action==='time-control'){reset();showTime();return true;}
      if(action==='play-time-mode'){reset();showTimeForm(['short','until','skip'].includes(target.dataset.mode)?target.dataset.mode:'skip');return true;}
      if(action==='play-around'){reset();if(api.showQuery)api.showQuery('around');else open('周围',aroundView(playArgs()));return true;}
      if(action==='play-inventory'){reset();if(api.showQuery)api.showQuery('inventory');else open('身上',inventoryView(playArgs()));return true;}
      if(action==='play-journal'){reset();journalQuery='';showJournal();return true;}
      if(action==='play-journal-history'){reset();historyQuery=target.dataset.query||'';historyFrom=0;historyTo='';showHistory();return true;}
      if(action==='play-plan'){reset();addPlan();return true;}
      if(action==='play-compose'){document.querySelector('#dialog')?.close();document.querySelector('#action-input')?.focus({preventScroll:true});return true;}
      if(action==='play-participation'){reset();open('参与方式',participationView({participation:s.preferences?.participation||'act'}));return true;}
      if(action==='play-set-participation'||action==='take-control'){void setParticipation(action==='take-control'?'act':target.dataset.mode).catch(error=>api.toast(error.message));return true;}
      if(action==='situation'||action==='info'){reset();showSituation();return true;}
      if(action==='object-detail'){showObject(target.dataset.object||target.dataset.id);return true;}
      if(action==='historical-state'){reset();showSituation(target.dataset.node||null);return true;}
      if(action==='history'){reset();historyQuery='';historyFrom=0;historyTo='';showHistory();return true;}
      if(action==='compare-experience'){reset();showComparison();return true;}
      if(action==='history-jump'||action==='source-jump'){jump(target.dataset.node);return true;}
      if(action==='return-current'){jump(branch().turns.at(-1)?.id);const n=document.querySelector('[data-history-notice]');if(n)n.hidden=true;return true;}
      if(action==='time-preset'){const f=document.querySelector('#time-form');if(f){const field=f.elements.namedItem(target.dataset.duration?'duration':'limit');if(field){field.value=target.dataset.duration||target.dataset.limit||'';field.focus();}for(const preset of f.querySelectorAll?.('[data-duration]')||[])preset.setAttribute('aria-pressed',String(preset===target));}return true;}
      if(action==='reader-settings'){reset();showSettings();return true;}
      if(action==='reset-reading'){const anchor=readAnchor();Object.assign(api.getDB().settings,resetReadingAppearance(api.getDB().settings));api.applySettings();applyReadingAppearance(api.getDB().settings);api.save();showSettings();restoreAnchor(anchor);return true;}
      if(['draft-object','note-object','play-talk'].includes(action)){const obj=data().objects.find(o=>o.id===(target.dataset.object||target.dataset.id));if(!obj){api.toast('对象已过期，请重新查询。');return true;}if(action==='play-talk'&&(selectedSnapshot!==undefined||!aroundObjects(playArgs()).people.some(o=>o.id===obj.id))){api.toast('当前记录没有确认他仍在场。请重新查看周围。');return true;}const source=branch().turns.find(t=>t.state.version===obj.sourceVersion),prose=source?.prose||branch().opening||world().opening||'';selection={turnId:source?.id||null,quote:prose.split(/\n\s*\n/).find(p=>p.includes(obj.name))?.slice(0,1500)||prose.slice(0,1500),objectId:obj.id};if(action==='note-object'){annotate('note');return true;}quoteSelection();if(action==='draft-object'&&target.dataset.draft)setDraft(target.dataset.draft);return true;}
      if(action==='follow-object'||action==='mute-object'){const id=target.dataset.object;if(action==='follow-object')mutateBranch(toggleObjectFocus(branch(),id));else mutateBranch(muteReminder(branch(),id,!personal().objects?.[id]?.muted));showObject(id);return true;}
      if(action==='notes'){reset();showNotes();return true;}
      if(action==='remove-note'){mutateBranch(removeAnnotation(branch(),target.dataset.id));if(target.dataset.return==='journal')showJournal();else showNotes();return true;}
      if(action==='bookmark'){const t=branch().turns.find(x=>x.id===target.dataset.node);selection={turnId:t?.id||null,quote:(t?.prose||branch().opening||world().opening).slice(0,180)};annotate('bookmark');return true;}
      if(action==='selection-note'||action==='selection-clip'){annotate(action==='selection-note'?'note':'clip');return true;}
      if(action==='selection-reference'){quoteSelection();return true;}
      if(action==='selection-ask'){if(selection)api.requestAssistance('ask','只按目前已知信息解释这段，不推进故事：\n'+selection.quote.slice(0,6000));return true;}
      if(action==='selection-feedback'){if(!selection)return true;const ref={...selection},isLast=ref.turnId===branch().turns.at(-1)?.id;open('指出这段的问题','<form><blockquote>'+esc(ref.quote.slice(0,1200))+'</blockquote>'+text('哪里不对，应该依据什么？','issue','','required maxlength="1200"')+'<p class="small muted">'+(isLast?'检查后先给提案，采纳才建立修复分支。':ref.turnId?'这是较早的正文。先在此处另开分支再检查，原分支的后来经历保持完整。':'开场来自世界设定，可以通过作者改写建立新版本。')+'</p><button class="btn primary" type="submit">'+(ref.turnId?(isLast?'检查并提出修复':'另开分支并检查'):'查看作者改写')+'</button></form>',form=>{if(!ref.turnId){api.openRewrite();return;}if(!isLast){api.cancelRequest();api.forkBranch(s,ref.turnId,'历史问题检查');api.save();api.render();}api.requestAssistance('repair',String(form.get('issue'))+'\n选中原文：'+ref.quote.slice(0,650));});return true;}
      if(action==='remove-reference'){const refs=personal().draftReferences.filter((_,i)=>i!==Number(target.dataset.index));const next=structuredClone(branch());next.personal=personal();next.personal.draftReferences=refs;mutateBranch(next);refreshReferences();return true;}
      if(action==='clear-draft'){setDraft('');mutateBranch(setDraftContext(branch(),{references:[],intent:''}));refreshReferences();return true;}
      if(action==='expand-input'){const f=document.querySelector('#action-input');f?.classList.toggle('expanded-input');focusActionInput();return true;}
      if(action==='epilogue'){api.confirmAction('在结局之后继续','保留这个结局，新建后日谈分支。后续承接已取得的成果。',()=>{api.cancelRequest();api.forkBranch(s,branch().turns.at(-1)?.id||null,'后日谈');api.save();api.render();api.sendTurn('epilogue',{input:'我想在已经成立的结局之后读一段后日谈。保留已取得的成果，让人物自然生活，不为继续而推翻结局或强加危机。',control:{kind:'epilogue',goal:'结局后的自然生活',until:'一个完整场景',limit:'一个场景',forbidden:'推翻已经成立的结局和成果',reserved:'新的重大承诺'}});},'开始后日谈');return true;}
      if(action==='finish-story'){document.querySelector('#dialog').close();api.sendTurn('finish',{input:'请让这段经历合理收束，回答能够回答的重要期待，保留已经取得的成果；未完成的事情如实交代，不强加新危机阻止结束。'});return true;}
      if(action==='undo-polish'){undoPolish(s);api.save();document.querySelector('#dialog').close();api.render(true);api.toast('已恢复上一版表达，事件和时间没有改变，旧引用仍保留来源。');return true;}
    }catch(error){api.toast(error.message);return true;}return false;
  }
  return {handle,invalidate,viewSnapshot,reader:args=>readerView({...args,situation:publicSituation(args.branch,args.world)}),bind(){refreshReferences();bindPanel();applyReadingAppearance(api.getDB?.()?.settings||{});bindReadingComposer(session()?.id+':'+branch().id);},captureSelection,readAnchor,restoreAnchor,persistAnchor(sourceBranch){const b=sourceBranch||(session()?branch():null),a=readAnchor(b);if(a&&b)b.personal=setReadingAnchor(b,a).personal;},references:()=>personal().draftReferences,clearReferences(){mutateBranch(setDraftContext(branch(),{references:[],intent:personal().intent}));},reset};
}
