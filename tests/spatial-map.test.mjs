import test from 'node:test';
import assert from 'node:assert/strict';
import * as spatial from '../src/spatial-state.js';
import {advanceGame,validateGameUpdate,resolveGameAction} from '../src/game-state.js';
import {createSession,commitTurn,currentState,forkBranch,validateArchive} from '../src/core.js';
import {spatialMapView} from '../src/spatial-map-view.js';
import {gameRecallState} from '../src/game-query.js';

import {names,prose,entity,site,relation,atlas} from './fixtures/spatial-world.mjs';
const update=()=>({entities:Object.keys(names).slice(0,4).map(entity),surfaces:[],spatial:atlas()});

test('spatial facts survive a turn without cards and round-trip on separate branches',()=>{
 const world={id:'map-world',version:1,title:'港湾',location:'港口',opening:prose,identity:'旅人',rules:[],characters:[]};
 const session=createSession(world);const turn=commitTurn(session,world,'观察',{requestId:'one',baseVersion:0,prose,events:[],game:update()});
 const before=structuredClone(currentState(session).game.spatial);
 commitTurn(session,world,'等待',{requestId:'two',baseVersion:1,prose:'钟声响了。',events:[],game:null});
 assert.deepEqual(currentState(session).game.spatial,before);
 forkBranch(session,turn.id,'沿途');assert.deepEqual(currentState(session).game.spatial,before);
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[session]}));
});
test('spatial updates reject missing quotes, unknown places and contradictory directions',()=>{
 assert.throws(()=>validateGameUpdate({...update(),spatial:{...atlas(),relations:[{...atlas().relations[0],quote:'秘密地点'}]}},prose));
 assert.throws(()=>advanceGame(undefined,{...update(),spatial:{...atlas(),relations:[relation('bad','port','secret','N')]}},1));
 const game=advanceGame(undefined,update(),1);
 assert.throws(()=>advanceGame(game,{entities:[],surfaces:[],spatial:{sites:[],relations:[relation('reverse','square','port','N')]}},2),/方位/);
 assert.throws(()=>advanceGame(game,{entities:[],surfaces:[],spatial:{sites:[],relations:[relation('north','port','square','S',300)]}},2),/空间|方位/);
});
test('containment cannot cycle and road closures do not silently become movement permissions',()=>{
 const game=advanceGame(undefined,update(),1);
 assert.throws(()=>advanceGame(game,{entities:[],surfaces:[],spatial:{sites:[site('port','landmark','square'),site('square','landmark','port')],relations:[]}},2));
 const reopened=advanceGame(game,{entities:[],surfaces:[],spatial:{sites:[],relations:[{...atlas().relations[4],passage:'open',quote:'广场通往灯塔的栈桥解除封锁，可以通行。'}]}},2);
 assert.equal(reopened.spatial.relations.find(r=>r.id==='bridge').passage,'open');
 assert.equal(game.spatial.relations.find(r=>r.id==='bridge').passage,'blocked');
});
test('physical projection preserves bearings, measured ratios and layout across player movement',()=>{
 assert.equal(typeof spatial.projectSpatialMap,'function');
 const game=advanceGame(undefined,update(),1),a=spatial.projectSpatialMap(game,{currentId:'port'}),b=spatial.projectSpatialMap(game,{currentId:'forest'});
 assert.deepEqual(a.positions,b.positions);assert.equal(a.metric,true);
 const p=a.positions.get('port'),s=a.positions.get('square'),f=a.positions.get('forest'),t=a.positions.get('tower');
 assert.ok(s.y<p.y&&f.x>s.x&&t.x<s.x);assert.ok(Math.abs(p.x-s.x)<0.001);
 assert.ok(Math.abs((f.x-s.x)/(s.x-t.x)-2)<0.001);
 assert.equal(a.routes.length,2);
});
test('unlocated places do not acquire invented coordinates; unknown distances disable scale',()=>{
 const u=update();u.entities.push(entity('hall'));u.spatial.sites.push(site('hall','building',null,'大厅是一座独立建筑。'));u.spatial.relations[0].distanceMeters=null;
 const result=spatial.projectSpatialMap(advanceGame(undefined,u,1));
 assert.equal(result.metric,false);assert.equal(result.positions.has('hall'),false);assert.ok(result.unplaced.includes('hall'));
});
test('interior containment uses a separate spatial frame',()=>{
 const u=update(),insideQuote='大厅与档案室在灯塔内部。档案室位于大厅正东。';u.entities.push(entity('hall'),entity('room'));u.spatial.sites.push(site('hall','room','tower',insideQuote),site('room','room','tower',insideQuote));
 u.spatial.relations.push(relation('inside','hall','room','E',null,{quote:insideQuote}));
 const g=advanceGame(undefined,u,1),outside=spatial.projectSpatialMap(g),inside=spatial.projectSpatialMap(g,{scope:'tower'});
 assert.equal(outside.positions.has('room'),false);assert.equal(inside.positions.has('port'),false);assert.ok(inside.positions.get('room').x>inside.positions.get('hall').x);
});

test('a measured map renders terrain, scale, blocked routes and no movement controls',()=>{
 const game=advanceGame(undefined,update(),1),before=JSON.stringify(game),html=spatialMapView(game,{location:'港口',version:1});
 for(const pattern of [/atlas-forest/,/atlas-building/,/atlas-scale/,/atlas-route-blocked/,/栈桥 · 封锁/,/按记录距离示意/,/aria-current="location"/,/data-action="map-zoom"/])assert.match(html,pattern);
 assert.doesNotMatch(html,/data-action="game-act"|game-map-node/);assert.equal(JSON.stringify(game),before);
 const attack=structuredClone(game);attack.entities[0].detail='<img src=x onerror=alert(1)>';attack.spatial.relations[4].label='<script>bad()</script>';
 assert.doesNotMatch(spatialMapView(attack),/<img|<script>/);assert.match(spatialMapView(attack),/&lt;script&gt;/);
});
test('public recall preserves durable geography after its original card expires',()=>{
 const original=advanceGame(undefined,update(),1),later=advanceGame(original,null,2),state={version:2,location:'港口',game:later};
 const projection=gameRecallState(state,{objects:[]});assert.deepEqual(projection.game.spatial,original.spatial);
 projection.game.spatial.relations[0].bearing='S';assert.equal(state.game.spatial.relations[0].bearing,'N');
});
test('legacy recovery reads explicit compass sentences but excludes rumour and does not invent roads',()=>{
 const entities=['port','square'].map(entity),before=JSON.stringify(entities);
 const result=spatial.recoverSpatial(entities,['广场位于港口正北300米。']);
 assert.equal(result.relations.length,1);assert.equal(result.relations[0].bearing,'N');assert.equal(result.relations[0].from,'port');assert.equal(result.relations[0].distanceMeters,300);
 assert.equal(spatial.recoverSpatial(entities,['听说广场位于港口正北300米。']),undefined);
 assert.equal(spatial.recoverSpatial(entities,['广场与港口隔河相望。']),undefined);assert.equal(JSON.stringify(entities),before);
});
test('northeast is a quadrant so a 3-4-5 measured triangle remains valid',()=>{
 const u=update();u.spatial.relations.push(relation('diagonal','port','forest','NE',500,{quote:'松林在港口东北500米。'}));
 const projection=spatial.projectSpatialMap(advanceGame(undefined,u,1)),p=projection.positions.get('port'),f=projection.positions.get('forest');assert.ok(Math.abs(Math.hypot(f.x-p.x,f.y-p.y)-500)<0.001);
 u.spatial.relations.at(-1).distanceMeters=700;u.spatial.relations.at(-1).quote='松林在港口东北700米。';
 u.entities.push(entity('hall'));u.spatial.relations.push(relation('unknown-length','port','hall','S',null,{quote:'大厅在港口南边。'}));
 assert.throws(()=>advanceGame(undefined,u,1),/测距/);
});
test('a spatial-only road update can be followed by another ordinary turn',()=>{
 const first=advanceGame(undefined,update(),1),second=advanceGame(first,{entities:[],surfaces:[],spatial:{sites:[],relations:[{...atlas().relations[4],passage:'open',quote:'广场通往灯塔的栈桥解除封锁，可以通行。'}]}},2);
 const third=advanceGame(second,null,3);assert.deepEqual(third.spatial,second.spatial);
});
test('one-way physical routes reject a stale reverse apply link',()=>{
 const u=update();u.spatial.relations.find(r=>r.id==='road').bidirectional=false;
 u.surfaces=[{id:'move',kind:'map',title:'路',description:'',quote:prose,entityIds:['square','port'],links:[{from:'square',to:'port',label:'石路'}],actions:[{id:'back',label:'回港口',input:'回港口',mode:'apply',destination:'port',effects:[],disabledReason:''}]}];
 const game=advanceGame(undefined,u,1);assert.throws(()=>resolveGameAction({version:1,location:'广场',game},{branchId:'b',version:1,surfaceId:'move',actionId:'back'},{branchId:'b'}),/单向/);
});
test('negated directions and partial compass words cannot become physical facts',()=>{
 for(const [quote,bearing] of [['广场不在港口正北300米。','N'],['广场位于港口东北300米。','E']]){
  const u=update();u.spatial.relations=[relation('wrong','port','square',bearing,300,{quote})];assert.throws(()=>advanceGame(undefined,u,1),/方位/);
 }
});
test('a new site does not erase compass facts recovered from legacy prose',()=>{
 const state={version:2,location:'港口',game:{entities:['port','square'].map(id=>({...entity(id),sourceVersion:1})),surfaces:[],spatial:{schemaVersion:1,sites:[{...site('port'),sourceVersion:2}],relations:[]}}};
 const projection=gameRecallState(state,{objects:[]});assert.ok(projection.game.spatial.relations.some(r=>r.from==='port'&&r.to==='square'&&r.bearing==='N'));
 assert.equal(state.game.spatial.relations.length,0);
});
test('common compass and reopened-road wording does not reject valid new geography',()=>{
 const u=update();u.spatial.relations[0].quote='广场位于港口以北300米。';u.spatial.relations[4]={...u.spatial.relations[4],passage:'open',quote:'广场通往灯塔的栈桥封锁已经解除，现在可以通行。'};
 assert.doesNotThrow(()=>advanceGame(undefined,u,1));
});
test('long measured chains and thin triangles do not fail because of numerical convergence',()=>{
 const entities=Array.from({length:50},(_,i)=>({...entity('port'),id:'p'+i,name:'地点'+i}));
 const relations=entities.slice(1).map((e,i)=>relation('r'+i,entities[i].id,e.id,'N',i%2?1000:300,{sourceVersion:1,quote:`${e.name}位于${entities[i].name}正北${i%2?1000:300}米。`}));
 const game={entities,spatial:{schemaVersion:1,sites:[],relations}};
 assert.doesNotThrow(()=>spatial.validateSpatial(game.spatial,undefined,{snapshot:true,entities,version:1}));assert.equal(spatial.projectSpatialMap(game).metric,true);
 const points=['port','square','forest'].map(entity),d1=Math.hypot(500,10),d2=Math.hypot(1500,10),g={entities:points,spatial:{schemaVersion:1,sites:[],relations:[relation('a','port','square','E',1000),relation('b','square','forest','NE',d1),relation('c','port','forest','NE',d2)]}};
 assert.equal(spatial.projectSpatialMap(g).metric,true);
});

test('a separately stated distance is not mistaken for a contradictory parsed distance',()=>{
 const u=update();u.spatial.relations[0].quote='广场位于港口北面，直线距离300米。';
 assert.doesNotThrow(()=>advanceGame(undefined,u,1));
 u.spatial.relations[0].quote='广场位于港口北面200米，旧标牌写着300米。';
 assert.throws(()=>advanceGame(undefined,u,1),/距离/);
});

test('impossible measured paths are rejected before numerical fallback',()=>{
 const u=update();u.spatial.relations=[relation('a','port','square','NE',100,{quote:'广场位于港口东北100米。'}),relation('b','square','forest','NE',100,{quote:'松林位于广场东北100米。'}),relation('c','port','forest','NE',300,{quote:'松林位于港口东北300米。'})];
 assert.throws(()=>advanceGame(undefined,u,1),/测距/);
});
