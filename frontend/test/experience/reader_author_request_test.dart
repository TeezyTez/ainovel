import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import '../support/experience_fixture.dart';

void main() {
  test('创建私有作者资料随精确请求持久化，恢复重试不取后来修改的资料', () async {
    final journal = MemoryJournal(),
        api = _CreateJournalApi(journal)..timeout = true;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    await c.newSeed();
    await c.saveDraft('公开种子');
    final scope = c.scope,
        author = <String, dynamic>{
          'title': '测试世界',
          'characters': [
            {'name': '甲', 'secret': '最初的幕后秘密'},
          ],
        },
        version = <String, dynamic>{
          'id': 'world-a',
          'version': 3,
          'title': '测试世界',
          'public_seed': '公开种子',
        };
    await c.send(authorWorld: author, worldVersion: version);
    expect(c.unknown, isTrue);
    expect(api.creates, hasLength(1));
    final saved = await journal.read(scope),
        body = Map<String, dynamic>.from(
          (saved['attempt'] as Map)['body'] as Map,
        );
    expect(body['seed'], '公开种子');
    expect((body['author_world'] as Map)['characters'], [
      {'name': '甲', 'secret': '最初的幕后秘密'},
    ]);
    expect(body['world_version'], version);
    (author['characters'] as List).single['secret'] = '后来修改的秘密';
    version['version'] = 4;
    c.dispose();
    c.session.dispose();
    final resumed = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await resumed.initialize();
    api.missing = true;
    await resumed.recover();
    expect(resumed.notReceived, isTrue);
    await resumed.resendSameRequest();
    expect(api.creates, hasLength(2));
    expect(api.creates.last, body);
    expect(
      ((api.creates.last['author_world'] as Map)['characters'] as List)
          .single['secret'],
      '最初的幕后秘密',
    );
    resumed.dispose();
    resumed.session.dispose();
  });
  test('作者字段只属于创建，不混入已有故事的act或ask', () async {
    final c = ExperienceController(
      session: testSession(),
      api: FakeExperienceApi(),
      journal: MemoryJournal(),
    );
    await c.initialize();
    await c.open('experience-a');
    await c.saveDraft('公开提问');
    await c.send(
      explicitMode: 'ask',
      authorWorld: {
        'characters': [
          {'secret': '不可发送'},
        ],
      },
      worldVersion: {'version': 9},
    );
    final request = (c.api as FakeExperienceApi).sent.single;
    expect(request.containsKey('author_world'), isFalse);
    expect(request.containsKey('world_version'), isFalse);
    expect(request['input'], '公开提问');
    c.dispose();
    c.session.dispose();
  });
}

class _CreateJournalApi extends FakeExperienceApi {
  _CreateJournalApi(this.journal);
  final MemoryJournal journal;
  @override
  Future<ExperienceView> create(Json body) async {
    if (!journal.rows.values.any(
      (r) =>
          (r['attempt'] as Map?)?['request_id'] == body['request_id'] &&
          (r['attempt'] as Map)['body']['author_world'] != null,
    ))
      throw StateError('create before private request persisted');
    return super.create(body);
  }
}
