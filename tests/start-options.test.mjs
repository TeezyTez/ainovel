import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshStartOptions} from '../src/start-options.js';
function fixture(mode='demo',demo=true){
 const real={disabled:true,textContent:''},select={value:mode,dataset:{},querySelector:s=>s==='[value=real]'?real:s==='[value=demo]'?{}:null},note={},submit={dataset:{defaultLabel:'进入世界'},disabled:false};
 const form={dataset:{demoCompatible:String(demo)},querySelector:s=>s==='select[name=mode]'?select:s==='[data-start-availability]'?note:s==='[data-start-submit]'?submit:null};return {form,real,select,note,submit};
}
test('checking blocks accidental starts, resolved availability enables real mode and updates explanation',()=>{
 const f=fixture();refreshStartOptions(f.form,{available:false,modelChecked:false},args=>JSON.stringify(args));
 assert.equal(f.submit.disabled,true);assert.equal(f.real.disabled,true);assert.match(f.note.innerHTML,/"modelChecked":false/);
 refreshStartOptions(f.form,{available:true,modelChecked:true,provider:'本机模型'},args=>JSON.stringify(args));
 assert.equal(f.select.value,'real');assert.equal(f.submit.disabled,false);assert.match(f.note.innerHTML,/"mode":"real"/);
});
test('a deliberate demo selection survives connection checks; a removed real connection falls back truthfully',()=>{
 const f=fixture();f.select.dataset.touched='true';refreshStartOptions(f.form,{available:true,modelChecked:true},args=>args.mode);assert.equal(f.select.value,'demo');assert.equal(f.note.innerHTML,'demo');
 f.select.value='real';refreshStartOptions(f.form,{available:false,modelChecked:true},args=>args.mode);assert.equal(f.select.value,'demo');assert.equal(f.note.innerHTML,'demo');
 const readOnly=fixture('real',false);refreshStartOptions(readOnly.form,{available:false,modelChecked:true},args=>JSON.stringify(args));assert.equal(readOnly.select.value,'demo');assert.equal(readOnly.submit.disabled,false);assert.match(readOnly.note.innerHTML,/"demo":false/);
});
