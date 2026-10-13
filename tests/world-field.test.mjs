import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldField,portalPoint} from '../src/world-field.js';

function fixture({width=600,height=300,motif='portal',seed='57',recordDrawing=false}={}){
 let now=0,reduced=false,appReduced=false,paints=0,io,settings,id=0;
 const frames=new Map(),events=new Map(),mediaEvents=new Map(),documentEvents=new Map(),styles=new Map(),drawing=[];
 const record=(method,args)=>{if(recordDrawing)drawing.push([method,...args]);};
 const gradient=()=>({addColorStop(...args){record('addColorStop',args);}});
 const context=new Proxy({clearRect(){paints++;},createRadialGradient:gradient,createLinearGradient:gradient},{
  get:(obj,key)=>key in obj?obj[key]:(...args)=>record(key,args),
  set(obj,key,value){obj[key]=value;record(key,[typeof value==='object'?'gradient':value]);return true;}
 });
 const surface={classList:{contains:()=>false},style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},getBoundingClientRect:()=>({left:0,top:0,width:600,height:300}),addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)};
 const canvas={getContext:()=>context,width:0,height:0};
 const host={clientWidth:width,clientHeight:height,dataset:{fieldSeed:seed,worldTone:'plum',worldMotif:motif},parentElement:{classList:{contains:()=>false}},querySelector:()=>canvas,closest:()=>surface};
 const win={devicePixelRatio:2,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
  matchMedia:query=>query.includes('reduced')?{get matches(){return reduced;},addEventListener:(k,f)=>mediaEvents.set(k,f),removeEventListener:k=>mediaEvents.delete(k)}:{matches:true},
  IntersectionObserver:class{constructor(fn){io=fn;}observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{constructor(fn){settings=fn;}observe(){}disconnect(){}}
 };
 const doc={defaultView:win,hidden:false,body:{classList:{contains:()=>appReduced}},querySelectorAll:()=>[host],addEventListener:(key,fn)=>documentEvents.set(key,fn),removeEventListener:key=>documentEvents.delete(key)};
 const field=createWorldField({root:doc});
 return {field,canvas,host,drawing,events,frames,styles,documentEvents,get paints(){return paints;},visible(value=true){io([{target:host,isIntersecting:value}]);},hide(value=true){doc.hidden=value;documentEvents.get('visibilitychange')();},step(ms=16){now+=ms;const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn(now));},reduce(value=true){reduced=value;mediaEvents.get('change')();},appReduce(){appReduced=true;settings();}};
}

test('portal surfaces remain finite and closed across seeds and pointer extremes',()=>{
 for(const seed of [0,1,99])for(const x of [-1,0,1]){
  const a=portalPoint(0,.8,{seed,x}),b=portalPoint(2*Math.PI,.8,{seed,x});
  for(const key of ['x','y','z']){assert.ok(Number.isFinite(a[key]));assert.ok(Math.abs(a[key]-b[key])<1e-9);}
 }
});
test('visible entrance settles to zero scheduled frames and bounds canvas density',()=>{
 const f=fixture();f.field.mount();f.visible();
 for(let i=0;i<100;i++)f.step();
 assert.equal(f.frames.size,0);assert.ok(f.paints>2);assert.equal(f.canvas.width,900);
 f.field.destroy();
});
test('offscreen motion stops, remount cleans listeners, destroy prevents reinstallation',()=>{
 const f=fixture();f.field.mount();f.visible();f.step();f.visible(false);f.step();assert.equal(f.frames.size,0);
 f.field.mount();assert.equal(f.events.size,2);
 f.field.destroy();assert.equal(f.events.size,0);assert.equal(f.frames.size,0);f.field.mount();assert.equal(f.events.size,0);
});
test('system and app reduced motion cancel scheduled effects while retaining static art',()=>{
 for(const app of [false,true]){
  const f=fixture();f.field.mount();f.visible();f.step();
  const before=f.paints;if(app)f.appReduce();else f.reduce();
  assert.ok(f.paints>before);assert.equal(f.frames.size,0);
  f.events.get('pointermove')({clientX:580,clientY:40,pointerType:'mouse'});
  assert.equal(f.frames.size,0);f.field.destroy();
 }
});
test('pointer changes settle after leaving without leaving a render loop running',()=>{
 const f=fixture();f.field.mount();f.visible();f.step(1200);
 f.events.get('pointermove')({clientX:580,clientY:40,pointerType:'mouse'});f.step();
 assert.ok(f.styles.has('--field-x'));f.events.get('pointerleave')();
 for(let i=0;i<150;i++)f.step();
 assert.equal(f.frames.size,0);f.field.destroy();
});
test('all landscape motifs render finite artwork and keep centered targets across surface proportions',()=>{
 for(const motif of ['harbor','mountain','books','tea','portal'])for(const [width,height] of [[320,180],[740,230],[260,310]]){
  const f=fixture({motif,width,height,recordDrawing:true});f.field.mount();
  assert.ok(f.drawing.some(([method])=>method==='fill'),'the surface contains painted shapes');
  for(const call of f.drawing)for(const value of call.slice(1))if(typeof value==='number')assert.ok(Number.isFinite(value),`${motif}: ${call[0]} has a finite coordinate`);
  assert.deepEqual([Number(f.host.dataset.fieldCx),Number(f.host.dataset.fieldCy),Number(f.host.dataset.fieldSize)],[width/2,height/2,height/2]);
  assert.equal(f.canvas.width,Math.round(width*1.5));assert.equal(f.canvas.height,Math.round(height*1.5));f.field.destroy();
 }
});
test('the same custom-world seed paints deterministically while another seed changes its landscape details',()=>{
 const render=seed=>{const f=fixture({seed,recordDrawing:true});f.field.mount();const drawing=JSON.stringify(f.drawing);f.field.destroy();return drawing;};
 assert.equal(render('57'),render('57'));assert.notEqual(render('57'),render('58'));
});
test('hidden documents stop rendering and destroy removes the visibility listener',()=>{
 const f=fixture();f.field.mount();f.visible();f.step();f.hide();const paints=f.paints;
 assert.equal(f.frames.size,0);f.step();assert.equal(f.paints,paints);
 f.hide(false);assert.equal(f.frames.size,1);f.field.destroy();assert.equal(f.documentEvents.size,0);
});
