import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/reader_projection.dart';
import 'package:elselife_frontend/portal/portal_demo_script.dart';
import 'package:elselife_frontend/portal/portal_demo_public_projection.dart';

void main() {
  test('公开投影保留初始人物地点与规则，不包含作者秘密', () {
    const state = PortalDemoState();
    final projection = ReaderProjection(
      portalDemoPublicProjection('fog-harbor', state, 0),
    );
    expect(
      projection.information.where((item) => item.kind == 'person'),
      hasLength(4),
    );
    expect(
      projection.information.where((item) => item.kind == 'location'),
      hasLength(1),
    );
    expect(
      projection.information.where((item) => item.kind == 'rule'),
      hasLength(3),
    );
    expect(
      jsonEncode(projection.information.map((item) => item.text).toList()),
      isNot(contains('她发现自己的父亲曾在补发电报')),
    );
  });

  test('关系、物品与事实按原脚本所选 variant 重放，历史页不提前泄漏', () {
    var state = const PortalDemoState();
    state = PortalDemoScript.choose('fog-harbor', state, 'ask-register');
    state = PortalDemoScript.choose('fog-harbor', state, 'continue');
    state = PortalDemoScript.choose('fog-harbor', state, 'trace-record');
    state = PortalDemoScript.choose('fog-harbor', state, 'revisit-lin');
    final current = portalDemoPublicProjection('fog-harbor', state, 4);
    final prior = portalDemoPublicProjection('fog-harbor', state, 2);
    final currentInfo = (current['information'] as List).cast<Map>();
    final lin = currentInfo.firstWhere((item) => item['id'] == 'entity:lin');
    final fields = (lin['fields'] as List).cast<Map>();
    expect(fields.single['value'], '因先前尊重手续，愿意主动协助核对公开材料');
    expect(currentInfo.any((item) => item['name'] == '公开电报索引'), isTrue);
    expect(currentInfo.any((item) => item['name'] == '补发记录查阅回执'), isTrue);
    expect(
      (prior['information'] as List).cast<Map>().any(
        (item) => item['name'] == '公开电报索引',
      ),
      isFalse,
    );
    final records = ReaderProjection(current).records;
    expect(records.where((record) => record.kind == 'item'), hasLength(2));
    expect(
      records.every(
        (record) => currentInfo.any((item) => item['id'] == record.entityId),
      ),
      isTrue,
    );
    expect(jsonEncode(current), isNot(contains('fog-harbor:approach')));

    var pressured = const PortalDemoState();
    pressured = PortalDemoScript.choose(
      'fog-harbor',
      pressured,
      'demand-original',
    );
    pressured = PortalDemoScript.choose('fog-harbor', pressured, 'continue');
    pressured = PortalDemoScript.choose('fog-harbor', pressured, 'continue');
    pressured = PortalDemoScript.choose('fog-harbor', pressured, 'revisit-lin');
    final pressureInfo =
        (portalDemoPublicProjection('fog-harbor', pressured, 4)['information']
                as List)
            .cast<Map>();
    expect(pressureInfo.any((item) => item['name'] == '公开电报目录'), isTrue);
    expect(pressureInfo.any((item) => item['name'] == '公开电报索引'), isFalse);
  });

  test('三段八回合的每页投影均可解析且没有隐藏 flag', () {
    for (final worldId in ['fog-harbor', 'mountain', 'thursday']) {
      var state = const PortalDemoState();
      for (var revision = 0; revision <= 8; revision++) {
        final projection = portalDemoPublicProjection(worldId, state, revision);
        expect(ReaderProjection(projection).revision, revision);
        expect(jsonEncode(projection), isNot(contains('"kind":"flag"')));
        if (revision < 8) {
          state = PortalDemoScript.choose(worldId, state, 'continue');
        }
      }
    }
  });
}
