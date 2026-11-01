// OPTIONS > VIDEO's settings under node (features/video-options): the stored
// choice, the presets, the numbers each row hands the engine, and the page
// systems that take them. `test_video_settings.py` reads what this prints.

import {
  applyPreset, changeVideo, DEFAULT_VIDEO, EFFECTS, GRAPHICS, normalizeVideo, onVideoChange, performanceOf,
  PRESETS, RENDER_SCALES, scaledViewDistance, storedVideo, storeVideo, TEXTURE, VIDEO_KEY, viewDistanceFog,
} from '../viewer/video-settings.js';
import { lodPercent, selectLod, setLodPercent } from '../viewer/mesh-cull.js';
import { EmitterClock, emitterIntensityScale, setEmitterIntensityScale } from '../viewer/effects-core.js';
import { textureState } from '../viewer/texture-quality.js';
import { scaledPixelRatio } from '../viewer/video-apply.js';
import { ENVMAP_SWITCH, envmapFragmentPatch } from '../viewer/envmap.js';

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
out.renderScales = RENDER_SCALES;
out.key = VIDEO_KEY;
out.defaultPerformance = performanceOf(storedVideo(memory()));

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
  out.clamped = normalizeVideo({ graphicsQuality: 9, viewDistance: 20, textureQuality: 0, renderScale: 33,
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
out.pixelRatio = { base1: scaledPixelRatio(1, 100), half: scaledPixelRatio(2, 50), big: scaledPixelRatio(2, 150), cap: scaledPixelRatio(4, 150) };
out.envmap = { switch: ENVMAP_SWITCH.value, gated: envmapFragmentPatch().includes('if ( bfEnvOn < 0.5 ) return base;') };

process.stdout.write(JSON.stringify(out));
