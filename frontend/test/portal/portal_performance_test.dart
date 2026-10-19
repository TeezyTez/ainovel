import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/portal/portal_home.dart';
import 'package:elselife_frontend/portal/portal_navigation.dart';
import 'package:elselife_frontend/portal/portal_scene.dart';
import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

void main() {
  testWidgets('scroll only updates scene and suspends it outside viewport', (tester) async {
    tester.view.physicalSize = const Size(1440, 960);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await pumpElseLife(tester, home: Scaffold(body: PortalHome(
      journal: MemoryJournal(), onExplore: () {}, onCreate: () {},
      onOpenShelf: () {}, onOpenWorld: (_) {},
    )));
    await tester.pumpAndSettle();
    final navigation = tester.widget(find.byType(PortalNavigation).first);
    final scroll = tester.widget<SingleChildScrollView>(find.byType(SingleChildScrollView).first).controller!;
    scroll.jumpTo(200);
    await tester.pump();
    expect(identical(navigation, tester.widget(find.byType(PortalNavigation).first)), isTrue,
      reason: 'Scrolling must not rebuild navigation or the entire catalog');
    expect(tester.widget<PortalScene>(find.byType(PortalScene)).progress, greaterThan(0));
    scroll.jumpTo(950);
    await tester.pump();
    expect(tester.widget<PortalScene>(find.byType(PortalScene)).paused, isTrue);
    scroll.jumpTo(0);
    await tester.pump();
    expect(tester.widget<PortalScene>(find.byType(PortalScene)).paused, isFalse);
    expect(find.text('暂停动态'), findsNothing);
    expect(find.text('继续动态'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
