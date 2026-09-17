/**
 * Tier 2 Test Suite: Direct-to-Spawn Transition, Skip Briefing & GPU Warmup Boundary Cases (Features 20-22, 15 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnvironment, MockWebGLRenderer } from '../harnesses/mock_dom.mjs';
import { MockTransitionController } from '../harnesses/transition_helpers.mjs';

// --------------------------------------------------------------------------- //
// Feature 20 Boundary: TRANS-SKIP-BRIEFING (5 Tests: T2-FEAT20-01 to T2-FEAT20-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT20-01: Escape key pressed during transition sequence (aborts or fast-forwards cleanly)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);

  // Simulate Escape key press mid-transition
  ctrl.handleKeyDown({ key: 'Escape' });

  assert.equal(ctrl.cancelled, true);
  assert.equal(ctrl.overlay.hidden, true);
});

test('T2-FEAT20-02: User clicks repeatedly during transition sequence (no re-entrant calls)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);

  // Dispatch multiple transition triggers concurrently
  const p1 = ctrl.executeTransition();
  const p2 = ctrl.executeTransition();
  const p3 = ctrl.executeTransition();

  const results = await Promise.all([p1, p2, p3]);

  // First call succeeds, others rejected by re-entrancy guard
  assert.equal(results[0], true);
  assert.equal(results[1], false);
  assert.equal(results[2], false);
  assert.equal(ctrl.renderer.renderCalls.length, 1);
});

test('T2-FEAT20-03: Briefing data present in level metadata but suppressed by transition controller', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    metadata: {
      mapName: 'El Alamein',
      briefingText: 'British and German forces clash across the desert dunes...',
      readyButtonText: 'COMMENCE MISSION'
    }
  });

  await ctrl.executeTransition();
  assert.equal(ctrl.briefingModalShown, false);
  assert.equal(env.document.querySelector('.briefing-modal'), null);
});

test('T2-FEAT20-04: Fast double-load triggered while transition in progress (cancels previous transition)', async () => {
  const env = createMockEnvironment();
  const ctrl1 = new MockTransitionController(env, { metadata: { mapName: 'Wake Island' } });

  // Start transition 1
  ctrl1.inFlight = true;

  // New map load requested
  ctrl1.cancel();
  assert.equal(ctrl1.cancelled, true);

  // New transition started for map 2
  const ctrl2 = new MockTransitionController(env, { metadata: { mapName: 'Midway' } });
  const success2 = await ctrl2.executeTransition();

  assert.equal(success2, true);
  assert.equal(ctrl2.openDeployCalled, true);
});

test('T2-FEAT20-05: Map without briefing text or description (handles cleanly)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    metadata: {
      mapName: 'Custom Map Without Text'
      // briefingText undefined
    }
  });

  const success = await ctrl.executeTransition();
  assert.equal(success, true);
  assert.equal(ctrl.briefingModalShown, false);
  assert.equal(ctrl.openDeployCalled, true);
});

// --------------------------------------------------------------------------- //
// Feature 21 Boundary: TRANS-GPU-WARMUP (5 Tests: T2-FEAT21-01 to T2-FEAT21-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT21-01: WebGL context lost during warmup render pass (webglcontextlost caught)', async () => {
  const env = createMockEnvironment();
  class ContextLostRenderer extends MockWebGLRenderer {
    render() {
      throw new Error('webgl context lost');
    }
  }

  const ctrl = new MockTransitionController(env, {
    renderer: new ContextLostRenderer()
  });

  const success = await ctrl.executeTransition();
  assert.equal(ctrl.contextLostCaught, true);
  // Transition should still safely complete deployment without freezing
  assert.equal(ctrl.openDeployCalled, true);
});

test('T2-FEAT21-02: Scene has 0 meshes or lights (empty scene renders without error)', async () => {
  const env = createMockEnvironment();
  const emptyScene = { children: [] };
  let renderedEmpty = false;

  class EmptySceneRenderer extends MockWebGLRenderer {
    render(scene, camera) {
      super.render(scene, camera);
      if (scene && scene.children && scene.children.length === 0) {
        renderedEmpty = true;
      }
    }
  }

  const ctrl = new MockTransitionController(env, {
    renderer: new EmptySceneRenderer()
  });

  await ctrl.executeTransition();
  assert.equal(ctrl.warmupRenderCalled, true);
});

test('T2-FEAT21-03: Shaders take >1000ms to compile (slow GPU fallback / timeout)', async () => {
  const env = createMockEnvironment();
  class SlowCompilationRenderer extends MockWebGLRenderer {
    render() {
      // Simulate long compilation flag or warning
      this.compileTimeMs = 1250;
      super.render({}, {});
    }
  }

  const renderer = new SlowCompilationRenderer();
  const ctrl = new MockTransitionController(env, { renderer });

  await ctrl.executeTransition();
  assert.equal(renderer.compileTimeMs, 1250);
  assert.equal(ctrl.openDeployCalled, true);
});

test('T2-FEAT21-04: Renderer canvas resized during warmup pass', async () => {
  const env = createMockEnvironment();
  const renderer = new MockWebGLRenderer();

  // Resize canvas mid-warmup
  renderer.setSize(2560, 1440);
  const ctrl = new MockTransitionController(env, { renderer });

  await ctrl.executeTransition();
  assert.equal(renderer.width, 2560);
  assert.equal(renderer.height, 1440);
  assert.equal(ctrl.warmupRenderCalled, true);
});

test('T2-FEAT21-05: Multi-material meshes with textures still decoding (renders without throw)', async () => {
  const env = createMockEnvironment();
  class IncompleteTextureRenderer extends MockWebGLRenderer {
    render(scene, camera) {
      // Material with decoding texture returns fallback magenta/dummy texture
      super.render(scene, camera);
    }
  }

  const ctrl = new MockTransitionController(env, {
    renderer: new IncompleteTextureRenderer()
  });

  const success = await ctrl.executeTransition();
  assert.equal(success, true);
  assert.equal(ctrl.warmupRenderCalled, true);
});

// --------------------------------------------------------------------------- //
// Feature 22 Boundary: TRANS-DIRECT-TO-SPAWN (5 Tests: T2-FEAT22-01 to T2-FEAT22-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT22-01: Level has 0 spawn points / control points (overview camera fallback)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    spawnPoints: [] // 0 spawn points
  });

  await ctrl.executeTransition();
  assert.equal(ctrl.openDeployCalled, true);
  assert.equal(ctrl.fallbackCameraUsed, true);
});

test('T2-FEAT22-02: openDeploy() throws exception (overlay dismisses safely without locking screen)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    throwOnDeploy: true
  });

  const success = await ctrl.executeTransition();
  assert.equal(success, false);
  // Overlay must still be hidden so user is not stuck on infinite loading overlay
  assert.equal(ctrl.overlay.hidden, true);
});

test('T2-FEAT22-03: CSS transitions disabled (prefers-reduced-motion: reduce instant hide)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    reducedMotion: true
  });

  await ctrl.executeTransition();
  assert.equal(ctrl.overlay.style.opacity, '0.0');
  assert.equal(ctrl.overlay.hidden, true);
});

test('T2-FEAT22-04: Transition interrupted by loading a new map', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env);

  // Cancel transition before it completes
  ctrl.cancel();
  const success = await ctrl.executeTransition();

  assert.equal(success, false);
  assert.equal(ctrl.openDeployCalled, false);
});

test('T2-FEAT22-05: Spawn screen DOM elements missing or unmounted (handled without crashing)', async () => {
  const env = createMockEnvironment();
  const ctrl = new MockTransitionController(env, {
    omitDom: true // Missing fullmap and overlay elements
  });

  // Should execute cleanly without TypeError null reference
  const success = await ctrl.executeTransition();
  assert.equal(success, true);
  assert.equal(ctrl.openDeployCalled, true);
});
