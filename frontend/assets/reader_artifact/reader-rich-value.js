import {validateRichView} from './rich-interaction.js';

// A literal display carried by a committed fact. Never evaluate expressions,
// infer chart numbers, or interpret ordinary prose as a display specification.
export function richValue(value) {
  if (typeof value !== 'string' || !value.trimStart().startsWith('{')) return null;
  let envelope;
  try { envelope = JSON.parse(value); } catch { return null; }
  if (envelope?.format !== 'elselife-rich-view') return null;
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  check(value.length <= 64000, '作品视图不能超过 64000 字符。');
  check(envelope.version === 1 && Object.keys(envelope).every(k => ['format', 'version', 'views'].includes(k)), '作品视图版本或字段不受支持。');
  check(Array.isArray(envelope.views) && envelope.views.length > 0 && envelope.views.length <= 8, '作品需要 1 至 8 个视图。');
  let count = 0;
  function literal(v, depth = 0) {
    check(depth <= 10 && ++count <= 6000, '作品数据过于复杂。');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { check(v.length <= 2000, '作品文字过长。'); return; }
    if (typeof v === 'number') { check(Number.isFinite(v) && Math.abs(v) <= 1e12, '作品需要有限数值。'); return; }
    if (Array.isArray(v)) { v.forEach(x => literal(x, depth + 1)); return; }
    check(v && typeof v === 'object', '作品数据无效。');
    for (const [k, x] of Object.entries(v)) {
      check(!['op', 'when', '__proto__', 'prototype', 'constructor'].includes(k), '作品只接受已记录的静态数据。');
      literal(x, depth + 1);
    }
  }
  literal(envelope.views);
  for (const view of envelope.views) {
    check(['table', 'chart', 'diagram', 'cards', 'timeline', 'illustration'].includes(view?.type), '此记录不是静态作品视图。');
    validateRichView(view, {check, verify: v => literal(v)});
  }
  return envelope.views;
}
