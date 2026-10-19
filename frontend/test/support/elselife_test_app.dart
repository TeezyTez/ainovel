/// 【文件职责】测试壳：注入 AppL10n delegate，默认 zh。
/// 【边界】只给 widget 测试用。裸 MaterialApp 没有 ElseLife 文案。
/// 【路径】test/support/elselife_test_app.dart
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/ui/theme/elselife_theme.dart';

/// 与 `app_shell.dart` 同一套 delegate。
const List<LocalizationsDelegate<dynamic>> kElseLifeTestDelegates =
    <LocalizationsDelegate<dynamic>>[
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ];

/// 带 ElseLife 文案与默认 paper 主题的 MaterialApp。
Widget elseLifeTestApp({
  required Widget home,
  ThemeData? theme,
  Locale locale = const Locale('zh'),
}) {
  return MaterialApp(
    theme: theme ?? elseLifeThemeData(ElseLifeThemeId.paper),
    locale: locale,
    supportedLocales: const [Locale('zh')],
    localizationsDelegates: kElseLifeTestDelegates,
    home: home,
  );
}

/// 先装壳再多泵一帧：LocalizationsDelegate.load 是 async，首帧 home 可能还没挂上。
Future<void> pumpElseLife(
  WidgetTester tester, {
  required Widget home,
  ThemeData? theme,
  Locale locale = const Locale('zh'),
}) async {
  await tester.pumpWidget(
    elseLifeTestApp(home: home, theme: theme, locale: locale),
  );
  await tester.pump();
}
