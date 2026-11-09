// The anti-tank weapons a soldier carries, for the tank school's ON FOOT
// panel (features/battle-schools, tank-matchup.md "On foot"). Pure: the
// tree's `loadouts.json` and a weapon glb's JSON chunk in, numbers out, so
// the page and its tests read the same ones.
//
// Which weapons. A side's kits on the arena's battles (`loadouts.json`
// `levels[level][team].slots`, the kit itself from `levelKits[level]` before
// `kits`, a `Random*` item's variants beside it), and of their items the
// ones the game's AI rates against heavy armour (`aiWeapons[name].strength
// .HeavyArmour > 0`). A tree whose loadouts carry no AI table (EoD's) keeps
// the items of its `Anti-tank` kits instead. The weapon's own glb then says
// what it fires; one whose round leaves slower than `PLACED` m/s is set
// down, not fired (FHSW's Haft-Hohlladung, 3 m/s), and left out.
//
// The round. A hand weapon's `FireArms` node carries `fireArms.velocity`
// and its projectile's `gravity`, `material` and `timeToLive`, and flies the
// same closed form as a tank shell (`tank-ballistics.js`): no hand launcher
// round has a motor of its own (they are `kind: 'shell'`; a rocket's engine
// is `rocket-flight`, PHY-18).
//
// The spread. The glb's document extras carry the weapon's deviation block
// (`extras.weapon.deviation`: `min` is `setMinDev`, `speed` is `setSpeedDev [cap, ...]`,
// `mod` is `setDevMod [stand, crouch, prone]`). A round strays by up to
// `total / 100` radians on each of the up and right axes, a square, not a
// disc (DEV-9); `min` is not scaled by stance (DEV-2), and walking adds up
// to `speed[0] x mod[stance]`. A template that only uses the
// `minDeviation` / `maxDeviation` words (vanilla's Bazooka and Panzerschreck)
// says nothing the engine reads and keeps no spread at all (DEV-8).

import { reach as reachAt, timeTo, elevationFor } from './tank-ballistics.js';

/** A side's team number in `loadouts.json`. */
export const TEAM = { Axis: '1', Allied: '2' };
/** Below this muzzle speed (m/s) a weapon is placed, not fired. */
export const PLACED = 10;
const AT_CLASS = /anti.?tank/i;

/** A kit by name, the level's own first. */
export function kitOf(loadouts, level, name) {
  return loadouts?.levelKits?.[level]?.[name] ?? loadouts?.kits?.[name] ?? null;
}

/** The game's AI rating of a hand weapon against heavy armour, or null when
 *  the tree's loadouts carry no AI table or it lacks the weapon. Names match
 *  in any case (LOAD-7). */
function heavyRating(loadouts, name) {
  const table = loadouts?.aiWeapons;
  if (!table) return null;
  const hit = table[name] ?? Object.entries(table).find(([k]) => k.toLowerCase() === String(name).toLowerCase())?.[1];
  return hit ? Number(hit?.strength?.HeavyArmour) || 0 : null;
}

/**
 * The anti-tank items `side` carries on `levels` (raw level names; empty or
 * null for every level the loadouts know): `[{ name, kits, kitClasses }]`,
 * one per weapon, in the order first met.
 */
export function sideWeapons(loadouts, levels, side) {
  const team = TEAM[side];
  if (!loadouts?.levels || !team) return [];
  const want = levels?.length ? levels.map(l => String(l).toLowerCase()) : Object.keys(loadouts.levels);
  const lower = Object.fromEntries(Object.keys(loadouts.levels).map(k => [k.toLowerCase(), k]));
  const out = new Map();
  for (const l of want) {
    const level = lower[l];
    const slots = level && loadouts.levels[level]?.[team]?.slots;
    for (const kitName of Object.values(slots ?? {})) {
      const kit = kitOf(loadouts, level, kitName);
      if (!kit) continue;
      const items = [...(kit.items ?? []), ...(kit.random ?? []).flatMap(r => r.variants ?? [])];
      for (const item of items) {
        const rating = heavyRating(loadouts, item);
        const anti = rating == null ? AT_CLASS.test(String(kit.class ?? '')) : rating > 0;
        if (!anti) continue;
        const key = String(item).toLowerCase();
        // `rated`: the game's AI table says so, not only the kit's class.
        if (!out.has(key)) out.set(key, { name: item, kits: [], kitClasses: new Set(), rated: rating != null });
        const w = out.get(key);
        if (!w.kits.includes(kitName)) w.kits.push(kitName);
        if (kit.class) w.kitClasses.add(kit.class);
      }
    }
  }
  return [...out.values()].map(w => ({ ...w, kitClasses: [...w.kitClasses] }));
}

/** A glb's JSON chunk from its bytes (an ArrayBuffer or a Uint8Array). */
export function glbJson(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null;            // 'glTF'
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) return null;           // 'JSON'
  return JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + length)));
}

/**
 * A hand weapon's round and spread from its glb JSON, or null for one that
 * fires nothing: `{ name, gun: { speed, gravity }, material, ttl, reload,
 * spread: { still, moving, declared } }`. `still` and `moving` are the
 * cone's half-width per axis in hundredths of a radian (DEV-9), standing.
 */
export function launcherOf(name, json) {
  const nodes = (json?.nodes ?? []).filter(n => n?.extras?.fireArms?.projectile?.material != null);
  if (!nodes.length) return null;
  const own = nodes.find(n => String(n.name).toLowerCase() === String(name).toLowerCase()) ?? nodes[0];
  const fa = own.extras.fireArms;
  const pr = fa.projectile;
  const speed = Number(fa.velocity) || 0;
  const g = Number(pr.gravity);
  const weapon = json?.extras?.weapon ?? null;
  const dev = weapon?.deviation ?? null;
  const declared = Number.isFinite(Number(dev?.min));
  const min = declared ? Number(dev.min) : 0;
  const stand = Number(dev?.mod?.[0]) || 1;
  const walk = Number(dev?.speed?.[0]) || 0;
  return {
    name,
    node: own.name,
    gun: { speed, gravity: Number.isFinite(g) ? g : 1 },
    material: Number(pr.material),
    ttl: Number(pr.timeToLive) || 10,
    reload: Number(fa.reloadTime) || null,
    placed: speed < PLACED,
    spread: { still: min, moving: min + walk * stand, declared },
    // What the HUD does with it: the zoom (`zoomFov`, `soldierZoomFov`, and
    // `useScope` with its picture) and the crosshair type.
    zoom: weapon?.zoom ?? null,
    crossHair: weapon?.crossHair ?? null,
  };
}

/** How far the round goes on flat ground, from muzzle height, before it
 *  lands or its fuse runs out (`timeToLive`): `{ range, elevation, t,
 *  fuse }`, the best over every elevation up to 45 degrees; `fuse` when the
 *  fuse, not the ground, ends it. A round of next to no gravity climbs on
 *  the launch's lift (FA-23: +0.98 m/s whatever its gravity) and never comes
 *  down inside its fuse (EoD's LAW, 0.01). */
export function reachOf(l) {
  let best = { range: 0, elevation: 0, t: 0, fuse: false };
  for (let e = 0; e <= 45; e += 0.5) {
    const r = l.gun.gravity > 0 ? reachAt(l.gun, e) : { t: Infinity };
    const fuse = !(r.t <= l.ttl);
    const t = fuse ? l.ttl : r.t;
    const range = l.gun.speed * Math.cos(e * Math.PI / 180) * t;
    if (range > best.range) best = { range, elevation: e, t, fuse };
  }
  return best;
}

/** The aim for a target `R` m off whose aim point is `rise` m above the
 *  muzzle: `{ elevation, t }`, elevation null past the round's reach. */
export function aimFor(l, R, rise = 0) {
  const elevation = elevationFor(l.gun, R, { rise, maxElevation: 45 });
  if (elevation == null) return { elevation: null, t: null };
  const t = timeTo(l.gun, R, elevation);
  return t > l.ttl ? { elevation: null, t: null } : { elevation, t };
}

/** The cone's half-width at `R` m, in metres, per axis. */
export const strayAt = (hundredths, R) => R * Math.tan(hundredths / 100);

/** How far a target crossing at `speed` m/s moves while the round flies
 *  `t` s, in metres. */
export const leadMetres = (speed, t) => (Number.isFinite(t) ? speed * t : null);
