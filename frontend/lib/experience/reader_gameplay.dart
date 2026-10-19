import 'dart:convert';
import 'experience_models.dart';
import 'reader_known_object_id.dart';
export 'reader_known_object_id.dart';

/// Public source-demo state, supplied by the formal versioned read contract.
/// This adapter only reads values; it never applies resource or journey effects.

class ReaderGameplay {
  ReaderGameplay(Json json)
    : location = string(json, 'location'),
      inventory = (json['inventory'] as List).cast<String>(),
      game = json['game'] == null ? null : object(json['game']),
      experience = json['experience'] == null
          ? null
          : object(json['experience']) {
    if (json['schemaVersion'] != 1) throw const FormatException('玩法快照版本不支持');
  }
  final String location;
  final List<String> inventory;
  final Json? game, experience;

  List<Json> entities(int revision) => _atVersion(game?['entities'], revision);
  List<Json> _atVersion(dynamic value, int revision) => [
    for (final entry in objects(value ?? []))
      if (entry['sourceVersion'] is int &&
          entry['sourceVersion'] >= 0 &&
          entry['sourceVersion'] <= revision)
        entry,
  ];

  Json clock(int revision, String fallback) {
    final value = experience?['clock'];
    if (value is Map &&
        value['sourceVersion'] is int &&
        value['sourceVersion'] <= revision) {
      final current = value['sourceVersion'] == revision;
      return {
        'label': current ? value['label'] : '最后确认：${value['label']}',
        'elapsed': current ? value['elapsed'] : '',
        'precision': current ? value['precision'] : 'unknown',
      };
    }
    return {'label': fallback, 'elapsed': '', 'precision': 'unknown'};
  }

  Set<String> itemAliases(Json entity, int revision) {
    final name = string(entity, 'name');
    final aliases = <String>{name};
    if (entity['value'] != null)
      aliases.add('$name${entity['value']}${entity['unit'] ?? ''}');
    final records = _atVersion(experience?['objects'], revision);
    final exact = records.where((o) => o['id'] == entity['id']);
    final named = records.where(
      (o) => o['kind'] == 'item' && o['name'] == name,
    );
    final record = exact.isNotEmpty
        ? exact.first
        : (named.length == 1 ? named.single : null);
    final fields = objects(record?['fields'] ?? []);
    final amounts = fields.where((f) => f['key'] == 'amount');
    final units = fields.where((f) => f['key'] == 'unit');
    final amount = amounts.isEmpty
        ? ''
        : amounts.first['value'] as String? ?? '';
    final unit = units.isEmpty ? '' : units.first['value'] as String? ?? '';
    if (amount.isNotEmpty) {
      aliases.add('$name$amount');
      if (unit.isNotEmpty && !amount.endsWith(unit))
        aliases.add('$name$amount$unit');
    }
    return aliases;
  }

  /// Mirrors publicSituation's final canonical-ledger overlay. Descriptive
  /// amount/unit fields cannot override a newer committed numeric entity.
  List<Json> overlayObjects(List<Json> input, int revision) {
    final records = <String, Json>{
      for (final entry in input)
        string(entry, 'id'): object(jsonDecode(jsonEncode(entry))),
    };
    for (final entry in _atVersion(experience?['objects'], revision)) {
      records[string(entry, 'id')] = object(jsonDecode(jsonEncode(entry)));
    }
    const kinds = {
      'meter': 'resource',
      'item': 'item',
      'place': 'location',
      'clue': 'clue',
      'objective': 'event',
      'actor': 'person',
    };
    final values = entities(revision);
    for (final entity in values) {
      final id = string(entity, 'id'), name = string(entity, 'name');
      final compatible = entity['kind'] == 'objective'
          ? {'event', 'agreement'}
          : {kinds[entity['kind']]};
      final sameName =
          values
              .where(
                (other) =>
                    other['kind'] == entity['kind'] && other['name'] == name,
              )
              .length ==
          1;
      final candidates = records.values
          .where(
            (entry) =>
                sameName &&
                compatible.contains(entry['kind']) &&
                entry['name'] == name,
          )
          .toList();
      final exact = records[id];
      final old =
          exact ??
          records['entity:$id'] ??
          (candidates.length == 1 ? candidates.single : null);
      final fields = objects(
        old?['fields'] ?? [],
      ).where((field) => !{'amount', 'unit'}.contains(field['key'])).toList();
      if (entity['value'] != null)
        fields.add({
          'key': 'amount',
          'label': '数量',
          'value': '${entity['value']}',
        });
      if (entity['unit'] is String && (entity['unit'] as String).isNotEmpty)
        fields.add({'key': 'unit', 'label': '单位', 'value': entity['unit']});
      final aliases = itemAliases(entity, revision);
      final entityIds = values.map((e) => e['id']).toSet();
      records.removeWhere(
        (key, record) =>
            key != id &&
            sameName &&
            compatible.contains(record['kind']) &&
            (record['name'] == name ||
                entity['kind'] == 'item' && aliases.contains(record['name'])) &&
            !entityIds.contains(key) &&
            (key ==
                    readerKnownObjectId(
                      string(record, 'kind'),
                      string(record, 'name'),
                    ) ||
                exact == null && key == old?['id'] ||
                key == 'entity:$id'),
      );

      final currentPlace = entity['kind'] == 'place' && name == location;
      final outdatedPlace =
          entity['kind'] == 'place' &&
          !currentPlace &&
          {'当前位置', '当前所在'}.contains(entity['status']);
      records[id] = {
        'id': id,
        'name': name,
        'kind':
            entity['kind'] == 'objective' && compatible.contains(old?['kind'])
            ? old!['kind']
            : kinds[entity['kind']],
        'summary': outdatedPlace ? '已知地点；当前位于$location' : entity['detail'],
        'status': currentPlace
            ? '当前所在'
            : outdatedPlace
            ? '已知地点'
            : (entity['status'] as String? ?? '').isNotEmpty
            ? entity['status']
            : entity['kind'] == 'item' && entity['value'] == 0
            ? '已耗尽'
            : '已知',
        'certainty': old?['certainty'] ?? 'confirmed',
        'sourceVersion': entity['sourceVersion'],
        'fields': fields,
        'relatedIds': old?['relatedIds'] ?? [],
      };
    }
    return [
      for (final entry in records.values)
        {
          ...entry,
          if (entry['kind'] == 'fact' &&
              entry['sourceVersion'] is int &&
              entry['sourceVersion'] < revision)
            'status': '历史记录',
          'relatedIds': [
            for (final id in entry['relatedIds'] as List? ?? [])
              if (records.containsKey(id)) id,
          ],
        },
    ];
  }

  List<KnownInformation> information(
    List<KnownInformation> original,
    int revision,
  ) => [
    for (final value in overlayObjects([
      for (final item in original)
        {
          'id': item.id,
          'kind': item.kind == 'character' ? 'person' : item.kind,
          'name': item.name,
          'summary': item.text,
          'fields': item.fields,
          'relatedIds': item.relatedIds,
          'sourceVersion': item.sourceVersion,
        },
    ], revision))
      KnownInformation({
        'id': value['id'],
        'kind': value['kind'] == 'person' ? 'character' : value['kind'],
        'name': value['name'],
        'text': value['summary'] ?? '',
        'fields': value['fields'] ?? [],
        'related_ids': value['relatedIds'] ?? [],
        'source_version': value['sourceVersion'],
        'certainty': value['certainty'],
        'status': value['status'],
      }),
  ];

  Json sourceState(int revision, String time) {
    final state = <String, dynamic>{
      'version': revision,
      'location': location,
      'inventory': inventory,
      'facts': <String>[],
      'time': time,
      'game': game,
      'experience': experience,
    };
    // Snapshots already carry source revisions. Do not make a future record
    // visible if a malformed response includes it in an older page.
    if (game != null)
      state['game'] = {
        ...game!,
        'entities': entities(revision),
        'surfaces': objects(game!['surfaces'] ?? [])
            .where(
              (surface) =>
                  surface['version'] is int && surface['version'] <= revision,
            )
            .toList(),
      };
    if (experience != null)
      state['experience'] = {
        ...experience!,
        'objects': _atVersion(experience!['objects'], revision),
      };
    return object(jsonDecode(jsonEncode(state)));
  }
}
