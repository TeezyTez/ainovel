import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/reader_artifact_repository.dart';
import 'package:elselife_frontend/experience/reader_interaction_snapshot.dart';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import '../support/experience_fixture.dart';
import 'reader_artifact_repository_test.dart' as fixtures;

http.Response jsonResponse(Json value) => http.Response(
  jsonEncode(value),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
void main() {
  test('显式尝试引用先入journal再送input，响应未知只同ID同参数恢复', () async {
    final journal = MemoryJournal(), requests = <Json>[];
    var fail = true;
    final reference = {
      'definitionDigest': 'digest',
      'scope': {'branchId': 'branch'},
      'interactionId': 'd',
      'revision': 2,
      'actionId': 'ask',
      'targets': ['seller'],
      'params': {'question': '售价'},
    };
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final body = object(jsonDecode(request.body));
          requests.add(body);
          expect(
            (await journal.read(
              'contract',
            ))['pending']['body']['dynamic_attempt'],
            body['dynamic_attempt'],
          );
          if (fail) throw const FormatException('lost');
          return jsonResponse({
            ...fixtures.response(),
            'routing_scope': {
              'request_id': body['request_id'],
              'experience_id': 'story',
              'branch_id': 'branch',
              'base_revision': 3,
            },
            'input_decision': {'kind': 'attempt', 'message': ''},
          });
        }),
      ),
      journal: journal,
      scope: 'contract',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    expect(
      await repo.routeInput(
        '原尝试',
        '原草稿',
        phase: 'action',
        dynamicAttempt: reference,
      ),
      isNull,
    );
    reference['params'] = {'question': '后来修改'};
    fail = false;
    await repo.retry();
    expect(requests.length, 2);
    expect(requests.first, requests.last);
    expect(requests.last['dynamic_attempt']['params']['question'], '售价');
    expect(repo.inputDecisions['action']!['decision']['kind'], 'attempt');
    repo.dispose();
  });
  test('输入解释响应丢失同编号恢复，决定及下一操作编号在交给UI前持久化', () async {
    final journal = MemoryJournal(), requests = <Json>[];
    var lost = true;
    ReaderArtifactRepository make() => ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          if (request.method == 'GET') return jsonResponse(fixtures.response());
          final body = object(jsonDecode(request.body));
          requests.add(body);
          expect((await journal.read('route'))['pending'], isNotNull);
          if (lost) throw const FormatException('lost');
          return jsonResponse({
            ...fixtures.response(),
            'routing_scope': {
              'request_id': body['request_id'],
              'experience_id': 'story',
              'branch_id': 'branch',
              'base_revision': 3,
            },
            'intent_decision': {'kind': 'story', 'target': null, 'message': ''},
          });
        }),
      ),
      journal: journal,
      scope: 'route',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    var repo = make();
    expect(await repo.routeInput('买茶', '买茶', phase: 'ui'), isNull);
    repo.dispose();
    repo = make();
    await repo.load();
    lost = false;
    await repo.retry();
    final result = await repo.routeInput('买茶', '买茶', phase: 'ui');
    expect(requests.length, 2);
    expect(requests[0], requests[1]);
    expect(result!['decision']['kind'], 'story');
    expect((await journal.read('route'))['input_ui'], result);
    final op = result['operation_id'];
    repo.dispose();
    repo = make();
    await repo.load();
    expect(
      (await repo.routeInput('买茶', '买茶', phase: 'ui'))!['operation_id'],
      op,
    );
    expect(requests.length, 2);
    await repo.consumeInput('ui', result['request_id']);
    expect((await journal.read('route'))['input_ui']['consumed'], true);
    repo.dispose();
  });
  test('错范围或错execute计划拒绝并保留未知请求，不退回act', () async {
    final journal = MemoryJournal();
    final repo = ReaderArtifactRepository(
      client: PortalServiceClient(
        () => 'https://api.invalid',
        client: MockClient((request) async {
          final body = object(jsonDecode(request.body));
          return jsonResponse({
            ...fixtures.response(),
            'routing_scope': {
              'request_id': body['request_id'],
              'experience_id': 'story',
              'branch_id': 'other',
              'base_revision': 3,
            },
            'input_decision': {'kind': 'unrelated', 'message': ''},
          });
        }),
      ),
      journal: journal,
      scope: 'route',
      experienceId: 'story',
      branchId: 'branch',
      revision: 3,
      isCurrent: () => true,
    );
    expect(await repo.routeInput('买茶', '买茶', phase: 'action'), isNull);
    expect(repo.pending, isNotNull);
    expect(repo.error, contains('不属于'));
    expect(repo.inputDecisions, isEmpty);
    repo.dispose();
  });
  test('历史记录读取固定作品版本，拒绝后来的payload并保留冻结参数', () async {
    final snapshot = ReaderInteractionSnapshot({
      'origin_branch_id': 'branch',
      'artifact_id': 'a1',
      'revision_id': 'r1',
      'base_revision': 3,
      'state_revision': 4,
      'state': {
        'dynamic': {
          'params': {'route': 'old'},
        },
      },
    });
    var wrong = false;
    final client = PortalServiceClient(
      () => 'https://api.invalid',
      client: MockClient((request) async {
        expect(request.url.path, '/v1/experiences/story/artifacts/a1');
        expect(request.url.queryParameters['revision_id'], 'r1');
        return jsonResponse(
          fixtures.response(
            id: wrong ? 'r2' : 'r1',
            state: {
              'dynamic': {
                'params': {'route': 'new'},
              },
            },
          ),
        );
      }),
    );
    final value = await snapshot.read(client, 'story', 'branch');
    expect(value.revisionId, 'r1');
    expect(snapshot.state['dynamic']['params']['route'], 'old');
    wrong = true;
    expect(
      () => snapshot.read(client, 'story', 'branch'),
      throwsFormatException,
    );
    client.close();
  });
}
