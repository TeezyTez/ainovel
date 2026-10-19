import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_gameplay_receipt.dart';
import '../support/experience_fixture.dart';

Json receiptFixture() => {
  'schemaVersion': 1,
  'request_id': 'request',
  'artifact_id': 'artifact',
  'artifact_revision': 'attachment-1',
  'definition_digest': 'digest',
  'kind': 'journey',
  'action_id': 'route',
  'base_revision': 1,
  'revision': 2,
  'result': '走到港口',
  'location': '港口',
  'changes': [
    {'entity_id': 'coins', 'kind': 'delta', 'before': 7, 'after': 5},
  ],
  'transit': {
    'routeId': 'route',
    'locationId': 'port',
    'completed': true,
    'elapsedMinutes': null,
    'paidCosts': [
      {'entityId': 'coins', 'amount': 2},
    ],
    'quote': '渡船费用',
  },
};

void main() {
  test('正式回执可选但必须属于同一页，拒绝未知结构和非字面变化', () {
    final page = objects(testView(revision: 2)['pages']).single;
    expect(ExperiencePage(page).gameplayReceipt, isNull);
    page['gameplay_receipt'] = receiptFixture();
    expect(ExperiencePage(page).gameplayReceipt!.changes.single.after, 5);
    page['revision'] = 3;
    expect(() => ExperiencePage(page), throwsFormatException);
    final bad = receiptFixture()..['schemaVersion'] = 2;
    expect(() => ReaderGameplayReceipt(bad), throwsFormatException);
    bad['schemaVersion'] = 1;
    bad['changes'] = [
      {'entity_id': 'coins', 'kind': 'delta', 'before': {}, 'after': 4},
    ];
    expect(() => ReaderGameplayReceipt(bad), throwsFormatException);
  });
  testWidgets('已保存行程只呈现实际结算，未知耗时不变成零分钟', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderGameplayReceiptView(
            receipt: ReaderGameplayReceipt(receiptFixture()),
            information: [
              KnownInformation({
                'id': 'coins',
                'kind': 'metric',
                'name': '铜钱',
                'text': '',
                'related_ids': [],
              }),
              KnownInformation({
                'id': 'port',
                'kind': 'location',
                'name': '旧港口',
                'text': '',
                'related_ids': [],
              }),
            ],
          ),
        ),
      ),
    );
    expect(find.text('已抵达 · 旧港口'), findsOneWidget);
    expect(find.text('耗时未明确'), findsOneWidget);
    expect(find.text('已付 铜钱 2'), findsOneWidget);
    expect(find.text('铜钱：7 → 5'), findsOneWidget);
    expect(find.textContaining('0 分钟'), findsNothing);
  });
}
