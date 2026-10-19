// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:async';
import 'dart:html' as html;
class PortalRouteBridge {
  PortalRouteBridge(void Function(String) onChanged) {
    _changes = html.window.onPopState.listen((_) => onChanged(current));
    _hashes = html.window.onHashChange.listen((_) => onChanged(current));
  }
  late final StreamSubscription<html.PopStateEvent> _changes;
  late final StreamSubscription<html.Event> _hashes;
  String get current => html.window.location.hash.isEmpty ? '/' : html.window.location.hash.substring(1);
  void go(String path) {
    if (current != path) html.window.history.pushState(null, '', '#$path');
  }
  void dispose() { _changes.cancel(); _hashes.cancel(); }
}
