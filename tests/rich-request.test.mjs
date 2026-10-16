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

test('natural comparison, route sketch and adjustable panel requests become rich intents',()=>{
  for(const input of ['帮我比较一下这几条路线','比较北路和南路','画个路线图','给我做个可以拖动的物资分配面板']){
    assert.equal(request.richInteractionRequest(input)?.intent,input,input);
  }
});

test('follow-up changes target the existing artifact only when one exists',()=>{
  for(const input of ['把这个改成时间线','把这个图放大一点','这个关系图加上刚才的船员']){
    assert.equal(request.richInteractionRequest(input,{hasArtifact:true})?.intent,input,input);
    assert.equal(request.richInteractionRequest(input),null,input);
  }
});

test('dialogue, negation and story actions remain outside rich intents even with an artifact',()=>{
  for(const input of ['我说：“帮我比较一下这几条路线”','别画路线图','不要把这个改成时间线','把这个图放大一点，然后我去码头','这个关系图加上刚才的船员，再去问他']){
    assert.equal(request.richInteractionRequest(input,{hasArtifact:true}),null,input);
  }
});

test('draft prompts append to existing writing and cannot act on the story',()=>{
  assert.equal(request.appendInteractionDraft('尚未发出的想法','向馆员询问来源'),'尚未发出的想法\n向馆员询问来源');
  assert.equal(request.appendInteractionDraft('','向馆员询问来源'),'向馆员询问来源');
  assert.equal(request.appendInteractionDraft('已有文字','   '),'已有文字');
  assert.throws(()=>request.appendInteractionDraft('已有文字','x'.repeat(1001)));
});

test('interactive calculations and control requests stay outside story generation',()=>{
 for(const input of ['做一个可以拖动数量、实时看剩余的分配试算','帮我做个可交互的物资分配工具','做个滑块调整干粮数量','把这些物资做成可操作的分配界面'])assert.equal(request.richInteractionRequest(input)?.intent,input,input);
 for(const input of ['我拖动桌上的滑块，打开暗门','我把干粮分配给他们','做一份干粮给阿青'])assert.equal(request.richInteractionRequest(input),null,input);
});

test('referencing an illustration does not swallow a story object change',()=>{
 for(const input of ['把这个改成我的名字','把这个加上盐','这个增加到三份'])assert.equal(request.richInteractionRequest(input,{hasArtifact:true}),null,input);
});

for(const input of [
 '只显示北路和南路','只显示山路和水路','只显示已知线索','按时间排序','按名称排序',
 '把这个图里的文字放大一点','把当前的面板里的字体缩小一点','给这个表格加一列来源',
 '这个图看不清，字大一点','这个图只显示已知线索','把这个表格按时间排序',
 '不要显示未知项','别显示未确认的信息'
])test(`current display refinement requires an existing artifact: ${input}`,()=>{
 assert.equal(request.richInteractionRequest(input,{hasArtifact:true})?.intent,input);
 assert.equal(request.richInteractionRequest(input,{hasArtifact:false}),null);
});

test('display refinement never consumes dialogue, story actions or hypothetical questions',()=>{
 for(const input of [
  '我对船员说只显示北路和南路','船员说：按时间排序','如果只显示北路和南路会发生什么',
  '只显示北路和南路会有什么后果','如果把这个图里的文字放大一点呢',
  '只显示北路和南路，我去北路','只显示北路和南路并去调查驿站','按时间排序后出发',
  '给这个表格加一列来源并告诉船员准备出发','把这个图里的文字放大一点就交给船员',
  '这个图看不清，字大一点，我去找人','这个图放大一点，我去码头',
  '不要显示敌人，我悄悄离开','不要显示未知项并问船员','不要把这个改成时间线',
  '这个人看不清，字大一点','这个地方按时间排序','把这个字放大一点',
  '把这个改成时间线会发生什么','把这个图放大一点能打开暗门吗'
 ])assert.equal(request.richInteractionRequest(input,{hasArtifact:true}),null,input);
});

test('named route comparisons use route wording without requiring specific route names',()=>{
 for(const input of ['比较山路和水路','对比旧港路线与山谷路线'])assert.equal(request.richInteractionRequest(input)?.intent,input,input);
 for(const input of ['比较山路和水路，我走山路','比较山路和水路会发生什么'])assert.equal(request.richInteractionRequest(input),null,input);
});

test('negated display wording about a character is not a data filter',()=>{
 for(const input of ['不要显示敌意','别显示破绽','不要显示出紧张'])assert.equal(request.richInteractionRequest(input,{hasArtifact:true}),null,input);
});

test('questions about a display change do not execute the change',()=>{
 for(const input of ['只显示北路和南路是不是更安全','不要显示未知项是否会影响剧情','给这个表格加一列来源有用吗','把这个图放大一点会不会暴露位置'])assert.equal(request.richInteractionRequest(input,{hasArtifact:true}),null,input);
});
