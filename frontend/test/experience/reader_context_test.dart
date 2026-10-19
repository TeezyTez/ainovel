import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_context_projection.dart';
import 'package:elselife_frontend/experience/reader_context_query.dart';
import 'package:elselife_frontend/experience/reader_panels.dart';
import '../support/experience_fixture.dart';

void main() {
  test('本地查询沿用原版窄语法，不截获对白或复合行动', () {
    expect(readerContextQuery('请查看人物关系。'), {
      'kind': 'relationships',
      'filter': 'person',
    });
    expect(readerContextQuery('用表格显示人物'), {
      'kind': 'list',
      'filter': 'person',
      'view': 'table',
    });
    expect(readerContextQuery('比较这两个'), {'kind': 'compare'});
    expect(readerContextQuery('查看时间线'), {'kind': 'timeline'});
    expect(readerContextQuery('查看阿青的资料'), {'kind': 'list', 'query': '阿青'});
    for (final text in ['我说“查看人物”', '显示人物，然后离开', '给我看看人物之后再去码头', '我要查看地图并行动']) {
      expect(readerContextQuery(text), isNull);
    }
  });
  test('资料引用严格限定当前公开对象、分支和版本，时间线保留正式页', () {
    final view = ExperienceView(testView());
    final selection = <String, dynamic>{
      'worldKey': view.id,
      'branchId': view.branchId,
      'baseVersion': view.revision,
      'objectIds': ['fact:known', 'page:1'],
    };
    final picked = readerSelectedObjects(selection, view);
    expect(picked.map((o) => o['summary']), ['正在下雨', '已提交的原文。']);
    expect((picked.last['fields'] as List).single['value'], '清晨');
    expect(picked.first['fields'], isEmpty);
    for (final change in [
      {'baseVersion': 0},
      {'branchId': 'other'},
      {
        'objectIds': ['hidden'],
      },
      {
        'objectIds': ['fact:known', 'fact:known'],
      },
    ]) {
      expect(
        () => readerSelectedObjects({...selection, ...change}, view),
        throwsFormatException,
      );
    }
  });
  testWidgets('关联选择回传持久化所有者、可恢复且限制四项，清除会回传', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final infos = [
      for (var i = 0; i < 5; i++)
        KnownInformation({
          'id': 'fact:$i',
          'name': '资料$i',
          'kind': 'fact',
          'text': '公开文本$i',
          'related_ids': <String>[],
        }),
    ];
    List<String>? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderInformationBrowser(
            information: infos,
            onInspect: (_) {},
            onEdit: (_) {},
            onDraft: (_) {},
            initialSelected: const ['fact:0', 'fact:1', 'fact:2'],
            onSelection: (ids) => selected = ids,
          ),
        ),
      ),
    );
    final chips = find.byType(FilterChip);
    await tester.ensureVisible(chips.at(3));
    await tester.tap(chips.at(3));
    await tester.pump();
    expect(selected, ['fact:0', 'fact:1', 'fact:2', 'fact:3']);
    await tester.ensureVisible(chips.at(4));
    await tester.tap(chips.at(4));
    await tester.pump();
    expect(selected, hasLength(4));
    expect(find.text('最多选择四条不同资料。'), findsOneWidget);
    await tester.ensureVisible(find.text('清除选择'));
    await tester.tap(find.text('清除选择'));
    await tester.pump();
    expect(selected, isEmpty);
  });
}
