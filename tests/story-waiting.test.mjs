import test from 'node:test';
import assert from 'node:assert/strict';
import {storyWaiting} from '../src/story-waiting.js';

const motif = options => storyWaiting(options).match(/data-story-motif="([^"]+)"/)?.[1];

test('the current action takes priority over the published scene', () => {
  assert.equal(motif({input:'我向店主问起这封信。',context:'雨水落在窗沿。'}), 'dialogue');
  assert.equal(motif({input:'沿着石阶走向码头。',context:'他回答了你的问题。'}), 'journey');
  assert.equal(motif({input:'打开信封，查看里面的字。',context:'你沿着山路前行。'}), 'discovery');
  assert.equal(motif({input:'我撑伞等雨停。',context:'刚才的对话告一段落。'}), 'rain');
});

test('a general continuation uses the most recent published cue', () => {
  assert.equal(motif({input:'让当前场景自然继续。',context:'窗外下着雨。他转过头，问道：“你准备好了吗？”'}), 'dialogue');
  assert.equal(motif({context:'你与他交谈片刻。随后独自沿着小路前行。'}), 'journey');
  assert.equal(motif({context:'路上你打开信封，辨认上面的笔迹。'}), 'discovery');
  assert.equal(motif({context:'谈话结束，窗外雨声渐密。'}), 'rain');
});

test('old context and unrelated words do not determine the waiting scene', () => {
  assert.equal(motif({context:'大雨落下。'+'桌上安静地放着一只杯子。'.repeat(1000)}), 'ink');
  assert.equal(motif({input:'I contemplate the painting and train of thought.'}), 'ink');
  assert.equal(motif(), 'ink');
});

test('only a bounded escaped public location is shown, never narrative source text', () => {
  const html=storyWaiting({input:'私人的行动原文',context:'尚未显示的叙述原文',location:'东门 <院> & "廊"',tentative:'未提交的下一回合'});
  assert.match(html,/东门 &lt;院&gt; &amp; &quot;廊&quot;/);
  assert.doesNotMatch(html,/私人的行动原文|尚未显示的叙述原文|未提交的下一回合|<院>/);
  const long=storyWaiting({location:'石'.repeat(100)+'不应被显示的末尾'});
  assert.match(long,/石+…/);
  assert.doesNotMatch(long,/石{40}|不应被显示的末尾/);
  assert.doesNotMatch(storyWaiting({location:{secret:'隐藏场所'}}),/隐藏场所|object Object/);
});

test('all waiting variants have one stable accessible announcement and decorative artwork', () => {
  for(const options of [{},{compact:true},{input:'下雨了',location:'钟表铺'}]){
    const html=storyWaiting(options);
    assert.match(html,/class="story-waiting(?:\s|"|[^\"]*\s)/);
    assert.match(html,/role="status"/);
    assert.match(html,/aria-live="polite"/);
    assert.match(html,/aria-atomic="true"/);
    assert.match(html,/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    const label=options.compact?'稍等片刻':'故事正在继续';
    assert.equal((html.match(new RegExp(label,'g'))||[]).length,1);
    if(options.compact)assert.doesNotMatch(html,/故事正在继续/);
    assert.doesNotMatch(html,/百分比|阶段|生成中|正在整理|\d+%|<script|<foreignObject/);
  }
});
