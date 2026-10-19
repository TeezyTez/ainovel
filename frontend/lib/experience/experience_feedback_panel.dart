/// Reader feedback + long-term confirmation. A model draft is never a profile write.
library;

import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'experience_controller.dart';
import 'experience_journal.dart';
import 'experience_models.dart';

typedef ConfirmFeedback = Future<void> Function(String text, Json? proposal);

/// The user types free text; the raw sentence is saved locally first and remains
/// usable by choosing "save my own words" without any model. A model read is an
/// explicitly optional, single, correctable draft that never writes a profile,
/// a story revision or a person trait.
class ExperienceFeedbackPanel extends StatefulWidget {
  const ExperienceFeedbackPanel({
    super.key,
    required this.controller,
    required this.onLongTerm,
  });
  final ExperienceController controller;

  /// Called only on an explicit long-term confirmation of a named dimension.
  final ConfirmFeedback onLongTerm;
  @override
  State<ExperienceFeedbackPanel> createState() =>
      _ExperienceFeedbackPanelState();
}

class _ExperienceFeedbackPanelState extends State<ExperienceFeedbackPanel> {
  final _text = TextEditingController();
  Future<void> _writes = Future.value();
  Json? _interpretation;
  bool _busy = false, _loaded = false;
  String? _error;
  ExperienceController get c => widget.controller;
  late final String _owner = c.owner;
  late final String _scope = experienceScope(
    c.session.backendUrl,
    c.session.workspaceId,
    'preferences',
    'feedback',
  );
  bool get _same => mounted && c.owner == _owner;
  bool get _canAct =>
      _loaded &&
      !_busy &&
      _text.text.trim().isNotEmpty &&
      (!_text.value.composing.isValid || _text.value.composing.isCollapsed);

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final scope = _scope;
    try {
      final saved = await c.journal.read(scope);
      if (_same) {
        setState(() {
          _text.text = saved['text'] as String? ?? '';
          _loaded = true;
        });
      }
    } catch (_) {
      if (_same) setState(() => _error = '反馈原文读取失败；请重试，不覆盖旧稿。');
    }
  }

  Future<void> _persist() async {
    final text = _text.text, scope = _scope, identity = _owner;
    final result = _writes.then((_) => c.journal.patch(scope, {'text': text}));
    _writes = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    try {
      await result;
      if (mounted && c.owner == identity) setState(() => _error = null);
    } catch (_) {
      if (mounted && c.owner == identity) {
        setState(() => _error = '反馈原文尚未保存到本机。保留输入并重试；不会自动发送。');
      }
      rethrow;
    }
  }

  Future<void> _interpret() async {
    if (!_canAct) return;
    final text = _text.text;
    setState(() {
      _busy = true;
      _interpretation = null;
    });
    try {
      await _persist();
      final response = await c.api.interpretFeedback(text);
      if (_same && _text.text == text) {
        setState(() => _interpretation = response);
      }
    } catch (_) {
      if (_same && _error == null) {
        setState(() => _error = '解读未取得。没有保存偏好；原文仍可直接保存或用于本次阅读。');
      }
    } finally {
      if (_same) setState(() => _busy = false);
    }
  }

  Future<void> _confirm(Json? proposal) async {
    if (!_canAct) return;
    try {
      await _persist();
      if (_same) await widget.onLongTerm(_text.text, proposal);
    } catch (_) {
      /* the visible local storage error blocks; no implicit send or retry */
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final interpretation = _interpretation;
    final proposals = interpretation == null
        ? const <Json>[]
        : objects(interpretation['proposals']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('读者反馈（可选）', style: Theme.of(context).textTheme.titleLarge),
        const Text(
          '可以只写自己的话，不需要模型，也没有问卷。原文可直接保存为今后口味。'
          '正文输入框里的话只用于本次阅读或行动，不保存为长期口味。'
          '角色对白、当前场景和现实人格不是同一件事；引用的对白不会变成你的偏好或人格。'
          '偏好不保证愿望成功，也不改变人物立场和既定事实。',
        ),
        TextField(
          key: const Key('reader-feedback-text'),
          controller: _text,
          enabled: _loaded && !_busy,
          minLines: 2,
          maxLines: 6,
          decoration: const InputDecoration(labelText: '我的阅读感受、希望或反馈'),
          onChanged: (_) {
            setState(() => _interpretation = null);
            unawaited(_persist().catchError((Object _) {}));
          },
        ),
        if (_error != null) Semantics(liveRegion: true, child: Text(_error!)),
        if (!_loaded)
          TextButton(
            onPressed: _busy ? null : _restore,
            child: const Text('重读反馈草稿'),
          )
        else
          TextButton(
            onPressed: _busy
                ? null
                : () => _persist().catchError((Object _) {}),
            child: const Text('重存反馈原文'),
          ),
        Wrap(
          spacing: 8,
          children: [
            TextButton(
              onPressed: _canAct ? _interpret : null,
              child: Text(_busy ? '正在解读…' : '可选：让服务端解读（最多一次）'),
            ),
            TextButton(
              onPressed: _canAct ? () => _confirm(null) : null,
              child: const Text('原话保存为今后口味（无需模型）'),
            ),
          ],
        ),
        if (interpretation != null) ...[
          Text(
            interpretation['status'] == 'draft'
                ? '以下是服务端模型提议，不是你的原话，也尚未保存为偏好。可纠正后再明确确认。'
                : interpretation['status'] == 'uninterpreted'
                ? '这一句没有可形成的口味建议；这是合法结果，原文仍可保存。'
                : '当前无法理解这句（可能未配置模型或模型失败）。原文仍可直接保存或用于本次阅读；不假造解读。',
          ),
          if ((interpretation['explanation'] as String? ?? '').isNotEmpty)
            SelectableText(interpretation['explanation'] as String),
          if (interpretation['error_code'] != null)
            SelectableText('解读状态：${interpretation['error_code']}（未保存任何偏好）'),
          for (final proposal in proposals)
            ListTile(
              title: Text('${proposal['dimension']}：${proposal['value']}'),
              subtitle: Text('引用你的原句：${proposal['quote']}'),
              trailing: TextButton(
                onPressed: _canAct ? () => _confirm(proposal) : null,
                child: const Text('纠正并确认今后口味'),
              ),
            ),
        ],
      ],
    );
  }
}

/// Local evidence is never shown as raw JSON to the reader: this maps the stored
/// record to a truthful sentence that keeps user words distinct from model wording.
String preferenceEvidenceLabel(String evidence) {
  if (evidence.trim().isEmpty) return '来源记录缺失';
  try {
    final value = jsonDecode(evidence);
    if (value is Map) {
      final confirmation = value['confirmation'];
      final expression = value['expression'];
      if (expression is String && confirmation == 'direct_expression') {
        return '你的原话：$expression';
      }
      if (expression is String && confirmation == 'accepted_model_draft') {
        return '你原反馈（模型措辞经你确认）：$expression';
      }
      return '来源记录不完整';
    }
  } catch (_) {
    /* legacy or plain text stays visible as-is */
  }
  return '来源：$evidence';
}
