import {icon} from './ui-controls.js';
import {demoActions} from './demo.js';
import {worldAtmosphere} from './library-ui.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(label,name,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
const area=(label,name,value='',extra='')=>`<label class="field">${label}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const select=(label,name,values,value)=>`<label class="field">${label}<select name="${name}">${values.map(v=>`<option ${v===value?'selected':''}>${v}</option>`).join('')}</select></label>`;
const button=(label,action,style='',attrs='')=>`<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;

export function homeView({worlds,sessions,getExperience,recap,available}) {
  const last=sessions.filter(s=>!s.archived).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  const r=last?recap(last):null;
  const card=w=>'<a class="simple-story-card" href="#/world/'+esc(w.id)+'"><h3>'+esc(w.title)+'</h3><p>'+esc(getExperience(w).promise)+'</p><span>查看故事 →</span></a>';
  return '<main class="page simple-home" id="main"><header class="simple-heading"><div><h1>今天，想经历什么？</h1></div><a class="btn" href="#/create">＋ 自己创造故事</a></header>'+(last?'<section class="simple-resume"><div><span class="small muted">上次离开的地方</span><h2>'+esc(last.title)+'</h2><p>'+esc(r.summary||'故事已经开始，等你写下第一步。')+'</p></div><a class="btn primary" href="#/story/'+esc(last.id)+'">继续故事 →</a></section>':'')+'<section id="worlds"><div class="section-heading"><h2>开始新故事</h2></div><div class="simple-story-grid">'+worlds.filter(w=>!w.custom).map(card).join('')+'</div></section>'+(worlds.some(w=>w.custom)?'<section class="simple-own"><h2>我创建的故事</h2><div class="simple-story-grid">'+worlds.filter(w=>w.custom).map(card).join('')+'</div></section>':'')+(!available?'<p class="small muted">模型暂未连接，可先体验预设故事。</p>':'')+'</main>';
}

export function startAvailability({available=false,modelChecked=true,demo=false,mode}={}) {
  if(!modelChecked)return '正在检查连接，马上就好。';
  if(mode==='demo'||!available)return demo?'预设演示 · 选择建议，或继续经历。自由行动需要连接模型。 <a href="#/settings">连接设置</a>':'目前仅能查看开场，暂不能推进世界。连接模型后可开始自由行动。 <a href="#/settings">连接设置</a>';
  return '自由行动';
}

export function detailView({world:w,experience:e,settings:s,available,modelChecked=true,sessions=[]}) {
  const previous=sessions.filter(x=>x.worldId===w.id&&!x.personal?.trashedAt).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  const demo=!w.custom&&w.demoCompatible!==false&&demoActions(w,{step:0,flags:{}}).length>0;
  return `<main class="page world-detail-page" id="main">
    <a class="back" href="#/"><span aria-hidden="true">←</span> 发现世界</a>
    <div class="detail-layout"><article>
      <header class="world-intro">${worldAtmosphere(w)}<div><div class="library-tags">${(w.tags||[]).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><h1>${esc(w.title)}</h1><p class="detail-intro">${esc(w.description||w.tagline||e.promise)}</p>${w.era?`<p class="world-era">${esc(w.era)}</p>`:''}</div></header>
      <section class="world-opening"><div class="world-section-heading"><h2>开场</h2></div><div class="opening-preview">${esc(w.opening)}</div></section>
      <details class="detail-section"><summary>可能的经历</summary><ul class="rule-list">${(e.possibilities||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>
      <details class="detail-section"><summary>世界与人物</summary><ul class="rule-list">${(w.rules||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="world-cast">${(w.characters||[]).map(c=>`<div><span class="cast-initial" aria-hidden="true">${esc([...String(c.name||'人')][0])}</span><div><h3>${esc(c.name)}</h3><p>${esc(c.public)}</p></div></div>`).join('')}</div><div class="world-author-actions"><a href="#/edit/${esc(w.id)}" class="text-button">编辑世界</a>${button('复制世界','copy-world','compact',`data-id="${esc(w.id)}"`)}</div></details>
    </article><aside class="start-panel"><span class="library-kicker">你的角色</span><h2>${esc(w.identity)}</h2><p class="small muted">${esc(e.premise)}</p>${w.location?`<p class="start-location"><span>起始地点</span>${esc(w.location)}</p>`:''}${previous?`<a class="btn primary resume-world" href="#/story/${esc(previous.id)}">返回世界 ${icon('arrow-up-right')}</a><details class="restart-world"><summary>重新开始</summary><p class="small muted">创建另一份存档，已有进度仍会保留。</p>`:''}
      <form id="start-form" data-demo-compatible="${demo}" data-world="${esc(w.id)}"><button class="btn ${previous?'':'primary'}" type="submit" data-start-submit data-default-label="${previous?'新开一局':'进入世界'}" ${modelChecked?'':'disabled'}><span data-start-label>${!modelChecked?'正在检查连接…':previous?'新开一局':'进入世界'}</span> ${icon('arrow-up-right')}</button><p class="start-availability" data-start-availability role="status">${startAvailability({available,modelChecked,demo})}</p><details class="start-options"><summary>角色与游玩设置</summary><div class="stack details-content"><label class="field">游玩方式<select name="mode"><option value="real" ${available?'selected':'disabled'}>自由游玩 · 模型生成</option><option value="demo" ${!available?'selected':''}>${demo?'预设演示':'只读开场'}</option></select></label>${text('角色名','name','旅人','maxlength="60"')}${text('你的身份','identity',w.identity,'maxlength="200"')}${text('个人目标（可留空）','goal','','maxlength="500"')}<label class="field">参与方式<select name="participation"><option value="observe">先看世界如何展开，随时介入</option><option value="act">亲自行动与对话</option></select></label>${area('偏好与底线','boundaries','','maxlength="2000"')}${select('叙述视角','perspective',['第二人称','第一人称','第三人称'],s.perspective||w.narrative?.perspective||'第二人称')}${select('篇幅','length',['简短','适中','舒展'],s.length||w.narrative?.length||'适中')}</div></details></form>${previous?'</details>':''}
    </aside></div></main>`;
}

export function creatorView({world:w,id,available,busy=false,characterFields,error=''}) {
  const complete=!!(w.title||w.opening||id);
  return `<main class="page creator-page" id="main"><div class="editor"><header class="page-heading"><div><p class="interior-kicker">WORLD STUDIO</p><h1>${id?'编辑世界':'创造一个世界'}</h1><p class="interior-intro">${id?'打磨规则、人物与开场，让这个世界更接近你的想象。':'从一个念头开始，写下属于你的世界与第一幕。'}</p></div></header>${id?'<div class="notice">修改另存为新版本，已有故事保留原设定。</div>':''}
    <form id="world-form"><section class="creator-seed-panel"><div><label class="field"><span class="creator-seed-label">故事想法</span><textarea class="idea-input" name="seed" aria-describedby="creator-seed-help" placeholder="例如：在一座只说真话的小城，开一家茶铺。" maxlength="8000">${esc(w.seed)}</textarea></label><p class="creator-seed-help" id="creator-seed-help">${id?'修改想法后，可重新生成草案再审阅。':'写下你的设想，生成世界与第一幕后直接开始。'}</p><div class="creator-seed-actions">${!id?button(busy?'正在准备第一幕…':'生成并开始','quick-world','primary',!available||busy?'disabled':''):''}${busy?button('取消','cancel-assist','compact'):''}</div>${error?`<p class="notice error" role="alert">${esc(error)}</p>`:''}<p id="creation-model-status" class="small muted" role="status">${available?(busy?'正在准备人物、世界与第一幕。你的想法已保留。':''):'模型暂不可用，可以手动填写并保存。原始设想仍会自动保留。'}</p></div></section>

    <details id="world-details" ${complete?'open':''}><summary><span>先编辑设定</span></summary><div class="details-content"><p class="creator-editor-help">可以直接填写，也可以先生成草案再修改。保存后先预览，不会自动开始故事。</p><div class="creator-draft-tools">${button(busy?'正在形成开局…':'生成草案','generate-world',id?'primary':'',!available||busy?'disabled':'')}${!busy?'<div class="creator-import-row">'+button('导入文字资料','import-world-text','compact')+'</div>':''}</div>
      <section class="creator-chapter"><header><h2>世界</h2></header><div class="stack">${text('世界名称','title',w.title,'required maxlength="100" placeholder="为这个世界起一个名字"')}${area('世界简介','description',w.description,'maxlength="4000"')}${text('时代 / 环境','era',w.era,'maxlength="500"')}${area('基本规则 · 每行一条','rules',(w.rules||[]).join('\n'),'maxlength="8000"')}</div></section>
      <section class="creator-chapter"><header><h2>开场</h2></header><div class="stack"><div class="field-grid">${text('玩家身份','identity',w.identity,'required maxlength="500"')}${text('起始地点','location',w.location,'required maxlength="500"')}</div>${text('可选个人目标','goal',w.goal,'maxlength="1000"')}${area('开场正文','opening',w.opening,'required maxlength="12000"')}</div></section>
      <details class="creator-extra"><summary>人物与幕后资料 <small>${(w.characters||[]).length} 位人物</small></summary><div class="details-content">${(w.characters||[]).map(characterFields).join('')}${button(icon('plus')+' 添加人物','add-character','compact')}</div></details><details class="creator-extra"><summary>叙述偏好</summary><div class="field-grid details-content">${select('视角','perspective',['第二人称','第一人称','第三人称'],w.narrative?.perspective||'第二人称')}${select('篇幅','length',['简短','适中','舒展'],w.narrative?.length||'适中')}</div></details>
    </div></details><div class="editor-bar"><span class="small muted" data-save>草稿保存在此设备</span><div class="row">${button('预览开场','preview-world')}<button class="btn primary" type="submit">${id?'保存新版本':'保存并预览'} ${icon('arrow-up-right')}</button></div></div></form></div></main>`;
}

export function intentControls(mode='auto',participation='act') {
  return `<details class="writing-options"><summary>输入选项${mode!=='auto'?' · '+({action:'行动',ask:'只提问',phrase:'帮我措辞'}[mode]||''):''}${participation!=='act'?' · '+({observe:'让场景继续',delegate:'按目标推进',skip:'略过过程'}[participation]||''):''}</summary><div class="intent-controls"><label>这句话是<select id="input-intent" aria-label="输入用途"><option value="auto" ${mode==='auto'?'selected':''}>自然表达 · 自动识别</option><option value="action" ${mode==='action'?'selected':''}>实际行动 / 对白</option><option value="ask" ${mode==='ask'?'selected':''}>先问问 · 不执行</option><option value="phrase" ${mode==='phrase'?'selected':''}>帮我措辞 · 不发送</option></select></label><label>这段想怎样经历<select id="participation" aria-label="参与方式"><option value="act" ${participation==='act'?'selected':''}>亲自行动与对话</option><option value="observe" ${participation==='observe'?'selected':''}>旁观人物与事件</option><option value="delegate" ${participation==='delegate'?'selected':''}>按我给的目标推进</option><option value="skip" ${participation==='skip'?'selected':''}>略过已经决定的过程</option></select></label></div></details>`;
}
