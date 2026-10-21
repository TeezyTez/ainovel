import 'dart:async';
import 'package:elselife_frontend/portal/portal_service_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main(){
 test('reader export never requests the private migration archive', () async {
   final client = PortalServiceClient(() => 'http://localhost', client: MockClient((request) async {
     expect(request.method, 'GET');
     expect(request.url.path, '/v1/reader-export');
     return http.Response('{"format":"elselife-reader-export","version":1,"experiences":[]}', 200);
   }));
   expect((await client.exportReaderRecords())['experiences'], isEmpty);
   client.close();
 });
 test('reader export rejects a private archive response instead of downloading it', () async {
   final client = PortalServiceClient(() => 'http://localhost', client: MockClient((request) async =>
     http.Response('{"format":"elselife-archive","version":1,"experiences":[]}', 200)));
   await expectLater(client.exportReaderRecords(), throwsFormatException);
   client.close();
 });
 test('cancel aborts only generation and client remains usable',()async{
   final transport=_AbortClient();
   final client=PortalServiceClient(()=>'http://localhost',client:transport);
   final result=client.generate('一个小镇');
   final failure=expectLater(result,throwsA(isA<http.RequestAbortedException>()));
   await transport.started.future;
   client.cancelGeneration();
   await failure;
   expect(await client.modelStatus(),{'available':true});
   client.close();
 });
 test('delete accepts server 204 and escapes experience id',()async{
   final client=PortalServiceClient(()=>'http://localhost',client:MockClient((request)async{
     expect(request.method,'DELETE');expect(request.url.pathSegments.last,'id/one');return http.Response('',204);
   }));
   await client.delete('id/one');client.close();
 });
 test('model unavailable remains error without a fabricated draft',()async{
   var calls=0;
   final client=PortalServiceClient(()=>'http://localhost',client:MockClient((request)async{
     calls++;return http.Response('{"error":{"code":"model_unavailable"}}',503);
   }));
   await expectLater(client.generate('一个小镇'),throwsStateError);expect(calls,1);client.close();
 });
}

class _AbortClient extends http.BaseClient {
 final started=Completer<void>();
 @override Future<http.StreamedResponse> send(http.BaseRequest request)async{
  if(request.url.path=='/v1/model-status')return http.StreamedResponse(Stream.value('{"available":true}'.codeUnits),200);
  expect(request,isA<http.Abortable>());
  final abort=(request as http.Abortable).abortTrigger;
  expect(abort,isNotNull);
  started.complete();
  await abort;
  throw http.RequestAbortedException(request.url);
 }
}
