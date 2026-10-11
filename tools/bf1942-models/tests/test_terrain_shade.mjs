/**
 * The terrain's shade on an object with no lightmap (`viewer/terrain-shade.js`;
 * ledger DL-10, DL-11, DL-12; features/level-lighting-laws).
 *
 * Owner's report: Forgotten Hope's grass on Road to Ramelle is far lighter
 * than retail. Its fields stand in the shadow they cast in the terrain's bake,
 * and the client darkens an object by the ground under it.
 *
 * Run by `test_terrain_shade.py` with a case it packed (`argv[2]`), so the
 * Python writer and this reader are held to one answer.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAN_DEGREES, LIT, SHADOW_BELOW, objectIntensity, samplesTerrain, shadeFactor,
  shadeField, shadowBits,
} from '../viewer/terrain-shade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.join(here, '..', 'viewer');

// 1. The packed bits answer a point as the Python reader does.
const casePath = process.argv[2];
if (casePath) {
  const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  const bit = shadowBits(Uint8Array.from(c.bits));
  assert.ok(bit, 'the packed bits are read');
  for (const [x, z, want] of c.points) assert.equal(bit(x, z), want, `bit at ${x}, ${z}`);
  const at = shadeField({ dim: c.dim, cell: c.cell }, Uint8Array.from(c.luma), bit);
  assert.equal(at(1, 1), 80, 'shadowed ground answers its luminance');
  assert.equal(at(33.5, 1), LIT, 'a lit point in a shadowed cell is lit: the bit decides');
  assert.equal(at(100, 1), LIT);
  assert.equal(at(-5, 1), LIT, 'off the terrain');
  assert.equal(at(1, 5000), LIT);
  // Without the bits the cell answers.
  const coarse = shadeField({ dim: c.dim, cell: c.cell }, Uint8Array.from(c.luma));
  assert.equal(coarse(1, 1), 80);
  assert.equal(coarse(41, 41), LIT);
}
assert.equal(shadowBits(new Uint8Array(40)), null, 'not the file');
assert.equal(shadeField({ dim: 4, cell: 2 }, new Uint8Array(3)), null, 'a short image');
assert.equal(shadeField(null, new Uint8Array(16)), null);

// 2. getObjectIntensity (client 0x005068c0).
assert.equal(SHADOW_BELOW, 100);
assert.deepEqual(FAN_DEGREES, [-22.5, -13.5, -4.5, 4.5, 13.5]);
const open = () => LIT;
assert.equal(objectIntensity(open, 10, 10, 3, [1, 0]), LIT);
// A bright shadow (100 or more) is the open: the origin decides alone.
assert.equal(objectIntensity(() => 100, 10, 10, 3, [1, 0]), LIT);
// Deep in shadow: every fan point is dark, the answer is their mean.
assert.equal(objectIntensity(() => 40, 10, 10, 3, [1, 0]), 40);
// The origin's own value is not in the mean.
const originOnly = (x, z) => (x === 10 && z === 10 ? 10 : 60);
assert.equal(objectIntensity(originOnly, 10, 10, 3, [1, 0]), 60);
// At a shadow's far edge: the fan reaches 1.1 radii along the light and
// finds the open, so the object is lit.
const edge = (x) => (x < 12 ? 30 : LIT);
assert.equal(objectIntensity(edge, 10, 10, 3, [1, 0]), LIT);
assert.equal(objectIntensity(edge, 10, 10, 3, [-1, 0]), 30, 'the other way is all shadow');
assert.equal(objectIntensity(edge, 10, 10, 1, [1, 0]), 30, 'a small object stays inside it');
// Three dark against two lit is dark (lit < dark), the mean of the dark three.
let n = 0;
const threeDark = (x, z) => (x === 0 && z === 0 ? 20 : [30, 40, 50, LIT, LIT][n++]);
assert.equal(objectIntensity(threeDark, 0, 0, 2, [0, 1]), 40);
n = 0;
const twoDark = (x, z) => (x === 0 && z === 0 ? 20 : [30, 40, LIT, LIT, LIT][n++]);
assert.equal(objectIntensity(twoDark, 0, 0, 2, [0, 1]), LIT);
// No light on the ground (a sun straight overhead): the fan is the origin.
assert.equal(objectIntensity(() => 55, 3, 3, 4, [0, 0]), 55);

// 3. Which meshes ask at all (0x00502f60, 0x00680e50).
assert.equal(samplesTerrain([3.04, 1.3, 3.15], [5, 5, 5], 0, 15), true, 'a grass field');
assert.equal(samplesTerrain([5, 5, 5], [5, 5, 5], 0, 15), true, 'the box itself fits');
assert.equal(samplesTerrain([12, 6, 9], [5, 5, 5], 0, 15), false, 'a house');
assert.equal(samplesTerrain([1, 6, 1], [5, 5, 5], 0, 15), false, 'a pole');
assert.equal(samplesTerrain([1, 1, 1], [5, 5, 5], 15.1, 15), false, 'on a roof');
assert.equal(samplesTerrain([1, 1, 1], [5, 5, 5], 15, 15), true);

// 4. The colour (StandardMesh_drawLod 0x005aeec0): the sum, clamped, a byte.
assert.deepEqual(shadeFactor(LIT, [80, 80, 90]), [1, 1, 1]);
assert.deepEqual(shadeFactor(33, [80, 80, 90]), [113 / 255, 113 / 255, 123 / 255]);
assert.deepEqual(shadeFactor(33.9, [80, 80, 90]), [113 / 255, 113 / 255, 123 / 255], 'truncated');
assert.deepEqual(shadeFactor(0, [0, 0, 0]), [0, 0, 0]);
assert.deepEqual(shadeFactor(40, [70, 70, 70], [10, -200, 0]), [120 / 255, 0, 110 / 255]);

// 5. The page: the shade is stage 1's TFACTOR, after stage 0 has saturated,
// and a shaded mesh draws no reflection; the alpha LOD has its two states.
const shading = fs.readFileSync(path.join(viewer, 'level-shading.js'), 'utf8');
assert.match(shading, /shader\.uniforms\.bfShade = mat\.bfShade;/);
assert.match(shading, /bfToSrgb\( diffuseColor\.rgb \) \* bfLit \) \* bfShade\.rgb \)/);
assert.match(shading, /if \( bfShade\.w < 0\.5 \) \{/);
assert.match(shading, /const ALPHA_LOD_DEFAULT = 100;/);
assert.match(shading, /m\.blending = near \? THREE\.NormalBlending : THREE\.NoBlending;/);
assert.match(shading, /m\.alphaTest = near \? ALPHA_PASS : m\.userData\.alphaTestRef;/);
const load = fs.readFileSync(path.join(viewer, 'level-load.js'), 'utf8');
assert.ok(load.indexOf('shading.bindAlphaLod(level.currentRoot)')
  > load.indexOf('shading.bindDynamicShading(level.currentRoot)'), 'after the materials are bound');
assert.ok(load.indexOf('shading.bindTerrainShade(') > load.indexOf('terrain.buildCollider('),
  'after the collider, whose height it asks');
const page = fs.readFileSync(path.join(viewer, 'map.html'), 'utf8');
assert.match(page, /level\.updateAlphaLod\(\);/);

console.log('terrain shade: ok');
