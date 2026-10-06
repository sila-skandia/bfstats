// The world's damage pass: a body-world crash billed to its hull, and each
// tick's water (HP-5) and tier pass over every registered owner. Plain
// functions of the `World` (world.js).

import { touchesWater } from './body-world.js';

/** A body-world crash cost `owner` hit points: the callback hooks first so
 *  the page's console record reads the pre-damage hit points (the reading
 *  the old crashLog always made), then the damage itself lands on the same
 *  Armor a round would have hurt, and the change is reported for the tier
 *  pass a few lines below to pick up this very tick. */
export function onBodyDamage(world, owner, result, at, other) {
  const vehicle = world.vehicleDamage.get(owner);
  if (world.onCrash) world.onCrash(owner, result, at, other);
  let lost = 0;
  if (vehicle && !vehicle.destroyed) {
    lost = vehicle.damage(result.kill ? vehicle.hitPoints : result.damage);
  }
  // `lost` and `water` are for the crew's wash (`vehicle-hits.js`): a hull
  // already dead takes no `_giveDamage`, and ground and water give the
  // engine different `Pos3`s (ledger HFD-4, HFD-13).
  world.report.crashes.push({
    owner, other, damage: result.damage, kill: result.kill,
    water: !!result.water, lost,
    cell: result.effectCell, at: [at[0], at[1], at[2]],
    hp: vehicle?.hitPoints ?? null,
  });
}

/**
 * The water pass (HP-5) and the tier pass, in the page's own order. The
 * positions come from the world's own bodies (fresh from this tick's body
 * step) plus the registration poses of static furniture; wrecks the page
 * has faded out are skipped through the `isWrecked` predicate.
 */
export function damageTick(world, dt) {
  const waterLevel = world.collider?.waterLevel;
  const crews = [];
  const changes = world.vehicleDamage.update(dt, {
    inWaterOwners: inWaterOwners(world),
    upsideDownOwners: upsideDownOwners(world),
    ticks: world.report.timedDamage,
    // `submarineData` reads the hull's `underWater` (PHY-3): the body
    // world's own vertices, the rule `checkVsTerrain` writes it by.
    depthOf: owner => submersionDepth(world.bodyWorld?.get(owner), waterLevel),
    crews,
  });
  for (const change of changes) world.report.damage.push(change);
  for (const crew of crews) suffocateCrew(world, crew);
}

/** `Armor::update`'s tilt bound, `[0x86c030c]` = 0.3: the hull's up axis
 *  against the ground's normal (`0x08173443`) or against world up
 *  (`0x081734d8`). About 72.5 degrees past upright. */
export const UPSIDE_DOWN_COS = 0.3;

/** `mFramesBeforeSafeToSleep`: a root that has been still this many ticks
 *  is asleep (collision-response.md section 4.3). */
const SLEEP_TICKS = 100;

/**
 * Which hulls `Armor::update` (`0x08172f40`) would bill
 * `hpLostWhileUpSideDown` this tick: the test it runs once its one-second
 * bank is full, read 2026-10-06 (ledger HP-18).
 *
 *   gate      `hpLostWhileUpSideDown > 0.01` (`0x08173320`), and the Armor
 *             touched something this frame (`+0x129`, which `Armor::collision`
 *             `0x08174470` sets from `SimpleObject::handleCollision`) or the
 *             root node sleeps (`0x08173360`)
 *   near      `pos.y - 2 x boundingRadius < terrain height` (`0x081733d3`)
 *   tilt      when the last contact's height is below `terrain + 0.1`
 *             (`0x0817340a`), the hull's up row against the terrain normal,
 *             else against world up; either under 0.3 is upside down
 *
 * The last contact height (`Armor+0x28`) is the object's own origin height at
 * contact, raised while it is airborne, so at a frame where the gate passes it
 * is taken here to be the origin's height now. "Touched" is the engine's own
 * `handleCollision` test for terrain, a tested col0 vertex at or under the
 * ground moving faster than `sqrt 0.1` (collision-response.md section 7), or a
 * hull contact the body world resolved; "asleep" is a parked body's own sleep,
 * or for a driven one 100 ticks under the speed and spin wake bounds (the
 * acceleration bound is not tested).
 */
export function upsideDownOwners(world) {
  const owners = new Set();
  const field = world.collider?.heightfield;
  if (!field || typeof field.height !== 'function') return owners;
  for (const [owner, entry] of world.bodyWorld?.entries ?? []) {
    const body = entry.driven ?? entry.parked?.body;
    if (!body?.pos || !body.axes) continue;
    // The sleep proxy runs every tick, whatever else this tick decides.
    if (entry.driven) {
      const v = body.v, w = body.w;
      const still = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < 0.25
        && w[0] * w[0] + w[1] * w[1] + w[2] * w[2] < 0.25;
      entry._quietTicks = still ? (entry._quietTicks ?? 0) + 1 : 0;
    }
    const vehicle = world.vehicleDamage.get(owner);
    if (!vehicle || vehicle.destroyed || !(vehicle.hpLostWhileUpSideDown > 0.01)) continue;
    const [x, y, z] = body.pos;
    const ground = field.height(x, z);
    if (!Number.isFinite(ground)) continue;
    const radius = entry.spec?.boundingRadius ?? 0;
    if (!(y - 2 * radius < ground)) continue;
    const up = body.axes[1];
    let tilt = up[1];
    if (y < ground + 0.1 && typeof field.normal === 'function') {
      field.normal(x, z, _normal);
      tilt = up[0] * _normal[0] + up[1] * _normal[1] + up[2] * _normal[2];
    }
    if (!(tilt < UPSIDE_DOWN_COS)) continue;
    const asleep = entry.driven ? (entry._quietTicks ?? 0) >= SLEEP_TICKS : !!body.sleeping;
    if (asleep || touchesSomething(entry, body, field)) owners.add(owner);
  }
  return owners;
}

const _normal = [0, 1, 0];
const _contact = [0, 0, 0];
const _speed = [0, 0, 0];

/** `handleCollision` fired for this hull this tick: a resolved hull contact,
 *  or any part's tested col0 vertex at or under the terrain moving faster
 *  than `sqrt 0.1` (`checkVsTerrain`, collision-response.md section 7). */
function touchesSomething(entry, body, field) {
  if (entry.driven?.vehicle?.hullContacts?.length) return true;
  for (const part of entry.parts) {
    const layer = part.shape?.layers?.[0];
    if (!layer?.vertices?.length || typeof part.worldVertex !== 'function') continue;
    const count = layer.vertices.length / 3;
    const n = count <= 3 ? 1 : count;
    for (let i = 0; i < n; i++) {
      part.worldVertex(0, i, _vertex);
      const h = field.height(_vertex[0], _vertex[2]);
      if (!(_vertex[1] - h <= 0)) continue;
      _contact[0] = _vertex[0]; _contact[1] = h; _contact[2] = _vertex[2];
      body.tangentSpeed(_contact, _speed);
      if (_speed[0] * _speed[0] + _speed[1] * _speed[1] + _speed[2] * _speed[2] > 0.1) return true;
    }
  }
  return false;
}

/**
 * `underWater` for a hull in the body world: how far its root part's lowest
 * tested col0 vertex is below the sea, 0 above it. `checkVsTerrain`
 * (`0x0825a960`) takes the lowest of the vertices it drops on the terrain
 * (one when the layer has three or fewer) and hands `water - minY` to the
 * part's node (`0x0825ac60`), and the root part's node is the root's. The
 * root part's collision mesh is found by the same search as its inertia
 * geometry (`findLodCollisionMesh`, COL-13), which `hull-bodies.js` tags on
 * the spec as `waterPart` (`ship-spec.js` `rootCollisionPart`), not the part
 * `describeVehicleParts` marks `isRoot`. 0 for a hull with no such part.
 */
export function submersionDepth(entry, waterLevel) {
  if (!entry?.parts?.length || !Number.isFinite(waterLevel)) return 0;
  if (entry._waterPart === undefined) {
    const node = entry.spec?.waterPart?.node;
    entry._waterPart = node ? entry.parts.find(p => p.node === node && p.kind !== 'spring') ?? null : null;
  }
  const part = entry._waterPart;
  const layer = part?.shape?.layers?.[0];
  if (!layer?.vertices?.length || typeof part.worldVertex !== 'function') return 0;
  const count = layer.vertices.length / 3;
  const n = count <= 3 ? 1 : count;
  let low = Infinity;
  for (let i = 0; i < n; i++) {
    part.worldVertex(0, i, _vertex);
    if (_vertex[1] < low) low = _vertex[1];
  }
  return Number.isFinite(low) ? Math.max(0, waterLevel - low) : 0;
}

const _vertex = [0, 0, 0];

/**
 * `damageAllAttachedSoldiers` (`0x08318c70`): every soldier seated in a hull
 * whose air has run out takes `amount`. No vanilla or Desert Combat land
 * vehicle authors a non-zero 3rd `submarineData` float, so on land this never
 * fires; the two submarines (`Gato`, `Sub7C`, 1.0) are ships. The world takes
 * the HP off each Armor and reports it (`report.suffocation`, when the report
 * carries one); a seated soldier who dies of it reaches no death path here,
 * which is open.
 */
function suffocateCrew(world, { vehicle, owner, amount }) {
  for (const [playerId, player] of world.players) {
    if (!player.armor || player.armor.destroyed) continue;
    if (world.occupiedDamageable(playerId) !== vehicle) continue;
    const lost = player.armor.damage(amount);
    world.report.suffocation?.push({ playerId, owner, lost, killed: !!player.armor.destroyed });
  }
}

export function inWaterOwners(world) {
  const collider = world.collider;
  const waterLevel = collider?.waterLevel;
  if (!Number.isFinite(waterLevel)) return null;
  for (const [owner, entry] of world.bodyWorld?.entries ?? []) {
    if (entry.driven) {
      const s = entry.driven.vehicle.state.position;
      world.positions.set(owner, [s.x, s.y, s.z]);
    } else {
      world.positions.set(owner, entry.parked.body.pos);
    }
  }
  const owners = new Set();
  for (const [owner, pos] of world.positions) {
    if (world.isWrecked(owner)) continue;
    if (pos[1] <= waterLevel) {
      owners.add(owner);
      continue;
    }
    // Is there open water under this (x, z) at all? The body's own height is
    // the reference the deck query needs (see `WorldCollider.surfaceHeight`):
    // a tank on a bridge over a river is standing on the span, not in the
    // water, and a tank in the river UNDER the same span is in the water —
    // which the raster this replaced could not tell apart, because it lifted
    // the surface at an (x, z) for everyone.
    const surface = collider.surfaceHeight(pos[0], pos[2], pos[1]);
    if (Math.abs(surface - waterLevel) >= 0.01) continue;
    // ...and does the hull actually reach it? This second half is the whole
    // of the altitude test, and without it the answer above was the final
    // one: `surfaceHeight` is a function of x and z, so a plane at 400 m over
    // the sea read as "in water" and HP-5's drowning tick took
    // `hpLostWhileDamageFromWater` off it every second — 10 HP/s for every
    // vanilla aircraft, which kills a 100 HP Corsair over Wake in ten
    // seconds of ordinary flight with nothing shooting at it. `touchesWater`
    // is the engine's own geometric rule (collision-response §7).
    const entry = world.bodyWorld?.get(owner);
    // Furniture registered by position alone has no hull to test; its origin
    // is the only geometry there is, and the `<= waterLevel` test above has
    // already asked about it.
    if (entry && touchesWater(entry, pos[1], waterLevel)) owners.add(owner);
  }
  return owners;
}
