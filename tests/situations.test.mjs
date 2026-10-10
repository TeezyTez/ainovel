import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDITIONAL_WORLDS, getExperience } from '../src/situations.js';
import { PRESET_WORLDS } from '../src/worlds.js';
import { validateWorld, initialState } from '../src/core.js';
import { demoActions, demoGenerate } from '../src/demo.js';

test('legacy presets receive complete public experience copy without mutation',()=>{
  const before=structuredClone(PRESET_WORLDS);
  for(const id of ['fog-harbor','mountain','thursday']) {
    const world=PRESET_WORLDS.find(w=>w.id===id), experience=getExperience(world);
    for(const key of ['promise','premise','pressure','participation','closure']) assert.ok(experience[key].trim());
    assert.ok(experience.possibilities.length>=3);
    for(const character of world.characters) assert.ok(!JSON.stringify(experience).includes(character.secret));
  }
  assert.match(getExperience(PRESET_WORLDS[0]).premise,/离乡七年/);
  assert.deepEqual(PRESET_WORLDS,before);
});

test('custom experience overrides work and edited presets do not invent old identity',()=>{
  const world={id:'fog-harbor',version:2,identity:'茶铺学徒',description:'雨天送茶',experience:{pressure:'最后一班车将到站',possibilities:['等车','',null,'询问时刻']}};
  const experience=getExperience(world);
  assert.equal(experience.promise,'雨天送茶');
  assert.equal(experience.pressure,'最后一班车将到站');
  assert.match(experience.premise,/茶铺学徒/);
  assert.doesNotMatch(experience.premise,/电报员/);
  assert.deepEqual(experience.possibilities,['等车','询问时刻']);
  experience.possibilities.push('a');
  assert.equal(world.experience.possibilities.length,4);
  assert.match(getExperience({id:'fog-harbor',version:1,custom:true,identity:'另一身份'}).premise,/另一身份/);
  assert.ok(getExperience(null).possibilities.length);
});

test('new tea-house world validates and cannot produce fake demo turns',()=>{
  assert.equal(ADDITIONAL_WORLDS.length,1);
  const world=ADDITIONAL_WORLDS[0], state=initialState(world);
  assert.equal(validateWorld(world),world);
  assert.equal(world.id,'truth-teahouse');
  assert.equal(world.version,1);
  assert.equal(world.custom,false);
  assert.equal(world.demoCompatible,false);
  assert.equal(world.characters.length,3);
  for(const character of world.characters) {
    for(const key of ['id','name','role','public','goal','secret','history']) assert.ok(character[key]?.trim());
  }
  for(const key of ['perspective','length','style','pace']) assert.ok(world.narrative[key]);
  assert.deepEqual(demoActions(world,state),[]);
  assert.throws(()=>demoGenerate({world,state,actionId:'continue',requestId:'no-fake-tea-demo'}),/模型/);
  assert.match(world.rules.join('\n'),/尚未选定、付款/);
  assert.match(world.rules.join('\n'),/保持沉默或拒绝回答/);
  assert.match(world.rules.join('\n'),/这不保证其信念正确/);
  assert.match(world.opening,/这份道歉不必由你接手/);
});
