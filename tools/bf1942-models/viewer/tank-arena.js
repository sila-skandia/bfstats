// The tank school's arenas (features/battle-schools, "The tank school's own
// page"): the battles whose two sides both field a tank, one arena per pair of
// tank sets, as the dogfight school's arenas pair fighters
// (`dogfight-arena.js`). Pure: the catalogue rows in, the arenas out.
//
// The model catalogue (`models.json`) calls every land vehicle `land`, jeeps
// and half-tracks too, and carries no engine type. A tank here is a land
// vehicle with a main gun (a weapon named `...GunBarrel` or `...Cannon`) and
// 100 hit points or more: that keeps the Sherman, Panzer IV, Tiger, T-34s, M10
// and Chi-ha and leaves out the Willys, the half-tracks (machine guns only) and
// the self-propelled guns (50 hit points). An anti-aircraft gun is `land` and
// carries a `...GunBarrel` and 100 hit points too, and a radar tower 600, so
// a gun named for the air (`AA_`, `Radar_`, `Flak`) and anything over 300
// hit points are not tanks. The page checks the glb's Engine (`c_ETTank`)
// once a model loads.

/** The battle that stands for an arena, first listed first. */
export const ARENA_ORDER = ['Kursk', 'El_Alamein', 'Battle_of_the_Bulge', 'Gazala', 'Kharkov', 'Berlin',
  'Market_Garden', 'Bocage', 'Aberdeen', 'Battleaxe', 'GuadalCanal', 'Iwo_Jima'];

/** What each arena is called, by the battle that stands for it. */
const ARENA_NAMES = {
  kursk: 'The Eastern Front',
  el_alamein: 'The West and the desert',
  guadalcanal: 'The Pacific',
};

const GUN = /(gunbarrel|cannon)\d*$/i;
const AIR_GUN = /^(aa|radar|flak)/i;
const isMainGun = w => GUN.test(String(w)) && !AIR_GUN.test(String(w));

/** Whether a catalogue row is a tank (see the head of this file). */
export function isTank(row) {
  if (row?.category !== 'land') return false;
  const hp = Number(row.hitpoints);
  if (!(hp >= 100 && hp <= 300)) return false;
  return (row.weapons ?? []).some(isMainGun);
}

/** The tank's main gun's FireArms name, from the catalogue row. */
export function mainGunName(row) {
  return (row?.weapons ?? []).find(isMainGun) ?? null;
}

/** Heavier first: hit points, then name. Used for "their best tank". */
export function tankRank(a, b) {
  return (Number(b.hitpoints) || 0) - (Number(a.hitpoints) || 0) || String(a.name).localeCompare(String(b.name));
}

/** A template as a crew says it: `PanzerIV` "Panzer IV", `T34-85` "T-34-85". */
export function prettyTank(template) {
  const t = String(template ?? '');
  const named = { PanzerIV: 'Panzer IV', T34: 'T-34', 'T34-85': 'T-34-85', 'Chi-ha': 'Chi-ha', M10: 'M10' };
  if (named[t]) return named[t];
  return t.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

const levelWords = map => String(map).replace(/_/g, ' ').replace(/\bof the\b/gi, m => m.toLowerCase());

/**
 * The arenas, from the catalogue's rows (`rows`) over the levels the viewer
 * holds (`levels`, the maps manifest's names; null to take every level the
 * rows name): each `{ map, name, battles, tanks: [{ template, side }],
 * allied, axis }`, `allied` and `axis` the two sides' tanks, heaviest first.
 * One arena per pair of tank sets, ordered by `ARENA_ORDER`, then by name.
 */
export function arenasFrom(rows, levels = null) {
  const held = levels ? new Map(levels.map(l => [String(l).toLowerCase(), l])) : null;
  const byLevel = new Map();
  for (const row of rows ?? []) {
    if (!isTank(row)) continue;
    const sides = row.sides ?? [];
    // A tank both sides drive (a captured one) is neither's.
    if (sides.length !== 1) continue;
    for (const level of row.levels ?? []) {
      const name = held ? held.get(String(level).toLowerCase()) : level;
      if (!name) continue;
      const entry = byLevel.get(name) ?? { Allied: new Map(), Axis: new Map() };
      entry[sides[0]]?.set(row.name, row);
      byLevel.set(name, entry);
    }
  }
  const groups = new Map();
  for (const [map, sides] of byLevel) {
    if (!sides.Allied.size || !sides.Axis.size) continue;
    const allied = [...sides.Allied.values()].sort(tankRank);
    const axis = [...sides.Axis.values()].sort(tankRank);
    const key = `${allied.map(r => r.name).sort().join(',')}|${axis.map(r => r.name).sort().join(',')}`;
    const group = groups.get(key) ?? { allied, axis, battles: [] };
    group.battles.push(map);
    groups.set(key, group);
  }
  const order = m => {
    const i = ARENA_ORDER.findIndex(o => o.toLowerCase() === String(m).toLowerCase());
    return i < 0 ? ARENA_ORDER.length : i;
  };
  const arenas = [...groups.values()].map(g => {
    g.battles.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    const map = g.battles[0];
    const tanks = [...g.allied.map(r => ({ template: r.name, side: 'Allied', row: r })),
                   ...g.axis.map(r => ({ template: r.name, side: 'Axis', row: r }))];
    return {
      map,
      name: ARENA_NAMES[String(map).toLowerCase()] ?? levelWords(map),
      battles: g.battles.map(levelWords),
      tanks,
      allied: tanks.filter(t => t.side === 'Allied'),
      axis: tanks.filter(t => t.side === 'Axis'),
    };
  });
  return arenas.sort((a, b) => order(a.map) - order(b.map) || a.map.localeCompare(b.map));
}

/** Your tank in `arena`: `choice` if the arena has it, else its first Allied. */
export function tankIn(arena, choice) {
  return arena.tanks.find(t => t.template === choice) ?? arena.allied[0] ?? arena.tanks[0] ?? null;
}

/** Their tank: `choice` if the arena has it, else the other side's heaviest. */
export function enemyOf(arena, mine, choice = null) {
  const picked = arena.tanks.find(t => t.template === choice);
  if (picked) return picked;
  const other = mine?.side === 'Axis' ? arena.allied : arena.axis;
  return other[0] ?? arena.tanks.find(t => t !== mine) ?? null;
}
