// Synthetic display regression: this does not assess model or narrative quality.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_context_projection.dart';
import 'package:elselife_frontend/experience/reader_information_sheet.dart';
import 'package:elselife_frontend/experience/reader_panels.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

Json ledgerView() {
  final raw = testView(revision: 2, text: '你把账册交给沈岚保管。');
  raw['information'] = <Json>[
    {
      'id': 'entity:ledger',
      'kind': 'item',
      'name': '账册',
      'text': '藏在你衣内的账册。',
      'related_ids': ['entity:player'],
      'source_version': 1,
    },
    {
      'id': 'entity:player',
      'kind': 'character',
      'name': '你',
      'text': '查账人。',
      'related_ids': <String>[],
      'source_version': 1,
    },
    {
      'id': 'fact:handoff',
      'kind': 'fact',
      'name': '账册交付',
      'text': '沈岚接过账册，答应暂时保管。',
      'related_ids': ['entity:ledger'],
      'source_version': 2,
    },
  ];
  raw['reader'] = {
    'revision': 2,
    'story_time': '傍晚',
    'information': raw['information'],
    'records': [
      {
        'kind': 'item',
        'entity_id': 'ledger',
        'label': '保管者',
        'value': '沈岚',
        'fact_id': 'handoff',
        'source_revision': 2,
        'quote': '沈岚接过账册，答应暂时保管。',
      },
    ],
  };
  return raw;
}

void main() {
  for (final compact in [false, true]) {
    testWidgets('资料${compact ? '简表' : '浏览器'}区分初次描述与后续持有事实', (tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final view = ExperienceView(ledgerView());
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: compact
                ? ReaderInformationSheet(
                    information: view.information,
                    onEdit: (_) {},
                  )
                : ReaderInformationBrowser(
                    information: view.information,
                    onInspect: (_) {},
                    onEdit: (_) {},
                    onDraft: (_) {},
                  ),
          ),
        ),
      );
      expect(find.text('初次记载 · 第 1 页'), findsNWidgets(2));
      expect(find.text('藏在你衣内的账册。'), findsOneWidget);
      expect(find.text('沈岚接过账册，答应暂时保管。'), findsOneWidget);
      expect(find.text('初次关联：你'), findsOneWidget);
      expect(find.text('来源：第 2 页'), findsOneWidget);
      expect(view.information.first.text, '藏在你衣内的账册。');
      expect(view.information.first.relatedIds, ['entity:player']);
      if (!compact) {
        await tester.tap(find.text('调整呈现'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('表格'));
        await tester.pumpAndSettle();
        expect(find.textContaining('初次记载：藏在你衣内的账册。'), findsOneWidget);
      }
    });
  }

  test('对照投影保留初次原文与来源，正式字段保留自己的来源', () {
    final view = ExperienceView(ledgerView());
    final context = readerContextObjects(view);
    final ledger = context.singleWhere((item) => item['id'] == 'entity:ledger');
    expect(ledger['summary'], '初次记载：藏在你衣内的账册。');
    expect(ledger['sourceVersion'], 1);
    expect(ledger['relatedIds'], ['entity:player']);
    expect(
      objects(ledger['fields']),
      contains(
        equals({'key': 'initialAssociations', 'label': '初次关联', 'value': '你'}),
      ),
    );
    expect(
      objects(ledger['fields']),
      contains(
        equals({'key': '保管者', 'label': '正式记录 · 保管者（第 2 页）', 'value': '沈岚'}),
      ),
    );
    final fact = context.singleWhere((item) => item['id'] == 'fact:handoff');
    expect(fact['summary'], '历史记录：沈岚接过账册，答应暂时保管。');
    expect(fact['sourceVersion'], 2);
  });

  testWidgets('实体详情将初次关联与后续正式记录分开，不宣称旧描述为最新情况', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = FakeExperienceApi()..viewOverride = ledgerView();
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await c.initialize();
    await c.open('experience-a');
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(
          controller: c,
          onPreferences: () {},
          onPortalHome: () {},
          generativeUiEnabled: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('页边记事'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('查阅全部资料'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('reader-information-search')),
      '账册',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('查看记录与来历').first);
    await tester.pumpAndSettle();
    final detail = find.byWidgetPredicate(
      (widget) => widget is ReaderPanel && widget.title == '账册',
    );
    Finder detailText(String text) =>
        find.descendant(of: detail, matching: find.text(text));
    expect(detailText('初次记载 · 第 1 页'), findsOneWidget);
    expect(detailText('藏在你衣内的账册。'), findsOneWidget);
    expect(detailText('初次关联'), findsOneWidget);
    expect(detailText('正式事实与记录'), findsOneWidget);
    expect(detailText('沈岚接过账册，答应暂时保管。'), findsOneWidget);
    expect(detailText('保管者：沈岚 · 第 2 页'), findsOneWidget);
    expect(detailText('这是当前分支最后记录的情况，不是对远方的实时探测。'), findsNothing);
    expect(api.sent, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
