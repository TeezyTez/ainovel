import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_gameplay.dart';

Json item(String id, String name, {int value = 2}) => {
  'id': id,
  'name': name,
  'kind': 'item',
  'value': value,
  'unit': '枚',
  'detail': '当前账本',
  'status': '',
  'sourceVersion': 2,
};
Json record(String id, String name, {List<Json> fields = const []}) => {
  'id': id,
  'name': name,
  'kind': 'item',
  'summary': '旧记录',
  'fields': fields,
  'relatedIds': <String>[],
  'sourceVersion': 1,
};
ReaderGameplay snapshot(List<Json> entities, List<Json> records) =>
    ReaderGameplay({
      'schemaVersion': 1,
      'location': '',
      'inventory': <String>[],
      'game': {'entities': entities, 'surfaces': <Json>[]},
      'experience': {'objects': records},
    });
void main() {
  test('旧事实标为历史并移除已不存在的关联ID，不补未记录的来源', () {
    final values = snapshot([], []).overlayObjects([
      {
        'id': 'fact-old',
        'kind': 'fact',
        'name': '旧记录',
        'sourceVersion': 1,
        'relatedIds': ['missing', 'fact-unknown'],
      },
      {
        'id': 'fact-unknown',
        'kind': 'fact',
        'name': '来源未记录',
        'relatedIds': <String>[],
      },
    ], 2);
    expect(values.first['status'], '历史记录');
    expect(values.first['relatedIds'], ['fact-unknown']);
    expect(values.last['status'], isNull);
    expect(values.last['sourceVersion'], isNull);
  });
  test('结构化旧数量别名只删除原版散列回退记录，不猜显式对象或正文', () {
    final old = record(
      'coins',
      '铜钱',
      fields: [
        {'key': 'amount', 'value': '12'},
        {'key': 'unit', 'value': '枚'},
      ],
    );
    final values = snapshot([item('coins', '铜钱')], [old]).overlayObjects([
      record(readerKnownObjectId('item', '铜钱12枚'), '铜钱12枚'),
      record(readerKnownObjectId('item', '铜钱2枚'), '铜钱2枚'),
      record('explicit-name', '铜钱12枚'),
      record(readerKnownObjectId('item', '铜钱99枚'), '铜钱99枚'),
    ], 2);
    expect(
      values.map((o) => o['id']),
      containsAll([
        'coins',
        'explicit-name',
        readerKnownObjectId('item', '铜钱99枚'),
      ]),
    );
    expect(values.length, 3);
    expect(
      (values.lastWhere((o) => o['id'] == 'coins')['fields'] as List)
          .where((f) => f['key'] == 'amount')
          .single['value'],
      '2',
    );
  });
  test('同名实体不合并，数量已含单位不重复，零数量按原版显示耗尽', () {
    final legacy = record(readerKnownObjectId('item', '铜钱2枚'), '铜钱2枚');
    final ambiguous = snapshot([
      item('a', '铜钱'),
      item('b', '铜钱'),
    ], []).overlayObjects([legacy], 2);
    expect(ambiguous.length, 3);
    final source = snapshot(
      [item('a', '铜钱', value: 0)],
      [
        record(
          'a',
          '铜钱',
          fields: [
            {'key': 'amount', 'value': '12枚'},
            {'key': 'unit', 'value': '枚'},
          ],
        ),
      ],
    );
    expect(source.itemAliases(item('a', '铜钱', value: 0), 2), {
      '铜钱',
      '铜钱0枚',
      '铜钱12枚',
    });
    expect(source.overlayObjects([], 2).single['status'], '已耗尽');
  });
  test('原版回退ID保持大小写与空白正规化稳定', () {
    expect(
      readerKnownObjectId('item', '  Copper   COIN '),
      readerKnownObjectId('item', 'copper coin'),
    );
    expect(readerKnownObjectId('item', '铜钱'), 'item:1atk9jy');
  });
}
