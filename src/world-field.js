// Original decorative world illustrations. No external assets or story state.
export function portalPoint(u,v,{seed=0,x=0,y=0,phase=0}={}){
  const lobes=seed%3+2;
  const wave=Math.sin(u*lobes+seed*.7+phase)*(seed%2 ? .075 : .022);
  const radius=.68+.17*Math.cos(v)+wave;
  let px=radius*Math.cos(u),py=radius*Math.sin(u),pz=.17*Math.sin(v);
  const tilt=.62+Math.sin(seed)*.24+x*.25,roll=-.25+Math.cos(seed)*.6+y*.16;
  const qx=px*Math.cos(tilt)+pz*Math.sin(tilt);
  pz=-px*Math.sin(tilt)+pz*Math.cos(tilt);px=qx;
  const rx=px*Math.cos(roll)-py*Math.sin(roll);
  py=px*Math.sin(roll)+py*Math.cos(roll);
  const depth=2.9/(2.9-pz);
  return {x:rx*depth,y:py*depth,z:pz};
}

const palettes={
  forest:{sky:'#090e28',haze:'#1c2b82',far:'#537aff',ridge:'#3045a1',land:'#182554',deep:'#080b1b',water:'#375bcc',paper:'#f4f3ff',light:'#8ba9ff',accent:'#f15cff'},
  clay:{sky:'#210b22',haze:'#7e2049',far:'#f64d78',ridge:'#992c5a',land:'#481333',deep:'#130b1e',water:'#b83361',paper:'#fff4fc',light:'#ff8fbd',accent:'#9876ff'},
  midnight:{sky:'#07122e',haze:'#183c9d',far:'#438bff',ridge:'#2453b1',land:'#122d62',deep:'#060b20',water:'#316beb',paper:'#f1f6ff',light:'#7dbdff',accent:'#ba78ff'},
  gold:{sky:'#160b32',haze:'#552a9f',far:'#ad68ff',ridge:'#693fb0',land:'#34205d',deep:'#0c0920',water:'#714ed1',paper:'#fbf6ff',light:'#d6a2ff',accent:'#5995ff'},
  plum:{sky:'#200a30',haze:'#782590',far:'#e660dc',ridge:'#9136a7',land:'#481853',deep:'#12091e',water:'#a23bb7',paper:'#fff4ff',light:'#f99aff',accent:'#718dff'},
  slate:{sky:'#0b1031',haze:'#262773',far:'#7c72ff',ridge:'#443fa6',land:'#242052',deep:'#080a1d',water:'#5049c3',paper:'#f5f4ff',light:'#a39aff',accent:'#ff617f'}
};
const tau=Math.PI*2;

// Artwork uses a 400-unit height so its central gateway keeps the same proportions
// in a discovery card, a detail cover, and the shared entrance transition.
function sceneTools(ctx){
  return {
    shape(points,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();},
    line(points,color,width=1,alpha=1){ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();},
    rect(x,y,w,h,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(x,y,w,h);},
    ellipse(x,y,rx,ry,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,tau);ctx.fill();},
    ring(x,y,rx,ry,color,width=1,alpha=1,rotation=0){ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.ellipse(x,y,rx,ry,rotation,0,tau);ctx.stroke();},
    curve(start,controls,color,width=1,alpha=1){ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...start);controls.forEach(c=>ctx.bezierCurveTo(...c));ctx.stroke();}
  };
}

function glow(ctx,g,x,y,r,color,alpha=1){
  const light=ctx.createRadialGradient(x,y,0,x,y,r);
  light.addColorStop(0,color);light.addColorStop(1,`${color}00`);
  g.ellipse(x,y,r,r,light,alpha);
}

function cosmos(ctx,g,p,edge,seed){
  const wash=ctx.createLinearGradient(-edge,0,edge,400);
  wash.addColorStop(0,'#080810');wash.addColorStop(.52,p.sky);wash.addColorStop(1,'#080810');
  g.rect(-edge,-12,edge*2,424,wash);
  glow(ctx,g,-62,156,285,p.haze,.75);
  glow(ctx,g,148,252,185,p.accent,.15);
  // Seeded stars stay still: no perpetual particle loop or reading distraction.
  for(let i=0;i<72;i++){
    const x=((i*137+seed*43)%(Math.ceil(edge*2)+1))-edge;
    const y=8+((i*79+seed*19)%384),radius=i%11===0?1.2:.48;
    g.ellipse(x,y,radius,radius,p.paper,i%7===0?.5:.18);
    if(i%23===0){g.line([[x-4,y],[x+4,y]],p.paper,.6,.28);g.line([[x,y-4],[x,y+4]],p.paper,.6,.28);}
  }
  // Long orbital paths continue beyond the aperture to give wide covers depth.
  g.ring(12,204,Math.max(245,edge*.75),99,p.light,.6,.13,-.3);
  g.ring(-20,200,Math.max(285,edge*.9),116,p.paper,.5,.07,.29);
  g.line([[-edge,351],[edge,351]],p.light,.6,.07);
}

function sceneSky(ctx,g,p,seed){
  const wash=ctx.createLinearGradient(0,20,0,330);
  wash.addColorStop(0,p.sky);wash.addColorStop(.58,p.haze);wash.addColorStop(1,p.far);
  g.rect(-210,0,420,400,wash);
  glow(ctx,g,73,135,124,p.light,.23);
  g.ellipse(73,117,36,36,p.paper,.92);
  g.ellipse(84,110,35,35,p.haze,.88);
  for(let i=0;i<23;i++)g.ellipse(-159+((i*53+seed*31)%318),35+(i*41)%154,.65,.65,p.paper,.3);
}

function harbor(ctx,g,p){
  g.shape([[-220,275],[-220,223],[-144,202],[-87,226],[-32,214],[26,229],[109,199],[220,231],[220,290]],p.ridge);
  const water=ctx.createLinearGradient(0,245,0,400);water.addColorStop(0,p.water);water.addColorStop(1,p.deep);
  g.rect(-220,245,440,160,water);
  for(let i=0;i<15;i++){
    const y=253+i*8;
    g.line([[-195+(i%4)*17,y],[-101+(i%3)*19,y]],p.light,.7,.24);
    g.line([[67+(i%3)*9,y+3],[166-(i%4)*7,y+3]],p.paper,.65,.24);
  }
  g.shape([[-220,400],[-220,341],[-124,298],[-63,287],[-3,298],[52,344],[149,373],[220,400]],p.deep);
  g.shape([[-96,303],[-70,272],[-18,272],[5,312]],p.land);
  g.shape([[-72,278],[-58,114],[-29,114],[-13,278]],p.paper);
  g.shape([[-43,114],[-29,114],[-13,278],[-39,278]],p.far);
  g.rect(-61,98,35,20,p.deep);g.rect(-55,100,22,16,p.light);
  g.shape([[-67,98],[-44,76],[-20,98]],p.deep);
  g.line([[-44,76],[-44,65]],p.light,1,.9);
  g.line([[-67,120],[-22,120]],p.light,2,.9);
  g.rect(-51,151,9,19,p.deep);g.rect(-52,201,9,19,p.deep);g.rect(-50,253,13,24,p.deep);
  // The beam cuts a warm wedge through the cold ocean atmosphere.
  g.shape([[-32,104],[210,57],[210,131],[-32,110]],p.light,.12);
  glow(ctx,g,-43,108,44,p.light,.28);
  g.shape([[96,277],[154,277],[144,289],[106,286]],p.deep);
  g.line([[124,277],[124,215]],p.light,1,.75);
  g.shape([[120,220],[120,269],[93,269]],p.paper,.9);
  g.shape([[129,235],[129,269],[150,269]],p.light,.66);
  g.line([[-94,301],[-61,289],[-18,294]],p.light,1,.42);
}

function mountain(ctx,g,p,seed){
  const offset=(seed%5-2)*7;
  g.shape([[-220,330],[-220,252],[-157,201],[-113,227],[-46+offset,111],[30,225],[101,159],[220,259],[220,400]],p.ridge);
  g.shape([[-46+offset,111],[-61,223],[-18,243],[30,225]],p.far,.65);
  g.line([[-46+offset,111],[-79,190],[-101,217]],p.light,1,.73);
  g.shape([[-220,400],[-220,309],[-123,266],[-50,318],[21,254],[100,287],[174,239],[220,292],[220,400]],p.land);
  // Floating strata turn a familiar mountain landscape into another reality.
  for(const [x,y,w,h] of [[-117,158,47,26],[78,107,42,31],[122,213,35,22]]){
    g.shape([[x-w,y],[x+w,y-4],[x+w*.45,y+h],[x-w*.2,y+h*.75]],p.deep);
    g.line([[x-w,y],[x,y-9],[x+w,y-4]],p.light,1,.78);
    g.line([[x-w*.2,y+4],[x,y+h*.65]],p.far,1,.5);
  }
  g.curve([-212,296],[[-130,266,-46,315,14,281],[81,255,136,281,213,262]],p.paper,15,.12);
  g.shape([[-35,400],[-20,355],[24,329],[51,298],[74,274],[88,273],[64,313],[43,345],[3,370],[-6,400]],p.light,.6);
  g.rect(62,242,5,35,p.deep);g.rect(89,242,5,35,p.deep);
  g.rect(60,242,37,5,p.light);
  g.shape([[48,242],[62,235],[79,219],[94,235],[109,242]],p.deep);
  g.line([[48,242],[109,242]],p.paper,1,.8);
  g.rect(76,248,5,10,p.accent);
}

function books(ctx,g,p,seed){
  g.rect(-220,0,440,400,p.sky,.72);
  glow(ctx,g,0,187,155,p.light,.3);
  // Receding shelves form an impossible, luminous library corridor.
  for(let layer=0;layer<5;layer++){
    const inset=layer*23,left=-184+inset,right=184-inset,top=41+layer*24,bottom=369-layer*20;
    const c=layer%2?p.ridge:p.land;
    g.line([[left,bottom],[left,top],[right,top],[right,bottom]],c,14,.9);
    g.line([[left+7,bottom],[left+7,top+7],[right-7,top+7],[right-7,bottom]],p.light,.8,.42);
    for(let row=0;row<3;row++){
      const base=top+51+row*(bottom-top-57)/3;
      for(let i=0;i<5-layer%2;i++){
        const h=13+((i*7+row*11+seed)%18);
        g.rect(left+9+i*6,base-h,4,h,[p.far,p.light,p.accent][(i+row)%3],.8);
        g.rect(right-13-i*6,base-h,4,h,[p.light,p.far,p.accent][(i+row)%3],.66);
      }
      g.line([[left+6,base+2],[left+43,base+2]],p.light,.8,.6);
      g.line([[right-6,base+2],[right-43,base+2]],p.light,.8,.6);
    }
  }
  g.ellipse(0,185,24,43,p.paper,.16);
  g.ring(0,185,28,47,p.light,1,.7);
  g.shape([[-125,400],[-34,231],[34,231],[125,400]],p.deep);
  g.line([[-106,399],[-26,232]],p.light,1,.54);g.line([[106,399],[26,232]],p.light,1,.54);
  for(let i=0;i<5;i++)g.line([[-37-i*16,250+i*28],[37+i*16,250+i*28]],p.light,.65,.3);
  // A suspended open volume is the foreground anchor.
  g.ellipse(0,318,82,9,p.light,.12);
  g.shape([[-96,251],[-51,242],[0,259],[51,242],[96,251],[110,282],[53,273],[0,291],[-53,273],[-110,282]],p.paper);
  g.shape([[0,259],[51,242],[96,251],[110,282],[53,273],[0,291]],p.light,.8);
  g.line([[0,259],[0,291]],p.deep,1,.6);
  for(let i=0;i<3;i++){
    g.line([[-80,251+i*6],[-53,249+i*6],[-15,263+i*6]],p.deep,.6,.34);
    g.line([[15,263+i*6],[53,249+i*6],[80,251+i*6]],p.deep,.6,.34);
  }
}

function tea(ctx,g,p){
  g.shape([[-210,300],[-210,237],[-129,153],[-84,219],[-31,171],[39,255],[122,195],[210,248],[210,400]],p.ridge,.82);
  g.shape([[-210,400],[-210,302],[-102,246],[-23,281],[49,241],[133,272],[210,254],[210,400]],p.land);
  g.ring(0,178,103,103,p.light,1,.38);
  g.ring(0,178,91,91,p.paper,.6,.21);
  g.line([[0,75],[0,124]],p.light,.8,.4);
  g.line([[-104,178],[-51,178]],p.light,.8,.4);
  g.line([[104,178],[51,178]],p.light,.8,.4);
  g.ellipse(0,337,113,12,p.light,.12);
  g.ellipse(0,302,83,12,p.light);g.ellipse(0,299,70,7,p.paper);
  // Porcelain floats above the landscape, its steam becoming an orbital ribbon.
  g.ring(55,254,23,23,p.paper,10,1);g.ring(57,253,14,14,p.light,1,.8);
  ctx.globalAlpha=1;ctx.fillStyle=p.paper;ctx.beginPath();ctx.moveTo(-57,234);ctx.bezierCurveTo(-55,273,-43,295,0,295);ctx.bezierCurveTo(43,295,54,273,55,234);ctx.closePath();ctx.fill();
  g.shape([[20,241],[54,236],[48,272],[29,291],[5,296]],p.light,.55);
  g.ellipse(-1,234,56,11,p.paper);g.ellipse(-1,234,47,7,p.deep);g.ellipse(0,232,36,4,p.accent,.7);
  g.curve([-11,215],[[-63,177,30,151,-3,110]],p.paper,1.5,.8);
  g.curve([14,215],[[62,176,-22,156,17,125]],p.light,2,.65);
  g.ring(0,169,49,16,p.paper,.8,.45,-.42);
  g.ellipse(26,111,2,2,p.light,.9);
}

function unknownWorld(ctx,g,p,edge,seed){
  const offset=(seed%5-2)*8;
  // The custom-world artwork suggests possibility without inventing story facts.
  g.rect(-220,0,440,400,p.sky,.55);
  glow(ctx,g,0,185,154,p.light,.32);
  g.ellipse(58+offset,124,51,51,p.paper,.82);
  g.ellipse(71+offset,113,47,47,p.haze);
  g.ring(58+offset,124,82,18,p.light,1,.55,-.38);
  g.shape([[-220,340],[-220,242],[-131,266],[-47,208],[42,258],[117,230],[220,249],[220,400]],p.ridge);
  g.shape([[-220,400],[-220,306],[-122,278],[-21,306],[68,273],[161,314],[220,295],[220,400]],p.land);
  // A monolithic opening crosses the horizon; stacked planes imply other layers.
  const left=-57+offset,width=106;
  g.shape([[left,291],[left,141],[left+width,107],[left+width,265]],p.deep);
  g.shape([[left+width,107],[left+width+11,112],[left+width+11,272],[left+width,265]],p.far);
  const inner=ctx.createLinearGradient(left,135,left+width,283);inner.addColorStop(0,p.light);inner.addColorStop(.6,p.far);inner.addColorStop(1,p.deep);
  g.shape([[left+9,282],[left+9,148],[left+width-8,120],[left+width-8,262]],inner);
  g.line([[left+1,290],[left+1,142],[left+width,107]],p.paper,1.6,.9);
  g.line([[left+9,282],[left+9,148],[left+width-8,120]],p.light,2,.9);
  g.shape([[left+9,282],[left+48,262],[left+width-8,262],[20,337],[-45,350]],p.light,.18);
  g.shape([[-48,400],[-29,356],[1,313],[25,285],[34,285],[19,325],[3,366],[-15,400]],p.paper,.55);
  for(const [x,y,w] of [[-105,170,24],[101,203,20],[-125,274,17]]){
    g.shape([[x-w,y],[x+w,y-11],[x+w,y-6],[x-w,y+5]],p.light,.75);
    g.line([[x-w,y+12],[x+w,y+1]],p.far,.9,.6);
  }
}

function gateway(ctx,g,p,seed,phase){
  // Concentric optical edges, interrupted orbital marks, and one bright point
  // make each illustration read as a portal instead of a framed landscape.
  g.ring(0,199,176,169,p.light,17,.055);
  g.ring(0,199,174,167,p.light,6,.2);
  g.ring(0,199,172,165,p.light,1.7,.83);
  g.ring(0,199,179,172,p.paper,.6,.35);
  g.ring(0,199,187,180,p.light,.6,.16);
  const angle=-.65+(seed%7)*.1+Math.sin(phase)*.025;
  for(let i=0;i<36;i++){
    if(i%9>5)continue;
    const a=i*tau/36+angle,inner=185,outer=i%3===0?193:189;
    g.line([[Math.cos(a)*inner,199+Math.sin(a)*(inner-7)],[Math.cos(a)*outer,199+Math.sin(a)*(outer-7)]],p.light,.85,i%3===0?.57:.25);
  }
  const px=Math.cos(angle)*174,py=199+Math.sin(angle)*167;
  glow(ctx,g,-px,398-py,46,p.accent,.55);
  glow(ctx,g,px,py,30,p.light,.85);g.ellipse(px,py,2.7,2.7,p.paper);
  g.ring(-3,205,215,109,p.paper,.6,.3,-.28);
}

function paintScene(ctx,{motif,palette:p,seed,width,height,x,y,phase=0}){
  const unit=height/400,edge=width/unit/2+12;
  ctx.save();ctx.translate(width/2,height*.005);ctx.scale(unit,unit);
  ctx.lineCap='round';ctx.lineJoin='round';
  const g=sceneTools(ctx);cosmos(ctx,g,p,edge,seed);
  ctx.save();ctx.translate(x*4,y*2);
  ctx.save();ctx.beginPath();ctx.ellipse(0,199,171,164,0,0,tau);ctx.clip();
  sceneSky(ctx,g,p,seed);
  if(motif==='harbor')harbor(ctx,g,p);
  else if(motif==='mountain')mountain(ctx,g,p,seed);
  else if(motif==='books')books(ctx,g,p,seed);
  else if(motif==='tea')tea(ctx,g,p);
  else unknownWorld(ctx,g,p,edge,seed);
  const shade=ctx.createLinearGradient(0,220,0,370);shade.addColorStop(0,`${p.deep}00`);shade.addColorStop(1,p.deep);
  g.rect(-210,220,420,170,shade,.48);
  ctx.restore();
  gateway(ctx,g,p,seed,phase);ctx.restore();
  // Sparse coordinates remain purely decorative, with no fabricated game stats.
  g.line([[-edge+25,29],[-edge+25,38],[-edge+34,38]],p.paper,.6,.24);
  g.line([[edge-25,361],[edge-25,370],[edge-34,370]],p.paper,.6,.24);
  ctx.restore();
}

export function createWorldField({root=globalThis.document,enabled=()=>true}={}){
  const doc=root?.ownerDocument||root,win=doc?.defaultView;
  if(!win)return {mount(){},destroy(){}};
  const media=win.matchMedia('(prefers-reduced-motion: reduce)'),fine=win.matchMedia('(hover: hover) and (pointer: fine)');
  let entries=[],raf=0,last=0,destroyed=false,observer,resizeObserver,cleanup=[];
  const reduced=()=>!enabled()||media.matches||doc.body.classList.contains('reduce-motion');
  const clear=()=>{win.cancelAnimationFrame(raf);raf=0;observer?.disconnect();resizeObserver?.disconnect();cleanup.forEach(fn=>fn());cleanup=[];entries=[];};
  function paint(item){
    const {canvas,context:ctx,host}=item,w=host.clientWidth,h=host.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(win.devicePixelRatio||1,1.5);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    host.dataset.fieldCx=String(w/2);host.dataset.fieldCy=String(h/2);host.dataset.fieldSize=String(h/2);
    // Always fill the physical bounds before the restrained pointer response.
    // This prevents exposed edges when the artwork moves by a few pixels.
    const palette=palettes[host.dataset.worldTone]||palettes.plum;
    ctx.fillStyle=palette.sky;ctx.fillRect(0,0,w,h);
    paintScene(ctx,{motif:host.dataset.worldMotif,palette,seed:item.seed,width:w,height:h,x:item.x,y:item.y,phase:item.phase});
  }
  function tick(now){
    raf=0;if(destroyed||doc.hidden)return;
    const dt=Math.min(34,last?now-last:16);last=now;let moving=false;
    for(const item of entries){
      if(!item.visible)continue;
      const k=1-Math.exp(-dt/110);
      item.x+=(item.tx-item.x)*k;item.y+=(item.ty-item.y)*k;
      const settling=Math.abs(item.tx-item.x)+Math.abs(item.ty-item.y)>.002;
      const arriving=now<item.until;
      if(!reduced()&&(settling||arriving)){
        item.phase+=dt*.00018;paint(item);moving=true;
        item.surface.style.setProperty('--field-x',`${50+item.x*30}%`);
        item.surface.style.setProperty('--field-y',`${50+item.y*30}%`);
      }
    }
    if(moving)raf=win.requestAnimationFrame(tick);
  }
  function wake(){if(!raf&&!doc.hidden&&!reduced()){last=0;raf=win.requestAnimationFrame(tick);}}
  function reset(){
    win.cancelAnimationFrame(raf);raf=0;
    for(const item of entries){item.x=item.y=item.tx=item.ty=0;item.until=0;item.surface.style.removeProperty('--field-x');item.surface.style.removeProperty('--field-y');paint(item);}
  }
  function mount(){
    clear();if(destroyed)return;
    for(const host of root.querySelectorAll('.world-atmosphere')){
      const canvas=host.querySelector('canvas');if(!canvas)continue;
      let context;try{context=canvas.getContext('2d');}catch{continue;}if(!context)continue;
      const surface=host.closest('.discovery-card,.world-current,.world-intro,.universe-hero-art');if(!surface)continue;
      const seed=Number(host.dataset.fieldSeed)||0;
      const item={host,canvas,context,surface,seed:seed%100,x:0,y:0,tx:0,ty:0,phase:seed%13,visible:false,until:0};entries.push(item);paint(item);
      const move=e=>{if(reduced()||!fine.matches||e.pointerType==='touch')return;const r=surface.getBoundingClientRect();item.tx=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));item.ty=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height*2-1));item.until=win.performance.now()+350;wake();};
      const leave=()=>{item.tx=item.ty=0;wake();};
      surface.addEventListener('pointermove',move,{passive:true});surface.addEventListener('pointerleave',leave);
      cleanup.push(()=>{surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerleave',leave);});
    }
    if(win.IntersectionObserver){observer=new win.IntersectionObserver(records=>{for(const record of records){const item=entries.find(x=>x.host===record.target);if(item){item.visible=record.isIntersecting;item.until=win.performance.now()+1100;}}wake();},{threshold:.05});entries.forEach(item=>observer.observe(item.host));}
    else{entries.forEach(item=>{item.visible=true;});}
    if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(records=>{for(const record of records){const item=entries.find(x=>x.host===record.target);if(item)paint(item);}});entries.forEach(item=>resizeObserver.observe(item.host));}
  }
  const preference=()=>reset(),visibility=()=>{if(doc.hidden){win.cancelAnimationFrame(raf);raf=0;}else wake();};
  media.addEventListener('change',preference);doc.addEventListener('visibilitychange',visibility);
  const settingsObserver=new win.MutationObserver(preference);settingsObserver.observe(doc.body,{attributes:true,attributeFilter:['class']});
  return {mount,destroy(){destroyed=true;clear();media.removeEventListener('change',preference);doc.removeEventListener('visibilitychange',visibility);settingsObserver.disconnect();}};
}
