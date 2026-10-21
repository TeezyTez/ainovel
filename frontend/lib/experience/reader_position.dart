part of 'experience_screen.dart';

class _ReaderTextNode {
  _ReaderTextNode(this.revision, this.pageText, this.start, this.text);
  final key = GlobalKey();
  final int revision, start;
  final String pageText, text;
}

extension _ReaderPosition on _ExperienceScreenState {
  bool _restoreLegacyPagedPosition() {
    final view = c.current;
    if (!mounted ||
        c.loading ||
        _restoringPosition ||
        view == null ||
        c.readingAnchor != null ||
        _appearance.readingMode != 'paged' ||
        !_personal.loaded ||
        _personal.scope != c.scope) {
      return false;
    }
    final page = _visiblePages(view).firstOrNull;
    if (page == null || _pages[page.revision]?.currentContext != null) {
      return false;
    }
    // The saved pagination cursor can arrive after the first layout. Sampling
    // that old layout would turn its first page into a new source anchor and
    // overwrite the just-loaded cursor. Apply the legacy offset after rebuild.
    final scope = c.scope, epoch = ++_readingRestoreEpoch;
    _restoringPosition = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || epoch != _readingRestoreEpoch) return;
      if (scope == c.scope && _scroll.hasClients) {
        _scroll.jumpTo(c.offset.clamp(0, _scroll.position.maxScrollExtent));
        _trackRestoredReadingPage();
      }
      _restoringPosition = false;
    });
    return true;
  }

  void _trackRestoredReadingPage() {
    final scope = c.scope, epoch = _readingRestoreEpoch;
    // Restoration suppresses the normal scroll listener, and jumpTo's new
    // viewport transform is not available until the following layout.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          scope != c.scope ||
          epoch != _readingRestoreEpoch ||
          _restoringPosition ||
          !_scroll.hasClients) {
        return;
      }
      _trackReadingPage(_captureReadingAnchor());
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  Key _readingTextKey(ExperiencePage page, int start, String text) {
    final id = '${page.revision}:$start';
    var node = _readingNodes[id];
    if (node == null || node.pageText != page.text || node.text != text) {
      node = _ReaderTextNode(page.revision, page.text, start, text);
      _readingNodes[id] = node;
    }
    return node.key;
  }

  RenderBox? _textRender(_ReaderTextNode node) {
    final root = node.key.currentContext?.findRenderObject();
    if (root == null || !root.attached) return null;
    RenderBox? result;
    void visit(RenderObject render) {
      if (result != null) return;
      if (render is RenderEditable || render is RenderParagraph) {
        result = render as RenderBox;
        return;
      }
      render.visitChildren(visit);
    }

    visit(root);
    return result?.hasSize == true ? result : null;
  }

  Offset _caret(RenderBox render, int offset) {
    final position = TextPosition(offset: offset);
    return render is RenderEditable
        ? render.getLocalRectForCaret(position).topLeft
        : (render as RenderParagraph).getOffsetForCaret(position, Rect.zero);
  }

  ReaderReadingAnchor? _captureReadingAnchor() {
    if (_restoringPosition || !_scroll.hasClients || c.current == null) {
      return null;
    }
    final viewport = _readingViewport.currentContext?.findRenderObject();
    if (viewport is! RenderBox || !viewport.hasSize) return null;
    final top = viewport.localToGlobal(Offset.zero).dy;
    final bottom = top + viewport.size.height;
    for (final node in _readingNodes.values) {
      final render = _textRender(node);
      if (render == null) continue;
      final origin = render.localToGlobal(Offset.zero);
      if (origin.dy + render.size.height <= top || origin.dy >= bottom) {
        continue;
      }
      if (node.pageText.length > 65536) return null;
      final point = Offset(
        origin.dx + 2,
        (top + 10).clamp(origin.dy, origin.dy + render.size.height - 1),
      );
      final position = render is RenderEditable
          ? render.getPositionForPoint(point)
          : (render as RenderParagraph).getPositionForOffset(
              render.globalToLocal(point),
            );
      final offset = position.offset.clamp(0, node.text.length);
      return ReaderReadingAnchor(
        revision: node.revision,
        pageText: node.pageText,
        sourceOffset: node.start + offset,
        segmentStart: node.start,
        segmentEnd: node.start + node.text.length,
        viewportY: render.localToGlobal(_caret(render, offset)).dy - top,
      );
    }
    return null;
  }

  void _preserveReadingAnchor() {
    if (!mounted ||
        c.loading ||
        c.current == null ||
        _restoringPosition ||
        _pendingReadingAnchor != null) {
      return;
    }
    final anchor = c.readingAnchor ?? _captureReadingAnchor();
    if (anchor == null) return;
    _pendingReadingAnchor = anchor;
    _restoringPosition = true;
    final scope = c.scope, epoch = ++_readingRestoreEpoch;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || epoch != _readingRestoreEpoch) return;
      final pending = _pendingReadingAnchor;
      _pendingReadingAnchor = null;
      if (scope == c.scope && !c.loading && pending != null) {
        _restoreReadingAnchor(pending);
      }
      _restoringPosition = false;
    });
  }

  void _syncReadingPage() {
    // Continuous scrolling does not update the pagination cursor. When the
    // layout changes or a saved reader opens in paged mode, render the source
    // page before attempting to restore its text coordinates.
    final anchor =
        _pendingReadingAnchor ?? (_restoringPosition ? c.readingAnchor : null);
    if (anchor == null ||
        _appearance.readingMode != 'paged' ||
        !_personal.loaded ||
        _personal.scope != c.scope)
      return;
    final index =
        c.current?.pages.indexWhere(
          (page) => page.revision == anchor.revision,
        ) ??
        -1;
    if (index >= 0 && index != _personal.page) {
      unawaited(_personal.update({'page': index}));
    }
  }

  void _restoreReadingAnchor(ReaderReadingAnchor anchor) {
    if (!_scroll.hasClients) return;
    // The first frame can precede the local pagination cursor. Keep the saved
    // source until that read notifies _readerChanged and selects its page.
    if (_appearance.readingMode == 'paged' && !_personal.loaded) return;
    final page = c.current?.pages
        .where((p) => p.revision == anchor.revision)
        .firstOrNull;
    final sourceOffset = page == null ? null : anchor.resolve(page.text);
    final viewport = _readingViewport.currentContext?.findRenderObject();
    if (sourceOffset != null && viewport is RenderBox && viewport.hasSize) {
      final top = viewport.localToGlobal(Offset.zero).dy;
      for (final node in _readingNodes.values) {
        if (node.revision != anchor.revision ||
            node.pageText != page!.text ||
            sourceOffset < node.start ||
            sourceOffset > node.start + node.text.length) {
          continue;
        }
        final render = _textRender(node);
        if (render == null) continue;
        final caret = render
            .localToGlobal(_caret(render, sourceOffset - node.start))
            .dy;
        _scroll.jumpTo(
          (_scroll.offset + caret - top - anchor.viewportY).clamp(
            0,
            _scroll.position.maxScrollExtent,
          ),
        );
        unawaited(
          c.saveReading(
            position: _scroll.offset,
            anchor: anchor,
            updateAnchor: true,
          ),
        );
        _trackReadingPage(anchor);
        return;
      }
    }
    // Do not restore an unrelated page at the same old pixel or ordinal.
    _scroll.jumpTo(0);
    _trackRestoredReadingPage();
    unawaited(c.saveReading(position: 0, updateAnchor: true));
    _toast(
      _appearance.readingMode == 'paged'
          ? '原阅读位置的文字已变化或无法唯一定位，已回到当前页开头。'
          : '原阅读位置的文字已变化或无法唯一定位，已回到当前分支开头。',
    );
  }
}
