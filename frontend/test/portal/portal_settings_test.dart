import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';
import 'package:elselife_frontend/portal/portal_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sembast/sembast_memory.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  test('legacy style is ignored when loading and restoring story preferences', () async {
    final journal = MemoryJournal();
    final preferences = PortalPreferences(
      journal: journal,
      backendUrl: 'a',
      workspaceId: 'legacy-style',
    );
    await journal.patch(preferences.scope, {'style': '诗意留白', 'pace': '紧凑'});
    await preferences.hydrate();
    expect(preferences.values.containsKey('style'), isFalse);
    expect(preferences.text('pace'), '紧凑');
    await preferences.restore({
      'style': '明快简洁',
      'perspective': '第一人称',
    });
    expect(preferences.values.containsKey('style'), isFalse);
    expect(preferences.text('perspective'), '第一人称');
    preferences.dispose();
  });
  test('settings clamp invalid stored numbers, persist and isolate workspaces', () async {
    final journal = MemoryJournal();
    final preferences = PortalPreferences(journal: journal,backendUrl:'a',workspaceId:'one');
    await journal.patch(preferences.scope, {'fontSize':500,'lineHeight':0,'theme':'bad','sendEnter':true});
    await preferences.hydrate();
    expect(preferences.fontSize,30); expect(preferences.lineHeight,1.5);expect(preferences.theme,'light');
    await preferences.setValue('theme','dark');await preferences.setValue('width',640);
    final other = PortalPreferences(journal:journal,backendUrl:'a',workspaceId:'two');await other.hydrate();expect(other.theme,'light');
    final reopened = PortalPreferences(journal:journal,backendUrl:'a',workspaceId:'one');await reopened.hydrate();expect(reopened.theme,'dark');expect(reopened.width,640);
    preferences.dispose();other.dispose();reopened.dispose();
  });
  test('backup only includes current workspace and never restores in-flight requests', () async {
    final db = await databaseFactoryMemory.openDatabase('backup-test');
    final journal = LocalExperienceJournal(database:db);
    final scope = experienceScope('a','one','story','branch');
    await journal.patch(scope,{'draft':'unfinished','attempt':{'request':'secret-id'}});
    await journal.patch(experienceScope('b','one','other','branch'),{'draft':'other server'});
    final exported = await journal.exportWorkspace('a','one');
    expect(exported,hasLength(1));expect((exported.values.single as Map).containsKey('attempt'),isFalse);
    await journal.importWorkspace('a','two',exported);
    final restored = await journal.read(experienceScope('a','two','story','branch'));expect(restored['draft'],'unfinished');expect(restored.containsKey('attempt'),isFalse);
    await journal.patch(experienceScope('a','two','story','branch'),{'draft':'newer'});
    await journal.importWorkspace('a','two',exported);expect((await journal.read(experienceScope('a','two','story','branch')))['draft'],'newer');
    final catalog = experienceScope('a','two','world-studio','catalog');
    await journal.patch(catalog,{'versions':[{'snapshot':{'id':'one'},'version':1}]});
    await journal.importWorkspace('a','two',{'["world-studio","catalog"]':{'versions':[{'snapshot':{'id':'two'},'version':1}]}});
    expect((await journal.read(catalog))['versions'],hasLength(2));
    await expectLater(journal.importWorkspace('a','two',{'["broken","branch"]':{'draft':42}}),throwsFormatException);
    expect(await journal.read(experienceScope('a','two','broken','branch')),isEmpty);
    await db.close();
  });
  test('backup preserves demo progress and author version associations across workspace restore', () async {
    final db=await databaseFactoryMemory.openDatabase('combined-backup-test');
    final journal=LocalExperienceJournal(database:db);
    final links={'story-one':{'snapshot':{'id':'world-one','title':'测试世界','characters':[{'name':'旅人','secret':'作者字段'}]},'version':2}};
    final demos={'state:local-one':{'world_id':'fog-harbor','session':{'step':2,'turns':[{'input':'固定选择','prose':'固定正文'}]}}};
    await journal.patch(experienceScope('a','source','story-worlds','versions'),links);
    await journal.patch(experienceScope('a','source','portal-demo','catalog'),demos);
    await journal.patch(experienceScope('a','target','portal-demo','catalog'),{'state:keep':{'session':{'step':5}}});
    final backup=await journal.exportWorkspace('a','source');
    await journal.importWorkspace('a','target',backup);
    expect(await journal.read(experienceScope('a','target','story-worlds','versions')),links);
    final restored=await journal.read(experienceScope('a','target','portal-demo','catalog'));
    expect(restored['state:local-one'],demos['state:local-one']);
    expect((restored['state:keep'] as Map)['session'],{'step':5});
    await journal.importWorkspace('a','target',backup);
    expect(await journal.read(experienceScope('a','target','portal-demo','catalog')),restored);
    await db.close();
  });
  for (final width in [390.0,1200.0]) {
    testWidgets('settings source sections and actions fit $width', (tester) async {
      tester.view.physicalSize = Size(width,1000);tester.view.devicePixelRatio = 1;
      final prefs = PortalPreferences(journal:MemoryJournal(),backendUrl:'a',workspaceId:'one');await prefs.hydrate();
      var exports = 0;
      await pumpElseLife(tester,home:Scaffold(body:SingleChildScrollView(child:Padding(padding:const EdgeInsets.all(20),child:PortalSettings(
        preferences:prefs,checkModel:()async=>{'available':true,'provider':'Codex','model':'test'},
        exportAll:()async{exports++;},importAll:()async{},clearDemo:()async{},exportEvents:()async{},onContentPreferences:(){})))));
      await tester.pumpAndSettle();expect(tester.takeException(),isNull);
      await tester.tap(find.text('新故事偏好'));await tester.pumpAndSettle();expect(find.text('仅用于新故事。'),findsOneWidget);
      await tester.tap(find.text('生成服务'));await tester.pumpAndSettle();expect(find.text('已配置 · Codex'),findsOneWidget);
      await tester.tap(find.text('数据与备份'));await tester.pumpAndSettle();
      final export = find.text('导出作者完整备份');await tester.ensureVisible(export);await tester.tap(export);await tester.pumpAndSettle();expect(exports,1);expect(tester.takeException(),isNull);
      await tester.pumpWidget(const SizedBox.shrink());prefs.dispose();tester.view.reset();
    });
  }
}
