import 'experience_models.dart';
import 'reader_gameplay.dart';

/// A server-filtered snapshot, always tied to one committed revision.
class ReaderProjection {
  ReaderProjection(Json j)
    : gameplay = j['gameplay'] == null
          ? null
          : ReaderGameplay(object(j['gameplay'])),
      revision = integer(j, 'revision'),
      _storyTime = string(j, 'story_time'),
      _information = objects(
        j['information'],
      ).map(KnownInformation.new).toList(),
      records = objects(j['records']).map(ReaderEvidence.new).toList();
  final int revision;
  final String _storyTime;
  final ReaderGameplay? gameplay;
  String get storyTime =>
      gameplay?.clock(revision, _storyTime)['label'] as String? ?? _storyTime;
  final List<KnownInformation> _information;
  List<KnownInformation> get information =>
      gameplay?.information(_information, revision) ?? _information;
  final List<ReaderEvidence> records;

  /// Later facts supersede the display of the same field, never erase its history.
  List<ReaderEvidence> get currentRecords {
    final latest = <String, ReaderEvidence>{};
    for (final r in records) {
      final key = '${r.kind}:${r.entityId}:${r.targetId}:${r.label}';
      if (!latest.containsKey(key) ||
          latest[key]!.sourceRevision <= r.sourceRevision)
        latest[key] = r;
    }
    final canonical = gameplay?.entities(revision) ?? <Json>[];
    return latest.values
        .where(
          (record) =>
              !const {'metric', 'item', 'location'}.contains(record.kind) ||
              !canonical.any(
                (entity) =>
                    entity['id'] == record.entityId ||
                    'entity:' + entity['id'].toString() == record.entityId,
              ),
        )
        .toList();
  }
}

class ReaderEvidence {
  ReaderEvidence(Json j)
    : kind = string(j, 'kind'),
      entityId = string(j, 'entity_id'),
      label = string(j, 'label'),
      factId = string(j, 'fact_id'),
      sourceRevision = integer(j, 'source_revision'),
      quote = string(j, 'quote'),
      targetId = j['target_id'] as String? ?? '',
      value = j['value'] as String? ?? '',
      unit = j['unit'] as String? ?? '',
      status = j['status'] as String? ?? '',
      bearing = j['bearing'] as String? ?? '',
      distanceMeters = (j['distance_meters'] as num?)?.toInt(),
      passage = j['passage'] as String? ?? '',
      dueAt = j['due_at'] as String? ?? '',
      input = j['input'] as String? ?? '',
      columns = (j['columns'] as List? ?? []).cast<String>(),
      rows = (j['rows'] as List? ?? [])
          .map((r) => (r as List).cast<String>())
          .toList(),
      fields = objects(j['fields'] ?? []).map(ReaderField.new).toList();
  final String kind,
      entityId,
      targetId,
      label,
      value,
      unit,
      status,
      bearing,
      passage,
      dueAt,
      input,
      factId,
      quote;
  final int sourceRevision;
  final int? distanceMeters;
  final List<String> columns;
  final List<List<String>> rows;
  final List<ReaderField> fields;
  Json toJson() => {
    'kind': kind,
    'entity_id': entityId,
    'target_id': targetId,
    'label': label,
    'value': value,
    'unit': unit,
    'status': status,
    'bearing': bearing,
    'distance_meters': distanceMeters,
    'passage': passage,
    'due_at': dueAt,
    'input': input,
    'fact_id': factId,
    'source_revision': sourceRevision,
    'quote': quote,
    'columns': columns,
    'rows': rows,
    'fields': fields.map((f) => f.toJson()).toList(),
  };
}

class ReaderField {
  ReaderField(Json j)
    : id = string(j, 'id'),
      label = string(j, 'label'),
      kind = string(j, 'kind'),
      value = j['value'] as String? ?? '',
      options = (j['options'] as List? ?? []).cast<String>(),
      required = j['required'] == true;
  final String id, label, kind, value;
  final List<String> options;
  final bool required;
  Json toJson() => {
    'id': id,
    'label': label,
    'kind': kind,
    'value': value,
    'options': options,
    'required': required,
  };
}
