import {focusActionInput} from './reader-comfort.js';
import {createWorldField} from './world-field.js';
import {productShell} from './product-shell.js';
import {createDynamicControls} from './dynamic-ui.js';
import {createEditorialMotion} from './elselife-motion.js';
import {createInterfaceMotion} from './interface-motion.js';
import {createControlMotion} from './control-motion.js';
import {createUniverseMotion} from './universe-motion.js';
import {richInteractionRequest,appendInteractionDraft} from './rich-request.js';
import {bindRichControls} from './rich-interaction-controls.js';
import {createDialogNavigation} from './dialog-navigation.js';
import {settingsView,modelStatus,selectSettingsSection} from './settings-ui.js';
import {icon,saveStatusView,readerDossierNav} from './ui-controls.js';
import {readerRecallView,pendingRecord,demoReadOnly} from './reading-ui.js';
import {createReadingProgress} from './reading-progress.js';
import {focusPageContent,hasPageContentFocus} from './reader-navigation.js';
import {refreshStartOptions} from './start-options.js';
import {readerInputCommand} from './reader-input.js';
import {readerSnapshot} from './reader-snapshot.js';
import {BranchClient,mergeConfirmedBranch,mergeConfirmedBranches} from './branch-client.js';
import {ArtifactClient} from './artifact-client.js';
import {createInteractionControls} from './interaction-controls.js';
import {localCommand} from './local-commands.js';
import {resolveGameAction,gameActionForInput} from './game-state.js';
import {gameRecallView,gameInspectView} from './game-ui.js';
import {gameQuery,gameRecallState} from './game-query.js';
import {publicSituation} from './experience-state.js';
import {parseWorldImport} from './world-import.js';
import {createExperienceControls} from './experience-controls.js';
import {createTravelControls} from './travel-controls.js';
import {validateReference,ensurePersonal,setDraftContext,trashStory,restoreStory,updateStoryMetadata} from './personal-library.js';
import {discoveryView,libraryView} from './library-ui.js';
import {narrativeForBranch} from './narrative-state.js';
import {PRESET_WORLDS} from './worlds.js';
import {ADDITIONAL_WORLDS,getExperience} from './situations.js';
import {publicRecap,selectContext,detectIntent,applyPolish,applyRepair} from './experience.js';
import {homeView,detailView,creatorView,intentControls,startAvailability} from './experience-views.js';
import {demoActions} from './demo.js';
import {mergeArchive} from './data-transfer.js';
import {parseRoute,shouldSend} from './ui-behavior.js';
import {uid,clone,worldKey,createSession,getBranch,currentState,commitTurn,forkBranch,validateArchive,validateWorld,exportMarkdown} from './core.js';
import {LocalRepository,defaultSettings,STORAGE_KEY} from './storage.js';
import {DemoProvider,RealProvider} from './providers.js';

const $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog');
const editorialMotion=createEditorialMotion({root:app,enabled:()=>currentRoute().path===''});
const worldField=createWorldField({root:app,enabled:()=>currentRoute().path===''});
const interfaceMotion=createInterfaceMotion({root:app,enabled:()=>currentRoute().path===''});
const controlMotion=createControlMotion({root:document,enabled:()=>currentRoute().path===''});
const universeMotion=createUniverseMotion({root:app});
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
const artifactClient=new ArtifactClient(branchClient);
let recovering=false,recoveryJob=null,quickError='',lastSubmission=null;
let assistantJob=null,intentMode='auto',gameRecall=null;
let db,loadError='',saveError='',pending=null,readerError='',readerNotice='',focusMode=false,archiveTab=false,editor=null,editorDirty=false,saveTimer,toastTimer,routeStarted=performance.now(),lastRoute='',modelConfig={available:false},modelChecked=false;
const generativeUIEnabled=()=>modelConfig.generativeUIEnabled===true;
let discoveryOrder=0,readingPage=null,readingSince=Date.now(),restShown=false,lastReadTick=Date.now(),readingElapsed=0,recentDraft=null,retryRequest=null,discoveryOptions={query:'',tag:'',excludeTag:'',onlyFavorites:false},libraryOptions={query:'',category:'active',group:'',sort:'updated'};
const anonymousId=uid();
try{db=repository.load(PRESET_WORLDS);}catch(e){loadError=e.message;db={schemaVersion:1,worlds:clone(PRESET_WORLDS),sessions:[],settings:{...defaultSettings},telemetry:[]};}
if(!loadError){for(const w of ADDITIONAL_WORLDS)if(!db.worlds.some(existing=>existing.id===w.id))db.worlds.push(clone(w));}
function normalizeSettings(){const s=db.settings; for(const key of ['fontSize','lineHeight','width']){const ranges={fontSize:[16,30],lineHeight:[1.5,2.5],width:[480,880]},[min,max]=ranges[key];s[key]=Math.max(min,Math.min(max,Number(s[key])||defaultSettings[key]));}if(!['light','dark','system'].includes(s.theme))s.theme='light';}
function applySettings(){normalizeSettings();const s=db.settings;document.body.dataset.theme=s.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s.theme;document.body.classList.toggle('reduce-motion',!!s.reducedMotion);document.documentElement.style.setProperty('--read-size',s.fontSize+'px');document.documentElement.style.setProperty('--read-leading',s.lineHeight);document.documentElement.style.setProperty('--read-width',s.width+'px');document.body.dataset.readingFont=s.fontFamily||'serif';document.body.dataset.paragraphGap=s.paragraphGap||'normal';document.documentElement.style.setProperty('--reading-paragraph-gap',({compact:'.65em',normal:'1.15em',wide:'1.7em'})[s.paragraphGap]||'1.15em');}
function save(silent=false){if(loadError)return false;try{repository.save(db);saveError='';updateSaveLabels();return true;}catch(e){saveError=e.message;if(e.code==='STORAGE_CONFLICT')readerNotice='另一标签页有新进展，请从保存提示处理冲突。';updateSaveLabels();if(!silent)toast(saveError);return false;}}
function scheduleSave(){document.querySelectorAll('[data-save]').forEach(el=>{el.innerHTML=saveStatusView('正在保存…');el.title='正在保存…';});clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),220);}
function updateSaveLabels(){let warning=$('#save-warning');if(saveError&&currentRoute().path!=='story'){if(!warning){warning=document.createElement('div');warning.id='save-warning';warning.className='notice error save-warning';warning.setAttribute('role','alert');app.prepend(warning);}warning.innerHTML='更改尚未保存。 '+button('处理保存问题','storage-conflict','compact');}else warning?.remove();document.querySelectorAll('[data-save]').forEach(el=>{const status=saveError?'保存失败 · 请导出备份':'已保存在此设备';el.innerHTML=saveStatusView(status);el.title=status;el.classList.toggle('save-error',!!saveError);if(saveError){el.dataset.action='storage-conflict';el.setAttribute('role','button');el.tabIndex=0;}else{delete el.dataset.action;el.removeAttribute('role');el.removeAttribute('tabindex');}});}
function record(type){db.telemetry.push({type,time:Date.now(),anonymousSession:anonymousId,durationMs:Math.round(performance.now()-routeStarted)});db.telemetry=db.telemetry.slice(-500);save(true);}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('toast-visible'),5000);}
function currentRoute(){return parseRoute(location.hash);}
const sessionNow=()=>db.sessions.find(s=>s.id===currentRoute().id);
const findWorld=key=>db.worlds.find(w=>worldKey(w)===key);
const latestWorld=id=>db.worlds.filter(w=>w.id===id).sort((a,b)=>b.version-a.version)[0];
const sessionWorld=s=>findWorld(getBranch(s).worldKey);
const experience=createExperienceControls({sessionNow,getBranch,sessionWorld,getDB:()=>db,save,openDialog,toast,sendTurn,render,refresh:refreshReaderLive,showQuery:showGameRecall,busy:()=>!!(pending||assistantJob||recovering),applySettings,requestAssistance,confirmAction,cancelRequest,forkBranch,download,openRewrite:rewritePanel,showTurn(node){if(db.settings.readingMode==='paged'){readingPage=node?getBranch(sessionNow()).turns.findIndex(t=>t.id===node)+1:0;render(true);}}});
const travel=createTravelControls({session:sessionNow,branch:()=>getBranch(sessionNow()),state:()=>currentState(sessionNow()),world:()=>sessionWorld(sessionNow()),situation:()=>publicSituation(getBranch(sessionNow()),sessionWorld(sessionNow())),open:openDialog,save,toast,send:(input,gameAction)=>sendTurn('game-action',{input,gameAction}),busy:()=>!!(pending||assistantJob||recovering),close:()=>dialog.close(),settings:()=>db.settings});
const interaction=createInteractionControls({session:sessionNow,branch:getBranch,world:sessionWorld,settings:()=>db.settings,save,toast,refresh:refreshReaderLive,source:node=>experience.handle('source-jump',{dataset:{node}}),draft:text=>{const b=getBranch(sessionNow());b.draft=b.draft?b.draft+'\n'+text:text;save();refreshReaderLive();focusActionInput();}});
const dynamic=createDynamicControls({get artifact(){return generativeUIEnabled()?artifactClient:undefined;},get workbench(){return generativeUIEnabled();},download,uiContext:()=>({viewport:innerWidth<600?'narrow':'wide',readingMode:db.settings.readingMode||'continuous',editing:!!sessionNow()&&!!getBranch(sessionNow()).draft,readingHistorical:!!sessionNow()&&db.settings.readingMode==='paged'&&readingPage!==null&&readingPage<getBranch(sessionNow()).turns.length}),storage:repository.storage,active:()=>{const session=sessionNow();return session?{session,branch:getBranch(session),state:currentState(session)}:{};},ready:()=>modelChecked&&!(pending||assistantJob||recovering),ensure:ensureLedger,request:(path,body,signal)=>branchClient.request(path,body,signal),install:installConfirmed,save,refresh:refreshReaderLive,toast,draft:text=>{const b=getBranch(sessionNow()),field=$('#action-input');b.draft=appendInteractionDraft(field?.value??b.draft,text);if(field){field.value=b.draft;field.dispatchEvent(new Event('input',{bubbles:true}));focusActionInput();}save();},send:(input,dynamicAttempt)=>sendTurn('dynamic-attempt',{input,dynamicAttempt})});
function mergeWorlds(worlds=[]){for(const world of worlds){const index=db.worlds.findIndex(w=>worldKey(w)===worldKey(world));if(index<0)db.worlds.push(world);else db.worlds[index]={...world,characters:[...new Map([...db.worlds[index].characters,...world.characters].map(c=>[c.id,c])).values()]};}}
function installConfirmed(s,confirmed,world){const b=s.branches.find(b=>b.id===confirmed.id);if(!b)throw new Error('恢复结果的分支不存在。');const editingField=$('#action-input');if(editingField&&sessionNow()?.id===s.id&&s.activeBranch===b.id)b.draft=editingField.value;Object.assign(b,mergeConfirmedBranch(b,confirmed));if(world)mergeWorlds([world]);s.updatedAt=Date.now();}
function storyPreferences(preferences={}){return Object.fromEntries(Object.entries(preferences).filter(([key])=>!['style','pace'].includes(key)));}
async function ensureLedger(s,signal){const branchId=s.activeBranch,keys=new Set(s.branches.map(b=>b.worldKey));const registered=await branchClient.register({...s,preferences:storyPreferences(s.preferences)},db.worlds.filter(w=>keys.has(worldKey(w))),signal);if(signal?.aborted||s.activeBranch!==branchId||sessionNow()?.id!==s.id)return;if(registered){const b=getBranch(s),remote=registered.session.branches.find(x=>x.id===b.id);const changed=remote.turns.length!==b.turns.length||remote.turns.at(-1)?.prose!==b.turns.at(-1)?.prose;installConfirmed(s,remote,registered.worlds.find(w=>worldKey(w)===b.worldKey));if(changed){save();throw new Error('已恢复服务端确认的进展。草稿保留，请按当前情况重新发送。');}}}
async function recoverStory(quiet=false){
  const s=sessionNow();if(!s||s.mode!=='real'||pending||assistantJob)return;
  if(recoveryJob){if(recoveryJob.sid===s.id&&recoveryJob.bid===s.activeBranch)return;cancelRecovery();}
  const job={sid:s.id,bid:s.activeBranch,controller:new AbortController()};recoveryJob=job;recovering=true;
  try{
    const scope={sessionId:s.id,branchId:job.bid},journal=branchClient.journal(undefined,scope),matching=!!journal;
    if(matching&&journal.body){
      retryRequest={sid:s.id,bid:job.bid,body:{...journal.body,state:clone(currentState(s))}};
      lastSubmission={sid:s.id,bid:job.bid,input:journal.body.input,status:'error',error:'上次续写尚未完成，已保留你的输入。'};
    }
    refreshReaderLive();
    const result=await branchClient.read(s,matching?journal.requestId:undefined,job.controller.signal);
    if(recoveryJob!==job||job.controller.signal.aborted||sessionNow()?.id!==s.id||s.activeBranch!==job.bid)return;
    const b=getBranch(s),changed=result.branch.turns.length!==b.turns.length||result.branch.turns.at(-1)?.prose!==b.turns.at(-1)?.prose;
    if(changed)installConfirmed(s,result.branch,result.world);
    if(result.receipt){
      branchClient.journal(null,scope);retryRequest=null;lastSubmission=null;readerError='';readerNotice='已恢复上次确认的结果，没有重复执行。';
    }else if(matching&&journal.body){
      const confirmedVersion=result.branch.turns.at(-1)?.state.version??result.branch.initialState.version;
      if(Number.isSafeInteger(journal.body.baseVersion)&&confirmedVersion>journal.body.baseVersion){
        // The server has advanced without committing this request. Keep its text
        // separately so a newer draft never becomes an accidental compound action.
        const live=$('#action-input');if(live)b.draft=live.value;
        b.recoveredSubmission={requestId:journal.requestId,baseVersion:journal.body.baseVersion,input:journal.body.input};
        if(!b.draft.trim()){b.draft=journal.body.input;if(live)live.value=b.draft;}
        if(!save())return;
        branchClient.journal(null,scope);retryRequest=null;lastSubmission=null;readerError='';
        readerNotice='故事进度已更新，旧请求已过期且未执行。请核对草稿后重新发送。已保留的原输入：'+journal.body.input;
      }else{
        retryRequest={sid:s.id,bid:b.id,body:{...journal.body,state:clone(currentState(s))}};
        readerError='上次续写尚未完成，已保留你的输入。';lastSubmission={sid:s.id,bid:b.id,input:journal.body.input,status:'error',error:readerError};
      }
    }else if(typeof b.recoveredSubmission?.input==='string'){
      readerNotice=(b.recoveredSubmission.rejectionReason?'此前一次回应未写入故事：'+b.recoveredSubmission.rejectionReason+' 当时的原输入已独立保留，当前草稿可以编辑后发送。原输入：':'之前过期的请求未执行，原输入仍已保留；当前草稿可以编辑后发送。原输入：')+b.recoveredSubmission.input;
    }
    if(changed||result.receipt){save();render(true);}else if(!matching&&!quiet)toast('已与本机服务核对，故事停在当前进度。');
  }catch(error){
    if(recoveryJob===job&&!job.controller.signal.aborted&&sessionNow()?.id===s.id&&s.activeBranch===job.bid&&(!quiet||!['BRANCH_NOT_REGISTERED','OWNER_REQUIRED'].includes(error.code)))toast(error.message);
  }finally{
    if(recoveryJob===job){recoveryJob=null;recovering=false;refreshReaderLive();}
  }
}
function cancelRecovery(){const job=recoveryJob;if(!job)return;recoveryJob=null;recovering=false;job.controller.abort();}
async function editConfirmed(kind,{text,proposal,reason,rules,name}={}){const s=sessionNow(),b=getBranch(s),last=b.turns.at(-1);await ensureLedger(s);const result=await branchClient.request('/api/branch/edit',{sessionId:s.id,branchId:b.id,baseVersion:currentState(s).version,turnId:last?.id||null,expectedProse:last?.prose||'',requestId:uid(),kind,text,proposal,reason,rules,name});result.session.branches=mergeConfirmedBranches(s.branches,result.session.branches);Object.assign(s,{...result.session,preferences:s.preferences,saves:s.saves,title:s.title,archived:s.archived,...(s.conclusion?{conclusion:s.conclusion}:{}),...(s.personal?{personal:s.personal}:{})});mergeWorlds(result.worlds);save();render(true);}
function allLatest(){return [...new Set(db.worlds.map(w=>w.id))].map(latestWorld);}
function navigate(path){readingProgress.flush();location.hash=path;}
function cancelRequest(notify=false){cancelRecovery();dynamic.cancel();if(pending){lastSubmission={sid:pending.sid,bid:pending.bid,input:pending.input,startedAt:pending.startedAt,status:'stopped'};pending.controller.abort();pending=null;if(notify){readerNotice='已停止。下一条草稿已保留。';toast(readerNotice);}}}
const dialogNavigation=createDialogNavigation(dialog,{escape:esc,returnFallback:()=>$('.reader-tools-trigger')});
function openDialog(title,content,onSubmit,options){dialogNavigation.open(title,content,onSubmit,options);}
function confirmAction(title,message,action,label='确认'){openDialog(title,`<p>${esc(message)}</p><div class="dialog-footer">${button('取消','close-dialog')}${button(esc(label),'confirm','primary')}</div>`);dialog.querySelector('[data-action=confirm]').onclick=()=>{dialog.close();action();};}
function askName(title,value,action){openDialog(title,`<form>${input('名称','name',value,'required maxlength="100" autofocus')}<div class="dialog-footer">${button('取消','close-dialog')}<button class="btn primary" type="submit">保存</button></div></form>`,data=>{action(String(data.get('name')).trim());dialog.close();});}
function download(name,content,type='text/plain'){
  const url=URL.createObjectURL(new Blob([content],{type})),filename=name.replace(/[<>:"/\\|?*]/g,'_');
  openDialog('导出已准备',`<p class="small muted">下载为本地文件，或复制下方完整内容。若内置浏览器没有处理下载，可复制后保存为同名文件。</p><label class="field">文件内容<textarea readonly rows="10" aria-label="导出文件内容">${esc(content)}</textarea></label><div class="dialog-footer"><button type="button" class="btn" id="copy-export">复制内容</button><a class="btn primary" href="${url}" download="${esc(filename)}">下载文件</a></div><p class="small muted" style="margin-top:12px">${esc(filename)}</p>`);
  dialog.querySelector('#copy-export').onclick=async()=>{try{await navigator.clipboard.writeText(content);toast('内容已复制。');}catch{dialog.querySelector('textarea').select();toast('请按 Ctrl / ⌘ + C 复制选中的内容。');}};
  const release=()=>{if(dialog.open)return;URL.revokeObjectURL(url);dialog.removeEventListener('close',release);};dialog.addEventListener('close',release);
}

function shell(content,active='worlds'){return productShell(content,{active,sessions:db.sessions,theme:db.settings.theme});}
function worldCard(w,index){return `<a class="world-card" href="#/world/${w.id}"><div class="world-index"><span>${String(index+1).padStart(2,'0')} / ${w.custom?'你的设想':'一段可能的人生'}</span><span>↗</span></div><h3>${esc(w.title)}</h3><div class="tags">${(w.tags||[]).map(tag).join('')}</div><p class="description">${esc(w.tagline||w.description)}</p><footer><span>${esc(w.pace||'自由阅读').split(' · ')[0]} · ${w.custom?'私有世界':'约 8 个片刻'}</span><span>走进这个世界 →</span></footer></a>`;}
function home(){return shell(discoveryView({worlds:allLatest(),sessions:db.sessions,getExperience,available:modelConfig.available,favorites:db.settings.favoriteWorlds||[],excluded:db.settings.excludedWorlds||[],orderSeed:discoveryOrder,...discoveryOptions}));}
async function quickStart(seed){
 if(!seed.trim()){toast('先写下一个故事想法。');document.querySelector('#world-form [name=seed],#quick-seed')?.focus();return;}if(!modelConfig.available||assistantJob||pending)return;quickError='';
 db.settings.quickSeed=seed;if(!save()){quickError='想法暂未保存，请先处理保存问题。';render(true);return;}const job={kind:'quick-world',controller:new AbortController(),route:location.hash};assistantJob=job;render(true);
 try{const requestId=db.settings.quickRequest?.seed===seed?db.settings.quickRequest.requestId:uid();db.settings.quickRequest={seed,requestId};if(!save())throw new Error('无法保存本次请求，请先处理保存问题');const result=await branchClient.request('/api/world/start',{requestId,seed},job.controller.signal);if(assistantJob!==job||job.controller.signal.aborted||location.hash!==job.route)return;const story=result.session;validateArchive({schemaVersion:1,worlds:result.worlds,sessions:[story]});mergeWorlds(result.worlds);if(!db.sessions.some(s=>s.id===story.id))db.sessions.push(story);delete db.settings.quickRequest;assistantJob=null;db.settings.quickSeed='';if(!save()){render(true);return;}navigate('/story/'+story.id);
 }catch(error){if(assistantJob!==job)return;assistantJob=null;if(error.name!=='AbortError')quickError=error.message+'。想法已保留，可以再次尝试。';render(true);}
}
function worldDetail(id){const w=latestWorld(id);if(!w)return notFound('这个世界还不存在','请返回入口，选择另一段经历。');return shell(detailView({world:w,experience:getExperience(w),settings:db.settings,available:modelConfig.available,modelChecked,provider:modelConfig.provider,sessions:db.sessions}));}
function newDraft(){return {id:'world-'+uid(),version:1,title:'',seed:'',description:'',tagline:'',era:'',rules:[''],characters:[],location:'',identity:'',goal:'',opening:'',tags:['自建世界'],custom:true,narrative:{perspective:'第二人称',length:'适中'},originalVersion:0};}
function getEditor(id){if(editor&&editor.editId===(id||''))return editor;if(id){const w=latestWorld(id);if(!w)return null;if(db.worldDraft?.editId===id)return editor=clone(db.worldDraft);editor={...clone(w),originalVersion:w.version,editId:id,custom:!!w.custom};}else editor=db.worldDraft&&!db.worldDraft.editId?clone(db.worldDraft):{...newDraft(),seed:db.settings.quickSeed||'',editId:''};return editor;}
function characterFields(c,i){return `<div class="character-editor"><div class="row between"><h3>人物 ${i+1}</h3>${button('移除','remove-character','compact',`data-index="${i}"`)}</div><div class="field-grid">${input('姓名',`char-${i}-name`,c.name,'required maxlength="100"')}${input('身份',`char-${i}-role`,c.role,'maxlength="200"')}</div><div class="stack" style="margin-top:15px">${area('公开介绍 / 外在表现',`char-${i}-public`,c.public,'maxlength="3000"')}${input('人物自己的目标',`char-${i}-goal`,c.goal,'maxlength="500"')}${input('关系与重要经历',`char-${i}-history`,c.history||'','maxlength="1000"')}${area('幕后秘密 · 仅作者可见',`char-${i}-secret`,c.secret,'maxlength="3000"')}</div></div>`;}
function createView(id){const w=getEditor(id);if(!w)return notFound('找不到这个世界','请返回入口。');return shell(creatorView({world:w,id,available:modelConfig.available,busy:['world','quick-world'].includes(assistantJob?.kind),characterFields,error:quickError}),'create');}
function collectEditor(){const form=$('#world-form');if(!form||!editor)return;const data=new FormData(form);for(const key of ['seed','title','description','era','identity','location','goal','opening'])editor[key]=String(data.get(key)||'');editor.rules=String(data.get('rules')||'').split('\n').map(x=>x.trim()).filter(Boolean);editor.tagline=editor.description.slice(0,100);editor.narrative={...editor.narrative,...Object.fromEntries(['perspective','length'].map(k=>[k,String(data.get(k)||'')]))};editor.characters.forEach((c,i)=>{for(const key of ['name','role','public','goal','history','secret'])c[key]=String(data.get(`char-${i}-${key}`)||'');});db.worldDraft=clone(editor);editorDirty=true;}
function persistEditor(){collectEditor();scheduleSave();}
function publishWorld(){collectEditor();try{const w=clone(editor);w.title=w.title.trim();w.version=(latestWorld(w.id)?.version||0)+1;w.rules=w.rules.length?w.rules:['人物拥有自己的生活与选择。'];delete w.editId;delete w.originalVersion;delete w.additions;w.demoCompatible=false;validateWorld(w);const draft=db.worldDraft;db.worlds.push(w);db.worldDraft=null;if(!save()){db.worlds.pop();db.worldDraft=draft;return;}editor=null;editorDirty=false;record('world_created');toast('世界已保存。');navigate('/world/'+w.id);}catch(e){toast(e.message);}}

function stories(){return shell(libraryView({sessions:db.sessions,...libraryOptions}),'stories');}
function reader(){const session=sessionNow();if(!session)return notFound('这一段故事没有找到','这个地址对应的存档不在当前浏览器。可以导入之前导出的 JSON 存档。');const branch=getBranch(session),world=sessionWorld(session),state=currentState(session);let suggestions=[];try{suggestions=session.mode==='demo'?demoActions(world,state):branch.turns.at(-1)?.suggestions||[];}catch{}const html=experience.reader({session,branch,world,state,suggestions,busy:pending?.sid===session.id||!!assistantJob||recovering,error:readerError,pending:[pending,lastSubmission].find(item=>item?.sid===session.id&&item?.bid===branch.id)||null,notice:readerNotice,settings:db.settings,intentMode,focusMode,page:readingPage??branch.turns.length,saveStatus:saveError?'保存失败，请先备份':'已保存在此设备',references:ensurePersonal(branch).draftReferences});const recalled=gameRecall?.sid===session.id&&gameRecall?.bid===branch.id?readerRecallView({kind:gameRecall.kind,query:gameRecall.query,state,situation:publicSituation(branch,world),branch,busy:!!(pending||assistantJob||recovering)}):'';const contextual=interaction.html();return html.replace('<div data-draft-references','<div data-reader-live="context-selection">'+contextual.selection+'</div><div data-draft-references').replace('<div data-reader-live="pending"','<div data-reader-live="dynamic">'+dynamic.html()+'</div><div data-reader-live="context-result" id="context-result">'+contextual.panel+'</div><div data-reader-live="game-recall" id="game-recall" tabindex="-1">'+recalled+'</div><div data-reader-live="pending"');}
function notFound(title,message){return shell(`<main id="main" class="page"><div class="error-page"><div class="eyebrow">A PAGE NOT YET WRITTEN</div><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="row" style="justify-content:center">${link('返回世界','/','btn primary')}${link('我的世界','/stories','btn')}</div></div></main>`);}
let settingsSection='reading-settings';
function settings(){return shell(settingsView({settings:db.settings,modelConfig,saveError,telemetry:db.telemetry,activeSection:settingsSection}),'settings');}

// Disclosure is a reading preference, scoped to branch, turn and current/history.
const contextCardOpen=new Map();
function rememberContextCards(){for(const card of document.querySelectorAll('[data-context-card]'))contextCardOpen.set(card.dataset.contextCard,card.open);while(contextCardOpen.size>300)contextCardOpen.delete(contextCardOpen.keys().next().value);}
function restoreContextCards(){for(const card of document.querySelectorAll('[data-context-card]'))if(contextCardOpen.has(card.dataset.contextCard))card.open=contextCardOpen.get(card.dataset.contextCard);}
const routeScroll=new Map();history.scrollRestoration='manual';
const readingProgress=createReadingProgress({capture:({branch,y})=>{
  branch.readingPosition=y;experience.persistAnchor(branch);
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(true),300);
}});
function render(keepScroll=false){universeMotion.unmount();interfaceMotion.mount();controlMotion.mount();readingProgress.flush();const restorePageFocus=hasPageContentFocus();const journeyFocus=keepScroll?document.activeElement?.closest?.("[data-story-id]")?.dataset.storyId:null;rememberContextCards();const y=scrollY,{path,id}=currentRoute();document.body.dataset.page=path||'home';applySettings();document.body.classList.toggle('focus-mode',focusMode&&path==='story');if(loadError){app.innerHTML=notFound('本机存档暂时无法读取',loadError)+`<div style="text-align:center;padding:20px">${button('下载原始数据备份','export-raw')}${button('导入有效存档以恢复','recover-import')}</div>`;return;}try{app.innerHTML=path==='world'?worldDetail(id):path==='create'?createView():path==='edit'?createView(id):path==='stories'?stories():path==='story'?reader():path==='settings'?settings():path===''?home():notFound('这一页没有找到','请通过导航返回世界或已有故事。');}catch(e){console.error(e);app.innerHTML=notFound('这一页暂时无法打开','数据没有被删除。请返回我的世界或从设置导出备份。');}refreshModelUI();updateSaveLabels();document.title=(path==='story'&&sessionNow()?sessionNow().title+' · ':'')+'elselife · 人生复本';restoreContextCards();bindForms();refreshDossier();worldField.mount();universeMotion.mount();if(restorePageFocus)focusPageContent();if(journeyFocus){const next=app.querySelector('[data-story-id="'+CSS.escape(journeyFocus)+'"] .library-more>summary')||app.querySelector('.library-category-nav input:checked');next?.focus({preventScroll:true});}if(keepScroll)requestAnimationFrame(()=>scrollTo({top:y,behavior:'instant'}));}
let composerObserver,librarySearchTimer;
const historicalRichBindings=new WeakSet();
function bindHistoricalRich(){for(const root of document.querySelectorAll('[data-historical-rich]')){if(historicalRichBindings.has(root))continue;historicalRichBindings.add(root);bindRichControls(root,{ready:()=>false,toast});}}
function observeComposer(){composerObserver?.disconnect();const composer=$('.reading-composer-wrap');if(!composer)return;composerObserver=new ResizeObserver(()=>{document.documentElement.style.setProperty('--composer-height',composer.getBoundingClientRect().height+'px');});composerObserver.observe(composer);}
function bindForms(){dynamic.bind();bindHistoricalRich();observeComposer();requestAnimationFrame(()=>centerMaps());interaction.bind();if(currentRoute().path==='story'&&sessionNow())experience.bind();for(const [selector,options] of [['#discovery-form',discoveryOptions],['#library-form',libraryOptions]]){const f=$(selector);if(f)f.onsubmit=e=>{e.preventDefault();const d=new FormData(f);for(const key of Object.keys(options))options[key]=key==='onlyFavorites'?d.has(key):String(d.get(key)||'');const focused=document.activeElement,name=focused?.name,selection=focused?.type==='search'?[focused.selectionStart,focused.selectionEnd]:null;render(true);if(name){const next=document.querySelector(selector)?.querySelector('[name="'+CSS.escape(name)+'"]:checked,[name="'+CSS.escape(name)+'"]');next?.focus({preventScroll:true});if(selection&&next?.setSelectionRange)next.setSelectionRange(...selection);}};if(f)f.onchange=e=>{if(e.target.matches('select,input[type=checkbox],input[type=radio]'))f.requestSubmit();};if(f&&selector==='#library-form'){f.oninput=e=>{if(e.target.name!=='query')return;clearTimeout(librarySearchTimer);if(e.isComposing)return;librarySearchTimer=setTimeout(()=>{if(f.isConnected)f.requestSubmit();},240);};f.addEventListener('compositionstart',()=>clearTimeout(librarySearchTimer));f.addEventListener('compositionend',e=>f.oninput(e));f.addEventListener('search',()=>{if(f.isConnected)f.requestSubmit();});}}const start=$('#start-form');if(start)start.onsubmit=e=>{e.preventDefault();if(!modelChecked){toast('正在检查连接，请稍候。');return;}const d=new FormData(start),w=latestWorld(start.dataset.world),s=createSession(w,{name:String(d.get('name')||'旅人').trim()||'旅人',identity:String(d.get('identity')||w.identity).trim()||w.identity,goal:String(d.get('goal')||'')},String(d.get('mode')));s.preferences={...s.preferences,participation:String(d.get('participation')||'observe'),boundaries:String(d.get('boundaries')||''),perspective:String(d.get('perspective')),length:String(d.get('length'))};db.sessions.push(s);if(!save()){db.sessions.pop();return;}record('story_started');navigate('/story/'+s.id);};const wf=$('#world-form');if(wf){wf.onsubmit=e=>{e.preventDefault();publishWorld();};wf.oninput=persistEditor;}const af=$('#action-form');if(af){af.onsubmit=e=>{e.preventDefault();sendTurn();};const field=$('#action-input');field.oninput=()=>{const s=sessionNow();if(!s)return;getBranch(s).draft=field.value;const send=af.querySelector('[type=submit]');if(send)send.disabled=af.dataset.storyBlocked==='true'||!!(pending||assistantJob||recovering)||!field.value.trim();field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';scheduleSave();};field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';field.onkeydown=e=>{if(shouldSend(e,db.settings.sendEnter)){e.preventDefault();sendTurn();}};}}

// Patch only live controls and append completed turns, keeping native selection and
// existing paragraph nodes intact while the model is working.
function refreshReaderPending(){
  const s=sessionNow();if(currentRoute().path!=='story'||!s)return;
  const b=getBranch(s),host=$('[data-reader-live="pending"]');if(!host)return;
  const record=[pending,lastSubmission].find(item=>item?.sid===s.id&&item?.bid===b.id)||null;
  // Internal stage events must not restart the scene animation or steal stop-button focus.
  if(record&&!readerError&&!record.error&&!['error','stopped'].includes(record.status)&&host.querySelector?.('.reading-pending.is-waiting .story-waiting'))return;
  host.innerHTML=pendingRecord(record,readerError,!!(pending||assistantJob||recovering),{readOnly:demoReadOnly(s,sessionWorld(s))});
}
function refreshReaderLive(){
  rememberContextCards();
  if(currentRoute().path!=='story')return;
  const template=document.createElement('template');template.innerHTML=reader();
  const source=template.content,field=$('#action-input'),focused=document.activeElement;
  const inputState=field?{value:field.value,start:field.selectionStart,end:field.selectionEnd,focused:focused===field}:null;
  const host=$('[data-reader-turns]');
  if(!host){render(true);return;}if(db.settings.readingMode==='paged'){for(const fresh of source.querySelectorAll('[data-reader-turns]>.turn')){const old=host.querySelector('.turn');if(old?.id!==fresh.id){host.replaceChildren(fresh.cloneNode(true));}}}
  for(const turn of source.querySelectorAll('[data-reader-turns]>.turn'))if(db.settings.readingMode!=='paged'&&!document.getElementById(turn.id))host.append(turn.cloneNode(true));
  for(const fresh of source.querySelectorAll('[data-reader-turns]>.turn')){const old=document.getElementById(fresh.id);if(old&&getBranch(sessionNow()).turns.find(t=>'turn-'+t.id===fresh.id)?.operation&&old.innerHTML!==fresh.innerHTML)old.replaceWith(fresh.cloneNode(true));}
  for(const fresh of source.querySelectorAll('[data-reader-live]')){if(fresh.dataset.readerLive==='dynamic')continue;const old=document.querySelector('[data-reader-live="'+fresh.dataset.readerLive+'"]');if(old)old.replaceWith(fresh.cloneNode(true));}
  for(const fresh of source.querySelectorAll('[data-history-interaction]')){const old=document.querySelector('[data-history-interaction="'+CSS.escape(fresh.dataset.historyInteraction)+'"]');if(old&&!old.firstElementChild&&fresh.firstElementChild)old.replaceWith(fresh.cloneNode(true));}
  dynamic.refresh();restoreContextCards();bindForms();updateSaveLabels();
  travel.invalidate();
  experience.invalidate();refreshDossier();
  const next=$('#action-input');if(inputState&&next){next.value=getBranch(sessionNow()).draft||'';if(inputState.focused){next.focus({preventScroll:true});next.setSelectionRange(inputState.start,inputState.end);}}
}
async function sendTurn(actionId,options={}){
  const s=sessionNow();if(!s||pending||assistantJob||recovering)return;if(dynamic.busy()){toast('正在完成这次行动，输入已保留。');return;}const b=getBranch(s),w=sessionWorld(s),field=$('#action-input');if(field)b.draft=field.value;
  const inputText=options.input??(actionId==='continue'?'让当前场景自然继续。':b.draft.trim());
  if(!inputText&&actionId!=='retry'){toast('写下你想做的事，或输入“继续”。');return;}
  if(s.mode==='real'&&!modelChecked){toast('正在读取功能配置，请稍候再发送。草稿已保留。');return;}
  dynamic.cancelPrepare();
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
  const richRequest=!actionId&&s.mode==='real'?richInteractionRequest(inputText,{hasArtifact:dynamic.hasPresentation()}):null;
  const query=!actionId?gameQuery(inputText):null;
  if(query){b.draft='';if(field)field.value='';interaction.hide();save();showGameRecall(query);return;}
  if(!actionId&&interaction.run(inputText)){gameRecall=null;b.draft='';const live=$('#action-input');if(live)live.value='';save();refreshReaderLive();return;}
  const local=!actionId?localCommand(inputText):null;if(local){if(local.action)experience.handle(local.action,{});else{db.settings[local.setting]=local.delta?Number(db.settings[local.setting]||18)+local.delta:local.value;applySettings();save();render(true);toast('已调整界面，故事没有变化。');}return;}
  if(!actionId&&s.mode==='real'&&(generativeUIEnabled()||richRequest)){
    const result=generativeUIEnabled()?await dynamic.route(richRequest?.intent??inputText):await dynamic.prepare(true,richRequest.intent);
    if(!result||result.error)return;
    if(['mixed','clarify'].includes(result.intentDecision?.kind)){toast(result.intentDecision.message||'请说明这次是调整界面，还是进行故事行动。');return;}
    if(result.intentDecision?.kind!=='story'){
    if(result?.authoritativeBranch?.dynamic&&!result.authoritativeBranch.dynamic.reason&&sessionNow()?.id===s.id&&s.activeBranch===b.id){
      if(b.draft.trim()===inputText){b.draft='';const live=$('#action-input');if(live)live.value='';}
      interaction.hide();gameRecall=null;save();refreshReaderLive();
      if(!result.authoritativeBranch.dynamic.definition)toast(result.authoritativeBranch.dynamic.decisionReason||'此刻没有需要额外整理的信息。');
    }
    return;
    }
  }
  const kind=options.input||actionId==='continue'||actionId==='retry'?'action':detectIntent(inputText);
  if(kind==='rewrite'){rewritePanel();return;}if(kind!=='action'){requestAssistance(kind,inputText);return;}
  if(s.archived){confirmAction('这段故事已封存','恢复后才能继续生成，已有正文始终可以阅读。',()=>{s.archived=false;save();render(true);},'恢复这段故事');return;}if(b.archived){toast('这条分支已封存，请先在分支面板恢复。');return;}if(b.turns.at(-1)?.ended&&actionId!=='epilogue'){toast('这一段已告一段落，可以保存、导出，或从历史节点另试一种可能。');return;}
  if(db.settings.readingMode==='paged'&&readingPage===null)readingPage=b.turns.length;
  if(demoReadOnly(s,w)){toast('这个世界可以回顾开场；连接模型后新开一局，才能自由行动。');return;}if(s.mode==='real'&&actionId!=='retry'&&(readerError||lastSubmission?.sid===s.id&&lastSubmission?.bid===b.id)){toast('请先重试回应或核对已保存的结果，草稿已保留。');return;}if(s.mode==='demo'&&options.gameAction){toast('预设演示采用固定剧情。请在自由游玩中执行场景玩法。');return;}if(s.mode==='demo'&&options.control){toast('预设演示没有自由时间推进。请开始自由游玩故事。');return;}
  if(repository.hasExternalChange()){conflictPanel();return;}if(!save())return;
  let body;try{
    if(!actionId&&!options.gameAction&&s.mode==='real')options={...options,gameAction:gameActionForInput(currentState(s),inputText,b.id)};
    // Preserve stored retry preferences so old request fingerprints still match receipts.
    if(actionId==='retry'){if(!retryRequest||retryRequest.sid!==s.id||retryRequest.bid!==b.id||retryRequest.body.state.version!==currentState(s).version)throw new Error('这次请求已经过期，请重新发送。');body=clone(retryRequest.body);}
    else{const selection=interaction.selection();const refs=experience.references().map(ref=>{validateReference(b,ref);return {...ref,sourceText:ref.turnId?b.turns.find(t=>t.id===ref.turnId).prose:b.opening};});body={requestId:uid(),world:w,worldKey:b.worldKey,branchId:b.id,baseVersion:currentState(s).version,state:clone(currentState(s)),player:s.player,preferences:storyPreferences(s.preferences),...selectContext(b,inputText),narrative:narrativeForBranch(b),input:inputText,actionId,...(selection?{selection}:{}),...(options.control?{control:{...options.control,worldKey:b.worldKey,branchId:b.id,baseVersion:currentState(s).version}}:{}),...(refs.length?{references:refs}:{}),...(options.dynamicAttempt?{dynamicAttempt:options.dynamicAttempt}:{}),...(options.gameAction?{gameAction:options.gameAction}:{})};}
  }catch(e){toast(e.message);return;}
  const controller=new AbortController(),requestId=body.requestId,bid=b.id;
  const scoped={sessionId:s.id,...Object.fromEntries(['requestId','branchId','baseVersion','input','preferences','control','gameAction','dynamicAttempt','references','selection'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))};
  try{if(s.mode==='real')branchClient.journal({sessionId:s.id,branchId:b.id,requestId:body.requestId,body:scoped});}catch{toast('本次输入尚未保存，请先处理保存问题。');return;}
  pending={sid:s.id,bid,controller,requestId,input:body.input,startedAt:Date.now(),status:'waiting',stage:'preparing'};lastSubmission=null;retryRequest={sid:s.id,bid,body:clone(body)};readerError='';readerNotice='';
  if(actionId!=='retry'&&!options.input&&((actionId!=='continue'&&b.draft.trim()===inputText)||command?.action==='continue')){b.draft='';if(field)field.value='';}save();refreshReaderLive();
  try{let proposal;if(s.mode==='demo')proposal=await new DemoProvider().generate(body,controller.signal);else{await ensureLedger(s,controller.signal);proposal=await branchClient.generate(scoped,controller.signal,stage=>{if(pending?.requestId===requestId){pending.stage=stage;refreshReaderPending();}});}
    if(controller.signal.aborted||pending?.requestId!==requestId||s.activeBranch!==bid||sessionNow()?.id!==s.id)return;
    if(repository.hasExternalChange()){pending=null;readerError='另一标签页有新进展。当前回应未写入，请先处理存档冲突。';refreshReaderLive();conflictPanel();return;}
    const nearBottom=innerHeight+scrollY>=document.documentElement.scrollHeight-180;
    // Input typed during generation belongs to the next action and is preserved.
    const fieldNow=$('#action-input');if(fieldNow)b.draft=fieldNow.value;
    if(proposal.authoritativeBranch){installConfirmed(s,proposal.authoritativeBranch,proposal.world);branchClient.journal(null,{sessionId:s.id,branchId:bid});}else{const nextDraft=b.draft;commitTurn(s,w,body.input,proposal,bid);b.draft=nextDraft;}lastSubmission=null;interaction.clear(body.selection);if(actionId==='continue')interaction.hide();pending=null;retryRequest=null;
    const used=JSON.stringify(body.references?.map(({sourceText,...r})=>r)||[]);if(JSON.stringify(ensurePersonal(b).draftReferences)===used)experience.clearReferences();
    if(b.turns.length===1)record('first_valid_turn');if(b.turns.length===3)record('third_valid_turn');save();refreshReaderLive();if(proposal.operationId)queueMicrotask(()=>dynamic.narrate(proposal.operationId));
    requestAnimationFrame(()=>{if(nearBottom&&db.settings.readingMode!=='paged'&&!window.getSelection()?.toString())$('#reader-bottom')?.scrollIntoView({block:'end',behavior:db.settings.reducedMotion?'instant':'smooth'});else $('#new-content')?.classList.remove('hidden');});
  }catch(e){if(pending?.requestId!==requestId)return;
    // These failures occur before commit. Preserve their input before retiring
    // the journal, while uncertain network failures keep the original identity.
    if(['INVALID_MODEL_RESULT','INCONSISTENT_STORY','CONTEXT_TOO_LARGE'].includes(e.code)){
      const live=$('#action-input');if(live)b.draft=live.value;
      b.recoveredSubmission={requestId,baseVersion:body.baseVersion,input:body.input,rejectionReason:e.message};
      if(!b.draft.trim()){b.draft=body.input;if(live)live.value=b.draft;}
      if(save()){
        branchClient.journal(null,{sessionId:s.id,branchId:bid});
        pending=null;retryRequest=null;lastSubmission=null;readerError='';
        readerNotice='这次回应未写入故事：'+e.message+' 原输入已独立保留，请核对草稿后重新发送。原输入：'+body.input;
        record('generation_failed');refreshReaderLive();return;
      }
    }
    // A clarification confirms that no action was executed. Let the reader edit
    // the request instead of trapping them in an identical, unanswerable retry.
    if(e.code==='CLARIFY_ACTION'){
      branchClient.journal(null,{sessionId:s.id,branchId:bid});
      pending=null;retryRequest=null;lastSubmission=null;readerError='';readerNotice=e.message;
      const live=$('#action-input');if(!b.draft.trim()){b.draft=body.input;if(live)live.value=b.draft;}
      save();refreshReaderLive();return;
    }
    lastSubmission={sid:s.id,bid,input:body.input,startedAt:pending.startedAt,status:e.name==='AbortError'?'stopped':'error',error:e.name==='AbortError'?'':e.message};pending=null;if(e.name==='AbortError')readerNotice='已取消。输入草稿和旧故事已保留。';else{readerError=e.message;record('generation_failed');}refreshReaderLive();}
}
function conflictPanel(){if(!repository.hasExternalChange()){openDialog('本机保存失败','<p>'+esc(saveError||'浏览器暂时不能保存数据。')+'</p><p class="small muted">请先导出当前记录，避免关闭页面后丢失进度。</p><div class="row">'+button('导出当前记录','conflict-export')+button('重试保存','retry-save')+'</div>');return;}openDialog('另一标签页有新进展', '<p>当前页面的故事和草稿仍保留在内存里。先导出这份资料，再选择如何接续。不会用旧页面覆盖另一个标签页。</p><div class="stack">'+button('导出当前页面备份','conflict-export')+button('比较两个版本','conflict-compare')+button('保留为副本并接续最新存档','conflict-merge')+button('放弃本页未保存内容，载入最新','conflict-reload')+'</div>');}
function infoPanel(){const s=sessionNow(),w=sessionWorld(s),st=currentState(s);openDialog('人物与见闻',`<div class="eyebrow">只展示你已经知道的事情</div><section style="margin-top:24px"><h3 class="serif">此刻</h3><p class="small muted">${esc(st.location)} · ${esc(st.time)}</p></section><h3 class="serif" style="margin:24px 0 18px">人物</h3>${w.characters.length?w.characters.map(c=>`<article class="info-person"><h3>${esc(c.name)} <span class="small muted">${esc(c.role)}</span></h3><p>${esc(c.public)}</p><p class="relation">${esc(st.relations[c.id]||'尚待相识')}</p></article>`).join(''):'<p class="small muted">这个世界尚未设定人物。</p>'}<h3 class="serif" style="margin-top:24px">已知事实</h3>${st.facts.length?`<ul class="fact-list">${st.facts.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>`:'<p class="small muted">故事刚刚开始，还没有确认的新事实。</p>'}${st.inventory.length?`<h3 class="serif" style="margin-top:24px">随身之物</h3><ul class="fact-list">${st.inventory.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}<h3 class="serif" style="margin-top:24px">重要事件</h3><ul class="fact-list">${getBranch(s).turns.flatMap((t,i)=>t.events.filter(e=>e.visibility==='player'&&e.type!=='flag').map(e=>`<li><span class="small muted">片刻 ${i+1}</span> · ${esc(e.value)}</li>`)).slice(-10).join('')||'<li>尚未留下事件。</li>'}</ul>`);}
function branchesPanel(){const s=sessionNow();openDialog('分支与存档',`<div class="row between"><p class="small muted">切换分支，继续不同的经历。</p>${button('保存此刻','named-save','compact')}</div>${s.branches.map(b=>`<div class="branch-row"><div class="row between"><h3>${esc(b.name)} ${b.id===s.activeBranch?'<span class="tag pill">当前</span>':''}</h3>${b.id!==s.activeBranch?button('切换','switch-branch','compact',`data-id="${b.id}"`):''}${button(b.archived?'恢复分支':'封存分支','archive-branch','compact',`data-id="${b.id}"`)}</div><p>${b.turns.length} 个片刻 · 世界 V${b.worldKey.split('@').at(-1)}${b.parentBranch?' · 从另一条分支生长':''}</p></div>`).join('')}<h3 class="serif" style="margin-top:25px">命名存档</h3>${s.saves.map(save=>`<div class="branch-row"><div class="row between"><span>${esc(save.name)}</span>${button('从此刻继续','restore-save','compact',`data-id="${save.id}"`)}</div><p>${date(save.createdAt)} · 恢复时新建分支，保留当前进度</p></div>`).join('')||'<p class="small muted">还没有保存的节点。</p>'}`);}
function toolsPanel(){const s=sessionNow(),empty=!getBranch(s).turns.length;openDialog('故事选项','<div class="tool-grid">'+button('显示设置','reader-settings')+button('参与方式','play-participation')+button('分支与存档','branches')+button('书签与笔记','notes')+button('搜索与回顾','history')+button('导出正文','export-story')+button('帮助','help')+'</div><details class="tool-group"><summary>剧情与行动</summary><div class="stack">'+button('先问问 AI','ask-assistant')+button('推进时间','time-control')+button('今天先到这里','finish-experience')+button('复用上次表达','reuse-input','',empty?'disabled':'')+button('恢复复用前草稿','undo-reuse','',recentDraft?.sid===s.id&&recentDraft?.bid===s.activeBranch?'':'disabled')+button('指出错误','repair-turn','',empty?'disabled':'')+button('换种写法','polish-turn','',empty?'disabled':'')+button('撤销最近一次润色','undo-polish','',getBranch(s).turns.at(-1)?.revisions?.length?'':'disabled')+button('让这段故事合理收束','finish-story','',s.mode==='demo'?'disabled':'')+button('重新生成','regenerate','',empty?'disabled':'')+'</div></details><details class="tool-group"><summary>世界与更多记录</summary><div class="stack">'+button('对照经历与变化','compare-experience')+button('查看公开设定','ask-world')+button('改写世界设定','rewrite')+button('导出本机记录','export-session')+button('作者视图 · 可能剧透','author-view')+'</div></details>');}

function narrationPanel(){const s=sessionNow();openDialog('调整后续叙述',`<form><p class="small muted">只影响接下来的模型生成；预设演示正文固定。不会推进时间或重写历史。</p><div class="field-grid">${select('视角','perspective',['第二人称','第一人称','第三人称'],s.preferences.perspective)}${select('篇幅','length',['简短','适中','舒展'],s.preferences.length)}</div><div class="dialog-footer"><button class="btn primary" type="submit">应用到后续</button></div></form>`,data=>{s.preferences={...s.preferences,...Object.fromEntries(['perspective','length'].map(key=>[key,String(data.get(key)||'')]))};save();dialog.close();toast('叙述偏好已更新，故事时间没有前进。');});}
function rewritePanel(){const s=sessionNow(),w=sessionWorld(s),latest=latestWorld(w.id);openDialog('作者改写',`<form><div class="notice">改写只在新分支上生效。原分支、原世界版本和已经发生的历史全部保留。新规则约束后续生成，不自动改变人物意志或抹除旧事件。</div>${latest.version>w.version?`<div style="margin:20px 0">${button('通过新分支应用 V'+latest.version+' 世界','apply-version','',`data-version="${latest.version}"`)}<p class="small muted">将保留当前状态，使用该版本的规则与人物资料继续，已经发生的开场保持原文。</p></div>`:''}<div class="stack" style="margin-top:20px">${input('新分支名称','name','作者改写','required maxlength="100"')}${area('修改基本规则 · 每行一条','rules',w.rules.join('\n'),'required maxlength="8000"')}</div><div class="dialog-footer"><button class="btn primary" type="submit">确认并建立新分支</button></div></form>`,async data=>{if(s.privateLedger){try{await editConfirmed('rewrite',{rules:String(data.get('rules')).split('\n').filter(x=>x.trim()),name:String(data.get('name'))});dialog.close();toast('新规则已在独立分支生效，原历史保留。');}catch(e){toast(e.message);}return;}cancelRequest();const nw={...clone(w),demoCompatible:false,version:latestWorld(w.id).version+1,rules:String(data.get('rules')).split('\n').filter(x=>x.trim())};db.worlds.push(nw);forkBranch(s,getBranch(s).turns.at(-1)?.id||null,String(data.get('name')),nw);record('branch_created');save();dialog.close();render();toast('改写已应用到新分支，原故事仍可恢复。');});}
function exportSession(s){const keys=new Set(s.branches.map(b=>b.worldKey));download(s.title+'-本机记录.json',JSON.stringify({schemaVersion:1,worlds:db.worlds.filter(w=>keys.has(worldKey(w))),sessions:[s]},null,2),'application/json');}
function importDialog(recover=false){openDialog('导入记录',`<p class="small muted">选择人生复本导出的 JSON 文件（最大 10 MB）。故事作为副本导入；文件中的阅读偏好和创作草稿会替换当前设置。</p><label class="field">选择 JSON 存档<input type="file" id="import-file" accept=".json,application/json"></label><p id="import-result" class="small" role="alert" style="margin-top:16px"></p>`);$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('文件超过 10 MB 限制，请选择较小的存档。');const incoming=validateArchive(JSON.parse(await file.text()));const next=mergeArchive(db,incoming);if(recover)repository.recover(next);else repository.save(next);db=next;editor=null;editorDirty=false;loadError='';saveError='';dialog.close();toast(`已导入 ${incoming.sessions.length} 段故事，原有数据保留。`);navigate('/stories');render();}catch(error){$('#import-result').textContent='导入未完成：'+(error instanceof SyntaxError?'这不是有效的 JSON 文件。':error.message)+' 原有数据未改变。';}};}

function refreshModelUI(){
  const path=currentRoute().path;
  if(path==='story'){refreshReaderLive();}
  else if(path==='create'||path==='edit'){
    for(const action of ['generate-world','quick-world']){
      const control=$(`[data-action=${action}]`);
      if(control)control.disabled=!modelConfig.available||!!assistantJob;
    }
    const note=$('#creation-model-status');
    if(note)note.textContent=modelConfig.available?'':'模型暂不可用，可以手动填写并保存。原始设想仍会自动保留。';
  }else if(path==='world'){
    refreshStartOptions($('#start-form'),{...modelConfig,modelChecked},startAvailability);
  }else if(path===''){
    const discoveryNote=$('[data-discovery-model-note]');if(discoveryNote)discoveryNote.hidden=modelConfig.available;
  }else if(path==='settings'){
    const status=$('[data-model-status]');if(status)status.innerHTML=modelStatus(modelConfig);
  }
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
    openDialog('今天先到这里',`<p>留下备注，方便下次继续。</p><form><label class="field">此刻的感受<select name="outcome"><option value="pause" selected>暂停，下次继续</option><option value="satisfied">结束这段经历，并封存故事</option><option value="problem">遇到问题，暂时不想继续</option></select></label>${area('留给下次的一句话（可不填）','note','','maxlength="500"')}<div class="dialog-footer"><button class="btn primary" type="submit">保存并回到我的世界</button></div></form>`,data=>{cancelRequest();cancelAssist();s.conclusion={outcome:String(data.get('outcome')),note:String(data.get('note')),createdAt:Date.now()};if(s.conclusion.outcome==='satisfied')s.archived=true;record('experience_'+s.conclusion.outcome);if(save()){dialog.close();navigate('/stories');}});return true;
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
    payload={...payload,world:sessionWorld(s),state:clone(base),player:s.player,preferences:storyPreferences(s.preferences),branchId:b.id,...(selected?{selection:selected}:{}),...selectContext(history,inputText),...(last?{target:{id:last.id,input:last.input,prose:last.prose,events:last.events,suggestions:last.suggestions,ended:last.ended}}:{})};
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
    openDialog(title,`<p class="small muted">${kind==='ask'?'这是对可能性的说明，事情尚未发生；人物的实际回应仍可能不同。':kind==='phrase'?'这段话还没有对人物说出。采用后也需要你亲自发送。':kind==='polish'?'采用后仅替换最后一轮表达。请核对没有新增事实、承诺或秘密。':'不会用新的幕后理由替错误辩护。原线保留，只有确认的修复会应用。'}</p><div class="prose">${paragraphs(result.text)}</div>${hasProposal?`<h3 class="serif">修复后的正文</h3><div class="prose" style="margin-top:12px">${paragraphs(result.proposal.prose)}</div><details><summary>将提交的变更（作者审阅）</summary><ul class="fact-list">${result.proposal.events.map(e=>`<li>${esc(e.type)} · ${esc(e.value)}${e.visibility==='hidden'?'（幕后）':''}</li>`).join('')||'<li>不新增状态变更</li>'}</ul></details>`:''}<div class="dialog-footer">${button('关闭，保持原样','close-dialog')}${kind==='phrase'?button('放入输入框，暂不发送','adopt-assist','primary'):kind==='polish'?button('确认只改表达','adopt-assist','primary'):hasProposal?button('确认并建立修复分支','adopt-assist','primary'):kind==='ask'?button('把原问题改作实际行动','adopt-assist'):''}</div>`,undefined,{replace:true});
    record(kind+'_reviewed');
    const adopt=dialog.querySelector('[data-action=adopt-assist]');
    if(adopt)adopt.onclick=async()=>{
      if(!stillCurrent()){toast('故事已经改变，请重新生成。');dialog.close();return;}
      try {
        if(kind==='phrase'||kind==='ask'){b.draft=kind==='phrase'?result.text:inputText;intentMode='auto';}
        if(kind==='polish'){if(s.mode==='real')await editConfirmed('polish',{text:result.text});else applyPolish(s,last.id,result.text,version);}
        if(hasProposal){if(s.mode==='real')await editConfirmed('repair',{proposal:result.proposal,reason:inputText});else applyRepair(s,sessionWorld(s),result.proposal,inputText,b.id,version);}
        record(kind+'_applied');save();dialog.close();render(true);if(kind==='phrase'||kind==='ask')focusActionInput();
      }catch(error){toast(error.message);}
    };
  } catch(error){
    if(assistantJob!==job||job.controller.signal.aborted)return;
    assistantJob=null;if(kind==='world')render(true);
    else openDialog('没有改变你的故事',`<p role="alert">${esc(error.message)}</p><p class="small muted">原有内容保持不变。你的要求：</p><p>${esc(inputText)}</p><div class="dialog-footer">${button('关闭','close-dialog')}</div>`,undefined,{replace:true});
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
function refreshDossier(){
 const meta=dialog.open&&dialog.classList.contains('reader-dossier')&&dialog.querySelector('[data-dossier-version]');if(!meta||!sessionNow())return;
 const b=getBranch(sessionNow()),historical=db.settings.readingMode==='paged'&&readingPage!==null&&readingPage<b.turns.length,source=historical?(b.turns[readingPage-1]?.id||'opening'):'current';
 if(meta.dataset.dossierSource===source&&(historical||Number(meta.dataset.dossierVersion)===currentState(sessionNow()).version)&&meta.dataset.dossierBusy===String(!!(pending||assistantJob||recovering)))return;
 const position=dialog.querySelector('.dialog-content')?.scrollTop||0,active=document.activeElement,kind=meta.dataset.dossierKind;showGameRecall(kind,{query:meta.dataset.dossierQuery||''});dialog.querySelector('.dialog-content').scrollTop=position;
 if(active?.isConnected&&!dialog.contains(active))active.focus({preventScroll:true});
}
function showGameRecall(kind='all',{query=''}={}){
  const s=sessionNow();if(!s)return;
  const b=getBranch(s);gameRecall=null;interaction.hide();experience.reset();
  const historical=db.settings.readingMode==='paged'&&readingPage!==null&&readingPage<b.turns.length;
  const until=historical?readingPage:b.turns.length,shown={...b,turns:b.turns.slice(0,until)},state=shown.turns.at(-1)?.state||b.initialState;
  const content=readerDossierNav(kind).replace('<nav ',`<nav data-dossier-version="${state.version}" data-dossier-kind="${esc(kind)}" data-dossier-query="${esc(query)}" data-dossier-busy="${!!(pending||assistantJob||recovering)}" data-dossier-source="${historical?esc(shown.turns.at(-1)?.id||'opening'):'current'}" `)+`<p class="dossier-context">${historical?'当时的公开资料':'此刻已知的资料'} · ${esc(s.title)}</p>`+readerRecallView({kind,query,state,situation:publicSituation(b,sessionWorld(s),historical?(shown.turns.at(-1)?.id||null):undefined),branch:shown,busy:historical||!!(pending||assistantJob||recovering)});
  const snapshot=historical?(shown.turns.at(-1)?.id||null):undefined;experience.viewSnapshot(snapshot);
  openDialog('故事资料',content,undefined,{replace:dialog.classList.contains('reader-dossier'),modal:innerWidth<1100,onRestore:()=>{experience.viewSnapshot(snapshot);experience.bind();refreshDossier();}});dialog.classList.add('reader-dossier');experience.bind();centerMaps(dialog);
}

document.addEventListener('keydown',e=>{if(e.key!=='Escape'||dialog.open)return;const menu=$('.discovery-more[open],details[data-menu][open]');if(menu){menu.open=false;menu.querySelector('summary')?.focus();e.preventDefault();}});
document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.discovery-more[open],details[data-menu][open]'))if(!menu.contains(e.target))menu.open=false;if(e.target.closest('.skip-link')){e.preventDefault();const main=$('#main');main?.setAttribute('tabindex','-1');main?.focus();main?.scrollIntoView();return;}const target=e.target.closest('[data-action]');if(!target||target.disabled)return;const action=target.dataset.action,s=sessionNow();const quickTools=target.closest('[popover]');if(quickTools?.matches(':popover-open'))quickTools.hidePopover();
  if(action==='settings-jump'){e.preventDefault();if(selectSettingsSection(app,target.dataset.section))settingsSection=target.dataset.section;return;}
  if(interaction.handle(action,target))return;
  if(travel.handle(action,target))return;
  if(action==='recover-turn'||action==='recover-story'){recoverStory();return;}
  if(action==='undo-polish'&&s?.mode==='real'){editConfirmed('undo-polish').then(()=>{dialog.close();toast('已恢复上一版表达，事实没有改变。');}).catch(e=>toast(e.message));return;}
  if(action==='map-zoom'){
    const map=target.closest('.spatial-atlas'),view=map?.querySelector('.atlas-viewport'),canvas=map?.querySelector('.atlas-canvas');if(!canvas)return;
    const old=Number(canvas.dataset.zoom)||1,zoom=target.dataset.factor==='reset'?1:Math.max(1,Math.min(3,old*Number(target.dataset.factor)));
    const centerX=(view.scrollLeft+view.clientWidth/2)/canvas.clientWidth,centerY=(view.scrollTop+view.clientHeight/2)/canvas.clientHeight;
    const base=canvas.clientWidth/old;canvas.dataset.zoom=String(zoom);canvas.style.width=zoom===1?'':base*zoom+'px';
    view.scrollLeft=centerX*canvas.clientWidth-view.clientWidth/2;view.scrollTop=centerY*canvas.clientHeight-view.clientHeight/2;return;
  }
  if(action==='map-scope'){
    if(!s)return;const b=getBranch(s),node=target.dataset.node,snapshot=readerSnapshot(b,node);if(!snapshot)return;
    const projection=gameRecallState(snapshot.state,publicSituation(b,sessionWorld(s),snapshot.sourceNode));
    openDialog('地图',gameRecallView(projection,{kind:'map',node,scope:target.dataset.scope||null,anchorId:target.dataset.anchor||null}));dialog.classList.add('reader-inspector');centerMaps(dialog);return;
  }
  if(action==='reader-inspect'){
    if(!s)return;const b=getBranch(s),kind=target.dataset.kind;
    const titles={all:'概览',map:'地图',status:'我的状态',inventory:'随身物品',interaction:'已知人物',timeline:'时间线',clues:'线索',time:'时间',journal:'手记'};
    if(!titles[kind])return;
    showGameRecall(kind);return;
  }
  if(action==='game-recall'){showGameRecall(target.dataset.kind||'all');return;}
  if(action==='game-dismiss-recall'){if(dialog.open){dialog.close();return;}gameRecall=null;refreshReaderLive();$('.reader-tools-trigger')?.focus({preventScroll:true});return;}
  if(action==='game-map-expand'){
    if(!s)return;const b=getBranch(s),node=target.dataset.node,snapshot=readerSnapshot(b,node);
    if(!snapshot){toast('这份地图不属于当前分支。');return;}
    const projection=gameRecallState(snapshot.state,publicSituation(b,sessionWorld(s),snapshot.sourceNode));
    openDialog('已知地图',gameRecallView(projection,{kind:'map',node}));dialog.classList.add('map-expanded');centerMaps(dialog);return;
  }
  if(action==='game-inspect'){
    if(!s)return;const b=getBranch(s),node=target.dataset.node;
    const snapshot=readerSnapshot(b,node);
    if(!snapshot){toast('这份记录不属于当前分支。');return;}
    const projection=gameRecallState(snapshot.state,publicSituation(b,sessionWorld(s),snapshot.sourceNode));
    const entity=projection.game?.entities.find(x=>x.id===target.dataset.entity);
    if(!entity){toast('这份资料尚未公开。');return;}
    openDialog(entity.name,gameInspectView(entity,projection.game,{node}));dialog.classList.add('entity-inspector');return;
  }
  if(action==='game-act'){
    if(!s||pending||assistantJob)return;
    const b=getBranch(s),ref={branchId:target.dataset.branch,version:Number(target.dataset.version),surfaceId:target.dataset.surface,actionId:target.dataset.actionId};
    try{const receipt=resolveGameAction(currentState(s),ref,{branchId:b.id});dialog.close();sendTurn('game-action',{input:receipt.input,gameAction:ref});}
    catch(error){toast(error.message);refreshReaderLive();}return;
  }
  if(action==='reader-example'){const b=getBranch(s);if(!b.draft)b.draft='我想先听听他们怎么说。';else toast('已有草稿为你保留；示例：我想先听听他们怎么说。');db.settings.readerGuideDismissed=true;save();render(true);focusActionInput();return;}
  if(action==='dismiss-reader-guide'){db.settings.readerGuideDismissed=true;save();render(true);return;}
  if(action==='surprise-world'){const choices=[...document.querySelectorAll('.discovery-card h3 a')];if(choices.length)location.hash=choices[Math.floor(Math.random()*choices.length)].hash;else toast('暂无匹配开局，可以更改筛选。');return;}
  if(action==='shuffle-worlds'){discoveryOrder++;render(true);return;}
  if(action==='archive-branch'){const b=s.branches.find(b=>b.id===target.dataset.id);if(b){b.archived=!b.archived;save();branchesPanel();}return;}
  if(action==='favorite-world'){const set=new Set(db.settings.favoriteWorlds||[]);set.has(target.dataset.id)?set.delete(target.dataset.id):set.add(target.dataset.id);db.settings.favoriteWorlds=[...set];save();render(true);document.querySelector('[data-action="favorite-world"][data-id="'+CSS.escape(target.dataset.id)+'"]')?.closest('details')?.querySelector('summary')?.focus({preventScroll:true});return;}
  if(action==='reset-library'){libraryOptions={query:'',category:'active',group:'',sort:'updated'};render(true);return;}
  if(action==='clear-discovery'||action==='reset-discovery'){discoveryOptions={query:'',tag:'',excludeTag:'',onlyFavorites:false};render(true);return;}
  if(action==='reading-prev'||action==='reading-next'){readingProgress.flush();readingPage=Number(target.dataset.page);render();focusPageContent();$('#main')?.scrollIntoView({behavior:'instant'});return;}
  if(action==='exclude-world'||action==='restore-excluded'){const set=new Set(db.settings.excludedWorlds||[]);action==='exclude-world'?set.add(target.dataset.id):set.delete(target.dataset.id);db.settings.excludedWorlds=[...set];save();render(true);return;}
  if(['batch-archive','batch-trash','batch-restore'].includes(action)){const ids=[...document.querySelectorAll('input[name=select-story]:checked')].map(el=>el.value);if(!ids.length){toast('先选择要整理的故事。');return;}confirmAction('批量整理 '+ids.length+' 段故事','所有分支保留，回收箱中的故事可以恢复。',()=>{db.sessions=db.sessions.map(x=>!ids.includes(x.id)?x:action==='batch-trash'?trashStory(x):action==='batch-restore'?updateStoryMetadata(restoreStory(x),{archived:false}):updateStoryMetadata(x,{archived:true}));save();render(true);},'应用');return;}
  if(action==='reuse-input'){const b=getBranch(s);if(!b.turns.length)return;recentDraft={sid:s.id,bid:b.id,text:b.draft};b.draft=b.turns.at(-1).input||'';save();dialog.close();render(true);focusActionInput();return;}
  if(action==='undo-reuse'){const b=getBranch(s);if(recentDraft?.sid!==s.id||recentDraft?.bid!==b.id)return;b.draft=recentDraft.text;recentDraft=null;save();dialog.close();render(true);focusActionInput();return;}
  if(action==='import-world-text'){worldImportPanel();return;}
  if(action==='retry-turn'||action==='retry-generation'){sendTurn('retry');return;}
  if(action==='storage-conflict'){conflictPanel();return;}
  if(action==='conflict-export'){download('人生复本-当前页面备份.json',JSON.stringify(db,null,2),'application/json');return;}
  if(action==='conflict-compare'){try{const other=repository.readExternal(PRESET_WORLDS);openDialog('比较本机存档', '<p>每份均包含独立故事、分支和草稿。只读比较不覆盖数据。</p><h3>当前页面</h3><p>'+db.sessions.length+' 段故事</p><ul>'+db.sessions.map(x=>'<li>'+esc(x.title)+' · '+getBranch(x).turns.length+' 回合 · 草稿 '+(getBranch(x).draft||'').length+' 字</li>').join('')+'</ul><h3>另一标签页已保存</h3><p>'+other.sessions.length+' 段故事</p><ul>'+other.sessions.map(x=>'<li>'+esc(x.title)+' · '+getBranch(x).turns.length+' 回合 · 草稿 '+(getBranch(x).draft||'').length+' 字</li>').join('')+'</ul>'+button('返回处理','storage-conflict'));}catch(e){toast(e.message);}return;}
  if(action==='conflict-merge'){try{cancelRequest();const current=clone(db);db=repository.mergeExternal(external=>mergeArchive(external,current));saveError='';dialog.close();navigate('/stories');render();toast('两份故事均已保留；重名的本页故事存为独立副本。');}catch(e){toast(e.message);}return;}
  if(action==='conflict-reload'){confirmAction('放弃本页未保存内容','仅保留另一标签页已成功保存的资料。尚未导出的本页草稿将丢失。',()=>{try{cancelRequest();db=repository.acceptExternal(PRESET_WORLDS);saveError='';render();}catch(e){toast(e.message);}},'载入最新');return;}
  if(experience.handle(action,target))return;
  if(handleExperienceAction(action,target,s))return;
  if(action==='dialog-back'){if(assistantJob&&!['world','quick-world'].includes(assistantJob.kind))cancelAssist();dialogNavigation.back();return;}
  if(action==='close-dialog'){cancelAssist();dialog.close();return;}
  if(action==='confirm')return;
  if(action==='suggest'){let actions=s.mode==='demo'?demoActions(sessionWorld(s),currentState(s)):getBranch(s).turns.at(-1)?.suggestions||[];const choice=actions.find(a=>a.id===target.dataset.id);if(choice){const field=$('#action-input');field.value=choice.text;field.dispatchEvent(new Event('input'));focusActionInput();}return;}
  if(action==='continue'){dialog.close();sendTurn('continue');return;}
  if(action==='cancel-generation'){cancelAssist();cancelRequest(true);refreshReaderLive();return;}
  if(action==='new-content'){if(db.settings.readingMode==='paged'){readingPage=getBranch(s).turns.length;render();}$('#reader-bottom').scrollIntoView({block:'end'});target.classList.add('hidden');return;}
  if(action==='info'){infoPanel();return;}
  if(action==='story-tools'){toolsPanel();return;}
  if(action==='branches'){branchesPanel();return;}
  if(action==='narration'){narrationPanel();return;}
  if(action==='focus'){focusMode=!focusMode;if(dialog.open)dialog.close();render(true);return;}
  if(action==='fork'){confirmAction('从这个片刻，另写一段','新分支只保留这个节点及以前的故事、物品与关系。当前分支完整保留。',()=>{cancelRequest();forkBranch(s,target.dataset.node||null,'另一种可能 '+s.branches.length);record('branch_created');readerError='';readerNotice='';save();render();scrollTo(0,0);},'建立分支');return;}
  if(action==='switch-branch'){cancelRequest();s.activeBranch=target.dataset.id;readingPage=null;experience.reset();readerError='';readerNotice='';save();dialog.close();render();recoverStory(true);requestAnimationFrame(()=>scrollTo(0,getBranch(s).readingPosition||0));return;}
  if(action==='named-save'){askName('给这个片刻一个名字',currentState(s).location,name=>{s.saves.push({id:uid(),name,branchId:s.activeBranch,turnId:getBranch(s).turns.at(-1)?.id||null,createdAt:Date.now()});if(save())toast('这个片刻已保存在此设备。');});return;}
  if(action==='restore-save'){const mark=s.saves.find(x=>x.id===target.dataset.id);confirmAction('从命名存档继续','将从保存节点建立新分支；此节点以后的事实不会带入。',()=>{cancelRequest();s.activeBranch=mark.branchId;forkBranch(s,mark.turnId,mark.name+' · 继续');record('save_resumed');save();render();},'恢复并继续');return;}
  if(action==='regenerate'){confirmAction('重新生成最后一个回应','将从上个回应之前建立分支，旧结果与后果保留在旧分支。演示采用固定脚本，同样的行动会得到相同结果。',()=>{cancelRequest();const turns=getBranch(s).turns,last=turns.at(-1);forkBranch(s,turns.at(-2)?.id||null,'替代回应 '+s.branches.length);getBranch(s).draft=last.input;record('branch_created');save();readerError='';render();sendTurn(last.input==='让当前场景自然继续。'?'continue':undefined);},'建立分支并重生成');return;}
  if(action==='ask-world'){const w=sessionWorld(s);openDialog('询问设定 · 不推进时间',`<p class="small muted">这里整理的是当前世界的公开设定与已知事实；不从幕后秘密中提供答案。</p><h3 class="serif">这个世界如何运转？</h3><ul class="fact-list">${w.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><h3 class="serif">我是谁，正在做什么？</h3><p>${esc(s.player.name)} · ${esc(s.player.identity)}</p><p class="small muted">个人目标：${esc(s.player.goal||'尚未设定')}</p><h3 class="serif">我已经确认了什么？</h3><ul class="fact-list">${currentState(s).facts.map(f=>`<li>${esc(f)}</li>`).join('')||'<li>还没有新的已确认事实。</li>'}</ul>`);return;}
  if(action==='rewrite'){rewritePanel();return;}
  if(action==='apply-version'){const nw=latestWorld(s.worldId);if(!Object.keys(getBranch(s).initialState.characters).every(id=>nw.characters.some(c=>c.id===id))){toast('新版本移除了已有故事的人物。请保留这些人物，或从新版世界开始独立故事。');return;}confirmAction('将新版本应用到新分支','将使用新版本的世界资料继续，保留原有经历。新增人物尚待相识。此操作不会改动原分支。',()=>{cancelRequest();forkBranch(s,getBranch(s).turns.at(-1)?.id||null,'世界 V'+nw.version,nw);record('branch_created');save();render();},'创建新分支');return;}
  if(action==='author-view'){confirmAction('进入作者视图','以下资料可能揭示幕后秘密。普通人物面板不会显示这些内容。',()=>{const w=sessionWorld(s);openDialog('作者视图 · 幕后资料',w.characters.map(c=>`<section class="info-person"><h3>${esc(c.name)}</h3><p>目标：${esc(c.goal||'未设定')}</p><p>经历：${esc(c.history||'未设定')}</p><p>秘密：${esc(c.secret||'未设定')}</p></section>`).join('')||'<p>没有幕后人物资料。</p>');},'我知道，查看幕后');return;}
  if(action==='export-story'){download(s.title+'.md',exportMarkdown(s,sessionWorld(s)),'text/markdown');toast('已准备当前分支正文，不含幕后资料。');return;}
  if(action==='export-session'){confirmAction('导出本机记录','JSON 包含浏览器中的所有分支与草稿，旧故事可能含幕后资料。新开局的幕后设定只在本机服务中，此 JSON 不能单独迁移续玩；请同时保留 .data 目录与当前浏览器。分享请导出正文。',()=>exportSession(s),'导出 JSON');return;}
  if(action==='export-all'){confirmAction('导出本机记录','包含浏览器中的世界、草稿和故事分支；旧档可能含幕后资料。新开局还需本机 .data 目录与当前浏览器标识，JSON 不是独立完整备份。不包含模型密钥。',()=>download('人生复本-本机记录.json',JSON.stringify(db,null,2),'application/json'),'导出 JSON');return;}
  if(action==='export-raw'){download('人生复本-原始数据备份.json',localStorage.getItem(STORAGE_KEY)||'{}','application/json');return;}
  if(action==='import-dialog'||action==='recover-import'){importDialog(action==='recover-import');return;}
  if(action==='export-events'){download('人生复本-体验事件.json',JSON.stringify(db.telemetry,null,2),'application/json');return;}
  if(action==='retry-save'){if(save())toast('已重新保存在此设备。');return;}
  if(action==='check-model'){fetch('/api/config').then(r=>r.json()).then(c=>{modelConfig=c;modelChecked=true;refreshModelUI();toast(c.available?'模型服务已配置。可新建真实模型故事进行验证。':'尚未配置模型，请编辑服务端 .env 并重启。');}).catch(()=>toast('无法连接本地服务，请确认 npm start 正在运行。'));return;}
  if(action==='clear-demo'){confirmAction('整理演示故事','将预设演示移入回收箱，可以随时恢复。',()=>{const presets=new Set(PRESET_WORLDS.map(w=>w.id));for(const story of db.sessions)if(story.mode==='demo'&&presets.has(story.worldId))Object.assign(story,trashStory(story));save();render(true);toast('演示故事已移入回收箱。');},'移入回收箱');return;}
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
dialog.addEventListener('close',()=>{if(!dialog.open)experience.reset();});
document.addEventListener('input',e=>{const el=e.target;if(el.name==='mode'&&el.closest('#start-form')){el.dataset.touched='true';refreshModelUI();}if(el.id==='reading-page'){readingProgress.flush();readingPage=Number(el.value);render();focusPageContent();$('#main')?.scrollIntoView({behavior:'instant'});return;}if(el.id==='input-intent'){intentMode=el.value;const s=sessionNow();if(s){const b=getBranch(s);Object.assign(b,setDraftContext(b,{references:ensurePersonal(b).draftReferences,intent:intentMode}));save();}refreshInputOptions();return;}if(el.id==='participation'){if(['delegate','skip'].includes(el.value)){experience.handle('time-control',el);return;}const s=sessionNow();if(s){s.preferences.participation=el.value;save();refreshInputOptions();}return;}const key=el.dataset.setting;if(!key)return;db.settings[key]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value;applySettings();if(key==='theme')document.querySelectorAll('[data-setting=theme]').forEach(control=>{control.value=db.settings.theme;});const value=$('#value-'+key);if(value)value.textContent=el.value+(key==='lineHeight'?'':'px');scheduleSave();});
window.addEventListener('hashchange',()=>{readingProgress.flush();editorialMotion.prepareRoute();clearTimeout(saveTimer);if(editorDirty){collectEditor();editorDirty=false;}save(true);if(dialog.open)dialog.close();cancelRequest();cancelAssist();intentMode='auto';readingPage=null;experience.reset();const {path,id}=currentRoute();if(path==='story'&&sessionNow())intentMode='auto';if(lastRoute.startsWith('story/')&&path!=='story')record('trial_exited');lastRoute=path+'/'+id;routeStarted=performance.now();readerError='';readerNotice='';if(path==='')record('home_opened');if(path==='world')record('world_opened');if(path==='story'&&sessionNow())record('save_resumed');render();focusPageContent();if(path==='story')recoverStory(true);requestAnimationFrame(()=>{if(path==='story'&&sessionNow()&&getBranch(sessionNow()).personal?.anchor)experience.restoreAnchor();else scrollTo({top:path==='story'&&sessionNow()?getBranch(sessionNow()).readingPosition||0:routeScroll.get(path+'/'+id)||0,behavior:'instant'});editorialMotion.settleRoute({changed:true});});});
window.addEventListener('scroll',()=>{
  const {path,id}=currentRoute();if(path+'/'+id!==lastRoute)return;
  routeScroll.set(lastRoute,scrollY);const s=sessionNow();
  if(path==='story'&&s)readingProgress.schedule({branch:getBranch(s),y:scrollY});
}, {passive:true});
const flushReadingProgress=()=>{readingProgress.flush();clearTimeout(saveTimer);save(true);};
window.addEventListener('pagehide',flushReadingProgress);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushReadingProgress();});
document.addEventListener('pointerup',()=>experience.captureSelection());
document.addEventListener('keyup',e=>{if(e.key==='Shift')experience.captureSelection();if(['Enter',' '].includes(e.key)&&e.target.matches('[data-save][role=button]')){e.preventDefault();conflictPanel();}});
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY&&repository.hasExternalChange()){saveError='另一标签页有新进展 · 点此处理';updateSaveLabels();toast('另一标签页有新进展。当前页面和草稿已保留，自动覆盖已停止。');}});
if(window.visualViewport){const resize=()=>{const style=document.documentElement.style;style.setProperty('--keyboard-offset',Math.max(0,innerHeight-visualViewport.height-visualViewport.offsetTop)+'px');style.setProperty('--visual-viewport-height',visualViewport.height+'px');style.setProperty('--visual-viewport-top',visualViewport.offsetTop+'px');};visualViewport.addEventListener('resize',resize);visualViewport.addEventListener('scroll',resize);resize();}
window.addEventListener('beforeunload',e=>{readingProgress.flush();if(editorDirty)collectEditor();clearTimeout(saveTimer);const ok=save(true);if(!ok||pending||assistantJob){e.preventDefault();e.returnValue='';}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySettings);
fetch('/api/config').then(r=>{if(!r.ok)throw new Error('连接检查失败');return r.json();}).then(c=>{modelConfig=c;modelChecked=true;refreshModelUI();}).catch(()=>{modelConfig={available:false};modelChecked=true;refreshModelUI();});
if(currentRoute().path==='story'&&sessionNow())intentMode='auto';
render();if(!loadError){if(currentRoute().path==='story')recoverStory(true);record(currentRoute().path==='story'?'save_resumed':currentRoute().path==='world'?'world_opened':'home_opened');lastRoute=currentRoute().path+'/'+currentRoute().id;requestAnimationFrame(()=>{if(currentRoute().path==='story'&&sessionNow()){if(getBranch(sessionNow()).personal?.anchor)experience.restoreAnchor();else scrollTo({top:getBranch(sessionNow()).readingPosition||0,behavior:'instant'});}});}

function refreshInputOptions(){const summary=$('.writing-options>summary'),intent=$('#input-intent'),participation=$('#participation');if(summary)summary.textContent='输入选项'+(intent?.value!=='auto'?' · '+intent.selectedOptions[0].textContent:'')+(participation?.value!=='act'?' · '+participation.selectedOptions[0].textContent:'');const submit=$('#action-form button[type=submit]');if(submit)submit.textContent=intentMode==='ask'?'提问 ↑':intentMode==='phrase'?'帮我措辞 ↑':'发送 ↑';}

function worldImportPanel(){collectEditor();openDialog('导入创作资料', '<p>支持 TXT、Markdown、文字 JSON 角色卡和世界书。先解析预览，再采用到草案；不会自动生成或执行脚本。</p><label class="field">选择资料<input type="file" id="world-material" accept=".txt,.md,.json"></label><div id="material-preview"></div>');$('#world-material').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>360000)throw new Error('文件过大，请选择 120 KB 以内的文字资料。');const result=parseWorldImport(await f.text(),f.name);$('#material-preview').innerHTML='<p>'+result.warnings.map(esc).join('<br>')+'</p><pre class="code-note">'+esc(JSON.stringify(result.fields||{seed:result.seed},null,2))+'</pre>'+button('采用到当前创作草案','adopt-material');$('#material-preview button').onclick=()=>{Object.assign(editor,result.fields||{seed:result.seed});db.worldDraft=clone(editor);editorDirty=true;save();dialog.close();render();};}catch(error){$('#material-preview').textContent=error.message;}};}
setInterval(()=>{const now=Date.now(),delta=Math.min(30000,now-lastReadTick);lastReadTick=now;if(currentRoute().path==='story'&&document.visibilityState==='visible')readingElapsed+=delta;if(currentRoute().path!=='story'||!db.settings.restReminder||restShown||readingElapsed<30*60*1000)return;restShown=true;toast('已经读了一会儿。故事为你停在这里，可以让眼睛休息一下。');},30000);
