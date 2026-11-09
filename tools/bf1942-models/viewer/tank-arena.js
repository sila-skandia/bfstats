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
//
// When the tree's AI data is at hand (`_shared/vehicle-ai.json`, its
// `vehicles`), the game's own word decides: a tank is in it, `class: 'Land'`
// on a `Tank` or `AmphibiousTank` row of the mod's own `AIbehaviours.con`
// (`equipment`; vanilla's row 0) and a weapon the AI rates against armour. Every vanilla tank is, and so are a mod's (FHSW's
// Panzer III J, KV-1S, StuH 42), while half-tracks are 6, jeeps and cavalry
// 5, towed and AA guns 4, artillery batteries 13 and self-propelled guns 14.
// The catalogue's rule is the fallback for a template the AI data lacks.

/** The battle that stands for an arena, first listed first. */
export const ARENA_ORDER = ['Kursk', 'El_Alamein', 'Battle_of_the_Bulge', 'Gazala', 'Kharkov', 'Berlin',
  'Market_Garden', 'Bocage', 'Aberdeen', 'Battleaxe', 'GuadalCanal', 'Iwo_Jima'];

/** What each arena is called, by the battle that stands for it. */
const ARENA_NAMES = {
  kursk: 'The Eastern Front',
  el_alamein: 'The West and the desert',
  guadalcanal: 'The Pacific',
};

// A gun barrel or cannon by name, with whatever load a mod writes after it
// (`M36GunBarrelAP`, `KV1GunBarrel`, `m13_40Cannon`), or the hull's own name
// with `Gun` on it, as EoD names its T-54's and T-62's (`T54Gun`): one word,
// no `_`, so a `Type63_AAGunLeft` or a `Coaxial_PK` is not one.
const GUN = /(gunbarrel|cannon)|^[a-z0-9-]+gun$/i;
const AIR_GUN = /^(aa|radar|flak)/i;
const isMainGun = w => GUN.test(String(w)) && !AIR_GUN.test(String(w));

/** Whether the AI rates any of a vehicle's weapons, its seats' included,
 *  against armour (`strength.HeavyArmour` above 0): a tank gun is 2 to 10, a
 *  machine gun 0. FHSW's Sd Kfz 251/2 is AI equipment 0 but carries only
 *  machine guns. */
export function armourWeapon(entry) {
  const weapons = [entry?.aiWeapons, ...Object.values(entry?.seatsAi ?? {}).map(s => s?.aiWeapons)];
  return weapons.some(ws => Object.values(ws ?? {}).some(w => Number(w?.strength?.HeavyArmour) > 0));
}

/** Whether the AI files a unit as a tank: its `equipmentType` row is called
 *  `Tank` or `AmphibiousTank` in the mod's own `AIbehaviours.con` (EoD's
 *  PT-76 and V-100 are row 18, `AmphibiousTank`; its BMP-1 is an
 *  `AmphibiousCar` and its BTR-60 an `AmphibiousAPC`). The rows are each
 *  mod's to number, so the name decides; a table extracted before the names
 *  were carried falls back to vanilla's row 0. */
export function tankRow(entry) {
  if (entry?.equipment != null) return /^(amphibious)?tank$/i.test(String(entry.equipment));
  return Number(entry?.equipmentType) === 0;
}

/** Whether a catalogue row is a tank (see the head of this file). `ai` is
 *  the tree's `vehicle-ai.json` `vehicles`, when there is one. A tank has a
 *  main gun the catalogue can name (a carrier with an anti-tank rifle has
 *  none, and the school has nothing to show for it). */
export function isTank(row, ai = null) {
  if (row?.category !== 'land') return false;
  if (!mainGunName(row, ai)) return false;
  // The AI's word where it has one (Desert Combat spells the class `land`).
  // A template it lacks (FHSW's King Tiger, Cruiser Mk II, M13/40 have no
  // bot side) falls to the catalogue's rule below, without what its name
  // says is not a tank.
  const entry = ai && typeof ai === 'object' ? ai[row.name] : null;
  if (entry) return String(entry.class).toLowerCase() === 'land' && tankRow(entry) && armourWeapon(entry);
  if (NOT_A_TANK.test(row.name)) return false;
  const hp = Number(row.hitpoints);
  if (!(hp >= 100 && hp <= 300)) return false;
  return (row.weapons ?? []).some(isMainGun);
}

/** A second gun a mod mounts beside the main one: a flame gun, an HE or
 *  HEAT load, a tracer spotting gun, smoke. */
const SIDE_GUN = /flam|he$|heat|trac|smoke|_alt|spotter|dummy/i;

/** What a template's name says is not a tank, for a template the AI data
 *  lacks (and for a tree with none): FHSW's and FH's towed guns, batteries,
 *  howitzers, bunker and wooden turrets, radio and static props, dug-in
 *  hulls, mortar carriers, the M3A1 and Sd Kfz 251 half-tracks, a gun
 *  named by its calibre (FH's `5cmKwK` emplacement), and a bare anti-tank
 *  gun (FH's towed `pak38`, whose `pak38Gun` reads as a hull's own gun). */
export const NOT_A_TANK = /towed|battery|howitzer|turret|bunker|radio|static|dugin|artillery|mortar|^m3a1|^sdkfz\s*25[01]|^c7p|^\d+\s*(cm|mm)|^pak\s*\d+$/i;

/** The tank's main gun's FireArms name: the one the AI data maps to a
 *  `...MainGun`, else the catalogue's first gun that is not a side gun. */
export function mainGunName(row, ai = null) {
  const mapped = Object.entries(ai?.[row?.name]?.fireArms ?? {})
    .find(([name, aiWeapon]) => /maingun$/i.test(String(aiWeapon)) && !SIDE_GUN.test(name));
  if (mapped) return mapped[0];
  const guns = (row?.weapons ?? []).filter(isMainGun);
  return guns.find(w => !SIDE_GUN.test(w)) ?? guns[0] ?? null;
}

/** Heavier first: the AI's own worth of the vehicle (`basicTemp`, 30 for a
 *  Tiger or an M10, 12 for a Sherman) where the AI data gives it, then hit
 *  points, then name. Used for the defaults: your side's first, theirs'
 *  heaviest. */
export function tankRank(a, b) {
  return (Number(b.worth) || 0) - (Number(a.worth) || 0)
    || (Number(b.hitpoints) || 0) - (Number(a.hitpoints) || 0) || String(a.name).localeCompare(String(b.name));
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
export function arenasFrom(rows, levels = null, ai = null) {
  const held = levels ? new Map(levels.map(l => [String(l).toLowerCase(), l])) : null;
  const byLevel = new Map();
  for (const row of rows ?? []) {
    if (!isTank(row, ai)) continue;
    const sides = row.sides ?? [];
    // A tank both sides drive (a captured one) is neither's.
    if (sides.length !== 1) continue;
    for (const level of row.levels ?? []) {
      const name = held ? held.get(String(level).toLowerCase()) : level;
      if (!name) continue;
      const entry = byLevel.get(name) ?? { Allied: new Map(), Axis: new Map() };
      const worth = Number(ai?.[row.name]?.basicTemp);
      entry[sides[0]]?.set(row.name, Number.isFinite(worth) ? { ...row, worth } : row);
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
      // The battles as the catalogue spells them, for the loadouts' lookup.
      levels: [...g.battles],
      tanks,
      allied: tanks.filter(t => t.side === 'Allied'),
      axis: tanks.filter(t => t.side === 'Axis'),
    };
  });
  arenas.sort((a, b) => order(a.map) - order(b.map) || a.map.localeCompare(b.map));
  // Every tank of the tree, any two of them: the last arena, and the only
  // one where the catalogue's sides cannot pair a battle (Desert Combat
  // files its T-72 as Allied, beside the M1A1).
  const all = new Map();
  for (const row of rows ?? []) {
    if (!isTank(row, ai) || all.has(row.name)) continue;
    if (held && !(row.levels ?? []).some(l => held.has(String(l).toLowerCase()))) continue;
    const worth = Number(ai?.[row.name]?.basicTemp);
    all.set(row.name, Number.isFinite(worth) ? { ...row, worth } : row);
  }
  if (all.size >= 2) {
    const sorted = [...all.values()].sort(tankRank);
    const side = r => ((r.sides ?? []).length === 1 ? r.sides[0] : 'Allied');
    const tanks = sorted.map(r => ({ template: r.name, side: side(r), row: r }));
    let allied = tanks.filter(t => t.side === 'Allied'), axis = tanks.filter(t => t.side === 'Axis');
    if (!axis.length) { axis = tanks; }
    if (!allied.length) { allied = tanks; }
    arenas.push({ map: EVERY, name: 'Every tank', battles: [], levels: [], every: true, tanks, allied, axis });
  }
  return arenas;
}

/** The every-tank arena's key. */
export const EVERY = '*';

/** Your tank in `arena`: `choice` if the arena has it, else its first Allied. */
export function tankIn(arena, choice) {
  return arena.tanks.find(t => t.template === choice) ?? arena.allied[0] ?? arena.tanks[0] ?? null;
}

/** Their tank: `choice` if the arena has it, else the other side's heaviest. */
export function enemyOf(arena, mine, choice = null) {
  const picked = arena.tanks.find(t => t.template === choice);
  if (picked) return picked;
  const other = mine?.side === 'Axis' ? arena.allied : arena.axis;
  // Another tank than yours where the other side's list holds yours too
  // (the every-tank arena of a tree whose sides do not split).
  return other.find(t => t.template !== mine?.template) ?? other[0] ?? arena.tanks.find(t => t !== mine) ?? null;
}

/**
 * The gun a tank fights with, among its FireArms nodes. A real round only: a
 * mod's ammunition switch is a FireArms of its own firing a stand-in
 * (FHSW's `ChangeAmmo_FakeProjectile` at 1 or 465 m/s, material 210), with
 * the real loads on siblings named after it (`ValentineVIIIGunBarrel_AP`,
 * `_Canister`). So: the main gun by name if its round is real, else its
 * armour-piercing sibling, else any sibling, else the first real shell.
 */
export function pickMainGun(nodes, wanted) {
  const live = n => {
    const fa = n.userData?.fireArms ?? {};
    const p = fa.projectile ?? {};
    return !/fake|changeammo/i.test(String(p.template ?? '')) && !(Number(fa.velocity) <= 5) && p.material != null;
  };
  const real = n => live(n) && n.userData.fireArms.projectile.kind === 'shell';
  const guns = nodes.filter(real);
  const base = String(wanted ?? '').toLowerCase();
  // An autocannon is a gun too where the vehicle has no shell to fire
  // (Desert Combat's Shilka): the main gun by name, whatever its round.
  if (!guns.length) return nodes.find(n => live(n) && n.name.toLowerCase() === base) ?? null;
  const own = base ? guns.filter(n => n.name.toLowerCase().startsWith(base)) : [];
  return own.find(n => n.name.toLowerCase() === base)
    ?? own.find(n => /_ap$/i.test(n.name)) ?? own.find(n => /_ap/i.test(n.name))
    ?? own.find(n => !/canister|_he$|heat|smoke/i.test(n.name)) ?? own[0] ?? guns[0];
}
