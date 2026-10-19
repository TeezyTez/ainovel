import 'package:flutter/services.dart';
Future<String?> pickPortalBackup() async => null;
Future<void> savePortalFile(String name, String contents, {String mime = 'application/json'}) => Clipboard.setData(ClipboardData(text: contents));
