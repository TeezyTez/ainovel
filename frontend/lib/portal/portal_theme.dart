import 'package:flutter/material.dart';
import '../ui/theme/elselife_theme.dart';
import '../ui/motion/elselife_animated_surface.dart';

/// Product chrome shares one palette; reading paper retains its preferences.
ThemeData portalThemeData(String id) {
  final base = elseLifeThemeData(themeIdFromString(id));
  final dark = base.brightness == Brightness.dark;
  final bg = Color(dark ? 0xff121116 : 0xfff7f6f3);
  final paper = Color(dark ? 0xff1c1b22 : 0xfffffefb);
  final ink = Color(dark ? 0xffefedf4 : 0xff2c2934);
  final muted = Color(dark ? 0xffb1aabb : 0xff706977);
  final primary = Color(dark ? 0xffcbb8e8 : 0xff69517e);
  final soft = Color(dark ? 0xff28242f : 0xffefebf2);
  final line = Color(dark ? 0xff37323f : 0xffe5e0e7);
  final onPrimary = Color(dark ? 0xff26202f : 0xfffffdf9);
  final action = Color(dark ? 0xffe4daed : 0xff37313f);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  const label = TextStyle(fontFamily: 'NotoSansSC', fontSize: 13,
      height: 1.4, fontWeight: FontWeight.w600, letterSpacing: .15);

  Widget feedback(BuildContext context, Set<WidgetState> states,
      Widget? child, {bool filled = false}) {
    final disabled = states.contains(WidgetState.disabled);
    final pressed = !disabled && states.contains(WidgetState.pressed);
    final hover = !disabled && states.contains(WidgetState.hovered);
    final focus = !disabled && states.contains(WidgetState.focused);
    return ElseLifeAnimatedSurface(
      duration: Duration(milliseconds: pressed ? 70 : 180),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: filled ? null : primary.withValues(alpha: disabled ? 0 : pressed ? .13 : hover ? .07 : 0),
        gradient: !filled || disabled ? null : LinearGradient(
          begin: Alignment.topLeft, end: Alignment.bottomRight,
          colors: [Color.lerp(action, dark ? Colors.white : primary, pressed ? .22 : hover ? .32 : .08)!, action]),
        border: Border.all(color: focus ? primary : Colors.transparent, width: 2),
        boxShadow: !filled || disabled ? const [] : [
          BoxShadow(blurStyle: BlurStyle.outer,
            color: (dark ? Colors.black : primary).withValues(alpha: hover ? .24 : .12),
            blurRadius: pressed ? 2 : hover ? 16 : 5,
            offset: Offset(0, pressed ? 1 : hover ? 5 : 2)),
        ],
      ), child: child,
    );
  }
  final common = ButtonStyle(
    minimumSize: const WidgetStatePropertyAll(Size(44, 44)),
    padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 20, vertical: 12)),
    textStyle: const WidgetStatePropertyAll(label), shape: WidgetStatePropertyAll(shape),
    animationDuration: Duration.zero,
    overlayColor: const WidgetStatePropertyAll(Colors.transparent), splashFactory: NoSplash.splashFactory,
    mouseCursor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? SystemMouseCursors.basic : SystemMouseCursors.click),
    backgroundBuilder: feedback,
  );
  OutlineInputBorder inputBorder(Color color, [double width = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: color, width: width));
  final panelShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: line));
  return base.copyWith(
    scaffoldBackgroundColor: bg, canvasColor: paper, dividerColor: line,
    hoverColor: primary.withValues(alpha: .065), focusColor: primary.withValues(alpha: .12),
    highlightColor: primary.withValues(alpha: .08), splashColor: primary.withValues(alpha: .09),
    colorScheme: base.colorScheme.copyWith(
      primary: primary, onPrimary: onPrimary, primaryContainer: soft, onPrimaryContainer: ink,
      surface: paper, surfaceTint: Colors.transparent,
      surfaceContainerLowest: bg, surfaceContainerLow: bg, surfaceContainer: paper,
      surfaceContainerHigh: soft, surfaceContainerHighest: Color(dark ? 0xff302a38 : 0xffe8e1ec),
      onSurface: ink, onSurfaceVariant: muted, outline: line, outlineVariant: line),
    textTheme: base.textTheme.apply(bodyColor: ink, displayColor: ink).copyWith(
      headlineMedium: TextStyle(fontFamily: 'NotoSerifSC', fontSize: 28, height: 1.45,
        fontWeight: FontWeight.w500, letterSpacing: -.6, color: ink),
      titleLarge: TextStyle(fontFamily: 'NotoSerifSC', fontSize: 23, height: 1.45,
        fontWeight: FontWeight.w500, letterSpacing: -.3, color: ink)),
    iconTheme: IconThemeData(color: muted, size: 20),
    filledButtonTheme: FilledButtonThemeData(style: common.copyWith(
      foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? muted : onPrimary),
      backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? soft : action),
      backgroundBuilder: (c, s, child) => feedback(c, s, child, filled: true))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: common.copyWith(
      foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? muted : ink),
      backgroundColor: WidgetStatePropertyAll(paper),
      side: WidgetStateProperty.resolveWith((s) => BorderSide(color: s.contains(WidgetState.disabled) ? line
        : s.contains(WidgetState.focused) ? primary : s.contains(WidgetState.hovered) ? primary.withValues(alpha: .45) : line)))),
    textButtonTheme: TextButtonThemeData(style: common.copyWith(
      foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? muted : primary),
      padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 14, vertical: 10)))),
    iconButtonTheme: IconButtonThemeData(style: common.copyWith(
      padding: const WidgetStatePropertyAll(EdgeInsets.all(10)),
      foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.hovered) ? primary : muted))),
    inputDecorationTheme: base.inputDecorationTheme.copyWith(
      fillColor: paper, hoverColor: primary.withValues(alpha: .025),
      labelStyle: TextStyle(color: muted, fontSize: 13), hintStyle: TextStyle(color: muted, fontSize: 14),
      floatingLabelStyle: WidgetStateTextStyle.resolveWith((s) => TextStyle(
        color: s.contains(WidgetState.error) ? base.colorScheme.error : primary, fontWeight: FontWeight.w600, fontSize: 13)),
      border: inputBorder(line), enabledBorder: inputBorder(line),
      disabledBorder: inputBorder(line.withValues(alpha: .65)), focusedBorder: inputBorder(primary, 1.6)),
    cardTheme: base.cardTheme.copyWith(color: paper, shape: panelShape, elevation: 0),
    chipTheme: base.chipTheme.copyWith(backgroundColor: paper, selectedColor: soft,
      labelStyle: label.copyWith(color: muted, fontSize: 12, fontWeight: FontWeight.w500),
      secondaryLabelStyle: label.copyWith(color: primary, fontSize: 12),
      side: BorderSide(color: line), checkmarkColor: primary,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7)),
    appBarTheme: base.appBarTheme.copyWith(backgroundColor: bg, foregroundColor: ink),
    dialogTheme: base.dialogTheme.copyWith(backgroundColor: paper, surfaceTintColor: Colors.transparent,
      shape: panelShape, shadowColor: Colors.black.withValues(alpha: .18), elevation: 18,
      titleTextStyle: TextStyle(fontFamily: 'NotoSerifSC', fontSize: 24, height: 1.5, fontWeight: FontWeight.w500, color: ink),
      contentTextStyle: TextStyle(fontFamily: 'NotoSansSC', fontSize: 14, height: 1.8, color: ink)),
    bottomSheetTheme: base.bottomSheetTheme.copyWith(backgroundColor: paper, modalBackgroundColor: paper),
    popupMenuTheme: base.popupMenuTheme.copyWith(color: paper, shape: panelShape,
      elevation: 8, shadowColor: Colors.black.withValues(alpha: .15),
      textStyle: label.copyWith(color: ink, fontWeight: FontWeight.w500)),
    dropdownMenuTheme: DropdownMenuThemeData(menuStyle: MenuStyle(
      backgroundColor: WidgetStatePropertyAll(paper), shape: WidgetStatePropertyAll(panelShape),
      elevation: const WidgetStatePropertyAll(8))),
    tooltipTheme: TooltipThemeData(waitDuration: const Duration(milliseconds: 450),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(color: ink, borderRadius: BorderRadius.circular(8)),
      textStyle: TextStyle(color: bg, fontFamily: 'NotoSansSC', fontSize: 12)),
    scrollbarTheme: ScrollbarThemeData(
      thickness: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.hovered) ? 7 : 4), radius: const Radius.circular(8),
      thumbColor: WidgetStateProperty.resolveWith((s) => primary.withValues(alpha: s.contains(WidgetState.hovered) ? .45 : .2))),
    listTileTheme: base.listTileTheme.copyWith(textColor: ink, iconColor: muted, selectedColor: primary, selectedTileColor: soft),
    dividerTheme: DividerThemeData(color: line, thickness: 1),
    textSelectionTheme: TextSelectionThemeData(cursorColor: primary,
      selectionColor: primary.withValues(alpha: .18), selectionHandleColor: primary),
    snackBarTheme: SnackBarThemeData(backgroundColor: ink,
      contentTextStyle: TextStyle(color: bg, fontFamily: 'NotoSansSC', fontSize: 13, height: 1.6),
      actionTextColor: dark ? const Color(0xff69517e) : const Color(0xffdfc8f5),
      behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
  );
}
