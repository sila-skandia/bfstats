// The human's seated soldier: the seat's own pose animation on the kit's
// body, dressed with the kit's parts, following the seat node, the arms put
// on the wheel or the gun by two-bone IK each frame. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); `seat-ik.js` stays the
// solver and the pose rules.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { collectIkBindings, defaultSeatPoseName, ikTarget, resolveSeatStates, seatBody, seatPoseName, solveTwoBone } from './seat-ik.js';
import { bonePattern, kitsByTemplate, wornGrafts } from './kit-graft.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bust`, `deployKit`, `deployTeamId`, `flags`, `kitLoadout`, `MODELS_BASE`,
 * `occupancy`, `optPilot`, `scene`, `soldierTemplateFor`, `view`.
 */
export function createSeatPose(page) {
  const seatPose = {};
  seatPose.seatSoldier = null;   // the seated soldier pose scene, if one is loaded

  /** Load the seat-pose glb for the active seat, if the seat draws anybody.
   *
   * **Whether an occupant is drawn at all is whether the seat reaches a
   * SeatObject**, and `extras.seat.flags` then says how much of him — see
   * `seat-ik.js`'s `seatBody` for the addresses. A Sherman's driving position
   * declares EntryPoints, a Camera and the turret and no SeatObject, so nobody
   * is drawn there; its hull gunner reaches `ShermanBrowningSeat` with
   * `c_SeatShowHalfBodySoldier`, so the legs are hidden and the torso shows.
   *
   * Which pose is `resolveSeatStates`: the seat's own
   * `seatAnimationUpperBody`/`LowerBody` where it declares them (a Willys
   * passenger's `Ub_PassengerInWilly`), the soldier template's `Ub_SitInVehicle`
   * plus `Lb_SitInVehicle`/`Lb_StandInVehicle` where it does not — which is
   * every driver's seat in the game, and the reason this used to return early
   * and draw nothing.
   *
   * The glb is parented to the global `scene` (not to a node inside the vehicle's
   * tree) to avoid disturbing the VehicleCamera's camera-node lookup, and its
   * world position is synced to the seat node every frame. An AnimationMixer plays
   * the `seat.lower`+`seat.upper` clips the extractor baked in. Visibility
   * follows the camera mode: hidden in cockpit (first-person), shown in every
   * external view (C). */
  const seatPoseLoader = new GLTFLoader();
  seatPose.seatPoseMixer = null;
  seatPose.seatPoseActions = null;
  seatPose.seatPoseTarget = null;   // the seat node whose world pose we follow
  seatPose.seatIkChains = [];       // per-frame arm work, built by `bindSeatIk`
  seatPose.seatPoseGeneration = 0;  // which load is still the current one

  async function loadSeatPose() {
    disposeSeatPose();
    if (!page.occupancy || !page.optPilot.checked) return;
    const mine = ++seatPose.seatPoseGeneration;
    const seat = page.occupancy.seatInfo(page.occupancy.activeSeatId);
    const body = seatBody(seat?.seatObjects);
    if (!body.draw) return;             // no SeatObject: the game draws nobody
    const states = resolveSeatStates(seat.seatObjects);
    const soldierName = page.soldierTemplateFor(
      page.flags.find(f => f.team === page.deployTeamId) || { team: page.deployTeamId });
    const assetFor = name =>
      `${page.MODELS_BASE}/poses/${soldierName}__${name}.pose.glb${page.bust()}`;
    let gltf;
    try {
      gltf = await seatPoseLoader.loadAsync(
        assetFor(seatPoseName(states.upperBody, states.lowerBody)));
    } catch {
      // The seat names a state the game never declared, so no glb was written
      // for it. The engine still draws the occupant — see `defaultSeatPoseName`.
      const fallback = defaultSeatPoseName(body.mask);
      try {
        gltf = await seatPoseLoader.loadAsync(assetFor(fallback));
      } catch {
        return;
      }
    }
    // Leaving the seat, or switching to another, while the glb was in flight:
    // `disposeSeatPose` has already run and this scene must not be adopted, or
    // it hangs in the world for ever with nothing left holding a reference.
    if (mine !== seatPose.seatPoseGeneration) { disposeSeatScene(gltf.scene); return; }
    const soldierScene = gltf.scene;
    try {
      soldierScene.traverse(obj => {
        if (obj.isSkinnedMesh) obj.frustumCulled = false;
      });
      soldierScene.userData.seatPose = true;
      // `c_SeatShowHalfBodySoldier`: the engine hides the pelvis and everything
      // under it rather than swapping in a half model, so the same skinned mesh
      // simply loses its legs. Scaling the bone to nothing is the closest a
      // skinned mesh gets to `disableBoneTree` — `visible = false` on a joint
      // does nothing, because the vertices are drawn by the mesh, not the bone.
      if (body.halfBody) hideBelowPelvis(soldierScene);

    // The SeatObject node (e.g. `WillyPassengerSeat`) is the *sit* position; an
    // EntryPoint is the door where the soldier spawns on enter. Sync to the
    // SeatObject's world pose every frame so the rider moves with the vehicle
    // without polluting the vehicle's node tree (which VehicleCamera traverses).
    seatPose.seatPoseTarget = seat.seatObjects?.[0] || seat.node;
    if (seatPose.seatPoseTarget) {
      seatPose.seatPoseTarget.getWorldPosition(soldierScene.position);
      seatPose.seatPoseTarget.getWorldQuaternion(soldierScene.quaternion);
    } else {
      soldierScene.position.set(0, 0, 0);
    }
    page.scene.add(soldierScene);
    seatPose.seatSoldier = soldierScene;
    seatPose.seatSoldier.visible = !page.view?.firstPerson;
    // The helmet. A BFSoldier template declares a body, a head and two hands and
    // nothing else, so the exported soldier is bare-headed; the helmet belongs
    // to the kit the player deployed with and hangs off bone `A`. The driver in
    // `models-work/willy-hands-wheel.png` is wearing one.
    dressSeatOccupant(soldierScene, seat).catch(err =>
      console.warn('seat kit:', err));

    // Play the lower + upper seat clips the extractor wrote. They are independent
    // state machines (like gaits), so two actions at full weight compose.
    const clips = gltf.animations || [];
    const lowerClip = THREE.AnimationClip.findByName(clips, 'seat.lower');
    const upperClip = THREE.AnimationClip.findByName(clips, 'seat.upper');
    if (lowerClip || upperClip) {
      seatPose.seatPoseMixer = new THREE.AnimationMixer(soldierScene);
      seatPose.seatPoseActions = {};
      if (lowerClip) {
        seatPose.seatPoseActions.lower = seatPose.seatPoseMixer.clipAction(lowerClip);
        seatPose.seatPoseActions.lower.play();
      }
      if (upperClip) {
        seatPose.seatPoseActions.upper = seatPose.seatPoseMixer.clipAction(upperClip);
        seatPose.seatPoseActions.upper.play();
      }
    }
    bindSeatIk(seat, soldierScene, clips);
    } catch (err) {
      console.error('loadSeatPose:', err);
    }
  }

  // `models/kits.json`, fetched once: which worn meshes each kit hangs off which
  // bone. `kits.html` browses the same file; the graft convention itself lives in
  // `kit-graft.js` so both read it from one place.
  seatPose.kitManifest = null;
  const kitPartCache = new Map();

  async function kitsIndex() {
    if (!seatPose.kitManifest) {
      seatPose.kitManifest = fetch(`${page.MODELS_BASE}/kits.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(kitsByTemplate, () => new Map());
    }
    return seatPose.kitManifest;
  }

  async function loadKitPart(glb) {
    if (!kitPartCache.has(glb)) {
      kitPartCache.set(glb, seatPoseLoader
        .loadAsync(`${page.MODELS_BASE}/${glb}${page.bust()}`)
        .then(g => g.scene, () => null));
    }
    return kitPartCache.get(glb);
  }

  /** Hang the deploy kit's worn meshes on the seated soldier's own bones.
   *
   * Only the seated occupant for now: the spawn-pad soldiers and the on-foot
   * player load the same bare pose glbs and are bare-headed too, and dressing
   * all three is the same call in three more places once someone wants it. */
  async function dressSeatOccupant(soldierScene, seat) {
    const index = await kitsIndex();
    const { kit: kitName } = page.kitLoadout(page.deployTeamId, page.deployKit);
    const kit = kitName && index.get(String(kitName).toLowerCase());
    if (!kit) return;
    for (const graft of wornGrafts(kit)) {
      // The seat may have been left while the part was in flight.
      if (soldierScene !== seatPose.seatSoldier) return;
      const source = await loadKitPart(graft.glb);
      if (!source || soldierScene !== seatPose.seatSoldier) return;
      const bone = findBoneMatching(soldierScene, graft.bone);
      if (!bone) continue;          // no such bone on this figure: silently bare
      const node = source.clone(true);
      node.quaternion.set(...graft.quaternion);
      node.position.set(...graft.position);
      node.userData.seatKitPart = true;
      node.traverse(obj => { if (obj.isMesh) obj.frustumCulled = false; });
      bone.add(node);
    }
  }

  /** `c_SeatShowHalfBodySoldier` — `setUseSeat` hides `Bip01 Pelvis` and its
   *  subtree. */
  function hideBelowPelvis(soldierScene) {
    const pelvis = findBone(soldierScene, 'Bip01 Pelvis');
    if (pelvis) pelvis.scale.setScalar(1e-4);
  }

  /** A bone by name, tolerant of the underscore/space spellings the data mixes. */
  const boneKey = name => String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();
  function findBone(root, name) {
    const want = boneKey(name);
    let found = null;
    root.traverse(obj => { if (!found && boneKey(obj.name) === want) found = obj; });
    return found;
  }

  /** The same, for a bone the kit manifest names (`A`, `backpack`, `HipPack`). */
  function findBoneMatching(root, want) {
    const pattern = bonePattern(want);
    let found = null;
    root.traverse(obj => { if (!found && pattern.test(obj.name)) found = obj; });
    return found;
  }

  /** Build the per-frame IK work for one seat: every `extras.skeletonIK` node
   *  this seat owns, paired with the arm chain it drives.
   *
   * Scoped by the same `control` tag `surveyVehicle` buckets seats with, so a
   * Sherman gunner's Browning does not pull the driver's hands and vice versa.
   * The chain is the bone's two ancestors — the engine's own `i-1` and `i-2`
   * (`applyIK2BoneSolver` reads the bone array at negative offsets, 232 bytes
   * apart), which for `Bip01 R Hand` is the forearm and the upper arm. */
  function bindSeatIk(seat, soldierScene, clips) {
    seatPose.seatIkChains = [];
    if (!seat?.node || !soldierScene) return;
    // Which bones the seat clips re-pose every frame. Those need no restoring:
    // the mixer overwrites last frame's IK before this frame's runs. A bone no
    // clip touches does need it, or the deltas compound (a pose file that
    // resolved only `seat.lower` would wind the arms off the model in seconds).
    const driven = new Set();
    for (const clip of clips || []) {
      for (const track of clip.tracks || []) {
        driven.add(boneKey(track.name.slice(0, track.name.lastIndexOf('.'))));
      }
    }
    const owners = [];
    seat.node.traverse(obj => {
      if (!obj.userData?.skeletonIK) return;
      const owner = obj.userData.control || page.occupancy?.rootId;
      if (owner === seat.id) owners.push(obj);
    });
    const resolveChild = (node, index, name) =>
      (name && node.children.find(c => c.name === name)) || node.children[index] || null;
    for (const binding of collectIkBindings(owners, resolveChild)) {
      const end = findBone(soldierScene, binding.bone);
      const mid = end?.parent;
      const root = mid?.parent;
      if (!end || !mid || !root) continue;
      seatPose.seatIkChains.push({
        ...binding, end, mid, root,
        rest: [root, mid, end].map(
          b => (driven.has(boneKey(b.name)) ? null : b.quaternion.clone())),
      });
    }
  }

  // Scratch, so the three.js half of a frame's IK allocates nothing. The plain
  // arrays `seat-ik.js` returns are small and short-lived; what used to cost
  // real work each frame was re-baking the rotation triple, and `collectIkBindings`
  // now does that once (`prepareIkEntry`).
  const _ikPos = new THREE.Vector3();
  const _ikScale = new THREE.Vector3();
  const _ikQuat = new THREE.Quaternion();
  const _ikParent = new THREE.Quaternion();
  const _ikInverse = new THREE.Quaternion();
  const _ikDelta = new THREE.Quaternion();
  const _ikRoot = new THREE.Vector3();
  const _ikMid = new THREE.Vector3();
  const _ikEnd = new THREE.Vector3();
  const _ikA = [0, 0, 0];
  const _ikB = [0, 0, 0];
  const _ikC = [0, 0, 0];
  const toArr = (v, out) => { out[0] = v.x; out[1] = v.y; out[2] = v.z; return out; };

  /** Pin each declared bone to its vehicle node's live world pose, once a frame.
   *
   * Called after the seat pose's mixer has stepped and after the vehicle's own
   * rig has been applied, so the wheel is already where this frame put it and
   * the hands follow it round rather than trailing it by a frame.
   *
   * `updateIk` (lnxded `0x08265880`) does the same composition in the soldier's
   * own frame; world space is the same answer and saves inverting a matrix the
   * viewer already has. The arm reaches (`applyIK2BoneSolver`) and the hand is
   * then planted at the declared angle outright (`Skeleton::transform`,
   * `0x8342233`) — both halves, in that order. */
  function stepSeatIk() {
    if (!seatPose.seatIkChains.length || !seatPose.seatSoldier) return;
    for (const chain of seatPose.seatIkChains) {
      if (chain.rest[0]) chain.root.quaternion.copy(chain.rest[0]);
      if (chain.rest[1]) chain.mid.quaternion.copy(chain.rest[1]);
      if (chain.rest[2]) chain.end.quaternion.copy(chain.rest[2]);
    }
    seatPose.seatSoldier.updateMatrixWorld(true);
    for (const chain of seatPose.seatIkChains) {
      chain.target.updateWorldMatrix(true, false);
      chain.target.matrixWorld.decompose(_ikPos, _ikQuat, _ikScale);
      const target = ikTarget(
        chain.entry,
        [_ikPos.x, _ikPos.y, _ikPos.z],
        [_ikQuat.x, _ikQuat.y, _ikQuat.z, _ikQuat.w]);

      chain.root.getWorldPosition(_ikRoot);
      chain.mid.getWorldPosition(_ikMid);
      chain.end.getWorldPosition(_ikEnd);
      const solve = solveTwoBone(
        toArr(_ikRoot, _ikA), toArr(_ikMid, _ikB), toArr(_ikEnd, _ikC),
        target.position);
      if (solve.degenerate) continue;

      // A world-space rotation applied to a bone whose parent stays put is
      // `local' = parentWorld^-1 * q * parentWorld * local`. Bend the forearm
      // first, then swing the whole arm: the swing was derived from where the
      // hand sits *after* the bend and carries it along rigidly.
      applyWorldDelta(chain.mid, solve.bend);
      applyWorldDelta(chain.root, solve.reach);
      chain.root.updateMatrixWorld(true);

      // And the hand's own orientation is the declared one, not whatever the
      // arm's swing left behind.
      chain.end.parent.getWorldQuaternion(_ikParent);
      _ikQuat.set(target.quaternion[0], target.quaternion[1],
                  target.quaternion[2], target.quaternion[3]);
      chain.end.quaternion.copy(_ikParent.invert()).multiply(_ikQuat);
      chain.end.updateMatrixWorld(true);
    }
  }

  function applyWorldDelta(bone, quat) {
    if (!bone.parent) return;
    bone.parent.getWorldQuaternion(_ikParent);
    _ikInverse.copy(_ikParent).invert();
    _ikDelta.set(quat[0], quat[1], quat[2], quat[3]);
    // parentWorld^-1 * delta * parentWorld, then premultiply onto the local.
    _ikDelta.premultiply(_ikInverse).multiply(_ikParent);
    bone.quaternion.premultiply(_ikDelta);
  }

  /** Give one loaded seat-pose scene back to the GPU, the same way
   *  `disposeHandWeapon` gives back a weapon rig.
   *
   * A soldier pose is a skinned mesh with its own geometry, materials, textures
   * and bone texture, and entering and leaving a seat loads a fresh one every
   * time. Dropping the reference frees none of that: only `dispose()` does, and
   * a session spent hopping in and out of a jeep used to leak every copy. */
  function disposeSeatScene(root) {
    if (!root) return;
    // A grafted kit part is a `clone(true)` of a cached scene, so its geometry
    // and materials belong to `kitPartCache` and are still wanted by the next
    // occupant. Unhook those first; only the pose's own meshes are freed.
    const borrowed = [];
    root.traverse(obj => { if (obj.userData?.seatKitPart) borrowed.push(obj); });
    for (const node of borrowed) node.removeFromParent();
    root.traverse(obj => {
      obj.geometry?.dispose();
      obj.skeleton?.dispose?.();
      for (const m of [obj.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    root.removeFromParent?.();
    if (root.parent) root.parent.remove(root);
  }

  function disposeSeatPose() {
    // Any load still in flight is now stale. `loadSeatPose` is not awaited at
    // its call sites, so leaving the vehicle before the glb arrives used to let
    // the finished load adopt itself into an empty world: a soldier sitting in
    // mid-air over the spot the jeep was, holding a reference nothing would ever
    // drop. Bumping the generation here is what makes that load discard itself.
    seatPose.seatPoseGeneration++;
    // The mixer first, while its bindings still resolve, then the GPU half.
    if (seatPose.seatPoseMixer) {
      seatPose.seatPoseMixer.stopAllAction();
      seatPose.seatPoseMixer.uncacheRoot(seatPose.seatPoseMixer.getRoot());
      seatPose.seatPoseMixer = null;
    }
    seatPose.seatPoseActions = null;
    seatPose.seatPoseTarget = null;
    seatPose.seatIkChains = [];
    if (seatPose.seatSoldier) {
      disposeSeatScene(seatPose.seatSoldier);
      seatPose.seatSoldier = null;
    }
  }

  function updateSeatPoseVisibility() {
    if (seatPose.seatSoldier) {
      seatPose.seatSoldier.visible = !page.view?.firstPerson;
    }
  }

  Object.assign(seatPose, {
    disposeSeatPose,
    loadSeatPose,
    stepSeatIk,
    updateSeatPoseVisibility,
  });
  return seatPose;
}
