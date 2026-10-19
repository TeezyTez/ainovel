/// Fixed source-demo scripts adapted to the shared reader. No HTTP client,
/// model, generated continuation, or formal-service fallback exists here.
library;

import 'dart:convert';

import '../portal/portal_demo_repository.dart';
import '../portal/portal_demo_script.dart';
import '../portal/portal_demo_public_projection.dart';
import 'demo_world_catalog.dart';
import 'experience_client.dart';
import 'experience_models.dart';

class PortalDemoExperienceApi implements ExperienceApi {
  PortalDemoExperienceApi({
    required this.repository,
    required this.sessionId,
    required this.opening,
    this.onChanged,
  });
  final PortalDemoRepository repository;
  final String sessionId, opening;
  final void Function()? onChanged;
  static final Map<String, Future<void>> _writes = {};
  Future<T> _write<T>(Future<T> Function() action) {
    final key = '${repository.catalogScope}:$sessionId';
    final job = (_writes[key] ?? Future<void>.value()).then((_) => action());
    _writes[key] = job.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return job;
  }

  Never _reject(String message, [int status = 422]) =>
      throw ExperienceHttpException(
        message,
        status: status,
        code: 'local_demo',
      );
  void _identity(String id) {
    if (id != sessionId) _reject('这不是当前本机预设演示。', 404);
  }

  Future<PortalDemoEntry> _entry() async {
    final entry = await repository.entry(sessionId);
    if (entry == null || entry.trashedAt != null) _reject('找不到这段本机预设演示。', 404);
    return entry;
  }

  Json _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};
  Json _branches(PortalDemoEntry entry) {
    final branches = _map(entry.session['reader_branches']);
    if (branches.isNotEmpty) return branches;
    return {
      'main': {
        'name': '原经历',
        'state': Map<String, dynamic>.from(entry.session),
      },
    };
  }

  PortalDemoState _state(Json branches, String branch) {
    if (branches[branch] is! Map) _reject('找不到这个本机分支。', 404);
    final raw = _map(_map(branches[branch])['state']);
    final state = PortalDemoState.fromJson(raw);
    if (raw['step'] != state.step ||
        (raw['turns'] as List?)?.length != state.turns.length) {
      _reject('本机脚本记录不完整，未覆盖原记录。');
    }
    return state;
  }

  Json _readonlyProjection(PortalDemoEntry entry) {
    final snapshot = entry.readonlyOpening!;
    final information = <Json>[
      if ((snapshot['identity'] as String? ?? '').isNotEmpty)
        {
          'id': 'entity:player',
          'kind': 'person',
          'name': '你',
          'text': snapshot['identity'],
          'related_ids': <String>[],
        },
      if ((snapshot['location'] as String? ?? '').isNotEmpty)
        {
          'id': 'location:start',
          'kind': 'location',
          'name': snapshot['location'],
          'text': snapshot['era'] as String? ?? '',
          'related_ids': <String>[],
        },
      for (var i = 0; i < (snapshot['rules'] as List? ?? []).length; i++)
        {
          'id': 'rule:$i',
          'kind': 'rule',
          'name': '世界规则 ${i + 1}',
          'text': (snapshot['rules'] as List)[i],
          'related_ids': <String>[],
        },
      for (var i = 0; i < (snapshot['characters'] as List? ?? []).length; i++)
        {
          'id': 'entity:person-$i',
          'kind': 'person',
          'name': (snapshot['characters'] as List)[i]['name'],
          'text': (snapshot['characters'] as List)[i]['public'],
          'related_ids': <String>[],
        },
    ];
    return {
      'revision': 1,
      'story_time': '开场',
      'information': information,
      'records': <Json>[],
    };
  }

  List<PortalDemoState> _snapshots(String world, PortalDemoState state) {
    var replay = const PortalDemoState();
    final snapshots = [replay];
    for (final turn in state.turns) {
      final action = PortalDemoScript.actions(
        world,
        replay,
      ).where((a) => a.text == turn.input).firstOrNull;
      final id = turn.input == '让当前场景自然继续。' ? 'continue' : action?.id;
      if (id == null) _reject('这个片刻不属于原版预设脚本，未改写原记录。');
      replay = PortalDemoScript.choose(world, replay, id);
      if (replay.turns.last.prose != turn.prose) {
        _reject('原版预设脚本与保存的片刻不一致，未覆盖原文。');
      }
      snapshots.add(replay);
    }
    if (jsonEncode(replay.flags) != jsonEncode(state.flags) ||
        jsonEncode(replay.facts) != jsonEncode(state.facts)) {
      _reject('保存的脚本状态与原版片刻不符，未覆盖原记录。');
    }
    return snapshots;
  }

  List<Json> _information(String world, PortalDemoState state) =>
      objects(_projection(world, state, state.step + 1)['information']);

  Json _projection(String world, PortalDemoState state, int revision) {
    final projection = portalDemoPublicProjection(world, state, state.step);
    return {
      ...projection,
      'revision': revision,
      'records': [
        for (final record in objects(projection['records']))
          {
            ...record,
            'source_revision': (record['source_revision'] as int) + 1,
          },
      ],
    };
  }

  ExperienceView _view(PortalDemoEntry entry, Json branches, String branch) {
    if (entry.readOnly) {
      final state = _state(branches, branch);
      if (state.step != 0 || state.turns.isNotEmpty) {
        _reject('本机只读开场记录不完整，未覆盖原文。');
      }
      final projection = _readonlyProjection(entry);
      return ExperienceView({
        'id': sessionId,
        'title': '${entry.title} · 本机只读开场',
        'seed': entry.worldTitle,
        'branch_id': branch,
        'active_branch_id':
            entry.session['reader_active_branch'] as String? ?? 'main',
        'revision': 1,
        'branches': [
          for (final b in branches.entries)
            {
              'id': b.key,
              'name': _map(b.value)['name'] ?? '本机分支',
              'revision': 1,
              if (_map(b.value)['parent_branch_id'] != null)
                'parent_branch_id': _map(b.value)['parent_branch_id'],
              if (_map(b.value)['parent_revision'] != null)
                'parent_revision': _map(b.value)['parent_revision'],
            },
        ],
        'pages': [
          {
            'revision': 1,
            'mode': 'begin',
            'input': '',
            'text': entry.readonlyOpening!['opening'],
            'story_time': '开场',
            'created_at': entry.createdAt.toIso8601String(),
            'outcome': 'continues',
            'suggestions': <String>[],
            'reader': projection,
          },
        ],
        'information': projection['information'],
        'reader': projection,
      });
    }
    final state = _state(branches, branch),
        snapshots = _snapshots(entry.worldId, _state(branches, branch));
    final preset = demoWorldPresets.firstWhere((p) => p.id == entry.worldId);
    return ExperienceView({
      'id': sessionId,
      'title': '${entry.title} · 本机预设演示',
      'seed': preset.seed,
      'branch_id': branch,
      'active_branch_id':
          entry.session['reader_active_branch'] as String? ?? 'main',
      'revision': state.step + 1,
      'branches': [
        for (final b in branches.entries)
          {
            'id': b.key,
            'name': _map(b.value)['name'] ?? '本机分支',
            'revision': _state(branches, b.key).step + 1,
            if (_map(b.value)['parent_branch_id'] != null)
              'parent_branch_id': _map(b.value)['parent_branch_id'],
            if (_map(b.value)['parent_revision'] != null)
              'parent_revision': _map(b.value)['parent_revision'],
          },
      ],
      'pages': [
        for (var i = 0; i < snapshots.length; i++)
          {
            'revision': i + 1,
            'mode': i == 0
                ? 'begin'
                : snapshots[i].turns.last.input == '让当前场景自然继续。'
                ? 'read'
                : 'act',
            'input': i == 0 ? '' : snapshots[i].turns.last.input,
            'text': i == 0 ? opening : snapshots[i].turns.last.prose,
            'story_time': i == 0 ? '开场' : '预设片刻 $i',
            'created_at': '',
            'outcome': snapshots[i].ended ? 'ending' : 'continues',
            'suggestions': PortalDemoScript.actions(
              entry.worldId,
              snapshots[i],
            ).map((a) => a.text).toList(),
            'reader': _projection(entry.worldId, snapshots[i], i + 1),
          },
      ],
      'information': _information(entry.worldId, state),
      'reader': _projection(entry.worldId, state, state.step + 1),
    });
  }

  Future<void> _save(
    PortalDemoEntry entry,
    Json branches,
    String active, {
    Json? operations,
    Json? receipts,
  }) async {
    final state = _state(branches, active);
    await repository.saveState(sessionId, {
      ...entry.session,
      ...state.toJson(),
      'reader_branches': branches,
      'reader_active_branch': active,
      'reader_operations': ?operations,
      'reader_receipts': ?receipts,
    });
    onChanged?.call();
  }

  bool _same(Json a, Json b) {
    if (a.length != b.length) return false;
    return a.keys.every((key) => jsonEncode(a[key]) == jsonEncode(b[key]));
  }

  @override
  Future<List<ExperienceSummary>> list() async {
    final entry = await repository.entry(sessionId);
    if (entry == null || entry.trashedAt != null) return [];
    return [
      ExperienceSummary({
        'id': entry.id,
        'title': '${entry.title} · 本机${entry.readOnly ? '只读开场' : '预设演示'}',
        'seed': entry.worldTitle,
        'active_branch_id': entry.session['reader_active_branch'] ?? 'main',
        'updated_at': entry.updatedAt.toIso8601String(),
      }),
    ];
  }

  @override
  Future<ExperienceView> view(String id, {String? branch}) async {
    _identity(id);
    final entry = await _entry();
    return _view(
      entry,
      _branches(entry),
      branch ?? entry.session['reader_active_branch'] as String? ?? 'main',
    );
  }

  @override
  Future<ExperienceOperation> submit(String id, Json body) => _write(() async {
    _identity(id);
    final entry = await _entry();
    if (entry.readOnly) _reject('这是本机只读开场；连接模型后可从世界详情新开自由故事。');
    final operations = _map(entry.session['reader_operations']);
    final request = string(body, 'request_id'), old = _map(operations[request]);
    if (old.isNotEmpty) {
      if (!_same(_map(old['body']), body)) _reject('同一请求编号不能改变预设选择。', 409);
      return ExperienceOperation(_map(old['operation']));
    }
    final branches = _branches(entry),
        branch = string(body, 'branch_id'),
        state = _state(branches, branch);
    if (body['expected_revision'] != state.step + 1) {
      _reject('本机分支已有新片刻，请重新读取。', 409);
    }
    if (state.ended) _reject('八个片刻的预设演示已经结束，可以回读或另开分支。');
    final mode = body['mode'], input = body['input'];
    String? actionId;
    if (mode == 'read' && input == '') {
      actionId = 'continue';
    } else if (mode == 'act' && input is String) {
      actionId = PortalDemoScript.actions(
        entry.worldId,
        state,
      ).where((a) => a.text == input).firstOrNull?.id;
    }
    if (actionId == null) _reject('本机预设只接受当前脚本选项或继续经历；自由行动和询问需要正式故事，不会调用模型。');
    final next = PortalDemoScript.choose(entry.worldId, state, actionId);
    branches[branch] = {..._map(branches[branch]), 'state': next.toJson()};
    final op = {
      'request_id': request,
      'experience_id': sessionId,
      'branch_id': branch,
      'status': 'committed',
      'base_revision': state.step + 1,
      'committed_revision': next.step + 1,
    };
    operations[request] = {
      'body': Map<String, dynamic>.from(body),
      'operation': op,
    };
    await _save(entry, branches, branch, operations: operations);
    return ExperienceOperation(op);
  });
  @override
  Future<ExperienceView> branch(String id, Json body) => _write(() async {
    _identity(id);
    final entry = await _entry(),
        receipts = _map(entry.session['reader_receipts']);
    final request = string(body, 'request_id'), old = _map(receipts[request]);
    if (old.isNotEmpty) {
      if (!_same(_map(old['body']), body)) _reject('同一请求编号不能改变本机分支。', 409);
      return _view(entry, _branches(entry), string(old, 'branch_id'));
    }
    if (['edit', 'polish', 'repair', 'world_version'].any(body.containsKey)) {
      _reject('固定脚本不能改写事实或生成新文；可从原片刻另开分支选择已有路径。');
    }
    final branches = _branches(entry),
        from = string(body, 'from_branch_id'),
        state = _state(branches, from),
        revision = integer(body, 'from_revision');
    if (revision < 1 || revision > state.step + 1) _reject('找不到所选本机片刻。', 409);
    final name = string(body, 'name').trim();
    if (name.isEmpty) _reject('请为分支命名。');
    final branch = 'branch-$request',
        snapshot = entry.readOnly
            ? state
            : _snapshots(entry.worldId, state)[revision - 1];
    branches[branch] = {
      'name': name,
      'parent_branch_id': from,
      'parent_revision': revision,
      'state': snapshot.toJson(),
    };
    receipts[request] = {
      'request_id': request,
      'kind': 'branch',
      'experience_id': sessionId,
      'branch_id': branch,
      'body': Map<String, dynamic>.from(body),
    };
    await _save(entry, branches, branch, receipts: receipts);
    return _view(await _entry(), branches, branch);
  });
  @override
  Future<ExperienceOperation> operation(String id, String requestId) async {
    _identity(id);
    final entry = await _entry(),
        saved = _map(_map(entry.session['reader_operations'])[requestId]);
    if (saved.isEmpty) _reject('本机未保存这个预设选择，可以使用原编号重试。', 404);
    return ExperienceOperation(_map(saved['operation']));
  }

  @override
  Future<ExperienceOperation> cancel(String id, String requestId) =>
      operation(id, requestId);
  @override
  Future<Json> receipt(String requestId) async {
    final entry = await _entry(),
        saved = _map(_map(entry.session['reader_receipts'])[requestId]);
    if (saved.isEmpty) _reject('本机未保存这个分支请求。', 404);
    return saved;
  }

  @override
  Future<ExperienceView> create(Json body) async =>
      _reject('请从世界详情新建一段独立的本机预设演示。');
  @override
  Future<List<ContentPreference>> preferences() async => [];
  @override
  Future<List<ContentPreference>> changePreference(Json change) async =>
      _reject('固定预设脚本不接受模型内容偏好修改。');
  @override
  Future<Json> interpretFeedback(String text) async =>
      _reject('本机预设不调用模型理解反馈。');
}
