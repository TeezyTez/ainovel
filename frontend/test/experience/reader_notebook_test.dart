/// Synthetic public snapshots and layout events. Not model or device evidence.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_notebook.dart';
import 'package:elselife_frontend/experience/reader_page_context.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

Json notebookFixture({bool missingHistory = false, bool long = false}) {
  final person = <String, dynamic>{
    'id': 'entity:tao',
    'kind': 'character',
    'name': '阿陶',
    'text': '住在隔壁的邻居。',
    'related_ids': <String>[],
  };
  final before = <String, dynamic>{
    'id': 'fact:chair',
    'kind': 'statement',
    'name': '',
    'text': '阿陶说短凳昨晚开始摇晃。',
    'related_ids': ['entity:tao'],
    'recorded_revision': 1,
  };
  final later = <String, dynamic>{
    'id': 'fact:later',
    'kind': 'fact',
    'name': '',
    'text': '只有第二页才公开：凳腿底端有一道裂缝。',
    'related_ids': ['entity:tao'],
    // Deliberately not the page on which the reader learns it.
    'recorded_revision': 1,
  };
  final raw = testView(revision: 2);
  raw['information'] = [person, before, later];
  final template = objects(raw['pages']).single;
  raw['pages'] = [
    for (final revision in [1, 2])
      {
        ...template,
        'revision': revision,
        'mode': revision == 1 ? 'begin' : 'act',
        'input': revision == 1 ? '' : '我蹲下来看看凳腿。',
        'text': revision == 1
            ? (long
                  ? List.generate(18, (i) => '院子里的第$i片树叶落在木桌上。').join('\n\n')
                  : '院子里，阿陶把短凳搬到木桌旁。')
            : '我蹲下身，看见凳腿底端的裂缝。\n\n阿陶扶着凳面，没有催促。',
        'story_time': revision == 1 ? '午后两点' : '午后两点十分',
        if (!(missingHistory && revision == 1))
          'reader': {
            'revision': revision,
            'story_time': revision == 1 ? '午后两点' : '午后两点十分',
            'information': [person, before, if (revision == 2) later],
            'records': <Json>[],
          },
      },
  ];
  return raw;
}

Future<(ExperienceController, PortalPreferences, FakeExperienceApi)>
mountNotebook(
  WidgetTester tester, {
  bool paged = true,
  bool missingHistory = false,
  bool long = false,
  Size size = const Size(1280, 900),
  double scale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final api = FakeExperienceApi()
    ..viewOverride = notebookFixture(
      missingHistory: missingHistory,
      long: long,
    );
  final journal = MemoryJournal();
  final c = ExperienceController(
    session: testSession(),
    api: api,
    journal: journal,
  );
  final p = PortalPreferences(
    journal: journal,
    backendUrl: c.session.backendUrl,
    workspaceId: c.session.workspaceId,
  );
  await p.hydrate();
  await p.setValue('readingMode', paged ? 'paged' : 'continuous');
  await p.setValue('reducedMotion', true);
  await c.initialize();
  await c.open('experience-a');
  await c.saveDraft('先看看，不要替我修好。');
  await tester.pumpWidget(
    elseLifeTestApp(
      home: MediaQuery(
        data: MediaQueryData(size: size, textScaler: TextScaler.linear(scale)),
        child: ExperienceScreen(
          controller: c,
          preferences: p,
          onPreferences: () {},
          onPortalHome: () {},
          onPortalShelf: () {},
          generativeUiEnabled: false,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  addTearDown(() {
    c.dispose();
    c.session.dispose();
    p.dispose();
  });
  return (c, p, api);
}

void main() {
  testWidgets('a metadata-only update exposes both literal versions', (
    tester,
  ) async {
    final raw = notebookFixture();
    raw['pages'] = [
      for (final page in objects(raw['pages']))
        {
          ...page,
          'reader': {
            ...page['reader'] as Json,
            'information': [
              for (final item in objects(
                (page['reader'] as Json)['information'],
              ))
                {
                  ...item,
                  if (item['id'] == 'fact:chair') ...{
                    'status': page['revision'] == 1 ? '待核实' : '已查看',
                    'certainty': page['revision'] == 1 ? '仅为说法' : '亲眼所见',
                  },
                },
            ],
          },
        },
    ];
    final index = ReaderPageContextIndex(ExperienceView(raw));
    await tester.pumpWidget(
      elseLifeTestApp(
        home: Scaffold(
          body: ReaderNotebook(
            index: index,
            page: index.at(2)!,
            latestRevision: 2,
            onInspect: (_) {},
            onSource: (_) {},
            onAllInformation: () {},
          ),
        ),
      ),
    );
    await tester.tap(find.text('阿陶说短凳昨晚开始摇晃。'));
    await tester.pump();
    expect(find.text('状态：已查看'), findsOneWidget);
    expect(find.text('确定性：亲眼所见'), findsOneWidget);
    expect(find.text('状态：待核实'), findsOneWidget);
    expect(find.text('确定性：仅为说法'), findsOneWidget);
  });

  testWidgets('paged rereading cannot show later knowledge in the notebook', (
    tester,
  ) async {
    final (c, _, api) = await mountNotebook(tester);
    expect(find.textContaining('只有第二页才公开'), findsNothing);
    expect(find.text('页边记事'), findsOneWidget);
    expect(find.text('午后两点十分'), findsNothing);
    expect(find.textContaining('行动接续第 2 页'), findsOneWidget);
    expect(c.draft, '先看看，不要替我修好。');
    expect(api.sent, isEmpty);
  });

  testWidgets('missing historical snapshot never borrows latest information', (
    tester,
  ) async {
    await mountNotebook(tester, missingHistory: true);
    expect(find.textContaining('只有第二页才公开'), findsNothing);
    expect(find.textContaining('这一页没有保存资料快照'), findsOneWidget);
  });

  testWidgets(
    'continuous reading follows visible prose, not final loaded page',
    (tester) async {
      final (c, _, api) = await mountNotebook(tester, paged: false, long: true);
      final scope = find.byKey(const ValueKey('reader-notebook-scope'));
      expect(tester.widget<Text>(scope).data, '第 1 页');
      final scroll = tester
          .widget<Scrollbar>(find.byType(Scrollbar).first)
          .controller!;
      scroll.jumpTo(scroll.position.maxScrollExtent);
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(scope).data, '第 2 页');
      scroll.jumpTo(0);
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(scope).data, '第 1 页');
      expect(c.draft, '先看看，不要替我修好。');
      expect(api.sent, isEmpty);
    },
  );

  testWidgets(
    'related record rereading returns to its page without sending a draft',
    (tester) async {
      final (c, _, api) = await mountNotebook(tester);
      await tester.tap(find.text('回到最新'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('reader-notebook-scope')))
            .data,
        '第 2 页',
      );
      await tester.tap(find.text('只有第二页才公开：凳腿底端有一道裂缝。'));
      await tester.pumpAndSettle();
      expect(find.text('相关的前文记载'), findsOneWidget);
      expect(find.text('阿陶说短凳昨晚开始摇晃。'), findsOneWidget);
      final beforeReturn = c.readingAnchor;
      await tester.tap(find.text('第 1 页的记载 ↗'));
      await tester.pumpAndSettle();
      expect(find.textContaining('只有第二页才公开'), findsNothing);
      await tester.tap(find.text('回到刚才 · 第 2 页'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('reader-notebook-scope')))
            .data,
        '第 2 页',
      );
      expect(c.readingAnchor?.revision, beforeReturn?.revision);
      expect(c.readingAnchor?.sourceOffset, beforeReturn?.sourceOffset);
      expect(c.draft, '先看看，不要替我修好。');
      expect(api.sent, isEmpty);
      expect(api.forks, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'narrow large-text notebook exposes same page without overflowing',
    (tester) async {
      final (c, _, api) = await mountNotebook(
        tester,
        size: const Size(390, 844),
        scale: 2,
      );
      await tester.tap(find.byTooltip('页边记事'));
      await tester.pumpAndSettle();
      expect(find.text('页边记事'), findsOneWidget);
      expect(find.textContaining('只有第二页才公开'), findsNothing);
      expect(find.text('截至此页 · 2'), findsOneWidget);
      await tester.tap(find.text('截至此页 · 2'));
      await tester.pumpAndSettle();
      expect(find.textContaining('只有第二页才公开'), findsNothing);
      await tester.tap(find.byTooltip('关闭页边记事'));
      await tester.pumpAndSettle();
      expect(c.draft, '先看看，不要替我修好。');
      expect(api.sent, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
}
