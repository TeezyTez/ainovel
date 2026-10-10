import {interactionQuery,selectObjects,resolveSelection,queryObjects} from './interaction-context.js';
import {interactionView,selectionView} from './interaction-ui.js';
import {publicSituation} from './experience-state.js';

export function createInteractionControls(api){
 const locals=new Map();
 function context(){const s=api.session();if(!s)return null;const b=api.branch(s);return {s,b,scope:{worldKey:b.worldKey,branchId:b.id,baseVersion:(b.turns.at(-1)?.state||b.initialState).version},situation:publicSituation(b,api.world(s)),key:s.id+':'+b.id};}
 function local(){const c=context();if(!c)return null;if(!locals.has(c.key))locals.set(c.key,{query:null,selection:null,view:'auto',sort:'name'});return {...c,ui:locals.get(c.key)};}
 function show(query){const c=local();if(!c)return;c.ui.query=query;c.ui.view=query.view||'auto';api.refresh();requestAnimationFrame(()=>document.querySelector('#context-result')?.scrollIntoView({block:'center',behavior:'instant'}));}
 function run(input){const q=interactionQuery(input);if(!q)return false;show(q);return true;}
 function html(){const c=local();if(!c)return {panel:'',selection:''};const pinned=api.settings().pinnedContexts?.[c.key];const data=c.ui.query?queryObjects(c.ui.query,c.situation,{scope:c.scope,selection:c.ui.selection,sort:c.ui.sort}):null;return {panel:data?interactionView(data,{scope:c.scope,selection:c.ui.selection,view:c.ui.view,sort:c.ui.sort,pinned:!!pinned}):pinned?'<div class="context-pinned-launch"><button type="button" class="btn compact" data-action="context-open-pinned">查看固定资料</button><span>按当前分支记录更新 · 不自动生成</span></div>':'',selection:selectionView(c.ui.selection,c.scope,c.situation)};}
 function selection(){const c=local();if(!c?.ui.selection)return undefined;resolveSelection(c.ui.selection,c.scope,c.situation);return structuredClone(c.ui.selection);}
 function clear(expected){const c=local();if(c&&(arguments.length===0||JSON.stringify(c.ui.selection||undefined)===JSON.stringify(expected)))c.ui.selection=null;}
 function hide(){const c=local();if(c)c.ui.query=null;}
 function bind(){const f=document.querySelector('#context-view-form');if(f)f.onsubmit=e=>{e.preventDefault();const c=local(),d=new FormData(f);c.ui.view=String(d.get('view'));c.ui.sort=String(d.get('sort'));api.refresh();};}
 function handle(action,target){
  if(!action.startsWith('context-'))return false;const c=local();if(!c)return true;
  try{
   if(action==='context-density'){const settings=api.settings();settings.interactionDensity=settings.interactionDensity==='reading'?'adaptive':'reading';api.save();api.refresh();}
   if(action==='context-open')show({kind:'overview'});
   if(action==='context-close'){hide();api.refresh();}
   if(action==='context-clear'){clear();api.refresh();}
   if(action==='context-compare')show({kind:'compare'});
   if(action==='context-pin'){const settings=api.settings();settings.pinnedContexts??={};if(settings.pinnedContexts[c.key])delete settings.pinnedContexts[c.key];else settings.pinnedContexts[c.key]=c.ui.query;api.save();api.refresh();}
   if(action==='context-open-pinned')show(api.settings().pinnedContexts[c.key]||{kind:'overview'});
   if(action==='context-source'){const o=c.situation.objects.find(x=>x.id===target.dataset.object);if(o)api.source(c.b.turns.find(t=>t.state.version===o.sourceVersion)?.id||'');}
   if(action==='context-draft'){const objects=resolveSelection(c.ui.selection,c.scope,c.situation);if(!objects.length)throw new Error('先选择要围绕哪条资料表达。');api.draft('围绕'+objects.map(o=>o.name).join('、')+'，我想：');}
  }catch(e){api.toast(e.message);}return true;
 }
 document.addEventListener('change',e=>{const id=e.target.dataset.contextObject;if(!id)return;const c=local();if(!c)return;try{let ids=c.ui.selection?.baseVersion===c.scope.baseVersion?[...c.ui.selection.objectIds]:[];ids=e.target.checked?[...new Set([...ids,id])]:ids.filter(x=>x!==id);c.ui.selection=selectObjects(c.scope,c.situation,ids);api.refresh();document.querySelector('[data-context-object="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});}catch(error){e.target.checked=false;api.toast(error.message);}});
 return {run,show,html,selection,clear,hide,bind,handle};
}
