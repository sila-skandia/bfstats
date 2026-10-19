// `pickSpawn` against the combat area: a spawn point standing where the area
// deals damage (outside the rectangle, or on the out-of-bounds material,
// CA-5) is picked only when the flag offers nothing else.
//
// The shape that went wrong: FHSWEurope stashuv_area's singleplayer layer
// places `russianhq1` at 144.53/347.85 — 1240 m west of its flag, on
// material 7 — beside five siblings at x 1344..1467. The engine draws
// `rand() %` over the whole pool (SPAWNGRP-10) and so lands there one life
// in six; this page's deterministic walk landed there EVERY life, and the
// out-of-area damage killed each team-2 soldier ~16 s in.
//
// `outsideArea` here is a plain predicate, as `world-players.js`
// `outsideAreaOf` builds it; the fixtures mark the trap by coordinate.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.join(here, '..', 'viewer');
const { pickSpawn } = await import(path.join(viewer, 'spawn-flags.js'));

const point = (x, z, extra = {}) => ({ position: [x, 10, z], rotation: [0, 0, 0], group: 2, ...extra });

// stashuv_area's own numbers, viewer frame (z negated).
const TRAP = point(144.53, -347.85);
const GOOD = [
  point(1344.14, -305.76), point(1348.33, -307.44), point(1391.66, -369.65),
  point(1467.48, -312.91), point(1462.15, -335.51),
];
const flagOf = spawns => ({ name: 'Russian_HQ', team: 2, spawns });

// The predicate the world builds: true where the area damages. The pocket
// here is x 1000..1600 — the trap's x 144 is outside it.
const outsideArea = (x, z) => x < 1000 || x > 1600;

const results = {};

// 1. The trap is first in the list and index 0 is asked for: the pick walks
//    past it onto a point the area does not damage.
{
  const flag = flagOf([TRAP, ...GOOD]);
  const pick = pickSpawn(flag, 0, { outsideArea });
  results.trap_first_is_walked_past = {
    picked_x: pick?.position?.[0] ?? null,
    avoided: !!pick && pick !== TRAP && !outsideArea(pick.position[0], pick.position[2]),
  };
}

// 2. Every point of the flag stands in the damage field: the filter must not
//    empty the flag — the asked-for point comes back, as the engine would
//    offer it.
{
  const flag = flagOf([TRAP, point(100, -100), point(200, -200)]);
  const pick = pickSpawn(flag, 0, { outsideArea });
  results.all_outside_still_spawns = { picked: !!pick, picked_x: pick?.position?.[0] ?? null };
}

// 3. No combat area handed in (a level that bounds nothing): index 0 is the
//    first point, exactly as before.
{
  const flag = flagOf([TRAP, ...GOOD]);
  const pick = pickSpawn(flag, 0, {});
  results.no_area_unchanged = { picked_x: pick?.position?.[0] ?? null };
}

// 4. A vehicle-borne flag's authored positions are not where the carrier now
//    stands: the filter does not run on them.
{
  const flag = { ...flagOf([TRAP, ...GOOD]), vehicle: 'Carrier' };
  const pick = pickSpawn(flag, 0, { outsideArea, group: 2 });
  results.vehicle_flag_unfiltered = { picked_x: pick?.position?.[0] ?? null };
}

console.log(JSON.stringify(results));
