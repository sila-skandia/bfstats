/**
 * Tier 1 Test Suite: Monotonic Progress Animation & Weighted Stages (Features 18-19, 10 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualClock } from '../harnesses/mock_dom.mjs';

import { MonotonicProgressAccumulator } from '../harnesses/anim_helpers.mjs';

// --------------------------------------------------------------------------- //
// Feature 18: ANIM-MONOTONIC-PROGRESS (5 Tests: T1-FEAT18-01 to T1-FEAT18-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT18-01: Progress bar starts at 0% on initialization', () => {
  const acc = new MonotonicProgressAccumulator();
  assert.equal(acc.displayProgress, 0.0);
  assert.equal(acc.targetProgress, 0.0);
});

test('T1-FEAT18-02: Progress value advances monotonically (P(t2) >= P(t1)) across all frame updates', () => {
  const acc = new MonotonicProgressAccumulator();
  const clock = new VirtualClock();

  acc.setDownloadBytes(50, 100); // 50% download -> 37.5% overall

  let prev = 0.0;
  for (let t = 16; t <= 1000; t += 16) {
    clock.tick(16);
    const p = acc.update(clock.now);
    assert.ok(p >= prev, `Progress decreased: ${p} < ${prev} at t=${t}`);
    prev = p;
  }
});

test('T1-FEAT18-03: Interpolates smoothly toward target percentage at 60 fps', () => {
  const acc = new MonotonicProgressAccumulator();
  const clock = new VirtualClock();

  acc.setDownloadBytes(100, 100); // 75% target
  const p1 = acc.update(16);
  const p2 = acc.update(32);
  const p3 = acc.update(48);

  assert.ok(p1 < p2 && p2 < p3, 'Progress must advance incrementally across frames');
  assert.ok(p3 < 75.0, 'Progress must not snap immediately to target');
});

test('T1-FEAT18-04: Clamps maximum advance speed (prevents instant snap from 0% to 100%)', () => {
  const acc = new MonotonicProgressAccumulator({ maxSpeedPerSec: 100 });
  acc.finish(); // Instant 100% arrival

  // 1 frame later (16.67ms)
  const p1 = acc.update(16.67);
  // Max possible in 1 frame is 100 * 0.01667 = ~1.67%
  assert.ok(p1 < 10.0, `Progress jumped too fast: ${p1}% in 16ms`);
});

test('T1-FEAT18-05: Reaches exactly 100% when load finishes', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.finish();

  // Run simulation forward 2 seconds
  for (let t = 16; t <= 2000; t += 16) {
    acc.update(t);
  }

  assert.equal(acc.displayProgress, 100.0);
});

// --------------------------------------------------------------------------- //
// Feature 19: ANIM-WEIGHTED-STAGES (5 Tests: T1-FEAT19-01 to T1-FEAT19-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT19-01: Weights network downloads at 75% of overall progress', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(100, 100);
  assert.equal(acc.targetProgress, 75.0);
});

test('T1-FEAT19-02: Weights scene and collider construction at 25% of overall progress', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setStageProgress('construction', 1.0);
  assert.equal(acc.targetProgress, 25.0);
});

test('T1-FEAT19-03: Updates progress smoothly as GLB bytes arrive via session.bytes()', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(25, 100);
  assert.equal(acc.targetProgress, 18.75);

  acc.setDownloadBytes(50, 100);
  assert.equal(acc.targetProgress, 37.5);

  acc.setDownloadBytes(75, 100);
  assert.equal(acc.targetProgress, 56.25);
});

test('T1-FEAT19-04: Advances progress as scene stages complete via session.setStage()', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(100, 100); // 75%
  acc.setStageProgress('construction', 0.5); // 0.5 * 25 = 12.5%
  assert.equal(acc.targetProgress, 87.5);
});

test('T1-FEAT19-05: Overall percentage calculation accurately aggregates weighted sub-stages', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(100, 100);
  acc.setStageProgress('construction', 1.0);
  assert.equal(acc.targetProgress, 100.0);
});
