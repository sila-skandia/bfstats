/**
 * tests/unit/test_audio_edge_cases.js
 * Adversarial Stress Testing Suite for Milestone 2: Audio Pipeline & Autoplay Resilience
 *
 * Focus Areas:
 * 1. Late click after map completion (AUDIO-STALE-CANCEL): Map finishes loading, fadeOut completes.
 *    User clicks 5s later in spawn screen / 3D map. Verify loading music NEVER plays or leaks.
 * 2. Click during active fadeout: User clicks at T=200ms of an 800ms fadeout.
 *    Verify volume does NOT jump back to 1.0 or resurrect the fading track.
 * 3. Touch event cascade: Rapid touchstart -> pointerdown -> touchend -> click sequence.
 *    Verify atomic teardown and that play() is not called multiple redundant times.
 * 4. Blocked autoplay followed by fallback 404: Autoplay blocked, user un-mutes, primary URL returns 404.
 *    Verify fallback track plays cleanly.
 * 5. Detached DOM: Calling attachUnmuteButton() on detached elements or calling methods without document/window present.
 * 6. Stress Harness & Race Conditions: Concurrency, mid-flight promise cancellations, rapid session churning.
 *
 * Run with: node --test tests/unit/test_audio_edge_cases.js
 */

import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  LoadingAudioController,
  createLoadingAudioController,
  AudioState,
} from '../../tools/bf1942-models/viewer/audio.js';

/* ------------------------------------------------------------------
 * Advanced Mock Primitives for Adversarial Testing
 * ------------------------------------------------------------------ */

class MockAudioParam {
  constructor(initialValue = 1.0) {
    this.value = initialValue;
    this.timeline = []; // records history of { fn, v, t, realTime }
  }

  setValueAtTime(v, t) {
    this.value = v;
    this.timeline.push({ fn: 'setValueAtTime', v, t, time: Date.now() });
  }

  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.timeline.push({ fn: 'linearRampToValueAtTime', v, t, time: Date.now() });
  }

  cancelScheduledValues(t) {
    this.timeline.push({ fn: 'cancelScheduledValues', t, time: Date.now() });
  }
}

class MockGainNode {
  constructor() {
    this.gain = new MockAudioParam(1.0);
    this.connectedTo = null;
    this.disconnected = false;
  }

  connect(destination) {
    this.connectedTo = destination;
    this.disconnected = false;
  }

  disconnect() {
    this.connectedTo = null;
    this.disconnected = true;
  }
}

class MockAudioContext {
  constructor(options = {}) {
    this.state = options.state || 'running';
    this.currentTime = 0;
    this.destination = {};
    this.gainNodes = [];
    this.resumeCallCount = 0;
  }

  createGain() {
    const gn = new MockGainNode();
    this.gainNodes.push(gn);
    return gn;
  }

  createMediaElementSource(element) {
    return {
      element,
      connect(target) {},
      disconnect() {},
    };
  }

  async resume() {
    this.resumeCallCount++;
    this.state = 'running';
  }
}

class MockAudioElement {
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
    this.playHistory = []; // records src, volume, currentTime at each play()
    this.pauseHistory = [];

    this._playReject = null;
    this._playDelayMs = 0;
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
    const ev = typeof event === 'string' ? { type, target: this } : event;
    for (const item of [...entries]) {
      item.listener(ev);
      if (item.options && item.options.once) {
        this.removeEventListener(type, item.listener);
      }
    }
    if (type === 'error' && typeof this.onerror === 'function') {
      this.onerror(ev);
    }
  }

  async play() {
    this.playCount++;
    this.playHistory.push({
      src: this.src,
      volume: this.volume,
      currentTime: this.currentTime,
      timestamp: Date.now(),
    });

    if (this._playDelayMs > 0) {
      await delay(this._playDelayMs);
    }

    if (this._playReject) {
      this.paused = true;
      throw this._playReject;
    }
    this.paused = false;
  }

  pause() {
    this.pauseCount++;
    this.pauseHistory.push({
      src: this.src,
      volume: this.volume,
      currentTime: this.currentTime,
      timestamp: Date.now(),
    });
    this.paused = true;
  }
}

class MockDOMElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
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

class MockDOMDocument {
  constructor() {
    this.head = new MockDOMElement('head');
    this.body = new MockDOMElement('body');
    this._listeners = new Map();
  }

  createElement(tag) {
    return new MockDOMElement(tag);
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

  totalListenerCount() {
    let total = 0;
    for (const arr of this._listeners.values()) {
      total += arr.length;
    }
    return total;
  }
}

/* ------------------------------------------------------------------
 * Adversarial Test Suite
 * ------------------------------------------------------------------ */

describe('Milestone 2 Audio Adversarial Stress Suite', () => {
  let doc, activeAudio, activeCtx;

  class SpyingAudio extends MockAudioElement {
    constructor() {
      super();
      activeAudio = this;
    }
  }

  class SpyingContext extends MockAudioContext {
    constructor(opts) {
      super(opts);
      activeCtx = this;
    }
  }

  beforeEach(() => {
    doc = new MockDOMDocument();
    activeAudio = null;
    activeCtx = null;
  });

  /* ------------------------------------------------------------------
   * 1. Late click after map completion (AUDIO-STALE-CANCEL)
   * ------------------------------------------------------------------ */
  describe('1. Late click after map completion (AUDIO-STALE-CANCEL)', () => {
    it('ensures late clicks 5 seconds post-load NEVER resurrect loading audio or play', async () => {
      // Simulate autoplay was blocked during loading
      class BlockedLoadingAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Autoplay blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedLoadingAudio,
        audioContextClass: SpyingContext,
        fadeDurationMs: 20,
      });

      // Start loading screen music
      ctrl.start('maps/wake/vehicle4.mp3');
      await delay(5);
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
      assert.equal(activeAudio.playCount, 1); // 1 blocked attempt

      // Map finishes loading -> fadeOut(20) completes
      await ctrl.fadeOut(20);
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(activeAudio.paused, true);
      assert.equal(doc.totalListenerCount(), 0, 'All gesture listeners must be disarmed');

      // User interacts 5 seconds later in the spawn screen or 3D map
      // We simulate intense multi-gesture bombardment
      for (let i = 0; i < 20; i++) {
        doc.dispatch('pointerdown', { clientX: 100 + i, clientY: 200 + i });
        doc.dispatch('click', { clientX: 100 + i, clientY: 200 + i });
        doc.dispatch('keydown', { key: 'Space', code: 'Space' });
        doc.dispatch('touchstart', { touches: [{ clientX: 50, clientY: 50 }] });
      }

      // Also call unlock() directly as an adversarial test
      await ctrl.unlock();

      // Audio must remain completely silent and dead
      assert.equal(activeAudio.playCount, 1, 'play() must NEVER be called after map completes');
      assert.equal(activeAudio.paused, true);
      assert.equal(ctrl.state, AudioState.COMPLETED);
    });

    it('ensures attached unmute button does not leak or trigger late playback post-completion', async () => {
      class BlockedLoadingAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Autoplay blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const container = doc.createElement('div');
      doc.body.appendChild(container);

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedLoadingAudio,
        audioContextClass: SpyingContext,
        fadeDurationMs: 20,
      });

      const btn = ctrl.attachUnmuteButton(container);
      ctrl.start('maps/wake/vehicle4.mp3');
      await delay(5);

      assert.equal(btn.hidden, false);
      assert.equal(btn.style.display, 'inline-flex');

      // Map finishes loading -> fadeOut
      await ctrl.fadeOut(20);

      // Button must be hidden
      assert.equal(btn.hidden, true);
      assert.equal(btn.style.display, 'none');

      // Adversarial user clicks the hidden unmute button in the DOM 5s later
      activeAudio._playReject = null; // Unblock audio device
      btn.click();
      await delay(5);

      assert.equal(activeAudio.playCount, 1, 'Unmute button click post-fadeout must NOT trigger play()');
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(activeAudio.paused, true);
    });
  });

  /* ------------------------------------------------------------------
   * 2. Click during active fadeout
   * ------------------------------------------------------------------ */
  describe('2. Click during active fadeout', () => {
    it('verifies click at T=200ms of an 800ms fadeout does NOT reset volume to 1.0 or resurrect track (Web Audio)', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: SpyingContext,
        fadeDurationMs: 80,
      });

      ctrl.start('maps/el_alamein/theme.mp3');
      await delay(5);
      assert.equal(activeAudio.paused, false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);

      const initialPlayCount = activeAudio.playCount;
      const gainNode = activeCtx.gainNodes[0];

      // Initiate 80ms fadeout (representing 800ms)
      const fadePromise = ctrl.fadeOut(80);
      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // At T=20ms (~25% of fade), user clicks vigorously in the screen
      await delay(20);

      // Verify linear ramp was scheduled to 0.0
      const rampEntry = gainNode.gain.timeline.find((e) => e.fn === 'linearRampToValueAtTime');
      assert.ok(rampEntry, 'Must have scheduled linearRampToValueAtTime');
      assert.equal(rampEntry.v, 0.0);

      // Record gain history length before click
      const historyLengthBeforeClick = gainNode.gain.timeline.length;

      // User interaction occurs
      doc.dispatch('pointerdown');
      doc.dispatch('click');
      await ctrl.unlock(); // Even explicit unlock call during fadeout

      // Verify gain was NOT reset to 1.0 during active fadeout
      const callsAfterClick = gainNode.gain.timeline.slice(historyLengthBeforeClick);
      const invalidReset = callsAfterClick.find((e) => e.fn === 'setValueAtTime' && e.v === 1.0);
      assert.equal(invalidReset, undefined, 'Gain must NOT jump back to 1.0 during active fadeout');

      // Track must not have been restarted
      assert.equal(activeAudio.playCount, initialPlayCount, 'playCount must not increase during fadeout');

      // Wait for fadeout to complete
      await fadePromise;
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(activeAudio.paused, true);
      assert.equal(activeAudio.currentTime, 0);

      // Gain is safely restored only AFTER audio is paused
      const finalCall = gainNode.gain.timeline[gainNode.gain.timeline.length - 1];
      assert.equal(finalCall.fn, 'setValueAtTime');
      assert.equal(finalCall.v, 1.0);
    });

    it('verifies click at T=200ms does NOT reset volume to 1.0 under JS volume fallback', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: null, // Force JS volume interpolation
        fadeDurationMs: 100,
      });

      ctrl.start('maps/kursk/music.mp3');
      await delay(5);

      const fadePromise = ctrl.fadeOut(100);
      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // Wait 30ms (~30% progress)
      await delay(30);
      const volAtT30 = activeAudio.volume;
      assert.ok(volAtT30 < 1.0, `Volume should be attenuating, was ${volAtT30}`);
      assert.ok(volAtT30 > 0.0, `Volume should not be 0 yet, was ${volAtT30}`);

      // User clicks document at T=30ms
      doc.dispatch('click');
      await ctrl.unlock();

      // Volume must not jump back to 1.0
      assert.ok(activeAudio.volume <= volAtT30 + 0.05, `Volume jumped! was ${volAtT30}, now ${activeAudio.volume}`);

      await fadePromise;
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(activeAudio.paused, true);
    });

    it('handles concurrent/duplicate fadeOut() calls safely without hanging promises', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: SpyingContext,
        fadeDurationMs: 60,
      });

      ctrl.start('maps/omaha/music.mp3');
      await delay(5);

      // Call fadeOut twice in rapid succession
      const p1 = ctrl.fadeOut(60);
      await delay(10);
      const p2 = ctrl.fadeOut(60);

      // Both promises must settle
      const timeoutPromise = delay(200).then(() => {
        throw new Error('Timeout: fadeOut promise deadlock');
      });

      await Promise.race([
        Promise.all([p1, p2]),
        timeoutPromise,
      ]);

      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(activeAudio.paused, true);
    });
  });

  /* ------------------------------------------------------------------
   * 3. Touch event cascade
   * ------------------------------------------------------------------ */
  describe('3. Touch event cascade', () => {
    it('safely handles rapid touchstart -> pointerdown -> touchend -> click sequence with atomic teardown', async () => {
      let playAttempts = 0;
      class CascadingAudio extends SpyingAudio {
        async play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          this.paused = false;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: CascadingAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/tobruk/music.mp3');
      await delay(5);
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(playAttempts, 1);

      // Verify all 4 event types are listening
      assert.equal(doc.listenerCount('pointerdown'), 1);
      assert.equal(doc.listenerCount('keydown'), 1);
      assert.equal(doc.listenerCount('touchstart'), 1);
      assert.equal(doc.listenerCount('click'), 1);

      // Rapid mobile touch cascade
      doc.dispatch('touchstart', { type: 'touchstart' });
      // Synchronous check: immediately after the very first touchstart, ALL 4 MUST BE DISARMED
      assert.equal(doc.listenerCount('touchstart'), 0, 'touchstart listener must be removed');
      assert.equal(doc.listenerCount('pointerdown'), 0, 'pointerdown listener must be removed');
      assert.equal(doc.listenerCount('keydown'), 0, 'keydown listener must be removed');
      assert.equal(doc.listenerCount('click'), 0, 'click listener must be removed');

      // Subsequent events in the cascade fire immediately
      doc.dispatch('pointerdown', { type: 'pointerdown' });
      doc.dispatch('touchend', { type: 'touchend' });
      doc.dispatch('click', { type: 'click' });

      await delay(10);

      // Exactly 2 total play attempts: attempt 1 (initial blocked) + attempt 2 (gesture unlock)
      assert.equal(playAttempts, 2, 'play() must NOT be called redundantly across the touch cascade');
      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });

    it('safely handles touch cascade on the unmute button itself', async () => {
      let playAttempts = 0;
      class CascadingAudio extends SpyingAudio {
        async play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          this.paused = false;
        }
      }

      const container = doc.createElement('div');
      doc.body.appendChild(container);

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: CascadingAudio,
        audioContextClass: SpyingContext,
      });

      const btn = ctrl.attachUnmuteButton(container);
      ctrl.start('maps/bocage/music.mp3');
      await delay(5);

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(btn.hidden, false);

      // Touch cascade on button: document captures touchstart, then click fires on btn
      doc.dispatch('touchstart', { target: btn });
      btn.click();
      doc.dispatch('click', { target: btn });

      await delay(10);

      assert.equal(playAttempts, 2, 'Button click during touch cascade must not cause duplicate play calls');
      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(btn.hidden, true);
    });

    it('survives touch cascade while unlock play promise is slow / pending', async () => {
      let playCount = 0;
      class SlowUnlockAudio extends SpyingAudio {
        async play() {
          playCount++;
          if (playCount === 1) {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          // Simulate 25ms async device initialization delay
          await delay(25);
          this.paused = false;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SlowUnlockAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/stalingrad/music.mp3');
      await delay(5);
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Dispatch cascade while play() is slow
      doc.dispatch('touchstart');
      doc.dispatch('pointerdown');
      doc.dispatch('click');

      // Wait for slow play to finish
      await delay(40);

      assert.equal(playCount, 2);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(activeAudio.paused, false);
    });
  });

  /* ------------------------------------------------------------------
   * 4. Blocked autoplay followed by fallback 404
   * ------------------------------------------------------------------ */
  describe('4. Blocked autoplay followed by fallback 404', () => {
    it('plays fallback cleanly when primary track 404s after user gesture unlock', async () => {
      let playCount = 0;
      class PrimaryFailAfterUnlockAudio extends SpyingAudio {
        async play() {
          playCount++;
          if (playCount === 1) {
            // First attempt: autoplay blocked
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          // Second attempt: user unlocked, but primary URL fails to load
          if (this.src === 'maps/nonexistent/music.mp3') {
            // Simulate 404 error event dispatched by browser
            queueMicrotask(() => {
              this.dispatchEvent('error');
            });
            this.paused = false;
            return;
          }
          // Third attempt: fallback track succeeds!
          this.paused = false;
        }
      }

      let resolvedCalled = false;
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: PrimaryFailAfterUnlockAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.onAutoplayResolved(() => {
        resolvedCalled = true;
      });

      ctrl.start('maps/nonexistent/music.mp3', '_shared/music/vehicle4.mp3');
      await delay(5);

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(activeAudio.src, 'maps/nonexistent/music.mp3');

      // User provides interaction gesture
      doc.dispatch('click');
      await delay(20);

      // Controller should have caught 404 error and switched to fallback
      assert.equal(activeAudio.src, '_shared/music/vehicle4.mp3');
      assert.equal(activeAudio.paused, false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(resolvedCalled, true);
    });

    it('plays fallback cleanly when primary track 404s BEFORE user gesture unlock', async () => {
      let playAttempts = 0;
      class PreUnlock404Audio extends SpyingAudio {
        async play() {
          playAttempts++;
          // Any play attempt before user gesture is blocked
          if (this.paused) {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: PreUnlock404Audio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/corrupt/music.mp3', '_shared/music/vehicle4.mp3');
      await delay(5);
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Primary track emits 404 error while still waiting for user gesture
      activeAudio.dispatchEvent('error');
      await delay(5);

      // Should have switched src to fallback, but still blocked waiting gesture
      assert.equal(activeAudio.src, '_shared/music/vehicle4.mp3');
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);

      // Now user clicks to unlock
      activeAudio.paused = false; // Next play succeeds
      doc.dispatch('click');
      await delay(10);

      assert.equal(activeAudio.src, '_shared/music/vehicle4.mp3');
      assert.equal(activeAudio.paused, false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });

    it('does not crash or loop infinitely when both primary and fallback 404', async () => {
      class BothFailAudio extends SpyingAudio {
        async play() {
          if (this.src === 'maps/primary_404.mp3') {
            const err = new Error('NotAllowedError');
            err.name = 'NotAllowedError';
            throw err;
          }
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BothFailAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/primary_404.mp3', 'maps/fallback_404.mp3');
      await delay(5);

      // Primary 404
      activeAudio.dispatchEvent('error');
      await delay(5);
      assert.equal(activeAudio.src, 'maps/fallback_404.mp3');

      // Fallback also 404s
      activeAudio.dispatchEvent('error');
      await delay(5);

      // Must not re-trigger fallback loop
      assert.equal(activeAudio.src, 'maps/fallback_404.mp3');
    });

    it('recovers to fallback when primary track rejects play() with NotSupportedError during gesture unlock', async () => {
      let playAttempts = 0;
      class PlayRejectNotSupportedAudio extends SpyingAudio {
        async play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Autoplay blocked');
            err.name = 'NotAllowedError';
            throw err;
          }
          if (this.src === 'maps/corrupt_primary/music.mp3') {
            const err = new Error('Failed to load because no supported source was found');
            err.name = 'NotSupportedError';
            throw err;
          }
          this.paused = false;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: PlayRejectNotSupportedAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/corrupt_primary/music.mp3', '_shared/music/vehicle4.mp3');
      await delay(5);
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // User interacts to unlock
      doc.dispatch('click');
      await delay(15);

      // Expect fallback to have been engaged and playing
      assert.equal(activeAudio.src, '_shared/music/vehicle4.mp3');
      assert.equal(activeAudio.paused, false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });
  });

  /* ------------------------------------------------------------------
   * 5. Detached DOM & Missing Environments
   * ------------------------------------------------------------------ */
  describe('5. Detached DOM & Missing Environments', () => {
    it('attachUnmuteButton on detached DOM element functions correctly and handles click', async () => {
      class BlockedAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Autoplay blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: SpyingContext,
      });

      // Detached element: never added to doc.body
      const detachedContainer = doc.createElement('div');
      detachedContainer.style.pointerEvents = 'none';

      const btn = ctrl.attachUnmuteButton(detachedContainer);
      assert.ok(btn);
      assert.equal(detachedContainer.children.length, 1);
      assert.equal(btn.style.pointerEvents, 'auto');

      ctrl.start('maps/wake/music.mp3');
      await delay(5);

      assert.equal(btn.hidden, false);
      assert.equal(btn.style.display, 'inline-flex');

      // Unblock and click button on detached container
      activeAudio._playReject = null;
      btn.click();
      await delay(10);

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(btn.hidden, true);
    });

    it('operates completely headless without documentRef and windowRef present', async () => {
      class HeadlessAudio extends SpyingAudio {}

      const ctrl = createLoadingAudioController({
        documentRef: null,
        windowRef: null,
        audioClass: HeadlessAudio,
        audioContextClass: SpyingContext,
      });

      // All lifecycle methods must execute without throwing ReferenceError or TypeError
      assert.doesNotThrow(() => {
        ctrl.start('maps/berlin/music.mp3');
      });
      await delay(5);
      assert.equal(activeAudio.paused, false);

      const btn = ctrl.attachUnmuteButton(null);
      assert.equal(btn, null);

      await assert.doesNotReject(async () => {
        await ctrl.fadeOut(20);
      });
      assert.equal(ctrl.state, AudioState.COMPLETED);

      assert.doesNotThrow(() => {
        ctrl.cancel();
        ctrl.dispose();
      });
    });

    it('handles autoplay block gracefully in completely headless mode', async () => {
      class BlockedHeadlessAudio extends SpyingAudio {
        constructor() {
          super();
          const err = new Error('Autoplay blocked');
          err.name = 'NotAllowedError';
          this._playReject = err;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: null,
        windowRef: null,
        audioClass: BlockedHeadlessAudio,
        audioContextClass: SpyingContext,
      });

      // Autoplay blocked without document/window to attach gesture listeners
      ctrl.start('maps/berlin/music.mp3');
      await delay(5);

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);

      // Programmatic unlock works
      activeAudio._playReject = null;
      await ctrl.unlock();

      assert.equal(ctrl.isAutoplayBlocked(), false);
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });

    it('safely handles non-element containers passed to attachUnmuteButton', () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: SpyingContext,
      });

      assert.equal(ctrl.attachUnmuteButton(null), null);
      assert.equal(ctrl.attachUnmuteButton(undefined), null);
    });
  });

  /* ------------------------------------------------------------------
   * 6. Stress Harness & Race Conditions
   * ------------------------------------------------------------------ */
  describe('6. Stress Harness & Race Conditions', () => {
    it('cancels mid-flight slow play promise without leaking or playing audio afterwards', async () => {
      let playSettled = false;
      class DelayedAudio extends SpyingAudio {
        async play() {
          await delay(30);
          playSettled = true;
          this.paused = false;
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: DelayedAudio,
        audioContextClass: SpyingContext,
      });

      ctrl.start('maps/iwo_jima/music.mp3');
      // Cancel at T=10ms before play settles
      await delay(10);
      ctrl.cancel();
      assert.equal(ctrl.state, AudioState.CANCELLED);

      // Wait until play() completes at T=30ms
      await delay(35);
      assert.equal(playSettled, true);

      // Invariant: audio must remain paused, state CANCELLED
      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(activeAudio.paused, true, 'Audio must be paused if cancelled during pending play');
    });

    it('stress harness: 50 iterations of rapid random operations without uncaught exceptions or corruption', async () => {
      const ops = ['start', 'cancel', 'fadeOut', 'unlock', 'gesture'];
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: SpyingContext,
        fadeDurationMs: 15,
      });

      for (let i = 0; i < 50; i++) {
        const op = ops[i % ops.length];
        switch (op) {
          case 'start':
            ctrl.start(`maps/map_${i}/music.mp3`);
            break;
          case 'cancel':
            ctrl.cancel();
            break;
          case 'fadeOut':
            ctrl.fadeOut(15);
            break;
          case 'unlock':
            ctrl.unlock().catch(() => {});
            break;
          case 'gesture':
            doc.dispatch('click');
            doc.dispatch('pointerdown');
            break;
        }
        await delay(2);
      }

      // Cleanup
      ctrl.cancel();
      assert.equal(activeAudio.paused, true);
    });
  });
});
