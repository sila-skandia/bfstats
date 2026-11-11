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
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(REPO, 'ui/package.json'))('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const API = opt('api', 'https://bfstats.io');
const PLAY = opt('play', 'https://play.bfstats.io');
const SLUG = opt('recording', null);
const FROM = opt('from', null);
const LENGTH = Number(opt('length', 75));
const OUT = opt('out', path.join(os.homedir(), '.cache/bfstats-roll'));
const SOUND = args.includes('--sound');
const BPM = Number(opt('bpm', 0)) || 0;
const SEED = Number(opt('seed', 1));
const W = 1920, H = 1080, FPS = 30;
const AUDIO_RATE = 38400;
const AUDIO_SPAN = 1200;
const STEP_TIMEOUT = 60 * 1000;
const LOAD_TIMEOUT = 8 * 60 * 1000;
if (!SLUG) throw new Error('--recording=<slug> is required');

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
    [/panzershreck|bazooka|piat|rocket/i, 1.3],
    [/gunbarrel|cannon|_gun$|barrel$/i, 1.1],
    [/bombrack|bombdummy|bomb/i, 1.4],
  ],
  // Guns no man's action is: AA fire and plane guns are a volley, not a
  // round to ride.
  notHeavy: /aa_|flak|coax|browning|mg42|guns$|_air$|grenade|exppack|landmine|satchel|tnt/i,
  // Kills with no man's action to film: a mine, a charge left behind.
  planted: /landmine|exppack|mine|satchel|tnt|^null$/i,
  // A shot is worth riding when it is aimed at someone: a man or hull of
  // the other side within `aimed` m of its line, inside `reach` m.
  aimed: 6,
  reach: 260,
  // The longest a round is ridden before the camera lets it go.
  ride: 3,
  near: 120,
  far: 700,
  look: 5,
  // Seconds a man's act may keep the camera waiting, as a decay.
  soon: 1.8,
  // A shot or burst that hurts nobody, against one that does.
  missWeight: 0.3,
  lead: { shot: 1.8, kill: 2.4, bomb: 3.2, fire: 1.0 },
  after: { shot: 1.3, kill: 1.6, fire: 0.5, miss: 0.35 },
  // A fight worth staying in: `acts` more acts (a burst counts half)
  // within `near` m in the next `within` s holds the beat `stay` s longer.
  busy: { acts: 2, near: 80, within: 5, stay: 1.5 },
  // A burst: trigger presses (one recorded fire each) no more than `burstGap` s apart, at least `burstMin`,
  // aimed within `fireAimed` m of a man inside `fireReach` m.
  burstGap: 1.2,
  burstMin: 2,
  fireReach: 140,
  fireAimed: 3,
  fireWeight: 0.45,
  glide: 1.25,
  // A flight's rise over the straight line: under the fog.
  arcMax: 55,
  fly: 3.2,
  slow: 0.4,
  slowEase: 0.35,
  slowHold: 0.45,
  foot: [4.2, 1.7, 0.9],
  hull: [2.4, 0.9, 0.5],
  plane: [3.2, 0.9, 0],
  round: [7, 2.2, 2.6],
  follow: 5.5,
  aim: 7,
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
  const st = { beat: null, prev: null, beats: [], pos: null, look: null, from: null, fromLook: null, blend: 1, blendDur: 1, arc: 0,
    slowLeft: 0, slowUntil: -1, screen: 0, speed: 1, round: null, roundGoneAt: null, impact: null, used: new Map() };

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
  const aimedAt = (f, pids, reach = cfg.reach, aimed = cfg.aimed) => {
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
    for (const f of r.rec.fires) {
      const k = heavyOf(f);
      if (!k || isBot(f.pid, f.t)) continue;
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
    for (const a of actsIn(T + 0.6, T + 60)) {
      if (prev && a.pid === prev.pid) continue;
      if (a.kind === 'fire') continue;
      const s = a.w * Math.exp(-(a.t - T) / 12);
      if (!best || s > best.s) best = { a, s, d: Infinity, near: false, skip: a.t - cfg.leadOf(a) - cfg.fly * 0.5 > T + 2 };
    }
    return best;
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
    // After a kill: round the man going down.
    if (b.phase === 'down' && b.victims.length) {
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
    const A = aimPoint(b, me, t);
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

  const placeRig = {
    place(c, dt, t) {
      if (!st.want) return false;
      const { pos, look } = st.want;
      if (!st.pos) { st.pos = pos.clone(); st.look = look.clone(); }
      const sdt = 1 / cfg.fps;
      if (st.blend < 1 && st.from) {
        st.blend = Math.min(1, st.blend + sdt / st.blendDur);
        const u = st.blend;
        const e = u * u * u * (u * (u * 6 - 15) + 10);
        const p = st.from.clone().lerp(pos, e);
        p.y += st.arc * Math.sin(Math.PI * e);
        // The look leads the move: it turns to the new man early.
        const le = Math.min(1, e * 1.35);
        st.pos.copy(p);
        st.look.copy(st.fromLook.clone().lerp(look, le * le * (3 - 2 * le)));
      } else {
        const kp = 1 - Math.exp(-sdt * cfg.follow);
        const kl = 1 - Math.exp(-sdt * cfg.aim);
        st.pos.lerp(pos, kp);
        st.look.lerp(look, kl);
      }
      keepAbove(st.pos, 0.6);
      c.position.copy(st.pos);
      const m = new M4().lookAt(st.pos, st.look, new V3(0, 1, 0));
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
      r.camera.setRig(placeRig);
      return { acts: acts.length, shots: acts.filter(a => a.kind === 'shot').length, kills: acts.filter(a => a.kind === 'kill').length, fire: acts.filter(a => a.kind === 'fire').length, dropped: cfg.dropped };
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
    tick(screen) {
      st.screen = screen;
      const t = r.time;
      let b = st.beat;
      let seek = null;
      if (!b) {
        const ok = a => { const w = where(a.pid, t); return w && (w.plane || !roofed(w.eye)); };
        const first = acts.find(a => a.t >= t + cfg.leadOf(a) && a.kind === 'shot' && ok(a)) ?? acts.find(a => a.t >= t && a.kind !== 'fire' && ok(a));
        b = startBeat({ a: first, near: true, d: 0 }, t, 'opening');
        st.blend = 1;
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
      st.speed += Math.sign(target - st.speed) * Math.min(Math.abs(target - st.speed), (1 - cfg.slow) * ease);
      // Done: hand over.
      if (b.end !== null && t >= b.end && (!cfg.bar || st.screen >= cfg.nextBar(b.screenAt + 0.5))) {
        if (b.kind === 'fire') st.impact = where(b.act.target, t)?.eye ?? where(b.pid, t)?.eye ?? st.impact;
        const P = st.impact?.clone() ?? where(b.pid, t)?.eye ?? st.pos.clone();
        const log = st.beats[st.beats.length - 1];
        if (log) { log.landed = b.landed ?? null; log.busy = b.busy ?? 0; log.held = Math.round((st.screen - b.screenAt) * 10) / 10; }
        const pick = choose(t, P, b);
        if (pick) {
          const nb = startBeat(pick, t, b.victims.length ? 'after the kill' : 'after the hit');
          if (pick.skip) {
            // Jump the clock while the camera is high: the flight's top.
            nb.jumpAt = st.screen + cfg.fly * 0.45;
            nb.jumpTo = nb.t0 - cfg.fly * 0.55;
          }
          b = nb;
        } else b.end = t + 1;
      }
      if (b.jumpAt !== undefined && st.screen >= b.jumpAt && !b.jumped) {
        b.jumped = true;
        seek = b.jumpTo;
      }
      st.want = want(b, seek ?? t) ?? st.want;
      if (st.want && !b.fly || st.blend >= 1) {
        // Seen through walls nowhere: the spring arm on the man it films.
        if (st.want?.subject) st.want.pos = unblock(st.want.subject, keepAbove(st.want.pos.clone(), 0.8));
      }
      const since = st.screen - b.screenAt;
      const caption = { name: name(b.pid), weapon: b.act.f?.weapon ?? b.act.weapon ?? '', alpha: Math.max(0, Math.min(1, (since - 0.3) / 0.4, (3.2 - since) / 0.5)) };
      return { seek, speed: st.speed, caption, phase: b.phase, beat: st.beats.length - 1 };
    },
    beats: () => st.beats,
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
  window.__audioWav = async (t0, adv, spf) => {
    const a = window.__audio;
    if (!a?.__done) return null;
    realResume.call(a);
    const buf = await a.__done;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const n = adv.length * spf;
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
      for (let q = 0; q < spf; q++) {
        const i = Math.floor(x);
        const f = x - i;
        const l = (L[i] ?? 0) * (1 - f) + (L[i + 1] ?? 0) * f;
        const rr = (R[i] ?? 0) * (1 - f) + (R[i + 1] ?? 0) * f;
        out.setInt16(o, Math.max(-1, Math.min(1, l)) * 32767, true);
        out.setInt16(o + 2, Math.max(-1, Math.min(1, rr)) * 32767, true);
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
const rec = await json(`${API}/stats/recordings/${SLUG}`);
const name = opt('name', `${SLUG}-${FROM ?? 'auto'}-s${SEED}${BPM ? `-${BPM}bpm` : ''}`);
const dir = path.join(OUT, name);
const frames = path.join(dir, 'frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const q = new URLSearchParams({ mod: rec.mod, map: rec.level, replay: rec.recordingUrl });
const url = `${PLAY}/map.html?${q.toString().replace(/%2F/g, '/')}&shots&mute=0`;
log('roll of', rec.title, '->', dir);

const GPU_ARGS = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: opt('channel', undefined), args: args.includes('--gpu') ? GPU_ARGS : [] });
try {
  const page = await openPage(browser, url);
  const info = await page.evaluate(async ({ src, cfg }) => {
    window.__rb = await import(new URL('replay-battles.js', location.href).href);
    window.__vp = await import(new URL('vehicle-players.js', location.href).href);
    window.__pick = await import(new URL('replay-shorts-pick.js', location.href).href);
    const cm = await import(new URL('replay-camera.js', location.href).href);
    window.__hullRadius = cm.hullRadius;
    (0, eval)(src);
    const r = window.replay;
    r.creator?.toggle?.(false);
    const n = window.__roll.install(cfg);
    return { ...n, opening: window.__roll.opening(), duration: r.rec.duration };
  }, {
    src: ROLL_SRC,
    cfg: { ...ROLL, heavy: ROLL.heavy.map(([re, k]) => [re.source, k]), notHeavy: ROLL.notHeavy.source, planted: ROLL.planted.source, fps: FPS, fov: 62, seed: SEED, barLen: BPM ? 240 / BPM : 0 },
  });
  log(`acts ${info.acts} (${info.shots} heavy shots, ${info.kills} kills, ${info.fire} bursts; ${info.dropped} dropped as out of range or stuttering); busiest 40 s from ${info.opening?.t?.toFixed(1)}`);
  const start = FROM !== null ? Number(FROM) : Math.max(0, (info.opening?.t ?? 60) - 4);
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
  const total = Math.round(LENGTH * FPS);
  const t0 = Date.now();
  let last = null;
  for (let k = 0; k < total; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, k, total }) => {
      const r = window.replay;
      const roll = window.__roll;
      const screen = k / FPS;
      const tk = roll.tick(screen);
      if (tk.seek !== null) r.seek(tk.seek);
      r.speed = tk.speed;
      r.playing = true;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(tk.speed / FPS);
      const cv = (window.__rollCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      g.drawImage(window.__renderer.domElement, 0, 0, W, H);
      // Who the camera is on, low left, as it takes him.
      const c = tk.caption;
      if (c.alpha > 0 && c.name) {
        g.save();
        g.globalAlpha = c.alpha;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.shadowColor = 'rgba(0,0,0,0.75)';
        g.shadowBlur = 10;
        g.fillStyle = 'rgba(246,241,226,0.95)';
        g.font = '800 40px system-ui, "Segoe UI", sans-serif';
        g.fillText(c.name, 72, H - 104);
        g.font = '600 26px system-ui, "Segoe UI", sans-serif';
        g.fillStyle = 'rgba(232,196,120,0.95)';
        const w = window.replay.creator?.display?.(c.weapon) || c.weapon;
        g.fillText(String(w).toUpperCase(), 74, H - 66);
        g.restore();
      }
      // The site, small, top right.
      g.save();
      g.textAlign = 'right';
      g.font = '700 24px system-ui, "Segoe UI", sans-serif';
      g.fillStyle = 'rgba(246,241,226,0.55)';
      g.fillText('play.bfstats.io', W - 56, 64);
      g.restore();
      // In from black, out to black.
      const fade = Math.min(1, k / 18, (total - 1 - k) / 30);
      if (fade < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - Math.max(0, fade)) + ')'; g.fillRect(0, 0, W, H); }
      return { url: cv.toDataURL('image/jpeg', 0.9), speed: tk.speed, t: r.time, phase: tk.phase, beat: tk.beat };
    }, { W, H, FPS, k, total });
    fs.writeFileSync(path.join(frames, `f${String(k).padStart(5, '0')}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
    paces.push(res.speed);
    if (res.beat !== last) {
      last = res.beat;
      log(`  frame ${k} (${(k / FPS).toFixed(1)} s): beat ${res.beat}, round ${res.t.toFixed(1)}`);
    }
  }
  log(`filmed ${total} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
  const beats = await page.evaluate(() => window.__roll.beats());
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ recording: SLUG, title: rec.title, start, seed: SEED, bpm: BPM, beats }, null, 2));
  for (const b of beats) log(`  ${b.screen.toFixed(1)}s  ${b.how.padEnd(5)} ${b.name} ${b.kind} ${b.weapon ?? ''}${b.victims.length ? ` -> ${b.victims.join(', ')}` : ''}${b.dist !== null ? ` (${b.dist} m)` : ''}${b.landed === false ? ' MISS' : ''}${b.busy >= ROLL.busy.acts ? ' FIGHT' : ''}${b.held !== undefined ? ` held ${b.held}s` : ''}`);
  const mp4 = path.join(dir, 'roll.mp4');
  const silent = SOUND ? path.join(dir, 'silent.mp4') : mp4;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent]);
  if (SOUND && from !== null) {
    const adv = paces.map(p => p / FPS);
    const wav = await page.evaluateLong(({ from, adv, spf }) => window.__audioWav(from, adv, spf), { from, adv, spf: AUDIO_RATE / FPS }, 5 * 60 * 1000);
    if (wav) {
      const wavPath = path.join(dir, 'sound.wav');
      fs.writeFileSync(wavPath, Buffer.from(wav, 'base64'));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wavPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-af', 'afade=t=in:d=0.6,loudnorm=I=-16:TP=-1.5:LRA=11,apad', '-shortest', '-movflags', '+faststart', mp4]);
      fs.rmSync(silent);
    } else fs.renameSync(silent, mp4);
  }
  fs.rmSync(frames, { recursive: true, force: true });
  log('wrote', mp4);
} finally {
  await browser.close();
}
