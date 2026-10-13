import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsView,modelStatus} from '../src/settings-ui.js';

test('settings exposes one selected category at a time and defaults invalid categories safely',()=>{
 for(const selected of ['reading-settings','narrative-settings','model-settings','data-settings']){
  const html=settingsView({activeSection:selected});
  const panels=[...html.matchAll(/<section[^>]*data-settings-panel[^>]*>/g)].map(m=>m[0]);
  assert.equal(panels.length,4);
  assert.equal(panels.filter(panel=>!panel.includes(' hidden')).length,1);
  assert.match(panels.find(panel=>!panel.includes(' hidden')),new RegExp(`id="${selected}"`));
  assert.match(html,new RegExp(`data-section="${selected}"[^>]*aria-pressed="true"`));
 }
 assert.match(settingsView({activeSection:'bad" onclick="attack'}),/data-section="reading-settings"[^>]*aria-pressed="true"/);
});

test('save failures are visible above category panels even when data settings is not selected',()=>{
 const html=settingsView({activeSection:'reading-settings',saveError:'保存失败'});
 assert.ok(html.indexOf('role="alert"')<html.indexOf('class="settings-layout"'));
 assert.match(html,/data-action="retry-save"/);
});

test('reading switches remain labeled native inputs with truthful checked states',()=>{
 const html=settingsView({settings:{showTime:false,restReminder:true,reducedMotion:false,sendEnter:true}});
 for(const key of ['showTime','restReminder','reducedMotion','sendEnter']){
  assert.match(html,new RegExp(`for="${key}"`));
  assert.match(html,new RegExp(`id="${key}"[^>]*type="checkbox"[^>]*role="switch"[^>]*data-setting="${key}"`));
 }
 assert.match(html,/id="restReminder"[^>]*checked/);
 assert.doesNotMatch(html,/id="showTime"[^>]*checked/);
});

test('model status and settings values cannot inject markup and backup limits remain accessible',()=>{
 const status=modelStatus({available:true,provider:'<svg onload=x>',model:'<img src=x>'});
 assert.doesNotMatch(status,/<svg|<img/);assert.match(status,/&lt;svg/);
 const html=settingsView({settings:{fontSize:'" oninput="attack'},modelConfig:{available:false}});
 assert.doesNotMatch(html,/ oninput="attack/);assert.match(html,/单个 JSON 文件不能完整迁移/);
 assert.match(html,/class="settings-section-heading"/);
});
