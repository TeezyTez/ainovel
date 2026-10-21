// Source-based interaction and isolation tests, not model-quality evidence.
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/reader_local_state.dart';
import 'package:elselife_frontend/experience/reader_projection.dart';
import 'package:elselife_frontend/experience/reader_evidence_panel.dart';
import 'package:elselife_frontend/experience/reader_prepared_workbench.dart';
import 'package:elselife_frontend/experience/reader_artifact_surface.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';

import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  ReaderProjection projection(List<Map<String, dynamic>> records) =>
      ReaderProjection({
        'revision': 3,
        'story_time': '午后',
        'information': [
          {
            'id': 'entity:shop',
            'kind': 'location',
            'name': '书店',
            'text': '已知地点',
            'related_ids': <String>[],
          },
          {
            'id': 'entity:pier',
            'kind': 'location',
            'name': '码头',
            'text': '已知地点',
            'related_ids': <String>[],
          },
        ],
        'records': [
          for (final r in records)
            {
              'fact_id': 'fact-${records.indexOf(r)}',
              'source_revision': 3,
              'quote': '正式事实依据',
              ...r,
            },
        ],
      });
  testWidgets('路线无方位不猜坐标，未知距离与通行记录明确呈现', (tester) async {
    await tester.pumpWidget(
      elseLifeTestApp(
        home: Scaffold(
          body: ReaderEvidencePanel(
            kind: 'map',
            projection: projection([
              {
                'kind': 'route',
                'entity_id': 'shop',
                'target_id': 'pier',
                'label': '旧路',
                'passage': 'unknown',
              },
            ]),
            onObject: (_) {},
            onAction: (_) {},
            onSource: (_) {},
            onExport: (_) {},
            initialValues: {},
            onValues: (_) {},
          ),
        ),
      ),
    );
    expect(find.textContaining('尚无可绘制的方位依据'), findsOneWidget);
    expect(find.text('方位未记录 · 距离未测定 · 通行状态未明'), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsNothing);
  });
  testWidgets('交互作品参数先本地保存，明确起草才返回行动，历史页不提供执行', (tester) async {
    String? action;
    Map<String, dynamic>? saved;
    final data = projection([
      {
        'kind': 'artifact',
        'entity_id': 'shop',
        'label': '订书记录',
        'columns': ['书名', '数量'],
        'rows': [
          ['旧书', '2'],
        ],
        'fields': [
          {'id': 'amount', 'label': '份数', 'kind': 'number', 'required': true},
        ],
      },
    ]);
    Widget panel(bool historical) => elseLifeTestApp(
      home: Scaffold(
        body: ReaderEvidencePanel(
          kind: 'artifact',
          projection: data,
          readonly: historical,
          onObject: (_) {},
          onAction: (v) => action = v,
          onSource: (_) {},
          onExport: (_) {},
          initialValues: {},
          onValues: (v) => saved = v,
        ),
      ),
    );
    await tester.pumpWidget(panel(false));
    await tester.enterText(find.widgetWithText(TextFormField, '份数 *'), '3');
    await tester.pump();
    expect(saved!['fact-0']['amount'], '3');
    expect(action, isNull);
    await tester.ensureVisible(find.text('将参数用于行动草稿'));
    await tester.tap(find.text('将参数用于行动草稿'));
    await tester.pump();
    expect(action, contains('份数：3'));
    await tester.pumpWidget(panel(true));
    await tester.pump();
    expect(find.text('将参数用于行动草稿'), findsNothing);
  });
  test('私人记录按分支隔离，并发写入不会覆盖正式草稿', () async {
    final journal = MemoryJournal();
    await journal.patch('a', {'draft': '不能覆盖的草稿'});
    final local = ReaderLocalState(journal);
    await local.open('a');
    journal.gate = Completer<void>();
    final one = local.annotate('note', 1, '原文', text: '不发送给模型');
    final two = local.reference(1, '引用');
    journal.gate!.complete();
    await Future.wait([one, two]);
    await local.open('b');
    expect(local.entries, isEmpty);
    expect(local.references, isEmpty);
    await local.open('a');
    expect(local.entries.single['text'], '不发送给模型');
    expect(local.references.single['quote'], '引用');
    expect(journal.rows['a']!['draft'], '不能覆盖的草稿');
    local.dispose();
  });
  test('读取失败不能用空私人记录覆盖已有数据，失败写入可重试', () async {
    final journal = MemoryJournal();
    final local = ReaderLocalState(journal);
    await local.open('a');
    await local.annotate('bookmark', 2, '旧片段');
    journal.failRead = true;
    await local.open('a');
    await local.annotate('bookmark', 3, '不得覆盖');
    expect(local.loaded, isFalse);
    journal.failRead = false;
    await local.retry();
    expect(local.entries.single['quote'], '旧片段');
    journal.failWrite = true;
    await local.annotate('note', 2, '原文', text: '新笔记');
    expect(local.error, isNotNull);
    journal.failWrite = false;
    await local.retry();
    await local.open('a');
    expect(local.entries.length, 2);
    local.dispose();
  });
  test('时间授权要求目标与上限，并保留明确的不可代决事项', () {
    expect(
      () => readerTimeInstruction(mode: 'until', goal: '有人来', limit: ''),
      throwsFormatException,
    );
    expect(
      () => readerTimeInstruction(mode: 'short', goal: '', limit: ''),
      throwsFormatException,
    );
    final value = readerTimeInstruction(
      mode: 'skip',
      goal: '开店',
      limit: '三天',
      forbidden: '不借钱',
      reserved: '唐棠来访',
    );
    expect(value, contains('最多：三天'));
    expect(value, contains('不能：不借钱'));
    expect(value, contains('遇到唐棠来访，请在执行该决定前停下'));
  });

  Future<(ExperienceController, PortalPreferences)> mount(
    WidgetTester tester, {
    bool paged = false,
    bool localReadOnly = false,
    FakeExperienceApi? apiOverride,
    Json? authorWorld,
    String lastMode = 'act',
    PortalServiceClient Function()? artifactClient,
    bool generativeUiEnabled = true,
    MemoryJournal? journalOverride,
    bool settle = true,
    bool waitForAutomaticPreparation = true,
  }) async {
    tester.view.physicalSize = const Size(800, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final journal = journalOverride ?? MemoryJournal(),
        api = apiOverride ?? FakeExperienceApi();
    final view = testView(text: '第一段独特原文。');
    view['pages'] = <Map<String, dynamic>>[
      Map<String, dynamic>.from((view['pages'] as List).single),
      {
        ...Map<String, dynamic>.from((view['pages'] as List).single),
        'revision': 2,
        'text': '第二段独特原文。',
        'input': '此前的表达',
        'mode': lastMode,
      },
    ];
    view['revision'] = 2;
    api.viewOverride = view;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    final p = PortalPreferences(
      journal: journal,
      backendUrl: c.session.backendUrl,
      workspaceId: c.session.workspaceId,
    );
    await p.hydrate();
    if (paged) await p.setValue('readingMode', 'paged');
    await c.initialize();
    await c.open('experience-a');
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(
          controller: c,
          preferences: p,
          authorWorld: authorWorld,
          artifactClient: artifactClient,
          generativeUiEnabled: generativeUiEnabled,
          localReadOnly: localReadOnly,
          onPreferences: () {},
          onPortalHome: () {},
          onPortalShelf: () {},
        ),
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
      if (artifactClient != null && waitForAutomaticPreparation) {
        await tester.pump(const Duration(milliseconds: 1200));
        await tester.pumpAndSettle();
      }
    } else {
      for (var i = 0; i < 5; i++)
        await tester.pump(const Duration(milliseconds: 50));
    }
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      c.dispose();
      p.dispose();
      c.session.dispose();
    });
    return (c, p);
  }

  testWidgets('精确界面命令本机处理且命名片刻落盘，不调用模型', (tester) async {
    final (c, p) = await mount(tester);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    Future<void> send(String input) async {
      await tester.enterText(
        find.byKey(const ValueKey('experience-input')),
        input,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
    }

    await send('字大一点');
    expect(p.fontSize, 20);
    expect(c.draft, '字大一点');
    await send('保存为：窗边片刻');
    expect(c.draft, isEmpty);
    final local = ReaderLocalState(c.journal);
    await local.open(
      experienceScope(
        c.session.backendUrl,
        c.session.workspaceId,
        c.current!.id,
        'named-checkpoints',
      ),
    );
    expect(local.entries.single['text'], '窗边片刻');
    expect(local.entries.single['object_id'], c.current!.branchId);
    local.dispose();
    await send('打开历史');
    expect(find.byKey(const ValueKey('reader-history-search')), findsOneWidget);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
  });
  testWidgets('收束按钮正式发送源请求并保留草稿，封存分支禁止行动', (tester) async {
    final (c, _) = await mount(tester);
    await c.saveDraft('未提交的打算');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('让这段故事合理收束'));
    await tester.tap(find.text('让这段故事合理收束'));
    await tester.pumpAndSettle();
    expect(
      (c.api as FakeExperienceApi).sent.single['input'],
      contains('不强加新危机阻止结束'),
    );
    expect(c.draft, '未提交的打算');
  });
  testWidgets('封存分支的明确提交被拦截，草稿保留', (tester) async {
    final (c, _) = await mount(tester);
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('分支与存档'));
    await tester.tap(find.text('分支与存档'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('封存分支').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('关闭').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '我走出门',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(c.draft, '我走出门');
    expect(find.text('这条分支已封存，请先在分支面板恢复。'), findsOneWidget);
  });
  testWidgets('按页阅读与历史搜索只读取原文，不提交或覆盖草稿', (tester) async {
    final (c, _) = await mount(tester, paged: true);
    await c.saveDraft('尚未发送');
    await tester.pumpAndSettle();
    expect(find.text('第一段独特原文。'), findsOneWidget);
    expect(find.text('第二段独特原文。'), findsNothing);
    await tester.tap(find.text('下一页'));
    await tester.pumpAndSettle();
    expect(find.text('第二段独特原文。'), findsOneWidget);
    expect(find.text('第一段独特原文。'), findsNothing);
    await tester.tap(find.byTooltip('分支与历史'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('reader-history-search')),
      '第一段',
    );
    await tester.pumpAndSettle();
    expect(find.text('1 段记录'), findsOneWidget);
    expect(c.draft, '尚未发送');
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(tester.takeException(), isNull);
  });
  testWidgets('页记录书签落盘，私人笔记不进入发送上下文', (tester) async {
    final (c, _) = await mount(tester, paged: true);
    await tester.tap(find.byTooltip('第 1 页记录选项'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('加书签'));
    await tester.pumpAndSettle();
    final local = ReaderLocalState(c.journal);
    await local.open(c.scope);
    expect(local.entries.single['kind'], 'bookmark');
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await local.annotate('note', 1, '第一段独特原文。', text: '不能发送的私人秘密');
    local.dispose();
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '我看向窗外',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['input'], '我看向窗外');
  });
  testWidgets('时间表单校验上限，明确发送 act 并保留原草稿', (tester) async {
    final (c, _) = await mount(tester);
    await c.saveDraft('原来的想法');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('安排一段时间'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('等到……'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, '等待的时刻或事情'), '有人来');
    await tester.tap(find.text('开始等待'));
    await tester.pumpAndSettle();
    expect(find.text('请填写最晚到什么时候结束。'), findsOneWidget);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    await tester.enterText(find.widgetWithText(TextField, '最晚到什么时候结束'), '日落');
    await tester.tap(find.text('开始等待'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['mode'], 'act');
    expect(
      (c.api as FakeExperienceApi).sent.single['input'],
      contains('最多：日落'),
    );
    expect(c.draft, '原来的想法');
  });
  Future<void> tool(WidgetTester tester, String title) async {
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text(title));
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
  }

  testWidgets('命名片刻跨分支可见，恢复从原分支页码正式fork且不发送', (tester) async {
    final api = _ReaderBranchApi();
    final (c, _) = await mount(tester, apiOverride: api);
    final originalScope = c.scope;
    await c.saveDraft('保留原分支草稿');
    await tool(tester, '分支与存档');
    await tester.tap(find.text('保存此刻'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, '片刻名称'), '雨停的时刻');
    await tester.tap(find.widgetWithText(FilledButton, '保存此刻'));
    await tester.pumpAndSettle();
    final named = await c.journal.read(
      experienceScope(
        c.session.backendUrl,
        c.session.workspaceId,
        c.current!.id,
        'named-checkpoints',
      ),
    );
    expect(
      ((named['reader_personal'] as Map)['entries'] as List)
          .single['object_id'],
      'main',
    );
    expect(api.forks, isEmpty);
    expect(api.sent, isEmpty);
    Navigator.of(tester.element(find.text('命名存档'))).pop();
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 5));
    tester.view.physicalSize = const Size(390, 844);
    await c.open('experience-a', branch: 'other');
    await tester.pumpAndSettle();
    await tool(tester, '分支与存档');
    expect(find.text('雨停的时刻'), findsOneWidget);
    await tester.tap(find.text('从此刻继续'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('恢复并继续'));
    await tester.pumpAndSettle();
    expect(api.forks.single['from_branch_id'], 'main');
    expect(api.forks.single['from_revision'], 2);
    expect(api.forks.single['name'], '雨停的时刻 · 继续');
    expect(api.sent, isEmpty);
    expect((await c.journal.read(originalScope))['draft'], '保留原分支草稿');
    expect(tester.takeException(), isNull);
  });
  testWidgets('重新生成确认后先分支再原模式原输入重发，原草稿保留', (tester) async {
    final (c, _) = await mount(tester, apiOverride: _ReaderBranchApi());
    final api = c.api as FakeExperienceApi;
    api.status = 'pending';
    final source = c.scope;
    await c.saveDraft('尚未发送的新想法');
    await tool(tester, '重新生成');
    expect(api.forks, isEmpty);
    expect(api.sent, isEmpty);
    await tester.tap(find.text('建立分支并重生成'));
    await tester.pumpAndSettle();
    expect(api.forks.single['from_revision'], 1);
    expect(api.sent.single['branch_id'], 'other');
    expect(api.sent.single['mode'], 'act');
    expect(api.sent.single['input'], '此前的表达');
    expect(api.sent.single['expected_revision'], 1);
    expect((await c.journal.read(source))['draft'], '尚未发送的新想法');
    expect(tester.takeException(), isNull);
    await c.cancel();
    await tester.pumpAndSettle();
  });
  testWidgets('重新生成阅读请求保持read模式且不会带入当前行动草稿', (tester) async {
    final (c, _) = await mount(tester, lastMode: 'read');
    final api = c.api as FakeExperienceApi;
    await c.saveDraft('尚未授权发送的行动');
    await tool(tester, '重新生成');
    await tester.tap(find.text('建立分支并重生成'));
    await tester.pumpAndSettle();
    expect(api.sent.single['mode'], 'read');
    expect(api.sent.single['input'], '');
    expect(api.sent.single['branch_id'], 'other');
  });
  testWidgets('重新生成分支结果未知时不自动向旧分支发行动', (tester) async {
    final (c, _) = await mount(tester);
    final api = c.api as FakeExperienceApi;
    api.timeout = true;
    await c.saveDraft('保留草稿');
    await tool(tester, '重新生成');
    await tester.tap(find.text('建立分支并重生成'));
    await tester.pumpAndSettle();
    expect(api.forks, hasLength(1));
    expect(api.sent, isEmpty);
    expect(c.current!.branchId, 'main');
    expect(c.unknown, isTrue);
    expect(c.draft, '保留草稿');
  });
  testWidgets('作者秘密只在明确剧透确认后显示，不进入请求', (tester) async {
    final (c, _) = await mount(
      tester,
      authorWorld: {
        'id': 'world-1',
        'title': '测试作者版本',
        'version': 1,
        'characters': [
          {
            'name': '林',
            'goal': '远行',
            'history': '旧日往事',
            'secret': '只在作者视图出现的秘密',
          },
        ],
      },
    );
    expect(find.textContaining('只在作者视图出现的秘密'), findsNothing);
    await tool(tester, '作者视图 · 可能剧透');
    expect(find.textContaining('只在作者视图出现的秘密'), findsNothing);
    await tester.tap(find.text('我知道，查看幕后'));
    await tester.pumpAndSettle();
    expect(find.text('秘密：只在作者视图出现的秘密'), findsOneWidget);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(c.draft, isEmpty);
  });
  testWidgets('本地资料查询打开原版视图，不创建故事行动并清空已处理查询', (tester) async {
    final (c, _) = await mount(tester);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '查看人物关系',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(find.text('已知资料视图'), findsOneWidget);
    expect(c.draft, isEmpty);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
  });
  testWidgets('资料引用随下次表达发送，成功后清除且不包含私人笔记', (tester) async {
    final (c, _) = await mount(tester);
    await tester.tap(find.byTooltip('页边记事'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('最新资料 · 第 2 页'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('关联下次输入').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('关闭').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '我看看窗外',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['input'], contains('正在下雨'));
    final stored = await c.journal.read(c.scope);
    expect((stored['reader_personal'] as Map)['object_selection'], isNull);
  });
  testWidgets('对照经历可选择具体片刻，没有历史快照时不代填当前状态', (tester) async {
    final (c, _) = await mount(tester);
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('对照经历与变化'));
    await tester.pumpAndSettle();
    expect(find.text('左侧片刻'), findsOneWidget);
    expect(find.text('右侧片刻'), findsOneWidget);
    expect(find.textContaining('所选片刻尚无可用的公开状态快照'), findsOneWidget);
    expect(find.text('左侧 · 第 1 页 · 清晨'), findsOneWidget);
    expect(find.text('右侧 · 第 2 页 · 清晨'), findsOneWidget);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
  });
  testWidgets('追问前保存期间再次编辑参数，最新CAS完成后才分类', (tester) async {
    final gate = Completer<void>();
    final routing = _CurrentUiRouting()..stateGate = gate;
    final (controller, _) = await mount(tester, artifactClient: routing.client);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '把成本也考虑进去',
    );
    await tester.pumpAndSettle();
    final surface = tester.widget<ReaderArtifactSurface>(
      find.byType(ReaderArtifactSurface),
    );
    surface.onMessage('advanced-state', {'budget': 40});
    await tester.pump();
    await tester.tap(find.byTooltip('发送'));
    await tester.pump();
    expect(routing.stateRequests.single['state'], {'budget': 40});
    expect(routing.uiRequests, isEmpty);
    surface.onMessage('advanced-state', {'budget': 80});
    await tester.pump();
    gate.complete();
    await tester.pumpAndSettle();
    expect(routing.stateRequests, hasLength(2));
    expect(routing.stateRequests.last['state'], {'budget': 80});
    expect(routing.stateRequests.last['expected_state_revision'], 1);
    expect(routing.events, ['state', 'state', 'prepare']);
    expect(controller.draft, isEmpty);
    expect((controller.api as FakeExperienceApi).sent, isEmpty);
  });

  for (final loseStateResponse in [false, true]) {
    testWidgets('追问前保存最新界面参数，保存丢失=$loseStateResponse 时保留草稿', (tester) async {
      final routing = _CurrentUiRouting()
        ..loseStateResponse = loseStateResponse;
      final (controller, _) = await mount(
        tester,
        artifactClient: routing.client,
      );
      const input = '把成本也考虑进去';
      await tester.tap(find.text('展开行动'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('experience-input')),
        input,
      );
      await tester.pumpAndSettle();
      final surface = tester.widget<ReaderArtifactSurface>(
        find.byType(ReaderArtifactSurface),
      );
      surface.onMessage('advanced-state', {
        'dynamic': {
          'params': {'budget': 80},
        },
      });
      await tester.pump();
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(routing.stateRequests.single['state'], {
        'dynamic': {
          'params': {'budget': 80},
        },
      });
      expect(routing.stateRequests.single['expected_state_revision'], 0);
      expect((controller.api as FakeExperienceApi).sent, isEmpty);
      if (loseStateResponse) {
        expect(routing.events, ['state']);
        expect(controller.draft, input);
        expect(routing.uiRequests, isEmpty);
        routing.loseStateResponse = false;
        await tester.ensureVisible(find.text('恢复作品请求'));
        await tester.tap(find.text('恢复作品请求'));
        await tester.pumpAndSettle();
        expect(routing.stateRequests[0], routing.stateRequests[1]);
        await tester.ensureVisible(find.byTooltip('发送'));
        await tester.tap(find.byTooltip('发送'));
        await tester.pumpAndSettle();
        expect(routing.events, ['state', 'state', 'prepare']);
      } else {
        expect(routing.events, ['state', 'prepare']);
      }
      expect(routing.uiRequests.single['intent'], input);
      expect(controller.draft, isEmpty);
    });
  }

  testWidgets('当前界面的自由追问由模型解释为编辑，不推进故事', (tester) async {
    final routing = _CurrentUiRouting();
    final (controller, _) = await mount(tester, artifactClient: routing.client);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '把成本也考虑进去',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests.single['intent'], '把成本也考虑进去');
    expect(routing.actionRequests, isEmpty);
    expect((controller.api as FakeExperienceApi).sent, isEmpty);
    expect(controller.draft, isEmpty);
  });

  testWidgets('当前界面下的故事表达经模型分类后原样续写一次', (tester) async {
    final routing = _CurrentUiRouting()..decision = 'story';
    final (controller, _) = await mount(tester, artifactClient: routing.client);
    const input = '我对她说：“把成本也考虑进去。”';
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      input,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests.single['intent'], input);
    expect(routing.actionRequests.single['input'], input);
    expect((controller.api as FakeExperienceApi).sent.single['input'], input);
    expect(controller.draft, isEmpty);
  });

  for (final decision in ['mixed', 'clarify']) {
    testWidgets('当前界面自由输入判为 $decision 时保留草稿等待澄清', (tester) async {
      final routing = _CurrentUiRouting()..decision = decision;
      final (controller, _) = await mount(
        tester,
        artifactClient: routing.client,
      );
      const input = '把成本也考虑进去，然后问她的看法';
      await tester.tap(find.text('展开行动'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('experience-input')),
        input,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(routing.uiRequests.single['intent'], input);
      expect(routing.actionRequests, isEmpty);
      expect((controller.api as FakeExperienceApi).sent, isEmpty);
      expect(controller.draft, input);
    });
  }

  for (final mode in ['ask', 'read']) {
    testWidgets('当前界面不改变显式 $mode 模式', (tester) async {
      final routing = _CurrentUiRouting();
      final (controller, _) = await mount(
        tester,
        artifactClient: routing.client,
      );
      if (mode == 'ask') {
        await tester.tap(find.text('展开行动'));
        await tester.pumpAndSettle();
        await controller.saveDraft('把成本也考虑进去', selectedMode: 'ask');
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('发送'));
      } else {
        await tester.tap(find.text('继续经历'));
      }
      await tester.pumpAndSettle();
      expect(routing.uiRequests, isEmpty);
      expect(routing.actionRequests, isEmpty);
      expect((controller.api as FakeExperienceApi).sent.single['mode'], mode);
    });
  }

  for (final availability in ['none', 'disabled', 'history', 'stale']) {
    testWidgets('$availability 界面不激活自由输入分类入口', (tester) async {
      final routing = _CurrentUiRouting()
        ..presentation = availability != 'none';
      final (controller, _) = await mount(
        tester,
        artifactClient: routing.client,
        generativeUiEnabled: availability != 'disabled',
      );
      if (availability == 'history' || availability == 'stale') {
        final workbench = tester.widget<ReaderPreparedWorkbench>(
          find.byType(ReaderPreparedWorkbench),
        );
        await workbench.repository.load(revisionId: availability);
        await tester.pumpAndSettle();
      }
      const input = '把成本也考虑进去';
      await tester.tap(find.text('展开行动'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('experience-input')),
        input,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('发送'));
      await tester.pumpAndSettle();
      expect(routing.uiRequests, isEmpty);
      expect(routing.actionRequests, isEmpty);
      expect((controller.api as FakeExperienceApi).sent.single['input'], input);
    });
  }

  testWidgets('自由输入分类丢失后同编号恢复，重发不会重复分类或故事提交', (tester) async {
    final routing = _CurrentUiRouting()
      ..decision = 'story'
      ..loseResponse = true;
    final (controller, _) = await mount(tester, artifactClient: routing.client);
    const input = '我对她说：“把成本也考虑进去。”';
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      input,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests, hasLength(1));
    expect(controller.draft, input);
    expect((controller.api as FakeExperienceApi).sent, isEmpty);
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests, hasLength(1));
    routing.loseResponse = false;
    await tester.ensureVisible(find.text('恢复作品请求'));
    await tester.tap(find.text('恢复作品请求'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests, hasLength(2));
    expect(routing.uiRequests[0], routing.uiRequests[1]);
    expect((controller.api as FakeExperienceApi).sent, isEmpty);
    await tester.ensureVisible(find.byTooltip('发送'));
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(routing.uiRequests, hasLength(2));
    expect(routing.actionRequests, hasLength(1));
    expect((controller.api as FakeExperienceApi).sent.single['input'], input);
    expect(controller.draft, isEmpty);
  });

  testWidgets('当前作品待恢复时保护界面语义判断且显式继续仍可发送', (tester) async {
    final journal = MemoryJournal(),
        session = testSession(),
        routing = _CurrentUiRouting();
    final artifactScope = experienceScope(
      session.backendUrl,
      session.workspaceId,
      'experience-a',
      'artifact:main:2',
    );
    session.dispose();
    await journal.patch(artifactScope, {
      'pending': {
        'path': '/v1/experiences/experience-a/artifacts/prepare',
        'body': {
          'request_id': 'auto-current',
          'branch_id': 'main',
          'expected_revision': 2,
          'retry': false,
        },
      },
    });
    final (c, _) = await mount(
      tester,
      journalOverride: journal,
      artifactClient: routing.client,
    );
    expect(find.text('恢复作品请求'), findsOneWidget);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '把右边那块挪一下',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(routing.uiRequests, isEmpty);
    expect(c.draft, '把右边那块挪一下');
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '继续',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['mode'], 'read');
    expect((await journal.read(artifactScope))['pending'], isNotNull);
  });

  testWidgets('阅读窗口内快速继续正文会取消尚未开始的自动整理', (tester) async {
    final methods = <String>[];
    final (c, _) = await mount(
      tester,
      waitForAutomaticPreparation: false,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          methods.add(request.method);
          return http.Response('{"artifact":null,"revisions":[]}', 200);
        }),
      ),
    );
    expect(methods, ['GET']);
    expect(find.text('第一段独特原文。'), findsOneWidget);
    expect(find.text('第二段独特原文。'), findsOneWidget);
    await tester.tap(find.text('展开行动'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '继续',
    );
    await tester.pump();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['mode'], 'read');
    await tester.pump(const Duration(milliseconds: 1200));
    await tester.pumpAndSettle();
    expect(methods, ['GET'], reason: '快速续读无需先花费一次可选界面模型调用');
  });

  testWidgets('后台自动整理尚未返回时可继续正文且不会重复发送', (tester) async {
    final journal = MemoryJournal(), prepared = Completer<http.Response>();
    final (c, _) = await mount(
      tester,
      journalOverride: journal,
      settle: false,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') return prepared.future;
          return http.Response('{"artifact":null,"revisions":[]}', 200);
        }),
      ),
    );
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('停止等待'), findsOneWidget);
    await tester.tap(find.text('展开行动'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '继续',
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byTooltip('发送'));
    for (var i = 0; i < 5; i++)
      await tester.pump(const Duration(milliseconds: 100));
    expect((c.api as FakeExperienceApi).sent, hasLength(1));
    expect((c.api as FakeExperienceApi).sent.single['mode'], 'read');
    final scope = experienceScope(
      c.session.backendUrl,
      c.session.workspaceId,
      'experience-a',
      'artifact:main:2',
    );
    expect((await journal.read(scope))['pending'], isNotNull);
    prepared.complete(http.Response('{"artifact":null,"revisions":[]}', 200));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent, hasLength(1));
  });

  testWidgets('后台自动整理失败后普通对话仍可发送且保留未知作品请求', (tester) async {
    final journal = MemoryJournal();
    final (c, _) = await mount(
      tester,
      journalOverride: journal,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') throw StateError('整理连接中断');
          return http.Response('{"artifact":null,"revisions":[]}', 200);
        }),
      ),
    );
    final artifactScope = experienceScope(
      c.session.backendUrl,
      c.session.workspaceId,
      'experience-a',
      'artifact:main:2',
    );
    final original = object((await journal.read(artifactScope))['pending']);
    expect(object(original['body'])['retry'], false);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '你好，我想先坐一会儿。',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent, hasLength(1));
    expect((c.api as FakeExperienceApi).sent.single['input'], '你好，我想先坐一会儿。');
    expect(
      (await journal.read(artifactScope))['pending'],
      original,
      reason: '未知作品结果保留原请求，不能通过清空存档解除输入锁',
    );
    expect(find.text('正在确认上一项界面或输入请求，草稿已保留。'), findsNothing);
  });

  testWidgets('重新打开没有作品的待确认界面请求仍显示恢复入口并保护草稿', (tester) async {
    final journal = MemoryJournal(), session = testSession();
    final artifactScope = experienceScope(
      session.backendUrl,
      session.workspaceId,
      'experience-a',
      'artifact:main:2',
    );
    session.dispose();
    final pendingRequest = <String, dynamic>{
      'path': '/v1/experiences/experience-a/artifacts/prepare',
      'body': {
        'request_id': 'retained-ui-request',
        'branch_id': 'main',
        'expected_revision': 2,
        'retry': true,
        'intent': '帮我画一张人物关系图',
      },
    };
    await journal.patch(artifactScope, {'pending': pendingRequest});
    final requests = <Json>[];
    final (c, _) = await mount(
      tester,
      journalOverride: journal,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST')
            requests.add(object(jsonDecode(request.body)));
          return http.Response('{"artifact":null,"revisions":[]}', 200);
        }),
      ),
    );
    expect(find.text('恢复作品请求'), findsOneWidget);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '这条新草稿要保留',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(c.draft, '这条新草稿要保留');
    await tester.ensureVisible(find.text('恢复作品请求'));
    await tester.tap(find.text('恢复作品请求'));
    await tester.pumpAndSettle();
    expect(requests.single, pendingRequest['body']);
    expect((await journal.read(artifactScope))['pending'], isNull);
    expect(c.draft, '这条新草稿要保留');
    await tester.ensureVisible(find.byTooltip('发送'));
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.single['input'], '这条新草稿要保留');
  });

  testWidgets('显式界面请求走原作品准备，不推进故事；普通行动仍走act', (tester) async {
    final prepared = <Json>[];
    final (c, _) = await mount(
      tester,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final body = request.method == 'POST'
              ? object(jsonDecode(request.body))
              : <String, dynamic>{};
          if (request.method == 'POST') prepared.add(body);
          if (body['input_routing'] == true ||
              request.url.path.endsWith('/input'))
            return http.Response(
              jsonEncode({
                'artifact': null,
                'revisions': [],
                'routing_scope': {
                  'request_id': body['request_id'],
                  'experience_id': 'experience-a',
                  'branch_id': 'main',
                  'base_revision': 2,
                },
                if (body['input_routing'] == true)
                  'intent_decision': {
                    'kind': (body['intent'] as String).contains('画一张')
                        ? 'create'
                        : (body['intent'] as String).contains('还是')
                        ? 'mixed'
                        : 'story',
                    'target': null,
                    'message': '',
                  }
                else
                  'input_decision': {'kind': 'unrelated', 'message': ''},
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          return http.Response(
            '{"artifact":null,"revisions":[]}',
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      ),
    );
    expect(prepared, hasLength(1));
    expect(prepared.single['retry'], false);
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '帮我画一张人物关系图',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(prepared, hasLength(2));
    expect(prepared.last['intent'], '帮我画一张人物关系图');
    expect(prepared.last['input_routing'], true);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(c.draft, isEmpty);
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '画图还是走过去',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(c.draft, isEmpty);
    expect((c.api as FakeExperienceApi).sent.single['input'], '画图还是走过去');
    expect(prepared.last['input_routing'], true);
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '我把表格交给她',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect((c.api as FakeExperienceApi).sent.last['input'], '我把表格交给她');
    expect(prepared, hasLength(2), reason: '普通行动无需额外模型分类');
  });
  testWidgets('普通自然语言直接续写，不等待模型分类或隐式执行合同', (tester) async {
    final api = _RoutedExecuteApi(), requests = <Json>[];
    final (c, _) = await mount(
      tester,
      apiOverride: api,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final body = request.method == 'POST'
              ? object(jsonDecode(request.body))
              : <String, dynamic>{};
          final result = <String, dynamic>{'artifact': null, 'revisions': []};
          if (body['input_routing'] == true ||
              request.url.path.endsWith('/input')) {
            requests.add(body);
            result['routing_scope'] = {
              'request_id': body['request_id'],
              'experience_id': 'experience-a',
              'branch_id': 'main',
              'base_revision': 2,
            };
            if (body['input_routing'] == true)
              result['intent_decision'] = {
                'kind': 'story',
                'target': null,
                'message': '',
              };
            else
              result['input_decision'] = {
                'kind': 'execute',
                'message': '已找到唯一合同',
                'execute': {
                  'artifact_id': 'offer',
                  'branch_id': 'main',
                  'expected_revision': 2,
                  'revision_id': 'v1',
                  'expected_head': 'v2',
                  'definition_digest': 'digest',
                  'kind': 'game',
                  'reference': {
                    'branchId': 'main',
                    'version': 2,
                    'surfaceId': 'shop',
                    'actionId': 'buy',
                  },
                  'params': {},
                },
              };
          }
          return http.Response(
            jsonEncode(result),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      ),
    );
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '买一包茶。',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pumpAndSettle();
    expect(api.sent.single['input'], '买一包茶。');
    expect(c.draft, isEmpty);
    expect(api.executed, isEmpty);
    expect(requests, isEmpty);
  });
  testWidgets('界面分类迟到后保留新草稿，不继续解释或发送旧行动', (tester) async {
    final gate = Completer<void>();
    var routeCalls = 0;
    final (c, _) = await mount(
      tester,
      artifactClient: () => PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final body = request.method == 'POST'
              ? object(jsonDecode(request.body))
              : <String, dynamic>{};
          if (body['input_routing'] == true) {
            routeCalls++;
            await gate.future;
            return http.Response(
              jsonEncode({
                'artifact': null,
                'revisions': [],
                'routing_scope': {
                  'request_id': body['request_id'],
                  'experience_id': 'experience-a',
                  'branch_id': 'main',
                  'base_revision': 2,
                },
                'intent_decision': {
                  'kind': 'story',
                  'target': null,
                  'message': '',
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path.endsWith('/input')) fail('迟到分类不能解释旧行动');
          return http.Response(
            '{"artifact":null,"revisions":[]}',
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      ),
    );
    await tester.tap(find.text('展开行动'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '帮我画一张人物关系图',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('发送'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '新草稿',
    );
    await tester.pump();
    gate.complete();
    await tester.pumpAndSettle();
    expect(routeCalls, 1);
    expect(c.draft, '新草稿');
    expect((c.api as FakeExperienceApi).sent, isEmpty);
  });
  testWidgets('本机只读开场保留阅读与资料，隐藏输入和所有模型提交入口', (tester) async {
    final (c, _) = await mount(tester, localReadOnly: true);
    expect(find.text('本机只读开场'), findsOneWidget);
    expect(find.text('继续经历'), findsNothing);
    expect(find.byKey(const ValueKey('experience-input')), findsNothing);
    expect(find.text('展开行动'), findsNothing);
    await tester.tap(find.byTooltip('故事工具'));
    await tester.pumpAndSettle();
    expect(find.text('重新生成'), findsNothing);
    expect(find.text('交互作品'), findsNothing);
    expect(find.text('换种写法'), findsNothing);
    expect(find.text('回顾与搜索'), findsWidgets);
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    expect(c.current!.pages.last.outcome, 'continues');
  });
  testWidgets('正文AX暴露静态文字而非空禁用输入框，选区工具仍可用', (tester) async {
    final semantics = tester.ensureSemantics();
    await mount(tester, paged: true);
    final prose = find.bySemanticsLabel('第一段独特原文。');
    expect(prose, findsOneWidget);
    expect(
      tester.getSemantics(prose),
      matchesSemantics(label: '第一段独特原文。', isTextField: false),
    );
    final selectable = tester.widget<SelectableText>(
      find.widgetWithText(SelectableText, '第一段独特原文。'),
    );
    selectable.onSelectionChanged!(
      const TextSelection(baseOffset: 0, extentOffset: 3),
      SelectionChangedCause.longPress,
    );
    await tester.pumpAndSettle();
    expect(find.text('已选 3 字'), findsOneWidget);
    expect(find.text('引用到草稿'), findsOneWidget);
    semantics.dispose();
  });
}

class _ReaderBranchApi extends FakeExperienceApi {
  @override
  Future<ExperienceOperation> cancel(String id, String requestId) async {
    cancels++;
    return ExperienceOperation(
      testOperation(
        requestId,
        id: id,
        branch: forks.isEmpty ? 'main' : 'other',
        status: 'cancelled',
      ),
    );
  }

  @override
  Future<ExperienceView> view(String id, {String? branch}) async {
    reads++;
    return ExperienceView({...viewOverride!, 'branch_id': branch ?? 'main'});
  }
}

class _CurrentUiRouting {
  final uiRequests = <Json>[],
      actionRequests = <Json>[],
      stateRequests = <Json>[];
  final events = <String>[];
  String decision = 'edit';
  bool loseResponse = false, loseStateResponse = false, presentation = true;
  Json state = {};
  int stateRevision = 0;
  Completer<void>? stateGate;

  PortalServiceClient client() => PortalServiceClient(
    () => 'https://api.invalid',
    client: MockClient((request) async {
      final body = request.method == 'POST'
          ? object(jsonDecode(request.body))
          : <String, dynamic>{};
      if (request.url.path.endsWith('/state')) {
        stateRequests.add(body);
        events.add('state');
        await stateGate?.future;
        if (loseStateResponse) throw const FormatException('参数保存响应丢失');
        state = object(body['state']);
        stateRevision++;
      }
      final revisionId =
          request.url.queryParameters['revision_id'] ?? 'current';
      final revision = revisionId == 'stale' ? 1 : 2;
      final scope = {
        'worldKey': 'experience-a',
        'sessionId': 'experience-a',
        'branchId': 'main',
        'baseVersion': revision,
      };
      final response = <String, dynamic>{
        'artifact': {
          'artifact_id': 'current-tool',
          'revision_id': revisionId,
          'base_revision': revision,
          'state_revision': stateRevision,
          'state': state,
          'stale': revisionId == 'stale',
          'payload': {
            'schemaVersion': 1,
            'scope': scope,
            'state': {'version': revision},
            'sourceGame': {'surfaces': <Json>[]},
            'definition': presentation
                ? {'id': 'comparison', 'scope': scope}
                : null,
            'capabilities': {'attempt': true, 'deterministic': false},
            'reason': '测试中的当前界面',
          },
        },
        'revisions': [
          for (final entry in ['current', 'history', 'stale'])
            {
              'revision_id': entry,
              'base_revision': entry == 'stale' ? 1 : 2,
              'title': entry,
            },
        ],
      };
      if (body['input_routing'] == true ||
          request.url.path.endsWith('/input')) {
        response['routing_scope'] = {
          'request_id': body['request_id'],
          'experience_id': 'experience-a',
          'branch_id': 'main',
          'base_revision': 2,
        };
        if (body['input_routing'] == true) {
          uiRequests.add(body);
          events.add('prepare');
          if (loseResponse) throw const FormatException('分类响应丢失');
          response['intent_decision'] = {
            'kind': decision,
            'target': decision == 'edit' ? 'current-tool' : null,
            'message': '模型分类测试回应',
          };
        } else {
          actionRequests.add(body);
          response['input_decision'] = {'kind': 'unrelated', 'message': ''};
        }
      }
      return http.Response(
        jsonEncode(response),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }),
  );
}

class _RoutedExecuteApi extends FakeExperienceApi
    implements ExperienceArtifactApi {
  final executed = <Json>[];
  @override
  Future<ExperienceOperation> executeArtifact(
    String id,
    String artifactId,
    Json body,
  ) async {
    executed.add(body);
    return ExperienceOperation({
      ...testOperation(body['request_id'], id: id, status: 'cancelled'),
      'base_revision': 2,
    });
  }
}
