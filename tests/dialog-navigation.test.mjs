import test from 'node:test';
import assert from 'node:assert/strict';
import {createDialogNavigation} from '../src/dialog-navigation.js';

function fixture(t){
  const previous=globalThis.document,document=new EventTarget(),dialogs=[];
  document.body={};
  const control=()=>({isConnected:true,closest:()=>null,getClientRects:()=>[{}],focus(){document.activeElement=this;}});
  const launcher=control();document.activeElement=launcher;
  document.querySelector=selector=>selector==='dialog:modal'?dialogs.find(dialog=>dialog.open&&dialog.modal)||null:null;
  function makeDialog(){
    const dialog=new EventTarget(),heading=control();
    Object.assign(dialog,{open:false,modal:false,childNodes:[],className:'',scrollTop:0,
      setAttribute(){},querySelector:selector=>selector==='h2'?heading:null,contains:node=>node===heading,
      show(){this.open=true;this.modal=false;},showModal(){this.open=true;this.modal=true;},
      close(){this.open=false;this.dispatchEvent(new Event('close'));}
    });
    dialogs.push(dialog);return dialog;
  }
  globalThis.document=document;t.after(()=>{globalThis.document=previous;});
  const dialog=makeDialog(),navigation=createDialogNavigation(dialog,{escape:value=>value});
  const escape=(claimed=false)=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});if(claimed)event.preventDefault();document.dispatchEvent(event);return event;};
  return {document,dialog,navigation,launcher,makeDialog,escape};
}

test('Escape belongs to a modal viewer above the nonmodal dossier',t=>{
  const f=fixture(t);f.navigation.open('故事资料','',undefined,{modal:false});
  const viewer=f.makeDialog();viewer.showModal();
  const event=f.escape();
  assert.equal(event.defaultPrevented,false,'the viewer must retain native Escape cancellation');
  assert.equal(f.dialog.open,true,'the dossier underneath must remain open');
  viewer.close();
  const next=f.escape();
  assert.equal(next.defaultPrevented,true);
  assert.equal(f.dialog.open,false,'Escape closes the dossier after the viewer has left');
});

test('a control that already handled Escape keeps its nonmodal dossier open',t=>{
  const f=fixture(t);f.navigation.open('故事资料','',undefined,{modal:false});
  f.escape(true);
  assert.equal(f.dialog.open,true);
});

test('Escape closes an unblocked nonmodal dossier and restores its launcher',t=>{
  const f=fixture(t);f.navigation.open('故事资料','',undefined,{modal:false});
  assert.notEqual(f.document.activeElement,f.launcher);
  assert.equal(f.escape().defaultPrevented,true);
  assert.equal(f.dialog.open,false);
  assert.equal(f.document.activeElement,f.launcher);
});

test('modal panels retain their native Escape handling',t=>{
  const f=fixture(t);f.navigation.open('阅读设置','');
  assert.equal(f.escape().defaultPrevented,false);
  assert.equal(f.dialog.open,true,'the custom handler leaves closure to the browser');
});
