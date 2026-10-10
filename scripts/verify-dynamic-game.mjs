// Real model evaluation on disposable in-memory stories, never user saves.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSession,currentState,getBranch,commitTurn,validateArchive,clone} from '../src/core.js';
import {modelConfig,requestModelJSON,validateRequest} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {narrativeForBranch} from '../src/narrative-state.js';
import {selectContext} from '../src/experience.js';
import {resolveGameAction} from '../src/game-state.js';

const genre=process.argv.includes('--map')?'map':'craft';
const fixtures={
 craft:{id:'dynamic-sail',version:1,title:'修船铺 · 第一面帆',location:'修船铺工作台',identity:'新来的修船匠',description:'海边小店的手作生活，允许检查、制作与交付。',
 opening:'午后的潮水刚退。修船铺工作台上，属于你的麻绳有3卷，帆布有2块，补帆包有0份。老师傅把配方压在尺子下：每制作1份补帆包，消耗2卷麻绳和1块帆布，没有其他费用，工具就在手边。码头有一位等待修帆的船主，但你还没答应接单。',
 rules:['现实手工经营，已公开配方不会临时增加费用。制作按配方消耗与产出；检查材料不消耗材料，不自动接订单。','不使用通用生命值、经验等级、金钱计分；尚未确定的价钱保持未知。','主人公没同意时，不替他出售材料或承诺交货；允许之后选择继续开店。'],characters:[{id:'master',name:'叶师傅',public:'愿意指导你的修船老师傅',secret:'PRIVATE_SAIL_SENTINEL'}]},
 map:{id:'dynamic-shelter',version:1,title:'停电之后 · 值班室',location:'值班室',identity:'留守的维修员',description:'停电研究站里的一次路线选择。',
 opening:'应急灯下，你站在值班室。墙上的疏散图标出两条已知路线：值班室通往配电间的室内走廊没有障碍，步行2分钟；值班室通往档案室的消防门已锁死，不能直接穿过。配电间和档案室是不同房间。你口袋里的手电筒有1支，电量尚不明确。对讲机里，同事让你先选路，不替你出门。',
 rules:['仅按已经看见或听到的线索补充地图，不揭露未探索房间内部。','室内走廊到配电间确定可走，不额外扣资源；锁死的消防门不能作为可直接抵达的路线。','未知手电电量不能编成百分比。没有固定生命值与等级，不未经同意自动出发。'],characters:[{id:'colleague',name:'许禾',public:'在对讲机另一端协助你的同事',secret:'PRIVATE_MAP_SENTINEL'}]}
};
const filename=resolve(`test-results/dynamic-${genre}-live.json`);
const archiveName=resolve(`test-results/dynamic-${genre}-archive.json`);
if(!process.argv.includes('--live')&&!process.argv.includes('--action')){console.log('Use --live [--map] for one real initial turn; --action [--map] for one action from its actual generated card.');process.exit(0);}
let report;
if(process.argv.includes('--action'))report=JSON.parse(await readFile(filename,'utf8'));
else{
 try{await access(filename);throw new Error('Evidence exists; refusing an accidental repeat.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const world=fixtures[genre],session=createSession(world,{name:'旅人'},'real');session.preferences.length='简短';session.preferences.pace='适中';
 report={genre,world,session,turns:[],startedAt:new Date().toISOString(),notes:'Actual local Codex two-stage calls on an isolated fixture; no user localStorage accessed.'};
}
const {world,session}=report,branch=getBranch(session),before=clone(session);
let resumedPlan;
if(process.argv.includes('--resume-plan')){
 const failed=report.turns.at(-1);assert.equal(failed?.status,'failed');assert.equal(failed.modelCalls.length,1);assert.ok(failed.modelCalls[0].output);
 report.failedAttempts??=[];report.failedAttempts.push(report.turns.pop());resumedPlan=failed.modelCalls[0].output;
}
let input=genre==='map'?'我核对墙上的疏散图和眼前的门，听听许禾的建议，先不出发。':'我翻开尺子下的配方，检查手头材料，请叶师傅指出现在能做什么。先不动材料，也不接订单。',gameAction;
if(process.argv.includes('--action')){
 assert.equal(report.turns.length,1);assert.equal(report.turns[0].status,'passed');
 const state=currentState(session);let chosen;
 for(const surface of state.game?.surfaces||[])for(const action of surface.actions)if(action.mode==='apply'&&!action.disabledReason){
  try{const ref={branchId:branch.id,version:state.version,surfaceId:surface.id,actionId:action.id};const receipt=resolveGameAction(state,ref,{branchId:branch.id});if((genre==='map'&&receipt.destination)||(genre==='craft'&&receipt.effects.some(e=>e.value>e.beforeValue)))chosen={ref,receipt};}catch{}
 }
 assert.ok(chosen,'Real first response must offer a valid actionable map/recipe');gameAction=chosen.ref;input=chosen.receipt.input;
}
const body=validateRequest({requestId:crypto.randomUUID(),world,branchId:branch.id,state:clone(currentState(session)),player:session.player,preferences:session.preferences,...selectContext(branch,input),narrative:narrativeForBranch(branch),input,...(gameAction?{gameAction}:{})});
const record={request:body,startedAt:new Date().toISOString(),modelCalls:[]};report.turns.push(record);
await mkdir(resolve('test-results'),{recursive:true});
const save=()=>writeFile(filename,JSON.stringify(report,null,2));await save();
const start=performance.now();
try{
 record.result=await generateNarrative(body,modelConfig(process.env),new AbortController().signal,{requestJSON:async(config,system,content,signal,options)=>{
  const call={input:JSON.parse(content),system};record.modelCalls.push(call);await save();
  if(resumedPlan&&record.modelCalls.length===1){call.replayedPreviouslyGeneratedPlan=true;call.output=resumedPlan;await save();return resumedPlan;}
  call.output=await requestModelJSON(config,system,content,signal,options);await save();return call.output;
 }});
 commitTurn(session,world,input,record.result);
 assert.doesNotMatch(record.result.prose+JSON.stringify(record.result.game),/PRIVATE_(SAIL|MAP)_SENTINEL/);
 validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});
 if(!gameAction)assert.ok(currentState(session).game?.surfaces.length,'Scene should naturally produce relevant gameplay');
 else if(genre==='craft')for(const effect of record.result.gameAction.effects)assert.equal(currentState(session).game.entities.find(e=>e.id===effect.entityId).value,effect.value);
 else assert.equal(currentState(session).location,'配电间');
 record.status='passed';
 await writeFile(archiveName,JSON.stringify({schemaVersion:1,worlds:[world],sessions:[session]},null,2));
 console.log(JSON.stringify({status:record.status,genre,prose:record.result.prose,game:record.result.game,receipt:record.result.gameAction},null,2));
}catch(error){record.status='failed';record.error=error.message;record.sessionUnchanged=JSON.stringify(before)===JSON.stringify(session);console.log(JSON.stringify({status:'failed',genre,error:record.error,modelCalls:record.modelCalls.length}));process.exitCode=1;}
finally{record.elapsedMs=Math.round(performance.now()-start);await save();console.log(JSON.stringify({file:filename,elapsedMs:record.elapsedMs}));}
