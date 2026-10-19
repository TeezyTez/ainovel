import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:elselife_frontend/experience/experience_client.dart';
import '../support/experience_fixture.dart';

void main() {
  test(
    'plain JSON endpoints preserve DTO, Unicode, CAS, no auth or retry',
    () async {
      final seen = <http.Request>[];
      var base = 'http://127.0.0.1:18081';
      final c = ExperienceClient(
        baseUrl: () => base,
        client: MockClient((r) async {
          seen.add(r);
          expect(r.headers.containsKey('authorization'), isFalse);
          expect(r.url.path.contains('cipher'), isFalse);
          Object payload;
          if (r.url.path == '/v1/experiences' && r.method == 'GET') {
            payload = {'experiences': []};
          } else if (r.url.path.startsWith('/v1/experience-preferences')) {
            payload = r.url.path.endsWith('/interpret')
                ? {'candidates': []}
                : {'preferences': []};
          } else if (r.url.path.startsWith('/v1/experience-requests')) {
            payload = {'request_id': 'r /中', 'kind': 'create'};
          } else if (r.url.path.contains('/operations')) {
            payload = testOperation('r /中');
          } else {
            payload = testView(id: 'e /中');
          }
          return http.Response(
            jsonEncode(payload),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      addTearDown(c.close);
      expect(await c.list(), isEmpty);
      await c.view('e /中', branch: 'main');
      expect(seen.last.url.queryParameters, {'branch_id': 'main'});
      expect(seen.last.url.pathSegments.last, 'e /中');
      await c.create({'seed': '雨后', 'request_id': 'stable'});
      expect(jsonDecode(seen.last.body), {
        'seed': '雨后',
        'request_id': 'stable',
      });
      expect(seen.last.method, 'POST');
      await c.branch('e /中', {'from_revision': 1});
      expect(seen.last.url.pathSegments.last, 'branches');
      await c.submit('e /中', {'mode': 'read', 'input': ''});
      expect(seen.last.url.pathSegments.last, 'operations');
      await c.operation('e /中', 'r /中');
      expect(seen.last.method, 'GET');
      expect(seen.last.url.pathSegments.last, 'r /中');
      await c.cancel('e /中', 'r /中');
      expect(seen.last.url.pathSegments.last, 'cancel');
      expect(jsonDecode(seen.last.body), isEmpty);
      await c.receipt('r /中');
      expect(seen.last.url.pathSegments, ['v1', 'experience-requests', 'r /中']);
      await c.preferences();
      final change = {
        'dimension': '节奏',
        'value': '慢',
        'expected': {'version': 'v1'},
      };
      await c.changePreference(change);
      expect(seen.last.method, 'PUT');
      expect(jsonDecode(seen.last.body), change);
      await c.interpretFeedback('我的原文');
      expect(jsonDecode(seen.last.body), {'text': '我的原文'});
      base = 'http://localhost:18081';
      await c.list();
      expect(seen.last.url.host, 'localhost');
      expect(seen, hasLength(12));
    },
  );
  test(
    'structured rejection retains status/code/message; does not retry',
    () async {
      var calls = 0;
      final c = ExperienceClient(
        baseUrl: () => 'http://localhost',
        client: MockClient((_) async {
          calls++;
          return http.Response(
            jsonEncode({
              'error': {'code': 'preference_conflict', 'message': 'conflict'},
            }),
            409,
          );
        }),
      );
      addTearDown(c.close);
      await expectLater(
        c.changePreference({}),
        throwsA(
          isA<ExperienceHttpException>()
              .having((e) => e.status, 'status', 409)
              .having((e) => e.code, 'code', 'preference_conflict')
              .having((e) => e.message, 'message', 'conflict'),
        ),
      );
      expect(calls, 1);
    },
  );
  test(
    'malformed success and wrong branch never become a valid view',
    () async {
      for (final payload in [
        'not-json',
        '[]',
        jsonEncode(testView(branch: 'other')),
      ]) {
        final c = ExperienceClient(
          baseUrl: () => 'http://localhost',
          client: MockClient(
            (_) async => http.Response.bytes(utf8.encode(payload), 200),
          ),
        );
        await expectLater(
          c.view('experience-a', branch: 'main'),
          throwsFormatException,
        );
        c.close();
      }
    },
  );
  test(
    'non-JSON HTTP error retains status; timeout remains unknown, no retry',
    () async {
      final c = ExperienceClient(
        baseUrl: () => 'http://localhost',
        client: MockClient((_) async => http.Response('unavailable', 503)),
      );
      await expectLater(
        c.list(),
        throwsA(
          isA<ExperienceHttpException>().having((e) => e.status, 'status', 503),
        ),
      );
      c.close();
      var calls = 0;
      final slow = ExperienceClient(
        baseUrl: () => 'http://localhost',
        timeout: const Duration(milliseconds: 1),
        client: MockClient((_) {
          calls++;
          return Completer<http.Response>().future;
        }),
      );
      await expectLater(
        slow.create({'request_id': 'stable'}),
        throwsA(isA<TimeoutException>()),
      );
      expect(calls, 1);
      slow.close();
    },
  );
}
