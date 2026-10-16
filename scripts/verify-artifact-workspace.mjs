// CONTROLLED integration test: real app/server/React sandbox, authored model output.
// No .env, user archives, credentials or real model requests are read or used.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createServer} from '../server.mjs';
import {createSession,getBranch} from '../src/core.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {defaultSettings,STORAGE_KEY} from '../src/storage.js';

const output=resolve('test-results/artifact-workspace');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(join(tmpdir(),'artifact-workspace-'));
const modelCalls=[],requests=[],results=[];
let browser,server;
const source=revision=>`import React from 'react';import {useUI,Card,Button} from '@story/ui';
export default function Allocation(){const {state,setState,draft}=useUI();const quantity=state.quantity??2;return <Card title="干粮分配试算"><p>当前数量 <output id="quantity">{quantity}</output> 份</p><p>剩余 <output id="remaining">{12-quantity}</output> 份</p><Button onClick={()=>setState({...state,quantity:quantity+1})}>增加数量</Button><Button onClick={()=>draft('我考虑准备'+quantity+'份干粮。')}>写入草稿</Button><p id="revision">呈现修订 ${revision}</p></Card>}`;
async function dynamicModel(_config,kind,ctx,signal,{onProgress=()=>{}}={}){
  assert.equal(kind,'prepare','controlled display test must not invoke a story/judge model');
  const call={kind,intent:ctx.intent,inputRouting:!!ctx.inputRouting,scope:ctx.scope,patch:false};modelCalls.push(call);
  if(ctx.intent.includes('取消验收')){
    call.waiting=true;
    await new Promise((_,reject)=>{const abort=()=>{call.cancelled=true;reject(signal.reason);};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
  }
  onProgress({type:'stage',stage:'generating'});
  const revision=(ctx.pending?.revision??0)+1,quantity=ctx.uiArtifact?.state?.quantity??2;
  let value={schemaVersion:1,id:'allocation',revision,title:'干粮分配工作台',summary:`仅作试算 · 呈现修订 ${revision}`,scope:ctx.scope,fields:[],steps:[],actions:[],view:[{type:'react',title:'干粮分配试算',description:'本地计数器，不消耗真实物资。',source:source(revision),css:`button{min-height:44px}p{font-size:${15+revision}px}`,initialState:{quantity},height:300}]};
  if(ctx.intent.includes('按卡片')){
    call.patch=true;
    value={decision:'patch',baseRevision:ctx.artifact.head,baseHash:ctx.artifact.contentHash,changes:[{path:['summary'],value:'按卡片整理 · 保留数量'},{path:['view',0,'source'],value:source(revision)},{path:['view',0,'initialState'],value:{quantity}},{path:['view',0,'css'],value:'button{min-height:44px}p{font-size:19px}.story-card{background:var(--soft)}'}]};
  }
  if(ctx.inputRouting)value={intentDecision:{kind:ctx.artifact?'edit':'create',target:ctx.artifact?.artifactId??null},output:value};
  return {value,metrics:{kind:'controlled-fixture',durationMs:0}};
}

async function discoverBrowser(){
  if(process.env.ARTIFACT_BROWSER_EXECUTABLE){await access(process.env.ARTIFACT_BROWSER_EXECUTABLE);return {executablePath:process.env.ARTIFACT_BROWSER_EXECUTABLE};}
  for(const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'])try{await access(candidate);return {executablePath:candidate};}catch{}
  return {};
}

try{
  const {build}=await import('vite');await build({logLevel:'error'});
  server=createServer({env:{GENERATIVE_UI_ENABLED:'true',MODEL_API_KEY:'controlled-fixture-no-network',MODEL_BASE_URL:'http://127.0.0.1:1/v1',MODEL_NAME:'controlled-fixture'},ledgerDirectory:directory,dynamicModel,artifactVerify:async()=>{}});
  await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({...await discoverBrowser(),headless:true});
  for(const width of [1280,390]){
    const session=createSession(PRESET_WORLDS[0],{},'real'),branch=getBranch(session),owner=`controlled_${randomUUID().replaceAll('-','')}`;
    branch.opening='桌上共有12份干粮。你可以先试算如何分配，再决定是否采取行动。';
    const archive={schemaVersion:1,worlds:PRESET_WORLDS,sessions:[session],settings:{...defaultSettings,reducedMotion:true},telemetry:[]};
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addInitScript(({key,archive,owner})=>{if(window!==window.top)return;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(archive));localStorage.setItem('fangtang:owner:v1',owner);},{key:STORAGE_KEY,archive,owner});
    await context.addInitScript(()=>{if(window!==window.top)return;window.verifierFetchTimings=JSON.parse(sessionStorage.getItem('verifier-fetch-timings')||'[]');const original=window.fetch;window.fetch=async function(...args){const started=performance.now(),response=await original.apply(this,args);const path=String(args[0]);if(path.startsWith('/api/')){window.verifierFetchTimings.push({path,requestDispatchedAtMs:started,responseHeadersAtMs:performance.now(),status:response.status});sessionStorage.setItem('verifier-fetch-timings',JSON.stringify(window.verifierFetchTimings));}return response;};});
    const page=await context.newPage(),errors=[],stages=[];
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('/api/'))requests.push({width,path:new URL(request.url()).pathname,body:request.postDataJSON?.()});});
    const post=async(path,input)=>{const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json','x-branch-owner':owner},body:JSON.stringify(input)});const value=await response.json();return {status:response.status,value};};
    const scope={sessionId:session.id,branchId:branch.id};
    const artifact=async()=>{for(let attempt=0;attempt<20;attempt++){const {status,value}=await post('/api/artifacts/read',scope);if(status===409&&value.code==='BRANCH_BUSY'){await new Promise(resolveWait=>setTimeout(resolveWait,25));continue;}assert.equal(status,200,JSON.stringify(value));return value.artifact;}throw new Error('Artifact read remained busy.');};
    const snapshot=async()=>{const {status,value}=await post('/api/branch/read',scope);assert.equal(status,200);return {turns:value.branch.turns.length,state:value.state};};
    const readCount=()=>page.frameLocator('[data-artifact-workbench] iframe').locator('#quantity');
    const waitQuantity=async expected=>{await readCount().waitFor();await page.waitForFunction(expected=>{const iframe=document.querySelector('[data-artifact-workbench] iframe');return !!iframe&&document.querySelector('[data-artifact-status]')?.hidden;},expected);assert.equal(await readCount().textContent(),String(expected));};
    const submit=async text=>{const input=page.locator('#action-input');if(!await input.isVisible())await page.locator('[data-action=toggle-composer]').click();await input.fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();};
    await page.goto(`${origin}/#/story/${session.id}`);
    await page.locator('[data-artifact-workbench]').waitFor();await waitQuantity(2);
    console.log(`CONTROLLED ${width}px: initial React artifact rendered`);
    const before=await snapshot(),initial=await artifact();
    await readCount().evaluate(output=>{window.verifierCounterTimings=[];let started;document.addEventListener('click',event=>{if(event.target.closest('button')?.textContent==='增加数量')started=performance.now();},true);new MutationObserver(()=>{if(started!==undefined){window.verifierCounterTimings.push(performance.now()-started);started=undefined;}}).observe(output,{childList:true,characterData:true,subtree:true});});
    for(let index=0;index<4;index++){const saved=page.waitForResponse(response=>response.url().endsWith('/api/artifacts/state')&&response.status()===200);await page.frameLocator('[data-artifact-workbench] iframe').getByRole('button',{name:'增加数量'}).click();await saved;}
    await waitQuantity(6);
    const localCounterEventToDomMs=await readCount().evaluate(()=>window.verifierCounterTimings);
    assert.equal(localCounterEventToDomMs.length,4);assert.ok(localCounterEventToDomMs.every(value=>Number.isFinite(value)&&value>=0));
    assert.equal((await artifact()).state.quantity,6);
    const edits=['这个字太小了，帮我放大，保留数量','按卡片整理当前工具，保留数量','这个配色太淡了，调深一点，保留数量'];
    for(const [index,intent] of edits.entries()){
      const previous=(await artifact()).head;
      await page.evaluate(()=>{window.verifierFrame=document.querySelector('[data-artifact-workbench] iframe');});
      const streamResponse=page.waitForResponse(response=>response.url().endsWith('/api/artifacts/events')&&response.status()===200);
      await submit(intent);
      await streamResponse;
      // Commit completion is observed through the actual public API, never a timer.
      let current;for(let poll=0;poll<100;poll++){current=await artifact();if(current.head!==previous&&current.revisions.length===index+2)break;await new Promise(resolveWait=>setTimeout(resolveWait,50));}
      assert.notEqual(current.head,previous,`edit ${index+1} committed`);assert.equal(current.revisions.length,index+2);
      await page.waitForFunction(({key,head})=>JSON.parse(localStorage.getItem(key)).sessions.some(session=>session.branches.some(branch=>branch.dynamic?.artifact?.head===head)),{key:STORAGE_KEY,head:current.head});
      await waitQuantity(6);
      assert.deepEqual(await snapshot(),before,'display refinement must preserve the entire story state and turn count');
      stages.push({edit:index+1,head:current.head,stateRevision:current.stateRevision});
      console.log(`CONTROLLED ${width}px: edit ${index+1} committed with quantity 6`);
    }
    assert.equal(modelCalls.filter(call=>call.scope.sessionId===session.id&&call.patch).length,1);
    await page.reload();await page.locator('[data-artifact-workbench]').waitFor();await waitQuantity(6);
    console.log(`CONTROLLED ${width}px: reload restored quantity 6`);
    await page.getByRole('button',{name:'版本历史',exact:true}).click();
    const restoreResponse=page.waitForResponse(response=>response.url().endsWith('/api/artifacts/restore'));
    await page.getByRole('button',{name:'恢复版本 1',exact:true}).click();
    assert.equal((await restoreResponse).status(),200);
    for(let poll=0;poll<100;poll++){if((await artifact()).head===initial.head)break;await new Promise(resolveWait=>setTimeout(resolveWait,50));}
    assert.equal((await artifact()).head,initial.head);await waitQuantity(6);
    console.log(`CONTROLLED ${width}px: initial revision restored`);
    assert.deepEqual(await snapshot(),before);
    const restored=await artifact();
    const cancellingStream=page.waitForRequest(request=>request.url().endsWith('/api/artifacts/events'));
    await submit('请调整当前工具，这是取消验收');
    await page.getByRole('button',{name:'取消生成',exact:true}).waitFor();
    const actualJob=(await cancellingStream).postDataJSON().jobId;
    const wrongBranch=await post('/api/artifacts/events',{...scope,branchId:'wrong-branch',jobId:actualJob,afterSequence:0});assert.equal(wrongBranch.status,404);
    await page.getByRole('button',{name:'取消生成',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.artifact-workbench-cancel'));
    for(let poll=0;poll<100;poll++){if(modelCalls.some(call=>call.scope.sessionId===session.id&&call.cancelled))break;await new Promise(resolveWait=>setTimeout(resolveWait,25));}
    assert.ok(modelCalls.some(call=>call.scope.sessionId===session.id&&call.cancelled),'server model signal is aborted');
    assert.equal((await artifact()).head,restored.head);assert.deepEqual(await snapshot(),before);
    await waitQuantity(6);
    // Offscreen restoration has already passed; now prepare readable evidence.
    const historyButton=page.getByRole('button',{name:'版本历史',exact:true});
    if(await historyButton.getAttribute('aria-expanded')==='true')await historyButton.click();
    if(await page.locator('#action-input').isVisible()){await page.locator('#action-input').fill('');await page.locator('[data-action=toggle-composer]').click();}
    await page.getByRole('button',{name:'导出作品',exact:true}).click();
    const exportText=await page.getByRole('textbox',{name:'导出文件内容',exact:true}).inputValue(),exported=JSON.parse(exportText);
    await writeFile(join(output,`exported-${width}.artifact.json`),exportText);await page.keyboard.press('Escape');
    assert.equal(exported.version,1);assert.equal(exported.records.length,1);assert.equal(exported.records[0].revisions.length,4);assert.equal(exported.records[0].state.quantity,6);
    assert.equal(Object.hasOwn(exported.records[0],'requests'),false);
    const importResponse=page.waitForResponse(response=>response.url().endsWith('/api/artifacts/import'));
    await page.getByLabel('导入交互作品',{exact:true}).setInputFiles({name:'controlled.artifact.json',mimeType:'application/json',buffer:Buffer.from(exportText)});
    const importedResponse=await importResponse,importResult=await importedResponse.json();
    assert.equal(importedResponse.status(),200,JSON.stringify(importResult));
    assert.equal(importResult.artifact.artifactId,restored.artifactId);assert.notEqual(importResult.artifact.head,restored.head);
    assert.equal(importResult.artifact.revisions.length,8,'same-branch import appends fresh revisions to existing history');
    await page.waitForFunction(({key,head})=>JSON.parse(localStorage.getItem(key)).sessions.some(session=>session.branches.some(branch=>branch.dynamic?.artifact?.head===head)),{key:STORAGE_KEY,head:importResult.artifact.head});
    await waitQuantity(6);
    const importedStory=await post('/api/branch/read',scope);assert.deepEqual(importedStory.value.branch.dynamic.definition.actions,[]);assert.notEqual(importedStory.value.branch.dynamic.definition.id,'allocation');
    assert.deepEqual(await snapshot(),before,'export/import never changes story state');
    console.log(`CONTROLLED ${width}px: UI export/import appended fresh revision identities with quantity 6`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal page overflow');
    assert.deepEqual(errors,[]);
    await page.locator('[data-artifact-workbench]').evaluate(element=>window.scrollTo({top:scrollY+element.getBoundingClientRect().top-100,behavior:'instant'}));
    const counterBox=await readCount().boundingBox();assert.ok(counterBox.y>70&&counterBox.y+counterBox.height<800,'running counter is visible above the collapsed composer in the evidence viewport');
    const prepareRequestToAcceptedHeadersMs=await page.evaluate(()=>window.verifierFetchTimings.filter(item=>item.path==='/api/artifacts/prepare'&&item.status===202).map(item=>item.responseHeadersAtMs-item.requestDispatchedAtMs));
    await page.screenshot({path:join(output,`workspace-${width}.png`),fullPage:false,animations:'disabled'});
    await page.screenshot({path:join(output,`workspace-${width}-full.png`),fullPage:true,animations:'disabled'});
    results.push({width,passed:true,quantity:6,revisions:4,restoredHead:initial.head,importedArtifactId:importResult.artifact.artifactId,storyTurns:before.turns,storyVersion:before.state.version,cancelled:true,wrongBranchStatus:wrongBranch.status,uiExportImport:true,metrics:{mode:'controlled-only',prepareRequestToAcceptedHeadersMs,localCounterEventToDomMs},stages,errors});
    console.log(`CONTROLLED browser ${width}px: initial + 3 edits + reload + restore + cancel passed`);
    await context.close();
  }
  await writeFile(join(output,'result.json'),JSON.stringify({mode:'controlled-real-app-browser',candidateProbe:'bypassed for controlled authored fixture; actual production probe verified separately',results,modelCalls,requests},null,2));
}catch(error){
  const page=browser?.contexts().at(-1)?.pages().at(-1);
  if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(join(output,'failure.json'),JSON.stringify({mode:'controlled-real-app-browser',error:error.message,stack:error.stack,results,modelCalls,requests},null,2));
  console.error(error);process.exitCode=1;
}finally{
  await browser?.close();
  if(server)await new Promise(resolveClose=>server.close(resolveClose));
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  await rm(directory,{recursive:true,force:true});
}
