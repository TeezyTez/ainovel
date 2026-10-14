const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

/** Async loading, animation scheduling and page lifecycle belong to this controller. */
export function createUniverseMotion({root=globalThis.document,load=()=>import('./universe-scene.js')}={}){
 const doc=root.ownerDocument||root,view=doc.defaultView;
 let teardown=()=>{},generation=0,destroyed=false;
 function mount(){
  teardown();const token=++generation;
  const stage=root.querySelector('[data-universe-stage]');
  if(destroyed||!stage||!view)return;
  const canvas=stage.querySelector('canvas');
  const preference=view.matchMedia('(prefers-reduced-motion: reduce)'),fine=view.matchMedia('(hover: hover) and (pointer: fine)');
  let prefersReduced=preference.matches;
  let scene=null,frame=0,last=0,time=0,visible=true,paused=false,failed=false,progress=0,x=0,y=0,tx=0,ty=0,alive=true;
  const cleanup=[],pause=stage.querySelector('[data-universe-pause]');
  const cursor=stage.querySelector('.universe-cursor'),halo=cursor?.querySelector('i'),ring=cursor?.querySelector('b');
  const trail=[...(cursor?.querySelectorAll('span')||[])].map(element=>({element,x:0,y:0}));
  let pointerInside=false,px=0,py=0,haloX=0,haloY=0;
  const reduced=()=>prefersReduced||doc.body.classList.contains('reduce-motion');
  const running=()=>alive&&visible&&!doc.hidden&&!paused&&!reduced()&&!failed;
  const listen=(target,name,handler,options={passive:true})=>{target.addEventListener(name,handler,options);cleanup.push(()=>target.removeEventListener(name,handler,options));};
  function stop(){if(frame)view.cancelAnimationFrame(frame);frame=0;last=0;}
  function layout(){
   const rect=stage.getBoundingClientRect();
   visible=rect.bottom>0&&rect.top<view.innerHeight;
   progress=reduced()||failed?0:clamp(-rect.top/Math.max(1,rect.height),0,1);
   stage.style.setProperty('--journey-progress',progress.toFixed(4));stage.dataset.progress=progress.toFixed(4);
  }
  function clearCursor(){pointerInside=false;cursor?.removeAttribute('data-visible');}
  function paint(){scene?.draw({time,progress,x,y});}
  function tick(now){
   frame=0;if(!running())return;
   const delta=last?Math.min((now-last)/1000,.05):0;last=now;time+=delta;
   x+=(tx-x)*Math.min(1,delta*5);y+=(ty-y)*Math.min(1,delta*5);paint();
   if(pointerInside&&cursor){
    const blend=Math.min(1,delta*12);haloX+=(px-haloX)*blend;haloY+=(py-haloY)*blend;
    halo.style.transform=`translate3d(${haloX}px,${haloY}px,0)`;
    ring.style.transform=`translate3d(${px}px,${py}px,0)`;
    let previousX=px,previousY=py;
    trail.forEach((point,index)=>{
     point.x+=(previousX-point.x)*Math.min(1,delta*16);point.y+=(previousY-point.y)*Math.min(1,delta*16);
     const spread=Math.hypot(previousX-point.x,previousY-point.y);
     point.element.style.transform=`translate3d(${point.x}px,${point.y}px,0) scale(${1-index*.1})`;
     point.element.style.opacity=String(Math.min(.6,spread*.05)*(1-index*.13));
     previousX=point.x;previousY=point.y;
    });
   }
   frame=view.requestAnimationFrame(tick);
  }
  function sync(){
   if(!alive)return;
   layout();stage.dataset.motion=reduced()?'reduced':paused?'paused':visible&&!doc.hidden?'running':'idle';
   if(reduced()){x=y=tx=ty=0;time=0;}
   pause.hidden=!scene||failed||reduced();pause.textContent=paused?'继续动态':'暂停动态';pause.setAttribute('aria-pressed',String(paused));
   if(!running()){stop();clearCursor();}
   if(scene&&visible&&!doc.hidden)paint();
   if(scene&&running()&&!frame)frame=view.requestAnimationFrame(tick);
  }
  function fallback(){
   failed=true;stop();scene?.dispose();scene=null;
   stage.dataset.sceneFallback='true';delete stage.dataset.sceneReady;
   sync();
  }
  listen(stage,'pointermove',event=>{
   if(!fine.matches||event.pointerType==='touch'||reduced()||paused)return;
   const rect=stage.getBoundingClientRect();tx=clamp((event.clientX-rect.left)/rect.width*2-1,-1,1);ty=clamp((event.clientY-rect.top)/rect.height*2-1,-1,1);
   px=event.clientX-rect.left;py=event.clientY-rect.top;
   if(!pointerInside){haloX=px;haloY=py;trail.forEach(point=>{point.x=px;point.y=py;});}
   pointerInside=true;cursor?.setAttribute('data-visible','true');
  });
  listen(stage,'pointerleave',()=>{tx=ty=0;clearCursor();});
  listen(stage,'pointerdown',event=>{if(event.pointerType==='touch')clearCursor();});
  listen(pause,'click',()=>{paused=!paused;sync();});
  listen(view,'scroll',()=>{clearCursor();sync();});
  listen(view,'resize',()=>{scene?.resize();sync();});
  listen(view,'blur',()=>{tx=ty=0;clearCursor();});
  listen(fine,'change',()=>{if(!fine.matches)clearCursor();});
  listen(doc,'visibilitychange',sync);listen(preference,'change',event=>{prefersReduced=event.matches;sync();});
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();if(alive)fallback();},{passive:false});
  const observer=new view.MutationObserver(sync);observer.observe(doc.body,{attributes:true,attributeFilter:['class','data-theme']});cleanup.push(()=>observer.disconnect());
  const resize=new view.ResizeObserver(()=>{scene?.resize();sync();});resize.observe(stage);cleanup.push(()=>resize.disconnect());
  teardown=()=>{alive=false;stop();cleanup.forEach(remove=>remove());scene?.dispose();scene=null;};
  sync();
  load().then(module=>{
   if(!alive||token!==generation||!stage.isConnected)return;
   try{scene=module.createUniverseScene({canvas,stage});stage.dataset.sceneReady='true';sync();}catch{fallback();}
  }).catch(()=>{if(alive)fallback();});
 }
 return {mount,unmount(){++generation;teardown();teardown=()=>{};},destroy(){destroyed=true;++generation;teardown();}};
}
