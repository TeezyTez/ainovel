/// The public discovery surface. It mirrors the demo's portal and world atlas
/// without creating a story or sending a generation request.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'portal_card_surface.dart';

import '../experience/demo_world_catalog.dart';
import '../experience/experience_journal.dart';
import 'portal_world_studio_data.dart';
import 'portal_home_preferences.dart';
import 'portal_scene.dart';
import 'portal_navigation.dart';
import 'portal_icon.dart';

class PortalHome extends StatefulWidget {
  const PortalHome({
    super.key,
    required this.onExplore,
    required this.onCreate,
    required this.onOpenShelf,
    required this.onOpenWorld,
    this.onSettings,
    this.onResume,
    this.recentTitle,
    this.recentContext,
    this.recentExcerpt,
    this.recentWorlds = const [],
    this.backendUrl = '',
    this.workspaceId,
    this.journal,
    this.themeMode = ThemeMode.system,
    this.onThemeChanged,
    this.customWorlds = const [],
    this.onOpenCustomWorld,
    this.catalogOnly = false,
    this.reduceMotion = false,
    this.modelAvailable = true,
  });

  final VoidCallback onExplore;
  final VoidCallback onCreate;
  final VoidCallback onOpenShelf;
  final ValueChanged<DemoWorldPreset> onOpenWorld;
  final VoidCallback? onSettings;
  final VoidCallback? onResume;
  final String? recentTitle, recentContext, recentExcerpt;
  final List<({String title, String detail, VoidCallback onOpen})> recentWorlds;
  final String backendUrl;
  final String? workspaceId;
  final ExperienceJournal? journal;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeChanged;
  final List<PortalWorldVersion> customWorlds;
  final ValueChanged<PortalWorldVersion>? onOpenCustomWorld;
  final bool catalogOnly, reduceMotion, modelAvailable;

  @override
  State<PortalHome> createState() => _PortalHomeState();
}

class _PortalHomeState extends State<PortalHome> {
  final _atlasKey = GlobalKey();
  final _scrollController = ScrollController();
  final _queryController = TextEditingController();
  final _random = math.Random();
  late PortalHomePreferences _preferences;
  final _journeyProgress = ValueNotifier<double>(0);
  int _orderSeed = 0;
  int _openFeature = 0;
  final Set<String> _favorites = {};
  final Set<String> _hidden = {};
  String _query = '';
  String _tag = '';
  String _excludeTag = '';
  bool _favoritesOnly = false;
  bool _filtersExpanded = false;

  @override
  void initState() {
    super.initState();
    _preferences = PortalHomePreferences(
      journal: widget.journal ?? LocalExperienceJournal(),
      backendUrl: widget.backendUrl,
      workspaceId: widget.workspaceId,
    );
    _loadPreferences();
    _scrollController.addListener(_updateJourney);
  }

  Future<void> _loadPreferences() async {
    try {
      final saved = await _preferences.load();
      if (!mounted) return;
      setState(() {
        _favorites.addAll(saved.favorites);
        _hidden.addAll(saved.hidden);
      });
    } catch (_) {
      if (mounted) _notice('无法读取世界收藏，请稍后重试。');
    }
  }

  void _notice(String text) => ScaffoldMessenger.maybeOf(
    context,
  )?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _changeWorld(
    String id, {
    bool favorite = false,
    bool restore = false,
  }) async {
    final target = favorite ? _favorites : _hidden;
    final previous = target.contains(id);
    setState(() {
      if (favorite ? previous : restore) {
        target.remove(id);
      } else {
        target.add(id);
      }
    });
    try {
      await _preferences.saveWorld(
        id,
        favorite: favorite,
        enabled: target.contains(id),
      );
    } catch (_) {
      if (mounted) {
        setState(() {
          if (previous) {
            target.add(id);
          } else {
            target.remove(id);
          }
        });
        _notice('保存失败，已恢复之前的状态。');
      }
    }
  }

  void _updateJourney() {
    final height = _heroHeight(MediaQuery.sizeOf(context));
    final next = (_scrollController.offset / height).clamp(0.0, 1.0);
    if (next != _journeyProgress.value) {
      _journeyProgress.value = next;
    }
  }

  List<DemoWorldPreset> get _allWorlds => [
    ...demoWorldPresets,
    for (final version in widget.customWorlds)
      DemoWorldPreset(
        id: version.draft.id,
        title: version.draft.title,
        tagline: version.draft.description,
        participation: version.draft.identity,
        seed: version.draft.era,
        imageAsset: 'assets/worlds/cinema-hero.jpg',
      ),
  ];

  void _openWorld(DemoWorldPreset world) {
    for (final custom in widget.customWorlds) {
      if (custom.draft.id == world.id) {
        widget.onOpenCustomWorld?.call(custom);
        return;
      }
    }
    widget.onOpenWorld(world);
  }

  double _heroHeight(Size size) => size.width <= 620
      ? 790
      : size.width <= 800
      ? 710
      : (size.height * .82).clamp(660, 850);

  bool get _hasFilters =>
      _query.isNotEmpty ||
      _tag.isNotEmpty ||
      _excludeTag.isNotEmpty ||
      _favoritesOnly;

  void _home() {
    if (_hasFilters) {
      setState(_clearFilters);
    }
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        0,
        duration: widget.reduceMotion || MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 400),
        curve: Curves.easeOutCubic,
      );
    }
  }

  void _explore() {
    final target = _atlasKey.currentContext;
    if (target != null) {
      Scrollable.ensureVisible(
        target,
        duration: widget.reduceMotion || MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 560),
        curve: Curves.easeOutCubic,
        alignment: .05,
      );
    }
  }

  void _suggestWorld() {
    final worlds = _visibleWorlds;
    if (worlds.isEmpty) return;
    _openWorld(worlds[_random.nextInt(worlds.length)]);
  }

  List<DemoWorldPreset> get _visibleWorlds {
    final terms = _query
        .toLowerCase()
        .trim()
        .split(RegExp(r'\s+'))
        .where((s) => s.isNotEmpty);
    final filtered = _allWorlds.where((world) {
      final display = _displayFor(world);
      if (_hidden.contains(world.id) ||
          (_favoritesOnly && !_favorites.contains(world.id)) ||
          (_tag.isNotEmpty && !display.tags.contains(_tag)) ||
          (_excludeTag.isNotEmpty && display.tags.contains(_excludeTag))) {
        return false;
      }
      final haystack =
          '${world.title} ${_searchDescription[world.id] ?? world.tagline} ${display.tags.join(' ')}'
              .toLowerCase();
      return terms.every(haystack.contains);
    }).toList();
    if (filtered.isEmpty) return filtered;
    final shift = _orderSeed % filtered.length;
    return [...filtered.skip(shift), ...filtered.take(shift)];
  }

  void _clearFilters() {
    _query = '';
    _queryController.clear();
    _tag = '';
    _excludeTag = '';
    _favoritesOnly = false;
    _filtersExpanded = false;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _journeyProgress.dispose();
    _queryController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = _PortalColors.of(context);
    if (widget.catalogOnly)
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_hasFilters) _filteredHeading(colors),
          _atlas(context, colors),
        ],
      );
    return LayoutBuilder(
      builder: (context, constraints) {
        final mobile = constraints.maxWidth <= 800;
        final stackedHero = constraints.maxWidth < 1000;
        return ColoredBox(
          color: colors.background,
          child: Column(
            children: [
              if (!widget.catalogOnly) _navigation(),
              Expanded(
                child: SingleChildScrollView(
                  controller: _scrollController,
                  child: Column(
                    children: [
                      if (!_hasFilters && !widget.catalogOnly) ...[
                        _hero(context, colors, mobile, stackedHero),
                        _principles(colors, mobile),
                      ] else if (_hasFilters)
                        _filteredHeading(colors),
                      if (widget.recentTitle?.trim().isNotEmpty ?? false)
                        _recent(colors, mobile),
                      _atlas(context, colors),
                      if (!widget.modelAvailable)
                        _maxWidth(
                          child: Text(
                            '生成新内容需连接模型，已有经历仍可回顾。',
                            style: TextStyle(color: colors.muted, fontSize: 12),
                          ),
                        ),
                      if (!_hasFilters && !widget.catalogOnly)
                        _manifesto(colors, mobile),
                    ],
                  ),
                ),
              ),
              if (mobile && !widget.catalogOnly) _navigation(bottom: true),
            ],
          ),
        );
      },
    );
  }

  Widget _navigation({bool bottom = false}) => PortalNavigation(
    section: PortalSection.discover, bottom: bottom,
    onHome: _home, onDiscover: _home, onShelf: widget.onOpenShelf,
    onCreate: widget.onCreate, onSettings: widget.onSettings,
    themeMode: widget.themeMode, onThemeChanged: widget.onThemeChanged,
    recentWorlds: widget.recentWorlds,
  );

  Widget _hero(
    BuildContext context,
    _PortalColors colors,
    bool mobile,
    bool stackedHero,
  ) {
    final size = MediaQuery.sizeOf(context);
    final small = size.width <= 620;
    final gutter = small
        ? 22.0
        : size.width <= 1100
        ? 32.0
        : 48.0;
    final height = _heroHeight(size);
    return SizedBox(
      height: height,
      child: MouseRegion(
        child: Stack(
          clipBehavior: Clip.hardEdge,
          children: [
            Positioned.fill(
              child: ValueListenableBuilder<double>(
                valueListenable: _journeyProgress,
                builder: (context, progress, _) => RepaintBoundary(
                  child: PortalScene(
                    dark: Theme.of(context).brightness == Brightness.dark,
                    paused: progress >= 1,
                    reduced: widget.reduceMotion || MediaQuery.disableAnimationsOf(context),
                    progress: progress,
                  ),
                ),
              ),
            ),
            Positioned(
              top: small ? 21 : 28,
              left: gutter,
              right: gutter,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: _micro('ELSELIFE / POSSIBILITY FIELD', colors),
                  ),
                  if (size.width > 800) _micro('每一种可能，都通向你。', colors),
                ],
              ),
            ),
            Positioned(
              left: gutter,
              right: gutter,
              top: small
                  ? 85
                  : size.width <= 800
                  ? 110
                  : 0,
              bottom: small || size.width <= 800 ? null : 30,
              child: Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: small ? size.width - gutter * 2 : size.width * .54,
                  child: _heroCopy(colors, small),
                ),
              ),
            ),
            Positioned(
              bottom: small ? 18 : 28,
              left: gutter,
              right: gutter,
              child: Row(
                children: [
                  Expanded(child: _micro('↓   向下，发现另一种可能', colors)),
                  if (size.width > 800)
                    _micro('THE SPACE BETWEEN LIVES   ↘', colors),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _heroCopy(_PortalColors colors, bool mobile) {
    final width = MediaQuery.sizeOf(context).width;
    final titleSize = mobile
        ? (width * .115).clamp(43.0, 60.0)
        : width <= 800
        ? 58.0
        : (width * .054).clamp(50.0, 78.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _micro('◇  AI 原生互动叙事    │    BEYOND ONE LIFE', colors),
        SizedBox(height: mobile ? 20 : 27),
        Text('世界之外，', style: _displayStyle(colors.ink, titleSize)),
        Text('另有人生。', style: _displayStyle(colors.violet, titleSize)),
        SizedBox(height: mobile ? 22 : 29),
        Text(
          '走进一个世界，成为故事中的人。\n让每一次选择，生长出属于你的下一幕。',
          style: TextStyle(
            color: colors.muted,
            fontSize: mobile ? 13 : 15,
            height: 2,
          ),
        ),
        SizedBox(height: mobile ? 26 : 32),
        Wrap(
          spacing: 18,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _primaryAction(
              label: '探索世界',
              icon: 'arrow-right',
              onPressed: _explore,
              colors: colors,
            ),
            TextButton.icon(
              onPressed: widget.onCreate,
              style: TextButton.styleFrom(
                foregroundColor: colors.ink,
                minimumSize: const Size(110, 50),
              ),
              label: const Text('创造世界'),
              icon: const PortalIcon('arrow-up-right', size: 16),
              iconAlignment: IconAlignment.end,
            ),
          ],
        ),
        const SizedBox(height: 20),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 22, height: 1, color: colors.violet),
            const SizedBox(width: 8),
            Text(
              '由 AI 延展，由你决定。',
              style: TextStyle(color: colors.muted, fontSize: 11),
            ),
          ],
        ),
      ],
    );
  }

  Widget _principles(_PortalColors colors, bool mobile) {
    const principles = [
      ('01', '一个世界，无数种展开'),
      ('02', '用自己的话，改变下一幕'),
      ('03', '留下经历，随时归来'),
    ];
    return _maxWidth(
      child: Container(
        padding: EdgeInsets.symmetric(vertical: mobile ? 22 : 30),
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: colors.line),
            bottom: BorderSide(color: colors.line),
          ),
        ),
        child: Row(
          children: [
            for (var i = 0; i < principles.length; i++)
              Expanded(
                child: Container(
                  padding: EdgeInsets.only(
                    left: i == 0
                        ? 0
                        : mobile
                        ? 10
                        : 28,
                  ),
                  decoration: BoxDecoration(
                    border: i == 0
                        ? null
                        : Border(left: BorderSide(color: colors.line)),
                  ),
                  child: mobile
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              principles[i].$1,
                              style: TextStyle(
                                color: colors.violet,
                                fontSize: 11,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              principles[i].$2,
                              style: TextStyle(
                                color: colors.muted,
                                fontSize: 10,
                                height: 1.8,
                              ),
                            ),
                          ],
                        )
                      : _principle(principles[i].$1, principles[i].$2, colors),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _principle(String index, String text, _PortalColors colors) => Row(
    children: [
      Text(index, style: TextStyle(color: colors.violet, fontSize: 11)),
      const SizedBox(width: 18),
      Flexible(
        child: Text(text, style: TextStyle(color: colors.muted, fontSize: 12)),
      ),
    ],
  );

  Widget _recent(_PortalColors colors, bool mobile) => _maxWidth(
    child: Container(
      margin: EdgeInsets.only(top: mobile ? 30 : 46),
      padding: EdgeInsets.all(mobile ? 20 : 26),
      decoration: BoxDecoration(
        color: colors.paper,
        border: Border.all(color: colors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Wrap(
        spacing: 20,
        runSpacing: 14,
        crossAxisAlignment: WrapCrossAlignment.center,
        alignment: WrapAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '上次离开的地方',
                style: TextStyle(color: colors.muted, fontSize: 11),
              ),
              const SizedBox(height: 4),
              Text(
                widget.recentTitle!,
                style: _displayStyle(colors.ink, mobile ? 23 : 27),
              ),
              if (widget.recentContext?.isNotEmpty ?? false)
                Text(
                  widget.recentContext!,
                  style: TextStyle(color: colors.muted, fontSize: 12),
                ),
              if (widget.recentExcerpt?.isNotEmpty ?? false)
                SizedBox(
                  width: math.min(650, MediaQuery.sizeOf(context).width - 110),
                  child: Text(
                    widget.recentExcerpt!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.muted,
                      fontSize: 12,
                      height: 1.8,
                    ),
                  ),
                ),
            ],
          ),
          _primaryAction(
            label: widget.onResume == null ? '查看我的世界' : '回到世界',
            icon: 'arrow-right',
            onPressed: widget.onResume ?? widget.onOpenShelf,
            colors: colors,
          ),
        ],
      ),
    ),
  );

  Widget _filteredHeading(_PortalColors colors) => _maxWidth(
    child: Padding(
      padding: const EdgeInsets.only(top: 66),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('发现另一个世界。', style: _displayStyle(colors.ink, 42)),
          const SizedBox(height: 24),
          _outlineAction(
            label: '创造世界 ↗',
            onPressed: widget.onCreate,
            colors: colors,
          ),
        ],
      ),
    ),
  );

  Widget _atlas(BuildContext context, _PortalColors colors) {
    final worlds = _visibleWorlds;
    return KeyedSubtree(
      key: _atlasKey,
      child: _maxWidth(
        child: Padding(
          padding: EdgeInsets.only(top: _hasFilters ? 48 : 66, bottom: 104),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final viewport = MediaQuery.sizeOf(context).width;
              final columns = viewport > 1050
                  ? (worlds.length == 2 ? 2 : 3)
                  : (viewport > 700 ? 2 : 1);
              final gap = 24.0;
              final cardWidth = (width - gap * (columns - 1)) / columns;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _micro('01 / WORLD ATLAS', colors),
                  const SizedBox(height: 14),
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.end,
                    spacing: 16,
                    runSpacing: 18,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _hasFilters ? '筛选结果' : '发现世界',
                            style: _displayStyle(colors.ink, 42),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            _hasFilters ? '找到此刻想走进的那一个。' : '从一个世界出发，让故事发生在你身上。',
                            style: TextStyle(color: colors.muted, fontSize: 14),
                          ),
                        ],
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            '${worlds.length} 个世界',
                            style: TextStyle(color: colors.muted, fontSize: 12),
                          ),
                          const SizedBox(width: 22),
                          TextButton.icon(
                            onPressed: worlds.isEmpty ? null : _suggestWorld,
                            style: TextButton.styleFrom(
                              foregroundColor: colors.ink,
                              minimumSize: const Size(138, 46),
                            ),
                            label: const Text('替我挑一个'),
                            icon: const PortalIcon('arrow-up-right', size: 16),
                            iconAlignment: IconAlignment.end,
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 26),
                  Divider(color: colors.line, height: 1),
                  _filters(colors),
                  if (worlds.isNotEmpty)
                    Wrap(
                      spacing: gap,
                      runSpacing: 32,
                      children: [
                        for (var i = 0; i < worlds.length; i++)
                          SizedBox(
                            width:
                                columns == 3 &&
                                    worlds.length > 1 &&
                                    worlds.length % 3 == 1 &&
                                    i == worlds.length - 1
                                ? width
                                : cardWidth,
                            child:
                                columns == 3 &&
                                    worlds.length > 1 &&
                                    worlds.length % 3 == 1 &&
                                    i == worlds.length - 1
                                ? _LandscapeWorldCard(
                                    preset: worlds[i],
                                    number: i + 1,
                                    colors: colors,
                                    favorite: _favorites.contains(worlds[i].id),
                                    onTap: () => _openWorld(worlds[i]),
                                    onFavorite: () => _changeWorld(
                                      worlds[i].id,
                                      favorite: true,
                                    ),
                                    onHide: () => _changeWorld(worlds[i].id),
                                  )
                                : _WorldCard(
                                    preset: worlds[i],
                                    number: i + 1,
                                    colors: colors,
                                    favorite: _favorites.contains(worlds[i].id),
                                    onTap: () => _openWorld(worlds[i]),
                                    onFavorite: () => _changeWorld(
                                      worlds[i].id,
                                      favorite: true,
                                    ),
                                    onHide: () => _changeWorld(worlds[i].id),
                                  ),
                          ),
                      ],
                    )
                  else
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(40),
                      decoration: BoxDecoration(
                        color: colors.paper,
                        border: Border.all(color: colors.line),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        children: [
                          Text(
                            _favoritesOnly && _favorites.isEmpty
                                ? '还没有收藏的开局'
                                : '没有找到符合条件的开局',
                            style: _displayStyle(colors.ink, 24),
                          ),
                          const SizedBox(height: 12),
                          TextButton(
                            onPressed: () => setState(_clearFilters),
                            child: const Text('清空筛选'),
                          ),
                          TextButton(
                            onPressed: widget.onCreate,
                            child: const Text('创造一个世界'),
                          ),
                        ],
                      ),
                    ),
                  if (_hidden.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    ExpansionTile(
                      title: Text('已隐藏 · ${_hidden.length}'),
                      children: [
                        for (final world in _allWorlds.where(
                          (world) => _hidden.contains(world.id),
                        ))
                          ListTile(
                            title: Text(world.title),
                            trailing: TextButton(
                              onPressed: () =>
                                  _changeWorld(world.id, restore: true),
                              child: const Text('重新显示'),
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _filters(_PortalColors colors) {
    final tags =
        _allWorlds.expand((world) => _displayFor(world).tags).toSet().toList()
          ..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: () => setState(() => _filtersExpanded = !_filtersExpanded),
          style: TextButton.styleFrom(foregroundColor: colors.muted),
          label: Text('搜索与筛选${_hasFilters ? ' · 已启用' : ''}'),
          icon: RotatedBox(quarterTurns:_filtersExpanded?2:0,child:const PortalIcon('chevron-down',size:16)),
          iconAlignment: IconAlignment.end,
        ),
        if (_filtersExpanded) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: colors.paper,
              border: Border.all(color: colors.line),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.end,
                  children: [
                    SizedBox(
                      width: 280,
                      child: TextField(
                        controller: _queryController,
                        maxLength: 300,
                        decoration: const InputDecoration(
                          hintText: '搜索世界',
                          counterText: '',
                          border: OutlineInputBorder(),
                        ),
                        onSubmitted: (_) => _applySearch(),
                      ),
                    ),
                    _outlineAction(
                      label: '搜索',
                      onPressed: _applySearch,
                      colors: colors,
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 14,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _tagDropdown(
                      '题材',
                      _tag,
                      tags,
                      (value) => setState(() => _tag = value),
                      colors,
                    ),
                    _tagDropdown(
                      '排除题材',
                      _excludeTag,
                      tags,
                      (value) => setState(() => _excludeTag = value),
                      colors,
                    ),
                    SizedBox(
                      width: 140,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Checkbox(
                            value: _favoritesOnly,
                            onChanged: (v) =>
                                setState(() => _favoritesOnly = v ?? false),
                          ),
                          const Flexible(
                            child: Text('只看收藏', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: _visibleWorlds.length > 1
                          ? () => setState(() => _orderSeed++)
                          : null,
                      child: const Text('换个顺序'),
                    ),
                    if (_hasFilters)
                      TextButton(
                        onPressed: () => setState(_clearFilters),
                        child: const Text('清空筛选'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        const SizedBox(height: 24),
      ],
    );
  }

  void _applySearch() => setState(() {
    _query = _queryController.text.trim();
    _filtersExpanded = true;
  });

  Widget _tagDropdown(
    String label,
    String value,
    List<String> tags,
    ValueChanged<String> onChanged,
    _PortalColors colors,
  ) {
    return SizedBox(
      width: 164,
      child: DropdownButtonFormField<String>(
        key: ValueKey<String>(label + value),
        initialValue: value,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          labelStyle: TextStyle(color: colors.muted, fontSize: 12),
        ),
        items: [
          DropdownMenuItem(
            value: '',
            child: Text(label == '题材' ? '全部题材' : '不限'),
          ),
          for (final tag in tags)
            DropdownMenuItem(value: tag, child: Text(tag)),
        ],
        onChanged: (next) => onChanged(next ?? ''),
      ),
    );
  }

  Widget _manifesto(_PortalColors colors, bool mobile) => _maxWidth(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final stacked = constraints.maxWidth < 700;
            final artwork = SizedBox(
              height: stacked ? 285 : 600,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CustomPaint(painter: _OrbitPainter()),
                  Positioned(
                    top: 28,
                    left: 28,
                    child: Text(
                      'ONE MOMENT.\nMANY POSSIBLE LIVES.',
                      style: TextStyle(
                        color: const Color(0xFFB3B1C1),
                        fontSize: 10,
                        height: 1.6,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                  const Positioned(
                    left: 28,
                    bottom: 28,
                    child: Text(
                      '一念之间，故事分岔。',
                      style: TextStyle(color: Color(0xFFB3B1C1), fontSize: 12),
                    ),
                  ),
                ],
              ),
            );
            final content = Padding(
              padding: EdgeInsets.fromLTRB(
                stacked ? 25 : 14,
                stacked ? 24 : 57,
                stacked ? 25 : 48,
                34,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '02 / THE ELSELIFE WAY',
                    style: TextStyle(
                      color: Color(0xFFAAA8BB),
                      fontSize: 10,
                      letterSpacing: 1.6,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    '故事会记得，\n你来过。',
                    style: _displayStyle(
                      const Color(0xFFF3F0FA),
                      stacked ? 34 : 43,
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    '世界给出开场。接下来，把你想说的话、想做的事，交给故事。',
                    style: TextStyle(
                      color: Color(0xFFB4B3C2),
                      fontSize: 14,
                      height: 1.95,
                    ),
                  ),
                  const SizedBox(height: 23),
                  _featureRow(
                    0,
                    '自由行动，让世界回应',
                    '与角色交谈，调查眼前的线索，或走向另一条路。用自己的话行动，让 AI 接续当前处境。',
                  ),
                  _featureRow(
                    1,
                    '重要的经历，有迹可循',
                    '回顾人物、物品与已经发生的事件。离开时保存进展，再次归来，接上自己的故事。',
                  ),
                  _featureRow(
                    2,
                    '另一种选择，另一段人生',
                    '从已有经历建立分支，试着做出不同选择。保留原来的故事，也给另一种可能留一个位置。',
                  ),
                  const SizedBox(height: 19),
                  TextButton.icon(
                    onPressed: widget.onCreate,
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFFD9CDEE),
                    ),
                    label: const Text('从你的一个念头开始'),
                    icon: const PortalIcon('arrow-up-right', size: 17),
                    iconAlignment: IconAlignment.end,
                  ),
                ],
              ),
            );
            return Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF12151E),
                borderRadius: BorderRadius.circular(16),
              ),
              child: stacked
                  ? Column(children: [artwork, content])
                  : Row(
                      children: [
                        Expanded(child: artwork),
                        Expanded(child: content),
                      ],
                    ),
            );
          },
        ),
        Padding(
          padding: EdgeInsets.symmetric(vertical: mobile ? 55 : 84),
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 24,
            runSpacing: 20,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _micro('YOUR NEXT LIFE STARTS HERE', colors),
                  const SizedBox(height: 13),
                  Text(
                    '如果重来一次，你想成为谁？',
                    style: _displayStyle(colors.ink, mobile ? 28 : 37),
                  ),
                ],
              ),
              _primaryAction(
                label: '创造世界',
                icon: 'arrow-up-right',
                onPressed: widget.onCreate,
                colors: colors,
              ),
            ],
          ),
        ),
        Divider(color: colors.line, height: 1),
        const SizedBox(height: 25),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 24,
          runSpacing: 15,
          children: [
            InkWell(
              onTap: _home,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'elselife',
                    style: TextStyle(
                      color: colors.ink,
                      fontSize: 25,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(width: 18),
                  Flexible(
                    child: Text(
                      '世界之外，另有人生。',
                      style: TextStyle(color: colors.muted, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton(
                  onPressed: widget.onOpenShelf,
                  child: const Text('我的世界 ↗'),
                ),
                if (widget.onSettings != null)
                  TextButton(
                    onPressed: widget.onSettings,
                    child: const Text('偏好设置 ↗'),
                  ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 8),
        _micro('ANOTHER LIFE, YOUR WAY.', colors),
        const SizedBox(height: 20),
      ],
    ),
  );

  Widget _featureRow(int index, String title, String body) {
    final open = _openFeature == index;
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0x26FFFFFF))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _openFeature = open ? -1 : index),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Row(
                children: [
                  Text(
                    '${index + 1}'.padLeft(2, '0'),
                    style: const TextStyle(
                      color: Color(0xFFA7A3BC),
                      fontSize: 10,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFFE8E5EF),
                        fontSize: 14,
                      ),
                    ),
                  ),
                  PortalIcon(
                    open ? 'close' : 'plus',
                    size: 16,
                    color: const Color(0xFFAAA2C0),
                  ),
                ],
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.only(left: 30, bottom: 20),
              child: Text(
                body,
                style: const TextStyle(
                  color: Color(0xFFB4B3C2),
                  fontSize: 13,
                  height: 1.9,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _maxWidth({required Widget child}) => Padding(
    padding: EdgeInsets.symmetric(
      horizontal: MediaQuery.sizeOf(context).width <= 620
          ? 22
          : MediaQuery.sizeOf(context).width <= 1100
          ? 32
          : 48,
    ),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1240),
        child: SizedBox(width: double.infinity, child: child),
      ),
    ),
  );
}

class _WorldCard extends StatelessWidget {
  const _WorldCard({
    required this.preset,
    required this.number,
    required this.colors,
    required this.favorite,
    required this.onTap,
    required this.onFavorite,
    required this.onHide,
  });

  final DemoWorldPreset preset;
  final int number;
  final _PortalColors colors;
  final bool favorite;
  final VoidCallback onTap;
  final VoidCallback onFavorite;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final display = _displayFor(preset);
    return PortalCardSurface(
      color: colors.paper,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: ValueKey('portal-world-${preset.id}'),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(color: colors.line),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1.65,
                    child: Image.asset(
                      preset.imageAsset,
                      fit: BoxFit.cover,
                      excludeFromSemantics: true,
                      errorBuilder: (_, _, _) => ColoredBox(
                        color: colors.soft,
                        child: const Center(
                          child: Icon(Icons.landscape_outlined),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 16,
                    top: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0x55101018),
                        border: Border.all(color: const Color(0x99FFFFFF)),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        number.toString().padLeft(2, '0'),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(23, 23, 23, 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      display.tags.first,
                      style: TextStyle(color: colors.muted, fontSize: 11),
                    ),
                    if (favorite)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          '已收藏',
                          style: TextStyle(color: colors.violet, fontSize: 11),
                        ),
                      ),
                    const SizedBox(height: 11),
                    Text(
                      preset.title,
                      style: _displayStyle(
                        colors.ink,
                        25,
                      ).copyWith(fontWeight: FontWeight.w600, height: 1.5),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      display.summary,
                      style: TextStyle(
                        color: colors.muted,
                        fontSize: 13,
                        height: 1.85,
                      ),
                    ),
                    const SizedBox(height: 22),
                    Divider(color: colors.line, height: 1),
                    Row(
                      children: [
                        Text(
                          '探索世界',
                          style: TextStyle(color: colors.ink, fontSize: 12),
                        ),
                        const SizedBox(width: 6),
                        PortalIcon('arrow-up-right', size: 15, color: colors.violet),
                        const Spacer(),
                        PopupMenuButton<String>(
                          tooltip: '${preset.title}的开局选项',
                          icon: PortalIcon('more', color: colors.muted),
                          onSelected: (choice) {
                            if (choice == 'favorite') onFavorite();
                            if (choice == 'hide') onHide();
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(
                              value: 'favorite',
                              child: Text(favorite ? '取消收藏' : '收藏'),
                            ),
                            const PopupMenuItem(
                              value: 'hide',
                              child: Text('隐藏世界'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A lone last entry spans the desktop atlas, as in the demo's catalog CSS.
class _LandscapeWorldCard extends StatelessWidget {
  const _LandscapeWorldCard({
    required this.preset,
    required this.number,
    required this.colors,
    required this.favorite,
    required this.onTap,
    required this.onFavorite,
    required this.onHide,
  });

  final DemoWorldPreset preset;
  final int number;
  final _PortalColors colors;
  final bool favorite;
  final VoidCallback onTap, onFavorite, onHide;

  @override
  Widget build(BuildContext context) {
    final display = _displayFor(preset);
    return PortalCardSurface(
      color: colors.paper,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: ValueKey('portal-world-${preset.id}'),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(color: colors.line),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Expanded(
                flex: 100,
                child: SizedBox(
                  height: 252,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.asset(
                        preset.imageAsset,
                        fit: BoxFit.cover,
                        excludeFromSemantics: true,
                      ),
                      Positioned(
                        left: 17,
                        top: 16,
                        child: Text(
                          number.toString().padLeft(2, '0'),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(
                flex: 145,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(34, 25, 34, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        display.tags.first,
                        style: TextStyle(color: colors.muted, fontSize: 11),
                      ),
                      if (favorite)
                        Text(
                          '已收藏',
                          style: TextStyle(color: colors.violet, fontSize: 11),
                        ),
                      const SizedBox(height: 10),
                      Text(
                        preset.title,
                        style: _displayStyle(
                          colors.ink,
                          25,
                        ).copyWith(fontWeight: FontWeight.w600, height: 1.5),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        display.summary,
                        style: TextStyle(
                          color: colors.muted,
                          fontSize: 13,
                          height: 1.85,
                        ),
                      ),
                      const SizedBox(height: 12),
                      const SizedBox(height: 12),
                      Divider(color: colors.line, height: 1),
                      Row(
                        children: [
                          Text(
                            '探索世界',
                            style: TextStyle(color: colors.ink, fontSize: 12),
                          ),
                          const SizedBox(width: 6),
                          PortalIcon('arrow-up-right',
                            size: 15,
                            color: colors.violet,
                          ),
                          const Spacer(),
                          PopupMenuButton<String>(
                            tooltip: '${preset.title}的开局选项',
                            icon: PortalIcon('more', color: colors.muted),
                            onSelected: (choice) {
                              if (choice == 'favorite') onFavorite();
                              if (choice == 'hide') onHide();
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(
                                value: 'favorite',
                                child: Text(favorite ? '取消收藏' : '收藏'),
                              ),
                              const PopupMenuItem(
                                value: 'hide',
                                child: Text('隐藏世界'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorldDisplay {
  const _WorldDisplay(this.tags, this.summary, this.opening, this.identity);
  final List<String> tags;
  final String summary;
  final String opening;
  final String identity;
}

/// Public catalog copy from the demo's worlds.js and situations.js.
/// It is presentation text only; the formal service owns generated pages.
const _worldDisplay = <String, _WorldDisplay>{
  'fog-harbor': _WorldDisplay(
    ['近代架空', '港口生活', '往事与关系'],
    '在潮声与旧友之间，查清一封迟来的电报，也决定怎样与往事相处。',
    '你离开雾港的第七年，旧码头又响了一次钟。',
    '返回故乡的前电报员',
  ),
  'mountain': _WorldDisplay(
    ['东方幻想', '山中日常', '承诺与代价'],
    '把一封意外展开的信送到该去的地方，在山中日常里体会承诺的分量。',
    '午后的山道没有风，信封却在你掌心轻轻展开，像一片听见雨声的叶子。',
    '负责传递书信的外门弟子',
  ),
  'thursday': _WorldDisplay(
    ['现代日常', '成年人际', '重新连接'],
    '在一间旧书店里，慢慢理顺误会，让一次取书有个妥当的交代。',
    '星期四下午，雨刚好落在你翻转营业牌的时候。',
    '临时接手旧书店的店主',
  ),
  'truth-teahouse': _WorldDisplay(
    ['日常奇想', '茶铺生活', '表达与边界'],
    '做一壶茶，听一句不容易说出口的话，决定一位店主愿意帮到哪里。',
    '开业第一天，门口的木牌还带着新漆味。',
    '真话城的茶铺店主',
  ),
};

TextStyle _displayStyle(Color color, double size) => TextStyle(
  color: color,
  fontFamily: 'NotoSerifSC',
  fontFamilyFallback: const ['Songti SC', 'NotoSansSC'],
  fontSize: size,
  fontWeight: FontWeight.w300,
  height: 1.24,
  letterSpacing: -.7,
);

Widget _micro(String text, _PortalColors colors) => Text(
  text,
  style: TextStyle(
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 1.4,
    height: 1.4,
  ),
);

Widget _primaryAction({
  required String label,
  required String icon,
  required VoidCallback onPressed,
  required _PortalColors colors,
}) => FilledButton.icon(
  onPressed: onPressed,
  style: FilledButton.styleFrom(
    minimumSize: const Size(154, 50),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    padding: const EdgeInsets.symmetric(horizontal: 21),
  ),
  label: Text(label, style: const TextStyle(fontSize: 13)),
  icon: PortalIcon(icon, size: 17),
  iconAlignment: IconAlignment.end,
);

Widget _outlineAction({
  required String label,
  required VoidCallback onPressed,
  required _PortalColors colors,
  bool light = false,
}) => OutlinedButton(
  onPressed: onPressed,
  style: OutlinedButton.styleFrom(
    foregroundColor: light ? colors.background : colors.ink,
    minimumSize: const Size(124, 44),
    padding: const EdgeInsets.symmetric(horizontal: 18),
    side: BorderSide(
      color: light ? colors.background.withValues(alpha: .45) : colors.line,
    ),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  ),
  child: Row(mainAxisSize:MainAxisSize.min,children:[if(label=='创造世界')... [const PortalIcon('spark',size:18),const SizedBox(width:8)],Text(label, style: const TextStyle(fontSize: 12))]),
);

class _PortalColors {
  const _PortalColors({
    required this.background,
    required this.paper,
    required this.ink,
    required this.muted,
    required this.line,
    required this.soft,
    required this.violet,
    required this.cyan,
  });

  final Color background, paper, ink, muted, line, soft, violet, cyan;

  static _PortalColors of(BuildContext context) {
    final theme = Theme.of(context), c = theme.colorScheme;
    return _PortalColors(background: theme.scaffoldBackgroundColor,
      paper: c.surface, ink: c.onSurface, muted: c.onSurfaceVariant,
      line: c.outlineVariant, soft: c.surfaceContainerHigh,
      violet: c.primary, cyan: const Color(0xff86bdc8));
  }
}

class _OrbitPainter extends CustomPainter {
  const _OrbitPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-.3, -.1),
          radius: .9,
          colors: const [Color(0xFF273049), Color(0xFF12151E)],
        ).createShader(Offset.zero & size),
    );
    for (var i = 0; i < 6; i++) {
      final scale = .49 + i * .14;
      final stroke = i.isEven
          ? const Color(0x558AC5D0)
          : const Color(0x55B0A1D3);
      canvas.save();
      canvas.translate(size.width * .5, size.height * .53);
      canvas.rotate(-.49 + i * .15);
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset.zero,
          width: size.width * scale,
          height: size.height * scale * .68,
        ),
        Paint()
          ..color = stroke
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
      );
      canvas.restore();
    }
    canvas.drawCircle(
      Offset(size.width * .5, size.height * .53),
      5,
      Paint()..color = const Color(0xFFD8D6EE),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

_WorldDisplay _displayFor(DemoWorldPreset world) =>
    _worldDisplay[world.id] ??
    _WorldDisplay(
      [if (world.seed.trim().isNotEmpty) world.seed.trim() else '我的创作'],
      world.tagline.length > 54
          ? '${world.tagline.substring(0, 54)}…'
          : world.tagline,
      '',
      world.participation,
    );

const _searchDescription = <String, String>{
  'fog-harbor':
      '回到一座靠潮水计时的港城。旧码头将被改建，旧朋友各有难处，而一封迟来的电报，让一段未被好好告别的往事重新有了下文。你可以调查，也可以先听人把话说完。',
  'mountain': '你是初到山中的送信弟子。山上有术法，也有缺水的菜圃、迟到的工钱和不能轻许的承诺。送完一封信，未必比学会一道法术容易。',
  'thursday':
      '你临时接手一家旧书店。雨天的顾客、迟迟未整理的订书本、临近续约的房租，各自占据柜台的一角。这里没有必须拯救的世界，只有几个值得认真对待的人。',
  'truth-teahouse':
      '在一座无法故意说谎的城里，你的茶铺第一天开门。人们依然会误会、沉默，也会认真挑选一句愿意说出口的话。第一位顾客想带茶去道歉；你可以帮他选茶，听听他的困扰，或只照常做生意。',
};
