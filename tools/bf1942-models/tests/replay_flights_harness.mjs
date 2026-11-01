// A server recording's projectile flights under node: `pn`/`pj`/`pd` read
// into `rec.flights`, each linked to the `f` that fired it and the `i` that
// ended it (replay-recording.js `linkFlights`), and drawn by
// replay-flights.js in place of the page's own round
// (features/replay-feature-sweep-2026-11-01, entry 2).
//
// Same pattern as `replay_hitmarks_harness.mjs`: the viewer's modules
// imported in place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, flights] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-flights.js'),
]);
const { parseRecording, positionAt } = recording;
const { ReplayFlights, fireWithoutRound, flightAt, flightHeading, serverFlies } = flights;

const results = {};
const line = o => JSON.stringify(o);
const r3 = v => +v.toFixed(3) + 0;
const r3v = v => v.map(r3);

// --- a server file ----------------------------------------------------------------
//
// BF1942's frame. A Sherman (net id 55) fires along +Z from (100, 10, 100) at
// 10.000 s; its shell, key 7, is first placed a tick out, 3.3 m on, at
// 10.002 s, flies three samples and strikes at 10.100 s, (100, 10, 113),
// where the `pd` follows. A second `i` there names another gun's muzzle.
// Key 7 flies again at 20 s (a pooled key: two flights). A bot's fake round
// at 30 s has no projectile. A shot at 40 s along +X is not the flight that
// leaves along +Z beside it. A place with no `pn` at 50 s; a flight still in
// the air when the file closes at 60 s; a damaged place.
const lines = [
  { k: 'h', v: 5, plus: 'server-replay-recorder/3', start: '2026-11-01T10:00:00', hz: 30 },
  { k: 'f', t: 10.0, id: 55, pid: 3, w: 'ShermanGunBarrel', p: [100, 10, 100], d: [0, 0, 1] },
  { k: 'pn', t: 10.002, o: [[7, 'ShermanProjectile']] },
  { k: 'pj', t: 10.002, o: [[7, 100, 10, 103.3]] },
  { k: 'pj', t: 10.035, o: [[7, 100, 10, 106.6]] },
  { k: 'pj', t: 10.068, o: [[7, 100, 10, 109.9]] },
  { k: 'i', t: 10.1, pid: 9, tid: 1, tmpl: 'PanzerIV', o: [300, 10, 100], p: [100, 10, 112.8], obj: 66, dmg: 1 },
  { k: 'i', t: 10.1, pid: 3, tid: 2, tmpl: 'Sherman', o: [100, 10, 100], p: [100, 10, 113], obj: 66, dmg: 1 },
  { k: 'pd', t: 10.101, o: [7] },
  { k: 'f', t: 20.0, id: 55, pid: 3, w: 'ShermanGunBarrel', p: [200, 10, 100], d: [0, 0, 1] },
  { k: 'pn', t: 20.002, o: [[7, 'ShermanProjectile']] },
  { k: 'pj', t: 20.002, o: [[7, 200, 10, 103.3]] },
  { k: 'pj', t: 20.035, o: [[7, 200, 10, 106.6]] },
  { k: 'pd', t: 20.068, o: [7] },
  { k: 'f', t: 30.0, id: 55, pid: 3, w: 'ShermanGunBarrel', p: [300, 10, 100], d: [0, 0, 1], fake: 1 },
  { k: 'pn', t: 30.002, o: [[8, 'ShermanProjectile']] },
  { k: 'pj', t: 30.002, o: [[8, 300, 10, 103.3]] },
  { k: 'pd', t: 30.035, o: [8] },
  { k: 'f', t: 40.0, id: 55, pid: 3, w: 'ShermanGunBarrel', p: [400, 10, 100], d: [1, 0, 0] },
  { k: 'pn', t: 40.002, o: [[9, 'ShermanProjectile']] },
  { k: 'pj', t: 40.002, o: [[9, 400, 10, 103.3]] },
  { k: 'pd', t: 40.035, o: [9] },
  { k: 'pj', t: 50.0, o: [[11, 500, 10, 100], [12, 'x', 1, 2]] },
  { k: 'pd', t: 50.033, o: [11] },
  { k: 'pn', t: 59.9, o: [[13, 'FighterBomb']] },
  { k: 'pj', t: 59.9, o: [[13, 600, 100, 100]] },
  { k: 'tk', t: 60.0, v: [100, 100] },
];
const rec = parseRecording(lines.map(line).join('\n'));
const [shell, again, faked, across, unnamed, open] = rec.flights;
const [shot, second, fake, sideways] = rec.fires;
results.parsed = {
  count: rec.flights.length,
  hz: rec.sampleHz,
  keys: rec.flights.map(f => f.key),
  tmpls: rec.flights.map(f => f.tmpl),
  spans: rec.flights.map(f => [r3(f.t0), Number.isFinite(f.t1) ? r3(f.t1) : null]),
  samples: rec.flights.map(f => f.track.length),
  skipped: rec.skipped,
};
results.linked = {
  shellShot: shell.shot === shot && shot.flight === shell,
  againShot: again.shot === second && second.flight === again,
  shellImpactT: shell.impact?.t ?? null,
  shellImpactOrigin: shell.impact?.origin ?? null,
  impactBack: shell.impact?.flight === shell,
  againImpact: again.impact,
  fakeShot: faked.shot,
  fakeHasFlight: Boolean(fake.flight),
  acrossShot: across.shot,
  sidewaysHasFlight: Boolean(sideways.flight),
  // The links stay out of JSON: a recording's shots are copied and stored.
  fireJson: JSON.stringify(rec.fires).includes('flight'),
  spread: Object.keys({ ...shot }).includes('flight'),
};
results.path = {
  keys: shell.keys.length,
  created: r3(shell.created),
  destroyed: r3(shell.destroyed),
  atStart: r3v(positionAt(shell, shell.created)),
  atEnd: r3v(positionAt(shell, shell.destroyed)),
  // No shot and no collision: its own samples, ending at the last.
  acrossKeys: across.keys === across.track,
  againDestroyed: r3(again.destroyed),
  openDestroyed: r3(open.destroyed),
};

// --- a client file has none ---------------------------------------------------------
const client = parseRecording([
  { k: 'h', v: 5, plus: '2.0', start: '2026-11-01T10:00:00' },
  { k: 'f', t: 10.0, id: 55, pid: 3, w: 'ShermanGunBarrel', p: [100, 10, 100], d: [0, 0, 1] },
].map(line).join('\n'));
results.client = { flights: client.flights.length, shotFlight: client.fires[0].flight ?? null };

// --- the page's guns --------------------------------------------------------------
const shellGroup = { projectileMesh: {}, stats: { projectile: { kind: 'shell', template: 'shermanprojectile' }, recoil: { speed: 6 } }, recoil: 0 };
const bulletGroup = { projectileMesh: null, stats: { projectile: { kind: 'bullet', template: 'ShermanProjectile' } } };
const otherGroup = { projectileMesh: {}, stats: { projectile: { kind: 'shell', template: 'PanzerIVProjectile' } } };
results.flies = {
  shell: serverFlies(shellGroup, shot),
  bullet: serverFlies(bulletGroup, shot),
  otherRound: serverFlies(otherGroup, shot),
  noFlight: serverFlies(shellGroup, fake),
  client: serverFlies(shellGroup, client.fires[0]),
};
const calls = [];
const guns = { flash: g => calls.push(['flash', g === shellGroup]), onShot: (g, n) => calls.push(['onShot', n]) };
fireWithoutRound(guns, shellGroup);
results.fired = { calls, soundHeld: shellGroup.soundHeld, sinceRound: shellGroup.sinceRound, kicked: shellGroup.recoil > 0 };

// --- the view frame -----------------------------------------------------------------
const dir = new THREE.Vector3();
results.view = {
  at: r3v(flightAt(shell, 10.035)),
  heading: flightHeading(shell, 10.035, dir) ? r3v(dir.toArray()) : null,
  before: flightAt(shell, 9.9),
  after: flightAt(shell, 10.2),
};

// A collision recorded on the last sample (a Panzershreck round into a
// Sherman, 213.048 s of 20261101-104230-elalamein-coop-lod0-rec): the round
// stands still over its last leg, and keeps the heading it arrived with.
const standing = parseRecording([
  { k: 'h', v: 5, plus: 'server-replay-recorder/3', start: '2026-11-01T10:00:00', hz: 30 },
  { k: 'f', t: 70.0, id: 56, pid: 4, w: 'Panzershreck', p: [700, 10, 100], d: [0, 0, 1] },
  { k: 'pn', t: 70.002, o: [[20, 'BazookaProjectile']] },
  { k: 'pj', t: 70.002, o: [[20, 700, 10, 101.7]] },
  { k: 'pj', t: 70.035, o: [[20, 700, 10, 103.4]] },
  { k: 'i', t: 70.068, pid: 4, tid: 3, tmpl: 'Panzershreck', o: [700, 10, 100], p: [700, 10, 103.4], obj: 56, dmg: 1 },
  { k: 'pd', t: 70.069, o: [20] },
].map(line).join('\n')).flights[0];
results.standing = {
  impact: Boolean(standing.impact),
  heading: flightHeading(standing, standing.destroyed - 1e-3, dir) ? r3v(dir.toArray()) : null,
};

// --- drawn, and the end effect -------------------------------------------------------
const played = [];
const player = {
  rec, root: new THREE.Group(), playing: true, networkedRounds: new Set(),
  ctx: { effects: { play: (name, opts) => { played.push({ name, at: r3v(opts.position ?? []) }); return null; }, has: () => false } },
};
const drawn = new ReplayFlights(player);
drawn.sources.set('shermanprojectile', { scene: new THREE.Group(), endEffect: 'e_ExplShell', trail: null });
drawn.collect();
drawn.update(10.05);
const mid = drawn.debug();
drawn.update(10.09);
drawn.update(10.12);
const afterHit = drawn.debug().length;
// A seek across the next flight's end plays nothing.
drawn.update(19.0);
drawn.update(20.2);
results.drawn = {
  drawnCount: drawn.drawn.length,
  flagged: rec.flights.map(f => Boolean(f.drawn)),
  mid: mid.map(m => ({ tmpl: m.tmpl, at: r3v(m.at) })),
  afterHit,
  played,
  nodes: player.root.children.length,
};
drawn.dispose();
results.drawn.afterDispose = player.root.children.length;

// A flak shell bursting in the air (its proximity fuse or its clock): no
// `i` records it, and its end-of-life effect plays where it was last.
const flakRec = parseRecording([
  { k: 'h', v: 5, plus: 'server-replay-recorder/3', start: '2026-11-01T10:00:00', hz: 30 },
  { k: 'i', t: 1.0, pid: 1, tid: 1, tmpl: 'Mp40', o: [0, 0, 0], p: [5, 0, 0], obj: -1, dmg: 0 },
  { k: 'pn', t: 80.0, o: [[30, 'Flak38_Projectile']] },
  { k: 'pj', t: 80.0, o: [[30, 0, 100, 0]] },
  { k: 'pj', t: 80.033, o: [[30, 0, 110, 0]] },
  { k: 'pd', t: 80.066, o: [30] },
  { k: 'tk', t: 90.0, v: [1, 1] },
].map(line).join('\n'));
const flakPlayed = [];
const flakPlayer = {
  rec: flakRec, root: new THREE.Group(), playing: true, networkedRounds: new Set(),
  ctx: { effects: { play: (name, opts) => { flakPlayed.push({ name, at: r3v(opts.position) }); return null; }, has: () => false } },
};
const flak = new ReplayFlights(flakPlayer);
flak.sources.set('flak38_projectile', {
  scene: new THREE.Group(), endEffect: 'e_FlakBig', trail: null,
  spec: { template: 'Flak38_Projectile', kind: 'shell', endEffect: 'e_FlakBig',
          damage: { hasOnTimeEffect: true, damageType: 4, radius: 20, material2: 200, hasCollisionEffect: true } },
});
flak.collect();
flak.update(80.01);
flak.update(80.05);
results.flak = flakPlayed;

process.stdout.write(JSON.stringify(results));
