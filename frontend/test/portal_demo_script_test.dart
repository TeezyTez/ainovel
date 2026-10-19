import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_demo_script.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';

class _MemoryJournal implements ExperienceJournal {
  final records = <String, Map<String, dynamic>>{};

  @override
  Future<Map<String, dynamic>> read(String scope) async =>
      Map<String, dynamic>.from(records[scope] ?? {});

  @override
  Future<void> patch(String scope, Map<String, dynamic> values) async {
    records[scope] = {...?records[scope], ...values};
  }
}

void main() {
  test('只有原版三个世界有八回合预设脚本，自建与茶铺不套用', () {
    for (final id in ['fog-harbor', 'mountain', 'thursday']) {
      expect(PortalDemoScript.supports(id), isTrue);
      var state = const PortalDemoState();
      for (var step = 0; step < 8; step++) {
        expect(PortalDemoScript.actions(id, state), isNotEmpty);
        state = PortalDemoScript.choose(id, state, 'continue');
      }
      expect(state.ended, isTrue);
      expect(state.turns, hasLength(8));
      expect(PortalDemoScript.actions(id, state), isEmpty);
    }
    expect(PortalDemoScript.supports('truth-teahouse'), isFalse);
    expect(PortalDemoScript.supports('world-custom'), isFalse);
  });

  test('雾港的早期选择影响后续回应，但不泄漏作者秘密', () {
    var state = const PortalDemoState();
    state = PortalDemoScript.choose('fog-harbor', state, 'ask-register');
    expect(state.flags['fog-harbor:approach'], 'respect');
    state = PortalDemoScript.choose('fog-harbor', state, 'continue');
    state = PortalDemoScript.choose('fog-harbor', state, 'trace-record');
    expect(state.flags['fog-harbor:method'], 'record');
    state = PortalDemoScript.choose('fog-harbor', state, 'revisit-lin');
    expect(state.turns.last.prose, contains('你先问了规矩'));
    state = PortalDemoScript.choose('fog-harbor', state, 'continue');
    state = PortalDemoScript.choose('fog-harbor', state, 'receive-result');
    expect(state.turns.last.prose, contains('七年前'));
    expect(state.turns.map((t) => t.prose).join(), isNot(contains('父亲曾在补发电报')));
  });

  test('无效动作不推进本机演示', () {
    expect(
      () => PortalDemoScript.choose(
        'fog-harbor',
        const PortalDemoState(),
        'any-free-input',
      ),
      throwsFormatException,
    );
  });

  testWidgets('本机预设演示可回读，不进入正式服务', (tester) async {
    final journal = _MemoryJournal();
    final scope = experienceScope(
      'https://world.test',
      'workspace',
      'portal-demo',
      'fog-harbor',
    );
    final repository = PortalDemoRepository.fromSessionScope(
      journal: journal,
      scope: scope,
    );
    Widget page() => MaterialApp(
      home: PortalDemoScriptPage(
        worldId: 'fog-harbor',
        title: '雾港来信',
        opening: '原版预设开场',
        journal: journal,
        scope: scope,
      ),
    );
    await tester.pumpWidget(page());
    await tester.pumpAndSettle();
    expect(find.text('原版预设开场'), findsOneWidget);
    await tester.tap(find.text('让场景继续'));
    await tester.pumpAndSettle();
    expect((await repository.entry('fog-harbor'))?.step, 1);
    expect((await repository.loadEntries()).single.worldId, 'fog-harbor');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(page());
    await tester.pumpAndSettle();
    expect(find.textContaining('第 2 / 8 个片刻'), findsOneWidget);
  });

  test('共享索引可整理、恢复并永久删除本机预设演示', () async {
    final journal = _MemoryJournal();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://world.test',
      workspaceId: 'workspace',
    );
    await repository.ensure('fog-harbor');
    await repository.saveState('fog-harbor', {
      'step': 1,
      'flags': <String, String>{},
      'facts': <String>[],
      'turns': [const PortalDemoTurn(input: '继续', prose: '第一幕').toJson()],
    });
    await repository.updatePersonal('fog-harbor', {
      'display_name': '我命名的雾港',
      'note': '稍后继续',
      'pinned': true,
    });
    expect((await repository.loadEntries()).single.title, '我命名的雾港');
    expect((await repository.entry('fog-harbor'))?.latestProse, '第一幕');
    await repository.trashAll();
    expect((await repository.entry('fog-harbor'))?.trashedAt, isNotNull);
    await repository.updatePersonal('fog-harbor', {'trashed_at': null});
    expect((await repository.entry('fog-harbor'))?.trashedAt, isNull);
    await repository.removePermanently('fog-harbor');
    expect(await repository.loadEntries(), isEmpty);
    await repository.ensure('fog-harbor');
    expect((await repository.entry('fog-harbor'))?.step, 0);
  });

  test('同一预设每次新开独立经历，旧进度和整理状态均保留', () async {
    final journal = _MemoryJournal();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://world.test',
      workspaceId: 'workspace',
    );
    final first = await repository.create('fog-harbor');
    final second = await repository.create('fog-harbor');
    expect(first.id, isNot(second.id));
    await repository.saveState(first.id, {
      'step': 1,
      'flags': <String, String>{},
      'facts': <String>[],
      'turns': [const PortalDemoTurn(input: '继续', prose: '第一段经历').toJson()],
    });
    await repository.updatePersonal(first.id, {
      'display_name': '第一次雾港',
      'trashed_at': DateTime.now().millisecondsSinceEpoch,
    });
    expect((await repository.entry(first.id))?.step, 1);
    expect((await repository.entry(second.id))?.step, 0);
    expect((await repository.entry(second.id))?.trashedAt, isNull);
    expect((await repository.loadEntries()), hasLength(2));
    await repository.removePermanently(first.id);
    expect((await repository.loadEntries()).single.id, second.id);
  });

  test('旧 Flutter 世界索引会保留，并可在同一预设旁新建经历', () async {
    final journal = _MemoryJournal();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://world.test',
      workspaceId: 'workspace',
    );
    await journal.patch(repository.sessionScope('mountain'), {
      'worldId': 'mountain',
      'session': const PortalDemoState().toJson(),
    });
    final restored = await repository.loadEntries();
    expect(restored.single.id, 'mountain');
    final next = await repository.create('mountain');
    expect(next.id, isNot('mountain'));
    expect((await repository.loadEntries()), hasLength(2));
  });

  testWidgets('无效范围只显示开场，不崩溃也不推进', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PortalDemoScriptPage(
          worldId: 'fog-harbor',
          title: '雾港来信',
          opening: '原版开场',
          journal: _MemoryJournal(),
          scope: 'invalid',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('原版开场'), findsOneWidget);
    expect(find.textContaining('范围无效'), findsOneWidget);
    expect(find.text('让场景继续'), findsNothing);
  });
}
