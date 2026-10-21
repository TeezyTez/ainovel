import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import '../experience/experience_models.dart';
import 'portal_world_studio_data.dart';

/// Product utilities; formal history remains owned by the Go service.
class PortalServiceClient {
  PortalServiceClient(this.baseUrl, {http.Client? client}) : _client = client ?? http.Client();
  final String Function() baseUrl;
  final http.Client _client;
  Completer<void>? _generation;
  Completer<void>? _assistance;
  Future<Json> request(String method, String path, [Json? data, Future<void>? abort]) async {
    final request = http.AbortableRequest(method, Uri.parse('${baseUrl().replaceFirst(RegExp(r'/$'), '')}$path'), abortTrigger: abort);
    if (data != null) { request.headers['Content-Type'] = 'application/json'; request.body = jsonEncode(data); }
    final response = await (() async => http.Response.fromStream(await _client.send(request)))().timeout(const Duration(minutes: 3));
    if (response.statusCode == 204) return {};
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(decoded is Map ? '${decoded['error'] ?? '请求失败'}' : '请求失败');
    }
    return Map<String, dynamic>.from(decoded as Map);
  }
  Future<Json> modelStatus() => request('GET', '/v1/model-status');
  Future<void> delete(String id) async => request('DELETE', '/v1/experiences/${Uri.encodeComponent(id)}');
  Future<PortalWorldDraft> generate(String idea) async {
    cancelGeneration();
    final generation = Completer<void>();
    _generation = generation;
    try {
      final result = await request('POST', '/v1/world-drafts/generate', {'request_id': const Uuid().v4(), 'idea': idea}, generation.future);
      if (generation.isCompleted) throw http.RequestAbortedException();
      return PortalWorldDraft.fromJson(result['world']);
    } finally {
      if (identical(_generation, generation)) _generation = null;
    }
  }
  void cancelGeneration() {
    final generation = _generation;
    if (generation != null && !generation.isCompleted) generation.complete();
    _generation = null;
  }
  Future<Json> assist(String id, Json data) async {
    cancelAssistance();
    final cancellation=Completer<void>();
    _assistance=cancellation;
    try {
      final result=await request('POST','/v1/experiences/${Uri.encodeComponent(id)}/assist',{'request_id':const Uuid().v4(),...data},cancellation.future);
      if(cancellation.isCompleted)throw http.RequestAbortedException();
      return result;
    } finally {
      if(identical(_assistance,cancellation))_assistance=null;
    }
  }
  void cancelAssistance(){
    final cancellation=_assistance;
    if(cancellation!=null&&!cancellation.isCompleted)cancellation.complete();
    _assistance=null;
  }
  Future<Json> exportRecords() => request('GET', '/v1/archive');
  Future<Json> exportReaderRecords() async {
    final value = await request('GET', '/v1/reader-export');
    if (value['format'] != 'elselife-reader-export' ||
        value['version'] != 1 || value['experiences'] is! List) {
      throw const FormatException('读者导出格式不符，未保存文件。');
    }
    return value;
  }
  Future<Json> importRecords(Json archive) => request('POST', '/v1/archive', archive);
  void close() { cancelGeneration(); cancelAssistance(); _client.close(); }
}
