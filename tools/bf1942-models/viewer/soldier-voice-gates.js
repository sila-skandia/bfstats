// When a soldier's hurt grunt and "Watch your aim!" may sound: one clock per
// soldier for each, as each soldier carries its own. Pure (no DOM, no audio),
// so `tests/soldier_voice_gates_harness.mjs` runs it under node.
//
// "Watch your aim!" (`SoldierFFHitDamage.ssc`, WatchYourAim1..9) is
// `BFSoldier::projectileHit(int roundTeam)` lnxded 0x0827ea20, which
// `Projectile::handleCollision` calls at 0x0831effc for any soldier a round
// touches, unless the round's template sets `noFFSound` (`+0x14f`, tested at
// 0x0831efe6). It plays when the round's team equals the soldier's player
// team (`cmpl 0x7c(%eax)` at 0x0827ea4f) and more than 3.0 s (the double at
// 0x086d2740) have passed since that soldier's own stamp (`+0x56c`,
// 0x0827ea62..0x0827ea6f), which it then moves to now. The sound is entry
// 0x13 of the soldier's sound object (`push $0x13` at 0x0827ea85), the 20th
// `loadSoundScript` of `SoldierSound.inc`: `SoldierFFHitDamage.ssc`. Nothing
// reads the damage, so it plays with friendly fire off, and a splash (no
// projectile contact) never plays it.
//
// The hurt grunt (`c_SstHitDamage`, `SoldierHitDamage.ssc`) is each
// soldier's own `SoldierSound`: `triggerSound` (Mac client 0x000611a0, case
// 0x13) plays it when the instance's timer has passed its threshold, zeroes
// the timer and rolls the next threshold to `hitDamageFrequency +
// randomHitDamageFrequency * rand()/32767`. `SoldierSound.inc` writes 1.0 and
// 0.2, so a soldier grunts at most once every 1.0 to 1.2 s, and the first
// hit always grunts (the threshold starts at 0).

/** `projectileHit`'s gap between two of one soldier's "Watch your aim!". */
export const FF_HIT_SOUND_GAP = 3.0;
/** `SoldierSound.setHitDamageFrequency` / `setRandomHitDamageFrequency`. */
export const HIT_DAMAGE_FREQUENCY = 1.0;
export const RANDOM_HIT_DAMAGE_FREQUENCY = 0.2;

/**
 * The per-soldier clocks. `rand()` is in [0, 1). Keys are the page's player
 * ids (a bot's `playerId`, the human's `LOCAL_PLAYER`).
 */
export function createVoiceGates(rand = Math.random) {
  const ffStamps = new Map();
  const hurt = new Map();
  return {
    /** A round of `roundTeam` touched soldier `key` of `soldierTeam` at `now`
     *  (seconds): true when "Watch your aim!" plays, and the stamp moves. */
    friendlyHit(key, now, roundTeam, soldierTeam, noFFSound = false) {
      if (noFFSound || roundTeam == null || roundTeam !== soldierTeam) return false;
      const last = ffStamps.get(key);
      if (last !== undefined && !(now - last > FF_HIT_SOUND_GAP)) return false;
      ffStamps.set(key, now);
      return true;
    },
    /** Soldier `key` was hurt at `now`: true when the grunt plays. */
    hurt(key, now) {
      const s = hurt.get(key);
      if (s && !(now - s.last > s.threshold)) return false;
      hurt.set(key, {
        last: now,
        threshold: HIT_DAMAGE_FREQUENCY + RANDOM_HIT_DAMAGE_FREQUENCY * rand(),
      });
      return true;
    },
    /** A soldier gone (respawned, left): their clocks start again. */
    forget(key) {
      ffStamps.delete(key);
      hurt.delete(key);
    },
  };
}
