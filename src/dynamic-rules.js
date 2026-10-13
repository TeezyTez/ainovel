// A deliberately finite, data-only language shared by preview and authoritative replay.
// It has no script evaluator, dynamic property lookup, network or storage capability.
import {RICH_VIEW_TYPES,validateRichView} from './rich-interaction.js';
const denied=new Set(['__proto__','prototype','constructor']);
export const check=(ok,message)=>{if(!ok)throw new Error(message);};
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function fraction(value){check(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12,'数值超出范围。');const [mantissa,exponent='0']=String(value).split('e'),scale=(mantissa.split('.')[1]?.length??0)-Number(exponent);check(scale<=12,'仅支持至多12位小数。');return scale<0?[BigInt(mantissa.replace('.',''))*10n**BigInt(-scale),1n]:[BigInt(mantissa.replace('.','')),10n**BigInt(scale)];}
function decimal(n,d){check(d!==0n,'不能除以零。');if(d<0n){n=-n;d=-d;}const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a;};const g=gcd(n<0n?-n:n,d);n/=g;d/=g;let scale=0;while(d!==1n&&scale<12){const g=gcd(d,10n);check(g>1n,'结果不是有限小数，无法精确结算。');n*=10n/g;d/=g;scale++;}check(d===1n,'小数精度超出限制。');const result=Number(`${n}e-${scale}`);check(Number.isFinite(result)&&Math.abs(result)<=1e12,'计算结果超出范围。');const [roundtripN,roundtripD]=fraction(result);check(roundtripN*10n**BigInt(scale)===n*roundtripD,'数值无法在当前存档格式中精确表示。');return result;}
function numeric(op,values){let [n,d]=fraction(values[0]);for(const v of values.slice(1)){const [a,b]=fraction(v);if(op==='mul'){n*=a;d*=b;}else if(op==='div'){n*=b;d*=a;}else{n=n*b+(op==='sub'?-a:a)*d;d*=b;}const intermediate=decimal(n,d);[n,d]=fraction(intermediate);}return decimal(n,d);}
export function inspect(value){
  check(JSON.stringify(value).length<=131072,'交互定义超过大小限制。');
  let count=0;
  function visit(v,d){check(d<=24&&++count<=6000,'交互定义过于复杂。');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){check(!denied.has(k),'交互含不安全属性。');visit(x,d+1);}}
  visit(value,0);return value;
}
export function expression(expr,context,budget={left:2000},depth=0){
  check(--budget.left>=0&&depth<=12,'计算超过限制。');
  if(Array.isArray(expr)){check(expr.length<=100,'列表过长。');return expr.map(x=>expression(x,context,budget,depth+1));}
  if(expr===null||['string','boolean','number'].includes(typeof expr)){check(typeof expr!=='number'||Number.isFinite(expr),'数值无效。');return expr;}
  check(expr&&typeof expr==='object'&&!Array.isArray(expr),'表达式无效。');
  if(expr.op==='ref'){
    check(Array.isArray(expr.path)&&expr.path.length>0&&expr.path.length<=8,'引用路径无效。');
    let v=context;for(const k of expr.path){check(typeof k==='string'&&!denied.has(k)&&v!==null&&typeof v==='object'&&Object.hasOwn(v,k),'引用不存在或不允许访问。');v=v[k];}return v;
  }
  if(expr.op==='list'){check(Array.isArray(expr.args)&&expr.args.length<=100,'列表过长。');return expr.args.map(x=>expression(x,context,budget,depth+1));}
  check(Array.isArray(expr.args)&&expr.args.length<=16,'表达式参数无效。');
  const run=x=>expression(x,context,budget,depth+1);
  if(expr.op==='if'){check(expr.args.length===3,'条件表达式需要三个参数。');return run(expr.args[0])?run(expr.args[1]):run(expr.args[2]);}
  if(expr.op==='and')return expr.args.every(x=>!!run(x));
  if(expr.op==='or')return expr.args.some(x=>!!run(x));
  const a=expr.args.map(run);let result;
  switch(expr.op){
    case 'not':check(a.length===1,'取反参数无效。');return !a[0];
    case 'eq':case 'ne':check(a.length===2,'比较参数无效。');return (canonical(a[0])===canonical(a[1]))===(expr.op==='eq');
    case 'includes':check(a.length===2&&Array.isArray(a[0]),'选择集合无效。');return a[0].some(x=>canonical(x)===canonical(a[1]));
    case 'length':check(a.length===1&&(typeof a[0]==='string'||Array.isArray(a[0])),'长度参数无效。');return a[0].length;
    case 'concat':result=a.map(x=>{check(x===null||['string','number','boolean'].includes(typeof x),'文本参数无效。');return x??'';}).join('');check(result.length<=2000,'结果文字过长。');return result;
    case 'sum':if(a.length===1&&Array.isArray(a[0])){check(a[0].length<=100,'求和参数过多。');a.splice(0,1,...a[0]);}if(a.length===0)return 0;break;
    case 'add':case 'sub':case 'mul':case 'div':case 'min':case 'max':case 'lt':case 'lte':case 'gt':case 'gte':break;
    default:throw new Error('不支持的计算指令。');
  }
  check(a.length>0&&a.every(x=>typeof x==='number'&&Number.isFinite(x)),'计算需要有限数值。');
  if(['sub','div','lt','lte','gt','gte'].includes(expr.op))check(a.length===2,'计算参数数量无效。');
  switch(expr.op){case 'add':case 'sum':result=numeric('add',a);break;case 'sub':case 'mul':case 'div':result=numeric(expr.op,a);break;case 'min':result=Math.min(...a);break;case 'max':result=Math.max(...a);break;case 'lt':return a[0]<a[1];case 'lte':return a[0]<=a[1];case 'gt':return a[0]>a[1];case 'gte':return a[0]>=a[1];}
  check(Number.isFinite(result)&&Math.abs(result)<=1e12,'计算结果超出范围。');return result;
}
export function publicContext(state){return {objects:Object.fromEntries((state.game?.entities??[]).map(e=>[e.id,structuredClone(e)])),facts:structuredClone(state.facts),inventory:structuredClone(state.inventory),location:state.location,time:state.time};}
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v)&&!denied.has(v);
const text=v=>typeof v==='string'&&v.length<=2000;
const unique=items=>new Set(items.map(x=>x.id)).size===items.length&&items.every(x=>id(x.id));
function validateExpression(e,d,state,depth=0){
  check(depth<=12,'表达式嵌套过深。');if(Array.isArray(e)){check(e.length<=100,'列表过长。');e.forEach(x=>validateExpression(x,d,state,depth+1));return;}if(e===null||['string','boolean','number'].includes(typeof e)){check(typeof e!=='number'||Number.isFinite(e),'数值无效。');return;}
  check(e&&typeof e==='object'&&!Array.isArray(e),'表达式格式无效。');
  if(e.op==='ref'){check(Array.isArray(e.path)&&e.path.length>0&&e.path.length<=8&&e.path.every(k=>typeof k==='string'&&!denied.has(k)),'引用路径无效。');const [root,key]=e.path;check(['objects','facts','inventory','location','time','params','item'].includes(root),'引用超出公开上下文。');if(root==='objects'&&key!==undefined)check(state.game?.entities.some(x=>x.id===key),'引用了未知对象。');if(root==='params')check(d.fields.some(f=>f.id===key)&&e.path.length===2,'引用了未知输入。');return;}
  check(['list','if','and','or','not','eq','ne','includes','length','concat','sum','add','sub','mul','div','min','max','lt','lte','gt','gte'].includes(e.op)&&Array.isArray(e.args)&&e.args.length<=(e.op==='list'?100:16),'不支持的计算指令。');e.args.forEach(x=>validateExpression(x,d,state,depth+1));
}
export function validateDefinition(d,state){
  inspect(d);check(d?.schemaVersion===1&&id(d.id)&&Number.isInteger(d.revision)&&d.revision>0&&text(d.title)&&text(d.summary),'交互身份或说明无效。');
  check(d.scope&&typeof d.scope==='object'&&['worldKey','sessionId','branchId','sceneId'].every(k=>text(d.scope[k]))&&Number.isInteger(d.scope.baseVersion),'交互归属无效。');
  check(Array.isArray(d.fields)&&d.fields.length<=24&&unique(d.fields)&&Array.isArray(d.steps)&&d.steps.length<=8&&unique(d.steps)&&Array.isArray(d.actions)&&d.actions.length<=12&&unique(d.actions),'输入或动作数量、标识无效。');
  for(const f of d.fields){check(['number','text','choice','multiple','boolean'].includes(f.type)&&text(f.label),'输入类型无效。');if(f.type==='number')check(Number.isFinite(f.min)&&Number.isFinite(f.max)&&f.min<=f.max&&Math.abs(f.min)<=1e12&&Math.abs(f.max)<=1e12,'数量范围无效。');if(['choice','multiple'].includes(f.type))check(Array.isArray(f.options)&&f.options.length>0&&f.options.length<=100&&new Set(f.options.map(o=>o.id)).size===f.options.length&&f.options.every(o=>typeof o.id==='string'&&o.id.length>0&&o.id.length<=100&&!denied.has(o.id)&&text(o.label)),'选项无效。');}
  for(const step of d.steps)check(text(step.title)&&Array.isArray(step.fields)&&step.fields.every(k=>d.fields.some(f=>f.id===k)),'步骤引用无效。');
  let nodes=0;function node(n,depth=0){check(n&&++nodes<=200&&depth<=8&&['group','row','text','value','repeat','meter',...RICH_VIEW_TYPES].includes(n.type),'不支持的显示组件或布局过深。');if(n.children){check(Array.isArray(n.children),'布局子项无效。');n.children.forEach(x=>node(x,depth+1));}if(n.type==='text')check(text(n.text),'显示文字无效。');}
  check(Array.isArray(d.view),'缺少显示布局。');d.view.forEach(n=>node(n));
  for(const a of d.actions){check(text(a.label)&&['rule','attempt'].includes(a.mode)&&Array.isArray(a.targets)&&a.targets.length<=32&&a.targets.every(k=>state.game?.entities.some(e=>e.id===k)),'动作对象不存在。');check(Array.isArray(a.effects)&&a.effects.length<=32&&Array.isArray(a.checks)&&a.checks.length<=24,'规则数量无效。');check(a.mode==='rule'||!a.effects.length,'尝试不能保证结果。');for(const effect of a.effects)check(a.targets.includes(effect.entityId)&&['delta','status'].includes(effect.kind),'规则越过了声明的对象。');check(Array.isArray(a.evidence)&&a.evidence.length>0&&a.evidence.every(q=>text(q)&&q.trim()),'行动规则缺少已知依据。');}
  const verify=e=>validateExpression(e,d,state);
  function expressions(n){if(validateRichView(n,{check,verify}))return;if(n.when!==undefined)verify(n.when);if(n.value!==undefined)verify(n.value);if(n.max!==undefined)verify(n.max);if(n.items!==undefined)verify(n.items);n.children?.forEach(expressions);}d.view.forEach(expressions);
  for(const f of d.fields){if(f.when!==undefined)verify(f.when);if(f.validate!==undefined)verify(f.validate);if(f.default!==undefined)validateParams({...d,fields:[{...f,required:false,validate:undefined}]},{[f.id]:f.default});}
  for(const s of d.steps){if(s.when!==undefined)verify(s.when);if(s.validate!==undefined)verify(s.validate);}
  for(const a of d.actions){a.checks.forEach(c=>{check(text(c.message),'条件说明无效。');verify(c.when);});a.effects.forEach(e=>verify(e.value));verify(a.result);}
  return d;
}
export function conditionVisible(when,context){if(when===undefined)return true;try{return expression(when,context)===true;}catch{return false;}}
export function fieldVisible(d,f,context){const containing=d.steps.filter(s=>s.fields.includes(f.id));return conditionVisible(f.when,context)&&(!containing.length||containing.some(s=>conditionVisible(s.when,context)));}
export function validateParams(d,params,publicState={}){
  inspect(params);check(params&&typeof params==='object'&&!Array.isArray(params)&&Object.keys(params).every(k=>d.fields.some(f=>f.id===k)),'含未知输入。');
  const context={...publicState,params:{...(publicState.params??{}),...params}};
  for(const f of d.fields){const v=params[f.id],active=fieldVisible(d,f,context);if(v===undefined){check(!f.required||!active,'请填写：'+f.label);continue;}if(f.type==='number')check(typeof v==='number'&&Number.isFinite(v)&&(!f.integer||Number.isSafeInteger(v))&&v>=f.min&&v<=f.max,'数量超出范围：'+f.label);if(f.type==='text')check(typeof v==='string'&&v.length<=1000&&(!f.required||!active||v.trim()),'文字输入无效：'+f.label);if(f.type==='boolean')check(typeof v==='boolean','请选择：'+f.label);if(f.type==='choice')check(f.options.some(o=>o.id===v),'选项无效：'+f.label);if(f.type==='multiple')check(Array.isArray(v)&&v.length<=f.options.length&&new Set(v).size===v.length&&v.every(k=>f.options.some(o=>o.id===k)),'多选输入无效：'+f.label);}
  for(const f of d.fields)if(f.validate!==undefined&&fieldVisible(d,f,context))check(expression(f.validate,context)===true,'输入不符合要求：'+f.label);return params;
}
export function resolveDynamic(state,d,request){
  validateDefinition(d,state);check(canonical(d.scope)===canonical(request.scope)&&d.scope.baseVersion===state.version&&d.id===request.interactionId&&d.revision===request.revision,'交互已过期或不属于当前场景。');
  const a=d.actions.find(a=>a.id===request.actionId);check(a,'动作不存在。');check(canonical(a.targets)===canonical(request.targets),'动作对象不一致。');validateParams(d,request.params,publicContext(state));
  const context={...publicContext(state),params:request.params},budget={left:2000};
  for(const step of d.steps)if((step.when===undefined||expression(step.when,context,budget))&&step.validate!==undefined)check(expression(step.validate,context,budget)===true,'准备步骤条件未满足。');
  for(const c of a.checks)check(expression(c.when,context,budget)===true,c.message||'当前条件不满足。');
  check(a.mode==='rule','此行动需要人物或叙事判断，不能直接宣布成功。');
  const changes=[],seen=new Set();for(const effect of a.effects){const key=effect.entityId+':'+effect.kind;check(!seen.has(key),'一个对象属性不能重复写入。');seen.add(key);const e=state.game.entities.find(e=>e.id===effect.entityId),value=expression(effect.value,context,budget);if(effect.kind==='delta'){check(typeof e.value==='number'&&typeof value==='number','结算数量必须是数值。');const after=numeric('add',[e.value,value]);check(Number.isFinite(after)&&after>=0&&after<=(e.max??1e12),'资源不足或超过容量。');changes.push({entityId:e.id,kind:'delta',before:e.value,after});}else{check(text(value)&&value.length<=120,'对象状态无效。');changes.push({entityId:e.id,kind:'status',before:e.status,after:value});}}
  const result=expression(a.result,context,budget);check(text(result)&&result.trim(),'结果说明无效。');
  return {schemaVersion:1,requestId:request.requestId,actionId:a.id,params:structuredClone(request.params),beforeVersion:state.version,afterVersion:state.version+1,changes,result};
}
export function applyDynamic(state,before,operation){
  const receipt=resolveDynamic(before,operation.definition,operation.request);check(canonical(receipt)===canonical(operation.receipt),'行动回执与规则重放不一致。');
  for(const change of receipt.changes){const e=state.game.entities.find(e=>e.id===change.entityId);e[change.kind==='delta'?'value':'status']=change.after;e.sourceVersion=state.version;}
  return state;
}
export const DYNAMIC_PROMPT_VERSION='elselife-dynamic-6';
