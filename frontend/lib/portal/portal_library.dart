/// Personal library presentation for the local workspace.
///
/// Go remains the authority for experiences and pages. Pins, display names,
/// notes, groups, archive and trash are device-local presentation metadata.
library;
import 'portal_card_surface.dart';

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../experience/experience_controller.dart';
import '../experience/demo_world_catalog.dart';
import '../experience/experience_journal.dart';
import '../experience/experience_models.dart';
import 'portal_icon.dart';
import 'portal_demo_repository.dart';
import 'portal_world_data.dart';
import 'portal_world_studio_data.dart';
import 'portal_text_export_stub.dart'
    if (dart.library.html) 'portal_text_export_web.dart'
    as text_export;

/// Short public copy for shelf cards and the shell's recent-story menu.
String portalStorySnippet(String value, {int limit = 110}) {
  final compact = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  final points = compact.runes.toList();
  if (points.length <= limit) return compact;
  return '${String.fromCharCodes(points.take(limit))}…';
}

/// Old formal records sometimes used the entire creation seed as a title.
/// Only a labelled world name may be recovered from that seed.
String portalStoryDisplayTitle(ExperienceSummary item, {String? localName}) {
  final named = localName?.trim() ?? '';
  if (named.isNotEmpty) return named;
  final raw = item.title.trim();
  if (raw == item.seed.trim() ||
      (raw.startsWith('世界名称：') && raw.contains('\n'))) {
    final name = RegExp(
      r'^世界名称：([^\r\n]{1,100})',
      multiLine: true,
    ).firstMatch(item.seed)?.group(1)?.trim();
    return name?.isNotEmpty == true ? name! : '未命名经历';
  }
  return raw.isEmpty ? '未命名经历' : portalStorySnippet(raw, limit: 100);
}

int portalStoryTurnCount(ExperienceView view) =>
    view.pages.where((page) => page.mode != 'begin').length;

class PortalLibrary extends StatefulWidget {
  const PortalLibrary({
    super.key,
    required this.controller,
    required this.onOpen,
    required this.onCreate,
    required this.onExplore,
    this.onOpenWorldVersion,
    this.onEditWorldVersion,
    this.onDeletePermanently,
    this.onImportRecords,
    this.onOpenDemo,
    this.onDemoChanged,
  });

  final ExperienceController controller;
  final ValueChanged<ExperienceSummary> onOpen;
  final VoidCallback onCreate;
  final VoidCallback onExplore;
  final ValueChanged<PortalWorldVersion>? onOpenWorldVersion;
  final ValueChanged<PortalWorldVersion>? onEditWorldVersion;
  final Future<void> Function(String id)? onDeletePermanently;
  final Future<void> Function()? onImportRecords;
  final ValueChanged<String>? onOpenDemo;
  final VoidCallback? onDemoChanged;

  @override
  State<PortalLibrary> createState() => _PortalLibraryState();
}

class _PortalLibraryState extends State<PortalLibrary> {
  String _scope = '';
  Map<String, _PersonalStory> _personal = {};
  final Map<String, _StoryStatus> _statuses = {};
  final Map<String, ExperienceView> _views = {};
  List<PortalWorldVersion> _worldVersions = [];
  List<PortalDemoEntry> _demoEntries = [];
  String _shelfFingerprint = '';
  Future<void> _writes = Future<void>.value();
  int _probeVersion = 0;
  bool _loading = true;
  bool _readFailed = false;
  bool _probing = false;
  String? _storageError;
  String? _worldError;
  String? _demoError;
  String _query = '';
  final TextEditingController _searchController = TextEditingController();
  String _category = 'active';
  String _group = '';
  String _sort = 'updated';
  bool _batchMode = false;
  final Set<String> _selected = {};

  ExperienceController get c => widget.controller;
  PortalDemoRepository get _demoRepository => PortalDemoRepository(
    journal: c.journal,
    backendUrl: c.session.backendUrl,
    workspaceId: c.session.workspaceId,
  );

  String get _libraryScope => experienceScope(
    c.session.backendUrl,
    c.session.workspaceId,
    'library',
    'personal-v1',
  );

  @override
  void initState() {
    super.initState();
    _scope = _libraryScope;
    c.addListener(_onController);
    c.session.addListener(_onSession);
    unawaited(_hydrate());
    unawaited(_loadWorlds());
    unawaited(_loadDemos());
    unawaited(c.refreshShelf());
    _checkShelf();
  }

  @override
  void didUpdateWidget(covariant PortalLibrary oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller == widget.controller) return;
    oldWidget.controller.removeListener(_onController);
    oldWidget.controller.session.removeListener(_onSession);
    c.addListener(_onController);
    c.session.addListener(_onSession);
    _switchScope();
    unawaited(c.refreshShelf());
  }

  @override
  void dispose() {
    _probeVersion++;
    _searchController.dispose();
    c.removeListener(_onController);
    c.session.removeListener(_onSession);
    super.dispose();
  }

  void _onSession() {
    if (_scope != _libraryScope) _switchScope();
  }

  void _switchScope() {
    _scope = _libraryScope;
    _probeVersion++;
    _shelfFingerprint = '';
    _statuses.clear();
    _views.clear();
    _worldVersions = [];
    _demoEntries = [];
    _personal = {};
    _selected.clear();
    _loading = true;
    _readFailed = false;
    _storageError = null;
    _worldError = null;
    _demoError = null;
    if (mounted) setState(() {});
    unawaited(_hydrate());
    unawaited(_loadWorlds());
    unawaited(_loadDemos());
    _checkShelf();
  }

  void _onController() {
    if (!mounted) return;
    _checkShelf();
    setState(() {});
  }

  Future<void> _hydrate() async {
    final scope = _scope;
    try {
      final row = await c.journal.read(scope);
      if (!mounted || scope != _scope) return;
      final raw = row['personal'];
      final parsed = <String, _PersonalStory>{};
      if (raw is Map) {
        for (final entry in raw.entries) {
          if (entry.key is String && entry.value is Map) {
            parsed[entry.key as String] = _PersonalStory.fromJson(
              entry.value as Map,
            );
          }
        }
      }
      setState(() {
        _personal = parsed;
        _loading = false;
        _readFailed = false;
        _storageError = null;
      });
    } catch (_) {
      if (!mounted || scope != _scope) return;
      setState(() {
        _loading = false;
        _readFailed = true;
        _storageError = '本机书架整理信息读取失败；已有经历仍保存在正式服务中。请重试读取后再整理。';
      });
    }
  }

  Future<void> _loadWorlds() async {
    final scope = _scope;
    try {
      final versions = await PortalWorldRepository(
        journal: c.journal,
        backendUrl: c.session.backendUrl,
        workspaceId: c.session.workspaceId,
      ).loadVersions();
      if (!mounted || scope != _scope) return;
      setState(() {
        _worldVersions = versions;
        _worldError = null;
      });
    } catch (_) {
      if (mounted && scope == _scope) {
        setState(() => _worldError = '本机创作版本暂时无法读取，请重试。');
      }
    }
  }

  Future<void> _loadDemos() async {
    final scope = _scope;
    try {
      final entries = await _demoRepository.loadEntries();
      if (!mounted || scope != _scope) return;
      setState(() {
        _demoEntries = entries;
        _demoError = null;
      });
    } catch (_) {
      if (mounted && scope == _scope) {
        setState(() => _demoError = '本机预设演示暂时无法读取，请重试。');
      }
    }
  }

  void _checkShelf() {
    final items = List<ExperienceSummary>.of(c.shelf);
    final fingerprint = items
        .map(
          (item) =>
              '${item.id}\u0000${item.activeBranchId}\u0000${item.updatedAt}',
        )
        .join('\u0001');
    if (fingerprint == _shelfFingerprint) return;
    _shelfFingerprint = fingerprint;
    _statuses.clear();
    _views.clear();
    final version = ++_probeVersion;
    _probing = items.isNotEmpty;
    if (items.isNotEmpty) unawaited(_probeStatuses(items, version));
  }

  /// The list response has no ending or creation timestamp. Read active
  /// snapshots for those labels, without copying pages into local metadata.
  Future<void> _probeStatuses(
    List<ExperienceSummary> items,
    int version,
  ) async {
    var cursor = 0;
    Future<void> worker() async {
      while (cursor < items.length) {
        final item = items[cursor++];
        try {
          final view = await c.api.view(item.id, branch: item.activeBranchId);
          if (!mounted || version != _probeVersion) return;
          final firstDate = view.pages.isEmpty
              ? null
              : DateTime.tryParse(view.pages.first.createdAt);
          setState(() {
            _views[item.id] = view;
            _statuses[item.id] = _StoryStatus(
              ended:
                  view.pages.isNotEmpty && view.pages.last.outcome == 'ending',
              firstPageAt: firstDate,
            );
          });
        } catch (_) {
          // Leave this status unknown. Never infer completion from title/seed.
        }
      }
    }

    await Future.wait(
      List.generate(items.length < 3 ? items.length : 3, (_) => worker()),
    );
    if (mounted && version == _probeVersion) setState(() => _probing = false);
  }

  _PersonalStory _meta(String id) => _personal[id] ?? _PersonalStory();

  ExperienceView? _viewOf(ExperienceSummary item) {
    final cached = _views[item.id];
    if (cached != null && cached.branchId == item.activeBranchId) return cached;
    final current = c.current;
    if (current?.id == item.id && current?.branchId == item.activeBranchId) {
      return current;
    }
    return cached;
  }

  String _title(ExperienceSummary item) =>
      portalStoryDisplayTitle(item, localName: _meta(item.id).displayName);

  String _storyExcerpt(ExperienceSummary item, ExperienceView? view) {
    final prose = view?.pages.lastOrNull?.text.trim();
    if (prose != null && prose.isNotEmpty) return portalStorySnippet(prose);
    for (final world in demoWorldPresets) {
      if (item.seed.startsWith('世界名称：${world.title}\n')) {
        final description = portalWorldDataById[world.id]?.description;
        if (description?.isNotEmpty == true) {
          return portalStorySnippet(description!);
        }
        return portalStorySnippet(world.tagline);
      }
    }
    final description = RegExp(
      r'^世界简介：([^\r\n]+)',
      multiLine: true,
    ).firstMatch(item.seed)?.group(1)?.trim();
    if (description?.isNotEmpty == true) {
      return portalStorySnippet(description!);
    }
    return '已保存的经历，正在读取故事正文…';
  }

  String _progressOf(ExperienceSummary item, ExperienceView? view) {
    if (view == null) return '正在读取进度…';
    final turns = portalStoryTurnCount(view);
    final branch = view.branches
        .where((entry) => entry.id == item.activeBranchId)
        .firstOrNull;
    final branchName = branch?.name.trim() ?? '';
    final meaningful =
        branchName.isNotEmpty &&
        (view.branches.length > 1 ||
            !const {'最初的故事', '主线', 'main'}.contains(branchName));
    return '$turns 回合${turns == 0 ? ' · 开场' : ''}'
        '${meaningful ? ' · 分支：$branchName' : ''}';
  }

  void _changeMany(Iterable<String> ids, void Function(_PersonalStory) change) {
    if (_storageError != null || _loading) return;
    setState(() {
      for (final id in ids) {
        final next = _meta(id).copy();
        change(next);
        _personal[id] = next;
      }
      _selected.clear();
    });
    _persist();
  }

  void _persist() {
    final scope = _scope;
    final journal = c.journal;
    final payload = <String, dynamic>{
      for (final entry in _personal.entries) entry.key: entry.value.toJson(),
    };
    _writes = _writes.then((_) async {
      try {
        await journal.patch(scope, {'personal': payload});
        if (mounted && scope == _scope && _storageError != null) {
          setState(() => _storageError = null);
        }
      } catch (_) {
        if (mounted && scope == _scope) {
          setState(() => _storageError = '本机整理信息保存失败；请重试，正式正文未改变。');
        }
      }
    });
  }

  Future<void> _edit(ExperienceSummary item) async {
    final old = _meta(item.id);
    final result = await showDialog<_EditResult>(
      context: context,
      builder: (_) => _LibraryEditDialog(
        title: _title(item),
        note: old.note,
        group: old.group,
      ),
    );
    if (result == null || !mounted) return;
    _changeMany([item.id], (value) {
      value.displayName = result.title;
      value.note = result.note;
      value.group = result.group;
    });
  }

  Future<void> _changeDemo(String worldId, Map<String, dynamic> fields) async {
    try {
      await _demoRepository.updatePersonal(worldId, fields);
      await _loadDemos();
      widget.onDemoChanged?.call();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('预设演示整理失败：$error')));
      }
    }
  }

  Future<void> _editDemo(PortalDemoEntry entry) async {
    final result = await showDialog<_EditResult>(
      context: context,
      builder: (_) => _LibraryEditDialog(
        title: entry.title,
        note: entry.note,
        group: entry.group,
      ),
    );
    if (result == null || !mounted) return;
    await _changeDemo(entry.id, {
      'display_name': result.title,
      'note': result.note,
      'group': result.group,
    });
  }

  Future<void> _exportDemo(
    PortalDemoEntry entry, {
    required bool markdown,
  }) async {
    final turns = entry.session['turns'] is List
        ? (entry.session['turns'] as List).whereType<Map>().toList()
        : <Map>[];
    final opening =
        entry.readonlyOpening?['opening'] as String? ??
        portalWorldDataById[entry.worldId]?.opening ??
        '';
    final kind = entry.readOnly ? '只读开场' : '预设演示';
    final content = markdown
        ? '# ${entry.title}\n\n$opening\n\n${turns.map((turn) => '> ${turn['input'] ?? ''}\n\n${turn['prose'] ?? ''}').join('\n\n---\n\n')}'
        : const JsonEncoder.withIndent('  ').convert({
            'schema': 'elselife-readable-demo-v1',
            'readOnly': true,
            'worldId': entry.worldId,
            'title': entry.title,
            'opening': opening,
            'turns': turns,
          });
    try {
      final safe = entry.title.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
      final downloaded = await text_export.exportPortalText(
        '$safe-$kind.${markdown ? 'md' : 'json'}',
        content,
        markdown
            ? 'text/markdown;charset=utf-8'
            : 'application/json;charset=utf-8',
      );
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          SnackBar(content: Text(downloaded ? '$kind已导出。' : '$kind内容已复制到剪贴板。')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('导出失败：$error')));
      }
    }
  }

  Future<void> _actionDemo(String action, PortalDemoEntry entry) async {
    switch (action) {
      case 'pin':
        await _changeDemo(entry.id, {'pinned': !entry.pinned});
        return;
      case 'edit':
        await _editDemo(entry);
        return;
      case 'archive':
        await _changeDemo(entry.id, {'archived': !entry.archived});
        return;
      case 'trash':
        if (await _confirmTrash(1, demo: true) && mounted) {
          await _changeDemo(entry.id, {
            'trashed_at': DateTime.now().millisecondsSinceEpoch,
          });
        }
        return;
      case 'restore':
        await _changeDemo(entry.id, {'trashed_at': null});
        return;
      case 'export-markdown':
        await _exportDemo(entry, markdown: true);
        return;
      case 'export-json':
        await _exportDemo(entry, markdown: false);
        return;
      case 'delete':
        final accepted = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('永久删除${entry.readOnly ? '只读开场' : '预设演示'}？'),
            content: const Text('这会清除这段本机经历，无法恢复；世界资料仍会保留。'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('永久删除'),
              ),
            ],
          ),
        );
        if (accepted == true) {
          try {
            await _demoRepository.removePermanently(entry.id);
            await _loadDemos();
            widget.onDemoChanged?.call();
          } catch (error) {
            if (mounted) {
              ScaffoldMessenger.maybeOf(
                context,
              )?.showSnackBar(SnackBar(content: Text('删除失败：$error')));
            }
          }
        }
        return;
    }
  }

  Future<bool> _confirmTrash(int count, {bool demo = false}) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('移入本机回收箱？'),
          content: Text(
            demo
                ? '所选 $count 段本机经历会移入回收箱，之后可以恢复。'
                : '所选 $count 段经历会从本机常用书架中隐藏，可随时恢复。正式服务中的故事和全部分支不会删除。',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('移入回收箱'),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _deletePermanently(ExperienceSummary item) async {
    final remove = widget.onDeletePermanently;
    if (remove == null) return;
    final accepted =
        await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('永久删除这段故事？'),
            content: const Text('这会删除故事、全部分支和正文，无法从回收箱恢复。需要留存时，请先导出阅读记录。'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('永久删除'),
              ),
            ],
          ),
        ) ??
        false;
    if (!accepted || !mounted) return;
    try {
      await remove(item.id);
      await c.refreshShelf();
      await _loadDemos();
      if (!mounted) return;
      setState(() {
        _personal.remove(item.id);
        _statuses.remove(item.id);
        _views.remove(item.id);
        _selected.remove(item.id);
      });
      _persist();
      ScaffoldMessenger.maybeOf(
        context,
      )?.showSnackBar(const SnackBar(content: Text('故事已永久删除。')));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('删除失败：$error')));
      }
    }
  }

  Future<void> _importRecords() async {
    final import = widget.onImportRecords;
    if (import == null) return;
    try {
      await import();
      await c.refreshShelf();
      await _loadDemos();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('导入未完成：$error')));
      }
    }
  }

  Future<ExperienceView> _storyView(ExperienceSummary item) async {
    final cached = _viewOf(item);
    if (cached != null && cached.branchId == item.activeBranchId) return cached;
    return c.api.view(item.id, branch: item.activeBranchId);
  }

  Future<void> _exportStory(
    ExperienceSummary item, {
    required bool markdown,
  }) async {
    try {
      final view = await _storyView(item);
      final title = _title(item);
      final safe = title.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
      final content = markdown
          ? '# $title\n\n${view.pages.map((page) => [if (page.input.trim().isNotEmpty) '> ${page.input.replaceAll('\n', '\n> ')}', page.text].join('\n\n')).join('\n\n---\n\n')}'
          : const JsonEncoder.withIndent('  ').convert({
              'schema': 'elselife-readable-experience-v1',
              'readOnly': true,
              'id': view.id,
              'title': title,
              'branchId': view.branchId,
              'pages': [
                for (final page in view.pages)
                  {
                    'revision': page.revision,
                    'input': page.input,
                    'text': page.text,
                    'storyTime': page.storyTime,
                    'createdAt': page.createdAt,
                    'outcome': page.outcome,
                  },
              ],
            });
      final downloaded = await text_export.exportPortalText(
        '$safe.${markdown ? 'md' : 'json'}',
        content,
        markdown
            ? 'text/markdown;charset=utf-8'
            : 'application/json;charset=utf-8',
      );
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          SnackBar(
            content: Text(
              downloaded
                  ? '已导出当前分支${markdown ? '正文' : '阅读记录'}。'
                  : '阅读内容已复制到剪贴板。',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(SnackBar(content: Text('导出失败：$error')));
      }
    }
  }

  List<PortalWorldVersion> get _latestWorlds {
    final latest = <String, PortalWorldVersion>{};
    for (final version in _worldVersions) {
      final old = latest[version.draft.id];
      if (old == null || version.version > old.version) {
        latest[version.draft.id] = version;
      }
    }
    final terms = _query
        .trim()
        .toLowerCase()
        .split(RegExp(r'\s+'))
        .where((value) => value.isNotEmpty);
    final result = latest.values.where((version) {
      final draft = version.draft;
      final searchable =
          '${draft.title} ${draft.description} ${draft.era} ${draft.identity} ${draft.location}'
              .toLowerCase();
      return terms.every(searchable.contains);
    }).toList();
    result.sort((a, b) => b.savedAt.compareTo(a.savedAt));
    return result;
  }

  Future<void> _exportWorld(PortalWorldVersion version) async {
    final accepted =
        await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('导出本机世界版本'),
            content: const Text('JSON 包含人物目标、关系经历和幕后秘密，只适合作者自己备份。'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('导出 JSON'),
              ),
            ],
          ),
        ) ??
        false;
    if (!accepted || !mounted) return;
    final safe = version.draft.title.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    final content = const JsonEncoder.withIndent('  ').convert({
      ...version.draft.toJson(),
      'version': version.version,
      'savedAt': version.savedAt.toUtc().toIso8601String(),
      'localOnly': true,
    });
    final downloaded = await text_export.exportPortalText(
      '$safe-第${version.version}版.json',
      content,
      'application/json;charset=utf-8',
    );
    if (mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(content: Text(downloaded ? '世界版本已导出。' : '世界版本 JSON 已复制到剪贴板。')),
      );
    }
  }

  Future<void> _action(String action, ExperienceSummary item) async {
    switch (action) {
      case 'pin':
        _changeMany([item.id], (value) => value.pinned = !value.pinned);
        return;
      case 'edit':
        await _edit(item);
        return;
      case 'archive':
        _changeMany([item.id], (value) => value.archived = !value.archived);
        return;
      case 'trash':
        if (await _confirmTrash(1) && mounted) {
          _changeMany(
            [item.id],
            (value) => value.trashedAt = DateTime.now().millisecondsSinceEpoch,
          );
        }
        return;
      case 'restore':
        _changeMany([item.id], (value) => value.trashedAt = null);
        return;
      case 'export-markdown':
        await _exportStory(item, markdown: true);
        return;
      case 'export-json':
        await _exportStory(item, markdown: false);
        return;
      case 'delete':
        await _deletePermanently(item);
        return;
    }
  }

  Future<void> _batchAction(
    String action,
    List<ExperienceSummary> visible,
    List<PortalDemoEntry> visibleDemos,
  ) async {
    final ids = visible
        .where((item) => _selected.contains(item.id))
        .map((item) => item.id)
        .toList();
    final demoIds = visibleDemos
        .where((entry) => _selected.contains('demo:${entry.id}'))
        .map((entry) => entry.id)
        .toList();
    if (ids.isEmpty && demoIds.isEmpty) return;
    if (action == 'trash' &&
        !await _confirmTrash(ids.length + demoIds.length, demo: ids.isEmpty)) {
      return;
    }
    if (!mounted) return;
    if (ids.isNotEmpty) {
      _changeMany(ids, (value) {
        switch (action) {
          case 'archive':
            value.archived = true;
            break;
          case 'unarchive':
            value.archived = false;
            break;
          case 'trash':
            value.trashedAt = DateTime.now().millisecondsSinceEpoch;
            break;
          case 'restore':
            value.trashedAt = null;
            break;
        }
      });
    }
    if (demoIds.isNotEmpty) {
      final fields = switch (action) {
        'archive' => <String, dynamic>{'archived': true},
        'unarchive' => <String, dynamic>{'archived': false},
        'trash' => <String, dynamic>{
          'trashed_at': DateTime.now().millisecondsSinceEpoch,
        },
        _ => <String, dynamic>{'trashed_at': null},
      };
      try {
        await Future.wait(
          demoIds.map((id) => _demoRepository.updatePersonal(id, fields)),
        );
        await _loadDemos();
        widget.onDemoChanged?.call();
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.maybeOf(
            context,
          )?.showSnackBar(SnackBar(content: Text('部分预设演示整理失败：$error')));
        }
      }
    }
    if (mounted) setState(_selected.clear);
  }

  List<PortalDemoEntry> _visibleDemos() {
    final terms = _query
        .trim()
        .toLowerCase()
        .split(RegExp(r'\s+'))
        .where((term) => term.isNotEmpty);
    final result = _demoEntries.where((entry) {
      final trashed = entry.trashedAt != null;
      if (_category == 'trash' ? !trashed : trashed) return false;
      if (_category == 'active' && (entry.archived || entry.ended)) {
        return false;
      }
      if (_category == 'ended' && (!entry.ended || entry.archived)) {
        return false;
      }
      if (_category == 'archived' && !entry.archived) return false;
      if (_category == 'pinned' && !entry.pinned) return false;
      if (_group.isNotEmpty && entry.group != _group) return false;
      return terms.every(entry.searchableText.contains);
    }).toList();
    result.sort((a, b) {
      final pin = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pin != 0) return pin;
      if (_sort == 'title') return a.title.compareTo(b.title);
      final aTime = _sort == 'created' ? a.createdAt : a.updatedAt;
      final bTime = _sort == 'created' ? b.createdAt : b.updatedAt;
      return bTime.compareTo(aTime);
    });
    return result;
  }

  void _resetFilters() {
    _searchController.clear();
    setState(() {
      _query = '';
      _category = 'active';
      _group = '';
      _sort = 'updated';
      _selected.clear();
    });
  }

  List<ExperienceSummary> _visible() {
    final terms = _query
        .trim()
        .toLowerCase()
        .split(RegExp(r'\s+'))
        .where((value) => value.isNotEmpty);
    final result = c.shelf.where((item) {
      final meta = _meta(item.id);
      final trashed = meta.trashedAt != null;
      if (_category == 'trash' ? !trashed : trashed) return false;
      final ended = _statuses[item.id]?.ended == true;
      if (_category == 'active' && (meta.archived || ended)) return false;
      if (_category == 'ended' && (!ended || meta.archived)) return false;
      if (_category == 'archived' && !meta.archived) return false;
      if (_category == 'pinned' && !meta.pinned) return false;
      if (_group.isNotEmpty && meta.group != _group) return false;
      final view = _viewOf(item);
      final publicPages =
          view?.pages.map((page) => '${page.input} ${page.text}').join(' ') ??
          '';
      final searchable =
          '${_title(item)} ${meta.note} ${meta.group} $publicPages'
              .toLowerCase();
      return terms.every(searchable.contains);
    }).toList();
    result.sort((a, b) {
      final pin = (_meta(b.id).pinned ? 1 : 0) - (_meta(a.id).pinned ? 1 : 0);
      if (pin != 0) return pin;
      if (_sort == 'title') return _title(a).compareTo(_title(b));
      DateTime? date(ExperienceSummary item) => _sort == 'created'
          ? _statuses[item.id]?.firstPageAt ?? DateTime.tryParse(item.updatedAt)
          : DateTime.tryParse(item.updatedAt);
      return (date(b)?.millisecondsSinceEpoch ?? 0).compareTo(
        date(a)?.millisecondsSinceEpoch ?? 0,
      );
    });
    return result;
  }

  String? _earlierSearchMatch(ExperienceSummary item) {
    final view = _viewOf(item);
    if (view == null || view.pages.length < 2 || _query.trim().isEmpty) {
      return null;
    }
    final terms = _query.trim().toLowerCase().split(RegExp(r'\s+'));
    final latest = '${view.pages.last.input} ${view.pages.last.text}'
        .toLowerCase();
    if (terms.every(latest.contains)) return null;
    for (final page in view.pages.take(view.pages.length - 1)) {
      final prose = '${page.input} ${page.text}';
      if (terms.any(prose.toLowerCase().contains)) return prose.trim();
    }
    return null;
  }

  String _date(String value) {
    final parsed = DateTime.tryParse(value)?.toLocal();
    if (parsed == null) return '时间未记录';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${parsed.year}/${two(parsed.month)}/${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final visible = _visible();
    final visibleDemos = _visibleDemos();
    final combined = <({ExperienceSummary? story, PortalDemoEntry? demo})>[
      for (final story in visible) (story: story, demo: null),
      for (final demo in visibleDemos) (story: null, demo: demo),
    ];
    DateTime itemDate(
      ({ExperienceSummary? story, PortalDemoEntry? demo}) item,
      bool created,
    ) {
      if (item.demo case final demo?) {
        return created ? demo.createdAt : demo.updatedAt;
      }
      final story = item.story!;
      return created
          ? _statuses[story.id]?.firstPageAt ??
                DateTime.tryParse(story.updatedAt) ??
                DateTime(1970)
          : DateTime.tryParse(story.updatedAt) ?? DateTime(1970);
    }

    bool pinned(({ExperienceSummary? story, PortalDemoEntry? demo}) item) =>
        item.demo?.pinned ?? _meta(item.story!.id).pinned;
    String title(({ExperienceSummary? story, PortalDemoEntry? demo}) item) =>
        item.demo?.title ?? _title(item.story!);
    combined.sort((a, b) {
      final byPin = (pinned(b) ? 1 : 0) - (pinned(a) ? 1 : 0);
      if (byPin != 0) return byPin;
      if (_sort == 'title') return title(a).compareTo(title(b));
      return itemDate(
        b,
        _sort == 'created',
      ).compareTo(itemDate(a, _sort == 'created'));
    });
    final allGroups = [
      ..._personal.values.map((value) => value.group),
      ..._demoEntries.map((entry) => entry.group),
    ].where((value) => value.isNotEmpty).toSet().toList()..sort();
    final recent =
        _category == 'active' &&
            _query.isEmpty &&
            _group.isEmpty &&
            combined.isNotEmpty
        ? ([...combined]..sort(
                (a, b) => itemDate(b, false).compareTo(itemDate(a, false)),
              ))
              .first
        : null;
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = MediaQuery.sizeOf(context).width <= 700;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'YOUR WORLDS',
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontFamily: 'SpaceGrotesk',
                          letterSpacing: 2.5,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '我的世界',
                        style: theme.textTheme.headlineLarge?.copyWith(
                          fontFamily: 'NotoSerifSC',
                          fontSize: narrow ? 34 : 42,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '继续上次的经历，或回顾已经走过的故事。',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
                if (widget.onImportRecords != null)
                  PopupMenuButton<String>(
                    tooltip: '经历管理',
                    onSelected: (action) {
                      if (action == 'import') unawaited(_importRecords());
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'import', child: Text('导入记录')),
                    ],
                    icon: const PortalIcon('more'),
                  ),
              ],
            ),
            const SizedBox(height: 25),
            Divider(color: colors.outlineVariant),
            const SizedBox(height: 32),
            if (_storageError != null)
              Material(
                color: colors.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(child: Text(_storageError!)),
                      TextButton(
                        onPressed: _readFailed ? _hydrate : _persist,
                        child: Text(_readFailed ? '重试读取' : '重试保存'),
                      ),
                    ],
                  ),
                ),
              ),
            if (_worldError != null)
              Material(
                color: colors.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(child: Text(_worldError!)),
                      TextButton(
                        onPressed: _loadWorlds,
                        child: const Text('重试读取'),
                      ),
                    ],
                  ),
                ),
              ),
            if (_demoError != null)
              Material(
                color: colors.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(child: Text(_demoError!)),
                      TextButton(
                        onPressed: _loadDemos,
                        child: const Text('重试读取'),
                      ),
                    ],
                  ),
                ),
              ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Text('正在读取本机书架整理信息…'),
              ),
            if (recent != null) ...[
              recent.demo == null
                  ? _recentCard(recent.story!, narrow)
                  : _recentDemoCard(recent.demo!, narrow),
              const SizedBox(height: 30),
            ],
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final category in const [
                    ('active', '进行中'),
                    ('ended', '已完结'),
                    ('all', '全部'),
                  ]) ...[
                    ChoiceChip(
                      label: Text(category.$2),
                      selected: _category == category.$1,
                      onSelected: (_) => setState(() {
                        _category = category.$1;
                        _selected.clear();
                      }),
                    ),
                    const SizedBox(width: 8),
                  ],
                  PopupMenuButton<String>(
                    tooltip: '更多故事状态',
                    onSelected: (value) => setState(() {
                      _category = value;
                      _selected.clear();
                    }),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'pinned', child: Text('已置顶')),
                      PopupMenuItem(value: 'archived', child: Text('已封存')),
                      PopupMenuItem(value: 'trash', child: Text('回收箱')),
                    ],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 12,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(switch (_category) {
                            'pinned' => '已置顶',
                            'archived' => '已封存',
                            'trash' => '回收箱',
                            _ => '更多',
                          }),
                          const SizedBox(width: 4),
                          const PortalIcon('chevron-down', size: 16),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: _searchField()),
                IconButton(
                  tooltip: '搜索我的世界',
                  onPressed: () => setState(() {}),
                  icon: const PortalIcon('arrow-right'),
                ),
                IconButton(
                  tooltip: '分组与排序',
                  onPressed: () => _showSortDialog(allGroups),
                  icon: const PortalIcon('status'),
                ),
              ],
            ),
            if (_query.isNotEmpty || _group.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    '${combined.length} 个结果',
                    style: theme.textTheme.labelSmall,
                  ),
                  TextButton(
                    onPressed: _resetFilters,
                    child: const Text('清空筛选'),
                  ),
                ],
              ),
            ],
            if (_probing)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('正在核对各经历的完结状态…', style: theme.textTheme.labelSmall),
              ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${combined.length} 段经历',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                TextButton.icon(
                  onPressed: combined.isEmpty
                      ? null
                      : () => setState(() {
                          _batchMode = !_batchMode;
                          _selected.clear();
                        }),
                  icon: const PortalIcon('layers'),
                  label: Text(_batchMode ? '完成整理' : '批量整理'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (combined.isEmpty) _empty(theme),
            for (final item in combined) ...[
              item.demo == null
                  ? _storyCard(item.story!, narrow)
                  : _demoCard(item.demo!, narrow),
              const SizedBox(height: 10),
            ],
            if (_batchMode && combined.isNotEmpty)
              _batchBar(visible, visibleDemos),
            if (_category != 'trash' && _latestWorlds.isNotEmpty) ...[
              const SizedBox(height: 32),
              Row(
                children: [
                  Expanded(
                    child: Text('我创建的世界', style: theme.textTheme.titleLarge),
                  ),
                  Text(
                    '${_latestWorlds.length} 个本机世界',
                    style: theme.textTheme.labelSmall,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final version in _latestWorlds)
                    SizedBox(
                      width: narrow ? constraints.maxWidth : 320,
                      child: _worldCard(version),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 22),
            Text(
              '预设演示仅存本机。正式故事的置顶、显示名、备注、分组、封存和回收箱只影响本机列表；永久删除会移除故事和全部分支。',
              style: theme.textTheme.labelSmall,
            ),
          ],
        );
      },
    );
  }

  Widget _worldCard(PortalWorldVersion version) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final draft = version.draft;
    return PortalCardSurface(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: widget.onOpenWorldVersion == null
            ? null
            : () => widget.onOpenWorldVersion!(version),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '本机创作 · 第 ${version.version} 版',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: colors.primary,
                ),
              ),
              const SizedBox(height: 9),
              Text(
                draft.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontFamily: 'NotoSerifSC',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                draft.description.isEmpty ? draft.opening : draft.description,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 7,
                children: [
                  if (widget.onOpenWorldVersion != null)
                    TextButton(
                      onPressed: () => widget.onOpenWorldVersion!(version),
                      child: const Text('查看世界'),
                    ),
                  if (widget.onEditWorldVersion != null)
                    TextButton(
                      onPressed: () => widget.onEditWorldVersion!(version),
                      child: const Text('编辑新版本'),
                    ),
                  TextButton(
                    onPressed: () => _exportWorld(version),
                    child: const Text('导出'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _recentCard(ExperienceSummary item, bool narrow) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final view = _viewOf(item);
    final cover =
        demoWorldPresets
            .where((world) => item.seed.startsWith('世界名称：${world.title}\n'))
            .map((world) => world.imageAsset)
            .firstOrNull ??
        'assets/worlds/cinema-hero.jpg';
    final content = Padding(
      padding: EdgeInsets.all(narrow ? 24 : 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '你离开的地方',
            style: theme.textTheme.labelSmall?.copyWith(
              color: colors.primary,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 11),
          Text(
            _title(item),
            style: theme.textTheme.headlineSmall?.copyWith(
              fontFamily: 'NotoSerifSC',
            ),
          ),
          if (view?.pages.lastOrNull?.storyTime.isNotEmpty == true) ...[
            const SizedBox(height: 6),
            Text(view!.pages.last.storyTime, style: theme.textTheme.labelSmall),
          ],
          const SizedBox(height: 14),
          Text(
            _storyExcerpt(item, view),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyLarge?.copyWith(
              fontFamily: 'NotoSerifSC',
              height: 1.9,
            ),
          ),
          const SizedBox(height: 14),
          Text(_progressOf(item, view), style: theme.textTheme.labelSmall),
          const SizedBox(height: 19),
          FilledButton(
            onPressed: () => widget.onOpen(item),
            child: const Text('回到世界 →'),
          ),
        ],
      ),
    );
    final artwork = SizedBox(
      width: double.infinity,
      height: narrow ? 180 : 310,
      child: Image.asset(
        cover,
        fit: BoxFit.cover,
        excludeFromSemantics: true,
        errorBuilder: (_, _, _) => ColoredBox(
          color: colors.primaryContainer,
          child: const Center(child: PortalIcon('orbit', size: 56)),
        ),
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border.all(color: colors.outlineVariant),
        ),
        child: narrow
            ? Column(children: [artwork, content])
            : Row(
                children: [
                  Expanded(flex: 5, child: content),
                  Expanded(flex: 4, child: artwork),
                ],
              ),
      ),
    );
  }

  Widget _recentDemoCard(PortalDemoEntry entry, bool narrow) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final preset = demoWorldPresets
        .where((world) => world.id == entry.worldId)
        .firstOrNull;
    final cover = preset?.imageAsset ?? 'assets/worlds/cinema-hero.jpg';
    final excerpt = entry.latestProse.isNotEmpty
        ? entry.latestProse
        : portalWorldDataById[entry.worldId]?.opening ?? '';
    final content = Padding(
      padding: EdgeInsets.all(narrow ? 24 : 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '你离开的地方 · ${entry.readOnly ? '只读开场' : '预设演示'}',
            style: theme.textTheme.labelSmall?.copyWith(
              color: colors.primary,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 11),
          Text(
            entry.title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontFamily: 'NotoSerifSC',
            ),
          ),
          const SizedBox(height: 14),
          Text(
            excerpt,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyLarge?.copyWith(
              fontFamily: 'NotoSerifSC',
              height: 1.9,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            entry.readOnly ? '开场 · 仅存本机' : '已走过 ${entry.step} / 8 个固定片刻 · 仅存本机',
            style: theme.textTheme.labelSmall,
          ),
          const SizedBox(height: 19),
          FilledButton(
            onPressed: widget.onOpenDemo == null
                ? null
                : () => widget.onOpenDemo!(entry.id),
            child: const Text('回到世界 →'),
          ),
        ],
      ),
    );
    final artwork = SizedBox(
      width: double.infinity,
      height: narrow ? 180 : 310,
      child: Image.asset(
        cover,
        fit: BoxFit.cover,
        excludeFromSemantics: true,
        errorBuilder: (_, _, _) => ColoredBox(
          color: colors.primaryContainer,
          child: const Center(child: PortalIcon('orbit', size: 56)),
        ),
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border.all(color: colors.outlineVariant),
        ),
        child: narrow
            ? Column(children: [artwork, content])
            : Row(
                children: [
                  Expanded(flex: 5, child: content),
                  Expanded(flex: 4, child: artwork),
                ],
              ),
      ),
    );
  }

  Widget _searchField() => TextField(
    key: const ValueKey('portal-library-search'),
    controller: _searchController,
    onChanged: (value) => setState(() => _query = value),
    maxLength: 300,
    decoration: const InputDecoration(
      labelText: '搜索我的世界',
      prefixIcon: PortalIcon('search'),
      counterText: '',
    ),
  );

  Future<void> _showSortDialog(List<String> groups) => showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('分组与排序'),
      content: SizedBox(
        width: 330,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _groupField(groups),
            const SizedBox(height: 16),
            _sortField(),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('完成'),
        ),
      ],
    ),
  );

  Widget _groupField(List<String> groups) => DropdownButtonFormField<String>(
    key: ValueKey(
      'portal-library-group-${groups.join('|')}-${groups.contains(_group) ? _group : ''}',
    ),
    initialValue: groups.contains(_group) ? _group : '',
    isExpanded: true,
    decoration: const InputDecoration(labelText: '分组'),
    items: [
      const DropdownMenuItem(value: '', child: Text('所有分组')),
      for (final group in groups)
        DropdownMenuItem(
          value: group,
          child: Text(group, overflow: TextOverflow.ellipsis),
        ),
    ],
    onChanged: (value) => setState(() => _group = value ?? ''),
  );

  Widget _sortField() => DropdownButtonFormField<String>(
    initialValue: _sort,
    isExpanded: true,
    decoration: const InputDecoration(labelText: '排序'),
    items: const [
      DropdownMenuItem(value: 'updated', child: Text('最近进入')),
      DropdownMenuItem(value: 'created', child: Text('创建时间')),
      DropdownMenuItem(value: 'title', child: Text('世界名称')),
    ],
    onChanged: (value) => setState(() => _sort = value ?? 'updated'),
  );

  Widget _empty(ThemeData theme) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 44),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _query.isNotEmpty || _group.isNotEmpty
              ? '没有找到符合条件的故事'
              : _category == 'trash'
              ? '回收箱是空的'
              : _category == 'pinned'
              ? '还没有置顶的故事'
              : _category == 'archived'
              ? '还没有封存的故事'
              : _category == 'ended'
              ? '还没有标记完结的故事'
              : _category == 'active' &&
                    [...c.shelf].any((item) => _meta(item.id).trashedAt == null)
              ? '这里暂时没有进行中的故事'
              : '你的第一段故事，还未开始',
          style: theme.textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(_category == 'trash' ? '移入回收箱的经历可以在这里恢复。' : '可以调整筛选，或先从一个世界开始。'),
        const SizedBox(height: 18),
        if (_query.isNotEmpty || _group.isNotEmpty || _category != 'active')
          TextButton(onPressed: _resetFilters, child: const Text('清空筛选')),
        OutlinedButton(
          onPressed: widget.onExplore,
          child: const Text('看看已有开局'),
        ),
      ],
    ),
  );

  Widget _storyCard(ExperienceSummary item, bool narrow) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final meta = _meta(item.id);
    final trashed = meta.trashedAt != null;
    final earlierMatch = _earlierSearchMatch(item);
    final view = _viewOf(item);
    final status = trashed
        ? '回收箱'
        : meta.archived
        ? '已封存'
        : _statuses[item.id]?.ended == true
        ? '已完结'
        : _statuses.containsKey(item.id)
        ? '进行中'
        : '状态待核对';
    return PortalCardSurface(
      interactive: !trashed,
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: InkWell(
        key: ValueKey('portal-library-story-${item.id}'),
        borderRadius: BorderRadius.circular(14),
        onTap: trashed ? null : () => widget.onOpen(item),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_batchMode) ...[
                Checkbox(
                  value: _selected.contains(item.id),
                  onChanged: (value) => setState(() {
                    if (value == true) {
                      _selected.add(item.id);
                    } else {
                      _selected.remove(item.id);
                    }
                  }),
                ),
                const SizedBox(width: 4),
              ] else if (!narrow) ...[
                PortalIcon('compass', color: colors.primary),
                const SizedBox(width: 18),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 9,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          _title(item),
                          style: theme.textTheme.titleLarge?.copyWith(
                            fontFamily: 'NotoSerifSC',
                            fontSize: narrow ? 20 : 24,
                          ),
                        ),
                        Text(
                          status,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: colors.primary,
                          ),
                        ),
                        if (meta.pinned)
                          const Text('已置顶', style: TextStyle(fontSize: 11)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _storyExcerpt(item, view),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium,
                    ),
                    if (earlierMatch != null) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
                        decoration: BoxDecoration(
                          color: colors.primaryContainer,
                          border: Border(
                            left: BorderSide(color: colors.primary, width: 2),
                          ),
                        ),
                        child: Text(
                          '匹配原文：$earlierMatch',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                    if (view != null) ...[
                      const SizedBox(height: 7),
                      Text(
                        [
                          _progressOf(item, view),
                          if (view.pages.lastOrNull?.storyTime.isNotEmpty ==
                              true)
                            view.pages.last.storyTime,
                        ].join(' · '),
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                    if (meta.note.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        '备注：${meta.note}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                    const SizedBox(height: 9),
                    Text(
                      [
                        if (meta.group.isNotEmpty) meta.group,
                        _date(item.updatedAt),
                      ].join(' · '),
                      style: theme.textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
              PopupMenuButton<String>(
                tooltip: '整理 ${_title(item)}',
                onSelected: (action) => unawaited(_action(action, item)),
                itemBuilder: (_) => trashed
                    ? [
                        const PopupMenuItem(
                          value: 'restore',
                          child: Text('恢复经历'),
                        ),
                        const PopupMenuItem(
                          value: 'export-markdown',
                          child: Text('导出正文 Markdown'),
                        ),
                        const PopupMenuItem(
                          value: 'export-json',
                          child: Text('导出阅读记录 JSON'),
                        ),
                        if (widget.onDeletePermanently != null)
                          const PopupMenuItem(
                            value: 'delete',
                            child: Text('永久删除'),
                          ),
                      ]
                    : [
                        PopupMenuItem(
                          value: 'pin',
                          child: Text(meta.pinned ? '取消置顶' : '置顶'),
                        ),
                        const PopupMenuItem(
                          value: 'edit',
                          child: Text('显示名、备注与分组'),
                        ),
                        PopupMenuItem(
                          value: 'archive',
                          child: Text(meta.archived ? '恢复封存' : '封存经历'),
                        ),
                        const PopupMenuItem(
                          value: 'trash',
                          child: Text('移入本机回收箱'),
                        ),
                        const PopupMenuItem(
                          value: 'export-markdown',
                          child: Text('导出正文 Markdown'),
                        ),
                        const PopupMenuItem(
                          value: 'export-json',
                          child: Text('导出阅读记录 JSON'),
                        ),
                      ],
                icon: const PortalIcon('more'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _demoCard(PortalDemoEntry entry, bool narrow) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final trashed = entry.trashedAt != null;
    final status = trashed
        ? '回收箱'
        : entry.archived
        ? '已封存'
        : entry.ended
        ? '已完结'
        : '进行中';
    final excerpt = entry.latestProse.isNotEmpty
        ? entry.latestProse
        : portalWorldDataById[entry.worldId]?.opening ?? '';
    return PortalCardSurface(
      interactive: !trashed,
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: InkWell(
        key: ValueKey('portal-library-demo-${entry.id}'),
        borderRadius: BorderRadius.circular(14),
        onTap: trashed || widget.onOpenDemo == null
            ? null
            : () => widget.onOpenDemo!(entry.id),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_batchMode) ...[
                Checkbox(
                  value: _selected.contains('demo:${entry.id}'),
                  onChanged: (value) => setState(() {
                    if (value == true) {
                      _selected.add('demo:${entry.id}');
                    } else {
                      _selected.remove('demo:${entry.id}');
                    }
                  }),
                ),
                const SizedBox(width: 4),
              ] else if (!narrow) ...[
                PortalIcon('book', color: colors.primary),
                const SizedBox(width: 18),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 9,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          entry.title,
                          style: theme.textTheme.titleLarge?.copyWith(
                            fontFamily: 'NotoSerifSC',
                            fontSize: narrow ? 20 : 24,
                          ),
                        ),
                        Text(
                          status,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: colors.primary,
                          ),
                        ),
                        Text(
                          entry.readOnly ? '只读开场' : '预设演示',
                          style: const TextStyle(fontSize: 11),
                        ),
                        if (entry.pinned) const PortalIcon('check', size: 16),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      excerpt,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 7),
                    Text(
                      entry.readOnly
                          ? '开场 · 仅存本机'
                          : '已走过 ${entry.step} / 8 个固定片刻 · 仅存本机',
                      style: theme.textTheme.labelSmall,
                    ),
                    if (entry.note.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        '备注：${entry.note}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                    const SizedBox(height: 9),
                    Text(
                      [
                        if (entry.group.isNotEmpty) entry.group,
                        _date(entry.updatedAt.toIso8601String()),
                      ].join(' · '),
                      style: theme.textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
              PopupMenuButton<String>(
                tooltip: '整理 ${entry.title}',
                onSelected: (action) => unawaited(_actionDemo(action, entry)),
                itemBuilder: (_) => trashed
                    ? [
                        const PopupMenuItem(
                          value: 'restore',
                          child: Text('恢复经历'),
                        ),
                        const PopupMenuItem(
                          value: 'export-markdown',
                          child: Text('导出正文 Markdown'),
                        ),
                        const PopupMenuItem(
                          value: 'export-json',
                          child: Text('导出阅读记录 JSON'),
                        ),
                        const PopupMenuItem(
                          value: 'delete',
                          child: Text('永久删除'),
                        ),
                      ]
                    : [
                        PopupMenuItem(
                          value: 'pin',
                          child: Text(entry.pinned ? '取消置顶' : '置顶'),
                        ),
                        const PopupMenuItem(
                          value: 'edit',
                          child: Text('显示名、备注与分组'),
                        ),
                        PopupMenuItem(
                          value: 'archive',
                          child: Text(entry.archived ? '恢复封存' : '封存经历'),
                        ),
                        const PopupMenuItem(
                          value: 'trash',
                          child: Text('移入本机回收箱'),
                        ),
                        const PopupMenuItem(
                          value: 'export-markdown',
                          child: Text('导出正文 Markdown'),
                        ),
                        const PopupMenuItem(
                          value: 'export-json',
                          child: Text('导出阅读记录 JSON'),
                        ),
                      ],
                icon: const PortalIcon('more'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _batchBar(
    List<ExperienceSummary> visible,
    List<PortalDemoEntry> visibleDemos,
  ) => Padding(
    padding: const EdgeInsets.only(top: 18),
    child: Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          '已选 ${visible.where((item) => _selected.contains(item.id)).length + visibleDemos.where((entry) => _selected.contains('demo:${entry.id}')).length} 段',
        ),
        if (_category == 'trash')
          OutlinedButton(
            onPressed: _selected.isEmpty
                ? null
                : () => _batchAction('restore', visible, visibleDemos),
            child: const Text('恢复所选'),
          )
        else ...[
          OutlinedButton(
            onPressed: _selected.isEmpty
                ? null
                : () => _batchAction('archive', visible, visibleDemos),
            child: const Text('封存所选'),
          ),
          OutlinedButton(
            onPressed: _selected.isEmpty
                ? null
                : () => _batchAction('unarchive', visible, visibleDemos),
            child: const Text('恢复所选封存'),
          ),
          OutlinedButton(
            onPressed: _selected.isEmpty
                ? null
                : () => _batchAction('trash', visible, visibleDemos),
            child: const Text('移入回收箱'),
          ),
        ],
      ],
    ),
  );
}

class _PersonalStory {
  _PersonalStory({
    this.pinned = false,
    this.displayName = '',
    this.note = '',
    this.group = '',
    this.archived = false,
    this.trashedAt,
  });

  bool pinned;
  String displayName;
  String note;
  String group;
  bool archived;
  int? trashedAt;

  factory _PersonalStory.fromJson(Map value) => _PersonalStory(
    pinned: value['pinned'] == true,
    displayName: value['display_name'] is String
        ? value['display_name'] as String
        : '',
    note: value['note'] is String ? value['note'] as String : '',
    group: value['group'] is String ? value['group'] as String : '',
    archived: value['archived'] == true,
    trashedAt: value['trashed_at'] is int ? value['trashed_at'] as int : null,
  );

  _PersonalStory copy() => _PersonalStory(
    pinned: pinned,
    displayName: displayName,
    note: note,
    group: group,
    archived: archived,
    trashedAt: trashedAt,
  );

  Json toJson() => {
    'pinned': pinned,
    'display_name': displayName,
    'note': note,
    'group': group,
    'archived': archived,
    'trashed_at': trashedAt,
  };
}

class _StoryStatus {
  const _StoryStatus({required this.ended, required this.firstPageAt});

  final bool ended;
  final DateTime? firstPageAt;
}

class _EditResult {
  const _EditResult(this.title, this.group, this.note);

  final String title;
  final String group;
  final String note;
}

class _LibraryEditDialog extends StatefulWidget {
  const _LibraryEditDialog({
    required this.title,
    required this.group,
    required this.note,
  });

  final String title;
  final String group;
  final String note;

  @override
  State<_LibraryEditDialog> createState() => _LibraryEditDialogState();
}

class _LibraryEditDialogState extends State<_LibraryEditDialog> {
  late final TextEditingController title;
  late final TextEditingController group;
  late final TextEditingController note;

  @override
  void initState() {
    super.initState();
    title = TextEditingController(text: widget.title);
    group = TextEditingController(text: widget.group);
    note = TextEditingController(text: widget.note);
  }

  @override
  void dispose() {
    title.dispose();
    group.dispose();
    note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('整理这段经历'),
    content: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('显示名、备注和分组仅保存在这个本机工作区；正式故事标题与正文不改动。'),
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('portal-library-edit-name'),
              controller: title,
              maxLength: 200,
              decoration: const InputDecoration(labelText: '显示名'),
            ),
            TextField(
              controller: group,
              maxLength: 200,
              decoration: const InputDecoration(labelText: '分组（可留空）'),
            ),
            TextField(
              controller: note,
              maxLength: 8000,
              maxLines: 4,
              decoration: const InputDecoration(labelText: '私人备注'),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(
        onPressed: () {
          if (title.text.trim().isEmpty) return;
          Navigator.pop(
            context,
            _EditResult(title.text.trim(), group.text.trim(), note.text),
          );
        },
        child: const Text('保存'),
      ),
    ],
  );
}
