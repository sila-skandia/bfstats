// The ground and what the rounds run into: the terrain queries every other
// part asks (`groundHeight`, `surfaceFriction`, `deckNormal`), the level's
// material and damage tables, and the collider built off the terrain, the sea
// and the tagged collision meshes. Out of level-load.js; `show()` loads the
// tables and builds the collider once per level.

import * as THREE from 'three';
import { buildHeightfield, buildCollisionIndex, buildDrivableMask, WorldCollider } from './collision.js';
import { kindOf } from './level-statics.js';

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `bust`, `effects`, `extras`, `floatPlacedVehicles`, `guns`,
 * `loadEffectLibrary`, `MAPS_BASE`, `rebaseDeckSpawns`,
 * `registerDamageables`, `settlePlacedVehicles`, `spawnersRoot`, `world`.
 */
export function createLevelTerrain(page) {
  const terrain = {};

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
  terrain.terrainMeshes = [];
  const terrainBBox = new THREE.Box3();
  terrain.collider = null;

  function groundHeight(x, z, fromY) {
    const sea = page.extras?.waterLevel ?? -Infinity;
    if (terrain.collider) {
      const h = terrain.collider.surfaceHeight(x, z, fromY);
      if (Number.isFinite(h)) return h;
    }
    if (!terrain.terrainMeshes.length) return sea;
    rayOrigin.set(x, 2000, z);
    groundRay.set(rayOrigin, DOWN);
    groundRay.far = 4000;
    const hit = groundRay.intersectObjects(terrain.terrainMeshes, false)[0];
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
  terrain.materialFrictionById = null;

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
    const table = terrain.materialFrictionById;
    if (!table) return DEFAULT_SURFACE_FRICTION;
    const sea = page.extras?.waterLevel;
    // A wheel on a drivable deck spends the DECK's material, not the riverbed's
    // under it. `fromY` is the same vehicle opt-in `groundHeight` takes, so this
    // costs one extra deck ray per wheel and only while actually on a deck — and
    // without it a tank crossing a bridge over water was gripping at water's 0.1
    // because the surface it was standing on read as being at the sea line.
    const deck = fromY !== undefined ? terrain.collider?.deckSurface?.(x, z, fromY) : null;
    let id = deck ? deck.material : terrain.collider?.heightfield?.material(x, z);
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
    return terrain.collider?.deckNormal ? terrain.collider.deckNormal(x, z, fromY, out) : false;
  }

  function collectTerrain(root) {
    terrain.terrainMeshes = [];
    terrainBBox.makeEmpty();
    root.traverse(obj => {
      if (obj.isMesh && kindOf(obj) === 'terrain') {
        terrain.terrainMeshes.push(obj);
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
      const base = Number.isFinite(page.extras?.waterLevel) ? Math.max(terrainBBox.min.y, page.extras.waterLevel) : terrainBBox.min.y;
      return base + 1.5;
    }
    if (Number.isFinite(page.extras?.waterLevel)) return page.extras.waterLevel + 1.5;
    return -50;
  }

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
  terrain.terrainMaterials = null;
  terrain.damageTables = null;

  async function loadDamageTables(dir) {
    const ref = page.extras?.damage;
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
    const spec = page.extras?.terrain?.materials;
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
    const worldSize = page.extras?.worldSize || 0;
    const heightfield = buildHeightfield(terrain.terrainMeshes, {
      worldSize,
      dim: page.extras?.terrain?.materials?.dim || 0,
    });
    if (heightfield && terrain.terrainMaterials) {
      heightfield.setMaterials(terrain.terrainMaterials.ids, terrain.terrainMaterials.dim,
                               terrain.terrainMaterials.spacing || heightfield.spacing);
    }
    // One owner per placed object, and one per spawned vehicle rather than one
    // for the whole spawner group — otherwise a Sherman's round would pass
    // through the Willy parked next to it.
    const ownerRoots = [];
    for (const child of root.children) {
      if (child === page.spawnersRoot) ownerRoots.push(...child.children);
      else ownerRoots.push(child);
    }
    // Before the index: it bakes every hull where it stands, so the vehicles
    // have to be standing where they will rest. A ship rests at its own draft,
    // which is a closed form rather than a settle, and its deck spawns move with
    // it.
    page.settlePlacedVehicles(ownerRoots, heightfield);
    page.floatPlacedVehicles(ownerRoots, page.extras?.waterLevel);
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
    terrain.collider = (heightfield || statics || Number.isFinite(page.extras?.waterLevel))
      ? new WorldCollider({ heightfield, statics, waterLevel: page.extras?.waterLevel,
                            drivableMask })
      : null;
    page.world.setCollider(terrain.collider);
    page.world.damageTables = terrain.damageTables;
    page.guns.collider = terrain.collider;
    page.guns.damageEffects = terrain.damageTables?.effects || null;
    page.guns.projectileMaterials = terrain.damageTables?.projectiles || null;
    page.guns.materials = terrain.damageTables?.materials || null;
    // The `damageMod` matrix. Without it a round's damage is only its material's
    // base times the distance falloff, which is the same number for a rifle
    // shooting a Tiger as for a Panzerfaust — the modifier is the whole reason
    // small arms do not kill armour.
    page.guns.modifiers = terrain.damageTables?.modifiers || null;
    // Pools and all: a mesh particle's materials are built under the level's
    // lighting, and show() warms a fresh set once this level's fog is up.
    page.effects.flush();
    page.loadEffectLibrary();
    return { heightfield, statics };
  }

  /** The two tables show() fetched for this level, and the friction lookup
   *  `surfaceFriction` walks, built off them once. */
  function setTables(terrainMaterials, damageTables) {
    terrain.terrainMaterials = terrainMaterials;
    terrain.damageTables = damageTables;
    terrain.materialFrictionById = buildMaterialFrictionTable(terrain.damageTables);
  }

  Object.assign(terrain, {
    DEFAULT_SURFACE_FRICTION,
    buildCollider,
    collectTerrain,
    deckNormal,
    getFloorAltitude,
    groundHeight,
    loadDamageTables,
    loadTerrainMaterials,
    setTables,
    surfaceFriction,
  });
  return terrain;
}
