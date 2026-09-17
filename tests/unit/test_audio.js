/**
 * tests/unit/test_audio.js
 * Automated Unit Test Suite for Milestone 2: Audio Pipeline & Autoplay Resilience
 *
 * Verifies all 7 features:
 * 1. AUDIO-PLAYBACK: Stream and loop loading music (audio.loop = true, audio.crossOrigin = 'anonymous')
 * 2. AUDIO-FALLBACK: Smooth fallback on 404/media load error, distinguishing 404 from autoplay blocks
 * 3. AUDIO-AUTOPLAY-TRAP: Catch NotAllowedError & AbortError with zero uncaught promise rejections
 * 4. AUDIO-GESTURE-UNLOCK: One-time document interaction unlock in capture phase with atomic teardown
 * 5. AUDIO-UNMUTE-UI: Authentic Refractor HUD button with pointer-events: auto, auto-reveal & auto-hide
 * 6. AUDIO-FADEOUT: Smooth volume ramp down to 0, pause, currentTime reset, gain reset, promise resolution
 * 7. AUDIO-STALE-CANCEL: State guards and generation tracking preventing stale clicks post-load/cancel
 *
 * Run with: node --test tests/unit/test_audio.js
 */

import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LoadingAudioController,
  createLoadingAudioController,
  AudioState,
} from '../../tools/bf1942-models/viewer/audio.js';

/* ------------------------------------------------------------------
 * Mock Primitives for Headless Node.js Execution
 * ------------------------------------------------------------------ */

class MockAudioParam {
  constructor(initialValue = 1.0) {
    this.value = initialValue;
    this.calls = [];
  }

  setValueAtTime(v, t) {
    this.value = v;
    this.calls.push({ fn: 'setValueAtTime', v, t });
  }

  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.calls.push({ fn: 'linearRampToValueAtTime', v, t });
  }

  cancelScheduledValues(t) {
    this.calls.push({ fn: 'cancelScheduledValues', t });
  }
}

class MockGainNode {
  constructor() {
    this.gain = new MockAudioParam(1.0);
    this.connectedTo = null;
  }

  connect(destination) {
    this.connectedTo = destination;
  }

  disconnect() {
    this.connectedTo = null;
  }
}

class MockAudioContext {
  constructor(options = {}) {
    this.state = options.state || 'running';
    this.currentTime = 0;
    this.destination = {};
    this.resumeCalled = false;
  }

  createGain() {
    return new MockGainNode();
  }

  createMediaElementSource(element) {
    return {
      element,
      connect(target) {},
      disconnect() {},
    };
  }

  async resume() {
    this.resumeCalled = true;
    this.state = 'running';
  }
}

class MockAudio {
  constructor() {
    this.src = '';
    this.loop = false;
    this.crossOrigin = null;
    this.volume = 1.0;
    this.currentTime = 0;
    this.paused = true;
    this.preload = 'auto';

    this.playCount = 0;
    this.pauseCount = 0;
    this._playReject = null;
    this._listeners = new Map();
    this.onerror = null;
  }

  addEventListener(event, listener, options) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ listener, options });
  }

  removeEventListener(event, listener) {
    if (!this._listeners.has(event)) return;
    const filtered = this._listeners.get(event).filter((item) => item.listener !== listener);
    this._listeners.set(event, filtered);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const entries = this._listeners.get(type) || [];
    for (const item of [...entries]) {
      item.listener(typeof event === 'string' ? { type } : event);
      if (item.options && item.options.once) {
        this.removeEventListener(type, item.listener);
      }
    }
    if (type === 'error' && typeof this.onerror === 'function') {
      this.onerror(event);
    }
  }

  async play() {
    this.playCount++;
    if (this._playReject) {
      this.paused = true;
      throw this._playReject;
    }
    this.paused = false;
  }

  pause() {
    this.pauseCount++;
    this.paused = true;
  }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.hidden = false;
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.innerHTML = '';
    this._attrs = new Map();
    this._listeners = new Map();
  }

  setAttribute(k, v) {
    this._attrs.set(k, String(v));
  }

  getAttribute(k) {
    return this._attrs.get(k) || null;
  }

  removeAttribute(k) {
    this._attrs.delete(k);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(child) {
    if (!child) return false;
    if (child === this) return true;
    for (const c of this.children) {
      if (c === child || (c.contains && c.contains(child))) return true;
    }
    return false;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  addEventListener(event, listener, options) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ listener, options });
  }

  removeEventListener(event, listener) {
    if (!this._listeners.has(event)) return;
    const filtered = this._listeners.get(event).filter((item) => item.listener !== listener);
    this._listeners.set(event, filtered);
  }

  click() {
    let stopped = false;
    let prevented = false;
    const fakeEvent = {
      type: 'click',
      target: this,
      currentTarget: this,
      stopPropagation: () => { stopped = true; },
      preventDefault: () => { prevented = true; },
    };
    const entries = this._listeners.get('click') || [];
    for (const item of [...entries]) {
      item.listener(fakeEvent);
      if (item.options && item.options.once) {
        this.removeEventListener('click', item.listener);
      }
    }
    return { stopped, prevented };
  }
}

class MockDocument {
  constructor() {
    this.head = new MockElement('head');
    this.body = new MockElement('body');
    this._listeners = new Map();
  }

  createElement(tag) {
    return new MockElement(tag);
  }

  getElementById(id) {
    const search = (el) => {
      if (el.getAttribute('id') === id || el.id === id) return el;
      for (const child of el.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(this.head) || search(this.body);
  }

  addEventListener(event, listener, options) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ listener, options });
  }

  removeEventListener(event, listener) {
    if (!this._listeners.has(event)) return;
    const filtered = this._listeners.get(event).filter((item) => item.listener !== listener);
    this._listeners.set(event, filtered);
  }

  dispatch(event, eventObj = {}) {
    const type = typeof event === 'string' ? event : event.type;
    const entries = this._listeners.get(type) || [];
    const ev = { type, target: this, currentTarget: this, ...eventObj };
    for (const item of [...entries]) {
      item.listener(ev);
      if (item.options && item.options.once) {
        this.removeEventListener(type, item.listener);
      }
    }
  }

  listenerCount(type) {
    return (this._listeners.get(type) || []).length;
  }
}

/* ------------------------------------------------------------------
 * Unit Tests
 * ------------------------------------------------------------------ */

describe('LoadingAudioController', () => {
  let doc, mockAudioInstance;

  class SpyingAudio extends MockAudio {
    constructor() {
      super();
      mockAudioInstance = this;
    }
  }

  beforeEach(() => {
    doc = new MockDocument();
    mockAudioInstance = null;
  });

  /* ---------------- 1. AUDIO-PLAYBACK ---------------- */
  describe('1. AUDIO-PLAYBACK', () => {
    it('streams, loops, and enables anonymous CORS on track start', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');

      assert.equal(mockAudioInstance.src, 'maps/wake/music.mp3');
      assert.equal(mockAudioInstance.loop, true);
      assert.equal(mockAudioInstance.crossOrigin, 'anonymous');
      assert.equal(mockAudioInstance.volume, 1.0);
      assert.equal(mockAudioInstance.paused, false);
      assert.equal(ctrl.isAutoplayBlocked(), false);

      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });

    it('immediately plays fallback track when musicUrl is null or empty', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start(null, 'maps/_shared/music/fallback.mp3');
      assert.equal(mockAudioInstance.src, 'maps/_shared/music/fallback.mp3');
      assert.equal(mockAudioInstance.paused, false);
    });

    it('defaults to vehicle4.mp3 when both musicUrl and fallbackUrl are omitted', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start();
      assert.equal(mockAudioInstance.src, '_shared/music/vehicle4.mp3');
    });
  });

  /* ---------------- 2. AUDIO-FALLBACK ---------------- */
  describe('2. AUDIO-FALLBACK', () => {
    it('switches smoothly to fallback URL when primary track emits error event', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/missing/music.mp3', '_shared/music/vehicle4.mp3');
      assert.equal(mockAudioInstance.src, 'maps/missing/music.mp3');

      // Simulate 404 error event
      mockAudioInstance.dispatchEvent('error');

      assert.equal(mockAudioInstance.src, '_shared/music/vehicle4.mp3');
      assert.equal(mockAudioInstance.paused, false);
    });

    it('works when audio.onerror callback is assigned directly', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/corrupt/music.mp3', '_shared/music/vehicle4.mp3');
      assert.equal(mockAudioInstance.src, 'maps/corrupt/music.mp3');

      // Direct onerror invocation
      mockAudioInstance.onerror();
      assert.equal(mockAudioInstance.src, '_shared/music/vehicle4.mp3');
    });

    it('does not trigger fallback track on autoplay NotAllowedError', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('NotAllowedError');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3', '_shared/music/vehicle4.mp3');
      await new Promise((r) => queueMicrotask(r));

      // Must NOT switch to fallback URL on autoplay block
      assert.equal(mockAudioInstance.src, 'maps/wake/music.mp3');
      assert.equal(ctrl.isAutoplayBlocked(), true);
    });
  });

  /* ---------------- 3. AUDIO-AUTOPLAY-TRAP ---------------- */
  describe('3. AUDIO-AUTOPLAY-TRAP', () => {
    it('catches NotAllowedError, sets isAutoplayBlocked = true, and notifies callbacks', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('play() failed because user did not interact');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      let unhandledPromiseRejection = false;
      const unhandledHandler = () => { unhandledPromiseRejection = true; };
      process.on('unhandledRejection', unhandledHandler);

      let blockedNotifications = 0;
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.onAutoplayBlocked(() => {
        blockedNotifications++;
      });

      ctrl.start('maps/wake/music.mp3');

      await new Promise((r) => queueMicrotask(r));

      process.removeListener('unhandledRejection', unhandledHandler);

      assert.equal(unhandledPromiseRejection, false, 'Expected zero unhandled promise rejections');
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
      assert.equal(blockedNotifications, 1);
    });

    it('silently traps AbortError on play interruption without error status', async () => {
      class AbortedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('The play() request was interrupted');
          err.name = 'AbortError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AbortedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      // AbortError should NOT be marked as an autoplay block
      assert.equal(ctrl.isAutoplayBlocked(), false);
    });

    it('invokes onAutoplayBlocked on microtask if registered after block occurred', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      let lateCallbackCalled = false;
      ctrl.onAutoplayBlocked(() => {
        lateCallbackCalled = true;
      });

      await new Promise((r) => queueMicrotask(r));
      assert.equal(lateCallbackCalled, true);
    });

    it('unsubscribes onAutoplayBlocked cleanly', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      let count = 0;
      const unsubscribe = ctrl.onAutoplayBlocked(() => { count++; });
      unsubscribe();

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(count, 0);
    });
  });

  /* ---------------- 4. AUDIO-GESTURE-UNLOCK ---------------- */
  describe('4. AUDIO-GESTURE-UNLOCK', () => {
    it('unlocks on document pointerdown event and notifies resolved callbacks', async () => {
      let playAttempts = 0;
      class BlockedThenAllowedAudio extends SpyingAudio {
        async play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Not allowed');
            err.name = 'NotAllowedError';
            throw err;
          }
          this.paused = false;
        }
      }

      let resolvedCalled = false;
      const ctx = new MockAudioContext({ state: 'suspended' });
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedThenAllowedAudio,
        audioContext: ctx,
      });

      ctrl.onAutoplayResolved(() => {
        resolvedCalled = true;
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Verify listeners were attached for all 4 gesture events in capture mode
      assert.equal(doc.listenerCount('pointerdown'), 1);
      assert.equal(doc.listenerCount('keydown'), 1);
      assert.equal(doc.listenerCount('touchstart'), 1);
      assert.equal(doc.listenerCount('click'), 1);

      // Simulate pointerdown
      doc.dispatch('pointerdown');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(resolvedCalled, true);
      assert.equal(ctx.state, 'running');
    });

    it('atomically tears down all 4 gesture listeners on the first interaction', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(doc.listenerCount('pointerdown'), 1);
      assert.equal(doc.listenerCount('keydown'), 1);
      assert.equal(doc.listenerCount('touchstart'), 1);
      assert.equal(doc.listenerCount('click'), 1);

      // Single keydown event
      mockAudioInstance._playReject = null;
      doc.dispatch('keydown');

      // Atomic teardown: ALL 4 must be removed immediately
      assert.equal(doc.listenerCount('pointerdown'), 0);
      assert.equal(doc.listenerCount('keydown'), 0);
      assert.equal(doc.listenerCount('touchstart'), 0);
      assert.equal(doc.listenerCount('click'), 0);
    });

    it('unlocks via keydown, touchstart, and click respectively', async () => {
      const eventTypes = ['keydown', 'touchstart', 'click'];

      for (const ev of eventTypes) {
        const testDoc = new MockDocument();
        let playCount = 0;
        class TestAudio extends MockAudio {
          async play() {
            playCount++;
            if (playCount === 1) {
              const err = new Error('Blocked');
              err.name = 'NotAllowedError';
              throw err;
            }
            this.paused = false;
          }
        }

        const ctrl = createLoadingAudioController({
          documentRef: testDoc,
          audioClass: TestAudio,
          audioContextClass: MockAudioContext,
        });

        ctrl.start('maps/wake/music.mp3');
        await new Promise((r) => queueMicrotask(r));
        assert.equal(ctrl.isAutoplayBlocked(), true);

        testDoc.dispatch(ev);
        await new Promise((r) => queueMicrotask(r));

        assert.equal(ctrl.isAutoplayBlocked(), false, `Failed to unlock on ${ev}`);
      }
    });
  });

  /* ---------------- 5. AUDIO-UNMUTE-UI ---------------- */
  describe('5. AUDIO-UNMUTE-UI', () => {
    it('creates authentic Refractor HUD button with pointer-events: auto', () => {
      const container = doc.createElement('div');
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      const btn = ctrl.attachUnmuteButton(container);

      assert.ok(btn);
      assert.equal(btn.className, 'ld-unmute-btn');
      assert.equal(btn.getAttribute('type'), 'button');
      assert.equal(btn.style.pointerEvents, 'auto', 'Must specify pointer-events: auto');
      assert.equal(btn.hidden, true, 'Initially hidden when autoplay not blocked');
      assert.equal(btn.style.display, 'none');
      assert.ok(btn.innerHTML.includes('SOUND: CLICK TO ENABLE'));
      assert.ok(btn.innerHTML.includes('🔊'));
    });

    it('returns the same button instance if attached to the same container repeatedly', () => {
      const container = doc.createElement('div');
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      const btn1 = ctrl.attachUnmuteButton(container);
      const btn2 = ctrl.attachUnmuteButton(container);
      assert.equal(btn1, btn2);
      assert.equal(container.children.length, 1);
    });

    it('returns null if container is null or undefined', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });
      assert.equal(ctrl.attachUnmuteButton(null), null);
    });

    it('reveals button when blocked, and hides when clicked or unlocked', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const container = doc.createElement('div');
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      const btn = ctrl.attachUnmuteButton(container);
      assert.equal(btn.hidden, true);

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      // Revealed on block
      assert.equal(btn.hidden, false);
      assert.equal(btn.style.display, 'inline-flex');

      // Now allow playback and simulate user clicking the button
      mockAudioInstance._playReject = null;
      btn.click();
      await new Promise((r) => queueMicrotask(r));

      // Hidden on unlock
      assert.equal(btn.hidden, true);
      assert.equal(btn.style.display, 'none');
      assert.equal(ctrl.isAutoplayBlocked(), false);
    });

    it('auto-hides button when fadeOut() or cancel() is invoked', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const container = doc.createElement('div');
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      const btn = ctrl.attachUnmuteButton(container);
      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(btn.hidden, false);

      ctrl.cancel();
      assert.equal(btn.hidden, true);
      assert.equal(btn.style.display, 'none');
    });
  });

  /* ---------------- 6. AUDIO-FADEOUT ---------------- */
  describe('6. AUDIO-FADEOUT', () => {
    it('uses Web Audio linearRampToValueAtTime, pauses audio, resets currentTime and gain', async () => {
      let capturedGainNode = null;
      class CustomCtx extends MockAudioContext {
        createGain() {
          capturedGainNode = super.createGain();
          return capturedGainNode;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: CustomCtx,
        fadeDurationMs: 40,
      });

      ctrl.start('maps/wake/music.mp3');
      assert.equal(mockAudioInstance.paused, false);

      const fadePromise = ctrl.fadeOut(40);
      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // Verify linear ramp scheduled
      const rampCall = capturedGainNode.gain.calls.find((c) => c.fn === 'linearRampToValueAtTime');
      assert.ok(rampCall, 'Expected linearRampToValueAtTime call');
      assert.equal(rampCall.v, 0.0);

      await fadePromise;

      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(mockAudioInstance.paused, true);
      assert.equal(mockAudioInstance.currentTime, 0);

      // Gain restored to 1.0 for future sessions
      const resetCall = capturedGainNode.gain.calls[capturedGainNode.gain.calls.length - 1];
      assert.equal(resetCall.fn, 'setValueAtTime');
      assert.equal(resetCall.v, 1.0);
    });

    it('falls back smoothly to volume interpolation when Web Audio is unavailable', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: null, // No Web Audio
        fadeDurationMs: 40,
      });

      ctrl.start('maps/wake/music.mp3');
      assert.equal(mockAudioInstance.paused, false);

      await ctrl.fadeOut(40);

      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(mockAudioInstance.paused, true);
      assert.equal(mockAudioInstance.currentTime, 0);
      assert.equal(mockAudioInstance.volume, 1.0); // Reset to 1.0 for next track
    });

    it('resolves immediately when fadeOut is called on an already paused or blocked track', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // fadeOut while blocked resolves immediately
      await ctrl.fadeOut(800);
      assert.equal(ctrl.state, AudioState.COMPLETED);
    });
  });

  /* ---------------- 7. AUDIO-STALE-CANCEL ---------------- */
  describe('7. AUDIO-STALE-CANCEL', () => {
    it('prevents user gestures from triggering playback after map load completes (fadeOut)', async () => {
      let playCalls = 0;
      class SpyingBlockedAudio extends SpyingAudio {
        async play() {
          playCalls++;
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          throw err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingBlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(playCalls, 1);

      // Map finishes loading -> fadeOut called
      await ctrl.fadeOut(20);

      // User interacts 5 seconds later in the spawn view
      doc.dispatch('pointerdown');
      doc.dispatch('click');
      await new Promise((r) => queueMicrotask(r));

      // Must NOT have attempted play again!
      assert.equal(playCalls, 1);
    });

    it('cancel() immediately terminates playback and disarms all gesture listeners', async () => {
      let playCalls = 0;
      class SpyingBlockedAudio extends SpyingAudio {
        async play() {
          playCalls++;
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          throw err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingBlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(playCalls, 1);

      assert.equal(doc.listenerCount('pointerdown'), 1);

      ctrl.cancel();

      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(doc.listenerCount('pointerdown'), 0);

      // Stale interaction
      doc.dispatch('pointerdown');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(playCalls, 1);
    });

    it('invalidates prior session on rapid map switching', async () => {
      let playResolveA;
      let playResolveB;
      let playCallCount = 0;

      class AsyncAudio extends SpyingAudio {
        play() {
          playCallCount++;
          this.paused = false;
          if (playCallCount === 1) {
            return new Promise((r) => { playResolveA = r; });
          } else {
            return new Promise((r) => { playResolveB = r; });
          }
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AsyncAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/mapA/music.mp3');
      assert.equal(mockAudioInstance.src, 'maps/mapA/music.mp3');

      // Rapidly switch to Map B before Map A's play promise settles
      ctrl.start('maps/mapB/music.mp3');
      assert.equal(mockAudioInstance.src, 'maps/mapB/music.mp3');

      // Now Map A settles
      if (playResolveA) {
        playResolveA();
      }
      await new Promise((r) => queueMicrotask(r));

      // Must still be pointing to Map B
      assert.equal(mockAudioInstance.src, 'maps/mapB/music.mp3');
      assert.equal(ctrl.state, AudioState.LOADING);
      assert.equal(mockAudioInstance.paused, false, 'Map A late resolution must not pause Map B');

      // Map B settles
      if (playResolveB) {
        playResolveB();
      }
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(mockAudioInstance.paused, false);
    });

    it('properly cleans up on dispose()', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      ctrl.dispose();
      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(mockAudioInstance.paused, true);
    });
  });

  /* ---------------- 8. ADVERSARIAL & EDGE-CASE RESILIENCE ---------------- */
  describe('8. ADVERSARIAL & EDGE-CASE RESILIENCE', () => {
    it('attachUnmuteButton after autoplay is blocked immediately renders visible', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Now attach button after the block already occurred
      const container = doc.createElement('div');
      const btn = ctrl.attachUnmuteButton(container);

      assert.equal(btn.hidden, false);
      assert.equal(btn.style.display, 'inline-flex');
    });

    it('handles rapid touch cascade (touchstart -> pointerdown -> click) safely', async () => {
      let playAttempts = 0;
      class CascadingAudio extends SpyingAudio {
        async play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          this.paused = false;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: CascadingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Fire touchstart, pointerdown, and click in rapid cascade
      doc.dispatch('touchstart');
      doc.dispatch('pointerdown');
      doc.dispatch('click');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      // Ensure play was only triggered once for the unlock
      assert.equal(playAttempts, 2);
    });

    it('fadeOut(0) immediately completes and cleans up state', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      await ctrl.fadeOut(0);
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(mockAudioInstance.paused, true);
    });

    it('cancel() called during active fadeOut immediately terminates and resolves fadeout promise', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      let fadeResolved = false;
      const fadePromise = ctrl.fadeOut(500).then(() => {
        fadeResolved = true;
      });

      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // Mid-fade cancel
      ctrl.cancel();
      await fadePromise;

      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(fadeResolved, true);
      assert.equal(mockAudioInstance.paused, true);
    });

    it('errors thrown in subscriber callbacks do not break controller execution', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      let healthyCallbackCalled = false;
      ctrl.onAutoplayBlocked(() => {
        throw new Error('Explosion in user callback');
      });
      ctrl.onAutoplayBlocked(() => {
        healthyCallbackCalled = true;
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(healthyCallbackCalled, true);
    });

    it('attaches to windowRef when documentRef is not provided', async () => {
      const mockWin = new MockDocument();
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        windowRef: mockWin,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(mockWin.listenerCount('pointerdown'), 1);

      mockAudioInstance._playReject = null;
      mockWin.dispatch('pointerdown');
      await new Promise((r) => queueMicrotask(r));

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(mockWin.listenerCount('pointerdown'), 0);
    });

    it('direct invocation of unlock() unblocks and starts playback', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: MockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await new Promise((r) => queueMicrotask(r));
      assert.equal(ctrl.isAutoplayBlocked(), true);

      mockAudioInstance._playReject = null;
      await ctrl.unlock();

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });
  });
});
