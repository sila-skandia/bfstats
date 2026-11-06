// Opera's mouse gestures, and the hint that asks the player to turn them off
// (features/browser-play-feedback-2026-11-06, report #10).
//
// The game holds the right mouse button to aim and zoom (`c_PIAltFire`,
// `Infantry.con`), and seated it is a vehicle's second trigger. Opera on
// Windows ships with mouse gestures on: holding the right button and moving
// the mouse down opens a new tab, and holding right while clicking left
// (a rocker gesture) goes back. A first-time player in the feedback video
// lost the game to a Speed Dial tab three times while zooming. Nothing a page
// does cancels the gesture (`preventDefault` on the mouse's down and up does
// not, by Opera's own forum), so the page says once, the first time it takes
// the mouse in play, where Opera turns them off, and says it again when the
// page lost the window while the right button was held.
//
// Pure apart from the card it draws, so tests/opera_gestures_harness.mjs runs
// it under node with a stub document.

const DISMISSED_KEY = 'bfstats.operaGesturesHintDismissed';

/**
 * Whether `nav` (a `navigator`) is Opera or Opera GX. Client hints first:
 * Chromium-based Opera lists its own brand ("Opera", "Opera GX") beside
 * "Chromium" in `userAgentData.brands`. Without client hints the UA string
 * carries `OPR/` (Opera, Opera GX, Opera on Android).
 */
export function isOpera(nav) {
  const brands = nav?.userAgentData?.brands;
  if (Array.isArray(brands) && brands.some(b => /^Opera(?: GX)?$/i.test(String(b?.brand ?? '').trim()))) {
    return true;
  }
  return /\bOPR\//.test(String(nav?.userAgent ?? ''));
}

/**
 * The card's words. English, the page's only language for its own text; for
 * a German Opera (the reporting player's) the two settings carry the names
 * that Opera's German settings page gives them, so the player can find them.
 * `returned` is the second showing, after the page lost the window.
 */
export function operaHintText(lang = 'en', returned = false) {
  const de = /^de\b/i.test(String(lang ?? ''));
  const mouse = de ? 'Mouse gestures (Mausgesten)' : 'Mouse gestures';
  const rocker = de ? 'Rocker gestures (Wippgesten)' : 'Rocker gestures';
  const why = 'The game holds the right mouse button to aim and zoom, and with it '
    + 'held, a downward move opens a new tab in Opera.';
  return {
    title: returned ? 'OPERA TOOK THE MOUSE' : 'OPERA MOUSE GESTURES',
    body: (returned ? 'The game lost the window while the right button was held: '
      + 'that was most likely an Opera mouse gesture. ' : '') + why,
    steps: `Open Opera's Settings (Alt+P), go to Shortcuts (or search "gestures") `
      + `and turn off ${mouse} and ${rocker}.`,
    ok: returned ? 'BACK TO THE GAME' : 'GOT IT',
  };
}

/**
 * The hint. `nav` the navigator, `storage` localStorage (or null), `doc` the
 * document, `host` the element the card goes in (the stage), `touch` true on
 * a phone (Opera's phone builds have no mouse gestures to warn about).
 */
export function createOperaHint({ nav, storage, doc, host, touch = false } = {}) {
  const enabled = !touch && isOpera(nav);
  let dismissed = false;
  try { dismissed = storage?.getItem(DISMISSED_KEY) === '1'; } catch { /* storage off */ }
  /** Set when the page went hidden in play with the right button down. */
  let pending = false;
  let card = null;
  let onAccept = null;

  function build() {
    if (card || !doc || !host) return card;
    card = doc.createElement('div');
    card.id = 'opera-hint';
    card.hidden = true;
    card.innerHTML = '<div class="oh-panel" role="alertdialog" aria-labelledby="opera-hint-title">'
      + '<div class="oh-title" id="opera-hint-title"></div>'
      + '<p class="oh-body"></p><p class="oh-steps"></p>'
      + '<button type="button" class="oh-ok"></button></div>';
    const ok = card.querySelector('.oh-ok');
    ok.addEventListener('click', e => {
      e.stopPropagation();
      accept();
    });
    // The card is the page's for as long as it is up: nothing under it
    // takes the press that is meant for the button.
    card.addEventListener('pointerdown', e => e.stopPropagation());
    host.appendChild(card);
    return card;
  }

  function accept() {
    dismissed = true;
    pending = false;
    try { storage?.setItem(DISMISSED_KEY, '1'); } catch { /* storage off: this page load remembers */ }
    const then = onAccept;
    hide();
    then?.();
  }

  function show({ returned = false, accept: then = null } = {}) {
    if (!enabled) return false;
    const el = build();
    if (!el) return false;
    const t = operaHintText(nav?.language, returned);
    el.querySelector('.oh-title').textContent = t.title;
    el.querySelector('.oh-body').textContent = t.body;
    el.querySelector('.oh-steps').textContent = t.steps;
    el.querySelector('.oh-ok').textContent = t.ok;
    onAccept = then;
    el.hidden = false;
    return true;
  }

  function hide() {
    onAccept = null;
    if (card) card.hidden = true;
  }

  return {
    enabled,
    dismissed: () => dismissed,
    visible: () => !!card && !card.hidden,
    pending: () => pending,
    /** The capture that is about to take the mouse in play: true when the
     *  card is up instead, in which case `then` runs once it is accepted. */
    gate(inPlay, then) {
      if (!enabled || !inPlay) return false;
      if (card && !card.hidden) return true;
      if (dismissed && !pending) return false;
      return show({ returned: pending, accept: then });
    },
    /** `visibilitychange` to hidden: remembered when it caught the right
     *  button held in play, the gesture's own signature. */
    noteHidden(inPlay, rightHeld) {
      if (enabled && inPlay && rightHeld) pending = true;
      return pending;
    },
    /** Back to visible: the card again, whether or not it was dismissed
     *  before, since the gesture is evidently still on. */
    noteVisible(then) {
      if (!enabled || !pending) return false;
      return show({ returned: true, accept: then });
    },
    accept,
    hide,
  };
}
