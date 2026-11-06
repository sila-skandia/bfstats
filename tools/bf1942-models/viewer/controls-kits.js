// The controls preview's kit racks (features/proving-ground, "The controls
// preview"): the pure half, so it runs under node. No three.js, no DOM.

/**
 * The kits of `kits.json` by faction, for the preview's two selects: a
 * nation (and its theatre, where it fields two wardrobes), the Axis first,
 * each with its kits in the file's order. Pure, for the tests.
 */
export function kitFactions(rows) {
  const out = [];
  for (const kit of rows ?? []) {
    const id = kit.theatre ? `${kit.nation} (${kit.theatre})` : (kit.nation || 'Unknown');
    let faction = out.find(f => f.id === id);
    if (!faction) {
      faction = { id, label: id, side: kit.side || (kit.team === 1 ? 'Axis' : 'Allied'), kits: [] };
      out.push(faction);
    }
    faction.kits.push({ template: kit.template, label: kit.class || kit.template, primary: kit.primary ?? null });
  }
  out.sort((a, b) => (a.side === b.side ? 0 : a.side === 'Axis' ? -1 : 1) || a.label.localeCompare(b.label));
  return out;
}

/**
 * The soldier and weapon the preview poses for `kit`: the kit's own
 * soldiers in order, the primary first and then the rest of its items, the
 * first pairing `posed(soldier, weapon)` knows; the soldiers of the kit's own
 * theatre first. Null when none is posed.
 */
export function pickPosedPair(kit, posed) {
  const weapons = [kit?.primary, ...(kit?.items ?? []).map(i => i?.template)].filter(Boolean);
  // The soldier of the kit's own theatre first: a plain German kit on the
  // European man, the Desert kit on the Afrika Korps one.
  const theatre = String(kit?.theatre ?? '').toLowerCase();
  const dressed = /desert|winter|snow|arctic/i;
  const fits = name => (theatre ? String(name).toLowerCase().includes(theatre) : !dressed.test(name));
  const soldiers = [...(kit?.soldiers ?? [])].sort((a, b) => Number(fits(b)) - Number(fits(a)));
  for (const soldier of soldiers) {
    for (const weapon of weapons) if (posed(soldier, weapon)) return { soldier, weapon };
  }
  return null;
}


/**
 * One probe over two control maps: the tab's own and the infantry's, for the
 * COMMON tab, whose map has no walk, crouch or fire, so the soldier stood
 * still under it. An axis answers the first non-zero of the two; a trigger
 * is held if either holds it.
 */
export function mergeProbes(own, other) {
  return {
    axis: trigger => own.axis(trigger) || other.axis(trigger),
    held: trigger => own.held(trigger) || other.held(trigger),
  };
}

/** The preview's camera views, in the order `c_PIToggleCameraMode` cycles
 *  them: the game's own four (`c_PICameraMode1..4`, F9 to F12). */
export const CAMERA_MODES = ['inside', 'chaseRear', 'chaseFront', 'flyBy'];

/**
 * The camera view after this tick: a mode key held picks its view; the
 * toggle's press edge (`held` now, `was` not) steps to the next. `probe` is
 * `controls.probe`'s. Returns `{ mode, toggleWas }`.
 */
export function cameraModeFrom(probe, mode, toggleWas) {
  let next = CAMERA_MODES.includes(mode) ? mode : 'chaseRear';
  CAMERA_MODES.forEach((name, i) => { if (probe.held(`c_PICameraMode${i + 1}`)) next = name; });
  const toggle = probe.held('c_PIToggleCameraMode');
  if (toggle && !toggleWas) next = CAMERA_MODES[(CAMERA_MODES.indexOf(next) + 1) % CAMERA_MODES.length];
  return { mode: next, toggleWas: toggle };
}
