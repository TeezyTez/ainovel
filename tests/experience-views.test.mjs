import test from 'node:test';
import assert from 'node:assert/strict';
import { homeView, detailView, creatorView } from '../src/experience-views.js';
const world={id:'test',title:'茶铺',version:1,identity:'店主',description:'开门的第一天',opening:'客人想买一份礼物。',rules:['可以沉默'],characters:[],tags:[],custom:true,demoCompatible:false};
const experience={promise:'经营与生活',premise:'你是店主',pressure:'轻松',participation:'自由表达',possibilities:['问问用途'],closure:'完成一次招待'};

test('creation starts with one idea action and reveals draft tools only in the optional editor',()=>{
 const html=creatorView({world:{...world,title:'',opening:'',seed:'未发送的想法'},available:true,characterFields:()=>''});
 const disclosure=html.indexOf('<details id="world-details"');
 assert.ok(html.indexOf('data-action="quick-world"')<disclosure);
 assert.ok(html.indexOf('data-action="generate-world"')>disclosure);
 assert.ok(html.indexOf('data-action="import-world-text"')>disclosure);
 assert.match(html,/<details id="world-details" ><summary>/);
 assert.match(html,/>未发送的想法<\/textarea>/);
});
test('new entrance shows concrete situation and returning session before new scenes',()=>{
  const html=homeView({worlds:[world],sessions:[{id:'s1',title:'旧故事',updatedAt:1,player:{name:'我'},branches:[],archived:false}],getExperience:()=>experience,recap:()=>({location:'门前',summary:'上次发生的事'}),available:true});
  assert.ok(html.indexOf('继续故事')<html.indexOf('开始新故事'));assert.match(html,/经营与生活/);
});
test('custom world with no model offers honest opening-only mode and explicit role premise',()=>{
  const html=detailView({world,experience,settings:{},available:false,provider:''});
  assert.match(html,/只读开场/);assert.match(html,/你是店主/);assert.match(html,/进入世界/);
  assert.doesNotMatch(html,/>预设演示 · 8/);
});
test('light creation keeps seed escaped and labels real AI availability',()=>{
  const html=creatorView({world:{...world,seed:'<script>bad</script>',narrative:{}},available:true,characterFields:()=>''});
  assert.ok(!html.includes('<script>'));assert.match(html,/data-action="quick-world"[^>]*>生成并开始<\/button>/);assert.match(html,/name="seed"/);
});

test('world presentation separates the entrance from public reading and never includes character secrets',()=>{
 const html=detailView({world:{...world,characters:[{name:'来客',public:'一位熟客',secret:'绝不能在作品页出现'}]},experience,settings:{},available:true});
 assert.match(html,/class="world-intro"/);assert.match(html,/class="world-opening"/);assert.match(html,/class="world-atmosphere/);
 assert.match(html,/一位熟客/);assert.doesNotMatch(html,/绝不能在作品页出现/);
 assert.equal((html.match(/id="start-form"/g)||[]).length,1);
 for(const name of ['name','identity','goal','boundaries','mode','participation','perspective','length'])assert.match(html,new RegExp(`name="${name}"`));
});

test('creator groups editable fields while preserving creation and versioning actions',()=>{
 const html=creatorView({world,available:true,characterFields:()=>''});
 assert.match(html,/class="creator-seed-panel"/);assert.match(html,/class="creator-chapter"/);
 for(const action of ['quick-world','generate-world','preview-world','add-character'])assert.match(html,new RegExp(`data-action="${action}"`));
 for(const name of ['seed','title','description','rules','identity','location','opening'])assert.match(html,new RegExp(`name="${name}"`));
});
