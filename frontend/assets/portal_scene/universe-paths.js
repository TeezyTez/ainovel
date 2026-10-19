// Decorative coordinates, independent of product stories and world facts.
export const worlds = [
  [-1.2, .22, 0], [-.4, -.03, 0], [.4, .15, 0], [1.2, -.15, 0],
];
export const cycleSeconds = 28;
const knots = [[-2, -.12, 0], ...worlds, [2, .04, 0]];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function sampleRoute(progress, branch = false) {
  const p = clamp(progress) * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(p)), t = p - i;
  const a = knots[Math.max(0, i - 1)], b = knots[i];
  const c = knots[i + 1], d = knots[Math.min(knots.length - 1, i + 2)];
  const point = b.map((v, axis) => .5 * (
    2 * v + (-a[axis] + c[axis]) * t +
    (2 * a[axis] - 5 * v + 4 * c[axis] - d[axis]) * t * t +
    (-a[axis] + 3 * v - 3 * c[axis] + d[axis]) * t * t * t));
  if (branch && progress > .4 && progress < .6) {
    // Squared sine rejoins with the same position AND tangent, without a kink.
    const bow = Math.sin(Math.PI * (progress - .4) / .2) ** 2;
    point[1] -= .42 * bow;
    point[2] += .12 * bow;
  }
  return point;
}

export function travelerAt(time, offset = 0, branch = false) {
  const progress = ((time / cycleSeconds + offset) % 1 + 1) % 1;
  return {
    position: sampleRoute(progress, branch),
    opacity: smooth(progress / .08) * smooth((1 - progress) / .08),
  };
}
