import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:sembast/sembast_memory.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import '../support/experience_fixture.dart';

void main() {
  test('真实本地日志原子合并，不用阅读写覆盖request/draft；scope包含四维', () async {
    final db = await databaseFactoryMemory.openDatabase('experience');
    final j = LocalExperienceJournal(database: db);
    final a = experienceScope('api-a', 'account-a', 'experience-a', 'main');
    await j.patch(a, {
      'draft': '未发送',
      'attempt': {'request_id': 'stable'},
    });
    await j.patch(a, {'font_size': 22, 'offset': 99.0});
    expect((await j.read(a))['attempt'], {'request_id': 'stable'});
    for (final key in [
      experienceScope('api-b', 'account-a', 'experience-a', 'main'),
      experienceScope('api-a', 'account-b', 'experience-a', 'main'),
      experienceScope('api-a', 'account-a', 'experience-a', 'other'),
      experienceScope('api-a', null, 'experience-a', 'main'),
    ]) {
      expect(await j.read(key), isEmpty);
    }
    await db.close();
  });
  group('客户端可靠性', () {
    late ExperienceController c;
    late MemoryJournal journal;
    late FakeExperienceApi api;
    setUp(() async {
      journal = MemoryJournal();
      api = FakeExperienceApi()..mustPersist = journal;
      c = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      await c.initialize();
      await c.open('experience-a', branch: 'main');
    });
    tearDown(() {
      c.dispose();
      c.session.dispose();
    });
    test('persist ID和草稿在POST之前；原话与用户显式mode传递，没有account', () async {
      var visibleInFlight = false;
      c.addListener(() {
        if (c.busy && c.unknown && c.attempt != null) visibleInFlight = true;
      });
      journal.gate = Completer<void>();
      c.draft = '我拒绝建议，走另一条路';
      final sending = c.send();
      await Future<void>.delayed(Duration.zero);
      expect(api.sent, isEmpty);
      journal.gate!.complete();
      await sending;
      expect(visibleInFlight, isTrue, reason: 'persist之后、POST返回前提交状态可见');
      expect(api.sent.single['input'], '我拒绝建议，走另一条路');
      expect(api.sent.single['mode'], 'act');
      expect(api.sent.single.containsKey('account_id'), isFalse);
      expect(c.current!.pages.single.text, '已提交的原文。');
      expect(c.draft, isEmpty);
    });
    test('草稿写失败可见且没有POST；读失败不能被一次写成功抹掉', () async {
      journal.failWrite = true;
      c.draft = '保护我';
      await c.send();
      expect(api.sent, isEmpty);
      expect(c.storageError, isNotNull);
      journal.failWrite = false;
      journal.failRead = true;
      await c.open('experience-a', branch: 'main');
      await c.saveDraft('仍不能证明旧请求不存在');
      await c.send();
      expect(api.sent, isEmpty);
      expect(c.localReadFailed, isTrue);
      journal.failRead = false;
      await c.retryLocalStorage();
      expect(c.localReadFailed, isFalse);
    });
    test('timeout保持未知；新编辑不能换ID发送；按原IDquery恢复', () async {
      api.timeout = true;
      await c.saveDraft('等待');
      await c.send();
      final id = api.sent.single['request_id'];
      expect(c.unknown, isTrue);
      await c.saveDraft('接手草稿');
      await c.send();
      expect(api.sent.length, 1);
      api.timeout = false;
      await c.recover();
      expect(api.queried.single, id);
      expect(api.sent.length, 1);
      expect(c.draft, '接手草稿');
    });
    test('404后只显式同ID同body重发', () async {
      api.timeout = true;
      await c.saveDraft('原文');
      await c.send();
      final body = api.sent.single;
      api.missing = true;
      await c.recover();
      expect(c.notReceived, isTrue);
      await c.saveDraft('不能改原请求');
      api.timeout = false;
      await c.resendSameRequest();
      expect(api.sent.length, 2);
      expect(api.sent.last, body);
      expect(c.draft, '不能改原请求');
    });
    test('待生成不是正文；cancel确认后可接手，取消不会重写旧页', () async {
      api.status = 'generating';
      await c.saveDraft('我行动');
      await c.send();
      expect(c.blocked, isTrue);
      expect(c.current!.pages.single.text, '已提交的原文。');
      await c.cancel();
      expect(c.operation!.status, 'cancelled');
      expect(c.blocked, isFalse);
      expect(c.draft, '我行动');
    });
    test('跨分支迟到结果不污染；原分支日志仍可恢复', () async {
      final delayed = Completer<ExperienceOperation>();
      api.delayed = delayed.future;
      await c.saveDraft('原分支输入');
      final pending = c.send();
      await Future<void>.delayed(Duration.zero);
      await c.open('experience-a', branch: 'other');
      await c.saveDraft('另一分支草稿');
      delayed.complete(
        ExperienceOperation(testOperation(api.sent.single['request_id'])),
      );
      await pending;
      expect(c.current!.branchId, 'other');
      expect(c.draft, '另一分支草稿');
      expect(c.operation, isNull);
      await c.open('experience-a', branch: 'main');
      expect(c.unknown, isTrue);
      expect(c.draft, '原分支输入');
    });
    test('read空input不丢已有输入；ask空拒绝', () async {
      await c.saveDraft('尚未决定');
      await c.send(explicitMode: 'read');
      expect(api.sent.single['input'], '');
      expect(c.draft, '尚未决定');
      await c.saveDraft('', selectedMode: 'ask');
      await c.send();
      expect(api.sent.length, 1);
    });
    test('历史分支/显式设定编辑字段，不暗改原页', () async {
      await c.fork(
        1,
        '新的路线',
        fact: c.current!.information.single,
        text: '天已放晴',
      );
      expect(api.forks.single['from_branch_id'], 'main');
      expect(api.forks.single['from_revision'], 1);
      expect(api.forks.single['edit'], {
        'fact_id': 'fact:known',
        'text': '天已放晴',
      });
      expect(c.current!.branchId, 'other');
    });
    test('重建controller读取原ID/草稿/字号/位置，不POST', () async {
      api.timeout = true;
      await c.saveDraft('恢复我');
      await c.saveReading(size: 24, position: 456);
      await c.send();
      final id = api.sent.single['request_id'];
      final restored = ExperienceController(
        session: c.session,
        api: api,
        journal: journal,
      );
      await restored.initialize();
      expect(restored.current!.branchId, 'main');
      expect(restored.attempt!['request_id'], id);
      expect(restored.draft, '恢复我');
      expect(restored.fontSize, 24);
      expect(restored.offset, 456);
      expect(api.sent.length, 1);
      restored.dispose();
    });
    test('create未知保留seed；确认消费原seed，seed与act各自scope', () async {
      await c.newSeed();
      final seedScope = c.scope;
      api.timeout = true;
      await c.saveDraft('原seed');
      await c.send();
      expect(c.draft, '原seed');
      expect((await journal.read(seedScope))['draft'], '原seed');
      api.timeout = false;
      await c.recover();
      expect(c.scope, isNot(seedScope));
      expect(c.draft, isEmpty);
      expect((await journal.read(seedScope))['draft'], isEmpty);
      await c.cancel();
      await c.saveDraft('act新草稿');
      final actScope = c.scope;
      await c.newSeed();
      expect(c.draft, isEmpty);
      expect((await journal.read(actScope))['draft'], 'act新草稿');
    });
    test('create确认不消费后来typed的另一份seed，不搬成act稿', () async {
      await c.newSeed();
      api.timeout = true;
      await c.saveDraft('已送seed');
      await c.send();
      await c.saveDraft('新世界念头');
      api.timeout = false;
      await c.recover();
      expect(c.draft, isEmpty);
      await c.cancel();
      await c.newSeed();
      expect(c.draft, '新世界念头');
    });
    test('act定稿仅清已提交文本，生成期间新typed保存在同scope', () async {
      api.status = 'generating';
      await c.saveDraft('原行动');
      await c.send();
      await c.saveDraft('接下来我问');
      api.status = 'committed';
      await c.recover();
      expect(c.draft, '接下来我问');
      expect((await journal.read(c.scope))['draft'], '接下来我问');
      await c.send();
      expect(c.draft, isEmpty);
      expect((await journal.read(c.scope))['draft'], isEmpty);
    });
    test('create未知用持久receipt恢复，不生成新ID', () async {
      await c.newSeed();
      api.timeout = true;
      await c.saveDraft('一句seed');
      await c.send();
      final id = api.creates.single['request_id'];
      api.timeout = false;
      await c.recover();
      expect(api.queried.single, id);
      expect(api.creates.length, 1);
      expect(c.current!.id, 'experience-a');
    });
    test('branch未知用receipt恢复，原请求已持久', () async {
      api.timeout = true;
      await c.fork(0, '重来');
      final id = api.forks.single['request_id'];
      api.timeout = false;
      await c.recover();
      expect(api.queried.single, id);
      expect(c.current!.branchId, 'other');
      expect(api.forks.length, 1);
    });
  });
  test('本地工作区seed重建恢复且backend隔离，无需账号', () async {
    final session = testSession();
    final j = MemoryJournal();
    final api = FakeExperienceApi();
    final first = ExperienceController(session: session, api: api, journal: j);
    await first.initialize();
    await first.saveDraft('本地世界');
    first.dispose();
    final restored = ExperienceController(
      session: session,
      api: api,
      journal: j,
    );
    await restored.initialize();
    expect(restored.draft, '本地世界');
    session.backendUrl = 'https://other.test';
    await Future<void>.delayed(Duration.zero);
    expect(restored.draft, isEmpty);
    session.backendUrl = 'https://world.test';
    await Future<void>.delayed(Duration.zero);
    expect(restored.draft, '本地世界');
    expect(api.creates, isEmpty);
    restored.dispose();
    session.dispose();
  });
}
