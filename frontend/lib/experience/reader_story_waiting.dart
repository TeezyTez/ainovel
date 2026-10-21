import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'experience_models.dart';

enum StoryWaitingMotif { rain, dialogue, journey, discovery, ink }

final _storyWaitingCues = <(StoryWaitingMotif, RegExp)>[
  (
    StoryWaitingMotif.dialogue,
    RegExp(
      r'交谈|对话|谈话|询问|追问|提问|问候|问起|问道|问一句|问店主|问他|问她|回答|答道|说道|开口|聊天|讲述|告诉|\b(?:ask|asked|asks|asking|talk|talked|talking|speak|speaking|said|reply|replied|conversation)\b',
      caseSensitive: false,
      unicode: true,
    ),
  ),
  (
    StoryWaitingMotif.journey,
    RegExp(
      r'走向|走进|走出|走过|走到|步行|赶路|前行|出发|启程|沿着|行走|踏上|乘车|骑马|航行|穿过|\b(?:walk|walked|walking|travel|travelled|traveled|traveling|travelling|journey|depart|departed)\b',
      caseSensitive: false,
      unicode: true,
    ),
  ),
  (
    StoryWaitingMotif.discovery,
    RegExp(
      r'查看|翻看|翻开|打开|打量|观察|寻找|搜寻|调查|检查|辨认|线索|笔迹|信封|\b(?:inspect|inspected|examine|examined|search|searched|discover|discovered|clue|letter)\b',
      caseSensitive: false,
      unicode: true,
    ),
  ),
  (
    StoryWaitingMotif.rain,
    RegExp(
      r'雨|伞|\b(?:rain|rains|rained|raining|rainy|drizzle|umbrella)\b',
      caseSensitive: false,
      unicode: true,
    ),
  ),
];

/// Selects atmosphere from a player action or already published prose only.
/// The inspected text is bounded and is never drawn by the waiting widget.
StoryWaitingMotif storyWaitingMotif({
  String input = '',
  String publishedText = '',
}) {
  final action = input.substring(0, math.min(input.length, 1600));
  for (final (motif, pattern) in _storyWaitingCues) {
    if (pattern.hasMatch(action)) return motif;
  }

  final recent = publishedText.substring(
    math.max(0, publishedText.length - 1600),
  );
  var selected = StoryWaitingMotif.ink;
  var latest = -1;
  for (final (motif, pattern) in _storyWaitingCues) {
    for (final match in pattern.allMatches(recent)) {
      if (match.start > latest) {
        latest = match.start;
        selected = motif;
      }
    }
  }
  return selected;
}

/// A small drawing in the reader margin while the next page is being written.
class ReaderStoryWaiting extends StatefulWidget {
  const ReaderStoryWaiting({
    super.key,
    this.input = '',
    this.publishedText = '',
    this.onStop,
    this.stopping = false,
    this.showStop = false,
    this.phase,
  });

  final String input;
  final String publishedText;
  final VoidCallback? onStop;
  final bool stopping;
  final NarrativePhase? phase;

  /// Keeps the stop control visible while its callback is temporarily disabled.
  final bool showStop;

  @override
  State<ReaderStoryWaiting> createState() => _ReaderStoryWaitingState();
}

class _ReaderStoryWaitingState extends State<ReaderStoryWaiting>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation;
  late StoryWaitingMotif _motif;
  bool _reducedMotion = false;

  @override
  void initState() {
    super.initState();
    _animation = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 5400),
    );
    _selectMotif();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final media = MediaQuery.maybeOf(context);
    _reducedMotion =
        (media?.disableAnimations ?? false) ||
        (media?.accessibleNavigation ?? false);
    _syncAnimation();
  }

  @override
  void didUpdateWidget(covariant ReaderStoryWaiting oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.input != widget.input ||
        oldWidget.publishedText != widget.publishedText) {
      _selectMotif();
    }
    if (oldWidget.stopping != widget.stopping) _syncAnimation();
  }

  void _selectMotif() {
    _motif = storyWaitingMotif(
      input: widget.input,
      publishedText: widget.publishedText,
    );
  }

  void _syncAnimation() {
    if (_reducedMotion || widget.stopping) {
      _animation.stop();
      if (_reducedMotion) _animation.value = .38;
    } else if (!_animation.isAnimating) {
      _animation.repeat();
    }
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    // The reader may set its paper/ink palette independently of the app theme.
    final ink =
        DefaultTextStyle.of(context).style.color ?? colors.onSurfaceVariant;
    final sketch = Color.lerp(ink, colors.primary, .28)!;
    final label = widget.stopping ? '稍等片刻' : widget.phase?.label ?? '故事正在继续';
    return Semantics(
      key: const ValueKey('story-waiting'),
      container: true,
      explicitChildNodes: true,
      liveRegion: true,
      label: label,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            ExcludeSemantics(
              child: RepaintBoundary(
                child: CustomPaint(
                  key: const ValueKey('story-waiting-scene'),
                  size: const Size(80, 44),
                  painter: _StoryWaitingPainter(
                    animation: _animation,
                    motif: _motif,
                    color: sketch,
                    reducedMotion: _reducedMotion,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ExcludeSemantics(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.6,
                    letterSpacing: .5,
                    color: ink.withValues(alpha: .76),
                  ),
                ),
              ),
            ),
            if (widget.showStop || widget.onStop != null) ...[
              const SizedBox(width: 6),
              SizedBox.square(
                dimension: 44,
                child: IconButton(
                  key: const ValueKey('story-waiting-stop'),
                  tooltip: '停止生成',
                  onPressed: widget.stopping ? null : widget.onStop,
                  padding: const EdgeInsets.all(12),
                  constraints: const BoxConstraints.tightFor(
                    width: 44,
                    height: 44,
                  ),
                  color: ink.withValues(alpha: .7),
                  disabledColor: ink.withValues(alpha: .35),
                  icon: const Icon(Icons.stop_rounded, size: 18),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StoryWaitingPainter extends CustomPainter {
  _StoryWaitingPainter({
    required this.animation,
    required this.motif,
    required this.color,
    required this.reducedMotion,
  }) : super(repaint: animation);

  final Animation<double> animation;
  final StoryWaitingMotif motif;
  final Color color;
  final bool reducedMotion;

  Paint _pen(double opacity, {bool fill = false}) => Paint()
    ..color = color.withValues(alpha: opacity)
    ..style = fill ? PaintingStyle.fill : PaintingStyle.stroke
    ..strokeWidth = 1.3
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;

  double _wave(double phase) => .5 - .5 * math.cos(phase * math.pi * 2);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 96, size.height / 48);
    final t = animation.value;
    switch (motif) {
      case StoryWaitingMotif.rain:
        _rain(canvas, t);
      case StoryWaitingMotif.dialogue:
        _dialogue(canvas, t);
      case StoryWaitingMotif.journey:
        _journey(canvas, t);
      case StoryWaitingMotif.discovery:
        _discovery(canvas, t);
      case StoryWaitingMotif.ink:
        _ink(canvas, t);
    }
    canvas.restore();
  }

  void _rain(Canvas canvas, double t) {
    canvas.drawPath(
      Path()
        ..moveTo(11, 38)
        ..quadraticBezierTo(29, 36, 43, 38)
        ..quadraticBezierTo(66, 40, 85, 37),
      _pen(.27),
    );
    for (var i = 0; i < 7; i++) {
      final phase = (t * 2 + i * .21) % 1;
      final x = 18.0 + i * 10 - phase * 4;
      final y = 5 + phase * 23;
      canvas.drawLine(
        Offset(x, y),
        Offset(x - 2.5, y + 6),
        _pen(.62 * math.sin(phase * math.pi)),
      );
    }
    final spread = reducedMotion ? .48 : t;
    canvas.drawOval(
      Rect.fromCenter(
        center: const Offset(43, 38),
        width: 10 + spread * 20,
        height: 2 + spread * 2.5,
      ),
      _pen(.5 * (1 - spread)),
    );
  }

  void _dialogue(Canvas canvas, double t) {
    canvas.drawPath(
      Path()
        ..moveTo(13, 36)
        ..quadraticBezierTo(25, 33, 36, 36)
        ..moveTo(61, 36)
        ..quadraticBezierTo(73, 33, 83, 36),
      _pen(.27),
    );
    final thread = Path()
      ..moveTo(31, 23)
      ..cubicTo(39, 12, 55, 12, 65, 23);
    canvas.drawPath(thread, _pen(.18));
    final metric = thread.computeMetrics().first;
    final phase = reducedMotion ? .5 : _wave(t);
    final point = metric.getTangentForOffset(metric.length * phase)!.position;
    canvas.drawCircle(point, 1.4, _pen(.7, fill: true));
    canvas.drawCircle(
      const Offset(27, 27),
      3.1 + _wave(t) * .8,
      _pen(.45 + _wave(t) * .3),
    );
    canvas.drawCircle(
      const Offset(69, 27),
      3.1 + _wave(t + .5) * .8,
      _pen(.45 + _wave(t + .5) * .3),
    );
    canvas.drawLine(const Offset(25, 15), const Offset(23, 12), _pen(.3));
    canvas.drawLine(const Offset(71, 15), const Offset(73, 12), _pen(.3));
  }

  void _journey(Canvas canvas, double t) {
    final track = Path()
      ..moveTo(15, 31)
      ..cubicTo(30, 10, 44, 50, 58, 29)
      ..cubicTo(66, 17, 73, 12, 83, 18);
    canvas.drawPath(track, _pen(.25));
    canvas.drawPath(
      Path()
        ..moveTo(9, 36)
        ..quadraticBezierTo(23, 29, 36, 32)
        ..moveTo(62, 14)
        ..quadraticBezierTo(73, 9, 86, 13),
      _pen(.22),
    );
    final metric = track.computeMetrics().first;
    for (var i = 0; i < 4; i++) {
      final phase = (t + i / 4) % 1;
      final offset = phase * metric.length;
      canvas.drawPath(
        metric.extractPath(offset, math.min(offset + 5, metric.length)),
        _pen(.55 * math.sin(phase * math.pi)),
      );
    }
    canvas.drawCircle(const Offset(15, 31), 2, _pen(.65, fill: true));
  }

  void _discovery(Canvas canvas, double t) {
    for (var i = 0; i < 2; i++) {
      final phase = reducedMotion ? .25 + i * .4 : (t + i * .5) % 1;
      canvas.drawCircle(
        const Offset(48, 25),
        5 + phase * 13,
        _pen(.55 * (1 - phase)),
      );
    }
    canvas.drawPath(
      Path()
        ..moveTo(48, 20)
        ..lineTo(49.5, 23.5)
        ..lineTo(53, 25)
        ..lineTo(49.5, 26.5)
        ..lineTo(48, 30)
        ..lineTo(46.5, 26.5)
        ..lineTo(43, 25)
        ..lineTo(46.5, 23.5)
        ..close(),
      _pen(.75),
    );
    canvas.drawPath(
      Path()
        ..moveTo(13, 32)
        ..quadraticBezierTo(20, 29, 26, 31)
        ..moveTo(72, 17)
        ..lineTo(82, 15)
        ..moveTo(73, 34)
        ..lineTo(81, 36),
      _pen(.27),
    );
  }

  void _ink(Canvas canvas, double t) {
    for (var i = 0; i < 3; i++) {
      final y = 15.0 + i * 10;
      final line = Path()
        ..moveTo(15, y)
        ..cubicTo(28, y - 2, 38, y + 2, 51, y)
        ..cubicTo(61, y - 1.5, 69, y + 1.5, i == 2 ? 66 : 80, y);
      final metric = line.computeMetrics().first;
      final breath = _wave(t + i * .14);
      canvas.drawPath(line, _pen(.14));
      canvas.drawPath(
        metric.extractPath(0, metric.length * (.72 + breath * .28)),
        _pen(.38 + breath * .32),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _StoryWaitingPainter oldDelegate) =>
      oldDelegate.motif != motif ||
      oldDelegate.color != color ||
      oldDelegate.reducedMotion != reducedMotion ||
      oldDelegate.animation != animation;
}
