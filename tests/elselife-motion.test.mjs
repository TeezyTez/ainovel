import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorialMotion} from '../src/elselife-motion.js';

// Browser layout and WAAPI are the boundary; the controller and its cleanup run unchanged.
function fixture({reduced=false, activePortal=false}={}){
  const animations=[], overlays=[];
  const style=()=>({visibility:'',setProperty(name,value){this[name]=value;}});
  function node(rect={left:20,top:100,width:240,height:200}){
    return {style:style(),isConnected:true,children:[],attributes:{},
      getBoundingClientRect:()=>({...rect,right:rect.left+rect.width,bottom:rect.top+rect.height}),
      setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},
      querySelectorAll:()=>[],
      cloneNode(){return node(rect);},
      remove(){this.isConnected=false;const index=overlays.indexOf(this);if(index>=0)overlays.splice(index,1);},
      animate(keyframes,options){
        let finish,reject;
        const finished=new Promise((resolve,rejection)=>{finish=resolve;reject=rejection;});
        const animation={node:this,keyframes,options,finished,cancelled:false,
          cancel(){this.cancelled=true;reject(new Error('Animation cancelled'));},finish};
        animations.push(animation);return animation;
      }
    };
  }
  const source=node(),target=node({left:70,top:80,width:160,height:218}),main=node();
  const card={querySelector:selector=>selector==='.world-atmosphere'?source:null};
  const link={getAttribute:()=> '#/world/example',closest:selector=>selector==='.discovery-card'?card:link};
  let currentMain=main,showTarget=false;
  const document={activeElement:activePortal?link:null,location:{hash:'#/world/example'},
    body:{classList:{contains:()=>reduced},appendChild(element){overlays.push(element);}},
    defaultView:{innerWidth:1200,innerHeight:900,
      matchMedia:()=>({matches:false}),
      getComputedStyle:()=>({0:'background-color',1:'color',2:'--portal-wash',length:3,
        getPropertyValue:name=>({'background-color':'rgb(232, 223, 232)',color:'rgb(116, 85, 118)','--portal-wash':'#c9aec8'}[name])})},
    querySelector(selector){
      if(selector==='.world-intro .world-atmosphere')return showTarget?target:null;
      if(selector==='.reading-paper')return null;
      if(selector==='main')return currentMain;
      return null;
    }
  };
  const motion=createEditorialMotion({root:document,reduced:()=>reduced});
  return {document,motion,main,target,source,animations,overlays,
    setReduced:value=>{reduced=value;},
    renderWorld:()=>{showTarget=true;currentMain=node();return currentMain;}
  };
}

test('reduced motion prevents route animations and cloned portal portals',()=>{
  const f=fixture({reduced:true,activePortal:true});
  f.motion.prepareRoute();f.renderWorld();f.motion.settleRoute({changed:true});
  assert.equal(f.animations.length,0);
  assert.equal(f.overlays.length,0);
  assert.equal(f.target.style.visibility,'');
});

test('a changed route enters without waiting for an animation to complete',()=>{
  const f=fixture();
  f.motion.prepareRoute();const destination=f.renderWorld();
  assert.equal(f.motion.settleRoute({changed:true}),undefined);
  assert.equal(f.animations.length,1);
  assert.equal(f.animations[0].node,destination);
  assert.equal(f.animations[0].cancelled,false);
  f.motion.destroy();
});

test('route content remains readable throughout its entrance',()=>{
  const f=fixture();
  f.motion.settleRoute({changed:true});
  assert.ok(f.animations[0].keyframes.every(frame=>frame.opacity>=.88));
  assert.equal(f.animations[0].keyframes.at(-1).opacity,1);
  f.motion.destroy();
});

test('same-route rendering does not restart the entrance',()=>{
  const f=fixture();
  f.motion.settleRoute({changed:false});
  assert.equal(f.animations.length,0);
});

test('preparing a rapid second navigation cancels the previous entrance',()=>{
  const f=fixture();
  f.motion.settleRoute({changed:true});
  const previous=f.animations[0];
  f.motion.prepareRoute();
  assert.equal(previous.cancelled,true);
  f.renderWorld();f.motion.settleRoute({changed:true});
  assert.equal(f.animations.length,2);
  assert.equal(f.animations[1].cancelled,false);
  f.motion.destroy();
});

test('a focused discovery portal travels to its matching destination and is cleaned up',async()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();
  assert.equal(f.overlays.length,1);
  const overlay=f.overlays[0];
  assert.equal(overlay.attributes['aria-hidden'],'true');
  assert.equal(overlay.inert,true);
  assert.equal(overlay.style['background-color'],'rgb(232, 223, 232)');
  f.renderWorld();f.motion.settleRoute({changed:true});
  assert.equal(f.target.style.opacity,'0','only the decorative destination yields during the flight');
  assert.equal(f.target.style.visibility,'','the real portal remains visible while the overlay travels');
  const flight=f.animations.find(animation=>animation.node===overlay);
  assert.ok(flight,'the cloned portal, rather than story content, is animated');
  flight.finish();await Promise.resolve();
  assert.equal(f.overlays.length,0);
  assert.equal(f.target.style.opacity,'','the destination is restored when the flight finishes');
  assert.equal(f.target.style.visibility,'');
  f.motion.destroy();
});

test('a wide portal keeps its proportions and finishes at the narrow portal center',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();const overlay=f.overlays[0];
  f.renderWorld();f.motion.settleRoute({changed:true});
  const flight=f.animations.find(animation=>animation.node===overlay);
  const end=flight.keyframes.at(-1);
  const transform=end.transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/);
  assert.ok(transform,'one scale value keeps portal lettering in proportion');
  const [,x,y,scale]=transform.map(Number);
  assert.ok(Math.abs(scale-2/3)<1e-9,'the smaller size ratio fits the whole source portal');
  assert.ok(Math.abs(20+x+240*scale/2-150)<1e-9,'the final horizontal center matches the real portal');
  assert.ok(Math.abs(100+y+200*scale/2-189)<1e-9,'the final vertical center matches the real portal');
  assert.equal(end.opacity,0,'the overlay disappears before removal');
  assert.ok(flight.keyframes.some(frame=>frame.offset>.5&&frame.offset<1&&frame.opacity>0),'the fade has a visible late keyframe');
  assert.equal(f.target.style.visibility,'','the true destination can naturally show through the fade');
  f.motion.destroy();
});

test('portal transfer follows artwork coordinates across differently composed surfaces',()=>{
 const f=fixture({activePortal:true});
 f.source.dataset={fieldCx:'180',fieldCy:'100',fieldSize:'80'};
 f.target.dataset={fieldCx:'100',fieldCy:'90',fieldSize:'120'};
 f.motion.prepareRoute();const overlay=f.overlays[0];f.renderWorld();f.motion.settleRoute({changed:true});
 const flight=f.animations.find(animation=>animation.node===overlay);
 assert.equal(flight.keyframes.at(-1).transform,'translate(-120px, -80px) scale(1.5)');
 f.motion.destroy();assert.equal(f.target.style.opacity,'');
});

test('cancelling a portal flight keeps the destination visible and removes the overlay',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();f.renderWorld();f.motion.settleRoute({changed:true});
  f.document.activeElement=null;
  f.motion.prepareRoute();
  assert.equal(f.overlays.length,0);
  assert.equal(f.target.style.visibility,'');
  assert.ok(f.animations.every(animation=>animation.cancelled));
  f.motion.destroy();
});

test('a newly enabled reduced-motion preference discards a prepared portal',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();f.setReduced(true);f.renderWorld();
  f.motion.settleRoute({changed:true});
  assert.equal(f.overlays.length,0);
  assert.equal(f.animations.length,0);
  assert.equal(f.target.style.visibility,'');
});

test('a stale focused portal never impersonates another route',()=>{
  const f=fixture({activePortal:true});
  f.document.location.hash='#/world/different';
  f.motion.prepareRoute();f.renderWorld();f.motion.settleRoute({changed:true});
  assert.equal(f.overlays.length,0);
  assert.equal(f.animations.length,1);
  assert.equal(f.target.style.visibility,'');
  f.motion.destroy();
});

test('destroy removes all owned effects and prevents future animations',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();f.renderWorld();f.motion.settleRoute({changed:true});
  f.motion.destroy();f.motion.prepareRoute();f.motion.settleRoute({changed:true});
  assert.equal(f.overlays.length,0);
  assert.equal(f.target.style.visibility,'');
  assert.equal(f.animations.length,2);
  assert.ok(f.animations.every(animation=>animation.cancelled));
});

test('missing WAAPI support leaves the destination visible',()=>{
  const f=fixture({activePortal:true});
  f.main.animate=undefined;f.source.animate=undefined;
  f.motion.prepareRoute();f.motion.settleRoute({changed:true});
  assert.equal(f.overlays.length,0);
  assert.equal(f.animations.length,0);
  assert.equal(f.target.style.visibility,'');
});

test('the default preference respects both the application setting and the operating system',()=>{
  const f=fixture({reduced:true});
  const motion=createEditorialMotion({root:f.document});
  motion.settleRoute({changed:true});
  assert.equal(f.animations.length,0);
  f.setReduced(false);
  f.document.defaultView.matchMedia=()=>({matches:true});
  motion.settleRoute({changed:true});
  assert.equal(f.animations.length,0);
  f.document.defaultView.matchMedia=()=>({matches:false});
  motion.settleRoute({changed:true});
  assert.equal(f.animations.length,1);
  motion.destroy();
});

test('an unavailable destination discards the portal instead of leaving an overlay',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();f.motion.settleRoute({changed:true});
  assert.equal(f.overlays.length,0);
  assert.equal(f.animations.length,1);
  f.motion.destroy();
});

test('an animation rejected by the browser leaves the route usable',()=>{
  const f=fixture({activePortal:true});
  f.motion.prepareRoute();
  f.overlays[0].animate=()=>{throw new Error('Animation unavailable');};
  const destination=f.renderWorld();
  destination.animate=()=>{throw new Error('Animation unavailable');};
  assert.doesNotThrow(()=>f.motion.settleRoute({changed:true}));
  assert.equal(f.overlays.length,0);
  assert.equal(f.target.style.visibility,'');
});
