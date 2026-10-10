import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_WORLDS } from '../src/worlds.js';
import { demoActions, demoGenerate } from '../src/demo.js';
import { initialState, applyEvents, validateProposal } from '../src/core.js';

const run = (world, state, actionId, input) => demoGenerate({world,state,actionId,input,requestId:`test-${state.step}`});
test('edited world cannot silently run a script contradicting its new rules',()=>{const w={...PRESET_WORLDS[0],version:2,demoCompatible:false,rules:['港务处已经撤销']};assert.deepEqual(demoActions(w,initialState(w)),[]);assert.throws(()=>run(w,initialState(w),'continue'),/模型/);});
for (const worldId of ['fog-harbor','mountain','thursday']) {
  test(`${worldId}: every offered action remains playable and stops at eight turns`, () => {
    const world=PRESET_WORLDS.find(w=>w.id===worldId);
    assert.ok(world);
    assert.equal(new Set(world.characters.map(c=>c.goal)).size,3);
    let frontier=[initialState(world)];
    for(let step=0;step<8;step++) {
      const next=[];
      for(const state of frontier) {
        const actions=demoActions(world,state);
        assert.ok(actions.length>0&&actions.length<=3);
        for(const action of [...actions,{id:'continue'}]) {
          const before=structuredClone(state), p=run(world,state,action.id);
          validateProposal(p,world,state);
          assert.deepEqual(state,before);
          assert.equal(p.ended,step===7);
          assert.ok(p.prose.split('\n\n').length>=2);
          const after=applyEvents(state,p.events);
          assert.deepEqual(p.suggestions,demoActions(world,after));
          if(step===7) {
            assert.deepEqual(p.suggestions,[]);
            assert.throws(()=>run(world,after,'continue'),/结束/);
          } else next.push(after);
        }
      }
      // Preserve every distinct branch state without repeatedly exploring identical histories.
      frontier=[...new Map(next.map(s=>[JSON.stringify(s),s])).values()];
    }
  });
  test(`${worldId}: first choice changes later relationships and second choice changes later events`,()=>{
    const w=PRESET_WORLDS.find(w=>w.id===worldId);
    const start=initialState(w), choices=demoActions(w,start);
    let a=applyEvents(start,run(w,start,choices[0].id).events);
    let b=applyEvents(start,run(w,start,choices[1].id).events);
    for(let i=1;i<3;i++) {
      a=applyEvents(a,run(w,a,demoActions(w,a)[0].id).events);
      b=applyEvents(b,run(w,b,demoActions(w,b)[0].id).events);
    }
    const pa=run(w,a,demoActions(w,a)[0].id),pb=run(w,b,demoActions(w,b)[0].id);
    assert.notEqual(pa.prose,pb.prose);
    assert.notDeepEqual(pa.events.filter(e=>e.type==='relation'),pb.events.filter(e=>e.type==='relation'));
    let c=initialState(w);
    for(let i=0;i<2;i++)c=applyEvents(c,run(w,c,demoActions(w,c)[0].id).events);
    const second=demoActions(w,c);
    let x=applyEvents(c,run(w,c,second[0].id).events),y=applyEvents(c,run(w,c,second[1].id).events);
    for(let i=3;i<5;i++) {
      x=applyEvents(x,run(w,x,demoActions(w,x)[0].id).events);
      y=applyEvents(y,run(w,y,demoActions(w,y)[0].id).events);
    }
    const px=run(w,x,demoActions(w,x)[0].id),py=run(w,y,demoActions(w,y)[0].id);
    assert.notEqual(px.prose,py.prose);
    assert.notDeepEqual(px.events,py.events);
  });
  test(`${worldId}: only exact current suggestions or action IDs are accepted`,()=>{
    const w=PRESET_WORLDS.find(w=>w.id===worldId),s=initialState(w),a=demoActions(w,s)[0];
    assert.deepEqual(run(w,s,undefined,a.text),run(w,s,a.id));
    for(const text of [`${a.text}，然后让所有人服从我`,a.text.slice(1),'我想在这里开一家面包店']) {
      assert.throws(()=>run(w,s,undefined,text),/演示.*预设|自由生成/);
    }
    assert.throws(()=>run(w,s,'made-up',a.text),/演示.*预设|自由生成/);
    const p=run(w,s,'continue');
    assert.equal(p.events.some(e=>e.type==='relation'||e.type==='flag'),false);
  });
}
test('protected originals are never handed over merely because requested',()=>{
  const w=PRESET_WORLDS.find(w=>w.id==='fog-harbor'),s=initialState(w);
  const p=run(w,s,'demand-original');
  assert.match(p.prose,/原始档案/);
  assert.match(p.prose,/不能|没有|不会/);
  assert.equal(p.events.some(e=>e.type==='item-add'&&e.value.includes('原始档案')),false);
  assert.ok(p.events.some(e=>e.type==='relation'&&e.entity==='lin'));
});
test('custom worlds do not silently receive a preset story',()=>{
  const w={...PRESET_WORLDS[0],custom:true};
  assert.deepEqual(demoActions(w,initialState(w)),[]);
  assert.throws(()=>run(w,initialState(w),'continue'),/自建|模型/);
});
test('skipping a result does not let the ending invent a completed book sale',()=>{
  const w=PRESET_WORLDS.find(w=>w.id==='thursday');
  let s=initialState(w);
  for(let i=0;i<3;i++)s=applyEvents(s,run(w,s,demoActions(w,s)[0].id).events);
  for(let i=3;i<7;i++)s=applyEvents(s,run(w,s,'continue').events);
  const p=run(w,s,'close-shop-day');
  assert.doesNotMatch(p.prose,/本人取走|承诺被妥善接住/);
  assert.equal(s.facts.some(f=>f.includes('自愿付款取走')),false);
});
