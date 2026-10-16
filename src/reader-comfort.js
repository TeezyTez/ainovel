import {defaultSettings} from './storage.js';
const themes=['paper','white','sage','night'];
export function resetReadingAppearance(settings){
  return {...settings,fontSize:defaultSettings.fontSize,lineHeight:defaultSettings.lineHeight,width:defaultSettings.width,fontFamily:'serif',paragraphGap:'normal',theme:'light',readingTheme:'paper',reducedMotion:false};
}
const clamp=(value,fallback,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))&&value!==undefined?Number(value):fallback));
export function readingAppearance(settings={},dark=false){
  return {
    readingTheme:themes.includes(settings.readingTheme)?settings.readingTheme:settings.theme==='dark'||settings.theme==='system'&&dark?'night':'paper',
    fontSize:clamp(settings.fontSize,18,16,30),lineHeight:clamp(settings.lineHeight,1.95,1.5,2.5),width:clamp(settings.width,720,480,880),
    fontFamily:['serif','sans','system'].includes(settings.fontFamily)?settings.fontFamily:'serif',
    paragraphGap:['normal','wide','compact'].includes(settings.paragraphGap)?settings.paragraphGap:'normal',
  };
}
const select=(name,label,entries,value)=>`<label class="field">${label}<select name="${name}" data-reader-setting>${entries.map(([v,text])=>`<option value="${v}" ${value===v?'selected':''}>${text}</option>`).join('')}</select></label>`;
export function readingAppearanceView(settings={},dark=false){
  const a=readingAppearance(settings,dark);
  return `<p class="reader-settings-note" role="status">阅读外观即时生效，自动保存。</p>
    <fieldset class="reader-theme-options"><legend>阅读主题</legend>${themes.map((theme,i)=>`<label class="reader-theme-choice" data-theme-swatch="${theme}"><input type="radio" name="readingTheme" value="${theme}" ${a.readingTheme===theme?'checked':''} data-reader-setting><span aria-hidden="true">文</span><strong>${['纸张','柔白','浅绿','夜间'][i]}</strong></label>`).join('')}</fieldset>
    <div class="reader-size-control"><span id="reader-size-label">正文字号</span><button type="button" data-size-step="-1" aria-label="减小字号">A−</button><input aria-labelledby="reader-size-label" type="range" name="fontSize" min="16" max="30" step="1" value="${a.fontSize}" data-reader-setting><button type="button" data-size-step="1" aria-label="增大字号">A+</button><output data-reading-size>${a.fontSize}</output></div>
    <fieldset class="reader-spacing-options"><legend>行距</legend>${[[1.6,'紧凑'],[1.95,'适中'],[2.3,'宽松']].map(([value,label])=>`<button type="button" data-leading="${value}" aria-pressed="${a.lineHeight===value}">${label}</button>`).join('')}</fieldset>
    <div class="reader-type-preview" data-theme-swatch="${a.readingTheme}" aria-label="排版预览">雨停了，窗外传来轻轻的脚步声。你翻开书，故事从这里继续。</div>
    <details class="settings-extra"><summary>字体与精细排版</summary><div class="field-grid">
    ${select('fontFamily','字体',[['serif','宋体／衬线'],['sans','黑体／无衬线'],['system','系统字体']],a.fontFamily)}
    ${select('paragraphGap','段落间距',[['compact','紧凑'],['normal','适中'],['wide','宽松']],a.paragraphGap)}
    <label class="field">行距<input name="lineHeight" type="number" min="1.5" max="2.5" step="0.05" value="${a.lineHeight}" data-reader-setting></label>
    <label class="field">正文宽度<input name="width" type="range" min="480" max="880" step="20" value="${a.width}" data-reader-setting></label>
    ${select('readingMode','阅读方式',[['continuous','连续滚动'],['paged','按回合翻页']],settings.readingMode||'continuous')}
    ${select('theme','界面明暗',[['light','浅色'],['dark','深色'],['system','跟随系统']],settings.theme||'light')}
    </div></details>`;
}
export function applyReadingAppearance(settings,root=document){
  const host=root.querySelector('.reading-experience');if(!host)return;
  const a=readingAppearance(settings,root.body?.dataset.theme==='dark');
  host.dataset.readingTheme=a.readingTheme;
  if(root.body)root.body.dataset.readingTheme=a.readingTheme;
  const preview=root.querySelector('.reader-type-preview');if(preview)preview.dataset.themeSwatch=a.readingTheme;
  for(const target of [host,preview].filter(Boolean))for(const [name,value] of Object.entries({'size':a.fontSize+'px','leading':a.lineHeight,'width':a.width+'px','font':a.fontFamily==='system'?'system-ui, sans-serif':a.fontFamily==='sans'?'var(--sans)':'var(--serif)','paragraph-gap':{compact:'.65em',normal:'1.15em',wide:'1.6em'}[a.paragraphGap]}))target.style.setProperty('--reading-'+name,value);
}

// Retain the user's drawer choice across live updates without storing UI state
// in the story or touching its draft. A new branch starts in reading mode.
let composerKey='',expanded=false;
const composerListeners=new WeakMap();
export function bindReadingComposer(key,root=document){
  const host=root.querySelector('.reading-composer-wrap'),body=root.querySelector('#reading-action-body'),toggle=root.querySelector('[data-action="toggle-composer"]');
  if(!host||!body||!toggle)return;
  if(key!==composerKey){composerKey=key;expanded=false;}
  const sync=()=>{
    body.hidden=!expanded;host.dataset.expanded=String(expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.textContent=expanded?'收起行动':root.querySelector('#action-input')?.value.trim()?'展开行动 · 有草稿':'展开行动';
  };
  const previous=composerListeners.get(host);if(previous)host.removeEventListener('reader-compose-open',previous);
  const open=()=>{expanded=true;sync();};composerListeners.set(host,open);
  host.addEventListener('reader-compose-open',open);
  toggle.onclick=()=>{expanded=!expanded;sync();if(expanded)focusActionInput(root);else toggle.focus({preventScroll:true});};
  sync();
}
export function focusActionInput(root=document){
  root.querySelector('.reading-composer-wrap')?.dispatchEvent(new Event('reader-compose-open'));
  const field=root.querySelector('#action-input');
  field?.focus({preventScroll:true});
  if(field?.style){field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';}
}

// Transient character anchors survive reflow, including text inside object links.
// Range measurement also works while a modal covers the underlying reading page.
export function captureReadingViewport(root=document){
  const edge=(root.querySelector('.reading-header')?.getBoundingClientRect().bottom||80)+20;
  const paragraph=[...root.querySelectorAll('.reading-prose p')].find(el=>el.getBoundingClientRect().bottom>edge);
  if(!paragraph)return null;
  const walker=root.createTreeWalker(paragraph,4),range=root.createRange();
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(!node.length)continue;
    range.selectNodeContents(node);if(range.getBoundingClientRect().bottom<=edge)continue;
    let low=0,high=node.length-1;
    while(low<high){const mid=(low+high)>>1;range.setStart(node,mid);range.setEnd(node,mid+1);if(range.getBoundingClientRect().top<edge)low=mid+1;else high=mid;}
    range.setStart(node,low);range.setEnd(node,low+1);
    return {node,index:low,top:range.getBoundingClientRect().top};
  }
  return null;
}
export function restoreReadingViewport(anchor,root=document){
  if(!anchor?.node.isConnected)return;
  const range=root.createRange();range.setStart(anchor.node,anchor.index);range.setEnd(anchor.node,anchor.index+1);
  root.defaultView.scrollBy({top:range.getBoundingClientRect().top-anchor.top,behavior:'instant'});
}
