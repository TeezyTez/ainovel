// Real provider verification against an isolated copy; never writes the source story.
import fs from 'node:fs/promises';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createSession,getBranch,commitTurn,validateArchive} from '../src/core.js';
import {modelConfig,requestModelJSON} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {dynamicModel} from '../src/server-dynamic-model.mjs';
import {STORY_SYSTEM,RECORD_SYSTEM,STORY_PROMPT_VERSION} from '../src/story-prompts.mjs';
if(!process.argv.includes('--live')){console.log('Use --live for independent fictional fixtures. --source=<ledger> additionally requires specific permission for that archive.');process.exit(0);}
process.loadEnvFile('.env');
const source=process.argv.find(a=>a.startsWith('--source='))?.slice(9);
const reextract=process.argv.find(a=>a.startsWith('--reextract-fixture='))?.slice(20);
const prior=reextract?JSON.parse(await fs.readFile(reextract,'utf8')):null;
if(prior&&(source||prior.story?.archive?.worlds?.[0]?.id!=='quiet-bookshop'||!prior.continuation))throw new Error('Re-extraction only accepts this independent fictional fixture.');
const fictionalWorld={id:'quiet-bookshop',version:1,title:'雨里的旧书店',identity:'路过的读者',location:'旧书店',rules:['普通现代生活，没有魔法。','纸条上的开放区域可由读者自己选择前往。'],characters:[{id:'owner',name:'沈砚',public:'书店店主',role:'店主',goal:'慢慢整理捐来的旧书',secret:'打算把店交给妹妹'}, {id:'sister',name:'沈青',public:'店主的妹妹',role:'设计师',goal:'修复一本家族相册',secret:''},{id:'donor',name:'周敬',public:'旧书捐赠者',role:'教师',goal:'找回一本书里的照片',secret:''},{id:'reader',name:'陶岚',public:'常来的读者',role:'学生',goal:'读完一套旧杂志',secret:''}],opening:'你走进街角的旧书店避雨。柜台后的人合上一本褪色的图册，问你：“找什么书？”店里只听见雨点敲窗的声音。门边贴着手写纸条：二楼是旧刊阅览室，地下室存放待整理的捐书，都可以去看；二楼灯坏了，地下室是否有人值守还不清楚。'};
const generatedData={worlds:[fictionalWorld],session:createSession(fictionalWorld,{},'real'),receipts:{}};
const original=source?await fs.readFile(source,'utf8'):JSON.stringify(generatedData),data=JSON.parse(original),world=data.worlds[0],config=modelConfig(process.env);
const started=Date.now(),output=`test-results/story-first-${started}.json`;
const report={promptVersion:STORY_PROMPT_VERSION,model:config.model,engine:config.narrativeEngine,authorPromptChars:STORY_SYSTEM.length,recordPromptChars:RECORD_SYSTEM.length,sourceHash:createHash('sha256').update(original).digest('hex'),calls:[],checks:[]};
await fs.mkdir('test-results',{recursive:true});
const save=()=>fs.writeFile(output,JSON.stringify(report,null,2));await save();
const signal=AbortSignal.timeout(600000);
try{
 const session=createSession(world,{},'real'),branch=getBranch(session),input=source?'没有':'我想先看看，不急着买。';
 const proposal=await generateNarrative({requestId:'isolated-story-first',world,state:branch.initialState,player:session.player,preferences:session.preferences,input,memory:[],recent:[],branchId:branch.id},config,signal,{requestJSON:async(c,system,content,s,options)=>{
  const time=Date.now(),call={phase:report.calls.length?'record':'story',systemChars:system.length,contextChars:content.length,schemaChars:JSON.stringify(options.schema).length,input:JSON.parse(content)};report.calls.push(call);
  try{if(prior&&options.schema.required.includes('prose')){call.reusedAuthoredProse=true;call.output={prose:prior.story.prose};}else call.output=await requestModelJSON(c,system,content,s,options);return call.output;}catch(e){call.error=e.message;throw e;}finally{call.durationMs=Date.now()-time;await save();}
 }});
 commitTurn(session,world,input,proposal);validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});
 report.story={input,prose:proposal.prose,archive:{schemaVersion:1,worlds:[world],sessions:[session]}};
 report.checks.push({name:'actual prose and extracted state commit/replay',passed:true});await save();
 if(!source){
  const followup='我想看看那本图册。对了，该怎么称呼您？';
  const next=await generateNarrative({requestId:'isolated-story-followup',world,state:branch.turns.at(-1).state,player:session.player,preferences:session.preferences,input:followup,memory:branch.turns.map(t=>t.memory),recent:branch.turns,narrative:branch.turns.at(-1).narrative,branchId:branch.id},config,signal,{requestJSON:async(c,system,content,s,options)=>{
   const time=Date.now(),call={phase:options.schema.required.includes('prose')?'story-followup':'record-followup',systemChars:system.length,contextChars:content.length,input:JSON.parse(content)};report.calls.push(call);
   try{if(prior&&options.schema.required.includes('prose')){call.reusedAuthoredProse=true;call.output={prose:prior.continuation.prose};}else call.output=await requestModelJSON(c,system,content,s,options);return call.output;}catch(e){call.error=e.message;throw e;}finally{call.durationMs=Date.now()-time;await save();}
  }});
  commitTurn(session,world,followup,next);validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});
  report.continuation={input:followup,prose:next.prose};report.checks.push({name:'second turn and archive replay',passed:true});await save();
  if(prior){const people=branch.turns.at(-1).state.experience?.objects.filter(o=>o.kind==='person')??[];report.checks.push({name:'same person retains one stable identity after introduction',passed:people.length===1&&people[0].name==='沈砚'&&people[0].id==='person:owner'});}
 }
 const dir=await mkdtemp(join(tmpdir(),'elselife-story-first-')),ledger=new BranchLedger(dir),owner='isolated-story-first';
 report.isolatedLedger=dir;
 // Reuse the latest actual context, including the existing unresolved exits.
 const copy=structuredClone(data);await ledger.save(owner,copy);
 const b=copy.session.branches.find(b=>b.id===copy.session.activeBranch),scope={sessionId:copy.session.id,branchId:b.id,baseVersion:(b.turns.at(-1)?.state??b.initialState).version};
 const service=new DynamicInteractions(ledger,config,{model:async(...args)=>{const start=Date.now(),call={phase:args[1],input:args[2]};report.calls.push(call);try{const r=await dynamicModel(...args);call.output=r.value;return r;}catch(e){call.error=e.message;throw e;}finally{call.durationMs=Date.now()-start;await save();}}});
 for(const [name,intent,expected] of prior?[]:[['comparison','先别行动，把目前提到的去向和各自不确定的地方放在一起比较。',true],['quiet','我只想静静听雨，不需要整理信息或做决定。',false]]){
  const prepared=await service.prepare(owner,{...scope,intent,retry:true},signal),dynamic=prepared.authoritativeBranch.dynamic;
  report[name]=dynamic;
  const passed=Boolean(dynamic.definition)===expected&&!dynamic.reason;
  report.checks.push({name,passed});
  if((await ledger.load(owner,scope.sessionId)).session.branches.find(x=>x.id===b.id).turns.length!==b.turns.length)throw new Error('Preparing UI changed history.');
  await save();
 }
 report.sourceUnchanged=source?(await fs.readFile(source,'utf8'))===original:true;
 report.passed=report.checks.every(c=>c.passed)&&report.sourceUnchanged;
}catch(e){report.error=e.message;report.diagnostic=e.diagnostic;report.passed=false;}
report.elapsedMs=Date.now()-started;await save();console.log(JSON.stringify({output,passed:report.passed,checks:report.checks,error:report.error,elapsedMs:report.elapsedMs}));
if(!report.passed)process.exitCode=1;
