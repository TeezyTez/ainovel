/// Synthetic restoration events; not physical-device or model-quality evidence.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_reading_anchor.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';

import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

Json restorationView() {
  final raw = testView(revision: 2);
  final template = objects(raw['pages']).single;
  raw['information'] = <Json>[];
  raw['pages'] = [
    for (final revision in [1, 2])
      {
        ...template,
        'revision': revision,
        'text': List.generate(
          28,
          (i) => '第$revision页第$i段，院子里的树叶落在木桌上，屋檐下还留着雨滴。',
        ).join('\n\n'),
        'story_time': revision == 1 ? '午后两点' : '午后两点十分',
        'reader': {
          'revision': revision,
          'story_time': revision == 1 ? '午后两点' : '午后两点十分',
          'information': <Json>[],
          'records': <Json>[],
        },
      },
  ];
  return raw;
}

Future<(ExperienceController, FakeExperienceApi)> restoreNotebook(
  WidgetTester tester, {
  required bool paged,
  bool missingSource = false,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final journal = MemoryJournal();
  final api = FakeExperienceApi()..viewOverride = restorationView();
  final c = ExperienceController(
    session: testSession(),
    api: api,
    journal: journal,
  );
  final appearance = PortalPreferences(
    journal: journal,
    backendUrl: c.session.backendUrl,
    workspaceId: c.session.workspaceId,
  );
  await appearance.hydrate();
  await appearance.setValue('readingMode', paged ? 'paged' : 'continuous');
  await appearance.setValue('reducedMotion', true);
  await c.initialize();
  await c.open('experience-a');
  await c.saveDraft('保留这份尚未发送的草稿。');
  await journal.patch(c.scope, {
    'reader_personal': {'page': 1},
  });
  await c.saveReading(
    position: 1000000,
    updateAnchor: true,
    anchor: missingSource
        ? const ReaderReadingAnchor(
            revision: 2,
            pageText: '已经被替换的原文。',
            sourceOffset: 0,
            segmentStart: 0,
            segmentEnd: 9,
            viewportY: 0,
          )
        : null,
  );
  await tester.pumpWidget(
    elseLifeTestApp(
      home: ExperienceScreen(
        controller: c,
        preferences: appearance,
        onPreferences: () {},
        onPortalHome: () {},
        onPortalShelf: () {},
        generativeUiEnabled: false,
      ),
    ),
  );
  await tester.pumpAndSettle();
  addTearDown(() {
    c.dispose();
    c.session.dispose();
    appearance.dispose();
  });
  return (c, api);
}

void expectRestoredPage(WidgetTester tester, int revision) {
  expect(
    tester
        .widget<Text>(find.byKey(const ValueKey('reader-notebook-scope')))
        .data,
    '第 $revision 页',
  );
  final time = revision == 1 ? '午后两点' : '午后两点十分';
  final header = find.text(time).first;
  expect(tester.getTopLeft(header).dy, lessThan(100));
  expect(tester.takeException(), isNull);
}

void main() {
  for (final paged in [false, true]) {
    testWidgets(
      '${paged ? 'paged' : 'continuous'} legacy offset restoration tracks the visible page',
      (tester) async {
        final (c, api) = await restoreNotebook(tester, paged: paged);
        expectRestoredPage(tester, 2);
        final scroll = tester
            .widget<Scrollbar>(find.byType(Scrollbar).first)
            .controller!;
        expect(scroll.position.extentAfter, lessThan(1));
        expect(c.draft, '保留这份尚未发送的草稿。');
        expect(api.sent, isEmpty);
        expect(api.forks, isEmpty);
      },
    );

    testWidgets(
      '${paged ? 'paged' : 'continuous'} failed source restoration tracks its actual fallback page',
      (tester) async {
        final (c, api) = await restoreNotebook(
          tester,
          paged: paged,
          missingSource: true,
        );
        // Existing paged fallback retains the selected page and resets its
        // scroll. Continuous fallback returns to the branch's first page.
        expectRestoredPage(tester, paged ? 2 : 1);
        expect(
          find.text(
            paged
                ? '原阅读位置的文字已变化或无法唯一定位，已回到当前页开头。'
                : '原阅读位置的文字已变化或无法唯一定位，已回到当前分支开头。',
          ),
          findsOneWidget,
        );
        expect(c.offset, 0);
        expect(c.readingAnchor?.pageText, isNot('已经被替换的原文。'));
        expect(c.draft, '保留这份尚未发送的草稿。');
        expect(api.sent, isEmpty);
        expect(api.forks, isEmpty);
      },
    );
  }
}
