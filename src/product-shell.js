import {icon} from './ui-controls.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function productShell(content,{active='worlds',sessions=[]}={}){
  const recent=sessions.filter(s=>!s.archived&&s.personal?.trashedAt==null)
    .slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,5);
  const nav=(href,key,label,mark)=>`<a href="${href}" class="workspace-nav-link${active===key?' is-active':''}"${active===key?' aria-current="page"':''}>${icon(mark)}<span>${label}</span></a>`;
  return `<div class="product-app"><aside class="workspace-sidebar" aria-label="工作区导航">
    <a class="workspace-brand" href="#/" aria-label="elselife 首页"><span class="brand-sigil" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <g stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7.4 16.2C13.2 13.1 16.1 8.5 22 5.7M13.6 25.8C21 23 21.1 15 26 11.7" stroke-width="1.1" opacity=".5"/>
        <ellipse cx="24" cy="8.7" rx="5.2" ry="3.6" transform="rotate(-33 24 8.7)" stroke-width="1.25" opacity=".8"/>
        <ellipse cx="24.5" cy="8.9" rx="2.8" ry="1.7" transform="rotate(-33 24.5 8.9)" stroke-width="1.05"/>
        <ellipse cx="10.5" cy="21" rx="8" ry="5.7" transform="rotate(-33 10.5 21)" stroke-width="1.4" opacity=".8"/>
        <ellipse cx="11.5" cy="21.3" rx="5.1" ry="3.1" transform="rotate(-33 11.5 21.3)" stroke-width="1.5"/>
      </g>
    </svg></span><span class="brand-wordmark">elselife<span class="brand-caption">另一个世界，另一种你</span></span></a>
    <a class="workspace-create" href="#/create">${icon('plus')}<span>创造世界</span></a>
    <nav class="workspace-nav" aria-label="主导航">${nav('#/','worlds','发现','compass')}${nav('#/stories','stories','我的世界','layers')}${nav('#/create','create','创造世界','plus')}${nav('#/settings','settings','设置','settings')}</nav>
    ${recent.length?`<details class="workspace-recents" data-menu><summary aria-label="最近进入的世界">${icon('history')}<span>最近进入</span></summary><div class="workspace-recent-menu">${recent.map(s=>{
      const repeated=recent.filter(item=>item.title===s.title).length>1,branch=s.branches?.find(b=>b.id===s.activeBranch),count=branch?.turns?.length||0;
      const name=String(branch?.name||'').trim(),meaningful=name&&(s.branches?.length>1||branch.parentBranch||!['最初的故事','主线','main'].includes(name));
      const date=Number.isFinite(s.updatedAt)&&Math.abs(s.updatedAt)<=8640000000000000?new Date(s.updatedAt):null;
      const shortDate=date?.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})||'未记录时间';
      const fullDate=date?.toLocaleString('zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})||'未记录时间';
      const label=[s.title,`${count} 回合`,meaningful?'分支：'+name:'',fullDate].filter(Boolean).join(' · ');
      return `<a href="#/story/${esc(s.id)}" title="${esc(label)}" aria-label="${esc(label)}">${icon('history')}<span>${esc(s.title)}</span>${repeated?`<small>${count} 回合 · ${esc(shortDate)}</small>`:''}</a>`;
    }).join('')}</div></details>`:''}
    <div class="workspace-bottom">${nav('#/settings','settings','设置','settings')}<span class="workspace-local">${icon('layers')}本机空间</span></div>
  </aside><div class="workspace-main">${content}</div></div>`;
}
