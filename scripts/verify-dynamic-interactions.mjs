// Content-only acceptance inputs. No scenario IDs are imported by application code.
import {mkdir,writeFile,readFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {modelConfig} from '../src/server-model.mjs';
import {createSession,validateArchive} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {dynamicModel} from '../src/server-dynamic-model.mjs';
import {dynamicRequest,dynamicView} from '../src/dynamic-ui.js';
try{process.loadEnvFile('.env');}catch{}
const cases=[
  ['merchant','商人明确同意按每瓶3枚卖给你药水。你有10枚钱，他有5瓶库存，你持有0瓶。购买时同时扣钱、扣库存并增加持有量。商人只声称药水能退烧，没人验证。你想比较并买2瓶。',[['money','钱',10],['stock','商人库存药水',5],['held','持有药水',0]],'我买2瓶药水',true],
  ['comparison','两封公开航报互相矛盾：北路报告是昨天船员的说法，南路报告是今天亲眼所见。你希望并排比较来源、时间与可信程度，尚未选择路线。',[],'比较两份报告',false],
  ['allocation','井边有12桶公共水。大家已同意你自主将水分配给菜圃和饮用储备，合计不能超过12桶；菜圃至少3桶，饮用至少4桶。当前两处都是0桶。你想先分配5桶和6桶，再核对余量。',[['pool','公共水',12],['garden','菜圃水',0],['drink','饮用水',0]],'菜圃分5桶，饮用分6桶，其余留下',true],
  ['calibration','实验台允许你先选低温或高温，再输入运行批次，最后核对后执行。低温每批消耗2格电，高温每批消耗4格电；每批产出1块试片。电池有20格，试片为0块。仪器守则已经确认，操作无需他人批准。',[['power','电池',20],['sample','试片',0]],'选择低温，运行3批',true],
  ['packing','撤离前你可从工具、食品、信件中多选装入行囊。工具重4斤、食品重3斤、信件重1斤，承重上限5斤。它们均是你的物品，当前都标为未装入。提交时只把选中物标为已装入，不能重复装载。',[['tool','工具',null,'未装入'],['food','食品',null,'未装入'],['letter','信件',null,'未装入']],'把工具和信件装入',true],
  ['negotiation','馆员正在考虑是否允许你查阅一份私人书信。她尚未答应，坚持先听研究目的和保密安排。没有公式能保证她同意。你想提出条件并听她判断。',[['archivist','馆员',null,'尚未同意']],'我说明研究用于家族寻亲，并承诺不公开他人姓名，问她是否愿意开放查阅',false],
  ['schedule','两台望远镜的公开空档如下：甲在20:00和21:00空闲，乙仅在21:00空闲。你已获得独立预约一个空档的授权。三个时段都尚未预约。先选设备，再选可用时段，确认后将且仅将该时段标为已预约。',[['a20','甲20:00',null,'空闲'],['a21','甲21:00',null,'空闲'],['b21','乙21:00',null,'空闲']],'预约乙21:00',true],
  ['assembly','临时修复规程由工程师当场明确：先选择双层或单层支撑，再输入跨度1至3米；单层每米用2根木条，双层每米用3根；只有双层且跨度不超过2米才可加装遮雨布，加装需要1张布。你有12根木条和2张布，完成件为0。你有执行授权。依次准备支撑、跨度、是否加布，然后核对扣料，提交才增加1个完成件。',[['wood','木条',12],['cloth','遮雨布',2],['built','完成件',0]],'采用双层，跨度2米，加装遮雨布，执行制作',true],
  ['ballot','社区让你整理三个备选提案的支持理由和反对意见，再记录自己的一票。甲方案节省空间却噪声大；乙方案安静但占地多；丙方案成本不明，不能编成已知数字。你尚未投票，只有你可以决定，投票将个人选票状态改为选中的提案，不宣布集体通过。',[['vote','你的选票',null,'未投票']],'我投乙方案',true],
  ['evidence','你正在重建一段事故时间线：门卫声称18时看到红车；独立录像确认18:10有人步行离开；两者未必相关。需要按时间比较来源并记下待核问题，不应替你断定谁说谎，也没有可保证的破案操作。',[],'整理时间和证据来源',false],
  ['ration','远行补给协议已确认：从10份干粮中交给同伴一部分，交付量必须1到4份且自己至少保留6份。同伴现有0份。先填写数量并预览双方余量，确认才转移。',[['self','你的干粮',10],['other','同伴的干粮',0]],'给同伴3份干粮',true],
  ['quiet','雨声落在屋檐上。你安静地读着旧书，此刻没有需要决定或整理的事项。',[],'继续安静阅读',false,'none'],
  ['chat','商人收了摊，和你闲聊故乡的梅花。他没有提供商品或报价，你也没有购物意图。',[],'听他讲故乡',false,'none'],
  ['rest','风渐渐停了。你坐在长椅上看晚霞，不想计划或操作什么。此刻只需一段安静的文字。',[],'继续看晚霞',false,'none'],
];
const files=['src/dynamic-rules.js','src/server-dynamic.mjs','src/server-dynamic-model.mjs','src/dynamic-ui.js','src/core.js','server.mjs'];
const hash=createHash('sha256');for(const f of files)hash.update(f).update(await readFile(f));const implementationHash=hash.digest('hex');
if(!process.argv.includes('--live')){console.log(JSON.stringify({cases:cases.length,unknownScenes:10,noInterface:3,implementationHash,note:'配置检查；未调用真实模型。使用 --live 执行。'},null,2));process.exit(0);}
const out=resolve('test-results','dynamic-live-'+new Date().toISOString().replaceAll(':','-')),dir=await mkdtemp(join(tmpdir(),'elselife-live-'));
await mkdir(out,{recursive:true});const config=modelConfig(process.env),results=[],manifest={implementationHash,files,model:config.model,provider:config.kind,startedAt:new Date().toISOString(),ledger:dir,usage:'transport does not expose token usage',cases:results};await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
const selected=process.argv.find(v=>v.startsWith('--case='))?.slice(7);
async function run(c){const [id,opening,entries,intent,execute,expect]=c,folder=join(out,id);await mkdir(folder,{recursive:true});const world={id:'live-'+id,version:1,title:'动态交互验证 · '+id,location:'当前场景',identity:'当事人',rules:[opening],opening,characters:[]},session=createSession(world,{},'real'),branch=session.branches[0];
  if(entries.length)branch.initialState.game={schemaVersion:1,entities:entries.map(([id,name,value,status='已知'])=>({id,name,value,status,kind:value===null?'objective':'meter',max:null,detail:'以开场完整说明为准',unit:'',quote:opening,sourceVersion:0})),surfaces:[]};
  const ledger=new BranchLedger(dir);await ledger.register('isolated-live',{session,worlds:[world]});const traces=[];const model=async(config,kind,context,signal)=>{const start=Date.now();try{const r=await dynamicModel(config,kind,context,signal);traces.push({kind,context,...r});await writeFile(join(folder,'model.json'),JSON.stringify(traces,null,2));return r;}catch(e){traces.push({kind,context,error:{code:e.code,message:e.message},durationMs:Date.now()-start});await writeFile(join(folder,'model.json'),JSON.stringify(traces,null,2));throw e;}};
  const svc=new DynamicInteractions(ledger,config,{model}),signal=new AbortController().signal,body={sessionId:session.id,branchId:branch.id,baseVersion:0,intent};const result={id,intent,expected:expect??'interface',execute,passed:false};
  try{const prepared=await svc.prepare('isolated-live',body,signal),saved=prepared.authoritativeBranch.dynamic;await writeFile(join(folder,'prepared.json'),JSON.stringify(prepared,null,2));result.interface=!!saved.definition;result.fallback=saved.reason; if(expect==='none'){if(saved.definition||saved.reason)throw new Error('Expected a deliberate null decision, not an error fallback');}
    else {if(!saved.definition)throw new Error('No validated interaction: '+saved.reason);const params=Object.fromEntries(saved.definition.fields.filter(f=>f.default!==undefined).map(f=>[f.id,f.default]));await writeFile(join(folder,'render.html'),dynamicView(saved.definition,prepared.authoritativeBranch.initialState,params));result.steps=saved.definition.steps.length;result.actionModes=saved.definition.actions.map(a=>a.mode);
      if(execute){const executed=await svc.input('isolated-live',{...body,input:intent,requestId:'live-'+id},signal);if(!executed.operationId)throw new Error('Intent did not execute through saved rules: '+JSON.stringify(executed));const duplicate=await svc.input('isolated-live',{...body,input:intent,requestId:'live-'+id},signal);if(duplicate.operationId!==executed.operationId)throw new Error('Duplicate mismatch');await writeFile(join(folder,'executed.json'),JSON.stringify(executed,null,2));const narrated=await svc.narrate('isolated-live',{...body,operationId:executed.operationId},signal);await writeFile(join(folder,'narrated.json'),JSON.stringify(narrated,null,2));if(narrated.authoritativeBranch.turns.at(-1).narration.status!=='complete')throw new Error('Narration failed after committed operation');result.receipt=narrated.authoritativeBranch.turns.at(-1).operation.receipt;}
    }
    const data=await new BranchLedger(dir).load('isolated-live',session.id);const archive=validateArchive({schemaVersion:1,worlds:[world],sessions:[data.session]});await writeFile(join(folder,'archive.json'),JSON.stringify(archive,null,2));result.passed=true;
  }catch(e){result.error=e.message;}
  results.push(result);await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(result));
}
const queue=cases.filter(c=>!selected||selected.split(',').includes(c[0]));await Promise.all(Array.from({length:2},async()=>{while(queue.length)await run(queue.shift());}));manifest.finishedAt=new Date().toISOString();await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log('Evidence: '+out);if(results.some(r=>!r.passed))process.exitCode=1;
