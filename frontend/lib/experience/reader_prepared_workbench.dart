import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show mapEquals;
import 'experience_models.dart';
import 'reader_artifact_repository.dart';
import 'reader_artifact_surface.dart';
import 'reader_export.dart';
import 'reader_panels.dart';

// JSONB may return object keys in another order. Compare JSON values rather
// than their serialization so an acknowledged write actually ends the flush.
bool _sameJsonValue(dynamic left, dynamic right) {
  if (left is Map && right is Map) {
    return left.length == right.length &&
        left.keys.every(
          (key) =>
              right.containsKey(key) && _sameJsonValue(left[key], right[key]),
        );
  }
  if (left is List && right is List) {
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index++) {
      if (!_sameJsonValue(left[index], right[index])) return false;
    }
    return true;
  }
  return left == right;
}

class ReaderPreparedWorkbench extends StatefulWidget {
  const ReaderPreparedWorkbench({
    super.key,
    required this.repository,
    required this.onAttempt,
    required this.onDraft,
    required this.onEvidence,
    this.onExecute,
    this.onContractAttempt,
    this.onNavigate,
    this.initialMap,
    this.panel,
    this.input = '',
    this.prose = '',
    this.dark = false,
    this.reducedMotion = false,
    this.embedded = false,
    this.ownsRepository = true,
    this.initializeRepository = true,
  });
  final ReaderArtifactRepository repository;
  final Future<void> Function(String input) onAttempt;
  final Future<void> Function(Json request)? onContractAttempt;
  final Future<void> Function(String artifactId, Json action)? onExecute;
  final Future<void> Function(String kind, Json data)? onNavigate;
  final Json? initialMap;
  final String? panel;
  final String input, prose;
  final ValueChanged<String> onDraft;
  final VoidCallback onEvidence;
  final bool dark,
      reducedMotion,
      embedded,
      ownsRepository,
      initializeRepository;
  @override
  State<ReaderPreparedWorkbench> createState() =>
      _ReaderPreparedWorkbenchState();
}

class _ReaderPreparedWorkbenchState extends State<ReaderPreparedWorkbench> {
  final intent = TextEditingController();
  ReaderArtifactRepository get r => widget.repository;
  Timer? debounce;
  Json? localState;
  String? localRevision, message;
  bool submitting = false;
  Future<void> stateWrites = Future.value();
  Future<void>? stateFlush;
  @override
  void initState() {
    super.initState();
    r.flushLocalState = flushState;
    r.addListener(changed);
    unawaited(run(initialize));
  }

  Future<void> initialize() async {
    if (widget.initializeRepository) await r.load();
    final saved = await r.journal.read(r.scope);
    final draft = saved['artifact_ui'];
    if (draft is Map &&
        draft['revision_id'] == r.artifact?.revisionId &&
        draft['state'] is Map) {
      localRevision = draft['revision_id'] as String;
      localState = object(draft['state']);
    }
    if (widget.initialMap != null && r.artifact != null) {
      localRevision = r.artifact!.revisionId;
      localState = {
        ...r.artifact!.state,
        ...?localState,
        'travel': {
          ...object((localState ?? r.artifact!.state)['travel'] ?? {}),
          if (widget.initialMap!.containsKey('scope'))
            'scopeOverride': widget.initialMap!['scope'],
          if (widget.initialMap!['anchor'] is String)
            'anchorId': widget.initialMap!['anchor'],
        },
      };
    }
    changed();
  }

  void changed() {
    if (r.writable &&
        localState != null &&
        localRevision == r.artifact?.revisionId &&
        !_sameJsonValue(localState, r.artifact!.state)) {
      debounce?.cancel();
      debounce = Timer(const Duration(milliseconds: 500), () {
        if (mounted && r.writable) unawaited(run(flushState));
      });
    }
    if (mounted) setState(() {});
  }

  Future<void> run(Future<void> Function() operation) async {
    try {
      await operation();
    } catch (e) {
      message = '$e';
    }
    changed();
  }

  Future<void> rememberState(Json state) async {
    if (!r.displayCurrent) return;
    localState = object(jsonDecode(jsonEncode(state)));
    localRevision = r.artifact!.revisionId;
    final saved = {'revision_id': localRevision, 'state': localState};
    stateWrites = stateWrites
        .catchError((Object _) {})
        .then((_) => r.journal.patch(r.scope, {'artifact_ui': saved}));
    await stateWrites;
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 500), () {
      if (r.writable) unawaited(run(flushState));
    });
  }

  Future<void> flushState() =>
      stateFlush ??= flushLatestState().whenComplete(() => stateFlush = null);

  Future<void> flushLatestState() async {
    debounce?.cancel();
    while (true) {
      await stateWrites;
      final state = localState;
      if (state == null || localRevision != r.artifact?.revisionId) return;
      if (!r.writable) throw StateError('参数保留在本机；请先恢复作品请求再保存。');
      if (_sameJsonValue(state, r.artifact!.state)) return;
      await r.saveState(state);
      if (r.pending != null) throw StateError('参数尚未确认保存。请恢复作品请求。');
      if (identical(state, localState)) {
        await r.journal.patch(r.scope, {'artifact_ui': null});
      }
    }
  }

  Future<void> receive(String kind, dynamic value) async {
    if ({
      'advanced-current-map',
      'advanced-open-map',
      'advanced-inspect',
    }.contains(kind)) {
      final artifact = r.artifact;
      if (artifact == null || widget.onNavigate == null) return;
      final destination = kind == 'advanced-inspect' && value is String
          ? value
          : 'map';
      if (!{
        'map',
        'status',
        'inventory',
        'time',
        'timeline',
        'people',
        'interaction',
        'objectives',
        'all',
        'rules',
        'relationships',
        'clues',
      }.contains(destination))
        return;
      if (!widget.embedded && mounted) {
        Navigator.pop(context);
        await Future<void>.delayed(Duration.zero);
      }
      await widget.onNavigate!(destination, {
        'revision': kind == 'advanced-current-map'
            ? r.revision
            : artifact.baseRevision,
        if (value is Map) ...object(value),
      });
      return;
    }

    if (kind == 'advanced-repair') {
      final reason = value is String ? value : value is Map ? value['reason'] : null;
      final automatic = value is String || value is Map && value['automatic'] == true;
      if (reason is! String || reason.isEmpty || reason.length > 4000) return;
      if (!r.writable || submitting) return;
      submitting = true;
      changed();
      try {
        await flushState();
        if (r.writable) await r.repair(reason, automatic: automatic);
      } finally {
        submitting = false;
        changed();
      }
      return;
    }
    if (kind == 'advanced-state' && value is Map)
      return rememberState(object(value));
    if (kind == 'draft' && value is String && value.length <= 10000) {
      if (!r.writable) throw StateError('故事已改变或作品尚待确认，请重新打开作品。');
      widget.onDraft(value);
      return;
    }
    if (kind == 'import' && value is Map) {
      if (!r.isCurrent() || r.busy || r.pending != null)
        throw StateError('先恢复当前作品请求。');
      final imported = object(value), payload = object(imported['payload']);
      final definition = object(payload['definition']),
          state = object(imported['state']);
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('导入交互作品'),
          content: Text(
            '将“${definition['title'] ?? '交互作品'}”作为新作品版本导入。服务端会依据当前公开记录重新验证定义；导入不会替换世界事实或推进故事。',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('验证并导入'),
            ),
          ],
        ),
      );
      if (confirmed == true && mounted) {
        await r.importDefinition(definition, state);
        if (r.pending == null) {
          localState = null;
          localRevision = null;
        }
      }
      return;
    }
    if (kind == 'export') {
      final artifact = r.artifact;
      if (artifact != null)
        message = await exportReaderFile(
          '交互作品-${artifact.revisionId}.json',
          const JsonEncoder.withIndent('  ').convert({
            'payload': {
              ...artifact.payload,
              if (widget.panel != null) 'panel': widget.panel,
              'input': widget.input,
              'prose': widget.prose,
            },
            'state': localState ?? artifact.state,
          }),
          'application/json',
        );
      changed();
      return;
    }
    if (kind == 'advanced-history' && value is String) {
      if (r.writable) await flushState();
      await r.load(revisionId: value);
      changed();
      return;
    }
    if (kind == 'advanced-restore' && value is String) {
      await r.restore(value);
      localState = null;
      localRevision = null;
      changed();
      return;
    }
    if (kind == 'advanced-execute' && value is Map) {
      final action = object(value), artifact = r.artifact;
      if (submitting ||
          !r.writable ||
          artifact == null ||
          widget.onExecute == null ||
          action['branchId'] != r.branchId ||
          action['version'] != r.revision ||
          action['definitionDigest'] != artifact.payload['definitionDigest'] ||
          object(artifact.payload['capabilities'])['deterministic'] != true ||
          !const {'dynamic', 'game', 'journey'}.contains(action['kind']) ||
          action['reference'] is! Map ||
          action['params'] is! Map) {
        throw StateError('规则行动不属于当前可执行的作品版本。');
      }
      final reference = object(action['reference']);
      if (action['kind'] == 'dynamic') {
        final definition = object(artifact.payload['definition']);
        if (reference['interactionId'] != definition['id'] ||
            reference['revision'] != definition['revision'] ||
            !mapEquals(
              object(reference['scope']),
              object(definition['scope']),
            ) ||
            reference['targets'] is! List) {
          throw StateError('规则行动的定义归属已经改变。');
        }
      } else if (reference['branchId'] != r.branchId ||
          reference['version'] != r.revision ||
          reference['surfaceId'] is! String ||
          (action['kind'] == 'journey' &&
              reference['surfaceId'] != r'$journeys')) {
        throw StateError('规则行动的故事版本已经改变。');
      }
      if (reference['actionId'] is! String ||
          (reference['actionId'] as String).isEmpty) {
        throw StateError('规则行动缺少原始操作标识。');
      }
      final command = object(
        jsonDecode(
          jsonEncode({
            'revision_id': artifact.revisionId,
            'definition_digest': artifact.payload['definitionDigest'],
            'kind': action['kind'],
            'reference': reference,
            'params': action['params'],
          }),
        ),
      );
      submitting = true;
      changed();
      try {
        await flushState();
        if (!r.writable || r.artifact?.revisionId != artifact.revisionId) {
          throw StateError('故事或作品版本已经改变。');
        }
        await widget.onExecute!(artifact.id, command);
        if (mounted && !widget.embedded) Navigator.pop(context);
      } finally {
        submitting = false;
        changed();
      }
      return;
    }
    if (kind == 'advanced-attempt' && value is Map) {
      final action = object(value), artifact = r.artifact;
      if (submitting ||
          !r.writable ||
          artifact == null ||
          action['mode'] != 'attempt' ||
          action['branchId'] != r.branchId ||
          action['version'] != r.revision ||
          action['input'] is! String ||
          (action['input'] as String).trim().isEmpty ||
          (action['input'] as String).length > 10000 ||
          object(artifact.payload['capabilities'])['attempt'] != true) {
        throw StateError('行动不属于当前可执行的作品版本。');
      }
      if (action['kind'] == 'dynamic' &&
          action['definitionDigest'] != artifact.payload['definitionDigest']) {
        throw StateError('作品定义已经改变，请重新读取。');
      }
      submitting = true;
      changed();
      try {
        await flushState();
        if (!r.writable) throw StateError('故事或参数已经改变。');
        if (action['kind'] == 'dynamic' && widget.onContractAttempt != null) {
          final definition = object(artifact.payload['definition']);
          final offered = objects(
            definition['actions'],
          ).where((a) => a['id'] == action['actionId']).firstOrNull;
          if (offered?['mode'] != 'attempt' ||
              action['params'] is! Map ||
              action['targets'] is! List ||
              action['interactionId'] != definition['id'])
            throw const FormatException('尝试引用不完整。');
          await widget.onContractAttempt!({
            'input': action['input'],
            'dynamic_attempt': {
              'definitionDigest': artifact.payload['definitionDigest'],
              'scope': definition['scope'],
              'interactionId': definition['id'],
              'revision': definition['revision'],
              'actionId': action['actionId'],
              'targets': action['targets'],
              'params': action['params'],
            },
          });
        } else {
          await widget.onAttempt(action['input'] as String);
        }
        if (mounted && !widget.embedded) Navigator.pop(context);
      } finally {
        submitting = false;
        changed();
      }
    }
  }

  @override
  void dispose() {
    debounce?.cancel();
    intent.dispose();
    if (r.flushLocalState == flushState) r.flushLocalState = null;
    r.removeListener(changed);
    if (widget.ownsRepository) r.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final artifact = widget.embedded && !r.matchesCurrentStory
        ? null
        : r.artifact;
    final children = <Widget>[
      if (!widget.embedded && widget.panel != 'travel')
        TextField(
          controller: intent,
          maxLength: 2000,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: '想整理成怎样的交互作品',
            hintText: '例如：整理当前路线、物品与可尝试的操作',
          ),
        ),
      if ((!widget.embedded && widget.panel != 'travel') ||
          r.error != null ||
          r.pending != null)
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (!widget.embedded || r.pending == null)
              FilledButton(
                onPressed: r.busy || r.pending != null || !r.isCurrent()
                    ? null
                    : () => run(() => r.prepare(intent.text)),
                child: Text(
                  widget.embedded
                      ? '重试显示'
                      : artifact == null
                      ? '整理交互作品'
                      : '重新整理',
                ),
              ),
            if (r.busy)
              TextButton(onPressed: r.cancel, child: const Text('停止等待')),
            if (r.pending != null && !r.busy)
              OutlinedButton(
                onPressed: () => run(() async {
                  await r.retry();
                  if (r.pending == null) await flushState();
                }),
                child: const Text('恢复作品请求'),
              ),
            if (!widget.embedded) ...[
              TextButton(
                onPressed: r.busy ? null : () => run(() => r.load()),
                child: const Text('读取当前版本'),
              ),
              TextButton(
                onPressed: widget.onEvidence,
                child: const Text('查看已提交的作品依据'),
              ),
            ],
          ],
        ),
      if (r.busy) const LinearProgressIndicator(),
      if (r.pending != null)
        const Text('请求结果尚待确认。停止等待不会撤销服务端已完成的整理；恢复会使用同一个请求编号。'),
      if (r.error != null)
        Text(
          r.error!,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      if (message != null) Text(message!),
      if (!widget.embedded && artifact == null && !r.busy)
        const Text('整理会读取当前公开记录，生成可查看与试填的作品。准备、预览和保存参数不会推进故事。'),
      if (artifact != null)
        ReaderArtifactSurface(
          data: {
            'surface': 'advanced',
            'dark': widget.dark,
            'reduced': widget.reducedMotion,
            'payload': artifact.payload,
            'state': localRevision == artifact.revisionId
                ? localState ?? artifact.state
                : artifact.state,
            'branchId': r.branchId,
            'version': r.revision,
            'revisionId': artifact.revisionId,
            'baseRevision': artifact.baseRevision,
            'headRevisionId': r.head?.revisionId,
            'revisions': r.revisions,
            'busy': r.busy || submitting || r.pending != null || !r.isCurrent(),
            'readonly': !r.displayCurrent,
            'canRestore':
                r.isCurrent() &&
                !r.busy &&
                r.pending == null &&
                artifact.baseRevision == r.revision,
          },
          onMessage: (kind, value) =>
              unawaited(run(() => receive(kind, value))),
          fallback: Text(
            artifact.payload['reason'] as String? ?? '此作品请在网页版查看。',
          ),
        ),
    ];
    return widget.embedded
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          )
        : ReaderPanel(
            title: widget.panel == 'travel' ? '地图与行程' : '交互作品',
            children: children,
          );
  }
}
