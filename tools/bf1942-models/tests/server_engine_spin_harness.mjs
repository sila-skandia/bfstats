// Drives `viewer/server-entities.js`'s engine spin outside a browser: a hull
// the SERVER stands turns its propellers on the revs the server sent for its
// Engine children, not on any local physics (PHY-30; the revs reach us through
// `sidecar/ghost/engine.mjs`, mask bit 0x080 = PhysicsEngine+0xa0).
import * as THREE from 'three';
import { createServerEntities } from './server-entities.js';

const DT_MS = 1000 / 30;

const lodPair = (prefix, comparison) => {
  const lod = new THREE.Object3D();
  lod.name = `lod${prefix}`;
  lod.userData = { templateKind: 'LodObject', propellerBlur: {
    static: `${prefix}Static`, blurred: `${prefix}Blurred`, selectorKind: 'CompareSelector',
    distances: [], comparisons: [comparison] } };
  const a = new THREE.Object3D(); a.name = `${prefix}Static`;
  const b = new THREE.Object3D(); b.name = `${prefix}Blurred`;
  lod.add(a, b);
  return lod;
};
const engineNode = (name, lod) => {
  const node = new THREE.Object3D();
  node.name = name;
  node.userData = { templateKind: 'Engine', control: 'Veh',
    physics: { engineType: 'c_ETPlane', maxRotation: [0, 0, 150], maxSpeed: [0, 0, 1000] } };
  node.add(lod);
  return node;
};
/** A hull model: `props` propellers, each under its own Engine. */
const model = (props, comparison = 0.07) => {
  const root = new THREE.Group();
  for (let i = 0; i < props; i++) root.add(engineNode(`Engine${i}`, lodPair(`Prop${i}`, comparison)));
  return root;
};

/** The sidecar client `sync` reads: an object table and no live transforms. */
const client = (vehicles) => ({
  vehicles: new Map(vehicles.map(v => [v.id, v])),
  remoteVehicle: () => null,
  playerOwned: () => false,
});

function make(models) {
  const scene = new THREE.Group();
  const entities = createServerEntities({
    scene,
    model: (template) => Promise.resolve(models[template]?.()),
    isKit: () => false,
    collider: () => null,
    registerDamageable: () => null,
  });
  return { entities, scene };
}

const look = (entities, id) => {
  const e = entities.entityFor(id);
  return (e?.spin ?? []).map(p => ({
    revs: +(p.revs ?? 0).toFixed(4),
    blade: p.static.visible && !p.blurred.visible,
    disc: p.blurred.visible && !p.static.visible,
    bladeTurn: +p.staticAngle.toFixed(2),
    discTurn: +p.blurredAngle.toFixed(2),
  }));
};
/** `seconds` of frames at the engine tick, with `v.revs` as the server has it. */
const run = (entities, c, seconds, t0) => {
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 1000 / DT_MS); i++) { t += DT_MS; entities.sync(c, t); }
  return t;
};

const out = {};

// A single-engine fighter, parked and then flying.
{
  const { entities } = make({ Spitfire: () => model(1) });
  const v = { id: 7, template: 'Spitfire', cls: 'SimpleObjectNetworkable', spawnPos: [10, 0, 20], revs: undefined };
  const c = client([v]);
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  out.loaded = { props: entities.entityFor(7)?.spin?.length ?? 0, ...{ pairs: look(entities, 7) } };

  // No engine row yet: a parked hull's blade stands at its authored pose.
  let t = run(entities, c, 1, DT_MS);
  out.noRow = look(entities, 7);

  // The server says revs 0 -- still parked.
  v.revs = [0];
  t = run(entities, c, 1, t);
  out.revsZero = look(entities, 7);

  // Under power. 0.96 is the live maximum (the 1.2 clamp over the writer's
  // 1.25); a second of it is 30 ticks * 0.96 * 20 = 576 degrees.
  v.revs = [0.96];
  t = run(entities, c, 1, t);
  out.flying = look(entities, 7);

  // Below the split the step is revs*400 a tick, and the disc is current
  // only past comparison^2 (0.0049 for a 0.07 propeller).
  v.revs = [0.05];
  const before = look(entities, 7)[0];
  t = run(entities, c, 1, t);
  const after = look(entities, 7)[0];
  out.slow = { disc: after.disc, blade: after.blade,
               degrees: +(after.bladeTurn - before.bladeTurn).toFixed(2) };

  // Under the disc threshold: 0.002 < 0.0049, the blade is drawn.
  v.revs = [0.002];
  t = run(entities, c, 0.2, t);
  out.underThreshold = look(entities, 7)[0];

  // Engine cut: back to 0 and the blade stops where it is.
  v.revs = [0];
  const stopped = look(entities, 7)[0].bladeTurn;
  t = run(entities, c, 1, t);
  out.cut = { ...look(entities, 7)[0], held: +(look(entities, 7)[0].bladeTurn - stopped).toFixed(2) };
}

// A four-engine bomber: one revs figure per engine, index for index.
{
  const { entities } = make({ B17: () => model(4) });
  const v = { id: 9, template: 'B17', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0],
              revs: [0.9, 0.9, 0.45, 0] };
  const c = client([v]);
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  const t = run(entities, c, 1, DT_MS);
  out.bomber = look(entities, 9).map(p => ({ revs: p.revs, disc: p.disc, turn: p.bladeTurn }));

  // One engine shot out: that propeller alone stops. Whichever alternative is
  // current is the one that turns, so the check is the pair's whole travel.
  const travel = () => look(entities, 9).map(p => p.bladeTurn + p.discTurn);
  v.revs = [0.9, 0, 0.45, 0];
  const was = travel();
  run(entities, c, 1, t);
  // `stepLodSpin` keeps its angle inside a turn, so the travel is modular:
  // a second at 0.9 revs is 540 degrees, which reads as 180.
  out.bomberLostOne = travel().map((n, i) => +(((n - was[i]) % 360 + 360) % 360).toFixed(2));
}

// Fewer revs figures than propellers: every pair takes the first engine's.
{
  const { entities } = make({ Stuka: () => model(3) });
  const v = { id: 11, template: 'Stuka', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0], revs: [0.5] };
  const c = client([v]);
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  run(entities, c, 1, DT_MS);
  out.mismatched = look(entities, 11).map(p => p.revs);
}

console.log(JSON.stringify(out, null, 1));
