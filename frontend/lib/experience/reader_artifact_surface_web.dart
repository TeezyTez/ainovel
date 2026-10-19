import 'dart:convert';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'dart:math';
import 'dart:ui_web' as ui_web;
import 'package:flutter/widgets.dart';

/// Hosts only the original trusted display components. All world actions are
/// explicitly routed back to the formal controller by the owning screen.
class ReaderArtifactSurface extends StatefulWidget {
  const ReaderArtifactSurface({
    super.key,
    required this.data,
    required this.onMessage,
    required this.fallback,
  });
  final Map<String, dynamic> data;
  final void Function(String kind, dynamic value) onMessage;
  final Widget fallback;
  @override
  State<ReaderArtifactSurface> createState() => _ReaderArtifactSurfaceState();
}

class _ReaderArtifactSurfaceState extends State<ReaderArtifactSurface> {
  static int serial = 0;
  late final String viewType, token;
  late final web.HTMLIFrameElement frame;
  late final JSFunction messageListener, loadListener;
  bool disposed = false;
  double height = 420;
  @override
  void initState() {
    super.initState();
    viewType = 'elselife-reader-artifact-${serial++}';
    token = List.generate(
      4,
      (_) => Random.secure().nextInt(1 << 30).toRadixString(36),
    ).join();
    frame = web.document.createElement('iframe') as web.HTMLIFrameElement
      ..src = 'assets/assets/reader_artifact/renderer.html#$token'
      ..title = widget.data['surface'] == 'context' ? '已知资料' : '交互作品'
      ..style.border = '0'
      ..style.width = '100%'
      ..style.height = '100%';
    loadListener = ((web.Event _) {
      if (mounted) sync();
    }).toJS;
    frame.addEventListener("load", loadListener);
    messageListener = ((web.MessageEvent event) {
      if (!mounted ||
          disposed ||
          frame.isConnected != true ||
          !identical(event.source, frame.contentWindow) ||
          event.origin != web.window.location.origin ||
          event.data == null ||
          !event.data!.typeofEquals("string"))
        return;
      final raw = (event.data as JSString).toDart;
      if (raw.length > 1100000) return;
      try {
        final message = jsonDecode(raw);
        if (message is! Map ||
            message['channel'] != 'elselife-reader-artifact' ||
            message['token'] != token)
          return;
        final kind = message['kind'], value = message['value'];
        if (kind == 'ready') {
          sync();
          return;
        }
        if (kind == 'height' && value is num && value.isFinite) {
          final next = value.toDouble().clamp(260, 1800).toDouble();
          if ((next - height).abs() > 1) setState(() => height = next);
          return;
        }
        if (kind is String &&
            const {
              'params',
              'draft',
              'source',
              'export',
              'cancel',
              'import',
              'restore',
              'context-selection',
              'context-presentation',
              'context-pin',
              'context-close',
              'context-source',
              'gameplay-history',
              'advanced-state',
              'advanced-repair',
              'advanced-current-map',
              'advanced-open-map',
              'advanced-inspect',
              'advanced-attempt',
              'advanced-execute',
              'advanced-history',
              'advanced-restore',
            }.contains(kind))
          widget.onMessage(kind, value);
      } on FormatException {
        return;
      }
    }).toJS;
    web.window.addEventListener("message", messageListener);
    ui_web.platformViewRegistry.registerViewFactory(viewType, (_) => frame);
  }

  void send(String kind, dynamic value) {
    if (disposed || frame.isConnected != true) return;
    final target = frame.contentWindow;
    if (target == null) return;
    target.postMessage(
      jsonEncode({
        'channel': 'elselife-reader-artifact',
        'token': token,
        'kind': kind,
        'value': value,
      }).toJS,
      web.window.location.origin.toJS,
    );
  }

  void sync() => send('render', widget.data);
  @override
  void didUpdateWidget(covariant ReaderArtifactSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (jsonEncode(oldWidget.data) != jsonEncode(widget.data)) sync();
  }

  @override
  void dispose() {
    send('dispose', null);
    disposed = true;
    web.window.removeEventListener("message", messageListener);
    frame.removeEventListener("load", loadListener);
    frame.remove();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: HtmlElementView(viewType: viewType),
  );
}
