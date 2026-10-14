import {filterSessions} from './personal-library.js';
import {icon} from './ui-controls.js';
import {universeSculpture} from './multiverse-art.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
const worldMotifs=new Map([['fog-harbor','harbor'],['mountain','mountain'],['thursday','books'],['truth-teahouse','tea']]);
const button=(label,action,id,extra='')=>`<button type="button" class="btn compact" data-action="${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const option=(value,label,selected)=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(label)}</option>`;
const branchOf=session=>session.branches?.find(branch=>branch.id===session.activeBranch);
const timeLabel=state=>state?.experience?.clock?.label||(!/^第\s*\d+\s*个片刻$/.test(state?.time||'')&&state?.time!=='开篇'?state?.time:'')||'';
const dateOf=value=>Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value):null;
const realDate=value=>dateOf(value)?.toLocaleString('zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})||'未记录';
const sessionDate=session=>{
  const date=dateOf(session.updatedAt),full=realDate(session.updatedAt);
  return `<time${date?` datetime="${date.toISOString()}"`:''} title="${esc(full)}" aria-label="${esc(full)}">${esc(date?.toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})||'未记录时间')}</time>`;
};
const progressOf=session=>{
  const branch=branchOf(session),count=branch?.turns?.length||0,name=String(branch?.name||'').trim();
  const meaningful=name&&(session.branches?.length>1||branch.parentBranch||!['最初的故事','主线','main'].includes(name));
  return `${count} 回合${count?'':' · 开场'}${meaningful?' · 分支：'+name:''}`;
};
const snippet=(value,query='',limit=150)=>{
  const text=String(value||'').replace(/\s+/g,' ').trim(),term=normalize(query).trim().split(/\s+/)[0];
  const index=term?normalize(text).indexOf(term):-1,start=index>55?index-45:0;
  return (start?'…':'')+text.slice(start,start+limit)+(text.length>start+limit?'…':'');
};
const reset=(href,action)=>`<a class="library-reset" href="${href}" data-action="${action}">清空筛选</a>`;

// Decorative artwork identifies known worlds without claiming to depict generated events.
export function worldAtmosphere(world) {
  const key=String(world.worldId||world.id||world.title||'world');
  const hash=[...key].reduce((value,char)=>(value*31+char.codePointAt(0))>>>0,0);
  const tone=['forest','clay','midnight','gold','plum','slate'][hash%6];
  const motif=worldMotifs.get(world.worldId||world.id)||'portal';
  return '<div class="world-atmosphere" data-world-tone="'+tone+'" data-world-motif="'+motif+'" data-field-seed="'+hash+'" aria-hidden="true"><div class="world-scene"></div></div>';
}
const currentContext=session=>{
  const branch=branchOf(session),state=branch?.turns?.at(-1)?.state||branch?.initialState;
  return {location:state?.location||'',time:timeLabel(state),identity:session.player?.identity||''};
};

export function discoveryView({worlds=[],sessions=[],getExperience,recap,available,query='',tag='',favorites=[],onlyFavorites=false,excluded=[],excludeTag='',orderSeed=0}) {
  const latest=new Map();for(const world of worlds)if(!latest.has(world.id)||(latest.get(world.id).version||0)<(world.version||0))latest.set(world.id,world);
  const supply=[...latest.values()],tags=[...new Set(supply.flatMap(world=>world.tags||[]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  if(tag&&!tags.includes(tag))tags.push(tag);
  if(excludeTag&&!tags.includes(excludeTag))tags.push(excludeTag);
  const favoriteIds=new Set(favorites),excludedIds=new Set(excluded),terms=normalize(query).trim().split(/\s+/).filter(Boolean);
  const hidden=supply.filter(world=>excludedIds.has(world.id));
  const hiddenView=hidden.length?`<details class="library-hidden"><summary>已隐藏 · ${hidden.length}</summary><ul>${hidden.map(world=>`<li><span>${esc(world.title)}</span>${button('重新显示','restore-excluded',world.id)}</li>`).join('')}</ul></details>`:'';
  const filtered=supply.filter(world=>!excludedIds.has(world.id)&&(!tag||(world.tags||[]).includes(tag))&&(!excludeTag||!(world.tags||[]).includes(excludeTag))&&(!onlyFavorites||favoriteIds.has(world.id))&&terms.every(term=>normalize([world.title,world.description,...(world.tags||[])].join(' ')).includes(term)));
  const shift=filtered.length&&Number.isFinite(orderSeed)?((Math.trunc(orderSeed)%filtered.length)+filtered.length)%filtered.length:0;
  const matches=[...filtered.slice(shift),...filtered.slice(0,shift)];
  const last=filterSessions(sessions,{category:'active'}).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
  const filteredNow=!!(query||tag||excludeTag||onlyFavorites);
  const card=world=>{
    const favorite=favoriteIds.has(world.id),summary=snippet(getExperience?.(world)?.promise||world.description||'', '',54);
    const firstSentence=String(world.opening||'').match(/^[\s\S]*?(?:[。！？][”’」』]?|[.!?](?:\s|$))/)?.[0];
    const opening=snippet(firstSentence||world.opening,'',54);
    return `<article class="discovery-card">${worldAtmosphere(world)}<div class="discovery-card-content"><div class="library-card-meta"><span>${esc(world.tags?.[0]||(world.custom?'我的创作':'自由探索'))}</span>${favorite?'<span class="discovery-favorite-state">已收藏</span>':''}</div><h3><a href="#/world/${esc(world.id)}">${esc(world.title)}</a></h3>${summary?`<p class="discovery-summary">${esc(summary)}</p>`:''}${opening?`<blockquote class="discovery-opening">${esc(opening)}</blockquote>`:''}${world.identity?`<p class="discovery-role">你的身份：${esc(world.identity)}</p>`:''}<span class="discovery-enter" aria-hidden="true">探索世界 ${icon('arrow-up-right')}</span><div class="discovery-card-footer"><details class="discovery-more"><summary aria-label="${esc(world.title)}的开局选项">${icon('more')}</summary><div class="discovery-menu">${button(favorite?'取消收藏':'收藏','favorite-world',world.id,`aria-pressed="${favorite}" aria-label="${esc((favorite?'取消收藏：':'收藏开局：')+world.title)}"`)}${button('隐藏世界','exclude-world',world.id)}</div></details></div></div></article>`;
  };
  const empty=`<div class="library-empty"><h3>${onlyFavorites&&!favorites.length?'还没有收藏的开局':supply.length?'没有找到符合条件的开局':'这里暂时没有开局'}</h3><div class="library-empty-actions">${filteredNow?reset('#/','reset-discovery'):''}<a class="btn" href="#/create">创造一个世界</a></div></div>`;
  return `<main id="main" class="page library-surface discovery-page">
    <header class="discovery-toolbar"><div class="universe-hero-copy"><h1>世界之外，<br><span>另有<span class="hero-emphasis">人生</span>。</span></h1><div class="universe-hero-actions"><a class="btn ${last?'cinema-secondary':'primary'}" href="#/create">创造世界 ${icon('arrow-up-right')}</a></div></div>${universeSculpture()}</header>
    ${last?discoveryReturn(last):''}
    <section class="universe-catalog" aria-labelledby="discovery-title"><div class="discovery-section-bar"><div><h2 id="discovery-title">${filteredNow?'筛选结果':'发现世界'}</h2></div><span class="library-results" aria-live="polite">${matches.length} 个世界</span><button type="button" class="text-button" data-action="surprise-world" ${matches.length?'':'disabled'}>${icon('compass')} 替我挑一个 ${icon('arrow-up-right')}</button></div>
    <details class="discovery-search" id="discovery-search"${filteredNow?' open':''}><summary>搜索与筛选${filteredNow?' · 已启用':''}${icon('chevron-down')}</summary>
      <form id="discovery-form" class="library-filters" role="search"><label class="library-search"><span class="sr-only">搜索开局</span><input type="search" name="query" value="${esc(query)}" placeholder="搜索世界" maxlength="300"></label><button type="submit" class="btn">搜索</button><div class="discovery-filter-options"><label>题材<select name="tag">${option('','全部题材',tag)}${tags.map(value=>option(value,value,tag)).join('')}</select></label><label>排除题材<select name="excludeTag">${option('','不限',excludeTag)}${tags.map(value=>option(value,value,excludeTag)).join('')}</select></label><label class="library-check"><input type="checkbox" name="onlyFavorites" value="true"${onlyFavorites?' checked':''}>只看收藏</label>${button('换个顺序','shuffle-worlds','',matches.length>1?'':'disabled')}${filteredNow?reset('#/','reset-discovery'):''}</div></form>
    </details>
    ${matches.length?`<div class="discovery-grid">${matches.map(card).join('')}</div>`:empty}${hiddenView}</section>
    ${!available?'<p class="library-footnote" data-discovery-model-note>生成新内容需连接模型，已有经历仍可回顾。</p>':''}</main>`;
}

function discoveryReturn(session){
  const branch=branchOf(session),context=currentContext(session),prose=snippet(branch?.turns?.at(-1)?.prose||branch?.opening,'',95);
  return `<section class="world-return-strip" aria-label="回到上次的世界"><div class="world-return-mark" aria-hidden="true">${icon('orbit')}</div><div class="world-return-strip-content"><span>上次离开的地方</span><h2>${esc(session.title)}</h2><p class="world-return-context" title="${[progressOf(session),context.location].filter(Boolean).map(esc).join(' · ')}">${[progressOf(session),context.location].filter(Boolean).map(esc).join(' · ')}</p>${prose?`<p class="world-return-excerpt">${esc(prose)}</p>`:''}</div><a href="#/story/${esc(session.id)}" aria-label="回到世界：${esc(session.title)}">回到世界 ${icon('arrow-right')}</a></section>`;
}


export function libraryView({sessions=[],query='',category='active',group='',sort='updated'}) {
  const categories=[['active','进行中'],['ended','已完结'],['archived','已封存'],['pinned','已置顶'],['trash','回收箱'],['all','全部经历']];
  if(!categories.some(([value])=>value===category))category='active';
  const groups=[...new Set(sessions.map(s=>s.personal?.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  if(group&&!groups.includes(group))groups.push(group);
  const matches=filterSessions(sessions,{query,category,group,sort});
  const resume=!query&&!group&&category==='active'?filterSessions(sessions,{category:'active'}).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]:null;
  const categoryLabel=value=>categories.find(([key])=>key===value)?.[1]||'';
  const categoryControl=([value,label])=>`<label><input type="radio" name="category" value="${value}"${category===value?' checked':''}><span>${label}</span></label>`;
  const card=session=>{
    const branch=branchOf(session),turn=branch?.turns?.at(-1),p=session.personal||{},trash=p.trashedAt!=null;
    const status=trash?'回收箱':session.archived?'已封存':turn?.ended?'已完结':'进行中';
    const prose=turn?.prose||branch?.opening,summary=snippet(prose,'',100);
    const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
    const earlier=terms.length&&!terms.every(term=>normalize(prose).includes(term))?[branch?.opening,...(branch?.turns||[]).slice(0,-1).map(t=>t.prose)].find(value=>terms.some(term=>normalize(value).includes(term))):'';
    const match=earlier?snippet(earlier,query,70):'';
    const context=currentContext(session);
    return `<article class="world-entry" data-story-id="${esc(session.id)}"><div class="world-entry-marker" aria-hidden="true">${icon('compass')}</div><div class="world-entry-body"><div class="world-entry-heading"><h2>${trash?esc(session.title):`<a href="#/story/${esc(session.id)}" aria-label="${session.archived||turn?.ended?'回顾经历':'回到世界'}：${esc(session.title)}">${esc(session.title)}</a>`}</h2><span class="world-entry-status">${status}</span></div>${context.location?`<p class="world-entry-location">${esc(context.location)}</p>`:''}${summary?`<p class="world-entry-excerpt">${esc(summary)}</p>`:''}${match?`<p class="world-entry-search-match">匹配原文：${esc(match)}</p>`:''}<p class="world-entry-progress" title="${esc(progressOf(session))}">${esc(progressOf(session))}</p><div class="world-entry-meta"><span>${[context.identity,context.time,p.pinned?'已置顶':'',p.group].filter(Boolean).map(esc).join(' · ')||'一段独立的经历'}</span>${sessionDate(session)}</div>${p.note?`<p class="world-entry-note" title="${esc(p.note)}">${esc(snippet(p.note,'',45))}</p>`:''}</div><span class="world-entry-arrow" aria-hidden="true">${icon('arrow-up-right')}</span><details class="library-more" data-menu><summary aria-label="${esc(session.title)}的经历选项">${icon('more')}</summary><div>${trash?button('恢复经历','restore-story',session.id):button(p.pinned?'取消置顶':'置顶','pin-story',session.id,`aria-pressed="${!!p.pinned}"`)+button('重命名','rename-story',session.id)+button('备注与分组','story-note',session.id)+button(session.archived?'恢复经历':'封存经历','archive-story',session.id)+button('移入回收箱','trash-story',session.id)}</div></details></article>`;

  };
  const batch=matches.length?`<details class="library-batch"><summary>批量整理</summary><form id="library-batch-form"><p>选择要整理的经历。</p><fieldset><legend>选择经历</legend>${matches.map(session=>`<label><input type="checkbox" name="select-story" value="${esc(session.id)}" data-action="select-story" data-id="${esc(session.id)}">${esc(session.title)}</label>`).join('')}</fieldset><div class="library-batch-actions">${category==='trash'?'':button('封存所选','batch-archive','')}${button(category==='trash'?'恢复所选经历':'恢复所选封存','batch-restore','')}${category==='trash'?'':button('将所选移入回收箱','batch-trash','')}</div></form></details>`:'';
  const hasFilters=!!query||!!group;
  const emptyTitle=hasFilters?'没有找到符合条件的故事':category==='trash'?'回收箱是空的':category==='pinned'?'还没有置顶的故事':category==='archived'?'还没有封存的故事':category==='ended'?'还没有标记完结的故事':sessions.some(session=>session.personal?.trashedAt==null)?'这里暂时没有进行中的故事':'你的第一段故事，还未开始';
  const empty=`<div class="library-empty"><h2>${emptyTitle}</h2><p>${hasFilters?'搜索会查找当前经历的完整正文、标题与私人备注。可以缩短关键词或清空筛选。':category==='trash'?'移入回收箱的故事会在这里等待整理，不会影响其他故事。':category==='pinned'?'在故事的整理菜单中置顶，便能更快找到想要返回的世界。':'可以切换分类回看已有经历，也可以从一个开局开始。'}</p><div class="library-empty-actions">${reset('#/stories','reset-library')}<a class="btn" href="#/">看看已有开局</a></div></div>`;

  return `<main id="main" class="page library-surface personal-library"><header class="journey-heading"><div><h1>我的世界</h1></div><details class="journey-options" data-menu><summary aria-label="经历管理">${icon('more')}</summary><div>${button('导入记录','import-dialog','')}</div></details></header>
    ${resume?resumeView(resume):''}
    <form id="library-form" class="journey-toolbar" role="search"><fieldset class="library-category-nav"><legend class="sr-only">故事状态</legend>${[['active','进行中'],['ended','已完结'],['all','全部']].map(categoryControl).join('')}<details class="journey-filter" data-menu${['pinned','archived','trash'].includes(category)?' open':''}><summary>${['pinned','archived','trash'].includes(category)?categoryLabel(category):'更多'}${icon('chevron-down')}</summary><div>${categories.filter(([v])=>['pinned','archived','trash'].includes(v)).map(categoryControl).join('')}</div></details></fieldset><label class="journey-search">${icon('search')}<span class="sr-only">搜索我的世界</span><input type="search" name="query" value="${esc(query)}" placeholder="搜索世界" maxlength="300"></label><button class="journey-search-submit" type="submit" aria-label="搜索我的世界">${icon('arrow-right')}</button><details class="journey-sort" data-menu${group||sort!=='updated'?' open':''}><summary aria-label="分组与排序">${icon('status')}</summary><div><label>分组<select name="group">${option('','所有分组',group)}${groups.map(v=>option(v,v,group)).join('')}</select></label><label>排序<select name="sort">${[['updated','最近进入'],['created','创建时间'],['title','世界名称']].map(([v,l])=>option(v,l,sort)).join('')}</select></label></div></details></form>
    ${query||group?`<div class="journey-filter-state"><span role="status">${matches.length} 个结果</span>${reset('#/stories','reset-library')}</div>`:''}${category==='trash'?'<p class="library-recovery-note">移入回收箱的故事可以恢复。</p>':''}
    ${matches.length?`<div class="world-list">${matches.map(card).join('')}</div>`:empty}${batch}</main>`;
}

export function resumeView(session){
 const branch=branchOf(session),turn=branch?.turns?.at(-1),context=currentContext(session);
 return `<section class="world-current" aria-label="当前世界">${worldAtmosphere(session)}<div class="world-current-content"><span class="world-current-eyebrow"><i aria-hidden="true"></i>你离开的地方</span><h2>${esc(session.title)}</h2>${context.location?`<p class="world-current-location">${esc(context.location)}</p>`:''}<p class="world-current-situation">${esc(snippet(turn?.prose||branch?.opening,'',110))}</p><p class="world-current-progress" title="${esc(progressOf(session))}">${esc(progressOf(session))}</p><div class="world-current-footer"><a class="world-return" href="#/story/${esc(session.id)}" aria-label="回到世界：${esc(session.title)}">回到世界${icon('arrow-up-right')}</a>${context.identity||context.time?`<span>${[context.identity,context.time].filter(Boolean).map(esc).join(' · ')}</span>`:''}</div></div></section>`;
}
