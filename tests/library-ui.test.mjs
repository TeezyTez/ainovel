import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryView,libraryView} from '../src/library-ui.js';
const worlds=[{id:'tea',version:1,title:'雨天茶铺',description:'修伞匠来买茶',tags:['日常','轻松'],characters:[{secret:'隐秘线索'}]},{id:'harbor',version:1,title:'旧港',description:'一封迟到的电报',tags:['悬疑']}];
const experience=w=>({promise:w.description,participation:'可以先阅读，再决定如何参与。'});
const session=(id,patch={})=>({id,title:'我的茶铺',activeBranch:'b-'+id,branches:[{id:'b-'+id,worldKey:'tea@1',opening:'公开开场',turns:[{id:'t-'+id,prose:'这句很早的蓝围巾原文。',input:'看看',state:{version:1,location:'茶铺',time:'第 1 个片刻'},ended:false}],initialState:{}}],updatedAt:10,createdAt:1,archived:false,...patch});
const discover=patch=>discoveryView({worlds,sessions:[],getExperience:experience,recap:()=>({summary:'真实停点'}),available:true,...patch});
test('discovery filters real title description tags and favorite ids without searching hidden backgrounds',()=>{
 let html=discover({query:'修伞匠',tag:'日常',favorites:['tea'],onlyFavorites:true});
 assert.match(html,/href="#\/world\/tea"/);assert.doesNotMatch(html,/href="#\/world\/harbor"/);assert.match(html,/aria-pressed="true"/);
 html=discover({query:'隐秘线索'});assert.match(html,/没有找到符合条件的开局/);assert.doesNotMatch(html,/href="#\/world\/tea"/);
 assert.match(html,/id="discovery-form"/);for(const name of ['query','tag','onlyFavorites'])assert.match(html,new RegExp(`name="${name}"`));
});
test('resume ignores the recycle bin, archived and finished stories; rendering does not mutate inputs',()=>{
 const sessions=[session('keep'),session('trash',{updatedAt:100,personal:{trashedAt:42}}),session('archived',{updatedAt:200,archived:true})],before=structuredClone(sessions);
 const html=discover({sessions});assert.match(html,/href="#\/story\/keep"/);assert.doesNotMatch(html,/href="#\/story\/(trash|archived)"/);assert.deepEqual(sessions,before);
});
test('discovery displays latest version once and honest model-offline wording',()=>{
 const html=discover({worlds:[...worlds,{...worlds[0],version:2,title:'茶铺新版'}],available:false});
 assert.equal((html.match(/href="#\/world\/tea"/g)||[]).length,1);assert.match(html,/茶铺新版/);assert.match(html,/生成新内容需连接模型/);
});
test('library uses full branch search, category controls and reversible recycle actions',()=>{
 const active=session('active'),removed=session('removed',{personal:{trashedAt:4}});
 active.branches[0].turns.push({id:'later',prose:'现在在喝水。',input:'继续',state:{location:'店内',version:2},ended:false});
 let html=libraryView({sessions:[active,removed],query:'蓝围巾'});assert.match(html,/href="#\/story\/active"/);assert.doesNotMatch(html,/href="#\/story\/removed"/);
 for(const name of ['query','category','group','sort'])assert.match(html,new RegExp(`name="${name}"`));
 for(const action of ['pin-story','story-note','archive-story','trash-story'])assert.match(html,new RegExp(`data-action="${action}"`));
 html=libraryView({sessions:[active,removed],category:'trash'});assert.match(html,/data-action="restore-story"/);assert.doesNotMatch(html,/data-action="trash-story"/);assert.doesNotMatch(html,/>永久删除<\/button>|30\s*天|云同步/);
});
test('user text and filter attributes are escaped and empty states retain a reset route',()=>{
 const attack='<img src=x onerror="boom">',s=session('s',{title:attack,personal:{note:attack,group:attack}});
 const html=libraryView({sessions:[s],query:'找不到" onclick="boom',group:attack});
 assert.doesNotMatch(html,/<img| onclick="boom/);assert.match(html,/没有找到符合条件的故事/);assert.match(html,/href="#\/stories"/);
 const discovered=discover({worlds:[{...worlds[0],title:attack,tags:[attack]}]});assert.doesNotMatch(discovered,/<img/);assert.match(discovered,/&lt;img/);
});
test('ignored openings are hidden reversibly and batch management is collapsed by default',()=>{
 const html=discover({excluded:['tea']});assert.doesNotMatch(html,/href="#\/world\/tea"/);assert.match(html,/data-action="restore-excluded" data-id="tea"/);assert.match(html,/data-action="exclude-world" data-id="harbor"/);
 const shelf=libraryView({sessions:[session('a'),session('b')]});assert.match(shelf,/<details class="library-batch">/);assert.match(shelf,/name="select-story" value="a"/);assert.match(shelf,/name="select-story" value="b"/);
 for(const action of ['batch-archive','batch-restore','batch-trash'])assert.match(shelf,new RegExp(`data-action="${action}"`));
});

test('discovery can exclude one tag while preserving the other filters',()=>{
 const html=discover({excludeTag:'日常'});
 assert.doesNotMatch(html,/href="#\/world\/tea"/);assert.match(html,/href="#\/world\/harbor"/);
 assert.match(html,/<select name="excludeTag">/);assert.match(html,/<option value="日常" selected>/);
 const empty=discover({tag:'日常',excludeTag:'日常'});
 assert.match(empty,/没有找到符合条件的开局/);assert.match(empty,/data-action="surprise-world"[^>]*disabled/);
});

test('discovery offers an honest deterministic reorder of the same filtered supply',()=>{
 const extra={id:'garden',version:1,title:'庭院',description:'春天修枝',tags:['日常']};
 const props={worlds:[...worlds,extra],orderSeed:1};
 const ids=html=>[...html.matchAll(/<h3><a href="#\/world\/([^\"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(ids(discover(props)),['harbor','garden','tea']);
 assert.equal(discover(props),discover(props));
 assert.deepEqual(ids(discover({...props,orderSeed:4})),['harbor','garden','tea']);
 assert.deepEqual(ids(discover({...props,excluded:['harbor']})),['garden','tea']);
 const html=discover(props);assert.match(html,/data-action="surprise-world"/);assert.match(html,/data-action="shuffle-worlds"/);assert.match(html,/换个顺序/);
 assert.doesNotMatch(html,/全新一批|新推荐批次/);
});
