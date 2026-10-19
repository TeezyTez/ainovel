/// App-owned route clocks. Platform features remain platform-owned; routes read
/// the stable, scoped projection of ElseLifeMotionScope, including nested triggers.
library;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// A read-only-to-consumers projection, never a persisted preference/writer.
class ElseLifeRouteMotion extends ChangeNotifier {
  ElseLifeRouteMotion(this._reduced);
  bool _reduced;
  bool get reduced => _reduced;
  bool _disposed = false;

  void _update(bool value) {
    if (_disposed || value == _reduced) return;
    _reduced = value;
    notifyListeners();
  }

  static ElseLifeRouteMotion capture(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<_RouteMotionScope>();
    if (scope != null) return scope.motion;
    final media = MediaQuery.maybeOf(context);
    // A standalone trigger without a live scope still honors its initial flag.
    return ElseLifeRouteMotion(
      media?.disableAnimations == true || media?.accessibleNavigation == true,
    );
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

class ElseLifeRouteMotionBoundary extends StatefulWidget {
  const ElseLifeRouteMotionBoundary({
    super.key,
    required this.reduced,
    required this.child,
  });
  final bool reduced;
  final Widget child;

  @override
  State<ElseLifeRouteMotionBoundary> createState() => _BoundaryState();
}

class _BoundaryState extends State<ElseLifeRouteMotionBoundary> {
  late final motion = ElseLifeRouteMotion(widget.reduced);
  @override
  void didUpdateWidget(ElseLifeRouteMotionBoundary oldWidget) {
    super.didUpdateWidget(oldWidget);
    motion._update(widget.reduced);
  }

  @override
  Widget build(BuildContext context) =>
      _RouteMotionScope(motion: motion, child: widget.child);

  @override
  void dispose() {
    motion.dispose();
    super.dispose();
  }
}

class _RouteMotionScope extends InheritedWidget {
  const _RouteMotionScope({required this.motion, required super.child});
  final ElseLifeRouteMotion motion;
  @override
  bool updateShouldNotify(_RouteMotionScope oldWidget) =>
      motion != oldWidget.motion;
}

/// Public TransitionRoute extension point; no SDK-private route or binding.
/// Only the clock is changed. Navigator keeps result, restoration and focus.
mixin ElseLifeRouteClock<T> on TransitionRoute<T> {
  ElseLifeRouteMotion get motion;
  Duration get fullDuration;
  Duration get fullReverseDuration => fullDuration;
  AnimationController? _clock;
  bool _clockDisposed = false;
  bool _settleQueued = false;

  @override
  Duration get transitionDuration =>
      motion.reduced ? Duration.zero : fullDuration;
  @override
  Duration get reverseTransitionDuration =>
      motion.reduced ? Duration.zero : fullReverseDuration;

  @override
  AnimationController createAnimationController() {
    // Keep the public subclass factory: ModalBottomSheetRoute also registers
    // this clock with its SDK drag/layout owner. With effective reduce the
    // duration is exactly zero, so SDK platform scaling cannot add motion.
    final clock = super.createAnimationController();
    clock.duration = transitionDuration;
    clock.reverseDuration = reverseTransitionDuration;
    _clock = clock;
    motion.addListener(_syncClock);
    return clock;
  }

  void _syncClock() {
    if (_clockDisposed) return;
    final clock = _clock;
    if (clock == null) return;
    clock.duration = transitionDuration;
    clock.reverseDuration = reverseTransitionDuration;
    if (!motion.reduced || !clock.isAnimating || _settleQueued) return;
    void settle() {
      _settleQueued = false;
      if (_clockDisposed || !motion.reduced || !clock.isAnimating) return;
      // During a scope rebuild finalization would dirty its Overlay ancestor.
      // Snap after that frame; the next painted frame is the final route state.
      clock.value = clock.status == AnimationStatus.reverse ? 0 : 1;
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      settle();
    } else {
      _settleQueued = true;
      SchedulerBinding.instance.addPostFrameCallback((_) => settle());
    }
  }

  @override
  void dispose() {
    _clockDisposed = true;
    motion.removeListener(_syncClock);
    super.dispose();
  }
}
