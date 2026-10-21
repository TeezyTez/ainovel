import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_context_projection.dart';
import 'package:elselife_frontend/experience/reader_information_display.dart';
import 'package:elselife_frontend/experience/reader_information_sheet.dart';
import 'package:elselife_frontend/experience/reader_panels.dart';
import '../support/experience_fixture.dart';

Json fact(String id, String text, int? revision) => {
  'id': 'fact:$id',
  'kind': 'fact',
  'name': '',
  'text': text,
  'related_ids': <String>[],
  'recorded_revision': ?revision,
};

void main() {
  test('事实保留记录版本，不能把私有建档版当成获知或原文来源页', () {
    final raw = testView(revision: 3);
    final letter = fact('letter', '信记载霜月6日离城；玩家尚未阅读。', 1);
    raw['information'] = [letter];
    final pageTemplate = objects(raw['pages']).single;
    final pages = [
      for (var revision = 1; revision <= 3; revision++)
        <String, dynamic>{...pageTemplate, 'revision': revision},
    ];
    for (final page in pages) {
      page['reader'] = {
        'revision': page['revision'],
        'story_time': '霜月10日',
        'information': page['revision'] == 3 ? [letter] : <Json>[],
        'records': <Json>[],
      };
    }
    raw['pages'] = pages;
    final view = ExperienceView(raw);
    final item = view.information.single;
    expect(item.displaySummary, '记录版本 1：信记载霜月6日离城；玩家尚未阅读。');
    expect(item.recordHeading, '记录版本 1');
    expect(item.sourceVersion, isNull);
    final context = readerContextObjects(
      view,
    ).firstWhere((x) => x['id'] == item.id);
    expect(context['sourceVersion'], 3);
    expect(context['summary'], item.displaySummary);
    expect(item.text, letter['text']);
  });

  test('旧资料没有版次时保留未知，不把每种记录判断为失效', () {
    final item = KnownInformation(
      fact('rule', '每周借书一次。', null)..['kind'] = 'rule',
    );
    expect(item.recordHeading, '历史记录');
    expect(item.displaySummary, '历史记录：每周借书一次。');
    expect(item.sourceVersion, isNull);
  });

  test('gameplay资料转换保留记录版本且不混入原文来源', () {
    final raw = testView(revision: 3);
    raw['information'] = [fact('old-time', '当前故事日期为霜月10日。', 1)];
    raw['gameplay'] = {
      'schemaVersion': 1,
      'game': {'entities': <Json>[]},
      'location': '',
      'inventory': <String>[],
      'experience': null,
    };
    final item = ExperienceView(raw).information.single;
    expect(item.recordHeading, '记录版本 1');
    expect(item.sourceVersion, isNull);
  });

  for (final compact in [true, false]) {
    testWidgets('资料${compact ? '简表' : '浏览器'}同时保留旧表述与新事件的版次', (tester) async {
      tester.view.physicalSize = const Size(1200, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final information = [
        KnownInformation(fact('initial', '当前故事日期为霜月10日。', 1)),
        KnownInformation(fact('later', '已等到霜月12日清晨。', 5)),
      ];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: compact
                ? ReaderInformationSheet(
                    information: information,
                    onEdit: (_) {},
                  )
                : ReaderInformationBrowser(
                    information: information,
                    onInspect: (_) {},
                    onEdit: (_) {},
                    onDraft: (_) {},
                  ),
          ),
        ),
      );
      expect(find.text('记录版本 1'), findsOneWidget);
      expect(find.text('记录版本 5'), findsOneWidget);
      expect(find.text('当前故事日期为霜月10日。'), findsWidgets);
      expect(find.text('已等到霜月12日清晨。'), findsWidgets);
    });
  }
}
