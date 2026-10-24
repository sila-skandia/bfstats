/* The 3D name tags, the client's `Nametags` object (`Setup+0x174`), as
 * ledger rows HUD-16..HUD-22 read it out of BF1942.exe. This module is the
 * law and nothing else: no `three`, no DOM, so `tests/nametags_harness.mjs`
 * runs it under node. `nametag-layer.js` gathers the players, casts the aim
 * ray and paints what this module answers.
 *
 * Per drawn frame, in the engine's order:
 *   1. every other player's aim state ages (`ageAim`);
 *   2. the aim pass marks the players under the crosshair (`markAimed`);
 *   3. each candidate is tagged or not (`nameTag`), which also latches the
 *      fade once the aim has held long enough for his distance.
 */

/** HUD-16: the client's own defaults, each capped by the server's
 *  `game.serverNameTagDistance` / `game.serverNameTagDistanceScope`
 *  (`Setup::setNameTagDistance` 0x00442470; the 75.0 and 300.0 written at
 *  0x00456cc5 / 0x00456ccf). */
export const NAMETAG_NEAR = 75;
export const NAMETAG_SCOPE = 300;

/** HUD-22: the anchor sits this far up the object's own up axis from its
 *  origin, past the template's `nameTagOffset`. A soldier's origin is a
 *  metre over his feet (PHY-10), so his tag is 2.5 m over them. */
export const NAMETAG_UP = 1.5;
export const SOLDIER_ORIGIN_UP = 1.0;

/** HUD-20: the target's own side picks the colour (`0x00957614[team % 3]`). */
export const TEAM_RGB = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0xff, 0x28, 0x28]),
  Object.freeze([0x10, 0x30, 0xff]),
]);
export const BUDDY_RGB = Object.freeze([0, 0xff, 0]);
/** The light colour each pulsing state eases toward. */
export const CARRIER_PULSE = Object.freeze([255, 255, 127]);
export const CALL_PULSE = Object.freeze([255, 255, 255]);
/** HUD-20: a medic or engineer call clears 25 s after it was raised. */
export const CALL_LIFETIME = 25;

/** The deploy screen's kit indices HUD-20/21 test (Scout 0 .. Engineer 4). */
export const KIT_MEDIC = 3;
export const KIT_ENGINEER = 4;

/** HUD-16: the distances a server allows, never past the client's own. */
export function nameTagDistances(serverNear = Infinity, serverScope = Infinity) {
  const cap = (own, server) => (Number.isFinite(server) && server >= 0 ? Math.min(own, server) : own);
  return { near: cap(NAMETAG_NEAR, serverNear), scope: cap(NAMETAG_SCOPE, serverScope) };
}

/** A fresh per-player aim state: `BFPlayer+0x1c8` timer, `+0x1c4` fade. */
export function aimState() {
  return { timer: 0, fade: 0 };
}

/** HUD-18, step 1: every frame the fade loses 2 a second and the timer 0.1. */
export function ageAim(state, dt) {
  const D = Number.isFinite(dt) && dt > 0 ? dt : 0;
  state.fade = Math.max(0, state.fade - 2 * D);
  state.timer = Math.max(0, state.timer - 0.1 * D);
}

/** HUD-18, step 2: a player under the crosshair this frame. */
export function markAimed(state, dt) {
  const D = Number.isFinite(dt) && dt > 0 ? dt : 0;
  state.timer = Math.min(1, state.timer + D);
}

/** HUD-18, step 3, in the draw: once the timer passes a tenth of the
 *  distance's share of the scope range, the fade latches to 1 and the timer
 *  is held at that threshold. Closer targets light sooner. */
export function latchAim(state, d, scope) {
  const t = 0.1 * d / scope;
  if (state.timer > t) {
    state.timer = t;
    state.fade = 1;
  }
}

/**
 * HUD-17 and HUD-19: the tag's alpha (0..255, an integer) for a candidate at
 * distance `d`, or 0 when it is not drawn. `friend` is the target on the
 * local player's side; `fade` his aim fade after `latchAim`.
 */
export function nameTagAlpha({ d, friend, fade, carrier = false }, { near, scope }) {
  if (carrier) return 255;
  if (!(d <= scope)) return 0;
  const nearA = d <= near ? Math.trunc(255 * Math.cos(d / near * Math.PI / 2)) : 0;
  const aimA = fade > 0 ? Math.trunc(255 * fade * Math.cos(d / scope * Math.PI / 2)) : 0;
  if (friend) return fade > 0 ? (d <= near ? Math.max(nearA, aimA) : aimA) : nearA;
  return aimA;
}

/** HUD-20: the once-a-second pulse, `s = (sin(2 pi frac(t)) + 1) / 2`,
 *  each channel `c s + k (1 - s)`. */
export function pulseRgb(rgb, toward, seconds) {
  const frac = seconds - Math.floor(seconds);
  const s = (Math.sin(2 * Math.PI * frac) + 1) / 2;
  return rgb.map((c, i) => Math.round(c * s + toward[i] * (1 - s)));
}

/** HUD-20: the tag's colour. `call` is 'medic' or 'engineer' when the
 *  target has a live call the local player can see. */
export function nameTagRgb({ team, buddy = false, carrier = false, call = null }, seconds = 0) {
  const base = buddy ? BUDDY_RGB : TEAM_RGB[((team % 3) + 3) % 3];
  if (carrier) return pulseRgb(base, CARRIER_PULSE, seconds);
  if (call) return pulseRgb(base, CALL_PULSE, seconds);
  return [...base];
}

/**
 * HUD-21: `[Name]`, and `[Name] (85%)` when the local player is on foot, on
 * the target's side, and a medic looking at a soldier (his health) or an
 * engineer looking at a seated player (his seat's or hull's health above its
 * critical damage, which a burning hull takes below zero).
 */
export function nameTagText({ name, friend, seated = false, hp = null }, { onFoot = false, kit = null } = {}) {
  const tag = `[${name}]`;
  if (!onFoot || !friend || !hp) return tag;
  let pct = null;
  if (kit === KIT_MEDIC && !seated && hp.max > 0) pct = hp.hp / hp.max * 100;
  else if (kit === KIT_ENGINEER && seated) {
    const crit = hp.critical ?? 0;
    if (hp.max - crit > 0) pct = (hp.hp - crit) / (hp.max - crit) * 100;
  }
  return Number.isFinite(pct) ? `${tag} (${Math.trunc(pct)}%)` : tag;
}
