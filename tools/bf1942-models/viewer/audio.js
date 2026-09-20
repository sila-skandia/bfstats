/**
 * tools/bf1942-models/viewer/audio.js
 * Authentic Battlefield 1942 & Mod Map Loading Screen Audio Controller
 *
 * Implements:
 * - AUDIO-PLAYBACK: Stream & loop loading music (HTMLAudioElement streaming, loop = true, crossOrigin = 'anonymous')
 * - AUDIO-FALLBACK: Smooth fallback track resolution on 404/media load failure (default: _shared/music/vehicle4.mp3)
 * - AUDIO-AUTOPLAY-TRAP: Catch NotAllowedError & AbortError without uncaught console errors
 * - AUDIO-GESTURE-UNLOCK: One-time document interaction gesture unlock (pointerdown, keydown, touchstart, click)
 *   in capture phase with atomic teardown across all 4 event types
 * - AUDIO-UNMUTE-UI: Authentic Refractor HUD unmute badge ([ SOUND: CLICK TO ENABLE ])
 *   with pointer-events: auto, auto-reveal on block, auto-hide on unlock/complete/cancel
 * - AUDIO-MUTE-UI: A speaker toggle (`attachMuteToggle`) for a screen that stays up while
 *   the music plays, where the badge's "click to enable" is only half the control the
 *   player needs. Muted is a state of this controller, not of the element: it survives a
 *   gesture unlock, so a click somewhere else on the page cannot start the music behind
 *   the player's back.
 * - AUDIO-FADEOUT: Smooth 800ms volume ramp down to 0 using Web Audio GainNode (linearRampToValueAtTime)
 *   or fallback volume interpolation, resetting audio.currentTime = 0 and restoring gain to 1.0
 * - AUDIO-STALE-CANCEL: Invariant state guards & generation tracking ensuring post-load / post-fadeout / cancelled
 *   interactions never trigger stale loading music
 */

export const AudioState = Object.freeze({
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  ACTIVE_PLAYING: 'ACTIVE_PLAYING',
  BLOCKED_WAITING_GESTURE: 'BLOCKED_WAITING_GESTURE',
  FADING_OUT: 'FADING_OUT',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  // Turned off by the player, not by the browser: see `setMuted`.
  MUTED: 'MUTED',
});

const DEFAULT_FADE_MS = 800;
const DEFAULT_FALLBACK_URL = '_shared/music/vehicle4.mp3';
const GESTURE_EVENTS = Object.freeze(['pointerdown', 'keydown', 'touchstart', 'click']);
const GESTURE_LISTENER_OPTIONS = Object.freeze({ capture: true, passive: true });

export class LoadingAudioController {
  /**
   * @param {Object} [options]
   * @param {typeof Audio} [options.audioClass] - Custom Audio constructor (for Node / mocks)
   * @param {typeof Audio} [options.AudioElementClass] - Alias for audioClass
   * @param {typeof AudioContext} [options.audioContextClass] - Custom AudioContext constructor
   * @param {typeof AudioContext} [options.AudioContextClass] - Alias for audioContextClass
   * @param {AudioContext} [options.audioContext] - Existing external AudioContext instance
   * @param {Document} [options.documentRef] - Custom document object (for Node / mocks)
   * @param {Window} [options.windowRef] - Custom window object (for Node / mocks)
   * @param {number} [options.fadeDurationMs=800] - Default fadeout duration in ms
   */
  constructor(options = {}) {
    this._AudioCtor = options.audioClass || options.AudioElementClass || (typeof Audio !== 'undefined' ? Audio : null);
    this._AudioContextCtor = options.audioContextClass || options.AudioContextClass || (typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));
    this._document = options.documentRef || (typeof document !== 'undefined' ? document : null);
    this._window = options.windowRef || (typeof window !== 'undefined' ? window : null);
    this._defaultFadeMs = typeof options.fadeDurationMs === 'number' ? options.fadeDurationMs : DEFAULT_FADE_MS;
    this._externalCtx = options.audioContext || null;

    this._state = AudioState.IDLE;
    this._sessionGeneration = 0;
    this._isAutoplayBlocked = false;
    this._isStale = false;
    this._isCancelled = false;
    this._isFading = false;

    this._currentUrl = null;
    this._fallbackUrl = null;
    this._fallbackAttempted = false;

    this._audio = null;
    this._ctx = null;
    this._gainNode = null;
    this._sourceNode = null;
    this._webAudioInitialized = false;

    this._fadeTimer = null;
    this._fadeResolvers = [];
    this._activeFadePromise = null;
    this._unlockPromise = null;

    this._unmuteButton = null;
    this._muteToggle = null;
    this._muted = false;
    this._gestureCleanup = null;
    this._onError = null;

    this._blockedCallbacks = new Set();
    this._resolvedCallbacks = new Set();

    this._ensureAudio();
  }

  get state() {
    return this._state;
  }

  isAutoplayBlocked() {
    return this._isAutoplayBlocked;
  }

  /** Whether the player has turned this track off. */
  get muted() {
    return this._muted;
  }

  /**
   * Turn the track off or back on.
   *
   * This is the player's own switch, and it outranks everything else the
   * controller does: while it is on, `start()` loads the track but does not
   * play it, and the gesture unlock stays disarmed, so a click anywhere on
   * the page cannot bring the music back. Turning it off plays from where
   * the track is — the click that did it is itself the gesture the autoplay
   * policy wanted, so this is also the unblock.
   *
   * @param {boolean} on
   * @returns {boolean} the new state
   */
  setMuted(on) {
    const next = Boolean(on);
    if (next === this._muted) return this._muted;
    this._muted = next;
    if (next) {
      this._disarmGestureUnlock();
      if (this._audio) {
        try { this._audio.pause(); } catch (_) {}
      }
      if (this._state === AudioState.ACTIVE_PLAYING
          || this._state === AudioState.BLOCKED_WAITING_GESTURE) {
        this._state = AudioState.MUTED;
      }
      this._syncAudioUi();
      return this._muted;
    }
    if (this._state === AudioState.MUTED) this._state = AudioState.LOADING;
    this._syncAudioUi();
    // Not `_playCurrent`: `unlock()` is the path that also resumes a
    // suspended AudioContext, which a tab that never got its gesture has.
    this.unlock();
    return this._muted;
  }

  /** True when the track is loaded and wanted but not coming out of the
   *  speakers — muted by the player, or still waiting for a gesture. The
   *  speaker icon reads this and nothing else. */
  get silent() {
    return this._muted || this._isAutoplayBlocked
      || this._state !== AudioState.ACTIVE_PLAYING;
  }

  onAutoplayBlocked(callback) {
    if (typeof callback !== 'function') return () => {};
    this._blockedCallbacks.add(callback);
    if (this._isAutoplayBlocked) {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => {
          if (this._isAutoplayBlocked && this._blockedCallbacks.has(callback)) {
            try { callback(); } catch (_) {}
          }
        });
      } else {
        setTimeout(() => {
          if (this._isAutoplayBlocked && this._blockedCallbacks.has(callback)) {
            try { callback(); } catch (_) {}
          }
        }, 0);
      }
    }
    return () => this._blockedCallbacks.delete(callback);
  }

  onAutoplayResolved(callback) {
    if (typeof callback !== 'function') return () => {};
    this._resolvedCallbacks.add(callback);
    return () => this._resolvedCallbacks.delete(callback);
  }

  /**
   * Starts loading music playback with automatic fallback.
   * @param {string} [musicUrl] - Primary music track URL.
   * @param {string} [fallbackUrl='_shared/music/vehicle4.mp3'] - Fallback track URL.
   */
  start(musicUrl, fallbackUrl = DEFAULT_FALLBACK_URL) {
    const session = ++this._sessionGeneration;

    // Reset lifecycle flags
    this._isStale = false;
    this._isCancelled = false;
    this._isFading = false;
    this._isAutoplayBlocked = false;
    this._fallbackAttempted = false;

    this._resolveFadePromises();
    this._clearFadeTimer();
    this._disarmGestureUnlock();

    if (this._onError && this._audio) {
      try {
        this._audio.removeEventListener('error', this._onError);
        this._audio.onerror = null;
      } catch (_) {}
      this._onError = null;
    }

    this._currentUrl = musicUrl || fallbackUrl || DEFAULT_FALLBACK_URL;
    this._fallbackUrl = fallbackUrl || DEFAULT_FALLBACK_URL;

    this._ensureAudio();
    if (!this._audio) {
      this._state = AudioState.IDLE;
      return;
    }

    this._initWebAudio();

    // Reset volume & gain to full
    this._audio.volume = 1.0;
    this._audio.loop = true;
    this._audio.crossOrigin = 'anonymous';

    if (this._gainNode && this._ctx) {
      try {
        const now = this._ctx.currentTime || 0;
        this._gainNode.gain.cancelScheduledValues(now);
        this._gainNode.gain.setValueAtTime(1.0, now);
      } catch (_) {}
    }

    this._state = AudioState.LOADING;

    // Bind one-time error handler for media 404 / decode error
    const onError = () => {
      if (this._sessionGeneration !== session || this._isStale || this._isCancelled) return;
      this._handleLoadError(session);
    };
    this._onError = onError;
    if (typeof this._audio.addEventListener === 'function') {
      this._audio.addEventListener('error', onError, { once: true });
    }
    this._audio.onerror = onError;

    this._audio.src = this._currentUrl;
    // Muted is the player's switch and survives a fresh track: the next
    // level's loading music must not undo what he turned off on this one.
    if (this._muted) {
      this._state = AudioState.MUTED;
      this._syncAudioUi();
      return;
    }
    this._playCurrent(session);
  }

  /**
   * Smoothly fades out loading music over durationMs (default: 800ms).
   * @param {number} [durationMs=800] - Duration in milliseconds.
   * @returns {Promise<void>}
   */
  fadeOut(durationMs = this._defaultFadeMs) {
    const session = this._sessionGeneration;

    // AUDIO-STALE-CANCEL: Tear down gesture listeners immediately
    this._isStale = true;
    this._disarmGestureUnlock();

    if (this._unmuteButton) {
      this._unmuteButton.hidden = true;
      this._unmuteButton.style.display = 'none';
    }

    if (this._isFading && this._activeFadePromise) {
      return this._activeFadePromise;
    }

    if (!this._audio || this._audio.paused || this._isAutoplayBlocked || this._state === AudioState.BLOCKED_WAITING_GESTURE) {
      this._state = AudioState.COMPLETED;
      this._cleanupAudioState();
      this._resolveFadePromises();
      return Promise.resolve();
    }

    this._state = AudioState.FADING_OUT;
    this._isFading = true;

    const ms = Math.max(0, durationMs);
    if (ms === 0) {
      this._state = AudioState.COMPLETED;
      this._cleanupAudioState();
      this._resolveFadePromises();
      return Promise.resolve();
    }

    const promise = new Promise((resolve) => {
      this._fadeResolvers.push(resolve);

      // Web Audio GainNode hardware ramp if available
      if (this._gainNode && this._ctx && (this._ctx.state === 'running' || typeof this._ctx.currentTime === 'number')) {
        try {
          const now = this._ctx.currentTime || 0;
          const durSec = ms / 1000;
          this._gainNode.gain.cancelScheduledValues(now);
          this._gainNode.gain.setValueAtTime(this._gainNode.gain.value, now);
          this._gainNode.gain.linearRampToValueAtTime(0.0, now + durSec);

          this._fadeTimer = setTimeout(() => {
            if (this._sessionGeneration === session) {
              this._state = AudioState.COMPLETED;
              this._cleanupAudioState();
              this._resolveFadePromises();
            }
          }, ms);
          return;
        } catch (_) {
          // Fall through to JS volume ramp if Web Audio throws
        }
      }

      // HTMLAudioElement volume interpolation fallback
      const startVolume = this._audio.volume;
      const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      const step = () => {
        if (this._sessionGeneration !== session || !this._isFading) {
          return;
        }
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const elapsed = now - startTime;
        const progress = Math.min(1.0, elapsed / ms);
        this._audio.volume = Math.max(0.0, startVolume * (1.0 - progress));

        if (progress >= 1.0) {
          this._state = AudioState.COMPLETED;
          this._cleanupAudioState();
          this._resolveFadePromises();
        } else {
          this._fadeTimer = setTimeout(step, 16);
        }
      };

      this._fadeTimer = setTimeout(step, 16);
    });

    this._activeFadePromise = promise;
    return promise;
  }

  /**
   * Immediately terminates playback and gesture listeners with zero fade.
   */
  cancel() {
    this._sessionGeneration++;
    this._state = AudioState.CANCELLED;
    this._isCancelled = true;
    this._isStale = true;
    this._isAutoplayBlocked = false;
    this._unlockPromise = null;

    this._disarmGestureUnlock();

    if (this._unmuteButton) {
      this._unmuteButton.hidden = true;
      this._unmuteButton.style.display = 'none';
    }

    this._cleanupAudioState();
    this._resolveFadePromises();
  }

  /**
   * Attaches an authentic Refractor HUD unmute badge/button to the specified container.
   * Declares pointer-events: auto to ensure clickability inside pointer-events: none containers.
   * @param {HTMLElement} containerElement
   * @returns {HTMLElement | null}
   */
  attachUnmuteButton(containerElement) {
    if (!containerElement || !this._document) return null;

    if (this._unmuteButton && containerElement.contains && containerElement.contains(this._unmuteButton)) {
      return this._unmuteButton;
    }

    this._injectButtonStyles();

    const btn = this._document.createElement('button');
    btn.type = 'button';
    btn.className = 'ld-unmute-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Enable loading sound');
    btn.innerHTML = '<span class="ld-unmute-text">SOUND: CLICK TO ENABLE</span>';

    // CRITICAL: Explicit pointer-events: auto overrides container pointer-events: none
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';

    btn.hidden = !this._isAutoplayBlocked;
    btn.style.display = this._isAutoplayBlocked ? 'inline-flex' : 'none';

    btn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      this.unlock();
    });

    containerElement.appendChild(btn);
    this._unmuteButton = btn;
    return btn;
  }

  /**
   * A speaker toggle in the corner of a screen that stays up while the music
   * plays. The badge above is for a loading screen, which is gone in a few
   * seconds and only ever needs "click to enable"; a menu the player sits on
   * needs the other direction too.
   *
   * Both states are one icon: a speaker, with the waves crossed out when
   * nothing is coming out of it — whether that is the player's doing or the
   * autoplay policy's, since from where he is sitting they are the same
   * thing and one click fixes either.
   *
   * @param {HTMLElement} containerElement
   * @param {Object} [options]
   * @param {(muted: boolean) => void} [options.onChange] - after a click
   * @returns {HTMLElement | null}
   */
  attachMuteToggle(containerElement, { onChange } = {}) {
    if (!containerElement || !this._document) return null;
    if (this._muteToggle && containerElement.contains
        && containerElement.contains(this._muteToggle)) {
      return this._muteToggle;
    }

    this._injectButtonStyles();

    const btn = this._document.createElement('button');
    btn.type = 'button';
    btn.className = 'ld-mute-btn';
    // Two paths, one on top of the other: the cone and its waves, and the
    // stroke through them that `.ld-mute-off` reveals.
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path class="ld-mute-cone" d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"/>
        <path class="ld-mute-wave" d="M15.4 9.2a4 4 0 0 1 0 5.6"/>
        <path class="ld-mute-wave ld-mute-wave-far" d="M17.9 6.7a7.5 7.5 0 0 1 0 10.6"/>
        <path class="ld-mute-slash" d="M5 19 19 5"/>
      </svg>`;
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      // Three cases, one button. Blocked but not muted is the interesting
      // one: the click is itself the gesture the autoplay policy wanted, so
      // turning it "on" from there is an unlock and not an unmute.
      if (this._muted) this.setMuted(false);
      else if (this.silent) { this.unlock(); this._syncAudioUi(); }
      else this.setMuted(true);
      if (typeof onChange === 'function') {
        try { onChange(this._muted); } catch (_) {}
      }
    });

    containerElement.appendChild(btn);
    this._muteToggle = btn;
    this._syncAudioUi();
    return btn;
  }

  /**
   * Triggers gesture unlock explicitly or via user interaction.
   * @returns {Promise<void>}
   */
  async unlock() {
    if (this._isStale || this._isCancelled || this._muted) return;
    if (this._state === AudioState.ACTIVE_PLAYING || (this._audio && !this._audio.paused && this._state !== AudioState.BLOCKED_WAITING_GESTURE)) {
      return;
    }
    if (this._unlockPromise) {
      return this._unlockPromise;
    }

    this._unlockPromise = this._performUnlock();
    try {
      await this._unlockPromise;
    } finally {
      this._unlockPromise = null;
    }
  }

  async _performUnlock() {
    const session = this._sessionGeneration;

    this._disarmGestureUnlock();

    if (this._unmuteButton) {
      this._unmuteButton.hidden = true;
      this._unmuteButton.style.display = 'none';
    }

    // WebKit compliant synchronous AudioContext resume
    if (this._ctx && this._ctx.state === 'suspended') {
      try {
        this._ctx.resume().catch(() => {});
      } catch (_) {}
    }

    if (this._audio) {
      try {
        const p = this._audio.play();
        if (p && typeof p.then === 'function') {
          await p;
        }

        if (this._sessionGeneration !== session) {
          return;
        }
        if (this._isCancelled || this._isStale || this._state === AudioState.COMPLETED || this._state === AudioState.CANCELLED) {
          try { this._audio.pause(); } catch (_) {}
          return;
        }

        this._state = AudioState.ACTIVE_PLAYING;
        this._isAutoplayBlocked = false;
        this._notifyAutoplayResolved();
      } catch (err) {
        const errName = err && (err.name || err.code);
        if (errName === 'NotAllowedError') {
          // Re-arm if still blocked
          this._isAutoplayBlocked = true;
          this._state = AudioState.BLOCKED_WAITING_GESTURE;
          if (this._unmuteButton) {
            this._unmuteButton.hidden = false;
            this._unmuteButton.style.display = 'inline-flex';
          }
          this._armGestureUnlock(this._sessionGeneration);
          this._notifyAutoplayBlocked();
        } else if (errName === 'AbortError') {
          // Play was interrupted
        } else {
          // Media error, decode failure, or 404
          this._isAutoplayBlocked = false;
          this._handleLoadError(this._sessionGeneration);
        }
      }
    } else {
      if (this._sessionGeneration !== session || this._isCancelled || this._isStale) {
        return;
      }
      this._state = AudioState.ACTIVE_PLAYING;
      this._isAutoplayBlocked = false;
      this._notifyAutoplayResolved();
    }
  }

  dispose() {
    this.cancel();
    this._blockedCallbacks.clear();
    this._resolvedCallbacks.clear();
    if (this._sourceNode) {
      try { this._sourceNode.disconnect(); } catch (_) {}
    }
    if (this._gainNode) {
      try { this._gainNode.disconnect(); } catch (_) {}
    }
    if (this._onError && this._audio) {
      try {
        this._audio.removeEventListener('error', this._onError);
        this._audio.onerror = null;
      } catch (_) {}
      this._onError = null;
    }
  }

  /* ---------------- Private Implementation ---------------- */

  _ensureAudio() {
    if (this._audio) return;
    if (this._AudioCtor) {
      try {
        this._audio = new this._AudioCtor();
        this._audio.loop = true;
        this._audio.crossOrigin = 'anonymous';
        this._audio.preload = 'auto';
      } catch (_) {}
    }
  }

  _initWebAudio() {
    if (this._webAudioInitialized || !this._audio) return;
    try {
      if (!this._ctx) {
        if (this._externalCtx) {
          this._ctx = this._externalCtx;
        } else if (this._AudioContextCtor) {
          this._ctx = new this._AudioContextCtor();
        }
      }
      if (this._ctx) {
        this._gainNode = this._ctx.createGain();
        if (this._gainNode && this._gainNode.gain) {
          this._gainNode.gain.setValueAtTime(1.0, this._ctx.currentTime || 0);
        }
        if (typeof this._ctx.createMediaElementSource === 'function') {
          this._sourceNode = this._ctx.createMediaElementSource(this._audio);
          if (this._sourceNode && typeof this._sourceNode.connect === 'function') {
            this._sourceNode.connect(this._gainNode);
            if (this._gainNode && typeof this._gainNode.connect === 'function') {
              this._gainNode.connect(this._ctx.destination);
            }
          }
        }
      }
      this._webAudioInitialized = true;
    } catch (_) {
      this._gainNode = null;
      this._sourceNode = null;
      this._webAudioInitialized = true;
    }
  }

  _playCurrent(session) {
    if (!this._audio || this._isStale || this._isCancelled || this._muted
        || this._sessionGeneration !== session) {
      return;
    }

    let playPromise;
    try {
      playPromise = this._audio.play();
    } catch (err) {
      this._handlePlayRejection(err, session);
      return;
    }

    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise
        .then(() => {
          if (this._isCancelled) {
            try { this._audio.pause(); } catch (_) {}
            return;
          }
          if (this._sessionGeneration !== session) {
            return;
          }
          if (this._isStale) {
            if (!this._isFading) {
              try { this._audio.pause(); } catch (_) {}
            }
            return;
          }
          this._state = AudioState.ACTIVE_PLAYING;
          this._isAutoplayBlocked = false;
          if (this._unmuteButton) {
            this._unmuteButton.hidden = true;
            this._unmuteButton.style.display = 'none';
          }
          this._notifyAutoplayResolved();
        })
        .catch((err) => {
          this._handlePlayRejection(err, session);
        });
    } else {
      if (this._isCancelled) {
        try { this._audio.pause(); } catch (_) {}
        return;
      }
      if (this._sessionGeneration !== session) {
        return;
      }
      if (this._isStale) {
        if (!this._isFading) {
          try { this._audio.pause(); } catch (_) {}
        }
        return;
      }
      this._state = AudioState.ACTIVE_PLAYING;
      this._isAutoplayBlocked = false;
      this._notifyAutoplayResolved();
    }
  }

  _handlePlayRejection(err, session) {
    if (this._sessionGeneration !== session || this._isStale || this._isCancelled) {
      return;
    }

    const errName = err && (err.name || err.code);

    if (errName === 'NotAllowedError') {
      // Browser autoplay policy blocked unmuted playback
      this._state = AudioState.BLOCKED_WAITING_GESTURE;
      this._isAutoplayBlocked = true;
      if (this._unmuteButton) {
        this._unmuteButton.hidden = false;
        this._unmuteButton.style.display = 'inline-flex';
      }
      this._armGestureUnlock(session);
      this._notifyAutoplayBlocked();
    } else if (errName === 'AbortError') {
      // Normal playback interruption (interrupted by pause() or new load)
    } else {
      // Media error, decode failure, or network failure
      this._handleLoadError(session);
    }
  }

  _handleLoadError(session) {
    if (this._sessionGeneration !== session || this._isStale || this._isCancelled) {
      return;
    }

    if (this._fallbackUrl && !this._fallbackAttempted && this._currentUrl !== this._fallbackUrl) {
      this._fallbackAttempted = true;
      this._currentUrl = this._fallbackUrl;
      if (this._audio) {
        this._audio.src = this._fallbackUrl;
        this._playCurrent(session);
      }
    }
  }

  _armGestureUnlock(session) {
    if (this._gestureCleanup) return;
    const target = this._document || this._window;
    if (!target || typeof target.addEventListener !== 'function') return;

    const handler = (event) => {
      // Atomic teardown of all 4 listeners on first interaction
      this._disarmGestureUnlock();
      this._handleUserGesture(event, session);
    };

    for (const ev of GESTURE_EVENTS) {
      target.addEventListener(ev, handler, GESTURE_LISTENER_OPTIONS);
    }

    this._gestureCleanup = () => {
      for (const ev of GESTURE_EVENTS) {
        try {
          target.removeEventListener(ev, handler, GESTURE_LISTENER_OPTIONS);
        } catch (_) {}
      }
      this._gestureCleanup = null;
    };
  }

  _disarmGestureUnlock() {
    if (this._gestureCleanup) {
      this._gestureCleanup();
    }
  }

  _handleUserGesture(event, session) {
    // Invariant state guards
    if (this._sessionGeneration !== session || this._isStale || this._isCancelled || !this._isAutoplayBlocked) {
      return;
    }
    this.unlock();
  }

  _cleanupAudioState() {
    this._clearFadeTimer();
    this._isFading = false;

    if (this._audio) {
      try {
        this._audio.pause();
        this._audio.currentTime = 0;
        this._audio.volume = 1.0;
      } catch (_) {}
    }

    if (this._gainNode && this._ctx) {
      try {
        const now = this._ctx.currentTime || 0;
        this._gainNode.gain.cancelScheduledValues(now);
        this._gainNode.gain.setValueAtTime(1.0, now);
      } catch (_) {}
    }
  }

  _clearFadeTimer() {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  _resolveFadePromises() {
    const resolvers = this._fadeResolvers;
    this._fadeResolvers = [];
    this._activeFadePromise = null;
    for (const r of resolvers) {
      try { r(); } catch (_) {}
    }
  }

  _notifyAutoplayBlocked() {
    this._syncAudioUi();
    for (const cb of [...this._blockedCallbacks]) {
      try { cb(); } catch (_) {}
    }
  }

  _notifyAutoplayResolved() {
    this._syncAudioUi();
    for (const cb of [...this._resolvedCallbacks]) {
      try { cb(); } catch (_) {}
    }
  }

  /** The speaker icon, after anything that could have changed what is
   *  coming out of the speakers. */
  _syncAudioUi() {
    const btn = this._muteToggle;
    if (!btn) return;
    const silent = this.silent;
    btn.setAttribute('aria-pressed', String(silent));
    btn.setAttribute('aria-label', silent ? 'Turn menu music on' : 'Turn menu music off');
    btn.classList.toggle('ld-mute-off', silent);
  }

  _injectButtonStyles() {
    if (!this._document || !this._document.head || typeof this._document.createElement !== 'function') return;
    if (this._document.getElementById && this._document.getElementById('ld-unmute-style')) return;

    try {
      const style = this._document.createElement('style');
      style.id = 'ld-unmute-style';
      style.textContent = `
        .ld-unmute-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 100;
          pointer-events: auto;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          background: rgba(19, 19, 19, 0.9);
          color: #9aa666;
          border: 1px solid #3d3d3d;
          border-radius: 2px;
          font-family: ui-monospace, 'Geist Mono', monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          outline: none;
          user-select: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
        }
        .ld-unmute-btn:hover {
          background: rgba(35, 35, 35, 0.95);
          color: #ffffff;
          border-color: #7d8849;
        }
        .ld-unmute-btn[hidden] {
          display: none !important;
        }
        /* The speaker toggle: the badge's plate, square, icon only. */
        .ld-mute-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 100;
          pointer-events: auto;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          padding: 0;
          background: rgba(19, 19, 19, 0.9);
          border: 1px solid #3d3d3d;
          border-radius: 2px;
          outline: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
          transition: background 150ms ease, border-color 150ms ease;
        }
        .ld-mute-btn:hover { background: rgba(35, 35, 35, 0.95); border-color: #7d8849; }
        .ld-mute-btn svg { width: 18px; height: 18px; display: block; }
        .ld-mute-btn .ld-mute-cone {
          fill: #9aa666;
          stroke: none;
        }
        .ld-mute-btn .ld-mute-wave {
          fill: none;
          stroke: #9aa666;
          stroke-width: 1.6;
          stroke-linecap: round;
        }
        .ld-mute-btn .ld-mute-slash {
          stroke: #9aa666;
          stroke-width: 1.8;
          stroke-linecap: round;
          opacity: 0;
        }
        .ld-mute-btn:hover .ld-mute-cone { fill: #ffffff; }
        .ld-mute-btn:hover .ld-mute-wave,
        .ld-mute-btn:hover .ld-mute-slash { stroke: #ffffff; }
        /* Off: the waves go, the stroke through it comes. */
        .ld-mute-btn.ld-mute-off .ld-mute-cone { fill: #6f6f6f; }
        .ld-mute-btn.ld-mute-off .ld-mute-wave { opacity: 0; }
        .ld-mute-btn.ld-mute-off .ld-mute-slash { opacity: 1; stroke: #6f6f6f; }
        .ld-mute-btn.ld-mute-off:hover .ld-mute-cone { fill: #cfcfc4; }
        .ld-mute-btn.ld-mute-off:hover .ld-mute-slash { stroke: #cfcfc4; }
        .ld-mute-btn[hidden] { display: none !important; }
      `;
      this._document.head.appendChild(style);
    } catch (_) {}
  }
}

export function createLoadingAudioController(options) {
  return new LoadingAudioController(options);
}
