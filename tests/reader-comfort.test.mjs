import test from 'node:test';
import assert from 'node:assert/strict';
import * as comfort from '../src/reader-comfort.js';

test('reading appearance safely migrates old preferences and bounds imported values',()=>{
  assert.equal(comfort.readingAppearance({theme:'dark'}).readingTheme,'night');
  assert.equal(comfort.readingAppearance({}).readingTheme,'paper');
  const settings=comfort.readingAppearance({readingTheme:'<bad>',fontSize:500,lineHeight:0,width:-1,fontFamily:'bad'});
  assert.equal(settings.readingTheme,'paper');
  assert.equal(settings.fontSize,30);
  assert.equal(settings.lineHeight,1.5);
  assert.equal(settings.width,480);
  assert.equal(settings.fontFamily,'serif');
});

test('appearance controls expose four themes and direct typography adjustments',()=>{
  const html=comfort.readingAppearanceView({readingTheme:'sage',fontSize:22,lineHeight:1.85});
  assert.equal((html.match(/name="readingTheme"/g)||[]).length,4);
  assert.match(html,/value="sage"[^>]*checked/);
  assert.match(html,/name="fontSize"[^>]*value="22"/);
  assert.match(html,/data-size-step="-1"/);
  assert.match(html,/data-size-step="1"/);
  assert.match(html,/即时生效/);
});
