import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,currentState,getBranch,commitTurn,validateArchive} from '../src/core.js';
import {validateRequest} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {resolveGameAction} from '../src/game-state.js';

const world={id:'workshop',version:1,title:'灯房',location:'工作台',opening:'你有铜线3卷。灯泡0只。制作1只灯泡消耗2卷铜线。',identity:'修理工',rules:['按公开配方制作'],characters:[]};
const entity=(id,name,value)=>({id,kind:'item',name,detail:'',status:'可使用',value,max:null,unit:'',quote:world.opening});
const game={entities:[entity('wire','铜线',3),entity('bulb','灯泡',0)],surfaces:[{id:'bench',kind:'interaction',title:'制作灯泡',description:'材料与产出',entityIds:['wire','bulb'],links:[],actions:[{id:'craft',label:'制作灯泡',input:'我消耗2卷铜线制作1只灯泡。',mode:'apply',effects:[{entityId:'wire',delta:-2,status:null},{entityId:'bulb',delta:1,status:null}],destination:null,disabledReason:''}],quote:world.opening}]};
function fixture(){
 const session=createSession(world,{},'real');
 commitTurn(session,world,'看看工作台',{requestId:'first',baseVersion:0,prose:world.opening,events:[],game});
 const state=currentState(session),branch=getBranch(session),ref={branchId:branch.id,version:state.version,surfaceId:'bench',actionId:'craft'};
 const body={requestId:'craft-request',world,branchId:branch.id,state:structuredClone(state),player:session.player,preferences:session.preferences,memory:[],recent:[],input:game.surfaces[0].actions[0].input,gameAction:ref};
 return {session,body,ref};
}
const config={available:true,contextBudget:40000,outputBudget:4000,timeoutMs:1000};
function responses(body){
 const candidate={kind:'progress',methodId:'free',threadId:null,premise:'按配方工作',npcAction:'师傅试亮灯泡',payoff:'得到灯泡',leaveOpen:'',sources:[{sourceId:'world',quote:world.opening}]};
 return [{worldKey:'workshop@1',baseVersion:1,preferredCandidateId:'craft',candidates:[{...candidate,id:'craft'},{...candidate,id:'test',npcAction:'师傅先解释配方'}]},
 {requestId:body.requestId,baseVersion:1,prose:'你用掉2卷铜线，制成1只灯泡。铜线剩1卷，灯泡共有1只。',events:[],suggestions:[],ended:false,eventEvidence:[],experience:null,game:null,narrativeDelta:{focus:'制作完成',beat:{kind:'progress',summary:'获得灯泡',methodId:'free'},threads:[],opportunities:[]}}];
}
test('selected gameplay action reaches both model stages as verified receipt and commits exactly once',async()=>{
 const {session,body}=fixture(),before=JSON.stringify(session),outputs=responses(body),seen=[];
 const accepted=validateRequest(body);
 const result=await generateNarrative(accepted,config,new AbortController().signal,{requestJSON:async(c,system,content)=>{seen.push(JSON.parse(content));return outputs[seen.length-1];}});
 assert.equal(JSON.stringify(session),before,'model work cannot pre-deduct resources');
 assert.equal(seen.length,2);for(const context of seen){assert.equal(context.gameActionReceipt.effects[0].value,1);assert.equal(context.gameActionReceipt.effects[1].value,1);}
 commitTurn(session,world,body.input,result);
 assert.deepEqual(currentState(session).game.entities.map(e=>e.value),[1,1]);
 assert.throws(()=>commitTurn(session,world,body.input,result));
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[session]}));
});
test('requests reject stale/forged action parameters and mismatching natural language',()=>{
 const {body}=fixture();
 for(const modify of [b=>b.gameAction.version=0,b=>b.gameAction.branchId='elsewhere',b=>b.gameAction.effects=[],b=>b.input='改为制作999只灯泡']){
  const bad=structuredClone(body);modify(bad);assert.throws(()=>validateRequest(bad));
 }
});
test('writer cannot override fixed costs; failed generation never commits effects',async()=>{
 const {session,body}=fixture(),before=JSON.stringify(session),outputs=responses(body);
 outputs[1].prose='铜线还有3卷。';outputs[1].game={entities:[{...entity('wire','铜线',3),quote:outputs[1].prose}],surfaces:[]};
 let i=0;await assert.rejects(generateNarrative(validateRequest(body),config,new AbortController().signal,{requestJSON:async()=>outputs[i++]}));
 assert.equal(JSON.stringify(session),before);
});
test('game output is mandatory but nullable and invalid UI never becomes a published turn',async()=>{
 const {body}=fixture();
 for(const modify of [p=>delete p.game,p=>p.game={entities:[],surfaces:[{script:'run()'}]}]){
  const outputs=responses(body);modify(outputs[1]);let i=0;
  await assert.rejects(generateNarrative(validateRequest(body),config,new AbortController().signal,{requestJSON:async()=>outputs[i++]}));
 }
});
test('completing a scene button does not close the entire ongoing story',async()=>{
 const {body}=fixture(),outputs=responses(body);outputs[1].ended=true;let i=0;
 const result=await generateNarrative(validateRequest(body),config,new AbortController().signal,{requestJSON:async()=>outputs[i++]});
 assert.equal(result.ended,false);
});
