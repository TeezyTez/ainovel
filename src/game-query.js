import {currentMapPlace} from './map-layout.js';
import {publicSpatial} from './spatial-state.js';
const queryNames={
  all:['玩法','游戏界面','游戏面板'],
  status:['状态','我的状态','角色状态','状态栏'],
  map:['地图','当前地图','附近地图','周边地图','路线图'],
  inventory:['背包','我的背包','物品','我的物品'],
  around:['周围'],
  time:['时间','日程'],
  journal:['手记'],
  interaction:['人物','已知人物'],
  clues:['线索','已知线索'],
  objectives:['目标','任务','当前目标','当前任务']
};
const queries=new Map();
for(const [kind,names] of Object.entries(queryNames))for(const name of names){
  for(const verb of ['查看','打开','看看','显示','唤出'])queries.set(verb+name,kind);
  queries.set(name,kind);
}

// Match the whole request: quoted speech and additional story actions are input
// for the story engine, not instructions to open a local interface.
export function gameQuery(input){
  if(typeof input!=='string')return null;
  let request=input.trim().replace(/[。！？!?]+$/,'').replace(/^请/,'');
  if(/[\n“”「」『』"'，,；;]/.test(request))return null;
  request=request.replace(/^(?:给我|帮我|我想|我要)(?:看一下|看看|看|显示一下|显示|展示一下|展示)/,'查看');
  request=request.replace(/^把(.+?)(?:显示|展示)(?:出来)?$/,'查看$1').replace(/^(?:能|可以)(?:给我)?(?:显示|展示|看看)(.+?)吗$/,'查看$1');
  if(/^(?:我|我现在|我目前)(?:有|持有|带着)(?:哪些|什么)物品$/.test(request))return 'inventory';
  if(/^(?:我|我现在|我目前)(?:在哪|在哪里)$/.test(request))return 'around';
  if(/^(?:我)?身上有什么$/.test(request))return 'inventory';
  if(/^(?:现在)?几点(?:了)?$/.test(request))return 'time';
  return queries.get(request)??null;
}

const text=value=>typeof value==='string'?value:'';
const list=value=>Array.isArray(value)?value:[];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const version=(value,fallback=0)=>Number.isSafeInteger(value)&&value>=0?value:fallback;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const kinds={person:'actor',item:'item',location:'place',resource:'meter',clue:'clue',fact:'clue',agreement:'objective',event:'objective'};
const publicFields=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
function publicSurface(surface){
  const result=publicFields(surface,['id','kind','title','description','quote','version']);
  result.entityIds=list(surface.entityIds).filter(id=>typeof id==='string');
  result.links=list(surface.links).filter(record).map(link=>publicFields(link,['from','to','label']));
  result.actions=list(surface.actions).filter(record).map(action=>({
    ...publicFields(action,['id','label','input','mode','destination','disabledReason']),
    effects:list(action.effects).filter(record).map(effect=>publicFields(effect,['entityId','delta','status']))
  }));
  return result;
}

// This is a detached public projection for recall, never a state migration.
// Legacy quantities remain unknown: prose and descriptive fields are not rules.
export function gameRecallState(state,situation){
  const currentVersion=version(state?.version),entities=new Map();
  const places=list(state?.game?.entities).filter(e=>e?.kind==='place');
  const currentId=currentMapPlace(places,text(state?.location),currentVersion);
  const currentPlace=places.find(e=>e.id===currentId);
  for(const entity of list(state?.game?.entities).filter(record)){
    if(!text(entity.id))continue;
    entities.set(entity.id,{
      id:entity.id,kind:text(entity.kind),name:text(entity.name),detail:text(entity.detail),
      status:text(entity.status),value:number(entity.value),max:number(entity.max),
      unit:text(entity.unit),quote:text(entity.quote),sourceVersion:version(entity.sourceVersion,currentVersion)
    });
  }
  for(const object of list(situation?.objects).filter(record)){
    if(!text(object.id)||!Object.hasOwn(kinds,object.kind)||entities.has(object.id))continue;
    if(object.kind==='location'&&currentPlace&&object.name===state?.location&&object.name!==currentPlace.name)continue;
    entities.set(object.id,{
      id:object.id,kind:kinds[object.kind],name:text(object.name),detail:text(object.summary),
      status:text(object.status),value:null,max:null,unit:'',quote:text(object.quote),
      sourceVersion:version(object.sourceVersion,currentVersion)
    });
  }
  const spatial=publicSpatial({entities:[...entities.values()],spatial:state?.game?.spatial},[...entities.values()].map(e=>e.quote));
  return {version:currentVersion,location:text(state?.location),game:{
    schemaVersion:1,entities:[...entities.values()],
    ...(spatial?{spatial:structuredClone(spatial)}:{}),
    surfaces:structuredClone(list(state?.game?.surfaces).filter(record).map(publicSurface))
  }};
}
