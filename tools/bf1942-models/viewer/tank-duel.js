// A recorded tank fight taken apart for learning: the tank school's STUDY
// view (features/battle-schools, "Studying a fight"). Not the 3D replay: the
// fight from above, each shot through the gunner's eyes, and the hulls'
// speed, pitch and range over time, so a player can see why a shot hit or
// missed.
//
// Pure: a fight file as `extract_tank_fights.mjs` writes it (`tank-fights-
// detect.js` `sampleTankFight`) in, numbers and sentences out. Each side is
// sampled every `dt` seconds from the fight's start: `p` (x, y, z flat, the
// recorded frame: x east, y up, z north), `yaw` (heading, 0 north, 90 east),
// `pitch` and `roll` (degrees; files written before 2026-11-10 have none),
// `turret` (its yaw on the hull, or null), `hp` (`[t, hp]` steps). Each shot:
// `t`, `pos` (the muzzle), `dir`, `pv` (the firing hull's velocity), `speed`,
// `gravity`, and for one aimed at the other tank `miss`, `tau`, `range`, and
// `hit` (`{ t, drop, to }`) when rule 4 credited it.
//
// The shell flies the server's law, as the school's guns panel flies it
// (`tank-ballistics.js`): muzzle + (dir x speed + the hull's velocity) x tau,
// plus the launch's lift (FA-23, +0.98 m/s) and a first tick without
// gravity, falling 14.73 m/s^2 x the round's gravity. The detector's rule 3
// leaves the lift and the first tick out; over a vanilla shell's 2 s that
// is 3 m, which its 5 m tolerance absorbs and a picture of the miss cannot.
// Every vector this module hands out is in that recorded frame too, except
// `viewBasis`, which says which way is right and up for the gunner.

import { TICK, ROOT_LIFT } from './tank-ballistics.js';

/** The engine's gravity (IMP-8), downward. */
export const G = 14.73;
/** The height on the hull a gunner aims at, over its origin (rule 3's `aimLift`). */
export const LIFT = 1;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return mul(a, 1 / l); };
const lerp = (a, b, f) => a + (b - a) * f;
const wrap = d => ((d + 540) % 360) - 180;
const DEG = 180 / Math.PI;

/** How many samples a side holds. */
export const samplesOf = side => Math.floor((side?.p?.length ?? 0) / 3);

/** A side at `t` seconds into the fight: `{ pos, yaw, pitch, roll, turret,
 *  vel, speed, hp, live }`, between its samples. */
export function sideAt(fight, s, t) {
  const side = fight.sides[s];
  const n = samplesOf(side);
  const dt = fight.dt;
  const x = Math.max(0, Math.min(n - 1, t / dt));
  const i = Math.min(n - 2, Math.floor(x)), f = n > 1 ? x - i : 0;
  const P = k => [side.p[3 * k], side.p[3 * k + 1], side.p[3 * k + 2]];
  const pos = n > 1 ? add(P(i), mul(sub(P(i + 1), P(i)), f)) : P(0);
  const ang = (arr, deg = true) => {
    if (!arr?.length) return null;
    const a = arr[i], b = arr[Math.min(i + 1, arr.length - 1)];
    if (a == null || b == null) return a ?? b ?? null;
    return deg ? a + wrap(b - a) * f : lerp(a, b, f);
  };
  // Velocity over the samples either side (0.4 s at 0.2 s apart).
  const k0 = Math.max(0, Math.round(x) - 1), k1 = Math.min(n - 1, Math.round(x) + 1);
  const vel = k1 > k0 ? mul(sub(P(k1), P(k0)), 1 / ((k1 - k0) * dt)) : [0, 0, 0];
  let hp = null;
  for (const [ht, v] of side.hp ?? []) if (ht <= t + 1e-6) hp = v;
  const lost = (side.lost ?? []).some(([a, b]) => t >= a && t <= b);
  const gone = side.destroyed != null && t >= side.destroyed;
  return { pos, yaw: ang(side.yaw), pitch: ang(side.pitch, false), roll: ang(side.roll, false), turret: ang(side.turret),
    vel, speed: Math.hypot(vel[0], vel[2]), hp, live: !lost && !gone };
}

/** Where a shell is `tau` seconds after it left. */
export function shellAt(shot, tau) {
  const v = launchOf(shot);
  return [shot.pos[0] + v[0] * tau, shot.pos[1] + riseOf(shot, v[1], tau), shot.pos[2] + v[2] * tau];
}

/** The shell's speed as it leaves: down the bore, plus the hull's. */
const launchOf = shot => add(mul(unit(shot.dir), shot.speed || 100), shot.pv ?? [0, 0, 0]);
/** The round's gravity (signed, up positive) and lift. */
const fallOf = shot => {
  const k = Number.isFinite(shot.gravity) ? shot.gravity : 1;
  return { g: -G * k, lift: k > 0 ? ROOT_LIFT : 0 };
};
/** Height gained by `tau` from a launch speed up of `vy` (IMP-8's ticks). */
function riseOf(shot, vy, tau) {
  const { g, lift } = fallOf(shot);
  const v = vy + lift;
  if (!(g < 0)) return v * tau;
  return tau <= TICK ? v * tau : 0.375 * g * TICK * TICK + (v - 0.875 * g * TICK) * tau + 0.5 * g * tau * tau;
}
/** The launch speed up that rises `dy` by `tau` (the inverse of `riseOf`). */
function vyFor(shot, dy, tau) {
  const { g, lift } = fallOf(shot);
  if (!(g < 0) || tau <= TICK) return dy / tau - lift;
  return (dy - 0.375 * g * TICK * TICK - 0.5 * g * tau * tau) / tau + 0.875 * g * TICK - lift;
}

/** The shell's path, `[tau, x, y, z]` every `step` s, to `end` s. */
export function shellPath(shot, end, step = 0.02) {
  const out = [];
  for (let tau = 0; tau <= end + 1e-9; tau += step) out.push([tau, ...shellAt(shot, tau)]);
  return out;
}

/** Right and up for a gunner looking along `dir` (recorded frame, which is
 *  left-handed: x east, y up, z north, so right is up x forward). */
export function viewBasis(dir) {
  const f = unit(dir);
  let r = [f[2], 0, -f[0]];
  r = len(r) > 1e-6 ? unit(r) : [1, 0, 0];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  // Keep up pointing up.
  return { f, r, u: u[1] < 0 ? mul(u, -1) : u };
}

/** Heading (0 north, 90 east) of a level vector. */
const headingOf = v => Math.atan2(v[0], v[2]) * DEG;

/** Which face of the target the shooter sees: the bearing from its nose to
 *  the shooter (0 dead ahead, 90 its right, 180 its rear), and a word. */
export function aspectOf(target, from) {
  const b = wrap(headingOf(sub(from, target.pos)) - (target.yaw ?? 0));
  const a = Math.abs(b);
  const face = a <= 30 ? 'front' : a < 60 ? 'front quarter' : a <= 120 ? 'side' : a < 150 ? 'rear quarter' : 'rear';
  return { bearing: b, face, side: a < 15 || a > 165 ? null : b > 0 ? 'right' : 'left' };
}

/**
 * One shot taken apart: `{ shot, s, o, t, range, tau, pass, aimPoint, miss:
 * { right, up, total }, correction: { right, up } (degrees the gun needed to
 * move), drift: { own, theirs } (metres across the line of sight over the
 * flight: the shooter's own speed riding on the shell, and the target's
 * movement), shooter, target, aspect, hit }`. `null` when the target is not
 * on the record at the time.
 */
export function studyShot(fight, shot) {
  const s = shot.side, o = 1 - s;
  const shooter = sideAt(fight, s, shot.t), target0 = sideAt(fight, o, shot.t);
  const aimAt = st => [st.pos[0], st.pos[1] + LIFT, st.pos[2]];
  const speed = shot.speed || 100;
  // The flight to the target's closest pass, against where it really went.
  const end = Math.max(0.2, Math.min(10, fight.duration - shot.t + 2, 2 * 800 / speed));
  let best = Infinity, tau = 0;
  for (let k = 0; k <= end; k += 0.01) {
    const d = len(sub(shellAt(shot, k), aimAt(sideAt(fight, o, shot.t + k))));
    if (d < best) { best = d; tau = k; }
    if (d > best + 60) break;
  }
  // A shell at nobody: its flight out to the target's range, for the map.
  if (!shot.aimed && tau < 0.05) tau = Math.min(end, len(sub(aimAt(target0), shot.pos)) / speed);
  const target = sideAt(fight, o, shot.t + tau);
  const pass = shellAt(shot, tau), aimPoint = aimAt(target);
  const range = len(sub(aimAt(target0), shot.pos));
  const basis = viewBasis(sub(aimAt(target0), shot.pos));
  const off = sub(pass, aimPoint);
  const miss = { right: dot(off, basis.r), up: dot(off, basis.u), total: len(off) };
  // The aim that would have hit: the target where it would be when the
  // shell got there, the drop made up, the hull's own speed taken off.
  let t2 = range / speed, need = null;
  for (let k = 0; k < 5; k++) {
    const P = aimAt(sideAt(fight, o, shot.t + t2));
    const dP = sub(P, shot.pos);
    const v = [dP[0] / t2, vyFor(shot, dP[1], t2), dP[2] / t2];
    need = unit(sub(v, shot.pv ?? [0, 0, 0]));
    const out = add(mul(need, speed), shot.pv ?? [0, 0, 0]);
    t2 = Math.hypot(dP[0], dP[2]) / Math.max(1, Math.hypot(out[0], out[2]));
  }
  const d = unit(shot.dir);
  const ang = (v, axis) => Math.atan2(dot(v, axis), dot(v, basis.f)) * DEG;
  const correction = { right: ang(need, basis.r) - ang(d, basis.r), up: ang(need, basis.u) - ang(d, basis.u) };
  const across = v => dot(v, basis.r) * tau;
  const hit = shot.hit ?? hitFromEvidence(fight, shot);
  return {
    shot, s, o, t: shot.t, range, tau, pass, aimPoint, miss, correction, need, basis,
    drift: { own: across(shot.pv ?? [0, 0, 0]), theirs: across(target0.vel) },
    // How far below the gun's line the shell was when it got there.
    drop: launchOf(shot)[1] * tau - riseOf(shot, launchOf(shot)[1], tau),
    shooter, target: target0, targetAtPass: target,
    aspect: aspectOf(target0, shot.pos),
    hit: hit ?? null,
  };
}

/** A hit the fight's evidence credits to a shot, for a file written before
 *  shots carried their own (the hit's range is the shot's, landing within
 *  its flight and a second). */
function hitFromEvidence(fight, shot) {
  if (!shot.aimed) return null;
  const e = (fight.evidence ?? []).find(x => x.kind === 'hit' && x.side === shot.side
    && (x.shotT !== undefined ? Math.abs(x.shotT - shot.t) < 1e-3 : x.range === shot.range && x.t >= shot.t && x.t <= shot.t + (shot.tau ?? 1) + 1.5));
  return e ? { t: e.t, drop: e.drop ?? null, to: e.to ?? null } : null;
}

const n1 = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const m = v => `${n1(Math.abs(v))} m`;

/** The shot in plain words: what the gunner faced, and what made it hit or miss. */
export function shotWords(st, names = ['the tank', 'the tank']) {
  const who = names[st.s], them = names[st.o];
  const out = [];
  const moving = st.shooter.speed >= 0.7;
  if (!st.shot.aimed) {
    return [`${who} fired${moving ? ` on the move, at ${n1(st.shooter.speed)} m/s` : ''}, but not at ${them}: the shell never came within 5 m of the hull, so the school does not count it as aimed.`];
  }
  const pitch = st.shooter.pitch;
  out.push(`${who} fired at ${Math.round(st.range)} m${moving ? `, moving at ${n1(st.shooter.speed)} m/s` : ', stopped'}`
    + `${pitch != null && Math.abs(pitch) >= 1 ? `, hull ${n1(Math.abs(pitch))} deg nose-${pitch > 0 ? 'up' : 'down'}` : ''}`
    + `, at the ${st.aspect.face}${st.aspect.side ? ` (${st.aspect.side})` : ''} of ${them}.`);
  out.push(`The shell took ${n1(st.tau)} s and dropped ${m(st.drop)} on the way.`
    + (st.target.speed >= 0.7 ? ` In that time ${them} moved ${m(st.target.speed * st.tau)}, ${m(st.drift.theirs)} across the sight.` : ` ${them} was ${st.target.speed < 0.3 ? 'stopped' : 'barely moving'}.`));
  if (Math.abs(st.drift.own) >= 0.5) {
    out.push(`${who}'s own speed carried the shell ${m(st.drift.own)} ${st.drift.own > 0 ? 'right' : 'left'}: a shell leaves with the hull's speed added.`);
  }
  if (st.hit) {
    out.push(`Hit: ${st.hit.drop != null ? `${st.hit.drop} hit points off, ${st.hit.to} left` : 'it struck the hull'}.`);
  } else if (st.shot.aimed) {
    const v = Math.abs(st.miss.up) >= 0.5 ? `${m(st.miss.up)} ${st.miss.up > 0 ? 'high' : 'low'}` : null;
    const h = Math.abs(st.miss.right) >= 0.5 ? `${m(st.miss.right)} ${st.miss.right > 0 ? 'right' : 'left'}` : null;
    out.push(`Missed: it passed ${[v, h].filter(Boolean).join(' and ') || 'just off the hull'} of where it needed to be.`);
    const c = st.correction;
    const parts = [];
    if (Math.abs(c.up) >= 0.05) parts.push(`${n1(Math.abs(c.up))} deg ${c.up > 0 ? 'higher' : 'lower'}`);
    if (Math.abs(c.right) >= 0.05) parts.push(`${n1(Math.abs(c.right))} deg further ${c.right > 0 ? 'right' : 'left'}`);
    if (parts.length) out.push(`To hit, the gun needed to point ${parts.join(' and ')}.`);
  } else {
    out.push(`Not aimed at ${them}: it never came within 5 m of the hull.`);
  }
  return out;
}

/** The fight over time for the instruments: every sample's time, each side's
 *  speed, pitch, roll and hit points, and the range between them. */
export function timeline(fight) {
  const n = Math.min(samplesOf(fight.sides[0]), samplesOf(fight.sides[1]));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = i * fight.dt;
    const a = sideAt(fight, 0, t), b = sideAt(fight, 1, t);
    rows.push({ t, speed: [a.speed, b.speed], pitch: [a.pitch, b.pitch], roll: [a.roll, b.roll], hp: [a.hp, b.hp],
      range: len(sub(a.pos, b.pos)), live: [a.live, b.live] });
  }
  return rows;
}

/** Every shot of the fight studied, in order. */
export const studyFight = fight => (fight.shots ?? []).map(shot => studyShot(fight, shot));
