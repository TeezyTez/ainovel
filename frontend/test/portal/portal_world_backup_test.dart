import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_world_studio_data.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sembast/sembast_memory.dart';

PortalWorldDraft world(String id, String title) => PortalWorldDraft(id: id)
  ..title = title
  ..description = '$title 的公开简介'
  ..identity = '临时店主'
  ..location = '旧街'
  ..opening = '雨落下时，有人推门进来。'
  ..characters = [
    PortalWorldCharacterDraft(
      id: 'person-1',
      name: '阿言',
      public: '带着伞的顾客。',
      secret: '只供作者查看的身世',
    ),
  ];

void main() {
  test('完整本机备份保留各世界的不可变版本、未发布草稿和故事绑定', () async {
    final db = await databaseFactoryMemory.openDatabase('world-version-backup');
    final journal = LocalExperienceJournal(database: db);
    const backend = 'http://formal.example';
    final source = PortalWorldRepository(
      journal: journal,
      backendUrl: backend,
      workspaceId: 'source',
    );
    final firstWorld = world('world-a', '雨天书店');
    final v1 = await source.saveVersion(firstWorld);
    firstWorld.title = '第二版书店';
    firstWorld.characters.single.secret = '第二版的幕后秘密';
    final v2 = await source.saveVersion(firstWorld);
    await source.saveVersion(world('world-b', '海边茶铺'));
    await source.saveDraft(world('world-c', '尚未发布的世界'));
    final storyLink = {
      'story-1': {'snapshot': v1.draft.toJson(), 'version': v1.version},
    };
    await journal.patch(
      experienceScope(backend, 'source', 'story-worlds', 'versions'),
      storyLink,
    );

    final backup = await journal.exportWorkspace(backend, 'source');
    final catalog = backup['["world-studio","catalog"]'] as Map;
    expect((catalog['versions'] as List).length, 3);
    expect((catalog['draft'] as Map)['title'], '尚未发布的世界');
    final target = PortalWorldRepository(
      journal: journal,
      backendUrl: backend,
      workspaceId: 'target',
    );
    await journal.importWorkspace(backend, 'target', backup);
    await journal.importWorkspace(backend, 'target', backup);
    final versions = await target.loadVersions();
    expect(versions.length, 3);
    expect(
      versions.where((v) => v.draft.id == 'world-a').map((v) => v.version),
      [1, 2],
    );
    expect(versions.first.draft.title, '雨天书店');
    expect(versions.first.draft.characters.single.secret, '只供作者查看的身世');
    expect(versions[1].draft.title, '第二版书店');
    expect(versions[1].draft.characters.single.secret, '第二版的幕后秘密');
    expect(versions[1].toJson()['localOnly'], true);
    expect((await target.loadDraft())!.title, '尚未发布的世界');
    expect(
      await journal.read(
        experienceScope(backend, 'target', 'story-worlds', 'versions'),
      ),
      storyLink,
    );
    expect(v2.version, 2);
    await db.close();
  });
}
