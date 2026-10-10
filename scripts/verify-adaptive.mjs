import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from '../server.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {requestModelJSON} from '../src/server-model.mjs';
import {validateArchive} from '../src/core.js';
import {publicSituation} from '../src/experience-state.js';
import {interactionQuery,queryObjects,selectObjects} from '../src/interaction-context.js';
const scenarioFilter=process.argv.find(value=>value.startsWith('--scenario='))?.slice('--scenario='.length);
const directory=resolve(scenarioFilter?'test-results/adaptive-live-'+scenarioFilter:'test-results/adaptive-live');await mkdir(directory,{recursive:true});
let lastDiagnostic,lastStages=[];
async function tracedRequest(config,system,content,signal,options){
 const started=Date.now(),stage=options.schema.properties.candidates?'plan':options.schema.properties.narrativeDelta?'write':'game-repair';
 try{
  const value=await requestModelJSON(config,system,content,signal,options),prose=typeof value?.prose==='string'?value.prose:JSON.parse(content).fixedProse;
  const entities=Array.isArray(value?.game?.entities)?value.game.entities:null;
  lastStages.push({stage,elapsedMs:Date.now()-started,...(entities?{gameEntityCount:entities.length,gameQuoteNotLiteral:entities.filter(e=>typeof prose==='string'&&typeof e?.quote==='string'&&!prose.includes(e.quote)).length,gameQuoteMissingName:entities.filter(e=>typeof e?.quote==='string'&&typeof e?.name==='string'&&!e.quote.includes(e.name)).length}:{})});return value;
 }catch(error){lastStages.push({stage,elapsedMs:Date.now()-started,errorCode:error.code??'unknown'});throw error;}
}
const server=createServer({ledgerDirectory:resolve(directory,'ledger'),narrate:async(...args)=>{try{return await generateNarrative(...args,{requestJSON:tracedRequest});}catch(error){lastDiagnostic=error.diagnostic??{stage:'transport-or-input',rule:error.code??'unknown'};throw error;}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,owner=crypto.randomUUID()+crypto.randomUUID();
const records=[];
async function post(path,body){const started=Date.now();lastDiagnostic=undefined;lastStages=[];const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-branch-owner':owner},body:JSON.stringify(body)});const result=await res.json();if(!res.ok){const e=new Error(result.error);e.result=result;e.elapsedMs=Date.now()-started;e.diagnostic=lastDiagnostic;e.stages=lastStages;throw e;}return {result,elapsedMs:Date.now()-started,stages:lastStages};}
const scenarios=[
 {id:'fantasy',seed:'一个克制的修仙小镇日常。我是刚入门的弟子，只确知自己有三枚灵石，没有定义生命值、战力或经验百分比。眼前是修符铺与有自己生计的师傅，她不必答应我；给一个能自由参与的具体场面。',action:'我先不买东西，问师傅是否愿意让我整理铺子，换一次修符的指导；她可以拒绝或提出自己的条件，我不提前替她答应。'},
 {id:'mystery',seed:'都市悬疑，旧车站办公室。两份公开材料摆在桌上：一张写着周二晚班的车票，以及一份说周三才离开的证词。不要把矛盾直接判成犯罪；人物都有认知局限，幕后真相固定但不透露。我是获准查看这些材料的记录员。没有生命值和好感值。',action:'我先不指控任何人，把已经公开的两份材料并列，向在场的人确认各自的时间说法和来源；我不替别人承认撒谎。'},
 {id:'daily',seed:'日常情感，一家小城旧书店。我是三十岁的店主，生日尚未确定。眼下是周二上午，有一位熟人希望约周五来整理旧书，她有自己的工作安排。开局让约定还可以商量，不添加任务条、好感值或阴谋。',action:'我告诉熟人周五只能下午帮忙，其他时段要照顾店里，让她自己决定是否合适；如果不合适，我愿意听别的方案，但不替她做决定。'}
];
try{for(const scenario of scenarios.filter(value=>!scenarioFilter||value.id===scenarioFilter)){const record={id:scenario.id,seed:scenario.seed};records.push(record);console.log('Starting '+scenario.id);
 try{const made=await post('/api/world/start',{requestId:'verify-'+crypto.randomUUID(),seed:scenario.seed});record.creationMs=made.elapsedMs;let {session,worlds}=made.result;validateArchive({schemaVersion:1,sessions:[session],worlds});const b=session.branches[0],world=worlds[0],snapshot=JSON.stringify(b);const view=publicSituation(b,world),query=queryObjects(interactionQuery('我现在怎么样？'),view,{scope:{worldKey:b.worldKey,branchId:b.id,baseVersion:0}});record.readOnlyQuery={objects:query.objects.length,unchanged:JSON.stringify(b)===snapshot};
 const choices=view.objects.filter(o=>o.kind==='person'||o.kind==='clue').slice(0,2),selection=choices.length?selectObjects({worldKey:b.worldKey,branchId:b.id,baseVersion:0},view,choices.map(o=>o.id)):undefined;
 const actionBody={sessionId:session.id,branchId:b.id,baseVersion:0,requestId:'act-'+crypto.randomUUID(),input:scenario.action,...(selection?{selection}:{})};let acted;
 for(let attempt=1;attempt<=2;attempt++){try{acted=await post('/api/generate',actionBody);break;}catch(e){record.actionAttempts??=[];record.actionAttempts.push({attempt,elapsedMs:e.elapsedMs,code:e.result?.code,diagnostic:e.diagnostic,stages:e.stages});if(attempt===2||e.result?.code!=='INVALID_MODEL_RESULT')throw e;console.log(scenario.id+' retrying same branch/request after rejected result '+JSON.stringify(e.diagnostic));}}
 record.actionMs=acted.elapsedMs;record.actionStages=acted.stages;session.branches[0]=acted.result.authoritativeBranch;worlds=[acted.result.world];record.prose=acted.result.prose;record.receipt=acted.result.receipt;
 const retried=await post('/api/generate',actionBody);record.idempotent=retried.result.receipt.turnId===record.receipt.turnId;const recovered=await post('/api/branch/read',{sessionId:session.id,branchId:b.id,requestId:actionBody.requestId});record.recoveredSameTurn=recovered.result.receipt.receipt.turnId===record.receipt.turnId;
 if(scenario.id==='daily'){try{const control={kind:'advance',goal:'照常整理书店',until:'有需要我回应的来访或约定',limit:'最多到第二天上午',forbidden:'不替我改变周五约定，不离店，不付钱',reserved:'任何新的承诺'};const jumped=await post('/api/generate',{sessionId:session.id,branchId:b.id,baseVersion:1,requestId:'time-'+crypto.randomUUID(),input:'我在店里照常整理书籍，最多到第二天上午。遇到来访或需要我回应的事就停，不替我作新的承诺。',control});session.branches[0]=jumped.result.authoritativeBranch;worlds=[jumped.result.world];record.time={elapsedMs:jumped.elapsedMs,prose:jumped.result.prose,clock:jumped.result.experience?.clock};}catch(e){record.timeFailure={message:e.message,result:e.result};}}
 const archive={schemaVersion:1,worlds,sessions:[session]};validateArchive(archive);record.archiveValid=true;record.turnCount=session.branches[0].turns.length;record.publicObjects=publicSituation(session.branches[0],worlds[0]).objects.map(o=>({id:o.id,kind:o.kind,name:o.name}));await writeFile(resolve(directory,scenario.id+'-archive.json'),JSON.stringify(archive,null,2));console.log(scenario.id+' verified '+record.turnCount+' turns');
 }catch(e){record.failure={message:e.message,result:e.result,elapsedMs:e.elapsedMs,diagnostic:e.diagnostic,stages:e.stages};console.log(scenario.id+' failed: '+e.message+' '+JSON.stringify(e.diagnostic??{}));}await writeFile(resolve(directory,'results.json'),JSON.stringify(records,null,2));}
}finally{await new Promise(r=>server.close(r));}
if(records.some(r=>r.failure||r.timeFailure))process.exitCode=1;
