// One on-foot player's world tick: the look the tick's input turns, the
// soldier's own body step, and the fall and drowning damage his Armor takes.
// A plain function of the `World` (world.js), called from its tick.

import { fallDamageFor } from './fall-damage.js';
import { obstacleDamage, obstacleOrigin, OBSTACLE_DAMAGE } from './obstacle.js';
import { soldierLookDegrees } from './mouse-input.js';
import { consume } from './world-input.js';

const DEG_TO_RAD = Math.PI / 180;

export function soldierTick(world, player, dt) {
  const soldier = player.soldier;
  if (!soldier) return;
  // Definitely one input this tick: the engine turns the view by the
  // per-tick axis of the entry the tick consumed (GUN-2b); the body then
  // moves along the NEW facing, which is the page's own look-then-move
  // order. `soldier.look` owns the +-38 clamp, applied per tick as the
  // engine applies it per PlayerInput. An idle tick carries a zeroed axis,
  // so a missed packet turns nobody.
  const entry = consume(player);
  const x = entry.lookX;
  const y = entry.lookY;
  const per = soldierLookDegrees(x, y);
  const yaw = -per.yaw * DEG_TO_RAD;
  const pitch = -per.pitch * DEG_TO_RAD;
  if (yaw || pitch) {
    soldier.look(yaw, pitch);
    player.lookApplied.yaw += yaw;
    player.lookApplied.pitch += pitch;
  }
  const input = entry.input;
  soldier.collider = world.collider;
  soldier.step(dt, input);
  // Fall damage -- HP-14, the whole formula in fall-damage.js -- applied
  // where the page applied it: the impact speed was sampled before the
  // ground clamp put the body back on the ground.
  if (soldier.landing && player.armor) {
    const hp = fallDamageFor(soldier.landing, world.damageTables);
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
  obstacleTick(world, player, dt);
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
