// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;

Future<String> exportReaderFile(String name, String text, String mime) async {
  final url = html.Url.createObjectUrlFromBlob(
    html.Blob([text], '$mime;charset=utf-8'),
  );
  final link = html.AnchorElement(href: url)..download = name;
  html.document.body?.append(link);
  link.click();
  link.remove();
  // Allow the browser to consume the blob before releasing it.
  Future<void>.delayed(
    const Duration(seconds: 1),
    () => html.Url.revokeObjectUrl(url),
  );
  return '已导出 $name';
}
