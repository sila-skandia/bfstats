/**
 * Trees the way the engine draws them: leaf sprites that face the camera, and
 * one pre-rendered card per tree past `billboardDistance`.
 *
 * A Refractor TreeMesh is three kinds of part. The trunk and the branch cards
 * are ordinary geometry. The leaf sprites are not: each is a point with a
 * half-size, and the engine expands it into a camera-facing quad every frame.
 * The exporter (`bf42/treemesh.py`) has to bake something a glTF can hold, so
 * it writes each sprite as a quad lying in the mesh's own XY plane. Look at
 * that from the -z side and the canopy is full; walk round to +x and every
 * card is edge-on and the tree is a stick with a few slivers hanging off it —
 * the "depending on the angle the bush renders" report on Bocage. The quads
 * still carry everything needed to undo that: the four corners share one
 * centre and their offsets are the authored half-sizes. `bindTreeFoliage`
 * recovers centre and offset per vertex into two attributes and the sprite
 * material's vertex shader re-expands the card in view space, which is what
 * the engine does. No re-extract: the bake is right, it was only ever drawn
 * flat.
 *
 * Past `GeometryTemplate.billboardDistance` (50 m for every vanilla tree) the
 * engine draws none of that geometry and puts up one card textured from
 * `treeMesh/Billboards/<mesh>.dds`: eight views of the whole tree 45 degrees
 * apart, pre-rendered soft and dense. Those cards are what every distant tree
 * in the retail game is. Drawing the geometry out to the fog instead shows
 * alpha-tested leaf cards whose mip-averaged alpha falls under the cutoff, so
 * the far trees thin to sticks. `extract_tree_billboards.py` ships the strips
 * as `_shared/trees.json` + `_shared/trees/*.png`; here each placed tree gets
 * an impostor quad that turns about its trunk to face the camera and picks the
 * strip frame for the viewing azimuth, and a per-render pass swaps geometry
 * for card at the template's distance.
 *
 * The engine's swap is a hard cut at `billboardDistance`, and drawn here it
 * read as a pop: the sprite canopy is sparser than the pre-rendered card, so
 * a tree walking through 50 m visibly thickens in one frame. The swap is a
 * fade instead, over a band centred on the template's distance (`FADE_SPAN`
 * of it, 40..60 m for a 50 m tree): the geometry stays opaque through the
 * band while the card blends in over it, from clear at the near edge to
 * solid at the far edge, where the geometry is then dropped underneath it.
 * Nothing ever pops in view: the card is invisible when the geometry goes
 * on and covers it when the geometry goes off. Each placed tree has its own
 * card material so the opacity is per tree; the card's alpha test scales
 * with the opacity so its coverage holds while it fades.   [HOUSE RULES]
 *
 * The swap runs from `scene.onBeforeRender`, which `WebGLRenderer.render`
 * calls before it collects visible objects, so nothing in the page's frame
 * loop has to know about trees. Only the meshes under a tree are toggled,
 * never the tree node itself, so the page's own distance cull of statics
 * (`applyVisibility`) keeps the final say on the node.
 */
import * as THREE from 'three';

const SPRITE_MATERIAL = /^sprite_\d+$/;
const TREE_PART = /^(sprite|trunk|branch)_\d+$/;
const EIGHTH_TURN = Math.PI / 4;
/** Width of the dissolve band as a fraction of `billboardDistance`, centred on
 *  it. Not an engine number: the engine cuts. 0.4 is the narrowest band that
 *  still reads as a fade at walking pace. */
export const FADE_SPAN = 0.4;
/** The strip's edge coverage; the fade scales it so a fading card keeps its
 *  outline instead of eroding to nothing under a fixed cutoff. */
const CARD_ALPHA_TEST = 0.5;

/** Put a tree's card at `opacity`: solid cards draw opaque (depth-written,
 *  sorted with the scenery); a fading one blends over the geometry beneath. */
function setCardOpacity(material, opacity) {
  const solid = opacity >= 1;
  material.transparent = !solid;
  material.depthWrite = solid;
  material.opacity = opacity;
  material.alphaTest = solid ? CARD_ALPHA_TEST : Math.max(0.01, CARD_ALPHA_TEST * opacity);
}

const manifestByBase = new Map();
const textureByUrl = new Map();

/** Recover per-vertex sprite centre and half-size offsets from the baked quads.
 *  Returns false when the geometry is not the exporter's sprite layout. */
function attachSpriteAttributes(geometry) {
  if (geometry.userData.treeSprite !== undefined) return geometry.userData.treeSprite;
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!pos || !index || index.count % 6 !== 0) {
    geometry.userData.treeSprite = false;
    return false;
  }
  const n = pos.count;
  const center = new Float32Array(n * 3);
  const offset = new Float32Array(n * 2);
  const owner = new Int32Array(n).fill(-1);
  // Every vertex defaults to "no expansion": a card the walk below rejects
  // still draws exactly as it did.
  for (let i = 0; i < n; i++) {
    center[i * 3] = pos.getX(i);
    center[i * 3 + 1] = pos.getY(i);
    center[i * 3 + 2] = pos.getZ(i);
  }
  const corners = new Set();
  let quads = 0;
  for (let q = 0; q < index.count; q += 6) {
    corners.clear();
    for (let k = 0; k < 6; k++) corners.add(index.getX(q + k));
    // Two triangles of one card: four corners, two of them shared.
    if (corners.size !== 4) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const v of corners) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); }
    cx /= 4; cy /= 4; cz /= 4;
    let flat = true;
    for (const v of corners) {
      // The exporter's card lies in the mesh XY plane, so a corner's z is the
      // centre's; anything else is not a sprite quad and stays as baked.
      if (Math.abs(pos.getZ(v) - cz) > 1e-3 || (owner[v] !== -1 && owner[v] !== q)) flat = false;
    }
    if (!flat) continue;
    for (const v of corners) {
      owner[v] = q;
      center[v * 3] = cx; center[v * 3 + 1] = cy; center[v * 3 + 2] = cz;
      offset[v * 2] = pos.getX(v) - cx;
      offset[v * 2 + 1] = pos.getY(v) - cy;
    }
    quads++;
  }
  if (!quads) {
    geometry.userData.treeSprite = false;
    return false;
  }
  geometry.setAttribute('treeCenter', new THREE.BufferAttribute(center, 3));
  geometry.setAttribute('treeOffset', new THREE.BufferAttribute(offset, 2));
  geometry.userData.treeSprite = true;
  return true;
}

/** The engine's sprite expansion, in the material's own vertex program: the
 *  card is re-built in view space from its centre and authored half-size, so
 *  it faces the camera whatever the tree's yaw or the viewer's bearing. The
 *  placed node's scale (Bocage scales each tree a little) still applies. */
function patchSpriteMaterial(material) {
  if (material.userData?.treeSprite) return;
  material.userData = material.userData || {};
  material.userData.treeSprite = true;
  const previous = material.onBeforeCompile;
  material.customProgramCacheKey = () => 'bf-tree-sprite';
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {',
        'attribute vec3 treeCenter;\nattribute vec2 treeOffset;\nvoid main() {')
      .replace('#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( treeCenter, 1.0 );
         mvPosition.xy += treeOffset
             * vec2( length( modelMatrix[0].xyz ), length( modelMatrix[1].xyz ) );
         gl_Position = projectionMatrix * mvPosition;`);
  };
  material.needsUpdate = true;
}

/** The far card: a quad the tree's height tall and its footprint's diagonal
 *  wide, standing on the trunk base, turned about Y toward the camera,
 *  showing the strip frame nearest the camera's azimuth. `bounds` are `.tm`
 *  order and handedness (see extract_tree_billboards.py); the exporter
 *  negates z, and so does the azimuth here.
 *
 *  The width is measured, not read: a frame's alpha spans ~96% of its height
 *  and 55..73% of its width, and drawn square the card came out 1.41x wider
 *  than the same tree's geometry at every bearing (Bocage's EU_Birtch2_M1,
 *  eight azimuths, 2026-09-23) while matching its height to 2%. The XZ
 *  diagonal of the bounding box is the one width that holds the tree from
 *  every azimuth, and it is what the strip's fill implies (17.9 m x 0.71 =
 *  12.7 m against a 12.4 m diagonal). */
function impostorGeometry(entry) {
  const [x0, y0, z0, x1, y1, z1] = entry.bounds;
  const h = y1 - y0;
  const w = Math.hypot(x1 - x0, z1 - z0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -w / 2, y0, 0, w / 2, y0, 0, w / 2, y1, 0, -w / 2, y1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  // A flat quad's sphere already holds every rotation of it about its own
  // centre line: the corners stay hypot(w, h) / 2 from (0, mid, 0).
  geometry.computeBoundingSphere();
  return geometry;
}

function impostorMaterial(texture, frames) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    // The strip's edges are anti-aliased against transparent; half is the
    // coverage the pre-render meant.
    alphaTest: CARD_ALPHA_TEST,
    side: THREE.DoubleSide,
  });
  material.name = 'tree impostor';
  material.customProgramCacheKey = () => `bf-tree-impostor:${frames}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <uv_vertex>',
        `vec3 bfCam = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
         vec2 bfDir = normalize( bfCam.xz + vec2( 1e-6, 0.0 ) );
         vec3 bfRight = vec3( bfDir.y, 0.0, -bfDir.x );
         // .tm azimuth: atan2( x, z_tm ), with z_tm = -z.
         float bfAz = atan( bfDir.x, -bfDir.y );
         // Frame f is the camera at azimuth 45 f: scored in the viewer against
         // the same tree's own geometry from eight bearings (2026-09-23, Bocage
         // birch and asp), phase 0 reaches IoU 0.80 / 0.68 and the previous
         // 180-degree phase 0.56 / 0.55; every other phase and the mirrored
         // sense score between.
         float bfFrame = mod( floor( bfAz / ${EIGHTH_TURN.toFixed(8)} + 0.5 ),
                              ${frames.toFixed(1)} );
         #include <uv_vertex>
         vMapUv.x = ( vMapUv.x + bfFrame ) / ${frames.toFixed(1)};`)
      .replace('#include <begin_vertex>',
        'vec3 transformed = bfRight * position.x + vec3( 0.0, position.y, 0.0 );');
  };
  return material;
}

function loadManifest(mapsBase, bust) {
  let pending = manifestByBase.get(mapsBase);
  if (!pending) {
    pending = fetch(`${mapsBase}/_shared/trees.json${bust()}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(doc => {
        const byName = new Map();
        for (const [name, entry] of Object.entries(doc?.trees || {})) {
          if (entry?.file && entry.distance > 0 && entry.bounds?.length === 6) {
            byName.set(name.toLowerCase(), entry);
          }
        }
        return byName;
      });
    manifestByBase.set(mapsBase, pending);
  }
  return pending;
}

function loadStrip(url, texLoader, maxAnisotropy) {
  let tex = textureByUrl.get(url);
  if (!tex) {
    tex = texLoader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = maxAnisotropy || 1;
    textureByUrl.set(url, tex);
  }
  return tex;
}

const camPos = new THREE.Vector3();

function installHook(scene, state) {
  if (scene.userData.treeFoliage) {
    scene.userData.treeFoliage.state = state;
    return;
  }
  const hook = { state };
  scene.userData.treeFoliage = hook;
  const previous = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sceneArg, camera, target) {
    if (typeof previous === 'function') previous.call(this, renderer, sceneArg, camera, target);
    const trees = hook.state?.trees;
    if (!trees?.length) return;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    for (const tree of trees) {
      const e = tree.group.matrixWorld.elements;
      const dx = e[12] - camPos.x, dy = e[13] - camPos.y, dz = e[14] - camPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // 1 this side of the band, 0 past it, the fade between.
      const fade = d <= tree.fadeStart ? 1
        : d >= tree.fadeEnd ? 0
        : 1 - (d - tree.fadeStart) / (tree.fadeEnd - tree.fadeStart);
      if (fade === tree.fade) continue;
      tree.fade = fade;
      const nearOn = fade > 0;
      if (nearOn !== tree.nearOn) {
        tree.nearOn = nearOn;
        for (const mesh of tree.near) mesh.visible = nearOn;
      }
      tree.impostor.visible = fade < 1;
      if (fade < 1) setCardOpacity(tree.impostor.material, 1 - fade);
    }
  };
}

/** The tree group a part mesh hangs off, and its geometry template name. */
function treeOf(mesh) {
  const group = mesh.parent;
  if (!group) return null;
  const name = group.userData?.geometry
    || group.userData?.control
    || (group.name || '').replace(/_\d+$/, '');
  return { group, name: String(name || '').toLowerCase() };
}

/**
 * Bind every TreeMesh under `root`: sprite cards face the camera from here,
 * and once the mod's strip manifest arrives each tree with a billboard gets
 * its far card. Call after the material passes (`bindDynamicShading` and the
 * lightmap bind rebuild materials, and a rebuilt material has no patch) and
 * after `indexScene` has frozen the statics; the impostor computes its own
 * world matrix once, as a frozen child would never get one.
 */
export function bindTreeFoliage(root, { scene, mapsBase, bust = () => '', texLoader, maxAnisotropy = 1 }) {
  const state = { trees: [], generation: (scene.userData.treeFoliage?.state?.generation || 0) + 1 };
  installHook(scene, state);
  const groups = new Map();
  let sprites = 0;
  root.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const part = mats.find(m => m && TREE_PART.test(m.name || ''));
    if (!part) return;
    const tree = treeOf(obj);
    if (!tree) return;
    let rec = groups.get(tree.group);
    if (!rec) {
      rec = { group: tree.group, name: tree.name, near: [] };
      groups.set(tree.group, rec);
    }
    rec.near.push(obj);
    for (const m of mats) {
      if (!m || !SPRITE_MATERIAL.test(m.name || '')) continue;
      if (attachSpriteAttributes(obj.geometry)) {
        patchSpriteMaterial(m);
        sprites++;
      }
    }
  });
  if (!groups.size) return Promise.resolve({ trees: 0, sprites: 0, impostors: 0 });

  return loadManifest(mapsBase, bust).then(manifest => {
    // A later level bound the scene while the manifest was in flight.
    if (scene.userData.treeFoliage?.state !== state) return { trees: groups.size, sprites, impostors: 0 };
    const geometries = new Map();
    const materials = new Map();
    let impostors = 0;
    for (const rec of groups.values()) {
      const entry = manifest.get(rec.name);
      if (!entry) continue;
      let geometry = geometries.get(entry);
      if (!geometry) { geometry = impostorGeometry(entry); geometries.set(entry, geometry); }
      let material = materials.get(entry);
      if (!material) {
        const tex = loadStrip(`${mapsBase}/_shared/${entry.file}${bust()}`, texLoader, maxAnisotropy);
        material = impostorMaterial(tex, entry.frames || 8);
        materials.set(entry, material);
      }
      // The tree's own card material: `Material.clone` keeps the map and
      // flags but drops `onBeforeCompile` and the cache key, so both are
      // carried across by hand.
      const cardMaterial = material.clone();
      cardMaterial.onBeforeCompile = material.onBeforeCompile;
      cardMaterial.customProgramCacheKey = material.customProgramCacheKey;
      const impostor = new THREE.Mesh(geometry, cardMaterial);
      impostor.name = `${rec.group.name} billboard`;
      impostor.userData.treeImpostor = true;
      impostor.visible = false;
      impostor.matrixAutoUpdate = false;
      rec.group.add(impostor);
      // Statics are frozen by now (no automatic world-matrix walk reaches a
      // new child), so the card's world matrix is composed here, once.
      impostor.updateMatrixWorld(true);
      state.trees.push({
        group: rec.group, near: rec.near, impostor, fade: 1, nearOn: true,
        fadeStart: entry.distance * (1 - FADE_SPAN / 2),
        fadeEnd: entry.distance * (1 + FADE_SPAN / 2),
      });
      impostors++;
    }
    return { trees: groups.size, sprites, impostors };
  });
}
