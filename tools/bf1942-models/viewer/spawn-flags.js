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
 *
 * A control point that can change hands but owns no soldier spawn is still
 * a flag, a capture-only one (`captureZone`): Midway's two sea areas, which
 * declare no `spawnGroupId`, and Salerno's `The_top` in Conquest and CoOp,
 * whose layers set `spawnGroupId -1` and rem out its seven hilltop spawn
 * points. Nothing in the engine's capture path reads a spawn group (ledger
 * SPAWNGRP-7), and the point's `areaValue` is the holder's weight in the
 * ticket bleed. Those flags come after every other, so a flag that has
 * spawns keeps its index (the deploy select's value, the room's `flag` rows).
 * A point that cannot change hands (Battle of Britain's `Allied_Base`) stays
 * no flag, its weight its level team's for good.
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
  const zones = [];
  for (const point of points) {
    const group = point?.spawnGroupId;
    const groups = [point?.spawnGroupId, point?.secondSpawnGroupId]
      .filter((value, index, all) => value != null && all.indexOf(value) === index);
    const owned = groups.flatMap(value => byGroup.get(value) || []);
    if (!owned || !owned.length) {
      if (point && !point.unableToChangeTeam && placedTemplate(point)) zones.push(point);
      continue;
    }
    for (const value of groups) claimed.add(value);
    const flag = {
      name: point.displayName || point.name || `flag ${group}`,
      group,
      groups,
      ...controlPointFields(point),
    };
    // A spawn group's tab team is not the control point's live owner. The
    // retail ControlPoint starts from its template team and changes that
    // field only through gotControl/setTeam; neutral points must therefore
    // stay neutral even when their authored group is listed under a side.
    const team = point.team === 0 || point.team === 1 || point.team === 2
      ? point.team : owned.find(s => s.team === 1 || s.team === 2)?.team ?? null;
    holdGroups(flag, point, owned, team);
    flags.push(flag);
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
  // Spawn points an object carries: the fleet's decks, and on Desert Combat's
  // levels the airbases' hangars, radar domes and towers, the Talil statics and
  // the AC-130. The spawn screen lists spawn GROUPS, never their carriers
  // (ledger SPAWNGRP-10): `getGroupsForTeam` offers each group of the side
  // that holds a point, the map draws one ring per group at the average of
  // its points (`BFSpawnGroup::calcNewPos`), and nothing on the screen names
  // any of them. So carriers that share a group are one flag (No Fly Zone
  // Day 2's group 99 rides a radar dome, two hangars and a tower: one ring,
  // not four), and each group is one ring with its group on it, so a click
  // selects that spot: Wake's carrier still shows three rings down its deck,
  // its destroyer two. The label is only the picker's, since the game prints
  // none: the level's own name for the spawn point, the way an unclaimed
  // level group above is labelled, not the carrier's template name.
  const carriers = new Map();
  for (const spawn of extras?.vehicleSoldierSpawns || []) {
    if (spawn?.group == null || claimed.has(spawn.group) || !spawn.position) continue;
    const key = spawn.pad != null ? `pad${spawn.pad}`
      : `${spawn.vehicle}|${spawn.spawner}|${spawn.rotation?.join(',') ?? ''}`;
    if (!carriers.has(key)) carriers.set(key, []);
    carriers.get(key).push(spawn);
  }
  for (const points of carriedGroupSets(carriers)) {
    const spots = [];
    const seen = new Set();
    for (const p of points) {
      if (seen.has(p.group)) continue;
      seen.add(p.group);
      const own = points.filter(q => q.group === p.group);
      spots.push({ spot: groupSpot(p.group, own), aiOnly: own.every(q => q.onlyForAI) });
    }
    // A human's screen skips an `OnlyForAI` group (the client's group
    // `getActive(false)`, 0x00484bc0, byte +0x42): Battle of Britain's towers
    // each carry one beside their human group. Its points stay in `spawns`,
    // where `pickSpawn` refuses them to a human as before.
    const human = spots.filter(s => !s.aiOnly);
    const groups = (human.length ? human : spots).map(s => s.spot);
    const first = points.find(p => p.group === groups[0].group);
    flags.push({
      name: first.name || `spawn group ${first.group}`,
      team: points.find(p => p.team === 1 || p.team === 2)?.team ?? null,
      group: first.group,
      get position() { return groups[0].position; },
      uncapturable: true,
      vehicle: true,
      groups,
      spawns: points,
      // Every point it offers is down: each carrier critically damaged, gone
      // or not stood up by its pad (`BFSpawnPoint::getActive`, SPAWN-5; the
      // page's `hull-bodies.js` `bindCarriers` gives each point `inactive`).
      // The group stays listed and spawns nobody (SPAWNGRP-10).
      get inactive() { return points.every(p => p.inactive); },
    });
  }
  for (const point of zones) flags.push(captureZone(point));
  return flags;
}

/**
 * The carriers' points, gathered into one list per set of carriers that
 * share a spawn group (a carrier is one placed object: one spawner pad). A
 * group is one selectable point however many objects carry it, so two
 * carriers of one group can never be two flags; carriers with groups of
 * their own stay apart, a ship's decks as one flag with a ring per group.
 * Carrier order, then point order, is kept.
 */
function carriedGroupSets(carriers) {
  const keys = [...carriers.keys()];
  const parent = new Map(keys.map(k => [k, k]));
  const root = k => {
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  const byGroup = new Map();
  for (const key of keys) {
    for (const p of carriers.get(key)) {
      const other = byGroup.get(p.group);
      if (other == null) byGroup.set(p.group, key);
      else {
        const a = root(other), b = root(key);
        if (a !== b) parent.set(b, a);
      }
    }
  }
  const sets = new Map();
  for (const key of keys) {
    const r = root(key);
    if (!sets.has(r)) sets.set(r, []);
    sets.get(r).push(...carriers.get(key));
  }
  return [...sets.values()];
}

/**
 * One ring of a carried group: where `BFSpawnGroup::calcNewPos` (lnxded
 * 0x08166d90) puts it, the plain average of the group's points whose carrier
 * is not critically damaged (SPAWNGRP-10). Live: the points' own arrays move
 * with a hull under way (`hull-bodies.js` `rebaseDeckSpawns` writes them in
 * place), and a point goes `inactive` when its carrier does (`bindCarriers`),
 * so the ring is re-averaged into one kept array whenever it is read. With
 * every carrier down the engine's average is (0,0,0); the ring keeps the
 * average of all its points instead, where the group was.
 */
function groupSpot(group, points) {
  const at = [0, 0, 0];
  const average = live => {
    let n = 0;
    at[0] = 0; at[1] = 0; at[2] = 0;
    for (const p of points) {
      if (!p.position || (live && p.inactive)) continue;
      at[0] += p.position[0]; at[1] += p.position[1]; at[2] += p.position[2];
      n++;
    }
    if (!n) return 0;
    at[0] /= n; at[1] /= n; at[2] /= n;
    return n;
  };
  return {
    group,
    get position() {
      if (average(true) || average(false)) return at;
      return null;
    },
  };
}

/** What a control-point flag carries of its point: where it is, whether it
 *  can change hands, and the template's capture settings, null where the
 *  level keeps the ctor's default (bot-referee.js `controlPointSettings`
 *  holds those). */
function controlPointFields(point) {
  return {
    position: point.position || null,
    uncapturable: !!point.unableToChangeTeam,
    radius: Number.isFinite(point.radius) ? point.radius : null,
    timeToGetControl: Number.isFinite(point.timeToGetControl)
      ? point.timeToGetControl : null,
    timeToLoseControl: Number.isFinite(point.timeToLoseControl) ? point.timeToLoseControl : null,
    disableIfEnemyInsideRadius: point.disableIfEnemyInsideRadius ?? null,
    disableWhenLosingControl: point.disableWhenLosingControl ?? null,
    loseControlWhenEnemyClose: point.loseControlWhenEnemyClose ?? null,
    loseControlWhenNotClose: point.loseControlWhenNotClose ?? null,
    minNrToTakeControl: Number.isFinite(point.minNrToTakeControl) ? point.minNrToTakeControl : null,
    onlyTakeableByTeam: Number.isFinite(point.onlyTakeableByTeam) ? point.onlyTakeableByTeam : null,
    controlPointName: point.name || null,
  };
}

/** The words a `ControlPointTemplate` gives its point in `scene.json`. */
const TEMPLATE_WORDS = [
  'spawnGroupId', 'secondSpawnGroupId', 'objectSpawnerId', 'timeToGetControl', 'timeToLoseControl',
  'disableIfEnemyInsideRadius', 'disableWhenLosingControl', 'loseControlWhenEnemyClose',
  'loseControlWhenNotClose', 'minNrToTakeControl', 'onlyTakeableByTeam',
];

/**
 * Whether the point's template reached the scene, which is whether the engine
 * made a point at all. `Object.create` of a template the layer never defines
 * makes nothing: `ObjectTemplateAdm::createObject` 0x084513e0 returns 0 for a
 * null template (0x08451403). The exporter still lists such a placement, with
 * nothing of a template on it: no radius or weight, no group or spawner, none
 * of the capture settings. Cassino's CTF places three (`openbasecammo` twice,
 * `openbase_lumbermill_Cpoint`), EoD's Stream one (`us_base`).
 */
function placedTemplate(point) {
  return Number(point.radius) > 0 || Number(point.areaValue) > 0
    || TEMPLATE_WORDS.some(key => point[key] != null);
}

/**
 * A control point that owns no soldier spawn: a flag to take and hold, and
 * nowhere to spawn (`captureOnly`, no `spawns`, no `groups`). The capture law
 * runs on it as on any other (`ControlPoint::handleFrameUpdate` 0x08283b00
 * reads no spawn group, ledger SPAWNGRP-7), `hoistCaptureFlag` carries its
 * owner to `extras.controlPoints` and so to the map and the round's weight,
 * and the spawn pickers skip it: `World.spawnPlayer`, the deploy screen, the
 * bots' spawn and respawn. `team` is a plain field; with no groups there is no
 * hand-over for a writer to run.
 */
function captureZone(point) {
  return {
    name: point.displayName || point.name || 'control point',
    group: null,
    groups: [],
    ...controlPointFields(point),
    captureOnly: true,
    team: point.team === 1 || point.team === 2 ? point.team : 0,
    spawns: [],
  };
}

/**
 * A control point's `team` and the `spawns` it offers, as the engine hands its
 * two spawn groups between sides (ledger SPAWNGRP-3, SPAWNGRP-4).
 *
 * `ControlPoint::control(0)` `0x08283fe0` and `reset` `0x08284640` enable
 * ONE group: `spawnGroupId` when there is no `secondSpawnGroupId` or the new
 * owner is team 1, `secondSpawnGroupId` when it is team 2, and write the
 * owner into it. Losing the point (going
 * neutral) writes 0 into both. The group not enabled keeps whatever it last
 * held, which at the start is its `groupTeam` — the round-start team the
 * exporter puts on each `soldierSpawns[]` entry. The spawns a flag offers are
 * those of the groups currently on its owner's side.
 *
 * Kasserine Pass SinglePlayer is the one capturable case in vanilla, XPack1
 * and XPack2: `axis_base` (1 and 6, both `groupTeam 1`) opens with both groups
 * Axis, but an Allied capture zeroes 1 and gives the Allies 6 alone, and the
 * Axis retaking it get 1 alone. With one group this is the old behaviour:
 * the group always carries the owner, so every spawn is offered.
 *
 * `team` is an accessor because several writers move it — the referee's
 * `controlPointStep`, the net room's `captured` decree — and each must run the
 * group writes. `groupEnableToChangeTeam 0` (the enable skips the write) is
 * not in `scene.json`; SPAWNGRP-5 measured it inert in the three packs.
 */
function holdGroups(flag, point, owned, start) {
  const first = point.spawnGroupId;
  const second = point.secondSpawnGroupId ?? null;
  const sideOf = value => (value === 1 || value === 2 ? value : 0);
  const groupTeam = new Map();
  for (const spawn of owned) {
    if (!groupTeam.has(spawn.group)) groupTeam.set(spawn.group, sideOf(spawn.team));
  }
  const enable = team => groupTeam.set(second == null || team === 1 ? first : second, team);
  const disable = () => {
    groupTeam.set(first, 0);
    if (second != null) groupTeam.set(second, 0);
  };
  let team = start;
  let spawns = owned;
  const offer = () => {
    const side = sideOf(team);
    spawns = owned.filter(spawn => groupTeam.get(spawn.group) === side);
  };
  // `init` runs the enable (or, for a neutral point, the disable) once more
  // over the round-start teams; for a well-extracted level this changes
  // nothing.
  if (sideOf(start)) enable(sideOf(start)); else disable();
  offer();
  Object.defineProperties(flag, {
    team: {
      enumerable: true,
      get: () => team,
      set(next) {
        if (next === team) return;
        // A decree may jump straight from one side to the other; the engine
        // always goes through neutral, and disable-then-enable is that.
        if (sideOf(team)) disable();
        if (sideOf(next)) enable(sideOf(next));
        team = next;
        offer();
      },
    },
    spawns: { enumerable: true, get: () => spawns },
    /** group -> the side it currently spawns (0 for none), for tests and
     *  the debug hooks. */
    groupTeams: { get: () => Object.fromEntries(groupTeam) },
  });
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
  // A point whose carrier is down offers nothing (`BFSpawnGroup::
  // getSpawnPoint` takes only the points `getActive` passes, SPAWNGRP-10), and
  // with none left the spawn is refused rather than put on one of them.
  let pool = (flag?.spawns || []).filter(spawn => !spawn.inactive);
  if (!pool.length) return null;
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
