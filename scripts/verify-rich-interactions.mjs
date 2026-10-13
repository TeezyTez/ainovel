// Live acceptance evidence only. Application code never imports these scenarios.
// Usage: node scripts/verify-rich-interactions.mjs --live --case=routes,illustration
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {modelConfig} from '../src/server-model.mjs';
import {createSession,validateArchive} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {dynamicModel,DYNAMIC_PROMPT_VERSION} from '../src/server-dynamic-model.mjs';
import {canonical,validateDefinition} from '../src/dynamic-rules.js';
import {RICH_VIEW_TYPES} from '../src/rich-interaction.js';
import {dynamicView} from '../src/dynamic-ui.js';

try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}

const resources='你随身有8枚铜钱和6份干粮，这次整理不消耗它们。';
const cases=[
  {
    id:'routes',title:'矛盾航报的表格与关系图',
    opening:'在渡口，你收到两份关于去青石镇路线的公开航报。北路航报出自船员老陈昨天的口述：他说北渠可通行、南渠已被倒木堵住。南路航报出自你今天亲眼的观察：南渠入口没有倒木，岸边小船刚从南渠返回，但你没有走完整条南渠，也没有查看北渠。两份航报在南渠是否被堵上矛盾，尚不能判定谁说谎或整条航线安全。你还没选择路线。'+resources,
    intent:'请用表格并排比较两份航报的来源、时间、可确认内容和未知点，再画一张关系图表示两份报告与北渠、南渠之间的支持和矛盾关系。只整理，不选择路线。',
    requiredTypes:['table','diagram'],requiredText:['北渠','南渠'],uncertainty:true
  },
  {
    id:'illustration',title:'按场景生成 SVG 概念插画',
    opening:'暮色中的渡口很安静。近处是一条拴在木桩旁的小舟，舟头挂着一盏暖黄色灯笼。左岸立着一棵弯曲的柳树，远处是两重深蓝色山影，水面映着灯光。这里只能看见这些物件，没有人物登船或离岸。'+resources,
    intent:'请根据眼前描述画一幅 SVG 概念插画，包含小舟、灯笼、柳树、山影和水面，不推进故事。',
    requiredTypes:['illustration'],requiredText:['概念示意'],minimumElements:5
  },
  {
    id:'auto',title:'无显式界面意图的比较与决策场景',
    opening:'撤离前，你把三份公开路线说明铺在桌上，需要比较来源、限制和待核事项再决定。东桥路线是守桥人今早亲口说的：桥面还在维修，能否通行要等他回复；山径路线是你刚才亲眼看见的：入口干燥，深处坡道尚未探查；河岸路线是两天前的一封旧信写的：当时有船接应，现在船是否还在并不知道。三条路都有缺少确认的条件，当前没有哪条路线被保证安全，也没有确定的通行耗时。你暂时没有选择或出发。'+resources,
    requiredTypes:[],requiredText:['东桥','山径','河岸'],uncertainty:true
  },
  {
    id:'quiet',title:'安静阅读无需交互',
    opening:'雨声落在屋檐上。你安静地读着旧书，窗外的树影缓缓摇动。8枚铜钱和6份干粮原样放在身边。此刻没有需要决定、比较、整理或操作的事项，只需继续安静阅读。',
    noInterface:true
  }
];
const sourceFiles=[
  'src/core.js','src/server-model.mjs','src/server-branch-ledger.mjs','src/server-dynamic.mjs',
  'src/server-dynamic-model.mjs','src/dynamic-rules.js','src/dynamic-ui.js',
  'src/rich-interaction.js','src/rich-interaction-view.js','src/rich-interaction-controls.js',
  'src/dynamic-ui.css','src/rich-interaction.css'
];
const args=process.argv.slice(2),requested=[];
for(let i=0;i<args.length;i++){
  const argument=args[i];
  if(argument==='--live')continue;
  if(argument==='--case'){
    assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'--case requires one or more comma-separated case IDs.');
    requested.push(...args[++i].split(','));
  }else if(argument.startsWith('--case='))requested.push(...argument.slice(7).split(','));
  else throw new Error('Unknown argument: '+argument);
}
for(const id of requested)assert.ok(cases.some(item=>item.id===id),'Unknown case: '+id+'. Available: '+cases.map(item=>item.id).join(', '));
const selected=cases.filter(item=>!requested.length||requested.includes(item.id));
async function sourceHash(){
  const hash=createHash('sha256');
  for(const file of sourceFiles)hash.update(file).update(await readFile(file));
  return hash.digest('hex');
}
const implementationHash=await sourceHash();
if(!args.includes('--live')){
  console.log(JSON.stringify({mode:'configuration-only',selectedCases:selected.map(({id,title,requiredTypes,noInterface})=>({id,title,expected:noInterface?'none':requiredTypes.length?requiredTypes:'any rich view'})),implementationHash,promptVersion:DYNAMIC_PROMPT_VERSION,note:'No model call made. Use --live to run the configured real model with an isolated temporary ledger.'},null,2));
  process.exit(0);
}

const config=modelConfig(process.env);
assert.ok(config.available,'The configured real model is unavailable; no live tests were run.');
const output=resolve('test-results','rich-live-'+new Date().toISOString().replaceAll(':','-'));
const ledgerDirectory=await mkdtemp(join(tmpdir(),'elselife-rich-live-'));
const owner='isolated-rich-live',results=[];
const manifest={
  mode:'live',implementationHash,sourceFiles,promptVersion:DYNAMIC_PROMPT_VERSION,
  model:config.model,provider:config.provider,transport:config.kind??'openai-compatible',
  startedAt:new Date().toISOString(),ledger:ledgerDirectory,selectedCases:selected.map(item=>item.id),
  usage:'The model transport does not expose token usage.',cases:results
};
// Config is never serialized. Redact the configured key even if a provider error echoes it.
const safeText=value=>config.key?String(value).replaceAll(config.key,'[REDACTED]'):String(value);
const json=value=>JSON.stringify(value,(_key,item)=>typeof item==='string'?safeText(item):item,2);
const saveJSON=(file,value)=>writeFile(file,json(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const css=':root{--sans:system-ui,sans-serif;--serif:Georgia,serif;--bg:#f3f1ea}\n'+(await Promise.all(['src/dynamic-ui.css','src/rich-interaction.css'].map(file=>readFile(file,'utf8')))).join('\n');
const htmlDocument=(title,opening,content)=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>:root{--ink:#253137;--muted:#667574;--accent:#35645b;--soft:#e8efeb;--paper:#fffdf8;--line:#d7ded7}body{margin:0;padding:28px;background:#f3f1ea;color:var(--ink);font:17px/1.7 system-ui,sans-serif}main{max-width:1000px;margin:auto}h1{font-size:25px}.opening{white-space:pre-wrap}.btn{font:inherit;padding:7px 12px;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink)}.small{font-size:14px}.muted{color:var(--muted)}.field{display:grid;gap:5px}input,select{font:inherit;max-width:100%}${css}</style></head><body><main><h1>${escape(title)}</h1><p class="opening">${escape(opening)}</p>${content}</main></body></html>`;
await mkdir(output,{recursive:true});
await saveJSON(join(output,'manifest.json'),manifest);

function flatten(nodes){return Array.isArray(nodes)?nodes.flatMap(node=>node&&typeof node==='object'?[node,...flatten(node.children)]:[]):[];}
function storySnapshot(data,branch){
  const state=branch.turns.at(-1)?.state??branch.initialState;
  return {turns:branch.turns,initialState:branch.initialState,currentState:state,worlds:data.worlds,receipts:data.receipts,draft:branch.draft,readingPosition:branch.readingPosition};
}
function auditResult(traces,state,scope){
  return traces.map(trace=>{
    const entry={kind:trace.kind,durationMs:trace.durationMs,metrics:trace.metrics};
    if(trace.error)return {...entry,error:trace.error};
    if(trace.kind==='prepare'){
      entry.decision=trace.value===null||trace.value?.needed===false?'none':'definition';
      entry.reason=trace.value?.reason;
      if(entry.decision==='definition'){
        entry.types=Array.isArray(trace.value?.view)?[...new Set(flatten(trace.value.view).map(node=>node.type))]:[];
        try{validateDefinition({...trace.value,scope},state);entry.schemaValid=true;}
        catch(error){entry.schemaValid=false;entry.validationError=safeText(error.message);}
      }
    }else if(trace.kind==='judge'){entry.approved=trace.value?.approved;entry.reason=trace.value?.reason;}
    return entry;
  });
}

async function runCase(testCase){
  const folder=join(output,testCase.id);await mkdir(folder,{recursive:true});
  const world={id:'rich-live-'+testCase.id,version:1,title:testCase.title,location:'当前场景',identity:'当事人',rules:[testCase.opening],opening:testCase.opening,characters:[]};
  const session=createSession(world,{},'real'),branch=session.branches[0];
  branch.initialState.game={schemaVersion:1,entities:[['money','铜钱',8,'枚'],['food','干粮',6,'份']].map(([id,name,value,unit])=>({id,name,value,unit,kind:'meter',status:'持有',max:null,detail:'当前持有，整理不改变数量',quote:testCase.opening,sourceVersion:0})),surfaces:[]};
  const ledger=new BranchLedger(ledgerDirectory);
  await ledger.register(owner,{session,worlds:[world]});
  const beforeData=await ledger.load(owner,session.id),before=storySnapshot(beforeData,ledger.branch(beforeData,branch.id));
  await saveJSON(join(folder,'before.json'),before);
  const traces=[];
  const model=async(modelConfiguration,kind,context,signal)=>{
    const started=Date.now();
    try{
      const response=await dynamicModel(modelConfiguration,kind,context,signal);
      traces.push({kind,context,value:response.value,metrics:response.metrics,durationMs:Date.now()-started});
      await saveJSON(join(folder,'model.json'),traces);return response;
    }catch(error){
      traces.push({kind,context,error:{code:error.code,message:safeText(error.message)},durationMs:Date.now()-started});
      await saveJSON(join(folder,'model.json'),traces);throw error;
    }
  };
  const service=new DynamicInteractions(ledger,config,{model}),body={sessionId:session.id,branchId:branch.id,baseVersion:0,ui:{viewport:'wide',readingMode:'continuous'},...(testCase.intent?{intent:testCase.intent}:{})};
  const result={id:testCase.id,expected:testCase.noInterface?'none':testCase.requiredTypes.length?testCase.requiredTypes:'any rich view',intent:testCase.intent??null,passed:false,checks:{},actualTypes:[]};
  const started=Date.now();
  try{
    const prepared=await service.prepare(owner,body,new AbortController().signal);
    await saveJSON(join(folder,'prepared.json'),prepared);
    const data=await new BranchLedger(ledgerDirectory).load(owner,session.id),savedBranch=ledger.branch(data,branch.id),saved=savedBranch.dynamic;
    assert.ok(saved,'No dynamic decision was persisted.');
    assert.ok(traces.some(trace=>trace.kind==='prepare'),'The configured real model was not called.');
    const archive=validateArchive({schemaVersion:1,worlds:data.worlds,sessions:[data.session]});
    await saveJSON(join(folder,'archive.json'),archive);result.checks.archiveValidated=true;
    const after=storySnapshot(data,savedBranch);await saveJSON(join(folder,'after.json'),after);
    assert.equal(canonical(after),canonical(before),'Preparing the interface changed story turns, time, resources, or other story state.');
    result.checks.storyUnchanged=true;
    assert.equal(canonical(saved.definition),canonical(prepared.authoritativeBranch.dynamic.definition),'Saved definition differs from the player response.');
    result.checks.persistedDefinitionMatches=true;
    result.fallbackReason=saved.reason;result.decisionReason=saved.decisionReason;
    result.audit=auditResult(traces,branch.initialState,saved.scope);
    if(testCase.noInterface){
      assert.equal(saved.definition,null,'Quiet reading unexpectedly created an interface.');
      assert.ok(!saved.reason,'An error fallback is not a deliberate no-interface decision.');
      assert.ok(traces.some(trace=>trace.kind==='prepare'&&(trace.value===null||trace.value?.needed===false)),'No explicit no-interface model decision was recorded.');
      await writeFile(join(folder,'render.html'),htmlDocument(testCase.title,testCase.opening,''));
      result.checks.deliberateNoInterface=true;
    }else{
      assert.ok(saved.definition,'No validated saved interaction. '+(saved.reason||saved.decisionReason||'No reason returned.')+' Audit: '+JSON.stringify(result.audit));
      assert.ok(!saved.reason,'A saved definition also reported a fallback.');
      const definition=saved.definition,state=savedBranch.turns.at(-1)?.state??savedBranch.initialState;
      validateDefinition(definition,state);result.checks.definitionValidated=true;
      await saveJSON(join(folder,'definition.json'),definition);
      const nodes=flatten(definition.view),richNodes=nodes.filter(node=>RICH_VIEW_TYPES.includes(node.type));
      result.actualTypes=[...new Set(nodes.map(node=>node.type))];
      result.richTypes=[...new Set(richNodes.map(node=>node.type))];
      result.actionModes=definition.actions.map(action=>action.mode);
      const params=Object.fromEntries(definition.fields.filter(field=>field.default!==undefined).map(field=>[field.id,field.default]));
      const renderBefore=canonical({definition,state,params}),html=dynamicView(definition,state,params);
      await writeFile(join(folder,'render.html'),htmlDocument(testCase.title,testCase.opening,html));
      assert.equal(canonical({definition,state,params}),renderBefore,'Rendering mutated the definition, state, or inputs.');
      assert.doesNotMatch(html,/这部分暂时无法显示|辅助交互无法显示|NaN|Infinity/,'Rendering used a fallback or invalid numeric output.');
      assert.ok(richNodes.length>0,'The model returned only basic text instead of a rich view.');
      result.renderedRichTypes=[...new Set([...html.matchAll(/data-rich-kind="([a-z]+)"/g)].map(match=>match[1]))];
      assert.ok(result.renderedRichTypes.length>0,'All rich views were hidden or empty in the actual render.');
      for(const type of testCase.requiredTypes)assert.ok(result.renderedRichTypes.includes(type),'The requested '+type+' view is missing from the rendered output; definition types: '+result.actualTypes.join(', '));
      for(const text of testCase.requiredText)assert.ok(html.includes(text),'Rendered content is missing the expected scene content: '+text);
      if(testCase.uncertainty)assert.match(html,/未知|未确认|待[核确查]|尚[未不]|不确定|不能|未[核探查]|不[清知]/,'The comparison did not preserve any uncertainty labels.');
      if(testCase.requiredTypes.includes('table'))assert.match(html,/<table[\s>]/,'The saved table did not render as a table.');
      if(testCase.requiredTypes.some(type=>['diagram','illustration'].includes(type)))assert.match(html,/<svg[\s>]/,'The requested visual did not render as SVG.');
      if(testCase.minimumElements){
        const drawings=richNodes.filter(node=>node.type==='illustration');
        result.illustrationElements=drawings.reduce((count,node)=>count+node.elements.length,0);
        assert.ok(result.illustrationElements>=testCase.minimumElements,'The illustration lacks meaningful scene geometry.');
        assert.ok(drawings.some(node=>node.elements.some(element=>element.shape!=='text')),'The illustration contains only text.');
      }
      result.checks.renderedWithoutFallback=true;result.checks.renderPure=true;
    }
    result.passed=true;
  }catch(error){result.error=safeText(error.message);if(!result.audit)result.audit=auditResult(traces,branch.initialState,{worldKey:branch.worldKey,sessionId:session.id,branchId:branch.id,sceneId:branch.initialState.location,baseVersion:0});}
  result.durationMs=Date.now()-started;
  await saveJSON(join(folder,'result.json'),result);
  results.push(result);await saveJSON(join(output,'manifest.json'),manifest);
  console.log(json(result));
}

// Cases do not share sessions or mutable state. Two workers keep real-model load bounded.
const queue=[...selected];
await Promise.all(Array.from({length:Math.min(2,queue.length)},async()=>{while(queue.length)await runCase(queue.shift());}));
manifest.finishedAt=new Date().toISOString();
manifest.finalImplementationHash=await sourceHash();
manifest.sourceUnchanged=manifest.finalImplementationHash===implementationHash;
manifest.passed=manifest.sourceUnchanged&&results.length===selected.length&&results.every(result=>result.passed);
if(!manifest.sourceUnchanged)manifest.error='Source files changed during the run; rerun against a stable implementation before accepting this evidence.';
await saveJSON(join(output,'manifest.json'),manifest);
console.log(json({evidence:output,passed:manifest.passed,cases:results.length,sourceUnchanged:manifest.sourceUnchanged}));
if(!manifest.passed)process.exitCode=1;
