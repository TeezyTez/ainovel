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
  forest:{sky:'#acbcb0',haze:'#e0ddc2',far:'#7b9991',ridge:'#557e79',land:'#355d58',deep:'#243e3c',water:'#668b86',paper:'#f0e7cc',light:'#dbcba0',accent:'#b78966'},
  clay:{sky:'#bdaba1',haze:'#eee0c8',far:'#a89697',ridge:'#867b83',land:'#625b69',deep:'#3e3a48',water:'#8c9395',paper:'#f5e5c8',light:'#e7bc88',accent:'#b16e55'},
  midnight:{sky:'#728897',haze:'#c8c8bd',far:'#758c96',ridge:'#506c7d',land:'#365364',deep:'#283d50',water:'#647f8c',paper:'#e7dfc6',light:'#e4c98e',accent:'#b58768'},
  gold:{sky:'#c1b494',haze:'#ece2c7',far:'#a6aa94',ridge:'#7d8c79',land:'#566b5f',deep:'#354b46',water:'#899f91',paper:'#f6e8c8',light:'#e4c38b',accent:'#aa7860'},
  plum:{sky:'#aca3b5',haze:'#e4d7cc',far:'#9b95a8',ridge:'#787d92',land:'#565e76',deep:'#383f55',water:'#878da0',paper:'#efe3d0',light:'#e4c6a0',accent:'#ac7f78'},
  slate:{sky:'#a3b7bb',haze:'#e3e0ce',far:'#8ca3a5',ridge:'#68868c',land:'#49656d',deep:'#2c4854',water:'#829fa5',paper:'#f0e5cd',light:'#e3c899',accent:'#ad856b'}
};
const tau=Math.PI*2;

// All scenes share a 400-unit height. Wider surfaces reveal more landscape;
// landmarks keep their proportions and remain useful transfer-animation targets.
function sceneTools(ctx){
  return {
    shape(points,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();},
    line(points,color,width=1,alpha=1){ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();},
    rect(x,y,w,h,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(x,y,w,h);},
    ellipse(x,y,rx,ry,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,tau);ctx.fill();},
    curve(start,controls,color,width=1,alpha=1){ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...start);controls.forEach(c=>ctx.bezierCurveTo(...c));ctx.stroke();}
  };
}

function arch(ctx,x,y,width,height){
  const r=width/2;
  ctx.beginPath();ctx.moveTo(x,y+height);ctx.lineTo(x,y+r);
  ctx.arc(x+r,y+r,r,Math.PI,tau);ctx.lineTo(x+width,y+height);ctx.closePath();
}

function birds(g,x,y,c){
  g.curve([x-10,y],[[x-5,y-4,x-2,y-3,x,y],[x+2,y-4,x+6,y-5,x+11,y-2]],c,1.2,.6);
  g.curve([x+28,y+13],[[x+32,y+10,x+35,y+10,x+38,y+13],[x+41,y+10,x+44,y+10,x+47,y+12]],c,.9,.45);
}

function branch(g,x,y,scale,c){
  g.curve([x,y],[[x+8*scale,y-30*scale,x-5*scale,y-55*scale,x+18*scale,y-95*scale]],c,2.3*scale,.85);
  for(let i=0;i<6;i++){
    const lx=x+(i%2?10:-7)*scale,ly=y-(22+i*12)*scale;
    g.ellipse(lx,ly,11*scale,3.5*scale,c,.82);
  }
}

function sky(ctx,g,p,edge,seed){
  const wash=ctx.createLinearGradient(0,0,0,320);
  wash.addColorStop(0,p.sky);wash.addColorStop(1,p.haze);
  g.rect(-edge,0,edge*2,400,wash);
  g.ellipse(104,94,43,43,p.paper,.66);
  g.ellipse(104,94,34,34,p.paper,.33);
  // Quiet, horizontal cloud marks establish an engraved print vocabulary.
  g.curve([-edge,126],[[-120,126,-143,111,-34,115],[13,116,4,125,79,124]],p.paper,1,.35);
  g.curve([112,151],[[183,144,204,157,edge,149]],p.paper,1,.32);
  for(let i=0;i<48;i++){
    const x=((i*97+seed*41)%(Math.ceil(edge*2)+1))-edge;
    const y=20+((i*53+seed*17)%330);
    g.ellipse(x,y,.55,.55,p.paper,.13);
  }
}

function harbor(ctx,g,p,edge){
  g.shape([[-edge,237],[-edge,216],[-220,211],[-163,191],[-122,204],[-51,193],[11,224],[95,206],[192,224],[edge,210],[edge,260]],p.far);
  const sea=ctx.createLinearGradient(0,227,0,400);sea.addColorStop(0,p.water);sea.addColorStop(1,p.land);
  g.rect(-edge,235,edge*2,165,sea);
  for(let i=0;i<17;i++){
    const y=244+i*9,x=-edge+((i*67)%151);
    g.line([[x,y],[x+40+(i%4)*24,y]],p.paper,.8,.12+(i%3)*.045);
    g.line([[96+(i%4)*22,y+3],[Math.min(edge,202+i*6),y+3]],p.paper,.7,.22);
  }
  g.shape([[-edge,400],[-edge,321],[-167,305],[-95,279],[-37,287],[28,267],[91,291],[136,326],[220,343],[edge,390],[edge,400]],p.deep);
  g.shape([[-174,317],[-95,284],[-34,292],[25,276],[82,296],[139,328],[91,326],[15,303],[-81,314]],p.land);
  g.line([[-151,314],[-90,291],[-38,299],[25,284],[64,296]],p.paper,1.2,.23);
  // Limestone lighthouse: a lit face, shaded return, copper cap and lantern.
  g.shape([[-25,285],[-10,125],[27,125],[43,285]],p.paper);
  g.shape([[12,125],[27,125],[43,285],[15,285]],p.far);
  g.rect(-15,119,47,9,p.deep);g.rect(-7,93,30,26,p.light);
  g.rect(12,94,11,25,p.accent,.75);
  g.line([[-7,93],[-7,119],[23,119],[23,93]],p.deep,3);
  g.line([[8,94],[8,118]],p.deep,2);
  g.shape([[-16,92],[8,71],[33,92]],p.deep);g.line([[8,71],[8,63]],p.deep,2);
  g.rect(-18,116,53,3,p.deep);g.line([[-16,107],[-16,118],[33,118],[33,107]],p.deep,1);
  for(let i=0;i<4;i++)g.line([[-13+i*14,107],[-13+i*14,118]],p.deep,1);
  g.shape([[-6,110],[-177,141],[-177,117],[-6,104]],p.paper,.14);
  g.rect(0,154,8,17,p.deep,.86);g.rect(-3,201,8,16,p.deep,.82);g.rect(-4,259,13,25,p.deep);
  g.line([[-15,245],[34,245]],p.accent,1,.55);g.rect(-33,284,85,6,p.deep);
  // A small sail provides a second scale in the open water.
  g.shape([[149,277],[200,277],[191,286],[158,285]],p.deep);
  g.line([[173,277],[173,221]],p.deep,1.5);g.shape([[170,227],[170,268],[143,268]],p.paper,.82);
  g.shape([[177,235],[177,269],[197,269]],p.light,.72);
  birds(g,-102,86,p.deep);branch(g,-173,366,.65,p.ridge);
  g.line([[-66,353],[-12,342],[42,350]],p.paper,1,.12);
}

function mountain(ctx,g,p,edge,seed=0){
  const shift=(seed%5-2)*9;
  g.shape([[-edge,302],[-edge,213],[-198,195],[-135,104],[-102,147],[-42,88],[20,188],[68,138],[154,218],[edge,157],[edge,400]],p.far);
  g.shape([[-edge,324],[-226,229],[-141,252],[-48+shift,135],[39,223],[106,181],[191,278],[edge,234],[edge,400]],p.ridge);
  g.shape([[-48+shift,135],[-30,221],[3,252],[-13,213],[8,218]],p.haze,.17);
  g.line([[-157,246],[-106,222],[-48+shift,135],[-69,196]],p.paper,.9,.35);
  g.shape([[-edge,400],[-edge,341],[-153,278],[-98,296],[-39,271],[12,274],[64,252],[130,280],[edge,291],[edge,400]],p.land);
  g.curve([-edge,290],[[-112,269,-81,278,-2,265],[105,247,112,277,edge,265]],p.haze,21,.38);
  g.curve([-edge,300],[[-114,281,-82,290,6,278],[107,262,136,286,edge,278]],p.paper,1.3,.3);
  // A modest mountain gate and the pale path leading to it.
  g.shape([[-45,400],[-29,364],[28,337],[46,306],[74,277],[91,277],[63,316],[39,347],[-5,376],[-16,400]],p.haze,.55);
  for(let i=0;i<6;i++)g.line([[40-i*9,333+i*9],[60-i*11,333+i*9]],p.deep,1,.26);
  g.rect(60,246,6,33,p.deep);g.rect(89,246,6,33,p.deep);
  g.rect(61,246,33,6,p.paper);g.shape([[46,247],[63,240],[78,224],[92,240],[109,247]],p.deep);
  g.line([[48,247],[109,247]],p.light,1.5,.7);g.rect(75,252,6,10,p.accent);
  g.shape([[-edge,400],[-edge,367],[-196,347],[-154,363],[-103,355],[-59,384],[-18,400]],p.deep);
  g.shape([[130,400],[165,357],[197,345],[244,359],[edge,330],[edge,400]],p.deep);
  branch(g,-135,370,.8,p.deep);branch(g,184,357,.55,p.deep);birds(g,-99,74,p.deep);
}

function books(ctx,g,p,edge,seed){
  g.rect(-edge,0,edge*2,400,p.deep,.36);
  // The shop's arched display is a solid architectural object, not an icon.
  ctx.globalAlpha=1;arch(ctx,-149,32,298,302);ctx.fillStyle=p.deep;ctx.fill();
  ctx.save();arch(ctx,-136,45,272,278);ctx.clip();
  const glow=ctx.createLinearGradient(0,45,0,323);glow.addColorStop(0,p.paper);glow.addColorStop(1,p.light);
  g.rect(-136,45,272,280,glow);g.ellipse(57,103,83,83,p.paper,.35);
  g.shape([[-136,227],[-136,175],[-94,159],[-59,190],[-19,172],[20,189],[54,165],[136,201],[136,247]],p.far,.36);
  for(let i=0;i<12;i++){
    const x=-123+i*22,y=66+(i*47)%112;
    g.line([[x,y],[x-4,y+21]],p.paper,1.2,.52);
  }
  g.rect(-136,160,272,7,p.deep);g.rect(-4,45,8,222,p.deep);
  g.line([[-128,58],[-128,316]],p.paper,1,.3);
  // Two shelves of differently sized, deterministic book spines.
  for(let row=0;row<2;row++){
    const base=242+row*69;
    for(let i=0;i<14;i++){
      const x=-121+i*18,height=25+((i*13+row*17+seed)%23),color=[p.deep,p.accent,p.ridge,p.paper][(i+row)%4];
      g.rect(x,base-height,12+(i%3),height,color,.9);
      g.line([[x+3,base-height+5],[x+3,base-4]],p.paper,.8,.3);
      if(i%3===0)g.line([[x+2,base-8],[x+10,base-8]],p.light,1,.65);
    }
    g.rect(-136,base,272,7,p.deep);g.line([[-136,base],[136,base]],p.paper,1,.4);
  }
  ctx.restore();
  g.rect(-161,322,322,13,p.deep);g.rect(-153,322,307,2,p.paper,.48);
  g.line([[-edge,338],[edge,338]],p.deep,2,.38);
  g.rect(-edge,350,edge*2,50,p.deep,.83);
  g.ellipse(2,368,119,12,p.deep,.35);
  // An open book catches the window light on the sill.
  g.shape([[-83,336],[-43,330],[0,341],[43,330],[83,336],[100,361],[53,353],[0,367],[-53,353],[-100,361]],p.paper);
  g.shape([[0,341],[43,330],[83,336],[100,361],[53,353],[0,367]],p.light,.65);
  g.line([[0,341],[0,365]],p.deep,1,.6);
  for(let i=0;i<3;i++){
    g.line([[-73,339+i*5],[-45,337+i*5],[-12,347+i*4]],p.deep,.7,.22);
    g.line([[12,347+i*4],[45,337+i*5],[73,339+i*5]],p.deep,.7,.22);
  }
  g.line([[0,17],[0,75]],p.deep,1.5);g.shape([[-25,91],[-13,75],[13,75],[25,91]],p.deep);
  g.ellipse(0,92,17,3,p.light);
  branch(g,-197,349,.85,p.deep);branch(g,196,353,.7,p.deep);
}

function tea(ctx,g,p,edge){
  g.rect(-edge,0,edge*2,400,p.ridge,.12);
  // A round garden window sits behind the tea table.
  g.ellipse(18,156,122,122,p.deep);
  ctx.save();ctx.beginPath();ctx.arc(18,156,112,0,tau);ctx.clip();
  const wash=ctx.createLinearGradient(0,40,0,273);wash.addColorStop(0,p.haze);wash.addColorStop(1,p.far);
  g.rect(-104,35,245,245,wash);g.ellipse(73,101,30,30,p.paper,.83);
  g.shape([[-110,240],[-92,157],[-64,174],[-10,122],[53,208],[102,155],[141,186],[141,283],[-110,283]],p.ridge,.55);
  g.shape([[-110,259],[-61,215],[3,226],[66,198],[141,247],[141,283],[-110,283]],p.land,.7);
  g.rect(-105,202,247,5,p.deep);g.rect(16,40,5,231,p.deep);
  ctx.restore();
  g.ellipse(18,156,124,124,p.paper,.04);
  g.rect(-edge,299,edge*2,101,p.deep);g.rect(-edge,299,edge*2,3,p.paper,.36);
  g.shape([[-166,399],[-121,314],[116,314],[192,399]],p.accent,.19);
  g.ellipse(25,339,112,14,p.deep,.6);g.ellipse(11,322,73,11,p.light);g.ellipse(11,320,58,6,p.paper);
  // Porcelain cup and a handle with an open center.
  g.ellipse(61,280,23,23,p.paper);g.ellipse(62,279,14,14,p.deep);
  ctx.globalAlpha=1;ctx.fillStyle=p.paper;ctx.beginPath();ctx.moveTo(-47,263);ctx.bezierCurveTo(-45,302,-33,317,10,317);ctx.bezierCurveTo(48,317,58,296,59,263);ctx.closePath();ctx.fill();
  g.shape([[20,271],[58,264],[53,294],[41,311],[18,317]],p.light,.64);
  g.ellipse(6,263,53,10,p.paper);g.ellipse(6,263,44,6,p.accent);g.ellipse(3,261,35,3,p.deep,.5);
  g.line([[-24,287],[-19,299]],p.light,2,.56);
  g.curve([-13,237],[[-35,214,8,197,-7,168]],p.paper,2.4,.61);
  g.curve([15,233],[[40,207,-2,188,18,152]],p.paper,1.5,.42);
  g.curve([35,243],[[23,230,52,219,40,197]],p.paper,1,.3);
  g.ellipse(-103,336,18,5,p.light,.64);g.ellipse(-122,342,17,5,p.light,.5);
  branch(g,-173,298,1.3,p.deep);branch(g,191,301,.84,p.deep);
}

function unknownWorld(ctx,g,p,edge,seed){
  // Custom worlds get a seeded landscape through a stone opening. It deliberately
  // suggests possibility rather than claiming to depict their generated events.
  g.shape([[-edge,400],[-edge,283],[-143,251],[-64,283],[27,241],[142,274],[edge,235],[edge,400]],p.far,.65);
  g.shape([[-edge,400],[-edge,343],[-131,304],[-52,327],[31,311],[130,338],[edge,308],[edge,400]],p.land);
  const opening=seed%2===0,width=opening?184:212,left=-width/2;
  ctx.globalAlpha=1;arch(ctx,left-13,48,width+26,282);ctx.fillStyle=p.paper;ctx.fill();
  ctx.save();arch(ctx,left,60,width,270);ctx.clip();
  const inside=ctx.createLinearGradient(0,60,0,330);inside.addColorStop(0,p.deep);inside.addColorStop(1,p.ridge);
  g.rect(left,59,width,274,inside);
  g.ellipse(38,123,29,29,p.light,.92);
  g.shape([[left,272],[left,235],[-67,174],[-17,239],[25,192],[73,243],[width/2,224],[width/2,333],[left,333]],p.far);
  g.shape([[left,333],[left,285],[-48,262],[-3,280],[47,245],[width/2,281],[width/2,333]],p.land);
  g.shape([[-25,333],[-2,303],[25,281],[41,267],[33,292],[17,309],[2,333]],p.paper,.64);
  if(!opening){g.rect(-3,60,6,272,p.paper);g.rect(left,193,width,5,p.paper);}
  for(let i=0;i<9;i++)g.ellipse(-67+((seed+i*47)%141),83+(i*29)%123,.8,.8,p.paper,.58);
  ctx.restore();
  g.shape([[width/2+13,156],[width/2+29,168],[width/2+29,342],[width/2+13,331]],p.deep,.5);
  g.rect(left-23,330,width+46,9,p.deep);g.rect(left-18,329,width+36,3,p.paper);
  g.shape([[-38,400],[-16,358],[-2,340],[25,340],[18,368],[4,400]],p.haze,.43);
  g.line([[left-6,175],[left-6,316]],p.deep,.7,.23);
  branch(g,-154,360,.9,p.deep);branch(g,172,373,1.1,p.deep);birds(g,-143,114,p.deep);
  for(let i=0;i<4;i++)g.line([[-80-i*11,379+i*5],[-56-i*9,379+i*5]],p.paper,.8,.17);
}

function paintScene(ctx,{motif,palette,seed,width,height,x,y}){
  const unit=height/400,edge=width/unit/2+12;
  ctx.save();ctx.translate(width/2+x*2,height*.005+y);ctx.scale(unit,unit);
  ctx.lineCap='round';ctx.lineJoin='round';
  const g=sceneTools(ctx);sky(ctx,g,palette,edge,seed);
  if(motif==='harbor')harbor(ctx,g,palette,edge);
  else if(motif==='mountain')mountain(ctx,g,palette,edge);
  else if(motif==='books')books(ctx,g,palette,edge,seed);
  else if(motif==='tea')tea(ctx,g,palette,edge);
  else unknownWorld(ctx,g,palette,edge,seed);
  // A light keyline ties the different scenes to a shared print-like material.
  g.line([[-edge,399],[edge,399]],palette.paper,1,.22);
  ctx.restore();
}

export function createWorldField({root=globalThis.document}={}){
  const doc=root?.ownerDocument||root,win=doc?.defaultView;
  if(!win)return {mount(){},destroy(){}};
  const media=win.matchMedia('(prefers-reduced-motion: reduce)'),fine=win.matchMedia('(hover: hover) and (pointer: fine)');
  let entries=[],raf=0,last=0,destroyed=false,observer,resizeObserver,cleanup=[];
  const reduced=()=>media.matches||doc.body.classList.contains('reduce-motion');
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
    paintScene(ctx,{motif:host.dataset.worldMotif,palette,seed:item.seed,width:w,height:h,x:item.x,y:item.y});
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
      const surface=host.closest('.discovery-card,.world-current,.world-intro');if(!surface)continue;
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
