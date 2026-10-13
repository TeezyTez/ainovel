// Responsive UI preview on a separate origin. No .env, model credentials or
// player ledger are loaded; normal application controls create local demos.
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../server.mjs';

const port=4186;
const ledgerDirectory=await mkdtemp(join(tmpdir(),'elselife-editorial-preview-'));
const server=createServer({env:{MODEL_PROVIDER:''},ledgerDirectory});
const appHandler=server.listeners('request')[0];

const previewPage=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elselife · 响应式预览</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#e6e5df;color:#292d29;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}button,a{font:inherit;color:inherit}button,a:focus-visible{outline:2px solid #375b45;outline-offset:3px}button{cursor:pointer}.preview-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 22px;padding:12px 18px;background:#fcfbf7;border-bottom:1px solid #cecfc5}.preview-toolbar strong{font-size:13px;white-space:nowrap}.preview-widths,.preview-routes{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.preview-widths button,.preview-routes a{border:1px solid transparent;border-radius:5px;padding:6px 10px;background:transparent;text-decoration:none;min-height:34px}.preview-widths button[aria-pressed=true]{border-color:#375b45;background:#e8eee6}.preview-routes a:hover,.preview-widths button:hover{background:#e8eee6}.preview-note{font-size:11px;color:#667063}.preview-note a{text-decoration:underline}.preview-workspace{display:flex;justify-content:center;align-items:flex-start;padding:20px 16px;overflow:auto}.preview-canvas{position:relative;flex:none;box-shadow:0 8px 38px #2632261b;background:white}#preview-frame{position:absolute;top:0;left:0;width:1440px;height:1000px;max-width:none;border:0;display:block;transform-origin:top left;background:white}#preview-metrics{font-size:11px;color:#667063;white-space:nowrap}@media(max-width:550px){.preview-toolbar{gap:8px 12px;padding:10px}.preview-note{width:100%}.preview-workspace{padding:12px 8px}}
</style><script type="module" src="/__preview.js"></script></head>
<body><header class="preview-toolbar"><strong>ELSELIFE / 界面预览</strong><div class="preview-widths" role="group" aria-label="布局宽度">${[1440,1024,390,320].map(width=>`<button type="button" data-width="${width}" aria-pressed="${width===1440}">${width}px</button>`).join('')}</div><nav class="preview-routes" aria-label="预览页面"><a target="preview-frame" href="/#/">首页</a><a target="preview-frame" href="/#/stories">我的世界</a><a target="preview-frame" href="/#/create">创作</a><a target="preview-frame" href="/#/settings">设置</a><a id="preview-reading-link" target="preview-frame" href="/#/stories" title="先在预览中进入一个预设世界，并开始演示故事">经历</a></nav><output id="preview-metrics" aria-live="polite"></output><span class="preview-note">隔离预览 · 真实模型关闭 · <a href="/" target="_blank" rel="noopener">独立打开</a></span></header><main class="preview-workspace"><div class="preview-canvas"><iframe id="preview-frame" name="preview-frame" src="/" width="1440" height="1000" title="Elselife 可交互响应式预览"></iframe></div></main></body></html>`;

const previewScript=`const frame=document.getElementById('preview-frame');
const canvas=document.querySelector('.preview-canvas');
const workspace=document.querySelector('.preview-workspace');
const toolbar=document.querySelector('.preview-toolbar');
const metrics=document.getElementById('preview-metrics');
const readingLink=document.getElementById('preview-reading-link');
const widths=[1440,1024,390,320],height=1000;
const requested=Number(new URL(location.href).searchParams.get('width'));
let width=widths.includes(requested)?requested:1440;
function fit(){
  const availableWidth=Math.max(160,workspace.clientWidth-32);
  const availableHeight=Math.max(240,innerHeight-toolbar.getBoundingClientRect().height-40);
  const scale=Math.min(1,availableWidth/width,availableHeight/height);
  frame.style.width=width+'px';frame.style.height=height+'px';
  frame.style.transform='scale('+scale+')';
  canvas.style.width=width*scale+'px';canvas.style.height=height*scale+'px';
  for(const control of document.querySelectorAll('[data-width]'))control.setAttribute('aria-pressed',String(Number(control.dataset.width)===width));
  metrics.textContent=width+' × '+height+' · 缩放 '+Math.round(scale*100)+'%';
}
function rememberReadingRoute(){
  const hash=frame.contentWindow.location.hash;
  if(/^#\\/story\\/[^/]+$/.test(hash)){
    readingLink.href='/'+hash;
    readingLink.title='返回刚才的演示故事';
  }
}
for(const control of document.querySelectorAll('[data-width]'))control.addEventListener('click',()=>{
  width=Number(control.dataset.width);
  const url=new URL(location.href);url.searchParams.set('width',String(width));history.replaceState(null,'',url);
  fit();
});
frame.addEventListener('load',()=>{rememberReadingRoute();frame.contentWindow.addEventListener('hashchange',rememberReadingRoute);fit();});
new ResizeObserver(fit).observe(toolbar);
addEventListener('resize',fit);fit();
`;

const shellPolicy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function send(res,method,content,type){
  res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store','content-security-policy':shellPolicy,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(method==='HEAD'?undefined:content);
}
server.removeAllListeners('request');
server.on('request',(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/__preview'||url.pathname==='/__preview.js'){
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||!['GET','HEAD'].includes(req.method)){
      res.writeHead(403,{'content-type':'text/plain; charset=utf-8'});res.end('仅支持本机预览。');return;
    }
    return url.pathname==='/__preview'?send(res,req.method,previewPage,'text/html'):send(res,req.method,previewScript,'text/javascript');
  }
  if(url.pathname==='/'||url.pathname==='/index.html'){
    // Only this development origin's app document permits same-origin framing.
    // The production server and every other CSP directive remain unchanged.
    const setHeader=res.setHeader;
    res.setHeader=function(name,value){
      if(String(name).toLowerCase()==='content-security-policy')value=String(value).replace("frame-ancestors 'none'","frame-ancestors 'self'");
      return setHeader.call(this,name,value);
    };
  }
  return appHandler(req,res);
});
server.on('error',error=>{console.error('预览服务启动失败：'+error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Isolated editorial preview (real model disabled):\nhttp://127.0.0.1:'+port+'/__preview\nhttp://127.0.0.1:'+port+'/__preview?width=390\nTemporary ledger: '+ledgerDirectory));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
