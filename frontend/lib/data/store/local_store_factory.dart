/// 【文件职责】本地存储入口：条件导入分派 IO / Web 实现，单例数据库。
/// 【边界】只暴露 openLocalDatabase + 库名；不定义业务 schema（各 store 自持）。
/// 【路径】lib/data/store/local_store_factory.dart
/// 【注释】Web 走 IndexedDB（全浏览器），非 Web 走 app 目录文件。刷新/关 tab 后
///         数据仍在本设备，这是「人性化服务」的地基。
library;

import 'package:sembast/sembast.dart';
import 'store_platform_io.dart'
    if (dart.library.js_interop) 'store_platform_web.dart';

/// 数据库名（Web 是 IndexedDB 库名，IO 是文件名主体）。
const String kLocalDbName = 'elselife_product_workspace_v1';

/// 打开（或创建）本地数据库。
Future<Database> openLocalDatabase() => openPlatformDatabase(kLocalDbName);
