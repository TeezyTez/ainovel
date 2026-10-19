/// Client owns observation and local recovery; Go alone owns formal pages.
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'workspace_session.dart';
import 'experience_client.dart';
import 'experience_journal.dart';
import 'experience_models.dart';
import 'experience_failure_copy.dart';

class ExperienceController extends ChangeNotifier {
  ExperienceController({
    required this.session,
    required this.api,
    required this.journal,
    this.navigationNamespace = 'navigation',
  }) {
    _owner = owner;
    session.addListener(_sessionChanged);
  }
  final WorkspaceSession session;
  final ExperienceApi api;
  final ExperienceJournal journal;
  final String navigationNamespace;
  String? _owner;
  int _epoch = 0;
  bool _disposed = false;
  Future<void> _writes = Future.value();
  Timer? _poll;
  List<ExperienceSummary> shelf = [];
  ExperienceView? current;
  ExperienceOperation? operation;
  Json? attempt;
  String draft = '', mode = 'act';
  String? error, storageError;
  bool localReadFailed = false;
  String get navigationScope => experienceScope(
    session.backendUrl,
    session.workspaceId,
    navigationNamespace,
    navigationNamespace,
  );
  bool loading = false, busy = false, unknown = false, notReceived = false;
  double fontSize = 19, offset = 0;
  String get owner => experienceScope(
    session.backendUrl,
    session.workspaceId,
    'workspace',
    'stable',
  );
  bool get workspaceAvailable => true;
  String get scope => experienceScope(
    session.backendUrl,
    workspaceAvailable ? session.workspaceId : null,
    current?.id ?? 'seed',
    current?.branchId ?? 'seed',
  );
  bool get blocked =>
      localReadFailed ||
      busy ||
      unknown ||
      attempt != null && attempt!['settled'] != true ||
      operation?.running == true;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _same(int epoch, String identity) =>
      !_disposed && epoch == _epoch && identity == owner;
  void _sessionChanged() {
    if (_owner == owner) return;
    _owner = owner;
    _epoch++;
    _poll?.cancel();
    current = null;
    operation = null;
    attempt = null;
    shelf = [];
    draft = '';
    error = null;
    storageError = null;
    unknown = false;
    notReceived = false;
    loading = false;
    busy = false;
    fontSize = 19;
    offset = 0;
    _notify();
    unawaited(initialize());
  }

  Future<void> _persist(String key, Json value) {
    final result = _writes.then((_) => journal.patch(key, value));
    _writes = result.then<void>((_) {}, onError: (Object e, StackTrace s) {});
    return result;
  }

  Future<void> initialize() async {
    final identity = owner;
    await newSeed(remember: false);
    if (workspaceAvailable && identity == owner) {
      await refreshShelf();
      try {
        final saved = await journal.read(navigationScope);
        final last = saved['last_view'];
        if (identity == owner && last is Map) {
          await open(
            string(object(last), 'id'),
            branch: string(object(last), 'branch'),
          );
        }
      } catch (_) {
        if (identity == owner) {
          storageError = '上次阅读入口恢复失败；可从书架重新打开，原稿未删除。';
          _notify();
        }
      }
    }
  }

  Future<void> _local(int epoch, String identity) async {
    final key = scope;
    try {
      final saved = await journal.read(key);
      if (!_same(epoch, identity)) return;
      draft = saved['draft'] as String? ?? '';
      mode = saved['mode'] as String? ?? 'act';
      fontSize = ((saved['font_size'] as num?)?.toDouble() ?? 19).clamp(14, 30);
      offset = (saved['offset'] as num?)?.toDouble() ?? 0;
      attempt = saved['attempt'] == null ? null : object(saved['attempt']);
      unknown = attempt != null && attempt!['settled'] != true;
      storageError = null;
      localReadFailed = false;
    } catch (_) {
      if (_same(epoch, identity)) localReadFailed = true;
      if (_same(epoch, identity)) storageError = '本机草稿读取失败。未确认旧请求，暂不发送；请重试读取。';
    }
  }

  Future<void> newSeed({bool remember = true}) async {
    final epoch = ++_epoch, identity = owner;
    _poll?.cancel();
    current = null;
    operation = null;
    attempt = null;
    draft = '';
    error = null;
    unknown = false;
    notReceived = false;
    busy = false;
    offset = 0;
    loading = true;
    _notify();
    await _local(epoch, identity);
    if (!_same(epoch, identity)) return;
    loading = false;
    if (remember && workspaceAvailable) {
      try {
        await _persist(navigationScope, {'last_view': null});
      } catch (_) {
        storageError = '书架入口未能保存；原稿未删除。';
      }
    }
    _notify();
  }

  Future<void> retryLocalStorage() async {
    if (localReadFailed) {
      await _local(_epoch, owner);
      _notify();
    } else {
      await saveDraft(draft);
    }
  }

  Future<void> refreshShelf() async {
    if (!workspaceAvailable) return;
    final identity = owner;
    try {
      final result = await api.list();
      if (identity != owner || _disposed) return;
      shelf = result;
      error = null;
    } catch (e) {
      if (identity == owner && !_disposed) error = _message(e);
    }
    _notify();
  }

  Future<void> open(String id, {String? branch}) async {
    final epoch = ++_epoch, identity = owner;
    _poll?.cancel();
    current = null;
    operation = null;
    attempt = null;
    draft = '';
    unknown = false;
    notReceived = false;
    busy = false;
    loading = true;
    error = null;
    _notify();
    try {
      final view = await api.view(id, branch: branch);
      if (!_same(epoch, identity)) return;
      if (view.id != id || branch != null && view.branchId != branch) {
        throw const FormatException('经历响应归属不符');
      }
      current = view;
      operation = view.operation;
      await _local(epoch, identity);
      if (!_same(epoch, identity)) return;
      try {
        await _persist(navigationScope, {
          'last_view': {'id': view.id, 'branch': view.branchId},
        });
      } catch (_) {
        if (_same(epoch, identity)) storageError = '当前阅读入口未能保存；正文仍来自正式历史。';
      }
      if (attempt?['settled'] == true &&
          attempt?['request_id'] != operation?.requestId) {
        attempt = null;
        unknown = false;
      }
      if (!_same(epoch, identity)) return;
      if (operation != null &&
          (attempt == null || attempt!['request_id'] == operation!.requestId)) {
        unknown = false;
        if (attempt != null) await _recordOperation(operation!, scope);
      }
      _schedule();
    } catch (e) {
      if (_same(epoch, identity)) error = _message(e);
    }
    if (_same(epoch, identity)) {
      loading = false;
      _notify();
    }
  }

  Future<void> saveDraft(String value, {String? selectedMode}) async {
    draft = value;
    if (selectedMode != null) mode = selectedMode;
    final key = scope, identity = owner;
    final values = {'draft': draft, 'mode': mode};
    try {
      await _persist(key, values);
      if (identity == owner && key == scope && !localReadFailed) {
        storageError = null;
      }
    } catch (_) {
      if (identity == owner && key == scope) {
        storageError = '草稿未能保存到本机。请保留输入并重试；不会发送。';
      }
    }
    if (identity == owner && key == scope) _notify();
  }

  Future<void> saveReading({double? size, double? position}) async {
    if (size != null) fontSize = size.clamp(14, 30);
    if (position != null) offset = position;
    final key = scope, identity = owner;
    try {
      await _persist(key, {'font_size': fontSize, 'offset': offset});
    } catch (_) {
      if (identity == owner && key == scope) {
        storageError = '阅读位置/字号保存失败。本次阅读仍可继续，发送前需重试保存。';
      }
    }
    if (size != null || storageError != null) _notify();
  }

  Future<void> send({
    String? explicitMode,
    Json? authorWorld,
    Json? worldVersion,
    String? requestId,
  }) async {
    if (blocked || loading || !workspaceAvailable || storageError != null) {
      return;
    }
    final view = current;
    final selected = explicitMode ?? mode;
    if (view == null && draft.trim().isEmpty ||
        view != null && selected != 'read' && draft.trim().isEmpty) {
      error = view == null ? '写一句想进入的世界即可。' : '行动和询问需要文字；也可以直接继续阅读。';
      _notify();
      return;
    }
    final request = requestId ?? const Uuid().v4();
    final body = view == null
        ? <String, dynamic>{
            'request_id': request,
            'seed': draft,
            if (authorWorld != null)
              'author_world': jsonDecode(jsonEncode(authorWorld)),
            if (worldVersion != null)
              'world_version': jsonDecode(jsonEncode(worldVersion)),
          }
        : <String, dynamic>{
            'request_id': request,
            'branch_id': view.branchId,
            'expected_revision': view.revision,
            'mode': selected,
            'input': selected == 'read' ? '' : draft,
          };
    await _start({
      'kind': view == null ? 'create' : 'operation',
      'request_id': request,
      'experience_id': view?.id,
      'branch_id': view?.branchId,
      'body': body,
      'draft': draft,
      'settled': false,
    });
  }

  Future<void> fork(
    int revision,
    String name, {
    KnownInformation? fact,
    String? text,
  }) async {
    final view = current;
    if (view == null ||
        blocked ||
        storageError != null ||
        name.trim().isEmpty) {
      return;
    }
    final request = const Uuid().v4();
    await _start({
      'kind': 'branch',
      'request_id': request,
      'experience_id': view.id,
      'branch_id': view.branchId,
      'draft': draft,
      'settled': false,
      'body': {
        'request_id': request,
        'from_branch_id': view.branchId,
        'from_revision': revision,
        'name': name,
        if (fact != null && text != null)
          'edit': {'fact_id': fact.id, 'text': text},
      },
    });
  }

  Future<void> executeArtifact(
    String artifactId,
    Json action, {
    String? requestId,
  }) async {
    final view = current;
    if (view == null || blocked || loading || storageError != null) return;
    if (api is! ExperienceArtifactApi)
      throw const FormatException('当前阅读模式不支持正式规则执行。');
    if (artifactId.isEmpty ||
        action['revision_id'] is! String ||
        action['definition_digest'] is! String ||
        action.containsKey('expected_head') &&
            action['expected_head'] is! String ||
        !const {'dynamic', 'game', 'journey'}.contains(action['kind']) ||
        action['reference'] == null ||
        action['params'] is! Map ||
        action.keys.any(
          (key) => !const {
            'revision_id',
            'expected_head',
            'definition_digest',
            'kind',
            'reference',
            'params',
          }.contains(key),
        )) {
      throw const FormatException('作品行动引用不完整。');
    }
    final request = requestId ?? const Uuid().v4();
    final body = <String, dynamic>{
      'request_id': request,
      'branch_id': view.branchId,
      'expected_revision': view.revision,
      ...object(jsonDecode(jsonEncode(action))),
    };
    await _start({
      'kind': 'artifact',
      'artifact_id': artifactId,
      'request_id': request,
      'experience_id': view.id,
      'branch_id': view.branchId,
      'body': body,
      'draft': draft,
      'settled': false,
    });
  }

  /// Explicitly reviewed corrections use the same durable, idempotent branch
  /// request path as ordinary forks. Go validates and commits the new branch.
  Future<void> forkChange(int revision, String name, Json change) async {
    final view = current;
    if (view == null || blocked || storageError != null || name.trim().isEmpty)
      return;
    final corrections = change.keys
        .where((key) => key != 'author_world')
        .toList();
    if (corrections.length != 1 ||
        !const {
          'polish',
          'repair',
          'world_version',
        }.contains(corrections.single) ||
        change[corrections.single] is! Map ||
        change.containsKey('author_world') &&
            (corrections.single != 'world_version' ||
                change['author_world'] is! Map)) {
      throw const FormatException('一次分支只能确认一种修正；作者资料只能随世界版本提交。');
    }
    final submittedChange = object(jsonDecode(jsonEncode(change)));
    final request = const Uuid().v4();
    await _start({
      'kind': 'branch',
      'request_id': request,
      'experience_id': view.id,
      'branch_id': view.branchId,
      'draft': draft,
      'settled': false,
      'body': {
        'request_id': request,
        'from_branch_id': view.branchId,
        'from_revision': revision,
        'expected_revision': view.revision,
        'name': name,
        ...submittedChange,
      },
    });
  }

  Future<void> _start(Json record) async {
    final epoch = _epoch, identity = owner, key = scope;
    busy = true;
    error = null;
    _notify();
    try {
      // Must durably persist exact request + draft before any POST.
      await _persist(key, {'attempt': record, 'draft': draft, 'mode': mode});
    } catch (_) {
      if (_same(epoch, identity)) {
        busy = false;
        storageError = '草稿及请求编号保存失败，未发送。请重试保存。';
        _notify();
      }
      return;
    }
    if (!_same(epoch, identity)) return;
    attempt = record;
    unknown = true;
    _notify(); // 持久化完毕、POST在途也可见，不把等待藏成无响应。
    await _transmit(record, epoch, identity, key);
  }

  /// Bind only the exact private snapshot persisted with the accepted request.
  /// This also runs on receipt recovery before the request is marked settled.
  Future<void> _bindAuthorVersion(Json record, ExperienceView view) async {
    final body = object(record['body']);
    if (body['author_world'] is! Map || body['world_version'] is! Map) return;
    final author = object(body['author_world']),
        version = object(body['world_version']);
    if (version['id'] is! String ||
        (version['id'] as String).isEmpty ||
        version['version'] is! int) {
      throw const FormatException('已提交的世界版本关联不完整。');
    }
    final bindingScope = experienceScope(
      session.backendUrl,
      session.workspaceId,
      'story-worlds',
      'versions',
    );
    final all = await journal.read(bindingScope);
    final previous = all[view.id] is Map
        ? object(all[view.id])
        : <String, dynamic>{};
    final snapshot = <String, dynamic>{...author, 'id': version['id']};
    final branches = previous['branches'] is Map
        ? object(previous['branches'])
        : <String, dynamic>{};
    final old = record['kind'] == 'branch' ? branches[view.branchId] : previous;
    if (old is Map &&
        old['version'] == version['version'] &&
        jsonEncode(old['snapshot']) == jsonEncode(snapshot))
      return;
    final linked = <String, dynamic>{
      'snapshot': snapshot,
      'version': version['version'],
      'savedAt': DateTime.now().toUtc().toIso8601String(),
    };
    final next = record['kind'] == 'branch'
        ? <String, dynamic>{
            ...previous,
            'branches': {...branches, view.branchId: linked},
          }
        : <String, dynamic>{...previous, ...linked};
    await _persist(bindingScope, {view.id: next});
  }

  Future<void> _transmit(
    Json record,
    int epoch,
    String identity,
    String key,
  ) async {
    try {
      final body = object(record['body']);
      if (record['kind'] == 'operation' || record['kind'] == 'artifact') {
        final op = record['kind'] == 'artifact'
            ? await (api as ExperienceArtifactApi).executeArtifact(
                record['experience_id'] as String,
                record['artifact_id'] as String,
                body,
              )
            : await api.submit(record['experience_id'] as String, body);
        if (!_same(epoch, identity)) return;
        _validateOperation(
          op,
          record['experience_id'] as String,
          record['branch_id'] as String,
          record['request_id'] as String,
        );
        await _recordOperation(op, key);
        if (!_same(epoch, identity)) return;
        operation = op;
        unknown = false;
        if (op.status == 'committed') await _refreshCurrent(epoch, identity);
        _schedule();
      } else {
        final view = record['kind'] == 'create'
            ? await api.create(body)
            : await api.branch(record['experience_id'] as String, body);
        if (!_same(epoch, identity)) return;
        if (record['kind'] == 'branch' && view.id != record['experience_id']) {
          throw const FormatException('分支响应归属不符');
        }
        await _bindAuthorVersion(record, view);
        if (!_same(epoch, identity)) return;
        await _persist(key, {
          'attempt': {
            ...record,
            'settled': true,
            'experience_id': view.id,
            'result_branch_id': view.branchId,
          },
          // Creation consumes only the submitted seed, never a newer seed edit.
          // The destination experience/branch has its own independent act draft.
          if (record['kind'] == 'create' && draft == record['draft'])
            'draft': '',
        });
        if (!_same(epoch, identity)) return;
        await _showReceived(view);
        unawaited(refreshShelf());
      }
    } catch (e) {
      if (_same(epoch, identity)) {
        final rejected =
            e is ExperienceHttpException &&
            const {400, 403, 404, 409, 422}.contains(e.status);
        if (rejected) {
          final next = {...record, 'status': 'rejected', 'settled': true};
          try {
            await _persist(key, {'attempt': next});
            if (_same(epoch, identity)) {
              attempt = next;
              unknown = false;
              error = '服务端未接纳这次请求。${_message(e)} 原稿保留，可核对当前历史后修改。';
            }
          } catch (_) {
            if (_same(epoch, identity)) {
              unknown = true;
              storageError = '拒绝结果未能保存；请查询原请求确认后继续。';
            }
          }
        } else {
          unknown = true;
          error = '请求结果尚未确认。${_message(e)} 请查询原请求，不会自动重发。';
        }
      }
    }
    if (_same(epoch, identity)) {
      busy = false;
      _notify();
    }
  }

  Future<void> _showReceived(ExperienceView view) async {
    final epoch = ++_epoch, identity = owner;
    _poll?.cancel();
    current = view;
    operation = view.operation;
    attempt = null;
    draft = '';
    error = null;
    busy = false;
    loading = true;
    unknown = false;
    notReceived = false;
    await _local(epoch, identity);
    if (!_same(epoch, identity)) return;
    try {
      await _persist(navigationScope, {
        'last_view': {'id': view.id, 'branch': view.branchId},
      });
    } catch (_) {
      if (_same(epoch, identity)) storageError = '阅读入口未能保存；正式经历仍可从书架恢复。';
    }
    if (!_same(epoch, identity)) return;
    loading = false;
    _schedule();
    _notify();
  }

  void _validateOperation(
    ExperienceOperation op,
    String experience,
    String branch,
    String request,
  ) {
    if (op.experienceId != experience ||
        op.branchId != branch ||
        op.requestId != request) {
      throw const FormatException('操作响应归属不符');
    }
  }

  Future<void> _recordOperation(ExperienceOperation op, String key) async {
    final old = attempt;
    if (old == null || old['request_id'] != op.requestId) return;
    final next = {...old, 'status': op.status, 'settled': !op.running};
    final submittedDraft = old['draft'];
    final clearDraft =
        old['kind'] != 'artifact' &&
        op.status == 'committed' &&
        draft == submittedDraft &&
        object(old['body'])['mode'] != 'read';
    await _persist(key, {'attempt': next, if (clearDraft) 'draft': ''});
    if (key == scope) {
      attempt = next;
      if (clearDraft && draft == submittedDraft) draft = '';
    }
  }

  Future<void> _refreshCurrent(int epoch, String identity) async {
    final before = current;
    if (before == null) return;
    final view = await api.view(before.id, branch: before.branchId);
    if (_same(epoch, identity) &&
        current?.id == view.id &&
        current?.branchId == view.branchId) {
      current = view;
      // Never replace submitted text with candidate/stream. Only this GET yields pages.
    }
  }

  Future<void> recover() async {
    if (busy || !workspaceAvailable) return;
    final epoch = _epoch, identity = owner, key = scope;
    final record = attempt;
    final active = operation;
    if (record?['settled'] == true && active?.running != true && !unknown) {
      if (current != null) {
        await open(current!.id, branch: current!.branchId);
      } else {
        await refreshShelf();
      }
      return;
    }
    if (record == null && active == null) {
      final view = current;
      if (view == null) {
        await newSeed();
      } else {
        await open(view.id, branch: view.branchId);
      }
      return;
    }
    busy = true;
    error = null;
    notReceived = false;
    _notify();
    try {
      if (record != null &&
          record['kind'] != 'operation' &&
          record['kind'] != 'artifact') {
        final receipt = await api.receipt(record['request_id'] as String);
        if (!_same(epoch, identity)) return;
        if (receipt['request_id'] != record['request_id'] ||
            receipt['kind'] != record['kind']) {
          throw const FormatException('回执归属不符');
        }
        final id = string(receipt, 'experience_id'),
            branch = string(receipt, 'branch_id');
        final view = await api.view(id, branch: branch);
        if (!_same(epoch, identity)) return;
        if (view.id != id ||
            view.branchId != branch ||
            record['kind'] == 'branch' && id != record['experience_id']) {
          throw const FormatException('恢复的世界版本归属不符');
        }
        await _bindAuthorVersion(record, view);
        if (!_same(epoch, identity)) return;
        await _persist(key, {
          'attempt': {
            ...record,
            'settled': true,
            'experience_id': id,
            'result_branch_id': branch,
          },
          if (record['kind'] == 'create' && draft == record['draft'])
            'draft': '',
        });
        if (!_same(epoch, identity)) return;
        await _showReceived(view);
        unawaited(refreshShelf());
      } else {
        final id = record?['experience_id'] as String? ?? active!.experienceId;
        final request = record?['request_id'] as String? ?? active!.requestId;
        final branch = record?['branch_id'] as String? ?? active!.branchId;
        final op = await api.operation(id, request);
        if (!_same(epoch, identity)) return;
        _validateOperation(op, id, branch, request);
        await _recordOperation(op, key);
        if (!_same(epoch, identity)) return;
        operation = op;
        unknown = false;
        if (op.status == 'committed') await _refreshCurrent(epoch, identity);
        _schedule();
      }
    } catch (e) {
      if (_same(epoch, identity)) {
        unknown = true;
        notReceived = record != null && _status(e) == 404;
        error = notReceived
            ? '服务端未找到原请求。可明确选择用相同编号、相同正文再提交，不会创建新编号。'
            : '仍无法确认结果。${_message(e)}';
      }
    }
    if (_same(epoch, identity)) {
      busy = false;
      _notify();
    }
  }

  Future<void> resendSameRequest() async {
    if (!notReceived ||
        busy ||
        attempt == null ||
        !workspaceAvailable ||
        storageError != null) {
      return;
    }
    final record = attempt!;
    busy = true;
    notReceived = false;
    _notify();
    await _transmit(record, _epoch, owner, scope);
  }

  Future<void> cancel() async {
    if (busy || !workspaceAvailable) return;
    final view = current;
    final request = operation?.requestId ?? attempt?['request_id'] as String?;
    if (view == null || request == null) return;
    final epoch = _epoch, identity = owner, key = scope;
    busy = true;
    error = null;
    _notify();
    try {
      final op = await api.cancel(view.id, request);
      if (!_same(epoch, identity)) return;
      _validateOperation(op, view.id, view.branchId, request);
      await _recordOperation(op, key);
      if (!_same(epoch, identity)) return;
      operation = op;
      unknown = false;
      if (op.status == 'committed') {
        error = '正文已正式提交，不能撤销；可从历史位置另开分支。';
        await _refreshCurrent(epoch, identity);
      }
      _schedule();
    } catch (e) {
      if (_same(epoch, identity)) {
        unknown = true;
        error = '取消结果未确认；不表示已停止。${_message(e)}';
      }
    }
    if (_same(epoch, identity)) {
      busy = false;
      _notify();
    }
  }

  void _schedule() {
    _poll?.cancel();
    if (operation?.running == true && !unknown && !_disposed) {
      _poll = Timer(const Duration(seconds: 2), () async {
        await recover();
      });
    }
  }

  int? _status(Object e) => e is ExperienceHttpException ? e.status : null;
  String _message(Object e) {
    final code = e is ExperienceHttpException ? e.code : null;
    final recall = experienceRecallFailure(code);
    if (recall != null) return '$recall。';
    if (code != null && code.isNotEmpty) return '服务提示：$code。';
    if (e is FormatException) return '服务响应无法校验，未显示为成功。';
    return '服务或网络暂不可用。';
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _poll?.cancel();
    session.removeListener(_sessionChanged);
    super.dispose();
  }
}
