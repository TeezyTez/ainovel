// Replays the reported turn in a private clone, never modifying the live ledger.
// Usage: node --env-file-if-exists=.env scripts/verify-craft-replay.mjs ARCHIVE TURN
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {clone,currentState,getBranch,commitTurn} from '../src/core.js';
import {selectContext} from '../src/experience.js';
import {narrativeForBranch} from '../src/narrative-state.js';
import {modelConfig,validateRequest,requestModelJSON} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {draftDefects} from '../src/narrative-craft.mjs';

const [file,index,count='2']=process.argv.slice(2),turnNumber=Number(index);
assert.ok(['1','2'].includes(count),'Replay count must be 1 or 2');
assert.ok(file&&Number.isSafeInteger(turnNumber)&&turnNumber>0,'Provide an archive and one-based turn number');
const source=resolve(file),bytes=await readFile(source),archive=JSON.parse(bytes),session=clone(archive.session);
const branch=getBranch(session),world=archive.worlds.find(w=>`${w.id}@${w.version}`===branch.worldKey),original=branch.turns[turnNumber-1];
assert.ok(world&&original,'World or turn not found');
branch.turns=branch.turns.slice(0,turnNumber-1);branch.draft='';
const config=modelConfig(process.env);assert.ok(config.available,'No configured real model');
const output=resolve('test-results',`craft-replay-${Date.now()}.json`);
const report={sourceTurn:turnNumber,sourceHash:createHash('sha256').update(bytes).digest('hex'),original:{input:original.input,prose:original.prose},model:config.model,turns:[],status:'running'};
const save=()=>writeFile(output,JSON.stringify(report,null,2));
console.log(output);await save();
try{
 for(const input of [original.input,'继续'].slice(0,Number(count))){
  const body=validateRequest({requestId:randomUUID(),world,state:clone(currentState(session)),player:session.player,preferences:session.preferences,...selectContext(branch,input),input,branchId:branch.id,narrative:narrativeForBranch(branch)});
  const record={input,request:body,stages:[],status:'running'};report.turns.push(record);await save();
  const started=Date.now();
  const result=await generateNarrative(body,config,new AbortController().signal,{requestJSON:async(settings,system,content,signal,options)=>{
   const payload=JSON.parse(content),stage={stage:payload.stage||'game-repair',content:payload,status:'running'};record.stages.push(stage);await save();
   const raw=await requestModelJSON(settings,system,content,signal,options);stage.result=raw;stage.status='completed';await save();return raw;
  }});
  commitTurn(session,world,input,result);assert.equal(currentState(session).version,body.state.version+1);assert.deepEqual(draftDefects(result.prose),[]);
  record.result=result;record.elapsedMs=Date.now()-started;record.status='accepted';await save();console.log(JSON.stringify({input,prose:result.prose,elapsedMs:record.elapsedMs}));
 }
 report.status='completed';
}catch(error){report.status='failed';if(report.turns.at(-1))report.turns.at(-1).status='failed';report.error={code:error.code,message:error.message,diagnostic:error.diagnostic};process.exitCode=1;}
finally{
 report.sourceUnchanged=(await readFile(source)).equals(bytes);report.session=session;await save();
 console.log(JSON.stringify({status:report.status,sourceUnchanged:report.sourceUnchanged,error:report.error}));
}
