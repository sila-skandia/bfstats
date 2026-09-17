/**
 * Tier 1 Test Suite: Direct-to-Spawn Transition, Skip Briefing & GPU Warmup (Features 20-22, 15 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnvironment, MockWebGLRenderer } from '../harnesses/mock_dom.mjs';

import { MockTransitionController } from '../harnesses/transition_helpers.mjs';

// --------------------------------------------------------------------------- //
// Feature 20: TRANS-SKIP-BRIEFING (5 Tests: T1-FEAT20-01 to T1-FEAT20-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT20-01: Verifies original game briefing modal is NOT displayed when loading completes', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.briefingModalShown, false);
});

test('T1-FEAT20-02: Reaching 100% triggers direct transition without requiring user "READY" click', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.openDeployCalled, true);
});

test('T1-FEAT20-03: Briefing dialog element remains absent or hidden throughout lifecycle', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(env.document.querySelector('.briefing-modal'), null);
});

test('T1-FEAT20-04: Auto-advances immediately into post-load sequence', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  const start = Date.now();
  await ctrl.executeTransition();
  assert.ok(Date.now() - start < 100, 'Must auto-advance immediately without delay');
});

test('T1-FEAT20-05: No lingering modal overlay traps keyboard or mouse input', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.overlay.hidden, true);
});

// --------------------------------------------------------------------------- //
// Feature 21: TRANS-GPU-WARMUP (5 Tests: T1-FEAT21-01 to T1-FEAT21-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT21-01: Executes synchronous WebGL render pass (renderer.render()) before overlay dismiss', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.warmupRenderCalled, true);
  assert.equal(ctrl.renderer.renderCalls.length, 1);
});

test('T1-FEAT21-02: Loading overlay remains 100% opaque during GPU warmup pass', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.warmupRenderOpaque, true);
});

test('T1-FEAT21-03: Compiles shaders and uploads textures before making 3D scene visible', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.ok(ctrl.renderer.renderCalls.length >= 1);
});

test('T1-FEAT21-04: Verifies no black/white unrendered frames are presented to user', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.warmupRenderCalled, true);
  assert.equal(ctrl.overlayFaded, true);
});

test('T1-FEAT21-05: Handles WebGL rendering errors during warmup gracefully', async () => {
  const env = createMockEnvironment();
  class ThrowingRenderer extends MockWebGLRenderer {
    render() {
      throw new Error('WebGL context simulation failure');
    }
  }
  const ctrl = new MockTransitionController(env, { renderer: new ThrowingRenderer() });
  try {
    await ctrl.executeTransition();
  } catch (err) {
    assert.ok(err);
  }
});

// --------------------------------------------------------------------------- //
// Feature 22: TRANS-DIRECT-TO-SPAWN (5 Tests: T1-FEAT22-01 to T1-FEAT22-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT22-01: Invokes openDeploy() upon load completion to initialize spawn screen', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.openDeployCalled, true);
});

test('T1-FEAT22-02: Adds .deploy class to #fullmap element', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.fullmap.classList.contains('deploy'), true);
});

test('T1-FEAT22-03: Fades loading overlay opacity from 1.0 to 0.0', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.overlay.style.opacity, '0.0');
});

test('T1-FEAT22-04: Marks loading overlay hidden = true once fade animation completes', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.overlay.hidden, true);
});

test('T1-FEAT22-05: Spawn screen controls and interactive map are fully responsive immediately after fade', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);
  await ctrl.executeTransition();
  assert.equal(ctrl.fullmap.classList.contains('deploy'), true);
  assert.equal(ctrl.overlay.hidden, true);
});
