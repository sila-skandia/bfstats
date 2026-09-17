/**
 * tests/unit/test_audio_stress.js
 * Adversarial Concurrency, Stress & Invariant Test Suite for Milestone 2: Audio Controller
 *
 * Focus areas:
 * 1. Rapid map switching (start(A) -> start(B) -> start(C), out-of-order promise settling, ghost audio/pauses)
 * 2. Interrupted play promises (AbortError, cancel/fadeOut while play() is pending, post-await race conditions in unlock())
 * 3. Rapid succession cycles (100 iterations of start/cancel/fadeOut/unlock/errors, invariant verification)
 * 4. Microtask & subscriber re-entrancy, concurrent fadeOut promises, and error propagation
 *
 * Run with: node --test tests/unit/test_audio_stress.js
 */

import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LoadingAudioController,
  createLoadingAudioController,
  AudioState,
} from '../../tools/bf1942-models/viewer/audio.js';

/* ------------------------------------------------------------------
 * Advanced Mock Primitives with Timing & Inspection Controls
 * ------------------------------------------------------------------ */

const flushMicrotasks = async (count = 5) => {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
};

class AdvancedMockAudioParam {
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

class AdvancedMockGainNode {
  constructor() {
    this.gain = new AdvancedMockAudioParam(1.0);
    this.connectedTo = null;
  }

  connect(dest) {
    this.connectedTo = dest;
  }

  disconnect() {
    this.connectedTo = null;
  }
}

class AdvancedMockAudioContext {
  constructor(options = {}) {
    this.state = options.state || 'running';
    this.currentTime = 0;
    this.destination = {};
    this.resumeCalled = false;
    this.createdGainNodes = [];
  }

  createGain() {
    const gn = new AdvancedMockGainNode();
    this.createdGainNodes.push(gn);
    return gn;
  }

  createMediaElementSource(element) {
    return {
      element,
      connect() {},
      disconnect() {},
    };
  }

  async resume() {
    this.resumeCalled = true;
    this.state = 'running';
  }
}

class AdvancedMockAudio {
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
    this.history = [];

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
      this.history.push({ action: 'play_reject', src: this.src });
      throw this._playReject;
    }
    this.paused = false;
    this.history.push({ action: 'play_resolve', src: this.src });
  }

  pause() {
    this.pauseCount++;
    this.paused = true;
    this.history.push({ action: 'pause', src: this.src });
  }
}

class AdvancedMockElement {
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
    const fakeEvent = {
      type: 'click',
      target: this,
      currentTarget: this,
      stopPropagation: () => {},
      preventDefault: () => {},
    };
    const entries = this._listeners.get('click') || [];
    for (const item of [...entries]) {
      item.listener(fakeEvent);
      if (item.options && item.options.once) {
        this.removeEventListener('click', item.listener);
      }
    }
  }
}

class AdvancedMockDocument {
  constructor() {
    this.head = new AdvancedMockElement('head');
    this.body = new AdvancedMockElement('body');
    this._listeners = new Map();
  }

  createElement(tag) {
    return new AdvancedMockElement(tag);
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
 * Adversarial Stress Tests
 * ------------------------------------------------------------------ */

describe('Milestone 2 Audio Adversarial Stress Testing', () => {
  let doc;
  let audioInstance;
  let unhandledRejections = [];

  const unhandledHandler = (reason) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    doc = new AdvancedMockDocument();
    audioInstance = null;
    unhandledRejections = [];
    process.on('unhandledRejection', unhandledHandler);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', unhandledHandler);
  });

  class SpyingAudio extends AdvancedMockAudio {
    constructor() {
      super();
      audioInstance = this;
    }
  }

  /* ================================================================
   * Focus 1: Rapid Map Switching
   * ================================================================ */
  describe('Focus 1: Rapid Map Switching Concurrency', () => {
    it('1.1: Out-of-order promise settling: Map A late resolution must NOT pause active Map C playback', async () => {
      let resolveA, resolveB, resolveC;
      let playCalls = 0;

      class OutOfOrderAudio extends SpyingAudio {
        play() {
          playCalls++;
          const callId = playCalls;
          this.paused = false;
          return new Promise((resolve) => {
            if (callId === 1) resolveA = resolve;
            else if (callId === 2) resolveB = resolve;
            else if (callId === 3) resolveC = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: OutOfOrderAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      // Rapidly start Map A, Map B, Map C
      ctrl.start('maps/mapA/music.mp3');
      ctrl.start('maps/mapB/music.mp3');
      ctrl.start('maps/mapC/music.mp3');

      assert.equal(audioInstance.src, 'maps/mapC/music.mp3', 'Audio element src must be Map C');
      assert.equal(playCalls, 3);

      // Map C resolves first and enters ACTIVE_PLAYING
      resolveC();
      await flushMicrotasks();

      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(audioInstance.paused, false, 'Audio should currently be playing Map C');

      // Now Map A (obsolete session 1) finally resolves
      resolveA();
      await flushMicrotasks();

      // CHALLENGE: In audio.js:470, an obsolete session executes this._audio.pause()!
      // This pauses the shared audio element currently playing Map C!
      assert.equal(
        audioInstance.paused,
        false,
        'CRITICAL DEFECT: Map A late resolution called pause() on active Map C session!'
      );
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);

      resolveB();
      await flushMicrotasks();
      assert.equal(audioInstance.paused, false);

      assert.equal(unhandledRejections.length, 0);
    });

    it('1.2: In-order promise settling: prior sessions A and B must NOT pause Map C', async () => {
      let resolveA, resolveB, resolveC;
      let playCalls = 0;

      class InOrderAudio extends SpyingAudio {
        play() {
          playCalls++;
          const callId = playCalls;
          this.paused = false;
          return new Promise((resolve) => {
            if (callId === 1) resolveA = resolve;
            else if (callId === 2) resolveB = resolve;
            else if (callId === 3) resolveC = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: InOrderAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/mapA/music.mp3');
      ctrl.start('maps/mapB/music.mp3');
      ctrl.start('maps/mapC/music.mp3');

      // Settle A, then B, then C
      resolveA();
      await flushMicrotasks();

      resolveB();
      await flushMicrotasks();

      resolveC();
      await flushMicrotasks();

      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(audioInstance.src, 'maps/mapC/music.mp3');
      assert.equal(
        audioInstance.paused,
        false,
        'CRITICAL DEFECT: Prior sessions paused the audio element, leaving Map C paused despite ACTIVE_PLAYING'
      );

      assert.equal(unhandledRejections.length, 0);
    });

    it('1.3: Error event on an obsolete map session does NOT redirect active map to fallback', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/mapA/music.mp3', '_shared/music/fallback.mp3');
      const errorListenerA = audioInstance._onError;

      ctrl.start('maps/mapB/music.mp3', '_shared/music/fallback.mp3');
      assert.equal(audioInstance.src, 'maps/mapB/music.mp3');

      // Simulate obsolete Map A error firing late
      if (errorListenerA) {
        errorListenerA();
      }

      // Map B must NOT be replaced by fallback
      assert.equal(audioInstance.src, 'maps/mapB/music.mp3', 'Map B must not be altered by Map A error');
    });

    it('1.4: Autoplay block rejection on obsolete map does NOT block active map', async () => {
      let rejectA, resolveB;
      let playCalls = 0;

      class CustomAudio extends SpyingAudio {
        play() {
          playCalls++;
          const callId = playCalls;
          return new Promise((resolve, reject) => {
            if (callId === 1) rejectA = reject;
            else if (callId === 2) resolveB = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: CustomAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      let blockedNotified = false;
      ctrl.onAutoplayBlocked(() => {
        blockedNotified = true;
      });

      ctrl.start('maps/mapA/music.mp3');
      ctrl.start('maps/mapB/music.mp3');

      // Map A rejects with NotAllowedError (autoplay blocked)
      const err = new Error('NotAllowedError');
      err.name = 'NotAllowedError';
      rejectA(err);
      await flushMicrotasks();

      // Map B resolves normally
      resolveB();
      await flushMicrotasks();

      assert.equal(ctrl.isAutoplayBlocked(), false, 'Map B was not blocked, so isAutoplayBlocked must be false');
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
      assert.equal(blockedNotified, false, 'Obsolete Map A block should not trigger blocked callback');
      assert.equal(unhandledRejections.length, 0);
    });
  });

  /* ================================================================
   * Focus 2: Interrupted Play Promise (AbortError) & Lifecycle Transitions
   * ================================================================ */
  describe('Focus 2: Interrupted Play Promise (AbortError) & Lifecycle Race Conditions', () => {
    it('2.1: start() immediately followed by cancel() before play() rejects with AbortError', async () => {
      let rejectPlay;
      class AbortAudio extends SpyingAudio {
        play() {
          this.paused = false;
          return new Promise((_, reject) => {
            rejectPlay = reject;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AbortAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      assert.equal(ctrl.state, AudioState.LOADING);

      // Cancel immediately while play() is pending
      ctrl.cancel();
      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(audioInstance.paused, true);

      // Browser rejects play() with AbortError due to pause()
      const abortErr = new Error('The play() request was interrupted by a call to pause().');
      abortErr.name = 'AbortError';
      rejectPlay(abortErr);

      await flushMicrotasks();

      assert.equal(ctrl.state, AudioState.CANCELLED);
      assert.equal(audioInstance.paused, true);
      assert.equal(unhandledRejections.length, 0, 'Zero unhandled promise rejections');
    });

    it('2.2: start() followed by fadeOut(100) before play() resolves: play resolution must NOT kill fadeout prematurely', async () => {
      let resolvePlay;
      class DelayedAudio extends SpyingAudio {
        play() {
          this.paused = false;
          return new Promise((resolve) => {
            resolvePlay = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: DelayedAudio,
        audioContextClass: AdvancedMockAudioContext,
        fadeDurationMs: 100,
      });

      ctrl.start('maps/wake/music.mp3');

      // Call fadeOut while play() is still pending
      const fadePromise = ctrl.fadeOut(100);
      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // Now play resolves while mid-fade
      resolvePlay();
      await flushMicrotasks();

      // CHALLENGE: In audio.js:195, fadeOut sets this._isStale = true.
      // In audio.js:469, playPromise.then() checks (this._isStale) and calls this._audio.pause()!
      // This abruptly pauses audio in the middle of an active fadeout instead of fading!
      assert.equal(
        ctrl.state,
        AudioState.FADING_OUT,
        'State should remain FADING_OUT until fade duration finishes'
      );
      assert.equal(
        audioInstance.paused,
        false,
        'CRITICAL DEFECT: playPromise.then() prematurely paused audio during active fadeout!'
      );

      await fadePromise;
      assert.equal(ctrl.state, AudioState.COMPLETED);
      assert.equal(audioInstance.paused, true);
      assert.equal(unhandledRejections.length, 0);
    });

    it('2.3: unlock() pending play promise race: cancel() called during await p must NOT resurrect to ACTIVE_PLAYING', async () => {
      let resolveUnlockPlay;
      let playAttempts = 0;
      class AsyncUnlockAudio extends SpyingAudio {
        play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Blocked');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          }
          this.paused = false;
          return new Promise((resolve) => {
            resolveUnlockPlay = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AsyncUnlockAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks();
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Trigger unlock
      const unlockPromise = ctrl.unlock();

      // Mid-unlock, user cancels
      ctrl.cancel();
      assert.equal(ctrl.state, AudioState.CANCELLED);

      // Now the unlock play promise settles
      if (resolveUnlockPlay) {
        resolveUnlockPlay();
      }
      await unlockPromise;
      await flushMicrotasks();

      // CHALLENGE: audio.js:366 unconditionally sets this._state = AudioState.ACTIVE_PLAYING
      // after await p, without checking this._isCancelled or this._isStale!
      assert.equal(
        ctrl.state,
        AudioState.CANCELLED,
        'CRITICAL DEFECT: unlock() post-await resurrected cancelled controller to ACTIVE_PLAYING!'
      );
      assert.equal(audioInstance.paused, true, 'Audio must remain paused');
    });

    it('2.4: unlock() pending play promise race: fadeOut() called during await p must NOT resurrect to ACTIVE_PLAYING', async () => {
      let resolveUnlockPlay;
      let playAttempts = 0;
      class AsyncUnlockAudio extends SpyingAudio {
        play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Blocked');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          }
          this.paused = false;
          return new Promise((resolve) => {
            resolveUnlockPlay = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AsyncUnlockAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks();
      assert.equal(ctrl.isAutoplayBlocked(), true);

      const unlockPromise = ctrl.unlock();

      // Scene loads: fadeOut(0) called
      await ctrl.fadeOut(0);
      assert.equal(ctrl.state, AudioState.COMPLETED);

      // Unlock settles
      if (resolveUnlockPlay) {
        resolveUnlockPlay();
      }
      await unlockPromise;
      await flushMicrotasks();

      // CHALLENGE: audio.js:366 overwrites AudioState.COMPLETED with ACTIVE_PLAYING!
      assert.equal(
        ctrl.state,
        AudioState.COMPLETED,
        'CRITICAL DEFECT: unlock() post-await resurrected completed/faded controller to ACTIVE_PLAYING!'
      );
      assert.equal(audioInstance.paused, true, 'Audio must remain paused');
    });
  });

  /* ================================================================
   * Focus 3: Rapid Succession Cycles (Stress Harness)
   * ================================================================ */
  describe('Focus 3: Rapid Succession Cycles (100 Iterations Stress Harness)', () => {
    it('3.1: 100 iterations of rapid start/cancel/fadeOut/unlock maintain state & paused invariant', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: AdvancedMockAudioContext,
        fadeDurationMs: 5,
      });

      for (let i = 0; i < 100; i++) {
        const mod = i % 5;
        if (mod === 0) {
          ctrl.start(`maps/map_${i}/music.mp3`);
        } else if (mod === 1) {
          ctrl.cancel();
        } else if (mod === 2) {
          ctrl.start(`maps/map_${i}_b/music.mp3`);
        } else if (mod === 3) {
          ctrl.fadeOut(5).catch(() => {});
        } else if (mod === 4) {
          ctrl.unlock().catch(() => {});
        }

        await flushMicrotasks(2);

        // INVARIANT 1: If CANCELLED, audio must be paused
        if (ctrl.state === AudioState.CANCELLED) {
          assert.equal(
            audioInstance.paused,
            true,
            `Invariant violation at iteration ${i}: state is CANCELLED but audio.paused is false`
          );
        }

        // INVARIANT 2: Document gesture listeners must never duplicate (max 1)
        assert.ok(
          doc.listenerCount('pointerdown') <= 1,
          `Listener leak at iteration ${i}: pointerdown count is ${doc.listenerCount('pointerdown')}`
        );
      }

      await new Promise((r) => setTimeout(r, 20));
      assert.equal(unhandledRejections.length, 0, 'Zero unhandled promise rejections after 100 cycles');
    });
  });

  /* ================================================================
   * Focus 4: Microtask, Re-Entrancy, and Promise Leaks
   * ================================================================ */
  describe('Focus 4: Microtask, Re-Entrancy & Promise Leaks', () => {
    it('4.1: Concurrent fadeOut() calls must ALL resolve and not hang', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: AdvancedMockAudioContext,
        fadeDurationMs: 40,
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks();

      let p1Resolved = false;
      let p2Resolved = false;

      // Call fadeOut twice concurrently
      const p1 = ctrl.fadeOut(30).then(() => { p1Resolved = true; });
      const p2 = ctrl.fadeOut(30).then(() => { p2Resolved = true; });

      // CHALLENGE: In audio.js:220, the second call overwrites this._fadeResolve.
      // One of the two promises is permanently orphaned and never resolves!
      await Promise.race([
        Promise.all([p1, p2]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT: Hanging fade promise')), 200)),
      ]);

      assert.equal(p1Resolved, true, 'First fadeOut promise must resolve');
      assert.equal(p2Resolved, true, 'Second fadeOut promise must resolve');
      assert.equal(ctrl.state, AudioState.COMPLETED);
    });

    it('4.2: start() called during active fadeOut() must NOT leave fade promise hanging forever', async () => {
      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: SpyingAudio,
        audioContextClass: AdvancedMockAudioContext,
        fadeDurationMs: 100,
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks();

      let fadeResolved = false;
      const fadePromise = ctrl.fadeOut(100).then(() => {
        fadeResolved = true;
      });

      assert.equal(ctrl.state, AudioState.FADING_OUT);

      // User initiates new map load mid-fade
      ctrl.start('maps/kursk/music.mp3');

      // CHALLENGE: In audio.js:134, start() calls this._clearFadeTimer() but does NOT resolve
      // this._fadeResolve! Any caller awaiting fadeOut() hangs forever!
      await Promise.race([
        fadePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT: fadeOut promise hung indefinitely when superseded by start()')), 200)),
      ]);

      assert.equal(fadeResolved, true, 'fadeOut promise must resolve even if superseded by start()');
    });

    it('4.3: Subscriber throwing error during onAutoplayBlocked does not disrupt other subscribers', async () => {
      let playCount = 0;
      class BlockedAudio extends SpyingAudio {
        play() {
          playCount++;
          const err = new Error('Blocked');
          err.name = 'NotAllowedError';
          return Promise.reject(err);
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      let healthySubscriberCalled = false;
      ctrl.onAutoplayBlocked(() => {
        throw new Error('Subscriber error');
      });
      ctrl.onAutoplayBlocked(() => {
        healthySubscriberCalled = true;
      });

      ctrl.start('maps/initial/music.mp3');
      await flushMicrotasks(4);

      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(healthySubscriberCalled, true, 'Healthy subscriber should be called despite first throwing');
    });

    it('4.4: Subscriber throwing error during onAutoplayResolved does not disrupt other subscribers or controller', async () => {
      let playAttempts = 0;
      class BlockedThenAllowedAudio extends SpyingAudio {
        play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Blocked');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          }
          this.paused = false;
          return Promise.resolve();
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: BlockedThenAllowedAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      let secondCallbackCalled = false;
      ctrl.onAutoplayResolved(() => {
        throw new Error('Subscriber 1 explosive error');
      });
      ctrl.onAutoplayResolved(() => {
        secondCallbackCalled = true;
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks(4);
      assert.equal(ctrl.isAutoplayBlocked(), true);

      // Unlock
      doc.dispatch('pointerdown');
      await flushMicrotasks(4);

      assert.equal(secondCallbackCalled, true, 'Second subscriber must be notified despite first throwing');
      assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
    });

    it('4.5: State consistency check: unlock() must not leave isAutoplayBlocked out of sync with state', async () => {
      let resolveUnlockPlay;
      let playAttempts = 0;
      class AsyncUnlockAudio extends SpyingAudio {
        play() {
          playAttempts++;
          if (playAttempts === 1) {
            const err = new Error('Blocked');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          }
          this.paused = false;
          return new Promise((resolve) => {
            resolveUnlockPlay = resolve;
          });
        }
      }

      const ctrl = createLoadingAudioController({
        documentRef: doc,
        audioClass: AsyncUnlockAudio,
        audioContextClass: AdvancedMockAudioContext,
      });

      ctrl.start('maps/wake/music.mp3');
      await flushMicrotasks(4);
      assert.equal(ctrl.isAutoplayBlocked(), true);
      assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);

      // Begin unlock
      const unlockPromise = ctrl.unlock();

      // CHALLENGE: In audio.js:346, this._isAutoplayBlocked is set to false,
      // but this._state remains BLOCKED_WAITING_GESTURE while awaiting play()!
      // If code checks ctrl.state === BLOCKED_WAITING_GESTURE and ctrl.isAutoplayBlocked(), they contradict!
      const isBlocked = ctrl.isAutoplayBlocked();
      const state = ctrl.state;
      assert.equal(
        isBlocked,
        state === AudioState.BLOCKED_WAITING_GESTURE,
        `Contradictory state during unlock: isAutoplayBlocked()=${isBlocked} but state=${state}`
      );

      resolveUnlockPlay();
      await unlockPromise;
      await flushMicrotasks();
    });
  });
});
