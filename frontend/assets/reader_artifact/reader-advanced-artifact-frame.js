// This file runs only in an opaque sandboxed iframe. The host checks the
// message source and token; this document has no network, storage, or forms.
(()=>{
  let started=false;
  const cleanState=value=>{
    let count=0;
    const visit=(item,depth)=>{
      if(depth>8||++count>500)throw new Error('交互图状态过于复杂。');
      if(item===null||typeof item==='string'||typeof item==='boolean')return;
      if(typeof item==='number'&&Number.isFinite(item))return;
      if(!item||typeof item!=='object'||(!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null))throw new Error('交互图状态必须是JSON。');
      if(Object.getOwnPropertySymbols(item).length)throw new Error('交互图状态必须是JSON。');
      if(Array.isArray(item)&&(item.length>500||Object.keys(item).length!==item.length||Array.from({length:item.length},(_,i)=>Object.hasOwn(item,i)).some(present=>!present)))throw new Error('交互图状态不能含缺失或额外的数组项。');
      for(const [key,part] of Object.entries(item)){
        if(['__proto__','prototype','constructor'].includes(key))throw new Error('交互图状态含不安全字段。');
        visit(part,depth+1);
      }
    };
    visit(value,0);
    const json=JSON.stringify(value);
    if(json.length>6000)throw new Error('交互图状态过长。');
    return JSON.parse(json);
  };
  function start(payload){
    const node=payload.node,token=payload.token;
    const send=(kind,value)=>window.parent.postMessage({channel:'story-artifact',token,kind,value},'*');
    const report=error=>send('error',String(error?.message||error||'交互图运行失败').slice(0,500));
    const root=document.getElementById('artifact-root');
    if(!node||node.type!=='interactive'||typeof node.html!=='string'||typeof node.css!=='string'||typeof node.script!=='string'||node.script.length>1200000){report('交互图数据无效。');return;}
    for(const [key,value] of Object.entries(payload.theme??{}))
      if(['ink','muted','paper','soft','accent','line'].includes(key)&&typeof value==='string'&&/^[#a-zA-Z\d\s(),.%/-]+$/.test(value))document.documentElement.style.setProperty('--'+key,value);
    const allowed=new Set('main section article header footer aside div span p h1 h2 h3 h4 h5 h6 label input textarea select option optgroup button output fieldset legend details summary ul ol li dl dt dd table caption thead tbody tfoot tr th td strong em small b i br hr pre code svg g path rect circle ellipse line polyline polygon text tspan defs marker title desc'.split(' '));
    const attrs=new Set('id class title role tabindex style for type min max step value placeholder rows cols maxlength minlength readonly checked selected disabled multiple required name width height viewbox d x y x1 y1 x2 y2 cx cy r rx ry points fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin transform text-anchor dominant-baseline font-size opacity offset marker-start marker-end refx refy markerwidth markerheight orient preserveaspectratio colspan rowspan'.split(' '));
    const template=document.createElement('template');template.innerHTML=node.html;
    for(const element of [...template.content.querySelectorAll('*')]){
      if(!allowed.has(element.localName.toLowerCase())){element.remove();continue;}
      for(const attribute of [...element.attributes])if(!(attrs.has(attribute.name.toLowerCase())||/^(?:aria|data)-[\w-]+$/.test(attribute.name))||/url\s*\((?!\s*['"]?#)/i.test(attribute.value))element.removeAttribute(attribute.name);
      if(element.localName==='input'&&!['range','number','text','checkbox','radio'].includes(element.type))element.type='text';
      if(element.localName==='button')element.type='button';
    }
    root.append(template.content);
    const style=document.createElement('style');style.textContent=node.css;document.head.append(style);
    let state;
    try{state=cleanState(payload.state??node.initialState??{});}catch(error){report(error);return;}
    let lastGesture=0,failed=false;
    document.addEventListener('click',event=>{if(event.isTrusted)lastGesture=performance.now();},true);
    document.addEventListener('keydown',event=>{if(event.isTrusted)lastGesture=performance.now();},true);
    const api={get state(){return state;},setState(value){state=cleanState(value);send('state',state);},draft(text){if(performance.now()-lastGesture>1200||!lastGesture)return;if(typeof text==='string'&&text.length<=1000)send('draft',text);}};
    Object.defineProperty(window,'ui',{value:Object.freeze(api),writable:false});
    window.addEventListener('error',event=>{failed=true;report(event.error||event.message);});
    window.addEventListener('unhandledrejection',event=>{failed=true;report(event.reason);});
    const resize=()=>send('height',Math.min(1200,Math.max(220,root.getBoundingClientRect().height+32)));
    if(window.ResizeObserver)new ResizeObserver(resize).observe(root);
    const ready=()=>{
      resize();if(failed)return;
      if(!root.innerText.trim()&&!root.querySelector('svg')){report('界面没有可见内容，请补充可读文字与控件。');return;}
      if(!root.querySelector('input,textarea,select,button')){report('交互图需要可操作的控件；静态内容请使用表格或图示。');return;}
      if(root.scrollWidth>document.documentElement.clientWidth+20){report('界面超出可用宽度，请修复响应式布局。');return;}
      send('ready',{controls:root.querySelectorAll('input,textarea,select,button').length});
    };
    const blob=URL.createObjectURL(new Blob([node.script],{type:'text/javascript'}));
    const script=document.createElement('script');script.src=blob;
    script.onload=()=>{URL.revokeObjectURL(blob);requestAnimationFrame(()=>requestAnimationFrame(ready));setTimeout(ready,250);};
    script.onerror=()=>{URL.revokeObjectURL(blob);report('交互图脚本无法载入。');};
    document.body.append(script);
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(started||event.source!==window.parent||data?.channel!=='story-artifact-init'||typeof data.token!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data.token))return;
    started=true;start(data);
  });
  window.parent.postMessage({channel:'story-artifact-shell-ready'},'*');
})();
