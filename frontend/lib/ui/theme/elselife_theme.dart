/// 【文件职责】ElseLife 统一空间主题：雾面底、承托面、内容纸面与紫色动作。
/// 【边界】只被 UI 读取；不依赖屏幕或网络。
/// 【路径】lib/ui/theme/elselife_theme.dart
/// 【注释】三种光色共用材料、几何、字体与运动；工作页收束展示强度。
///         默认 mist；保留 paper / ink / studio 与显式历史偏好。
library;

import 'package:flutter/material.dart';
import '../motion/elselife_animated_surface.dart';
import '../motion/elselife_route_motion.dart';

/// 主题开关。id 与门页 data-theme 同名，无偏好时默认 mist。
enum ElseLifeThemeId { studio, ink, paper, mist }

/// 主题 id 字符串 ↔ 枚举（持久化用）。未知值回默认 mist，保留旧别名。
ElseLifeThemeId themeIdFromString(String? v) {
  switch (v) {
    case 'ink':
    case 'glassArt':
      return ElseLifeThemeId.ink;
    case 'studio':
      return ElseLifeThemeId.studio;
    case 'mist':
      return ElseLifeThemeId.mist;
    case 'paper':
    case 'officialLight':
      return ElseLifeThemeId.paper;
    default:
      return ElseLifeThemeId.mist;
  }
}

String themeIdToString(ElseLifeThemeId id) => id.name;

/// 手动只会增加限制，不能覆盖系统减少动态；app 自有路由订阅同一有效偏好。
/// SDK 私有 Material 路由不读此 MediaQuery，须使用 ElseLife 的浮层入口。
class ElseLifeMotionScope extends StatelessWidget {
  const ElseLifeMotionScope({
    super.key,
    required this.reducedMotion,
    required this.child,
  });
  final bool reducedMotion;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.maybeOf(context) ?? const MediaQueryData();
    final effective = media.disableAnimations || reducedMotion;
    return ElseLifeRouteMotionBoundary(
      reduced: effective || media.accessibleNavigation,
      child: MediaQuery(
        data: media.copyWith(disableAnimations: effective),
        child: child,
      ),
    );
  }
}

/// 统一动效：动作立即生效，运动只是绘制反馈。
abstract final class ElseLifeMotion {
  /// One UI 基础曲线。禁止 Curves.easeOutCubic。
  static const Curve standard = Cubic(0.22, 1.0, 0.36, 1.0);
  static const Curve oneUiSettle = Cubic(0.14, 0.78, 0.08, 1.0);
  static const Curve oneUiEaseIn = Cubic(0.40, 0.0, 1.0, 1.0);
  static const Curve pressCurve = Cubic(0.20, 0.0, 0.0, 1.0);
  static const Curve release = standard;
  static const Curve panelCurve = standard;

  /// 不缩放文字；反馈时长统一，旧 scale 调用保持 1。
  static const double chipScalePressed = 1;
  static const Duration chip = Duration(milliseconds: 140);
  static const Duration releaseDuration = Duration(milliseconds: 160);
  static const Duration press = Duration(milliseconds: 140);
  static const Duration panel = Duration(milliseconds: 400);
  static const Duration pageDuration = Duration(milliseconds: 380);
  static const Duration theme = Duration(milliseconds: 500);

  /// 动效.md：纯透明度。禁止拿来做位移。
  static const Curve dissolve = Curves.linear;

  /// submitting → accepted：Composer 回收入轨。
  static const Duration orbitIn = Duration(milliseconds: 180);

  /// running → stale：去饱和 + 失联。无位移。
  static const Duration stale = Duration(milliseconds: 120);

  static bool reduceMotion(BuildContext context) {
    final mq = MediaQuery.maybeOf(context);
    return mq?.disableAnimations == true || mq?.accessibleNavigation == true;
  }

  /// prefers-reduced-motion：时长归零，状态差仍在。
  static Duration of(BuildContext context, Duration normal) {
    if (reduceMotion(context)) return Duration.zero;
    return normal;
  }

  static double hoverLift(ElseLifeThemeId id) => 0;
}

/// 单主题完整色板。地、承托、内容与动作使用同一套空间角色。
@immutable
class AuraPalette {
  const AuraPalette({
    required this.id,
    required this.bg,
    required this.bg2,
    required this.bg3,
    required this.ink,
    required this.ink2,
    required this.ink3,
    required this.line,
    required this.lineStrong,
    required this.accent,
    required this.accent2,
    required this.accentInk,
    required this.card,
    required this.cardLine,
    required this.danger,
    required this.success,
    required this.radius,
    required this.radiusLg,
    required this.brightness,
    required this.shadows,
    required this.glow,
    this.panelSurface,
  });

  final ElseLifeThemeId id;
  final Color bg;
  final Color bg2;
  final Color bg3;
  final Color ink;
  final Color ink2;
  final Color ink3;
  final Color line;
  final Color lineStrong;
  final Color accent;
  final Color accent2;
  final Color accentInk;
  final Color card;
  final Color cardLine;
  final Color danger;
  final Color success;
  final double radius;
  final double radiusLg;
  final Brightness brightness;
  final List<BoxShadow> shadows;
  final List<BoxShadow> glow;

  // 卡片/输入/阅读区域与侧栏分离；既有主题继续使用 bg2。
  final Color? panelSurface;
  Color get surfaceLow => panelSurface ?? bg2;

  bool get isStudio => id == ElseLifeThemeId.studio;
  bool get isInk => id == ElseLifeThemeId.ink;
  bool get isPaper => id == ElseLifeThemeId.paper;
  bool get isMist => id == ElseLifeThemeId.mist;
  bool get isDark => brightness == Brightness.dark;

  BorderRadius get cardBorder => BorderRadius.circular(radius);

  OutlinedBorder get controlShape =>
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
}

/// 旧 studio id 保留，同样消费统一空间材料，不再拥有另一套几何。
const AuraPalette kStudioPalette = AuraPalette(
  id: ElseLifeThemeId.studio,
  bg: Color(0xFFF6F5F8),
  bg2: Color(0xFFEEEBF3),
  bg3: Color(0xFFE8E1F0),
  ink: Color(0xFF292533),
  ink2: Color(0xFF655D72),
  ink3: Color(0xFF766B83),
  line: Color(0xFFE0DCE7),
  lineStrong: Color(0xFFC4B7D6),
  accent: Color(0xFF7251B5),
  accent2: Color(0xFFDDEBBA),
  accentInk: Colors.white,
  card: Colors.white,
  cardLine: Color(0xFFE0DCE7),
  danger: Color(0xFFAD404D),
  success: Color(0xFF54715A),
  radius: 18,
  radiusLg: 24,
  brightness: Brightness.light,
  shadows: kLightSurfaceShadows,
  glow: [],
);

/// 深色通过层级明度和边缘保留材料，不靠发光补偿。
const AuraPalette kInkPalette = AuraPalette(
  id: ElseLifeThemeId.ink,
  bg: Color(0xFF18161E),
  bg2: Color(0xFF211D29),
  bg3: Color(0xFF30283E),
  ink: Color(0xFFF1ECF7),
  ink2: Color(0xFFAFA4C0),
  ink3: Color(0xFF9B90AC),
  line: Color(0xFF393341),
  lineStrong: Color(0xFF695677),
  accent: Color(0xFFBDA2EB),
  accent2: Color(0xFFDDEAAF),
  accentInk: Color(0xFF261A35),
  card: Color(0xFF25212D),
  cardLine: Color(0xFF393341),
  danger: Color(0xFFE58E9C),
  success: Color(0xFFADCCAF),
  radius: 18,
  radiusLg: 24,
  brightness: Brightness.dark,
  shadows: [
    BoxShadow(
      color: Color(0x38000000),
      blurRadius: 26,
      offset: Offset(0, 10),
      spreadRadius: -13,
    ),
    BoxShadow(color: Color(0x18000000), blurRadius: 3, offset: Offset(0, 1)),
  ],
  glow: [],
);

/// 纸色是光色变化；紫色动作和浅绿强调的职责不变。
const AuraPalette kPaperPalette = AuraPalette(
  id: ElseLifeThemeId.paper,
  bg: Color(0xFFF7F8F2),
  bg2: Color(0xFFF0F1E8),
  bg3: Color(0xFFE9ECD9),
  ink: Color(0xFF2B2E26),
  ink2: Color(0xFF666A59),
  ink3: Color(0xFF707461),
  line: Color(0xFFDEDFD2),
  lineStrong: Color(0xFFC5C8B5),
  accent: Color(0xFF6650A5),
  accent2: Color(0xFFDDEBAF),
  accentInk: Colors.white,
  card: Color(0xFFFFFFFB),
  cardLine: Color(0xFFDEDFD2),
  danger: Color(0xFFAA4147),
  success: Color(0xFF527359),
  radius: 18,
  radiusLg: 24,
  brightness: Brightness.light,
  shadows: kLightSurfaceShadows,
  glow: [],
);

const kMistShadow = Color(0x1439254D);
const kLightSurfaceShadows = <BoxShadow>[
  BoxShadow(
    color: kMistShadow,
    blurRadius: 26,
    offset: Offset(0, 10),
    spreadRadius: -13,
  ),
  BoxShadow(color: Color(0x0839254D), blurRadius: 3, offset: Offset(0, 1)),
];

/// 对照附件 spatial edition：雾面底、白纸面、紫动作、浅绿强调。
const AuraPalette kMistPalette = AuraPalette(
  id: ElseLifeThemeId.mist,
  bg: Color(0xFFF6F5F8),
  bg2: Color(0xFFEEEBF3),
  bg3: Color(0xFFE8E1F0),
  ink: Color(0xFF292533),
  ink2: Color(0xFF655D72),
  ink3: Color(0xFF766B83),
  line: Color(0xFFE0DCE7),
  lineStrong: Color(0xFFC4B7D6),
  accent: Color(0xFF7251B5),
  accent2: Color(0xFFDDEBBA),
  accentInk: Colors.white,
  card: Colors.white,
  cardLine: Color(0xFFE0DCE7),
  danger: Color(0xFFAD404D),
  success: Color(0xFF54715A),
  radius: 18,
  radiusLg: 24,
  brightness: Brightness.light,
  shadows: kLightSurfaceShadows,
  glow: [],
);

AuraPalette paletteOf(ElseLifeThemeId id) {
  switch (id) {
    case ElseLifeThemeId.ink:
      return kInkPalette;
    case ElseLifeThemeId.paper:
      return kPaperPalette;
    case ElseLifeThemeId.studio:
      return kStudioPalette;
    case ElseLifeThemeId.mist:
      return kMistPalette;
  }
}

/// 两种颜色里较亮的比上较暗的。雾紫测试用同一条，门槛 4.5。
double elseLifeContrast(Color a, Color b) {
  final l1 = a.computeLuminance();
  final l2 = b.computeLuminance();
  final hi = l1 > l2 ? l1 : l2;
  final lo = l1 > l2 ? l2 : l1;
  return (hi + .05) / (lo + .05);
}

/// 半透明色盖在底上之后的实色。对比按看见的结果算，不按未合成的色值。
Color elseLifeOver(Color fg, Color bg) {
  final a = fg.a;
  return Color.from(
    alpha: 1,
    red: fg.r * a + bg.r * (1 - a),
    green: fg.g * a + bg.g * (1 - a),
    blue: fg.b * a + bg.b * (1 - a),
  );
}

/// 字色在 ink 与 accentInk 里取能读清的那个。两个都过 4.5 时取对比更高的。
Color elseLifeLegibleOn(Color fill, Color ink, Color accentInk) {
  final onInk = elseLifeContrast(ink, fill);
  final onAccent = elseLifeContrast(accentInk, fill);
  if (onInk >= 4.5 && onInk >= onAccent) return ink;
  if (onAccent >= 4.5) return accentInk;
  return onInk >= onAccent ? ink : accentInk;
}

Widget _buttonMaterialFeedback(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) {
  final c = ElseLifeChrome.of(context);
  final pressed = states.contains(WidgetState.pressed);
  final disabled = states.contains(WidgetState.disabled);
  return ElseLifeAnimatedSurface(
    duration: pressed
        ? const Duration(milliseconds: 40)
        : ElseLifeMotion.releaseDuration,
    decoration: BoxDecoration(
      color: c.accent.withValues(
        alpha: disabled
            ? 0
            : pressed
            ? .12
            : states.contains(WidgetState.hovered)
            ? .06
            : 0,
      ),
      borderRadius: BorderRadius.circular(12),
    ),
    child: child,
  );
}

/// 把色板编成 ThemeData。不用 Material fromSeed 紫。
ThemeData elseLifeThemeData(ElseLifeThemeId id) {
  final p = paletteOf(id);
  const controlSize = Size(44, 44);
  const controlPadding = EdgeInsets.symmetric(horizontal: 18, vertical: 12);
  final scheme = ColorScheme(
    brightness: p.brightness,
    primary: p.accent,
    onPrimary: p.accentInk,
    primaryContainer: p.isMist
        ? p.bg3
        : Color.alphaBlend(p.accent.withValues(alpha: 0.10), p.bg),
    onPrimaryContainer: p.isMist ? p.ink : p.accent,
    secondary: p.accent2,
    onSecondary: p.isDark ? p.bg : p.ink,
    secondaryContainer: p.bg3,
    onSecondaryContainer: p.ink,
    error: p.danger,
    onError: p.isDark ? p.bg : Colors.white,
    surface: p.card,
    onSurface: p.ink,
    onSurfaceVariant: p.ink2,
    surfaceContainerLowest: p.bg,
    surfaceContainerLow: p.surfaceLow,
    surfaceContainer: p.card,
    surfaceContainerHigh: p.bg3,
    surfaceContainerHighest: p.bg3,
    outline: p.line,
    outlineVariant: p.cardLine,
    surfaceTint: Colors.transparent,
    inverseSurface: p.ink,
    onInverseSurface: p.bg,
  );
  final label = TextStyle(
    fontFamily: 'NotoSansSC',
    fontFamilyFallback: const ['NotoSansSC'],
    fontSize: 14,
    height: 1.5,
    fontWeight: FontWeight.w500,
  );
  final buttonLabel = label.copyWith(
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
  );
  final buttonColor = p.accent;
  OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: color, width: width),
      );
  final panelShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(p.radiusLg),
    side: BorderSide(color: p.line),
  );
  return ThemeData(
    useMaterial3: true,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    brightness: p.brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bg,
    canvasColor: p.bg,
    shadowColor: p.isMist ? kMistShadow : null,
    dividerColor: p.line,
    fontFamily: 'NotoSansSC',
    fontFamilyFallback: const ['NotoSansSC'],
    appBarTheme: AppBarTheme(
      backgroundColor: p.bg,
      foregroundColor: p.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: label.copyWith(
        color: p.ink,
        fontSize: 16,
        fontWeight: FontWeight.w600,
      ),
    ),
    textTheme: TextTheme(
      headlineMedium: TextStyle(
        fontSize: 27,
        fontWeight: FontWeight.w600,
        color: p.ink,
        height: 1.35,
        letterSpacing: 0,
      ),
      titleMedium: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: p.ink,
        height: 1.4,
      ),
      titleLarge: TextStyle(
        fontSize: 22,
        color: p.ink,
        height: 1.4,
        fontWeight: FontWeight.w600,
      ),
      labelLarge: buttonLabel.copyWith(color: p.ink),
      labelMedium: label.copyWith(color: p.ink2, fontSize: 12),
      bodyLarge: TextStyle(fontSize: 16, color: p.ink, height: 1.65),
      bodyMedium: TextStyle(fontSize: 14, color: p.ink, height: 1.65),
      bodySmall: TextStyle(fontSize: 12, color: p.ink2, height: 1.5),
      labelSmall: TextStyle(
        fontSize: 12,
        letterSpacing: 0,
        color: p.ink3,
        height: 1.4,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style:
          FilledButton.styleFrom(
            backgroundColor: buttonColor,
            foregroundColor: p.accentInk,
            disabledBackgroundColor: p.bg3,
            disabledForegroundColor: p.ink3,
            minimumSize: controlSize,
            elevation: 0,
            shadowColor: Colors.transparent,
            padding: controlPadding,
            textStyle: buttonLabel,
            shape: p.controlShape,
          ).copyWith(
            animationDuration: Duration.zero,
            overlayColor: const WidgetStatePropertyAll(Colors.transparent),
            side: WidgetStateProperty.resolveWith(
              (states) => BorderSide(
                color: states.contains(WidgetState.focused)
                    ? p.accent
                    : Colors.transparent,
                width: 2,
              ),
            ),
            // 保留原生按钮的键盘、禁用与语义，只对局部阴影做 One UI 过渡。
            backgroundBuilder: (context, states, child) {
              final disabled = states.contains(WidgetState.disabled);
              final pressed = states.contains(WidgetState.pressed);
              return ElseLifeAnimatedSurface(
                duration: Duration(milliseconds: pressed ? 40 : 175),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(
                    alpha: disabled
                        ? 0
                        : pressed
                        ? .12
                        : states.contains(WidgetState.hovered)
                        ? .05
                        : 0,
                  ),
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: disabled
                      ? const []
                      : [
                          BoxShadow(
                            // 底色由原生 Material 绘制；阴影不能覆盖白色按钮内部。
                            blurStyle: BlurStyle.outer,
                            color: Colors.black.withValues(
                              alpha: p.isDark ? .24 : .12,
                            ),
                            blurRadius: pressed ? 0 : 2,
                            offset: Offset(0, pressed ? 0 : 1),
                            spreadRadius: 0,
                          ),
                        ],
                ),
                child: child,
              );
            },
          ),
    ),
    textButtonTheme: TextButtonThemeData(
      style:
          TextButton.styleFrom(
            foregroundColor: p.accent,
            disabledForegroundColor: p.ink3,
            minimumSize: controlSize,
            padding: controlPadding,
            textStyle: buttonLabel,
            shape: p.controlShape,
          ).copyWith(
            animationDuration: Duration.zero,
            overlayColor: const WidgetStatePropertyAll(Colors.transparent),
            backgroundBuilder: _buttonMaterialFeedback,
            side: WidgetStateProperty.resolveWith(
              (states) => BorderSide(
                color: states.contains(WidgetState.focused)
                    ? p.accent
                    : Colors.transparent,
                width: 2,
              ),
            ),
          ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style:
          OutlinedButton.styleFrom(
            foregroundColor: p.ink,
            backgroundColor: p.card,
            disabledForegroundColor: p.ink3,
            disabledBackgroundColor: p.bg2,
            minimumSize: controlSize,
            shape: p.controlShape,
            textStyle: buttonLabel,
            padding: controlPadding,
          ).copyWith(
            animationDuration: Duration.zero,
            overlayColor: const WidgetStatePropertyAll(Colors.transparent),
            backgroundBuilder: _buttonMaterialFeedback,
            side: WidgetStateProperty.resolveWith(
              (states) => BorderSide(
                color: states.contains(WidgetState.disabled)
                    ? p.line
                    : states.contains(WidgetState.focused)
                    ? p.accent
                    : p.lineStrong,
                width: states.contains(WidgetState.focused) ? 2 : 1,
              ),
            ),
          ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.card,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      labelStyle: TextStyle(color: p.ink2, fontSize: 14),
      floatingLabelStyle: WidgetStateTextStyle.resolveWith(
        (states) => TextStyle(
          color: states.contains(WidgetState.error) ? p.danger : p.accent,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
      hintStyle: TextStyle(color: p.ink3, fontSize: 14),
      errorStyle: TextStyle(color: p.danger, height: 1.5, fontSize: 12),
      helperStyle: TextStyle(color: p.ink2, height: 1.5, fontSize: 12),
      errorMaxLines: 3,
      border: inputBorder(p.line),
      enabledBorder: inputBorder(p.line),
      disabledBorder: inputBorder(p.line.withValues(alpha: .65)),
      focusedBorder: inputBorder(p.accent, 1.5),
      errorBorder: inputBorder(p.danger),
      focusedErrorBorder: inputBorder(p.danger, 1.5),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: p.bg2,
      selectedColor: scheme.primaryContainer,
      labelStyle: label.copyWith(color: p.ink2, fontSize: 13),
      secondaryLabelStyle: label.copyWith(
        color: p.isMist ? p.ink : p.accent,
        fontSize: 13,
      ),
      checkmarkColor: p.accent,
      shape: const StadiumBorder(),
      side: BorderSide(color: p.line),
    ),
    cardTheme: CardThemeData(
      color: p.card,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: p.cardBorder,
        side: BorderSide(color: p.cardLine),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      shape: panelShape,
      titleTextStyle: label.copyWith(
        color: p.ink,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.card,
      modalBackgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(p.radiusLg)),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: p.card,
      surfaceTintColor: Colors.transparent,
      textStyle: label.copyWith(color: p.ink),
      shape: panelShape,
    ),
    drawerTheme: DrawerThemeData(
      backgroundColor: p.bg2,
      surfaceTintColor: Colors.transparent,
      shape: panelShape,
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: p.accent,
      unselectedLabelColor: p.ink2,
      indicatorColor: p.accent,
      dividerColor: p.line,
      labelStyle: label,
      unselectedLabelStyle: label,
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: p.accent,
      selectionColor: p.accent.withValues(alpha: 0.22),
      selectionHandleColor: p.accent,
    ),
    dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),
    iconTheme: IconThemeData(color: p.ink2, size: 20),
    iconButtonTheme: IconButtonThemeData(
      style:
          IconButton.styleFrom(
            minimumSize: controlSize,
            iconSize: 20,
            shape: p.controlShape,
          ).copyWith(
            animationDuration: Duration.zero,
            overlayColor: const WidgetStatePropertyAll(Colors.transparent),
            backgroundBuilder: _buttonMaterialFeedback,
            side: WidgetStateProperty.resolveWith(
              (states) => BorderSide(
                color: states.contains(WidgetState.focused)
                    ? p.accent
                    : Colors.transparent,
                width: 1.5,
              ),
            ),
          ),
    ),
    listTileTheme: ListTileThemeData(
      dense: false,
      iconColor: p.ink2,
      textColor: p.ink,
      selectedColor: p.isMist ? p.ink : p.accent,
      selectedTileColor: scheme.primaryContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      subtitleTextStyle: label.copyWith(color: p.ink2, fontSize: 13),
    ),
    expansionTileTheme: const ExpansionTileThemeData(
      tilePadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      childrenPadding: EdgeInsets.fromLTRB(16, 0, 16, 12),
    ),
    extensions: <ThemeExtension<dynamic>>[ElseLifeChrome(palette: p)],
  );
}

/// 运行时主题身份。一律从这里取色，禁止写死 studio 暖黑。
@immutable
class ElseLifeChrome extends ThemeExtension<ElseLifeChrome> {
  const ElseLifeChrome({required this.palette});

  final AuraPalette palette;

  ElseLifeThemeId get id => palette.id;

  bool get isGlass => palette.isInk;
  bool get isInk => palette.isInk;
  bool get isPaper => palette.isPaper;
  bool get isStudio => palette.isStudio;
  bool get isMist => palette.isMist;

  Color get sidebarColor => palette.bg2;
  Color get scaffoldColor => palette.bg;
  Color get ink => palette.ink;
  Color get inkMuted => palette.ink2;
  Color get inkFaint => palette.ink3;
  Color get accent => palette.accent;
  Color get accentInk => palette.accentInk;
  Color get danger => palette.danger;
  Color get success => palette.success;
  Color get waiting => Color.lerp(palette.accent, palette.ink2, 0.35)!;
  Color get stale => palette.ink3;
  Color get surfaceLow => palette.surfaceLow;
  Color get surfaceHigh => palette.bg3;
  Color get divider => palette.line;
  Color get hover => palette.isInk ? const Color(0x14FFFFFF) : palette.line;
  Color get card => palette.card;
  Color get cardLine => palette.cardLine;
  double get cardRadius => palette.radius;
  double get panelRadius => palette.radiusLg;
  List<BoxShadow> get shadows => palette.shadows;

  static ElseLifeChrome of(BuildContext context) {
    return Theme.of(context).extension<ElseLifeChrome>() ??
        const ElseLifeChrome(palette: kMistPalette);
  }

  @override
  ElseLifeChrome copyWith({AuraPalette? palette}) {
    return ElseLifeChrome(palette: palette ?? this.palette);
  }

  @override
  ElseLifeChrome lerp(ThemeExtension<ElseLifeChrome>? other, double t) {
    if (other is! ElseLifeChrome) return this;
    final a = palette;
    final b = other.palette;
    Color mix(Color start, Color end) => Color.lerp(start, end, t)!;
    // 外观切换逐帧插值，不能在动画中点整套跳色。
    return ElseLifeChrome(
      palette: AuraPalette(
        id: t < 0.5 ? a.id : b.id,
        brightness: t < 0.5 ? a.brightness : b.brightness,
        bg: mix(a.bg, b.bg),
        bg2: mix(a.bg2, b.bg2),
        bg3: mix(a.bg3, b.bg3),
        ink: mix(a.ink, b.ink),
        ink2: mix(a.ink2, b.ink2),
        ink3: mix(a.ink3, b.ink3),
        line: mix(a.line, b.line),
        lineStrong: mix(a.lineStrong, b.lineStrong),
        accent: mix(a.accent, b.accent),
        accent2: mix(a.accent2, b.accent2),
        accentInk: mix(a.accentInk, b.accentInk),
        card: mix(a.card, b.card),
        panelSurface: mix(a.surfaceLow, b.surfaceLow),
        cardLine: mix(a.cardLine, b.cardLine),
        danger: mix(a.danger, b.danger),
        success: mix(a.success, b.success),
        radius: a.radius + (b.radius - a.radius) * t,
        radiusLg: a.radiusLg + (b.radiusLg - a.radiusLg) * t,
        shadows: BoxShadow.lerpList(a.shadows, b.shadows, t) ?? const [],
        glow: BoxShadow.lerpList(a.glow, b.glow, t) ?? const [],
      ),
    );
  }
}

/// 页头：强调条 + 标题 + 可选说明。对齐官网 eyebrow / h2 / lead。
class AuraPageHeader extends StatelessWidget {
  const AuraPageHeader({super.key, required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.headlineMedium),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(subtitle!, style: theme.textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

/// 字标：名称 + 强调条（官网 brand__bar）。
class AuraWordmark extends StatelessWidget {
  const AuraWordmark({super.key, required this.label, this.size = 29});

  final String label;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = ElseLifeChrome.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          label.toLowerCase(),
          style: TextStyle(
            fontSize: size,
            fontWeight: FontWeight.w600,
            color: c.ink,
            height: 1.1,
            letterSpacing: -1.7,
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(left: 3, bottom: 5),
          child: Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(
              color: c.palette.accent2,
              shape: BoxShape.circle,
            ),
          ),
        ),
      ],
    );
  }
}

/// 移动的是承托指示条；标签、焦点和点击区域永远不跟随运动。
const kAuraSelectionIndicator = ValueKey<String>('aura-selection-indicator');

class AuraSwitcher extends StatefulWidget {
  const AuraSwitcher({
    super.key,
    required this.label,
    required this.options,
    required this.selected,
    required this.onSelected,
  });
  final String label;
  final List<(String id, String caption)> options;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  State<AuraSwitcher> createState() => _AuraSwitcherState();
}

class _AuraSwitcherState extends State<AuraSwitcher> {
  final _stackKey = GlobalKey();
  final _optionKeys = <String, GlobalKey>{};
  Rect? _selection;
  bool _scheduled = false;

  void _measureAfterLayout() {
    if (_scheduled) return;
    _scheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduled = false;
      if (!mounted) return;
      final host = _stackKey.currentContext?.findRenderObject();
      final item = _optionKeys[widget.selected]?.currentContext
          ?.findRenderObject();
      Rect? rect;
      if (host is RenderBox &&
          item is RenderBox &&
          host.hasSize &&
          item.hasSize) {
        final origin = item.localToGlobal(Offset.zero, ancestor: host);
        rect = (origin & item.size).deflate(2);
      }
      if (rect != _selection) setState(() => _selection = rect);
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = ElseLifeChrome.of(context);
    final validIds = widget.options.map((option) => option.$1).toSet();
    _optionKeys.removeWhere((id, _) => !validIds.contains(id));
    for (final id in validIds) {
      _optionKeys.putIfAbsent(id, () => GlobalKey());
    }
    final radius = BorderRadius.circular(12);
    final selectionSurface = IgnorePointer(
      child: DecoratedBox(
        key: kAuraSelectionIndicator,
        decoration: BoxDecoration(
          color: c.card,
          borderRadius: radius,
          border: Border.all(
            color: c.palette.lineStrong.withValues(alpha: .65),
          ),
          boxShadow: c.shadows,
        ),
      ),
    );
    return Semantics(
      label: widget.label,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: c.surfaceLow,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: c.divider),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              _measureAfterLayout();
              return Stack(
                key: _stackKey,
                children: [
                  if (_selection case final rect?)
                    if (ElseLifeMotion.reduceMotion(context))
                      Positioned.fromRect(rect: rect, child: selectionSurface)
                    else
                      AnimatedPositioned.fromRect(
                        rect: rect,
                        duration: const Duration(milliseconds: 260),
                        curve: ElseLifeMotion.standard,
                        child: selectionSurface,
                      ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (widget.label.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 0, 10, 0),
                          child: Text(
                            widget.label,
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ),
                      for (final (id, caption) in widget.options)
                        Padding(
                          key: _optionKeys[id],
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: Semantics(
                            key: ValueKey('aura-option-$id'),
                            container: true,
                            button: true,
                            label: caption,
                            selected: widget.selected == id,
                            onTap: () => widget.onSelected(id),
                            child: ExcludeSemantics(
                              child: TextButton(
                                onPressed: () => widget.onSelected(id),
                                style: TextButton.styleFrom(
                                  foregroundColor: widget.selected == id
                                      ? c.accent
                                      : c.inkMuted,
                                  backgroundColor: Colors.transparent,
                                  minimumSize: const Size(44, 44),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 10,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: radius,
                                  ),
                                ),
                                child: Text(caption),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// 兼容旧引用：studio 色板别名。新代码走 ElseLifeChrome.of。
abstract final class ElseLifeTokens {
  static const Color ink = Color(0xFF0A0B10);
  static const Color inkMuted = Color(0xFF52555F);
  static const Color inkFaint = Color(0xFF9AA0AB);
  static const Color scaffold = Color(0xFFFFFFFF);
  static const Color sidebar = Color(0xFFF6F7F9);
  static const Color surfaceLow = Color(0xFFF6F7F9);
  static const Color surfaceHigh = Color(0x170A0B10);
  static const Color divider = Color(0x170A0B10);
  static const Color hover = Color(0x170A0B10);
  static const Color accent = Color(0xFF5B67FF);
  static const Color onAccent = Color(0xFFFFFFFF);
  static const Color danger = Color(0xFFEA4335);
  static const Color success = Color(0xFF34A853);
  static const double cardRadius = 14;
  static const double panelRadius = 22;
  static const double glassSigma = 20;
}

/// 旧玻璃别名 → 墨夜。禁止新代码引用。
abstract final class GlassTokens {
  static const Color ink = Color(0xFFF2F3F8);
  static const Color inkMuted = Color(0xFFA6A9B8);
  static const Color inkFaint = Color(0xFF5C5F6E);
  static const Color scaffold = Color(0xFF05060A);
  static const Color sidebar = Color(0xFF090A11);
  static const Color surfaceLow = Color(0xFF090A11);
  static const Color surfaceHigh = Color(0x14FFFFFF);
  static const Color divider = Color(0x14FFFFFF);
  static const Color hover = Color(0x14FFFFFF);
  static const Color accent = Color(0xFF8B9BFF);
  static const double cardRadius = 18;
  static const double panelRadius = 26;
}
