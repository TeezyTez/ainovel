import test from 'node:test';
import assert from 'node:assert/strict';
import {generateNarrative} from '../src/server-narrative.mjs';
import {modelConfig} from '../src/server-model.mjs';
import {storyContext} from '../src/server-story.mjs';
import {createSession,commitTurn,validateArchive,getBranch} from '../src/core.js';
import {publicArchive} from '../src/server-public-archive.mjs';

const world={id:'clinic',version:1,title:'雨夜',opening:'护士问你有没有受伤，门外响起敲门声。',identity:'避雨的人',location:'诊所',rules:['普通现实世界'],characters:[{id:'nurse',name:'林岚',public:'护士',secret:'BACKGROUND_ONLY'}]};
function fixture(){const session=createSession(world,{},'real'),branch=getBranch(session);return {session,body:{requestId:'story-test',world,state:branch.initialState,player:session.player,preferences:session.preferences,input:'没有',memory:[],recent:[],branchId:branch.id}};}
const config={available:true,narrativeEngine:'story',contextBudget:24000,outputBudget:2400,timeoutMs:1000};
const prose='护士把纱布推回柜台里。“那就好。”她望向门口，压低了声音。';
function record(){return {compatible:true,reason:'',record:{events:[],eventEvidence:[],suggestions:[],ended:false,experience:null,game:null,narrativeDelta:{focus:'诊所里的片刻交谈',beat:{kind:'rest',summary:'护士回应了你的回答。',methodId:'free'},threads:[],opportunities:[]}}};}
async function run(responses=[{prose},record()],body=fixture().body){const calls=[];const result=await generateNarrative(body,config,new AbortController().signal,{requestJSON:async(c,system,content,signal,options)=>{calls.push({c,system,data:JSON.parse(content),signal,options});return structuredClone(responses[calls.length-1]);}});return {calls,result};}

test('default engine separates prose from bookkeeping, leaves a quiet response intact and replays normally',async()=>{
 assert.equal(modelConfig({}).narrativeEngine,'story');
 const f=fixture(),before=JSON.stringify(f.body),{calls,result}=await run(undefined,f.body);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].options.schema.required,['prose']);
 assert.equal(calls[0].data.methods,undefined);assert.equal(calls[0].data.direction,undefined);assert.equal(calls[0].data.selectedScene,undefined);
 assert.equal(calls[1].data.fixedProse,prose);assert.equal(result.prose,prose);assert.equal(result.ended,false);assert.equal(JSON.stringify(f.body),before);
 commitTurn(f.session,world,'没有',result);validateArchive({schemaVersion:1,worlds:[world],sessions:[f.session]});
});
test('reader history excludes old technical schemas and distinguishes background names from read prose',()=>{
 const b=fixture().body;b.recent=[{input:'看一眼',prose:'门还关着。',state:{flags:{private:'STATE_ONLY'}},operation:{huge:'OPERATION_ONLY'}}];
 const c=storyContext(b);assert.deepEqual(c.reader.recent,[{input:'看一眼',prose:'门还关着。'}]);
 assert.equal(JSON.stringify(c.reader).includes('BACKGROUND_ONLY'),false);assert.equal(JSON.stringify(c).includes('STATE_ONLY'),false);assert.equal(JSON.stringify(c).includes('OPERATION_ONLY'),false);
 assert.equal(c.background.characters[0].secret,'BACKGROUND_ONLY');assert.ok(c.reader.opening.includes('护士'));
});
test('record repair cannot overwrite authored prose or invent evidence, and never reruns the author',async()=>{
 const bad=record();bad.record.events=[{type:'fact',entity:null,value:'医生到了',visibility:'player'}];bad.record.eventEvidence=[{index:0,quote:'医生到了'}];
 const {calls,result}=await run([{prose},bad,record()]);assert.equal(calls.length,3);assert.equal(calls[2].data.fixedProse,prose);assert.equal(calls[2].data.validationIssue,'事件证据必须逐项引用本轮原句。');assert.equal(result.prose,prose);
 await assert.rejects(run([{prose},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT');
 const overwrite=record();overwrite.record.prose='被记录器改写的正文';await assert.rejects(run([{prose},overwrite,overwrite]),e=>e.code==='INVALID_MODEL_RESULT');
});
test('semantic inconsistency fails without committing or treating style as an error',async()=>{
 const f=fixture(),before=JSON.stringify(f.session);
 await assert.rejects(run([{prose},{compatible:false,reason:'未授权动作',record:null}],f.body),e=>e.code==='INCONSISTENT_STORY');assert.equal(JSON.stringify(f.session),before);
 const {calls,result}=await run([{prose:'她没有替你作答。'},record()]);assert.equal(calls.length,2);assert.equal(result.prose,'她没有替你作答。');
});
test('cancellation during extraction returns no proposal and no additional call',async()=>{
 const c=new AbortController();let calls=0;
 await assert.rejects(generateNarrative(fixture().body,config,c.signal,{requestJSON:async()=>{calls++;if(calls===1)return {prose};c.abort();return record();}}),e=>e.code==='CANCELLED');assert.equal(calls,2);
});
test('bookkeeping cannot introduce a backstage name that the prose has not revealed',async()=>{
 const r=record();r.record.experience={clock:null,objects:[{id:'person:nurse',kind:'person',name:'林岚',nameKnown:true,summary:'护士',status:'在柜台后',certainty:'confirmed',fields:[],relatedIds:[],quote:prose}],stop:null,folded:[]};
 await assert.rejects(run([{prose},r,r]),e=>e.code==='INVALID_MODEL_RESULT'&&e.diagnostic.reason.includes('尚未在玩家经历中公开'));
 r.record.experience.objects[0]={...r.record.experience.objects[0],id:'person:nurse',name:'护士',nameKnown:false};
 const {result}=await run([{prose},r]);assert.equal(result.experience.objects[0].name,'护士');
});
test('all stages share a deadline even when a provider ignores cancellation',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});let calls=0;const started=Promise.withResolvers();
 const generation=generateNarrative(fixture().body,{...config,timeoutMs:50},new AbortController().signal,{requestJSON:async()=>{calls++;if(calls===1){t.mock.timers.tick(20);return {prose};}started.resolve();return new Promise(()=>{});}});
 const rejected=assert.rejects(generation,e=>e.code==='TIMEOUT');await started.promise;t.mock.timers.tick(30);await rejected;assert.equal(calls,2);
});
test('a character is introduced through a public label, then learns a name without creating another person',async()=>{
 const f=fixture(),first=record(),make=(name,known,quote)=>({id:'person:nurse',kind:'person',name,nameKnown:known,summary:'在柜台后',status:'在场',certainty:'confirmed',fields:[],relatedIds:[],quote});
 first.record.experience={clock:null,objects:[make('护士',false,prose)],stop:null,folded:[]};
 const a=await run([{prose},first],f.body);commitTurn(f.session,world,'没有',a.result);
 const b=getBranch(f.session),introduced='护士说：“我叫林岚。”',second=record();second.record.experience={clock:null,objects:[make('林岚',true,introduced)],stop:null,folded:[]};
 const next=await run([{prose:introduced},second],{...f.body,requestId:'introduce',state:b.turns.at(-1).state,input:'该怎么称呼您？',recent:b.turns,memory:b.turns.map(t=>t.memory),narrative:b.turns.at(-1).narrative});commitTurn(f.session,world,'该怎么称呼您？',next.result);
 assert.equal(b.turns.at(-1).state.experience.objects.length,1);assert.equal(b.turns[0].state.experience.objects[0].name,'护士');assert.equal(b.turns.at(-1).state.experience.objects[0].name,'林岚');validateArchive({schemaVersion:1,worlds:[world],sessions:[f.session]});
 f.session.privateLedger=true;const visible=publicArchive({session:f.session,worlds:[world]}).session.branches[0];assert.equal(visible.turns[0].state.experience.objects[0].name,'护士');assert.equal(visible.turns.at(-1).state.experience.objects[0].name,'林岚');
});
