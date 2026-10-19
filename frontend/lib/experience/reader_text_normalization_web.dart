import 'dart:js_interop';

extension type _SourceString(JSString value) implements JSString {
  external JSString normalize(String form);
  external JSString toLocaleLowerCase();
}
String readerNormalizeName(String value) => _SourceString(
  _SourceString(
    value.toJS,
  ).normalize('NFKC').toDart.trim().replaceAll(RegExp(r'\s+'), ' ').toJS,
).toLocaleLowerCase().toDart;
