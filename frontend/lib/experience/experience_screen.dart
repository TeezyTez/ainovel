/// 正式阅读/自由参与入口。资料只读取；建议只填草稿，不代表执行。
library;

import 'dart:async';

import '../portal/portal_icon.dart';

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'experience_controller.dart';
import 'demo_world_catalog.dart';
import 'experience_models.dart';
import 'experience_journal.dart';
import 'experience_edit_dialog.dart';
import 'experience_failure_copy.dart';
import 'reader_export.dart';
import 'reader_evidence_panel.dart';
import 'reader_artifact_surface.dart';
import 'reader_context_projection.dart';
import 'reader_context_query.dart';
import 'reader_rich_request.dart';
import 'reader_input_command.dart';
import 'reader_gameplay_receipt.dart';
import 'reader_historical_interaction.dart';
import 'reader_projection.dart';
import 'reader_information_sheet.dart';
import 'reader_story_waiting.dart';
import 'reader_local_state.dart';
import 'reader_panels.dart';
import 'reader_assistance_panel.dart';
import 'reader_artifact_repository.dart';
import 'reader_prepared_workbench.dart';
import 'reader_prose_mentions.dart';
import '../portal/portal_service_client.dart';
import '../portal/portal_preferences.dart';
part 'reader_tools.dart';
part 'reader_branches.dart';
part 'reader_context.dart';
part 'reader_comparison.dart';

bool experienceCanSubmit(TextEditingValue value) =>
    !value.composing.isValid || value.composing.isCollapsed;

class ExperienceScreen extends StatefulWidget {
  const ExperienceScreen({
    super.key,
    required this.controller,
    required this.onPreferences,
    this.onPortalHome,
    this.onPortalDiscover,
    this.onPortalShelf,
    this.preferences,
    this.authorWorld,
    this.onRewriteWorld,
    this.onAssist,
    this.onCancelAssist,
    this.localDemo = false,
    this.localReadOnly = false,
    this.generativeUiEnabled = true,
    this.onSuggestionSelected,
    this.artifactClient,
  });
  final ExperienceController controller;
  final VoidCallback onPreferences;
  final VoidCallback? onPortalHome;
  final VoidCallback? onPortalDiscover;
  final VoidCallback? onPortalShelf;
  final PortalPreferences? preferences;
  final Json? authorWorld;
  final VoidCallback? onRewriteWorld;
  final Future<Json> Function(String id, Json data)? onAssist;
  final VoidCallback? onCancelAssist;
  final bool localDemo, localReadOnly, generativeUiEnabled;
  final PortalServiceClient Function()? artifactClient;
  final Future<void> Function(String)? onSuggestionSelected;
  @override
  State<ExperienceScreen> createState() => _ExperienceScreenState();
}

class _ExperienceScreenState extends State<ExperienceScreen> {
  final _input = TextEditingController();
  final _focus = FocusNode(debugLabel: '经历自由输入');
  final _scroll = ScrollController();
  final Map<int, GlobalKey> _pages = {};
  String? _readerScope;
  ReaderArtifactRepository? _artifactRepository;
  String? _artifactScope;
  bool _artifactModal = false;
  String _shelfQuery = '';
  bool _syncing = false, _restoringPosition = false;
  int _portalInfoTab = 0;
  bool _composerExpanded = false;
  late final ReaderLocalState _personal;
  late final ReaderLocalState _checkpoints;
  late final PortalPreferences _appearance;
  String _selection = '';
  int _selectionRevision = 0;
  String? _reuseDraft;
  Timer? _restTimer;
  int _lastRevision = 0;
  bool _newContent = false;
  ExperienceController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    _personal = ReaderLocalState(c.journal)..addListener(_readerChanged);
    _checkpoints = ReaderLocalState(c.journal)..addListener(_readerChanged);
    _appearance =
        widget.preferences ??
        PortalPreferences(
          journal: c.journal,
          backendUrl: c.session.backendUrl,
          workspaceId: c.session.workspaceId,
        );
    _appearance.addListener(_readerChanged);
    if (widget.preferences == null) unawaited(_appearance.hydrate());
    _restTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      if (mounted && _appearance.restReminder) _toast('已经阅读半小时，休息一下眼睛吧。');
    });
    c.addListener(_changed);
    _input.addListener(_edited);
    _scroll.addListener(_scrolled);
    _changed();
  }

  void _readerChanged() {
    if (mounted) setState(() {});
  }

  void _mutate(VoidCallback action) {
    if (mounted) setState(action);
  }

  void _changed() {
    if (!mounted) return;
    if (_input.text != c.draft) {
      _syncing = true;
      _input.value = TextEditingValue(
        text: c.draft,
        selection: TextSelection.collapsed(offset: c.draft.length),
      );
      _syncing = false;
    }
    if (!c.loading && c.scope != _readerScope) {
      _readerScope = c.scope;
      _selection = '';
      _lastRevision = c.current?.revision ?? 0;
      _newContent = false;
      unawaited(_personal.open(c.scope));
      _composerExpanded = false;
      _pages.clear();
      if (c.current == null) _shelfQuery = '';
      _restoringPosition = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients) {
          _scroll.jumpTo(c.offset.clamp(0, _scroll.position.maxScrollExtent));
        }
        _restoringPosition = false;
      });
    }
    final momentsScope = experienceScope(
      c.session.backendUrl,
      c.session.workspaceId,
      c.current?.id ?? 'seed',
      'named-checkpoints',
    );
    if (!c.loading && _checkpoints.scope != momentsScope)
      unawaited(_checkpoints.open(momentsScope));
    final revision = c.current?.revision ?? 0;
    if (revision > _lastRevision &&
        _lastRevision > 0 &&
        _scroll.hasClients &&
        _scroll.position.extentAfter > 100)
      _newContent = true;
    _lastRevision = revision;
    _syncPreparedArtifact();
    setState(() {});
  }

  void _edited() {
    if (!_syncing) unawaited(c.saveDraft(_input.text));
  }

  void _scrolled() {
    if (_restoringPosition || !_scroll.hasClients) return;
    // Record synchronously in memory. Serialized durable write cannot overwrite request/draft.
    unawaited(c.saveReading(position: _scroll.offset));
  }

  Future<void> _send({String? mode}) async {
    if (widget.localReadOnly) return;
    if (mode == null &&
        experienceCanSubmit(_input.value) &&
        await _handleInputCommand())
      return;
    final routingRepository = !widget.localDemo ? _artifactRepository : null;
    final rich = readerRichRequest(
      c.draft,
      hasArtifact: routingRepository?.artifact?.hasPresentation == true,
    );
    final hasCurrentInterface =
        widget.generativeUiEnabled &&
        routingRepository?.matchesCurrentStory == true &&
        routingRepository?.displayCurrent == true &&
        routingRepository?.artifact?.hasPresentation == true;
    final requiresRouting =
        (mode ?? c.mode) == 'act' && (rich != null || hasCurrentInterface);
    if (routingRepository?.blocksStoryInput == true ||
        requiresRouting &&
            (routingRepository?.busy == true ||
                routingRepository?.pending != null)) {
      _toast('正在确认上一项界面或输入请求，草稿已保留。');
      return;
    }
    // Optional background presentation work must not hold the story composer.
    // Keep its durable request so an unknown result remains recoverable.
    if (routingRepository?.pending != null) routingRepository!.cancel();
    String? inputOperationId;
    Json? routedAction;

    if (widget.onPortalHome != null &&
        c.current != null &&
        mode != 'read' &&
        experienceCanSubmit(_input.value)) {
      final query = readerContextQuery(c.draft);
      if (query != null) {
        final queryScope = c.scope;
        await c.saveDraft('');
        if (mounted && c.scope == queryScope) await _contextPanel(query);
        return;
      }
    }
    if (_branchIsArchived) {
      _toast('这条分支已封存，请先在分支面板恢复。');
      return;
    }
    if ((mode ?? c.mode) == 'act' &&
        c.draft.trim().isNotEmpty &&
        !widget.localDemo &&
        widget.artifactClient != null &&
        c.current != null &&
        (rich != null || hasCurrentInterface) &&
        experienceCanSubmit(_input.value)) {
      if (!widget.generativeUiEnabled && rich != null) {
        await _prepareFromInput(rich);
        return;
      }
      final result = await _routeReaderInput(rich ?? c.draft);
      if (result == null) return;
      inputOperationId = result['operation_id'] as String;
      routedAction = result;
      final decision = object(result['decision']);
      if (decision['kind'] == 'execute') {
        final plan = object(decision['execute']);
        await c.executeArtifact(plan['artifact_id'] as String, {
          for (final key in [
            'revision_id',
            'expected_head',
            'definition_digest',
            'kind',
            'reference',
            'params',
          ])
            key: plan[key],
        }, requestId: inputOperationId);
        if (c.attempt?['request_id'] == inputOperationId) {
          await routingRepository!.consumeInput(
            'action',
            result['request_id'] as String,
          );
          final ui = routingRepository.inputDecisions['ui'];
          if (ui != null)
            await routingRepository.consumeInput(
              'ui',
              ui['request_id'] as String,
            );
          if (c.draft == result['draft']) await c.saveDraft('');
        }
        return;
      }
    }
    if (mode == 'read' || experienceCanSubmit(_input.value)) {
      final scope = c.scope;
      final referenceSnapshot = jsonEncode(_personal.references);
      final selectionSnapshot = jsonEncode(
        _personal.values['object_selection'],
      );
      if (mode != 'read' && c.current != null) {
        try {
          final selected = readerSelectedObjects(
            _personal.values['object_selection'],
            c.current!,
          );
          if (selected.isNotEmpty) {
            final refs =
                '这次表达关联的已知资料（仅为引用，不代表已经行动）：\n' +
                selected
                    .map(
                      (o) =>
                          '${o['name']} · 第 ${o['sourceVersion']} 页：${o['summary']}',
                    )
                    .join('\n');
            if (!c.draft.contains(refs))
              await c.saveDraft('${c.draft}\n\n$refs');
          }
        } on FormatException catch (error) {
          _toast(error.message);
          return;
        }
      }
      if (mode != 'read' && _personal.references.isNotEmpty) {
        final refs = _personal.references
            .map((r) => '第 ${r['revision']} 页引用：${r['quote']}')
            .join('\n');
        if (!c.draft.contains(refs)) await c.saveDraft('${c.draft}\n\n$refs');
      }
      if (scope != c.scope || !mounted) return;
      await c.send(explicitMode: mode, requestId: inputOperationId);
      if (routedAction != null &&
          c.attempt?['request_id'] == inputOperationId) {
        await routingRepository!.consumeInput(
          'action',
          routedAction['request_id'] as String,
        );
        final ui = routingRepository.inputDecisions['ui'];
        if (ui != null)
          await routingRepository.consumeInput(
            'ui',
            ui['request_id'] as String,
          );
      }
      if (scope == c.scope && mode != 'read' && c.draft.isEmpty)
        await _personal.update({
          if (jsonEncode(_personal.references) == referenceSnapshot)
            'references': [],
          if (jsonEncode(_personal.values['object_selection']) ==
              selectionSnapshot)
            'object_selection': null,
        });
    }
  }

  void _toggleComposer() {
    setState(() => _composerExpanded = !_composerExpanded);
    if (!_composerExpanded) {
      _focus.unfocus();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _composerExpanded) _focus.requestFocus();
      });
    }
  }

  @override
  void dispose() {
    _restTimer?.cancel();
    _artifactRepository?.removeListener(_readerChanged);
    _artifactRepository?.dispose();
    _personal.removeListener(_readerChanged);
    _personal.dispose();
    _checkpoints.dispose();
    _appearance.removeListener(_readerChanged);
    if (widget.preferences == null) _appearance.dispose();
    c.removeListener(_changed);
    _input.removeListener(_edited);
    _scroll.removeListener(_scrolled);
    _input.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _sheet(Widget child) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .8,
        child: child,
      ),
    );
  }

  Future<void> _information() async {
    final view = c.current;
    if (view == null) return;
    if (widget.onPortalHome == null) {
      await _sheet(
        ReaderInformationSheet(
          allowEdit: !widget.localReadOnly,
          information: view.information,
          searchEnabled: false,
          onEdit: (item) {
            Navigator.pop(context);
            _fork(view.revision, fact: item);
          },
        ),
      );
      return;
    }
    await _sheet(
      ReaderInformationBrowser(
        allowSubmission: !widget.localReadOnly,
        information: view.information,
        initialSelected:
            ((_personal.values['object_selection'] as Map?)?['baseVersion'] ==
                view.revision
            ? ((_personal.values['object_selection'] as Map?)?['objectIds']
                          as List? ??
                      [])
                  .cast<String>()
            : <String>[]),
        onSelection: (ids) => _selectContext(view, ids),
        onContext: () {
          Navigator.pop(context);
          _contextPanel({'kind': 'overview'});
        },
        onInspect: _object,
        onDraft: (items) {
          Navigator.pop(context);
          _draftText('关于' + items.map((i) => i.name).join('、') + '，我想');
        },
        onEdit: (item) {
          Navigator.pop(context);
          _fork(view.revision, fact: item);
        },
      ),
    );
  }

  Future<void> _fork(int revision, {KnownInformation? fact}) async {
    final owner = c.owner, scope = c.scope;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => ExperienceEditDialog(
        title: fact == null ? '另开一条经历' : '显式编辑设定',
        description: '从当前分支第 $revision 页建立新分支。原分支及已读文字保留，不会重写。修正只影响新分支之后的内容。',
        firstLabel: '分支名称',
        first: fact == null ? '从第 $revision 页重新选择' : '设定修正',
        secondLabel: fact == null ? null : '${fact.name} 的新设定',
        second: fact?.text ?? '',
        confirmLabel: '建立新分支',
      ),
    );
    if (result != null &&
        mounted &&
        owner == c.owner &&
        scope == c.scope &&
        (fact == null || result['second']!.trim().isNotEmpty)) {
      await c.fork(
        revision,
        result['first']!,
        fact: fact,
        text: result['second'],
      );
    }
  }

  Future<void> _copyCurrentBranchMarkdown(ExperienceView view) async {
    final markdown = StringBuffer('# ${view.title}\n\n');
    for (final page in view.pages) {
      markdown.writeln('## 第 ${page.revision} 页 · ${page.storyTime}');
      markdown.writeln();
      markdown.writeln(page.text);
      markdown.writeln();
    }
    await Clipboard.setData(ClipboardData(text: markdown.toString()));
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('当前分支的正式正文已复制为 Markdown')));
    }
  }

  Future<void> _history() => _readerHistory();

  Widget _status() {
    final op = c.operation;
    // Keep one stable scene during both generation and its background polls.
    // Only published prose and the submitted action can influence the artwork.
    if (c.unknown && c.busy || !c.unknown && op?.running == true) {
      final body = c.attempt?['body'];
      final input = body is Map ? body['input'] : null;
      final pages = c.current?.pages;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: ReaderStoryWaiting(
          input: input is String ? input : '',
          publishedText: pages != null && pages.isNotEmpty
              ? pages.last.text
              : '',
          showStop: c.current != null,
          onStop: c.busy ? null : () => unawaited(c.cancel()),
        ),
      );
    }
    if (!c.unknown && op?.status == 'committed') return const SizedBox.shrink();
    String? text;
    if (c.unknown) {
      text = '连接暂时中断，你的输入已保留。';
    } else if (op != null) {
      text = const {
        'cancelled': '已停止，输入已保留。',
        'failed': '这次未能续写，输入已保留。',
        'interrupted': '这次续写中断了，输入已保留。',
      }[op.status];
      if (op.errorCode == 'model_unavailable') {
        text = '模型暂不可用，请稍后再试。';
      }
      final recall = experienceRecallFailure(op.errorCode);
      if (op.status == 'failed' && recall != null) {
        text = '$recall。输入已保留，可稍后再试。';
      }
    }
    if (text == null && c.attempt == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            Text(text ?? '输入已保留。'),
            if (c.unknown)
              TextButton(
                onPressed: c.busy ? null : c.recover,
                child: const Text('重新连接'),
              ),
            if (c.current != null && c.unknown)
              IconButton(
                onPressed: c.busy ? null : c.cancel,
                tooltip: '停止生成',
                icon: const Icon(Icons.stop_rounded, size: 18),
              ),
            if (c.notReceived)
              TextButton(
                onPressed: c.busy ? null : c.resendSameRequest,
                child: const Text('重试'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final view = c.current;
    final theme = Theme.of(context);
    if (widget.onPortalHome != null && view != null) {
      return _portalReader(context, view);
    }
    return Scaffold(
      appBar: AppBar(
        leading: widget.onPortalHome == null
            ? null
            : IconButton(
                tooltip: '返回首页',
                onPressed: widget.onPortalHome,
                icon: const PortalIcon('back'),
              ),
        title: Text(view?.title ?? 'elselife · 创造世界'),
        actions: [
          if (widget.onPortalDiscover != null)
            IconButton(
              tooltip: '发现世界',
              onPressed: widget.onPortalDiscover,
              icon: const PortalIcon('compass'),
            ),
          if (widget.onPortalShelf != null)
            IconButton(
              tooltip: '我的世界',
              onPressed: widget.onPortalShelf,
              icon: const PortalIcon('book'),
            ),
          IconButton(
            tooltip: '内容偏好与外观',
            onPressed: widget.onPreferences,
            icon: const PortalIcon('typography'),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 880),
            child: LayoutBuilder(
              builder: (context, available) => Column(
                children: [
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: available.maxHeight * .24,
                    ),
                    child: SingleChildScrollView(
                      primary: false,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        child: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            TextButton.icon(
                              onPressed: c.newSeed,
                              icon: const PortalIcon('book'),
                              label: const Text('经历书架 / 新世界'),
                            ),
                            if (view != null) ...[
                              TextButton.icon(
                                onPressed: _information,
                                icon: const Icon(Icons.info_outline),
                                label: const Text('已知资料'),
                              ),
                              TextButton.icon(
                                onPressed: _history,
                                icon: const Icon(Icons.alt_route),
                                label: const Text('分支与历史'),
                              ),
                              IconButton(
                                tooltip: '缩小阅读字号',
                                onPressed: () =>
                                    c.saveReading(size: c.fontSize - 1),
                                icon: const Icon(Icons.text_decrease),
                              ),
                              Text('${c.fontSize.round()}'),
                              IconButton(
                                tooltip: '增大阅读字号',
                                onPressed: () =>
                                    c.saveReading(size: c.fontSize + 1),
                                icon: const Icon(Icons.text_increase),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (c.error != null || c.storageError != null)
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: available.maxHeight * .20,
                      ),
                      child: SingleChildScrollView(
                        primary: false,
                        child: Material(
                          color: theme.colorScheme.errorContainer,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Semantics(
                                    liveRegion: true,
                                    child: Text(c.storageError ?? c.error!),
                                  ),
                                ),
                                TextButton(
                                  onPressed: () => c.storageError == null
                                      ? c.recover()
                                      : c.retryLocalStorage(),
                                  child: const Text('重试'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  Expanded(
                    child: c.loading
                        ? const Center(child: Text('正在读取保存的经历与草稿…'))
                        : Scrollbar(
                            controller: _scroll,
                            child: SingleChildScrollView(
                              controller: _scroll,
                              padding: const EdgeInsets.fromLTRB(
                                24,
                                16,
                                24,
                                48,
                              ),
                              child: SelectionArea(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: view == null
                                      ? [
                                          Text(
                                            '世界之外，另有人生。',
                                            style:
                                                theme.textTheme.headlineLarge,
                                          ),
                                          const SizedBox(height: 12),
                                          const Text(
                                            '写一句想进入的世界。无需百科或角色表；你可以安静阅读，也可以随时行动、提问，或改变方向。',
                                          ),
                                          const SizedBox(height: 16),
                                          const Text(
                                            '本地工作区 · 草稿保存在本机，正文由服务端真实生成。',
                                          ),
                                          const SizedBox(height: 24),
                                          DemoWorldCatalog(
                                            onSeedSelected: (seed) {
                                              _input.text = seed;
                                              _focus.requestFocus();
                                            },
                                          ),
                                          _status(),
                                          const SizedBox(height: 32),
                                          if (c.workspaceAvailable) ...[
                                            Row(
                                              children: [
                                                Text(
                                                  '你的经历书架',
                                                  style: theme
                                                      .textTheme
                                                      .titleLarge,
                                                ),
                                                IconButton(
                                                  tooltip: '刷新书架',
                                                  onPressed: c.refreshShelf,
                                                  icon: const Icon(
                                                    Icons.refresh,
                                                  ),
                                                ),
                                              ],
                                            ),
                                            if (c.shelf.isNotEmpty) ...[
                                              const SizedBox(height: 8),
                                              TextField(
                                                key: const ValueKey(
                                                  'experience-shelf-search',
                                                ),
                                                onChanged: (value) =>
                                                    setState(() {
                                                      _shelfQuery = value
                                                          .trim()
                                                          .toLowerCase();
                                                    }),
                                                decoration:
                                                    const InputDecoration(
                                                      labelText: '搜索我的经历',
                                                      prefixIcon: PortalIcon(
                                                        'search',
                                                      ),
                                                    ),
                                              ),
                                            ],
                                            if (c.shelf.isEmpty)
                                              const Text(
                                                '还没有经历。可以从一句话开始；读取失败会单独提示，不制造示例。',
                                              ),
                                            if (c.shelf.isNotEmpty &&
                                                !c.shelf.any(
                                                  (item) =>
                                                      item.title
                                                          .toLowerCase()
                                                          .contains(
                                                            _shelfQuery,
                                                          ) ||
                                                      item.seed
                                                          .toLowerCase()
                                                          .contains(
                                                            _shelfQuery,
                                                          ),
                                                ))
                                              const Padding(
                                                padding: EdgeInsets.symmetric(
                                                  vertical: 16,
                                                ),
                                                child: Text('没有匹配的经历。'),
                                              ),
                                            for (final item in c.shelf.where(
                                              (item) =>
                                                  item.title
                                                      .toLowerCase()
                                                      .contains(_shelfQuery) ||
                                                  item.seed
                                                      .toLowerCase()
                                                      .contains(_shelfQuery),
                                            ))
                                              ListTile(
                                                contentPadding: EdgeInsets.zero,
                                                title: Text(item.title),
                                                subtitle: Text(
                                                  item.seed,
                                                  maxLines: 3,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                onTap: () => c.open(
                                                  item.id,
                                                  branch: item.activeBranchId,
                                                ),
                                              ),
                                          ],
                                        ]
                                      : [
                                          Text(
                                            view.title,
                                            style:
                                                theme.textTheme.headlineMedium,
                                          ),
                                          Text(
                                            view.branches
                                                    .where(
                                                      (b) =>
                                                          b.id == view.branchId,
                                                    )
                                                    .map((b) => b.name)
                                                    .firstOrNull ??
                                                '当前分支',
                                          ),
                                          if (view.pages.isEmpty)
                                            const Padding(
                                              padding: EdgeInsets.symmetric(
                                                vertical: 32,
                                              ),
                                              child: Text('故事从这里开始。'),
                                            ),
                                          for (final page in view.pages)
                                            Padding(
                                              key: _pages.putIfAbsent(
                                                page.revision,
                                                GlobalKey.new,
                                              ),
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    vertical: 24,
                                                  ),
                                              child: Column(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  Semantics(
                                                    header: true,
                                                    child: Text(
                                                      '第 ${page.revision} 页${page.mode == 'ask' ? ' · 跳出角色的询问' : ''} · ${page.storyTime}',
                                                      style: theme
                                                          .textTheme
                                                          .labelLarge,
                                                    ),
                                                  ),
                                                  const SizedBox(height: 14),
                                                  Text(
                                                    page.text,
                                                    style: TextStyle(
                                                      fontSize: c.fontSize,
                                                      height: 1.85,
                                                    ),
                                                  ),
                                                  if (page.outcome == 'ending')
                                                    const Padding(
                                                      padding: EdgeInsets.only(
                                                        top: 16,
                                                      ),
                                                      child: Text(
                                                        '这一段经历自然结束了。可以停在这里，也可重新选择。',
                                                      ),
                                                    ),
                                                  if (page.revision ==
                                                          view.revision &&
                                                      page
                                                          .suggestions
                                                          .isNotEmpty)
                                                    Padding(
                                                      padding:
                                                          const EdgeInsets.only(
                                                            top: 16,
                                                          ),
                                                      child: Wrap(
                                                        spacing: 8,
                                                        runSpacing: 8,
                                                        children: [
                                                          for (final suggestion
                                                              in page
                                                                  .suggestions)
                                                            ActionChip(
                                                              label: Text(
                                                                suggestion,
                                                              ),
                                                              tooltip:
                                                                  '只填入草稿；你也可以写任何其他表达',
                                                              onPressed: () {
                                                                _input.text =
                                                                    suggestion;
                                                                _focus
                                                                    .requestFocus();
                                                              },
                                                            ),
                                                        ],
                                                      ),
                                                    ),
                                                ],
                                              ),
                                            ),
                                        ],
                                ),
                              ),
                            ),
                          ),
                  ),
                  ConstrainedBox(
                    key: const ValueKey('experience-composer'),
                    constraints: BoxConstraints(
                      maxHeight: available.maxHeight * .52,
                    ),
                    child: SingleChildScrollView(
                      primary: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (view != null) _status(),
                            if (view != null)
                              Wrap(
                                spacing: 8,
                                children: [
                                  ChoiceChip(
                                    label: const Text('自由行动'),
                                    selected: c.mode == 'act',
                                    onSelected: (_) => c.saveDraft(
                                      _input.text,
                                      selectedMode: 'act',
                                    ),
                                  ),
                                  ChoiceChip(
                                    label: const Text('跳出角色询问'),
                                    selected: c.mode == 'ask',
                                    onSelected: (_) => c.saveDraft(
                                      _input.text,
                                      selectedMode: 'ask',
                                    ),
                                  ),
                                  TextButton(
                                    onPressed:
                                        c.blocked || c.storageError != null
                                        ? null
                                        : () => _send(mode: 'read'),
                                    child: const Text('继续阅读 · 无需选择'),
                                  ),
                                ],
                              ),
                            Focus(
                              onKeyEvent: (node, event) {
                                if (event is KeyDownEvent &&
                                    event.logicalKey ==
                                        LogicalKeyboardKey.enter &&
                                    HardwareKeyboard
                                        .instance
                                        .isControlPressed &&
                                    experienceCanSubmit(_input.value)) {
                                  _send();
                                  return KeyEventResult.handled;
                                }
                                return KeyEventResult.ignored;
                              },
                              child: TextField(
                                key: const ValueKey('experience-input'),
                                controller: _input,
                                focusNode: _focus,
                                minLines: 2,
                                maxLines: 4,
                                textInputAction: TextInputAction.newline,
                                decoration: InputDecoration(
                                  labelText: view == null
                                      ? '想进入怎样的世界？'
                                      : c.mode == 'ask'
                                      ? '询问处境或资料 · 不推进行动与故事时间'
                                      : '我想怎么做？愿望不保证在世界中实现',
                                  border: const OutlineInputBorder(),
                                ),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    'Enter 换行 · Ctrl+Enter 提交 · 草稿在本机保护',
                                    style: theme.textTheme.labelSmall,
                                  ),
                                ),
                                FilledButton(
                                  onPressed:
                                      c.blocked ||
                                          c.loading ||
                                          c.storageError != null
                                      ? null
                                      : _send,
                                  child: Text(
                                    view == null
                                        ? '进入世界'
                                        : c.mode == 'ask'
                                        ? '询问'
                                        : '参与',
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _portalReader(BuildContext context, ExperienceView view) {
    final theme = Theme.of(context);
    final desktop =
        MediaQuery.sizeOf(context).width >= 1050 && !_personal.focus;
    final compact = MediaQuery.sizeOf(context).width < 600;
    final night = _appearance.readingTheme == 'night';
    final ink = night ? const Color(0xffdedbd4) : const Color(0xff33352f);
    final paper = switch (_appearance.readingTheme) {
      'night' => const Color(0xff202321),
      'white' => const Color(0xfffafafa),
      'sage' => const Color(0xffedf2e7),
      _ => const Color(0xfff7f3e9),
    };
    final muted = theme.colorScheme.onSurfaceVariant;
    final line = theme.colorScheme.outlineVariant;
    final orientationPage = _visiblePages(view).lastOrNull;
    final orientationGameplay = orientationPage?.revision == view.revision
        ? view.publicGameplay
        : orientationPage?.reader?.gameplay;
    final orientation = <String>[
      if (orientationGameplay?.location.isNotEmpty == true)
        orientationGameplay!.location,
      if (_appearance.showTime)
        orientationPage?.reader?.storyTime ?? orientationPage?.storyTime ?? '',
    ].where((value) => value.isNotEmpty).join(' · ');
    final latestSuggestions = view.pages.isEmpty
        ? <String>[]
        : view.pages.last.suggestions;
    return Scaffold(
      backgroundColor: paper,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              height: 64,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                border: Border(bottom: BorderSide(color: line)),
              ),
              child: Row(
                children: [
                  IconButton(
                    tooltip: '返回我的世界',
                    onPressed: widget.onPortalShelf,
                    icon: const PortalIcon('back', size: 19),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          view.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: ink,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          orientation,
                          maxLines: 1,
                          style: TextStyle(color: muted, fontSize: 10),
                        ),
                      ],
                    ),
                  ),
                  if (desktop)
                    Text(
                      c.storageError == null ? '已保存' : '保存失败',
                      style: TextStyle(color: muted, fontSize: 11),
                    ),
                  IconButton(
                    tooltip: '已知资料',
                    onPressed: _information,
                    icon: const PortalIcon('layers', size: 19),
                  ),
                  IconButton(
                    tooltip: _personal.focus ? '退出专注阅读' : '专注阅读',
                    onPressed: () =>
                        _personal.update({'focus': !_personal.focus}),
                    icon: Icon(
                      _personal.focus
                          ? Icons.fullscreen_exit
                          : Icons.fullscreen,
                      size: 19,
                    ),
                  ),
                  IconButton(
                    tooltip: '分支与历史',
                    onPressed: _history,
                    icon: const PortalIcon('history', size: 19),
                  ),
                  if (!compact)
                    IconButton(
                      tooltip: '缩小阅读字号',
                      onPressed: () => _appearance.setValue(
                        'fontSize',
                        _appearance.fontSize - 1,
                      ),
                      icon: const Icon(Icons.text_decrease, size: 19),
                    ),
                  if (!compact)
                    Text(
                      '${_appearance.fontSize.round()}',
                      style: TextStyle(color: muted, fontSize: 11),
                    ),
                  if (!compact)
                    IconButton(
                      tooltip: '增大阅读字号',
                      onPressed: () => _appearance.setValue(
                        'fontSize',
                        _appearance.fontSize + 1,
                      ),
                      icon: const Icon(Icons.text_increase, size: 19),
                    ),
                  if (!compact)
                    IconButton(
                      tooltip: '显示设置',
                      onPressed: _readerSettings,
                      icon: const PortalIcon('typography', size: 19),
                    ),
                  if (compact)
                    PopupMenuButton<String>(
                      tooltip: '阅读设置',
                      icon: const PortalIcon('typography', size: 19),
                      onSelected: (value) {
                        if (value == 'smaller')
                          unawaited(
                            _appearance.setValue(
                              'fontSize',
                              _appearance.fontSize - 1,
                            ),
                          );
                        if (value == 'larger')
                          unawaited(
                            _appearance.setValue(
                              'fontSize',
                              _appearance.fontSize + 1,
                            ),
                          );
                        if (value == 'preferences') _readerSettings();
                      },
                      itemBuilder: (_) => [
                        PopupMenuItem(
                          value: 'smaller',
                          child: Text(
                            '缩小字号 · 当前 ${_appearance.fontSize.round()}',
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'larger',
                          child: Text('增大阅读字号'),
                        ),
                        const PopupMenuItem(
                          value: 'preferences',
                          child: Text('显示设置'),
                        ),
                      ],
                    ),
                ],
              ),
            ),
            if (c.error != null || c.storageError != null)
              Material(
                color: theme.colorScheme.errorContainer,
                child: ListTile(
                  title: Text(c.storageError ?? c.error!),
                  trailing: TextButton(
                    onPressed: c.storageError == null
                        ? c.recover
                        : c.retryLocalStorage,
                    child: const Text('重试'),
                  ),
                ),
              ),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(
                          child: Scrollbar(
                            controller: _scroll,
                            child: SingleChildScrollView(
                              controller: _scroll,
                              child: Center(
                                child: ConstrainedBox(
                                  constraints: BoxConstraints(
                                    maxWidth: _appearance.width + 60,
                                  ),
                                  child: Padding(
                                    padding: EdgeInsets.fromLTRB(
                                      desktop ? 54 : 25,
                                      48,
                                      desktop ? 54 : 25,
                                      80,
                                    ),
                                    child: SelectionArea(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '故事开场',
                                            style: theme.textTheme.labelSmall
                                                ?.copyWith(
                                                  letterSpacing: 2,
                                                  color:
                                                      theme.colorScheme.primary,
                                                ),
                                          ),
                                          const SizedBox(height: 14),
                                          Text(
                                            view.title,
                                            style: theme.textTheme.headlineLarge
                                                ?.copyWith(
                                                  fontSize: 36,
                                                  fontWeight: FontWeight.w400,
                                                ),
                                          ),
                                          const SizedBox(height: 24),
                                          Divider(color: line),
                                          if (view.pages.isEmpty)
                                            Padding(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    vertical: 35,
                                                  ),
                                              child: Text(
                                                '故事从这里开始。',
                                                style: TextStyle(color: muted),
                                              ),
                                            ),
                                          for (final page in _visiblePages(
                                            view,
                                          )) ...[
                                            Padding(
                                              key: _pages.putIfAbsent(
                                                page.revision,
                                                GlobalKey.new,
                                              ),
                                              padding: const EdgeInsets.only(
                                                top: 34,
                                                bottom: 25,
                                              ),
                                              child: Column(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  if (page.revision > 1) ...[
                                                    Row(
                                                      children: [
                                                        Text(
                                                          '${page.revision - 1}'
                                                              .padLeft(2, '0'),
                                                          style: TextStyle(
                                                            color: muted,
                                                            fontSize: 11,
                                                            letterSpacing: 2,
                                                          ),
                                                        ),
                                                        const SizedBox(
                                                          width: 14,
                                                        ),
                                                        Expanded(
                                                          child: Divider(
                                                            color: line,
                                                          ),
                                                        ),
                                                        const SizedBox(
                                                          width: 14,
                                                        ),
                                                        if (_appearance
                                                            .showTime)
                                                          Text(
                                                            page
                                                                    .reader
                                                                    ?.storyTime ??
                                                                page.storyTime,
                                                            style: TextStyle(
                                                              color: muted,
                                                              fontSize: 11,
                                                            ),
                                                          ),
                                                      ],
                                                    ),
                                                    const SizedBox(height: 20),
                                                    if (page.input
                                                        .trim()
                                                        .isNotEmpty)
                                                      Padding(
                                                        padding:
                                                            const EdgeInsets.only(
                                                              bottom: 22,
                                                            ),
                                                        child: Text(
                                                          page.input,
                                                          style: TextStyle(
                                                            color: muted,
                                                            fontSize: 13,
                                                            fontStyle: FontStyle
                                                                .italic,
                                                          ),
                                                        ),
                                                      ),
                                                  ],
                                                  _readerProse(page, ink),
                                                  _gameplayNotes(page),
                                                  if (page.interactionSnapshot !=
                                                          null &&
                                                      widget.artifactClient !=
                                                          null)
                                                    ReaderHistoricalInteraction(
                                                      key: ValueKey(
                                                        "history:${view.branchId}:${page.revision}:${page.interactionSnapshot!.revisionId}",
                                                      ),
                                                      snapshot: page
                                                          .interactionSnapshot!,
                                                      clientFactory: widget
                                                          .artifactClient!,
                                                      experienceId: view.id,
                                                      branchId: view.branchId,
                                                      dark:
                                                          _appearance
                                                              .readingTheme ==
                                                          "night",
                                                    ),
                                                  _pageTools(page),
                                                  if (page.gameplayReceipt !=
                                                      null)
                                                    ReaderGameplayReceiptView(
                                                      receipt:
                                                          page.gameplayReceipt!,
                                                      information:
                                                          page
                                                              .reader
                                                              ?.information ??
                                                          const [],
                                                    ),
                                                  if (page.revision ==
                                                      view.revision)
                                                    _inlinePreparedArtifact(),
                                                  if (page.revision <
                                                      view.revision)
                                                    _historicalGameplay(
                                                      page,
                                                      view,
                                                    ),
                                                  if (page.outcome == 'ending')
                                                    Padding(
                                                      padding:
                                                          const EdgeInsets.only(
                                                            top: 25,
                                                          ),
                                                      child: Text(
                                                        '这一段，告一段落。已有正文可以随时回读。',
                                                        style: TextStyle(
                                                          color: muted,
                                                        ),
                                                      ),
                                                    ),
                                                ],
                                              ),
                                            ),
                                          ],
                                          if (_appearance.readingMode ==
                                              'paged')
                                            _pagination(view),
                                          if (_personal.values['pinned_context']
                                              is Map)
                                            TextButton(
                                              onPressed: () => _contextPanel(
                                                Map<String, dynamic>.from(
                                                  _personal
                                                          .values['pinned_context']
                                                      as Map,
                                                ),
                                              ),
                                              child: const Text('查看固定资料'),
                                            ),
                                          DefaultTextStyle.merge(
                                            style: TextStyle(color: ink),
                                            child: _status(),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        if (_personal.error != null)
                          MaterialBanner(
                            content: Text(_personal.error!),
                            actions: [
                              TextButton(
                                onPressed: _personal.retry,
                                child: const Text('重试'),
                              ),
                            ],
                          ),
                        if (_newContent)
                          TextButton(
                            onPressed: () {
                              _mutate(() => _newContent = false);
                              if (view.pages.isNotEmpty)
                                _jump(view.pages.last.revision);
                            },
                            child: const Text('有新内容 ↓'),
                          ),
                        if (_selection.isNotEmpty) _selectionBar(),
                        _portalComposer(context, view, latestSuggestions),
                      ],
                    ),
                  ),
                  if (desktop)
                    Container(
                      width: 315,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        border: Border(left: BorderSide(color: line)),
                      ),
                      child: _portalDossier(context, view),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _portalComposer(
    BuildContext context,
    ExperienceView view,
    List<String> suggestions,
  ) {
    final theme = Theme.of(context);
    if (widget.localReadOnly)
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const Text('本机只读开场'),
            TextButton(onPressed: _history, child: const Text('回顾与搜索')),
            TextButton(onPressed: _readerSettings, child: const Text('显示设置')),
            PopupMenuButton<String>(
              tooltip: '故事工具',
              icon: const PortalIcon('plus'),
              onSelected: _readerTool,
              itemBuilder: (_) => [
                for (final entry in readerToolLabels.entries.where(
                  (entry) => _readOnlyToolAllowed(entry.key),
                ))
                  PopupMenuItem(value: entry.key, child: Text(entry.value)),
              ],
            ),
            TextButton(
              onPressed: widget.onPortalShelf,
              child: const Text('回到书架'),
            ),
          ],
        ),
      );
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 9, 20, 13),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 650),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Semantics(
                        expanded: _composerExpanded,
                        child: TextButton(
                          onPressed: _toggleComposer,
                          child: Text(
                            _composerExpanded
                                ? '收起行动'
                                : _input.text.trim().isEmpty
                                ? '展开行动'
                                : '展开行动 · 有草稿',
                          ),
                        ),
                      ),
                    ),
                  ),
                  PopupMenuButton<String>(
                    tooltip: '故事工具',
                    icon: const PortalIcon('plus', size: 20),
                    onSelected: _readerTool,
                    itemBuilder: (_) => [
                      for (final entry in readerToolLabels.entries.where(
                        (entry) =>
                            !widget.localDemo ||
                            !const {
                              'time',
                              'repair',
                              'polish',
                              'undoPolish',
                              'rewrite',
                              'finish',
                              'storyPreferences',
                              'artifact',
                            }.contains(entry.key),
                      ))
                        PopupMenuItem(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                    ],
                  ),
                  if (c.busy || c.operation?.running == true)
                    TextButton(onPressed: c.cancel, child: const Text('停止生成'))
                  else
                    TextButton.icon(
                      onPressed:
                          c.blocked || c.loading || c.storageError != null
                          ? null
                          : () => _send(mode: 'read'),
                      icon: const PortalIcon('book', size: 16),
                      label: const Text('继续经历'),
                    ),
                ],
              ),
              if (_personal.references.isNotEmpty) _referenceChips(),
              _contextChips(),
              Visibility(
                visible: _composerExpanded,
                maintainState: true,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (suggestions.isNotEmpty)
                      SizedBox(
                        height: 38,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: suggestions.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 8),
                          itemBuilder: (_, index) => ActionChip(
                            label: Text(suggestions[index]),
                            tooltip: '只填入草稿；你可以修改后再发送',
                            onPressed: () {
                              if (widget.onSuggestionSelected != null) {
                                widget.onSuggestionSelected!(
                                  suggestions[index],
                                );
                                return;
                              }
                              _input.text = suggestions[index];
                              _focus.requestFocus();
                            },
                          ),
                        ),
                      ),
                    Wrap(
                      spacing: 8,
                      children: [
                        ChoiceChip(
                          label: const Text('亲自行动'),
                          selected: c.mode != 'ask',
                          onSelected: (_) =>
                              c.saveDraft(_input.text, selectedMode: 'act'),
                        ),
                        ChoiceChip(
                          label: const Text('先问问'),
                          selected: c.mode == 'ask',
                          onSelected: (_) =>
                              c.saveDraft(_input.text, selectedMode: 'ask'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Focus(
                      onKeyEvent: (_, event) {
                        if (event is KeyDownEvent &&
                            event.logicalKey == LogicalKeyboardKey.enter &&
                            (_appearance.sendEnter ||
                                HardwareKeyboard.instance.isControlPressed ||
                                HardwareKeyboard.instance.isMetaPressed) &&
                            !HardwareKeyboard.instance.isShiftPressed &&
                            !HardwareKeyboard.instance.isAltPressed &&
                            experienceCanSubmit(_input.value)) {
                          _send();
                          return KeyEventResult.handled;
                        }
                        return KeyEventResult.ignored;
                      },
                      child: TextField(
                        key: const ValueKey('experience-input'),
                        controller: _input,
                        focusNode: _focus,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 8000,
                        textInputAction: TextInputAction.newline,
                        decoration: InputDecoration(
                          counterText: '',
                          hintText: c.blocked
                              ? '可以先写下接下来的想法…'
                              : c.mode == 'ask'
                              ? '先问问眼前的处境…'
                              : '你想说什么，或做些什么？',
                          suffixIcon: IconButton(
                            tooltip: '发送',
                            onPressed:
                                c.blocked ||
                                    c.storageError != null ||
                                    _input.text.trim().isEmpty
                                ? null
                                : _send,
                            icon: const PortalIcon('arrow'),
                          ),
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      c.blocked
                          ? '下一条草稿 · 当前回应完成后可发送'
                          : (_appearance.sendEnter
                                ? 'Enter 发送 · Shift + Enter 换行 · 草稿保存在本机'
                                : 'Enter 换行 · Ctrl / ⌘ + Enter 发送 · 草稿保存在本机'),
                      style: theme.textTheme.labelSmall,
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

  Widget _portalDossier(BuildContext context, ExperienceView view) {
    final theme = Theme.of(context);
    final categories = ['概览', '人物', '地点', '物品', '线索', '状态', '时间', '手记'];
    final kinds = [
      const <String>{},
      const {'person', 'character'},
      const {'location'},
      const {'item'},
      const {'clue', 'thread'},
      const {'status', 'fact', 'rule'},
      const {'event', 'agreement', 'schedule'},
      const <String>{},
    ];
    final items = _portalInfoTab == 0
        ? view.information
        : view.information
              .where((item) => kinds[_portalInfoTab].contains(item.kind))
              .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 14),
          child: Row(
            children: [
              Text('故事资料', style: theme.textTheme.titleSmall),
              const Spacer(),
              IconButton(
                onPressed: _information,
                icon: const PortalIcon('arrow-up-right', size: 16),
                tooltip: '查看全部已知资料',
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Wrap(
            spacing: 4,
            children: [
              for (var index = 0; index < categories.length; index++)
                TextButton(
                  onPressed: () {
                    if (index == 7) {
                      _notes();
                    } else {
                      setState(() => _portalInfoTab = index);
                      if (index == 2) _readerPanel('map');
                      if (index == 6) _readerPanel('time');
                    }
                  },
                  child: Text(
                    categories[index],
                    style: TextStyle(
                      fontSize: 12,
                      color: _portalInfoTab == index
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
        Divider(color: theme.colorScheme.outlineVariant),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Text('此处已知的资料', style: theme.textTheme.labelSmall),
              const SizedBox(height: 8),
              if (items.isEmpty)
                Text(
                  '尚无已知资料。新的事实会随正式经历逐步呈现。',
                  style: theme.textTheme.bodySmall,
                ),
              for (final item in items)
                InkWell(
                  onTap: () => _object(item),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: theme.textTheme.titleSmall),
                        const SizedBox(height: 4),
                        Text(
                          item.text,
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
