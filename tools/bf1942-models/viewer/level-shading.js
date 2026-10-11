// How the level's surfaces are shaded, the engine's way: the pre-lit
// terrain and its detail stage, the statics' lightmaps, the fixed-function
// combine for everything else, the grafted cockpit's calibrated one, and the
// doorway darkness planes' distance fade. Out of level-load.js; `show()` runs
// the binding passes once per level.

import * as THREE from 'three';
import { uvExtent, repeatsTexture, planTileWrap } from './terrain-tile-wrap.js';
import { wantsEnvmap, envmapVertexPatch, envmapVertexBody, envmapFragmentPatch, envmapFragmentApply } from './envmap.js';

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `bust`, `camera`, `extras`, `levelEnvCube`, `MAPS_BASE`, `renderer`,
 * `texLoader`.
 */
export function createLevelShading(page) {
  const shading = {};
  const lmCache = new Map();

  /** The lightmap atlases the level's statics were bound to, freed with the
   *  level (show()'s `dispose`). */
  function disposeLightmaps() {
    for (const tex of lmCache.values()) tex.dispose();
    lmCache.clear();
  }

  // The terrain colour tiles are PRE-LIT: Battlecraft bakes the level's sun,
  // ambient and cast shadows into the Tx tile art itself (open any tile - the
  // building, trench and treeline shadows are painted into the pixels, all
  // falling the same way as sunLightDirectionVec). The engine composes ground
  // as tile * detail * 2 plus fog and never relights it, so the viewer's
  // analytic hemisphere+sun must not multiply in a second time. On Tobruk that
  // double-lighting was a warm ~0.87 display-space factor that hid inside an
  // already-warm palette; on Wake the level's near-grey diffuseColor
  // (0.4/0.38/0.36) summed with a cool-blue fog hemisphere to a dead-grey 0.56
  // in linear - the island rendered visibly darker and desaturated against the
  // game's warm sandy tiles. Dark levels stay dark without analytic help
  // because the bake carries the level's light level into the tile art.
  function unlightTerrain(root) {
    // Pass 1: which texture each terrain mesh draws and whether it tiles it.
    const meshes = [];
    root.traverse(node => {
      if (node.userData?.kind !== 'terrain') return;
      node.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const repeats = repeatsTexture(uvExtent(obj.geometry));
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          meshes.push({ obj, m, texture: m.map || null, repeats });
        }
      });
    });
    // A tile's map covers one patch, UV 0..1: clamp it, or bilinear filtering
    // blends the edge texel with the opposite edge of the same tile (the line
    // along every patch border; terrain-tile-wrap.js). A texture a repeating
    // default patch shares is cloned first.
    const plan = planTileWrap(meshes);
    const clones = new Map();
    const wrapped = new Map();
    meshes.forEach((u, i) => {
      if (plan[i] === 'keep') return;
      let tex = u.texture;
      if (plan[i] === 'clone') {
        tex = clones.get(u.texture);
        if (!tex) {
          tex = u.texture.clone();
          clones.set(u.texture, tex);
        }
      }
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      wrapped.set(u.m, tex);
    });
    for (const { obj } of meshes) {
      if (obj.userData.unlitTerrain) continue;
      obj.userData.unlitTerrain = true;
      const source = Array.isArray(obj.material) ? obj.material : [obj.material];
      const flat = source.map(m => {
        const map = wrapped.get(m) || m.map || null;
        // Ground is viewed at grazing angles for most of a flythrough, and
        // three's default anisotropy of 1 mip-blurs the tile art into a smear
        // a few metres out - the "low-frequency ground" gap against the game.
        if (map) map.anisotropy = page.renderer.capabilities.getMaxAnisotropy();
        const mat = new THREE.MeshBasicMaterial({ map, side: m.side });
        mat.name = m.name;
        return mat;
      });
      obj.material = Array.isArray(obj.material) ? flat : flat[0];
    }
  }

  // The engine's second terrain stage, `base * detail * 2`.
  //
  // Baking it into the tile colour map at export caps the grain at that map's
  // resolution -- 4 texels/m for a 1024px tile over a 256 m patch, and 2 once
  // --max-texture 512 has run -- against the 32 texels/m the engine gets by
  // tiling a 512px detail map 16 times across the same patch. Sixteen times the
  // spatial frequency is the whole difference between crisp sand underfoot and a
  // smear, and it costs one extra texture read.
  function bindTerrainDetail(root, dir) {
    const info = page.extras.terrain || {};
    if (!info.detailTexture) return;
    const repeats = info.detailRepeats || 16;
    const tex = page.texLoader.load(`${page.MAPS_BASE}/${dir}/${info.detailTexture}${page.bust()}`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Same grazing-angle story as the tile art: without anisotropy the detail
    // grain vanishes into the first mip a few metres ahead of the camera.
    tex.anisotropy = page.renderer.capabilities.getMaxAnisotropy();
    // Raw texels, NOT sRGB-decoded: the engine's modulate-2x runs in 8-bit
    // display space, where the detail map's mid-grey 128 is the identity
    // (`apply_detail` in bf42/terrain.py is the same math at export). Decoding
    // the map to linear first turns that identity into 2*srgb2lin(0.5) = 0.43 -
    // terrain came out ~2.3x too dark with the hue baked toward mud. The
    // combine below round-trips the base tile through sRGB so the multiply
    // happens in the space the engine did it in.
    tex.colorSpace = THREE.NoColorSpace;
    root.traverse(node => {
      if (node.userData?.kind !== 'terrain') return;
      node.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const source = Array.isArray(obj.material) ? obj.material : [obj.material];
        const bound = source.map(m => {
          const mat = m.clone();
          mat.userData = { ...mat.userData };
          const prev = mat.onBeforeCompile;
          mat.onBeforeCompile = (shader, renderer) => {
            if (prev) prev(shader, renderer);
            shader.uniforms.tDetail = { value: tex };
            shader.uniforms.detailRepeats = { value: repeats };
            shader.fragmentShader = shader.fragmentShader
              .replace('void main() {',
                `uniform sampler2D tDetail;
               uniform float detailRepeats;
               vec3 bfToSrgb( vec3 c ) {
                 return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
                     c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
               }
               vec3 bfFromSrgb( vec3 c ) {
                 return mix( pow( c * ( 1.0 / 1.055 ) + vec3( 0.055 / 1.055 ),
                         vec3( 2.4 ) ),
                     c * ( 1.0 / 12.92 ),
                     vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
               }
               void main() {`)
              .replace('#include <map_fragment>',
                `#include <map_fragment>
               diffuseColor.rgb = bfFromSrgb( min( vec3( 1.0 ),
                   2.0 * bfToSrgb( diffuseColor.rgb ) *
                       texture2D( tDetail, vMapUv * detailRepeats ).rgb ) );`);
          };
          mat.needsUpdate = true;
          return mat;
        });
        obj.material = Array.isArray(obj.material) ? bound : bound[0];
      });
    });
  }

  function lightmapTargets(obj) {
    // A multi-material part arrives from GLTFLoader as a Group whose direct
    // Mesh children are its primitives — the same Group-vs-Mesh trap as
    // setAnimatedTextureSpeed. Child *part* nodes carry their own userData
    // (templateKind, lightmap, kind), synthesized primitive meshes carry none.
    if (obj.isMesh) return [obj];
    return obj.children.filter(
      c => c.isMesh && Object.keys(c.userData || {}).length === 0);
  }

  // The engine's baked lighting for statics, and the pass with the longest
  // string of masked bugs in this viewer. Each hid the next:
  //
  // 1. It never executed -- gated on `obj.isMesh` while every `userData.lightmap`
  //    extra lands on a Group (the multi-material-part trap the README documents
  //    for setAnimatedTextureSpeed).
  // 2. First execution rendered burnt black shells. Partly the texture tagged
  //    sRGB -- a lightmap is a multiplier, not a colour, and decoding it to
  //    linear squares the darkening -- but mostly:
  // 3. The atlas was sampled upside down. Everything inside the glb arrives via
  //    GLTFLoader with flipY=false, the glTF convention. These atlases load
  //    through THREE.TextureLoader, whose default is flipY=true, so UV1 indexed
  //    the atlas mirrored in V -- hard-edged rectangles across faces that should
  //    be uniformly lit, which read as "the UV1 export is wrong" and cost a trip
  //    through the stride-40 StandardMesh reader that was blameless all along.
  //    Same class of bug as the terrain tile V mirror, one loader further down.
  //
  // With the atlas the right way up, the bake is self-evidently modulate-2x
  // (mid-grey neutral, bright texels overbright sun-facing walls) and it
  // *replaces* analytic lighting on statics rather than adding to it -- keep the
  // hemisphere and sun on a lightmapped wall and every face is lit twice. So a
  // lightmapped mesh gets an unlit base material and the bake does the shading,
  // palm shadows on walls included.
  function bindLightmaps(root, dir) {
    // The bake is the sun term only. Its dark texels sit near zero, and the
    // engine adds the level's declared ambient on top - drop that term and
    // every shadow-side wall multiplies toward black, while sun-facing walls
    // (bright texels) look right, which is exactly how the omission presents.
    // Tobruk declares ambient 0.12/0.10/0.08 plus globalAmbient 0.2 and
    // shadowColor 0.55; the ambient pair is the floor, inlined per level.
    const lit = page.extras.lighting || {};
    const amb = lit.ambient || [0.2, 0.2, 0.2];
    const glob = lit.globalAmbient || [0.2, 0.2, 0.2];
    const floor = [0, 1, 2].map(i =>
      Math.min(1, (amb[i] || 0) + (glob[i] || 0)).toFixed(4));
    const floorGlsl = `vec3( ${floor[0]}, ${floor[1]}, ${floor[2]} )`;
    root.traverse(node => {
      const rel = node.userData?.lightmap;
      if (!rel) return;
      const url = `${page.MAPS_BASE}/${dir}/${rel}${page.bust()}`;
      let tex = lmCache.get(url);
      if (!tex) {
        tex = page.texLoader.load(url);
        tex.channel = 1;
        tex.flipY = false;
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        lmCache.set(url, tex);
      }
      for (const obj of lightmapTargets(node)) {
        const source = Array.isArray(obj.material) ? obj.material : [obj.material];
        const bound = source.map(m => {
          const mat = new THREE.MeshBasicMaterial({
            map: m.map || null,
            side: m.side,
            alphaTest: m.alphaTest || 0,
            transparent: m.transparent,
          });
          mat.name = m.name;
          // The exporter's extras marks ride in userData (additive,
          // textureFade); a rebuild that drops them silently un-marks the
          // material for every later pass.
          mat.userData = m.userData;
          mat.lightMap = tex;
          // MeshBasicMaterial's lightmap term is INLINE in its fragment shader
          // (r169 has no <lightmap_fragment> chunk anywhere), so the combine
          // must replace that exact line. The first version of this pass
          // injected its factor after <map_fragment> and "removed" a
          // #include <lightmap_fragment> that does not exist — a silent no-op
          // that left three's own `lm * 1/pi` accumulation in place, so the
          // bake multiplied in twice and shadow-side texels (near zero)
          // squared to black while sun-facing walls survived. Anchor on the
          // built-in line and rewrite it into the engine combine, applied once.
          mat.onBeforeCompile = (shader) => {
            const anchor = 'reflectedLight.indirectDiffuse += '
              + 'lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;';
            if (!shader.fragmentShader.includes(anchor)) {
              console.warn('lightmap combine anchor missing (three.js upgrade?); '
                + 'bake left on the stock path for', mat.name);
              return;
            }
            shader.fragmentShader = shader.fragmentShader.replace(anchor,
              `reflectedLight.indirectDiffuse += mix( vec3( 1.0 ),
                 min( vec3( 2.0 ), ${floorGlsl} + 2.0 * lightMapTexel.rgb ),
                 lightMapIntensity );`);
          };
          mat.needsUpdate = true;
          return mat;
        });
        obj.material = Array.isArray(obj.material) ? bound : bound[0];
      }
    });
  }

  // The engine's lighting for everything that is neither pre-lit terrain nor a
  // lightmapped static: vehicles and bare statics. Verified against the
  // decompiled renderer (features/bf1942-engine-reference/, symbols
  // StandardMeshSubShader_applyRenderState 0x005bf690 - the vtable slot of
  // dice.ref2.rend.SubShaderBuilder.StandardMesh, whose .rdata carries the .rs
  // attribute strings - plus RendPCDX8_flushDeferredState 0x00604750 and
  // LightDesc_toD3DLIGHT8 0x0045f210 for the light rig): a lit StandardMesh
  // draws with texture stage 0 = MODULATE2X(TEXTURE, DIFFUSE) - the same 2x
  // headroom as the terrain-detail and lightmap combines - where DIFFUSE is
  // D3D fixed-function vertex lighting,
  //
  //   clamp01( ambientColor + globalAmbientColor + diffuseColor * max(0, N.L) )
  //
  // with the material colour effectively white (materialDiffuse is `1 1 1` in
  // 3202 of 3523 vanilla .rs declarations; no materialAmbient attribute
  // exists). Beware FUN_00664560's MODULATE 1x: that is a different, simpler
  // renderer path, not the mesh one. Fixed-function lighting ran in 8-bit
  // DISPLAY space; the previous hemisphere+sun rig evaluated its combine in
  // linear, which reads far darker in the midtones (display 0.63 is linear
  // 0.36) and lost the 2x - vehicles sat visibly under-exposed on terrain
  // whose bake renders at full display brightness. Same class of fix as the
  // detail combine above: round-trip through sRGB and multiply in the space
  // the engine used. Not modelled: the optional specular term
  // (lightingSpecular, ~1/3 of materials) and the envmap reflection stage.
  // Per-placement `Object.geometry.color` lands on the instance root as
  // `extras.color` (GLTFLoader → userData.color). Walk ancestors so every
  // mesh under a tinted tree/bush multiplies its base colour once.
  function applyInstanceColors(root) {
    root.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      let tint = null;
      for (let n = obj; n; n = n.parent) {
        const c = n.userData?.color;
        if (Array.isArray(c) && c.length >= 3) { tint = c; break; }
      }
      if (!tint) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m?.color || m.userData?.instanceTinted) continue;
        m.color.r *= tint[0];
        m.color.g *= tint[1];
        m.color.b *= tint[2];
        m.userData = m.userData || {};
        m.userData.instanceTinted = true;
      }
    });
  }

  /**
   * `rule` (optional) replaces the two level terms of the combine for one
   * caller: `{ floor: [r, g, b], sun: [r, g, b] }`, the clamp01 arguments'
   * constant part and the sun's diffuse. Without it the engine's fixed-function
   * terms are used, `ambientColor + globalAmbientColor` and `diffuseColor`.
   * `shadeCockpit` is the one caller that passes one.
   */
  function bindDynamicShading(root, rule = null) {
    applyInstanceColors(root);
    const lit = page.extras.lighting || {};
    const amb = rule ? rule.floor : lit.ambient || [0.2, 0.2, 0.2];
    const glob = rule ? [0, 0, 0] : lit.globalAmbient || [0.2, 0.2, 0.2];
    const diff = rule ? rule.sun : lit.diffuse || [0.5, 0.5, 0.5];
    // show() aims the DirectionalLight along -sunDirection toward the origin;
    // the same convention makes L (surface toward sun) the negated X/Z.
    const sd = page.extras.sunDirection || [-0.35, 0.8, 0.45];
    const norm = Math.hypot(sd[0], sd[1], sd[2]) || 1;
    const L = [-sd[0] / norm, sd[1] / norm, -sd[2] / norm];
    const f = n => Number(n).toFixed(4);
    const floorGlsl = `vec3( ${[0, 1, 2].map(i =>
    f(Math.min(1, (amb[i] || 0) + (glob[i] || 0)))).join(', ')} )`;
    const sunGlsl = `vec3( ${diff.map(f).join(', ')} )`;
    const dirGlsl = `vec3( ${L.map(f).join(', ')} )`;
    // Injected constants are baked as literals, and three caches programs by
    // the onBeforeCompile SOURCE - identical closures with different level
    // values would collide across map switches without an explicit key.
    const cacheKey = `bf-dynamic-lit:${floorGlsl}|${sunGlsl}|${dirGlsl}`;
    // `envmap true` adds texture stage 1 on top of the same stage-0 combine, so
    // it is a second program, keyed apart from the plain one.
    const envCacheKey = `${cacheKey}|envmap`;
    root.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      // A muzzle flash is light, not a surface: the exporter bakes the sprite
      // payloads unlit for exactly that reason, and the mesh payloads carry
      // `extras.additive` instead. Both have to survive this pass — rebuilding
      // them as MeshBasicMaterial here drops the userData the additive mark
      // rides in, and `gunfire.js` would then blend the flash as ordinary alpha
      // over the cockpit rail. Shading them would dim the one thing the shot is
      // showing anyway.
      if (obj.userData?.effect) return;
      const source = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (!source.some(m => m.isMeshStandardMaterial)) return;
      const bound = source.map(m => {
        if (!m.isMeshStandardMaterial) return m;
        const mat = new THREE.MeshBasicMaterial({
          map: m.map || null,
          color: m.color ? m.color.clone() : 0xffffff,
          side: m.side,
          alphaTest: m.alphaTest || 0,
          transparent: m.transparent,
          opacity: m.opacity,
          depthWrite: m.depthWrite,
        });
        mat.name = m.name;
        // Keep the exporter's extras marks (additive, textureFade) — a rebuild
        // that drops userData un-marks the material for every later pass.
        mat.userData = m.userData;
        // The glb's emissive slot carries a 0.45 translucency floor on branch
        // cards (see assemble.py) - a crutch calibrated against the OLD
        // under-lit rig, where pure N.L blackened sun-away fronds. The
        // engine-true combine already floors every surface at
        // 2*(ambient+globalAmbient), and in-game palms keep genuinely dark
        // shadow sides, so the crutch is dropped here rather than folded in -
        // keeping it would pin fronds at >=1.5x their texel on Tobruk.
        // `envmap true` is texture stage 1 over the same stage-0 combine
        // (envmap.js carries the engine addresses). Only bound when the level
        // actually shipped six cube faces; without them the engine's own gate
        // (ctx+0x18 != NULL, 0x005bfa8b) fails too and the material draws plain.
        const env = wantsEnvmap(m) && page.levelEnvCube ? page.levelEnvCube : null;
        mat.customProgramCacheKey = () => (env ? envCacheKey : cacheKey);
        mat.onBeforeCompile = (shader) => {
          if (env) shader.uniforms.tBfEnv = { value: env };
          shader.vertexShader = shader.vertexShader
            .replace('void main() {',
              `varying vec3 vBfNormal;\n${env ? envmapVertexPatch() : ''}void main() {`)
            .replace('#include <begin_vertex>',
              `vBfNormal = mat3( modelMatrix ) * normal;
             ${env ? envmapVertexBody() : ''}
             #include <begin_vertex>`);
          shader.fragmentShader = shader.fragmentShader
            .replace('void main() {',
              `varying vec3 vBfNormal;
             vec3 bfToSrgb( vec3 c ) {
               return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
                   c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
             }
             vec3 bfFromSrgb( vec3 c ) {
               return mix( pow( c * ( 1.0 / 1.055 ) + vec3( 0.055 / 1.055 ),
                       vec3( 2.4 ) ),
                   c * ( 1.0 / 12.92 ),
                   vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
             }
             ${env ? envmapFragmentPatch({ srgbFns: true }) : ''}
             void main() {`)
            .replace('#include <map_fragment>',
              `#include <map_fragment>
             vec3 bfN = normalize( vBfNormal );
             if ( !gl_FrontFacing ) bfN = -bfN;
             float bfNdL = max( 0.0, dot( bfN, ${dirGlsl} ) );
             // D3D clamps the vertex diffuse to [0,1] BEFORE the stage's
             // modulate-2x, and saturates again after the multiply.
             vec3 bfLit = 2.0 * min( vec3( 1.0 ),
                 ${floorGlsl} + ${sunGlsl} * bfNdL );
             diffuseColor.rgb = bfFromSrgb( min( vec3( 1.0 ),
                 bfToSrgb( diffuseColor.rgb ) * bfLit ) );
             // Stage 1: the environment reflection, blended by the diffuse
             // texture's own alpha (0x005bfcc6 BLENDCURRENTALPHA). Runs after
             // stage 0 because CURRENT is stage 0's output.
             ${env ? envmapFragmentApply() : ''}`);
        };
        mat.needsUpdate = true;
        return mat;
      });
      obj.material = Array.isArray(obj.material) ? bound : bound[0];
    });
  }

  // `textureFade true` — the black_o darkness plane sealing every building
  // doorway and window. The engine fades it with camera distance: up close it
  // is gone and the room shows through the opening; at range it is solid and
  // the opening reads as dark. The exporter marks the material in extras and
  // this pass gives each flagged mesh its own clone so one building's doorway
  // can be open while a distant one's is sealed. The band is PROVISIONAL
  // [free]: fully open inside 20 m, fully sealed past 55 m, chosen to sit
  // inside the 70 m interior-LOD switch the engine used — measure against a
  // recording to pin it.
  const FADE_NEAR = 20;   // [free] m, alpha 0 at or below
  const FADE_FAR = 55;    // [free] m, alpha 1 at or beyond
  shading.fadeMeshes = [];
  // Every input to the ramp below is the camera's position against fixed points,
  // so a frame that did not move the camera cannot change a single opacity. The
  // gate is that position plus a generation `bindTextureFade` bumps, so the first
  // call after a level rebuilds `fadeMeshes` always runs (rule 7's shape, applied
  // to a list instead of a surface).
  shading.fadeGeneration = 0;
  shading.fadeCamGeneration = -1;
  shading.fadeCamX = NaN; shading.fadeCamY = NaN; shading.fadeCamZ = NaN;

  function bindTextureFade(root) {
    shading.fadeMeshes = [];
    shading.fadeGeneration++;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      const source = [obj.material].flat();
      if (!source.some(m => m?.userData?.textureFade)) return;
      const bound = source.map(m => {
        if (!m?.userData?.textureFade) return m;
        // clone() keeps map/lightMap but not onBeforeCompile — irrelevant
        // here, the texture is pure black and lighting black is black.
        const mat = m.clone();
        mat.userData = m.userData;
        mat.transparent = true;
        mat.depthWrite = false;
        return mat;
      });
      obj.material = Array.isArray(obj.material) ? bound : bound[0];
      // Statics never move; cache the world position once.
      const at = new THREE.Vector3();
      obj.getWorldPosition(at);
      // And which of this mesh's materials the ramp drives. A mesh can carry a
      // material ARRAY where only some entries are the darkness plane's, so the
      // fading ones are kept rather than the first (rule 5: `[obj.material].flat()`
      // per mesh per frame was two fresh arrays per mesh, 33 of them on Wake).
      shading.fadeMeshes.push({ obj, at, mats: bound.filter(m => m?.userData?.textureFade) });
    });
  }

  function updateTextureFade() {
    const cam = page.camera.position;
    if (shading.fadeCamGeneration === shading.fadeGeneration
        && cam.x === shading.fadeCamX && cam.y === shading.fadeCamY && cam.z === shading.fadeCamZ) return;
    shading.fadeCamGeneration = shading.fadeGeneration;
    shading.fadeCamX = cam.x; shading.fadeCamY = cam.y; shading.fadeCamZ = cam.z;
    for (const { obj, at, mats } of shading.fadeMeshes) {
      const dx = at.x - cam.x, dy = at.y - cam.y, dz = at.z - cam.z;
      // Kept as a real square root rather than compared against squared band
      // edges: `sqrt` is correctly rounded, so `sqrt(d2) <= 20` and `d2 <= 400`
      // disagree by one ULP just past the near edge (`sqrt(400 + 2^-44)` rounds
      // back to exactly 20), and this has to be a behavioural no-op. One sqrt
      // across 33 meshes is not what the profile was reading anyway — the
      // allocations and the unconditional writes below were.
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const a = Math.min(1, Math.max(0, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
      for (const m of mats) if (m.opacity !== a) m.opacity = a;
      // A fully-faded plane still costs a draw call; drop it. Compared against
      // the material's and the object's OWN current value rather than a
      // remembered one, so anything else that writes either is picked up on the
      // next frame the camera moves.
      const shown = a > 0;
      if (obj.visible !== shown) obj.visible = shown;
    }
  }

  /**
   * A grafted cockpit interior: the engine's lit-mesh combine
   * `MODULATE2X(TEXTURE, clamp01(ambient + diffuse * N.L))` with the level's
   * own colours, at the brightness two retail captures measure (ledger DL-5).
   *
   * The interior arrives from the MODEL BROWSER's export
   * (`extract_models.py --cockpit`) as `MeshStandardMaterial`, which nothing on
   * this page lights by itself: the level is drawn with `MeshBasicMaterial`
   * because BF1942 bakes its light into terrain tiles and lightmaps. The
   * interior was first left to three's own hemisphere and sun (olive on a haze
   * level, black inside a Sherman) and then forced fully unlit, the texture at
   * x1.0, 1.4 to 2.9 times what the game shows. A cockpit is a lit
   * StandardMesh (`lighting true`) drawn by the plain fixed-function path
   * (not the skinned one: DL-6), so it takes `bindDynamicShading`'s pass.
   *
   * What the pass is given. The COLOUR is the fixed-function ambient and sun:
   * both retail captures show the shaded floor with `ambientColor +
   * globalAmbientColor`'s tint (green over red 0.92 on Wake, 0.96 on Agheila,
   * as that sum predicts, where `animatedMeshAmbientColor`, a grey, predicts
   * 1.0). The MAGNITUDE is not that sum's. The Wake Corsair's dash reads 0.93
   * of it and the Agheila Flettner's interior 0.71 of it, floor and sun-lit
   * faces alike, no hue shift. That is 0.87 times the level's
   * `animatedMeshAmbientColor` over the mean of `ambientColor +
   * globalAmbientColor` (0.70 and 0.95), so the level's two terms are scaled
   * by `k = min(1, 0.87 * animatedMeshAmbient / mean(ambient + global))`.
   * The 0.87 and the form are a calibration to those two captures, not a read
   * of the binary: what scales a vehicle part's light by a level's animated
   * ambient is not found (ledger DL-5), so on a level with no capture this is
   * the extrapolation. A scene.json written before the animated term existed
   * has none, and k is 1: the plain fixed-function terms.
   *
   * `userData.additive` is a gunsight's own glow, light and not a surface:
   * carried across unlit and additive exactly as `loadHandWeapon` does, never
   * shaded. A material the exporter marked `lighting false` is
   * `KHR_materials_unlit`, a basic material, and `bindDynamicShading` leaves
   * it alone (DL-1). Evaluated against the WORLD normal (`modelMatrix`) per
   * fragment, so the detached glb the page prepares here and the grafted copy
   * the camera sits in both light correctly.
   */
  const COCKPIT_K = 0.87;

  function cockpitRule() {
    const lit = page.extras.lighting || {};
    const animated = lit.animatedMeshAmbient;
    const amb = lit.ambient || [0.2, 0.2, 0.2];
    const glob = lit.globalAmbient || [0.2, 0.2, 0.2];
    const diffuse = lit.diffuse || [0.5, 0.5, 0.5];
    const floor = [0, 1, 2].map(i => Math.min(1, (amb[i] || 0) + (glob[i] || 0)));
    const mean = (floor[0] + floor[1] + floor[2]) / 3;
    const animatedMean = Array.isArray(animated)
      ? (animated[0] + animated[1] + animated[2]) / 3 : NaN;
    const k = Number.isFinite(animatedMean) && mean > 0
      ? Math.min(1, Math.max(0, COCKPIT_K * animatedMean / mean)) : 1;
    if (k === 1) return null;
    return { floor: floor.map(v => v * k), sun: diffuse.map(c => c * k) };
  }

  function shadeCockpit(root) {
    const additive = new Map();
    const toAdditive = m => {
      if (!m || m.isMeshBasicMaterial || !m.userData?.additive) return m;
      let basic = additive.get(m);
      if (basic) return basic;
      basic = new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.color ? m.color.clone() : 0xffffff,
        transparent: true,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: m.side,
        depthWrite: false,
        toneMapped: m.toneMapped,
        blending: THREE.AdditiveBlending,
      });
      basic.name = m.name;
      basic.userData = m.userData;
      additive.set(m, basic);
      return basic;
    };
    // A blended material writes depth unless its `.rs` says `depthWrite false`
    // (ledger DL-8). glTF has no such bit and three's loader clears it for
    // every `alphaMode BLEND` material, so a whole interior authored
    // `transparent true` (the Ilyushin's) drew in index order with nothing to
    // occlude anything: the instrument panel was painted over by the cowl
    // behind it. The level lists the exceptions (`depthWriteOff`).
    const off = Array.isArray(page.extras.depthWriteOff)
      ? new Set(page.extras.depthWriteOff) : null;
    const lit = new Set();
    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = Array.isArray(obj.material)
        ? obj.material.map(toAdditive) : toAdditive(obj.material);
      for (const m of [obj.material].flat()) {
        if (!m) continue;
        if (m.isMeshStandardMaterial) lit.add(m);
        if (off && m.transparent && !m.userData?.additive && !m.userData?.textureFade
            && !off.has(String(m.name).toLowerCase())) {
          m.depthWrite = true;
        }
      }
    });
    bindDynamicShading(root, cockpitRule());
    // The shaded originals were never drawn; free them rather than leave a
    // standard-material program's worth of texture references alive.
    for (const original of [...lit, ...additive.keys()]) original.dispose();
  }

  Object.assign(shading, {
    bindDynamicShading,
    bindLightmaps,
    bindTerrainDetail,
    bindTextureFade,
    disposeLightmaps,
    unlightTerrain,
    cockpitRule,
    shadeCockpit,
    updateTextureFade,
  });
  return shading;
}
