// Gap 16 — ladders: the headless hooks the climb state is verified through.
// Split out of the soldier hook file rather than edited into a sibling's
// territory; installed by `test-hooks.js` under `?shots`, like the rest.
//
// `page` is the test hooks' own bag; this part reads `soldier` and
// `world.collider.ladders`.

import { ladderRecord } from './ladder-climb.js';

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
        // The ladder's own frame, which the climb works in: its origin, its
        // +z (the deck side; the climber hangs on -z), the box's y extent.
        origin: [l.ox, l.oy, l.oz],
        plusZ: [l.zx, l.zy, l.zz],
        yMin: l.yMin,
        yMax: l.yMax,
      })),
    };
  };
  // Stand a ladder in by hand: `{ spec, elements, name }` is built exactly as
  // `collectLadders` builds a baked node (an `extras.isLadder` spec and the
  // node's column-major `matrixWorld.elements`); anything else is taken as a
  // finished record. The climb reads the ladder's own frame (`ox..`, `zx..`,
  // `yMin`/`yMax`), which only `ladderRecord` fills in.
  window.__ladderInject = input => {
    const collider = page.world?.collider;
    if (!collider || !input) return null;
    const record = input.spec && input.elements
      ? ladderRecord(input.spec, input.elements, input.name ?? null)
      : input;
    collider.ladders = collider.ladders || [];
    collider.ladders.push(record);
    return collider.ladders.length;
  };
  // The local player's climb state, live: `t` runs 0 (bottom) to 1 (top) with
  // his feet, `ly` is his origin's height in the ladder's frame, `standoff`
  // the side he hangs on (the ladder's -z), `lastExit` what ended the last
  // climb and where it left his feet.
  window.__climb = () => {
    const climb = page.soldier?.climb;
    if (!climb) return null;
    return {
      active: climb.active,
      t: climb.t,
      ly: climb.ly,
      ladder: climb.ladderName,
      standoff: [climb.sx, climb.sz],
      lastExit: climb.lastExit,
    };
  };
}
