// Dynamic shadows on the page: what `dynamic-shadows.js` decides, drawn.
//
// Retail's pass (`fx::ShadowManager`, ledger VID-7 and the DSH rows): each
// `hasDynamicShadow` object within 50 m of the camera is drawn black into a
// 128 px texture from up the light, and the terrain patches under it are
// drawn a second time with that texture projected on them. This file does
// the same with the page's objects:
//
//   who casts     the vehicles whose root template carries the flag (the
//                 land vehicles and aircraft; no ship, no emplaced gun) and
//                 every soldier, found by walking the scene twice a second;
//                 of each, the parts whose own template carries the flag
//                 (`models/dynamic-shadows.json`, extract_dynamic_shadows.py)
//                 and, for a flagged root, the hull its LodObject draws
//   the texture   one 128 px tile of a 512 px atlas per pool slot (the
//                 pool is 10), the object drawn through a black override
//                 material by an orthographic camera, depth test off
//   the receiver  the level's terrain patches alone: a twin of each patch
//                 (the same geometry, the same matrix) drawn after the
//                 opaque pass with LESSEQUAL depth, blending black over the
//                 ground by every shadow that reaches it. Statics, water
//                 and other objects receive nothing, as in the game.
//
// The cost (measured, features/retail-inverse-gap-audit-2026-11-12 entry 11):
// a tile is one small render of one object, drawn again only when a rigid
// object moves or turns and every frame for a soldier, at most ten a frame;
// the terrain twins draw only the patches a shadow lies on. With SHADOWS off
// `update` returns at its first line and the twins are hidden.
//
// One departure, on purpose: retail draws a rigid object's texture again
// only when it MOVES 3 cm (0x005b95f9..0x005b962f), so a tank turning on the
// spot keeps a stale silhouette until it creeps; here a turn redraws it too.

import * as THREE from 'three';
import {
  SHADOW_POOL, SHADOW_RANGE, SHADOW_REDRAW_DIST2, SHADOW_TEXTURE,
  CASTER_SKIP_GROUPS, ShadowPool, castsShadow, gatherCasters, heightByte, parseShadowColor, shadowAlpha, shadowLight, shadowRadius,
} from './dynamic-shadows.js';

/** The layer the parts that cast are also put on; the shadow camera sees
 *  nothing else. */
export const SHADOW_LAYER = 21;
/** A soldier's radius as a caster. Retail's is the soldier object's own
 *  (unread); 1.5 m holds a standing, a prone and a diving body. */
export const SOLDIER_SHADOW_RADIUS = 1.5;
/** A soldier object's origin over the feet (`nametags.js` SOLDIER_ORIGIN_UP). */
const SOLDIER_ORIGIN_UP = 1.0;
/** Frames between two walks of the scene for casters (half a second at 60). */
const DISCOVER_EVERY = 30;
const ATLAS_TILES = 4;                       // 4 x 4 tiles of 128: room for 16
const ATLAS_SIZE = ATLAS_TILES * SHADOW_TEXTURE;

const VERTEX = /* glsl */`
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  // The terrain's own expression, so the depth is the terrain's to the bit.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */`
uniform sampler2D uAtlas;
uniform int uCount;
uniform vec4 uU[${SHADOW_POOL}];
uniform vec4 uV[${SHADOW_POOL}];
uniform vec4 uTile[${SHADOW_POOL}];
uniform float uAlpha[${SHADOW_POOL}];
varying vec3 vWorld;
void main() {
  vec4 p = vec4(vWorld, 1.0);
  float keep = 1.0;
  for (int i = 0; i < ${SHADOW_POOL}; i++) {
    if (i >= uCount) break;
    vec2 uv = vec2(dot(uU[i], p), dot(uV[i], p));
    // CLAMP addressing onto a texture whose border is clear.
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) continue;
    float a = texture2D(uAtlas, uTile[i].xy + uv * uTile[i].zw).a * uAlpha[i];
    keep *= 1.0 - a;
  }
  // ALPHAFUNC GREATER 0.
  if (keep >= 0.998) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - keep);
}`;

/**
 * Built once. `page`:
 *   renderer, scene, camera     the page's own
 *   heightAt(x, z)              the terrain's height there, or null off it
 *   sunTo(out: Vector3)         the unit vector towards the sun
 *   templates()                 the Set of flagged template names, or null
 *   shadowColor()               the level's `shadow.shadowColor`, as stored
 *   enabled()                   SHADOWS (video-settings.js `shadows`)
 */
export function createShadowPass(page) {
  const pass = {};
  const pool = new ShadowPool(SHADOW_POOL);
  const slotState = Array.from({ length: SHADOW_POOL }, (_, i) => ({
    index: i, pos: new THREE.Vector3(), radius: 0, rot: new Float32Array(9), drawn: false,
    u: new THREE.Vector4(), v: new THREE.Vector4(),
  }));

  let atlas = null;
  let overlayMaterial = null;
  let overlayGroup = null;
  let twins = [];                 // { patch, twin, x, z, radius }
  let terrainRoot = null;
  let casters = new Map();        // root Object3D -> caster
  let casterId = 0;
  let frame = 0;
  let lastTemplates = null;
  let hidden = true;
  pass.stats = { casters: 0, inRange: 0, active: 0, drawn: 0, twins: 0 };

  const shadowScene = new THREE.Scene();
  shadowScene.matrixWorldAutoUpdate = false;
  shadowScene.overrideMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3);
  shadowCam.matrixAutoUpdate = false;
  shadowCam.matrixWorldAutoUpdate = false;
  shadowCam.layers.set(SHADOW_LAYER);

  const _cam = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _sun = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _l = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _clear = new THREE.Color();
  const _box = new THREE.Box3();
  const _sphere = new THREE.Sphere();
  const _inv = new THREE.Matrix4();
  const _light = [0, 1, 0];
  const _childList = [null];

  function ensureGpu() {
    if (atlas) return;
    atlas = new THREE.WebGLRenderTarget(ATLAS_SIZE, ATLAS_SIZE, {
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    atlas.scissorTest = true;
    overlayMaterial = new THREE.ShaderMaterial({
      name: 'dynamic-shadow-receiver',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uCount: { value: 0 },
        uU: { value: Array.from({ length: SHADOW_POOL }, () => new THREE.Vector4()) },
        uV: { value: Array.from({ length: SHADOW_POOL }, () => new THREE.Vector4()) },
        uTile: { value: Array.from({ length: SHADOW_POOL }, () => new THREE.Vector4()) },
        uAlpha: { value: new Array(SHADOW_POOL).fill(0) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      // The same triangles a second time: the offset only settles a tie.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      fog: false,
      toneMapped: false,
    });
    overlayGroup = new THREE.Group();
    overlayGroup.name = 'dynamic-shadows';
    overlayGroup.matrixAutoUpdate = false;
    page.scene.add(overlayGroup);
  }

  /** The level's terrain patches, a twin for each. Rebuilt when the level
   *  root changes. */
  function bindTerrain(root) {
    for (const t of twins) overlayGroup.remove(t.twin);
    twins = [];
    terrainRoot = root;
    if (!root) return;
    for (const patch of root.children) {
      if (!patch.isMesh || patch.userData?.kind !== 'terrain' || !patch.geometry) continue;
      const twin = new THREE.Mesh(patch.geometry, overlayMaterial);
      twin.name = `shadow ${patch.name}`;
      twin.matrixAutoUpdate = false;
      twin.matrixWorldAutoUpdate = false;
      twin.frustumCulled = patch.frustumCulled;
      twin.visible = false;
      // After every opaque thing, before the first transparent one.
      twin.renderOrder = -1e6;
      patch.updateWorldMatrix(true, false);
      twin.matrixWorld.copy(patch.matrixWorld);
      if (!patch.geometry.boundingSphere) patch.geometry.computeBoundingSphere();
      _sphere.copy(patch.geometry.boundingSphere).applyMatrix4(patch.matrixWorld);
      overlayGroup.add(twin);
      twins.push({ patch, twin, x: _sphere.center.x, z: _sphere.center.z, radius: _sphere.radius });
    }
    pass.stats.twins = twins.length;
  }

  function findTerrainRoot() {
    for (const child of page.scene.children) {
      if (child === overlayGroup || CASTER_SKIP_GROUPS.has(child.name)) continue;
      for (const c of child.children) {
        if (c.isMesh && c.userData?.kind === 'terrain') return child;
      }
    }
    return null;
  }

  /** Put the parts of `root` that cast on the shadow layer; returns how many
   *  and whether any is skinned, and the radius round the root they fill. */
  function tag(caster, templates) {
    const root = caster.root;
    let count = 0;
    let skinned = false;
    let radius = 0;
    // A flagged root draws the hull its LodObject shows at full detail
    // (`gatherGeometries`: the first child as a LodObject, highest LOD forced).
    let hull = null;
    if (caster.kind === 'vehicle') {
      const lod = root.children.find(c => c.userData?.templateKind === 'LodObject');
      hull = lod?.children[0] ?? null;
    }
    root.updateWorldMatrix(true, true);
    _inv.copy(root.matrixWorld).invert();
    const visit = (node, owned) => {
      let own = owned;
      const ud = node.userData;
      if (node === hull) own = true;
      else if (ud?.templateKind) own = castsShadow(templates, ud.name ?? node.name);
      if (node.isMesh) {
        if (own) {
          node.layers.enable(SHADOW_LAYER);
          count++;
          if (node.isSkinnedMesh) skinned = true;
          else if (node.visible && node.geometry) {
            if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
            _sphere.copy(node.geometry.boundingSphere).applyMatrix4(node.matrixWorld).applyMatrix4(_inv);
            radius = Math.max(radius, _sphere.center.length() + _sphere.radius);
          }
        } else {
          node.layers.disable(SHADOW_LAYER);
        }
      }
      for (const c of node.children) visit(c, own);
    };
    visit(root, caster.kind === 'soldier' ? false : castsShadow(templates, root.userData?.name ?? root.name));
    caster.count = count;
    caster.skinned = skinned || caster.kind === 'soldier';
    if (caster.kind === 'soldier') caster.radius = SOLDIER_SHADOW_RADIUS;
    else if (radius > 0) caster.radius = radius;
    caster.tagged = frame;
  }

  /** Walk the scene for vehicles and soldiers. Stops at any templated node
   *  and any mesh, so a level's statics cost one step each. */
  function discover(templates) {
    const seen = new Set();
    const add = (root, kind) => {
      seen.add(root);
      if (casters.has(root)) return;
      casters.set(root, { id: ++casterId, root, kind, radius: kind === 'soldier' ? SOLDIER_SHADOW_RADIUS : 1,
                          count: 0, skinned: kind === 'soldier', tagged: -1 });
    };
    gatherCasters(page.scene, templates, add, overlayGroup);
    for (const [root, caster] of casters) {
      if (seen.has(root)) continue;
      pool.release(caster.id);
      casters.delete(root);
    }
    pass.stats.casters = casters.size;
  }

  const shown = node => {
    for (let n = node; n; n = n.parent) {
      if (!n.visible) return false;
      if (n === page.scene) return true;
    }
    return false;                       // out of the scene
  };

  function hide() {
    if (hidden) return;
    hidden = true;
    for (const t of twins) t.twin.visible = false;
    if (overlayMaterial) overlayMaterial.uniforms.uCount.value = 0;
    pass.stats.active = 0;
    pass.stats.drawn = 0;
    pass.stats.inRange = 0;
  }

  function drawTile(caster, slot, state, r) {
    const renderer = page.renderer;
    const col = slot % ATLAS_TILES;
    const row = Math.floor(slot / ATLAS_TILES);
    const px = col * SHADOW_TEXTURE;
    const py = row * SHADOW_TEXTURE;
    atlas.viewport.set(px, py, SHADOW_TEXTURE, SHADOW_TEXTURE);
    atlas.scissor.set(px, py, SHADOW_TEXTURE, SHADOW_TEXTURE);
    // The camera `2 r` up the light, `2 r` square, near `r`, far `3 r`.
    shadowCam.left = -r; shadowCam.right = r; shadowCam.top = r; shadowCam.bottom = -r;
    shadowCam.near = r; shadowCam.far = 3 * r;
    shadowCam.updateProjectionMatrix();
    _c.copy(_pos).addScaledVector(_l, 2 * r);
    shadowCam.matrixWorld.makeBasis(_x, _y, _l).setPosition(_c);
    shadowCam.matrixWorldInverse.copy(shadowCam.matrixWorld).invert();
    caster.root.updateWorldMatrix(false, true);
    _childList[0] = caster.root;
    shadowScene.children = _childList;
    renderer.setRenderTarget(atlas);
    renderer.clear(true, false, false);
    renderer.render(shadowScene, shadowCam);
    // Where this texture lies: u, v = 0.5 + (world - pos) . X|Y / 2r.
    const k = 1 / (2 * r);
    state.u.set(_x.x * k, _x.y * k, _x.z * k, 0.5 - _pos.dot(_x) * k);
    state.v.set(_y.x * k, _y.y * k, _y.z * k, 0.5 - _pos.dot(_y) * k);
    state.pos.copy(_pos);
    state.radius = r;
    const e = caster.root.matrixWorld.elements;
    const rot = state.rot;
    rot[0] = e[0]; rot[1] = e[1]; rot[2] = e[2]; rot[3] = e[4]; rot[4] = e[5]; rot[5] = e[6];
    rot[6] = e[8]; rot[7] = e[9]; rot[8] = e[10];
    state.drawn = true;
  }

  const turned = (state, root) => {
    const e = root.matrixWorld.elements;
    const rot = state.rot;
    return Math.abs(rot[0] - e[0]) + Math.abs(rot[1] - e[1]) + Math.abs(rot[2] - e[2])
      + Math.abs(rot[3] - e[4]) + Math.abs(rot[4] - e[5]) + Math.abs(rot[5] - e[6])
      + Math.abs(rot[6] - e[8]) + Math.abs(rot[7] - e[9]) + Math.abs(rot[8] - e[10]) > 2e-3;
  };

  const inRange = [];

  /** Once a frame, before the world is drawn. */
  pass.update = () => {
    const templates = page.enabled() ? page.templates() : null;
    if (!templates || !templates.size) { hide(); return; }
    ensureGpu();
    frame++;
    const root = terrainRoot && terrainRoot.parent === page.scene ? terrainRoot : null;
    if (!root || frame % DISCOVER_EVERY === 1 || templates !== lastTemplates) {
      const found = findTerrainRoot();
      if (found !== terrainRoot || (found && twins.length === 0)) bindTerrain(found);
      discover(templates);
      if (templates !== lastTemplates) for (const c of casters.values()) c.tagged = -1;
      lastTemplates = templates;
    }
    if (!twins.length) { hide(); return; }

    const camera = page.camera;
    camera.getWorldPosition(_cam);
    page.sunTo(_sun);
    shadowLight([_sun.x, _sun.y, _sun.z], _light);
    _l.set(_light[0], _light[1], _light[2]);
    // `setupShadow`: X = up x Z, Y = Z x X; straight down the Y axis there is
    // no cross product to take.
    _x.set(0, 1, 0).cross(_l);
    if (_x.lengthSq() < 1e-12) _x.set(1, 0, 0); else _x.normalize();
    _y.crossVectors(_l, _x).normalize();

    inRange.length = 0;
    for (const caster of casters.values()) {
      const node = caster.root;
      if (!shown(node)) continue;
      node.updateWorldMatrix(true, false);
      const e = node.matrixWorld.elements;
      const up = caster.kind === 'soldier' ? SOLDIER_ORIGIN_UP : 0;
      const dx = e[12] - _cam.x, dy = e[13] + up - _cam.y, dz = e[14] - _cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > SHADOW_RANGE * SHADOW_RANGE) continue;
      caster.d2 = d2;
      inRange.push(caster);
    }
    pass.stats.inRange = inRange.length;
    if (!inRange.length) { pool.claim([]); hide(); return; }
    inRange.sort((a, b) => a.d2 - b.d2);
    const slots = pool.claim(inRange.map(c => c.id));

    const renderer = page.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_clear);
    let touched = false;
    const begin = () => {
      if (touched) return;
      touched = true;
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
    };

    const colorAlpha = parseShadowColor(page.shadowColor())[3];
    const u = overlayMaterial.uniforms;
    let active = 0;
    let drawn = 0;
    for (const t of twins) t.hit = false;
    for (const caster of inRange) {
      const slot = slots.get(caster.id);
      if (slot === undefined) continue;
      const state = slotState[slot];
      const fresh = pool.slots[slot].fresh;
      if (fresh) state.drawn = false;
      const e = caster.root.matrixWorld.elements;
      _pos.set(e[12], e[13] + (caster.kind === 'soldier' ? SOLDIER_ORIGIN_UP : 0), e[14]);
      const ground = page.heightAt(_pos.x, _pos.z);
      if (!Number.isFinite(ground)) continue;
      const byte = heightByte(_pos.y - ground);
      if (byte === null) continue;
      if (caster.tagged < 0 || frame - caster.tagged >= DISCOVER_EVERY) {
        const before = caster.count;
        tag(caster, templates);
        if (caster.count !== before) state.drawn = false;
      }
      if (!caster.count) continue;
      const r = shadowRadius(caster.radius);
      if (!state.drawn || caster.skinned || state.pos.distanceToSquared(_pos) > SHADOW_REDRAW_DIST2
          || turned(state, caster.root)) {
        begin();
        drawTile(caster, slot, state, r);
        drawn++;
      }
      const alpha = shadowAlpha({ colorAlpha, byte, radius: state.radius, distance: state.pos.distanceTo(_cam) });
      if (!(alpha > 0)) continue;
      u.uU.value[active].copy(state.u);
      u.uV.value[active].copy(state.v);
      const inset = 0.5 / ATLAS_SIZE;
      u.uTile.value[active].set(
        (slot % ATLAS_TILES) / ATLAS_TILES + inset, Math.floor(slot / ATLAS_TILES) / ATLAS_TILES + inset,
        1 / ATLAS_TILES - 2 * inset, 1 / ATLAS_TILES - 2 * inset);
      u.uAlpha.value[active] = alpha;
      active++;
      // The patches this shadow can lie on: its column down the light from
      // 10 m up reaches at most `r + 10 * tan` to the side.
      const reach = state.radius * 2 + 8;
      for (const t of twins) {
        if (t.hit) continue;
        const ddx = t.x - state.pos.x, ddz = t.z - state.pos.z;
        const lim = t.radius + reach;
        if (ddx * ddx + ddz * ddz <= lim * lim) t.hit = true;
      }
    }
    if (touched) {
      shadowScene.children = [];
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(_clear, prevAlpha);
    }
    u.uCount.value = active;
    for (const t of twins) {
      t.twin.visible = active > 0 && t.hit && t.patch.visible;
    }
    hidden = active === 0;
    pass.stats.active = active;
    pass.stats.drawn = drawn;
  };

  /** Draw nothing until the next `update` (another renderer has the scene). */
  pass.hide = hide;

  /** A level is going or a context came back: forget what was drawn. */
  pass.reset = () => {
    for (const s of slotState) s.drawn = false;
    for (const c of casters.values()) c.tagged = -1;
    terrainRoot = null;
  };

  pass.dispose = () => {
    hide();
    for (const t of twins) overlayGroup?.remove(t.twin);
    twins = [];
    casters.clear();
    atlas?.dispose();
    overlayMaterial?.dispose();
    shadowScene.overrideMaterial.dispose();
    if (overlayGroup) page.scene.remove(overlayGroup);
    atlas = null; overlayMaterial = null; overlayGroup = null;
  };

  /** For headless checks. */
  pass.debug = () => ({ ...pass.stats, slots: pool.slots.map(s => ({ key: s.key, active: s.active })),
                        atlas, casters: [...casters.values()].map(c => ({ kind: c.kind, name: c.root.name, count: c.count, radius: c.radius })) });

  return pass;
}
