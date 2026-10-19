library;

import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../experience/demo_world_catalog.dart';
import '../experience/experience_journal.dart';
import 'portal_world_data.dart';
import 'portal_world_author_data.dart';

String _string(Object? value) => value is String ? value : '';
Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<dynamic> _list(Object? value) => value is List ? value : const [];

class PortalWorldCharacterDraft {
  PortalWorldCharacterDraft({
    String? id,
    this.name = '',
    this.role = '',
    this.public = '',
    this.goal = '',
    this.history = '',
    this.secret = '',
  }) : id = id ?? 'person-${const Uuid().v4()}';

  final String id;
  String name;
  String role;
  String public;
  String goal;
  String history;
  String secret;

  factory PortalWorldCharacterDraft.fromJson(Object? value) {
    final data = _map(value);
    return PortalWorldCharacterDraft(
      id: _string(data['id']).isEmpty ? null : _string(data['id']),
      name: _string(data['name']),
      role: _string(data['role']),
      public: _string(data['public']),
      goal: _string(data['goal']),
      history: _string(data['history']),
      secret: _string(data['secret']),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'role': role,
    'public': public,
    'goal': goal,
    'history': history,
    'secret': secret,
  };
}

class PortalWorldDraft {
  PortalWorldDraft({String? id}) : id = id ?? 'world-${const Uuid().v4()}';

  final String id;
  String seed = '';
  String title = '';
  String description = '';
  String era = '';
  List<String> rules = [];
  String identity = '';
  String location = '';
  String goal = '';
  String opening = '';
  List<PortalWorldCharacterDraft> characters = [];
  String perspective = '第二人称';
  String length = '适中';
  String style = '细腻克制';
  String pace = '从容';

  factory PortalWorldDraft.fromJson(Object? value) {
    final data = _map(value);
    final narrative = _map(data['narrative']);
    return PortalWorldDraft(
        id: _string(data['id']).isEmpty ? null : _string(data['id']),
      )
      ..seed = _string(data['seed'])
      ..title = _string(data['title'])
      ..description = _string(data['description'])
      ..era = _string(data['era'])
      ..rules = _list(data['rules']).whereType<String>().toList()
      ..identity = _string(data['identity'])
      ..location = _string(data['location'])
      ..goal = _string(data['goal'])
      ..opening = _string(data['opening'])
      ..characters = _list(
        data['characters'],
      ).map(PortalWorldCharacterDraft.fromJson).toList()
      ..perspective = _string(narrative['perspective']).isEmpty
          ? '第二人称'
          : _string(narrative['perspective'])
      ..length = _string(narrative['length']).isEmpty
          ? '适中'
          : _string(narrative['length'])
      ..style = _string(narrative['style']).isEmpty
          ? '细腻克制'
          : _string(narrative['style'])
      ..pace = _string(narrative['pace']).isEmpty
          ? '从容'
          : _string(narrative['pace']);
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'seed': seed,
    'title': title,
    'description': description,
    'tagline': description.substring(0, description.length.clamp(0, 100)),
    'era': era,
    'rules': List<String>.of(rules),
    'identity': identity,
    'location': location,
    'goal': goal,
    'opening': opening,
    'characters': characters.map((character) => character.toJson()).toList(),
    'narrative': {
      'perspective': perspective,
      'length': length,
      'style': style,
      'pace': pace,
    },
  };

  PortalWorldDraft snapshot() => PortalWorldDraft.fromJson(toJson());

  void applyImport(PortalWorldImport result) {
    final fields = result.fields;
    for (final entry in fields.entries) {
      switch (entry.key) {
        case 'seed':
          seed = _string(entry.value);
        case 'title':
          title = _string(entry.value);
        case 'description':
          description = _string(entry.value);
        case 'era':
          era = _string(entry.value);
        case 'identity':
          identity = _string(entry.value);
        case 'location':
          location = _string(entry.value);
        case 'goal':
          goal = _string(entry.value);
        case 'opening':
          opening = _string(entry.value);
        case 'rules':
          rules = _list(entry.value).whereType<String>().toList();
        case 'characters':
          characters = _list(
            entry.value,
          ).map(PortalWorldCharacterDraft.fromJson).toList();
        case 'narrative':
          final narrative = _map(entry.value);
          if (narrative['perspective'] is String) {
            perspective = _string(narrative['perspective']);
          }
          if (narrative['length'] is String) {
            length = _string(narrative['length']);
          }
          if (narrative['style'] is String) {
            style = _string(narrative['style']);
          }
          if (narrative['pace'] is String) {
            pace = _string(narrative['pace']);
          }
      }
    }
  }

  void validateForSave() {
    if (title.trim().isEmpty ||
        identity.trim().isEmpty ||
        location.trim().isEmpty ||
        opening.trim().isEmpty) {
      throw const FormatException('请先填写世界名称、玩家身份、起始地点和开场正文。');
    }
    final fields = <String, (String, int)>{
      '故事想法': (seed, 8000),
      '世界名称': (title, 100),
      '世界简介': (description, 4000),
      '时代 / 环境': (era, 500),
      '玩家身份': (identity, 500),
      '起始地点': (location, 500),
      '个人目标': (goal, 1000),
      '开场正文': (opening, 12000),
      '文风': (style, 200),
    };
    for (final entry in fields.entries) {
      if (entry.value.$1.length > entry.value.$2) {
        throw FormatException('${entry.key}超过 ${entry.value.$2} 字。');
      }
    }
    if (rules.length > 40 || rules.any((rule) => rule.length > 2000)) {
      throw const FormatException('规则最多 40 条，每条不超过 2000 字。');
    }
    if (characters.length > 30) {
      throw const FormatException('人物最多 30 位。');
    }
    for (final character in characters) {
      if (character.name.trim().isEmpty) {
        throw const FormatException('请填写每位人物的姓名，或移除空人物。');
      }
      for (final entry in <String, (String, int)>{
        '姓名': (character.name, 100),
        '身份': (character.role, 200),
        '公开介绍': (character.public, 3000),
        '人物目标': (character.goal, 500),
        '关系与经历': (character.history, 1000),
        '幕后秘密': (character.secret, 3000),
      }.entries) {
        if (entry.value.$1.length > entry.value.$2) {
          throw FormatException(
            '${character.name}的${entry.key}超过 ${entry.value.$2} 字。',
          );
        }
      }
    }
  }

  /// Explicit public allowlist. Author-only character material is omitted
  /// here and transmitted separately in the author_world generation context.
  String toPublicSeed() {
    validateForSave();
    final sections = <String>[
      '世界名称：${title.trim()}',
      if (description.trim().isNotEmpty) '世界简介：${description.trim()}',
      if (era.trim().isNotEmpty) '时代与环境：${era.trim()}',
      if (rules.isNotEmpty)
        '世界规则：\n${rules.map((r) => '• ${r.trim()}').join('\n')}',
      '玩家身份：${identity.trim()}',
      '起始地点：${location.trim()}',
      if (goal.trim().isNotEmpty) '玩家可选目标：${goal.trim()}',
      '开场正文：\n${opening.trim()}',
      if (characters.isNotEmpty)
        '公开人物：\n${characters.map((c) => '• ${c.name.trim()}${c.role.trim().isEmpty ? '' : ' · ${c.role.trim()}'}${c.public.trim().isEmpty ? '' : '：${c.public.trim()}'}').join('\n')}',
      '叙述偏好：$perspective；$length；$style；$pace',
    ];
    final publicSeed = sections.join('\n\n');
    if (utf8.encode(publicSeed).length > 32 * 1024) {
      throw const FormatException('公开资料超过正式服务 32 KB 的创作种子限制。请精简公开介绍或开场正文。');
    }
    return publicSeed;
  }
}

class PortalWorldImport {
  const PortalWorldImport(this.kind, this.fields, this.warnings);
  final String kind;
  final Map<String, dynamic> fields;
  final List<String> warnings;
}

/// Mirrors src/world-import.js: parse -> preview -> explicit adoption.
PortalWorldImport parsePortalWorldImport(String content, String filename) {
  if (content.length > 120000) {
    throw const FormatException('请选择不超过 120 KB 的文字资料。');
  }
  String clean(Object? value) => value is String ? value.trim() : '';
  void check(Object? value, int max, String label) {
    if (value is String && value.length > max) {
      throw FormatException('$label 超过 $max 字限制。请拆分资料后再导入，原草稿未改变。');
    }
  }

  if (!filename.toLowerCase().endsWith('.json')) {
    return PortalWorldImport('text', {
      'seed': content.substring(0, content.length.clamp(0, 8000)),
    }, content.length > 8000 ? ['文字超过 8000 字，已截取前 8000 字。请检查后再生成。'] : []);
  }
  Object? source;
  try {
    source = jsonDecode(content);
  } catch (_) {
    throw const FormatException('JSON 格式无效，原有草稿未改变。');
  }
  if (source is! Map) {
    throw const FormatException('需要角色卡、世界书或本产品世界对象。');
  }
  final data = _map(source['data'] ?? source);
  if (data.isEmpty && source['data'] != null) {
    throw const FormatException('JSON data必须为对象。');
  }
  for (final entry in <String, int>{
    'title': 100,
    'name': 100,
    'description': 3000,
    'scenario': 4000,
    'era': 500,
    'identity': 500,
    'location': 500,
    'goal': 1000,
    'opening': 12000,
    'first_mes': 12000,
    'personality': 1000,
  }.entries) {
    check(data[entry.key], entry.value, entry.key);
  }
  if (data['rules'] is List) {
    final rules = _list(data['rules']);
    if (rules.length > 40 ||
        rules.any((r) => r is! String || r.length > 2000)) {
      throw const FormatException('规则最多40条，每条2000字；请先拆分资料。');
    }
  }
  if (data['characters'] is List) {
    final characters = _list(data['characters']);
    if (characters.length > 30) {
      throw const FormatException('人物最多30位，请分批整理。');
    }
    for (final raw in characters) {
      if (raw is! Map) throw const FormatException('人物资料格式无效。');
      final character = _map(raw);
      for (final entry in <String, int>{
        'name': 100,
        'role': 200,
        'public': 3000,
        'goal': 500,
        'history': 1000,
        'secret': 3000,
      }.entries) {
        check(character[entry.key], entry.value, entry.key);
      }
    }
  }
  final warnings = ['导入仅形成草案。请核对公开介绍和幕后资料，再保存或生成开场。'];
  if (data['title'] is String && data['rules'] is List) {
    final fields = <String, dynamic>{};
    for (final key in [
      'title',
      'description',
      'era',
      'identity',
      'location',
      'goal',
      'opening',
    ]) {
      fields[key] = clean(data[key]);
    }
    fields['rules'] = _list(data['rules']).whereType<String>().toList();
    fields['characters'] = [
      for (final raw in _list(data['characters']))
        {..._map(raw), 'id': 'import-person-${const Uuid().v4()}'},
    ];
    if (data['narrative'] is Map) {
      final narrative = _map(data['narrative']);
      fields['narrative'] = {
        for (final key in ['perspective', 'length', 'style', 'pace'])
          if (narrative[key] is String && _string(narrative[key]).length <= 200)
            key: narrative[key],
      };
    }
    return PortalWorldImport('world', fields, warnings);
  }
  final book = _map(data['character_book'] ?? data);
  final rawEntries = book['entries'];
  final entries = rawEntries is List
      ? rawEntries
      : rawEntries is Map
      ? rawEntries.values.toList()
      : <dynamic>[];
  if (entries.any((entry) => entry is! Map)) {
    throw const FormatException('世界书条目必须为对象。');
  }
  final enabled = entries
      .map(_map)
      .where((e) => e['enabled'] != false && e['disable'] != true)
      .toList();
  if (enabled.length > 40 ||
      enabled.any((e) => clean(e['content']).length > 2000)) {
    throw const FormatException('启用的世界书条目最多40条，每条2000字；未采用任何资料。');
  }
  if (entries.length != enabled.length) {
    warnings.add('已忽略 ${entries.length - enabled.length} 条停用条目。');
  }
  if (enabled.any((e) => clean(e['content']).isEmpty)) {
    warnings.add('已忽略内容为空或非文字的条目。');
  }
  final rules = enabled
      .map((e) => clean(e['content']))
      .where((s) => s.isNotEmpty)
      .toList();
  if (clean(data['name']).isNotEmpty &&
      (data.containsKey('description') || data.containsKey('first_mes'))) {
    final name = clean(data['name']);
    final opening = clean(
      data['first_mes'],
    ).replaceAll('{{char}}', name).replaceAll('{{user}}', '你');
    check(opening, 12000, '替换角色名后的开场');
    return PortalWorldImport(
      'character',
      {
        'title': '$name的世界',
        'description': clean(data['scenario']),
        'opening': opening,
        'characters': [
          {
            'id': 'import-person-${const Uuid().v4()}',
            'name': name,
            'role': '角色卡人物',
            'public': clean(data['description']),
            'goal': '',
            'history': clean(data['personality']),
            'secret': '',
          },
        ],
        if (entries.isNotEmpty) 'rules': rules,
      },
      [...warnings, '角色卡中的 system_prompt、越权指令及扩展脚本不会被执行。身份与地点需你补充。'],
    );
  }
  if (entries.isNotEmpty) {
    return PortalWorldImport(
      'worldbook',
      {'rules': rules},
      [...warnings, '世界书条目导入为可编辑规则，不模拟关键词触发器或脚本。'],
    );
  }
  throw const FormatException('未识别到支持的文字世界、角色卡或世界书。也可将内容粘贴到故事想法中。');
}

class PortalWorldVersion {
  PortalWorldVersion({
    required this.draft,
    required this.version,
    required this.savedAt,
  });
  final PortalWorldDraft draft;
  final int version;
  final DateTime savedAt;

  factory PortalWorldVersion.fromJson(Object? value) {
    final data = _map(value);
    return PortalWorldVersion(
      draft: PortalWorldDraft.fromJson(data['snapshot']),
      version: data['version'] is int ? data['version'] as int : 1,
      savedAt: DateTime.tryParse(_string(data['savedAt'])) ?? DateTime.now(),
    );
  }
  Map<String, dynamic> toJson() => {
    'snapshot': draft.toJson(),
    'version': version,
    'savedAt': savedAt.toUtc().toIso8601String(),
    'localOnly': true,
  };
}

class PortalWorldRepository {
  PortalWorldRepository({
    required this.journal,
    required String backendUrl,
    required String workspaceId,
  }) : scope = experienceScope(
         backendUrl,
         workspaceId,
         'world-studio',
         'catalog',
       );

  final ExperienceJournal journal;
  final String scope;
  Future<void> _queue = Future.value();

  Future<PortalWorldDraft?> loadDraft() async {
    final record = await journal.read(scope);
    return record['draft'] is Map
        ? PortalWorldDraft.fromJson(record['draft'])
        : null;
  }

  Future<List<PortalWorldVersion>> loadVersions() async {
    final record = await journal.read(scope);
    return _list(
      record['versions'],
    ).whereType<Map>().map(PortalWorldVersion.fromJson).toList();
  }

  Future<void> saveDraft(PortalWorldDraft draft) {
    final snapshot = draft.toJson();
    final task = _queue.then((_) => journal.patch(scope, {'draft': snapshot}));
    _queue = task.catchError((Object _) {});
    return task;
  }

  Future<PortalWorldVersion> saveVersion(PortalWorldDraft draft) {
    final snapshot = draft.snapshot()
      ..rules = draft.rules
          .where((r) => r.trim().isNotEmpty)
          .map((r) => r.trim())
          .toList();
    if (snapshot.rules.isEmpty) snapshot.rules = ['人物拥有自己的生活与选择。'];
    snapshot.validateForSave();
    final task = _queue.then((_) async {
      final versions = await loadVersions();
      final next =
          versions
              .where((v) => v.draft.id == snapshot.id)
              .fold<int>(0, (max, v) => v.version > max ? v.version : max) +
          1;
      final saved = PortalWorldVersion(
        draft: snapshot.snapshot(),
        version: next,
        savedAt: DateTime.now(),
      );
      versions.add(saved);
      await journal.patch(scope, {
        'versions': versions.map((v) => v.toJson()).toList(),
        'draft': null,
      });
      return saved;
    });
    _queue = task.then<void>((_) {}, onError: (Object _) {});
    return task;
  }
}

/// Creates an editable local copy of the original built-in world.
/// Author-only NPC material remains in this local draft; toPublicSeed omits it.
PortalWorldDraft portalDraftFromPreset(
  DemoWorldPreset preset, {
  bool copy = false,
}) {
  final data = portalWorldDataById[preset.id];
  final author = portalWorldAuthorById[preset.id];
  final draft = PortalWorldDraft()
    ..seed = preset.seed
    ..title = copy ? '${preset.title} · 副本' : preset.title
    ..description = data?.description ?? preset.tagline
    ..era = data?.era ?? ''
    ..rules = List<String>.of(data?.rules ?? const [])
    ..identity = data?.identity ?? preset.participation
    ..location = data?.location ?? ''
    ..goal = author?['goal'] as String? ?? ''
    ..opening = data?.opening ?? ''
    ..characters = [
      if (author?['characters'] is List)
        for (final character in author!['characters'] as List)
          PortalWorldCharacterDraft.fromJson(character)
      else
        for (final character
            in data?.characters ?? const <PortalWorldCharacter>[])
          PortalWorldCharacterDraft(
            name: character.name,
            public: character.publicDescription,
          ),
    ];
  final narrative = author?['narrative'];
  if (narrative is Map) {
    for (final entry in narrative.entries) {
      if (entry.value is! String || (entry.value as String).isEmpty) continue;
      switch (entry.key) {
        case 'perspective':
          draft.perspective = entry.value as String;
        case 'length':
          draft.length = entry.value as String;
        case 'style':
          draft.style = entry.value as String;
        case 'pace':
          draft.pace = entry.value as String;
      }
    }
  }
  return draft;
}

/// Copying a local version gets a distinct world id; the source snapshot stays immutable.
PortalWorldDraft portalCopyWorld(PortalWorldDraft source) =>
    PortalWorldDraft.fromJson({
      ...source.toJson(),
      'id': 'world-${const Uuid().v4()}',
      'title': '${source.title} · 副本',
    });
