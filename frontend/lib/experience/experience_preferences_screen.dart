/// Account preferences: one keyed writer, exact read state, local conflict draft.
library;

import 'package:flutter/material.dart';
import 'experience_client.dart';
import 'experience_controller.dart';
import 'experience_models.dart';
import 'experience_journal.dart';
import 'experience_edit_dialog.dart';
import 'experience_feedback_panel.dart';

class ExperiencePreferencesScreen extends StatefulWidget {
  const ExperiencePreferencesScreen({super.key, required this.controller});
  final ExperienceController controller;
  @override
  State<ExperiencePreferencesScreen> createState() =>
      _ExperiencePreferencesScreenState();
}

class _ExperiencePreferencesScreenState
    extends State<ExperiencePreferencesScreen> {
  List<ContentPreference> _values = [];
  bool _loading = true, _busy = false, _checked = false, _localReady = false;
  String? _error, _owner;
  Json? _pending;
  ExperienceController get c => widget.controller;
  String get _scope => experienceScope(
    c.session.backendUrl,
    c.session.workspaceId,
    'preferences',
    'pending',
  );

  @override
  void initState() {
    super.initState();
    c.session.addListener(_session);
    _load();
  }

  void _session() {
    if (_owner != c.owner) {
      _values = [];
      _pending = null;
      _busy = false;
      _checked = false;
      _localReady = false;
      _load();
    } else if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    c.session.removeListener(_session);
    super.dispose();
  }

  Future<void> _load() async {
    final owner = c.owner, scope = _scope;
    _owner = owner;
    if (!c.workspaceAvailable) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    if (mounted) {
      setState(() {
        _loading = true;
        _checked = false;
        _localReady = false;
      });
    }
    try {
      // Local conflict draft is read BEFORE the server state, so a reload never
      // silently discards the user's unsent sentence or its original read state.
      final saved = await c.journal.read(scope);
      final values = await c.api.preferences();
      if (mounted && c.owner == owner) {
        setState(() {
          _values = values;
          _pending = saved['change'] == null ? null : object(saved['change']);
          _localReady = true;
          _checked = true;
          _loading = false;
          _error = null;
        });
      }
    } catch (_) {
      if (mounted && c.owner == owner) {
        setState(() {
          _error = '偏好或待确认草稿读取失败。不显示为空，也不覆盖旧稿；请重试读取。';
          _loading = false;
        });
      }
    }
  }

  ContentPreference? _find(String dimension) =>
      _values.where((p) => p.dimension == dimension).firstOrNull;

  Future<void> _put(Json change, {bool confirmedPending = false}) async {
    if (_busy ||
        !_localReady ||
        _pending != null && !confirmedPending ||
        confirmedPending && (!_checked || _loading)) {
      return;
    }
    final owner = c.owner, scope = _scope;
    setState(() {
      _pending = {...change};
      _busy = true;
      _error = null;
    });
    try {
      // Persist the sentence and its exact expected read state before the write.
      await c.journal.patch(scope, {'change': change});
      // A backend switch while persistence yields must not send the old draft
      // into the new backend's workspace. Leave it for explicit review.
      if (!mounted || c.owner != owner) return;
      c.invalidatePreparation();
      final result = await c.api.changePreference(change);
      await c.journal.patch(scope, {'change': null});
      if (mounted && c.owner == owner) {
        setState(() {
          _values = result;
          _pending = null;
          _checked = true;
        });
      }
    } catch (e) {
      final conflict =
          e is ExperienceHttpException &&
          (e.code == 'preference_conflict' || e.status == 409);
      if (mounted && c.owner == owner) {
        setState(() {
          _checked =
              false; // Unknown/conflict requires a fresh read before confirmation.
          _error = conflict
              ? '这个维度已被另一设备修改，本次没有写入。草稿与原读取状态保留，'
                    '请先重新读取核对，再明确决定；不会自动用新版本覆盖。'
              : '保存结果未确认。草稿与原读取状态保留；请重新读取核对，'
                    '未知结果不会显示为成功，也不会自动重试或覆盖。';
        });
      }
    } finally {
      if (mounted && c.owner == owner) setState(() => _busy = false);
    }
  }

  Future<void> _edit([
    ContentPreference? before,
    String? expression,
    Json? proposal,
  ]) async {
    final owner = c.owner;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => ExperienceEditDialog(
        title: proposal == null ? '我明确希望的内容' : '纠正并确认模型提议',
        description: proposal == null
            ? '只修改点名维度；你的原话可直接保存，无需模型。旧推测被本次明确表达同维度替代，'
                  '其他记录来源不变。不改变已有故事，也不是现实人格判断。'
            : '这不是你的原话，只是可纠正的模型措辞。保存即表示你明确确认今后口味；'
                  '原反馈与「经你确认的模型措辞」会分别保留。偏好不保证愿望成功。',
        firstLabel: '维度，例如题材、节奏、避免内容',
        first:
            before?.dimension ?? (proposal?['dimension'] as String? ?? '内容风格'),
        firstReadOnly: before != null,
        secondLabel: proposal == null ? '我的表达' : '我确认的措辞',
        second:
            proposal?['value'] as String? ?? expression ?? before?.value ?? '',
        confirmLabel: '保存明确偏好',
      ),
    );
    if (result == null || !mounted || c.owner != owner) return;
    final dimension = before?.dimension ?? result['first']!;
    final value = result['second']!;
    if (value.trim().isEmpty) {
      setState(() => _error = '表达为空时请用删除按钮明确移除该维度；本次未发送。');
      return;
    }
    await _put({
      'dimension': dimension,
      'expected': _find(dimension)?.toJson(),
      'value': value,
      'expression': proposal == null ? value : expression!,
      'confirmation': proposal == null
          ? 'direct_expression'
          : 'accepted_model_draft',
    });
  }

  Future<void> _discard() async {
    final owner = c.owner;
    try {
      await c.journal.patch(_scope, {'change': null});
      if (mounted && c.owner == owner) setState(() => _pending = null);
    } catch (_) {
      if (mounted && c.owner == owner) {
        setState(() => _error = '待确认草稿未能从本机移除；原稿仍在，请重试。');
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('内容偏好与阅读外观')),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text('阅读外观', style: Theme.of(context).textTheme.titleLarge),
              SwitchListTile(
                title: const Text('深色阅读'),
                value: c.session.themeId == 'ink',
                onChanged: (value) =>
                    c.session.themeId = value ? 'ink' : 'mist',
              ),
              SwitchListTile(
                title: const Text('减少动态效果'),
                subtitle: const Text('系统要求减少动画时始终遵守'),
                value: c.session.reduceMotion,
                onChanged: (value) => c.session.reduceMotion = value,
              ),
              const SizedBox(height: 24),
              Text('本地工作区内容偏好', style: Theme.of(context).textTheme.titleLarge),
              if (c.session.appearanceError != null)
                Text(c.session.appearanceError!),
              const Text(
                '未知保持未知，不强行填满，也不从一个题材标签推断其他口味。'
                '可以从空白开始，不从创作seed、角色对白或虚构行动推断现实人格。'
                '每次只修改点名维度，不需要先填问卷。',
              ),
              if (!c.workspaceAvailable) const Text('本地工作区暂不可用。'),
              if (_loading) const Text('正在读取…'),
              if (_error != null)
                Semantics(liveRegion: true, child: Text(_error!)),
              if (c.workspaceAvailable) ...[
                TextButton(
                  onPressed: _busy ? null : _load,
                  child: const Text('重新读取 / 核对保存'),
                ),
                if (!_loading && _error == null && _values.isEmpty)
                  const Text('还没有内容偏好。这是合法起点。'),
                if (_pending != null) ...[
                  SelectableText(
                    '保留的待确认草稿：${_pending!['dimension']}\n'
                    '拟保存：${_pending!['value'] ?? '明确移除该维度'}\n'
                    '原表达：${_pending!['expression'] ?? ''}',
                  ),
                  const Text(
                    '上方/下方列表是服务器当前状态。重新读取不会覆盖草稿。'
                    '只有你核对后才可改用当前版本重交。',
                  ),
                  TextButton(
                    onPressed: _busy || !_checked
                        ? null
                        : () => _put({
                            ..._pending!,
                            'expected': _find(
                              _pending!['dimension'] as String,
                            )?.toJson(),
                          }, confirmedPending: true),
                    child: const Text('核对后以当前版本保存草稿'),
                  ),
                  TextButton(
                    onPressed: _busy ? null : _discard,
                    child: const Text('明确移除本机待确认草稿'),
                  ),
                ],
                for (final item in _values)
                  ListTile(
                    title: Text(item.dimension),
                    subtitle: Text(
                      '${item.value}\n'
                      '${item.source == 'explicit' ? '明确表达' : '服务端推断'} · '
                      '${preferenceEvidenceLabel(item.evidence)}',
                    ),
                    onTap: _busy || _pending != null || _loading
                        ? null
                        : () => _edit(item),
                    trailing: IconButton(
                      tooltip: '移除 ${item.dimension}',
                      onPressed: _busy || _pending != null || _loading
                          ? null
                          : () => _put({
                              'dimension': item.dimension,
                              'expected': item.toJson(),
                              'value': null,
                            }),
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ),
                FilledButton(
                  onPressed:
                      _busy || _pending != null || !_localReady || _loading
                      ? null
                      : () => _edit(),
                  child: const Text('添加明确内容偏好'),
                ),
                const SizedBox(height: 24),
                ExperienceFeedbackPanel(
                  key: ValueKey(c.owner),
                  controller: c,
                  onLongTerm: (text, proposal) async {
                    if (_busy || _pending != null || !_localReady || _loading) {
                      return;
                    }
                    await _edit(null, text, proposal);
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}
