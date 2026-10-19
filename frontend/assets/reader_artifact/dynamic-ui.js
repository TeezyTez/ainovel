import {DYNAMIC_PROMPT_VERSION,expression,publicContext,resolveDynamic,validateParams,conditionVisible,fieldVisible} from './dynamic-rules.js';
import {renderRichView} from './rich-interaction-view.js';
import {bindRichControls} from './rich-interaction-controls.js';
import {createArtifactRuntime} from './interactive-runtime.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=v=>Array.isArray(v)?v.map(plain).join('、'):v&&typeof v==='object'?JSON.stringify(v):v??'';
export function dynamicRequest(session,branch,action,params,requestId=crypto.randomUUID()){
  const saved=branch.dynamic,d=saved.definition;return {sessionId:session.id,branchId:branch.id,requestId,scope:d.scope,interactionId:d.id,revision:d.revision,definitionDigest:saved.digest,actionId:action.id,targets:action.targets,params};
}
export function dynamicView(d,state,params,step=0,{busy=false,closed=false,historical=false}={}){
  const context={...publicContext(state),params},budget={left:2000};let count=0;
  function node(n,ctx,path){if(count>=1000)return '';try{return renderNode(n,ctx,path);}catch{return '<p class="small muted">这部分暂时无法显示；请补全输入，或重新整理。</p>';}}
  function renderNode(n,ctx,path){if(++count>1000)throw new Error('显示内容超过限制。');if(n.when!==undefined&&!expression(n.when,ctx,budget))return '';const value=x=>expression(x,ctx,budget);
    // Presentation identity follows the definition, independent of which siblings render.
    const rich=renderRichView(n,{value,esc,plain,index:d.scope.branchId+'-'+d.scope.baseVersion+'-'+d.id+'-'+path,busy,historical,omitTitle:!n.title||n.title===d.title,omitCaption:n.caption===d.summary});if(rich!==null)return rich;
    if(n.type==='text')return `<p>${esc(n.text)}</p>`;
    if(n.type==='value')return `<span class="dynamic-value">${n.label?`<span>${esc(n.label)} </span>`:''}<strong>${esc(plain(value(n.value)))}</strong></span>`;
    if(n.type==='meter'){const max=value(n.max),v=value(n.value);return `<label>${esc(n.label)} <meter min="0" max="${esc(Number.isFinite(max)&&max>0?max:1)}" value="${esc(Number.isFinite(v)?v:0)}">${esc(v)}</meter> ${esc(v)} / ${esc(max)}</label>`;}
    if(n.type==='repeat'){const items=value(n.items);if(!Array.isArray(items)||items.length>100)throw new Error('重复数据无效。');return items.map((item,itemIndex)=>(n.children||[]).map((child,childIndex)=>node(child,{...ctx,item},path+'-item-'+itemIndex+'-child-'+childIndex)).join('')).join('');}
    return `<div class="dynamic-${n.type}">${(n.children||[]).map((child,index)=>node(child,ctx,path+'-child-'+index)).join('')}</div>`;
  }
  const steps=d.steps.filter(s=>conditionVisible(s.when,context)),index=Math.min(step,Math.max(0,steps.length-1)),current=steps[index],last=!steps.length||index===steps.length-1;
  function field(f){const v=params[f.id],attrs=`data-dynamic-field="${esc(f.id)}" aria-label="${esc(f.label)}" ${busy?'disabled':''}`;let input;
    if(f.type==='choice'||f.type==='multiple')input=`<select ${attrs} ${f.type==='multiple'?'multiple':''}><option value="" ${f.type==='multiple'?'disabled':''}>请选择</option>${f.options.map(o=>`<option value="${esc(o.id)}" ${(Array.isArray(v)?v.includes(o.id):o.id===v)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if(f.type==='boolean')input=`<input type="checkbox" ${attrs} ${v?'checked':''}>`;
    else input=`<input type="${f.type==='number'?'number':'text'}" ${attrs} value="${esc(v??'')}" ${f.type==='number'?`min="${f.min}" max="${f.max}" step="${f.integer?1:'any'}"`:'maxlength="1000"'}>`;
    return `<label class="field">${esc(f.label)}${f.required?' *':''}${input}</label>`;
  }
  const views=d.view.map((n,index)=>node(n,context,'view-'+index)).join('');
  return `<details class="dynamic-interaction" ${closed?'':'open'}><summary>${esc(d.title)}</summary>${d.summary?`<p>${esc(d.summary)}</p>`:''}<div data-dynamic-values>${views}</div>${current?`<p class="small" data-dynamic-step>${index+1} / ${steps.length} · ${esc(current.title)}</p>`:''}<div class="dynamic-fields">${d.fields.filter(f=>(!current||current.fields.includes(f.id))&&fieldVisible(d,f,context)).map(field).join('')}</div><div data-dynamic-preview role="status"></div><div class="dynamic-row">${index>0?'<button type="button" class="btn" data-dynamic-nav="-1">上一步</button>':''}${!last?'<button type="button" class="btn" data-dynamic-nav="1">下一步 · 准备</button>':d.actions.map(a=>`<button type="button" class="btn" data-dynamic-action="${esc(a.id)}" ${busy?'disabled':''}>${a.mode==='attempt'?'尝试 · ':''}${esc(a.label)}</button>`).join('')}</div>${d.fields.length||d.actions.length?'<p class="small muted">选择与预览不会改变故事。也可以在下方自由输入其他做法。</p>':''}</details>`;
}
export function createDynamicControls(api){
  let running=false,controller=null,stage=null,jobScope=null,retryTimer=null,failure=null;const attempted=new Set(),autoAttempts=new Map(),presentations=new Map(),rendered=new WeakMap();
  let workbenchFactory,workbenchLoading,workbenchHost,workbenchHandle,progressStage='',stateWrites=Promise.resolve();const stateFailures=new Map();
  const stateScope=()=>now()?.session?JSON.stringify([now().session.id,now().branch.id]):'';
  const hydrated=new Set(),hydrating=new Map();
  const busy=()=>running&&stage!=='prepare';
  const now=()=>api.active();
  const artifactMetadata=()=>now()?.branch?.dynamic?.artifact;
  const artifacts=createArtifactRuntime({active:now,storage:api.storage,ready:()=>!busy()&&api.ready()&&current(),draft:text=>api.draft?.(text),repair:intent=>queueMicrotask(()=>{if(!running&&current())prepare(true,intent);}),
    state:()=>artifactMetadata()?.compatible?artifactMetadata().state:undefined,
    bundle:(_node,context)=>{const {session,branch}=now();return api.artifact?.bundle({sessionId:session.id,branchId:branch.id,definitionDigest:context.digest});},
    onState:(state,context)=>{if(!api.artifact)return;const active=now(),sid=active.session.id,bid=active.branch.id,metadata=artifactMetadata(),saveScope=stateScope();if(!metadata?.compatible||context.digest!==active.branch.dynamic?.digest)return;
      stateWrites=stateWrites.catch(()=>{}).then(async()=>{const current=now();if(current?.session?.id!==sid||current?.branch?.id!==bid||current.branch.dynamic?.digest!==context.digest)return;const latest=artifactMetadata();if(latest?.head!==metadata.head)return;
        try{const result=await api.artifact.state({sessionId:sid,branchId:bid,artifactId:latest.artifactId,revisionId:latest.head,expectedStateRevision:latest.stateRevision,state});if(now()?.session?.id===sid&&now()?.branch?.id===bid&&artifactMetadata()?.head===latest.head){now().branch.dynamic.artifact=result.artifact;stateFailures.delete(saveScope);}}
        catch(e){const message='参数尚未保存：'+e.message;stateFailures.set(saveScope,{state,head:metadata.head,message});if(stateScope()===saveScope){failure={scope:scopeKey(now()),message};mount();}throw e;}
      });return stateWrites;
    }});
  const source=({branch,state})=>JSON.stringify({worldKey:branch.worldKey,opening:branch.opening,state,turns:branch.turns.slice(-3).map(({id,input,prose,narration})=>({id,input,prose,narration}))});
  const scopeKey=active=>JSON.stringify([active.session.id,active.branch.id,active.state.version,source(active)]);
  const sameScope=scope=>{const active=now();return active?.session&&scopeKey(active)===scope&&!api.uiContext?.().readingHistorical;};
  function clearRetry(){if(retryTimer){(api.clear??clearTimeout)(retryTimer.id);retryTimer=null;}}
  function showFailure(){const active=now();if(!active?.session)return '';const scope=scopeKey(active),message=failure?.scope===scope?failure.message:active.branch.dynamic?.scope?.sessionId===active.session.id&&active.branch.dynamic?.scope?.branchId===active.branch.id&&active.branch.dynamic?.scope?.baseVersion===active.state.version?active.branch.dynamic.reason:'';return message?`<p class="dynamic-prepare-error" role="status">整理未完成：${esc(message)} <button type="button" class="btn" data-dynamic-retry>重新整理</button></p>`:'';}
  const key=()=>{const {session,branch}=now();return 'elselife:interaction-draft:'+session.id+':'+branch.id+':'+branch.dynamic?.digest;};
  function draft(){try{const saved=now().branch.dynamicDraft;const old=saved?.digest===now().branch.dynamic?.digest?saved:JSON.parse(api.storage.getItem(key())||'null');if(old)return old;}catch{}const d=now().branch.dynamic.definition;return {params:Object.fromEntries(d.fields.filter(f=>f.default!==undefined).map(f=>[f.id,f.default])),step:0,closed:false};}
  const remember=d=>{const branch=now().branch,previous=branch.dynamicDraft;if(previous&&previous.digest!==branch.dynamic?.digest){branch.dynamicDraftHistory??={};branch.dynamicDraftHistory[previous.digest]=previous;}now().branch.dynamicDraft={...d,digest:now().branch.dynamic?.digest,interactionId:now().branch.dynamic?.definition?.id,labels:Object.fromEntries(now().branch.dynamic.definition.fields.map(f=>[f.id,f.label]))};api.storage.setItem(key(),JSON.stringify(d));api.save();};
  function current(){const active=now();if(!active?.session||!active.branch||!active.state||api.uiContext?.().readingHistorical)return false;const {session,branch,state}=active;return !!(branch.dynamic?.promptVersion===DYNAMIC_PROMPT_VERSION&&branch.dynamic.definition&&branch.dynamic.scope.sessionId===session.id&&branch.dynamic.scope.baseVersion===state.version&&branch.dynamic.scope.branchId===branch.id&&branch.dynamic.scope.worldKey===branch.worldKey);}
  function presentation(){
    if(!current())return {};
    const {session,branch}=now(),id=JSON.stringify([session.id,branch.id,branch.dynamic.digest]);
    if(!presentations.has(id))presentations.set(id,{});
    const saved=presentations.get(id);presentations.delete(id);presentations.set(id,saved);
    while(presentations.size>12)presentations.delete(presentations.keys().next().value);
    return saved;
  }
  function html(contentOnly=false){
    const active=now();if(!active?.session||api.uiContext?.().readingHistorical)return '';
    const {branch,state}=active,op=branch.turns.at(-1);
    if(op?.operation&&op.narration?.status!=='complete')return `<section class="dynamic-pending"><p role="status">行动结果已保存。${esc(op.narration?.error||'正文正在等待续写。')}</p><button type="button" class="btn" data-dynamic-narrate="${esc(op.id)}" ${running?'disabled':''}>${running?'正在续写…':'续写这次结果'}</button></section>`;
    const status=!contentOnly&&running&&stage==='prepare'&&jobScope?.foreground?'<p class="dynamic-preparing" role="status"><span>正在整理这份资料</span><button type="button" class="dynamic-prepare-cancel" data-dynamic-cancel aria-label="停止整理线索" title="停止整理线索">×</button></p>':'';
    const error=contentOnly?'':showFailure();if(!current())return status+error;
    try{
      const d=draft(),previous=branch.dynamicDraft,retained=previous&&previous.digest!==branch.dynamic.digest?'<details class="dynamic-operation-record"><summary>上次未提交的输入已保留</summary><p>'+Object.entries(previous.params||{}).map(([k,v])=>esc((previous.labels?.[k]||k)+'：'+plain(v))).join('；')+'</p></details>':'';
      const version=contentOnly&&artifactMetadata()?.head?`<span hidden data-artifact-version="${esc(artifactMetadata().head)}"></span>`:'';
      const conflict=branch.artifactDraftConflict?`<details class="dynamic-operation-record"><summary>上次未保存的试算</summary><pre>${esc(JSON.stringify(branch.artifactDraftConflict.state,null,2))}</pre></details>`:'';
      return status+error+version+conflict+retained+dynamicView(branch.dynamic.definition,state,d.params,d.step,{busy:busy(),closed:contentOnly?false:d.closed});
    }catch{return status+error+'<p>辅助交互无法显示，输入仍可使用。</p>';}
  }
  function ensureWorkbench(){if(!api.workbench||workbenchFactory||workbenchLoading)return;workbenchLoading=import('/dist/workbench/workbench.js').then(module=>{workbenchFactory=module.mountArtifactWorkbench;mount();}).catch(()=>{workbenchLoading=null;});}
  function mount(){const container=document.querySelector('[data-reader-live="dynamic"]');if(!container)return;ensureWorkbench();
    if(workbenchFactory){
      const active=now(),metadata=artifactMetadata(),d=current()?active.branch.dynamic.definition:null,scope=active?.session?scopeKey(active):null;
      const props={title:d?.title,summary:d?.summary,html:html(true),busy:running,stage:running?progressStage:undefined,error:failure?.scope===scope?failure.message:d?active.branch.dynamic.reason:'',revisions:metadata?.revisions?.filter(r=>r.compatible!==false)??[],currentRevision:metadata?.head,onRestore:restore,onRetry:retry,onCancel:()=>stage==='import'?controller?.abort():cancelPrepare(),onExport:api.artifact?exportArtifact:undefined,onImport:api.artifact?importArtifact:undefined,onContentMount:root=>bind(false,root)};
      if(workbenchHost!==container){workbenchHandle?.dispose();workbenchHost=container;workbenchHandle=workbenchFactory(container,props);}else workbenchHandle.update(props);return;
    }
    const next=html();if(rendered.get(container)!==next){container.innerHTML=next;bind(false);}
  }
  function applyArtifact(result){if(result.artifact&&now()?.branch?.dynamic)now().branch.dynamic.artifact=result.artifact;}
  async function hydrate(){const active=now();if(!api.artifact||!active?.session||active.session.mode!=='real'||api.uiContext?.().readingHistorical)return;
    const key=scopeKey(active);if(hydrated.has(key))return;if(hydrating.has(key))return hydrating.get(key);
    const task=(async()=>{try{await api.ensure(active.session);if(!sameScope(key))return;const result=await api.artifact.read({sessionId:active.session.id,branchId:active.branch.id});if(!sameScope(key)||running)return;api.install(active.session,result.authoritativeBranch,result.world);applyArtifact(result);hydrated.add(key);api.save();}catch(e){if(sameScope(key)){failure={scope:key,message:e.message};hydrated.add(key);}}finally{hydrating.delete(key);mount();}})();hydrating.set(key,task);return task;
  }
  async function flushState(){await stateWrites.catch(()=>{});const failed=stateFailures.get(stateScope());if(failed)throw new Error(failed.message);}
  async function exportArtifact(){try{await flushState();const {session,branch}=now(),archive=await api.artifact.export({sessionId:session.id,branchId:branch.id});api.download?.((branch.dynamic?.definition?.title??'交互作品')+'.artifact.json',JSON.stringify(archive,null,2),'application/json');}catch(e){api.toast(e.message);}}
  async function importArtifact(file){if(running||!api.ready())return;const active=now(),scope=scopeKey(active),job=new AbortController();try{if(file.size>10*1024*1024)throw new Error('作品文件不能超过 10 MB。');await flushState();const archive=JSON.parse(await file.text()),meta=artifactMetadata();running=true;stage='import';controller=job;progressStage='checking';mount();
    const result=await api.artifact.import({sessionId:active.session.id,branchId:active.branch.id,requestId:crypto.randomUUID(),expectedHead:meta?.head??null,expectedStateRevision:meta?.stateRevision??0,archive},job.signal);if(!sameScope(scope)||job.signal.aborted)return;api.install(active.session,result.authoritativeBranch,result.world);applyArtifact(result);failure=null;api.save();api.refresh();
  }catch(e){if(!job.signal.aborted&&sameScope(scope))failure={scope,message:e.message};}finally{if(controller===job){running=false;stage=null;controller=null;mount();}}}
  async function retry(){const active=now(),key=stateScope(),failed=stateFailures.get(key);if(!failed)return prepare(true);const scope=scopeKey(active),originalFailure=failure;let expectedHead=artifactMetadata()?.head;
    const currentRetry=()=>sameScope(scope)&&artifactMetadata()?.head===expectedHead&&stateFailures.get(key)===failed;
    try{const result=await api.artifact.read({sessionId:active.session.id,branchId:active.branch.id});if(!currentRetry())return;active.branch.artifactDraftConflict=failed;api.install(active.session,result.authoritativeBranch,result.world);applyArtifact(result);expectedHead=result.artifact?.head;
    if(result.artifact?.head===failed.head){const saved=await api.artifact.state({sessionId:active.session.id,branchId:active.branch.id,artifactId:result.artifact.artifactId,revisionId:result.artifact.head,expectedStateRevision:result.artifact.stateRevision,state:failed.state});if(!currentRetry())return;applyArtifact(saved);if(active.branch.artifactDraftConflict===failed)delete active.branch.artifactDraftConflict;}
    if(!currentRetry())return;stateFailures.delete(key);if(failure===originalFailure)failure=null;api.save();api.refresh();mount();
  }catch(e){if(currentRetry()){failure={scope,message:e.message};mount();}}}
  async function restore(revisionId){if(running||!api.ready()||!api.artifact)return;const active=now(),scope=scopeKey(active);try{await flushState();const meta=artifactMetadata();const result=await api.artifact.restore({sessionId:active.session.id,branchId:active.branch.id,revisionId,expectedHead:meta.head,expectedStateRevision:meta.stateRevision,requestId:crypto.randomUUID()});if(!sameScope(scope))return;api.install(active.session,result.authoritativeBranch,result.world);applyArtifact(result);failure=null;api.save();api.refresh();mount();}catch(e){if(sameScope(scope)){failure={scope,message:e.message};mount();}}}
  function cancelPrepare(){const pending=retryTimer?.scope;clearRetry();if(pending)attempted.add(pending);if(stage!=='prepare')return;const scope=jobScope?.key;if(scope)attempted.add(scope);controller?.abort();running=false;controller=null;stage=null;jobScope=null;mount();}
  async function run(kind,body,{auto=false,key:scope}={}){
    if(kind!=='prepare')cancelPrepare();
    if(running||!api.ready())return;
    const {session,branch}=now(),sid=session.id,bid=branch.id,job=new AbortController(),before=kind==='prepare'?source(now()):null;
    running=true;stage=kind;controller=job;jobScope={sid,bid,version:body.baseVersion,key:scope,foreground:!!body.retry};mount();let prepareFailure='';
    try{
      await api.ensure(session,job.signal);
      if(job.signal.aborted||controller!==job||now()?.session?.id!==sid||now()?.branch?.id!==bid)return;
      if(kind==='prepare'&&(now().state.version!==body.baseVersion||source(now())!==before))return;
      const result=kind==='prepare'&&api.artifact?await api.artifact.prepare(body,job.signal,event=>{if(controller===job){progressStage=event.stage??progressStage;mount();}}):await api.request('/api/interaction/'+kind,body,job.signal);
      if(job.signal.aborted||controller!==job||now()?.session?.id!==sid||now()?.branch?.id!==bid)return;
      if(kind==='prepare'&&(now().state.version!==body.baseVersion||source(now())!==before))return;
      api.install(session,result.authoritativeBranch,result.world);applyArtifact(result);api.save();api.refresh();
      if(kind==='prepare'){prepareFailure=result.authoritativeBranch?.dynamic?.reason||'';failure=prepareFailure?{scope,message:prepareFailure}:null;if(!prepareFailure)attempted.add(scope);}
      return result;
    }catch(e){if(!job.signal.aborted&&controller===job&&!['PREPARATION_SUPERSEDED','VERSION_CONFLICT'].includes(e.code)){if(kind==='prepare'){prepareFailure=e.message||'请稍后重试。';failure={scope,message:prepareFailure};}else api.toast(e.message);}return {error:e};}
    finally{
      if(controller===job){running=false;controller=null;stage=null;jobScope=null;mount();
        if(kind==='prepare'&&auto&&prepareFailure&&(autoAttempts.get(scope)??0)<2&&sameScope(scope)&&!attempted.has(scope)){
          clearRetry();const id=(api.schedule??setTimeout)(()=>{retryTimer=null;if(sameScope(scope))prepare(false,undefined,true);},800);retryTimer={id,scope};
        }
        if(now()?.session?.id!==sid||now()?.branch?.id!==bid)queueMicrotask(()=>prepare());}
    }
  }
  async function prepare(force=false,intent,scheduled=false,inputRouting=false){
    if(api.artifact){await hydrate();try{await flushState();}catch(e){api.toast(e.message);return {error:e};}}
    const active=now();if(!active?.session||!api.ready()||api.uiContext?.().readingHistorical)return;
    const scope=scopeKey(active);if(retryTimer?.scope!==scope||force)clearRetry();
    if(running&&stage==='prepare'&&(force||jobScope.key!==scope))cancelPrepare();
    if(running)return;
    if(active.session.mode!=='real'){if(force)api.toast('智能交互需要真实模型故事；演示中仍可从 + 查看已知资料。');return;}
    const {session,branch,state}=active;if(branch.turns.at(-1)?.operation&&branch.turns.at(-1).narration?.status!=='complete')return;
    const saved=branch.dynamic,savedCurrent=saved?.promptVersion===DYNAMIC_PROMPT_VERSION&&saved?.scope.sessionId===session.id&&saved?.scope.baseVersion===state.version&&saved?.scope.branchId===branch.id&&saved?.scope.worldKey===branch.worldKey;
    if(!force&&(attempted.has(scope)||retryTimer&&!scheduled||!saved?.reason&&savedCurrent||(autoAttempts.get(scope)??0)>=2))return;
    if(!force)autoAttempts.set(scope,(autoAttempts.get(scope)??0)+1);
    const artifact=current()?artifacts.context():null;
    const metadata=artifactMetadata();progressStage=inputRouting?'understanding':'preparing';
    return run('prepare',{sessionId:session.id,branchId:branch.id,baseVersion:state.version,...(api.artifact?{requestId:crypto.randomUUID(),expectedHead:metadata?.head??null,expectedStateRevision:metadata?.stateRevision??0,inputRouting}:{}),ui:{...api.uiContext?.(),...(artifact?{artifact}:{})},...(force?{retry:true,intent:(intent??branch.draft??'').slice(0,2000)}:{})},{auto:!force,key:scope});
  }
  async function narrate(operationId){const {session,branch}=now();await run('narrate',{sessionId:session.id,branchId:branch.id,operationId});await prepare();}
  function bind(auto=true,contentRoot=null){const root=contentRoot??document.querySelector('[data-reader-live="dynamic"]');if(!root)return;
    if(!contentRoot&&api.artifact&&now()?.session?.mode==='real'&&!hydrated.has(scopeKey(now()))&&!running){hydrate().then(()=>{if(auto)prepare();});return;}
    if(!contentRoot&&workbenchFactory){mount();if(auto)queueMicrotask(()=>prepare());return;}ensureWorkbench();rendered.set(root,html(!!contentRoot));root.querySelector('[data-dynamic-cancel]')?.addEventListener('click',cancelPrepare,{once:true});
    artifacts.bind(root);
    root.querySelector('[data-dynamic-retry]')?.addEventListener('click',()=>prepare(true),{once:true});
    const bindRich=()=>bindRichControls(root,{ready:()=>!busy()&&api.ready()&&current(),draft:text=>api.draft?.(text),toast:api.toast,presentation:presentation()});bindRich();
    root.querySelector('[data-dynamic-narrate]')?.addEventListener('click',e=>narrate(e.currentTarget.dataset.dynamicNarrate),{once:true});
    if(current()&&root.querySelector('details.dynamic-interaction')){
      const {session,branch,state}=now(),d=branch.dynamic.definition;
      // Compare rendered templates, since the live iframe adds its own src and height.
      const template=document.createElement('div');template.innerHTML=rendered.get(root);const valuesMarkup=template.querySelector('[data-dynamic-values]')?.innerHTML;
      function preview(){const local=draft(),out=root.querySelector('[data-dynamic-preview]');if(!out)return;const lines=[];for(const a of d.actions.filter(a=>a.mode==='rule')){try{const receipt=resolveDynamic(state,d,dynamicRequest(session,branch,a,local.params));lines.push('预览 · '+receipt.result+'；'+receipt.changes.map(c=>state.game.entities.find(e=>e.id===c.entityId).name+' '+c.before+' → '+c.after).join('，'));}catch(e){lines.push(e.message);}}out.textContent=[...new Set(lines)].join('\n');}
      function refreshConditional(local){
        const temp=document.createElement('div');temp.innerHTML=dynamicView(d,state,local.params,local.step,{busy:busy(),closed:local.closed});
        const nextValues=temp.querySelector('[data-dynamic-values]');if(nextValues&&nextValues.innerHTML!==valuesMarkup)root.querySelector('[data-dynamic-values]')?.replaceWith(nextValues);
        const oldFields=root.querySelector('.dynamic-fields'),newFields=temp.querySelector('.dynamic-fields');
        if(oldFields&&newFields){
          const oldById=new Map([...oldFields.children].map(label=>[label.querySelector('[data-dynamic-field]')?.dataset.dynamicField,label]));
          const wanted=[...newFields.children].map(label=>({id:label.querySelector('[data-dynamic-field]')?.dataset.dynamicField,label}));
          const ids=new Set(wanted.map(item=>item.id));for(const [id,label] of oldById)if(!ids.has(id))label.remove();
          let anchor=null;for(const item of wanted.reverse()){const existing=oldById.get(item.id);if(existing)anchor=existing;else{oldFields.insertBefore(item.label,anchor);anchor=item.label;}}
        }
        const oldStep=root.querySelector('[data-dynamic-step]'),newStep=temp.querySelector('[data-dynamic-step]');if(oldStep&&newStep)oldStep.replaceWith(newStep);else if(oldStep&&!newStep)oldStep.remove();else if(newStep)root.querySelector('[data-dynamic-values]')?.after(newStep);
        root.querySelector('.dynamic-row')?.replaceWith(temp.querySelector('.dynamic-row'));
        bind(false,contentRoot);
      }
      for(const field of root.querySelectorAll('[data-dynamic-field]')){field.oninput=()=>{const local=draft(),f=d.fields.find(f=>f.id===field.dataset.dynamicField);if(f.type==='number'&&field.value==='')delete local.params[f.id];else local.params[f.id]=f.type==='number'?Number(field.value):f.type==='boolean'?field.checked:f.type==='multiple'?[...field.selectedOptions].map(o=>o.value):field.value;try{const visible=d.steps.filter(s=>conditionVisible(s.when,{...publicContext(state),params:local.params}));local.step=Math.min(local.step,Math.max(0,visible.length-1));remember(local);refreshConditional(local);}catch(e){api.toast(e.message);}};}
      root.querySelector('details.dynamic-interaction').ontoggle=e=>{const local=draft();if(local.closed===!e.target.open)return;local.closed=!e.target.open;remember(local);};
      for(const button of root.querySelectorAll('[data-dynamic-nav]'))button.onclick=()=>{try{const local=draft(),steps=d.steps.filter(s=>conditionVisible(s.when,{...publicContext(state),params:local.params})),step=steps[local.step];if(Number(button.dataset.dynamicNav)>0){const subset={...d,fields:d.fields.filter(f=>step.fields.includes(f.id))};validateParams(subset,Object.fromEntries(Object.entries(local.params).filter(([k])=>step.fields.includes(k))),{...publicContext(state),params:local.params});if(step.validate!==undefined&&expression(step.validate,{...publicContext(state),params:local.params})!==true)throw new Error('这一步的输入不符合条件。');}local.step=Math.max(0,local.step+Number(button.dataset.dynamicNav));remember(local);mount();root.querySelector('input,select,button')?.focus({preventScroll:true});}catch(e){api.toast(e.message);}};
      for(const button of root.querySelectorAll('[data-dynamic-action]'))button.onclick=async()=>{try{const local=draft(),action=d.actions.find(a=>a.id===button.dataset.dynamicAction);validateParams(d,local.params,publicContext(state));if(action.mode==='attempt'){api.send('我尝试：'+action.label+'。输入：'+JSON.stringify(local.params),dynamicRequest(session,branch,action,local.params));return;}const request=local.pending??dynamicRequest(session,branch,action,local.params);if(request.actionId!==action.id||JSON.stringify(request.params)!==JSON.stringify(local.params))throw new Error('上次行动结果尚待恢复，请先恢复进度。');local.pending=request;remember(local);const result=await run('execute',request);if(result?.operationId)await narrate(result.operationId);else if(['INVALID_INTERACTION','VERSION_CONFLICT'].includes(result?.error?.code)){delete local.pending;remember(local);}}catch(e){api.toast(e.message);}};
      preview();
    }
    if(auto)queueMicrotask(()=>prepare());
  }
  return {html,bind,refresh:mount,prepare,route:intent=>prepare(true,intent,false,true),narrate,cancelPrepare,cancel:()=>{if(stage==='prepare'||retryTimer)cancelPrepare();else controller?.abort();},busy,hasPresentation:()=>!!current()};
}
