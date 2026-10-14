import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlMotion} from '../src/control-motion.js';

class Events extends EventTarget{
  listeners=[];
  addEventListener(type,handler,options){super.addEventListener(type,handler,options);this.listeners.push({type,handler,options});}
  removeEventListener(type,handler,options){super.removeEventListener(type,handler,options);this.listeners=this.listeners.filter(item=>item.type!==type||item.handler!==handler);}
  emit(type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});this.dispatchEvent(event);return event;}
}

// Only browser layout, selectors and WAAPI are doubled; the controller owns all effects.
function fixture(){
  let id=0,appReduced=false;
  const frames=new Map(),observers=new Set(),animations=[];
  const reduced=new Events(),fine=new Events();reduced.matches=false;fine.matches=true;
  const doc=new Events();doc.hidden=false;doc.body={classList:{contains:()=>appReduced}};
  const root=new Events();root.ownerDocument=doc;
  function element(tag='button',className='',parent=root){
    const values=new Map(),attributes=new Map();
    const node={tagName:tag.toUpperCase(),className,parent,children:[],values,attributes,dataset:{},disabled:false,
      rect:{left:10,top:20,width:200,height:100},
      style:{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)},
      get isConnected(){return root.contains(this);},
      matches(selector){return selector.split(',').some(part=>{
        part=part.trim();
        if(part.includes('>')){const [ancestor,child]=part.split('>').map(value=>value.trim());return this.matches(child)&&Boolean(this.parent?.matches?.(ancestor));}
        if(part===':disabled')return this.disabled;
        if(part.startsWith('[')){const [,name,value]=part.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/)||[];return attributes.has(name)&&(value===undefined||attributes.get(name)===value);}
        const [tagName,...classes]=part.split('.');
        return (!tagName||tagName===tag)&&classes.every(value=>this.className.split(' ').includes(value));
      });},
      closest(selector){for(let current=this;current;current=current.parent)if(current.matches?.(selector))return current;return null;},
      contains(child){for(let current=child;current;current=current.parent)if(current===this)return true;return false;},
      getBoundingClientRect(){return {...this.rect,right:this.rect.left+this.rect.width,bottom:this.rect.top+this.rect.height};},
      setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),
      appendChild(child){child.parent=this;this.children.push(child);return child;},
      remove(){if(this.parent?.children)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;},
      animate(keyframes,options){let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});const animation={node:this,keyframes,options,finished,cancelled:false,finish:resolve,cancel(){this.cancelled=true;reject(new Error('cancelled'));}};animations.push(animation);return animation;}
    };
    return node;
  }
  root.contains=element().contains;
  const button=element(),icon=element('svg','',button),link=element('a','workspace-nav-link'),details=element('details'),summary=element('summary','',details);
  const view=new Events();view.innerWidth=1200;view.innerHeight=800;view.matchMedia=query=>query.includes('reduced')?reduced:fine;
  view.getComputedStyle=()=>({visibility:'visible',display:'block'});
  doc.createElement=tag=>element(tag,'',null);
  const motion=createControlMotion({root,document:doc,view,requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:key=>frames.delete(key),
    MutationObserver:class{constructor(callback){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}});
  const f={motion,root,doc,view,button,icon,link,summary,frames,animations,observers,reduced,fine,element,
    move(target=button,clientX=110,clientY=70,pointerType='mouse'){return root.emit('pointermove',{target,clientX,clientY,pointerType});},
    click(target=button,properties={}){return root.emit('click',{target,clientX:60,clientY:45,detail:1,...properties});},
    step(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback());},
    mutate(){for(const observer of observers)observer.callback();},
    appReduce(value=true){appReduced=value;f.mutate();},
    reduce(value=true){reduced.matches=value;reduced.emit('change');},
    hide(value=true){doc.hidden=value;doc.emit('visibilitychange');}};
  return f;
}

test('control spotlight batches pointer movement and follows a nested icon within control bounds',()=>{
  const f=fixture();f.motion.mount();assert.equal(f.frames.size,0);
  f.move(f.icon);f.move(f.icon,500,-300);assert.equal(f.frames.size,1);assert.equal(f.button.values.size,0);
  f.step();assert.equal(f.button.values.get('--control-x'),'100.00%');assert.equal(f.button.values.get('--control-y'),'0.00%');
  assert.equal(f.button.attributes.get('data-control-active'),'true');assert.equal(f.icon.values.size,0);assert.equal(f.frames.size,0);
  f.root.emit('pointerout',{target:f.icon,relatedTarget:f.button});assert.equal(f.button.values.size,2);
  f.root.emit('pointerout',{target:f.button,relatedTarget:f.link});assert.equal(f.button.values.size,0);assert.equal(f.button.attributes.size,0);
  f.motion.destroy();
});

test('click feedback preserves native events and removes its hidden decoration when the animation finishes',async()=>{
  const f=fixture();f.motion.mount();const event=f.click(f.icon);
  assert.equal(event.defaultPrevented,false);assert.equal(f.animations.length,1);
  const ripple=f.button.children[0];assert.equal(ripple.className,'control-ripple');assert.equal(ripple.attributes.get('aria-hidden'),'true');
  assert.equal(ripple.style.left,'50px');assert.equal(ripple.style.top,'25px');assert.equal(ripple.style.pointerEvents,'none');
  assert.ok(Number.parseFloat(ripple.style.width)>300,'the wave can reach the far corner');
  assert.match(f.animations[0].keyframes[0].transform,/scale\(0/);assert.equal(f.animations[0].keyframes.at(-1).opacity,0);
  assert.ok(f.root.listeners.every(listener=>listener.options.passive),'motion must never take over input');
  f.animations[0].finish();await Promise.resolve();assert.equal(f.button.children.length,0);f.motion.destroy();
});

test('touch and keyboard clicks keep feedback without hover tracking on coarse devices',()=>{
  const f=fixture();f.fine.matches=false;f.motion.mount();f.move();f.move(f.button,60,45,'touch');assert.equal(f.frames.size,0);
  f.click(f.button,{pointerType:'touch'});assert.equal(f.button.children[0].style.left,'50px');assert.equal(f.button.children[0].style.top,'25px');
  f.click(f.link,{detail:0,clientX:0,clientY:0});assert.equal(f.link.children[0].style.left,'100px');assert.equal(f.link.children[0].style.top,'50px');
  f.click(f.summary,{detail:0});assert.equal(f.summary.children.length,1);f.motion.destroy();
});

test('button-like links and summaries participate while native appearance inputs remain untouched',()=>{
  const f=fixture();f.motion.mount();
  for(const [tag,className] of [['a','btn'],['a','workspace-create'],['a','world-return'],['button','icon-button']]){
    const control=f.element(tag,className);f.click(control);assert.equal(control.children.length,1);
  }
  const strip=f.element('div','world-return-strip'),returnLink=f.element('a','',strip);f.click(returnLink);assert.equal(returnLink.children.length,1);
  for(const tag of ['input','select','textarea']){const input=f.element(tag,'icon-button');f.click(input);f.move(input);f.step();assert.equal(input.children.length,0);assert.equal(input.values.size,0);}
  f.motion.destroy();
});

test('disabled, inert, destructive, detached and offscreen controls never receive decorative effects',()=>{
  const blocked=[f=>{f.button.disabled=true;},f=>f.button.setAttribute('aria-disabled','true'),f=>{const parent=f.element('div');parent.setAttribute('inert','');f.button.parent=parent;},f=>{f.button.className='danger';},f=>{f.button.dataset.action='batch-trash';},f=>{f.button.parent=null;},f=>{f.button.rect.left=1400;},f=>{f.button.rect.width=0;},f=>{f.button.rect.top=Number.NaN;}];
  for(const block of blocked){const f=fixture();f.motion.mount();block(f);f.move();f.step();f.click();assert.equal(f.button.values.size,0);assert.equal(f.button.children.length,0);assert.equal(f.animations.length,0);f.motion.destroy();}
  const f=fixture();f.motion.mount();const text=f.element('a');f.move(text);f.step();f.click(text);assert.equal(f.animations.length,0);assert.equal(text.values.size,0);f.motion.destroy();
});

test('reduced motion, backgrounding and blur clear pending frames and all active ripples',()=>{
  for(const interrupt of [f=>f.reduce(),f=>f.appReduce(),f=>f.hide(),f=>f.view.emit('blur'),f=>f.doc.emit('scroll'),f=>f.view.emit('resize'),f=>{f.fine.matches=false;f.fine.emit('change');}]){
    const f=fixture();f.motion.mount();f.move();f.step();f.move();f.click();interrupt(f);
    assert.equal(f.frames.size,0);assert.equal(f.button.values.size,0);assert.equal(f.button.children.length,0);assert.ok(f.animations[0].cancelled);f.motion.destroy();
  }
  for(const disable of [f=>f.reduce(),f=>f.appReduce(),f=>f.hide()]){const f=fixture();f.motion.mount();disable(f);f.move();f.click();assert.equal(f.frames.size,0);assert.equal(f.animations.length,0);f.reduce(false);f.appReduce(false);f.hide(false);assert.equal(f.frames.size,0);f.click();assert.equal(f.animations.length,1);f.motion.destroy();}
});

test('rerendering and destruction release every listener, observer and animation without restarting',()=>{
  const f=fixture();f.motion.mount();const listenerCount=f.root.listeners.length;
  f.move();f.step();f.move();f.click();f.motion.mount();
  assert.equal(f.button.children.length,0);assert.equal(f.button.values.size,0);assert.equal(f.frames.size,0);assert.equal(f.root.listeners.length,listenerCount);assert.equal(f.observers.size,1);
  f.click(f.link);f.motion.destroy();assert.equal(f.link.children.length,0);assert.ok(f.animations.every(animation=>animation.cancelled));
  for(const target of [f.root,f.doc,f.view,f.reduced,f.fine])assert.equal(target.listeners.length,0);
  assert.equal(f.observers.size,0);f.motion.mount();f.move();f.click();assert.equal(f.root.listeners.length,0);assert.equal(f.frames.size,0);assert.equal(f.animations.length,2);
});

test('rapid clicks replace a prior ripple and browser cancellation removes the current one',async()=>{
  const f=fixture();f.motion.mount();f.click();f.click();
  assert.equal(f.button.children.length,1);assert.ok(f.animations[0].cancelled);await Promise.resolve();assert.equal(f.button.children.length,1,'the stale completion cannot remove the newer wave');
  f.animations[1].cancel();await Promise.resolve();assert.equal(f.button.children.length,0);f.motion.destroy();
});

test('a live disabled or removed control is cleared and a stale scheduled frame cannot revive it',()=>{
  for(const invalidate of [f=>{f.button.disabled=true;},f=>{f.button.parent=null;}]){
    const f=fixture();f.motion.mount();f.move();f.step();f.move();f.click();invalidate(f);f.mutate();f.step();
    assert.equal(f.button.values.size,0);assert.equal(f.frames.size,0);assert.equal(f.button.children.length,0);assert.ok(f.animations[0].cancelled);f.motion.destroy();
  }
});

test('touch contact clears stale mouse spotlight without blocking contact or keyboard activation',()=>{
  const f=fixture();f.motion.mount();f.move();f.step();f.move();
  const event=f.root.emit('pointerdown',{target:f.button,pointerType:'touch'});
  assert.equal(event.defaultPrevented,false);assert.equal(f.button.values.size,0);assert.equal(f.frames.size,0);
  f.click(f.button,{detail:0});assert.equal(f.animations.length,1);f.motion.destroy();
});

test('unavailable or rejected animation support leaves no orphan decoration',()=>{
  for(const animate of [undefined,()=>{throw new Error('unsupported');}]){
    const f=fixture();f.doc.createElement=tag=>Object.assign(f.element(tag,'',null),{animate});f.motion.mount();
    assert.doesNotThrow(()=>f.click());assert.equal(f.button.children.length,0);f.motion.destroy();
  }
});
