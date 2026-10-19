import 'package:flutter/foundation.dart';
import 'experience_journal.dart';
import 'experience_models.dart';

/// Private reading aids. These never become world facts or model context.
class ReaderLocalState extends ChangeNotifier {
  ReaderLocalState(this.journal);
  final ExperienceJournal journal;
  String scope = '';
  Json values = {};
  String? error;
  bool loaded = false, _disposed = false;
  int _epoch = 0;
  Future<void> _writes = Future.value();
  List<Json> get entries =>
      (values['entries'] as List? ?? []).map((v) => object(v)).toList();
  List<Json> get references =>
      (values['references'] as List? ?? []).map((v) => object(v)).toList();
  List<String> get followed =>
      (values['followed'] as List? ?? []).cast<String>();
  int get page => (values['page'] as num?)?.toInt() ?? 0;
  bool get focus => values['focus'] == true;
  String get participation => values['participation'] as String? ?? 'act';
  Future<void> open(String next) async {
    final token = ++_epoch;
    scope = next;
    values = {};
    loaded = false;
    error = null;
    _emit();
    await _writes;
    try {
      final record = await journal.read(next);
      if (token != _epoch || _disposed) return;
      final saved = record['reader_personal'];
      values = saved is Map ? object(saved) : {};
      loaded = true;
    } catch (_) {
      if (token != _epoch || _disposed) return;
      error = '私人记录读取失败，原记录仍保留。请重试读取。';
    }
    _emit();
  }

  Future<void> update(Json patch) async {
    if (!loaded) return;
    values = {...values, ...patch};
    final snapshot = Map<String, dynamic>.from(values),
        key = scope,
        token = _epoch;
    _emit();
    final job = _writes.then((_) async {
      try {
        await journal.patch(key, {'reader_personal': snapshot});
        if (token == _epoch) error = null;
      } catch (_) {
        if (token == _epoch) error = '私人记录尚未保存，请重试。';
      }
      if (token == _epoch) _emit();
    });
    _writes = job;
    await job;
  }

  Future<void> annotate(
    String kind,
    int revision,
    String quote, {
    String text = '',
    String objectId = '',
  }) => update({
    'entries': [
      ...entries,
      {
        'id': '${DateTime.now().microsecondsSinceEpoch}-${entries.length}',
        'kind': kind,
        'revision': revision,
        'quote': quote,
        'text': text,
        'object_id': objectId,
        'created_at': DateTime.now().toIso8601String(),
      },
    ],
  });
  Future<void> remove(String id) =>
      update({'entries': entries.where((e) => e['id'] != id).toList()});
  Future<void> reference(int revision, String quote) => update({
    'references': [
      ...references,
      {'revision': revision, 'quote': quote},
    ].reversed.take(5).toList().reversed.toList(),
  });
  Future<void> follow(String id) => update({
    'followed': followed.contains(id)
        ? followed.where((x) => x != id).toList()
        : [...followed, id],
  });
  Future<void> retry() => loaded ? update({}) : open(scope);
  Future<void> get pendingWrites => _writes;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_epoch;
    super.dispose();
  }
}

/// Bounded time instructions are submitted as an explicit act to the formal API.
String readerTimeInstruction({
  required String mode,
  required String goal,
  required String limit,
  String forbidden = '',
  String reserved = '重大承诺、借贷、关系表态或不可逆决定',
}) {
  final g = goal.trim(), l = limit.trim();
  if (g.isEmpty) throw const FormatException('请填写等待多久、等待的事件或这一段想做的事。');
  if (mode != 'short' && l.isEmpty)
    throw const FormatException('请填写最晚到什么时候结束。');
  final wait = mode != 'skip';
  return '本次${wait ? '等待' : '推进'}：${mode == 'short' ? '在当前位置等待' : g}。'
      '到达：${wait ? g : '授权范围结束，或保留的事情发生时'}；最多：${mode == 'short' ? g : l}。'
      '不能：${forbidden.trim().isEmpty ? '未经同意承担重大承诺、借贷、亲密关系或不可逆代价' : forbidden.trim()}。'
      '遇到${reserved.trim().isEmpty ? '重大承诺、借贷、关系表态或不可逆决定' : reserved.trim()}，请在执行该决定前停下，让我接手。';
}
