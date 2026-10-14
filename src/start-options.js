// Update the existing form so connection checks never discard a player's name,
// preferences or deliberate mode selection.
export function refreshStartOptions(form,{available=false,modelChecked=false,provider='模型'}={},describe=()=> ''){
  if(!form)return;
  const mode=form.querySelector('select[name=mode]'),real=mode?.querySelector('[value=real]');
  const localOption=mode?.querySelector('[value=demo]');
  const demo=form.dataset?.demoCompatible===undefined?!!localOption:form.dataset.demoCompatible==='true';
  if(real){
    real.disabled=!available||!modelChecked;
    real.textContent=!modelChecked?'自由游玩 · 正在检查连接':available?'自由游玩 · '+(provider||'模型'):'自由游玩 · 需要连接模型';
    if(modelChecked){
      if(available&&!mode.dataset.touched)mode.value='real';
      else if(!available&&mode.value==='real'&&localOption)mode.value='demo';
    }
  }
  const note=form.querySelector('[data-start-availability]');
  if(note)note.innerHTML=describe({available,modelChecked,demo,mode:mode?.value});
  const submit=form.querySelector('[data-start-submit]');
  if(submit){
    submit.disabled=!modelChecked;
    const label=submit.querySelector?.('[data-start-label]')||submit;
    label.textContent=modelChecked?(submit.dataset.defaultLabel||'进入世界'):'正在检查连接…';
  }
}
