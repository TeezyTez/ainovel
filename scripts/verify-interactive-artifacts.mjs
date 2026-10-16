// Live acceptance evidence. Uses only temporary ledgers; never imports a player archive.
// Usage: node scripts/verify-interactive-artifacts.mjs --live | --dry-run
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createSession,validateArchive} from '../src/core.js';
import {canonical,validateDefinition} from '../src/dynamic-rules.js';
import {modelConfig} from '../src/server-model.mjs';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {dynamicModel,DYNAMIC_PROMPT_VERSION} from '../src/server-dynamic-model.mjs';

function stepMetrics(traces,totalDurationMs){
  const modelCalls={prepare:0,judge:0};let generationDurationMs=0,reviewDurationMs=0;
  for(const trace of traces){
    modelCalls[trace.kind]=(modelCalls[trace.kind]??0)+1;
    if(trace.kind==='prepare')generationDurationMs+=trace.durationMs;
    if(trace.kind==='judge')reviewDurationMs+=trace.durationMs;
  }
  return {durationMs:totalDurationMs,totalDurationMs,modelCalls,generationDurationMs,reviewDurationMs};
}
function assertReadOnlyStep(saved,metrics){
  assert.equal(saved.definition?.actions?.length??0,0,'This read-only benchmark must not generate executable actions.');
  assert.equal(metrics.modelCalls.judge,0,'Read-only and sandbox presentations must not call judge.');
}
function dryRun(){
  const failures=[];
  const check=(name,run)=>{try{run();}catch(error){failures.push({name,error:error.message});}};
  check('each step counts only its own calls, including bounded repairs',()=>{
    const traces=[{kind:'prepare',durationMs:100},{kind:'judge',durationMs:40},{kind:'prepare',durationMs:70},{kind:'prepare',durationMs:30}];
    assert.deepEqual(stepMetrics(traces.slice(2),115),{durationMs:115,totalDurationMs:115,modelCalls:{prepare:2,judge:0},generationDurationMs:100,reviewDurationMs:0});
    assert.deepEqual(stepMetrics(traces.slice(0,2),145),{durationMs:145,totalDurationMs:145,modelCalls:{prepare:1,judge:1},generationDurationMs:100,reviewDurationMs:40});
  });
  check('read-only and sandbox scenarios reject a separate model review',()=>{
    assert.throws(()=>assertReadOnlyStep({definition:{actions:[]}},{modelCalls:{prepare:1,judge:1}}),/judge/);
    assertReadOnlyStep({definition:{actions:[]}},{modelCalls:{prepare:1,judge:0}});
    assertReadOnlyStep({definition:null},{modelCalls:{prepare:1,judge:0}});
  });
  check('the read-only benchmark cannot silently become an executable scenario',()=>{
    assert.throws(()=>assertReadOnlyStep({definition:{actions:[{mode:'rule'}]}},{modelCalls:{prepare:1,judge:0}}),/read-only/);
  });
  assert.deepEqual(failures,[],'Offline metric and review-policy checks failed.');
  console.log(JSON.stringify({mode:'dry-run',passed:true,checks:3,modelCallsMade:0}));
}
if(process.argv.length===3&&process.argv[2]==='--dry-run'){dryRun();process.exit(0);}
assert.deepEqual(process.argv.slice(2),['--live'],'Pass --live to call the configured real model.');
try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
const config=modelConfig(process.env);
assert.ok(config.available,'The configured real model is unavailable.');
config.timeoutMs=Math.min(config.timeoutMs,180000);
const output=resolve('test-results','interactive-live-'+new Date().toISOString().replaceAll(':','-'));
const ledgerDirectory=await mkdtemp(join(tmpdir(),'elselife-interactive-live-'));
const owner='isolated-interactive-live',results=[];
const safeText=value=>config.key?String(value).replaceAll(config.key,'[REDACTED]'):String(value);
const json=value=>JSON.stringify(value,(_key,item)=>typeof item==='string'?safeText(item):item,2);
const saveJSON=(file,value)=>writeFile(file,json(value));
const files=['src/server-dynamic.mjs','src/server-dynamic-model.mjs','src/dynamic-rules.js','src/server-interactive-artifact.mjs','src/interactive-artifact.js','src/interactive-runtime.js'];
async function sourceHash(){const hash=createHash('sha256');for(const file of files)hash.update(file).update(await readFile(file));return hash.digest('hex');}
const manifest={mode:'live',promptVersion:DYNAMIC_PROMPT_VERSION,model:config.model,provider:config.provider,transport:config.kind??'openai-compatible',startedAt:new Date().toISOString(),ledger:ledgerDirectory,sourceFiles:files,initialSourceHash:await sourceHash(),timeoutMs:config.timeoutMs,cases:results};
await mkdir(output,{recursive:true});await saveJSON(join(output,'manifest.json'),manifest);
console.log(json({evidence:output,provider:config.provider,model:config.model,promptVersion:DYNAMIC_PROMPT_VERSION,timeoutMs:config.timeoutMs}));

const scenarios=[
  {id:'auto-routes',title:'三条未确认路线的自动比较',opening:'撤离前，你把三份公开路线说明铺在桌上，需要比较来源、限制和待核事项再决定。东桥路线是守桥人今早亲口说的：桥面还在维修，能否通行要等他回复；山径路线是你刚才亲眼看见的：入口干燥，深处坡道尚未探查；河岸路线是两天前的一封旧信写的：当时有船接应，现在船是否还在并不知道。三条路都有缺少确认的条件，当前没有哪条路线被保证安全，也没有确定的通行耗时。你暂时没有选择或出发。',expect:'definition'},
  {id:'allocation',title:'可拖动的分配试算',opening:'你在避雨处清点出12份干粮，尚未分配。同行的是你、阿青和老陈，三人都在场；没有人已经领取干粮，也没有确定的个人配额。你可以先做假设试算，但真正分发还需你单独提出行动。当前没有其他干粮来源，也没有已知的每人消耗率。',intent:'做一个可以拖动数量、实时看剩余的分配试算。先只试算，不分发；保留可修改的数量。',expect:'interactive',stock:12},
  {id:'quiet',title:'安静阅读无需界面',opening:'雨声落在屋檐上。你安静地读着旧书，窗外的树影缓缓摇动。此刻没有需要决定、比较、整理或操作的事项，只需继续安静阅读。',expect:'none'}
];
function storySnapshot(data,branch){return canonical({turns:branch.turns,initialState:branch.initialState,worlds:data.worlds,draft:branch.draft,readingPosition:branch.readingPosition});}
function viewNodes(nodes){return Array.isArray(nodes)?nodes.flatMap(node=>node&&typeof node==='object'?[node,...viewNodes(node.children)]:[]):[];}
function checkResult(saved,scenario,state){
  assert.equal(saved.reason,'','Model or validation fallback occurred.');
  if(scenario.expect==='none'){assert.equal(saved.definition,null,'Quiet reading unexpectedly created an interface.');return {decision:'none'};}
  assert.ok(saved.definition,'The model did not produce an approved definition.');
  validateDefinition(saved.definition,state);
  const nodes=viewNodes(saved.definition.view),types=[...new Set(nodes.map(node=>node.type))];
  if(scenario.expect==='interactive')assert.ok(types.includes('interactive'),'The requested live control is missing.');
  if(scenario.id==='auto-routes')for(const name of ['东桥','山径','河岸'])assert.ok(JSON.stringify(saved.definition).includes(name),'Missing route: '+name);
  return {decision:'definition',types};
}
async function runScenario(scenario){
  const caseController=new AbortController(),caseTimer=setTimeout(()=>caseController.abort(),180000);caseTimer.unref();
  const folder=join(output,scenario.id);await mkdir(folder,{recursive:true});
  const world={id:'interactive-live-'+scenario.id,version:1,title:scenario.title,location:'当前场景',identity:'当事人',rules:[scenario.opening],opening:scenario.opening,characters:[]};
  const session=createSession(world,{},'real'),branch=session.branches[0];
  if(scenario.stock)branch.initialState.game={schemaVersion:1,entities:[{id:'food',name:'干粮',kind:'item',detail:'当前持有，试算不改变数量',status:'未分配',unit:'份',value:scenario.stock,max:null,quote:scenario.opening,sourceVersion:0}],surfaces:[]};
  const ledger=new BranchLedger(ledgerDirectory);await ledger.register(owner,{session,worlds:[world]});
  const beforeData=await ledger.load(owner,session.id),before=storySnapshot(beforeData,ledger.branch(beforeData,branch.id));
  const traces=[];
  const model=async(c,kind,context,signal)=>{
    const start=performance.now();console.log(json({case:scenario.id,phase:kind,status:'started',at:new Date().toISOString()}));
    try{const answer=await dynamicModel(c,kind,context,signal),durationMs=Math.round(performance.now()-start);traces.push({kind,durationMs,metrics:answer.metrics,value:answer.value,...(context.uiArtifact?{uiArtifactSeen:context.uiArtifact}:{})});await saveJSON(join(folder,'model.json'),traces);console.log(json({case:scenario.id,phase:kind,status:'completed',durationMs}));return answer;}
    catch(error){const durationMs=Math.round(performance.now()-start);traces.push({kind,durationMs,error:{code:error.code,message:safeText(error.message)}});await saveJSON(join(folder,'model.json'),traces);console.log(json({case:scenario.id,phase:kind,status:'failed',durationMs,error:safeText(error.message)}));throw error;}
  };
  const service=new DynamicInteractions(ledger,config,{model}),body={sessionId:session.id,branchId:branch.id,baseVersion:0,ui:{viewport:'wide',readingMode:'continuous'},...(scenario.intent?{intent:scenario.intent}:{})};
  const result={id:scenario.id,expect:scenario.expect,passed:false,startedAt:new Date().toISOString(),steps:[]};
  async function step(name,request){
    console.log(json({case:scenario.id,step:name,status:'preparing',at:new Date().toISOString()}));
    const traceStart=traces.length,start=performance.now(),prepared=await service.prepare(owner,request,caseController.signal);
    // Measure the request itself, excluding the verification reads and report writes below.
    const metrics=stepMetrics(traces.slice(traceStart),Math.round(performance.now()-start));
    const data=await ledger.load(owner,session.id),savedBranch=ledger.branch(data,branch.id),saved=savedBranch.dynamic;
    const record={name,...metrics,promptVersion:saved.promptVersion,digest:saved.digest,decisionReason:saved.decisionReason};result.steps.push(record);
    await saveJSON(join(folder,name+'-prepared.json'),prepared);
    assert.equal(storySnapshot(data,savedBranch),before,'Preparation changed story state.');
    validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});
    const checks=checkResult(saved,scenario,savedBranch.turns.at(-1)?.state??savedBranch.initialState);
    Object.assign(record,checks);assertReadOnlyStep(saved,metrics);
    if(saved.definition)await saveJSON(join(folder,name+'-definition.json'),saved.definition);
    console.log(json({case:scenario.id,step:name,status:'completed',...record}));
    return saved;
  }
  try{
    const first=await step('initial',body);
    if(scenario.id==='allocation'){
      // A protocol fixture, not state captured from browser interaction with the first view.
      result.uiStateSource='synthetic-revision-fixture';
      const artifact={id:first.definition.id,digest:first.digest,state:{quantity:4},error:''};
      const revised=await step('revision',{...body,intent:'把这个改成按人分配，保留刚才的数量',ui:{...body.ui,artifact}});
      assert.ok(traces.some(trace=>trace.kind==='prepare'&&trace.uiArtifactSeen?.state?.quantity===4),'The matching UI state did not reach the model.');
      assert.ok(revised.definition,'The revision did not produce a definition.');
      result.uiStateReachedModel=true;
    }
    result.passed=true;
  }catch(error){result.error=safeText(error.message);result.fallbacks=traces.filter(trace=>trace.error).map(trace=>trace.error);console.log(json({case:scenario.id,status:'failed',error:result.error}));}
  clearTimeout(caseTimer);result.finishedAt=new Date().toISOString();await saveJSON(join(folder,'result.json'),result);results.push(result);await saveJSON(join(output,'manifest.json'),manifest);
}
for(const scenario of scenarios)await runScenario(scenario);
manifest.finishedAt=new Date().toISOString();manifest.finalSourceHash=await sourceHash();manifest.sourceUnchanged=manifest.finalSourceHash===manifest.initialSourceHash;manifest.passed=manifest.sourceUnchanged&&results.length===scenarios.length&&results.every(item=>item.passed);
await saveJSON(join(output,'manifest.json'),manifest);console.log(json({evidence:output,passed:manifest.passed,sourceUnchanged:manifest.sourceUnchanged,cases:results.map(({id,passed,error})=>({id,passed,error}))}));
if(!manifest.passed)process.exitCode=1;
