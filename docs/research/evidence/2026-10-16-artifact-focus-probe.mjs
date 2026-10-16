// Read-only audit probe: real formal renderer, synthetic state, no model/DB.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetRoot = resolve('C:/workspace/elselife/frontend/assets/reader_artifact');
const output = fileURLToPath(new URL('./2026-10-16-artifact-focus-result.json', import.meta.url));
const fixture = `<!doctype html><meta charset="utf-8"><title>Isolated artifact focus probe</title><main id="root"></main>
<script type="module">
import {renderAdvanced} from '/assets/reader-advanced.js';
const scope={worldKey:'audit',sessionId:'audit',branchId:'audit-branch',sceneId:'',sourceTurnId:null,baseVersion:1};
const payload={branchId:'audit-branch',state:{version:1,facts:[],inventory:[],location:'',time:'',game:{entities:[],surfaces:[]}},capabilities:{attempt:false,deterministic:false},definition:{schemaVersion:1,id:'audit-view',revision:1,title:'Audit',summary:'',scope,fields:[{id:'note',label:'备注',type:'text',required:false,default:''}],steps:[],view:[{type:'text',text:'Synthetic data only'}],actions:[]}};
let handle;
window.runProbe=async echo=>{
  handle?.dispose();
  let pendingState=null;
  handle=renderAdvanced(document.getElementById('root'),structuredClone(payload),{onState:state=>{pendingState=state;}});
  const original=document.querySelector('[data-dynamic-field="note"]');
  if(!original)throw new Error(document.getElementById('root').textContent);
  original.focus();original.value='正在输入';original.setSelectionRange(2,2);
  original.dispatchEvent(new Event('input',{bubbles:true}));
  const beforeEcho={connected:original.isConnected,focused:document.activeElement===original};
  if(!pendingState)throw new Error('Expected local state callback');
  if(echo)handle.update({...structuredClone(payload),localState:pendingState});
  const current=document.querySelector('[data-dynamic-field="note"]');
  return {echo,callbackObserved:true,beforeEcho,sameElement:current===original,originalConnected:original.isConnected,focusPreserved:document.activeElement===current,value:current?.value,selectionStart:current?.selectionStart};
};
window.probeReady=true;
</script>`;
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
    if(!pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}
    const file=resolve(assetRoot,decodeURIComponent(pathname.slice(8)));
    if(!file.startsWith(assetRoot+sep)||!/\.(js|html|css)$/.test(file)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.probeReady===true);
  const baseline=await page.evaluate(()=>window.runProbe(false));
  const hostEcho=await page.evaluate(()=>window.runProbe(true));
  const invariantPassed=baseline.sameElement&&baseline.focusPreserved&&hostEcho.sameElement&&hostEcho.focusPreserved;
  const result={checkedAt:new Date().toISOString(),scope:'Real renderAdvanced module with synthetic state; host state echo simulated by update(), no Flutter end-to-end claim',browser:await browser.version(),baseline,hostEcho,pageErrors,invariantPassed};
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!invariantPassed)process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
