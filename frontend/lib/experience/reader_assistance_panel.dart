import 'package:flutter/material.dart';
import 'experience_models.dart';
import 'reader_panels.dart';

/// Assistance proposes a change; only the explicit adoption callback may fork.
class ReaderAssistancePanel extends StatefulWidget {
  const ReaderAssistancePanel({
    super.key,
    required this.kind,
    required this.branchId,
    required this.revision,
    required this.original,
    required this.initialRequest,
    required this.isCurrent,
    required this.onRequest,
    required this.onCancel,
    required this.onApply,
    required this.onDraft,
  });
  final String kind, branchId, original, initialRequest;
  final int revision;
  final bool Function() isCurrent;
  final Future<Json> Function(Json body) onRequest;
  final VoidCallback onCancel;
  final Future<void> Function(Json result) onApply;
  final ValueChanged<String> onDraft;
  @override
  State<ReaderAssistancePanel> createState() => _ReaderAssistancePanelState();
}

class _ReaderAssistancePanelState extends State<ReaderAssistancePanel> {
  late final input = TextEditingController(text: widget.initialRequest);
  bool busy = false, applying = false;
  int epoch = 0;
  Json? result;
  String? error;
  bool get repair => widget.kind == 'repair';
  void cancel() {
    ++epoch;
    widget.onCancel();
    if (mounted)
      setState(() {
        busy = false;
        error = '已取消，原有内容保持不变。';
      });
  }

  @override
  void dispose() {
    ++epoch;
    if (busy) widget.onCancel();
    input.dispose();
    super.dispose();
  }

  Future<void> request() async {
    final text = input.text.trim();
    if (text.isEmpty) {
      setState(() => error = '先写下你的要求。');
      return;
    }
    if (!widget.isCurrent()) {
      setState(() => error = '故事已经改变，请关闭后重新打开。');
      return;
    }
    final token = ++epoch;
    setState(() {
      busy = true;
      result = null;
      error = null;
    });
    try {
      final next = await widget.onRequest({
        'branch_id': widget.branchId,
        'expected_revision': widget.revision,
        'kind': widget.kind,
        'request': text,
      });
      if (!mounted || token != epoch) return;
      if (!widget.isCurrent() ||
          next['kind'] != widget.kind ||
          next['branch_id'] != widget.branchId ||
          next['base_revision'] != widget.revision)
        throw const FormatException('故事或回应的版本已改变，请重新检查。');
      if (next['text'] is! String || (next['text'] as String).trim().isEmpty)
        throw const FormatException('没有收到可审阅的内容。');
      if (next['proposal'] != null && next['proposal'] is! Map)
        throw const FormatException('修复提案格式不完整。');
      setState(() => result = next);
    } catch (e) {
      if (mounted && token == epoch)
        setState(
          () => error =
              '没有改变你的故事。${e is FormatException ? e.message : e.toString()}',
        );
    } finally {
      if (mounted && token == epoch) setState(() => busy = false);
    }
  }

  Future<void> apply() async {
    if (result == null || !widget.isCurrent()) {
      setState(() => error = '故事已经改变，请重新生成后再确认。');
      return;
    }
    setState(() {
      applying = true;
      error = null;
    });
    try {
      await widget.onApply(result!);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final proposal = result?['proposal'] is Map
        ? Map<String, dynamic>.from(result!['proposal'] as Map)
        : null;
    return ReaderPanel(
      title: repair ? '检查结果与修复提案' : '同一件事，另一种写法',
      children: [
        Text(
          repair
              ? '先检查原有记录并给出提案。你确认后才建立修复分支，原线完整保留。'
              : '只处理最后一轮正文，不改变事件、物品、关系或时间。采用前请核对事实；确认后保留原线并建立表达分支。',
        ),
        ExpansionTile(
          title: const Text('对照原有正文'),
          children: [SelectableText(widget.original)],
        ),
        TextField(
          controller: input,
          maxLength: repair ? 2000 : 8000,
          minLines: 3,
          maxLines: 8,
          enabled: !busy && !applying,
          decoration: const InputDecoration(labelText: '你的要求'),
          onChanged: widget.onDraft,
        ),
        Wrap(
          spacing: 8,
          children: [
            FilledButton(
              onPressed: busy || applying ? null : request,
              child: Text(
                result == null ? (repair ? '检查并提出修复' : '生成供我查看') : '按这些要求重新生成',
              ),
            ),
            if (busy)
              TextButton(onPressed: cancel, child: const Text('取消并保留原内容')),
          ],
        ),
        if (busy)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text('正在生成供你审阅的内容，故事尚未改变。'),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (result != null) ...[
          const Divider(),
          SelectableText(result!['text'] as String),
          if (proposal != null) ...[
            const SizedBox(height: 16),
            Text('修复后的正文', style: Theme.of(context).textTheme.titleMedium),
            SelectableText('${proposal['passage'] ?? ''}'),
            ExpansionTile(
              title: const Text('将提交的变更（作者审阅，可能剧透）'),
              children: [
                for (final fact in objects(proposal['new_facts'] ?? []))
                  ListTile(
                    title: Text('${fact['text'] ?? ''}'),
                    subtitle: Text(fact['known'] == true ? '公开事实' : '幕后事实'),
                  ),
                for (final entity in objects(proposal['new_entities'] ?? []))
                  ListTile(
                    title: Text('${entity['name'] ?? ''}'),
                    subtitle: Text(
                      '${entity['description'] ?? ''}${entity['known'] == true ? '' : '（幕后）'}',
                    ),
                  ),
                for (final thread in objects(proposal['new_threads'] ?? []))
                  ListTile(
                    title: Text('${thread['text'] ?? ''}'),
                    subtitle: Text(thread['known'] == true ? '公开线索' : '幕后线索'),
                  ),
                for (final entry in const {
                  'reveal_entity_ids': '揭示对象',
                  'reveal_fact_ids': '揭示事实',
                  'reveal_thread_ids': '揭示线索',
                  'resolve_thread_ids': '收束线索',
                  'knowledge_changes': '知情变化',
                }.entries)
                  if ((proposal[entry.key] as List? ?? []).isNotEmpty)
                    Text(
                      '${entry.value}：${(proposal[entry.key] as List).length} 项',
                    ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: applying ? null : () => Navigator.pop(context),
                child: const Text('关闭，保持原样'),
              ),
              if (!repair || proposal != null)
                FilledButton(
                  onPressed: busy || applying ? null : apply,
                  child: Text(
                    applying
                        ? '正在建立分支…'
                        : repair
                        ? '确认并建立修复分支'
                        : '确认只改表达',
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
