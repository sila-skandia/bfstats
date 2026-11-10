// Tank fights found in a round's recording (features/battle-schools, "Tank
// fights from the recordings"): two tanks of opposite sides, each with a
// driver, their main guns firing at each other, hit points falling, one
// killing the other. The tank school lists what it finds; the dogfight
// detector (`dogfight-detect.js`) is the pattern.
//
// Pure: a recording parsed by the viewer's own reader (`replay-recording.js`
// `parseRecording`) in, a list of fights out. Every position is in the
// recording's frame (BF1942's: x east, y up, z north).
//
// The rules, in order (each number is in `RULES`):
//
// 1. A tank is a life someone drives (a control record on the life itself,
//    the driver's seat, the root PCO) whose template the caller's `tank`
//    test passes (`extract_tank_fights.mjs` asks the game's AI data first,
//    `class: 'Land'` with `equipmentType: 0`, then the model catalogue,
//    `tank-arena.js` `isTank`). Without a test, any life that fires a main
//    gun and has 100 hit points or more.
// 2. A main-gun shot is a round (`f`) from the tank's own root whose weapon
//    is named for a tank gun (`...GunBarrel`, `...Cannon`, `...MainGun`) and
//    not a machine gun, a flame gun, smoke, a spotter or an air gun. A mod
//    fires two or three invisible barrels at once for one shell (FHSW's
//    `M36GunBarrelAP` and `...HE`); shots of one tank `shotMerge` seconds
//    apart are one.
// 3. An aimed shot passes within `aimMiss` metres of an enemy tank's hull
//    (`aimLift` above its origin): the shell flown from the muzzle at the
//    gun's own speed (100 m/s when the caller does not know it) down the
//    recorded direction, plus the firing hull's velocity, falling at
//    14.73 m/s^2 times the round's `gravityModifier`, for up to `shellLife`
//    seconds, against where the target really went. Both tanks must have a
//    driver aboard and be on opposite sides. A shell aimed at nobody, at a
//    friend, or at an empty hull is not one.
// 4. A hit is the target's hit points falling between the shot and `hitSlack`
//    seconds after the shell's closest pass (a server recording's impact on
//    the hull counts on its own). One fall is credited to one shot: of the
//    shells aimed at that hull whose window holds it, the one due to land
//    last before it and not yet credited (`creditFor`).
// 5. A kill is the score's kill line: the killer one of the shooting tank's
//    crew, the victim the other tank's driver, the weapon (a vehicle kill
//    names the killer's vehicle) that tank's template or none. A client
//    recording has no killer for an empty hull; a hull that fell to 0 on a
//    credited hit with its driver aboard and no kill line is a kill too.
// 6. A fight is a run of evidence (aimed shots both ways, hits, the kill) with
//    no gap over `gap` seconds, opened `leadIn` before its first piece and
//    closed `tail` after its last (`killTail` after a kill), trimmed to where
//    both tanks are live (replicated: a client recording sees only what is
//    within view distance of its player) and driven by those two. It needs
//    `minAimed` aimed shots, or one with a hit or the kill.
// 7. A fight without a kill runs on past its tail while both are live, driven
//    and inside `engaged` metres, for up to `engagedMore` seconds.
// 8. Every fight says why it stopped (`end.why`): `killed` (by the other),
//    `killed by another` (who, with what), `destroyed` (no one credited),
//    `left` (the driver got out), `out of range` (the recording lost a hull),
//    `apart` (beyond `engaged`), `quiet` (nobody firing).
// 9. The range of a kill is the killing shot's: from its muzzle to the
//    victim's hull when it was fired. The killing shot is the killer's last
//    hit on the victim fired before the kill (its hit points may land up to
//    `hitSlack` after the kill line), else the last aimed shot within
//    `killShot` seconds. Without one, the range between the hulls at the
//    kill (`rangeHow: 'kill'`).
// 10. Each tank's weight (`weightOf`): `heavy` at `heavyHp` hit points or
//    more, `light` under `lightHp` or when the AI calls it `LightArmour`,
//    `medium` between. Vanilla's Tiger (125) is heavy, every other vanilla
//    tank (100) medium. The glb's `vehicleType` is carried but not used: the
//    game calls the T-34 and the M10 `VTHeavyTank` and the T-34-85 and the
//    Panzer IV `VTLightTank`, which is no weight. An upset is a kill by the
//    lighter tank.

import { isReplicated, teamAt, nameAt, flownPositionAt, flownRotationAt, hpAt } from './replay-recording.js';

export const RULES = Object.freeze({
  version: 1,
  driverGap: 2,
  shotMerge: 0.3,
  aimMiss: 5,
  aimLift: 1,
  aimRange: 800,
  aimCone: 30,
  shellLife: 10,
  shellSpeed: 100,
  gravity: 14.73,
  hitSlack: 1,
  killShot: 8,
  gap: 20,
  leadIn: 5,
  tail: 4,
  killTail: 3,
  minAimed: 2,
  live: 0.6,
  engaged: 500,
  engagedMore: 10,
  step: 0.1,
  lightHp: 100,
  heavyHp: 125,
});

/** A tank gun's name: a barrel, a cannon, a main gun. */
const MAIN_GUN = /gunbarrel|cannon|maingun/i;
/** What a tank carries beside its gun, named like one now and then. */
const NOT_MAIN = /coax|mg\d|_mg|bowmg|browning|besa|vickers|breda|^aa|radar|flak|smoke|flam|trac|horn|extinguish|spotter|nahvert|jump/i;

/** Whether a fired weapon's name is a tank's main gun (rule 2). */
export const isMainGunShot = weapon => MAIN_GUN.test(String(weapon ?? '')) && !NOT_MAIN.test(String(weapon ?? ''));

/** A tank's weight class (rule 10) from its full hit points and the AI's
 *  armour word. */
export function weightOf(hpMax, strType = null, rules = RULES) {
  const hp = Number(hpMax);
  if (Number.isFinite(hp) && hp >= rules.heavyHp) return 'heavy';
  if ((Number.isFinite(hp) && hp > 0 && hp < rules.lightHp) || /^lightarmour$/i.test(String(strType ?? ''))) return 'light';
  return 'medium';
}
export const WEIGHT_RANK = Object.freeze({ light: 0, medium: 1, heavy: 2 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const posAt = flownPositionAt;
const liveAt = (life, t) => t >= life.created && t < (life.destroyed ?? Infinity) && isReplicated(life, t);

/** The life's velocity at `t`, from its positions a tenth either side. */
export function velAt(life, t, h = 0.1) {
  const t0 = Math.max(life.created, t - h), t1 = Math.min(life.destroyed ?? Infinity, t + h);
  const a = posAt(life, t0), b = posAt(life, t1);
  if (!a || !b || t1 - t0 < 1e-6) return [0, 0, 0];
  return sub(b, a).map(v => v / (t1 - t0));
}

/** Who drove which life when: per nid, `[{ pid, from, to }]` (a control
 *  record holds until the player's next one or death). */
export function controlSpans(rec) {
  const byPid = new Map();
  for (const c of rec.control) {
    if (!byPid.has(c.pid)) byPid.set(c.pid, []);
    byPid.get(c.pid).push(c);
  }
  const deaths = new Map();
  for (const d of rec.deaths ?? []) {
    if (!deaths.has(d.pid)) deaths.set(d.pid, []);
    deaths.get(d.pid).push(d.t);
  }
  const spans = new Map();
  for (const [pid, list] of byPid) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      const from = list[i].t;
      let to = i + 1 < list.length ? list[i + 1].t : rec.duration;
      const died = (deaths.get(pid) ?? []).find(t => t > from && t < to);
      if (died !== undefined) to = died;
      if (to <= from) continue;
      const nid = list[i].nid;
      if (!spans.has(nid)) spans.set(nid, []);
      spans.get(nid).push({ pid, from, to });
    }
  }
  return spans;
}

/**
 * Every tank of the round (rules 1 and 2): `{ life, info, drivers: [{ pid,
 * from, to }], shots: [fire] }`. `tank(tmpl)` is the caller's test: null or
 * false for no tank, else what it knows (`{ hpMax, strType, vehicleType }`).
 */
export function tanksOf(rec, rules = RULES, tank = null) {
  const spans = controlSpans(rec);
  const firesBy = new Map();
  for (const f of rec.fires) {
    if (f.soldier || f.feedOnly || !f.pos || !f.dir || f.nid === null || f.nid === undefined) continue;
    if (!isMainGunShot(f.weapon)) continue;
    if (!firesBy.has(f.nid)) firesBy.set(f.nid, []);
    firesBy.get(f.nid).push(f);
  }
  const tanks = [];
  for (const life of rec.lives) {
    if (life.soldier || life.camera || life.kit || life.projectile || life.controlPoint) continue;
    const driven = spans.get(life.nid);
    if (!driven?.length) continue;
    const end = life.destroyed ?? rec.duration;
    // A mod's one shell, two or three barrels: one shot, every barrel kept
    // (`alts`) since the invisible ones leave from odd places (FHSW's M36
    // fires `M36GunBarrelAP` 12 m under its turret); rule 3 flies each.
    const shots = [];
    for (const f of (firesBy.get(life.nid) ?? []).sort((a, b) => a.t - b.t)) {
      if (f.t < life.created || f.t >= end) continue;
      const last = shots.at(-1);
      if (last && f.t - last.t <= rules.shotMerge) { last.alts.push(f); continue; }
      shots.push({ ...f, alts: [f] });
    }
    let info = null;
    if (tank) {
      info = tank(life.tmpl ?? '');
      if (!info) continue;
      if (info === true) info = {};
    } else {
      if (!shots.length || !(life.maxhp >= 100)) continue;
      info = {};
    }
    // One drive, many control records: spans of one driver `driverGap` apart
    // are one.
    const merged = [];
    for (const s of [...driven].sort((a, b) => a.pid - b.pid || a.from - b.from)) {
      const last = merged.at(-1);
      if (last && last.pid === s.pid && s.from - last.to <= rules.driverGap) last.to = Math.max(last.to, s.to);
      else merged.push({ ...s });
    }
    const drivers = merged
      .map(s => ({ pid: s.pid, from: Math.max(s.from, life.created), to: Math.min(s.to, end) }))
      .filter(s => s.to - s.from > 1)
      .sort((a, b) => a.from - b.from);
    if (!drivers.length) continue;
    const hpMax = life.maxhp > 0 ? life.maxhp : Number(info.hpMax) || null;
    tanks.push({ life, info, drivers, shots, hpMax, weight: weightOf(hpMax, info.strType, rules) });
  }
  return tanks;
}

const driverAt = (T, t) => T.drivers.find(d => t >= d.from && t <= d.to) ?? null;

/**
 * How close a shell fired at `f` from `shooter` passes `target` (rule 3):
 * `{ miss, tau, range }`, the least distance over its flight and when, and
 * the range from the muzzle to the hull as it left; null when it never could.
 * `gun` is `{ speed, gravity }` (m/s, the round's gravityModifier).
 */
export function shellMiss(f, shooter, target, gun = null, rules = RULES) {
  const tp = posAt(target, f.t);
  if (!tp || !liveAt(target, f.t)) return null;
  const aimAt = [tp[0], tp[1] + rules.aimLift, tp[2]];
  const los = sub(aimAt, f.pos);
  const range = len(los);
  if (range > rules.aimRange) return null;
  const dl = len(f.dir) || 1;
  const dir = f.dir.map(v => v / dl);
  // Level bearing first: a gun turned away from him is not aimed at him.
  const hl = Math.hypot(los[0], los[2]), hd = Math.hypot(dir[0], dir[2]);
  if (hl > 10 && hd > 1e-3) {
    const c = (dir[0] * los[0] + dir[2] * los[2]) / (hl * hd);
    if (Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI > rules.aimCone) return null;
  }
  const speed = gun?.speed > 0 ? gun.speed : rules.shellSpeed;
  const g = rules.gravity * (Number.isFinite(gun?.gravity) ? gun.gravity : 1);
  const pv = velAt(shooter, f.t);
  const v = [dir[0] * speed + pv[0], dir[1] * speed + pv[1], dir[2] * speed + pv[2]];
  let best = Infinity, at = 0;
  const end = Math.min(rules.shellLife, (target.destroyed ?? Infinity) - f.t, 2 * rules.aimRange / speed);
  for (let tau = 0; tau <= end; tau += 0.02) {
    const p = posAt(target, f.t + tau);
    if (!p) break;
    const d = Math.hypot(f.pos[0] + v[0] * tau - p[0],
      f.pos[1] + v[1] * tau - 0.5 * g * tau * tau - p[1] - rules.aimLift,
      f.pos[2] + v[2] * tau - p[2]);
    if (d < best) { best = d; at = tau; }
    // Past him and falling away: done.
    if (d > best + 50) break;
  }
  return { miss: best, tau: at, range };
}

/** Which aimed shot a hull's damage at `t` is credited to (rule 4): of the
 *  shells whose window holds `t`, the one due to arrive last before it (a
 *  client hears of the damage a tick or two after the shell lands), else the
 *  first due after it. */
function creditFor(shots, t, credited = null) {
  let best = null, bestLate = Infinity;
  for (const x of shots) {
    if (t < x.t || t > x.until) continue;
    const late = t - (x.t + x.tau);
    // A shell already credited lands once: another in the air comes first.
    const key = (late >= -0.25 ? late : 1e3 - late) + (credited?.has(x.shot) ? 1e6 : 0);
    if (key < bestLate) { best = x; bestLate = key; }
  }
  return best;
}

/** The first death of one of `pids` in `(from, to]`, the credited one when
 *  the same death comes twice. */
function deathOf(rec, pids, from, to) {
  const list = (rec.deaths ?? []).filter(d => pids.includes(d.pid) && d.t > from && d.t <= to);
  if (!list.length) return null;
  const first = list.reduce((a, b) => (b.t < a.t ? b : a));
  return list.find(d => Math.abs(d.t - first.t) < 0.05 && d.killer !== null && d.killer !== undefined) ?? first;
}

/**
 * The round's tank fights (rules 3 to 9). Each is `{ t0, t1, sides: [two {
 * pid, name, team, tmpl, nid, weight, hpMax, hpStart, shots, aimed, hits,
 * gunners }], tanks, kill, range, rangeHow, end, mutual, closest, evidence,
 * fullHpStart, upset, winner }`, side 0 the first to fire an aimed shot.
 * `tank(tmpl)` is rule 1's test, `gun(tmpl, weapon)` the gun's `{ speed,
 * gravity }` (null for the defaults).
 */
export function findTankFights(rec, rules = RULES, { tank = null, gun = null } = {}) {
  const tanks = tanksOf(rec, rules, tank);
  const evidence = new Map(); // `${i}:${pa}|${j}:${pb}` (i < j) -> [evidence]
  const keyOf = (i, pa, j, pb) => (i < j ? `${i}:${pa}|${j}:${pb}` : `${j}:${pb}|${i}:${pa}`);
  const push = (key, e) => {
    if (!evidence.has(key)) evidence.set(key, []);
    evidence.get(key).push(e);
  };
  // Rule 3: each shot, against every enemy hull live and driven then; aimed
  // at the one it passes closest.
  const aimedAt = tanks.map(() => []); // per target: [{ t, until, from: i, pid, shot }]
  for (const [i, A] of tanks.entries()) {
    for (const f of A.shots) {
      const da = driverAt(A, f.t);
      if (!da) continue;
      const ta = teamAt(rec, da.pid, f.t);
      if (!(ta === 1 || ta === 2)) continue;
      let best = null;
      for (const [j, B] of tanks.entries()) {
        if (j === i) continue;
        const db = driverAt(B, f.t);
        if (!db || db.pid === da.pid) continue;
        const tb = teamAt(rec, db.pid, f.t);
        if (!(tb === 1 || tb === 2) || tb === ta) continue;
        for (const alt of f.alts ?? [f]) {
          const m = shellMiss(alt, A.life, B.life, gun ? gun(A.life.tmpl, alt.weapon) : null, rules);
          if (m && m.miss <= rules.aimMiss && (!best || m.miss < best.m.miss)) best = { j, db, m, alt };
        }
      }
      if (!best) continue;
      const e = { t: f.t, kind: 'aimed', from: i, pid: f.pid ?? da.pid, miss: best.m.miss, tau: best.m.tau, range: best.m.range, weapon: best.alt.weapon, shot: f };
      push(keyOf(i, da.pid, best.j, best.db.pid), e);
      aimedAt[best.j].push({ ...e, driver: da.pid, target: best.db.pid, until: f.t + best.m.tau + rules.hitSlack });
    }
  }
  // Rule 4: hits.
  const serverImpacts = (rec.impacts?.length ?? 0) > 0;
  const hitBy = new Map(); // aimed evidence -> hit evidence
  for (const [j, B] of tanks.entries()) {
    const shots = aimedAt[j].sort((a, b) => a.t - b.t);
    if (!shots.length) continue;
    if (serverImpacts) {
      for (const im of rec.impacts) {
        if (im.obj !== B.life.nid) continue;
        const s = creditFor(shots.filter(x => x.pid === im.pid || x.driver === im.pid), im.t, hitBy);
        if (s && !hitBy.has(s.shot)) hitBy.set(s.shot, { t: im.t, how: 'impact', s, drop: null, to: hpAt(B.life, im.t + 0.2) });
      }
    } else {
      const hp = B.life.hp ?? [];
      for (let k = 1; k < hp.length; k++) {
        if (!(hp[k].hp < hp[k - 1].hp)) continue;
        const s = creditFor(shots, hp[k].t, hitBy);
        if (!s) continue;
        const was = hitBy.get(s.shot);
        if (was) { was.drop += hp[k - 1].hp - hp[k].hp; was.to = hp[k].hp; continue; }
        hitBy.set(s.shot, { t: hp[k].t, how: 'hp', s, drop: hp[k - 1].hp - hp[k].hp, to: hp[k].hp });
      }
    }
    for (const h of hitBy.values()) {
      if (h.s.shot && shots.includes(h.s) && !h.pushed) {
        h.pushed = true;
        push(keyOf(h.s.from, h.s.driver, j, h.s.target), { t: h.t, kind: 'hit', from: h.s.from, how: h.how, drop: h.drop, to: h.to, range: h.s.range, shotT: h.s.t });
      }
    }
  }
  // Rule 5: kills. Every pair with evidence, its kill lines.
  const crewPids = (T, from, to) => {
    const pids = new Set(T.drivers.filter(d => d.to >= from && d.from <= to).map(d => d.pid));
    for (const f of T.shots) if (f.t >= from && f.t <= to && f.pid !== null && f.pid !== undefined) pids.add(f.pid);
    return pids;
  };
  for (const [key, list] of evidence) {
    const [[i, pa], [j, pb]] = key.split('|').map(s => s.split(':').map(Number));
    const A = tanks[i], B = tanks[j];
    const from = Math.min(...list.map(e => e.t)) - rules.gap, to = Math.max(...list.map(e => e.t)) + rules.gap;
    for (const [s, S, O, po] of [[i, A, B, pb], [j, B, A, pa]]) {
      const crew = crewPids(S, from, to);
      const lifeEnd = O.life.destroyed ?? Infinity;
      for (const k of rec.kills ?? []) {
        if (k.kind !== 'kill' || k.t < from || k.t > to || k.victim !== po || !crew.has(k.killer)) continue;
        if (k.weapon && String(k.weapon).toLowerCase() !== String(S.life.tmpl).toLowerCase()) continue;
        // The victim in his tank at the kill (or the tank gone with him).
        const aboard = O.drivers.some(d => d.pid === po && k.t >= d.from - 0.5 && k.t <= d.to + 1.5) || Math.abs(lifeEnd - k.t) < 2;
        if (!aboard) continue;
        list.push({ t: k.t, kind: 'kill', from: s, how: 'line', weapon: k.weapon ?? null, killer: k.killer });
      }
      // No kill line: a credited hit that took the hull to 0, its driver aboard.
      if (!list.some(e => e.kind === 'kill' && e.from === s)) {
        const zero = list.find(e => e.kind === 'hit' && e.from === s && e.to === 0);
        if (zero && O.drivers.some(d => d.pid === po && zero.t >= d.from - 0.5 && zero.t <= d.to + 1.5)
            && !(rec.kills ?? []).some(k => k.victim === po && Math.abs(k.t - zero.t) < 2)) {
          list.push({ t: zero.t, kind: 'kill', from: s, how: 'hp', weapon: null, killer: null });
        }
      }
    }
  }
  const found = [];
  for (const [key, list] of evidence) {
    const [[i, pa], [j, pb]] = key.split('|').map(s => s.split(':').map(Number));
    found.push(...pairFights(rec, rules, tanks, i, pa, j, pb, list.sort((a, b) => a.t - b.t), hitBy));
  }
  return found.sort((a, b) => a.t0 - b.t0);
}

function pairFights(rec, rules, tanks, i, pa, j, pb, ev, hitBy) {
  const A = tanks[i], B = tanks[j];
  const spansA = A.drivers.filter(d => d.pid === pa), spansB = B.drivers.filter(d => d.pid === pb);
  const driven = (spans, t) => spans.some(d => t >= d.from && t <= d.to);
  const both = t => liveAt(A.life, t) && liveAt(B.life, t) && driven(spansA, t) && driven(spansB, t);
  const runs = [];
  for (const e of ev) {
    const last = runs.at(-1);
    if (last && e.t - last.at(-1).t <= rules.gap) last.push(e); else runs.push([e]);
  }
  const fights = [];
  for (const [ri, run] of runs.entries()) {
    const aimed = run.filter(e => e.kind === 'aimed');
    const kill = run.find(e => e.kind === 'kill') ?? null;
    const hits = run.filter(e => e.kind === 'hit');
    if (!aimed.length) continue;
    if (aimed.length < rules.minAimed && !hits.length && !kill) continue;
    // The span both drivers hold around the run.
    const sa = spansA.find(d => d.from <= run[0].t + 0.5 && d.to >= run[0].t - 0.5) ?? spansA[0];
    const sb = spansB.find(d => d.from <= run[0].t + 0.5 && d.to >= run[0].t - 0.5) ?? spansB[0];
    const from = Math.max(sa.from, sb.from), to = Math.min(sa.to, sb.to);
    let t0 = Math.max(from, run[0].t - rules.leadIn);
    let t1 = kill ? kill.t + rules.killTail : run.at(-1).t + rules.tail;
    t1 = Math.min(t1, kill ? Infinity : to, rec.duration);
    let death = null;
    if (!kill) {
      // Rule 7: still at it past the tail.
      const next = runs[ri + 1];
      const limit = Math.min(t1 + rules.engagedMore, to, rec.duration, next ? next[0].t - rules.leadIn : Infinity);
      for (let u = t1; u <= limit; u += rules.step) {
        if (!both(u)) break;
        const p = posAt(A.life, u), q = posAt(B.life, u);
        if (!p || !q || len(sub(p, q)) > rules.engaged) break;
        t1 = u;
      }
      // Rule 8: one of them killed as it ends.
      death = deathOf(rec, [pa, pb], run.at(-1).t, t1 + 0.5);
      if (death) t1 = Math.min(death.t + rules.killTail, rec.duration);
    }
    // Live and driven for most of it; opened where both first are.
    let first = null, live = 0, all = 0;
    const liveTo = Math.min(t1, kill ? kill.t : death ? death.t : t1);
    for (let t = t0; t <= liveTo; t += rules.step) {
      all++;
      if (!both(t)) continue;
      live++;
      if (first === null) first = t;
    }
    if (first === null || live / Math.max(1, all) < rules.live) continue;
    t0 = Math.min(first, run[0].t);
    if (t1 - t0 < 1) continue;
    let closest = Infinity;
    for (let t = t0; t <= t1; t += rules.step) {
      const p = posAt(A.life, t), q = posAt(B.life, t);
      if (p && q && liveAt(A.life, t) && liveAt(B.life, t)) closest = Math.min(closest, len(sub(p, q)));
    }
    const firstSide = aimed[0].from === i ? 0 : 1;
    const order = firstSide === 0 ? [[A, pa, i], [B, pb, j]] : [[B, pb, j], [A, pa, i]];
    const sideOf = from => (order[0][2] === from ? 0 : 1);
    const sides = order.map(([T, pid, idx], s) => {
      const O = order[1 - s][0];
      const hpStart = hpAt(T.life, t0) ?? T.life.hp?.[0]?.hp ?? T.hpMax;
      const mine = run.filter(e => e.from === idx);
      const fired = T.shots.filter(f => f.t >= t0 && f.t <= t1);
      const gunners = [...new Set(fired.map(f => f.pid).filter(p => p !== null && p !== undefined && p !== pid))];
      return {
        pid, name: nameAt(rec, pid, t0), team: teamAt(rec, pid, t0), tmpl: T.life.tmpl ?? null, nid: T.life.nid,
        weight: T.weight, hpMax: T.hpMax, hpStart, hpEnd: hpAt(T.life, Math.min(t1, (T.life.destroyed ?? Infinity) - 1e-3)),
        vehicleType: T.info.vehicleType ?? null, strType: T.info.strType ?? null,
        shots: fired.length, aimed: mine.filter(e => e.kind === 'aimed').length, hits: mine.filter(e => e.kind === 'hit').length,
        gunners: gunners.map(g => ({ pid: g, name: nameAt(rec, g, t0) })),
        destroyed: Number.isFinite(T.life.destroyed) ? T.life.destroyed : null, target: O.life.nid,
      };
    });
    // Rule 9: the killing shot.
    let range = null, rangeHow = null, killShotT = null;
    if (kill) {
      // The hull's last hit points often come a tick after the kill line:
      // a hit counts by its shot's time, up to `hitSlack` past the kill.
      const by = run.filter(e => e.from === kill.from
        && (e.kind === 'hit' ? e.shotT <= kill.t + 1e-6 && e.t <= kill.t + rules.hitSlack : e.t <= kill.t + 1e-6));
      const hit = by.filter(e => e.kind === 'hit').sort((a, b) => a.shotT - b.shotT).at(-1);
      const shot = hit
        ? by.find(e => e.kind === 'aimed' && Math.abs(e.t - hit.shotT) < 1e-6)
        : [...by].reverse().find(e => e.kind === 'aimed' && kill.t - e.t <= rules.killShot);
      if (shot) { range = shot.range; rangeHow = 'shot'; killShotT = shot.t; }
      else {
        const p = posAt(A.life, kill.t), q = posAt(B.life, kill.t);
        if (p && q) { range = len(sub(p, q)); rangeHow = 'kill'; }
      }
    }
    let end;
    if (kill) end = { why: 'killed', t: kill.t, side: 1 - sideOf(kill.from) };
    else if (death) {
      const side = (death.pid === order[0][1]) ? 0 : 1;
      end = death.killer === null || death.killer === undefined
        ? { why: 'destroyed', t: death.t, side }
        : { why: 'killed by another', t: death.t, side, by: { pid: death.killer, name: nameAt(rec, death.killer, death.t), weapon: death.weapon ?? null } };
    } else {
      const u = t1 + rules.step;
      end = null;
      for (const s of [0, 1]) {
        const spans = order[s][0].drivers.filter(d => d.pid === order[s][1]);
        if (!end && !driven(spans, u)) end = { why: 'left', t: t1, side: s };
      }
      for (const s of [0, 1]) if (!end && !liveAt(order[s][0].life, u)) end = { why: 'out of range', t: t1, side: s };
      if (!end) {
        const p = posAt(A.life, u), q = posAt(B.life, u);
        if (p && q && len(sub(p, q)) > rules.engaged) end = { why: 'apart', t: t1, distance: Math.round(len(sub(p, q))) };
      }
      end ??= { why: 'quiet', t: t1, since: run.at(-1).t };
    }
    const winner = kill ? sideOf(kill.from) : null;
    const full = sides.every(s => s.hpMax > 0 && s.hpStart >= s.hpMax - 1e-6);
    const upset = winner !== null && WEIGHT_RANK[sides[winner].weight] < WEIGHT_RANK[sides[1 - winner].weight];
    const hitRanges = run.filter(e => e.kind === 'hit').map(e => e.range);
    fights.push({
      t0, t1, sides, tanks: order.map(([T]) => T), pids: order.map(([, p]) => p),
      kill: kill ? { t: kill.t, side: sideOf(kill.from), how: kill.how, weapon: kill.weapon ?? null, shotT: killShotT } : null,
      range, rangeHow, end, winner,
      mutual: aimed.some(e => e.from === i) && aimed.some(e => e.from === j),
      closest: Number.isFinite(closest) ? closest : null,
      firstRange: aimed[0].range,
      longestHit: hitRanges.length ? Math.max(...hitRanges) : null,
      fullHpStart: full, upset,
      weightGap: winner === null ? 0 : WEIGHT_RANK[sides[1 - winner].weight] - WEIGHT_RANK[sides[winner].weight],
      evidence: run.map(e => ({ t: e.t, kind: e.kind, side: sideOf(e.from),
        ...(e.miss !== undefined ? { miss: e.miss, tau: e.tau } : {}), ...(e.range !== undefined ? { range: e.range } : {}),
        ...(e.how ? { how: e.how } : {}), ...(e.drop !== undefined && e.drop !== null ? { drop: e.drop, to: e.to } : {}),
        ...(e.shotT !== undefined ? { shotT: e.shotT } : {}), ...(e.weapon ? { weapon: e.weapon } : {}) })),
    });
  }
  return fights;
}

/**
 * The list's ranking (documented in features/battle-schools/README.md, "Tank
 * fights from the recordings"): the kill's range in metres (half the longest
 * hit's without a kill), times 1 + 0.5 a weight class the winner was lighter
 * by (a light tank killing a heavy doubles it), times 1.25 when both opened
 * at full hit points, times 1.1 when both fired.
 */
export function scoreOf(fight) {
  const base = fight.kill ? (fight.range ?? 0) : 0.5 * (fight.longestHit ?? 0);
  const upset = fight.upset ? 1 + 0.5 * fight.weightGap : 1;
  return Math.round(base * upset * (fight.fullHpStart ? 1.25 : 1) * (fight.mutual ? 1.1 : 1) * 10) / 10;
}

/** A hull's heading in degrees (recorded frame: 0 north, 90 east) from its
 *  rotation: its nose, +z of the model, turned by `q`. */
function headingOf(q) {
  const [x, y, z, w] = q;
  const fx = 2 * (x * z + w * y), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz) * 180 / Math.PI;
}

/** A hull's pitch and roll in degrees from its rotation (recorded frame):
 *  pitch, the nose above level (+ up); roll, the right side above level
 *  (+ right side up). */
export function attitudeOf(q) {
  const [x, y, z, w] = q;
  // The nose (+z) and the right side (+x) turned by `q`; only their height matters.
  const noseY = 2 * (y * z - w * x), rightY = 2 * (x * y + w * z);
  const deg = v => Math.asin(Math.max(-1, Math.min(1, v))) * 180 / Math.PI;
  return { pitch: deg(noseY), roll: deg(rightY) };
}

/** The turret's yaw on the hull at `t` (degrees), from the hull's moving
 *  part named for a tower or turret; null when the recording keeps none. */
function turretAt(rec, nid, t) {
  const parts = rec.joints?.get(nid);
  if (!parts) return null;
  for (const part of parts.values()) {
    if (!/tower|turret/i.test(part.name ?? '') || !part.keys?.length) continue;
    const keys = part.keys;
    let lo = 0, hi = keys.length - 1;
    if (keys.time(0) > t) return null;
    while (hi > lo) {
      const mid = (lo + hi + 1) >> 1;
      if (keys.time(mid) <= t) lo = mid; else hi = mid - 1;
    }
    const { q } = keys.sample(lo);
    return headingOf(q);
  }
  return null;
}

/**
 * A found fight sampled for a theatre: both hulls every `dt` seconds from
 * `t0` (recorded frame, times from 0): place, heading, hull pitch and roll
 * (`attitudeOf`), turret yaw on the hull, hit points over time; every
 * main-gun shot either tank fired in it, each with the hit rule 4 credited
 * to it (`hit`). The tank school's STUDY view reads it (`tank-duel.js`).
 */
export function sampleTankFight(rec, fight, { dt = 0.2, gun = null, rules = RULES } = {}) {
  const r1 = v => Math.round(v * 10) / 10;
  const r3 = v => Math.round(v * 1000) / 1000;
  const n = Math.floor((fight.t1 - fight.t0) / dt) + 1;
  const sides = fight.sides.map((side, s) => {
    const T = fight.tanks[s];
    const life = T.life;
    const p = [], yaw = [], turret = [], pitch = [], roll = [];
    for (let i = 0; i < n; i++) {
      const t = Math.min(fight.t0 + i * dt, (life.destroyed ?? Infinity) - 1e-3);
      const at = posAt(life, t) ?? [0, 0, 0];
      p.push(r1(at[0]), r1(at[1]), r1(at[2]));
      const q = flownRotationAt(life, t);
      yaw.push(r1(headingOf(q)));
      const att = attitudeOf(q);
      pitch.push(r1(att.pitch));
      roll.push(r1(att.roll));
      const ty = turretAt(rec, life.nid, t);
      turret.push(ty === null ? null : r1(ty));
    }
    const hp = [[0, hpAt(life, fight.t0) ?? side.hpStart]];
    for (const h of life.hp ?? []) if (h.t > fight.t0 && h.t <= fight.t1) hp.push([r3(h.t - fight.t0), h.hp]);
    const lost = [];
    for (let i = 0; i < n; i++) {
      const t = fight.t0 + i * dt;
      const gone = !liveAt(life, t) && t < (life.destroyed ?? Infinity);
      const last = lost.at(-1);
      if (gone && last && last[1] >= r1((i - 1) * dt) - 1e-6) last[1] = r1(i * dt);
      else if (gone) lost.push([r1(i * dt), r1(i * dt)]);
    }
    return { ...side, p, yaw, pitch, roll, turret, hp, lost: lost.filter(([a, b]) => b - a >= 0.5) };
  });
  const aimedT = new Map(fight.evidence.filter(e => e.kind === 'aimed').map(e => [`${e.side}:${r3(e.t)}`, e]));
  const shots = [];
  for (const [s, T] of fight.tanks.entries()) {
    for (const f of T.shots) {
      if (f.t < fight.t0 || f.t > fight.t1) continue;
      const a = aimedT.get(`${s}:${r3(f.t)}`);
      // The barrel that flew at him when one did, else the first.
      const b = (a && f.alts?.find(x => x.weapon === a.weapon)) || f;
      const g = gun ? gun(T.life.tmpl, b.weapon) : null;
      // The hit rule 4 credited to this shot, if one was.
      const h = fight.evidence.find(e => e.kind === 'hit' && e.side === s && e.shotT !== undefined && Math.abs(e.shotT - f.t) < 1e-3);
      shots.push({ side: s, t: r3(f.t - fight.t0), pos: b.pos.map(r1), dir: b.dir.map(v => Math.round(v * 1e4) / 1e4),
        pv: velAt(T.life, f.t).map(r1), weapon: b.weapon, speed: g?.speed ?? rules.shellSpeed, gravity: g?.gravity ?? 1,
        aimed: Boolean(a), ...(a ? { miss: r1(a.miss), tau: r3(a.tau), range: Math.round(a.range) } : {}),
        ...(h ? { hit: { t: r3(h.t - fight.t0), drop: h.drop ?? null, to: h.to ?? null } } : {}) });
    }
  }
  shots.sort((a, b) => a.t - b.t);
  return {
    dt, t0: r3(fight.t0), duration: r3((n - 1) * dt),
    kill: fight.kill ? { ...fight.kill, t: r3(fight.kill.t - fight.t0), shotT: fight.kill.shotT === null ? null : r3(fight.kill.shotT - fight.t0) } : null,
    range: fight.range === null ? null : Math.round(fight.range), rangeHow: fight.rangeHow,
    end: { ...fight.end, t: r3(Math.max(0, fight.end.t - fight.t0)), ...(fight.end.since !== undefined ? { since: r3(Math.max(0, fight.end.since - fight.t0)) } : {}) },
    evidence: fight.evidence.map(e => ({ ...e, t: r3(e.t - fight.t0), ...(e.miss !== undefined ? { miss: r1(e.miss), tau: r3(e.tau) } : {}),
      ...(e.shotT !== undefined ? { shotT: r3(e.shotT - fight.t0) } : {}),
      ...(e.range !== undefined ? { range: Math.round(e.range) } : {}) })),
    sides: sides.map(({ destroyed, target, ...rest }) => ({ ...rest, destroyed: destroyed === null ? null : r3(destroyed - fight.t0) })),
    shots,
  };
}
