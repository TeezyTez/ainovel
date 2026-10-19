import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import '../support/experience_fixture.dart';

Json action() => {
  'revision_id': 'artifact-version',
  'definition_digest': 'digest',
  'kind': 'dynamic',
  'reference': {
    'interactionId': 'definition',
    'revision': 1,
    'actionId': 'pay',
    'targets': ['money'],
    'scope': {
      'sessionId': 'experience-a',
      'branchId': 'main',
      'baseVersion': 1,
    },
  },
  'params': {'amount': 2},
};

void main() {
  test('正式规则执行先持久化，未知期间阻止下一act，重启恢复使用原操作账本且保留自由草稿', () async {
    final journal = MemoryJournal(), api = _ExecuteApi()..timeout = true;
    var c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    await c.open('experience-a');
    await c.saveDraft('未发送的自由想法');
    api.onExecute = () async {
      expect((await journal.read(c.scope))['attempt']['kind'], 'artifact');
    };
    final input = action();
    await c.executeArtifact(
      'artifact-id',
      input,
      requestId: 'interpreted-operation',
    );
    expect(c.unknown, isTrue);
    expect(c.blocked, isTrue);
    expect(api.executed, hasLength(1));
    await c.send();
    expect(api.sent, isEmpty);
    input['params']['amount'] = 999;
    final original = api.executed.single;
    expect(original['request_id'], 'interpreted-operation');
    c.dispose();
    c.session.dispose();
    c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    api.missing = true;
    await c.recover();
    expect(c.notReceived, isTrue);
    api.timeout = false;
    await c.resendSameRequest();
    expect(api.executed, hasLength(2));
    expect(api.executed.last, original);
    expect(api.executed.last['params']['amount'], 2);
    expect(c.draft, '未发送的自由想法');
    expect(c.unknown, isFalse);
    c.dispose();
    c.session.dispose();
  });
  test('恢复已提交规则操作只读GET，不重发execute也不清空后写的草稿', () async {
    final api = _ExecuteApi()..timeout = true;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    await c.initialize();
    await c.open('experience-a');
    await c.saveDraft('原草稿');
    await c.executeArtifact('a', action());
    await c.saveDraft('后来写的草稿');
    api.timeout = false;
    api.viewOverride = testView(revision: 2, text: '正式结算后的正文');
    await c.recover();
    expect(api.executed, hasLength(1));
    expect(c.current!.revision, 2);
    expect(c.draft, '后来写的草稿');
    expect(c.unknown, isFalse);
    c.dispose();
    c.session.dispose();
  });
  test('execute HTTP严格校验归属与base_revision，并使用专用路径而非自由act', () async {
    final paths = <String>[];
    var wrong = false;
    final api = ExperienceClient(
      baseUrl: () => 'https://api.invalid',
      client: MockClient((request) async {
        paths.add(request.url.path);
        final body = object(jsonDecode(request.body));
        return http.Response(
          jsonEncode(
            testOperation(body['request_id'], branch: wrong ? 'other' : 'main'),
          ),
          202,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    final body = {
      'request_id': 'request',
      'branch_id': 'main',
      'expected_revision': 1,
      ...action(),
    };
    expect(
      (await api.executeArtifact('experience-a', 'a b', body)).status,
      'committed',
    );
    expect(paths.single, endsWith('/artifacts/a%20b/execute'));
    wrong = true;
    await expectLater(
      api.executeArtifact('experience-a', 'a b', body),
      throwsFormatException,
    );
    api.close();
  });
}

class _ExecuteApi extends FakeExperienceApi implements ExperienceArtifactApi {
  final executed = <Json>[];
  Future<void> Function()? onExecute;
  @override
  Future<ExperienceOperation> executeArtifact(
    String id,
    String artifactId,
    Json body,
  ) async {
    await onExecute?.call();
    executed.add(object(jsonDecode(jsonEncode(body))));
    if (timeout) throw TimeoutException('lost accepted response');
    return ExperienceOperation(
      testOperation(body['request_id'], id: id, branch: body['branch_id']),
    );
  }
}
