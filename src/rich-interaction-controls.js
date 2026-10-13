// These controls only change presentation and local writing; never submit a turn.
const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
let viewerSequence=0;
const disclosureBindings=new WeakMap();
export function compareRichCells(a,b){
  const numbers=[a,b].map(s=>String(s).trim());
  if(numbers.every(s=>/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)&&Number.isFinite(Number(s))))return Number(numbers[0])-Number(numbers[1]);
  return collator.compare(String(a),String(b));
}

// Inspect only an already-rendered, validated SVG. No model markup is parsed here.
function inspectVisual(opener){
  const visual=opener.closest('[data-rich-visual]'),source=visual?.querySelector('svg');
  if(!source)return;
  const doc=opener.ownerDocument,dialog=doc.createElement('dialog');
  dialog.className='rich-visual-dialog';
  const headingId='rich-viewer-heading-'+(++viewerSequence);dialog.setAttribute('aria-labelledby',headingId);
  const header=doc.createElement('header');header.className='rich-viewer-header';
  const heading=doc.createElement('h2');heading.id=headingId;heading.textContent=visual.dataset.richVisual;
  const makeButton=(text,label,handler)=>{const button=doc.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label',label);button.onclick=handler;return button;};
  const close=makeButton('×','关闭图示',()=>dialog.close());close.className='rich-viewer-close';header.append(heading,close);
  const stage=doc.createElement('div');stage.className='rich-viewer-stage';stage.tabIndex=0;stage.setAttribute('aria-label','图示，可滚动查看');
  const svg=source.cloneNode(true),identities=new Map();
  for(const node of svg.querySelectorAll('[id]')){identities.set(node.id,node.id+'-viewer-'+viewerSequence);node.id=identities.get(node.id);}
  for(const node of [svg,...svg.querySelectorAll('*')]){
    for(const name of ['marker-start','marker-mid','marker-end','fill','stroke']){const attribute=node.getAttribute(name);if(attribute)node.setAttribute(name,attribute.replace(/url\(#([^)]+)\)/g,(match,id)=>identities.has(id)?`url(#${identities.get(id)})`:match));}
    for(const name of ['aria-labelledby','aria-describedby']){const attribute=node.getAttribute(name);if(attribute)node.setAttribute(name,attribute.split(/\s+/).map(id=>identities.get(id)||id).join(' '));}
  }
  svg.removeAttribute('aria-hidden');svg.setAttribute('role','img');svg.setAttribute('aria-label',visual.dataset.richVisual);
  stage.append(svg);
  const toolbar=doc.createElement('footer');toolbar.className='rich-viewer-toolbar';
  const hint=doc.createElement('span');hint.className='rich-viewer-hint';hint.textContent='缩放或滑动查看';
  const controls=doc.createElement('div'),scaleLabel=doc.createElement('output');scaleLabel.setAttribute('aria-live','polite');scaleLabel.setAttribute('aria-label','缩放比例');
  const naturalWidth=Number(svg.getAttribute('viewBox')?.split(/[ ,]+/)[2])||720;let scale=1;
  const resize=next=>{scale=Math.max(.25,Math.min(3,next));svg.style.width=naturalWidth*scale+'px';scaleLabel.textContent=Math.round(scale*100)+'%';};
  const smaller=makeButton('−','缩小图示',()=>resize(scale-.25)),larger=makeButton('+','放大图示',()=>resize(scale+.25)),fit=makeButton('适应窗口','将图示适应窗口',()=>resize(Math.max(100,stage.clientWidth-40)/naturalWidth));
  controls.append(smaller,scaleLabel,larger,fit);toolbar.append(hint,controls);dialog.append(header,stage,toolbar);doc.body.append(dialog);resize(1);
  const leave=()=>dialog.close();
  dialog.addEventListener('close',()=>{globalThis.removeEventListener('hashchange',leave);dialog.remove();if(opener.isConnected)opener.focus({preventScroll:true});else doc.querySelector('#action-input')?.focus({preventScroll:true});},{once:true});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();});
  globalThis.addEventListener('hashchange',leave,{once:true});dialog.showModal();close.focus({preventScroll:true});
}

function sortTable(sort,descending){
  const wrapper=sort.closest('[data-rich-table]'),column=Number(sort.dataset.richSort),th=sort.closest('th'),body=wrapper.querySelector('tbody');
  const rows=[...body.rows];rows.sort((a,b)=>compareRichCells(a.cells[column]?.textContent||'',b.cells[column]?.textContent||'')*(descending?-1:1));
  body.append(...rows);wrapper.querySelectorAll('thead th').forEach(el=>{el.setAttribute('aria-sort','none');const indicator=el.querySelector('button span');if(indicator)indicator.textContent='↕';});th?.setAttribute('aria-sort',descending?'descending':'ascending');
  const indicator=sort.querySelector('span');if(indicator)indicator.textContent=descending?'↓':'↑';
  const status=wrapper.querySelector('[data-rich-table-status]');if(status)status.textContent=`${rows.filter(row=>!row.hidden).length} 条记录 · ${descending?'降序':'升序'}`;
}
function filterTable(wrapper,value){
  const query=value.trim().toLocaleLowerCase(),rows=[...wrapper.querySelectorAll('tbody tr')];
  for(const row of rows)row.hidden=!row.textContent.toLocaleLowerCase().includes(query);
  const count=rows.filter(row=>!row.hidden).length,status=wrapper.querySelector('[data-rich-table-status]'),empty=wrapper.querySelector('[data-rich-empty]');
  if(status)status.textContent=query?`显示 ${count} / ${rows.length} 条`:`${rows.length} 条记录`;if(empty)empty.hidden=count!==0;
}

export function bindRichControls(root,{ready,draft,toast,presentation={}}){
  const views=presentation.views??=(Object.create(null));
  const stateFor=target=>{const view=target?.dataset?.richId?target:target?.closest?.('[data-rich-id]');return view?.dataset?.richId?(views[view.dataset.richId]??={}):null;};
  const previous=disclosureBindings.get(root);if(previous)root.removeEventListener?.('toggle',previous,true);
  const recordDisclosure=event=>{const key=event.target.dataset?.richDetail,saved=key?stateFor(event.target):null;if(saved)(saved.details??={})[key]=event.target.open;};
  root.addEventListener?.('toggle',recordDisclosure,true);disclosureBindings.set(root,recordDisclosure);
  for(const view of root.querySelectorAll?.('[data-rich-id]')||[]){
    const saved=views[view.dataset.richId];if(!saved)continue;
    if(saved.sort){const button=view.querySelector(`[data-rich-sort="${saved.sort.column}"]`);if(button)sortTable(button,saved.sort.descending);}
    const filter=view.querySelector('[data-rich-filter]');if(filter&&typeof saved.filter==='string'){filter.value=saved.filter;filterTable(view,saved.filter);}
    for(const detail of view.querySelectorAll('[data-rich-detail]'))if(typeof saved.details?.[detail.dataset.richDetail]==='boolean')detail.open=saved.details[detail.dataset.richDetail];
  }
  root.onclick=e=>{
    const expand=e.target.closest('[data-rich-expand]');
    if(expand&&root.contains(expand)){inspectVisual(expand);return;}
    const prompt=e.target.closest('[data-rich-draft]');
    if(prompt&&root.contains(prompt)){if(ready())try{draft(prompt.dataset.richDraft);for(const button of prompt.ownerDocument?.querySelectorAll('[data-rich-draft]')||[prompt]){if(button.dataset.richDraft!==prompt.dataset.richDraft)continue;const label=button.querySelector('[data-rich-draft-label]');if(label)label.textContent='已写入草稿';button.setAttribute('data-rich-drafted','true');}toast('已写入草稿，可修改后发送。');}catch(error){toast(error.message);}return;}
    const sort=e.target.closest('[data-rich-sort]'),wrapper=sort?.closest('[data-rich-table]');
    if(!wrapper)return;
    const descending=sort.closest('th')?.getAttribute('aria-sort')==='ascending',saved=stateFor(wrapper);if(saved)saved.sort={column:Number(sort.dataset.richSort),descending};
    sortTable(sort,descending);
  };
  root.oninput=e=>{
    if(!e.target.matches('[data-rich-filter]'))return;
    const wrapper=e.target.closest('[data-rich-table]'),saved=stateFor(wrapper);if(saved)saved.filter=e.target.value;
    filterTable(wrapper,e.target.value);
  };
}
