// Which loaded scene nodes are the assembler's collision primitives, and which
// of those belong to a surface a ground vehicle drives on top of. Both the
// hull grid (`static-index.js`, which re-exports these) and the drivable-deck
// broadphase (`drivable-mask.js`) classify the scene by these two rules.

/** Whether a loaded node is one of the assembler's collision primitives. */
export function isCollisionMesh(obj) {
  return Boolean(obj.userData?.collision || obj.geometry?.userData?.collision
                 || obj.parent?.userData?.collision);
}

/**
 * A placed object whose name marks it as a surface a ground vehicle drives
 * on top of, rather than a wall it rams: bridges, raised reload/repair bays,
 * ramps, overpasses and hardsurface decks. The viewer's heightfield does not
 * carry these raised decks -- `terrain/` is the ground under them -- so without
 * this a tank crosses the river only as far as the bridge's static collision
 * mesh, which the hull sweep treats as a wall and stops it on.
 *
 * The engine's own `checkVsTerrain` drops a vehicle's vertices onto a
 * heightfield that *does* include drivable bridges. The viewer's equivalent is
 * `WorldCollider.deckHeight`, which rays the real triangles of these objects;
 * this name set is the gate on *which* statics a vehicle may be lifted onto at
 * all, so a mod's similarly-named bridge/bay templates work unchanged and a
 * windowsill never becomes a road.
 *
 * The set can afford to be generous now that the ride surface is a ray and the
 * hull gate is per triangle, because the GEOMETRY decides what happens to a
 * matched object. `repaircist_m1` is the example: a 1.65 x 3.7 x 1.85 m repair
 * canister, matched by this pattern, and correctly still an obstacle — its top
 * is out of a wheel's step and its sides rise past the hull's, so a tank bumps
 * into it exactly as it always did. The pattern only says "a vehicle is allowed
 * to ride this if the shape works out".
 *
 * `landrep1` is the vanilla LAND vehicle repair/reload station — a workshop over
 * a slab with a low apron, shipped on 31 of the extracted levels, and the object
 * in the "it drives through the repair pad and the model is submerged in it"
 * report. Nothing in the original set matched it (no `bay`, no `ramp`), so its
 * apron was never in the ride surface at all and the tank's wheels stayed on the
 * terrain 0.9 m below the slab. `airrep1` is its aircraft sibling, driven into
 * the same way. The supply-depot building (`Supplyde_m1`) is deliberately NOT
 * here: a bare `supplyde` would also catch `AmmoboxSupplyDepot` and the other
 * logical `*SupplyDepot` objects, and a depot is something a vehicle pulls up
 * to, not onto.
 *
 * `plank` is the plank bridge: `longPlanks_m1` and `shortPlanks` carry a flat
 * deck over a river (FHSW's Buildings/AddMaps pack, 2026-10-14). Nothing matched
 * them, so a wheel fell through to the riverbed under the deck. `steplank1_m1`,
 * the ramps either side, match too, which is what they are. `brdg` is the
 * same bridge spelled short: `Woodbrdg_M1`, the railed plank bridge over the
 * ditch beside doomed_budapest's Soviet base, where a GAZ fell to the ditch
 * floor under the deck in the owner's capture (2026-10-14).
 *
 * Known loose matches, left alone because the geometry contains them: `bay`
 * catches a B17's `B17_Bay_*` doors and `ramp` catches `Katyusha_Ramp`, both
 * parts of flyable/drivable vehicles rather than level furniture. The only
 * consequence is that another vehicle's hull may clip slightly into those
 * near-horizontal faces of a parked one.
 */
const DRIVABLE_TOP_RE = /bridge|repairpoint|repaircist|reloadbay|repairbay|repairstation|landrep|airrep|bay|ramp|overpass|dock|flightdeck|freightdeck|hardsurface|deck|plank|brdg/i;

/**
 * Whether a collision mesh belongs to a drivable surface: its own name, the
 * stem the assembler kept, or any ancestor placement node's name.
 *
 * The ancestor walk is deliberate and it is why the mask is per triangle rather
 * than per name: a repair bay arrives as a `repaircist...` placement whose own
 * collision primitives are named generically, and a bridge arrives as a span
 * node with the road and the parapets as separate children. Both want every
 * triangle under the placement marked — the road so the wheels can ride it, the
 * parapet so the hull sweep can still be stopped by it (the sweep tells the two
 * apart by the triangle's own slope, not by its name).
 */
export function isDrivableCollisionMesh(obj) {
  for (let n = obj; n; n = n.parent) {
    if (DRIVABLE_TOP_RE.test(String(n.name ?? ''))) return true;
    if (DRIVABLE_TOP_RE.test(String(n.displayName ?? ''))) return true;
    if (DRIVABLE_TOP_RE.test(String(n.userData?.control ?? ''))) return true;
  }
  return false;
}

/**
 * The ride-surface height a placed hull marked on this mesh's static, or null.
 *
 * A static the level stands a hull on (a hangar floor under its plane) is a
 * floor whatever its name: in the engine every static face is a surface a
 * wheel's col0 vertex meets (COL-6), and only the viewer gates wheels by
 * name (`DRIVABLE_TOP_RE`). The load settle (`hull-bodies.js` `settleSome`)
 * writes `userData.rideSurfaceTop` on the static's placement node, the height
 * it found under the hull; the triangles of that static lying no higher than
 * `RIDE_SURFACE_REACH` above it are then drivable (`static-index.js`,
 * `drivable-mask.js`), and its walls and roof are not. Operation Da's P-40
 * stood on its hangar floor at load and, woken, sank to the terrain 0.6 m
 * under it, because nothing named it a floor.
 */
export function rideSurfaceTopOf(obj) {
  let top = null;
  for (let n = obj; n; n = n.parent) {
    const t = n.userData?.rideSurfaceTop;
    if (Number.isFinite(t) && (top === null || t > top)) top = t;
  }
  return top;
}

/** How far over its marked height a ride surface's triangle may reach and
 *  still be the floor: a ramp's lip, a sill. [free] */
export const RIDE_SURFACE_REACH = 0.5;
