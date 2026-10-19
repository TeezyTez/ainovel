import 'dart:convert';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/workspace_session.dart';
import 'package:sembast/sembast_memory.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/portal_demo_experience_api.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';
import 'package:elselife_frontend/portal/portal_demo_script.dart';
import 'package:elselife_frontend/portal/portal_demo_reader.dart';
import 'support/experience_fixture.dart';
import 'support/elselife_test_app.dart';

void main() {
  PortalDemoRepository repository(MemoryJournal journal) =>
      PortalDemoRepository(
        journal: journal,
        backendUrl: 'https://formal.invalid',
        workspaceId: 'local-workspace',
      );
  Json request(
    String id,
    int revision, {
    String branch = 'main',
    String? text,
  }) => {
    'request_id': id,
    'branch_id': branch,
    'expected_revision': revision,
    'mode': text == null ? 'read' : 'act',
    'input': text ?? '',
  };
  test('本机演示逐字采用原版选择与continue，同请求重试不多走一步，八步保留结束', () async {
    final repo = repository(MemoryJournal()),
        entry = await repo.create('fog-harbor');
    final api = PortalDemoExperienceApi(
      repository: repo,
      sessionId: entry.id,
      opening: '原版开场',
    );
    var source = const PortalDemoState();
    final first = PortalDemoScript.actions(entry.worldId, source).first;
    final body = request('first', 1, text: first.text);
    await api.submit(entry.id, body);
    source = PortalDemoScript.choose(entry.worldId, source, first.id);
    var view = await api.view(entry.id);
    expect(view.pages.last.text, source.turns.last.prose);
    expect(view.pages.first.text, '原版开场');
    final reopened = PortalDemoExperienceApi(
      repository: repo,
      sessionId: entry.id,
      opening: '原版开场',
    );
    await reopened.submit(entry.id, body);
    expect((await reopened.view(entry.id)).revision, 2);
    await expectLater(
      reopened.submit(entry.id, {...body, 'input': '不同表达'}),
      throwsA(
        isA<ExperienceHttpException>().having((e) => e.status, 'status', 409),
      ),
    );
    for (var i = 1; i < 8; i++) {
      await reopened.submit(entry.id, request('read-$i', i + 1));
      source = PortalDemoScript.choose(entry.worldId, source, 'continue');
    }
    view = await reopened.view(entry.id);
    expect(view.revision, 9);
    expect(view.pages.last.outcome, 'ending');
    expect(view.pages.last.text, source.turns.last.prose);
    expect((await repo.entry(entry.id))!.step, 8);
    await expectLater(
      reopened.submit(entry.id, request('after-end', 9)),
      throwsA(isA<ExperienceHttpException>()),
    );
  });
  test('脚本关系与物品进入共享资料，证据页包含开场偏移且历史不泄漏', () async {
    final repo = repository(MemoryJournal()),
        entry = await repo.create('fog-harbor');
    final api = PortalDemoExperienceApi(
      repository: repo,
      sessionId: entry.id,
      opening: '原版开场',
    );
    var source = const PortalDemoState();
    final choices = ['ask-register', 'continue', 'trace-record', 'revisit-lin'];
    for (var i = 0; i < choices.length; i++) {
      final id = choices[i];
      final text = id == 'continue'
          ? null
          : PortalDemoScript.actions(
              entry.worldId,
              source,
            ).firstWhere((a) => a.id == id).text;
      await api.submit(entry.id, request('choice-$i', i + 1, text: text));
      source = PortalDemoScript.choose(entry.worldId, source, id);
    }
    final view = await api.view(entry.id);
    expect(
      view.information
          .firstWhere((i) => i.id == 'entity:lin')
          .fields
          .single['value'],
      '因先前尊重手续，愿意主动协助核对公开材料',
    );
    expect(view.reader!.records.where((r) => r.kind == 'item'), hasLength(2));
    expect(
      view.pages[2].reader!.information.any((i) => i.name == '公开电报索引'),
      isFalse,
    );
    expect(view.pages.last.reader!.revision, 5);
    expect(
      view.reader!.records
          .where((r) => r.label == '公开电报索引')
          .single
          .sourceRevision,
      5,
    );
  });
  test('历史fork重放真实脚本，原线保留、回执可恢复，同世界另一session独立', () async {
    final repo = repository(MemoryJournal()),
        entry = await repo.create('thursday'),
        other = await repo.create('thursday');
    final api = PortalDemoExperienceApi(
      repository: repo,
      sessionId: entry.id,
      opening: '原版开场',
    );
    await api.submit(entry.id, request('a', 1));
    await api.submit(entry.id, request('b', 2));
    final original = await api.view(entry.id);
    final body = {
      'request_id': 'fork-a',
      'from_branch_id': 'main',
      'from_revision': 2,
      'name': '另一个选择',
    };
    final fork = await api.branch(entry.id, body);
    expect(fork.revision, 2);
    expect(fork.pages.last.text, original.pages[1].text);
    await api.submit(
      entry.id,
      request('branch-next', 2, branch: fork.branchId),
    );
    expect(
      (await api.view(entry.id, branch: 'main')).pages.map((p) => p.text),
      original.pages.map((p) => p.text),
    );
    expect((await api.receipt('fork-a'))['branch_id'], fork.branchId);
    expect((await api.branch(entry.id, body)).branchId, fork.branchId);
    expect((await repo.entry(other.id))!.step, 0);
    expect((await repo.loadEntries()).length, 2);
  });
  test('未支持自由生成、私有改写和跨session调用明确拒绝，存储失败不覆盖旧片刻', () async {
    final journal = MemoryJournal(),
        repo = repository(journal),
        entry = await repo.create('mountain');
    final api = PortalDemoExperienceApi(
      repository: repo,
      sessionId: entry.id,
      opening: '原版开场',
    );
    await expectLater(
      api.submit(entry.id, request('free', 1, text: '凭空生成新剧情')),
      throwsA(isA<ExperienceHttpException>()),
    );
    await expectLater(
      api.view('another-id'),
      throwsA(isA<ExperienceHttpException>()),
    );
    await expectLater(
      api.branch(entry.id, {
        'request_id': 'edit',
        'from_branch_id': 'main',
        'from_revision': 1,
        'name': '改写',
        'edit': {'text': '不存在'},
      }),
      throwsA(isA<ExperienceHttpException>()),
    );
    journal.failWrite = true;
    await expectLater(
      api.submit(entry.id, request('fail', 1)),
      throwsStateError,
    );
    journal.failWrite = false;
    expect((await api.view(entry.id)).revision, 1);
  });
  test('演示草稿笔记在真实workspace备份范围，导航不覆盖正式经历', () async {
    final db = await databaseFactoryMemory.openDatabase('demo-reader-backup');
    final journal = LocalExperienceJournal(database: db);
    final repo = PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://formal.invalid',
      workspaceId: 'local-workspace',
    );
    final entry = await repo.create('thursday');
    final formalNavigation = experienceScope(
      repo.backendUrl,
      repo.workspaceId,
      'navigation',
      'navigation',
    );
    await journal.patch(formalNavigation, {
      'last_view': {'id': 'formal-story', 'branch': 'formal-main'},
    });
    final controller = ExperienceController(
      session: WorkspaceSession(backendUrl: repo.backendUrl),
      api: PortalDemoExperienceApi(
        repository: repo,
        sessionId: entry.id,
        opening: '开场',
      ),
      journal: journal,
      navigationNamespace: 'demo-navigation-${entry.id}',
    );
    await controller.initialize();
    await controller.open(entry.id);
    expect(controller.session.backendUrl, repo.backendUrl);
    expect(controller.navigationScope, isNot(formalNavigation));
    await controller.saveDraft('演示草稿');
    await journal.patch(controller.scope, {
      'reader_personal': {
        'entries': [
          {'kind': 'note', 'text': '演示笔记'},
        ],
      },
    });
    final backup = await journal.exportWorkspace(
          repo.backendUrl,
          repo.workspaceId,
        ),
        key = jsonEncode([entry.id, 'main']);
    expect(backup[key]['draft'], '演示草稿');
    expect(backup[key]['reader_personal']['entries'][0]['text'], '演示笔记');
    expect(
      (await journal.read(formalNavigation))['last_view']['id'],
      'formal-story',
    );
    controller.dispose();
    controller.session.dispose();
    await db.close();
  });
  testWidgets('预设读页复用ExperienceScreen，选择和继续只推进本机原脚本，作者信息须确认', (tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final repo = repository(MemoryJournal()),
        entry = await repo.create('fog-harbor');
    final first = PortalDemoScript.actions(
      entry.worldId,
      const PortalDemoState(),
    ).first;
    await tester.pumpWidget(
      elseLifeTestApp(
        home: PortalDemoReader(
          repository: repo,
          sessionId: entry.id,
          opening: '独特演示开场',
          authorWorld: {
            'title': '演示作者',
            'characters': [
              {'name': '林', 'secret': '应确认后才显示的秘密'},
            ],
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ExperienceScreen), findsOneWidget);
    final demoController = tester
        .widget<ExperienceScreen>(find.byType(ExperienceScreen))
        .controller;
    expect(demoController.session.backendUrl, repo.backendUrl);
    expect(demoController.navigationNamespace, 'demo-navigation-${entry.id}');
    expect(find.textContaining('不调用模型，不写入正式故事'), findsOneWidget);
    expect(find.text('独特演示开场'), findsOneWidget);
    expect(find.textContaining('应确认后才显示的秘密'), findsNothing);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ActionChip, first.text));
    await tester.pumpAndSettle();
    expect((await repo.entry(entry.id))!.step, 1);
    await tester.tap(find.text('继续经历'));
    await tester.pumpAndSettle();
    expect((await repo.entry(entry.id))!.step, 2);
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('作者视图 · 可能剧透'));
    await tester.pumpAndSettle();
    expect(find.textContaining('应确认后才显示的秘密'), findsNothing);
    await tester.tap(find.text('我知道，查看幕后'));
    await tester.pumpAndSettle();
    expect(find.text('秘密：应确认后才显示的秘密'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
