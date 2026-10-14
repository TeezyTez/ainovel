const controls='button, a.btn, a.workspace-create, .world-return-strip > a, a.world-return, a.reading-back, a.text-button, .workspace-nav-link, details > summary, .icon-button';
const clamp=value=>Math.max(0,Math.min(1,value));

/** Decorative feedback only. Native clicks, focus, form submission and routing stay untouched. */
export function createControlMotion({
  root=globalThis.document,
  document=root?.ownerDocument||root,
  view=document?.defaultView,
  requestFrame=view?.requestAnimationFrame?.bind(view),
  cancelFrame=view?.cancelAnimationFrame?.bind(view),
  MutationObserver=view?.MutationObserver
}={}){
  const reduced=view?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const fine=view?.matchMedia?.('(hover: hover) and (pointer: fine)');
  const ripples=new Map();
  let mounted=false,destroyed=false,frame=null,active=null,point=null,lens=null,cleanup=[];

  function allowed(){
    return mounted&&!destroyed&&!document?.hidden&&!reduced?.matches&&
      !document?.body?.classList.contains('reduce-motion');
  }

  function targetControl(target){
    const control=target?.closest?.(controls);
    if(!control||!root.contains(control)||control.isConnected===false||control.matches(':disabled, input, select, textarea, [aria-busy="true"]')||
      control.closest('[aria-disabled="true"], [inert], [hidden], .hidden, .danger'))return null;
    if(/(?:^|-)(?:delete|trash|remove|clear)(?:-|$)/.test(control.dataset?.action||''))return null;
    return control;
  }

  function visibleRect(control){
    const rect=control?.getBoundingClientRect();
    if(!rect||![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
    if(rect.top+rect.height<=0||rect.left+rect.width<=0||rect.top>=view?.innerHeight||rect.left>=view?.innerWidth)return null;
    const style=view?.getComputedStyle?.(control);
    if(style?.visibility==='hidden'||style?.visibility==='collapse'||style?.display==='none')return null;
    return rect;
  }

  function clearHover(){
    if(frame!==null){cancelFrame?.(frame);frame=null;}
    lens?.remove();lens=null;
    if(active){
      active.style.removeProperty('--control-x');active.style.removeProperty('--control-y');
      active.removeAttribute('data-control-active');
    }
    active=null;point=null;
  }

  function showLens(){
    if(lens&&active.contains(lens))return;
    lens?.remove();lens=null;
    const node=document.createElement('span');
    node.className='control-lens';node.setAttribute('aria-hidden','true');node.style.pointerEvents='none';
    for(let index=0;index<3;index++){
      const orbit=document.createElement('i');
      orbit.className='control-orbit';orbit.setAttribute('data-orbit',String(index));
      node.appendChild(orbit);
    }
    const core=document.createElement('span');core.className='control-lens-core';node.appendChild(core);
    active.appendChild(node);lens=node;
  }

  function clearRipple(control,record=ripples.get(control)){
    if(!record)return;
    if(ripples.get(control)===record)ripples.delete(control);
    record.animation?.cancel();record.node.remove();
  }

  function reset(){clearHover();for(const [control,record] of ripples)clearRipple(control,record);}

  function paint(){
    frame=null;
    const rect=allowed()&&fine?.matches&&active&&point&&targetControl(active)===active&&visibleRect(active);
    if(!rect){clearHover();return;}
    active.style.setProperty('--control-x',`${(clamp((point.x-rect.left)/rect.width)*100).toFixed(2)}%`);
    active.style.setProperty('--control-y',`${(clamp((point.y-rect.top)/rect.height)*100).toFixed(2)}%`);
    active.setAttribute('data-control-active','true');
    showLens();
  }

  function move(event){
    if(!allowed()||!fine?.matches||event.pointerType==='touch'){clearHover();return;}
    const next=targetControl(event.target);
    if(next!==active)clearHover();
    if(!next||!requestFrame||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
    active=next;point={x:event.clientX,y:event.clientY};
    if(frame===null)frame=requestFrame(paint);
  }

  function click(event){
    if(!allowed())return;
    const control=targetControl(event.target),rect=control&&visibleRect(control);
    if(!rect)return;
    clearRipple(control);
    const positioned=event.detail>0&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY);
    const x=positioned?clamp((event.clientX-rect.left)/rect.width)*rect.width:rect.width/2;
    const y=positioned?clamp((event.clientY-rect.top)/rect.height)*rect.height:rect.height/2;
    const size=2*Math.hypot(Math.max(x,rect.width-x),Math.max(y,rect.height-y));
    const node=document.createElement('span');
    if(typeof node.animate!=='function')return;
    node.className='control-ripple';node.setAttribute('aria-hidden','true');
    Object.assign(node.style,{left:`${x}px`,top:`${y}px`,width:`${size}px`,height:`${size}px`,pointerEvents:'none'});
    const record={node,animation:null};ripples.set(control,record);
    try{
      control.appendChild(node);
      record.animation=node.animate([
        {transform:'translate(-50%, -50%) scale(.8)',opacity:0,offset:0},
        {transform:'translate(-50%, -50%) scale(.38)',opacity:.38,offset:.35},
        {transform:'translate(-50%, -50%) scale(.06)',opacity:0,offset:1}
      ],{duration:520,easing:'cubic-bezier(.22, 1, .36, 1)'});
      const finished=()=>{if(ripples.get(control)===record)clearRipple(control,record);};
      record.animation.finished.then(finished,finished);
    }catch{clearRipple(control,record);}
  }

  function leave(event){if(active&&!active.contains(event.relatedTarget))clearHover();}
  function contact(event){if(event.pointerType==='touch')clearHover();}
  function refresh(){
    if(!allowed()){reset();return;}
    if(active&&(!fine?.matches||targetControl(active)!==active||!visibleRect(active)))clearHover();
    for(const [control,record] of ripples)if(targetControl(control)!==control||!visibleRect(control))clearRipple(control,record);
  }
  function listen(target,type,handler,options={passive:true}){
    target?.addEventListener?.(type,handler,options);
    cleanup.push(()=>target?.removeEventListener?.(type,handler,options));
  }

  function unmount(){
    mounted=false;reset();for(const remove of cleanup)remove();cleanup=[];
  }

  function mount(){
    unmount();
    if(destroyed||!root?.addEventListener)return;
    mounted=true;
    listen(root,'pointermove',move);
    listen(root,'pointerdown',contact);
    listen(root,'pointerout',leave);
    listen(root,'pointerleave',clearHover);
    listen(root,'pointercancel',reset);
    listen(root,'click',click);
    listen(document,'visibilitychange',refresh);
    listen(document,'scroll',reset,{passive:true,capture:true});
    listen(view,'resize',reset);listen(view,'blur',reset);listen(view,'pagehide',reset);
    listen(reduced,'change',refresh);listen(fine,'change',reset);
    if(MutationObserver&&document?.body){
      const observer=new MutationObserver(refresh);
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','disabled','aria-disabled','aria-busy','hidden','inert','data-action']});
      cleanup.push(()=>observer.disconnect());
    }
  }

  function destroy(){destroyed=true;unmount();}
  return {mount,destroy};
}
