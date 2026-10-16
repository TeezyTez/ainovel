// Default: a plan only. Real configured model calls require --live explicitly.
// Example: node scripts/eval-generative-ui.mjs --live --case C05 --repeats 1
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,fork,spawn} from 'node:child_process';
import {promisify} from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const script=fileURLToPath(import.meta.url);
const fixturePath=join(root,'scripts/fixtures/generative-ui-cases.json');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const command=promisify(execFile);
let redactOutput=value=>value;
const safeWorkerEnv=()=>Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const browserPath=()=>process.env.ARTIFACT_BROWSER_EXECUTABLE??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);

function options(args){
  const opts={live:false,list:false,repeats:1,cases:[],browser:true};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--live')opts.live=true;
    else if(['--list','--plan','--dry-run'].includes(arg))opts.list=true;
    else if(arg==='--no-browser')opts.browser=false;
    else if(arg==='--case')opts.cases.push(...String(args[++i]??'').split(','));
    else if(arg==='--repeats')opts.repeats=Number(args[++i]);
    else throw new Error('Unknown option: '+arg);
  }
  if(!Number.isInteger(opts.repeats)||opts.repeats<1||opts.repeats>5)throw new Error('--repeats must be an integer from 1 to 5.');
  if(opts.live&&opts.list)throw new Error('Choose --live or --list/--plan, not both.');
  if(opts.cases.includes('all'))opts.cases=fixture.cases.map(item=>item.id);
  for(const id of opts.cases)if(!fixture.cases.some(item=>item.id===id))throw new Error('Unknown case: '+id);
  return opts;
}
function selected(opts){return fixture.cases.filter(item=>opts.cases.length?opts.cases.includes(item.id):!opts.live||item.live!=='unimplemented');}
function resultStatus(assertions){return assertions.some(item=>item.status==='fail')?'failed':assertions.some(item=>item.status==='unmeasured')?'partial':'passed';}
function check(id,pass,evidence){return {id,status:pass?'pass':'fail',evidence};}
function missing(id,reason){return {id,status:'unmeasured',reason};}
function viewNodes(nodes){return (nodes??[]).flatMap(node=>[node,...viewNodes(node.children)]);}
async function sourceSnapshot(){
  const files=['server.mjs','package.json','package-lock.json','scripts/eval-generative-ui.mjs','scripts/fixtures/generative-ui-cases.json',...(await readdir(join(root,'src'),{recursive:true})).filter(name=>/\.(?:m?js|tsx?|css)$/.test(name)).map(name=>'src/'+name.replaceAll('\\','/'))].sort();
  const hash=createHash('sha256');for(const file of files)try{hash.update(file).update(await readFile(join(root,file)));}catch(error){if(error.code!=='ENOENT')throw error;}
  let commit='unavailable',dirtyDiffHash='unavailable';
  try{commit=(await command('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim();dirtyDiffHash=createHash('sha256').update((await command('git',['diff','--binary','HEAD'],{cwd:root,windowsHide:true,maxBuffer:20*1024*1024})).stdout).digest('hex');}catch{}
  return {sha256:hash.digest('hex'),commit,dirtyDiffHash,files};
}

async function browserCheck(payload){
  const {chromium}=await import('@playwright/test');
  const {artifactDocument,artifactPolicy}=await import('../src/interactive-artifact.js');
  const browser=await chromium.launch({headless:true,...(payload.browserPath?{executablePath:payload.browserPath}:{}),env:safeWorkerEnv()});
  try{
    const page=await browser.newPage({viewport:payload.viewport,serviceWorkers:'block'}),token='eval_browser';
    page.setDefaultTimeout(3000);const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url()==='https://eval-artifact.invalid/frame'?route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':artifactPolicy(token)},body:artifactDocument(payload.node,{token,state:payload.state})}):route.abort());
    await page.setContent('<!doctype html><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe sandbox="allow-scripts" src="https://eval-artifact.invalid/frame"></iframe><script>window.evalMessages=[];addEventListener("message",event=>{if(event.source===document.querySelector("iframe").contentWindow&&event.data?.token==="eval_browser")window.evalMessages.push(event.data)})</script>');
    await page.waitForFunction(()=>window.evalMessages.some(value=>value.kind==='ready'||value.kind==='error'));
    const frame=page.frames().find(value=>value.url()==='https://eval-artifact.invalid/frame');
    let controls=frame.locator('input[type=range]');if(await controls.count()===0)controls=frame.locator('input[type=number]');
    if(await controls.count()!==1)return {assertions:[missing('allocation-operation','No unique numeric/range control; automatic semantic selection would be ambiguous.')],errors};
    const control=controls.first(),initial=await control.inputValue();
    const domain=await control.evaluate(input=>({type:input.type,min:input.min,max:input.max,step:input.step,label:[input.getAttribute('aria-label'),...[...input.labels??[]].map(label=>label.innerText)].filter(Boolean).join(' ')}));
    const assertions=[check('quantity-initial',Number(initial)===payload.expectedInitial,{value:initial,expected:payload.expectedInitial}),check('drag-control',domain.type==='range',domain.type),check('integer-domain',domain.min!==''&&domain.max!==''&&Number(domain.min)===0&&Number(domain.max)===12&&['','1'].includes(domain.step),domain)];
    const checkpoints=[];
    async function capture(expected,kind){
      await page.waitForTimeout(60);
      const text=await frame.locator('#artifact-root').innerText(),match=text.match(/(?:剩余|未分配|余量)[^\d-]{0,18}(-?\d+)/),quantity=Number(await control.inputValue());
      const point={kind,expected,quantity,remaining:match?Number(match[1]):null,text,observedAt:new Date().toISOString()};checkpoints.push(point);
      assertions.push(check('quantity-'+kind,quantity===expected,{quantity,expected}));
      assertions.push(match?check('remaining-'+kind,Number(match[1])===12-expected,{value:Number(match[1]),expected:12-expected}):missing('remaining-'+kind,'No unambiguous label-before-number remaining value; inspect screenshot manually.'));
    }
    await capture(payload.expectedInitial,'initial');
    for(const [index,value] of (payload.values??[]).entries()){
      if(domain.type==='range'){
        await control.focus();await control.press('Home');for(let n=0;n<value;n++)await control.press('ArrowRight');
      }else await control.fill(String(value));
      await capture(value,'change-'+index);
    }
    if(payload.notes){
      let note=frame.getByRole('textbox',{name:/备注/});if(await note.count()!==1)note=frame.getByRole('textbox');
      if(await note.count()!==1)assertions.push(missing('notes-operation','No unique notes textbox.'));
      else for(const [index,value] of payload.notes.entries()){await note.fill(value);assertions.push(check('note-'+index,await note.inputValue()===value,{value}));await capture(payload.expectedInitial,'note-'+index);}
    }
    const messages=await page.evaluate(()=>window.evalMessages),states=messages.filter(item=>item.kind==='state');
    errors.push(...messages.filter(item=>item.kind==='error').map(item=>String(item.value)));
    assertions.push(check('browser-errors',errors.length===0,errors));
    const screenshot=join(payload.folder,'browser.png');await page.screenshot({path:screenshot,fullPage:true});
    return {assertions,checkpoints,state:states.length?states.at(-1).value:payload.state,stateSource:states.length?'actual-iframe-state-message':'no-state-message',screenshot,browserVersion:browser.version(),errors};
  }finally{await browser.close();}
}
async function killWorker(child){
  if(process.platform==='win32')await new Promise(resolveKill=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill();resolveKill();});killer.once('exit',code=>{if(code)child.kill();resolveKill();});});
  else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}
}
function inspectInBrowser(payload,timeoutMs){
  return new Promise(resolveCheck=>{
    const child=fork(script,['--browser-worker'],{cwd:root,execArgv:[],env:safeWorkerEnv(),stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,detached:process.platform!=='win32'});let done=false;
    const finish=async value=>{if(done)return;done=true;clearTimeout(timer);await killWorker(child);if(child.connected)child.disconnect();resolveCheck(value);};
    const timer=setTimeout(()=>finish({assertions:[check('browser-operation-timeout',false,{timeoutMs})],errors:['Browser operation timeout.']}),Math.max(100,timeoutMs));
    child.once('message',value=>finish(value));child.once('error',error=>finish({assertions:[check('browser-process',false,error.message)],errors:[error.message]}));
    child.once('exit',code=>{if(!done)finish({assertions:[check('browser-process',false,{code})],errors:['Browser worker exited.']});});child.send(payload);
  });
}

async function live(opts){
  try{process.loadEnvFile(join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const [{modelConfig,modelStatus},{createSession,getBranch},{BranchLedger},{DynamicInteractions},{ArtifactService},{dynamicModel,DYNAMIC_PROMPT_VERSION},{canonical},{compileReactArtifact}]=await Promise.all([
    import('../src/server-model.mjs'),import('../src/core.js'),import('../src/server-branch-ledger.mjs'),import('../src/server-dynamic.mjs'),import('../src/server-artifact-service.mjs'),import('../src/server-dynamic-model.mjs'),import('../src/dynamic-rules.js'),import('../src/server-artifact-build.mjs')]);
  const config=modelConfig(process.env);config.timeoutMs=Math.min(config.timeoutMs,fixture.stepTimeoutMs);
  const secrets=[config.key,...Object.entries(process.env).filter(([key])=>/SECRET|TOKEN|PASSWORD|API_KEY/i.test(key)).map(([,value])=>value)].filter(value=>typeof value==='string'&&value.length>=6);
  const clean=value=>typeof value==='string'?secrets.reduce((text,secret)=>text.replaceAll(secret,'[REDACTED]'),value):value;
  redactOutput=clean;
  const log=value=>console.log(JSON.stringify(value,(_key,item)=>clean(item)));
  const output=join(root,'test-results','generative-ui-eval-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(output,{recursive:true});
  const save=(file,value)=>writeFile(file,JSON.stringify(value,(_key,item)=>clean(item),2));
  let availability;try{availability=await modelStatus(config);}catch(error){availability={available:false,error:{code:error.code??'MODEL_UNAVAILABLE',message:clean(error.message)}};}
  const manifest={protocolVersion:fixture.protocolVersion,benchmarkSource:fixture.source,mode:'live',entry:'ArtifactService isolated backend; browser actions where marked',product:fixture.product,startedAt:new Date().toISOString(),environment:{node:process.version,os:process.platform,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,viewport:{width:1000,height:900},scale:1,account:'current configured login; tier and organization unmeasured',network:'current machine network; latency/VPN/region unmeasured'},model:{available:availability.available,provider:config.provider,modelLabel:config.model||'unknown (provider default)',transport:config.kind??'openai-compatible',reasoningEffort:config.reasoningEffort??'low',promptVersion:DYNAMIC_PROMPT_VERSION,timeoutMs:config.timeoutMs},sourceBefore:await sourceSnapshot(),cases:[],externalProducts:{ChatGPT:'unmeasured: no actual web account run',Claude:'unmeasured: no actual web account run'},limitations:['Backend protocol evaluation is not a normal player-entry trigger measurement.','No human blind ratings, screen recording or cross-product ranking.','Any unmeasured required assertion prevents a full-case pass.','No additional user repair is requested; internal bounded repairs are recorded.']};
  await save(join(output,'manifest.json'),manifest);log({mode:'live',output,model:manifest.model,cases:selected(opts).map(item=>item.id),repeats:opts.repeats});
  let consecutiveProviderErrors=0,breaker=false;
  for(const item of selected(opts))for(let repeat=1;repeat<=opts.repeats;repeat++){
    const folder=join(output,item.id+'-'+repeat);await mkdir(folder,{recursive:true});
    const record={id:item.id,title:item.title,repeat,prompt:item.prompt??null,context:item.context,startedAt:new Date().toISOString(),status:'unmeasured',steps:[],assertions:item.assertions.map((text,index)=>missing('benchmark-'+(index+1),text)),modelCalls:[]};
    manifest.cases.push(record);
    if(item.live==='unimplemented'||breaker||!availability.available){record.reason=item.live==='unimplemented'?'This case has no automated live recipe.':breaker?'Stopped after three consecutive provider/protocol errors.':'Configured provider unavailable; no generation attempted.';if(!availability.available)record.status='failed';await save(join(folder,'result.json'),record);await save(join(output,'manifest.json'),manifest);continue;}
    const world={id:'eval-'+item.id.toLowerCase(),version:1,title:item.title,opening:fixture.contexts[item.context],location:'当前场景',identity:'当事人',rules:[fixture.contexts[item.context]],characters:[]};
    const session=createSession(world,{},'real'),branch=getBranch(session),owner='eval_'+randomUUID().replaceAll('-','');
    if(item.context==='B')branch.initialState.game={schemaVersion:1,entities:[{id:'food',name:'干粮',kind:'item',detail:'尚未分配；试算不扣库存',status:'未分配',unit:'份',value:12,max:null,quote:world.opening,sourceVersion:0}],surfaces:[]};
    const ledger=new BranchLedger(join(folder,'isolated-ledger'));await ledger.register(owner,{session,worlds:[world]});
    const snapshot=async()=>{const data=await ledger.load(owner,session.id),saved=ledger.branch(data,branch.id);return {turns:saved.turns,initialState:saved.initialState,receipts:data.receipts,dynamicReceipts:data.dynamicReceipts??{},worlds:data.worlds};};
    const before=await snapshot();await save(join(folder,'story-before.json'),before);
    const model=async(c,kind,context,signal,extra)=>{
      if(breaker)throw new Error('Provider circuit breaker open.');
      const call={kind,startedAt:new Date().toISOString(),promptVersion:DYNAMIC_PROMPT_VERSION},started=performance.now();record.modelCalls.push(call);
      try{const response=await dynamicModel(c,kind,context,signal,extra);Object.assign(call,{durationMs:Math.round(performance.now()-started),status:'completed',metrics:response.metrics,value:response.value});consecutiveProviderErrors=0;return response;}
      catch(error){consecutiveProviderErrors++;breaker=consecutiveProviderErrors>=3;Object.assign(call,{durationMs:Math.round(performance.now()-started),status:'failed',error:{code:error.code??error.name,message:clean(error.message)}});throw error;}
      finally{await save(join(folder,'model-calls.json'),record.modelCalls);}
    };
    const dynamic=new DynamicInteractions(ledger,config,{model}),service=new ArtifactService({ledger,dynamic,directory:join(folder,'isolated-artifacts')});
    const scope={sessionId:session.id,branchId:branch.id};let current;
    async function prepare(name,prompt,routing=false){
      const started=performance.now(),step={name,prompt,inputRouting:routing,startedAt:new Date().toISOString(),events:[],modelCallStart:record.modelCalls.length};record.steps.push(step);
      const job=await service.start(owner,{...scope,baseVersion:0,requestId:'eval-'+item.id+'-'+repeat+'-'+record.steps.length,intent:prompt,inputRouting:routing,retry:true,ui:{viewport:'wide',readingMode:'continuous'}});
      let feedback=null;const unsubscribe=job.subscribe(event=>{const atMs=Math.round(performance.now()-started);feedback??=atMs;step.events.push({...event,atMs});});
      const timer=setTimeout(()=>{step.timeout=true;job.cancel();},fixture.stepTimeoutMs);
      try{current=await job.done;step.prepareDurationMs=Math.round(performance.now()-started);step.tFeedbackMs=feedback;step.feedbackType=step.events[0]?.type??null;step.committedHead=current.artifact?.head??null;step.intentDecision=current.intentDecision??null;step.deadlineMs=fixture.stepTimeoutMs-step.prepareDurationMs;step.status='completed';await save(join(folder,name+'-response.json'),current);const definition=current.authoritativeBranch.dynamic?.definition??null;await save(join(folder,name+'-definition.json'),definition);if(current.authoritativeBranch.dynamic?.reason)record.assertions.push(check(name+'-no-fallback',false,current.authoritativeBranch.dynamic.reason));return definition;}
      catch(error){step.status=step.timeout?'timeout':'failed';step.error={code:error.code??error.name,message:clean(error.message)};throw error;}
      finally{clearTimeout(timer);unsubscribe();step.durationMs=Math.round(performance.now()-started);step.modelCallCount=record.modelCalls.length-step.modelCallStart;}
    }
    async function operate(name,definition,values,expectedInitial,notes){
      const node=viewNodes(definition?.view).find(value=>['react','interactive'].includes(value.type)),step=record.steps.at(-1);
      if(!opts.browser||!node){record.assertions.push(missing(name+'-browser',!opts.browser?'Browser operations disabled.':'No runnable artifact; standard component operations not implemented.'));return;}
      const render=node.type==='react'?await compileReactArtifact(node):node;
      const state=current.artifact&&Object.hasOwn(current.artifact,'state')?current.artifact.state:Object.hasOwn(node,'initialState')?node.initialState:{};
      const remainingMs=fixture.stepTimeoutMs-(Date.now()-Date.parse(step.startedAt));
      const result=await inspectInBrowser({node:render,state,values,expectedInitial,notes,folder,viewport:{width:1000,height:900},browserPath:browserPath()},Math.min(30000,remainingMs));
      record.assertions.push(...result.assertions.map(value=>({...value,id:name+'-'+value.id})));await save(join(folder,name+'-browser.json'),result);
      if(result.stateSource==='actual-iframe-state-message'){
        const update=await service.saveState(owner,{...scope,artifactId:current.artifact.artifactId,revisionId:current.artifact.head,expectedStateRevision:current.artifact.stateRevision,state:result.state});current.artifact=update.artifact;
      }else record.assertions.push(missing(name+'-state-save','No actual browser state message; no synthetic state is injected.'));
      const firstOperation=result.checkpoints?.find(point=>point.kind.startsWith('change-')&&point.quantity===point.expected&&point.remaining===12-point.expected);
      step.tUsableVerifiedMs=firstOperation?Date.parse(firstOperation.observedAt)-Date.parse(step.startedAt):null;
      step.tUsableMs=null;step.tFinalMs=null;
      step.usableTimingNote='tUsableVerifiedMs is an observed upper bound after the first correct actual operation; earliest usability and full semantic completion are unmeasured.';
    }
    try{
      let definition;
      if(item.prerequisite){const prerequisite=fixture.cases.find(value=>value.id===item.prerequisite);definition=await prepare('prerequisite',prerequisite.prompt);if(!definition)throw new Error('Prerequisite artifact missing.');if(item.id==='C08')await operate('zero',definition,[0],4);}
      const prior=definition;definition=await prepare('initial',item.prompt,!!item.routing);
      record.assertions.push(check('story-snapshot',canonical(await snapshot())===canonical(before),'Authoritative story snapshots compared before/after.'));
      record.assertions.push(check('no-action-contracts',(definition?.actions?.length??0)===0,{actions:definition?.actions?.length??0}));
      if(['C01','C02'].includes(item.id)){
        record.assertions.push(check('definition-present',!!definition,{viewTypes:viewNodes(definition?.view).map(node=>node.type)}));
        const text=JSON.stringify(definition);record.assertions.push(check('three-route-labels',['东桥','山径','河岸'].every(name=>text.includes(name)),{labels:['东桥','山径','河岸']}));
        if(item.id==='C02'){const table=viewNodes(definition?.view).find(node=>node.type==='table');record.assertions.push(check('table-present',!!table,table?.columns??[]));if(table&&Array.isArray(table.rows)&&table.rows.every(row=>Array.isArray(row)&&row.every(cell=>typeof cell==='string')))for(const [name,time] of [['东桥','今早'],['山径','刚才'],['河岸','两天前']]){const row=table.rows.find(value=>value.join(' ').includes(name));record.assertions.push(check('literal-time-'+name,!!row&&row.join(' ').includes(time),row??null));}}
      }
      if(item.id==='C05')await operate('allocation',definition,item.operations,4);
      if(item.id==='C08'){record.assertions.push(check('title-edit',JSON.stringify(definition).includes('雨夜干粮计划'),'Requested title literal present.'));await operate('notes',definition,[],0,item.notes);}
      if(item.id==='C09')record.assertions.push(check('quiet-story-route',current.intentDecision?.kind==='story'&&!definition,{intentDecision:current.intentDecision,hasDefinition:!!definition}));
      if(item.id==='C10')record.assertions.push(check('dialogue-preserves-definition',current.intentDecision?.kind==='story'&&canonical(definition)===canonical(prior),{intentDecision:current.intentDecision}));
    }catch(error){record.assertions.push(check('execution',false,{code:error.code??error.name,message:clean(error.message)}));}
    finally{service.close();const after=await snapshot();await save(join(folder,'story-after.json'),after);record.assertions.push(check('final-story-invariant',canonical(after)===canonical(before),'Full synthetic initial state/turns/receipts/worlds equality.'));record.finishedAt=new Date().toISOString();record.status=resultStatus(record.assertions);record.firstSuccess=null;record.repairSuccess=null;record.internalRepairCount=record.steps.reduce((sum,step)=>sum+step.events.filter(event=>event.stage==='repairing').length,0);await save(join(folder,'result.json'),record);await save(join(output,'manifest.json'),manifest);log({case:item.id,repeat,status:record.status,assertions:record.assertions.reduce((counts,value)=>({...counts,[value.status]:(counts[value.status]??0)+1}),{}),modelCalls:record.modelCalls.length});}
  }
  manifest.finishedAt=new Date().toISOString();manifest.sourceAfter=await sourceSnapshot();manifest.sourceUnchanged=manifest.sourceBefore.sha256===manifest.sourceAfter.sha256;manifest.providerCircuitBreaker=breaker;
  manifest.summary=Object.fromEntries(['passed','partial','failed','unmeasured'].map(status=>[status,manifest.cases.filter(value=>value.status===status).length]));
  manifest.latencySummary='Per-step timings retained. t_final and full-case success are unmeasured whenever any benchmark assertion is unmeasured. No cross-case speed ranking.';
  await save(join(output,'manifest.json'),manifest);log({output,summary:manifest.summary,sourceUnchanged:manifest.sourceUnchanged,providerCircuitBreaker:breaker});
  if(manifest.cases.some(value=>value.status==='failed')||!manifest.sourceUnchanged)process.exitCode=1;
}

if(process.argv[2]==='--browser-worker'){
  process.once('message',async payload=>{let result;try{result=await browserCheck(payload);}catch(error){result={assertions:[check('browser-execution',false,error.message)],errors:[error.message]};}if(process.connected)process.send(result,()=>process.exit(0));else process.exit(0);});
}else{
  try{const opts=options(process.argv.slice(2));if(opts.live)await live(opts);else console.log(JSON.stringify({mode:'plan',modelCallsMade:0,protocolVersion:fixture.protocolVersion,source:fixture.source,repeats:opts.repeats,stepTimeoutMs:fixture.stepTimeoutMs,recommendedIndependentRepeats:fixture.recommendedIndependentRepeats,contexts:fixture.contexts,cases:selected(opts),limitations:['Only C01,C02,C05,C08,C09,C10 have partial live recipes.','Other cases and every unimplemented semantic assertion are explicitly unmeasured.','Use --live --case C05 --repeats 1 for a bounded real configured model run.','No claim of equivalence with ChatGPT or Claude.']},null,2));}catch(error){console.error(JSON.stringify({status:'failed',error:redactOutput(error.message)}));process.exitCode=1;}
}
