// Drives `viewer/lens-flare.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_lens_flare.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { flareSprites, flareTextureFiles, hasDrawableFlare,
         isAdditive } from './lens-flare.js';

const results = {};

// Wake's own TSun, exactly as `extract_map.py` writes it -- five flares, two
// coronas, and every texture missing, which is the vanilla case.
const vanilla = {
  template: 'TSun', object: 'sun',
  flareCount: 5, backFlareCount: 0, coronaCount: 2,
  visibilityAngleDeg: 360, flareFadeAll: 0.1, coronaFadeAll: 0.3,
  flares: [
    { texture: 'ring5.tga', file: null, size: 3, scale: -1.5, rot: 0,
      distFadeScale: 1, color: [1, 1, 1, 50 / 255],
      srcBlend: 'BMSourceAlpha', destBlend: 'BMOne' },
    { texture: 'ring3.tga', file: null, size: 0.5, scale: 1, rot: 0,
      color: [1, 1, 1, 200 / 255], srcBlend: 'BMSourceAlpha', destBlend: 'BMOne' },
  ],
  coronas: [
    { texture: 'sunflare7.tga', file: null, size: 2, scale: 1, rot: 0,
      color: [1, 1, 200 / 255, 225 / 255],
      srcBlend: 'BMSourceAlpha', destBlend: 'BMOne' },
  ],
  missingTextures: ['ring5.tga', 'ring3.tga', 'sunflare7.tga'],
};

// The same declaration on a mod level that ships the art.
const withArt = JSON.parse(JSON.stringify(vanilla));
withArt.flares[0].file = 'flare/ring5.png';
withArt.flares[1].file = 'flare/ring3.png';
withArt.coronas[0].file = 'flare/sunflare7.png';
delete withArt.missingTextures;

// The natural sizes of the only copies of these files anywhere in the
// install (bfheroes' uncompressed TGAs): ring3 16x16, ring5 32x32,
// sunflare7 128x128.
const SIZES = {
  'flare/ring3.png': 16, 'flare/ring5.png': 32, 'flare/sunflare7.png': 128,
};
const textureSize = file => SIZES[file] || 0;
const view = { sunX: 900, sunY: 200, width: 1000, height: 600, visible: true,
               textureSize };

results.textures = {
  vanillaFiles: flareTextureFiles(vanilla),
  vanillaDrawable: hasDrawableFlare(vanilla),
  modFiles: flareTextureFiles(withArt),
  modDrawable: hasDrawableFlare(withArt),
  nullDrawable: hasDrawableFlare(null),
};

results.vanillaDraws = flareSprites(vanilla, view);
results.modDraws = flareSprites(withArt, view);

// The sun behind the camera, or off a zero-sized canvas, draws nothing.
results.hidden = flareSprites(withArt, { ...view, visible: false });
results.zeroCanvas = flareSprites(withArt, { ...view, width: 0 });
results.undecoded = flareSprites(withArt, { ...view, textureSize: () => 0 });
results.noData = flareSprites(null, view);
results.fullyOccluded = flareSprites(withArt, { ...view, occlusion: 0 });

// Half occluded halves every sprite's alpha.
results.halfOccluded = flareSprites(withArt, { ...view, occlusion: 0.5 })
  .map(s => Math.round(s.color[3] * 10000) / 10000);

// `distFadeScale` against the sun's own distance from the screen centre.
results.distFaded = flareSprites(withArt, { ...view, sunDistance: 0.5 })
  .map(s => Math.round(s.color[3] * 10000) / 10000);

results.additive = {
  bmone: isAdditive({ destBlend: 'BMOne' }),
  lowercase: isAdditive({ destBlend: 'bmone' }),
  other: isAdditive({ destBlend: 'BMInvSourceAlpha' }),
  missing: isAdditive({}),
};

// A sprite with size 0 -- vanilla's flare index 4 is exactly this -- draws
// nothing rather than a zero-pixel quad.
const zeroSize = JSON.parse(JSON.stringify(withArt));
zeroSize.flares[1].size = 0;
results.zeroSize = flareSprites(zeroSize, view).map(s => s.file);

console.log(JSON.stringify(results));
