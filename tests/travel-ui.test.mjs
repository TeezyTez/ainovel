import test from 'node:test';
import assert from 'node:assert/strict';
import * as travel from '../src/travel-ui.js';
import {createTravelControls} from '../src/travel-controls.js';

const place=(id,name)=>({id,name,kind:'place',status:'已知',detail:'已公开地点',sourceVersion:1,value:null,max:null,unit:'',quote:name});
function fixture(){return {version:1,location:'修表铺',inventory:[],experience:{clock:{label:'第9日14:00',precision:'exact'},objects:[]},game:{schemaVersion:1,entities:[place('city','雨港'),place('shop','修表铺'),place('dock','码头'),place('bank','河岸'),{id:'cash',kind:'meter',name:'现金',value:6,unit:'银币',status:'已知',sourceVersion:1}],surfaces:[],spatial:{schemaVersion:1,sites:[{id:'city',terrain:'region',parentId:null},{id:'shop',terrain:'building',parentId:'city'},{id:'dock',terrain:'landmark',parentId:'city'},{id:'bank',terrain:'landmark',parentId:'city'}],relations:[]},journeys:{schemaVersion:1,transit:null,routes:[{id:'ferry',from:'shop',to:'dock',label:'摆渡',detail:'全程已含候船',via:[],minutesMin:15,minutesMax:20,costs:[{entityId:'cash',amount:2}],includesWaiting:true,quote:'修表铺到码头可乘摆渡，全程15–20分钟，费用2银币。',sourceVersion:1,basis:{clock:'第9日14:00',conditions:'[]'}},{id:'path',from:'shop',to:'dock',label:'河岸小路',detail:'耗时尚不明确',via:['bank'],minutesMin:null,minutesMax:null,costs:[],includesWaiting:false,quote:'修表铺经河岸小路可以到码头。',sourceVersion:1,basis:{clock:'第9日14:00',conditions:'[]'}}]}}};}
function completeFixture(){
 const s=fixture();Object.assign(s.game.entities.find(e=>e.id==='cash'),{max:null,detail:'',quote:'现金6银币。'});
 for(const site of s.game.spatial.sites){site.quote='雨港有修表铺、码头和河岸。';site.sourceVersion=1;}
 return s;
}
function harness(state=completeFixture()){
 const branch={id:'branch1',draft:'原草稿',personal:{notes:[]},initialState:{...fixture(),version:0,location:'旧起点'},turns:[{id:'old',state:{...fixture(),version:0,location:'旧码头'}}]};
 const opened=[],sent=[],toasts=[];
 const api={session:()=>({id:'session1'}),branch:()=>branch,state:()=>state,world:()=>({characters:[]}),situation:()=>({objects:[]}),open:(title,html)=>opened.push({title,html}),save:()=>{},toast:t=>toasts.push(t),send:(input,ref)=>sent.push({input,ref}),busy:()=>false,close:()=>{},settings:()=>({})};
 const controls=createTravelControls(api);
 return {branch,opened,sent,toasts,controls,state,api};
}
test('one known region still has a usable world view and missing interiors stay disabled',()=>{
 const m=travel.travelModel(fixture(),{}, {level:'world'});
 assert.equal(m.scope,null);assert.deepEqual(m.places.map(p=>p.id),['city']);assert.equal(m.placeEnabled,false);
 const html=travel.travelView(m);assert.match(html,/data-level="world"[^>]*aria-pressed="true"/);assert.match(html,/data-level="place"[^>]*disabled/);assert.match(html,/当前场所暂无分区/);
});
test('legacy connections render as topology without fabricated bearings or scale',()=>{
 const s=fixture();delete s.game.spatial;s.game.surfaces=[{id:'map',kind:'map',links:[{from:'shop',to:'dock',label:'石路'}],actions:[]}];
 const m=travel.travelModel(s,{},{}),html=travel.travelView(m);
 assert.equal(m.topology,true);assert.match(html,/连接示意/);assert.doesNotMatch(html,/atlas-compass|atlas-scale|比例尺/);
 assert.deepEqual(m.places.map(p=>p.id).sort(),['bank','city','dock','shop']);
});

test('a reported distant region stays an unlocated message rather than a navigable physical point',()=>{
 const situation={objects:[{id:'north',kind:'location',name:'北方港区',summary:'船员说它在北方，具体路线未知。',certainty:'reported',fields:[],sourceVersion:1}]};
 const model=travel.travelModel(fixture(),situation,{level:'world'}),html=travel.travelView(model);
 assert.equal(model.allPlaces.some(p=>p.id==='north'),false);assert.match(html,/尚未定位的消息/);assert.match(html,/北方港区/);assert.doesNotMatch(html,/data-entity="north"/);
});
test('arriving at a remembered destination replaces its departure panel with current place details',()=>{
 const s=fixture();s.location='码头';s.version=2;
 const m=travel.travelModel(s,{}, {selectedId:'dock',panel:'routes',routeId:'ferry'}),html=travel.travelView(m);
 assert.equal(m.view.panel,'detail');assert.equal(m.view.routeId,'');
 assert.match(html,/你在这里/);assert.doesNotMatch(html,/打听路线|data-action="travel-depart"|比较已知路线/);
});
test('route comparison keeps ranges and refuses an exact arrival when waiting is unknown',()=>{
 const s=fixture(),before=JSON.stringify(s),m=travel.travelModel(s,{}, {selectedId:'dock',panel:'routes'}),html=travel.travelView(m);
 assert.equal(m.routes[0].arrival,'14:15–14:20');assert.equal(m.routes[1].arrival,'');
 assert.match(html,/15–20 分钟/);assert.match(html,/耗时未确认/);assert.match(html,/等待时间未计入/);assert.match(html,/未记录费用/);assert.equal(JSON.stringify(s),before);
});
test('unaffordable routes show a real shortfall and cannot depart',()=>{
 const s=fixture();s.game.entities.find(e=>e.id==='cash').value=1;
 const m=travel.travelModel(s,{}, {selectedId:'dock',panel:'routes',routeId:'ferry'}),html=travel.travelView(m);
 assert.equal(m.routes[0].available,false);assert.match(html,/还差 1 银币/);assert.match(html,/data-action="travel-depart"[^>]*disabled/);
});
test('history is read only and interrupted transit retains the actual waypoint',()=>{
 const s=fixture();s.location='河岸';s.game.journeys.transit={routeId:'ferry',locationId:'bank',completed:false,elapsedMinutes:8,quote:'走了8分钟，在河岸停下。',sourceVersion:1};
 const m=travel.travelModel(s,{}, {selectedId:'dock',panel:'routes'},{historical:true}),html=travel.travelView(m);
 assert.equal(m.currentId,'bank');assert.equal(m.transit.locationId,'bank');assert.match(html,/历史视图/);assert.doesNotMatch(html,/data-action="travel-depart"|data-action="game-act"/);assert.match(html,/途中停在/);
});
test('only accepted, destination-related delivery records create forgotten-item reminders',()=>{
 const s=fixture(),item={id:'watch',kind:'item',name:'怀表',summary:'',status:'已修好',sourceVersion:1,fields:[{key:'location',value:'工作台'}],relatedIds:[]};
 const agreement={id:'delivery',kind:'agreement',name:'送表',status:'尚未接受',certainty:'confirmed',summary:'把怀表送到码头',relatedIds:['watch','dock'],fields:[{key:'deadline',value:'今天14:10'}]};
 assert.deepEqual(travel.travelWarnings(s,{objects:[item,agreement]},s.game.journeys.routes[0]),[]);
 agreement.status='已接受';const warnings=travel.travelWarnings(s,{objects:[item,agreement]},s.game.journeys.routes[0]);
 assert.equal(warnings.length,2);assert.match(warnings[0].text,/怀表.*工作台/);assert.match(warnings[1].text,/14:10/);
});
test('custody is not carriage and reported acceptance does not manufacture a player intention',()=>{
 const s=fixture(),item={id:'watch',kind:'item',name:'怀表',summary:'',status:'已修好',sourceVersion:1,fields:[{key:'custodian',value:'你'},{key:'location',value:'工作台'}],relatedIds:[]};
 const agreement={id:'delivery',kind:'agreement',name:'送表',status:'已接受',certainty:'confirmed',summary:'把怀表送到码头',relatedIds:['watch','dock'],fields:[]};
 assert.equal(travel.travelWarnings(s,{objects:[item,agreement]},s.game.journeys.routes[0]).length,1);
 agreement.certainty='reported';assert.deepEqual(travel.travelWarnings(s,{objects:[item,agreement]},s.game.journeys.routes[0]),[]);
});
test('view preferences are bounded and cannot restore a stale historical mode',()=>{
 assert.deepEqual(travel.normalizeTravelView({level:'secret',selectedId:'dock',zoom:999,scrollLeft:-2,scrollTop:24,historical:true}),{level:'region',selectedId:'dock',routeId:'',panel:'detail',zoom:3,scrollLeft:0,scrollTop:24,contentScroll:0,anchorId:'',scopeOverride:undefined,listOpen:false});
});
test('opening a map from old prose uses current state and selecting a place does not send',()=>{
 const h=harness(),before=JSON.stringify(h.branch);h.controls.open({node:'old'});
 assert.match(h.opened.at(-1).html,/data-history="false"/);assert.doesNotMatch(h.opened.at(-1).html,/当前：旧码头/);
 h.controls.handle('travel-select',{dataset:{entity:'dock'}});assert.equal(h.sent.length,0);assert.equal(JSON.stringify(h.branch),before);assert.match(h.opened.at(-1).html,/data-selected-place="dock"/);
 h.controls.open();assert.match(h.opened.at(-1).html,/data-selected-place="dock"/);
});
test('explicit departure sends only the selected versioned journey and rejects stale buttons',()=>{
 const h=harness();h.controls.open();h.controls.handle('travel-select',{dataset:{entity:'dock'}});h.controls.handle('travel-compare',{dataset:{}});h.controls.handle('travel-route',{dataset:{route:'ferry'}});
 const before=JSON.stringify(h.state);h.controls.handle('travel-depart',{dataset:{route:'ferry',branch:'branch1',version:'1'}});
 assert.deepEqual(h.sent,[{input:'沿摆渡前往码头。',ref:{branchId:'branch1',version:1,surfaceId:'$journeys',actionId:'ferry'}}]);assert.equal(JSON.stringify(h.state),before);
 h.state.version=2;h.controls.handle('travel-depart',{dataset:{route:'ferry',branch:'branch1',version:'1'}});assert.equal(h.sent.length,1);assert.match(h.toasts.at(-1),/变化|过期/);
});
test('historical map actions cannot be triggered through the controller',()=>{
 const h=harness();h.controls.open({node:'old'});h.controls.handle('travel-history',{dataset:{node:'old'}});h.controls.handle('travel-depart',{dataset:{route:'ferry',branch:'branch1',version:'0'}});assert.equal(h.sent.length,0);assert.match(h.opened.at(-1).html,/历史视图/);
});
test('top navigation and old map actions open current read-only queries without changing the branch',()=>{
 const h=harness(),before=JSON.stringify(h.branch);
 for(const [action,dataset] of [['play-map',{}],['map-scope',{node:'old',scope:'city'}],['game-map-expand',{node:'old'}],['reader-inspect',{kind:'map',node:'old'}],['game-recall',{kind:'map',node:'old'}]]){
  assert.equal(h.controls.handle(action,{dataset}),true);assert.match(h.opened.at(-1).html,/data-history="false"/);
 }
 assert.equal(JSON.stringify(h.branch),before);assert.equal(h.sent.length,0);
});
test('view selection and level survive reload while different branches keep separate views',t=>{
 const storage=new Map(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
 const h=harness();h.controls.open();h.controls.handle('travel-select',{dataset:{entity:'dock'}});h.controls.handle('travel-level',{dataset:{level:'world'}});
 const reloaded=createTravelControls(h.api);reloaded.open();assert.match(h.opened.at(-1).html,/data-selected-place="dock"/);assert.match(h.opened.at(-1).html,/data-level="world"[^>]*aria-pressed="true"/);
 h.api.branch=()=>({...h.branch,id:'branch2'});reloaded.open();assert.doesNotMatch(h.opened.at(-1).html,/data-selected-place="dock"/);assert.match(h.opened.at(-1).html,/data-level="region"[^>]*aria-pressed="true"/);
 h.api.branch=()=>h.branch;reloaded.open();assert.match(h.opened.at(-1).html,/data-selected-place="dock"/);assert.match(h.opened.at(-1).html,/data-level="world"[^>]*aria-pressed="true"/);assert.deepEqual(h.branch.personal,{notes:[]});
});
test('story generation blocks departure and unavailable browser storage does not block map queries',t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('storage unavailable');}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
 const h=harness();h.controls.open();h.controls.handle('travel-select',{dataset:{entity:'dock'}});h.controls.handle('travel-compare',{dataset:{}});h.controls.handle('travel-route',{dataset:{route:'ferry'}});h.api.busy=()=>true;
 h.controls.handle('travel-depart',{dataset:{route:'ferry',branch:'branch1',version:'1'}});assert.equal(h.sent.length,0);assert.match(h.toasts.at(-1),/正在推进/);
});
