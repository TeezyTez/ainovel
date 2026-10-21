import 'package:flutter/foundation.dart';
import '../experience/experience_journal.dart';
import '../experience/experience_models.dart';

/// Local reading and new-story defaults, matching demo storage.js/settings-ui.js.
class PortalPreferences extends ChangeNotifier {
  PortalPreferences({required this.journal, required this.backendUrl,
    required this.workspaceId, String initialTheme = 'light'}) {
    _values['theme'] = initialTheme;
  }
  final ExperienceJournal journal;
  final String backendUrl, workspaceId;
  final Json _values = Map.of(defaults);
  static const Json defaults = {
    'theme': 'light', 'fontSize': 18.0, 'lineHeight': 1.95, 'width': 720.0,
    'fontFamily': 'serif', 'paragraphGap': 'normal', 'readingMode': 'continuous',
    'readingTheme': 'paper', 'showTime': true, 'restReminder': false,
    'reducedMotion': false, 'sendEnter': false, 'perspective': '第二人称',
    'length': '适中', 'pace': '从容',
  };
  static const _choices = {
    'theme': ['light', 'dark', 'system'],
    'fontFamily': ['serif', 'sans', 'system'],
    'paragraphGap': ['normal', 'wide', 'compact'],
    'readingMode': ['continuous', 'paged'],
    'readingTheme': ['paper', 'white', 'sage', 'night'],
    'perspective': ['第二人称', '第一人称', '第三人称'],
    'length': ['简短', '适中', '舒展'], 'pace': ['从容', '适中', '紧凑'],
  };
  String get scope => experienceScope(backendUrl, workspaceId, 'portal-preferences', 'settings');
  String? error;
  bool loaded = false, _disposed = false;
  Future<void> _writes = Future.value();
  Json get values => Map.of(_values);
  String text(String key) => _values[key] as String;
  double number(String key) => (_values[key] as num).toDouble();
  bool enabled(String key) => _values[key] == true;
  String get theme => text('theme');
  double get fontSize => number('fontSize');
  double get lineHeight => number('lineHeight');
  double get width => number('width');
  String get fontFamily => text('fontFamily');
  String get paragraphGap => text('paragraphGap');
  String get readingMode => text('readingMode');
  String get readingTheme => text('readingTheme');
  bool get showTime => enabled('showTime');
  bool get restReminder => enabled('restReminder');
  bool get reducedMotion => enabled('reducedMotion');
  bool get sendEnter => enabled('sendEnter');

  Object? _valid(String key, Object? value) {
    if (!defaults.containsKey(key)) return null;
    if (_choices.containsKey(key)) return _choices[key]!.contains(value) ? value : null;
    if (defaults[key] is bool) return value is bool ? value : null;
    if (value is! num || !value.isFinite) return null;
    return switch (key) {
      'fontSize' => value.toDouble().clamp(16, 30),
      'lineHeight' => value.toDouble().clamp(1.5, 2.5),
      'width' => value.toDouble().clamp(480, 880),
      _ => null,
    };
  }
  Future<void> hydrate() async {
    try {
      final saved = await journal.read(scope);
      if (_disposed) return;
      for (final entry in saved.entries) {
        final value = _valid(entry.key, entry.value);
        if (value != null) _values[entry.key] = value;
      }
      error = null;
    } catch (_) { error = '偏好读取失败，原数据仍保留。'; }
    loaded = true;
    if (!_disposed) notifyListeners();
  }
  Future<void> setValue(String key, Object? value) async {
    final valid = _valid(key, value);
    if (valid == null) throw ArgumentError('Invalid preference $key');
    _values[key] = valid;
    if (!_disposed) notifyListeners();
    await _save({key: valid});
  }
  Future<void> restore(Json values) async {
    final valid = <String, dynamic>{};
    for (final entry in values.entries) {
      final value = _valid(entry.key, entry.value);
      if (value != null) valid[entry.key] = value;
    }
    _values.addAll(valid);
    if (!_disposed) notifyListeners();
    await _save(valid);
  }
  Future<void> resetReading() => restore({
    for (final key in ['fontSize','lineHeight','width','fontFamily','paragraphGap','readingTheme','theme','reducedMotion'])
      key: defaults[key],
  });
  Future<void> retry() => _save(values);
  Future<void> _save(Json patch) {
    final next = _writes.then((_) async {
      try { await journal.patch(scope, patch); error = null; }
      catch (_) { error = '偏好尚未保存，请重试。'; }
      if (!_disposed) notifyListeners();
    });
    _writes = next;
    return next;
  }
  Future<void> get pendingWrites => _writes;
  @override
  void dispose() { _disposed = true; super.dispose(); }
}
