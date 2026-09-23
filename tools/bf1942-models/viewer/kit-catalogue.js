// The kit inspector's catalogue: the three manifests it joins (kits.json, the
// pose matrix and models.json), read from the mod's subtree with vanilla as
// the floor, and the kits built from them. Lifted out of kits.html
// (features/vehicle-instance-refactor, Part 2d).

/**
 * Built once by the page, where this code used to sit; the manifests are
 * fetched before it resolves. `page` hands in what it reads of the rest of
 * the page, as getters:
 * `activeMod`, `bust`.
 */
export async function createKitCatalogue(page) {
  const catalogue = {};

  const MODELS_BASE = page.activeMod.paths.models;
  const POSES_BASE = page.activeMod.paths.poses;

  // An expansion is extracted with `--own`: only the templates it declares for
  // itself, because Road to Rome's catalogue is 113 templates and 94 of them are
  // vanilla's. Its *kits* are not filtered the same way — a Road to Rome map
  // fields British riflemen, and a roster that hid them would misrepresent the
  // pack — so the page has to reach assets the mod's own subtree does not hold.
  //
  // Vanilla is the floor for exactly the reason inheritance works in the engine:
  // a Road to Rome British rifleman IS a vanilla British rifleman. Falling back to
  // it costs one extra fetch only on a miss, and only for mods.
  const VANILLA_MODELS = 'models';
  const VANILLA_POSES = 'models/poses';
  const isVanilla = page.activeMod.id === 'bf1942';

  /** Fetch from the mod's subtree, then vanilla. Null if neither has it. */
  async function fetchJson(relative, bases) {
    for (const base of bases) {
      try {
        const response = await fetch(`${base}/${relative}${page.bust()}`);
        if (response.ok) return await response.json();
      } catch { /* try the next base */ }
    }
    return null;
  }

  const MODEL_BASES = isVanilla ? [MODELS_BASE] : [MODELS_BASE, VANILLA_MODELS];
  const POSE_BASES = isVanilla ? [POSES_BASE] : [POSES_BASE, VANILLA_POSES];

  // --- Manifests --------------------------------------------------------------
  //
  // kits.json is written by extract_kits.py and carries one row per kit a level
  // actually binds. A tree published before kits existed simply has no such file;
  // the page then says so rather than erroring, the same contract mods.js already
  // honours for a missing mods.json.
  const kitData = await fetchJson('kits.json', [MODELS_BASE]);

  // Whether a soldier can be shown *holding* a weapon is already recorded, per
  // pair, in the pose matrix. Joining against it beats having extract_kits.py
  // restate the fact: one source of truth, and a pose extraction that has not run
  // yet degrades on its own instead of making the manifest a liar.
  // Keyed lowercased, valued with the matrix's own spelling AND the base it came
  // from. The two halves of the key are not the same string: a `.con` file spells
  // its templates however the author felt that day — vanilla kits carry `MP40`,
  // `walterp38` and `k98Sniper` while the pose extraction wrote `Mp40`,
  // `WalterP38` and `K98Sniper` — so a URL built from the kit's spelling 404s on
  // any case-sensitive server. Match case-insensitively, then build the URL from
  // what the matrix says.
  //
  // The mod's own matrix wins; vanilla fills the gaps `--own` left behind.
  const posedPairs = new Map();
  for (const base of [...POSE_BASES].reverse()) {
    const matrix = await fetchJson('poses-matrix.json', [base]);
    for (const pair of matrix?.pairs || []) {
      if (pair.error) continue;
      posedPairs.set(`${pair.soldier}|${pair.weapon}`.toLowerCase(), { ...pair, base });
    }
  }

  // models.json gives the rack its thumbnails and its true-scale numbers. Absent
  // (or a weapon that was never extracted) is a visible gap, never a hidden one.
  // Same shape: the mod's entries win, vanilla's fill the gaps, and each carries
  // the base its `glb`/`thumb` paths are relative to.
  const modelByName = new Map();
  for (const base of [...MODEL_BASES].reverse()) {
    for (const entry of (await fetchJson('models.json', [base])) || [])
      modelByName.set(entry.name.toLowerCase(), { ...entry, base });
  }

  const kits = (kitData?.kits || []).map((kit, index) => ({
    ...kit,
    index,
    items: (kit.items || []).map(item => ({
      ...item,
      entry: modelByName.get(String(item.template).toLowerCase()) || null,
    })),
    haystack: [
      kit.nation, kit.class, kit.side, kit.theatre, kit.template,
      ...(kit.soldiers || []),
      ...(kit.items || []).map(item => item.template),
      ...(kit.worn || []).map(part => part.template),
      ...(kit.levels || []).map(level => level.replace(/_/g, ' ')),
    ].filter(Boolean).join(' ').toLowerCase(),
  }));

  /** The pose matrix's row for this pairing, whatever either side spelled it. */
  const posedPair = (soldier, weapon) =>
    (soldier && weapon && posedPairs.get(`${soldier}|${weapon}`.toLowerCase())) || null;
  const posed = (soldier, weapon) => Boolean(posedPair(soldier, weapon));

  Object.assign(catalogue, {
    kitData,
    kits,
    MODEL_BASES,
    modelByName,
    posed,
    posedPair,
  });
  return catalogue;
}
