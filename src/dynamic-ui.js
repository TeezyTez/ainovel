import {DYNAMIC_PROMPT_VERSION,expression,publicContext,resolveDynamic,validateParams,conditionVisible,fieldVisible} from './dynamic-rules.js';
import {renderRichView} from './rich-interaction-view.js';
import {bindRichControls} from './rich-interaction-controls.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=v=>Array.isArray(v)?v.map(plain).join('、'):v&&typeof v==='object'?JSON.stringify(v):v??'';
export function dynamicRequest(session,branch,action,params,requestId=crypto.randomUUID()){
  const saved=branch.dynamic,d=saved.definition;return {sessionId:session.id,branchId:branch.id,requestId,scope:d.scope,interactionId:d.id,revision:d.revision,definitionDigest:saved.digest,actionId:action.id,targets:action.targets,params};
}
export function dynamicView(d,state,params,step=0,{busy=false,closed=false}={}){
  const context={...publicContext(state),params},budget={left:2000};let count=0;
  function node(n,ctx,path){if(count>=1000)return '';try{return renderNode(n,ctx,path);}catch{return '<p class="small muted">这部分暂时无法显示；请补全输入，或重新整理。</p>';}}
  function renderNode(n,ctx,path){if(++count>1000)throw new Error('显示内容超过限制。');if(n.when!==undefined&&!expression(n.when,ctx,budget))return '';const value=x=>expression(x,ctx,budget);
    // Presentation identity follows the definition, independent of which siblings render.
    const rich=renderRichView(n,{value,esc,plain,index:d.scope.branchId+'-'+d.scope.baseVersion+'-'+d.id+'-'+path,busy,omitTitle:!n.title||n.title===d.title,omitCaption:n.caption===d.summary});if(rich!==null)return rich;
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
  return `<details class="dynamic-interaction" ${closed?'':'open'}><summary>${esc(d.title)}</summary>${d.summary?`<p>${esc(d.summary)}</p>`:''}<div data-dynamic-values>${views}</div>${current?`<p class="small">${index+1} / ${steps.length} · ${esc(current.title)}</p>`:''}<div class="dynamic-fields">${d.fields.filter(f=>(!current||current.fields.includes(f.id))&&fieldVisible(d,f,context)).map(field).join('')}</div><div data-dynamic-preview role="status"></div><div class="dynamic-row">${index>0?'<button type="button" class="btn" data-dynamic-nav="-1">上一步</button>':''}${!last?'<button type="button" class="btn" data-dynamic-nav="1">下一步 · 准备</button>':d.actions.map(a=>`<button type="button" class="btn" data-dynamic-action="${esc(a.id)}" ${busy?'disabled':''}>${a.mode==='attempt'?'尝试 · ':''}${esc(a.label)}</button>`).join('')}</div>${d.fields.length||d.actions.length?'<p class="small muted">选择与预览不会改变故事。也可以在下方自由输入其他做法。</p>':''}</details>`;
}
export function createDynamicControls(api){
  let running=false,controller=null,stage=null,jobScope=null;const attempted=new Set(),presentations=new Map();
  const busy=()=>running&&stage!=='prepare';
  const now=()=>api.active();
  const source=({branch,state})=>JSON.stringify({worldKey:branch.worldKey,opening:branch.opening,state,turns:branch.turns.slice(-3).map(({id,input,prose,narration})=>({id,input,prose,narration}))});
  const key=()=>{const {session,branch}=now();return 'elselife:interaction-draft:'+session.id+':'+branch.id+':'+branch.dynamic?.digest;};
  function draft(){try{const saved=now().branch.dynamicDraft;const old=saved?.digest===now().branch.dynamic?.digest?saved:JSON.parse(api.storage.getItem(key())||'null');if(old)return old;}catch{}const d=now().branch.dynamic.definition;return {params:Object.fromEntries(d.fields.filter(f=>f.default!==undefined).map(f=>[f.id,f.default])),step:0,closed:false};}
  const remember=d=>{const branch=now().branch,previous=branch.dynamicDraft;if(previous&&previous.digest!==branch.dynamic?.digest){branch.dynamicDraftHistory??={};branch.dynamicDraftHistory[previous.digest]=previous;}now().branch.dynamicDraft={...d,digest:now().branch.dynamic?.digest,interactionId:now().branch.dynamic?.definition?.id,labels:Object.fromEntries(now().branch.dynamic.definition.fields.map(f=>[f.id,f.label]))};api.storage.setItem(key(),JSON.stringify(d));api.save();};
  function current(){const {session,branch,state}=now();return branch?.dynamic?.promptVersion===DYNAMIC_PROMPT_VERSION&&branch.dynamic.definition&&branch.dynamic.scope.sessionId===session.id&&branch.dynamic.scope.baseVersion===state.version&&branch.dynamic.scope.branchId===branch.id&&branch.dynamic.scope.worldKey===branch.worldKey;}
  function presentation(){
    if(!current())return {};
    const {session,branch}=now(),id=JSON.stringify([session.id,branch.id,branch.dynamic.digest]);
    if(!presentations.has(id))presentations.set(id,{});
    const saved=presentations.get(id);presentations.delete(id);presentations.set(id,saved);
    while(presentations.size>12)presentations.delete(presentations.keys().next().value);
    return saved;
  }
  function html(){
    const active=now();if(!active?.session||api.uiContext?.().readingHistorical)return '';
    const {branch,state}=active,op=branch.turns.at(-1);
    if(op?.operation&&op.narration?.status!=='complete')return `<section class="dynamic-pending"><p role="status">行动结果已保存。${esc(op.narration?.error||'正文正在等待续写。')}</p><button type="button" class="btn" data-dynamic-narrate="${esc(op.id)}" ${running?'disabled':''}>${running?'正在续写…':'续写这次结果'}</button></section>`;
    const status=running&&stage==='prepare'&&jobScope?.foreground?'<p class="dynamic-preparing" role="status"><span>正在整理这份资料</span><button type="button" class="dynamic-prepare-cancel" data-dynamic-cancel aria-label="停止整理线索" title="停止整理线索">×</button></p>':'';
    if(!current())return status;
    try{
      const d=draft(),previous=branch.dynamicDraft,retained=previous&&previous.digest!==branch.dynamic.digest?'<details class="dynamic-operation-record"><summary>上次未提交的输入已保留</summary><p>'+Object.entries(previous.params||{}).map(([k,v])=>esc((previous.labels?.[k]||k)+'：'+plain(v))).join('；')+'</p></details>':'';
      return status+retained+dynamicView(branch.dynamic.definition,state,d.params,d.step,{busy:busy(),closed:d.closed});
    }catch{return status+'<p>辅助交互无法显示，输入仍可使用。</p>';}
  }
  function mount(){const container=document.querySelector('[data-reader-live="dynamic"]');if(container){container.innerHTML=html();bind(false);}}
  function cancelPrepare(){if(stage!=='prepare')return;controller?.abort();running=false;controller=null;stage=null;jobScope=null;mount();}
  async function run(kind,body){
    if(kind!=='prepare')cancelPrepare();
    if(running||!api.ready())return;
    const {session,branch}=now(),sid=session.id,bid=branch.id,job=new AbortController(),before=kind==='prepare'?source(now()):null;
    running=true;stage=kind;controller=job;jobScope={sid,bid,version:body.baseVersion,foreground:!!body.retry};mount();
    try{
      await api.ensure(session,job.signal);
      if(job.signal.aborted||controller!==job||now()?.session?.id!==sid||now()?.branch?.id!==bid)return;
      if(kind==='prepare'&&(now().state.version!==body.baseVersion||source(now())!==before))return;
      const result=await api.request('/api/interaction/'+kind,body,job.signal);
      if(job.signal.aborted||controller!==job||now()?.session?.id!==sid||now()?.branch?.id!==bid)return;
      if(kind==='prepare'&&(now().state.version!==body.baseVersion||source(now())!==before))return;
      api.install(session,result.authoritativeBranch,result.world);api.save();api.refresh();return result;
    }catch(e){if(!job.signal.aborted&&controller===job&&(kind!=='prepare'||body.retry)&&!['PREPARATION_SUPERSEDED','VERSION_CONFLICT'].includes(e.code))api.toast(e.message);return {error:e};}
    finally{
      if(controller===job){running=false;controller=null;stage=null;jobScope=null;mount();
        if(now()?.session?.id!==sid||now()?.branch?.id!==bid)queueMicrotask(()=>prepare());}
    }
  }
  async function prepare(force=false,intent){
    const active=now();if(!active?.session||!api.ready()||api.uiContext?.().readingHistorical)return;
    if(running&&stage==='prepare'&&(force||jobScope.sid!==active.session.id||jobScope.bid!==active.branch.id||jobScope.version!==active.state.version))cancelPrepare();
    if(running)return;
    if(active.session.mode!=='real'){if(force)api.toast('智能交互需要真实模型故事；演示中仍可从 + 查看已知资料。');return;}
    const {session,branch,state}=active;if(branch.turns.at(-1)?.operation&&branch.turns.at(-1).narration?.status!=='complete')return;
    const scope=session.id+':'+branch.id+':'+state.version;
    if(!force&&(attempted.has(scope)||(branch.dynamic?.promptVersion===DYNAMIC_PROMPT_VERSION&&branch.dynamic?.scope.sessionId===session.id&&branch.dynamic?.scope.baseVersion===state.version&&branch.dynamic?.scope.branchId===branch.id)))return;
    attempted.add(scope);
    return run('prepare',{sessionId:session.id,branchId:branch.id,baseVersion:state.version,ui:api.uiContext?.(),...(force?{retry:true,intent:(intent??branch.draft??'').slice(0,2000)}:{})});
  }
  async function narrate(operationId){const {session,branch}=now();await run('narrate',{sessionId:session.id,branchId:branch.id,operationId});await prepare();}
  function bind(auto=true){const root=document.querySelector('[data-reader-live="dynamic"]');if(!root)return;root.querySelector('[data-dynamic-cancel]')?.addEventListener('click',cancelPrepare,{once:true});
    root.querySelector('[data-dynamic-retry]')?.addEventListener('click',()=>prepare(true),{once:true});
    const bindRich=()=>bindRichControls(root,{ready:()=>!busy()&&api.ready()&&current(),draft:text=>api.draft?.(text),toast:api.toast,presentation:presentation()});bindRich();
    root.querySelector('[data-dynamic-narrate]')?.addEventListener('click',e=>narrate(e.currentTarget.dataset.dynamicNarrate),{once:true});
    if(current()&&root.querySelector('details.dynamic-interaction')){
      const {session,branch,state}=now(),d=branch.dynamic.definition;
      function preview(){const local=draft(),out=root.querySelector('[data-dynamic-preview]');if(!out)return;const lines=[];for(const a of d.actions.filter(a=>a.mode==='rule')){try{const receipt=resolveDynamic(state,d,dynamicRequest(session,branch,a,local.params));lines.push('预览 · '+receipt.result+'；'+receipt.changes.map(c=>state.game.entities.find(e=>e.id===c.entityId).name+' '+c.before+' → '+c.after).join('，'));}catch(e){lines.push(e.message);}}out.textContent=[...new Set(lines)].join('\n');}
      for(const field of root.querySelectorAll('[data-dynamic-field]')){field.oninput=()=>{const local=draft(),f=d.fields.find(f=>f.id===field.dataset.dynamicField);if(f.type==='number'&&field.value==='')delete local.params[f.id];else local.params[f.id]=f.type==='number'?Number(field.value):f.type==='boolean'?field.checked:f.type==='multiple'?[...field.selectedOptions].map(o=>o.value):field.value;try{remember(local);preview();}catch(e){api.toast(e.message);}};field.onchange=()=>{const local=draft(),temp=document.createElement('div');temp.innerHTML=dynamicView(d,state,local.params,local.step);root.querySelector('[data-dynamic-values]')?.replaceWith(temp.querySelector('[data-dynamic-values]'));bindRich();};}
      root.querySelector('details.dynamic-interaction').ontoggle=e=>{const local=draft();if(local.closed===!e.target.open)return;local.closed=!e.target.open;remember(local);};
      for(const button of root.querySelectorAll('[data-dynamic-nav]'))button.onclick=()=>{try{const local=draft(),steps=d.steps.filter(s=>conditionVisible(s.when,{...publicContext(state),params:local.params})),step=steps[local.step];if(Number(button.dataset.dynamicNav)>0){const subset={...d,fields:d.fields.filter(f=>step.fields.includes(f.id))};validateParams(subset,Object.fromEntries(Object.entries(local.params).filter(([k])=>step.fields.includes(k))),{...publicContext(state),params:local.params});if(step.validate!==undefined&&expression(step.validate,{...publicContext(state),params:local.params})!==true)throw new Error('这一步的输入不符合条件。');}local.step=Math.max(0,local.step+Number(button.dataset.dynamicNav));remember(local);mount();root.querySelector('input,select,button')?.focus({preventScroll:true});}catch(e){api.toast(e.message);}};
      for(const button of root.querySelectorAll('[data-dynamic-action]'))button.onclick=async()=>{try{const local=draft(),action=d.actions.find(a=>a.id===button.dataset.dynamicAction);validateParams(d,local.params,publicContext(state));if(action.mode==='attempt'){api.send('我尝试：'+action.label+'。输入：'+JSON.stringify(local.params),dynamicRequest(session,branch,action,local.params));return;}const request=local.pending??dynamicRequest(session,branch,action,local.params);if(request.actionId!==action.id||JSON.stringify(request.params)!==JSON.stringify(local.params))throw new Error('上次行动结果尚待恢复，请先恢复进度。');local.pending=request;remember(local);const result=await run('execute',request);if(result?.operationId)await narrate(result.operationId);else if(['INVALID_INTERACTION','VERSION_CONFLICT'].includes(result?.error?.code)){delete local.pending;remember(local);}}catch(e){api.toast(e.message);}};
      preview();
    }
    if(auto)queueMicrotask(()=>prepare());
  }
  return {html,bind,prepare,narrate,cancelPrepare,cancel:()=>{if(stage==='prepare')cancelPrepare();else controller?.abort();},busy};
}
