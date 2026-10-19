import 'package:flutter/material.dart';
import '../ui/motion/elselife_animated_surface.dart';
import '../ui/theme/elselife_theme.dart';

/// Visual feedback only; existing descendants retain click/keyboard semantics.
class PortalCardSurface extends StatefulWidget {
  const PortalCardSurface({super.key, required this.child, this.color,
    this.shape, this.borderRadius, this.clipBehavior = Clip.none, this.interactive = true});
  final Widget child;
  final Color? color;
  final ShapeBorder? shape;
  final BorderRadius? borderRadius;
  final Clip clipBehavior;
  final bool interactive;
  @override
  State<PortalCardSurface> createState() => _PortalCardSurfaceState();
}
class _PortalCardSurfaceState extends State<PortalCardSurface> {
  bool _hover = false, _focus = false, _pressed = false;
  void _update({bool? hover, bool? focus, bool? pressed}) {
    if (!mounted) return;
    setState(() { _hover = hover ?? _hover; _focus = focus ?? _focus; _pressed = pressed ?? _pressed; });
  }
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final active = widget.interactive && (_hover || _focus);
    final pressed = widget.interactive && _pressed;
    final radius = widget.borderRadius ?? (widget.shape is RoundedRectangleBorder
      ? (widget.shape! as RoundedRectangleBorder).borderRadius.resolve(Directionality.of(context))
      : BorderRadius.circular(18));
    final decoration = BoxDecoration(borderRadius: radius, boxShadow: [
      BoxShadow(color: colors.onSurface.withValues(alpha: active ? .09 : .025),
        blurRadius: active ? 28 : 10, offset: Offset(0, active ? 10 : 3), spreadRadius: active ? -9 : -5),
      BoxShadow(color: colors.primary.withValues(alpha: widget.interactive && _focus ? .65 : active ? .24 : 0),
        blurRadius: 0, spreadRadius: widget.interactive && _focus ? 2 : 1),
    ]);
    return MouseRegion(onEnter: (_) => _update(hover: true), onExit: (_) => _update(hover: false, pressed: false),
      child: Focus(canRequestFocus: false, onFocusChange: (v) => _update(focus: v),
        child: Listener(onPointerDown: (_) => _update(pressed: true),
          onPointerUp: (_) => _update(pressed: false), onPointerCancel: (_) => _update(pressed: false),
          child: ElseLifeAnimatedValue(
            value: ElseLifeMotion.reduceMotion(context) ? 0 : active && !pressed ? -3 : 0,
            duration: const Duration(milliseconds: 200),
            builder: (_, v, child) => Transform.translate(offset: Offset(0, v), child: child),
            child: ElseLifeAnimatedSurface(decoration: decoration, duration: const Duration(milliseconds: 200),
              child: Material(color: widget.color, shape: widget.shape,
                borderRadius: widget.shape == null ? radius : null,
                clipBehavior: widget.clipBehavior, child: widget.child)),
          ),
        ),
      ),
    );
  }
}
