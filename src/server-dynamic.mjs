import {advanceNarrative,narrativeForBranch} from './narrative-state.js';
import {createHash} from 'node:crypto';
import {commitTurn,clone,validateArchive} from './core.js';
import {ApiError} from './server-model.mjs';
import {publicArchive,publicWorldForBranch} from './server-public-archive.mjs';
import {canonical,check,validateDefinition,validateParams,resolveDynamic,publicContext,inspect} from './dynamic-rules.js';
import {dynamicModel,DYNAMIC_PROMPT_VERSION} from './server-dynamic-model.mjs';
const fail=(code,message,status=409)=>{throw new ApiError(status,code,message);};
const digest=d=>createHash('sha256').update(canonical(d)).digest('hex');
const stateOf=b=>b.turns.at(-1)?.state??b.initialState;
export function dynamicScope(session,branch){return {worldKey:branch.worldKey,sessionId:session.id,branchId:branch.id,sceneId:stateOf(branch).location,sourceTurnId:branch.turns.at(-1)?.id??null,baseVersion:stateOf(branch).version};}
// Always use a player projection for UI planning, including legacy author archives.
export function dynamicPublic(data,branch){const protectedData={...data,session:{...data.session,privateLedger:true}},archive=publicArchive(protectedData),b=archive.session.branches.find(b=>b.id===branch.id);return {branch:b,world:publicWorldForBranch(protectedData,branch.id)};}
function context(data,branch,intent){const {branch:b,world}=dynamicPublic(data,branch);return {knownPeople:world.characters.map(c=>({...c,relationship:stateOf(b).relations[c.id]??'尚未明确'})),knownObjects:stateOf(b).experience?.objects??[],...publicContext(stateOf(b)),scope:dynamicScope(data.session,branch),recent:[b.opening,...b.turns.slice(-3).map(t=>t.prose)].filter(Boolean),intent:intent||'',pending:b.dynamic?.definition??null};}
export class DynamicInteractions{
  constructor(ledger,config,{model=dynamicModel}={}){this.ledger=ledger;this.config=config;this.model=model;}
  async locked(owner,body,fn){const key=owner+'\0'+body.sessionId;if(this.ledger.pending.has(key))fail('BRANCH_BUSY','故事正在处理，请稍后恢复。');this.ledger.pending.set(key,true);try{const data=await this.ledger.load(owner,body.sessionId),branch=this.ledger.branch(data,body.branchId);data.session.activeBranch=branch.id;return await fn(data,branch);}catch(e){if(e instanceof ApiError)throw e;fail('INVALID_INTERACTION',e.message,400);}finally{this.ledger.pending.delete(key);}}
  response(data,branch,extra={}){const p=dynamicPublic(data,branch);return {authoritativeBranch:p.branch,world:p.world,...extra};}
  metrics(data,metrics){data.dynamicMetrics??=[];data.dynamicMetrics.push({...metrics,at:Date.now()});data.dynamicMetrics=data.dynamicMetrics.slice(-500);}
  async prepare(owner,body,signal){return this.locked(owner,body,async(data,branch)=>{
    check(typeof (body.intent??'')==='string'&&(body.intent??'').length<=2000,'意图过长。');
    const scope=dynamicScope(data.session,branch);if(body.baseVersion!==scope.baseVersion)fail('VERSION_CONFLICT','场景已改变，请恢复当前进度。');
    if(!body.retry&&branch.dynamic?.promptVersion===DYNAMIC_PROMPT_VERSION&&canonical(branch.dynamic.scope)===canonical(scope)&&branch.dynamic.intent===(body.intent||'')&&(!branch.dynamic.definition||data.dynamicApprovals?.[branch.dynamic.digest]))return this.response(data,branch);
    const ctx=context(data,branch,body.intent);ctx.reading={viewport:body.ui?.viewport==='narrow'?'narrow':'wide',mode:body.ui?.readingMode==='paged'?'paged':'continuous',editing:body.ui?.editing===true,historical:body.ui?.readingHistorical===true};let definition=null,reason='',decisionReason='';
    try{
      for(let attempt=0;attempt<2;attempt++){
        const proposed=await this.model(this.config,'prepare',ctx,signal);this.metrics(data,proposed.metrics);
        if(proposed.value===null||proposed.value?.needed===false){definition=null;decisionReason=typeof proposed.value?.reason==='string'?proposed.value.reason.slice(0,1000):'';break;}
        definition={...proposed.value,scope};
        try{
          validateDefinition(definition,stateOf(branch));
          const evidence=[...ctx.recent,...ctx.facts,...Object.values(ctx.objects).map(e=>e.quote)].join('\n');
          for(const action of definition.actions)check(action.evidence.every(q=>evidence.includes(q)),'规则引用不在已保存的公开原文中。');
          const world=data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey);
          const judgement=await this.model(this.config,'judge',{world,state:stateOf(branch),publicContext:ctx,definition},signal);this.metrics(data,judgement.metrics);
          check(judgement.value?.approved===true,'规则未通过世界一致性审核，请仅依照公开事实重新核对完整条件与效果。');break;
        }catch(e){if(attempt===1||e instanceof ApiError)throw e;ctx.validationIssue=e.message;ctx.invalidDefinition=definition;definition=null;}
      }
    }catch(e){if(signal.aborted)throw e;definition=null;reason='辅助交互暂未形成可靠结果；可以继续自由行动。';this.metrics(data,{kind:'fallback',code:e.code||'INVALID_DEFINITION',durationMs:0});}
    if(signal.aborted)fail('CANCELLED','已停止生成辅助交互。',499);
    if(definition){data.dynamicApprovals??={};data.dynamicApprovals[digest(definition)]=true;data.dynamicCatalog??={};const catalog=(data.dynamicCatalog[branch.id]??[]).filter(x=>canonical(x.scope)===canonical(scope)&&digest(x)!==digest(definition));data.dynamicCatalog[branch.id]=[...catalog.slice(-15),clone(definition)];}
    if(branch.dynamic?.definition&&branch.dynamic.scope.baseVersion<scope.baseVersion){const source=branch.turns.find(t=>t.id===branch.dynamic.scope.sourceTurnId);if(source)source.interactionSnapshot=clone(branch.dynamic.definition);else branch.openingInteraction=clone(branch.dynamic.definition);}
    branch.dynamic={scope,intent:body.intent||'',definition,digest:definition?digest(definition):null,promptVersion:DYNAMIC_PROMPT_VERSION,reason,decisionReason};validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});await this.ledger.save(owner,data);return this.response(data,branch);
  });}
  async execute(owner,body,signal){return this.locked(owner,body,async(data,branch)=>this.commit(owner,data,branch,body,signal));}
  async commit(owner,data,branch,body,signal){
    inspect(body);check(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(body.requestId),'请求标识无效。');
    data.dynamicReceipts??={};const key=branch.id+':'+body.requestId,hash=digest(body),prior=data.dynamicReceipts[key];if(prior){check(prior.hash===hash,'同一请求标识对应不同参数。');return this.response(data,branch,{operationId:prior.operationId});}
    const saved=branch.dynamic,definition=[saved?.definition,...(data.dynamicCatalog?.[branch.id]??[])].filter(Boolean).find(d=>digest(d)===body.definitionDigest);check(!data.session.archived&&!branch.archived&&!branch.turns.at(-1)?.ended,'当前故事已封存或结束。');check(data.dynamicApprovals?.[body.definitionDigest],'交互尚未通过当前账本的规则审核。');check(definition&&body.definitionDigest===digest(definition)&&canonical(body.scope)===canonical(dynamicScope(data.session,branch)),'交互条件或场景已改变，未执行。');
    const receipt=resolveDynamic(stateOf(branch),definition,body),operation={definition:clone(definition),request:clone(body),receipt},world=data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey);
    if(signal.aborted)fail('CANCELLED','行动尚未执行。',499);
    const a=definition.actions.find(a=>a.id===body.actionId),summary=[receipt.result,...receipt.changes.map(c=>{const e=stateOf(branch).game.entities.find(e=>e.id===c.entityId);return `${e.name}：${c.before} → ${c.after}${e.unit||''}`;})].join('\n');
    const previous=narrativeForBranch(branch),narrative=previous?advanceNarrative(previous,{focus:previous.focus,beat:{kind:'aftermath',summary:receipt.result,methodId:'dynamic-result'},threads:[],opportunities:previous.opportunities},summary,receipt.afterVersion,branch.worldKey):undefined;
    const turn=commitTurn(data.session,world,body.input||a.label,{requestId:body.requestId,baseVersion:receipt.beforeVersion,prose:summary,events:[{type:'fact',visibility:'player',value:receipt.result}],operation,...(narrative?{narrative}:{})},branch.id);
    data.dynamicReceipts[key]={hash,operationId:turn.id};this.metrics(data,{kind:'execute',durationMs:0});validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});await this.ledger.save(owner,data);return this.response(data,branch,{operationId:turn.id});
  }
  async input(owner,body,signal){return this.locked(owner,body,async(data,branch)=>{
    const previous=branch.turns.find(t=>t.operation&&t.requestId===body.requestId);
    if(previous){check(previous.operation.request.input===body.input&&previous.operation.receipt.beforeVersion===body.baseVersion,'请求标识已用于不同输入。');return {handled:true,...this.response(data,branch,{operationId:previous.id})};}
    if(branch.turns.some(t=>t.requestId===body.requestId))return {handled:false};
    const saved=branch.dynamic,catalog=[saved?.definition,...(data.dynamicCatalog?.[branch.id]??[])].filter(Boolean);
    if(!catalog.length&&!stateOf(branch).game?.entities.length){check(!body.dynamicAttempt,'尝试入口已过期。');return {handled:false};}
    check(body.baseVersion===stateOf(branch).version,'场景已改变。');
    const scope=dynamicScope(data.session,branch),available=[...new Map(catalog.filter(d=>canonical(d.scope)===canonical(scope)&&data.dynamicApprovals?.[digest(d)]).map(d=>[digest(d),d])).values()];
    if(body.dynamicAttempt){const request=body.dynamicAttempt;inspect(request);const d=available.find(d=>digest(d)===request.definitionDigest);check(d&&canonical(request.scope)===canonical(scope)&&request.interactionId===d.id&&request.revision===d.revision,'尝试入口已经过期。');const action=d.actions.find(a=>a.id===request.actionId);check(action?.mode==='attempt'&&canonical(action.targets)===canonical(request.targets),'尝试对象无效。');validateParams(d,request.params,publicContext(stateOf(branch)));return {handled:false,interpreted:{kind:'attempt',interactionId:d.id,revision:d.revision,scope:d.scope,actionId:action.id,targets:action.targets,params:request.params,originalInput:body.input}};}
    const compact=d=>({...d,view:[],definitionDigest:digest(d)});
    const result=await this.model(this.config,'input',{...context(data,branch,body.input),definition:saved?.definition??null,availableContracts:available.map(compact),previousContracts:catalog.filter(d=>canonical(d.scope)!==canonical(scope)).slice(-3).map(compact)},signal);this.metrics(data,result.metrics);const v=result.value;
    check(['execute','attempt','unrelated','clarify','compose'].includes(v?.kind),'行动解释无效。');
    if(v.kind==='clarify')return {handled:true,clarify:typeof v.message==='string'?v.message:'请补充行动对象或数量。'};
    const candidates=available.filter(x=>(!v.interactionId||x.id===v.interactionId)&&(!v.definitionDigest||digest(x)===v.definitionDigest)&&x.actions.some(a=>a.id===v.actionId&&a.mode==='rule'));
    if(v.kind==='compose'||(v.kind==='execute'&&!candidates.length)){if(!body.compositionAttempted)return {handled:false,compose:true};return {handled:false,interpreted:{kind:'attempt',originalInput:body.input,message:'当前没有可确定执行的已审核契约，应按当前世界条件裁定，不能沿用旧报价。'}};}
    if(v.kind!=='execute'){await this.ledger.save(owner,data);return {handled:false,interpreted:{kind:v.kind,actionId:v.actionId??null,params:v.params??{},originalInput:body.input}};}
    check(candidates.length===1,'行动所属规则不明确，请说明对象。');const contract=candidates[0],action=contract.actions.find(a=>a.id===v.actionId);validateParams(contract,v.params,publicContext(stateOf(branch)));
    const request={sessionId:body.sessionId,branchId:body.branchId,requestId:body.requestId,scope:contract.scope,interactionId:contract.id,revision:contract.revision,definitionDigest:digest(contract),actionId:action.id,targets:action.targets,params:v.params,input:body.input};
    return {handled:true,...await this.commit(owner,data,branch,request,signal)};
  });}
  async narrate(owner,body,signal){return this.locked(owner,body,async(data,branch)=>{
    const turn=branch.turns.find(t=>t.id===body.operationId);check(turn?.operation,'找不到已提交的行动。');
    if(turn.narration?.status==='complete')return this.response(data,branch,{operationId:turn.id});
    check(branch.turns.at(-1)===turn,'故事已继续，保留当时的正式回执，不重写旧片段。');
    try{const result=await this.model(this.config,'narrate',{...context(data,branch,''),receipt:turn.operation.receipt,preferences:data.session.preferences},signal);check(typeof result.value?.text==='string'&&result.value.text.trim()&&result.value.text.length<=16000,'叙事正文无效。');if(signal.aborted)throw new Error('已停止叙事。');
      this.metrics(data,result.metrics);const review=await this.model(this.config,'narrationReview',{...context(data,branch,''),receipt:turn.operation.receipt,text:result.value.text},signal);this.metrics(data,review.metrics);check(review.value?.approved===true,'正文与正式结果不一致。');turn.prose=result.value.text;turn.memory.summary=turn.prose.slice(0,240);turn.narration={status:'complete',revision:turn.narration.revision+1};
    }catch(e){turn.narration={status:'failed',revision:(turn.narration?.revision??0)+1,error:'正文暂未生成，行动结果已保存。'};this.metrics(data,{kind:'narration-failed',code:e.code||'FAILED',durationMs:0});}
    await this.ledger.save(owner,data);return this.response(data,branch,{operationId:turn.id});
  });}
}
