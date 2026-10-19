import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [demoRoot, dartCatalog, output] = process.argv.slice(2);
if (!demoRoot || !dartCatalog || !output) {
  throw new Error('usage: node generate.mjs DEMO_ROOT DART_CATALOG OUTPUT');
}
const {PRESET_WORLDS} = await import(pathToFileURL(path.join(demoRoot, 'src/worlds.js')));
const {demoActions, demoGenerate} = await import(pathToFileURL(path.join(demoRoot, 'src/demo.js')));
const dart = fs.readFileSync(dartCatalog, 'utf8');
const formalSeeds = new Map();
for (const block of dart.matchAll(/DemoWorldPreset\(\s*id: '([^']+)'([\s\S]*?)\n  \),/g)) {
  const tail = block[2].match(/\n    seed: ([\s\S]*?),\s*$/);
  if (!tail) throw new Error(`missing formal seed for ${block[1]}`);
  formalSeeds.set(block[1], [...tail[1].matchAll(/'([^']*)'/g)].map(x => x[1]).join(''));
}

function combinations(world) {
  const approaches = world.id === 'fog-harbor' ? ['', 'respect', 'pressure', 'distance'] : ['', 'honest', 'defensive', 'careful'];
  const methods = world.id === 'fog-harbor' ? ['', 'record', 'harbor'] : world.id === 'mountain' ? ['', 'roster', 'repair'] : ['', 'original', 'edition'];
  const purchased = world.id === 'thursday' ? [false, true] : [false];
  return approaches.flatMap(approach => methods.flatMap(method => purchased.map(bought => ({approach, method, bought}))));
}
function stateFor(world, step, state) {
  return {
    step, version: step, flags: {
      [`${world.id}:approach`]: state.approach,
      [`${world.id}:method`]: state.method,
    },
    facts: state.bought ? ['预留原书已核对，由许知秋自愿付款取走；便笺内容未被阅读。'] : [],
  };
}
function key(state) { return [state.approach, state.method, state.bought ? '1' : '0'].join('|'); }
function choice(world, step, action, states) {
  const outcomes = [];
  const variants = {};
  for (const state of states) {
    const generated = demoGenerate({world, state: stateFor(world, step, state), actionId: action.id, requestId: 'fixture'});
    const result = {prose: generated.prose, events: generated.events};
    let index = outcomes.findIndex(x => JSON.stringify(x) === JSON.stringify(result));
    if (index === -1) index = outcomes.push(result) - 1;
    variants[key(state)] = index;
  }
  return {id: action.id, text: action.text, outcomes, variants};
}
const worlds = PRESET_WORLDS.filter(w => ['fog-harbor', 'mountain', 'thursday'].includes(w.id)).map(world => {
  const formalSeed = formalSeeds.get(world.id);
  if (!formalSeed) throw new Error(`formal seed missing for ${world.id}`);
  const states = combinations(world);
  const scenes = Array.from({length: 8}, (_, step) => {
    const actions = demoActions(world, stateFor(world, step, {approach:'',method:'',bought:false}));
    return {
      actions: actions.map(({id, text}) => ({id, text})),
      choices: [{id: 'continue', text: ''}, ...actions].map(action => choice(world, step, action, states)),
    };
  });
  return {
    id: world.id, title: world.title, opening: world.opening, location: world.location,
    seeds: [world.seed, formalSeed],
    characters: world.characters.map(({id, name, role, public: publicText}) => ({id, name, role, public: publicText})),
    scenes,
  };
});
fs.writeFileSync(output, JSON.stringify({source: 'demo/src/demo.js + demo/src/worlds.js; formal seed aliases from frontend/lib/experience/demo_world_catalog.dart', worlds}, null, 2) + '\n');
console.log(`wrote ${worlds.length} worlds, ${worlds.reduce((n,w)=>n+w.scenes.length,0)} scenes, ${fs.statSync(output).size} bytes`);
