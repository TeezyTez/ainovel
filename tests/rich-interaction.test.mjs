import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDefinition} from '../src/dynamic-rules.js';

const ref=(...path)=>({op:'ref',path});
const state={version:0,facts:['公开记录'],inventory:[],location:'柜台',time:'午后',game:{entities:[{id:'money',value:10}],surfaces:[]}};
const definition=view=>({schemaVersion:1,id:'rich',revision:1,title:'当前处境',summary:'依据公开记录整理。',scope:{worldKey:'world@1',sessionId:'session',branchId:'branch',sceneId:'scene',baseVersion:0},fields:[{id:'quantity',label:'数量',type:'number',min:0,max:10}],steps:[],view,actions:[]});
const validate=node=>validateDefinition(definition([node]),state);
const drawing=elements=>({type:'illustration',title:'柜台示意',description:'依据描述绘制的概念示意。',width:600,height:300,elements});

test('rich views compose with existing layouts and preserve public reference expressions without mutation',()=>{
  const d=definition([{type:'group',children:[
    {type:'table',title:'准备比较',columns:['项目','数量'],rows:[['钱',ref('objects','money','value')],['准备量',ref('params','quantity')]],when:true},
    {type:'chart',caption:'数值来自公开记录。',unit:'份',items:[{label:'余量',value:ref('objects','money','value')},{label:'变动',value:-3}]},
    {type:'diagram',layout:'flow',nodes:[{id:'counter',label:'柜台',detail:'眼前的位置',prompt:'仔细观察柜台。'},{id:'door',label:'门'}],edges:[{from:'counter',to:'door',label:'已知通道',dashed:true}]},
    {type:'cards',items:[{title:'先询问',body:'了解尚未确认的条件。',tag:'待确认',prompt:'询问还有哪些条件。'}]},
    {type:'timeline',items:[{title:'约定',body:'对方提议明早见面。',time:'明早',tag:'对方提议'}]},
    drawing([{shape:'rect',x:10,y:20,width:40,height:30,fill:'paper',stroke:'#abc'},{shape:'circle',cx:80,cy:60,r:20,fill:'accent'},{shape:'ellipse',cx:120,cy:60,rx:20,ry:10},{shape:'line',x1:0,y1:0,x2:40,y2:50,stroke:'ink'},{shape:'path',d:'M 10 10 C 20 0, 30 20, 40 10 Z',fill:'none'},{shape:'text',x:20,y:20,text:'入口',fontSize:14,fill:'#12345678'}])
  ]}]);
  const before=JSON.stringify(d);
  assert.equal(validateDefinition(d,state),d);
  assert.equal(JSON.stringify(d),before);
});

test('tables accept rows supplied by an expression but reject invalid literal row shapes and bounds',()=>{
  assert.doesNotThrow(()=>validate({type:'table',columns:['记录'],rows:ref('facts')}));
  assert.doesNotThrow(()=>validate({type:'table',columns:['记录'],rows:[['<script>纯文字</script>'],[null],[true],[0]]}));
  for(const node of [
    {type:'table',columns:[],rows:[]},
    {type:'table',columns:Array(9).fill('列'),rows:[]},
    {type:'table',columns:['列'],rows:Array.from({length:51},()=>['值'])},
    {type:'table',columns:['列'],rows:[['一','二']]},
    {type:'table',columns:['列'],rows:['不是一行']},
    {type:'table',columns:['列'],rows:[[['嵌套数组']]]},
    {type:'table',columns:['列'],rows:[[ref('objects','missing','value')]]},
    {type:'table',columns:['列'],rows:ref('flags','secret')}
  ])assert.throws(()=>validate(node));
});

test('rich expression values retain scope validation and reject known nonnumeric chart data',()=>{
  assert.doesNotThrow(()=>validate({type:'chart',items:[{label:'收益',value:{op:'sub',args:[ref('params','quantity'),2]}}]}));
  for(const node of [
    {type:'chart',items:[{label:'未知输入',value:ref('params','missing')}]},
    {type:'chart',items:[{label:'隐藏数据',value:ref('flags','secret')}]},
    {type:'chart',items:[{label:'无穷',value:Infinity}]},
    {type:'chart',items:[{label:'猜测',value:'约三成'}]},
    {type:'chart',items:[{label:'列表',value:[1,2]}]},
    {type:'cards',when:ref('flags','secret'),items:[]}
  ])assert.throws(()=>validate(node));
});

test('diagrams reject duplicate identifiers, missing endpoints and fabricated executable properties',()=>{
  const base={type:'diagram',nodes:[{id:'a',label:'甲'},{id:'b',label:'乙'}],edges:[{from:'a',to:'b'}]};
  assert.doesNotThrow(()=>validate(base));
  for(const change of [
    {nodes:[{id:'a',label:'甲'},{id:'a',label:'乙'}]},
    {edges:[{from:'a',to:'missing'}]},
    {edges:[{from:'a',to:'b',dashed:'yes'}]},
    {layout:'html'},
    {nodes:[{id:'__proto__',label:'甲'}]},
    {nodes:[{id:'a',label:'甲',onclick:'alert(1)'}]},
    {edges:[{from:'a',to:'b',href:'https://example.com'}]}
  ])assert.throws(()=>validate({...base,...change}));
});

test('rich text, collection and draft limits reject malformed model output',()=>{
  for(const node of [
    {type:'cards',items:Array.from({length:13},()=>({title:'一',body:'正文'}))},
    {type:'timeline',items:[{title:'一',body:'正文',prompt:'a'.repeat(1001)}]},
    {type:'cards',caption:'x'.repeat(2001),items:[]},
    {type:'cards',items:[{title:'一',body:{html:'正文'}}]},
    {type:'timeline',items:[{title:'一',body:'正文',time:123}]},
    {type:'table',columns:['列'],rows:[],html:'<iframe></iframe>'},
    {type:'chart',items:[{label:'一',value:2,url:'https://example.com'}]}
  ])assert.throws(()=>validate(node));
  assert.doesNotThrow(()=>validate({type:'cards',items:[{title:'询问',body:'点击只准备输入。',prompt:'a'.repeat(1000)}]}));
});

test('illustrations reject scriptable SVG, unsafe paths and unbounded geometry',()=>{
  for(const element of [
    {shape:'foreignObject',text:'<script/>'},
    {shape:'image',href:'https://example.com/pixel'},
    {shape:'rect',onload:'alert(1)'},
    {shape:'circle',style:'fill:url(https://example.com)'},
    {shape:'rect',fill:'url(https://example.com)'},
    {shape:'rect',fill:'red'},
    {shape:'rect',stroke:'var(--secret)'},
    {shape:'path',d:'M0 0 <script>'},
    {shape:'path',d:'M0 0'.repeat(501)},
    {shape:'path',d:'M 0 0 L 999999 2'},
    {shape:'text',text:'文字',href:'javascript:alert(1)'},
    {shape:'rect',x:2001},
    {shape:'circle',cx:Infinity},
    {shape:'ellipse',rx:-1},
    {shape:'line',x1:'20'},
    {shape:'rect',d:'M0 0'}
  ])assert.throws(()=>validate(drawing([element])));
  for(const change of [{width:199},{width:1001},{height:119},{height:801},{title:''},{description:''},{elements:Array.from({length:81},()=>({shape:'rect'}))}])assert.throws(()=>validate({...drawing([]),...change}));
});
