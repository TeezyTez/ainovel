/// Deterministic public-snapshot fixtures, not narrative-quality evidence.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_page_context.dart';

import '../support/experience_fixture.dart';

Json record(
  String id,
  String text, {
  String kind = 'fact',
  List<String> related = const [],
}) => {
  'id': id,
  'kind': kind,
  'name': id,
  'text': text,
  'related_ids': related,
};

Json snapshot(int revision, List<Json> information) => {
  'revision': revision,
  'story_time': '第 $revision 日',
  'information': information,
  'records': <Json>[],
};

Json contextView(
  Map<int, List<Json>?> snapshots, {
  String branch = 'main',
  List<Json>? latest,
  Json? reader,
}) {
  final revisions = snapshots.keys.toList()..sort();
  final raw = testView(revision: revisions.last, branch: branch);
  final template = objects(raw['pages']).single;
  raw['pages'] = [
    for (final revision in revisions)
      {
        ...template,
        'revision': revision,
        'text': '第 $revision 页保存的原文。',
        if (snapshots[revision] != null)
          'reader': snapshot(revision, snapshots[revision]!),
      },
  ];
  raw['information'] = latest ?? snapshots[revisions.last] ?? <Json>[];
  if (reader != null) raw['reader'] = reader;
  return raw;
}

void main() {
  test(
    'delayed disclosure is new on public page 3, never private record 1',
    () {
      final letter = record('fact:letter', '信写着霜月六日离城。')
        ..['recorded_revision'] = 1
        ..['source_version'] = 1;
      final index = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [],
            2: [],
            3: [letter],
          }),
        ),
      );

      expect(index.at(1)!.information, isEmpty);
      expect(index.at(2)!.changes, isEmpty);
      final context = index.at(3)!;
      expect(context.comparisonAvailable, isTrue);
      expect(context.comparedRevision, 2);
      expect(context.changes.single.item.id, 'fact:letter');
      expect(context.changes.single.isUpdate, isFalse);
      expect(
        index.appearanceOf(context.information.single, throughRevision: 3),
        3,
      );
      expect(
        index.appearanceOf(context.information.single, throughRevision: 2),
        isNull,
      );
    },
  );

  test('missing historical snapshot never borrows the latest knowledge', () {
    final known = record('fact:later', '第三页才公开。');
    final index = ReaderPageContextIndex(
      ExperienceView(
        contextView({
          1: [],
          2: null,
          3: [known],
        }),
      ),
    );

    expect(index.at(2)!.available, isFalse);
    expect(index.at(2)!.information, isEmpty);
    expect(index.at(3)!.comparisonAvailable, isFalse);
    expect(index.at(3)!.comparedRevision, isNull);
    expect(index.at(3)!.changes, isEmpty);
    expect(index.at(99), isNull);
  });

  test('mismatched historical projection is unavailable', () {
    final raw = contextView({1: [], 2: []});
    // Deliberately violate the page binding without exposing the wrong snapshot.
    (raw['pages'] as List).first['reader'] = snapshot(2, [
      record('fact:future', '后来公开。'),
    ]);
    final index = ReaderPageContextIndex(ExperienceView(raw));
    expect(index.at(1)!.available, isFalse);
    expect(index.at(1)!.information, isEmpty);
    expect(index.at(2)!.comparisonAvailable, isFalse);
  });

  test('only latest may use its matching root reader or root information', () {
    final root = record('fact:root', '当前公开资料。');
    final reader = record('fact:reader', '当前公开快照。');
    final withReader = ReaderPageContextIndex(
      ExperienceView(
        contextView(
          {1: null, 2: null},
          latest: [root],
          reader: snapshot(2, [reader]),
        ),
      ),
    );
    expect(withReader.at(1)!.available, isFalse);
    expect(withReader.at(2)!.information.single.id, 'fact:reader');

    final fallback = ReaderPageContextIndex(
      ExperienceView(
        contextView(
          {1: null, 2: null},
          latest: [root],
          reader: snapshot(1, [reader]),
        ),
      ),
    );
    expect(fallback.at(2)!.information.single.id, 'fact:root');
    expect(fallback.at(2)!.comparisonAvailable, isFalse);
  });

  test(
    'opening baseline and sparse unchanged pages have honest differences',
    () {
      final rain = record('fact:rain', '正在下雨。');
      final index = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [rain],
            4: [rain],
            9: [rain],
          }),
        ),
      );
      expect(index.at(1)!.comparisonAvailable, isTrue);
      expect(index.at(1)!.comparedRevision, isNull);
      expect(index.at(1)!.changes.single.item.id, 'fact:rain');
      expect(index.at(4)!.comparedRevision, 1);
      expect(index.at(9)!.comparedRevision, 4);
      expect(index.at(9)!.changes, isEmpty);

      final incomplete = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            4: [rain],
          }),
        ),
      );
      expect(incomplete.at(4)!.comparisonAvailable, isFalse);
      expect(incomplete.at(4)!.changes, isEmpty);
    },
  );

  test(
    'same ID updates preserve before text and source for each public form',
    () {
      final before = record('entity:letter', '尚未拆封。', kind: 'item');
      final after = record('entity:letter', '已经读过。', kind: 'item');
      final index = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [before],
            2: [after],
            3: [after],
          }),
        ),
      );
      final change = index.at(2)!.changes.single;
      expect(change.isUpdate, isTrue);
      expect(change.before!.text, '尚未拆封。');
      expect(change.item.text, '已经读过。');
      expect(index.appearanceOf(change.before!, throughRevision: 3), 1);
      expect(index.appearanceOf(change.item, throughRevision: 3), 2);
      expect(index.appearanceOf(change.item, throughRevision: 1), isNull);
      expect(index.at(3)!.changes, isEmpty);
    },
  );

  test('field value, certainty and status changes remain visible', () {
    final base = record('entity:shop', '店铺', kind: 'location')
      ..['fields'] = [
        {'key': 'amount', 'label': '灯油', 'value': '0'},
      ];
    final updates = [
      {...base, 'status': '关闭'},
      {...base, 'status': '关闭', 'certainty': 'reported'},
      {
        ...base,
        'status': '关闭',
        'certainty': 'reported',
        'fields': [
          {'key': 'amount', 'label': '灯油', 'value': '未知'},
        ],
      },
    ];
    final index = ReaderPageContextIndex(
      ExperienceView(
        contextView({
          1: [base],
          2: [updates[0]],
          3: [updates[1]],
          4: [updates[2]],
        }),
      ),
    );
    for (final revision in [2, 3, 4]) {
      expect(index.at(revision)!.changes.single.isUpdate, isTrue);
    }
    expect(index.at(4)!.changes.single.before!.fields.single['value'], '0');
    expect(index.at(4)!.changes.single.item.fields.single['value'], '未知');
  });

  test(
    'presentation order and provenance metadata alone do not imply change',
    () {
      final original =
          record(
              'entity:shop',
              '店铺',
              kind: 'location',
              related: ['entity:a', 'entity:b'],
            )
            ..['fields'] = [
              {'key': 'amount', 'label': '数量', 'value': '0'},
              {'key': 'unit', 'label': '单位', 'value': '瓶'},
            ];
      final reordered = {
        ...original,
        'related_ids': ['entity:b', 'entity:a'],
        'fields': [
          {'value': '瓶', 'label': '单位', 'key': 'unit'},
          {'value': '0', 'key': 'amount', 'label': '数量'},
        ],
        'recorded_revision': 1,
        'source_version': 2,
      };
      final raw = contextView({
        1: [original],
        2: [reordered],
      });
      final encoded = jsonEncode(raw);
      final index = ReaderPageContextIndex(ExperienceView(raw));
      expect(index.at(2)!.changes, isEmpty);
      expect(
        index.appearanceOf(index.at(2)!.information.single, throughRevision: 2),
        1,
      );
      expect(jsonEncode(raw), encoded);
    },
  );

  test(
    'earlier related records use explicit public pivots, not matching words',
    () {
      final person = record('entity:lin', '掌柜林舟。', kind: 'character');
      final old = record('fact:old', '昨日约好留下一盏灯。', related: ['entity:lin']);
      final unrelated = record('fact:word', '林舟这个名字出现在招牌上。');
      final now = record('fact:now', '他将灯交给你。', related: ['entity:lin']);
      final index = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [person, old, unrelated],
            2: [person, old, unrelated, now],
          }),
        ),
      );
      final related = index.earlierRelated(KnownInformation(now), revision: 2);
      expect(related.map((r) => r.item.id), ['fact:old']);
      expect(related.single.revision, 1);
      expect(
        index.earlierRelated(KnownInformation(unrelated), revision: 2),
        isEmpty,
      );
      expect(
        index
            .earlierRelated(KnownInformation(person), revision: 2)
            .map((r) => r.item.id),
        ['fact:old'],
      );
    },
  );

  test('unknown pivot IDs cannot establish a private association', () {
    final old = record('fact:old', '此前的记录。', related: ['secret:person']);
    final now = record('fact:now', '眼前的记录。', related: ['secret:person']);
    final index = ReaderPageContextIndex(
      ExperienceView(
        contextView({
          1: [old],
          2: [old, now],
        }),
      ),
    );
    expect(index.earlierRelated(KnownInformation(now), revision: 2), isEmpty);
  });

  test(
    'earlier context uses latest earlier form once and caps newest sources',
    () {
      final person = record('entity:lin', '掌柜', kind: 'character');
      final early = record('fact:a', '第一次记载。', related: ['entity:lin']);
      final revised = record('fact:a', '补充后的记载。', related: ['entity:lin']);
      final recent = record('fact:b', '最近记载。', related: ['entity:lin']);
      final current = record('fact:c', '本页记载。', related: ['entity:lin']);
      final future = record('fact:future', '尚未读到。', related: ['entity:lin']);
      final index = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [person, early],
            2: [person, revised],
            3: [person, revised, recent],
            4: [person, revised, recent, current],
            5: [person, revised, recent, current, future],
          }),
        ),
      );
      final related = index.earlierRelated(
        KnownInformation(current),
        revision: 4,
      );
      expect(related.map((r) => r.item.id), ['fact:b', 'fact:a']);
      expect(related.map((r) => r.revision), [3, 2]);
      expect(related.last.item.text, '补充后的记载。');
      expect(
        index
            .earlierRelated(KnownInformation(current), revision: 4, limit: 1)
            .single
            .item
            .id,
        'fact:b',
      );
      expect(
        index.earlierRelated(KnownInformation(current), revision: 4, limit: 0),
        isEmpty,
      );
      expect(
        index.earlierRelated(KnownInformation(current), revision: 99),
        isEmpty,
      );
    },
  );

  test(
    'indices remain branch-local and long histories never use future pages',
    () {
      final person = record('entity:lin', '掌柜', kind: 'character');
      final history = <int, List<Json>>{};
      final facts = <Json>[person];
      for (var revision = 1; revision <= 100; revision++) {
        facts.add(
          record('fact:$revision', '公开记录 $revision。', related: ['entity:lin']),
        );
        history[revision] = [...facts];
      }
      final main = ReaderPageContextIndex(ExperienceView(contextView(history)));
      final other = ReaderPageContextIndex(
        ExperienceView(
          contextView({
            1: [record('fact:other', '另一条经历。')],
            2: [record('fact:other', '另一条经历。')],
          }, branch: 'other'),
        ),
      );
      final item = main.at(40)!.changes.single.item;
      final related = main.earlierRelated(item, revision: 40);
      expect(related.map((r) => r.item.id), ['fact:39', 'fact:38', 'fact:37']);
      expect(
        main.appearanceOf(
          main.at(100)!.changes.single.item,
          throughRevision: 40,
        ),
        isNull,
      );
      expect(other.appearanceOf(item, throughRevision: 2), isNull);
      expect(other.at(2)!.information.single.id, 'fact:other');
    },
  );
}
