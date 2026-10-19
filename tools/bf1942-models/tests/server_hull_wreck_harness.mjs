// Drives `viewer/server-entities.js`'s `hull` outside a browser: the server's
// word that a hull died has to WRECK it, not merely zero its Armor. A local
// round wrecks through `vehicle-hits.js` (`if (change.died)
// page.wreckVehicle(...)`); in authority mode the only damage signal is the
// server's `hull(id, hp, destroyed)` row, so that is where the wreck is placed.
// Without it the intact mesh stood where the hull died with no wreck -- the
// owner's "crashed where you'd expect but no wrecked hull" (2026-10-18).
import * as THREE from 'three';
import { createServerEntities } from './server-entities.js';

const DT_MS = 1000 / 30;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

/** A stand-in for `page.world`'s DamageableVehicle: enough of it for `hull`. */
function fakeArmor(owner) {
  return {
    owner, destroyed: false, hitPoints: 100, effects: [], killedBy: null,
    damage(amt) { this.hitPoints -= amt; if (this.hitPoints <= 0) this.destroyed = true; return amt; },
    heal(amt) { this.hitPoints = Math.min(100, this.hitPoints + amt); },
  };
}

const client = (vehicles) => ({
  vehicles: new Map(vehicles.map(v => [v.id, v])),
  // A pose every frame so the hull is posed (and so registered).
  remoteVehicle: () => ({ x: 10, y: 0, z: 20, q: [0, 0, 0, 1] }),
  playerOwned: () => false,
});

function make(extra = {}) {
  const scene = new THREE.Group();
  const armors = new Map();   // owner -> fakeArmor
  const wrecked = [];         // every wreckVehicle argument, in order
  let ownerSeq = 100;
  const entities = createServerEntities({
    scene,
    model: () => Promise.resolve(new THREE.Group()),
    isKit: () => false,
    collider: () => ({
      addOwner: () => ownerSeq++,
      setMovedOwner: () => {},
      clearMovedOwner: () => {},
      statics: { disableOwner: () => {} },
    }),
    registerDamageable: (owner) => { const a = fakeArmor(owner); armors.set(owner, a); return a; },
    wreckVehicle: (v) => wrecked.push(v),
    ...extra,
  });
  return { entities, armors, wrecked };
}

/** Bring a server hull into existence, loaded and posed (so registered). */
async function standHull(entities, id, template = 'Spitfire') {
  const c = client([{ id, template, cls: 'SimpleObjectNetworkable', spawnPos: [10, 0, 20] }]);
  entities.sync(c, 0);
  await flush();
  entities.sync(c, DT_MS);     // loaded + posed -> register
  return c;
}

const ownerOf = (entities, id) => entities.entityFor(id)?.owner ?? -1;

const out = {};

// The `destroyed` flag: one wreck on the transition, and never a second.
{
  const { entities, armors, wrecked } = make();
  await standHull(entities, 7);
  const armor = armors.get(ownerOf(entities, 7));
  out.destroyedFlag = {
    registered: !!armor,
    wreckedBefore: wrecked.length,
    firstKill: (entities.hull(7, 0, true), { destroyed: armor.destroyed, wrecks: wrecked.length }),
    // A repeat of the same row must not wreck it again.
    secondKill: (entities.hull(7, 0, true), wrecked.length),
    wreckedTheArmor: wrecked[0] === armor,
  };
}

// The hit-point path: hp falling to zero crosses into destruction and wrecks,
// exactly like the flag, and only once.
{
  const { entities, armors, wrecked } = make();
  await standHull(entities, 8);
  const armor = armors.get(ownerOf(entities, 8));
  entities.hull(8, 60);                  // a scratch: still alive, no wreck
  out.hpPath = {
    afterScratch: { hp: armor.hitPoints, wrecks: wrecked.length },
    afterZero: (entities.hull(8, 0), { destroyed: armor.destroyed, wrecks: wrecked.length }),
    thenRepeat: (entities.hull(8, 0), wrecked.length),
  };
}

// A living update never wrecks; healing back up never wrecks.
{
  const { entities, armors, wrecked } = make();
  await standHull(entities, 9);
  const armor = armors.get(ownerOf(entities, 9));
  entities.hull(9, 40);
  entities.hull(9, 80);                  // healed
  out.livingNeverWrecks = { hp: armor.hitPoints, destroyed: armor.destroyed, wrecks: wrecked.length };
}

// The player's own hull: killed while the page DRIVES it (so it has no server
// entity, and the `hull` row event found nothing to wreck), then the crash
// ends the drive and the hull comes back from the table. It must come back a
// wreck -- the standing state is applied on the frame the fresh entity first
// registers, once.
{
  let driven = 50;
  const { entities, armors, wrecked } = make({ drivenId: () => driven });
  const rec = { id: 50, template: 'B17', cls: 'SimpleObjectNetworkable',
                spawnPos: [10, 0, 20], hp: null, destroyed: false };
  const c = client([rec]);
  // While driven, no entity stands for it and no wreck is placed.
  entities.sync(c, 0);
  await flush();
  entities.sync(c, DT_MS);
  const drivenHadEntity = !!entities.entityFor(50);
  // The server's kill arrives while it is still the page's drive: nothing to
  // wreck here (the event found no entity).
  rec.hp = 0; rec.destroyed = true;
  entities.hull(50, 0, true);
  const wreckedWhileDriven = wrecked.length;
  // The crash ends the drive: the hull comes back from the table.
  driven = null;
  entities.sync(c, DT_MS * 2);     // entity re-created (glb load pending)
  await flush();
  entities.sync(c, DT_MS * 3);     // loaded + posed -> registers -> wrecks
  const armor = armors.get(ownerOf(entities, 50));
  out.ownHullReappears = {
    drivenHadEntity,
    wreckedWhileDriven,
    reappeared: !!entities.entityFor(50),
    destroyed: !!armor?.destroyed,
    wrecks: wrecked.length,
  };
  // Another frame must not wreck it again.
  entities.sync(c, DT_MS * 4);
  out.ownHullReappears.afterAnotherFrame = wrecked.length;
}

// The Armor lives on a PlayerControlObject node INSIDE the glb, never on the
// bare group the server builds. `register` must surface it onto the group it
// keys the damageable to, or `vehicleDamage.add` finds no hit points, returns
// null, and the hull never becomes a damageable -- so `wreckVehicle` never
// fires and a bombed hull keeps its intact mesh (owner's report, 2026-10-19).
{
  const regNodes = [];
  const model = () => {
    const g = new THREE.Group();
    const hull = new THREE.Group();
    hull.name = 'Sherman';
    hull.userData = { control: 'Sherman', templateKind: 'PlayerControlObject',
                      armor: { maxHitpoints: 100, hitpoints: 100, effects: [] } };
    g.add(hull);
    return Promise.resolve(g);
  };
  const { entities } = make({
    model,
    registerDamageable: (owner, node) => {
      regNodes.push({ armor: node?.userData?.armor ?? null,
                      templateKind: node?.userData?.templateKind ?? null });
      return fakeArmor(owner);
    },
  });
  await standHull(entities, 11, 'Sherman');
  out.armorSurfaced = {
    registeredWithArmor: regNodes.length > 0 && !!regNodes[0].armor,
    maxHitpoints: regNodes[0]?.armor?.maxHitpoints ?? null,
    templateKind: regNodes[0]?.templateKind ?? null,
  };
}

// The renderer's model cache hands every caller ONE scene per template
// (`netcode-render.js` `model`). Each hull must wear its own copy: adding the
// shared scene reparented it, so of several hulls of one template only the
// last to load drew a mesh, and a wreck's hide pass (`vehicle-wrecks.js`
// `placeWreck`, which hides the group's children) hid the shared scene for
// the template's next hull -- the Wespe that never came back off its pad
// (owner, El Alamein co-op, 2026-10-19).
{
  const shared = new THREE.Group();
  shared.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
  const { entities } = make({ model: () => Promise.resolve(shared) });
  /** Meshes a hull's group would draw: visible all the way down. */
  const drawn = id => {
    const g = entities.entityFor(id)?.group;
    if (!g) return 0;
    let n = 0;
    g.traverseVisible(o => { if (o.isMesh) n++; });
    return n;
  };
  const two = client([
    { id: 20, template: 'Wespe', cls: 'SimpleObjectNetworkable', spawnPos: [10, 0, 20] },
    { id: 21, template: 'Wespe', cls: 'SimpleObjectNetworkable', spawnPos: [30, 0, 20] },
  ]);
  entities.sync(two, 0);
  await flush();
  entities.sync(two, DT_MS);
  const bothDraw = [drawn(20), drawn(21)];
  // Hull 20 dies: the wreck pass hides what its group carried.
  entities.hull(20, 0, true);
  for (const child of entities.entityFor(20).group.children) child.visible = false;
  const afterWreck = [drawn(20), drawn(21)];
  // The server destroys it (`destroyObject`, 10 s on) and its pad stands a
  // fresh one under a new netId.
  const respawn = client([
    { id: 21, template: 'Wespe', cls: 'SimpleObjectNetworkable', spawnPos: [30, 0, 20] },
    { id: 22, template: 'Wespe', cls: 'SimpleObjectNetworkable', spawnPos: [10, 0, 20] },
  ]);
  entities.sync(respawn, DT_MS * 2);
  await flush();
  entities.sync(respawn, DT_MS * 3);
  out.sharedModel = {
    bothDraw,
    afterWreck,
    respawned: [drawn(21), drawn(22)],
    gone: !entities.entityFor(20),
    sourceUntouched: shared.parent === null && shared.visible,
  };
}

console.log(JSON.stringify(out, null, 1));
