import test from 'node:test';
import assert from 'node:assert/strict';
import {productShell} from '../src/product-shell.js';

test('workspace navigation exposes current page and bounded, safe recent stories',()=>{
 const sessions=Array.from({length:8},(_,i)=>({id:'s'+i,title:'故事'+i,updatedAt:i}));
 sessions.push({id:'trash',title:'trashed',updatedAt:99,personal:{trashedAt:0}},{id:'old',title:'archived',archived:true,updatedAt:100});
 const before=structuredClone(sessions),html=productShell('<main id="main">正文</main>',{active:'stories',sessions});
 assert.match(html,/aria-current="page"[^>]*>[\s\S]*?我的世界/);
 assert.equal((html.match(/href="#\/story\//g)||[]).length,5);
 assert.ok(html.indexOf('#/story/s7')<html.indexOf('#/story/s6'));
 assert.doesNotMatch(html,/#\/story\/(trash|old)/);assert.deepEqual(sessions,before);
 assert.match(productShell('',{sessions:[{id:'x',title:'<img src=x>'}]}),/&lt;img src=x&gt;/);
});

test('navigation uses coherent creation wording and recent same-title lives show progress and time',()=>{
 const sessions=[{id:'early',title:'茶铺',updatedAt:Date.UTC(2026,9,13,1,20),activeBranch:'a',branches:[{id:'a',name:'最初的故事',turns:[{}]}]},
 {id:'late',title:'茶铺',updatedAt:Date.UTC(2026,9,13,7,40),activeBranch:'b',branches:[{id:'b',name:'河岸之约',parentBranch:'a',turns:[{},{}]},{id:'a',name:'PRIVATE_BRANCH',turns:[]}]}];
 const before=structuredClone(sessions),html=productShell('',{active:'create',sessions});
 assert.match(html,/workspace-nav-link is-active" aria-current="page"[^>]*>[\s\S]*?<span>创造世界<\/span>/);
 assert.doesNotMatch(html,/<span>创作<\/span>|PRIVATE_BRANCH/);
 for(const id of ['early','late']){
  const recent=html.match(new RegExp(`<a href="#/story/${id}"[\\s\\S]*?</a>`))[0];
  assert.match(recent,/<small>\d 回合 · [^<]*\d{2}:\d{2}<\/small>/);
  assert.match(recent,/title="[^\"]*2026/);
 }
 assert.match(html,/河岸之约/);assert.deepEqual(sessions,before);
});
