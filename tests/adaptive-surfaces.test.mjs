import test from 'node:test';
import assert from 'node:assert/strict';
import * as adaptive from '../src/adaptive-surfaces.js';
const entity=(id,kind,extra={})=>({id,kind,name:id,detail:'已知资料',status:'已知',quote:id,value:null,max:null,unit:'',sourceVersion:2,...extra});
const surface=(kind,ids,extra={})=>({id:kind,kind,title:kind,description:'与眼前情景有关',entityIds:ids,links:[],actions:[],version:2,...extra});
const turn=(entities=[],surfaces=[])=>({id:'t2',prose:'',state:{version:2,location:'a',game:{entities,surfaces}}});
test('model-selected read-only map is proactively opened without a map command',()=>{
 assert.equal(typeof adaptive.adaptiveSurfaces,'function');
 const t=turn([entity('a','place'),entity('b','place')],[surface('map',['a','b'],{links:[{from:'a',to:'b',label:'道路'}]})]);
 const before=JSON.stringify(t),result=adaptive.adaptiveSurfaces(t);
 assert.equal(result[0].open,true);assert.equal(result[0].surface.kind,'map');assert.equal(JSON.stringify(t),before);
});
test('changed recorded meters appear without a model surface; unknown numbers stay unknown',()=>{
 const previous={version:1,game:{entities:[entity('oxygen','meter',{value:8,max:10,sourceVersion:1})],surfaces:[]}};
 const t=turn([entity('oxygen','meter',{value:3,max:10}),entity('stress','meter')]);
 const result=adaptive.adaptiveSurfaces(t,{previousState:previous});
 assert.equal(result[0].surface.kind,'status');assert.deepEqual(result[0].surface.entityIds,['oxygen']);assert.equal(result[0].open,true);
 assert.equal(t.state.game.entities[1].value,null);
});
test('timed agreements produce a timeline from public structured records, never wall-clock countdowns',()=>{
 const t=turn();t.state.experience={objects:[{id:'meeting',kind:'agreement',name:'交接',summary:'明早在码头交接',status:'已约定',certainty:'reported',sourceVersion:2,fields:[{key:'scheduledAt',label:'约定时间',value:'明早'}],relatedIds:[]}]};
 const result=adaptive.adaptiveSurfaces(t);
 assert.equal(result[0].surface.kind,'timeline');assert.equal(result[0].objects[0].certainty,'reported');assert.equal(result[0].objects[0].fields[0].value,'明早');
 assert.deepEqual(result[0].surface.actions,[]);
});
test('two changed comparable records and multiple active people get useful distinct layouts',()=>{
 const t=turn();t.state.experience={objects:[1,2].map(i=>({id:'item'+i,kind:'item',name:'工具'+i,summary:'可选工具',status:'可用',sourceVersion:2,fields:[{key:'purpose',label:'用途',value:'用途'+i}],relatedIds:[]}))};
 assert.equal(adaptive.adaptiveSurfaces(t)[0].surface.kind,'comparison');
 t.state.experience.objects=[1,2,3].map(i=>({id:'person:'+i,kind:'person',name:'人物'+i,summary:'当面交谈',status:'在场',sourceVersion:2,fields:[{key:'role',label:'身份',value:'职责'+i}],relatedIds:[]}));
 assert.equal(adaptive.adaptiveSurfaces(t)[0].surface.kind,'people');
});
test('attention budget, repetition, quiet scenes and historical scope prevent panel spam',()=>{
 const entities=[entity('a','place'),entity('b','place'),entity('meter','meter',{value:3,max:10})];
 const t=turn(entities,[surface('map',['a','b']),surface('status',['meter']),surface('inventory',[])]);
 assert.equal(adaptive.adaptiveSurfaces(t).filter(x=>x.open).length,2);
 const previous=structuredClone(t);previous.state.version=1;previous.state.game.entities.forEach(e=>e.sourceVersion=1);
 assert.equal(adaptive.adaptiveSurfaces(t,{previousTurn:previous,previousState:previous.state}).filter(x=>x.open).length,0);
 assert.equal(adaptive.adaptiveSurfaces(t,{historical:true}).filter(x=>x.open).length,0);
 assert.equal(adaptive.adaptiveSurfaces(t,{density:'reading'}).filter(x=>x.open).length,0);
 assert.deepEqual(adaptive.adaptiveSurfaces(turn()),[]);
 const noChange=turn(entities);assert.deepEqual(adaptive.adaptiveSurfaces(noChange,{previousState:previous.state}),[]);
});
test('complex map fallback requires saved edges and current scene relevance, not guessed geography',()=>{
 const entities=['a','b','c'].map(id=>entity(id,'place',{sourceVersion:1}));
 const previous=turn(entities,[surface('map',['a','b','c'],{links:[{from:'a',to:'b',label:'左边'},{from:'a',to:'c',label:'右边'}]})]);previous.state.version=1;
 const t=turn(entities);t.prose='a 的两条路分别通向 b 和 c。';
 const result=adaptive.adaptiveSurfaces(t,{previousState:previous.state});
 assert.equal(result[0].surface.kind,'map');assert.equal(result[0].surface.links.length,2);assert.deepEqual(result[0].surface.actions,[]);
 previous.state.game.surfaces=[];assert.deepEqual(adaptive.adaptiveSurfaces(t,{previousState:previous.state}),[]);
});

test('presentation never imports hidden state, future objects or new actions from fallback records',()=>{
 const t=turn();t.state.flags={secret:'HIDDEN'};t.state.hiddenEvents=[{value:'HIDDEN'}];
 t.state.experience={objects:[{id:'future',kind:'agreement',name:'HIDDEN',sourceVersion:3,fields:[{key:'deadline',value:'明早'}]}]};
 assert.deepEqual(adaptive.adaptiveSurfaces(t),[]);
});
