// OPTIONS > VIDEO's settings under node (features/video-options): the stored
// choice, the presets, the numbers each row hands the engine, and the page
// systems that take them. `test_video_settings.py` reads what this prints.
//
// `texture-quality.js` imports the bare specifier `three`, which the viewer
// maps in its import map; under node the runner's hooks (`sim/env.mjs`) map
// it onto the vendored build, so the modules that need it load after them.

import {
  applyPreset, changeVideo, chosenDisplayMode, DEFAULT_VIDEO, displayModes, displayOf, displayPixelRatio,
  EFFECTS, GRAPHICS, migrateRenderScale, normalizeVideo, onVideoChange, performanceOf,
  PRESETS, scaledViewDistance, screenFrame, storedVideo, storeVideo, TEXTURE, VIDEO_KEY, viewDistanceFog,
} from '../viewer/video-settings.js';
import { lodPercent, selectLod, setLodPercent } from '../viewer/mesh-cull.js';
import { EmitterClock, emitterIntensityScale, setEmitterIntensityScale } from '../viewer/effects-core.js';
import { ENVMAP_SWITCH, envmapFragmentPatch } from '../viewer/envmap.js';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

installModuleHooks(viewerDir());
const { textureState } = await import('../viewer/texture-quality.js');
const { pixelRatioFor } = await import('../viewer/video-apply.js');
const { billboardJudgedDistance, viewFieldOfView } = await import('../viewer/tree-foliage.js');

const memory = () => ({
  data: {},
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; },
});
const throwing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};

const out = {};
out.defaults = { ...DEFAULT_VIDEO };
out.presets = PRESETS;
out.graphics = GRAPHICS;
out.effects = EFFECTS;
out.texture = TEXTURE;
out.key = VIDEO_KEY;
out.defaultPerformance = performanceOf(storedVideo(memory()));

// A choice stored before SHADOWS was a row.
{
  const kept = raw => {
    const s = memory();
    s.setItem(VIDEO_KEY, JSON.stringify(raw));
    const v = storedVideo(s);
    return { performance: performanceOf(v), shadows: v.shadows };
  };
  const without = level => { const { shadows: _s, ...rest } = PRESETS[level]; return rest; };
  out.shadowsKept = {
    low: kept(without(1)), medium: kept(without(2)), high: kept(without(3)),
    mix: kept({ ...without(1), viewDistance: 90 }),
    off: kept({ ...PRESETS[3], shadows: false }),
  };
}

// The stored choice, and storage that refuses.
{
  const s = memory();
  let told = null;
  const off = onVideoChange(v => { told = v; });
  const after = changeVideo({ graphicsQuality: 1, viewDistance: 80 }, s);
  off();
  out.change = {
    stored: JSON.parse(s.getItem(VIDEO_KEY)),
    told: told && { graphicsQuality: told.graphicsQuality, viewDistance: told.viewDistance },
    performance: performanceOf(after),
    custom: after.custom,
  };
  // A preset over that, then CUSTOM back.
  const medium = applyPreset(storedVideo(s), 2);
  storeVideo(medium, s);
  out.medium = { performance: performanceOf(medium), graphicsQuality: medium.graphicsQuality,
                 viewDistance: medium.viewDistance, custom: medium.custom?.graphicsQuality ?? null };
  const back = applyPreset(storedVideo(s), 0);
  out.customBack = { performance: performanceOf(back), graphicsQuality: back.graphicsQuality,
                     viewDistance: back.viewDistance };
  changeVideo(null, s);
  out.cleared = s.getItem(VIDEO_KEY);
  out.throwing = { read: storedVideo(throwing), write: (() => { storeVideo({ graphicsQuality: 1 }, throwing); return 'ok'; })(),
                   change: changeVideo({ effectsQuality: 1 }, throwing).effectsQuality };
  const junk = memory(); junk.setItem(VIDEO_KEY, '{not json');
  out.junk = storedVideo(junk);
  out.clamped = normalizeVideo({ graphicsQuality: 9, viewDistance: 20, textureQuality: 0, displayHeight: 99999,
                                 environmentMapping: 'yes' });
}

// VIEW DISTANCE.
out.viewDistance = {
  wake75: scaledViewDistance(500, 75),
  wake50: scaledViewDistance(500, 50),
  fogAt375: viewDistanceFog(375),
  fogAt150: viewDistanceFog(150),
  fogAt500: viewDistanceFog(500),
};

// GRAPHICS QUALITY on a static's LOD chain: a mesh of radius 3 with LODs at
// 0, 50 and 120 m, asked at 60 m and at 110 m.
{
  const spec = { r: 3, m: 1, dists: [0, 50, 120] };
  const at = (d, p) => selectLod(spec, d * d, 1, p);
  out.lod = {
    high: [at(60, 1), at(110, 1)],
    low: [at(60, 0.6), at(110, 0.6)],
    live: (() => { setLodPercent(0.8); const p = lodPercent(); setLodPercent(1); return [p, lodPercent()]; })(),
  };
}

// EFFECTS QUALITY on an emitter: `intensity 20` over a 1 s life.
{
  const spec = { intensity: 20, timeToLive: 1, delay: 0, looping: false };
  const count = scale => {
    setEmitterIntensityScale(scale);
    const clock = new EmitterClock(spec, () => 0.5);
    let n = 0;
    for (let i = 0; i < 60; i++) n += clock.step(1 / 60);
    return n;
  };
  out.emitter = { high: count(1), medium: count(0.5), low: count(0.3) };
  setEmitterIntensityScale(1);
  out.emitter.restored = emitterIntensityScale();
}

out.textureState = [1, 2, 3, 4, 5].map(q => textureState(q, 16));
// DISPLAY MODE (VID-11): the list a screen gets, the pixel ratio a mode
// gives, and a stored RENDER SCALE percentage read as a mode.
{
  const screens = {
    hd: displayOf({ width: 1920, height: 1080 }, 1),
    zoomed: displayOf({ width: 1536, height: 864 }, 1.25),   // 1080p at 125 % browser zoom
    retina: displayOf({ width: 1512, height: 982 }, 2),
    phone: displayOf({ width: 390, height: 844 }, 3),
  };
  const labels = d => displayModes(d).map(m => m.label);
  out.display = {
    none: displayOf(undefined, 1),
    noModes: displayModes(null),
    hd: displayModes(screens.hd),
    retina: labels(screens.retina),
    phone: labels(screens.phone),
    ratio: {
      hdNative: displayPixelRatio(screens.hd, 1080),
      hd720: displayPixelRatio(screens.hd, 720),
      hdDefault: displayPixelRatio(screens.hd, null),
      zoomedNative: displayPixelRatio(screens.zoomed, 1080),
      retinaDefault: displayPixelRatio(screens.retina, null),
      retina1080: displayPixelRatio(screens.retina, 1080),
      phoneDefault: displayPixelRatio(screens.phone, null),
      // A mode kept on a bigger screen falls to this one's own size.
      hdFrom1440: displayPixelRatio(screens.hd, 1440),
      noScreen: displayPixelRatio(null, 1080),
    },
    chosen: { hd768: chosenDisplayMode(screens.hd, 768)?.label, hdNone: chosenDisplayMode(screens.hd, null)?.label },
    migrate: Object.fromEntries([50, 75, 100, 125, 150, 33].map(s => [s, migrateRenderScale(s, screens.hd)])),
    migrateNoScreen: migrateRenderScale(50, null),
    applied: {
      override: pixelRatioFor({ override: 1.5, displayHeight: 720, display: screens.hd }),
      mode: pixelRatioFor({ displayHeight: 720, display: screens.hd }),
      noScreen: pixelRatioFor({ displayHeight: 720, display: null, dpr: 3 }),
    },
  };
  // A window shorter than its screen shows the middle of the game's frame
  // (`screenFrame`), measured through three's own projection: the angles
  // across and up the stage, and what that projection does at its centre.
  const THREE = await import('three');
  const lens = (w, h, display) => {
    const frame = screenFrame(w, h, display);
    const cam = new THREE.PerspectiveCamera(57.3, w / h, 0.1, 1000);
    if (frame) {
      cam.aspect = frame.fullWidth / frame.fullHeight;
      cam.setViewOffset(frame.fullWidth, frame.fullHeight, 0, frame.offsetY, w, h);
    }
    cam.updateProjectionMatrix();
    const m = cam.projectionMatrix.elements;
    const deg = r => (r * 180) / Math.PI;
    return { frame, across: deg(2 * Math.atan(1 / m[0])), up: deg(2 * Math.atan(1 / m[5])),
             offCentre: [m[8], m[9]], fov: cam.fov, zoom: cam.zoom };
  };
  out.screenFrame = {
    maximised: lens(1920, 953, screens.hd),
    fullScreen: lens(1920, 1080, screens.hd),
    tallWindow: lens(1200, 1000, screens.hd),
    phone: lens(390, 700, screens.phone),
    zoomedWindow: lens(1536, 762, screens.zoomed),
    ultrawide: lens(2560, 953, displayOf({ width: 2560, height: 1080 }, 1)),
    noScreen: screenFrame(1920, 953, null),
    noStage: screenFrame(0, 0, screens.hd),
  };
  // A RENDER SCALE kept before the list read as a mode, kept as one by the
  // next change; a preset leaves it alone; DEFAULT forgets it.
  const s = memory();
  s.setItem(VIDEO_KEY, JSON.stringify({ graphicsQuality: 2, renderScale: 75 }));
  const read = storedVideo(s, screens.hd);
  changeVideo({ effectsQuality: 1 }, s, screens.hd);
  const kept = JSON.parse(s.getItem(VIDEO_KEY));
  const low = applyPreset({ ...kept, displayHeight: 720 }, 1);
  changeVideo({ displayHeight: 900 }, s, screens.hd);
  const custom = applyPreset({ ...storedVideo(s, screens.hd), custom: { ...kept, displayHeight: 600 } }, 0);
  out.displayStore = {
    migrated: read.displayHeight,
    kept: { displayHeight: kept.displayHeight, renderScale: kept.renderScale ?? null },
    presetKeeps: low.displayHeight,
    customKeeps: custom.displayHeight,
    reset: changeVideo(null, s, screens.hd).displayHeight,
  };
}

out.envmap = { switch: ENVMAP_SWITCH.value, gated: envmapFragmentPatch().includes('if ( bfEnvOn < 0.5 ) return base;') };

// The tree swap's distance (0x0064ddbd..0x0064ddfe): horizontal, times the
// view's FOV in radians, over the page's billboard scale.
out.treeDistance = {
  level: billboardJudgedDistance(30, 40, 1, 1),
  zoomed: billboardJudgedDistance(30, 40, 0.5, 1),
  medium: billboardJudgedDistance(30, 40, 1, 0.75),
  fovOneRad: viewFieldOfView(180 / Math.PI, 1),
  fovZoom2: viewFieldOfView(180 / Math.PI, 2),
};
process.stdout.write(JSON.stringify(out));
