// Gap 16 — ladders: the headless hooks the climb state is verified through.
// Split out of the soldier hook file rather than edited into a sibling's
// territory; installed by `test-hooks.js` under `?shots`, like the rest.
//
// `page` is the test hooks' own bag; this part reads `soldier` and
// `world.collider.ladders`.

export function installLadderHooks(page) {
  // The level's ladder index: what the exporter stamped and buildCollider
  // collected, in world space. A count of zero on a re-baked level means the
  // extras did not land; the same read after the re-bake is the census check.
  window.__ladders = () => {
    const ladders = page.world?.collider?.ladders ?? [];
    return {
      count: ladders.length,
      ladders: ladders.map(l => ({
        name: l.name,
        bottom: [l.x, l.y, l.z],
        top: [l.tx, l.ty, l.tz],
        length: l.length,
        face: [l.fx, l.fy, l.fz],
        width: l.width,
      })),
    };
  };
  // Stand a ladder in by hand. The shipped scene glbs predate
  // `extras.isLadder` (the re-bake is sequenced after the exporter change),
  // so the live climb check injects the exact record the exporter will write
  // — computed off the real `Ladder_10m.sm` bounds and the node's world
  // matrix — and then exercises the real climb path against it.
  window.__ladderInject = record => {
    const collider = page.world?.collider;
    if (!collider || !record) return null;
    collider.ladders = collider.ladders || [];
    collider.ladders.push(record);
    return collider.ladders.length;
  };
  // The local player's climb state, live: `t` runs 0 (bottom) to 1 (top),
  // `s` is the standoff direction he was snapped onto the ladder's side in.
  window.__climb = () => {
    const climb = page.soldier?.climb;
    if (!climb) return null;
    return {
      active: climb.active,
      t: climb.t,
      ladder: climb.ladderName,
      standoff: [climb.sx, climb.sz],
    };
  };
}
