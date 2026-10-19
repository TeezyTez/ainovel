/// 对外经历 API 的已知投影。字段来自 sundries 经历语义与迁移决定。
library;

import 'reader_projection.dart';
import 'reader_gameplay_receipt.dart';
import 'reader_gameplay.dart';
import 'reader_interaction_snapshot.dart';

typedef Json = Map<String, dynamic>;

Json object(Object? value) {
  if (value is! Map) throw const FormatException('经历响应不是对象');
  return Map<String, dynamic>.from(value);
}

List<Json> objects(Object? value) {
  if (value is! List) throw const FormatException('经历响应缺少列表');
  return value.map(object).toList(growable: false);
}

String string(Json j, String key) {
  final value = j[key];
  if (value is! String) throw FormatException('经历响应缺少 $key');
  return value;
}

int integer(Json j, String key) {
  final value = j[key];
  if (value is! int || value < 0) throw FormatException('经历响应缺少 $key');
  return value;
}

class ExperienceOperation {
  ExperienceOperation(Json j)
    : requestId = string(j, 'request_id'),
      experienceId = string(j, 'experience_id'),
      branchId = string(j, 'branch_id'),
      status = string(j, 'status'),
      baseRevision = integer(j, 'base_revision'),
      committedRevision = j['committed_revision'] as int?,
      errorCode = j['error_code'] as String? {
    if (!const {
      'pending',
      'generating',
      'committed',
      'failed',
      'cancelled',
      'interrupted',
    }.contains(status)) {
      throw const FormatException('未知操作状态');
    }
    if (status == 'committed' && committedRevision == null) {
      throw const FormatException('提交响应缺少正式版本');
    }
  }
  final String requestId, experienceId, branchId, status;
  final int baseRevision;
  final int? committedRevision;
  final String? errorCode;
  bool get running => status == 'pending' || status == 'generating';
}

class ExperiencePage {
  ExperiencePage(Json j)
    : interactionSnapshot = j['interaction_snapshot'] == null
          ? null
          : ReaderInteractionSnapshot(object(j['interaction_snapshot'])),
      gameplayReceipt = j['gameplay_receipt'] == null
          ? null
          : ReaderGameplayReceipt(object(j['gameplay_receipt'])),
      reader = j['reader'] == null
          ? null
          : ReaderProjection(object(j['reader'])),
      revision = integer(j, 'revision'),
      mode = string(j, 'mode'),
      input = string(j, 'input'),
      text = string(j, 'text'),
      storyTime = string(j, 'story_time'),
      createdAt = string(j, 'created_at'),
      outcome = string(j, 'outcome'),
      suggestions = (j['suggestions'] as List).cast<String>() {
    if (interactionSnapshot != null &&
        interactionSnapshot!.baseRevision != revision)
      throw const FormatException('历史作品不属于此页');
    if (gameplayReceipt != null && gameplayReceipt!.revision != revision) {
      throw const FormatException('行动回执不属于此页正式版本');
    }
  }
  final ReaderInteractionSnapshot? interactionSnapshot;
  final ReaderGameplayReceipt? gameplayReceipt;
  final ReaderProjection? reader;
  final int revision;
  final String mode, input, text, storyTime, createdAt, outcome;
  final List<String> suggestions;
}

class ExperienceBranch {
  ExperienceBranch(Json j)
    : id = string(j, 'id'),
      name = string(j, 'name'),
      revision = integer(j, 'revision'),
      parentId = j['parent_branch_id'] as String?,
      parentRevision = j['parent_revision'] as int?;
  final String id, name;
  final int revision;
  final String? parentId;
  final int? parentRevision;
}

class KnownInformation {
  KnownInformation(Json j)
    : id = string(j, 'id'),
      kind = string(j, 'kind') == 'place' ? 'location' : string(j, 'kind'),
      _name = string(j, 'name'),
      text = string(j, 'text'),
      relatedIds = (j['related_ids'] as List).cast<String>(),
      fields = objects(j['fields'] ?? <Json>[]),
      sourceVersion = j['source_version'] as int?,
      certainty = j['certainty'] as String?,
      status = j['status'] as String?;
  final String id, kind, _name, text;
  String get name {
    if (_name.trim().isNotEmpty) return _name;
    final known = text.trim();
    if (known.isEmpty) return '未命名记录';
    return known.length > 200 ? '${known.substring(0, 200)}…' : known;
  }

  final List<String> relatedIds;

  /// Optional literal display fields supplied by the source-demo projection.
  final List<Json> fields;
  final int? sourceVersion;
  final String? certainty, status;
}

class ExperienceView {
  ExperienceView(Json j)
    : gameplay = j['gameplay'] == null
          ? null
          : ReaderGameplay(object(j['gameplay'])),
      reader = j['reader'] == null
          ? null
          : ReaderProjection(object(j['reader'])),
      id = string(j, 'id'),
      title = string(j, 'title'),
      seed = string(j, 'seed'),
      branchId = string(j, 'branch_id'),
      activeBranchId = string(j, 'active_branch_id'),
      revision = integer(j, 'revision'),
      pages = objects(j['pages']).map(ExperiencePage.new).toList(),
      branches = objects(j['branches']).map(ExperienceBranch.new).toList(),
      _information = objects(
        j['information'],
      ).map(KnownInformation.new).toList(),
      operation = j['operation'] == null
          ? null
          : ExperienceOperation(object(j['operation'])) {
    if (operation != null &&
        (operation!.experienceId != id || operation!.branchId != branchId)) {
      throw const FormatException('经历操作归属不符');
    }
  }
  final ReaderProjection? reader;
  final String id, title, seed, branchId, activeBranchId;
  final int revision;
  final List<ExperiencePage> pages;
  final List<ExperienceBranch> branches;
  final List<KnownInformation> _information;
  final ReaderGameplay? gameplay;
  ReaderGameplay? get publicGameplay => gameplay ?? reader?.gameplay;
  List<KnownInformation> get information =>
      publicGameplay?.information(_information, revision) ?? _information;
  final ExperienceOperation? operation;
}

class ExperienceSummary {
  ExperienceSummary(Json j)
    : id = string(j, 'id'),
      title = string(j, 'title'),
      seed = string(j, 'seed'),
      activeBranchId = string(j, 'active_branch_id'),
      updatedAt = string(j, 'updated_at');
  final String id, title, seed, activeBranchId, updatedAt;
}

class ContentPreference {
  ContentPreference(Json j)
    : dimension = string(j, 'dimension'),
      value = string(j, 'value'),
      source = string(j, 'source'),
      evidence = string(j, 'evidence'),
      version = j['version'] as String? ?? '';
  final String dimension, value, source, evidence, version;
  Json toJson() => {
    'dimension': dimension,
    'value': value,
    'source': source,
    'evidence': evidence,
    'version': version,
  };
}
