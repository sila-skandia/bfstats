// The loading-audio controller's two on-screen controls: the Refractor HUD
// unmute badge and the speaker toggle, with the stylesheet both share. Split out
// of `audio.js`, whose `LoadingAudioController` delegates to these with itself
// as `ctrl`; the playback state machine stays there.

/**
 * Attaches an authentic Refractor HUD unmute badge/button to the specified container.
 * Declares pointer-events: auto to ensure clickability inside pointer-events: none containers.
 * @param {HTMLElement} containerElement
 * @returns {HTMLElement | null}
 */
export function attachUnmuteButton(ctrl, containerElement) {
  if (!containerElement || !ctrl._document) return null;

  if (ctrl._unmuteButton && containerElement.contains && containerElement.contains(ctrl._unmuteButton)) {
    return ctrl._unmuteButton;
  }

  injectButtonStyles(ctrl);

  const btn = ctrl._document.createElement('button');
  btn.type = 'button';
  btn.className = 'ld-unmute-btn';
  btn.setAttribute('type', 'button');
  btn.setAttribute('aria-label', 'Enable loading sound');
  btn.innerHTML = '<span class="ld-unmute-text">SOUND: CLICK TO ENABLE</span>';

  // CRITICAL: Explicit pointer-events: auto overrides container pointer-events: none
  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'pointer';

  btn.hidden = !ctrl._isAutoplayBlocked;
  btn.style.display = ctrl._isAutoplayBlocked ? 'inline-flex' : 'none';

  btn.addEventListener('click', (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    ctrl.unlock();
  });

  containerElement.appendChild(btn);
  ctrl._unmuteButton = btn;
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
export function attachMuteToggle(ctrl, containerElement, { onChange } = {}) {
  if (!containerElement || !ctrl._document) return null;
  if (ctrl._muteToggle && containerElement.contains
      && containerElement.contains(ctrl._muteToggle)) {
    return ctrl._muteToggle;
  }

  injectButtonStyles(ctrl);

  const btn = ctrl._document.createElement('button');
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
    if (ctrl._muted) ctrl.setMuted(false);
    else if (ctrl.silent) { ctrl.unlock(); ctrl._syncAudioUi(); }
    else ctrl.setMuted(true);
    if (typeof onChange === 'function') {
      try { onChange(ctrl._muted); } catch (_) {}
    }
  });

  containerElement.appendChild(btn);
  ctrl._muteToggle = btn;
  ctrl._syncAudioUi();
  return btn;
}

/** The speaker icon, after anything that could have changed what is
 *  coming out of the speakers. */
export function syncAudioUi(ctrl) {
  const btn = ctrl._muteToggle;
  if (!btn) return;
  const silent = ctrl.silent;
  btn.setAttribute('aria-pressed', String(silent));
  btn.setAttribute('aria-label', silent ? 'Turn menu music on' : 'Turn menu music off');
  btn.classList.toggle('ld-mute-off', silent);
}

export function injectButtonStyles(ctrl) {
  if (!ctrl._document || !ctrl._document.head || typeof ctrl._document.createElement !== 'function') return;
  if (ctrl._document.getElementById && ctrl._document.getElementById('ld-unmute-style')) return;

  try {
    const style = ctrl._document.createElement('style');
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
    ctrl._document.head.appendChild(style);
  } catch (_) {}
}
