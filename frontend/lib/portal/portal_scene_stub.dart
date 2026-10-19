import 'dart:math' as math;

import 'package:flutter/material.dart';

class PortalScene extends StatelessWidget {
  const PortalScene({
    super.key,
    required this.dark,
    required this.paused,
    required this.reduced,
    required this.progress,
  });

  final bool dark, paused, reduced;
  final double progress;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(painter: _Still(dark: dark)),
  );
}

// A quiet static equivalent of the web scene, also used off web.
class _Still extends CustomPainter {
  const _Still({required this.dark});

  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final double width;
    final double height;
    final double left;
    final double top;
    if (size.width <= 620) {
      width = math.min(size.width * .86, 350);
      height = 230;
      left = (size.width - width) / 2;
      top = 480;
    } else if (size.width <= 800) {
      width = math.min(size.width * .46, 330);
      height = 220;
      left = size.width * .96 - width;
      top = 420;
    } else {
      width = math.min(size.width * .34, 440);
      height = 320;
      left = size.width * .94 - width;
      top = size.height / 2 - 135;
    }
    final scale = math.min(width / 400, height / 300);
    final violet = dark ? const Color(0xffb9a9d2) : const Color(0xff8b809f);
    final teal = dark ? const Color(0xff92c4c4) : const Color(0xff7a9c9c);
    final middle = dark ? const Color(0xffa8b4ca) : const Color(0xff8c929f);
    final core = dark ? const Color(0xffd1c5df) : const Color(0xff706982);

    canvas.save();
    canvas.translate(
      left + (width - 400 * scale) / 2,
      top + (height - 300 * scale) / 2,
    );
    canvas.scale(scale);
    _drawWorld(canvas, const Offset(98, 136), violet, core);
    _drawWorld(canvas, const Offset(166, 158), middle, core);
    _drawWorld(canvas, const Offset(234, 143), middle, core);
    _drawWorld(canvas, const Offset(302, 168), teal, core);

    final threadShader = LinearGradient(
      colors: [violet, teal],
    ).createShader(const Rect.fromLTWH(30, 130, 340, 60));
    final branch = Path()
      ..moveTo(166, 158)
      ..cubicTo(183, 196, 215, 183, 234, 143);
    canvas.drawPath(
      branch,
      Paint()
        ..shader = threadShader
        ..color = const Color(0x54ffffff)
        ..style = PaintingStyle.stroke
        ..strokeWidth = .75
        ..strokeCap = StrokeCap.round,
    );
    final thread = Path()
      ..moveTo(30, 155)
      ..cubicTo(55, 155, 74, 130, 98, 136)
      ..cubicTo(122, 142, 143, 167, 166, 158)
      ..cubicTo(189, 149, 210, 130, 234, 143)
      ..cubicTo(258, 156, 277, 174, 302, 168)
      ..cubicTo(327, 162, 346, 141, 370, 150);
    canvas.drawPath(
      thread,
      Paint()
        ..shader = threadShader
        ..color = const Color(0xb3ffffff)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(
      const Offset(133, 154),
      1.8,
      Paint()..color = violet.withValues(alpha: .8),
    );
    canvas.restore();
  }

  Offset _surfacePoint(double u, double v) {
    final pinch = 1 - .3 * math.exp(-(u * u * 5 + v * v * 10));
    return Offset(27 * u * pinch, (72 * v - 15 * u) * pinch);
  }

  void _drawWorld(Canvas canvas, Offset center, Color color, Color core) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    final surface = Path()
      ..moveTo(-27, -57)
      ..lineTo(27, -87)
      ..lineTo(27, 57)
      ..lineTo(-27, 87)
      ..close();
    canvas.drawPath(surface, Paint()..color = color.withValues(alpha: .025));
    canvas.drawPath(
      surface,
      Paint()
        ..color = color.withValues(alpha: .22)
        ..style = PaintingStyle.stroke
        ..strokeWidth = .7,
    );
    final contourPaint = Paint()
      ..color = color.withValues(alpha: .24)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .55;
    void contour(bool vertical, double fixed) {
      final path = Path();
      for (var i = 0; i <= 32; i++) {
        final t = -1 + i / 16;
        final p = _surfacePoint(vertical ? fixed : t, vertical ? t : fixed);
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      canvas.drawPath(path, contourPaint);
    }

    for (final v in [-.75, -.5, -.25, .25, .5, .75]) {
      contour(false, v);
    }
    for (final u in [-.75, -.4, .4, .75]) {
      contour(true, u);
    }
    canvas.rotate(13 * math.pi / 180);
    canvas.drawOval(
      Rect.fromCenter(center: Offset.zero, width: 11, height: 20),
      Paint()
        ..color = color.withValues(alpha: .7)
        ..style = PaintingStyle.stroke
        ..strokeWidth = .8,
    );
    canvas.drawOval(
      Rect.fromCenter(center: Offset.zero, width: 4.8, height: 10.8),
      Paint()..color = core.withValues(alpha: .68),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _Still oldDelegate) => dark != oldDelegate.dark;
}
