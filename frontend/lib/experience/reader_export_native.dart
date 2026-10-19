import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

Future<String> exportReaderFile(String name, String text, String mime) async {
  final dir = await getApplicationDocumentsDirectory();
  final file = File(path.join(dir.path, name));
  await file.writeAsString(text, flush: true);
  return '已导出到 ${file.path}';
}
