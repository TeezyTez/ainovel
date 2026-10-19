import {validateInteractiveView} from './interactive-artifact.js';
import {validateReactArtifact} from './react-artifact.js';
export const RICH_VIEW_TYPES=Object.freeze(['table','chart','diagram','cards','timeline','illustration','interactive','react']);
const common=['type','title','caption','when'];
const properties={
  table:['columns','rows'],chart:['items','unit'],diagram:['nodes','edges','layout'],
  cards:['items'],timeline:['items'],illustration:['description','width','height','elements']
};
const geometry={
  rect:['x','y','width','height','rx','ry'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],
  line:['x1','y1','x2','y2'],path:['d'],text:['x','y','text','fontSize']
};
const paint=['fill','stroke','strokeWidth'];
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const color=value=>typeof value==='string'&&(/^(ink|muted|accent|soft|paper|none)$/.test(value)||/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value));

export function validateRichView(node,{check,verify}){
  if(!RICH_VIEW_TYPES.includes(node?.type))return false;
  if(node.type==='react'){validateReactArtifact(node);if(node.when!==undefined)verify(node.when);if(node.caption!==undefined)check(typeof node.caption==='string'&&node.caption.length<=2000,'React交互图注记无效。');return true;}
  if(node.type==='interactive'){validateInteractiveView(node);if(node.when!==undefined)verify(node.when);if(node.caption!==undefined)check(typeof node.caption==='string'&&node.caption.length<=2000,'交互图注记无效。');return true;}
  const record=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'丰富视图含不支持的属性。');
  const text=(value,required=false,max=2000)=>check(typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0),'丰富视图文字无效或过长。');
  const optionalText=(value,key,max=2000)=>{if(value[key]!==undefined)text(value[key],false,max);};
  const list=(value,max)=>check(Array.isArray(value)&&value.length<=max,'丰富视图项目数量无效。');
  const draft=value=>optionalText(value,'prompt',1000);
  const scalar=value=>value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number';
  record(node,[...common,...properties[node.type]]);
  optionalText(node,'title');optionalText(node,'caption');
  if(node.when!==undefined)verify(node.when);
  if(node.type==='table'){
    list(node.columns,8);check(node.columns.length>0,'表格至少需要一列。');node.columns.forEach(value=>text(value,true));
    verify(node.rows);
    if(Array.isArray(node.rows)){
      list(node.rows,50);
      for(const row of node.rows){
        if(!Array.isArray(row)){check(row&&typeof row==='object'&&typeof row.op==='string','表格行必须是列表。');continue;}
        check(row.length<=node.columns.length,'表格单元格多于列。');
        for(const cell of row){check(!Array.isArray(cell)&&(scalar(cell)||(cell&&typeof cell==='object'&&typeof cell.op==='string')),'表格单元格必须是文字或标量。');if(typeof cell==='string')text(cell);}
      }
    }else check(node.rows&&typeof node.rows==='object'&&typeof node.rows.op==='string','表格行必须是列表或表达式。');
  }else if(node.type==='chart'){
    list(node.items,12);optionalText(node,'unit');
    for(const item of node.items){record(item,['label','value']);text(item.label,true);check(typeof item.value==='number'||(item.value&&typeof item.value==='object'&&!Array.isArray(item.value)),'图表数值必须是数值或表达式。');verify(item.value);}
  }else if(node.type==='diagram'){
    check(node.layout===undefined||['flow','radial'].includes(node.layout),'关系图布局无效。');list(node.nodes,12);list(node.edges,24);
    const ids=new Set();
    for(const item of node.nodes){record(item,['id','label','detail','prompt']);check(identifier(item.id)&&!ids.has(item.id),'关系图节点标识无效或重复。');ids.add(item.id);text(item.label,true);optionalText(item,'detail');draft(item);}
    for(const edge of node.edges){record(edge,['from','to','label','dashed']);check(ids.has(edge.from)&&ids.has(edge.to),'关系图连线引用了未知节点。');optionalText(edge,'label');check(edge.dashed===undefined||typeof edge.dashed==='boolean','关系图线型无效。');}
  }else if(node.type==='cards'||node.type==='timeline'){
    list(node.items,12);
    for(const item of node.items){record(item,['title','body','tag','prompt',...(node.type==='timeline'?['time']:[])]);text(item.title,true);text(item.body);optionalText(item,'tag');if(node.type==='timeline')optionalText(item,'time');draft(item);}
  }else{
    text(node.title,true);text(node.description,true);check(Number.isFinite(node.width)&&node.width>=200&&node.width<=1000&&Number.isFinite(node.height)&&node.height>=120&&node.height<=800,'示意图画布尺寸无效。');list(node.elements,80);
    for(const element of node.elements){
      check(element&&Object.hasOwn(geometry,element.shape),'示意图形状不受支持。');record(element,['shape',...geometry[element.shape],...paint]);
      for(const [key,value] of Object.entries(element)){
        if(key==='shape')continue;
        if(key==='fill'||key==='stroke'){check(color(value),'示意图颜色只允许调色板或十六进制值。');continue;}
        if(key==='text'){text(value);continue;}
        if(key==='d'){
          text(value,true);check(/^[Mm][MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]*$/.test(value),'示意图路径含不支持的字符。');
          const numbers=value.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)??[];
          check(numbers.length>0&&numbers.every(number=>Number.isFinite(Number(number))&&Math.abs(Number(number))<=2000),'示意图路径坐标超出范围。');continue;
        }
        check(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=2000,'示意图坐标超出范围。');
        if(['width','height','r','rx','ry','strokeWidth','fontSize'].includes(key))check(value>=0,'示意图尺寸不能为负数。');
      }
      if(element.shape==='path')text(element.d,true);
      if(element.shape==='text')text(element.text);
    }
  }
  return true;
}
