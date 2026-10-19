// Host adapter only. The workbench, rich renderer, sorting/filter/zoom controls and
// styles are copied unchanged from the source demo. Formal facts remain in Go.
import {mountArtifactWorkbench} from './workbench.js';
import {renderRichView} from './rich-interaction-view.js';
import {bindRichControls} from './rich-interaction-controls.js';
import {richValue} from './reader-rich-value.js';
import {mountContext} from './reader-context.js';
import {renderAdvanced} from './reader-advanced.js';
import {mountGameplay} from './reader-gameplay-view.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=location.hash.slice(1),origin=location.origin;
const host=document.getElementById('workbench'),notice=document.getElementById('reader-artifact-notice');
let state,workbench,disposeContext,standaloneHandle,presentation={},params={};
const send=(kind,value)=>parent.postMessage(JSON.stringify({channel:'elselife-reader-artifact',token,kind,value}),origin);
function field(record,f){const value=params[record.fact_id]?.[f.id]??f.value??'',disabled=state.readonly||state.busy?'disabled':'',attr=`data-record="${esc(record.fact_id)}" data-field="${esc(f.id)}" aria-label="${esc(f.label)}" ${disabled}`;
 const input=f.kind==='select'?`<select ${attr}><option value="">请选择</option>${(f.options||[]).map(v=>`<option ${value===v?'selected':''}>${esc(v)}</option>`).join('')}</select>`:f.kind==='checkbox'?`<input type="checkbox" ${attr} ${String(value)==='true'?'checked':''}>`:`<input ${attr} type="${f.kind==='number'?'number':'text'}" value="${esc(value)}" maxlength="1000">`;
 return `<label class="field">${esc(f.label)}${f.required?' *':''}${input}</label>`;
}
export function evidenceMarkup(record,options={}){
 if(record.kind==='artifact'){
   try {const views=richValue(record.value);if(views)return views.map((view,i)=>renderRichView(options.historical?withoutDrafts(view):view,{index:record.fact_id+'-'+i,...options})).join('');}
   catch(error){return '<p class="rich-empty" role="alert">作品视图无法展示：'+esc(error.message)+'</p><details><summary>查看原始记录</summary><pre>'+esc(record.value)+'</pre></details>';}
 }

 const columns=Array.isArray(record.columns)?record.columns:[],rows=Array.isArray(record.rows)?record.rows:[];
 let rendered='';
 // Preserve every cell while respecting the source renderer's 8-column/50-row limits.
 for(let column=0;column<columns.length;column+=8)for(let row=0;row<Math.max(1,rows.length);row+=50)
   rendered+=renderRichView({type:'table',title:record.label,columns:columns.slice(column,column+8),rows:rows.slice(row,row+50).map(r=>r.slice(column,column+8))},{index:`${record.fact_id}-${column}-${row}`,...options});
 if(!rendered)rendered=renderRichView({type:'cards',title:record.label,items:[{title:record.label,body:record.quote||'',tag:record.status||'',prompt:options.historical?'':record.input||''}]},{index:record.fact_id,...options});
 return rendered;
}
function withoutDrafts(value){if(Array.isArray(value))return value.map(withoutDrafts);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='prompt').map(([key,v])=>[key,withoutDrafts(v)]));return value;}
function render(next){if(next.surface==='advanced'){renderPrepared(next);return;}standaloneHandle?.dispose();standaloneHandle=null;disposeContext?.();disposeContext=null;if(next.surface==='historical-interaction'){state=next;workbench?.dispose();workbench=null;document.body.dataset.theme=next.dark?'dark':'light';const d=next.payload?.definition;if(!d){host.replaceChildren();return;}const definition={...d,title:'当时的记录 · '+d.title,fields:[],actions:[],steps:[]};host.replaceChildren();const handle=renderAdvanced(host,{...next.payload,definition,localState:{...next.state,dynamic:{...next.state?.dynamic,closed:true}},historical:true,busy:true,panel:'dynamic'},{});disposeContext=()=>handle.dispose();const details=host.querySelector('details');if(details){details.dataset.historicalRich='';details.querySelector('summary')?.insertAdjacentHTML('afterend','<p class="reading-history-annotation">历史记录 · 只读。可以排序、筛选和放大查看。</p>');}notice.textContent='';resize();return;}if(next.surface==='gameplay'){state=next;workbench?.dispose();workbench=null;document.body.dataset.theme=next.dark?'dark':'light';const handle=mountGameplay(host,next,send,message=>notice.textContent=message);disposeContext=()=>handle.dispose();resize();return;}if(next.surface==='context'){workbench?.dispose();workbench=null;document.body.dataset.theme=next.dark?'dark':'light';disposeContext=mountContext(host,next,send,notice);notice.textContent='查看、选择与排序不推进时间。';resize();return;}state=next;params=next.params||params;document.body.dataset.theme=next.dark?'dark':'light';document.body.classList.toggle('reduce-motion',!!next.reduced);
 const records=Array.isArray(next.records)?next.records:[],current=records.at(-1);
 let html=records.map(record=>`<section data-evidence-record="${esc(record.fact_id)}">${evidenceMarkup(record,{busy:next.busy,historical:next.readonly})}<div class="dynamic-fields">${(record.fields||[]).map(f=>field(record,f)).join('')}</div>${record.fields?.length&&!next.readonly?`<div class="dynamic-row"><button class="btn" type="button" data-draft-params="${esc(record.fact_id)}" ${next.busy?'disabled':''}>将参数用于行动草稿 ↗</button></div>`:''}<details class="reader-evidence"><summary>记录依据 · 第 ${esc(record.source_revision)} 页</summary><p>${esc(record.quote)}</p><button class="btn compact" data-source="${esc(record.source_revision)}">回看原文</button></details></section>`).join('');
 if(!html)html='<p class="rich-empty">尚无这条分支已提交的交互作品。可以继续经历，或在输入框询问当前可用的操作。</p>';
 const props={title:current?.label||'交互作品',summary:next.readonly?'历史快照 · 仅展示当时已知的记录':'来自已保存的正式事实 · 选择与预览不会改变故事',html,busy:next.busy,stage:next.busy?'generating':undefined,error:next.error||undefined,
   revisions:(next.revisions||records).map(r=>({id:r.fact_id,title:r.label,reason:'第 '+r.source_revision+' 页的正式记录'})),currentRevision:current?.fact_id,
   onExport:()=>send('export',null),onRestore:!next.readonly&&next.canRestore?id=>send('restore',id):undefined,onCancel:next.busy&&next.canCancel?()=>send('cancel',null):undefined,
   onImport:next.readonly?undefined:async file=>{if(file.size>1024*1024){notice.textContent='作品文件不能超过 1 MB。';return;}try{const parsed=JSON.parse(await file.text());if(!parsed||typeof parsed!=='object')throw Error();send('import',parsed);}catch{notice.textContent='无法读取这份作品 JSON。';}},
   onContentMount:root=>{const controller=new AbortController();const signal=controller.signal;bindRichControls(root,{ready:()=>!next.readonly&&!next.busy,draft:text=>send('draft',text),toast:text=>notice.textContent=text,presentation});
     root.addEventListener('input',event=>{const target=event.target;if(!target.matches('[data-field]'))return;const id=target.dataset.record;params[id]??={};params[id][target.dataset.field]=target.type==='checkbox'?String(target.checked):target.value;send('params',params);},{signal});
     root.addEventListener('click',event=>{if(!event.isTrusted)return;const source=event.target.closest('[data-source]');if(source){send('source',Number(source.dataset.source));return;}const button=event.target.closest('[data-draft-params]');if(!button||next.readonly||next.busy)return;const r=records.find(r=>r.fact_id===button.dataset.draftParams);if(!r)return;const values={...Object.fromEntries((r.fields||[]).map(f=>[f.id,f.value||''])),...params[r.fact_id]};for(const f of r.fields||[]){if(f.required&&!String(values[f.id]??'').trim()||f.kind==='number'&&values[f.id]!==''&&!Number.isFinite(Number(values[f.id]))){notice.textContent='请检查'+f.label;return;}}send('draft',(r.input||'关于'+r.label+'，我选择以下参数，请按已知规则尝试。')+'\n'+r.fields.map(f=>f.label+'：'+values[f.id]).join('\n'));},{signal});return()=>controller.abort();},
 };
 if(workbench)workbench.update(props);else workbench=mountArtifactWorkbench(host,props);
 notice.textContent='导入内容只作为本机参考；历史恢复需要正式分支操作。恢复会通过正式分支操作保留原故事。';
 resize();
}

function renderPrepared(next){
 disposeContext?.();disposeContext=null;
 state=next;
 document.body.dataset.theme=next.dark?'dark':'light';document.body.classList.toggle('reduce-motion',!!next.reduced);
 const payload={...next.payload,localState:next.state,busy:next.busy,historical:next.readonly,branchId:next.branchId,version:next.version};
 const callbacks={
 onCurrentMap:()=>send('advanced-current-map',null),
 onOpenMap:value=>send('advanced-open-map',value),
 onInspectKind:kind=>send('advanced-inspect',kind),
 onRepair:reason=>{if(state.surface==='advanced'&&!state.busy&&!state.readonly)send('advanced-repair',reason);},
 onExecute:request=>{if(state.surface==='advanced'&&!state.busy&&!state.readonly)send('advanced-execute',request);},
 onAction:request=>{if(state.surface==='advanced'&&!state.busy&&!state.readonly)send('advanced-attempt',request);},
 onState:value=>{if(state.surface==='advanced'&&!state.readonly)send('advanced-state',value);},
 onDraft:text=>{if(state.surface==='advanced'&&!state.busy&&!state.readonly)send('draft',text);},
 };
 workbench?.dispose();workbench=null;
 if(standaloneHandle)standaloneHandle.update(payload);else{host.replaceChildren();standaloneHandle=renderAdvanced(host,payload,callbacks);}
 notice.textContent=payload.panel==='travel'
   ?next.readonly?'当时的地图与行程 · 仅查看':'查看地图和选择路线不会出发；只有明确执行才提交正式行程。'
   :next.readonly?'历史内容 · 仅查看。':'';
 resize();
}
const resize=()=>send('height',Math.max(260,Math.min(1800,document.body.scrollHeight+16)));
new ResizeObserver(resize).observe(host);
addEventListener('message',event=>{if(event.source!==parent||event.origin!==origin)return;let data;try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}if(data?.channel!=='elselife-reader-artifact'||data.token!==token)return;if(data.kind==='dispose'){disposeContext?.();workbench?.dispose();standaloneHandle?.dispose();return;}if(data.kind==='render')render(data.value);});
send('ready',null);
