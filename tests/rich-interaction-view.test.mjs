import test from 'node:test';
import assert from 'node:assert/strict';
import {expression} from '../src/dynamic-rules.js';

import {renderRichView} from '../src/rich-interaction-view.js';
const value=x=>expression(x,{params:{amount:3}});
const render=(node,options={})=>renderRichView(node,{value,index:7,...options});
const ref={op:'ref',path:['params','amount']};

test('table resolves cell expressions without mutating data and exposes accessible browsing controls',()=>{
  const table={type:'table',title:'配方比较',columns:['配方','用量'],rows:[['药水',ref],['茶',0]]};
  const before=JSON.stringify(table),html=render(table);
  assert.match(html||'',/<table[\s>]/);
  assert.match(html,/<caption[^>]*>配方比较<\/caption>/);
  assert.match(html,/<td[^>]*>3<\/td>/);
  assert.doesNotMatch(html,/data-rich-filter/);
  assert.match(html,/data-rich-sort="1"/);
  assert.match(html,/scope="col"/);
  assert.match(html,/data-rich-table-status[^>]*role="status"/);
  assert.equal(JSON.stringify(table),before);
});

test('larger tables offer a collapsed search control while short comparisons remain immediately readable',()=>{
  const html=render({type:'table',columns:['名称','数量'],rows:Array.from({length:8},(_,i)=>['记录 '+i,i])});
  assert.match(html,/<details class="rich-table-search"[^>]*><summary[^>]*>[^]*?筛选/);
  assert.match(html,/data-rich-filter/);
  assert.doesNotMatch(html,/<details class="rich-table-search" open/);
  assert.match(html,/8 条记录/);
});

test('visuals expose an inspection action without choosing a different presentation or submitting a turn',()=>{
  for(const node of [
    {type:'chart',items:[{label:'数量',value:4}]},
    {type:'diagram',nodes:[{id:'a',label:'车站'}],edges:[]},
    {type:'illustration',description:'一盏灯',elements:[]}
  ]){
    const html=render(node);
    assert.match(html,/data-rich-visual/);
    assert.match(html,/<button type="button"[^>]*data-rich-expand/);
    assert.doesNotMatch(html,/data-rich-format|type="submit"/);
  }
});

test('mobile chart alternative keeps full labels and signed bars without forced horizontal reading',()=>{
  const html=render({type:'chart',unit:'枚',items:[{label:'需要完整保留的很长物资标签',value:-5},{label:'收入',value:10}]});
  assert.match(html,/class="rich-chart-mobile"/);
  assert.match(html,/需要完整保留的很长物资标签/);
  assert.match(html,/data-rich-mobile-bar="-5"[^>]*left:0%;width:33\.3333%/);
  assert.match(html,/data-rich-mobile-bar="10"[^>]*left:33\.3333%;width:66\.6667%/);
});

test('diagram supporting records stay behind one disclosure instead of duplicating the whole diagram at rest',()=>{
  const html=render({type:'diagram',nodes:[{id:'a',label:'车站',detail:'昨夜有灯'},{id:'b',label:'钟楼'}],edges:[{from:'a',to:'b',label:'看得见'}]});
  assert.match(html,/<details class="rich-details rich-diagram-details"[^>]*><summary>[^]*?节点与关系/);
  assert.doesNotMatch(html,/<details class="rich-details rich-diagram-details" open/);
  assert.match(html,/昨夜有灯/);
  assert.match(html,/车站 → 钟楼：看得见/);
});

test('a contextual artifact can omit repeated parent copy without hiding its unique caption',()=>{
  const node={type:'table',title:'当前处境',caption:'只比较已有记录',columns:['名称'],rows:[['车站']]};
  const captionOnly=render(node,{omitTitle:true});
  assert.doesNotMatch(captionOnly,/<h4>|rich-view-kind/);
  assert.match(captionOnly,/<header class="rich-view-heading">[^]*?只比较已有记录/);
  const noHeader=render(node,{omitTitle:true,omitCaption:true});
  assert.doesNotMatch(noHeader,/<header|<h4>|rich-view-kind/);
  assert.match(noHeader,/aria-label="当前处境"/);
  const titleOnly=render(node,{omitCaption:true});
  assert.match(titleOnly,/<h4>当前处境<\/h4>/);
  assert.doesNotMatch(titleOnly,/只比较已有记录/);
});

test('small flow diagrams provide a vertical mobile SVG with distinct marker IDs',()=>{
  const node={type:'diagram',nodes:[{id:'a',label:'车站'},{id:'b',label:'钟楼'},{id:'c',label:'集市'}],edges:[{from:'a',to:'b',label:'步行'},{from:'a',to:'c',label:'有岔路',dashed:true}]};
  const html=render(node);
  assert.match(html,/class="rich-diagram-mobile-flow" viewBox="0 0 320 /);
  const ids=[...html.matchAll(/<marker id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
  assert.match(html,/车站 → 集市：有岔路/);
});

test('complex mobile diagrams show complete connected names instead of unreadably shrinking the SVG',()=>{
  const nodes=Array.from({length:6},(_,i)=>({id:String(i),label:'完整的记录名称 '+i}));
  const html=render({type:'diagram',layout:'radial',nodes,edges:[{from:'0',to:'1',label:'据说有关联',dashed:true}]});
  assert.match(html,/class="rich-diagram-mobile-list"/);
  assert.match(html,/完整的记录名称 0[^]*?完整的记录名称 1[^]*?据说有关联/);
  assert.match(html,/class="rich-mobile-link is-dashed"/);
  assert.match(html,/完整的记录名称 5/);
  assert.doesNotMatch(html,/rich-diagram-mobile-flow/);
});

test('table refuses a referenced object or oversized result instead of pretending it is a scalar cell',()=>{
  const table={type:'table',columns:['记录'],rows:ref};
  assert.throws(()=>render(table,{value:()=>[[{secret:'object'}]]}),/表格/);
  assert.throws(()=>render(table,{value:()=>Array.from({length:51},()=>['x'])}),/表格/);
  assert.throws(()=>render(table,{value:()=>[['x','overflow']]}),/表格/);
});

test('bar chart shows positive and negative quantities on the correct sides of one zero baseline',()=>{
  const html=render({type:'chart',title:'收支',unit:'枚',items:[{label:'支出',value:-5},{label:'收入',value:10},{label:'零',value:0}]});
  assert.match(html||'',/<svg[\s>]/);
  const zero=Number(html.match(/data-rich-zero="([\d.]+)"/)?.[1]);
  const bars=[...html.matchAll(/<rect\b[^>]*data-rich-bar="(-?\d+)"[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map(m=>({value:Number(m[1]),x:Number(m[2]),width:Number(m[3])}));
  assert.equal(bars.length,3);
  assert.ok(Number.isFinite(zero));
  assert.equal(bars[0].x+bars[0].width,zero);
  assert.equal(bars[1].x,zero);
  assert.equal(bars[1].width,2*bars[0].width);
  assert.equal(bars[2].width,0);
  assert.match(html,/<dt>支出<\/dt><dd>-5 枚<\/dd>/);
  assert.match(html,/<dt>收入<\/dt><dd>10 枚<\/dd>/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('chart rejects nonnumeric data and can display a set of zeros without invented magnitude',()=>{
  assert.throws(()=>render({type:'chart',items:[{label:'未知',value:'?' }]}),/图表/);
  const html=render({type:'chart',items:[{label:'空',value:0}]});
  assert.match(html||'',/data-rich-bar="0"[^>]*width="0"/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('diagram preserves full labels and edge relationships in HTML and draft prompts never execute',()=>{
  const html=render({type:'diagram',layout:'radial',title:'线索关系',nodes:[{id:'a',label:'车站',detail:'昨夜有灯',prompt:'询问车站值班人'},{id:'b',label:'钟楼'}],edges:[{from:'a',to:'b',label:'看得见',dashed:true}]});
  assert.match(html||'',/<svg[\s>]/);
  assert.match(html,/车站 → 钟楼：看得见/);
  assert.match(html,/昨夜有灯/);
  assert.match(html,/stroke-dasharray="6 5"/);
  assert.match(html,/data-rich-draft="询问车站值班人"/);
  assert.doesNotMatch(html,/data-dynamic-action|type="submit"/);
});

test('cards and timeline retain their content, sequence and nonexecuting draft affordances while busy',()=>{
  for(const type of ['cards','timeline']){
    const node={type,items:[{title:'观察',body:'看看窗沿',time:'午后',tag:'线索',prompt:'仔细检查窗沿'},{title:'询问',body:'问问邻居'}]};
    const html=render(node,{busy:true});
    assert.match(html||'',/看看窗沿/);
    assert.match(html,/线索/);
    assert.ok(html.indexOf('观察')<html.indexOf('询问'));
    assert.match(html,/<button[^>]*data-rich-draft="仔细检查窗沿"[^>]*disabled/);
    assert.doesNotMatch(html,/<form|type="submit"|data-dynamic-action/);
    if(type==='timeline')assert.match(html,/<ol[^>]*>[\s\S]*午后/);
  }
});

test('rich content escapes text and attributes instead of admitting model-authored HTML or SVG code',()=>{
  const attack='\"><img src=x onerror=alert(1)>',nodes=[
    {type:'table',title:attack,columns:[attack],rows:[[attack]]},
    {type:'chart',title:attack,items:[{label:attack,value:1}]},
    {type:'diagram',nodes:[{id:'safe',label:attack,detail:attack,prompt:attack}],edges:[]},
    {type:'cards',items:[{title:attack,body:attack,prompt:attack}]},
    {type:'timeline',items:[{title:attack,body:attack,time:attack,prompt:attack}]},
    {type:'illustration',title:attack,description:attack,width:400,height:240,elements:[{shape:'text',text:attack,x:20,y:40,fill:'url(javascript:alert(1))',onclick:'alert(1)'},{shape:'image',href:'https://example.com/track'},{shape:'path',d:'M0 0" onload="alert(1)',stroke:'url(https://example.com/track)'}]}
  ];
  for(const node of nodes){
    const html=render(node);
    assert.ok(typeof html==='string'&&html.includes('&lt;img'));
    assert.doesNotMatch(html,/<img|<script|<image|<foreignObject|\sonclick="|\sonload="|javascript:|https:\/\//);
  }
});

test('illustration renders only finite geometry with a visible conceptual label and complete description',()=>{
  const html=render({type:'illustration',title:'月下营地',description:'小小的帐篷，旁边有一盏灯。',width:400,height:240,elements:[{shape:'rect',x:20,y:30,width:100,height:60,fill:'soft',stroke:'accent'},{shape:'circle',cx:160,cy:70,r:15,fill:'#fe0'},{shape:'path',d:'M20 100 L70 40 L120 100 Z',fill:'paper',stroke:'ink'},{shape:'text',x:25,y:150,text:'营地',fontSize:18},{shape:'line',x1:0,y1:Infinity,x2:100,y2:100}]});
  assert.match(html||'',/概念示意/);
  assert.match(html,/viewBox="0 0 400 240"/);
  assert.match(html,/<desc[^>]*>小小的帐篷，旁边有一盏灯。<\/desc>/);
  assert.match(html,/fill="var\(--soft\)"/);
  assert.match(html,/fill="#fe0"/);
  assert.doesNotMatch(html,/Infinity|NaN/);
});

test('diagram SVG marker identities preserve distinct scopes containing punctuation',()=>{
  const node={type:'diagram',nodes:[{id:'a',label:'甲'},{id:'b',label:'乙'}],edges:[{from:'a',to:'b'}]};
  const scoped=render(node,{index:'view:a.b:2'}),similar=render(node,{index:'viewab2'});
  const id=scoped.match(/<marker id="([^"]+)"/)[1];
  assert.notEqual(id,similar.match(/<marker id="([^"]+)"/)[1]);
  assert.match(id,/^[a-zA-Z0-9_-]+$/);
  assert.ok(scoped.includes(`marker-end="url(#${id})"`));
});

test('a twelve-node radial diagram keeps every label box separate',()=>{
  const html=render({type:'diagram',layout:'radial',nodes:Array.from({length:12},(_,i)=>({id:String(i),label:'记录 '+i})),edges:[]});
  const boxes=[...html.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\)"><rect width="([\d.]+)" height="([\d.]+)"/g)].map(m=>({x:Number(m[1]),y:Number(m[2]),w:Number(m[3]),h:Number(m[4])}));
  assert.equal(boxes.length,12);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`label boxes ${i} and ${j} overlap`);
  }
});

test('a flow edge skipping a node travels around that node rather than through its label',()=>{
  const html=render({type:'diagram',nodes:[{id:'a',label:'甲'},{id:'b',label:'乙'},{id:'c',label:'丙'}],edges:[{from:'a',to:'c'}]});
  const path=html.match(/<path d="([^"]+)" class="rich-diagram-edge"/)[1];
  const points=[...path.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  const middle=[...html.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\)"><rect width="([\d.]+)" height="([\d.]+)"/g)][1];
  const left=Number(middle[1]),top=Number(middle[2]),right=left+Number(middle[3]),bottom=top+Number(middle[4]);
  for(let i=1;i<points.length;i++){
    const [x1,y1]=points[i-1],[x2,y2]=points[i];
    if(y1===y2)assert.ok(y1<=top||y1>=bottom||Math.max(x1,x2)<=left||Math.min(x1,x2)>=right,'edge crosses the skipped label');
    if(x1===x2)assert.ok(x1<=left||x1>=right||Math.max(y1,y2)<=top||Math.min(y1,y2)>=bottom,'edge crosses the skipped label');
  }
});

test('illustrations preserve independently requested horizontal and vertical corner radii',()=>{
  const html=render({type:'illustration',title:'道具',description:'扁圆边缘',width:400,height:240,elements:[{shape:'rect',x:20,y:30,width:100,height:60,rx:18,ry:4}]});
  assert.match(html,/<rect[^>]*rx="18"[^>]*ry="4"/);
});

test('horizontal diagram labels stay above their line in either direction',()=>{
  for(const [from,to] of [['a','b'],['b','a']]){
    const html=render({type:'diagram',nodes:[{id:'a',label:'甲'},{id:'b',label:'乙'}],edges:[{from,to,label:'有关联',dashed:true}]});
    const line=html.match(/<path d="M [-\d.]+ ([-\d.]+) L [-\d.]+ ([-\d.]+)" class="rich-diagram-edge"/);
    const label=html.match(/<text x="[-\d.]+" y="([-\d.]+)"[^>]*class="rich-diagram-edge-label"/);
    assert.ok(line&&label);
    assert.equal(line[1],line[2]);
    assert.ok(Number(label[1])<=Number(line[1])-14,'label must leave the horizontal connector visible');
  }
});
