// A replay's followed soldier's own hand sounds: the ones only the man holding
// the weapon hears.
//
// The Reload slot of every vanilla weapon stops at a metre (all 239 loads,
// ledger SND-17), and so do `MedPack.ssc` and `RepairPack.ssc`, the medic
// bag's tear and the wrench's clank: stereo Fire Loops with a `Volume <-
// Distance` ramp of 1 to 1 m. Played at the soldier (`world-fire.js`), the
// replay's chase camera 6.5 m behind him heard none of them, and the pack's
// loop had no path at all. The player hears his own on the hand weapon's bus
// (`hand-fire-sound.js`), and a replay that puts the viewer in a soldier's
// eyes or on his shoulder plays his the same way.
//
// `kit` is the page's soldier kit: `fetchHandFireSound(name)` (a weapon's
// decoded report and edges, or null) and `setReplayFireLoop(fire)`. Imports
// nothing, so the tests run it under node.

export function createReplayOwnHandSound(kit) {
  // Weapon name (lower case) -> its decoded sounds, a promise while they
  // decode, or null for a weapon with none.
  const fires = new Map();
  let loopWant = null;

  function fire(name) {
    const key = String(name).toLowerCase();
    if (!fires.has(key)) {
      const pending = Promise.resolve(kit?.fetchHandFireSound?.(name) ?? null)
        .catch(() => null)
        .then(got => { fires.set(key, got ?? null); return got ?? null; });
      fires.set(key, pending);
    }
    return fires.get(key);
  }

  /** Decode `name`'s sounds ahead of its first use. */
  function prime(name) {
    if (!name) return Promise.resolve(null);
    return Promise.resolve(fire(name));
  }

  /** His magazine change: the weapon's Reload slot, once. */
  function reload(name) {
    if (!name) return;
    const got = fire(name);
    if (got instanceof Promise) got.then(f => f?.playReload?.());
    else got?.playReload?.();
  }

  /**
   * Each frame: the pack he is working (`MedPack`, `RepairPack`), or null.
   * The loop starts with the first frame that names one and is let run out
   * (FinishSample) on the first that does not.
   */
  function loop(name) {
    loopWant = name || null;
    if (!loopWant) {
      kit?.setReplayFireLoop?.(null);
      return;
    }
    const got = fire(loopWant);
    if (got instanceof Promise) {
      const asked = loopWant;
      got.then(f => { if (loopWant === asked) kit?.setReplayFireLoop?.(f); });
    } else {
      kit?.setReplayFireLoop?.(got);
    }
  }

  return { prime, reload, loop };
}
