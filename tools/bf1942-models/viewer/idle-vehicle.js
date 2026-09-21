// What an unoccupied vehicle looks like.
//
// A gun's firing state is not one flag. It is spread across nodes that outlive
// every object that drives them:
//
//   - the baked effect payloads (`userData.effect`) an exporter hangs off a
//     muzzle. `GunFire.advance` strobes one on a shot and hides it again when
//     its `timeToLive` runs out — but only while the group is still in
//     `guns.groups`. `releaseGuns()` splices the group out the instant a seat
//     is vacated, so a flash lit on the frame of the exit is never advanced to
//     its own end of life and stays lit on the parked vehicle for the rest of
//     the level. It survives the wreck too: `wreckVehicle` hides the intact
//     hull with its `visible` flag still true, and `respawnVehicle` turns the
//     hull back on, flash and all. That is the owner's Spitfire: fly it, hold
//     the trigger, crash, and it comes back firing.
//   - the tracer streak template (`userData.tracerMesh`), which is a real mesh
//     parked on the barrel. `GunFire.collect` hides it, so it goes dark the
//     moment anybody climbs in; on a vehicle nobody has entered yet it draws
//     from the first frame of the level.
//   - the recoil pose. `advance` walks `group.node` back to `userData.home`
//     over `recoil.size / recoil.speed` seconds. A group released inside that
//     window leaves the barrel standing where the kick put it, and the fresh
//     group the next entry collects starts at `recoil = 1` (home), so nothing
//     ever writes the position again.
//   - `FireState` (seats.js), held in a `WeakMap` keyed on the FireArms node.
//     The node is reused across a respawn, so a vehicle destroyed with a hot,
//     half-empty, mid-reload gun is rebuilt around that same gun.
//
// The shape is the one this project has already been bitten by twice (a
// `trigger Volume` latch that outlived `silence()`, and a gun layer that
// replayed past its own round): a latch that survives the thing that owns it.
// So the reset lives here, next to the state, rather than in any one exit
// path — and every entry point into the unoccupied state calls it.
//
// Framework-free on purpose: `three` never appears, so `tests/idle_vehicle_
// harness.mjs` drives it under plain node.

/** The `userData` marks the exporter puts on a payload that is only ever drawn
 *  while a gun is being fired. Every one of them is dark on an idle vehicle. */
export const IDLE_PAYLOAD_KEYS = ['effect', 'projectileMesh', 'projectileTrail', 'tracerMesh'];

/** Depth-first over `children`, which is what both `THREE.Object3D` and the
 *  harness's plain objects have. `Object3D.traverse` would do, but insisting
 *  on it would make this module need three to be tested. */
function walk(node, visit) {
  if (!node) return;
  visit(node);
  const children = node.children;
  if (!children) return;
  for (const child of children) walk(child, visit);
}

/**
 * Put everything under `root` that only shows while a gun is firing back to
 * its idle state: payloads dark, guns at home.
 *
 * Idempotent, and cheap on an already-idle tree — it reports only what it
 * actually had to change, which is what the tests assert on.
 */
export function idleFirePose(root) {
  const hidden = [];
  const unrecoiled = [];
  walk(root, node => {
    const data = node.userData;
    if (!data) return;
    if (node.visible !== false && IDLE_PAYLOAD_KEYS.some(key => data[key])) {
      node.visible = false;
      hidden.push(node.name || '');
    }
    // `home` is stamped by `GunFire.collect` (and by the model browser's
    // explode slider) on the FireArms node itself, which is the node the
    // recoil kick moves.
    const home = data.home;
    if (!data.fireArms || !home || !node.position) return;
    const p = node.position;
    if (p.x === home.x && p.y === home.y && p.z === home.z) return;
    p.x = home.x;
    p.y = home.y;
    p.z = home.z;
    unrecoiled.push(node.name || '');
  });
  return { hidden, unrecoiled };
}

/**
 * Hand every `FireState` under `root` back its magazine, its cold barrel and
 * its finished reload.
 *
 * For a respawn ONLY. Stepping out of a half-empty tank and back into it must
 * not refill it — the engine replaces the *object* at the ObjectSpawner, and
 * that is the one moment the ammo is new. `lookups` is however many
 * `WeakMap`s hold states for these nodes (the page keeps one for the HUD, the
 * world keeps one for the sim, and they are the same objects by design).
 */
export function idleFireState(root, lookups) {
  // The page hands its own map to the `World` constructor, so the two are
  // usually the same object; de-duplicated here rather than at the call site
  // so a caller can name both without having to know that.
  const maps = [...new Set(lookups || [])].filter(Boolean);
  const reset = [];
  walk(root, node => {
    if (!node.userData?.fireArms) return;
    const done = new Set();
    for (const lookup of maps) {
      const state = lookup.get?.(node);
      if (!state?.reset || done.has(state)) continue;
      done.add(state);
      state.reset();
      reset.push(node.name || '');
    }
  });
  return reset;
}
