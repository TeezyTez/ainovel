/// 设备草稿/幂等请求/阅读位置的唯一日志；不是正式经历历史。
library;

import 'dart:convert';
import 'package:sembast/sembast.dart';
import '../data/store/local_store_factory.dart';
import 'experience_models.dart';
import 'reader_reading_anchor.dart';

abstract class ExperienceJournal {
  Future<Json> read(String scope);

  /// 原子合并，避免阅读位置写入覆盖在途请求或新草稿。
  Future<void> patch(String scope, Json values);
}

String experienceScope(
  String api,
  String? workspace,
  String experience,
  String branch,
) => jsonEncode([
  api,
  workspace == null ? ['unscoped-device-draft'] : ['workspace', workspace],
  experience,
  branch,
]);

class LocalExperienceJournal implements ExperienceJournal {
  // Keep the public injection parameter named database.
  // ignore: prefer_initializing_formals
  LocalExperienceJournal({Database? database}) : _database = database;
  Database? _database;
  final _records = stringMapStoreFactory.store('experience_local_v1');
  Future<Database> _db() async => _database ??= await openLocalDatabase();
  @override
  Future<Json> read(String scope) async => Map<String, dynamic>.from(
    await _records.record(scope).get(await _db()) ?? {},
  );
  @override
  Future<void> patch(String scope, Json values) async {
    final db = await _db();
    await db.transaction((txn) async {
      final record = _records.record(scope);
      final old = await record.get(txn) ?? <String, Object?>{};
      await record.put(txn, {...old, ...values});
    });
  }

  /// Export only this service/workspace's local presentation and drafts.
  Future<Json> exportWorkspace(String api, String workspace) async {
    final rows = await _records.find(await _db());
    final result = <String, dynamic>{};
    for (final row in rows) {
      final parts = jsonDecode(row.key);
      if (parts is List && parts.length == 4 && parts[0] == api &&
          jsonEncode(parts[1]) == jsonEncode(['workspace', workspace])) {
        // In-flight requests belong to the live process, never restore them.
        final value = Map<String, dynamic>.from(row.value);
        value.remove('pending');
        value.remove('request');
        value.remove('attempt');
        result[jsonEncode(parts.sublist(2))] = value;
      }
    }
    return result;
  }

  /// Import atomically without overwriting existing local records.
  static void validateWorkspaceBackup(Json data) {
    if(data.length>20000)throw const FormatException('备份记录过多');
    bool bad(Object? value, bool Function(Object) valid)=>value!=null&&!valid(value);
    for(final entry in data.entries){
      final parts=jsonDecode(entry.key);
      if(parts is! List||parts.length!=2||parts.any((p)=>p is! String)||entry.value is! Map)throw const FormatException('本机记录格式无效');
      final row=Map<String,dynamic>.from(entry.value as Map);
      if (row['reading_request'] != null) {
        PendingReadingRequest(object(row['reading_request']));
      }
      if (row['reading_anchor'] != null &&
          ReaderReadingAnchor.parse(row['reading_anchor']) == null) {
        throw const FormatException('备份含有无效的阅读原文锚点');
      }
      if(bad(row['draft'],(v)=>parts[0]=='world-studio'?v is Map:v is String)||
        bad(row['draft_revision'],(v)=>v is int&&v>=0)||
        bad(row['mode'],(v)=>v is String&&['act','read','ask'].contains(v))||
        bad(row['font_size'],(v)=>v is num&&v.isFinite)||bad(row['offset'],(v)=>v is num&&v.isFinite&&v>=0)||
        bad(row['last_view'],(v)=>v is Map&&v['id'] is String&&v['branch'] is String)||
        bad(row['versions'],(v)=>v is List&&v.every((e)=>e is Map&&e['snapshot'] is Map&&e['version'] is int))||
        bad(row['personal'],(v)=>v is Map&&v.values.every((e)=>e is Map))||
        bad(row['reader_personal'],(v)=>v is Map))throw const FormatException('备份含有无效的草稿或阅读记录');
      final personal=row['reader_personal'];
      if(personal is Map){
        if(bad(personal['followed'],(v)=>v is List&&v.every((e)=>e is String))||
          bad(personal['page'],(v)=>v is num&&v.isFinite&&v>=0)||bad(personal['participation'],(v)=>v is String))throw const FormatException('阅读标记格式无效');
        for(final key in ['entries','references']){
          if(bad(personal[key],(v)=>v is List&&v.every((e)=>e is Map&&e['revision'] is int&&e['quote'] is String&&
            (key!='entries'||e['id'] is String&&e['kind'] is String&&e['text'] is String))))throw const FormatException('笔记或引用格式无效');
        }
      }
    }
  }
  Future<void> importWorkspace(String api, String workspace, Json data) async {
    validateWorkspaceBackup(data);
    final validated = <String, Json>{};
    for (final entry in data.entries) {
      final parts = jsonDecode(entry.key);
      if (parts is! List || parts.length != 2 || parts.any((v) => v is! String) || entry.value is! Map) {
        throw const FormatException('备份中的本机记录格式无效');
      }
      final value = Map<String, dynamic>.from(entry.value as Map)..remove('pending')..remove('request')..remove('attempt');
      validated[experienceScope(api, workspace, parts[0] as String, parts[1] as String)] = value;
    }
    final db = await _db();
    await db.transaction((txn) async {
      for (final entry in validated.entries) {
        final record = _records.record(entry.key);
        final old = await record.get(txn);
        if (old == null) { await record.put(txn, entry.value); continue; }
        final parts = jsonDecode(entry.key) as List;
        final combined = <String, dynamic>{...entry.value, ...old};
        if (parts[2] == 'world-studio' && parts[3] == 'catalog') {
          final current = (old['versions'] as List? ?? []).whereType<Map>().toList();
          final incoming = (entry.value['versions'] as List? ?? []).whereType<Map>();
          String id(Map item) => '${(item['snapshot'] as Map?)?['id']}:${item['version']}';
          final seen = current.map(id).toSet();
          combined['versions'] = [...current, for (final version in incoming) if (seen.add(id(version))) version];
        }
        if (parts[2] == 'library' && parts[3] == 'personal-v1') {
          combined['personal'] = {...?entry.value['personal'] as Map?, ...?old['personal'] as Map?};
        }
        await record.put(txn, combined);
      }
    });
  }
}
