import test from 'node:test';
import assert from 'node:assert/strict';
import {icon,readerQuickTools,readerTimeline} from '../src/ui-controls.js';
import {readerView} from '../src/reading-ui.js';

test('icon names are allowlisted and unknown or inherited names use the safe fallback',()=>{
  const fallback=icon('book');
  for(const name of ['unknown','constructor','toString','__proto__','"><script>alert(1)</script>',null,undefined,{}]){
    assert.equal(icon(name),fallback);
  }
  assert.match(icon('search'),/data-icon="search"/);
  assert.match(icon('search'),/aria-hidden="true" focusable="false"/);
});

test('one tool entry exposes read-only queries; execution is unavailable while busy or ended',()=>{
  for(const state of [{busy:true},{ended:true},{}]){
    const html=readerQuickTools(state);
    assert.equal((html.match(/data-action="reader-inspect"/g)||[]).length,1);
    assert.ok(html.includes('data-kind="all"'));
    assert.doesNotMatch(html,/<input|<textarea|autofocus/);
    assert.doesNotMatch(html,/dynamic-prepare|智能交互|整理当前处境/);
    if(state.busy||state.ended){assert.doesNotMatch(html,/data-action="continue"/);assert.match(html,/data-action="time-control" disabled/);}
    else assert.match(html,/data-action="continue"/);
  }
});

test('timeline reads saved prose and honest clocks without deriving dates or mutating state',()=>{
  const branch={opening:'开场',turns:[{id:'t"><script>',prose:'<img src=x>已发生',experience:{clock:{label:'午后'}}},{id:'t2',prose:'第二段',state:{time:'秘密时间'}}]};
  const before=JSON.stringify(branch),html=readerTimeline(branch);
  assert.equal(JSON.stringify(branch),before);
  assert.match(html,/午后/);assert.match(html,/data-node="t2"/);
  assert.doesNotMatch(html,/<img|<script|秘密时间|data-action="continue"/);
  assert.ok(html.indexOf('<p>开场</p>')<html.indexOf('&gt;已发生')&&html.indexOf('&gt;已发生')<html.indexOf('<p>第二段</p>'));
});

test('empty drafts cannot send and populated drafts remain editable with tools',()=>{
  assert.match(readerView({branch:{draft:'  '}}),/type="submit"[^>]*disabled/);
  assert.doesNotMatch(readerView({branch:{draft:'看看地图'}}),/type="submit"[^>]*disabled/);
  const busy=readerView({busy:true,branch:{draft:'还没说完'}});
  assert.match(busy,/data-action="cancel-generation"/);
  assert.match(busy,/<textarea[^>]*>还没说完/);
});
