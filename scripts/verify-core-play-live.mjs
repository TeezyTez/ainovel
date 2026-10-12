// Opt-in actual provider call, isolated from user sessions and server ledgers.
import {mkdir,writeFile} from 'node:fs/promises';
import {createWorkshopFixture} from '../tests/fixtures/workshop-world.mjs';
import {currentState,getBranch,commitTurn,validateArchive} from '../src/core.js';
import {resolveGameAction} from '../src/game-state.js';
import {modelConfig,requestModelJSON} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
if(!process.argv.includes('--live')){console.log('Pass --live to run one actual isolated model journey.');process.exit(0);}
const {world,session}=createWorkshopFixture(),branch=getBranch(session),state=currentState(session);
const reference={branchId:branch.id,version:state.version,surfaceId:'journeys',actionId:'ferry'},receipt=resolveGameAction(state,reference,{branchId:branch.id});
const started=Date.now(),report={startedAt:new Date().toISOString(),status:'running',method:'Fixed initial fixture, actual configured provider response and normal commitTurn/validateArchive.',input:receipt.input};
await mkdir('test-results',{recursive:true});
const output=`test-results/core-play-live-${started}.json`;
await writeFile(output,JSON.stringify(report,null,2));
try{
 const result=await generateNarrative({requestId:crypto.randomUUID(),world,state,player:session.player,preferences:session.preferences,memory:[],recent:[{id:branch.turns[0].id,prose:branch.turns[0].prose,state}],input:receipt.input,branchId:branch.id,gameAction:reference},modelConfig(process.env),new AbortController().signal,{requestJSON:async(...args)=>{const response=await requestModelJSON(...args);if(response?.prose)report.modelDraft=response;return response;}});
 commitTurn(session,world,receipt.input,result);const archive={schemaVersion:1,worlds:[world],sessions:[session]};validateArchive(archive);
 const after=currentState(session),cash=after.game.entities.find(e=>e.id==='cash').value;
 if(after.location!=='码头'||!after.time.endsWith('14:15')||cash!==4||after.inventory.length)throw new Error('Actual journey differs from authorized route: inspect isolated evidence.');
 Object.assign(report,{status:'passed',result,location:after.location,time:after.time,cash,archive});
}catch(error){Object.assign(report,{status:'failed',error:error.message,code:error.code,diagnostic:error.diagnostic});process.exitCode=1;}
report.elapsedMs=Date.now()-started;await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({file:output,status:report.status,elapsedMs:report.elapsedMs,error:report.error,diagnostic:report.diagnostic}));
