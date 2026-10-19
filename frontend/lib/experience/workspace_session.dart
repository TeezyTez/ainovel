import 'dart:async';
import 'package:flutter/foundation.dart';
import 'experience_journal.dart';

/// One local development workspace, not an account or authorization boundary.
class WorkspaceSession extends ChangeNotifier {
  // Public backendUrl parameter intentionally hides mutable storage.
  WorkspaceSession({required String backendUrl, this.appearanceJournal})
    // ignore: prefer_initializing_formals
    : _backendUrl = backendUrl;
  final ExperienceJournal? appearanceJournal;
  String? appearanceError;
  bool _disposed = false;
  Future<void> _writes = Future.value();
  String get _appearanceScope =>
      experienceScope(backendUrl, workspaceId, 'appearance', 'settings');
  Future<void> hydrate() async {
    final scope = _appearanceScope;
    try {
      final values = await appearanceJournal?.read(scope);
      if (_disposed || scope != _appearanceScope) return;
      _themeId = values?['theme'] as String? ?? 'mist';
      _reduceMotion = values?['reduce_motion'] as bool? ?? false;
      appearanceError = null;
    } catch (_) {
      if (_disposed || scope != _appearanceScope) return;
      appearanceError = '外观偏好读取失败；原存储未删除。';
    }
    if (!_disposed) notifyListeners();
  }

  void _saveAppearance() {
    final scope = _appearanceScope;
    final values = <String, dynamic>{
      'theme': _themeId,
      'reduce_motion': _reduceMotion,
    };
    _writes = _writes.then((_) async {
      try {
        await appearanceJournal?.patch(scope, values);
        appearanceError = null;
      } catch (_) {
        appearanceError = '外观偏好未能保存到本机。';
      }
      if (!_disposed) notifyListeners();
    });
  }

  Future<void> get pendingWrites => _writes;
  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  String _backendUrl;
  String get backendUrl => _backendUrl;
  set backendUrl(String value) {
    if (_backendUrl == value) return;
    _backendUrl = value;
    _themeId = 'mist';
    _reduceMotion = false;
    notifyListeners();
    unawaited(hydrate());
  }

  String get workspaceId => 'local-workspace';
  String _themeId = 'mist';
  String get themeId => _themeId;
  set themeId(String value) {
    _themeId = value;
    _saveAppearance();
    notifyListeners();
  }

  bool _reduceMotion = false;
  bool get reduceMotion => _reduceMotion;
  set reduceMotion(bool value) {
    _reduceMotion = value;
    _saveAppearance();
    notifyListeners();
  }
}
