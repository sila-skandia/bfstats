// The level's statics: the scene indexed once per level (the spawners
// group, the parked vehicles, the collision nodes hidden), the per-object
// LOD chains the exporter ships lifted onto `THREE.LOD` (Gap 11), the static
// subtrees frozen out of three's per-frame matrix walk, and the draw-distance
// cull. Out of level-load.js; `show()` indexes each level through it.

import * as THREE from 'three';
import { SpawnerPad, calcSpawnDelay, padControlPoint } from './deployables.js';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';

export function isCollision(obj) {
  return Boolean(obj.userData?.collision) || /collision/i.test(obj.name || '');
}

/**
 * Build a `THREE.LOD` out of an exporter chain: the geometry's own LOD rungs
 * (each carrying `extras.lod = { geometry, level, distance }`) are detached
 * from the part node and re-parented under a LOD inserted in the part's
 * place, with the part's own LOD0 mesh as level 0 at distance 0. Distances
 * are the engine's table: the geometry's authored `setLodDistance` metres
 * over the template constructor's 150 m steps (`DEFAULT_LOD_DISTANCES` in
 * bf42/assemble.py). The exporter ships only the rungs the client keeps
 * (`retail_lod_chain`), so a chain here is already the game's.
 *
 * Runs on the whole subtree, because a placed vehicle nests several meshed
 * parts (hull, turret, tracks, wheels) and each carries its own chain. All
 * of this happens after the material passes and before `freezeStatics`, so
 * the LOD sees the final materials and the freeze sees the final tree.
 */
function buildLodLevels(lodNode, partNode, seen) {
  // The rungs move under the LOD; the part does NOT. Its local transform is
  // load-bearing — vehicle rigs pose turret, wheels and propeller through it
  // (`applyRig` writes `part.node.quaternion` off a captured base) — and its
  // parent link is what the vehicle code reparents, so the LOD is a sibling,
  // not a wrapper. A part with no rung children gets no LOD at all.
  const levels = [];
  for (const child of [...partNode.children]) {
    const info = child.userData?.lod;
    if (!info || seen.has(info)) continue;
    seen.add(info);
    levels.push({ object: child, distance: Number(info.distance) || 0 });
    partNode.remove(child);
  }
  if (!levels.length) return false;
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
function liftLods(root, spawnersRoot) {
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
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  for (const obj of parts) {
    // A parked vehicle's root is a chain owner too (the hull template's own
    // rungs), but `Vehicle` reparents that node onto the level root the
    // moment anyone drives it — a LOD holding its rungs would stay behind at
    // the pad as a ghost shell, and a driven hull would leave its far rungs
    // standing where it spawned. Keep vehicle-root chains unlifted and hide
    // their rungs: parked hulls draw at full detail, exactly as they did
    // before the rungs shipped. The parts INSIDE the vehicle (turret, wheels,
    // propeller) lift normally — their LODs travel with the subtree.
    //
    // The game wraps every spawner vehicle one level deeper than the raw
    // spawner root: spawners -> M3A1 -> lodM3A1 -> M3A1Complex. A parent
    // check against the spawners root therefore misses the chain (measured:
    // M3A1Complex_LOD was spliced anyway), and a lifted root is worse than
    // an unlifted one — the wheels, doors and MG mount are CHILDREN of the
    // root part, so the moment its rung shows, the rig's parts vanish with
    // it (wheels gone at 10-20 m, where their own rungs are not yet due).
    // Walk the ancestors instead: anything under a spawner skips the lift.
    //
    // Building interiors (`*Interior`) skip the lift as well. The engine
    // never applied a geometry's own setLodDistance table to an interior — it
    // ran one interior switch at 70 m — and the interior shell is only ever
    // meant to be seen from inside: its decimated rungs tear straight through
    // the exterior walls when the chain swaps at 15 m (measured: the french
    // farm at 16 m showed rung0, not the shell). Hide the rungs and keep the
    // part; backface culling keeps it invisible from outside, the texture-fade
    // darkness planes handle the doorway sealing, and the draw-distance cull
    // covers the range.
    let underSpawner = false;
    for (let a = obj.parent; a; a = a.parent) {
      if (/spawner/i.test(a.name || '')) { underSpawner = true; break; }
    }
    if (underSpawner || /Interior(_\d+)?$/i.test(obj.name || '')) {
      for (const child of [...obj.children]) {
        if (child.userData?.lod) child.visible = false;
      }
      continue;
    }
    // Capture the parent first: nothing below re-parents the part, but the
    // rung `remove`s run against it and the guard keeps the slot explicit.
    const parent = obj.parent;
    if (!parent) continue;          // a collected part that lost its parent
    const lod = new THREE.LOD();
    // The LOD takes the part's local transform and sits beside it — both
    // children of the same parent — so the LOD's world position IS the part's
    // and the distance test measures the part from where the part is. The
    // part itself is never touched.
    lod.position.copy(obj.position);
    lod.quaternion.copy(obj.quaternion);
    lod.scale.copy(obj.scale);
    if (!buildLodLevels(lod, obj, seen)) continue;
    lod.name = `${obj.name || 'part'}_LOD`;
    parent.add(lod);
    // The stock `LOD.update` only toggles the levels it owns, so extend it:
    // the part is the implicit level 0 and yields to the first rung past its
    // threshold; the rungs yield back inside it. Hysteresis stays at its
    // default 0 — nothing here sets one.
    const part = obj;
    lod.update = function (camera) {
      v1.setFromMatrixPosition(camera.matrixWorld);
      v2.setFromMatrixPosition(this.matrixWorld);
      const distance = v1.distanceTo(v2) / camera.zoom;
      let showing = -1;
      for (let i = 0; i < this.levels.length; i++) {
        if (distance >= this.levels[i].distance) showing = i;
        else break;
      }
      this._currentLevel = showing + 1;
      part.visible = showing === -1;
      for (let i = 0; i < this.levels.length; i++) {
        this.levels[i].object.visible = i === showing;
      }
    };
    inserted.push(lod);
  }
  return inserted;
}

export function kindOf(obj) {
  return obj.userData?.kind || '';
}

/** The template a placed node stands for: its `control` tag (GLTFLoader
 *  suffixes a repeated scene name, `Sherman_1`), else its name. */
function padTemplateOf(node) {
  return String(node?.userData?.control || node?.name || '').replace(/_\d+$/, '');
}

function isKitNode(node) {
  return node?.userData?.templateKind?.toLowerCase?.() === 'kit';
}

function findSpawnersRoot(root) {
  let found = null;
  root?.traverse?.(obj => {
    if (!found && obj !== root && (kindOf(obj) === 'spawners' || obj.name === 'spawners')) found = obj;
  });
  return found;
}

/** The sides that can ever hold a pad (ledger SPAWN-12): both at a point that
 *  changes hands, the point's own at one that cannot, none for a pad filed
 *  under no point (it spawns its own `Object.setTeam` entry all round). */
function padSides(spawn, points, anyOsId) {
  const name = padControlPoint(spawn, points, anyOsId);
  if (!name) return null;
  const point = points.find(p => p?.name === name);
  if (!point) return null;
  if (point.unableToChangeTeam) return point.team === 1 || point.team === 2 ? [point.team] : [];
  return [1, 2];
}

const _padAt = new THREE.Vector3();

/** The level's own node for a pad: a spawners child of the pad's template,
 *  the nearest one to the pad within `reach` metres, and not one another pad
 *  has `claimed`. */
function bakedPadNode(spawners, spawn, reach = 3, claimed = null) {
  const want = String(spawn?.vehicle ?? '').toLowerCase();
  const p = spawn?.position;
  if (!want || !Array.isArray(p) || p.length !== 3) return null;
  let best = null;
  let bestD = reach;
  for (const child of spawners.children) {
    if (child.userData?.padVariant || isKitNode(child) || claimed?.has(child)) continue;
    if (padTemplateOf(child).toLowerCase() !== want) continue;
    child.getWorldPosition(_padAt);
    const d = Math.hypot(_padAt.x - p[0], _padAt.y - p[1], _padAt.z - p[2]);
    if (d < bestD) { best = child; bestD = d; }
  }
  return best;
}

/**
 * The other side's vehicle for every pad that hands out a different template
 * per side, added to the level's spawners group beside the one the level
 * baked, at the same pose. The bake places one vehicle per pad, the one of
 * the placement's own team; a pad at a flag that changes hands spawns the
 * holder's (ledger SPAWN-2, SPAWN-12), so the holder's template is loaded
 * from the models tree here, before anything indexes the scene, and the pad
 * records (`indexScene`) choose which node stands on the pad. The node is
 * the model glb's root, which is the scene's pad node less its LOD rungs (a
 * parked hull draws at full detail anyway, `liftLods`) and its `spawner`
 * stamp, copied from the baked one.
 *
 * `load(template)` resolves to a parsed glTF, or null; a template that does
 * not load leaves its pad with the baked vehicle, as before (warned once).
 * Returns the nodes added.
 */
export async function loadPadVariants(root, extras, { load = null } = {}) {
  const spawns = extras?.objectSpawns;
  const spawners = findSpawnersRoot(root);
  if (!load || !spawners || !Array.isArray(spawns)) return [];
  const points = Array.isArray(extras.controlPoints) ? extras.controlPoints : [];
  const anyOsId = spawns.some(s => Number.isFinite(s?.osId));
  root.updateMatrixWorld(true);
  const wanted = [];
  spawns.forEach((spawn, index) => {
    if (!spawn?.templates) return;
    const sides = padSides(spawn, points, anyOsId);
    if (!sides?.length) return;
    const baked = bakedPadNode(spawners, spawn);
    if (!baked) return;
    const have = new Set([padTemplateOf(baked).toLowerCase()]);
    for (const team of sides) {
      const name = spawn.templates[String(team)];
      if (!name || have.has(name.toLowerCase())) continue;
      have.add(name.toLowerCase());
      wanted.push({ index, baked, template: name });
    }
  });
  const loads = new Map();
  for (const { template } of wanted) {
    const key = template.toLowerCase();
    if (!loads.has(key)) {
      loads.set(key, Promise.resolve().then(() => load(template)).catch(error => {
        console.warn(`[pads] ${template}: ${error?.message ?? error}`);
        return null;
      }));
    }
  }
  const added = [];
  // The model's root, once per template: the first pad takes it out of its
  // glTF scene, the others take clones of it.
  const sources = new Map();
  const used = new Set();
  for (const { index, baked, template } of wanted) {
    const key = template.toLowerCase();
    if (!sources.has(key)) {
      const scene = (await loads.get(key))?.scene ?? null;
      sources.set(key, scene?.children?.find(c => c.userData?.armor || c.userData?.templateKind)
        ?? scene?.children?.[0] ?? null);
    }
    const source = sources.get(key);
    if (!source) {
      console.warn(`[pads] no model for ${template}: its pads keep ${padTemplateOf(baked)}`);
      continue;
    }
    // A track is a skinned mesh: a plain clone would stay bound to the
    // first pad's bones.
    const node = used.has(source) ? skeletonClone(source) : source;
    used.add(source);
    node.position.copy(baked.position);
    node.quaternion.copy(baked.quaternion);
    node.scale.copy(baked.scale);
    if (baked.userData?.spawner) node.userData.spawner = structuredClone(baked.userData.spawner);
    node.userData.control ??= template;
    node.userData.padVariant = true;
    node.userData.objectSpawn = index;
    baked.parent.add(node);
    node.updateMatrixWorld(true);
    added.push(node);
  }
  if (added.length) console.log(`[pads] ${added.length} other-side vehicles added`);
  return added;
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
    // The LODs go up before the cull spheres are tagged: each splice leaves a
    // part AND a LOD wrapper at the top level (both children of the same
    // parent), and both need their own distance test — the part draws below
    // the first rung threshold, the wrapper's rungs beyond it. `Box3
    // .setFromObject` walks invisible children too, so the vehicle roots'
    // hidden rungs do not distort their spheres. The swap itself must happen
    // inside the frozen subtree the same pass builds.
    statics.lodCount = liftLods(root, statics.spawnersRoot).length;
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
    buildVehiclePads();
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
      // The other side's vehicle on a pad is filed under its pad's own entry.
      if (vehicle.userData?.padVariant) {
        vehicle.userData.controlPointName = spawns[vehicle.userData.objectSpawn]?.controlPointName ?? null;
        continue;
      }
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

  // --- the vehicle pads ------------------------------------------------------
  //
  // Each `objectSpawns` entry with a node in the spawners group is one
  // `SpawnerPad` (deployables.js), the engine's ObjectSpawner law: the side
  // that holds the pad's flag picks the template (SPAWN-2, SPAWN-12), a flag
  // that opens neutral leaves its pads on their own side (SPAWN-19) and one
  // that goes neutral switches them off, the delay counts from a hull's destruction
  // and is drawn by `calcSpawnDelay` (SPAWN-10, SPAWN-11, SPAWN-18), and a hull
  // already spawned is never touched by the flag (SPAWN-19). `nodes` holds one node per
  // template the pad can hand out: the level's baked one and the other side's
  // (`loadPadVariants`), all at the pad's pose. `live` is the nodes standing
  // in the world: the one the pad spawned last and any wreck of an earlier one
  // not yet cleared. The ticking is `vehicle-wrecks.js`', which knows what is
  // alive, destroyed and wrecked; `stepVehiclePads` takes its answers.

  statics.pads = [];
  let padRecords = new WeakMap();
  let padsWorld = null;

  /** The pad a spawners child stands on, or null. */
  function padOf(node) {
    return padRecords.get(node) ?? null;
  }

  /** The side holding a control point now: its flag's live team, else the
   *  level's (a point that is no flag never changes hands); null for no point. */
  function pointTeam(record) {
    if (!record.point) return null;
    if (padsWorld !== page.world) {
      padsWorld = page.world;
      for (const r of statics.pads) r.flag = undefined;
    }
    if (record.flag === undefined) {
      record.flag = page.world?.flags?.find(f => f.controlPointName === record.point) ?? null;
    }
    if (record.flag) return record.flag.team ?? 0;
    const point = page.extras?.controlPoints?.find(p => p?.name === record.point);
    return point ? (point.team ?? 0) : null;
  }

  /** `ControlPoint::init` / `gotControl` / `lostControl` on the pads filed
   *  under the point (SPAWN-12). A decree that jumps sides goes through
   *  neutral, as the engine always does. A point that opens neutral leaves
   *  its pads alone (`init` runs `control(0)` only for a side, SPAWN-19): a
   *  pad with its own `Object.setTeam` side spawns that side's template from
   *  the first frame, and one with none has team 0 and spawns nothing, so it
   *  is switched off here rather than given the baked vehicle (SPAWN-2). */
  function followPoint(record) {
    const team = pointTeam(record);
    if (team == null) return;
    if (team !== record.held) {
      if (record.held === 1 || record.held === 2) record.pad.disable(0);
      if (team === 1 || team === 2) record.pad.enable(team);
      else if (record.held == null && record.pad.team !== 1 && record.pad.team !== 2) record.pad.disable(0);
      record.held = team;
      record.switchedOff = false;
    }
    // The point switched off while it keeps its side (`CPDisable` from
    // `disableWhenLosingControl` or `disableIfEnemyInsideRadius`, ledger
    // SPAWN-22) gives its pads its team and stops them; `CPEnable` starts
    // them again. A point that never says so leaves them as the side has them.
    const off = (team === 1 || team === 2) && record.flag?.spawnsEnabled === false;
    if (off !== !!record.switchedOff) {
      if (off) record.pad.disable(team); else record.pad.enable(team);
      record.switchedOff = off;
    }
  }

  /** The node a pad's spawn of `template` stands up. A template whose model
   *  did not load keeps the level's baked vehicle, as before. */
  function padNode(record, template) {
    const node = record.nodes.get(String(template).toLowerCase());
    if (node) return node;
    if (!record.warned) {
      record.warned = true;
      console.warn(`[pads] ${record.spawn.spawner}: no ${template} loaded, keeping ${padTemplateOf(record.baked)}`);
    }
    return record.baked;
  }

  function buildVehiclePads() {
    statics.pads = [];
    padRecords = new WeakMap();
    padsWorld = null;
    const spawns = page.extras?.objectSpawns;
    const spawners = statics.spawnersRoot;
    if (!spawners || !Array.isArray(spawns)) return;
    const points = Array.isArray(page.extras.controlPoints) ? page.extras.controlPoints : [];
    const anyOsId = spawns.some(s => Number.isFinite(s?.osId));
    const variants = new Map();
    for (const child of spawners.children) {
      const index = child.userData?.objectSpawn;
      if (!child.userData?.padVariant || !Number.isInteger(index)) continue;
      if (!variants.has(index)) variants.set(index, []);
      variants.get(index).push(child);
    }
    const claimed = new Set();
    spawns.forEach((spawn, index) => {
      const baked = bakedPadNode(spawners, spawn, 3, claimed);
      if (!baked) return;
      claimed.add(baked);
      const nodes = new Map([[padTemplateOf(baked).toLowerCase(), baked]]);
      for (const node of variants.get(index) ?? []) nodes.set(padTemplateOf(node).toLowerCase(), node);
      // A pad filed under no point spawns its placement's entry. One with no
      // side of its own keeps the vehicle the exporter baked for it, the
      // `vehicles[2] or vehicles[1]` divergence SPAWN-2 records.
      const team = Number.isInteger(spawn.team) ? spawn.team : 0;
      const templates = { ...(spawn.templates ?? { 1: spawn.vehicle, 2: spawn.vehicle }) };
      if (team !== 1 && team !== 2) templates[String(team)] = spawn.vehicle;
      const pad = new SpawnerPad({
        templates, team,
        minSpawnDelay: spawn.minSpawnDelay, maxSpawnDelay: spawn.maxSpawnDelay,
        spawnDelayAtStart: spawn.spawnDelayAtStart,
      });
      baked.getWorldPosition(_padAt);
      const record = {
        spawn, index, pad, baked, nodes, live: new Set(),
        point: padControlPoint(spawn, points, anyOsId), held: null, flag: undefined,
        at: [_padAt.x, _padAt.y, _padAt.z],
        // The first delay is drawn on the round's first tick, with its
        // players in (`stepVehiclePads`): the bake stands for that frame's
        // spawn, done here so the scene is right before anything is built.
        firstDraw: true,
      };
      pad.reset();
      followPoint(record);
      pad.tick(0, {
        alive: node => record.live.has(node),
        critical: () => false,
        distance: () => 0,
        spawn: template => {
          const node = padNode(record, template);
          record.live.add(node);
          return node;
        },
      });
      for (const node of nodes.values()) padRecords.set(node, record);
      // What `ObjectSpawner::reset` puts back at a restart (`+0x138`, the
      // team the pre-game gave it; on or off as the round opened).
      record.restart = { team: pad.team, active: pad.active, held: record.held };
      statics.pads.push(record);
    });
  }

  /**
   * `restartMap`'s `ObjectSpawner::reset` (0x08314880) on every vehicle pad
   * (ledger ROUND-10): the slots empty, the team the pre-game gave it, on as
   * the round opened, and the delay -1 or, with `spawnDelayAtStart`, drawn
   * again for the server as it stands (the status is EndGame, so no `setTeam`
   * cancels it, SPAWN-21). The hulls are already off the field
   * (`vehicle-wrecks.js` `clearWorld`); each pad stands a fresh one up on its
   * own spot on its next frame. The page puts the points back first, as
   * `restartMap` runs `ControlPoint::reset` before it.
   */
  function restartVehiclePads({ players = 0, maxPlayers = 0 } = {}) {
    for (const record of statics.pads) {
      const { pad } = record;
      pad.reset({ players, maxPlayers });
      const start = record.restart ?? {};
      if (start.team != null) pad.team = start.team;
      if (start.active != null) pad.active = start.active;
      record.held = start.held ?? record.held;
      record.switchedOff = false;
      record.firstDraw = false;
      record.live.clear();
    }
  }

  /**
   * One frame of every vehicle pad. `world` is the wreck side's:
   * `alive(node)` (it stands in the world, a wreck included), `destroyed(node)`
   * (its Armor's `isDestroyed`, what the pad's `critical` hook asks, SPAWN-11),
   * `position(node)` -> [x, y, z], `destroy(node)` (a wreck on the pad goes
   * now), `spawn(node)` -> whether a fresh hull now stands there, and
   * `players` / `maxPlayers` for the delay's draw.
   */
  function stepVehiclePads(dt, world) {
    for (const record of statics.pads) {
      const { pad } = record;
      followPoint(record);
      pad.players = world.players ?? 0;
      pad.maxPlayers = world.maxPlayers ?? 0;
      if (record.firstDraw) {
        record.firstDraw = false;
        if (pad.slots[0] != null) {
          pad.delay = calcSpawnDelay(pad.min, pad.max, pad.players, pad.maxPlayers);
        }
      }
      for (const node of record.live) if (!world.alive(node)) record.live.delete(node);
      pad.tick(dt, {
        alive: node => record.live.has(node),
        critical: node => world.destroyed(node),
        distance: node => {
          const p = world.position(node);
          return p ? Math.hypot(p[0] - record.at[0], p[1] - record.at[1], p[2] - record.at[2]) : Infinity;
        },
        destroy: node => {
          world.destroy(node);
          record.live.delete(node);
        },
        spawn: template => {
          const node = padNode(record, template);
          // One node per template: an earlier one of the same template still
          // standing (its wreck away from the pad, which the engine would
          // leave where it is) has to clear first. The pad tries every frame.
          if (record.live.has(node) || !world.spawn(node)) return null;
          record.live.add(node);
          return node;
        },
      });
    }
  }

  function vehicleSpawnActive(vehicle) {
    // Off the field since the end of the round (`vehicle-wrecks.js`
    // `clearWorld`) until it is stood up again.
    if (vehicle?.userData?.cleared) return false;
    const record = padRecords.get(vehicle);
    if (record) return record.live.has(vehicle);
    // A node no pad entry names (a scene written before `objectSpawns`): the
    // nearest flag's gate it always had.
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
    padOf,
    restartVehiclePads,
    stepVehiclePads,
    tagCull,
    thaw,
    thawVehicle,
    vehicleSpawnActive,
  });
  return statics;
}
