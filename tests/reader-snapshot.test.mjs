import test from 'node:test';
import assert from 'node:assert/strict';
import {readerSnapshot} from '../src/reader-snapshot.js';
test('opening and historical map/inspection nodes never fall through to later knowledge',()=>{
 const branch={initialState:{version:0,facts:[]},turns:[{id:'one',state:{version:1,facts:['看见信封']}},{id:'two',state:{version:2,facts:['信封内的暗号']}}]};
 assert.deepEqual(readerSnapshot(branch,'opening'),{state:branch.initialState,sourceNode:null});
 assert.deepEqual(readerSnapshot(branch,'one').state.facts,['看见信封']);
 assert.equal(readerSnapshot(branch,'missing'),null);assert.equal(readerSnapshot(branch,undefined).state.version,2);
});
