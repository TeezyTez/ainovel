import 'package:flutter/services.dart';

Future<bool> exportPortalText(
  String name,
  String content,
  String mimeType,
) async {
  await Clipboard.setData(ClipboardData(text: content));
  return false;
}
