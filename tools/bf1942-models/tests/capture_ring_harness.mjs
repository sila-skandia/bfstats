// The page's capture-ring estimate (viewer/capture-rings.js) replayed over a
// lab capture (lab/capture_probe.mjs): the server's own positions of the
// probe soldier and the server's control point words, by the server's tick.
// For every change of a point's team the server sent, it prints when the
// probe first stood in the radius (by the server's position), when the
// estimate expected the change, and when the word came. Run by
// `lab/capture_check.py` and `tests/test_capture_rings.py`; prints one JSON
// object.
//
//   node tests/capture_ring_harness.mjs <capture.ndjson[.gz]> <scene.json[.gz]> [Conquest]

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const { createCaptureEstimate, captureProgress, ringSprite, RING_SPRITES } = await import(path.join(VIEWER, 'capture-rings.js'));
const { captureRadius } = await import(path.join(VIEWER, 'control-point-law.js'));

const read = p => {
  const buf = fs.readFileSync(p);
  return (p.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
};

const [logPath, scenePath, mode = 'Conquest', lagArg = '0'] = process.argv.slice(2);
// The server's control point words held back this many ticks, as a page a
// round trip behind would read them against positions that are not: the
// estimate then gets there first and keeps the ring full until the word.
const LAG = Number(lagArg) || 0;
const results = {};

// The frame picker, as the client picks an objective's (OBJ-7).
results.frames = [0, 0.06, 0.0626, 0.5, 0.94, 1].map(f => ringSprite(f));
results.spriteCount = RING_SPRITES.length;
results.progress = {
  getting: captureProgress({ team: 0, timeToGetControl: 10, _cp: { state: 3, getting: 2, get: 2.5, lose: 10 } }),
  losing: captureProgress({ team: 1, timeToLoseControl: 10, _cp: { state: 2, getting: 0, get: 10, lose: 7.5 } }),
  held: captureProgress({ team: 1, _cp: { state: 4, getting: 0, get: 10, lose: 10 } }),
};

if (logPath && scenePath) {
  const scene = JSON.parse(read(scenePath));
  const points = (scene.modes?.[mode]?.controlPoints ?? scene.controlPoints ?? []).map(cp => ({
    ...cp, controlPointName: cp.name, uncapturable: !!cp.unableToChangeTeam,
  }));
  const byName = new Map(points.map(p => [p.name.toLowerCase(), p]));
  const rows = read(logPath).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const ticks = rows.filter(r => Number.isInteger(r.tick));
  const first = Math.min(...ticks.map(r => r.tick));
  const last = Math.max(...ticks.map(r => r.tick)) + LAG;
  const at = new Map();
  for (const r of ticks) {
    const t = r.kind === 'cp' && r.tick > first ? r.tick + LAG : r.tick;
    if (!at.has(t)) at.set(t, []);
    at.get(t).push(r);
  }
  // The round as the client joined it: each point's first word.
  const seen = new Set();
  for (const r of rows) {
    if (r.kind !== 'cp' || r.team == null) continue;
    const p = byName.get(String(r.tmpl).toLowerCase());
    if (p && !seen.has(p)) { p.team = r.team; seen.add(p); }
  }
  const estimate = createCaptureEstimate();
  const insideAt = new Map();
  const changes = [];
  const rings = [];
  // Each probe's soldier as the server has him (`probe`, `team` set by
  // lab/capture_check.py when it merges several; one probe is team 2).
  const probes = new Map();
  for (let tick = first; tick <= last; tick++) {
    const now = tick / 30;
    for (const r of at.get(tick) ?? []) {
      // The server's position of the probe, in the page's frame (z negated).
      if (r.kind === 'cs' && r.pos) probes.set(r.probe ?? 0, { team: r.team ?? 2, pos: [r.pos[0], r.pos[1], -r.pos[2]] });
      if (r.kind === 'cp' && r.team != null) {
        const p = byName.get(String(r.tmpl).toLowerCase());
        if (p && p.team !== r.team) {
          const ring = estimate.progressOf(p.name);
          changes.push({ name: p.name, tick, from: p.team, to: r.team, insideTick: insideAt.get(p.name) ?? null,
                         ringBefore: ring ? { kind: ring.kind, team: ring.team, sprite: ringSprite(ring.fraction) } : null });
          p.team = r.team;
        }
      }
    }
    const players = [...probes.values()];
    for (const { pos } of players) {
      for (const p of points) {
        const d = Math.hypot(pos[0] - p.position[0], pos[1] - p.position[1], pos[2] - p.position[2]);
        if (d <= captureRadius(p) && !insideAt.has(p.name)) insideAt.set(p.name, tick);
      }
    }
    estimate.step(points, players, 1 / 30, now);
    if (tick % 15 === 0) {
      for (const p of points) {
        const g = estimate.progressOf(p.name);
        if (g) rings.push({ tick, name: p.name, kind: g.kind, team: g.team, fraction: +g.fraction.toFixed(3), sprite: ringSprite(g.fraction) });
      }
    }
  }
  for (const c of changes) {
    c.sinceInside = c.insideTick != null ? +((c.tick - c.insideTick) / 30).toFixed(3) : null;
    const corr = estimate.corrections.find(k => k.name === c.name && Math.round(k.at * 30) === c.tick);
    c.lead = corr?.lead != null ? +corr.lead.toFixed(3) : null;
  }
  results.capture = { first, last, inside: Object.fromEntries(insideAt), changes, rings };
}

console.log(JSON.stringify(results));
