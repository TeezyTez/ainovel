import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperienceControls} from '../src/experience-controls.js';
import {detailView} from '../src/experience-views.js';
import {readerView} from '../src/reading-ui.js';
import {settingsView} from '../src/settings-ui.js';
import {createSession,getBranch} from '../src/core.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {defaultSettings} from '../src/storage.js';

test('restore appearance edits the form only; closing without Apply preserves preferences',()=>{
  const saved={...defaultSettings,fontSize:24,theme:'dark'},db={settings:saved};
  const fields=Object.fromEntries(Object.entries(saved).map(([name,value])=>[name,{value,type:typeof value==='boolean'?'checkbox':'number',checked:value}]));
  const form={elements:{namedItem:name=>fields[name]}};
  const prior=globalThis.document;globalThis.document={querySelector:selector=>selector==='#reader-settings-form'?form:null};
  let writes=0;
  try{
    const controls=createExperienceControls({sessionNow:()=>({}),getDB:()=>db,save:()=>writes++});
    assert.equal(controls.handle('reset-reading',{}),true);
    assert.equal(fields.fontSize.value,defaultSettings.fontSize);
    assert.equal(fields.lineHeight.value,defaultSettings.lineHeight);
    assert.equal(saved.fontSize,24);assert.equal(saved.theme,'dark');assert.equal(writes,0);
  }finally{globalThis.document=prior;}
});

test('drafting from a known object preserves existing user input and remains unsent',()=>{
  const world=PRESET_WORLDS[0],session=createSession(world,{name:'我',identity:world.identity},'demo');
  const branch=getBranch(session);branch.draft='先问清价格。';
  const field={value:branch.draft,dispatchEvent(){},focus(){}};
  const prior=globalThis.document;globalThis.document={querySelector:selector=>selector==='#action-input'?field:selector==='#dialog'?{close(){}}:null};
  let sends=0;
  try{
    const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,save(){},toast(){},sendTurn(){sends++;}});
    // Public character IDs are produced by the same state projection as the view.
    const {id}=world.characters[0];
    controls.handle('draft-object',{dataset:{object:'person:'+id}});
    assert.equal(branch.draft,'先问清价格。');
    assert.equal(branch.personal.draftReferences[0].objectId,'person:'+id);
    assert.equal(sends,0);assert.equal(branch.turns.length,0);
    controls.handle('clear-draft',{});assert.equal(branch.draft,'');
  }finally{globalThis.document=prior;}
});

test('taking control waits for active cancellation and preserves the unsubmitted draft',async()=>{
  const session={preferences:{participation:'observe'}},branch={draft:'尚未发送的对白。'},events=[];
  let finishCancel;const cancelled=new Promise(resolve=>{finishCancel=resolve;});
  const prior=globalThis.document;globalThis.document={querySelector:()=>null};
  try{
    const controls=createExperienceControls({sessionNow:()=>session,getBranch:()=>branch,busy:()=>true,cancelRequest(){events.push('cancel');return cancelled;},save(){events.push('save');},refresh(){events.push('refresh');},toast(){}});
    assert.equal(controls.handle('take-control',{}),true);
    assert.equal(session.preferences.participation,'observe');assert.deepEqual(events,['cancel']);
    finishCancel();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(session.preferences.participation,'act');assert.equal(branch.draft,'尚未发送的对白。');
    assert.deepEqual(events,['cancel','save','refresh']);
  }finally{globalThis.document=prior;}
});

test('opening the four query panels does not save or submit a world action',()=>{
  const world=PRESET_WORLDS[0],session=createSession(world,{name:'我',identity:world.identity},'demo'),branch=getBranch(session),before=JSON.stringify(branch),opened=[];
  const prior=globalThis.document;globalThis.document={querySelector:selector=>selector==='#dialog'?{classList:{add(){}}}:null};
  let sends=0,writes=0;
  try{
    const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,save(){writes++;},toast(){},sendTurn(){sends++;},busy:()=>true,openDialog(title,html){opened.push({title,html});}});
    for(const action of ['play-time','play-inventory','play-journal','play-around'])assert.equal(controls.handle(action,{}),true);
    assert.deepEqual(opened.map(p=>p.title),['时间','身上','手记','周围']);
    assert.equal(sends,0);assert.equal(writes,0);assert.equal(JSON.stringify(branch),before);
    for(const {html} of opened)assert.match(html,/故事正在推进/);
    assert.doesNotMatch(opened[0].html,/<form|type="submit"/);
  }finally{globalThis.document=prior;}
});

test('talking to a present person adds a removable reference without composing or sending speech',()=>{
  const world=PRESET_WORLDS[0],session=createSession(world,{name:'我',identity:world.identity},'demo'),branch=getBranch(session),person=world.characters[0];
  branch.initialState.experience={objects:[{id:'person:'+person.id,kind:'person',name:person.name,summary:'就在眼前',status:'在场',certainty:'confirmed',sourceVersion:0,fields:[{key:'location',label:'位置',value:branch.initialState.location}],relatedIds:[]}]};
  branch.draft='先问清价格。';let focused=0,sends=0;const chips={innerHTML:''};
  const prior=globalThis.document;globalThis.document={querySelector:selector=>selector==='#action-input'?{focus(){focused++;}}:selector==='#dialog'?{close(){}}:selector==='[data-draft-references]'?chips:null};
  try{
    const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,save(){},toast(){},sendTurn(){sends++;}});
    controls.handle('play-talk',{dataset:{object:'person:'+person.id}});
    assert.equal(branch.draft,'先问清价格。');assert.equal(sends,0);assert.equal(branch.turns.length,0);assert.ok(focused>0);
    assert.equal(branch.personal.draftReferences.length,1);assert.match(chips.innerHTML,/移除对象/);
    controls.handle('remove-reference',{dataset:{index:'0'}});
    assert.equal(branch.personal.draftReferences.length,0);assert.equal(branch.draft,'先问清价格。');
  }finally{globalThis.document=prior;}
});

test('time submission refuses stale panels and concurrent requests before sending any control',()=>{
  const world=PRESET_WORLDS[0],session=createSession(world,{name:'我',identity:world.identity},'demo'),branch=getBranch(session),toasts=[];
  const priorDocument=globalThis.document,priorFormData=globalThis.FormData;
  let isBusy=false,sends=0,values={mode:'until',untilType:'event',goal:'唐棠来到店里',limit:''};
  const form={dataset:{version:String(branch.initialState.version)},elements:{namedItem:()=>({focus(){}})}};
  globalThis.document={querySelector:selector=>selector==='#time-form'?form:selector==='#dialog'?{close(){},classList:{add(){}}}:null};
  globalThis.FormData=class{constructor(){return new Map(Object.entries(values));}};
  try{
    const controls=createExperienceControls({sessionNow:()=>session,getBranch,sessionWorld:()=>world,busy:()=>isBusy,save(){},toast:message=>toasts.push(message),openDialog(){},sendTurn(){sends++;}});
    controls.handle('play-time-mode',{dataset:{mode:'until'}});
    const submit=()=>form.onsubmit({preventDefault(){}});
    submit();assert.equal(sends,0);assert.match(toasts.at(-1),/最晚等到什么时候/);
    values.limit='今天17:00';isBusy=true;submit();assert.equal(sends,0);
    isBusy=false;form.dataset.version='99';submit();assert.equal(sends,0);assert.match(toasts.at(-1),/情况已经更新/);
    form.dataset.version=String(branch.initialState.version);submit();assert.equal(sends,1);
  }finally{globalThis.document=priorDocument;globalThis.FormData=priorFormData;}
});

test('returning to a world puts resume first and keeps new game explicitly folded',()=>{
  const world=PRESET_WORLDS[0],base={world,experience:{premise:'身份',possibilities:[]},settings:{},available:true};
  const html=detailView({...base,sessions:[{id:'keep',worldId:world.id,updatedAt:10}]});
  assert.match(html,/class="btn primary resume-world" href="#\/story\/keep"/);
  assert.match(html,/<details class="restart-world"><summary>重新开始<\/summary>/);
  assert.ok(html.indexOf('返回世界')>=0&&html.indexOf('返回世界')<html.indexOf('id="start-form"'));
  const fresh=detailView({...base,sessions:[{id:'trash',worldId:world.id,personal:{trashedAt:20}}]});
  assert.doesNotMatch(fresh,/resume-world/);assert.match(fresh,/进入世界/);
});

test('single-character common nouns do not become distracting prose links',()=>{
  const html=readerView({branch:{opening:'路的尽头是长桥。',turns:[]},situation:{objects:[{id:'road',name:'路',sourceVersion:0},{id:'bridge',name:'长桥',sourceVersion:0}]}});
  assert.doesNotMatch(html,/data-object="road"/);assert.match(html,/data-object="bridge"/);
});

test('settings use local controls, remove inert toggles, and explain backup limits',()=>{
  const html=settingsView({settings:defaultSettings});
  assert.doesNotMatch(html,/href="#reading-settings"|showSuggestions|导出完整存档/);
  assert.match(html,/data-action="settings-jump"/);assert.match(html,/单个 JSON 文件不能完整迁移/);
  assert.match(html,/min="16" max="30"/);assert.match(html,/min="480" max="880"/);
});
