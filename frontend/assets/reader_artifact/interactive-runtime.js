import {cleanArtifactState,validateInteractiveView} from './interactive-artifact.js';
import {validateReactArtifact,validateReactBundle} from './react-artifact.js';

// This bridge deliberately has no execute, navigation, storage or network command.
export function createArtifactRuntime(api){
  const win=api.window??globalThis.window,schedule=api.schedule??setTimeout,clear=api.clearSchedule??clearTimeout;
  const records=new Map(),repaired=new Set();let mounted=[];
  const identity=()=>{const a=api.active(),artifact=a?.branch?.dynamic?.artifact;return a?.branch?.dynamic?.definition?{id:a.branch.dynamic.definition.id,digest:a.branch.dynamic.digest,scope:JSON.stringify([a.session.id,a.branch.id,a.state.version]),head:artifact?.head,stateRevision:artifact?.stateRevision}:null;};
  const key=x=>'elselife:artifact:'+x.scope+':'+x.digest+(x.head?':'+x.head:'');
  const valid=entry=>{const x=identity();return !!x&&x.scope===entry.scope&&x.digest===entry.digest&&x.head===entry.head&&entry.element.isConnected;};
  function record(x,{refresh=false}={}){
    const k=key(x);if(!records.has(k)){
      let state=cleanArtifactState(x.initialState===undefined?{}:x.initialState);
      try{const saved=api.storage?.getItem(k);if(saved!==null&&saved!==undefined)state=cleanArtifactState(JSON.parse(saved));}catch{}
      try{const saved=api.state?.(x);if(saved!==undefined)state=cleanArtifactState(saved);}catch{}
      records.set(k,{state,error:'',serverStateRevision:x.stateRevision});while(records.size>12)records.delete(records.keys().next().value);
    }
    const result=records.get(k);
    // Refresh only a newly bound frame. Live controls keep their unsynced edits.
    if(refresh&&result.serverStateRevision!==x.stateRevision){try{const state=api.state?.(x);if(state!==undefined)result.state=cleanArtifactState(state);result.serverStateRevision=x.stateRevision;}catch{}}
    return result;
  }
  function fail(entry,error){
    if(!valid(entry)||entry.failed)return;
    entry.failed=true;clear(entry.timer);record(entry).error=String(error).slice(0,500);
    entry.status.hidden=false;entry.status.textContent='交互图暂时无法使用，已保留当前输入。';entry.repair.hidden=false;
    // The generated frame may be stuck or broken. Remove its browsing context.
    entry.frame.remove();
    if(!repaired.has(entry.scope)){repaired.add(entry.scope);api.repair?.('修复当前交互图，保留原任务与已有局部输入。');}
  }
  function receive(event){
    const message=event.data;if(!message||message.channel!=='story-artifact')return;
    const entry=mounted.find(x=>x.frame.contentWindow===event.source&&x.token===message.token);
    if(!entry||entry.failed||!valid(entry))return;
    const r=record(entry);
    if(message.kind==='state'){
      let state;try{state=cleanArtifactState(message.value);}catch{return;}
      r.state=state;try{api.storage?.setItem(key(entry),JSON.stringify(state));}catch{}
      try{Promise.resolve(api.onState?.(state,{id:entry.id,digest:entry.digest,scope:entry.scope,head:entry.head})).catch(()=>{});}catch{}
    }else if(message.kind==='draft'){
      if(api.ready()&&typeof message.value==='string'&&message.value.trim()&&message.value.length<=1000)api.draft?.(message.value);
    }else if(message.kind==='height'){
      if(Number.isFinite(message.value))entry.frame.style.height=Math.min(1200,Math.max(220,message.value))+'px';
    }else if(message.kind==='ready'){
      clear(entry.timer);r.error='';entry.status.hidden=true;entry.repair.hidden=true;
    }else if(message.kind==='error')fail(entry,typeof message.value==='string'?message.value:'交互图运行失败。');
  }
  win?.addEventListener('message',receive);
  function bind(root){
    const previous=mounted;mounted=[];
    const x=identity();if(!x){for(const entry of previous)clear(entry.timer);return;}
    for(const element of root.querySelectorAll('[data-interactive-definition]')){
      const existing=previous.find(entry=>entry.element===element&&valid(entry));
      if(existing){mounted.push(existing);continue;}
      const frame=element.querySelector('iframe');if(!frame)continue;
      const status=element.querySelector('[data-artifact-status]'),repair=element.querySelector('[data-artifact-repair]');
      let node;try{node=JSON.parse(element.dataset.interactiveDefinition);if(node.type==='react')validateReactArtifact(node);else validateInteractiveView(node);}catch{status.textContent='交互图格式无效，请重新整理。';repair.hidden=false;repair.addEventListener('click',()=>api.repair?.('重新生成当前交互图。'));continue;}
      const entry={...x,initialState:node.initialState,element,frame,status,repair,token:crypto.randomUUID(),failed:false};mounted.push(entry);
      record(entry,{refresh:true});
      repair.addEventListener('click',()=>{if(valid(entry)&&api.ready())api.repair?.('修复当前交互图，保留原任务与已有局部输入。');});
      function initialize(renderNode){
        if(!valid(entry)||entry.failed||!mounted.includes(entry))return;
        clear(entry.timer);
        frame.addEventListener('load',()=>{
          if(!valid(entry)||entry.failed||!mounted.includes(entry))return;
          if(entry.loaded){fail(entry,'交互图发生了不支持的页面跳转。');return;}
          entry.loaded=true;
          const style=typeof getComputedStyle==='function'?getComputedStyle(element):null;
          const theme=Object.fromEntries(['ink','muted','paper','soft','accent','line'].map(k=>[k,style?.getPropertyValue('--'+k).trim()||'']));
          frame.contentWindow.postMessage({channel:'story-artifact-init',token:entry.token,node:renderNode,state:record(entry).state,theme},'*');
        });
        frame.src='/interaction-frame?token='+entry.token;
        entry.timer=schedule(()=>fail(entry,'交互图加载超时，请缩短脚本并检查初始化。'),10000);
      }
      if(node.type==='react'){
        status.textContent='正在构建交互图…';
        entry.timer=schedule(()=>fail(entry,'交互图构建超时，请重试。'),20000);
        try{Promise.resolve(api.bundle?api.bundle(node,{id:entry.id,digest:entry.digest,scope:entry.scope}):Promise.reject(new Error('React构建服务不可用。'))).then(bundle=>{validateReactBundle(bundle);initialize(bundle);}).catch(error=>{if(mounted.includes(entry))fail(entry,error.message);});}catch(error){fail(entry,error.message);}
      }else initialize(node);
    }
    for(const entry of previous)if(!mounted.includes(entry))clear(entry.timer);
  }
  function context(){const x=identity();if(!x||!records.has(key(x)))return null;const r=record(x);return {id:x.id,digest:x.digest,state:r.state,error:r.error};}
  return {bind,context,dispose(){for(const entry of mounted)clear(entry.timer);mounted=[];win?.removeEventListener('message',receive);}};
}
