class PortalRouteBridge {
  PortalRouteBridge(void Function(String) onChanged);
  String get current => '/';
  void go(String path) {}
  void dispose() {}
}
