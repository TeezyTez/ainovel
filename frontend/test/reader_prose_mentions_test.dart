import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/reader_prose_mentions.dart';

void main() {
  test(
    'first mention across paragraphs, longest name and original text preserved',
    () {
      const text = '林先生到了茶铺。林先生坐下。\n\n茶铺又来了林先生。';
      final result = readerProseMentions(
        text,
        information: [
          {'id': 'short', 'name': '先生', 'sourceVersion': 0},
          {'id': 'lin', 'name': '林先生', 'sourceVersion': 1},
          {'id': 'tea', 'name': '茶铺', 'sourceVersion': 1},
        ],
        maxRevision: 1,
      );
      expect(
        result
            .expand((p) => p)
            .where((r) => r.objectId != null)
            .map((r) => r.objectId),
        ['lin', 'tea', 'short'],
      );
      expect(result.map((p) => p.map((r) => r.text).join()).join('\n\n'), text);
    },
  );
  test(
    'ambiguous, future, single-character and malformed names stay plain',
    () {
      final result = readerProseMentions(
        '阿明与船夫看海。',
        information: [
          {'id': 'one', 'name': '阿明', 'sourceVersion': 0},
          {'id': 'two', 'name': '阿明', 'sourceVersion': 0},
          {'id': 'later', 'name': '船夫', 'sourceVersion': 4},
          {'id': 'sea', 'name': '海', 'sourceVersion': 0},
          {'name': '看海'},
        ],
        maxRevision: 2,
      );
      expect(result.single.every((r) => r.objectId == null), isTrue);
    },
  );
  testWidgets(
    'selectable names open the correct object and expose static prose actions',
    (tester) async {
      final semantics = tester.ensureSemantics();
      String? opened;
      String? selected;
      const text = '林先生在茶铺。';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReaderProseParagraph(
              runs: readerProseMentions(
                text,
                information: [
                  {'id': 'lin', 'name': '林先生', 'sourceVersion': 0},
                ],
                maxRevision: 0,
              ).single,
              style: const TextStyle(fontSize: 20),
              onMention: (id) => opened = id,
              onSelectionChanged: (selection, cause) =>
                  selected = selection.textInside(text),
            ),
          ),
        ),
      );
      final prose = tester.widget<SelectableText>(find.byType(SelectableText));
      final link = prose.textSpan!.children!.first as TextSpan;
      (link.recognizer! as TapGestureRecognizer).onTap!();
      expect(opened, 'lin');
      prose.onSelectionChanged!(
        const TextSelection(baseOffset: 0, extentOffset: 3),
        SelectionChangedCause.longPress,
      );
      expect(selected, '林先生');
      final node = tester.getSemantics(find.bySemanticsLabel(text));
      expect(node.getSemanticsData().flagsCollection.isTextField, isFalse);
      expect(node.getSemanticsData().customSemanticsActionIds, isNotEmpty);
      semantics.dispose();
    },
  );

  testWidgets('Tab与ShiftTab按正文顺序聚焦名称，Enter与空格打开同一已知对象', (tester) async {
    final opened = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderProseParagraph(
            runs: readerProseMentions(
              '林先生在茶铺。',
              information: [
                {'id': 'lin', 'name': '林先生'},
                {'id': 'tea', 'name': '茶铺'},
              ],
              maxRevision: 1,
            ).single,
            style: const TextStyle(fontSize: 20),
            onMention: opened.add,
          ),
        ),
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus!.debugLabel, '查看林先生的已知资料');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(opened, ['lin']);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus!.debugLabel, '查看茶铺的已知资料');
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    expect(opened, ['lin', 'tea']);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus!.debugLabel, '查看林先生的已知资料');
    final span =
        tester
                .widget<SelectableText>(find.byType(SelectableText))
                .textSpan!
                .children!
                .first
            as TextSpan;
    expect(span.style!.backgroundColor, isNotNull);
  });
}
