import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import '../support/experience_fixture.dart';

void main() {
  Json change() => {
    'world_version': {
      'id': 'world-a',
      'version': 4,
      'title': '世界',
      'public_seed': '公开seed',
    },
    'author_world': {
      'title': '世界',
      'characters': [
        {'name': '甲', 'secret': '保存时的秘密'},
      ],
    },
  };
  String links(ExperienceController c) => experienceScope(
    c.session.backendUrl,
    c.session.workspaceId,
    'story-worlds',
    'versions',
  );
  test('world_version可携带author_world，CAS与私有快照先持久化，丢响应恢复后绑定新分支', () async {
    final journal = MemoryJournal(), api = FakeExperienceApi()..timeout = true;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    await c.open('experience-a');
    await journal.patch(links(c), {
      'experience-a': {
        'snapshot': {'id': 'original', 'title': '原世界'},
        'version': 1,
        'branches': {
          'older': {
            'snapshot': {'id': 'older'},
          },
        },
      },
    });
    final payload = change(), scope = c.scope;
    await c.forkChange(1, '世界改写', payload);
    expect(c.unknown, isTrue);
    expect(api.forks.single['expected_revision'], 1);
    expect(api.forks.single['author_world'], payload['author_world']);
    (payload['author_world']['characters'] as List).single['secret'] = '后来编辑';
    expect(
      (((await journal.read(scope))['attempt']
                  as Map)['body']['author_world']['characters']
              as List)
          .single['secret'],
      '保存时的秘密',
    );
    await c.recover();
    expect(c.unknown, isFalse);
    expect(c.current!.branchId, 'other');
    final saved = (await journal.read(links(c)))['experience-a'] as Map,
        child = saved['branches']['other'] as Map;
    expect(saved['snapshot']['id'], 'original');
    expect(saved['branches']['older'], isNotNull);
    expect(child['version'], 4);
    expect(child['savedAt'], isA<String>());
    expect(child['snapshot']['id'], 'world-a');
    expect(child['snapshot']['characters'][0]['secret'], '保存时的秘密');
    c.dispose();
    c.session.dispose();
  });
  test('创建响应丢失后恢复使用持久化作者版本，绑定写失败保持unknown可再恢复', () async {
    final journal = _BindingJournal(),
        api = FakeExperienceApi()..timeout = true;
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    await c.initialize();
    await c.newSeed();
    await c.saveDraft('公开seed');
    final payload = change();
    await c.send(
      authorWorld: object(payload['author_world']),
      worldVersion: object(payload['world_version']),
    );
    expect(c.unknown, isTrue);
    expect((await journal.read(links(c))).isEmpty, isTrue);
    journal.failBinding = true;
    await c.recover();
    expect(c.unknown, isTrue);
    expect(c.current, isNull);
    journal.failBinding = false;
    await c.recover();
    expect(c.unknown, isFalse);
    expect(c.current!.id, 'experience-a');
    final saved = (await journal.read(links(c)))['experience-a'] as Map;
    expect(saved['snapshot']['id'], 'world-a');
    expect(saved['version'], 4);
    expect(saved['snapshot']['characters'][0]['secret'], '保存时的秘密');
    c.dispose();
    c.session.dispose();
  });
  test('作者资料不能伴润色/修复或单独提交，仍禁止多种修正混合', () async {
    final api = FakeExperienceApi(),
        c = ExperienceController(
          session: testSession(),
          api: api,
          journal: MemoryJournal(),
        );
    await c.initialize();
    await c.open('experience-a');
    for (final payload in <Json>[
      {'author_world': {}},
      {
        'polish': {'text': 'a'},
        'author_world': {},
      },
      {
        'repair': {'candidate': {}},
        'author_world': {},
      },
      {'polish': {}, 'repair': {}},
      {'world_version': {}, 'author_world': 'bad'},
    ]) {
      await expectLater(
        c.forkChange(1, '非法混合', payload),
        throwsFormatException,
      );
    }
    expect(api.forks, isEmpty);
    c.dispose();
    c.session.dispose();
  });
}

class _BindingJournal extends MemoryJournal {
  bool failBinding = false;
  @override
  Future<void> patch(String scope, Json values) async {
    if (failBinding && scope.contains('story-worlds'))
      throw StateError('binding storage failure');
    return super.patch(scope, values);
  }
}
