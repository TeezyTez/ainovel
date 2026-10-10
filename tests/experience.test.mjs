import test from 'node:test';
import assert from 'node:assert/strict';
import * as experience from '../src/experience.js';
import { createSession, commitTurn, getBranch, currentState, forkBranch, validateArchive } from '../src/core.js';
import {addAnnotation,resolveReference} from '../src/personal-library.js';

const world = {id:'test',version:1,title:'茶铺',location:'茶铺门前',opening:'雨停了，第一位客人来了。',identity:'店主',rules:[],characters:[{id:'lin',name:'林',public:'邻居',secret:'暗中藏着旧信'}]};
const setup = () => createSession(world);
test('draft and informational language stays outside world actions',()=>{
 for(const input of ['写一份答复草稿','帮我写一份拒绝交易的草稿','拟一份回复，先不要说出口'])assert.equal(experience.detectIntent(input),'phrase',input);
 for(const input of ['如果明天再去呢？','我现在怎么样？','查看小林的资料','这两个有什么区别？','我有多少钱？','这把伞有什么用？'])assert.equal(experience.detectIntent(input),'ask',input);
 for(const input of ['我问他我有多少钱？','我写一份答复交给她','我问他：“如果明天再去呢？”','查看小林的资料，然后去找她'])assert.equal(experience.detectIntent(input),'action',input);
});
test('undo polish retains annotated discarded text as evidence and walks prior expressions',()=>{
  const s=setup();add(s,'看雨','雨已经停了。');const b=getBranch(s),t=b.turns[0],state=structuredClone(t.state);
  experience.applyPolish(s,t.id,'雨丝收住了。',1);experience.applyPolish(s,t.id,'檐边再无雨滴。',1);
  Object.assign(b,addAnnotation(b,{turnId:t.id,quote:'檐边再无雨滴。',note:'喜欢这个写法'}));
  experience.undoPolish(s);assert.equal(b.turns[0].prose,'雨丝收住了。');assert.equal(resolveReference(b,b.personal.notes[0].reference).stale,true);
  const archive={schemaVersion:1,worlds:[world],sessions:[s]};assert.deepEqual(validateArchive(JSON.parse(JSON.stringify(archive))),archive);
  experience.undoPolish(s);assert.equal(b.turns[0].prose,'雨已经停了。');assert.equal(b.turns[0].polishUndoIndex,-1);assert.deepEqual(b.turns[0].state,state);assert.throws(()=>experience.undoPolish(s),/恢复|表达/);
  experience.applyPolish(s,t.id,'天终于放晴。',1);assert.equal(b.turns[0].polishUndoIndex,undefined);experience.undoPolish(s);assert.equal(b.turns[0].prose,'雨已经停了。');assert.doesNotThrow(()=>validateArchive(archive));
  for(const cursor of [-2,999,'0']){const bad=structuredClone(archive);bad.sessions[0].branches[0].turns[0].polishUndoIndex=cursor;assert.throws(()=>validateArchive(bad));}
});
function add(session, input, prose, events=[]) {
  return commitTurn(session,world,input,{requestId:crypto.randomUUID(),baseVersion:currentState(session).version,prose,events,suggestions:[{id:'wait',text:'等一等'}]});
}

test('intent hints route explicit Chinese assistance requests and default other input to action',()=>{
  assert.equal(typeof experience.detectIntent,'function');
  for(const [input,want] of [
    ['如果我拒绝他，会发生什么？','ask'],['假如我离开，会怎样？','ask'],
    ['帮我表达得委婉一点','phrase'],['我不知道该怎么说','phrase'],
    ['请润色上一段，写得简洁一点','polish'],['刚才写错了，请纠正上一轮','repair'],
    ['修改世界设定：这里没有魔法','rewrite'],['我把茶递给她','action'],
    ['我问她：“如果我拒绝，会怎样？”','action'],['我想了想如果拒绝会怎样，还是把信交给他','action'],
    ['替客人润色她写的信，然后递还给她','action'],['修好门口的椅子','action'],['','action']
  ]) assert.equal(experience.detectIntent(input),want,input);
});

test('intent recognizes short hypothetical questions and explicit wording help without swallowing narrated action',()=>{
  for(const [input,want] of [
    ['如果我拒绝呢？','ask'],['帮我把这句话说得委婉一点','phrase'],
    ['帮我想一句回应','phrase'],['我想改写世界设定：这里没有魔法','rewrite'],
    ['如果我拒绝，会怎样？我还是先把信交给她。','action'],
    ['帮我把这句话抄在纸上交给她','action']
  ]) assert.equal(experience.detectIntent(input),want,input);
});

test('intent routes explicit author corrections from the design without rerouting quoted dialogue',()=>{
  for(const [input,want] of [
    ['你写错了，他不知道这个秘密。','repair'],
    ['内容没错，但换种说法。','polish'],
    ['如果我告诉他，会发生什么？','ask'],
    ['把这个世界改成可以复活。','rewrite'],
    ['我对他说：“你写错了，他不知道这个秘密。”','action'],
    ['我告诉她：“内容没错，但换种说法。”','action'],
    ['我拿起笔写下“把这个世界改成可以复活。”','action']
  ]) assert.equal(experience.detectIntent(input),want,input);
});

test('explicit hypothetical risk, impact and outcome questions use assistance without swallowing narration',()=>{
  for(const input of [
    '如果我告诉她，会有什么风险？',
    '假如我告诉她，有什么风险？',
    '要是我离开，会有哪些风险？',
    '如果我拒绝她，会有什么影响？',
    '假设我把信烧掉，会造成什么影响？',
    '如果我接受，会有什么结果？',
    '如果我现在离开，会导致什么后果？',
    '如果我直接进去，风险是什么？',
    '如果我说出真相，结果会是什么？'
  ]) assert.equal(experience.detectIntent(input),'ask',input);
  for(const input of [
    '如果我告诉她有风险，我就陪她一起走。',
    '如果我告诉她，会有什么风险？我还是决定把信递过去。',
    '我问她：“如果我告诉她，会有什么风险？”',
    '“如果我告诉她，会有什么风险？”',
    '如果我见到她，就问她：“会有什么风险？”',
    '如果我见到她，就问她“会有什么风险”？',
    '如果我告诉她，就由我承担后果。',
    '如果我这样说有影响，我会先保持沉默。'
  ]) assert.equal(experience.detectIntent(input),'action',input);
});

test('context retains older relevant prose and public facts without trusting detached memory records',()=>{
  const s=setup(), old=add(s,'问旧事','窗下曾经停着一辆蓝色马车。',[{type:'fact',value:'银色铃铛属于林',visibility:'player'}]);
  for(let i=0;i<14;i++) add(s,'等待','屋里安静。');
  old.memory={sourceTurn:'future',branchId:'sibling',summary:'其他分支未来的秘密',facts:['其他分支未来的秘密']};
  for(const input of ['蓝色马车','银色铃铛']) {
    const context=experience.selectContext(getBranch(s),input);
    assert.ok(context.memory.some(memory=>memory.sourceTurn===old.id));
    assert.doesNotMatch(JSON.stringify(context),/其他分支未来的秘密/);
  }
});

test('recap exposes only committed public fields and preserves unsent direction',()=>{
  assert.equal(typeof experience.publicRecap,'function');
  const s=setup();
  add(s,'询问邻居','她答应明天归还茶杯。',[
    {type:'fact',value:'林答应明天归还茶杯',visibility:'player'},
    {type:'fact',value:'秘密暗号',visibility:'hidden'},
    {type:'relation',entity:'lin',value:'愿意帮忙',visibility:'player'},
    {type:'flag',entity:'test:hidden-plan',value:'幕后计划',visibility:'hidden'}
  ]);
  getBranch(s).draft='先问茶杯的来历';
  currentState(s).threads=[{text:'明天取回茶杯',visibility:'player'},{text:'暗中寻找信件',visibility:'hidden'}];
  const before=JSON.stringify(s), recap=experience.publicRecap(s,world);
  assert.deepEqual(recap,{location:'茶铺门前',time:'故事时间未说明',summary:'她答应明天归还茶杯。',facts:['林答应明天归还茶杯'],relations:{lin:'愿意帮忙'},threads:['明天取回茶杯'],draft:'先问茶杯的来历'});
  assert.doesNotMatch(JSON.stringify(recap),/秘密|幕后|暗中|hidden-plan/);
  assert.equal(JSON.stringify(s),before);
});

test('legacy recap uses frozen opening and last prose without inventing elapsed time',()=>{
  const s=setup();
  assert.equal(experience.publicRecap(s,{...world,opening:'新版开场'}).summary,world.opening);
  assert.deepEqual(experience.publicRecap(s,world).threads,[]);
  add(s,'等候','茶'.repeat(400));
  s.updatedAt=0;
  assert.equal(experience.publicRecap(s,world).summary,'茶'.repeat(300));
  assert.equal(experience.publicRecap(s,world).time,'故事时间未说明');
});

test('context recalls an older relevant public event and keeps only latest six raw turns',()=>{
  assert.equal(typeof experience.selectContext,'function');
  const s=setup(), old=add(s,'收下信物','邻居把一件信物交给你。',[{type:'item-add',value:'梅花钥匙',visibility:'player'},{type:'fact',value:'密室密码',visibility:'hidden'}]);
  for(let i=0;i<20;i++) add(s,`沏第${i}杯茶`,`客人喝完第${i}杯茶。`);
  const branch=getBranch(s), before=JSON.stringify(branch), context=experience.selectContext(branch,'我要查看梅花钥匙');
  assert.ok(context.memory.length<=12);
  const remembered=context.memory.find(m=>m.sourceTurn===old.id);
  assert.ok(remembered);
  assert.ok(remembered.events.some(e=>e.value==='梅花钥匙'));
  assert.doesNotMatch(JSON.stringify(context),/密室密码/);
  assert.deepEqual(context.recent,branch.turns.slice(-6).map(t=>({input:t.input,prose:t.prose})));
  assert.equal(JSON.stringify(branch),before);
});

test('context never reads sibling or future turns after a fork at an old node',()=>{
  const s=setup(), old=add(s,'开门','邻居进门。');
  add(s,'打开盒子','你发现未来地图。',[{type:'fact',value:'未来地图',visibility:'player'}]);
  forkBranch(s,old.id,'另一种可能');
  const context=experience.selectContext(getBranch(s),'未来地图');
  assert.doesNotMatch(JSON.stringify(context),/未来地图/);
  assert.ok(context.memory.every(m=>m.branchId===s.activeBranch));
});

test('polish updates last prose and memory while preserving authoritative turn fields',()=>{
  assert.equal(typeof experience.applyPolish,'function');
  const s=setup(), turn=add(s,'递出茶杯','她接过茶杯。',[{type:'fact',value:'茶杯已交给林',visibility:'player'}]);
  const before=structuredClone(turn);
  experience.applyPolish(s,turn.id,'她双手接过温热的茶杯。',1);
  assert.equal(turn.prose,'她双手接过温热的茶杯。');
  assert.equal(turn.memory.summary,'她双手接过温热的茶杯。');
  for(const key of ['state','events','input','suggestions','id','requestId','ended']) assert.deepEqual(turn[key],before[key],key);
  assert.equal(turn.revisions[0].prose,before.prose);
  assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[s]}));
});

test('polish rejects old targets, stale state, empty and oversized text without mutation',()=>{
  const s=setup(), first=add(s,'开门','门开了。'), last=add(s,'问好','她点头。');
  for(const [id,text,version] of [[first.id,'别的文字',2],[last.id,'别的文字',1],[last.id,' ',2],[last.id,'字'.repeat(20001),2]]) {
    const before=JSON.stringify(s);
    assert.throws(()=>experience.applyPolish(s,id,text,version),/最后|状态|正文/);
    assert.equal(JSON.stringify(s),before);
  }
});

test('repair replaces last result on a marked branch from preceding state and preserves original',()=>{
  assert.equal(typeof experience.applyRepair,'function');
  const s=setup(), first=add(s,'问好','她向你点头。');
  const wrong=add(s,'收下信物','她给了你一把钥匙。',[{type:'item-add',value:'钥匙',visibility:'player'},{type:'fact',value:'原结果独有事实',visibility:'player'}]);
  const original=getBranch(s), originalJson=JSON.stringify(original);
  const repaired=experience.applyRepair(s,world,{requestId:'repair-1',baseVersion:1,prose:'她把茶杯交给你。',events:[{type:'item-add',value:'茶杯',visibility:'player'}]},'信物应该是茶杯',original.id,2);
  assert.equal(JSON.stringify(original),originalJson);
  assert.equal(repaired.parentTurn,first.id);
  assert.equal(repaired.parentBranch,original.id);
  assert.equal(repaired.turns.at(-1).input,wrong.input);
  assert.deepEqual(currentState(s).inventory,['茶杯']);
  assert.deepEqual(currentState(s).facts,[]);
  assert.equal(repaired.correction.sourceTurn,wrong.id);
  assert.equal(repaired.correction.reason,'信物应该是茶杯');
  assert.doesNotMatch(JSON.stringify(experience.selectContext(repaired,'原结果独有事实')),/原结果独有事实/);
  assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[s]}));
});

test('first-turn repair forks from opening',()=>{
  const s=setup(); add(s,'询问','错误的回答。');
  const b=experience.applyRepair(s,world,{requestId:'repair-first',baseVersion:0,prose:'修正的回答。',events:[]},'回答与设定不符',s.activeBranch,1);
  assert.equal(b.parentTurn,null);
  assert.equal(b.turns.length,1);
  assert.equal(currentState(s).step,1);
});

test('repair validates source version, branch, duplicate request, reason and events before forking',()=>{
  const s=setup(); add(s,'开门','门开了。'); add(s,'询问','错误的回答。');
  const valid={requestId:'repair-valid',baseVersion:1,prose:'修正的回答。',events:[]};
  for(const [proposal,reason,branch,version] of [
    [{...valid,baseVersion:2},'纠错',s.activeBranch,2],
    [valid,'纠错',s.activeBranch,1], [valid,'纠错','other',2],
    [{...valid,requestId:getBranch(s).turns[0].requestId},'纠错',s.activeBranch,2],
    [{...valid,events:[{type:'relation',entity:'missing',value:'朋友',visibility:'player'}]},'纠错',s.activeBranch,2],
    [valid,'',s.activeBranch,2]
  ]) {
    const before=JSON.stringify(s);
    assert.throws(()=>experience.applyRepair(s,world,proposal,reason,branch,version),/状态|分支|重复|理由|人物/);
    assert.equal(JSON.stringify(s),before);
  }
});
