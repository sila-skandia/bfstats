// The dogfight arenas (features/dogfight-school, "The school's own page"):
// where the school's lessons are flown. An arena is a battle whose two sides
// both field a fighter, borrowed by the Range's construct (`proving-ground.js`)
// with nothing on it but the planes: no kit bench, no targets, no soldiers
// walking up, no briefing and no spawn screen. You fly any of the battle's
// planes; the ace flies the other side's best fighter.
//
// The arenas come from the model catalogue (`models.json`): each aircraft's
// `sides` and the `levels` it is placed on. Battles with the same fighters
// either side are one arena (El Alamein's and Gazala's are both Spitfire v
// Bf 109); `ARENA_ORDER` says which battle stands for them.

import { fighterRank, isRotary } from './dogfight-lessons.js';
import { provingGroundUrl } from './proving-ground.js';
import { sidesOn, levelWords } from './tank-arena.js';

/** The battle that stands for an arena, first listed first. */
export const ARENA_ORDER = ['Battle_of_Britain', 'Kursk', 'Market_Garden', 'Midway', 'El_Alamein', 'Coral_sea', 'Berlin', 'Kharkov'];
/** The same for a tree paired by its levels' own teams (`arenasFromTeams`):
 *  Desert Combat's own battles lead, since it flies its jets over vanilla's
 *  maps too. The F-16 against the MiG-29 over Desert Shield, then the No Fly
 *  Zone's whole cast. No vanilla name is here: BF1918 has a Midway of its own. */
export const TEAMS_ORDER = ['DC_DesertShield', 'DC_No_Fly_Zone', 'DC_No_Fly_Zone_Day2', 'DC_Operation_Bragg'];
const arenaOrder = map => { const i = TEAMS_ORDER.findIndex(x => x.toLowerCase() === String(map).toLowerCase()); return i < 0 ? 99 : i; };

/** The side of the Range's construct a plane's side flies for: team 1 is the
 *  Axis, team 2 the Allies (`proving-ground.js` `team`). */
export const teamOf = side => (side === 'Axis' ? 1 : 2);

const isFighter = name => fighterRank(name) < 100;

/**
 * The arenas, from the catalogue's aircraft rows (`rows`) over the levels the
 * viewer holds (`levels`, the maps manifest's names): each `{ map, name,
 * planes: [{ template, side, fighter }], allied, axis }`, `allied` and `axis`
 * the two sides' fighters, best first. One arena per pair of fighter sets,
 * ordered by `ARENA_ORDER`, then by name.
 */
export function arenasFrom(rows, levels) {
  const held = new Map((levels ?? []).map(l => [String(l).toLowerCase(), l]));
  const byLevel = new Map();
  for (const row of rows ?? []) {
    if (row?.category !== 'air' || isRotary(row.name)) continue;
    for (const level of row.levels ?? []) {
      // A plane both sides fly there (a B-17 in the captured-plane maps) is
      // neither's. The level's own teams decide where the catalogue has
      // them (`levelSides`, `tank-arena.js` `sidesOn`): a side is per level.
      const sides = sidesOn(row, level);
      if (sides.length !== 1) continue;
      const map = held.get(String(level).toLowerCase());
      if (!map) continue;
      if (!byLevel.has(map)) byLevel.set(map, []);
      const list = byLevel.get(map);
      if (!list.some(p => p.template === row.name)) list.push({ template: row.name, side: sides[0], fighter: isFighter(row.name) });
    }
  }
  const rank = p => fighterRank(p.template);
  const out = new Map();
  for (const [map, planes] of byLevel) {
    planes.sort((a, b) => rank(a) - rank(b) || a.template.localeCompare(b.template));
    const allied = planes.filter(p => p.side === 'Allied' && p.fighter).map(p => p.template);
    const axis = planes.filter(p => p.side === 'Axis' && p.fighter).map(p => p.template);
    if (!allied.length || !axis.length) continue;
    const key = `${allied.join('+')}|${axis.join('+')}`;
    const arena = { map, name: map.replace(/_/g, ' '), planes, allied, axis };
    const have = out.get(key);
    const order = m => { const i = ARENA_ORDER.findIndex(x => x.toLowerCase() === m.toLowerCase()); return i < 0 ? 99 : i; };
    if (!have || order(map) < order(have.map) || (order(map) === order(have.map) && map < have.map)) out.set(key, arena);
  }
  const order = a => { const i = ARENA_ORDER.findIndex(x => x.toLowerCase() === a.map.toLowerCase()); return i < 0 ? 99 : i; };
  return [...out.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/**
 * The arenas from a tree's `dogfight-arenas.json` (`extract_dogfight_arenas.py`):
 * each level's aircraft by team, as its object spawners field them. For a
 * mod whose teams change from level to level (BF1918) or whose nations the
 * catalogue's WWII sides do not know (Desert Combat's MiG-29 is "Allied"
 * there), where the catalogue pairs nothing. Team 1 flies as the construct's
 * team 1 ('Axis'), team 2 as 'Allied' (`teamOf`); the arena's planes are
 * the level's, one arena per pair of fighter sets, as `arenasFrom`.
 */
export function arenasFromTeams(index, levels) {
  const held = new Map((levels ?? []).map(l => [String(l).toLowerCase(), l]));
  const out = new Map();
  for (const [level, teams] of Object.entries(index?.levels ?? {})) {
    const map = held.get(level.toLowerCase());
    if (!map) continue;
    const planes = [];
    for (const [team, side] of [['1', 'Axis'], ['2', 'Allied']]) {
      for (const template of teams[team] ?? []) {
        // A helicopter stays on the ground: the lessons fly the fixed-wing law.
        if (isRotary(template)) continue;
        if (!planes.some(p => p.template === template)) planes.push({ template, side, fighter: isFighter(template) });
      }
    }
    const rank = p => fighterRank(p.template);
    planes.sort((a, b) => rank(a) - rank(b) || a.template.localeCompare(b.template));
    const allied = planes.filter(p => p.side === 'Allied' && p.fighter).map(p => p.template);
    const axis = planes.filter(p => p.side === 'Axis' && p.fighter).map(p => p.template);
    if (!allied.length || !axis.length) continue;
    const key = `${allied.join('+')}|${axis.join('+')}`;
    const have = out.get(key);
    if (!have || arenaOrder(map) < arenaOrder(have.map) || (arenaOrder(map) === arenaOrder(have.map) && map < have.map)) {
      out.set(key, { map, name: levelWords(map), planes, allied, axis });
    }
  }
  return [...out.values()].sort((a, b) => arenaOrder(a.map) - arenaOrder(b.map) || a.name.localeCompare(b.name));
}

/** The plane you fly in `arena`: `choice` when the arena has it, else its
 *  best Allied fighter. */
export function planeIn(arena, choice) {
  return arena?.planes.find(p => p.template === choice) ?? arena?.planes.find(p => p.template === arena.allied[0]) ?? null;
}

/** The ace's plane against yours: the other side's best fighter. */
export function aceAgainst(arena, mine) {
  if (!arena) return null;
  const theirs = mine?.side === 'Axis' ? arena.allied : arena.axis;
  return arena.planes.find(p => p.template === theirs[0]) ?? null;
}

/**
 * The address that puts you in the arena: the Range's construct over the
 * battle with one bot (the ace), stood straight up with no briefing and no
 * spawn screen, on your plane's side, `arena=dogfight` (nothing on it but the
 * planes), and straight into a lesson (`lesson`, with a Dip, Flip or Ninja to
 * practise as `move`) or a ring course (`course`).
 */
export function arenaUrl(root, { map, mod = null, side = 'Allied', lesson = null, move = null, course = null, wingmen = 0,
                                 base = globalThis.location?.href }) {
  const url = new URL(provingGroundUrl(root, { map, team: teamOf(side), soldiers: 1 + wingmen, mod, spawn: 'FiringLine', base }));
  url.searchParams.set('arena', 'dogfight');
  // The pair flown: your side's bots, a wingman (and your gunner).
  if (wingmen) url.searchParams.set('wingmen', String(wingmen));
  if (lesson) url.searchParams.set('dogfight', lesson);
  if (lesson && move) url.searchParams.set('move', move);
  if (course) url.searchParams.set('course', course);
  return url.toString();
}
