// A seat gun's deviation cone, as `GunFire.coneOf` asks for it (gunfire.js):
// the FireArms' stored total and the dice its rounds are drawn with.
//
// The engine runs one law for every FireArms. `FireArms::fireBarrel` (lnxded
// 0x0828aba0) pushes each round off its line by the stored total (`+0x188`)
// on the launch frame's up and right rows (DEV-9), whoever holds the gun. A
// seat gun's total is `minDev + fire + AI` (`FireArms::updateDeviation`
// 0x0828d410, DEV-11): no stance multiplier and no speed, turn or misc
// channel, so the hull's motion and the turret's turn feed nothing. The seat
// ticks it once a tick for each of its weapons (`PlayerControlObject::
// handlePlayerInput` 0x08318900), and the round and the cross both read the
// value that tick stored (DEV-12). `fire-state.js` keeps that total.
//
// What is the firer's own:
//   - a bot's AI term (`FireArms::setAIDeviation` 0x0828e350, the sixth
//     channel `+0x190`, bot.js `deviation.aiPending`), added to the total,
//     and the extra update his trigger statement runs every tick, which
//     decays his bloom twice a tick (DEV-13, `FireState.holdAI`);
//   - where in the square the round lands. A human's two draws come off the
//     guns' own dice (`round-launch.js deviate`, as his hand weapon's do); a
//     bot's are the one fixed point AI-145 reads, barrel by barrel
//     (`bot-deviation.js`).
//
// A group whose firer the page cannot name (a replayed round, a hand
// weapon's group) gets no cone here: a replay's rounds fly where the
// recording says, and a hand weapon carries its own (`spreadDeg`).

import { BOT_DEVIATION_POINTS } from './bot-deviation.js';

/**
 * Build the `GunFire.coneOf` hook.
 *
 * `stateOf(node)` is the FireArms node's `FireState`, or null where the page
 * never made one (it is not created here); `firerOf(group)` the player id in
 * the seat that fires `group`, or null; `botOf(id)` that player's `Bot`, or
 * null for a human. Returns `(group, barrel) => { total, dice } | null`, one
 * record reused per call: `total` in hundredths of a radian, `dice` null for
 * the guns' own or an object whose two `rand()` calls are the bot's point.
 */
export function seatConeOf({ stateOf, firerOf, botOf = null }) {
  const cone = { total: 0, dice: null };
  // `deviate` maps a draw r in [0, 1) to `2r - 1`: hand it `(u + 1) / 2`.
  const fixed = {
    draws: [0.5, 0.5],
    next: 0,
    rand() { return this.draws[this.next++ & 1]; },
  };
  return (group, barrel = 0) => {
    const firer = firerOf(group);
    if (firer == null) return null;
    const state = stateOf(group.node);
    if (!state) return null;
    const bot = botOf?.(firer) ?? null;
    cone.total = state.total + (bot ? bot.deviation?.aiPending ?? 0 : 0);
    cone.dice = null;
    if (bot) {
      // His trigger statement's own update, every tick to his next round
      // (DEV-13): the gap a held burst leaves, and a tick over.
      const rate = group.stats?.roundOfFire;
      state.holdAI?.(Math.ceil(30 / (rate > 0 ? rate : 10)) + 1);
      const [up, right] = BOT_DEVIATION_POINTS[Math.max(0, barrel) % BOT_DEVIATION_POINTS.length];
      fixed.draws[0] = (up + 1) / 2;
      fixed.draws[1] = (right + 1) / 2;
      fixed.next = 0;
      cone.dice = fixed;
    }
    return cone;
  };
}
