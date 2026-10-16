import {fork,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {artifactDocument,artifactPolicy,validateInteractiveView,cleanArtifactState} from './interactive-artifact.js';
import {validateReactBundle} from './react-artifact.js';

const workerPath=fileURLToPath(import.meta.url);
const browserCandidates=process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe']:['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'];
const safeEnv=()=>Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
function killTree(child){
  if(!child.pid)return Promise.resolve();
  if(process.platform==='win32')return new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill();resolve();});killer.once('exit',code=>{if(code)child.kill();resolve();});});
  try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}return Promise.resolve();
}

// Generated JS is only passed as data to this independent worker's browser.
// The caller's timer runs outside both browser and worker event loops.
export async function probeArtifact(renderNode,{signal,timeoutMs=7000,viewport={width:768,height:900},browserPath,tasks=[],smoke=false,state}={}){
  if(signal?.aborted)return {ok:false,errors:['Probe cancelled.'],metrics:{}};
  try{if(renderNode?.renderer==='react-bundle')validateReactBundle(renderNode);else validateInteractiveView(renderNode);if(state!==undefined)state=cleanArtifactState(state);}catch(error){return {ok:false,errors:[error.message],metrics:{}};}
  const limit=Number.isFinite(timeoutMs)?Math.max(100,Math.min(30000,timeoutMs)):7000;
  return new Promise(resolve=>{
    let done=false;
    const child=fork(workerPath,['--artifact-probe-worker'],{env:safeEnv(),execArgv:[],stdio:['ignore','ignore','ignore','ipc'],detached:process.platform!=='win32',windowsHide:true});
    const complete=async(result,kill=false)=>{
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(kill)await killTree(child);if(child.connected)child.disconnect();
      resolve(result);
    };
    const abort=()=>complete({ok:false,errors:['Probe cancelled.'],metrics:{}},true);
    const timer=setTimeout(()=>complete({ok:false,errors:['Artifact browser probe timeout.'],metrics:{timeoutMs:limit}},true),limit);
    child.once('message',result=>complete(result));
    child.once('error',error=>complete({ok:false,errors:[error.message],metrics:{}},true));
    child.once('exit',(code)=>{if(!done)complete({ok:false,errors:['Artifact browser process exited before verification ('+code+').'],metrics:{}});});
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    child.send({renderNode,viewport,browserPath:browserPath??browserCandidates.find(existsSync),tasks,smoke,...(state===undefined?{}:{state})});
  });
}

async function checkInBrowser({renderNode,viewport,browserPath,tasks,smoke,state}){
  const {chromium}=await import('@playwright/test');
  const browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{}),env:safeEnv()});
  try{
    const page=await browser.newPage({viewport:{width:Math.max(320,Math.min(1920,viewport.width||768)),height:Math.max(300,Math.min(1600,viewport.height||900))},serviceWorkers:'block'});
    const token='probe_artifact';const errors=[];
    page.on('pageerror',error=>errors.push(String(error.message).slice(0,500)));
    await page.route('**/*',route=>route.request().url()==='https://artifact-probe.invalid/frame'?route.fulfill({status:200,contentType:'text/html',headers:{'Content-Security-Policy':artifactPolicy(token)},body:artifactDocument(renderNode,{token,...(state===undefined?{}:{state})})}):route.abort());
    await page.setContent('<!doctype html><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe sandbox="allow-scripts" src="https://artifact-probe.invalid/frame"></iframe><script>window.probeMessages=[];window.addEventListener("message",event=>{if(event.source===document.querySelector("iframe").contentWindow&&event.data?.token==="probe_artifact")window.probeMessages.push(event.data)})</script>');
    await page.waitForFunction(()=>window.probeMessages.some(message=>message.kind==='ready'||message.kind==='error'));
    const frame=page.frames().find(frame=>frame.url()==='https://artifact-probe.invalid/frame');
    if(!Array.isArray(tasks)||tasks.length>12)throw new Error('Invalid host verification tasks.');
    for(const task of tasks){
      // Host-authored bounded interaction recipes, never generated JS tests.
      if(task.action==='click'&&typeof task.name==='string')await frame.getByRole('button',{name:task.name,exact:true}).click({timeout:2000});
      else if(task.action==='fill'&&typeof task.label==='string'&&typeof task.value==='string')await frame.getByLabel(task.label,{exact:true}).fill(task.value,{timeout:2000});
      else if(task.action==='expectText'&&typeof task.value==='string')await frame.waitForFunction(value=>document.getElementById('artifact-root').innerText.includes(value),task.value,{timeout:2000});
      else if(task.action==='expectState')await page.waitForFunction(value=>window.probeMessages.some(message=>message.kind==='state'&&JSON.stringify(message.value)===JSON.stringify(value)),task.value,{timeout:2000});
      else if(task.action==='expectDraft'&&typeof task.value==='string')await page.waitForFunction(value=>window.probeMessages.some(message=>message.kind==='draft'&&message.value===value),task.value,{timeout:2000});
      else throw new Error('Unsupported host verification task.');
    }
    if(smoke&&frame){
      const button=frame.locator('button:visible:not(:disabled)').first();
      if(await button.count())await button.click({timeout:2000});
      else {const input=frame.locator('input:visible:not(:disabled),textarea:visible:not(:disabled)').first();if(await input.count())await input.focus({timeout:2000});}
      // Flush messages and asynchronous event handlers inside the isolated frame.
      await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
    }
    const messages=await page.evaluate(()=>window.probeMessages);
    errors.push(...messages.filter(message=>message.kind==='error').map(message=>String(message.value).slice(0,500)));
    const metrics=frame?await frame.evaluate(()=>{const root=document.getElementById('artifact-root');return {text:root.innerText.trim().slice(0,2000),controls:root.querySelectorAll('input,textarea,select,button').length,overflow:root.scrollWidth>document.documentElement.clientWidth+20,width:document.documentElement.clientWidth};}):{};
    if(!metrics.text&&!await frame?.locator('svg').count())errors.push('No visible artifact content.');
    if(!metrics.controls)errors.push('No interactive controls.');
    if(metrics.overflow)errors.push('Artifact overflows viewport.');
    const states=messages.filter(message=>message.kind==='state');
    if(states.length)metrics.state=states.at(-1).value;
    metrics.drafts=messages.filter(message=>message.kind==='draft').map(message=>message.value);
    return {ok:errors.length===0,errors:[...new Set(errors)],metrics};
  }finally{await browser.close();}
}
if(process.argv[2]==='--artifact-probe-worker'){
  process.once('message',async payload=>{
    let result;try{result=await checkInBrowser(payload);}catch(error){result={ok:false,errors:[String(error.message).slice(0,1000)],metrics:{}};}
    if(process.connected)process.send(result,()=>process.exit(0));else process.exit(0);
  });
}
