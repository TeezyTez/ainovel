import {draftDefects} from './narrative-craft.mjs';
// Derived from committed records on every request. No new world facts or saved plans.
export function requestsRest(input='') {
  const own=String(input).replace(/[“「『"].*?[”」』"]/g,'');
  if(/[?？]|(?:不|别|不要|不想|不能|不用|无需)(?:再|去|先)?(?:休息|歇|睡|收工|结束)/.test(own))return false;
  return /(?:^|[，。；,;]|我)(?:我)?(?:先|想|要|打算|决定)?(?:回家|到[^，。；,;]{1,12}|去)?(?:休息|歇一会|睡觉|收工)(?:一下|一会儿?|了)?[。！!\s]*$/.test(own.trim())||/^(?:结束|结束故事|到此为止)[。！!\s]*$/.test(own.trim());
}
const activeThreads=body=>(body.narrative?.threads||[]).filter(t=>['open','progressed'].includes(t.status));
export function sceneDirection(body) {
  const active=activeThreads(body),beats=body.narrative?.recentBeats||[];
  const due=active.filter(t=>body.state.version-t.updatedAt>=3||body.state.version-t.openedAt>=5).sort((a,b)=>a.openedAt-b.openedAt);
  const recentOutcomes=beats.slice(-4).map(b=>String(b.summary||'').slice(0,240)).filter(Boolean);
  const sincePayoff=[];
  for(const beat of [...beats].reverse()){if(['payoff','aftermath','rest'].includes(beat.kind))break;sincePayoff.push(beat);}
  return {mode:requestsRest(body.input)?'rest':due.length||sincePayoff.length>=2?'deliver':beats.at(-1)?.kind==='payoff'?'consequence':'develop',
    payoffThreadIds:due.slice(0,3).map(t=>t.id),maxNewThreads:due.length||active.length>=3?0:1,
    recentOutcomes,unit:'一次有结果的场景；普通过渡合并，重要选择之前停下'};
}
const normalized=value=>String(value||'').replace(/[\p{P}\p{Z}\s]/gu,'');
function repeats(payoff,body) {
  const next=normalized(payoff);if(next.length<6)return false;
  const prior=[...(body.narrative?.recentBeats||[]).slice(-4).map(b=>b.summary),...(body.recent||[]).slice(-3).map(t=>t.prose||'')];
  // Only literal substantial repetitions; this does not claim to judge literary quality.
  return prior.some(value=>normalized(value).includes(next));
}
export function scenePriority(scene,body) {
  const d=sceneDirection(body);
  return (d.mode==='rest'&&['rest','aftermath'].includes(scene.kind)?1000:0)
    +(d.payoffThreadIds.includes(scene.threadId)?40:0)
    +(scene.kind==='payoff'?20:scene.kind==='progress'?10:0)
    -(draftDefects(scene.payoff).length?80:0)
    -(repeats(scene.payoff,body)?100:0);
}

export const SCENE_WRITING_RULES=`
你写的是让读者愿意往下读的小说场景。世界题材、玩家想体验的事和人物当前所求共同决定这一幕的重心；不要把惊险世界写成反复核对安全须知，把能力体验写成无止境的小幅测试，把关系戏写成所有人一味体贴。既有失败有因果约束，但未知上限不是新的永久禁令；人物也不必总是礼貌、温柔或客观说明情况。
尊重玩家的决定通过不越权来实现，不通过旁白反复宣读“没有替你作答／没有要求你跟上／你尚未接受邀请”。没有催促、不妨碍、退开、等你开口本身不是剧情成果。NPC可以按自己的身份与利益质疑、抢话、争执、谈条件或做事；不可替玩家回答，但普通一句问话不必冻结所有人的行动。重要选择到来时停在具体的条件、动作或对白上，省掉解释玩家仍可选择的尾巴。只在误解会影响当前情节时澄清边界，不逐轮复述。
构思时先抓住这一幕人物想要的东西、与谁的打算相冲突，以及玩家的举动怎样改变这件事。成果不只“发现了信息”，还包括信息改变了谁的判断或行动；人物反应不只复述刚发生的奇观。选择一条已有因果往前写到一个可感知的结果，再让结果带出余味或期待。不靠凭空警报、新敌人、临时秘密强行制造刺激；安静场景也可以让一件旧事终于说清，让一个具体愿望得到满足。
正文先服务阅读：用动作、对话和具体后果把变化写清，直接引用这些原句作为结构化记录的证据；不要为方便校验，紧接一段对话再写一遍‘某人带回答复：……’或‘某事已经完成：……’的记账式总结。回报通过场景发生，不靠旁白宣布‘你现在知道了什么’。
以有结果的场景作为推进单位。普通走路、开门、打招呼、等人、反复检查同一处合并叙述；玩家授权去一个目的地时，本轮通常抵达并经历到场后的第一件有意义的事，不能每走几步就要求再次输入。危险判断、明确要求的逐步探索、control接手条件和重要代价仍先停，绝不为加速越权。
每轮形成“当前欲望或问题→人物主动采取办法→局势发生具体改变→影响下一步”的因果链。信息要回答一个问题或改变判断；奖励要有实际用途；关系变化要体现在对方的选择中。拿到一点消息却仍只能做上一轮同一件事，通常不算场景推进。阻碍可以成立，但应暴露原因、可选办法或真实取舍，不能用无止境的‘再确认’拖延。
direction为服务端从已提交记录推导的节奏提示，不是世界事实或新授权。mode=deliver时优先回答payoffThreadIds里的旧问题，别把再得到一个模糊线索冒充兑现；consequence让成果产生用途和人物反应；rest尊重休息并保留成果；develop推动当前冲突。recentOutcomes里的结果不能换措辞重演。信息差、能力奏效、关系拉近或破裂、有得有失的选择、旧伏笔回响都能产生阅读动力；按题材和人物轮换，不强制每轮危险、反转、奖励或悬崖结尾。先交付当前满足，再留下由后果自然产生的期待；不扣住所有答案索取下一次输入。`;
