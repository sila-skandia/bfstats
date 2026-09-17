// tests/e2e/harnesses/transition_helpers.mjs
/**
 * Shared transition controller helper for E2E tests covering
 * Skip-Briefing, GPU Warmup, and Direct-to-Spawn transitions.
 */

import { MockWebGLRenderer } from './mock_dom.mjs';

export class MockTransitionController {
  constructor(env, options = {}) {
    this.env = env;
    this.renderer = options.renderer || new MockWebGLRenderer();
    this.metadata = options.metadata || { mapName: 'Wake Island' };
    this.spawnPoints = options.spawnPoints !== undefined ? options.spawnPoints : [{ id: 1, name: 'Airfield' }];
    this.reducedMotion = options.reducedMotion || false;
    this.throwOnDeploy = options.throwOnDeploy || false;

    this.inFlight = false;
    this.cancelled = false;
    this.openDeployCalled = false;
    this.warmupRenderCalled = false;
    this.warmupRenderOpaque = false;
    this.briefingModalShown = false;
    this.overlayFaded = false;
    this.overlayHidden = false;
    this.fallbackCameraUsed = false;
    this.contextLostCaught = false;

    // DOM state
    if (options.omitDom) {
      this.fullmap = null;
      this.overlay = null;
    } else {
      this.fullmap = env.document.createElement('div');
      this.fullmap.id = 'fullmap';
      env.body.appendChild(this.fullmap);

      this.overlay = env.document.createElement('div');
      this.overlay.className = 'ld-overlay';
      this.overlay.style.opacity = '1.0';
      env.body.appendChild(this.overlay);
    }
  }

  cancel() {
    this.cancelled = true;
    this.inFlight = false;
    if (this.overlay) {
      this.overlay.hidden = true;
    }
  }

  handleKeyDown(event) {
    if (event.key === 'Escape') {
      // Abort or fast-forward cleanly
      this.cancel();
    }
  }

  async executeTransition() {
    if (this.inFlight) {
      // Prevent re-entrant double execution
      return false;
    }
    this.inFlight = true;
    await Promise.resolve();

    // 1. Skip briefing dialog completely: even if metadata has briefing text, never show modal
    this.briefingModalShown = false;

    if (this.cancelled) {
      this.inFlight = false;
      return false;
    }

    // 2. GPU Warmup pass while overlay is 100% opaque
    if (this.overlay && (this.overlay.style.opacity === '1.0' || this.overlay.style.opacity === '1')) {
      this.warmupRenderOpaque = true;
    }

    try {
      if (this.renderer) {
        this.renderer.render({}, {});
        this.warmupRenderCalled = true;
      }
    } catch (err) {
      if (err.message && err.message.includes('context lost')) {
        this.contextLostCaught = true;
      } else {
        // Log or suppress non-fatal warmup error
        this.warmupRenderCalled = false;
      }
    }

    if (this.cancelled) {
      this.inFlight = false;
      return false;
    }

    // 3. Invoke openDeploy() to prepare spawn screen DOM
    try {
      this.openDeploy();
    } catch (err) {
      // Graceful error recovery: dismiss overlay anyway so screen doesn't get permanently stuck
      if (this.overlay) {
        this.overlay.hidden = true;
      }
      this.inFlight = false;
      return false;
    }

    // 4. Fade overlay from 1.0 to 0.0
    if (this.overlay) {
      if (this.reducedMotion) {
        // prefers-reduced-motion: instant cut to 0.0 opacity
        this.overlay.style.opacity = '0.0';
        this.overlayFaded = true;
        this.overlay.hidden = true;
        this.overlayHidden = true;
      } else {
        this.overlay.style.opacity = '0.0';
        this.overlayFaded = true;
        this.overlay.hidden = true;
        this.overlayHidden = true;
      }
    }

    this.inFlight = false;
    return true;
  }

  openDeploy() {
    this.openDeployCalled = true;
    if (this.throwOnDeploy) {
      throw new Error('Failed to initialize deploy UI component');
    }
    if (this.spawnPoints.length === 0) {
      this.fallbackCameraUsed = true;
    }
    if (this.fullmap) {
      this.fullmap.classList.add('deploy');
    }
  }
}
