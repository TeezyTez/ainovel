// Render an existing live-generated allocation definition in the current sandbox.
// Usage: node scripts/verify-generated-interaction.mjs <revision-definition.json>
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';
import {validateInteractiveView} from '../src/interactive-artifact.js';
import {validateArtifactScripts} from '../src/server-interactive-artifact.mjs';

assert.equal(process.argv.length,3,'Pass a generated allocation revision definition file.');
const definition=JSON.parse(await readFile(process.argv[2],'utf8'));
validateArtifactScripts(definition);
const node=definition.view.find(n=>n.type==='interactive');validateInteractiveView(node);
assert.equal(node.initialState?.quantity,4,'This scenario must carry the supplied quantity into initialState.');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output=resolve('test-results/generated-interaction-browser');await mkdir(output,{recursive:true});
const directory=await mkdtemp(join(tmpdir(),'generated-interaction-'));
const server=createServer({env:{},ledgerDirectory:directory}),handler=server.listeners('request')[0];
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模型生成的分配试算</title><link rel="stylesheet" href="/src/rich-interaction.css"><style>:root{--paper:#fffdf8;--ink:#263b35;--muted:#6b7971;--soft:#edf1e9;--accent:#497e72;--line:#dce2d8}*{box-sizing:border-box}body{background:var(--paper);color:var(--ink);font:16px/1.7 system-ui;margin:0}main{max-width:780px;margin:20px auto;padding:16px}h1{font-size:24px}iframe{width:100%}[hidden]{display:none}</style><script type="module" src="/__generated.js"></script></head><body><main><h1>模型生成的分配试算</h1><p>公开物资为12份干粮。下面的4份是未提交的试算初值。</p><div id="view"></div></main></body></html>`;
const js=`import {artifactFrame} from '/src/interactive-artifact.js';import {createArtifactRuntime} from '/src/interactive-runtime.js';const node=${JSON.stringify(node)};const root=document.querySelector('#view');root.innerHTML=artifactFrame(node,{id:'generated'});const runtime=createArtifactRuntime({active:()=>({session:{id:'test'},branch:{id:'branch',dynamic:{digest:'generated',definition:{id:'allocation'}}},state:{version:0}}),ready:()=>true,storage:sessionStorage,repair:()=>{document.body.dataset.failed='true';}});runtime.bind(root);window.artifactContext=()=>runtime.context();`;
server.removeAllListeners('request');server.on('request',(req,res)=>{
  if(!['/__generated','/__generated.js'].includes(req.url))return handler(req,res);
  res.writeHead(200,{'content-type':req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; base-uri 'none'"});res.end(req.url.endsWith('.js')?js:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const results=[];
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [1000,390]){
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/__generated');
    await page.waitForFunction(()=>document.querySelector('[data-artifact-status]').hidden||document.body.dataset.failed==='true');
    assert.equal(await page.getAttribute('body','data-failed'),null);
    const frame=page.frameLocator('iframe'),quantity=frame.getByRole('spinbutton',{name:'试算数量',exact:true});
    assert.equal(await quantity.inputValue(),'4');
    await quantity.fill('6');await quantity.press('Tab');
    assert.equal((await page.evaluate(()=>window.artifactContext())).state.quantity,6);
    assert.ok(await frame.getByText('未纳入本次试算：6份',{exact:true}).isVisible());
    await page.reload();await page.frameLocator('iframe').getByRole('spinbutton',{name:'试算数量',exact:true}).waitFor();
    assert.equal(await page.frameLocator('iframe').getByRole('spinbutton',{name:'试算数量',exact:true}).inputValue(),'6');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
    await page.screenshot({path:join(output,'generated-'+width+'.png'),fullPage:true});
    results.push({width,passed:true,initialQuantity:4,restoredQuantity:6,errors});await context.close();
  }
  await writeFile(join(output,'result.json'),JSON.stringify({mode:'live-generated-artifact-browser',definition:resolve(process.argv[2]),results},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
