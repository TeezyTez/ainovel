import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readerView,situationView,objectView,historyView,timeView} from '../src/reading-ui.js';
import {readerDossierNav} from '../src/ui-controls.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {initialState} from '../src/core.js';
import {demoActions,demoGenerate} from '../src/demo.js';

const object={id:'person:lin',kind:'person',name:'林舟',summary:'坐在柜台旁',status:'上次见于店内',certainty:'reported',fields:[{key:'relationship',label:'关系',value:'初识'}],sourceVersion:1};
const branch={id:'b1',name:'原来的故事',opening:'雨落在窗外。',draft:'我想再问一句。',turns:[{id:'t1',input:'向林舟问好。',prose:'林舟抬起头。\n\n林舟说：“雨很快就停。”',state:{version:1,location:'钟表铺'},experience:{clock:{label:'午后',elapsed:'一小会儿'},folded:[{title:'等待雨停',summary:'一阵雨',quote:'雨落在窗外。'}]}}]};
const args={session:{title:'雨天',player:{name:'小叶'},preferences:{},mode:'real'},world:{title:'钟表铺',secret:'幕后秘密禁止出现在UI',characters:[{id:'hidden',secret:'远处隐藏的人'}]},branch,state:branch.turns[0].state,situation:{clock:{label:'午后'},summary:'你在钟表铺。',objects:[object]},settings:{showSuggestions:true}};

test('continue is visible beside the draft and leaves unsent writing intact',()=>{
  const before=JSON.stringify(branch),html=readerView(args);
  const composer=html.slice(html.indexOf('<section data-reader-live="composer"'));
  assert.match(composer,/<button[^>]*data-action="continue"[^>]*>继续经历<\/button>/);
  assert.match(composer,/<textarea[^>]*>我想再问一句。<\/textarea>/);
  assert.equal(JSON.stringify(branch),before);
});

test('preset demo exposes current usable suggestions as draft choices rather than submissions',()=>{
  const world=PRESET_WORLDS[0],state=initialState(world),suggestions=demoActions(world,state);
  const html=readerView({...args,world,state,session:{mode:'demo'},branch:{...branch,turns:[]},suggestions});
  const choices=[...html.matchAll(/<button[^>]*data-action="suggest"[^>]*data-id="([^"]+)"[^>]*>([^<]+)<\/button>/g)];
  assert.ok(choices.length>=2&&choices.length<=3);
  for(const choice of choices){
    assert.equal(choice[2],suggestions.find(s=>s.id===choice[1]).text);
    assert.doesNotThrow(()=>demoGenerate({world,state,input:choice[2],requestId:'reader-choice'}));
    assert.match(choice[0],/type="button"/);
  }
  assert.match(html,/预设演示/);
  assert.doesNotMatch(readerView({...args,suggestions}),/data-action="suggest"/);
});

test('incompatible demo presents read-only opening and connection settings instead of impossible actions',()=>{
  for(const world of [{...PRESET_WORLDS[0],custom:true},{...PRESET_WORLDS[0],demoCompatible:false},{...PRESET_WORLDS[0],id:'unknown-world'}]){
    const html=readerView({...args,world,session:{mode:'demo'},error:'旧的请求失败',pending:{status:'error'},suggestions:[{id:'fake',text:'假的行动'}]});
    assert.match(html,/只读开场/);
    assert.match(html,/href="#\/settings"/);
    assert.doesNotMatch(html,/data-action="(?:continue|suggest|retry-turn|cancel-generation|selection-reference|selection-ask)"|id="action-form"|type="submit"/);
    assert.match(html,/雨落在窗外/);
    assert.match(readerView({...args,world}),/id="action-form"/);
  }
});

test('new action controls remain blocked until pending response resolves or ending is reopened',()=>{
  for(const options of [{busy:true},{pending:{status:'waiting'}},{pending:{status:'stopped'}},{pending:{status:'error',error:'断线'}},{error:'恢复待确认'},{branch:{...branch,turns:[{...branch.turns[0],ended:true}]}}]){
    const html=readerView({...args,...options}),composer=html.slice(html.indexOf('<section data-reader-live="composer"'));
    assert.doesNotMatch(composer,/<button[^>]*data-action="continue"(?![^>]*disabled)[^>]*>/);
    assert.doesNotMatch(composer,/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/);
    assert.match(composer,/id="action-form"[^>]*data-story-blocked="true"/);
  }
});

test('failed local demo input can be replaced with a usable suggestion without server recovery',()=>{
  const world=PRESET_WORLDS[0],state=initialState(world),html=readerView({...args,world,state,session:{mode:'demo'},pending:{status:'error',input:'自由输入',error:'当前演示只覆盖预设情境'},error:'当前演示只覆盖预设情境',suggestions:demoActions(world,state)});
  const choice=html.match(/<button[^>]*data-action="suggest"[^>]*>/)?.[0];
  assert.ok(choice);
  assert.doesNotMatch(choice,/disabled/);
  assert.match(html,/data-action="continue" >继续经历<\/button>/);
  assert.doesNotMatch(html,/data-action="recover-turn"/);
});

test('reader orientation uses public location and respects the clock visibility preference',()=>{
  const html=readerView(args),header=html.match(/<header class="reading-header"[\s\S]*?<\/header>/)[0];
  assert.match(header,/reading-context/);assert.match(header,/钟表铺/);assert.match(header,/午后/);
  assert.match(header,/aria-label="显示设置"/);
  const hidden=readerView({...args,settings:{showTime:false}}).match(/<header class="reading-header"[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(hidden,/午后/);
  const unknown=readerView({...args,state:{},situation:{clock:{label:'故事时间未说明'}}}).match(/<header class="reading-header"[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(unknown,/undefined|尚未明确|故事时间未说明|幕后秘密/);
});

test('paged reader orientation follows the selected public snapshot instead of the latest scene',()=>{
  const initialState={version:0,location:'钟表铺',time:'开篇',facts:[],inventory:[],experience:{clock:{label:'午后',sourceVersion:0},objects:[]}};
  const history={...branch,initialState,turns:[
    {...branch.turns[0],state:{...initialState,version:1,location:'石桥'},experience:undefined},
    {id:'t2',input:'走到码头。',prose:'你在码头停下。',state:{...initialState,version:2,location:'码头',experience:{clock:{label:'晚上',sourceVersion:2},objects:[]}}}
  ]};
  const view={...args,branch:history,state:history.turns[1].state,situation:{clock:{label:'晚上'},objects:[]},settings:{readingMode:'paged'}};
  const header=options=>readerView({...view,...options}).match(/<header class="reading-header"[\s\S]*?<\/header>/)[0];
  assert.match(header({page:0}),/钟表铺/);assert.match(header({page:0}),/午后/);assert.doesNotMatch(header({page:0}),/码头|晚上/);
  assert.match(header({page:1}),/石桥/);assert.match(header({page:1}),/最后确认：午后/);assert.doesNotMatch(header({page:1}),/码头|晚上/);
  assert.match(header({page:2}),/码头/);assert.match(header({page:2}),/晚上/);
  assert.doesNotMatch(header({page:1,settings:{readingMode:'paged',showTime:false}}),/午后|晚上/);
  assert.match(header({page:0,settings:{readingMode:'continuous'}}),/码头/);assert.match(header({page:0,settings:{readingMode:'continuous'}}),/晚上/);
});

test('reader shows a single readable story with honest clock and save status',()=>{
  const html=readerView(args);
  assert.match(html,/故事时间|午后/);
  assert.match(html,/回合 1/);
  assert.match(html,/保存状态待确认/);
  assert.doesNotMatch(html,/幕后秘密|远处隐藏|createdAt|进度.*%/);
  for(const action of ['take-control','context-open','expand-input'])assert.ok(!html.includes(`data-action="${action}"`));
  // The menu groups story operations; reference categories live in the dossier.
  const menu=html.match(/<div id="reader-quick-tools"[\s\S]*?<\/nav><\/div>/)?.[0];
  assert.ok(menu);
  for(const action of ['continue','time-control','play-participation','reader-inspect','history','reader-settings','branches','export-story'])assert.ok(menu.includes(`data-action="${action}"`),action);
  const dossier=readerDossierNav();
  for(const kind of ['time','journal'])assert.match(dossier,new RegExp(`data-action="reader-inspect" data-kind="${kind}"`));
  const outside=html.replace(menu,'');
  assert.doesNotMatch(outside,/data-action="(?:play-time|play-map|play-inventory|play-journal|play-around|story-tools)"/);
  assert.match(outside,/data-action="continue"[^>]*>继续经历<\/button>/);
  assert.match(html,/popovertarget="reader-quick-tools"/);
  assert.doesNotMatch(html,/class="play-panel"|<aside/);
  assert.equal((html.match(/<textarea/g)||[]).length,1);
  assert.doesNotMatch(html,/<select|行动建议|输入选项/);
  assert.match(html,/aria-label="发送"/);
  assert.match(html,/id="action-input"[^>]*>我想再问一句。/);
});

test('untrusted prose, titles, drafts, object ids and notes cannot introduce markup',()=>{
  const attack='<img src=x onerror="alert(1)">';
  const html=readerView({...args,session:{title:attack},branch:{opening:attack,turns:[],draft:'</textarea>'+attack},situation:{objects:[]}})+objectView({object:{...object,id:'"><script>x</script>',summary:attack},notes:[{reference:{objectId:'"><script>x</script>'},text:attack}]});
  assert.doesNotMatch(html,/<img|<script>|onerror="alert/);
  assert.match(html,/&lt;img/);
  assert.match(html,/&lt;\/textarea&gt;/);
});

test('only first unambiguous occurrence per turn links to a stable object identity',()=>{
  const html=readerView(args);
  assert.equal((html.match(/data-action="object-detail"/g)||[]).length,1);
  assert.match(html,/data-object="person:lin"/);
  const ambiguous=readerView({...args,situation:{objects:[object,{...object,id:'person:other'}]}});
  assert.doesNotMatch(ambiguous,/data-action="object-detail"/);
  const future=readerView({...args,situation:{objects:[{...object,sourceVersion:2}]}});
  assert.doesNotMatch(future,/data-action="object-detail"/);
});

test('generation leaves draft editable, stops through a stable control and hides send execution',()=>{
  const html=readerView({...args,busy:true,error:'连接中断',suggestions:[{id:'x',text:'问一句'}],focusMode:true});
  assert.match(html,/data-action="cancel-generation"[^>]*aria-label="停止生成"/);
  assert.match(html,/<textarea[^>]*id="action-input"[^>]*>我想再问一句。/);
  assert.doesNotMatch(html,/type="submit"/);
  assert.match(html,/data-action="continue"[^>]*disabled/);
  assert.match(html,/role="alert"/);
  assert.doesNotMatch(html,/data-action="suggest"/);
  assert.doesNotMatch(html,/<details class="reading-suggestions" open/);
});

test('a pending response shows submitted writing separately from the editable next draft',()=>{
  const html=readerView({...args,busy:true,branch:{...branch,draft:'等他答复后，我还想问时间。'},pending:{input:'我问他昨晚见到了谁。',startedAt:100,status:'waiting'}});
  const pending=html.match(/<div data-reader-live="pending">([\s\S]*?)<div id="reader-bottom"/)?.[1]||'';
  assert.match(pending,/我问他昨晚见到了谁/);
  assert.doesNotMatch(pending,/等他答复后/);
  assert.match(pending,/role="status"/);
  assert.match(pending,/data-action="cancel-generation"/);
  assert.match(html,/<textarea[^>]*id="action-input"[^>]*>等他答复后，我还想问时间。<\/textarea>/);
  assert.doesNotMatch(html,/<textarea[^>]*(?:disabled|readonly)/);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled/);
  assert.equal((html.match(/data-action="cancel-generation"/g)||[]).length,1);
});

test('pending status reports the actual stage and header reference tools remain named on narrow screens',()=>{
  for(const [stage,label] of Object.entries({preparing:'正在理解这一步',writing:'正在续写',checking:'正在核对情节',saving:'正在保存'})){
    const html=readerView({...args,busy:true,pending:{input:'打开信。',status:'waiting',stage}});
    assert.match(html,new RegExp(`role="status">[\\s\\S]*?${label}`));
    assert.doesNotMatch(html,/\d+%|预计.*秒/);
    assert.match(html,/data-action="reader-inspect" data-kind="all" aria-label="查阅故事资料"/);
    assert.match(html,/data-action="history" aria-label="回顾故事经历"/);
  }
});

test('historical rich records restore their own saved state and retain viewing controls without execution',()=>{
  const definition={id:'reference',title:'周围情况',summary:'当时留下的资料。',scope:{branchId:'b1',baseVersion:0},fields:[{id:'amount',type:'number',default:99}],steps:[{fields:['amount']}],actions:[{id:'buy',label:'买下它'}],view:[
    {type:'table',columns:['地点','记号'],rows:[[{op:'ref',path:['location']},'<script>旧记录</script>']]},
    {type:'cards',items:[{title:'检查信件',body:'信封尚未打开',prompt:'拆开信封。'}]},
    {type:'value',label:'当时的输入',value:{op:'ref',path:['params','amount']}}
  ]};
  const history={...branch,initialState:{version:0,location:'开场钟表铺'},openingInteraction:definition,turns:[{...branch.turns[0],state:{version:1,location:'当时石桥'},interactionSnapshot:{...definition,scope:{branchId:'b1',baseVersion:1}}}]};
  const before=JSON.stringify(history),html=readerView({...args,branch:history,state:{version:2,location:'当前码头'}});
  const opening=html.match(/data-history-interaction="opening">([\s\S]*?)<\/details><\/div>/)?.[1]||'';
  const later=html.match(/data-history-interaction="t1">([\s\S]*?)<\/details><\/div>/)?.[1]||'';
  assert.match(opening,/开场钟表铺/);assert.doesNotMatch(opening,/当时石桥|当前码头/);
  assert.match(later,/当时石桥/);assert.doesNotMatch(later,/开场钟表铺|当前码头/);
  for(const record of [opening,later]){
    assert.match(record,/data-historical-rich/);assert.match(record,/<table/);assert.match(record,/data-rich-sort/);
    assert.match(record,/data-rich-draft="拆开信封。" disabled/);
    assert.doesNotMatch(record,/data-dynamic-(?:field|action|nav)=|<script>|正在整理|补全输入/);
    assert.match(record,/只读/);
    assert.match(record,/当时未保存的选择，无法完整还原/);
    assert.doesNotMatch(record,/<strong>99<\/strong>/);
  }
  assert.equal(JSON.stringify(history),before);
  const missing=readerView({...args,branch:{...history,initialState:undefined}}).match(/data-history-interaction="opening">([\s\S]*?)<\/details><\/div>/)?.[1]||'';
  assert.match(missing,/当时留下的资料/);assert.match(missing,/摘要/);assert.doesNotMatch(missing,/<table/);
  assert.match(readerView(args),/data-history-interaction="opening"><\/div>/);
});

test('failed and stopped responses expose recovery actions without requiring typed commands',()=>{
  for(const pending of [{input:'打开信封。',status:'error',error:'连接暂时中断。'},{input:'打开信封。',status:'stopped'}]){
    const html=readerView({...args,pending});
    assert.match(html,/打开信封/);
    assert.match(html,/data-action="retry-turn"/);
    assert.match(html,/data-action="recover-turn"/);
    assert.doesNotMatch(html,/可输入“恢复进度”|输入“重试”/);
    assert.doesNotMatch(html,/data-action="cancel-generation"/);
  }
});

test('reading later pages does not repeat the opening title or hide short player actions',()=>{
  const opening=readerView({...args,settings:{readingMode:'paged'},page:0}),later=readerView({...args,settings:{readingMode:'paged'},page:1});
  assert.match(opening,/<header class="reading-chapter"/);
  assert.doesNotMatch(later,/<header class="reading-chapter"/);
  assert.match(later,/<h1 class="sr-only">/);
  assert.match(later,/<blockquote class="reading-player-line"[\s\S]*?向林舟问好/);
  assert.doesNotMatch(later,/<details class="reading-input-record"/);
  assert.match(later,/data-action="historical-state"/);
  assert.match(later,/data-action="fork"/);
});

test('ending keeps all original prose readable and offers voluntary epilogue',()=>{
  const html=readerView({...args,branch:{...branch,turns:[{...branch.turns[0],ended:true}]}});
  assert.match(html.replace(/<[^>]+>/g,''),/林舟抬起头/);
  assert.match(html,/data-action="epilogue"/);
  assert.doesNotMatch(html,/data-action="continue"/);
  assert.match(html,/id="action-form"/);
  const demo=readerView({...args,session:{mode:'demo'},branch:{...branch,turns:[{...branch.turns[0],ended:true}]}});
  assert.doesNotMatch(demo,/data-action="epilogue"/);
});

test('folded sections are saved quotes expanded by native details, not generation actions',()=>{
  const html=readerView(args),fold=html.match(/<details class="time-fold">[\s\S]*?<\/details>/)?.[0];
  assert.match(fold,/雨落在窗外/);
  assert.match(fold,/<blockquote>雨落在窗外。<\/blockquote>/);
  assert.doesNotMatch(fold,/data-action/);
});

test('all situation layouts use the same public objects, filters and stable ids without mutation',()=>{
  const situation={clock:{label:''},summary:'目前所知',objects:[object,{...object,id:'item:watch',kind:'item',name:'怀表',summary:'代为保管',sourceVersion:2}]};
  const before=JSON.stringify(situation);
  for(const view of ['cards','table','text']){
    const html=situationView({situation,view,query:'林舟',sort:'updated'});
    assert.match(html,/data-object="person:lin"/);
    assert.doesNotMatch(html,/data-object="item:watch"/);
    assert.match(html,/他人说法/);
    assert.match(html,/故事时间尚未明确/);
  }
  assert.equal(JSON.stringify(situation),before);
  const empty=situationView({situation,filter:'clue'});
  assert.match(empty,/当前已知资料中没有匹配/);
  assert.match(empty,/没有记录，不代表不存在/);
});

test('object detail retains zero values, preserves certainty and never guesses a missing source',()=>{
  const html=objectView({object:{...object,fields:[{label:'现金',value:0},{label:'未来',value:{secret:'不能序列化'}},{label:'持有人',value:'尚未明确'}]},branch,notes:[{reference:{objectId:object.id},text:'只是我的猜想'}]});
  assert.match(html,/<dd>0<\/dd>/);
  assert.match(html,/只是我的猜想/);
  assert.match(html,/他人说法/);
  assert.match(html,/data-node="t1"/);
  assert.doesNotMatch(html,/不能序列化|\[object Object\]/);
  const absent=objectView({object:{...object,sourceVersion:99},branch});
  assert.match(absent,/来源尚未定位/);
  assert.doesNotMatch(absent,/data-action="history-jump"/);
});

test('history searches full saved prose and uses navigation separate from branch creation',()=>{
  const text='甲'.repeat(1000)+'很远的关键词',b={...branch,turns:[{id:'deep',input:'',prose:text,state:{version:1}}]};
  const before=JSON.stringify(b),html=historyView({branch:b,query:'很远的关键词'});
  assert.match(html,/data-action="history-jump"[^>]*data-node="deep"/);
  assert.match(html,/data-action="historical-state"[^>]*data-node="deep"/);
  assert.match(html,/data-action="fork"[^>]*data-node="deep"/);
  assert.doesNotMatch(html,/<ol class="history-entries">[\s\S]*data-node=""/);
  assert.equal(JSON.stringify(b),before);
});

test('time form accepts one bounded natural instruction with optional explicit boundaries',()=>{
  const html=timeView({mode:'skip'});
  for(const name of ['mode','goal','limit','forbidden','reserved'])assert.match(html,new RegExp(`name="${name}"`));
  assert.match(html,/name="goal"[^>]*required/);
  assert.match(html,/name="limit" value=""/);
  assert.match(html,/未明确授权的重要决定/);
  assert.equal((html.match(/type="submit"/g)||[]).length,1);
});

test('reader preserves DOM integration hooks and clamps only reading appearance',()=>{
  const html=readerView({...args,settings:{fontSize:100,lineHeight:4,width:2000,paragraphGap:'wide'},error:'请求失败'});
  for(const value of ['header','composer','ending'])assert.equal((html.match(new RegExp(`data-reader-live="${value}"`,'g'))||[]).length,1);
  for(const hook of ['data-reader-turns','data-selection-tools','data-history-notice','data-draft-references'])assert.ok(html.includes(hook));
  assert.match(html,/--reading-size:30px/);
  assert.match(html,/--reading-paragraph-gap:1.6em/);
  assert.match(html,/data-action="retry-turn"/);
  assert.match(html,/data-action="recover-turn"/);
});

test('optional pagination displays existing text only and bounds navigation',()=>{
  const b={...branch,turns:[...branch.turns,{id:'t2',prose:'下一天的独立正文',state:{version:2}}]};
  const start=readerView({...args,branch:b,settings:{readingMode:'paged'},page:0});
  assert.match(start,/id="turn-opening"/);
  assert.doesNotMatch(start,/id="turn-t1"|下一天的独立正文/);
  assert.match(start,/data-action="reading-prev"[^>]*disabled/);
  const middle=readerView({...args,branch:b,settings:{readingMode:'paged'},page:1});
  assert.match(middle,/id="turn-t1"/);
  assert.doesNotMatch(middle,/id="turn-opening"|id="turn-t2"/);
  const end=readerView({...args,branch:b,settings:{readingMode:'paged'},page:99});
  assert.match(end,/id="turn-t2"/);
  assert.match(end,/data-action="reading-next"[^>]*disabled/);
  assert.match(end,/翻页只阅读已有内容，不生成新故事/);
  assert.equal(b.turns.length,2);
});

test('table column controls affect presentation without removing public object identity',()=>{
  const html=situationView({situation:{objects:[object]},view:'table',columns:['status']});
  const table=html.match(/<table[\s\S]*?<\/table>/)?.[0];
  assert.match(table,/data-object="person:lin"/);
  assert.match(table,/上次见于店内/);
  assert.doesNotMatch(table,/坐在柜台旁|他人说法/);
  assert.match(html,/name="columns" value="status" checked/);
});

test('related records link only to publicly provided records and label historical snapshots',()=>{
  const html=objectView({object:{...object,relatedIds:['item:watch','secret:unseen']},historical:true,branch,situation:{objects:[object,{id:'item:watch',name:'怀表',kind:'item'}]}});
  assert.match(html,/回看节点当时已知/);
  assert.match(html,/data-object="item:watch"/);
  assert.doesNotMatch(html,/secret:unseen/);
  assert.match(html,/不代表确定的因果/);
});

test('light and dark reading text tokens meet normal-text contrast on supported surfaces',()=>{
  const css=readFileSync(new URL('../src/interface.css',import.meta.url),'utf8');
  const light=css.match(/:root\s*\{([^}]+)\}/)[1];
  const dark=css.match(/body\[data-theme=dark\]\s*\{([^}]+)\}/)[1];
  const luminance=hex=>{const channels=hex.match(/[a-f\d]{2}/gi).map(h=>parseInt(h,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  for(const palette of [light,dark]){
    const colors=Object.fromEntries([...palette.matchAll(/--([\w-]+):(#[a-f\d]{6})/gi)].map(m=>[m[1],m[2]]));
    for(const text of ['ink','muted','accent'])for(const surface of ['bg','paper','soft'])assert.ok(contrast(colors[text],colors[surface])>=4.5,`${text} on ${surface} below 4.5:1`);
  }
});

test('present people need confirmed location evidence from the selected version',()=>{
  const here={...object,certainty:'confirmed',fields:[{key:'location',label:'最后已知位置',value:'钟表铺'}],sourceVersion:4};
  const situation={currentLocation:'钟表铺',currentVersion:4,objects:[here,{...here,id:'person:old',sourceVersion:3},{...here,id:'person:rumor',certainty:'reported'},{...here,id:'person:elsewhere',fields:[{key:'location',value:'码头'}]},{...here,id:'item:here',kind:'item'}]};
  const before=JSON.stringify(situation),html=situationView({situation,filter:'present'});
  assert.match(html,/data-object="person:lin"/);
  assert.doesNotMatch(html,/data-object="person:old"|data-object="person:rumor"|data-object="person:elsewhere"|data-object="item:here"/);
  assert.equal(JSON.stringify(situation),before);
  assert.match(situationView({situation:{objects:[here]},filter:'present'}),/尚未确认符合条件的在场人物；这不表示现场无人/);
});

test('history ranges filter recorded rounds while preserving uncertain time labels',()=>{
  const b={...branch,turns:[branch.turns[0],{id:'t2',prose:'第二段。',experience:{clock:{label:'几天以后'}},state:{version:2}},{id:'t3',prose:'第三段。',state:{version:3}}]};
  const html=historyView({branch:b,fromIndex:2,toIndex:2});
  assert.match(html,/data-action="history-jump"[^>]*data-node="t2"/);
  assert.doesNotMatch(html,/data-action="history-jump"[^>]*data-node="t1"|data-action="history-jump"[^>]*data-node="t3"/);
  assert.match(html,/几天以后/);
  assert.doesNotMatch(html,/\d{4}-\d{2}-\d{2}/);
  assert.match(historyView({branch:b,fromIndex:3,toIndex:1}),/起始回合在结束回合之后/);
  assert.equal((historyView({branch:b,fromIndex:'',toIndex:''}).match(/data-action="history-jump"/g)||[]).length,4);
});

test('time presets only fill a duration; approximate worlds never invent minute precision',()=>{
  const html=timeView({mode:'short',situation:{clock:{precision:'exact'}},control:{forbidden:'不花钱'}});
  for(const duration of ['5分钟','15分钟','30分钟'])assert.match(html,new RegExp(`type="button"[^>]*data-action="time-preset"[^>]*data-duration="${duration}"`));
  assert.doesNotMatch(timeView({mode:'short',situation:{clock:{precision:'approximate'}}}),/data-duration="\d+分钟"/);
  assert.equal((html.match(/type="submit"/g)||[]).length,1);
  assert.match(html,/name="forbidden" value="不花钱"/);
});
