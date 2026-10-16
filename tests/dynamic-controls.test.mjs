import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicControls,dynamicView} from '../src/dynamic-ui.js';
import {DYNAMIC_PROMPT_VERSION} from '../src/dynamic-rules.js';

function fixture(t,{mounted=false}={}){
  const root={querySelector:()=>null,querySelectorAll:()=>[]},previous=globalThis.document;globalThis.document={querySelector:()=>mounted?root:null};t.after(()=>{globalThis.document=previous;});
  const branch={id:'b',worldKey:'w@1',turns:[],draft:'未发送的文字'},session={id:'s',mode:'real'},state={version:0,facts:[],inventory:[],location:'柜台',time:'夜晚'};
  let active={session,branch,state},resolveRequest,signal,body,installed=0,calls=0,historical=false;const requests=[],timers=[];
  const controller=createDynamicControls({active:()=>active,ready:()=>true,ensure:async()=>{},uiContext:()=>({readingHistorical:historical}),storage:{getItem:()=>null},save:()=>{},refresh:()=>{},toast:()=>{},install:(_s,result)=>{installed++;Object.assign(active.branch,result);},schedule:fn=>{const timer={fn,cancelled:false};timers.push(timer);return timer;},clear:timer=>{timer.cancelled=true;},request:async(_path,request,s)=>{calls++;body=request;signal=s;return new Promise((r,reject)=>{resolveRequest=r;requests.push({signal:s,body:request,resolve:result=>r({authoritativeBranch:result??{}}),reject});});}});
  return {controller,root,branch,state,requests,timers,calls:()=>calls,start:()=>new Promise(r=>setImmediate(r)),resolve:(result={})=>resolveRequest({authoritativeBranch:result}),switchBranch:()=>{active={session,branch:{...branch,id:'other'},state};},setHistorical:value=>{historical=value;},body:()=>body,signal:()=>signal,installed:()=>installed};
}

test('unrelated reader refreshes do not recreate an unchanged interactive panel',t=>{
 const f=fixture(t,{mounted:true});
 f.branch.dynamic={...failure('').dynamic,digest:'stable',definition:{id:'view',title:'资料',summary:'',fields:[],steps:[],actions:[],view:[]}};
 let replacements=0;Object.defineProperty(f.root,'innerHTML',{set(){replacements++;}});
 f.controller.bind(false);
 assert.equal(typeof f.controller.refresh,'function');
 f.controller.refresh();f.controller.refresh();
 assert.equal(replacements,0,'keep mounted frame, focus and local controls alive');
 f.branch.dynamic.definition.title='更新资料';f.controller.refresh();
 assert.equal(replacements,1,'changed presentation still renders');
});

function mountedArtifactFixture(t){
  const previousDocument=globalThis.document,previousWindow=globalThis.window,storage=new Map(),errors=[];
  let receive,currentValues,replacements=0;
  t.after(()=>{globalThis.document=previousDocument;globalThis.window=previousWindow;});
  t.mock.method(globalThis,'setTimeout',()=>0);
  globalThis.window={addEventListener:(_type,listener)=>{receive=listener;},removeEventListener(){}};
  const scope={sessionId:'s',branchId:'b',worldKey:'w@1',baseVersion:0};
  const interactive={type:'interactive',title:'分配试算',description:'只做试算',html:'<input type="number">',css:'',script:''};
  const definition={id:'view',title:'物资准备',summary:'',scope,steps:[],actions:[],fields:[{id:'note',type:'text',label:'备注',default:''},{id:'quantity',type:'number',label:'数量',min:0,max:10,default:1}],view:[interactive,{type:'value',label:'数量',value:{op:'ref',path:['params','quantity']}}]};
  const branch={id:'b',worldKey:'w@1',turns:[],dynamic:{promptVersion:DYNAMIC_PROMPT_VERSION,scope,digest:'stable',definition}},session={id:'s',mode:'real'},state={version:0,facts:[],inventory:[],location:'柜台',time:'夜晚'};
  const fields=definition.fields.map(field=>({dataset:{dynamicField:field.id},value:String(field.default)}));
  const fieldGroup=()=>({children:fields.map(field=>({querySelector:()=>field}))});
  function values(html){
    // This fixture only needs the generated values region and the iframe bridge.
    const markup=html.match(/<div data-dynamic-values>([\s\S]*?)<\/div><div class="dynamic-fields">/)[1],messages=[],listeners={};
    const frame={style:{},contentWindow:{postMessage:message=>messages.push(message)},addEventListener:(type,listener)=>{listeners[type]=listener;},remove(){}};
    const status={},repair={addEventListener(){}},artifact={isConnected:false,dataset:{interactiveId:'b-0-view-view-0',interactiveDefinition:JSON.stringify(interactive)},querySelector:selector=>selector==='iframe'?frame:selector==='[data-artifact-status]'?status:repair};
    return {artifact,frame,messages,listeners,get innerHTML(){return frame.src?markup.replace('<iframe ','<iframe src="'+frame.src+'" '):markup;},replaceWith(next){replacements++;artifact.isConnected=false;currentValues=next;next.artifact.isConnected=true;}};
  }
  const details={},preview={},row={replaceWith(){}},oldFields=fieldGroup();
  const root={querySelector:selector=>({'[data-dynamic-values]':currentValues,'details.dynamic-interaction':details,'.dynamic-fields':oldFields,'[data-dynamic-preview]':preview,'.dynamic-row':row}[selector]??null),querySelectorAll:selector=>selector==='[data-interactive-definition]'?[currentValues.artifact]:selector==='[data-dynamic-field]'?fields:[]};
  globalThis.document={querySelector:()=>root,createElement:()=>({set innerHTML(html){this.values=values(html);},querySelector(selector){return selector==='[data-dynamic-values]'?this.values:selector==='.dynamic-fields'?fieldGroup():selector==='.dynamic-row'?row:null;}})};
  const controller=createDynamicControls({active:()=>({session,branch,state}),ready:()=>true,uiContext:()=>({}),storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},save(){},toast:message=>errors.push(message)});
  currentValues=values(controller.html());currentValues.artifact.isConnected=true;controller.bind(false);
  const send=(kind,value)=>receive({source:currentValues.frame.contentWindow,data:{channel:'story-artifact',token:new URL(currentValues.frame.src,'http://local').searchParams.get('token'),kind,value}});
  const load=()=>{currentValues.listeners.load();send('ready',{});return currentValues.messages.at(-1);};
  load();
  return {input:(id,value)=>{const field=fields.find(field=>field.dataset.dynamicField===id);field.value=String(value);field.oninput();assert.deepEqual(errors,[]);},values:()=>currentValues,replacements:()=>replacements,send,load};
}

test('editing unrelated fields preserves the live artifact after its iframe markup changes',t=>{
  const f=mountedArtifactFixture(t),original=f.values(),url=original.frame.src;
  f.send('state',{quantity:7});
  f.input('note','第一条备注');f.input('note','继续填写备注');
  assert.equal(f.replacements(),0,'an unchanged values template must keep its browsing context');
  assert.equal(f.values(),original);assert.equal(f.values().frame.src,url);
});

test('changed displayed values still update and restore the artifact local state',t=>{
  const f=mountedArtifactFixture(t),original=f.values();f.send('state',{quantity:7});
  f.input('quantity',2);
  assert.equal(f.replacements(),1);assert.notEqual(f.values(),original);
  assert.match(f.values().innerHTML,/<strong>2<\/strong>/);
  assert.deepEqual(f.load().state,{quantity:7},'the replacement frame restores its saved local trial');
  f.input('note','继续备注');f.input('quantity',2);
  assert.equal(f.replacements(),1,'subsequent inputs compare against the latest rendered template');
});

const failure=reason=>({dynamic:{promptVersion:DYNAMIC_PROMPT_VERSION,scope:{sessionId:'s',branchId:'b',worldKey:'w@1',baseVersion:0},reason,definition:null}});

test('an automatic HTTP failure retries once, then exposes a manual recovery control',async t=>{
  const f=fixture(t),first=f.controller.prepare();await f.start();f.requests[0].reject(new Error('网络暂时不可用'));await first;
  assert.match(f.controller.html(),/网络暂时不可用/);
  assert.equal(f.timers.length,1);f.timers[0].fn();await f.start();
  assert.equal(f.calls(),2);f.requests[1].reject(new Error('仍不可用'));await f.start();
  assert.equal(f.timers.length,1,'automatic attempts stop after one retry');
  assert.match(f.controller.html(),/data-dynamic-retry/);
  const manual=f.controller.prepare(true);await f.start();assert.equal(f.calls(),3);
  f.requests[2].resolve({});await manual;
});

test('a 200 response with a prepare reason retries once and keeps an older valid panel visible',async t=>{
  const f=fixture(t),definition={id:'old',revision:1,scope:{sessionId:'s',branchId:'b',worldKey:'w@1',baseVersion:0},title:'已整理的路线',summary:'',fields:[],steps:[],view:[],actions:[]};
  f.branch.dynamic={...failure('上一次整理未完成').dynamic,definition,digest:'digest'};
  const first=f.controller.prepare();await f.start();f.requests[0].resolve({dynamic:{...failure('模型暂时不可用').dynamic,definition,digest:'digest'}});await first;
  assert.equal(f.controller.hasPresentation(),true);
  assert.match(f.controller.html(),/已整理的路线/);
  assert.match(f.controller.html(),/模型暂时不可用/);
  f.timers[0].fn();await f.start();f.requests[1].resolve({dynamic:{...failure('仍未恢复').dynamic,definition,digest:'digest'}});await f.start();
  assert.equal(f.timers.length,1);assert.match(f.controller.html(),/data-dynamic-retry/);
});

test('cancelled retry cannot start in history or after a scope change',async t=>{
  const f=fixture(t),first=f.controller.prepare();await f.start();f.requests[0].reject(new Error('暂时失败'));await first;
  const pending=f.timers[0];f.controller.cancelPrepare();pending.fn();await f.start();assert.equal(f.calls(),1);
  const next=f.controller.prepare();await f.start();assert.equal(f.calls(),1,'same scope stays cancelled');
  f.state.version=1;f.controller.prepare();await f.start();assert.equal(f.calls(),2);
  f.requests[1].resolve({});await next;
});

test('editing prose at the same version cancels old preparation and starts a fresh scope',async t=>{
  const f=fixture(t,{mounted:true});f.branch.turns=[{id:'t',prose:'旧正文'}];
  const old=f.controller.prepare();await f.start();f.branch.turns[0].prose='新正文';f.controller.bind();await f.start();
  assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.calls(),2);
  f.requests[0].resolve({marker:'obsolete'});await old;
  f.requests[1].resolve({marker:'fresh'});await f.start();assert.equal(f.branch.marker,'fresh');
});

test('hasPresentation reports only a current visible definition',t=>{
  const f=fixture(t),definition={id:'view',revision:1,scope:{sessionId:'s',branchId:'b',worldKey:'w@1',baseVersion:0},title:'资料',summary:'',fields:[],steps:[],view:[],actions:[]};
  assert.equal(f.controller.hasPresentation(),false);
  f.branch.dynamic={...failure('').dynamic,definition,digest:'digest'};assert.equal(f.controller.hasPresentation(),true);
  f.setHistorical(true);assert.equal(f.controller.hasPresentation(),false);
  f.setHistorical(false);f.state.version=1;assert.equal(f.controller.hasPresentation(),false);
});

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

test('changing a condition updates visible views, fields, steps, and the action stage',()=>{
  const when={op:'ref',path:['params','show']},d={id:'conditional',scope:{branchId:'b',baseVersion:0},title:'条件界面',summary:'',fields:[
    {id:'show',type:'boolean',label:'展开'},
    {id:'detail',type:'text',label:'补充说明',when}
  ],steps:[{id:'first',title:'先看',fields:['show']},{id:'second',title:'补充',fields:['detail'],when}],actions:[
    {id:'ask',label:'追问',mode:'attempt'}
  ],view:[{type:'text',text:'始终显示'},{type:'text',text:'条件内容',when}]};
  const state={facts:[],inventory:[],location:'柜台',time:'夜晚'};
  const hidden=dynamicView(d,state,{show:false}),first=dynamicView(d,state,{show:true}),second=dynamicView(d,state,{show:true},1);
  assert.match(hidden,/始终显示|追问/);assert.doesNotMatch(hidden,/条件内容|补充说明/);assert.match(hidden,/1 \/ 1/);
  assert.match(first,/条件内容/);assert.match(first,/下一步/);assert.doesNotMatch(first,/追问/);assert.match(first,/1 \/ 2/);
  for(const label of ['条件内容','补充说明','追问'])assert.match(second,new RegExp(label));assert.match(second,/2 \/ 2/);
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
