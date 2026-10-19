import 'dart:async';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/portal_product_screen.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import 'package:elselife_frontend/portal/portal_settings.dart';
import 'package:elselife_frontend/portal/portal_home.dart';
import 'package:elselife_frontend/portal/portal_world_studio.dart';
import 'package:elselife_frontend/portal/portal_world_detail.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';
import 'package:elselife_frontend/portal/portal_demo_reader.dart';
import 'package:elselife_frontend/portal/portal_library.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

void main() {
  testWidgets('返回世界优先匹配保存的世界ID，不误进同名的最近故事',(tester)async{
    final api=_SameTitleApi(),journal=MemoryJournal();
    final controller=ExperienceController(session:testSession(),api:api,journal:journal);
    await controller.initialize();
    await journal.patch(experienceScope(controller.session.backendUrl,controller.session.workspaceId,'story-worlds','versions'),{
      'newer':{'snapshot':{'id':'another-world','title':'雾港来信'}},
      'older':{'snapshot':{'id':'fog-harbor','title':'雾港来信'}},
    });
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();});
    await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},initialPath:'/world/fog-harbor',service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
    await tester.pumpAndSettle();
    expect(tester.widget<PortalWorldDetail>(find.byType(PortalWorldDetail)).previous?.id,'older');
    expect(tester.takeException(),isNull);
  });
  testWidgets('自定义只读开场链接刷新恢复原快照，不依赖内置世界或调用模型',(tester)async{
    final api=FakeExperienceApi(),journal=MemoryJournal();
    final controller=ExperienceController(session:testSession(),api:api,journal:journal);
    await controller.initialize();
    final repository=PortalDemoRepository(journal:journal,backendUrl:controller.session.backendUrl,workspaceId:controller.session.workspaceId);
    final entry=await repository.createReadOnly(worldId:'custom-only',title:'雨中庭院',opening:'你站在院门口，雨水沿檐角落下。');
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();});
    await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},initialPath:'/story/${entry.id}',service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":false}',200)))));
    await tester.pumpAndSettle();
    expect(find.byType(PortalDemoReader),findsOneWidget);
    expect(find.textContaining('你站在院门口'),findsWidgets);
    expect(tester.widget<ExperienceScreen>(find.byType(ExperienceScreen)).localReadOnly,isTrue);
    expect(api.creates,isEmpty);
    expect(tester.takeException(),isNull);
  });
  testWidgets('刷新故事链接等初始化完成再打开，保留所选故事',(tester)async{
    final api=FakeExperienceApi(),ready=Completer<void>();
    final controller=ExperienceController(session:testSession(),api:api,journal:MemoryJournal());
    await controller.initialize();
    final id=controller.shelf.first.id;
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();});
    await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},initialPath:'/story/$id',ready:ready.future,service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
    await tester.pumpAndSettle();
    expect(find.byType(ExperienceScreen),findsNothing);
    ready.complete();await tester.pumpAndSettle();
    expect(find.byType(ExperienceScreen),findsOneWidget);
    expect(controller.current?.id,id);
    expect(tester.takeException(),isNull);
  });
  testWidgets('离开正在加载的经历后，迟到响应不会覆盖最新导航',(tester)async{
    final api=_DelayedViewApi();
    final controller=ExperienceController(session:testSession(),api:api,journal:MemoryJournal());
    await controller.initialize();
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();});
    await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
    await tester.pumpAndSettle();
    api.viewGate=Completer<void>();
    final resume=find.text('回到世界');await tester.ensureVisible(resume);await tester.tap(resume);await tester.pump();
    await tester.tap(find.text('设置').first);await tester.pumpAndSettle();
    api.viewGate!.complete();await tester.pumpAndSettle();
    expect(find.byType(PortalSettings),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
  testWidgets('首页继续预设按独立存档进入共享阅读器，返回书架不调用正式创建',(tester)async{
    tester.view.physicalSize=const Size(390,900);tester.view.devicePixelRatio=1;
    final journal=MemoryJournal(),api=FakeExperienceApi();
    final controller=ExperienceController(session:testSession(),api:api,journal:journal);
    await controller.initialize();
    final repository=PortalDemoRepository(journal:journal,backendUrl:controller.session.backendUrl,workspaceId:controller.session.workspaceId);
    final first=await repository.create('fog-harbor');
    final second=await repository.create('fog-harbor');
    await repository.updatePersonal(first.id,{'display_name':'旧片刻'});
    await repository.updatePersonal(second.id,{'display_name':'最新片刻'});
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();tester.view.reset();});
    await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
    await tester.pumpAndSettle();
    final resume=find.text('回到世界');await tester.ensureVisible(resume);await tester.tap(resume);await tester.pumpAndSettle();
    expect(tester.widget<PortalDemoReader>(find.byType(PortalDemoReader)).sessionId,second.id);
    expect(api.creates,isEmpty);
    await tester.tap(find.byTooltip('返回我的世界'));await tester.pumpAndSettle();
    expect(find.byType(PortalLibrary),findsOneWidget);
    expect((await repository.loadEntries()).length,2);
    expect(tester.takeException(),isNull);
  });
  for(final width in [320.0,390.0,780.0,1200.0]){
    testWidgets('内页导航和设置在 $width 宽度完整可操作',(tester)async{
      tester.view.physicalSize=Size(width,900);tester.view.devicePixelRatio=1;
      final controller=ExperienceController(session:testSession(),api:FakeExperienceApi(),journal:MemoryJournal());
      await controller.initialize();
      addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());controller.dispose();controller.session.dispose();tester.view.reset();});
      await pumpElseLife(tester,home:PortalProductScreen(controller:controller,onPreferences:(){},service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('设置').first);await tester.pumpAndSettle();
      expect(find.byType(PortalSettings),findsOneWidget);
      expect(find.text('浅色'),findsWidgets);
      if(width<=800)expect(find.text('创造世界'),findsWidgets);
      final data=find.text('数据与备份').first;
      await tester.ensureVisible(data);await tester.tap(data);await tester.pumpAndSettle();
      expect(find.text('导出本机记录'),findsOneWidget);
      await tester.tap(find.text('发现').last);await tester.pumpAndSettle();
      expect(find.byType(PortalHome),findsOneWidget);
      await tester.tap(find.text('设置').first);await tester.pumpAndSettle();
      expect(find.text('导出本机记录'),findsOneWidget);
      await tester.tap(find.text('创造世界').last);await tester.pumpAndSettle();
      expect(find.byType(PortalWorldStudio),findsOneWidget);
      expect(find.text('设置'),findsWidgets);
      await tester.tap(find.text('设置').first);await tester.pumpAndSettle();
      expect(find.text('导出本机记录'),findsOneWidget);
      expect(tester.takeException(),isNull);
    });
  }
  testWidgets('浏览世界不生成；进入世界提交公开设定及玩家选择一次', (tester) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    final api = FakeExperienceApi();
    final controller = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    await controller.initialize();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      controller.session.dispose();
      tester.view.reset();
    });
    await pumpElseLife(
      tester,
      home: PortalProductScreen(controller: controller, onPreferences: () {},service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))),
    );
    await tester.pumpAndSettle();
    final world = find.byKey(const ValueKey('portal-world-fog-harbor')).last;
    await tester.ensureVisible(world);
    await tester.tap(world);
    await tester.pumpAndSettle();
    expect(api.creates, isEmpty);
    expect(controller.current, isNull);

    final settings = find.text('角色与游玩设置');
    await tester.ensureVisible(settings);
    await tester.tap(settings);
    await tester.pumpAndSettle();
    final name = find.byKey(const ValueKey('portal-player-name'));
    await tester.ensureVisible(name);
    await tester.enterText(name, '许舟');
    final identity = find.byKey(const ValueKey('portal-player-identity'));
    await tester.ensureVisible(identity);
    await tester.enterText(identity, '回乡的修钟师');
    expect(api.creates, isEmpty);
    final start = find.byKey(const ValueKey('portal-world-start'));
    await tester.ensureVisible(start);
    await tester.tap(start);
    await tester.pumpAndSettle();
    expect(api.creates, hasLength(1));
    final seed = api.creates.single['seed'] as String;
    expect(seed, contains('玩家角色名：许舟'));
    expect(seed, contains('玩家确认的身份：回乡的修钟师'));
    expect(seed, contains('林见微'));
    expect(seed, contains('港务档案'));
    expect(api.creates.single['world_version'],isA<Map>());
    expect((api.creates.single['world_version'] as Map)['public_seed'],seed);
    final author=api.creates.single['author_world'] as Map;
    expect(author['characters'],isNotEmpty);
    for(final person in author['characters'] as List){
      final secret=(person as Map)['secret'] as String;
      if(secret.isNotEmpty)expect(seed,isNot(contains(secret)));
    }
    expect(controller.current, isNotNull);
    expect(tester.takeException(), isNull);
    await controller.cancel();
    await tester.pumpAndSettle();
  });
}

class _DelayedViewApi extends FakeExperienceApi{
  Completer<void>? viewGate;
  @override Future<ExperienceView> view(String id,{String? branch})async{
    final wait=viewGate;if(wait!=null)await wait.future;
    return super.view(id,branch:branch);
  }
}

class _SameTitleApi extends FakeExperienceApi{
  @override Future<List<ExperienceSummary>> list()async=>[
    for(final id in ['newer','older'])ExperienceSummary({'id':id,'title':'同名经历','seed':'世界名称：雾港来信','active_branch_id':'main','updated_at':id=='newer'?'2026-10-15T00:00:00Z':'2026-10-14T00:00:00Z'}),
  ];
}
