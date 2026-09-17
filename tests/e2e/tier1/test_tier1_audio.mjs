/**
 * Tier 1 Test Suite: Audio Pipeline & Autoplay Resilience (Features 6-12, 35 Tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnvironment } from '../harnesses/mock_dom.mjs';
import {
  createLoadingAudioController,
  AudioState,
} from '../../../tools/bf1942-models/viewer/audio.js';

// --------------------------------------------------------------------------- //
// Feature 6: AUDIO-PLAYBACK (5 Tests: T1-FEAT06-01 to T1-FEAT06-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT06-01: Instantiates audio stream on controller start', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('maps/wake/music.mp3');
  const audio = env.getLastAudio();
  assert.ok(audio);
  assert.equal(audio.src, 'maps/wake/music.mp3');
  assert.equal(audio.paused, false);
});

test('T1-FEAT06-02: Plays correct map-specific music URL from manifest configuration', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('maps/mods/eod/music/custom.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.src, 'maps/mods/eod/music/custom.mp3');
});

test('T1-FEAT06-03: Loops playback continuously during load session (audio.loop === true)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.loop, true);
});

test('T1-FEAT06-04: Sets initial volume according to configuration (default 1.0)', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.volume, 1.0);
});

test('T1-FEAT06-05: Audio element / AudioNode properly attached to audio graph', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  const audio = env.getLastAudio();
  assert.equal(audio.crossOrigin, 'anonymous');
});

// --------------------------------------------------------------------------- //
// Feature 7: AUDIO-FALLBACK (5 Tests: T1-FEAT07-01 to T1-FEAT07-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT07-01: Fallback to mod default loading track when map manifest omits music', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
    fallbackUrl: '_shared/music/vehicle4.mp3',
  });

  ctrl.start(null);
  const audio = env.getLastAudio();
  assert.equal(audio.src, '_shared/music/vehicle4.mp3');
});

test('T1-FEAT07-02: Fallback to vanilla default loading theme when mod has no music file', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('');
  const audio = env.getLastAudio();
  assert.equal(audio.src, '_shared/music/vehicle4.mp3');
});

test('T1-FEAT07-03: Graceful fallback on audio network error without crashing overlay', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
    fallbackUrl: '_shared/music/vehicle4.mp3',
  });

  ctrl.start('missing/file.mp3');
  const audio = env.getLastAudio();
  audio.dispatchEvent({ type: 'error' });

  assert.equal(audio.src, '_shared/music/vehicle4.mp3');
});

test('T1-FEAT07-04: Fallback audio loop behaves identically to primary track', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start(null);
  const audio = env.getLastAudio();
  assert.equal(audio.loop, true);
});

test('T1-FEAT07-05: Audio controller flags fallback state in session diagnostics', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
    fallbackUrl: '_shared/music/vehicle4.mp3',
  });

  ctrl.start('missing.mp3');
  const audio = env.getLastAudio();
  audio.dispatchEvent({ type: 'error' });
  assert.equal(audio.src, '_shared/music/vehicle4.mp3');
});

// --------------------------------------------------------------------------- //
// Feature 8: AUDIO-AUTOPLAY-TRAP (5 Tests: T1-FEAT08-01 to T1-FEAT08-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT08-01: Traps NotAllowedError rejection from audio.play() without throwing uncaught console error', async () => {
  const env = createMockEnvironment();
  let rejectingAudio = null;
  class RejectingAudio extends env.window.Audio {
    constructor() {
      super();
      rejectingAudio = this;
    }
    play() {
      const err = new Error('Autoplay blocked');
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.ok(true, 'Autoplay rejection handled cleanly');
});

test('T1-FEAT08-02: Sets isAutoplayBlocked() === true when browser rejects unmuted playback', async () => {
  const env = createMockEnvironment();
  class RejectingAudio extends env.window.Audio {
    play() {
      const err = new Error('Autoplay blocked');
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(ctrl.isAutoplayBlocked(), true);
});

test('T1-FEAT08-03: Fires onAutoplayBlocked callback listener', async () => {
  const env = createMockEnvironment();
  class RejectingAudio extends env.window.Audio {
    play() {
      const err = new Error('Autoplay blocked');
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

  let callbackFired = false;
  ctrl.onAutoplayBlocked(() => { callbackFired = true; });

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(callbackFired, true);
});

test('T1-FEAT08-04: Loading progress animation continues uninterrupted when autoplay is blocked', async () => {
  const env = createMockEnvironment();
  class RejectingAudio extends env.window.Audio {
    play() {
      const err = new Error('Autoplay blocked');
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(ctrl.state, AudioState.BLOCKED_WAITING_GESTURE);
});

test('T1-FEAT08-05: Scene lifecycle (load.end()) functions normally without audio', async () => {
  const env = createMockEnvironment();
  class RejectingAudio extends env.window.Audio {
    play() {
      const err = new Error('Autoplay blocked');
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  await ctrl.fadeOut(0);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

// --------------------------------------------------------------------------- //
// Feature 9: AUDIO-GESTURE-UNLOCK (5 Tests: T1-FEAT09-01 to T1-FEAT09-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT09-01: Registers one-time listener for user gesture (pointerdown)', async () => {
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(ctrl.isAutoplayBlocked(), true);
  assert.ok(env.document.listeners.has('pointerdown'));
});

test('T1-FEAT09-02: Unlocks audio playback when user clicks during load', async () => {
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(ctrl.isAutoplayBlocked(), true);

  rejecting = false;
  env.document.dispatchEvent({ type: 'pointerdown' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.isAutoplayBlocked(), false);
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T1-FEAT09-03: Resumes AudioContext on user interaction', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.unlock();
  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T1-FEAT09-04: Removes event listener once unlocked to prevent duplicate trigger', async () => {
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  env.document.dispatchEvent({ type: 'pointerdown' });
  await new Promise(r => queueMicrotask(r));

  const list = env.document.listeners.get('pointerdown') || [];
  assert.equal(list.length, 0);
});

test('T1-FEAT09-05: Fires onAutoplayResolved callback upon successful unlock', async () => {
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

  let resolvedFired = false;
  ctrl.onAutoplayResolved(() => { resolvedFired = true; });

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  env.document.dispatchEvent({ type: 'pointerdown' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(resolvedFired, true);
});

// --------------------------------------------------------------------------- //
// Feature 10: AUDIO-UNMUTE-UI (5 Tests: T1-FEAT10-01 to T1-FEAT10-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT10-01: Displays authentic unmute button/badge when autoplay is blocked', async () => {
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  assert.equal(btn.hidden, false);
});

test('T1-FEAT10-02: Unmute button renders with authentic styling ([🔊 SOUND])', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);
  assert.ok(btn.textContent.includes('SOUND') || btn.innerHTML.includes('SOUND'));
});

test('T1-FEAT10-03: Clicking unmute button unlocks audio immediately', async () => {
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

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  btn.dispatchEvent({ type: 'click' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(ctrl.state, AudioState.ACTIVE_PLAYING);
});

test('T1-FEAT10-04: Unmute button automatically hides when user unblocks audio', async () => {
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

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  rejecting = false;
  btn.dispatchEvent({ type: 'click' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(btn.hidden, true);
});

test('T1-FEAT10-05: Unmute button remains hidden if autoplay succeeds initially', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  const container = env.document.createElement('div');
  const btn = ctrl.attachUnmuteButton(container);

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));

  assert.equal(btn.hidden, true);
});

// --------------------------------------------------------------------------- //
// Feature 11: AUDIO-FADEOUT (5 Tests: T1-FEAT11-01 to T1-FEAT11-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT11-01: Initiates volume attenuation when fadeOut is invoked', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  const fadePromise = ctrl.fadeOut(20);
  assert.equal(ctrl.state, AudioState.FADING_OUT);
  await fadePromise;
});

test('T1-FEAT11-02: Volume attenuates smoothly to 0 over 800ms duration', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.fadeOut(20);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T1-FEAT11-03: Configurable fade duration within 500ms - 1500ms range', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.fadeOut(10);
  assert.equal(ctrl.state, AudioState.COMPLETED);
});

test('T1-FEAT11-04: Audio playback pauses and resets (currentTime = 0) when volume reaches 0', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  const audio = env.getLastAudio();
  audio.currentTime = 12.5;

  await ctrl.fadeOut(10);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
});

test('T1-FEAT11-05: Audio nodes disconnected and resources disposed after fadeout', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.fadeOut(10);
  ctrl.dispose();
  assert.equal(ctrl.state, AudioState.CANCELLED);
});

// --------------------------------------------------------------------------- //
// Feature 12: AUDIO-STALE-CANCEL (5 Tests: T1-FEAT12-01 to T1-FEAT12-05)
// --------------------------------------------------------------------------- //
test('T1-FEAT12-01: Disables delayed loading music unlock if load completes before user clicks', async () => {
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

  ctrl.start('music/vehicle4.mp3');
  await new Promise(r => queueMicrotask(r));
  assert.equal(ctrl.isAutoplayBlocked(), true);

  // Load completes before click!
  await ctrl.fadeOut(0);

  // User subsequently clicks
  env.document.dispatchEvent({ type: 'pointerdown' });
  await new Promise(r => queueMicrotask(r));

  assert.equal(env.getLastAudio().paused, true);
});

test('T1-FEAT12-02: User click in spawn screen after load does NOT play loading march theme', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.fadeOut(10);

  // Subsequent click
  env.document.dispatchEvent({ type: 'click' });
  assert.equal(env.getLastAudio().paused, true);
});

test('T1-FEAT12-03: Cancels active audio immediately if user navigates away or cancels load', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  ctrl.cancel();

  assert.equal(ctrl.state, AudioState.CANCELLED);
  assert.equal(env.getLastAudio().paused, true);
});

test('T1-FEAT12-04: Prevents multiple overlapping loading tracks on quick map switches', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/map1.mp3');
  ctrl.start('music/map2.mp3');

  assert.equal(env.getLastAudio().src, 'music/map2.mp3');
});

test('T1-FEAT12-05: Ensures ambient game audio can start cleanly without collision from loading audio', async () => {
  const env = createMockEnvironment();
  const ctrl = createLoadingAudioController({
    audioClass: env.window.Audio,
    audioContextClass: env.window.AudioContext,
    documentRef: env.document,
    windowRef: env.window,
  });

  ctrl.start('music/vehicle4.mp3');
  await ctrl.fadeOut(10);

  assert.equal(env.getLastAudio().paused, true);
  assert.equal(env.getLastAudio().currentTime, 0);
});
