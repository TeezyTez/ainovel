import {advanceNarrative, narrativeForBranch, validateNarrative} from './narrative-state.js';
import {advanceExperience, validateExperience} from './experience-state.js';
import {validatePersonalMetadata} from './personal-library.js';
import {validateGameUpdate,validateGameState,applyGameTransaction,gameItemAliases} from './game-state.js';

export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const worldKey = world => `${world.id}@${world.version}`;
const safeKey = key => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(key) && !['__proto__','constructor','prototype'].includes(key);
const text = (v,max=20000) => typeof v === 'string' && v.length <= max;
const assert = (ok,message) => { if (!ok) throw new Error(message); };
const object = value => value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestamp = value => Number.isFinite(value)&&value>=0&&value<8640000000000000;
const canonical = value => JSON.stringify(value,(_,v)=>object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function initialState(world) {
  return {version:0,step:0,location:world.location,time:'开篇',facts:[],inventory:[],relations:Object.fromEntries(world.characters.map(c=>[c.id,'尚待相识'])),flags:{},characters:Object.fromEntries(world.characters.map(c=>[c.id,{name:c.name,status:'在场或有待遇见'}]))};
}
export function createSession(world,player={},mode='demo') {
  const branch={id:uid(),name:'最初的故事',worldKey:worldKey(world),opening:world.opening,parentBranch:null,parentTurn:null,initialState:initialState(world),turns:[],draft:'',readingPosition:0};
  return {id:uid(),title:world.title,worldId:world.id,player:{name:'旅人',identity:world.identity,goal:world.goal||'',...player},mode,activeBranch:branch.id,branches:[branch],saves:[],archived:false,createdAt:Date.now(),updatedAt:Date.now(),preferences:{perspective:'第二人称',length:'适中',pace:'从容',style:'细腻克制'}};
}
export const getBranch = session => session.branches.find(b=>b.id===session.activeBranch);
export const currentState = session => {const b=getBranch(session); return b.turns.at(-1)?.state || b.initialState;};
export function validateProposal(p,world,state) {
  assert(p && text(p.requestId,200) && p.requestId,'生成结果缺少请求标识，旧故事已保留。');
  assert(p.baseVersion===state.version,'故事状态已改变，这次迟到的结果未写入。');
  assert(text(p.prose) && p.prose.trim(),'生成的正文无效，旧故事已保留。');
  assert(Array.isArray(p.events) && p.events.length<=40,'生成的事件格式无效。');
  const entities=new Set(world.characters.map(c=>c.id));
  for (const e of p.events) {
    assert(e && ['fact','item-add','item-remove','relation','location','flag'].includes(e.type),'生成包含不支持的事件，未修改故事。');
    assert(['player','hidden'].includes(e.visibility),'事件缺少明确的可见性。');
    assert((text(e.value,2000) && e.value.trim()) || (e.type==='flag' && (typeof e.value==='boolean'||Number.isFinite(e.value))),'事件值无效。');
    if(e.entity!==undefined) assert(safeKey(e.entity),'事件实体无效。');
    if(e.type==='relation') assert(entities.has(e.entity),'生成引用了不存在的人物，未修改故事。');
    if(e.type==='flag') assert(safeKey(e.entity)&&e.entity.startsWith(world.id+':'),'事件标记不属于当前世界。');
  }
  assert(p.suggestions===undefined || (Array.isArray(p.suggestions)&&p.suggestions.length<=3&&p.suggestions.every(x=>text(x.text,500)&&text(x.id,200))),'建议行动格式无效。');
  assert(p.ended===undefined || typeof p.ended==='boolean','结束状态格式无效。');
  if(p.narrative!==undefined)validateNarrative(p.narrative,state.version+1,worldKey(world));
  if(p.experience!=null){validateExperience(p.experience,p.prose,{world});advanceExperience(state.experience,p.experience,state.version+1);}
  if(p.game!==undefined)validateGameUpdate(p.game,p.prose);
  return p;
}
function validateNarrativeUpdate(previous,next,prose) {
  const updates=next.threads.filter(t=>t.updatedAt===next.turn).map(({id,question,stakes,status,evidence})=>({id,question,stakes,status,evidence}));
  const {turn,...beat}=next.recentBeats.at(-1);
  const rebuilt=advanceNarrative(previous,{focus:next.focus,beat,threads:updates,opportunities:next.opportunities},prose,next.turn,next.worldKey);
  assert(canonical(rebuilt)===canonical(next),'叙事记录与已提交期待不一致，旧故事已保留。');
}
export function applyEvents(before,events,experience,{legacyExperience=false,game,gameAction,branchId}={}) {
  const state=clone(before); state.version++; state.step++;
  const gameplay=applyGameTransaction(before,game,gameAction,{branchId,events,experience});
  if(gameplay.game!==undefined)state.game=gameplay.game;
  state.location=gameplay.location;
  for(const e of events) {
    if(e.type==='flag') state.flags[e.entity]=e.value;
    // Retain private changes for future model context, outside player-facing panels.
    else if(e.visibility==='hidden') {state.hiddenEvents??=[];state.hiddenEvents.push({type:e.type,...(e.entity?{entity:e.entity}:{}),value:e.value,visibility:'hidden'});}
    else if(e.visibility==='player') {
      if(e.type==='fact'&&!state.facts.includes(e.value))state.facts.push(e.value);
      if(e.type==='item-add'&&!state.inventory.includes(e.value))state.inventory.push(e.value);
      if(e.type==='item-remove')state.inventory=state.inventory.filter(i=>i!==e.value);
      if(e.type==='relation')state.relations[e.entity]=e.value;
      if(e.type==='location')state.location=e.value;
    }
  }
  for(const effect of gameAction?.effects??[]){const e=state.game.entities.find(e=>e.id===effect.entityId);if(e.kind==='item'&&e.value!==null&&state.game.entities.filter(other=>other.kind==='item'&&other.name===e.name).length===1){const aliases=gameItemAliases(before.game.entities.find(old=>old.id===e.id),before.experience);state.inventory=[...new Set(state.inventory.flatMap(name=>aliases.has(name)?e.value===0?[]:[e.name]:[name]))];}}
  const next=advanceExperience(before.experience,experience,state.version,{legacyFields:legacyExperience});
  if(next!==undefined){state.experience=next;if(next.clock)state.time=next.clock.label;}
  return state;
}
export function commitTurn(session,world,input,proposal,expectedBranch=session.activeBranch) {
  assert(expectedBranch===session.activeBranch,'你已切换分支，旧请求没有写入。');
  const b=getBranch(session); assert(b.worldKey===worldKey(world),'世界版本不匹配。');
  assert(!b.turns.some(t=>t.requestId===proposal.requestId),'这个回合已经提交，不会重复写入。');
  validateProposal(proposal,world,currentState(session));
  if(proposal.narrative!==undefined)validateNarrativeUpdate(narrativeForBranch(b),proposal.narrative,proposal.prose);
  const state=applyEvents(currentState(session),proposal.events,proposal.experience,{game:proposal.game,gameAction:proposal.gameAction,branchId:b.id});
  const id=uid();
  const events=proposal.events.map(e=>({...clone(e),sourceTurn:id,branchId:b.id}));
  const memory={sourceTurn:id,branchId:b.id,summary:proposal.prose.slice(0,240),facts:events.filter(e=>e.type==='fact'&&e.visibility==='player').map(e=>e.value)};
  const turn={id,parentId:b.turns.at(-1)?.id||null,requestId:proposal.requestId,input,prose:proposal.prose,status:'completed',state,events,memory,suggestions:proposal.suggestions||[],ended:!!proposal.ended,createdAt:Date.now(),...(proposal.narrative===undefined?{}:{narrative:clone(proposal.narrative)})};
  if(proposal.experience!==undefined)turn.experience=clone(proposal.experience);
  if(proposal.game!==undefined)turn.game=clone(proposal.game);
  if(proposal.gameAction!==undefined)turn.gameAction=clone(proposal.gameAction);
  b.turns.push(turn); if((b.draft||'').trim()===input.trim())b.draft=''; session.updatedAt=Date.now(); return turn;
}
export function forkBranch(session,nodeId,name,newWorld) {
  const old=getBranch(session), index=nodeId===null?-1:old.turns.findIndex(t=>t.id===nodeId);
  assert(nodeId===null||index>=0,'分支起点不存在。');
  if(newWorld){validateWorld(newWorld);const ids=new Set(newWorld.characters.map(c=>c.id));assert(Object.keys(old.initialState.characters).every(id=>ids.has(id)),'新版本移除了已有故事的人物。请保留这些人物后再应用，或从新版世界开始独立故事。');}
  const b={id:uid(),name:name||'另一种可能',worldKey:newWorld?worldKey(newWorld):old.worldKey,opening:old.opening,parentBranch:old.id,parentTurn:nodeId,initialState:clone(old.initialState),turns:clone(old.turns.slice(0,index+1)),draft:'',readingPosition:0};
  // Rewrites preserve past events; the new definition governs future turns only.
  b.turns.forEach(t=>{t.events.forEach(e=>e.branchId=b.id);t.memory.branchId=b.id;if(t.gameAction)t.gameAction.reference.branchId=b.id;});
  if(newWorld){for(const state of [b.initialState,...b.turns.map(t=>t.state)])for(const c of newWorld.characters){state.characters[c.id]??={name:c.name,status:'有待遇见'};state.relations[c.id]??='尚待相识';}}
  session.branches.push(b); session.activeBranch=b.id; session.updatedAt=Date.now(); return b;
}
function validateState(s,world) {
  assert(s && Number.isInteger(s.version)&&s.version>=0&&Number.isInteger(s.step)&&s.step>=0&&text(s.location,2000)&&text(s.time,200),'存档中的世界状态不完整。');
  for(const key of ['facts','inventory'])assert(Array.isArray(s[key])&&s[key].every(x=>text(x,2000)), '存档的事实或物品无效。');
  for(const key of ['relations','flags','characters'])assert(s[key]&&typeof s[key]==='object'&&!Array.isArray(s[key]),'存档的关系或人物无效。');
  for(const [key,value] of Object.entries(s.relations))assert(safeKey(key)&&world.characters.some(c=>c.id===key)&&text(value,2000),'存档引用了不存在的人物。');
  for(const key of Object.keys(s.flags)) assert(safeKey(key)&&key.startsWith(world.id+':'),'存档状态标记无效。');
  if(s.hiddenEvents!==undefined)assert(Array.isArray(s.hiddenEvents)&&s.hiddenEvents.every(e=>e&&e.visibility==='hidden'&&text(e.value,2000)),'幕后事件状态无效。');
  if(s.experience!==undefined)validateExperience(s.experience,undefined,{snapshot:true,version:s.version,world});
  if(s.game!==undefined)validateGameState(s.game,s.version);
}
export function validateWorld(w) {
  assert(w&&safeKey(w.id)&&Number.isInteger(w.version)&&w.version>0&&text(w.title,200)&&w.title.trim()&&text(w.location,2000)&&text(w.opening)&&text(w.identity,2000),'世界资料缺少名称、开场或身份等必要字段。');
  assert(Array.isArray(w.rules)&&w.rules.every(r=>text(r,2000))&&Array.isArray(w.characters)&&w.characters.length<=100,'世界规则或人物格式无效。');
  if(w.tags!==undefined)assert(Array.isArray(w.tags)&&w.tags.length<=20&&w.tags.every(t=>text(t,100)),'世界标签格式无效。');
  for(const key of ['description','tagline','era','goal','seed','pace'])if(w[key]!==undefined)assert(text(w[key]),'世界文字资料格式无效。');
  const seen=new Set(); for(const c of w.characters){assert(safeKey(c.id)&&!seen.has(c.id)&&text(c.name,200)&&text(c.public,4000)&&text(c.secret||'',4000),'人物资料无效或标识重复。');seen.add(c.id);}
  return w;
}
export function validateArchive(data) {
  assert(data&&data.schemaVersion===1,'不支持这个存档版本。需要 schemaVersion 为 1 的此间存档。');
  function inspect(value,depth=0){assert(depth<32,'存档嵌套层级过深。');if(Array.isArray(value)){assert(value.length<=10000,'存档列表过大。');for(const v of value)inspect(v,depth+1);}else if(object(value))for(const [key,v]of Object.entries(value)){assert(!['__proto__','prototype','constructor'].includes(key),'存档含有不安全的属性名。');inspect(v,depth+1);}}
  inspect(data);
  if(data.settings!==undefined){assert(object(data.settings),'阅读设置格式无效。');for(const key of ['fontSize','lineHeight','width'])if(data.settings[key]!==undefined)assert(Number.isFinite(data.settings[key]),'阅读数值设置无效。');for(const key of ['theme','perspective','length','pace','style'])if(data.settings[key]!==undefined)assert(text(data.settings[key],200),'阅读文字设置无效。');}
  if(data.settings?.favoriteWorlds!==undefined)assert(Array.isArray(data.settings.favoriteWorlds)&&data.settings.favoriteWorlds.length<=500&&data.settings.favoriteWorlds.every(safeKey)&&new Set(data.settings.favoriteWorlds).size===data.settings.favoriteWorlds.length,'收藏开局列表无效。');
  if(data.settings?.excludedWorlds!==undefined)assert(Array.isArray(data.settings.excludedWorlds)&&data.settings.excludedWorlds.length<=500&&data.settings.excludedWorlds.every(safeKey)&&new Set(data.settings.excludedWorlds).size===data.settings.excludedWorlds.length,'隐藏开局列表无效。');
  if(data.settings?.readingMode!==undefined)assert(['continuous','paged'].includes(data.settings.readingMode),'阅读模式无效。');
  for(const key of ['showTime','restReminder'])if(data.settings?.[key]!==undefined)assert(typeof data.settings[key]==='boolean','阅读显示开关无效。');
  if(data.settings?.fontFamily!==undefined)assert(['serif','sans','system'].includes(data.settings.fontFamily),'阅读字体设置无效。');
  if(data.settings?.paragraphGap!==undefined)assert(['normal','wide','compact'].includes(data.settings.paragraphGap),'段落间距设置无效。');
  if(data.feedback!==undefined)assert(Array.isArray(data.feedback)&&data.feedback.length<=2000&&data.feedback.every(f=>object(f)&&safeKey(f.id)&&text(f.text,4000)&&f.text.trim()&&timestamp(f.createdAt)&&text(f.status,200))&&new Set(data.feedback.map(f=>f.id)).size===data.feedback.length,'本机反馈记录无效。');
  if(data.telemetry!==undefined)assert(Array.isArray(data.telemetry)&&data.telemetry.every(e=>object(e)&&text(e.type,100)&&timestamp(e.time)&&Number.isFinite(e.durationMs)&&text(e.anonymousSession,200)),'体验记录格式无效。');
  if(data.worldDraft){const draft=data.worldDraft;assert(object(draft)&&safeKey(draft.id)&&Array.isArray(draft.rules)&&draft.rules.every(r=>text(r,2000))&&Array.isArray(draft.characters),'世界草稿格式无效。');for(const key of ['title','seed','description','era','identity','location','goal','opening'])assert(text(draft[key]),'世界草稿的文字字段无效。');for(const c of draft.characters)assert(object(c)&&safeKey(c.id)&&text(c.name,200)&&text(c.public,4000),'草稿人物格式无效。');if(draft.tags!==undefined)assert(Array.isArray(draft.tags)&&draft.tags.every(t=>text(t,100)),'草稿标签无效。');if(draft.narrative!==undefined)assert(object(draft.narrative),'草稿叙述配置无效。');if(draft.additions!==undefined)assert(object(draft.additions)&&text(draft.additions.description),'草稿示例补充无效。');}
  assert(Array.isArray(data.worlds)&&Array.isArray(data.sessions)&&data.worlds.length<=500&&data.sessions.length<=500,'存档必须包含有效的世界与故事列表。');
  const worldMap=new Map(); for(const w of data.worlds){validateWorld(w);assert(!worldMap.has(worldKey(w)),'存档的世界版本重复。');worldMap.set(worldKey(w),w);}
  const ids=new Set(); for(const s of data.sessions){
    assert(s&&safeKey(s.id)&&!ids.has(s.id)&&text(s.title,200)&&['demo','real'].includes(s.mode)&&s.player&&text(s.player.name,200)&&text(s.player.identity,2000),'故事资料无效。');ids.add(s.id);
    assert(timestamp(s.createdAt)&&timestamp(s.updatedAt)&&object(s.preferences)&&['perspective','length','pace','style'].every(k=>text(s.preferences[k],200)),'故事日期或叙述偏好格式无效。');
    if(s.preferences.boundaries!==undefined)assert(text(s.preferences.boundaries,4000),'本局底线格式无效。');
    if(s.preferences.availableMinutes!==undefined)assert(text(s.preferences.availableMinutes,3)&&(s.preferences.availableMinutes===''||/^(?:[1-9]\d?|1[0-7]\d|180)$/.test(s.preferences.availableMinutes)),'本次阅读时长偏好无效。');
    assert(data.worlds.some(w=>w.id===s.worldId),'故事关联的世界不存在。');
    assert(Array.isArray(s.branches)&&s.branches.length>0&&s.branches.length<=500&&Array.isArray(s.saves),'故事缺少分支或存档。');
    const bid=new Set(s.branches.map(b=>b.id));assert(bid.size===s.branches.length&&bid.has(s.activeBranch),'当前分支不存在或重复。');
    for(const b of s.branches){const w=worldMap.get(b.worldKey);assert(w&&w.id===s.worldId&&safeKey(b.id)&&text(b.name,200)&&Array.isArray(b.turns)&&text(b.draft||'')&&b.turns.length<=2000,'分支引用或内容无效。');assert(b.opening===undefined||text(b.opening),'分支开场格式无效。');assert(!b.parentBranch||bid.has(b.parentBranch),'分支父引用不存在。');validateState(b.initialState,w);if(b.initialState.experience!==undefined)validateExperience(b.initialState.experience,b.opening??w.opening,{snapshot:true,version:b.initialState.version,world:w});let before=b.initialState;let parent=null;const requests=new Set(),turnIds=new Set();
      let previousNarrative=null;
      if(b.archived!==undefined)assert(typeof b.archived==='boolean','分支封存状态无效。');
      for(const t of b.turns){
        assert(safeKey(t.id)&&!turnIds.has(t.id)&&t.parentId===parent&&t.status==='completed'&&text(t.input)&&!requests.has(t.requestId)&&timestamp(t.createdAt),'回合链断裂或存在重复请求。');
        turnIds.add(t.id);
        // Copied history can retain its original world's snapshot after a rewrite.
        const {narrative,experience,game,...proposal}=t;
        validateProposal({...proposal,baseVersion:before.version},w,before);validateState(t.state,w);
        if(experience!=null){let witnessed=false;for(const prose of [t.prose,...(t.revisions??[]).map(r=>r.prose)]){try{validateExperience(experience,prose,{world:w});witnessed=true;break;}catch{}}assert(witnessed,'情况与时间记录缺少已保存正文依据。');}
        if(game!=null){let witnessed=false;for(const prose of [t.prose,...(t.revisions??[]).map(r=>r.prose)]){try{validateGameUpdate(game,prose);witnessed=true;break;}catch{}}assert(witnessed,'游戏记录缺少同一版本的已保存正文依据。');}
        assert(t.state.version===before.version+1&&t.state.step===before.step+1,'状态版本与回合不一致。');
        const legacyExperience=t.state.experience?.schemaVersion===undefined&&before.experience?.schemaVersion===undefined;
        const replay=applyEvents(before,t.events,experience,{legacyExperience,game,gameAction:t.gameAction,branchId:b.id});
        // schemaVersion=1 archives historically stored message ordinals as time.
        // Accept that precise old representation only while replaying legacy data.
        if(experience===undefined&&t.state.experience===undefined&&t.state.time===`第 ${t.state.step} 个片刻`)replay.time=t.state.time;
        assert(canonical(t.state)===canonical(replay),'存档的事件与状态不一致。');
        if(t.revisions!==undefined)assert(Array.isArray(t.revisions)&&t.revisions.length<=10000&&t.revisions.every(r=>object(r)&&text(r.prose)&&r.prose.trim()&&timestamp(r.createdAt)),'润色历史格式无效。');
        if(t.polishUndoIndex!==undefined)assert(Number.isInteger(t.polishUndoIndex)&&t.polishUndoIndex>=-1&&Array.isArray(t.revisions)&&t.polishUndoIndex<t.revisions.length,'撤销表达的位置无效。');
        if(narrative!==undefined){
          validateNarrative(narrative,t.state.version);
          assert(worldMap.has(narrative.worldKey)&&worldMap.get(narrative.worldKey).id===s.worldId,'叙事记录关联的世界不存在。');
          const prior=previousNarrative?.worldKey===narrative.worldKey?previousNarrative:null;
          // A polish changes phrasing, so use one complete saved version as the
          // evidence witness. Never assemble evidence across different revisions.
          let valid=false;
          for(const witness of [t.prose,...(t.revisions??[]).map(r=>r.prose)]){
            try{validateNarrativeUpdate(prior,narrative,witness);valid=true;break;}catch{}
          }
          assert(valid,'存档的叙事记录与前轮或正文证据不一致。');
        }
        previousNarrative=narrative??null;
        assert(t.memory&&t.memory.sourceTurn===t.id&&t.memory.branchId===b.id&&text(t.memory.summary,1000),'回合记忆引用无效。');
        assert(t.events.every(e=>e.sourceTurn===t.id&&e.branchId===b.id),'事件来源引用无效。');requests.add(t.requestId);parent=t.id;before=t.state;
      }
    }
    for(const b of s.branches)if(b.parentBranch&&b.parentTurn)assert(s.branches.find(x=>x.id===b.parentBranch)?.turns.some(t=>t.id===b.parentTurn),'分支起点引用不存在。');
    for(const save of s.saves)assert(safeKey(save.id)&&text(save.name,200)&&timestamp(save.createdAt)&&bid.has(save.branchId)&&(!save.turnId||s.branches.find(b=>b.id===save.branchId).turns.some(t=>t.id===save.turnId)),'命名存档引用无效。');
  }
  validatePersonalMetadata(data);
  return clone(data);
}
export function exportMarkdown(session,world) {
  const b=getBranch(session); return `# ${session.title}\n\n${session.player.name} · ${session.player.identity}\n\n${b.opening??world.opening}\n\n`+b.turns.map(t=>`> ${t.input.replaceAll('\n','\n> ')}\n\n${t.prose}`).join('\n\n---\n\n');
}
