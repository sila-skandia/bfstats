// The verdict rules of audit_render.mjs, kept apart so a node test can read
// them without a browser (tests/test_audit_render_rules.py).

// A model that draws one triangle a few centimetres across is a placeholder,
// not a model: FHSW's logic objects carry `ratte_88_dummy_m1` or
// `CNSPAirDummy` (one triangle, 0.02 m) so a PlayerControlObject has a
// geometry, and the hard AT mine draws `mine_invisible` (0.08 m). Killer
// cages, spawn breakers, ammo-box depots: their business is a SupplyDepot
// radius, and retail draws nothing there either. 0 px is right for them.
// Every one-triangle manifest row of the nine trees is under 0.25 m except
// BuildingSmokeIdleDark (1 m, an effect's sprite), which this does not cover.
export const PLACEHOLDER_MAX_TRIANGLES = 1;
export const PLACEHOLDER_MAX_EXTENT = 0.25;

export function isPlaceholderModel(m) {
  return (m.tris ?? 0) > 0 && m.tris <= PLACEHOLDER_MAX_TRIANGLES
    && (m.extent ?? Infinity) < PLACEHOLDER_MAX_EXTENT;
}

// A model frame is flagged for too few pixels (a small model that drew
// nothing; a composite hundreds of metres across is a few pixels at thumbnail
// scale, and an empty one is the static audit's `model-draws-nothing`), or
// for a share of pure white, magenta or black above the thresholds.
export function modelFlagged(m, row, { white, magenta, black }) {
  if (isPlaceholderModel(m)) return false;
  const tiny = row.model < 200 && m.tris > 0 && m.extent < 80;
  return tiny || row.white > white || row.magenta > magenta || row.black > black;
}
