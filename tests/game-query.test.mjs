import test from 'node:test';
import assert from 'node:assert/strict';
import {gameQuery,gameRecallState} from '../src/game-query.js';

test('explicit interface requests select a read-only game query',()=>{
  for(const [input,kind] of [['查看地图','map'],['打开地图','map'],['看看背包','inventory'],['我的状态','status'],['查看线索','clues'],['查看目标','objectives'],['唤出玩法','all'],['请查看我的背包。','inventory'],['  显示状态？  ','status']])assert.equal(gameQuery(input),kind,input);
});

test('bare panel names and natural display requests never become story actions',()=>{
  for(const [input,kind] of [['地图','map'],['给我看看地图','map'],['请把地图显示出来','map'],['我想看一下地图','map'],['能显示地图吗？','map'],['背包','inventory'],['我有哪些物品？','inventory'],['状态栏','status'],['任务','objectives'],['线索','clues'],['附近地图','map']])assert.equal(gameQuery(input),kind,input);
});

test('quoted dialogue and story actions are never hijacked by interface queries',()=>{
  for(const input of ['“查看地图”','他说：打开地图','我说「看看背包」','去地图上的房间','查看地图后去庭院','我打开地图寻找逃生路线','打开地图上的箱子','不查看地图','查看\n地图','地图在哪里？','看看背包里有没有钥匙',null,{},42,''])assert.equal(gameQuery(input),null,String(input));
});

test('legacy recall only projects known public objects and never infers quantities',()=>{
  const kinds={person:'actor',item:'item',location:'place',resource:'meter',clue:'clue',agreement:'objective',fact:'clue',event:'objective'};
  const situation={objects:Object.entries(kinds).map(([kind],index)=>({id:`known:${index}`,kind,name:'同名',summary:'现有3件',status:'已知',fields:[{key:'amount',value:'3'},{key:'unit',value:'枚'}],quote:'公开原句',sourceVersion:2,secret:'HIDDEN'}))};
  const state={version:4,secret:'HIDDEN',inventory:['SECRET INVENTORY']},before=structuredClone({state,situation});
  const snapshot=gameRecallState(state,situation),recall=snapshot.game;
  assert.equal(snapshot.version,4);assert.equal(recall.schemaVersion,1);assert.deepEqual(recall.surfaces,[]);
  assert.deepEqual(recall.entities.map(e=>e.kind),Object.values(kinds));assert.equal(new Set(recall.entities.map(e=>e.id)).size,8);
  for(const e of recall.entities){assert.equal(e.value,null);assert.equal(e.max,null);assert.equal(e.unit,'');assert.equal(e.detail,'现有3件');assert.equal(e.quote,'公开原句');assert.equal(e.sourceVersion,2);}
  assert.equal(JSON.stringify(recall).includes('HIDDEN'),false);assert.equal(JSON.stringify(recall).includes('SECRET'),false);
  assert.deepEqual({state,situation},before);
});

test('game identities win conflicts and same names do not merge different objects',()=>{
  const state={version:5,location:'门前',game:{schemaVersion:1,private:'SECRET',entities:[{id:'key',kind:'item',name:'钥匙',detail:'正在持有',status:'完好',value:2,max:3,unit:'把',quote:'两把钥匙',sourceVersion:4,hidden:'SECRET'}],surfaces:[{id:'door',kind:'interaction',title:'门',description:'',entityIds:['key'],links:[],actions:[{id:'use',label:'用钥匙',input:'用钥匙开门',mode:'attempt',effects:[],destination:null,disabledReason:'',script:'SECRET'}],quote:'门在前方',version:5,secret:'SECRET'}]}};
  const situation={objects:[{id:'key',kind:'item',name:'错误覆盖',summary:'丢失',sourceVersion:5},{id:'other-key',kind:'item',name:'钥匙',sourceVersion:3}]};
  const before=structuredClone(state),recall=gameRecallState(state,situation).game;
  assert.equal(recall.entities.length,2);assert.equal(recall.entities[0].name,'钥匙');assert.equal(recall.entities[0].value,2);assert.equal(recall.entities[0].max,3);assert.equal(recall.entities[1].value,null);
  assert.equal(recall.surfaces[0].actions[0].input,'用钥匙开门');assert.equal(JSON.stringify(recall).includes('SECRET'),false);
  assert.equal(recall.surfaces[0].version,5);assert.equal(gameRecallState(state,situation).location,'门前');
  recall.entities[0].value=0;recall.surfaces[0].actions[0].label='更改';assert.deepEqual(state,before);
});

test('empty recalls remain empty and missing public fields are not synthesized',()=>{
  assert.deepEqual(gameRecallState(undefined,undefined),{version:0,location:'',game:{schemaVersion:1,entities:[],surfaces:[]}});
  const recall=gameRecallState({version:2},{objects:[{id:'item:1',kind:'item',name:'钥匙'}]}).game;
  assert.deepEqual(recall.entities[0],{id:'item:1',kind:'item',name:'钥匙',detail:'',status:'',value:null,max:null,unit:'',quote:'',sourceVersion:2});
});

test('descriptive legacy location does not duplicate a freshly identified current place',()=>{
 const location='你已到达路口拐角，未向右侧深入。';
 const state={version:3,location,game:{entities:[{id:'corner',kind:'place',name:'路口拐角',status:'当前位置',sourceVersion:3}]}};
 const projection=gameRecallState(state,{objects:[{id:'legacy',kind:'location',name:location,sourceVersion:2},{id:'town',kind:'location',name:'东京',sourceVersion:0}]});
 assert.deepEqual(projection.game.entities.map(e=>e.id),['corner','town']);
});
