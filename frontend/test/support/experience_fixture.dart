/// 独立客户端夹具，不是产品小说，也不证明真实模型/Go权威。
library;

import 'dart:async';
import 'dart:convert';
import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/workspace_session.dart';

Json testView({
  String id = 'experience-a',
  String branch = 'main',
  String text = '已提交的原文。',
  int revision = 1,
  Json? op,
}) => {
  'id': id,
  'title': '测试经历',
  'seed': '测试seed',
  'active_branch_id': 'main',
  'branch_id': branch,
  'revision': revision,
  'branches': [
    for (final b in ['main', 'other'])
      {'id': b, 'name': b == 'main' ? '原经历' : '另一分支', 'revision': revision},
  ],
  'pages': [
    if (revision > 0)
      {
        'revision': revision,
        'mode': 'begin',
        'input': '',
        'text': text,
        'story_time': '清晨',
        'created_at': '2026-10-13T00:00:00Z',
        'suggestions': <String>[],
        'outcome': 'continues',
      },
  ],
  'information': [
    {
      'id': 'fact:known',
      'kind': 'fact',
      'name': '天气',
      'text': '正在下雨',
      'related_ids': <String>[],
    },
  ],
  'operation': ?op,
};
Json testOperation(
  String request, {
  String branch = 'main',
  String status = 'committed',
  String id = 'experience-a',
}) => {
  'request_id': request,
  'experience_id': id,
  'branch_id': branch,
  'status': status,
  'base_revision': 1,
  if (status == 'committed') 'committed_revision': 2,
};
WorkspaceSession testSession() =>
    WorkspaceSession(backendUrl: 'https://world.test');

class MemoryJournal implements ExperienceJournal {
  final Map<String, Json> rows = {};
  bool failWrite = false, failRead = false;
  Completer<void>? gate;
  @override
  Future<Json> read(String scope) async {
    if (failRead) throw StateError('storage');
    return {...?rows[scope]};
  }

  @override
  Future<void> patch(String scope, Json values) async {
    if (gate != null) await gate!.future;
    if (failWrite) throw StateError('storage');
    rows[scope] = {...?rows[scope], ...values};
  }
}

class FakeExperienceApi implements ExperienceApi {
  final List<Json> sent = [], forks = [], creates = [];
  final List<String> queried = [];
  int reads = 0, cancels = 0;
  bool timeout = false, missing = false, listFailure = false;
  String status = 'committed';
  String passage = '已提交的原文。';
  Json? viewOverride;
  Future<ExperienceOperation>? delayed;
  List<Json> prefs = [];
  Json? interpretation;
  final List<Json> changes = [];
  bool conflict = false;
  bool preferenceTimeout = false;
  void Function()? afterPreferenceWrite;
  MemoryJournal? mustPersist;
  @override
  Future<List<ExperienceSummary>> list() async {
    if (listFailure) throw StateError('unavailable');
    return [
      ExperienceSummary({
        'id': 'experience-a',
        'title': '测试经历',
        'seed': '测试seed',
        'active_branch_id': 'main',
        'updated_at': '2026-10-13T00:00:00Z',
      }),
    ];
  }

  @override
  Future<ExperienceView> view(String id, {String? branch}) async {
    reads++;
    return ExperienceView(
      viewOverride ?? testView(id: id, branch: branch ?? 'main', text: passage),
    );
  }

  @override
  Future<ExperienceView> create(Json body) async {
    creates.add({...body});
    if (timeout) throw ExperienceHttpException('timeout', status: 504);
    return ExperienceView(
      testView(op: testOperation(body['request_id'], status: 'pending')),
    );
  }

  @override
  Future<ExperienceView> branch(String id, Json body) async {
    forks.add({...body});
    if (timeout) throw ExperienceHttpException('timeout', status: 504);
    return ExperienceView(testView(id: id, branch: 'other'));
  }

  @override
  Future<ExperienceOperation> submit(String id, Json body) async {
    if (mustPersist != null &&
        !mustPersist!.rows.values.any(
          (r) => (r['attempt'] as Map?)?['request_id'] == body['request_id'],
        )) {
      throw StateError('POST before persistence');
    }
    sent.add({...body});
    if (timeout) throw ExperienceHttpException('timeout', status: 504);
    return delayed ??
        ExperienceOperation(
          testOperation(
            body['request_id'],
            id: id,
            branch: body['branch_id'],
            status: status,
          ),
        );
  }

  @override
  Future<ExperienceOperation> operation(String id, String requestId) async {
    queried.add(requestId);
    if (missing) throw ExperienceHttpException('not found', status: 404);
    return ExperienceOperation(
      testOperation(requestId, id: id, status: status),
    );
  }

  @override
  Future<ExperienceOperation> cancel(String id, String requestId) async {
    cancels++;
    return ExperienceOperation(
      testOperation(requestId, id: id, status: 'cancelled'),
    );
  }

  @override
  Future<Json> receipt(String requestId) async {
    queried.add(requestId);
    if (missing) throw ExperienceHttpException('not found', status: 404);
    return {
      'request_id': requestId,
      'kind': creates.isNotEmpty ? 'create' : 'branch',
      'experience_id': 'experience-a',
      'branch_id': creates.isNotEmpty ? 'main' : 'other',
    };
  }

  @override
  Future<List<ContentPreference>> preferences() async =>
      prefs.map(ContentPreference.new).toList();

  @override
  Future<List<ContentPreference>> changePreference(Json change) async {
    changes.add({...change});
    if (preferenceTimeout) throw ExperienceHttpException('offline');
    if (conflict) {
      throw ExperienceHttpException(
        'preference_conflict',
        code: 'preference_conflict',
      );
    }
    final dimension = change['dimension'] as String;
    final expected = change['expected'] == null
        ? null
        : object(change['expected']);
    final current = prefs.where((p) => p['dimension'] == dimension).firstOrNull;
    if ((current == null) != (expected == null) ||
        current != null && jsonEncode(current) != jsonEncode(expected)) {
      throw ExperienceHttpException(
        'preference_conflict',
        code: 'preference_conflict',
      );
    }
    final value = change['value'];
    if (value == null) {
      prefs = [
        for (final p in prefs)
          if (p['dimension'] != dimension) p,
      ];
    } else {
      final row = <String, dynamic>{
        'dimension': dimension,
        'value': value,
        'source': 'explicit',
        'evidence': jsonEncode({
          'expression': change['expression'] ?? value,
          'confirmation': change['confirmation'],
        }),
        'version': 'v${changes.length}',
      };
      prefs = [
        for (final p in prefs)
          if (p['dimension'] != dimension) p,
        row,
      ];
    }
    afterPreferenceWrite?.call();
    return prefs.map(ContentPreference.new).toList();
  }

  @override
  Future<Json> interpretFeedback(String text) async =>
      interpretation ??
      {
        'status': 'unavailable',
        'text': text,
        'proposals': <Json>[],
        'explanation': '未配置模型；原文仍可保存。',
        'error_code': 'model_unavailable',
      };
}
