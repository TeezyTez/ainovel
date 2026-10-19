/// Shared reader shell for the explicitly labelled, device-local source demo.
library;

import 'package:flutter/material.dart';
import '../experience/experience_controller.dart';
import '../experience/experience_models.dart';
import '../experience/experience_screen.dart';
import '../experience/portal_demo_experience_api.dart';
import '../experience/reader_panels.dart';
import '../experience/workspace_session.dart';
import 'portal_demo_repository.dart';
import 'portal_preferences.dart';

class PortalDemoReader extends StatefulWidget {
  const PortalDemoReader({
    super.key,
    required this.repository,
    required this.sessionId,
    required this.opening,
    this.preferences,
    this.authorWorld,
    this.onHome,
    this.onShelf,
    this.onDiscover,
    this.onChanged,
    this.onPreferences,
  });
  final PortalDemoRepository repository;
  final String sessionId, opening;
  final PortalPreferences? preferences;
  final Json? authorWorld;
  final VoidCallback? onHome, onShelf, onDiscover, onChanged, onPreferences;
  @override
  State<PortalDemoReader> createState() => _PortalDemoReaderState();
}

class _PortalDemoReaderState extends State<PortalDemoReader> {
  late final WorkspaceSession session;
  late final ExperienceController controller;
  late final PortalPreferences appearance;
  bool loading = true;
  String? error;
  bool readOnly = false;
  @override
  void initState() {
    super.initState();
    // Preserve the workspace export scope; only navigation is demo-specific.
    session = WorkspaceSession(backendUrl: widget.repository.backendUrl);
    final api = PortalDemoExperienceApi(
      repository: widget.repository,
      sessionId: widget.sessionId,
      opening: widget.opening,
      onChanged: widget.onChanged,
    );
    controller = ExperienceController(
      session: session,
      api: api,
      journal: widget.repository.journal,
      navigationNamespace: 'demo-navigation-${widget.sessionId}',
    );
    appearance =
        widget.preferences ??
        PortalPreferences(
          journal: widget.repository.journal,
          backendUrl: session.backendUrl,
          workspaceId: session.workspaceId,
        );
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final entry = await widget.repository.entry(widget.sessionId);
      if (entry == null) throw const FormatException('找不到本机经历');
      readOnly = entry.readOnly;
      if (widget.preferences == null) await appearance.hydrate();
      await controller.initialize();
      if (controller.current?.id != widget.sessionId) {
        await controller.open(widget.sessionId);
      }
      if (controller.current == null) {
        throw StateError(controller.error ?? '找不到保存的预设片刻');
      }
    } catch (_) {
      error = '这段本机预设演示暂时无法读取；原记录仍保留。';
    }
    if (mounted) setState(() => loading = false);
  }

  void back() => Navigator.maybePop(context);
  void preferences() {
    if (widget.onPreferences != null) {
      widget.onPreferences!();
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .8,
        child: ReaderAppearancePanel(
          preferences: appearance,
          onStoryPreferences: () => ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('预设演示使用原版固定脚本；不会调用模型修改内容。')),
          ),
        ),
      ),
    );
  }

  Future<void> choose(String text) async {
    if (controller.blocked) return;
    await controller.saveDraft(text, selectedMode: 'act');
    await controller.send(explicitMode: 'act');
  }

  @override
  void dispose() {
    controller.dispose();
    session.dispose();
    if (widget.preferences == null) appearance.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (error != null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(error!),
              TextButton(onPressed: load, child: const Text('重试读取')),
              TextButton(onPressed: back, child: const Text('返回')),
            ],
          ),
        ),
      );
    }
    return Column(
      children: [
        Material(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
              child: Text(
                readOnly
                    ? '本机只读开场 · 可在我的世界继续阅读 · 不调用模型'
                    : '本机预设演示 · 原版八个片刻 · 不调用模型，不写入正式故事',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        ),
        Expanded(
          child: ExperienceScreen(
            controller: controller,
            preferences: appearance,
            localDemo: !readOnly,
            localReadOnly: readOnly,
            onSuggestionSelected: readOnly ? null : choose,
            authorWorld: widget.authorWorld,
            onPreferences: preferences,
            onPortalHome: widget.onHome ?? back,
            onPortalShelf: widget.onShelf ?? back,
            onPortalDiscover: widget.onDiscover ?? back,
          ),
        ),
      ],
    );
  }
}
