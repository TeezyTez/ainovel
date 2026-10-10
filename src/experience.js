
import { clone, getBranch, currentState, worldKey, validateProposal, forkBranch, commitTurn } from './core.js';
import {publicSituation} from './experience-state.js';
import {interactionQuery} from './interaction-context.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const string = value => typeof value === 'string' ? value : '';

// This is a conservative UI hint. The visible mode can always override it.
export function detectIntent(input) {
  const value = string(input).trim();
  if(interactionQuery(value))return 'ask';
  if(/^(?:我(?:现在|目前)?有多少钱|这(?:个|把|件|两件|两个)[^。！？!?“”「」\n]{0,40}(?:多少钱|是什么|有什么用|有何区别))[？?]?$/.test(value))return 'ask';
  if(/^(?:请)?(?:帮我)?(?:写|拟)(?:一份|一段|个)?[^。！？“”「」\n]*(?:草稿|先不要说出口)[。！]?$/u.test(value))return 'phrase';
  if(/^(?:如果|假如|假设|要是)[^。！？!?“”「」\n]*(?:呢|会怎样|会怎么样|有什么风险)[？?]?$/.test(value)||/^(?:这两个|这两项|这个)(?:有什么区别|意味着什么|是什么|有什么风险)[？?]?$/.test(value))return 'ask';
  if (/^(?:请|我想)?(?:帮我)?(?:修改|改写|重写)(?:一下)?(?:世界|人物|角色|故事)设定/.test(value)
    || /^(?:请)?把(?:这个|当前)?世界(?:设定)?改成/.test(value)) return 'rewrite';
  if (/^(?:请)?(?:帮我)?(?:润色|改写表达|优化文笔)(?:一下)?(?:上一段|上段|上一轮|这段|正文|文字|[，,:：。\s]|$)/.test(value)
    || /^内容(?:没错|不变)[，,\s]*(?:但|只是|请)?换种(?:说法|写法)/.test(value)) return 'polish';
  if (/^(?:请)?(?:帮我)?(?:纠正|修正|纠错)(?:一下)?(?:上一轮|上轮|刚才|错误|[，,:：。\s]|$)/.test(value)
    || /^(?:刚才|上一轮|上段)(?:写错了|有误|不对|出错了)(?:[，,:：。\s]|$)/.test(value)
    || /^你(?:刚才)?写错了(?:[，,:：。\s]|$)/.test(value)) return 'repair';
  if (/^(?:请)?帮我(?:表达|组织语言|想想怎么说|说得|写一句|想一句回应)/.test(value)
    || /^(?:请)?帮我把(?:这句话|这段话)(?:说|写)得/.test(value)
    || /^我(?:不知道|不知)(?:该)?怎么(?:说|表达)/.test(value)) return 'phrase';
  // Whole-input questions only: quoted dialogue and a following action stay actions.
  if (/^(?:如果|假如|假设|要是)我[^。！!？?\n“”「」『』"‘’']*(?:会怎样|会怎么样|会发生什么|(?:会)?(?:有|造成|带来|导致)(?:什么|哪些)(?:风险|影响|后果|结果)|(?:风险|影响|后果|结果)(?:会)?是什么|可以吗|呢)[？?]?$/.test(value)) return 'ask';
  return 'action';
}

export function publicRecap(session, world) {
  const branch = getBranch(session), state = currentState(session);
  const threads = Array.isArray(state.threads) ? state.threads : [];
  return {
    location: string(state.location),
    time: publicSituation(branch,world).clock.label,
    summary: string(branch.turns.at(-1)?.prose ?? branch.opening ?? world.opening).slice(0, 300),
    facts: (state.facts || []).filter(value => typeof value === 'string'),
    relations: Object.fromEntries(Object.entries(state.relations || {}).filter(([, value]) => typeof value === 'string')),
    threads: threads.filter(thread => thread?.visibility === 'player' && typeof thread.text === 'string').map(thread => thread.text),
    draft: string(branch.draft)
  };
}

function publicMemory(turn, branchId) {
  // Rebuild from this branch's actual turns; never follow outside memory links.
  const events = (turn.events || [])
    .filter(event => event.visibility === 'player' && event.type !== 'flag')
    .map(event => ({type:event.type, ...(event.entity ? {entity:event.entity} : {}), value:event.value,
      visibility:'player', sourceTurn:turn.id, branchId}));
  return {sourceTurn:turn.id, branchId, summary:string(turn.prose).slice(0, 240),
    facts:events.filter(event => event.type === 'fact').map(event => event.value), events};
}

function terms(input) {
  const tokens = string(input).toLocaleLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) || [];
  return [...new Set(tokens.flatMap(token => /\p{Script=Han}/u.test(token)
    ? Array.from({length:Math.max(0, token.length - 1)}, (_, index) => token.slice(index, index + 2))
    : [token]))];
}

export function selectContext(branch, input) {
  const turns = branch.turns || [], query = terms(input);
  const memories = turns.map(turn => publicMemory(turn, branch.id));
  const recentStart = Math.max(0, turns.length - 6);
  const older = memories.slice(0, recentStart).map((memory, index) => {
    const evidence = memory.events.map(event => string(event.value)).join(' ').toLocaleLowerCase();
    const prose = memory.summary.toLocaleLowerCase();
    const score = query.reduce((sum, term) => sum + (evidence.includes(term) ? 3 : 0) + (prose.includes(term) ? 1 : 0), 0);
    return {index, score};
  });
  older.sort((a, b) => b.score - a.score || b.index - a.index);
  const selected = [...older.slice(0, 6).map(item => item.index), ...turns.slice(recentStart).map((_, index) => recentStart + index)].sort((a, b) => a - b);
  return {memory:selected.map(index => memories[index]), recent:turns.slice(-6).map(turn => ({input:turn.input, prose:turn.prose}))};
}

export function applyPolish(session, turnId, text, expectedVersion) {
  const branch = getBranch(session), turn = branch.turns.at(-1);
  assert(turn && turn.id === turnId, '只能润色当前分支的最后一轮。');
  assert(currentState(session).version === expectedVersion, '故事状态已改变，润色结果未写入。');
  assert(typeof text === 'string' && text.trim() && text.length <= 20000, '润色正文无效或过长。');
  const now = Date.now();
  turn.revisions = [...(turn.revisions || []), {prose:turn.prose, createdAt:now}];
  delete turn.polishUndoIndex;
  turn.prose = text;
  turn.memory.summary = text.slice(0, 240);
  session.updatedAt = now;
  return turn;
}

export function undoPolish(session) {
  const turn=getBranch(session)?.turns.at(-1),revisions=turn?.revisions||[];
  const index=turn?.polishUndoIndex??(revisions.length-1);
  assert(turn&&Number.isInteger(index)&&index>=0&&index<revisions.length,'没有可以恢复的表达版本。');
  const previous=revisions[index].prose,now=Date.now();
  // Keep the discarded wording as a witness for notes, selections and original
  // narrative/experience evidence; moving a cursor must never erase sources.
  if(!revisions.some(r=>r.prose===turn.prose)){
    assert(revisions.length<10000,'表达版本已达保存上限，未撤销或丢弃原文。');
    turn.revisions=[...revisions,{prose:turn.prose,createdAt:now}];
  }
  turn.prose=previous;turn.memory.summary=previous.slice(0,240);
  turn.polishUndoIndex=index-1;session.updatedAt=now;
  return turn;
}

export function applyRepair(session, world, proposal, reason, expectedBranch, expectedVersion) {
  assert(session.activeBranch === expectedBranch, '你已切换分支，纠错结果未写入。');
  const branch = getBranch(session), last = branch.turns.at(-1);
  assert(last, '当前分支还没有可纠错的回合。');
  assert(currentState(session).version === expectedVersion, '故事状态已改变，纠错结果未写入。');
  assert(branch.worldKey === worldKey(world), '世界版本不匹配。');
  assert(typeof reason === 'string' && reason.trim() && reason.length <= 2000, '请填写有效的纠错理由。');
  const previous = branch.turns.at(-2);
  validateProposal(proposal, world, previous?.state || branch.initialState);
  assert(!branch.turns.some(turn => turn.requestId === proposal.requestId), '这个请求已经提交，不能重复纠错。');

  // Stage the full operation so even a downstream commit failure leaves the source intact.
  const staged = clone(session);
  const repaired = forkBranch(staged, previous?.id || null, '系统纠错');
  repaired.correction = {sourceBranch:branch.id, sourceTurn:last.id, reason:reason.trim(), createdAt:Date.now()};
  commitTurn(staged, world, last.input, proposal, repaired.id);
  repaired.draft = branch.draft || '';
  session.branches.push(repaired);
  session.activeBranch = repaired.id;
  session.updatedAt = staged.updatedAt;
  return repaired;
}
