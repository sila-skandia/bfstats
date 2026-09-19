// Drives `viewer/envmap.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_envmap.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. `envmap.js` imports nothing -- it is GLSL text
// plus predicates -- so this needs no WebGL, no `three` and no assets.

import { wantsEnvmap, cubeFaceUrls, envmapVertexPatch, envmapVertexBody,
         envmapFragmentPatch, envmapFragmentApply,
         reflectivityRange, ENVMAP_VARYINGS } from './envmap.js';

const results = {};

// The flag arrives as `material.extras.envmap` in the glb and as
// `material.userData.envmap` after GLTFLoader.
results.wants = {
  flagged: wantsEnvmap({ userData: { envmap: true } }),
  unflagged: wantsEnvmap({ userData: {} }),
  noUserData: wantsEnvmap({}),
  nullMaterial: wantsEnvmap(null),
  // The exporter only ever writes `true`; anything falsy must not bind.
  explicitFalse: wantsEnvmap({ userData: { envmap: false } }),
};

// `scene.json.envmap` is the six faces in CubeTextureLoader order. A partial
// list is not a cube -- the engine's own gate is `ctx+0x18 != NULL`
// (0x005bfa8b), all or nothing.
const six = ['sky/px.png', 'sky/nx.png', 'sky/py.png',
             'sky/ny.png', 'sky/pz.png', 'sky/nz.png'];
results.faces = {
  six: cubeFaceUrls({ envmap: six }, 'maps/wake'),
  sixNoBase: cubeFaceUrls({ envmap: six }, ''),
  five: cubeFaceUrls({ envmap: six.slice(0, 5) }, 'maps/wake'),
  nullFaces: cubeFaceUrls({ envmap: null }, 'maps/wake'),
  missingKey: cubeFaceUrls({}, 'maps/wake'),
  blankEntry: cubeFaceUrls({ envmap: [...six.slice(0, 5), ''] }, 'maps/wake'),
  notAnArray: cubeFaceUrls({ envmap: 'sky/px.png' }, 'maps/wake'),
};

// The GLSL. The tests assert on the engine facts the text has to carry, not
// on formatting: a camera-space reflect(), a cube sample, and the
// BLENDCURRENTALPHA lerp with the diffuse alpha as its factor.
const frag = envmapFragmentPatch({ srgbFns: true });
const fragStandalone = envmapFragmentPatch();
results.glsl = {
  varyingsInVertex: envmapVertexPatch().includes(ENVMAP_VARYINGS),
  varyingsInFragment: frag.includes(ENVMAP_VARYINGS),
  // The generator D3D uses is CAMERASPACEREFLECTIONVECTOR, so the vertex half
  // must carry BOTH the view-space normal and the view-space position.
  vertexUsesNormalMatrix: envmapVertexBody().includes('normalMatrix * normal'),
  vertexUsesModelView: envmapVertexBody().includes('modelViewMatrix * vec4( position, 1.0 )'),
  vertexHasNoWorldMatrix: !envmapVertexBody().includes('modelMatrix *'),
  fragDeclaresSampler: frag.includes('uniform samplerCube tBfEnv;'),
  fragReflects: frag.includes('reflect( normalize( vBfEnvP ), n )'),
  fragSamplesCube: frag.includes('textureCube( tBfEnv, r )'),
  // Arg1 * A + Arg2 * (1 - A) with Arg1 = CURRENT (the lit base) and
  // Arg2 = TEXTURE (the cube). GLSL mix(x, y, a) is x*(1-a) + y*a, so the
  // cube is x and the base is y.
  fragMixesBaseOverCube: frag.includes('mix( bfToSrgb( cube ), bfToSrgb( base ), clamp( a, 0.0, 1.0 ) )'),
  // The helpers must appear exactly once: map.html already defines them, and
  // a second definition is a compile error.
  helpersOmittedWhenHost: (frag.match(/vec3 bfToSrgb/g) || []).length,
  helpersEmittedWhenAlone: (fragStandalone.match(/vec3 bfToSrgb/g) || []).length,
  // The call site takes the stage-0 result and the stage-0 alpha.
  apply: envmapFragmentApply(),
  applyCustom: envmapFragmentApply('outCol.rgb', 'texel.a'),
};

// A flat-255 alpha channel reflects nothing; a graded one grades.
const flat = new Array(256).fill(0); flat[255] = 4096;
const canopy = new Array(256).fill(0); canopy[120] = 10; canopy[200] = 50; canopy[255] = 100;
const mirror = new Array(256).fill(0); mirror[0] = 7;
results.reflectivity = {
  flat: reflectivityRange(flat),
  canopy: reflectivityRange(canopy),
  mirror: reflectivityRange(mirror),
  empty: reflectivityRange(new Array(256).fill(0)),
  wrongLength: reflectivityRange([1, 2, 3]),
  nullIn: reflectivityRange(null),
};

console.log(JSON.stringify(results));
