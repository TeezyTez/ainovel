import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import * as pipeline from '../src/server-narrative.mjs';
const config = {available:true, contextBudget:24000, outputBudget:2400, timeoutMs:1000};
const body = () => ({requestId:'narrative-test',world:{id:'harbor',version:1,title:'雾港',location:'码头',opening:'林在修理坏掉的灯。',identity:'旅人',rules:['没有魔法'],characters:[{id:'lin',name:'林',public:'修灯人',secret:'怕黑'}]},state:{version:0,step:0,location:'码头',time:'开篇',facts:[],inventory:[],relations:{lin:'陌生'},flags:{},characters:{lin:{name:'林'}}},player:{name:'旅人',identity:'旅人'},preferences:{},memory:[],recent:[],input:'我递给林一把扳手。'});
const candidate = (id,kind='progress') => ({id,kind,methodId:'free',threadId:null,premise:'承接修灯',npcAction:'林决定试用工具',payoff:'灯修好了',leaveOpen:'今晚可以安心休息',sources:[{sourceId:'world',quote:'林在修理坏掉的灯。'}]});
const plan = () => ({worldKey:'harbor@1',baseVersion:0,preferredCandidateId:'repair',candidates:[candidate('repair'),{...candidate('rest','rest'),premise:'UNSELECTED_SECRET_CANDIDATE'}]});
const proposal = () => ({requestId:'narrative-test',baseVersion:0,prose:'林接过扳手，修好了灯。',events:[{type:'fact',entity:null,value:'灯已修好',visibility:'player'}],eventEvidence:[{index:0,quote:'林接过扳手，修好了灯。'}],suggestions:[],ended:true,experience:null,game:null,narrativeDelta:{focus:'修灯后的安静',beat:{kind:'progress',summary:'灯修好了',methodId:'free'},threads:[],opportunities:[]}});
test('private diagnostics distinguish schema, request identity, method, evidence, core and narrative without copying prose',async()=>{
 const cases=[
  {stage:'write-schema',modify:p=>{p.experience={clock:null,objects:[{bad:'PRIVATE_USER_TEXT'}],stop:null,folded:[]};}},
  {stage:'write-requestId',modify:p=>p.requestId='other'},
  {stage:'write-method',modify:p=>p.narrativeDelta.beat.methodId='different'},
  {stage:'write-evidence',modify:p=>p.eventEvidence[0].quote='PRIVATE_USER_TEXT'},
  {stage:'core-proposal',modify:p=>p.events[0]={type:'relation',entity:'absent',visibility:'player',value:'PRIVATE_USER_TEXT'}},
  {stage:'narrative',modify:p=>p.narrativeDelta.threads=[{id:'thread',question:'问题',stakes:'意义',status:'open',evidence:'PRIVATE_USER_TEXT'}]},
 ];
 for(const fixture of cases){const p=proposal();fixture.modify(p);await assert.rejects(run(body(),[plan(),p]),error=>{assert.equal(error.code,'INVALID_MODEL_RESULT');assert.equal(error.diagnostic.stage,fixture.stage);assert.equal(JSON.stringify(error.diagnostic).includes('PRIVATE_USER_TEXT'),false);assert.equal(JSON.stringify(error.diagnostic).includes(p.prose),false);return true;});}
 const p=plan();p.candidates[0].sources[0].quote='PRIVATE_USER_TEXT';await assert.rejects(run(body(),[p]),error=>{assert.equal(error.diagnostic.stage,'plan-evidence');assert.equal(JSON.stringify(error.diagnostic).includes('PRIVATE_USER_TEXT'),false);return true;});
});
test('bounded game quote repair keeps prose and business fields frozen and still rejects invented evidence',async()=>{
 const p=proposal();p.game={entities:[{id:'lamp',kind:'item',name:'修好的灯',detail:'一盏灯',status:'修好了',value:null,max:null,unit:'',quote:p.prose}],surfaces:[]};
 const repaired=structuredClone(p.game);repaired.entities[0].name='灯';
 const {result,calls}=await run(body(),[plan(),p,{game:repaired}]);assert.equal(calls.length,3);assert.equal(result.prose,p.prose);assert.deepEqual(result.events,[{type:'fact',value:'灯已修好',visibility:'player'}]);assert.equal(result.game.entities[0].name,'灯');assert.equal(calls[2].content.fixedProse,p.prose);assert.equal(calls[2].content.world,undefined);
 for(const mutate of [g=>g.entities=[],g=>g.entities[0].status='损坏',g=>g.entities[0].value=5]){const changed=structuredClone(repaired);mutate(changed);await assert.rejects(run(body(),[plan(),p,{game:changed}]),error=>error.diagnostic.stage==='game-repair-frozen');}
 const unchanged=structuredClone(p.game);await assert.rejects(run(body(),[plan(),p,{game:unchanged}]),error=>{assert.equal(error.diagnostic.rule,'gameEntityQuoteMissingName');assert.equal(error.diagnostic.repair,'failed');return true;});
 p.prose+='修好的灯摆在窗边。';
 const b=body();b.state.game={schemaVersion:1,entities:[{...p.game.entities[0],sourceVersion:0}],surfaces:[]};await assert.rejects(run(b,[plan(),p,{game:repaired}]),error=>error.diagnostic.stage==='game-repair-frozen');
 const known=body();known.state.experience={schemaVersion:1,clock:null,objects:[{id:'lamp',kind:'item',name:p.game.entities[0].name,summary:'一盏灯',status:'修好了',certainty:'confirmed',fields:[],relatedIds:[],quote:p.prose,sourceVersion:0}],stop:null,folded:[]};await assert.rejects(run(known,[plan(),p,{game:repaired}]),error=>error.diagnostic.stage==='game-repair-frozen');
 p.experience={clock:null,objects:[{id:'lamp',kind:'item',name:p.game.entities[0].name,summary:'一盏灯',status:'修好了',certainty:'confirmed',fields:[],relatedIds:[],quote:p.prose}],stop:null,folded:[]};const synced=await run(body(),[plan(),p,{game:repaired}]);assert.equal(synced.result.experience.objects[0].name,'灯');assert.equal(synced.result.experience.objects[0].id,'lamp');assert.equal(synced.result.experience.objects[0].quote,p.prose);assert.equal(synced.result.experience.objects[0].status,'修好了');
});
test('game repair shares the original deadline and makes at most one repair call',async()=>{
 const p=proposal();p.game={entities:[{id:'lamp',kind:'item',name:'修好的灯',detail:'灯',status:'修好了',value:null,max:null,unit:'',quote:p.prose}],surfaces:[]};let calls=0;const budgets=[],started=Date.now();
 await assert.rejects(pipeline.generateNarrative(body(),{...config,timeoutMs:50},new AbortController().signal,{requestJSON:async(c)=>{budgets.push(c.timeoutMs);calls++;if(calls<3){await delay(8);return calls===1?plan():p;}await delay(100);return {game:p.game};}}),error=>error.code==='TIMEOUT');
 assert.equal(calls,3);assert.ok(budgets[2]<budgets[0]);assert.ok(Date.now()-started<200);
});
async function run(input=body(), responses=[plan(),proposal()], overrides={}) {
  assert.equal(typeof pipeline.generateNarrative,'function','narrative pipeline must exist');
  const calls=[];
  const result=await pipeline.generateNarrative(input,{...config,...overrides},new AbortController().signal,{requestJSON:async(c,system,content,signal,options)=>{calls.push({c,system,content:JSON.parse(content),signal,options});return structuredClone(responses[calls.length-1]);}});
  return {result,calls};
}

test('agency boilerplate triggers one whole-draft revision before any commit, preserving authoritative input',async()=>{
 const bad=proposal();bad.prose+='\n\n她没有替你作答，也没有催你再来一次，只站在不妨碍你的位置，等着你开口。';
 const fixed=proposal();fixed.prose='林把修好的灯挂到窗外，渡船在光里靠岸了。';fixed.events[0].value='修好的灯已挂到窗外，渡船靠岸';fixed.eventEvidence[0].quote=fixed.prose;
 const b=body(),before=JSON.stringify(b),{result,calls}=await run(b,[plan(),bad,fixed]);
 assert.equal(calls.length,3);assert.equal(calls[2].content.stage,'write-revision');
 assert.deepEqual(calls[2].content.state,b.state);assert.equal(calls[2].content.input,b.input);
 assert.equal(calls[2].content.revision.draft.prose,bad.prose);assert.equal(result.prose,fixed.prose);
 assert.deepEqual(result.events,[{type:'fact',value:fixed.events[0].value,visibility:'player'}]);
 assert.equal(JSON.stringify(b),before);assert.ok(calls[2].c.timeoutMs<=calls[1].c.timeoutMs);
});

test('a persistently defective draft fails after one revision; revised facts still need new prose evidence',async()=>{
 const bad=proposal();bad.prose+='她没有替你作答，只等着你开口。';
 await assert.rejects(run(body(),[plan(),bad,bad]),e=>e.diagnostic?.stage==='write-craft');
 const wrong=proposal();wrong.eventEvidence[0].quote='只在旧草稿里出现的内容';
 await assert.rejects(run(body(),[plan(),bad,wrong]),e=>e.diagnostic?.stage==='write-evidence');
});

test('concrete dialogue, a legitimate handoff and a quiet ending do not trigger stylistic retry',async()=>{
 for(const ending of ['“别替我作答。”林合上账本，把属于你的那一页撕下来。','林问：“这份契约，你签不签？”','她坐在门边等着你回来，灯已经修好了。']){
  const p=proposal();p.prose+='\n'+ending;const {calls}=await run(body(),[plan(),p]);assert.equal(calls.length,2);
 }
});

test('cancelling a craft revision returns no proposal and does not start another model call',async()=>{
 const controller=new AbortController(),b=body(),before=JSON.stringify(b);let calls=0;
 const bad=proposal();bad.prose+='她没有替你作答。';
 await assert.rejects(pipeline.generateNarrative(b,config,controller.signal,{requestJSON:async()=>{
  calls++;if(calls===1)return plan();if(calls===2)return bad;controller.abort();return proposal();
 }}),e=>e.code==='CANCELLED');
 assert.equal(calls,3);assert.equal(JSON.stringify(b),before);
});

test('missing an established full name revises the unpublished draft rather than renaming history or inventing a quote',async()=>{
 const b=body(),p=proposal();
 const entity={id:'lamp',kind:'item',name:'航标灯',detail:'码头的灯',status:'已修好',value:null,max:null,unit:'',quote:p.prose};
 b.state.game={schemaVersion:1,entities:[{...entity,status:'待修理',sourceVersion:0}],surfaces:[]};p.game={entities:[entity],surfaces:[]};
 const fixed=structuredClone(p);fixed.prose='林接过扳手，修好了航标灯。';fixed.game.entities[0].quote=fixed.prose;fixed.eventEvidence[0].quote=fixed.prose;
 const {result,calls}=await run(b,[plan(),p,fixed]);
 assert.equal(calls.length,3);assert.deepEqual(calls[2].content.revision.anchors,[{id:'lamp',name:'航标灯'}]);
 assert.equal(result.game.entities[0].name,'航标灯');assert.equal(result.prose,fixed.prose);
});
test('two-stage pipeline exposes only committed prose and narrative and keeps unselected candidates private',async()=>{
  const {result,calls}=await run();
  assert.equal(calls.length,2);
  assert.equal(result.narrative.turn,1);
  assert.deepEqual(result.events,[{type:'fact',value:'灯已修好',visibility:'player'}]);
  assert.equal(result.plan,undefined);assert.equal(result.narrativeDelta,undefined);assert.equal(result.eventEvidence,undefined);
  assert.ok(!JSON.stringify(calls[1].content).includes('UNSELECTED_SECRET_CANDIDATE'));
  assert.deepEqual(calls[1].content.state,body().state);
  assert.deepEqual(calls[1].content.selectedScene.evidence,['林在修理坏掉的灯。']);
  assert.equal(calls[1].content.selectedScene.sources,undefined);
  assert.equal(calls[0].options.schema.additionalProperties,false);
  assert.equal(calls[0].options.schema.properties.candidates.minItems,2);
  assert.equal(calls[0].options.schema.properties.candidates.maxItems,2);
  assert.ok(calls[1].options.schema.required.includes('narrativeDelta'));
  assert.equal(calls[0].content.direction.maxNewThreads,1);
  assert.deepEqual(calls[0].content.direction,calls[1].content.direction);
});

test('candidate selection avoids repeating a committed payoff even if labeled payoff',async()=>{
  const b=body();b.recent=[{prose:'林接过扳手，修好了灯。'}];
  const p=plan();p.candidates[0].kind='payoff';p.candidates[0].payoff='林接过扳手，修好了灯。';
  p.candidates[1]={...candidate('consequence'),payoff:'林把灯挂到窗外，让晚归的人辨认渡口。'};
  const {calls}=await run(b,[p,proposal()]);
  assert.equal(calls[1].content.selectedScene.id,'consequence');
});

test('planner preference can choose a consequential scene over a nominal small payoff; unknown choices fail closed',async()=>{
 const p=plan();p.candidates[0].kind='payoff';p.preferredCandidateId='rest';p.candidates[1].kind='progress';
 const {calls}=await run(body(),[p,proposal()]);assert.equal(calls[1].content.selectedScene.id,'rest');
 p.preferredCandidateId='invented';await assert.rejects(run(body(),[p]),e=>e.diagnostic?.stage==='plan-choice');
});
test('unknown presentation kind falls back to public text without executing its actions',async()=>{
 const p=proposal();p.game={entities:[],surfaces:[{id:'odd-view',kind:'unknown-widget',title:'此刻',description:'林修好了灯。',entityIds:[],links:[],actions:[],quote:'林接过扳手，修好了灯。'}]};
 const {result}=await run(body(),[plan(),p]);assert.equal(result.game.surfaces[0].kind,'interaction');assert.deepEqual(result.game.surfaces[0].actions,[]);assert.match(result.game.surfaces[0].description,/文字/);
});
test('planned writer requires experience and preserves evidenced clocks with one-shot controls',async()=>{
  const b=body();b.control={kind:'wait',goal:'等修完灯',until:'林交回扳手',limit:'傍晚',forbidden:'不借钱',reserved:'交回时我回答'};
  const p=proposal();p.prose+='过了半小时，已到傍晚。';p.experience={clock:{label:'傍晚',elapsed:'过了半小时',precision:'approximate',quote:'过了半小时，已到傍晚。'},objects:[],stop:null,folded:[]};
  const {result,calls}=await run(b,[plan(),p]);assert.equal(result.experience.clock.label,'傍晚');assert.deepEqual(calls[0].content.control,b.control);assert.deepEqual(calls[1].content.control,b.control);assert.ok(calls[1].options.schema.required.includes('experience'));assert.match(calls[1].system,/最早遇到接手条件/);
  p.experience.clock.quote='没有发生';await assert.rejects(run(b,[plan(),p]),e=>e.code==='INVALID_MODEL_RESULT');
});
test('literal source witnesses support multiline original text rather than JSON-escaped artifacts',async()=>{
  const b=body();b.world.opening='林在修理坏掉的灯。\n他已经接好了线。';
  const p=plan();p.candidates.forEach(c=>c.sources[0].quote=b.world.opening);
  const {result}=await run(b,[p,proposal()]);assert.equal(result.narrative.turn,1);
});
test('planner rejects nonexistent, off-world, unwitnessed and opportunity-as-fact sources before writing',async()=>{
  assert.equal(typeof pipeline.generateNarrative,'function');
  for(const modify of [p=>p.candidates[0].sources[0].sourceId='memory:99',p=>p.worldKey='elsewhere@1',p=>p.candidates[0].sources[0].quote='天降宝箱',p=>p.candidates[0].sources[0].sourceId='opportunity:secret',p=>p.candidates[0].sources=[],p=>p.candidates[1]={...p.candidates[0],id:'another'},p=>p.extra='system override']) {
    const p=plan();modify(p);let calls=0;
    await assert.rejects(pipeline.generateNarrative(body(),config,new AbortController().signal,{requestJSON:async()=>{calls++;return p;}}),e=>e.code==='INVALID_NARRATIVE_PLAN');
    assert.equal(calls,1);
  }
});
test('two concretely different payoffs need not have different beat kinds',async()=>{
  const p=plan();p.candidates[1].kind='progress';p.candidates[1].npcAction='林决定先教邻居换灯罩';
  const {result}=await run(body(),[p,proposal()]);assert.equal(result.prose,'林接过扳手，修好了灯。');
});
test('an inexact extra citation is discarded while verified evidence remains the only writer source',async()=>{
  const p=plan();p.candidates[0].sources.push({sourceId:'state',quote:'a paraphrase that was never recorded'});
  const {calls}=await run(body(),[p,proposal()]);
  assert.deepEqual(calls[1].content.selectedScene.evidence,['林在修理坏掉的灯。']);
  assert.ok(!JSON.stringify(calls[1].content.selectedScene).includes('a paraphrase'));
});
test('declining one direction does not force rest while the player pursues another action',async()=>{
  const b=body();b.input='我不去码头，继续帮林修灯。';
  const {calls}=await run(b);assert.equal(calls[1].content.selectedScene.id,'repair');
});
test('public event changes require unique exact prose witnesses while private events stay private',async()=>{
  for(const evidence of [undefined,[],[{index:0,quote:'不存在的原句'}],[{index:40,quote:'修好了灯'}],[{index:0,quote:'修好了灯'},{index:0,quote:'修好了灯'}]]) {
    const p=proposal();if(evidence===undefined)delete p.eventEvidence;else p.eventEvidence=evidence;
    await assert.rejects(run(body(),[plan(),p]),e=>e.code==='INVALID_MODEL_RESULT');
  }
  const p=proposal();p.events.push({type:'fact',entity:null,value:'林悄悄放下防备',visibility:'hidden'},{type:'flag',entity:'harbor:fixed',value:true,visibility:'player'});
  const {result}=await run(body(),[plan(),p]);assert.equal(result.events.length,3);
});
test('writer must witness thread changes in actual prose and satisfy existing proposal contract',async()=>{
  for(const modify of [p=>p.narrativeDelta.threads=[{id:'light',question:'灯能修好吗？',stakes:'照明',status:'open',evidence:'没有出现在正文的原句'}],p=>p.events[0]={type:'relation',entity:'unknown',value:'信任',visibility:'player'},p=>p.narrativeDelta.beat.methodId='unretrieved',p=>p.requestId='other-request']) {
    const p=proposal();modify(p);
    await assert.rejects(run(body(),[plan(),p]),e=>e.code==='INVALID_MODEL_RESULT');
  }
});
test('legacy requests without narrative recover from current turn instead of resetting history',async()=>{
  const b=body();b.state.version=7;b.state.step=7;
  const p=plan();p.baseVersion=7;const out=proposal();out.baseVersion=7;
  const {result}=await run(b,[p,out]);assert.equal(result.narrative.turn,8);assert.equal(result.narrative.worldKey,'harbor@1');
});
test('both stage contexts preserve authority and evict oldest optional history before exceeding complete budget',async()=>{
  const b=body();b.recent=[{prose:'OLD'.repeat(10000)},{prose:'NEW'}];b.memory=[{sourceTurn:'t1',summary:'remember me'}];
  const {calls}=await run(b);
  for(const call of calls){assert.deepEqual(call.content.world,b.world);assert.deepEqual(call.content.state,b.state);assert.equal(call.content.input,b.input);assert.equal(call.content.recent.some(t=>t.prose.startsWith('OLD')),false);assert.ok(call.system.length+JSON.stringify(call.content).length+JSON.stringify(call.options.schema).length+call.c.outputBudget+256<=call.c.contextBudget);}
});
test('mandatory authority exceeding budget fails before any model call',async()=>{
  assert.equal(typeof pipeline.generateNarrative,'function');let calls=0;const b=body();b.world.opening='不可丢弃'.repeat(10000);
  await assert.rejects(pipeline.generateNarrative(b,config,new AbortController().signal,{requestJSON:async()=>{calls++;return plan();}}),e=>e.code==='CONTEXT_TOO_LARGE');assert.equal(calls,0);
});
test('cancel during planner prevents writer and cancellation is not silently downgraded',async()=>{
  assert.equal(typeof pipeline.generateNarrative,'function');let calls=0;const controller=new AbortController();
  await assert.rejects(pipeline.generateNarrative(body(),config,controller.signal,{requestJSON:async()=>{calls++;controller.abort();return plan();}}),e=>e.code==='CANCELLED');assert.equal(calls,1);
});
test('planner and writer share one timeout even if a transport ignores the abort signal',async()=>{
  assert.equal(typeof pipeline.generateNarrative,'function');let calls=0;let secondBudget;
  await assert.rejects(pipeline.generateNarrative(body(),{...config,timeoutMs:80},new AbortController().signal,{requestJSON:async c=>{calls++;if(calls===1){await delay(45);return plan();}secondBudget=c.timeoutMs;await delay(60);return proposal();}}),e=>e.code==='TIMEOUT');
  assert.equal(calls,2);assert.ok(secondBudget<60);
});
test('retrieval prioritizes overdue threads, avoids recent methods, and remains bounded',async()=>{
  const module=await import('../src/story-methods.mjs').catch(()=>({}));assert.equal(typeof module.selectStoryMethods,'function');
  const b=body();b.state.version=8;b.narrative={threads:[{id:'lamp',status:'open',openedAt:1,updatedAt:1}],recentBeats:[]};
  let selected=module.selectStoryMethods(b);assert.ok(selected.some(m=>m.id==='earned-payoff'));assert.ok(selected.length<=3);
  b.narrative.recentBeats=[{methodId:'earned-payoff'},{methodId:'earned-payoff'}];selected=module.selectStoryMethods(b);assert.notEqual(selected[0].id,'earned-payoff');
  b.narrative.recentBeats=[];b.narrative.threads[0].updatedAt=8;b.narrative.threads[0].status='progressed';
  selected=module.selectStoryMethods(b);assert.equal(selected[0].id,'earned-payoff','tiny recent progress must not erase an old unanswered promise');
  b.input='我拒绝邀约，回家休息。';selected=module.selectStoryMethods(b);assert.ok(selected.some(m=>m.id==='quiet-aftermath'));
});

test('a successful scene does not automatically put the next scene into quiet aftermath',async()=>{
 const {selectStoryMethods}=await import('../src/story-methods.mjs');const b=body();b.input='继续';
 b.narrative={threads:[],recentBeats:[{kind:'payoff',methodId:'free',summary:'能力被目击'}]};
 assert.notEqual(selectStoryMethods(b)[0].id,'quiet-aftermath');
 b.input='我回家休息。';assert.equal(selectStoryMethods(b)[0].id,'quiet-aftermath');
});
