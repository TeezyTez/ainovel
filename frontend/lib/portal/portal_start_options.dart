/// Converts the demo's public world and player choices into a formal create seed.
library;

import '../experience/demo_world_catalog.dart';
import 'portal_world_data.dart';

String portalWorldSeed(
  DemoWorldPreset world, {
  String name = '旅人',
  String? identity,
  String goal = '',
  String participation = '先看世界如何展开，随时介入',
  String boundaries = '',
  String perspective = '第二人称',
  String length = '适中',
}) {
  final data = portalWorldDataById[world.id];
  final selectedIdentity = identity?.trim().isNotEmpty == true
      ? identity!.trim()
      : data?.identity ?? world.participation;
  return [
    '世界名称：${world.title}',
    if (data != null) ...[
      '世界背景：${data.description}',
      '时代：${data.era}',
      '起始地点：${data.location}',
      '世界规则：\n${data.rules.map((rule) => '- $rule').join('\n')}',
      '公开人物：\n${data.characters.map((person) => '- ${person.name}：${person.publicDescription}').join('\n')}',
      '开场情境参考（依照下方玩家角色与设定生成正文）：\n${data.opening}',
    ] else
      world.seed,
    '玩家角色名：${name.trim().isEmpty ? '旅人' : name.trim()}',
    '玩家确认的身份：$selectedIdentity',
    '个人目标：${goal.trim().isEmpty ? '尚未决定；不要替玩家设定目标或承诺。' : goal.trim()}',
    '参与方式：$participation',
    if (boundaries.trim().isNotEmpty) '偏好与底线：${boundaries.trim()}',
    '叙述视角：$perspective；篇幅：$length。',
    '请生成开场，保留玩家接下来的选择，不替玩家行动、同意或作承诺。',
  ].join('\n\n');
}
