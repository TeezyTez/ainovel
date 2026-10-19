import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = await readFile(new URL('./universe-paths.js', import.meta.url), 'utf8');
const {worlds, sampleRoute, travelerAt, cycleSeconds} = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('both journeys pass through every world aperture and share branch junctions', () => {
  for (const [i, world] of worlds.entries()) {
    for (const branch of [false, true]) {
      assert.ok(distance(sampleRoute((i + 1) / 5, branch), world) < 1e-9);
    }
  }
  assert.ok(distance(sampleRoute(.5), sampleRoute(.5, true)) > .2);
});

test('branch travel stays continuous, including the tangent at its junctions', () => {
  const delta = 1e-5;
  for (const t of [.4, .6]) {
    const before = sampleRoute(t - delta, true);
    const at = sampleRoute(t, true);
    const after = sampleRoute(t + delta, true);
    const left = at.map((v, i) => (v - before[i]) / delta);
    const right = after.map((v, i) => (v - at[i]) / delta);
    assert.ok(distance(left, right) < .02, `visible corner at ${t}`);
  }
  for (let i = 1; i <= 1000; i++) {
    assert.ok(distance(sampleRoute(i / 1000, true), sampleRoute((i - 1) / 1000, true)) < .012);
  }
});

test('a looping traveler fades out before returning and follows its displayed route', () => {
  for (const branch of [false, true]) {
    const middle = travelerAt(cycleSeconds / 2, 0, branch);
    assert.ok(distance(middle.position, sampleRoute(.5, branch)) < 1e-9);
    assert.equal(middle.opacity, 1);
    assert.ok(travelerAt(cycleSeconds - .001, 0, branch).opacity < .001);
    assert.equal(travelerAt(cycleSeconds, 0, branch).opacity, 0);
    assert.ok(travelerAt(cycleSeconds + .001, 0, branch).opacity < .001);
  }
});
