/// Rebuilds a public reader snapshot from the exact shipped demo script.
/// Hidden flags select branches but never become reader information.
library;

import 'dart:convert';

import '../experience/experience_models.dart';
import 'portal_demo_script.dart';
import 'portal_demo_script_data.dart';
import 'portal_world_data.dart';

final Map<String, dynamic> _script = Map<String, dynamic>.from(
  jsonDecode(portalDemoScriptJson) as Map,
);

const _personIds = <String, List<String>>{
  // These identifiers and ordering are copied from src/worlds.js.
  'fog-harbor': ['lin', 'zhou', 'chen'],
  'mountain': ['su', 'he', 'lu'],
  'thursday': ['xu', 'tang', 'gao'],
};

/// [revision] is the number of confirmed turns to expose, including for a
/// historical page. Every value comes from public src/worlds.js data or from
/// player-visible events in src/demo.js, with its original variant resolved.
Json portalDemoPublicProjection(
  String worldId,
  PortalDemoState state,
  int revision,
) {
  final world = portalWorldDataById[worldId];
  final steps = _script[worldId];
  final people = _personIds[worldId];
  if (world == null || steps is! List || people == null) {
    throw const FormatException('这个世界没有预设演示资料');
  }
  if (revision < 0 || revision > state.turns.length) {
    throw const FormatException('预设演示的阅读位置无效');
  }

  final information = <Json>[
    {
      'id': 'entity:player',
      'kind': 'person',
      'name': '你',
      'text': '${world.identity}。${world.premise}',
      'related_ids': <String>[],
    },
    {
      'id': 'location:start',
      'kind': 'location',
      'name': world.location,
      'text': world.era,
      'related_ids': <String>[],
    },
    for (var i = 0; i < world.rules.length; i++)
      {
        'id': 'rule:$i',
        'kind': 'rule',
        'name': '世界规则 ${i + 1}',
        'text': world.rules[i],
        'related_ids': <String>[],
      },
    for (var i = 0; i < world.characters.length; i++)
      {
        'id': 'entity:${people[i]}',
        'kind': 'person',
        'name': world.characters[i].name,
        'text': world.characters[i].publicDescription,
        'related_ids': <String>[],
      },
  ];
  final byId = <String, Json>{
    for (final info in information) info['id'] as String: info,
  };
  final records = <Json>[];
  final flags = <String, String>{};
  final facts = <String>[];

  for (var turnIndex = 0; turnIndex < revision; turnIndex++) {
    final row = steps[turnIndex];
    if (row is! Map || row['actions'] is! List) {
      throw const FormatException('预设演示脚本缺少当前片刻');
    }
    final turn = state.turns[turnIndex];
    final actions = (row['actions'] as List).whereType<Map>();
    final action = actions
        .where((candidate) => candidate['text'] == turn.input)
        .firstOrNull;
    if (action == null) {
      throw const FormatException('预设演示的行动与原脚本不一致');
    }
    final contextKey = [
      flags['$worldId:approach'] ?? '',
      flags['$worldId:method'] ?? '',
      facts.any((fact) => fact.contains('自愿付款取走')) ? '1' : '0',
    ].join('|');
    final variant = action['variants'] is Map
        ? (action['variants'] as Map)[contextKey]
        : null;
    final result = variant is Map ? variant : action;
    if (result['prose'] != turn.prose || result['events'] is! List) {
      throw const FormatException('预设演示正文与原脚本不一致');
    }
    for (
      var eventIndex = 0;
      eventIndex < (result['events'] as List).length;
      eventIndex++
    ) {
      final raw = (result['events'] as List)[eventIndex];
      if (raw is! Map || raw['type'] is! String || raw['value'] is! String) {
        continue;
      }
      final type = raw['type'] as String;
      final value = raw['value'] as String;
      final entity = raw['entity'] is String ? raw['entity'] as String : '';
      if (type == 'flag') {
        flags[entity] = value;
        continue;
      }
      if (type == 'fact') facts.add(value);
      if (raw['visibility'] != 'player') continue;
      final sourceRevision = turnIndex + 1;
      final factId = 'demo:$worldId:$sourceRevision:$eventIndex';
      if (type == 'relation' && byId.containsKey('entity:$entity')) {
        final person = byId['entity:$entity']!;
        person['fields'] = [
          {'key': 'relationship', 'label': '已知关系', 'value': value},
        ];
        records.add({
          'kind': 'relation',
          'entity_id': 'entity:$entity',
          'label': '已知关系',
          'value': value,
          'fact_id': factId,
          'source_revision': sourceRevision,
          'quote': value,
        });
      } else if (type == 'item-add') {
        final id = 'item:$value';
        byId.putIfAbsent(id, () {
          final info = <String, dynamic>{
            'id': id,
            'kind': 'item',
            'name': value,
            'text': value,
            'related_ids': <String>[],
          };
          information.add(info);
          return info;
        });
        records.add({
          'kind': 'item',
          'entity_id': id,
          'label': value,
          'fact_id': factId,
          'source_revision': sourceRevision,
          'quote': value,
        });
      } else if (type == 'fact') {
        final id = 'fact:$sourceRevision:$eventIndex';
        final info = <String, dynamic>{
          'id': id,
          'kind': 'fact',
          'name': '第 $sourceRevision 个片刻',
          'text': value,
          'related_ids': <String>[],
        };
        byId[id] = info;
        information.add(info);
        records.add({
          'kind': 'fact',
          'entity_id': id,
          'label': value,
          'fact_id': factId,
          'source_revision': sourceRevision,
          'quote': value,
        });
      }
    }
  }
  return {
    'revision': revision,
    'story_time': revision == 0 ? '开场' : '第 $revision 个片刻',
    'information': information,
    'records': records,
  };
}
