import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_artifact_repository.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';

import '../support/experience_fixture.dart';

Json response({
  String id = 'r1',
  int stateRevision = 0,
  Json state = const {},
  int revision = 3,
}) => {
  'artifact': {
    'artifact_id': 'a1',
    'revision_id': id,
    'base_revision': revision,
    'state_revision': stateRevision,
    'state': state,
    'created_at': '2026-10-15',
    'stale': false,
    'payload': {
      'schemaVersion': 1,
      'definition': null,
      'state': {'version': revision},
      'scope': {
        'worldKey': 'story',
        'sessionId': 'story',
        'branchId': 'branch',
        'baseVersion': revision,
      },
      'reason': '公开记录',
      'definitionDigest': '',
      'capabilities': {'attempt': true, 'deterministic': false},
    },
  },
  'revisions': [
    {
      'revision_id': 'r1',
      'base_revision': 3,
      'created_at': '2026-10-15',
      'title': '先前作品',
    },
    {
      'revision_id': 'r2',
      'base_revision': 3,
      'created_at': '2026-10-15',
      'title': '当前作品',
    },
  ],
};

void main() {
  test('自动准备落盘期间阻塞，发送中和回应丢失后不阻塞故事且保留原请求', () async {
    final journal = MemoryJournal()..gate = Completer<void>();
    final started = Completer<void>();
    final reply = Completer<http.Response>();
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          started.complete();
          return reply.future;
        }),
      ),
      journal: journal,
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    addTearDown(repo.dispose);
    expect(repo.blocksStoryInput, isFalse);
    final preparing = repo.prepare('', retry: false);
    expect(repo.busy, isTrue);
    expect(repo.pending, isNull);
    expect(repo.blocksStoryInput, isTrue);
    expect(started.isCompleted, isFalse);
    journal.gate!.complete();
    await started.future;
    final pending = jsonDecode(jsonEncode(repo.pending));
    final requestId = object(repo.pending!['body'])['request_id'];
    expect(requestId, isNotEmpty);
    expect(repo.busy, isTrue);
    expect(repo.blocksStoryInput, isFalse);
    expect((await journal.read('scope'))['pending'], pending);
    reply.completeError(const FormatException('response lost'));
    await preparing;
    expect(repo.busy, isFalse);
    expect(repo.error, contains('response lost'));
    expect(repo.blocksStoryInput, isFalse);
    expect(repo.pending, pending);
    expect(object(repo.pending!['body'])['request_id'], requestId);
    expect((await journal.read('scope'))['pending'], pending);
  });

  test('旧日志的自动准备重载后不阻塞故事且不清除或重发原请求', () async {
    final pending = <String, dynamic>{
      'path': '/v1/experiences/story/artifacts/prepare',
      'body': {
        'request_id': 'existing-auto-request',
        'branch_id': 'branch',
        'expected_revision': 3,
        'retry': false,
      },
    };
    final journal = MemoryJournal()..rows['scope'] = {'pending': pending};
    final methods = <String>[];
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          methods.add(request.method);
          return http.Response('{"artifact":null,"revisions":[]}', 200);
        }),
      ),
      journal: journal,
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    addTearDown(repo.dispose);
    final loading = repo.prepareAutomatically();
    expect(repo.busy, isTrue);
    expect(repo.pending, isNull);
    expect(repo.blocksStoryInput, isTrue);
    await loading;
    expect(repo.error, isNull);
    expect(repo.blocksStoryInput, isFalse);
    expect(repo.pending, pending);
    expect((await journal.read('scope'))['pending'], pending);
    expect(methods, ['GET']);
  });

  test('重载自动请求时当前作品尚未读完仍保护输入语义', () async {
    final journal = MemoryJournal()
      ..rows['scope'] = {
        'pending': {
          'path': '/v1/experiences/story/artifacts/prepare',
          'body': {
            'request_id': 'old-auto',
            'branch_id': 'branch',
            'expected_revision': 3,
            'retry': false,
          },
        },
      };
    final started = Completer<void>(), reply = Completer<http.Response>();
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          started.complete();
          return reply.future;
        }),
      ),
      journal: journal,
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    addTearDown(repo.dispose);
    final loading = repo.load();
    await started.future;
    expect(repo.pending, isNotNull);
    expect(repo.busy, isTrue);
    final blockedWhileLoading = repo.blocksStoryInput;
    reply.complete(
      http.Response(
        jsonEncode(response()),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      ),
    );
    await loading;
    expect(blockedWhileLoading, isTrue, reason: '在当前作品是否存在尚未确认前，不能绕过自由输入语义路由');
    expect(repo.blocksStoryInput, isFalse);
    expect(repo.artifact, isNotNull);
  });

  for (final operation in ['生成界面', '界面输入解释', '行动输入解释', '参数保存']) {
    test('$operation在途或回应丢失后仍阻塞故事', () async {
      final journal = MemoryJournal();
      final started = Completer<void>();
      final reply = Completer<http.Response>();
      final repo = ReaderArtifactRepository(
        client: PortalServiceClient(
          () => 'https://api.invalid',
          client: MockClient((request) async {
            if (request.method == 'GET') {
              return http.Response(
                jsonEncode(response()),
                200,
                headers: {'content-type': 'application/json; charset=utf-8'},
              );
            }
            started.complete();
            return reply.future;
          }),
        ),
        journal: journal,
        scope: 'scope',
        experienceId: 'story',
        branchId: 'branch',
        revision: 3,
        isCurrent: () => true,
      );
      addTearDown(repo.dispose);
      await repo.load();
      final Future<dynamic> request;
      switch (operation) {
        case '生成界面':
          request = repo.prepare('');
        case '界面输入解释':
          request = repo.routeInput('整理路线', '草稿', phase: 'ui');
        case '行动输入解释':
          request = repo.routeInput('走向村口', '草稿', phase: 'action');
        default:
          request = repo.saveState({'step': 1});
      }
      await started.future;
      final pending = jsonDecode(jsonEncode(repo.pending));
      expect(repo.busy, isTrue);
      expect(repo.blocksStoryInput, isTrue);
      reply.completeError(const FormatException('response lost'));
      await request;
      expect(repo.busy, isFalse);
      expect(repo.error, contains('response lost'));
      expect(repo.blocksStoryInput, isTrue);
      expect(repo.pending, pending);
      expect((await journal.read('scope'))['pending'], pending);
    });
  }

  test('只有本故事分支版本的无用户意图自动prepare可以放行', () {
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((_) async => throw StateError('unexpected request')),
      ),
      journal: MemoryJournal(),
      scope: 'scope',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    addTearDown(repo.dispose);
    Json automatic() => {
      'path': '${repo.path}/prepare',
      'body': <String, dynamic>{
        'request_id': 'auto-request',
        'branch_id': 'branch',
        'expected_revision': 3,
        'retry': false,
      },
    };
    final cases = <String, Json>{
      '另一故事': automatic()..['path'] = '/v1/experiences/other/artifacts/prepare',
      '另一分支': automatic()..['body']['branch_id'] = 'other',
      '另一版本': automatic()..['body']['expected_revision'] = 2,
      '仅路径前缀相同': automatic()..['path'] = '${repo.path}/prepare/other',
      '用户输入解释': automatic()..['body']['input_routing'] = true,
      '用户意图': automatic()..['body']['intent'] = '整理路线',
      '非文本意图': automatic()..['body']['intent'] = 7,
      '明确重试生成': automatic()..['body']['retry'] = true,
      '未标记自动生成': automatic()..['body'].remove('retry'),
      '有输入元数据': automatic()..['input_metadata'] = {'phase': 'ui'},
      '空输入元数据键': automatic()..['input_metadata'] = null,
      '作品参数保存': automatic()..['path'] = '${repo.path}/a1/state',
      '作品导入': automatic()..['path'] = '${repo.path}/import',
      '作品恢复': automatic()..['path'] = '${repo.path}/a1/restore',
      '无效请求体': automatic()..['body'] = null,
    };
    for (final entry in cases.entries) {
      repo.pending = entry.value;
      for (final busy in [false, true]) {
        repo.busy = busy;
        expect(
          repo.blocksStoryInput,
          isTrue,
          reason: '${entry.key}, busy=$busy',
        );
      }
    }
    for (final intent in [null, '', '   ']) {
      repo.pending = automatic()
        ..['body']['intent'] = intent
        ..['body']['input_routing'] = false;
      for (final busy in [false, true]) {
        repo.busy = busy;
        expect(repo.blocksStoryInput, isFalse);
      }
    }
  });

  test('本轮没有展示提案时不把正式游戏资料当作新作品', () {
    final data = object(response()['artifact']);
    final payload = object(data['payload']);
    payload['state'] = {
      'version': 3,
      'game': {
        'surfaces': [
          {'id': 'prior-table'},
        ],
      },
    };
    payload['sourceGame'] = {'surfaces': <Json>[]};
    data['payload'] = payload;
    final artifact = PreparedReaderArtifact(data);
    expect(artifact.hasPresentation, isFalse);
    expect(object(object(artifact.payload['state'])['game'])['surfaces'], [
      {'id': 'prior-table'},
    ]);
  });

  test('显式展示提案与旧格式作品仍可展示', () {
    final data = object(response()['artifact']);
    final payload = object(data['payload']);
    payload['sourceGame'] = {
      'surfaces': [
        {'id': 'current-table'},
      ],
    };
    payload['state'] = {
      'version': 3,
      'game': {
        'surfaces': [
          {'id': 'current-table'},
        ],
      },
    };
    data['payload'] = payload;
    expect(PreparedReaderArtifact(data).hasPresentation, isTrue);
    payload['sourceGame'] = null;
    payload['definition'] = {'id': 'current-interaction'};
    expect(PreparedReaderArtifact(data).hasPresentation, isTrue);
    payload.remove('sourceGame');
    payload['definition'] = null;
    payload['state'] = {
      'version': 3,
      'game': {
        'spatial': {
          'sites': [
            {'id': 'legacy-map'},
          ],
        },
      },
    };
    expect(PreparedReaderArtifact(data).hasPresentation, isTrue);
  });

  test('只有游戏提案但当前公开状态无可展示内容时不打开空作品', () {
    final data = object(response()['artifact']);
    data['payload']['sourceGame'] = {
      'surfaces': [
        {'id': 'proposed-only'},
      ],
    };
    expect(PreparedReaderArtifact(data).hasPresentation, isFalse);
  });

  test('准备请求先落盘，响应丢失后新实例以原请求编号和原参数恢复', () async {
    final journal = MemoryJournal();
    final requests = <Json>[];
    var fail = true;
    ReaderArtifactRepository make() => ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'GET')
            return http.Response(
              jsonEncode(response()),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          final body = object(jsonDecode(request.body));
          requests.add(body);
          expect((await journal.read('scope'))['pending'], isNotNull);
          if (fail) throw const FormatException('response lost');
          return http.Response(
            jsonEncode(response()),
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
      isCurrent: () => true,
    );
    var repo = make();
    await repo.prepare('整理原路线');
    expect(repo.pending, isNotNull);
    repo.dispose();
    repo = make();
    await repo.load();
    fail = false;
    await repo.retry();
    expect(requests, hasLength(2));
    expect(requests.first, requests.last);
    expect(requests.first['expected_revision'], 3);
    expect(requests.first['branch_id'], 'branch');
    expect(repo.error, isNull);
    expect(repo.pending, isNull);
    expect((await journal.read('scope'))['pending'], isNull);
    repo.dispose();
  });
  test('局部参数使用作品state CAS，历史读取不可写，恢复使用真实head', () async {
    final writes = <Json>[];
    var current = true;
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'POST') {
            final body = object(jsonDecode(request.body));
            writes.add(body);
            return http.Response(
              jsonEncode(
                response(id: 'r2', stateRevision: 8, state: {'step': 1}),
              ),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          return http.Response(
            jsonEncode(
              response(
                id: request.url.queryParameters['revision_id'] ?? 'r2',
                stateRevision: 7,
              ),
            ),
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
      isCurrent: () => current,
    );
    await repo.load();
    expect(repo.error, isNull);
    await repo.saveState({'step': 1});
    expect(writes.single['expected_state_revision'], 7);
    expect(writes.single['state'], {'step': 1});
    await repo.load(revisionId: 'r1');
    expect(repo.writable, isFalse);
    await expectLater(repo.saveState({}), throwsStateError);
    await repo.restore('r1');
    expect(writes.last['expected_head'], 'r2');
    expect(writes.last['expected_state_revision'], 8);
    current = false;
    await expectLater(repo.prepare('新作品'), throwsStateError);
    repo.dispose();
  });
  test('journal不可写时绝不发送准备请求，错误归属的待确认请求不能重发', () async {
    final journal = MemoryJournal()..failWrite = true;
    var sent = 0;
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          sent++;
          return http.Response(
            jsonEncode(response()),
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
      isCurrent: () => true,
    );
    await expectLater(repo.prepare('路线'), throwsA(anything));
    expect(sent, 0);
    repo.pending = {
      'path': '/v1/experiences/another/artifacts/prepare',
      'body': {'branch_id': 'branch', 'expected_revision': 3},
    };
    await expectLater(repo.retry(), throwsFormatException);
    expect(sent, 0);
    repo.dispose();
  });

  test('自动准备每个revision只一次，none是正常静默结果，错分支回应拒绝', () async {
    final journal = MemoryJournal();
    var posts = 0;
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'GET')
            return http.Response('{"artifact":null,"revisions":[]}', 200);
          posts++;
          final body = object(jsonDecode(request.body));
          expect(body['retry'], false);
          final data = response();
          return http.Response(
            jsonEncode(data),
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
      isCurrent: () => true,
    );
    await repo.prepareAutomatically();
    expect(posts, 1);
    expect(repo.error, isNull);
    expect(repo.artifact!.hasPresentation, isFalse);
    await repo.prepareAutomatically();
    expect(posts, 1);
    repo.dispose();
    final bad = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final data = response();
          (data['artifact']['payload']['scope'] as Map)['branchId'] = 'other';
          return http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      ),
      journal: MemoryJournal(),
      scope: 'other',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    await bad.load();
    expect(bad.artifact, isNull);
    expect(bad.error, contains('归属不符'));
    bad.dispose();
  });
}
