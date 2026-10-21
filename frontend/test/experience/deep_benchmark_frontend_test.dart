/// Public benchmark regressions using a deterministic API and Flutter events.
/// These tests do not prove database authority, real IME, or screen-reader use.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  group('SYS-019-H2: drafts remain bound to their observed story revision', () {
    late FakeExperienceApi api;
    late MemoryJournal journal;
    late ExperienceController controller;
    setUp(() async {
      api = FakeExperienceApi();
      journal = MemoryJournal();
      controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      await controller.initialize();
      await controller.open('experience-a', branch: 'main');
    });
    tearDown(() {
      controller.dispose();
      controller.session.dispose();
    });

    test(
      'refresh from another client cannot silently rebase an old draft',
      () async {
        await controller.saveDraft('按刚才三枚的价格买两张');
        api.viewOverride = testView(revision: 2, text: '纸价已涨至四枚，只剩一张。');
        await controller.recover();
        await controller.send();
        expect(api.sent, isEmpty);
        expect(controller.draft, '按刚才三枚的价格买两张');
        expect(controller.error, contains('第 1 页'));
        expect(
          (await journal.read(controller.scope))['draft'],
          controller.draft,
        );
      },
    );

    test(
      'explicit continue does not authorize moving an unsent action forward',
      () async {
        await controller.saveDraft('只向东铺询价');
        api.viewOverride = testView(revision: 2);
        await controller.send(explicitMode: 'read');
        expect(api.sent.single['mode'], 'read');
        await controller.send();
        expect(api.sent.length, 1);
        expect(controller.draft, '只向东铺询价');
      },
    );

    test(
      'a legacy draft with no recorded anchor must be reviewed after restore',
      () async {
        await journal.patch(controller.scope, {'draft': '旧版未发送的行动'});
        api.viewOverride = testView(revision: 2);
        await controller.open('experience-a', branch: 'main');
        await controller.send();
        expect(api.sent, isEmpty);
        expect(controller.draft, '旧版未发送的行动');
        expect(controller.error, contains('起始位置'));
      },
    );

    test(
      'review confirmation is scoped and persists without submitting',
      () async {
        await controller.saveDraft('询问东铺现在的售价');
        api.viewOverride = testView(revision: 2);
        await controller.recover();
        await controller.confirmDraftAtCurrentRevision(
          expectedScope: controller.scope,
          expectedRevision: 1,
        );
        expect(controller.draftNeedsReview, isTrue);
        await controller.confirmDraftAtCurrentRevision(
          expectedScope: controller.scope,
          expectedRevision: 2,
        );
        expect(api.sent, isEmpty);
        expect((await journal.read(controller.scope))['draft_revision'], 2);
        await controller.open('experience-a');
        expect(controller.draftNeedsReview, isFalse);
        await controller.send();
        expect(api.sent.single['expected_revision'], 2);
        expect(api.sent.single['input'], '询问东铺现在的售价');
      },
    );
  });

  testWidgets(
    'SYS-025-H1: modifier combinations do not submit Chinese composition',
    (tester) async {
      final api = FakeExperienceApi();
      final controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: MemoryJournal(),
      );
      await controller.initialize();
      await controller.open('experience-a');
      await tester.pumpWidget(
        elseLifeTestApp(
          home: ExperienceScreen(controller: controller, onPreferences: () {}),
        ),
      );
      await tester.pumpAndSettle();
      final input = find.byKey(const ValueKey('experience-input'));
      await tester.tap(input);
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: '询问船价',
          selection: TextSelection.collapsed(offset: 4),
          composing: TextRange(start: 0, end: 4),
        ),
      );
      await tester.pumpAndSettle();
      for (final modifier in [
        LogicalKeyboardKey.controlLeft,
        LogicalKeyboardKey.metaLeft,
      ]) {
        await tester.sendKeyDownEvent(modifier);
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.sendKeyUpEvent(modifier);
      }
      await tester.tap(find.text('参与'));
      await tester.pumpAndSettle();
      expect(api.sent, isEmpty);
      expect(controller.draft, '询问船价');
      final field = tester.widget<TextField>(input);
      expect(
        field.controller!.value.composing,
        const TextRange(start: 0, end: 4),
      );
    api.viewOverride = testView(revision: 2);
    await controller.recover();
    await tester.pumpAndSettle();
    expect(field.controller!.value.composing, const TextRange(start: 0, end: 4),
        reason: 'a remote commit refresh preserves the active IME transaction');
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      controller.session.dispose();
    },
  );

  testWidgets('SYS-025-H1: Ctrl+Shift+Enter remains a draft editing shortcut', (
    tester,
  ) async {
    final api = FakeExperienceApi();
    final controller = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    await controller.initialize();
    await controller.open('experience-a');
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(controller: controller, onPreferences: () {}),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '只是一份草稿',
    );
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(api.sent, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    controller.session.dispose();
  });

  for (final width in [340.0, 390.0, 768.0, 1280.0]) {
    testWidgets(
      'SYS-025-H3: $width wide at 200% text and keyboard inset keeps stop reachable',
      (tester) async {
        tester.view.physicalSize = Size(width, 844);
        tester.view.devicePixelRatio = 1;
        tester.view.viewInsets = const FakeViewPadding(bottom: 280);
        addTearDown(tester.view.reset);
        final api = FakeExperienceApi()..status = 'generating';
        final controller = ExperienceController(
          session: testSession(),
          api: api,
          journal: MemoryJournal(),
        );
        await controller.initialize();
        await controller.open('experience-a');
        await tester.pumpWidget(
          elseLifeTestApp(
            home: Builder(
              builder: (context) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: const TextScaler.linear(2)),
                child: ExperienceScreen(
                  controller: controller,
                  onPreferences: () {},
                  onPortalHome: () {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('展开行动'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final input = find.byKey(const ValueKey('experience-input'));
        await tester.ensureVisible(input);
        await tester.enterText(input, '先看看门外');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byTooltip('发送'));
        await tester.tap(find.byTooltip('发送'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        expect(api.sent.length, 1);
        await tester.ensureVisible(find.text('停止生成'));
        await tester.tap(find.text('停止生成'));
        await tester.pumpAndSettle();
        expect(api.cancels, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        controller.dispose();
        controller.session.dispose();
      },
    );
  }
}
