// The human's seated soldier: the seat's own pose animation on the kit's
// body, dressed with the kit's parts, following the seat node, the arms put
// on the wheel or the gun by two-bone IK each frame. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); `seat-ik.js` stays the
// solver and the pose rules.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { defaultSeatPoseName, resolveSeatStates, seatBody, seatPoseName } from './seat-ik.js';
import { bindSeatIkChains, findBone, hideBelowPelvis, stepSeatIkChains } from './seat-body.js';
import { bonePattern, kitsByTemplate, wornGrafts } from './kit-graft.js';
import { rigCapsules } from './rig-capsules.js';
import { BOT_BODY_HEIGHT } from './bot-referee.js';
import { DIE_IN_VEHICLE_UPPER, corpseSeconds } from './soldier-death.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `addCorpse`, `bust`, `deployKit`, `deployTeamId`, `dieClips`, `flags`,
 * `kitLoadout`, `MODELS_BASE`, `occupancy`, `optPilot`, `scene`,
 * `soldierBody`, `soldierTemplateFor`, `view`.
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
  seatPose.seatHalfBody = false;    // `c_SeatShowHalfBodySoldier` on this seat
  seatPose.seatDieUpper = null;     // `Ub_DieInVehicle`, bound for the slump
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
      seatPose.seatHalfBody = body.halfBody;

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
    // The slump, bound now so a death in the seat can play it on the frame it
    // happens: `handleDamage` puts `Ub_DieInVehicle` on the torso and leaves the
    // legs on the seat's clip.
    page.dieClips?.().then(dieClips => {
      if (soldierScene !== seatPose.seatSoldier || !seatPose.seatPoseMixer) return;
      const clip = THREE.AnimationClip.findByName(dieClips || [], DIE_IN_VEHICLE_UPPER);
      if (!clip) return;
      const a = seatPose.seatPoseMixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;
      seatPose.seatDieUpper = a;
    });
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

  /** The same, for a bone the kit manifest names (`A`, `backpack`, `HipPack`). */
  function findBoneMatching(root, want) {
    const pattern = bonePattern(want);
    let found = null;
    root.traverse(obj => { if (!found && pattern.test(obj.name)) found = obj; });
    return found;
  }

  /** Build the per-frame IK work for this seat (`seat-body.js`
   *  `bindSeatIkChains`: the seat's own `skeletonIK` nodes, scoped by
   *  `control`). */
  function bindSeatIk(seat, soldierScene, clips) {
    seatPose.seatIkChains = bindSeatIkChains(seat, soldierScene, clips, page.occupancy?.rootId);
  }

  /** Pin the hands to the wheel or the gun, once a frame, after the seat's
   *  mixer and the vehicle's own rig (`seat-body.js` `stepSeatIkChains`). */
  function stepSeatIk() {
    stepSeatIkChains(seatPose.seatIkChains, seatPose.seatSoldier);
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
    seatPose.seatDieUpper = null;
    seatPose.seatHalfBody = false;
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

  /** Sync the seated soldier to its seat node's world pose -- the glb is
   *  parented to `scene` (not the vehicle tree) so it can't disturb
   *  VehicleCamera's node traversal, so it must chase the seat's matrices
   *  every frame instead -- and play its sit clip. */
  seatPose.followSeat = dt => {
    if (!page.optPilot.checked) return;
    if (seatPose.seatSoldier && seatPose.seatPoseTarget) {
      seatPose.seatPoseTarget.getWorldPosition(seatPose.seatSoldier.position);
      seatPose.seatPoseTarget.getWorldQuaternion(seatPose.seatSoldier.quaternion);
    }
    if (seatPose.seatPoseMixer) seatPose.seatPoseMixer.update(dt);
  };

  const _spine = new THREE.Vector3();

  /** The human's seated body as a target (`referee.bodyAt`): feet-equivalent
   *  `{ x, y, z }` under the spine, the same stand-in a man on foot is; null
   *  when the seat draws nobody, or half of him down a hatch. */
  function seatedBody() {
    const scene = seatPose.seatSoldier;
    if (!scene || seatPose.seatHalfBody || !page.optPilot.checked) return null;
    const spine = findBone(scene, 'Bip01 Spine');
    if (!spine) return null;
    scene.updateMatrixWorld(true);
    spine.getWorldPosition(_spine);
    return { x: _spine.x, y: _spine.y - BOT_BODY_HEIGHT, z: _spine.z };
  }

  /** The seated body's hit capsules (`rig-capsules.js`), or null. */
  function seatCapsules() {
    if (!seatedBody()) return null;
    return rigCapsules(seatPose.seatSoldier, page.soldierBody?.collisionBones);
  }

  /**
   * Killed in the seat: the drawn body becomes a corpse that slumps where it
   * sat -- the seat's legs, `Ub_DieInVehicle` on the torso -- and follows the
   * seat for the corpse time, and the seat pose lets go of it so leaving the
   * seat does not dispose it. Returns the corpse's world position for the
   * death cam, or null when the seat drew nobody.
   */
  function detachSeatCorpse() {
    const scene = seatPose.seatSoldier;
    const mixer = seatPose.seatPoseMixer;
    const anchor = seatPose.seatPoseTarget;
    if (!scene || !mixer || !anchor) return null;
    if (seatPose.seatDieUpper) {
      seatPose.seatPoseActions?.upper?.setEffectiveWeight(0);
      seatPose.seatDieUpper.paused = false;
      seatPose.seatDieUpper.reset();
      seatPose.seatDieUpper.setEffectiveWeight(1);
      seatPose.seatDieUpper.play();
    }
    // The arms stop reaching for the gun: the IK chains belong to the live
    // occupant, and a dead one lets go.
    seatPose.seatIkChains = [];
    seatPose.seatSoldier = null;
    seatPose.seatPoseMixer = null;
    seatPose.seatPoseActions = null;
    seatPose.seatDieUpper = null;
    // Drawn from outside now, whatever the seat's own camera was.
    scene.visible = true;
    const at = anchor.getWorldPosition(new THREE.Vector3());
    page.addCorpse({
      name: 'local', family: 'dieInVehicle', scene, mixer, anchor,
      ttl: corpseSeconds(page.soldierBody),
      dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(scene); disposeSeatScene(scene); },
    });
    return { x: at.x, y: at.y, z: at.z };
  }

  Object.assign(seatPose, {
    detachSeatCorpse,
    disposeSeatPose,
    seatCapsules,
    seatedBody,
    loadSeatPose,
    stepSeatIk,
    updateSeatPoseVisibility,
  });
  return seatPose;
}
