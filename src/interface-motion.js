const properties=['--pointer-x','--pointer-y','--tilt-x','--tilt-y','--drift-x','--drift-y'];
const clamp=value=>Math.max(0,Math.min(1,value));

/** Small pointer responses for product artwork. Navigation and scrolling stay native. */
export function createInterfaceMotion({
  root=globalThis.document,
  enabled=()=>true,
  document=root?.ownerDocument||root,
  view=document?.defaultView,
  requestFrame=view?.requestAnimationFrame?.bind(view),
  cancelFrame=view?.cancelAnimationFrame?.bind(view),
  MutationObserver=view?.MutationObserver
}={}){
  const reduced=view?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const fine=view?.matchMedia?.('(hover: hover) and (pointer: fine)');
  let destroyed=false,mounted=false,frame=null,surface=null,point=null,cleanup=[];

  function allowed(){
    return enabled()&&mounted&&!destroyed&&!document?.hidden&&!reduced?.matches&&fine?.matches&&
      !document?.body?.classList.contains('reduce-motion');
  }

  function targetSurface(target){
    const element=target?.closest?.('.universe-sculpture, .discovery-card');
    return element&&root.contains(element)&&element.closest('.product-app')?element:null;
  }

  function reset(){
    if(frame!==null){cancelFrame?.(frame);frame=null;}
    if(surface){
      for(const property of properties)surface.style.removeProperty(property);
      surface.removeAttribute('data-motion-active');
    }
    surface=null;point=null;
  }

  function paint(){
    frame=null;
    if(!allowed()||!point||targetSurface(surface)!==surface){reset();return;}
    const rect=surface.getBoundingClientRect();
    if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0){reset();return;}
    const x=clamp((point.x-rect.left)/rect.width),y=clamp((point.y-rect.top)/rect.height);
    const dx=x*2-1,dy=y*2-1;
    const values=[`${(x*100).toFixed(2)}%`,`${(y*100).toFixed(2)}%`,
      `${(-dy*4).toFixed(2)}deg`,`${(dx*4).toFixed(2)}deg`,
      `${(dx*10).toFixed(2)}px`,`${(dy*10).toFixed(2)}px`];
    properties.forEach((property,index)=>surface.style.setProperty(property,values[index]));
    surface.setAttribute('data-motion-active','true');
  }

  function move(event){
    if(!allowed()||event.pointerType==='touch'){reset();return;}
    const next=targetSurface(event.target);
    if(next!==surface)reset();
    if(!next||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
    surface=next;point={x:event.clientX,y:event.clientY};
    if(frame===null)frame=requestFrame(paint);
  }

  function leave(event){if(surface&&!surface.contains(event.relatedTarget))reset();}
  function contact(event){if(event.pointerType==='touch')reset();}
  function preferenceChanged(){if(!allowed())reset();}
  function listen(target,type,handler,options={passive:true}){
    target?.addEventListener?.(type,handler,options);
    cleanup.push(()=>target?.removeEventListener?.(type,handler,options));
  }

  function unmount(){
    mounted=false;reset();
    for(const remove of cleanup)remove();
    cleanup=[];
  }

  function mount(){
    unmount();
    if(destroyed||!enabled()||!root?.addEventListener||!requestFrame)return;
    mounted=true;
    listen(root,'pointermove',move);
    listen(root,'pointerdown',contact);
    listen(root,'pointerout',leave);
    listen(root,'pointerleave',reset);
    listen(root,'pointercancel',reset);
    listen(document,'visibilitychange',preferenceChanged);
    // Layout changes invalidate the last pointer position, including nested scrolling.
    listen(document,'scroll',reset,{passive:true,capture:true});
    listen(view,'resize',reset);
    listen(view,'blur',reset);
    listen(reduced,'change',preferenceChanged);
    listen(fine,'change',preferenceChanged);
    if(MutationObserver&&document?.body){
      const observer=new MutationObserver(preferenceChanged);
      observer.observe(document.body,{attributes:true,attributeFilter:['class']});
      cleanup.push(()=>observer.disconnect());
    }
  }

  function destroy(){destroyed=true;unmount();}
  return {mount,destroy};
}
