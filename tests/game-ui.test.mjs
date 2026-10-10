import test from 'node:test';
import assert from 'node:assert/strict';
import {gameTurnView,gameInspectView,gameRecallView} from '../src/game-ui.js';
import {readerView} from '../src/reading-ui.js';
import {readFileSync} from 'node:fs';

const entity=(id,kind,name,extra={})=>({id,kind,name,detail:'正文中可见的记录',status:'',value:null,max:null,unit:'',quote:'已经保存的原文',sourceVersion:2,...extra});
const entities=[entity('energy','meter','精力',{value:4,max:8,unit:'点'}),entity('coins','item','银币',{value:0,unit:'枚'}),entity('gate','place','门廊'),entity('hall','place','大厅'),entity('note','clue','折起的纸条'),entity('goal','objective','找到寄信人',{value:1,max:3,unit:'条线索'}),entity('host','actor','店主')];
const action={id:'walk',label:'穿过门廊',mode:'attempt',effects:[{entityId:'energy',delta:-1},{entityId:'coins',delta:2}],destination:'hall'};
const surfaces=[{id:'s',kind:'status',title:'此刻状态',entityIds:['energy']},{id:'m',kind:'map',title:'可见路线',entityIds:['gate','hall'],links:[{from:'gate',to:'hall',label:'木门后'}],actions:[action]},{id:'i',kind:'inventory',entityIds:['coins']},{id:'c',kind:'clues',entityIds:['note']},{id:'o',kind:'objectives',entityIds:['goal']},{id:'x',kind:'interaction',entityIds:['host'],actions:[{...action,id:'talk',label:'问店主',effects:[],destination:null}]}].map(s=>({...s,version:2}));
const turn={id:'turn2',prose:'店主收好了纸条。',state:{version:2,game:{schemaVersion:1,entities,surfaces}}};

test('scene cards expose six semantic layouts and concrete attempt previews',()=>{
  const html=gameTurnView(turn,{currentVersion:2,branchId:'branch-a'});
  for(const kind of ['status','map','inventory','clues','objectives','interaction'])assert.match(html,new RegExp(`game-surface game-surface-${kind}`));
  assert.match(html,/<progress[^>]+value="4" max="8"/);
  assert.match(html,/精力 -1 点/);assert.match(html,/银币 \+2 枚/);
  assert.match(html,/尝试前往 大厅/);assert.match(html,/结果由后续故事确认/);
  assert.match(html,/data-surface="m" data-action-id="walk" data-version="2" data-branch="branch-a"/);
  assert.match(html,/data-reader-live="game-turn2"/);
  assert.doesNotMatch(html,/<details class="game-history"/);
});

test('historical, busy, ended and independently stale surfaces cannot execute actions',()=>{
  for(const context of [{currentVersion:3},{currentVersion:2,busy:true},{currentVersion:2,ended:true},{}]){
    const html=gameTurnView(turn,context),buttons=html.match(/<button[^>]*data-action="game-act"[^>]*>/g);
    assert.ok(buttons.length);for(const button of buttons)assert.match(button,/ disabled /);
  }
  assert.match(gameTurnView(turn,{currentVersion:3}),/<details class="game-history"><summary>/);
  const stale={...turn,state:{...turn.state,game:{...turn.state.game,surfaces:[{...surfaces[1],version:1}]}}};
  assert.match(gameTurnView(stale,{currentVersion:2}),/data-action="game-act"[^>]+disabled/);
});

test('null and absent statistics never become fabricated zero or progress bars',()=>{
  const unknown=entity('uncertain','meter','灵感');
  const html=gameTurnView({id:'u',state:{version:2,game:{entities:[unknown],surfaces:[{id:'u',kind:'status',entityIds:['uncertain']}]}}},{currentVersion:2});
  assert.doesNotMatch(html,/<progress|<strong>|0 \/|生命|魔法/);
  assert.match(gameTurnView(turn,{currentVersion:2}),/aria-label="已知数量">0 枚/);
  assert.doesNotMatch(gameInspectView(unknown),/<progress|game-inspect-value/);
  assert.equal(gameTurnView({id:'empty',state:{version:1}},{currentVersion:1}),'<div data-reader-live="game-empty" class="game-turn"></div>');
});

test('map diagrams and accessible routes show only actual known edges',()=>{
  const map={...surfaces[1],entityIds:['gate','hall','note'],links:[...surfaces[1].links,{from:'hall',to:'secret',label:'invisible'}]};
  const html=gameTurnView({id:'map',state:{version:2,game:{entities,surfaces:[map]}}},{currentVersion:2});
  assert.equal((html.match(/<line /g)||[]).length,1);
  assert.match(html,/aria-label="正文已知的连接"/);assert.match(html,/木门后/);
  assert.doesNotMatch(html,/secret|invisible/);
  assert.match(html,/不表示距离或实际方位/);
});

test('requested maps expose named interactive nodes and remain open in reading density',()=>{
  const t=structuredClone(turn);t.input='地图';t.state.location='大厅';t.state.game.surfaces=[{...surfaces[1],actions:[]}];
  const html=gameTurnView(t,{currentVersion:2,density:'reading'});
  assert.doesNotMatch(html,/<details class="game-history"/);
  assert.match(html,/class="game-map-node[^>]*data-entity="hall"/);
  assert.match(html,/aria-current="location"/);
  assert.match(html,/data-action="game-map-expand"/);
  assert.match(html,/game-map-route-label/);
});

test('proactive read-only components open inline and timeline distinguishes planned from actual time',()=>{
 const t=structuredClone(turn);t.state.game.surfaces=[{...surfaces[1],actions:[]}];
 let html=gameTurnView(t,{currentVersion:2});
 assert.match(html,/class="game-context-card"[^>]* open/);assert.doesNotMatch(html,/<details class="game-history"/);
 t.state.game.surfaces=[];t.state.experience={objects:[{id:'handoff',kind:'agreement',name:'交接',status:'已约定',summary:'等待明早交接',certainty:'reported',sourceVersion:2,quote:'明早交接',fields:[{key:'scheduledAt',label:'时间',value:'明早'}],relatedIds:[]}]};
 html=gameTurnView(t,{currentVersion:2});assert.match(html,/game-record-timeline/);assert.match(html,/约定时间/);assert.match(html,/明早/);assert.match(html,/他人说法/);assert.doesNotMatch(html,/data-action="game-act"|倒计时/);
});

test('model can request comparison or people layouts while historic cards stay closed',()=>{
 const t=structuredClone(turn);t.state.game.surfaces=[{id:'compare',kind:'comparison',title:'比较工具',entityIds:['coins','note'],version:2},{id:'people',kind:'people',title:'在场人物',entityIds:['host'],version:2}];
 const html=gameTurnView(t,{currentVersion:2});assert.match(html,/game-comparison/);assert.match(html,/<table>/);assert.match(html,/game-people/);
 const past=gameTurnView(t,{currentVersion:3});assert.match(past,/game-history/);assert.doesNotMatch(past,/class="game-context-card"[^>]* open/);
});

test('map recall unifies known maps and extra locations without fabricating their connections',()=>{
 const state=structuredClone(turn.state);state.game.entities.push(entity('town','place','城镇'));
 const html=gameRecallView(state,{kind:'map'});
 assert.equal((html.match(/class="game-map-viewport"/g)||[]).length,1);
 assert.equal((html.match(/<line /g)||[]).length,1);
 assert.match(html,/城镇/);
 assert.doesNotMatch(html,/class="game-map-node[^>]*data-entity="town"/);
});

test('long recorded location uses only a fresh explicit current-place marker',()=>{
  const state={version:2,location:'你已到达路口拐角内侧，未向右侧深入。',game:{entities:[entity('corner','place','路口拐角',{status:'当前位置'}),entity('shop','place','日用品店')],surfaces:[]}};
  const html=gameRecallView(state,{kind:'map'});
  assert.match(html,/aria-current="location"/);
  state.game.entities[0].sourceVersion=1;
  assert.doesNotMatch(gameRecallView(state,{kind:'map'}),/aria-current="location"/);
});

test('all model labels, references and quotes are HTML escaped without modifying snapshots',()=>{
  const attack='"><img src=x onerror="alert(1)">';
  const bad={id:attack,state:{version:2,game:{entities:[entity(attack,'item',attack,{detail:attack,status:attack,unit:attack,value:2,quote:attack})],surfaces:[{id:attack,kind:'inventory',title:attack,description:attack,quote:attack,entityIds:[attack],actions:[{id:attack,label:attack,mode:'apply',effects:[{entityId:attack,delta:-1,status:attack}]}]}]}}};
  const before=JSON.stringify(bad);
  const html=gameTurnView(bad,{currentVersion:2,branchId:attack})+gameRecallView(bad.state)+gameInspectView(bad.state.game.entities[0],bad.state.game,{node:attack});
  assert.doesNotMatch(html,/<img|onerror="alert/);assert.match(html,/&lt;img/);
  assert.equal(JSON.stringify(bad),before);
});

test('recall stays inline and read-only, includes uncategorized retained entities and no invented links',()=>{
  const game={...turn.state.game,surfaces:[surfaces[1]]};
  const before=JSON.stringify(game),html=gameRecallView({version:2,game},{node:'turn2'});
  assert.match(html,/<aside class="game-recall"/);assert.match(html,/银币/);assert.match(html,/折起的纸条/);
  assert.doesNotMatch(html,/data-action="game-act"|dialog/);
  assert.equal((html.match(/<line /g)||[]).length,1);assert.equal(JSON.stringify(game),before);
  const filtered=gameRecallView(turn.state,{kind:'inventory'});assert.match(filtered,/银币/);assert.doesNotMatch(filtered,/精力|木门后/);
  assert.match(gameRecallView({}),/还没有明确记录可用玩法/);
});

test('reader preserves scene components while removing the permanent recall toolbar',()=>{
  const html=readerView({branch:{id:'branch-a',turns:[turn]},state:turn.state});
  assert.ok(html.indexOf('店主收好了纸条。')<html.indexOf('data-reader-live="game-turn2"'));
  assert.equal((html.match(/data-action="context-open"/g)||[]).length,0);
  assert.match(html,/id="action-input"/);
});

const executableTurn=()=>({id:'t3',state:{version:2,location:'门廊',game:{schemaVersion:1,entities:structuredClone(entities.slice(0,4)),surfaces:[{id:'map',kind:'map',title:'路线',description:'',quote:'走过木门消耗一点精力。',version:2,entityIds:['energy','coins','gate','hall'],links:[{from:'gate',to:'hall',label:'木门'}],actions:[{id:'go',label:'走进大厅',input:'我走进大厅。',mode:'apply',effects:[{entityId:'energy',delta:-1,status:null}],destination:'hall',disabledReason:''}]}]}}});
const executableButton=t=>gameTurnView(t,{currentVersion:2,branchId:'b1'}).match(/<button[^>]*data-action="game-act"[^>]*>/)?.[0];

test('action availability uses the engine resource, capacity and directed route checks',()=>{
  const valid=executableTurn();assert.doesNotMatch(executableButton(valid),/disabled/);
  const poor=executableTurn();poor.state.game.entities[0].value=0;assert.match(executableButton(poor),/disabled/);
  const over=executableTurn();over.state.game.surfaces[0].actions[0].effects[0].delta=5;assert.match(executableButton(over),/disabled/);
  const unknown=executableTurn();unknown.state.location='楼外';assert.match(executableButton(unknown),/disabled/);
  const reversed=executableTurn();reversed.state.game.surfaces[0].links=[{from:'hall',to:'gate',label:'仅反方向'}];assert.match(executableButton(reversed),/disabled/);
  const nonmap=executableTurn();nonmap.state.game.surfaces[0].kind='interaction';assert.match(executableButton(nonmap),/disabled/);
});

test('map cost entities remain resource context and never become location nodes',()=>{
  const html=gameTurnView(executableTurn(),{currentVersion:2,branchId:'b1'});
  const diagram=html.match(/<svg[\s\S]*?<\/svg>/)[0],places=html.match(/<ol class="game-map-places">[\s\S]*?<\/ol>/)[0];
  assert.equal((diagram.match(/<circle /g)||[]).length,2);
  assert.match(places,/门廊/);assert.match(places,/大厅/);assert.doesNotMatch(places,/精力|银币/);
  const resources=html.slice(html.indexOf('class="game-map-resources"'),html.indexOf('class="game-actions"'));
  assert.match(resources,/精力/);assert.match(resources,/银币/);assert.match(resources,/4 \/ 8 点/);
});

test('map and recall derive current location from the selected state without mutating saved place status',()=>{
  const t=executableTurn();t.state.location='大厅';t.state.game.entities.find(e=>e.id==='gate').status='当前位置';
  const blocked=entity('stairs','place','楼梯',{status:'暂时封闭'});t.state.game.entities.push(blocked);t.state.game.surfaces[0].entityIds.push(blocked.id);
  const before=JSON.stringify(t);
  for(const html of [gameTurnView(t,{currentVersion:2,branchId:'b1'}),gameRecallView(t.state)]){
    const places=html.match(/<ol class="game-map-places">[\s\S]*?<\/ol>/)[0];
    assert.match(places,/data-entity="gate"[\s\S]*?已知地点/);assert.doesNotMatch(places,/当前位置/);
    assert.match(places,/data-entity="hall"[\s\S]*?当前所在/);assert.match(places,/暂时封闭/);
    assert.equal((html.match(/class="game-map-current"/g)||[]).length,1);
  }
  assert.equal(JSON.stringify(t),before);
  const past=structuredClone(t);past.state.location='门廊';
  const historical=gameTurnView(past,{currentVersion:3,branchId:'b1'});
  assert.match(historical,/data-entity="gate"[\s\S]*?当前所在/);
});

test('small resource-only interactions stay compact while keeping full quantities and mixed actor context',()=>{
  const materials=[entity('wire','item','铜线',{value:12345,unit:'厘米'}),entity('cloth','item','布条',{value:2,unit:'条'}),entity('power','meter','电量',{value:8,max:10,unit:'格'})];
  const t={id:'craft',state:{version:2,game:{entities:materials,surfaces:[{id:'craft',kind:'interaction',title:'制作',entityIds:materials.map(e=>e.id)}]}}};
  const html=gameTurnView(t,{currentVersion:2});assert.match(html,/game-interaction-context game-resource-context/);assert.match(html,/12345 厘米/);assert.match(html,/8 \/ 10 格/);
  t.state.game.entities.push(entity('host','actor','店主'));t.state.game.surfaces[0].entityIds.push('host');
  assert.doesNotMatch(gameTurnView(t,{currentVersion:2}),/game-resource-context/);
});

test('committed receipt remains visible without new surfaces and reports only computed changes',()=>{
  const receipt={mode:'apply',input:'穿过门廊',effects:[{entityId:'energy',beforeValue:4,value:3,beforeStatus:'警惕',status:'放松'},{entityId:'coins',beforeValue:0,value:0,beforeStatus:'',status:''}],destination:'hall',location:'大厅'};
  const t={...turn,gameAction:receipt,state:{...turn.state,game:{...turn.state.game,surfaces:[]}}};
  const html=gameTurnView(t,{currentVersion:2,branchId:'b1'});
  assert.match(html,/已完成/);assert.match(html,/穿过门廊/);assert.match(html,/精力/);assert.match(html,/4 → 3 点/);assert.match(html,/警惕 → 放松/);assert.match(html,/已抵达 大厅/);
  assert.doesNotMatch(html,/银币|0 → 0|game-history/);
  assert.match(gameTurnView(t,{currentVersion:3,branchId:'b1'}),/<details class="game-history">[\s\S]*game-receipt/);
  const attempted=gameTurnView({...t,gameAction:{mode:'attempt',input:'敲门',effects:[],destination:null,location:'门廊'}},{currentVersion:2,branchId:'b1'});
  assert.match(attempted,/已尝试/);assert.doesNotMatch(attempted,/已完成|已抵达|4 →/);
});

test('recall can be dismissed and gameplay theme variables all exist in reader or base styles',()=>{
  assert.match(gameRecallView(turn.state),/data-action="game-dismiss-recall"/);
  const css=readFileSync(new URL('../src/game-ui.css',import.meta.url),'utf8'),reader=readFileSync(new URL('../src/reading.css',import.meta.url),'utf8');
  for(const name of new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map(m=>m[1])))if(!['--sans','--serif'].includes(name))assert.ok(reader.includes(`${name}:`),`${name} must be defined`);
});
