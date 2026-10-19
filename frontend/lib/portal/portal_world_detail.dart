/// A public preview for either a built-in world or an author's local version.
library;
import 'portal_card_surface.dart';

import 'dart:convert';

import 'package:flutter/material.dart';

import '../experience/demo_world_catalog.dart';
import '../experience/experience_journal.dart';
import '../experience/experience_models.dart';
import 'portal_demo_repository.dart';
import 'portal_demo_reader.dart';
import 'portal_demo_script.dart';
import 'portal_icon.dart';
import 'portal_start_options.dart';
import 'portal_world_data.dart';
import 'portal_world_studio_data.dart';

class PortalWorldDetail extends StatelessWidget {
  const PortalWorldDetail({
    super.key,
    required this.world,
    required this.onBack,
    required this.onStart,
    this.previous,
    this.onResume,
    this.onEditWorld,
    this.onCopyWorld,
    this.starting = false,
    this.narrativeDefaults = const {},
    this.modelAvailable = true,
    this.modelChecked = true,
    this.selfScrolling = false,
    this.demoJournal,
    this.demoScope,
    this.autoResumeDemo = false,
    this.resumeDemoSessionId,
    this.onDemoOpened,
    this.onDemoChanged,
    this.onSettings,
  }) : customVersion = null;

  const PortalWorldDetail.custom({
    super.key,
    required this.customVersion,
    required this.onBack,
    required this.onStart,
    this.previous,
    this.onResume,
    this.onEditWorld,
    this.onCopyWorld,
    this.starting = false,
    this.narrativeDefaults = const {},
    this.modelAvailable = true,
    this.modelChecked = true,
    this.selfScrolling = false,
    this.demoJournal,
    this.demoScope,
    this.autoResumeDemo = false,
    this.resumeDemoSessionId,
    this.onDemoOpened,
    this.onDemoChanged,
    this.onSettings,
  }) : world = null;

  final DemoWorldPreset? world;
  final PortalWorldVersion? customVersion;
  final ExperienceSummary? previous;
  final VoidCallback onBack;
  final ValueChanged<String> onStart;
  final ValueChanged<ExperienceSummary>? onResume;
  final ValueChanged<PortalWorldVersion>? onEditWorld;
  final ValueChanged<PortalWorldVersion>? onCopyWorld;
  final bool starting;
  final Map<String, dynamic> narrativeDefaults;
  final bool modelAvailable;
  final bool modelChecked;
  final bool selfScrolling;
  final ExperienceJournal? demoJournal;
  final String? demoScope;
  final bool autoResumeDemo;
  final String? resumeDemoSessionId;
  final ValueChanged<String>? onDemoOpened;
  final VoidCallback? onDemoChanged;
  final VoidCallback? onSettings;

  PortalWorldVersion get _editable =>
      customVersion ??
      PortalWorldVersion(
        draft: portalDraftFromPreset(world!),
        version: 0,
        savedAt: DateTime.now(),
      );

  @override
  Widget build(BuildContext context) {
    final content = customVersion == null
        ? _WorldContent.fromPreset(world!)
        : _WorldContent.fromLocal(customVersion!);
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = constraints.maxWidth <= 880;
        final start = _StartPanel(
          key: ValueKey('${content.id}:${customVersion?.version ?? 0}'),
          content: content,
          preset: world,
          customVersion: customVersion,
          previous: previous,
          onResume: onResume,
          onStart: onStart,
          starting: starting,
          narrativeDefaults: narrativeDefaults,
          modelAvailable: modelAvailable,
          modelChecked: modelChecked,
          demoJournal: demoJournal,
          demoScope: demoScope,
          autoResumeDemo: autoResumeDemo,
          resumeDemoSessionId: resumeDemoSessionId,
          onDemoOpened: onDemoOpened,
          onDemoChanged: onDemoChanged,
          onSettings: onSettings,
        );
        final article = _WorldArticle(
          content: content,
          narrow: narrow,
          startBetweenIntroAndOpening: narrow ? start : null,
          onEdit: onEditWorld == null ? null : () => onEditWorld!(_editable),
          onCopy: onCopyWorld == null ? null : () => onCopyWorld!(_editable),
        );
        final page = Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1190),
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                narrow ? 20 : 34,
                24,
                narrow ? 20 : 34,
                72,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextButton.icon(
                    key: const ValueKey('portal-world-back'),
                    onPressed: onBack,
                    icon: const PortalIcon('back', size: 18),
                    label: const Text('发现世界'),
                  ),
                  const SizedBox(height: 24),
                  if (narrow) ...[
                    article,
                  ] else
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: article),
                        const SizedBox(width: 36),
                        SizedBox(width: 320, child: start),
                      ],
                    ),
                ],
              ),
            ),
          ),
        );
        if (!selfScrolling) return page;
        return _WorldDetailScrollLayout(
          article: article,
          start: start,
          onBack: onBack,
          narrow: narrow,
        );
      },
    );
  }
}

class _WorldDetailScrollLayout extends StatefulWidget {
  const _WorldDetailScrollLayout({
    required this.article,
    required this.start,
    required this.onBack,
    required this.narrow,
  });
  final Widget article, start;
  final VoidCallback onBack;
  final bool narrow;

  @override
  State<_WorldDetailScrollLayout> createState() =>
      _WorldDetailScrollLayoutState();
}

class _WorldDetailScrollLayoutState extends State<_WorldDetailScrollLayout> {
  final ScrollController _scroll = ScrollController();
  final GlobalKey _panelKey = GlobalKey();
  double _panelHeight = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  void _onScroll() {
    if (mounted) setState(() {});
  }

  void _measurePanel() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final box = _panelKey.currentContext?.findRenderObject();
      if (!mounted || box is! RenderBox) return;
      if ((_panelHeight - box.size.height).abs() > 1) {
        setState(() => _panelHeight = box.size.height);
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final top = width <= 700
        ? 30.0
        : width <= 1000
        ? 40.0
        : 52.0;
    final side = width <= 360
        ? 16.0
        : width <= 700
        ? 20.0
        : width <= 1000
        ? 28.0
        : 40.0;
    final bottom = width <= 700
        ? 58.0
        : width <= 1000
        ? 72.0
        : 90.0;
    final panelWidth = width <= 1000 ? 292.0 : 320.0;
    final gap = width <= 1000 ? 28.0 : 38.0;
    final rowTop = top - 12 + 44 + 20;
    final viewport =
        MediaQuery.sizeOf(context).height -
        MediaQuery.paddingOf(context).vertical -
        (width <= 760 ? 148 : 80);
    final offset = _scroll.hasClients ? _scroll.offset : 0.0;
    final sticky =
        !widget.narrow && (_panelHeight == 0 || _panelHeight <= viewport - 48);
    final translation = sticky
        ? (offset - rowTop + 24).clamp(0.0, double.infinity)
        : 0.0;
    return SingleChildScrollView(
      controller: _scroll,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1220),
          child: Padding(
            padding: EdgeInsets.fromLTRB(side, top - 12, side, bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 44,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const ValueKey('portal-world-back'),
                      onPressed: widget.onBack,
                      icon: const PortalIcon('back', size: 18),
                      label: const Text('发现世界'),
                    ),
                  ),
                ),
                SizedBox(height: widget.narrow && width <= 700 ? 16 : 20),
                if (widget.narrow)
                  widget.article
                else
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: widget.article),
                      SizedBox(width: gap),
                      SizedBox(
                        width: panelWidth,
                        child: Transform.translate(
                          offset: Offset(0, translation),
                          child:
                              NotificationListener<
                                SizeChangedLayoutNotification
                              >(
                                onNotification: (_) {
                                  _measurePanel();
                                  return false;
                                },
                                child: SizeChangedLayoutNotifier(
                                  child: KeyedSubtree(
                                    key: _panelKey,
                                    child: widget.start,
                                  ),
                                ),
                              ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WorldContent {
  const _WorldContent({
    required this.id,
    required this.title,
    required this.description,
    required this.tags,
    required this.era,
    required this.opening,
    required this.rules,
    required this.characters,
    required this.identity,
    required this.location,
    required this.premise,
    required this.possibilities,
    this.imageAsset,
  });
  final String id,
      title,
      description,
      era,
      opening,
      identity,
      location,
      premise;
  final List<String> tags, rules, possibilities;
  final List<PortalWorldCharacterDraft> characters;
  final String? imageAsset;

  factory _WorldContent.fromPreset(DemoWorldPreset preset) {
    final data = portalWorldDataById[preset.id];
    return _WorldContent(
      id: preset.id,
      title: preset.title,
      description: data?.description ?? preset.tagline,
      tags: data?.tags ?? const ['自由探索'],
      era: data?.era ?? '',
      opening: data?.opening ?? preset.seed,
      rules: data?.rules ?? const [],
      characters: [
        for (final person in data?.characters ?? const <PortalWorldCharacter>[])
          PortalWorldCharacterDraft(
            name: person.name,
            public: person.publicDescription,
          ),
      ],
      identity: data?.identity ?? preset.participation,
      location: data?.location ?? '',
      premise: data?.premise ?? preset.participation,
      possibilities: data?.possibilities ?? const [],
      imageAsset: preset.imageAsset,
    );
  }

  factory _WorldContent.fromLocal(PortalWorldVersion version) {
    final draft = version.draft;
    return _WorldContent(
      id: draft.id,
      title: draft.title,
      description: draft.description,
      tags: ['我的创作', '本机第 ${version.version} 版'],
      era: draft.era,
      opening: draft.opening,
      rules: draft.rules,
      characters: draft.characters,
      identity: draft.identity,
      location: draft.location,
      premise: '你将以${draft.identity}的身份，从${draft.location}开始。接下来的选择由你决定。',
      possibilities: const [],
    );
  }
}

class _WorldArticle extends StatelessWidget {
  const _WorldArticle({
    required this.content,
    required this.narrow,
    this.startBetweenIntroAndOpening,
    this.onEdit,
    this.onCopy,
  });
  final _WorldContent content;
  final bool narrow;
  final Widget? startBetweenIntroAndOpening;
  final VoidCallback? onEdit, onCopy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: AspectRatio(
            aspectRatio: narrow
                ? MediaQuery.sizeOf(context).width <= 700
                      ? 1.8
                      : 2.15
                : 1.95,
            child: content.imageAsset == null
                ? DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          colors.primaryContainer,
                          colors.surfaceContainerHighest,
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: Center(
                      child: Icon(
                        Icons.blur_circular,
                        size: 76,
                        color: colors.primary,
                      ),
                    ),
                  )
                : Image.asset(
                    content.imageAsset!,
                    fit: BoxFit.cover,
                    excludeFromSemantics: true,
                    errorBuilder: (_, _, _) => ColoredBox(
                      color: colors.surfaceContainerHighest,
                      child: const Center(
                        child: Icon(Icons.landscape_outlined, size: 56),
                      ),
                    ),
                  ),
          ),
        ),
        const SizedBox(height: 26),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final tag in content.tags)
              Chip(
                label: Text(tag),
                visualDensity: VisualDensity.compact,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        Semantics(
          header: true,
          child: Text(
            content.title,
            style: theme.textTheme.headlineLarge?.copyWith(
              color: colors.onSurface,
              fontSize: narrow
                  ? MediaQuery.sizeOf(context).width <= 700
                        ? 34
                        : 36
                  : 44,
              height: 1.25,
              fontWeight: FontWeight.w500,
              fontFamily: 'NotoSerifSC',
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          content.description,
          style: theme.textTheme.bodyLarge?.copyWith(height: 1.85),
        ),
        if (content.era.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            content.era,
            style: theme.textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
        if (startBetweenIntroAndOpening != null) ...[
          const SizedBox(height: 27),
          startBetweenIntroAndOpening!,
        ],
        const SizedBox(height: 32),
        Text(
          '开场',
          style: theme.textTheme.labelMedium?.copyWith(
            color: colors.primary,
            letterSpacing: 1.5,
          ),
        ),
        const SizedBox(height: 16),
        Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(
            horizontal: narrow ? 20 : 30,
            vertical: 26,
          ),
          decoration: BoxDecoration(
            color: colors.surface,
            border: Border.all(color: colors.outlineVariant),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final paragraph in content.opening.split(RegExp(r'\n\s*\n')))
                if (paragraph.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 18),
                    child: Text(
                      paragraph.trim(),
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontSize: MediaQuery.sizeOf(context).width <= 700
                            ? 17
                            : 18,
                        height: 2.05,
                        fontFamily: 'NotoSerifSC',
                      ),
                    ),
                  ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        if (content.possibilities.isNotEmpty)
          _DetailDisclosure(
            title: '可能的经历',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final possibility in content.possibilities)
                  _Bullet(possibility),
              ],
            ),
          ),
        _DetailDisclosure(
          title: '世界与人物',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final rule in content.rules) _Bullet(rule),
              const SizedBox(height: 12),
              for (final character in content.characters)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: colors.surfaceContainerHighest,
                        foregroundColor: colors.onSurface,
                        child: Text(
                          character.name.isEmpty
                              ? '人'
                              : String.fromCharCode(character.name.runes.first),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              character.name,
                              style: theme.textTheme.titleMedium,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              character.public,
                              style: theme.textTheme.bodyMedium,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              if (onEdit != null || onCopy != null) ...[
                const Divider(),
                Wrap(
                  spacing: 9,
                  runSpacing: 9,
                  children: [
                    if (onEdit != null)
                      TextButton(onPressed: onEdit, child: const Text('编辑世界')),
                    if (onCopy != null)
                      OutlinedButton(
                        onPressed: onCopy,
                        child: const Text('复制世界'),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _StartPanel extends StatefulWidget {
  const _StartPanel({
    super.key,
    required this.content,
    required this.preset,
    required this.customVersion,
    required this.onStart,
    required this.starting,
    this.previous,
    this.onResume,
    required this.narrativeDefaults,
    required this.modelAvailable,
    required this.modelChecked,
    this.demoJournal,
    this.demoScope,
    this.autoResumeDemo = false,
    this.resumeDemoSessionId,
    this.onDemoOpened,
    this.onDemoChanged,
    this.onSettings,
  });
  final _WorldContent content;
  final DemoWorldPreset? preset;
  final PortalWorldVersion? customVersion;
  final ExperienceSummary? previous;
  final ValueChanged<ExperienceSummary>? onResume;
  final ValueChanged<String> onStart;
  final bool starting;
  final Map<String, dynamic> narrativeDefaults;
  final bool modelAvailable;
  final bool modelChecked;
  final ExperienceJournal? demoJournal;
  final String? demoScope;
  final bool autoResumeDemo;
  final String? resumeDemoSessionId;
  final ValueChanged<String>? onDemoOpened;
  final VoidCallback? onDemoChanged;
  final VoidCallback? onSettings;

  @override
  State<_StartPanel> createState() => _StartPanelState();
}

class _StartPanelState extends State<_StartPanel> {
  final _name = TextEditingController(text: '旅人');
  late final _identity = TextEditingController(text: widget.content.identity);
  final _goal = TextEditingController();
  final _boundaries = TextEditingController();
  late final String _style;
  String _participation = '先看世界如何展开，随时介入';
  late String _perspective;
  late String _length;
  late String _pace;
  late String _mode;
  bool _autoOpened = false;
  bool _modeTouched = false;
  PortalDemoEntry? _recentDemo;

  @override
  void initState() {
    super.initState();
    final narrative = widget.customVersion?.draft;
    final defaults = widget.narrativeDefaults;
    String setting(String key, String fallback) =>
        defaults[key] is String && (defaults[key] as String).trim().isNotEmpty
        ? (defaults[key] as String).trim()
        : fallback;
    _perspective = setting('perspective', narrative?.perspective ?? '第二人称');
    _length = setting('length', narrative?.length ?? '适中');
    _pace = setting('pace', narrative?.pace ?? '从容');
    _style = setting('style', narrative?.style ?? '细腻克制');
    _mode = widget.modelAvailable
        ? 'real'
        : widget.preset != null && PortalDemoScript.supports(widget.preset!.id)
        ? 'demo'
        : 'preview';
    _loadRecentDemo();
    if (widget.autoResumeDemo && widget.resumeDemoSessionId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_autoOpened) {
          _autoOpened = true;
          _resumeLocal(widget.resumeDemoSessionId!);
        }
      });
    }
  }

  @override
  void didUpdateWidget(covariant _StartPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.preset?.id != widget.preset?.id ||
        oldWidget.demoScope != widget.demoScope) {
      _recentDemo = null;
      _loadRecentDemo();
    }
    if (!widget.modelAvailable && _mode == 'real') {
      _mode =
          widget.preset != null && PortalDemoScript.supports(widget.preset!.id)
          ? 'demo'
          : 'preview';
    } else if (!oldWidget.modelAvailable &&
        widget.modelAvailable &&
        !_modeTouched) {
      _mode = 'real';
    }
  }

  Future<void> _loadRecentDemo() async {
    final worldId = widget.content.id;
    try {
      final repository = PortalDemoRepository.fromSessionScope(
        journal: widget.demoJournal ?? LocalExperienceJournal(),
        scope:
            widget.demoScope ??
            experienceScope('local', 'local', 'portal-demo', worldId),
      );
      final entries = await repository.loadEntries();
      if (!mounted || widget.content.id != worldId) return;
      setState(() {
        _recentDemo = entries
            .where(
              (entry) =>
                  entry.worldId == worldId &&
                  !entry.archived &&
                  entry.trashedAt == null,
            )
            .firstOrNull;
      });
    } catch (_) {
      // A local index error must not block a new formal story.
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _identity.dispose();
    _goal.dispose();
    _boundaries.dispose();
    super.dispose();
  }

  void _start() {
    if (!widget.modelChecked) return;
    if (_mode == 'preview') {
      _openReadOnly();
      return;
    }
    if (_mode == 'demo') {
      _openDemo();
      return;
    }
    if (!widget.modelAvailable) return;
    try {
      String seed;
      if (widget.preset != null) {
        seed = portalWorldSeed(
          widget.preset!,
          name: _name.text,
          identity: _identity.text,
          goal: _goal.text,
          participation: _participation,
          boundaries: _boundaries.text,
          perspective: _perspective,
          length: _length,
        );
        seed += '\n\n本次叙述文风：$_style；节奏：$_pace。';
      } else {
        final draft = widget.customVersion!.draft;
        seed = [
          draft.toPublicSeed(),
          '玩家角色名：${_name.text.trim().isEmpty ? '旅人' : _name.text.trim()}',
          '玩家确认的身份：${_identity.text.trim().isEmpty ? draft.identity : _identity.text.trim()}',
          if (_goal.text.trim().isNotEmpty) '个人目标：${_goal.text.trim()}',
          '参与方式：$_participation',
          if (_boundaries.text.trim().isNotEmpty)
            '偏好与底线：${_boundaries.text.trim()}',
          '本次叙述偏好：$_perspective；$_length；$_style；$_pace。',
          '请生成开场，保留玩家接下来的选择，不替玩家行动、同意或作承诺。',
        ].join('\n\n');
      }
      if (utf8.encode(seed).length > 32 * 1024) {
        throw const FormatException('公开资料超过创作长度限制，请精简后再开始。');
      }
      widget.onStart(seed);
    } on FormatException catch (error) {
      ScaffoldMessenger.maybeOf(
        context,
      )?.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _resumeLocal(String sessionId) async {
    try {
      final repository = PortalDemoRepository.fromSessionScope(
        journal: widget.demoJournal ?? LocalExperienceJournal(),
        scope:
            widget.demoScope ??
            experienceScope('local', 'local', 'portal-demo', widget.content.id),
      );
      final entry = await repository.entry(sessionId);
      if (entry == null || entry.worldId != widget.content.id) {
        throw const FormatException('找不到这段本机经历');
      }
      if (entry.readOnly) {
        await _openReadOnly(sessionId: sessionId);
      } else {
        await _openDemo(sessionId: sessionId);
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('本机经历暂时无法打开：$error')));
      }
    }
  }

  Future<void> _openReadOnly({String? sessionId}) async {
    final scope =
        widget.demoScope ??
        experienceScope('local', 'local', 'portal-demo', widget.content.id);
    final journal = widget.demoJournal ?? LocalExperienceJournal();
    late final PortalDemoRepository repository;
    late final PortalDemoEntry entry;
    try {
      repository = PortalDemoRepository.fromSessionScope(
        journal: journal,
        scope: scope,
      );
      entry = sessionId == null
          ? await repository.createReadOnly(
              worldId: widget.content.id,
              title: widget.content.title,
              opening: widget.content.opening,
              identity: _identity.text.trim(),
              location: widget.content.location,
              era: widget.content.era,
              rules: widget.content.rules,
              characters: [
                for (final character in widget.content.characters)
                  {'name': character.name, 'public': character.public},
              ],
            )
          : (await repository.entry(sessionId))!;
      if (!entry.readOnly || entry.worldId != widget.content.id) {
        throw const FormatException('找不到这段只读开场');
      }
      if (!mounted) return;
      widget.onDemoChanged?.call();
      if (widget.onDemoOpened != null) {
        widget.onDemoOpened!(entry.id);
        return;
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('本机只读开场暂时无法打开：$error')));
      }
      return;
    }
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PortalDemoReader(
          repository: repository,
          sessionId: entry.id,
          opening: entry.readonlyOpening!['opening'] as String,
          onChanged: widget.onDemoChanged,
        ),
      ),
    );
    if (mounted) _loadRecentDemo();
  }

  Future<void> _openDemo({String? sessionId}) async {
    final preset = widget.preset;
    if (preset == null || !PortalDemoScript.supports(preset.id)) {
      await _openReadOnly(sessionId: sessionId);
      return;
    }
    final scope =
        widget.demoScope ??
        experienceScope('local', 'local', 'portal-demo', preset.id);
    final journal = widget.demoJournal ?? LocalExperienceJournal();
    late final PortalDemoRepository repository;
    try {
      repository = PortalDemoRepository.fromSessionScope(
        journal: journal,
        scope: scope,
      );
      final entry = sessionId == null
          ? await repository.create(preset.id)
          : await repository.entry(sessionId);
      if (entry == null || entry.worldId != preset.id) {
        throw const FormatException('找不到这段预设演示');
      }
      if (!mounted) return;
      widget.onDemoChanged?.call();
      if (widget.onDemoOpened != null) {
        widget.onDemoOpened!(entry.id);
        return;
      }
      sessionId = entry.id;
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('本机预设演示暂时无法打开：$error')));
      }
      return;
    }
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PortalDemoReader(
          repository: repository,
          sessionId: sessionId!,
          opening: widget.content.opening,
          onChanged: widget.onDemoChanged,
        ),
      ),
    );
    if (mounted) _loadRecentDemo();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final hasPrevious = widget.previous != null && widget.onResume != null;
    final resumeDemo =
        _recentDemo != null &&
        (!hasPrevious ||
            _recentDemo!.updatedAt.isAfter(
              DateTime.tryParse(widget.previous!.updatedAt) ?? DateTime(1970),
            ));
    final hasAnyPrevious = resumeDemo || hasPrevious;
    return PortalCardSurface(
      interactive: false,
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.all(26),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '你的角色',
              style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.8),
            ),
            const SizedBox(height: 12),
            Semantics(
              header: true,
              child: Text(
                widget.content.identity,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontFamily: 'NotoSerifSC',
                  fontSize: 25,
                ),
              ),
            ),
            const SizedBox(height: 15),
            Text(widget.content.premise, style: theme.textTheme.bodyMedium),
            if (widget.content.location.isNotEmpty) ...[
              const SizedBox(height: 22),
              const Divider(),
              const SizedBox(height: 12),
              Text('起始地点', style: theme.textTheme.labelSmall),
              const SizedBox(height: 6),
              Text(widget.content.location, style: theme.textTheme.bodyMedium),
            ],
            const SizedBox(height: 28),
            if (hasAnyPrevious) ...[
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: widget.starting
                      ? null
                      : resumeDemo
                      ? () => _resumeLocal(_recentDemo!.id)
                      : () => widget.onResume!(widget.previous!),
                  label: const Text('返回世界'),
                  icon: const PortalIcon('arrow-up-right'),
                  iconAlignment: IconAlignment.end,
                ),
              ),
              const SizedBox(height: 9),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('重新开始', style: TextStyle(fontSize: 13)),
                children: [
                  const Text('创建另一段独立经历，已有故事仍会保留。'),
                  const SizedBox(height: 12),
                  _startForm(context, label: '新开一局'),
                ],
              ),
            ] else
              _startForm(context, label: '进入世界'),
          ],
        ),
      ),
    );
  }

  Widget _startForm(BuildContext context, {required String label}) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const ValueKey('portal-world-start'),
            onPressed: widget.starting || !widget.modelChecked ? null : _start,
            label: Text(
              widget.starting
                  ? '正在进入…'
                  : !widget.modelChecked
                  ? '正在检查连接…'
                  : label,
            ),
            icon: const PortalIcon('arrow-up-right', size: 18),
            iconAlignment: IconAlignment.end,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          !widget.modelChecked
              ? '正在检查连接，马上就好。'
              : _mode == 'real'
              ? '自由行动'
              : _mode == 'demo'
              ? '预设演示 · 选择建议，或继续经历。自由行动需要连接模型。'
              : '目前仅能查看开场，暂不能推进世界。连接模型后可开始自由行动。',
          style: theme.textTheme.bodySmall?.copyWith(
            color: colors.onSurfaceVariant,
          ),
        ),
        if (widget.modelChecked &&
            !widget.modelAvailable &&
            widget.onSettings != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: widget.onSettings,
              icon: const PortalIcon('settings', size: 15),
              label: const Text('连接设置'),
            ),
          ),
        const SizedBox(height: 10),
        Material(
          color: colors.surface,
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text('角色与游玩设置', style: TextStyle(fontSize: 13)),
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: DropdownButtonFormField<String>(
                  key: ValueKey(
                    'portal-world-mode-$_mode-${widget.modelAvailable}',
                  ),
                  initialValue: _mode,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: '游玩方式'),
                  items: [
                    DropdownMenuItem(
                      value: 'real',
                      enabled: widget.modelAvailable,
                      child: const Text('自由游玩 · 模型生成'),
                    ),
                    if (widget.preset != null &&
                        PortalDemoScript.supports(widget.preset!.id))
                      const DropdownMenuItem(
                        value: 'demo',
                        child: Text('预设演示 · 固定剧情'),
                      ),
                    if (widget.preset == null ||
                        !PortalDemoScript.supports(widget.preset!.id))
                      const DropdownMenuItem(
                        value: 'preview',
                        child: Text('只读开场'),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() {
                        _mode = value;
                        _modeTouched = true;
                      });
                    }
                  },
                ),
              ),
              _field('角色名', _name, 60, key: 'portal-player-name'),
              _field('你的身份', _identity, 200, key: 'portal-player-identity'),
              _field('个人目标（可留空）', _goal, 500),
              _choice('参与方式', _participation, const [
                '先看世界如何展开，随时介入',
                '亲自行动与对话',
              ], (value) => setState(() => _participation = value)),
              _field('偏好与底线', _boundaries, 2000, lines: 3),
              _choice('叙述视角', _perspective, const [
                '第二人称',
                '第一人称',
                '第三人称',
              ], (value) => setState(() => _perspective = value)),
              _choice('篇幅', _length, const [
                '简短',
                '适中',
                '舒展',
              ], (value) => setState(() => _length = value)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _field(
    String label,
    TextEditingController controller,
    int limit, {
    String? key,
    int lines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextField(
      key: key == null ? null : ValueKey(key),
      controller: controller,
      maxLength: limit,
      minLines: lines,
      maxLines: lines == 1 ? 2 : 5,
      decoration: InputDecoration(labelText: label, counterText: ''),
    ),
  );

  Widget _choice(
    String label,
    String value,
    List<String> values,
    ValueChanged<String> onChanged,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final item in values)
          DropdownMenuItem(value: item, child: Text(item)),
      ],
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    ),
  );
}

class _DetailDisclosure extends StatelessWidget {
  const _DetailDisclosure({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => ExpansionTile(
    tilePadding: EdgeInsets.zero,
    title: Text(title),
    childrenPadding: const EdgeInsets.only(bottom: 20),
    children: [Align(alignment: Alignment.centerLeft, child: child)],
  );
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('•  '),
        Expanded(
          child: Text(
            text,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(height: 1.7),
          ),
        ),
      ],
    ),
  );
}
