import 'package:flutter/widgets.dart';

class ReaderArtifactSurface extends StatelessWidget {
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
  Widget build(BuildContext context) => fallback;
}
