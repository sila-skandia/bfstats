// The action roll (features/action-roll): one continuous take through a
// round, the camera passed from one man's action to the next man near where
// it landed. A rocket is ridden to the tank it hits, the camera turns to the
// tank's crew firing back, then glides on to whoever is in range of that.
// When nothing is close it rises over the level and flies to the next fight.
//
//   node scripts/action-roll.mjs --recording=<slug> [--from=<s>] [--length=<s>]
//        [--out=~/.cache/bfstats-roll] [--name=<take>] [--gpu] [--channel=chrome]
//        [--sound] [--play=https://play.bfstats.io] [--api=https://bfstats.io]
//        [--seed=<n>] [--bpm=<n>]
//
// Films 1920x1080 at 30 fps through the live play page, the way the Shorts
// runner does (scripts/shorts-runner.mjs): a virtual clock moved one frame at
// a time, the page's sound rendered offline in step, ffmpeg for the MP4.
// The director runs in the page, so each hand-over is judged on where the
// page's round really landed. Every beat it takes is written to beats.json.
//
// --bpm lays the hand-overs on the song's bar lines (4 beats a bar): a pass
// waits for the next bar before it starts, and a beat may not end before
// the one after. Without it the roll cuts on the action alone.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireShortsAuth, shortsAuth } from './shorts-auth.mjs';
import { tvFilter } from './video-range.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(REPO, 'ui/package.json'))('playwright');

const args = process.argv.slice(2);
// --script=<roll.script.json>: film a take again from its script (below,
// "The script"). Its settings stand in for the options it recorded.
const SCRIPT_PATH = args.find(a => a.startsWith('--script='))?.slice(9) ?? null;
const SCRIPT = SCRIPT_PATH ? JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8')) : null;
const fromScript = {
  recording: SCRIPT?.recording?.slug, from: SCRIPT?.take?.from, length: SCRIPT?.take?.length, seed: SCRIPT?.take?.seed,
  bpm: SCRIPT?.take?.bpm, res: SCRIPT?.take?.res,
};
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? (fromScript[n] !== undefined && fromScript[n] !== null ? String(fromScript[n]) : d);
const API = opt('api', 'https://bfstats.io');
const PLAY = opt('play', 'https://play.bfstats.io');
const SLUG = opt('recording', null);
const FROM = opt('from', null);
// --recap: a match recap (features/match-recap), the round's key moments the
// recorder saw well, faded one into the next, then its salt. --length is
// then the most its moments may run.
const RECAP = args.includes('--recap') || Boolean(SCRIPT?.take?.recap);
const LENGTH = Number(opt('length', RECAP ? 140 : 75));
const OUT = opt('out', path.join(os.homedir(), RECAP ? '.cache/bfstats-recap' : '.cache/bfstats-roll'));
const SOUND = args.includes('--sound') || Boolean(SCRIPT?.take?.sound);
const BPM = Number(opt('bpm', 0)) || 0;
const SEED = Number(opt('seed', 1));
// Rendered at --res lines (2160 by default: the owner, 2026-11-11, "1080p
// looks a bit dated"), then encoded at every quality at or under it.
const RES = Number(opt('res', 2160));
const H = RES, W = Math.round(RES * 16 / 9 / 2) * 2, FPS = 30;
/** The qualities written: lines, x264 CRF, peak rate. */
// 4K and HD only (the owner, 2026-11-12: "either 4k or HD is enough").
const QUALITIES = [[2160, 19, '45M'], [1080, 21, '12M']].filter(([h]) => h <= RES);
if (!QUALITIES.length) QUALITIES.push([RES, 21, '12M']);
const AUDIO_RATE = 38400;
const AUDIO_SPAN = 1200;
const STEP_TIMEOUT = 60 * 1000;
const LOAD_TIMEOUT = 8 * 60 * 1000;
const UPLOAD_TAKE = opt('upload-take', null);
const LINK_TAKE = opt('link-take', null);
// A missing sign-in stops the run now, not after the filming.
if (args.includes('--upload')) await requireShortsAuth('--upload');
if (!SLUG && !UPLOAD_TAKE && !LINK_TAKE) throw new Error('--recording=<slug> is required');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms / 1000} s`)), ms))]);

/**
 * How the roll films. Seconds are the round's unless named screen seconds.
 *
 * - `heavy`: shots worth riding (rockets, shells, bombs, thrown charges) by
 *   weapon name, with their weight against a kill's 1.
 * - `near` metres: a man this close to where the last action landed takes
 *   the camera with a glide; `far` is as far as a glide goes before it is a
 *   flight over the level instead.
 * - `look` seconds: how soon after the hand-over his action must come.
 * - `lead`: seconds on him before his shot or kill; `after`: seconds held
 *   after the round lands or he goes down.
 * - `glide`, `fly`: screen seconds of a hand-over and of a flight.
 * - `slow`: the clock at a hit, eased in and out over `slowEase` screen
 *   seconds and held `slowHold` round seconds.
 * - Camera offsets are metres: `foot` behind, up and right of a man on
 *   foot; a hull's scale with its radius (`hull`); a round is chased
 *   `round` behind and up.
 */
const ROLL = Object.freeze({
  heavy: [
    [/panzershreck|panzerfaust|bazooka|piat|rocket/i, 1.3],
    [/gunbarrel|cannon|_gun$|barrel$/i, 1.1],
    [/bombrack|bombdummy|bomb/i, 1.4],
  ],
  // Guns no man's action is: AA fire and plane guns are a volley, not a
  // round to ride.
  // FHSW (2026-11-11, Manchuria): MG and AA mounts named "_Gun"
  // (TB3_FrontMG_Gun, DShK38_V_Gun), wing cannons ("Cannons", "CannonsPrm")
  // and the M16's quad mounts; a bore under `minBore` mm is a gun, not a shell.
  notHeavy: /aa_|aaguns|flak|coax|browning|mg\d*|dshk|guns$|cannons|_air$|grenade|exppack|landmine|satchel|tnt|smoke|cartridge|dummy/i,
  minBore: 37,
  // Kills with no man's action to film: a mine, a charge left behind.
  planted: /landmine|exppack|mine|satchel|tnt|^null$/i,
  // A shot is worth riding when it is aimed at someone: a man or hull of
  // the other side within `aimed` m of its line, inside `reach` m.
  aimed: 6,
  reach: 260,
  // A shot at a plane from the ground is a round into empty sky (Manchuria,
  // 2026-11-12: "a weird chase but there's nothing out there"): not an act
  // unless it kills. `airborne` m over the ground is a plane.
  airborne: 20,
  // The longest a round is ridden before the camera lets it go.
  ride: 3,
  near: 120,
  far: 700,
  look: 5,
  // Seconds a man's act may keep the camera waiting, as a decay.
  soon: 1.8,
  // A shot or burst that hurts nobody, against one that does.
  missWeight: 0.3,
  // Paced so it does not make you dizzy (the owner, 2026-11-12: "it's
  // cutting too hard ... hold on the action longer, or make the glides
  // slower"): longer on each man before and after, slower hand-overs.
  lead: { shot: 2.4, kill: 3.0, bomb: 3.6, fire: 1.6 },
  after: { shot: 2.4, kill: 2.8, fire: 1.4, miss: 0.9 },
  // A fight worth staying in: `acts` more acts (a burst counts half)
  // within `near` m in the next `within` s holds the beat `stay` s longer.
  busy: { acts: 2, near: 80, within: 5, stay: 2.5 },
  // A burst: trigger presses (one recorded fire each) no more than `burstGap` s apart, at least `burstMin`,
  // aimed within `fireAimed` m of a man inside `fireReach` m.
  burstGap: 1.2,
  burstMin: 2,
  fireReach: 140,
  fireAimed: 3,
  fireWeight: 0.45,
  glide: 2.3,
  // A flight's rise over the straight line: under the fog.
  arcMax: 55,
  // Clearances, metres: over the ground mid-flight (thinning to 0 at the
  // ends), over the ground round a settled camera, and the rise per frame
  // (at most `wallLiftMax`) while a move would pass through a wall or
  // cliff. `lensNear` is how near terrain in the lower half of the view counts as clipping.
  flyClear: 6,
  groundClear: 1.1,
  wallLiftStep: 3,
  wallLiftMax: 70,
  lensNear: 2.5,
  // A wall or rail this near the lens, low in the view, is climbed over.
  railNear: 1.6,
  fly: 4.4,
  slow: 0.4,
  slowEase: 0.35,
  slowHold: 0.45,
  foot: [4.2, 1.7, 0.9],
  hull: [2.4, 0.9, 0.5],
  plane: [3.2, 0.9, 0],
  round: [7, 2.2, 2.6],
  follow: 3.2,
  // How fast the wanted place itself moves (per second): a step in it is
  // spread over about half a second.
  goalEase: 5,
  // This share of the picture near white for `whiteFor` s is smoke or a
  // blast filling the lens: the beat hands over.
  white: 0.33,
  whiteFor: 0.4,
  aim: 4,
});

/** The director, in the page: whom the camera is on, how it got there, and
 *  the camera's place each frame (a rig: replay-camera.js `setRig`). */
const ROLL_SRC = String.raw`window.__roll = (() => {
  const r = window.replay;
  const cam = r.ctx.camera;
  const V3 = cam.position.constructor;
  const Q = cam.quaternion.constructor;
  const M4 = cam.matrixWorld.constructor;
  const B = window.__rb;
  const VP = window.__vp;
  let cfg = null;
  let rand = null;
  const st = { lift: 0, beat: null, prev: null, beats: [], pos: null, look: null, from: null, fromLook: null, blend: 1, blendDur: 1, arc: 0,
    slowLeft: 0, slowUntil: -1, screen: 0, speed: 1, round: null, roundGoneAt: null, impact: null, used: new Map(),
    // A recap (features/match-recap): its moments' beats in order, the fade
    // through black between them, the frames hidden while a seek settles,
    // and the second camera of a split screen.
    queue: null, qi: 0, cut: null, hide: 0, fadeInAt: null, view: 'A', posB: null, lookB: null, splitBeat: null };

  const name = pid => {
    const p = r.rec.players.get(pid);
    return p ? (VP.decodePlayerName(p.name ?? '') || p.name) : '';
  };
  const isBot = (pid, t) => {
    const p = r.rec.players.get(pid);
    return !p || p.ai === true;
  };
  const heavyOf = f => {
    if (!f || f.soldier || f.feedOnly) return 0;
    const w = String(f.weapon ?? '');
    if (cfg.notHeavyRe.test(w)) return 0;
    const bore = /(\d+)\s*mm/i.exec(w);
    if (bore && Number(bore[1]) < cfg.minBore) return 0;
    for (const [re, k] of cfg.heavyRe) if (re.test(w)) return k;
    return 0;
  };
  const isBomb = f => /bomb/i.test(String(f?.weapon ?? ''));

  // Where pid is drawn at round time t: { pos (feet / hull centre), eye,
  // heading, hull, radius, plane, state }, or null.
  const where = (pid, t) => {
    const w = B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
    if (!w?.pos) return null;
    const pos = new V3(w.pos[0], w.pos[1], w.pos[2]);
    let hull = null;
    let radius = 0.6;
    let plane = false;
    if (w.state === 'vehicle' && w.life) {
      hull = r.hulls?.get(w.life) ?? null;
      if (hull?.root) {
        hull.root.getWorldPosition(pos);
        radius = Math.min(14, Math.max(2.5, window.__hullRadius?.(hull) ?? 4));
      } else radius = 4;
      plane = /plane|air/i.test(String(r.hullKind?.(w.life) ?? '')) || pos.y - (r.ctx.groundHeight?.(pos.x, pos.z) ?? pos.y) > 25;
    }
    const eye = pos.clone();
    eye.y += hull ? radius * 0.45 : 1.55;
    return { pid, pos, eye, hull, radius, plane, state: w.state, fresh: w.fresh };
  };

  // Who a heavy shot is aimed at: the nearest man of the other side within
  // cfg.aimed m of its line (more for a hull), or null.
  const teamOf = (pid, t) => B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills)?.team;
  const aimedAt = (f, pids, reach = cfg.reach, aimed = cfg.aimed, ground = true) => {
    const o = [f.pos[0], f.pos[1], -f.pos[2]];
    const d = [f.dir[0], f.dir[1], -f.dir[2]];
    const n = Math.hypot(...d) || 1;
    const myTeam = teamOf(f.pid, f.t);
    let best = null;
    for (const pid of pids) {
      if (pid === f.pid) continue;
      const w = B.whereIs(r.rec, pid, f.t + 0.3, r.kills ?? r.rec.kills);
      if (!w?.pos || w.team === myTeam || (w.state !== 'foot' && w.state !== 'vehicle')) continue;
      const v = [w.pos[0] - o[0], w.pos[1] + 1 - o[1], w.pos[2] - o[2]];
      const along = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / n;
      if (along < 4 || along > reach) continue;
      const off = Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along * along));
      const hull = w.state === 'vehicle';
      if (off > aimed * (hull ? 1.5 : 1)) continue;
      if (ground) {
        const g = r.ctx.groundHeight?.(w.pos[0], w.pos[2]);
        if (Number.isFinite(g) && w.pos[1] - g > cfg.airborne) continue;
      }
      if (!best || off < best.off) best = { pid, off, hull, along };
    }
    return best;
  };
  // Whether pid was hurt in (t, t + within]: his hull's or his own health
  // dropped (each life's recorded hp), or he died.
  const hurt = (pid, t, within) => {
    const w = B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
    const life = w?.life;
    if (!life?.hp?.length) return false;
    let at = null;
    for (const h of life.hp) {
      if (h.t <= t) { at = h.hp; continue; }
      if (h.t > t + within) break;
      if (at !== null && h.hp < at - 0.5) return true;
      at = h.hp;
    }
    return life.diedAt !== undefined && life.diedAt > t && life.diedAt <= t + within;
  };
  // Under a roof: a man whose sky is shut 20 m up.
  const roofed = p => blocked(p.clone().add(new V3(0, 0.3, 0)), p.clone().add(new V3(0, 20, 0)));

  // Every act of the round worth a camera: heavy shots and kills, men only.
  let acts = null;
  const buildActs = () => {
    acts = [];
    const pids = [...r.rec.players.keys()];
    // One shot, one act: FHSW logs a gun once per ammo it carries
    // (StuG3GGunBarrel, ...AP and ...HE at the same instant).
    const lastHeavy = new Map();
    for (const f of r.rec.fires) {
      const k = heavyOf(f);
      if (!k || isBot(f.pid, f.t)) continue;
      if (f.t - (lastHeavy.get(f.pid) ?? -1) < 0.08) continue;
      lastHeavy.set(f.pid, f.t);
      const bomb = isBomb(f);
      const target = bomb ? null : aimedAt(f, pids);
      if (!bomb && !target) continue;
      // A shot that hurts its man is the one to ride; a miss rarely is.
      const lands = target ? hurt(target.pid, f.t, 2.5) : null;
      acts.push({ kind: 'shot', t: f.t, pid: f.pid, f, w: k * (target?.hull ? 1.4 : 1) * (lands === false ? cfg.missWeight : 1), bomb, target: target?.pid ?? null, lands });
    }
    // Bursts of small-arms and MG fire at someone: the men in range of the
    // last action, firing, are what the camera passes along.
    const byPid = new Map();
    for (const f of r.rec.fires) {
      if (heavyOf(f) || f.feedOnly || !f.pos || !f.dir || isBot(f.pid, f.t)) continue;
      if (/grenade|exppack|landmine|knife|binocular|medpack|repair/i.test(String(f.weapon))) continue;
      const list = byPid.get(f.pid) ?? [];
      const last = list.at(-1);
      if (last && f.t - last.tEnd < cfg.burstGap) { last.tEnd = f.t; last.n++; }
      else list.push({ f, t: f.t, tEnd: f.t, n: 1 });
      byPid.set(f.pid, list);
    }
    for (const [pid, list] of byPid) {
      for (const b of list) {
        if (b.n < cfg.burstMin) continue;
        const target = aimedAt(b.f, pids, cfg.fireReach, cfg.fireAimed);
        if (!target) continue;
        const lands = hurt(target.pid, b.t, Math.min(b.tEnd, b.t + 4) - b.t + 0.5);
        acts.push({ kind: 'fire', t: b.t, tEnd: Math.min(b.tEnd, b.t + 4), pid, f: b.f, w: cfg.fireWeight * (lands ? 1.4 : cfg.missWeight), target: target.pid, lands });
      }
    }
    for (const k of r.rec.kills) {
      if (k.kind !== 'kill' || k.killer === null || k.killer === undefined || k.killer === k.victim) continue;
      if (cfg.plantedRe.test(String(k.weapon ?? 'null'))) continue;
      if (isBot(k.killer, k.t) || isBot(k.victim, k.t)) continue;
      // A heavy shot that kills is that shot's beat, not a second one.
      const shot = acts.find(a => a.kind === 'shot' && a.pid === k.killer && k.t - a.t > -0.3 && k.t - a.t < 4);
      if (shot) { (shot.kills ??= []).push(k); shot.w += 0.6; continue; }
      acts.push({ kind: 'kill', t: k.t, pid: k.killer, victim: k.victim, kill: k, w: 1, weapon: k.weapon });
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.kind === 'fire' && a.pid === k.killer && k.t - a.tEnd < 1.5 && k.t - a.t > -0.5) acts.splice(i, 1);
      }
    }
    // Only what the recorder saw whole (the owner, 2026-11-11: footage "right
    // on the edge of the range ... the green model indicating they're out of
    // range, as well as stuttery gameplay"). Everyone a beat films must be
    // replicated, with no hop between samples, for as long as it films him:
    // the shooter from the glide in to the end, his target or victim round
    // the hit. The Shorts picker's own test, continuityOf.
    // Sampled: whatever he is in at each moment (on foot, then a tank) must
    // be replicated then, and each life hop-free over its own part.
    const seen = (pid, t0, t1) => {
      if (pid === null || pid === undefined) return true;
      const spans = new Map();
      for (let t = t0; t <= t1 + 1e-6; t += 0.2) {
        const w = B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
        if (w.state === 'dead') break;
        if (!w.life || !w.fresh) return false;
        const sp = spans.get(w.life);
        if (sp) sp[1] = t; else spans.set(w.life, [t, t]);
      }
      if (!spans.size) return false;
      for (const [life, [a, b]] of spans) if (!window.__pick.continuityOf(life, a, b).ok) return false;
      return true;
    };
    const before = acts.length;
    acts = acts.filter(a => {
      const t0 = a.t - cfg.leadOf(a) - cfg.glide;
      const t1 = a.kind === 'fire' ? a.tEnd + cfg.after.fire : a.t + (a.kind === 'shot' ? cfg.ride * 0.5 + cfg.after.shot : cfg.after.kill);
      if (!seen(a.pid, t0, Math.min(t1, a.kind === 'kill' ? a.t : t1))) return false;
      const others = [a.victim, a.target, ...(a.kills ?? []).map(k => k.victim)];
      // A victim is seen up to his death; after it the replay draws his body.
      return others.every(v => v === undefined || v === null || seen(v, a.t - 0.8, a.kind === 'kill' ? a.t - 0.05 : a.t + 1.5));
    });
    cfg.dropped = before - acts.length;
    acts.sort((a, b) => a.t - b.t);
  };
  const actsIn = (t0, t1) => {
    let lo = 0, hi = acts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (acts[m].t < t0) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < acts.length && acts[i].t <= t1; i++) out.push(acts[i]);
    return out;
  };

  // The next beat after one that ended at round time T, at point P. A man
  // near P whose act comes soon takes it with a glide; else the best act
  // within the flight's reach, flown to.
  const choose = (T, P, prev) => {
    let best = null;
    for (const a of actsIn(T + 0.6, T + cfg.look)) {
      if (a.t - cfg.leadOf(a) < T - 0.6) continue;
      if (prev && a.pid === prev.pid && a.t - prev.act.t < 8) continue;
      if (a === prev?.act) continue;
      const w = where(a.pid, T);
      if (!w) continue;
      if (!w.plane && roofed(w.eye)) continue;
      const d = P ? w.pos.distanceTo(P) : 0;
      if (d > cfg.far) continue;
      const near = d <= cfg.near;
      if (a.kind === 'fire' && !near) continue;
      // Soon: a man who would keep the camera waiting is "not doing much".
      let s = a.w * Math.exp(-(a.t - T) / cfg.soon) * (near ? Math.exp(-d / 90) : 0.12 * Math.exp(-d / 300));
      // The man it hit, firing back; the man who fired at the one before.
      if (prev?.victims?.includes(a.pid)) s *= 2.2;
      if (a.victim !== undefined && a.victim === prev?.pid) s *= 1.6;
      if (a.kills?.length) s *= 1.3;
      // A man filmed a lot already gives way.
      s /= 1 + 0.35 * (st.used.get(a.pid) ?? 0);
      s *= 0.85 + 0.3 * rand();
      if (!best || s > best.s) best = { a, s, d, near };
    }
    if (best) return best;
    // Nothing in reach: the next heavy act anywhere, a flight away, the
    // clock jumped forward while the camera is high.
    // To the end of the round: Meuse (2026-11-12) had nothing the recorder
    // saw whole for over a minute, and the camera stood still for 26 s.
    for (const a of actsIn(T + 0.6, r.rec.duration ?? T + 3600)) {
      if (prev && a.pid === prev.pid) continue;
      if (a.kind === 'fire') continue;
      const s = a.w * Math.exp(-(a.t - T) / 12);
      if (!best || s > best.s) best = { a, s, d: Infinity, near: false, skip: a.t - cfg.leadOf(a) - cfg.fly * 0.5 > T + 2 };
    }
    return best;
  };

  // A scripted take: the act its script names for beat i, taken as it was
  // (glide, flight or jump). One that is not there any more is reported
  // and the director chooses again from there.
  const forcedPick = (i, T, P) => {
    const f = cfg.forced?.[i];
    if (!f) return null;
    const a = acts.find(x => x.kind === f.kind && x.pid === f.pid && Math.abs(x.t - f.tAct) < 0.05);
    if (!a) { (st.diverged ??= []).push(i); return null; }
    const w = where(a.pid, T);
    const d = P && w ? w.pos.distanceTo(P) : 0;
    return { a, near: f.how === 'glide', d, skip: f.how === 'jump' };
  };

  const beatOf = (pick, T) => {
    const a = pick.a;
    const lead = cfg.leadOf(a);
    const victims = a.kind === 'kill' ? [a.victim] : (a.kills ?? []).map(k => k.victim);
    if (a.target !== null && a.target !== undefined && !victims.includes(a.target)) victims.push(a.target);
    return { act: a, pid: a.pid, kind: a.kind, bomb: Boolean(a.bomb), t0: Math.max(T, a.t - lead), tAct: a.t, victims,
      near: pick.near, skip: Boolean(pick.skip), dist: Number.isFinite(pick.d) ? Math.round(pick.d) : null, end: null, phase: 'lead' };
  };

  // The point the man is aiming at: the man he kills, else along his shot,
  // else straight ahead.
  const aimPoint = (b, me, t) => {
    if (b.victims.length) {
      const v = where(b.victims[0], Math.min(t, b.tAct));
      if (v) return v.eye;
    }
    const f = b.act.f;
    if (f?.dir) {
      const reach = b.bomb ? 0 : 60;
      // Recorded shots are in the game's frame: z flips for the view.
      const P = new V3(f.pos[0], f.pos[1], -f.pos[2]);
      const d = new V3(f.dir[0], f.dir[1], -f.dir[2]).normalize();
      if (b.bomb) return me.pos.clone().add(new V3(0, -60, 0)).addScaledVector(d, 30);
      return P.addScaledVector(d, reach);
    }
    return me.eye.clone().add(new V3(0, 0, -20).applyQuaternion(cam.quaternion));
  };

  const ground = p => {
    const g = r.ctx.groundHeight?.(p.x, p.z);
    const wtr = r.ctx.waterLevel?.();
    return Math.max(Number.isFinite(g) ? g : -Infinity, Number.isFinite(wtr) ? wtr : -Infinity);
  };
  const keepAbove = (p, m = 0.8) => { const g = ground(p); if (Number.isFinite(g) && p.y < g + m) p.y = g + m; return p; };
  const collider = () => r.ctx.guns?.collider;
  const blocked = (a, b) => {
    const c = collider();
    if (!c?.cast) return false;
    const d = b.clone().sub(a);
    const dist = d.length();
    if (dist < 1) return false;
    d.divideScalar(dist);
    const moving = c.dynamicCast;
    c.dynamicCast = null;
    try { const h = c.cast(a.x, a.y, a.z, d.x, d.y, d.z, dist - 0.4, -1, 0, 0); return Boolean(h) && h.kind !== 'water'; } finally { c.dynamicCast = moving; }
  };
  // Nothing solid within railNear m of the lens in the lower half of the
  // view: a wall, a fence's base rail, sandbags (Meuse, 2026-11-12: a rail
  // swept across the frame for half a second).
  const lensClear = (pos, look) => {
    const fwd = look.clone().sub(pos).normalize();
    const right = new V3().crossVectors(fwd, new V3(0, 1, 0)).normalize();
    const up = new V3().crossVectors(right, fwd).normalize();
    const half = Math.tan((cfg.fov / 2) * Math.PI / 180);
    for (const [x, y] of [[0, -1], [-1.6, -1], [1.6, -1], [-1.6, -0.4], [1.6, -0.4], [0, -0.5], [0, 0]]) {
      const dir = fwd.clone().addScaledVector(right, x * half).addScaledVector(up, y * half).normalize();
      if (blocked(pos, pos.clone().addScaledVector(dir, cfg.railNear))) return false;
    }
    return true;
  };
  // A settled camera with something at its lens: closer in, or a little
  // higher, whichever is clear first; never a climb (a lift that rose while
  // anything was near ran up onto a roof and lost the man).
  const clearLens = (subject, pos, look) => {
    if (lensClear(pos, look)) return pos;
    for (const k of [0.8, 0.62, 0.45]) {
      const p = subject.clone().lerp(pos, k);
      if (!blocked(subject, p) && lensClear(p, look)) return p;
    }
    for (const h of [1, 2]) {
      const p = pos.clone().add(new V3(0, h, 0));
      if (!blocked(subject, p) && lensClear(p, look)) return p;
    }
    return pos;
  };
  // Pull the camera toward the subject until it sees him (a spring arm).
  const unblock = (subject, want) => {
    if (!blocked(subject, want)) return want;
    for (const k of [0.7, 0.5, 0.32, 0.18]) {
      const p = subject.clone().lerp(want, k);
      if (!blocked(subject, p)) return p;
    }
    return subject.clone().lerp(want, 0.12);
  };

  // The live round of beat b: the newest of the page's rockets, shells and
  // bombs leaving within 5 m of his shot (round-launch.js, guns.projectiles).
  const findRound = (b) => {
    const f = b.act.f;
    const g = r.ctx.guns;
    if (!f || !g) return null;
    const at = new V3(f.pos[0], f.pos[1], -f.pos[2]);
    let best = null;
    for (const list of [g.projectiles, g.tracers]) {
      for (const s of list ?? []) {
        if (st.taken?.has(s)) continue;
        const m = s.mesh?.position;
        if (!m) continue;
        const o = s.origin ? new V3(s.origin[0], s.origin[1], s.origin[2]) : m;
        const d = o.distanceTo(at);
        if (d > (b.bomb ? 20 : 8)) continue;
        if (!best || d < best.d) best = { s, d, list };
      }
    }
    return best ? best.s : null;
  };
  const roundLive = s => {
    const g = r.ctx.guns;
    return Boolean(s && (g.projectiles?.includes(s) || g.tracers?.includes(s)));
  };

  // The camera this beat wants now: { pos, look, subject } (subject: the
  // point it must see).
  const want = (b, t) => {
    const me = where(b.pid, t);
    if (!me) return null;
    const rd = st.round;
    // Riding his round.
    if (b.phase === 'round' && rd && roundLive(rd)) {
      const P = rd.mesh.position.clone();
      const v = (rd.velocity ?? rd.vel)?.clone?.() ?? new V3(0, 0, -1);
      if (v.lengthSq() < 1e-4) v.set(0, 0, -1);
      const vn = v.clone().normalize();
      if (b.bomb) {
        // A bomb is seen falling (replay-roundcam.js DROP): off to its side,
        // looking at it and the ground under it.
        const side = new V3(-vn.z, 0, vn.x).normalize();
        const pos = P.clone().addScaledVector(side, 22).add(new V3(0, 10, 0)).addScaledVector(new V3(vn.x, 0, vn.z).normalize(), -14);
        const look = P.clone().lerp(new V3(P.x, ground(P), P.z), 0.35);
        st.impact = P.clone();
        return { pos, look, subject: P };
      }
      const [bk, up, sd] = cfg.round;
      const side = new V3(-vn.z, 0, vn.x).normalize();
      const pos = P.clone().addScaledVector(vn, -bk).add(new V3(0, up, 0)).addScaledVector(side, sd);
      const look = P.clone().addScaledVector(vn, 18);
      st.impact = P.clone();
      return { pos, look, subject: P };
    }
    // A bullet's hold over: stay where the round cam left the camera.
    if ((b.phase === 'bullet' || b.phase === 'held') && st.pos) {
      const v = b.victims.length ? where(b.victims[0], Math.min(t, b.tAct + 0.05)) : null;
      return { pos: st.pos.clone(), look: v ? v.eye.clone() : st.look.clone(), subject: v ? v.eye.clone() : st.look.clone() };
    }
    // After it lands: where it landed, the camera drawn back from it.
    if (b.phase === 'impact' && st.impact) {
      const P = st.impact.clone();
      const from = st.pos?.clone() ?? me.eye.clone();
      const away = from.clone().sub(P);
      away.y = 0;
      if (away.lengthSq() < 1) away.set(1, 0, 0);
      away.normalize();
      const k = Math.min(1, (t - b.landedAt) / 1.2);
      // A bomb's or a shell's blast fills the lens up close: stand off it.
      const big = b.bomb ? 2.4 : /barrel|cannon/i.test(String(b.act.f?.weapon ?? '')) ? 1.5 : 1;
      const pos = P.clone().addScaledVector(away, (11 + 8 * k) * big).add(new V3(0, (4 + 3 * k) * big, 0));
      return { pos, look: P.clone().add(new V3(0, 0.8, 0)), subject: P };
    }
    // After a kill: round the man going down (a split screen stays on the
    // two men: its other half is the victim's own view).
    if (b.phase === 'down' && b.victims.length && !b.split) {
      const v = where(b.victims[0], Math.min(t, b.tAct + 0.05)) ?? where(b.victims[0], b.tAct);
      if (v) {
        const R = v.hull ? v.radius * 2.6 + 4 : 5.5;
        b.orbit ??= Math.atan2(st.pos.x - v.eye.x, st.pos.z - v.eye.z);
        b.orbit += (cfg.dt) * 0.35;
        const pos = v.eye.clone().add(new V3(Math.sin(b.orbit) * R, v.hull ? v.radius * 0.8 + 1.5 : 1.4, Math.cos(b.orbit) * R));
        st.impact = v.eye.clone();
        return { pos, look: v.eye.clone().lerp(me.eye, 0.15), subject: v.eye };
      }
    }
    // On him: behind his shoulder toward where he is aiming.
    return shoulderOf(me, aimPoint(b, me, t));
  };
  // Behind man me's shoulder, looking toward point A: { pos, look, subject }.
  const shoulderOf = (me, A) => {
    const dir = A.clone().sub(me.eye);
    if (me.plane && me.hull) {
      // Behind a plane along its flight.
      const fw = new V3(0, 0, -1).applyQuaternion(me.hull.root.getWorldQuaternion(new Q()));
      dir.copy(fw);
    }
    dir.y = me.plane ? dir.y : Math.max(-0.35, Math.min(0.25, dir.y / Math.max(1, dir.length())));
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const flat = new V3(dir.x, 0, dir.z).normalize();
    const right = new V3(-flat.z, 0, flat.x);
    let back, up, sd;
    if (me.plane) [back, up, sd] = cfg.plane.map((k, i) => i < 2 ? k * me.radius + (i ? 2 : 6) : 0);
    else if (me.hull) [back, up, sd] = cfg.hull.map((k, i) => k * me.radius + [3, 1.5, 0.5][i]);
    else [back, up, sd] = cfg.foot;
    const pos = me.eye.clone().addScaledVector(me.plane ? dir : flat, -back).add(new V3(0, up, 0)).addScaledVector(right, sd);
    // Look between him and his aim: he stays in the picture, his target too.
    const look = me.eye.clone().lerp(A, me.plane ? 0.6 : 0.4);
    return { pos, look, subject: me.eye };
  };

  // A recap's beats: each moment's kills as the acts that film them (a kill,
  // or the heavy shot that made it), in the moments' order. A kill whose act
  // the recording does not hold whole is left out; a moment with none goes.
  const buildQueue = () => {
    st.queue = [];
    st.recapDropped = [];
    for (const m of cfg.recap.moments) {
      const picks = [];
      for (const k of m.kills) {
        const a = acts.find(x => x.kind === 'kill' && x.pid === k.killer && x.victim === k.victim && Math.abs(x.t - k.t) < 0.06)
          ?? acts.find(x => x.kind === 'shot' && x.pid === k.killer && (x.kills ?? []).some(y => y.victim === k.victim && Math.abs(y.t - k.t) < 0.06));
        if (!a || picks.some(q => q.a === a)) continue;
        const w = where(a.pid, a.t - 1);
        if (w && !w.plane && roofed(w.eye)) continue;
        picks.push({ a, moment: m, k });
      }
      if (!picks.length) { st.recapDropped.push(m.label + ': ' + m.name); continue; }
      picks.forEach((q, i) => { q.first = i === 0; q.part = i; q.parts = picks.length; });
      st.queue.push(...picks);
    }
  };
  const tagBeat = (b, q) => {
    b.moment = q.moment; b.part = q.part; b.parts = q.parts; b.k = q.k; b.first = q.first;
    b.split = Boolean(q.moment.split) && b.victims.length > 0;
    // A long shot rides its bullet (the owner, 2026-11-15: "the long shots
    // need to chase the bullet because for sniper it's hard to sometimes see
    // the victim"): the creator's round cam, as a Short's kill shot is filmed,
    // armed just before the round leaves.
    if (cfg.recap.bullet && b.kind === 'kill' && !b.split && q.k) {
      const dist = Number(q.k.distance ?? q.moment.distance ?? 0);
      const long = q.moment.kind === 'long-shot' || dist >= cfg.recap.bullet.from;
      const row = long ? r.creator?.killAt?.(q.k.t, q.k.victim) : null;
      if (row?.round?.f) b.bullet = { f: row.round.f, kill: row.kill, dist: dist || Number(row.round.distance ?? 0) };
    }
    const log = st.beats[st.beats.length - 1];
    if (log) { log.moment = q.moment.label; log.momentKind = q.moment.kind; log.part = q.part; log.split = b.split; }
  };
  // The split screen's other half: over the victim's shoulder at his
  // killer, and after he falls, held where it was, still on the killer.
  const wantB = (b, t) => {
    const killer = where(b.pid, t);
    const v = t < b.tAct - 0.05 ? where(b.victims[0], t) : null;
    if (v && killer) {
      const w = shoulderOf(v, killer.eye.clone());
      w.pos = unblock(w.subject, keepAbove(w.pos.clone(), 0.8));
      if (cfg.clear) w.pos = clearLens(w.subject, w.pos, w.look);
      return w;
    }
    if (killer && st.posB) return { pos: st.posB.clone(), look: killer.eye.clone(), subject: killer.eye };
    return null;
  };
  const stepB = (b, t) => {
    const w = wantB(b, t);
    if (!w) return;
    if (st.splitBeat !== b || !st.posB) { st.posB = w.pos.clone(); st.lookB = w.look.clone(); st.splitBeat = b; return; }
    const sdt = 1 / cfg.fps;
    st.posB.lerp(w.pos, 1 - Math.exp(-sdt * cfg.follow));
    st.lookB.lerp(w.look, 1 - Math.exp(-sdt * cfg.aim));
    keepAbove(st.posB, 0.6);
  };

  const startBeat = (pick, T, reason) => {
    const b = beatOf(pick, T);
    b.reason = reason;
    b.screenAt = st.screen;
    st.prev = st.beat;
    st.beat = b;
    st.round = null;
    st.roundGoneAt = null;
    st.used.set(b.pid, (st.used.get(b.pid) ?? 0) + 1);
    st.from = st.pos?.clone() ?? null;
    st.fromLook = st.look?.clone() ?? null;
    st.blend = 0;
    const fly = !pick.near;
    st.blendDur = fly ? cfg.fly : cfg.glide;
    st.arc = fly ? Math.min(cfg.arcMax, 12 + (Number.isFinite(pick.d) ? pick.d * 0.1 : cfg.arcMax)) : 0;
    b.fly = fly;
    st.beats.push({ i: st.beats.length, screen: Math.round(st.screen * 100) / 100, t: Math.round(T * 100) / 100, tAct: Math.round(b.tAct * 100) / 100,
      pid: b.pid, name: name(b.pid), kind: b.kind, weapon: b.act.f?.weapon ?? b.act.weapon ?? null, victims: b.victims.map(name),
      dist: b.dist, how: pick.skip ? 'jump' : fly ? 'fly' : 'glide', reason });
    return b;
  };

  // The ground under p and round it (a slope rises within a step of the
  // lens): the highest of five points r m apart.
  const floorAt = (p, r) => {
    let g = ground(p);
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = ground(new V3(p.x + dx, p.y, p.z + dz));
      if (Number.isFinite(h)) g = Math.max(g, h);
    }
    return g;
  };
  // The path of a hand-over at eased share e: the straight line, risen by
  // the arc.
  const pathAt = (e, to) => {
    const p = st.from.clone().lerp(to, e);
    p.y += st.arc * Math.sin(Math.PI * e);
    return p;
  };
  // Clipping, counted per frame for the log: the lens under the ground,
  // terrain or a wall filling the lens (within lensNear m straight ahead),
  // or walls on every side.
  const qa = { frames: 0, under: 0, lens: 0, boxed: 0, at: [] };
  const measure = (pos, look) => {
    if (st.noMeasure) return;
    qa.frames++;
    const fwd = look.clone().sub(pos).normalize();
    const g = ground(pos);
    let bad = null;
    if (Number.isFinite(g) && pos.y < g + 0.15) { qa.under++; bad = 'under'; }
    else {
      // Terrain within lensNear m of the lens anywhere in the lower half of
      // the view (straight ahead, and the frame's bottom edge and corners).
      let hit = false;
      const right = new V3().crossVectors(fwd, new V3(0, 1, 0)).normalize();
      const up = new V3().crossVectors(right, fwd).normalize();
      const half = Math.tan((cfg.fov / 2) * Math.PI / 180);
      const rays = [[0, 0], [0, -1], [-1.6, -1], [1.6, -1], [0, -0.5]];
      for (const [x, y] of rays) {
        const dir = fwd.clone().addScaledVector(right, x * half).addScaledVector(up, y * half).normalize();
        for (const d of [0.3, 0.7, 1.2, 1.8, 2.5, 3.2, 4]) {
          if (d > cfg.lensNear) break;
          const q = pos.clone().addScaledVector(dir, d);
          const gq = ground(q);
          if (Number.isFinite(gq) && q.y < gq + 0.05) { hit = true; break; }
        }
        if (hit) break;
        const dir2 = fwd.clone().addScaledVector(right, x * half).addScaledVector(up, y * half).normalize();
        if (blocked(pos, pos.clone().addScaledVector(dir2, 0.7))) { hit = true; break; }
      }
      if (!hit) hit = blocked(pos, pos.clone().addScaledVector(fwd, 0.8));
      if (hit) { qa.lens++; bad = 'lens'; }
      else {
        let walls = 0;
        for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) if (blocked(pos, pos.clone().add(new V3(...d).multiplyScalar(3.4)))) walls++;
        if (walls >= 5) { qa.boxed++; bad = 'boxed'; }
      }
    }
    if (bad && qa.at.length < 400) qa.at.push([Math.round(st.screen * 10) / 10, bad]);
  };

  const placeRig = {
    place(c, dt, t) {
      if (st.view === 'B' && st.posB) {
        c.position.copy(st.posB);
        c.quaternion.setFromRotationMatrix(new M4().lookAt(st.posB, st.lookB, new V3(0, 1, 0)));
        if (c.fov !== cfg.fov) { c.fov = cfg.fov; c.updateProjectionMatrix(); }
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
        return true;
      }
      // A long shot's bullet: the round cam has the camera from just before
      // the round leaves until its hold ends; the settled camera then carries
      // on from where it left it.
      const ro = r.creator?.rounds;
      if (st.beat?.bullet?.armed && ro && ro.state !== 'idle' && ro.place(c, dt, t)) {
        st.pos = c.position.clone();
        st.look = new V3(0, 0, -20).applyQuaternion(c.quaternion).add(c.position);
        st.goal = st.pos.clone(); st.goalLook = st.look.clone(); st.goalBeat = st.beat;
        st.lift = 0;
        st.want = { pos: st.pos.clone(), look: st.look.clone(), subject: st.look.clone() };
        return true;
      }
      // After the bullet's hold, until the cut: held exactly where the round
      // cam left it. Eased toward the man as a settled camera is, it pushed
      // through the landing craft he fell beside (Omaha, 2026-11-15).
      if (st.beat?.phase === 'held' && st.pos && st.look) {
        c.position.copy(st.pos);
        c.quaternion.setFromRotationMatrix(new M4().lookAt(st.pos, st.look, new V3(0, 1, 0)));
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
        measure(st.pos, st.look);
        return true;
      }
      if (!st.want) return false;
      // The aim point eases rather than jumps (Arnhem, 2026-11-12: "a cut
      // that gets interrupted ... cuts to almost the same position"): the
      // spring arm and the lens check move the wanted place in steps when a
      // wall comes and goes, and a step mid-glide read as a cut.
      if (!st.goal || st.goalBeat !== st.beat) {
        st.goal = st.want.pos.clone();
        st.goalLook = st.want.look.clone();
        st.goalBeat = st.beat;
      } else {
        const kg = 1 - Math.exp(-(1 / cfg.fps) * cfg.goalEase);
        st.goal.lerp(st.want.pos, kg);
        st.goalLook.lerp(st.want.look, kg);
      }
      const pos = st.goal;
      const look = st.goalLook;
      if (!st.pos) { st.pos = pos.clone(); st.look = look.clone(); }
      const sdt = 1 / cfg.fps;
      const prev = st.pos.clone();
      let need = 0;
      if (st.blend < 1 && st.from) {
        st.blend = Math.min(1, st.blend + sdt / st.blendDur);
        const u = st.blend;
        const ease = x => x * x * x * (x * (x * 6 - 15) + 10);
        const e = ease(u);
        const p = pathAt(e, pos);
        // The look leads the move: it turns to the new man early.
        const le = Math.min(1, e * 1.35);
        st.pos.copy(p);
        st.look.copy(st.fromLook.clone().lerp(look, le * le * (3 - 2 * le)));
        if (cfg.clear) {
          // Over the ground ahead as well as here, so the camera rises
          // before a ridge, not into it. Clearance thins to nothing at the
          // hand-over's two ends, where the cameras either side are set.
          const edge = Math.min(1, Math.sin(Math.PI * e) * 3);
          for (const k of [0, 0.06, 0.12, 0.2]) {
            const q = pathAt(ease(Math.min(1, u + k)), pos);
            need = Math.max(need, floorAt(q, 2) + cfg.flyClear * edge + 0.8 - q.y);
          }
        }
      } else {
        const kp = 1 - Math.exp(-sdt * cfg.follow);
        const kl = 1 - Math.exp(-sdt * cfg.aim);
        st.pos.lerp(pos, kp);
        st.look.lerp(look, kl);
      }
      if (cfg.clear) {
        // A slope or a step at the lens: clear of the ground round it.
        need = Math.max(need, floorAt(st.pos, 1.2) + cfg.groundClear - st.pos.y);
        // Terrain rising in front of the lens: up until the view is over it.
        const fwd = st.look.clone().sub(st.pos).normalize();
        for (const d of [0.6, 1.2, 2, 3]) {
          const q = st.pos.clone().addScaledVector(fwd, d);
          need = Math.max(need, ground(q) + 0.5 - q.y);
        }
        // Through a wall or a cliff on the way: rise while the move from the
        // last frame passes through something.
        if (st.blend < 1 && blocked(prev, st.pos.clone().add(new V3(0, st.lift, 0)))) st.wallLift = Math.min(cfg.wallLiftMax, (st.wallLift ?? 0) + cfg.wallLiftStep);
        else st.wallLift = Math.max(0, (st.wallLift ?? 0) - cfg.wallLiftStep * 0.25);
        need = Math.max(need, st.wallLift);
        // Eased: up fast, down slow, never a pop.
        const k = need > st.lift ? 0.55 : 0.08;
        st.lift += (Math.max(0, need) - st.lift) * k;
        if (st.lift < 0.01) st.lift = 0;
        st.pos.y += st.lift;
        // The lift is the frame's: next frame starts from the path again.
        st.liftApplied = st.lift;
      }
      keepAbove(st.pos, 0.6);
      measure(st.pos, st.look);
      c.position.copy(st.pos);
      if (cfg.clear) st.pos.y -= st.liftApplied ?? 0;
      const m = new M4().lookAt(c.position, st.look, new V3(0, 1, 0));
      c.quaternion.setFromRotationMatrix(m);
      if (c.fov !== cfg.fov) { c.fov = cfg.fov; c.updateProjectionMatrix(); }
      c.updateMatrixWorld();
      c.matrixWorldInverse.copy(c.matrixWorld).invert();
      return true;
    },
  };

  return {
    install(c) {
      cfg = c;
      cfg.heavyRe = c.heavy.map(([s, k]) => [new RegExp(s, 'i'), k]);
      cfg.notHeavyRe = new RegExp(c.notHeavy, 'i');
      cfg.plantedRe = new RegExp(c.planted, 'i');
      cfg.leadOf = a => a.bomb ? c.lead.bomb : a.kind === 'kill' ? c.lead.kill : a.kind === 'fire' ? c.lead.fire : c.lead.shot;
      cfg.dt = 1 / c.fps;
      cfg.bar = c.barLen > 0;
      cfg.nextBar = sec => Math.ceil(sec / c.barLen) * c.barLen;
      let s = c.seed >>> 0 || 1;
      rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      buildActs();
      if (c.recap) buildQueue();
      r.camera.setRig(placeRig);
      return { queue: st.queue?.length ?? null, recapDropped: st.recapDropped ?? [],
        recapStart: st.queue?.length ? Math.max(0, st.queue[0].a.t - c.leadOf(st.queue[0].a) - 0.8) : null, acts: acts.length, shots: acts.filter(a => a.kind === 'shot').length, kills: acts.filter(a => a.kind === 'kill').length, fire: acts.filter(a => a.kind === 'fire').length, dropped: cfg.dropped };
    },
    // The busiest stretch of the round to open on: the most act weight in
    // 40 s, from someone's heavy shot.
    opening() {
      let best = null;
      for (const a of acts) {
        if (a.kind !== 'shot') continue;
        let w = 0;
        for (const x of actsIn(a.t, a.t + 40)) w += x.w;
        if (!best || w > best.w) best = { t: a.t, w };
      }
      return best;
    },
    // Before the frame: pick and advance beats, set the clock. Returns
    // what the runner needs ({ seek, speed, caption }).
    tick(screen, frame = {}) {
      st.screen = screen;
      st.whiteRun = frame.lum > cfg.white ? (st.whiteRun ?? 0) + 1 : 0;
      const t = r.time;
      let b = st.beat;
      let seek = null;
      if (!b && cfg.recap) {
        const q = st.queue[0];
        b = startBeat({ a: q.a, near: true, d: 0 }, t, 'opening');
        tagBeat(b, q);
        st.qi = 1;
        st.blend = 1;
      }
      if (!b) {
        const ok = a => { const w = where(a.pid, t); return w && (w.plane || !roofed(w.eye)); };
        const first = acts.find(a => a.t >= t + cfg.leadOf(a) && a.kind === 'shot' && ok(a)) ?? acts.find(a => a.t >= t && a.kind !== 'fire' && ok(a));
        b = startBeat(forcedPick(0, t, null) ?? { a: first, near: true, d: 0 }, t, 'opening');
        st.blend = 1;
      }
      // A long shot's bullet: arm the round cam 2.5 s (its own set-up lead)
      // before the round leaves, our rig kept on top; while it rides, it owns
      // the clock and the beat waits for its hold to end.
      const ro = r.creator?.rounds;
      if (b.bullet && ro && !b.bullet.armed && !b.bullet.failed && t >= b.bullet.f.t - 2.6) {
        ro.bulletTime = { pace: cfg.recap.bullet.pace, flight: Math.min(cfg.recap.bullet.flightMax, Math.max(cfg.recap.bullet.flightMin, cfg.recap.bullet.flightBase + (b.bullet.dist || 0) / cfg.recap.bullet.flightPerM)) };
        ro.hold = cfg.recap.bullet.hold;
        ro.afterHit = 'stay';
        const ok = ro.arm(b.bullet.f, { kill: b.bullet.kill });
        r.camera.setRig(placeRig);
        if (ok) { b.bullet.armed = true; b.bullet.at = t; } else b.bullet.failed = true;
      }
      if (b.bullet?.armed && ro) {
        if (ro.state === 'flying' || ro.state === 'impact') b.bullet.rode = true;
        const done = ro.state === 'idle' && b.bullet.rode;
        // A round that never leaves: the beat goes on as a kill's.
        const stuck = ro.state === 'armed' && t > b.tAct + 1.5;
        if (stuck) { ro.stop(false); r.camera.setRig(placeRig); b.bullet.armed = false; b.bullet.failed = true; }
        else if (!done) {
          b.phase = 'bullet';
          st.speed = r.speed;
          st.want = want(b, t) ?? st.want;
          const log = st.beats[st.beats.length - 1];
          if (log) log.bullet = true;
        } else if (b.phase === 'bullet') {
          b.phase = 'held';
          b.end = t + cfg.recap.bullet.after;
          b.slowed = true;
          b.lingered = true;
          st.speed = r.speed;
        }
      }
      // Beat phases: lead -> (round -> impact) | down -> done.
      if (b.phase === 'lead' && t >= b.tAct) {
        if (b.kind === 'shot') { b.phase = 'round'; b.firedAt = t; }
        else if (b.kind === 'fire') {
          b.phase = 'firing';
          b.end = b.act.lands ? b.act.tEnd + cfg.after.fire : Math.min(b.act.tEnd, t + 1.2) + cfg.after.miss;
          b.landed = Boolean(b.act.lands);
        }
        else { b.phase = 'down'; b.landedAt = t; b.end = t + cfg.after.kill; }
      }
      if (b.phase === 'round') {
        if (!st.round) {
          const s = findRound(b);
          if (s) { st.round = s; (st.taken ??= new WeakSet()).add(s); }
          else if (t - b.firedAt > 0.5) { b.phase = 'impact'; b.landedAt = t; b.end = t + cfg.after.shot; st.impact = st.impact ?? where(b.pid, t)?.eye.clone().add(new V3(0, 0, 0)); b.lostRound = true; }
        } else if (!roundLive(st.round)) {
          b.phase = 'impact';
          b.landedAt = t;
          b.end = t + cfg.after.shot;
        } else if (t - b.firedAt > cfg.ride) {
          b.phase = 'impact'; b.landedAt = t; b.end = t + 0.6;
        }
      }
      // How it landed (the owner, 2026-11-11: "if we glide to a fight, show
      // it for a bit ... if we're just gliding to someone not doing much or
      // missing their shot just stay shortly"). A shot that kills or lands
      // on its man is held; a miss is let go at once, with no slow motion.
      if (b.phase === 'impact' && b.landed === undefined) {
        const v = b.act.target !== null && b.act.target !== undefined ? where(b.act.target, t) : null;
        const reach = v ? (v.hull ? v.radius + 4 : 3.5) : 0;
        b.landed = Boolean(b.act.kills?.length) || b.bomb || b.act.lands === true || Boolean(v && st.impact && st.impact.distanceTo(v.hull ? v.pos : v.eye) < reach);
        if (!b.landed) { b.end = t + cfg.after.miss; b.slowed = true; }
      }
      // A fight: more going on round here in the next few seconds is
      // worth staying for, once.
      if (b.end !== null && !b.lingered && (b.landed || b.kind === 'kill')) {
        b.lingered = true;
        const P = st.impact ?? where(b.pid, t)?.eye;
        let busy = 0;
        if (P) for (const a of actsIn(t, t + cfg.busy.within)) {
          if (a === b.act) continue;
          const w = where(a.pid, t);
          if (w && w.pos.distanceTo(P) < cfg.busy.near) busy += a.kind === 'fire' ? 0.5 : 1;
        }
        b.busy = busy;
        if (busy >= cfg.busy.acts) b.end += cfg.busy.stay;
      }
      // Slow at the hit.
      if ((b.phase === 'impact' || b.phase === 'down') && !b.slowed) {
        b.slowed = true;
        st.slowUntil = t + cfg.slowHold;
      }
      const ease = 1 / (cfg.slowEase * cfg.fps);
      const target = t < st.slowUntil ? cfg.slow : 1;
      if (b.phase === 'bullet') st.speed = r.speed;
      else st.speed += Math.sign(target - st.speed) * Math.min(Math.abs(target - st.speed), (1 - cfg.slow) * ease);
      // Smoke or a blast filling the picture: move on rather than show white
      // (Arnhem, 2026-11-12: six seconds of a smoke screen).
      if (st.whiteRun > cfg.whiteFor * cfg.fps && b.phase !== 'round' && (b.end === null || b.end > t + 0.3) && st.blend >= 1) {
        b.end = t;
        b.whiteOut = true;
        st.whiteRun = 0;
      }
      // A recap: the next beat of this moment (glided to when it is the same
      // man and soon), else a fade through black to the next.
      if (cfg.recap && b.end !== null && t >= b.end && !st.cut && !st.done) {
        const log = st.beats[st.beats.length - 1];
        if (log) { log.landed = b.landed ?? null; log.busy = b.busy ?? 0; log.held = Math.round((st.screen - b.screenAt) * 10) / 10; }
        let next = null;
        while (st.qi < st.queue.length) {
          const q = st.queue[st.qi];
          // Shown already: a kill that came while the last beat held.
          if (q.a === b.act || (q.moment === b.moment && q.a.t < t + 0.8)) { st.qi++; continue; }
          next = q;
          break;
        }
        if (!next) { st.done = true; st.cut = { at: st.screen, dur: cfg.recap.fadeOut, final: true }; }
        else if (next.moment === b.moment && next.a.pid === b.pid && next.a.t - cfg.leadOf(next.a) - t < 2.2 && !b.split) {
          st.qi++;
          b = startBeat({ a: next.a, near: true, d: 0 }, t, 'next in the moment');
          tagBeat(b, next);
        } else st.cut = { at: st.screen, dur: next.moment === b.moment ? cfg.recap.dip : cfg.recap.fadeOut, next };
      }
      if (cfg.recap && st.cut && !st.cut.final && st.screen - st.cut.at >= st.cut.dur) {
        const q = st.cut.next;
        st.qi++;
        // Seek to just before his lead, hidden frames settling the hulls and
        // bodies there, then fade in on him.
        const settle = cfg.recap.settle / cfg.fps;
        const to = Math.max(0, q.a.t - cfg.leadOf(q.a) - settle);
        seek = to;
        b = startBeat({ a: q.a, near: true, d: 0 }, to + settle, q.first ? 'next moment' : 'cut in the moment');
        tagBeat(b, q);
        if (r.creator?.rounds && r.creator.rounds.state !== 'idle') { r.creator.rounds.stop(false); r.camera.setRig(placeRig); }
        st.pos = null; st.look = null; st.goal = null; st.from = null; st.blend = 1; st.lift = 0; st.wallLift = 0;
        st.slowUntil = -1; st.speed = 1; st.round = null; st.impact = null; st.posB = null;
        st.hide = cfg.recap.settle;
        st.cut = null;
      }
      // Done: hand over.
      if (!cfg.recap && b.end !== null && t >= b.end && (!cfg.bar || st.screen >= cfg.nextBar(b.screenAt + 0.5))) {
        if (b.kind === 'fire') st.impact = where(b.act.target, t)?.eye ?? where(b.pid, t)?.eye ?? st.impact;
        const P = st.impact?.clone() ?? where(b.pid, t)?.eye ?? st.pos.clone();
        const log = st.beats[st.beats.length - 1];
        if (log) { log.landed = b.landed ?? null; log.busy = b.busy ?? 0; log.held = Math.round((st.screen - b.screenAt) * 10) / 10; }
        let pick = null;
        try { pick = forcedPick(st.beats.length, t, P) ?? (cfg.forced && st.beats.length >= cfg.forced.length ? null : choose(t, P, b)); } catch (e) { st.err = 'choose: ' + e.message + ' ' + (e.stack ?? '').split('\n').slice(1, 3).join(' | '); }
        if (pick) {
          const nb = startBeat(pick, t, b.victims.length ? 'after the kill' : 'after the hit');
          if (pick.skip) {
            // Jump the clock while the camera is high: the flight's top.
            nb.jumpAt = st.screen + cfg.fly * 0.45;
            nb.jumpTo = nb.t0 - cfg.fly * 0.55;
          }
          b = nb;
        } else st.done = true;
      }
      if (b.jumpAt !== undefined && st.screen >= b.jumpAt && !b.jumped) {
        b.jumped = true;
        seek = b.jumpTo;
      }
      st.want = want(b, seek ?? t) ?? st.want;
      if (st.want && !b.fly || st.blend >= 1) {
        // Seen through walls nowhere: the spring arm on the man it films.
        if (st.want?.subject) {
          st.want.pos = unblock(st.want.subject, keepAbove(st.want.pos.clone(), 0.8));
          if (cfg.clear) st.want.pos = clearLens(st.want.subject, st.want.pos, st.want.look);
        }
      }
      const since = st.screen - b.screenAt;
      const caption = { name: name(b.pid), weapon: b.act.f?.weapon ?? b.act.weapon ?? '', alpha: Math.max(0, Math.min(1, (since - 0.3) / 0.4, (3.2 - since) / 0.5)) };
      let black = 0, hidden = false, split = null;
      if (cfg.recap) {
        if (b.split) {
          stepB(b, seek ?? t);
          split = { names: [name(b.pid), name(b.victims[0])], teams: [teamOf(b.pid, b.tAct - 0.3) ?? 0, teamOf(b.victims[0], b.tAct - 0.3) ?? 0] };
        }
        const m = b.moment;
        const k = b.k;
        let sub = '';
        if (m.kind === 'streak' && k?.index) sub = 'Kill ' + k.index + ' of ' + k.of;
        else if (m.kind === 'multi' && b.parts > 1) sub = 'Kill ' + (b.part + 1) + ' of ' + m.count;
        else if (m.kind === 'revenge' && m.avenges) sub = 'Back for the one who killed them ' + Math.round(k.t - m.avenges) + ' s before';
        else if (m.kind === 'duel') sub = 'They fired back ' + m.exchanged + ' times';
        else if (k?.victimName) sub = 'On ' + window.__vp.decodePlayerName(k.victimName);
        const until = b.first ? 4.4 : 2.8;
        caption.label = b.first || m.kind === 'streak' || m.kind === 'multi' ? m.label : '';
        caption.sub = sub;
        caption.split = Boolean(split);
        caption.alpha = Math.max(0, Math.min(1, (since - 0.25) / 0.35, (until - since) / 0.5));
        if (st.cut) black = Math.min(1, (st.screen - st.cut.at) / st.cut.dur);
        if (st.hide > 0) {
          st.hide--;
          hidden = true;
          black = 1;
          if (st.hide === 0) st.fadeInAt = st.screen;
        } else if (st.fadeInAt !== null) {
          const f = (st.screen - st.fadeInAt) / cfg.recap.fadeIn;
          black = Math.max(black, 1 - f);
          if (f >= 1) st.fadeInAt = null;
        }
      }
      return { seek, speed: st.speed, caption, phase: b.phase, beat: st.beats.length - 1, end: b.end, err: st.err ?? null, done: Boolean(st.done),
        black, hidden, split };
    },
    beats: () => st.beats,
    view(v) { st.view = v; },
    measuring(on) { st.noMeasure = !on; },
    // Out of time: fade out on what is on screen and end the moments.
    finish() { if (!st.done) { st.done = true; st.cut = { at: st.screen, dur: cfg.recap?.fadeOut ?? 0.5, final: true }; } },
    qa: () => qa,
    diverged: () => st.diverged ?? [],
    stop() { r.camera.setRig(null); },
  };
})();`;

function audioInit({ rate, span }) {
  const Offline = window.OfflineAudioContext;
  const realSuspend = Offline.prototype.suspend;
  const realResume = Offline.prototype.resume;
  class SteppedAudio extends Offline {
    constructor() { super(2, Math.round(rate * span), rate); window.__audio = this; this.__t = 0; this.__done = null; }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); }
    suspend(t) { return t === undefined ? Promise.resolve() : realSuspend.call(this, t); }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = SteppedAudio;
  window.webkitAudioContext = SteppedAudio;
  window.__audioT = () => window.__audio?.__t ?? null;
  window.__audioStep = async sec => {
    const a = window.__audio;
    if (!a || a.__t + sec > span - 1) return;
    const next = Math.round((a.__t + sec) * rate) / rate;
    const reached = realSuspend.call(a, next);
    if (!a.__done) a.__done = a.startRendering();
    else realResume.call(a);
    await reached;
    a.__t = next;
  };
  // The render from t0, read at the pace of each frame (adv: seconds of
  // render per frame), as a 16-bit stereo WAV in base64.
  window.__audioWav = async (t0, adv, spf, gains = null, hidden = null) => {
    const a = window.__audio;
    if (!a?.__done) return null;
    realResume.call(a);
    const buf = await a.__done;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const shown = hidden ? hidden.filter(h => !h).length : adv.length;
    const n = shown * spf;
    const out = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * 4, true);
    let o = 44;
    let x = t0 * rate;
    for (let j = 0; j < adv.length; j++) {
      const s0 = adv[j] * rate / spf;
      const s1 = (adv[j + 1] ?? adv[j]) * rate / spf;
      // A frame hidden while a seek settles is not in the video: its sound
      // is passed over. Each shown frame's gain eases into the next's.
      if (hidden?.[j]) { x += adv[j] * rate; continue; }
      const g0 = gains ? gains[j] : 1;
      let g1 = g0;
      if (gains) for (let jj = j + 1; jj < adv.length; jj++) if (!hidden?.[jj]) { g1 = gains[jj]; break; }
      for (let q = 0; q < spf; q++) {
        const gn = g0 + (g1 - g0) * (q / spf);
        const i = Math.floor(x);
        const f = x - i;
        const l = (L[i] ?? 0) * (1 - f) + (L[i + 1] ?? 0) * f;
        const rr = (R[i] ?? 0) * (1 - f) + (R[i + 1] ?? 0) * f;
        out.setInt16(o, Math.max(-1, Math.min(1, l * gn)) * 32767, true);
        out.setInt16(o + 2, Math.max(-1, Math.min(1, rr * gn)) * 32767, true);
        o += 4;
        x += s0 + (s1 - s0) * (q / spf);
      }
    }
    const bytes = new Uint8Array(out.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
}

function clockInit() {
  const realNow = performance.now.bind(performance);
  let virtual = null;
  performance.now = () => (virtual === null ? realNow() : virtual);
  window.__clock = { take() { if (virtual === null) virtual = realNow(); }, step(ms) { virtual += ms; } };
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const evaluate = page.evaluate.bind(page);
  page.evaluate = (fn, arg) => withTimeout(evaluate(fn, arg), STEP_TIMEOUT, 'a page step');
  page.evaluateLong = (fn, arg, ms) => withTimeout(evaluate(fn, arg), ms, 'a long page step');
  page.on('pageerror', e => log('pageerror', e.message.slice(0, 200)));
  if (new URL(PLAY).origin !== 'https://play.bfstats.io') {
    const origin = new URL(PLAY).origin;
    await page.route(u => { const x = new URL(u); return x.origin === origin && x.pathname.startsWith('/stats/'); },
      async r => { const x = new URL(r.request().url()); r.fulfill({ response: await r.fetch({ url: `${API}${x.pathname}${x.search}` }) }); });
  }
  if (SOUND) await page.addInitScript(audioInit, { rate: AUDIO_RATE, span: AUDIO_SPAN });
  await page.addInitScript(clockInit);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: LOAD_TIMEOUT, polling: 1000 });
  await page.waitForTimeout(8000);
  log('loaded in', Math.round((Date.now() - t0) / 1000), 's');
  await page.evaluate(async () => {
    window.__renderer.setAnimationLoop(null);
    window.__clock.take();
    await window.__audioStep?.(3);
  });
  return page;
}

async function json(u) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
      throw new Error(`${res.status}`);
    } catch (e) {
      if (i >= 4) throw new Error(`${u}: ${e.message}`);
      await new Promise(ok => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}

/**
 * The link copy, roll-link.mp4: 720p sized to land under 44 MB, the video
 * the share link names. Discord shows a linked video over about 50 MB as a
 * bare link, and the 4K is 300-480 MB (2026-11-12). From the HD take, or
 * the 4K when there is none; made once.
 */
function linkCopy(dir) {
  const out = path.join(dir, 'roll-link.mp4');
  if (fs.existsSync(out)) return out;
  const from = ['roll-1080p.mp4', 'roll-2160p.mp4', 'roll.mp4'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
  if (!from) throw new Error(`${dir}: no take to make a link copy from`);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', from]).toString().trim());
  const audio = 128;
  for (const target of [44e6, 38e6, 30e6]) {
    const video = Math.max(800, Math.floor((target * 8) / seconds / 1000 - audio));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-vf', tvFilter('-2:720:flags=lanczos'),
      '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${video}k`, '-maxrate', `${video}k`, '-bufsize', `${video * 2}k`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', `${audio}k`, '-movflags', '+faststart', out]);
    if (fs.statSync(out).size <= 46e6) break;
  }
  log(`  link copy ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  return out;
}

/** The link copy to a Short already up (PUT /stats/shorts/<slug>/link-video). */
async function sendLinkCopy(dir, slug, to) {
  const file = linkCopy(dir);
  const res = await fetch(`${to}/stats/shorts/${slug}/link-video`, {
    method: 'PUT', body: fs.readFileSync(file), headers: { ...(await shortsAuth()), 'Content-Type': 'video/mp4' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`link video ${res.status}: ${body.slice(0, 300)}`);
  log(`  link video on ${slug}: ${JSON.parse(body).linkVideoUrl}`);
}

/**
 * A filmed take to the strip (api/Shorts, kind "roll"): the 4K and the HD
 * from its folder with its poster and meta.json, as the account the Shorts
 * job signed in as (scripts/shorts-sign-in.mjs); --to=<api> for another API. --upload films and sends;
 * --upload-take=<folder> sends a take filmed before.
 */
async function uploadTake(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const mp4 = path.join(dir, 'roll-2160p.mp4');
  const poster = path.join(dir, 'poster.jpg');
  await requireShortsAuth('--upload');
  const to = opt('to', API);
  // Through Cloudflare a request carries at most 100 MB, and a 4K roll is
  // 300-450: each video goes up in parts first (POST /stats/shorts/parts),
  // and the upload names them (videoUpload / videoHdUpload).
  const PART = 80 * 1024 * 1024;
  const sendParts = async file => {
    const id = createHash('sha256').update(`${file}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
    const bytes = fs.readFileSync(file);
    for (let i = 0, n = 0; i < bytes.length; i += PART, n++) {
      for (let tryNo = 0; ; tryNo++) {
        const r = await fetch(`${to}/stats/shorts/parts?upload=${id}&index=${n}`, {
          method: 'POST', body: bytes.subarray(i, i + PART), headers: { ...(await shortsAuth()), 'Content-Type': 'application/octet-stream' },
        }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
        if (r.ok) break;
        if (tryNo >= 3) throw new Error(`part ${n} of ${path.basename(file)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
        await new Promise(ok => setTimeout(ok, 3000 * (tryNo + 1)));
      }
    }
    log(`  sent ${path.basename(file)} in ${Math.ceil(bytes.length / PART)} parts`);
    return id;
  };
  const hd = path.join(dir, 'roll-1080p.mp4');
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('videoUpload', await sendParts(mp4));
  if (fs.existsSync(hd) && hd !== mp4) form.append('videoHdUpload', await sendParts(hd));
  form.append('poster', new Blob([fs.readFileSync(poster)], { type: 'image/jpeg' }), 'poster.jpg');
  const res = await fetch(`${to}/stats/shorts`, { method: 'POST', body: form, headers: await shortsAuth() });
  const body = await res.text();
  if (!res.ok) throw new Error(`upload ${res.status}: ${body.slice(0, 300)}`);
  const made = JSON.parse(body);
  fs.writeFileSync(path.join(dir, 'uploaded.json'), JSON.stringify(made, null, 2));
  await sendLinkCopy(dir, made.slug, to);
  log(`uploaded ${made.slug}: ${API}/replay/s/${made.slug}`);
}
if (UPLOAD_TAKE) {
  await uploadTake(UPLOAD_TAKE);
  process.exit(0);
}
// --link-take=<folder>: the link copy to a roll already up (its uploaded.json).
if (LINK_TAKE) {
  await requireShortsAuth('--link-take');
  const { slug } = JSON.parse(fs.readFileSync(path.join(LINK_TAKE, 'uploaded.json'), 'utf8'));
  await sendLinkCopy(LINK_TAKE, slug, opt('to', API));
  process.exit(0);
}
const rec = await json(`${API}/stats/recordings/${SLUG}`);
/** A level's name as a title says it: "Arnhem-1944" reads "Arnhem 1944",
 *  "omaha_beach" "Omaha Beach". */
function levelNameOf(r) {
  return String(r.title ?? r.level).split(' on ')[0]
    .replace(/[-_](\d{4})$/, ' $1').replace(/_/g, ' ')
    .split(' ').map(w => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

// --- The script (the owner, 2026-11-12: a script with each video "that
// allows us to re-record something ... versioned ... I'm not interested in
// keeping version support, but it would at least tell us if we could
// regenerate it or not"). A take is the same take again only when three
// things are: the recording (its bytes), this tool (its last commit, and
// no edits on top), and the viewer that drew it (a hash of the modules the
// replay runs). The script names all three and every beat in order.
const SCRIPT_FORMAT = 'bfstats-roll-script';
const SCRIPT_VERSION = 1;
const git = (...a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return null; } };
const toolId = {
  commit: git('log', '-1', '--format=%H', '--', 'scripts/action-roll.mjs'),
  edited: Boolean(git('status', '--porcelain', '--', 'scripts/action-roll.mjs')),
};
const recordingBytes = Buffer.from(await (await fetch(`${API}${rec.recordingUrl}`)).arrayBuffer());
const recordingId = { slug: SLUG, title: rec.title, mod: rec.mod, level: rec.level, sha256: createHash('sha256').update(recordingBytes).digest('hex'), bytes: recordingBytes.length };
// --- A recap's plan (features/match-recap), made here from the recording as
// the Shorts runner makes its picks: its moments (replay-recap-pick.js) and
// its salt. A script's plan is filmed as it was.
const RECAP_TUNE = Object.freeze({ fadeOut: 0.45, fadeIn: 0.4, dip: 0.25, settle: 14, end: 3.4, intro: 3.6 });
// A recap's beats are shorter than a roll's (the owner, 2026-11-15: more
// action, "either by shortening what we already film or making the reel
// longer"): 2.4 s on him before a kill, 2.2 s held after, a fight 1.2 s more.
const RECAP_PACE = Object.freeze({
  lead: { shot: 2.0, kill: 2.4, bomb: 3.0, fire: 1.4 },
  after: { shot: 2.0, kill: 2.2, fire: 1.2, miss: 0.7 },
  busy: { acts: 2, near: 80, within: 5, stay: 1.2 },
});
// A long shot's bullet ride: the Shorts' own pace (shorts-runner.mjs
// SHORT_PACE), the round on screen 0.45-1.4 s by distance, its hold 1 s at
// 0.6x; from 60 m, and every long-shot moment.
const RECAP_BULLET = Object.freeze({
  from: 60, pace: 90, flightBase: 0.35, flightPerM: 250, flightMin: 0.45, flightMax: 1.4, after: 0.5,
  hold: Object.freeze({ real: 1.0, speed: 0.6, max: 2.5, pastKill: 0.7, hullReal: 2.6, hullMax: 4, hullSpeed: 0.75 }),
});
let recapPlan = null;
if (RECAP) {
  const viewer = path.join(REPO, 'tools/bf1942-models/viewer');
  const mod = f => import(pathToFileURL(path.join(viewer, f)).href);
  const [R, C, P] = await Promise.all([mod('replay-recording.js'), mod('replay-chapters.js'), mod('replay-recap-pick.js')]);
  if (SCRIPT?.recap) recapPlan = SCRIPT.recap;
  else {
    const prec = R.parseRecording(recordingBytes.toString('utf8'));
    prec.kills = C.killsOf(prec);
    const rel = `models/mods/${String(rec.mod).toLowerCase()}/models.json`;
    const own = path.join(viewer, rel);
    const rows = fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, 'utf8'))
      : await json(`${PLAY}/${rel}`).catch(() => json(`${PLAY}/models/models.json`));
    const models = new Map(rows.map(m => [String(m.name).toLowerCase(), m]));
    const picked = P.recapMomentsOf(prec, { models, budget: Math.min(P.RECAP.budget, LENGTH - 20) });
    const salt = P.saltOf(prec).map(sl => ({ ...sl, secs: Math.round(P.slideSeconds(sl) * 10) / 10 }));
    recapPlan = { moments: picked.moments, salt, recorder: picked.recorder, recordedBy: C.recorderName(prec), dropped: picked.dropped.length, min: P.RECAP.min };
  }
  log(`recap: ${recapPlan.moments.length} moments (${recapPlan.dropped ?? 0} the recorder did not see well enough), ${recapPlan.salt.length} salt slides`);
  for (const m of recapPlan.moments) log(`  ${m.t0.toFixed(0).padStart(5)} s  ${m.label}: ${m.name}${m.recorder ? ' (the recorder)' : ''}, ${m.kills.length} kill${m.kills.length > 1 ? 's' : ''}`);
  for (const sl of recapPlan.salt) log(`  salt ${sl.t.toFixed(0)} s  ${sl.name}: ${sl.lines.map(l => l.text).join(' / ')}`);
  if (recapPlan.moments.length < (recapPlan.min ?? 4)) {
    log(`too few moments for a recap (${recapPlan.moments.length}, ${recapPlan.min ?? 4} wanted)`);
    process.exit(3);
  }
}
/** The viewer's modules the take depends on, hashed in the page. */
const VIEWER_MODULES = ['replay.js', 'replay-camera.js', 'replay-battles.js', 'replay-recording.js', 'replay-hulls.js', 'replay-shorts-pick.js', 'replay-recap-pick.js',
  'replay-gunfire.js', 'gunfire.js', 'round-launch.js', 'map.html'];
if (SCRIPT) {
  if (SCRIPT.format !== SCRIPT_FORMAT || SCRIPT.version !== SCRIPT_VERSION) throw new Error(`${SCRIPT_PATH} is not a version ${SCRIPT_VERSION} roll script`);
  const differs = [];
  if (SCRIPT.recording.sha256 !== recordingId.sha256) differs.push(`the recording's file changed (${SCRIPT.recording.bytes} bytes then, ${recordingId.bytes} now)`);
  if (SCRIPT.tool.commit !== toolId.commit || SCRIPT.tool.edited || toolId.edited) differs.push(`the roll tool changed (${SCRIPT.tool.commit?.slice(0, 9)}${SCRIPT.tool.edited ? '+edits' : ''} then, ${toolId.commit?.slice(0, 9)}${toolId.edited ? '+edits' : ''} now)`);
  // The viewer is checked once the page is up (below).
  global.__scriptDiffers = differs;
}
const name = opt('name', RECAP ? `${SLUG}-recap` : `${SLUG}-${FROM ?? 'auto'}-s${SEED}${BPM ? `-${BPM}bpm` : ''}`);
const dir = path.join(OUT, name);
const frames = path.join(dir, 'frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const q = new URLSearchParams({ mod: rec.mod, map: rec.level, replay: rec.recordingUrl });
const url = `${PLAY}/map.html?${q.toString().replace(/%2F/g, '/')}&shots&mute=0`;
log(RECAP ? 'recap of' : 'roll of', rec.title, '->', dir);

const GPU_ARGS = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: opt('channel', undefined), args: args.includes('--gpu') ? GPU_ARGS : [] });
try {
  const page = await openPage(browser, url);
  const info = await page.evaluate(async ({ src, overlay, cfg }) => {
    window.__rb = await import(new URL('replay-battles.js', location.href).href);
    window.__vp = await import(new URL('vehicle-players.js', location.href).href);
    window.__pick = await import(new URL('replay-shorts-pick.js', location.href).href);
    const cm = await import(new URL('replay-camera.js', location.href).href);
    window.__hullRadius = cm.hullRadius;
    (0, eval)(src);
    if (overlay) { (0, eval)(overlay); await window.__recapDraw.ready; }
    const r = window.replay;
    // A recap's long shots ride the creator's round cam: its view on, the
    // camera staying where the hold left it.
    if (cfg.recap) {
      r.creator?.grant?.(true);
      r.creator?.toggle?.(true);
      if (r.creator) { r.creator.prefs.afterHit = 'stay'; r.creator.rounds.afterHit = 'stay'; }
    } else r.creator?.toggle?.(false);
    const n = window.__roll.install(cfg);
    // The viewer as it is now: one hash over the modules the take runs.
    const parts = [];
    for (const m of cfg.viewerModules) parts.push(m + '\n' + await (await fetch(new URL(m, location.href).href, { cache: 'no-store' })).text());
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')));
    const viewer = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return { ...n, opening: window.__roll.opening(), duration: r.rec.duration, viewer };
  }, {
    src: ROLL_SRC,
    overlay: RECAP ? fs.readFileSync(path.join(REPO, 'scripts/recap-overlay.js'), 'utf8') : null,
    cfg: { ...ROLL, ...(RECAP ? RECAP_PACE : {}), recap: recapPlan ? { ...RECAP_TUNE, bullet: RECAP_BULLET, moments: recapPlan.moments } : null, heavy: ROLL.heavy.map(([re, k]) => [re.source, k]), notHeavy: ROLL.notHeavy.source, planted: ROLL.planted.source, fps: FPS, fov: 62, seed: SEED, clear: !args.includes('--no-clear'), barLen: BPM ? 240 / BPM : 0,
      viewerModules: VIEWER_MODULES, forced: SCRIPT && !RECAP ? SCRIPT.beats.map(b => ({ kind: b.kind, pid: b.pid, tAct: b.tAct, how: b.how })) : null },
  });
  log(`acts ${info.acts} (${info.shots} heavy shots, ${info.kills} kills, ${info.fire} bursts; ${info.dropped} dropped as out of range or stuttering); busiest 40 s from ${info.opening?.t?.toFixed(1)}`);
  if (RECAP) {
    log(`recap queue: ${info.queue} beats${info.recapDropped.length ? `; moments the page could not film: ${info.recapDropped.join(', ')}` : ''}`);
    if (!info.queue) throw new Error('no moment of the recap could be filmed');
  }
  if (SCRIPT) {
    const differs = global.__scriptDiffers;
    if (SCRIPT.viewer.sha256 !== info.viewer) differs.push('the viewer that draws it changed');
    if (differs.length) {
      log(`cannot regenerate this take exactly: ${differs.join('; ')}`);
      if (!args.includes('--force')) throw new Error('refusing to re-record a changed take (--force films it anyway, following its beats where it can)');
      log('--force: filming it anyway, following its beats where it can');
    } else log('the recording, the tool and the viewer are all as they were: this is the same take');
  }
  const start = RECAP ? info.recapStart : FROM !== null ? Number(FROM) : Math.max(0, (info.opening?.t ?? 60) - 4);
  await page.evaluate(start => {
    const r = window.replay;
    r.seek(start);
    r.speed = 1;
    r.playing = true;
  }, start);
  // Settle: the hulls and bodies near the start build.
  for (let k = 0; k < 24; k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  const from = await page.evaluate(() => window.__audioT?.() ?? null);
  const paces = [];
  const gains = [];
  const hiddenAt = [];
  const whites = [];
  // A roll is LENGTH s; a recap runs until its last moment fades out (at most
  // LENGTH s), then its salt and its closing card (`tail`).
  let total = Math.round(LENGTH * FPS);
  let tail = null;
  // A recap opens on its card: the round held still behind it.
  const prelude = RECAP ? Math.round(RECAP_TUNE.intro * FPS) : 0;
  total += prelude;
  const recapInfo = RECAP ? {
    level: levelNameOf(rec), server: String(rec.title ?? '').split(' on ').slice(1).join(' on ').replace(/\s+\|.*$/, '').trim(),
    date: rec.createdAt ? new Date(rec.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
    recordedBy: recapPlan.recordedBy ?? '',
  } : null;
  const t0 = Date.now();
  let last = null;
  let w = 0;
  for (let k = 0; ; k++) {
    if (tail ? w >= tail.end : w >= total) break;
    if (k > total * 3 + 3000) throw new Error('the take is not moving on (hidden frames without end)');
    // Out of time with moments left: the director finishes on a fade.
    if (RECAP && !tail && w >= total - Math.round(RECAP_TUNE.fadeOut * FPS) - 2) await page.evaluate(() => window.__roll.finish());
    const res = await page.evaluate(async ({ W, H, FPS, w, total, recap, tail, info, prelude }) => {
      const r = window.replay;
      const roll = window.__roll;
      const D = window.__recapDraw;
      // The opening card holds the round still: its screen seconds are not
      // the moments' (the director starts its clock after it).
      const screen = (w - prelude) / FPS;
      const opening = recap && w < prelude;
      const tk = roll.tick(Math.max(0, screen), { lum: window.__rollLum ?? 0 });
      if (tk.seek !== null) r.seek(tk.seek);
      // Held still behind the card: paused, as a speed of 0 reads as 1.
      r.speed = tail ? 1 : tk.speed;
      r.playing = !opening;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.((opening ? 0 : tail ? 1 : tk.speed) / FPS);
      if (tk.hidden && !tail) return { hidden: true, speed: tk.speed, gain: 0, t: r.time, beat: tk.beat, phase: tk.phase, done: tk.done, black: 1, lum: window.__rollLum ?? 0 };
      const cv = (window.__rollCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      const gl = window.__renderer.domElement;
      const split = recap && !tail && tk.split;
      if (split) {
        // Each half the middle of its own camera's frame: his on the left,
        // the man he fights on the right.
        g.drawImage(gl, W / 4, 0, W / 2, H, 0, 0, W / 2, H);
        roll.view('B');
        window.__renderOnce(W, H, 0);
        g.drawImage(gl, W / 4, 0, W / 2, H, W / 2, 0, W / 2, H);
        roll.view('A');
      } else g.drawImage(gl, 0, 0, W, H);
      // The frame's share near white, for the next tick (white-out): a smoke
      // screen or a blast covering a third of the picture.
      {
        const sm = (window.__rollLumCv ??= Object.assign(document.createElement('canvas'), { width: 32, height: 18 }));
        const sg = sm.getContext('2d', { willReadFrequently: true });
        sg.drawImage(cv, 0, 0, 32, 18);
        const px = sg.getImageData(0, 0, 32, 18).data;
        let white = 0;
        for (let i = 0; i < px.length; i += 4) if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] > 225) white++;
        window.__rollLum = white / (px.length / 4);
      }
      // Laid out for 1080 lines, scaled to the frame.
      const u = H / 1080;
      let gain = 1;
      const c = tk.caption;
      const weapon = c?.weapon ? (window.replay.creator?.display?.(c.weapon) || c.weapon) : '';
      if (opening) {
        const tmp = (window.__rollBlur ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
        tmp.getContext('2d').drawImage(cv, 0, 0);
        g.save();
        g.filter = `blur(${16 * u}px) brightness(0.36) saturate(0.6)`;
        g.drawImage(tmp, -40 * u, -40 * u, W + 80 * u, H + 80 * u);
        g.restore();
        D.intro(g, W, H, u, w / FPS, info, prelude / FPS);
        const inn = Math.min(1, w / 15);
        if (inn < 1) { g.fillStyle = `rgba(0,0,0,${1 - inn})`; g.fillRect(0, 0, W, H); }
        gain = 0;
      } else if (recap && tail) {
        // The tail: the round blurred behind the salt, then the closing card.
        const tmp = (window.__rollBlur ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
        const tg = tmp.getContext('2d');
        tg.drawImage(cv, 0, 0);
        g.save();
        g.filter = `blur(${18 * u}px) brightness(0.3) saturate(0.5)`;
        g.drawImage(tmp, -40 * u, -40 * u, W + 80 * u, H + 80 * u);
        g.restore();
        const sec = (w - tail.at) / FPS;
        const saltLen = tail.salt / FPS;
        if (sec < saltLen) D.salt(g, W, H, u, sec, info.salt);
        else D.end(g, W, H, u, sec - saltLen, info, (tail.end - tail.at - tail.salt) / FPS);
        const inn = Math.min(1, sec / 0.6);
        if (inn < 1) { g.fillStyle = `rgba(0,0,0,${1 - inn})`; g.fillRect(0, 0, W, H); }
        const left = (tail.end - w) / FPS;
        gain = 0.22 * Math.min(1, sec / 0.8) * Math.min(1, left / 1.2);
      } else if (recap) {
        if (split) D.split(g, W, H, u, tk.split, Math.max(0, Math.min(1, c.alpha * 3)));
        D.caption(g, W, H, u, c, weapon);
        // Out of the opening card's blur into the first moment.
        const fromCard = Math.min(1, (w - prelude) / 15);
        if (fromCard < 1) {
          const tmp = (window.__rollBlur ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
          tmp.getContext('2d').drawImage(cv, 0, 0);
          g.save();
          g.globalAlpha = 1 - fromCard;
          g.filter = `blur(${16 * u}px) brightness(0.36) saturate(0.6)`;
          g.drawImage(tmp, -40 * u, -40 * u, W + 80 * u, H + 80 * u);
          g.restore();
        }
        const black = Math.max(0, tk.black ?? 0);
        if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, H); }
        gain = (1 - black) * Math.min(1, 0.15 + (w - prelude) / 20);
      } else {
        // Who the camera is on, low left, as it takes him.
        if (c.alpha > 0 && c.name) {
          g.save();
          g.globalAlpha = c.alpha;
          g.textAlign = 'left';
          g.textBaseline = 'alphabetic';
          g.shadowColor = 'rgba(0,0,0,0.75)';
          g.shadowBlur = 10 * u;
          g.fillStyle = 'rgba(246,241,226,0.95)';
          g.font = '800 ' + 40 * u + 'px system-ui, "Segoe UI", sans-serif';
          g.fillText(c.name, 72 * u, H - 104 * u);
          g.font = '600 ' + 26 * u + 'px system-ui, "Segoe UI", sans-serif';
          g.fillStyle = 'rgba(232,196,120,0.95)';
          g.fillText(String(weapon).toUpperCase(), 74 * u, H - 66 * u);
          g.restore();
        }
        // In from black, out to black.
        const fade = Math.min(1, w / 18, (total - 1 - w) / 30);
        if (fade < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - Math.max(0, fade)) + ')'; g.fillRect(0, 0, W, H); }
      }
      // The site, small, top right.
      g.save();
      g.textAlign = 'right';
      g.font = '700 ' + 24 * u + 'px system-ui, "Segoe UI", sans-serif';
      g.fillStyle = 'rgba(246,241,226,0.55)';
      g.fillText('play.bfstats.io', W - 56 * u, 64 * u);
      g.restore();
      return { hidden: false, gain, lum: window.__rollLum, url: cv.toDataURL('image/jpeg', 0.9), speed: tail ? 1 : tk.speed, t: r.time, phase: tk.phase, beat: tk.beat,
        end: tk.end, err: tk.err, done: tk.done, black: tk.black ?? 0 };
    }, { W, H, FPS, w, total, recap: RECAP, tail, info: recapInfo ? { ...recapInfo, salt: recapPlan.salt } : null, prelude });
    paces.push(res.speed);
    gains.push(res.gain);
    hiddenAt.push(res.hidden);
    if (!res.hidden) {
      fs.writeFileSync(path.join(frames, `f${String(w).padStart(5, '0')}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
      if (res.lum > ROLL.white && !tail) whites.push(w / FPS);
      w++;
    }
    if (RECAP) {
      // The last moment faded out: the salt (if the round had any) and the card.
      if (!tail && res.done && res.black >= 1) {
        const salt = await page.evaluate(sl => window.__recapDraw.saltPlan(sl).length, recapPlan.salt);
        const saltFrames = Math.round(salt * FPS);
        tail = { at: w, salt: saltFrames, end: w + saltFrames + Math.round(RECAP_TUNE.end * FPS) };
        // Behind the blur nothing is measured: the clipping log is the moments'.
        await page.evaluate(() => window.__roll.measuring(false));
        log(`  moments end at ${(w / FPS).toFixed(1)} s; ${salt ? `salt ${salt.toFixed(1)} s, ` : 'no salt, '}the card ${RECAP_TUNE.end} s`);
      }
    } else if (res.done && total > w + 31) { total = w + 31; log(`  nothing left to film after ${(w / FPS).toFixed(1)} s: ending the take`); }
    if (args.includes('--trace') && k % FPS === 0) log(`  t ${res.t.toFixed(2)} phase ${res.phase} speed ${res.speed.toFixed(2)} beat ${res.beat} end ${res.end?.toFixed?.(2)} ${res.err ?? ''}`);
    if (res.beat !== last) {
      last = res.beat;
      log(`  frame ${w} (${(w / FPS).toFixed(1)} s): beat ${res.beat}, round ${res.t.toFixed(1)}`);
    }
  }
  total = w;
  log(`filmed ${total} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
  const beats = await page.evaluate(() => window.__roll.beats());
  const qa = await page.evaluate(() => window.__roll.qa());
  if (SCRIPT) {
    const diverged = await page.evaluate(() => window.__roll.diverged());
    log(diverged.length ? `the script's beats ${diverged.join(', ')} were not found; the director chose there` : `every one of the script's ${SCRIPT.beats.length} beats was filmed as written`);
  }
  const whiteRuns = [];
  for (const t of whites) {
    const last = whiteRuns.at(-1);
    if (last && t - last[1] <= 0.1) last[1] = t; else whiteRuns.push([t, t]);
  }
  log(`white: ${whites.length} frames over ${Math.round(ROLL.white * 100)}% near white${whiteRuns.length ? `; at ${whiteRuns.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}s`).join(', ')}` : ''}`);
  const runs = [];
  for (const [t, why] of qa.at) {
    const last = runs.at(-1);
    if (last && last.why === why && t - last.to <= 0.15) last.to = t;
    else runs.push({ from: t, to: t, why });
  }
  log(`clipping: ${qa.under} frames under the ground, ${qa.lens} with the lens in terrain or a wall, ${qa.boxed} boxed in, of ${qa.frames}${runs.length ? `; at ${runs.map(x => `${x.from}${x.to > x.from ? `-${x.to}` : ''}s ${x.why}`).join(', ')}` : ''}`);
  fs.writeFileSync(path.join(dir, 'roll.script.json'), JSON.stringify({
    format: SCRIPT_FORMAT, version: SCRIPT_VERSION, made: new Date().toISOString(),
    recording: recordingId, tool: toolId, viewer: { site: PLAY, sha256: info.viewer, modules: VIEWER_MODULES },
    take: { from: start, length: LENGTH, res: RES, fps: FPS, seed: SEED, bpm: BPM, sound: SOUND, clear: !args.includes('--no-clear'), recap: RECAP },
    ...(recapPlan ? { recap: recapPlan } : {}),
    beats: beats.map(b => ({ screen: b.screen, t: b.t, tAct: b.tAct, kind: b.kind, pid: b.pid, name: b.name, weapon: b.weapon, how: b.how })),
    rerecord: `node scripts/action-roll.mjs --script=<this file> --gpu --channel=chrome${RECAP ? ' --sound' : ''}`,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ recording: SLUG, title: rec.title, start, seed: SEED, bpm: BPM, clipping: { ...qa, at: undefined, runs }, beats,
    ...(recapPlan ? { salt: recapPlan.salt, tail } : {}) }, null, 2));
  for (const b of beats) log(`  ${b.screen.toFixed(1)}s  ${(RECAP ? (b.moment ?? '') + (b.split ? ' [split]' : '') + (b.bullet ? ' [bullet]' : '') + ' ' : '')}${b.how.padEnd(5)} ${b.name} ${b.kind} ${b.weapon ?? ''}${b.victims.length ? ` -> ${b.victims.join(', ')}` : ''}${b.dist !== null ? ` (${b.dist} m)` : ''}${b.landed === false ? ' MISS' : ''}${b.busy >= ROLL.busy.acts ? ' FIGHT' : ''}${b.held !== undefined ? ` held ${b.held}s` : ''}`);
  let wavPath = null;
  if (SOUND && from !== null) {
    const adv = paces.map(p => p / FPS);
    // The offline render covers the whole span first: an FHSW level's runs
    // past 5 min (Manchuria, 2026-11-11). Failing it costs the sound, never
    // the picture.
    const wav = await page.evaluateLong(({ from, adv, spf, gains, hidden }) => window.__audioWav(from, adv, spf, gains, hidden),
      { from, adv, spf: AUDIO_RATE / FPS, gains: RECAP ? gains : null, hidden: RECAP ? hiddenAt : null }, 15 * 60 * 1000)
      .catch(e => { log(`  no sound: ${e.message}`); return null; });
    if (wav) {
      wavPath = path.join(dir, 'sound.wav');
      fs.writeFileSync(wavPath, Buffer.from(wav, 'base64'));
    }
  }
  // Every quality from the one set of frames, each with the sound.
  const written = [];
  for (const [h, crf, peak] of QUALITIES) {
    const out = path.join(dir, `roll-${h}p.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'),
      ...(wavPath ? ['-i', wavPath, '-map', '0:v', '-map', '1:a'] : []),
      '-vf', tvFilter(`-2:${h}:flags=lanczos`), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-maxrate', peak, '-bufsize', `${parseInt(peak, 10) * 2}M`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      ...(wavPath ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-af', 'afade=t=in:d=0.6,loudnorm=I=-16:TP=-1.5:LRA=11,apad', '-shortest'] : []),
      '-movflags', '+faststart', out]);
    written.push(`${h}p ${(fs.statSync(out).size / 1e6).toFixed(0)} MB`);
  }
  const mp4 = path.join(dir, `roll-${QUALITIES[0][0]}p.mp4`);
  log('qualities:', written.join(', '));
  // The poster: the first hit or kill held on, else a third of the way in. A
  // recap's is its best moment's (a split screen's if it has one).
  const best = RECAP ? [...recapPlan.moments].sort((a, b) => Number(Boolean(b.split)) - Number(Boolean(a.split)) || b.score - a.score)[0] : null;
  const landedBeat = (best && beats.find(b => b.moment === best.label && b.tAct >= best.t0 && b.tAct <= best.t1)) ?? beats.find(b => b.landed || b.kind === 'kill');
  const posterAt = Math.min(total - 1, Math.max(0, prelude + Math.round(((landedBeat ? landedBeat.screen + (landedBeat.held ?? 4) * 0.7 : total / FPS / 3)) * FPS)));
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, `f${String(posterAt).padStart(5, '0')}.jpg`), '-vf', 'scale=1920:-2', '-q:v', '3', poster]);
  // The strip's meta (api/Shorts: kind "roll" or "recap", keyed by the round
  // second it starts, victim -10 or -11).
  const levelName = levelNameOf(rec);
  const meta = {
    recordingSlug: SLUG, killTime: Number(start.toFixed(2)), victimPid: RECAP ? -11 : -10, kind: RECAP ? 'recap' : 'roll',
    title: `${RECAP ? 'Match recap' : 'Action roll'}: ${levelName}`, killer: '', victim: '', weapon: '', killerVehicle: null, victimVehicle: null,
    distance: 0, lengthSeconds: Math.round((total / FPS) * 10) / 10, level: rec.level, mod: rec.mod,
    victims: [...new Set(beats.map(b => b.name).filter(Boolean))],
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  if (args.includes('--upload')) await uploadTake(dir);

  fs.rmSync(frames, { recursive: true, force: true });
  log('wrote', mp4);
} finally {
  // A close can hang once the page has rendered a long offline sound
  // (Arnhem, 2026-11-12: six minutes after its files were written); the
  // take is on disk by then, so it is given ten seconds.
  await Promise.race([browser.close(), new Promise(ok => setTimeout(ok, 10_000))]);
}
process.exit(process.exitCode ?? 0);
