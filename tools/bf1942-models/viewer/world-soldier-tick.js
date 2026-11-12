// One on-foot player's world tick: the look the tick's input turns, the
// soldier's own body step, and the fall and drowning damage his Armor takes.
// A plain function of the `World` (world.js), called from its tick.

import { fallDamageFor } from './fall-damage.js';
import { ColObjectList, obstacleDamage, obstacleOrigin, OBSTACLE_DAMAGE } from './obstacle.js';
import { SOLDIER_PITCH_GAIN, soldierYawStep } from './mouse-input.js';
import { recoilStep } from './recoil.js';
import { consume } from './world-input.js';
import { soldierCollisionDamage } from './crash-damage.js';
import { SOLDIER_SPEED_MOD } from './fall-damage.js';
import { runOverInputs } from './soldier-resolve.js';
import { KILL_MATERIAL_DAMAGE } from './soldier-locomotion.js';

const DEG_TO_RAD = Math.PI / 180;
// The tick's recoil share, reused (nothing allocates per tick).
const _recoil = { x: 0, y: 0 };
// The tick's yaw step, reused.
const _yaw = { twist: 0, view: 0 };

export function soldierTick(world, player, dt) {
  const soldier = player.soldier;
  if (!soldier) return;
  // Definitely one input this tick: the engine turns the view by the
  // per-tick axis of the entry the tick consumed (GUN-2b). The run is along
  // the facing from BEFORE that turn and the strafe along the turned one:
  // `handlePlayerInput` copies his forward row at its top (`0x08273d26`),
  // turns him (`0x082745e5`), and reads his right row after (`0x082748eb`).
  // On the lab server a soldier running or crawling while he turned moved
  // along the facing the previous ack carried, 0.5-0.9 mm an ack and 10-33
  // mm off along the turned one (PHY-38). So the
  // look lands after the step, and the step is told it (`turn`) for the
  // strafe row. `soldier.look` owns the +-38 clamp, applied per tick as the
  // engine applies it per PlayerInput. An idle tick carries a zeroed axis, so
  // a missed packet turns nobody.
  const entry = consume(player);
  // The recoil ride rides the same two axes (`recoil.js`, ledger FA-26):
  // `handlePlayerInput` adds this tick's share of the last shot's kick and
  // return to c_PIMouseLookX/Y after the zoom factor and before the law, so
  // it takes the x3 yaw gain and the pitch clamp as the hand does, and a
  // player pulling against the climb pulls against the same number.
  recoilStep(soldier.recoil, soldier.stance, _recoil);
  const x = entry.lookX + _recoil.x;
  const y = entry.lookY + _recoil.y;
  // Moving is the engine's own test: c_PIThrottle or c_PIYaw non-zero after
  // the +-0.1 dead zone (handlePlayerInput reduces both to their sign).
  const inp = entry.input;
  const moving = !!inp && !inp.dead && (Math.abs(inp.forward ?? 0) > 0.1 || Math.abs(inp.strafe ?? 0) > 0.1);
  soldier.lookMoving = moving;
  // The yaw is the engine's own law, the torso twist and its fold included
  // (`soldierYawStep`): the view turns 3 x a tick whether the torso or the body
  // takes it, except on the tick the twist meets its clamp and on a move
  // pressed with the twist already there, where the old 3-or-6 rule and the
  // server parted by 3 to 4.5 degrees (2026-10-22).
  soldierYawStep(soldier.twist, x, moving, undefined, undefined, _yaw);
  soldier.twist = _yaw.twist;
  soldier.lookX = x;
  // The word's own axis, for the lower body's gait (PHY-35): the animation
  // machine's transitions read the PlayerInput, not the recoil's copy.
  soldier.lookInput = entry.lookX;
  // The engine's view yaw turns the other way from the page's.
  const yaw = -_yaw.view * DEG_TO_RAD;
  const pitch = -(y * SOLDIER_PITCH_GAIN) * DEG_TO_RAD;
  // A dead man's body is stepped until he is put back on a flag, and it knows
  // it is dead (`+0x245`): a bot's input never says so, his Armor does. The
  // blast that kills him throws him by the dead arm (`knockback.js`, KNOCK-1).
  const input = player.armor?.destroyed && !entry.input?.dead
    ? { ...entry.input, dead: true } : entry.input;
  soldier.collider = world.collider;
  // The run row is the facing before this look, the strafe row the turned
  // one (`walking-body.js`): the body reads `turn` for the second.
  soldier.step(dt, yaw ? { ...input, turn: yaw } : input);
  if (yaw || pitch) {
    soldier.look(yaw, pitch);
    player.lookApplied.yaw += yaw;
    player.lookApplied.pitch += pitch;
  }
  // Fall damage -- HP-14, the whole formula in fall-damage.js -- applied
  // where the page applied it: the impact speed was sampled before the
  // ground clamp put the body back on the ground.
  if (soldier.landing && player.armor) {
    // `kitDamping`: the least `Damping` of the parts he wears
    // (`getDamageDampingFromActiveKitParts`): XPack2's rocket pack writes 0.0,
    // which leaves a fall the severity of its speed alone (HP-14).
    const hp = fallDamageFor(soldier.landing, world.damageTables, { kitDamping: soldier.kitDamping ?? 1 });
    if (hp > 0) player.armor.applyDamage(hp);
  }
  // Drowning, applied where `Armor::update` applies it and for the same
  // reason the fall damage is applied here: the `Armor` is the player's, not
  // the soldier's. `swim.js`'s `DrownTimer` is the engine's water-damage
  // timer (`Armor::update` `0x08172f40`), armed by `c_AsmIsSwimming` through
  // the soldier-specific clause in `setLastHitMaterialIndex` (`0x08173700`).
  // A frame runs whole ticks and the timer can fire on more than one of them,
  // so the soldier sums it and this drains the sum.
  if (player.armor) {
    const drowned = soldier.drainDrowning?.() ?? 0;
    if (drowned > 0) player.armor.applyDamage(drowned);
  }
  // The kill material: `BFSoldier::handleCollision` bills a soldier touching
  // a material-99 face 1e10 (lnxded 0x0827d3c8 -> 0x0827dda9). A soldier who
  // ends up inside a closed building dies on its floor.
  if (soldier.drainKillFace?.() && player.armor && !player.armor.destroyed) {
    player.armor.applyDamage(KILL_MATERIAL_DAMAGE);
  }
  obstacleTick(world, player, dt);
  runOverTick(world, player, dt);
}

/**
 * SEAT-33: for 2 s after they leave a hull, a soldier's contacts with it
 * cost them nothing (`BFSoldier::setExitedFromVehicle` 0x08277220 stores the
 * root at `+0x580` and posts message 0x16 at 2.0 s, which clears it;
 * `handleCollision` 0x0827d3b0 returns 1 for that object at 0x0827d421,
 * before every damage branch and the collision list). It still pushes.
 */
export const EXIT_GRACE = 2.0;

/**
 * V0's attribution: a hull nobody sits in credits its last occupant while
 * `2.0 > worldTime - lastOccupiedTime` (`getLastOccupidePlayer` /
 * `getLastOccupideTime`, 0x08155f91-0x08155fd3, the double 2.0 at 0x086c0330).
 */
export const LAST_OCCUPANT_WINDOW = 2.0;

/** A hull's collision owner, by its seat root (a walk of the index's owner
 *  list, so cached per root and index). */
const _ownerOfRoot = new WeakMap();
function ownerOfRoot(world, root) {
  const statics = world.collider?.statics;
  if (!root || !statics?.ownerOf) return -1;
  let cached = _ownerOfRoot.get(root);
  if (!cached || cached.statics !== statics) {
    cached = { statics, owner: statics.ownerOf(root) };
    _ownerOfRoot.set(root, cached);
  }
  return cached.owner;
}

/**
 * `player` is leaving the hull they sit in, at world time `now`
 * (`PlayerControlObject::exit` 0x08317d00): the soldier's SEAT-33 record,
 * and for the root seat the hull's last occupant (V0's 2 s credit).
 */
export function noteHullExit(world, player, now) {
  const occ = player?.occupancy;
  if (!occ?.root) return;
  const owner = ownerOfRoot(world, occ.root);
  if (owner < 0) return;
  if (player.soldier) {
    player.soldier.exitedFrom = owner;
    player.soldier.exitedUntil = now + EXIT_GRACE;
  }
  if (occ.isActiveRoot?.() ?? true) {
    (world.lastOccupants ??= new Map()).set(owner, { playerId: player.id, at: now });
  }
}

/**
 * Who a hull's collision is credited to, `{ id, team }` or null:
 * `handleCollisionObjectVsObject` 0x081551c0 walks up from the attacking
 * object to its first IPlayerControlObject (0x08155546-0x0815559d) and takes
 * its occupant (vt+0xc), else its last within 2 s; the id is the player's
 * (vt+0x48) and the team the player's own (`BFPlayer+0x7c`, 0x08155537). A
 * hull's col1 is its root's, whose PCO is the driver's seat, so here it is
 * the driver (a turret's own PCO would be its gunner's: not told apart).
 */
function hullCredit(world, owner, now) {
  for (const [id, p] of world.players) {
    const occ = p.occupancy;
    if (!occ?.root || !(occ.isActiveRoot?.() ?? true)) continue;
    if (ownerOfRoot(world, occ.root) === owner) return { id, team: p.team ?? null };
  }
  const last = world.lastOccupants?.get(owner);
  if (last && now - last.at < LAST_OCCUPANT_WINDOW) {
    return { id: last.playerId, team: world.players.get(last.playerId)?.team ?? null };
  }
  return null;
}

/**
 * A hull that pushed them this tick (`soldier-resolve.js` `pushOutOfHulls`):
 * their `handleCollision` (`BFSoldier::handleCollision` 0x0827d3b0 over
 * `SimpleObject::handleCollision` 0x081dab40) hands the contact to
 * `handleCollisionObjectVsObject` 0x081551c0 with the hull as the attacker,
 * once a second per hull (the Armor's collision list, `Armor::isInColList`
 * 0x081744d0 / `addColObject` 0x08173740, COL-5, the same list the wire
 * uses), and the soldier-victim branch prices it (COL-3; nothing under 8
 * m/s of contact speed, 0x08155a10). Their Armor is the vanilla soldier's:
 * `speedMod 0.5` and `angleMod 1` (HP-14, DMG-3).
 *
 * The damage is `giveDamage(soldier, damage, id, team, -1, ...)` with the
 * hull's driver (`hullCredit`), so the kill is theirs, an enemy's kill or a
 * team kill by the sides as any other (`round-state.js` `kill`); the -1 is
 * the weapon, so the kill line reads `[killed]` (`chat-log.js` `killStamp`'s
 * `roadkill`). V0's same-team clause: when the soldier is on the driver's
 * side and was the faster of the two along the contact's speed, nobody is
 * credited (0x081555ad-0x08155ed1), and `giveDamage` names the soldier's
 * last hitter instead, which the page's `lastAttack` stands for.
 */
function runOverTick(world, player, dt) {
  const soldier = player.soldier;
  const armor = player.armor;
  const touches = soldier?.drainHullTouches?.();
  if (!touches?.length || !armor || armor.destroyed) return;
  // In a room the server's world bills it and sends the hit points
  // (`server/authority.mjs`); the page's copy only pushes.
  if (world.remoteDamage) return;
  if (!armor.colList) armor.colList = new ColObjectList();
  const now = world.ticks * dt;
  for (const t of touches) {
    // SEAT-33: the hull they just left, before anything else.
    if (soldier.exitedFrom === t.owner && now < (soldier.exitedUntil ?? -Infinity)) continue;
    const key = `hull:${t.owner}`;
    if (armor.colList.has(key)) continue;
    armor.colList.add(key);
    const body = soldier.body;
    const fallHeight = body ? body.lastCollisionHeight - body.position.y : 0;
    const inputs = runOverInputs(t, { fallHeight, kitDamping: soldier.kitDamping ?? 1 });
    const damage = soldierCollisionDamage({
      ...inputs, victimSpeedMod: SOLDIER_SPEED_MOD, victimAngleMod: 1,
    }, world.damageTables);
    if (!(damage > 0)) continue;
    let credit = hullCredit(world, t.owner, now);
    if (credit && credit.team != null && credit.team === player.team
        && Math.abs(inputs.victimSpeedAlong) > Math.abs(inputs.attackerSpeedAlong)) credit = null;
    const lost = armor.damage(damage);
    const list = world.report?.runOvers;
    if (list && list.length < 256) {
      list.push({ playerId: player.id, owner: t.owner, attacker: credit?.id ?? null,
                  attackerTeam: credit?.team ?? null, lost, killed: !!armor.destroyed,
                  at: [t.x, t.y, t.z] });
    }
    if (armor.destroyed) break;
  }
}

/**
 * Barbed wire, `BFSoldier::handleCollision`'s Obstacle branch (lnxded
 * 0x0827dc81-0x0827dd40), for every wire the body passed through this tick:
 * the message to the wire (the scrape, reported for the page), and unless
 * the wire is still in the Armor's collision list, the list entry and
 * `giveDamage(soldier, damage, -1, ...)`. The slow half is the body's own
 * (`walking-body.js`). The list ages first, as `Armor::update` does every
 * tick whether anything touched or not, so a wire held against the body
 * bills its 5 HP once a second (`obstacle.js`).
 *
 * `giveDamage`'s attacker is -1, which `GameServer::giveDamage` 0x0814b2e0
 * replaces with the Armor's own last hitter (vt+0x78) and damage type
 * (vt+0x88): the wire itself is credited to nobody.
 */
function obstacleTick(world, player, dt) {
  const soldier = player.soldier;
  const armor = player.armor;
  armor?.colList?.update(dt);
  const touches = soldier?.drainObstacles?.();
  if (!touches?.length) return;
  for (const t of touches) {
    let lost = 0;
    if (armor && !armor.destroyed) {
      const damage = obstacleDamage(armor, t.id, OBSTACLE_DAMAGE);
      if (damage > 0) lost = armor.damage(damage);
    }
    if (world.report.obstacles.length >= 256) continue;
    world.report.obstacles.push({
      id: t.id, x: t.x, y: t.y, z: t.z, origin: obstacleOrigin(world.collider, t.id),
      playerId: player.id, lost, killed: lost > 0 && !!armor?.destroyed,
    });
  }
}
