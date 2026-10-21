/// Plain JSON HTTP only. No authentication, encryption, retries or client model.
library;

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'experience_models.dart';

abstract class ExperienceApi {
  Future<List<ExperienceSummary>> list();
  Future<ExperienceView> view(String id, {String? branch});
  Future<ExperienceView> create(Json body);
  Future<ExperienceView> branch(String id, Json body);
  Future<ExperienceOperation> submit(String id, Json body);
  Future<ExperienceOperation> operation(String id, String requestId);
  Future<ExperienceOperation> cancel(String id, String requestId);
  Future<Json> receipt(String requestId);
  Future<List<ContentPreference>> preferences();
  Future<List<ContentPreference>> changePreference(Json change);
  Future<Json> interpretFeedback(String text);
}

/// Optional formal structured-action transport. Local scripted APIs intentionally
/// do not implement it; all recovery still uses the ordinary operation ledger.
abstract interface class ExperienceArtifactApi {
  Future<ExperienceOperation> executeArtifact(
    String id,
    String artifactId,
    Json body,
  );
}

/// Optional, read-only hint. Scripted/offline APIs need not implement it.
abstract interface class ExperiencePreparationApi {
  Future<ExperiencePreparation> preparation(
    String id,
    String branch,
    int revision,
  );
}

class ExperienceHttpException implements Exception {
  const ExperienceHttpException(this.message, {this.status, this.code});
  final String message;
  final int? status;
  final String? code;
  @override
  String toString() => message;
}

class ExperienceClient
    implements ExperienceApi, ExperienceArtifactApi, ExperiencePreparationApi {
  ExperienceClient({
    required this.baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 30),
  }) : _http = client ?? http.Client();
  final String Function() baseUrl;
  final http.Client _http;
  final Duration timeout;
  void close() => _http.close();
  String _id(String value) => Uri.encodeComponent(value);
  Future<Json> _request(
    String method,
    String path, {
    Json? body,
    Map<String, String>? query,
  }) async {
    final base = baseUrl().replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base$path').replace(queryParameters: query);
    final request = http.Request(method, uri)
      ..headers['Accept'] = 'application/json';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(
      await _http.send(request).timeout(timeout),
    ).timeout(timeout);
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      if (response.statusCode >= 200 && response.statusCode < 300) rethrow;
      throw ExperienceHttpException(
        'HTTP ${response.statusCode}',
        status: response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded is Map ? decoded['error'] : null;
      throw ExperienceHttpException(
        error is Map
            ? '${error['message'] ?? 'HTTP ${response.statusCode}'}'
            : 'HTTP ${response.statusCode}',
        status: response.statusCode,
        code: error is Map ? error['code'] as String? : null,
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('JSON object required');
    }
    return decoded;
  }

  @override
  Future<List<ExperienceSummary>> list() async => objects(
    (await _request('GET', '/v1/experiences'))['experiences'],
  ).map(ExperienceSummary.new).toList();
  @override
  Future<ExperienceView> view(String id, {String? branch}) async {
    final result = ExperienceView(
      await _request(
        'GET',
        '/v1/experiences/${_id(id)}',
        query: branch == null ? null : {'branch_id': branch},
      ),
    );
    if (result.id != id || branch != null && result.branchId != branch) {
      throw const FormatException('经历视图归属不符');
    }
    return result;
  }

  @override
  Future<ExperiencePreparation> preparation(
    String id,
    String branch,
    int revision,
  ) async {
    final result = ExperiencePreparation(
      await _request(
        'GET',
        '/v1/experiences/${_id(id)}/preparation',
        query: {'branch_id': branch, 'base_revision': '$revision'},
      ),
    );
    if (result.experienceId != id ||
        result.branchId != branch ||
        result.baseRevision != revision) {
      throw const FormatException('准备状态归属不符');
    }
    return result;
  }

  @override
  Future<ExperienceView> create(Json body) async =>
      ExperienceView(await _request('POST', '/v1/experiences', body: body));
  @override
  Future<ExperienceView> branch(String id, Json body) async => ExperienceView(
    await _request('POST', '/v1/experiences/${_id(id)}/branches', body: body),
  );
  @override
  Future<ExperienceOperation> submit(String id, Json body) async =>
      ExperienceOperation(
        await _request(
          'POST',
          '/v1/experiences/${_id(id)}/operations',
          body: body,
        ),
      );
  @override
  Future<ExperienceOperation> executeArtifact(
    String id,
    String artifactId,
    Json body,
  ) async {
    final response = await _request(
      'POST',
      '/v1/experiences/${_id(id)}/artifacts/${_id(artifactId)}/execute',
      body: body,
    );
    final operation = ExperienceOperation(response);
    if (operation.experienceId != id ||
        operation.branchId != body['branch_id'] ||
        operation.requestId != body['request_id'] ||
        operation.baseRevision != body['expected_revision'])
      throw const FormatException('作品执行回应归属不符');
    return operation;
  }

  @override
  Future<ExperienceOperation> operation(String id, String requestId) async =>
      ExperienceOperation(
        await _request(
          'GET',
          '/v1/experiences/${_id(id)}/operations/${_id(requestId)}',
        ),
      );
  @override
  Future<ExperienceOperation> cancel(String id, String requestId) async =>
      ExperienceOperation(
        await _request(
          'POST',
          '/v1/experiences/${_id(id)}/operations/${_id(requestId)}/cancel',
          body: {},
        ),
      );
  @override
  Future<Json> receipt(String requestId) =>
      _request('GET', '/v1/experience-requests/${_id(requestId)}');
  @override
  Future<List<ContentPreference>> preferences() async => objects(
    (await _request('GET', '/v1/experience-preferences'))['preferences'],
  ).map(ContentPreference.new).toList();
  @override
  Future<List<ContentPreference>> changePreference(Json change) async =>
      objects(
        (await _request(
          'PUT',
          '/v1/experience-preferences',
          body: change,
        ))['preferences'],
      ).map(ContentPreference.new).toList();
  @override
  Future<Json> interpretFeedback(String text) => _request(
    'POST',
    '/v1/experience-preferences/interpret',
    body: {'text': text},
  );
}
