// Opt-in real Codex check; uses an isolated in-memory story, never user saves.
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createSession,currentState,commitTurn,validateArchive} from '../src/core.js';
import {modelConfig} from '../src/server-model.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {projectSpatialMap} from '../src/spatial-state.js';
if(!process.argv.includes('--live')){console.log('Pass --live to run one actual model turn.');process.exit(0);}
const path='test-results/spatial-live.json';
let previous=[];
try{const old=JSON.parse(await readFile(path,'utf8'));if(!process.argv.includes('--retry')||old.status!=='failed')throw new Error('Existing evidence retained; use --retry only after a failed check.');previous=[...(old.previousAttempts??[]),{status:old.status,error:old.error,diagnostic:old.diagnostic,elapsedMs:old.elapsedMs}];}catch(error){if(error.code!=='ENOENT')throw error;}
const world={id:'spatial-live-world',version:1,title:'地理验收 · 潮汐港',description:'独立真实生成验收故事',location:'港口',identity:'测绘员',rules:['现实港湾，地理和路线不随剧情改写。','只呈现玩家已经观察到的地理。不开启支付或其他服务。'],characters:[{id:'lin',name:'林舟',public:'正在抢修灯塔电路的守灯人',secret:''}],opening:'港口旁立着旧测绘碑：广场位于港口正北300米；松林位于广场正东400米；灯塔位于广场正西200米。港口和广场之间的石路可以双向通行。广场到灯塔的栈桥因昨日塌损而封锁。灯塔内有大厅与档案室，档案室位于大厅正东，距离未测。林舟递来一张缺角的维修单，广场上已经有人在为今晚的船期争吵。'};
const session=createSession(world,{name:'地图验收员'},'real');
const input='我先核对测绘碑和眼前的道路，问林舟今晚要怎样保障船只入港，暂时不出发。';
const started=Date.now();const report={startedAt:new Date().toISOString(),world,status:'running',previousAttempts:previous};
await mkdir('test-results',{recursive:true});await writeFile(path,JSON.stringify(report,null,2));
try{
 const config=modelConfig(process.env);
 const result=await generateNarrative({requestId:crypto.randomUUID(),world,state:currentState(session),player:session.player,preferences:session.preferences,memory:[],recent:[],input},config,new AbortController().signal);
 commitTurn(session,world,input,result);const archive={schemaVersion:1,worlds:[world],sessions:[session]};validateArchive(archive);
 const game=currentState(session).game;if(!game?.spatial?.relations.length)throw new Error('Actual model did not produce persistent geography.');
 const projection=projectSpatialMap(game);Object.assign(report,{status:'passed',elapsedMs:Date.now()-started,result,spatial:game.spatial,placed:projection.positions.size});
 await writeFile('test-results/spatial-live-archive.json',JSON.stringify(archive,null,2));
 console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,sites:game.spatial.sites.length,relations:game.spatial.relations.length,placed:report.placed}));
}catch(error){Object.assign(report,{status:'failed',elapsedMs:Date.now()-started,error:error.message,code:error.code,diagnostic:error.diagnostic});process.exitCode=1;console.log(JSON.stringify({status:report.status,error:report.error,code:report.code,diagnostic:report.diagnostic}));}
await writeFile(path,JSON.stringify(report,null,2));
