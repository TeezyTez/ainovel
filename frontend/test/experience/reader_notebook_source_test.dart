/// Real reader widgets with synthetic public snapshots and route animations.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_prose_mentions.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';

import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

String sourceParagraph(int revision, int paragraph) =>
    '第$revision页第$paragraph段，许舟沿着屋檐走过来。雨水落在门前的石阶上，木椅仍放在墙边。';

Json sourceView() {
  final raw = testView(revision: 7);
  final template = objects(raw['pages']).single;
  final person = <String, dynamic>{
    'id': 'entity:xu',
    'kind': 'character',
    'name': '许舟',
    'text': '住在街角的邻居。',
    'related_ids': <String>[],
  };
  final before = <String, dynamic>{
    'id': 'fact:chair-before',
    'kind': 'fact',
    'name': '',
    'text': '许舟把夹具留在墙边的旧椅子上。',
    'related_ids': ['entity:xu'],
  };
  final later = <String, dynamic>{
    'id': 'fact:chair-later',
    'kind': 'fact',
    'name': '',
    'text': '许舟坐下休息时，墙边旧椅子仍夹着夹具。',
    'related_ids': ['entity:xu'],
  };
  raw['information'] = [person, before, later];
  raw['pages'] = [
    for (var revision = 1; revision <= 7; revision++)
      {
        ...template,
        'revision': revision,
        'text': List.generate(
          revision >= 6 ? 12 : 1,
          (i) => sourceParagraph(revision, i),
        ).join('\n\n'),
        'story_time': '第 $revision 个午后',
        'reader': {
          'revision': revision,
          'story_time': '第 $revision 个午后',
          'information': [
            person,
            if (revision >= 6) before,
            if (revision == 7) later,
          ],
          'records': <Json>[],
        },
      },
  ];
  return raw;
}

Finder paragraph(String text) => find.byWidgetPredicate(
  (widget) =>
      widget is ReaderProseParagraph &&
      widget.runs.map((run) => run.text).join() == text,
);

class _PageWriteJournal extends MemoryJournal {
  _PageWriteJournal(this.delay);
  final Duration delay;

  @override
  Future<void> patch(String scope, Json values) async {
    if ((values['reader_personal'] as Map?)?['page'] == 5) {
      await Future<void>.delayed(delay);
    }
    await super.patch(scope, values);
  }
}

void main() {
  for (final delay in [Duration.zero, const Duration(milliseconds: 60)]) {
    testWidgets(
      'narrow continuous source navigation with ${delay.inMilliseconds}ms page save returns to saved prose',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final journal = _PageWriteJournal(delay);
        final api = FakeExperienceApi()..viewOverride = sourceView();
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
        await appearance.setValue('readingMode', 'continuous');
        // Exercise route closing and animated source navigation together.
        await appearance.setValue('reducedMotion', false);
        await c.initialize();
        await c.open('experience-a');
        await c.saveDraft('先休息，不替我拆掉夹具。');
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
        final scroll = tester
            .widget<Scrollbar>(find.byType(Scrollbar).first)
            .controller!;
        scroll.jumpTo(scroll.position.maxScrollExtent);
        await tester.pumpAndSettle();
        final beforeReturn = c.readingAnchor!;
        expect(beforeReturn.revision, 7);
        final lastParagraphBefore = tester
            .getTopLeft(paragraph(sourceParagraph(7, 11)))
            .dy;
        await tester.tap(find.byTooltip('页边记事'));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<Text>(find.byKey(const ValueKey('reader-notebook-scope')))
              .data,
          '第 7 页',
        );
        await tester.tap(find.text('许舟坐下休息时，墙边旧椅子仍夹着夹具。'));
        await tester.pumpAndSettle();
        final source = find.text('第 6 页的记载 ↗');
        await tester.ensureVisible(source);
        await tester.pumpAndSettle();
        await tester.tap(source);
        await tester.pumpAndSettle(const Duration(milliseconds: 16));
        expect(find.byTooltip('关闭页边记事'), findsNothing);
        final sourceY = tester.getTopLeft(paragraph(sourceParagraph(6, 0))).dy;
        expect(
          sourceY,
          inInclusiveRange(64, 600),
          reason: 'The source prose must actually enter the viewport.',
        );
        expect(c.readingAnchor?.revision, 6);
        expect(find.text('回到刚才 · 第 7 页'), findsOneWidget);
        await tester.tap(find.text('回到刚才 · 第 7 页'));
        await tester.pumpAndSettle(const Duration(milliseconds: 16));
        expect(c.readingAnchor?.revision, beforeReturn.revision);
        expect(c.readingAnchor?.sourceOffset, beforeReturn.sourceOffset);
        expect(
          tester.getTopLeft(paragraph(sourceParagraph(7, 11))).dy,
          closeTo(lastParagraphBefore, 2),
        );
        expect(c.draft, '先休息，不替我拆掉夹具。');
        expect(api.sent, isEmpty);
        expect(api.forks, isEmpty);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        c.dispose();
        c.session.dispose();
        appearance.dispose();
      },
    );
  }
}
