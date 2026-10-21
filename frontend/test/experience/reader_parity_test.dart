// Source-based reader interaction checks; fixtures do not validate model quality.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  Future<ExperienceController> mount(
    WidgetTester tester, {
    bool ending = false,
    double width = 800,
  }) async {
    tester.view.physicalSize = Size(width, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final view = testView();
    (view['pages'] as List).single['suggestions'] = ['我问她雨何时停'];
    (view['pages'] as List).single['outcome'] = ending ? 'ending' : 'continues';
    (view['information'] as List).add({
      'id': 'person:a',
      'kind': 'person',
      'name': '阿禾',
      'text': '书店的主人',
      'related_ids': <String>[],
    });
    final c = ExperienceController(
      session: testSession(),
      api: FakeExperienceApi()..viewOverride = view,
      journal: MemoryJournal(),
    );
    await c.initialize();
    await c.open('experience-a');
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(
          controller: c,
          onPreferences: () {},
          onPortalHome: () {},
          onPortalShelf: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    return c;
  }

  testWidgets('阅读默认收起行动，展开收起保留草稿和同分支的选择', (tester) async {
    final c = await mount(tester);
    expect(find.byKey(const ValueKey('experience-input')), findsNothing);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '还没有说出口',
    );
    await tester.pumpAndSettle();
    await c.saveReading(size: 22);
    await tester.pumpAndSettle();
    expect(find.text('收起行动'), findsOneWidget);
    await tester.tap(find.text('收起行动'));
    await tester.pumpAndSettle();
    expect(find.text('展开行动 · 有草稿'), findsOneWidget);
    expect(c.draft, '还没有说出口');
    await tester.tap(find.text('展开行动 · 有草稿'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('experience-input')))
          .controller!
          .text,
      '还没有说出口',
    );
    expect((c.api as FakeExperienceApi).sent, isEmpty);
  });

  testWidgets('建议只填入草稿，继续阅读不发送或清空草稿', (tester) async {
    final c = await mount(tester);
    final api = c.api as FakeExperienceApi;
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我问她雨何时停'));
    await tester.pumpAndSettle();
    expect(c.draft, '我问她雨何时停');
    expect(api.sent, isEmpty);
    await tester.tap(find.text('收起行动'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('继续经历'));
    await tester.pumpAndSettle();
    expect(api.sent.single['mode'], 'read');
    expect(api.sent.single['input'], '');
    expect(c.draft, '我问她雨何时停');
  });

  testWidgets('Command Enter 支持提交，中文组合输入期间不提交', (tester) async {
    final c = await mount(tester);
    final api = c.api as FakeExperienceApi;
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('experience-input'));
    await tester.tap(input);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '中文输入',
        selection: TextSelection.collapsed(offset: 4),
        composing: TextRange(start: 0, end: 4),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.metaLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.metaLeft);
    await tester.pump();
    expect(api.sent, isEmpty);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '中文输入',
        selection: TextSelection.collapsed(offset: 4),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.metaLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.metaLeft);
    await tester.pumpAndSettle();
    expect(api.sent.single['input'], '中文输入');
  });

  testWidgets('故事结束仍可发送新行动并继续剧情', (tester) async {
    final c = await mount(tester, ending: true);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('experience-input'));
    expect(tester.widget<TextField>(input).enabled, isNot(false));
    await tester.enterText(input, '留给另一个分支的想法');
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['input'], '留给另一个分支的想法');
  });

  testWidgets('空草稿也能继续已结束故事', (tester) async {
    final c = await mount(tester, ending: true);
    expect(c.draft, isEmpty);
    await tester.tap(find.text('继续经历'));
    await tester.pumpAndSettle();
    final sent = (c.api as FakeExperienceApi).sent;
    expect(sent.single['mode'], 'read');
    expect(sent.single['input'], '');
  });

  testWidgets('390宽阅读器工具不溢出，资料搜索只查公开内容并保留草稿', (tester) async {
    final c = await mount(tester, width: 390);
    expect(tester.takeException(), isNull);
    await c.saveDraft('我的原草稿');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('页边记事'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('查阅全部资料'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('reader-information-search')),
      '书店',
    );
    await tester.pumpAndSettle();
    expect(find.text('人物 · 阿禾'), findsOneWidget);
    expect(find.text('事实 · 天气'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('reader-information-search')),
      '不存在',
    );
    await tester.pumpAndSettle();
    expect(find.text('没有匹配的公开资料。'), findsOneWidget);
    expect(c.draft, '我的原草稿');
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
