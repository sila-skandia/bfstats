// A destroyed object's after-death clock (HP-19), out of vehicle-wrecks.js so
// the room server (`server/room-pads.mjs`) reads the same clock without the
// page's wreck graph.

/**
 * A destroyed object's after-death clock, from its `armor` extras (ledger
 * HP-19). `SimpleObject::handleUpdate` (lnxded 0x081db2e0) counts a dead
 * object's `timeToLiveAfterDeath` down (its template's +0xc4, 10 s where
 * never written) and, at 0, has the server destroy it (`GameServer::
 * destroyObject`); with `resetWhenRemoved` it gives it its hit points back
 * instead, and with `stayAsDestroyed` it never counts at all. With
 * `fadeAtTimeToLiveAfterDeath` (on by default) the object fades out from
 * `timeToStartFadeAfterDeath` (8 s by default) to the end, which a time to
 * live under that start never reaches.
 */
export function afterDeath(armor) {
  const ttl = Number.isFinite(armor?.timeToLiveAfterDeath) ? armor.timeToLiveAfterDeath : 10;
  const fadeFrom = Number.isFinite(armor?.timeToStartFadeAfterDeath)
    ? armor.timeToStartFadeAfterDeath : 8;
  return {
    ttl,
    fadeFrom,
    fade: armor?.fadeAtTimeToLiveAfterDeath !== false && ttl > fadeFrom,
    reset: !!armor?.resetWhenRemoved,
    stay: !!armor?.stayAsDestroyed,
  };
}

/** How opaque the object is `age` seconds after its death: 1 until the fade
 *  starts, then its time left over the fade's span (`alpha = timer /
 *  (ttl - fadeFrom)`, the same branch of `handleUpdate`). */
export function afterDeathOpacity(clock, age) {
  if (!clock.fade || age <= clock.fadeFrom) return 1;
  return Math.max(0, Math.min(1, (clock.ttl - age) / (clock.ttl - clock.fadeFrom)));
}
