// Formal reader host for the source demo's declarative interaction views.
// The imported source renderers are presentation only here: committed facts,
// deterministic settlement, and route receipts belong to the formal service.
import {dynamicView} from './dynamic-ui.js';
import {canonical,conditionVisible,expression,publicContext,resolveDynamic,validateParams} from './dynamic-rules.js';
import {gameInspectView,gameTurnView} from './game-ui.js';
import {resolveGameAction} from './game-state.js';
import {cleanArtifactState,validateInteractiveView} from './interactive-artifact.js';
import {validateReactArtifact,validateReactBundle} from './react-artifact.js';
import {normalizeTravelView,travelModel,travelView,travelWarnings} from './travel-ui.js';
import {bindRichControls} from './rich-interaction-controls.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const copy=value=>structuredClone(value);
const noSettlement='当前连接尚未提供确定结算；可以在下方自由输入尝试。';
const historical=payload=>payload?.historical===true||payload?.readonly===true;
const deterministic=payload=>payload?.capabilities?.deterministic===true;

export function normalizeAdvancedState(value={},definition=null){
  const raw=object(value),dynamic=object(raw.dynamic);
  const params=copy(object(dynamic.params));
  for(const field of definition?.fields??[])if(field.default!==undefined&&params[field.id]===undefined)params[field.id]=copy(field.default);
  const artifacts={};
  for(const [key,state] of Object.entries(object(raw.artifacts)).slice(0,4)){
    if(!/^[\da-f]{64}$/.test(key))continue;
    try{artifacts[key]=cleanArtifactState(state);}catch{}
  }
  return {
    dynamic:{params,step:Number.isSafeInteger(dynamic.step)&&dynamic.step>=0?dynamic.step:0,closed:dynamic.closed===true},
    travel:normalizeTravelView(raw.travel),
    inspectedId:typeof raw.inspectedId==='string'?raw.inspectedId:'',
    artifacts,
  };
}

export async function artifactDigest(node){
  if(!globalThis.crypto?.subtle)throw new Error('此环境无法校验交互图。');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(node)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function publicState(payload){
  const state=object(payload?.state);
  return Number.isSafeInteger(state.version)&&state.version>=0?state:null;
}

function displayState(payload){
  const state=publicState(payload);
  if(!state)return null;
  // The source game view validates actions against its original rule engine.
  // Disable every deterministic action before it reaches that renderer.
  const shown=copy(state);
  if(shown.game?.surfaces)for(const surface of shown.game.surfaces){
    for(const action of surface.actions??[]){
      if((action.mode==='apply'?!deterministic(payload):payload.capabilities?.attempt!==true)||historical(payload)||payload.busy)
        action.disabledReason=action.disabledReason||noSettlement;
    }
  }
  return shown;
}

function rulePreview(definition,state,params,branchId){
  const lines=[];
  for(const action of definition.actions??[]){
    if(action.mode!=='rule')continue;
    try{
      const receipt=resolveDynamic(state,definition,{
        sessionId:definition.scope?.sessionId,
        branchId,
        scope:definition.scope,
        interactionId:definition.id,
        revision:definition.revision,
        actionId:action.id,
        targets:action.targets,
        params,
      });
      const changes=(receipt.changes??[]).map(change=>{
        const entity=state.game?.entities?.find(e=>e.id===change.entityId);
        return `${entity?.name??'已知记录'} ${change.before} → ${change.after}`;
      });
      lines.push(`预览 · ${receipt.result}${changes.length?'；'+changes.join('，'):''}`);
    }catch(error){lines.push(error.message);}
  }
  return [...new Set(lines)].join('\n');
}

/// Returns source-demo markup without mutating the authoritative projection.
export function advancedMarkup(payload,viewState={}){
  const state=publicState(payload),local=normalizeAdvancedState(viewState,payload?.definition);
  if(!state)return '<p class="rich-empty" role="status">当前没有可展示的公开互动资料。</p>';
  const readonly=historical(payload),busy=payload.busy===true;
  const branchId=typeof payload.branchId==='string'?payload.branchId:'';
  const shown=displayState(payload),parts=[];
  // The demo's reading-ui suppresses gameTurnView while a dynamic work is
  // present. Travel belongs to its own map surface, never below the work.
  const panel=payload.panel==='all'||payload.panel==null
    ?payload.definition?'dynamic':'game':payload.panel;
  if(payload.definition&&panel==='dynamic'){
    try{
      const definition=payload.definition;
      const dynamic=dynamicView(definition,state,local.dynamic.params,local.dynamic.step,{busy,closed:local.dynamic.closed,historical:readonly});
      const preview=rulePreview(definition,state,local.dynamic.params,branchId);
      parts.push(`<section class="reader-advanced-dynamic">${dynamic.replace('<div data-dynamic-preview role="status"></div>',`<div data-dynamic-preview role="status">${esc(preview)}</div>`)}${!deterministic(payload)&&definition.actions?.some(action=>action.mode!=='attempt')?`<p class="small muted">${esc(noSettlement)}</p>`:''}</section>`);
    }catch(error){parts.push(`<p class="rich-empty" role="status">互动定义暂时无法显示：${esc(error.message)}</p>`);}
  }
  if(panel==='game'){
    const turn={id:payload.turnId??'current',input:payload.input??'',prose:payload.prose??'',state:shown};
    parts.push(`<section class="reader-advanced-game">${gameTurnView(turn,{currentVersion:state.version,branchId,busy,ended:payload.ended===true,density:payload.density??'adaptive'})}</section>`);
    if(local.inspectedId){
      const entity=shown.game?.entities?.find(item=>item.id===local.inspectedId);
      if(entity)parts.push(`<div class="reader-advanced-inspect"><button type="button" class="btn compact" data-advanced-close-inspect>返回资料</button>${gameInspectView(entity,shown.game,{node:turn.id})}</div>`);
    }
  }
  if(panel==='travel'){
    try{
      const situation={objects:state.experience?.objects??[]};
      const model=travelModel(state,situation,local.travel,{branchId,busy,historical:readonly});
      const rendered=travelView(model);
      // Route facts and estimates remain visible, but departure is a model
      // attempt in this formal stack, never the source's local settlement.
      parts.push(`<section class="reader-advanced-travel">${deterministic(payload)?rendered:rendered.replaceAll(/(<button[^>]*data-action="travel-depart"[^>]*>)([^<]*)(<\/button>)/g,(_all,open,_label,close)=>`${open}尝试出发${close}`)}${deterministic(payload)?'':'<p class="small muted">路线资料仅供参考；出发结果由后续故事确认。</p>'}</section>`);
    }catch(error){parts.push(`<p class="rich-empty" role="status">地图暂时无法显示：${esc(error.message)}</p>`);}
  }
  return parts.join('')||'<p class="rich-empty">当前没有可展示的互动资料。</p>';
}

export function renderAdvanced(root,payload,{onAction,onExecute,onState,onDraft,onRepair,onCurrentMap,onOpenMap,onInspectKind}={}){
  if(!root||typeof root.addEventListener!=='function')throw new TypeError('需要可挂载的阅读界面元素');
  let current=payload,local=normalizeAdvancedState(payload?.localState??payload?.viewState,payload?.definition),disposed=false;
  const presentation={views:Object.create(null)};
  const sourceKey=value=>JSON.stringify([value?.branchId,value?.state?.version,value?.definitionDigest,value?.definition?.id,value?.definition?.revision]);
  const controller=new AbortController(),signal=controller.signal;
  const frames=new Map(),repaired=new Set();let generation=0;
  const travelPointers=new Map();let travelOrigin=null,travelPinch=null,travelMoved=false;
  const notice=message=>{const out=root.querySelector('[data-advanced-notice]');if(out)out.textContent=message;};
  const repair=reason=>{
    if(historical(current)||current.busy||typeof onRepair!=='function')return;
    try{Promise.resolve(onRepair(reason)).catch(error=>notice(error.message));}
    catch(error){notice(error.message);}
  };
  const fail=(entry,error,{automatic=true}={})=>{
    if(disposed||entry.failed||!entry.holder.isConnected)return;
    entry.failed=true;clearTimeout(entry.timer);
    entry.status.textContent='交互图暂时无法使用，已保留当前输入。';
    entry.frame.remove();frames.delete(entry.frame);
    if(typeof onRepair==='function'&&!historical(current)){
      entry.repair.hidden=false;
      entry.holder.dataset.artifactRepairReason='修复当前交互图，保留原任务与已有局部输入。';
      // The source runtime retries once per current scene, not once per node:
      // several broken views must never start concurrent model preparations.
      const key=sourceKey(current);
      if(automatic&&!repaired.has(key)&&!current.busy){repaired.add(key);repair(entry.holder.dataset.artifactRepairReason);}
    }
    if(error)entry.status.title=String(error).slice(0,500);
  };
  const persist=()=>{
    if(!onState||historical(current))return;
    try{Promise.resolve(onState(copy(local))).catch(error=>notice(`展示设置未保存：${error.message}`));}
    catch(error){notice(`展示设置未保存：${error.message}`);}
  };
  const refresh=()=>{
    if(disposed)return;
    generation++;travelPointers.clear();travelOrigin=null;travelPinch=null;
    for(const entry of frames.values())clearTimeout(entry.timer);frames.clear();
    root.innerHTML=`${advancedMarkup(current,local)}<p class="reader-advanced-notice" data-advanced-notice role="status"></p>`;
    const definition=current.definition;
    for(const button of root.querySelectorAll('[data-dynamic-action]')){
      const action=definition?.actions?.find(item=>item.id===button.dataset.dynamicAction);
      if(historical(current)||current.busy||!action||(action.mode==='rule'?!deterministic(current):current.capabilities?.attempt!==true)){
        button.disabled=true;
        button.title=action?.mode==='attempt'?'当前无法推进故事':noSettlement;
      }
    }
    for(const field of root.querySelectorAll('[data-dynamic-field]')){
      if(historical(current))field.disabled=true;
    }
    for(const button of root.querySelectorAll('[data-rich-draft]')){
      if(historical(current)||current.busy||typeof onDraft!=='function'){
        button.disabled=true;button.title='当前只能查看这份作品。';
      }
    }
    for(const button of root.querySelectorAll('[data-action="travel-depart"]')){
      if(historical(current)||current.busy||!(deterministic(current)||current.capabilities?.attempt===true))button.disabled=true;
    }
    const canvas=root.querySelector('.reader-advanced-travel .atlas-canvas');
    if(canvas){canvas.dataset.zoom=String(local.travel.zoom);if(local.travel.zoom>1)canvas.style.width=`${local.travel.zoom*100}%`;}
    const viewport=root.querySelector('.reader-advanced-travel .atlas-viewport');
    if(viewport){viewport.scrollLeft=local.travel.scrollLeft;viewport.scrollTop=local.travel.scrollTop;}
    const richRoot=root.querySelector('.reader-advanced-dynamic');
    if(richRoot)bindRichControls(richRoot,{
      ready:()=>!historical(current)&&!current.busy&&typeof onDraft==='function',
      draft:text=>draft(text),toast:notice,presentation,
    });
    void mountArtifacts(generation);
  };
  const mountArtifacts=async version=>{
    for(const holder of root.querySelectorAll('.reader-advanced-dynamic [data-interactive-definition]')){
      const frame=holder.querySelector('iframe'),status=holder.querySelector('[data-artifact-status]'),repairButton=holder.querySelector('[data-artifact-repair]');
      if(!frame||historical(current))continue;
      let validated=false,key='';
      try{
        const node=JSON.parse(holder.dataset.interactiveDefinition);
        if(node.type==='react')validateReactArtifact(node);
        else validateInteractiveView(node);
        validated=true;key=await artifactDigest(node);
        if(disposed||version!==generation||!frame.isConnected)return;
        const executable=node.type==='react'?object(current.bundles)[key]:node;
        if(node.type==='react'){
          if(!executable)throw new Error('这张 React 交互图的构建结果尚未就绪。');
          validateReactBundle(executable);
        }
        const state=cleanArtifactState(local.artifacts[key]??executable.initialState??{});
        const token=[...crypto.getRandomValues(new Uint8Array(18))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        const computed=getComputedStyle(root),theme=Object.fromEntries(['ink','muted','paper','soft','accent','line'].map(name=>[name,computed.getPropertyValue('--'+name).trim()]));
        const entry={key,token,node:executable,state,theme,status,repair:repairButton,holder,frame,failed:false,loaded:false};
        frames.set(frame,entry);
        frame.addEventListener('load',()=>{
          if(entry.failed||disposed||version!==generation)return;
          if(entry.loaded)fail(entry,'交互图发生了不支持的页面跳转。');
          entry.loaded=true;
        },{signal});
        entry.timer=setTimeout(()=>fail(entry,'交互图加载超时，请检查初始化。'),10000);
        frame.src='reader-advanced-artifact-frame.html';
      }catch(error){
        if(validated){
          fail({key,holder,frame,status,repair:repairButton,failed:false,timer:null},error.message);
          continue;
        }
        if(status)status.textContent='交互图格式无效，请重新整理。';
        if(status)status.title=String(error.message).slice(0,500);
        if(repairButton&&typeof onRepair==='function'&&!historical(current)){
          repairButton.hidden=false;holder.dataset.artifactRepairReason='重新生成当前交互图。';
        }
      }
    }
  };
  window.addEventListener('message',event=>{
    const item=[...frames].find(([frame])=>frame.isConnected&&root.contains(frame)&&event.source===frame.contentWindow);
    if(!item)return;
    const [frame,entry]=item,data=event.data;
    if(entry.failed)return;
    if(data?.channel==='story-artifact-shell-ready'){
      frame.contentWindow.postMessage({channel:'story-artifact-init',token:entry.token,node:entry.node,state:entry.state,theme:entry.theme},'*');return;
    }
    if(data?.channel!=='story-artifact'||data.token!==entry.token)return;
    if(data.kind==='height'){
      const height=Number(data.value);if(Number.isFinite(height))frame.style.height=`${Math.max(220,Math.min(1200,height))}px`;
    }else if(data.kind==='ready'){
      clearTimeout(entry.timer);if(entry.status)entry.status.textContent='';
      if(entry.repair)entry.repair.hidden=true;
    }else if(data.kind==='error'){
      fail(entry,String(data.value??'交互图运行失败。'));
    }else if(data.kind==='state'&&!historical(current)){
      try{local.artifacts[entry.key]=cleanArtifactState(data.value);persist();}
      catch(error){if(entry.status)entry.status.textContent=error.message;}
    }else if(data.kind==='draft'&&typeof data.value==='string')draft(data.value);
  },{signal});
  const refreshDynamicConditional=()=>{
    const definition=current.definition,state=publicState(current);
    if(!definition||!state)return;
    const template=document.createElement('div');
    template.innerHTML=dynamicView(definition,state,local.dynamic.params,local.dynamic.step,{busy:current.busy,closed:local.dynamic.closed,historical:historical(current)});
    const previous=root.querySelector('[data-dynamic-values]'),next=template.querySelector('[data-dynamic-values]');
    if(previous&&next&&previous.innerHTML!==next.innerHTML)previous.replaceWith(next);
    const oldFields=root.querySelector('.dynamic-fields'),newFields=template.querySelector('.dynamic-fields');
    if(oldFields&&newFields){
      const byId=new Map([...oldFields.children].map(label=>[label.querySelector('[data-dynamic-field]')?.dataset.dynamicField,label]));
      const wanted=[...newFields.children].map(label=>({id:label.querySelector('[data-dynamic-field]')?.dataset.dynamicField,label}));
      const ids=new Set(wanted.map(item=>item.id));
      for(const [id,label] of byId)if(!ids.has(id))label.remove();
      let anchor=null;
      for(const item of wanted.reverse()){
        const existing=byId.get(item.id);
        if(existing)anchor=existing;
        else{oldFields.insertBefore(item.label,anchor);anchor=item.label;}
      }
    }
    const step=root.querySelector('[data-dynamic-step]'),nextStep=template.querySelector('[data-dynamic-step]');
    if(step&&nextStep)step.replaceWith(nextStep);
    const preview=root.querySelector('[data-dynamic-preview]');
    if(preview)preview.textContent=rulePreview(definition,state,local.dynamic.params,current.branchId);
  };
  const updateLocal=change=>{change(local);persist();refresh();};
  const attempt=request=>{
    if(historical(current)||current.busy||current.capabilities?.attempt!==true||!onAction){notice('当前无法推进故事。');return;}
    try{Promise.resolve(onAction({...request,mode:'attempt',branchId:current.branchId,version:current.state.version}))
      .catch(error=>notice(error.message));}
    catch(error){notice(error.message);}
  };
  const execute=(kind,reference,params={})=>{
    if(historical(current)||current.busy||!deterministic(current)||!onExecute){notice('当前无法执行确定操作。');return;}
    // Game and journey actions are bound to the public state revision and may
    // have no dynamic definition. Only a dynamic rule requires its digest.
    if(typeof current.definitionDigest!=='string'||kind==='dynamic'&&!current.definitionDigest){notice('互动定义尚未就绪，请刷新后重试。');return;}
    try{Promise.resolve(onExecute({kind,reference,params:copy(params),definitionDigest:current.definitionDigest,branchId:current.branchId,version:current.state.version}))
      .catch(error=>notice(error.message));}
    catch(error){notice(error.message);}
  };
  const draft=text=>{
    if(!onDraft||historical(current)||current.busy){notice('当前无法写入行动草稿。');return;}
    try{Promise.resolve(onDraft(text)).catch(error=>notice(error.message));}
    catch(error){notice(error.message);}
  };
  const zoomTravel=(next,{restore=false}={})=>{
    const viewport=root.querySelector('.reader-advanced-travel .atlas-viewport'),canvas=viewport?.querySelector('.atlas-canvas');
    if(!viewport||!canvas)return;
    const old=Number(canvas.dataset.zoom)||1,base=canvas.clientWidth/old||viewport.clientWidth;
    const centerX=canvas.clientWidth?(viewport.scrollLeft+viewport.clientWidth/2)/canvas.clientWidth:0.5;
    const centerY=canvas.clientHeight?(viewport.scrollTop+viewport.clientHeight/2)/canvas.clientHeight:0.5;
    const zoom=Math.max(1,Math.min(3,next));local.travel.zoom=zoom;
    canvas.dataset.zoom=String(zoom);canvas.style.width=zoom===1?'':`${base*zoom}px`;
    viewport.scrollLeft=restore?local.travel.scrollLeft:centerX*canvas.clientWidth-viewport.clientWidth/2;
    viewport.scrollTop=restore?local.travel.scrollTop:centerY*canvas.clientHeight-viewport.clientHeight/2;
    local.travel.scrollLeft=viewport.scrollLeft;local.travel.scrollTop=viewport.scrollTop;persist();
  };
  const zoomSpatial=target=>{
    const map=target.closest('.spatial-atlas'),viewport=map?.querySelector('.atlas-viewport'),canvas=map?.querySelector('.atlas-canvas');
    if(!viewport||!canvas)return;
    const old=Number(canvas.dataset.zoom)||1,base=canvas.clientWidth/old;
    const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/canvas.clientWidth;
    const centerY=(viewport.scrollTop+viewport.clientHeight/2)/canvas.clientHeight;
    const zoom=target.dataset.factor==='reset'?1:Math.max(1,Math.min(3,old*Number(target.dataset.factor)));
    canvas.dataset.zoom=String(zoom);canvas.style.width=zoom===1?'':`${base*zoom}px`;
    viewport.scrollLeft=centerX*canvas.clientWidth-viewport.clientWidth/2;
    viewport.scrollTop=centerY*canvas.clientHeight-viewport.clientHeight/2;
  };
  const navigate=(callback,value)=>{
    if(typeof callback!=='function'){notice('当前无法打开这份资料。');return;}
    try{Promise.resolve(callback(value)).catch(error=>notice(error.message));}
    catch(error){notice(error.message);}
  };
  root.addEventListener('input',event=>{
    const field=event.target.closest?.('[data-dynamic-field]');
    if(!field||!current.definition)return;
    const spec=current.definition.fields?.find(item=>item.id===field.dataset.dynamicField);
    if(!spec)return;
    const value=spec.type==='boolean'?field.checked:spec.type==='multiple'?[...field.selectedOptions].map(option=>option.value):spec.type==='number'&&field.value!==''?Number(field.value):field.value;
    if(spec.type==='number'&&field.value==='')delete local.dynamic.params[spec.id];
    else local.dynamic.params[spec.id]=value;
    const context={...publicContext(current.state),params:local.dynamic.params};
    const steps=current.definition.steps.filter(step=>conditionVisible(step.when,context));
    local.dynamic.step=Math.min(local.dynamic.step,Math.max(0,steps.length-1));
    persist();
    // Match the source's surgical update so blur does not replace a button
    // between pointerdown and click.
    refreshDynamicConditional();
  },{signal});
  root.addEventListener('toggle',event=>{
    if(event.target.matches?.('details.dynamic-interaction')){
      if(local.dynamic.closed===!event.target.open)return;
      local.dynamic.closed=!event.target.open;persist();
    }
  },{signal,capture:true});
  root.addEventListener('scroll',event=>{
    if(!event.target.matches?.('.atlas-viewport'))return;
    local.travel.scrollLeft=event.target.scrollLeft;
    local.travel.scrollTop=event.target.scrollTop;
    persist();
  },{signal,capture:true,passive:true});
  root.addEventListener('pointerdown',event=>{
    const viewport=event.target.closest?.('.reader-advanced-travel .atlas-viewport');
    if(!viewport||event.target.closest('button'))return;
    travelPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    viewport.setPointerCapture?.(event.pointerId);travelMoved=false;
    travelOrigin={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    if(travelPointers.size===2){const [a,b]=[...travelPointers.values()];travelPinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:local.travel.zoom};}
  },{signal});
  root.addEventListener('pointermove',event=>{
    if(!travelPointers.has(event.pointerId))return;
    const viewport=root.querySelector('.reader-advanced-travel .atlas-viewport');if(!viewport)return;
    travelPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(travelPointers.size===2&&travelPinch){
      const [a,b]=[...travelPointers.values()];zoomTravel(travelPinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/(travelPinch.distance||1));travelMoved=true;
    }else if(travelOrigin){
      const dx=event.clientX-travelOrigin.x,dy=event.clientY-travelOrigin.y;
      if(Math.abs(dx)+Math.abs(dy)>5)travelMoved=true;
      viewport.scrollLeft=travelOrigin.left-dx;viewport.scrollTop=travelOrigin.top-dy;
    }
  },{signal});
  const releaseTravel=event=>{
    travelPointers.delete(event.pointerId);
    if(!travelPointers.size){travelOrigin=null;travelPinch=null;persist();}
  };
  root.addEventListener('pointerup',releaseTravel,{signal});
  root.addEventListener('pointercancel',releaseTravel,{signal});
  root.addEventListener('click',event=>{
    const viewport=event.target.closest?.('.reader-advanced-travel .atlas-viewport');
    if(viewport&&!event.target.closest('button')){
      if(travelMoved){travelMoved=false;return;}
      if(local.travel.selectedId)updateLocal(view=>{view.travel.selectedId='';view.travel.routeId='';view.travel.panel='detail';});
      return;
    }
    const target=event.target.closest?.('button');if(!target||target.disabled)return;
    if(target.hasAttribute('data-artifact-repair')){repair(target.closest('[data-interactive-definition]')?.dataset.artifactRepairReason||'重新生成当前交互图。');return;}
    const state=publicState(current),definition=current.definition;
    if(!state)return;
    if(target.hasAttribute('data-advanced-close-inspect')){updateLocal(view=>view.inspectedId='');return;}
    if(target.dataset.dynamicNav!==undefined&&definition){
      const delta=Number(target.dataset.dynamicNav),context={...publicContext(state),params:local.dynamic.params};
      const steps=definition.steps.filter(step=>conditionVisible(step.when,context));
      if(delta>0){
        try{
          const step=steps[local.dynamic.step],subset={...definition,fields:definition.fields.filter(field=>step.fields.includes(field.id))};
          validateParams(subset,Object.fromEntries(Object.entries(local.dynamic.params).filter(([key])=>step.fields.includes(key))),context);
          if(step.validate!==undefined&&expression(step.validate,context)!==true)throw new Error('这一步的输入不符合条件。');
        }catch(error){notice(error.message);return;}
      }
      updateLocal(view=>view.dynamic.step=Math.max(0,Math.min(steps.length-1,view.dynamic.step+delta)));return;
    }
    if(target.dataset.dynamicAction&&definition){
      const action=definition.actions.find(item=>item.id===target.dataset.dynamicAction);
      if(!action){notice('找不到这项互动操作。');return;}
      try{
        validateParams(definition,local.dynamic.params,publicContext(state));
        if(action.mode==='rule'){
          const reference={interactionId:definition.id,revision:definition.revision,actionId:action.id,targets:copy(action.targets),scope:copy(definition.scope)};
          resolveDynamic(state,definition,{...reference,branchId:current.branchId,params:local.dynamic.params});
          execute('dynamic',reference,local.dynamic.params);return;
        }
      }
      catch(error){notice(error.message);return;}
      if(action.mode!=='attempt'){notice(noSettlement);return;}
      attempt({kind:'dynamic',input:'我尝试：'+action.label+'。输入：'+JSON.stringify(local.dynamic.params),actionId:action.id,interactionId:definition.id,definitionDigest:current.definitionDigest??'',params:copy(local.dynamic.params),targets:action.targets});return;
    }
    const action=target.dataset.action;if(!action)return;
    if(action==='game-map-expand'){navigate(onOpenMap,{node:target.dataset.node??null});return;}
    if(action==='reader-inspect'){navigate(onInspectKind,target.dataset.kind);return;}
    if(action==='travel-current'){navigate(onCurrentMap);return;}
    if(action==='map-scope'&&!target.closest('.reader-advanced-travel')){
      navigate(onOpenMap,{scope:target.dataset.scope||null,anchor:target.dataset.anchor||null,node:target.dataset.node??null});return;
    }
    if(action==='map-zoom'&&!target.closest('.reader-advanced-travel')){zoomSpatial(target);return;}
    if(action==='game-inspect'){updateLocal(view=>view.inspectedId=target.dataset.entity??'');return;}
    if(action==='game-act'){
      if(target.dataset.branch!==current.branchId||Number(target.dataset.version)!==state.version){notice('情况已有变化，请查看最新资料。');return;}
      const surface=state.game?.surfaces?.find(item=>item.id===target.dataset.surface),offer=surface?.actions?.find(item=>item.id===target.dataset.actionId);
      if(!offer||offer.disabledReason){notice(noSettlement);return;}
      if(offer.mode==='apply'){
        const reference={branchId:current.branchId,version:state.version,surfaceId:surface.id,actionId:offer.id};
        try{resolveGameAction(state,reference,{branchId:current.branchId});}
        catch(error){notice(error.message);return;}
        execute('game',reference);return;
      }
      if(offer.mode!=='attempt'){notice(noSettlement);return;}
      if(typeof offer.input!=='string'||!offer.input.trim()){notice('这项行动缺少已保存的输入，请在下方自行描述做法。');return;}
      attempt({kind:'game',input:offer.input,surfaceId:surface.id,actionId:offer.id});return;
    }
    const data=target.dataset,model=travelModel(state,{objects:state.experience?.objects??[]},local.travel,{branchId:current.branchId,busy:current.busy,historical:current.readonly});
    if(action==='travel-depart'){
      if(data.branch!==current.branchId||Number(data.version)!==state.version){notice('情况已有变化，请按最新地图重新选择路线。');return;}
      const chosen=model.routes.find(item=>item.route.id===data.route);
      if(!chosen||!chosen.available||local.travel.routeId!==data.route||!model.selected){notice('请先比较并选择可用路线。');return;}
      if(deterministic(current)){
        const reference={branchId:current.branchId,version:state.version,surfaceId:'$journeys',actionId:chosen.route.id};
        try{resolveGameAction(state,reference,{branchId:current.branchId});}
        catch(error){notice(error.message);return;}
        execute('journey',reference);return;
      }
      attempt({kind:'travel',input:`我尝试沿${chosen.route.label}前往${model.selected.name}。`,actionId:chosen.route.id,routeId:chosen.route.id});return;
    }
    if(action==='travel-ask'||action==='travel-recheck'){
      if(model.selected)draft(action==='travel-ask'?`我想了解从${state.location}去${model.selected.name}的路线。`:`请先核对从${state.location}去${model.selected.name}的当前通行情况、耗时和完整费用，暂不出发。`);return;
    }
    if(action==='travel-carry-draft'){
      const chosen=model.routes.find(item=>item.route.id===local.travel.routeId);
      const warning=chosen&&travelWarnings(state,{objects:state.experience?.objects??[]},chosen.route).find(item=>item.itemId===data.item);
      if(warning?.draft)draft(warning.draft);return;
    }
    if(action==='map-zoom'){
      zoomTravel(data.factor==='reset'?1:local.travel.zoom*Number(data.factor));return;
    }
    updateLocal(view=>{
      const map=view.travel;
      if(action==='travel-select'){map.selectedId=data.entity||'';map.routeId='';map.panel='detail';}
      else if(action==='travel-clear'){map.selectedId='';map.routeId='';map.panel='detail';}
      else if(action==='travel-compare'){map.panel='routes';map.routeId='';}
      else if(action==='travel-route'&&model.routes.some(item=>item.route.id===data.route))map.routeId=data.route;
      else if(action==='travel-known')map.panel=map.panel==='known'?'detail':'known';
      else if(action==='travel-list')map.listOpen=!map.listOpen;
      else if(action==='travel-level'&&['place','region','world'].includes(data.level)&&!(data.level==='place'&&!model.placeEnabled)){map.level=data.level;map.scopeOverride=undefined;map.anchorId='';map.zoom=1;}
      else if(action==='map-scope'){map.scopeOverride=data.scope||null;map.anchorId=data.anchor||'';map.zoom=1;}
      else if(action==='travel-home'){map.level='region';map.scopeOverride=undefined;map.anchorId=model.currentId||'';map.selectedId=model.currentId||'';map.routeId='';map.panel='detail';map.zoom=1;}
    });
  },{signal});
  refresh();
  return {update(next){
    if(disposed)return;
    const changed=sourceKey(next)!==sourceKey(current);
    current=next;
    local=normalizeAdvancedState(next.localState??next.viewState??(changed?{}:local),next.definition);
    refresh();
  },dispose(){if(disposed)return;disposed=true;for(const entry of frames.values())clearTimeout(entry.timer);frames.clear();controller.abort();root.replaceChildren();}};
}
