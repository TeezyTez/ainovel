// Import produces an editable local draft, never a published world or a model request.
export function parseWorldImport(content,filename='') {
  if(typeof content!=='string'||content.length>120000)throw new Error('请选择不超过 120 KB 的文字资料。');
  const clean=value=>typeof value==='string'?value.trim():'';
  const check=(value,max,label)=>{if(typeof value==='string'&&value.length>max)throw new Error(label+' 超过 '+max+' 字限制。请拆分资料后再导入，原草稿未改变。');};
  if(!/\.json$/i.test(filename))return {kind:'text',seed:content.slice(0,8000),warnings:content.length>8000?['文字超过 8000 字，已截取前 8000 字。请检查后再生成。']:[]};
  let source;try{source=JSON.parse(content);}catch{throw new Error('JSON 格式无效，原有草稿未改变。');}
  if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('需要角色卡、世界书或本产品世界对象。');
  const d=source.data||source;
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('JSON data必须为对象。');
  for(const [key,max] of Object.entries({title:100,name:100,description:3000,scenario:4000,era:500,identity:500,location:500,goal:1000,opening:12000,first_mes:12000,personality:1000}))check(d[key],max,key);
  if(Array.isArray(d.rules)&&(d.rules.length>40||d.rules.some(x=>typeof x!=='string'||x.length>2000)))throw new Error('规则最多40条，每条2000字；请先拆分资料。');
  if(Array.isArray(d.characters)){if(d.characters.length>30)throw new Error('人物最多30位，请分批整理。');for(const c of d.characters){if(!c||typeof c!=='object')throw new Error('人物资料格式无效。');for(const [key,max]of Object.entries({name:100,role:200,public:3000,goal:500,history:1000,secret:3000}))check(c[key],max,key);}}
  const warnings=['导入仅形成草案。请核对公开介绍和幕后资料，再保存或生成开场。'];
  if(typeof d.title==='string'&&Array.isArray(d.rules)){
    const fields={};for(const k of ['title','description','era','identity','location','goal','opening'])fields[k]=clean(d[k]).slice(0,k==='opening'?12000:4000);
    fields.rules=d.rules.filter(x=>typeof x==='string').slice(0,40).map(x=>x.slice(0,2000));
    fields.characters=Array.isArray(d.characters)?d.characters.slice(0,30).map((c,i)=>({id:'import-person-'+i,name:clean(c.name).slice(0,100),role:clean(c.role).slice(0,200),public:clean(c.public).slice(0,3000),goal:clean(c.goal).slice(0,500),history:clean(c.history).slice(0,1000),secret:clean(c.secret).slice(0,3000)})):[];
    return {kind:'world',fields,warnings};
  }
  const book=d.character_book||d,entries=Array.isArray(book.entries)?book.entries:Object.values(book.entries||{});
  if(entries.some(e=>!e||typeof e!=='object'))throw new Error('世界书条目必须为对象。');
  const enabled=entries.filter(e=>e.enabled!==false&&e.disable!==true);
  if(enabled.length>40||enabled.some(e=>clean(e.content).length>2000))throw new Error('启用的世界书条目最多40条，每条2000字；未采用任何资料。');
  if(entries.length!==enabled.length)warnings.push('已忽略 '+(entries.length-enabled.length)+' 条停用条目。');
  if(enabled.some(e=>!clean(e.content)))warnings.push('已忽略内容为空或非文字的条目。');
  if(clean(d.name)&&(d.description!==undefined||d.first_mes!==undefined)){
    const name=clean(d.name).slice(0,100),opening=clean(d.first_mes).replaceAll('{{char}}',name).replaceAll('{{user}}','你');check(opening,12000,'替换角色名后的开场');return {kind:'character',fields:{title:name+'的世界',description:clean(d.scenario).slice(0,4000),opening,characters:[{id:'import-person-1',name,role:'角色卡人物',public:clean(d.description).slice(0,3000),goal:'',history:clean(d.personality).slice(0,1000),secret:''}],...(entries.length?{rules:entries.filter(e=>e.enabled!==false&&e.disable!==true).map(e=>clean(e.content)).filter(Boolean).slice(0,40).map(v=>v.slice(0,2000))}:{})},warnings:[...warnings,'角色卡中的 system_prompt、越权指令及扩展脚本不会被执行。身份与地点需你补充。']};
  }
  if(entries.length)return {kind:'worldbook',fields:{rules:entries.filter(e=>e&&e.enabled!==false&&e.disable!==true).map(e=>clean(e.content)).filter(Boolean).slice(0,40).map(v=>v.slice(0,2000))},warnings:[...warnings,'世界书条目导入为可编辑规则，不模拟关键词触发器或脚本。']};
  throw new Error('未识别到支持的文字世界、角色卡或世界书。也可将内容粘贴到故事想法中。');
}
