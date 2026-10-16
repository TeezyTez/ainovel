const easing='cubic-bezier(.22, 1, .36, 1)';

function visibleRect(element,view){
  const rect=element?.getBoundingClientRect();
  if(!rect||rect.width<=0||rect.height<=0)return null;
  if(rect.bottom<=0||rect.right<=0||rect.top>=view.innerHeight||rect.left>=view.innerWidth)return null;
  return rect;
}

function copyAppearance(source,clone,view){
  const originals=[source,...source.querySelectorAll('*')];
  const copies=[clone,...clone.querySelectorAll('*')];
  originals.forEach((original,index)=>{
    const copy=copies[index],style=view.getComputedStyle(original);
    for(let property=0;property<style.length;property++){
      const name=style[property];
      copy.style.setProperty(name,style.getPropertyValue(name));
    }
    if(original.tagName==='CANVAS'){try{copy.getContext('2d')?.drawImage(original,0,0);}catch{}copy.style.maskImage='none';}
    copy.removeAttribute('id');
    copy.style.animation='none';
    copy.style.transition='none';
  });
}

/** Visual effects only: rendering and navigation remain synchronous and caller-owned. */
export function createEditorialMotion({root=globalThis.document,reduced,enabled=()=>true}={}){
  const document=root?.ownerDocument||root,view=document?.defaultView;
  const motionPreference=view?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const prefersReduced=reduced||(()=>Boolean(document?.body?.classList.contains('reduce-motion')||motionPreference?.matches));
  const cleanup=[];
  let destroyed=false,entrance=null,portal=null;

  function clearEntrance(){
    if(!entrance)return;
    const previous=entrance;entrance=null;
    previous.cancel();
  }

  function clearPortal(record=portal){
    if(!record)return;
    if(record===portal)portal=null;
    if(record.art)record.art.style.opacity=record.targetOpacity;
    record.animation?.cancel();
    record.overlay.remove();
  }

  function allowed(){return enabled()&&!destroyed&&root&&document?.body&&!document.hidden&&!prefersReduced();}

  function clearEffects(){clearEntrance();clearPortal();}
  function preferenceChanged(){if(!allowed())clearEffects();}
  function listen(target,type,handler){
    target?.addEventListener?.(type,handler,{passive:true});
    cleanup.push(()=>target?.removeEventListener?.(type,handler));
  }

  function prepareRoute(){
    clearEntrance();clearPortal();
    if(!allowed()||!view?.getComputedStyle)return;
    const link=document.activeElement?.closest?.('a[href^="#/world/"]');
    if(!link||(root!==document&&!root.contains(link)))return;
    const href=link.getAttribute('href');
    // hashchange already names the destination; a stale focus must not choose its portal.
    if(href!==document.location?.hash)return;
    const source=link.closest('.discovery-card')?.querySelector('.world-atmosphere');
    if(typeof source?.animate!=='function')return;
    const rect=visibleRect(source,view);
    if(!rect)return;
    const overlay=source.cloneNode(true);
    copyAppearance(source,overlay,view);
    overlay.classList?.add('portal-transfer');
    overlay.setAttribute('aria-hidden','true');
    overlay.inert=true;
    Object.assign(overlay.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,
      width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',boxSizing:'border-box',
      transform:'none',transformOrigin:'top left',pointerEvents:'none',zIndex:'80',background:'transparent',boxShadow:'none',border:'0'});
    document.body.appendChild(overlay);
    portal={overlay,rect,href,animation:null,field:source.dataset?.fieldSize?{x:Number(source.dataset.fieldCx),y:Number(source.dataset.fieldCy),size:Number(source.dataset.fieldSize)}:null};
  }

  function flyPortal(){
    const record=portal;
    if(!record)return;
    const target=root.querySelector('.world-intro .world-atmosphere');
    const rect=visibleRect(target,view);
    if(!target||!rect||record.href!==document.location?.hash){clearPortal();return;}
    try{
      record.art=target.querySelector?.('canvas')||target;record.targetOpacity=record.art.style.opacity||'';
      // Only the decorative destination yields to the moving surface; text stays usable.
      record.art.style.opacity='0';
      const field=record.field,targetSize=Number(target.dataset?.fieldSize);
      const tracked=field?.size>0&&targetSize>0;
      const scale=tracked?targetSize/field.size:Math.min(rect.width/record.rect.width,rect.height/record.rect.height);
      const x=rect.left+(tracked?Number(target.dataset.fieldCx)-field.x*scale:(rect.width-record.rect.width*scale)/2)-record.rect.left;
      const y=rect.top+(tracked?Number(target.dataset.fieldCy)-field.y*scale:(rect.height-record.rect.height*scale)/2)-record.rect.top;
      record.animation=record.overlay.animate([
        {transform:'translate(0, 0) scale(1)',opacity:1,offset:0},
        {opacity:1,offset:.72},
        {transform:`translate(${x}px, ${y}px) scale(${scale})`,opacity:0,offset:1}
      ],{duration:360,easing});
      // Cleanup restores the real surface even after cancellation or browser failure.
      const finished=()=>{if(portal===record)clearPortal(record);};
      record.animation.finished.then(finished,finished);
    }catch{clearPortal(record);}
  }

  function settleRoute({changed=false}={}){
    clearEntrance();
    if(portal?.animation)clearPortal();
    if(!changed||!allowed()){clearPortal();return;}
    // Only the artwork travels. Reading text keeps its exact position throughout navigation.
    flyPortal();
    const page=root.querySelector('.reading-paper')||root.querySelector('main');
    if(typeof page?.animate!=='function')return;
    try{
      const animation=page.animate([
        {opacity:.94},
        {opacity:1}
      ],{duration:280,easing});
      entrance=animation;
      const finished=()=>{if(entrance===animation)entrance=null;};
      animation.finished.then(finished,finished);
    }catch{/* Animation support must never hold up a route or hide its content. */}
  }

  function destroy(){destroyed=true;clearEffects();for(const remove of cleanup)remove();cleanup.length=0;}

  listen(document,'visibilitychange',preferenceChanged);
  listen(view,'blur',clearEffects);
  listen(motionPreference,'change',preferenceChanged);
  if(view?.MutationObserver&&document?.body){
    const observer=new view.MutationObserver(preferenceChanged);
    observer.observe(document.body,{attributes:true,attributeFilter:['class']});
    cleanup.push(()=>observer.disconnect());
  }

  return {prepareRoute,settleRoute,destroy};
}
