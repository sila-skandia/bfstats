// The level: its scene loaded and bound (terrain detail, lightmaps, the
// engine's own shading and texture fade, sky, clouds, water, fog and draw
// distance, lens flare), indexed and frozen for the matrix walk, its collider
// and material tables, its sounds and textures, the vehicles' bodies and
// damage sets, the world built on it, the bots spawned onto it -- `show()` --
// and the terrain queries every other part asks (`groundHeight`,
// `surfaceFriction`, `deckNormal`). Lifted out of map.html (features/
// vehicle-instance-refactor Part 2); the rest of the page takes `level`.

import * as THREE from 'three';
import { bareFireArmsName } from './vehicle-audio.js';
import { idleFirePose } from './idle-vehicle.js';
import { buildHeightfield, buildCollisionIndex, buildDrivableMask, WorldCollider } from './collision.js';
import { SupplyDepot } from './supply.js';
import { wantsEnvmap, cubeFaceUrls, envmapVertexPatch, envmapVertexBody, envmapFragmentPatch, envmapFragmentApply } from './envmap.js';
import { World } from './world.js';
import { flareSprites, flareTextureFiles, hasDrawableFlare } from './lens-flare.js';
import { modeNames, modeProblem, pruneToMode, selectGameMode } from './game-modes.js';
import { detachSpawnedCraft } from './seats.js';
import { bindTreeFoliage } from './tree-foliage.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeMod`, `botRoot`, `bust`, `camera`, `capture`,
 * `capturePresentationTick`, `combatArea`, `combatFrame`, `cubeLoader`,
 * `damageVisuals`, `DEFAULT_DRAW`, `disposeSounds`, `effects`,
 * `entryPoints`, `fireStates`, `floatPlacedVehicles`, `forgetSoldier`,
 * `fullmapMeta`, `fullmapName`, `guns`, `gunSubject`, `hemi`,
 * `loadCollisionMeshes`, `loadEffectLibrary`, `loader`, `loadMapArt`,
 * `logToConsole`, `MAPS_BASE`, `nearEntry`, `onCrashDamage`, `openDeploy`,
 * `optEntire`, `optGameFog`, `optOnFoot`, `optPilot`, `optVehicles`,
 * `optWire`, `overlay`, `params`, `placeCamera`, `rebaseDeckSpawns`,
 * `rebuildVehicleInterp`, `registerDamageables`, `renderer`, `scene`,
 * `seatWorldPos`, `setOnFoot`, `setPilot`, `settlePlacedVehicles`,
 * `setupSounds`, `setupVehicleBodies`, `spawnBotsForLevel`,
 * `spawnFlagSelect`, `sun`, `syncDeployReady`, `templateNameOf`,
 * `texLoader`, `texManager`, `toggleFullMap`, `unitRectOf`, `vehicleDamage`,
 * `vehicles`, `view`, `viewFor`, `vmScene`, `world`.
 */
export function createLevel(page) {
  const level = {};

  const lmCache = new Map();
  const cull = [];
  level.spawnersRoot = null;
  // The level's vehicles as `indexScene` found them under `spawners`. The live
  // group is not that list: `Vehicle`'s constructor reparents a hull onto the
  // level root the moment anyone drives it, and nothing puts it back, so a map
  // that walked `spawnersRoot.children` lost every jeep a bot had ever taken.
  // Respawn reuses the same node, so the list holds for the level's lifetime.
  level.mapVehicles = [];
  level.currentRoot = null;
  // The game never lets you deploy into a level that has not finished loading;
  // the browser must not either. False from the moment show() starts streaming
  // a scene until its collider and bindings are up — deploySpawn refuses while
  // it is false, or a fast SPAWN drops the soldier into an empty fog-coloured
  // void that reads as "the map is broken".
  level.worldReady = false;
  level.extras = {};
  level.skybox = null;
  level.skyRoot = null;       // the level's SkyBox mesh, reparented to the scene
  level.cloudMesh = null;
  level.cloudUniforms = null;
  level.waterUniforms = null;
  level.waterAssets = [];     // textures owned by the water/cloud shaders
  // The level's environment cubemap. The engine loads it once per level into the
  // StandardMesh draw context's +0x18 (0x005c01dd) and binds it to texture stage
  // 1 for every `envmap true` material (0x005bfab3) — it is not the water's, the
  // water shader just happens to want the same six faces. Owned here so a level
  // with no water still reflects, and disposed with `waterAssets`.
  level.levelEnvCube = null;
  level.simTime = 0;
  // Drives everything the level glb animates. One mixer over the level root
  // plays every clip it carries: `FlagBlow <name>` per control point, over that
  // flag's own joints, which is the animation state `AnimatedFlag` declares —
  // and `spin`/`spin.N`, the `setContinousRotationSpeed` parts grouped by period.
  // The clips the mixer plays are kept for `freezeStatics`, which must leave
  // every node they drive in three's matrix walk.
  level.levelClips = [];
  level.flagMixer = null;
  // What `?mode=` could not give this level, for the console band. Null
  // whenever the URL got exactly what it asked for, which is every load
  // with no `?mode=` at all.
  level.modeNote = null;

  /**
   * Ground height under a world (x, z).
   *
   * One answer for the camera clamp, the flown aircraft, the view rig and every
   * round in the air (gap C-5): `collision.js` rebuilds the level's own height
   * lattice from the terrain tiles at load, and a bilinear sample off that is
   * both exact — it is the grid the engine collides against — and some three
   * orders cheaper than the raycast this used to be, which mattered the moment
   * a burst of tracers started asking sixty times a second.
   *
   * The raycast stays as the fallback for a level whose lattice would not
   * rebuild (a mod with an irregular terrain export); `collider` is null then.
   *
   * `fromY` is the driven-vehicle opt-in and nothing else passes it: with a
   * reference height the answer also includes a drivable deck at or below it (a
   * bridge span, a repair bay's apron), so a tank's wheels ride the deck while a
   * soldier, a plane's ground check, a boat and the cameras keep seeing terrain
   * and sea alone. See `WorldCollider.surfaceHeight`.
   */
  const groundRay = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const rayOrigin = new THREE.Vector3();
  level.terrainMeshes = [];
  const terrainBBox = new THREE.Box3();
  level.collider = null;

  function groundHeight(x, z, fromY) {
    const sea = level.extras?.waterLevel ?? -Infinity;
    if (level.collider) {
      const h = level.collider.surfaceHeight(x, z, fromY);
      if (Number.isFinite(h)) return h;
    }
    if (!level.terrainMeshes.length) return sea;
    rayOrigin.set(x, 2000, z);
    groundRay.set(rayOrigin, DOWN);
    groundRay.far = 4000;
    const hit = groundRay.intersectObjects(level.terrainMeshes, false)[0];
    return hit ? Math.max(hit.point.y, sea) : sea;
  }

  /**
   * `MaterialManager.materialFriction` of the ground at a world (x, z) — what
   * `ground.js` spends its Coulomb budget out of (PHY-2).
   *
   * Both halves already existed and were never joined up: the heightfield
   * carries the level's own per-sample material id out of `terrain/materials.png`
   * (the projectile impact path has been reading it for a while), and
   * `damage.json`'s materials table now carries `materialFriction` beside
   * `materialDamage`. This is the whole of the join.
   *
   * Below the water line the answer is water's 0.1 regardless of what the
   * material map says the bed is made of, because that is the material the
   * engine's own terrain pass hands a submerged contact.
   *
   * Fallback is `DEFAULT_MATERIAL_FRICTION`: a level with no material map, a
   * mod with no `Game.rfa`, or an id the define file never mentions all resolve
   * to material 0, which vanilla authors at 1.0.
   */
  // `surfaceFriction` runs once per wheel per sub-step — up to sixteen times a
  // tick for a half-track — so it walks a flat numeric array rather than
  // re-deriving a string key and two property lookups each time. The array is
  // built once per level, when the tables land.
  level.materialFrictionById = null;

  function buildMaterialFrictionTable(tables) {
    const materials = tables?.materials;
    if (!materials) return null;
    let top = -1;
    for (const key of Object.keys(materials)) {
      const id = Number(key);
      if (Number.isInteger(id) && id >= 0 && id > top) top = id;
    }
    if (top < 0) return null;
    const out = new Float64Array(top + 1).fill(DEFAULT_SURFACE_FRICTION);
    for (const [key, entry] of Object.entries(materials)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0) continue;
      if (typeof entry?.friction === 'number') out[id] = entry.friction;
    }
    return out;
  }

  const DEFAULT_SURFACE_FRICTION = 1.0;

  function surfaceFriction(x, z, fromY) {
    const table = level.materialFrictionById;
    if (!table) return DEFAULT_SURFACE_FRICTION;
    const sea = level.extras?.waterLevel;
    // A wheel on a drivable deck spends the DECK's material, not the riverbed's
    // under it. `fromY` is the same vehicle opt-in `groundHeight` takes, so this
    // costs one extra deck ray per wheel and only while actually on a deck — and
    // without it a tank crossing a bridge over water was gripping at water's 0.1
    // because the surface it was standing on read as being at the sea line.
    const deck = fromY !== undefined ? level.collider?.deckSurface?.(x, z, fromY) : null;
    let id = deck ? deck.material : level.collider?.heightfield?.material(x, z);
    if (!deck && Number.isFinite(sea) && groundHeight(x, z, fromY) <= sea) id = 1;
    if (!Number.isInteger(id) || id < 0 || id >= table.length) {
      return DEFAULT_SURFACE_FRICTION;
    }
    return table[id];
  }

  /**
   * The contact normal of a drivable deck under (x, z), when a deck is what the
   * wheel there is standing on: `ground.js` takes the deck triangle's own normal
   * rather than a finite difference of the height, so a tank pitches up the repair
   * bay's incline and levels on its pad. False elsewhere, and the vehicle then
   * uses the heightfield gradient it has always used.
   */
  function deckNormal(x, z, fromY, out) {
    return level.collider?.deckNormal ? level.collider.deckNormal(x, z, fromY, out) : false;
  }

  function collectTerrain(root) {
    level.terrainMeshes = [];
    terrainBBox.makeEmpty();
    root.traverse(obj => {
      if (obj.isMesh && kindOf(obj) === 'terrain') {
        level.terrainMeshes.push(obj);
        if (obj.geometry) {
          if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
          terrainBBox.union(obj.geometry.boundingBox);
        }
      }
    });
  }

  function getFloorAltitude(x, z) {
    const gh = groundHeight(x, z);
    if (Number.isFinite(gh) && gh > -1000) return gh + 1.5;
    if (Number.isFinite(terrainBBox.min.y) && terrainBBox.min.y > -1000) {
      const base = Number.isFinite(level.extras?.waterLevel) ? Math.max(terrainBBox.min.y, level.extras.waterLevel) : terrainBBox.min.y;
      return base + 1.5;
    }
    if (Number.isFinite(level.extras?.waterLevel)) return level.extras.waterLevel + 1.5;
    return -50;
  }

  function dispose(root) {
    for (const tex of lmCache.values()) tex.dispose();
    lmCache.clear();
    if (!root) return;
    root.traverse(obj => {
      obj.geometry?.dispose();
      for (const m of [obj.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    page.scene.remove(root);
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
    root.traverse(node => {
      if (node.userData?.kind !== 'terrain') return;
      node.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const source = Array.isArray(obj.material) ? obj.material : [obj.material];
        const flat = source.map(m => {
          // Ground is viewed at grazing angles for most of a flythrough, and
          // three's default anisotropy of 1 mip-blurs the tile art into a smear
          // a few metres out - the "low-frequency ground" gap against the game.
          if (m.map) m.map.anisotropy = page.renderer.capabilities.getMaxAnisotropy();
          const mat = new THREE.MeshBasicMaterial({
            map: m.map || null,
            side: m.side,
          });
          mat.name = m.name;
          return mat;
        });
        obj.material = Array.isArray(obj.material) ? flat : flat[0];
      });
    });
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
    const info = level.extras.terrain || {};
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
    const lit = level.extras.lighting || {};
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

  function bindDynamicShading(root) {
    applyInstanceColors(root);
    const lit = level.extras.lighting || {};
    const amb = lit.ambient || [0.2, 0.2, 0.2];
    const glob = lit.globalAmbient || [0.2, 0.2, 0.2];
    const diff = lit.diffuse || [0.5, 0.5, 0.5];
    // show() aims the DirectionalLight along -sunDirection toward the origin;
    // the same convention makes L (surface toward sun) the negated X/Z.
    const sd = level.extras.sunDirection || [-0.35, 0.8, 0.45];
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
        const env = wantsEnvmap(m) && level.levelEnvCube ? level.levelEnvCube : null;
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
  level.fadeMeshes = [];
  // Every input to the ramp below is the camera's position against fixed points,
  // so a frame that did not move the camera cannot change a single opacity. The
  // gate is that position plus a generation `bindTextureFade` bumps, so the first
  // call after a level rebuilds `fadeMeshes` always runs (rule 7's shape, applied
  // to a list instead of a surface).
  level.fadeGeneration = 0;
  level.fadeCamGeneration = -1;
  level.fadeCamX = NaN; level.fadeCamY = NaN; level.fadeCamZ = NaN;

  function bindTextureFade(root) {
    level.fadeMeshes = [];
    level.fadeGeneration++;
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
      level.fadeMeshes.push({ obj, at, mats: bound.filter(m => m?.userData?.textureFade) });
    });
  }

  function updateTextureFade() {
    const cam = page.camera.position;
    if (level.fadeCamGeneration === level.fadeGeneration
        && cam.x === level.fadeCamX && cam.y === level.fadeCamY && cam.z === level.fadeCamZ) return;
    level.fadeCamGeneration = level.fadeGeneration;
    level.fadeCamX = cam.x; level.fadeCamY = cam.y; level.fadeCamZ = cam.z;
    for (const { obj, at, mats } of level.fadeMeshes) {
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

  function disposeSky() {
    if (level.skybox) {
      level.skybox.dispose();
      level.skybox = null;
    }
    if (level.skyRoot) {
      level.skyRoot.traverse(obj => {
        obj.geometry?.dispose();
        for (const m of [obj.material].flat().filter(Boolean)) {
          m.map?.dispose();
          m.dispose();
        }
      });
      page.scene.remove(level.skyRoot);
      level.skyRoot = null;
    }
    if (level.cloudMesh) {
      level.cloudMesh.geometry.dispose();
      level.cloudMesh.material.dispose();
      page.scene.remove(level.cloudMesh);
      level.cloudMesh = null;
      level.cloudUniforms = null;
    }
    for (const tex of level.waterAssets) tex.dispose();
    level.waterAssets = [];
    level.waterUniforms = null;
    level.levelEnvCube = null;
  }

  // The level cubemap, loaded once and shared by the envmap materials and the
  // water's fresnel term. Called before either wants it.
  function setupEnvCube(dir) {
    const urls = cubeFaceUrls(level.extras, `${page.MAPS_BASE}/${dir}`);
    if (!urls) { level.levelEnvCube = null; return null; }
    level.levelEnvCube = page.cubeLoader.load(urls.map(u => `${u}${page.bust()}`));
    level.levelEnvCube.colorSpace = THREE.SRGBColorSpace;
    level.waterAssets.push(level.levelEnvCube);
    return level.levelEnvCube;
  }

  function srgb(rgb, fallback) {
    const [r, g, b] = rgb || fallback;
    // Level .con colours are display values from a pre-colour-managed engine.
    return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  }

  // The engine draws the SkyBox mesh camera-centred with no fog and no lighting
  // (`lighting false` in every Sky_*.rs). Reparent it out of the level root so
  // distance culling never touches it, and swap its lit materials for unlit ones.
  /**
   * A grafted cockpit interior, in the same light the rest of the level is in:
   * none.
   *
   * This page draws the whole level with `MeshBasicMaterial`. BF1942 bakes its
   * light into the textures and the per-object lightmaps, so a shaded material
   * here would be a second opinion about a surface that already carries one.
   * The cockpit glb is the exception because it does not come from the level —
   * it is the MODEL BROWSER's export (`extract_models.py --cockpit`), and that
   * page lights what it shows, so the interior arrives as
   * `MeshStandardMaterial` and is the one surface in a level the level's own
   * hemisphere and sun actually touch.
   *
   * Inside a tank that is fatal. `1P_Sherman_Gunner_M1`'s camera-facing
   * vertices have a mean N.L of 0.01 against the sun and a mean N.y of -0.04,
   * so the sun gives them nothing and the hemisphere gives them its horizon: a
   * texture whose own mean is rgb(56,54,48) came out at **rgb(1,1,0)**. The
   * viewport frame the driver looks through was there all along and it was
   * black, which is why the report read "in ours it's just looking direct at
   * the world". Unlit, the same pixels measure rgb(21,22,16) to rgb(26,29,24)
   * and the frame, its bevels, its corner screws and its top latch all read
   * the way they do in a retail capture.
   *
   * `userData.additive` is carried across the same way `loadHandWeapon` does
   * it: a gunsight's own glow is an additive surface and has to stay one.
   * Materials are converted once each, not once per mesh, because a cockpit's
   * seven texture pages are shared between its parts.
   */
  function unlitCockpit(root) {
    const seen = new Map();
    const convert = m => {
      if (!m || m.isMeshBasicMaterial) return m;
      let basic = seen.get(m);
      if (basic) return basic;
      basic = new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.color ? m.color.clone() : 0xffffff,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: m.side,
        depthWrite: m.depthWrite,
        toneMapped: m.toneMapped,
      });
      basic.name = m.name;
      basic.userData = m.userData;
      if (m.userData?.additive) {
        basic.blending = THREE.AdditiveBlending;
        basic.transparent = true;
        basic.depthWrite = false;
      }
      seen.set(m, basic);
      return basic;
    };
    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = Array.isArray(obj.material)
        ? obj.material.map(convert) : convert(obj.material);
    });
    // The shaded originals were never drawn; free them rather than leave seven
    // standard-material programs' worth of texture references alive.
    for (const original of seen.keys()) original.dispose();
  }

  function setupSky(root, dir) {
    root.traverse(obj => {
      if (obj.userData?.kind === 'sky') level.skyRoot = obj;
    });
    if (!level.skyRoot) return;
    level.skyRoot.parent.remove(level.skyRoot);
    page.scene.add(level.skyRoot);
    level.skyRoot.traverse(obj => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.renderOrder = -100;
      const mats = [obj.material].flat().map(m => new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.map ? 0xffffff : 0x9db4c0,
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      obj.material = Array.isArray(obj.material) ? mats : mats[0];
    });
    setupClouds(dir);
  }

  // `Sky.addCloud`: one alpha-blended layer scrolling at Cloud.setSpeed,
  // repeated Cloud.setTexScale times across the sky span. Drawn camera-locked
  // like the sky box, with a radial fade standing in for the engine's
  // cloud-distance falloff.
  function setupClouds(dir) {
    const clouds = level.extras.sky?.clouds;
    if (!clouds?.texture) return;
    const tex = page.texLoader.load(`${page.MAPS_BASE}/${dir}/${clouds.texture}${page.bust()}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    level.waterAssets.push(tex);
    level.cloudUniforms = {
      map: { value: tex },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uSpan: { value: 500 },
      uCam: { value: new THREE.Vector2(0, 0) },
      uFadeStart: { value: 400 },
      uFadeEnd: { value: 900 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: level.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
      fragmentShader: `
      uniform sampler2D map;
      uniform vec2 uOffset, uCam;
      uniform float uSpan, uFadeStart, uFadeEnd;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vWorld.xz / uSpan + uOffset;
        vec4 c = texture2D(map, uv);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distance(vWorld.xz, uCam));
        gl_FragColor = vec4(c.rgb, c.a * fade);
        #include <colorspace_fragment>
      }`,
    });
    level.cloudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    level.cloudMesh.frustumCulled = false;
    level.cloudMesh.renderOrder = -99;
    page.scene.add(level.cloudMesh);
  }

  // Everything the engine's PatchTerrain/Water shader does with the level's
  // `water.*` block: two scrolling colour layers combined modulate-2x, a
  // scrolling normal map feeding a sun specular, and colour/alpha ramps driven
  // by real water depth sampled from the exported heightmap-derived depth map.
  function setupWater(root, dir) {
    const w = level.extras.water;
    if (!w) return;
    let waterObj = null;
    root.traverse(obj => {
      if (obj.userData?.kind === 'water' && obj.isMesh) waterObj = obj;
    });
    if (!waterObj) return;
    const load = rel => {
      const tex = page.texLoader.load(`${page.MAPS_BASE}/${dir}/${rel}${page.bust()}`);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      level.waterAssets.push(tex);
      return tex;
    };
    const texs = w.textures || {};
    const layer1 = texs.layer1 ? load(texs.layer1) : null;
    const layer2 = texs.layer2 ? load(texs.layer2) : null;
    const normal = texs.normal ? load(texs.normal) : null;
    const depth = texs.depth ? load(texs.depth) : null;
    if (layer1) layer1.colorSpace = THREE.SRGBColorSpace;
    if (layer2) layer2.colorSpace = THREE.SRGBColorSpace;
    if (depth) depth.wrapS = depth.wrapT = THREE.ClampToEdgeWrapping;
    // The engine reflects ENVMAP_G_.rcm off the water via the shader-manager
    // envmap parameter; the same six faces feed the fresnel term here. Shared
    // with the `envmap true` mesh materials (see setupEnvCube), one cube per
    // level rather than one per consumer.
    const env = level.levelEnvCube;
    const ld = w.lightDirection || [-0.3, 0.5, 0.65];
    level.waterUniforms = {
      tLayer1: { value: layer1 },
      tLayer2: { value: layer2 },
      tNormal: { value: normal },
      tDepth: { value: depth },
      tEnv: { value: env },
      uTime: { value: 0 },
      uWorldSize: { value: w.worldSize || level.extras.worldSize || 2048 },
      uMaxDepth: { value: w.maxDepth || 0 },
      uDir1: { value: new THREE.Vector2(...(w.scrollDir1 || [1, 0])) },
      uDir2: { value: new THREE.Vector2(...(w.scrollDir2 || [0, 1])) },
      uDirN: { value: new THREE.Vector2(...(w.scrollDirNormal || [1, 1])) },
      uScroll1: { value: w.scroll1 || 0 },
      uScroll2: { value: w.scroll2 || 0 },
      uScrollN: { value: w.scrollNormal || 0 },
      uTile1: { value: w.tile1 || 0.5 },
      uTile2: { value: w.tile2 || 0.5 },
      uTileN: { value: w.tileNormal || 1 },
      uShallow: { value: srgb(w.shallowColor, [0.4, 0.5, 0.55]) },
      uDeep: { value: srgb(w.deepColor, [0.3, 0.38, 0.42]) },
      uSpec: { value: srgb(w.specular ? w.specularColor : [0, 0, 0], [0, 0, 0]) },
      uLightDir: { value: new THREE.Vector3(ld[0], ld[1], ld[2]).normalize() },
      uShininess: { value: Math.min(120, Math.max(20, 0.06 / Math.max(w.streakFactor || 0.001, 1e-4))) },
      uShallowAlpha: { value: w.shallowAlpha ?? 0.5 },
      uAlphaDepth: { value: w.alphaDepth || 1.5 },
      uColorDepth: { value: w.colorDepth || 10 },
      fogColor: { value: new THREE.Color(0x808080) },
      fogNear: { value: 400 },
      fogFar: { value: 900 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: level.waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
      fragmentShader: `
      uniform sampler2D tLayer1, tLayer2, tNormal, tDepth;
      uniform samplerCube tEnv;
      uniform float uTime, uWorldSize, uMaxDepth;
      uniform vec2 uDir1, uDir2, uDirN;
      uniform float uScroll1, uScroll2, uScrollN, uTile1, uTile2, uTileN;
      uniform vec3 uShallow, uDeep, uSpec, uLightDir;
      uniform float uShininess, uShallowAlpha, uAlphaDepth, uColorDepth;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorld;
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
      void main() {
        vec2 wuv = vec2(vWorld.x, -vWorld.z);
        vec3 tex = vec3(1.0);
        #ifdef HAS_LAYERS
        // The engine's fixed-function MODULATE2X runs in 8-bit DISPLAY space,
        // like every other combine in this viewer (terrain detail, lightmaps,
        // dynamic shading). The old l1*l2*4.0 did it in linear, which squares
        // the layers' slight teal tint into the saturated turquoise the game
        // never shows - the water07/08 texels are a near-neutral grey
        // (mean 140/150/153).
        vec3 l1 = bfToSrgb(texture2D(tLayer1, wuv * uTile1 + uDir1 * uScroll1 * uTime).rgb);
        vec3 l2 = bfToSrgb(texture2D(tLayer2, wuv * uTile2 + uDir2 * uScroll2 * uTime).rgb);
        tex = min(vec3(1.0), l1 * l2 * 2.0);
        #endif
        float depth = uMaxDepth;
        #ifdef HAS_DEPTH
        depth = texture2D(tDepth, wuv / uWorldSize).r * uMaxDepth;
        #endif
        vec3 base = mix(uShallow, uDeep, clamp(depth / max(uColorDepth, 0.001), 0.0, 1.0));
        vec3 col = bfFromSrgb(min(vec3(1.0), bfToSrgb(base) * tex));
        vec3 N = vec3(0.0, 1.0, 0.0);
        #ifdef HAS_NORMAL
        // The DX8-era normal map is not 0.5-centred; two offset samples
        // subtracted give a zero-mean, still-animated perturbation.
        vec2 nuv = wuv * uTileN + uDirN * uScrollN * uTime;
        vec2 dn = texture2D(tNormal, nuv).rg
                - texture2D(tNormal, nuv * 1.31 + vec2(0.5)).rg;
        N = normalize(vec3(dn.x * 0.6, 1.0, dn.y * 0.6));
        #endif
        vec3 V = normalize(cameraPosition - vWorld);
        #ifdef HAS_ENV
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        // Deliberately blurred (fixed coarse mip): the ENVMAP_G_.rcm faces
        // bake the island and its clouds, and a sharp per-pixel lookup mirrors
        // them as structured smudges marching across the mid-distance - shapes
        // the in-game water never shows. What the reference shots do show is a
        // soft brightness wash toward the horizon, which is exactly what the
        // cubemap's low mip is. LOD 4 of a 128px face is 8px - directional
        // light distribution kept, all structure gone. (A texture bias can't
        // do this: MAX_TEXTURE_LOD_BIAS may clamp as low as 2.) Calibrated
        // against the Wake defgun reference, same spirit as the fresnel
        // shaping below - not a decompiled engine behaviour.
        vec3 sky = textureLod(tEnv, R, 4.0).rgb;
        // A plain Schlick fresnel (exponent 5, scaled to reach 1.0) turned the
        // lagoon into a near-perfect cloud mirror the moment the camera got low
        // and the view raked across open water -- exactly the case a flythrough
        // spends most of its time in, and not what the live-game reference
        // screenshots show even at the shoreline: the water keeps its own
        // shallow/deep tint and a soft sun-glint, not a crisp sky reflection.
        // Steepening the exponent and capping the peak keeps the mirror term a
        // rim highlight at true grazing incidence instead of the dominant term
        // from ten degrees off horizontal outward.
        float fresnel = 0.03 + 0.55 * pow(1.0 - max(dot(N, V), 0.0), 10.0);
        col = mix(col, sky, clamp(fresnel, 0.0, 1.0));
        #endif
        vec3 H = normalize(normalize(uLightDir) + V);
        col += uSpec * pow(max(dot(N, H), 0.0), uShininess);
        float alpha = mix(uShallowAlpha, 0.96, clamp(depth / max(uAlphaDepth, 0.001), 0.0, 1.0));
        #ifdef HAS_ENV
        alpha = max(alpha, clamp(fresnel, 0.0, 1.0));
        #endif
        // LINEAR, not smoothstep: THREE.Fog on the terrain and the engine's
        // DX8 vertex fog are both linear ramps. An S-curve here under-fogs
        // the sea ahead of the midpoint and over-fogs it past it (up to ~9%
        // of the ramp), so the waterline would read differently hazed than
        // the shore it touches at the same distance.
        float fogF = clamp((length(cameraPosition - vWorld) - fogNear)
            / max(fogFar - fogNear, 0.001), 0.0, 1.0);
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
      defines: {
        ...(layer1 && layer2 ? { HAS_LAYERS: '' } : {}),
        ...(normal ? { HAS_NORMAL: '' } : {}),
        ...(depth ? { HAS_DEPTH: '' } : {}),
        ...(env ? { HAS_ENV: '' } : {}),
      },
    });
    waterObj.material.dispose();
    waterObj.material = material;
  }

  function syncWaterFog() {
    if (!level.waterUniforms || !page.scene.fog) return;
    level.waterUniforms.fogColor.value.copy(page.scene.fog.color);
    level.waterUniforms.fogNear.value = page.scene.fog.near;
    level.waterUniforms.fogFar.value = page.scene.fog.far;
  }

  // The sky box is 4000 m across but our far plane is much closer, so it is
  // drawn scaled down around the camera — with depth writes off and everything
  // overdrawing it, only its angular content matters, and that is scale-free.
  function updateSky() {
    if (level.skyRoot) {
      const half = level.skyRoot.userData.halfExtent || 2000;
      const s = page.camera.far * 0.95 / (half * 1.7320508);
      level.skyRoot.scale.setScalar(s);
      // changeOfsSkyHeight lowers the box so the painted horizon sits below
      // eye level - Tobruk (150) shows sand-fade everywhere with the sign the
      // other way, and Wake (0) is indifferent.
      level.skyRoot.position.set(
        page.camera.position.x,
        page.camera.position.y - (level.extras.sky?.heightOffset || 0) * s,
        page.camera.position.z,
      );
      if (level.cloudMesh && level.cloudUniforms) {
        const clouds = level.extras.sky?.clouds || {};
        const rise = ((clouds.height ?? 3500) - (clouds.ofsHeight ?? 0)) * s;
        const span = 4 * half * s / (clouds.texScale || 8);
        level.cloudMesh.scale.set(page.camera.far * 4, 1, page.camera.far * 4);
        level.cloudMesh.position.set(
          page.camera.position.x, page.camera.position.y + rise, page.camera.position.z);
        level.cloudUniforms.uSpan.value = span;
        level.cloudUniforms.uCam.value.set(page.camera.position.x, page.camera.position.z);
        level.cloudUniforms.uFadeStart.value = page.camera.far * 1.2;
        level.cloudUniforms.uFadeEnd.value = page.camera.far * 2.4;
      }
    }
  }

  function advanceSim(dt) {
    level.simTime += dt;
    if (level.flagMixer) level.flagMixer.update(dt);
    if (level.waterUniforms) level.waterUniforms.uTime.value = level.simTime;
    if (level.cloudUniforms) {
      const speed = level.extras.sky?.clouds?.speed || [0, 0];
      level.cloudUniforms.uOffset.value.set(level.simTime * speed[0], level.simTime * speed[1]);
    }
  }

  // --- engine audio -----------------------------------------------------------
  //
  // Every occupied hull's own engine and guns, played from the `.ssc` the
  // extractor shipped in `scene.json`. `engine-audio.js` owns the graph and the
  // curve evaluation, `vehicle-audio.js` owns the rack — one entry per vehicle,
  // claimed by the seats occupied on it — and everything here is the seam:
  // which hull is claimed when someone boards, what the control channels are
  // worth this frame, and the lifecycle rules the ambient path already
  // established (nothing starts inside an async gap, nothing survives a map
  // change).
  //
  // The FPOV assumption is gone. A bot in the driver's seat of a Sherman is a
  // claimed hull like the player's own: its Engine `.ssc` runs off its own
  // `state.throttle`, its guns gate on the groups its crew fires, and the
  // listener is the camera wherever it is. Two Shermans are two notes; a
  // driver and a hull gunner in one Sherman are one.

  level.currentDir = '';

  function applyLighting() {
    const light = level.extras.lighting;
    if (!light) {
      page.hemi.color.set(0xe8dcc0);
      page.hemi.groundColor.set(0x5a4a32);
      page.hemi.intensity = 1.35;
      page.sun.color.set(0xfff1d0);
      page.sun.intensity = 2.4;
      return;
    }
    // renderer.diffuseColor is the sun's tint; keep overall exposure by
    // normalising it and carrying the magnitude into intensity.
    const diffuse = light.diffuse || [0.5, 0.5, 0.5];
    const peak = Math.max(...diffuse, 0.01);
    const tint = diffuse.map(c => c / peak);
    page.sun.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
    page.sun.intensity = 2.4 * Math.min(1.4, peak / 0.5);
    // The engine has no sky-dome light: its only ambient terms are
    // renderer.ambientColor / globalAmbientColor, and neither is ever blue.
    // Tinting the hemisphere with the raw fog colour injected atmosphere blue
    // into the shading on marine maps - on Wake (fog 0.71/0.74/0.79 against sun
    // 1/.95/.9) the two cancelled to a dead-grey total and every vehicle picked
    // up a cool cast the game never shows. Keep the fog's LUMINANCE as the size
    // of the ambient bounce, but give it the sun's hue so the hemisphere can
    // never fight the level's declared light colour.
    const fog = level.extras.fogColor || [0.7, 0.7, 0.7];
    const atmos = 0.2126 * fog[0] + 0.7152 * fog[1] + 0.0722 * fog[2];
    page.hemi.color.setRGB(atmos * tint[0], atmos * tint[1], atmos * tint[2],
                      THREE.SRGBColorSpace);
    const ground = light.ambient || [0.2, 0.2, 0.2];
    page.hemi.groundColor.setRGB(
      Math.min(1, ground[0] * 2.5), Math.min(1, ground[1] * 2.5),
      Math.min(1, ground[2] * 2.5), THREE.SRGBColorSpace);
    page.hemi.intensity = 1.15;
  }

  function drawDistance() {
    return level.extras.drawDistance || page.DEFAULT_DRAW;
  }

  function applyFar() {
    const world = level.extras.worldSize || 2048;
    const draw = drawDistance();
    // The engine's far plane IS the view distance: with fog saturating there,
    // the world ends in a completed haze wall that meets the sky painting.
    // Drawing past it (the old draw*1.6 with a 900 m floor) rasterised
    // fog-saturated terrain as crisp silhouettes against the paler sky band —
    // the "distant mountain ridge" the game never shows. Extend only to a
    // declared fogEnd beyond the view distance (Gazala: fog 500-850 vs VD 500)
    // so the wall always completes before the clip; 1.05 keeps the last
    // fog-saturated metres from z-fighting the plane.
    page.camera.far = page.optEntire.checked
      ? Math.max(4000, world * 1.5)
      : Math.max(draw, level.extras.fogEnd || 0) * 1.05;
    page.camera.updateProjectionMatrix();
  }

  function applyFog() {
    const color = level.extras.fogColor || [0.8, 0.72, 0.53];
    const draw = drawDistance();
    let start, end;
    if (page.optGameFog.checked) {
      // Nullish, not falsy: Berlin authors `fogstart 0` — fog from the eye
      // out — and a || default replaced that 0 with 150 against its declared
      // end of 100, which inverts the ramp and paints the whole world as one
      // fog wall.
      start = level.extras.fogStart ?? 150;
      end = level.extras.fogEnd ?? 300;
    } else if (!page.optEntire.checked) {
      start = draw * 0.55;
      end = draw;
    } else {
      start = 250;
      end = Math.max(1400, level.extras.worldSize || 2000);
    }
    // Declared fog colours are display values from a pre-colour-managed engine.
    const fogColor = new THREE.Color().setRGB(
      color[0], color[1], color[2], THREE.SRGBColorSpace);
    page.scene.fog = new THREE.Fog(fogColor, start, end);
    // The near pass's scene shares the object, so the arms' materials compile
    // against the same fog the world does — here, before the rig's warm-up
    // compile, and not per frame, or that compile would be for a fogless
    // program the first drawn frame then replaces.
    page.vmScene.fog = page.scene.fog;
    page.scene.background = level.skybox || fogColor;
    syncWaterFog();
  }

  function isCollision(obj) {
    return Boolean(obj.userData?.collision) || /collision/i.test(obj.name || '');
  }

  function kindOf(obj) {
    return obj.userData?.kind || '';
  }

  const cullBonePos = new THREE.Vector3();
  function tagCull(obj) {
    // A skinned flag cloth sits at the scene root carrying no transform of its
    // own — glTF requires that of any skinned mesh — so its bind-pose geometry
    // boxes around the world origin and a distance test would hide it
    // everywhere except there. Its real position is wherever its joints are.
    if (obj.isSkinnedMesh && obj.skeleton && obj.skeleton.bones.length) {
      const box = new THREE.Box3();
      for (const bone of obj.skeleton.bones) {
        box.expandByPoint(bone.getWorldPosition(cullBonePos));
      }
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      obj.userData.cullCenter = sphere.center.clone();
      // The joints are a lattice inside the cloth, not its extent; pad for it.
      obj.userData.cullRadius = sphere.radius + 2;
      return;
    }
    const box = new THREE.Box3().setFromObject(obj);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    obj.userData.cullCenter = sphere.center.clone();
    obj.userData.cullRadius = sphere.radius;
  }

  function indexScene(root) {
    cull.length = 0;
    level.spawnersRoot = null;
    level.mapVehicles = [];
    root.traverse(obj => {
      if (isCollision(obj)) obj.visible = false;
    });
    root.updateMatrixWorld(true);
    root.traverse(obj => {
      if (obj === root) return;
      if (kindOf(obj) === 'spawners' || obj.name === 'spawners') {
        level.spawnersRoot = obj;
      }
    });
    if (level.spawnersRoot) level.mapVehicles = [...level.spawnersRoot.children];
    for (const child of root.children) {
      if (child === level.spawnersRoot) {
        for (const vehicle of child.children) tagCull(vehicle);
        continue;
      }
      if (kindOf(child) === 'water') continue;
      tagCull(child);
      cull.push(child);
    }
    tagVehicleControlPoints();
    flattenCull();
    freezeStatics(root);
  }

  /** Associate parked hulls with the authored capture zone nearest their pad. */
  function tagVehicleControlPoints() {
    if (!level.spawnersRoot || !Array.isArray(level.extras?.controlPoints)) return;
    const points = level.extras.controlPoints;
    const spawns = Array.isArray(level.extras.objectSpawns) ? level.extras.objectSpawns : [];
    const scratch = new THREE.Vector3();
    for (const vehicle of level.spawnersRoot.children) {
      vehicle.getWorldPosition(scratch);
      const want = page.templateNameOf(vehicle).toLowerCase();
      let best = null;
      let bestDistance = Infinity;
      for (const spawn of spawns) {
        const name = String(spawn.vehicle || '').toLowerCase();
        if (name !== want && !want.startsWith(name + '_')) continue;
        const p = spawn.position || [];
        if (p.length !== 3) continue;
        const distance = Math.hypot(scratch.x - p[0], scratch.y - p[1], scratch.z - p[2]);
        if (distance < bestDistance) { best = spawn; bestDistance = distance; }
      }
      if (best?.controlPointName) {
        vehicle.userData.controlPointName = best.controlPointName;
        continue;
      }
      // Older scene.json files predate the association fields. Reconstruct the
      // same nearest-pad relationship so old extracts gain the gate too.
      let point = null;
      let pointDistance = Infinity;
      for (const candidate of points) {
        const p = candidate.position || [];
        if (p.length !== 3) continue;
        const distance = Math.hypot(scratch.x - p[0], scratch.z - p[2]);
        const radius = Number(candidate.radius) || 0;
        if (distance <= Math.max(60, radius * 4) && distance < pointDistance) {
          point = candidate;
          pointDistance = distance;
        }
      }
      if (point) vehicle.userData.controlPointName = point.name || null;
    }
  }

  function vehicleSpawnActive(vehicle) {
    const name = vehicle?.userData?.controlPointName;
    if (!name || !page.world?.flags) return true;
    const flag = page.world.flags.find(item => item.controlPointName === name);
    return !flag || flag.team !== 0;
  }

  /* `cull`'s bounding spheres, as four flat arrays.
   *
   * `applyVisibility` runs a distance test per entry per frame — 814 of them on
   * Wake, before the 32 spawner children — and each one used to chase
   * `obj.userData.cullCenter` (a `Vector3` behind two property loads and a
   * dictionary lookup) plus `obj.userData.cullRadius`. The centres and radii are
   * fixed at `indexScene` time by `tagCull`, so they are hoisted out of the scene
   * graph once and the per-frame test becomes typed-array arithmetic
   * (features/mesh-viewer-performance, rule 5's sibling: no per-frame pointer
   * chase either).
   *
   * `Float64Array`, not `Float32Array`: the old test ran in doubles, and this has
   * to be a behavioural no-op. Rounding a centre to Float32 moves it by up to
   * ~4e-5 m at Wake's coordinates, which is enough to flip one object at exactly
   * the range boundary. 26 KB of doubles is not the cost being addressed.
   *
   * `userData.cullCenter`/`cullRadius` stay on the objects — `tagCull` is still
   * their only writer — so any future reader of them is unaffected.
   *
   * The SPAWNER children are deliberately NOT flattened. `Vehicle`'s constructor
   * reparents the driven vehicle out of `spawnersRoot` and its last occupant's exit puts it
   * back, so that list's membership changes during play; 32 object-based tests a
   * frame are not worth the invalidation. `cull` itself is written only here.
   */
  level.cullFlat = {
    x: new Float64Array(0), y: new Float64Array(0),
    z: new Float64Array(0), r: new Float64Array(0),
  };
  function flattenCull() {
    const n = cull.length;
    const x = new Float64Array(n), y = new Float64Array(n);
    const z = new Float64Array(n), r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = cull[i].userData.cullCenter;
      // `tagCull` gives every entry a centre; a `null` here would have meant
      // "always visible" to the old predicate, so keep that reading exactly.
      if (!c) { r[i] = Infinity; continue; }
      x[i] = c.x; y[i] = c.y; z[i] = c.z;
      r[i] = cull[i].userData.cullRadius || 0;
    }
    level.cullFlat = { x, y, z, r };
  }

  // --- static matrices --------------------------------------------------------
  //
  // `WebGLRenderer.render` opens with `scene.updateMatrixWorld()`, and in three
  // r169 that walk recomposes and multiplies EVERY object's world matrix every
  // frame: `updateMatrix()` on an auto-updating node flags it changed, and the
  // `force` that sets cascades down the whole subtree whether or not anything
  // under it moved. Over ~5,100 nodes, twice a frame, it was 18-21% of the
  // frame's JS time (features/mesh-viewer-performance, rule 2). The level is
  // mostly furniture — terrain tiles, buildings, palms, parked vehicles — that
  // never moves once show() has placed it, so those subtrees leave the walk:
  // their `updateMatrixWorld` is a no-op unless an ancestor genuinely forces
  // it, and the nodes above them (`scene`, the level root, the spawners group)
  // stop re-composing matrices they never change, so no force ever arrives.
  //
  // The contract: anything that moves a frozen node calls
  // `updateMatrixWorld(true)` on it, or thaws it. A driven vehicle is thawed
  // for the ride (`vehicles.enter`) and frozen again where it is parked (the
  // last occupant's `vehicles.leave`). `__matrixDrift()` under ?shots checks every world matrix
  // against a fresh recompute, and the perf harness runs it after a minute of
  // walking, firing and turning.
  level.frozenCount = 0;
  // Vehicles a level clip animates while they are parked — the Hatsuzuki's
  // radar dish turns under an `ambient` clip — never leave the walk, ride or
  // no ride. Found by freezeStatics; `__matrixDrift` is what caught the dish
  // standing still.
  const neverFrozen = new WeakSet();
  const staticUpdateMatrixWorld = function (force) {
    if (force === true) THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
  };
  function freeze(obj) {
    obj.updateMatrixWorld(true);   // commit wherever it was last posed
    obj.updateMatrixWorld = staticUpdateMatrixWorld;
  }
  function thaw(obj) {
    if (Object.hasOwn(obj, 'updateMatrixWorld')) delete obj.updateMatrixWorld;
  }
  /** The spawner child that owns `node`: the vehicle itself, or the one a
   *  nested seat sits in. Null for a node outside the spawners group. */
  function spawnerVehicleOf(node) {
    for (let n = node; n; n = n.parent) if (n.parent === level.spawnersRoot) return n;
    return null;
  }
  // The subtree a ride thaws and a parking freezes. A seat being driven is not
  // under `spawners` any more: `Vehicle`'s constructor (flight.js; ground.js
  // extends it) reparents the node onto the level root before setPilot gets to
  // thaw it. Looked up through `spawners` alone, the driven vehicle was never
  // thawed and never re-frozen: it kept the frozen `updateMatrixWorld` from
  // freezeStatics, so everything `applyRig` poses after `applyTransform`'s
  // forced update (propeller spin, control surfaces) was drawn a frame late,
  // and the pose `reset()` + `applyRig()` leave on a vehicle setPilot(false)
  // parks was never committed at all -- `__matrixDrift` read 1.43 on the parked
  // Corsair's drawn propeller after one such exit (features/mesh-viewer-performance,
  // rule 2). Once reparented, the node is its own vehicle root.
  function vehicleRootOf(node) {
    return spawnerVehicleOf(node) ?? node;
  }
  function thawVehicle(node) {
    const vehicle = vehicleRootOf(node);
    if (vehicle) thaw(vehicle);
  }
  function freezeVehicle(node) {
    const vehicle = vehicleRootOf(node);
    if (vehicle && !neverFrozen.has(vehicle)) freeze(vehicle);
  }
  /** Take every level subtree that nothing animates out of the per-frame
   *  matrix walk. Runs once per level, after `root.updateMatrixWorld(true)`
   *  has composed everything where the extract put it. */
  function freezeStatics(root) {
    // What moves: bones and skinned cloth (the flags), input-driven `rig`
    // parts, and any node an ambient clip targets, with its ancestors.
    const animated = new Set();
    for (const clip of level.levelClips) {
      for (const track of clip.tracks) {
        const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
        const node = THREE.PropertyBinding.findNode(root, nodeName);
        for (let n = node; n && n !== root; n = n.parent) animated.add(n);
      }
    }
    const moves = obj => obj.isBone || obj.isSkinnedMesh
      || !!obj.userData?.rig || animated.has(obj);
    level.frozenCount = 0;
    root.matrixAutoUpdate = false;
    for (const child of root.children) {
      if (child === level.spawnersRoot) {
        child.matrixAutoUpdate = false;
        // Every parked vehicle, rigs and all: none of it moves until someone
        // climbs in, and setPilot thaws the one they climb into. Except the
        // ones a clip keeps moving while parked.
        for (const vehicle of child.children) {
          if (animated.has(vehicle)) { neverFrozen.add(vehicle); continue; }
          freeze(vehicle);
          level.frozenCount++;
        }
        continue;
      }
      let dynamic = false;
      child.traverse(obj => { if (moves(obj)) dynamic = true; });
      if (dynamic) continue;
      freeze(child);
      level.frozenCount++;
    }
  }

  /** The spawner children's distance test, and theirs alone since `applyVisibility`
   *  took the static list onto `cullFlat`: that list's membership moves during
   *  play (a driven vehicle leaves `spawnersRoot` and comes back), and 32 tests a
   *  frame do not pay for keeping a parallel array in step with it. */
  function inRange(obj, cam, limit) {
    const c = obj.userData.cullCenter;
    const r = obj.userData.cullRadius || 0;
    if (!c) return true;
    const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
    const reach = limit + r;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  }

  function applyVisibility() {
    const entire = page.optEntire.checked;
    const cam = page.camera.position;
    const limit = drawDistance();
    // The static half runs off `cullFlat` (see `flattenCull`): no `userData`
    // lookup, no `Vector3`, and `.visible` written only when it flips, which on
    // a walking frame is a handful of the 814 rather than all of them. The test
    // itself is the old `inRange` arithmetic unchanged, in doubles.
    // `indexScene` is the only writer of either, and it rebuilds both together;
    // this is the assertion that says so out loud rather than reading `undefined`
    // out of a short array and hiding half a level.
    if (level.cullFlat.x.length !== cull.length) flattenCull();
    const { x, y, z, r } = level.cullFlat;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let i = 0; i < cull.length; i++) {
      let shown = entire;
      if (!shown) {
        const dx = x[i] - cx, dy = y[i] - cy, dz = z[i] - cz;
        const reach = limit + r[i];
        shown = dx * dx + dy * dy + dz * dz <= reach * reach;
      }
      const obj = cull[i];
      if (obj.visible !== shown) obj.visible = shown;
    }
    if (!level.spawnersRoot) return;
    level.spawnersRoot.visible = page.optVehicles.checked;
    if (!page.optVehicles.checked) return;
    for (const vehicle of level.spawnersRoot.children) {
      vehicle.visible = vehicleSpawnActive(vehicle)
        && (entire || inRange(vehicle, cam, limit));
    }
  }
  // The ammo/heat bookkeeping this track's `FireState` needs is spliced onto
  // `guns.onShot` in hand-weapon.js (search `chainOnShot(page.guns,` — right
  // after the hand weapon's own `guns.onShot = ...` assignment), not here: a
  // plain reassignment there would otherwise clobber whatever a `chainOnShot`
  // called this early had already wrapped, silently dropping every manned-gun
  // shot's ammo/heat update. See that call site's own comment.

  // --- what the rounds run into ----------------------------------------------
  //
  // Gaps C-1, C-5, C-6 and M-2 of `parity-audit/projectiles-collision.md`, all
  // behind one object. `collision.js` owns the arithmetic; this is the wiring.
  //
  // Three inputs, all already shipped and none of them new:
  //   - the terrain tiles in the scene, snapped back onto the level's own height
  //     lattice (4 m on every vanilla map);
  //   - `waterLevel` out of `scene.json`, one horizontal plane;
  //   - every node the assembler tagged `extras.collision`, which the map export
  //     now carries (Wake 20,911 triangles, Bocage 21,661) and which `indexScene`
  //     already hides from the render pass.
  //
  // Plus two tables that decide what a hit *means* rather than where it is:
  // `terrain/materials.png` (one byte per heightmap sample, straight out of
  // `Materialmap.raw`) and `_shared/damage.json`'s `effects` matrix.
  level.terrainMaterials = null;
  level.damageTables = null;

  async function loadDamageTables(dir) {
    const ref = level.extras?.damage;
    if (!ref?.path) return null;
    try {
      return await fetch(`${page.MAPS_BASE}/${dir}/${ref.path}${page.bust()}`)
        .then(r => r.ok ? r.json() : null);
    } catch { return null; }
  }

  /**
   * `terrain/materials.png` back into the byte array it was written from.
   *
   * The exporter puts the raw id in all three colour channels so the file is
   * legible to a human; only red is read here, and nothing is filtered — a
   * bilinear read between id 10 (dry sand) and id 12 (rock) would invent id 11.
   */
  async function loadTerrainMaterials(dir) {
    const spec = level.extras?.terrain?.materials;
    if (!spec?.image) return null;
    try {
      const blob = await fetch(`${page.MAPS_BASE}/${dir}/${spec.image}${page.bust()}`)
        .then(r => r.ok ? r.blob() : null);
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const ids = new Uint8Array(bitmap.width * bitmap.height);
      for (let i = 0; i < ids.length; i++) ids[i] = rgba[i * 4];
      return { ids, dim: bitmap.width, spacing: spec.spacing || 0 };
    } catch { return null; }
  }

  /** Rebuild the collider for the level now in `currentRoot`. */
  function buildCollider(root) {
    const worldSize = level.extras?.worldSize || 0;
    const heightfield = buildHeightfield(level.terrainMeshes, {
      worldSize,
      dim: level.extras?.terrain?.materials?.dim || 0,
    });
    if (heightfield && level.terrainMaterials) {
      heightfield.setMaterials(level.terrainMaterials.ids, level.terrainMaterials.dim,
                               level.terrainMaterials.spacing || heightfield.spacing);
    }
    // One owner per placed object, and one per spawned vehicle rather than one
    // for the whole spawner group — otherwise a Sherman's round would pass
    // through the Willy parked next to it.
    const ownerRoots = [];
    for (const child of root.children) {
      if (child === level.spawnersRoot) ownerRoots.push(...child.children);
      else ownerRoots.push(child);
    }
    // Before the index: it bakes every hull where it stands, so the vehicles
    // have to be standing where they will rest. A ship rests at its own draft,
    // which is a closed form rather than a settle, and its deck spawns move with
    // it.
    page.settlePlacedVehicles(ownerRoots, heightfield);
    page.floatPlacedVehicles(ownerRoots, level.extras?.waterLevel);
    page.rebaseDeckSpawns();
    const statics = buildCollisionIndex(root, { ownerRoots });
    // Every damageable thing in the level, keyed by the same owner id the
    // collision index just handed out — which is what a hit record names, so a
    // round that lands resolves to the vehicle it landed on with one lookup and
    // no scene walk. `ownerRoots[i]` is owner `i` by construction.
    page.registerDamageables(ownerRoots);
    // Raised decks a ground vehicle drives on top of (bridges, repair/reload
    // bays). The level's heightfield is the ground under them; their deck tops
    // are static collision meshes. This is only the broadphase gate — the ride
    // surface itself comes out of `WorldCollider.deckHeight`, a ray against the
    // deck's own triangles, so an incline is an incline and not a raster step.
    const drivableMask = buildDrivableMask(root);
    level.collider = (heightfield || statics || Number.isFinite(level.extras?.waterLevel))
      ? new WorldCollider({ heightfield, statics, waterLevel: level.extras?.waterLevel,
                            drivableMask })
      : null;
    page.world.setCollider(level.collider);
    page.world.damageTables = level.damageTables;
    page.guns.collider = level.collider;
    page.guns.damageEffects = level.damageTables?.effects || null;
    page.guns.projectileMaterials = level.damageTables?.projectiles || null;
    page.guns.materials = level.damageTables?.materials || null;
    // The `damageMod` matrix. Without it a round's damage is only its material's
    // base times the distance falloff, which is the same number for a rifle
    // shooting a Tiger as for a Panzerfaust — the modifier is the whole reason
    // small arms do not kill armour.
    page.guns.modifiers = level.damageTables?.modifiers || null;
    // Pools and all: a mesh particle's materials are built under the level's
    // lighting, and show() warms a fresh set once this level's fog is up.
    page.effects.flush();
    page.loadEffectLibrary();
    return { heightfield, statics };
  }

  // Rule 6's warm-up (features/mesh-viewer-performance): nothing play can draw
  // is linked, uploaded or first used by the frame that draws it. Three links
  // a material's program on the first frame that draws it, uploads a texture on
  // the first frame that binds it and builds a skinned mesh's bone texture on
  // its first draw, and the link blocks that frame on the driver: on this Iris
  // Xe's system GL the perf harness watched one block for 8-9.5 s and take the
  // WebGL context with it.
  //
  // A subtree is compiled against the scene and camera of the pass that draws
  // it — the canvas (no render target), that scene's fog and lights: all a
  // program key reads that the material and the object do not — then every
  // texture its materials can bind goes to the GPU, and every program the
  // compile linked has its first use taken (`WebGLProgram.getUniforms`: the log
  // and uniform queries three otherwise runs inside the first draw, and the
  // point where a link still in flight would block). `compile` walks hidden
  // nodes too, so a pooled particle or a parked gun's flash is warmed like a
  // wall.

  /** Put `texture` on the GPU if its pixels have arrived; a no-op before. */
  function uploadTexture(texture) {
    if (!texture?.isTexture || texture.version === 0) return;
    page.renderer.initTexture(texture);
  }

  /** Every texture `root` can draw with: the material's slots, a shader's
   *  uniforms and the renderer's copy of them (where the ones `onBeforeCompile`
   *  adds live, once compiled), and each skinned mesh's bone texture, built
   *  here rather than on its first draw (`WebGLRenderer.setProgram`). */
  function uploadTextures(root) {
    root.traverse(obj => {
      if (obj.isSkinnedMesh && obj.skeleton) {
        if (!obj.skeleton.boneTexture) obj.skeleton.computeBoneTexture();
        uploadTexture(obj.skeleton.boneTexture);
      }
      for (const m of [obj.material].flat()) {
        if (!m) continue;
        for (const value of Object.values(m)) uploadTexture(value);
        for (const uniform of Object.values(m.uniforms ?? {})) uploadTexture(uniform?.value);
        const compiled = page.renderer.properties.get(m).uniforms;
        for (const uniform of Object.values(compiled ?? {})) uploadTexture(uniform?.value);
      }
    });
    // A scene's own two textures hang off no material: the skybox cube three
    // draws the background with, and an environment map.
    if (root.isScene) {
      uploadTexture(root.background);
      uploadTexture(root.environment);
    }
  }

  /** Compile `root` for the pass that draws it, upload its textures and take
   *  the first use of every program the compile linked. The programs are taken
   *  as the compile returns, before anything swaps a material out from under
   *  them: `GunFire.collect` clones a rig's flash materials right after the
   *  rig's compile starts, and the clones reuse these programs by key. */
  function warmSubtree(root, cam = page.camera, target = page.scene) {
    const compiled = page.renderer.compileAsync(root, cam, target);
    const programs = new Set();
    root.traverse(obj => {
      for (const m of [obj.material].flat()) {
        const linked = m && page.renderer.properties.get(m).programs;
        if (linked) for (const program of linked.values()) programs.add(program);
      }
    });
    return compiled.catch(() => {}).then(() => {
      uploadTextures(root);
      // A program released since (its last material disposed) has no GL
      // program left to ask.
      for (const program of programs) if (program.program) program.getUniforms();
    });
  }

  /** The level's warm-up, after applyFog() so the programs are the fogged ones
   *  the frame asks for, and again on every level switch. The effect pool and
   *  the gun stand-ins are built first; then the whole scene — terrain,
   *  statics, the level's LOD interiors and flags, parked vehicles and their
   *  hidden gun payloads, sky, water, the effect pool — is warmed for the main
   *  pass. */
  function warmLevel(library) {
    if (library) page.effects.warm();
    const stand = page.guns.warm();
    return Promise.all([warmSubtree(page.scene), warmSubtree(stand)]);
  }
  // What the `?shots` hook `__warmup` waits on: the level's warm-up (show()) and
  // the weapon in hand's (loadHandWeapon), plus the clock readings a check needs
  // to say how long the level's took. Neither promise gates anything the page
  // itself does.
  const warmups = { level: Promise.resolve(null), rig: Promise.resolve(), timing: {} };

  /** Wake's (or any level's) `SupplyDepot` nodes, world position resolved
   *  through the scene graph — a depot is usually parented under a `Bundle`
   *  (`extract_map.py`'s own placement) and does not carry its own world
   *  translation, only the chain above it does. Run once per level load, from
   *  `onFoot` (below), never per frame. */
  function collectSupplyDepots(root) {
    const depots = [];
    if (!root) return depots;
    const pos = new THREE.Vector3();
    root.traverse(obj => {
      const data = obj.userData?.supply;
      if (!data || obj.userData.templateKind !== 'SupplyDepot') return;
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(pos);
      depots.push(new SupplyDepot({ x: pos.x, y: pos.y, z: pos.z }, data, obj.name));
    });
    return depots;
  }

  function wireframe(on) {
    if (!level.currentRoot) return;
    level.currentRoot.traverse(obj => {
      if (!obj.isMesh || isCollision(obj)) return;
      for (const m of [obj.material].flat()) m.wireframe = on;
    });
  }

  async function loadSky(entry) {
    disposeSky();
    const faces = level.extras.skybox;
    if (!faces || faces.length !== 6) return;
    const dir = entry.glb.replace(/\/[^/]+$/, '');
    const tex = await page.cubeLoader.loadAsync(
      faces.map(f => `${page.MAPS_BASE}/${dir}/${f}${page.bust()}`),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    level.skybox = tex;
  }

  // LoadingManager counters are cumulative for the life of the page and never
  // reset, so a per-load view has to be taken against a baseline captured when
  // that load starts.
  const tex = { total: 0, loaded: 0, baseTotal: 0, baseLoaded: 0, load: null };

  function texReport() {
    if (!tex.load) return;
    const total = tex.total - tex.baseTotal;
    const done = tex.loaded - tex.baseLoaded;
    tex.load.count('textures', done, total);
    if (total > 0 && done >= total) {
      tex.load.end();
      tex.load = null;
    }
  }

  page.texManager.onStart = (url, loaded, total) => {
    tex.loaded = loaded;
    tex.total = total;
    texReport();
  };
  page.texManager.onProgress = (url, loaded, total) => {
    tex.loaded = loaded;
    tex.total = total;
    texReport();
  };
  // Loose textures — lightmap atlases, the terrain detail map, sky and water —
  // can land after show() has warmed the level. Each drained queue puts what
  // arrived on the GPU there and then, between frames, so the frame that first
  // binds one is not also its upload (rule 6).
  const textureQueueWaiters = [];
  page.texManager.onLoad = () => {
    uploadTextures(page.scene);
    for (const resolve of textureQueueWaiters.splice(0)) resolve();
  };
  function textureQueueDrained() {
    return tex.loaded >= tex.total
      ? Promise.resolve()
      : new Promise(resolve => textureQueueWaiters.push(resolve));
  }

  /* The sun's lens flare. `lens-flare.js` carries the engine reading and the
   * placement arithmetic; this is the painter and the texture cache.
   *
   * Nothing draws on a vanilla level, and that is correct rather than broken:
   * the five textures all 21 vanilla declarations name ship in no vanilla
   * archive (the module's header lists every place they were looked for and the
   * two mod archives that do have them). The extractor records them in
   * `missingTextures` and leaves each sprite's `file` null, so `hasDrawableFlare`
   * is false and the whole pass is skipped.
   */
  const flareCanvas = document.getElementById('flare-canvas');
  const flareImages = new Map();          // file -> HTMLImageElement, once loaded
  level.flareData = null;

  function setupLensFlare(dir) {
    level.flareData = null;
    flareImages.clear();
    const ctx = flareCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, flareCanvas.width, flareCanvas.height);
    const data = level.extras.lensFlare;
    if (!hasDrawableFlare(data)) return;
    level.flareData = data;
    for (const file of flareTextureFiles(data)) {
      const img = new Image();
      img.onload = () => flareImages.set(file, img);
      img.onerror = () => {};
      img.src = `${page.MAPS_BASE}/${dir}/${file}${page.bust()}`;
    }
  }

  /** The sun's own screen position, and whether anything is in front of it.
   *  The direction is the level's `sunLightDirectionVec`, the same vector the
   *  DirectionalLight and the sky are aimed by; the sun itself is painted into
   *  the sky box faces, so this is where that painted disc lands. */
  function sunScreenPosition() {
    const sd = level.extras.sunDirection;
    if (!sd) return null;
    const norm = Math.hypot(sd[0], sd[1], sd[2]) || 1;
    // `show()` places the light at -sunDirection * 400, i.e. the sun is in the
    // direction the light points FROM.
    const dir = new THREE.Vector3(-sd[0] / norm, sd[1] / norm, -sd[2] / norm);
    // Is it in front of the camera? Asked in VIEW space, where -z is forward.
    // Not by projecting a far-off point and testing its ndc z: the sun is
    // effectively at infinity and every level's far plane is short (Berlin's is
    // 105 m), so such a point is always past the far plane and its ndc z always
    // reads > 1 — which is how this first drew nothing at all.
    const view = dir.clone().applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(page.camera.matrixWorldInverse));
    if (view.z >= 0) return null;
    // Now project a point that is inside the frustum but along the same ray, so
    // the perspective divide gives the direction's own screen position.
    const projected = dir.clone()
      .multiplyScalar(page.camera.near + (page.camera.far - page.camera.near) * 0.5)
      .add(page.camera.position)
      .project(page.camera);
    const w = flareCanvas.width;
    const h = flareCanvas.height;
    const x = (projected.x * 0.5 + 0.5) * w;
    const y = (-projected.y * 0.5 + 0.5) * h;
    // How far off centre, normalised so the screen corner is 1 — what
    // `setFlareDistFadeScale` fades against.
    const dist = Math.hypot(x - w / 2, y - h / 2) / (Math.hypot(w, h) / 2);
    return { sunX: x, sunY: y, sunDistance: dist, visible: true };
  }

  function paintLensFlare() {
    if (!level.flareData) return;
    const width = page.renderer.domElement.width;
    const height = page.renderer.domElement.height;
    if (flareCanvas.width !== width || flareCanvas.height !== height) {
      flareCanvas.width = width;
      flareCanvas.height = height;
    }
    const ctx = flareCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const view = sunScreenPosition();
    if (!view) return;
    const sprites = flareSprites(level.flareData, {
      ...view, width, height,
      // Not a real occlusion test: nothing here traces the sun against the
      // scene. Left at 1 rather than faked — a guessed occlusion would flicker
      // the whole flare on geometry it never actually checked.
      occlusion: 1,
      textureSize: file => {
        const img = flareImages.get(file);
        return img ? Math.max(img.naturalWidth, img.naturalHeight) : 0;
      },
    });
    for (const sprite of sprites) {
      const img = flareImages.get(sprite.file);
      if (!img) continue;
      ctx.globalCompositeOperation = sprite.additive ? 'lighter' : 'source-over';
      ctx.globalAlpha = sprite.color[3];
      ctx.save();
      ctx.translate(sprite.x, sprite.y);
      if (sprite.rot) ctx.rotate(sprite.rot);
      ctx.drawImage(img, -sprite.size / 2, -sprite.size / 2, sprite.size, sprite.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  async function show(entry) {
    level.worldReady = false;
    page.syncDeployReady();
    const timing = warmups.timing = { showStart: performance.now() };
    let settleLevelWarmup;
    warmups.level = new Promise(resolve => { settleLevelWarmup = resolve; });
    const loading = entry.loading || {};
    const load = page.overlay.begin(entry.name, {
      title: loading.title,
      background: loading.background,
      music: loading.music,
      theme: loading.theme,
      assetBase: page.MAPS_BASE,
    });
    load.step('report', { label: 'level report', weight: 1 });
    // Weighted by what the bytes actually are: one ~70 MB scene against a couple
    // of MB of loose textures and a 2 KB report.
    load.step('scene', { label: 'scene geometry', weight: 88 });
    load.step('textures', { label: 'textures', weight: 11 });
    tex.baseTotal = tex.total;
    tex.baseLoaded = tex.loaded;
    tex.load = load;

    let report;
    let gltf;
    try {
      report = await fetch(`${page.MAPS_BASE}/${entry.report}${page.bust()}`).then(r => r.json());
      load.finish('report');
      gltf = await page.loader.loadAsync(
        `${page.MAPS_BASE}/${entry.glb}${page.bust()}`,
        e => load.bytes('scene', e.loaded, e.lengthComputable ? e.total : 0),
      );
      load.finish('scene');
    } catch (error) {
      if (tex.load === load) tex.load = null;
      load.fail(`could not load ${entry.name}: ${error.message}`);
      settleLevelWarmup(null);
      throw error;
    }
    // `?mode=` picks one of the level's gameplay layers; with no parameter this
    // resolves to the default layer, whose arrays are the top-level ones, so the
    // page is unchanged. A report from before `modes` existed passes straight
    // through. See `viewer/game-modes.js`.
    const wantedMode = page.params.get('mode');
    level.extras = selectGameMode(report, wantedMode);
    // A `?mode=` that did not land says so, and says it where a player can read
    // it: the dev panel is hidden for everyone but a developer, so the message
    // goes to the game's own console band as well (`logToConsole`, below, once
    // the level header has been written). Silence is the one wrong answer —
    // falling back to the default layer without a word is a page that looks
    // right and is showing something else.
    const modeIssue = modeProblem(report, wantedMode);
    level.modeNote = modeIssue
      ? (modeIssue === 'missing'
        ? `"${wantedMode}" is a game type ${report.level} offers but ships no `
          + `layer for; showing ${level.extras.gameplayMode}. `
          + `Has: ${modeNames(report).join(', ')}`
        : `no "${wantedMode}" layer on ${report.level}; `
          + `showing ${level.extras.gameplayMode}. Has: ${modeNames(report).join(', ')}`)
      : null;
    if (level.modeNote) console.warn(level.modeNote);
    // Before the old root is disposed: every gun is indexed off a node in it, and
    // the rounds in the air are clones of nodes it owns.
    // Every hull's seats go with the scene: nobody is carried across a level
    // switch, and the seat's view rig holds nodes of the old one.
    page.vehicles.clear();
    page.view = null;
    page.viewFor = null;
    page.gunSubject = null;
    // A level switch is not surgical, so the rounds in the air go back to their
    // pools here and every group goes with them.
    page.guns.clear();
    page.guns.groups.length = 0;
    dispose(level.currentRoot);
    disposeSky();
    page.disposeSounds();
    level.currentRoot = gltf.scene;
    // The glb holds every mode's vehicles and flags; drop the ones this mode
    // does not park. Before anything indexes the scene, so the vehicle list, the
    // occupancy roots and the cull set never see them.
    pruneToMode(level.currentRoot, level.extras.gameplayMode);
    // Baked fire-effect payloads (muzzle flashes, projectile bodies, trail
    // quads) ride every assembled vehicle; only the model viewer animates
    // them, so here they must stay hidden or they render parked on the guns.
    //
    // `extras.propellerBlur` (see `_propeller_blur` in assemble.py) keeps both
    // the blade mesh and the blurred disc as real siblings, because the one
    // aircraft that should ever show the disc is the flown one — `applyRig` in
    // flight.js toggles it from live throttle. Every parked spawner here has no
    // throttle at all, so it gets the engine-off state the comment above already
    // establishes: blades visible, disc hidden.
    //
    // The stamp spells the authored child name; the scene document renames
    // every second instance (`MustangPropellerBlurred_1`), and an exact compare
    // left a parked second aircraft drawing blade and disc stacked. Same bare
    // name law as `bareFireArmsName` below.
    // `idleFirePose` is the same sweep this loop used to spell out inline, plus
    // the one payload it left out: `tracerMesh`, the baked streak template. It
    // is a real mesh parked on the barrel, and `GunFire.collect` hides it — so
    // it went dark the moment anybody climbed in and drew from the first frame
    // of the level on every gun nobody had touched yet. Fifteen of them on
    // Battle of Britain, four Spitfires and eleven Brownings.
    idleFirePose(level.currentRoot);
    level.currentRoot.traverse(obj => {
      const blur = obj.userData?.propellerBlur;
      if (blur) {
        const key = bareFireArmsName(blur.blurred);
        const blurred = obj.children.find(child => bareFireArmsName(child.name) === key);
        if (blurred) blurred.visible = false;
      }
    });
    page.scene.add(level.currentRoot);
    // The flags, and the level's always-on rotators — windmills, watermills,
    // radar dishes — which the extractor bakes as `ambient`/`ambient.N`.
    // `spin*` is deliberately NOT played: that is throttle-gated rotation, and
    // a parked aircraft's propeller is stationary in the game. The one aircraft
    // that should turn is the flown one, whose propeller `advancePropeller` in
    // flight.js already accumulates from its rate axes — playing the baked clip
    // here as well would drive it twice.
    level.flagMixer = null;
    const ambient = (gltf.animations || [])
      .filter(c => !/^spin(\.\d+)?$/.test(c.name))
      // The glb bakes a flag's cloth clip for every mode's pole, and
      // `pruneToMode` has just detached the ones this mode does not fly. A
      // track whose node has gone is a `THREE.PropertyBinding: No target node
      // found` warning per bone per frame's worth of setup — 88 of them on
      // Wake's Conquest layer alone — so the tracks are dropped here, the same
      // test three itself applies when it gives up on one.
      .map(clip => {
        const live = clip.tracks.filter(track => THREE.PropertyBinding.findNode(
          level.currentRoot, THREE.PropertyBinding.parseTrackName(track.name).nodeName));
        if (live.length === clip.tracks.length) return clip;
        if (!live.length) return null;
        const trimmed = clip.clone();
        trimmed.tracks = live;
        return trimmed;
      })
      .filter(Boolean);
    level.levelClips = ambient;
    if (ambient.length) {
      level.flagMixer = new THREE.AnimationMixer(level.currentRoot);
      for (const clip of ambient) {
        const action = level.flagMixer.clipAction(clip);
        // The engine gives each flag a random start phase so a row of them does
        // not beat in unison; `randomStartPitch` in `flag.ssc` does the same for
        // the sound. Without it five flags on one map flap as one object.
        action.time = Math.random() * clip.duration;
        action.play();
      }
    }
    const dir = entry.glb.replace(/\/[^/]+$/, '');
    level.currentDir = dir;
    bindLightmaps(level.currentRoot, dir);
    unlightTerrain(level.currentRoot);
    bindTerrainDetail(level.currentRoot, dir);
    setupSky(level.currentRoot, dir);
    // Before setupWater and bindDynamicShading: both read `levelEnvCube`.
    setupEnvCube(dir);
    setupLensFlare(dir);
    page.combatArea = null;
    page.combatFrame = null;
    // The world is the simulation core of frame() from here: built from the
    // level data in hand (the collider lands a few lines down via buildCollider,
    // the parked hulls via setupVehicleBodies), fed the local player's input
    // per frame, and stepped at the engine's fixed 30 Hz (world.js, the tick
    // law in its header). The page keeps the scene graph, the cameras, the HUD,
    // the audio, the deploy flow and the effects; the world owns nothing that
    // paints. `combatArea`, `bodyWorld`, `vehicleDamage` and `supplyField`
    // below stay page-side aliases of the world's instances, so every HUD feed,
    // console hook and debug readout that always reached them reaches them
    // still.
    page.world = new World({
      extras: level.extras,
      guns: page.guns,
      groundHeight,
      fireStates: page.fireStates,
      onCrash: page.onCrashDamage,
      isWrecked: owner => {
        const visual = page.damageVisuals.get(owner);
        return !!(visual?.wrecked || visual?.removed);
      },
      // Per tick, with every piece of the tick final: every seat's world
      // position into its occupant's record (a rider senses from his seat, the
      // combat area finds a bare gun's gunner there), then the one snapshot per
      // tick render interpolation needs (the render-interpolation block, beside
      // `footLookPending`).
      onTick: () => {
        page.vehicles.publishSeatPositions(page.seatWorldPos);
        page.capturePresentationTick();
      },
    });
    // A fresh level: none of the old one's nodes or poses survive it.
    page.rebuildVehicleInterp();
    page.combatArea = page.world.combatArea;
    page.vehicleDamage = page.world.vehicleDamage;
    // Bot visuals: create the root group now that `scene` exists.
    if (!page.botRoot) {
      page.botRoot = new THREE.Group();
      page.botRoot.name = 'bot-renderers';
      page.scene.add(page.botRoot);
    }
    // Bots spawn on the player's team. The call waits for `buildCollider`
    // below: `spawnBotsForLevel` builds the nav grid from `world.collider` and
    // `pickSpawn` runs its spawn-safety probes against it, and both are empty
    // before the collider lands — which is what left the grid all `-2` (no
    // terrain) and every bot with no path.
    setupWater(level.currentRoot, dir);
    page.setupSounds(level.extras, dir);
    page.loadMapArt(dir);
    // A map held open across a level switch would be showing the old level.
    page.toggleFullMap(false);
    page.fullmapName.textContent = level.extras.level || entry.name;
    const cps = (level.extras.controlPoints || []).length;
    page.fullmapMeta.textContent = cps
      ? `${cps} control point${cps === 1 ? '' : 's'} · ${(level.extras.soldierSpawns || []).length} spawns`
      : '';
    // After the baked paths and the sky/water shaders have claimed their
    // meshes, everything still on a lit glTF material is the engine's
    // fixed-function path: vehicles and non-lightmapped statics.
    bindDynamicShading(level.currentRoot);
    bindTextureFade(level.currentRoot);
    applyLighting();
    if (level.extras.sunDirection) {
      // The sun light points along -sunLightDirectionVec toward the origin.
      page.sun.position.set(
        level.extras.sunDirection[0] * -400,
        level.extras.sunDirection[1] * 400,
        level.extras.sunDirection[2] * -400,
      );
    }
    // A ship's landing craft are spawned objects of their own in the engine.
    const craft = detachSpawnedCraft(level.currentRoot);
    if (craft.length) console.log(`[vehicles] ${craft.length} landing craft split from their ships`);
    indexScene(level.currentRoot);
    collectTerrain(level.currentRoot);
    // Leaf sprites face the camera and each tree past its billboardDistance
    // becomes the engine's pre-rendered card (`tree-foliage.js`). After the
    // material passes above, which rebuild materials, and after `indexScene`
    // froze the statics.
    bindTreeFoliage(level.currentRoot, {
      scene: page.scene, mapsBase: page.MAPS_BASE, bust: page.bust, texLoader: page.texLoader,
      maxAnisotropy: page.renderer.capabilities.getMaxAnisotropy(),
    }).then(r => console.log(`trees: ${r.trees} placed, ${r.sprites} sprite parts, ${r.impostors} billboards`));
    // A fresh extract starts every pole in its authored colours; a capture
    // rewrites cloth UVs in place, so seed the cache the swap reads (the
    // geometry's own baked cell) before anything can take a point.
    level.currentRoot.traverse(obj => {
      if (obj.userData?.kind === 'flagCloth') {
        const uv = obj.geometry?.getAttribute('uv');
        if (uv && !obj.geometry.userData.flagUvCell) {
          obj.geometry.userData.flagUvCell = page.unitRectOf(uv);
        }
      }
    });
    // Both tables are small (damage.json 154 KB shared across every level,
    // materials.png a couple of KB) and both are needed before the first shot,
    // not before the first frame.
    [level.terrainMaterials, level.damageTables] = await Promise.all([
      loadTerrainMaterials(dir), loadDamageTables(dir), page.loadCollisionMeshes(dir),
    ]);
    level.materialFrictionById = buildMaterialFrictionTable(level.damageTables);
    const collision = buildCollider(level.currentRoot);
    // After the collider: a body is keyed by the owner id the index handed out.
    page.setupVehicleBodies();
    // Now that the collider exists, spawn the bots so their nav grid and spawn
    // probes see it.
    page.spawnBotsForLevel();
    // A new level means a new scene graph (the hulls' instances went with the
    // old one, above), and so are every cached door.
    page.forgetSoldier();
    // A new level starts the flag choice over; without this the rebuilt select
    // would keep the old map's index through `buildSpawnFlags`.
    page.spawnFlagSelect.selectedIndex = -1;
    page.entryPoints = null;
    page.nearEntry = null;
    if (page.optPilot.checked) page.setPilot(true);
    // Joining is the spawn screen, not an instant teleport — clear a leftover
    // on-foot tick from the previous level so openDeploy owns the join.
    if (page.optOnFoot.checked) {
      page.optOnFoot.checked = false;
      page.setOnFoot(false);
    }
    applyFar();
    if (!level.skyRoot) await loadSky(entry);
    applyFog();
    page.placeCamera();
    wireframe(page.optWire.checked);
    applyVisibility();
    // The fog is up, so the programs this links are the ones the frame wants.
    timing.warmStart = performance.now();
    Promise.resolve(page.loadEffectLibrary())
      .then(library => warmLevel(library))
      .then(() => {
        timing.warmCompiled = performance.now();
        return textureQueueDrained();
      })
      .finally(() => {
        timing.warmResolved = performance.now();
        settleLevelWarmup(timing);
      });
    const t = level.extras.terrain || {};
    const o = level.extras.objects || {};
    // `objects` counts what the glb holds, and the glb holds every mode's
    // vehicles; what is standing in this level is what survived `pruneToMode`.
    const vehiclesHere = level.spawnersRoot ? level.spawnersRoot.children.length
                                      : (o.spawners || 0);
    document.getElementById('stats').innerHTML =
      `<strong>${level.extras.level || entry.name}</strong><br>` +
      `world ${level.extras.worldSize || '?'} m<br>` +
      `terrain ${t.triangles || 0} tris / ${t.tiles || 0} tiles` +
      (t.defaultTiles ? ` + ${t.defaultTiles} default` : '') +
      (t.detail ? ' + detail' : '') + `<br>` +
      `objects ${o.placed || 0} placed` +
      (vehiclesHere ? ` / ${vehiclesHere} vehicles` : '') +
      (o.lightmaps ? ` / ${o.lightmaps} lightmaps` : '') +
      (o.skipped?.length ? ` / ${o.skipped.length} skipped` : '') + `<br>` +
      `sky ${level.extras.sky ? level.extras.sky.mesh + (level.extras.sky.clouds ? ' + clouds' : '') :
          (level.extras.skybox ? 'env cubemap' : 'fog colour')} / ` +
      `water ${level.extras.water ? 'shader' : 'flat'}<br>` +
      // A level exported before the collision flip has a heightfield and a sea
      // and no hulls; saying so beats a silent half-working collider.
      `collision ${collision.statics
      ? `${collision.statics.count} tris` : 'hulls not exported'}` +
      (collision.heightfield
        ? ` / heightfield ${collision.heightfield.dim}^2 @ ${collision.heightfield.spacing} m`
        : ' / no heightfield') +
      (t.materials ? ` / ${Object.keys(t.materials.labels || {}).length} surfaces` : '');

    // The same facts into the console, because that is what a console is for:
    // the retail client fills `io::mainConsole` while it loads, which is why
    // the band in the user's capture is full-height on a session that had only
    // executed two lines. `getLines(20)` returns what the scrollback has, so a
    // console nobody has written to opens as a thin strip — in the game and
    // here alike.
    page.logToConsole(`level ${level.extras.level || entry.name} (${page.activeMod.id || 'bf1942'})`);
    page.logToConsole(`world ${level.extras.worldSize || '?'} m, ` +
                 `${t.triangles || 0} terrain tris over ${t.tiles || 0} tiles`);
    page.logToConsole(`${o.placed || 0} objects placed, ${vehiclesHere} vehicle spawners, ` +
                 `${o.lightmaps || 0} object lightmaps`);
    // The one line a player who typed a `?mode=` needs and would otherwise only
    // find in a browser console they never open.
    if (level.modeNote) page.logToConsole(level.modeNote);
    if (o.skipped?.length) page.logToConsole(`${o.skipped.length} objects skipped`);
    page.logToConsole(collision.statics
      ? `collision ${collision.statics.count} tris` + (collision.heightfield
          ? `, heightfield ${collision.heightfield.dim}^2 @ ${collision.heightfield.spacing} m`
          : ', no heightfield')
      : 'collision hulls not exported');

    // Geometry, collider and bindings are all up; only loose textures may still
    // be streaming, and the game deploys over those too.
    level.worldReady = true;
    timing.worldReady = performance.now();
    page.syncDeployReady();
    // Direct-to-spawn: skip the briefing dialog and land on the deploy screen.
    // A level that declares no soldier spawn has no screen to open, and with
    // the "click to fly" plate gone there would be nothing to tell the player
    // the controls are live — so free roam starts armed instead.
    if (!page.optPilot.checked && !page.openDeploy()) page.capture();

    // Every texture this level needs has been queued by now, so a queue that is
    // already drained (or was never filled) means the load is done — texReport
    // alone would sit waiting for a callback that is not coming.
    if (tex.total - tex.baseTotal <= tex.loaded - tex.baseLoaded) {
      load.end();
      if (tex.load === load) tex.load = null;
    } else {
      texReport();
    }
  }

  page.optGameFog.addEventListener('change', applyFog);
  page.optWire.addEventListener('change', e => wireframe(e.target.checked));
  page.optVehicles.addEventListener('change', applyVisibility);
  page.optEntire.addEventListener('change', () => {
    applyFar();
    applyFog();
    applyVisibility();
  });

  Object.assign(level, {
    DEFAULT_SURFACE_FRICTION,
    advanceSim,
    applyVisibility,
    bindDynamicShading,
    collectSupplyDepots,
    cull,
    deckNormal,
    flattenCull,
    freezeVehicle,
    getFloorAltitude,
    groundHeight,
    isCollision,
    paintLensFlare,
    show,
    surfaceFriction,
    tagCull,
    thaw,
    thawVehicle,
    unlitCockpit,
    updateSky,
    updateTextureFade,
    vehicleSpawnActive,
    warmSubtree,
    warmups,
  });
  return level;
}
