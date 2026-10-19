import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {artifactDigest,normalizeAdvancedState} from '../../frontend/assets/reader_artifact/reader-advanced.js';
const worker=fileURLToPath(new URL('./validate.mjs',import.meta.url));const run=value=>spawnSync(process.execPath,[worker],{input:JSON.stringify(value),encoding:'utf8'});
const context={scope:{worldKey:'e',sessionId:'e',branchId:'b',sceneId:'',sourceTurnId:null,baseVersion:1},presentationRevision:1,facts:['铜币共有5枚。'],prose:'铜币共有5枚。',location:'',time:'暮色'};
const entity={id:'coins',kind:'meter',name:'铜币',detail:'',status:'',value:5,max:null,unit:'枚',quote:'铜币共有5枚。'};
test('only explicit public numbers and names become displayed resources',()=>{let request={op:'validate',context,value:{definition:null,game:{entities:[entity],surfaces:[],spatial:null,journeys:null},reason:'公开资源'}};const accepted=run(request);assert.equal(accepted.status,0);assert.equal(JSON.parse(accepted.stdout).state.game.entities[0].value,5);request.value.game.entities[0]={...entity,value:9};assert.notEqual(run(request).status,0);});
test('local state rejects unsafe keys, depth and oversize',()=>{for(const value of [JSON.parse('{"__proto__":1}'),{text:'a'.repeat(6001)},[[[[[[[[[[1]]]]]]]]]]]){const result=run({op:'state',value});assert.notEqual(result.status,0);assert.equal(result.stderr,'invalid_artifact');}assert.deepEqual(JSON.parse(run({op:'state',value:{tab:'map'}}).stdout),{tab:'map'});});
test('untrusted react-bundle is not a model definition',()=>{const definition={schemaVersion:1,id:'v',revision:1,title:'示例',summary:'',scope:context.scope,fields:[],steps:[],actions:[],view:[{type:'interactive',renderer:'react-bundle',title:'x',description:'x',html:'<main/>',css:'',script:'evil()'}]};assert.notEqual(run({op:'validate',context,allowScripts:true,value:{definition,game:null,reason:'test'}}).status,0);});
const interactive=(overrides={})=>({type:'interactive',title:'点心试算',description:'公开数量的局部试算',html:'<label>份数<input value="1"></label>',css:'',script:'',initialState:{quantity:1},...overrides});
const definitionFor=node=>({schemaVersion:1,id:'calculator',revision:1,title:'试算',summary:'仅局部准备',fields:[],steps:[],actions:[],view:[node]});
const accepted=request=>{const result=run(request);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
const previousFor=node=>accepted({op:'validate',context,allowScripts:true,value:{definition:definitionFor(node),game:null,reason:'局部试算'}});
const preparation=(previous,previousState,value,nextContext={})=>({op:'prepare',context:{...context,presentationRevision:2,pending:previous.definition,artifact:{head:'revision-one',contentHash:'payload-hash'},...nextContext},previous,previousState,value,allowScripts:true});
const patch=(changes,extra={})=>({decision:'patch',baseRevision:'revision-one',baseHash:'payload-hash',changes,...extra});

test('patching the current interactive view preserves its saved input under the new renderer identity',async()=>{
 const previous=previousFor(interactive()),oldKey=await artifactDigest(previous.definition.view[0]);
 const previousState={dynamic:{params:{guests:2},step:1},travel:{selectedPlace:'dock'},inspectedId:'coins',artifacts:{[oldKey]:{quantity:0}}};
 const result=accepted(preparation(previous,previousState,patch([{path:['view',0,'html'],value:'<label>点心份数<input value="1"></label>'}])));
 const nextKey=await artifactDigest(result.payload.definition.view[0]);
 assert.notEqual(nextKey,oldKey);
 assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).artifacts[nextKey],{quantity:0});
 assert.equal(Object.hasOwn(result.state.artifacts,oldKey),false);
 assert.equal(Object.hasOwn(result.state,'quantity'),false);
 assert.deepEqual(result.state.dynamic,previousState.dynamic);
 assert.deepEqual(result.state.travel,previousState.travel);
 assert.equal(result.state.inspectedId,'coins');
});

test('an explicit replacement migration maps nested sandbox input, drops obsolete keys and adds defaults',async()=>{
 const previous=previousFor(interactive()),oldKey=await artifactDigest(previous.definition.view[0]);
 const previousState={dynamic:{params:{guests:2}},travel:{selectedPlace:'dock'},artifacts:{[oldKey]:{quantity:0,obsolete:true,filter:'all'}}};
 const replacement=definitionFor(interactive({html:'<label>数量<input value="3"></label>',initialState:{count:3,extra:7}}));
 const result=accepted(preparation(previous,previousState,{definition:replacement,game:null,reason:'更新试算',stateMigration:{map:{quantity:'count'},drop:['obsolete']}}));
 const nextKey=await artifactDigest(result.payload.definition.view[0]);
 assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).artifacts[nextKey],{count:0,extra:7,filter:'all'});
 assert.deepEqual(result.state.dynamic,previousState.dynamic);
 assert.deepEqual(result.state.travel,previousState.travel);
 assert.deepEqual(Object.keys(result.state.artifacts),[nextKey]);
 assert.equal(Object.hasOwn(result.state,'count'),false);
});

test('patch migration affects only the current sandbox and preserves host navigation',async()=>{
 const previous=previousFor(interactive()),oldKey=await artifactDigest(previous.definition.view[0]);
 const previousState={dynamic:{params:{quantity:4},step:1,closed:true},travel:{selectedPlace:'dock'},inspectedId:'coins',artifacts:{[oldKey]:{quantity:0,obsolete:true,enabled:false},['f'.repeat(64)]:{unrelated:5}},quantity:99};
 const result=accepted(preparation(previous,previousState,patch([{path:['view',0,'initialState'],value:{count:3,extra:7}},{path:['view',0,'title'],value:'调整后的试算'}],{stateMigration:{map:{quantity:'count'},drop:['obsolete']}})));
 const nextKey=await artifactDigest(result.payload.definition.view[0]);
 assert.deepEqual(result.state,{dynamic:previousState.dynamic,travel:previousState.travel,inspectedId:'coins',artifacts:{[nextKey]:{count:0,extra:7,enabled:false}}});
});

test('a full replacement starts with its own defaults unless migration identifies the same tool',async()=>{
 const previous=previousFor(interactive()),oldKey=await artifactDigest(previous.definition.view[0]);
 const previousState={dynamic:{params:{}},artifacts:{[oldKey]:{quantity:0}}};
 for(const candidate of [
  {definition:definitionFor(interactive())},
  {definition:{...definitionFor(interactive()),id:'another-tool'},stateMigration:{map:{}}},
  {definition:definitionFor(interactive({title:'另一个工具'})),stateMigration:{map:{}}},
  {definition:definitionFor({type:'react',title:'点心试算',description:'另一种界面',source:'export default function View(){return <p>试算</p>}',css:'',initialState:{quantity:1}}),stateMigration:{map:{}}},
 ]){
  const result=accepted(preparation(previous,previousState,{...candidate,game:null,reason:'完整替换'}));
  const nextKey=await artifactDigest(result.payload.definition.view[0]);
  assert.deepEqual(result.state.artifacts,{[nextKey]:{quantity:1}});
  assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).dynamic,{params:{},step:0,closed:false});
 }
});

test('patch and replacement migration never reuse sandbox values from another exact scope',async()=>{
 const previous=previousFor(interactive()),oldKey=await artifactDigest(previous.definition.view[0]);
 const previousState={dynamic:{params:{amount:8},step:2,closed:true},artifacts:{[oldKey]:{quantity:0}}};
 for(const [field,value] of Object.entries({worldKey:'other',sessionId:'other',branchId:'other',sceneId:'other',sourceTurnId:'other',baseVersion:2})){
  const nextContext={scope:{...context.scope,[field]:value}};
  for(const candidate of [patch([{path:['title'],value:'本轮试算'}]),{definition:definitionFor(interactive()),game:null,reason:'本轮试算',stateMigration:{map:{}}}]){
   const result=accepted(preparation(previous,previousState,candidate,nextContext));
   const nextKey=await artifactDigest(result.payload.definition.view[0]);
   assert.deepEqual(result.state.artifacts[nextKey],{quantity:1},field);
   assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).dynamic,{params:{},step:0,closed:false},field);
  }
 }
});

test('nested React patches preserve input and initialization uses the same renderer state slot',async()=>{
 const node={type:'react',title:'点心试算',description:'局部试算',source:'export default function View(){return <p>试算</p>}',css:'',initialState:{quantity:1}};
 const previous=previousFor({type:'group',children:[node]}),oldKey=await artifactDigest(node);
 const initial=accepted(preparation(previous,{}, {definition:previous.definition,game:null,reason:'首次整理'}));
 assert.deepEqual(normalizeAdvancedState(initial.state,initial.payload.definition).artifacts[oldKey],{quantity:1});
 const result=accepted(preparation(previous,{artifacts:{[oldKey]:{quantity:0}}},patch([{path:['view',0,'children',0,'source'],value:'export default function View(){return <p>点心试算</p>}'}])));
 const nextKey=await artifactDigest(result.payload.definition.view[0].children[0]);
 assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).artifacts[nextKey],{quantity:0});
 assert.deepEqual(Object.keys(result.state.artifacts),[nextKey]);
});

test('declarative flat migrations and none decisions keep existing local data',()=>{
 const previous=previousFor({type:'cards',items:[{title:'铜币',body:'共有5枚。'}]});
 const previousState={question:'保留此参数'};
 const result=accepted(preparation(previous,previousState,patch([{path:['title'],value:'调整标题'}],{stateMigration:{map:{question:'prompt'}}})));
 assert.deepEqual(result.state,{prompt:'保留此参数'});
 const none=accepted(preparation(result.payload,result.state,{decision:'none',reason:'无需辅助'}));
 assert.deepEqual(none.state,{prompt:'保留此参数'});
 assert.equal(none.payload.definition,null);
});

test('archive validation keeps the original payload and local-state validation does not migrate it',async()=>{
 const previous=previousFor(interactive()),key=await artifactDigest(previous.definition.view[0]);
 const state={dynamic:{params:{}},artifacts:{[key]:{quantity:0}}};
 const restored=accepted({op:'validate',context,allowScripts:true,value:{definition:previous.definition,game:previous.sourceGame,reason:previous.reason}});
 assert.deepEqual(restored,previous);
 assert.deepEqual(accepted({op:'state',value:state}),state);
});

test('invalid sandbox migrations are rejected rather than dropping or aliasing saved values',async()=>{
 const previous=previousFor(interactive()),key=await artifactDigest(previous.definition.view[0]);
 for(const stateMigration of [{map:{quantity:'constructor'}},{map:{quantity:'count',other:'count'}},{drop:['__proto__']},{unsupported:true}]){
  const result=run(preparation(previous,{artifacts:{[key]:{quantity:0,other:2}}},patch([{path:['title'],value:'调整标题'}],{stateMigration})));
  assert.notEqual(result.status,0);
 }
});

test('a patch without saved sandbox input retains the previous explicit null initial state',async()=>{
 const previous=previousFor(interactive({initialState:null}));
 for(const previousState of [{dynamic:{params:{}}},{}]){
  const result=accepted(preparation(previous,previousState,patch([{path:['view',0,'css'],value:'p{color:inherit}'}])));
  const nextKey=await artifactDigest(result.payload.definition.view[0]);
  assert.equal(result.state.artifacts[nextKey],null);
 }
});

test('changing a tool identity resets same-named form inputs, step and closed state while retaining navigation',()=>{
 const form=(id,amount,node)=>({...definitionFor(node),id,fields:[{id:'amount',type:'number',label:'数量',default:amount,min:0,max:1000}]});
 for(const node of [{type:'text',text:'数量试算'},interactive()]){
  const previous=accepted({op:'validate',context,allowScripts:true,value:{definition:form('distance-tool',8,node),game:null,reason:'旧工具'}});
  const previousState={dynamic:{params:{amount:8},step:2,closed:true},travel:{selectedPlace:'dock'},inspectedId:'coins'};
  for(const variant of [{id:'budget-tool',scope:context.scope},{id:'distance-tool',scope:{...context.scope,baseVersion:2}}]){
   const replacement=form(variant.id,100,node);
   const result=accepted(preparation(previous,previousState,{definition:replacement,game:null,reason:'新工具'},{scope:variant.scope}));
   assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).dynamic,{params:{amount:100},step:0,closed:false});
   assert.deepEqual(result.state.travel,previousState.travel);
   assert.equal(result.state.inspectedId,'coins');
  }
 }
});

test('a same-tool declarative patch retains form state and none retains the complete journal state',()=>{
 const previous=previousFor({type:'text',text:'公开问题'});
 const previousState={dynamic:{params:{question:'保留此参数'},step:2,closed:true},travel:{selectedPlace:'dock'},inspectedId:'coins',artifacts:{['f'.repeat(64)]:{cached:2}}};
 const patched=accepted(preparation(previous,previousState,patch([{path:['title'],value:'调整标题'}])));
 assert.deepEqual(patched.state.dynamic,previousState.dynamic);
 assert.deepEqual(patched.state.travel,previousState.travel);
 assert.equal(patched.state.inspectedId,'coins');
 const none=accepted(preparation(previous,previousState,{decision:'none',reason:'无需辅助'}));
 assert.deepEqual(none.state,previousState);
});

test('same-tool declarative migration applies to form parameters rather than the host state root',()=>{
 const field=id=>({id,type:'number',label:'数量',default:100,min:0,max:1000});
 const original={...definitionFor({type:'text',text:'试算'}),fields:[field('amount')]};
 const previous=accepted({op:'validate',context,allowScripts:true,value:{definition:original,game:null,reason:'试算'}});
 const previousState={dynamic:{params:{amount:0,obsolete:true},step:0,closed:false},travel:{selectedPlace:'dock'},inspectedId:'coins'};
 const replacement={...original,fields:[field('count')]};
 const result=accepted(preparation(previous,previousState,{definition:replacement,game:null,reason:'调整参数',stateMigration:{map:{amount:'count'},drop:['obsolete']}}));
 assert.deepEqual(normalizeAdvancedState(result.state,result.payload.definition).dynamic,{params:{count:0},step:0,closed:false});
 assert.deepEqual(result.state.travel,previousState.travel);
 assert.equal(result.state.inspectedId,'coins');
 assert.equal(Object.hasOwn(result.state,'count'),false);
});
