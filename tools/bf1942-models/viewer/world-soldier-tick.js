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
import { runOverInputs, sweepSeparation, watchHulls } from './soldier-resolve.js';
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
  // The world tick this step is, so a hull track not refreshed on the
  // previous one is re-seeded (`pushOutOfHulls`): one look a tick, and a
  // missed tick (a seat, a pause in the body's steps) is not one tick's move.
  if (soldier.body) soldier.body.worldTick = world.ticks;
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
  hullReactionTick(world, player);
}

/**
 * A seated soldier's hull tracks, kept up to date while their body is not
 * stepped (`soldier-resolve.js` `watchHulls`): the first look after they get
 * out measures one tick of each hull's motion. Left to stand, a track read
 * everything a hull did while they sat as one tick's move: a Willys parked at
 * 0.01 m/s that had crept 1.1 m billed the soldier who stepped out beside it
 * 34 m/s and 177 HP (the driver-avoid builder's rennpiste_gebirge seed 6). A
 * track that still misses a tick is re-seeded there.
 */
export function seatedHullWatch(world, player, dt) {
  const body = player.soldier?.body;
  if (!body?._hullSeen) return;
  body.world = world.collider;
  body.worldTick = world.ticks;
  watchHulls(body, dt);
}

/**
 * A light hull's share of the push it gave this soldier
 * (`soldier-resolve.js` `pushOutOfHulls`, COL-2's `shareB` below the 0.95
 * snap): the hull's own `solveImpulse` (0x08258d30), its position moved by
 * the adjust now and the speed adjust posted as an acceleration at the
 * contact (`addAccelerationAtAbsolutePosition` 0x08255110), on the driven
 * hull's drive or the parked body, whichever holds it. Not woken: the
 * position write applies to a sleeping body, and its step discards what was
 * posted (rigid-body.js `translate`, §4.3).
 */
function hullReactionTick(world, player) {
  const list = player.soldier?.body?.hullReactions;
  if (!list?.length) return;
  const entries = world.bodyWorld?.entries;
  for (const r of list) {
    const entry = entries?.get(r.owner);
    const body = entry?.driven ?? entry?.parked?.body ?? null;
    if (!body || body.isStatic) continue;
    body.translate(r.push);
    body.addAccelerationAt(r.at, r.accel);
  }
  list.length = 0;
}

/** `checkObjectVsObject`'s soldier pair distance: two soldiers closer than
 *  this are pushed apart to it (the `fld1` at lnxded 0x0825a57b against
 *  `|d|^2`, 0x0825a5be). */
export const SOLDIER_SEPARATION = 1.0;
/** Below this `|d|` the push is along +z (0x086c08a4 0.01, the `(0, 0, 1)`
 *  of 0x0825a5e0..0x0825a605). */
const SEPARATION_MIN_DIST = 0.01;
/** The share's floor: each side's weight is at least this times `|push|`
 *  (0x086d16c8 0.9, `fmuls` at 0x0825a78d). */
const SEPARATION_SPEED_FLOOR = 0.9;

/**
 * Soldier against soldier: `ResponsePhysics::checkObjectVsObject` lnxded
 * 0x08259690's branch for two `CID_SoldierTemplate` (0x9493 at 0x086c2b88;
 * 0x082596c5 and 0x0825a4bf), read on our binary 0x0825a4c7..0x0825a8f0:
 *
 *   d    = posB - posA                      (3-D; 0x0825a56c..0x0825a595)
 *   skip unless their boxes overlap in y    (A's box for both, 0x0825a510..)
 *   skip when |d|^2 > 1.0
 *   n    = d / |d|, or (0, 0, 1) below 0.01
 *   push = n (1 - |d|), push.y = 0          (`fsubrp` 0x0825a60d; -0x54 := 0)
 *   both free: sA = max(|vA . push|, 0.9 |push|), sB likewise,
 *              wA = sA / (sA + sB)          (`fdivrp` 0x0825a7eb)
 *              posA -= push wA; posB += push (1 - wA)
 *   A in a vehicle (+0x50): posB += push; B in one: posA -= push; both: none
 *
 * Positions only: no speed is changed and nothing is damaged. The y test is
 * implied by `|d| < 1` for any soldier box a metre or more tall, so it is
 * not repeated here. A seated soldier is not a body in this world (their
 * seat carries them), so only soldiers on foot meet; the dead are left out.
 * Each pair once, in player order, each push seen by the next pair as the
 * engine's position writes are. Run after every soldier has stepped.
 */
export function separateSoldiers(world) {
  const live = _live;
  live.length = 0;
  for (const player of world.players.values()) {
    if (player.occupancy || !player.soldier?.spawned || player.armor?.destroyed) continue;
    live.push(player.soldier.body);
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) separatePair(live[i], live[j]);
  }
  live.length = 0;
}
const _live = [];

function separatePair(a, b) {
  const pa = a.body.position, pb = b.body.position;
  const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > SOLDIER_SEPARATION * SOLDIER_SEPARATION) return;
  const l = Math.sqrt(d2);
  let nx = 0, nz = 1;
  if (l >= SEPARATION_MIN_DIST) { nx = dx / l; nz = dz / l; }
  const k = SOLDIER_SEPARATION - l;
  const px = nx * k, pz = nz * k;
  const m = SEPARATION_SPEED_FLOOR * Math.hypot(px, pz);
  const va = a.body.velocity, vb = b.body.velocity;
  const sa = Math.max(Math.abs(va.x * px + va.z * pz), m);
  const sb = Math.max(Math.abs(vb.x * px + vb.z * pz), m);
  if (sa === 0 && sb === 0) return;
  const wa = sa / (sa + sb);
  sweepSeparation(a, -px * wa, -pz * wa);
  sweepSeparation(b, px * (1 - wa), pz * (1 - wa));
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
