import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_artifact_repository.dart';
import 'package:elselife_frontend/experience/reader_artifact_surface.dart';
import 'package:elselife_frontend/experience/reader_prepared_workbench.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import '../support/experience_fixture.dart';
import 'reader_artifact_repository_test.dart' show response;

void main() {
  testWidgets('JSONB键顺序变化不重复保存，数组顺序变化仍保存', (tester) async {
    // Transport fixture reproduces PostgreSQL JSONB's object-key reordering;
    // it does not assess generated content or narrative quality.
    dynamic reordered(dynamic value) {
      if (value is Map) {
        return {
          for (final entry in value.entries.toList().reversed)
            entry.key: reordered(entry.value),
        };
      }
      if (value is List) return value.map(reordered).toList();
      return value;
    }

    final journal = MemoryJournal();
    var writes = 0, allowedWrites = 1;
    Json state = {};
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') {
            writes++;
            // Bound a regression so a broken flush loop fails, not hangs.
            if (writes > allowedWrites) {
              return http.Response('Unexpected repeated state write', 503);
            }
            state = object(
              reordered(object(jsonDecode(request.body))['state']),
            );
          }
          return http.Response(
            jsonEncode(response(state: state, stateRevision: writes)),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      ),
      journal: journal,
      scope: 'jsonb-state',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            onAttempt: (_) async {},
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    addTearDown(() => tester.pumpWidget(const SizedBox()));
    await tester.pumpAndSettle();
    ReaderArtifactSurface surface() =>
        tester.widget(find.byType(ReaderArtifactSurface));
    final edited = <String, dynamic>{
      'dynamic': {
        'params': {'sort': 'pages', 'direction': 'asc'},
        'step': 0,
      },
      'artifacts': {
        'selection': [
          {'id': 'tide', 'price': 20},
          {'id': 'lamp', 'price': 25},
        ],
      },
    };
    surface().onMessage('advanced-state', edited);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(
      writes,
      1,
      reason: 'A semantically identical JSONB reply must end the flush',
    );
    expect(repo.pending, isNull);
    expect((await journal.read('jsonb-state'))['artifact_ui'], isNull);

    // Renderer initialization may echo the same value in another key order.
    surface().onMessage('advanced-state', reordered(edited));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(writes, 1);

    allowedWrites = 2;
    final changed = object(jsonDecode(jsonEncode(edited)));
    changed['artifacts']['selection'] =
        (changed['artifacts']['selection'] as List).reversed.toList();
    surface().onMessage('advanced-state', changed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(writes, 2);
    expect(state['artifacts']['selection'][0]['id'], 'lamp');
    expect(repo.pending, isNull);
  });

  for (final embedded in [true, false]) {
    for (final versionCount in [1, 2]) {
      testWidgets('显示内容而非作品版本管理 embedded=$embedded versions=$versionCount', (
        tester,
      ) async {
        final data = response();
        data['revisions'] = (data['revisions'] as List)
            .take(versionCount)
            .toList();
        data['artifact']['payload']['definition'] = {
          'id': 'content',
          'title': '水轮与磨盘',
          'scope': data['artifact']['payload']['scope'],
        };
        final repo = ReaderArtifactRepository(
          client: PortalServiceClient(
            () => 'https://api.invalid',
            client: MockClient(
              (_) async => http.Response(
                jsonEncode(data),
                200,
                headers: {'content-type': 'application/json'},
              ),
            ),
          ),
          journal: MemoryJournal(),
          scope: 'content-$embedded-$versionCount',
          experienceId: 'story',
          branchId: 'branch',
          revision: 3,
          isCurrent: () => true,
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ReaderPreparedWorkbench(
                repository: repo,
                embedded: embedded,
                onAttempt: (_) async {},
                onDraft: (_) {},
                onEvidence: () {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('查看作品版本'), findsNothing);
        expect(find.byType(DropdownButtonFormField<String>), findsNothing);
        final surface = tester.widget<ReaderArtifactSurface>(
          find.byType(ReaderArtifactSurface),
        );
        expect(surface.data['payload']['definition']['title'], '水轮与磨盘');
        expect(surface.data['readonly'], isFalse);
        await tester.pumpWidget(const SizedBox());
      });
    }
  }

  testWidgets('当前回合主动选择旧作品版本仍显示只读历史', (tester) async {
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient(
          (request) async => http.Response(
            jsonEncode(
              response(id: request.url.queryParameters['revision_id'] ?? 'r2'),
            ),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
      journal: MemoryJournal(),
      scope: 'current-history',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await repo.load();
    await repo.load(revisionId: 'r1');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            initializeRepository: false,
            onAttempt: (_) async {},
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final surface = tester.widget<ReaderArtifactSurface>(
      find.byType(ReaderArtifactSurface),
    );
    expect(surface.data['revisionId'], 'r1');
    expect(surface.data['readonly'], isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('旧回合作品不嵌入当前正文，失败恢复与手动历史仍可访问', (tester) async {
    final data = response();
    data['artifact']['stale'] = true;
    data['artifact']['payload']['definition'] = {
      'id': 'old-table',
      'scope': data['artifact']['payload']['scope'],
    };
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
      journal: MemoryJournal(),
      scope: 'stale',
      experienceId: 'story',
      branchId: 'branch',
      revision: 4,
      isCurrent: () => true,
    );
    await repo.load();
    repo.error = '本轮整理尚待确认';
    repo.pending = {'path': '/prepare'};
    Widget workbench(bool embedded) => MaterialApp(
      home: Scaffold(
        body: ReaderPreparedWorkbench(
          key: ValueKey(embedded),
          repository: repo,
          embedded: embedded,
          ownsRepository: false,
          initializeRepository: false,
          onAttempt: (_) async {},
          onDraft: (_) {},
          onEvidence: () {},
        ),
      ),
    );
    await tester.pumpWidget(workbench(true));
    await tester.pumpAndSettle();
    expect(find.byType(ReaderArtifactSurface), findsNothing);
    expect(find.text('恢复作品请求'), findsOneWidget);
    expect(find.text('本轮整理尚待确认'), findsOneWidget);
    expect(find.text('查看作品版本'), findsNothing);
    expect(find.text('读取当前版本'), findsNothing);
    expect(find.text('查看已提交的作品依据'), findsNothing);
    expect(find.textContaining('生成可查看与试填的作品'), findsNothing);
    await tester.pumpWidget(workbench(false));
    await tester.pumpAndSettle();
    final surface = tester.widget<ReaderArtifactSurface>(
      find.byType(ReaderArtifactSurface),
    );
    expect(surface.data['readonly'], isTrue);
    await tester.pumpWidget(const SizedBox());
    repo.dispose();
  });

  testWidgets('dynamic尝试保留原引用与参数交正式校验，不能只转自由草稿', (tester) async {
    Json? received;
    final scope = {
      'worldKey': 'story',
      'sessionId': 'story',
      'branchId': 'branch',
      'baseVersion': 3,
    };
    final data = response();
    data['artifact']['payload']['definitionDigest'] = 'digest';
    data['artifact']['payload']['definition'] = {
      'id': 'd',
      'revision': 2,
      'scope': scope,
      'actions': [
        {
          'id': 'ask',
          'mode': 'attempt',
          'targets': ['seller'],
        },
      ],
    };
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
      journal: MemoryJournal(),
      scope: 'contract',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            onAttempt: (_) async {
              fail('不得略过正式尝试验证');
            },
            onContractAttempt: (request) async {
              received = request;
            },
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    tester
        .widget<ReaderArtifactSurface>(find.byType(ReaderArtifactSurface))
        .onMessage('advanced-attempt', {
          'kind': 'dynamic',
          'mode': 'attempt',
          'branchId': 'branch',
          'version': 3,
          'input': '我尝试询问售价',
          'interactionId': 'd',
          'actionId': 'ask',
          'definitionDigest': 'digest',
          'targets': ['seller'],
          'params': {'question': '售价'},
        });
    await tester.pumpAndSettle();
    expect(received!['input'], '我尝试询问售价');
    expect(received!['dynamic_attempt'], {
      'definitionDigest': 'digest',
      'scope': scope,
      'interactionId': 'd',
      'revision': 2,
      'actionId': 'ask',
      'targets': ['seller'],
      'params': {'question': '售价'},
    });
  });
  testWidgets('原版查看全部人物和目标导航保留种类与当前版本', (tester) async {
    final destinations = <Json>[];
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode(response()),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
      journal: MemoryJournal(),
      scope: 'nav',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            onAttempt: (_) async {},
            onNavigate: (kind, data) async {
              destinations.add({'kind': kind, ...data});
            },
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final surface = tester.widget<ReaderArtifactSurface>(
      find.byType(ReaderArtifactSurface),
    );
    surface.onMessage('advanced-inspect', 'interaction');
    await tester.pumpAndSettle();
    surface.onMessage('advanced-inspect', 'objectives');
    await tester.pumpAndSettle();
    expect(destinations, [
      {'kind': 'interaction', 'revision': 3},
      {'kind': 'objectives', 'revision': 3},
    ]);
  });
  testWidgets('忙碌时仅保留局部展示输入，恢复可写后才保存正式stateCAS', (tester) async {
    final journal = MemoryJournal();
    var writes = 0;
    Json state = {};
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') {
            writes++;
            state = object(object(jsonDecode(request.body))['state']);
          }
          return http.Response(
            jsonEncode(response(state: state, stateRevision: writes)),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      ),
      journal: journal,
      scope: 'busy-local',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            onAttempt: (_) async {},
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    repo.busy = true;
    tester
        .widget<ReaderArtifactSurface>(find.byType(ReaderArtifactSurface))
        .onMessage('advanced-state', {
          'dynamic': {
            'params': {'question': '忙时输入'},
          },
        });
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(writes, 0);
    expect(
      (await journal.read(
        'busy-local',
      ))['artifact_ui']['state']['dynamic']['params']['question'],
      '忙时输入',
    );
    repo.busy = false;
    unawaited(repo.load());
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(writes, 1);
    expect(state['dynamic']['params']['question'], '忙时输入');
    expect((await journal.read('busy-local'))['artifact_ui'], isNull);
  });
  testWidgets('正式规则桥校验能力和版本，保存局部参数后仅发送原始引用', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final events = <String>[], commands = <Json>[];
    var stateRevision = 0;
    Json state = {};
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') {
            events.add('save');
            state = object(object(jsonDecode(request.body))['state']);
            stateRevision++;
          }
          final data = response(state: state, stateRevision: stateRevision);
          object(data['artifact']);
          (data['artifact']['payload']['capabilities']
                  as Map)['deterministic'] =
              true;
          return http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      ),
      journal: MemoryJournal(),
      scope: 'execute',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            embedded: true,
            onAttempt: (_) async {
              fail('规则不得降级为自由输入');
            },
            onExecute: (id, command) async {
              expectSync(id, 'a1');
              events.add('execute');
              commands.add(command);
            },
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    ReaderArtifactSurface surface() =>
        tester.widget(find.byType(ReaderArtifactSurface));
    Json action() => {
      'kind': 'game',
      'branchId': 'branch',
      'version': 3,
      'definitionDigest': '',
      'params': <String, dynamic>{},
      'reference': {
        'branchId': 'branch',
        'version': 3,
        'surfaceId': 'market',
        'actionId': 'buy',
      },
    };
    final wrong = action();
    wrong['branchId'] = 'other';
    surface().onMessage('advanced-execute', wrong);
    await tester.pumpAndSettle();
    expect(commands, isEmpty);
    repo.artifact!.payload['capabilities']['deterministic'] = false;
    surface().onMessage('advanced-execute', action());
    await tester.pumpAndSettle();
    expect(commands, isEmpty);
    repo.artifact!.payload['capabilities']['deterministic'] = true;
    surface().onMessage('advanced-state', {
      'dynamic': {
        'params': {'amount': 2},
      },
    });
    await tester.pump();
    surface().onMessage('advanced-execute', action());
    await tester.pumpAndSettle();
    expect(
      events,
      ['save', 'execute'],
      reason: tester
          .widgetList<Text>(find.byType(Text))
          .map((widget) => widget.data)
          .join(' / '),
    );
    expect(commands.single, {
      'revision_id': 'r1',
      'definition_digest': '',
      'kind': 'game',
      'reference': {
        'branchId': 'branch',
        'version': 3,
        'surfaceId': 'market',
        'actionId': 'buy',
      },
      'params': <String, dynamic>{},
    });
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('原交互桥保存参数后才提交明确attempt，历史与错误归属不发送', (tester) async {
    final journal = MemoryJournal(),
        events = <String>[],
        submitted = <String>[];
    var current = true, stateRevision = 0;
    Json state = {};
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') {
            events.add('state');
            state = object(object(jsonDecode(request.body))['state']);
            stateRevision++;
          }
          return http.Response(
            jsonEncode(response(state: state, stateRevision: stateRevision)),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      ),
      journal: journal,
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => current,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            onAttempt: (input) async {
              events.add('act');
              submitted.add(input);
            },
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    ReaderArtifactSurface surface() =>
        tester.widget(find.byType(ReaderArtifactSurface));
    surface().onMessage('advanced-attempt', {
      'kind': 'game',
      'mode': 'rule',
      'branchId': 'branch',
      'version': 3,
      'input': '本地扣钱',
      'actionId': 'buy',
    });
    await tester.pumpAndSettle();
    expect(submitted, isEmpty);
    current = false;
    surface().onMessage('advanced-attempt', {
      'kind': 'game',
      'mode': 'attempt',
      'branchId': 'branch',
      'version': 3,
      'input': '过期动作',
      'actionId': 'old',
    });
    await tester.pumpAndSettle();
    expect(submitted, isEmpty);
    current = true;
    surface().onMessage('advanced-state', {
      'dynamic': {
        'params': {'amount': 2},
        'step': 0,
        'closed': false,
      },
    });
    await tester.pump();
    surface().onMessage('advanced-attempt', {
      'kind': 'game',
      'mode': 'attempt',
      'branchId': 'branch',
      'version': 3,
      'input': '我尝试借用雨伞',
      'actionId': 'borrow',
    });
    await tester.pumpAndSettle();
    expect(events, ['state', 'act']);
    expect(submitted, ['我尝试借用雨伞']);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('导入先审阅确认，只提交定义和局部状态不接收导入的权威世界', (tester) async {
    final posted = <Json>[];
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST')
            posted.add(object(jsonDecode(request.body)));
          return http.Response(
            jsonEncode(response()),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      ),
      journal: MemoryJournal(),
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReaderPreparedWorkbench(
            repository: repo,
            onAttempt: (_) async {},
            onDraft: (_) {},
            onEvidence: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final surface = tester.widget<ReaderArtifactSurface>(
      find.byType(ReaderArtifactSurface),
    );
    surface.onMessage('import', {
      'payload': {
        'definition': {'title': '路线图'},
        'state': {'money': 99999},
      },
      'state': {'selected': 'harbor'},
    });
    await tester.pumpAndSettle();
    expect(posted, isEmpty);
    await tester.tap(find.text('验证并导入'));
    await tester.pumpAndSettle();
    expect(posted.single['definition'], {'title': '路线图'});
    expect(posted.single['state'], {'selected': 'harbor'});
    expect(posted.single.containsKey('payload'), isFalse);
    expect(jsonEncode(posted), isNot(contains('99999')));
    await tester.pumpWidget(const SizedBox());
  });
}
