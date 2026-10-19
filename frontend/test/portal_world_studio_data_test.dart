import 'dart:convert';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/demo_world_catalog.dart';
import 'package:elselife_frontend/portal/portal_world_detail.dart';
import 'package:elselife_frontend/portal/portal_world_studio.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';

class MemoryJournal implements ExperienceJournal {
  final Map<String, Map<String, dynamic>> records = {};

  @override
  Future<Map<String, dynamic>> read(String scope) async =>
      Map<String, dynamic>.from(records[scope] ?? {});

  @override
  Future<void> patch(String scope, Map<String, dynamic> values) async {
    records[scope] = {...?records[scope], ...values};
  }
}

PortalWorldDraft completeDraft() => PortalWorldDraft()
  ..title = '雨天的书店'
  ..description = '一间旧街书店。'
  ..identity = '临时店主'
  ..location = '旧街'
  ..opening = '雨落下时，有人推门进来。';

void main() {
  test('导入后秘密保存在作者草稿，但正式种子只含公开字段', () {
    final imported = parsePortalWorldImport(
      jsonEncode({
        'title': '雨天的书店',
        'description': '公开简介',
        'rules': ['先确认事实'],
        'identity': '店主',
        'location': '旧街',
        'opening': '雨天开场。',
        'characters': [
          {
            'name': '阿言',
            'role': '顾客',
            'public': '带着雨伞。',
            'goal': '偷看账本',
            'history': '曾与店主争执',
            'secret': 'SECRET_PRIVATE',
          },
        ],
      }),
      'world.json',
    );
    final draft = PortalWorldDraft()..applyImport(imported);
    expect(draft.characters.single.secret, 'SECRET_PRIVATE');
    final seed = draft.toPublicSeed();
    expect(seed, contains('带着雨伞'));
    expect(seed, isNot(contains('SECRET_PRIVATE')));
    expect(seed, isNot(contains('偷看账本')));
    expect(seed, isNot(contains('曾与店主争执')));
    expect(seed, isNot(contains('故事想法')));
  });

  test('角色卡替换占位符，世界书忽略停用条目', () {
    final result = parsePortalWorldImport(
      jsonEncode({
        'name': '温芷',
        'description': '茶样供货人',
        'first_mes': '{{char}}对{{user}}说：欢迎。',
        'personality': '作者背景',
        'character_book': {
          'entries': [
            {'content': '人物只知道已知事实。'},
            {'content': '停用秘密', 'enabled': false},
          ],
        },
      }),
      'character.json',
    );
    expect(result.kind, 'character');
    expect(result.fields['opening'], '温芷对你说：欢迎。');
    expect(result.fields['rules'], ['人物只知道已知事实。']);
    expect(result.warnings.join(), contains('停用'));
  });

  test('非法导入不会修改已有草稿', () {
    final draft = completeDraft();
    final before = jsonEncode(draft.toJson());
    expect(
      () => parsePortalWorldImport('{', 'broken.json'),
      throwsFormatException,
    );
    expect(jsonEncode(draft.toJson()), before);
  });

  test('本机版本是快照，重存同一世界递增版本', () async {
    final journal = MemoryJournal();
    final repo = PortalWorldRepository(
      journal: journal,
      backendUrl: 'http://localhost',
      workspaceId: 'local-workspace',
    );
    final draft = completeDraft();
    await repo.saveDraft(draft);
    expect((await repo.loadDraft())!.title, '雨天的书店');
    final first = await repo.saveVersion(draft);
    draft.title = '第二版书店';
    final second = await repo.saveVersion(draft);
    final versions = await repo.loadVersions();
    expect([first.version, second.version], [1, 2]);
    expect(versions.first.draft.title, '雨天的书店');
    expect(versions.last.draft.title, '第二版书店');
    expect(await repo.loadDraft(), isNull);
    expect(
      (journal.records[repo.scope]!['versions'] as List).every(
        (v) => (v as Map)['localOnly'] == true,
      ),
      isTrue,
    );
  });

  test('正式创作种子超过服务端 32 KB 时拒绝', () {
    final draft = completeDraft()..opening = List.filled(11000, '甲').join();
    expect(() => draft.toPublicSeed(), throwsFormatException);
  });

  test('预设复制使用独立本机 id，作者 JSON 可重新导入叙述偏好', () {
    final preset = portalDraftFromPreset(demoWorldPresets.first);
    final copied = portalCopyWorld(preset);
    expect(copied.id, isNot(preset.id));
    expect(copied.title, contains('副本'));
    expect(copied.characters.first.secret, preset.characters.first.secret);
    expect(
      copied.toPublicSeed(),
      isNot(contains(preset.characters.first.secret)),
    );
    copied.pace = '紧凑';
    final imported = parsePortalWorldImport(
      jsonEncode(copied.toJson()),
      'author.json',
    );
    final restored = PortalWorldDraft()..applyImport(imported);
    expect(restored.pace, '紧凑');
    expect(restored.title, copied.title);
  });

  test('预设编辑保留原版作者人物资料，但公开种子剔除幕后秘密', () {
    final harbor = portalDraftFromPreset(demoWorldPresets.first);
    expect(harbor.characters.first.role, '港务档案员');
    expect(harbor.characters.first.goal, contains('旧档清点'));
    expect(harbor.characters.first.secret, contains('父亲'));
    final publicSeed = harbor.toPublicSeed();
    expect(publicSeed, contains('林见微'));
    expect(publicSeed, isNot(contains('旧档清点')));
    expect(publicSeed, isNot(contains('父亲曾在补发电报')));

    final teahouse = portalDraftFromPreset(
      demoWorldPresets.firstWhere((world) => world.id == 'truth-teahouse'),
    );
    expect(teahouse.characters.first.history, contains('昨天答应'));
    expect(teahouse.style, contains('具体、温和而克制'));
    expect(teahouse.toPublicSeed(), isNot(contains('妹妹后来自己取走')));
  });

  testWidgets('本机世界详情仅展示公开资料，开始时不泄漏幕后字段', (tester) async {
    final draft = completeDraft()
      ..characters = [
        PortalWorldCharacterDraft(
          name: '阿言',
          public: '手里拿着雨伞',
          goal: 'SECRET_GOAL',
          history: 'SECRET_HISTORY',
          secret: 'SECRET_PRIVATE',
        ),
      ];
    final version = PortalWorldVersion(
      draft: draft,
      version: 1,
      savedAt: DateTime.now(),
    );
    String? submitted;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: PortalWorldDetail.custom(
              customVersion: version,
              onBack: () {},
              onStart: (seed) => submitted = seed,
              onEditWorld: (_) {},
              onCopyWorld: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('SECRET_PRIVATE'), findsNothing);
    await tester.ensureVisible(
      find.byKey(const ValueKey('portal-world-start')),
    );
    await tester.tap(find.byKey(const ValueKey('portal-world-start')));
    await tester.pump();
    expect(submitted, contains('手里拿着雨伞'));
    expect(submitted, isNot(contains('SECRET_PRIVATE')));
    expect(submitted, isNot(contains('SECRET_GOAL')));
    expect(submitted, isNot(contains('SECRET_HISTORY')));
    expect(tester.takeException(), isNull);
  });

  testWidgets('手机世界详情先显示角色入口再显示开场', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 850));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final version = PortalWorldVersion(
      draft: completeDraft(),
      version: 1,
      savedAt: DateTime.now(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: PortalWorldDetail.custom(
              customVersion: version,
              onBack: () {},
              onStart: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester.getTopLeft(find.text('你的角色')).dy,
      lessThan(tester.getTopLeft(find.text('开场')).dy),
    );
  });

  testWidgets('离线内置世界进入本机预设演示，不提交正式故事', (tester) async {
    var submitted = 0;
    final journal = MemoryJournal();
    final scope = experienceScope(
      'https://world.test',
      'workspace',
      'portal-demo',
      demoWorldPresets.first.id,
    );
    String? opened;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox.expand(
            child: PortalWorldDetail(
              world: demoWorldPresets.first,
              onBack: () {},
              onStart: (_) => submitted++,
              modelAvailable: false,
              selfScrolling: true,
              demoJournal: journal,
              demoScope: scope,
              onDemoOpened: (id) => opened = id,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('portal-world-start')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('portal-world-start')));
    await tester.pumpAndSettle();
    expect(opened, isNotNull);
    final entry = await PortalDemoRepository.fromSessionScope(
      journal: journal,
      scope: scope,
    ).entry(opened!);
    expect(entry?.readOnly, false);
    expect(entry?.worldId, demoWorldPresets.first.id);
    expect(submitted, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('离线自建世界保存本机只读开场，不提交正式故事', (tester) async {
    var submitted = 0;
    final journal = MemoryJournal();
    String? opened;
    final version = PortalWorldVersion(
      draft: completeDraft(),
      version: 1,
      savedAt: DateTime.now(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldDetail.custom(
            customVersion: version,
            onBack: () {},
            onStart: (_) => submitted++,
            modelAvailable: false,
            selfScrolling: true,
            demoJournal: journal,
            demoScope: experienceScope(
              'https://world.test',
              'workspace',
              'portal-demo',
              version.draft.id,
            ),
            onDemoOpened: (id) => opened = id,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('portal-world-start')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('portal-world-start')));
    await tester.pumpAndSettle();
    expect(opened, isNotNull);
    final entry = await PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://world.test',
      workspaceId: 'workspace',
    ).entry(opened!);
    expect(entry?.readOnly, true);
    expect(entry?.readonlyOpening?['title'], version.draft.title);
    expect(submitted, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('生成草案先审阅再采用，旧草稿仍按本机范围保存', (tester) async {
    final journal = MemoryJournal();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'local-workspace',
            journal: journal,
            onStart: (_) async {},
            onGenerateDraft: (_) async => completeDraft(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '一间雨天书店');
    await tester.ensureVisible(find.text('先编辑设定'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('先编辑设定'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('生成草案'));
    await tester.tap(find.text('生成草案'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('审阅世界草案'), findsOneWidget);
    await tester.tap(find.text('采用并继续编辑'));
    await tester.pumpAndSettle();
    final scope = experienceScope(
      'http://localhost',
      'local-workspace',
      'world-studio',
      'catalog',
    );
    final draft = journal.records[scope]!['draft'] as Map;
    expect(draft['title'], '雨天的书店');
    expect(draft['seed'], '一间雨天书店');
  });

  testWidgets('模型未连接仍可编辑保存，生成操作明确禁用', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'local-workspace',
            journal: MemoryJournal(),
            onStart: (_) async {},
            modelAvailable: false,
            onGenerateDraft: (_) async => completeDraft(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final quick = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '生成并开始'),
    );
    expect(quick.onPressed, isNull);
    await tester.ensureVisible(find.text('先编辑设定'));
    await tester.tap(find.text('先编辑设定'));
    await tester.pumpAndSettle();
    expect(find.text('生成并开始'), findsOneWidget);
    final generate = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, '生成草案'),
    );
    expect(generate.onPressed, isNull);
    expect(find.text('保存并预览'), findsOneWidget);
  });

  testWidgets('编辑已保存世界时不显示新建快捷开局', (tester) async {
    final journal = MemoryJournal();
    final version = await PortalWorldRepository(
      journal: journal,
      backendUrl: 'http://localhost',
      workspaceId: 'local-workspace',
    ).saveVersion(completeDraft());
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'local-workspace',
            journal: journal,
            onStart: (_) async {},
            initialVersion: version,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('生成并开始'), findsNothing);
    expect(find.text('保存新版本'), findsOneWidget);
  });

  testWidgets('创作页在移动端和桌面宽度均可绘制', (tester) async {
    final journal = MemoryJournal();
    for (final width in [390.0, 1280.0]) {
      await tester.binding.setSurfaceSize(Size(width, 850));
      await tester.pumpWidget(
        MaterialApp(
          home: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'local-workspace',
            journal: journal,
            onStart: (_) async {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('创造一个世界'), findsOneWidget);
      expect(find.textContaining('故事想法'), findsWidgets);
      expect(tester.takeException(), isNull);
    }
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('生成并开始会先保存本机世界版本，再提交公开资料', (tester) async {
    final journal = MemoryJournal();
    String? started;
    PortalWorldVersion? startedVersion;
    final generated = completeDraft()
      ..characters = [
        PortalWorldCharacterDraft(
          name: '阿言',
          public: '修伞匠',
          secret: 'PRIVATE_SECRET',
        ),
      ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'quick-world',
            journal: journal,
            onStart: (_) async => fail('已有世界版本时不应退回裸 seed 回调'),
            onStartWorld: (seed, version) async {
              started = seed;
              startedVersion = version;
            },
            onGenerateDraft: (_) async => generated,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '雨天的书店');
    await tester.tap(find.text('生成并开始'));
    await tester.pumpAndSettle();
    expect(startedVersion?.version, 1);
    expect(started, contains('世界名称：雨天的书店'));
    expect(started, isNot(contains('PRIVATE_SECRET')));
    final versions = await PortalWorldRepository(
      journal: journal,
      backendUrl: 'http://localhost',
      workspaceId: 'quick-world',
    ).loadVersions();
    expect(versions, hasLength(1));
    expect(versions.single.draft.characters.single.secret, 'PRIVATE_SECRET');
  });

  testWidgets('取消生成会忽略迟到的世界草案并保留原想法', (tester) async {
    final journal = MemoryJournal();
    final pending = Completer<PortalWorldDraft>();
    var cancelled = 0, started = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PortalWorldStudio(
            backendUrl: 'http://localhost',
            workspaceId: 'cancel-world',
            journal: journal,
            onStart: (_) async {
              started++;
            },
            onGenerateDraft: (_) => pending.future,
            onCancelGeneration: () => cancelled++,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '先保留这个想法');
    await tester.tap(find.text('生成并开始'));
    await tester.pump();
    await tester.tap(find.text('取消'));
    await tester.pump();
    pending.complete(completeDraft());
    await tester.pumpAndSettle();
    expect(cancelled, 1);
    expect(started, 0);
    final repository = PortalWorldRepository(
      journal: journal,
      backendUrl: 'http://localhost',
      workspaceId: 'cancel-world',
    );
    expect(await repository.loadVersions(), isEmpty);
    expect((await repository.loadDraft())?.seed, '先保留这个想法');
  });

  testWidgets('预设新开独立经历并可由 sessionId 恢复，不重复创建', (tester) async {
    final journal = MemoryJournal();
    final scope = experienceScope(
      'https://world.test',
      'workspace',
      'portal-demo',
      demoWorldPresets.first.id,
    );
    final opened = <String>[];
    Widget detail({String? resumeId}) => MaterialApp(
      home: Scaffold(
        body: SizedBox.expand(
          child: PortalWorldDetail(
            key: ValueKey(resumeId ?? 'new'),
            world: demoWorldPresets.first,
            onBack: () {},
            onStart: (_) => fail('离线脚本不得提交正式故事'),
            modelAvailable: false,
            selfScrolling: true,
            demoJournal: journal,
            demoScope: scope,
            autoResumeDemo: resumeId != null,
            resumeDemoSessionId: resumeId,
            onDemoOpened: opened.add,
          ),
        ),
      ),
    );
    await tester.pumpWidget(detail());
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('portal-world-start')),
    );
    await tester.tap(find.byKey(const ValueKey('portal-world-start')));
    await tester.pumpAndSettle();
    expect(opened, hasLength(1));
    final id = opened.single;
    final repository = PortalDemoRepository.fromSessionScope(
      journal: journal,
      scope: scope,
    );
    expect((await repository.entry(id))?.worldId, demoWorldPresets.first.id);
    await tester.pumpWidget(detail(resumeId: id));
    await tester.pumpAndSettle();
    expect(opened, [id, id]);
    expect(await repository.loadEntries(), hasLength(1));
  });
}
