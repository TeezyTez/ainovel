import test from 'node:test';
import assert from 'node:assert/strict';
import {bindRichControls} from '../src/rich-interaction-controls.js';

function browsingTable(){
  const listeners=new Map(),body={rows:[['绳子',10],['水',2],['绳子',4]].map(values=>({hidden:false,textContent:values.join(' '),cells:values.map(value=>({textContent:String(value)}))})),append(...rows){this.rows=rows;}},status={textContent:''},empty={hidden:true};
  const headers=[0,1].map(column=>{const indicator={textContent:'↕'},header={sort:'none',getAttribute(){return this.sort;},setAttribute(name,value){this.sort=value;},querySelector(){return indicator;}};const button={dataset:{richSort:String(column)},querySelector:()=>indicator,closest:selector=>selector==='th'?header:table};return {header,button,indicator};});
  const filter={value:'',matches:selector=>selector==='[data-rich-filter]',closest:()=>table};
  const detail={dataset:{richDetail:'table-search'},open:false,closest:()=>table};
  const table={dataset:{richId:'rich-fixed'},matches:selector=>selector==='[data-rich-id]',closest:()=>table,querySelector:selector=>selector==='tbody'?body:selector==='[data-rich-filter]'?filter:selector==='[data-rich-table-status]'?status:selector==='[data-rich-empty]'?empty:headers.find(({button})=>selector===`[data-rich-sort="${button.dataset.richSort}"]`)?.button,querySelectorAll:selector=>selector==='thead th'?headers.map(item=>item.header):selector==='tbody tr'?body.rows:selector==='[data-rich-detail]'?[detail]:[]};
  const root={contains:()=>true,querySelectorAll:selector=>selector==='[data-rich-id]'?[table]:[],addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);}};
  return {root,table,body,headers,filter,detail,status,listeners,sort(){root.onclick({target:{closest:selector=>selector==='[data-rich-sort]'?headers[1].button:null}});},search(value){filter.value=value;root.oninput({target:filter});},expand(){detail.open=true;listeners.get('toggle')?.({target:detail});}};
}

test('same-definition remounts restore sorting, search and expanded details without changing a new definition',()=>{
  const presentation={},options={ready:()=>true,draft:()=>{},toast:()=>{},presentation},first=browsingTable();
  bindRichControls(first.root,options);first.sort();first.search('绳子');first.expand();
  const remounted=browsingTable();bindRichControls(remounted.root,options);
  assert.deepEqual(remounted.body.rows.map(row=>Number(row.cells[1].textContent)),[2,4,10]);
  assert.deepEqual(remounted.body.rows.map(row=>row.hidden),[true,false,false]);
  assert.equal(remounted.filter.value,'绳子');assert.equal(remounted.headers[1].indicator.textContent,'↑');assert.equal(remounted.detail.open,true);
  assert.match(remounted.status.textContent,/2 \/ 3/);
  bindRichControls(remounted.root,options);assert.equal(remounted.listeners.size,1);
  const fresh=browsingTable();bindRichControls(fresh.root,{...options,presentation:{}});
  assert.equal(fresh.filter.value,'');assert.equal(fresh.detail.open,false);
  assert.deepEqual(fresh.body.rows.map(row=>Number(row.cells[1].textContent)),[10,2,4]);
});

test('sorting updates the visible direction and announces the chosen column without touching story data',()=>{
  const state={sort:'none'},arrow={textContent:'↕'},button={dataset:{richSort:'0'},textContent:'数量↕',getAttribute:()=> '按数量排序',querySelector:()=>arrow};
  const th={getAttribute:()=>state.sort,setAttribute:(name,value)=>{state.sort=value;},querySelector:()=>button};
  const rows=[10,2,-3].map(value=>({cells:[{textContent:String(value)}]}));
  const body={rows,append(...ordered){this.rows=ordered;}},status={textContent:''};
  const wrapper={querySelector:selector=>selector==='tbody'?body:status,querySelectorAll:()=>[th]};
  button.closest=selector=>selector==='th'?th:wrapper;
  const root={contains:()=>true};bindRichControls(root,{ready:()=>true,draft:()=>assert.fail('sorting must not draft'),toast:()=>{}});
  const event={target:{closest:selector=>selector==='[data-rich-sort]'?button:null}};
  root.onclick(event);
  assert.deepEqual(body.rows.map(row=>row.cells[0].textContent),['-3','2','10']);
  assert.equal(state.sort,'ascending');assert.equal(arrow.textContent,'↑');
  assert.match(status.textContent,/升序/);
  root.onclick(event);
  assert.deepEqual(body.rows.map(row=>row.cells[0].textContent),['10','2','-3']);
  assert.equal(state.sort,'descending');assert.equal(arrow.textContent,'↓');
});

test('drafting gives visible confirmation and cannot execute when the interaction is unavailable',()=>{
  const prompts=[],notices=[],label={textContent:'写入草稿'};
  const button={dataset:{richDraft:'查看窗沿'},querySelector:()=>label,setAttribute(){}};
  const root={contains:()=>true};let ready=true;
  bindRichControls(root,{ready:()=>ready,draft:text=>prompts.push(text),toast:text=>notices.push(text)});
  const event={target:{closest:selector=>selector==='[data-rich-draft]'?button:null}};
  root.onclick(event);
  assert.deepEqual(prompts,['查看窗沿']);assert.equal(label.textContent,'已写入草稿');assert.match(notices[0],/草稿/);
  ready=false;root.onclick(event);assert.equal(prompts.length,1);
});
