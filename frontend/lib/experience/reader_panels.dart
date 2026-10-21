import '../portal/portal_icon.dart';
import 'package:flutter/material.dart';
import 'experience_models.dart';
import 'reader_information_display.dart';
import 'reader_local_state.dart';
import '../portal/portal_preferences.dart';

const readerToolLabels = <String, String>{
  'time': '安排一段时间',
  'participation': '参与方式',
  'information': '故事资料',
  'around': '周围',
  'map': '地图与路线',
  'inventory': '身上与物品',
  'clues': '线索',
  'status': '状态与规则',
  'history': '回顾与搜索',
  'branches': '分支与存档',
  'notes': '书签与笔记',
  'journal': '手记与打算',
  'timeline': '时间线',
  'comparison': '对照经历与变化',
  'export': '导出正文',
  'preferences': '显示设置',
  'storyPreferences': '内容偏好',
  'reuse': '复用上次表达',
  'undoReuse': '恢复复用前草稿',
  'repair': '指出错误',
  'polish': '换种写法',
  'undoPolish': '撤销最近一次润色',
  'regenerate': '重新生成',
  'finish': '让这段故事合理收束',
  'world': '查看公开设定',
  'rewrite': '改写世界设定',
  'author': '作者视图 · 可能剧透',
  'artifact': '交互作品',
  'feedback': '记录问题',
  'help': '帮助',
  'leave': '今天先到这里',
};

class ReaderPanel extends StatelessWidget {
  const ReaderPanel({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          IconButton(
            tooltip: '关闭',
            onPressed: () => Navigator.pop(context),
            icon: const PortalIcon('close'),
          ),
        ],
      ),
      const SizedBox(height: 12),
      ...children,
    ],
  );
}

class ReaderInformationBrowser extends StatefulWidget {
  const ReaderInformationBrowser({
    super.key,
    required this.information,
    required this.onInspect,
    required this.onEdit,
    required this.onDraft,
    this.initialSelected = const [],
    this.onSelection,
    this.onContext,
    this.allowSubmission = true,
  });
  final List<KnownInformation> information;
  final ValueChanged<KnownInformation> onInspect, onEdit;
  final ValueChanged<List<KnownInformation>> onDraft;
  final List<String> initialSelected;
  final ValueChanged<List<String>>? onSelection;
  final VoidCallback? onContext;
  final bool allowSubmission;
  @override
  State<ReaderInformationBrowser> createState() =>
      _ReaderInformationBrowserState();
}

class _ReaderInformationBrowserState extends State<ReaderInformationBrowser> {
  String details(KnownInformation item) => [
    item.displaySummary,
    if (item.sourceVersion != null) '来源：第 ${item.sourceVersion} 页',
    if (item.relatedIds.isNotEmpty)
      '${item.associationLabel}：${item.relatedNames(widget.information)}',
    if (item.status?.isNotEmpty == true) item.status!,
    for (final field in item.fields)
      '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
  ].join('\n');
  String query = '', category = 'all', display = 'cards';
  bool descending = false, showText = true, showKind = true, comparing = false;
  late final selected = widget.initialSelected.toSet();
  void select(String id, bool value) {
    if (value && !selected.contains(id) && selected.length >= 4) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('最多选择四条不同资料。')));
      return;
    }
    setState(() {
      if (value) {
        selected.add(id);
      } else {
        selected.remove(id);
      }
    });
    widget.onSelection?.call(selected.toList());
  }

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
    'event': '事件',
    'agreement': '约定',
    'status': '状态',
    'resource': '资源',
  };
  @override
  Widget build(BuildContext context) {
    final items =
        widget.information
            .where(
              (i) =>
                  (category == 'all' ||
                      i.kind == category ||
                      category == 'person' && i.kind == 'character') &&
                  '${i.name} ${i.text}'.toLowerCase().contains(
                    query.trim().toLowerCase(),
                  ),
            )
            .toList()
          ..sort((a, b) => (descending ? -1 : 1) * a.name.compareTo(b.name));
    final picked = widget.information
        .where((i) => selected.contains(i.id))
        .toList();
    Widget actions(KnownInformation item) => Wrap(
      spacing: 8,
      children: [
        TextButton(
          onPressed: () => widget.onInspect(item),
          child: const Text('查看记录与来历'),
        ),
        FilterChip(
          label: Text(widget.allowSubmission ? '关联下次输入' : '选择资料'),
          selected: selected.contains(item.id),
          onSelected: (v) => select(item.id, v),
        ),
        if (widget.allowSubmission &&
            const {'fact', 'rule', 'statement', 'belief'}.contains(item.kind))
          TextButton(
            onPressed: () => widget.onEdit(item),
            child: const Text('明确编辑设定（另开分支）'),
          ),
      ],
    );
    return ReaderPanel(
      title: '已知资料',
      children: [
        const Text('查阅不会推进故事，未发送的草稿保留。'),
        if (widget.onContext != null)
          TextButton(
            onPressed: widget.onContext,
            child: const Text('关系、时间与资料对照'),
          ),
        TextField(
          key: const ValueKey('reader-information-search'),
          decoration: const InputDecoration(
            labelText: '搜索人物、地点、原话……',
            prefixIcon: PortalIcon('search'),
          ),
          onChanged: (v) => setState(() => query = v),
        ),
        Wrap(
          spacing: 6,
          children: [
            for (final e in {
              'all': '全部',
              'person': '人物',
              'location': '地点',
              'item': '物品',
              'fact': '事实',
              'rule': '规则',
              'clue': '线索',
              'agreement': '约定',
              'resource': '资源',
            }.entries)
              ChoiceChip(
                label: Text(e.value),
                selected: category == e.key,
                onSelected: (_) => setState(() => category = e.key),
              ),
          ],
        ),
        ExpansionTile(
          title: const Text('调整呈现'),
          children: [
            Wrap(
              spacing: 8,
              children: [
                for (final e in {
                  'cards': '卡片',
                  'table': '表格',
                  'text': '文字摘要',
                }.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: display == e.key,
                    onSelected: (_) => setState(() => display = e.key),
                  ),
              ],
            ),
            SwitchListTile(
              title: const Text('名称倒序'),
              value: descending,
              onChanged: (v) => setState(() => descending = v),
            ),
            CheckboxListTile(
              title: const Text('显示类别'),
              value: showKind,
              onChanged: (v) => setState(() => showKind = v!),
            ),
            CheckboxListTile(
              title: const Text('显示情况摘要'),
              value: showText,
              onChanged: (v) => setState(() => showText = v!),
            ),
          ],
        ),
        if (picked.isNotEmpty)
          Wrap(
            spacing: 8,
            children: [
              Text('已关联 ${picked.length} 条资料'),
              TextButton(
                onPressed: () => setState(() => comparing = !comparing),
                child: const Text('比较已选'),
              ),
              if (widget.allowSubmission)
                TextButton(
                  onPressed: () => widget.onDraft(picked),
                  child: const Text('围绕已选起草'),
                ),
              TextButton(
                onPressed: () => setState(() {
                  selected.clear();
                  widget.onSelection?.call([]);
                  comparing = false;
                }),
                child: const Text('清除选择'),
              ),
            ],
          ),
        if (comparing && picked.isNotEmpty)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: [
                const DataColumn(label: Text('项目')),
                for (final i in picked) DataColumn(label: Text(i.name)),
              ],
              rows: [
                DataRow(
                  cells: [
                    const DataCell(Text('类别')),
                    for (final i in picked)
                      DataCell(Text(names[i.kind] ?? i.kind)),
                  ],
                ),
                DataRow(
                  cells: [
                    const DataCell(Text('已知情况')),
                    for (final i in picked)
                      DataCell(SizedBox(width: 240, child: Text(details(i)))),
                  ],
                ),
              ],
            ),
          ),
        Text('${items.length} 条已知记录'),
        if (items.isEmpty) const Text('没有匹配的公开资料。'),
        if (display == 'table' && items.isNotEmpty)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: [
                const DataColumn(label: Text('对象')),
                if (showKind) const DataColumn(label: Text('类别')),
                if (showText) const DataColumn(label: Text('已知情况')),
              ],
              rows: [
                for (final i in items)
                  DataRow(
                    selected: selected.contains(i.id),
                    onSelectChanged: (v) => select(i.id, v == true),
                    cells: [
                      DataCell(
                        TextButton(
                          onPressed: () => widget.onInspect(i),
                          child: Text(i.name),
                        ),
                      ),
                      if (showKind) DataCell(Text(names[i.kind] ?? i.kind)),
                      if (showText)
                        DataCell(SizedBox(width: 280, child: Text(details(i)))),
                    ],
                  ),
              ],
            ),
          )
        else
          for (final i in items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${showKind ? '${names[i.kind] ?? i.kind} · ' : ''}${i.name}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  if (showText && i.recordHeading != null)
                    Text(i.recordHeading!),
                  if (showText) SelectableText(i.text),
                  if (showText && i.relatedIds.isNotEmpty)
                    Text(
                      '${i.associationLabel}：${i.relatedNames(widget.information)}',
                    ),
                  if (showText && i.status?.isNotEmpty == true) Text(i.status!),
                  if (showText)
                    for (final field in i.fields)
                      Text(
                        '${field['label'] ?? field['key']}：${field['value'] ?? '未明确'}',
                      ),
                  actions(i),
                ],
              ),
            ),
      ],
    );
  }
}

class ReaderAppearancePanel extends StatelessWidget {
  const ReaderAppearancePanel({
    super.key,
    required this.preferences,
    required this.onStoryPreferences,
  });
  final PortalPreferences preferences;
  final VoidCallback onStoryPreferences;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: preferences,
    builder: (context, _) {
      final p = preferences;
      Widget choices(String label, String key, Map<String, String> choices) =>
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final e in choices.entries)
                      ChoiceChip(
                        label: Text(e.value),
                        selected: p.text(key) == e.key,
                        onSelected: (_) => p.setValue(key, e.key),
                      ),
                  ],
                ),
              ],
            ),
          );
      Widget slider(
        String label,
        String key,
        double min,
        double max,
        int divisions,
      ) => Column(
        children: [
          Row(
            children: [
              Text(label),
              const Spacer(),
              Text(p.number(key).toStringAsFixed(key == 'lineHeight' ? 2 : 0)),
            ],
          ),
          Slider(
            value: p.number(key),
            min: min,
            max: max,
            divisions: divisions,
            semanticFormatterCallback: (v) => '$label $v',
            onChanged: (v) => p.setValue(key, v),
          ),
        ],
      );
      return ReaderPanel(
        title: '显示设置',
        children: [
          const Text('阅读外观即时生效，自动保存。'),
          if (p.error != null)
            ListTile(
              title: Text(p.error!),
              trailing: TextButton(onPressed: p.retry, child: const Text('重试')),
            ),
          choices('阅读主题', 'readingTheme', {
            'paper': '纸张',
            'white': '柔白',
            'sage': '浅绿',
            'night': '夜间',
          }),
          slider('正文字号', 'fontSize', 16, 30, 14),
          Wrap(
            spacing: 8,
            children: [
              for (final e in {1.6: '紧凑', 1.95: '适中', 2.3: '宽松'}.entries)
                ChoiceChip(
                  label: Text('行距 · ${e.value}'),
                  selected: p.lineHeight == e.key,
                  onSelected: (_) => p.setValue('lineHeight', e.key),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Text(
              '雨停了，窗外传来轻轻的脚步声。你翻开书，故事从这里继续。',
              style: TextStyle(fontSize: p.fontSize, height: p.lineHeight),
            ),
          ),
          ExpansionTile(
            title: const Text('字体与精细排版'),
            children: [
              choices('字体', 'fontFamily', {
                'serif': '宋体／衬线',
                'sans': '黑体／无衬线',
                'system': '系统字体',
              }),
              choices('段落间距', 'paragraphGap', {
                'compact': '紧凑',
                'normal': '适中',
                'wide': '宽松',
              }),
              slider('行距', 'lineHeight', 1.5, 2.5, 20),
              slider('正文宽度', 'width', 480, 880, 20),
              choices('阅读方式', 'readingMode', {
                'continuous': '连续滚动',
                'paged': '按回合翻页',
              }),
              choices('界面明暗', 'theme', {
                'light': '浅色',
                'dark': '深色',
                'system': '跟随系统',
              }),
            ],
          ),
          for (final e in {
            'showTime': '显示故事时间',
            'restReminder': '阅读半小时提醒休息',
            'reducedMotion': '减少动画',
            'sendEnter': 'Enter 发送',
          }.entries)
            SwitchListTile(
              title: Text(e.value),
              value: p.enabled(e.key),
              onChanged: (v) => p.setValue(e.key, v),
            ),
          const Text('默认 Enter 换行，Ctrl / ⌘ + Enter 发送。中文输入法确认候选不会发送。'),
          TextButton(onPressed: p.resetReading, child: const Text('恢复默认外观')),
          TextButton(
            onPressed: onStoryPreferences,
            child: const Text('这段故事的内容偏好'),
          ),
        ],
      );
    },
  );
}

class ReaderHistoryPanel extends StatefulWidget {
  const ReaderHistoryPanel({
    super.key,
    required this.view,
    required this.onJump,
    required this.onFork,
    required this.onBookmark,
    required this.onBranch,
    required this.onExport,
    required this.onSnapshot,
    required this.onCopy,
    required this.blocked,
  });
  final ExperienceView view;
  final ValueChanged<int> onJump, onFork, onSnapshot;
  final ValueChanged<ExperiencePage> onBookmark;
  final ValueChanged<String> onBranch;
  final VoidCallback onExport, onCopy;
  final bool blocked;
  @override
  State<ReaderHistoryPanel> createState() => _ReaderHistoryPanelState();
}

class _ReaderHistoryPanelState extends State<ReaderHistoryPanel> {
  String query = '';
  int from = 0;
  int? to;
  @override
  Widget build(BuildContext context) {
    final v = widget.view, pages = v.pages;
    final last = to ?? (pages.isEmpty ? 0 : pages.last.revision);
    final found = pages.where(
      (p) =>
          p.revision >= from &&
          p.revision <= last &&
          '${p.input}\n${p.text}'.toLowerCase().contains(
            query.trim().toLowerCase(),
          ),
    );
    Widget range(String label, int value, ValueChanged<int> changed) =>
        DropdownButtonFormField<int>(
          initialValue: value,
          decoration: InputDecoration(labelText: label),
          items: [
            const DropdownMenuItem(value: 0, child: Text('开场之前')),
            for (final p in pages)
              DropdownMenuItem(
                value: p.revision,
                child: Text('第 ${p.revision} 页'),
              ),
          ],
          onChanged: (v) {
            if (v != null) setState(() => changed(v));
          },
        );
    return ReaderPanel(
      title: '分支与历史位置',
      children: [
        const Text('切换只读取保存的原文；重选建立新分支，不覆盖过去。'),
        TextButton(
          onPressed: widget.onCopy,
          child: const Text('复制当前分支正文（Markdown）'),
        ),
        ExpansionTile(
          title: const Text('分支与存档'),
          children: [
            for (final b in v.branches)
              ListTile(
                title: Text(b.name),
                subtitle: Text(
                  '第 ${b.revision} 页${b.parentRevision == null ? '' : ' · 从第 ${b.parentRevision} 页分出'}',
                ),
                selected: b.id == v.branchId,
                onTap: () => widget.onBranch(b.id),
              ),
            TextButton(
              onPressed: widget.blocked ? null : () => widget.onFork(0),
              child: const Text('从开场之前重新选择'),
            ),
          ],
        ),
        TextField(
          key: const ValueKey('reader-history-search'),
          decoration: const InputDecoration(
            labelText: '搜索原文',
            hintText: '人物、地点或记得的一句话',
            prefixIcon: PortalIcon('search'),
          ),
          onChanged: (v) => setState(() => query = v),
        ),
        ExpansionTile(
          title: const Text('限定回合范围'),
          children: [
            range('从回合', from, (v) => from = v),
            range('到回合', last, (v) => to = v),
          ],
        ),
        Text('${found.length} 段记录'),
        if (found.isEmpty)
          Text(from > last ? '起始回合在结束回合之后，请调整回顾范围。' : '所选范围的已保存正文里没有匹配内容。'),
        for (final p in found)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '第 ${p.revision} 页 · ${p.storyTime}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (p.input.isNotEmpty)
                  Text(
                    p.input,
                    style: const TextStyle(fontStyle: FontStyle.italic),
                  ),
                Text(p.text, maxLines: 5, overflow: TextOverflow.ellipsis),
                Wrap(
                  spacing: 8,
                  children: [
                    TextButton(
                      onPressed: () => widget.onJump(p.revision),
                      child: const Text('回看原文'),
                    ),
                    TextButton(
                      onPressed: () => widget.onSnapshot(p.revision),
                      child: const Text('当时情况'),
                    ),
                    TextButton(
                      onPressed: () => widget.onBookmark(p),
                      child: const Text('加书签'),
                    ),
                    TextButton(
                      onPressed: widget.blocked
                          ? null
                          : () => widget.onFork(p.revision),
                      child: const Text('从这里分支'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        TextButton.icon(
          onPressed: widget.onExport,
          icon: const Icon(Icons.file_download_outlined),
          label: const Text('导出正文'),
        ),
      ],
    );
  }
}

class ReaderTimePanel extends StatefulWidget {
  const ReaderTimePanel({
    super.key,
    required this.onSubmit,
    required this.storyTime,
    required this.blocked,
  });
  final ValueChanged<String> onSubmit;
  final String storyTime;
  final bool blocked;
  @override
  State<ReaderTimePanel> createState() => _ReaderTimePanelState();
}

class _ReaderTimePanelState extends State<ReaderTimePanel> {
  String mode = 'short', error = '';
  final goal = TextEditingController(),
      limit = TextEditingController(),
      forbidden = TextEditingController(),
      reserved = TextEditingController();
  @override
  void dispose() {
    for (final c in [goal, limit, forbidden, reserved]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ReaderPanel(
    title: '安排一段时间',
    children: [
      Text(widget.storyTime.isEmpty ? '故事时间尚未明确' : widget.storyTime),
      Wrap(
        spacing: 8,
        children: [
          for (final e in {
            'short': '等一会儿',
            'until': '等到……',
            'skip': '略过一段',
          }.entries)
            ChoiceChip(
              label: Text(e.value),
              selected: mode == e.key,
              onSelected: (_) => setState(() => mode = e.key),
            ),
        ],
      ),
      if (mode == 'short')
        Wrap(
          spacing: 8,
          children: [
            for (final duration in ['片刻', '一会儿', '5分钟', '15分钟', '30分钟'])
              ActionChip(
                label: Text(duration),
                onPressed: () => goal.text = duration,
              ),
          ],
        ),
      TextField(
        controller: goal,
        decoration: InputDecoration(
          labelText: mode == 'short'
              ? '等多久'
              : mode == 'until'
              ? '等待的时刻或事情'
              : '怎样度过这段时间',
        ),
        maxLength: 1200,
      ),
      if (mode != 'short')
        TextField(
          controller: limit,
          decoration: const InputDecoration(
            labelText: '最晚到什么时候结束',
            hintText: '例如：最多三天',
          ),
          maxLength: 200,
        ),
      ExpansionTile(
        title: const Text('底线与要亲自决定的事'),
        children: [
          TextField(
            controller: forbidden,
            decoration: const InputDecoration(
              labelText: '这段时间不要做',
              hintText: '例如：不借钱、不离开店铺',
            ),
          ),
          TextField(
            controller: reserved,
            decoration: const InputDecoration(
              labelText: '这些情况交回给我',
              hintText: '重大承诺、借贷、关系表态或不可逆决定',
            ),
          ),
        ],
      ),
      const Text('只在这次明确的范围内安排时间；遇到保留的事情，请在决定前交回给你。'),
      if (error.isNotEmpty)
        Text(
          error,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      FilledButton(
        onPressed: widget.blocked
            ? null
            : () {
                try {
                  widget.onSubmit(
                    readerTimeInstruction(
                      mode: mode,
                      goal: goal.text,
                      limit: limit.text,
                      forbidden: forbidden.text,
                      reserved: reserved.text,
                    ),
                  );
                } on FormatException catch (e) {
                  setState(() => error = e.message);
                }
              },
        child: Text(mode == 'skip' ? '按这个范围略过' : '开始等待'),
      ),
    ],
  );
}
