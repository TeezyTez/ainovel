import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source = await readFile(new URL('./universe-motion.js', import.meta.url),'utf8');
const {createUniverseMotion} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('no pause button required; offscreen/hidden/reduced scenes stop scheduling and resume once', async () => {
  const canvas = new EventTarget();
  const stage = Object.assign(new EventTarget(), {
    dataset: {}, style: {setProperty() {}}, isConnected: true,
    getBoundingClientRect: () => ({top:0,bottom:800,height:800}),
    querySelector: selector => selector === 'canvas' ? canvas : null,
  });
  let id=0, draws=0, disposed=0, reduced=false;
  const frames = new Map();
  const view = Object.assign(new EventTarget(), {
    innerHeight:900,
    matchMedia: () => Object.assign(new EventTarget(), {matches:false}),
    requestAnimationFrame: callback => {frames.set(++id,callback);return id;},
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class {observe() {} disconnect() {}},
    ResizeObserver: class {observe() {} disconnect() {}},
  });
  const doc = Object.assign(new EventTarget(), {
    defaultView:view, hidden:false,
    body:{classList:{contains:()=>reduced}},
    querySelector:()=>stage,
  });
  const motion = createUniverseMotion({root:doc,load:async()=>({createUniverseScene:()=>({
    draw(){draws++;}, resize(){}, dispose(){disposed++;},
  })})});
  motion.mount(); await Promise.resolve();
  assert.equal(frames.size,1);
  const beforePause=draws;
  motion.setPaused(true);
  assert.equal(frames.size,0); assert.equal(draws,beforePause);
  for(let n=0;n<100;n++)motion.setPaused(true);
  assert.equal(draws,beforePause);
  motion.setPaused(false);
  assert.equal(frames.size,1);
  const resumed=draws;
  for(let n=0;n<100;n++)motion.setPaused(false);
  assert.equal(draws,resumed); assert.equal(frames.size,1);
  doc.hidden=true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(frames.size,0);
  doc.hidden=false; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(frames.size,1);
  reduced=true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(frames.size,0);
  motion.destroy(); assert.equal(disposed,1); assert.equal(frames.size,0);
});

function sceneHarness(load) {
  const canvas = new EventTarget();
  const stage = Object.assign(new EventTarget(), {
    dataset:{}, style:{setProperty() {}}, isConnected:true,
    getBoundingClientRect:()=>({left:0,top:0,width:600,bottom:500,height:500}),
    querySelector:selector=>selector==='canvas'?canvas:null,
  });
  const frames=new Map(), preference=Object.assign(new EventTarget(),{matches:false});
  let id=0;
  const view=Object.assign(new EventTarget(),{
    innerHeight:900,
    matchMedia:query=>query.includes('prefers-reduced-motion')?preference:Object.assign(new EventTarget(),{matches:true}),
    requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},
    cancelAnimationFrame:id=>frames.delete(id),
    MutationObserver:class {observe() {} disconnect() {}},
    ResizeObserver:class {observe() {} disconnect() {}},
  });
  const doc=Object.assign(new EventTarget(),{
    defaultView:view,hidden:false,body:{classList:{contains:()=>false}},querySelector:()=>stage,
  });
  const motion=createUniverseMotion({root:doc,load});
  const tick=now=>{
    const scheduled=[...frames.values()];frames.clear();scheduled.forEach(callback=>callback(now));
  };
  return {motion,canvas,stage,frames,preference,tick};
}

test('reduced motion resets to one still frame and ignores pointer parallax', async () => {
  const drawn=[];
  const harness=sceneHarness(async()=>({createUniverseScene:()=>({draw:frame=>drawn.push(frame),resize(){},dispose(){}})}));
  harness.motion.mount();await Promise.resolve();
  const move=()=>harness.stage.dispatchEvent(Object.assign(new Event('pointermove'),{clientX:600,clientY:500,pointerType:'mouse'}));
  move();harness.tick(100);harness.tick(150);
  assert.ok(drawn.at(-1).x>0);assert.ok(drawn.at(-1).time>0);
  harness.preference.dispatchEvent(Object.assign(new Event('change'),{matches:true}));
  assert.equal(harness.frames.size,0);
  assert.deepEqual(drawn.at(-1),{time:0,progress:0,x:0,y:0});
  const stillCount=drawn.length;
  move();harness.tick(200);
  assert.equal(drawn.length,stillCount);
  harness.motion.destroy();
});

test('context loss keeps the fallback when the renderer module finishes loading later', async () => {
  let resolveLoad,created=0;
  const harness=sceneHarness(()=>new Promise(resolve=>{resolveLoad=resolve;}));
  harness.motion.mount();
  const loss=new Event('webglcontextlost',{cancelable:true});
  harness.canvas.dispatchEvent(loss);
  assert.equal(loss.defaultPrevented,true);
  assert.equal(harness.stage.dataset.sceneFallback,'true');
  resolveLoad({createUniverseScene:()=>{created++;return {draw(){},resize(){},dispose(){}};}});
  await Promise.resolve();
  assert.equal(created,0);
  assert.equal(harness.stage.dataset.sceneReady,undefined);
  assert.equal(harness.frames.size,0);
  harness.motion.destroy();
});

test('destroying during renderer load prevents creating a detached scene', async () => {
  let resolveLoad,created=0;
  const harness=sceneHarness(()=>new Promise(resolve=>{resolveLoad=resolve;}));
  harness.motion.mount();harness.motion.destroy();
  resolveLoad({createUniverseScene:()=>{created++;return {draw(){},resize(){},dispose(){}};}});
  await Promise.resolve();
  assert.equal(created,0);assert.equal(harness.frames.size,0);
});
