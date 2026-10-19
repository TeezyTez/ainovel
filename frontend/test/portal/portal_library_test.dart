import 'dart:async';

import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/portal/portal_library.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';
import 'package:elselife_frontend/portal/portal_world_studio_data.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

class DeletableApi extends FakeExperienceApi {
  bool deleted = false;

  @override
  Future<List<ExperienceSummary>> list() async => deleted ? [] : super.list();
}

class LegacySeedApi extends FakeExperienceApi {
  final gate = Completer<void>();
  final legacySeed = '世界名称：旧式测试世界\n\n世界简介：安静的小镇。\n\n内部创作指令：不可在书架显示。';

  @override
  Future<List<ExperienceSummary>> list() async => [
    ExperienceSummary({
      'id': 'legacy-a',
      'title': legacySeed,
      'seed': legacySeed,
      'active_branch_id': 'main',
      'updated_at': '2026-10-13T00:00:00Z',
    }),
  ];

  @override
  Future<ExperienceView> view(String id, {String? branch}) async {
    await gate.future;
    return ExperienceView(
      testView(id: id, branch: branch ?? 'main', text: '真正的开场正文。'),
    );
  }
}

void main() {
  Future<(ExperienceController, FakeExperienceApi, MemoryJournal)> mount(
    WidgetTester tester, {
    FakeExperienceApi? fakeApi,
    MemoryJournal? localJournal,
    ValueChanged<PortalWorldVersion>? onOpenWorldVersion,
    Future<void> Function(String id)? onDeletePermanently,
    Future<void> Function()? onImportRecords,
    ValueChanged<String>? onOpenDemo,
  }) async {
    tester.view.physicalSize = const Size(1100, 900);
    tester.view.devicePixelRatio = 1;
    final api = fakeApi ?? FakeExperienceApi();
    final journal = localJournal ?? MemoryJournal();
    final controller = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await controller.initialize();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      controller.session.dispose();
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await pumpElseLife(
      tester,
      home: Scaffold(
        body: SingleChildScrollView(
          child: PortalLibrary(
            controller: controller,
            onOpen: (_) {},
            onCreate: () {},
            onExplore: () {},
            onOpenWorldVersion: onOpenWorldVersion,
            onDeletePermanently: onDeletePermanently,
            onImportRecords: onImportRecords,
            onOpenDemo: onOpenDemo,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return (controller, api, journal);
  }

  testWidgets('书架首帧不显示技术 seed，旧标题取明确世界名，开场不算回合', (tester) async {
    final api = LegacySeedApi();
    await mount(tester, fakeApi: api);
    expect(find.text('旧式测试世界'), findsWidgets);
    expect(find.text('安静的小镇。'), findsWidgets);
    expect(find.textContaining('内部创作指令'), findsNothing);
    expect(find.text('正在读取进度…'), findsWidgets);
    api.gate.complete();
    await tester.pumpAndSettle();
    expect(find.text('真正的开场正文。'), findsWidgets);
    expect(find.textContaining('0 回合 · 开场'), findsWidgets);
    expect(find.textContaining('1 回合'), findsNothing);
  });

  testWidgets('本机整理元数据与搜索不改正式经历', (tester) async {
    final (controller, api, journal) = await mount(tester);
    final menu = find.byTooltip('整理 测试经历');
    await tester.ensureVisible(menu);
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('置顶'));
    await tester.pumpAndSettle();
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('显示名、备注与分组'));
    await tester.pumpAndSettle();
    final fields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.at(0), '我的新名字');
    await tester.enterText(fields.at(1), '短篇');
    await tester.enterText(fields.at(2), '只存在本机的备注');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    final scope = experienceScope(
      controller.session.backendUrl,
      controller.session.workspaceId,
      'library',
      'personal-v1',
    );
    final personal =
        (journal.rows[scope]!['personal'] as Map)['experience-a'] as Map;
    expect(personal['pinned'], true);
    expect(personal['display_name'], '我的新名字');
    expect(personal['group'], '短篇');
    expect(personal['note'], '只存在本机的备注');
    expect(controller.shelf.single.title, '测试经历');
    expect(api.creates, isEmpty);
    expect(api.sent, isEmpty);

    final search = find.byKey(const ValueKey('portal-library-search'));
    await tester.ensureVisible(search);
    await tester.enterText(search, '只存在本机');
    await tester.pumpAndSettle();
    expect(find.text('我的新名字'), findsWidgets);
    await tester.enterText(search, '找不到');
    await tester.pumpAndSettle();
    expect(find.text('没有找到符合条件的故事'), findsOneWidget);
  });

  testWidgets('本机回收箱可恢复，不删除服务端摘要', (tester) async {
    final (controller, api, journal) = await mount(tester);
    await tester.ensureVisible(find.byTooltip('整理 测试经历'));
    await tester.tap(find.byTooltip('整理 测试经历'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入本机回收箱'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入回收箱'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('更多故事状态'));
    await tester.tap(find.byTooltip('更多故事状态'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('回收箱'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('portal-library-story-experience-a')),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('整理 测试经历'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('恢复经历'));
    await tester.pumpAndSettle();

    final scope = experienceScope(
      controller.session.backendUrl,
      controller.session.workspaceId,
      'library',
      'personal-v1',
    );
    final personal =
        (journal.rows[scope]!['personal'] as Map)['experience-a'] as Map;
    expect(personal['trashed_at'], isNull);
    expect(controller.shelf.single.id, 'experience-a');
    expect(api.creates, isEmpty);
    expect(api.sent, isEmpty);
  });

  testWidgets('搜索当前分支正文并提供原版分组排序入口', (tester) async {
    final api = FakeExperienceApi()..passage = '只有这一幕写着青铜钥匙。';
    await mount(tester, fakeApi: api);
    final search = find.byKey(const ValueKey('portal-library-search'));
    await tester.ensureVisible(search);
    await tester.enterText(search, '青铜钥匙');
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('portal-library-story-experience-a')),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('分组与排序'));
    await tester.pumpAndSettle();
    expect(find.text('所有分组'), findsOneWidget);
    await tester.tap(find.text('完成'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('portal-library-story-experience-a')),
      findsOneWidget,
    );
  });

  testWidgets('书架导入记录入口调用正式归档流程', (tester) async {
    var requested = 0;
    await mount(tester, onImportRecords: () async => requested++);
    await tester.tap(find.byTooltip('经历管理'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('导入记录'));
    await tester.pumpAndSettle();
    expect(requested, 1);
  });

  testWidgets('选择仅存在于本机预设的分组时同步过滤正式经历', (tester) async {
    final journal = MemoryJournal();
    final session = testSession();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: session.backendUrl,
      workspaceId: session.workspaceId,
    );
    final demo = await repository.create('fog-harbor');
    await repository.updatePersonal(demo.id, {'group': '演示分组'});
    session.dispose();
    await mount(tester, localJournal: journal);
    expect(
      find.byKey(const ValueKey('portal-library-story-experience-a')),
      findsOneWidget,
    );
    expect(
      find.byKey(ValueKey('portal-library-demo-${demo.id}')),
      findsOneWidget,
    );

    await tester.tap(find.byTooltip('分组与排序'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('演示分组').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('完成'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('portal-library-story-experience-a')),
      findsNothing,
    );
    expect(
      find.byKey(ValueKey('portal-library-demo-${demo.id}')),
      findsOneWidget,
    );
  });

  testWidgets('本机世界版本显示在书架并打开指定版本', (tester) async {
    final journal = MemoryJournal();
    final session = testSession();
    final draft = PortalWorldDraft()
      ..title = '雾港书店'
      ..description = '海边的旧书店。'
      ..identity = '店主'
      ..location = '旧港'
      ..opening = '雾从海上来。';
    final saved = await PortalWorldRepository(
      journal: journal,
      backendUrl: session.backendUrl,
      workspaceId: session.workspaceId,
    ).saveVersion(draft);
    session.dispose();
    PortalWorldVersion? opened;
    await mount(
      tester,
      localJournal: journal,
      onOpenWorldVersion: (version) => opened = version,
    );
    expect(find.text('我创建的世界'), findsOneWidget);
    expect(find.text('雾港书店'), findsOneWidget);
    await tester.ensureVisible(find.text('雾港书店'));
    await tester.tap(find.text('雾港书店'));
    expect(opened?.draft.id, saved.draft.id);
    expect(opened?.version, 1);
  });

  testWidgets('永久删除成功后正式书架和本机整理记录同步移除', (tester) async {
    final api = DeletableApi();
    final (controller, _, journal) = await mount(
      tester,
      fakeApi: api,
      onDeletePermanently: (id) async {
        expect(id, 'experience-a');
        api.deleted = true;
      },
    );
    final menu = find.byTooltip('整理 测试经历');
    await tester.ensureVisible(menu);
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入本机回收箱'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入回收箱'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('更多故事状态'));
    await tester.tap(find.byTooltip('更多故事状态'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('回收箱'));
    await tester.pumpAndSettle();
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('永久删除'));
    await tester.pumpAndSettle();
    expect(find.text('永久删除这段故事？'), findsOneWidget);
    await tester.tap(find.text('永久删除').last);
    await tester.pumpAndSettle();
    expect(api.deleted, true);
    expect(controller.shelf, isEmpty);
    final scope = experienceScope(
      controller.session.backendUrl,
      controller.session.workspaceId,
      'library',
      'personal-v1',
    );
    final personal = journal.rows[scope]?['personal'] as Map?;
    expect(personal?.containsKey('experience-a') ?? false, false);
  });

  testWidgets('预设演示出现在书架，可按 worldId 进入、重命名、回收与恢复', (tester) async {
    final journal = MemoryJournal();
    final session = testSession();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: session.backendUrl,
      workspaceId: session.workspaceId,
    );
    await repository.ensure('fog-harbor');
    session.dispose();
    String? opened;
    await mount(tester, localJournal: journal, onOpenDemo: (id) => opened = id);
    final card = find.byKey(const ValueKey('portal-library-demo-fog-harbor'));
    await tester.ensureVisible(card);
    expect(card, findsOneWidget);
    await tester.tap(card);
    expect(opened, 'fog-harbor');
    final menu = find.byTooltip('整理 雾港来信');
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('显示名、备注与分组').last);
    await tester.pumpAndSettle();
    final fields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.at(0), '雾港夜记');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect((await repository.entry('fog-harbor'))?.title, '雾港夜记');
    await tester.tap(find.byTooltip('整理 雾港夜记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入本机回收箱').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('移入回收箱').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('更多故事状态'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('回收箱').last);
    await tester.pumpAndSettle();
    expect(card, findsOneWidget);
    await tester.tap(find.byTooltip('整理 雾港夜记'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('恢复经历').last);
    await tester.pumpAndSettle();
    expect((await repository.entry('fog-harbor'))?.trashedAt, isNull);
  });

  testWidgets('只读开场出现在书架并以独立经历进入，显示原开场', (tester) async {
    final journal = MemoryJournal();
    final session = testSession();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: session.backendUrl,
      workspaceId: session.workspaceId,
    );
    final first = await repository.createReadOnly(
      worldId: 'my-world',
      title: '雨中的书店',
      opening: '雨声落在玻璃上，来客推开了门。',
    );
    session.dispose();
    String? opened;
    await mount(tester, localJournal: journal, onOpenDemo: (id) => opened = id);
    final card = find.byKey(ValueKey('portal-library-demo-${first.id}'));
    await tester.ensureVisible(card);
    expect(card, findsOneWidget);
    expect(find.text('只读开场'), findsWidgets);
    expect(find.textContaining('雨声落在玻璃上'), findsWidgets);
    expect(find.textContaining('/ 8 个固定片刻'), findsNothing);
    await tester.tap(card);
    expect(opened, first.id);
  });
}
