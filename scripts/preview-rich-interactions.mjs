// Isolated browser acceptance fixture. No real model and no player ledger are used.
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
import {ApiError} from '../src/server-model.mjs';
import {createServer} from '../server.mjs';
import {createSession,commitTurn,validateArchive} from '../src/core.js';
import {gameTurnView} from '../src/game-ui.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {defaultSettings,STORAGE_KEY} from '../src/storage.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {ADDITIONAL_WORLDS} from '../src/situations.js';

const world={id:'rich-browser-fixture',version:1,title:'雾港的两条路 · 交互验收',location:'旧灯塔',identity:'记录员',characters:[],rules:['只使用公开资料，不预先决定路线。'],opening:'暮色漫过旧灯塔，林岑把两份航报摊在桌上。北线是昨天船员的说法，步行约30分钟；南线是今天守望员亲眼所见，步行约20分钟。两条路的安全都还没有确认。你有6枚银币、3份干粮。桌上有一封未拆的蓝色信封。'};
const views=[
  {type:'table',title:'先把两条路放在一起',caption:'路线时长来自公开航报；安全情况仍需核实。',columns:['路线','步行分钟','消息来源','安全情况'],rows:[['北线',30,'昨天 · 船员转述','未确认'],['南线',20,'今天 · 守望员目击','未确认']]},
  {type:'diagram',title:'两份消息从哪里来',layout:'flow',nodes:[{id:'sailor',label:'船员',detail:'昨天的口头航报',prompt:'我向船员询问北线消息的来源。'},{id:'you',label:'你',detail:'尚未选择路线'},{id:'watch',label:'守望员',detail:'今天的亲眼所见',prompt:'我向守望员核实南线的情况。'}],edges:[{from:'sailor',to:'you',label:'北线 · 转述',dashed:true},{from:'watch',to:'you',label:'南线 · 目击'}]},
  {type:'cards',title:'在决定之前',items:[{title:'核对北线航报',body:'昨天的消息可能已经过时。先问清观察的时间与位置。',tag:'待核实',prompt:'我想先核对北线航报的观察时间。'},{title:'听守望员说完',body:'亲眼所见也只覆盖他看到的那一段。',tag:'继续了解',prompt:'我请守望员详细描述他亲眼看到的路段。'}]},
  {type:'chart',title:'公开的步行时间',unit:'分钟',items:[{label:'北线',value:30},{label:'南线',value:20}]},
  {type:'timeline',title:'消息的先后',items:[{time:'昨天',title:'船员的航报',body:'北线需要约30分钟；安全未确认。',tag:'他人说法'},{time:'今天',title:'守望员的目击',body:'南线需要约20分钟；安全未确认。',tag:'目击报告'}]},
  {type:'illustration',title:'灯下的蓝色信封',description:'依据这一幕绘制的概念示意，位置与比例不作为剧情事实。',width:640,height:260,elements:[{shape:'circle',cx:485,cy:70,r:34,fill:'soft',stroke:'none'},{shape:'rect',x:70,y:180,width:500,height:12,fill:'muted',stroke:'none'},{shape:'rect',x:220,y:90,width:200,height:112,fill:'#ccdce9',stroke:'#557892',rx:6},{shape:'path',d:'M 220 90 L 320 158 L 420 90',stroke:'#557892'},{shape:'line',x1:485,y1:105,x2:485,y2:180,stroke:'muted',strokeWidth:4},{shape:'text',x:45,y:48,text:'傍晚 · 旧灯塔',fontSize:18,fill:'muted'}]}
];
const definition={schemaVersion:1,id:'harbor-reading',revision:1,title:'离开灯塔之前',summary:'把已知的消息、尚待核实的部分和接下来可以问的问题放在一起。',fields:[],steps:[],actions:[],view:views};

// Saved, public map facts for visual acceptance. These demo sessions never call
// the model, reuse a player session, or enter the server's private story ledger.
function mapFixture(scene){
  const dense=scene==='dense';
  const names=dense?{
    center:'雾港中央航务广场',north:'北堤水闸与旧防潮石阶',east:'东岸长堤集市及船匠作坊',south:'临河仓库南侧货运门廊',west:'西埠旧灯塔旁的观潮台',
    northeast:'东北盐仓后的松林小径',northwest:'西北巡灯人值守的钟楼',southeast:'东南潮汐档案馆与阅览室',southwest:'西南旧渡口的候船长廊'
  }:{center:'旧灯塔一层的临窗记录室',archive:'港务档案馆与沿河阅览室',market:'旧货市场深处挂着蓝灯的修理铺'};
  const introduction=dense?`你停在${names.center}，展开守望员刚核对的沿岸记录。纸上的地点、距离与通路都有清楚的出处。`:`你停在${names.center}。手记还记着${names.archive}和${names.market}，但没有写明三个地点之间的方位、距离或通路。`;
  const bearings={N:'北',E:'东',S:'南',W:'西'};
  const measurements=dense?[
    ['center','north','N',300],['center','east','E',400],['center','south','S',300],['center','west','W',400],
    ['north','northeast','E',400],['north','northwest','W',400],['south','southeast','E',400],['south','southwest','W',400]
  ]:[];
  const relative=measurements.map(([from,to,bearing,distanceMeters],index)=>({id:`bearing-${index}`,from,to,kind:'relative',bearing,distanceMeters,passage:'unknown',bidirectional:false,label:'',quote:`${names[to]}位于${names[from]}正${bearings[bearing]}${distanceMeters}米。`}));
  const routes=dense?[
    ['center','north','临河石路','open'],['center','east','船匠长街','open'],['center','south','货运连廊','open'],['center','west','旧堤栈桥','blocked'],['north','northeast','松林小径','unknown']
  ].map(([from,to,label,passage],index)=>({id:`route-${index}`,from,to,kind:'route',bearing:null,distanceMeters:null,passage,bidirectional:true,label,quote:`${names[from]}与${names[to]}之间的${label}${passage==='open'?'可以双向通行':passage==='blocked'?'已经封锁':'通行情况还没有确认'}。`})) : [];
  const prose=[introduction,...relative.map(r=>r.quote),...routes.map(r=>r.quote)].join('\n\n');
  const mapWorld={id:`map-${scene}-browser-fixture`,version:1,title:dense?'雾港沿岸 · 稠密地图验收':'灯下手记 · 地点记录验收',location:names.center,identity:'记录员',characters:[],rules:['只展示已保存的公开地理记录。'],opening:dense?'傍晚，你在航务广场停下脚步。守望员递来一张刚刚核对过的地图。':'灯塔里的风停了。你翻开手记，重新看看几处尚未弄清位置的地点。'};
  const entities=Object.entries(names).map(([id,name])=>({id,kind:'place',name,detail:'',status:'',value:null,max:null,unit:'',quote:prose.split('\n\n').find(sentence=>sentence.includes(name))}));
  const mapSession=createSession(mapWorld,{},'demo');mapSession.id=`map-${scene}-preview-session`;
  const turn=commitTurn(mapSession,mapWorld,'查看地图',{requestId:`map-${scene}-fixture-turn`,baseVersion:0,prose,events:[],game:{entities,surfaces:[{id:`map-${scene}-surface`,kind:'map',title:dense?'沿岸地点与已知路线':'手记中的三处地点',description:'',entityIds:Object.keys(names),links:[],actions:[],quote:introduction}],spatial:{sites:entities.map(e=>({id:e.id,terrain:e.id==='northeast'?'forest':e.id==='northwest'||e.id==='southeast'?'building':'landmark',parentId:null,quote:e.quote})),relations:[...relative,...routes]}}});
  return {scene,world:mapWorld,session:mapSession,turn};
}
const mapFixtures={dense:mapFixture('dense'),sparse:mapFixture('sparse')};
const mapArchive=validateArchive({schemaVersion:1,worlds:Object.values(mapFixtures).map(f=>f.world),sessions:Object.values(mapFixtures).map(f=>f.session),settings:{...defaultSettings,interactionDensity:'adaptive'},telemetry:[]});

const model=async(_config,kind,context)=>{
  if(kind==='prepare'){
    const intent=context.intent||'',type=/SVG|插画/i.test(intent)?'illustration':/表格/.test(intent)?'table':/关系|流程/.test(intent)?'diagram':/柱状|数据图/.test(intent)?'chart':/时间线/.test(intent)?'timeline':null;
    return {value:{...definition,view:type?views.filter(v=>v.type===type):views},metrics:{kind,durationMs:0}};
  }
  return {value:{approved:true},metrics:{kind,durationMs:0}};
};
const directory=await mkdtemp(join(tmpdir(),'rich-browser-')),owner='rich-browser-owner-12345678901234567890',session=createSession(world,{},'real'),branch=session.branches[0],ledger=new BranchLedger(directory);
await ledger.register(owner,{session,worlds:[world]});
await new DynamicInteractions(ledger,{}, {model}).prepare(owner,{sessionId:session.id,branchId:branch.id,baseVersion:0},new AbortController().signal);
const data=await ledger.load(owner,session.id),archive={schemaVersion:1,worlds:data.worlds,sessions:[data.session],settings:{...defaultSettings},telemetry:[]};
const fixtureAttempts=new Set();
const previewNarrate=async(body,config,signal,{onProgress}={})=>{
 onProgress?.('writing');await delay(4000,undefined,{signal});
 onProgress?.('checking');await delay(4000,undefined,{signal});
 if(body.input.includes('失败验收')&&!fixtureAttempts.has(body.requestId)){fixtureAttempts.add(body.requestId);throw new ApiError(502,'PREVIEW_RETRY','验收用暂时失败，故事进度没有改变。');}
 return {requestId:body.requestId,baseVersion:body.state.version,prose:'林岑将蓝色信封推到灯下，纸面上留下了雨水的痕迹。\n\n“这就是目前的航报。”她说，指尖停在落款旁。窗外的雾仍很浓，钟楼传来一声低响。',events:[]};
};
const server=createServer({ledgerDirectory:directory,env:{MODEL_API_KEY:'fixture-only',MODEL_NAME:'fixture',MODEL_BASE_URL:'http://localhost:1'},dynamicModel:model,narrate:previewNarrate}),handler=server.listeners('request')[0];
const fixtureWorldIds=[world.id,...mapArchive.worlds.map(w=>w.id)];
const seedableWorlds=[world,...mapArchive.worlds,...PRESET_WORLDS,...ADDITIONAL_WORLDS];
function canReplaceFixtureArchive(existing,fixtureIds,unchangedWorlds){
  // Object key order may change during persistence. Array order and every
  // property value must still exactly match a known fixture or bundled world.
  const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  const originals=new Set(unchangedWorlds.map(canonical));
  return Array.isArray(existing.sessions)&&Array.isArray(existing.worlds)&&existing.sessions.every(s=>fixtureIds.includes(s.worldId))&&existing.worlds.every(w=>originals.has(canonical(w)))&&!existing.worldDraft&&!existing.feedback?.length;
}
function sendSeed(res,seedArchive,targetId){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  const seed=JSON.stringify(JSON.stringify(seedArchive)).replaceAll('<','\\u003c');
  const knownWorlds=JSON.stringify(seedableWorlds).replaceAll('<','\\u003c');
  res.end(`<!doctype html><meta charset="utf-8"><title>交互验收 · 固定数据</title><body><script>(()=>{try{const raw=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(raw){const existing=JSON.parse(raw);if(!(${canReplaceFixtureArchive.toString()})(existing,${JSON.stringify(fixtureWorldIds)},${knownWorlds})){document.body.textContent='这个预览地址含有非验收资料，未写入任何数据。请使用新的独立预览端口。';return;}}localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${seed});localStorage.setItem('fangtang:owner:v1',${JSON.stringify(owner)});location.replace('/#/story/${targetId}');}catch{document.body.textContent='预览初始化未完成，请检查这个独立地址的本地存储。';}})();</script>`);
}
server.removeAllListeners('request');
server.on('request',(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__fixture'){sendSeed(res,archive,session.id);return;}
  if(url.pathname==='/__map-fixture'){const fixture=mapFixtures[url.searchParams.get('scene')==='sparse'?'sparse':'dense'];sendSeed(res,mapArchive,fixture.session.id);return;}
  return handler(req,res);
});
const port=Number(process.env.RICH_PREVIEW_PORT)||4174;
if(process.argv.includes('--check')){
  validateArchive(archive);
  const render=f=>gameTurnView(f.turn,{currentVersion:1,branchId:f.session.activeBranch,density:'adaptive'});
  const dense=render(mapFixtures.dense),sparse=render(mapFixtures.sparse);
  assert.equal((dense.match(/class="atlas-place(?: is-current)?"/g)||[]).length,9);
  assert.match(dense,/atlas-route-blocked/);assert.match(dense,/class="atlas-scale"/);assert.match(dense,/data-action="map-zoom"/);
  assert.match(sparse,/class="atlas-sparse"/);assert.doesNotMatch(sparse,/data-action="map-zoom"|class="atlas-road-line"/);
  assert.equal(mapFixtures.sparse.turn.state.game.entities.length,3);
  let seedPage='';sendSeed({writeHead(){},end(html){seedPage=html;}},mapArchive,mapFixtures.dense.session.id);
  const bootstrap=seedPage.match(/<script>([\s\S]*)<\/script>/)[1];
  const runSeed=existing=>{
    const before=JSON.stringify(existing),storage=new Map([[STORAGE_KEY,before]]),result={redirect:'',writes:0,message:''};
    const body={};Object.defineProperty(body,'textContent',{set(value){result.message=value;}});
    runInNewContext(bootstrap,{localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){result.writes++;storage.set(key,value);}},location:{replace(url){result.redirect=url;}},document:{body}});
    return {...result,before,after:storage.get(STORAGE_KEY)};
  };
  const withPresets={...structuredClone(archive),worlds:[...archive.worlds,...[...PRESET_WORLDS,...ADDITIONAL_WORLDS].map(w=>Object.fromEntries(Object.entries(w).reverse()))]};
  assert.equal(runSeed(withPresets).redirect,'/#/story/map-dense-preview-session');
  const modified=structuredClone(withPresets);modified.worlds[1].rules.push('已修改的规则');
  const modifiedAdditional=structuredClone(withPresets);modifiedAdditional.worlds[1+PRESET_WORLDS.length].rules.push('改过的扩展世界规则');
  const custom=structuredClone(withPresets);custom.worlds.push({...PRESET_WORLDS[0],id:'custom-world',custom:true});
  const extraProperty=structuredClone(withPresets);extraProperty.worlds[1].previewNote='此处包含额外资料';
  const playerStory=structuredClone(withPresets);playerStory.sessions.push(createSession(PRESET_WORLDS[0]));
  for(const existing of [modified,modifiedAdditional,custom,extraProperty,playerStory]){const result=runSeed(existing);assert.equal(result.writes,0);assert.equal(result.after,result.before);assert.equal(result.redirect,'');assert.match(result.message,/非验收资料/);}
  console.log('Fixture check passed: rich archive; 9-place dense map; 3-place sparse map; exact guard accepts unchanged PRESET and ADDITIONAL worlds and preserves modified/custom worlds and non-fixture sessions. No HTTP listener started.');
}else server.listen(port,'127.0.0.1',()=>console.log(`Isolated fixed-data previews:\nhttp://127.0.0.1:${port}/__fixture\nhttp://127.0.0.1:${port}/__map-fixture?scene=dense\nhttp://127.0.0.1:${port}/__map-fixture?scene=sparse`));
