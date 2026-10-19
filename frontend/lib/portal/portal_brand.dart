import 'dart:math' as math;
import 'package:flutter/material.dart';

/// The exact ellipses and Béziers from product-shell.js, without a substitute icon.
class PortalBrandMark extends StatelessWidget {
  const PortalBrandMark({super.key,this.size=32});
  final double size;
  @override Widget build(BuildContext context) => CustomPaint(size:Size.square(size),painter:_BrandMarkPainter(Theme.of(context).colorScheme.primary));
}
class _BrandMarkPainter extends CustomPainter {
  const _BrandMarkPainter(this.color);
  final Color color;
  @override void paint(Canvas canvas,Size size){
    canvas.save();canvas.scale(size.width/32,size.height/32);
    final paint=Paint()..color=color.withValues(alpha:.5)..style=PaintingStyle.stroke..strokeCap=StrokeCap.round..strokeJoin=StrokeJoin.round..strokeWidth=1.1;
    paint.shader=const LinearGradient(begin:Alignment(-1,1),end:Alignment(1,-1),colors:[Color(0xff9e8ad9),Color(0xff77b9c7),Color(0xff8cc7b8),Color(0xffd7b991),Color(0xffc18ab8)],stops:[0,.28,.48,.7,1]).createShader(const Rect.fromLTRB(4,5,28,27));
    canvas.drawPath(Path()..moveTo(7.4,16.2)..cubicTo(13.2,13.1,16.1,8.5,22,5.7)..moveTo(13.6,25.8)..cubicTo(21,23,21.1,15,26,11.7),paint);
    for(final e in [(24.0,8.7,5.2,3.6,1.25,.8),(24.5,8.9,2.8,1.7,1.05,1.0),(10.5,21.0,8.0,5.7,1.4,.8),(11.5,21.3,5.1,3.1,1.5,1.0)]){
      canvas.save();canvas.translate(e.$1,e.$2);canvas.rotate(-33*math.pi/180);
      canvas.drawOval(Rect.fromCenter(center:Offset.zero,width:e.$3*2,height:e.$4*2),paint..strokeWidth=e.$5..color=color.withValues(alpha:e.$6));canvas.restore();
    }
    canvas.restore();
  }
  @override bool shouldRepaint(_BrandMarkPainter oldDelegate)=>oldDelegate.color!=color;
}
