// Keep the actual panel nodes so Back also restores form drafts and listeners.
export function createDialogNavigation(dialog,{escape,returnFallback=()=>null}={}){
  let stack=[],launcher=null,title='',onRestore;
  function focusHeading(){const heading=dialog.querySelector('h2');heading?.focus({preventScroll:true});}
  function open(nextTitle,content,onSubmit,options={}){
    const wasOpen=dialog.open;
    if(!wasOpen){
      stack=[];
      const active=document.activeElement;
      launcher=active?.closest('[popover]')?document.querySelector('[popovertarget="reader-quick-tools"]'):active;
    }else if(title!==nextTitle&&!options.replace){
      stack.push({nodes:[...dialog.childNodes],className:dialog.className,title,onRestore,scrollTop:dialog.scrollTop,contentScroll:dialog.querySelector('.dialog-content')?.scrollTop||0,focus:document.activeElement});
    }
    title=nextTitle;onRestore=options.onRestore;
    dialog.className='';
    dialog.innerHTML=`<div class="dialog-head">${stack.length?'<button class="icon-button dialog-back" type="button" aria-label="返回上一层" data-action="dialog-back">←</button>':''}<h2 id="dialog-title" tabindex="-1">${escape(title)}</h2><button class="icon-button" type="button" aria-label="关闭面板" data-action="close-dialog">×</button></div><div class="dialog-content">${content}</div>`;
    dialog.setAttribute('aria-labelledby','dialog-title');
    if(onSubmit)dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();await onSubmit(new FormData(e.currentTarget));};
    if(!wasOpen)dialog.showModal();
    dialog.scrollTop=0;
    // Do not summon a mobile keyboard merely by opening an information panel.
    const autofocus=dialog.querySelector('[autofocus]');
    if(autofocus)autofocus.focus({preventScroll:true});else focusHeading();
  }
  function back(){
    const prior=stack.pop();if(!prior)return;
    dialog.replaceChildren(...prior.nodes);dialog.className=prior.className;title=prior.title;onRestore=prior.onRestore;onRestore?.();
    dialog.scrollTop=prior.scrollTop;
    const content=dialog.querySelector('.dialog-content');if(content)content.scrollTop=prior.contentScroll;
    if(prior.focus?.isConnected)prior.focus.focus({preventScroll:true});else focusHeading();
  }
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    stack=[];title='';
    // A source jump or draft action may have deliberately focused another control.
    const active=document.activeElement;
    if(active&&active!==document.body&&!dialog.contains(active)&&active!==launcher)return;
    const target=launcher?.isConnected&&launcher.getClientRects().length?launcher:returnFallback();
    target?.focus({preventScroll:true});
  });
  return {open,back};
}
