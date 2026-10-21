import 'package:flutter/material.dart';

import 'experience_models.dart';
import 'reader_information_display.dart';
import 'reader_page_context.dart';

/// Presentation of committed public snapshots, never an interpretation of events.
String readerNotebookSummary(ReaderPageContext page) {
  if (!page.available) return '本页资料未留存';
  if (!page.comparisonAvailable) return '本页记载 · ${page.information.length} 条';
  if (page.comparedRevision == null) {
    return '开场记载 · ${page.information.length} 条';
  }
  final updated = page.changes.where((change) => change.isUpdate).length;
  final added = page.changes.length - updated;
  if (page.changes.isEmpty) return '本页资料未变';
  return [
    if (added > 0) '$added 条新记',
    if (updated > 0) '$updated 条更新',
  ].join(' · ');
}

class ReaderNotebookDoorway extends StatelessWidget {
  const ReaderNotebookDoorway({
    super.key,
    required this.page,
    required this.onOpen,
  });
  final ReaderPageContext page;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 8),
      child: TextButton(
        key: ValueKey('notebook-page-${page.page.revision}'),
        onPressed: onOpen,
        style: TextButton.styleFrom(
          alignment: Alignment.centerLeft,
          foregroundColor: colors.onSurfaceVariant,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          side: BorderSide(color: colors.outlineVariant),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: Row(
          children: [
            const Icon(Icons.notes_rounded, size: 17),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '页边记事 · ${readerNotebookSummary(page)}',
                style: const TextStyle(fontSize: 12),
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, size: 17),
          ],
        ),
      ),
    );
  }
}

class ReaderNotebook extends StatefulWidget {
  const ReaderNotebook({
    super.key,
    required this.index,
    required this.page,
    required this.latestRevision,
    required this.onInspect,
    required this.onSource,
    required this.onAllInformation,
    this.onClose,
  });
  final ReaderPageContextIndex index;
  final ReaderPageContext page;
  final int latestRevision;
  final ValueChanged<KnownInformation> onInspect;
  final ValueChanged<int> onSource;
  final VoidCallback onAllInformation;
  final VoidCallback? onClose;

  @override
  State<ReaderNotebook> createState() => _ReaderNotebookState();
}

class _ReaderNotebookState extends State<ReaderNotebook> {
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), page = widget.page;
    final colors = theme.colorScheme;
    final all = _all || !page.comparisonAvailable;
    final items = all
        ? page.information
        : page.changes.map((change) => change.item).toList();
    final changes = {for (final change in page.changes) change.item.id: change};
    final revision = page.page.revision;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 22, 14, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '第 $revision 页',
                      key: const ValueKey('reader-notebook-scope'),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: colors.primary,
                        letterSpacing: 1.4,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      '页边记事',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontFamily: 'NotoSerifSC',
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              if (widget.onClose != null)
                IconButton(
                  tooltip: '关闭页边记事',
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 20),
                )
              else
                Tooltip(
                  message: '随正在阅读的页展开',
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Icon(
                      Icons.auto_stories_outlined,
                      size: 20,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              ChoiceChip(
                label: Text(
                  page.comparedRevision == null && page.comparisonAvailable
                      ? '开场记载'
                      : '本页新记 · ${page.changes.length}',
                ),
                selected: !all,
                onSelected: page.comparisonAvailable
                    ? (_) => setState(() => _all = false)
                    : null,
              ),
              ChoiceChip(
                label: Text('截至此页 · ${page.information.length}'),
                selected: all,
                onSelected: (_) => setState(() => _all = true),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Divider(height: 1, color: colors.outlineVariant),
        Expanded(
          child: !page.available
              ? _NotebookMessage(
                  text: '这一页没有保存资料快照。',
                  detail: '原文仍可阅读；这里不以之后的资料补写。',
                )
              : items.isEmpty
              ? _NotebookMessage(
                  text: all ? '截至这一页，尚无公开记载。' : '这一页没有新增或更新的公开资料。',
                  detail: all ? '故事从正文继续。' : '正文可以带来新的上下文，已有记载仍可在“截至此页”查阅。',
                )
              : ListView.builder(
                  key: ValueKey('notebook-list-$revision-$all'),
                  padding: const EdgeInsets.fromLTRB(22, 4, 22, 22),
                  itemCount: items.length + 1,
                  itemBuilder: (context, i) {
                    if (i == 0) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        child: Text(
                          !page.comparisonAvailable
                              ? '缺少前页快照，暂不能比较新旧。'
                              : all
                              ? '保留到此页为止的公开记载。'
                              : page.comparedRevision == null
                              ? '从这些已知的事，走进故事。'
                              : '相较第 ${page.comparedRevision} 页的公开资料。',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                            height: 1.6,
                          ),
                        ),
                      );
                    }
                    final item = items[i - 1];
                    return _NotebookEntry(
                      key: ValueKey('notebook-entry-$revision-${item.id}'),
                      item: item,
                      before: changes[item.id]?.before,
                      comparedRevision: page.comparedRevision,
                      information: page.information,
                      related: () =>
                          widget.index.earlierRelated(item, revision: revision),
                      source: widget.index.appearanceOf(
                        item,
                        throughRevision: revision,
                      ),
                      onSource: widget.onSource,
                      onInspect: () => widget.onInspect(item),
                    );
                  },
                ),
        ),
        Divider(height: 1, color: colors.outlineVariant),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: TextButton.icon(
            onPressed: widget.onAllInformation,
            icon: const Icon(Icons.library_books_outlined, size: 16),
            label: Text(
              revision < widget.latestRevision
                  ? '最新资料 · 第 ${widget.latestRevision} 页'
                  : '查阅全部资料',
            ),
          ),
        ),
      ],
    );
  }
}

class _NotebookMessage extends StatelessWidget {
  const _NotebookMessage({required this.text, required this.detail});
  final String text, detail;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text, style: const TextStyle(height: 1.8)),
        const SizedBox(height: 12),
        Text(
          detail,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(height: 1.7),
        ),
      ],
    ),
  );
}

String readerNotebookKind(KnownInformation item) =>
    switch (item.kind) {
      'statement' => '人物说法',
      'belief' => '人物相信',
      'person' || 'character' => '人物',
      'location' || 'place' => '地点',
      'item' => '物品',
      'thread' || 'clue' => '线索',
      'rule' => '规则',
      'event' => '事件记载',
      'agreement' || 'schedule' => '约定',
      'resource' => '资源',
      'status' => '状态记载',
      _ => '记载',
    } +
    (item.isInitialEntityRecord ? ' · 初次记载' : '');

class _NotebookEntry extends StatefulWidget {
  const _NotebookEntry({
    super.key,
    required this.item,
    required this.before,
    required this.comparedRevision,
    required this.information,
    required this.related,
    required this.source,
    required this.onSource,
    required this.onInspect,
  });
  final KnownInformation item;
  final KnownInformation? before;
  final int? comparedRevision, source;
  final List<KnownInformation> information;
  final List<ReaderContextReference> Function() related;
  final ValueChanged<int> onSource;
  final VoidCallback onInspect;
  @override
  State<_NotebookEntry> createState() => _NotebookEntryState();
}

class _NotebookEntryState extends State<_NotebookEntry> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), item = widget.item;
    final colors = theme.colorScheme;
    final related = _expanded ? widget.related() : <ReaderContextReference>[];
    final name = item.name.trim().replaceFirst(RegExp(r'…$'), '');
    final showName = name.isNotEmpty && !item.text.trim().startsWith(name);
    final associated = widget.information
        .where((other) => item.relatedIds.contains(other.id))
        .where(
          (other) => const {
            'character',
            'person',
            'location',
            'item',
          }.contains(other.kind),
        )
        .map((other) => other.name)
        .toList();
    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: colors.outlineVariant)),
      ),
      padding: const EdgeInsets.only(bottom: 16),
      margin: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            expanded: _expanded,
            child: InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              borderRadius: BorderRadius.circular(5),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            readerNotebookKind(item),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                        ),
                        if (widget.before != null)
                          Text('更新', style: theme.textTheme.labelSmall),
                        const SizedBox(width: 6),
                        Icon(
                          _expanded ? Icons.expand_less : Icons.expand_more,
                          size: 17,
                          color: colors.onSurfaceVariant,
                        ),
                      ],
                    ),
                    if (showName) ...[
                      const SizedBox(height: 6),
                      Text(item.name, style: theme.textTheme.titleSmall),
                    ],
                    const SizedBox(height: 7),
                    Text(
                      item.text,
                      maxLines: _expanded ? null : 4,
                      overflow: _expanded ? null : TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(height: 1.75),
                    ),
                    if (associated.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        '关联 · ${associated.join('、')}',
                        maxLines: _expanded ? null : 2,
                        overflow: _expanded ? null : TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: colors.primary,
                          height: 1.6,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          if (_expanded) ...[
            if (item.status?.isNotEmpty == true) Text('状态：${item.status}'),
            if (item.certainty?.isNotEmpty == true)
              Text('确定性：${item.certainty}'),
            for (final field in item.fields)
              Text(
                '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
              ),
            if (item.isHistoricalFact && item.recordedRevision != null)
              Text(
                '建档版本 ${item.recordedRevision} · 不代表获知时间',
                style: theme.textTheme.bodySmall,
              ),
            if (widget.before != null) ...[
              const SizedBox(height: 14),
              _NotebookEarlier(
                label: '此前的同一条记录',
                item: widget.before!,
                revision: widget.comparedRevision,
                onSource: widget.onSource,
              ),
            ],
            if (related.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('相关的前文记载', style: theme.textTheme.labelMedium),
              const SizedBox(height: 6),
              for (final reference in related)
                _NotebookEarlier(
                  item: reference.item,
                  revision: reference.revision,
                  onSource: widget.onSource,
                ),
              Text(
                '按资料中已有的关联，列出至多三条。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              children: [
                TextButton(
                  onPressed: widget.onInspect,
                  child: const Text('完整资料'),
                ),
                if (widget.source != null)
                  TextButton(
                    onPressed: () => widget.onSource(widget.source!),
                    child: Text('回读第 ${widget.source} 页'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _NotebookEarlier extends StatelessWidget {
  const _NotebookEarlier({
    required this.item,
    required this.revision,
    required this.onSource,
    this.label,
  });
  final KnownInformation item;
  final int? revision;
  final String? label;
  final ValueChanged<int> onSource;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.colorScheme.outlineVariant, width: 2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label ?? readerNotebookKind(item),
            style: theme.textTheme.labelSmall,
          ),
          const SizedBox(height: 5),
          SelectableText(
            item.text,
            style: theme.textTheme.bodySmall?.copyWith(height: 1.8),
          ),
          if (item.status?.isNotEmpty == true) Text('状态：${item.status}'),
          if (item.certainty?.isNotEmpty == true) Text('确定性：${item.certainty}'),
          for (final field in item.fields)
            Text(
              '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
              style: theme.textTheme.bodySmall,
            ),
          if (revision != null)
            TextButton(
              onPressed: () => onSource(revision!),
              child: Text('第 $revision 页的记载 ↗'),
            ),
        ],
      ),
    );
  }
}
