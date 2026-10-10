// Explicit two-request live evaluation. Uses an isolated in-memory session only.
// node scripts/verify-experience.mjs --live
// No retries and no browser/localStorage access. Read prose before judging semantics.
import assert from 'node:assert/strict';
import {mkdir,writeFile,rename,access,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSession,currentState,getBranch,commitTurn,validateArchive,validateWorld,applyEvents,clone} from '../src/core.js';
import {publicSituation,historyEntries} from '../src/experience-state.js';
import {selectContext} from '../src/experience.js';
import {narrativeForBranch} from '../src/narrative-state.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const endpoint='http://127.0.0.1:4173';
const file=resolve(root,'test-results/ft426-live.json');
const world={id:'ft426-afternoon',version:1,title:'茶铺的半小时',identity:'茶铺的新帮手',location:'茶铺后窗边',
  description:'一个能安静拒绝邀约、休息收束的普通午后。',
  opening:'今天下午两点整，你坐在茶铺后窗边。墙上的挂钟刚敲过两声。林把一壶白水放在桌上：“这会儿没活，你可以歇一歇。”你还没有见过街区活动的登记员。',
  rules:['现实日常，没有超自然能力。开篇准确时间为下午两点整。',
    '街区活动登记员会在今天下午两点二十分来到茶铺，询问主角是否愿意报名并在参加承诺书上签字。登记员的姓名尚未设定，可以在首次来访时介绍；他不是已有的林。',
    '报名是自愿的，拒绝不会被追问或遭受惩罚。没有购货、债务或必须支付的费用。登记员可以离开，让主角休息。',
    '这段故事是一个短小的午后片段；主角明确拒绝邀约并选择休息后可以安静结束，不临时增加任务、危机或悬念。'],
  characters:[{id:'lin',name:'林',public:'茶铺店员',secret:'FT426_PRIVATE_SENTINEL：林在抽屉里放了一封未公开的家书。'}]};
validateWorld(world);
const steps=[
  {input:'我坐在后窗边等一会儿，最多等半小时，不花钱、不签字、不许替我承诺任何事。如果有人来邀请我报名或要我签约，立刻停在对方提出邀请的地方，让我自己回答。不要替我拒绝或接受。',
    control:{kind:'wait',goal:'安静等候，听清来访者的邀请',until:'有人来邀请报名或要求签字时立刻交回控制',limit:'从下午两点整起最多半小时，最晚到下午两点半',forbidden:'不花钱、不签字、不作承诺、不替我接受或拒绝邀请',reserved:'是否报名或签字，以及如何回答邀请，全部由我自己决定'}},
  {input:'我明确告诉来访的登记员：“谢谢，我不报名，也不会签这份承诺书。”拒绝之后，我就留在后窗边喝白水、安静休息，不再接任务，不花钱，不立新的承诺。这段午后就在休息中结束。',
    control:{kind:'act',goal:'明确拒绝报名与签字，然后安静休息并结束这段午后',until:'拒绝已传达且开始安静休息',limit:'只完成眼前的拒绝和短暂休息，不推进到下一天',forbidden:'不花钱、不签字、不接受新任务、不建立新的承诺或危机',reserved:'不替我作出本次明确拒绝以外的重大决定'}}
];

if(process.argv.includes('--replay')){
  const report=JSON.parse(await readFile(file,'utf8')),replayed=clone(report.initialSession),replayedBranch=getBranch(replayed);
  validateArchive({schemaVersion:1,worlds:[report.fixture],sessions:[report.session]});
  const turns=[];
  for(const record of report.turns){assert.equal(record.status,'structurally-accepted');commitTurn(replayed,report.fixture,record.request.input,record.result,replayedBranch.id);validateArchive({schemaVersion:1,worlds:[report.fixture],sessions:[replayed]});turns.push({index:record.index,publicSituation:publicSituation(replayedBranch,report.fixture)});}
  assert.equal(turns[1].publicSituation.clock.label,'最后确认：下午两点二十分');
  assert.ok(turns[1].publicSituation.objects.find(o=>o.id==='person:registrar-zhou').fields.some(f=>f.key==='role'&&f.value==='街区活动登记员'));
  assert.ok(turns[1].publicSituation.objects.some(o=>o.kind==='fact'&&o.name.includes('尚未得到')&&o.status==='历史记录'));
  report.postFixReplay={replayedAt:new Date().toISOString(),additionalModelCalls:0,originalArchiveStillValid:true,newArchiveRoundtrip:true,checks:['stale clock labelled last confirmed','prior facts marked historical','existing identity field retained after status update'],turns,session:replayed};
  report.semanticReview='Completed by close reading; see test-results/ft426-live-review.md. The two model responses meet this fixture’s wait/stop/refusal boundaries. Projection and field-retention defects were corrected and checked by replay without additional model calls.';
  await writeFile(file+'.tmp',JSON.stringify(report,null,2));await rename(file+'.tmp',file);
  console.log(JSON.stringify({file,additionalModelCalls:0,originalArchiveStillValid:true,newArchiveRoundtrip:true,clock:turns[1].publicSituation.clock,person:turns[1].publicSituation.objects.find(o=>o.id==='person:registrar-zhou')},null,2));
}else if(!process.argv.includes('--live')){
  console.log(JSON.stringify({endpoint,requests:steps.length,expectedPlannedModelCalls:4,fixture:world.title,output:file,live:false,steps},null,2));
}else{
  try{await access(file);throw new Error('Live evidence already exists. This evaluator refuses an accidental second run.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const session=createSession(world,{name:'旅人'},'real'),branch=getBranch(session);
  session.preferences={...session.preferences,length:'简短',boundaries:'本局不花钱、不签字、不默认承诺；重要邀约让我自己回答。'};
  branch.initialState.time='下午两点整';
  branch.initialState.experience={clock:{label:'下午两点整',elapsed:'',precision:'exact',quote:'今天下午两点整，你坐在茶铺后窗边。',sourceVersion:0},objects:[],stop:null,folded:[]};
  branch.initialState.flags={'ft426-afternoon:private-marker':'FT426_PRIVATE_FLAG'};
  const archive=()=>({schemaVersion:1,worlds:[world],sessions:[session]});
  validateArchive(archive());
  const report={schemaVersion:1,startedAt:new Date().toISOString(),endpoint,fixture:world,requestLimit:2,expectedPlannedModelCalls:4,actualHttpRequests:0,
    evidenceScope:'Complete HTTP inputs, HTTP results and local commits; per-stage model transcripts are not exposed by the HTTP endpoint. Four model calls are expected for two successful planned requests, not independently instrumented.',
    semanticReview:'Pending human/model close reading of actual prose. Structural checks are not semantic approval.',initialSession:clone(session),initialPublicSituation:publicSituation(branch,world),turns:[],session};
  await mkdir(dirname(file),{recursive:true});
  const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(report,null,2));await rename(file+'.tmp',file);};
  await save();
  try{
    const configResponse=await fetch(endpoint+'/api/config');report.service=await configResponse.json();assert.equal(configResponse.status,200);assert.equal(report.service.available,true);
    for(const step of steps){
      const request={requestId:crypto.randomUUID(),world,worldKey:branch.worldKey,branchId:branch.id,baseVersion:currentState(session).version,state:clone(currentState(session)),player:clone(session.player),preferences:clone(session.preferences),...selectContext(branch,step.input),input:step.input,control:{...step.control,worldKey:branch.worldKey,branchId:branch.id,baseVersion:currentState(session).version},narrative:narrativeForBranch(branch)};
      const record={index:report.turns.length+1,startedAt:new Date().toISOString(),request,status:'pending'};report.turns.push(record);await save();
      const before=JSON.stringify(session),started=performance.now();
      try{
        assert.ok(report.actualHttpRequests<report.requestLimit);report.actualHttpRequests++;await save();
        const response=await fetch(endpoint+'/api/generate',{method:'POST',headers:{'content-type':'application/json',origin:endpoint},body:JSON.stringify(request),signal:AbortSignal.timeout(200000)});
        record.httpStatus=response.status;record.result=await response.json();record.elapsedMs=Math.round(performance.now()-started);await save();assert.equal(response.status,200);
        assert.ok(record.result.narrative,'This evaluation requires the planned pipeline');
        const committed=commitTurn(session,world,step.input,record.result,branch.id);
        record.committedTurn=clone(committed);record.publicSituation=publicSituation(branch,world);record.checks=[];
        const check=(name,fn)=>{try{fn();record.checks.push({name,passed:true});}catch(error){record.checks.push({name,passed:false,message:error.message});}};
        check('event and experience replay',()=>assert.deepEqual(committed.state,applyEvents(request.state,record.result.events,record.result.experience)));
        check('archive roundtrip',()=>assert.deepEqual(validateArchive(JSON.parse(JSON.stringify(archive()))),archive()));
        check('private sentinels excluded from public projection',()=>assert.doesNotMatch(JSON.stringify(record.publicSituation),/FT426_PRIVATE/));
        check('public history excludes private flags and events',()=>assert.doesNotMatch(JSON.stringify(historyEntries(branch,'')),/FT426_PRIVATE/));
        check('private fixed flag unchanged',()=>assert.equal(committed.state.flags['ft426-afternoon:private-marker'],'FT426_PRIVATE_FLAG'));
        record.newPersonObjects=record.publicSituation.objects.filter(o=>o.kind==='person'&&!world.characters.some(c=>o.id===`person:${c.id}`));
        record.clock=record.publicSituation.clock;record.stop=record.result.experience?.stop??null;
        record.status=record.checks.every(c=>c.passed)?'structurally-accepted':'structural-failure';
        console.log(JSON.stringify({index:record.index,status:record.status,httpStatus:record.httpStatus,elapsedMs:record.elapsedMs,prose:record.result.prose,clock:record.clock,stop:record.stop,newPersonObjects:record.newPersonObjects,ended:record.result.ended},null,2));
        if(record.status!=='structurally-accepted')break;
      }catch(error){record.elapsedMs=Math.round(performance.now()-started);record.status='failed';record.error={name:error.name,message:error.message};record.failureLeftSessionUnchanged=JSON.stringify(session)===before;console.log(JSON.stringify({index:record.index,status:record.status,error:record.error,result:record.result}));break;}
      finally{await save();}
    }
  }finally{report.finishedAt=new Date().toISOString();report.status=report.turns.length===2&&report.turns.every(t=>t.status==='structurally-accepted')?'structurally-accepted':'failed';report.elapsedMs=report.turns.reduce((n,t)=>n+(t.elapsedMs||0),0);await save();console.log(JSON.stringify({file,status:report.status,actualHttpRequests:report.actualHttpRequests,elapsedMs:report.elapsedMs,semanticReview:report.semanticReview}));if(report.status==='failed')process.exitCode=1;}
}
