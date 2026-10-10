// A real `Soldier` on a flat heightfield wearing XPack2's rocket pack
// (`viewer/rocket-pack.js` through `soldier.js`): what holding the jump key
// does to him, and what a fall costs the man wearing it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [{ Soldier }, { Heightfield }, { WorldCollider }, pack, { fallDamageFor }, { TICK_DT }] = await Promise.all([
  imp('soldier.js'), imp('heightfield.js'), imp('world-collider.js'), imp('rocket-pack.js'),
  imp('fall-damage.js'), imp('physics.js'),
]);

const ROW = {
  template: 'GermanElite_RocketPack', bone: 'backpack',
  activeAcceleration: [0, 72, 0], passiveAcceleration: [0, 7.7, 0],
  trigger: 'PIAction', negativeMask: ['Climbing', 'Crouching', 'Swiming', 'Lying'],
  burstFrequency: 30, activeHeatIncrement: 2.25, passiveHeatIncrement: 0, coolingFactor: 0.07,
  effectPersistance: 0, damping: 0, overrideAirMovementInhibitations: true,
  inAirAnims: ['Lb_RocketeeringIdle', 'Empty'], effects: ['e_RocketPack'],
};
const SPEC = pack.packSpec(ROW);
const WORLD = 2048, MID_X = WORLD / 2, MID_Z = -WORLD / 2;

function flat(height = 0) {
  const dim = 32, n = dim + 1;
  const field = new Heightfield(dim, WORLD / dim, new Float32Array(n * n).fill(height));
  return new WorldCollider({ heightfield: field, statics: null, waterLevel: null });
}
function wearer(worn = true) {
  const soldier = new Soldier({ collider: flat(), worldSize: WORLD });
  soldier.spawn(MID_X, 0, MID_Z, 0);
  if (worn) soldier.packSource = () => SPEC;
  for (let i = 0; i < 90; i++) soldier.step(TICK_DT, {});     // settle
  return soldier;
}

const results = {};

// Hold the jump key for `hold` seconds, then let go and fall to the ground.
function flight(hold, { worn = true } = {}) {
  const soldier = wearer(worn);
  let apex = 0;
  let burstEvents = 0;
  let heatPeak = 0;
  let clips = null;
  const t0 = soldier.y;
  for (let i = 0; i < 60 * 12; i++) {
    const t = i * TICK_DT;
    soldier.step(TICK_DT, { jump: t < hold });
    burstEvents += soldier.drainPackEvents().length;
    apex = Math.max(apex, soldier.y - t0);
    heatPeak = Math.max(heatPeak, soldier.pack?.heat ?? 0);
    if (!clips && soldier.rocketClips()) clips = soldier.rocketClips();
  }
  return { apex, burstEvents, heatPeak, clips, endGrounded: soldier.grounded,
           heat: soldier.pack?.heat ?? null, damping: soldier.kitDamping };
}
results.plainJump = flight(0.1, { worn: false });
results.packJump = flight(0.1);
results.packHeld = flight(2.0);
results.packTap = flight(0.05);

// The fall: from 30 m (an AI bailout velocity is nothing here), billed by
// `fallDamageFor` the way `world-soldier-tick.js` bills it.
const TABLES = (() => {
  const tables = { materials: {}, modifiers: {} };
  for (let id = 0; id <= 15; id++) {
    tables.materials[String(id)] = { attGroup: id, defGroup: id, damage: 30.0 };
    tables.modifiers[String(id)] = { 40: id === 1 ? 1.5e-05 : 0.001 };
  }
  tables.materials['40'] = { attGroup: 40, defGroup: 40, damage: 10.0 };
  return tables;
})();
function fall(worn) {
  const soldier = new Soldier({ collider: flat(), worldSize: WORLD });
  if (worn) soldier.packSource = () => SPEC;
  soldier.bailOut(MID_X, 40, MID_Z, 0, 0, 0, 0);
  soldier.chute.freeFallBarred = worn;       // PARA-11: a pack never opens a chute
  let landing = null;
  for (let i = 0; i < 60 * 30 && !landing; i++) {
    soldier.step(TICK_DT, {});
    landing = soldier.landing;
  }
  if (!landing) return null;
  const withKit = fallDamageFor(landing, TABLES, { kitDamping: soldier.kitDamping });
  const plain = fallDamageFor(landing, TABLES, { kitDamping: 1 });
  return { impact: landing.impactSpeed, fallHeight: landing.fallHeight, damping: soldier.kitDamping, withKit, plain };
}
results.fallPack = fall(true);
results.fallPlain = fall(false);

// Blocked: crouched, the pack lifts nothing.
{
  const soldier = wearer(true);
  const y0 = soldier.y;
  for (let i = 0; i < 90; i++) soldier.step(TICK_DT, { jump: true, crouch: true });
  results.crouched = { rose: soldier.y - y0, state: soldier.pack.state };
}
// A ceiling 3 m up: no room, no burst.
{
  const soldier = new Soldier({ collider: flat(), worldSize: WORLD });
  soldier.spawn(MID_X, 0, MID_Z, 0);
  soldier.packSource = () => SPEC;
  soldier.headroom = () => false;
  soldier._packRoom = () => false;
  for (let i = 0; i < 120; i++) soldier.step(TICK_DT, { jump: i > 60 });
  results.noRoom = { hasRoom: soldier.pack.hasRoom, heat: soldier.pack.heat, state: soldier.pack.state };
}
// No kit part: nothing changes for anyone else.
{
  const soldier = wearer(false);
  results.noPack = { pack: soldier.pack, damping: soldier.kitDamping, clips: soldier.rocketClips() };
}
process.stdout.write(JSON.stringify(results));
