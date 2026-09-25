// The dropped kits on the map page: the kit a soldier leaves where he falls,
// drawn as the kit's own pickup mesh, turning in place until someone takes it
// or its 30 s are up, and the human's DROP / PICK-UP KIT key. The rules --
// where it rests, how long, how fast it turns, who may take it and from how
// far -- are `kit-drops.js`'s, read out of the engine; this module is the
// three.js half and the wiring to the soldiers.
//
// What lies on the ground is the kit template's own `geometry`
// (`Kit_<Side>_<Class>`, extracted as `<Kit>__pickup.kit.glb`, `kits.json`
// `pickup`): the bag with the kit's weapon beside it and the class badge
// painted on its flap -- red cross, wrench, arrow, scope, tank -- and a blended
// shadow quad under it (`Kits_Shade_H`). That badge is the "little image of
// the kit": part of the model's own texture, not a sprite and not a HUD
// element. The game draws nothing on the HUD for a kit you stand over, and
// plays no sound when you take one.
//
// Drops: a bot killed on foot (the referee's `onDeath`, `opts.seated` false)
// and the human killed on foot (`localPlayer.dieOnFoot`). A death in a seat
// leaves nothing: `killPlayer` destroys that kit on the spot. Pickups: only
// the human, on `c_PIDrop`; the engine's AI never presses it. A pickup swaps:
// his own kit lands at his feet first, then he takes the other's weapons with
// the rounds left in them, its worn parts and its health-bar art
// (`hand-weapon.js` `equipKit`).
//
// Room play: nothing here is replicated, so a joined room neither drops nor
// takes kits (`roomJoined`).

import * as THREE from 'three';
import { KitDrops, ammoRowsFromBotMags, pickupAllowed, restingPlace } from './kit-drops.js';

const DEG = Math.PI / 180;

/** How far above his feet the rest probe starts. The engine casts from his
 *  origin; the page's feet sit ON the floor they stand on, and a ray that
 *  starts exactly on a surface does not meet it. A viewer margin, the same
 *  idea as `WorldCollider.deckHeight`'s millimetre. */
const PROBE_LIFT = 0.1;

/**
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `bindDynamicShading`, `bust`, `carriedAmmo`, `collider`, `currentKit`,
 * `deployTeamId`, `equipKit`, `groundHeight`, `handWeapon`, `loader`,
 * `LOCAL_PLAYER`, `occupancy`, `optOnFoot`, `optPilot`, `params`,
 * `roomJoined`, `scene`, `soldier`, `soldierDead`, `soldierDress`.
 */
export function createKitDropsPage(page) {
  const kitDrops = {};
  const drops = new KitDrops();
  kitDrops.drops = drops;
  /** When the human last took a kit, on `drops.clock` (`BFPlayer` +0x84). */
  kitDrops.lastPickupAt = -Infinity;

  const root = new THREE.Group();
  root.name = 'kit drops';
  let rootScene = null;
  const meshes = new Map();        // record id -> Object3D
  // Per level: glb key -> Promise<{ scene, radius } | null>. The copies are
  // shaded with the level's light (`bindDynamicShading`), so a level change
  // throws them away with the kits.
  let sources = new Map();

  function ensureRoot() {
    if (page.scene && rootScene !== page.scene) {
      page.scene.add(root);
      rootScene = page.scene;
    }
  }

  // --- where it rests --------------------------------------------------------

  const normalScratch = [0, 1, 0];
  function terrainAt(x, z) {
    const field = page.collider?.heightfield;
    if (!field) {
      const y = page.groundHeight?.(x, z);
      return Number.isFinite(y) ? { y, normal: [0, 1, 0] } : null;
    }
    const y = field.height(x, z);
    if (!Number.isFinite(y)) return null;
    field.normal(x, z, normalScratch);
    return { y, normal: [...normalScratch] };
  }

  /** Is `owner` (a static index owner) a vehicle -- anything the engine's
   *  `ObjectDropKitPredicator` refuses as an `IPlayerControlObject`? */
  function isVehicleOwner(statics, owner) {
    for (let n = statics.ownerNodes?.[owner] ?? null; n; n = n.parent) {
      if (n.userData?.templateKind === 'PlayerControlObject') return true;
    }
    return false;
  }

  const castHit = {
    t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: -1, dz: 0,
    material: 0, kind: '', owner: -1, triangle: -1,
  };
  /** The first static surface straight down from `(x, y, z)`, vehicles
   *  passed through, or null. */
  function surfaceBelow(x, y, z, far) {
    const statics = page.collider?.statics;
    if (!statics) return null;
    let top = y + PROBE_LIFT;
    let left = far + PROBE_LIFT;
    let skip = -1;
    for (let i = 0; i < 8 && left > 0; i++) {
      const hit = statics.cast(x, top, z, 0, -1, 0, left, skip, castHit);
      if (!hit) return null;
      if (!isVehicleOwner(statics, hit.owner)) return { y: hit.y, normal: [hit.nx, hit.ny, hit.nz] };
      skip = hit.owner;
      left -= top - hit.y;
      top = hit.y;
    }
    return null;
  }

  const ground = { terrain: terrainAt, castDown: surfaceBelow };

  // --- the mesh ----------------------------------------------------------------

  /** The bounding radius the pickup reach adds (`QuadTreeCuller::getObjects`
   *  adds the object's own): the farthest vertex from the kit's origin. */
  function radiusOf(scene) {
    let r = 0;
    const v = new THREE.Vector3();
    scene.updateMatrixWorld(true);
    scene.traverse(obj => {
      const pos = obj.isMesh ? obj.geometry?.attributes?.position : null;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        r = Math.max(r, v.length());
      }
    });
    return r;
  }

  async function sourceFor(kit) {
    const found = await page.soldierDress?.kitRow(kit);
    const glb = found?.row?.pickup?.glb;
    if (!glb) return null;
    const key = `${found.base}|${glb}`;
    if (!sources.has(key)) {
      const url = `${found.base}/${glb}${page.bust?.() ?? ''}`;
      sources.set(key, page.loader.loadAsync(url).then(gltf => {
        const scene = gltf.scene;
        page.bindDynamicShading?.(scene);
        return { scene, radius: radiusOf(scene) };
      }).catch(err => {
        console.warn(`kit drop mesh ${glb}:`, err);
        return null;
      }));
    }
    return sources.get(key);
  }

  const qBasis = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const az = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  /** Stand `obj` where `record` lies: up along the surface normal, facing the
   *  dead man's heading, turned by its spin about its own up. The mesh's
   *  engine-forward is its -Z (`bf42/gltf.py` mirrors Z), and the engine's
   *  +1 deg a tick is a -1 deg one here for the same reason (yaw changes sign
   *  across the mirror). */
  function pose(obj, record) {
    ay.set(record.normal[0], record.normal[1], record.normal[2]);
    az.set(-Math.sin(record.yaw), 0, -Math.cos(record.yaw));
    az.addScaledVector(ay, -az.dot(ay));
    if (az.lengthSq() < 1e-8) {
      // A heading straight along the normal (a wall): any horizontal will do.
      az.set(0, 0, -1);
      az.addScaledVector(ay, -az.dot(ay));
    }
    az.normalize();
    ax.crossVectors(ay, az).normalize();
    basis.makeBasis(ax, ay, az);
    qBasis.setFromRotationMatrix(basis);
    qSpin.setFromAxisAngle(UP, -record.spin * DEG);
    obj.quaternion.copy(qBasis).multiply(qSpin);
    obj.position.set(record.x, record.y, record.z);
  }

  function showMesh(record) {
    sourceFor(record.kit).then(src => {
      // Taken or gone while it loaded, or a level change since.
      if (!src || !drops.drops.includes(record) || meshes.has(record.id)) return;
      record.radius = src.radius;
      const obj = src.scene.clone(true);
      obj.name = `kit drop ${record.kit}`;
      obj.userData.kitDrop = record.id;
      pose(obj, record);
      ensureRoot();
      root.add(obj);
      meshes.set(record.id, obj);
    });
  }

  function hideMesh(record) {
    const obj = meshes.get(record.id);
    if (!obj) return;
    obj.removeFromParent();
    meshes.delete(record.id);
  }

  // --- drops -------------------------------------------------------------------

  /** Lay `kit` down where a soldier at `at` (`{ x, y, z, yaw }`, his feet)
   *  fell or stood, with the rows of ammunition its weapons carry. */
  function layDown(kit, at, { ammo = [], by = null, team = null } = {}) {
    if (!kit || !at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return null;
    const place = restingPlace(at, ground);
    const record = drops.drop(place, { kit, ammo, by, team });
    if (record) showMesh(record);
    return record;
  }
  kitDrops.layDown = layDown;

  /** A bot's death (the referee's `onDeath`): on foot, his kit stays. */
  kitDrops.botDied = (bot, opts = {}) => {
    if (page.roomJoined || opts?.seated || !bot?.kit) return null;
    const [x, y, z] = bot.getPosition();
    return layDown(bot.kit, { x, y, z, yaw: bot.yaw ?? 0 }, {
      ammo: ammoRowsFromBotMags(bot._mags, bot.weaponData),
      by: bot.playerId, team: bot.team,
    });
  };

  /** The human's death on foot (`localPlayer.dieOnFoot`): the kit he carries
   *  stays, with what he left in it. */
  kitDrops.localDied = () => {
    const s = page.soldier;
    if (page.roomJoined || !s) return null;
    return layDown(page.currentKit?.(page.deployTeamId) ?? null,
      { x: s.x, y: s.y, z: s.z, yaw: s.yaw ?? 0 },
      { ammo: page.carriedAmmo?.() ?? [], by: page.LOCAL_PLAYER, team: page.deployTeamId });
  };

  // --- the human's key ---------------------------------------------------------

  /** Can the human take a kit right now, before the geometry is asked? */
  function humanGate() {
    const s = page.soldier;
    const onFoot = !!s && !!page.optOnFoot?.checked && !page.optPilot?.checked
      && !page.occupancy && !page.soldierDead;
    // `isNotFireingOrHaveRecoil` 0x0827eaf0: the held weapon's fire cycle is
    // over. The page's own cycle clocks: `cool` (a semi-automatic's) and
    // `throwWind` (a throw's wind-up).
    const hw = page.handWeapon;
    const ready = !(hw?.cool > 0) && !(hw?.throwWind > 0);
    return { s, ok: pickupAllowed({ onFoot, ready, now: drops.clock, lastPickupAt: kitDrops.lastPickupAt }) };
  }

  /** `c_PIDrop`: take the nearest kit in reach, dropping his own where he
   *  stands. Returns the record taken, or null. */
  kitDrops.pickup = () => {
    if (page.roomJoined) return null;
    const { s, ok } = humanGate();
    if (!ok) return null;
    const record = drops.nearest(s.x, s.y, s.z);
    if (!record) return null;
    drops.take(record);
    hideMesh(record);
    // `pickupKit` -> `dropKit` first: his own, where he stands, fresh timer.
    const mine = page.currentKit?.(page.deployTeamId) ?? null;
    if (mine) {
      layDown(mine, { x: s.x, y: s.y, z: s.z, yaw: s.yaw ?? 0 },
        { ammo: page.carriedAmmo?.() ?? [], by: page.LOCAL_PLAYER, team: page.deployTeamId });
    }
    page.equipKit?.(record.kit, record.ammo, { team: page.deployTeamId });
    kitDrops.lastPickupAt = drops.clock;
    return record;
  };

  // --- time --------------------------------------------------------------------

  /** `dt` seconds of world time (the page hands in `ticks / 30`): every kit
   *  turns, and those whose 30 s are up go. */
  kitDrops.tick = dt => {
    for (const gone of drops.tick(dt)) hideMesh(gone);
    for (const record of drops.drops) {
      const obj = meshes.get(record.id);
      if (obj) pose(obj, record);
    }
  };

  /** A level change: the kits, their meshes and the level-lit copies go. */
  kitDrops.reset = () => {
    for (const record of [...drops.drops]) hideMesh(record);
    drops.clear();
    drops.clock = 0;
    kitDrops.lastPickupAt = -Infinity;
    for (const pending of sources.values()) {
      pending.then(src => src?.scene.traverse(obj => {
        if (!obj.isMesh) return;
        for (const m of [obj.material].flat()) {
          m?.map?.dispose?.();
          m?.dispose?.();
        }
        obj.geometry?.dispose?.();
      }));
    }
    sources = new Map();
  };

  /** The meshes on the ground now, for a headless check. */
  kitDrops.meshCount = () => meshes.size;

  if (page.params?.has?.('shots')) {
    // Headless hooks: the kits lying about, the human's key, and the kit
    // clock stepped on its own (the world's is `__renderOnce`'s).
    window.__kitDrops = {
      list: () => drops.snapshot(),
      clock: () => drops.clock,
      meshes: () => [...meshes.entries()].map(([id, obj]) => {
        const at = obj.getWorldPosition(new THREE.Vector3());
        return { id, name: obj.name, visible: obj.visible,
                 at: [+at.x.toFixed(3), +at.y.toFixed(3), +at.z.toFixed(3)] };
      }),
      pickup: () => {
        const taken = kitDrops.pickup();
        return taken ? { id: taken.id, kit: taken.kit, by: taken.by } : null;
      },
      advance: seconds => { kitDrops.tick(Number(seconds) || 0); return drops.snapshot(); },
      carried: () => ({ kit: page.currentKit?.(page.deployTeamId) ?? null, ammo: page.carriedAmmo?.() ?? [] }),
      layDown: (kit, x, y, z, yaw = 0) => {
        const r = layDown(kit, { x, y, z, yaw });
        return r ? { id: r.id, y: r.y, normal: r.normal } : null;
      },
    };
  }

  return kitDrops;
}
