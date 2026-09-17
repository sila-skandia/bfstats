/**
 * Tier 2 Test Suite: Monotonic Progress Animation & Weighted Stages Boundary Cases (Features 18-19, 10 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MonotonicProgressAccumulator } from '../harnesses/anim_helpers.mjs';

// --------------------------------------------------------------------------- //
// Feature 18 Boundary: ANIM-MONOTONIC-PROGRESS (5 Tests: T2-FEAT18-01 to T2-FEAT18-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT18-01: Out-of-order progress events received (50% then 30% - bar never steps backwards)', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(50, 100);
  const p1 = acc.update(16);

  // Out of order: lower bytes reported
  acc.setDownloadBytes(30, 100);
  const p2 = acc.update(32);

  assert.ok(p2 >= p1, `Progress stepped backwards: ${p2} < ${p1}`);
});

test('T2-FEAT18-02: Instant progress jump from 0% to 100% (cache hit enforces smooth ramp over >=300ms)', () => {
  const acc = new MonotonicProgressAccumulator({ maxSpeedPerSec: 100 });
  acc.finish(); // Instant 100%

  // Check progress at 100ms
  const p100ms = acc.update(100);
  assert.ok(p100ms < 50.0, `Cache hit progress snapped too fast: ${p100ms}% at 100ms`);
});

test('T2-FEAT18-03: Network download completely stalls for 10 seconds - bar holds steady without jitter', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(40, 100);
  acc.update(16);

  // Stall for 10 seconds
  const pStall1 = acc.update(1000);
  const pStall2 = acc.update(5000);
  const pStall3 = acc.update(10000);

  assert.ok(pStall2 >= pStall1 && pStall3 >= pStall2);
  assert.ok(Math.abs(pStall3 - pStall2) < 1.0, 'Progress should plateau steadily during stall');
});

test('T2-FEAT18-04: Progress percentage clamped strictly between 0% and 100% (rejects negative or >100%)', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(-50, 100);
  const pLow = acc.update(16);
  assert.ok(pLow >= 0.0);

  acc.setDownloadBytes(5000, 100);
  acc.finish();
  for (let t = 32; t <= 5000; t += 100) {
    acc.update(t);
  }
  assert.equal(acc.displayProgress, 100.0);
});

test('T2-FEAT18-05: Frame drop (dt = 500ms) advances smoothly without overshoot', () => {
  const acc = new MonotonicProgressAccumulator({ maxSpeedPerSec: 60 });
  acc.setDownloadBytes(50, 100); // 37.5% target
  acc.update(16);

  // Big 500ms frame lag
  const pAfterLag = acc.update(516);
  assert.ok(pAfterLag <= 37.5, 'Must not overshoot target percentage');
});

// --------------------------------------------------------------------------- //
// Feature 19 Boundary: ANIM-WEIGHTED-STAGES (5 Tests: T2-FEAT19-01 to T2-FEAT19-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT19-01: Content-Length header missing (total bytes = 0 handled safely)', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(1024, 0); // Total 0 bytes
  assert.equal(acc.targetProgress, 0.0);
});

test('T2-FEAT19-02: Zero-byte asset loaded (handled without error)', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(0, 0);
  assert.equal(acc.targetProgress, 0.0);
});

test('T2-FEAT19-03: Skipped intermediate stage advances progress smoothly', () => {
  const acc = new MonotonicProgressAccumulator();
  // Download finished, scene graph skipped straight to 100%
  acc.setDownloadBytes(100, 100);
  acc.setStageProgress('construction', 1.0);
  assert.equal(acc.targetProgress, 100.0);
});

test('T2-FEAT19-04: Download phase finishes before scene graph phase starts', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(100, 100);
  assert.equal(acc.targetProgress, 75.0);

  acc.setStageProgress('construction', 0.2); // 75 + 5 = 80%
  assert.equal(acc.targetProgress, 80.0);
});

test('T2-FEAT19-05: Scene construction takes significantly longer than download (heavy collider geometry)', () => {
  const acc = new MonotonicProgressAccumulator();
  acc.setDownloadBytes(100, 100); // 75% download arrived fast
  assert.equal(acc.targetProgress, 75.0);

  // Construction ticks forward slowly
  acc.setStageProgress('construction', 0.1);
  assert.equal(acc.targetProgress, 77.5);
  acc.setStageProgress('construction', 0.5);
  assert.equal(acc.targetProgress, 87.5);
  acc.setStageProgress('construction', 1.0);
  assert.equal(acc.targetProgress, 100.0);
});
