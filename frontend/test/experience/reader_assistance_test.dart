import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/reader_assistance_panel.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  Json response({String branch = 'main', String kind = 'polish'}) => {
    'kind': kind,
    'branch_id': branch,
    'base_revision': 2,
    'text': '另一种表达，事情没有改变。',
  };
  Widget panel({
    String kind = 'polish',
    required Future<Json> Function(Json) request,
    required Future<void> Function(Json) apply,
    VoidCallback? cancel,
    bool Function()? current,
  }) => elseLifeTestApp(
    home: Scaffold(
      body: ReaderAssistancePanel(
        kind: kind,
        branchId: 'main',
        revision: 2,
        original: '原来已保存的正文',
        initialRequest: '保持事实，文字更简洁',
        isCurrent: current ?? () => true,
        onRequest: request,
        onApply: apply,
        onCancel: cancel ?? () {},
        onDraft: (_) {},
      ),
    ),
  );
  testWidgets('润色生成只返回审阅，明确确认才把候选交给正式分支', (tester) async {
    final sent = <Json>[], adopted = <Json>[];
    await tester.pumpWidget(
      panel(
        request: (body) async {
          sent.add(body);
          return response();
        },
        apply: (r) async {
          adopted.add(r);
        },
      ),
    );
    await tester.tap(find.text('生成供我查看'));
    await tester.pumpAndSettle();
    expect(sent.single, {
      'branch_id': 'main',
      'expected_revision': 2,
      'kind': 'polish',
      'request': '保持事实，文字更简洁',
    });
    expect(find.text('另一种表达，事情没有改变。'), findsOneWidget);
    expect(adopted, isEmpty);
    await tester.ensureVisible(find.text('确认只改表达'));
    await tester.tap(find.text('确认只改表达'));
    await tester.pumpAndSettle();
    expect(adopted.single['text'], '另一种表达，事情没有改变。');
  });
  testWidgets('取消真实请求后迟到结果不复活，原要求保留', (tester) async {
    final completer = Completer<Json>();
    var cancelled = 0, adopted = 0;
    await tester.pumpWidget(
      panel(
        request: (_) => completer.future,
        apply: (_) async {
          adopted++;
        },
        cancel: () => cancelled++,
      ),
    );
    await tester.tap(find.text('生成供我查看'));
    await tester.pump();
    await tester.tap(find.text('取消并保留原内容'));
    await tester.pump();
    completer.complete(response());
    await tester.pumpAndSettle();
    expect(cancelled, 1);
    expect(adopted, 0);
    expect(find.text('确认只改表达'), findsNothing);
    expect(find.text('已取消，原有内容保持不变。'), findsOneWidget);
    expect(find.text('保持事实，文字更简洁'), findsOneWidget);
  });
  testWidgets('候选分支或当前版本变化时禁止应用', (tester) async {
    var current = true, adopted = 0;
    await tester.pumpWidget(
      panel(
        request: (_) async => response(branch: 'another'),
        apply: (_) async {
          adopted++;
        },
        current: () => current,
      ),
    );
    await tester.tap(find.text('生成供我查看'));
    await tester.pumpAndSettle();
    expect(find.textContaining('回应的版本已改变'), findsOneWidget);
    expect(find.text('确认只改表达'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      panel(
        request: (_) async => response(),
        apply: (_) async {
          adopted++;
        },
        current: () => current,
      ),
    );
    await tester.tap(find.text('生成供我查看'));
    await tester.pumpAndSettle();
    current = false;
    await tester.ensureVisible(find.text('确认只改表达'));
    await tester.tap(find.text('确认只改表达'));
    await tester.pumpAndSettle();
    expect(adopted, 0);
    expect(find.text('故事已经改变，请重新生成后再确认。'), findsOneWidget);
  });
  testWidgets('修复提案显示替换正文和变更，明确确认才传完整候选', (tester) async {
    Json? applied;
    final proposal = {
      'passage': '修正后的正文',
      'new_facts': [
        {'text': '已知天气', 'known': true},
      ],
      'new_entities': <Json>[],
      'new_threads': <Json>[],
    };
    await tester.pumpWidget(
      panel(
        kind: 'repair',
        request: (_) async => {
          ...response(kind: 'repair'),
          'proposal': proposal,
        },
        apply: (r) async {
          applied = r;
        },
      ),
    );
    await tester.tap(find.text('检查并提出修复'));
    await tester.pumpAndSettle();
    expect(find.text('修正后的正文'), findsOneWidget);
    expect(applied, isNull);
    await tester.ensureVisible(find.text('确认并建立修复分支'));
    await tester.tap(find.text('确认并建立修复分支'));
    await tester.pumpAndSettle();
    expect(applied!['proposal'], proposal);
  });
  test('forkChange持久化含CAS的确认载荷，未知结果阻止重复分支', () async {
    final journal = MemoryJournal(), api = _DurableBranchApi();
    api.journal = journal;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    await c.open('experience-a');
    await c.saveDraft('不能丢失的草稿');
    final source = c.scope;
    api.timeout = true;
    await c.forkChange(1, '表达分支', {
      'polish': {'text': '新的表达'},
    });
    expect(api.forks.single['expected_revision'], 1);
    expect(api.forks.single['from_revision'], 1);
    expect(api.forks.single['polish'], {'text': '新的表达'});
    expect(c.unknown, isTrue);
    expect(c.draft, '不能丢失的草稿');
    expect((await journal.read(source))['attempt'], isNotNull);
    await c.forkChange(1, '不可重复', {
      'polish': {'text': '另一稿'},
    });
    expect(api.forks, hasLength(1));
    c.dispose();
    c.session.dispose();
  });
}

class _DurableBranchApi extends FakeExperienceApi {
  late MemoryJournal journal;
  @override
  Future<ExperienceView> branch(String id, Json body) async {
    if (!journal.rows.values.any(
      (r) => (r['attempt'] as Map?)?['request_id'] == body['request_id'],
    ))
      throw StateError('branch POST before journal');
    return super.branch(id, body);
  }
}
