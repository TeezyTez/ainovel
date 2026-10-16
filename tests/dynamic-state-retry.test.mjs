import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'vite';
import {chromium} from '@playwright/test';
import {artifactShell} from '../src/interactive-artifact.js';

let browser,server,origin;
const fixture=`import {createDynamicControls} from '/src/dynamic-ui.js';import {DYNAMIC_PROMPT_VERSION} from '/src/dynamic-rules.js';
const branches={};for(const id of ['a','b']){const scope={sessionId:'session',branchId:id,worldKey:'world@1',baseVersion:0};branches[id]={id,worldKey:'world@1',opening:'同一场景',turns:[],draft:'',dynamic:{promptVersion:DYNAMIC_PROMPT_VERSION,scope,digest:'digest-'+id,artifact:{artifactId:'artifact-'+id,head:'head-'+id,stateRevision:1,state:{quantity:1},compatible:true,revisions:[]},definition:{id:'tool',title:'分配 '+id,summary:'',scope,fields:[],steps:[],actions:[],view:[{type:'interactive',title:'数量',description:'试算',html:'<label>数量<input aria-label="数量" value="1"></label>',css:'',script:''}]}}};}
let active='a',readCount=0;const writes=[],messages=[];window.testWrites=writes;window.testMessages=messages;window.stateSaveMode='reject';
const api={active:()=>({session:{id:'session',mode:'real'},branch:branches[active],state:{version:0,facts:[],inventory:[],location:'柜台',time:'夜晚'}}),ready:()=>true,ensure:async()=>{},uiContext:()=>({}),workbench:true,storage:sessionStorage,save(){},refresh(){controls.refresh();},toast:message=>messages.push(message),install:(_session,branch)=>Object.assign(branches[active],branch),artifact:{read:async({branchId})=>{readCount++;return {authoritativeBranch:structuredClone(branches[branchId]),artifact:structuredClone(branches[branchId].dynamic.artifact)};},state:body=>{const mode=window.stateSaveMode;return new Promise((resolve,reject)=>{writes.push({body,resolve,reject});if(mode==='reject')reject(new Error('失败 '+body.branchId+' '+body.state.quantity));});}}};
const controls=createDynamicControls(api);document.querySelector('[data-reader-live=dynamic]').innerHTML=controls.html();controls.bind(false);
window.retryFixture={branches,switchBranch(id){active=id;controls.refresh();},changeHead(head){branches[active].dynamic.artifact={...branches[active].dynamic.artifact,head};controls.refresh();},send(quantity){const frame=document.querySelector('iframe'),token=new URL(frame.src,location.href).searchParams.get('token');window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{channel:'story-artifact',token,kind:'state',value:{quantity}}}));},snapshot:()=>structuredClone(branches[active].dynamic.artifact)};
window.fixtureReady=true;`;

before(async()=>{
  await build({logLevel:'error'});
  server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://local');
    if(url.pathname==='/'){response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><html><link rel="stylesheet" href="/dist/workbench/workbench.css"><div data-reader-live="dynamic"></div><script type="module" src="/fixture.js"></script></html>');return;}
    if(url.pathname==='/fixture.js'){response.setHeader('content-type','text/javascript');response.end(fixture);return;}
    if(url.pathname==='/interaction-frame'){response.setHeader('content-type','text/html');response.end(artifactShell(url.searchParams.get('token')));return;}
    if(url.pathname.startsWith('/src/')||url.pathname.startsWith('/dist/workbench/')){response.setHeader('content-type',extname(url.pathname)==='.css'?'text/css':'text/javascript');response.end(await readFile(resolve('.'+url.pathname)));return;}
    response.writeHead(404);response.end();
  });
  await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));origin='http://127.0.0.1:'+server.address().port;
  let executablePath;for(const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'])try{await access(candidate);executablePath=candidate;break;}catch{}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolveClose=>server.close(resolveClose));});

async function setup(t){const page=await browser.newPage();t.after(()=>page.close());await page.goto(origin);await page.waitForFunction(()=>window.fixtureReady&&document.querySelector('[data-artifact-status]')?.hidden);await page.evaluate(()=>retryFixture.send(7));await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/失败 a 7/);await page.evaluate(()=>{window.stateSaveMode='defer';});await page.getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>testWrites.length===2);return page;}

test('a delayed retry save cannot install old metadata or clear a new branch failure after switching branches',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{retryFixture.switchBranch('b');window.stateSaveMode='reject';retryFixture.send(9);});
  await page.waitForFunction(()=>testWrites.length===3);assert.match(await page.getByRole('alert').textContent(),/失败 b 9/);
  const before=await page.evaluate(()=>retryFixture.snapshot());
  await page.evaluate(()=>testWrites[1].resolve({artifact:{artifactId:'artifact-a',head:'head-a',stateRevision:2,state:{quantity:7},compatible:true,revisions:[]}}));
  await page.waitForTimeout(20);
  assert.deepEqual(await page.evaluate(()=>retryFixture.snapshot()),before,'late A save must not overwrite B metadata');
  assert.match(await page.getByRole('alert').textContent(),/失败 b 9/,'new branch failure remains visible');
});

test('a delayed retry save cannot overwrite a newer head in the same branch',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>retryFixture.changeHead('head-new'));
  await page.evaluate(()=>testWrites[1].resolve({artifact:{artifactId:'artifact-a',head:'head-a',stateRevision:2,state:{quantity:7},compatible:true,revisions:[]}}));
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(()=>retryFixture.snapshot().head),'head-new');
  assert.match(await page.getByRole('alert').textContent(),/失败 a 7/);
});

test('a delayed retry does not clear a newer failed local edit for the same head',async t=>{
  const page=await setup(t);
  await page.evaluate(()=>{window.stateSaveMode='reject';retryFixture.send(9);});await page.waitForFunction(()=>testWrites.length===3);
  assert.match(await page.getByRole('alert').textContent(),/失败 a 9/);
  await page.evaluate(()=>testWrites[1].resolve({artifact:{artifactId:'artifact-a',head:'head-a',stateRevision:2,state:{quantity:7},compatible:true,revisions:[]}}));
  await page.waitForTimeout(20);
  assert.equal(await page.getByRole('alert').count(),1,'newer failed edit must retain its recovery control');
  assert.match(await page.getByRole('alert').textContent(),/失败 a 9/);
  await page.evaluate(()=>{window.stateSaveMode='defer';});await page.getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>testWrites.length===4);
  assert.equal(await page.evaluate(()=>testWrites[3].body.state.quantity),9,'retry still targets the newer unsaved edit');
});
