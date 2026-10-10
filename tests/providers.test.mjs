import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoProvider} from '../src/providers.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {initialState} from '../src/core.js';
test('cancelling demo presentation rejects the pending result and leaves authoritative state untouched',async()=>{const controller=new AbortController(),world=PRESET_WORLDS[0],state=initialState(world),before=structuredClone(state);const pending=new DemoProvider().generate({world,state,actionId:'continue',requestId:'cancelled'},controller.signal);controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.deepEqual(state,before);});
