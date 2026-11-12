// A GCMOD starfighter on full reverse (features/dogfight-lessons-gcmod): 5 s
// level at full throttle from 80 m/s, then the throttle right back, which
// winds the main engine down and spins the lift engines (wound backwards on
// c_PIThrottle) up. Prints JSON: the speed at the brake, the lowest speed
// within 10 s of it and when, and the height gained over that time.
//
//   node tests/gc_brake_probe.mjs [X-Wing|tiefighter] [--text]
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { placePlane } = await load('dogfight-duel.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'gc-starfighters.json'), 'utf8'));
const name = process.argv[2] ?? 'X-Wing';
const make = jetMaker(THREE, Aircraft, fixture, name);
const p = make();
placePlane(p, { at: [0, 400, 0], headingDeg: 0, speed: 80 });
const dt = 1 / 30;
const spd = () => p.state.velocity.length();
const text = process.argv.includes('--text');
p.setInput('c_PIThrottle', 1);
for (let i = 0; i < 150; i++) p.integrate(dt);
const at = { speed: spd(), y: p.state.position.y };
p.setInput('c_PIThrottle', -1);
let low = { speed: Infinity, t: 0, y: 0 };
let lowY = Infinity;
for (let i = 1; i <= 300; i++) {
  p.integrate(dt);
  lowY = Math.min(lowY, p.state.position.y);
  if (spd() < low.speed) low = { speed: spd(), t: i * dt, y: p.state.position.y };
  if (text && i % 30 === 0) console.log(name, (i * dt).toFixed(1), 'v', spd().toFixed(1), 'y', p.state.position.y.toFixed(1));
}
const r1 = v => Math.round(v * 10) / 10;
console.log(JSON.stringify({ craft: name, brakeAt: r1(at.speed), lowest: r1(low.speed), after: r1(low.t), climbed: r1(low.y - lowY) }));
