import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/portal/portal_theme.dart';
import 'package:elselife_frontend/portal/portal_card_surface.dart';
import 'package:elselife_frontend/portal/portal_home.dart';
import 'package:elselife_frontend/ui/theme/elselife_theme.dart';
import '../support/elselife_test_app.dart';
import '../support/experience_fixture.dart';

void main() {
  for (final width in [360.0, 768.0, 1440.0]) {
    for (final id in ['paper', 'ink']) {
      testWidgets('$id discovery fits ${width.toInt()}px with product theme', (tester) async {
        tester.view.physicalSize = Size(width, 960);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await pumpElseLife(tester, theme: portalThemeData(id), home: Scaffold(body: PortalHome(
          journal: MemoryJournal(), reduceMotion: true,
          onExplore: () {}, onCreate: () {}, onOpenShelf: () {}, onOpenWorld: (_) {}, onSettings: () {},
        )));
        await tester.pumpAndSettle();
        expect(find.text('世界之外，'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(SingleChildScrollView).first, const Offset(0, -700));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }
  for (final id in ['paper', 'ink']) {
    test('$id reading and action labels meet normal-text contrast', () {
      final theme = portalThemeData(id), c = theme.colorScheme;
      expect(elseLifeContrast(c.onSurface, c.surface), greaterThanOrEqualTo(4.5));
      expect(elseLifeContrast(c.onSurfaceVariant, c.surface), greaterThanOrEqualTo(4.5));
      final style = theme.filledButtonTheme.style!;
      expect(elseLifeContrast(style.foregroundColor!.resolve({})!,
          style.backgroundColor!.resolve({})!), greaterThanOrEqualTo(4.5));
    });
  }
  testWidgets('hover and press retain nested actions and keyboard access', (tester) async {
    var opens = 0, favorites = 0;
    await tester.pumpWidget(MaterialApp(theme: portalThemeData('paper'), home: Scaffold(body: Center(
      child: SizedBox(width: 320, height: 160, child: PortalCardSurface(
        color: Colors.white, child: InkWell(onTap: () => opens++, child: Column(children: [
          const Text('世界卡片'),
          IconButton(tooltip: '收藏', onPressed: () => favorites++, icon: const Icon(Icons.star_border)),
        ])),
      )),
    ))));
    final target = find.byType(PortalCardSurface);
    final size = tester.getSize(target);
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(target));
    await tester.pumpAndSettle();
    expect(tester.getSize(target), size);
    await tester.tap(find.byTooltip('收藏'));
    await tester.pumpAndSettle();
    expect(favorites, 1); expect(opens, 0);
    await tester.tap(find.text('世界卡片'));
    await tester.pumpAndSettle(); expect(opens, 1);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus, isNotNull);
    await mouse.removePointer();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
  testWidgets('reduced motion keeps hovered card stationary and disabled button inert', (tester) async {
    var calls = 0;
    final enabled = ValueNotifier(false);
    addTearDown(enabled.dispose);
    await tester.pumpWidget(MaterialApp(theme: portalThemeData('ink'), home: ElseLifeMotionScope(
      reducedMotion: true, child: Scaffold(body: Center(child: SizedBox(width: 250, child: PortalCardSurface(
        child: ValueListenableBuilder<bool>(valueListenable: enabled, builder: (_, active, _) =>
          FilledButton(onPressed: active ? () => calls++ : null, child: const Text('开始'))),
      )))),
    )));
    final button = find.byType(FilledButton);
    final original = tester.getTopLeft(button);
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(button));
    await tester.pump();
    expect(tester.getTopLeft(button), original);
    await tester.tap(button); expect(calls, 0);
    enabled.value = true; await tester.pump();
    await tester.tap(button); expect(calls, 1);
    await mouse.removePointer(); await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
