// Narrative records guide writing; only core events change authoritative state.
const assert = (ok, message) => { if (!ok) throw new Error(`叙事记录无效：${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, fields) => {
  assert(object(value), '需要对象。');
  assert(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), '字段不完整或包含未知字段。');
};
const text = (value, max=2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const world = value => typeof value === 'string' && value.length <= 220 && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}@[1-9][0-9]*$/.test(value);
const turnNumber = value => Number.isSafeInteger(value) && value > 0;
const terminal = status => status === 'resolved' || status === 'retired';
const kinds = ['setup','progress','payoff','aftermath','rest'];
const threadFields = ['id','question','stakes','status','evidence'];
function validateThread(value, snapshotTurn) {
  keys(value, snapshotTurn === undefined ? threadFields : [...threadFields,'openedAt','updatedAt']);
  assert(id(value.id) && text(value.question) && text(value.stakes) && text(value.evidence), '期待的标识、问题、意义或正文证据无效。');
  assert(['open','progressed','resolved','retired'].includes(value.status), '期待状态无效。');
  if (snapshotTurn !== undefined) assert(turnNumber(value.openedAt) && turnNumber(value.updatedAt) && value.openedAt <= value.updatedAt && value.updatedAt <= snapshotTurn, '期待的回合范围无效。');
}
function validateBeat(value, snapshot=false) {
  keys(value, snapshot ? ['turn','kind','summary','methodId'] : ['kind','summary','methodId']);
  assert(kinds.includes(value.kind) && text(value.summary) && id(value.methodId), '场景进展无效。');
}
function validateOpportunities(values) {
  assert(Array.isArray(values) && values.length <= 3, '未来候选最多三项。');
  const seen = new Set();
  for (const value of values) {
    keys(value,['id','condition','idea']);
    assert(id(value.id) && !seen.has(value.id) && text(value.condition) && text(value.idea), '未来候选字段无效或标识重复。');
    seen.add(value.id);
  }
}
export function validateNarrative(value, expectedTurn, expectedWorldKey) {
  keys(value,['schemaVersion','worldKey','turn','focus','threads','recentBeats','opportunities']);
  assert(value.schemaVersion === 1 && world(value.worldKey) && turnNumber(value.turn) && text(value.focus,500), '版本、世界、回合或焦点无效。');
  if (expectedTurn !== undefined) assert(value.turn === expectedTurn, '回合不匹配。');
  if (expectedWorldKey !== undefined) assert(value.worldKey === expectedWorldKey, '世界版本不匹配。');
  assert(Array.isArray(value.threads) && value.threads.length <= 8, '期待最多八项。');
  const seen = new Set();
  for (const item of value.threads) { validateThread(item,value.turn); assert(!seen.has(item.id),'期待标识重复。'); seen.add(item.id); }
  assert(Array.isArray(value.recentBeats) && value.recentBeats.length >= 1 && value.recentBeats.length <= 6, '近期进展需要一至六项。');
  let last = 0;
  for (const beat of value.recentBeats) {
    validateBeat(beat,true);
    assert(turnNumber(beat.turn) && beat.turn > last && beat.turn <= value.turn, '近期进展的回合无效。');
    last = beat.turn;
  }
  assert(last === value.turn, '缺少本轮进展。');
  validateOpportunities(value.opportunities);
  return value;
}
export function advanceNarrative(previous, delta, prose, nextTurn, worldKey) {
  assert(turnNumber(nextTurn) && world(worldKey) && text(prose,20000), '下一回合、世界或正文无效。');
  if (previous !== null && previous !== undefined) validateNarrative(previous,nextTurn-1,worldKey);
  keys(delta,['focus','beat','threads','opportunities']);
  assert(text(delta.focus,500), '场景焦点无效。');
  validateBeat(delta.beat);
  validateOpportunities(delta.opportunities);
  assert(Array.isArray(delta.threads) && delta.threads.length <= 3, '单轮最多更新三项期待。');
  const threads = structuredClone(previous?.threads ?? []), seen = new Set();
  for (const update of delta.threads) {
    validateThread(update);
    assert(!seen.has(update.id), '本轮期待标识重复。'); seen.add(update.id);
    assert(prose.includes(update.evidence), '期待更新缺少正文中的精确证据。');
    const existing = threads.find(item => item.id === update.id);
    if (existing) {
      assert(!terminal(existing.status), '已解决或退役的期待不能再次更新。');
      assert(existing.question === update.question && existing.stakes === update.stakes, '已有期待的问题和意义不能替换。');
      Object.assign(existing,update,{updatedAt:nextTurn});
    } else {
      assert(!terminal(update.status), '新增期待必须仍然开放。');
      threads.push({...update,openedAt:nextTurn,updatedAt:nextTurn});
    }
  }
  // Keep this turn's resolutions visible; otherwise a snapshot could hide the
  // evidence that an active expectation was resolved before its removal.
  const removable = threads.filter(item => terminal(item.status) && item.updatedAt < nextTurn)
    .sort((a,b) => a.updatedAt-b.updatedAt || a.openedAt-b.openedAt);
  while (threads.length > 8) {
    const oldest = removable.shift();
    assert(oldest, '期待已满，请先兑现或退役已有期待，下一轮再新增。');
    threads.splice(threads.findIndex(item => item.id === oldest.id),1);
  }
  return validateNarrative({schemaVersion:1,worldKey,turn:nextTurn,focus:delta.focus,threads,
    recentBeats:[...structuredClone(previous?.recentBeats ?? []),{turn:nextTurn,...delta.beat}].slice(-6),
    opportunities:structuredClone(delta.opportunities)},nextTurn,worldKey);
}
export function narrativeForBranch(branch) {
  const latest = branch?.turns?.at(-1);
  if (latest?.narrative === undefined || latest.narrative?.worldKey !== branch.worldKey) return null;
  return structuredClone(validateNarrative(latest.narrative,latest.state.version,branch.worldKey));
}
