// Demonstrates a saved real-model result. Uses a temporary ledger and a fresh port.
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from '../server.mjs';
import {validateInteractiveView} from '../src/interactive-artifact.js';

const definition=JSON.parse(await readFile(new URL('../test-results/interactive-live-2026-10-14T06-52-07.960Z/allocation/initial-definition.json',import.meta.url),'utf8'));
validateInteractiveView(definition.view[0]);
const digest=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
const directory=await mkdtemp(join(tmpdir(),'interaction-demo-'));
const server=createServer({ledgerDirectory:directory,env:{}}),handler=server.listeners('request')[0];
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>智能交互演示 · 物资分配</title><style>
:root{--paper:#fffdf8;--ink:#263b35;--muted:#6b7971;--soft:#edf1e9;--accent:#497e72;--line:#dce2d8;color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f1f0e9;color:var(--ink);font:16px/1.75 system-ui,sans-serif}main{max-width:880px;margin:40px auto;padding:0 24px 48px}.eyebrow{font-size:12px;letter-spacing:.12em;color:var(--accent)}h1{font-size:32px;margin:8px 0 16px;font-weight:600}.intro{color:var(--muted);max-width:680px}.scene{padding:18px 24px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 12px 12px 0;margin:24px 0}.rich-view{padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}iframe{display:block;width:100%;border:0;min-height:300px;border-radius:10px}.small{font-size:14px}.muted{color:var(--muted)}[hidden]{display:none}footer{font-size:13px;color:var(--muted);margin-top:22px}button{padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}@media(max-width:520px){main{margin-top:24px;padding:0 12px 24px}h1{font-size:26px}.rich-view{padding:8px}.scene{padding:14px}}
</style><script type="module" src="/__demo.js"></script></head><body><main><div class="eyebrow">智能交互 · 独立演示</div><h1>12 份干粮，怎么分？</h1><p class="intro">这是此前由真实模型生成的可运行界面。拖动滑块或输入份数，下面的合计、剩余和进度条会一起变化。</p><div class="scene">你、阿青和老陈共有 12 份干粮，目前无人领取，也没有确定的个人配额。</div><div id="demo"></div><p id="notice" role="status"></p><footer>只做假设试算，不会分发物资或修改游戏存档。此页演示已生成的交互；连续对话修改仍在收尾。</footer></main></body></html>`;
const js=`import {artifactFrame} from '/src/interactive-artifact.js';import {createArtifactRuntime} from '/src/interactive-runtime.js';
const {definition,digest}=await (await fetch('/__sample.json')).json();
const root=document.querySelector('#demo');root.innerHTML=artifactFrame(definition.view[0],{id:'allocation-demo'});
const active={session:{id:'isolated-demo'},branch:{id:'allocation',dynamic:{definition,digest}},state:{version:0}};
const runtime=createArtifactRuntime({active:()=>active,ready:()=>true,storage:sessionStorage,draft:text=>document.querySelector('#notice').textContent=text,repair:()=>document.querySelector('#notice').textContent='当前演示加载失败。已记录问题，不会调用模型或改动存档。'});runtime.bind(root);`;
server.removeAllListeners('request');
server.on('request',(req,res)=>{
  const route=req.url?.split('?')[0];
  if(!['/__demo','/__demo.js','/__sample.json'].includes(route))return handler(req,res);
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'");
  res.writeHead(200,{'content-type':route==='/__demo'?'text/html; charset=utf-8':route==='/__demo.js'?'text/javascript; charset=utf-8':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(route==='/__demo'?html:route==='/__demo.js'?js:JSON.stringify({definition,digest}));
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/__demo'));
