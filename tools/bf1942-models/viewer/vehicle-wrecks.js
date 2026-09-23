// The scene half of vehicle damage: which placed object owns which Armor, a
// damage tier's smoke and fire hung on the hull, the wreck (its model, the
// crew it kills, the linger and the fade), and the fresh vehicle its spawner
// puts back on the pad. Lifted out of map.html (features/vehicle-instance-
// refactor Part 2); `vehicle-damage.js` stays the simulation.

import * as THREE from 'three';
import { idleFirePose, idleFireState } from './idle-vehicle.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { Armor } from './armor.js';
import { deathTier } from './vehicle-damage.js';
import { spawnerWindow } from './game-modes.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bust`, `camera`, `collider`, `DEATH_CAM`,
 * `deathCamShot`, `deathCamTarget`, `deathCamTimer`, `disposeEngineAudio`,
 * `effects`, `exitPoseManned`, `extras`, `fireStates`, `gameHud`,
 * `hitIndicatorDir`, `hitIndicatorTimer`, `hud`, `isCollision`,
 * `lastSoldierHp`, `leaveSeat`, `loader`, `MODELS_BASE`, `occupancy`,
 * `optOnFoot`, `optPilot`, `placeCamera`, `prone`, `resetMobileControls`,
 * `respawnVehicleBody`, `retireVehicleBody`, `soldier`,
 * `SOLDIER_MAX_HP_FALLBACK`, `soldierArmor`, `soldierDead`, `updateHud`,
 * `vehicleDamage`, `vehicles`, `world`.
 */
export function createVehicleWrecks(page) {
  const wrecks = {};

  // owner id -> { node, anchors: Map<effectName, Object3D>, handles: [] }, the
  // scene-side bookkeeping a tier change needs to undo.
  const damageVisuals = new Map();

  /**
   * Register every placed object that carries an `armor` extras block. Most of a
   * level has none — a palm and a sandbag have no Armor at all (ARM-3) — so this
   * is a handful of vehicles and stationary guns out of hundreds of objects.
   */
  function registerDamageables(ownerRoots) {
    clearDamageVisuals();
    page.vehicleDamage.clear();
    // The world registers its side of every Armored owner (its own
    // `vehicleDamage` set IS this array — same object, see show()) and takes
    // the node + a world position for the water pass, so that pass needs no
    // scene graph. A static root never moves, so its registration pose is
    // enough; a hull's position is refreshed from the body world every tick.
    const regPos = new THREE.Vector3();
    for (let owner = 0; owner < ownerRoots.length; owner++) {
      const node = ownerRoots[owner];
      const armorExtras = node?.userData?.armor;
      const vehicle = page.world.addDamageable(owner, node, armorExtras, {
        name: node?.name || null,
        position: node ? (() => {
          node.updateWorldMatrix(true, false);
          node.getWorldPosition(regPos);
          return [regPos.x, regPos.y, regPos.z];
        })() : null,
      });
      if (vehicle) {
        damageVisuals.set(owner, {
          node,
          anchors: new Map(),
          handles: [],
          spawnDelay: spawnDelayForNode(node),
        });
      }
    }
  }

  /**
   * Match a placed spawner node to its ObjectSpawner respawn window.
   * Prefer the glb's own `userData.spawner` (stamped at extract); else nearest
   * `objectSpawns` entry in scene.json by vehicle name + position.
   */
  function spawnDelayForNode(node) {
    // `byMode` on the stamp when two modes time one pad differently.
    const stamped = spawnerWindow(node?.userData?.spawner, page.extras?.gameplayMode);
    if (stamped && (Number.isFinite(stamped.minSpawnDelay)
                    || Number.isFinite(stamped.maxSpawnDelay))) {
      const min = stamped.minSpawnDelay ?? stamped.maxSpawnDelay;
      const max = stamped.maxSpawnDelay ?? min;
      return { min, max };
    }
    const spawns = page.extras?.objectSpawns;
    if (!Array.isArray(spawns) || !spawns.length) return null;
    const want = templateNameOf(node).toLowerCase();
    const pos = node.getWorldPosition(new THREE.Vector3());
    let best = null;
    let bestDist = Infinity;
    for (const spawn of spawns) {
      if ((spawn.vehicle || '').toLowerCase() !== want) continue;
      if (!Number.isFinite(spawn.minSpawnDelay) && !Number.isFinite(spawn.maxSpawnDelay)) {
        continue;
      }
      const [x, y, z] = spawn.position || [];
      const dist = Number.isFinite(x)
        ? Math.hypot(pos.x - x, pos.y - (y || 0), pos.z - z)
        : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = spawn;
      }
    }
    if (!best) return null;
    const min = best.minSpawnDelay ?? best.maxSpawnDelay;
    const max = best.maxSpawnDelay ?? min;
    return { min, max };
  }

  /** Drop every running tier effect. Call on a level change. */
  function clearDamageVisuals() {
    for (const visual of damageVisuals.values()) {
      for (const handle of visual.handles) handle.stop?.();
      visual.handles.length = 0;
      for (const anchor of visual.anchors.values()) anchor.parent?.remove(anchor);
      visual.anchors.clear();
    }
    damageVisuals.clear();
  }

  /**
   * An empty node at an `addArmorEffect` offset, parented to the vehicle so the
   * effect rides with it. `EffectPlayer.play`'s `attach` follows an object's world
   * transform and takes no local offset of its own, so the offset has to be a
   * node — which is also what the engine does with these vectors.
   */
  function damageAnchor(visual, name, offset) {
    let anchor = visual.anchors.get(name);
    if (!anchor) {
      anchor = new THREE.Object3D();
      anchor.name = `damage:${name}`;
      visual.node.add(anchor);
      visual.anchors.set(name, anchor);
    }
    anchor.position.set(offset?.[0] || 0, offset?.[1] || 0, offset?.[2] || 0);
    anchor.updateMatrixWorld(true);
    return anchor;
  }

  /** Start the tier's bundles on this vehicle, having stopped whatever ran before. */
  function showDamageTier(vehicle, tier) {
    const visual = damageVisuals.get(vehicle.owner);
    if (!visual) return;
    for (const handle of visual.handles) handle.stop?.();
    visual.handles.length = 0;
    if (!tier) return;
    for (const name of tier.names) {
      // Case is not a concern here even though it looks like one: a Sherman
      // authors `e_scrapmetal` and the bundle bakes as `e_ScrapMetal`, but
      // `EffectLibrary` keys on the lowercased name and `get` lowercases its
      // argument — the same case-insensitivity the console language itself has
      // (ledger HP-4, RFA-1).
      const entry = vehicle.effects.find(
        e => e.effect === name && e.hp === tier.threshold);
      const anchor = damageAnchor(visual, name, entry?.offset);
      const handle = page.effects.play(name, { attach: { object: anchor } });
      if (handle) visual.handles.push(handle);
    }
  }

  // How long a wreck lies there before it fades, and how long the fade takes.
  //
  // **Not engine numbers.** What removes a wreck in Refractor, and when, is one of
  // the corpus's own open items — `subsystems/hitpoints-and-damage.md` lists the
  // wreck lifetime as untraced, and a vanilla level's respawn timing lives in the
  // spawner rather than the vehicle. These two are chosen to read right and are
  // labelled so nobody mistakes them for findings.
  // Linger matches the measured ~10 s wreck lifetime from a live round capture
  // (features/round-replay-capture/README.md); fade is still a house rule.
  const WRECK_LINGER = 10;  // seconds of wreck before the fade starts
  const WRECK_FADE = 2.5;   // seconds of fade                          [HOUSE RULE]

  // Wreck glbs, by template name, shared across every vehicle of that type.
  const wreckModels = new Map();

  /**
   * The template name behind a placed node. GLTFLoader suffixes duplicate names,
   * so Wake's three Shermans arrive as `Sherman`, `Sherman_1` and `Sherman_2` and
   * all three want `Sherman.wreck.glb`.
   */
  function templateNameOf(node) {
    // Prefer the control tag: GLTFLoader suffixes duplicate scene names
    // (`Sherman_1`), while `userData.control` stays the template the wreck URL
    // was published under.
    return (node?.userData?.control || node?.name || '').replace(/_\d+$/, '');
  }

  /**
   * A vehicle just died: put its wreck in the same place and start the
   * linger-then-fade.
   *
   * The wreck is a glb of its own (`models/<Template>.wreck.glb`) — the same file
   * `replay.js` fetches — not an alternative inside the level scene, which ships
   * only the `complex` configuration. The live mesh stays visible until the
   * wreck is parented (or the load fails), so a slow fetch never blanks the pad.
   * Parked vehicles are frozen for perf — anything added under them must call
   * `updateMatrixWorld(true)` or the wreck draws at the identity.
   */
  async function wreckVehicle(vehicle) {
    const visual = damageVisuals.get(vehicle.owner);
    if (!visual?.node || visual.wrecked) return;
    visual.wrecked = true;
    visual.wreckAge = 0;
    visual.hidden = [];

    visual.node.updateWorldMatrix(true, false);
    visual.node.getWorldPosition(wreckDeathPos);
    const death = deathTier(vehicle.effects, { inWater: false });
    if (death?.names?.length) {
      for (const name of death.names) {
        page.effects.play(name, { position: [wreckDeathPos.x, wreckDeathPos.y, wreckDeathPos.z], normal: [0, 1, 0] });
      }
    } else {
      page.effects.play('e_ExplGas', { position: [wreckDeathPos.x, wreckDeathPos.y, wreckDeathPos.z], normal: [0, 1, 0] });
    }

    // Whoever was in it dies with it, and that has to happen HERE — before the
    // seat is torn down below — because this is the one place a vehicle dies,
    // whatever killed it (a shell, the burn-down, drowning, the combat area).
    killOccupantInWreck(visual.node);
    page.retireVehicleBody(vehicle.owner);
    const template = templateNameOf(visual.node);
    try {
      if (!wreckModels.has(template)) {
        wreckModels.set(template, page.loader.loadAsync(
          `${page.MODELS_BASE}/${template}.wreck.glb${page.bust()}`).then(g => g.scene, () => null));
      }
      const scene = await wreckModels.get(template);
      // The vehicle may have been cleared (level change) while the glb was in
      // flight, and `damageVisuals` is rebuilt per level — so re-check.
      if (!scene || damageVisuals.get(vehicle.owner) !== visual) return;
      const wreck = scene.clone(true);
      wreck.name = `wreck:${template}`;
      // Wreck GLBs ship the same armour-region collision hulls as the live
      // model. The models page shows those behind a checkbox; the map always
      // hides them (see `indexScene`). This load path never hit that walk.
      wreck.traverse(obj => {
        if (page.isCollision(obj)) obj.visible = false;
      });
      // `Object3D.clone` shares materials with the source, so every wreck of a
      // type would fade together — and the source is cached for the next one.
      // Own them here, once, rather than trying to un-share them mid-fade.
      wreck.traverse(obj => {
        if (!obj.material) return;
        obj.material = Array.isArray(obj.material)
          ? obj.material.map(m => m.clone()) : obj.material.clone();
      });
      page.bindDynamicShading(wreck);
      // Hide the intact mesh only once the wreck is ready to replace it.
      for (const child of visual.node.children) {
        if (child.name?.startsWith('damage:')) continue;
        if (child.visible) { child.visible = false; visual.hidden.push(child); }
      }
      visual.node.add(wreck);
      visual.wreck = wreck;
      // Frozen parked vehicles opt out of the per-frame matrix walk; force one
      // recompute so the wreck inherits the spawn pose (same contract as
      // `damageAnchor`).
      visual.node.updateMatrixWorld(true);
    } catch {
      // No wreck for this template: leave the live mesh up for the linger/fade
      // rather than blanking the pad.
    }
  }

  /** Scratch for `killOccupantInWreck`'s world reads. */
  const wreckDeathPos = new THREE.Vector3();
  const wreckDeathQuat = new THREE.Quaternion();
  const wreckDeathFwd = new THREE.Vector3();

  /**
   * The hull the player is sitting in just exploded, so the player dies with it.
   *
   * Retail's shape, and the reason this is not simply "you cannot drive a wreck":
   * a destroyed `PlayerControlObject` kills its occupants, the client opens the
   * spawn screen on local death (`hitpoints-and-damage.md` §7, `FUN_004933d0` →
   * `SpawnScreenStuff::setVisible(true)`), and between the two there is the beat
   * the player spends watching the thing he was driving burn. HP-15's input gate
   * — the part this page already had — is what happens to a wreck *nobody* is in.
   *
   * Three steps, in this order:
   *
   *   1. read the hull's live pose, because the death cam frames the wreck and
   *      the body is left beside it rather than back where he climbed in;
   *   2. empty the seat (`leaveSeat`, which covers a jeep, a tank, a plane
   *      and a bare manned gun alike);
   *   3. put the suspended on-foot body down at the exit point, kill its Armor
   *      and latch the death cam. From there `onFoot()` owns the rest — the same
   *      countdown and the same `openDeploy()` a death on foot runs through.
   *
   * A free-fly pilot (the debug checkbox, no soldier waiting) has no life to
   * lose: the seat still empties, and the camera goes back to the flythrough.
   */
  function killOccupantInWreck(node) {
    if (!page.occupancy || page.occupancy.root !== node || page.soldierDead) return;
    // A wreck cuts off engine audio immediately -- crash effect plays, engine stops
    page.disposeEngineAudio();
    page.hitIndicatorTimer = 0;
    page.hitIndicatorDir = 0;
    if (page.gameHud?.vars) {
      page.gameHud.vars['HitFromDir/HitFromDir'] = 0;
      page.gameHud.vars['HitFromDir/HitFromDirAlpha'] = 0;
    }
    page.lastSoldierHp = null;
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(wreckDeathPos);
    node.getWorldQuaternion(wreckDeathQuat);
    wreckDeathFwd.set(0, 0, -1).applyQuaternion(wreckDeathQuat);
    // The hull's own facing, in the soldier's convention (forward is
    // `(sin yaw, 0, cos yaw)`), so the death cam sits behind the wreck's tail.
    const hullYaw = Math.atan2(wreckDeathFwd.x, wreckDeathFwd.z);
    const exit = page.exitPoseManned(page.occupancy);
    page.leaveSeat();
    page.optPilot.checked = false;
    page.resetMobileControls();
    if (!(page.optOnFoot.checked && page.soldier)) {
      page.placeCamera();
      page.updateHud();
      return;
    }
    page.soldier.collider = page.collider;
    page.soldier.spawn(exit.x, exit.y, exit.z, hullYaw);
    page.prone = false;
    page.camera.fov = FOOT_FOV;
    page.camera.near = 0.2;
    page.camera.updateProjectionMatrix();
    // The rig stays holstered (`enterVehicle` hid it): retail's vehicle death
    // cam is an overhead shot of the wreck with no first-person weapon in it,
    // and the near pass is gated on `soldierDead` besides. `spawnAtFlag`
    // raises it again with the fresh body.
    // A body that climbed in at full health still has it; take all of it, so
    // the `soldierArmor.destroyed` latch in `onFoot()` is not what fires the
    // flow a second time (it cannot: `soldierDead` is set below first).
    if (!page.soldierArmor) page.soldierArmor = new Armor(page.SOLDIER_MAX_HP_FALLBACK);
    page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
    page.soldierDead = true;
    page.deathCamShot = page.DEATH_CAM.vehicle;
    page.deathCamTimer = page.deathCamShot.beat;
    // The wreck, not the corpse, is what this shot is of.
    page.deathCamTarget = { x: wreckDeathPos.x, y: wreckDeathPos.y, z: wreckDeathPos.z,
                       yaw: hullYaw };
    page.hud.textContent = 'killed in action';
  }

  /**
   * Advance the linger-and-fade of every wreck, and remove one once it has gone.
   * Called from `stepVehicleDamage`, so it runs on the same clock as the burn.
   *
   * When the wreck is gone the pad must be walkable again — the collision index
   * still holds the vehicle's baked hull at the spawn pose — and a respawn timer
   * (ObjectSpawner Min/MaxSpawnDelay) starts so a fresh vehicle returns later.
   */
  function stepWrecks(dt) {
    for (const [owner, visual] of damageVisuals) {
      if (visual.respawnIn != null) {
        visual.respawnIn -= dt;
        if (visual.respawnIn <= 0) respawnVehicle(owner);
        continue;
      }
      if (!visual.wrecked || visual.removed) continue;
      visual.wreckAge += dt;
      const into = visual.wreckAge - WRECK_LINGER;
      if (into <= 0) continue;
      const opacity = Math.max(0, 1 - into / WRECK_FADE);
      if (visual.wreck) fadeNode(visual.wreck, opacity);
      else {
        // No wreck GLB: fade the intact mesh that stayed visible instead.
        for (const child of visual.node.children) {
          if (child.name?.startsWith('damage:')) continue;
          fadeNode(child, opacity);
        }
      }
      if (opacity > 0) continue;
      // Gone: drop the wreck, open the pad for walking, start the respawn clock.
      visual.removed = true;
      if (visual.wreck) { visual.node.remove(visual.wreck); visual.wreck = null; }
      for (const child of visual.hidden) child.visible = false;
      for (const handle of visual.handles) handle.stop?.();
      visual.handles.length = 0;
      // A hull the body world had moved is answered through the moved-owner
      // path, which ignores the disabled flag; drop that too or the faded wreck
      // stays solid.
      page.collider?.clearMovedOwner?.(owner, { enable: false });
      page.collider?.statics?.disableOwner?.(owner);
      visual.respawnIn = spawnDelayFor(visual);
    }
  }

  /** Seconds until a fresh vehicle replaces this pad, from ObjectSpawner data. */
  function spawnDelayFor(visual) {
    const d = visual.spawnDelay;
    if (d) {
      const min = Number.isFinite(d.min) ? d.min : 30;
      const max = Number.isFinite(d.max) ? d.max : min;
      return min + Math.random() * Math.max(0, max - min);
    }
    // Maps extracted before objectSpawns landed: a mid-range house rule.
    return 40;
  }

  /**
   * Restore a pad after its respawn timer: full HP, live mesh, collision back on.
   * The vehicle sits at its original spawn pose — the engine replaces the object
   * at the ObjectSpawner, it does not drag a wreck home.
   */
  function respawnVehicle(owner) {
    const visual = damageVisuals.get(owner);
    const vehicle = page.vehicleDamage.get(owner);
    if (!visual) return;
    // Someone is still sitting in the empty pad — wait a beat rather than
    // materialising a hull around them.
    if (page.vehicles.instanceOf(visual.node)) {
      visual.respawnIn = 1;
      return;
    }
    visual.respawnIn = null;
    visual.wrecked = false;
    visual.removed = false;
    visual.wreckAge = 0;
    if (visual.wreck) {
      visual.node.remove(visual.wreck);
      visual.wreck = null;
    }
    for (const child of visual.hidden) {
      child.visible = true;
      // No-wreck fallthrough fades these in place; undo that.
      child.traverse(obj => {
        if (!obj.material) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          if (!(material.opacity < 1)) continue;
          material.opacity = 1;
          material.transparent = false;
          material.depthWrite = true;
        }
      });
    }
    visual.hidden = [];
    // A fresh object off the ObjectSpawner, not the one that burned. The hull
    // that just came back on was hidden mid-burst — `wreckVehicle` turns the
    // intact mesh off with every lit muzzle flash still flagged visible under
    // it, and the loop above turns the whole subtree back on — so without this
    // a Spitfire crashed with the trigger down respawns firing. Its guns are
    // new too: a full magazine, a cold barrel and no reload running, which is
    // the one moment a vehicle's ammunition is allowed to reset (stepping out
    // and back in is the same object and keeps what it spent).
    idleFirePose(visual.node);
    idleFireState(visual.node, [page.fireStates, page.world?.fireStates]);
    vehicle?.reset();
    if (vehicle) showDamageTier(vehicle, null);
    page.collider?.statics?.enableOwner?.(owner);
    visual.node.updateMatrixWorld(true);
    page.respawnVehicleBody(owner);
  }

  /** Fade a subtree. Its materials are this wreck's own — see `wreckVehicle`. */
  function fadeNode(root, opacity) {
    root.traverse(obj => {
      if (!obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = opacity;
        // An opaque wreck still writes depth; a fading one must not, or it punches
        // a hole in whatever is behind it.
        material.depthWrite = opacity > 0.99;
      }
    });
  }

  Object.assign(wrecks, {
    damageVisuals,
    registerDamageables,
    showDamageTier,
    stepWrecks,
    templateNameOf,
    wreckVehicle,
  });
  return wrecks;
}
