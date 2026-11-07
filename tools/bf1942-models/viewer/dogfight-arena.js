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

import { fighterRank } from './dogfight-lessons.js';
import { provingGroundUrl } from './proving-ground.js';

/** The battle that stands for an arena, first listed first. */
export const ARENA_ORDER = ['Battle_of_Britain', 'Kursk', 'Market_Garden', 'Midway', 'El_Alamein', 'Coral_sea', 'Berlin', 'Kharkov'];

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
    if (row?.category !== 'air') continue;
    const sides = row.sides ?? [];
    // A plane both sides fly (a B-17 in the captured-plane maps) is neither's.
    if (sides.length !== 1) continue;
    for (const level of row.levels ?? []) {
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
export function arenaUrl(root, { map, mod = null, side = 'Allied', lesson = null, move = null, course = null, base = globalThis.location?.href }) {
  const url = new URL(provingGroundUrl(root, { map, team: teamOf(side), soldiers: 1, mod, spawn: 'FiringLine', base }));
  url.searchParams.set('arena', 'dogfight');
  if (lesson) url.searchParams.set('dogfight', lesson);
  if (lesson && move) url.searchParams.set('move', move);
  if (course) url.searchParams.set('course', course);
  return url.toString();
}
