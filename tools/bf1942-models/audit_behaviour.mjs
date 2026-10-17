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
import { rightTurn, steerVerdict, SETTLE_RATE, heldByData } from './audit_verdicts.mjs';

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
// Rounds of six look deltas the turret check gives a gun before it calls the
// axis dead (`testSeatsAndGuns`).
const SLOW_AIM_ROUNDS = 5;

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
// `--static`, else the pipeline's v_static output for the tree (`static/sound.json`,
// where `mod_pipeline.py` writes it since the fast static pass), else the old
// gate's combined file. Until 2026-10-16 only the last was read, and
// v_behaviour_new never had it: a B4howitzer whose engine script is in
// no archive (`engine-script-unusable-in-install`), read as a hull gone silent.
const STATIC_FILE = arg('static', [
  resolve(HERE, `out/mod-pipeline/${MOD}/static/sound.json`),
  resolve(HERE, `out/mod-pipeline/${MOD}/gates/static.json`),
].find(existsSync) ?? resolve(HERE, `out/mod-pipeline/${MOD}/gates/static.json`));
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
    // Every killing blow, with the frames that dealt it: what a harness
    // exception's whereabouts names when the tester died in his seat.
    await page.evaluate(async () => {
      const { Armor } = await import('./armor.js');
      window.__killBlows = [];
      // `damage` and `setHitPoints` are the two ways to 0 (`applyDamage`
      // calls the first).
      for (const name of ['damage', 'setHitPoints']) {
        const inner = Armor.prototype[name];
        Armor.prototype[name] = function (value) {
          const was = this.hitPoints;
          const out = inner.call(this, value);
          if (was > 0 && !(this.hitPoints > 0)) {
            const at = String(new Error().stack).split('\n').slice(2, 7)
              .map(l => l.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\//, '').replace(/\)$/, ''));
            window.__killBlows.push({ by: name, value: +(+value).toFixed(2), max: this.maxHitPoints, at });
            if (window.__killBlows.length > 64) window.__killBlows.shift();
          }
          return out;
        };
      }
    }).catch(() => {});
    await page.mouse.click(5, 5).catch(() => {});   // the gesture that lets the audio context start
    await this.step(10);
    await this.ev(() => window.__setOnFoot(true));
    await this.step(10);
  }
  ev(fn, arg) { return this.page.evaluate(fn, arg); }
  async step(n) {
    for (let left = n; left > 0; left -= 60) {
      await this.page.evaluate(([c, w, h]) => {
        for (let i = 0; i < c; i++) {
          window.__pin?.();       // `pinAircraft`
          window.__renderOnce(w, h);
          // `seatWatch` (set while a hull is under test): the first frame the
          // tester is out of his seat, and what he and the world looked like.
          const sw = window.__seatWatch;
          if (sw && !sw.left && !window.__hull?.()) {
            const me = window.__soldier?.();
            const v = window.__vehicles?.().find(x => x.owner === sw.owner);
            sw.left = { frame: sw.frames, soldierHp: me?.hp ?? null, soldierDestroyed: me?.destroyed ?? null,
              outsideFor: me?.outsideFor ?? null, hullHp: v?.hp ?? null, hullDestroyed: !!v?.destroyed,
              hullPos: v?.pos ?? null, last: sw.last };
          }
          if (sw && !sw.left) {
            const h = window.__hull?.();
            sw.last = h ? { pos: h.axes.origin.map(n => +n.toFixed(1)), speed: h.speed == null ? null : +h.speed.toFixed(1),
              noseY: +h.axes.forward[1].toFixed(2), rightY: +h.axes.right[1].toFixed(2) } : null;
          }
          if (sw) sw.frames++;
        }
      }, [Math.min(60, left), W, H]);
    }
  }
  mark() { return { e: this.errors.length, n: this.notFound.length }; }
  since(m) {
    return {
      errors: this.errors.slice(m.e).map(e => e.text),
      notFound: this.notFound.slice(m.n).map(e => `${e.status} ${e.url}`),
    };
  }
  /** The deploy screen up: kill the soldier if he lives, and wait out the end
   *  of a round. An objective the tests completed (a wreck pass that sinks a
   *  side's carriers on an ObjectiveMode level, OBJ-2, OBJ-3) ends the round,
   *  and nobody deploys until the restart (ROUND-11); the restart puts the
   *  player back on the spawn screen only when he was playing as it ended. */
  async openDeploy() {
    if (await this.ev(() => window.__deploy.open)) return true;
    await this.ev(() => window.__damage?.(1e6));
    for (let i = 0; i < 40 && !await this.ev(() => window.__deploy.open); i++) await this.step(30);
    for (let i = 0; i < 60 && !await this.ev(() => window.__deploy.open); i++) {
      const r = await this.ev(() => window.__round?.() ?? null);
      if (r?.status === 'playing') {
        await this.ev(() => window.__setOnFoot(false));
        await this.step(2);
        await this.ev(() => window.__setOnFoot(true));
      }
      await this.step(30);
    }
    return this.ev(() => window.__deploy.open);
  }
  /** Spawn on foot at a flag of `team`. Every flag of the side is tried, then
   *  any other: a flag that is a seat on a hull refuses once the hull is gone
   *  or its seats are taken, and one that seats the man (ObjectiveMode's
   *  flying-boat point, SPAWN-25) is passed over for one that stands him on
   *  his feet, as a player wanting to walk would click. A seat is taken only
   *  when no flag stands him up. */
  async spawn(team = 1, kit = null) {
    if (!await this.openDeploy()) return 'deploy-closed';
    const order = await this.ev(([team, kit]) => {
      const d = window.__deploy;
      if (d.team !== team) d.setTeam(team);
      if (kit) d.setKit(kit);
      const open = d.flags.filter(f => f.spawns > 0 && !f.inactive);
      return [...open.filter(f => f.team === team), ...open.filter(f => f.team !== team)].map(f => f.name);
    }, [team, kit]);
    if (!order.length) return 'no-flag';
    let seated = null;
    for (const name of order) {
      if (!await this.openDeploy()) return 'deploy-closed';
      const ok = await this.ev(([name, team, kit]) => {
        const d = window.__deploy;
        if (d.team !== team) d.setTeam(team);
        if (kit) d.setKit(kit);
        return d.select(name) !== false && d.spawn();
      }, [name, team, kit]);
      if (!ok) continue;
      await this.step(40);
      const where = await this.ev(() => ({ hull: !!window.__hull?.(), swimming: !!window.__soldier?.()?.swimming }));
      if (!where.hull && !where.swimming) return 'ok';
      seated ??= name;
    }
    if (!seated) return 'refused';
    // Nothing stands him up: take the seat again.
    if (!await this.openDeploy()) return 'deploy-closed';
    const ok = await this.ev(([name, team, kit]) => {
      const d = window.__deploy;
      if (d.team !== team) d.setTeam(team);
      if (kit) d.setKit(kit);
      d.select(name);
      return d.spawn();
    }, [seated, team, kit]);
    if (!ok) return 'refused';
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
      destroyed: v.destroyed, absent: !!v.absent, held: !!v.held })));
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

/** The tester and the hull `owner` as they stand now: seated or not, alive or
 *  not, the hull's hit points, the combat-area clock, the deploy screen. */
async function whereabouts(s, owner) {
  return s.ev(o => {
    const h = window.__hull?.();
    const me = window.__soldier?.();
    const v = window.__vehicles?.().find(x => x.owner === o);
    return {
      seated: h ? h.template : null,
      soldier: me ? { hp: me.hp == null ? null : +me.hp.toFixed(1), destroyed: me.destroyed,
        pos: [me.x, me.y, me.z].map(n => +(+n).toFixed(1)), outsideFor: me.outsideFor } : null,
      hull: v ? { hp: v.hp == null ? null : +v.hp.toFixed(1), max: v.max, destroyed: !!v.destroyed,
        pos: v.pos?.map(n => +n.toFixed(1)) } : null,
      deployOpen: !!window.__deploy?.open,
      // The first frame he was out of the seat (`Session.step`'s watch).
      leftSeat: window.__seatWatch?.left ?? null,
      // The last killing blows dealt to an Armor of the tester's size, newest
      // last (`Session.open`): a hull bleeding out elsewhere is not his.
      killBlows: (window.__killBlows ?? []).filter(b => !me || me.maxHp == null || b.max === me.maxHp).slice(-2),
    };
  }, owner);
}

/** The first of `list` (placed hulls, `liveVehicles` rows) not destroyed now,
 *  with its position as it stands; null when every one is a wreck. */
async function standingInstance(s, list) {
  const live = new Map((await liveVehicles(s)).map(v => [v.owner, v]));
  for (const v of list) {
    const now = live.get(v.owner);
    if (now && !now.destroyed) return { ...v, pos: now.pos };
  }
  return null;
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
    // A hull parked nose to its emplacement backs out first, as a player
    // would: a level's 45mmATGunmobile can stand 1.2 m behind its own
    // sandbags (`pega_sandbag_str_m1`, `pega_sandbag_C_m1`) and push into
    // them at full throttle.
    await s.ev(() => { window.__keys.delete('KeyW'); window.__keys.add('KeyS'); });
    await s.step(300);
    const hb = await s.ev(() => window.__hull());
    const back = hb && finite(hb.pos) ? Math.hypot(hb.pos[0] - h1.pos[0], hb.pos[2] - h1.pos[2]) : 0;
    await s.ev(() => { window.__keys.delete('KeyS'); window.__keys.add('KeyW'); });
    rec.reverse_m = +back.toFixed(1);
    if (back < 3) {
      rec.immobile = `full throttle 6 s: moved ${moved.toFixed(1)} m, speed ${speed.toFixed(1)} m/s; reverse 5 s ${back.toFixed(1)} m`;
    }
  }
  // Wheels: nodes that look like wheels must have turned.
  const wheels = await s.ev(() => window.__wheelSpin?.());
  // Steering: D is right. The hull's own yaw rate is read first (W still
  // held, no D), and the press waits up to 3 s for a swing left over from a
  // knock to die away: a horse that ran into something slewed left on its own
  // and read as one whose D steers left (`audit_verdicts.mjs`).
  let preRate = 0;
  for (let i = 0; i < 12; i++) {
    const a = (await s.ev(() => window.__hull())).axes;
    await s.step(15);
    const b = (await s.ev(() => window.__hull())).axes;
    preRate = rightTurn(a, b) / 0.25;   // 15 frames of 1/60 s
    if (Math.abs(preRate) < SETTLE_RATE) break;
  }
  rec.pre_yaw_rate = +preRate.toFixed(3);
  await s.ev(() => window.__keys.add('KeyD'));
  const f0 = (await s.ev(() => window.__hull())).axes;
  // The direction is read after half a second: a truck at 13 m/s that holds D for
  // 2.5 s comes round past 180 degrees, where the nose's projection on the old
  // right vector turns negative for a turn that went the right way.
  await s.step(30);
  const fA = (await s.ev(() => window.__hull())).axes;
  await s.step(120);
  const f1 = (await s.ev(() => window.__hull())).axes;
  const sp = await s.ev(() => window.__drive().state().speed);
  await s.ev(() => { window.__keys.delete('KeyD'); window.__keys.delete('KeyW'); });
  const turned = Math.abs(yawOf(f1.forward) - yawOf(f0.forward));
  const turnA = rightTurn(f0, fA);
  const v = steerVerdict({ preRate, turnA, dtA: 0.5, turned, speed: sp });
  if (v.verdict === 'reversed') {
    add({ check: 'veh.steer', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.steer-reversed',
      evidence: `D (right) turned the nose ${turnA.toFixed(2)} rad in 0.5 s at a prior yaw rate of ${preRate.toFixed(2)} rad/s (D's own share ${v.induced.toFixed(2)})` });
    rec.failed = true;
  } else if (v.verdict === 'unsettled') {
    add({ check: 'veh.steer', level, template_or_kit: tpl, severity: 'info', cause_key: 'veh.steer-unsettled',
      evidence: `still slewing left at ${preRate.toFixed(2)} rad/s after 3 s with no D; the press turned ${turnA.toFixed(2)} rad and proves nothing` });
  } else if (v.verdict === 'no-steer') {
    add({ check: 'veh.steer', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.no-steer',
      evidence: `D held 2.5 s at ${sp.toFixed(1)} m/s: heading moved ${(turned * 57.3).toFixed(1)} deg` });
    rec.failed = true;
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

/** HOLD_FRAMES frames of `speed` m/s level flight at `p` along `dir`, the pose
 *  and velocity put back before every frame, then released there.
 *
 *  A placed aircraft is not one that has been flying. A lift regulator
 *  (`setRegulateToLift`) servos at its own rate towards the trim of the flight
 *  it is in, and on the ground it has run to its stop: a four-engined
 *  bomber rolls six seconds with its two airbrake regulators (flapLift 10,
 *  +-25 degrees, 10 deg/s) at -25, and dropped at 70 m/s with them there it
 *  pitched up at 0.5 rad/s, stalled and read as a bomber that diverges with
 *  its elevator reversed. The engines' revs, which a ground roll leaves half
 *  spun, chase the same flight. Held, the regulators sit at -10 and it
 *  flies (FHX-2). */
const HOLD_FRAMES = 180;
async function holdFlight(s, p, dir, yaw, speed) {
  await s.ev(([p, d, yaw, v, n, w, h]) => {
    const plane = window.__plane();
    const put = () => {
      plane.place(p.x, p.y, p.z, d[0] * v, 0, d[2] * v);
      plane.orient(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    };
    for (let i = 0; i < n; i++) { put(); window.__renderOnce(w, h); }
    put();
  }, [p, dir, yaw, speed, HOLD_FRAMES, W, H]);
}

/** A flown aircraft pinned level and still, 150 m over the ground, while its
 *  seats are switched, aimed and fired (`Session.step` puts it back before
 *  every frame).
 *
 *  Left to itself it is a hull in the air whose pilot's seat the test
 *  empties: it flies on and crashes (retail integrates it too), and the
 *  gunner under test dies with it. Parked on the ground instead, the pilot's
 *  own trigger drops its bombs under it: a bomber's 1000 kg bomb killed its
 *  pilot on the pad. Two bombers died both ways, and read as drivers thrown
 *  out mid-drive (FHX-10). */
async function pinAircraft(s) {
  await s.ev(() => {
    for (const k of [...window.__keys]) window.__keys.delete(k);
    const c = window.__plane()?.craft;
    if (!c) return;
    const p = c.state.position.clone();
    const ground = window.__groundAt?.(p.x, p.z);
    p.y = Math.max(p.y, (Number.isFinite(ground) ? ground : p.y) + 150);
    const f = new p.constructor(0, 0, -1).applyQuaternion(c.state.orientation);
    const yaw = Math.atan2(-f.x, -f.z);
    const q = c.state.orientation.clone().set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    window.__pin = () => {
      c.state.position.copy(p); c.state.velocity.set(0, 0, 0);
      c.state.orientation.copy(q); c.state.angularVelocity.set(0, 0, 0);
      c.applyTransform();
    };
    // The park, kept by the hull: `__plane()` is null from a gunner's seat.
    window.__pinPark = () => { c.reset(); c.applyTransform(); };
    window.__pin();
  });
  await s.step(6);
}

/** The pinned aircraft let go and set back on its spawn pose at rest, so the
 *  tester steps out onto its pad. */
async function unpinAircraft(s) {
  await s.ev(() => { window.__pin = null; window.__pinPark?.(); window.__pinPark = null; });
  await s.step(10);
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
  // A roll that ran the plane into something (a parked neighbour on a
  // carrier's deck, a hangar wall) leaves it damaged, and a critical hull's
  // engine stops (PHY-30: TemplateMessage 0x14 forces the revs to 0): the
  // flight checks below then measure a glider with no thrust, which reads as
  // a dive and a dead rudder. The damage is reported, and the hull is
  // repaired before it flies, as a pilot would take a fresh one.
  const hpOf = () => s.ev(o => { const x = window.__vehicles().find(y => y.owner === o);
    return x ? { hp: x.hp, max: x.max, critical: !!x.critical, destroyed: !!x.destroyed } : null; }, rec.owner);
  const hp1 = rec.owner != null ? await hpOf() : null;
  if (hp1 && !hp1.destroyed && hp1.max > 0 && hp1.hp < hp1.max - 1) {
    rec.roll_damage = { hp: +hp1.hp.toFixed(1), max: hp1.max, critical: hp1.critical };
    add({ check: 'air.fly', level, template_or_kit: tpl, severity: 'minor', cause_key: 'air.roll-damaged',
      evidence: `the 6 s ground roll (${rolled.toFixed(1)} m) took it from ${hp1.max} to ${hp1.hp.toFixed(1)} hp`
        + `${hp1.critical ? ' (critical)' : ''}; repaired before the flight checks` });
    await s.ev(([o, n]) => window.__damageVehicle?.(o, -n), [rec.owner, hp1.max]);
    await s.step(2);
    const hp2 = await hpOf();
    rec.roll_damage.repaired = hp2 ? +hp2.hp.toFixed(1) : null;
  }
  // Level flight: place 400 m up, nose along its heading at 70 m/s. Never
  // near the air's ceiling: every wing's lift is `1 - y/1000` of itself and
  // nothing at 1000 m (`aircraft.js` `medium`, `airDensityZeroAtHeight`). A
  // craft a flying spawn's arm holds at 1018 m and placed 400 m over that had
  // no lift and no control surface at all: it fell 262 m with the stick
  // dead, and read as a plane that diverges. 400 m over the ground, or 500 m
  // where that is lower.
  const ax = (await s.ev(() => window.__hull())).axes;
  const fw = ax.forward;
  const hz = Math.hypot(fw[0], fw[2]) || 1;
  const dir = [fw[0] / hz, 0, fw[2] / hz];
  const under = await s.ev(([x, z]) => window.__groundAt?.(x, z) ?? null, [g1.position.x, g1.position.z]);
  const flyY = Math.min(g1.position.y + 400, Math.max(Number.isFinite(under) ? under + 150 : -Infinity, 500));
  rec.flight_y = +flyY.toFixed(0);
  // Upright, level, nose along dir (three's -z forward): yaw from -z.
  const yaw = Math.atan2(-dir[0], -dir[2]);
  await holdFlight(s, { x: g1.position.x, y: flyY, z: g1.position.z }, dir, yaw, 70);
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
  // Each probe from the same pose, 80 m/s level at the height the level
  // flight was flown at: the hold puts it back every frame for three
  // seconds, so the surfaces the previous probe deflected are home (a 0.75 s
  // back-stick leaves the elevator up; an F4U's ailerons servo home at 12
  // deg/s and banked it 25 degrees on the way) and the regulators are on
  // this flight, then lets it go level.
  const fresh = async () => {
    await holdFlight(s, { x: a1.s.position.x, y: flyY, z: a1.s.position.z }, dir, yaw, 80);
    await s.step(2);
  };
  const probe = async (key, readOut, frames) => {
    await fresh();
    const b = (await s.ev(() => window.__hull())).axes;
    if (key) await s.ev(k => window.__keys.add(k), key);
    await s.step(frames);
    const a = (await s.ev(() => window.__hull())).axes;
    if (key) await s.ev(k => window.__keys.delete(k), key);
    return readOut(b, a);
  };
  // The same time with no key at all: a hull carries its own drift (a rocket
  // motor with `setTorque` rolls its airframe over on its own), and the
  // control is what it adds to that. 0.75 s, or 2.25 s when the short answer
  // is under 0.1: a heavy airframe's surfaces are slow by its own data (a
  // bomber's elevator servos +-11 degrees at 11 deg/s, `acceleration 22`), and in
  // 0.75 s its back stick moved the nose 0.05 against a fighter's 0.3, inside
  // the run-to-run scatter of the drift; it read as reversed one run and right
  // the next. 2.25 s gives it 0.31.
  const longer = {};
  const rel = async (key, readOut) => {
    let v = (await probe(key, readOut, 45)) - (await probe(null, readOut, 45));
    if (Math.abs(v) < 0.1) {
      v = (await probe(key, readOut, 135)) - (await probe(null, readOut, 135));
      longer[key] = true;
    }
    return v;
  };
  const pitchDown = await rel('ArrowDown', (b, a) => a.forward[1] - b.forward[1]);   // back stick: nose up
  const rollRight = await rel('ArrowRight', (b, a) => a.right[1] - b.right[1]);       // right wing down: right.y falls
  const yawRight = await rel('KeyD', (b, a) => dot3(a.forward, b.right));
  rec.controls = { backStick: +pitchDown.toFixed(3), rightRoll: +rollRight.toFixed(3), rudderRight: +yawRight.toFixed(3),
    ...(Object.keys(longer).length ? { longer: Object.keys(longer) } : {}) };
  const flagC = (key, v, expect, label, minAbs = 0.01) => {
    if (Math.abs(v) < minAbs) {
      add({ check: 'air.controls', level, template_or_kit: tpl, severity: 'major', cause_key: `air.${label}-dead`,
        evidence: `${key} for ${longer[key.split(' ')[0]] ? 2.25 : 0.75} s moved the ${label} by ${v.toFixed(4)}` });
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
        // The hand keeps going while the gun is still short of 0.2 degrees, up
        // to SLOW_AIM_ROUNDS of six deltas: a heavy gun's servo is slow by its
        // own data (a siege howitzer that traverses at `setMaxSpeed 3` and
        // ramps at 10 deg/s/s turned 0.1 degree for one round of the hand),
        // which is a gun answering, not a dead one. A gun that has not moved at
        // all may rest on the bound the hand pushes it to; the hand then pushes
        // the other way, as a player would.
        const push = axis === 'yaw' ? [60, 0] : [0, -60];
        const first = await aim(...push);
        const a0 = first.before.r.find(x => x.axis === axis)?.angle;
        let r = first, rounds = 1, reversed = false;
        let a1 = r.after.r.find(x => x.axis === axis)?.angle;
        while (Math.abs((a1 ?? 0) - (a0 ?? 0)) < 0.2 && rounds < SLOW_AIM_ROUNDS) {
          if (!reversed && Math.abs((a1 ?? 0) - (a0 ?? 0)) < 1e-6) {
            reversed = true;
            push[0] = -push[0]; push[1] = -push[1];
          }
          r = await aim(...push);
          rounds++;
          a1 = r.after.r.find(x => x.axis === axis)?.angle;
        }
        r = { before: first.before, after: r.after };
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
          const delta = (axis === 'yaw' ? fa.bearing - fb.bearing : fa.elevation - fb.elevation) * (reversed ? -1 : 1);
          // yaw: a right turn raises the bearing; pitch: mouse up raises the muzzle
          dirOk = Math.abs(delta) < 0.002 ? null : delta > 0;
        }
        rec[`${axis}_${seat.index}`] = { before: a0, after: a1, dirOk, muzzle: [r.before.m, r.after.m],
          ...(rounds > 1 ? { rounds } : {}), ...(reversed ? { reversed } : {}) };
        // Limits make a zero move legitimate only when the rig is clamped; report as minor.
        const held = heldByData(first.before.r.find(x => x.axis === axis));
        if (moved < 0.2 && held) {
          // The rig's own words keep it still (GUN-2b's servo: no `maxSpeed`
          // buys no rate; a non-wrapping range of zero width clamps to it).
          // A carrier's elevator seat declares `setInputToPitch` on a camera
          // rotator whose pitch speed is 0.
          add({ check: 'veh.turret', level, template_or_kit: tag, severity: 'info', cause_key: `veh.${axis}-held-by-data`,
            retail_faithful: true, evidence: `${axis} angle ${a0} -> ${a1}: ${held}` });
        } else if (moved < 0.2) {
          add({ check: 'veh.turret', level, template_or_kit: tag, severity: 'minor', cause_key: `veh.${axis}-no-response`,
            evidence: `${axis} angle ${a0} -> ${a1} after ${rounds * 6} look deltas, both ways (clamped or dead)` });
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
    const pre = await s.ev(() => ({ g: window.__hull().guns.map(g => g.shots), fx: JSON.stringify(window.__effects()), plays: window.__effectAudio?.()?.plays ?? 0,
      depots: window.__supply?.()?.depots ?? 0, carriesDepots: window.__hull().guns.some(g => g.depots > 0) }));
    // Each trigger a gun of the seat declares (`setInputFire`): a seat whose
    // only FireArms is on c_PIAltFire (a Centurion's `*_FireExtinguisher_PCO`, whose
    // `TankFireExtinguisher*_Alt` throws an invisible repair point) answers
    // the right button and never the left.
    const triggers = await s.ev(() => {
      const g = window.__hull()?.guns ?? [];
      const alt = g.some(x => x.input === 'c_PIAltFire');
      return { main: !alt || g.some(x => x.input !== 'c_PIAltFire'), alt };
    });
    await s.ev(t => window.__setSeatFire(t.main, t.alt), triggers);
    let maxProj = 0, sound = null, hitsSeen = 0, fxPlays = 0, effectSeen = null, maxDepots = pre.depots;
    for (let i = 0; i < 30; i++) {
      await s.step(4);
      const st = await s.ev(() => ({
        p: window.__getFire().projectiles + window.__getFire().tracers.length,
        w: window.__getAudioState().vehicles?.vehicles?.filter(v => v.driven || v.claims > 0)
          .flatMap(v => v.weapons.map(w => ({ fa: w.fireArms, voices: w.voices, sources: w.sources, master: w.master, layers: w.layers?.length ?? 0 }))) ?? [],
        h: window.__getFire().hits.length + window.__getFire().impacts,
        d: window.__supply?.()?.depots ?? 0,
        fx: window.__effectAudio?.()?.plays ?? 0,
        loud: (() => { const a = window.__effectAudio?.(true); let best = 0, lay = null;
          for (const sc of a?.scripts || []) for (const v of sc.voices || []) for (const l of v.layers || []) {
            const out = (l.playing ? l.output : 0); if (out > best) { best = out; lay = `${l.file.split('/').pop()} d=${(+l.distance).toFixed(1)} node=${(+l.nodeGain).toFixed(3)}`; } }
          return { best, lay }; })(),
        ea: (() => { const a = window.__effectAudio?.(); return a ? { sources: a.sources, inaudible: a.inaudible, dropped: a.dropped, suspended: a.suspended,
          scripts: (a.scripts || []).filter(x => x.plays > 0).map(x => `${x.script.split('/').pop()}:${x.plays}/${x.sources}`) } : null; })(),
      }));
      if (st.ea && (st.ea.sources > 0 || st.ea.scripts.length)) effectSeen = { ...st.ea, loudest: Math.max(effectSeen?.loudest ?? 0, st.loud.best), loudLayer: st.loud.best >= (effectSeen?.loudest ?? 0) ? st.loud.lay : effectSeen?.loudLayer };
      maxProj = Math.max(maxProj, st.p); hitsSeen = Math.max(hitsSeen, st.h); maxDepots = Math.max(maxDepots, st.d);
      if (!sound || st.w.some(w => w.voices > 0 || w.master > 0)) sound = st.w;
      fxPlays = Math.max(fxPlays, st.fx);
    }
    await s.ev(() => window.__setSeatFire(false, false));
    const post = await s.ev(() => ({ g: window.__hull().guns.map(g => g.shots), fx: JSON.stringify(window.__effects()) }));
    const shots = post.g.reduce((a, b) => a + b, 0) - pre.g.reduce((a, b) => a + b, 0);
    rec[`fire_${seat.index}`] = { shots, maxProj, fx: pre.fx !== post.fx, effectSound: effectSeen,
      ...(triggers.alt ? { triggers } : {}),
      ...(pre.carriesDepots ? { roundDepots: maxDepots - pre.depots } : {}) };
    const gunNames = (await s.ev(() => window.__hull().guns.map(g => g.name))).join(',');
    // A seat whose every FireArms the page built no gun group for is a tool,
    // not a gun: `gun-groups.js` keeps no group for a FireArms that launches
    // no drawn body at no velocity with no flash, tracer or recoil. The
    // `*_FireExtinguisher_PCO` seats are this: `TankFireExtinguisher*_Alt`
    // throws an `invisible 1` round at `velocity 0` on c_PIAltFire, carrying
    // `Extinguisher_repairpoint`, so retail draws nothing either. What retail
    // does and the page does not (the extinguisher's sound script and the
    // repair point) is a minor, open, not a gun that will not fire.
    const tools = shots <= 0
      ? ((await s.ev(() => window.__occupancy?.fireArms ?? [])) || []) : [];
    const allTools = tools.length > 0 && tools.every(f => f.built === false);
    if (shots <= 0 && /binocular|spotter|periscope/i.test(`${tpl}${seat.node}${gunNames}`)) {
      rec[`fire_${seat.index}`].optic = true;       // an observer's seat: nothing to shoot
    } else if (shots <= 0 && allTools) {
      rec[`fire_${seat.index}`].tool = tools.map(f => f.name);
      add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'minor', cause_key: 'veh.fire-tool-unmodelled',
        evidence: `no gun group: ${tools.map(f => `${f.name} (${f.input}, velocity ${f.velocity}, round ${f.projectile})`).join(', ')} `
          + 'launches no drawn body (gun-groups.js placeholder guard); retail draws nothing either, '
          + 'but its sound script and the round\'s children (a repair point) are not modelled' });
    } else if (shots <= 0) {
      add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'major', cause_key: 'veh.gun-no-fire',
        evidence: `trigger held 1.5 s (${triggers.main ? 'c_PIFire' : ''}${triggers.main && triggers.alt ? '+' : ''}${triggers.alt ? 'c_PIAltFire' : ''}): shots ${shots}; fireArms ${seat.fireArms}` });
      rec.failed = true;
    } else {
      // A round that carries a SupplyDepot (a thrown ammo box, a fire
      // extinguisher's repair point) stands it in the world while it lives.
      if (pre.carriesDepots && shots > 0 && maxDepots <= pre.depots) {
        add({ check: 'veh.fire', level, template_or_kit: tag, severity: 'major', cause_key: 'veh.round-depot-missing',
          evidence: `${shots} shots of a gun whose round carries a SupplyDepot, and the world's depots stayed at ${pre.depots}` });
        rec.failed = true;
      }
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

// A part that holds its angle (ledger GUN-2: a RotationalBundle that is not
// `setAutomaticReset`, on a key channel) keeps it when the key is let go: a
// round selector that rolls another gun to the barrel on the arrow keys, and
// until 2026-10-15 snapped back to the first round on release
// (`vehicle-base.js` `holdsAngle`). Real time on the page's own loop.
//
// The arrows (`c_PIPitch`, the SU-122's) and W/S (`c_PIThrottle`, the 76mm
// SPAA's and every FH towed gun's: the Flak 18/36 on al_marj-1942 rolls APHE
// and AA there). A gun with no wheels is a `static` seat with no drive: until
// 2026-10-15 nothing stepped its levers, and the exporter dropped them besides
// (`bf42/assemble.py` `holds_key_axis`, `turret-rig.js` `TurretRig.keyAxes`).
// A part that never moves on either pair is `veh.selector-dead`.
const HELD_KEY_PAIRS = { c_PIPitch: ['ArrowDown', 'ArrowUp'], c_PIThrottle: ['KeyS', 'KeyW'] };
async function checkHeldAxes(s, tpl, level, rec) {
  const parts = () => s.ev(inputs => {
    const occ = window.__seatOccupancy?.();
    const root = occ?.root;
    const out = [];
    root?.traverse(o => {
      // The seat's own levers: another seat's take that seat's keys.
      if ((o.userData?.control || occ.rootId) !== occ.activeSeatId) return;
      const rig = o.userData?.rig;
      if (!rig || rig.automaticReset || String(o.userData.templateKind).toLowerCase() !== 'rotationalbundle') return;
      const axis = Object.values(rig.axes || {}).find(a => inputs.includes(a.input) && !a.free && a.driver !== 'rate');
      if (!axis) return;
      out.push({ name: o.name, input: axis.input, q: o.quaternion.toArray() });
    });
    return out;
  }, Object.keys(HELD_KEY_PAIRS));
  const rest = await parts();
  if (!rest.length) return;
  const turned = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.q.reduce((sum, x, i) => sum + x * b.q[i], 0)))) * 180 / Math.PI;
  let moved = false, held = false;
  const keys = [...new Set(rest.map(p => p.input))].flatMap(input => HELD_KEY_PAIRS[input]);
  for (const key of keys) {
    await s.ev(k => window.__keys.add(k), key);
    await s.page.waitForTimeout(400);
    const during = await parts();
    await s.ev(k => window.__keys.delete(k), key);
    await s.page.waitForTimeout(600);
    const after = await parts();
    const i = during.findIndex((p, j) => turned(p, rest[j]) > 5);
    if (i < 0) continue;
    moved = true;
    // Back toward rest, not merely moved: the `during` sample is taken a round
    // trip before the release lands, and a fast part keeps turning for it (the
    // E-10's suspension at 100 deg/s ran 4 deg on, CivTrck's gate at 85 deg/s
    // 5 deg; GUN-2's own speed register coasts on past the release too). A
    // part that springs back ends nearer its rest than it was held.
    const backBy = turned(during[i], rest[i]) - turned(after[i], rest[i]);
    if (backBy < 2) held = true;
    else {
      add({ check: 'veh.held-axis', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.selector-springs-back',
        evidence: `${during[i].name} turned ${turned(during[i], rest[i]).toFixed(0)} deg on ${key} and went back `
          + `${backBy.toFixed(0)} deg on release (vehicle-base.js holdsAngle, GUN-2)` });
      rec.failed = true;
      return;
    }
  }
  rec.heldAxis = moved ? (held ? 'holds' : 'moved') : 'never moved';
  const selectors = rest.filter(p => /select|ammo/i.test(p.name));
  if (!moved && selectors.length) {
    add({ check: 'veh.held-axis', level, template_or_kit: tpl, severity: 'major', cause_key: 'veh.selector-dead',
      evidence: `${selectors.map(p => `${p.name} (${p.input})`).join(', ')} never turned on ${keys.join('/')} `
        + '(turret-rig.js TurretRig.keyAxes, vehicle-base.js holdsAngle, GUN-2)' });
    rec.failed = true;
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
  await s.ev(o => { window.__seatWatch = { owner: o, frames: 0, left: null, last: null }; }, v.owner);
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
    if (cls.kind === 'ground' || cls.kind === 'ship' || cls.kind === 'static') await checkHeldAxes(s, tpl, level, rec);
    if (cls.kind === 'ground') await testGround(s, tpl, level, rec, cls);
    else if (cls.kind === 'air') { await testAir(s, tpl, level, rec); await pinAircraft(s); }
    else if (cls.kind === 'ship') await testShip(s, tpl, level, rec);
    await testSeatsAndGuns(s, tpl, level, rec, cls);
  } finally {
    await s.ev(() => { for (const k of [...window.__keys]) window.__keys.delete(k); window.__setSeatFire?.(false, false); });
    if (cls.kind === 'air') await unpinAircraft(s);
  }
  await s.ev(() => { window.__seatWatch = null; });
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
  const offPad = new Map(), buried = new Map();
  for (const v of now) {
    // A held spawn stands where its host (a carrier's deck, an LCT's well)
    // puts it, never on a level pad: a Hellcat on
    // Hornet(2)'s deck read as 1087 m from the level's fighterspawner.
    if (v.absent || v.destroyed || v.held) continue;
    const key = tplOf(v).toLowerCase();
    let best = null;
    for (const pad of pads) {
      const names = [pad.vehicle, ...Object.values(pad.templates ?? {})].map(n => String(n ?? '').toLowerCase());
      if (!names.includes(key)) continue;
      const dh = Math.hypot(v.pos[0] - pad.position[0], v.pos[2] - pad.position[2]);
      const dy = v.pos[1] - pad.position[1];
      const d = Math.hypot(dh, dy);
      if (!best || d < best.d) best = { d, dh, dy, spawner: pad.spawner, pad };
    }
    if (!best || (best.dh <= 4 && best.dy <= 4 && (best.dy >= -4 || afloat.has(key)))) continue;
    // A pad the level buried: its spawner stands under the terrain, so the
    // hull is born with its wheels or its hull in the ground. Retail stands it
    // there (`ObjectSpawner::spawnObject` 0x083140a0 adds only `spawnOffset`)
    // and its mobile parts' `checkVsTerrain` lift it out by their depth, a hop
    // that drops it back beside the pad (ledger SPAWN-28, recorded in the
    // server lab); the load settle (`hull-bodies.js` `settlePlacedVehicles`)
    // runs the same law. Level data the page plays as retail does: reported,
    // apart from a hull the load moved off a pad that stands on the ground.
    if (best.dh <= 15) {
      const ground = await s.ev(([x, z]) => window.__groundAt?.(x, z) ?? null, [best.pad.position[0], best.pad.position[2]]);
      const here = await s.ev(([x, z]) => window.__groundAt?.(x, z) ?? null, [v.pos[0], v.pos[2]]);
      if (Number.isFinite(ground) && Number.isFinite(here) && best.pad.position[1] < ground - 0.3
          && v.pos[1] - here <= 4 && v.pos[1] - here >= -1) {
        if (!buried.has(key)) buried.set(key, []);
        buried.get(key).push(`${v.name}: ${best.spawner} at y ${best.pad.position[1].toFixed(1)} is `
          + `${(ground - best.pad.position[1]).toFixed(1)} m under the ground (${ground.toFixed(1)}); the hull stands at ${v.pos[1].toFixed(1)}`);
        continue;
      }
    }
    if (!offPad.has(key)) offPad.set(key, []);
    offPad.get(key).push(`${v.name} ${best.dh.toFixed(1)} m from ${best.spawner}, ${best.dy >= 0 ? '+' : ''}${best.dy.toFixed(1)} m`);
  }
  for (const [key, rows] of offPad) {
    add({ check: 'veh.settle', level, template_or_kit: tplOf(now.find(v => tplOf(v).toLowerCase() === key)),
      severity: 'major', cause_key: 'veh.off-its-pad',
      evidence: `stands away from its pad at load: ${rows.slice(0, 4).join('; ')}${rows.length > 4 ? ` (+${rows.length - 4})` : ''}` });
  }
  for (const [key, rows] of buried) {
    add({ check: 'veh.settle', level, template_or_kit: tplOf(now.find(v => tplOf(v).toLowerCase() === key)),
      severity: 'info', cause_key: 'veh.pad-under-ground', retail_faithful: true,
      evidence: rows.slice(0, 4).join('; ') });
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
    const first = byTpl.get(t)[0];
    const tpl = tplOf(first);
    const side = sideOf.get(t);
    // The instance tested is the template's first one still standing. One page
    // tests every hull in turn, and a gun fired near its rest pose can burst
    // on a neighbour: a battery set uphill of a machine-gun trench puts its
    // first round 3 m from the nearest gun, inside a 26 m splash
    // (`surveys/census_rest_fire_neighbours.mjs`). A wreck has no door
    // (SEAT-28) and takes no input (HP-15), so a template tested on it read
    // as a gun that neither aims nor fires (the mechanics audit's item 13,
    // 2026-10-15).
    const v = await standingInstance(s, byTpl.get(t));
    const rec = { level, unit: 'vehicle', template: tpl, owner: (v ?? first).owner, failed: false };
    if (!v) {
      rec.kind = 'wrecked-before-test'; rec.skipped = true; tested.push(rec);
      add({ check: 'veh.enter', level, template_or_kit: tpl, severity: 'info', cause_key: 'veh.wrecked-before-test',
        evidence: `all ${byTpl.get(t).length} instance(s) destroyed by earlier tests' fire before this one; not driven` });
      continue;
    }
    if (v.owner !== first.owner) rec.instance = `owner ${first.owner} destroyed by an earlier test's fire; tested ${v.owner}`;
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
      const others = byTpl.get(t).filter(o => o.owner !== v.owner).slice(0, 2);
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
      // Where the tester was when the hook threw: a hook that reads the
      // occupied hull throws once he is out of it, and "out" is a dead man, a
      // wreck, the combat area or a hook of the page's own.
      rec.whereabouts = await whereabouts(s, v.owner).catch(x => `unreadable: ${String(x.message).slice(0, 80)}`);
      // A tester killed in his seat by a round's splash while only he fires
      // (no bots in this phase) died of his own gun, as he would in the
      // game: a hull's blast splashes each seat's occupant as a soldier
      // (HFD-12) and spares none of the firer's (HP-9, HP-10). A 30 HP
      // mod soldier in a bunker's second seat took 32 from the main gun's
      // shell meeting the wall in front of it. A gun test, not a gun fault.
      const blow = rec.whereabouts?.killBlows?.at?.(-1)?.at?.join(' ') ?? '';
      const ownFire = rec.whereabouts?.leftSeat?.soldierDestroyed && !rec.whereabouts.leftSeat.hullDestroyed
        && /applySplash/.test(blow) && /guns\.onImpact/.test(blow);
      add({ check: 'harness', level, template_or_kit: tpl, severity: 'info',
        cause_key: ownFire ? 'veh.crew-killed-by-own-fire' : 'harness.exception',
        ...(ownFire ? { retail_faithful: true } : {}),
        evidence: `${rec.error.split('\n')[0]}; ${JSON.stringify(rec.whereabouts)}` });
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
    const diag = await s.ev(() => {
      let hook = null;
      try { hook = window.__handWeapon?.() ? 'ok' : 'none'; } catch (e) { hook = `throws: ${String(e?.message ?? e).slice(0, 160)}`; }
      return { locked: window.__soldier()?.itemsLocked, hand: window.__kitRotation().handSlot,
        swimming: window.__soldier()?.swimming, hp: window.__soldier()?.hp, hook,
        soldier: !!window.__soldier?.(), round: window.__round?.()?.status ?? null };
    });
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
  // A point with `setEnterOnSpawn 1` seats its player (a flying boat's
  // H8K2_SpawnPoint1 is on the hull, on the water): the seat spawn check
  // below is its test, not the ground's.
  const spawns = (scene.soldierSpawns || []).filter(p => p.position && !p.enterOnSpawn);
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

// A point with `setEnterOnSpawn 1` seats its player (SPAWN-25..SPAWN-27): he
// must arrive as if he had climbed in from the ground, in the seat, with the
// kit's weapon holstered. A bomber turret's air spawn showed the kit's rifle
// over the gunner's view: the rig loads after the climb in, and the page's
// seated test knew only a driven seat (`arms-rig.js` `seated`).
// Each flag is spawned on with a kit other than the last, so the rig has to
// load after the climb in.
async function seatSpawnPhase(s, level, summary, scene = null) {
  // A soldier spawn of the level's own (not a deck's) can seat its player too.
  const pointSeats = (scene?.soldierSpawns ?? []).filter(p => p.enterOnSpawn).map(p => p.name);
  const flags = await s.ev(pointSeats => {
    const seated = new Set((window.__deckSpawns?.() ?? []).filter(p => p.enterOnSpawn && !p.inactive)
      .map(p => `${p.group}`));
    return window.__deploy.flags.map((f, i) => ({ i, name: f.name, team: f.team,
      group: f.group ?? f.spawnGroup ?? null, seats: f.enterOnSpawn ?? null }))
      .filter(f => f.team === 1 || f.team === 2)
      .filter(f => (window.__deckSpawns?.() ?? []).some(p => p.enterOnSpawn && !p.inactive && p.name === f.name)
        || seated.has(`${f.group}`) || pointSeats.includes(f.name));
  }, pointSeats);
  let tested = 0, bad = 0;
  for (const [n, f] of flags.slice(0, QUICK ? 2 : 8).entries()) {
    await s.ev(() => window.__damage?.(1e6));
    await s.step(5);
    for (let i = 0; i < 40 && !await s.ev(() => window.__deploy.open); i++) await s.step(30);
    const spawned = await s.ev(([name, team, kit]) => {
      const d = window.__deploy;
      if (d.team !== team) d.setTeam(team);
      d.setKit(kit);
      d.select(name);
      return d.spawn();
    }, [f.name, f.team, KIT_ROWS[(n + 1) % 5]]);
    if (!spawned) continue;
    await s.step(10);
    await s.page.waitForTimeout(2500);
    await s.step(10);
    const st = await s.ev(() => ({ seat: window.__seatOccupancy?.()?.activeSeatId ?? null,
      rig: window.__rig?.()?.visible ?? null, weapon: window.__handWeapon?.()?.name ?? null }));
    tested++;
    if (st.seat && st.rig === true) {
      bad++;
      add({ check: 'spawn.seat', level, template_or_kit: f.name, severity: 'major', cause_key: 'spawn.seat-shows-kit',
        evidence: `spawned into ${st.seat} with the kit's ${st.weapon} drawn over the seat (arms-rig.js seated)` });
    }
  }
  summary.seat_spawns_tested = tested; summary.seat_spawns_bad = bad;
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
async function botPhase(browser, level, mode, summary, scene = null) {
  const s = new Session(browser, level, mode, 8);
  await s.open();
  const r = await s.spawn(1);
  await s.step(120);
  await sleep(3000);
  const total = BOT_SECONDS;
  const samples = [];
  const take = async () => samples.push(await s.ev(() => (window.__bots?.() ?? []).map(b => ({
    id: b.id ?? b.name, p: b.pos ?? null, vehicle: b.vehicle ?? null, stalled: b.stalledTicks ?? 0, behaviour: b.behaviour ?? null,
    route: b.routePoints ?? 0, routeFailed: b.routeFailed ?? null, order: b.order?.area ?? null,
    goalReached: b.goalReached ?? null, urgency: b.urgency ?? null, change: b.change ?? null }))));
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
    const detail = [];
    for (const b of first) {
      const rows = samples.map(x => x.find(y => y.id === b.id)).filter(Boolean);
      const track = rows.map(r => r.p).filter(Boolean);
      if (track.length < 2) continue;
      let travelled = 0;
      for (let i = 1; i < track.length; i++) travelled += Math.hypot(track[i][0] - track[i - 1][0], track[i][2] - track[i - 1][2]);
      if (travelled < 8) still++;
      const end = rows[rows.length - 1];
      detail.push({ id: b.id, m: +travelled.toFixed(1), behaviour: end.behaviour, vehicle: end.vehicle,
        route: end.route, routeFailed: end.routeFailed, order: end.order, at: end.p?.map(v => +(+v).toFixed(1)) ?? null,
        goalReached: end.goalReached, urgency: end.urgency, change: end.change });
    }
    summary.bots_stalled = still;
    summary.bots_detail = detail;
    // A level that ships no single-player AI data (no CoOp game type and no
    // `ai` block: no pathfinding maps, strategies or areas) is one the game
    // puts no bot on: Instant Battle lists only levels with that data, and
    // a server's bots need its pathfinding. The page still spawns them, and
    // what they do there is the page's fallback, not a finding about the
    // level. Ten Conquest-only levels baked on 2026-10-16 are this.
    const aiData = !scene || Object.keys(scene.ai ?? {}).length > 0
      || Object.keys(scene.gameTypes ?? {}).includes('CoOp');
    // A bot that stands still because it is where its order sends it is
    // holding, not stalled: its goal is reached (`goalReached`) and it idles,
    // scouts, takes cover or fires, or it mans a seat and fires from it. The
    // engine's own plans do not move there (Scout: "the plan does not move",
    // bot-behaviours.md section 4). An air level of 2026-10-16 orders every
    // side to areas outside its 4096 m world or under its sea, and four of
    // its eight bots stood at their base the whole minute with the goal
    // reached and MoveTo at 0. What is left is a bot that wants to go
    // somewhere and does not.
    const STILL_PLANS = new Set(['Idle', 'Scout', 'TakeCover', 'Fire']);
    const holding = d => STILL_PLANS.has(d.behaviour) && (d.goalReached === true || !!d.vehicle);
    const stuck = detail.filter(d => d.m < 8 && !holding(d));
    summary.bots_holding = detail.filter(d => d.m < 8 && holding(d)).length;
    if (still >= Math.max(3, first.length / 2)) {
      const real = aiData && stuck.length >= Math.max(3, first.length / 2);
      add({ check: 'bots.move', level, template_or_kit: '-', severity: real ? 'major' : 'info',
        cause_key: !aiData ? 'bots.no-ai-data' : real ? 'bots.stalled' : 'bots.holding',
        ...(real ? {} : { retail_faithful: true }),
        evidence: `${still} of ${first.length} bots travelled under 8 m in ${total} s`
          + (!aiData ? '; the level ships no AI data (no CoOp, no pathfinding), so retail puts no bot on it'
            : `; ${still - stuck.length} hold their goal (reached, idling, scouting or firing), `
              + `${stuck.length} want to move: ${stuck.map(d => `${d.id} ${d.behaviour}`).join(', ') || 'none'}`) });
    }
    if (aiData && stuck.length && stuck.length < Math.max(3, first.length / 2)) {
      add({ check: 'bots.move', level, template_or_kit: '-', severity: 'minor', cause_key: 'bots.stuck',
        evidence: stuck.map(d => `${d.id} ${d.behaviour} ${d.m} m in ${total} s`
          + (d.change ? ` (boarding ${d.change.id} ${d.change.d} m off)` : '')
          + (d.route ? `, route ${d.route} points` : '')).join('; ') });
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
      if (ONLY.has('spawns')) phases.push(['spawns', async () => { await ensureOnFoot(s, 1); await spawnPhase(s, level, scene, summary); await seatSpawnPhase(s, level, summary, scene); }]);
      if (ONLY.has('kits')) phases.push(['kits', async () => { await ensureOnFoot(s, 1); await kitPhase(s, level, summary); }]);
      // The flags last on the page: taking a side's last flag ends the round
      // after its countdown, and the restart takes the soldier off the field
      // under whatever phase runs then. Run before the kits, it removed the
      // scout halfway through his first select (his Katana "not raised", no
      // soldier at all) on a level whose two sampled flags were both home
      // bases.
      if (ONLY.has('flags')) phases.push(['flags', async () => { await ensureOnFoot(s, 1); await flagPhase(s, level, 1, summary); }]);
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
        try { await botPhase(browser, level, mode, summary, scene); }
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
