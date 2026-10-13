import test from 'node:test';
import assert from 'node:assert/strict';
import * as request from '../src/rich-request.js';

test('explicit presentation requests go to a read-only generative response',()=>{
  assert.equal(typeof request.richInteractionRequest,'function');
  for(const input of ['用表格比较这两条路线','帮我画一张人物关系图','画出人物关系','把当前场景画成 SVG 图像','生成线索时间线','用卡片整理可能的选择','画个资源柱状图','智能整理当前处境','关系图']){
    assert.equal(request.richInteractionRequest(input)?.intent,input);
  }
});

test('ordinary actions, dialogue and mixed requests do not become display-only commands',()=>{
  for(const input of ['我把表格交给她','把表格交给她','把关系图递给侦探','用卡片挡住门','给我卡片我就走','我说：“给我画一张图”','如果用表格说服他会怎么样？','用表格比较路线，然后我去码头','不要画图','地图','继续','去调查关系图上的人',null])assert.equal(request.richInteractionRequest(input),null,input);
});

test('draft prompts append to existing writing and cannot act on the story',()=>{
  assert.equal(request.appendInteractionDraft('尚未发出的想法','向馆员询问来源'),'尚未发出的想法\n向馆员询问来源');
  assert.equal(request.appendInteractionDraft('','向馆员询问来源'),'向馆员询问来源');
  assert.equal(request.appendInteractionDraft('已有文字','   '),'已有文字');
  assert.throws(()=>request.appendInteractionDraft('已有文字','x'.repeat(1001)));
});
