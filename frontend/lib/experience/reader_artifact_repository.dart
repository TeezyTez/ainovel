import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../portal/portal_service_client.dart';
import 'experience_journal.dart';
import 'experience_models.dart';

class PreparedReaderArtifact {
  PreparedReaderArtifact(Json data)
    : id = string(data, 'artifact_id'),
      revisionId = string(data, 'revision_id'),
      baseRevision = integer(data, 'base_revision'),
      stateRevision = integer(data, 'state_revision'),
      state = object(data['state']),
      payload = object(data['payload']),
      stale = data['stale'] == true {
    if (id.isEmpty ||
        revisionId.isEmpty ||
        baseRevision < 1 ||
        stateRevision < 0 ||
        payload['schemaVersion'] != 1 ||
        payload['state'] is! Map ||
        (payload['definition'] != null && payload['definition'] is! Map) ||
        payload['capabilities'] is! Map) {
      throw const FormatException('作品版本格式不完整。');
    }
  }
  final String id, revisionId;
  final int baseRevision, stateRevision;
  final Json state, payload;
  final bool stale;
  bool get hasPresentation {
    if (payload['definition'] is Map) return true;
    bool present(dynamic game) {
      if (game is! Map) return false;
      bool nonempty(dynamic value) => value is List && value.isNotEmpty;
      final spatial = game['spatial'], journeys = game['journeys'];
      return nonempty(game['surfaces']) ||
          spatial is Map &&
              (nonempty(spatial['sites']) || nonempty(spatial['relations'])) ||
          journeys is Map &&
              (nonempty(journeys['routes']) || journeys['transit'] != null);
    }

    return present(object(payload['state'])['game']) &&
        (!payload.containsKey('sourceGame') || present(payload['sourceGame']));
  }
}

/// Versioned presentation data. All mutations are journaled before transport;
/// this repository never changes a story fact or commits a narrative page.
class ReaderArtifactRepository extends ChangeNotifier {
  ReaderArtifactRepository({
    required this.client,
    required this.journal,
    required this.scope,
    required this.experienceId,
    required this.branchId,
    required this.revision,
    required this.isCurrent,
    this.belongsToCurrent,
  });
  final PortalServiceClient client;
  final ExperienceJournal journal;
  final String scope, experienceId, branchId;
  final int revision;
  final bool Function() isCurrent;
  final bool Function()? belongsToCurrent;
  bool get matchesCurrentStory =>
      (belongsToCurrent ?? isCurrent)() &&
      artifact != null &&
      !artifact!.stale &&
      artifact!.baseRevision == revision;
  bool get displayCurrent =>
      matchesCurrentStory && artifact!.revisionId == head?.revisionId;
  PreparedReaderArtifact? artifact, head;
  List<Json> revisions = [];
  Json? pending;
  final Map<String, Json> inputDecisions = {};
  Future<void> Function()? flushLocalState;
  String? error;
  bool busy = false, disposed = false;
  bool _loading = false;
  Completer<void>? _abort;
  String get path =>
      '/v1/experiences/${Uri.encodeComponent(experienceId)}/artifacts';
  String get query => 'branch_id=${Uri.encodeComponent(branchId)}';

  /// A durable automatic presentation request can wait while the story moves on.
  /// Unknown work and requests initiated by the reader still require recovery.
  bool get blocksStoryInput {
    // Hydration may still discover a current interface that needs input routing.
    if (_loading) return true;
    final request = pending;
    if (request == null) return busy;
    final body = request['body'];
    if (request['path'] != '$path/prepare' ||
        request.containsKey('input_metadata') ||
        body is! Map ||
        body['branch_id'] != branchId ||
        body['expected_revision'] != revision ||
        body['retry'] != false ||
        body['input_routing'] == true) {
      return true;
    }
    final intent = body['intent'];
    return intent != null && (intent is! String || intent.trim().isNotEmpty);
  }

  bool get writable =>
      isCurrent() &&
      !busy &&
      pending == null &&
      artifact != null &&
      !artifact!.stale &&
      artifact!.baseRevision == revision &&
      artifact!.revisionId == head?.revisionId;
  void _notify() {
    if (!disposed) notifyListeners();
  }

  void _accept(Json response, {bool historical = false}) {
    final next = response['artifact'] == null
        ? null
        : PreparedReaderArtifact(object(response['artifact']));
    final history = objects(response['revisions']);
    for (final entry in history) {
      if (string(entry, 'revision_id').isEmpty ||
          integer(entry, 'base_revision') < 1) {
        throw const FormatException('作品历史版本格式不完整。');
      }
    }
    if (next != null) {
      void checkScope(Json scope) {
        if (scope['worldKey'] != experienceId ||
            scope['sessionId'] != experienceId ||
            scope['branchId'] != branchId ||
            scope['baseVersion'] != next.baseRevision) {
          throw const FormatException('作品响应的故事或分支归属不符。');
        }
      }

      checkScope(object(next.payload['scope']));
      if (object(next.payload['state'])['version'] != next.baseRevision ||
          !history.any(
            (entry) =>
                entry['revision_id'] == next.revisionId &&
                entry['base_revision'] == next.baseRevision,
          )) {
        throw const FormatException('作品响应的快照与版本历史不一致。');
      }
      final definition = next.payload['definition'];
      if (definition != null) checkScope(object(object(definition)['scope']));
      if (!historical && next.baseRevision != revision && !next.stale) {
        throw const FormatException('较早的作品响应没有标记为历史版本。');
      }
    }
    artifact = next;
    if (!historical) head = next;
    revisions = history;
  }

  Future<void> load({String? revisionId}) async {
    if (busy) return;
    busy = true;
    _loading = true;
    error = null;
    _notify();
    try {
      final saved = await journal.read(scope);
      pending = saved['pending'] is Map ? object(saved['pending']) : null;
      for (final phase in ['ui', 'action']) {
        if (saved['input_$phase'] is Map)
          inputDecisions[phase] = object(saved['input_$phase']);
      }
      final suffix = revisionId == null || artifact == null
          ? ''
          : '/${Uri.encodeComponent(artifact!.id)}';
      final version = revisionId == null
          ? ''
          : '&revision_id=${Uri.encodeComponent(revisionId)}';
      final response = await client.request(
        'GET',
        '$path$suffix?$query$version',
      );
      if (revisionId != null &&
          (response['artifact'] is! Map ||
              object(response['artifact'])['revision_id'] != revisionId))
        throw const FormatException('读取到的作品不是所选版本。');
      _accept(response, historical: revisionId != null);
    } catch (e) {
      error = '$e';
    } finally {
      _loading = false;
      busy = false;
      _notify();
    }
  }

  /// The interpretation receipt and its next operation id are durable before
  /// any caller can act on the result. Unknown classification never means act.
  Future<Json?> routeInput(
    String input,
    String draft, {
    required String phase,
    Json? dynamicAttempt,
  }) async {
    if (!{'ui', 'action'}.contains(phase)) throw ArgumentError('phase');
    final previous = inputDecisions[phase];
    if (previous != null &&
        previous['consumed'] != true &&
        previous['input'] == input &&
        previous['draft'] == draft &&
        jsonEncode(previous['dynamic_attempt']) == jsonEncode(dynamicAttempt))
      return previous;
    await _mutate(
      phase == 'ui' ? '/prepare' : '/input',
      phase == 'ui'
          ? {'input_routing': true, 'intent': input}
          : {
              'input': input,
              if (dynamicAttempt != null) 'dynamic_attempt': dynamicAttempt,
            },
      metadata: {
        'phase': phase,
        'input': input,
        'draft': draft,
        if (dynamicAttempt != null) 'dynamic_attempt': dynamicAttempt,
        'operation_id': const Uuid().v4(),
      },
    );
    return pending == null && error == null ? inputDecisions[phase] : null;
  }

  Future<void> consumeInput(String phase, String requestId) async {
    final value = inputDecisions[phase];
    if (value == null || value['request_id'] != requestId) return;
    final consumed = {...value, 'consumed': true};
    await journal.patch(scope, {'input_$phase': consumed});
    inputDecisions[phase] = consumed;
  }

  Json _inputResult(Json response, Json request, Json metadata) {
    final body = object(request['body']),
        bound = object(response['routing_scope']);
    if (bound['request_id'] != body['request_id'] ||
        bound['experience_id'] != experienceId ||
        bound['branch_id'] != branchId ||
        bound['base_revision'] != revision)
      throw const FormatException('输入解释不属于这次请求');
    final phase = metadata['phase'],
        decision = object(
          response[phase == 'ui' ? 'intent_decision' : 'input_decision'],
        );
    final allowed = phase == 'ui'
        ? {'create', 'edit', 'story', 'mixed', 'clarify'}
        : {'execute', 'attempt', 'unrelated', 'clarify'};
    if (!allowed.contains(decision['kind']) || decision['message'] is! String)
      throw const FormatException('输入解释格式不完整');
    if (phase == 'ui' &&
        decision['kind'] == 'edit' &&
        decision['target'] != artifact?.id)
      throw const FormatException('界面修改目标不属于当前作品');
    if (decision['kind'] == 'execute') {
      final plan = object(decision['execute']);
      if (plan['branch_id'] != branchId ||
          plan['expected_revision'] != revision ||
          plan['artifact_id'] is! String ||
          plan['revision_id'] is! String ||
          plan['expected_head'] is! String ||
          plan['definition_digest'] is! String ||
          !{'dynamic', 'game', 'journey'}.contains(plan['kind']) ||
          plan['reference'] is! Map ||
          plan['params'] is! Map)
        throw const FormatException('解释得到的行动不属于当前正式版本');
    }
    return {
      ...metadata,
      'request_id': body['request_id'],
      'decision': decision,
      'consumed': false,
    };
  }

  Future<void> prepare(String intent, {bool retry = true}) => _mutate(
    '/prepare',
    {'retry': retry, if (intent.trim().isNotEmpty) 'intent': intent.trim()},
  );
  Future<void> prepareAutomatically() async {
    await load();
    if (disposed || !isCurrent() || error != null || pending != null) return;
    final saved = await journal.read(scope);
    if (saved['auto_checked'] == true || artifact?.baseRevision == revision)
      return;
    await prepare('', retry: false);
    if (!disposed && pending == null && error == null) {
      await journal.patch(scope, {'auto_checked': true});
    }
  }

  Future<void> importDefinition(Json definition, Json state) =>
      _mutate('/import', {'definition': definition, 'state': state});
  Future<void> saveState(Json state) {
    final current = artifact;
    if (!writable || current == null)
      return Future.error(StateError('作品已过期或有待确认请求，请先恢复。'));
    return _mutate('/${Uri.encodeComponent(current.id)}/state', {
      'revision_id': current.revisionId,
      'expected_state_revision': current.stateRevision,
      'state': state,
    });
  }

  Future<void> restore(String revisionId) {
    final current = head;
    if (!isCurrent() ||
        busy ||
        pending != null ||
        current == null ||
        current.stale ||
        current.baseRevision != revision)
      return Future.error(StateError('当前作品无法恢复，请重新读取。'));
    return _mutate('/${Uri.encodeComponent(current.id)}/restore', {
      'revision_id': revisionId,
      'expected_head': current.revisionId,
      'expected_state_revision': current.stateRevision,
    });
  }

  Future<void> _mutate(String suffix, Json body, {Json? metadata}) async {
    if (busy || pending != null) throw StateError('先恢复上一项作品请求。');
    if (!isCurrent()) throw StateError('故事已经改变，请重新打开作品。');
    final request = <String, dynamic>{
      'path': '$path$suffix',
      if (metadata != null) 'input_metadata': metadata,
      'body': {
        'request_id': const Uuid().v4(),
        'branch_id': branchId,
        'expected_revision': revision,
        ...body,
      },
    };
    // Clone before the await so later form edits cannot alter an unknown request.
    final copy = object(jsonDecode(jsonEncode(request)));
    busy = true;
    _notify();
    try {
      await journal.patch(scope, {'pending': copy});
      pending = copy;
    } finally {
      busy = false;
      _notify();
    }
    await retry();
  }

  Future<void> retry() async {
    if (busy || pending == null) return;
    final request = pending!;
    final body = object(request['body']);
    if (body['branch_id'] != branchId ||
        body['expected_revision'] != revision ||
        request['path'] is! String ||
        !(request['path'] as String).startsWith('$path/')) {
      throw const FormatException('待确认的作品请求不属于当前故事版本。');
    }
    busy = true;
    error = null;
    _abort = Completer<void>();
    _notify();
    try {
      final response = await client.request(
        'POST',
        request['path'] as String,
        body,
        _abort!.future,
      );
      if (request['input_metadata'] == null &&
          response['artifact'] is Map &&
          object(response['artifact'])['base_revision'] != revision)
        throw const FormatException('作品提交回应不是请求的正式故事版本。');
      final metadata = request['input_metadata'];
      final routed = metadata is Map
          ? _inputResult(response, request, object(metadata))
          : null;
      _accept(response);
      await journal.patch(scope, {
        'pending': null,
        if (routed != null) 'input_${routed['phase']}': routed,
      });
      if (routed != null) inputDecisions[routed['phase'] as String] = routed;
      pending = null;
    } catch (e) {
      error = '作品请求尚未确认：$e';
    } finally {
      busy = false;
      _abort = null;
      _notify();
    }
  }

  void cancel() {
    if (_abort != null && !_abort!.isCompleted) _abort!.complete();
  }

  @override
  void dispose() {
    disposed = true;
    cancel();
    client.close();
    super.dispose();
  }
}
