import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryView,libraryView,worldAtmosphere} from '../src/library-ui.js';
const worlds=[{id:'tea',version:1,title:'雨天茶铺',description:'修伞匠来买茶',tags:['日常','轻松'],characters:[{secret:'隐秘线索'}]},{id:'harbor',version:1,title:'旧港',description:'一封迟到的电报',tags:['悬疑']}];
const experience=w=>({promise:w.description,participation:'可以先阅读，再决定如何参与。'});
const session=(id,patch={})=>({id,title:'我的茶铺',activeBranch:'b-'+id,branches:[{id:'b-'+id,worldKey:'tea@1',opening:'公开开场',turns:[{id:'t-'+id,prose:'这句很早的蓝围巾原文。',input:'看看',state:{version:1,location:'茶铺',time:'第 1 个片刻'},ended:false}],initialState:{}}],updatedAt:10,createdAt:1,archived:false,...patch});
const discover=patch=>discoveryView({worlds,sessions:[],getExperience:experience,recap:()=>({summary:'真实停点'}),available:true,...patch});

test('world entrance resumes the latest active experience and hides it during searches',()=>{
 const a=session('a'),b=session('b',{updatedAt:20}),trash=session('trash',{updatedAt:100,personal:{trashedAt:0}});
 const html=libraryView({sessions:[a,b,trash]});
 assert.match(html,/class="world-current"/);assert.match(html,/aria-label="回到世界：我的茶铺"/);
 assert.ok(html.indexOf('class="world-current"')<html.indexOf('id="library-form"'));
 assert.match(html,/class="world-list"/);assert.match(html,/aria-label="我的茶铺的经历选项"/);
 assert.doesNotMatch(libraryView({sessions:[a,b,trash],query:'蓝围巾'}),/class="world-current"/);
 assert.doesNotMatch(libraryView({sessions:[a,b,trash],category:'trash'}),/class="world-current"/);
});

test('world entrances use the active branch situation and player identity without mixing other lives',()=>{
 const current=session('current',{player:{identity:'临时店主'}});
 current.branches[0].turns[0].state={location:'临河茶铺',time:'傍晚',experience:{clock:{label:'雨停之后'}}};
 current.branches.push({id:'other',opening:'另一条经历的秘密',turns:[{state:{location:'不可混入的地点'}}]});
 const older=session('older',{updatedAt:1,personal:{pinned:true}});
 const html=libraryView({sessions:[older,current]});
 const entrance=html.slice(html.indexOf('<section class="world-current"'),html.indexOf('</section>')+10);
 assert.match(entrance,/href="#\/story\/current"/);
 for(const fact of ['临时店主','临河茶铺','雨停之后'])assert.ok(entrance.includes(fact));
 assert.doesNotMatch(html,/另一条经历的秘密|不可混入的地点|story-cover|shelf-grid|书架|部作品|在读/);
});

test('discovery keeps creation and resume accessible while search is progressively disclosed',()=>{
 const html=discover({sessions:[session('keep')]});
 assert.match(html,/<header class="discovery-toolbar">/);
 assert.match(html,/href="#\/create"[^>]*>创造世界/);
 assert.ok(html.indexOf('href="#/story/keep"')<html.indexOf('class="discovery-grid"'));
 assert.match(html,/<details class="discovery-search" id="discovery-search">/);
 assert.match(discover({query:'旧港'}),/<details class="discovery-search" id="discovery-search" open>/);
 assert.match(html,/<details class="discovery-more">[\s\S]*data-action="favorite-world"/);
 assert.doesNotMatch(html,/quick-start-form|人生，不止一种/);
});

test('world atmospheres are decorative, deterministic and never expose private data',()=>{
 const world={id:'unsafe',title:'<img onerror="boom">',secret:'do not expose',description:'public'};
 const cover=worldAtmosphere(world);
 assert.equal(cover,worldAtmosphere(world));assert.match(cover,/aria-hidden="true"/);
 assert.doesNotMatch(cover,/<img|onerror="boom"|do not expose|style=/);
 assert.match(cover,/data-world-tone="(?:forest|clay|midnight|gold|plum|slate)"/);
 assert.doesNotMatch(cover,/story-cover|cover-title|书架|书封/);
});

test('known worlds get bounded decorative motifs while custom worlds remain abstract',()=>{
 for(const [id,motif] of [['fog-harbor','harbor'],['mountain','mountain'],['thursday','books'],['truth-teahouse','tea'],['custom-id','portal']]){
  assert.match(worldAtmosphere({id}),new RegExp(`data-world-motif="${motif}"`));
 }
 assert.match(worldAtmosphere({id:'session-id',worldId:'fog-harbor'}),/data-world-motif="harbor"/);
 assert.match(worldAtmosphere({id:'__proto__'}),/data-world-motif="portal"/);
});

test('library category navigation is a single named radio group with one current selection',()=>{
 const html=libraryView({sessions:[session('a')],category:'pinned'});
 assert.match(html,/<fieldset class="library-category-nav"/);
 assert.equal((html.match(/type="radio" name="category"/g)||[]).length,6);
 assert.match(html,/type="radio" name="category" value="pinned" checked/);
 assert.equal((html.match(/type="radio" name="category"[^>]* checked/g)||[]).length,1);
});
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

test('discovery return contains only latest active prose with turn and branch context',()=>{
 const s=session('return',{updatedAt:Date.UTC(2026,9,13,6,15),player:{identity:'临时店主'}});
 s.branches[0].name='留下来';s.branches[0].parentBranch='sibling';
 s.branches.push({id:'sibling',name:'秘密分支',opening:'不能显示的另一条经历',turns:[]});
 const before=structuredClone(s),html=discover({sessions:[s]});
 const strip=html.match(/<section class="world-return-strip"[\s\S]*?<\/section>/)?.[0]||'';
 assert.match(strip,/这句很早的蓝围巾原文。/);assert.match(strip,/1 回合/);assert.match(strip,/留下来/);
 assert.match(strip,/href="#\/story\/return"[^>]*[\s\S]*?回到世界/);
 assert.doesNotMatch(strip,/秘密分支|不能显示的另一条经历|真实停点/);
 assert.deepEqual(s,before);
});

test('discovery cards quote a bounded public opening and keep identity explicit',()=>{
 const attack='<img src=x onerror="boom">';
 const html=discover({worlds:[{...worlds[0],opening:attack+'雨停了。'.repeat(80),identity:'店主',characters:[{secret:'PRIVATE_SENTINEL'}]}]});
 assert.match(html,/<blockquote class="discovery-opening">/);assert.match(html,/你的身份：店主/);
 assert.doesNotMatch(html,/<img|PRIVATE_SENTINEL/);
 const quote=html.match(/<blockquote class="discovery-opening">([\s\S]*?)<\/blockquote>/)[1];
 assert.ok(quote.length<200);assert.match(quote,/&lt;img/);
 assert.doesNotMatch(discover(),/class="discovery-opening"/);
 const sentence=discover({worlds:[{...worlds[0],opening:'桌上有3.5枚银币。窗外传来脚步声。'}]});
 assert.match(sentence,/<blockquote class="discovery-opening">桌上有3.5枚银币。<\/blockquote>/);
});

test('same-world entries always show latest prose, active progress and full accessible dates',()=>{
 const early=session('early',{updatedAt:Date.UTC(2026,9,13,1,20)}),late=session('late',{updatedAt:Date.UTC(2026,9,13,7,40)});
 late.branches[0].name='河岸之约';late.branches[0].parentBranch='hidden';
 late.branches[0].turns.push({id:'last',prose:'你把茶杯放在窗边。',state:{location:'茶铺'},ended:false});
 late.branches.push({id:'hidden',name:'PRIVATE_BRANCH',opening:'PRIVATE_PROSE',turns:[]});
 const before=structuredClone([early,late]);const html=libraryView({sessions:[early,late]});
 for(const [id,prose,count] of [['early','这句很早的蓝围巾原文。',1],['late','你把茶杯放在窗边。',2]]){
  const entry=html.match(new RegExp(`<article class="world-entry" data-story-id="${id}">[\\s\\S]*?</article>`))[0];
  assert.match(entry,new RegExp(`<p class="world-entry-excerpt">${prose}`));assert.match(entry,new RegExp(`${count} 回合`));
  assert.match(entry,/<time datetime="2026-10-13T[^\"]+" title="[^\"]+" aria-label="[^\"]*2026[^\"]*">[^<]*\d{2}:\d{2}<\/time>/);
 }
 assert.match(html,/河岸之约/);assert.doesNotMatch(html,/PRIVATE_BRANCH|PRIVATE_PROSE/);assert.deepEqual([early,late],before);
});

test('search results keep the latest prose separate from an earlier matching passage',()=>{
 const s=session('search');s.branches[0].turns.push({id:'last',prose:'现在在喝水。',state:{location:'店内'},ended:false});
 const html=libraryView({sessions:[s],query:'蓝围巾'});
 assert.match(html,/<p class="world-entry-excerpt">现在在喝水。<\/p>/);
 assert.match(html,/<p class="world-entry-search-match">[\s\S]*蓝围巾/);
});

test('new prose, progress and resume content escape user text without inventing missing story facts',()=>{
 const attack='<img src=x onerror="boom">',s=session('safe');
 s.branches[0].name=attack;s.branches[0].turns[0].prose=attack;
 const before=structuredClone(s),html=libraryView({sessions:[s]})+discover({sessions:[s]});
 assert.doesNotMatch(html,/<img|onerror="boom"/);assert.match(html,/&lt;img/);assert.deepEqual(s,before);
 const initial=session('initial');initial.branches[0].turns=[];
 assert.match(discover({sessions:[initial]}),/0 回合 · 开场/);assert.match(discover({sessions:[initial]}),/公开开场/);
});
