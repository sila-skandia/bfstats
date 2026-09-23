// The kits and loadouts: which kit the deploy screen's row hands a soldier on
// this level, the weapon at its `itemIndex 3`, the sleeves the team wears,
// the kit's inventory slots and max HP, the rows' display names, and the
// bots' kits. All of it read out of `_shared/loadouts.json`, which this
// module fetches and owns (`loadout.loadouts`), with the frozen vanilla
// tables standing in where the file is absent. Lifted out of hand-weapon.js
// (features/vehicle-instance-refactor).

import { kitRowLabel } from './kit-icon.js';

/**
 * Built once by `createHandWeapon`. `page` is the narrow bag of getters it
 * builds, naming what this module reads:
 * `bust`, `currentDir`, `deployKit`, `deployTeamId`, `handWeapon`, `KITS`,
 * `MAPS_BASE`, `params`, `SOLDIER_MAX_HP_FALLBACK`, `spawnLayout`,
 * `teamNation`.
 */
export function createKitLoadout(page) {
  const loadout = {};

  // Which weapon the deploy screen's kit puts in hand is the game's own data,
  // read from two places neither of which is the level's scene: the level's
  // `Init.con` (`game.setTeamSkin` / `game.setKit <team> <slot> <kit>`) and the
  // kit's `Objects.con` (the `HandFireArms` it carries at `itemIndex 3`, the
  // slot the engine selects on spawn). `extract_loadouts.py` reads both through
  // the kit readers and writes them as `_shared/loadouts.json` beside the
  // levels; `kitPrimary` below looks the answer up by level, team and row.
  loadout.loadouts = null;
  const loadoutsLoad = fetch(`${page.MAPS_BASE}/_shared/loadouts.json${page.bust()}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => { loadout.loadouts = data; return data; })
    .catch(err => { console.warn('loadouts unavailable', err); return null; });
  // The stand-in for a maps tree published before `_shared/loadouts.json`
  // existed, or a mod not yet run through the extractor: vanilla's kit
  // primaries by the nation a side flies (`teamNation`), in the spawn screen's
  // row order. Read from the same `Objects/Items/<Nation>Kit/*/Objects.con`
  // files the extractor reads — not a guess, but frozen here, so the file wins
  // whenever it is present.
  const FALLBACK_PRIMARIES = {
    us:   ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'No4'],
    brit: ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'No4'],
    rus:  ['No4Sniper', 'DP', 'Bazooka', 'Mp18', 'No4'],
    ger:  ['K98Sniper', 'Sg44', 'Panzershreck', 'Mp40', 'K98'],
    jp:   ['K98Sniper', 'Type99', 'Panzershreck', 'Mp18', 'Type5'],
  };
  // And the soldier those nations dress, for the arms rig, when the file is
  // not there to say which template the level actually names.
  const FALLBACK_SOLDIERS = {
    us: 'USSoldier', brit: 'BritishSoldier', rus: 'RussianSoldier',
    ger: 'GermanSoldier', jp: 'JapaneseSoldier',
  };

  // Nothing stands on a soldier spawn pad.
  //
  // There used to be a decorative 3P figure on every one of them — a clone of
  // `<Soldier>__<assault primary>.pose.glb`, so that a flythrough had people in
  // it as well as flags and vehicles. What it actually put on the map was a
  // **row of rifles hovering at chest height**, one per pad, and no people at
  // all: `Object3D.clone()` does not rebind a skeleton, so every clone's
  // `SkinnedMesh.skeleton` still pointed at the template's own bones, which are
  // not in the scene and sit at the origin. The bodies therefore all skinned to
  // the same spot near (0, 1.5, 0) while the weapon — a plain `Mesh` parented
  // into the *cloned* bone tree, so carried by the clone's own transform —
  // stayed out at the pad. Twenty-eight floating Sg44s on Berlin, and the same
  // on every level with spawns.
  //
  // The pads are empty in the real game, and this is a playable map now rather
  // than a flythrough, so the figures are gone rather than rebound: a row of
  // motionless mannequins at every spawn point is not what a player should walk
  // into. `splashTargets()` loses them as grenade targets with no replacement —
  // the player's own body is still in that list, and so is every vehicle.

  // The kit row's class, for finding a level's kit by class when its slot
  // numbering is not the vanilla one. `extract_kits.py` writes these labels
  // from the kit's `setType`; the row names are the page's.
  const KIT_CLASS = {
    scout: 'Scout', assault: 'Assault', antitank: 'Anti-tank',
    medic: 'Medic', engineer: 'Engineer',
  };

  /** What the chosen kit hands a soldier of `team` on this level: the kit the
   *  level binds to that row (`game.setKit <team> <row> <kit>`), the weapon at
   *  its `itemIndex 3`, and the soldier template the team wears. Every field
   *  null where `_shared/loadouts.json` is absent or does not name the level;
   *  `weaponTemplateFor` then falls back to the vanilla table by nation. */
  function kitLoadout(team, kitName = page.deployKit) {
    const side = loadout.loadouts?.levels?.[page.currentDir]?.[team];
    if (!side) return { kit: null, primary: null, soldier: null };
    const slot = page.KITS.indexOf(kitName);
    let kit = side.slots?.[String(slot)] || null;
    if (!kit || !loadout.loadouts.kits?.[kit]) {
      // A mod may file its classes in other rows; the class label is the
      // engine's own `setType`, so match on that before giving up.
      const wanted = KIT_CLASS[kitName];
      kit = Object.values(side.slots || {})
        .find(name => loadout.loadouts.kits?.[name]?.class === wanted) || kit;
    }
    return {
      kit,
      primary: loadout.loadouts.kits?.[kit]?.primary || null,
      soldier: side.soldier || null,
    };
  }

  // The five kit-row text leaves of the spawn layout, by their own lexicon
  // keys, mapped onto the page's row names. The keys are the layout's — the
  // menu's `Kit/Strings/KitName1..5` defaults — not the kits' `setKitName`
  // keys, which is exactly why the label cannot be the leaf's own text: a mod
  // re-points the row's kit (and its name) without touching the menu.
  const KIT_ROW_KEYS = {
    RESPAWN_SCOUT: 'scout', RESPAWN_ASSAULT: 'assault', RESPAWN_AT: 'antitank',
    RESPAWN_MEDIC: 'medic', RESPAWN_ENGINEER: 'engineer',
  };

  /** The display string for the kit row `role` on the current deploy team:
   *  the level's kit for that row, its own `ObjectTemplate.setKitName`
   *  resolved through the mod chain's lexicon (`loadouts.kits[kit].kitName`),
   *  falling back to the spawn layout's own string for the row and, last, the
   *  page's class word. Shared by the canvas text (`deployText`) and the
   *  kit buttons' aria-labels, so both say the same. */
  function kitRowLabelFor(role, layoutText) {
    const { kit } = kitLoadout(page.deployTeamId, role);
    const name = kit ? loadout.loadouts?.kits?.[kit]?.kitName : null;
    return kitRowLabel(name, layoutText, KIT_CLASS[role] || role);
  }

  /** `kitRowLabelFor`'s fallback, for the callers without the leaf in hand
   *  (the buttons' aria-labels): the spawn layout's own resolved string for
   *  the row. */
  function kitRowLayoutText(role) {
    const key = Object.entries(KIT_ROW_KEYS).find(([, r]) => r === role)?.[0];
    if (!key) return null;
    const el = page.spawnLayout.data?.groups?.spawn?.elements
      ?.find(e => e.kind === 'text' && e.key === key);
    return el?.text ?? null;
  }

  /** The max HP a soldier of `flag`'s team, holding the deploy screen's chosen
   *  kit, spawns with — `_shared/loadouts.json`'s own `maxHitpoints` for that
   *  kit, or `SOLDIER_MAX_HP_FALLBACK` when the field or the file is not there
   *  yet (the same fallback shape `weaponTemplateFor` uses for a primary). */
  function soldierMaxHp(flag) {
    const { kit } = kitLoadout(flag?.team, page.deployKit);
    const maxHp = loadout.loadouts?.kits?.[kit]?.maxHitpoints;
    return Number.isFinite(maxHp) ? maxHp : page.SOLDIER_MAX_HP_FALLBACK;
  }

  /** The template a soldier of `flag`'s team spawns holding, with the kit the
   *  deploy screen chose. `?weapon=` overrides everything, as it always has. */
  function weaponTemplateFor(flag, kitName = page.deployKit) {
    const forced = page.params.get('weapon');
    if (forced) return forced;
    const team = flag?.team;
    const loadout = kitLoadout(team, kitName);
    if (loadout.primary) return loadout.primary;
    const slot = Math.max(0, page.KITS.indexOf(kitName));
    return FALLBACK_PRIMARIES[page.teamNation(team)]?.[slot]
      || FALLBACK_PRIMARIES[team === 1 ? 'ger' : 'us'][slot];
  }

  /** The soldier template whose sleeves the arms rig should wear: the level's
   *  `game.setTeamSkin`, or the nation's soldier when the file is absent. */
  function soldierTemplateFor(flag) {
    const team = flag?.team;
    return kitLoadout(team).soldier
      || FALLBACK_SOLDIERS[page.teamNation(team)]
      || (team === 1 ? 'GermanSoldier' : 'USSoldier');
  }

  /** The kit the level binds to `flag.team`'s chosen row, as slots. Null where
   *  `_shared/loadouts.json` is absent, does not know the level, or does not
   *  know the kit — the same "no data, fall back" shape `kitLoadout` has. */
  function kitSlotsFor(flag) {
    const { kit } = kitLoadout(flag?.team, page.deployKit);
    const weapons = kit ? loadout.loadouts?.kits?.[kit]?.weapons : null;
    return Array.isArray(weapons) && weapons.length ? weapons : null;
  }

  /** Which slot number `template` occupies in `slots`, or null. Case-insensitive:
   *  the kit files and the weapons' own `create` lines disagree on casing. */
  function slotOf(slots, template) {
    const want = String(template || '').toLowerCase();
    const found = slots.find(entry => entry.weapon.toLowerCase() === want);
    return found ? found.slot : null;
  }

  /**
   * A bot's kit: uniform among the side's kits on this level (the engine's
   * `findKitDiff` weight is 1 for every allowed kit), with the AI weapon
   * templates of its items (`aiWeapons` in `_shared/loadouts.json`), the
   * primary first.
   */
  function botKitFor(team, index) {
    const slots = loadout.loadouts?.levels?.[page.currentDir]?.[team]?.slots;
    const names = (Array.isArray(slots) ? slots : Object.values(slots ?? {})).filter(Boolean);
    if (!names.length) return null;
    const kitName = names[Math.floor(Math.random() * names.length)];
    const kit = loadout.loadouts?.kits?.[kitName];
    if (!kit) return null;
    const items = [...(kit.items ?? [])];
    if (kit.primary) items.sort((a, b) => (a === kit.primary ? -1 : 0) - (b === kit.primary ? -1 : 0));
    const weapons = items.map(item => {
      const ai = loadout.loadouts?.aiWeapons?.[item];
      return ai ? { ...ai, name: item } : null;
    }).filter(Boolean);
    return { name: kitName, primary: kit.primary ?? items[0] ?? null, weapons };
  }

  /** The human's current weapon's AI sound radius, for the bots' hearing. */
  function localWeaponSoundRadius() {
    const template = page.handWeapon?.template ?? page.handWeapon?.group?.template ?? null;
    return loadout.loadouts?.aiWeapons?.[template]?.soundSphereRadius ?? null;
  }

  Object.assign(loadout, {
    KIT_ROW_KEYS,
    botKitFor,
    kitLoadout,
    kitRowLabelFor,
    kitRowLayoutText,
    kitSlotsFor,
    loadoutsLoad,
    localWeaponSoundRadius,
    slotOf,
    soldierMaxHp,
    soldierTemplateFor,
    weaponTemplateFor,
  });
  return loadout;
}
