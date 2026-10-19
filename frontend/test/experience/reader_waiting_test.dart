// Rendering and interaction fixtures; no model-quality claims.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_story_waiting.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  test(
    'scene follows submitted action then the latest published atmosphere',
    () {
      expect(
        storyWaitingMotif(input: '我问他，雨什么时候停？', publishedText: '你沿着小路走。'),
        StoryWaitingMotif.dialogue,
      );
      expect(
        storyWaitingMotif(input: '沿着小路出发。', publishedText: '他问起信件。'),
        StoryWaitingMotif.journey,
      );
      expect(storyWaitingMotif(input: '观察桌上的线索。'), StoryWaitingMotif.discovery);
      expect(
        storyWaitingMotif(publishedText: '谈话结束，窗外雨声渐密。'),
        StoryWaitingMotif.rain,
      );
      expect(
        storyWaitingMotif(input: 'a train of thought'),
        StoryWaitingMotif.ink,
      );
    },
  );

  testWidgets(
    'scene fits a narrow reader with larger text and reduced motion',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MediaQuery(
              data: MediaQueryData(
                size: const Size(320, 480),
                textScaler: TextScaler.linear(2),
                disableAnimations: true,
              ),
              child: Center(
                child: SizedBox(
                  width: 260,
                  child: ReaderStoryWaiting(
                    showStop: true,
                    onStop: () {},
                    input: '观察线索。',
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('故事正在继续'), findsOneWidget);
      expect(find.byTooltip('停止生成'), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    },
  );

  Future<ExperienceController> mount(
    WidgetTester tester, {
    String status = 'generating',
    bool busy = false,
    bool unknown = false,
    bool portal = true,
    bool reducedMotion = false,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = FakeExperienceApi()..status = status;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    await c.initialize();
    await c.open('experience-a');
    c.operation = ExperienceOperation(
      testOperation('waiting-test', status: status),
    );
    c.busy = busy;
    c.unknown = unknown;
    c.attempt = {
      'request_id': 'waiting-test',
      'settled': false,
      'body': {'input': '我问他，雨什么时候会停？'},
    };
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: reducedMotion),
          child: ExperienceScreen(
            controller: c,
            onPreferences: () {},
            onPortalHome: portal ? () {} : null,
          ),
        ),
      ),
    );
    await tester.pump();
    return c;
  }

  for (final portal in [true, false]) {
    testWidgets(
      'waiting hides internal workflow in ${portal ? 'portal' : 'reader'}',
      (tester) async {
        final c = await mount(tester, portal: portal, busy: true);
        expect(find.text('故事正在继续'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('story-waiting-scene')),
          findsOneWidget,
        );
        for (final phrase in [
          '只在正式提交后展示正文',
          '正在确认',
          '查询原请求',
          '取消生成 / 我来接手',
          '已接受，等待生成',
        ]) {
          expect(find.textContaining(phrase), findsNothing);
        }
        expect(find.text('已提交的原文。'), findsOneWidget);
        expect(find.byTooltip('停止生成'), findsOneWidget);
        final first = tester.element(
          find.byKey(const ValueKey('story-waiting-scene')),
        );
        c.busy = false;
        await c.saveDraft('未发送的下一条草稿');
        await tester.pump();
        expect(
          tester.element(find.byKey(const ValueKey('story-waiting-scene'))),
          same(first),
        );
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.byTooltip('停止生成'));
        await tester.tap(find.byTooltip('停止生成'));
        await tester.pumpAndSettle();
        expect((c.api as FakeExperienceApi).cancels, 1);
        expect(c.draft, '未发送的下一条草稿');
        expect(find.byKey(const ValueKey('story-waiting-scene')), findsNothing);
      },
    );
  }

  testWidgets('reduced motion can settle while a response is pending', (
    tester,
  ) async {
    await mount(tester, reducedMotion: true);
    await tester.pumpAndSettle();
    expect(find.text('故事正在继续'), findsOneWidget);
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets(
    'unknown connection preserves recovery without technical labels',
    (tester) async {
      await mount(tester, unknown: true);
      expect(find.text('重新连接'), findsOneWidget);
      expect(find.textContaining('原请求'), findsNothing);
      expect(find.text('故事正在继续'), findsNothing);
    },
  );

  testWidgets('confirmed prose has no leftover generation strip', (
    tester,
  ) async {
    await mount(tester, status: 'committed');
    expect(find.byKey(const ValueKey('story-waiting-scene')), findsNothing);
    expect(find.text('已保存正式正文'), findsNothing);
    expect(find.text('已提交的原文。'), findsOneWidget);
  });
}
