import {ApiError,requestModelJSON,cleanProposal} from './server-model.mjs';
import {narrativeProposalSchema,conforms,wireSchema,schemaFailure} from './server-narrative.mjs';
import {validateProposal,applyEvents} from './core.js';
import {advanceNarrative,validateNarrative} from './narrative-state.js';
import {resolveGameAction} from './game-state.js';
import {validateControl} from './experience-state.js';
import {STORY_SYSTEM,RECORD_SYSTEM} from './story-prompts.mjs';

const proseSchema={type:'object',additionalProperties:false,required:['prose'],properties:{prose:{type:'string',minLength:1,maxLength:20000}}};
const serverFields=new Set(['requestId','baseVersion','prose']);
const recordSchema=structuredClone({...narrativeProposalSchema,required:narrativeProposalSchema.required.filter(k=>!serverFields.has(k)),properties:Object.fromEntries(Object.entries(narrativeProposalSchema.properties).filter(([k])=>!serverFields.has(k)))});
const recordedObject=recordSchema.properties.experience.anyOf[0].properties.objects.items;
recordedObject.properties.nameKnown={type:'boolean'};recordedObject.required.push('nameKnown');
const recordedGame=recordSchema.properties.game.properties;
recordedGame.entities.items.properties.name.description='直接复制fixedProse引文中的完整连续称呼，如“插销”；不要概括成“后门插销状况”。解释写detail，沿用既有对象id。';
recordedGame.entities.items.properties.quote.description='fixedProse的连续原句，须逐字包含本对象完整name并支持变化；不改写原句，不从先前正文补引用。';
recordSchema.properties.events.items.properties.entity.description='ASCII对象id或null，普通fact可用null；不填中文显示名称。';
const spatialProperties=recordedGame.spatial.properties;
spatialProperties.relations.items.description='仅登记正文支持且两端均为已登记place实体的关系；端点或依据不齐时不生成这条关系。';
for(const key of ['from','to'])spatialProperties.relations.items.properties[key].description='引用state.game或本轮game.entities中kind=place的ASCII id（如place:gate），不可写地点显示名称。';
spatialProperties.relations.items.properties.id.description='稳定的ASCII关系id，仅字母数字与_.:-，不含中文。';
spatialProperties.sites.items.properties.id.description='引用state.game或本轮game.entities中kind=place的ASCII id，不填地点显示名称。';
spatialProperties.sites.items.properties.parentId.description='父地点已登记place实体的ASCII id；未知用null。';
const extractionSchema={type:'object',additionalProperties:false,required:['compatible','reason','record'],properties:{compatible:{type:'boolean'},reason:{type:'string'},record:{anyOf:[recordSchema,{type:'null'}]}}};
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,structuredClone(o[k])]));

// Use an authoritative public identity or a complete introduction. A short name
// inside another name/ordinary word and a public nickname do not disclose it.
function nameKnownToReader(character,reader){
  if(reader.knownObjects.some(o=>o.id==='person:'+character.id&&o.nameKnown===true&&o.name===character.name))return true;
  const name=character.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const disclosed=[reader.opening,...reader.recent.map(t=>t.prose),...reader.memory.map(m=>m.summary),...reader.facts].filter(Boolean).join('\n');
  return new RegExp(`(?:我叫|叫我|名字叫|名叫|姓名[为是：:]|自称|我是|她是|他是)[^。！？，,：“”\\n]{0,12}?${name}(?=$|[\\s，。！？、；：:,.!?;“”「」『』"'])`,'u').test(disclosed);
}

// Author sees prose and current facts, not old turn schemas, method cards or UI definitions.
export function storyContext(body){
  const recent=body.recent.map(t=>pick(t,['input','prose']));
  const reader={opening:body.world.opening,recent,memory:body.memory.map(m=>pick(m,['summary','facts'])),...pick(body.state,['location','time','facts','inventory']),knownObjects:body.state.experience?.objects??[],objects:body.state.game?.entities??[]};
  if(body.narrative?.recentBeats?.length)reader.recentChanges=body.narrative.recentBeats.slice(-3).map(beat=>beat.summary);
  const background=pick(body.world,['title','seed','description','era','identity','rules','characters','experience']);
  background.characters=background.characters.map(character=>({...character,nameKnownToReader:nameKnownToReader(character,reader)}));
  return {background,reader,player:pick(body.player,['name','identity','goal']),preferences:pick(body.preferences,['perspective','length','pace','style','participation','boundaries','availableMinutes']),input:body.input,...(body.control?{control:body.control}:{}),...(body.references?{references:body.references.map(r=>pick(r,['quote','objectId']))}:{}),...(body.selectedObjects?{selectedObjects:body.selectedObjects}:{}),...(body.gameActionReceipt?{receipt:body.gameActionReceipt}:{}),unresolved:body.narrative?.threads.filter(t=>['open','progressed'].includes(t.status)).map(t=>pick(t,['question','stakes']))??[]};
}

function pack(value,system,schema,config){
  const data=structuredClone(value),past=data.reader??data;
  const limit=config.contextBudget-config.outputBudget-system.length-JSON.stringify(wireSchema(schema)).length-256;
  let json=JSON.stringify(data);
  while(json.length>limit&&(past.memory?.length||past.recent?.length>1)){
    if(past.memory?.length)past.memory.shift();else past.recent.shift();
    json=JSON.stringify(data);
  }
  if(json.length>limit)throw new ApiError(413,'CONTEXT_TOO_LARGE','故事资料超出上下文预算，原输入和进度已保留。');
  return json;
}

export function validateStoryRecord(body,prose,record){
  const proposal={...record,prose,requestId:body.requestId,baseVersion:body.state.version};
  const normalized={...proposal,events:proposal.events?.map(e=>({...e,entity:e.entity??null}))};
  if(!conforms({...normalized,experience:normalized.experience?{...normalized.experience,objects:normalized.experience.objects.map(({nameKnown,...o})=>o)}:normalized.experience},narrativeProposalSchema))throw new Error('记录格式不符合schema。');
  const witnessed=new Set();
  for(const e of proposal.eventEvidence){
    if(e.index>=proposal.events.length||witnessed.has(e.index)||!prose.includes(e.quote))throw new Error('事件证据必须逐项引用本轮原句。');
    witnessed.add(e.index);
  }
  if(proposal.events.some((e,i)=>e.visibility==='player'&&e.type!=='flag'&&!witnessed.has(i)))throw new Error('公开事件缺少本轮证据。');
  const cleaned=cleanProposal(normalized);
  const disclosed=[body.world.opening,...body.recent.map(t=>t.prose),...body.memory.map(m=>m.summary),...body.state.facts,prose].filter(Boolean).join('\n');
  for(const person of [...(cleaned.experience?.objects??[]).filter(o=>o.kind==='person'),...(cleaned.game?.entities??[]).filter(o=>o.kind==='actor')]){
    if(body.world.characters.some(c=>c.name===person.name)&&!disclosed.includes(person.name))throw new Error('人物姓名尚未在玩家经历中公开；仅登记正文中的称呼，不补全幕后姓名。');
  }
  for(const entity of cleaned.game?.entities??[])if(!entity.quote.includes(entity.name))throw new Error('game实体quote必须包含其name的原文全称；新对象名称取正文现有称呼，不改写正文来凑名字。');
  if(body.gameActionReceipt){cleaned.gameAction=body.gameActionReceipt;cleaned.ended=false;}
  validateProposal(cleaned,body.world,body.state);
  applyEvents(body.state,cleaned.events,cleaned.experience,{game:cleaned.game,gameAction:cleaned.gameAction,branchId:body.branchId});
  const narrative=advanceNarrative(body.narrative??null,proposal.narrativeDelta,prose,body.state.version+1,body.world.id+'@'+body.world.version);
  return {...cleaned,narrative};
}

export async function generateStory(body,config,signal,{requestJSON=requestModelJSON,onProgress}={}){
  if(!config.available)throw new ApiError(503,'MODEL_UNAVAILABLE','尚未配置真实模型。');
  const controller=new AbortController(),deadline=Date.now()+config.timeoutMs;
  const abort=()=>controller.abort(new ApiError(499,'CANCELLED','已取消生成，故事没有改变。'));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new ApiError(504,'TIMEOUT','生成超时，原输入和进度已保留。')),config.timeoutMs);timer.unref?.();
  const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
  async function request(system,data,schema,stage){
    check();const content=pack(data,system,schema,config);let onAbort;
    const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});});
    try{return await Promise.race([requestJSON({...config,timeoutMs:Math.max(1,deadline-Date.now())},system,content,controller.signal,{schema:wireSchema(schema)}),cancelled]);}
    catch(e){if(e instanceof ApiError&&!e.diagnostic)e.diagnostic={stage,rule:e.code};throw e;}
    finally{controller.signal.removeEventListener('abort',onAbort);}
  }
  try{
    if(body.narrative)validateNarrative(body.narrative,body.state.version,body.world.id+'@'+body.world.version);
    const input=structuredClone(body);
    if(body.control)input.control=validateControl(body.control,{worldKey:body.world.id+'@'+body.world.version,version:body.state.version,branchId:body.branchId});
    if(body.gameAction)input.gameActionReceipt=resolveGameAction(body.state,body.gameAction,{branchId:body.branchId});
    check();onProgress?.('writing');
    const draft=await request(STORY_SYSTEM,storyContext(input),proseSchema,'story');check();
    if(!conforms(draft,proseSchema))throw new Error('正文格式无效。');
    const data={...pick(input,['world','state','input','player','preferences','control','branchId','narrative','gameActionReceipt']),fixedProse:draft.prose};
    let issue,invalidRecord;
    onProgress?.('checking');
    for(let attempt=0;attempt<2;attempt++){
      const extraction=await request(RECORD_SYSTEM,{...data,...(issue?{validationIssue:issue,invalidRecord}: {})},extractionSchema,'record');check();
      if(extraction?.compatible===false)throw new ApiError(502,'INCONSISTENT_STORY','正文与当前故事或行动授权不一致，本次未写入，请重试。');
      try{
        if(!conforms(extraction,extractionSchema)||!extraction.record)throw new Error('记录格式错误：'+JSON.stringify(schemaFailure(extraction,extractionSchema)));
        const result=validateStoryRecord(input,draft.prose,extraction.record);check();return result;
      }catch(e){issue=e.message;invalidRecord=extraction.record;if(attempt===1)throw e;}
    }
  }catch(e){check();if(e instanceof ApiError)throw e;const error=new ApiError(502,'INVALID_MODEL_RESULT','正文记录未通过校验，原输入和进度已保留。');error.diagnostic={stage:'story-record',rule:'validation',reason:e.message};throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
