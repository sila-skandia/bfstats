// The pictures on THE RANGE's two drill cards (features/proving-ground, "The
// front end's tab"): loading screens of the game or mod the front end is on,
// one with a tank on it for LIVE-FIRE RANGE and one with aircraft for
// DOGFIGHT SCHOOL, so the cards change with the mod picked on CUSTOM GAME.
//
// A loading screen does not say what is painted on it, so the two are picked
// by eye, per tree, from the pictures its `maps.json` rows name
// (`loading.background`). A mod with no row here, and a picture that is not in
// the tree, show vanilla's.
//
// `art` is a path inside the tree's maps folder. `crop` is the part of the
// picture the card shows, `[x0, y0, x1, y1]` as fractions of it: Desert
// Combat's screens are letterboxed, Eve of Destruction's carry the mod's name
// across the top, BF1918's sit in a frame, and Forgotten Hope's are title
// cards with the picture in a strip across the middle. The card's words sit
// on a dark wash over its lower half, so a crop also puts the machine in the
// upper half. Every loading screen is 800x600 (`extract_loading_assets.py`),
// which is what the card's CSS assumes when it scales the crop to cover
// (`.pgm-mode-pic`).

const FULL = Object.freeze([0, 0, 1, 1]);

export const DRILLS = Object.freeze(['range', 'school']);

/** Forgotten Hope: Secret Weapon, and the Europe build over the same tree. */
const FHSW = Object.freeze({
  // Breakthrough's heavy tank; Desert Rose's flight of fighters.
  range: { art: '_shared/load/breaktrough.webp', crop: [0, 0.3, 0.66, 1] },
  school: { art: '_shared/load/desertrose.webp', crop: [0, 0.32, 0.6, 0.86] },
});

export const DRILL_ART = Object.freeze({
  // The Sherman in the desert; the bombers over Britain.
  bf1942: {
    range: { art: '_shared/load/desert.webp' },
    school: { art: 'battle_of_britain/load.webp' },
  },
  // Road to Rome: the knocked-out tank; the raid on the tower.
  xpack1: {
    range: { art: '_shared/load/sturm-guy.webp' },
    school: { art: '_shared/load/italytower.webp' },
  },
  // Secret Weapons: the Sherman Calliope; the Goblin.
  xpack2: {
    range: { art: '_shared/load/placeholder_calliope.webp', crop: [0, 0.22, 0.75, 1] },
    school: { art: '_shared/load/placeholder_goblin.webp', crop: [0.1, 0.42, 0.8, 1] },
  },
  // Desert Combat: the Abrams; the F-15.
  desertcombat: {
    range: { art: '_shared/load/dc_tanks.webp', crop: [0, 0.36, 0.62, 1] },
    school: { art: '_shared/load/dc_f15.webp', crop: [0, 0.11, 1, 0.87] },
  },
  // Eve of Destruction: Kharkov's tank; Aces over Vietnam's jet.
  eod: {
    range: { art: 'kharkov/load.webp', crop: [0, 0.18, 0.9, 1] },
    school: { art: 'aces_over_vietnam/load.webp', crop: [0.1, 0.17, 1, 0.92] },
  },
  // Forgotten Hope: Goodwood's Panther; Midway's carrier aircraft.
  fh: {
    range: { art: '_shared/load/operationgoodwood.webp', crop: [0, 0.3, 0.74, 1] },
    school: { art: 'midway-1942/load.webp', crop: [0.2, 0.37, 0.86, 0.92] },
  },
  fhsw: FHSW,
  fhsweurope: FHSW,
  // BF1918: Battle of the Giants' ditched tank; the Fokker Scourge's triplanes.
  bf1918: {
    range: { art: 'battle_of_the_giants/load.webp', crop: [0.12, 0.4, 0.78, 0.95] },
    school: { art: 'tgw_fokker_scourge/load.webp', crop: [0.1, 0.22, 0.96, 0.9] },
  },
});

/**
 * Each drill's pictures for a mod, best first: the mod's own pick in its own
 * tree, then vanilla's in vanilla's. The card shows the first that loads.
 *
 * @param {{id: string, maps: string}|null} mod  the active mod and its maps
 *        folder (`skirmish.js` `modPaths`)
 * @returns {Record<string, {path: string, crop: readonly number[]}[]>}
 */
export function drillArt(mod) {
  const own = DRILL_ART[String(mod?.id ?? '').toLowerCase()] ?? null;
  const base = String(mod?.maps ?? '').replace(/\/+$/, '');
  const out = {};
  for (const drill of DRILLS) {
    const chain = [];
    const add = (folder, pick) => {
      const path = `${folder}/${pick.art}`;
      if (!chain.some(c => c.path === path)) chain.push({ path, crop: pick.crop ?? FULL });
    };
    if (own?.[drill] && base) add(base, own[drill]);
    add('maps', DRILL_ART.bf1942[drill]);
    out[drill] = chain;
  }
  return out;
}
