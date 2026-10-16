// Browser regression with authored definitions and a controlled preparation response.
// No .env, model calls, or player archives. Run with PLAYWRIGHT_MODULE if needed.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output='test-results/interaction-continuity';await mkdir(output,{recursive:true});
const directory=await mkdtemp(join(tmpdir(),'interaction-continuity-'));
const server=createServer({env:{},ledgerDirectory:directory}),handler=server.listeners('request')[0];
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>交互连续性验收</title><link rel="stylesheet" href="/src/rich-interaction.css"><link rel="stylesheet" href="/src/dynamic-ui.css"><style>:root{--paper:#fffdf8;--ink:#263b35;--muted:#6b7971;--soft:#edf1e9;--accent:#497e72;--line:#dce2d8}*{box-sizing:border-box}body{background:var(--paper);color:var(--ink);font:16px/1.7 system-ui;margin:0}main{max-width:780px;margin:28px auto;padding:16px}h1{font-size:24px}input,textarea,button{font:inherit}textarea{width:100%;min-height:80px}iframe{width:100%}.dynamic-fields input{max-width:100%}[hidden]{display:none}</style><script type="module" src="/__continuity.js"></script></head><body><main><h1>物资试算 · 连续交互验收</h1><p>固定测试数据：调整数量，再修改界面。试算不会消耗干粮。</p><div data-reader-live="dynamic"></div><button id="revise">放大界面文字，保留数量</button><label>行动草稿<textarea id="draft">原有草稿</textarea></label></main></body></html>`;
const js=`import {createDynamicControls} from '/src/dynamic-ui.js';import {DYNAMIC_PROMPT_VERSION} from '/src/dynamic-rules.js';
const scope={sessionId:'test',branchId:'branch',worldKey:'world@1',baseVersion:0,sceneId:'table',sourceTurnId:null};
const node={type:'interactive',title:'干粮数量',description:'拖动或输入试算数量，最多12份。',html:'<label>数量<input aria-label="数量" id="quantity" type="number" min="0" max="12"></label><p>剩余 <output id="remaining"></output> 份</p><button id="draft">写入行动草稿</button>',css:'input{width:100%;padding:8px}output{font-weight:bold}',script:'const q=document.querySelector("#quantity"),out=document.querySelector("#remaining");q.value=String(ui.state?.quantity??0);function update(){const quantity=Number(q.value);out.textContent=String(12-quantity);ui.setState({quantity});}q.oninput=update;document.querySelector("#draft").onclick=()=>ui.draft("我考虑准备"+q.value+"份干粮。");update();',initialState:{quantity:2}};
const definition={schemaVersion:1,id:'allocation',revision:1,scope,title:'分配前先试算',summary:'所有数量都是未提交的准备。',fields:[{id:'note',label:'备注',type:'text'}],steps:[],actions:[],view:[node]};
const active={session:{id:'test',mode:'real'},branch:{id:'branch',worldKey:'world@1',opening:'共有12份干粮，尚未分配。',turns:[],draft:'原有草稿',dynamic:{scope,digest:'initial',definition,promptVersion:DYNAMIC_PROMPT_VERSION,reason:''}},state:{version:0,location:'table',time:'夜晚',facts:[],inventory:[]}};
let requestCount=0,lastBody=null;const root=document.querySelector('[data-reader-live=dynamic]');
const controls=createDynamicControls({active:()=>active,ready:()=>true,uiContext:()=>({viewport:innerWidth<600?'narrow':'wide'}),storage:sessionStorage,save(){},toast:message=>{throw new Error(message);},ensure:async()=>{},install:(_s,b)=>Object.assign(active.branch,b),refresh:()=>controls.refresh(),draft:text=>{document.querySelector('#draft').value+='\\n'+text;},request:async(_path,body)=>{requestCount++;lastBody=body;const revised=structuredClone(active.branch.dynamic);revised.digest='revision-'+requestCount;revised.definition.revision++;revised.definition.view[0].initialState=structuredClone(body.ui.artifact.state);revised.definition.view[0].css+=';body{font-size:19px}';return {authoritativeBranch:{dynamic:revised}};}});
root.innerHTML=controls.html();controls.bind(false);document.querySelector('#revise').onclick=()=>controls.prepare(true,'把这个图里的文字放大一点');
window.continuity={refresh:()=>controls.refresh(),snapshot:()=>({requestCount,lastBody,version:active.state.version,turns:active.branch.turns.length})};`;
server.removeAllListeners('request');server.on('request',(req,res)=>{
  if(!['/__continuity','/__continuity.js'].includes(req.url))return handler(req,res);
  res.writeHead(200,{'content-type':req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'"});
  res.end(req.url.endsWith('.js')?js:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const results=[];
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [1000,390]){
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/__continuity');
    const frame=page.frameLocator('iframe'),quantity=frame.getByRole('spinbutton',{name:'数量'});
    await quantity.waitFor();assert.equal(await quantity.inputValue(),'2');
    await quantity.fill('4');await page.waitForFunction(()=>document.querySelector('[data-artifact-status]').hidden);
    const before=await page.locator('iframe').getAttribute('src');
    await page.getByRole('textbox',{name:'备注',exact:true}).fill('保留这张图');
    assert.equal(await page.locator('iframe').getAttribute('src'),before,'unrelated field edits preserve the running frame');
    await page.evaluate(()=>window.continuity.refresh());assert.equal(await quantity.inputValue(),'4');
    await page.getByRole('button',{name:'放大界面文字，保留数量'}).click();
    await page.waitForFunction(()=>window.continuity.snapshot().requestCount===1&&document.querySelector('[data-artifact-status]').hidden);
    assert.equal(await quantity.inputValue(),'4','revision restores the prior quantity through initialState');
    assert.equal(await frame.locator('#remaining').textContent(),'8');
    await frame.getByRole('button',{name:'写入行动草稿'}).click();
    assert.equal(await page.locator('#draft').inputValue(),'原有草稿\n我考虑准备4份干粮。');
    const snapshot=await page.evaluate(()=>window.continuity.snapshot());
    assert.equal(snapshot.lastBody.ui.artifact.state.quantity,4);assert.equal(snapshot.turns,0);assert.equal(snapshot.version,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:output+'/continuity-'+width+'.png',fullPage:true});
    results.push({width,passed:true,quantity:4,remaining:8,storyTurns:0,errors});await context.close();
  }
  await writeFile(output+'/result.json',JSON.stringify({mode:'controlled-browser',results},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
