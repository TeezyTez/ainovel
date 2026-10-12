// Creates fresh, independent import files. Does not read/change browser storage,
// server ledgers, existing user sessions, or any previously exported archive.
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {currentState,validateArchive} from '../src/core.js';
import {journeyOptions} from '../src/journey-state.js';
import {createWorkshopFixture,WORKSHOP_FIXTURE_NOTICE,WORKSHOP_CONSTANTS} from '../tests/fixtures/workshop-world.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const outputDir=path.join(root,'test-results');
await mkdir(outputDir,{recursive:true});
const save=async(name,value)=>{const file=path.join(outputDir,name);await writeFile(file,JSON.stringify(value,null,2)+'\n','utf8');return file;};
const delivery=createWorkshopFixture(),operation=createWorkshopFixture({operation:true});
for(const fixture of [delivery,operation])validateArchive(fixture.archive);
const deliveryFile=await save('workshop-playable.json',delivery.archive);
const operationFile=await save('workshop-operation-playable.json',operation.archive);

let testOutput='',testStatus='failed';
try{
  testOutput=execFileSync(process.execPath,['--test','--test-reporter=tap','tests/core-play-scenarios.test.mjs'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
  testStatus='passed';
}catch(error){testOutput=String(error.stdout??'')+String(error.stderr??'');process.exitCode=1;}
const testOutputFile=path.join(outputDir,'workshop-core-tests.tap');
await writeFile(testOutputFile,testOutput,'utf8');
const report=await save('workshop-check-report.json',{
  generatedAt:new Date().toISOString(),notice:WORKSHOP_FIXTURE_NOTICE,sourceDocument:'方糖_核心游戏交互功能设计_2026-10-12.md 第10章、第13章',
  fixedConfiguration:WORKSHOP_CONSTANTS,
  files:{delivery:deliveryFile,operation:operationFile,testOutput:testOutputFile},
  stateContractTests:{status:testStatus,tests:Number(testOutput.match(/^# tests (\d+)/m)?.[1]??0),passed:Number(testOutput.match(/^# pass (\d+)/m)?.[1]??0),failed:Number(testOutput.match(/^# fail (\d+)/m)?.[1]??0),command:'node --test --test-reporter=tap tests/core-play-scenarios.test.mjs',method:'Explicit fixed proposals committed through core.commitTurn; current offered actions resolved through resolveGameAction. No model, browser, or network call.'},
  browserPlaytest:{status:'not-run-by-this-script',mode:'real',instructions:'通过设置里的导入记录选择对应JSON，然后在我的故事继续。导入创建副本并保留原故事；不要替换整份浏览器本地数据。自由输入需要已连接的真实Codex服务。',
    deliveryStart:{sessionId:delivery.session.id,worldId:delivery.world.id,time:currentState(delivery.session).time,location:currentState(delivery.session).location,cash:6,request:'尚未接受',watch:'唐棠所有，在工作台，由店铺保管'},
    routePreview:journeyOptions(currentState(delivery.session),'dock').map(o=>({id:o.route.id,label:o.route.label,minutes:o.route.minutesMin,cost:o.route.costs[0]?.amount??0,arrival:o.arrival})),
    currentActions:['周围 → 唐棠的怀表 → 拿起怀表／仔细检查','周围 → 待修的座钟 → 研究座钟','地图 → 码头 → 比较市集大路、河岸小路、摆渡 → 明确出发'],
    freeInputs:[
      {scenario:'A',input:'我去送，拿上怀表，沿河岸过去。',expected:'14:20在码头，现金6，怀表随身；再明确交还并收4银币后现金10。'},
      {scenario:'B',input:'我答应送表，先拿上怀表。',next:'地图中选择摆渡并出发；到达后把表交给唐棠并收取约定修理费。',expected:'14:15在码头，现金4；交表收款后现金8。'},
      {scenario:'C',input:'先去材料铺花不超过3银币买根主发条，再把表送到码头。',next:'收到预计14:45晚到的提示后，确认仍然这样走。',expected:'现金3，主发条1根，14:45在码头，船已离开，怀表仍保留。'},
      {scenario:'D',input:'我不去，请阿岑替我送。他不愿意就算了，我留下看店。',expected:'阿岑请求、回应、拿表和出发分别成立；玩家留店；收到回报前不显示实时进度。'},
      {scenario:'E',input:'今天不送了，改天在店里交还。我先研究那座待修的钟。',expected:'送表请求不再催促；唐棠尚未同意改期；怀表保留并继续平静修理。'}
    ],
    operationInputs:[{input:'正常开店三天，不借钱。她来取表时停，我自己聊。',expected:'第9日14:00来访处停下，现金4，只记两天日常支出，不代做第三天或交表收款。'},{input:'留在店里等唐棠，最晚等到今天14:30；没来就停下。',expected:'第7日14:30平静结束等待，现金6。此项应从经营初始档另试。'}]
  },
  limitations:['脚本没有执行实际浏览器试玩，手机布局、中文输入法、焦点、离线与请求停止仍需实际验收。','固定proposal通过只证明所测状态链和校验路径能成立，不证明模型会自动选出正确剧情、时间冲突提醒或授权边界。','归档故意没有秘密地图数据；后台秘密裁剪另以核心测试中的明确hidden事件检验。']
});
console.log(JSON.stringify({archives:[deliveryFile,operationFile],report,tests:testStatus,notice:WORKSHOP_FIXTURE_NOTICE},null,2));
