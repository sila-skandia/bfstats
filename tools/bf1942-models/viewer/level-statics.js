// The level's statics: the scene indexed once per level (the spawners
// group, the parked vehicles, the collision nodes hidden), the per-object
// LOD chains the exporter ships lifted onto `THREE.LOD` (Gap 11), the static
// subtrees frozen out of three's per-frame matrix walk, and the draw-distance
// cull. Out of level-load.js; `show()` indexes each level through it.

import * as THREE from 'three';

export function isCollision(obj) {
  return Boolean(obj.userData?.collision) || /collision/i.test(obj.name || '');
}

/**
 * Build a `THREE.LOD` out of an exporter chain: the geometry's own LOD rungs
 * (each carrying `extras.lod = { geometry, level, distance }`) are detached
 * from the part node and re-parented under a LOD inserted in the part's
 * place, with the part's own LOD0 mesh as level 0 at distance 0. Distances
 * are the geometry's authored `setLodDistance` metres when the exporter had a
 * table (1,133 vanilla geometries declare one) and the census fallback curve
 * otherwise (`FALLBACK_LOD_DISTANCES` in bf42/assemble.py, 0/15/35/60/100/200).
 *
 * Runs on the whole subtree, because a placed vehicle nests several meshed
 * parts (hull, turret, tracks, wheels) and each carries its own chain. All
 * of this happens after the material passes and before `freezeStatics`, so
 * the LOD sees the final materials and the freeze sees the final tree.
 */
function buildLodLevels(lodNode, partNode, seen) {
  const levels = [];
  // The part node is level 0 by definition: the exporter keeps LOD 0 on the
  // placement's own mesh (untagged, under its plain name) and hangs the
  // emitted rungs (extras.lod.level >= 1) beneath it. A part with no rung
  // children gets no LOD at all and keeps today's behaviour exactly.
  levels.push({ object: partNode, distance: 0 });
  for (const child of [...partNode.children]) {
    const info = child.userData?.lod;
    if (!info || seen.has(info)) continue;
    seen.add(info);
    levels.push({ object: child, distance: Number(info.distance) || 0 });
    partNode.remove(child);
  }
  if (levels.length < 2) return false;
  levels.sort((a, b) => a.distance - b.distance);
  for (const level of levels) lodNode.addLevel(level.object, level.distance);
  return true;
}

/**
 * Swap every exporter chain in the scene for a `THREE.LOD`: a part node that
 * carries LOD rungs (its own `extras.lod` plus `_lod<N>` children) gets a LOD
 * spliced in where the node stands — same parent, same local transform — with
 * the part as level 0 and the rungs as the farther levels. Vehicles nest
 * several meshed parts (hull, turret, tracks, wheels) and each carries its
 * own chain, hence the whole-subtree walk. After the material passes (the
 * LOD's rungs must carry the bound materials) and before `freezeStatics`
 * (the freeze must see the final tree); `seen` keeps one rung — the same
 * shared node can only ever hang under one parent, and the guard turns a
 * duplicate visit into a no-op rather than a second LOD fighting for it.
 */
function liftLods(root) {
  // Candidates are collected before any mutation: `traverse` walks a live
  // snapshot of `children`, and `parent.add(lod)` (or an `addLevel` that
  // re-parents a rung) inside the walk would revisit nodes and nest LODs
  // inside LODs. Two passes: find the part nodes, then splice.
  const parts = [];
  // The owner of a chain is the part node the rungs hang beneath: the
  // exporter keeps LOD 0 on the placement's own mesh node (no lod extras —
  // everything that names a mesh today still reads it) and emits only the
  // farther levels as children tagged `extras.lod.level >= 1`. A rung is
  // never a chain owner of its own, and a node without rung children is
  // untouched.
  root.traverse(obj => {
    if (obj.children?.some(c => c.userData?.lod && c.userData.lod.level > 0)) {
      parts.push(obj);
    }
  });
  const seen = new Set();
  const inserted = [];
  for (const obj of parts) {
    // Capture the parent first: `buildLodLevels` runs `addLevel(partNode)`
    // below, which re-parents the part node under the LOD — reading
    // `obj.parent` afterwards would find the LOD itself.
    const parent = obj.parent;
    if (!parent) continue;          // a collected part that lost its parent
    const lod = new THREE.LOD();
    if (!buildLodLevels(lod, obj, seen)) continue;
    lod.name = `${obj.name || 'part'}_LOD`;
    lod.position.copy(obj.position);
    lod.quaternion.copy(obj.quaternion);
    lod.scale.copy(obj.scale);
    parent.add(lod);
    // The LOD takes the part's slot in its parent; the part itself is inside
    // it already (`addLevel` re-parented it).
    inserted.push(lod);
  }
  return inserted;
}

export function kindOf(obj) {
  return obj.userData?.kind || '';
}

/**
 * Built once by `createLevel` (level-load.js). `page` hands in what it reads,
 * as getters (a value the level reassigns is read live):
 * `camera`, `drawDistance`, `extras`, `levelClips`, `optEntire`,
 * `optVehicles`, `templateNameOf`, `world`.
 */
export function createLevelStatics(page) {
  const statics = {};
  const cull = [];
  statics.spawnersRoot = null;
  // The level's vehicles as `indexScene` found them under `spawners`. The live
  // group is not that list: `Vehicle`'s constructor reparents a hull onto the
  // level root the moment anyone drives it, and nothing puts it back, so a map
  // that walked `spawnersRoot.children` lost every jeep a bot had ever taken.
  // Respawn reuses the same node, so the list holds for the level's lifetime.
  statics.mapVehicles = [];

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
    statics.spawnersRoot = null;
    statics.mapVehicles = [];
    root.traverse(obj => {
      if (isCollision(obj)) obj.visible = false;
    });
    root.updateMatrixWorld(true);
    root.traverse(obj => {
      if (obj === root) return;
      if (kindOf(obj) === 'spawners' || obj.name === 'spawners') {
        statics.spawnersRoot = obj;
      }
    });
    if (statics.spawnersRoot) statics.mapVehicles = [...statics.spawnersRoot.children];
    for (const child of root.children) {
      if (child === statics.spawnersRoot) {
        for (const vehicle of child.children) tagCull(vehicle);
        continue;
      }
      if (kindOf(child) === 'water') continue;
      tagCull(child);
      cull.push(child);
    }
    tagVehicleControlPoints();
    // The LODs go up before the cull spheres are read: `Box3.setFromObject`
    // walks invisible children too, so a rung hidden by a distance switch
    // would not change the sphere, but the swap itself must happen inside the
    // frozen subtree the same pass builds.
    statics.lodCount = liftLods(root).length;
    flattenCull();
    freezeStatics(root);
  }

  /** Associate parked hulls with the authored capture zone nearest their pad. */
  function tagVehicleControlPoints() {
    if (!statics.spawnersRoot || !Array.isArray(page.extras?.controlPoints)) return;
    const points = page.extras.controlPoints;
    const spawns = Array.isArray(page.extras.objectSpawns) ? page.extras.objectSpawns : [];
    const scratch = new THREE.Vector3();
    for (const vehicle of statics.spawnersRoot.children) {
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
  statics.cullFlat = {
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
    statics.cullFlat = { x, y, z, r };
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
  statics.frozenCount = 0;
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
    for (let n = node; n; n = n.parent) if (n.parent === statics.spawnersRoot) return n;
    return null;
  }
  // The subtree a ride thaws and a parking freezes. A seat being driven is not
  // under `spawners` any more: `Vehicle`'s constructor (flight.js; wheeled-vehicle.js
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
    // A hull destroyed in the air is still being flown by the wreck's own tick
    // (`vehicle-wrecks.js`): freezing it swaps `updateMatrixWorld` for a no-op,
    // and the fall would then be drawn where the kill left it.
    if (vehicle && vehicle.userData?.fallingWreck) return;
    if (vehicle && !neverFrozen.has(vehicle)) freeze(vehicle);
  }
  /** Take every level subtree that nothing animates out of the per-frame
   *  matrix walk. Runs once per level, after `root.updateMatrixWorld(true)`
   *  has composed everything where the extract put it. */
  function freezeStatics(root) {
    // What moves: bones and skinned cloth (the flags), input-driven `rig`
    // parts, and any node an ambient clip targets, with its ancestors.
    const animated = new Set();
    for (const clip of page.levelClips) {
      for (const track of clip.tracks) {
        const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
        const node = THREE.PropertyBinding.findNode(root, nodeName);
        for (let n = node; n && n !== root; n = n.parent) animated.add(n);
      }
    }
    const moves = obj => obj.isBone || obj.isSkinnedMesh
      || !!obj.userData?.rig || animated.has(obj);
    statics.frozenCount = 0;
    root.matrixAutoUpdate = false;
    for (const child of root.children) {
      if (child === statics.spawnersRoot) {
        child.matrixAutoUpdate = false;
        // Every parked vehicle, rigs and all: none of it moves until someone
        // climbs in, and setPilot thaws the one they climb into. Except the
        // ones a clip keeps moving while parked.
        for (const vehicle of child.children) {
          if (animated.has(vehicle)) { neverFrozen.add(vehicle); continue; }
          freeze(vehicle);
          statics.frozenCount++;
        }
        continue;
      }
      let dynamic = false;
      child.traverse(obj => { if (moves(obj)) dynamic = true; });
      if (dynamic) continue;
      freeze(child);
      statics.frozenCount++;
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
    const limit = page.drawDistance();
    // The static half runs off `cullFlat` (see `flattenCull`): no `userData`
    // lookup, no `Vector3`, and `.visible` written only when it flips, which on
    // a walking frame is a handful of the 814 rather than all of them. The test
    // itself is the old `inRange` arithmetic unchanged, in doubles.
    // `indexScene` is the only writer of either, and it rebuilds both together;
    // this is the assertion that says so out loud rather than reading `undefined`
    // out of a short array and hiding half a level.
    if (statics.cullFlat.x.length !== cull.length) flattenCull();
    const { x, y, z, r } = statics.cullFlat;
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
    if (!statics.spawnersRoot) return;
    statics.spawnersRoot.visible = page.optVehicles.checked;
    if (!page.optVehicles.checked) return;
    for (const vehicle of statics.spawnersRoot.children) {
      vehicle.visible = vehicleSpawnActive(vehicle)
        && (entire || inRange(vehicle, cam, limit));
    }
  }

  Object.assign(statics, {
    applyVisibility,
    cull,
    flattenCull,
    freezeVehicle,
    indexScene,
    tagCull,
    thaw,
    thawVehicle,
    vehicleSpawnActive,
  });
  return statics;
}
