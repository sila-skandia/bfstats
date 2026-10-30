// How a kill is filmed (features/replay-creator-view, "Shot styles"): pure,
// no page. The round cam (replay-roundcam.js) knows what happens -- the
// shooter, the round, the man it kills -- and a shot style says where the
// camera stands for it. The creator view loops a kill's clip so a style can
// be tried, changed and tried again until the shot is right.
//
// Positions are arrays in the view's frame (BF1942's with z negated), y up.

/** The styles, in the order the panel offers them: `[id, label, title]`. */
export const SHOT_STYLES = Object.freeze([
  ['chase', 'Chase', 'Behind the round, from the muzzle to the man it kills'],
  ['orbit', 'Chase 360', 'In front of the round looking back at it, swinging round behind it as it lands and on round the man as he falls'],
  ['side', 'Side-on', 'Alongside the round, the camera keeping pace with it'],
  ['reverse', 'From the victim', 'Beside the man it kills, looking back at the round coming'],
  ['fixed', 'Your angle', 'A camera you placed: still, or turning to follow the round'],
]);
export const STYLE_IDS = Object.freeze(SHOT_STYLES.map(([id]) => id));
export const styleOf = id => (STYLE_IDS.includes(id) ? id : 'chase');
export const styleLabel = id => SHOT_STYLES.find(([s]) => s === id)?.[1] ?? 'Chase';

/** A kill made by hand: nothing flies. The server records a knife's swing
 *  as a fire record (`KnifeAxis`, its round `KnifeProjectile`, 2 m long),
 *  so the dossier finds a "round" for it; the round cam must not chase one.
 *  Recording 8t224pppqe (Berlin, 2026-10-29) at 114.40 s: BF6 knifes pid 0. */
export const MELEE = /knife|bayonet/i;
export const isMelee = weapon => MELEE.test(String(weapon ?? ''));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * Chase 360's turn round the round, radians off dead behind it: in front of
 * it (pi) for the first part of the flight, swinging round to behind it (0)
 * as it lands. `p` is the flight's progress, 0 at the muzzle, 1 at the man.
 */
export function orbitYaw(p) {
  return Math.PI * (1 - smooth(0.3, 1, p));
}

/** The rest of the turn while the man falls: half a turn more over the hold,
 *  `k` its share of the hold, eased. Chase 360's flight and its hold are one
 *  full turn between them. */
export function holdYaw(k) {
  return Math.PI * smooth(0, 1, k);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => {
  const n = len(a);
  return n > 1e-6 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, -1];
};

/** Whether the line from `a` to `b` stays over the ground (`ground(x, z)`,
 *  a height or not a number), `margin` metres over it. Only the terrain:
 *  a wall between them is not seen. */
export function clearOfGround(a, b, ground, margin = 0.2, steps = 16) {
  if (typeof ground !== 'function') return true;
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    const x = a[0] + (b[0] - a[0]) * k;
    const y = a[1] + (b[1] - a[1]) * k;
    const z = a[2] + (b[2] - a[2]) * k;
    const g = ground(x, z);
    if (Number.isFinite(g) && y < g + margin) return false;
  }
  return true;
}

/**
 * Camera angles worth trying on a kill, worked out from where it happened:
 * `from` the muzzle, `to` the man it killed (a metre over his feet). Each is
 * `{ id, label, pos, look, clear }`, `clear` false when something stands
 * between the camera and what it frames; the clear ones first. The terrain
 * is `ground(x, z)`; `sees(a, b)`, when given, is the level's own line of
 * sight (the page's collider: walls and buildings), and a side-on or high
 * angle that a wall blocks is tried again closer in -- a street in Berlin is
 * a few metres wide. Kept above the ground by `lift` metres.
 */
export function suggestAngles({ from, to, ground = null, sees = null, lift = 0.5 }) {
  if (!Array.isArray(from) || !Array.isArray(to)) return [];
  const span = sub(to, from);
  const flat = [span[0], 0, span[2]];
  const L = Math.max(1, len(span));
  const d = len(flat) > 1e-3 ? unit(flat) : [0, 0, -1];
  const perp = unit([-d[2], 0, d[0]]);
  const up = [0, 1, 0];
  const mid = add(from, span, 0.5);
  const floor = p => {
    const g = typeof ground === 'function' ? ground(p[0], p[2]) : NaN;
    if (Number.isFinite(g) && p[1] < g + lift) p[1] = g + lift;
    return p;
  };
  const open = (a, b) => clearOfGround(a, b, ground) && (typeof sees !== 'function' || sees(a, b) !== false);
  const out = [];
  // The first of `tries` (positions, widest first) that sees all of `targets`,
  // else the first.
  const push = (id, label, tries, look, targets = [look]) => {
    const placed = tries.map(floor);
    const pos = placed.find(p => targets.every(t => open(p, t))) ?? placed[0];
    out.push({ id, label, pos, look, clear: targets.every(t => open(pos, t)) });
  };
  // Side-on, wide enough to hold both men, on whichever side is open.
  const off = clamp(L * 0.55, 3, 45);
  const sideTries = [];
  for (const k of [1, 0.5, 0.25, 0.12]) {
    const o = Math.max(2.5, off * k);
    for (const sign of [1, -1]) sideTries.push(add(add(mid, perp, sign * o), up, 1.2 + o * 0.08));
  }
  push('side', 'Side-on', sideTries, mid, [mid, to, from]);
  push('shoulder', 'Over the shoulder', [add(add(add(from, d, -3.5), perp, 0.9), up, 1.1), add(add(add(from, d, -1.8), perp, 0.6), up, 0.6)], to.slice());
  push('victim', 'Behind the victim', [add(add(add(to, d, 3), perp, 1.2), up, 0.4), add(add(add(to, d, 1.6), perp, -0.8), up, 0.4)], from.slice());
  const h = clamp(L * 0.5, 8, 60);
  const highTries = [1, 0.5, 0.3].flatMap(k => [1, -1].map(sign =>
    add(add(add(mid, d, -L * 0.25 * k), perp, sign * h * 0.5 * k), up, Math.max(5, h * k))));
  push('high', 'High and wide', highTries, mid, [mid, to]);
  const lows = [1, -1].map(sign => {
    const low = add(add(to, d, -clamp(L * 0.3, 2, 8)), perp, sign * 2.5);
    const g = typeof ground === 'function' ? ground(low[0], low[2]) : NaN;
    low[1] = Number.isFinite(g) ? g + 0.35 : to[1] - 0.6;
    return low;
  });
  push('low', 'Low at the victim', lows, add(to, up, -0.2), [to]);
  return [...out.filter(a => a.clear), ...out.filter(a => !a.clear)];
}

/** An angle read back from the browser's storage, or null. */
export function angleOf(a) {
  const ok = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!a || !ok(a.pos) || !ok(a.look)) return null;
  return { pos: [...a.pos], look: [...a.look], aim: a.aim === 'lock' ? 'lock' : 'track' };
}
