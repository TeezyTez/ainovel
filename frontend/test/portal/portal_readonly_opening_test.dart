import 'package:elselife_frontend/experience/experience_client.dart';
import 'package:elselife_frontend/experience/portal_demo_experience_api.dart';
import 'package:elselife_frontend/portal/portal_demo_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/experience_fixture.dart';

void main() {
  test('只读开场保存独立本机经历，只公开世界人物资料且不能提交故事动作', () async {
    final journal = MemoryJournal();
    final repository = PortalDemoRepository(
      journal: journal,
      backendUrl: 'https://world.test',
      workspaceId: 'local',
    );
    final entry = await repository.createReadOnly(
      worldId: 'my-world',
      title: '雨中的书店',
      opening: '雨声落在窗上。',
      identity: '店主',
      location: '旧街',
      era: '当代',
      rules: ['没有超自然现象。'],
      characters: [
        {'name': '林', 'public': '常来借书', 'secret': '幕后才知道'},
      ],
    );
    expect(entry.readOnly, true);
    expect(entry.worldTitle, '雨中的书店');
    final second = await repository.createReadOnly(
      worldId: 'my-world',
      title: '雨中的书店',
      opening: '雨声落在窗上。',
    );
    expect(second.id, isNot(entry.id));
    expect((await repository.loadEntries()).length, 2);

    final api = PortalDemoExperienceApi(
      repository: repository,
      sessionId: entry.id,
      opening: '外部传入的旧开场',
    );
    final view = await api.view(entry.id);
    expect(view.pages.length, 1);
    expect(view.pages.single.mode, 'begin');
    expect(view.pages.single.text, '雨声落在窗上。');
    expect(view.pages.single.outcome, 'continues');
    expect(
      view.information.map((item) => item.name),
      containsAll(['你', '旧街', '林']),
    );
    expect(
      view.information.map((item) => item.text).join(' '),
      isNot(contains('幕后才知道')),
    );
    expect(
      () => api.submit(entry.id, const {}),
      throwsA(isA<ExperienceHttpException>()),
    );

    final fork = await api.branch(entry.id, {
      'request_id': 'fork-1',
      'from_branch_id': 'main',
      'from_revision': 1,
      'name': '重读开场',
    });
    expect(fork.pages.single.text, '雨声落在窗上。');
    expect(fork.branches.length, 2);
    await repository.trashAll();
    expect((await repository.entry(entry.id))?.trashedAt, isNull);
  });
}
