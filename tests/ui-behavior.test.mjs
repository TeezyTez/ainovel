import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../src/ui-behavior.js';
test('malformed encoded URLs resolve to recoverable invalid route',()=>{assert.deepEqual(ui.parseRoute('#/world/%'),{path:'invalid',id:''});assert.deepEqual(ui.parseRoute('#/story/abc'),{path:'story',id:'abc'});});
test('Chinese composition never submits, default enter makes newline, modifier sends',()=>{assert.equal(ui.shouldSend({key:'Enter',isComposing:true,ctrlKey:true},true),false);assert.equal(ui.shouldSend({key:'Enter',keyCode:229},true),false);assert.equal(ui.shouldSend({key:'Enter'},false),false);assert.equal(ui.shouldSend({key:'Enter',ctrlKey:true},false),true);assert.equal(ui.shouldSend({key:'Enter',metaKey:true},false),true);assert.equal(ui.shouldSend({key:'Enter',shiftKey:true},true),false);assert.equal(ui.shouldSend({key:'Enter'},true),true);});
