/// 可中断的绘制插值。时长归零不等于停止：减少动态强制落当前目标。
library;

import 'package:flutter/material.dart';
import '../theme/elselife_theme.dart';

/// 只画 decoration；child 永远在同一 Element 槽位，不因减少动态重挂表单。
class ElseLifeAnimatedSurface extends StatefulWidget {
  const ElseLifeAnimatedSurface({
    super.key,
    required this.decoration,
    this.duration = ElseLifeMotion.press,
    this.child,
  });
  final Decoration decoration;
  final Duration duration;
  final Widget? child;
  @override
  State<ElseLifeAnimatedSurface> createState() => _ElseLifeAnimatedSurfaceState();
}

class _ElseLifeAnimatedSurfaceState extends State<ElseLifeAnimatedSurface>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    value: 1,
    duration: widget.duration,
  );
  late DecorationTween _tween = DecorationTween(
    begin: widget.decoration,
    end: widget.decoration,
  );
  Decoration get _paint =>
      _tween.transform(ElseLifeMotion.standard.transform(_controller.value));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (ElseLifeMotion.reduceMotion(context)) _controller.value = 1;
  }

  @override
  void didUpdateWidget(ElseLifeAnimatedSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.decoration != widget.decoration) {
      _tween = DecorationTween(begin: _paint, end: widget.decoration);
      if (ElseLifeMotion.reduceMotion(context) ||
          widget.duration == Duration.zero) {
        _controller.value = 1;
      } else {
        _controller.duration = widget.duration;
        _controller.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    child: widget.child,
    builder: (context, child) => DecoratedBox(decoration: _paint, child: child),
  );
}

/// 数值布局/滤镜插值采用同一中断语义；builder 不重挂输入等有状态内容。
class ElseLifeAnimatedValue extends StatefulWidget {
  const ElseLifeAnimatedValue({
    super.key,
    required this.value,
    required this.duration,
    required this.builder,
    this.child,
    this.curve = ElseLifeMotion.standard,
  });
  final double value;
  final Duration duration;
  final Curve curve;
  final ValueWidgetBuilder<double> builder;
  final Widget? child;
  @override
  State<ElseLifeAnimatedValue> createState() => _ElseLifeAnimatedValueState();
}

class _ElseLifeAnimatedValueState extends State<ElseLifeAnimatedValue>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    value: 1,
    duration: widget.duration,
  );
  late double _from = widget.value;
  late double _to = widget.value;
  double get _value =>
      _from + (_to - _from) * widget.curve.transform(_controller.value);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (ElseLifeMotion.reduceMotion(context)) _controller.value = 1;
  }

  @override
  void didUpdateWidget(ElseLifeAnimatedValue oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_to != widget.value) {
      _from = _value;
      _to = widget.value;
      if (ElseLifeMotion.reduceMotion(context) ||
          widget.duration == Duration.zero) {
        _controller.value = 1;
      } else {
        _controller.duration = widget.duration;
        _controller.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    child: widget.child,
    builder: (context, child) => widget.builder(context, _value, child),
  );
}
