/// Searches only the public projection already supplied by Go.
library;

import 'package:flutter/material.dart';
import 'experience_models.dart';

class ReaderInformationSheet extends StatefulWidget {
  const ReaderInformationSheet({
    super.key,
    required this.information,
    required this.onEdit,
    this.searchEnabled = true,
    this.allowEdit = true,
  });
  final List<KnownInformation> information;
  final ValueChanged<KnownInformation> onEdit;
  final bool searchEnabled;
  final bool allowEdit;

  @override
  State<ReaderInformationSheet> createState() => _ReaderInformationSheetState();
}

class _ReaderInformationSheetState extends State<ReaderInformationSheet> {
  String _query = '';
  int _category = 0;
  static const categories = ['全部', '人物', '地点', '物品', '见闻'];
  static const kinds = [
    <String>{},
    {'person', 'character'},
    {'location'},
    {'item'},
    {'fact', 'rule', 'statement', 'belief', 'thread', 'clue'},
  ];
  static const names = {
    'fact': '事实',
    'rule': '规则',
    'statement': '人物说法',
    'belief': '人物相信',
    'character': '人物',
    'person': '人物',
    'location': '地点',
    'item': '物品',
    'thread': '线索',
    'clue': '线索',
    'resource': '资源',
    'event': '事件',
    'agreement': '约定',
  };

  @override
  Widget build(BuildContext context) {
    final needle = _query.trim().toLowerCase();
    final items = widget.information
        .where(
          (item) =>
              (_category == 0 || kinds[_category].contains(item.kind)) &&
              (needle.isEmpty ||
                  '${item.name} ${item.text}'.toLowerCase().contains(needle)),
        )
        .toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '已知资料',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              IconButton(
                tooltip: '关闭资料',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          const Text('查阅不会推进故事，未发送的草稿保留。'),
          if (widget.searchEnabled) ...[
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('reader-information-search'),
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                labelText: '搜索人物、地点、原话……',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                for (var i = 0; i < categories.length; i++)
                  ChoiceChip(
                    label: Text(categories[i]),
                    selected: _category == i,
                    onSelected: (_) => setState(() => _category = i),
                  ),
              ],
            ),
            const Divider(),
          ],
          Expanded(
            child: ListView(
              children: [
                if (items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(
                      widget.information.isEmpty
                          ? '此位置尚无已知资料。世界仍有未定空间。'
                          : '没有匹配的公开资料。',
                    ),
                  ),
                for (final item in items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${names[item.kind] ?? item.kind} · ${item.name}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 6),
                        SelectableText(item.text, semanticsLabel: item.text),
                        if (item.status?.isNotEmpty == true) Text(item.status!),
                        for (final field in item.fields)
                          Text(
                            '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
                          ),
                        if (item.relatedIds.isNotEmpty)
                          Text(
                            '关联：${item.relatedIds.map((id) => widget.information.where((i) => i.id == id).map((i) => i.name).firstOrNull ?? '尚无公开资料').join('、')}',
                          ),
                        if (widget.allowEdit &&
                            const {
                              'fact',
                              'rule',
                              'secret',
                              'statement',
                              'belief',
                            }.contains(item.kind))
                          TextButton(
                            onPressed: () => widget.onEdit(item),
                            child: const Text('明确编辑设定（另开分支）'),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
