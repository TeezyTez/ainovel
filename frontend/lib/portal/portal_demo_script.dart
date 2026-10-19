/// The three fixed, offline demo stories from src/demo.js.
/// They are local previews and never claim to be Go-service story history.
library;

import 'dart:convert';

import 'package:flutter/material.dart';

import '../experience/experience_journal.dart';
import 'portal_demo_repository.dart';
import 'portal_icon.dart';
import 'portal_demo_script_data.dart';

class PortalDemoAction {
  const PortalDemoAction(this.id, this.text);
  final String id, text;
}

class PortalDemoTurn {
  const PortalDemoTurn({required this.input, required this.prose});
  final String input, prose;

  Map<String, dynamic> toJson() => {'input': input, 'prose': prose};

  factory PortalDemoTurn.fromJson(Object? source) {
    final data = source is Map
        ? Map<String, dynamic>.from(source)
        : const <String, dynamic>{};
    return PortalDemoTurn(
      input: data['input'] is String ? data['input'] as String : '',
      prose: data['prose'] is String ? data['prose'] as String : '',
    );
  }
}

class PortalDemoState {
  const PortalDemoState({
    this.step = 0,
    this.flags = const {},
    this.facts = const [],
    this.turns = const [],
  });

  final int step;
  final Map<String, String> flags;
  final List<String> facts;
  final List<PortalDemoTurn> turns;
  bool get ended => step >= 8;

  Map<String, dynamic> toJson() => {
    'step': step,
    'flags': flags,
    'facts': facts,
    'turns': turns.map((turn) => turn.toJson()).toList(),
  };

  factory PortalDemoState.fromJson(Object? source) {
    if (source is! Map) return const PortalDemoState();
    final data = Map<String, dynamic>.from(source);
    final step = data['step'];
    if (step is! int || step < 0 || step > 8) return const PortalDemoState();
    final flags = <String, String>{};
    if (data['flags'] is Map) {
      for (final entry in (data['flags'] as Map).entries) {
        if (entry.key is String && entry.value is String) {
          flags[entry.key as String] = entry.value as String;
        }
      }
    }
    final facts = data['facts'] is List
        ? (data['facts'] as List).whereType<String>().toList()
        : <String>[];
    final turns = data['turns'] is List
        ? (data['turns'] as List).map(PortalDemoTurn.fromJson).toList()
        : <PortalDemoTurn>[];
    if (turns.length != step) return const PortalDemoState();
    return PortalDemoState(
      step: step,
      flags: flags,
      facts: facts,
      turns: turns,
    );
  }
}

class PortalDemoScript {
  PortalDemoScript._();

  static final Map<String, dynamic> _worlds = Map<String, dynamic>.from(
    jsonDecode(portalDemoScriptJson) as Map,
  );

  static bool supports(String worldId) => _worlds.containsKey(worldId);

  static List<PortalDemoAction> actions(String worldId, PortalDemoState state) {
    if (!supports(worldId) || state.ended) return const [];
    final row = (_worlds[worldId] as List)[state.step] as Map;
    return [
      for (final raw in row['actions'] as List)
        if ((raw as Map)['id'] != 'continue')
          PortalDemoAction(raw['id'] as String, raw['text'] as String),
    ];
  }

  static PortalDemoState choose(
    String worldId,
    PortalDemoState state,
    String actionId,
  ) {
    if (!supports(worldId) || state.ended) {
      throw const FormatException('这段预设演示已结束。');
    }
    final row = (_worlds[worldId] as List)[state.step] as Map;
    final action = (row['actions'] as List)
        .cast<Map>()
        .where((entry) => entry['id'] == actionId)
        .firstOrNull;
    if (action == null) {
      throw const FormatException('请选择当前建议，或让场景继续。');
    }
    final contextKey = [
      state.flags['$worldId:approach'] ?? '',
      state.flags['$worldId:method'] ?? '',
      state.facts.any((fact) => fact.contains('自愿付款取走')) ? '1' : '0',
    ].join('|');
    final variant = action['variants'] is Map
        ? (action['variants'] as Map)[contextKey]
        : null;
    final result = variant is Map ? variant : action;
    final nextFlags = Map<String, String>.from(state.flags);
    final nextFacts = List<String>.of(state.facts);
    for (final raw in result['events'] as List) {
      final event = raw as Map;
      if (event['type'] == 'flag' &&
          event['entity'] is String &&
          event['value'] is String) {
        nextFlags[event['entity'] as String] = event['value'] as String;
      }
      if (event['type'] == 'fact' && event['value'] is String) {
        nextFacts.add(event['value'] as String);
      }
    }
    final input = actionId == 'continue'
        ? '让当前场景自然继续。'
        : action['text'] as String;
    return PortalDemoState(
      step: state.step + 1,
      flags: nextFlags,
      facts: nextFacts,
      turns: [
        ...state.turns,
        PortalDemoTurn(input: input, prose: result['prose'] as String),
      ],
    );
  }
}

class PortalDemoScriptPage extends StatefulWidget {
  const PortalDemoScriptPage({
    super.key,
    required this.worldId,
    required this.title,
    required this.opening,
    required this.journal,
    required this.scope,
    this.sessionId,
    this.onChanged,
  });

  final String worldId, title, opening, scope;
  final String? sessionId;
  final ExperienceJournal journal;
  final VoidCallback? onChanged;

  @override
  State<PortalDemoScriptPage> createState() => _PortalDemoScriptPageState();
}

class _PortalDemoScriptPageState extends State<PortalDemoScriptPage> {
  PortalDemoState _state = const PortalDemoState();
  bool _loading = true, _busy = false;
  bool _canAdvance = false;
  String? _error;
  PortalDemoRepository? _repository;

  @override
  void initState() {
    super.initState();
    try {
      _repository = PortalDemoRepository.fromSessionScope(
        journal: widget.journal,
        scope: widget.scope,
      );
      _load();
    } catch (_) {
      _loading = false;
      _error = '本机预设演示范围无效。可以阅读开场，但无法保存或推进。';
    }
  }

  Future<void> _load() async {
    try {
      final entry = widget.sessionId == null
          ? await _repository!.ensure(widget.worldId)
          : await _repository!.entry(widget.sessionId!);
      if (entry == null || entry.worldId != widget.worldId) {
        throw const FormatException('找不到这段预设演示');
      }
      if (!mounted) return;
      setState(() {
        _state = PortalDemoState.fromJson(entry.session);
        _loading = false;
        _canAdvance = true;
        _error = null;
      });
      widget.onChanged?.call();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _canAdvance = false;
        _error = '本机预设演示暂时无法读取。可以阅读开场，进度不会自动保存。';
      });
    }
  }

  Future<void> _choose(String actionId) async {
    if (_busy || _loading || !_canAdvance) return;
    final next = PortalDemoScript.choose(widget.worldId, _state, actionId);
    setState(() => _busy = true);
    try {
      await _repository!.saveState(
        widget.sessionId ?? widget.worldId,
        next.toJson(),
      );
      if (mounted) setState(() => _state = next);
      widget.onChanged?.call();
    } catch (_) {
      if (mounted) setState(() => _error = '这一步未能保存在本机，请重试。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _restart() async {
    if (!_canAdvance) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重新开始预设演示？'),
        content: const Text('仅重置这个本机预设演示；正式故事不受影响。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('返回'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('重新开始'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _repository!.saveState(
        widget.sessionId ?? widget.worldId,
        const PortalDemoState().toJson(),
      );
      if (mounted) setState(() => _state = const PortalDemoState());
      widget.onChanged?.call();
    } catch (_) {
      if (mounted) setState(() => _error = '本机预设演示重置失败，请重试。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        leading: IconButton(
          tooltip: '返回世界',
          onPressed: () => Navigator.pop(context),
          icon: const PortalIcon('back'),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                  child: Text(
                    '预设演示 · 固定剧情 · 仅保存在此设备，不属于正式生成故事',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Text(_error!, style: TextStyle(color: colors.error)),
                  ),
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
                          children: [
                            Text('开场', style: theme.textTheme.labelMedium),
                            const SizedBox(height: 10),
                            SelectableText(
                              widget.opening,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                fontFamily: 'NotoSerifSC',
                                height: 1.9,
                              ),
                            ),
                            for (var i = 0; i < _state.turns.length; i++) ...[
                              const SizedBox(height: 30),
                              Divider(color: colors.outlineVariant),
                              const SizedBox(height: 12),
                              Text(
                                '第 ${i + 1} 个片刻 · ${_state.turns[i].input}',
                                style: theme.textTheme.labelMedium,
                              ),
                              const SizedBox(height: 12),
                              SelectableText(
                                _state.turns[i].prose,
                                style: theme.textTheme.bodyLarge?.copyWith(
                                  fontFamily: 'NotoSerifSC',
                                  height: 1.9,
                                ),
                              ),
                            ],
                          ],
                        ),
                ),
                if (!_loading && _canAdvance)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(20, 15, 20, 22),
                    decoration: BoxDecoration(
                      color: colors.surface,
                      border: Border(
                        top: BorderSide(color: colors.outlineVariant),
                      ),
                    ),
                    child: _state.ended
                        ? Wrap(
                            spacing: 10,
                            runSpacing: 8,
                            children: [
                              const Text('八个片刻的预设演示已结束。'),
                              OutlinedButton(
                                onPressed: _busy ? null : _restart,
                                child: const Text('重新开始'),
                              ),
                              TextButton(
                                onPressed: () => Navigator.pop(context),
                                child: const Text('返回世界'),
                              ),
                            ],
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '第 ${_state.step + 1} / 8 个片刻 · 选择当前建议或继续',
                                style: theme.textTheme.labelMedium,
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  for (final action in PortalDemoScript.actions(
                                    widget.worldId,
                                    _state,
                                  ))
                                    OutlinedButton(
                                      onPressed: _busy
                                          ? null
                                          : () => _choose(action.id),
                                      child: Text(action.text),
                                    ),
                                  TextButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _choose('continue'),
                                    child: const Text('让场景继续'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
