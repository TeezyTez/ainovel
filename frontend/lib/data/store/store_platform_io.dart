/// 【文件职责】IO 平台数据库实现：app 支持目录下的 Sembast 文件。
/// 【边界】只在 dart:io 环境（移动/桌面）编译；Web 用 store_platform_web.dart。
/// 【路径】lib/data/store/store_platform_io.dart
library;

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sembast/sembast_io.dart';

/// 打开 IO 数据库（文件）。name 是库名，落成 `<name>.db`。
Future<Database> openPlatformDatabase(String name) async {
  final dir = await getApplicationSupportDirectory();
  return databaseFactoryIo.openDatabase(p.join(dir.path, '$name.db'));
}
