import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/demo_world_catalog.dart';

void main() {
  testWidgets('精选世界在窄屏和大字号下仍可滚动阅读', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(3)),
          child: Scaffold(
            body: SingleChildScrollView(
              child: DemoWorldCatalog(onSeedSelected: (_) {}),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final card = find.byKey(const ValueKey('demo-world-fog-harbor'));
    expect(card, findsOneWidget);
    final action = find.text('填入草稿  →').first;
    await tester.ensureVisible(action);
    await tester.pumpAndSettle();
    expect(tester.getBottomLeft(action).dy,
        lessThanOrEqualTo(tester.getBottomLeft(card).dy));
    expect(tester.takeException(), isNull);
  });
}
