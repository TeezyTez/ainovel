part of 'experience_screen.dart';

/// Connects the presentation to the reader's existing source-coordinate cursor.
extension _ReaderNotebookHost on _ExperienceScreenState {
  ReaderPageContextIndex _pageContextIndex(ExperienceView view) {
    if (!identical(view, _notebookView)) {
      _notebookView = view;
      _notebookIndex = ReaderPageContextIndex(view);
    }
    return _notebookIndex!;
  }

  ExperiencePage? _readingPage(ExperienceView view) {
    if (view.pages.isEmpty) return null;
    if (_appearance.readingMode == 'paged') {
      return _visiblePages(view).firstOrNull;
    }
    final revision = _readingRevision ?? c.readingAnchor?.revision;
    return view.pages.where((page) => page.revision == revision).firstOrNull ??
        view.pages.first;
  }

  void _trackReadingPage(ReaderReadingAnchor? anchor) {
    int? revision = anchor?.revision;
    if (_appearance.readingMode != 'paged' &&
        _scroll.hasClients &&
        _scroll.position.maxScrollExtent > 0 &&
        _scroll.position.extentAfter < 1) {
      // A short final page cannot reach the top of a tall viewport. At the
      // deliberate end of the scroll, the final page is the reading context.
      revision = c.current?.pages.lastOrNull?.revision;
    }
    if (revision == null) {
      final viewport = _readingViewport.currentContext?.findRenderObject();
      if (viewport is RenderBox && viewport.hasSize) {
        final top = viewport.localToGlobal(Offset.zero).dy;
        final bottom = top + viewport.size.height;
        // Include page footers when the prose has just scrolled out of view.
        for (final page in c.current?.pages ?? <ExperiencePage>[]) {
          final render = _pages[page.revision]?.currentContext
              ?.findRenderObject();
          if (render is! RenderBox || !render.hasSize) continue;
          final y = render.localToGlobal(Offset.zero).dy;
          if (y + render.size.height > top && y < bottom) {
            revision = page.revision;
            break;
          }
        }
      }
    }
    if (mounted && revision != null && revision != _readingRevision) {
      _mutate(() => _readingRevision = revision);
    }
  }

  Widget _notebookPanel(
    ExperienceView view,
    ReaderPageContext page, {
    BuildContext? sheetContext,
  }) {
    final scope = c.scope;
    void closeSheet() {
      if (sheetContext != null) Navigator.pop(sheetContext);
    }

    return ReaderNotebook(
      // A branch is a new notebook, even if its page numbers are the same.
      key: ValueKey('notebook-${view.id}-${view.branchId}'),
      index: _pageContextIndex(view),
      page: page,
      latestRevision: view.revision,
      onClose: sheetContext == null ? null : closeSheet,
      onInspect: (item) {
        if (scope != c.scope) return;
        closeSheet();
        _inspectPageRecord(page, item);
      },
      onSource: (revision) async {
        if (scope != c.scope) return;
        // Closing a modal restores focus and changes the reader's layout.
        // Retain the source cursor before that work, then navigate only after
        // its route has left the overlay.
        _rememberNotebookReturn();
        final route = sheetContext == null ? null : ModalRoute.of(sheetContext);
        closeSheet();
        if (route != null) await route.completed;
        if (!mounted || scope != c.scope || c.loading) return;
        _visitNotebookSource(revision);
      },
      onAllInformation: () {
        if (scope != c.scope) return;
        closeSheet();
        _information();
      },
    );
  }

  Future<void> _openNotebook([int? revision]) async {
    final view = c.current;
    if (view == null) return;
    final target = revision ?? _readingPage(view)?.revision;
    if (target == null) return;
    final page = _pageContextIndex(view).at(target);
    if (page == null) return;
    if (MediaQuery.sizeOf(context).width >= 1050 && !_personal.focus) {
      _mutate(() => _readingRevision = target);
      return;
    }
    await _sheet(
      Builder(
        builder: (sheet) => _notebookPanel(view, page, sheetContext: sheet),
      ),
    );
  }

  Future<void> _inspectPageRecord(
    ReaderPageContext page,
    KnownInformation item,
  ) async {
    if (page.page.revision == c.current?.revision) {
      await _object(item);
      return;
    }
    await _sheet(
      ReaderPanel(
        title: item.name,
        children: [
          Text('第 ${page.page.revision} 页 · ${readerNotebookKind(item)}'),
          if (item.recordHeading != null) Text(item.recordHeading!),
          const SizedBox(height: 12),
          SelectableText(item.text),
          for (final field in item.fields)
            Text(
              '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
            ),
          if (item.status?.isNotEmpty == true) Text('状态：${item.status}'),
          if (item.certainty?.isNotEmpty == true) Text('确定性：${item.certainty}'),
          if (item.relatedIds.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              '${item.associationLabel}：${item.relatedNames(page.information)}',
            ),
          ],
          const SizedBox(height: 16),
          const Text('这里保留当时的公开记载。回读不会改变故事或待发送的草稿。'),
        ],
      ),
    );
  }

  void _rememberNotebookReturn() {
    final view = c.current;
    if (view == null) return;
    if (_notebookReturnScope != c.scope) {
      _notebookReturnScope = c.scope;
      _notebookReturnAnchor = c.readingAnchor ?? _captureReadingAnchor();
      _notebookReturnRevision = _readingPage(view)?.revision;
    }
  }

  void _visitNotebookSource(int revision) {
    final view = c.current;
    if (view == null || !view.pages.any((page) => page.revision == revision)) {
      return;
    }
    _rememberNotebookReturn();
    _jump(revision);
  }

  void _returnFromNotebook() {
    final view = c.current;
    final revision = _notebookReturnRevision;
    final anchor = _notebookReturnAnchor;
    final scope = _notebookReturnScope;
    _mutate(() {
      _notebookReturnScope = null;
      _notebookReturnRevision = null;
      _notebookReturnAnchor = null;
    });
    if (view == null || scope != c.scope || revision == null) return;
    final index = view.pages.indexWhere((page) => page.revision == revision);
    if (index < 0) return;
    if (anchor == null) {
      _jump(revision);
      return;
    }
    final epoch = ++_readingRestoreEpoch;
    _readingScrollEpoch++;
    _pendingReadingAnchor = anchor;
    _restoringPosition = true;
    _readingRevision = revision;
    unawaited(_personal.update({'page': index}));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || epoch != _readingRestoreEpoch) return;
      _pendingReadingAnchor = null;
      if (scope == c.scope && !c.loading) _restoreReadingAnchor(anchor);
      _restoringPosition = false;
    });
  }

  Widget _notebookNavigation(ExperienceView view) {
    final reading = _readingPage(view)?.revision;
    final returning =
        _notebookReturnScope == c.scope && _notebookReturnRevision != null;
    final historical = reading != null && reading < view.revision;
    if (!returning && !historical) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (returning)
            Row(
              children: [
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _returnFromNotebook,
                      icon: const Icon(
                        Icons.subdirectory_arrow_right,
                        size: 16,
                      ),
                      label: Text('回到刚才 · 第 $_notebookReturnRevision 页'),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: '取消返回位置',
                  onPressed: () => _mutate(() {
                    _notebookReturnScope = null;
                    _notebookReturnRevision = null;
                    _notebookReturnAnchor = null;
                  }),
                  icon: const Icon(Icons.close, size: 16),
                ),
              ],
            ),
          if (historical)
            Row(
              children: [
                Expanded(
                  child: Text(
                    '回读第 $reading 页${widget.localReadOnly ? '' : ' · 行动接续第 ${view.revision} 页'}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      height: 1.6,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => _jump(view.pages.last.revision),
                  child: const Text('回到最新'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
