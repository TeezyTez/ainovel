import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {modelConfig} from '../src/server-model.mjs';
import {dynamicModel} from '../src/server-dynamic-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {createSession,validateArchive} from '../src/core.js';
try{process.loadEnvFile('.env');}catch{}
if(!process.argv.includes('--live')){console.log('Use --live --source=<completed dynamic-live evidence directory>. Real models only.');process.exit(0);}
const source=resolve(process.argv.find(x=>x.startsWith('--source='))?.slice(9)||''),out=resolve('test-results','dynamic-continuity-'+Date.now());await mkdir(out,{recursive:true});const config=modelConfig(process.env),dir=await mkdtemp(join(tmpdir(),'elselife-continuity-')),ledger=new BranchLedger(dir),signal=new AbortController().signal,traces=[];
const model=async(c,kind,context,s)=>{const value=await dynamicModel(c,kind,context,s);traces.push({kind,context,...value});await writeFile(join(out,'model.json'),JSON.stringify(traces,null,2));return value;};const svc=new DynamicInteractions(ledger,config,{model});
const report={source,out,ledger:dir,checks:[]};
async function save(){await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));}
async function seed(id){const archive=JSON.parse(await readFile(join(source,id,'archive.json'),'utf8'));const session=createSession(archive.worlds[0],{},'real');session.branches[0].initialState=structuredClone(archive.sessions[0].branches[0].initialState);await ledger.register('continuity',{session,worlds:archive.worlds});return {session,world:archive.worlds[0],body:{sessionId:session.id,branchId:session.activeBranch,baseVersion:0}};}
try{
  const f=await seed('merchant');const prepared=await svc.prepare('continuity',{...f.body,intent:'比较报价，暂不购买'},signal);if(prepared.authoritativeBranch.dynamic.reason)throw new Error('Comparison fallback');const original=prepared.authoritativeBranch.initialState.game.entities.map(e=>e.value);if(prepared.authoritativeBranch.turns.length)throw new Error('Viewing changed the world');report.checks.push({name:'same-world-different-intent',actions:prepared.authoritativeBranch.dynamic.definition?.actions.map(a=>a.mode)??[],values:original});await save();
  const request={...f.body,input:'我买2瓶药水',requestId:'from-comparison'};let result=await svc.input('continuity',request,signal);if(result.compose){await svc.prepare('continuity',{...f.body,intent:request.input,retry:true},signal);result=await svc.input('continuity',{...request,compositionAttempted:true},signal);}if(!result.operationId)throw new Error('Free purchase did not use authoritative rules');if(JSON.stringify(result.authoritativeBranch.turns.at(-1).state.game.entities.map(e=>e.value))!==JSON.stringify([4,3,2]))throw new Error('Wrong trade result');await svc.narrate('continuity',{...f.body,operationId:result.operationId},signal);report.checks.push({name:'free-action-outside-visible-buttons',operationId:result.operationId,values:[4,3,2]});await save();
  const n=await seed('negotiation');await svc.prepare('continuity',{...n.body,intent:'我想说明目的，请馆员自行判断'},signal);const input='我说明是在为家族寻亲，并提出可以先看不涉及第三人的片段；请馆员按她的顾虑决定，不能假定她同意。';const interpreted=await svc.input('continuity',{...n.body,input,requestId:'negotiate'},signal);if(interpreted.handled||interpreted.compose)throw new Error('Subjective agreement must not be settled as a deterministic rule');const resultN=await ledger.generate('continuity',{...n.body,input,requestId:'negotiate',interpreted:interpreted.interpreted},(body,s)=>generateNarrative({...body,input:body.input+'\n结构化申请（不是已成立结果）：'+JSON.stringify(interpreted.interpreted)},config,s),signal);await writeFile(join(out,'negotiation.json'),JSON.stringify(resultN,null,2));report.checks.push({name:'person-judgement-through-real-narrative',prose:resultN.prose,operation:!!resultN.committedTurn.operation});await save();
  for(const data of [await ledger.load('continuity',f.session.id),await ledger.load('continuity',n.session.id)])validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});
  report.passed=true;
}catch(e){report.passed=false;report.error={code:e.code,message:e.message};process.exitCode=1;}
await save();console.log(JSON.stringify(report,null,2));
