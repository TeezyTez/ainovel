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
