// A dead soldier's kit on the ground: where it comes to rest, how long it
// stays, how it turns, and who may take it. The rules only -- no three.js and
// no DOM, so `tests/kit_drops_harness.mjs` runs them under node; the meshes,
// the human's key and the kit he ends up holding are `kit-drops-page.js`'s.
// Every number here is read out of `bf1942_lnxded.static` (the addresses are
// lnxded's unless a line says client); `features/kit-drops/README.md` has the
// whole derivation.
//
// The object on the ground is the soldier's own `Kit`, the one he spawned
// with (`BFSoldier::addKitByName` 0x0826ddd0 makes it and hands it to
// `pickupKit`). It carries his actual weapons and worn parts back out of him:
// `BFSoldier::dropKit` 0x08279890 moves every inventory item but a flag and
// every `KitPart` into it, so the ammunition in those weapons goes with it.
//
//   Drop      `GameServer::killPlayer` 0x0814d920 calls `dropKit` on every
//             death (0x0814e0ea). A man killed while his player's vehicle is
//             not his soldier -- anyone in a seat -- has the kit destroyed at
//             once (`destroyObject`, GameServer vt+0x54, 0x0814e11e), so only
//             a death on foot leaves one: walking, swimming, falling, or
//             under a parachute (the soldier is his own vehicle then).
//   Rest      `dropKit` puts it straight on the ground under his origin, no
//             fall: the terrain height (`terrainBase` vt+0x54, 0x08279bd3) or
//             the first surface straight down (`intersectLine` along
//             (0, -1000, 0), 0x08279ca3, through `ObjectDropKitPredicator`
//             0x082806e0, which refuses any `IPlayerControlObject` -- a
//             vehicle, a soldier), whichever is nearer his height. Up is that
//             surface's normal; the heading is his (0x08279d08..0x08279dda).
//   Turn      `Item::handleUpdate` 0x08295900 yaws a parentless item by its
//             template's `yawSpeed` degrees (`ObjectTemplate.yawSpeed`,
//             ItemTemplate +0x158, ConsoleClass246 0x082c3cf0; default 1.0 in
//             `ItemTemplate::ItemTemplate` 0x08295b60) about its own up axis
//             (`yaw<float>` 0x08061db0 -> `rotateAboutLine` -> `rotateZDeg`)
//             on every world update -- once a 30 Hz tick, 30 deg/s. The client
//             does the same (ctor 0x0054dc70 +0x208 = 1.0, update 0x0054dfa0).
//   Stay      `Kit::enable` 0x08296710, run when it lands (0x08279e02),
//             posts message 22 to it `timeToLiveAftherDeath` seconds on
//             (KitTemplate +0x16c, ConsoleClass568 0x082ff3f0, the
//             property's own misspelling; 30.0 in `KitTemplate::KitTemplate`
//             0x08296b80, client 0x0054e8c0 +0x21c). `Kit::handleMessage`
//             0x08296790 destroys a kit still holding its items when it
//             arrives. No vanilla kit sets the property, so every vanilla kit
//             lasts 30 s; nothing caps how many lie about.
//   Take      `GameServer::checkPlayerTriggers` 0x0814f2c0, input bit 25 =
//             `c_PIDrop` (`io::Module::init` 0x083f9a80; G in the shipped
//             `Settings/Default/Controls/Infantry.con`), on foot only
//             (`CID_BFSoldierTemplate`), `isNotFireingOrHaveRecoil`
//             0x0827eaf0, and more than 2.0 s (0x086c0330) since this
//             player's last pickup (`BFPlayer` +0x84, stamped 0x08150498):
//             `findKitObject(origin, 1.1)` 0x0814a770 -- the nearest `Kit`
//             within the query -- whose `itemType` (-1 unless authored)
//             matches the soldier's container type (-1, no console word
//             sets it). No team test anywhere on the path: either side's
//             kit is anyone's. The query is `QuadTreeCuller::getObjects`
//             0x081a4dc0, which counts an object in when its origin is
//             within the radius PLUS its own bounding radius.
//   Swap      `BFSoldier::pickupKit` 0x08279390 calls `dropKit` first when
//             he carries a kit (0x082793bb), so his own lands where he
//             stands with a fresh timer, then takes the new one's items as
//             they are -- no refill, no heal (`addItem` 0x08277bd0 and
//             `addKitPart` touch neither) -- and raises slot 3.
//   Bots      no AI code presses `c_PIDrop` (the only AI mention of input 25
//             is the name parser), so a bot never picks a kit up.

/** Seconds a dropped kit lies before it is destroyed: `timeToLiveAftherDeath`'s
 *  default (KitTemplate ctor 0x08296b80, `+0x16c = 0x41f00000`). */
export const KIT_TIME_TO_LIVE = 30;

/** `findKitObject`'s query radius, pushed as 0x3f8ccccd at 0x081503af. */
export const PICKUP_RADIUS = 1.1;

/** Seconds a player must wait between pickups: the double 2.0 at 0x086c0330
 *  against `WorldTime - BFPlayer+0x84`, the gate at 0x08150341..0x08150364. */
export const PICKUP_COOLDOWN = 2.0;

/** Degrees a lying kit turns per world update: `yawSpeed`'s default. */
export const KIT_YAW_SPEED = 1.0;

/** World updates a second: the client's fixed step (`g_simulationFps`, ledger
 *  physics.md §3), which is what the spin above is counted in. */
export const WORLD_HZ = 30;

/** How far down the rest probe looks: the (0, -1000, 0) ray of 0x08279bea. */
export const REST_PROBE = 1000;

/**
 * Where a kit dropped by a soldier standing at `(x, y, z)` facing `yaw` comes
 * to rest, the way `dropKit` finds it. `ground` answers two questions:
 * `terrain(x, z)` -> `{ y, normal }` (the heightfield alone -- the engine asks
 * the terrain, not the water, so a kit dropped by a swimmer lies on the bed),
 * and `castDown(x, y, z, far)` -> `{ y, normal } | null`, the first
 * non-vehicle surface below. Whichever is nearer his height wins; with
 * neither, it rests at his feet facing up.
 */
export function restingPlace({ x, y, z, yaw = 0 }, ground = {}) {
  let best = null;
  const t = ground.terrain?.(x, z) ?? null;
  if (t && Number.isFinite(t.y)) best = { y: t.y, normal: t.normal ?? [0, 1, 0] };
  const hit = ground.castDown?.(x, y, z, REST_PROBE) ?? null;
  // `ABS(hit - y) < ABS(terrain - y)`, strictly (0x08279cd1).
  if (hit && Number.isFinite(hit.y) && (!best || Math.abs(hit.y - y) < Math.abs(best.y - y))) {
    best = { y: hit.y, normal: hit.normal ?? [0, 1, 0] };
  }
  if (!best) best = { y, normal: [0, 1, 0] };
  const [nx, ny, nz] = best.normal;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x, y: best.y, z, yaw, normal: [nx / len, ny / len, nz / len] };
}

/**
 * The engine's gate in front of a pickup (`checkPlayerTriggers`
 * 0x081502f0..0x08150440), less the geometry: `onFoot` (his player's vehicle
 * is his soldier), `ready` (`isNotFireingOrHaveRecoil`: no fire cycle of the
 * held weapon still running), and the 2 s since `lastPickupAt` on the same
 * clock as `now`.
 */
export function pickupAllowed({ onFoot, ready = true, now, lastPickupAt = -Infinity }) {
  return !!onFoot && !!ready && now - lastPickupAt > PICKUP_COOLDOWN;
}

/** A dropped kit's rows of carried ammunition, from a bot's magazines
 *  (`bot-referee.js` `magazineOf`: `{ rounds, spare, size }` per weapon it has
 *  used) and its fire data for the spares a full load holds. A weapon the bot
 *  never used has no row, and so comes up full, as its `FireArms` would. An
 *  unlimited one (the knife) has none either. */
export function ammoRowsFromBotMags(mags, weaponData = {}) {
  const rows = [];
  for (const [name, m] of mags ?? []) {
    if (!m || !(m.size > 0) || !Number.isFinite(m.rounds)) continue;
    const carried = weaponData?.[name]?.magazine?.magazines;
    rows.push({
      name, rounds: m.rounds, mags: Math.max(0, m.spare ?? 0), size: m.size,
      spares: Math.max((Number.isFinite(carried) ? carried : (m.spare ?? 0) + 1) - 1, 0),
    });
  }
  return rows;
}

/**
 * Every kit lying in the world. One record per drop:
 * `{ id, kit, x, y, z, yaw, normal, spin, bornAt, ttl, yawSpeed, radius,
 *    ammo, by, team }` -- `kit` the template, `spin` the degrees it has turned
 * since it landed, `radius` its bounding radius for the pickup reach (the
 * page fills it in from the mesh; until then the query radius alone reaches
 * it), `ammo` the rows its weapons carry, `by` and `team` who dropped it
 * (informational: nothing reads a kit's team).
 */
export class KitDrops {
  constructor() {
    this.drops = [];
    this.clock = 0;
    this.nextId = 1;
  }

  /** Lay a kit down at `place` (`restingPlace`'s answer) now. */
  drop(place, { kit, ammo = [], by = null, team = null, radius = 0,
               ttl = KIT_TIME_TO_LIVE, yawSpeed = KIT_YAW_SPEED } = {}) {
    if (!kit || !place) return null;
    const record = {
      id: this.nextId++, kit,
      x: place.x, y: place.y, z: place.z, yaw: place.yaw ?? 0,
      normal: place.normal ?? [0, 1, 0],
      spin: 0, bornAt: this.clock, ttl, yawSpeed, radius,
      ammo: ammo.map(row => ({ ...row })), by, team,
    };
    this.drops.push(record);
    return record;
  }

  /** `dt` seconds of world time: every kit turns, and the ones whose message
   *  has come due are gone. Returns the expired records. */
  tick(dt) {
    if (!(dt > 0)) return [];
    this.clock += dt;
    const expired = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.spin = (d.spin + d.yawSpeed * WORLD_HZ * dt) % 360;
      if (this.clock - d.bornAt >= d.ttl) {
        expired.push(d);
        this.drops.splice(i, 1);
      }
    }
    return expired;
  }

  /** Seconds until `record` goes. */
  timeLeft(record) {
    return record ? Math.max(0, record.ttl - (this.clock - record.bornAt)) : 0;
  }

  /** `findKitObject`: the nearest kit whose origin is within the query radius
   *  plus its own bounding radius of `(x, y, z)`, nearest by the square of the
   *  full 3D distance. */
  nearest(x, y, z) {
    let best = null;
    let bestSq = Infinity;
    for (const d of this.drops) {
      const sq = (d.x - x) ** 2 + (d.y - y) ** 2 + (d.z - z) ** 2;
      const reach = PICKUP_RADIUS + (d.radius > 0 ? d.radius : 0);
      if (sq < reach * reach && sq < bestSq) { best = d; bestSq = sq; }
    }
    return best;
  }

  /** Take `record` off the ground (its timer with it: `Kit::handlePickup`
   *  0x082967f0 removes every message to it). */
  take(record) {
    const i = this.drops.indexOf(record);
    if (i < 0) return null;
    this.drops.splice(i, 1);
    return record;
  }

  /** A level change: nothing survives it. */
  clear() {
    this.drops.length = 0;
  }

  /** Plain rows for a harness or a debug hook. */
  snapshot() {
    return this.drops.map(d => ({
      id: d.id, kit: d.kit, by: d.by, team: d.team,
      x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(3),
      normal: d.normal.map(v => +v.toFixed(3)),
      yaw: +d.yaw.toFixed(3), spin: +d.spin.toFixed(2),
      age: +(this.clock - d.bornAt).toFixed(3), left: +this.timeLeft(d).toFixed(3),
      radius: +(d.radius ?? 0).toFixed(3), ammo: d.ammo.map(r => ({ ...r })),
    }));
  }
}
