/// 【文件职责】Web 平台数据库实现：IndexedDB（origin 私有）。
/// 【边界】只在 Web 环境编译；IO 用 store_platform_io.dart。
/// 【路径】lib/data/store/store_platform_web.dart
library;

import 'package:sembast_web/sembast_web.dart';

/// 打开 Web 数据库（IndexedDB 库名）。
Future<Database> openPlatformDatabase(String name) =>
    databaseFactoryWeb.openDatabase(name);
