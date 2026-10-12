import {resolveGameAction} from './game-state.js';

// All inputs are public branch projections. Rendering never discovers facts or runs actions.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
const button=(label,action,attrs='',classes='')=>`<button type="button" class="btn ${classes}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
const fields=object=>Object.fromEntries(list(object?.fields).map(f=>[f.key,text(f.value)]));
const objectButton=o=>button(o.name,'object-detail',`data-object="${esc(o.id)}"`,'play-object-title');
const field=(label,name,value='',placeholder='',required=false)=>`<label class="field">${esc(label)}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="1500" ${required?'required':''}></label>`;
const exactVersion=(o,situation,state)=>Number.isSafeInteger(situation.currentVersion??state.version)&&(o.locationVersion??o.sourceVersion)===(situation.currentVersion??state.version);
const locationOf=(situation,state)=>situation.currentLocation||state.location||'';
const retired=o=>['不再持有','已耗尽','已消耗','已归还','已丢失','已失去','consumed','returned'].includes(o.status)||fields(o).amount==='0';
const amount=o=>{const f=fields(o);return f.amount!==undefined?[f.amount,f.unit].filter(Boolean).join(' '):'';};
const custody=o=>{const f=fields(o);return [['owner','所有者'],['custodian','保管者'],['location','位置']].filter(([key])=>f[key]).map(([key,label])=>`${label}：${f[key]}`).join(' · ');};
const activeAgreement=o=>o.kind==='agreement'&&['已接受','已答应','已承诺','已约定','进行中','accepted','active'].includes(o.status);
const snapshotNotice=({situation={},busy=false}={})=>busy?`<p class="play-snapshot" role="status">故事正在推进，以下截至${esc(situation.clock?.label||'最近有效节点')}。查看不推进时间。</p>`:'';

export function inventoryGroups({situation={},state={}}={}){
  const carried=[],elsewhere=[],unlocated=[],inventory=new Set(list(state.inventory));
  for(const o of list(situation.objects).filter(o=>o.kind==='item'&&!retired(o))){
    const f=fields(o),quantity=amount(o),aliases=[o.id,o.name,quantity?o.name+quantity.replaceAll(' ',''):null];
    // Custody alone may mean storage at the shop. It does not imply carriage.
    const held=aliases.some(name=>name&&inventory.has(name))||o.certainty==='confirmed'&&exactVersion(o,situation,state)&&['随身','身上','你的身上','你身上','随身携带'].includes(f.location);
    (held?carried:f.location?elsewhere:unlocated).push(o);
  }
  return {carried,elsewhere,unlocated};
}

export function aroundObjects({situation={},state={}}={}){
  const objects=list(situation.objects),here=locationOf(situation,state),version=situation.currentVersion??state.version;
  const game=state.game||{},places=list(game.entities).filter(e=>e.kind==='place'),sources=places.filter(e=>e.name===here);
  // Explicit, current presence linked to this exact place also covers finer
  // descriptions such as "码头登船处附近". A mere related-place ID is not presence.
  const current=o=>o.certainty==='confirmed'&&exactVersion(o,situation,state)&&!!here&&(fields(o).location===here||o.kind==='person'&&o.status==='在场'&&!!fields(o).location&&sources.length===1&&list(o.relatedIds).includes(sources[0].id));
  const carried=new Set(inventoryGroups({situation,state}).carried.map(o=>o.id));
  const people=objects.filter(o=>o.kind==='person'&&current(o));
  const items=objects.filter(o=>o.kind==='item'&&!retired(o)&&(current(o)||carried.has(o.id)));
  const exitIds=new Set();
  if(sources.length===1){
    const source=sources[0].id;
    for(const surface of list(game.surfaces).filter(s=>s.version===version))for(const link of list(surface.links))if(link.from===source)exitIds.add(link.to);
    for(const route of list(game.spatial?.relations))if(route.kind==='route'&&route.passage!=='blocked'){
      if(route.from===source)exitIds.add(route.to);
      if(route.bidirectional&&route.to===source)exitIds.add(route.from);
    }
  }
  const exits=objects.filter(o=>o.kind==='location'&&o.certainty==='confirmed'&&(exitIds.has(o.id)||current(o)));
  return {people,items,exits};
}

const objectRows=(objects,{inventory=false}={})=>`<ul class="play-record-list">${objects.map(o=>{const summary=o.summary||o.status;return `<li><div class="play-record-heading">${objectButton(o)}${amount(o)?`<span>${esc(amount(o))}</span>`:''}</div>${summary&&!['已知','随身','已到访'].includes(summary)?`<p>${esc(summary)}</p>`:''}${inventory?`<p class="play-custody">${esc(custody(o))}</p>`:''}</li>`;}).join('')}</ul>`;

export function aroundView(args={}){
  const {people,items,exits}=aroundObjects(args);
  const groups=[['在场',people],['近处',items],['通路',exits]].filter(([,objects])=>objects.length);
  return `<section class="reading-panel play-panel" data-live-play="around" data-version="${args.state?.version??0}" data-busy="${!!args.busy}">${snapshotNotice(args)}${groups.length?groups.map(([title,objects])=>`<section class="play-section"><h3>${title}</h3>${objectRows(objects)}</section>`).join(''):'<p class="small muted">还没有周围事物的记录。</p>'}${button('自由行动','play-compose')}</section>`;
}

export function inventoryView(args={}){
  const {situation={},state={}}=args,{carried,elsewhere,unlocated}=inventoryGroups(args);
  const statusIds=new Set(list(state.game?.surfaces).filter(s=>s.kind==='status').flatMap(s=>list(s.entityIds)));
  const resources=list(situation.objects).filter(o=>o.kind==='resource'&&(statusIds.has(o.id)||['你','自己','玩家'].includes(fields(o).owner)||['你','自己','玩家'].includes(fields(o).custodian)));
  return `<section class="reading-panel play-panel" data-live-play="inventory" data-version="${args.state?.version??0}" data-busy="${!!args.busy}">${snapshotNotice(args)}${resources.length?`<section class="play-section"><h3>状态</h3>${objectRows(resources)}</section>`:''}<section class="play-section"><h3>随身</h3>${carried.length?objectRows(carried,{inventory:true}):'<p class="small muted">暂无随身物品记录。</p>'}</section>${elsewhere.length?`<details class="play-section"><summary title="最后已知位置">其他位置</summary>${objectRows(elsewhere,{inventory:true})}</details>`:''}${unlocated.length?`<details class="play-section"><summary>位置未明</summary>${objectRows(unlocated,{inventory:true})}</details>`:''}</section>`;
}

export function journalConcerns({situation={},personal={}}={}){
  return list(situation.objects).filter(o=>!personal.objects?.[o.id]?.muted&&(personal.objects?.[o.id]?.followed||activeAgreement(o)));
}

export function journalView(args={}){
  const {situation={},personal={},query=''}=args,needle=String(query).trim().toLocaleLowerCase();
  const concerns=journalConcerns(args),matches=needle?list(situation.objects).filter(o=>[o.name,o.summary,o.status,...list(o.fields).map(f=>text(f.value))].join(' ').toLocaleLowerCase().includes(needle)):[];
  const notes=list(personal.notes).filter(n=>!needle||`${n.text} ${n.reference?.quote}`.toLocaleLowerCase().includes(needle)),plans=needle?[]:notes.filter(n=>n.text?.startsWith('我的打算：')),otherNotes=notes.filter(n=>!plans.includes(n));
  return `<section class="reading-panel play-panel">${snapshotNotice(args)}<form id="play-journal-form" class="play-search">${field('搜索人物、地点、原话……','query',query)}<button type="submit" class="btn">查找</button></form>${needle?`<section class="play-section"><h3>已知记录</h3>${matches.length?objectRows(matches):'<p class="small muted">没有匹配的已知记录。</p>'}${button('搜索经历中的原话','play-journal-history',`data-query="${esc(query)}"`)}</section>`:`<section class="play-section"><h3>我在意的事</h3>${concerns.length?objectRows(concerns):''}${plans.map(n=>`<article class="play-private-note"><p>${esc(n.text.slice(5))}</p><span class="small muted">自己的打算</span> ${button('移除这条打算','remove-note',`data-id="${esc(n.id)}" data-return="journal"`,'compact')}</article>`).join('')}${concerns.length||plans.length?'':'<p class="small muted">还没有记下自己的打算或接受的约定。</p>'}${button('记个打算','play-plan')}</section>`}${otherNotes.length?`<section class="play-section"><h3>个人笔记</h3>${otherNotes.slice(-5).reverse().map(n=>`<article class="play-private-note"><p>${esc(n.text||n.reference?.quote)}</p>${button('查看原话','history-jump',`data-node="${esc(n.reference?.turnId||'')}"`,'compact')}</article>`).join('')}<p class="small muted">只给自己看，不会成为世界事实。</p></section>`:''}<div class="play-entry-list">${button('人物与见闻','situation')}${button('经历','history')}${button('笔记与收藏','notes')}</div></section>`;
}

export function objectActions({object,situation={},state={},branch={},historical=false,busy=false,ended=false}={}){
  if(!object)return [];
  if(historical)return [{kind:'draft',label:'引用到当前草稿',objectId:object.id}];
  const nearby=aroundObjects({situation,state}),present=nearby.people.some(o=>o.id===object.id),reachable=nearby.items.some(o=>o.id===object.id),actions=[];
  if(object.kind==='person'&&present)actions.push({kind:'talk',label:'对他说……',objectId:object.id});
  const game=state.game||{};
  for(const surface of list(game.surfaces))for(const action of list(surface.actions)){
    if(actions.length>=2)break;
    const addressed=list(action.effects).some(e=>e.entityId===object.id)||action.destination===object.id||surface.entityIds?.includes(object.id)&&(surface.entityIds.length===1||action.input?.includes(object.name));
    if(!addressed)continue;
    // Location shortcuts are previews in the map. Object details cannot bypass route review.
    if(action.destination!==null)continue;
    if(object.kind==='person'&&!present||object.kind==='item'&&!reachable)continue;
    const reference={branchId:branch.id,version:state.version,surfaceId:surface.id,actionId:action.id};
    let reason=busy?'故事正在推进，请在停下后重新查看。':ended?'这一段已经结束。':action.disabledReason||'';
    try{resolveGameAction(state,reference,{branchId:branch.id});}catch(error){reason=error.message;}
    const costs=list(action.effects).filter(e=>e.delta!==0).map(e=>{const entity=list(game.entities).find(x=>x.id===e.entityId);return entity?`${entity.name} ${e.delta>0?'+':''}${e.delta}${entity.unit||''}`:'';}).filter(Boolean);
    actions.push({kind:'game',label:action.label,reference,disabled:!!reason,reason,costs,mode:action.mode});
  }
  if(!actions.length&&object.kind==='item'&&reachable&&!ended)actions.push({kind:'draft',label:'仔细检查……',objectId:object.id,draft:`仔细检查${object.name}。`});
  if(actions.length<2&&!ended)actions.push({kind:'draft',label:'围绕它起草行动',objectId:object.id});
  return actions.slice(0,2);
}

export function objectActionView(args={}){
  return `<div class="play-object-actions">${objectActions(args).map(a=>a.kind==='game'?`<div>${button(a.label,'game-act',`data-surface="${esc(a.reference.surfaceId)}" data-action-id="${esc(a.reference.actionId)}" data-version="${esc(a.reference.version)}" data-branch="${esc(a.reference.branchId)}" ${a.disabled?'disabled aria-disabled="true"':''}`)}${a.costs.length?`<p class="small muted">${esc(a.costs.join(' · '))}</p>`:''}${a.mode==='attempt'?'<p class="small muted">尝试后由实际结果确认。</p>':''}${a.reason?`<p class="small muted">${esc(a.reason)}</p>`:''}</div>`:button(a.label,a.kind==='talk'?'play-talk':'draft-object',`data-object="${esc(a.objectId)}"${a.draft?` data-draft="${esc(a.draft)}"`:''}`)).join('')}</div>`;
}

const schedules=situation=>list(situation.objects).filter(o=>['agreement','event'].includes(o.kind)&&!['已履行','已取消','已失效','已完成','已拒绝','fulfilled','cancelled','expired'].includes(o.status)&&['scheduledAt','deadline'].some(key=>fields(o)[key]));
export function timePanelView(args={}){
  const {situation={}}=args,arrangements=schedules(situation),rows=records=>records.map(o=>`<li><p class="play-schedule-time">${esc(fields(o).scheduledAt||fields(o).deadline)}</p>${objectButton(o)}<p>${esc(o.summary)}</p><span class="small muted">${esc(o.status)}${o.certainty==='reported'?' · 他人说法':o.certainty==='inferred'?' · 推测':''}</span></li>`).join('');
  return `<section class="reading-panel play-panel time-panel" data-live-play="time" data-version="${args.state?.version??0}" data-busy="${!!args.busy}">${snapshotNotice(args)}<p class="play-clock">${esc(situation.clock?.label||'故事时间尚未明确')}</p><section class="play-section"><h3>日程</h3>${arrangements.length?`<ul class="play-record-list">${rows(arrangements.slice(0,3))}</ul>`:'<p class="small muted">暂无日程记录。</p>'}${arrangements.length>3?`<details><summary>查看其他安排</summary><ul class="play-record-list">${rows(arrangements.slice(3))}</ul></details>`:''}</section><div class="reading-actions">${[['short','等一会儿'],['until','等到……'],['skip','略过一段']].map(([mode,label])=>button(label,'play-time-mode',`data-mode="${mode}"`)).join('')}</div></section>`;
}

export function timeFormView({mode='skip',situation={},control={},busy=false,ended=false}={}){
  const precise=situation.clock?.precision==='exact',duration=control.duration||'',short=mode==='short',until=mode==='until';
  return `<section class="reading-panel play-panel time-panel"><p>${short?'选好时长后，再开始等待。':until?'说出一个时刻，或一件希望等到的事。':'用一句话写下要做的事、多久，以及何时交回给你。'}</p><form id="time-form" ${Number.isSafeInteger(situation.currentVersion)?`data-version="${situation.currentVersion}"`:""}><input type="hidden" name="mode" value="${esc(mode)}">${short?`<div class="reading-actions">${(precise?['5分钟','15分钟','30分钟']:['片刻','一会儿']).map(value=>button(value,'time-preset',`data-duration="${esc(value)}" aria-pressed="${value===duration}"`)).join('')}</div>${field('等多久','duration',duration,precise?'例如：15分钟':'例如：一会儿',true)}`:`${until?`<label class="field">等到<select name="untilType"><option value="time">某个时刻</option><option value="event" ${control.untilType==='event'?'selected':''}>某件事发生</option></select></label>`:''}${field(until?'等待的时刻或事情':'怎样度过这段时间','goal',control.goal,until?'例如：今天15:00，或唐棠来到店里':'例如：正常开店三天，不借钱；唐棠来时停下',true)}${until?field('若等一件事，最晚等到什么时候？','limit',control.limit,'由你决定，不预设截止时间'):`<details class="time-limit-details"><summary>补充结束范围（指令中已说明可不填）</summary>${field('最晚到什么时候结束','limit',control.limit,'例如：最多三天')}</details>`}`}
    <details class="time-boundaries"><summary>底线与要亲自决定的事</summary>${field('这段时间不要做','forbidden',control.forbidden,'例如：不借钱、不离开店铺')}${field('这些情况交回给我','reserved',control.reserved,'例如：唐棠来访时')}</details><p class="small muted">未明确授权的重要决定，会在执行前交回给你。指令也可以直接写在主输入框。</p><div class="dialog-footer"><button class="btn primary" type="submit" ${busy||ended?'disabled':''}>${mode==='skip'?'按这个范围略过':'开始等待'}</button></div></form></section>`;
}

export function timeControlFromInput(values={}){
  const clean=key=>String(values[key]||'').trim(),mode=clean('mode')||'skip',goal=clean('goal'),duration=clean('duration'),limit=clean('limit');
  const forbidden=clean('forbidden'),reserved=clean('reserved')||'重大承诺、借贷、关系表态或不可逆决定';
  if(mode==='short'){if(!duration)throw new Error('先选择或填写想等多久。');return {kind:'wait',goal:'在当前位置等待',until:duration,limit:duration,forbidden,reserved};}
  if(!goal)throw new Error(mode==='until'?'想等到哪个时刻，或什么事发生？':'写下想怎样度过这段时间。');
  if(mode==='until'){
    const untilTime=clean('untilType')==='time'&&/(?:\d{1,2}[:：]\d{2}|(?:\d+|[一二两三四五六七八九十]+)\s*(?:点|时|分钟|小时)|今天|明天|后天|傍晚|黎明|天黑|早晨|早上|中午|午后|下午|晚上|日落)/.test(goal);
    if(!untilTime&&!limit)throw new Error('最晚等到什么时候？');
    return {kind:'wait',goal:untilTime?'在当前位置等待':goal,until:goal,limit:limit||(untilTime?goal:''),forbidden,reserved};
  }
  // This only detects an explicit bound; interpreting the action remains the model's job.
  const bounded=/(?:\d+|[一二两三四五六七八九十百半]+)\s*(?:分钟|小时|天|日|周|个月|年|个场景|幕)|(?:到|至)[^。；\n]{0,30}(?:早上|中午|午后|下午|傍晚|晚上|明天|后天|点|时|结束)/.test(goal);
  if(!limit&&!bounded)throw new Error('这段过程最晚到什么时候结束？');
  return {kind:'advance',goal,until:'授权范围结束，或保留的事情发生时',limit:limit||goal,forbidden,reserved};
}

export function participationView({participation='act'}={}){
  return `<section class="reading-panel play-panel"><p>接手时由你决定行动。观察时，在已定事实和底线内让故事安排这一段，随时可以接回。</p><div class="play-entry-list">${button('我来接手','play-set-participation',`data-mode="act" aria-pressed="${participation==='act'}"`)}${button('先观察，让故事发展','play-set-participation',`data-mode="observe" aria-pressed="${participation==='observe'}"`)}</div><p class="small muted">切换会先停止仍在进行的请求，保留草稿与已经成立的场景。切换本身不会推进故事。</p></section>`;
}
