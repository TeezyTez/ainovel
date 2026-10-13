// Independent fictional cases only. No source-archive option and no ledger writes.
// Structural success is deliberately separate from the manual reading assessment.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {modelConfig,requestModelJSON} from '../src/server-model.mjs';
import {generateStory} from '../src/server-story.mjs';
import {createSession,getBranch,commitTurn,validateArchive} from '../src/core.js';
import {STORY_SYSTEM,STORY_PROMPT_VERSION} from '../src/story-prompts.mjs';

if(!process.argv.includes('--live')){console.log('Use node --env-file-if-exists=.env scripts/verify-story-quality.mjs --live for independent fictional cases.');process.exit(0);}
const config=modelConfig(process.env);
const selection=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7).split(',');
const sources=['src/story-prompts.mjs','src/server-story.mjs'];
const sourceHash=async()=>createHash('sha256').update((await Promise.all(sources.map(path=>fs.readFile(path,'utf8')))).join('\0')).digest('hex');
const cases=[
 {id:'recap',opening:'雨水拍在渡口候船室的窗上。穿蓝外套的维修员把手电放在柜台上：“叫我周宁。我正修窗，不知道船什么时候能来。”无线电另一端的值班员自称老陶，说自己在东堤岗亭，只见到江上能见度变差，没收到停航通知。周宁继续把遮雨布绑到破窗上。',input:'先别推进剧情，整理一下我已经遇到的人分别在哪里，知道什么。',review:['直接区分眼前的周宁与无线电另一端的老陶，不增加出场人物。','回顾不创造新事实、行动或时间经过。','不以整段复述或等待玩家选择的模板结尾。']},
 {id:'inspect',opening:'候船室后门落着插销，下方渗进一线雨水。你已走到门边，门旁地面干燥，手中的手电能照清门框。门外有沉重的拖步声，不能确定是谁。周宁正在你身后把遮雨布绑到破窗上。',input:'不打开门。我用手电检查插销、门缝和水从哪儿进来，先确认这扇门关得牢不牢。',review:['给出可见的插销、门缝和渗水检查结果，或具体可理解的观察限制。','不替玩家开门、出门或接触门外未知人物。','周宁的工作与眼前场景连续，不冻结所有人等待回答。']},
 {id:'background',opening:'雨水拍在渡口候船室的窗上。维修员把手电放在柜台上：“我是周宁。”你看见墙边亮着一台备用电源，桌上摊着通向东堤岗亭的旧路线图。无线电暂时没有声音。',input:'先别出发，帮我弄清现在留下和沿东堤去岗亭，各自有什么实际条件。',review:['清楚比较留下和去岗亭，不替玩家选择或出发。','后台的电量与道路经历首次用于判断时交代显示屏、人物说明等可接触来源。','不把这些新消息写成玩家早已知道，不透露隐藏信件。']}
].filter(item=>!selection||selection.includes(item.id));
if(!cases.length)throw new Error('No matching independent fixture.');
const originalHash=await sourceHash(),started=Date.now(),output=`test-results/story-quality-${started}.json`;
const report={promptVersion:STORY_PROMPT_VERSION,authorPromptChars:STORY_SYSTEM.length,model:config.model,sourceHash:originalHash,cases:[],manualAssessment:'pending'};
await fs.mkdir('test-results',{recursive:true});
const save=()=>fs.writeFile(output,JSON.stringify(report,null,2));await save();
for(const item of cases){
 const world={id:'quality-'+item.id,version:1,title:'雨夜渡口',identity:'避雨的旅客',location:'渡口候船室',description:'普通现实中的渡口雨夜。',rules:['没有超自然现象。','门外声音的来源尚未查明。'],characters:[{id:'repairer',name:'周宁',role:'维修员',public:'正在修补窗户。',goal:'把候船室破窗挡住。',history:'她傍晚走过东堤，桥头的铁栏门已经上锁，小路只能抵达栏门前。',secret:'她的工具箱里藏着未寄出的辞职信。'},{id:'keeper',name:'陶岳',role:'值班员',public:'人在东堤岗亭。',goal:'等到下一班换岗。',history:'',secret:''}],experience:{pressure:'备用电源显示屏目前显示可用二十八分钟。'},opening:item.opening};
 const session=createSession(world,{},'real'),branch=getBranch(session),run={id:item.id,input:item.input,opening:item.opening,criteria:item.review,stages:[],calls:[]};report.cases.push(run);await save();
 try{
  const proposal=await generateStory({requestId:'independent-'+item.id,world,state:branch.initialState,player:session.player,preferences:session.preferences,input:item.input,memory:[],recent:[],branchId:branch.id},config,AbortSignal.timeout(180000),{
   onProgress:stage=>run.stages.push({stage,elapsedMs:Date.now()-started}),
   requestJSON:async(c,system,content,signal,options)=>{const time=Date.now(),data=JSON.parse(content),call={stage:options.schema.required.includes('prose')?'writing':'checking',systemChars:system.length,contextChars:content.length,...(data.validationIssue?{validationIssue:data.validationIssue}:{})};run.calls.push(call);try{call.output=await requestModelJSON(c,system,content,signal,options);return call.output;}catch(error){call.error=error.message;throw error;}finally{call.durationMs=Date.now()-time;await save();}}
  });
  run.prose=proposal.prose;run.events=proposal.events;run.recordedObjects=proposal.experience?.objects??[];
  commitTurn(session,world,item.input,proposal);validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});
  run.structuralPassed=true;run.callCount=run.calls.length;
 }catch(error){run.structuralPassed=false;run.error=error.message;run.diagnostic=error.diagnostic;}
 await save();
}
report.sourceUnchanged=(await sourceHash())===originalHash;
report.structuralPassed=report.sourceUnchanged&&report.cases.every(item=>item.structuralPassed);
report.elapsedMs=Date.now()-started;await save();
console.log(JSON.stringify({output,structuralPassed:report.structuralPassed,manualAssessment:report.manualAssessment,sourceUnchanged:report.sourceUnchanged,cases:report.cases.map(item=>({id:item.id,structuralPassed:item.structuralPassed,callCount:item.callCount,error:item.error,diagnostic:item.diagnostic})),elapsedMs:report.elapsedMs}));
if(!report.structuralPassed)process.exitCode=1;
