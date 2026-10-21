import 'experience_models.dart';
import 'reader_information_display.dart';

/// Adapts committed public snapshots to the original read-only source UI.
/// Diagram positions are presentation only; no inferred relationship is added.
List<Json> readerContextObjects(ExperienceView view) {
  final result = <Json>[
    for (final item in view.information)
      {
        'id': item.id,
        'name': item.name,
        'kind': switch (item.kind) {
          'character' => 'person',
          'place' => 'location',
          'rule' || 'statement' || 'belief' => 'fact',
          'thread' => 'clue',
          _ => item.kind,
        },
        'summary': item.displaySummary,
        'certainty':
            item.certainty ??
            switch (item.kind) {
              'statement' => 'reported',
              'belief' => 'unknown',
              _ => 'confirmed',
            },
        'status': item.status ?? '已知',
        'relatedIds': item.relatedIds,
        'sourceVersion':
            item.sourceVersion ??
            view.pages
                .where(
                  (page) =>
                      page.reader?.information.any(
                        (old) => old.id == item.id && old.text == item.text,
                      ) ??
                      false,
                )
                .firstOrNull
                ?.revision ??
            view.revision,
        'fields': [
          ...item.fields,
          if (item.isInitialEntityRecord && item.relatedIds.isNotEmpty)
            {
              'key': 'initialAssociations',
              'label': '初次关联',
              'value': item.relatedNames(view.information),
            },
          for (final record in view.reader?.currentRecords ?? [])
            if ('entity:${record.entityId}' == item.id &&
                record.value.isNotEmpty &&
                record.kind != 'artifact')
              {
                'key': record.label,
                'label': '正式记录 · ${record.label}（第 ${record.sourceRevision} 页）',
                'value': record.value,
              },
        ],
      },
    for (final page in view.pages)
      {
        'id': 'page:${page.revision}',
        'name': '第 ${page.revision} 页',
        'kind': 'event',
        'summary': page.text,
        'certainty': 'confirmed',
        'sourceVersion': page.revision,
        'fields': [
          if (page.storyTime.isNotEmpty)
            {'key': 'occurredAt', 'label': '故事时间', 'value': page.storyTime},
        ],
      },
  ];
  return result;
}

List<Json> readerSelectedObjects(dynamic selection, ExperienceView view) {
  if (selection == null) return [];
  if (selection is! Map ||
      selection['worldKey'] != view.id ||
      selection['branchId'] != view.branchId ||
      selection['baseVersion'] != view.revision) {
    throw const FormatException('选择已过期，请重新选择；草稿仍保留。');
  }
  final ids = selection['objectIds'];
  final objects = readerContextObjects(view);
  if (ids is! List ||
      ids.length > 4 ||
      ids.toSet().length != ids.length ||
      ids.any((id) => !objects.any((o) => o['id'] == id))) {
    throw const FormatException('最多关联四条当前已知资料，请重新选择。');
  }
  return [for (final id in ids) objects.firstWhere((o) => o['id'] == id)];
}
