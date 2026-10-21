/// Client boundary tests use scripted HTTP/state, not narrative quality evidence.
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_feedback_panel.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_preferences_screen.dart';
import 'package:elselife_frontend/experience/reader_story_waiting.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  Future<ExperienceController> controller(FakeExperienceApi api) async {
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await c.initialize();
    await c.open('experience-a', branch: 'main');
    return c;
  }

  test(
    'unknown or malformed public progress is rejected instead of displayed',
    () {
      for (final progress in [
        {'seq': 1, 'phase': 'secret NPC plan'},
        {'seq': -1, 'phase': 'writing'},
        {'seq': 1.5, 'phase': 'writing'},
      ]) {
        expect(
          () => ExperienceOperation({
            ...testOperation('request'),
            'progress': progress,
          }),
          throwsFormatException,
        );
      }
    },
  );

  test(
    'one-turn feedback survives timeout and resends exact request separately from act',
    () async {
      final session = testSession();
      final journal = MemoryJournal();
      final api = FakeExperienceApi()..timeout = true;
      var c = ExperienceController(
        session: session,
        api: api,
        journal: journal,
      );
      await c.initialize();
      await c.open('experience-a', branch: 'main');
      final scope = c.scope;
      await journal.patch(scope, {
        'reading_request': {'id': 'feedback-1', 'text': '节奏慢一点'},
        'draft': '我推开门',
        'draft_revision': 1,
      });
      await c.open('experience-a', branch: 'main');
      await c.send();
      expect(api.sent.single['reading_request'], '节奏慢一点');
      expect(api.sent.single['input'], '我推开门');
      final original = {...api.sent.single};
      c.dispose();
      c = ExperienceController(session: session, api: api, journal: journal);
      addTearDown(() {
        c.dispose();
        session.dispose();
      });
      await c.initialize();
      api.missing = true;
      await c.recover();
      api.timeout = false;
      await c.resendSameRequest();
      expect(api.sent.last, original);
      expect(journal.rows[scope]!['reading_request'], isNull);
      expect(api.changes, isEmpty);
    },
  );

  test(
    'commit consumes its feedback identity, never a replacement with identical text',
    () async {
      final api = FakeExperienceApi()..status = 'generating';
      final c = await controller(api);
      await c.setReadingRequest('多些对话', expectedScope: c.scope);
      await c.send(explicitMode: 'read');
      final scope = c.scope;
      await c.setReadingRequest('多些对话', expectedScope: scope);
      api.status = 'committed';
      await c.recover();
      expect(c.readingRequest, '多些对话');
      expect((await c.journal.read(scope))['reading_request'], isNotNull);
      await c.send(explicitMode: 'read');
      expect(api.sent.last['input'], '');
      expect(api.sent.last['reading_request'], '多些对话');
      expect(c.readingRequest, isNull);
    },
  );

  test(
    'feedback write failure blocks sending and retry saves the exact feedback',
    () async {
      final api = FakeExperienceApi();
      final c = await controller(api);
      final journal = c.journal as MemoryJournal;
      journal.failWrite = true;
      await expectLater(
        c.setReadingRequest('慢些', expectedScope: c.scope),
        throwsStateError,
      );
      await c.send(explicitMode: 'read');
      expect(api.sent, isEmpty);
      journal.failWrite = false;
      await c.retryLocalStorage();
      expect((await journal.read(c.scope))['reading_request']['text'], '慢些');
      await c.send(explicitMode: 'read');
      expect(api.sent.single['reading_request'], '慢些');
      expect(c.readingRequest, isNull);
    },
  );

  test(
    'a committed response for the wrong base revision cannot consume feedback',
    () async {
      final api = FakeExperienceApi();
      final c = await controller(api);
      await c.setReadingRequest('慢些', expectedScope: c.scope);
      api.delayed = Future.value(
        ExperienceOperation(testOperation('op', baseRevision: 2)),
      );
      await c.send(explicitMode: 'read', requestId: 'op');
      expect(c.unknown, isTrue);
      expect(c.readingRequest, '慢些');
      expect(c.current!.revision, 1);
    },
  );

  test(
    'typing while commit is persisted cannot resurrect consumed feedback in the journal',
    () async {
      final api = FakeExperienceApi()..status = 'generating';
      final c = await controller(api);
      await c.setReadingRequest('慢些', expectedScope: c.scope);
      await c.send(explicitMode: 'read');
      final journal = c.journal as MemoryJournal;
      journal.gate = Completer<void>();
      api.status = 'committed';
      final recovering = c.recover();
      await Future<void>.delayed(Duration.zero);
      final typing = c.saveDraft('稍后再行动');
      journal.gate!.complete();
      await Future.wait([recovering, typing]);
      expect(c.readingRequest, isNull);
      expect((await journal.read(c.scope))['reading_request'], isNull);
      expect(c.draft, '稍后再行动');
    },
  );

  test(
    'cancel keeps feedback and UTF8 bound rejects oversize before replacing it',
    () async {
      final api = FakeExperienceApi()..status = 'generating';
      final c = await controller(api);
      await c.setReadingRequest('慢些', expectedScope: c.scope);
      await expectLater(
        c.setReadingRequest(
          List.filled(1366, '字').join(),
          expectedScope: c.scope,
        ),
        throwsFormatException,
      );
      expect(c.readingRequest, '慢些');
      await c.send(explicitMode: 'read');
      await c.cancel();
      expect(c.readingRequest, '慢些');
      final oldScope = c.scope;
      await c.open('experience-a', branch: 'other');
      expect(c.readingRequest, isNull);
      await expectLater(
        c.setReadingRequest('错分支', expectedScope: oldScope),
        throwsFormatException,
      );
      await c.open('experience-a', branch: 'main');
      expect(c.readingRequest, '慢些');
      expect(api.changes, isEmpty);
    },
  );

  test(
    'a new request waiting for acceptance cannot display the previous committing stage',
    () async {
      final api = FakeExperienceApi();
      final c = await controller(api);
      c.operation = ExperienceOperation({
        ...testOperation('previous'),
        'progress': {'seq': 10, 'phase': 'committing'},
      });
      final accepted = Completer<ExperienceOperation>();
      api.delayed = accepted.future;
      final sending = c.send(explicitMode: 'read', requestId: 'new');
      await Future<void>.delayed(Duration.zero);
      expect(c.unknown, isTrue);
      expect(c.progress, isNull);
      accepted.complete(
        ExperienceOperation(testOperation('new', status: 'generating')),
      );
      await sending;
    },
  );

  test(
    'progress cannot regress but lower-sequence terminal status still refreshes formal pages',
    () async {
      final api = _ProgressApi();
      final c = await controller(api);
      c.operation = ExperienceOperation({
        ...testOperation('op', status: 'generating'),
        'progress': {'seq': 8, 'phase': 'checking'},
      });
      api.seq = 3;
      api.phase = 'writing';
      await c.recover();
      expect(c.progress!.phase, NarrativePhase.checking);
      expect(c.current!.pages.single.text, '已提交的原文。');
      api.status = 'committed';
      api.viewOverride = testView(text: '正式新段落', revision: 2);
      await c.recover();
      expect(c.operation!.status, 'committed');
      expect(c.current!.pages.single.text, '正式新段落');
      c.operation = ExperienceOperation({
        ...testOperation('new', status: 'generating'),
        'progress': {'seq': 1, 'phase': 'remembering'},
      });
      expect(c.progress!.phase, NarrativePhase.remembering);
    },
  );

  test(
    'preparation uses exact GET scope and rejects mismatched revision',
    () async {
      var revision = 7;
      final client = ExperienceClient(
        baseUrl: () => 'https://world.test',
        client: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/v1/experiences/story/preparation');
          expect(request.url.queryParameters, {
            'branch_id': 'branch / 中文',
            'base_revision': '7',
          });
          return http.Response(
            jsonEncode({
              'experience_id': 'story',
              'branch_id': 'branch / 中文',
              'base_revision': revision,
              'status': 'ready',
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      addTearDown(client.close);
      expect(
        (await client.preparation('story', 'branch / 中文', 7)).status,
        PreparationStatus.ready,
      );
      revision = 8;
      await expectLater(
        client.preparation('story', 'branch / 中文', 7),
        throwsFormatException,
      );
    },
  );

  testWidgets(
    'preparation polling is readonly, finite and never blocks input',
    (tester) async {
      final api = _PreparationApi();
      final c = await controller(api);
      await tester.pump();
      final reads = api.reads;
      expect(c.preparation!.status, PreparationStatus.preparing);
      expect(c.blocked, isFalse);
      await c.saveDraft('我现在行动');
      await tester.pump(const Duration(seconds: 3));
      expect(api.preparationCalls, 2);
      expect(api.reads, reads);
      expect(api.queried, isEmpty);
      await tester.pump(const Duration(minutes: 10));
      final calls = api.preparationCalls;
      await tester.pump(const Duration(minutes: 2));
      expect(api.preparationCalls, calls);
      expect(c.preparation, isNull);
      expect(c.draft, '我现在行动');
      expect(c.blocked, isFalse);
    },
  );

  testWidgets(
    'preparation survives a three-minute generation with lower polling frequency',
    (tester) async {
      final api = _PreparationApi();
      final c = await controller(api);
      await tester.pump();
      final reads = api.reads;
      for (var second = 0; second < 180; second++) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(c.preparation?.status, PreparationStatus.preparing);
      expect(api.preparationCalls, lessThan(30));
      expect(api.preparationCalls, greaterThan(15));
      expect(c.blocked, isFalse);
      api.preparationStatus = 'ready';
      await tester.pump(const Duration(seconds: 10));
      expect(c.preparation?.status, PreparationStatus.ready);
      final calls = api.preparationCalls;
      await tester.pump(const Duration(minutes: 10));
      expect(api.preparationCalls, calls);
      expect(api.reads, reads);
      expect(api.queried, isEmpty);
    },
  );

  testWidgets(
    'late preparation never crosses branch, owner, revision or input epoch',
    (tester) async {
      final api = _PreparationApi();
      final old = Completer<ExperiencePreparation>();
      api.pending = old.future;
      final c = await controller(api);
      api.pending = null;
      api.preparationStatus = 'unavailable';
      await c.open('experience-a', branch: 'other');
      await tester.pump();
      old.complete(_preparation('main', 1, 'ready'));
      await tester.pump();
      expect(c.preparation!.branchId, 'other');
      expect(c.preparation!.status, PreparationStatus.unavailable);

      final interrupted = Completer<ExperiencePreparation>();
      api.pending = interrupted.future;
      await c.open('experience-a', branch: 'main');
      api.status = 'generating';
      await c.send(explicitMode: 'read');
      interrupted.complete(_preparation('main', 1, 'ready'));
      await tester.pump();
      expect(c.preparation, isNull);
      expect(c.current!.pages.single.text, '已提交的原文。');

      api.status = 'committed';
      api.pending = null;
      api.viewOverride = testView(revision: 2);
      await c.recover();
      expect(c.current!.revision, 2);
      final wrongRevision = Completer<ExperiencePreparation>();
      api.pending = wrongRevision.future;
      await c.open('experience-a', branch: 'main');
      wrongRevision.complete(_preparation('main', 1, 'ready'));
      await tester.pump();
      expect(c.preparation, isNull);
      final wrongOwner = Completer<ExperiencePreparation>();
      api.pending = wrongOwner.future;
      await c.open('experience-a', branch: 'main');
      c.session.backendUrl = 'https://other.test';
      wrongOwner.complete(_preparation('main', 2, 'ready'));
      await tester.pump();
      expect(c.preparation, isNull);
    },
  );

  testWidgets(
    'ready stops polling and pending feedback hides the now-incompatible hint',
    (tester) async {
      final api = _PreparationApi()..preparationStatus = 'ready';
      final c = await controller(api);
      await tester.pump();
      expect(c.preparation!.status, PreparationStatus.ready);
      await tester.pump(const Duration(seconds: 10));
      expect(api.preparationCalls, 1);
      await c.setReadingRequest('快些', expectedScope: c.scope);
      expect(c.preparation, isNull);
      expect(c.blocked, isFalse);
    },
  );

  testWidgets(
    'preference write invalidates readiness even if its result is unknown',
    (tester) async {
      final api = _PreparationApi()..preparationStatus = 'ready';
      final c = await controller(api);
      await tester.pump();
      expect(c.preparation!.status, PreparationStatus.ready);
      await tester.pumpWidget(
        elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('添加明确内容偏好'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('preference-value')), '慢些');
      api.preferenceTimeout = true;
      await tester.tap(find.text('保存明确偏好'));
      await tester.pumpAndSettle();
      expect(c.preparation, isNull);
      expect(c.blocked, isFalse);
      expect(api.preparationCalls, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'explicit next-beat button saves raw feedback without preference or model calls',
    (tester) async {
      final api = FakeExperienceApi();
      final c = await controller(api);
      var longTerm = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ExperienceFeedbackPanel(
                controller: c,
                onLongTerm: (_, _) async {
                  longTerm = true;
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('reader-feedback-text')),
        '节奏稍缓，人物对白短些',
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('用于下一段'));
      await tester.tap(find.text('用于下一段'));
      await tester.pumpAndSettle();
      expect(c.readingRequest, '节奏稍缓，人物对白短些');
      expect(longTerm, isFalse);
      expect(api.changes, isEmpty);
      expect(api.sent, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'waiting presents fixed public stage labels, never submitted or candidate prose',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ReaderStoryWaiting(
              phase: NarrativePhase.checking,
              input: '秘密输入',
              publishedText: '已提交正文',
            ),
          ),
        ),
      );
      expect(find.text('核对情节'), findsOneWidget);
      expect(find.text('秘密输入'), findsNothing);
      expect(find.text('已提交正文'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

class _ProgressApi extends FakeExperienceApi {
  _ProgressApi() {
    status = 'generating';
  }
  int seq = 1;
  String phase = 'writing';
  @override
  Future<ExperienceOperation> operation(String id, String requestId) async =>
      ExperienceOperation({
        ...testOperation(requestId, id: id, status: status),
        'progress': {'seq': seq, 'phase': phase},
        'passage': '未提交候选，不可显示',
      });
}

ExperiencePreparation _preparation(
  String branch,
  int revision,
  String status,
) => ExperiencePreparation({
  'experience_id': 'experience-a',
  'branch_id': branch,
  'base_revision': revision,
  'status': status,
});

class _PreparationApi extends FakeExperienceApi
    implements ExperiencePreparationApi {
  int preparationCalls = 0;
  String preparationStatus = 'preparing';
  Future<ExperiencePreparation>? pending;
  @override
  Future<ExperiencePreparation> preparation(
    String id,
    String branch,
    int revision,
  ) async {
    preparationCalls++;
    return pending ?? _preparation(branch, revision, preparationStatus);
  }
}
