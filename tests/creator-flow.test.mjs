import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {detailView,creatorView} from '../src/experience-views.js';

const world={id:'fog-harbor',title:'雾港来信',identity:'电报员',opening:'一封迟来的信。',rules:[],characters:[],tags:[]};
const experience={premise:'你刚刚回到故乡。',possibilities:[]};

test('a world cannot start in the wrong mode before connection inspection completes',()=>{
 const html=detailView({world,experience,settings:{},available:false,modelChecked:false});
 assert.match(html,/<button[^>]*data-start-submit[^>]*disabled/);
 assert.match(html,/data-start-availability[^>]*>正在检查/);
 assert.doesNotMatch(html,/模型未连接，将进入预设演示/);
});

test('connected and offline world details retain a live availability explanation',()=>{
 for(const available of [true,false]){
  const html=detailView({world,experience,settings:{},available,modelChecked:true});
  assert.match(html,/data-start-availability/);
  assert.doesNotMatch(html,/<button[^>]*data-start-submit[^>]*disabled/);
 }
 const readonly=detailView({world:{...world,custom:true},experience,settings:{},available:false,modelChecked:true});
 assert.match(readonly,/仅能查看开场，暂不能推进世界/);
 assert.match(readonly,/data-demo-compatible="false"/);
 const unknown=detailView({world:{...world,id:'unknown-script'},experience,settings:{},available:false,modelChecked:true});
 assert.match(unknown,/仅能查看开场，暂不能推进世界/);
 assert.match(unknown,/data-demo-compatible="false"/);
});

test('quick generation explains its result and keeps editable seed when a job fails',()=>{
 const html=creatorView({world:{...world,title:'',opening:'',seed:'<雨天>书店'},available:true,error:'连接暂时中断',characterFields:()=>''});
 assert.match(html,/生成并开始/);
 assert.match(html,/&lt;雨天&gt;书店/);
 assert.match(html,/role="alert">连接暂时中断/);
 assert.match(html,/id="creator-seed-help"/);
 assert.match(html,/name="seed"[^>]*aria-describedby="creator-seed-help"/);
});

test('editing world details preserves generated narrative metadata that is absent from the form',()=>{
 const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const from=source.indexOf('function collectEditor('),to=source.indexOf('function persistEditor(',from);
 assert.ok(from>=0&&to>from);
 const narrative={perspective:'第二人称',length:'适中',style:'冷峻幽默',pace:'紧张与停顿交错',motifs:['钟声']};
 const editor={...world,narrative:structuredClone(narrative),characters:[]};
 const form=new Map([['title','改过名称的雾港'],['perspective','第三人称'],['length','舒展'],['description','仍是同一个世界。']]);
 const context=vm.createContext({editor,db:{},editorDirty:false,$:()=>form,FormData:class{constructor(data){return data;}},clone:structuredClone});
 vm.runInContext(source.slice(from,to),context);
 context.collectEditor();
 assert.deepEqual(structuredClone(editor.narrative),{...narrative,perspective:'第三人称',length:'舒展'});
 assert.deepEqual(context.db.worldDraft.narrative,structuredClone(editor.narrative));
 assert.equal(editor.title,'改过名称的雾港');
 assert.equal(context.editorDirty,true);
});
