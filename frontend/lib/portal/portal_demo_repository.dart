/// Device-local index for fixed demo scripts and read-only opening sessions.
/// These sessions never enter the formal Go experience history.
library;

import 'dart:convert';

import '../experience/experience_journal.dart';
import '../experience/demo_world_catalog.dart';

const portalScriptedWorldIds = <String>['fog-harbor', 'mountain', 'thursday'];

class PortalDemoEntry {
  const PortalDemoEntry({
    required this.id,
    required this.worldId,
    required this.session,
    required this.createdAt,
    required this.updatedAt,
    this.displayName = '',
    this.note = '',
    this.group = '',
    this.pinned = false,
    this.archived = false,
    this.trashedAt,
  });

  final String id, worldId;
  final Map<String, dynamic> session;
  final DateTime createdAt, updatedAt;
  final String displayName, note, group;
  final bool pinned, archived;
  final int? trashedAt;

  Map<String, dynamic>? get readonlyOpening => session['readonlyOpening'] is Map
      ? Map<String, dynamic>.from(session['readonlyOpening'] as Map)
      : null;
  bool get readOnly => readonlyOpening != null;

  String get worldTitle =>
      (readonlyOpening?['title'] as String?) ??
      demoWorldPresets
          .where((world) => world.id == worldId)
          .map((world) => world.title)
          .firstOrNull ??
      worldId;
  String get title => displayName.trim().isEmpty ? worldTitle : displayName;
  int get step => session['step'] is int ? session['step'] as int : 0;
  bool get ended => !readOnly && step >= 8;
  String get latestProse {
    final turns = session['turns'];
    if (turns is! List || turns.isEmpty || turns.last is! Map) {
      return readonlyOpening?['opening'] as String? ?? '';
    }
    final value = (turns.last as Map)['prose'];
    return value is String ? value : '';
  }

  String get searchableText {
    final turns = session['turns'];
    final prose = turns is List
        ? turns
              .whereType<Map>()
              .map((turn) => '${turn['input'] ?? ''} ${turn['prose'] ?? ''}')
              .join(' ')
        : '';
    return '$title $worldTitle $note $group $prose $latestProse'.toLowerCase();
  }
}

class PortalDemoRepository {
  PortalDemoRepository({
    required this.journal,
    required String backendUrl,
    required String workspaceId,
  }) : _api = backendUrl,
       _workspace = workspaceId;

  /// The detail page already receives its per-world journal scope. Recover
  /// the same service/workspace identity without changing the host API.
  factory PortalDemoRepository.fromSessionScope({
    required ExperienceJournal journal,
    required String scope,
  }) {
    final parts = jsonDecode(scope);
    if (parts is! List ||
        parts.length != 4 ||
        parts[0] is! String ||
        parts[1] is! List ||
        (parts[1] as List).length != 2 ||
        (parts[1] as List)[0] != 'workspace' ||
        (parts[1] as List)[1] is! String ||
        parts[2] != 'portal-demo') {
      throw const FormatException('本机预设演示范围无效');
    }
    return PortalDemoRepository(
      journal: journal,
      backendUrl: parts[0] as String,
      workspaceId: (parts[1] as List)[1] as String,
    );
  }

  final ExperienceJournal journal;
  final String _api, _workspace;
  static int _nextId = 0;
  String get backendUrl => _api;
  String get workspaceId => _workspace;

  String get catalogScope =>
      experienceScope(_api, _workspace, 'portal-demo', 'catalog');
  String sessionScope(String worldId) =>
      experienceScope(_api, _workspace, 'portal-demo', worldId);

  static String _stateKey(String id) => 'state:$id';
  static String _metaKey(String id, String field) => 'meta:$id:$field';

  Future<PortalDemoEntry?> entry(String sessionId) async {
    final row = await journal.read(catalogScope);
    return _entryFromRow(sessionId, row);
  }

  PortalDemoEntry? _entryFromRow(String id, Map<String, dynamic> row) {
    final raw = row[_stateKey(id)];
    if (raw is! Map || raw['deleted'] == true || raw['session'] is! Map) {
      return null;
    }
    final state = Map<String, dynamic>.from(raw);
    final worldId = state['world_id'] is String
        ? state['world_id'] as String
        : id;
    final session = Map<String, dynamic>.from(state['session'] as Map);
    final readonly = session['readonlyOpening'];
    if (!portalScriptedWorldIds.contains(worldId) &&
        (readonly is! Map ||
            readonly['title'] is! String ||
            readonly['opening'] is! String)) {
      return null;
    }
    String string(String key) => row[_metaKey(id, key)] is String
        ? row[_metaKey(id, key)] as String
        : '';
    return PortalDemoEntry(
      id: id,
      worldId: worldId,
      session: session,
      createdAt:
          DateTime.tryParse('${state['created_at'] ?? ''}') ?? DateTime.now(),
      updatedAt:
          DateTime.tryParse('${state['updated_at'] ?? ''}') ?? DateTime.now(),
      displayName: string('display_name'),
      note: string('note'),
      group: string('group'),
      pinned: row[_metaKey(id, 'pinned')] == true,
      archived: row[_metaKey(id, 'archived')] == true,
      trashedAt: row[_metaKey(id, 'trashed_at')] is int
          ? row[_metaKey(id, 'trashed_at')] as int
          : null,
    );
  }

  Future<List<PortalDemoEntry>> loadEntries() async {
    var row = await journal.read(catalogScope);
    // Pick up sessions made by the first Flutter preview build, whose state
    // lived only under its fixed per-world scope.
    for (final id in portalScriptedWorldIds) {
      if (row.containsKey(_stateKey(id))) continue;
      final old = await journal.read(sessionScope(id));
      if (old['worldId'] != id || old['session'] is! Map) continue;
      final now = DateTime.now().toUtc().toIso8601String();
      await journal.patch(catalogScope, {
        _stateKey(id): {
          'session': Map<String, dynamic>.from(old['session'] as Map),
          'created_at': now,
          'updated_at': now,
        },
      });
      row = await journal.read(catalogScope);
    }
    return [
      for (final key in row.keys)
        if (key.startsWith('state:'))
          ?_entryFromRow(key.substring('state:'.length), row),
    ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  /// Starting again always creates a distinct local experience. The original
  /// demo keeps the earlier session when the same preset is started again.
  Future<PortalDemoEntry> create(String worldId) async {
    if (!portalScriptedWorldIds.contains(worldId)) {
      throw const FormatException('这个世界没有预设脚本');
    }
    final id = 'demo-${DateTime.now().microsecondsSinceEpoch}-${_nextId++}';
    final now = DateTime.now().toUtc().toIso8601String();
    await journal.patch(catalogScope, {
      _stateKey(id): {
        'world_id': worldId,
        'session': const {'step': 0, 'flags': {}, 'facts': [], 'turns': []},
        'created_at': now,
        'updated_at': now,
      },
    });
    return (await entry(id))!;
  }

  /// Freeze public opening material for an independent offline session.
  /// Only listed reader-facing fields enter the stored snapshot.
  Future<PortalDemoEntry> createReadOnly({
    required String worldId,
    required String title,
    required String opening,
    String identity = '',
    String location = '',
    String era = '',
    List<String> rules = const [],
    List<Map<String, String>> characters = const [],
  }) async {
    if (worldId.trim().isEmpty ||
        title.trim().isEmpty ||
        opening.trim().isEmpty ||
        title.length > 100 ||
        opening.length > 12000) {
      throw const FormatException('只读开场的世界名称或正文无效');
    }
    final id = 'demo-${DateTime.now().microsecondsSinceEpoch}-${_nextId++}';
    final now = DateTime.now().toUtc().toIso8601String();
    await journal.patch(catalogScope, {
      _stateKey(id): {
        'world_id': worldId,
        'session': {
          'step': 0,
          'flags': <String, String>{},
          'facts': <String>[],
          'turns': <dynamic>[],
          'readonlyOpening': {
            'title': title.trim(),
            'opening': opening.trim(),
            'identity': identity.trim(),
            'location': location.trim(),
            'era': era.trim(),
            'rules': rules.where((rule) => rule.trim().isNotEmpty).toList(),
            'characters': [
              for (final character in characters)
                {
                  'name': (character['name'] ?? '').trim(),
                  'public': (character['public'] ?? '').trim(),
                },
            ],
          },
        },
        'created_at': now,
        'updated_at': now,
      },
    });
    return (await entry(id))!;
  }

  Future<PortalDemoEntry> ensure(String worldId) async {
    if (!portalScriptedWorldIds.contains(worldId)) {
      throw const FormatException('这个世界没有预设脚本');
    }
    final current =
        await entry(worldId) ??
        (await loadEntries())
            .where((entry) => entry.worldId == worldId)
            .firstOrNull;
    if (current != null) return current;
    final now = DateTime.now().toUtc().toIso8601String();
    await journal.patch(catalogScope, {
      _stateKey(worldId): {
        'world_id': worldId,
        'session': const {'step': 0, 'flags': {}, 'facts': [], 'turns': []},
        'created_at': now,
        'updated_at': now,
      },
    });
    return (await entry(worldId))!;
  }

  Future<void> saveState(String sessionId, Map<String, dynamic> session) async {
    final row = await journal.read(catalogScope);
    final old = row[_stateKey(sessionId)];
    if (old is! Map || old['deleted'] == true) {
      throw const FormatException('找不到这段预设演示');
    }
    final worldId = old['world_id'] is String
        ? old['world_id'] as String
        : sessionId;
    if (!portalScriptedWorldIds.contains(worldId) &&
        Map<String, dynamic>.from(old['session'] as Map)['readonlyOpening']
            is! Map) {
      throw const FormatException('这个世界没有预设脚本');
    }
    final previous = old['created_at'];
    final now = DateTime.now().toUtc().toIso8601String();
    await journal.patch(catalogScope, {
      _stateKey(sessionId): {
        'world_id': worldId,
        'session': session,
        'created_at': previous is String ? previous : now,
        'updated_at': now,
      },
    });
  }

  Future<void> updatePersonal(
    String sessionId,
    Map<String, dynamic> fields,
  ) async {
    if (await entry(sessionId) == null) {
      throw const FormatException('找不到这段预设演示');
    }
    const allowed = {
      'display_name',
      'note',
      'group',
      'pinned',
      'archived',
      'trashed_at',
    };
    if (!fields.keys.every(allowed.contains)) {
      throw const FormatException('演示故事整理字段无效');
    }
    await journal.patch(catalogScope, {
      for (final field in fields.entries)
        _metaKey(sessionId, field.key): field.value,
    });
  }

  Future<void> trashAll() async {
    final entries = (await loadEntries())
        .where(
          (entry) =>
              !entry.readOnly ||
              demoWorldPresets.any((world) => world.id == entry.worldId),
        )
        .toList();
    if (entries.isEmpty) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    await journal.patch(catalogScope, {
      for (final entry in entries) _metaKey(entry.id, 'trashed_at'): now,
    });
  }

  Future<void> removePermanently(String sessionId) async {
    if (await entry(sessionId) == null) return;
    await journal.patch(catalogScope, {
      _stateKey(sessionId): {'deleted': true},
      for (final field in const [
        'display_name',
        'note',
        'group',
        'pinned',
        'archived',
        'trashed_at',
      ])
        _metaKey(sessionId, field): null,
    });
  }
}
