// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:convert';
import 'dart:async';
import 'dart:html' as html;
import 'dart:ui_web' as ui_web;
import 'package:flutter/material.dart';

/// Only the original decorative WebGL sculpture is hosted in this element.
/// Navigation, catalog, preferences and all product controls remain Flutter.
class PortalScene extends StatefulWidget {
  const PortalScene({
    super.key,
    required this.dark,
    required this.paused,
    required this.reduced,
    required this.progress,
  });
  final bool dark, paused, reduced;
  final double progress;
  @override
  State<PortalScene> createState() => _PortalSceneState();
}

class _PortalSceneState extends State<PortalScene> {
  static int _serial = 0;
  late final String _viewType;
  late final html.IFrameElement _frame;
  StreamSubscription<html.Event>? _loaded;
  bool _disposed = false;
  @override
  void initState() {
    super.initState();
    _viewType = 'elselife-sculpture-${_serial++}';
    _frame = html.IFrameElement()
      ..src = 'assets/assets/portal_scene/scene.html?v=20261019-restored'
      ..setAttribute('title', '')
      ..setAttribute('aria-hidden', 'true')
      ..tabIndex = -1
      ..style.border = '0'
      ..style.width = '100%'
      ..style.height = '100%'
      ..style.pointerEvents = 'none';
    _loaded = _frame.onLoad.listen((_) {
      if (mounted) _sync();
    });
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) => _frame);
  }

  void _send(Map<String, Object> data) {
    if (_disposed || _frame.isConnected != true) return;
    // Flutter may detach platform views before State.dispose. dart:html can
    // retain a Window wrapper whose underlying frame window is already gone.
    try {
      _frame.contentWindow?.postMessage(jsonEncode(data), html.window.location.origin);
    } catch (_) {
      // Decorative lifecycle messages must not interrupt route disposal.
    }
  }
  void _sync() => _send({
    'type': 'elselife-scene',
    'dark': widget.dark,
    'paused': widget.paused,
    'reduced': widget.reduced,
    'progress': widget.progress,
  });
  @override
  void didUpdateWidget(covariant PortalScene oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.dark != widget.dark || oldWidget.paused != widget.paused ||
        oldWidget.reduced != widget.reduced || oldWidget.progress != widget.progress) {
      _sync();
    }
  }

  @override
  void dispose() {
    _send({'type': 'elselife-dispose'});
    _disposed = true;
    unawaited(_loaded?.cancel());
    _frame.remove();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MouseRegion(
    onHover: widget.paused || widget.reduced ? null : (event) => _send({
      'type': 'elselife-pointer',
      'x': event.localPosition.dx,
      'y': event.localPosition.dy,
    }),
    onExit: (_) => _send({'type': 'elselife-pointer-exit'}),
    child: ExcludeSemantics(child: HtmlElementView(viewType: _viewType)),
  );
}
