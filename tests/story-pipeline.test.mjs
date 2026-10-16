import test from 'node:test';
import assert from 'node:assert/strict';
import {generateNarrative} from '../src/server-narrative.mjs';
import {modelConfig} from '../src/server-model.mjs';
import {storyContext,generateStory} from '../src/server-story.mjs';
import {createSession,commitTurn,validateArchive,getBranch} from '../src/core.js';
import {publicArchive} from '../src/server-public-archive.mjs';

const world={id:'clinic',version:1,title:'雨夜',opening:'护士问你有没有受伤，门外响起敲门声。',identity:'避雨的人',location:'诊所',rules:['普通现实世界'],characters:[{id:'nurse',name:'林岚',public:'护士',secret:'BACKGROUND_ONLY'}]};
function fixture(){const session=createSession(world,{},'real'),branch=getBranch(session);return {session,body:{requestId:'story-test',world,state:branch.initialState,player:session.player,preferences:session.preferences,input:'没有',memory:[],recent:[],branchId:branch.id}};}
const config={available:true,narrativeEngine:'story',contextBudget:24000,outputBudget:2400,timeoutMs:1000};
const prose='护士把纱布推回柜台里。“那就好。”她望向门口，压低了声音。';
function record(){return {record:{events:[],eventEvidence:[],suggestions:[],ended:false,experience:null,game:null,narrativeDelta:{focus:'诊所里的片刻交谈',beat:{kind:'rest',summary:'护士回应了你的回答。',methodId:'free'},threads:[],opportunities:[]}}};}
async function run(responses=[{prose},record()],body=fixture().body){const calls=[];const result=await generateNarrative(body,config,new AbortController().signal,{requestJSON:async(c,system,content,signal,options)=>{calls.push({c,system,data:JSON.parse(content),signal,options});return structuredClone(responses[calls.length-1]);}});return {calls,result};}

test('default engine separates prose from bookkeeping, leaves a quiet response intact and replays normally',async()=>{
 assert.equal(modelConfig({}).narrativeEngine,'story');
 const f=fixture(),before=JSON.stringify(f.body),{calls,result}=await run(undefined,f.body);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].options.schema.required,['prose']);
 assert.equal(calls[0].data.methods,undefined);assert.equal(calls[0].data.direction,undefined);assert.equal(calls[0].data.selectedScene,undefined);
 assert.equal(calls[1].data.fixedProse,prose);assert.equal(result.prose,prose);assert.equal(result.ended,false);assert.equal(JSON.stringify(f.body),before);
 commitTurn(f.session,world,'没有',result);validateArchive({schemaVersion:1,worlds:[world],sessions:[f.session]});
});

test('story writing receives the world tone and ignores obsolete session style and pace',async()=>{
 const {body}=fixture();body.world=structuredClone(body.world);
 body.world.narrative={style:'干脆、冷峻的生存悬疑',pace:'险情急促，脱险后才有喘息',perspective:'第二人称',length:'适中'};
 body.preferences={...body.preferences,style:'细腻克制',pace:'从容',length:'简短'};
 const before=JSON.stringify(body),{calls}=await run(undefined,body);
 assert.deepEqual(calls[0].data.background.narrative,body.world.narrative);
 assert.equal(calls[0].data.preferences.length,'简短');
 assert.equal(Object.hasOwn(calls[0].data.preferences,'style'),false);
 assert.equal(Object.hasOwn(calls[0].data.preferences,'pace'),false);
 assert.equal(JSON.stringify(body),before);
});

test('a legacy world without narrative settings receives no universal tone fallback',async()=>{
 const {body}=fixture();body.preferences={...body.preferences,style:'细腻克制',pace:'从容'};
 const {calls}=await run(undefined,body),context=calls[0].data;
 assert.equal(context.background.narrative,undefined);
 assert.equal(JSON.stringify(context).includes('细腻克制'),false);
 assert.equal(JSON.stringify(context).includes('从容'),false);
});
test('progress reports only real stage transitions and keeps unvalidated prose private',async()=>{
 const order=[],bad=record();bad.record.events=[{type:'fact',entity:null,value:'医生到了',visibility:'player'}];bad.record.eventEvidence=[{index:0,quote:'医生到了'}];
 const replies=[{prose},bad,record()];let count=0;
 const result=await generateStory(fixture().body,config,new AbortController().signal,{
  onProgress:(...args)=>{assert.equal(args.length,1);order.push(args[0]);},
  requestJSON:async()=>{order.push('request');return structuredClone(replies[count++]);}
 });
 assert.deepEqual(order,['writing','request','recording','request','request']);assert.equal(result.prose,prose);assert.equal(count,3);
});
test('reader history excludes old technical schemas and distinguishes background names from read prose',()=>{
 const b=fixture().body;b.recent=[{input:'看一眼',prose:'门还关着。',state:{flags:{private:'STATE_ONLY'}},operation:{huge:'OPERATION_ONLY'}}];
 const c=storyContext(b);assert.deepEqual(c.reader.recent,[{input:'看一眼',prose:'门还关着。'}]);
 assert.equal(JSON.stringify(c.reader).includes('BACKGROUND_ONLY'),false);assert.equal(JSON.stringify(c).includes('STATE_ONLY'),false);assert.equal(JSON.stringify(c).includes('OPERATION_ONLY'),false);
 assert.equal(c.background.characters[0].secret,'BACKGROUND_ONLY');assert.ok(c.reader.opening.includes('护士'));
});
test('reader continuity includes only the last three committed changes without narrative machinery',()=>{
 const b=fixture().body;b.narrative={recentBeats:[
  {summary:'旧线索已经查清。',kind:'payoff',methodId:'OLD_METHOD'},
  {summary:'护士找到备用手电。',kind:'progress',methodId:'METHOD_ONLY'},
  {summary:'门外的来人报出自己是送药员。',kind:'setup',privateNote:'PRIVATE_ONLY'},
  {summary:'护士答应隔着门核对配送单。',kind:'progress',methodId:'METHOD_ONLY'}
 ],threads:[]};
 const c=storyContext(b);assert.deepEqual(c.reader.recentChanges,['护士找到备用手电。','门外的来人报出自己是送药员。','护士答应隔着门核对配送单。']);
 assert.equal(JSON.stringify(c.reader).includes('METHOD_ONLY'),false);assert.equal(JSON.stringify(c.reader).includes('PRIVATE_ONLY'),false);
 assert.equal(storyContext(fixture().body).reader.recentChanges,undefined);
});
test('background names carry explicit reader knowledge without treating aliases or short substrings as introductions',()=>{
 const b=fixture().body;b.world=structuredClone(b.world);b.world.characters=[{id:'keeper',name:'陶岳',secret:'BACKGROUND_ONLY'},{id:'short',name:'周',secret:''}];
 b.world.opening='周围很安静，周宁拿着灯。无线电里的值班员自称老陶。';
 b.state.experience={objects:[{id:'person:keeper',kind:'person',name:'老陶',nameKnown:false}]};
 assert.deepEqual(storyContext(b).background.characters.map(c=>c.nameKnownToReader),[false,false]);
 b.recent=[{prose:'值班员说：“我叫陶岳。”',input:'该怎么称呼您？'}];
 assert.equal(storyContext(b).background.characters[0].nameKnownToReader,true);
 b.recent=[];b.state.experience.objects=[{id:'person:keeper',kind:'person',name:'陶岳',nameKnown:true}];
 assert.equal(storyContext(b).background.characters[0].nameKnownToReader,true);
 assert.equal(JSON.stringify(storyContext(b).reader).includes('BACKGROUND_ONLY'),false);
});
test('record repair keeps literal entity names and cannot turn a paraphrased label into evidence',async()=>{
 const authored='插销横在座扣里，两颗固定螺钉都在。',bad=record();
 bad.record.game={entities:[{id:'door:latch',kind:'clue',name:'后门插销状况',detail:'两颗螺钉都在。',status:'已检查',value:null,max:null,unit:'',quote:authored}],surfaces:[],spatial:null,journeys:null};
 const corrected=structuredClone(bad);corrected.record.game.entities[0].name='插销';
 const {calls,result}=await run([{prose:authored},bad,corrected]);
 assert.match(calls[2].data.validationIssue,/quote必须包含其name/);assert.equal(result.game.entities[0].name,'插销');assert.equal(result.prose,authored);
 await assert.rejects(run([{prose:authored},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT');
});

test('one record repair receives all missing identity evidence across experience and game together',async()=>{
 const authored='门内的人望向通道里的人。她举起灯。他靠住墙。',bad=record();
 bad.record.experience={clock:null,objects:[{id:'person:visitor',kind:'person',name:'通道里的人',nameKnown:false,summary:'靠在墙边',status:'靠墙',certainty:'confirmed',fields:[],relatedIds:[],quote:'他靠住墙。'}],stop:null,folded:[]};
 bad.record.game={entities:[{id:'person:keeper',kind:'actor',name:'门内的人',detail:'举起灯',status:'举灯',value:null,max:null,unit:'',quote:'她举起灯。'}],surfaces:[],spatial:null,journeys:null};
 const fixed=structuredClone(bad);fixed.record.experience.objects[0].quote=authored;fixed.record.game.entities[0].quote=authored;
 const {calls,result}=await run([{prose:authored},bad,fixed]);
 const repair=calls[2].data;
 assert.match(repair.validationIssue,/\$\.experience\.objects\[0\]\.quote/);
 assert.match(repair.validationIssue,/\$\.game\.entities\[0\]\.quote/);
 assert.deepEqual(repair.validationIssues.map(x=>({path:x.path,name:x.name})),[
  {path:'$.experience.objects[0].quote',name:'通道里的人'},
  {path:'$.game.entities[0].quote',name:'门内的人'}
 ]);
 assert.equal(repair.fixedProse,authored);assert.equal(calls.length,3);assert.equal(result.prose,authored);
 assert.equal(result.experience.objects[0].name,'通道里的人');assert.equal(result.game.entities[0].name,'门内的人');
 const objectSchema=calls[1].options.schema.properties.record.properties.experience.anyOf[0].properties.objects.items.properties;
 assert.match(objectSchema.quote.description,/name/);assert.match(objectSchema.nameKnown.description,/false/);
 await assert.rejects(run([{prose:authored},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT');
});

test('identity evidence repair never accepts a made-up quote or a backstage identity',async()=>{
 const authored='门内的人举起灯。',bad=record();
 bad.record.experience={clock:null,objects:[{id:'person:nurse',kind:'person',name:'林岚',nameKnown:false,summary:'举灯',status:'在场',certainty:'confirmed',fields:[],relatedIds:[],quote:'林岚举起灯。'}],stop:null,folded:[]};
 await assert.rejects(run([{prose:authored},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT');
});

test('identity citation repair changes only rejected quotes even if the model rewrites valid records',async()=>{
 const authored='门内的人举起灯。她望向通道里的人。他靠住墙。',bad=record();
 const person={id:'person:visitor',kind:'person',name:'通道里的人',nameKnown:false,summary:'靠在墙边',status:'靠墙',certainty:'confirmed',fields:[],relatedIds:[],quote:'他靠住墙。'};
 bad.record.experience={clock:null,objects:[person],stop:null,folded:[]};
 bad.record.game={entities:[{id:'place:door',kind:'place',name:'门',detail:'门边',status:'未知',value:null,max:null,unit:'',quote:'门内的人举起灯。'}],surfaces:[],spatial:null,journeys:null};
 const repair=structuredClone(bad);repair.record.experience.objects[0].quote=authored;
 repair.record.experience.objects[0].name='他';
 repair.record.game.entities[0].name='医院后门';
 repair.record.events=[{type:'fact',entity:null,value:'有人已经离开',visibility:'player'}];
 repair.record.narrativeDelta.focus='不应采用的重写';
 const {result}=await run([{prose:authored},bad,repair]);
 assert.equal(result.experience.objects[0].name,person.name);
 assert.equal(result.experience.objects[0].quote,authored);
 assert.equal(result.game.entities[0].name,'门');assert.deepEqual(result.events,[]);
 assert.equal(result.narrative.focus,bad.record.narrativeDelta.focus);
 const counterfeit=structuredClone(repair);counterfeit.record.experience.objects[0].id='person:other';
 await assert.rejects(run([{prose:authored},bad,counterfeit]),e=>e.code==='INVALID_MODEL_RESULT');
});

test('citation repair can also repair a separate invalid record instead of retaining a hidden validation failure',async()=>{
 const authored='门内的人举起灯。她望向你。',bad=record();
 bad.record.experience={clock:null,objects:[{id:'person:keeper',kind:'person',name:'门内的人',nameKnown:false,summary:'举灯',status:'在场',certainty:'confirmed',fields:[],relatedIds:[],quote:'她望向你。'}],stop:null,folded:[]};
 bad.record.game={entities:[{id:'place:door',kind:'place',name:'门',detail:'门边',status:'未知',value:null,max:null,unit:'',quote:'门上有金锁。'}],surfaces:[],spatial:null,journeys:null};
 const fixed=structuredClone(bad);fixed.record.experience.objects[0].quote=authored;fixed.record.game.entities[0].quote=authored;
 const {result,calls}=await run([{prose:authored},bad,fixed]);
 assert.equal(calls.length,3);assert.equal(result.game.entities[0].quote,authored);
 const stillBad=structuredClone(fixed);stillBad.record.game.entities[0].quote='门上有金锁。';
 await assert.rejects(run([{prose:authored},bad,stillBad]),e=>e.code==='INVALID_MODEL_RESULT');
});
test('geography still rejects display names as endpoint identifiers instead of silently accepting a broken map',async()=>{
 const authored='桥头的铁栏门关着，通往岗亭的小路到此为止。',bad=record();
 bad.record.game={entities:[{id:'place:gate',kind:'place',name:'桥头的铁栏门',detail:'小路到此为止。',status:'关闭',value:null,max:null,unit:'',quote:authored}],surfaces:[],spatial:{sites:[],relations:[{id:'path:gate',from:'渡口候船室',to:'place:gate',kind:'route',bearing:null,distanceMeters:null,passage:'unknown',bidirectional:true,label:'小路',quote:authored}]},journeys:null};
 await assert.rejects(run([{prose:authored},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT'&&e.diagnostic.reason==='空间关系字段无效。');
 const corrected=structuredClone(bad);corrected.record.game.spatial=null;
 const {result}=await run([{prose:authored},corrected]);assert.equal(result.game.entities[0].name,'桥头的铁栏门');assert.equal(result.game.spatial,null);
});
test('record repair cannot overwrite authored prose or invent evidence, and never reruns the author',async()=>{
 const bad=record();bad.record.events=[{type:'fact',entity:null,value:'医生到了',visibility:'player'}];bad.record.eventEvidence=[{index:0,quote:'医生到了'}];
 const {calls,result}=await run([{prose},bad,record()]);assert.equal(calls.length,3);assert.equal(calls[2].data.fixedProse,prose);assert.equal(calls[2].data.validationIssue,'事件证据必须逐项引用本轮原句。');assert.equal(result.prose,prose);
 await assert.rejects(run([{prose},bad,bad]),e=>e.code==='INVALID_MODEL_RESULT');
 const overwrite=record();overwrite.record.prose='被记录器改写的正文';await assert.rejects(run([{prose},overwrite,overwrite]),e=>e.code==='INVALID_MODEL_RESULT');
});
test('natural continuation commits generated prose with bookkeeping alone and no semantic approval contract',async()=>{
 const f=fixture(),branch=getBranch(f.session);
 f.body.input='让当前场景自然继续。';
 f.body.state.location='楼梯平台';
 f.body.state.facts=['医院后门从里面锁着。','后门已打开一道窄缝。','通道里的人开始沿墙靠近。'];
 const authored='通道里的人走到医院后门前，门内的人将手电照向他的伤口。你站在楼梯平台上，听见雨声从窄缝里传进来。';
 const extracted=record();
 extracted.record.events=[{type:'fact',entity:null,value:'通道里的人已经走到医院后门前。',visibility:'player'}];
 extracted.record.eventEvidence=[{index:0,quote:'通道里的人走到医院后门前，门内的人将手电照向他的伤口。'}];
 const {calls,result}=await run([{prose:authored},extracted,extracted],f.body);
 assert.equal(calls.length,2);assert.equal(result.prose,authored);
 assert.deepEqual(calls[1].options.schema.required,['record']);
 assert.deepEqual(Object.keys(calls[1].options.schema.properties),['record']);
 assert.equal(calls[1].options.schema.properties.record.type,'object');
 commitTurn(f.session,world,f.body.input,result);
 assert.equal(branch.turns.length,1);assert.equal(branch.turns[0].prose,authored);
 assert.ok(branch.turns[0].state.facts.includes('通道里的人已经走到医院后门前。'));
 validateArchive({schemaVersion:1,worlds:[world],sessions:[f.session]});
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
