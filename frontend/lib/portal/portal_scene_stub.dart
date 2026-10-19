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
  Widget build(BuildContext context) =>
      ExcludeSemantics(child: CustomPaint(painter: _Still()));
}

// Original SVG fallback geometry from universe-home.js; used off web.
class _Still extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final mobile = size.width <= 620;
    final art = mobile
        ? Rect.fromLTRB(
            -size.width * .26,
            315,
            size.width * 1.36,
            size.height + 90,
          )
        : Rect.fromLTRB(
            size.width * .14,
            -size.height * .11,
            size.width * 1.18,
            size.height * 1.03,
          );
    final scale = math.min(art.width / 600, art.height / 500);
    canvas.save();
    canvas.translate(art.center.dx, art.center.dy);
    canvas.scale(scale);
    canvas.rotate(-28 * math.pi / 180);
    canvas.scale(1, .7);
    final halo = Rect.fromCenter(center: Offset.zero, width: 470, height: 410);
    canvas.drawOval(
      halo,
      Paint()
        ..shader = const RadialGradient(
          colors: [
            Color(0xff242035),
            Color(0xff5c557b),
            Color(0xb3aaa1c3),
            Color(0x59b3c9d3),
            Color(0x00cbbdd8),
          ],
          stops: [0, .22, .46, .78, 1],
        ).createShader(halo),
    );
    for (var i = 0; i < 30; i++) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(32 - i.toDouble(), -20 + i * .6),
          width: (25 + i * 6.5) * 2,
          height: (22 + i * 5.8) * 2,
        ),
        Paint()
          ..color = const Color(0xff9c92b6).withValues(alpha: .5 - i * .012)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .65,
      );
    }
    canvas.drawOval(
      Rect.fromCenter(center: const Offset(32, -20), width: 48, height: 42),
      Paint()..color = const Color(0xff272337),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _Still oldDelegate) => false;
}
