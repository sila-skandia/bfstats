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

/** The battle that stands for an arena, first listed first. Desert Combat's
 *  own battles lead: it also plays vanilla's maps with its armour on them,
 *  and its M1A1 against its T-72 is 73 Easting's fight, not Kursk's. */
export const ARENA_ORDER = ['DC_Battle_of_73_Easting', 'DC_Medina_Ridge', 'DC_DesertShield', 'DC_Operation_Bragg',
  'Kursk', 'El_Alamein', 'Battle_of_the_Bulge', 'Gazala', 'Kharkov', 'Berlin',
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
 *  `AmphibiousCar` and its BTR-60 an `AmphibiousAPC`). BF1918 splits the
 *  row by weight: `HeavyTank` (row 0: A7V, Mark IV, Chamond) and
 *  `LightTank` (row 1: FT-17). An `UnarmedTank` (an armoured carrier) is
 *  not one. The rows are each mod's to number, so the name decides; a table
 *  extracted before the names were carried falls back to vanilla's row 0. */
export function tankRow(entry) {
  if (entry?.equipment != null) return /^(amphibious|heavy|light|medium)?tank$/i.test(String(entry.equipment));
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
 *  Tiger or an M10, 12 for a Sherman) where the AI data gives it, then how
 *  hard the AI rates its weapons against armour (`punch`: Desert Combat
 *  gives the M1A1, the Bradley and the Vulcan one worth, 12, and rates
 *  their guns 7, 6 and 1), then hit points, then name. Used for the
 *  defaults: your side's first, theirs' heaviest. */
export function tankRank(a, b) {
  return (Number(b.worth) || 0) - (Number(a.worth) || 0) || (Number(b.punch) || 0) - (Number(a.punch) || 0)
    || (Number(b.hitpoints) || 0) - (Number(a.hitpoints) || 0) || String(a.name).localeCompare(String(b.name));
}

/** The most the AI rates any of a vehicle's weapons against armour. */
export function armourPunch(entry) {
  const weapons = [entry?.aiWeapons, ...Object.values(entry?.seatsAi ?? {}).map(s => s?.aiWeapons)];
  return Math.max(0, ...weapons.flatMap(ws => Object.values(ws ?? {}).map(w => Number(w?.strength?.HeavyArmour) || 0)));
}
/** A catalogue row with the AI's worth and punch on it, for `tankRank`. */
function ranked(row, ai) {
  const entry = ai?.[row.name];
  const worth = Number(entry?.basicTemp);
  return Number.isFinite(worth) ? { ...row, worth, punch: armourPunch(entry) } : row;
}

/** A template as a crew says it: `PanzerIV` "Panzer IV", `T34-85` "T-34-85". */
export function prettyTank(template) {
  const t = String(template ?? '');
  const named = { PanzerIV: 'Panzer IV', T34: 'T-34', 'T34-85': 'T-34-85', 'Chi-ha': 'Chi-ha', M10: 'M10',
    // BF1918's, as their crews knew them; `_Beute` is a captured one.
    Mark4: 'Mark IV', Mark4_beute: 'Beute Mark IV', Mark8: 'Mark VIII', Chamond: 'Saint-Chamond', Schneider_ca1: 'Schneider CA1',
    FT17: 'FT-17', FT17MG: 'FT-17 machine gun', FT17_Beute: 'Beute FT-17', FT17MG_Beute: 'Beute FT-17 machine gun',
    Kolossal: 'K-Wagen', KolossalSpawn: 'K-Wagen', TreffAs: 'Treff-As', Whippet_Fire: 'Whippet', TsarTank: 'Tsar Tank',
    Ger77er: '77 mm field gun', Frz75er: '75 mm field gun', '18pdr_france': '18-pounder', Kuk75er: 'Austrian 75 mm field gun',
    Ita75er: 'Italian 75 mm field gun', Rus76er: 'Russian 76 mm field gun', GunCarrier: 'Gun Carrier', GeballteLadung: 'Geballte Ladung',
    GeballteLadungBig: 'heavy Geballte Ladung', Tankgewehr: 'Tankgewehr', PomPom: 'pom-pom', Schneider1913er: 'Schneider 105 mm',
    // Desert Combat's, by their designations.
    T72: 'T-72', BMP2: 'BMP-2', M2A3: 'M2A3 Bradley', M163: 'M163 Vulcan', Shilka: 'ZSU-23-4 Shilka', 'EE-9': 'EE-9 Cascavel',
    BRDM2: 'BRDM-2', BRDM2_Spandrel: 'BRDM-2 Spandrel', Humvee_TOW: 'Humvee TOW', RPG7: 'RPG-7', SA7: 'SA-7',
    GrenadeGer: 'stick grenade', GrenadeGerGunner: 'stick grenade', GrenadeGerStormtrooper: 'stick grenade', DosenGrenade: 'Dosen grenade',
    MillsBomb: 'Mills bomb', MillsBombGunner: 'Mills bomb', MillsBombBomber: 'Mills bomb', GrenadeFrz: 'French grenade', GrenadeFrzGunner: 'French grenade',
    F1Gren: 'F1 grenade', F1GrenGunner: 'F1 grenade', F1GrenBomber: 'F1 grenade', Kugel_Grenade13: 'ball grenade', Kugel_Grenade15: 'ball grenade' };
  if (named[t]) return named[t];
  return t.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

/** The sides that field a catalogue row on `level`: the level's own teams
 *  (`levelSides`, roster.py: team 1 "Axis", team 2 "Allied"), else the
 *  row's sides over every level. A side is the level's (ledger SIDE-1):
 *  BF1918's A7V is team 1's on Hindenburg Line and both teams' on
 *  Carriere, and its Mark IV team 2's on Hindenburg Line and both teams'
 *  on Battle of Cambrai, so a row's sides over the tree pair nothing. */
export function sidesOn(row, level) {
  const own = row?.levelSides?.[level];
  return Array.isArray(own) ? own : (row?.sides ?? []);
}

// A level's name in words. BF1918 names its levels in lower case
// (`villers_bretonneux`, `chemin_des_dames`): those are given capitals, the
// small words of a place name left small.
const SMALL = new Set(['of', 'the', 'de', 'des', 'du', 'd', 'la', 'le', 'les', 'and', 'a', 'to', 'in', 'on', 'am', 'an', 'der', 'die']);
// Desert Combat marks its own with `DC_` and runs two words together
// (`DC_DesertShield`): the mark comes off and the words apart.
export const levelWords = map => {
  const words = String(map).replace(/^DC_(.+)$/i, (_, rest) => rest.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .replace(/_/g, ' ').replace(/\bof the\b/gi, m => m.toLowerCase());
  if (/[A-Z]/.test(words)) return words;
  return words.split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
};

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
    for (const level of row.levels ?? []) {
      // A tank both sides drive there (a captured one) is neither's.
      const sides = sidesOn(row, level);
      if (sides.length !== 1) continue;
      const name = held ? held.get(String(level).toLowerCase()) : level;
      if (!name) continue;
      const entry = byLevel.get(name) ?? { Allied: new Map(), Axis: new Map() };
      entry[sides[0]]?.set(row.name, ranked(row, ai));
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
    all.set(row.name, ranked(row, ai));
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

/**
 * Where a hull's main gun can point, from its rig: one arc per gun of that
 * name (a Mark IV carries two 6-pounders, one in each sponson), each the
 * yaw limits of the first yawing part above it, in degrees right of the
 * nose (`[-90, 15]` for the Mark IV's left sponson, `[-10, 10]` for the
 * A7V's bow gun), or null for a turret that turns all the way round.
 * `nodes` are the hull's FireArms nodes; `name` the main gun's.
 */
export function gunArcs(nodes, name) {
  const out = [];
  // three's loader gives a second node of one name a `_1` (the Mark IV's
  // right sponson is `Mark4Gun_1` once loaded).
  const base = String(name ?? '').toLowerCase().replace(/_\d+$/, '');
  for (const n of nodes) {
    if (String(n.name).toLowerCase().replace(/_\d+$/, '') !== base) continue;
    let arc;
    for (let a = n.parent; a; a = a.parent) {
      const yaw = a.userData?.rig?.axes?.yaw;
      if (!yaw) continue;
      arc = yaw.free || yaw.min == null || yaw.max == null ? null : [Number(yaw.min), Number(yaw.max)];
      break;
    }
    if (arc !== undefined) out.push(arc);
  }
  return out;
}

/** The bearings (degrees right of the nose, -180 to 180) at least one arc
 *  covers, and those every arc covers: `{ any: width, all: [lo, hi] | null,
 *  round }`. `round` is a turret that turns all the way. */
export function arcCover(arcs) {
  if (!arcs.length) return null;
  if (arcs.some(a => a == null)) return { round: true, any: 360, all: null };
  const all = [Math.max(...arcs.map(a => a[0])), Math.min(...arcs.map(a => a[1]))];
  const steps = [];
  for (let b = -180; b < 180; b += 1) if (arcs.some(a => b >= a[0] && b <= a[1])) steps.push(b);
  return { round: false, any: steps.length, all: all[0] <= all[1] ? all : null };
}
