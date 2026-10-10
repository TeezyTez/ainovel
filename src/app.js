import {readerInputCommand} from './reader-input.js';
import {BranchClient,mergeConfirmedBranch,mergeConfirmedBranches} from './branch-client.js';
import {createInteractionControls} from './interaction-controls.js';
import {localCommand} from './local-commands.js';
import {resolveGameAction,gameActionForInput} from './game-state.js';
import {gameRecallView,gameInspectView} from './game-ui.js';
import {gameQuery,gameRecallState} from './game-query.js';
import {publicSituation} from './experience-state.js';
import {parseWorldImport} from './world-import.js';
import {createExperienceControls} from './experience-controls.js';
import {validateReference,ensurePersonal,setDraftContext,trashStory,restoreStory,updateStoryMetadata} from './personal-library.js';
import {discoveryView,libraryView} from './library-ui.js';
import {narrativeForBranch} from './narrative-state.js';
import {PRESET_WORLDS} from './worlds.js';
import {ADDITIONAL_WORLDS,getExperience} from './situations.js';
import {publicRecap,selectContext,detectIntent,applyPolish,applyRepair} from './experience.js';
import {homeView,detailView,creatorView,intentControls} from './experience-views.js';
import {demoActions} from './demo.js';
import {mergeArchive} from './data-transfer.js';
import {parseRoute,shouldSend} from './ui-behavior.js';
import {uid,clone,worldKey,createSession,getBranch,currentState,commitTurn,forkBranch,validateArchive,validateWorld,exportMarkdown} from './core.js';
import {LocalRepository,defaultSettings,STORAGE_KEY} from './storage.js';
import {DemoProvider,RealProvider} from './providers.js';

const $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paragraphs=s=>String(s||'').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('');
const button=(label,action,classes='',attrs='')=>`<button type="button" class="btn ${classes}" data-action="${action}" ${attrs}>${label}</button>`;
const link=(label,path,classes='')=>`<a class="${classes}" href="#${path}">${label}</a>`;
const tag=t=>`<span class="tag">${esc(t)}</span>`;
const date=t=>new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(t||Date.now());
const option=(values,value)=>values.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('');
const input=(label,name,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
const area=(label,name,value='',extra='')=>`<label class="field">${label}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const select=(label,name,values,value)=>`<label class="field">${label}<select name="${name}">${option(values,value)}</select></label>`;
let repository;try{repository=new LocalRepository(window.localStorage);}catch{repository=new LocalRepository({getItem:()=>null,setItem:()=>{throw new Error('storage blocked');}});}
const branchClient=new BranchClient(repository.storage);
let recovering=false;
let assistantJob=null,intentMode='auto',gameRecall=null;
let db,loadError='',saveError='',pending=null,readerError='',readerNotice='',focusMode=false,archiveTab=false,editor=null,editorDirty=false,saveTimer,toastTimer,routeStarted=performance.now(),lastRoute='',modelConfig={available:false};
let discoveryOrder=0,readingPage=null,readingSince=Date.now(),restShown=false,lastReadTick=Date.now(),readingElapsed=0,recentDraft='',retryRequest=null,discoveryOptions={query:'',tag:'',excludeTag:'',onlyFavorites:false},libraryOptions={query:'',category:'active',group:'',sort:'updated'};
const anonymousId=uid();
try{db=repository.load(PRESET_WORLDS);}catch(e){loadError=e.message;db={schemaVersion:1,worlds:clone(PRESET_WORLDS),sessions:[],settings:{...defaultSettings},telemetry:[]};}
if(!loadError){for(const w of ADDITIONAL_WORLDS)if(!db.worlds.some(existing=>existing.id===w.id))db.worlds.push(clone(w));}
function normalizeSettings(){const s=db.settings; for(const key of ['fontSize','lineHeight','width']){const ranges={fontSize:[16,30],lineHeight:[1.5,2.5],width:[480,880]},[min,max]=ranges[key];s[key]=Math.max(min,Math.min(max,Number(s[key])||defaultSettings[key]));}if(!['light','dark','system'].includes(s.theme))s.theme='light';}
function applySettings(){normalizeSettings();const s=db.settings;document.body.dataset.theme=s.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s.theme;document.body.classList.toggle('reduce-motion',!!s.reducedMotion);document.documentElement.style.setProperty('--read-size',s.fontSize+'px');document.documentElement.style.setProperty('--read-leading',s.lineHeight);document.documentElement.style.setProperty('--read-width',s.width+'px');document.body.dataset.readingFont=s.fontFamily||'serif';document.body.dataset.paragraphGap=s.paragraphGap||'normal';document.documentElement.style.setProperty('--reading-paragraph-gap',({compact:'.65em',normal:'1.15em',wide:'1.7em'})[s.paragraphGap]||'1.15em');}
function save(silent=false){if(loadError)return false;try{repository.save(db);saveError='';updateSaveLabels();return true;}catch(e){saveError=e.message;if(e.code==='STORAGE_CONFLICT')readerNotice='另一标签页有新进展，请从保存提示处理冲突。';updateSaveLabels();if(!silent)toast(saveError);return false;}}
function scheduleSave(){document.querySelectorAll('[data-save]').forEach(el=>el.textContent='正在保存…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),220);}
function updateSaveLabels(){document.querySelectorAll('[data-save]').forEach(el=>{el.textContent=saveError?'保存失败 · 请导出备份':'已保存在此设备';el.classList.toggle('save-error',!!saveError);if(saveError){el.dataset.action='storage-conflict';el.setAttribute('role','button');el.tabIndex=0;}else{delete el.dataset.action;el.removeAttribute('role');el.removeAttribute('tabindex');}});}
function record(type){db.telemetry.push({type,time:Date.now(),anonymousSession:anonymousId,durationMs:Math.round(performance.now()-routeStarted)});db.telemetry=db.telemetry.slice(-500);save(true);}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('toast-visible'),5000);}
function currentRoute(){return parseRoute(location.hash);}
const sessionNow=()=>db.sessions.find(s=>s.id===currentRoute().id);
const findWorld=key=>db.worlds.find(w=>worldKey(w)===key);
const latestWorld=id=>db.worlds.filter(w=>w.id===id).sort((a,b)=>b.version-a.version)[0];
const sessionWorld=s=>findWorld(getBranch(s).worldKey);
const experience=createExperienceControls({sessionNow,getBranch,sessionWorld,getDB:()=>db,save,openDialog,toast,sendTurn,render,applySettings,requestAssistance,confirmAction,cancelRequest,forkBranch,download,openRewrite:rewritePanel,showTurn(node){if(db.settings.readingMode==='paged'){readingPage=node?getBranch(sessionNow()).turns.findIndex(t=>t.id===node)+1:0;render(true);}}});
const interaction=createInteractionControls({session:sessionNow,branch:getBranch,world:sessionWorld,settings:()=>db.settings,save,toast,refresh:refreshReaderLive,source:node=>experience.handle('source-jump',{dataset:{node}}),draft:text=>{const b=getBranch(sessionNow());b.draft=b.draft?b.draft+'\n'+text:text;save();refreshReaderLive();$('#action-input')?.focus();}});
function mergeWorlds(worlds=[]){for(const world of worlds){const index=db.worlds.findIndex(w=>worldKey(w)===worldKey(world));if(index<0)db.worlds.push(world);else db.worlds[index]={...world,characters:[...new Map([...db.worlds[index].characters,...world.characters].map(c=>[c.id,c])).values()]};}}
function installConfirmed(s,confirmed,world){const b=s.branches.find(b=>b.id===confirmed.id);if(!b)throw new Error('恢复结果的分支不存在。');Object.assign(b,mergeConfirmedBranch(b,confirmed));if(world)mergeWorlds([world]);s.updatedAt=Date.now();}
async function ensureLedger(s,signal){const keys=new Set(s.branches.map(b=>b.worldKey));const registered=await branchClient.register(s,db.worlds.filter(w=>keys.has(worldKey(w))),signal);if(registered){const b=getBranch(s),remote=registered.session.branches.find(x=>x.id===b.id);const changed=remote.turns.length!==b.turns.length||remote.turns.at(-1)?.prose!==b.turns.at(-1)?.prose;installConfirmed(s,remote,registered.worlds.find(w=>worldKey(w)===b.worldKey));if(changed){save();throw new Error('已恢复服务端确认的进展。草稿保留，请按当前情况重新发送。');}}}
async function recoverStory(quiet=false){const s=sessionNow();if(!s||s.mode!=='real'||pending||assistantJob||recovering)return;const recoveringBranch=s.activeBranch;recovering=true;try{const journal=branchClient.journal(),matching=journal?.sessionId===s.id&&journal?.branchId===s.activeBranch;const result=await branchClient.read(s,matching?journal.requestId:undefined);if(sessionNow()?.id!==s.id||s.activeBranch!==recoveringBranch)return;const b=getBranch(s),changed=result.branch.turns.length!==b.turns.length||result.branch.turns.at(-1)?.prose!==b.turns.at(-1)?.prose;if(changed)installConfirmed(s,result.branch,result.world);if(result.receipt){branchClient.journal(null);retryRequest=null;readerError='';readerNotice='已恢复上次确认的结果，没有重复执行。';}else if(matching&&journal.body){retryRequest={sid:s.id,bid:b.id,body:{...journal.body,state:clone(currentState(s))}};readerError='上次请求尚无已提交回执，可以重试同一请求。';}if(changed||result.receipt){save();render(true);}else if(matching)refreshReaderLive();else if(!quiet)toast('已与本机服务核对，故事停在当前进度。');}catch(error){if(!quiet||!['BRANCH_NOT_REGISTERED','OWNER_REQUIRED'].includes(error.code))toast(error.message);}finally{recovering=false;if(sessionNow()?.id===s.id)refreshReaderLive();}}
async function editConfirmed(kind,{text,proposal,reason,rules,name}={}){const s=sessionNow(),b=getBranch(s),last=b.turns.at(-1);await ensureLedger(s);const result=await branchClient.request('/api/branch/edit',{sessionId:s.id,branchId:b.id,baseVersion:currentState(s).version,turnId:last?.id||null,expectedProse:last?.prose||'',requestId:uid(),kind,text,proposal,reason,rules,name});result.session.branches=mergeConfirmedBranches(s.branches,result.session.branches);Object.assign(s,{...result.session,preferences:s.preferences,saves:s.saves,title:s.title,archived:s.archived,...(s.conclusion?{conclusion:s.conclusion}:{}),...(s.personal?{personal:s.personal}:{})});mergeWorlds(result.worlds);save();render(true);}
function allLatest(){return [...new Set(db.worlds.map(w=>w.id))].map(latestWorld);}
function navigate(path){location.hash=path;}
function cancelRequest(notify=false){if(pending){pending.controller.abort();pending=null;if(notify){readerNotice='已停止等待。草稿保留；若服务端已确认，可恢复结果。';toast(readerNotice);}}}
function openDialog(title,content,onSubmit){if(dialog.open)dialog.close();dialog.className='';const previous=document.activeElement;dialog.innerHTML=`<div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-button" type="button" aria-label="关闭面板" data-action="close-dialog">×</button></div><div class="dialog-content">${content}</div>`;dialog.showModal();dialog.onclose=()=>{if(previous?.isConnected)previous.focus();};if(onSubmit)dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();await onSubmit(new FormData(e.currentTarget));};}
function confirmAction(title,message,action,label='确认'){openDialog(title,`<p>${esc(message)}</p><div class="dialog-footer">${button('取消','close-dialog')}${button(esc(label),'confirm','primary')}</div>`);dialog.querySelector('[data-action=confirm]').onclick=()=>{dialog.close();action();};}
function askName(title,value,action){openDialog(title,`<form>${input('名称','name',value,'required maxlength="100" autofocus')}<div class="dialog-footer">${button('取消','close-dialog')}<button class="btn primary" type="submit">保存</button></div></form>`,data=>{action(String(data.get('name')).trim());dialog.close();});}
function download(name,content,type='text/plain'){
  const url=URL.createObjectURL(new Blob([content],{type})),filename=name.replace(/[<>:"/\\|?*]/g,'_');
  openDialog('导出已准备',`<p class="small muted">下载为本地文件，或复制下方完整内容。若内置浏览器没有处理下载，可复制后保存为同名文件。</p><label class="field">文件内容<textarea readonly rows="10" aria-label="导出文件内容">${esc(content)}</textarea></label><div class="dialog-footer"><button type="button" class="btn" id="copy-export">复制内容</button><a class="btn primary" href="${url}" download="${esc(filename)}">下载文件</a></div><p class="small muted" style="margin-top:12px">${esc(filename)}</p>`);
  dialog.querySelector('#copy-export').onclick=async()=>{try{await navigator.clipboard.writeText(content);toast('内容已复制。');}catch{dialog.querySelector('textarea').select();toast('请按 Ctrl / ⌘ + C 复制选中的内容。');}};
  dialog.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
}

function shell(content,active='worlds'){return `<header class="site-header"><a href="#/" class="brand" aria-label="方糖首页"><span class="brand-mark">糖</span><div><div class="brand-name">方糖</div><div class="brand-note">故事因你而起</div></div></a><nav class="nav" aria-label="主导航"><a href="#/" class="${active==='worlds'?'active':''}">发现故事</a><a href="#/stories" class="${active==='stories'?'active':''}">我的故事</a><a href="#/create" data-nav="create" class="${active==='create'?'active':''}">创作</a><a href="#/settings" class="nav-settings ${active==='settings'?'active':''}" aria-label="设置">设置</a></nav></header>${content}<footer class="site-footer"><span>方糖 · 留一点空白，让想象发生。</span><span>无需登录 <span class="divider-dot">/</span> 保存在此设备</span></footer>`;}
function worldCard(w,index){return `<a class="world-card" href="#/world/${w.id}"><div class="world-index"><span>${String(index+1).padStart(2,'0')} / ${w.custom?'你的设想':'一段可能的人生'}</span><span>↗</span></div><h3>${esc(w.title)}</h3><div class="tags">${(w.tags||[]).map(tag).join('')}</div><p class="description">${esc(w.tagline||w.description)}</p><footer><span>${esc(w.pace||'从容阅读').split(' · ')[0]} · ${w.custom?'私有世界':'约 8 个片刻'}</span><span>走进这个世界 →</span></footer></a>`;}
function home(){return shell(quickEntry()+discoveryView({worlds:allLatest(),sessions:db.sessions,getExperience,recap:s=>publicRecap(s,sessionWorld(s)),available:modelConfig.available,favorites:db.settings.favoriteWorlds||[],excluded:db.settings.excludedWorlds||[],orderSeed:discoveryOrder,...discoveryOptions}));}
function quickEntry(){return '<section class="page quick-entry"><form id="quick-start-form"><label for="quick-seed">一句话，走进你的世界</label><textarea id="quick-seed" name="seed" maxlength="8000" required placeholder="我想在下雨的小城开一家旧书店，和来往的人慢慢熟悉。">'+esc(db.settings.quickSeed||'')+'</textarea><div class="row"><button class="btn primary" type="submit" '+(!modelConfig.available||assistantJob?'disabled':'')+'>'+(assistantJob?.kind==='quick-world'?'正在写下第一幕…':'生成并进入故事')+'</button>'+(assistantJob?.kind==='quick-world'?button('停止，保留想法','cancel-assist','compact'):'<a class="text-button" href="#/create">详细创作</a>')+'</div><p>不用填世界百科。第一幕生成后直接进入，设定可以以后再看。</p></form></section>';}
async function quickStart(seed){
 if(!seed.trim()||!modelConfig.available||assistantJob||pending)return;
 db.settings.quickSeed=seed;save();const job={kind:'quick-world',controller:new AbortController(),route:location.hash};assistantJob=job;render(true);
 try{const requestId=db.settings.quickRequest?.seed===seed?db.settings.quickRequest.requestId:uid();db.settings.quickRequest={seed,requestId};save();const result=await branchClient.request('/api/world/start',{requestId,seed},job.controller.signal);if(assistantJob!==job||job.controller.signal.aborted||location.hash!==job.route)return;const story=result.session;validateArchive({schemaVersion:1,worlds:result.worlds,sessions:[story]});mergeWorlds(result.worlds);if(!db.sessions.some(s=>s.id===story.id))db.sessions.push(story);delete db.settings.quickRequest;assistantJob=null;db.settings.quickSeed='';if(!save()){render(true);return;}navigate('/story/'+story.id);
 }catch(error){if(assistantJob!==job)return;assistantJob=null;render(true);if(error.name!=='AbortError')toast(error.message+'，你的想法已保留。');}
}
function worldDetail(id){const w=latestWorld(id);if(!w)return notFound('这个世界还不存在','请返回入口，选择另一段经历。');return shell(detailView({world:w,experience:getExperience(w),settings:db.settings,available:modelConfig.available,provider:modelConfig.provider,sessions:db.sessions}));}
function newDraft(){return {id:'world-'+uid(),version:1,title:'',seed:'',description:'',tagline:'',era:'',rules:[''],characters:[],location:'',identity:'',goal:'',opening:'',tags:['自建世界'],pace:'从容阅读',custom:true,narrative:{perspective:'第二人称',length:'适中',style:'细腻克制',pace:'从容'},originalVersion:0};}
function getEditor(id){if(editor&&editor.editId===(id||''))return editor;if(id){const w=latestWorld(id);if(!w)return null;if(db.worldDraft?.editId===id)return editor=clone(db.worldDraft);editor={...clone(w),originalVersion:w.version,editId:id,custom:!!w.custom};}else editor=db.worldDraft&&!db.worldDraft.editId?clone(db.worldDraft):{...newDraft(),editId:''};return editor;}
function characterFields(c,i){return `<div class="character-editor"><div class="row between"><h3>人物 ${i+1}</h3>${button('移除','remove-character','compact',`data-index="${i}"`)}</div><div class="field-grid">${input('姓名',`char-${i}-name`,c.name,'required maxlength="100"')}${input('身份',`char-${i}-role`,c.role,'maxlength="200"')}</div><div class="stack" style="margin-top:15px">${area('公开介绍 / 外在表现',`char-${i}-public`,c.public,'maxlength="3000"')}${input('人物自己的目标',`char-${i}-goal`,c.goal,'maxlength="500"')}${input('关系与重要经历',`char-${i}-history`,c.history||'','maxlength="1000"')}${area('幕后秘密 · 仅作者可见',`char-${i}-secret`,c.secret,'maxlength="3000"')}</div></div>`;}
function createView(id){const w=getEditor(id);if(!w)return notFound('找不到这个世界','请返回入口。');return shell(creatorView({world:w,id,available:modelConfig.available,busy:['world','quick-world'].includes(assistantJob?.kind),characterFields}),'create');}
function collectEditor(){const form=$('#world-form');if(!form||!editor)return;const data=new FormData(form);for(const key of ['seed','title','description','era','identity','location','goal','opening'])editor[key]=String(data.get(key)||'');editor.rules=String(data.get('rules')||'').split('\n').map(x=>x.trim()).filter(Boolean);editor.tagline=editor.description.slice(0,100);editor.narrative=Object.fromEntries(['perspective','length','style','pace'].map(k=>[k,String(data.get(k)||'')]));editor.characters.forEach((c,i)=>{for(const key of ['name','role','public','goal','history','secret'])c[key]=String(data.get(`char-${i}-${key}`)||'');});db.worldDraft=clone(editor);editorDirty=true;}
function persistEditor(){collectEditor();scheduleSave();}
function publishWorld(){collectEditor();try{const w=clone(editor);w.title=w.title.trim();w.version=(latestWorld(w.id)?.version||0)+1;w.rules=w.rules.length?w.rules:['人物拥有自己的生活与选择。'];delete w.editId;delete w.originalVersion;delete w.additions;w.demoCompatible=false;validateWorld(w);db.worlds.push(w);db.worldDraft=null;editor=null;editorDirty=false;record('world_created');const ok=save();if(ok)toast('私有世界已保存。已有故事保持原版本。');navigate('/world/'+w.id);}catch(e){toast(e.message);}}

function stories(){return shell(libraryView({sessions:db.sessions,...libraryOptions}),'stories');}
function reader(){const session=sessionNow();if(!session)return notFound('这一段故事没有找到','这个地址对应的存档不在当前浏览器。可以导入之前导出的 JSON 存档。');const branch=getBranch(session),world=sessionWorld(session),state=currentState(session);let suggestions=[];try{suggestions=session.mode==='demo'?demoActions(world,state):branch.turns.at(-1)?.suggestions||[];}catch{}const html=experience.reader({session,branch,world,state,suggestions,busy:pending?.sid===session.id||!!assistantJob||recovering,error:readerError,notice:readerNotice,settings:db.settings,intentMode,focusMode,page:readingPage??branch.turns.length,saveStatus:saveError?'保存失败，请先备份':'已保存在此设备',references:ensurePersonal(branch).draftReferences});const recalled=gameRecall?.sid===session.id&&gameRecall?.bid===branch.id?gameRecallView(gameRecallState(state,publicSituation(branch,world)),{kind:gameRecall.kind,node:branch.turns.at(-1)?.id}):'';const contextual=interaction.html();return html.replace('<div data-draft-references','<div data-reader-live="context-selection">'+contextual.selection+'</div><div data-draft-references').replace('<div id="reader-bottom"','<div data-reader-live="context-result" id="context-result">'+contextual.panel+'</div><div data-reader-live="game-recall" id="game-recall">'+recalled+'</div><div id="reader-bottom"');}
function notFound(title,message){return shell(`<main id="main" class="page"><div class="error-page"><div class="eyebrow">A PAGE NOT YET WRITTEN</div><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="row" style="justify-content:center">${link('返回世界','/','btn primary')}${link('我的故事','/stories','btn')}</div></div></main>`);}
function settings(){const s=db.settings;return shell(`<main class="page" id="main"><header class="page-heading"><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>留一个舒服的位置</h1><p class="muted">阅读的节奏，由你决定。</p></header><div class="settings-layout"><aside class="settings-sidebar"><div>阅读偏好</div><div>叙述偏好</div><div>数据与运行模式</div></aside><div><section class="settings-block"><h2>阅读偏好</h2><div class="setting-row"><div><label for="theme">页面主题</label><p>让文字适应此刻的光线。</p></div><select id="theme" class="control" data-setting="theme"><option value="light" ${s.theme==='light'?'selected':''}>暖白</option><option value="dark" ${s.theme==='dark'?'selected':''}>夜读</option><option value="system" ${s.theme==='system'?'selected':''}>跟随系统</option></select></div>${[['fontSize','正文字号',16,24,1,'px'],['lineHeight','行间距离',1.6,2.4,.05,''],['width','正文宽度',600,840,20,'px']].map(([key,label,min,max,step,unit])=>`<div class="setting-row"><label for="${key}">${label} <span class="small muted" id="value-${key}">${s[key]}${unit}</span></label><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-setting="${key}"></div>`).join('')}${[['reducedMotion','减少动态效果'],['sendEnter','Enter 直接发送（Shift + Enter 换行）'],['showSuggestions','显示建议行动']].map(([key,label])=>`<div class="setting-row"><label for="${key}">${label}</label><input id="${key}" type="checkbox" data-setting="${key}" ${s[key]?'checked':''}></div>`).join('')}<div class="reading-sample prose"><span class="preview-label">阅读预览 · 修改立即生效</span>雨停的时候，街上的灯刚好亮起。你把书翻过一页，决定再多坐一会儿。</div></section><section class="settings-block"><h2>叙述偏好</h2><p class="small muted">作为新故事的默认偏好，影响后续模型生成。演示正文固定，不会重写历史。</p><div class="field-grid">${[['perspective','视角',['第二人称','第一人称','第三人称']],['length','篇幅',['简短','适中','舒展']],['pace','节奏',['从容','适中','紧凑']],['style','文风',['细腻克制','明快简洁','诗意留白','朴素日常']]].map(([key,label,values])=>`<label class="field">${label}<select data-setting="${key}">${option(values,s[key])}</select></label>`).join('')}</div></section><section class="settings-block"><h2>数据与运行模式</h2><div class="notice"><strong>${modelConfig.available?esc(modelConfig.provider)+(modelConfig.provider==='Codex 本机授权'?' · 已登录':' · 已配置'):'当前可用：预设演示'}</strong><br>${modelConfig.available?'新建故事默认使用真实模型。当前模型：'+esc(modelConfig.model||'服务端默认')+'。':'无密钥也能完成三个世界的预设试玩。自由输入不会被伪装成模型生成。'}</div><p class="small muted" style="margin-top:18px">阅读偏好、草稿和公开存档保存在浏览器。已生成回合另存于本机服务；一句话开局的幕后设定仅保存在本机服务。尚无云同步，完整续玩需保留本机服务数据和浏览器标识。</p><div class="row">${button('导出完整存档 JSON','export-all','compact')}${button('导入存档','import-dialog','compact')}${button('重试保存','retry-save','compact')}</div><p class="small muted" style="margin:12px 0 0">JSON 导出浏览器中的公开记录与草稿；旧故事可能含作者幕后资料。新的一句话开局还需备份项目 .data 目录及此浏览器标识才能完整续玩。分享请导出正文。</p><details style="margin-top:18px"><summary style="font-size:18px">配置真实模型</summary><p class="small muted">${modelConfig.provider==='Codex 本机授权'?'正在复用本机 Codex 的 ChatGPT 登录，无需 API Key。使用现有账号额度；请保持本机代理运行。':'支持本机 Codex 授权或兼容 API。'}</p><p class="small muted">其他供应商：在项目根目录复制 .env.example 为 .env，填写服务端配置并重启。浏览器不会保存或收到模型密钥。</p><pre class="code-note">MODEL_API_KEY=仅填在服务端 .env 中\nMODEL_BASE_URL=兼容接口的 /v1 地址\nMODEL_NAME=供应商提供的模型标识\nMODEL_CONTEXT_BUDGET=12000\nMODEL_OUTPUT_BUDGET=1800\nMODEL_TIMEOUT_MS=45000\n\nnpm start</pre>${button('重新检查连接配置','check-model','compact')}<p class="small muted" style="margin-top:12px">配置入口只检查是否已配置；实际生成失败会保留输入和旧状态，不自动切换到演示。</p></details><div style="margin-top:25px">${button('清理预设演示故事','clear-demo','compact danger')}<p class="small muted" style="margin-top:8px">只删除预设世界的演示故事。自建世界与其故事、真实模型故事均保留。</p></div></section><details><summary style="font-size:18px">开发者 · 本地体验事件</summary><p class="small muted">仅记录事件类型、时间、匿名访问标识与耗时，不记录剧情和自由输入。最多保留 500 条。</p><div class="event-log">${db.telemetry.slice().reverse().map(e=>`<div>${date(e.time)} · ${esc(e.type)} · ${e.durationMs} ms</div>`).join('')||'暂无交互记录。'}</div>${button('导出事件记录','export-events','compact')}</details></div></div></main>`,'settings');}

// Disclosure is a reading preference, scoped to branch, turn and current/history.
const contextCardOpen=new Map();
function rememberContextCards(){for(const card of document.querySelectorAll('[data-context-card]'))contextCardOpen.set(card.dataset.contextCard,card.open);while(contextCardOpen.size>300)contextCardOpen.delete(contextCardOpen.keys().next().value);}
function restoreContextCards(){for(const card of document.querySelectorAll('[data-context-card]'))if(contextCardOpen.has(card.dataset.contextCard))card.open=contextCardOpen.get(card.dataset.contextCard);}
function render(keepScroll=false){rememberContextCards();const y=scrollY,{path,id}=currentRoute();applySettings();document.body.classList.toggle('focus-mode',focusMode&&path==='story');if(loadError){app.innerHTML=notFound('本机存档暂时无法读取',loadError)+`<div style="text-align:center;padding:20px">${button('下载原始数据备份','export-raw')}${button('导入有效存档以恢复','recover-import')}</div>`;return;}try{app.innerHTML=path==='world'?worldDetail(id):path==='create'?createView():path==='edit'?createView(id):path==='stories'?stories():path==='story'?reader():path==='settings'?settings():path===''?home():notFound('这一页没有找到','请通过导航返回世界或已有故事。');}catch(e){console.error(e);app.innerHTML=notFound('这一页暂时无法打开','数据没有被删除。请返回我的故事或从设置导出备份。');}updateSaveLabels();document.title=(path==='story'&&sessionNow()?sessionNow().title+' · ':'')+'方糖';restoreContextCards();bindForms();if(keepScroll)requestAnimationFrame(()=>scrollTo(0,y));}
function bindForms(){requestAnimationFrame(()=>centerMaps());interaction.bind();const quick=$('#quick-start-form');if(quick){quick.onsubmit=e=>{e.preventDefault();quickStart(String(new FormData(quick).get('seed')||''));};quick.oninput=()=>{db.settings.quickSeed=quick.elements.seed.value;scheduleSave();};}if(currentRoute().path==='story'&&sessionNow())experience.bind();for(const [selector,options] of [['#discovery-form',discoveryOptions],['#library-form',libraryOptions]]){const f=$(selector);if(f)f.onsubmit=e=>{e.preventDefault();const d=new FormData(f);for(const key of Object.keys(options))options[key]=key==='onlyFavorites'?d.has(key):String(d.get(key)||'');render(true);};}const start=$('#start-form');if(start)start.onsubmit=e=>{e.preventDefault();const d=new FormData(start),w=latestWorld(start.dataset.world),s=createSession(w,{name:String(d.get('name')||'旅人').trim()||'旅人',identity:String(d.get('identity')||w.identity).trim()||w.identity,goal:String(d.get('goal')||'')},String(d.get('mode')));s.preferences={...s.preferences,...Object.fromEntries(['perspective','length','pace','style'].map(k=>[k,db.settings[k]])),...w.narrative,participation:String(d.get('participation')||'observe'),boundaries:String(d.get('boundaries')||''),perspective:String(d.get('perspective')),length:String(d.get('length'))};db.sessions.push(s);record('story_started');save();navigate('/story/'+s.id);};const wf=$('#world-form');if(wf){wf.onsubmit=e=>{e.preventDefault();publishWorld();};wf.oninput=persistEditor;}const af=$('#action-form');if(af){af.onsubmit=e=>{e.preventDefault();sendTurn();};const field=$('#action-input');field.oninput=()=>{const s=sessionNow();if(!s)return;getBranch(s).draft=field.value;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';scheduleSave();};field.onkeydown=e=>{if(shouldSend(e,db.settings.sendEnter)){e.preventDefault();sendTurn();}};}}

// Patch only live controls and append completed turns, keeping native selection and
// existing paragraph nodes intact while the model is working.
function refreshReaderLive(){
  rememberContextCards();
  if(currentRoute().path!=='story')return;
  const template=document.createElement('template');template.innerHTML=reader();
  const source=template.content,field=$('#action-input'),focused=document.activeElement;
  const inputState=field?{value:field.value,start:field.selectionStart,end:field.selectionEnd,focused:focused===field}:null;
  const host=$('[data-reader-turns]');
  if(!host){render(true);return;}if(db.settings.readingMode==='paged'){for(const fresh of source.querySelectorAll('[data-reader-turns]>.turn')){const old=host.querySelector('.turn');if(old?.id!==fresh.id){host.replaceChildren(fresh.cloneNode(true));}}}
  for(const turn of source.querySelectorAll('[data-reader-turns]>.turn'))if(db.settings.readingMode!=='paged'&&!document.getElementById(turn.id))host.append(turn.cloneNode(true));
  for(const fresh of source.querySelectorAll('[data-reader-live]')){const old=document.querySelector('[data-reader-live="'+fresh.dataset.readerLive+'"]');if(old)old.replaceWith(fresh.cloneNode(true));}
  restoreContextCards();bindForms();updateSaveLabels();
  const next=$('#action-input');if(inputState&&next){next.value=getBranch(sessionNow()).draft||'';if(inputState.focused){next.focus({preventScroll:true});next.setSelectionRange(inputState.start,inputState.end);}}
}
async function sendTurn(actionId,options={}){
  const s=sessionNow();if(!s||pending||assistantJob||recovering)return;const b=getBranch(s),w=sessionWorld(s),field=$('#action-input');if(field)b.draft=field.value;
  const inputText=options.input??(actionId==='continue'?'让当前场景自然继续。':b.draft.trim());
  if(!inputText&&actionId!=='retry'){toast('写下你想做的事，或输入“继续”。');return;}
  const command=!actionId&&!options.input?readerInputCommand(inputText):null;
  if(command){
    if(command.action==='continue'||command.action==='retry'){actionId=command.action;}
    else if(command.action==='time'){options={...options,control:command.control};}
    else {
      if(command.action==='recover'){await recoverStory();return;}
      if(command.action==='tools')toolsPanel();
      if(command.action==='saves')branchesPanel();
      if(command.action==='epilogue'){experience.handle('epilogue',{});return;}
      if(command.action==='save'){s.saves.push({id:uid(),name:command.name||currentState(s).location,branchId:b.id,turnId:b.turns.at(-1)?.id||null,createdAt:Date.now()});}
      b.draft='';field.value='';if(save()&&command.action==='save')toast('这个片刻已保存。');refreshReaderLive();return;
    }
  }
  const query=!actionId?gameQuery(inputText):null;
  if(query){b.draft='';if(field)field.value='';interaction.hide();save();showGameRecall(query);return;}
  if(!actionId&&interaction.run(inputText)){gameRecall=null;b.draft='';const live=$('#action-input');if(live)live.value='';save();refreshReaderLive();return;}
  const local=!actionId?localCommand(inputText):null;if(local){if(local.action)experience.handle(local.action,{});else{db.settings[local.setting]=local.delta?Number(db.settings[local.setting]||18)+local.delta:local.value;applySettings();save();render(true);toast('已调整界面，故事没有变化。');}return;}
  const kind=options.input||actionId==='continue'||actionId==='retry'?'action':detectIntent(inputText);
  if(kind==='rewrite'){rewritePanel();return;}if(kind!=='action'){requestAssistance(kind,inputText);return;}
  if(s.archived){confirmAction('这段故事已封存','恢复后才能继续生成，已有正文始终可以阅读。',()=>{s.archived=false;save();render(true);},'恢复这段故事');return;}if(b.archived){toast('这条分支已封存，请先在分支面板恢复。');return;}if(b.turns.at(-1)?.ended&&actionId!=='epilogue'){toast('这一段已告一段落，可以保存、导出，或从历史节点另试一种可能。');return;}
  if(db.settings.readingMode==='paged'&&readingPage===null)readingPage=b.turns.length;
  if(s.mode==='demo'&&options.gameAction){toast('预设演示采用固定剧情。请在自由游玩中执行场景玩法。');return;}if(s.mode==='demo'&&options.control){toast('预设演示没有自由时间推进。请开始自由游玩故事。');return;}
  if(repository.hasExternalChange()){conflictPanel();return;}if(!save())return;
  let body;try{
    if(!actionId&&!options.gameAction&&s.mode==='real')options={...options,gameAction:gameActionForInput(currentState(s),inputText,b.id)};
    if(actionId==='retry'){if(!retryRequest||retryRequest.sid!==s.id||retryRequest.bid!==b.id||retryRequest.body.state.version!==currentState(s).version)throw new Error('这次请求已经过期，请重新发送。');body=clone(retryRequest.body);}
    else{const selection=interaction.selection();const refs=experience.references().map(ref=>{validateReference(b,ref);return {...ref,sourceText:ref.turnId?b.turns.find(t=>t.id===ref.turnId).prose:b.opening};});body={requestId:uid(),world:w,worldKey:b.worldKey,branchId:b.id,baseVersion:currentState(s).version,state:clone(currentState(s)),player:s.player,preferences:s.preferences,...selectContext(b,inputText),narrative:narrativeForBranch(b),input:inputText,actionId,...(selection?{selection}:{}),...(options.control?{control:{...options.control,worldKey:b.worldKey,branchId:b.id,baseVersion:currentState(s).version}}:{}),...(refs.length?{references:refs}:{}),...(options.gameAction?{gameAction:options.gameAction}:{})};}
  }catch(e){toast(e.message);return;}
  const controller=new AbortController(),requestId=body.requestId,bid=b.id;
  pending={sid:s.id,bid,controller,requestId};retryRequest={sid:s.id,bid,body:clone(body)};readerError='';readerNotice='';refreshReaderLive();
  try{let proposal;if(s.mode==='demo')proposal=await new DemoProvider().generate(body,controller.signal);else{await ensureLedger(s,controller.signal);const scoped={sessionId:s.id,...Object.fromEntries(['requestId','branchId','baseVersion','input','preferences','control','gameAction','references','selection'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))};branchClient.journal({sessionId:s.id,branchId:b.id,requestId:body.requestId,body:scoped});proposal=await branchClient.generate(scoped,controller.signal);}
    if(controller.signal.aborted||pending?.requestId!==requestId||s.activeBranch!==bid||sessionNow()?.id!==s.id)return;
    if(repository.hasExternalChange()){pending=null;readerError='另一标签页有新进展。当前回应未写入，请先处理存档冲突。';refreshReaderLive();conflictPanel();return;}
    const nearBottom=innerHeight+scrollY>=document.documentElement.scrollHeight-180;
    // Input typed during generation belongs to the next action and is preserved.
    const fieldNow=$('#action-input');if(fieldNow)b.draft=fieldNow.value;
    if(proposal.authoritativeBranch){installConfirmed(s,proposal.authoritativeBranch,proposal.world);if(b.draft===body.input)b.draft='';branchClient.journal(null);}else commitTurn(s,w,body.input,proposal,bid);interaction.clear(body.selection);if(actionId==='continue')interaction.hide();pending=null;retryRequest=null;
    const used=JSON.stringify(body.references?.map(({sourceText,...r})=>r)||[]);if(JSON.stringify(ensurePersonal(b).draftReferences)===used)experience.clearReferences();
    if(b.turns.length===1)record('first_valid_turn');if(b.turns.length===3)record('third_valid_turn');save();refreshReaderLive();
    requestAnimationFrame(()=>{if(nearBottom&&db.settings.readingMode!=='paged'&&!window.getSelection()?.toString())$('#reader-bottom')?.scrollIntoView({block:'end',behavior:db.settings.reducedMotion?'instant':'smooth'});else $('#new-content')?.classList.remove('hidden');});
  }catch(e){if(pending?.requestId!==requestId)return;pending=null;if(e.name==='AbortError')readerNotice='已取消。输入草稿和旧故事已保留。';else{readerError=e.message;record('generation_failed');}refreshReaderLive();}
}
function conflictPanel(){openDialog('另一标签页有新进展', '<p>当前页面的故事和草稿仍保留在内存里。先导出这份资料，再选择如何接续。不会用旧页面覆盖另一个标签页。</p><div class="stack">'+button('导出当前页面备份','conflict-export')+button('比较两个版本','conflict-compare')+button('保留为副本并接续最新存档','conflict-merge')+button('放弃本页未保存内容，载入最新','conflict-reload')+'</div>');}
function infoPanel(){const s=sessionNow(),w=sessionWorld(s),st=currentState(s);openDialog('人物与见闻',`<div class="eyebrow">只展示你已经知道的事情</div><section style="margin-top:24px"><h3 class="serif">此刻</h3><p class="small muted">${esc(st.location)} · ${esc(st.time)}</p></section><h3 class="serif" style="margin:24px 0 18px">人物</h3>${w.characters.length?w.characters.map(c=>`<article class="info-person"><h3>${esc(c.name)} <span class="small muted">${esc(c.role)}</span></h3><p>${esc(c.public)}</p><p class="relation">${esc(st.relations[c.id]||'尚待相识')}</p></article>`).join(''):'<p class="small muted">这个世界尚未设定人物。</p>'}<h3 class="serif" style="margin-top:24px">已知事实</h3>${st.facts.length?`<ul class="fact-list">${st.facts.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>`:'<p class="small muted">故事刚刚开始，还没有确认的新事实。</p>'}${st.inventory.length?`<h3 class="serif" style="margin-top:24px">随身之物</h3><ul class="fact-list">${st.inventory.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}<h3 class="serif" style="margin-top:24px">重要事件</h3><ul class="fact-list">${getBranch(s).turns.flatMap((t,i)=>t.events.filter(e=>e.visibility==='player'&&e.type!=='flag').map(e=>`<li><span class="small muted">片刻 ${i+1}</span> · ${esc(e.value)}</li>`)).slice(-10).join('')||'<li>尚未留下事件。</li>'}</ul>`);}
function branchesPanel(){const s=sessionNow();openDialog('故事的不同可能',`<p class="small muted">每条分支拥有独立的事实与关系。切换会恢复该分支最后一个已完成的片刻。</p>${s.branches.map(b=>`<div class="branch-row"><div class="row between"><h3>${esc(b.name)} ${b.id===s.activeBranch?'<span class="tag pill">当前</span>':''}</h3>${b.id!==s.activeBranch?button('切换','switch-branch','compact',`data-id="${b.id}"`):''}${button(b.archived?'恢复分支':'封存分支','archive-branch','compact',`data-id="${b.id}"`)}</div><p>${b.turns.length} 个片刻 · 世界 V${b.worldKey.split('@').at(-1)}${b.parentBranch?' · 从另一条分支生长':''}</p></div>`).join('')}<h3 class="serif" style="margin-top:25px">命名存档</h3>${s.saves.map(save=>`<div class="branch-row"><div class="row between"><span>${esc(save.name)}</span>${button('从此刻继续','restore-save','compact',`data-id="${save.id}"`)}</div><p>${date(save.createdAt)} · 恢复时新建分支，保留当前进度</p></div>`).join('')||'<p class="small muted">还没有命名存档。阅读时可点「保存此刻」。</p>'}`);}
function toolsPanel(){const s=sessionNow(),empty=!getBranch(s).turns.length;openDialog('故事选项','<div class="tool-grid">'+button('看情况','situation')+button('经历与搜索','history')+button('书签与私人笔记','notes')+button('推进时间','time-control')+button('阅读与本局偏好','reader-settings')+button('帮助与反馈','help')+button('先问问 AI','ask-assistant')+button('读下一段','continue')+button('复用上次表达（放入草稿）','reuse-input')+button('撤销复用，恢复原草稿','undo-reuse')+button('今天先到这里','finish-experience')+'</div><details class="tool-group"><summary>调整这一段</summary><div class="stack">'+button('指出错误','repair-turn','',empty?'disabled':'')+button('换种写法','polish-turn','',empty?'disabled':'')+button('撤销最近一次润色','undo-polish','',getBranch(s).turns.at(-1)?.revisions?.length?'':'disabled')+button('让这段故事合理收束','finish-story','',s.mode==='demo'?'disabled':'')+button('重新生成','regenerate','',empty?'disabled':'')+button('叙述偏好','narration')+button(focusMode?'退出专注阅读':'专注阅读','focus')+'</div></details><details class="tool-group"><summary>分支、设定与导出</summary><div class="stack">'+button('分支与存档','branches')+button('对照经历与变化','compare-experience')+button('保存此刻','named-save')+button('查看公开设定','ask-world')+button('改写世界设定','rewrite')+button('导出正文','export-story')+button('导出完整存档','export-session')+button('作者视图 · 可能剧透','author-view')+'</div></details>');}

function narrationPanel(){const s=sessionNow();openDialog('调整后续叙述',`<form><p class="small muted">只影响接下来的模型生成；预设演示正文固定。不会推进时间或重写历史。</p><div class="field-grid">${select('视角','perspective',['第二人称','第一人称','第三人称'],s.preferences.perspective)}${select('篇幅','length',['简短','适中','舒展'],s.preferences.length)}${select('节奏','pace',['从容','适中','紧凑'],s.preferences.pace)}${input('文风','style',s.preferences.style,'maxlength="200"')}</div><div class="dialog-footer"><button class="btn primary" type="submit">应用到后续</button></div></form>`,data=>{s.preferences={...s.preferences,...Object.fromEntries(data)};save();dialog.close();toast('叙述偏好已更新，故事时间没有前进。');});}
function rewritePanel(){const s=sessionNow(),w=sessionWorld(s),latest=latestWorld(w.id);openDialog('作者改写',`<form><div class="notice">改写只在新分支上生效。原分支、原世界版本和已经发生的历史全部保留。新规则约束后续生成，不自动改变人物意志或抹除旧事件。</div>${latest.version>w.version?`<div style="margin:20px 0">${button('通过新分支应用 V'+latest.version+' 世界','apply-version','',`data-version="${latest.version}"`)}<p class="small muted">将保留当前状态，使用该版本的规则与人物资料继续，已经发生的开场保持原文。</p></div>`:''}<div class="stack" style="margin-top:20px">${input('新分支名称','name','作者改写','required maxlength="100"')}${area('修改基本规则 · 每行一条','rules',w.rules.join('\n'),'required maxlength="8000"')}</div><div class="dialog-footer"><button class="btn primary" type="submit">确认并建立新分支</button></div></form>`,async data=>{if(s.privateLedger){try{await editConfirmed('rewrite',{rules:String(data.get('rules')).split('\n').filter(x=>x.trim()),name:String(data.get('name'))});dialog.close();toast('新规则已在独立分支生效，原历史保留。');}catch(e){toast(e.message);}return;}cancelRequest();const nw={...clone(w),demoCompatible:false,version:latestWorld(w.id).version+1,rules:String(data.get('rules')).split('\n').filter(x=>x.trim())};db.worlds.push(nw);forkBranch(s,getBranch(s).turns.at(-1)?.id||null,String(data.get('name')),nw);record('branch_created');save();dialog.close();render();toast('改写已应用到新分支，原故事仍可恢复。');});}
function exportSession(s){const keys=new Set(s.branches.map(b=>b.worldKey));download(s.title+'-完整存档.json',JSON.stringify({schemaVersion:1,worlds:db.worlds.filter(w=>keys.has(worldKey(w))),sessions:[s]},null,2),'application/json');}
function importDialog(recover=false){openDialog('导入完整存档',`<p class="small muted">支持方糖 schemaVersion 1 的 JSON 文件，最大 10 MB。先检查版本、字段、回合链与引用；导入会增加故事，不覆盖现有故事。完整备份内的阅读偏好和创作草稿会一并恢复。</p><label class="field">选择 JSON 存档<input type="file" id="import-file" accept=".json,application/json"></label><p id="import-result" class="small" role="alert" style="margin-top:16px"></p>`);$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('文件超过 10 MB 限制，请选择较小的存档。');const incoming=validateArchive(JSON.parse(await file.text()));const next=mergeArchive(db,incoming);if(recover)repository.recover(next);else repository.save(next);db=next;editor=null;editorDirty=false;loadError='';saveError='';dialog.close();toast(`已导入 ${incoming.sessions.length} 段故事，原有数据保留。`);navigate('/stories');render();}catch(error){$('#import-result').textContent='导入未完成：'+(error instanceof SyntaxError?'这不是有效的 JSON 文件。':error.message)+' 原有数据未改变。';}};}

function refreshModelUI(){
  const path=currentRoute().path;
  if(path==='create'||path==='edit'){
    const generate=$('[data-action=generate-world]');
    if(generate)generate.disabled=!modelConfig.available||assistantJob?.kind==='world';
    const note=$('#creation-model-status');
    if(note)note.textContent=modelConfig.available?'由真实模型生成草案，审阅后再采用。你的输入和已有资料不会被自动覆盖。':'模型暂不可用，可以手动填写并保存。原始设想仍会自动保留。';
  }else if(path==='world'){
    const mode=$('#start-form select[name=mode]'),real=mode?.querySelector('[value=real]');
    if(real){real.disabled=!modelConfig.available;real.textContent=modelConfig.available?'自由游玩 · '+modelConfig.provider:'自由游玩 · 需要模型';if(modelConfig.available&&!mode.dataset.touched)mode.value='real';}
  }else if(path===''||path==='settings')render(true);
}

function cancelAssist(){if(assistantJob){assistantJob.controller.abort();assistantJob=null;}}
function recapPanel(){
  const s=sessionNow(),r=publicRecap(s,sessionWorld(s));
  openDialog('回到这一刻',`<p class="small muted">故事停在你离开的位置。现实中经过的时间不会让角色失约或损失财物。</p><span class="eyebrow">${esc(r.location)} · ${esc(r.time)}</span>${s.conclusion?.note?`<p style="margin-top:14px">你留给下次的话：${esc(s.conclusion.note)}</p>`:''}<h3 class="serif" style="margin-top:18px">上次发生的事</h3><p style="margin-top:12px">${esc(r.summary||'第一幕已经展开。')}</p>${r.facts.length?`<h3 class="serif">仍然算数的经历</h3><ul class="fact-list">${r.facts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${Object.entries(r.relations).some(([,value])=>value!=='尚待相识')?`<h3 class="serif">人物与你的关系</h3><ul class="fact-list">${Object.entries(r.relations).filter(([,value])=>value!=='尚待相识').map(([id,value])=>`<li>${esc(sessionWorld(s).characters.find(c=>c.id===id)?.name||id)} · ${esc(value)}</li>`).join('')}</ul>`:''}${r.threads.length?`<h3 class="serif">仍有关联的人与事</h3><ul class="fact-list">${r.threads.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${r.draft?`<h3 class="serif">你还没发送的想法</h3><p class="player-action">${esc(r.draft)}</p>`:''}<div class="dialog-footer">${button('继续这段经历','close-dialog','primary')}</div>`);
}
function assistanceForm(kind){
  const s=sessionNow(),hasTurn=!!getBranch(s).turns.length;
  if(['polish','repair'].includes(kind)&&!hasTurn){toast('先经历一个片刻，再调整它。');return;}
  if(pending||assistantJob){toast('请先等待当前生成完成，或取消。');return;}
  const labels={ask:['先问问，不执行','比如：如果我告诉她，会有什么风险？'],phrase:['帮我表达，不替我决定','比如：礼貌拒绝，但不要撒谎，也不要答应别的事。'],polish:['内容不变，换种写法','比如：少一点解释，让对话更自然。'],repair:['指出这一轮的错误','说明哪句写错了、与哪条已知事实冲突。没有证据时不会编造理由。']};
  const [title,placeholder]=labels[kind];
  openDialog(title,`<form><p class="small muted">${kind==='repair'?'先检查原有记录并给出提案。你确认后才建立修复分支，原线完整保留。':kind==='polish'?'只处理最后一轮正文，不改变事件、物品、关系或时间。采用前请核对事实。':'结果只在这里显示，不推进剧情，也不会自动把话说给人物。'}</p>${area('你的要求','request','',`required maxlength="${kind==='repair'?2000:8000}" placeholder="${placeholder}"`)}<div class="dialog-footer"><button type="submit" class="btn primary">${kind==='repair'?'检查并提出修复':'生成供我查看'}</button></div></form>`,data=>requestAssistance(kind,String(data.get('request'))));
}
function handleExperienceAction(action,target,s){
  if(action==='quick-world'){collectEditor();quickStart(editor.seed);return true;}
  if(action==='generate-world'){collectEditor();requestAssistance('world',editor.seed);return true;}
  if(action==='cancel-assist'){cancelAssist();if(dialog.open)dialog.close();render(true);toast('已取消，原资料和输入保留。');return true;}
  if(action==='manual-world'){$('#world-details').open=true;$('#world-details').scrollIntoView({block:'start'});return true;}
  if(action==='recap'){recapPanel();return true;}
  if(action==='repair-turn'){assistanceForm('repair');return true;}
  if(action==='polish-turn'){assistanceForm('polish');return true;}
  if(action==='ask-assistant'){assistanceForm('ask');return true;}
  if(action==='finish-experience'){
    openDialog('今天先到这里',`<p>不必把每件事都做完。你可以满意地收起这一段，也可以只停一会儿。</p><form><label class="field">此刻的感受<select name="outcome"><option value="satisfied">这段经历已经让我满足</option><option value="pause">先停一下，下次再继续</option><option value="problem">遇到问题，暂时不想继续</option></select></label>${area('留给下次的一句话（可不填）','note','','maxlength="500"')}<div class="dialog-footer"><button class="btn primary" type="submit">保存并回到我的故事</button></div></form>`,data=>{cancelRequest();cancelAssist();s.conclusion={outcome:String(data.get('outcome')),note:String(data.get('note')),createdAt:Date.now()};if(s.conclusion.outcome==='satisfied')s.archived=true;record('experience_'+s.conclusion.outcome);if(save()){dialog.close();navigate('/stories');}});return true;
  }
  return false;
}
async function requestAssistance(kind,inputText){
  if(!inputText?.trim()){toast('先写下你的设想或要求。');return;}
  if(kind==='repair'&&inputText.length>2000){toast('请把纠错理由缩短到 2000 字以内，原输入已保留。');return;}
  if(!modelConfig.available){toast('这项帮助需要真实模型。草稿已保留，请在设置中检查连接。');return;}
  if(pending||assistantJob){toast('已有生成正在进行，请等待或取消。');return;}
  const route=location.hash,s=kind==='world'?null:sessionNow(),b=s?getBranch(s):null;
  if(kind!=='world'&&!s)return;
  const last=b?.turns.at(-1),originalProse=last?.prose,version=s?currentState(s).version:null;
  if(['repair','polish'].includes(kind)&&!last){toast('还没有可调整的回应。');return;}
  if(kind==='repair'&&s.mode==='demo'){toast('预设演示使用固定脚本。真实模型故事可检查并修复剧情。');return;}
  if(kind==='world')collectEditor();
  const editorBefore=kind==='world'?JSON.stringify(editor):null;
  let selected;try{selected=kind==='world'||kind==='repair'?undefined:interaction.selection();}catch(e){toast(e.message);return;}
  const job={kind,controller:new AbortController(),route};assistantJob=job;
  const requestId=uid();
  let payload={requestId,kind,input:inputText};
  if(kind==='world'){payload.seed=inputText;render(true);}
  else {
    const base=kind==='repair'?(b.turns.at(-2)?.state||b.initialState):currentState(s);
    const history=kind==='repair'?{...b,turns:b.turns.slice(0,-1)}:b;
    payload={...payload,world:sessionWorld(s),state:clone(base),player:s.player,preferences:s.preferences,branchId:b.id,...(selected?{selection:selected}:{}),...selectContext(history,inputText),...(last?{target:{id:last.id,input:last.input,prose:last.prose,events:last.events,suggestions:last.suggestions,ended:last.ended}}:{})};
    openDialog('正在整理这次回应',`<p role="status">${kind==='repair'?'正在对照已有记录检查错误':'正在生成供你审阅的内容'}，故事尚未改变。</p><div class="dialog-footer">${button('取消并保留原内容','cancel-assist')}</div>`);
  }
  try {
    const response=await fetch('/api/assist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:job.controller.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'暂时无法生成，请稍后再试。');
    if(assistantJob!==job||job.controller.signal.aborted||location.hash!==route)return;
    assistantJob=null;
    if(kind==='world'){
      collectEditor();if(JSON.stringify(editor)!==editorBefore){render(true);toast('你在生成期间修改了设想。保留了新草稿，请按新设想重新生成。');return;}
      render(true);const w=result.world;validateWorld(w);
      openDialog('这是为你准备的第一幕',`<p class="small muted">真实模型草案 · 还没有覆盖你的资料或开始故事。</p><h2>${esc(w.title)}</h2><p style="margin-top:12px">你将扮演：${esc(w.identity)}</p><div class="prose">${paragraphs(w.opening)}</div><details><summary>核对规则与人物</summary><ul class="fact-list">${w.rules.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${w.characters.map(c=>`<p>${esc(c.name)} · ${esc(c.public)}</p>`).join('')}</details><div class="dialog-footer">${button('保留原草稿','close-dialog')}${button('采用草案并编辑','adopt-world','primary')}</div>`);
      dialog.querySelector('[data-action=adopt-world]').onclick=()=>{collectEditor();if(JSON.stringify(editor)!==editorBefore){toast('草稿已改变，请重新生成。');return;}const prior=editor;editor={...clone(w),id:prior.id,editId:prior.editId,originalVersion:prior.originalVersion,seed:prior.seed,custom:prior.custom,version:prior.version};db.worldDraft=clone(editor);editorDirty=true;save();dialog.close();render();record('world_draft_generated');};
      return;
    }
    const stillCurrent=()=>sessionNow()?.id===s.id&&s.activeBranch===b.id&&currentState(s).version===version&&(!last||(getBranch(s).turns.at(-1)?.id===last.id&&getBranch(s).turns.at(-1)?.prose===originalProse));
    if(!stillCurrent())return;
    const title={ask:'先了解，再决定',phrase:'这是可以修改的表达',polish:'同一件事，另一种写法',repair:'检查结果与修复提案'}[kind];
    const hasProposal=kind==='repair'&&result.proposal;
    openDialog(title,`<p class="small muted">${kind==='ask'?'这是对可能性的说明，事情尚未发生；人物的实际回应仍可能不同。':kind==='phrase'?'这段话还没有对人物说出。采用后也需要你亲自发送。':kind==='polish'?'采用后仅替换最后一轮表达。请核对没有新增事实、承诺或秘密。':'不会用新的幕后理由替错误辩护。原线保留，只有确认的修复会应用。'}</p><div class="prose">${paragraphs(result.text)}</div>${hasProposal?`<h3 class="serif">修复后的正文</h3><div class="prose" style="margin-top:12px">${paragraphs(result.proposal.prose)}</div><details><summary>将提交的变更（作者审阅）</summary><ul class="fact-list">${result.proposal.events.map(e=>`<li>${esc(e.type)} · ${esc(e.value)}${e.visibility==='hidden'?'（幕后）':''}</li>`).join('')||'<li>不新增状态变更</li>'}</ul></details>`:''}<div class="dialog-footer">${button('关闭，保持原样','close-dialog')}${kind==='phrase'?button('放入输入框，暂不发送','adopt-assist','primary'):kind==='polish'?button('确认只改表达','adopt-assist','primary'):hasProposal?button('确认并建立修复分支','adopt-assist','primary'):kind==='ask'?button('把原问题改作实际行动','adopt-assist'):''}</div>`);
    record(kind+'_reviewed');
    const adopt=dialog.querySelector('[data-action=adopt-assist]');
    if(adopt)adopt.onclick=async()=>{
      if(!stillCurrent()){toast('故事已经改变，请重新生成。');dialog.close();return;}
      try {
        if(kind==='phrase'||kind==='ask'){b.draft=kind==='phrase'?result.text:inputText;intentMode='auto';}
        if(kind==='polish'){if(s.mode==='real')await editConfirmed('polish',{text:result.text});else applyPolish(s,last.id,result.text,version);}
        if(hasProposal){if(s.mode==='real')await editConfirmed('repair',{proposal:result.proposal,reason:inputText});else applyRepair(s,sessionWorld(s),result.proposal,inputText,b.id,version);}
        record(kind+'_applied');save();dialog.close();render(true);if(kind==='phrase'||kind==='ask')$('#action-input')?.focus();
      }catch(error){toast(error.message);}
    };
  } catch(error){
    if(assistantJob!==job||job.controller.signal.aborted)return;
    assistantJob=null;if(kind==='world')render(true);
    else openDialog('没有改变你的故事',`<p role="alert">${esc(error.message)}</p><p class="small muted">原有内容保持不变。你的要求：</p><p>${esc(inputText)}</p><div class="dialog-footer">${button('关闭','close-dialog')}</div>`);
    toast(error.message);record(kind+'_failed');
  }
}

function centerMaps(root=document){
  for(const view of root?.querySelectorAll('.game-map-viewport')||[]){
    const current=view.querySelector('[aria-current="location"]');
    if(current&&view.clientWidth&&!view.dataset.centered){
      const here=current.getBoundingClientRect(),frame=view.getBoundingClientRect();
      view.scrollLeft=Math.max(0,view.scrollLeft+here.left-frame.left+(here.width-view.clientWidth)/2);
      view.dataset.centered="true";
    }
  }
}
document.addEventListener('toggle',e=>{if(e.target.matches?.('details')&&e.target.open)requestAnimationFrame(()=>centerMaps(e.target));},true);
function showGameRecall(kind='all'){
  const s=sessionNow();if(!s)return;
  const b=getBranch(s);gameRecall={sid:s.id,bid:b.id,kind};
  if(db.settings.readingMode==='paged')readingPage=b.turns.length;
  refreshReaderLive();
  requestAnimationFrame(()=>{centerMaps($('#game-recall'));$('#game-recall')?.scrollIntoView({block:'start',behavior:'instant'});});
}

document.addEventListener('click',e=>{if(e.target.closest('.skip-link')){e.preventDefault();const main=$('#main');main?.setAttribute('tabindex','-1');main?.focus();main?.scrollIntoView();return;}const target=e.target.closest('[data-action]');if(!target||target.disabled)return;const action=target.dataset.action,s=sessionNow();
  if(interaction.handle(action,target))return;
  if(action==='recover-story'){recoverStory();return;}
  if(action==='undo-polish'&&s?.mode==='real'){editConfirmed('undo-polish').then(()=>{dialog.close();toast('已恢复上一版表达，事实没有改变。');}).catch(e=>toast(e.message));return;}
  if(action==='game-recall'){showGameRecall(target.dataset.kind||'all');return;}
  if(action==='game-dismiss-recall'){gameRecall=null;refreshReaderLive();return;}
  if(action==='game-map-expand'){
    if(!s)return;const b=getBranch(s),node=target.dataset.node,turn=node?b.turns.find(t=>t.id===node):b.turns.at(-1);
    if(node&&!turn){toast('这份地图不属于当前分支。');return;}
    const projection=gameRecallState(turn?.state||b.initialState,publicSituation(b,sessionWorld(s),node||undefined));
    openDialog('已知地图',gameRecallView(projection,{kind:'map',node}));dialog.classList.add('map-expanded');centerMaps(dialog);return;
  }
  if(action==='game-inspect'){
    if(!s)return;const b=getBranch(s),node=target.dataset.node;
    const turn=node?b.turns.find(t=>t.id===node):b.turns.at(-1);
    if(node&&!turn){toast('这份记录不属于当前分支。');return;}
    const snapshot=turn?.state||b.initialState;
    const projection=gameRecallState(snapshot,publicSituation(b,sessionWorld(s),node||undefined));
    const entity=projection.game?.entities.find(x=>x.id===target.dataset.entity);
    if(!entity){toast('这份资料尚未公开。');return;}
    openDialog(entity.name,gameInspectView(entity,projection.game,{node}));return;
  }
  if(action==='game-act'){
    if(!s||pending||assistantJob)return;
    const b=getBranch(s),ref={branchId:target.dataset.branch,version:Number(target.dataset.version),surfaceId:target.dataset.surface,actionId:target.dataset.actionId};
    try{const receipt=resolveGameAction(currentState(s),ref,{branchId:b.id});sendTurn('game-action',{input:receipt.input,gameAction:ref});}
    catch(error){toast(error.message);refreshReaderLive();}return;
  }
  if(action==='reader-example'){const b=getBranch(s);if(!b.draft)b.draft='我想先听听他们怎么说。';else toast('已有草稿为你保留；示例：我想先听听他们怎么说。');db.settings.readerGuideDismissed=true;save();render(true);$('#action-input')?.focus();return;}
  if(action==='dismiss-reader-guide'){db.settings.readerGuideDismissed=true;save();render(true);return;}
  if(action==='surprise-world'){const choices=[...document.querySelectorAll('.discovery-card h3 a')];if(choices.length)location.hash=choices[Math.floor(Math.random()*choices.length)].hash;else toast('暂无匹配开局，可以更改筛选。');return;}
  if(action==='shuffle-worlds'){discoveryOrder++;render(true);return;}
  if(action==='archive-branch'){const b=s.branches.find(b=>b.id===target.dataset.id);if(b){b.archived=!b.archived;save();branchesPanel();}return;}
  if(action==='favorite-world'){const set=new Set(db.settings.favoriteWorlds||[]);set.has(target.dataset.id)?set.delete(target.dataset.id):set.add(target.dataset.id);db.settings.favoriteWorlds=[...set];save();render(true);return;}
  if(action==='reset-library'){libraryOptions={query:'',category:'active',group:'',sort:'updated'};render(true);return;}
  if(action==='clear-discovery'||action==='reset-discovery'){discoveryOptions={query:'',tag:'',onlyFavorites:false};render(true);return;}
  if(action==='reading-prev'||action==='reading-next'){readingPage=Number(target.dataset.page);render();$('#main')?.scrollIntoView();return;}
  if(action==='exclude-world'||action==='restore-excluded'){const set=new Set(db.settings.excludedWorlds||[]);action==='exclude-world'?set.add(target.dataset.id):set.delete(target.dataset.id);db.settings.excludedWorlds=[...set];save();render(true);return;}
  if(['batch-archive','batch-trash','batch-restore'].includes(action)){const ids=[...document.querySelectorAll('input[name=select-story]:checked')].map(el=>el.value);if(!ids.length){toast('先选择要整理的故事。');return;}confirmAction('批量整理 '+ids.length+' 段故事','所有分支保留，回收箱中的故事可以恢复。',()=>{db.sessions=db.sessions.map(x=>!ids.includes(x.id)?x:action==='batch-trash'?trashStory(x):action==='batch-restore'?updateStoryMetadata(restoreStory(x),{archived:false}):updateStoryMetadata(x,{archived:true}));save();render(true);},'应用');return;}
  if(action==='reuse-input'){recentDraft=getBranch(s).draft;getBranch(s).draft=getBranch(s).turns.at(-1)?.input||'';save();render(true);$('#action-input')?.focus();return;}
  if(action==='undo-reuse'){getBranch(s).draft=recentDraft;save();render(true);return;}
  if(action==='import-world-text'){worldImportPanel();return;}
  if(action==='retry-generation'){sendTurn('retry');return;}
  if(action==='storage-conflict'){conflictPanel();return;}
  if(action==='conflict-export'){download('方糖-当前页面备份.json',JSON.stringify(db,null,2),'application/json');return;}
  if(action==='conflict-compare'){try{const other=repository.readExternal(PRESET_WORLDS);openDialog('比较本机存档', '<p>每份均包含独立故事、分支和草稿。只读比较不覆盖数据。</p><h3>当前页面</h3><p>'+db.sessions.length+' 段故事</p><ul>'+db.sessions.map(x=>'<li>'+esc(x.title)+' · '+getBranch(x).turns.length+' 回合 · 草稿 '+(getBranch(x).draft||'').length+' 字</li>').join('')+'</ul><h3>另一标签页已保存</h3><p>'+other.sessions.length+' 段故事</p><ul>'+other.sessions.map(x=>'<li>'+esc(x.title)+' · '+getBranch(x).turns.length+' 回合 · 草稿 '+(getBranch(x).draft||'').length+' 字</li>').join('')+'</ul>'+button('返回处理','storage-conflict'));}catch(e){toast(e.message);}return;}
  if(action==='conflict-merge'){try{cancelRequest();const current=clone(db);db=repository.mergeExternal(external=>mergeArchive(external,current));saveError='';dialog.close();navigate('/stories');render();toast('两份故事均已保留；重名的本页故事存为独立副本。');}catch(e){toast(e.message);}return;}
  if(action==='conflict-reload'){confirmAction('放弃本页未保存内容','仅保留另一标签页已成功保存的资料。尚未导出的本页草稿将丢失。',()=>{try{cancelRequest();db=repository.acceptExternal(PRESET_WORLDS);saveError='';render();}catch(e){toast(e.message);}},'载入最新');return;}
  if(experience.handle(action,target))return;
  if(handleExperienceAction(action,target,s))return;
  if(action==='close-dialog'){cancelAssist();dialog.close();return;}
  if(action==='confirm')return;
  if(action==='suggest'){let actions=s.mode==='demo'?demoActions(sessionWorld(s),currentState(s)):getBranch(s).turns.at(-1)?.suggestions||[];const choice=actions.find(a=>a.id===target.dataset.id);if(choice){const field=$('#action-input');field.value=choice.text;field.dispatchEvent(new Event('input'));field.focus();}return;}
  if(action==='continue'){dialog.close();sendTurn('continue');return;}
  if(action==='cancel-generation'){cancelAssist();cancelRequest(true);refreshReaderLive();return;}
  if(action==='new-content'){if(db.settings.readingMode==='paged'){readingPage=getBranch(s).turns.length;render();}$('#reader-bottom').scrollIntoView({block:'end'});target.classList.add('hidden');return;}
  if(action==='info'){infoPanel();return;}
  if(action==='story-tools'){toolsPanel();return;}
  if(action==='branches'){branchesPanel();return;}
  if(action==='narration'){narrationPanel();return;}
  if(action==='focus'){focusMode=!focusMode;if(dialog.open)dialog.close();render(true);return;}
  if(action==='fork'){confirmAction('从这个片刻，另写一段','新分支只保留这个节点及以前的故事、物品与关系。当前分支完整保留。',()=>{cancelRequest();forkBranch(s,target.dataset.node||null,'另一种可能 '+s.branches.length);record('branch_created');readerError='';readerNotice='';save();render();scrollTo(0,0);},'建立分支');return;}
  if(action==='switch-branch'){cancelRequest();s.activeBranch=target.dataset.id;readerError='';readerNotice='';save();dialog.close();render();requestAnimationFrame(()=>scrollTo(0,getBranch(s).readingPosition||0));return;}
  if(action==='named-save'){askName('给这个片刻一个名字',currentState(s).location,name=>{s.saves.push({id:uid(),name,branchId:s.activeBranch,turnId:getBranch(s).turns.at(-1)?.id||null,createdAt:Date.now()});if(save())toast('这个片刻已保存在此设备。');});return;}
  if(action==='restore-save'){const mark=s.saves.find(x=>x.id===target.dataset.id);confirmAction('从命名存档继续','将从保存节点建立新分支；此节点以后的事实不会带入。',()=>{cancelRequest();s.activeBranch=mark.branchId;forkBranch(s,mark.turnId,mark.name+' · 继续');record('save_resumed');save();render();},'恢复并继续');return;}
  if(action==='regenerate'){confirmAction('重新生成最后一个回应','将从上个回应之前建立分支，旧结果与后果保留在旧分支。演示采用固定脚本，同样的行动会得到相同结果。',()=>{cancelRequest();const turns=getBranch(s).turns,last=turns.at(-1);forkBranch(s,turns.at(-2)?.id||null,'替代回应 '+s.branches.length);getBranch(s).draft=last.input;record('branch_created');save();readerError='';render();sendTurn(last.input==='让当前场景自然继续。'?'continue':undefined);},'建立分支并重生成');return;}
  if(action==='ask-world'){const w=sessionWorld(s);openDialog('询问设定 · 不推进时间',`<p class="small muted">这里整理的是当前世界的公开设定与已知事实；不从幕后秘密中提供答案。</p><h3 class="serif">这个世界如何运转？</h3><ul class="fact-list">${w.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><h3 class="serif">我是谁，正在做什么？</h3><p>${esc(s.player.name)} · ${esc(s.player.identity)}</p><p class="small muted">个人目标：${esc(s.player.goal||'尚未设定')}</p><h3 class="serif">我已经确认了什么？</h3><ul class="fact-list">${currentState(s).facts.map(f=>`<li>${esc(f)}</li>`).join('')||'<li>还没有新的已确认事实。</li>'}</ul>`);return;}
  if(action==='rewrite'){rewritePanel();return;}
  if(action==='apply-version'){const nw=latestWorld(s.worldId);if(!Object.keys(getBranch(s).initialState.characters).every(id=>nw.characters.some(c=>c.id===id))){toast('新版本移除了已有故事的人物。请保留这些人物，或从新版世界开始独立故事。');return;}confirmAction('将新版本应用到新分支','将使用新版本的世界资料继续，保留原有经历。新增人物尚待相识。此操作不会改动原分支。',()=>{cancelRequest();forkBranch(s,getBranch(s).turns.at(-1)?.id||null,'世界 V'+nw.version,nw);record('branch_created');save();render();},'创建新分支');return;}
  if(action==='author-view'){confirmAction('进入作者视图','以下资料可能揭示幕后秘密。普通人物面板不会显示这些内容。',()=>{const w=sessionWorld(s);openDialog('作者视图 · 幕后资料',w.characters.map(c=>`<section class="info-person"><h3>${esc(c.name)}</h3><p>目标：${esc(c.goal||'未设定')}</p><p>经历：${esc(c.history||'未设定')}</p><p>秘密：${esc(c.secret||'未设定')}</p></section>`).join('')||'<p>没有幕后人物资料。</p>');},'我知道，查看幕后');return;}
  if(action==='export-story'){download(s.title+'.md',exportMarkdown(s,sessionWorld(s)),'text/markdown');toast('已准备当前分支正文，不含幕后资料。');return;}
  if(action==='export-session'){confirmAction('导出完整存档','JSON 包含浏览器中的所有分支与草稿，旧故事可能含幕后资料。新开局的幕后设定只在本机服务中，此 JSON 不能单独迁移续玩；请同时保留 .data 目录与当前浏览器。分享请导出正文。',()=>exportSession(s),'导出完整 JSON');return;}
  if(action==='export-all'){confirmAction('导出此设备的完整资料','包含浏览器中的世界、草稿和故事分支；旧档可能含幕后资料。新开局还需本机 .data 目录与当前浏览器标识，JSON 不是独立完整备份。不包含模型密钥。',()=>download('方糖-完整存档.json',JSON.stringify(db,null,2),'application/json'),'导出 JSON');return;}
  if(action==='export-raw'){download('方糖-原始数据备份.json',localStorage.getItem(STORAGE_KEY)||'{}','application/json');return;}
  if(action==='import-dialog'||action==='recover-import'){importDialog(action==='recover-import');return;}
  if(action==='export-events'){download('方糖-体验事件.json',JSON.stringify(db.telemetry,null,2),'application/json');return;}
  if(action==='retry-save'){if(save())toast('已重新保存在此设备。');return;}
  if(action==='check-model'){fetch('/api/config').then(r=>r.json()).then(c=>{modelConfig=c;refreshModelUI();toast(c.available?'模型服务已配置。可新建真实模型故事进行验证。':'尚未配置模型，请编辑服务端 .env 并重启。');}).catch(()=>toast('无法连接本地服务，请确认 npm start 正在运行。'));return;}
  if(action==='clear-demo'){confirmAction('清理预设演示故事','将删除三个预设世界的演示故事及其分支。自建世界与真实模型故事不会被删除。',()=>{const presets=new Set(PRESET_WORLDS.map(w=>w.id));db.sessions=db.sessions.filter(x=>!(x.mode==='demo'&&presets.has(x.worldId)));save();render(true);toast('预设演示故事已清理。');},'删除演示故事');return;}
  if(action==='tab-active'||action==='tab-archived'){archiveTab=action==='tab-archived';render(true);return;}
  if(action==='rename-story'){const story=db.sessions.find(x=>x.id===target.dataset.id);askName('重命名故事',story.title,name=>{story.title=name||story.title;save();render(true);});return;}
  if(action==='archive-story'){const story=db.sessions.find(x=>x.id===target.dataset.id);story.archived=!story.archived;save();render(true);toast(story.archived?'已归档，可随时恢复。':'故事已恢复到进行中。');return;}
  if(action==='delete-story'){const id=target.dataset.id;confirmAction('删除这段故事','该故事及其全部分支和命名存档将从此设备移除。此操作无法撤销；需要时请先导出备份。',()=>{db.sessions=db.sessions.filter(x=>x.id!==id);save();render(true);},'删除故事');return;}
  if(action==='copy-world'){const w=clone(latestWorld(target.dataset.id));w.id='world-'+uid();w.title+=' · 副本';w.version=1;w.custom=true;db.worlds.push(w);save();navigate('/edit/'+w.id);return;}
  if(action==='add-character'){collectEditor();editor.characters.push({id:'person-'+uid(),name:'',role:'',public:'',goal:'',history:'',secret:''});db.worldDraft=clone(editor);save();render(true);return;}
  if(action==='remove-character'){collectEditor();editor.characters.splice(Number(target.dataset.index),1);db.worldDraft=clone(editor);save();render(true);return;}
  if(action==='expand-world'){collectEditor();editor.additions={title:'雨天修伞铺',description:'街角有一家只在雨天营业的修伞铺。人们带来坏掉的伞，也带来还没有说完的话。',era:'当代小城',location:'街角的修伞铺',identity:'刚接手店铺的修伞人',opening:'午后的雨落得很轻。你刚把木牌翻到“营业”，一位抱着蓝伞的客人便停在门口。\n\n“这把伞还修得好吗？”她问。伞骨已经弯了，她的手却一直没有松开。',rules:['没有超自然现象。','人物拥有独立目标，关系通过经历逐渐改变。']};db.worldDraft=clone(editor);save();render(true);return;}
  if(action==='accept-additions'){collectEditor();for(const [key,value] of Object.entries(editor.additions)){if(!editor[key]||(Array.isArray(editor[key])&&!editor[key].filter(Boolean).length))editor[key]=clone(value);}delete editor.additions;db.worldDraft=clone(editor);save();render(true);return;}
  if(action==='discard-additions'){collectEditor();delete editor.additions;db.worldDraft=clone(editor);save();render(true);return;}
  if(action==='preview-world'){collectEditor();openDialog('开场预览',`<p class="small muted">这是你编辑的开场正文，不会启动生成或推进故事。</p><h2 class="serif" style="margin:20px 0">${esc(editor.title||'未命名世界')}</h2><div class="prose">${paragraphs(editor.opening||'还没有开场文字。可以在「开局」中写下第一幕。')}</div>`);return;}
  if(action==='open-details'){e.preventDefault();$('#world-details').open=true;$('#world-details').scrollIntoView({block:'start'});return;}
});
dialog.addEventListener('cancel',()=>cancelAssist());
document.addEventListener('input',e=>{const el=e.target;if(el.name==='mode'&&el.closest('#start-form'))el.dataset.touched='true';if(el.id==='reading-page'){readingPage=Number(el.value);render();$('#main')?.scrollIntoView();return;}if(el.id==='input-intent'){intentMode=el.value;const s=sessionNow();if(s){const b=getBranch(s);Object.assign(b,setDraftContext(b,{references:ensurePersonal(b).draftReferences,intent:intentMode}));save();}refreshInputOptions();return;}if(el.id==='participation'){if(['delegate','skip'].includes(el.value)){experience.handle('time-control',el);return;}const s=sessionNow();if(s){s.preferences.participation=el.value;save();refreshInputOptions();}return;}const key=el.dataset.setting;if(!key)return;db.settings[key]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value;applySettings();const value=$('#value-'+key);if(value)value.textContent=el.value+(key==='lineHeight'?'':'px');scheduleSave();});
window.addEventListener('hashchange',()=>{clearTimeout(saveTimer);if(editorDirty){collectEditor();save();editorDirty=false;}if(dialog.open)dialog.close();cancelRequest();cancelAssist();intentMode='auto';readingPage=null;experience.reset();const {path,id}=currentRoute();if(path==='story'&&sessionNow())intentMode='auto';if(lastRoute.startsWith('story/')&&path!=='story')record('trial_exited');lastRoute=path+'/'+id;routeStarted=performance.now();readerError='';readerNotice='';if(path==='')record('home_opened');if(path==='world')record('world_opened');if(path==='story'&&sessionNow())record('save_resumed');render();if(path==='story')recoverStory(true);requestAnimationFrame(()=>{if(path==='story'&&sessionNow()&&getBranch(sessionNow()).personal?.anchor)experience.restoreAnchor();else scrollTo(0,path==='story'&&sessionNow()?getBranch(sessionNow()).readingPosition||0:0);});});
window.addEventListener('scroll',()=>{const s=sessionNow();if(currentRoute().path==='story'&&s){getBranch(s).readingPosition=scrollY;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{experience.persistAnchor();save(true);},300);}}, {passive:true});
document.addEventListener('pointerup',()=>experience.captureSelection());
document.addEventListener('keyup',e=>{if(e.key==='Shift')experience.captureSelection();if(e.key==='Enter'&&e.target.matches('[data-save][role=button]'))conflictPanel();});
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY&&repository.hasExternalChange()){saveError='另一标签页有新进展 · 点此处理';updateSaveLabels();toast('另一标签页有新进展。当前页面和草稿已保留，自动覆盖已停止。');}});
if(window.visualViewport){const resize=()=>{const style=document.documentElement.style;style.setProperty('--keyboard-offset',Math.max(0,innerHeight-visualViewport.height-visualViewport.offsetTop)+'px');style.setProperty('--visual-viewport-height',visualViewport.height+'px');style.setProperty('--visual-viewport-top',visualViewport.offsetTop+'px');};visualViewport.addEventListener('resize',resize);visualViewport.addEventListener('scroll',resize);resize();}
window.addEventListener('beforeunload',e=>{if(editorDirty)collectEditor();clearTimeout(saveTimer);const ok=save(true);if(!ok||pending||assistantJob){e.preventDefault();e.returnValue='';}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySettings);
fetch('/api/config').then(r=>r.json()).then(c=>{modelConfig=c;refreshModelUI();}).catch(()=>{});
if(currentRoute().path==='story'&&sessionNow())intentMode='auto';
render();if(!loadError){if(currentRoute().path==='story')recoverStory(true);record(currentRoute().path==='story'?'save_resumed':currentRoute().path==='world'?'world_opened':'home_opened');lastRoute=currentRoute().path+'/'+currentRoute().id;requestAnimationFrame(()=>{if(currentRoute().path==='story'&&sessionNow()){if(getBranch(sessionNow()).personal?.anchor)experience.restoreAnchor();else scrollTo(0,getBranch(sessionNow()).readingPosition||0);}});}

function refreshInputOptions(){const summary=$('.writing-options>summary'),intent=$('#input-intent'),participation=$('#participation');if(summary)summary.textContent='输入选项'+(intent?.value!=='auto'?' · '+intent.selectedOptions[0].textContent:'')+(participation?.value!=='act'?' · '+participation.selectedOptions[0].textContent:'');const submit=$('#action-form button[type=submit]');if(submit)submit.textContent=intentMode==='ask'?'提问 ↑':intentMode==='phrase'?'帮我措辞 ↑':'发送 ↑';}

function worldImportPanel(){collectEditor();openDialog('导入创作资料', '<p>支持 TXT、Markdown、文字 JSON 角色卡和世界书。先解析预览，再采用到草案；不会自动生成或执行脚本。</p><label class="field">选择资料<input type="file" id="world-material" accept=".txt,.md,.json"></label><div id="material-preview"></div>');$('#world-material').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>360000)throw new Error('文件过大，请选择 120 KB 以内的文字资料。');const result=parseWorldImport(await f.text(),f.name);$('#material-preview').innerHTML='<p>'+result.warnings.map(esc).join('<br>')+'</p><pre class="code-note">'+esc(JSON.stringify(result.fields||{seed:result.seed},null,2))+'</pre>'+button('采用到当前创作草案','adopt-material');$('#material-preview button').onclick=()=>{Object.assign(editor,result.fields||{seed:result.seed});db.worldDraft=clone(editor);editorDirty=true;save();dialog.close();render();};}catch(error){$('#material-preview').textContent=error.message;}};}
setInterval(()=>{const now=Date.now(),delta=Math.min(30000,now-lastReadTick);lastReadTick=now;if(currentRoute().path==='story'&&document.visibilityState==='visible')readingElapsed+=delta;if(currentRoute().path!=='story'||!db.settings.restReminder||restShown||readingElapsed<30*60*1000)return;restShown=true;toast('已经读了一会儿。故事为你停在这里，可以让眼睛休息一下。');},30000);
