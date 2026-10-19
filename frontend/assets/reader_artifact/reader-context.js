import {interactionView, selectionView} from './interaction-ui.js';
import {queryObjects, selectObjects, resolveSelection} from './interaction-context.js';

export function mountContext(host, data, send, notice) {
  let selection = data.selection, query = data.query || {kind:'overview'};
  let view = query.view || data.presentation?.view || 'auto', sort = data.presentation?.sort || 'name', pinned = data.pinned;
  const {scope, situation} = data;
  const show = () => {
    const result = queryObjects(query, situation, {scope,selection,sort});
    host.innerHTML = selectionView(selection,scope,situation) + interactionView(result,{scope,selection,view,sort,pinned});
  };
  const controller=new AbortController(), options={signal:controller.signal};
  host.addEventListener('change', event => {
    if (!event.isTrusted || !event.target.matches('[data-context-object]')) return;
    try {
      const ids = new Set(selection?.baseVersion===scope.baseVersion ? selection.objectIds : []);
      event.target.checked ? ids.add(event.target.dataset.contextObject) : ids.delete(event.target.dataset.contextObject);
      selection=selectObjects(scope,situation,[...ids]);send('context-selection',selection);notice.textContent='只对下一次输入有效。';show();
    } catch(error) { notice.textContent=error.message;show(); }
  },options);
  host.addEventListener('submit', event => {
    if(event.target.id!=='context-view-form')return;event.preventDefault();
    if(!event.isTrusted)return;
    const fields = new FormData(event.target);view=fields.get('view');sort=fields.get('sort');
    send('context-presentation',{view,sort});show();
  },options);
  host.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    const button=event.target.closest('[data-action]');if(!button)return;
    try {
      switch(button.dataset.action){
        case 'context-clear':selection=null;send('context-selection',null);show();break;
        case 'context-compare':query={kind:'compare'};view='auto';show();break;
        case 'context-pin':pinned=!pinned;send('context-pin',pinned?query:null);show();break;
        case 'context-close':send('context-close',null);break;
        case 'context-source':send('context-source',button.dataset.object);break;
        case 'context-draft':{
          const selected=resolveSelection(selection,scope,situation);
          if(!selected.length)throw Error('先选择已知资料，再围绕它们起草。');
          send('draft','围绕'+selected.map(o=>o.name).join('、')+'，我想：');break;
        }
      }
    }catch(error){notice.textContent=error.message;}
  },options);
  show();return()=>controller.abort();
}
