import test from 'node:test';
import assert from 'node:assert/strict';
import { homeView, detailView, creatorView } from '../src/experience-views.js';
const world={id:'test',title:'茶铺',version:1,identity:'店主',description:'开门的第一天',opening:'客人想买一份礼物。',rules:['可以沉默'],characters:[],tags:[],custom:true,demoCompatible:false};
const experience={promise:'经营与生活',premise:'你是店主',pressure:'轻松',participation:'自由表达',possibilities:['问问用途'],closure:'完成一次招待'};
test('new entrance shows concrete situation and returning session before new scenes',()=>{
  const html=homeView({worlds:[world],sessions:[{id:'s1',title:'旧故事',updatedAt:1,player:{name:'我'},branches:[],archived:false}],getExperience:()=>experience,recap:()=>({location:'门前',summary:'上次发生的事'}),available:true});
  assert.ok(html.indexOf('继续故事')<html.indexOf('开始新故事'));assert.match(html,/经营与生活/);
});
test('custom world with no model offers honest opening-only mode and explicit role premise',()=>{
  const html=detailView({world,experience,settings:{},available:false,provider:''});
  assert.match(html,/只读开场/);assert.match(html,/你是店主/);assert.match(html,/开始故事/);
  assert.doesNotMatch(html,/>预设演示 · 8/);
});
test('light creation keeps seed escaped and labels real AI availability',()=>{
  const html=creatorView({world:{...world,seed:'<script>bad</script>',narrative:{}},available:true,characterFields:()=>''});
  assert.ok(!html.includes('<script>'));assert.match(html,/直接进入故事/);assert.match(html,/name="seed"/);
});
