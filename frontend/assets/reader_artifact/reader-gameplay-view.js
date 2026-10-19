// Read-only, source-demo gameplay recall for a formal public Reader snapshot.
// All quantities, locations, links and evidence come from the supplied state.
import {gameInspectView,gameRecallView,gameTurnView} from './game-ui.js';

const kinds=new Set(['all','map','status','inventory','timeline','interaction','clues','objectives','turn']);
const normalizedKind=value=>value==='time'?'timeline':kinds.has(value)?value:'all';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function mountGameplay(root,data,send=()=>{},notice=()=>{}){
  if(!root||typeof root.addEventListener!=='function')throw new TypeError('需要可挂载的资料视图元素');
  let current=data,kind=normalizedKind(data?.kind),mapScope=data?.mapScope??null,anchorId=data?.anchorId??null;
  let parentKind=null,disposed=false;
  const events=new AbortController();
  const pointers=new Map();let origin=null,pinch=null;
  const zoomMap=(viewport,next)=>{
    const canvas=viewport?.querySelector('.atlas-canvas');if(!canvas)return;
    const old=Number(canvas.dataset.zoom)||1,base=canvas.clientWidth/old||viewport.clientWidth;
    const centerX=canvas.clientWidth?(viewport.scrollLeft+viewport.clientWidth/2)/canvas.clientWidth:0.5;
    const centerY=canvas.clientHeight?(viewport.scrollTop+viewport.clientHeight/2)/canvas.clientHeight:0.5;
    const zoom=Math.max(1,Math.min(3,next));canvas.dataset.zoom=String(zoom);
    canvas.style.width=zoom===1?'':base*zoom+'px';
    viewport.scrollLeft=centerX*canvas.clientWidth-viewport.clientWidth/2;
    viewport.scrollTop=centerY*canvas.clientHeight-viewport.clientHeight/2;
  };
  const render=()=>{
    if(disposed)return;
    pointers.clear();origin=null;pinch=null;
    const state=record(current?.state);
    const turn=record(current?.turn);
    const content=kind==='turn'
      ?gameTurnView({...turn,state},{currentVersion:current?.currentVersion,branchId:record(current?.scope).branchId??'',density:'adaptive'})
      :gameRecallView(state,{kind,node:String(current?.node??''),scope:mapScope,anchorId});
    root.innerHTML=content+
      '<dialog class="reader-gameplay-inspector" aria-label="已知资料详情"></dialog>'+
      '<dialog class="map-expanded" aria-label="已知地图"></dialog>';
    // A historical turn is a source snapshot. Its old controls are never live.
    if(kind==='turn')for(const button of root.querySelectorAll('[data-action="game-act"]')){
      button.disabled=true;button.title='历史记录，仅可查看。';
    }
  };
  const message=(type,value)=>{
    try{send(type,value);}catch(error){notice(error.message||String(error));}
  };
  const close=()=>{
    const dialog=root.querySelector('.reader-gameplay-inspector');
    if(dialog?.open){dialog.close();return;}
    const map=root.querySelector('dialog.map-expanded');
    if(map?.open){map.close();return;}
    if(parentKind){kind=parentKind;parentKind=null;mapScope=current?.mapScope??null;anchorId=current?.anchorId??null;render();return;}
    message('context-close',null);
  };
  const openMap=(nextScope=null,nextAnchor=null)=>{
    const dialog=root.querySelector('dialog.map-expanded');
    if(!dialog)return;
    pointers.clear();origin=null;pinch=null;
    const state=record(current?.state);
    dialog.innerHTML=`<button type="button" class="btn compact" data-gameplay-close>收起地图</button>${gameRecallView(state,{kind:'map',node:String(current?.node??''),scope:nextScope,anchorId:nextAnchor})}`;
    // Match the source travel map's touch-action:none while pointer panning
    // and pinch zoom are active inside this standalone recall dialog.
    const viewport=dialog.querySelector('.atlas-viewport');if(viewport)viewport.style.touchAction='none';
    if(!dialog.open)dialog.showModal();
  };
  root.addEventListener('click',event=>{
    const button=event.target.closest?.('button[data-action],button[data-gameplay-close]');
    if(!button||!root.contains(button)||button.disabled)return;
    const action=button.dataset.action;
    if(button.dataset.gameplayClose!==undefined){close();return;}
    const state=record(current?.state),game=record(state.game);
    if(action==='game-dismiss-recall'){close();return;}
    if(action==='history'){message('gameplay-history',null);return;}
    if(action==='game-act'){notice('资料回看不会执行操作。');return;}
    if(action==='reader-inspect'){
      const next=normalizedKind(button.dataset.kind);
      if(next!==kind){parentKind??=kind;kind=next;render();}return;
    }
    if(action==='game-map-expand'){
      openMap(mapScope,anchorId);return;
    }
    if(action==='map-scope'){
      mapScope=button.dataset.scope||null;
      anchorId=button.dataset.anchor||null;
      openMap(mapScope,anchorId);return;
    }
    if(action==='map-zoom'){
      const map=button.closest('.spatial-atlas'),view=map?.querySelector('.atlas-viewport'),canvas=map?.querySelector('.atlas-canvas');
      if(!canvas||!view)return;
      const factor=Number(button.dataset.factor);
      zoomMap(view,button.dataset.factor==='reset'?1:(Number(canvas.dataset.zoom)||1)*(Number.isFinite(factor)?factor:1));
      return;
    }
    if(action==='game-inspect'){
      const entity=(Array.isArray(game.entities)?game.entities:[]).find(item=>item?.id===button.dataset.entity);
      if(!entity){notice('这份资料尚未公开。');return;}
      const dialog=root.querySelector('.reader-gameplay-inspector');
      dialog.innerHTML=`<button type="button" class="btn compact" data-gameplay-close>返回资料</button>${gameInspectView(entity,game,{node:String(current?.node??'')})}`;
      if(!dialog.open)dialog.showModal();return;
    }
  },{signal:events.signal});
  root.addEventListener('pointerdown',event=>{
    const viewport=event.target.closest?.('.map-expanded .atlas-viewport');
    if(!viewport||event.target.closest('button'))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    viewport.setPointerCapture?.(event.pointerId);
    origin={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:Number(viewport.querySelector('.atlas-canvas')?.dataset.zoom)||1};}
  },{signal:events.signal});
  root.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    const viewport=root.querySelector('.map-expanded .atlas-viewport');if(!viewport)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()];zoomMap(viewport,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/(pinch.distance||1));}
    else if(origin){viewport.scrollLeft=origin.left-(event.clientX-origin.x);viewport.scrollTop=origin.top-(event.clientY-origin.y);}
  },{signal:events.signal});
  const release=event=>{pointers.delete(event.pointerId);if(!pointers.size){origin=null;pinch=null;}};
  root.addEventListener('pointerup',release,{signal:events.signal});
  root.addEventListener('pointercancel',release,{signal:events.signal});
  render();
  return {
    update(next){
      if(disposed)return;
      const changed=next?.state!==current?.state||next?.kind!==current?.kind||next?.scope!==current?.scope||next?.mapScope!==current?.mapScope||next?.turn!==current?.turn||next?.currentVersion!==current?.currentVersion;
      current=next;
      if(changed){kind=normalizedKind(next?.kind);mapScope=next?.mapScope??null;anchorId=next?.anchorId??null;parentKind=null;render();}
    },
    dispose(){if(disposed)return;disposed=true;events.abort();root.replaceChildren();},
  };
}
