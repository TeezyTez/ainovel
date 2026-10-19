// Local semantic queries and expiring object references. No world mutations.
const filters={人物:'person',人物资料:'person',线索:'clue',物品:'item',背包:'item',地点:'location',资源:'resource',约定:'agreement',事件:'event',经历:'event',事实:'fact'};
const clean=s=>String(s??'').trim().replace(/^请/,'').replace(/[。！？!?]$/,'');
export function interactionQuery(input){
 const s=clean(input);
 if(/[\n“”「」『』"，,；;]/.test(s))return null;
 if(filters[s])return {kind:'list',filter:filters[s]};
 if(/^(?:查看|显示|打开|看看)?(?:人物关系|人物关系图|关系图)$/.test(s))return {kind:'relationships',filter:'person'};
 if(/^(?:查看|显示|打开|看看)?(?:时间线|大事记|约定与时间)$/.test(s))return {kind:'timeline'};
 const presentation=s.match(/^(?:用|以)(表格|卡片|关系图|时间线)(?:形式)?(?:显示|展示|列出)?(.+)$/);
 if(presentation){const target=presentation[2].replace(/^我的/,'');if(filters[target])return {kind:presentation[1]==='关系图'?'relationships':presentation[1]==='时间线'?'timeline':'list',filter:filters[target],view:{表格:'table',卡片:'cards',关系图:'auto',时间线:'auto'}[presentation[1]]};}
 const display=/(?:然后|之后|后去|并且|再去)/.test(s)?null:s.match(/^(?:显示|给我看看)(?:我的)?([^。！？!?]{1,60})$/);
 if(display)return filters[display[1]]?{kind:'list',filter:filters[display[1]]}:{kind:'list',query:display[1]};
 if(/^(?:我身上有什么|我带了什么|我的背包里有什么)$/.test(s))return {kind:'list',filter:'item'};
 const owned=s.match(/^(?:我|现在|目前)?(?:有|持有)?(?:哪些|什么)(物品|线索|约定|资源|人物)$/);
 if(owned)return {kind:'list',filter:filters[owned[1]]};
 if(/^(我现在怎么样|我现在的情况|现在什么情况|看看现在的情况|我在哪|我在哪里|当前处境|查看情况|看看情况|查看我的状态)$/.test(s))return {kind:'overview'};
 if(/^(现在几点|现在是什么时候|故事时间|查看时间|查看时间线|查看约定和时间)$/.test(s))return {kind:'timeline'};
 if(/^(比较|对比|对照)(一下)?(这两个|这两项|这两条|选中的资料|已选资料)$/.test(s))return {kind:'compare'};
 const compare=s.match(/^(?:比较|对比|对照)([^，。！？“”「」\n]{1,100})(?:和|与)([^，。！？“”「」\n]{1,100})$/);
 if(compare)return {kind:'compare',names:compare.slice(1)};
 const list=s.match(/^(?:查看|看看|显示|打开)(?:有哪些|已知的|已知)?(.+)$/);
 if(list&&filters[list[1]])return {kind:'list',filter:filters[list[1]]};
 const named=s.match(/^(?:查看|看看)([^，。！？“”「」\n]{1,100})的(?:资料|记录|情况)$/);
 if(named)return {kind:'list',query:named[1]};
 return null;
}
export function selectObjects(scope,situation,objectIds){
 if(!Array.isArray(objectIds)||objectIds.length>4||new Set(objectIds).size!==objectIds.length)throw new Error('最多选择四条不同资料。');
 if(!objectIds.every(id=>situation.objects?.some(o=>o.id===id)))throw new Error('选择包含当前不可知的资料，请重新查看。');
 return {worldKey:scope.worldKey,branchId:scope.branchId,baseVersion:scope.baseVersion,objectIds:[...objectIds]};
}
export function resolveSelection(selection,scope,situation){
 if(!selection)return [];
 if(selection.worldKey!==scope.worldKey||selection.branchId!==scope.branchId)throw new Error('选择来自另一世界或分支，请重新选择。');
 if(selection.baseVersion!==scope.baseVersion)throw new Error('选择已过期，先查看最新资料再选择；草稿仍保留。');
 selectObjects(scope,situation,selection.objectIds);
 return selection.objectIds.map(id=>situation.objects.find(o=>o.id===id));
}
export function queryObjects(query,situation,{scope,selection,sort='name'}={}){
 let objects=[...(situation.objects||[])],message='';
 if(query.kind==='compare'){
  if(query.names){const matches=query.names.map(name=>objects.filter(o=>o.name===name));if(matches.some(m=>m.length!==1)){objects=[];message='名称不唯一或尚未记录，请先选择准确的两项资料。';}else objects=matches.map(m=>m[0]);}
  else{try{objects=resolveSelection(selection,scope,situation);}catch(e){objects=[];message=e.message;}if(objects.length<2){objects=[];message||='先选择至少两项已知资料，再比较这两个。';}}
 }else{
  if(query.kind==='timeline')objects=objects.filter(o=>['event','agreement'].includes(o.kind)||o.fields?.some(f=>['occurredAt','learnedAt','scheduledAt','actualAt','deadline'].includes(f.key)));
  if(query.filter)objects=objects.filter(o=>o.kind===query.filter);
  if(query.query){const value=query.query.toLocaleLowerCase();objects=objects.filter(o=>[o.name,o.summary,...(o.fields||[]).map(f=>f.value)].join(' ').toLocaleLowerCase().includes(value));}
  objects.sort((a,b)=>query.kind==='timeline'?(a.sourceVersion??0)-(b.sourceVersion??0):sort==='updated'?(b.sourceVersion??0)-(a.sourceVersion??0):String(a.name).localeCompare(String(b.name),'zh-CN'));
 }
 return {kind:query.kind,filter:query.filter,view:query.view,summary:situation.summary||'',clock:situation.clock?.label||'故事时间尚未明确',objects,message};
}
