import {icon} from './ui-controls.js';
// Keep the actual panel nodes so Back also restores form drafts and listeners.
export function createDialogNavigation(dialog,{escape,returnFallback=()=>null}={}){
  let stack=[],launcher=null,title='',onRestore,modal=true,switching=false;
  function focusHeading(){const heading=dialog.querySelector('h2');heading?.focus({preventScroll:true});}
  function open(nextTitle,content,onSubmit,options={}){
    const wasOpen=dialog.open;
    if(!wasOpen){
      stack=[];
      const active=document.activeElement;
      launcher=active?.closest('[popover]')?document.querySelector('[popovertarget="reader-quick-tools"]'):active;
    }else if(title!==nextTitle&&!options.replace){
      stack.push({nodes:[...dialog.childNodes],className:dialog.className,title,onRestore,modal,scrollTop:dialog.scrollTop,contentScroll:dialog.querySelector('.dialog-content')?.scrollTop||0,focus:document.activeElement});
    }
    title=nextTitle;onRestore=options.onRestore;
    dialog.className='';
    dialog.innerHTML=`<div class="dialog-head">${stack.length?'<button class="icon-button dialog-back" type="button" aria-label="返回上一层" data-action="dialog-back">'+icon('back')+'</button>':''}<h2 id="dialog-title" tabindex="-1">${escape(title)}</h2><button class="icon-button" type="button" aria-label="关闭面板" data-action="close-dialog">${icon('close')}</button></div><div class="dialog-content">${content}</div>`;
    dialog.setAttribute('aria-labelledby','dialog-title');
    if(onSubmit)dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();await onSubmit(new FormData(e.currentTarget));};
    const nextModal=options.modal!==false;
    if(wasOpen&&modal!==nextModal){switching=true;dialog.close();}
    modal=nextModal;
    if(!dialog.open){if(modal)dialog.showModal();else dialog.show();}switching=false;
    dialog.scrollTop=0;
    // Do not summon a mobile keyboard merely by opening an information panel.
    const autofocus=dialog.querySelector('[autofocus]');
    if(autofocus)autofocus.focus({preventScroll:true});else focusHeading();
  }
  function back(){
    const prior=stack.pop();if(!prior)return;
    if(modal!==prior.modal){switching=true;dialog.close();modal=prior.modal;if(modal)dialog.showModal();else dialog.show();switching=false;}
    dialog.replaceChildren(...prior.nodes);dialog.className=prior.className;title=prior.title;onRestore=prior.onRestore;onRestore?.();
    dialog.scrollTop=prior.scrollTop;
    const content=dialog.querySelector('.dialog-content');if(content)content.scrollTop=prior.contentScroll;
    if(prior.focus?.isConnected)prior.focus.focus({preventScroll:true});else focusHeading();
  }
  dialog.addEventListener('close',()=>{
    if(dialog.open||switching)return;
    stack=[];title='';
    // A source jump or draft action may have deliberately focused another control.
    const active=document.activeElement;
    if(active&&active!==document.body&&!dialog.contains(active)&&active!==launcher)return;
    const target=launcher?.isConnected&&launcher.getClientRects().length?launcher:returnFallback();
    target?.focus({preventScroll:true});
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||!dialog.open||modal)return;
    // A modal viewer owns Escape while it covers the nonmodal dossier.
    if(document.querySelector('dialog:modal'))return;
    event.preventDefault();dialog.close();
  });
  return {open,back};
}
