import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import 'experience_models.dart';

class ReaderProseRun {
  const ReaderProseRun(this.text, {this.objectId, this.name});
  final String text;
  final String? objectId;
  final String? name;
}

/// Matches src/reading-ui.js prose(): first unambiguous occurrence per page,
/// longest name wins at the same offset; later knowledge never annotates history.
List<List<ReaderProseRun>> readerProseMentions(
  String text, {
  required List<Json> information,
  required int maxRevision,
}) {
  final names = <String, List<Json>>{};
  for (final item in information) {
    final name = item['name'];
    final source = item['sourceVersion'];
    if (name is! String ||
        name.length < 2 ||
        item['id'] is! String ||
        (item['id'] as String).isEmpty ||
        source is num && source > maxRevision)
      continue;
    names.putIfAbsent(name, () => []).add(item);
  }
  final candidates =
      names.values
          .where((group) => group.length == 1)
          .map((group) => group.single)
          .toList()
        ..sort(
          (a, b) => (b['name'] as String).length.compareTo(
            (a['name'] as String).length,
          ),
        );
  final used = <String>{};
  return [
    for (final paragraph
        in text.split(RegExp(r'\n\s*\n')).where((p) => p.isNotEmpty))
      _paragraphRuns(paragraph, candidates, used),
  ];
}

List<ReaderProseRun> _paragraphRuns(
  String text,
  List<Json> candidates,
  Set<String> used,
) {
  final runs = <ReaderProseRun>[];
  var at = 0;
  while (at < text.length) {
    Json? match;
    var offset = text.length;
    for (final item in candidates) {
      if (used.contains(item['id'])) continue;
      final index = text.indexOf(item['name'] as String, at);
      if (index >= 0 && index < offset) {
        match = item;
        offset = index;
      }
    }
    if (match == null) {
      runs.add(ReaderProseRun(text.substring(at)));
      break;
    }
    if (offset > at) runs.add(ReaderProseRun(text.substring(at, offset)));
    final name = match['name'] as String, id = match['id'] as String;
    runs.add(ReaderProseRun(name, objectId: id, name: name));
    used.add(id);
    at = offset + name.length;
  }
  return runs;
}

class ReaderProseParagraph extends StatefulWidget {
  const ReaderProseParagraph({
    super.key,
    required this.runs,
    required this.style,
    required this.onMention,
    this.onSelectionChanged,
  });
  final List<ReaderProseRun> runs;
  final TextStyle style;
  final ValueChanged<String> onMention;
  final SelectionChangedCallback? onSelectionChanged;
  @override
  State<ReaderProseParagraph> createState() => _ReaderProseParagraphState();
}

class _ReaderProseParagraphState extends State<ReaderProseParagraph> {
  final _recognizers = <TapGestureRecognizer>[];
  final _links = <String, FocusNode>{};
  final _selectionFocus = FocusNode(skipTraversal: true);
  String? _focusedId;
  void _clearRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  @override
  void dispose() {
    _clearRecognizers();
    _selectionFocus.dispose();
    for (final node in _links.values) {
      node.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _clearRecognizers();
    final spans = <InlineSpan>[];
    final actions = <CustomSemanticsAction, VoidCallback>{};
    final keyboardLinks = <Widget>[];
    for (final run in widget.runs) {
      final id = run.objectId;
      if (id == null) {
        spans.add(TextSpan(text: run.text));
        continue;
      }
      void open() => widget.onMention(id);
      final recognizer = TapGestureRecognizer()..onTap = open;
      _recognizers.add(recognizer);
      actions[CustomSemanticsAction(label: '查看${run.name}的已知资料')] = open;
      keyboardLinks.add(
        FocusTraversalOrder(
          order: NumericFocusOrder(keyboardLinks.length.toDouble()),
          child: Focus(
            focusNode: _links.putIfAbsent(
              id,
              () => FocusNode(debugLabel: '查看${run.name}的已知资料'),
            ),
            onFocusChange: (focused) {
              if (mounted)
                setState(
                  () => _focusedId = focused
                      ? id
                      : _focusedId == id
                      ? null
                      : _focusedId,
                );
            },
            onKeyEvent: (node, event) {
              if (event is KeyDownEvent &&
                  {
                    LogicalKeyboardKey.enter,
                    LogicalKeyboardKey.numpadEnter,
                    LogicalKeyboardKey.space,
                  }.contains(event.logicalKey)) {
                open();
                return KeyEventResult.handled;
              }
              return KeyEventResult.ignored;
            },
            child: const SizedBox(width: 1, height: 1),
          ),
        ),
      );
      spans.add(
        TextSpan(
          text: run.text,
          recognizer: recognizer,
          mouseCursor: SystemMouseCursors.click,
          style: TextStyle(
            decoration: TextDecoration.underline,
            backgroundColor: _focusedId == id
                ? Theme.of(context).colorScheme.primaryContainer
                : null,
            decorationStyle: _focusedId == id
                ? TextDecorationStyle.solid
                : TextDecorationStyle.dotted,
          ),
        ),
      );
    }
    return Semantics(
      label: widget.runs.map((run) => run.text).join(),
      excludeSemantics: true,
      customSemanticsActions: actions.isEmpty ? null : actions,
      child: FocusTraversalGroup(
        policy: OrderedTraversalPolicy(),
        child: Stack(
          children: [
            SelectableText.rich(
              TextSpan(children: spans),
              style: widget.style,
              focusNode: _selectionFocus,
              onSelectionChanged: widget.onSelectionChanged,
            ),
            Positioned(left: 0, top: 0, child: Column(children: keyboardLinks)),
          ],
        ),
      ),
    );
  }
}
