// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:async';
import 'dart:html' as html;

Future<String?> pickPortalBackup() async {
  final input = html.FileUploadInputElement()..accept = '.json';
  final result = Completer<String?>();
  final change = input.onChange.listen((_) async {
    if (input.files?.isEmpty ?? true) { if (!result.isCompleted) result.complete(null); return; }
    final file = input.files!.first;
    if (file.size > 64 * 1024 * 1024) { result.completeError(const FormatException('备份文件不能超过 64 MB')); return; }
    final reader = html.FileReader()..readAsText(file);
    await reader.onLoadEnd.first;
    if (!result.isCompleted) {
      if (reader.error != null) { result.completeError(const FormatException('文件读取失败')); }
      else { result.complete(reader.result as String?); }
    }
  });
  final cancel = input.on['cancel'].listen((_) { if (!result.isCompleted) result.complete(null); });
  input.click();
  try { return await result.future; } finally { await change.cancel(); await cancel.cancel(); input.remove(); }
}
Future<void> savePortalFile(String name, String contents, {String mime = 'application/json'}) async {
  final url = html.Url.createObjectUrlFromBlob(html.Blob([contents], '$mime;charset=utf-8'));
  final anchor = html.AnchorElement(href: url)..download = name;
  anchor.click();
  Timer(const Duration(seconds: 1), () { html.Url.revokeObjectUrl(url); anchor.remove(); });
}
