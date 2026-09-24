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
  IDKey_PrintScreen: 'PrintScreen',
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
  // A profile folder carries more than the four maps (GeneralOptions.con,
  // Video.con, ...). A file that creates no control map feeds none of them.
  if (!/^ControlMap\.create /m.test(t)) return null;
  if (/^ControlMap\.create AirPlayerInputControlMap/m.test(t)) return 'air';
  if (/^ControlMap\.create LandSeaPlayerInputControlMap/m.test(t)) return 'land';
  if (/\bc_GI[A-Z]/.test(t)) return 'common';
  return 'infantry';
}

/** The shipped default profile's crosshair colour,
 *  `Mods/bf1942/Settings/Profiles/Default/GeneralOptions.con`:
 *  `game.setCrossHairColor 255.000000 255.000000 0.000000`, yellow. A player's
 *  own profile says otherwise (the owner's is red, `255 0 0`) and an imported
 *  one wins. */
export const DEFAULT_CROSSHAIR_COLOR = Object.freeze([255, 255, 0]);

/** `[r, g, b]` when every channel is a finite number, else null. */
export function validCrossHairColor(rgb) {
  return Array.isArray(rgb) && rgb.length === 3 && rgb.every(Number.isFinite) ? rgb : null;
}

/** `game.setCrossHairColor r g b` out of a `GeneralOptions.con`, in the
 *  file's own 0-255 units (the game writes them as `%f`), or null. */
export function parseCrossHairColor(text) {
  const m = /^game\.setCrossHairColor\s+(\S+)\s+(\S+)\s+(\S+)/m.exec(String(text ?? ''));
  return m ? validCrossHairColor([Number(m[1]), Number(m[2]), Number(m[3])]) : null;
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
    // DirectInput's order: 0 left, 1 right, 2 middle.
    if (b.device === 'mouse') return b.button === 0 ? 'LMB'
      : b.button === 1 ? 'RMB' : b.button === 2 ? 'MMB' : `Mouse ${b.button + 1}`;
  }
  if (b.kind === 'axistrigger') return 'Mouse wheel';
  return '';
}

/** A key the way the game's CONTROLS screen prints it: capitals, sides
 *  spelled out (LEFT ALT, as the retail options screen shows it). */
function gameKeyName(code) {
  return {
    AltLeft: 'LEFT ALT', AltRight: 'RIGHT ALT', ControlLeft: 'LEFT CTRL',
    ControlRight: 'RIGHT CTRL', ShiftLeft: 'LEFT SHIFT', ShiftRight: 'RIGHT SHIFT',
    CapsLock: 'CAPS LOCK', Backquote: 'GRAVE', PrintScreen: 'PRINT SCREEN',
    Escape: 'ESC', PageUp: 'PAGE UP', PageDown: 'PAGE DOWN', NumLock: 'NUM LOCK',
    ScrollLock: 'SCROLL LOCK', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Backslash: '\\', Minus: '-', Equals: '=',
  }[code] ?? code.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit([0-9])$/, '$1')
    .replace(/^Arrow(\w+)$/, '$1 ARROW').replace(/^Numpad/, 'NUM ').toUpperCase();
}

/** One binding for one row of the game's CONTROLS screen. `sign` is the
 *  half of an axis the row stands for (FORWARD is `c_PIThrottle` +1); a
 *  joystick axis says which way to push it, the profile's invert flag
 *  applied, so the text is the physical direction. */
export function rowLabel(b, sign = 1) {
  if (b.kind === 'axis') {
    if (b.device === 'keyboard') return gameKeyName(b.codes[sign > 0 ? 0 : 1]);
    const dir = sign * (b.invert ? -1 : 1) > 0 ? '+' : '-';
    return `JOYSTICK AXIS ${b.axis + 1}${dir}`;
  }
  if (b.kind === 'trigger') {
    if (b.device === 'keyboard') return gameKeyName(b.code);
    if (b.device === 'controller') return `JOYSTICK ${b.button + 1}`;
    if (b.device === 'mouse') return `MOUSE ${b.button + 1}`;
  }
  if (b.kind === 'axistrigger') return sign > 0 ? 'MOUSE WHEEL UP' : 'MOUSE WHEEL DOWN';
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
  // The profile's player name (`GeneralOptions.con`'s `game.setPlayerName`,
  // else the folder the files came from) — what the options screen's
  // profile plate shows. Null under the shipped maps.
  let profileName = null;
  // The profile's crosshair colour, `GeneralOptions.con`'s
  // `game.setCrossHairColor r g b` in 0-255: what the cross and its hit marks
  // are drawn in (ledger XHIT-7). Null under the shipped maps.
  let crossHairColor = null;
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
    // The seat first: a soldier who climbed in keeps his on-foot flag (he is
    // suspended in the seat, rifle slung), and a pilot read as infantry flew
    // on the Infantry map — the keys still drove, since both maps bind WASD,
    // but a profile's stick and its joystick fire, bound only on Air, did
    // nothing. Local-look's `lookProfile` has always asked in this order.
    if (page.optPilot?.checked && page.occupancy) {
      const pilot = page.occupancy.isActiveRoot?.() ?? true;
      return page.occupancy.rootKind === 'air' && pilot ? 'air' : 'land';
    }
    if (page.optOnFoot?.checked && page.soldier) return 'infantry';
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
  controls.axis = trigger => (page.captured
    ? axisIn(trigger, controls.context(), heldKeys()) : 0);

  function axisIn(trigger, context, keys) {
    let v = 0;
    for (const b of bindingsFor(trigger, context)) {
      if (b.kind !== 'axis') continue;
      if (b.device === 'keyboard') {
        if (keys.has(b.codes[0])) v += 1;
        if (keys.has(b.codes[1])) v -= 1;
      } else if (b.device === 'controller' && b.index === 0) {
        const raw = padAxes[b.axis] ?? 0;
        const mag = Math.abs(raw) < JOY_DEADZONE
          ? 0 : (raw - Math.sign(raw) * JOY_DEADZONE) / (1 - JOY_DEADZONE);
        v += mag * (b.invert ? -1 : 1);
      }
    }
    return Math.max(-1, Math.min(1, v));
  }

  /** Whether a trigger is held at level: any of its keyboard bindings down,
   *  or any of its controller buttons down. Mouse buttons stay the page's
   *  own latches (`seatFire`, `triggerHeld`) — they already funnel through
   *  `buttonChange` with the zoom/chord semantics a raw level lacks. */
  controls.held = trigger => (page.captured
    ? heldIn(trigger, controls.context(), heldKeys(), null) : false);

  function heldIn(trigger, context, keys, mouse) {
    for (const b of bindingsFor(trigger, context)) {
      if (b.kind !== 'trigger') continue;
      if (b.device === 'keyboard' && keys.has(b.code)) return true;
      if (b.device === 'controller' && b.index === 0 && padButtons[b.button]) return true;
      if (b.device === 'mouse' && mouse?.has(b.button)) return true;
    }
    return false;
  }

  /** The same two questions for a caller that is not the in-game capture —
   *  the OPTIONS > CONTROLS screen trying a profile out on its preview. The
   *  context is named rather than read off the player, the held keys and
   *  mouse buttons are the caller's own, and the pad is whatever the last
   *  `pollGamepad` saw. */
  controls.probe = (context, keys, mouse = new Set()) => ({
    axis: trigger => axisIn(trigger, context, keys),
    held: trigger => heldIn(trigger, context, keys, mouse),
  });

  /** A CONTROLS screen row's bindings in the game's own words: every
   *  binding the maps give the row, in file order, the first two being what
   *  its primary and alternate boxes show. `row` is a `controls-rows.js`
   *  entry. */
  controls.rowLabels = (row, context) => controls.rowEntries(row, context).map(e => e.label);

  /** The same, with each binding's own "is it pressed" test —
   *  `active(keys, mouse, wheel)`, `wheel` being +1/-1 for a wheel step in
   *  flight — so the screen lights the box of the binding being used, not
   *  the whole row. */
  controls.rowEntries = (row, context) => {
    const entries = [];
    const add = (label, active) => {
      if (label && !entries.some(e => e.label === label)) entries.push({ label, active });
    };
    if (row.axis) {
      for (const b of bindingsFor(row.axis, context)) {
        if (b.kind !== 'axis') continue;
        if (b.device === 'keyboard') {
          const code = b.codes[row.sign > 0 ? 0 : 1];
          add(rowLabel(b, row.sign), keys => keys.has(code));
        } else if (b.device === 'controller' && b.index === 0) {
          const s = row.sign * (b.invert ? -1 : 1);
          add(rowLabel(b, row.sign), () => (padAxes[b.axis] ?? 0) * s > 0.5);
        }
      }
      return entries;
    }
    for (const b of bindingsFor(row.trigger, context)) {
      if (b.kind !== 'trigger') continue;
      if (b.device === 'keyboard') add(rowLabel(b), keys => keys.has(b.code));
      else if (b.device === 'mouse') add(rowLabel(b), (keys, mouse) => mouse.has(b.button));
      else if (b.device === 'controller' && b.index === 0) {
        add(rowLabel(b), () => Boolean(padButtons[b.button]));
      }
    }
    // The wheel pair (`addAxisToTriggerMapping c_PINextItem c_PIPrevItem`)
    // is one line for two rows: the first trigger is the wheel going up.
    for (const bucket of ['game', 'common', ...(context ? [context] : [])]) {
      for (const b of buckets[bucket]) {
        if (b.kind !== 'axistrigger') continue;
        if (b.trigger === row.trigger) add(rowLabel(b, 1), (k, m, wheel) => wheel > 0);
        if (b.triggerNeg === row.trigger) add(rowLabel(b, -1), (k, m, wheel) => wheel < 0);
      }
    }
    return entries;
  };

  /** A hint line with its keys filled in from the map: `{c_PIMap}` is the
   *  trigger's first key (or mouse button), `{c_PIThrottle+}` one half of an
   *  axis, `{move}` the four movement keys ("WASD" when they are four
   *  letters). The HUD's hints say what the player's own profile binds. */
  controls.hintText = (template, context) => template.replace(/\{(\w+)([+-])?\}/g,
    (whole, name, sign) => (name === 'move' ? moveKeys(context)
      : hintKey(name, sign === '-' ? -1 : sign === '+' ? 1 : 0, context)));

  function hintKey(trigger, sign, context) {
    // A trigger the context's own map leaves out (the viewer's R reset is
    // `c_PIReload`, which only Infantry binds) answers from any map.
    let found = bindingsFor(trigger, context);
    if (!found.length) found = Object.values(buckets).flat().filter(b => b.trigger === trigger);
    if (sign) {
      const b = found.find(x => x.kind === 'axis' && x.device === 'keyboard');
      return b ? prettyCode(b.codes[sign > 0 ? 0 : 1]) : '?';
    }
    const b = found.find(x => x.kind === 'trigger'
      && (x.device === 'keyboard' || x.device === 'mouse'));
    return b ? describeBinding(b) : '?';
  }

  function moveKeys(context) {
    const keys = [['c_PIThrottle', 1], ['c_PIYaw', -1], ['c_PIThrottle', -1], ['c_PIYaw', 1]]
      .map(([axis, sign]) => hintKey(axis, sign, context));
    return keys.every(k => k.length === 1) ? keys.join('') : keys.join('/');
  }

  /** The triggers one wheel step fires in a context: up is each pair's
   *  first trigger, down its second. */
  controls.wheelTriggers = (up, context) => {
    const out = [];
    for (const bucket of ['game', 'common', ...(context ? [context] : [])]) {
      for (const b of buckets[bucket]) {
        if (b.kind === 'axistrigger') out.push(up ? b.trigger : b.triggerNeg);
      }
    }
    return out;
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
      // The hat, as the game numbers it: four more buttons after the
      // physical ones (see `hatDirection`).
      const dir = hatDirection(pad);
      const base = pad.buttons.length;
      for (let i = 0; i < 4; i++) levels[base + i] = dir === i;
    } else {
      padAxes = [];
      hatSeen = new Map();
    }
    const top = Math.max(levels.length, padButtons.length);
    for (let i = 0; i < top; i++) {
      if (Boolean(levels[i]) === Boolean(padButtons[i])) continue;
      const triggers = controls.buttonTriggers(i);
      if (levels[i]) for (const t of triggers) page.padTriggerDown?.(t);
      else for (const t of triggers) page.padTriggerUp?.(t);
    }
    padButtons = levels;
  };

  // --- the POV hat -----------------------------------------------------------
  //
  // BF1942's joystick device (`0x0066e8c9` `GetDeviceState(0x110)`, the
  // DIJOYSTATE2 read, and the loop at `0x0066ea28`) folds each POV hat into
  // four buttons numbered straight after the stick's physical ones: for hat
  // p, base = numButtons + 4p, and the angle sets bit base+0 at 0 (up),
  // base+1 at 9000 (right), base+2 at 18000 (down), base+3 at 27000 (left).
  // Any other angle — the four diagonals, and centred — sets nothing. So on a
  // twelve-button Extreme 3D Pro the hat is JOYSTICK 13-16 in the options
  // screen, which is what a profile that binds it says.
  //
  // The browser never reports a hat as buttons. It arrives as axes, in one of
  // two shapes: two axes that only ever read -1, 0 or 1 (Linux, both engines:
  // joydev/evdev ABS_HAT0X/Y, y -1 is up), or one axis stepping through eight
  // positions from -1 (up) clockwise in 2/7 steps and resting above 1
  // (Chrome on Windows). An axis the profile binds as an axis is never a hat.

  // Per axis index: false once it has read anything but -1, 0 or 1.
  let hatSeen = new Map();

  function boundAxes() {
    const out = new Set();
    for (const bucket of Object.values(buckets)) {
      for (const b of bucket) {
        if (b.kind === 'axis' && b.device === 'controller' && b.index === 0) out.add(b.axis);
      }
    }
    return out;
  }

  /** The hat's cardinal direction, 0 up / 1 right / 2 down / 3 left, or -1. */
  function hatDirection(pad) {
    const axes = pad.axes;
    const bound = boundAxes();
    for (let i = 0; i < axes.length; i++) {
      const v = axes[i];
      const discrete = [-1, 0, 1].some(k => Math.abs(v - k) < 1e-6);
      if (!discrete) hatSeen.set(i, false);
      else if (!hatSeen.has(i)) hatSeen.set(i, true);
    }
    // One stepped axis: the only kind that reads past 1, at rest.
    for (let i = 0; i < axes.length; i++) {
      if (bound.has(i) || !(Math.abs(axes[i]) > 1.05) && !povAxes.has(i)) continue;
      povAxes.add(i);
      const v = axes[i];
      if (v > 1.05) return -1;
      const step = Math.round((v + 1) / (2 / 7));    // 0 up, 1 up-right, ... 7 up-left
      return step % 2 === 0 ? step / 2 : -1;
    }
    // Two discrete axes: the last pair still reading only -1/0/1.
    const pair = [];
    for (let i = axes.length - 1; i >= 0 && pair.length < 2; i--) {
      if (bound.has(i) || hatSeen.get(i) !== true) { if (pair.length) break; continue; }
      pair.unshift(i);
    }
    if (pair.length !== 2) return -1;
    const x = Math.round(axes[pair[0]]);
    const y = Math.round(axes[pair[1]]);
    if (x === 0 && y === -1) return 0;
    if (x === 1 && y === 0) return 1;
    if (x === 0 && y === 1) return 2;
    if (x === -1 && y === 0) return 3;
    return -1;
  }
  const povAxes = new Set();

  // --- profile import -------------------------------------------------------

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.files && Object.keys(saved.files).length) {
        files = { ...CONTROLS_DEFAULTS.files, ...saved.files };
        source = saved.source || 'profile';
        profileName = saved.profileName || null;
        crossHairColor = validCrossHairColor(saved.crossHairColor);
        return true;
      }
    } catch { /* a corrupt entry is a fresh start, not a crash */ }
    return false;
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, files, profileName, crossHairColor }));
    } catch { /* private mode or a full quota: the session keeps its maps */ }
  };

  /** Import profile files (a FileList or array of `{name, text}`). Files are
   *  classified by content (`classifyCon`), unknown names included; the four
   *  contexts the game writes are the ones accepted, and everything the
   *  import carries is merged over the defaults so a partial folder still
   *  yields a complete map. A whole profile folder is fine: the files that
   *  are not control maps are skipped, bar `GeneralOptions.con`'s player
   *  name and crosshair colour. */
  controls.importFiles = async items => {
    const applied = [];
    let name = null;
    let color = null;
    for (const item of items) {
      let body = null;
      try {
        body = typeof item.text === 'string' ? item.text : await item.text();
      } catch { /* an unreadable file is skipped, not a crash */ }
      if (!body) continue;
      const player = /^game\.setPlayerName\s+"([^"]*)"/m.exec(body);
      if (player) name = player[1];
      color = parseCrossHairColor(body) ?? color;
      // `Profiles/<name>/Controls/Air.con`, when a folder was picked.
      const path = item.webkitRelativePath?.split('/') ?? [];
      if (!name && path.length > 2) name = path[path.length - 3];
      const context = classifyCon(body);
      if (!CONTEXTS.includes(context)) continue;
      files[context] = body;
      applied.push({ name: item.name ?? '', context });
    }
    if (!applied.length) return { applied, source };
    source = 'profile';
    profileName = name || profileName;
    crossHairColor = color ?? crossHairColor;
    rebuild();
    save();
    return { applied, source };
  };

  controls.resetDefaults = () => {
    files = { ...CONTROLS_DEFAULTS.files };
    source = 'defaults';
    profileName = null;
    crossHairColor = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* as above */ }
    rebuild();
  };

  /** The crosshair colour in the profile's own 0-255 units: the imported
   *  profile's `game.setCrossHairColor`, else the shipped default profile's.
   *  The HUD divides it by 256, as the game's layout does. */
  controls.crossHairColor = () => crossHairColor ?? DEFAULT_CROSSHAIR_COLOR;

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
    return { source, profileName, vars: { ...vars }, rows };
  };

  load();
  rebuild();

  return controls;
}
