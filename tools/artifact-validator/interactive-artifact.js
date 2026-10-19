const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const keys=['type','title','description','html','css','script','height','when','caption','initialState'];
export function validateInteractiveView(node){
  check(node?.type==='interactive'&&Object.keys(node).every(k=>keys.includes(k)),'交互图含不支持的属性。');
  for(const [key,max] of [['title',200],['description',2000],['html',20000],['css',12000],['script',24000]])check(typeof node[key]==='string'&&node[key].length<=max&&(!['title','description','html'].includes(key)||!!node[key].trim()),'交互图的'+key+'无效或过长。');
  check(node.height===undefined||Number.isFinite(node.height)&&node.height>=220&&node.height<=800,'交互图高度应在220至800之间。');
  if(Object.hasOwn(node,'initialState'))cleanArtifactState(node.initialState);
  // Defense in depth; the actual authority boundary is the opaque sandbox + host bridge.
  check(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|eval|Function|import|parent|top|opener|location|localStorage|sessionStorage|indexedDB)\b|document\s*\.\s*cookie/.test(node.script),'交互图只能本地计算；不可访问网络、宿主或存储，请使用ui接口。');
  check(!/@import\b|url\s*\(|expression\s*\(/i.test(node.css),'交互图样式不可载入外部资源。');
  return true;
}
export function cleanArtifactState(value){
  // Self-contained so the iframe uses this exact validator before serialization.
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  let count=0;
  function visit(v,depth){
    check(depth<=8&&++count<=500,'交互图状态过于复杂。');
    if(v===null||typeof v==='boolean'||typeof v==='string')return;
    if(typeof v==='number'){check(Number.isFinite(v),'交互图状态含无效数值。');return;}
    check(v&&typeof v==='object'&&(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null),'交互图状态必须是JSON。');
    check(Object.getOwnPropertySymbols(v).length===0,'交互图状态必须是JSON。');
    if(Array.isArray(v))check(v.length<=500&&Object.keys(v).length===v.length&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean),'交互图状态不能含缺失或额外的数组项。');
    for(const [k,x] of Object.entries(v)){check(!['__proto__','prototype','constructor'].includes(k),'交互图状态含不安全字段。');visit(x,depth+1);}
  }
  visit(value,0);const json=JSON.stringify(value);check(json.length<=6000,'交互图状态过长。');return JSON.parse(json);
}

// Runs only inside the opaque iframe. Generated markup is parsed inertly and cleaned
// before insertion; generated JS is the sole permitted script payload, with a nonce.
function boot(payload,cleanState){
  const send=(kind,value)=>window.parent.postMessage({channel:'story-artifact',token:payload.token,kind,value},'*');
  const root=document.getElementById('artifact-root'),template=document.createElement('template');
  for(const [k,v] of Object.entries(payload.theme??{}))if(['ink','muted','paper','soft','accent','line'].includes(k)&&typeof v==='string'&&/^[#a-zA-Z\d\s(),.%/-]+$/.test(v))document.documentElement.style.setProperty('--'+k,v);
  const allowed=new Set('main section article header footer aside div span p h1 h2 h3 h4 h5 h6 label input textarea select option optgroup button output fieldset legend details summary ul ol li dl dt dd table caption thead tbody tfoot tr th td strong em small b i br hr pre code svg g path rect circle ellipse line polyline polygon text tspan defs marker title desc'.split(' '));
  const attrs=new Set('id class title role tabindex style for type min max step value placeholder rows cols maxlength minlength readonly checked selected disabled multiple required name width height viewbox d x y x1 y1 x2 y2 cx cy r rx ry points fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin transform text-anchor dominant-baseline font-size opacity offset marker-start marker-end refx refy markerwidth markerheight orient preserveaspectratio colspan rowspan'.split(' '));
  template.innerHTML=payload.node.html;
  for(const el of [...template.content.querySelectorAll('*')]){
    if(!allowed.has(el.localName.toLowerCase())){el.remove();continue;}
    for(const a of [...el.attributes])if(!(attrs.has(a.name.toLowerCase())||/^(?:aria|data)-[\w-]+$/.test(a.name))||/url\s*\((?!\s*['"]?#)/i.test(a.value))el.removeAttribute(a.name);
    if(el.localName==='input'&&!['range','number','text','checkbox','radio'].includes(el.type))el.type='text';
    if(el.localName==='button')el.type='button';
  }
  root.append(template.content);const style=document.createElement('style');style.textContent=payload.node.css;document.head.append(style);
  let state=payload.state,lastGesture=0;
  document.addEventListener('click',event=>{if(event.isTrusted)lastGesture=performance.now();},true);
  document.addEventListener('keydown',event=>{if(event.isTrusted)lastGesture=performance.now();},true);
  const api={get state(){return state;},setState(value){state=cleanState(value);send('state',state);},draft(text){if(performance.now()-lastGesture>1200||!lastGesture)return;if(typeof text==='string'&&text.length<=1000)send('draft',text);}};
  Object.defineProperty(window,'ui',{value:Object.freeze(api),writable:false});
  let failed=false;const report=error=>{failed=true;send('error',String(error?.message||error||'交互图运行失败').slice(0,500));};
  window.addEventListener('error',event=>report(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>report(event.reason));
  try{const script=document.createElement('script');script.nonce=payload.token;script.textContent=payload.node.script;document.body.append(script);}catch(error){report(error);}
  const resize=()=>send('height',Math.min(1200,Math.max(220,root.getBoundingClientRect().height+32)));
  if(window.ResizeObserver)new ResizeObserver(resize).observe(root);
  let checked=false;const ready=()=>{if(checked)return;checked=true;
    resize();if(failed)return;
    if(!root.innerText.trim()&&!root.querySelector('svg')){report('界面没有可见内容，请补充可读文字与控件。');return;}
    if(!root.querySelector('input,textarea,select,button')){report('交互图需要可操作的控件；静态内容请使用表格或图示。');return;}
    if(root.scrollWidth>document.documentElement.clientWidth+20){report('界面超出可用宽度，请修复响应式布局。');return;}
    send('ready',{controls:root.querySelectorAll('input,textarea,select,button').length});
  };
  // Chromium may suspend animation frames for an offscreen iframe. Readiness
  // must also settle when history/details push a newly restored view below it.
  requestAnimationFrame(()=>requestAnimationFrame(ready));setTimeout(ready,250);
}

export function artifactPolicy(token){
  check(/^[A-Za-z0-9_-]{1,80}$/.test(token),'交互图实例标识无效。');
  return `default-src 'none'; script-src 'nonce-${token}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}
export function artifactShell(token){return artifactDocument(null,{token});}
export function artifactDocument(node,{token,state=node&&Object.hasOwn(node,'initialState')?node.initialState:{},theme={}}){
  check(/^[A-Za-z0-9_-]+$/.test(token),'交互图实例标识无效。');
  const payload=JSON.stringify({node,token,state:cleanArtifactState(state)}).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  // A navigated shell gets its own CSP; srcdoc inherits the application's CSP.
  const script=node?`(${boot.toString()})(${payload},(${cleanArtifactState.toString()}));`:`(()=>{const token=${JSON.stringify(token)};function init(event){if(event.source!==window.parent||event.data?.channel!=='story-artifact-init'||event.data.token!==token)return;window.removeEventListener('message',init);(${boot.toString()})(event.data,(${cleanArtifactState.toString()}));}window.addEventListener('message',init);})();`;
  const colors=Object.entries(theme).filter(([k,v])=>['ink','muted','paper','soft','accent','line'].includes(k)&&/^[#a-zA-Z\d\s(),.%/-]+$/.test(v)).map(([k,v])=>'--'+k+':'+v).join(';');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${artifactPolicy(token)}"><style>:root{--ink:#262530;--muted:#72717e;--paper:#fff;--soft:#efedf5;--accent:#7159ba;--line:#dedbe8;${colors};color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,sans-serif}h1,h2,h3,p{margin:0 0 12px}h1,h2{font-size:20px}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:8px 12px;background:var(--soft)}input[type=range]{width:100%;accent-color:var(--accent)}svg{max-width:100%}label{display:block}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style></head><body><main id="artifact-root"></main><script nonce="${token}">${script}</script></body></html>`;
}
export function artifactFrame(node,{id,historical=false}){
  if(historical)return `<section class="rich-view rich-interactive"><h4>${esc(node.title)}</h4><p>${esc(node.description)}</p><p class="small muted">历史交互图 · 返回当前场景后可重新整理。</p></section>`;
  return `<section class="rich-view rich-interactive" data-interactive-id="${esc(id)}" data-interactive-definition="${esc(JSON.stringify(node))}"><p class="small muted">${esc(node.description)}</p><iframe title="${esc(node.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" style="height:${node.height??360}px" loading="eager"></iframe><p data-artifact-status role="status">正在打开交互图…</p><button type="button" class="btn compact" data-artifact-repair hidden>重新整理这张图</button></section>`;
}
