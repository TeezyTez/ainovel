import 'dart:async';
import 'package:flutter/material.dart';
import 'experience_models.dart';
import 'reader_interaction_snapshot.dart';
import '../portal/portal_service_client.dart';
import 'reader_artifact_repository.dart';
import 'reader_artifact_surface.dart';

class ReaderHistoricalInteraction extends StatefulWidget {
  const ReaderHistoricalInteraction({
    super.key,
    required this.snapshot,
    required this.clientFactory,
    required this.experienceId,
    required this.branchId,
    this.dark = false,
  });
  final ReaderInteractionSnapshot snapshot;
  final PortalServiceClient Function() clientFactory;
  final String experienceId, branchId;
  final bool dark;
  @override
  State<ReaderHistoricalInteraction> createState() =>
      _ReaderHistoricalInteractionState();
}

class _ReaderHistoricalInteractionState
    extends State<ReaderHistoricalInteraction> {
  late PortalServiceClient client;
  PreparedReaderArtifact? artifact;
  String? error;
  @override
  void initState() {
    super.initState();
    client = widget.clientFactory();
    unawaited(load());
  }

  Future<void> load() async {
    try {
      final value = await widget.snapshot.read(
        client,
        widget.experienceId,
        widget.branchId,
      );
      if (mounted)
        setState(() {
          artifact = value;
          error = null;
        });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  @override
  void dispose() {
    client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (error != null)
      return ExpansionTile(
        title: const Text('当时的记录'),
        children: [
          Text(error!),
          TextButton(onPressed: load, child: const Text('重新读取此版本')),
        ],
      );
    if (artifact == null) return const SizedBox.shrink();
    if (artifact!.payload['definition'] == null) return const SizedBox.shrink();
    return ReaderArtifactSurface(
      data: {
        'surface': 'historical-interaction',
        'payload': artifact!.payload,
        'state': widget.snapshot.state,
        'dark': widget.dark,
        'readonly': true,
      },
      onMessage: (_, __) {},
      fallback: ExpansionTile(
        title: Text(
          '当时的记录 · ${object(artifact!.payload['definition'])['title']}',
        ),
        children: [
          Text(
            object(artifact!.payload['definition'])['summary'] as String? ?? '',
          ),
        ],
      ),
    );
  }
}
