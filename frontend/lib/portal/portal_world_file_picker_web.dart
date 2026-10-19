// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:html' as html;

import 'portal_world_import_file.dart';

Future<PortalWorldImportFile?> pickPortalWorldFile() async {
  final input = html.FileUploadInputElement()..accept = '.txt,.md,.json';
  input.click();
  final change = await input.onChange.first;
  if (change.target == null || input.files == null || input.files!.isEmpty) {
    return null;
  }
  final file = input.files!.first;
  if (file.size > 360000) {
    throw const FormatException('文件过大，请选择 120 KB 以内的文字资料。');
  }
  final reader = html.FileReader()..readAsText(file);
  await reader.onLoadEnd.first;
  if (reader.error != null || reader.result is! String) {
    throw const FormatException('文件读取失败，原草稿未改变。');
  }
  return PortalWorldImportFile(file.name, reader.result as String);
}
