import test from 'node:test';
import assert from 'node:assert/strict';
import {createInterfaceMotion} from '../src/interface-motion.js';

class Events extends EventTarget{
  listeners=[];
  addEventListener(type,handler,options){super.addEventListener(type,handler,options);this.listeners.push({type,handler,options});}
  removeEventListener(type,handler,options){super.removeEventListener(type,handler,options);this.listeners=this.listeners.filter(listener=>listener.type!==type||listener.handler!==handler);}
  emit(type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});this.dispatchEvent(event);return event;}
}

function fixture(){
  let id=0,appReduced=false;
  const frames=new Map(),observers=new Set();
  const reduced=new Events(),fine=new Events();reduced.matches=false;fine.matches=true;
  const doc=new Events();doc.hidden=false;doc.body={classList:{contains:()=>appReduced}};
  const root=new Events();root.ownerDocument=doc;
  function element(className,parent=root){
    const values=new Map(),attributes=new Map();
    const node={className,parent,values,attributes,style:{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)},
      closest(selector){for(let current=this;current;current=current.parent)if(selector.split(',').some(part=>part.trim()===`.${current.className}`))return current;return null;},
      contains(child){for(let current=child;current;current=current.parent)if(current===this)return true;return false;},
      getBoundingClientRect:()=>({left:10,top:20,width:200,height:100}),
      setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
    return node;
  }
  root.contains=element('').contains;
  const product=element('product-app'),hero=element('universe-sculpture',product),card=element('discovery-card',product),cover=element('world-atmosphere',card),caption=element('caption',card);
  const reader=element('reading-app'),readerArt=element('universe-sculpture',reader);
  const view=new Events();view.matchMedia=query=>query.includes('reduced')?reduced:fine;
  const motion=createInterfaceMotion({root,document:doc,view,requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:key=>frames.delete(key),
    MutationObserver:class{constructor(callback){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}});
  return {motion,root,doc,view,hero,card,cover,caption,readerArt,frames,observers,reduced,fine,
    move(target=hero,clientX=210,clientY=20,pointerType='mouse'){return root.emit('pointermove',{target,clientX,clientY,pointerType});},
    step(){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());},
    reduce(value=true){reduced.matches=value;reduced.emit('change');},
    appReduce(value=true){appReduced=value;for(const observer of observers)observer.callback();},
    hide(value=true){doc.hidden=value;doc.emit('visibilitychange');}};
}

test('pointer artwork batches movement into one frame and clamps surface transforms',()=>{
  const f=fixture();f.motion.mount();assert.equal(f.frames.size,0);
  f.move();f.move(f.hero,500,-300);assert.equal(f.frames.size,1);assert.equal(f.hero.values.size,0);
  f.step();
  assert.equal(f.hero.values.get('--pointer-x'),'100.00%');assert.equal(f.hero.values.get('--pointer-y'),'0.00%');
  assert.equal(f.hero.values.get('--tilt-x'),'4.00deg');assert.equal(f.hero.values.get('--tilt-y'),'4.00deg');
  assert.equal(f.hero.values.get('--drift-x'),'10.00px');assert.equal(f.hero.values.get('--drift-y'),'-10.00px');
  assert.equal(f.hero.attributes.get('data-motion-active'),'true');assert.equal(f.frames.size,0);
  f.motion.destroy();
});

test('delegated card tracking survives child transitions and clears on surface exit',()=>{
  const f=fixture();f.motion.mount();f.move(f.cover);f.step();assert.equal(f.card.values.size,6);assert.equal(f.cover.values.size,0);
  f.root.emit('pointerout',{target:f.cover,relatedTarget:f.caption});assert.equal(f.card.values.size,6);
  f.move(f.card,110,70);f.root.emit('pointerout',{target:f.caption,relatedTarget:f.root});
  assert.equal(f.card.values.size,0);assert.equal(f.card.attributes.size,0);assert.equal(f.frames.size,0);
  f.move();f.step();f.root.emit('pointerleave');assert.equal(f.hero.values.size,0);
  f.motion.destroy();
});

test('reduced motion, hidden pages and coarse input cancel motion immediately until new movement',()=>{
  for(const disable of [f=>f.reduce(),f=>f.appReduce(),f=>f.hide(),f=>{f.fine.matches=false;f.fine.emit('change');}]){
    const f=fixture();f.motion.mount();f.move();f.step();f.move();disable(f);
    assert.equal(f.hero.values.size,0);assert.equal(f.frames.size,0);f.move();assert.equal(f.frames.size,0);
    f.reduce(false);f.appReduce(false);f.hide(false);f.fine.matches=true;f.fine.emit('change');assert.equal(f.frames.size,0);
    f.move();assert.equal(f.frames.size,1);f.motion.destroy();
  }
});

test('passive product-only tracking leaves touch scrolling and reading surfaces alone',()=>{
  const f=fixture();f.motion.mount();
  assert.ok(f.root.listeners.length>0);assert.ok(f.root.listeners.every(listener=>listener.options?.passive));
  assert.ok(!f.root.listeners.some(listener=>['wheel','scroll','touchmove'].includes(listener.type)));
  assert.equal(f.move(f.hero,110,70,'touch').defaultPrevented,false);assert.equal(f.frames.size,0);
  assert.equal(f.move(f.readerArt).defaultPrevented,false);assert.equal(f.frames.size,0);assert.equal(f.readerArt.values.size,0);
  f.move(f.hero,Number.NaN,70);assert.equal(f.frames.size,0);f.motion.destroy();
});

test('remount releases the old surface and destroy cancels all callbacks and subscriptions',()=>{
  const f=fixture();f.motion.mount();const count=f.root.listeners.length;
  f.move();f.step();f.move();f.motion.mount();
  assert.equal(f.hero.values.size,0);assert.equal(f.frames.size,0);assert.equal(f.root.listeners.length,count);assert.equal(f.observers.size,1);
  f.move(f.cover);f.step();f.move(f.cover);f.motion.destroy();
  assert.equal(f.card.values.size,0);assert.equal(f.frames.size,0);assert.equal(f.root.listeners.length,0);
  assert.equal(f.doc.listeners.length,0);assert.equal(f.reduced.listeners.length,0);assert.equal(f.fine.listeners.length,0);assert.equal(f.observers.size,0);
  f.motion.mount();f.move();assert.equal(f.root.listeners.length,0);assert.equal(f.frames.size,0);
});

test('a detached surface cannot be updated by a previously scheduled pointer frame',()=>{
  const f=fixture();f.motion.mount();f.move();assert.equal(f.frames.size,1);f.hero.parent=null;f.step();
  assert.equal(f.hero.values.size,0);assert.equal(f.frames.size,0);f.motion.destroy();
});

test('scrolling, resizing and window blur release stale hover transforms and pending frames',()=>{
  for(const interrupt of [f=>f.doc.emit('scroll'),f=>f.view.emit('resize'),f=>f.view.emit('blur')]){
    const f=fixture();f.motion.mount();f.move();f.step();f.move();interrupt(f);
    assert.equal(f.hero.values.size,0);assert.equal(f.hero.attributes.size,0);assert.equal(f.frames.size,0);
    f.move();f.step();assert.equal(f.hero.attributes.get('data-motion-active'),'true');
    f.motion.destroy();assert.equal(f.view.listeners.length,0);
  }
});

test('touch contact clears a mouse hover on devices that support both inputs',()=>{
  const f=fixture();f.motion.mount();f.move();f.step();f.move();
  const event=f.root.emit('pointerdown',{target:f.hero,pointerType:'touch'});
  assert.equal(event.defaultPrevented,false);assert.equal(f.hero.values.size,0);assert.equal(f.frames.size,0);
  f.motion.destroy();
});
