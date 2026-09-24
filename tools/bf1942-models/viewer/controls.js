// The control map: the layer between raw devices and the engine's input
// channels that the page used to be missing. The game builds its from the
// profile's `Controls/{Common,Infantry,Air,Land}.con` (four text files of
// `ControlMap.*` lines); this module parses the same grammar, ships the
// game's own defaults (`controls-defaults.js`, baked from the install by
// `extract_profile_controls.py`), accepts an imported player profile over
// them, and answers the rest of the page's questions in the game's own
// vocabulary — triggers (`c_PIMap`), never `event.code` literals.
//
// Device model: `IDFKeyboard` is the browser keyboard (`IDKey_*` names a
// DirectInput scancode, the same physical-key identity as `event.code`),
// `IDFMouse` is the pointer (mouse-button and wheel bindings — the page's
// mouse stages keep their own plumbing; only the look axes were ever mouse
// channels), and `IDFGameController_0` is the first gamepad the browser
// reports, polled once a frame (`pollGamepad`) for button levels, edges and
// axis values. A joystick therefore lands on the same channels the profile
// bound: the Air map's `IDAxis_0..3` are the stick's roll/pitch/yaw/throttle.
//
// Context overlay: the engine merges the game map (`c_GI*`) and the common
// player map under one context map — Infantry on foot, Air in an aircraft,
// Land (and sea) everywhere else seated. Identical bindings repeated across
// the files (every context file restates the common section) dedupe on the
// binding's identity, so an axis is never summed twice.

import { GameConsole } from './console.js';
import { CONTROLS_DEFAULTS } from './controls-defaults.js';

const STORAGE_KEY = 'viewer.controls.profile';

/** `IDKey_*` names that are not a one-or-two-character prefix away from a
 *  browser `event.code`. The browser's own names are used where the two
 *  spellings disagree; anything not in the engine's vocabulary is dropped
 *  rather than guessed into a phantom key. */
const KEY_IDS = {
  IDKey_LeftAlt: 'AltLeft', IDKey_RightAlt: 'AltRight',
  IDKey_LeftCtrl: 'ControlLeft', IDKey_RightCtrl: 'ControlRight',
  IDKey_LeftShift: 'ShiftLeft', IDKey_RightShift: 'ShiftRight',
  IDKey_Capital: 'CapsLock', IDKey_Grave: 'Backquote',
  IDKey_Tab: 'Tab', IDKey_Enter: 'Enter', IDKey_Escape: 'Escape',
  IDKey_Space: 'Space', IDKey_Backspace: 'Backspace',
  IDKey_Delete: 'Delete', IDKey_Insert: 'Insert',
  IDKey_PageUp: 'PageUp', IDKey_PageDown: 'PageDown',
  IDKey_Minus: 'Minus', IDKey_Equals: 'Equals', IDKey_Comma: 'Comma',
  IDKey_Period: 'Period', IDKey_Slash: 'Slash',
  IDKey_Semicolon: 'Semicolon', IDKey_Apostrophe: 'Quote',
  IDKey_LeftBracket: 'BracketLeft', IDKey_RightBracket: 'BracketRight',
  IDKey_Backslash: 'Backslash', IDKey_Home: 'Home', IDKey_End: 'End',
  IDKey_Pause: 'Pause', IDKey_Scroll: 'ScrollLock', IDKey_Numlock: 'NumLock',
};

/** A DirectInput key name → the browser's physical `event.code`. The names
 *  agree with the browser's by construction for `Key_*`, `Digit_*`, `Arrow*`,
 *  `Numpad*` and the F-keys, which is the point of matching on `event.code`:
 *  the engine bound scancodes, and `code` is the scancode the browser has. */
export function keyIdToCode(id) {
  if (KEY_IDS[id]) return KEY_IDS[id];
  const rest = id?.slice('IDKey_'.length) ?? '';
  if (/^[0-9]$/.test(rest)) return `Digit${rest}`;
  if (/^[A-Z]$/.test(rest)) return `Key${rest}`;
  if (/^(Arrow(?:Up|Down|Left|Right)|Numpad[A-Za-z0-9]+)$/.test(rest)) return rest;
  if (/^F(?:[1-9]|1[0-2])$/.test(rest)) return rest;
  return null;
}

/** A `ControlMap.*` device argument → `{ device, index }`. */
function deviceOf(id) {
  if (id === 'IDFKeyboard') return { device: 'keyboard', index: 0 };
  if (id === 'IDFMouse') return { device: 'mouse', index: 0 };
  const pad = /^IDFGameController_(\d+)$/.exec(id || '');
  if (pad) return { device: 'controller', index: Number(pad[1]) };
  return null;
}

const s31 = Number.isInteger;

/** A DirectInput numbered id (`IDButton_12`, `IDAxis_3`) → its number. */
function idNumber(id, prefix) {
  return id?.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
}

/**
 * Parse one `.con` file's text into bindings and `game.set*` variables.
 * `ControlMap.create` names are recorded but not acted on — which context a
 * file's bindings feed is the file's own identity (`classifyCon`), the way
 * the game loads them by filename.
 */
export function parseCon(text) {
  const bindings = [];
  const vars = {};
  const maps = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    // `rem` comments run to end of line; the files use `rem *** ... ***`.
    if (line.startsWith('rem ') || line.startsWith('rem\t')) continue;
    const tok = line.split(/\s+/);
    const verb = tok[0];
    if (verb === 'ControlMap.create') { maps.push(tok[1] || ''); continue; }
    if (verb === 'run') continue;             // `run User.con`, usually absent
    if (verb?.startsWith('game.set')) {
      const value = Number(tok[1]);
      if (tok.length === 2 && Number.isFinite(value)) vars[verb] = value;
      continue;
    }
    if (!verb?.startsWith('ControlMap.')) continue;
    const a = tok.slice(1);
    if (verb === 'ControlMap.addKeyToTriggerMapping') {
      const dev = deviceOf(a[1]);
      const code = keyIdToCode(a[2]);
      if (dev?.device === 'keyboard' && code) {
        bindings.push({ kind: 'trigger', device: 'keyboard', index: 0,
                        trigger: a[0], code, flags: a[3] || '' });
      }
    } else if (verb === 'ControlMap.addButtonToTriggerMapping') {
      const dev = deviceOf(a[1]);
      const button = idNumber(a[2], 'IDButton_');
      if (dev && s31(button)) {
        bindings.push({ kind: 'trigger', device: dev.device, index: dev.index,
                        trigger: a[0], button, flags: a[3] || '' });
      }
    } else if (verb === 'ControlMap.addKeysToAxisMapping') {
      const dev = deviceOf(a[1]);
      const pos = keyIdToCode(a[2]);
      const neg = keyIdToCode(a[3]);
      if (dev?.device === 'keyboard' && pos && neg) {
        bindings.push({ kind: 'axis', device: 'keyboard', index: 0,
                        trigger: a[0], codes: [pos, neg], flags: a[4] || '' });
      }
    } else if (verb === 'ControlMap.addAxisToAxisMapping') {
      const dev = deviceOf(a[1]);
      const axis = idNumber(a[2], 'IDAxis_');
      if (dev && s31(axis) && dev.device !== 'mouse') {
        // The mouse's two axes are the look stage's channels (`c_PIMouseLookX/Y`),
        // which mouse-input.js owns with its own engine law; a keyboard-only
        // parse of them would be an empty alias. Everything else — the
        // controller axes — is what this module is here for. The first
        // trailing number is the invert flag (`AxisMapping+0x4c`, the same
        // word mouse-input.js reads on the look axes); a second one appears
        // on some joystick lines and its meaning is unchased, so it is kept
        // nothing — a guessed deadzone would be worse than none.
        bindings.push({ kind: 'axis', device: dev.device, index: dev.index,
                        trigger: a[0], axis,
                        invert: Number(a[3]) === 1 });
      }
    } else if (verb === 'ControlMap.addAxisToTriggerMapping') {
      // The wheel pair (`c_PINextItem/c_PIPrevItem`, `c_GIMouseWheelUp/Down`):
      // recorded so an import round-trips, but the page's own wheel handling
      // (kit cycling on foot, dolly in free fly) stays — it predates the
      // control map and the wheel's direction sense is the browser's.
      bindings.push({ kind: 'axistrigger', device: 'mouse', index: 0,
                      trigger: a[0], triggerNeg: a[1],
                      axis: idNumber(a[3], 'IDAxis_') });
    }
    // Anything else (`ControlMap.addAxisMapping` and friends from older
    // formats) is out of the shipped grammar and ignored.
  }
  return { bindings, vars, maps };
}

/** Which of the four contexts a `.con` file feeds, from its own content —
 *  robust to however the file is named. The common file is the one carrying
 *  the game-input (`c_GI*`) bindings; the context maps name themselves. */
export function classifyCon(text) {
  const t = String(text ?? '');
  if (/^ControlMap\.create AirPlayerInputControlMap/m.test(t)) return 'air';
  if (/^ControlMap\.create LandSeaPlayerInputControlMap/m.test(t)) return 'land';
  if (/\bc_GI[A-Z]/.test(t)) return 'common';
  return 'infantry';
}

/** The identity a binding dedupes on: the context files restate the common
 *  section verbatim, and a summed axis must not be paid twice. */
function bindingKey(b) {
  if (b.kind === 'trigger') {
    return `${b.trigger}|${b.device}|${b.index}|${b.code ?? `btn${b.button}`}`;
  }
  if (b.kind === 'axis') {
    return `${b.trigger}|${b.device}|${b.index}|${b.codes ? b.codes.join('+') : `ax${b.axis}`}`;
  }
  return `${b.trigger}|${b.triggerNeg}|${b.device}|${b.axis}`;
}

/** Human display for a binding, the way the game's options screen words it.
 *  Joystick buttons are 1-based there (`IDButton_11` renders as JOYSTICK 12). */
export function describeBinding(b) {
  if (b.kind === 'axis') {
    if (b.device === 'keyboard') return b.codes.map(prettyCode).join(' / ');
    if (b.device === 'controller') return `Joystick axis ${b.axis + 1}`;
  }
  if (b.kind === 'trigger') {
    if (b.device === 'keyboard') return prettyCode(b.code);
    if (b.device === 'controller') return `Joystick ${b.button + 1}`;
    if (b.device === 'mouse') return b.button === 0 ? 'LMB'
      : b.button === 1 ? 'MMB' : b.button === 2 ? 'RMB' : `Mouse ${b.button}`;
  }
  if (b.kind === 'axistrigger') return 'Mouse wheel';
  return '';
}

function prettyCode(code) {
  return {
    AltLeft: 'L Alt', AltRight: 'R Alt', ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    CapsLock: 'Caps Lock', Backquote: '~', Enter: 'Enter',
    Escape: 'Esc', PrintScreen: 'PrtScn',
  }[code] ?? code.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit([0-9])$/, '$1')
    .replace(/^Arrow/, '').replace(/^Numpad/, 'Num');
}

const CONTEXTS = ['common', 'infantry', 'air', 'land'];

/**
 * Built once by the page. `page` hands in, as live getters:
 * `keys` (the pageInput key Set), `captured`, `optOnFoot`, `optPilot`,
 * `occupancy` (the local player's; `rootKind` names air vs land vs sea),
 * `soldier`, `padTriggerDown`/`padTriggerUp` (the pageInput's edge dispatch).
 */
export function createControls(page) {
  const controls = {};

  // The deadzone the browser's analogue axes need — a 2002 DirectInput stick
  // rests slightly off centre, and a real one rest-drifts. 0.15 is the
  // stand-in until the owner's stick is measured against the live viewer.
  const JOY_DEADZONE = 0.15;

  let source = 'defaults';
  let files = { ...CONTROLS_DEFAULTS.files };
  // Per context: deduped binding lists, and the indexes the queries read.
  let buckets = null;        // { game: [], common: [], infantry: [], air: [], land: [] }
  let vars = {};
  let keyIndex = null;       // code -> Set<trigger>, over every bucket
  let consoleCodes = new Set();
  let radioCodes = new Map();  // code -> 1..8, over the common bucket
  let padButtons = [];       // per button index: level (bool), last poll
  let padAxes = [];

  const isGameTrigger = t => t.startsWith('c_GI');

  function rebuild() {
    const dedupe = new Map();   // key -> binding, per destination bucket
    buckets = { game: [], common: [], infantry: [], air: [], land: [] };
    vars = {};
    radioCodes = new Map();
    for (const context of CONTEXTS) {
      const text = files[context];
      if (text == null) continue;
      const { bindings, vars: fileVars } = parseCon(text);
      Object.assign(vars, fileVars);
      for (const b of bindings) {
        const bucket = isGameTrigger(b.trigger) ? 'game' : context;
        const key = bindingKey(b);
        const seen = dedupe.get(bucket);
        if (!seen) { buckets[bucket].push(b); dedupe.set(bucket, new Map([[key, b]])); continue; }
        if (!seen.has(key)) { seen.set(key, b); buckets[bucket].push(b); }
      }
      // Radio numbers come from the common player map (`c_PIRadio1..8`).
      for (const b of bindings) {
        if (b.device !== 'keyboard' || b.kind !== 'trigger') continue;
        const radio = /^c_PIRadio([1-8])$/.exec(b.trigger);
        if (radio) radioCodes.set(b.code, Number(radio[1]));
      }
    }
    keyIndex = new Map();
    for (const bucket of Object.values(buckets)) {
      for (const b of bucket) {
        if (b.kind !== 'trigger' || b.device !== 'keyboard') continue;
        if (!keyIndex.has(b.code)) keyIndex.set(b.code, new Set());
        keyIndex.get(b.code).add(b.trigger);
      }
    }
    consoleCodes = new Set(triggerKeyboardCodes('c_GIToggleConsole'));
    // The shipped maps also bind Caps Lock to the console toggle, and an
    // imported profile may carry that line — but in the retail game that key
    // is the spawn screen, and it is the viewer's spawn toggle too (the page
    // has no other way to reach the spawn interface by key). The console
    // keeps Grave and whatever else the map says; Caps Lock is dropped.
    consoleCodes.delete('CapsLock');
    GameConsole.toggleCodes = consoleCodes.size ? consoleCodes : null;
  }

  /** Every keyboard code a trigger is bound to, in any bucket. */
  function triggerKeyboardCodes(trigger) {
    const out = new Set();
    for (const bucket of Object.values(buckets)) {
      for (const b of bucket) {
        if (b.trigger === trigger && b.device === 'keyboard') {
          if (b.kind === 'trigger' && b.code) out.add(b.code);
          if (b.kind === 'axis') for (const c of b.codes) out.add(c);
        }
      }
    }
    return out;
  }

  /** The active context map, the engine's overlay: game + common + the one
   *  context the player is in. The same rule mouse-input.js's `profileFor`
   *  already applies to the sensitivity: VCLand/VCSea are the LandSea map,
   *  VCAir the Air one, only a pilot flies on Air, and the soldier keeps
   *  Infantry. */
  controls.context = () => {
    if (page.optOnFoot?.checked && page.soldier) return 'infantry';
    if (page.optPilot?.checked && page.occupancy) {
      return page.occupancy.rootKind === 'air' ? 'air' : 'land';
    }
    return null;    // free camera: the game map and common still answer
  };

  /** Bindings for one trigger, active overlay (or a named context). */
  function bindingsFor(trigger, context = controls.context()) {
    const out = [];
    for (const bucket of ['game', 'common', ...(context ? [context] : [])]) {
      for (const b of buckets[bucket]) if (b.trigger === trigger) out.push(b);
    }
    return out;
  }

  const heldKeys = () => (page.captured ? page.keys : null);

  /** Channel value for an axis trigger in [-1, 1]: the keyboard's two keys
   *  of the pair and the controller's axes, summed and clamped — the engine
   *  folds every binding of a channel the same way. Mouse axes are the look
   *  stage's and never come through here. Zero unless the page is captured:
   *  the input word is the device stage's, and the free camera's WASD is not
   *  the player's. */
  controls.axis = trigger => {
    if (!page.captured) return 0;
    let v = 0;
    for (const b of bindingsFor(trigger)) {
      if (b.kind !== 'axis') continue;
      if (b.device === 'keyboard') {
        if (heldKeys().has(b.codes[0])) v += 1;
        if (heldKeys().has(b.codes[1])) v -= 1;
      } else if (b.device === 'controller' && b.index === 0) {
        const raw = padAxes[b.axis] ?? 0;
        const mag = Math.abs(raw) < JOY_DEADZONE
          ? 0 : (raw - Math.sign(raw) * JOY_DEADZONE) / (1 - JOY_DEADZONE);
        v += mag * (b.invert ? -1 : 1);
      }
    }
    return Math.max(-1, Math.min(1, v));
  };

  /** Whether a trigger is held at level: any of its keyboard bindings down,
   *  or any of its controller buttons down. Mouse buttons stay the page's
   *  own latches (`seatFire`, `triggerHeld`) — they already funnel through
   *  `buttonChange` with the zoom/chord semantics a raw level lacks. */
  controls.held = trigger => {
    if (!page.captured) return false;
    const keys = heldKeys();
    for (const b of bindingsFor(trigger)) {
      if (b.device === 'keyboard' && b.kind === 'trigger' && keys.has(b.code)) return true;
      if (b.device === 'controller' && b.kind === 'trigger' && b.index === 0
          && padButtons[b.button]) return true;
    }
    return false;
  };

  /** Triggers a keyboard code is bound to, over every bucket — the keydown
   *  router's vocabulary. Several triggers share a code legitimately (Tab is
   *  both the scoreboard and the game map's `c_GITab`), so this is a list. */
  controls.codeTriggers = code => [...(keyIndex.get(code) ?? [])];

  /** Triggers a controller button is bound to, in the active overlay — the
   *  gamepad poller's dispatch list. */
  controls.buttonTriggers = button => {
    const out = new Set();
    const context = controls.context();
    for (const bucket of ['game', 'common', ...(context ? [context] : [])]) {
      for (const b of buckets[bucket]) {
        if (b.kind === 'trigger' && b.device === 'controller'
            && b.index === 0 && b.button === button) out.add(b.trigger);
      }
    }
    return [...out];
  };

  /** The keyboard codes any context binds — the capture gate's set (what a
   *  seated or on-foot player may swallow from the browser). The free
   *  camera's own `FLY_KEYS` is the page's, not the profile's, and stays. */
  controls.activeCodes = () => new Set(keyIndex.keys());

  /** The Keyboard-Lock key list, derived not hardcoded: every keyboard code
   *  the player bindings (common + infantry) carry, which is what an on-foot
   *  session may need the browser to hand over. */
  controls.kblockKeys = () => {
    const out = new Set();
    for (const bucket of ['common', 'infantry']) {
      for (const b of buckets[bucket]) {
        if (b.device !== 'keyboard' || isGameTrigger(b.trigger)) continue;
        if (b.kind === 'trigger') out.add(b.code);
        if (b.kind === 'axis') for (const c of b.codes) out.add(c);
      }
    }
    return [...out];
  };

  /** `c_PIRadio1..8` for a key, else 0. */
  controls.radioNumberOf = code => radioCodes.get(code) ?? 0;

  /** One frame of joystick: levels and axes off the browser's first pad,
   *  edges dispatched to the page's trigger handlers. The pad is usually
   *  absent (browsers expose it only after a press) — that is the normal
   *  state, and the no-pad frame costs one empty array. */
  controls.pollGamepad = () => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads
      ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const levels = [];
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i++) {
        const btn = pad.buttons[i];
        levels[i] = !!(btn && (btn.pressed || btn.value > 0.5));
      }
      padAxes = pad.axes.slice();
    } else {
      padAxes = [];
    }
    const top = Math.max(levels.length, padButtons.length);
    for (let i = 0; i < top; i++) {
      if (levels[i] === padButtons[i]) continue;
      const triggers = controls.buttonTriggers(i);
      if (levels[i]) for (const t of triggers) page.padTriggerDown?.(t);
      else for (const t of triggers) page.padTriggerUp?.(t);
    }
    padButtons = levels;
  };

  // --- profile import -------------------------------------------------------

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.files && Object.keys(saved.files).length) {
        files = { ...CONTROLS_DEFAULTS.files, ...saved.files };
        source = saved.source || 'profile';
        return true;
      }
    } catch { /* a corrupt entry is a fresh start, not a crash */ }
    return false;
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, files }));
    } catch { /* private mode or a full quota: the session keeps its maps */ }
  };

  /** Import profile files (a FileList or array of `{name, text}`). Files are
   *  classified by content (`classifyCon`), unknown names included; the four
   *  contexts the game writes are the ones accepted, and everything the
   *  import carries is merged over the defaults so a partial folder still
   *  yields a complete map. */
  controls.importFiles = async items => {
    const applied = [];
    for (const item of items) {
      let body = null;
      try {
        body = typeof item.text === 'string' ? item.text : await item.text();
      } catch { /* an unreadable file is skipped, not a crash */ }
      if (!body) continue;
      const name = item.name ?? '';
      const context = classifyCon(body);
      if (!CONTEXTS.includes(context)) continue;
      files[context] = body;
      applied.push({ name, context });
    }
    if (!applied.length) return { applied, source };
    source = 'profile';
    rebuild();
    save();
    return { applied, source };
  };

  controls.resetDefaults = () => {
    files = { ...CONTROLS_DEFAULTS.files };
    source = 'defaults';
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* as above */ }
    rebuild();
  };

  /** What the sidebar paints: where the maps came from, and every player
   *  trigger's bindings in the game's own display wording. */
  controls.describe = () => {
    const triggers = [];
    const seen = new Set();
    for (const bucket of ['common', 'infantry', 'air', 'land']) {
      for (const b of buckets[bucket]) {
        if (isGameTrigger(b.trigger) || seen.has(b.trigger)) continue;
        seen.add(b.trigger);
        triggers.push(b.trigger);
      }
    }
    const rows = [];
    for (const trigger of triggers) {
      const labels = new Set();
      for (const context of ['infantry', 'air', 'land']) {
        for (const b of bindingsFor(trigger, context)) {
          const d = describeBinding(b);
          if (d) labels.add(d);
        }
      }
      if (labels.size) rows.push({ trigger, labels: [...labels] });
    }
    return { source, vars: { ...vars }, rows };
  };

  load();
  rebuild();

  return controls;
}
