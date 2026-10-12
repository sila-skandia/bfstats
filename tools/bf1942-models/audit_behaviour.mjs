#!/usr/bin/env node
// Behavioural audit for any extracted mod: drive, fly, fire and spawn what the
// static audit (audit_mod.py) can only read.
//
//   flock /tmp/claude-1000/chromium.lock \
//     node audit_behaviour.mjs --mod <id> --levels all|<a,b> --json out.json \
//          [--quick] [--port 5310 | --url http://localhost:5310] \
//          [--only vehicles,kits,flags,spawns,bots] [--accepted file.json] \
//          [--vehicle <regex>] [--max-vehicles N] [--bots-seconds 60]
//
// Nothing in here names a mod, a level, a vehicle or a kit: the levels come
// from `viewer/maps[/mods/<id>]/maps.json`, the vehicles from what the level
// places, the kits from the deploy screen's own rows.
//
// Output (`--json`): { mod, quick, levels: [{level, vehicles_tested,
// vehicles_failed, kits_tested, kits_failed, duration_s, ...}], findings:
// [{check, level, template_or_kit, severity, cause_key, evidence,
// retail_faithful, accepted}], tested: [...every unit with its verdict] }.
// Exit status 1 on any blocker/major finding that no `--accepted` entry (each
// carrying `evidence`) covers; 2 when the run could not be staged.
//
// One headless Chromium at a time (the caller wraps the run in flock). The
// server, when `--url` is absent, is `serve_viewer.py <port>` started and
// stopped here. Never 5273.

import { chromium } from '../../ui/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = n => process.argv.includes(`--${n}`);

const MOD = arg('mod', 'bf1942');
const QUICK = flag('quick');
const ONLY = new Set((arg('only', 'vehicles,kits,flags,spawns,bots')).split(','));
const PORT = Number(arg('port', 5310));
const BASE = arg('url', `http://localhost:${PORT}`);
const OUT = arg('json', null);
const ACCEPTED_FILE = arg('accepted', resolve(HERE, 'audit_behaviour_accepted.json'));
const VEHICLE_RE = arg('vehicle', null);
const MAX_VEHICLES = Number(arg('max-vehicles', QUICK ? 8 : 400));
const BOT_SECONDS = Number(arg('bots-seconds', QUICK ? 20 : 120));
const GAMETYPE = arg('gametype', null);
const VERBOSE = flag('verbose');
const W = 320, H = 200;

const mapsRoot = (MOD === 'bf1942' || MOD === 'vanilla')
  ? resolve(HERE, 'viewer/maps') : resolve(HERE, `viewer/maps/mods/${MOD}`);
const modParam = MOD === 'vanilla' ? 'bf1942' : MOD;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[behaviour]', ...a);

// ---------------------------------------------------------------- findings
const findings = [];
const tested = [];
// Static-audit cross reference: a hull the static audit already proved has no
// bound engine or gun script is silent in retail too.
const STATIC_FILE = arg('static', resolve(HERE, `out/mod-pipeline/${MOD}/gates/static.json`));
const staticSound = new Map();     // lower-case subject -> { cause, detail }
if (existsSync(STATIC_FILE)) {
  try {
    const rows = JSON.parse(await readFile(STATIC_FILE, 'utf8'));
    for (const r of Array.isArray(rows) ? rows : (rows.findings ?? [])) {
      if (r.audit === 'sound' && r.subject) staticSound.set(String(r.subject).toLowerCase(), { cause: r.cause_key ?? r.cause, detail: r.detail ?? '' });
    }
  } catch { /* a malformed static file is ignored */ }
}
function staticExplains(f) {
  if (f.check !== 'veh.engine-sound' && f.check !== 'veh.fire-sound') return null;
  const hay = `${f.template_or_kit} ${f.evidence}`.toLowerCase();
  for (const [subject, row] of staticSound) {
    const engineCause = /^engine-/.test(row.cause), weaponCause = /^weapon-/.test(row.cause);
    if (f.check === 'veh.engine-sound' && !engineCause) continue;
    if (f.check === 'veh.fire-sound' && !weaponCause) continue;
    const base = f.template_or_kit.toLowerCase().replace(/#.*$/, '');
    if (base === subject || (f.check === 'veh.fire-sound' && hay.includes(subject))) return { subject, ...row };
  }
  return null;
}
const accepted = existsSync(ACCEPTED_FILE) ? JSON.parse(await readFile(ACCEPTED_FILE, 'utf8')) : [];
function isAccepted(f) {
  return accepted.find(a => a.evidence && a.check === f.check
    && (!a.cause_key || a.cause_key === f.cause_key)
    && (!a.template_or_kit || String(a.template_or_kit).toLowerCase() === String(f.template_or_kit).toLowerCase())
    && (!a.level || a.level.toLowerCase() === String(f.level).toLowerCase()));
}
function add(f) {
  const rec = { retail_faithful: null, ...f };
  const hit = isAccepted(rec);
  rec.accepted = !!hit;
  if (hit) { rec.retail_faithful = hit.retail_faithful ?? rec.retail_faithful; rec.accepted_evidence = hit.evidence; }
  const why = !hit && staticExplains(rec);
  if (why) {
    rec.accepted = true; rec.retail_faithful = true;
    rec.accepted_evidence = `static audit ${why.cause} for ${why.subject}: ${why.detail}`;
  }
  findings.push(rec);
  if (VERBOSE) log(rec.severity, rec.check, rec.level, rec.template_or_kit, rec.evidence);
  return rec;
}

// A cockpit glb the manifest says does not exist is probed for and absent by
// design; the page fetches it for every hull.
let noCockpit = new Set();
let modelNames = new Set();
async function loadManifest() {
  const root = mapsRoot.replace('/maps', '/models');
  try {
    const m = JSON.parse(await readFile(`${root}/models.json`, 'utf8'));
    for (const e of m) modelNames.add(String(e.name).toLowerCase());
    for (const e of m) if (!e.cockpit && e.glb) noCockpit.add(e.glb.replace(/\.glb$/, '.cockpit.glb').toLowerCase());
  } catch { /* no manifest: every 404 is reported */ }
}
const optional404 = line => {
  const m = /\/([^/]+\.cockpit\.glb)/i.exec(line);
  return !!m && noCockpit.has(m[1].toLowerCase());
};

// ------------------------------------------------------------- level list
async function levelList() {
  const maps = JSON.parse(await readFile(`${mapsRoot}/maps.json`, 'utf8'));
  const want = arg('levels', 'all');
  const names = maps.map(m => m.name);
  if (want === 'all') return names;
  const wanted = want.split(',').map(s => s.trim().toLowerCase());
  return names.filter(n => wanted.includes(n.toLowerCase()) || wanted.includes(n.toLowerCase().replace(/-/g, '_')));
}
async function sceneOf(level) {
  const maps = JSON.parse(await readFile(`${mapsRoot}/maps.json`, 'utf8'));
  const m = maps.find(x => x.name === level);
  return JSON.parse(await readFile(`${mapsRoot}/${m.report}`, 'utf8'));
}
function pickMode(scene) {
  if (GAMETYPE) return GAMETYPE;
  const types = Object.keys(scene.gameTypes || {});
  if (types.includes('CoOp')) return 'CoOp';
  // The level's own default before Conquest: a mod's map can stand on a
  // parent's level of the same name whose Conquest layer is still mounted
  // and was made for another terrain (its flags 100 m under the new sea).
  if (scene.gameplayMode && types.includes(scene.gameplayMode)) return scene.gameplayMode;
  if (types.includes('Conquest')) return 'Conquest';
  return types[0] || 'Conquest';
}

// ---------------------------------------------------------------- session
class Session {
  constructor(browser, level, mode, bots = 0) {
    this.browser = browser; this.level = level; this.mode = mode; this.bots = bots;
    this.page = null; this.errors = []; this.notFound = []; this.t0 = Date.now();
  }
  async open() {
    if (this.page) await this.page.close().catch(() => {});
    // A browser that died (a crash, someone killing headless_shell) is replaced:
    // one lost level must not take the rest of the sweep with it.
    this.browser = await ensureBrowser(this.browser);
    const page = this.page = await this.browser.newPage({ viewport: { width: W, height: H } });
    // `__handWeapon` reads a rig that is mid-swap for a frame or two after a
    // spawn; a throw there is the hook's, not the page's.
    await page.addInitScript(() => {
      window.__hw = () => { try { return window.__handWeapon ? window.__handWeapon() : null; } catch { return null; } };
    });
    page.on('pageerror', e => this.errors.push({ at: Date.now(), kind: 'pageerror', text: e.message }));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/status of 404|Failed to load resource/.test(t)) return;   // reported by the response hook with the URL
      this.errors.push({ at: Date.now(), kind: 'console', text: t.slice(0, 300) });
    });
    page.on('response', r => {
      if (r.status() >= 400) this.notFound.push({ at: Date.now(), status: r.status(), url: r.url().replace(BASE, '') });
    });
    const url = `${BASE}/map.html?map=${encodeURIComponent(this.level)}&team=1&mode=${this.mode}`
      + `&mod=${modParam}&botCount=${this.bots}&shots=1`;
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.evaluate(() => document.querySelector('.ld-brief-btn')?.click());
    await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene,
      null, { timeout: 300000 });
    await page.mouse.click(5, 5).catch(() => {});   // the gesture that lets the audio context start
    await this.step(10);
    await this.ev(() => window.__setOnFoot(true));
    await this.step(10);
  }
  ev(fn, arg) { return this.page.evaluate(fn, arg); }
  async step(n) {
    for (let left = n; left > 0; left -= 60) {
      await this.page.evaluate(([c, w, h]) => { for (let i = 0; i < c; i++) window.__renderOnce(w, h); },
        [Math.min(60, left), W, H]);
    }
  }
  mark() { return { e: this.errors.length, n: this.notFound.length }; }
  since(m) {
    return {
      errors: this.errors.slice(m.e).map(e => e.text),
      notFound: this.notFound.slice(m.n).map(e => `${e.status} ${e.url}`),
    };
  }
  /** Spawn on foot at a flag of `team` (the first that has spawns). */
  async spawn(team = 1, kit = null) {
    if (!await this.ev(() => window.__deploy.open)) {
      await this.ev(() => window.__damage?.(1e6));
      for (let i = 0; i < 40 && !await this.ev(() => window.__deploy.open); i++) await this.step(30);
    }
    const ok = await this.ev(([team, kit]) => {
      const d = window.__deploy;
      if (!d.open) return 'deploy-closed';
      if (d.team !== team) d.setTeam(team);
      if (kit) d.setKit(kit);
      const f = d.flags.find(f => f.team === team && f.spawns > 0 && !f.inactive)
        || d.flags.find(f => f.spawns > 0 && !f.inactive);
      if (!f) return 'no-flag';
      d.select(f.name);
      return d.spawn() ? 'ok' : 'refused';
    }, [team, kit]);
    if (ok !== 'ok') return ok;
    await this.step(40);
    return 'ok';
  }
  async close() { await this.page?.close().catch(() => {}); this.page = null; }
}

// -------------------------------------------------------------- vehicles
// A hull's template: the one its node is tagged with (`__vehicles().template`,
// the page's `userData.control`), else its node's name less the loader's `_1`.
// The name alone lost a template that ends in digits or holds a slash, and a
// half-track or a late-mark tank was reported as an object with no model.
const norm = n => String(n).replace(/_\d+$/, '');
const tplOf = v => v.template ?? norm(v.name);
const yawOf = f => Math.atan2(f[0], f[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finite = a => a.every(Number.isFinite);

async function liveVehicles(s) {
  return s.ev(() => window.__vehicles().filter(v => v.pos && v.pos.every(Number.isFinite))
    .map(v => ({ owner: v.owner, name: v.name, template: v.template ?? null, pos: v.pos, max: v.max,
      destroyed: v.destroyed, absent: !!v.absent })));
}

// On foot and alive on `team`'s side: a man on the other side is killed and
// spawned again on this one (a vehicle is entered by the side that can stand
// where it is, `testerSide`).
async function ensureOnFoot(s, team = 1) {
  const alive = await s.ev(team => { const x = window.__soldier?.();
    return !!x && x.hp > 0 && !x.destroyed && window.__deploy.team === team; }, team);
  if (!alive) {
    await s.ev(() => window.__damage?.(1e6));
    await s.step(5);
    const r = await s.spawn(team);
    if (r !== 'ok') throw new Error(`cannot respawn: ${r}`);
  }
}

async function classify(s) {
  return s.ev(() => {
    const seat = window.__seatTable?.();
    let kind = 'static';
    if (window.__drive?.()) kind = 'ground';
    else if (window.__plane?.()) kind = window.__helm?.() ? 'ship' : 'air';
    return { kind, seat, hull: window.__hull?.() };
  });
}

async function leave(s) {
  for (let i = 0; i < 3; i++) {
    const out = await s.ev(() => window.__exitSeat?.());
    if (out) { await s.step(10); return true; }
    await s.step(5);
  }
  return false;
}

/** Enter a placed vehicle by owner id. */
async function enter(s, v, team) {
  await ensureOnFoot(s, team);
  await s.ev(([x, y, z]) => { window.__setFly(true); window.__teleport(x + 4, y + 2, z, 0); }, v.pos);
  await s.step(4);
  let ok = await s.ev(o => window.__enterOwner(o), v.owner);
  if (!ok) {
    // A gun or a hull whose root is not a seat: stand at its entry point and
    // take the seat the page offers, as the E key does.
    await s.ev(([x, y, z]) => window.__teleport(x + 1.5, y + 1, z, 0), v.pos);
    await s.step(5);
    ok = await s.ev(name => {
      const near = window.__nearEntry?.();
      const node = window.__scene.getObjectByName(name);
      return !!(node && window.__enterSeat(node, near?.seatId ?? null));
    }, v.name);
  }
  await s.step(6);
  return ok;
}

// The side that tests a hull: `team` unless a depot there hurts it (the
// page's `__killZones`: a `setHealth` or `addVehicleType` row with a negative
// rate, ledger SUP-11), then the other side, or null when both are hurt.
// A mod can fence an uncapturable base with a depot that damages the other
// side's men and hulls, and the pads there field what the base's own side
// drives: a tester of the other side dies in the seat in 15 s, as he would in
// the game, and every hull of the base reads as one that cannot be driven.
async function testerSide(s, v, tpl, team) {
  const hurt = await s.ev(([p, tpl]) => window.__killZones?.(p[0], p[1], p[2], tpl) ?? [], [v.pos, tpl]);
  if (!hurt.includes(team)) return team;
  const other = team === 1 ? 2 : 1;
  return hurt.includes(other) ? null : other;
}

function groupBy(arr, fn) { const m = new Map(); for (const a of arr) { const k = fn(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); } return m; }

// The rack builds a hull's patches one decoded sample at a time, and a headless
// software-GL page gives each await a main-thread turn at its own frame rate:
// a 14-layer fighter took 23 s on one mod's copy of a level (6 s on the
// vanilla copy of the same level, same code). So the wait is long, and the poll only sleeps:
// a render step between looks costs the page the turns the build is waiting on.
async function engineAudio(s, wantMs = 90000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < wantMs) {
    last = await s.ev(() => {
      const snap = window.__getAudioState().vehicles;
      const mine = snap?.vehicles?.filter(v => v.driven || v.claims > 0) ?? [];
      return mine.map(v => ({
        built: v.built, building: v.building, engine: v.engine
          ? { layers: v.engine.layers.length, playing: v.engine.layers.filter(l => l.playing).length,
              suspended: v.engine.suspended, voices: v.engine.voices } : null,
        engineControl: v.engineControl,
        weapons: v.weapons.map(w => ({ fireArms: w.fireArms, voices: w.voices, sources: w.sources,
          layers: w.layers?.length ?? 0, playing: (w.layers || []).filter(l => l.playing).length, started: w.started })),
      }));
    });
    if (last.length && last[0].built) return last[0];
    await sleep(400);
  }
  return last?.[0] ?? null;
}

async function testGround(s, tpl, level, rec, cls) {
  const hull0 = cls.hull;
  const baseAxes = hull0.axes;
  const p0 = hull0.pos;
  await s.ev(() => window.__keys.add('KeyW'));
  await s.step(90);
  const mid = await s.ev(() => window.__drive().state().speed);
  await s.step(240);
  const h1 = await s.ev(() => window.__hull());
  const speed = await s.ev(() => window.__drive().state().speed);
  const moved = h1 ? Math.hypot(h1.pos[0] - p0[0], h1.pos[2] - p0[2]) : 0;
  rec.moved_m = +moved.toFixed(1); rec.speed = +speed.toFixed(1);
  if (!h1 || !finite(h1.pos)) {
    add({ check: 'veh.drive', level, template_or_kit: tpl, severity: 'blocker', cause_key: 'veh.nan-state',
      evidence: `position ${JSON.stringify(h1?.pos)} after 6 s throttle` });
    rec.failed = true;
  } else if (moved < 3 && Math.max(mid, speed) < 1) {
    // Held back: one instance may sit in a revetment or against a wall; the
    // phase retries the next instance of the template before it reports.
    rec.immobile = `full throttle 6 s: moved ${moved.toFixed(1)} m, speed ${speed.toFixed(1)} m/s`;
  }
  // Wheels: nodes that look like wheels must have turned.
  const wheels = await s.ev(() => window.__wheelSpin?.());
  // Steering: D is right.
  await s.ev(() => window.__keys.add('KeyD'));
  const f0 = (await s.ev(() => window.__hull())).axes;
  // The direction is read after one second: a truck at 13 m/s that holds D for
  // 5 s comes round past 180 degrees, where the nose's projection on the old
  // right vector turns negative for a turn that went the right way.
  await s.step(30);
  const fA = (await s.ev(() => window.__hull())).axes;
  await s.step(120);
  const f1 = (await s.ev(() => window.__hull())).axes;
  const sp = await s.ev(() => window.__drive().state().speed);
  await s.ev(() => { window.__keys.delete('KeyD'); window.__keys.delete('KeyW'); });
  const turned = Math.abs(yawOf(f1.forward) - yawOf(f0.forward));
  const turnedA = Math.abs(yawOf(fA.forward) - yawOf(f0.forward));
  if (sp > 1.5 || turned > 0.05) {
    const rightward = dot3(fA.forward, f0.right);
    if (sp > 3 && turnedA > 0.1 && rightward < -0.15) {
      add({ check: 'veh.steer', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.steer-reversed',
        evidence: `D (right) turned the nose ${(rightward).toFixed(2)} along the old right vector` });
      rec.failed = true;
    } else if (sp > 3 && turned < 0.02) {
      add({ check: 'veh.steer', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.no-steer',
        evidence: `D held 2.5 s at ${sp.toFixed(1)} m/s: heading moved ${(turned * 57.3).toFixed(1)} deg` });
      rec.failed = true;
    }
  }
  // Wheels turn? read after the drive
  const w2 = await s.ev(() => window.__wheelSpin?.());
  rec.wheels = w2;
  // A tracked hull's wheel-named nodes are `Spring`/`SimpleObject` parts under
  // its `AnimatedBundle` tracks (`KV1_Top_Wheel`; vanilla Tiger's `TigerWheelL2`/`L3`):
  // the track is what turns, scrolled by the bundle, and no road wheel spins.
  if (w2 && w2.nodes >= 2 && moved > 10 && w2.turned === 0 && rec.drive !== 'TrackedVehicle') {
    add({ check: 'veh.wheels', level, template_or_kit: tpl, severity: 'minor', cause_key: 'veh.wheels-static',
      evidence: `${w2.nodes} wheel-named nodes, none rotated after ${moved.toFixed(0)} m` });
  }
}

async function testAir(s, tpl, level, rec) {
  // Ground roll first, as the player would.
  const g0 = await s.ev(() => ({ s: window.__plane().state(), h: window.__hull() }));
  await s.ev(() => window.__keys.add('KeyW'));
  await s.step(360);
  const g1 = await s.ev(() => window.__plane().state());
  const sp1 = Math.hypot(g1.velocity.x, g1.velocity.y, g1.velocity.z);
  const rolled = Math.hypot(g1.position.x - g0.s.position.x, g1.position.z - g0.s.position.z);
  rec.roll_m = +rolled.toFixed(1);
  if (!finite([g1.position.x, g1.position.y, g1.position.z])) {
    add({ check: 'air.fly', level, template_or_kit: tpl, severity: 'blocker', cause_key: 'veh.nan-state',
      evidence: 'ground roll produced a non-finite position' });
    rec.failed = true; return;
  }
  if (g1.grounded && rolled < 5 && sp1 < 2) {
    add({ check: 'air.fly', level, template_or_kit: tpl, severity: 'major', cause_key: 'air.no-throttle',
      evidence: `full throttle 6 s on the ground: moved ${rolled.toFixed(1)} m at ${sp1.toFixed(1)} m/s` });
    rec.failed = true;
  }
  // Level flight: place 400 m up, nose along its heading at 70 m/s.
  const ax = (await s.ev(() => window.__hull())).axes;
  const fw = ax.forward;
  const hz = Math.hypot(fw[0], fw[2]) || 1;
  const dir = [fw[0] / hz, 0, fw[2] / hz];
  await s.ev(([p, d]) => window.__plane().place(p.x, p.y + 400, p.z, d[0] * 70, 0, d[2] * 70),
    [g1.position, dir]);
  // Upright, level, nose along dir (three's -z forward): yaw from -z.
  const yaw = Math.atan2(-dir[0], -dir[2]);
  await s.ev(y => window.__plane().orient(0, Math.sin(y / 2), 0, Math.cos(y / 2)), yaw);
  await s.step(10);
  const a0 = await s.ev(() => ({ h: window.__hull(), s: window.__plane().state() }));
  await s.step(420);
  const a1 = await s.ev(() => ({ h: window.__hull(), s: window.__plane().state() }));
  const dy = a1.s.position.y - a0.s.position.y;
  const spd = Math.hypot(a1.s.velocity.x, a1.s.velocity.y, a1.s.velocity.z);
  const fyEnd = a1.h.axes.forward[1];
  rec.level_flight = { dy: +dy.toFixed(0), speed: +spd.toFixed(0), noseY: +fyEnd.toFixed(2) };
  if (!finite([a1.s.position.x, a1.s.position.y, a1.s.position.z])) {
    add({ check: 'air.fly', level, template_or_kit: tpl, severity: 'blocker', cause_key: 'veh.nan-state',
      evidence: 'level flight produced a non-finite position' });
    rec.failed = true; return;
  }
  if (Math.abs(fyEnd) > 0.6 || dy < -250) {
    add({ check: 'air.fly', level, template_or_kit: tpl, severity: 'major', cause_key: 'air.diverges',
      evidence: `hands off, full throttle 7 s from 70 m/s level: dy ${dy.toFixed(0)} m, nose.y ${fyEnd.toFixed(2)}, ${spd.toFixed(0)} m/s` });
    rec.failed = true;
  }
  // Control directions on a fresh level start.
  const fresh = async () => {
    await s.ev(([p, d, y]) => {
      window.__plane().place(p.x, p.y, p.z, d[0] * 80, 0, d[2] * 80);
      window.__plane().orient(0, Math.sin(y / 2), 0, Math.cos(y / 2));
    }, [a1.s.position, dir, yaw]);
    // A second of neutral flight: the previous probe left its control surfaces
    // deflected (a 0.75 s back-stick leaves the elevator up, and a no-key
    // probe that followed it saw the nose climb on its own).
    await s.step(36);
  };
  const probe = async (key, readOut) => {
    await fresh();
    const b = (await s.ev(() => window.__hull())).axes;
    if (key) await s.ev(k => window.__keys.add(k), key);
    await s.step(45);
    const a = (await s.ev(() => window.__hull())).axes;
    if (key) await s.ev(k => window.__keys.delete(k), key);
    return readOut(b, a);
  };
  // The same 0.75 s with no key at all: a hull carries its own drift (a rocket
  // motor with `setTorque` rolls its airframe over on its own), and the control is what it adds to that.
  const rel = async (key, readOut) => {
    const baseline = await probe(null, readOut);
    return (await probe(key, readOut)) - baseline;
  };
  const pitchDown = await rel('ArrowDown', (b, a) => a.forward[1] - b.forward[1]);   // back stick: nose up
  const rollRight = await rel('ArrowRight', (b, a) => a.right[1] - b.right[1]);       // right wing down: right.y falls
  const yawRight = await rel('KeyD', (b, a) => dot3(a.forward, b.right));
  rec.controls = { backStick: +pitchDown.toFixed(3), rightRoll: +rollRight.toFixed(3), rudderRight: +yawRight.toFixed(3) };
  const flagC = (key, v, expect, label, minAbs = 0.01) => {
    if (Math.abs(v) < minAbs) {
      add({ check: 'air.controls', level, template_or_kit: tpl, severity: 'major', cause_key: `air.${label}-dead`,
        evidence: `${key} for 0.75 s moved the ${label} by ${v.toFixed(4)}` });
      rec.failed = true;
    } else if (Math.sign(v) !== expect) {
      add({ check: 'air.controls', level, template_or_kit: tpl, severity: 'major', cause_key: `air.${label}-reversed`,
        evidence: `${key} moved the ${label} by ${v.toFixed(4)}, expected sign ${expect}` });
      rec.failed = true;
    }
  };
  flagC('ArrowDown (back stick)', pitchDown, 1, 'pitch');
  flagC('ArrowRight (roll right)', rollRight, -1, 'roll');
  flagC('D (rudder right)', yawRight, 1, 'yaw', 0.003);
  await s.ev(() => { for (const k of [...window.__keys]) window.__keys.delete(k); });
}

async function testShip(s, tpl, level, rec) {
  const h0 = await s.ev(() => window.__helm());
  const ship0 = await s.ev(() => window.__ships().find(x => x.control === window.__hull().template) ?? null);
  await s.ev(() => window.__keys.add('KeyW'));
  await s.step(480);
  const h1 = await s.ev(() => window.__helm());
  await s.ev(() => window.__keys.delete('KeyW'));
  rec.speed = h1 ? +h1.speed.toFixed(1) : null;
  const moved = Math.hypot(h1.x - h0.x, h1.z - h0.z);
  if (!finite([h1.x, h1.y, h1.z])) {
    add({ check: 'ship.sail', level, template_or_kit: tpl, severity: 'blocker', cause_key: 'veh.nan-state',
      evidence: 'non-finite position under throttle' });
    rec.failed = true;
  } else if (moved < 5 && !h1.aground) {
    add({ check: 'ship.sail', level, template_or_kit: tpl, severity: 'major', cause_key: 'ship.immobile',
      evidence: `full throttle 8 s: moved ${moved.toFixed(1)} m, revs ${h1.revs}, speed ${h1.speed}` });
    rec.failed = true;
  }
  if (ship0 && Math.abs(ship0.y - ship0.target) > 2) {
    add({ check: 'ship.float', level, template_or_kit: tpl, severity: 'major', cause_key: 'ship.draft-wrong',
      evidence: `y ${ship0.y} vs equilibrium ${ship0.target} on entry` });
    rec.failed = true;
  }
}

async function testSeatsAndGuns(s, tpl, level, rec, cls) {
  const seats = cls.seat?.seats ?? [];
  rec.seats = seats.length;
  // Seats reachable
  let unreachable = 0;
  for (const seat of seats) {
    if (seat.index === cls.seat.active && seats.length > 1) continue;
    const ok = await s.ev(i => { window.__switchSeat(i); return window.__seatTable().active === i; }, seat.index);
    await s.step(3);
    if (!ok) unreachable++;
  }
  if (unreachable && seats.length > 1) {
    add({ check: 'veh.seats', level, template_or_kit: tpl, severity: 'minor', cause_key: 'veh.seat-unreachable',
      evidence: `${unreachable} of ${seats.length} seats refused the number key (may be occupied by default crew)` });
  }
  // Guns and turrets per seat
  for (const seat of seats) {
    const gunSeat = seat.fireArms > 0;
    const aimSeat = seat.axes.includes('pitch') || (seat.axes.includes('yaw') && seat.kind !== 'ground');
    if (!gunSeat && !aimSeat) continue;
    if (seat.index !== (await s.ev(() => window.__seatTable().active))) {
      await s.ev(i => window.__switchSeat(i), seat.index);
      await s.step(6);
    }
    const tag = `${tpl}#seat${seat.index}(${seat.node})`;
    const rig = await s.ev(() => window.__aimSeat?.({}));
    // Turret traverse and elevation, through the real look path.
    if (rig && rig.length) {
      const aim = async (dx, dy) => {
        const before = await s.ev(() => ({ r: window.__aimSeat({}), m: window.__getFire().groups[0]?.muzzles[0]?.world ?? null,
          o: window.__hull().axes }));
        for (let i = 0; i < 6; i++) { await s.ev(([x, y]) => window.__lookDelta(x, y), [dx, dy]); await s.step(2); }
        await s.step(40);
        const after = await s.ev(() => ({ r: window.__aimSeat({}), m: window.__getFire().groups[0]?.muzzles[0]?.world ?? null,
          o: window.__hull().axes }));
        return { before, after };
      };
      for (const axis of ['yaw', 'pitch']) {
        if (!rig.find(r => r.axis === axis)) continue;
        const r = await aim(axis === 'yaw' ? 60 : 0, axis === 'pitch' ? -60 : 0);
        const a0 = r.before.r.find(x => x.axis === axis)?.angle;
        const a1 = r.after.r.find(x => x.axis === axis)?.angle;
        const moved = Math.abs((a1 ?? 0) - (a0 ?? 0));
        // Muzzle bearing change in the hull frame, when a muzzle exists.
        let dirOk = null;
        if (r.before.m && r.after.m) {
          // Each sample in its OWN hull frame. The hull is still settling or
          // creeping while the turret traverses (a light tank crept a metre, which
          // read as a reversed traverse of 2 degrees), and a bearing taken
          // against the first sample's origin and right vector charges that
          // drift to the turret.
          const frame = (m, o) => {
            const rel = [m[0] - o.origin[0], m[1] - o.origin[1], m[2] - o.origin[2]];
            const fwd = o.forward, right = o.right;
            const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2],
              right[0] * fwd[1] - right[1] * fwd[0]];
            const f = dot3(rel, fwd), r = dot3(rel, right), u = dot3(rel, up);
            return { bearing: Math.atan2(r, f), elevation: Math.atan2(u, Math.hypot(f, r)) };
          };
          const fb = frame(r.before.m, r.before.o), fa = frame(r.after.m, r.after.o);
          const delta = axis === 'yaw' ? fa.bearing - fb.bearing : fa.elevation - fb.elevation;
          // yaw: a right turn raises the bearing; pitch: mouse up raises the muzzle
          dirOk = Math.abs(delta) < 0.002 ? null : delta > 0;
        }
        rec[`${axis}_${seat.index}`] = { before: a0, after: a1, dirOk, muzzle: [r.before.m, r.after.m] };
        // Limits make a zero move legitimate only when the rig is clamped; report as minor.
        if (moved < 0.2) {
          add({ check: 'veh.turret', level, template_or_kit: tag, severity: 'minor', cause_key: `veh.${axis}-no-response`,
            evidence: `${axis} angle ${a0} -> ${a1} after 6 look deltas (clamped or dead)` });
        } else if (dirOk === false) {
          add({ check: 'veh.turret', level, template_or_kit: tag, severity: 'minor', cause_key: `veh.${axis}-reversed`,
            evidence: `${axis} look delta moved the muzzle the wrong way (${a0} -> ${a1})` });
        }
      }
    }
    // A stationary gun's carriage: A/D turns the whole mount a few degrees a
    // second (`setInputToYaw c_PIYaw` on the root bundle, seat-survey.js
    // CARRIAGE_INPUT). Recorded, not judged: only a template that declares it
    // moves, and the audit does not know which does.
    if (gunSeat && rec.kind === 'static' && seat.index === 0) {
      // The carriage bundle nearest the player's eye, its local yaw in degrees.
      const grab = () => s.ev(() => {
        const cam = window.__camera, scene = window.__scene;
        const eye = cam.getWorldPosition(new cam.position.constructor());
        let best = null, bestD = Infinity;
        scene.traverse(o => {
          if (o.userData?.templateKind !== 'RotationalBundle' || o.userData.rig?.axes?.yaw?.input !== 'c_PIYaw') return;
          const d = o.getWorldPosition(new eye.constructor()).distanceTo(eye);
          if (d < bestD) { bestD = d; best = o; }
        });
        if (!best) return null;
        const q = best.quaternion;
        return { deg: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI * 2 / 2, d: bestD };
      });
      const b = await grab();
      await s.ev(() => window.__keys.add('KeyD'));
      await s.step(60);
      await s.ev(() => window.__keys.delete('KeyD'));
      await s.step(6);
      const a = await grab();
      if (b && a) rec.carriage = { degrees: +(a.deg - b.deg).toFixed(2), eyeDistance: +a.d.toFixed(1) };
    }
    if (!gunSeat) continue;
    // Fire.
    const mk = s.mark();
    const pre = await s.ev(() => ({ g: window.__hull().guns.map(g => g.shots), fx: JSON.stringify(window.__effects()), plays: window.__effectAudio?.()?.plays ?? 0 }));
    await s.ev(() => window.__setSeatFire(true, false));
    let maxProj = 0, sound = null, hitsSeen = 0, fxPlays = 0, effectSeen = null;
    for (let i = 0; i < 30; i++) {
      await s.step(4);
      const st = await s.ev(() => ({
        p: window.__getFire().projectiles + window.__getFire().tracers.length,
        w: window.__getAudioState().vehicles?.vehicles?.filter(v => v.driven || v.claims > 0)
          .flatMap(v => v.weapons.map(w => ({ fa: w.fireArms, voices: w.voices, sources: w.sources, master: w.master, layers: w.layers?.length ?? 0 }))) ?? [],
        h: window.__getFire().hits.length + window.__getFire().impacts,
        fx: window.__effectAudio?.()?.plays ?? 0,
        loud: (() => { const a = window.__effectAudio?.(true); let best = 0, lay = null;
          for (const sc of a?.scripts || []) for (const v of sc.voices || []) for (const l of v.layers || []) {
            const out = (l.playing ? l.output : 0); if (out > best) { best = out; lay = `${l.file.split('/').pop()} d=${(+l.distance).toFixed(1)} node=${(+l.nodeGain).toFixed(3)}`; } }
          return { best, lay }; })(),
        ea: (() => { const a = window.__effectAudio?.(); return a ? { sources: a.sources, inaudible: a.inaudible, dropped: a.dropped, suspended: a.suspended,
          scripts: (a.scripts || []).filter(x => x.plays > 0).map(x => `${x.script.split('/').pop()}:${x.plays}/${x.sources}`) } : null; })(),
      }));
      if (st.ea && (st.ea.sources > 0 || st.ea.scripts.length)) effectSeen = { ...st.ea, loudest: Math.max(effectSeen?.loudest ?? 0, st.loud.best), loudLayer: st.loud.best >= (effectSeen?.loudest ?? 0) ? st.loud.lay : effectSeen?.loudLayer };
      maxProj = Math.max(maxProj, st.p); hitsSeen = Math.max(hitsSeen, st.h);
      if (!sound || st.w.some(w => w.voices > 0 || w.master > 0)) sound = st.w;
      fxPlays = Math.max(fxPlays, st.fx);
    }
    await s.ev(() => window.__setSeatFire(false, false));
    const post = await s.ev(() => ({ g: window.__hull().guns.map(g => g.shots), fx: JSON.stringify(window.__effects()) }));
    const shots = post.g.reduce((a, b) => a + b, 0) - pre.g.reduce((a, b) => a + b, 0);
    rec[`fire_${seat.index}`] = { shots, maxProj, fx: pre.fx !== post.fx, effectSound: effectSeen };
    const gunNames = (await s.ev(() => window.__hull().guns.map(g => g.name))).join(',');
    if (shots <= 0 && /binocular|spotter|periscope/i.test(`${tpl}${seat.node}${gunNames}`)) {
      rec[`fire_${seat.index}`].optic = true;       // an observer's seat: nothing to shoot
    } else if (shots <= 0) {
      add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'major', cause_key: 'veh.gun-no-fire',
        evidence: `trigger held 1.5 s: shots ${shots}; fireArms ${seat.fireArms}` });
      rec.failed = true;
    } else {
      if (maxProj === 0 && hitsSeen === 0) {
        add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'minor', cause_key: 'veh.gun-no-round',
          evidence: `${shots} shots but no projectile or tracer ever in flight` });
      }
      if (!sound?.some(w => w.voices > 0 || w.master > 0) && fxPlays <= pre.plays) {
        add({ check: 'veh.fire-sound', level, template_or_kit: tag, severity: 'major', cause_key: 'veh.gun-silent',
          evidence: `${shots} shots, no weapon voice live and no effect sound played (gun ${gunNames}; weapons ${JSON.stringify(sound)}; effect plays ${pre.plays} -> ${fxPlays})` });
        rec.failed = true;
      }
    }
    const probs = s.since(mk);
    if (probs.errors.length) {
      add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'major', cause_key: 'page.error-while-firing',
        evidence: probs.errors.slice(0, 3).join(' | ') });
    }
  }
}

async function testVehicle(s, v, tpl, level, team, rec) {
  const mk = s.mark();
  const entered = await enter(s, v, team);
  if (!entered) {
    const known = await s.ev(o => window.__vehicles().find(x => x.owner === o)?.max ?? null, v.owner);
    rec.kind = 'not-enterable';
    add({ check: 'veh.enter', level, template_or_kit: tpl,
      severity: known && known > 0 ? 'info' : 'info', cause_key: 'veh.not-enterable',
      evidence: `__enterOwner refused (hp ${known}); a static, door, crate or item rather than a hull` });
    return;
  }
  const cls = await classify(s);
  rec.kind = cls.kind;
  rec.seats = cls.seat?.seats?.length ?? 0;
  rec.drive = cls.seat?.drive ?? null;
  // Wheel spin probe, installed per entry
  await s.ev(() => {
    const root = window.__seatOccupancy?.()?.root;
    const THREE = window.__THREE;
    const nodes = [];
    if (root) root.traverse(o => { if (/wheel|whl|tyre|tire|roue|sprocket|idler/i.test(o.name)) nodes.push({ o, q: o.quaternion.clone() }); });
    window.__wheelSpin = () => ({ nodes: nodes.length,
      turned: nodes.filter(n => n.o.quaternion.angleTo(n.q) > 0.1).length });
  });
  // Engine sound
  const audio = await engineAudio(s);
  rec.engine = audio?.engine ?? null;
  // The engine of the seat that was taken: the one whose sound the driver
  // hears. An Engine deeper in the tree belongs to another seat's object (a
  // mortar's level gauge is a PlayerControlObject with a scripted, silent
  // Engine of its own), and reads as the hull's missing engine sound.
  const hasEngine = (cls.seat?.seats ?? []).some(x => x.engine && x.index === cls.seat.active);
  if (hasEngine) {
    const e = audio?.engine;
    if (!audio || !audio.built) {
      add({ check: 'veh.engine-sound', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.audio-not-built',
        evidence: `audio rack entry never built for a driven hull (${JSON.stringify(audio)})` });
      rec.failed = true;
    } else if (!e || e.layers === 0) {
      add({ check: 'veh.engine-sound', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.no-engine-sound',
        evidence: `engine audio ${JSON.stringify(e)}, engineControl ${audio.engineControl}` });
      rec.failed = true;
    }
  }
  try {
    if (cls.kind === 'ground') await testGround(s, tpl, level, rec, cls);
    else if (cls.kind === 'air') await testAir(s, tpl, level, rec);
    else if (cls.kind === 'ship') await testShip(s, tpl, level, rec);
    await testSeatsAndGuns(s, tpl, level, rec, cls);
  } finally {
    await s.ev(() => { for (const k of [...window.__keys]) window.__keys.delete(k); window.__setSeatFire?.(false, false); });
  }
  const left = await leave(s);
  if (!left) {
    add({ check: 'veh.exit', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.exit-refused',
      evidence: '__exitSeat never returned the soldier to foot' });
    rec.failed = true;
  }
  const probs = s.since(mk);
  if (probs.errors.length) {
    add({ check: 'page.errors', level, template_or_kit: tpl, severity: 'major', cause_key: 'page.error',
      evidence: [...new Set(probs.errors)].slice(0, 3).join(' | ') });
    rec.failed = true;
  }
  const own = probs.notFound.filter(x => !/favicon/.test(x) && !optional404(x));
  if (own.length) {
    add({ check: 'asset.404', level, template_or_kit: tpl, severity: 'major', cause_key: 'asset.404',
      evidence: [...new Set(own)].slice(0, 5).join(' | ') });
    rec.failed = true;
  }
}

async function testWreck(s, v, tpl, level, rec, water = null) {
  const before = await s.ev(o => window.__vehicles().find(x => x.owner === o)?.pos ?? null, v.owner);
  const r = await s.ev(o => window.__damageVehicle(o, 1e6), v.owner);
  await s.step(150);
  const after = await s.ev(o => {
    const x = window.__vehicles().find(y => y.owner === o);
    return x ? { wrecked: x.wrecked, destroyed: x.destroyed, pos: x.pos } : null;
  }, v.owner);
  const wrecks = await s.ev(() => window.__wrecks?.() ?? null);
  rec.wreck = { destroyed: r?.destroyed, wrecked: after?.wrecked };
  if (!r || !r.destroyed) return;     // an invulnerable object: not a wreck test
  // A control object that draws nothing (a paratroop or bridge spawn shell:
  // `PlayerControlObject` with no geometry and no LodObject: `AltSpawn01`,
  // `EastAxis`, `BarnSpawn`) is destroyed and has
  // nothing to leave behind: the engine's wreck is `LodSelector.hasDestroyedLod`.
  const meshless = !after?.wrecked && await s.ev(name => {
    const n = window.__scene.getObjectByName(name);
    if (!n) return false;
    let drawn = false;
    n.traverse(o => { if (o.isMesh && !o.userData?.collision) drawn = true; });
    return !drawn;
  }, v.name);
  if (meshless) { rec.wreck.meshless = true; return; }
  // Killed, and standing again whole 2.5 s on: its pad has no delay and put a
  // fresh one up (a scripted object on a `SpawnDelay 0` spawner). Whether a
  // wreck stood in between is not something this reading can say.
  if (after && !after.destroyed && !after.wrecked) { rec.wreck.respawned = true; return; }
  if (!after || !after.wrecked) {
    add({ check: 'veh.wreck', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.no-wreck',
      evidence: `destroyed but never wrecked after 2.5 s: ${JSON.stringify(after)} wrecks=${JSON.stringify(wrecks)?.slice(0, 200)}` });
    rec.failed = true;
  }
  if (after && !finite(after.pos)) {
    add({ check: 'veh.wreck', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.nan-state',
      evidence: `wreck position ${JSON.stringify(after.pos)}` });
  } else if (after && before && before[1] - after.pos[1] > 6 && !(water !== null && before[1] < water + 4)) {
    add({ check: 'veh.wreck', level, template_or_kit: tpl, severity: 'minor', cause_key: 'veh.wreck-falls-through',
      evidence: `wreck settled ${(before[1] - after.pos[1]).toFixed(1)} m below spawn` });
  }
}

async function vehiclePhase(s, level, team, summary, scene) {
  const list = await liveVehicles(s);
  // Settle: where each hull ended after the first seconds, against ~3 s later.
  await s.step(60);
  const at1 = new Map((await liveVehicles(s)).map(v => [v.owner, v.pos]));
  await s.step(180);
  const now = await liveVehicles(s);
  for (const v of now) {
    const p = at1.get(v.owner);
    if (!p) continue;
    const dh = Math.hypot(v.pos[0] - p[0], v.pos[2] - p[2]);
    const dy = v.pos[1] - p[1];
    if (dh > 1.5 || Math.abs(dy) > 1.5) {
      add({ check: 'veh.settle', level, template_or_kit: tplOf(v), severity: 'minor', cause_key: 'veh.drifts-at-rest',
        evidence: `parked hull moved ${dh.toFixed(1)} m horizontal, ${dy.toFixed(1)} m vertical in 3 s` });
    }
  }
  // Where the pad put it: a hull the pad has stood up rests on its pad, a
  // little lower than the spawner (it drops onto its springs). One that
  // stands metres off, or over, its pad was moved by the load, not the level.
  const layer = scene.gameTypes?.[s.mode]?.mode ?? s.mode;
  const pads = (scene.modes?.[layer]?.objectSpawns ?? scene.objectSpawns ?? []).filter(p => Array.isArray(p.position));
  // A ship rides at her draught, metres under the spawner that fields her.
  const afloat = new Set(await s.ev(() => (window.__ships?.() ?? []).map(x => String(x.control).toLowerCase())).catch(() => []));
  const offPad = new Map();
  for (const v of now) {
    if (v.absent || v.destroyed) continue;
    const key = tplOf(v).toLowerCase();
    let best = null;
    for (const pad of pads) {
      const names = [pad.vehicle, ...Object.values(pad.templates ?? {})].map(n => String(n ?? '').toLowerCase());
      if (!names.includes(key)) continue;
      const dh = Math.hypot(v.pos[0] - pad.position[0], v.pos[2] - pad.position[2]);
      const dy = v.pos[1] - pad.position[1];
      const d = Math.hypot(dh, dy);
      if (!best || d < best.d) best = { d, dh, dy, spawner: pad.spawner };
    }
    if (!best || (best.dh <= 4 && best.dy <= 4 && (best.dy >= -4 || afloat.has(key)))) continue;
    if (!offPad.has(key)) offPad.set(key, []);
    offPad.get(key).push(`${v.name} ${best.dh.toFixed(1)} m from ${best.spawner}, ${best.dy >= 0 ? '+' : ''}${best.dy.toFixed(1)} m`);
  }
  for (const [key, rows] of offPad) {
    add({ check: 'veh.settle', level, template_or_kit: tplOf(now.find(v => tplOf(v).toLowerCase() === key)),
      severity: 'major', cause_key: 'veh.off-its-pad',
      evidence: `stands away from its pad at load: ${rows.slice(0, 4).join('; ')}${rows.length > 4 ? ` (+${rows.length - 4})` : ''}` });
  }
  const byTpl = groupBy(now, v => tplOf(v).toLowerCase());
  let templates = [...byTpl.keys()].sort();
  if (VEHICLE_RE) templates = templates.filter(t => new RegExp(VEHICLE_RE, 'i').test(t));
  if (QUICK) {
    // One or two hulls per class (the bot unit table's own kind), then the rest by name.
    const kinds = await s.ev(() => Object.fromEntries((window.__botVehicles?.() ?? [])
      .filter(c => c.root).map(c => [String(c.template).toLowerCase(), c.kind]))).catch(() => ({}));
    const perKind = new Map();
    const chosen = [], rest = [];
    for (const t of templates) {
      const k = kinds[t] ?? kinds[tplOf(byTpl.get(t)[0]).toLowerCase()] ?? 'unknown';
      perKind.set(k, (perKind.get(k) || 0) + 1);
      (perKind.get(k) <= 2 ? chosen : rest).push(t);
    }
    templates = [...chosen, ...rest];
  }
  // Each hull's tester, and the hulls `team` can test first: one change of
  // sides a level instead of one every time the alphabet crosses a base.
  const sideOf = new Map();
  for (const t of templates) {
    const v = byTpl.get(t)[0];
    sideOf.set(t, await testerSide(s, v, tplOf(v), team));
  }
  templates = [...templates.filter(t => sideOf.get(t) === team), ...templates.filter(t => sideOf.get(t) !== team)];
  const seenKinds = new Map();
  let count = 0;
  const wreckQueue = [];
  for (const t of templates) {
    if (count >= MAX_VEHICLES) break;
    const v = byTpl.get(t)[0];
    const tpl = tplOf(v);
    const side = sideOf.get(t);
    const rec = { level, unit: 'vehicle', template: tpl, owner: v.owner, failed: false };
    if (side !== team) rec.tester = side;
    // A pad's vehicle the pad has not stood up (its side does not hold the
    // flag yet): hidden and not offered by E, driven here all the same, since
    // it is what the pad fields once the flag changes hands.
    if (v.absent) rec.pad = 'absent';
    if (offPad.has(t)) { rec.failed = true; rec.offPad = offPad.get(t).length; }
    if (modelNames.size && !modelNames.has(tpl.toLowerCase())) {
      rec.kind = 'no-model'; rec.skipped = true; tested.push(rec);
      add({ check: 'veh.model', level, template_or_kit: tpl, severity: 'info', cause_key: 'veh.no-model',
        evidence: 'a level object with no entry in models.json (a scripted effect or spawner); not driven' });
      continue;
    }
    if (side == null) {
      rec.kind = 'kill-zone'; rec.skipped = true; tested.push(rec);
      add({ check: 'veh.enter', level, template_or_kit: tpl, severity: 'info', cause_key: 'veh.in-kill-zone',
        evidence: 'a depot with a negative rate covers the hull for both sides; not driven' });
      continue;
    }
    const t0 = Date.now();
    try {
      await testVehicle(s, v, tpl, level, side, rec);
      const others = byTpl.get(t).slice(1, 3);
      if (rec.immobile) {
        let freed = false;
        for (const other of others) {
          const again = { level, unit: 'vehicle', template: tpl, owner: other.owner, failed: false };
          await testVehicle(s, other, tpl, level, side, again);
          if (!again.immobile) { freed = true; rec.retry = `instance ${other.owner} moved ${again.moved_m} m`; break; }
        }
        if (!freed) {
          add({ check: 'veh.drive', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.immobile',
            evidence: `${rec.immobile}; ${others.length + 1} instance(s) tried` });
          rec.failed = true;
        }
      }
    } catch (e) {
      rec.failed = true; rec.error = String(e.message).slice(0, 200);
      add({ check: 'harness', level, template_or_kit: tpl, severity: 'info', cause_key: 'harness.exception',
        evidence: `${rec.error}` });
      try { await s.open(); await s.spawn(side); } catch (e2) { log('reopen failed', e2.message); throw e2; }
    }
    rec.seconds = +((Date.now() - t0) / 1000).toFixed(1);
    if (rec.kind === 'not-enterable') { rec.skipped = true; }
    else {
      // In quick mode one hull per kind that has already passed is enough.
      summary.vehicles_tested++;
      if (rec.failed) summary.vehicles_failed++;
      count++;
      if (!QUICK || !seenKinds.has(rec.kind) || rec.failed) wreckQueue.push([v, tpl, rec, side]);
      seenKinds.set(rec.kind, (seenKinds.get(rec.kind) || 0) + 1);
    }
    tested.push(rec);
    if (QUICK && count >= 3) {
      // After the kinds have been seen twice each, skip the rest.
      const kinds = ['ground', 'air', 'ship', 'static'];
      if (kinds.every(k => (seenKinds.get(k) || 0) >= 2 || !(templates.length))) { /* keep going until budget */ }
    }
  }
  // Wreck pass last: it destroys what it tests.
  for (const [v, tpl, rec, side] of wreckQueue.slice(0, QUICK ? 4 : 1000)) {
    try {
      await ensureOnFoot(s, side);
      await s.ev(([x, y, z]) => window.__teleport(x + 30, y + 3, z, 0), v.pos);
      await testWreck(s, v, tpl, level, rec, scene.waterLevel ?? null);
      if (rec.failed && !tested.includes(rec)) tested.push(rec);
    } catch (e) { log('wreck failed', tpl, e.message); }
  }
  summary.vehicle_templates = templates.length;
}

// ------------------------------------------------------------------- kits
const KIT_ROWS = ['scout', 'assault', 'antitank', 'medic', 'engineer', 'slot5'];

async function clipsDuring(s, frames) {
  const seen = new Set();
  for (let i = 0; i < frames; i += 3) {
    await s.step(3);
    const c = await s.ev(() => window.__hw()?.clip ?? null);
    if (c) seen.add(c);
  }
  return [...seen];
}


const rigCache = new Map();
/** What the baked arms rig says about its own fire family (extras of the glb the
 *  extractor wrote): whether the fire clip is a loop, whether it returns to the raise
 *  (a thrown item), and whether any fire clip carries an animation at all. */
async function rigExtras(rig) {
  if (!rig) return null;
  if (rigCache.has(rig)) return rigCache.get(rig);
  let out = null;
  try {
    const root = mapsRoot.replace('/maps', '/models');
    const buf = await readFile(`${root}/viewmodels/${rig}.fp.glb`);
    const n = buf.readUInt32LE(12);
    const j = JSON.parse(buf.subarray(20, 20 + n).toString('utf8'));
    const clips = j.extras?.clips ?? {};
    const fires = Object.entries(clips).filter(([k]) => /^fire\d*$/.test(k));
    const live = fires.filter(([, v]) => v && v.upperClip);
    const fire = clips.fire && clips.fire.upperClip ? clips.fire : (live[0]?.[1] ?? null);
    out = {
      animations: (j.animations ?? []).map(a => a.name),
      fireLoop: !!fire?.loop,
      thrower: !!j.extras?.weaponStats?.throw || /raiseweapon/i.test(fire?.returnTo ?? ''),
      fireAbsent: fires.length > 0 && live.length === 0,
      hasFire: !!fire,
    };
  } catch { out = null; }
  rigCache.set(rig, out);
  return out;
}

/** Where the weapon sits in each hand bone's frame (position and orientation): the weld
 *  the arms rig is built on. A recoil or an animation that moves the hands moves both
 *  together; a clip authored off the weld lets the gun leave them. */
async function weaponInHands(s) {
  return s.ev(() => {
    const hr = window.__handRig?.();
    if (!hr || !hr.rig || !hr.weapon) return null;
    const THREE = window.__THREE;
    hr.rig.updateWorldMatrix(true, true);
    const hands = {};
    hr.rig.traverse(o => {
      const m = /(?:^|[ _])([LR])[ _]?Hand$/i.exec(o.name || '');
      if (m && o.isBone !== false) hands[m[1].toUpperCase()] = o;
    });
    hr.weapon.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    hr.weapon.matrixWorld.decompose(wp, wq, ws);
    const out = {};
    for (const [k, h] of Object.entries(hands)) {
      h.updateWorldMatrix(true, false);
      const inv = h.matrixWorld.clone().invert();
      const p = wp.clone().applyMatrix4(inv);
      const hq = new THREE.Quaternion(), hp = new THREE.Vector3(), hs = new THREE.Vector3();
      h.matrixWorld.decompose(hp, hq, hs);
      const q = hq.invert().multiply(wq);
      out[k] = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
    }
    const cam = window.__camera;
    cam.updateMatrixWorld(true);
    const c = wp.clone().applyMatrix4(cam.matrixWorld.clone().invert());
    out.cam = { p: [c.x, c.y, c.z] };
    return out;
  });
}
const angleBetween = (a, b) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
};
/** Largest departure from `rest` over the samples, as the better of the hands:
 *  { pos_m, rot_rad } (null when the rig has no hand bones). */
function weldDeviation(rest, samples) {
  if (!rest) return null;
  let best = null;
  for (const hand of ['L', 'R']) {
    if (!rest[hand]) continue;
    let pos = 0, rot = 0;
    for (const smp of samples) {
      if (!smp?.[hand]) continue;
      const a = rest[hand].p, b = smp[hand].p;
      pos = Math.max(pos, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      rot = Math.max(rot, angleBetween(rest[hand].q, smp[hand].q));
    }
    if (!best || pos < best.pos_m) best = { pos_m: pos, rot_rad: rot, hand };
  }
  return best && { pos_m: +best.pos_m.toFixed(3), rot_rad: +best.rot_rad.toFixed(2), hand: best.hand };
}
async function stepDt(s, n, dt) {
  for (let left = n; left > 0; left -= 60) {
    await s.page.evaluate(([c, w, h, d]) => { for (let i = 0; i < c; i++) window.__renderOnce(w, h, d); },
      [Math.min(60, left), W, H, dt]);
  }
}

const WELD_POS_M = Number(arg('weld-pos', 0.04));
const WELD_ROT_RAD = Number(arg('weld-rot', 0.5));

async function testWeapon(s, level, row, team, slot, rec, primary) {
  const tag = `${row}@t${team}:${slot.weapon}`;
  // A satchel or a grenade thrown at the man's own feet is how a kit test dies; the
  // rest of the kit is then tested on a fresh life, not against a corpse.
  for (let tries = 0; tries < 3; tries++) {
    const alive = await s.ev(() => { const q = window.__soldier?.(); return !!q && q.hp > 0; });
    if (alive) break;
    await s.ev(() => window.__damage?.(1e6));
    await s.step(8);
    await s.spawn(team, row);
    for (let i = 0; i < 40; i++) {
      const h = await s.ev(() => window.__hw());
      if (h?.viewmodel) break;
      await s.step(5); await sleep(150);
    }
    await stepDt(s, 60, 1 / 30);
  }
  // A select is dropped while the weapon in hand runs its fire cycle (ledger
  // FA-9): a Bazooka's second after its rocket. Ask until it is taken.
  for (let i = 0; i < 50 && !await s.ev(n => window.__selectKitWeapon(n), slot.slot); i++) {
    await stepDt(s, 3, 1 / 30);
  }
  let w = null, stable = 0;
  // The arms rig arrives from a fetch: wait on real time as well as frames, and
  // for two polls in a row, or the first shot lands on a placeholder.
  for (let i = 0; i < 60 && stable < 2; i++) {
    await stepDt(s, 6, 1 / 30);
    w = await s.ev(() => window.__hw());
    if (w && w.name === slot.weapon && w.viewmodel) stable++; else { stable = 0; await sleep(120); }
  }
  await stepDt(s, QUICK ? 40 : 70, 1 / 30);      // the raise clip settles
  w = await s.ev(() => window.__hw());
  const wr = { slot: slot.slot, weapon: slot.weapon, name: w?.name, rig: w?.rig, viewmodel: w?.viewmodel,
    rigVisible: w?.rigVisible, hasGroup: w?.hasGroup };
  rec[`w_${slot.slot}`] = wr;
  if (!w || w.name !== slot.weapon) {
    const diag = await s.ev(() => ({ locked: window.__soldier()?.itemsLocked, hand: window.__kitRotation().handSlot,
      swimming: window.__soldier()?.swimming, hp: window.__soldier()?.hp }));
    add({ check: 'kit.select', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.weapon-not-raised',
      evidence: `selecting slot ${slot.slot} left ${w?.name ?? 'nothing'} in hand (${JSON.stringify(diag)})` });
    rec.failed = true; return;
  }
  if (!w.viewmodel || !w.rigVisible) {
    add({ check: 'kit.rig', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.no-first-person-rig',
      evidence: `viewmodel ${w.viewmodel}, rigVisible ${w.rigVisible}, rig ${w.rig}` });
    rec.failed = true;
  }
  if (!w.hasGroup) { wr.noGun = true; return; }       // a tool: nothing to fire
  // A gun fires the barrels its own template declares and no other FireArms'.
  for (const [what, g] of [['the weapon', w], ['its alternate fire', w.alt]]) {
    if (g && g.declaredBarrels > 0 && g.barrels !== g.declaredBarrels) {
      add({ check: 'kit.barrels', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.weapon-foreign-barrels',
        evidence: `${what} was collected with ${g.barrels} barrels and its template declares ${g.declaredBarrels}: one pull fires them all` });
      rec.failed = true;
    }
  }
  // The alternate fire (a bayonet's or a knife's stab on the right button):
  // its swing owns the arms, its round leaves, and the magazine is not billed.
  if (w.alt && (!QUICK || primary)) {
    const altClips = new Set();
    const before = await s.ev(() => window.__hw());
    await s.ev(() => window.__pressAltFire?.());
    for (let i = 0; i < 20; i++) {
      await stepDt(s, 2, 1 / 30);
      const c = await s.ev(() => window.__hw()?.clip); if (c) altClips.add(c);
    }
    const after = await s.ev(() => window.__hw());
    wr.alt = { name: w.alt.name, clips: [...altClips], shots: (after?.alt?.shots ?? 0) - before.alt.shots,
      rounds: [before.rounds, after?.rounds] };
    const swung = [...altClips].some(c => w.alt.clips.includes(c));
    const problems = [];
    if (w.alt.clips.length && !swung) problems.push(`the rig bakes ${w.alt.clips} and the arms played ${[...altClips]}`);
    if (wr.alt.shots <= 0) problems.push('no round left the alternate FireArms');
    if (after && after.rounds !== before.rounds) problems.push(`the magazine went ${before.rounds} -> ${after.rounds}`);
    if (after && after.shots !== before.shots) problems.push(`the primary fired ${after.shots - before.shots} round(s)`);
    if (problems.length) {
      add({ check: 'kit.alt-fire', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.alt-fire-not-played',
        evidence: `${w.alt.name} on the right button: ${problems.join('; ')}` });
      rec.failed = true;
    }
    await stepDt(s, 45, 1 / 30);                      // the stab's cycle runs out
    w = await s.ev(() => window.__hw());
  }
  if (QUICK && !primary) return;
  const rx = await rigExtras(w.rig);
  const rest = await weaponInHands(s);
  const rounds0 = w.rounds, shots0 = w.shots;
  const clips = new Set([w.clip]);
  const samples = [];
  await s.ev(() => window.__setTrigger(true));
  for (let i = 0; i < 15; i++) {
    await stepDt(s, 3, 1 / 30);
    samples.push(await weaponInHands(s));
    const c = await s.ev(() => window.__hw()?.clip); if (c) clips.add(c);
  }
  await s.ev(() => window.__setTrigger(false));
  await stepDt(s, 10, 1 / 30);
  let w2 = await s.ev(() => window.__hw());
  for (let i = 0; i < 10 && !w2; i++) { await stepDt(s, 6, 1 / 30); await sleep(100); w2 = await s.ev(() => window.__hw()); }
  let fired = (w2?.shots ?? 0) - shots0;
  const dev = weldDeviation(rest, samples);
  wr.fired = fired; wr.rounds = [rounds0, w2?.rounds]; wr.weld = dev; wr.clips = [...clips];
  if (fired <= 0 && Number.isFinite(rounds0) && (w2?.rounds ?? 0) >= rounds0 && !w2?.reloading) {
    // One more try on a settled rig before it is reported: a throw that follows
    // another item's throw has been seen to swallow its first pull.
    await stepDt(s, 40, 1 / 30);
    const again0 = (await s.ev(() => window.__hw()))?.shots ?? 0;
    await s.ev(() => window.__setTrigger(true));
    await stepDt(s, 45, 1 / 30);
    await s.ev(() => window.__setTrigger(false));
    await stepDt(s, 10, 1 / 30);
    const w3 = await s.ev(() => window.__hw());
    if ((w3?.shots ?? 0) > again0) { fired = (w3.shots - again0); w2 = w3; wr.retried = true; }
  }
  if (fired <= 0 && Number.isFinite(rounds0) && (w2?.rounds ?? 0) >= rounds0 && !w2?.reloading) {
    add({ check: 'kit.fire', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.weapon-no-fire',
      evidence: `trigger held 0.5 s: shots ${fired}, rounds ${rounds0} -> ${w2?.rounds}` });
    rec.failed = true;
  } else if (fired <= 0 && !Number.isFinite(rounds0)) {
    wr.tool = true;                                  // binoculars, a radio: a group with no rounds to spend
  }
  // A thrown item (its fire state returns to the raise) leaves the hand by design.
  if (fired > 0 && dev && !rx?.thrower && (dev.pos_m > WELD_POS_M || dev.rot_rad > WELD_ROT_RAD)) {
    add({ check: 'kit.recoil', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.weapon-leaves-hands',
      evidence: `weapon moved ${(dev.pos_m * 100).toFixed(0)} cm / ${(dev.rot_rad * 57.3).toFixed(0)} deg off the ${dev.hand} hand's weld while firing` });
    rec.failed = true;
  }
  if (fired > 0 && clips.size <= 1) {
    if (rx?.fireAbsent) {
      add({ check: 'kit.fire-anim', level, template_or_kit: tag, severity: 'info', cause_key: 'kit.fire-clip-absent-from-install',
        retail_faithful: true,
        evidence: 'the weapon\'s fire states name 1p clips that are in no archive of the mod chain, so the rig bakes none (extras clips fire/fire1..5 empty)' });
    } else if (rx?.fireLoop && fired <= 2) {
      add({ check: 'kit.fire-anim', level, template_or_kit: tag, severity: 'info', cause_key: 'kit.semi-auto-loop-fire',
        retail_faithful: true,
        evidence: `a semi-auto weapon on a looping fire clip: group.firing is true for the tick of a shot and the loop returns to _POSE_ on release (ledger BODY-8, FireEnd never entered); ${fired} shot(s) per held trigger` });
    } else {
      add({ check: 'kit.fire-anim', level, template_or_kit: tag, severity: 'minor', cause_key: 'kit.no-fire-clip',
        evidence: `arms clip never changed while firing (${[...clips]})` });
    }
  }
  // Zoomed.
  if ((!QUICK || primary) && !rx?.thrower) {
    await s.ev(() => window.__setAim?.(true));
    await stepDt(s, 30, 1 / 30);
    const z = await s.ev(() => window.__hw());
    const restZ = await weaponInHands(s);
    const zs = [];
    await s.ev(() => window.__refill?.());
    await s.ev(() => window.__setTrigger(true));
    for (let i = 0; i < 6; i++) { await stepDt(s, 3, 1 / 30); zs.push(await weaponInHands(s)); }
    await s.ev(() => { window.__setTrigger(false); window.__setAim?.(false); });
    await stepDt(s, 15, 1 / 30);
    const zd = weldDeviation(restZ, zs);
    wr.zoomed = z?.zoomed; wr.zoomFov = z?.fovFactor; wr.zoomWeld = zd;
    if (zd && (zd.pos_m > WELD_POS_M || zd.rot_rad > WELD_ROT_RAD)) {
      add({ check: 'kit.recoil', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.weapon-leaves-hands',
        evidence: `zoomed: weapon moved ${(zd.pos_m * 100).toFixed(0)} cm / ${(zd.rot_rad * 57.3).toFixed(0)} deg off the ${zd.hand} hand's weld while firing` });
      rec.failed = true;
    }
  }
  // Reload from an empty magazine.
  if (Number.isFinite(rounds0) && rounds0 > 0 && (!QUICK || primary) && !rx?.thrower) {
    const mags = w2?.mags > 0 ? w2.mags : 2;
    await s.ev(m => window.__setAmmo(0, m), mags);
    await stepDt(s, 4, 1 / 30);
    // The reload key. Nothing reloads a dry magazine unasked unless the
    // weapon says `autoReload` (ledger FA-7), and the Garand's clip takes its
    // `ejectClipTime` to go before the ask is taken.
    for (let i = 0; i < 12 && !await s.ev(() => window.__reload?.() || window.__hw()?.reloading); i++) {
      await stepDt(s, 3, 1 / 30);
    }
    const rc = new Set();
    let refilled = false, sawReloading = false;
    for (let i = 0; i < 30; i++) {
      await stepDt(s, 6, 1 / 30);
      const x = await s.ev(() => window.__hw());
      if (x?.clip) rc.add(x.clip);
      if (x?.reloading) sawReloading = true;
      if ((x?.rounds ?? 0) > 0) { refilled = true; break; }
    }
    wr.reload = { refilled, sawReloading, clips: [...rc] };
    if (!refilled) {
      add({ check: 'kit.reload', level, template_or_kit: tag, severity: 'major', cause_key: 'kit.reload-never-completes',
        evidence: `magazine emptied, R pressed, 6 s later rounds still 0 (reloading seen ${sawReloading}, clips ${[...rc]})` });
      rec.failed = true;
    } else if (rc.size <= 1) {
      add({ check: 'kit.reload', level, template_or_kit: tag, severity: 'minor', cause_key: 'kit.no-reload-clip',
        evidence: `reload completed with no arms clip change (${[...rc]})` });
    }
  }
  await s.ev(() => window.__refill?.());
}

async function testKit(s, level, team, row, rec) {
  const mk = s.mark();
  await s.ev(() => window.__damage?.(1e6));
  await s.step(8);
  const r = await s.spawn(team, row);
  if (r !== 'ok') { rec.skipped = true; rec.reason = r; return; }
  const loadout = await s.ev(() => ({ kit: window.__deploy.kit, l: window.__deploy.loadout }));
  rec.loadout = loadout.l?.kit ?? loadout.kit;
  let hw = null;
  for (let i = 0; i < 40; i++) {
    hw = await s.ev(() => window.__hw());
    if (hw?.viewmodel) break;
    await s.step(5); await sleep(150);
  }
  const slots = await s.ev(() => window.__kitRotation().slots ?? []);
  rec.slots = slots.map(x => x.weapon);
  if (!slots.length) {
    add({ check: 'kit.slots', level, template_or_kit: `${row}@t${team}`, severity: 'blocker', cause_key: 'kit.no-weapons',
      evidence: `spawned kit ${row} for team ${team} carries no weapon slots` });
    rec.failed = true; return;
  }
  await stepDt(s, 120, 1 / 30);        // the deploy clip finishes
  // The fire test runs on the weapon the kit spawns holding.
  const holding = (await s.ev(() => window.__hw()))?.name;
  for (const slot of slots) {
    await testWeapon(s, level, row, team, slot, rec, slot.weapon === holding);
  }
  const probs = s.since(mk);
  if (probs.errors.length) {
    add({ check: 'page.errors', level, template_or_kit: `${row}@t${team}`, severity: 'major', cause_key: 'page.error',
      evidence: [...new Set(probs.errors)].slice(0, 3).join(' | ') });
    rec.failed = true;
  }
  const own = probs.notFound.filter(x => !/favicon/.test(x) && !optional404(x));
  if (own.length) {
    add({ check: 'asset.404', level, template_or_kit: `${row}@t${team}`, severity: 'major', cause_key: 'asset.404',
      evidence: [...new Set(own)].slice(0, 5).join(' | ') });
    rec.failed = true;
  }
}

async function kitRowsOf(level) {
  try {
    const l = JSON.parse(await readFile(`${mapsRoot}/_shared/loadouts.json`, 'utf8'));
    const lv = l.levels?.[level.toLowerCase()] ?? l.levels?.[level] ?? null;
    if (!lv) return null;
    const rows = {};
    for (const team of [1, 2]) {
      const slots = lv[String(team)]?.slots ?? {};
      rows[team] = Object.keys(slots).map(Number).sort((a, b) => a - b).map(i => KIT_ROWS[i]).filter(Boolean);
    }
    return rows;
  } catch { return null; }
}

async function kitPhase(s, level, summary) {
  const teams = [1, 2];
  const table = await kitRowsOf(level);
  for (const team of teams) {
    for (const row of (table?.[team] ?? KIT_ROWS.slice(0, 5))) {
      const rec = { level, unit: 'kit', team, row, failed: false };
      const t0 = Date.now();
      try {
        await testKit(s, level, team, row, rec);
      } catch (e) {
        rec.failed = true; rec.error = String(e.message).slice(0, 200);
        add({ check: 'harness', level, template_or_kit: `${row}@t${team}`, severity: 'info',
          cause_key: 'harness.exception', evidence: rec.error });
        try { await s.open(); } catch (e2) { throw e2; }
      }
      rec.seconds = +((Date.now() - t0) / 1000).toFixed(1);
      if (!rec.skipped) { summary.kits_tested++; if (rec.failed) summary.kits_failed++; }
      tested.push(rec);
    }
  }
}

// ----------------------------------------------------- spawns and flags
async function spawnPhase(s, level, scene, summary) {
  const spawns = (scene.soldierSpawns || []).filter(p => p.position);
  const sample = spawns.filter((_, i) => i % Math.max(1, Math.ceil(spawns.length / (QUICK ? 12 : 80))) === 0);
  let bad = 0;
  for (const sp of sample) {
    const [x, y, z] = sp.position;
    await s.ev(([x, y, z]) => { window.__teleport(x, y, z, 0); }, [x, y, z]);
    const a = await s.ev(() => { const q = window.__soldier(); return { y: q.y, ground: q.ground, grounded: q.grounded }; });
    await s.step(20);
    const b = await s.ev(() => { const q = window.__soldier(); return { y: q.y, ground: q.ground, grounded: q.grounded, swim: q.swimming, hp: q.hp }; });
    // A floor above the terrain (a house, a bunker) is a floor: what matters is that
    // the man stands on something, does not fall, and is not under the terrain.
    const fell = a.y - b.y;
    let why = null;
    if (![a.y, b.y].every(Number.isFinite)) why = 'non-finite height';
    else if (fell > 1.5) why = `fell ${fell.toFixed(1)} m in 0.3 s (spawn hangs in the air)`;
    else if (b.y < b.ground - 1.0) why = `feet ${b.y.toFixed(1)} m are under the terrain ${b.ground.toFixed(1)} m`;
    else if (!b.grounded) why = 'not grounded after settling';
    if (why) {
      bad++;
      add({ check: 'spawn.ground', level, template_or_kit: sp.name ?? sp.spawner ?? `spawn@${x.toFixed(0)},${z.toFixed(0)}`,
        severity: 'major', cause_key: 'spawn.not-on-ground', evidence: `spawn at ${[x, y, z].map(n => n.toFixed(1))}: ${why}` });
    }
  }
  summary.spawns_sampled = sample.length; summary.spawns_bad = bad;
}

/** Stand a soldier on each flag long enough for the law (bot-referee.js `controlPointStep`,
 *  ledger AI-142, FHR-1, FHR-4) to run, and compare the owner afterwards with what the
 *  law itself says for the same flag settings. */
async function flagPhase(s, level, team, summary) {
  const flags = await s.ev(() => (window.__world?.()?.flags ?? []).map((f, i) => ({
    i, name: f.name, team: f.team, pos: f.position ?? f.pos ?? null,
    get: f.timeToGetControl, lose: f.timeToLoseControl, only: f.onlyTakeableByTeam, fixed: !!f.uncapturable })));
  summary.flags = flags.length;
  const sample = QUICK ? flags.slice(0, 2) : flags;
  for (const f of sample) {
    if (!f.pos) continue;
    const seconds = Math.min(60, (Number.isFinite(f.lose) ? f.lose : 5) + (Number.isFinite(f.get) ? f.get : 5) + 4);
    const expected = await s.ev(async ([f, team, seconds]) => {
      const law = await import('./bot-referee.js');
      const flag = { ...(window.__world().flags[f.i]), _cp: undefined };
      for (let t = 0; t < seconds; t += 1 / 30) law.controlPointStep(flag, [team], 1 / 30);
      return flag.team ?? 0;
    }, [f, team, seconds]);
    await ensureOnFoot(s, team);
    await s.ev(([p]) => { window.__setFly(true); window.__teleport(p[0], p[1] + 0.5, p[2], 0); }, [f.pos]);
    const frames = Math.ceil(seconds / 0.1);
    for (let left = frames; left > 0; left -= 60) {
      await s.ev(([c, w, h]) => { for (let i = 0; i < c; i++) window.__renderOnce(w, h, 0.1); }, [Math.min(60, left), W, H]);
      const q = await s.ev(() => { const x = window.__soldier(); return x.hp > 0; });
      if (!q) break;
    }
    const after = await s.ev(i => window.__world().flags[i].team ?? 0, f.i);
    const rec = { level, unit: 'flag', flag: f.name, team0: f.team, expected, after, seconds, failed: false };
    if (after !== expected) {
      add({ check: 'flag.capture', level, template_or_kit: f.name, severity: 'major', cause_key: 'flag.law-mismatch',
        evidence: `team ${team} stood on it ${seconds} s: owner ${f.team} -> ${after}, the control-point law says ${expected} (get ${f.get}, lose ${f.lose}, only ${f.only}, fixed ${f.fixed})` });
      rec.failed = true;
    }
    tested.push(rec);
  }
}

// ------------------------------------------------------------------- bots
async function botPhase(browser, level, mode, summary) {
  const s = new Session(browser, level, mode, 8);
  await s.open();
  const r = await s.spawn(1);
  await s.step(120);
  await sleep(3000);
  const total = BOT_SECONDS;
  const samples = [];
  const take = async () => samples.push(await s.ev(() => (window.__bots?.() ?? []).map(b => ({
    id: b.id ?? b.name, p: b.pos ?? null, vehicle: b.vehicle ?? null, stalled: b.stalledTicks ?? 0, behaviour: b.behaviour ?? null }))));
  const mk = s.mark();
  for (let t = 0; t < total; t += 10) {
    await take();
    await s.step(600);
  }
  await take();
  const first = samples[0], last = samples[samples.length - 1];
  summary.bots = first.length;
  const mounted = new Set();
  for (const smp of samples) for (const b of smp) if (b.vehicle) mounted.add(b.vehicle);
  summary.bot_vehicles = [...mounted];
  if (!first.length) {
    add({ check: 'bots.present', level, template_or_kit: '-', severity: 'major', cause_key: 'bots.none-spawned',
      evidence: 'botCount=8 produced no bots' });
  } else {
    let still = 0;
    for (const b of first) {
      const track = samples.map(x => x.find(y => y.id === b.id)?.p).filter(Boolean);
      if (track.length < 2) continue;
      let travelled = 0;
      for (let i = 1; i < track.length; i++) travelled += Math.hypot(track[i][0] - track[i - 1][0], track[i][2] - track[i - 1][2]);
      if (travelled < 8) still++;
    }
    summary.bots_stalled = still;
    if (still >= Math.max(3, first.length / 2)) {
      add({ check: 'bots.move', level, template_or_kit: '-', severity: 'major', cause_key: 'bots.stalled',
        evidence: `${still} of ${first.length} bots travelled under 8 m in ${total} s` });
    }
  }
  const probs = s.since(mk);
  if (probs.errors.length) {
    add({ check: 'page.errors', level, template_or_kit: 'bots', severity: 'major', cause_key: 'page.error',
      evidence: [...new Set(probs.errors)].slice(0, 3).join(' | ') });
  }
  await s.close();
}

// ------------------------------------------------------------------ main
let currentBrowser = null;
async function launchBrowser() {
  currentBrowser = await chromium.launch({
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  });
  return currentBrowser;
}
async function ensureBrowser(b) {
  if (currentBrowser && currentBrowser.isConnected()) return currentBrowser;
  log('browser is gone; relaunching');
  return launchBrowser();
}
async function main() {
  let server = null;
  if (!arg('url', null)) {
    server = spawn('python3', [resolve(HERE, 'serve_viewer.py'), String(PORT)], { stdio: 'ignore' });
    await sleep(1200);
  }
  await loadManifest();
  const levels = await levelList();
  if (!levels.length) { log('no levels matched'); process.exit(2); }
  const browser = await launchBrowser();
  const summaries = [];
  try {
    for (const level of levels) {
      const t0 = Date.now();
      const scene = await sceneOf(level);
      const mode = pickMode(scene);
      const summary = { level, mode, vehicles_tested: 0, vehicles_failed: 0, kits_tested: 0, kits_failed: 0, duration_s: 0 };
      log('level', level, mode);
      const s = new Session(browser, level, mode, 0);
      // Each phase gets two tries on a fresh page: a crashed renderer or a lost
      // context is the harness's, and must neither pass the level nor end it.
      const phases = [];
      if (ONLY.has('vehicles')) phases.push(['vehicles', () => vehiclePhase(s, level, 1, summary, scene)]);
      if (ONLY.has('spawns')) phases.push(['spawns', async () => { await ensureOnFoot(s, 1); await spawnPhase(s, level, scene, summary); }]);
      if (ONLY.has('flags')) phases.push(['flags', async () => { await ensureOnFoot(s, 1); await flagPhase(s, level, 1, summary); }]);
      if (ONLY.has('kits')) phases.push(['kits', async () => { await ensureOnFoot(s, 1); await kitPhase(s, level, summary); }]);
      for (const [name, run] of phases) {
        let lastError = null, mark = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (!s.page || attempt > 0) {
              await s.open();
              const r = await s.spawn(1);
              if (r !== 'ok') throw new Error(`deploy refused: ${r}`);
            }
            mark = { f: findings.length, t: tested.length, sum: { ...summary } };
            await run();
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            if (mark) { findings.length = mark.f; tested.length = mark.t; Object.assign(summary, mark.sum); }   // a retry starts the phase afresh
            log(`${level}: phase ${name} attempt ${attempt + 1} failed: ${String(e.message).split('\n')[0]}`);
            try { await s.page?.close(); } catch { /* gone */ }
            s.page = null;
          }
        }
        if (lastError) {
          add({ check: 'harness.phase', level, template_or_kit: name, severity: 'major', cause_key: 'harness.phase-aborted',
            evidence: String(lastError.message).split('\n')[0].slice(0, 300) });
        }
      }
      await s.close();
      if (ONLY.has('bots')) {
        try { await botPhase(browser, level, mode, summary); }
        catch (e) { add({ check: 'bots.run', level, template_or_kit: '-', severity: 'info', cause_key: 'harness.exception', evidence: String(e.message).slice(0, 200) }); }
      }
      summary.duration_s = Math.round((Date.now() - t0) / 1000);
      summaries.push(summary);
      log('done', JSON.stringify(summary));
      if (OUT) await writeFile(OUT, JSON.stringify({ mod: MOD, quick: QUICK, levels: summaries, findings, tested }, null, 1));
    }
  } finally {
    await currentBrowser?.close().catch(() => {});
    server?.kill();
  }
  const blocking = findings.filter(f => (f.severity === 'blocker' || f.severity === 'major') && !f.accepted);
  const out = { mod: MOD, quick: QUICK, levels: summaries, findings, tested };
  if (OUT) { await mkdir(dirname(resolve(OUT)), { recursive: true }); await writeFile(OUT, JSON.stringify(out, null, 1)); }
  const by = {};
  for (const f of findings) by[`${f.severity}:${f.cause_key}`] = (by[`${f.severity}:${f.cause_key}`] || 0) + 1;
  console.log(JSON.stringify({ levels: summaries, causes: by, blocking: blocking.length }, null, 1));
  process.exit(blocking.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
