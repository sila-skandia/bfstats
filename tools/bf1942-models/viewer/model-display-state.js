// What the model inspector's Display and Hit regions tabs do to a material,
// worked out as plain numbers so a node harness can hold it without WebGL
// (`tests/test_model_workbench.py`). `model-display.js` and
// `model-armour.js` apply these to the three.js materials; nothing here
// imports three. features/mesh-viewer-advanced-tab has the design.

// three's side constants (FrontSide, BackSide, DoubleSide).
export const FRONT_SIDE = 0;
export const DOUBLE_SIDE = 2;

/** The Display tab's starting state, and what Reset puts back. */
export const DISPLAY_DEFAULTS = Object.freeze({
  textures: true,        // false: flat grey
  opacity: 1,            // texture opacity, 1 opaque .. 0 gone
  wireframe: false,      // the edges, drawn over the surface
  seeThrough: false,     // a faded surface shows its back faces and hidden edges
  doubleside: false,
  explode: false,
  explodeAmount: 0.5,
});

/** The colour a flat-grey surface takes. */
export const FLAT_GREY = 0x9a9a90;

/** Below this a slider value counts as fully opaque (a slider never lands on 1.0 exactly from a drag). */
const OPAQUE = 0.995;

/** The texture opacity slider's own value, clamped and stepped. */
export function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** `40%` for the slider's readout. */
export function opacityLabel(value) {
  return `${Math.round(clampOpacity(value) * 100)}%`;
}

/**
 * What a model material snapshot needs to remember before the tabs touch it.
 * `material` is anything with three's Material fields.
 */
export function snapshotMaterial(material) {
  return {
    map: material.map ?? null,
    color: material.color?.getHex ? material.color.getHex() : 0xffffff,
    transparent: Boolean(material.transparent),
    opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
    depthWrite: material.depthWrite !== false,
    alphaTest: Number(material.alphaTest) || 0,
    side: Number.isFinite(material.side) ? material.side : FRONT_SIDE,
    // An additive muzzle flash or tracer glow (the exporter's `additive`
    // extra, set on load in index.html) is blended already.
    additive: Boolean(material.userData?.additive),
  };
}

/**
 * The material fields for one visual (not collision) material under the
 * Display state. `hideModel` is the Hit regions tab's "Regions only".
 *
 * The rules, each one for a reason a modder would see:
 *  - A faded surface is drawn blended with its depth write off, and a
 *    depth-only copy of the mesh drawn first keeps only its nearest face
 *    (`prepass`), so a 40% hull is one clean skin, not every back face and
 *    interior part stacked. `seeThrough` drops that copy and shows both
 *    sides, for when the inside is the point.
 *  - An alpha-tested cut-out (foliage, netting, a skin with holes) has its
 *    threshold scaled with the opacity: three tests `texel.a * opacity`
 *    against `alphaTest`, so an unscaled threshold would cut the whole
 *    surface away at low opacity. Its prepass copy keeps the map and the
 *    unscaled threshold, so the holes stay holes in depth too.
 *  - A material blended already (glass, an additive flash) keeps its own
 *    depth write and blending; only its opacity is scaled, and it gets no
 *    prepass (a depth copy of glass would hide what is behind it).
 *  - With the wireframe on, the surface is pushed back a hair
 *    (`polygonOffset`) so the edges on top of it do not z-fight.
 */
export function surfaceSettings(snapshot, state, { hideModel = false } = {}) {
  const k = clampOpacity(state.opacity);
  const faded = k < OPAQUE;
  const blendedAlready = snapshot.transparent || snapshot.additive;
  const out = {
    visible: !hideModel && k > 0,
    map: state.textures ? snapshot.map : null,
    color: state.textures ? snapshot.color : FLAT_GREY,
    side: state.doubleside || (faded && state.seeThrough) ? DOUBLE_SIDE : snapshot.side,
    polygonOffset: Boolean(state.wireframe),
    transparent: snapshot.transparent,
    opacity: snapshot.opacity,
    depthWrite: snapshot.depthWrite,
    alphaTest: snapshot.alphaTest,
    prepass: null,
  };
  if (!faded) return out;
  out.transparent = true;
  out.opacity = snapshot.opacity * k;
  out.alphaTest = snapshot.alphaTest * k;
  out.depthWrite = blendedAlready ? snapshot.depthWrite : false;
  if (!blendedAlready && !state.seeThrough && out.visible) {
    out.prepass = {
      alphaTest: snapshot.alphaTest,
      map: snapshot.alphaTest > 0 ? snapshot.map : null,
      side: out.side,
    };
  }
  return out;
}

/**
 * The edges overlay: drawn whenever the wireframe is on and the model is
 * shown. Depth-tested against the surface's nearest face so only the edges
 * you could see are drawn, unless `seeThrough` asks for every edge.
 */
export function wireSettings(state, { hideModel = false } = {}) {
  return {
    visible: Boolean(state.wireframe) && !hideModel,
    depthTest: !state.seeThrough,
    // Soft enough that the paint under a dense mesh still reads; stronger
    // once the surface is faint and the edges are the picture.
    opacity: clampOpacity(state.opacity) < 0.3 ? 0.75 : 0.4,
  };
}

/** The Hit regions tab's three modes. */
export const REGION_MODES = Object.freeze(['off', 'overlay', 'only']);

/**
 * What a region mode draws: whether the collision hulls show, whether the
 * model itself hides, and the hulls' default opacity. "Over model" draws the
 * hulls in a pass of their own after the model (index.html `renderFrame`),
 * depth-tested only against each other, so they read through the paint.
 */
export function regionSettings(mode, opacity = null) {
  const m = REGION_MODES.includes(mode) ? mode : 'off';
  const fallback = m === 'only' ? 0.85 : 0.5;
  const value = opacity === null ? fallback : Math.min(1, Math.max(0.1, Number(opacity) || fallback));
  return {
    mode: m,
    show: m !== 'off',
    hideModel: m === 'only',
    opacity: value,
  };
}

/** `true`/`false` from the old checkbox hook, or a mode name. */
export function regionModeOf(value) {
  if (value === true) return 'overlay';
  if (value === false || value == null) return 'off';
  return REGION_MODES.includes(value) ? value : 'off';
}

/** The inspector's tabs, in strip order; the first is the visitor's default. */
export const WORKBENCH_TABS = Object.freeze(['regions', 'display', 'model']);

/** A stored or linked tab name, or the default. */
export function tabOf(value) {
  return WORKBENCH_TABS.includes(value) ? value : WORKBENCH_TABS[0];
}
