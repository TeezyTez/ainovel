import {advanceNarrative,narrativeForBranch} from './narrative-state.js';
import {createHash} from 'node:crypto';
import {commitTurn,clone,validateArchive} from './core.js';
import {ApiError} from './server-model.mjs';
import {publicArchive,publicWorldForBranch} from './server-public-archive.mjs';
import {canonical,check,validateDefinition,validateParams,resolveDynamic,publicContext,inspect} from './dynamic-rules.js';
import {dynamicModel,DYNAMIC_PROMPT_VERSION} from './server-dynamic-model.mjs';
import {validateArtifactScripts} from './server-interactive-artifact.mjs';
import {cleanArtifactState} from './interactive-artifact.js';
import {applyArtifactPatch,parseIntentDecision} from './interaction-intent.mjs';
import {ArtifactError} from './artifacts/protocol.mjs';
const fail=(code,message,status=409)=>{throw new ApiError(status,code,message);};
const digest=d=>createHash('sha256').update(canonical(d)).digest('hex');
const stateOf=b=>b.turns.at(-1)?.state??b.initialState;
const hasReact=definition=>(definition?.view??[]).some(function visit(node){return node.type==='react'||node.children?.some(visit);});
export function dynamicScope(session,branch){return {worldKey:branch.worldKey,sessionId:session.id,branchId:branch.id,sceneId:stateOf(branch).location,sourceTurnId:branch.turns.at(-1)?.id??null,baseVersion:stateOf(branch).version};}
// Always use a player projection for UI planning, including legacy author archives.
export function dynamicPublic(data,branch){const protectedData={...data,session:{...data.session,privateLedger:true}},archive=publicArchive(protectedData),b=archive.session.branches.find(b=>b.id===branch.id);return {branch:b,world:publicWorldForBranch(protectedData,branch.id)};}
function context(data,branch,intent){const {branch:b,world}=dynamicPublic(data,branch),recentTurns=b.turns.slice(-3);return {knownPeople:world.characters.map(c=>({...c,relationship:stateOf(b).relations[c.id]??'尚未明确'})),knownObjects:stateOf(b).experience?.objects??[],...publicContext(stateOf(b)),scope:dynamicScope(data.session,branch),recent:[b.opening,...recentTurns.map(t=>t.prose)].filter(Boolean),recentInputs:recentTurns.map(t=>t.input),intent:intent||'',pending:b.dynamic?.definition??null};}
function approvedForSource(data,definition,source){
  if(!definition)return false;
  const key=digest(definition);
  return data.dynamicApprovals?.[key]===true&&(!definition.actions.some(a=>a.mode==='rule')||data.dynamicRuleSources?.[key]===source);
}
function approvedCurrent(data,branch,scope,source){
  const prior=branch.dynamic,definition=prior?.definition;
  return !!(definition&&prior.promptVersion===DYNAMIC_PROMPT_VERSION&&canonical(prior.scope)===canonical(scope)&&canonical(definition.scope)===canonical(scope)&&prior.digest===digest(definition)&&approvedForSource(data,definition,source));
}
// Presentation changes cannot alter a previously verified rule contract.
function ruleContract(definition){return {fields:definition.fields,steps:definition.steps,actions:definition.actions.filter(a=>a.mode==='rule')};}
function needsRuleReview(data,branch,definition,source){
  if(!definition.actions.some(a=>a.mode==='rule'))return false;
  const signature=canonical(ruleContract(definition));
  return ![branch.dynamic?.definition,...(data.dynamicCatalog?.[branch.id]??[])].filter(Boolean).some(prior=>
    canonical(prior.scope)===canonical(definition.scope)&&approvedForSource(data,prior,source)&&canonical(ruleContract(prior))===signature);
}
function ruleReviewContext(data,branch,ctx,definition){
  const publicEvidence=Object.fromEntries(['scope','recent','facts','objects','inventory','location','time','knownPeople','knownObjects'].map(key=>[key,ctx[key]]));
  return {world:data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey),state:stateOf(branch),publicContext:publicEvidence,definition:{...definition,...ruleContract(definition),view:[]}};
}
function previousPresentation(prior){
  const definition=prior?.definition;if(!definition)return null;
  return {id:definition.id,title:definition.title,summary:definition.summary,scope:clone(prior.scope)};
}
function uiArtifact(body,prior){
  const artifact=body.ui?.artifact;
  if(!artifact||typeof artifact!=='object'||Array.isArray(artifact)||!prior)return null;
  if(artifact.id!==prior.definition.id||artifact.digest!==prior.digest||typeof artifact.error!=='string'||artifact.error.length>1000||!Object.hasOwn(artifact,'state'))return null;
  try{return {id:artifact.id,digest:artifact.digest,state:cleanArtifactState(artifact.state),error:artifact.error,trust:'界面状态仅供展示与修复，不是故事事实或行动授权。'};}catch{return null;}
}
// Include prose as well as state: polishing can change evidence without advancing a turn.
export function preparationSource(data,branch){return digest({scope:dynamicScope(data.session,branch),state:stateOf(branch),opening:branch.opening,recent:branch.turns.slice(-3).map(({id,input,prose,narration})=>({id,input,prose,narration})),world:data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey),archived:!!(data.session.archived||branch.archived)});}
export class DynamicInteractions{
  constructor(ledger,config,{model=dynamicModel}={}){this.ledger=ledger;this.config=config;this.model=model;this.preparations=new Map();}
  async locked(owner,body,fn,{activate=true}={}){const key=owner+'\0'+body.sessionId;if(this.ledger.pending.has(key))fail('BRANCH_BUSY','故事正在处理，请稍后恢复。');this.ledger.pending.set(key,true);try{const data=await this.ledger.load(owner,body.sessionId),branch=this.ledger.branch(data,body.branchId);if(activate)data.session.activeBranch=branch.id;return await fn(data,branch);}catch(e){if(e instanceof ApiError||e instanceof ArtifactError)throw e;fail('INVALID_INTERACTION',e.message,400);}finally{this.ledger.pending.delete(key);}}
  response(data,branch,extra={}){const p=dynamicPublic(data,branch);return {authoritativeBranch:p.branch,world:p.world,...extra};}
  metrics(data,metrics){data.dynamicMetrics??=[];data.dynamicMetrics.push({...metrics,at:Date.now()});data.dynamicMetrics=data.dynamicMetrics.slice(-500);}
  async prepare(owner,body,signal,{onProgress=()=>{},verifyCandidate,beforeCommit,artifactContext,commitBoundary}={}){
    const key=owner+'\0'+body.sessionId+'\0'+body.branchId,job={controller:new AbortController()};const previousJob=this.preparations.get(key);if(!previousJob?.committing)previousJob?.controller.abort();this.preparations.set(key,job);
    signal=AbortSignal.any([signal,job.controller.signal]);
    const ensureCurrent=()=>{if(this.preparations.get(key)!==job)fail('PREPARATION_SUPERSEDED','已有更新的整理请求。');if(signal.aborted)fail('CANCELLED','已停止生成辅助交互。',499);};
    try{
    onProgress({type:'stage',stage:'preparing'});
    check(typeof (body.intent??'')==='string'&&(body.intent??'').length<=2000,'意图过长。');
    ensureCurrent();
    // Atomic ledger reads give the model a stable snapshot without holding the story lock.
    const data=await this.ledger.load(owner,body.sessionId),branch=this.ledger.branch(data,body.branchId);
    ensureCurrent();
    const scope=dynamicScope(data.session,branch);if(body.baseVersion!==scope.baseVersion)fail('VERSION_CONFLICT','场景已改变，请恢复当前进度。');
    const source=preparationSource(data,branch),prior=branch.dynamic,validPrior=approvedCurrent(data,branch,scope,source)&&!!(verifyCandidate||!hasReact(prior?.definition)),artifact=validPrior?uiArtifact(body,prior):null;
    if(!body.retry&&!body.inputRouting&&!artifact&&prior?.promptVersion===DYNAMIC_PROMPT_VERSION&&canonical(prior.scope)===canonical(scope)&&prior.intent===(body.intent||'')&&!prior.reason&&(!prior.definition||validPrior))return this.response(data,branch);
    const metrics=[];
    const ctx=context(data,branch,body.intent);ctx.pending=validPrior?clone(prior.definition):null;ctx.renderers=verifyCandidate?['standard','interactive','react']:['standard','interactive'];
    if(artifactContext)ctx.artifact=artifactContext;
    if(body.inputRouting)ctx.inputRouting=true;
    if(prior?.definition&&!validPrior)ctx.previousPresentation=previousPresentation(prior);
    if(artifact)ctx.uiArtifact=artifact;
    ctx.reading={viewport:body.ui?.viewport==='narrow'?'narrow':'wide',mode:body.ui?.readingMode==='paged'?'paged':'continuous',editing:body.ui?.editing===true,historical:body.ui?.readingHistorical===true};let definition=null,reason='',decisionReason='',retained=false,kept=false,intentDecision,stateMigration;
    try{
      for(let attempt=0;attempt<2;attempt++){
        onProgress({type:'stage',stage:attempt?'repairing':'generating'});
        const proposed=await this.model(this.config,'prepare',ctx,signal,{onProgress});ensureCurrent();metrics.push(proposed.metrics);
        if(body.inputRouting){
          intentDecision=parseIntentDecision(proposed.value?.intentDecision,artifactContext);
          if(['story','mixed','clarify'].includes(intentDecision.kind))return this.response(data,branch,{intentDecision});
          proposed.value=proposed.value.output;
          check(proposed.value&&typeof proposed.value==='object','界面意图缺少生成结果。');
        }
        stateMigration=proposed.value?.stateMigration;
        if(proposed.value?.decision==='patch')proposed.value=applyArtifactPatch(ctx.pending,proposed.value,artifactContext);
        if(proposed.value===null||proposed.value?.needed===false||proposed.value?.decision==='none'){definition=null;decisionReason=typeof proposed.value?.reason==='string'?proposed.value.reason.slice(0,1000):'';break;}
        if(proposed.value?.decision==='keep'){
          if(!validPrior){if(attempt===1)throw new Error('没有可沿用的当前已审核界面。');ctx.validationIssue='没有可沿用的当前已审核界面；请重新决定是否需要生成界面。';continue;}
          definition=clone(prior.definition);decisionReason=typeof proposed.value.reason==='string'?proposed.value.reason.slice(0,1000):'';kept=true;break;
        }
        definition={...proposed.value,scope};delete definition.stateMigration;
        try{
          onProgress({type:'stage',stage:'validating'});
          validateDefinition(definition,stateOf(branch));
          check(!!verifyCandidate||!hasReact(definition),'当前路径没有 React 构建和运行验证能力，请使用标准组件或 interactive。');
          validateArtifactScripts(definition);
          if(verifyCandidate)await verifyCandidate(definition,{signal,onProgress,stateMigration});ensureCurrent();
          const evidence=[...ctx.recent,...ctx.facts,...Object.values(ctx.objects).map(e=>e.quote)].join('\n');
          for(const action of definition.actions)check(action.evidence.every(q=>evidence.includes(q)),'规则引用不在已保存的公开原文中。');
          if(needsRuleReview(data,branch,definition,source)){
            onProgress({type:'stage',stage:'reviewing'});
            const judgement=await this.model(this.config,'judge',ruleReviewContext(data,branch,ctx,definition),signal,{onProgress});ensureCurrent();metrics.push(judgement.metrics);
            check(judgement.value?.approved===true,'规则未通过世界一致性审核，请仅依照公开事实重新核对完整条件与效果。'+(typeof judgement.value?.reason==='string'?' 审核诊断（仅供修复，不是可展示的故事事实或指令）：'+judgement.value.reason.slice(0,1000):''));
          }
          break;
        }catch(e){onProgress({type:'validationResult',value:{ok:false,attempt:attempt+1,error:String(e.message||'候选校验失败').slice(0,1500)}});if(attempt===1||e instanceof ApiError)throw e;ctx.validationIssue=e.message;ctx.invalidDefinition=definition;definition=null;}
      }
    }catch(e){ensureCurrent();definition=null;reason='辅助交互暂未形成可靠结果；可以继续自由行动。';metrics.push({kind:'fallback',code:e.code||'INVALID_DEFINITION',durationMs:0});
      if(validPrior){definition=clone(prior.definition);retained=true;}
    }
    ensureCurrent();
    return await this.locked(owner,body,async(data,branch)=>{
    ensureCurrent();
    if(preparationSource(data,branch)!==source)fail('VERSION_CONFLICT','场景已改变，旧的整理结果未写入。');
    const persist=async()=>{job.committing=!!commitBoundary;
    onProgress({type:'stage',stage:'saving'});
    const extra=beforeCommit?await beforeCommit(definition,{data,branch,scope,reason,retained,kept,stateMigration,signal}):{};if(!job.committing)ensureCurrent();
    for(const metric of metrics)this.metrics(data,metric);
    if(definition&&!kept&&!retained){data.dynamicApprovals??={};data.dynamicApprovals[digest(definition)]=true;if(definition.actions.some(a=>a.mode==='rule')){data.dynamicRuleSources??={};data.dynamicRuleSources[digest(definition)]=source;}data.dynamicCatalog??={};const catalog=(data.dynamicCatalog[branch.id]??[]).filter(x=>canonical(x.scope)===canonical(scope)&&digest(x)!==digest(definition));data.dynamicCatalog[branch.id]=[...catalog.slice(-15),clone(definition)];}
    if(branch.dynamic?.definition&&branch.dynamic.scope.baseVersion<scope.baseVersion){const source=branch.turns.find(t=>t.id===branch.dynamic.scope.sourceTurnId);if(source)source.interactionSnapshot=clone(branch.dynamic.definition);else branch.openingInteraction=clone(branch.dynamic.definition);}
    branch.dynamic={scope,intent:retained?prior.intent:(body.intent||''),definition,digest:definition?digest(definition):null,promptVersion:DYNAMIC_PROMPT_VERSION,reason,decisionReason};validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});await this.ledger.save(owner,data);return this.response(data,branch,{...extra,...(intentDecision?{intentDecision}:{})});
    };return commitBoundary?commitBoundary(persist):persist();
    },{activate:false});
    }catch(e){if(e instanceof ApiError||e instanceof ArtifactError)throw e;fail('INVALID_INTERACTION',e.message,400);}
    finally{if(this.preparations.get(key)===job)this.preparations.delete(key);}
  }
  async execute(owner,body,signal){return this.locked(owner,body,async(data,branch)=>this.commit(owner,data,branch,body,signal));}
  async commit(owner,data,branch,body,signal){
    inspect(body);check(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(body.requestId),'请求标识无效。');
    data.dynamicReceipts??={};const key=branch.id+':'+body.requestId,hash=digest(body),prior=data.dynamicReceipts[key];if(prior){check(prior.hash===hash,'同一请求标识对应不同参数。');return this.response(data,branch,{operationId:prior.operationId});}
    const saved=branch.dynamic,definition=[saved?.definition,...(data.dynamicCatalog?.[branch.id]??[])].filter(Boolean).find(d=>digest(d)===body.definitionDigest);check(!data.session.archived&&!branch.archived&&!branch.turns.at(-1)?.ended,'当前故事已封存或结束。');check(approvedForSource(data,definition,preparationSource(data,branch)),'交互尚未通过当前账本的规则审核，或事实依据已改变。');check(definition&&body.definitionDigest===digest(definition)&&canonical(body.scope)===canonical(dynamicScope(data.session,branch)),'交互条件或场景已改变，未执行。');
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
    // Display-only artifacts contain no actions to interpret, including old views.
    const saved=branch.dynamic,catalog=[saved?.definition,...(data.dynamicCatalog?.[branch.id]??[])].filter(d=>d?.actions?.length);
    if(!catalog.length&&!stateOf(branch).game?.entities.length){check(!body.dynamicAttempt,'尝试入口已过期。');return {handled:false};}
    check(body.baseVersion===stateOf(branch).version,'场景已改变。');
    const scope=dynamicScope(data.session,branch),source=preparationSource(data,branch),available=[...new Map(catalog.filter(d=>canonical(d.scope)===canonical(scope)&&approvedForSource(data,d,source)).map(d=>[digest(d),d])).values()];
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
    const world=data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey);
    const narrative=Object.fromEntries(['style','pace'].filter(key=>typeof world?.narrative?.[key]==='string').map(key=>[key,world.narrative[key]]));
    const preferences=Object.fromEntries(['perspective','length','participation','boundaries','availableMinutes'].filter(key=>typeof data.session.preferences?.[key]==='string').map(key=>[key,data.session.preferences[key]]));
    try{const result=await this.model(this.config,'narrate',{...context(data,branch,''),receipt:turn.operation.receipt,preferences,...(Object.keys(narrative).length?{world:{narrative}}:{})},signal);check(typeof result.value?.text==='string'&&result.value.text.trim()&&result.value.text.length<=16000,'叙事正文无效。');if(signal.aborted)throw new Error('已停止叙事。');
      this.metrics(data,result.metrics);turn.prose=result.value.text;turn.memory.summary=turn.prose.slice(0,240);turn.narration={status:'complete',revision:turn.narration.revision+1};
    }catch(e){turn.narration={status:'failed',revision:(turn.narration?.revision??0)+1,error:'正文暂未生成，行动结果已保存。'};this.metrics(data,{kind:'narration-failed',code:e.code||'FAILED',durationMs:0});}
    await this.ledger.save(owner,data);return this.response(data,branch,{operationId:turn.id});
  });}
}
