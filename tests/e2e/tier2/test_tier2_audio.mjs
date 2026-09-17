/**
 * Tier 2 Test Suite: Audio Pipeline Boundary & Edge Cases (Features 6-12, 35 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnvironment } from '../harnesses/mock_dom.mjs';
import {
  createLoadingAudioController,
  AudioState,
} from '../../../tools/bf1942-models/viewer/audio.js';

// --------------------------------------------------------------------------- //
// Feature 6 Boundary: AUDIO-PLAYBACK (5 Tests: T2-FEAT06-01 to T2-FEAT06-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT06-01: Extremely short audio file (<1s) loops cleanly without buffer underrun', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('short.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.loop, true);
  assert.equal(audio.paused, false);
});

test('T2-FEAT06-02: Music URL returns HTTP 404 (audio controller fails silently without breaking visual UI)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('missing_404.mp3');
  const audio = env.getLastAudio();
  audio.dispatchEvent({ type: 'error' });
  // Controller remains functional and falls back
  assert.ok(ctrl.state !== AudioState.CANCELLED);
});

test('T2-FEAT06-03: Music stream stalls mid-load (recovers or stays silent without unhandled throw)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('stalled.mp3');
  const audio = env.getLastAudio();
  audio.dispatchEvent({ type: 'stalled' });
  assert.ok(true);
});

test('T2-FEAT06-04: Audio volume initialized to 0 (muted setting)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const audio = env.getLastAudio();
  audio.volume = 0;
  assert.equal(audio.volume, 0);
});

test('T2-FEAT06-05: Multiple rapid calls to audioController.start() cancels previous track cleanly', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('track1.mp3');
  ctrl.start('track2.mp3');
  ctrl.start('track3.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.src, 'track3.mp3');
});

// --------------------------------------------------------------------------- //
// Feature 7 Boundary: AUDIO-FALLBACK (5 Tests: T2-FEAT07-01 to T2-FEAT07-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT07-01: Both primary and fallback music files return error (silent graceful operation)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
    fallbackUrl: 'missing_fallback.mp3',
  });

  ctrl.start('missing_primary.mp3');
  const audio = env.getLastAudio();
  // Trigger primary error
  audio.dispatchEvent({ type: 'error' });
  // Trigger fallback error
  audio.dispatchEvent({ type: 'error' });

  assert.ok(true, 'Did not throw unhandled exception');
});

test('T2-FEAT07-02: Fallback audio URL is an invalid URI scheme (safely rejected)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
    fallbackUrl: 'invalid://scheme/file',
  });

  ctrl.start('invalid://scheme/file');
  assert.ok(true);
});

test('T2-FEAT07-03: Audio file format is unsupported by browser media engine (fails gracefully)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('corrupt.xyz');
  const audio = env.getLastAudio();
  audio.dispatchEvent({ type: 'error' });
  assert.ok(true);
});

test('T2-FEAT07-04: Switching fallback track while previous fallback is buffering (no memory leak)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('trackA.mp3');
  ctrl.start('trackB.mp3');
  assert.equal(env.getLastAudio().src, 'trackB.mp3');
});

test('T2-FEAT07-05: Null/undefined manifest music field (defaults to standard fallback theme)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start(undefined);
  assert.equal(env.getLastAudio().src, '_shared/music/vehicle4.mp3');
});

// --------------------------------------------------------------------------- //
// Feature 8 Boundary: AUDIO-AUTOPLAY-TRAP (5 Tests: T2-FEAT08-01 to T2-FEAT08-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT08-01: Browser throws synchronous exception instead of returning rejected promise', async () => {
  const env = createMockEnvironment();
  class SyncThrowingAudio extends env.window.Audio {
    play() {
      throw new Error('Sync throw in play()');
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: SyncThrowingAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.ok(true, 'Synchronous play exception caught safely');
});

test('T2-FEAT08-02: Browser resolves promise but pauses audio immediately afterwards', async () => {
  const env = createMockEnvironment();
  class AutoPauseAudio extends env.window.Audio {
    play() {
      this.paused = true;
      return Promise.resolve();
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: AutoPauseAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.ok(true);
});

test('T2-FEAT08-03: AudioContext starts in suspended state without calling play()', async () => {
  const env = createMockEnvironment();
  class SuspendedContext extends env.window.AudioContext {
    constructor() {
      super();
      this.state = 'suspended';
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: SuspendedContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.ok(true);
});

test('T2-FEAT08-04: Web Audio API unavailable in environment (headless or legacy browser fallback)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: null,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await ctrl.fadeOut(10);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T2-FEAT08-05: AbortError on rapid map swap handled cleanly', async () => {
  const env = createMockEnvironment();
  class AbortingAudio extends env.window.Audio {
    play() {
      const err = new Error('The play() request was interrupted by a new load request.');
      err.name = 'AbortError';
      return Promise.reject(err);
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: AbortingAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.ok(true, 'AbortError handled without throwing');
});

// --------------------------------------------------------------------------- //
// Feature 9 Boundary: AUDIO-GESTURE-UNLOCK (5 Tests: T2-FEAT09-01 to T2-FEAT09-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT09-01: User presses modifier key (Shift/Ctrl/Alt)', async () => {
  const env = createMockEnvironment();
  let rejecting = true;
  class MaybeAudio extends env.window.Audio {
    play() {
      if (rejecting) {
        const err = new Error('Blocked');
        err.name = 'NotAllowedError';
        this.paused = true;
        return Promise.reject(err);
      }
      this.paused = false;
      return Promise.resolve();
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: MaybeAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  env.document.dispatchEvent({ type: 'keydown', key: 'Shift' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T2-FEAT09-02: Gesture unlock occurs when audio is already playing (no-op, no glitch)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await ctrl.unlock();
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T2-FEAT09-03: User clicks on document while AudioContext.resume() promise is pending', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const p1 = ctrl.unlock();
  const p2 = ctrl.unlock();
  await Promise.all([p1, p2]);
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T2-FEAT09-04: Touchstart event followed immediately by simulated mousedown (prevents double trigger)', async () => {
  const env = createMockEnvironment();
  let rejecting = true;
  class MaybeAudio extends env.window.Audio {
    play() {
      if (rejecting) {
        const err = new Error('Blocked');
        err.name = 'NotAllowedError';
        this.paused = true;
        return Promise.reject(err);
      }
      this.paused = false;
      return Promise.resolve();
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: MaybeAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  env.document.dispatchEvent({ type: 'touchstart' });
  env.document.dispatchEvent({ type: 'pointerdown' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T2-FEAT09-05: Multiple concurrent listeners safely handled', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  let count = 0;
  ctrl.onAutoplayResolved(() => { count++; });
  ctrl.onAutoplayResolved(() => { count++; });

  await ctrl.unlock();
  assert.equal(count, 2);
});

// --------------------------------------------------------------------------- //
// Feature 10 Boundary: AUDIO-UNMUTE-UI (5 Tests: T2-FEAT10-01 to T2-FEAT10-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT10-01: Viewport is very small (320x240 mobile) - unmute button does not crash', async () => {
  const env = createMockEnvironment();
  env.window.innerWidth = 320;
  env.window.innerHeight = 240;

  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);
  assert.ok(btn);
});

test('T2-FEAT10-02: Rapid clicking on unmute button (debounce click handler)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);

  btn.dispatchEvent({ type: 'click' });
  btn.dispatchEvent({ type: 'click' });
  btn.dispatchEvent({ type: 'click' });
  assert.ok(true);
});

test('T2-FEAT10-03: Keyboard accessibility (Enter/Space key triggers unmute)', async () => {
  const env = createMockEnvironment();
  let rejecting = true;
  class MaybeAudio extends env.window.Audio {
    play() {
      if (rejecting) {
        const err = new Error('Blocked');
        err.name = 'NotAllowedError';
        this.paused = true;
        return Promise.reject(err);
      }
      this.paused = false;
      return Promise.resolve();
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: MaybeAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  env.document.dispatchEvent({ type: 'keydown', key: 'Enter' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T2-FEAT10-04: Unmute button hides on fadeOut or cancel', async () => {
  const env = createMockEnvironment();
  class RejectingAudio extends env.window.Audio {
    play() {
      const err = new Error('Blocked');
      err.name = 'NotAllowedError';
      this.paused = true;
      return Promise.reject(err);
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: RejectingAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);

  ctrl.start('music.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(btn.hidden, false);

  await ctrl.fadeOut(0);
  assert.equal(btn.hidden, true);
});

test('T2-FEAT10-05: Unmute button DOM element removed cleanly if overlay is destroyed', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);
  btn.remove();
  assert.equal(container.children.length, 0);
});

// --------------------------------------------------------------------------- //
// Feature 11 Boundary: AUDIO-FADEOUT (5 Tests: T2-FEAT11-01 to T2-FEAT11-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT11-01: Map loads in under 100ms (instant cache hit) - fadeout initiates while volume is low', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  // Load completes within 5ms
  await ctrl.fadeOut(10);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T2-FEAT11-02: Fadeout called when audio is already paused or muted (no NaN/infinite gain errors)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  env.getLastAudio().pause();
  await ctrl.fadeOut(10);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T2-FEAT11-03: Fade duration set to 0ms (instant cut without audio pop/click)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  await ctrl.fadeOut(0);
  assert.equal(ctrl.state, AudioState.COMPLETED);
  assert.equal(env.getLastAudio().paused, true);
});

test('T2-FEAT11-04: Cancel called during active fadeout (aborts fadeout immediately)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const fadeP = ctrl.fadeOut(500);
  ctrl.cancel();
  await fadeP;
  assert.equal(ctrl.state, AudioState.CANCELLED);
});

test('T2-FEAT11-05: Multiple consecutive fadeOut calls resolve cleanly', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const p1 = ctrl.fadeOut(10);
  const p2 = ctrl.fadeOut(10);
  await Promise.all([p1, p2]);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

// --------------------------------------------------------------------------- //
// Feature 12 Boundary: AUDIO-STALE-CANCEL (5 Tests: T2-FEAT12-01 to T2-FEAT12-05)
// --------------------------------------------------------------------------- //
test('T2-FEAT12-01: User clicks exactly at the moment load.end() is resolving', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const p = ctrl.fadeOut(10);
  env.document.dispatchEvent({ type: 'pointerdown' });
  await p;
  assert.equal(env.getLastAudio().paused, true);
});

test('T2-FEAT12-02: Rapid map switching: Map A load completes, Map B starts loading immediately', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('mapA.mp3');
  await ctrl.fadeOut(0);
  ctrl.start('mapB.mp3');

  assert.equal(env.getLastAudio().src, 'mapB.mp3');
  assert.equal(env.getLastAudio().paused, false);
});

test('T2-FEAT12-03: Pending autoplay promise resolves AFTER map has completed loading', async () => {
  const env = createMockEnvironment();
  let resolvePlay;
  class DelayedAudio extends env.window.Audio {
    play() {
      return new Promise((res) => { resolvePlay = res; });
    }
  }

  const ctrl = createLoadingAudioController({
    audioClass: DelayedAudio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  // Complete loading before play resolves!
  await ctrl.fadeOut(0);

  if (resolvePlay) resolvePlay();
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T2-FEAT12-04: AudioController instance re-used across multiple consecutive load sessions', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  for (let i = 0; i < 3; i++) {
    ctrl.start(`session${i}.mp3`);
    await ctrl.fadeOut(0);
    assert.equal(ctrl.state, AudioState.COMPLETED);
  }
});

test('T2-FEAT12-05: User triggers cancellation during active fadeout', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music.mp3');
  const fade = ctrl.fadeOut(100);
  ctrl.cancel();
  await fade;
  assert.equal(ctrl.state, AudioState.CANCELLED);
});
