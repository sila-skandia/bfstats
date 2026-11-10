// Drives `viewer/model-display-state.js` outside a browser and prints one
// JSON blob for `test_model_workbench.py`. The module imports nothing, so the
// file under test is the file the page loads, byte for byte, with no WebGL.

import { DISPLAY_DEFAULTS, DOUBLE_SIDE, FLAT_GREY, FRONT_SIDE, REGION_MODES, WORKBENCH_TABS,
         clampOpacity, opacityLabel, regionModeOf, regionSettings, snapshotMaterial,
         surfaceSettings, tabOf, wireSettings } from './model-display-state.js';

const colour = hex => ({ getHex: () => hex });
const MAP = { name: 'skin' };
const opaque = snapshotMaterial({ map: MAP, color: colour(0xffffff), transparent: false, opacity: 1,
  depthWrite: true, alphaTest: 0, side: FRONT_SIDE });
const cutout = snapshotMaterial({ map: MAP, color: colour(0xffffff), transparent: false, opacity: 1,
  depthWrite: true, alphaTest: 0.5, side: FRONT_SIDE });
const glass = snapshotMaterial({ map: MAP, color: colour(0xddeeff), transparent: true, opacity: 0.6,
  depthWrite: false, alphaTest: 0, side: FRONT_SIDE });
const flash = snapshotMaterial({ map: MAP, color: colour(0xffffff), transparent: false, opacity: 1,
  depthWrite: true, alphaTest: 0, side: FRONT_SIDE, userData: { additive: true } });

const state = patch => ({ ...DISPLAY_DEFAULTS, ...patch });
const plain = s => JSON.parse(JSON.stringify(s, (k, v) => (v === MAP ? 'MAP' : v)));

const results = {
  defaults: plain(DISPLAY_DEFAULTS),
  constants: { FLAT_GREY, DOUBLE_SIDE, FRONT_SIDE, REGION_MODES, WORKBENCH_TABS },
  snapshot: { opaque: plain(opaque), cutout: plain(cutout), glass: plain(glass), flash: plain(flash) },
  surface: {
    defaultOpaque: plain(surfaceSettings(opaque, state({}))),
    texturesOff: plain(surfaceSettings(opaque, state({ textures: false }))),
    opaque40: plain(surfaceSettings(opaque, state({ opacity: 0.4 }))),
    opaque40Wire: plain(surfaceSettings(opaque, state({ opacity: 0.4, wireframe: true }))),
    opaque40SeeThrough: plain(surfaceSettings(opaque, state({ opacity: 0.4, seeThrough: true }))),
    opaqueZero: plain(surfaceSettings(opaque, state({ opacity: 0 }))),
    cutout40: plain(surfaceSettings(cutout, state({ opacity: 0.4 }))),
    cutoutOpaque: plain(surfaceSettings(cutout, state({}))),
    glass40: plain(surfaceSettings(glass, state({ opacity: 0.4 }))),
    glassOpaque: plain(surfaceSettings(glass, state({}))),
    flash40: plain(surfaceSettings(flash, state({ opacity: 0.4 }))),
    doubleside: plain(surfaceSettings(opaque, state({ doubleside: true }))),
    hidden: plain(surfaceSettings(opaque, state({ opacity: 0.4 }), { hideModel: true })),
    wireOpaque: plain(surfaceSettings(opaque, state({ wireframe: true }))),
  },
  wire: {
    off: wireSettings(state({})),
    on: wireSettings(state({ wireframe: true })),
    faint: wireSettings(state({ wireframe: true, opacity: 0.1 })),
    seeThrough: wireSettings(state({ wireframe: true, seeThrough: true })),
    hidden: wireSettings(state({ wireframe: true }), { hideModel: true }),
  },
  clamp: {
    over: clampOpacity(1.7), under: clampOpacity(-1), text: clampOpacity('0.4'),
    junk: clampOpacity('x'), step: clampOpacity(0.4049),
    label40: opacityLabel(0.4), label0: opacityLabel(0), label100: opacityLabel(1),
  },
  regions: {
    off: regionSettings('off'), overlay: regionSettings('overlay'), only: regionSettings('only'),
    unknown: regionSettings('xray'), overlay75: regionSettings('overlay', 0.75),
    floor: regionSettings('overlay', 0.01),
  },
  modeOf: {
    yes: regionModeOf(true), no: regionModeOf(false), nil: regionModeOf(null),
    only: regionModeOf('only'), junk: regionModeOf('xray'),
  },
  tabs: { none: tabOf(null), display: tabOf('display'), junk: tabOf('armour') },
};

console.log(JSON.stringify(results));
