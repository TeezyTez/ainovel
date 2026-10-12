import {travelModel,travelView,normalizeTravelView,travelWarnings} from './travel-ui.js';
import {publicSituation} from './experience-state.js';
import {journeyOptions,JOURNEY_SURFACE} from './journey-state.js';
import {resolveGameAction} from './game-state.js';

export function createTravelControls(api){
 const memory=new Map();let activeKey='',view=normalizeTravelView(),historyNode='',historical=false,model,listenerDialog;
 const doc=()=>globalThis.document;
 const root=()=>doc()?.querySelector('[data-travel-panel]');
 const key=()=>`fangtang.travel-ui.v1:${api.session()?.id||''}:${api.branch()?.id||''}`;
 function persist(){
  if(!activeKey)return;memory.set(activeKey,normalizeTravelView(view));
  try{globalThis.localStorage?.setItem(activeKey,JSON.stringify(view));}catch{/* View preferences must never prevent a story action. */}
 }
 function capture(){
  const panel=root();if(!panel)return;const viewport=panel.querySelector('.atlas-viewport'),content=panel.closest('.dialog-content');
  if(viewport){view.scrollLeft=viewport.scrollLeft;view.scrollTop=viewport.scrollTop;}
  if(content)view.contentScroll=content.scrollTop;persist();
 }
 function load(){
  const next=key();if(next===activeKey)return;capture();activeKey=next;
  let saved=memory.get(next);if(!saved)try{saved=JSON.parse(globalThis.localStorage?.getItem(next)||'null');}catch{}
  view=normalizeTravelView(saved||{});historyNode='';historical=false;
 }
 function snapshot(){
  if(!historical)return api.state();
  return historyNode?api.branch().turns.find(t=>t.id===historyNode)?.state:api.branch().initialState;
 }
 function zoomTo(zoom,{restore=false}={}){
  const panel=root(),viewport=panel?.querySelector('.atlas-viewport'),canvas=panel?.querySelector('.atlas-canvas');if(!viewport||!canvas)return;
  const old=Number(canvas.dataset.zoom)||1,base=canvas.clientWidth/old,centerX=(viewport.scrollLeft+viewport.clientWidth/2)/canvas.clientWidth,centerY=(viewport.scrollTop+viewport.clientHeight/2)/canvas.clientHeight;
  view.zoom=Math.max(1,Math.min(3,zoom));canvas.dataset.zoom=String(view.zoom);canvas.style.width=view.zoom===1?'':`${base*view.zoom}px`;
  if(restore){viewport.scrollLeft=view.scrollLeft;viewport.scrollTop=view.scrollTop;}
  else{viewport.scrollLeft=centerX*canvas.clientWidth-viewport.clientWidth/2;viewport.scrollTop=centerY*canvas.clientHeight-viewport.clientHeight/2;capture();}
 }
 function bind(){
  const panel=root();if(!panel)return;const dialog=panel.closest('dialog');dialog?.classList.add('travel-dialog');
  if(dialog&&listenerDialog!==dialog){dialog.addEventListener('close',capture);listenerDialog=dialog;}
  zoomTo(view.zoom,{restore:true});const content=panel.closest('.dialog-content');if(content){content.scrollTop=view.contentScroll;content.addEventListener('scroll',capture,{passive:true});}
  const viewport=panel.querySelector('.atlas-viewport');if(!viewport)return;
  viewport.addEventListener('scroll',capture,{passive:true});
  // Native scrolling is still available; pointer panning also supports a pinch.
  const pointers=new Map();let origin=null,pinch=null,moved=false;
  viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture?.(e.pointerId);moved=false;origin={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:view.zoom};}});
  viewport.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()];zoomTo(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/(pinch.distance||1));moved=true;}else if(origin){const dx=e.clientX-origin.x,dy=e.clientY-origin.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;viewport.scrollLeft=origin.left-dx;viewport.scrollTop=origin.top-dy;}});
  const release=e=>{pointers.delete(e.pointerId);if(!pointers.size){origin=null;pinch=null;capture();}};viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);
  viewport.addEventListener('click',e=>{if(moved){moved=false;return;}if(!e.target.closest('button')&&view.selectedId){view.selectedId='';view.routeId='';view.panel='detail';show();}});
  for(const b of panel.querySelectorAll('.atlas-place'))b.setAttribute('aria-pressed',String(b.dataset.entity===view.selectedId));
 }
 function show({captureFirst=true}={}){
  if(captureFirst)capture();const state=snapshot();if(!state){historical=false;api.toast('这份历史记录已不存在，已回到当前地图。');}
  const shown=state||api.state(),situation=historical?publicSituation(api.branch(),api.world(),historyNode||null):api.situation?.()||{};
  model=travelModel(shown,situation,view,{branchId:api.branch().id,historyNode,historical,busy:!!api.busy?.()});view=model.view;persist();
  api.open('地图',travelView(model),undefined,{replace:true,onRestore:bind});bind();
 }
 function open(options={}){if(!api.session())return;load();historical=false;if(Object.hasOwn(options,'node'))historyNode=options.node||'';show({captureFirst:false});}
 function draft(input){const branch=api.branch();branch.draft=branch.draft?.trim()?branch.draft+'\n'+input:input;api.save();capture();api.close();const field=doc()?.querySelector('#action-input');if(field){field.value=branch.draft;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();}api.toast('已写入草稿，发送后才会行动。');}
 function depart(target,legacy=false){
  if(historical){api.toast('历史地图只供查看，请返回当前地图。');return;}
  if(api.busy?.()){api.toast('故事正在推进，请等本轮结束后再出发。');return;}
  const data=target.dataset,state=api.state(),branch=api.branch();
  if(data.branch!==branch.id||Number(data.version)!==state.version){api.toast('情况已有变化，请按最新地图重新选择路线。');view.routeId='';show();return;}
  const reference={branchId:branch.id,version:state.version,surfaceId:legacy?data.surface:JOURNEY_SURFACE,actionId:legacy?data.actionId:data.route};
  if(!legacy&&(!model||model.state.version!==state.version||view.routeId!==data.route)){api.toast('请先比较并选择这条路线。');return;}
  try{
   const receipt=resolveGameAction(state,reference,{branchId:branch.id});capture();api.close();api.send(receipt.input,reference);
  }catch(error){api.toast(error.message);show();}
 }
 function handle(action,target={dataset:{}}){
  const data=target.dataset||{};
  if(action==='map-scope'&&!target.closest?.('[data-travel-panel]')){open({node:data.node});return true;}
  if(action==='play-map'||action==='travel-open'||action==='game-map-expand'||action==='reader-inspect'&&data.kind==='map'||action==='game-recall'&&data.kind==='map'){open({node:data.node});return true;}
  const inside=!!target.closest?.('[data-travel-panel]');
  if(!action.startsWith('travel-')&&!inside)return false;
  if(!api.session())return false;
  if(action==='close-dialog'||action==='dialog-back'){capture();return false;}
  if(action==='travel-depart'){depart(target);return true;}
  if(action==='game-act'&&inside){depart(target,true);return true;}
  if(action==='map-zoom'){
   const next=data.factor==='reset'?1:view.zoom*Number(data.factor);if(Number.isFinite(next))zoomTo(next);persist();return true;
  }
  capture();
  if(action==='travel-select'||action==='game-inspect'&&inside){view.selectedId=data.entity;view.routeId='';view.panel='detail';}
  else if(action==='travel-clear'){view.selectedId='';view.routeId='';view.panel='detail';}
  else if(action==='travel-compare'){view.panel='routes';view.routeId='';}
  else if(action==='travel-route'){if(!historical&&model?.routes.some(o=>o.route.id===data.route))view.routeId=data.route;}
  else if(action==='travel-known')view.panel=view.panel==='known'?'detail':'known';
  else if(action==='travel-list')view.listOpen=!view.listOpen;
  else if(action==='travel-level'){if(!['place','region','world'].includes(data.level)||data.level==='place'&&!model?.placeEnabled)return true;view.level=data.level;view.scopeOverride=undefined;view.anchorId='';view.scrollLeft=0;view.scrollTop=0;view.zoom=1;}
  else if(action==='map-scope'&&inside){view.scopeOverride=data.scope||null;view.anchorId=data.anchor||'';view.scrollLeft=0;view.scrollTop=0;view.zoom=1;}
  else if(action==='travel-home'){view.level='region';view.scopeOverride=undefined;view.anchorId=model?.currentId||'';view.selectedId=model?.currentId||'';view.routeId='';view.panel='detail';view.zoom=1;view.scrollLeft=0;view.scrollTop=0;}
  else if(action==='travel-history'){historyNode=data.node||historyNode;historical=true;view.routeId='';view.panel='detail';view.scopeOverride=undefined;}
  else if(action==='travel-current'){historical=false;view.routeId='';view.panel='detail';view.scopeOverride=undefined;}
  else if(action==='travel-ask'||action==='travel-recheck'){if(!historical&&model?.selected)draft(action==='travel-ask'?`我想了解从${api.state().location}去${model.selected.name}的路线。`:`请先核对从${api.state().location}去${model.selected.name}的当前通行情况、耗时和完整费用，暂不出发。`);return true;}
  else if(action==='travel-carry-draft'){if(!historical){const option=journeyOptions(api.state()).find(o=>o.route.id===view.routeId),warning=option&&travelWarnings(api.state(),api.situation?.(),option.route).find(w=>w.itemId===data.item);if(warning?.draft)draft(warning.draft);}return true;}
  else return false;
  show({captureFirst:false});return true;
 }
 return {handle,open,invalidate(){const panel=root();if(panel&&panel.closest('dialog')?.open)show();}};
}
