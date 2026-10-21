part of 'experience_screen.dart';

extension _ReaderTools on _ExperienceScreenState {
  Widget _gameplayNotes(ExperiencePage page) {
    final experience = page.reader?.gameplay?.experience;
    if (experience == null) return const SizedBox.shrink();
    final folded = objects(
      experience['folded'] ?? [],
    ).where((entry) => entry['sourceVersion'] == page.revision);
    final stop = experience['stop'];
    return Column(
      children: [
        for (final entry in folded)
          ExpansionTile(
            title: Text(entry['title'] as String? ?? '这段时间的记录'),
            children: [
              if ((entry['summary'] as String? ?? '').isNotEmpty)
                SelectableText(entry['summary'] as String),
              SelectableText(entry['quote'] as String? ?? '没有额外保存的细节。'),
            ],
          ),
        if (stop is Map &&
            stop['sourceVersion'] == page.revision &&
            stop['reason'] is String)
          ExpansionTile(
            title: const Text('此刻的提醒'),
            children: [SelectableText(stop['reason'] as String)],
          ),
      ],
    );
  }

  Widget _historicalGameplay(ExperiencePage page, ExperienceView view) {
    final gameplay = page.reader?.gameplay;
    if (gameplay?.game == null) return const SizedBox.shrink();
    return ReaderArtifactSurface(
      data: {
        'surface': 'gameplay',
        'kind': 'turn',
        'readonly': true,
        'scope': {
          'worldKey': view.id,
          'branchId': view.branchId,
          'baseVersion': page.revision,
        },
        'state': gameplay!.sourceState(
          page.revision,
          page.reader?.storyTime ?? page.storyTime,
        ),
        'turn': {
          'id': 'revision:${page.revision}',
          'input': page.input,
          'prose': page.text,
        },
        'currentVersion': view.revision,
        'dark': _appearance.readingTheme == 'night',
      },
      onMessage: (kind, value) {
        if (kind == 'gameplay-history') _history();
        if (kind == 'source') _jump(page.revision);
      },
      fallback: const SizedBox.shrink(),
    );
  }

  void _toast(String text) {
    if (mounted)
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  List<ExperiencePage> _visiblePages(ExperienceView view) {
    if (_appearance.readingMode != 'paged' || view.pages.isEmpty)
      return view.pages;
    return [view.pages[_personal.page.clamp(0, view.pages.length - 1)]];
  }

  void _jump(int revision) {
    final pages = c.current?.pages ?? [];
    final index = pages.indexWhere((p) => p.revision == revision);
    if (index < 0) return;
    // Explicit navigation replaces the old reading target. The old page can
    // legitimately leave the tree in paged mode; it is not a source mismatch.
    final scope = c.scope, epoch = ++_readingRestoreEpoch;
    _readingRevision = revision;
    if (revision == c.current?.revision) {
      _newContent = false;
    }
    _readingScrollEpoch++;
    _pendingReadingAnchor = null;
    _restoringPosition = true;
    unawaited(c.saveReading(updateAnchor: true));
    unawaited(_personal.update({'page': index}));
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || epoch != _readingRestoreEpoch) return;
      if (scope != c.scope || c.loading) {
        _restoringPosition = false;
        return;
      }
      final target = _pages[revision]?.currentContext;
      if (target != null) {
        // A durable pagination write can finish during this animation. Keep
        // its listener from restoring the intermediate viewport over an
        // explicit navigation request.
        await Scrollable.ensureVisible(
          target,
          duration: _appearance.reducedMotion
              ? Duration.zero
              : const Duration(milliseconds: 180),
        );
      }
      if (!mounted || epoch != _readingRestoreEpoch) return;
      _restoringPosition = false;
      if (scope != c.scope || c.loading) return;
      // A short page can already be visible without emitting a scroll event.
      // Save its actual viewport after layout just as a user scroll would.
      _scrolled();
      WidgetsBinding.instance.ensureVisualUpdate();
    });
  }

  Widget _pagination(ExperienceView view) {
    if (view.pages.isEmpty) return const SizedBox.shrink();
    final index = _personal.page.clamp(0, view.pages.length - 1);
    return Column(
      children: [
        Wrap(
          spacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              onPressed: index > 0
                  ? () => _jump(view.pages[index - 1].revision)
                  : null,
              child: const Text('上一页'),
            ),
            DropdownButton<int>(
              value: index,
              items: [
                for (var i = 0; i < view.pages.length; i++)
                  DropdownMenuItem(
                    value: i,
                    child: Text(i == 0 ? '故事开场' : '回合 $i'),
                  ),
              ],
              onChanged: (i) {
                if (i != null) _jump(view.pages[i].revision);
              },
            ),
            TextButton(
              onPressed: index < view.pages.length - 1
                  ? () => _jump(view.pages[index + 1].revision)
                  : null,
              child: const Text('下一页'),
            ),
          ],
        ),
        const Text('翻页只阅读已有内容，不生成新故事。', style: TextStyle(fontSize: 12)),
        if (index < view.pages.length - 1)
          TextButton(
            onPressed: () => _jump(view.pages.last.revision),
            child: const Text('正在回看较早片段 · 回到最新'),
          ),
      ],
    );
  }

  Widget _readerProse(ExperiencePage page, Color ink) {
    final gap = switch (_appearance.paragraphGap) {
      'compact' => .65,
      'wide' => 1.6,
      _ => 1.15,
    };
    final information =
        page.reader?.information ??
        (page.revision == c.current?.revision
            ? c.current!.information
            : <KnownInformation>[]);
    final runs = readerProseMentions(
      page.text,
      information: [
        for (final item in information)
          {'id': item.id, 'name': item.name, 'sourceVersion': page.revision},
      ],
      maxRevision: page.revision,
    );
    final paragraphs = [
      for (final paragraph in runs) paragraph.map((run) => run.text).join(),
    ];
    var searchFrom = 0;
    final starts = <int>[];
    for (final paragraph in paragraphs) {
      final start = page.text.indexOf(paragraph, searchFrom);
      starts.add(start);
      searchFrom = start + paragraph.length;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < paragraphs.length; i++)
          Padding(
            padding: EdgeInsets.only(
              bottom: i == paragraphs.length - 1
                  ? 0
                  : _appearance.fontSize * gap,
            ),
            child: ReaderProseParagraph(
              key: _readingTextKey(page, starts[i], paragraphs[i]),
              runs: runs[i],
              onMention: (id) {
                final item = information
                    .where((item) => item.id == id)
                    .firstOrNull;
                if (item == null) return;
                if (page.revision == c.current?.revision) {
                  _object(item);
                } else {
                  _sheet(
                    ReaderPanel(
                      title: item.name,
                      children: [
                        const Text('当时的已知记录'),
                        if (item.recordHeading != null)
                          Text(item.recordHeading!),
                        SelectableText(item.text),
                      ],
                    ),
                  );
                }
              },
              onSelectionChanged: (selection, cause) {
                final quote = selection.textInside(paragraphs[i]).trim();
                if (quote.isNotEmpty)
                  _mutate(() {
                    _selection = quote.length > 4000
                        ? quote.substring(0, 4000)
                        : quote;
                    _selectionRevision = page.revision;
                  });
              },
              style: TextStyle(
                color: ink,
                fontSize: _appearance.fontSize,
                height: _appearance.lineHeight,
                fontFamily: switch (_appearance.fontFamily) {
                  'serif' => 'NotoSerifSC',
                  'sans' => 'NotoSansSC',
                  _ => null,
                },
                fontFamilyFallback: _appearance.fontFamily == 'serif'
                    ? const ['SimSun', 'Songti SC', 'serif', 'NotoSansSC']
                    : null,
              ),
            ),
          ),
      ],
    );
  }

  Widget _pageTools(ExperiencePage page) => Align(
    alignment: Alignment.centerRight,
    child: PopupMenuButton<String>(
      tooltip: '第 ${page.revision} 页记录选项',
      icon: const PortalIcon('more', size: 18),
      onSelected: (v) {
        if (v == 'bookmark') unawaited(_annotate('bookmark', page));
        if (v == 'note') unawaited(_note(page.revision, page.text));
        if (v == 'clip') unawaited(_annotate('clip', page));
        if (v == 'fork') unawaited(_fork(page.revision));
        if (v == 'snapshot') unawaited(_snapshot(page.revision));
        if (v == 'reference') {
          unawaited(_personal.reference(page.revision, page.text));
          _expandComposer();
        }
      },
      itemBuilder: (_) => [
        const PopupMenuItem(value: 'bookmark', child: Text('加书签')),
        const PopupMenuItem(value: 'note', child: Text('私人笔记')),
        const PopupMenuItem(value: 'clip', child: Text('收藏片段')),
        if (!widget.localReadOnly)
          const PopupMenuItem(value: 'reference', child: Text('引用到草稿')),
        const PopupMenuItem(value: 'snapshot', child: Text('当时情况')),
        if (!widget.localReadOnly)
          PopupMenuItem(
            value: 'fork',
            enabled: !c.blocked,
            child: const Text('从这里分支'),
          ),
      ],
    ),
  );
  void _expandComposer() {
    _mutate(() => _composerExpanded = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  Future<void> _draftText(String text, {String mode = 'act'}) async {
    if (widget.localReadOnly) return;
    await c.saveDraft(
      c.draft.trim().isEmpty ? text : '${c.draft}\n$text',
      selectedMode: mode,
    );
    if (mounted) _expandComposer();
  }

  Widget _selectionBar() => Material(
    color: Theme.of(context).colorScheme.surfaceContainer,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            '已选 ${_selection.length} 字',
            style: const TextStyle(fontSize: 12),
          ),
          if (!widget.localReadOnly)
            TextButton(
              onPressed: () {
                unawaited(_personal.reference(_selectionRevision, _selection));
                _expandComposer();
              },
              child: const Text('引用到草稿'),
            ),
          TextButton(
            onPressed: () => _note(_selectionRevision, _selection),
            child: const Text('私人笔记'),
          ),
          TextButton(
            onPressed: () async {
              await _personal.annotate('clip', _selectionRevision, _selection);
              _toast('片段已加入私人收藏。');
            },
            child: const Text('收藏片段'),
          ),
          if (!widget.localReadOnly)
            TextButton(
              onPressed: () => _draftText(
                '关于第 $_selectionRevision 页这段：“$_selection”\n我想问：',
                mode: 'ask',
              ),
              child: const Text('问这段'),
            ),
          TextButton(
            onPressed: () =>
                _feedback(quote: _selection, revision: _selectionRevision),
            child: const Text('反馈问题'),
          ),
          IconButton(
            tooltip: '关闭选文工具',
            onPressed: () => _mutate(() => _selection = ''),
            icon: const PortalIcon('close', size: 16),
          ),
        ],
      ),
    ),
  );
  Widget _referenceChips() => Wrap(
    spacing: 6,
    children: [
      for (var i = 0; i < _personal.references.length; i++)
        InputChip(
          label: Text(
            '引用：${_personal.references[i]['quote']}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          onDeleted: () => _personal.update({
            'references': [..._personal.references]..removeAt(i),
          }),
        ),
    ],
  );
  Future<void> _annotate(String kind, ExperiencePage page) async {
    await _personal.annotate(
      kind,
      page.revision,
      page.text.length > 1500 ? page.text.substring(0, 1500) : page.text,
    );
    _toast(_personal.error ?? (kind == 'bookmark' ? '书签已保存。' : '片段已加入私人收藏。'));
  }

  Future<String?> _textDialog(
    String title,
    String label, {
    String quote = '',
    String initial = '',
  }) async {
    final input = TextEditingController(text: initial);
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (quote.isNotEmpty)
                  Text(quote, maxLines: 6, overflow: TextOverflow.ellipsis),
                TextField(
                  controller: input,
                  autofocus: true,
                  minLines: 3,
                  maxLines: 7,
                  maxLength: 4000,
                  decoration: InputDecoration(labelText: label),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              if (input.text.trim().isNotEmpty)
                Navigator.pop(ctx, input.text.trim());
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
    // The dialog route may animate out after its future resolves.
    WidgetsBinding.instance.addPostFrameCallback((_) => input.dispose());
    return value;
  }

  Future<void> _note(int revision, String quote, {String objectId = ''}) async {
    final scope = c.scope;
    final text = await _textDialog('写一条私人笔记', '只给自己看的笔记', quote: quote);
    if (text != null && scope == c.scope && mounted) {
      await _personal.annotate(
        'note',
        revision,
        quote,
        text: text,
        objectId: objectId,
      );
      _toast(_personal.error ?? '私人笔记已保存，不改变故事。');
    }
  }

  Future<void> _notes({bool journal = false}) => _sheet(
    AnimatedBuilder(
      animation: _personal,
      builder: (context, _) {
        final entries = _personal.entries.reversed.toList();
        return ReaderPanel(
          title: journal ? '手记与打算' : '书签、收藏与私人笔记',
          children: [
            const Text('只保存在你的这条分支里，不发送给人物或生成模型。'),
            if (journal) ...[
              TextButton(
                onPressed: () => _note(
                  c.current?.revision ?? 0,
                  '',
                  objectId: 'personal-plan',
                ),
                child: const Text('写一个自己的打算'),
              ),
              if (_personal.followed.isNotEmpty) const Text('我关心的事'),
              for (final item in c.current?.information ?? <KnownInformation>[])
                if (_personal.followed.contains(item.id))
                  ListTile(
                    title: Text(item.name),
                    subtitle: Text(item.displaySummary),
                    onTap: () => _object(item),
                  ),
            ],
            if (entries.isEmpty)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Text('还没有记录。选中正文，可以引用、收藏或写一条私人笔记。'),
              ),
            for (final entry in entries)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${const {'bookmark': '书签', 'clip': '收藏片段', 'note': '私人笔记', 'feedback': '本机反馈'}[entry['kind']] ?? '记录'} · 第 ${entry['revision']} 页',
                      ),
                      if ('${entry['quote']}'.isNotEmpty)
                        Text('${entry['quote']}'),
                      if ('${entry['text']}'.isNotEmpty)
                        Text('${entry['text']}'),
                      Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            onPressed: () {
                              Navigator.pop(context);
                              _jump(entry['revision'] as int);
                            },
                            child: const Text('查看来源'),
                          ),
                          TextButton(
                            onPressed: () =>
                                _personal.remove(entry['id'] as String),
                            child: const Text('移除这条记录'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            if (entries.isNotEmpty)
              TextButton(
                onPressed: () => _exportPersonal(),
                child: const Text('导出私人记录'),
              ),
          ],
        );
      },
    ),
  );
  Future<void> _readerSettings() => _sheet(
    ReaderAppearancePanel(
      preferences: _appearance,
      onStoryPreferences: () {
        Navigator.pop(context);
        widget.onPreferences();
      },
    ),
  );
  Future<void> _readerHistory() async {
    final view = c.current;
    if (view == null) return;
    await _sheet(
      ReaderHistoryPanel(
        view: view,
        blocked: c.blocked,
        onJump: (r) {
          Navigator.pop(context);
          _jump(r);
        },
        onFork: (r) {
          Navigator.pop(context);
          _fork(r);
        },
        onBookmark: (p) => _annotate('bookmark', p),
        onBranch: (id) {
          Navigator.pop(context);
          c.open(view.id, branch: id);
        },
        onExport: _exportStory,
        onCopy: () => _copyCurrentBranchMarkdown(view),
        onSnapshot: (r) => _snapshot(r),
      ),
    );
  }

  Future<void> _snapshot(int revision) async {
    final p = c.current?.pages.where((p) => p.revision == revision).firstOrNull;
    if (p == null) return;
    if (p.reader != null) {
      await _projectedPanel('snapshot', p.reader!, readonly: true);
      return;
    }
    await _sheet(
      ReaderPanel(
        title: '第 $revision 页 · 当时的记录',
        children: [
          Text(p.storyTime),
          if (p.input.isNotEmpty) Text('当时的表达：${p.input}'),
          SelectableText(p.text),
          const SizedBox(height: 16),
          const Text('这里展示此页保存的原文。未记录的当时资料不会用现在的情况补写。'),
        ],
      ),
    );
  }

  Future<void> _object(KnownInformation item) => _sheet(
    AnimatedBuilder(
      animation: _personal,
      builder: (context, _) => ReaderPanel(
        title: item.name,
        children: [
          Text('当前分支 · ${item.kind}'),
          if (item.recordHeading != null) Text(item.recordHeading!),
          SelectableText(item.text),
          if (item.status?.isNotEmpty == true) Text(item.status!),
          for (final field in item.fields)
            Text(
              '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
            ),
          Text(
            item.isInitialEntityRecord
                ? initialEntityRecordNotice
                : item.isHistoricalFact
                ? historicalFactRecordNotice
                : '这是当前分支保存的记录，不是对远方的实时探测。',
          ),
          if (item.isInitialEntityRecord) ...[
            const SizedBox(height: 16),
            const Text('正式事实与记录'),
            for (final fact in c.current?.information ?? <KnownInformation>[])
              if (fact.id.startsWith('fact:') &&
                  fact.relatedIds.contains(item.id))
                ListTile(
                  title: Text(fact.text),
                  subtitle: fact.recordHeading == null
                      ? null
                      : Text(fact.recordHeading!),
                  onTap: () => _object(fact),
                ),
            for (final record
                in c.current?.reader?.currentRecords ?? <ReaderEvidence>[])
              if ('entity:${record.entityId}' == item.id &&
                  record.value.isNotEmpty &&
                  record.kind != 'artifact')
                Text(
                  '${record.label}：${record.value} · 第 ${record.sourceRevision} 页',
                ),
          ],
          if (!widget.localReadOnly)
            Wrap(
              spacing: 8,
              children: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    _draftText('关于${item.name}，我想');
                  },
                  child: const Text('围绕它起草行动'),
                ),
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    _draftText('请根据已知记录说明${item.name}的情况。', mode: 'ask');
                  },
                  child: const Text('先问问'),
                ),
                if (item.kind == 'location')
                  TextButton(
                    onPressed: () => _route(item),
                    child: const Text('查看已知情况与路线'),
                  ),
              ],
            ),
          if (item.relatedIds.isNotEmpty) ...[
            Text(item.isInitialEntityRecord ? '初次关联' : '相关的已知记录'),
            for (final related
                in c.current?.information ?? <KnownInformation>[])
              if (item.relatedIds.contains(related.id))
                ListTile(
                  title: Text(related.name),
                  subtitle: Text(related.displaySummary),
                  onTap: () => _object(related),
                ),
          ],
          TextButton(
            onPressed: () => _personal.follow(item.id),
            child: Text(
              _personal.followed.contains(item.id) ? '取消关注' : '记为我在意的事',
            ),
          ),
          TextButton(
            onPressed: () =>
                _note(c.current?.revision ?? 0, item.text, objectId: item.id),
            child: const Text('编辑私人备注'),
          ),
          for (final n in _personal.entries.where(
            (n) => n['object_id'] == item.id,
          ))
            Text('${n['text']}'),
          if (!widget.localReadOnly &&
              const {'fact', 'rule', 'statement', 'belief'}.contains(item.kind))
            TextButton(
              onPressed: c.blocked
                  ? null
                  : () {
                      Navigator.pop(context);
                      _fork(c.current!.revision, fact: item);
                    },
              child: const Text('明确编辑设定（另开分支）'),
            ),
        ],
      ),
    ),
  );
  Future<void> _route(KnownInformation location) => _sheet(
    ReaderPanel(
      title: '${location.name} · 路线',
      children: [
        SelectableText(location.text),
        const Text('此处只列出已经公开的地点记录。尚无已确认的路线距离、通行状态、耗时或费用。'),
        const Text('查看地点不会移动角色。'),
        TextButton(
          onPressed: () {
            Navigator.pop(context);
            _draftText(
              '从我目前所在的地方，前往${location.name}有哪些已知路线、耗时、费用和限制？',
              mode: 'ask',
            );
          },
          child: const Text('询问路线与限制'),
        ),
        TextButton(
          onPressed: c.blocked
              ? null
              : () {
                  Navigator.pop(context);
                  _draftText('我想尝试前往${location.name}。遇到封锁、费用或不可逆的决定时，先让我确认。');
                },
          child: const Text('起草前往意图'),
        ),
      ],
    ),
  );
  Future<void> _projectedPanel(
    String kind,
    ReaderProjection projection, {
    bool readonly = false,
  }) => _sheet(
    ReaderEvidencePanel(
      kind: kind,
      projection: projection,
      onCancel: c.operation?.running == true
          ? () {
              c.cancel();
              Navigator.pop(context);
            }
          : null,
      onRestore: readonly
          ? null
          : (revision) {
              Navigator.pop(context);
              _fork(revision);
            },
      readonly: readonly,
      blocked: c.blocked || c.current?.pages.lastOrNull?.outcome == 'ending',
      initialValues: Map<String, dynamic>.from(
        _personal.values['artifact_params'] as Map? ?? {},
      ),
      onValues: (values) => _personal.update({'artifact_params': values}),
      onObject: (item) {
        if (readonly) {
          _sheet(
            ReaderPanel(
              title: item.name,
              children: [const Text('当时的已知记录'), SelectableText(item.text)],
            ),
          );
        } else {
          _object(item);
        }
      },
      onAction: (text) {
        Navigator.pop(context);
        _draftText(text);
      },
      onHistory: () async {
        Navigator.pop(context);
        await Future<void>.delayed(Duration.zero);
        await _history();
      },
      onSource: (revision) {
        Navigator.pop(context);
        _jump(revision);
      },
      onExport: (record) async {
        try {
          _toast(
            await exportReaderFile(
              '交互记录-${record.factId}.json',
              const JsonEncoder.withIndent('  ').convert(record.toJson()),
              'application/json',
            ),
          );
        } catch (_) {
          _toast('导出未完成，原记录仍保留。');
        }
      },
    ),
  );
  bool get _branchIsArchived =>
      (_checkpoints.values['archived_branches'] as List? ?? const []).contains(
        c.current?.branchId,
      );

  bool _preparedCurrent(ExperienceView view) =>
      !_branchIsArchived &&
      c.current?.pages.lastOrNull?.outcome != 'ending' &&
      mounted &&
      c.current?.id == view.id &&
      c.current?.branchId == view.branchId &&
      c.current?.revision == view.revision &&
      !c.blocked &&
      !c.loading &&
      c.storageError == null;
  ReaderArtifactRepository _newPreparedRepository(ExperienceView view) =>
      ReaderArtifactRepository(
        client:
            widget.artifactClient?.call() ??
            PortalServiceClient(() => c.session.backendUrl),
        journal: c.journal,
        scope: experienceScope(
          c.session.backendUrl,
          c.session.workspaceId,
          view.id,
          'artifact:' + view.branchId + ':' + view.revision.toString(),
        ),
        experienceId: view.id,
        branchId: view.branchId,
        revision: view.revision,
        isCurrent: () => _preparedCurrent(view),
        belongsToCurrent: () =>
            mounted &&
            c.current?.id == view.id &&
            c.current?.branchId == view.branchId &&
            c.current?.revision == view.revision,
      );
  void _syncPreparedArtifact() {
    if (widget.localDemo ||
        widget.localReadOnly ||
        widget.artifactClient == null)
      return;
    final view = c.current;
    if (view == null || c.loading) {
      _artifactRepository?.removeListener(_readerChanged);
      _artifactRepository?.dispose();
      _artifactRepository = null;
      _artifactScope = null;
      return;
    }
    if (c.blocked) {
      _artifactRepository?.cancel();
      return;
    }
    final scope = c.scope + ':' + view.revision.toString();
    if (_artifactScope == scope) return;
    _artifactRepository?.removeListener(_readerChanged);
    _artifactRepository?.dispose();
    _artifactScope = scope;
    final repository = _newPreparedRepository(view);
    _artifactRepository = repository;
    repository.addListener(_readerChanged);
    unawaited(
      repository.prepareAutomatically().catchError((Object error) {
        if (!repository.disposed) {
          repository.error = error.toString();
          _readerChanged();
        }
      }),
    );
  }

  Future<void> _attemptPrepared(
    ExperienceView view,
    String text, {
    String? requestId,
  }) async {
    if (!_preparedCurrent(view) ||
        c.current?.pages.lastOrNull?.outcome == 'ending')
      throw StateError('当前片刻不能提交这项行动。');
    final draft = c.draft, mode = c.mode, scope = c.scope;
    try {
      await c.saveDraft(text, selectedMode: 'act');
      if (!_preparedCurrent(view)) throw StateError('故事已经改变或草稿保存失败。');
      await c.send(explicitMode: 'act', requestId: requestId);
    } finally {
      if (c.scope == scope && (c.draft == text || c.draft.isEmpty))
        await c.saveDraft(draft, selectedMode: mode);
    }
  }

  Future<void> _attemptContract(ExperienceView view, Json request) async {
    final repository = _artifactRepository;
    if (repository == null || !_preparedCurrent(view))
      throw StateError('尝试入口已经过期。');
    final input = string(request, 'input');
    final routed = await repository.routeInput(
      input,
      c.draft,
      phase: 'action',
      dynamicAttempt: object(request['dynamic_attempt']),
    );
    if (routed == null) throw StateError(repository.error ?? '尝试请求尚待确认。');
    if (!_preparedCurrent(view)) return;
    if (object(routed['decision'])['kind'] != 'attempt')
      throw const FormatException('尝试入口没有得到正式校验。');
    final id = string(routed, 'operation_id');
    await _attemptPrepared(view, input, requestId: id);
    if (c.attempt?['request_id'] == id)
      await repository.consumeInput('action', string(routed, 'request_id'));
  }

  Widget _inlinePreparedArtifact() {
    final repository = _artifactRepository, view = c.current;
    if (repository == null || view == null || _artifactModal)
      return const SizedBox.shrink();
    if ((repository.artifact?.hasPresentation != true ||
            !repository.matchesCurrentStory) &&
        repository.error == null &&
        repository.pending == null)
      return const SizedBox.shrink();
    if (repository.artifact == null &&
        repository.error == null &&
        repository.pending == null)
      return const SizedBox.shrink();
    return ReaderPreparedWorkbench(
      key: ValueKey(_artifactScope),
      repository: repository,
      embedded: true,
      input: view.pages.lastOrNull?.input ?? '',
      prose: view.pages.lastOrNull?.text ?? '',
      ownsRepository: false,
      initializeRepository: false,
      dark: _appearance.readingTheme == 'night',
      reducedMotion: _appearance.reducedMotion,
      onNavigate: _navigatePrepared,
      onContractAttempt: (request) => _attemptContract(view, request),
      onAttempt: (text) => _attemptPrepared(view, text),
      onExecute: (id, action) async {
        if (widget.localReadOnly || !_preparedCurrent(view))
          throw StateError("故事已改变，请重新打开作品。");
        await c.executeArtifact(id, action);
      },
      onDraft: _draftText,
      onEvidence: () {
        if (view.reader != null) _projectedPanel('artifact', view.reader!);
      },
    );
  }

  Future<Json?> _routeReaderInput(String intent) async {
    final repository = _artifactRepository, view = c.current;
    if (repository == null || view == null || !_preparedCurrent(view))
      return null;
    final draft = c.draft;
    bool current() => mounted && _preparedCurrent(view) && c.draft == draft;
    try {
      if (widget.generativeUiEnabled) {
        await repository.flushLocalState?.call();
        if (!current()) return null;
        final routed = await repository.routeInput(intent, draft, phase: 'ui');
        if (routed == null || !current()) return null;
        final decision = object(routed['decision']), kind = decision['kind'];
        if (kind != 'story') {
          await repository.consumeInput('ui', routed['request_id'] as String);
          if (kind == 'mixed' || kind == 'clarify')
            _toast(decision['message'] as String);
          else {
            if (current()) await c.saveDraft('');
            if (repository.artifact?.hasPresentation != true)
              _toast(
                repository.artifact?.payload['reason'] as String? ??
                    decision['message'] as String,
              );
          }
          return null;
        }
      }
      final action = await repository.routeInput(draft, draft, phase: 'action');
      if (action == null || !current()) return null;
      final decision = object(action['decision']);
      final ui = repository.inputDecisions['ui'];
      if (decision['kind'] == 'clarify') {
        if (ui != null)
          await repository.consumeInput('ui', ui['request_id'] as String);
        await repository.consumeInput('action', action['request_id'] as String);
        _toast(decision['message'] as String);
        return null;
      }
      return action;
    } catch (error) {
      _toast('$error');
      return null;
    }
  }

  Future<void> _navigatePrepared(String kind, Json options) async {
    final view = c.current;
    if (view == null) return;
    final revision = options['revision'];
    if (revision == view.revision) {
      if (kind == 'map') {
        await _preparedWorkbench(panel: 'travel', initialMap: options);
        return;
      }
      if (view.publicGameplay?.game == null) {
        await _contextPanel({
          'kind': 'overview',
          if (kind == 'interaction') 'filter': 'person',
        });
        return;
      }
    }
    final page = view.pages.where((p) => p.revision == revision).firstOrNull,
        gameplay = revision == view.revision
            ? view.publicGameplay
            : view.pages
                  .where((p) => p.revision == revision)
                  .firstOrNull
                  ?.reader
                  ?.gameplay;
    if (page == null) return;
    if (gameplay?.game == null) {
      await _snapshot(page.revision);
      return;
    }
    await _sheet(
      ReaderPanel(
        title: revision == view.revision ? '当前的资料' : '当时的资料',
        children: [
          ReaderArtifactSurface(
            data: {
              'surface': 'gameplay',
              'kind': kind,
              'readonly': true,
              'state': gameplay!.sourceState(page.revision, page.storyTime),
              'scope': {'branchId': view.branchId},
              'mapScope': options['scope'],
              'anchorId': options['anchor'],
              'dark': _appearance.readingTheme == 'night',
            },
            onMessage: (message, value) {
              if (message == 'gameplay-history') {
                Navigator.pop(context);
                Future<void>.delayed(Duration.zero, () => _history());
              }
              if (message == 'context-close') Navigator.pop(context);
              if (message == 'source') {
                Navigator.pop(context);
                _jump(page.revision);
              }
            },
            fallback: const Text('历史资料请在网页版查看。'),
          ),
        ],
      ),
    );
  }

  Future<void> _prepareFromInput(String intent) async {
    final repository = _artifactRepository;
    if (repository == null || !repository.isCurrent()) return;
    if (repository.busy || repository.pending != null) {
      _toast('作品请求正在处理或等待确认，输入已保留。');
      return;
    }
    final scope = c.scope, draft = c.draft;
    try {
      await repository.prepare(intent);
      if (repository.error != null || repository.pending != null) return;
      if (mounted && scope == c.scope && draft == c.draft)
        await c.saveDraft('');
      if (repository.artifact?.hasPresentation != true)
        _toast(
          repository.artifact?.payload['reason'] as String? ?? '此刻没有需要额外整理的信息。',
        );
    } catch (error) {
      _toast(error.toString());
    }
  }

  Future<void> _preparedWorkbench({String? panel, Json? initialMap}) async {
    final view = c.current;
    if (view == null || widget.localDemo || widget.localReadOnly) return;
    final repository = _artifactRepository ?? _newPreparedRepository(view),
        owns = _artifactRepository == null;
    _mutate(() => _artifactModal = true);
    try {
      await _sheet(
        ReaderPreparedWorkbench(
          repository: repository,
          panel: panel,
          initialMap: initialMap,
          ownsRepository: owns,
          initializeRepository: owns,
          dark: _appearance.readingTheme == 'night',
          reducedMotion: _appearance.reducedMotion,
          onDraft: (text) {
            Navigator.pop(context);
            _draftText(text);
          },
          onEvidence: () {
            Navigator.pop(context);
            if (view.reader != null) _projectedPanel('artifact', view.reader!);
          },
          onNavigate: _navigatePrepared,
          onContractAttempt: (request) => _attemptContract(view, request),
          onAttempt: (text) => _attemptPrepared(view, text),
          onExecute: (id, action) async {
            if (widget.localReadOnly || !_preparedCurrent(view))
              throw StateError("故事已改变，请重新打开作品。");
            await c.executeArtifact(id, action);
          },
        ),
      );
    } finally {
      _mutate(() => _artifactModal = false);
    }
  }

  Future<void> _readerPanel(String kind) async {
    final view = c.current;
    if (view == null) return;
    if (kind == 'journal') return _notes(journal: true);
    if (kind == 'artifact' && !widget.localDemo) return _preparedWorkbench();
    final preparedGame =
        _artifactRepository?.artifact?.payload['state']?['game'];
    if (kind == 'map' &&
        !widget.localDemo &&
        !widget.localReadOnly &&
        preparedGame is Map &&
        (objects(
              preparedGame['entities'] ?? [],
            ).any((entity) => entity['kind'] == 'place') ||
            (preparedGame['journeys'] is Map &&
                (preparedGame['journeys']['routes'] as List? ?? [])
                    .isNotEmpty) ||
            (preparedGame['spatial'] is Map &&
                (preparedGame['spatial']['sites'] as List? ?? [])
                    .isNotEmpty))) {
      return _preparedWorkbench(panel: 'travel');
    }
    if (view.reader != null &&
        const {'map', 'inventory', 'status', 'time', 'artifact'}.contains(kind))
      return _projectedPanel(kind, view.reader!);
    final kinds = switch (kind) {
      'inventory' => {'item'},
      'map' => {'location'},
      'clues' => {'clue', 'thread'},
      'status' => {'status', 'rule', 'fact'},
      'around' => {'person', 'character', 'location', 'item'},
      'time' => {'event', 'agreement', 'schedule'},
      _ => <String>{},
    };
    final items = view.information.where(
      (i) => kinds.isEmpty || kinds.contains(i.kind),
    );
    await _sheet(
      ReaderPanel(
        title:
            const {
              'inventory': '身上与物品',
              'map': '地图与路线',
              'clues': '线索',
              'status': '状态与规则',
              'around': '周围',
              'time': '时间与日程',
              'timeline': '时间线',
              'artifact': '交互作品',
            }[kind] ??
            '故事资料',
        children: [
          const Text('来自当前分支 · 查看不会推进时间'),
          if (kind == 'around') const Text('记录未明确人物是否仍在场；只列出最后已知的情况。'),
          if (kind == 'inventory')
            const Text('物品记录不等于已由你持有。所有权、保管与位置以正文中的记录为准。'),
          if (kind == 'map') ...[
            const Text('已知地点 · 方位与距离以正文为准'),
            const Text('没有地理依据的地点不标记坐标；关联也不代表通路或通行许可。'),
          ],
          if (kind == 'time') ...[
            Text(view.pages.isEmpty ? '故事时间尚未明确' : view.pages.last.storyTime),
            TextButton(onPressed: _time, child: const Text('安排一段时间')),
          ],
          if (kind == 'timeline') ...[
            for (final p in view.pages)
              ListTile(
                leading: Text('${p.revision}'),
                title: Text(p.storyTime),
                subtitle: Text(
                  p.input.isEmpty ? p.text : p.input,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () {
                  Navigator.pop(context);
                  _jump(p.revision);
                },
              ),
          ] else if (kind == 'artifact') ...[
            const Text('尚无这条分支已提交的交互作品。'),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                _draftText('请根据当前已知信息，整理可执行的操作、适用规则以及需要我确认的事项。', mode: 'ask');
              },
              child: const Text('先询问可用操作'),
            ),
          ] else ...[
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Text('暂无相关已知记录；没有记录，不代表不存在。'),
              ),
            for (final item in items)
              ListTile(
                title: Text(item.name),
                subtitle: Text(item.displaySummary),
                onTap: () => _object(item),
              ),
          ],
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _history();
            },
            child: const Text('搜索与回顾'),
          ),
        ],
      ),
    );
  }

  Future<void> _time() async {
    if (widget.localReadOnly) return;
    final scope = c.scope, revision = c.current?.revision;
    await _sheet(
      ReaderTimePanel(
        storyTime:
            c.current?.reader?.storyTime ??
            c.current?.pages.lastOrNull?.storyTime ??
            '',
        blocked: c.blocked || c.current?.pages.lastOrNull?.outcome == 'ending',
        onSubmit: (instruction) async {
          if (scope != c.scope ||
              revision != c.current?.revision ||
              c.blocked) {
            _toast('情况已经更新，请重新打开时间，核对后再等待。');
            return;
          }
          Navigator.pop(context);
          final prior = c.draft;
          await c.saveDraft(instruction, selectedMode: 'act');
          if (scope != c.scope || !mounted) return;
          await c.send(explicitMode: 'act');
          if (scope == c.scope && c.draft.isEmpty && prior.isNotEmpty)
            await c.saveDraft(prior, selectedMode: 'act');
        },
      ),
    );
  }

  Future<void> _participation() => _sheet(
    AnimatedBuilder(
      animation: _personal,
      builder: (context, _) => ReaderPanel(
        title: '参与方式',
        children: [
          const Text('接手时由你决定行动。观察时，在已定事实和底线内让故事安排这一段，随时可以接回。'),
          for (final entry in {'act': '我来接手', 'observe': '先观察，让故事发展'}.entries)
            ListTile(
              title: Text(entry.value),
              selected: _personal.participation == entry.key,
              leading: Icon(
                _personal.participation == entry.key
                    ? Icons.radio_button_checked
                    : Icons.radio_button_off,
              ),
              onTap: () async {
                final scope = c.scope;
                if (c.operation?.running == true || c.unknown) await c.cancel();
                if (scope != c.scope || !mounted || c.blocked) return;
                await _personal.update({'participation': entry.key});
                _toast(
                  entry.key == 'act' ? '已接手。草稿保留，发送后才会行动。' : '点继续经历才会推进故事。',
                );
              },
            ),
          const Text('切换本身不会推进故事；已经成立的经历与草稿保留。'),
        ],
      ),
    ),
  );
  Future<void> _feedback({String quote = '', int? revision}) async {
    final scope = c.scope;
    final text = await _textDialog('本机反馈草稿', '问题或建议（只保存在本机，未发送）', quote: quote);
    if (text != null && mounted && scope == c.scope) {
      await _personal.annotate(
        'feedback',
        revision ?? c.current?.revision ?? 0,
        quote,
        text: text,
      );
      _toast(_personal.error ?? '反馈已保存在本机，未发送。');
    }
  }

  Future<void> _exportPersonal() async {
    try {
      _toast(
        await exportReaderFile(
          '私人记录-${DateTime.now().millisecondsSinceEpoch}.json',
          const JsonEncoder.withIndent('  ').convert(_personal.values),
          'application/json',
        ),
      );
    } catch (_) {
      _toast('导出未完成，私人记录仍保留。');
    }
  }

  Future<void> _exportStory() async {
    final view = c.current;
    if (view == null) return;
    final text =
        '# ${view.title}\n\n${view.pages.map((p) => '## 第 ${p.revision} 页 · ${p.storyTime}\n\n${p.text}\n').join('\n')}';
    await _sheet(
      ReaderPanel(
        title: '导出正文',
        children: [
          Text('当前分支 · ${view.pages.length} 段正式记录'),
          for (final type in ['Markdown', '纯文本', 'JSON'])
            TextButton(
              onPressed: () async {
                final content = type == 'Markdown'
                    ? text
                    : type == '纯文本'
                    ? '${view.title}\n\n${view.pages.map((p) => p.text).join('\n\n')}'
                    : const JsonEncoder.withIndent('  ').convert({
                        'title': view.title,
                        'experience_id': view.id,
                        'branch_id': view.branchId,
                        'pages': [
                          for (final p in view.pages)
                            {
                              'revision': p.revision,
                              'text': p.text,
                              'story_time': p.storyTime,
                              'outcome': p.outcome,
                            },
                        ],
                      });
                try {
                  _toast(
                    await exportReaderFile(
                      '经历-${DateTime.now().millisecondsSinceEpoch}.${type == 'Markdown'
                          ? 'md'
                          : type == 'JSON'
                          ? 'json'
                          : 'txt'}',
                      content,
                      type == 'JSON' ? 'application/json' : 'text/plain',
                    ),
                  );
                } catch (_) {
                  _toast('导出未完成，可以复制正文。');
                }
              },
              child: Text('导出 $type'),
            ),
          TextButton(
            onPressed: () => _copyCurrentBranchMarkdown(view),
            child: const Text('复制当前分支正文（Markdown）'),
          ),
          if (!widget.localDemo && widget.artifactClient != null) ...[
            const Divider(),
            const Text('全部阅读记录包含此工作区全部经历与分支中各页已经揭示的资料，不含幕后设定、私人输入或草稿。'),
            TextButton(
              onPressed: () async {
                final client = widget.artifactClient!(), owner = c.owner;
                try {
                  final value = await client.exportReaderRecords();
                  if (!mounted || c.owner != owner) return;
                  _toast(
                    await exportReaderFile(
                      'elselife-reading.json',
                      const JsonEncoder.withIndent('  ').convert(value),
                      'application/json',
                    ),
                  );
                } catch (_) {
                  if (mounted && c.owner == owner) _toast('阅读记录导出未完成，原记录保留。');
                } finally {
                  client.close();
                }
              },
              child: const Text('导出全部已揭示阅读记录'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _finishStory() async {
    final view = c.current;
    if (view == null || widget.localDemo || widget.localReadOnly) return;
    try {
      await _attemptPrepared(
        view,
        '请让这段经历合理收束，回答能够回答的重要期待，保留已经取得的成果；未完成的事情如实交代，不强加新危机阻止结束。',
      );
    } catch (error) {
      _toast('$error');
    }
  }

  Future<bool> _handleInputCommand() async {
    final command = readerInputCommand(c.draft);
    if (command == null || c.current == null) return false;
    final scope = c.scope, original = c.draft;
    Future<void> clear() async {
      if (c.scope == scope && c.draft == original) await c.saveDraft('');
    }

    switch (command.action) {
      case 'recover':
      case 'retry':
        await c.recover();
        if (command.action == 'retry' && c.notReceived)
          await c.resendSameRequest();
      case 'continue':
        if (c.blocked || _artifactRepository?.blocksStoryInput == true) {
          _toast('请先核对上一项请求，草稿已保留。');
          return true;
        }
        await clear();
        await _send(mode: 'read');
      case 'font':
        await _appearance.setValue(
          'fontSize',
          _appearance.fontSize + int.parse(command.value!),
        );
        _toast('已调整界面，故事没有变化。');
      case 'theme':
        await _appearance.setValue('theme', command.value!);
        _toast('已调整界面，故事没有变化。');
      case 'save':
        if (c.blocked || !_checkpoints.loaded) {
          _toast('请先完成当前请求或读取存档，输入已保留。');
          return true;
        }
        final view = c.current!;
        await _checkpoints.annotate(
          'checkpoint',
          view.revision,
          '',
          text: command.value ?? view.pages.lastOrNull?.storyTime ?? '当前片刻',
          objectId: view.branchId,
        );
        if (_checkpoints.error == null) {
          await clear();
          _toast('这个片刻已保存在此设备。');
        }
      case 'tools':
        await clear();
        await _sheet(
          ReaderPanel(
            title: '故事选项',
            children: [
              for (final item in readerToolLabels.entries)
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    _readerTool(item.key);
                  },
                  child: Text(item.value),
                ),
            ],
          ),
        );
      default:
        if (command.action == 'branches') await clear();
        _readerTool(command.action);
    }
    return true;
  }

  bool _readOnlyToolAllowed(String value) => const {
    'information',
    'history',
    'branches',
    'notes',
    'preferences',
    'export',
    'comparison',
    'world',
    'author',
    'feedback',
    'leave',
    'help',
    'around',
    'map',
    'inventory',
    'clues',
    'status',
    'journal',
    'timeline',
  }.contains(value);
  void _readerTool(String value) {
    if (widget.localReadOnly && !_readOnlyToolAllowed(value)) return;
    if (_branchIsArchived && const {'time', 'finish'}.contains(value)) {
      _toast('这条分支已封存，请先在分支面板恢复。');
      return;
    }
    switch (value) {
      case 'information':
        _information();
      case 'history':
        _history();
      case 'branches':
        _branches();
      case 'notes':
        _notes();
      case 'preferences':
        _readerSettings();
      case 'storyPreferences':
        widget.onPreferences();
      case 'time':
        _time();
      case 'participation':
        _participation();
      case 'export':
        _exportStory();
      case 'comparison':
        _compareSnapshots();
      case 'reuse':
        final previous = c.current?.pages
            .where((p) => p.input.isNotEmpty)
            .lastOrNull;
        if (previous == null) {
          _toast('尚无可复用的表达。');
          return;
        }
        _reuseDraft = c.draft;
        c.saveDraft(previous.input);
        _expandComposer();
      case 'undoReuse':
        if (_reuseDraft != null) {
          c.saveDraft(_reuseDraft!);
          _reuseDraft = null;
          _expandComposer();
        }
      case 'repair':
        _assistance('repair');
      case 'polish':
        _assistance('polish');
      case 'undoPolish':
        _undoPolish();
      case 'regenerate':
        _regenerate();
      case 'finish':
        unawaited(_finishStory());
      case 'world':
        _sheet(
          ReaderPanel(
            title: '公开设定',
            children: [SelectableText(c.current?.seed ?? '')],
          ),
        );
      case 'author':
        _authorView();
      case 'rewrite':
        if (widget.onRewriteWorld != null) {
          widget.onRewriteWorld!();
        } else {
          _toast('这段经历没有可应用的关联世界版本。');
        }
      case 'feedback':
        _feedback();
      case 'leave':
        widget.onPortalShelf?.call();
      case 'help':
        _sheet(
          ReaderPanel(
            title: '帮助',
            children: [
              const Text('写行动、说对白，或继续阅读。查看地图、人物、物品与手记可以从故事工具进入。'),
              const ExpansionTile(
                title: Text('阅读、时间与分支'),
                children: [
                  Text('查看资料不会推进故事。安排时间时写下目标与上限；回看原文不会回档，每页记录选项可以建立分支。'),
                ],
              ),
              const ExpansionTile(
                title: Text('笔记与引用'),
                children: [
                  Text('私人笔记只保存在本机。附在输入框里的引用随下一次行动或提问发送；只点继续经历不会发送草稿或引用。'),
                ],
              ),
              const ExpansionTile(
                title: Text('保存与生成'),
                children: [Text('正式正文由服务保存；草稿、阅读偏好和私人记录保存在本机。生成状态不明确时先查询原请求。')],
              ),
              TextButton(
                onPressed: () => _feedback(),
                child: const Text('记录问题'),
              ),
              TextButton(
                onPressed: () => _notes(),
                child: const Text('查看本机记录'),
              ),
            ],
          ),
        );
      default:
        _readerPanel(value);
    }
  }
}
