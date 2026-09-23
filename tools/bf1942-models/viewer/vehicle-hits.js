// What a round does when it lands: its direct hit and its splash on the
// hulls and the soldiers (the human, the bots on foot), the tier each hit
// hull shows, the HP-15 input gate on the hull the player sits in and his
// hull's bar, and whose gun fired it. Also the pilot checkbox's own pick of
// a vehicle. Lifted out of map.html (features/vehicle-instance-refactor
// Part 2); `vehicle-damage.js` stays the damage law.

import * as THREE from 'three';
import { findVehicle, findVehicles } from './flight.js';
import { classifyRoot } from './seats.js';
import { soldierExposure, worldBlocker } from './soldier-exposure.js';
import { CHARACTER_HEIGHT } from './physics.js';
import { BOT_BODY_RADIUS, BOT_BODY_HEIGHT } from './bot-referee.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyDamage`, `applyDamageToPlayer`, `bots`, `camera`, `collider`,
 * `currentRoot`, `damageLanded`, `damageVisuals`, `feedVehicleHud`, `guns`,
 * `LOCAL_PLAYER`, `occupancy`, `optOnFoot`, `optPilot`, `showDamageTier`,
 * `soldier`, `soldierArmor`, `soldierDead`, `stepWrecks`, `vehicleDamage`,
 * `vehicles`, `world`, `wreckVehicle`.
 */
export function createVehicleHits(page) {
  const vehicleHits = {};

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
        splashMaterial: SOLDIER_SPLASH_MATERIAL,
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
        splashMaterial: SOLDIER_SPLASH_MATERIAL,
        x: s.x, y: s.y + CHARACTER_HEIGHT, z: s.z,
      });
    }
    return targets;
  }

  /** The bot whose seat fired the round behind `record` (`record.firerGroup`). */
  function botFiringGroup(record) {
    return page.vehicles.firerOf(record?.firerGroup);
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
   * A round landed. Apply the direct hit, then the area pass if the round has
   * one (`damageType 1`: shells, bombs, grenades, the bazooka), and reconcile
   * every tier that moved on the same frame.
   */
  function applyVehicleHit(record) {
    if (record?.target != null) applyRoundToSoldier(record);
    // Whose round it is: the seat's holder, else the human's own hand weapon
    // (bots resolve their hand weapons in the referee and never fire a
    // `gunfire.js` round). The hull keeps it, so its crew's deaths name him.
    const attacker = botFiringGroup(record) ?? page.LOCAL_PLAYER;
    const landed = page.vehicleDamage.applyHit(record, attacker);
    if (landed) reconcileDamaged(landed.vehicle);
    if (!(record?.splashRadius > 0)) return;
    const splashed = page.vehicleDamage.applySplash(record, splashTargets(), {
      materials: page.guns.materials, modifiers: page.guns.modifiers,
      exposure: soldierExposureFor, attacker,
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

  /** The damage one bot round does, from the engine's direct-hit formula. */
  function botRoundDamage(stats = null) {
    // `fireArms.projectile` names the round's template; its attacker material
    // comes from `damage.json`'s projectile table, as for the human's rounds.
    const attacker = page.guns.attackerMaterial(stats?.projectile ? { template: stats.projectile } : null);
    const base = page.guns.materials?.[attacker]?.damage ?? BOT_FALLBACK_DAMAGE;
    const attGroup = page.guns.materials?.[attacker]?.attGroup ?? attacker;
    const defGroup = page.guns.materials?.[BOT_SOLDIER_MATERIAL]?.defGroup ?? BOT_SOLDIER_MATERIAL;
    const mod = page.guns.modifiers?.[attGroup]?.[defGroup] ?? null;
    return base * (mod === null ? 1 : mod);
  }

  /** Who fired `group`: the local player (his drivetrain's or seat's guns) or
   *  the bot whose seat it is. Null for a gun nobody is holding. */
  function roundFirer(group) {
    return page.vehicles.firerOf(group);
  }

  /**
   * `guns.bodyCast`: the first soldier a round's segment meets inside `maxDist`.
   * The body is the same stand-in sphere the hand weapons and the bots already
   * resolve against (`BOT_BODY_RADIUS` about `BOT_BODY_HEIGHT` over the feet),
   * so a man is exactly as hard to hit with a tank's MG as with a rifle.
   *
   * A seated man is not a body here — his hull is, and the collider has it. The
   * firer's own side is passed through, the rule every other round path in this
   * file keeps.
   */
  function roundBodyCast(ox, oy, oz, dx, dy, dz, maxDist, group) {
    if (!page.world) return null;
    const firer = roundFirer(group);
    const firerTeam = firer ? page.world.player(firer)?.team ?? null : null;
    const r2 = BOT_BODY_RADIUS * BOT_BODY_RADIUS;
    let best = null;
    let bestT = maxDist;
    for (const [id, player] of page.world.players) {
      if (id === firer) continue;
      if (firerTeam != null && player.team === firerTeam) continue;
      if (player.occupancy?.root || page.world.armorOf(id)?.destroyed) continue;
      let s = player.soldier;
      if (id === page.LOCAL_PLAYER) {
        if (!page.optOnFoot.checked || page.optPilot.checked || page.soldierDead) continue;
        s = page.soldier;
      }
      if (!s) continue;
      // Ray against sphere: the entry point is where the round meets him.
      const cx = s.x - ox, cy = s.y + BOT_BODY_HEIGHT - oy, cz = s.z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      const miss2 = cx * cx + cy * cy + cz * cz - along * along;
      if (miss2 > r2) continue;
      const t = along - Math.sqrt(r2 - miss2);
      if (t < 0 || t >= bestT) continue;
      bestT = t;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      best = {
        kind: 'soldier', t, x, y, z,
        nx: (x - s.x) / BOT_BODY_RADIUS,
        ny: (y - s.y - BOT_BODY_HEIGHT) / BOT_BODY_RADIUS,
        nz: (z - s.z) / BOT_BODY_RADIUS,
        material: BOT_SOLDIER_MATERIAL, owner: -1, target: id,
      };
    }
    return best;
  }

  /** A vehicle round that met a soldier: its direct-hit HP, on him. */
  function applyRoundToSoldier(record) {
    const id = record.target;
    if (!(record.damage > 0)) return;
    const firer = roundFirer(record.firerGroup);
    const firerTeam = firer ? page.world?.player(firer)?.team ?? null : null;
    const from = firer === page.LOCAL_PLAYER ? page.camera.position.toArray()
      : firer ? page.bots.find(b => b.playerId === firer)?.getPosition() ?? null : null;
    if (firer && firer !== page.LOCAL_PLAYER) {
      page.bots.find(b => b.playerId === firer)?.recordHit(id);
    }
    if (id === page.LOCAL_PLAYER) {
      page.applyDamageToPlayer(record.damage,
        from ? { x: from[0], y: from[1], z: from[2] } : null, firerTeam);
    } else {
      page.applyDamage(id, record.damage, firer ?? page.LOCAL_PLAYER, from, { via: `round ${record.gun ?? ''}` });
    }
  }

  Object.assign(vehicleHits, {
    AIR_KEYS,
    applyVehicleHit,
    botRoundDamage,
    occupiedVehicleDamage,
    pickVehicle,
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
