// The scene half of vehicle damage: which placed object owns which Armor, a
// damage tier's smoke and fire hung on the hull, the wreck (its model, the
// crew it kills, the linger and the fade), and the fresh vehicle its spawner
// puts back on the pad. Lifted out of map.html (features/vehicle-instance-
// refactor Part 2); `vehicle-damage.js` stays the simulation.

import * as THREE from 'three';
import { idleFirePose, idleFireState } from './idle-vehicle.js';
import { deathTier } from './vehicle-damage.js';
import { spawnerWindow } from './game-modes.js';
import { AIRBORNE_MARGIN } from './airborne.js';
import { restoreLift } from './world-vehicle-tick.js';
import { modelFileStem } from './model-file.js';
import { loadFirst, poseBases } from './pose-bases.js';
import { AbandonClock, calcSpawnDelay } from './deployables.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bust`, `clearHitIndicator`, `collider`,
 * `cutVehicleAudio`, `detachSeatCorpse`, `dieInSeat`, `dieInWreck`, `effects`, `exitPoseManned`, `extras`,
 * `fireStates`, `freezeVehicle`, `groundHeight`, `isCollision`, `leaveSeat`, `loader`, `markPilot`,
 * `maxPlayers`, `MODELS_BASE`, `noteHullKiller`, `occupancy`, `optOnFoot`, `placeCamera`,
 * `resetMobileControls`, `respawnVehicleBody`, `retireVehicleBody`,
 * `soldier`, `soldierArmor`, `soldierDead`, `standUp`, `useLens`,
 * `vehicleDamage`, `vehiclePads`, `vehicles`, `world`.
 */
export function createVehicleWrecks(page) {
  const wrecks = {};

  // owner id -> { node, anchors: Map<effectName, Object3D>, handles: [] }, the
  // scene-side bookkeeping a tier change needs to undo.
  const damageVisuals = new Map();
  /** Why a template's wreck glb did not load, per template. A wreck that never
   *  arrives and a wreck that was never asked for look identical in the world. */
  const loadFailures = new Map();

  /**
   * Register every placed object that carries an `armor` extras block. Most of a
   * level has none — a palm and a sandbag have no Armor at all (ARM-3) — so this
   * is a handful of vehicles and stationary guns out of hundreds of objects.
   */
  function registerDamageables(ownerRoots) {
    clearDamageVisuals();
    page.vehicleDamage.clear();
    padsRegistered = page.vehiclePads?.pads ?? null;
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
        ownerOfNode.set(node, owner);
      }
    }
  }

  /** Placed node -> its Armor's owner id, for the pads (`stepPads`). */
  let ownerOfNode = new WeakMap();
  /** The pad list `registerDamageables` last answered for. */
  let padsRegistered = null;

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
    // The level's flying wrecks go with the level: `damageVisuals` is what
    // holds them (`visual.falling`), and the world would otherwise keep
    // integrating drives whose scene graph is gone.
    page.world.falling.clear();
    for (const visual of damageVisuals.values()) {
      for (const handle of visual.handles) handle.stop?.();
      visual.handles.length = 0;
      for (const anchor of visual.anchors.values()) anchor.parent?.remove(anchor);
      visual.anchors.clear();
    }
    damageVisuals.clear();
    ownerOfNode = new WeakMap();
    abandonClocks = new WeakMap();
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

  /**
   * Start a tier's bundles on the object, each where the engine puts it: a
   * child of the object at its authored offset, turned with it and with no
   * turn of its own (ledger ARM-11, `Armor::playEffect` lnxded 0x08172960).
   * An anchor per entry, so two entries of one bundle at two offsets
   * (Clacton's two `e_ScrapAABase` in its death tier) are two effects at two
   * places rather than one anchor moved twice. `key` keeps one tier's anchors
   * apart from another's. Returns the handles.
   *
   * Case is not a concern here even though it looks like one: a Sherman
   * authors `e_scrapmetal` and the bundle bakes as `e_ScrapMetal`, but
   * `EffectLibrary` keys on the lowercased name and `get` lowercases its
   * argument — the same case-insensitivity the console language itself has
   * (ledger HP-4, RFA-1).
   */
  function playTier(visual, vehicle, tier, key) {
    const handles = [];
    const entries = (vehicle?.effects ?? []).filter(e => e.hp === tier.threshold);
    entries.forEach((entry, i) => {
      const anchor = damageAnchor(visual, `${key}#${i}`, entry.offset);
      // `damage:` keeps it out of `placeWreck`'s hide pass.
      anchor.name = `damage:${entry.effect}`;
      const handle = page.effects.play(entry.effect, { attach: { object: anchor } });
      if (handle) handles.push(handle);
    });
    return handles;
  }

  /**
   * Start the tier's bundles on this vehicle, having stopped whatever ran
   * before. The death tier comes through here too: `VehicleDamage.update`
   * hands it over as the tier change that comes with the death, as
   * `playEffect` swaps the living tier for `getEffect(0)` (or `-1` in water).
   * Its frame is what a spawn effect stands its object up in: Desert Combat's
   * ruined control tower takes the tower's heading from here.
   */
  function showDamageTier(vehicle, tier) {
    const visual = damageVisuals.get(vehicle.owner);
    if (!visual) return;
    for (const handle of visual.handles) handle.stop?.();
    visual.handles.length = 0;
    if (!tier) return;
    visual.handles.push(...playTier(visual, vehicle, tier, 'tier'));
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

  // How far off its own ride height a plane has to be before its death is a
  // fall rather than a wreck in place, and how close back to it the fall has to
  // come before the crash. Both are framing around the flight model's own floor
  // clamp (`Aircraft.integrate` settles a hull at `floor + groundClearance`):
  // the first keeps a plane taxiing or parked on a strip from being read as
  // airborne, the second is the contact that ends the fall.   [HOUSE RULE]
  const LANDING_MARGIN = 0.25;   // metres
  const LANDING_SPEED = 1.5;     // m/s: quiet enough to be down
  const LANDING_HOLD = 1.0;      // seconds of stillness that mean it

  // Wreck glbs, by level and template name, shared across every vehicle of
  // that type.
  const wreckModels = new Map();
  // Each model tree's `models.json`, by base, read once: template (lower
  // case) -> its catalogue entry.
  const catalogues = new Map();

  function catalogue(base) {
    if (!catalogues.has(base)) {
      catalogues.set(base, fetch(`${base}/models.json${page.bust?.() ?? ''}`)
        .then(response => (response.ok ? response.json() : null))
        .then(list => new Map((Array.isArray(list) ? list : [])
          .filter(entry => entry?.name)
          .map(entry => [String(entry.name).toLowerCase(), entry])))
        .catch(() => new Map()));
    }
    return catalogues.get(base);
  }

  /**
   * Where `template`'s wreck is: the URLs to try in order, none when the
   * game gives it no wreck.
   *
   * A mod inherits every template of the mods under it (`game.addModPath`),
   * so the trees are asked the way the engine resolves a name: the active
   * mod's first, then vanilla's (`poseBases`), and the first catalogue that
   * lists the template decides. XPack1's and XPack2's trees hold only what
   * the pack declares (`extract_all.py --own`), so a Sherman dying on a pack
   * map asked the pack's tree alone, 404'd, and burned out wearing its intact
   * mesh. A catalogue entry with no `wreck` variant is a template with no
   * destroyed alternative (`LodSelectorTemplate.hasDestroyedLod`), and
   * nothing is fetched for it. Among wreck variants the level's own reskin
   * wins, as the replay's does (`replay-assets.js` `modelFile`).
   *
   * A template no catalogue lists is still probed in each tree, when its
   * placed node draws anything (`drawn`): vanilla's Battle of Britain Ju88A
   * has its wreck glbs but predates the catalogue that lists level-declared
   * templates. One that draws nothing has no LodObject to be destroyed in:
   * Desert Combat's Operation Bragg groups its Talil airbase spawns under
   * armoured, meshless `UST`/`IST`/`USK`/`ISK`, and each of their deaths
   * asked two trees for a wreck that exists in neither.
   */
  async function wreckUrls(template, { drawn = true } = {}) {
    return variantUrls(template, 'wreck', { drawn });
  }

  /**
   * Where `template`'s intact model is, the same way: what a pad loads for
   * the side its level did not bake (`level-statics.js` `loadPadVariants`).
   */
  async function modelUrls(template) {
    return variantUrls(template, 'complex');
  }

  async function variantUrls(template, configuration, { drawn = true } = {}) {
    const key = String(template || '').toLowerCase();
    if (!key) return [];
    const level = String(page.extras?.level ?? '').toLowerCase();
    const bases = poseBases(page.MODELS_BASE);
    const bust = page.bust?.() ?? '';
    for (const base of bases) {
      const entry = (await catalogue(base)).get(key);
      if (!entry) continue;
      const found = (entry.variants || []).filter(variant =>
        variant?.glb && variant.configuration === configuration && !variant.firstPerson);
      const pick = found.find(variant => String(variant.level ?? '').toLowerCase() === level)
        ?? found.find(variant => !variant.level)
        ?? found[0];
      if (pick) return [`${base}/${pick.glb}${bust}`];
      if (configuration === 'complex' && entry.glb) return [`${base}/${entry.glb}${bust}`];
      return [];
    }
    if (!drawn) return [];
    const suffix = configuration === 'complex' ? '' : `.${configuration}`;
    return bases.map(base => `${base}/${modelFileStem(template)}${suffix}.glb${bust}`);
  }

  /** Whether a placed node draws anything a wreck could stand in for. */
  function drawsMesh(node) {
    let found = false;
    node?.traverse?.(obj => {
      if (!found && obj.isMesh && !page.isCollision?.(obj)) found = true;
    });
    return found;
  }

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
    // Read before the crew dies: the seat is emptied and the drive released the
    // moment `killOccupantInWreck` has run, and the fall needs the drive.
    const drive = fallingDriveFor(visual.node);
    visual.wrecked = true;
    visual.wreckAge = 0;
    visual.landingQuiet = 0;
    visual.hidden = [];

    visual.node.updateWorldMatrix(true, false);
    visual.node.getWorldPosition(wreckDeathPos);
    // The death tier is already burning: every caller has just handed it to
    // `showDamageTier` as the tier change the death came with. Playing it
    // again here doubled every death explosion, and stood a spawn effect's
    // object (a ruined objective, a raft) up twice. A hull with no death tier
    // gets the stand-in, on the ground's normal.
    if (!deathTier(vehicle.effects, { inWater: false })) {
      page.effects.play('e_ExplGas', { position: [wreckDeathPos.x, wreckDeathPos.y, wreckDeathPos.z], normal: [0, 1, 0] });
    }

    // Whoever was in it dies with it, and that has to happen HERE — before the
    // seat is torn down below — because this is the one place a vehicle dies,
    // whatever killed it (a shell, the burn-down, drowning, the combat area).
    killOccupantInWreck(visual.node, vehicle.killedBy);
    // A plane shot down in the air does not stop where it was hit. It keeps its
    // body, gets no input, and comes down under the flight model it already had;
    // the crash — the wreck model, the second explosion, the linger and the fade
    // — runs where it lands, on a clock that starts with the impact (`landWreck`).
    if (drive) {
      visual.falling = drive;
      visual.fallingOwner = vehicle.owner;
      drive.fallingWreck = true;
      visual.node.userData.fallingWreck = true;
      page.world.falling.add(drive);
      return;
    }
    page.retireVehicleBody(vehicle.owner);
    await placeWreck(visual, vehicle);
  }

  /**
   * The drive of a plane that was destroyed in the AIR, or null for anything
   * else — a tank on a ridge, a plane burning on its pad, a hull with nobody in
   * it at all.
   *
   * The drive comes from the seat registry while someone holds a seat, and from
   * the registry's record of the hull's last flight when the crew is already
   * gone — which is every crew the player did not kill himself. An AI pilot's
   * death is handled by the referee a tick before the wreck pass reads the hull
   * (`bot-referee.js` `damageLanded` -> `leaveVehicle`), and the instance is
   * dropped with him; without that record the drive was simply absent and the
   * wreck stayed where the hull was killed instead of coming down.
   *
   * The height test then separates a plane that was taxiing (its origin sits at
   * its own ride height over the strip) from one with air under it, with a
   * margin so a hull still on its wheels is never mistaken for one in flight.
   */
  function fallingDriveFor(node) {
    const inst = page.vehicles?.instanceOf?.(node);
    const last = page.vehicles?.lastFlightOf?.(node) ?? null;
    const drive = inst?.drive ?? last?.drive ?? null;
    const kind = inst?.rootKind ?? last?.kind ?? null;
    if (!drive || kind !== 'air') return null;
    const ride = drive.spec?.groundClearance ?? 1.2;
    node.updateWorldMatrix(true, false);
    const y = node.matrixWorld.elements[13];
    return y - surfaceUnder(node.matrixWorld.elements[12], node.matrixWorld.elements[14])
      > ride + AIRBORNE_MARGIN ? drive : null;
  }

  /** The ground or the water under `(x, z)`, whichever is higher. */
  function surfaceUnder(x, z) {
    const ground = page.groundHeight ? page.groundHeight(x, z) : -Infinity;
    const water = page.collider?.waterLevel;
    return Number.isFinite(water) ? Math.max(ground, water) : ground;
  }

  /** Is the falling wreck down?
   *
   * Two ways to be down, because a hull can be held up by something the
   * heightfield does not describe. The first is the flight model's own floor:
   * `Aircraft.integrate` clamps a hull to `floor + groundClearance` and a drop
   * onto terrain or sea settles at exactly its ride height, where this catches
   * it. The second is coming to rest. A carrier deck, a building, another hull
   * are floors to `hull-bodies.js`'s rigid-body world and nothing at all to the
   * flight model, which under a wreck on the Shokaku's deck reports no contact
   * and a `grounded` of false; what gives the crash away there is that a hull
   * nobody flies and nobody thrusts has stopped. It takes a moment of stillness
   * to mean it, because a vertical climb's stall passes through zero on its way
   * back down and a crash fired there would leave a wreck in the air — the
   * thing this whole path exists to stop. */
  function hasLanded(visual, dt) {
    const drive = visual.falling;
    const s = drive?.state;
    if (!s?.position) return true;
    const ride = drive.spec?.groundClearance ?? 1.2;
    if (s.position.y - surfaceUnder(s.position.x, s.position.z) <= ride + LANDING_MARGIN) return true;
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    visual.landingQuiet = speed <= LANDING_SPEED ? (visual.landingQuiet ?? 0) + dt : 0;
    return visual.landingQuiet >= LANDING_HOLD;
  }

  /**
   * The plane has met the ground (or the water): the crash happens here.
   *
   * The wreck's clock restarts on impact. It has been running since the kill,
   * but nothing on it happens while the hull is in the air (a flying wreck has
   * no linger and no fade to give), so a fall that outlasts the linger would
   * otherwise arrive with the clock already expired: the fade would run on the
   * next tick, before the wreck model's glb is back from the loader, and remove
   * a wreck that had not been placed yet -- the crash site showing the intact
   * mesh's last state instead of a wreck. Starting the crash's own clock here
   * gives the wreck the whole linger wherever it came down, which is what
   * "interact with the ground and then fade out" means.
   *
   * What follows is the impact: the second explosion at the point it came down,
   * the wreck model in place of the flying one, the body retired so the hull is
   * scenery, and the node frozen again with the rest of the level.
   */
  function landWreck(owner, visual) {
    const drive = visual.falling;
    visual.falling = null;
    visual.wreckAge = 0;
    if (drive) {
      drive.fallingWreck = false;
      page.world.falling.delete(drive);
    }
    delete visual.node.userData.fallingWreck;
    visual.node.updateWorldMatrix(true, false);
    visual.node.getWorldPosition(wreckDeathPos);
    const inWater = Number.isFinite(page.collider?.waterLevel)
      && wreckDeathPos.y <= page.collider.waterLevel + 0.5;
    const vehicle = page.vehicleDamage.get(owner);
    // The crash's explosion is the death tier again, on its own anchors (the
    // kill's runs may still be burning on theirs), in the hull's frame.
    const death = deathTier(vehicle?.effects, { inWater });
    if (death) playTier(visual, vehicle, death, 'crash');
    else page.effects.play('e_ExplGas', { position: [wreckDeathPos.x, wreckDeathPos.y, wreckDeathPos.z], normal: [0, 1, 0] });
    // The wreck has stopped moving: its drive is not a wreck's any more, and a
    // hull the spawner puts back on the pad has to be able to fly.
    restoreLift(drive);
    page.retireVehicleBody(owner);
    // Back with the level's frozen scenery: the hull is where it came down, and
    // nothing is going to move it again until its spawner puts a fresh one on
    // the pad.
    page.freezeVehicle(visual.node);
    placeWreck(visual, vehicle);
  }

  /**
   * Put the wreck model where the hull stands now and hide the live mesh under
   * it. The body has already been retired by both callers: this is the scene
   * half only, and it is the same code for a crash on the ground at the kill
   * and one that flew first.
   */
  async function placeWreck(visual, vehicle) {
    const template = templateNameOf(visual.node);
    try {
      // Per level as well as per template: the wreck picked is the level's
      // own reskin where it has one.
      const cacheKey = `${String(page.extras?.level ?? '').toLowerCase()}|${template}`;
      if (!wreckModels.has(cacheKey)) {
        wreckModels.set(cacheKey, wreckUrls(template, { drawn: drawsMesh(visual.node) })
          .then(urls => (urls.length ? loadFirst(page.loader, urls) : null))
          .then(g => g?.scene ?? null, () => null));
      }
      const scene = await wreckModels.get(cacheKey);
      // The vehicle may have been cleared (level change) while the glb was in
      // flight, and `damageVisuals` is rebuilt per level — so re-check.
      // Or the pad cleared the wreck and stood a fresh hull up meanwhile.
      if (!scene || damageVisuals.get(vehicle?.owner) !== visual || !visual.wrecked || visual.removed) return;
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
    } catch (error) {
      // No wreck for this template: leave the live mesh up for the linger/fade
      // rather than blanking the pad. Keep the reason: the hull then sits where
      // it came down wearing its intact mesh, which looks like the wreck path
      // never ran at all, and the two are only told apart from the console.
      loadFailures.set(template, String(error?.message ?? error).slice(0, 300));
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
  function killOccupantInWreck(node, killer = null) {
    if (!page.occupancy || page.occupancy.root !== node || page.soldierDead) return;
    // The hull's killer is his (`vehicle-damage.js` `killedBy`): the message
    // log names him when the death latches.
    page.noteHullKiller?.(killer);
    // A wreck cuts off its engine audio immediately -- crash effect plays,
    // engine stops. That hull's only: disposing the whole rack here silenced
    // every bot-crewed hull on the map until its crew next changed seats.
    page.cutVehicleAudio(node);
    page.clearHitIndicator();
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(wreckDeathPos);
    node.getWorldQuaternion(wreckDeathQuat);
    wreckDeathFwd.set(0, 0, -1).applyQuaternion(wreckDeathQuat);
    // The hull's own facing, in the soldier's convention (forward is
    // `(sin yaw, 0, cos yaw)`), so the death cam sits behind the wreck's tail.
    const hullYaw = Math.atan2(wreckDeathFwd.x, wreckDeathFwd.z);
    const exit = page.exitPoseManned(page.occupancy);
    page.leaveSeat();
    page.markPilot(false);
    page.resetMobileControls();
    if (!(page.optOnFoot.checked && page.soldier)) {
      page.placeCamera();
      return;
    }
    page.soldier.collider = page.collider;
    page.soldier.spawn(exit.x, exit.y, exit.z, hullYaw);
    page.standUp();
    page.useLens('foot');
    // The rig stays holstered (`enterVehicle` hid it): retail's vehicle death
    // cam is an overhead shot of the wreck with no first-person weapon in it,
    // and the near pass is gated on `soldierDead` besides. `spawnAtFlag`
    // raises it again with the fresh body.
    // The wreck, not the corpse, is what this shot is of.
    page.dieInWreck({ x: wreckDeathPos.x, y: wreckDeathPos.y, z: wreckDeathPos.z, yaw: hullYaw });
  }

  /**
   * The human killed in his seat by a round, with the hull still whole
   * (`BFSoldier::handleDamage`'s first branch: a soldier with a parent plays
   * `Ub_DieInVehicle` and stays where he sat). Checked once a frame while
   * seated; the wreck path above owns a hull that died.
   *
   *   1. the seat's drawn body becomes the corpse, slumping where it sat;
   *   2. the seat empties, so the next man can take it (and the corpse, which
   *      `bot-visuals.js` clears when anyone sits there, goes with him);
   *   3. the suspended on-foot body is put down, out of sight, at the exit
   *      point and the death cam floats over the corpse. `onFoot()` owns the
   *      rest -- the same countdown and deploy screen as any other death.
   *
   * A seat that draws nobody (a tank driver's) cannot be shot, so this does not
   * reach one; if HP went some other way, the camera frames the seat itself.
   */
  function killOccupantInSeat() {
    if (!page.occupancy || page.soldierDead || !page.soldierArmor?.destroyed) return false;
    const occupancy = page.occupancy;
    // No audio call: the hull is whole and may still be crewed, and
    // `leaveSeat` below drops his claim on it (`vehicle-audio.js`), which
    // plays the shut-down tail only when he was the last one aboard.
    page.clearHitIndicator();
    const seatNode = occupancy.seatInfo?.(occupancy.activeSeatId)?.node ?? occupancy.root;
    seatNode.updateWorldMatrix(true, false);
    seatNode.getWorldQuaternion(wreckDeathQuat);
    wreckDeathFwd.set(0, 0, -1).applyQuaternion(wreckDeathQuat);
    const yaw = Math.atan2(wreckDeathFwd.x, wreckDeathFwd.z);
    const corpse = page.detachSeatCorpse()
      ?? (() => { seatNode.getWorldPosition(wreckDeathPos); return { ...wreckDeathPos }; })();
    const exit = page.exitPoseManned(occupancy);
    page.leaveSeat();
    page.markPilot(false);
    page.resetMobileControls();
    if (!(page.optOnFoot.checked && page.soldier)) {
      page.placeCamera();
      return true;
    }
    page.soldier.collider = page.collider;
    page.soldier.spawn(exit.x, exit.y, exit.z, yaw);
    page.standUp();
    page.useLens('foot');
    page.dieInSeat({ x: corpse.x, y: corpse.y + 1, z: corpse.z, yaw });
    return true;
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
      // A plane that died in the air is still flying: its crash waits for the
      // ground, and nothing on this clock runs until it gets there — no linger,
      // no fade, the intact mesh the whole way down. The crash restarts the
      // clock (`landWreck`), so a fall longer than the linger still leaves the
      // wreck its own full linger at the crash site.
      if (visual.falling && !hasLanded(visual, dt)) continue;
      if (visual.falling) { landWreck(owner, visual); continue; }
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
      // Gone: drop the wreck and open the pad for walking. A pad's own hull is
      // its pad's to bring back (`stepPads`, whose delay has been running since
      // the hull went critical); a node no pad names keeps its own clock.
      clearWreck(owner, visual);
      if (!page.vehiclePads?.padOf?.(visual.node)) visual.respawnIn = spawnDelayFor(visual);
    }
    stepPads(dt);
  }

  /** The wreck goes from the world: its model, its effects and its
   *  collision. The node stays, hidden, for its pad to stand up again. */
  function clearWreck(owner, visual) {
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
  }

  /**
   * The end of a round takes every hull off the field (`clearWorld`
   * 0x081578f0, ledger ROUND-10): the server destroys each root
   * PlayerControlObject outright, intact or burning, and leaves no wreck. The
   * node stays, hidden and with no collision, for its pad to stand a fresh one
   * up (`padWorld.alive` answers no, so the pad's slot is free; the pads keep
   * running through EndGame as `ObjectSpawner::handleFrameUpdate`, which asks
   * no game status, does). A node no pad names comes back at the restart
   * (`restartHulls`). The crew must be out first: the page kills everyone on
   * the same tick. Only a PlayerControlObject goes (every armoured root the
   * trees place is one), and what a spawn effect stood up (`spawned`) is its
   * own module's to remove (HP-20).
   */
  function clearWorld() {
    for (const [owner, visual] of damageVisuals) {
      if (!clearsAtRoundEnd(visual)) continue;
      if (visual.removed) continue;
      if (visual.falling) {
        visual.falling.fallingWreck = false;
        page.world.falling.delete(visual.falling);
        visual.falling = null;
      }
      delete visual.node.userData.fallingWreck;
      if (visual.wrecked) {
        clearWreck(owner, visual);
        continue;
      }
      visual.cleared = true;
      visual.removed = true;
      visual.respawnIn = null;
      for (const handle of visual.handles) handle.stop?.();
      visual.handles.length = 0;
      const vehicle = page.vehicleDamage.get(owner);
      if (vehicle) showDamageTier(vehicle, null);
      visual.node.visible = false;
      // `vehicleSpawnActive` reads it, so the visibility pass keeps it hidden.
      visual.node.userData.cleared = true;
      page.retireVehicleBody(owner);
      page.collider?.clearMovedOwner?.(owner, { enable: false });
      page.collider?.statics?.disableOwner?.(owner);
    }
  }

  /** The restart's own pass for the hulls no pad names: each comes back on
   *  its spot at once (`restartMap` has reloaded the level's objects). The
   *  pads' hulls are their pads' (`level-statics.js` `restartVehiclePads`). */
  function restartHulls() {
    for (const [owner, visual] of damageVisuals) {
      if (!clearsAtRoundEnd(visual) || page.vehiclePads?.padOf?.(visual.node)) continue;
      if (visual.removed) respawnVehicle(owner);
    }
  }

  function clearsAtRoundEnd(visual) {
    if (visual.spawned) return false;
    const kind = visual.node?.userData?.templateKind;
    return !kind || kind === 'PlayerControlObject';
  }

  /** The server the next delay is drawn for: every player in the world, bots
   *  included, against the page's slot count (`calcSpawnDelay`, SPAWN-10). */
  function serverCounts() {
    return { players: page.world?.players?.size ?? 0, maxPlayers: page.maxPlayers ?? 0 };
  }

  /** Seconds until a fresh vehicle replaces a node no pad entry names: its
   *  stamped window, drawn as the engine draws a pad's (SPAWN-10). */
  function spawnDelayFor(visual) {
    const d = visual.spawnDelay;
    if (d) {
      const min = Number.isFinite(d.min) ? d.min : 30;
      const max = Number.isFinite(d.max) ? d.max : min;
      const { players, maxPlayers } = serverCounts();
      return calcSpawnDelay(min, max, players, maxPlayers);
    }
    // Maps extracted before objectSpawns landed: a mid-range house rule.
    return 40;
  }

  // What the pads (`level-statics.js` `stepVehiclePads`) ask of the hulls on
  // them. A node with no Armor never dies.
  const padWorld = {
    players: 0,
    maxPlayers: 0,
    alive(node) {
      const owner = ownerOfNode.get(node);
      return owner == null || !damageVisuals.get(owner)?.removed;
    },
    // `isDestroyed`, not the critical burn before it: a burning hull still
    // holds its pad (SPAWN-11).
    destroyed(node) {
      const owner = ownerOfNode.get(node);
      if (owner == null) return false;
      return !!(damageVisuals.get(owner)?.wrecked || page.vehicleDamage.get(owner)?.destroyed);
    },
    position(node) {
      node.updateWorldMatrix(true, false);
      const e = node.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    },
    destroy(node) {
      const owner = ownerOfNode.get(node);
      const visual = owner == null ? null : damageVisuals.get(owner);
      // A wreck still burning on the pad is replaced, not waited out
      // (`ObjectSpawner::handleFrameUpdate`, SPAWN-11). One still in the air
      // has not come down on the pad.
      if (!visual?.wrecked || visual.removed || visual.falling) return;
      clearWreck(owner, visual);
    },
    spawn(node) {
      const owner = ownerOfNode.get(node);
      if (owner == null) return true;
      return respawnVehicle(owner);
    },
  };

  function stepPads(dt) {
    if (!page.vehiclePads?.stepVehiclePads) return;
    // The pads are the level's from its `indexScene`, and this side's answers
    // are the level's from `registerDamageables`, which runs after it: a frame
    // between the two (a level loading) would draw the first delays for a
    // world nobody has joined yet.
    if (page.vehiclePads.pads && page.vehiclePads.pads !== padsRegistered) return;
    stepAbandoned(dt);
    Object.assign(padWorld, serverCounts());
    page.vehiclePads.stepVehiclePads(dt, padWorld);
  }

  // node -> AbandonClock: the countdown `spawnObject` arms on every vehicle
  // a pad stands up (ledger SPAWN-13), dropped with the hull it timed.
  let abandonClocks = new WeakMap();

  /** Every live soldier on foot, at his origin (feet plus a metre): the
   *  clock's "near" test walks every alive player whose object is a soldier. */
  function footOrigins() {
    const out = [];
    const world = page.world;
    for (const [id, player] of world?.players ?? []) {
      const s = player?.soldier;
      if (!s || world.armorOf?.(id)?.destroyed || page.vehicles?.seatOf?.(id)) continue;
      out.push([s.x, s.y + CHARACTER_HEIGHT, s.z]);
    }
    return out;
  }

  /**
   * The abandoned hulls' clocks (`PlayerControlObject::handleFrameUpdate`,
   * SPAWN-13): a pad's hull standing farther than its spawner's `Distance`
   * from the pad, with nobody in it and no soldier on foot within its
   * bounding radius, counts down `TimeToLive` and then loses `damageWhenLost`
   * a second, into its own critical burn. Only a scene that carries the words
   * (`objectSpawns[].timeToLive`, the exporter since 2026-10-06) arms them; an
   * older one keeps hulls that never time out, as before. The out-of-world
   * bill after it (SPAWN-20) is not modelled.
   */
  function stepAbandoned(dt) {
    const pads = page.vehiclePads?.pads;
    if (!pads?.length || !(dt > 0)) return;
    let feet = null;
    for (const record of pads) {
      const spec = record.spawn;
      if (!Number.isFinite(spec?.timeToLive)) continue;
      for (const node of record.live) {
        const owner = ownerOfNode.get(node);
        const visual = owner == null ? null : damageVisuals.get(owner);
        const vehicle = owner == null ? null : page.vehicleDamage.get(owner);
        if (!visual || !vehicle || visual.wrecked || vehicle.destroyed) continue;
        let clock = abandonClocks.get(node);
        if (!clock) {
          clock = new AbandonClock({
            timeToLive: spec.timeToLive,
            distance: Number.isFinite(spec.distance) ? spec.distance : 100,
            damageWhenLost: Number.isFinite(spec.damageWhenLost) ? spec.damageWhenLost : 1,
          });
          abandonClocks.set(node, clock);
        }
        const at = padWorld.position(node);
        const spawnerDistance = Math.hypot(at[0] - record.at[0], at[1] - record.at[1], at[2] - record.at[2]);
        const inst = page.vehicles?.instanceOf?.(node);
        const occupied = !!(inst && !inst.empty);
        // Only a far, empty hull needs the soldiers looked for.
        let soldierNear = false;
        if (spawnerDistance > clock.distance && !occupied) {
          feet ??= footOrigins();
          const r = node.userData?.cullRadius ?? 0;
          soldierNear = feet.some(o =>
            (o[0] - at[0]) ** 2 + (o[1] - at[1]) ** 2 + (o[2] - at[2]) ** 2 < r * r);
        }
        const loss = clock.step(dt, { spawnerAlive: true, spawnerDistance, soldierNear, occupied });
        if (loss > 0) vehicle.damage(loss, null);
      }
    }
  }

  /**
   * Restore a pad: full HP, live mesh, collision back on. The vehicle sits at
   * its original spawn pose — the engine replaces the object at the
   * ObjectSpawner, it does not drag a wreck home. Returns whether it stands.
   */
  function respawnVehicle(owner) {
    const visual = damageVisuals.get(owner);
    const vehicle = page.vehicleDamage.get(owner);
    if (!visual) return false;
    // A wreck still lying where it came down is the same node: it clears first.
    if (visual.wrecked && !visual.removed) return false;
    // Someone is still sitting in the empty pad — wait a beat rather than
    // materialising a hull around them.
    if (page.vehicles.instanceOf(visual.node)) {
      if (!page.vehiclePads?.padOf?.(visual.node)) visual.respawnIn = 1;
      return false;
    }
    visual.respawnIn = null;
    visual.wrecked = false;
    // A fresh hull: `spawnObject` arms its clock anew.
    abandonClocks.delete(visual.node);
    visual.removed = false;
    visual.wreckAge = 0;
    // A hull the end of a round took off the field (`clearWorld`) is shown
    // again; the rest of the reset below is the same as a wreck's.
    if (visual.cleared) {
      visual.cleared = false;
      delete visual.node.userData.cleared;
      visual.node.visible = true;
    }
    // A pad that came back while its last hull was still falling: the fall is
    // over, and the fresh hull on it is a parked vehicle again.
    if (visual.falling) {
      visual.falling.fallingWreck = false;
      page.world.falling.delete(visual.falling);
      visual.falling = null;
    }
    delete visual.node.userData.fallingWreck;
    if (visual.wreck) {
      visual.node.remove(visual.wreck);
      visual.wreck = null;
    }
    for (const child of visual.hidden ?? []) {
      child.visible = true;
      // No-wreck fallthrough fades these in place; undo that, and only that.
      // Keying the undo on `opacity < 1` also caught every material that is
      // translucent by design: the muzzle flash and smoke emitters live in
      // this subtree, their `colorOverTime` leaves opacity below 1 after a
      // shot, and forcing them opaque drew every later puff as a black box
      // (shared material, so every hull of the type).
      child.traverse(obj => {
        if (!obj.material) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          const before = material.userData.preFade;
          if (!before) continue;
          material.opacity = before.opacity;
          material.transparent = before.transparent;
          material.depthWrite = before.depthWrite;
          delete material.userData.preFade;
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
    restoreLift(page.vehicles?.lastFlightOf?.(visual.node)?.drive ?? null);
    vehicle?.reset();
    if (vehicle) showDamageTier(vehicle, null);
    page.collider?.statics?.enableOwner?.(owner);
    visual.node.updateMatrixWorld(true);
    page.respawnVehicleBody(owner);
    return true;
  }

  /** Fade a subtree. Its materials are this wreck's own — see `wreckVehicle`. */
  function fadeNode(root, opacity) {
    root.traverse(obj => {
      if (!obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        // What `respawnVehicle` puts back, taken before the first fade step.
        material.userData.preFade ??= {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
        };
        material.transparent = true;
        material.opacity = opacity;
        // An opaque wreck still writes depth; a fading one must not, or it punches
        // a hole in whatever is behind it.
        material.depthWrite = opacity > 0.99;
      }
    });
  }

  /** What the wreck path knows about every damaged hull, for a live check:
   *  whether it is still in the air, what it is carrying, and why nothing is. */
  function wreckState() {
    const out = [];
    for (const [owner, visual] of damageVisuals) {
      const template = templateNameOf(visual.node);
      const position = visual.falling?.state?.position ?? null;
      out.push({
        owner,
        template,
        node: visual.node?.name ?? null,
        falling: !!visual.falling,
        agl: position ? Math.round((position.y - surfaceUnder(position.x, position.z)) * 10) / 10 : null,
        speed: position
          ? Math.round(Math.hypot(
            visual.falling.state.velocity.x,
            visual.falling.state.velocity.y,
            visual.falling.state.velocity.z) * 10) / 10
          : null,
        wrecked: !!visual.wrecked,
        wreckAge: Math.round((visual.wreckAge ?? 0) * 10) / 10,
        wreckNode: visual.wreck?.name ?? null,
        hidden: (visual.hidden ?? []).length,
        loadFailure: loadFailures.get(template) ?? null,
      });
    }
    return out;
  }

  /** The Armor of a placed hull, or null: what an ObjectiveMode target is
   *  watched through (`objectives.js`). */
  function damageOfNode(node) {
    const owner = node ? ownerOfNode.get(node) : null;
    return owner == null ? null : page.vehicleDamage.get(owner) ?? null;
  }

  Object.assign(wrecks, {
    clearWorld,
    damageOfNode,
    damageVisuals,
    restartHulls,
    loadFailures,
    modelUrls,
    padWorld,
    wreckState,
    registerDamageables,
    showDamageTier,
    killOccupantInSeat,
    stepWrecks,
    templateNameOf,
    wreckUrls,
    wreckVehicle,
  });
  return wrecks;
}
