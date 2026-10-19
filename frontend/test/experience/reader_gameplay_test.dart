import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_context_projection.dart';
import 'package:elselife_frontend/experience/reader_projection.dart';
import 'package:elselife_frontend/experience/reader_panels.dart';
import '../support/experience_fixture.dart';

Json gameplayFixture(int amount, int revision) => {
  'schemaVersion': 1,
  'location': '码头',
  'inventory': <String>[],
  'game': {
    'schemaVersion': 1,
    'entities': [
      {
        'id': 'coins',
        'kind': 'meter',
        'name': '铜钱',
        'detail': '钱袋中的钱',
        'status': '已知',
        'value': amount,
        'max': null,
        'unit': '枚',
        'quote': '正式依据',
        'sourceVersion': revision,
      },
      {
        'id': 'future',
        'kind': 'item',
        'name': '未来钥匙',
        'detail': '不可见',
        'status': '已知',
        'value': 1,
        'max': null,
        'unit': '把',
        'quote': '未来',
        'sourceVersion': revision + 1,
      },
    ],
    'surfaces': [],
  },
  'experience': {
    'schemaVersion': 1,
    'clock': {
      'label': '午后',
      'elapsed': '一刻钟',
      'precision': 'approximate',
      'quote': '时间依据',
      'sourceVersion': revision,
    },
    'objects': [
      {
        'id': 'old-coins',
        'kind': 'resource',
        'name': '铜钱',
        'summary': '旧数量99枚',
        'status': '已知',
        'certainty': 'confirmed',
        'fields': [
          {'key': 'amount', 'label': '数量', 'value': '99'},
        ],
        'relatedIds': [],
        'quote': '旧记录',
        'sourceVersion': 1,
      },
    ],
    'stop': null,
    'folded': [],
  },
};
Json projectionFixture(int amount, int revision) => {
  'revision': revision,
  'story_time': '清晨',
  'information': <Json>[],
  'records': [
    {
      'kind': 'metric',
      'entity_id': 'coins',
      'label': '铜钱',
      'fact_id': 'old-fact',
      'source_revision': 1,
      'quote': '旧事实',
      'value': '99',
    },
  ],
  'gameplay': gameplayFixture(amount, revision),
};

void main() {
  testWidgets('资料侧栏显示当前数量且只读开场不提供提交控件', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final projection = ReaderProjection(projectionFixture(5, 2));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderInformationBrowser(
            information: projection.information,
            allowSubmission: false,
            onInspect: (_) {},
            onEdit: (_) {},
            onDraft: (_) {},
          ),
        ),
      ),
    );
    expect(find.text('数量：5'), findsOneWidget);
    expect(find.textContaining('99'), findsNothing);
    await tester.tap(find.text('选择资料').first);
    await tester.pumpAndSettle();
    expect(find.text('围绕已选起草'), findsNothing);
    expect(find.text('比较已选'), findsOneWidget);
  });
  test('旧事实空标题复用公开正文，地点和说法映射原资料类型且保留确定性', () {
    final raw = testView();
    raw['information'] = <Json>[
      {
        'id': 'f',
        'kind': 'statement',
        'name': '',
        'text': '船夫说渡口尚未开放。',
        'related_ids': [],
      },
      {
        'id': 'p',
        'kind': 'place',
        'name': '旧渡口',
        'text': '已知地点',
        'related_ids': [],
      },
    ];
    final view = ExperienceView(raw),
        context = readerContextObjects(ExperienceView(raw));
    expect(view.information.first.name, '船夫说渡口尚未开放。');
    expect(context.first['kind'], 'fact');
    expect(context.first['certainty'], 'reported');
    expect(context[1]['kind'], 'location');
    expect(view.information[1].kind, 'location');
  });
  test('当前资料使用正式数值与来源，过去页只用自己的玩法快照', () {
    final raw = testView(revision: 2);
    raw['reader'] = projectionFixture(5, 2);
    raw['gameplay'] = gameplayFixture(5, 2);
    final past = object(objects(testView(revision: 1)['pages']).single);
    past['reader'] = projectionFixture(7, 1);
    raw['pages'] = <Json>[past, ...objects(raw['pages'])];
    final view = ExperienceView(raw),
        current = readerContextObjects(ExperienceView(raw));
    final coins = current.singleWhere((item) => item['id'] == 'coins');
    expect(
      objects(
        coins['fields'],
      ).singleWhere((field) => field['key'] == 'amount')['value'],
      '5',
    );
    expect(coins['sourceVersion'], 2);
    expect(current.any((item) => item['name'] == '未来钥匙'), isFalse);
    expect(current.any((item) => item['summary'] == '旧数量99枚'), isFalse);
    expect(view.reader!.currentRecords, isEmpty);
    expect(view.reader!.storyTime, '午后');
    expect(
      view.pages.first.reader!.information
          .singleWhere((item) => item.id == 'coins')
          .fields
          .singleWhere((field) => field['key'] == 'amount')['value'],
      '7',
    );
    expect(view.pages.last.reader, isNull);
  });
  test('旧时间标注最后确认且不把历史快照补为当前，源展示保留真实几何', () {
    final raw = projectionFixture(4, 2);
    raw['revision'] = 3;
    final projection = ReaderProjection(raw);
    expect(projection.storyTime, '最后确认：午后');
    final state = projection.gameplay!.sourceState(3, projection.storyTime);
    expect(state['location'], '码头');
    expect(object(state['game']).containsKey('spatial'), isFalse);
    expect(
      ReaderProjection({
        'revision': 1,
        'story_time': '开场',
        'information': [],
        'records': [],
      }).gameplay,
      isNull,
    );
  });
}
