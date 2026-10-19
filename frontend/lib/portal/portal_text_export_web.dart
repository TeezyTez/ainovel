// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:convert';
import 'dart:html' as html;

Future<bool> exportPortalText(
  String name,
  String content,
  String mimeType,
) async {
  final blob = html.Blob([utf8.encode(content)], mimeType);
  final url = html.Url.createObjectUrlFromBlob(blob);
  final link = html.AnchorElement(href: url)..download = name;
  link.click();
  html.Url.revokeObjectUrl(url);
  return true;
}
