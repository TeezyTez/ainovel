// Explicit live evaluation; isolated in-memory sessions, never browser/localStorage saves.
// node scripts/verify-narrative.mjs --live
// node scripts/verify-narrative.mjs --live --worlds mystery --turns 3 --baseline-worlds all
// No --live: validate original fixtures and print the bounded execution plan, no model calls.
import assert from 'node:assert/strict';
import {mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createSession, currentState, getBranch, commitTurn, clone, validateWorld, applyEvents} from '../src/core.js';
import {selectContext} from '../src/experience.js';
import {NARRATIVE_FIXTURES, REVIEW_LIMITATIONS} from './narrative-fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Usage: node scripts/verify-narrative.mjs [--live] [--worlds mystery,quiet,serial] [--turns 1..3]
       [--engines planned,direct] [--baseline-worlds mystery|all|none] [--label NAME]
Default: planned 2 worlds × 3 turns, direct mystery × 3 turns; at most 15 model calls.
--baseline-worlds only filters direct arms. Set all for both direct baselines (18 calls).
Without --live, this only validates fixtures and prints the plan. Live uses local .env
and modelConfig with the existing configured transport; it does not start the app.
Complete local request/result/session records are saved to test-results/narrative-*.json.
No automatic retries; a failed turn stops its story arm, and other arms still run.`;

export function parseOptions(args) {
  const options = {live:false, worlds:['mystery','quiet'], turns:3, engines:['planned','direct'], baselineWorlds:['mystery'], label:'comparison'};
  for (let i=0; i<args.length; i++) {
    const key=args[i];
    if (key==='--help') return {...options, help:true};
    if (key==='--live') {options.live=true;continue;}
    assert.ok(['--worlds','--turns','--engines','--baseline-worlds','--label'].includes(key), `Unknown option ${key}`);
    const value=args[++i]; assert.ok(value&&!value.startsWith('--'), `Missing value for ${key}`);
    if(key==='--worlds') options.worlds=value.split(',');
    if(key==='--engines') options.engines=value.split(',');
    if(key==='--baseline-worlds') options.baselineWorlds=value==='all'?'all':value==='none'?[]:value.split(',');
    if(key==='--turns') options.turns=Number(value);
    if(key==='--label') options.label=value;
  }
  const ids=NARRATIVE_FIXTURES.map(f=>f.id);
  assert.ok(options.worlds.length&&options.worlds.every(id=>ids.includes(id))&&new Set(options.worlds).size===options.worlds.length,`Worlds must be a unique list of ${ids.join(',')}`);
  assert.ok(options.engines.length&&options.engines.every(id=>['planned','direct'].includes(id))&&new Set(options.engines).size===options.engines.length,'Engines must be a unique list of planned,direct');
  assert.ok(options.baselineWorlds==='all'||options.baselineWorlds.every(id=>ids.includes(id)),'Unknown baseline world');
  assert.ok(Number.isInteger(options.turns)&&options.turns>=1&&options.turns<=3,'Turns must be 1..3 (the fixture sequence is deliberately bounded)');
  assert.match(options.label,/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/,'Label must be a short filename-safe label');
  return options;
}

export function executionPlan(options) {
  return options.worlds.flatMap(id=>options.engines.filter(engine=>engine!=='direct'||options.baselineWorlds==='all'||options.baselineWorlds.includes(id)).map(engine=>({fixture:id,engine,turns:options.turns,maxModelCalls:options.turns*(engine==='planned'?2:1)})));
}

function inspectCommit(session, fixture, request, result, previousNarrative, validateNarrative) {
  const checks=[];
  const check=(name,fn)=>{try{fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,detail:error.message});}};
  const branch=getBranch(session), turn=branch.turns.at(-1), state=currentState(session);
  check('request/version match',()=>{assert.equal(result.requestId,request.requestId);assert.equal(result.baseVersion,request.state.version);assert.equal(state.version,request.state.version+1);});
  check('committed state equals event and experience application',()=>assert.deepEqual(state,applyEvents(request.state,result.events,result.experience,{game:result.game,gameAction:result.gameAction,branchId:branch.id})));
  check('events and memory have committed turn/branch sources',()=>{assert.ok(turn.events.every(e=>e.sourceTurn===turn.id&&e.branchId===branch.id));assert.equal(turn.memory.sourceTurn,turn.id);assert.equal(turn.memory.branchId,branch.id);});
  check('flags are world scoped and have event provenance',()=>{
    assert.ok(Object.keys(state.flags).every(key=>key.startsWith(fixture.world.id+':')));
    const expected={...branch.initialState.flags};
    for(const item of branch.turns)for(const event of item.events)if(event.type==='flag')expected[event.entity]=event.value;
    assert.deepEqual(state.flags,expected);
  });
  check('fixed source flags remain unchanged',()=>{for(const [key,value] of Object.entries(fixture.protectedFlags))assert.equal(state.flags[key],value,key);});
  if(result.narrative) {
    check('narrative schema/world/turn',()=>validateNarrative(result.narrative,state.version,branch.worldKey));
    check('narrative committed with prose and events',()=>assert.deepEqual(turn.narrative,result.narrative));
    check('new or updated thread evidence occurs in this prose',()=>{
      for(const thread of result.narrative.threads)if(thread.updatedAt===state.version)assert.ok(result.prose.includes(thread.evidence),`Missing evidence for ${thread.id}`);
    });
    check('resolved/retired threads never reopen',()=>{
      for(const old of previousNarrative?.threads||[])if(['resolved','retired'].includes(old.status)) {
        const next=result.narrative.threads.find(item=>item.id===old.id);
        if(next)assert.equal(next.status,old.status,old.id);
      }
    });
  }
  return checks;
}

export async function runStory(fixture, engine, options, dependencies, onProgress=async()=>{}) {
  const {generators, config, validateRequest, narrativeForBranch, validateNarrative, signal}=dependencies;
  const world=clone(fixture.world), session=createSession(world,{name:'旅人'},'real');
  session.preferences={...session.preferences,participation:'act',length:'适中',pace:'从容',style:'细腻克制'};
  getBranch(session).initialState.flags=clone(fixture.protectedFlags);
  const arm={fixture:fixture.id,engine,world,initialState:clone(currentState(session)),preferences:clone(session.preferences),reviewChecklist:fixture.review,turns:[],status:'running',firstEndedTurn:null,afterEndedPolicy:'Continue the fixed input sequence deliberately. Turns after the first ended=true bypass the UI ending marker and are stress tests, not ordinary uninterrupted play.',session};
  await onProgress(arm);
  for(const step of fixture.steps.slice(0,options.turns)) {
    if(signal.aborted){arm.status='cancelled';break;}
    const branch=getBranch(session), narrative=narrativeForBranch(branch);
    const request=validateRequest({requestId:randomUUID(),world,state:clone(currentState(session)),player:clone(session.player),preferences:clone(session.preferences),...selectContext(branch,step.input),input:step.input,...(narrative?{narrative:clone(narrative)}:{})});
    const before=JSON.stringify(session), started=performance.now();
    const record={turn:arm.turns.length+1,kind:step.kind,input:step.input,request,startedAt:new Date().toISOString(),afterEndedStressTest:arm.firstEndedTurn!==null,firstEndedTurnBeforeRequest:arm.firstEndedTurn,ended:null,stageCalls:[]};
    arm.turns.push(record);
    await onProgress(arm); // Persist the in-flight request before starting a model call.
    try {
      const onStage=async stage=>{
        const index=record.stageCalls.findIndex(item=>item.index===stage.index);
        if(index<0)record.stageCalls.push(clone(stage));else record.stageCalls[index]=clone(stage);
        await onProgress(arm);
      };
      const result=await generators[engine](request,config,signal,{onStage});
      record.elapsedMs=Math.round(performance.now()-started);
      record.result=clone(result);
      record.ended=!!result.ended;
      if(engine==='planned')assert.ok(result.narrative,'Planned generator omitted narrative snapshot');
      commitTurn(session,world,step.input,result);
      if(record.ended&&arm.firstEndedTurn===null)arm.firstEndedTurn=record.turn;
      record.committedTurn=clone(getBranch(session).turns.at(-1));
      record.checks=inspectCommit(session,fixture,request,result,narrative,validateNarrative);
      record.status=record.checks.every(check=>check.passed)?'accepted':'structural-failure';
      if(record.status!=='accepted'){arm.status='failed';await onProgress(arm);break;}
    } catch(error) {
      record.elapsedMs=Math.round(performance.now()-started);
      record.status='failed';
      // Do not serialize stack/config/env: transport errors may include private paths.
      record.error={name:error.name,code:error.code||'EVALUATION_ERROR',message:error.message};
      record.failureLeftSessionUnchanged=JSON.stringify(session)===before;
      arm.status=signal.aborted?'cancelled':'failed';
      await onProgress(arm);break;
    }
    await onProgress(arm);
  }
  if(arm.status==='running')arm.status='completed';
  arm.elapsedMs=arm.turns.reduce((total,turn)=>total+(turn.elapsedMs||0),0);
  arm.ledger=clone(getBranch(session).turns.map(turn=>({id:turn.id,input:turn.input,prose:turn.prose,events:turn.events,state:turn.state,narrative:turn.narrative??null,ended:turn.ended})));
  await onProgress(arm);
  return arm;
}

async function main() {
  const options=parseOptions(process.argv.slice(2));
  if(options.help){console.log(HELP);return;}
  for(const fixture of NARRATIVE_FIXTURES)validateWorld(fixture.world);
  const plan=executionPlan(options);assert.ok(plan.length,'No story arms selected');
  console.log(JSON.stringify({live:options.live,plan,maxModelCalls:plan.reduce((sum,arm)=>sum+arm.maxModelCalls,0),limitations:REVIEW_LIMITATIONS},null,2));
  if(!options.live){console.log(HELP);return;}
  try{process.loadEnvFile(resolve(ROOT,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const {generate,modelConfig,validateRequest,requestModelJSON}=await import('../src/server-model.mjs');
  const {generateNarrative}=await import('../src/server-narrative.mjs');
  const {narrativeForBranch,validateNarrative}=await import('../src/narrative-state.js');
  const config=modelConfig(process.env);assert.ok(config.available,'Configure the local model before --live; no fallback is used');
  const controller=new AbortController(), cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  const timestamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
  const file=resolve(ROOT,'test-results',`narrative-${options.label}-${timestamp}-${randomUUID().slice(0,8)}.json`);
  await mkdir(dirname(file),{recursive:true});
  const report={schemaVersion:1,startedAt:new Date().toISOString(),options,plan,model:{provider:config.provider,model:config.model,timeoutMs:config.timeoutMs,contextBudget:config.contextBudget,outputBudget:config.outputBudget},limitations:REVIEW_LIMITATIONS,arms:[]};
  const plannedWithTrace=(body,modelSettings,signal,{onStage})=>{
    let index=0;
    return generateNarrative(body,modelSettings,signal,{requestJSON:async(settings,system,content,stageSignal,transportOptions)=>{
      let parsedContent;try{parsedContent=JSON.parse(content);}catch{parsedContent=content;}
      const stage={index:++index,stage:parsedContent?.stage||'unknown',system,content:parsedContent,startedAt:new Date().toISOString(),status:'running'};
      const started=performance.now();
      await onStage(stage);
      try {
        const rawResult=await requestModelJSON(settings,system,content,stageSignal,transportOptions);
        stage.rawResult=clone(rawResult);stage.status='completed';return rawResult;
      } catch(error) {
        stage.status='failed';stage.error={name:error.name,code:error.code||'MODEL_ERROR',message:error.message};throw error;
      } finally {stage.elapsedMs=Math.round(performance.now()-started);await onStage(stage);}
    }});
  };
  const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(report,null,2));await rename(file+'.tmp',file);};
  await save();
  console.log(`Evidence file: ${file}`);
  try {
    for(const item of plan) {
      if(controller.signal.aborted)break;
      const fixture=NARRATIVE_FIXTURES.find(f=>f.id===item.fixture);
      let registered=false,lastReportedTurn=0;
      await runStory(fixture,item.engine,options,{generators:{direct:generate,planned:plannedWithTrace},config,validateRequest,narrativeForBranch,validateNarrative,signal:controller.signal},async arm=>{
        if(!registered){report.arms.push(arm);registered=true;}
        await save();
        const turn=arm.turns.at(-1);
        if(turn?.status&&turn.turn>lastReportedTurn){
          lastReportedTurn=turn.turn;
          console.log(JSON.stringify({fixture:arm.fixture,engine:arm.engine,turn:turn.turn,status:turn.status,ended:turn.ended,afterEndedStressTest:turn.afterEndedStressTest,elapsedMs:turn.elapsedMs,checks:turn.checks,error:turn.error,prose:turn.result?.prose,narrative:turn.result?.narrative},null,2));
        }
      });
    }
  } finally {
    report.finishedAt=new Date().toISOString();
    report.status=controller.signal.aborted?'cancelled':report.arms.every(arm=>arm.status==='completed')?'completed':'failed';
    report.summary=report.arms.map(arm=>({fixture:arm.fixture,engine:arm.engine,status:arm.status,acceptedTurns:arm.turns.filter(t=>t.status==='accepted').length,elapsedMs:arm.elapsedMs,turnLatenciesMs:arm.turns.map(t=>t.elapsedMs),ended:arm.ledger?.at(-1)?.ended??null,firstEndedTurn:arm.firstEndedTurn,afterEndedStressTestTurns:arm.turns.filter(t=>t.afterEndedStressTest).map(t=>t.turn),stageLatenciesMs:arm.turns.map(t=>({turn:t.turn,stages:t.stageCalls.map(s=>({stage:s.stage,elapsedMs:s.elapsedMs,status:s.status}))}))}));
    await save();
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    console.log(JSON.stringify({file,status:report.status,summary:report.summary,reminder:'Structural acceptance is not a literary-quality score. Read the complete prose against each review checklist.'},null,2));
    if(report.status!=='completed')process.exitCode=1;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
