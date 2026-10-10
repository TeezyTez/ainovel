import {requestsRest,sceneDirection} from './scene-direction.mjs';
// Original, transferable craft operations. These are tools, never world facts.
export const STORY_METHODS = Object.freeze([
  {id:'earned-payoff',applicability:'读者已等待结果，尤其多轮未更新的期待。',operation:'让已铺垫的行动在本轮产生可见答案或成果；承认有效方法，留下胜利的实际用途。',failureModes:'不要靠新谜团撤销答案，不把微小线索冒充兑现，不制造临时门槛。'},
  {id:'consequence-chain',applicability:'玩家已经采取具体行动，结果尚未进入生活。',operation:'承接行动对象与方法，给出可信结果，再让结果改变人物可做的下一件事。',failureModes:'不要偷换目标，不替玩家承诺新代价，不让成功立即归零。'},
  {id:'independent-choice',applicability:'人物有自己的目标，或玩家在观察、等待。',operation:'让一个已有角色依其知识与动机作决定，付诸行动；让玩家看见决定改变了什么。',failureModes:'不要读玩家内心，不把所有人物变成任务发布器，不强迫玩家接受邀约。'},
  {id:'evidence-reframe',applicability:'已有可见证据允许另一种解释，且不违背固定真相。',operation:'重新组合两件已有事实，揭示人物目标或因果上的差异；立即展示一个可验证后果。',failureModes:'不能改写谜底，不能靠新秘密补洞，不能每轮反转或让NPC无因反常。'},
  {id:'quiet-aftermath',applicability:'刚兑现、玩家要求休息或拒绝机会、故事需要安静收束。',operation:'让成果进入日常：物品被使用、关系以行动改变、人物完成小事；允许本段结束。',failureModes:'不要以危机惩罚休息，不将拒绝改写为犹豫，不在收尾强塞新悬念。'},
  {id:'bounded-promise',applicability:'确需新方向且尚有期待容量，没有更迫切的旧期待。',operation:'只提出一个具体可理解的目标，说明人物为何在意，并在本轮给出真实的第一步。',failureModes:'不要堆新专名和谜语，不用宏大空话代替进展，不把未来候选记为事实。'},
  {id:'relationship-proof',applicability:'人物关系是当前场景的核心，语言需要行动佐证。',operation:'让角色通过一个有成本但符合动机的小决定表达关系变化，并使双方看到实际差别。',failureModes:'不要无因倾心、强制亲密或代替玩家表态，不把关系仅记为数值。'}
]);

export function narrativeNeeds(body) {
  const threads=body.narrative?.threads||[], beats=body.narrative?.recentBeats||[];
  const active=threads.filter(t=>['open','progressed'].includes(t.status));
  return {overdue:active.filter(t=>body.state.version-t.updatedAt>=3||body.state.version-t.openedAt>=5).sort((a,b)=>a.openedAt-b.openedAt||a.updatedAt-b.updatedAt),
    activeCount:active.length,restRequested:requestsRest(body.input),
    afterPayoff:beats.at(-1)?.kind==='payoff',recentMethods:beats.map(b=>b.methodId),
    maxNewThreads:sceneDirection(body).maxNewThreads};
}

export function selectStoryMethods(body) {
  const needs=narrativeNeeds(body);
  const weights={'earned-payoff':needs.overdue.length?12:needs.activeCount?5:0,'consequence-chain':6,
    'independent-choice':4,'evidence-reframe':(body.state.facts?.length||0)>=2?3:0,
    'quiet-aftermath':needs.restRequested?22:needs.afterPayoff?3:2,
    'bounded-promise':needs.activeCount===0?4:0,'relationship-proof':2};
  for(const id of needs.recentMethods)if(id in weights)weights[id]-=5;
  return [...STORY_METHODS].sort((a,b)=>weights[b.id]-weights[a.id]).slice(0,3);
}
