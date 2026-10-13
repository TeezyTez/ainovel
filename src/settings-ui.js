const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action)=>`<button type="button" class="btn compact" data-action="${action}">${label}</button>`;
const options=(values,value)=>values.map(([key,label])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('');
const heading=(title,description)=>`<header class="settings-section-heading"><h2>${title}</h2>${description?`<p>${description}</p>`:''}</header>`;

export function modelStatus(config={}) {
  return `<div class="model-connection-line"><span class="connection-dot${config.available?' is-connected':''}" aria-hidden="true"></span><strong>${config.available?'已连接 · '+esc(config.provider||'模型服务'):'模型未连接'}</strong></div><p class="small muted">${config.available?esc(config.model||'服务端默认模型'):'可以继续阅读已保存的故事，或体验预设演示。'}</p>`;
}

export const settingsSections=['reading-settings','narrative-settings','model-settings','data-settings'];

export function selectSettingsSection(root,id){
  if(!settingsSections.includes(id))return false;
  const panel=root.querySelector('[data-settings-panel][id="'+id+'"]');
  if(!panel)return false;
  for(const section of root.querySelectorAll('[data-settings-panel]'))section.hidden=section!==panel;
  for(const control of root.querySelectorAll('[data-action="settings-jump"]'))control.setAttribute('aria-pressed',String(control.dataset.section===id));
  panel.focus({preventScroll:true});
  return true;
}

export function settingsView({settings:s={},modelConfig={},saveError='',telemetry=[],activeSection='reading-settings'}) {
  if(!settingsSections.includes(activeSection))activeSection='reading-settings';
  return `<main class="page settings-page" id="main"><header class="page-heading"><div><h1>设置</h1></div><span class="settings-autosave" data-save>修改自动保存</span></header>${saveError?`<div class="notice error" role="alert"><p>${esc(saveError)}</p>${button('重试保存','retry-save')}</div>`:''}
    <div class="settings-layout"><nav class="settings-sidebar" aria-label="设置分类">${[['reading-settings','阅读外观','Aa'],['narrative-settings','新故事偏好','✦'],['model-settings','生成服务','◌'],['data-settings','数据与备份','▤']].map(([id,label,mark])=>`<button type="button" data-action="settings-jump" data-section="${id}" aria-controls="${id}" aria-pressed="${activeSection===id}"><span aria-hidden="true">${mark}</span>${label}</button>`).join('')}</nav><div>
    <section class="settings-block" id="reading-settings" data-settings-panel tabindex="-1" aria-label="阅读外观"${activeSection==='reading-settings'?'':' hidden'}>${heading('阅读外观','')}
      <div class="setting-row"><label for="theme">主题</label><select id="theme" data-setting="theme">${options([['light','浅色'],['dark','深色'],['system','跟随系统']],s.theme||'light')}</select></div>
      ${[['fontSize','字号',16,30,1,'px',18],['lineHeight','行距',1.5,2.5,.05,'',1.95],['width','正文宽度',480,880,20,'px',720]].map(([key,label,min,max,step,unit,fallback])=>`<div class="setting-row"><label for="${key}">${label}</label><div class="setting-range"><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${esc(s[key]??fallback)}" data-setting="${key}"><output id="value-${key}" for="${key}">${esc(s[key]??fallback)}${unit}</output></div></div>`).join('')}
      <div class="reading-sample prose"><span class="preview-label">预览</span><p>雨停的时候，街上的灯刚好亮起。你把书翻过一页，决定再多坐一会儿。</p></div>
      <details class="settings-extra"><summary>字体、排版与阅读习惯</summary>
        ${[['fontFamily','字体',[['serif','宋体／衬线'],['sans','黑体／无衬线'],['system','系统字体']]],['paragraphGap','段落间距',[['normal','适中'],['wide','宽松'],['compact','紧凑']]],['readingMode','阅读方式',[['continuous','连续滚动'],['paged','按回合翻页']]]].map(([key,label,values])=>`<div class="setting-row"><label for="${key}">${label}</label><select id="${key}" data-setting="${key}">${options(values,s[key]||values[0][0])}</select></div>`).join('')}
        ${[['showTime','显示故事时间','在阅读页显示故事内的时间'],['restReminder','休息提醒','连续阅读半小时后轻轻提醒'],['reducedMotion','减少动画','减少过渡与动态效果'],['sendEnter','Enter 发送','Shift + Enter 始终可以换行']].map(([key,label,description])=>`<div class="setting-row"><label for="${key}">${label}<small>${description}</small></label><input id="${key}" class="setting-switch" type="checkbox" role="switch" data-setting="${key}" ${(key==='showTime'?s[key]!==false:s[key])?'checked':''}></div>`).join('')}
      </details>
    </section>
    <section class="settings-block" id="narrative-settings" data-settings-panel tabindex="-1" aria-label="新故事偏好"${activeSection==='narrative-settings'?'':' hidden'}>${heading('新故事偏好','仅用于新故事。')}<div class="field-grid">${[['perspective','视角',['第二人称','第一人称','第三人称']],['length','篇幅',['简短','适中','舒展']],['pace','节奏',['从容','适中','紧凑']],['style','文风',['细腻克制','明快简洁','诗意留白','朴素日常']]].map(([key,label,values])=>`<label class="field">${label}<select data-setting="${key}">${options(values.map(v=>[v,v]),s[key])}</select></label>`).join('')}</div></section>
    <section class="settings-block" id="model-settings" data-settings-panel tabindex="-1" aria-label="生成服务"${activeSection==='model-settings'?'':' hidden'}>${heading('生成服务','')}<div class="settings-service-row"><div data-model-status class="model-status">${modelStatus(modelConfig)}</div>${button('检查连接','check-model')}</div><details class="settings-extra"><summary>连接与服务端配置</summary><p>本机 Codex 登录可直接使用现有账号额度。配置兼容 API 时，在项目的 .env 文件填写以下服务端参数并重启；密钥不会发送到浏览器。</p><pre class="code-note">MODEL_API_KEY=你的密钥\nMODEL_BASE_URL=接口的 /v1 地址\nMODEL_NAME=模型标识</pre><p>连接检查只确认服务配置，实际生成结果以故事中的响应为准。</p></details></section>
    <section class="settings-block" id="data-settings" data-settings-panel tabindex="-1" aria-label="数据与备份"${activeSection==='data-settings'?'':' hidden'}>${heading('数据与备份','故事保存在这台设备，暂不支持云同步。')}<div class="settings-data-row"><div><h3>导出记录</h3><p>导出当前浏览器中的世界、故事与草稿。</p></div>${button('导出本机记录','export-all')}</div><div class="settings-data-row"><div><h3>导入记录</h3><p>导入之前保存的 JSON 文件。</p></div>${button('导入记录','import-dialog')}</div><details class="settings-extra"><summary>备份与迁移说明</summary><p>JSON 包含浏览器中的世界、故事、草稿与分支。完整续玩还需要本机服务的 .data 目录和当前浏览器标识，单个 JSON 文件不能完整迁移新开局。</p><p>旧存档可能包含作者的幕后设定。分享给别人时请在故事选项中选择「导出正文」。</p></details><details class="settings-extra"><summary>整理数据</summary><div class="settings-data-row"><div><h3>整理演示故事</h3><p>移入回收箱后仍可恢复。</p></div>${button('演示故事移入回收箱','clear-demo')}</div></details>
    <details class="settings-developer"><summary>诊断记录</summary><p>仅记录本机交互事件，不包含剧情或输入内容。</p><p>已记录 ${telemetry.length} 条事件</p>${button('导出事件记录','export-events')}</details></section>
    </div></div></main>`;
}
