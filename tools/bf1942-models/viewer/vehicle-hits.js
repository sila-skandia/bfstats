// What a round does when it lands: its direct hit and its splash on the
// hulls and the soldiers (the human, the bots on foot), the tier each hit
// hull shows, the HP-15 input gate on the hull the player sits in and his
// hull's bar, and whose gun fired it. Also the pilot checkbox's own pick of
// a vehicle. Lifted out of map.html (features/vehicle-instance-refactor
// Part 2); `vehicle-damage.js` stays the damage law.

import * as THREE from 'three';
import { findVehicle, findVehicles } from './vehicle-discovery.js';
import { classifyRoot } from './seats.js';
import { soldierExposure, worldBlocker } from './soldier-exposure.js';
import { CHARACTER_HEIGHT } from './physics.js';
import { BOT_BODY_RADIUS, BOT_BODY_HEIGHT } from './bot-referee.js';
import { roundHit } from './soldier-death.js';
import { skeletonHit } from './skeleton-hit.js';
import { FRIENDLY_FIRE_SHIPPED, friendlyDamage, roundPasses } from './friendly-fire.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyDamage`, `applyDamageToPlayer`, `bodyAt`, `bots`, `camera`, `capsulesOf`, `collider`,
 * `currentRoot`, `damageLanded`, `damageVisuals`, `feedVehicleHud`,
 * `friendlyFire` (optional: the server's friendly-fire percentages, the shipped
 * `ServerSettings.con`'s when absent), `guns`,
 * `LOCAL_PLAYER`, `occupancy`, `optOnFoot`, `optPilot`, `raiseHitIndication`
 * (optional: a headless runner has no crosshair), `showDamageTier`,
 * `soldier`, `soldierArmor`, `soldierDead`, `stepWrecks`, `vehicleDamage`,
 * `vehicles`, `world`, `wreckVehicle`.
 */
export function createVehicleHits(page) {
  const vehicleHits = {};

  /** `calcDamage` (`friendly-fire.js`) at the page's percentages. */
  const priceFriendly = (damage, opts) =>
    friendlyDamage(damage, { ...opts, settings: page.friendlyFire ?? FRIENDLY_FIRE_SHIPPED });

  /* The DamageableVehicle the player is sitting in.
   *
   * `registerDamageables` hands the world the same `(owner, node)` pairs it puts
   * in `damageVisuals`, and the world keeps them in a `nodeOwners` WeakMap — so
   * `World.occupiedDamageable` answers this in one lookup where the loop below
   * walks every Armored object in the level. It is asked twice a frame while
   * seated (the HUD's hit-point bar and the burn-down check in `stepDamage`).
   *
   * The scan is kept for the one state the world cannot answer from: `addPlayer`
   * runs only from `setOnFoot(true)`, so a player who never left free fly and
   * climbed straight into a hull through the pilot checkbox has no world player
   * record, and `setPlayerVehicle` silently did nothing for him. Requiring the
   * world's own `player.occupancy` to BE this page's `occupancy` is what makes
   * the fast path exactly the slow one: same node, same owner, same set.
   */
  function occupiedVehicleDamage() {
    if (!page.occupancy?.root) return null;
    if (page.world?.player(page.LOCAL_PLAYER)?.occupancy === page.occupancy) {
      return page.world.occupiedDamageable(page.LOCAL_PLAYER);
    }
    for (const [owner, visual] of page.damageVisuals) {
      if (visual.node === page.occupancy.root) return page.vehicleDamage.get(owner);
    }
    return null;
  }

  /**
   * HP-15's gate for the vehicle the player is in, re-read every tick:
   * `{ blocked, rotationalScale }`. The world runs it (world.js #vehicleTick)
   * and frame() copies that tick's answer into this object so the camera shells
   * (pilot/drive/manned below) and the mobile UI read the same values they
   * always read.
   *
   * `vehicle-damage.js`'s `inputGate` is the rule and carries the addresses. The
   * two things this arrangement preserves are WHEN and WHERE:
   *
   *   - **When.** Every tick, against the live Armor, never latched when a
   *     shell landed. The engine's own two bytes (`SimpleObject+0xed`/`+0xee`)
   *     are persistent state cleared only by the wreck-respawn timer, so polling
   *     matches them — and it is also what makes the gate apply to a hull killed
   *     some *other* way. A vehicle burnt down by `hpLostWhileCriticalDamage`,
   *     drowned, or killed by the combat area's own per-tick `giveDamage`
   *     (which damages the occupied hull through this same `Armor`) refuses the
   *     driver exactly as one killed by a shell does, because none of them are
   *     special-cased: all four write hit points and this reads them back.
   *   - **Where.** `occupancy.turret.inputScale` is the single multiplier
   *     `seats.js` spends (its own `TurretRig.inputScale` comment says why it
   *     lands on the input rather than on the servo), which covers the driver's
   *     turret in `drive()` and a gunner's in `manned()` alike. The harder
   *     destroyed gate is `drive()`'s, below.
   *
   * `PlayerControlObject::handlePlayerInput`'s early return is per-PCO and so
   * covers a destroyed plane too. Its turret input IS already scaled, because
   * that goes through the same rig.
   */
  const vehicleInput = { blocked: false, rotationalScale: 1 };
  /** The world's HP-15 gate answer for the local player this tick (`gate` is
   *  the step's readback; none when he has no record). */
  function readGate(gate) {
    vehicleInput.blocked = gate?.blocked ?? false;
    vehicleInput.rotationalScale = gate?.rotationalScale ?? 1;
  }

  // The HP last pushed into the HUD, so a moving bar costs one compare per frame
  // rather than a full `feedVehicleHud()`.
  vehicleHits.fedVehicleHp = null;

  /** Step every damageable thing and reconcile what it is drawing.
   *  The world's step() has already run the drowning (HP-5) and burn passes and
   *  reported every tier/died change in `step.damage`; this half is the scene:
   *  a tier effect, a wreck, the linger-and-fade, and the driver's own HP bar.
   */
  function stepVehicleDamage(step, dt) {
    if (!page.vehicleDamage.size) return;
    for (const change of step.damage) {
      if (change.changed) page.showDamageTier(change.vehicle, change.tier);
      if (change.died) page.wreckVehicle(change.vehicle);
    }
    page.stepWrecks(dt);
    // `feedVehicleHud` runs on entry and on a seat switch, not per tick for a
    // driver — so without this the bar of the tank you are sitting in would stay
    // where it was when you climbed in while the thing burned down under you.
    const live = occupiedVehicleDamage();
    const hp = live ? live.hitPoints : null;
    if (hp !== vehicleHits.fedVehicleHp) {
      vehicleHits.fedVehicleHp = hp;
      if (live) page.feedVehicleHud();
    }
  }

  /** Re-pick a just-damaged vehicle's tier on the frame the damage landed. */
  function reconcileDamaged(vehicle) {
    // Straight to `update(0)` rather than waiting for the next frame: a killing
    // shot should explode on the frame it lands, not one frame later. A zero dt
    // cannot advance the burn accumulator, so this only re-picks the tier.
    const result = vehicle.update(0);
    if (result.changed) page.showDamageTier(vehicle, result.tier);
    if (result.died) page.wreckVehicle(vehicle);
  }

  /** Scratch for `splashTargets`' world-position reads. */
  const splashPos = new THREE.Vector3();

  /**
   * `MaterialManager.material 40` — the soldier's own defending material, the
   * one `damageMod(205, 40)` keys a grenade's splash off. Same constant
   * `fall-damage.js` uses for the ground-versus-soldier pair.
   */
  const SOLDIER_SPLASH_MATERIAL = 40;

  /**
   * Everything with an Armor that a blast could reach, as `applySplash` wants it:
   * world positions, because `vehicle-damage.js` stays free of three.js. The
   * distance is to the object's origin, which is what the engine measures too
   * (`handleExplosionOnObject`, HP-9) — a tank is not hurt less for being hit on
   * the far corner of its hull.
   *
   * A soldier arrives carrying his own `Armor` and `soldier: true`, which is what
   * earns him HP-10's exposure term. There is one: the player, when he is on foot
   * and alive. He is not a placed object and has no owner id, which is exactly
   * why `applySplash` used to miss him. (The decorative figures that used to
   * stand on the spawn pads were the other kind, and they are gone — see
   * `soldierSpawns` further down for what they actually drew.)
   *
   * A soldier's **object origin** is one metre above his feet
   * (`setCharacterHeight -1.00`, `physics.js`'s `CHARACTER_HEIGHT`), and that is
   * the point both the distance and the exposure samples are measured from.
   */
  function splashTargets() {
    const targets = [];
    for (const [owner, visual] of page.damageVisuals) {
      if (visual?.wrecked || visual?.removed) continue;
      const pos = visual.node.getWorldPosition(splashPos);
      targets.push({ owner, x: pos.x, y: pos.y, z: pos.z });
    }
    if (page.soldier && page.soldierArmor && !page.soldierDead && page.optOnFoot.checked) {
      targets.push({
        owner: -1, armor: page.soldierArmor, soldier: true, pose: page.soldier.pose,
        playerId: page.LOCAL_PLAYER, splashMaterial: SOLDIER_SPLASH_MATERIAL,
        x: page.soldier.x, y: page.soldier.y + CHARACTER_HEIGHT, z: page.soldier.z,
      });
    }
    // The bots on foot are soldiers too: a bot-driven hull's shell reaches them.
    for (const bot of page.bots ?? []) {
      if (bot.vehicle) continue;
      const armor = page.world?.armorOf(bot.playerId);
      const s = page.world?.player(bot.playerId)?.soldier;
      if (!armor || armor.destroyed || !s) continue;
      targets.push({
        owner: -1, armor, soldier: true, pose: s.pose ?? 0, botId: bot.playerId,
        playerId: bot.playerId, splashMaterial: SOLDIER_SPLASH_MATERIAL,
        x: s.x, y: s.y + CHARACTER_HEIGHT, z: s.z,
      });
    }
    return targets;
  }

  /** The bot whose seat fired the round behind `record` (`record.firerGroup`). */
  function botFiringGroup(record) {
    return page.vehicles.firerOf(record?.firerGroup);
  }

  /** `playerId`'s side, or null for nobody the world knows. */
  function teamOf(playerId) {
    return playerId != null ? page.world?.player(playerId)?.team ?? null : null;
  }

  /** The team a hull's PlayerControlObject reports: its crew's, and 0 once
   *  the last of them leaves (`clearTeam`, ledger XHIT-5). */
  function hullTeam(owner) {
    const node = page.damageVisuals.get(owner)?.node;
    const instance = node ? page.vehicles.instanceOf(node) : null;
    for (const playerId of instance?.seats.values() ?? []) {
      const team = teamOf(playerId);
      if (team) return team;
    }
    return 0;
  }

  /**
   * HP-10's exposure for one soldier target: the fraction of
   * `checkForHitOnSoldier`'s samples with a clear line to the blast.
   *
   * `soldier-exposure.js` carries the tables and the addresses; this only hands
   * it the collider. The firer is excluded from the ray the way the engine's own
   * filter holds the source object's root parent (0x0815b616).
   */
  function soldierExposureFor(target, blast) {
    if (!page.collider) return 1;
    const blocked = worldBlocker(page.collider, { skipOwner: -1 });
    return soldierExposure({ x: blast[0], y: blast[1], z: blast[2] },
                           target, target.pose ?? 0, blocked);
  }

  /**
   * Whether a round's landing raises the local player's hit marks
   * (`CrossHair/HitIndicationTime`, ledger XHIT-4 and XHIT-5).
   *
   * `GameServer::giveDamage` (lnxded 0x0814b2e0) raises them before it prices
   * any damage, when the round is the local player's own and the object it
   * met has a `PlayerControlObject` for its root whose team is not 0: every
   * soldier, and a hull only while someone sits in it -- `setTeam` counts the
   * crew in and `clearTeam` zeroes the team when the last one leaves, so an
   * empty vehicle or gun never marks. There is no team comparison (a friendly
   * marks) and no damage floor. Only a direct hit: the engine's explosions
   * never pass through `giveDamage`, so the splash pass never marks.
   */
  function marksTheCrosshair(record) {
    if (!record || roundFirer(record.firerGroup) !== page.LOCAL_PLAYER) return false;
    if (record.target != null) return true;
    if (record.kind !== 'object' || !(record.owner >= 0)) return false;
    const node = page.damageVisuals.get(record.owner)?.node;
    return !!node && !!page.vehicles.instanceOf(node)
      && !page.vehicleDamage.get(record.owner)?.destroyed;
  }

  /**
   * A round landed. Apply the direct hit, then the area pass if the round has
   * one (`damageType 1`: shells, bombs, grenades, the bazooka), and reconcile
   * every tier that moved on the same frame.
   */
  function applyVehicleHit(record) {
    // Asked before any damage lands, as the engine asks before it prices the
    // round: the hit that wrecks a manned hull still marks.
    const marks = marksTheCrosshair(record);
    if (record?.target != null) applyRoundToSoldier(record);
    // Whose round it is: the seat's holder, else the human's own hand weapon
    // (bots resolve their hand weapons in the referee and never fire a
    // `gunfire.js` round). The hull keeps it, so its crew's deaths name him.
    const attacker = botFiringGroup(record) ?? page.LOCAL_PLAYER;
    // The round's side, for `calcDamage` (`friendly-fire.js`): a hull of its
    // own side's is priced by the vehicle ratio, a blast by the splash pair.
    // A round nobody can name has no side and is never scaled.
    const attackerTeam = teamOf(roundFirer(record?.firerGroup));
    const landed = page.vehicleDamage.applyHit(record, attacker, (damage, owner) =>
      priceFriendly(damage, { attackerTeam, victimTeam: hullTeam(owner), soldier: false }));
    if (landed) reconcileDamaged(landed.vehicle);
    if (marks) page.raiseHitIndication?.();
    if (!(record?.splashRadius > 0)) return;
    const splashed = page.vehicleDamage.applySplash(record, splashTargets(), {
      materials: page.guns.materials, modifiers: page.guns.modifiers,
      exposure: soldierExposureFor, attacker,
      scale: (amount, target) => priceFriendly(amount, {
        attackerTeam, splash: true, soldier: !!target.soldier,
        victimTeam: target.soldier ? teamOf(target.playerId) : hullTeam(target.owner),
      }),
    });
    for (const hit of splashed) {
      // A soldier target has no tier to re-pick and no wreck to build; what it
      // has is a figure that should stop standing there. The player's own death
      // is already handled where every other cause of it is.
      if (hit.target?.soldier) {
        if (hit.target.armor === page.soldierArmor) {
          page.applyDamageToPlayer(hit.damage, { x: record.x, y: record.y, z: record.z }, record.team);
        } else if (hit.target.botId) {
          // `applySplash` has already taken `hit.lost` off the bot's Armor;
          // what is left is the bot's side of it (the log, the incoming-fire
          // event, a death).
          const at = record.splashPoint ?? record.point ?? null;
          page.damageLanded(hit.target.botId, hit.lost, attacker, at, { via: `splash ${record.gun ?? ''} d ${hit.distance.toFixed(1)}` });
        }
        if (hit.target.node && hit.vehicle.destroyed) hit.target.node.visible = false;
        continue;
      }
      reconcileDamaged(hit.vehicle);
    }
  }
  const AIR_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'Space',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);

  /**
   * Whether `node`'s root drivetrain is one `pickVehicle`'s checkbox-triggered
   * auto-possess can use: `air`/`ground`, else null. `seats.js`'s own
   * `classifyRoot` (GUN-10, verify-r6.md) sees the fuller picture — `tank`, a
   * manned `gun`, or a bare `seat` — and drives every one of those through the
   * `E`-key/EntryPoint path (`enterVehicle`/`collectEntryPoints` below); this
   * narrower wrapper only exists because the checkbox has never known how to
   * auto-pick anything but a plane or a car, and a Sherman parked with nobody
   * near it is not what a bare "start piloting" click should mean.
   */
  function classifyVehicle(node) {
    const kind = classifyRoot(node);
    return kind === 'air' || kind === 'ground' ? kind : null;
  }

  /**
   * The seat the pilot checkbox takes when nobody points at one: the first
   * aircraft the scene spawns, else the first drivable car. The name trio at
   * the end is for scenes extracted before `extras.physics` existed, whose
   * engines cannot say what they are.
   */
  function pickVehicle() {
    const found = findVehicles(page.currentRoot);
    return found.find(node => classifyVehicle(node) === 'air')
      || found.find(node => classifyVehicle(node) === 'ground')
      || findVehicle(page.currentRoot, 'Corsair')
      || findVehicle(page.currentRoot, 'Spitfire')
      || findVehicle(page.currentRoot, 'Zero');
  }

  // --- bot weapons -----------------------------------------------------------
  //
  // PARITY DEPARTURE (BOT_AI_IMPLEMENTATION_PLAN §5). The plan's parity route —
  // give every bot a real Armor and a shared `firePlayerWeapon` through
  // `guns`/`gunfire.js` — cannot land as written: the viewer's collider carries
  // no soldier body, and no projectile-vs-soldier registration exists anywhere
  // (`guns.onImpact` reaches placed objects and vehicle hulls only). A bot's
  // trigger writing a synthetic weapon group would put real tracers in the air
  // and still deal the player no damage.
  //
  // So the referee (bot-referee.js) keeps the half of parity that is exact and
  // resolves the other half itself: the bot's live facing, the engine's
  // deviation cone and the engine's own direct-hit formula (base material
  // damage x the attacker/defender damageMod pair, `botRoundDamage` below).
  // Only the hit test against a soldier body is an INVENTION stand-in. Recorded
  // as a departure in features/bf1942-ai-research-2026-09-21/IMPLEMENTATION_PLAN.md.

  /** `damage.json`'s default material damage, used until a projectile resolves. */
  const BOT_FALLBACK_DAMAGE = 30;
  /** `MaterialManager.material 40` — the soldier's defending material. */
  const BOT_SOLDIER_MATERIAL = 40;

  /** The damage one bot round does, from the engine's direct-hit formula,
   *  against the soldier material it met (head 40, chest 41, limbs 42: each
   *  its own defence group, `setSkeletonCollisionBone`'s last word). */
  function botRoundDamage(stats = null, defender = BOT_SOLDIER_MATERIAL) {
    // `fireArms.projectile` names the round's template; its attacker material
    // comes from `damage.json`'s projectile table, as for the human's rounds.
    // A bot's weapon data names the projectile template; a hand weapon's gun
    // group carries the projectile spec itself (`{ template, material, ... }`).
    const projectile = stats?.projectile;
    const attacker = page.guns.attackerMaterial(
      typeof projectile === 'string' ? { template: projectile } : projectile ?? null);
    const base = page.guns.materials?.[attacker]?.damage ?? BOT_FALLBACK_DAMAGE;
    const attGroup = page.guns.materials?.[attacker]?.attGroup ?? attacker;
    const defGroup = page.guns.materials?.[defender]?.defGroup ?? defender;
    const mod = page.guns.modifiers?.[attGroup]?.[defGroup] ?? null;
    return base * (mod === null ? 1 : mod);
  }

  /** Whose round it is: the player in the seat that fired `group`, else the
   *  player a hand weapon's group was tagged with when it was built
   *  (`hand-weapon.js`), else null -- a replayed round, or one still in the
   *  air from a seat since vacated. The tag rides on the group object, which
   *  every round keeps, so a weapon swapped while its round flies still
   *  answers. */
  function roundFirer(group) {
    return page.vehicles.firerOf(group) ?? group?.firer ?? null;
  }

  /**
   * `guns.bodyCast`: the first soldier a round's segment meets inside `maxDist`.
   * A drawn body is met through the engine's own capsules (`skeleton-hit.js`),
   * and the capsule's material is the defending material the round is priced
   * against; one nobody draws is the stand-in sphere the hand weapons and the
   * bots also fall back to (`BOT_BODY_RADIUS` about `BOT_BODY_HEIGHT` over the
   * feet), so a man is exactly as hard to hit with a tank's MG as with a rifle.
   *
   * A seated man is a body only where his seat draws him (`referee.bodyAt`: a
   * gunner behind a bare MG, a jeep's passengers); elsewhere his hull is, and
   * the collider has it.
   *
   * Every soldier in the round's path is met, friend or foe, whoever fired it
   * (ledger FF-1): nothing in the engine's contact test compares teams. It
   * passes exactly the firer's own body and anyone seated in the hull he fires
   * from (`roundPasses`). What a friend's hit costs is `applyRoundToSoldier`'s.
   * A round nobody can name -- replayed, or still flying from a seat since
   * vacated -- is taken for the human's, as `applyVehicleHit` bills it.
   */
  function roundBodyCast(ox, oy, oz, dx, dy, dz, maxDist, group) {
    if (!page.world) return null;
    const firer = roundFirer(group) ?? page.LOCAL_PLAYER;
    const r2 = BOT_BODY_RADIUS * BOT_BODY_RADIUS;
    let best = null;
    let bestT = maxDist;
    for (const [id, player] of page.world.players) {
      if (roundPasses(page.world, firer, id)) continue;
      if (page.world.armorOf(id)?.destroyed) continue;
      if (id === page.LOCAL_PLAYER && page.soldierDead) continue;
      let s = page.bodyAt(id);
      if (id === page.LOCAL_PLAYER && !player.occupancy?.root) {
        if (!page.optOnFoot.checked || page.optPilot.checked) continue;
        s = page.soldier;
      }
      if (!s) continue;
      const caps = page.capsulesOf(id);
      let t, x, y, z, nx, ny, nz, material = BOT_SOLDIER_MATERIAL, bone = null;
      if (caps) {
        const met = skeletonHit([ox, oy, oz], [dx, dy, dz], bestT, caps);
        if (!met) continue;
        ({ t, bone } = met);
        [x, y, z] = met.at;
        // A capsule has no entry face worth the name: the impact faces the round.
        nx = -dx; ny = -dy; nz = -dz;
        material = met.material;
      } else {
        // Ray against sphere: the entry point is where the round meets him.
        const cx = s.x - ox, cy = s.y + BOT_BODY_HEIGHT - oy, cz = s.z - oz;
        const along = cx * dx + cy * dy + cz * dz;
        const miss2 = cx * cx + cy * cy + cz * cz - along * along;
        if (miss2 > r2) continue;
        t = along - Math.sqrt(r2 - miss2);
        if (t < 0 || t >= bestT) continue;
        x = ox + dx * t; y = oy + dy * t; z = oz + dz * t;
        nx = (x - s.x) / BOT_BODY_RADIUS;
        ny = (y - s.y - BOT_BODY_HEIGHT) / BOT_BODY_RADIUS;
        nz = (z - s.z) / BOT_BODY_RADIUS;
      }
      bestT = t;
      best = {
        kind: 'soldier', t, x, y, z, nx, ny, nz,
        material, owner: -1, target: id,
        // The round's direction, the man's feet and the bone it met, for his
        // latest collision (`soldier-death.js` `roundHit`).
        travel: [dx, dy, dz], feetY: s.y, seated: !!s.seated, bone,
      };
    }
    return best;
  }

  /** Scratch for `proximityObjects`' node reads. */
  const nearPos = new THREE.Vector3();

  /**
   * `guns.nearObjects`: every hull a proximity-fused round could burst on,
   * as `proximity-fuse.js`'s `fuseTarget` reads them.
   *
   * One list for every hull in the level, driven by the local player, by a
   * bot, coasting, parked, or no one: the engine's own query
   * (`objectManager` +0x30 at 0x0831eafb) asks the world for objects, not for
   * players, so who holds the stick cannot matter. A body in the body world
   * (a driven hull, human or bot, or a parked one) reports the body's own
   * position and velocity; anything else stands still at its node. The mass
   * is the root's authored `ObjectTemplate.mass`, 1.0 when it declares none
   * (the template default, 0x081dbceb).
   *
   * Soldiers are not here: the fuse skips them by class (0x0831eb82).
   *
   * The engine's query radius is measured some way this viewer has not read
   * (origin, or bounding sphere); the prefilter here is the generous one, the
   * origin within `radius` plus the hull's bounding radius, and the fuse law
   * applies the engine's exact origin test after it (0x0831ed1f).
   */
  function proximityObjects(x, y, z, radius) {
    const out = [];
    const bodies = page.world?.bodyWorld ?? null;
    for (const [owner, visual] of page.damageVisuals) {
      if (!visual?.node || visual.wrecked || visual.removed) continue;
      const entry = bodies?.get(owner) ?? null;
      const body = entry ? (entry.driven ?? entry.parked?.body ?? null) : null;
      let px, py, pz;
      if (body) {
        [px, py, pz] = body.pos;
      } else {
        visual.node.getWorldPosition(nearPos);
        px = nearPos.x; py = nearPos.y; pz = nearPos.z;
      }
      const reach = radius + (entry?.spec?.boundingRadius ?? body?.boundingRadius ?? 0);
      const dx = px - x, dy = py - y, dz = pz - z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      const mass = Number(visual.node.userData?.physics?.mass);
      out.push({
        owner, x: px, y: py, z: pz,
        mass: Number.isFinite(mass) && mass > 0 ? mass : 1.0,
        vx: body?.v?.[0] ?? 0, vy: body?.v?.[1] ?? 0, vz: body?.v?.[2] ?? 0,
      });
    }
    return out;
  }

  /** A vehicle round that met a soldier: its direct-hit HP, on him, priced by
   *  `calcDamage` when he is on the firer's side (`friendly-fire.js`). */
  function applyRoundToSoldier(record) {
    const id = record.target;
    const firer = roundFirer(record.firerGroup);
    const firerTeam = teamOf(firer);
    // A man seated in a hull has the hull for his root, and the engine prices
    // him as one: the vehicle ratio.
    const damage = priceFriendly(record.damage, {
      attackerTeam: firerTeam, victimTeam: teamOf(id), soldier: !record.seated,
    });
    if (!(damage > 0)) return;
    const from = firer === page.LOCAL_PLAYER ? page.camera.position.toArray()
      : firer ? page.bots.find(b => b.playerId === firer)?.getPosition() ?? null : null;
    if (firer && firer !== page.LOCAL_PLAYER) {
      page.bots.find(b => b.playerId === firer)?.recordHit(id);
    }
    const [px, py, pz] = record.point ?? [];
    const hit = record.travel && Number.isFinite(py)
      ? roundHit([px - record.travel[0], py - record.travel[1], pz - record.travel[2]],
                 record.point, record.feetY, record.seated, record.bone)
      : null;
    if (id === page.LOCAL_PLAYER) {
      page.applyDamageToPlayer(damage,
        from ? { x: from[0], y: from[1], z: from[2] } : null, firerTeam, hit);
    } else {
      page.applyDamage(id, damage, firer ?? page.LOCAL_PLAYER, from,
                       { via: `round ${record.gun ?? ''}`, hit });
    }
  }

  Object.assign(vehicleHits, {
    AIR_KEYS,
    applyVehicleHit,
    botRoundDamage,
    occupiedVehicleDamage,
    pickVehicle,
    proximityObjects,
    roundBodyCast,
    soldierExposureFor,
    splashPos,
    splashTargets,
    stepVehicleDamage,
    readGate,
    vehicleInput,
  });
  return vehicleHits;
}
