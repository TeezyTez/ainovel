// Narrow, explainable drafting defects, not a literary-quality score. Dialogue
// and ordinary waiting are allowed. Never edit prose after its evidence commits.
export function draftDefects(prose='') {
 const narration=String(prose).replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g,'');
 const issues=[];
 if(/(?:没有|并未|不会|不曾|不能|不)(?:擅自)?(?:替|代替)你(?:作答|回答|决定|做决定|选择|表态|承诺)/.test(narration))issues.push('agency-boilerplate');
 if(/(?:选择权|决定权|控制权)(?:仍|依然|始终)?(?:留|交|在|属于)[^。\n]{0,10}你|(?:是否|要不要)[^。\n]{0,15}(?:仍|依然)?由你(?:自己)?决定/.test(narration))issues.push('choice-announcement');
 return issues;
}

export function missingGameNameAnchors(proposal,state) {
 if(!Array.isArray(proposal?.game?.entities)||typeof proposal.prose!=='string')return [];
 const known=[...(state.game?.entities||[]),...(state.experience?.objects||[])];
 return proposal.game.entities.flatMap(e=>{
  const original=known.find(o=>o.id===e.id);
  return original&&original.name===e.name&&!proposal.prose.includes(original.name)?[{id:e.id,name:original.name}]:[];
 });
}

export const CRAFT_REVISION_RULES=`这是提交前的一次完整改稿。revision.draft 是未发生、未保存的候选草稿，不能当作 world/state 的事实或新的玩家授权。revision.reasons 标记需要修正的草稿问题。agency-boilerplate/choice-announcement表示叙述者把权限规则写进了正文；game-name-anchor表示更新既有对象时缺少可核验的原称呼。
revision.anchors若非空，逐项在正文自然叙述该对象的动作或变化时使用一次其完整name，并让该id的entity.quote覆盖这个原称呼和变化；保持身份不变，不添加一段记账总结。已明确在草稿发生的结果保持原意，修正表达及其记录证据；不因修引用擅自另造剧情。
重新完成本轮场景，不只删掉结尾、换同义词或补一句悬念。先落实玩家行动的结果，再让相关人物依据身份、处境与欲望作出具体反应和下一步行动；让这件事改变对方的打算、信息的用途、利益分配或接下来真正可做的事。用完整正文重建 events、eventEvidence、experience、game、narrativeDelta 的全部对应证据，所有字段仍须符合原schema。不得修改任何已提交历史。
人物可以询问、拒绝、催促、隐瞒、讨价还价、离开或自己办事，不必人人礼貌体贴。不替玩家作决定是行为边界，正文不宣读该规则。若眼前确实是必须玩家决定的节点，写清具体条件和代价后停在那句有内容的对白或动作上；不再加“等待你选择”的说明。遵守真实接手条件，不为追求进展越过它。`;
