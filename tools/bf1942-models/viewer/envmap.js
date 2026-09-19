/* `envmap true` — the engine's environment-reflection stage, reproduced.
 *
 * 435 vanilla materials declare `envmap true;` in their `.rs` (aircraft
 * painted metal first, canopy and window glass second — census in
 * features/bf1942-3d-models/envmap-materials.md). `bf42/rs.py` reads the flag,
 * `bf42/gltf.py` stamps it as `material.extras.envmap`, GLTFLoader lands that
 * in `material.userData.envmap`, and until this module nothing bound it.
 *
 * WHAT THE ENGINE DOES. Read out of the retail client, not guessed. The whole
 * stage lives in one branch of the StandardMesh sub-shader's `applyRenderState`
 * (vtable dice.ref2.rend.SubShaderBuilder.StandardMesh 0x009061a4 slot +0x10 =
 * 0x005bf690; the branch is 0x005bfa80-0x005bfdc4):
 *
 *   gate      0x005bfa80  envmap byte (+0x30) set
 *             0x005bfa8b  AND the draw context's +0x18 (the level cubemap) is
 *                         non-NULL
 *             0x005bfa99  AND neither global kill-switch 0x009abf79 /
 *             0x005bfaa6  0x009abf7a is set
 *   stage 1   0x005bfab3  bind ctx+0x18 to texture stage 1 (FUN_006039c0,
 *                         fastcall ecx = stage = 1, edx = texture)
 *             0x005bfad1  TEXTURETRANSFORMFLAGS = 3   (D3DTTFF_COUNT3)
 *             0x005bfaf7  TEXCOORDINDEX        = 0x30000
 *                                            (D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR)
 *             0x005bfc61  ALPHAOP   = 2 SELECTARG1, ARG1 = 1 CURRENT,
 *                                                   ARG2 = 0 DIFFUSE
 *             0x005bfcc6  COLOROP   = 0x10 D3DTOP_BLENDCURRENTALPHA
 *             0x005bfce1  COLORARG1 = 1 D3DTA_CURRENT
 *             0x005bfcf2  COLORARG2 = 2 D3DTA_TEXTURE
 *   stage 2   0x005bfd03  COLOROP / ALPHAOP = 1 D3DTOP_DISABLE
 *   undo      0x005beef3  the sibling vtable slot +0x14 (0x005bee20) puts
 *             0x005bef17  stage 1's TEXTURETRANSFORMFLAGS back to 0 and its
 *                         TEXCOORDINDEX back to 1, both gated on the same
 *                         +0x30 byte it reads at 0x005beed4. (The shadow
 *                         compares that guard those two writes are at
 *                         0x005beedb and 0x005bef06 — 0x005bef06 is the
 *                         TEXCOORDINDEX compare, not the transform-flags
 *                         write.)
 *
 * D3DTOP_BLENDCURRENTALPHA is `Arg1 * A + Arg2 * (1 - A)` with A the alpha of
 * CURRENT, i.e. the alpha coming out of stage 0 — the direction is not folk
 * memory, it is the enum's own documentation: `D3DTOP_BLENDCURRENTALPHA = 16`
 * sits under the comment "Linear alpha blend: Arg1*(Alpha) + Arg2*(1-Alpha)"
 * in Microsoft's `d3dtypes.h` (Windows Kit 10, um/d3dtypes.h:1676-1682), and
 * 0x10 counts to it from `D3DTOP_DISABLE = 1` in wine's `d3d8types.h:884-899`.
 * So ARG1 = CURRENT is the lit surface and an OPAQUE texel shows it; ARG2 =
 * TEXTURE is the cubemap and a TRANSPARENT texel shows that.
 *
 * Stage 0's alpha op is set at 0x005c0201:
 * `setAlphaOp(stage 0, D3DTOP_SELECTARG1, D3DTA_TEXTURE, D3DTA_DIFFUSE)` —
 * three instructions after the same function loads the level cubemap into
 * ctx+0x18 (0x005c01dd), by the name at 0x009061c0 — and the sibling reset
 * re-asserts exactly those three values at 0x005bee8e/0x005bee94/0x005bee9a
 * whenever the +0x31 byte is set. (It is not the only writer of the stage-0
 * alpha shadow 0x009c92fc in the image: 0x0062e370 sets D3DTOP_MODULATE and
 * 0x0064ce63 the same SELECTARG1. Both belong to other sub-shaders; every
 * writer on the StandardMesh path agrees on SELECTARG1(TEXTURE).) So:
 *
 *     A          = the material's own diffuse-texture ALPHA CHANNEL
 *     out.rgb    = lit.rgb * A + cube.rgb * (1 - A)
 *     out.a      = A
 *
 * There is no reflectivity constant anywhere in the stage. The strength is a
 * per-texel mask that already ships inside the art, and it is inverted: alpha
 * 255 is matte, alpha 0 is a mirror. Measured on the re-extracted glbs, the
 * masks are real and graded exactly the way you would hope —
 * `zero_fus_m1_Material0` (painted fuselage) alpha 242..255, so at most 5%
 * reflection; `zero_fus_m1_Material1` (canopy glass) 120..255, up to 53%;
 * `Corsair_hull_m1_Material0` 119..255. Paint stays paint and glass shines,
 * out of the same channel, with nothing chosen by eye.
 *
 * The texture coordinate is D3D's own CAMERASPACEREFLECTIONVECTOR with an
 * identity texture transform, so the cube is indexed by the reflection vector
 * in VIEW space, not world space. That is why BF1942's aircraft have that
 * camera-locked chrome sheen that swims as you orbit them rather than a
 * world-stable mirror. Reproduced as-is. (Unread: whether anything ever
 * installs a D3DTS_TEXTURE1 matrix. TEXTURETRANSFORMFLAGS is only ever toggled
 * between 3 and 0 by the two functions above and nothing in either touches a
 * matrix, so identity is an inference from the flags, not a read.)
 *
 * WHAT THE ENVMAP COSTS. The same stage 1 is the TFACTOR distance-fade in the
 * non-envmap path (0x005bfdcb onward: COLOROP = MODULATE(CURRENT, TFACTOR)).
 * A material with envmap set therefore gives up its texture-fade stage to the
 * reflection. We do not model the fade here either way, so nothing is lost,
 * but it is the reason the two branches are exclusive in the binary.
 *
 * This module holds no `three` import on purpose: it is pure GLSL text plus
 * two predicates, so `tests/envmap_harness.mjs` can run the real thing under
 * node with no WebGL and no assets.
 */

/** Does this glTF material ask for the environment stage?
 *  `extras.envmap` arrives as `userData.envmap` through GLTFLoader. */
export function wantsEnvmap(material) {
  return !!(material && material.userData && material.userData.envmap);
}

/** The six faces, in the order `THREE.CubeTextureLoader` wants them, as the
 *  extractor writes them into `scene.json.envmap`. Returns null unless all six
 *  are present — a partial cube is not a cube. */
export function cubeFaceUrls(extras, base) {
  const faces = extras && extras.envmap;
  if (!Array.isArray(faces) || faces.length !== 6) return null;
  if (!faces.every(f => typeof f === 'string' && f)) return null;
  const prefix = base ? `${base}/` : '';
  return faces.map(f => `${prefix}${f}`);
}

/* The vertex half: the engine's texcoord generator. D3D computes the
 * camera-space reflection vector per vertex from the camera-space position and
 * normal, so both are carried across in view space.
 *
 * `three`'s `<begin_vertex>` runs before `<project_vertex>` builds mvPosition,
 * so the view-space position is taken from the modelViewMatrix directly rather
 * than reusing a chunk variable that may not exist yet in every material's
 * shader. `normalMatrix` is three's own inverse-transpose of the model-view
 * upper 3x3, which is exactly the frame D3D's generator works in. */
export const ENVMAP_VARYINGS = 'varying vec3 vBfEnvN;\nvarying vec3 vBfEnvP;';

export function envmapVertexPatch() {
  return `${ENVMAP_VARYINGS}
`;
}

export function envmapVertexBody() {
  return `vBfEnvN = normalMatrix * normal;
             vBfEnvP = ( modelViewMatrix * vec4( position, 1.0 ) ).xyz;`;
}

/* The fragment half.
 *
 * `srgbFns` says whether the caller's shader already defines `bfToSrgb` /
 * `bfFromSrgb` (map.html's dynamic-shading pass does). The combine is a LERP,
 * not a product, so unlike the modulate-2x combines it is not sensitive to
 * which space it runs in the way a multiply is — but it is still a
 * fixed-function 8-bit blend, so it runs in display space like every other
 * engine combine this viewer reproduces (see rendering-technology.md), and the
 * cube sample is decoded from sRGB by the loader for the same reason.
 *
 * `alphaExpr` is the A of the formula. It defaults to `diffuseColor.a`, which
 * after `<map_fragment>` is `opacity * texel.a` — the material's own alpha
 * channel, which is what stage 0's SELECTARG1(TEXTURE) selects. */
export function envmapFragmentPatch({ srgbFns = false, alphaExpr = 'diffuseColor.a' } = {}) {
  const helpers = srgbFns ? '' : `
             vec3 bfToSrgb( vec3 c ) {
               return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
                   c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
             }
             vec3 bfFromSrgb( vec3 c ) {
               return mix( pow( c * ( 1.0 / 1.055 ) + vec3( 0.055 / 1.055 ),
                       vec3( 2.4 ) ),
                   c * ( 1.0 / 12.92 ),
                   vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
             }`;
  return `${ENVMAP_VARYINGS}
             uniform samplerCube tBfEnv;${helpers}
             vec3 bfEnvmapStage( vec3 base, float a ) {
               // D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR: reflect the eye
               // vector about the normal, both in camera space, identity
               // texture transform (0x005bfaf7 / 0x005bfad1).
               vec3 n = normalize( vBfEnvN );
               vec3 r = reflect( normalize( vBfEnvP ), n );
               vec3 cube = textureCube( tBfEnv, r ).rgb;
               // D3DTOP_BLENDCURRENTALPHA(CURRENT, TEXTURE) at 0x005bfcc6:
               // Arg1 * A + Arg2 * (1 - A). A is the diffuse texture's alpha
               // (stage 0 SELECTARG1(TEXTURE), 0x005c0201), so alpha 255 is
               // matte and alpha 0 is a mirror.
               vec3 mixed = mix( bfToSrgb( cube ), bfToSrgb( base ), clamp( a, 0.0, 1.0 ) );
               return bfFromSrgb( min( vec3( 1.0 ), mixed ) );
             }`;
}

export function envmapFragmentApply(target = 'diffuseColor.rgb', alphaExpr = 'diffuseColor.a') {
  return `${target} = bfEnvmapStage( ${target}, ${alphaExpr} );`;
}

/* A material whose alpha is flat 255 everywhere reflects nothing at all under
 * this rule, which is correct but worth being able to see: the browser's
 * readout uses this to say so rather than leave a viewer wondering whether the
 * binding failed. Returns null when the texture cannot be measured. */
export function reflectivityRange(histogram) {
  if (!histogram || histogram.length !== 256) return null;
  let total = 0, lo = -1, hi = -1;
  for (let i = 0; i < 256; i++) {
    const c = histogram[i];
    if (!c) continue;
    total += c;
    if (lo < 0) lo = i;
    hi = i;
  }
  if (!total) return null;
  // Reflectivity is 1 - alpha, so the darkest alpha is the strongest mirror.
  return { min: (255 - hi) / 255, max: (255 - lo) / 255 };
}
