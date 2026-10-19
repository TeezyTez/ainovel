import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/demo_world_catalog.dart';
import 'package:elselife_frontend/portal/portal_home.dart';
import 'package:elselife_frontend/portal/portal_home_preferences.dart';

class _Journal implements ExperienceJournal {
  final records = <String, Map<String,dynamic>>{};
  @override Future<Map<String,dynamic>> read(String scope) async => {...?records[scope]};
  @override Future<void> patch(String scope, Map<String,dynamic> values) async {
    records[scope]={...?records[scope],...values};
  }
}
void main() {
  test('catalog choices persist independently and are workspace scoped',() async {
    final journal=_Journal();
    final a=PortalHomePreferences(journal:journal,backendUrl:'http://a',workspaceId:'a');
    await Future.wait([a.saveWorld('fog-harbor',favorite:true,enabled:true),a.saveWorld('mountain',favorite:false,enabled:true)]);
    final reloaded=await PortalHomePreferences(journal:journal,backendUrl:'http://a',workspaceId:'a').load();
    expect(reloaded.favorites,{'fog-harbor'}); expect(reloaded.hidden,{'mountain'});
    expect((await PortalHomePreferences(journal:journal,backendUrl:'http://a',workspaceId:'b').load()).favorites,isEmpty);
    await a.saveWorld('mountain',favorite:false,enabled:false);
    expect((await a.load()).hidden,isEmpty);
  });
  testWidgets('search uses source description and surprise only chooses eligible worlds',(tester) async {
    tester.view.physicalSize=const Size(1440,1000);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final opened=<DemoWorldPreset>[];
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:PortalHome(
      journal:_Journal(),catalogOnly:true,onExplore:(){},onCreate:(){},onOpenShelf:(){},onOpenWorld:opened.add)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('搜索与筛选'));await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField),'房租');
    await tester.tap(find.text('搜索',skipOffstage:false));await tester.pumpAndSettle();
    expect(find.text('星期四书店'),findsOneWidget);expect(find.text('雾港来信'),findsNothing);
    await tester.tap(find.text('替我挑一个'));await tester.pumpAndSettle();
    expect(opened.single.id,'thursday');expect(tester.takeException(),isNull);
  });
  testWidgets('hidden worlds restore and favorites survive remount',(tester) async {
    tester.view.physicalSize=const Size(1440,1000);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final journal=_Journal();
    Widget page()=>MaterialApp(home:Scaffold(body:SingleChildScrollView(child:PortalHome(journal:journal,catalogOnly:true,
      onExplore:(){},onCreate:(){},onOpenShelf:(){},onOpenWorld:(_){}))));
    await tester.pumpWidget(page());await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('雾港来信的开局选项'));await tester.pumpAndSettle();
    await tester.tap(find.text('收藏'));await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());await tester.pumpWidget(page());await tester.pumpAndSettle();
    expect(find.text('已收藏'),findsOneWidget);
    await tester.tap(find.byTooltip('雾港来信的开局选项'));await tester.pumpAndSettle();
    await tester.tap(find.text('隐藏世界'));await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('portal-world-fog-harbor')),findsNothing);
    await tester.ensureVisible(find.text('已隐藏 · 1'));await tester.tap(find.text('已隐藏 · 1'));await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('重新显示'));await tester.tap(find.text('重新显示'));await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('portal-world-fog-harbor')),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
  testWidgets('320px source hero, catalog and footer fit without overflow',(tester) async {
    tester.view.physicalSize=const Size(320,740);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:PortalHome(journal:_Journal(),
      onExplore:(){},onCreate:(){},onOpenShelf:(){},onOpenWorld:(_){},onSettings:(){},onThemeChanged:(_){}))));
    await tester.pumpAndSettle();expect(tester.takeException(),isNull);
    await tester.ensureVisible(find.text('ANOTHER LIFE, YOUR WAY.'));await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
  });
}
