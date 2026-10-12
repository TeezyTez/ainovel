// The schema carries field shapes; these rules carry their narrative semantics.
export const GAME_WRITING_RULES = `世界连续存在：先读state.game与地点事实，保持区域/建筑/楼层、当前位置、方位、道路和障碍一致。新空间事实自然融入行动；不瞬移、不泄露未探索地理、不附测绘清单。
game.spatial为持久地理增量，无新资料用null。sites的id复用place，parentId引用其所属区域/建筑；城市、建筑、房间分层。地物符号不是精确边界。relations中relative表示to相对from的方位（北向上），只能同层；distanceMeters只记正文阿拉伯数字明确的直线米数，未知null，不把路程或时间当测距；relative的passage=unknown、bidirectional=false。route表示真实道路/门/桥，bearing通常null，distanceMeters可为明确路长；passage记实际通行状态，bidirectional仅明确可双向时true。相邻、隔河对望不自动连路。每条quote取本轮连续原句，包含完整地点名，支持归属/方向/测距/通行变化；只有名字不支持方向。稳定id；旧方位、测距、归属不得改写，封锁/开放可有据更新。不凭空造数字，也不重复登记未变地理。

game.journeys无新行程资料用null。routes是有据的路线报价增量：from/to/via引用place，费用引用已知meter/item。quote含起终点全名、label及阿拉伯数字分钟/费用；未知分钟两项null。includesWaiting指总耗时已含等候。状态或时刻变化后按原id重新核对，不改其起终点；未知班次不保证抵达时间。路线应有实质不同的地点、人物、耗时或费用，勿拆微动作。地图查看不接约、不交物。
gameActionReceipt.mode=journey是所选路线和费用上限，尚未结算。正常路途一段抵达，真有中断则停在实际位置；提交journeys.transit记录实际停点、完成与否、分钟、已付费用，quote逐字支持地点、数字分钟及付款。完成时分钟在报价范围、费用等于报价；中途不得超预算。experience.clock写实际时刻，elapsed写“数字分钟”。不额外购买、交物、收款或接约，保留物品所有者/保管者；余额与实付一致。自由复合input则逐项落实其已授权行动，同步物品保管、位置、数量；未发草稿不是行动。

正文与人物因果优先；主动判断读者需要地图/状态/物品/线索/时间线/人物/对照，相关时显示，勿机械按关键词弹卡。surfaces按帮助程度排序，通常0至2张、最多3张；description不复述正文。不为UI创造伤势、倒计时、通用RPG数值、任务或奖励。地图行动尺度是有独立人物、目标或冲突的场景，不把门口/柜台拆关卡。推荐路线写可见吸引点与不同取舍，选择后同轮推进该处事件，途中障碍仍生效；回访承接结果，不重播初见。未选路线未发生，不预告秘密或保证奖励。suggestions最多2至3个后果不同的选项，可为空。
entities只增量登记公开对象，沿用game/experience同一id/name，kind不变；name及状态须有本轮逐字quote。没变化且未提及只引用id，不加记账段。value/max未知null，明确数值及配方用量用阿拉伯数字，有真实上限才写max，不造100/0；计划、秘密、未取得物品不能记已有。旧档沿用实际可见事实。实体最多12条。
surfaces每轮整组替换；entityIds仅已知公开对象，无相关组件用[]。links只用于map中真实通路；不凭朝向推断可走，不露未知地点。timeline区分计划与实际；people不因同场推断私交；comparison用2至4个对象的证据/用途/条件/代价，不造成功率。丰富字段存同id的experience.fields，kind不变。查看不推进时间。
actions每卡最多4个，label简短；input只含所选目标，不捆绑接约/花钱/战斗/站队。attempt用于未知结果，effects=[]、destination=null，不强迫交易/说服/战斗成功。apply仅正文明确且当前可兑现的确定规则，成本所得完整，未知数值不算术，物品成本必须已拥有；surface.quote支持全部非零用量。destination只在map且为entityIds中的已知目的地，links有当前位置出发的可达通路；受阻用disabledReason或attempt。
gameActionReceipt.mode=apply承接input/effects/location的已校验预结算，不重复扣费、不改数量/状态/目的地、不额外行动；game只补后续发现，重述须一致。events/experience/game同物品数量、地点一致，不重复item-add/remove。局部操作ended=false，失败不提交也不声称后台执行。普通自由行动改变既有数量/单位/状态也须同步；game记可操作状态，experience记经历资料，不另建矛盾账本。`;

export const GAME_PLANNING_RULES = `
构想premise写场景欲望、阻力与转折，npcAction是人物实际决定，不是站着等；payoff写具体改变及用途，leaveOpen只保留自然引出的一个问题，也可空。路线有独有人物行动或信息/关系/资源取舍，不能每路只找到下一张纸条。行程并入场景，已有障碍不消失，未知风险不等于逐步暂停；零碎观测不是完整payoff。
玩法来自真实世界规则：探索代价、物件用途、可验证信息、资源取舍、合作条件，不硬塞RPG属性。有gameActionReceipt就承接已选动作和已知规则；apply按预结算，journey按路线给实际停点、耗时、付款，不擅自交物或接约。候选payoff应包含实际成果，不为留按钮停在一切尚未发生之前。`;
