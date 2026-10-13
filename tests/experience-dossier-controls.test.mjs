import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperienceControls} from '../src/experience-controls.js';
import {createSession,getBranch,commitTurn} from '../src/core.js';

function fixture(){
 const world={id:'dossier-fixture',version:1,title:'信封',identity:'访客',location:'门厅',opening:'柜台上放着一只信封。',rules:[],characters:[]};
 const session=createSession(world,{},'real'),branch=getBranch(session);
 const record=(prose,status)=>({clock:null,objects:[{id:'item:letter',kind:'item',name:'信封',summary:prose,status,certainty:'confirmed',fields:[],relatedIds:[],quote:prose,nameKnown:true}],stop:null,folded:[]});
 const first='信封封口完好，里面的内容尚不清楚。',later='信封拆开了，里面写着暗号BLUEBIRD。';
 commitTurn(session,world,'观察信封',{requestId:'look',baseVersion:0,prose:first,events:[],experience:record(first,'封口完好')});
 commitTurn(session,world,'拆信',{requestId:'open',baseVersion:1,prose:later,events:[],experience:record(later,'已拆开')});
 return {world,session,branch};
}

test('a dossier detail keeps its historical snapshot and rejects unknown snapshots without exposing later facts',t=>{
 const {world,session,branch}=fixture(),opened=[],notices=[];
 const previous=globalThis.document;globalThis.document={querySelector:selector=>selector==='#dialog'?{classList:{add(){}}}:null};t.after(()=>globalThis.document=previous);
 const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,busy:()=>false,save(){},toast:text=>notices.push(text),openDialog:(title,html)=>opened.push({title,html})});
 controls.viewSnapshot(branch.turns[0].id);controls.handle('object-detail',{dataset:{object:'item:letter'}});
 assert.match(opened.at(-1).html,/封口完好/);assert.match(opened.at(-1).html,/历史快照/);assert.doesNotMatch(opened.at(-1).html,/BLUEBIRD/);
 assert.throws(()=>controls.viewSnapshot('missing-turn'),/历史|快照|片段/);
 controls.handle('object-detail',{dataset:{object:'item:letter'}});assert.doesNotMatch(opened.at(-1).html,/BLUEBIRD/);
 controls.viewSnapshot(null);const count=opened.length;controls.handle('object-detail',{dataset:{object:'item:letter'}});assert.equal(opened.length,count);assert.match(notices.at(-1),/查询范围/);
 controls.viewSnapshot(undefined);controls.handle('object-detail',{dataset:{object:'item:letter'}});assert.match(opened.at(-1).html,/BLUEBIRD/);assert.doesNotMatch(opened.at(-1).html,/历史快照/);
});

test('legacy live invalidation does not replace the dossier shell but continues updating legacy panels',t=>{
 const {world,session}=fixture(),opened=[];let dossier=true;
 const panel={dataset:{version:'0',busy:'false',livePlay:'around'}},dialog={open:true,classList:{contains:()=>dossier,add(){}},querySelector:()=>panel};
 const previous=globalThis.document;globalThis.document={querySelector:selector=>selector==='#dialog'?dialog:null};t.after(()=>globalThis.document=previous);
 const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,busy:()=>false,save(){},openDialog:title=>opened.push(title)});
 controls.invalidate();assert.deepEqual(opened,[]);
 dossier=false;controls.invalidate();assert.deepEqual(opened,['周围']);
});

test('binding a dossier journal submits a local query without navigation or story generation',t=>{
 const {world,session}=fixture(),queries=[],form={};let prevented=false;
 const priorDocument=globalThis.document,priorFormData=globalThis.FormData;
 globalThis.document={querySelector:selector=>selector==='#play-journal-form'?form:null};globalThis.FormData=class{constructor(){return new Map([['query','信封']]);}};
 t.after(()=>{globalThis.document=priorDocument;globalThis.FormData=priorFormData;});
 const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,showQuery:(...args)=>queries.push(args),sendTurn:()=>assert.fail('a journal query must not generate a turn')});
 controls.bind();form.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.deepEqual(queries,[['journal',{query:'信封'}]]);
});
