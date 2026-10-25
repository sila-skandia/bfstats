// One on-foot player's world tick: the look the tick's input turns, the
// soldier's own body step, and the fall and drowning damage his Armor takes.
// A plain function of the `World` (world.js), called from its tick.

import { fallDamageFor } from './fall-damage.js';
import { obstacleDamage, obstacleOrigin, OBSTACLE_DAMAGE } from './obstacle.js';
import { SOLDIER_PITCH_GAIN, soldierYawStep } from './mouse-input.js';
import { recoilStep } from './recoil.js';
import { consume } from './world-input.js';

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
  // mm off along the turned one (lab/prone_slope_probe.mjs, PHY-38). So the
  // look lands after the step, and the step is told it (`turn`) for the
  // strafe row. `soldier.look` owns the +-38 clamp, applied per tick as the
  // engine applies it per PlayerInput. An idle tick carries a zeroed axis, so
  // a missed packet turns nobody.
  const entry = consume(player);
  // The recoil ride rides the same two axes (`recoil.js`, ledger FA-2..FA-5):
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
  // server parted by 3 to 4.5 degrees (lab/look_law_check.py, 2026-10-22).
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
