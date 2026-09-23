// Picking a spawn: the level's flags with the soldier spawns each owns, which
// of a flag's spawns to use, and the yaw a spawn point was authored to face.
//
// Split out of `soldier.js`, which re-exports it; that file is the soldier's
// camera, stance and gait, and none of this touches a `Soldier`.

import { resolveSpawn } from './spawn-safety.js';

const DEG = Math.PI / 180;

// -- picking a spawn ---------------------------------------------------------

/**
 * The level's flags, each with the soldier spawns it owns.
 *
 * The join is the one the engine makes: a `SpawnPoint` declares `setGroup <n>`
 * and a `ControlPoint` declares `spawnGroupId <n>`. The control point's live
 * owner gates those spawns; the spawn manager's group side is separate. Both
 * halves are already in `scene.json` —
 * `controlPoints[].spawnGroupId` and `soldierSpawns[].group` — because
 * `extract_map.py` has emitted them since `spawn-points.md`.
 *
 * `team` 0 is a flag that starts neutral. A group no control point claims
 * still spawns if the fleet owns it: a ship's own template carries deck
 * `SpawnPoint`s (`setGroup` 64+) and `Game/GlobalSpawnGroups.con` binds those
 * groups to a side, so Wake's Japanese round opens on their carrier and
 * destroyer. The extractor reconstructs them at the spawner pads in
 * `vehicleSoldierSpawns`, and each ship instance becomes one flag here.
 */
export function spawnFlags(extras) {
  const points = extras?.controlPoints || [];
  const spawns = extras?.soldierSpawns || [];
  const byGroup = new Map();
  for (const spawn of spawns) {
    if (spawn?.group == null) continue;
    if (!byGroup.has(spawn.group)) byGroup.set(spawn.group, []);
    byGroup.get(spawn.group).push(spawn);
  }
  const flags = [];
  const claimed = new Set();
  for (const point of points) {
    const group = point?.spawnGroupId;
    const groups = [point?.spawnGroupId, point?.secondSpawnGroupId]
      .filter((value, index, all) => value != null && all.indexOf(value) === index);
    const owned = groups.flatMap(value => byGroup.get(value) || []);
    if (!owned || !owned.length) continue;
    for (const value of groups) claimed.add(value);
    flags.push({
      name: point.displayName || point.name || `flag ${group}`,
      // A spawn group's tab team is not the control point's live owner. The
      // retail ControlPoint starts from its template team and changes that
      // field only through gotControl/setTeam; neutral points must therefore
      // stay neutral even when their authored group is listed under a side.
      team: point.team === 0 || point.team === 1 || point.team === 2
        ? point.team : owned.find(s => s.team === 1 || s.team === 2)?.team ?? null,
      group,
      groups,
      position: point.position || null,
      uncapturable: !!point.unableToChangeTeam,
      radius: Number.isFinite(point.radius) ? point.radius : null,
      timeToGetControl: Number.isFinite(point.timeToGetControl)
        ? point.timeToGetControl : null,
      // The rest of the template's control-point settings, null where the
      // level keeps the ctor's default (bot-referee.js
      // `controlPointSettings` holds those).
      timeToLoseControl: Number.isFinite(point.timeToLoseControl) ? point.timeToLoseControl : null,
      disableIfEnemyInsideRadius: point.disableIfEnemyInsideRadius ?? null,
      disableWhenLosingControl: point.disableWhenLosingControl ?? null,
      loseControlWhenEnemyClose: point.loseControlWhenEnemyClose ?? null,
      loseControlWhenNotClose: point.loseControlWhenNotClose ?? null,
      minNrToTakeControl: Number.isFinite(point.minNrToTakeControl) ? point.minNrToTakeControl : null,
      onlyTakeableByTeam: Number.isFinite(point.onlyTakeableByTeam) ? point.onlyTakeableByTeam : null,
      controlPointName: point.name || null,
      spawns: owned,
    });
  }
  // Some maps have valid side-owned bases that are not represented by a
  // ControlPoint object (Guadalcanal's airfield groups 9 and 10 are the
  // canonical example). They are still real deploy rows; omitting them makes
  // the authored spawn points unreachable. They are base rows, not capturable
  // flags, because the archive provides no capture zone for them.
  for (const [group, owned] of byGroup) {
    if (claimed.has(group) || !owned.length) continue;
    const team = owned.find(s => s.team === 1 || s.team === 2)?.team;
    if (team !== 1 && team !== 2) continue;
    const position = owned.reduce((sum, spawn) => {
      sum[0] += spawn.position?.[0] || 0;
      sum[1] += spawn.position?.[1] || 0;
      sum[2] += spawn.position?.[2] || 0;
      return sum;
    }, [0, 0, 0]).map(value => value / owned.length);
    flags.push({
      name: owned[0].name || `spawn group ${group}`,
      team,
      group,
      groups: [group],
      position,
      uncapturable: true,
      standalone: true,
      controlPointName: null,
      spawns: owned,
    });
  }
  // The fleet. One flag per ship instance — the picker names the ship — but
  // the map draws one ring per spawn *group* on that hull, the way the game
  // does: Wake's carrier shows three rings down its deck, its destroyer two.
  // Each ring carries its group so a click selects that spot on the deck.
  const ships = new Map();
  for (const spawn of extras?.vehicleSoldierSpawns || []) {
    if (spawn?.group == null || claimed.has(spawn.group) || !spawn.position) continue;
    const key = spawn.pad != null ? `pad${spawn.pad}`
      : `${spawn.vehicle}|${spawn.spawner}|${spawn.rotation?.join(',') ?? ''}`;
    if (!ships.has(key)) ships.set(key, []);
    ships.get(key).push(spawn);
  }
  for (const points of ships.values()) {
    const first = points[0];
    const groups = [];
    const seen = new Map();
    for (const p of points) {
      if (!seen.has(p.group)) {
        const entry = { group: p.group, position: p.position };
        seen.set(p.group, entry);
        groups.push(entry);
      }
    }
    flags.push({
      name: (first.vehicle || 'ship').charAt(0).toUpperCase()
        + (first.vehicle || 'ship').slice(1),
      team: points.find(p => p.team === 1 || p.team === 2)?.team ?? null,
      group: first.group,
      position: first.position,
      uncapturable: true,
      vehicle: true,
      groups,
      spawns: points,
    });
  }
  return flags;
}

/**
 * Which spawn of a flag's set to use, skipping the ones that would drop you out
 * of an aeroplane.
 *
 * `setSpawnAsParaTroper` is declared 489 times across vanilla's levels and is
 * **live 43 times**, in Market Garden (36), Liberation of Caen (6) and Coral Sea
 * (1) — the rest are explicit zeroes. Newly extracted levels carry the flag as
 * `soldierSpawns[].paratrooper`; every level extracted before that does not, so
 * a spawn sitting more than `airborne` metres above the ground under it is
 * treated as one too. That keeps already-shipped maps correct without a
 * re-extract.
 *
 * A ship flag's points arrive with their real deck heights (the extractor
 * resolves the vehicle template's local offsets), so no lift is applied and
 * the airborne heuristic is skipped — a deck is always well above the sea
 * under the hull, and none of these points is a parachute drop.
 */
export function pickSpawn(flag, index = 0, {
  groundAt = null, airborne = 12, group = null, world = null,
} = {}) {
  let pool = flag?.spawns || [];
  if (group != null) {
    const inGroup = pool.filter(spawn => spawn.group === group);
    if (inGroup.length) pool = inGroup;
  }
  const usable = pool.filter(spawn => {
    if (spawn.paratrooper) return false;
    // `spawnPointManager.OnlyForAI 1` — the engine's own audience filter on a
    // spawn group, and the reason Battle of Britain could put a player inside
    // a radar bunker. Each of its four towers declares its group twice: five
    // points spread around the building `OnlyForHuman`, and ONE at the
    // building's own origin `OnlyForAI`. The AI point is indoors under a
    // 2.25 m ceiling. A human is never offered it; a bot would be, if this
    // viewer had any.
    if (spawn.onlyForAI) return false;
    if (flag?.vehicle || !groundAt || !spawn.position) return true;
    const ground = groundAt(spawn.position[0], spawn.position[2]);
    return !Number.isFinite(ground) || spawn.position[1] - ground < airborne;
  });
  const finalPool = usable.length ? usable : pool;
  if (!finalPool.length) return null;
  // And then the geometry, for everything the level's own words cannot say:
  // `resolveSpawn` walks on from the asked-for point until it finds one a
  // body can stand up in and walk away from, and hands back the asked-for one
  // (flagged `blockedReason`) when none of them is. See `spawn-safety.js`.
  return resolveSpawn(finalPool, index, {
    world,
    // A ship's deck points arrive with their real deck heights; lifting one
    // onto the heightfield under the hull would probe from the sea bed.
    groundAt: flag?.vehicle ? null : groundAt,
  });
}

/**
 * The page's look yaw that faces the way a spawn point was authored to face.
 *
 * `Object.rotation <yaw>/<pitch>/<roll>` is degrees in Refractor's frame, where
 * +Z is forward (measured in `camera-modes.md` §4 off the Corsair's own
 * propeller and rudder placements). The exporter mirrors Z, so a node's glTF
 * rotation is Ry(-yaw) and its forward becomes (sin yaw, 0, -cos yaw). This
 * page's own `lookVector` is (sin yaw, 0, cos yaw), so the two agree at
 * `PI - yaw`.
 */
export function spawnYaw(spawn) {
  const degrees = spawn?.rotation?.[0] || 0;
  return Math.PI - degrees * DEG;
}
