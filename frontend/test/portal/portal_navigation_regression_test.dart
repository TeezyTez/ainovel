import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/portal_product_screen.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import 'package:elselife_frontend/portal/portal_theme.dart';
import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

void main() {
  for (final width in [1440.0, 780.0, 390.0]) {
    testWidgets('navigation stays aligned through home/shelf/settings at $width', (tester) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      final controller = ExperienceController(session:testSession(), api:FakeExperienceApi(), journal:MemoryJournal());
      await controller.initialize();
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        controller.dispose(); controller.session.dispose(); tester.view.reset();
      });
      await pumpElseLife(tester, theme:portalThemeData('paper'), home:PortalProductScreen(
        controller:controller, onPreferences:(){}, initialPath:'/',
        service:PortalServiceClient(()=>'http://localhost',client:MockClient((_) async => http.Response('{"available":true}',200))),
      ));
      await tester.pumpAndSettle();
      final brand = tester.getRect(find.text('elselife').first);
      final discover = tester.getRect(find.text('发现').last);
      final theme = tester.getRect(find.text('浅色').first);
      await tester.tap(find.text('我的世界').last);
      await tester.pumpAndSettle();
      expect(tester.getRect(find.text('elselife').first), brand, reason:'Brand must not jump or resize between pages');
      expect(tester.getRect(find.text('发现').last), discover, reason:'Navigation must remain anchored');
      expect(tester.getRect(find.text('浅色').first), theme, reason:'Theme selector must remain anchored');
      await tester.tap(find.text('设置').last);
      await tester.pumpAndSettle();
      expect(tester.getRect(find.text('elselife').first), brand);
      expect(tester.getRect(find.text('发现').last), discover);
      await tester.tap(find.text('发现').last);
      await tester.pumpAndSettle();
      expect(find.text('世界之外，'), findsOneWidget, reason:'Discover tab always returns to the same landing page');
      expect(tester.getRect(find.text('elselife').first), brand);
      expect(tester.takeException(),isNull);
    });
  }
  testWidgets('discover from shelf returns to the same discovery landing', (tester) async {
    tester.view.physicalSize=const Size(1440,1000); tester.view.devicePixelRatio=1;
    final c=ExperienceController(session:testSession(),api:FakeExperienceApi(),journal:MemoryJournal());
    await c.initialize();
    addTearDown(()async{await tester.pumpWidget(const SizedBox.shrink());c.dispose();c.session.dispose();tester.view.reset();});
    await pumpElseLife(tester,theme:portalThemeData('paper'),home:PortalProductScreen(controller:c,onPreferences:(){},initialPath:'/stories',
      service:PortalServiceClient(()=>'http://localhost',client:MockClient((_)async=>http.Response('{"available":true}',200)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('发现').first); await tester.pumpAndSettle();
    expect(find.text('世界之外，'),findsOneWidget);
  });
}
