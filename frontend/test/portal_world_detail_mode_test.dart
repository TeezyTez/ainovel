import 'package:elselife_frontend/experience/demo_world_catalog.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';
import 'package:elselife_frontend/portal/portal_world_detail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/experience_fixture.dart';

void main() {
  testWidgets('preset start ignores legacy style while retaining pace', (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    String? submitted;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldDetail(
            world: demoWorldPresets.first,
            onBack: () {},
            onStart: (seed) => submitted = seed,
            modelAvailable: true,
            selfScrolling: true,
            demoJournal: MemoryJournal(),
            narrativeDefaults: const {
              'style': 'LEGACY_SETTINGS_STYLE',
              'pace': '紧凑',
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final start = find.byKey(const ValueKey('portal-world-start'));
    await tester.ensureVisible(start);
    await tester.tap(start);
    await tester.pump();
    expect(submitted, contains('紧凑'));
    expect(submitted, isNot(contains('LEGACY_SETTINGS_STYLE')));
    expect(submitted, isNot(contains('细腻克制')));
  });

  Future<void> showDetail(
    WidgetTester tester,
    bool modelAvailable, {
    bool modelChecked = true,
  }) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldDetail(
            world: demoWorldPresets.first,
            onBack: () {},
            onStart: (_) {},
            modelAvailable: modelAvailable,
            modelChecked: modelChecked,
            selfScrolling: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('连接检查从离线恢复时默认切回模型；手选模式保留', (tester) async {
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await showDetail(tester, false, modelChecked: false);
    expect(find.text('正在检查连接…'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('portal-world-start')),
          )
          .onPressed,
      isNull,
    );
    await showDetail(tester, false);
    expect(find.text('进入世界'), findsOneWidget);
    expect(find.textContaining('预设演示 · 选择建议'), findsOneWidget);
    await showDetail(tester, true);
    expect(find.text('进入世界'), findsOneWidget);
    expect(find.text('自由行动'), findsOneWidget);

    await showDetail(tester, false);
    await tester.ensureVisible(find.text('角色与游玩设置'));
    await tester.tap(find.text('角色与游玩设置'));
    await tester.pumpAndSettle();
    final selector = find.byType(DropdownButtonFormField<String>);
    await tester.ensureVisible(selector.first);
    await tester.tap(selector.first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('预设演示 · 固定剧情').last);
    await tester.pumpAndSettle();
    expect(find.text('进入世界'), findsOneWidget);
    expect(find.textContaining('预设演示 · 选择建议'), findsOneWidget);
    await showDetail(tester, true);
    expect(find.text('进入世界'), findsOneWidget);
    expect(find.textContaining('预设演示 · 选择建议'), findsOneWidget);
  });

  testWidgets('无脚本世界只读开场创建独立本机经历并可恢复', (tester) async {
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    final journal = MemoryJournal();
    final world = demoWorldPresets.last;
    final scope = experienceScope(
      'https://world.test',
      'local',
      'portal-demo',
      world.id,
    );
    final repository = PortalDemoRepository.fromSessionScope(
      journal: journal,
      scope: scope,
    );
    final opened = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldDetail(
            world: world,
            onBack: () {},
            onStart: (_) => fail('离线只读模式不应启动正式故事'),
            modelAvailable: false,
            selfScrolling: true,
            demoJournal: journal,
            demoScope: scope,
            onDemoOpened: opened.add,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('进入世界'), findsOneWidget);
    await tester.ensureVisible(
      find.byKey(const ValueKey('portal-world-start')),
    );
    await tester.tap(find.byKey(const ValueKey('portal-world-start')));
    await tester.pumpAndSettle();
    expect(opened, hasLength(1));
    final entry = await repository.entry(opened.single);
    expect(entry?.readOnly, true);
    expect(entry?.latestProse, isNotEmpty);
    expect(entry?.worldId, world.id);
  });
}
