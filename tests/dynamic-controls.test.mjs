import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicControls,dynamicView} from '../src/dynamic-ui.js';

function fixture(t,{mounted=false}={}){
  const root={querySelector:()=>null,querySelectorAll:()=>[]},previous=globalThis.document;globalThis.document={querySelector:()=>mounted?root:null};t.after(()=>{globalThis.document=previous;});
  const branch={id:'b',worldKey:'w@1',turns:[],draft:'未发送的文字'},session={id:'s',mode:'real'},state={version:0};
  let active={session,branch,state},resolveRequest,signal,body,installed=0,calls=0;const requests=[];
  const controller=createDynamicControls({active:()=>active,ready:()=>true,ensure:async()=>{},uiContext:()=>({}),storage:{getItem:()=>null},save:()=>{},refresh:()=>{},toast:()=>{},install:(_s,result)=>{installed++;Object.assign(active.branch,result);},request:async(_path,request,s)=>{calls++;body=request;signal=s;return new Promise(r=>{resolveRequest=r;requests.push({signal:s,body:request,resolve:result=>r({authoritativeBranch:result??{}})});});}});
  return {controller,branch,state,requests,calls:()=>calls,start:()=>new Promise(r=>setImmediate(r)),resolve:(result={})=>resolveRequest({authoritativeBranch:result}),switchBranch:()=>{active={session,branch:{...branch,id:'other'},state};},body:()=>body,signal:()=>signal,installed:()=>installed};
}

test('automatic preparation leaves story actions available while the model is still pending',async t=>{
  const f=fixture(t),job=f.controller.prepare();await f.start();
  assert.equal(f.controller.busy(),false,'preparing an optional view must not block a story turn');
  f.resolve();await job;
});

test('a new explicit request preempts pending preparation and ignores its late response',async t=>{
  const f=fixture(t),old=f.controller.prepare();await f.start();
  const latest=f.controller.prepare(true,'比较两条路线');await f.start();
  assert.equal(f.calls(),2);assert.equal(f.requests[0].signal.aborted,true);
  f.requests[1].resolve({marker:'new'});await latest;
  f.requests[0].resolve({marker:'old'});await old;
  assert.equal(f.branch.marker,'new');assert.equal(f.installed(),1);
});

test('continuing the story cancels optional preparation without waiting for its network response',async t=>{
  const f=fixture(t),old=f.controller.prepare();await f.start();
  assert.equal(typeof f.controller.cancelPrepare,'function');f.controller.cancelPrepare();
  assert.equal(f.signal().aborted,true);assert.equal(f.controller.busy(),false);
  const narration=f.controller.narrate('saved-operation');await f.start();
  assert.equal(f.calls(),2);assert.equal(f.controller.busy(),true);
  f.requests[0].resolve();await old;
  assert.equal(f.controller.busy(),true,'old finally must not release the current operation');
  assert.equal(f.installed(),0);
  f.requests[1].resolve();await narration;assert.equal(f.controller.busy(),false);
});

test('mounting a newer turn preempts stale preparation and starts the current turn immediately',async t=>{
  const f=fixture(t,{mounted:true}),old=f.controller.prepare();await f.start();
  f.state.version=1;f.controller.bind();await f.start();
  assert.equal(f.calls(),2);assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.body().baseVersion,1);
  f.requests[0].resolve({marker:'stale'});await old;assert.equal(f.installed(),0);
  f.requests[1].resolve({marker:'current'});await f.start();assert.equal(f.branch.marker,'current');
});

test('a late prepared response cannot restore prose edited locally at the same story version',async t=>{
  const f=fixture(t);f.branch.turns=[{id:'t',prose:'修改之前的正文。'}];
  const pending=f.controller.prepare();await f.start();
  f.branch.turns[0].prose='玩家已经确认的润色正文。';
  f.resolve({turns:[{id:'t',prose:'修改之前的正文。'}]});await pending;
  assert.equal(f.installed(),0);assert.equal(f.branch.turns[0].prose,'玩家已经确认的润色正文。');
});

test('explicit rich requests carry the submitted intent without consuming a draft',async t=>{
  const f=fixture(t),job=f.controller.prepare(true,'用表格比较路线');await f.start();
  assert.equal(f.body().intent,'用表格比较路线');assert.equal(f.branch.draft,'未发送的文字');
  f.resolve();await job;assert.equal(f.installed(),1);
});

test('an aborted generation that still resolves cannot install or change a branch',async t=>{
  const f=fixture(t),job=f.controller.prepare(true,'画关系图');await f.start();
  assert.equal(typeof f.controller.cancel,'function');f.controller.cancel();assert.equal(f.signal().aborted,true);
  f.resolve();await job;assert.equal(f.installed(),0);assert.equal(f.controller.busy(),false);
});

test('late results from another branch are ignored',async t=>{
  const f=fixture(t),job=f.controller.prepare(true);await f.start();f.switchBranch();f.resolve();await job;assert.equal(f.installed(),0);
  await f.start();assert.equal(f.body().branchId,'other');f.resolve();await f.start();assert.equal(f.installed(),1);
});

test('a missing input in a nested visual does not hide independent sibling content',()=>{
  const d={id:'partial',scope:{branchId:'b',baseVersion:0},title:'准备路线',summary:'',fields:[],steps:[],actions:[],view:[{type:'group',children:[{type:'chart',items:[{label:'数量',value:{op:'ref',path:['params','qty']}}]},{type:'cards',items:[{title:'先核实消息',body:'尚未决定路线'}]}]}]};
  const html=dynamicView(d,{facts:[],inventory:[],location:'灯塔',time:'傍晚'},{});
  assert.match(html,/先核实消息/);assert.match(html,/暂时无法显示/);
});

test('generated content opens without a format picker or a feature activation prompt',()=>{
  const d={id:'automatic',scope:{branchId:'b',baseVersion:0},title:'两条路线的消息',summary:'',fields:[],steps:[],actions:[],view:[{type:'table',columns:['路线','来源'],rows:[['北路','转述'],['南路','目击']]}]};
  const html=dynamicView(d,{facts:[],inventory:[],location:'灯塔',time:'傍晚'},{});
  assert.match(html,/<details class="dynamic-interaction" open/);assert.match(html,/<table>/);
  assert.doesNotMatch(html,/换一种方式看|data-rich-format|智能交互|也可以直接说/);
});

test('an artifact does not repeat the surrounding scene heading and summary',()=>{
  const d={id:'tidy',scope:{branchId:'b',baseVersion:0},title:'两条路线',summary:'安全尚未确认。',fields:[],steps:[],actions:[],view:[{type:'table',title:'两条路线',caption:'安全尚未确认。',columns:['路线'],rows:[['北线']]}]};
  const html=dynamicView(d,{facts:[],inventory:[],location:'灯塔',time:'傍晚'},{});
  assert.doesNotMatch(html,/<h4>两条路线<\/h4>/);assert.equal((html.match(/安全尚未确认。/g)||[]).length,1);
  assert.match(html,/<table>/);
});

test('conditional content and repeat length cannot shift another table into a saved presentation identity',()=>{
  const table=title=>({type:'table',title,columns:['记录'],rows:[['内容']]}),ref=key=>({op:'ref',path:['params',key]});
  const d={id:'stable',scope:{branchId:'b',baseVersion:0},title:'已知资料',summary:'',fields:[],steps:[],actions:[],view:[
    {type:'group',when:ref('show'),children:[table('条件表格'),{type:'group',children:[table('更深的表格')]}]},
    {type:'repeat',items:ref('items'),children:[{type:'group',children:[table('重复表格')]}]},
    table('一直可见的表格')
  ]};
  const state={facts:[],inventory:[],location:'灯塔',time:'傍晚'},ids=html=>[...html.matchAll(/data-rich-id="([^"]+)"[^>]*aria-label="([^"]+)"/g)].map(([,id,title])=>({id,title}));
  const expanded=ids(dynamicView(d,state,{show:true,items:['甲','乙']})),contracted=ids(dynamicView(d,state,{show:false,items:['甲']}));
  const fixed=expanded.find(item=>item.title==='一直可见的表格').id;
  assert.equal(contracted.find(item=>item.title==='一直可见的表格').id,fixed);
  assert.equal(contracted.find(item=>item.title==='重复表格').id,expanded.find(item=>item.title==='重复表格').id);
  assert.equal(new Set(expanded.map(item=>item.id)).size,expanded.length,'repeat items must each own a distinct presentation');
  const saved={views:{[fixed]:{filter:'保持我的查找'}}};
  assert.equal(saved.views[contracted.find(item=>item.title==='一直可见的表格').id].filter,'保持我的查找');
  assert.equal(saved.views[expanded.find(item=>item.title==='条件表格').id],undefined);
});

test('reading mounts automatically prepare once per turn without sending the unsent draft',async t=>{
  const f=fixture(t,{mounted:true});f.controller.bind();await f.start();
  assert.equal(f.calls(),1);assert.equal(f.body().intent,undefined);assert.equal(f.branch.draft,'未发送的文字');
  f.resolve();await f.start();f.controller.bind();await f.start();assert.equal(f.calls(),1);
  f.state.version=1;f.controller.bind();await f.start();assert.equal(f.calls(),2);assert.equal(f.body().baseVersion,1);
  f.resolve();await f.start();assert.equal(f.controller.html(),'');
});

test('an old presentation policy stays hidden while the current scene is automatically reassessed',async t=>{
  const f=fixture(t,{mounted:true});
  f.branch.dynamic={promptVersion:'elselife-dynamic-4',scope:{sessionId:'s',branchId:'b',worldKey:'w@1',baseVersion:0},definition:{title:'旧版手动面板'}};
  assert.equal(f.controller.html(),'');
  f.controller.bind();await f.start();assert.equal(f.calls(),1);assert.equal(f.body().intent,undefined);
  f.resolve();await f.start();assert.equal(f.controller.html(),'');
});
