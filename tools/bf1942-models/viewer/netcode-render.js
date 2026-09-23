// The P2 remote renderer: the replay renderer with a live feed. Everything
// replay.js draws a recording, this module draws from the room's snapshots —
// remote soldiers as pose-pair rigs, remote-driven vehicles as template
// replicas, seated soldiers parented into their vehicle's seat node — with
// the engine's ghost-state law (netcode.md §4, P-2): remotes are a single
// current state at ~0.1 s; the lerp between the last two snapshots is the
// page's rendering choice (netcode.md §6), not the engine's.
//
// The layout mirrors replay.js's own pieces on purpose: the model URL law,
// the pose-pair URL law, the gaits manifest, the baked 180-degree soldier
// flip, the vehicle shading — so a bug in one can be checked against the
// other. The two renderers are deliberately not the same code (a recording
// is seekable and immutable; a room is live), so the recording renderer
// stays untouched.
//
// What is NOT here, and why: remote turret traverse and aim rigs (P4 feel),
// remote shot sound (P4), wreck/replace states (P3 authority), name labels
// (P4), and any correction of the local player (P4).

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { setReplayPropellerIdle } from './replay.js';
import { surveyVehicle } from './seats.js';
import { FAMILY_CLIPS, remoteClipFamily } from './remote-gait.js';

// The engine's team numbering (AXIS = 1, ALLIED = 2), and the soldier pose
// pair each team's placeholder gets. The pair's weapon is the recording
// renderer's own fallback (replay.js's placeholderWeaponFor), so a remote's
// rig binds the same assets both renderers agree on.
const TEAM_SOLDIER = { 1: 'GermanSoldier', 2: 'USMarineSoldier' };
const PLACEHOLDER_WEAPON = 'Colt';

// The soldier model's root carries a baked 180-degree turn a vehicle's root
// does not (replay.js §place, measured exactly 180.00 degrees off at spawn
// instants): the body quaternion multiplies this before the pose rig sits.
export const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);

const rad = d => (d * Math.PI) / 180;

/**
 * ctx is the context map.html hands replay.js (scene, camera, loader, bust,
 * modelsBase, shadeModel) plus `onOccupyChange(vehicleId, occupied)`, which
 * the page wires to hide and restore its parked hulls. Returns a controller:
 *
 *   update(dt, client, nowMs) — per display frame, against the room client
 *   reset()                   — tear every replica down (leave/level change)
 */
export function createRemoteRenderer(ctx) {
  // --- asset caches (replay.js's URL laws, shared caches so both renderers
  //     never double-fetch) ---------------------------------------------------

  const modelCache = new Map();
  const poseCache = new Map();
  const gaitBundleCache = new Map();
  let gaitsManifestPromise = null;

  function model(name) {
    if (!modelCache.has(name)) {
      const url = `${ctx.modelsBase}/${name}.glb${ctx.bust()}`;
      modelCache.set(name, ctx.loader.loadAsync(url).then(gltf => {
        gltf.scene.traverse(obj => {
          const data = obj.userData || {};
          if (data.effect || data.projectileMesh || data.projectileTrail
              || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
        });
        setReplayPropellerIdle(gltf.scene);
        ctx.shadeModel?.(gltf.scene);
        return gltf.scene;
      }).catch(() => null));
    }
    return modelCache.get(name);
  }

  function gaitsManifest() {
    if (!gaitsManifestPromise) {
      gaitsManifestPromise =
        fetch(`${ctx.modelsBase}/poses/gaits/gaits.json${ctx.bust()}`)
          .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .catch(() => ({ lower: null, grips: {}, weaponGrip: {} }));
    }
    return gaitsManifestPromise;
  }

  function gaitBundle(relative) {
    if (!gaitBundleCache.has(relative)) {
      const url = `${ctx.modelsBase}/poses/${relative}${ctx.bust()}`;
      gaitBundleCache.set(relative, ctx.loader.loadAsync(url)
        .then(gltf => gltf.animations ?? [])
        .catch(() => []));
    }
    return gaitBundleCache.get(relative);
  }

  async function gaitClipsFor(weapon) {
    const manifest = await gaitsManifest();
    const grip = manifest.weaponGrip?.[weapon] ?? weapon;
    const gripPath = manifest.grips?.[grip];
    if (!manifest.lower) return [];
    let upper = gripPath ? await gaitBundle(gripPath) : [];
    if ((!upper || !upper.length) && gripPath !== 'gaits/Colt.gait.glb') {
      upper = await gaitBundle('gaits/Colt.gait.glb');
    }
    const lower = await gaitBundle(manifest.lower);
    return [...lower, ...upper];
  }

  function posePair(soldier, weapon) {
    const key = `${soldier}|${weapon}`;
    if (!poseCache.has(key)) {
      const url = `${ctx.modelsBase}/poses/${soldier}__${weapon}.pose.glb${ctx.bust()}`;
      poseCache.set(key, ctx.loader.loadAsync(url).then(gltf => {
        gltf.scene.traverse(obj => {
          const data = obj.userData || {};
          if (data.effect || data.projectileMesh || data.projectileTrail
              || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
        });
        ctx.shadeModel?.(gltf.scene);
        return { scene: gltf.scene, animations: gltf.animations ?? [] };
      }).catch(() => null));
    }
    return poseCache.get(key);
  }

  async function soldierAssets(team) {
    const soldier = TEAM_SOLDIER[team] ?? TEAM_SOLDIER[2];
    const pair = await posePair(soldier, PLACEHOLDER_WEAPON);
    if (!pair) return null;
    const gaits = await gaitClipsFor(PLACEHOLDER_WEAPON);
    return { pair, gaits, soldier };
  }

  // --- per-replica state ------------------------------------------------------

  const root = new THREE.Group();
  root.name = 'remote-room';
  ctx.scene.add(root);

  const soldiers = new Map();    // slot -> {group, rig, want, lastPos, team, seq}
  const vehicles = new Map();    // id -> {id, template, group, survey, occupied}
  const retired = new Set();     // vehicle ids the page is hiding its hull for

  function soldierFor(slot, team) {
    let s = soldiers.get(slot);
    if (s && s.team === team) return s;
    if (s) {
      root.remove(s.group);
      soldiers.delete(slot);
    }
    const group = new THREE.Group();
    group.name = `remote soldier ${slot}`;
    group.visible = false;
    root.add(group);
    s = { slot, team, group, rig: null, standIn: null, want: null,
          lastPos: null, lastSpeed: 0, seq: 0 };
    soldiers.set(slot, s);
    const seq = ++s.seq;
    soldierAssets(team).then(assets => {
      if (soldiers.get(slot) !== s || seq !== s.seq) return;
      if (!assets) {
        // No pose pair: the plain body model stands in, unanimated, rather
        // than an invisible ghost (replay.js's own fallback law).
        const plain = TEAM_SOLDIER[team] ?? TEAM_SOLDIER[2];
        model(plain).then(m => {
          if (m && soldiers.get(slot) === s) { s.standIn = m; group.add(m); }
        });
        return;
      }
      const scene = skeletonClone(assets.pair.scene);
      s.rig = { scene, mixer: null, families: null };
      buildGaitRig(s, scene, assets.pair.animations, assets.gaits);
      group.add(scene);
    });
    return s;
  }

  /** One mixer, the pose's own stance clips for stand/crouch/lie, the
   *  shared lower+upper walk/run/crouchwalk/crawl pairs; actions parked at
   *  weight 0 and switched by poseSoldier. The mixer's time accumulates from the page's
   *  dt: the replay renderer sets time as a pure function of the recording
   *  clock, and a live room has no such clock, so accumulated dt is the
   *  honest source; the crossfade discipline is the same. */
  function buildGaitRig(s, scene, poseClips, gaitClips) {
    const mixer = new THREE.AnimationMixer(scene);
    const action = (name, clips) => {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;
      return a;
    };
    // One entry per clip family, each holding the actions that family needs:
    // a static pose clip, or a lower/upper pair. The names are the files' own
    // (`remote-gait.js` `FAMILY_CLIPS`) -- the prone pose is baked as `lie`,
    // and `crouchwalk` and `crawl` are in every published gait bundle.
    const families = {};
    for (const [family, spec] of Object.entries(FAMILY_CLIPS)) {
      if (spec.pose) {
        const a = action(spec.pose, poseClips);
        if (a) families[family] = [a];
        continue;
      }
      // A gait only counts when both halves resolved (replay.js's law).
      const lower = action(spec.lower, gaitClips);
      const upper = action(spec.upper, gaitClips);
      if (lower && upper) families[family] = [lower, upper];
    }
    s.rig.mixer = mixer;
    s.rig.families = families;
  }

  function vehicleFor(id, template) {
    let v = vehicles.get(id);
    if (v && v.template === template) return v;
    if (v) {
      root.remove(v.group);
      vehicles.delete(id);
    }
    const group = new THREE.Group();
    group.name = `remote vehicle ${id} ${template}`;
    group.visible = false;
    root.add(group);
    v = { id, template, group, survey: null, occupied: false, loaded: false };
    vehicles.set(id, v);
    model(template).then(m => {
      if (!m || vehicles.get(id) !== v) return;
      v.loaded = true;
      group.add(m);
      // The replica's own seat table, on the replica's fresh nodes: the
      // survey order is the SAME law the server's seatIndex names (root
      // first — seats.js §surveyVehicle), so the snapshot's seatIndex
      // addresses the replica's seats directly.
      v.survey = surveyVehicle(group);
    });
    return v;
  }

  function seatNodeFor(v, seatIndex) {
    if (!v.survey || !Number.isInteger(seatIndex) || seatIndex < 0) return null;
    const id = v.survey.order[seatIndex];
    return id == null ? null : v.survey.seats.get(id)?.node ?? null;
  }

  // --- the per-frame pass ------------------------------------------------------

  /**
   * One display frame. `client` is the netcode-client.js room client; `nowMs`
   * is the page's clock (performance.now), the same the client lerps with.
   */
  function update(dt, client, nowMs) {
    for (const slot of client.remoteSlots(nowMs)) {
      const state = client.remotePlayer(slot, nowMs);
      if (!state || !state.alive || !Number.isFinite(state.x)) {
        const s = soldiers.get(slot);
        if (s) s.group.visible = false;
        continue;
      }
      const s = soldierFor(slot, state.team);
      s.group.visible = true;
      const seated = state.seated && state.vehicleId != null;
      const vehicle = seated ? vehicles.get(state.vehicleId) : null;
      const seatNode = seated && vehicle ? seatNodeFor(vehicle, state.seatIndex) : null;
      if (seatNode) {
        // Seated: the seat node owns the body's transform entirely — the
        // same parenting replay.js gives an entered vehicle's lives.
        if (s.group.parent !== seatNode) seatNode.add(s.group);
        s.group.position.set(0, 0, 0);
        s.group.quaternion.identity();
      } else {
        if (s.group.parent !== root) root.add(s.group);
        s.group.position.set(state.x, state.y, state.z);
        const q = s.group.quaternion;
        q.setFromEuler(new THREE.Euler(rad(state.pitch ?? 0), rad(state.yaw ?? 0), 0, 'YXZ'));
        q.multiply(SOLDIER_YAW_FLIP);
      }
      // The speed estimate first, then the clip it chooses: posing before
      // measuring spent last frame's speed on this frame's state, so a gait
      // change always lagged by a frame.
      if (!s.lastPos) s.lastPos = [state.x, state.y, state.z];
      else {
        const dx = state.x - s.lastPos[0];
        const dy = state.y - s.lastPos[1];
        const dz = state.z - s.lastPos[2];
        const speed = dt > 0 ? Math.hypot(dx, dy, dz) / Math.max(dt, 1e-3) : 0;
        // A snappy one-pole estimate. The bands it is compared against are
        // the engine's own speed tables (`remote-gait.js` BANDS).
        s.lastSpeed = s.lastSpeed + (speed - s.lastSpeed) * Math.min(1, dt * 6);
        s.lastPos[0] = state.x; s.lastPos[1] = state.y; s.lastPos[2] = state.z;
      }
      poseSoldier(s, state, dt);
    }

    // The vehicles: replicas exist exactly while a remote drives them. When
    // one stops being driven the page restores its parked hull (see the
    // occupy callback below) and the replica goes away.
    const driven = new Set();
    for (const slot of client.remoteSlots(nowMs)) {
      const state = client.remotePlayer(slot, nowMs);
      if (state?.inVehicle && state.vehicleId) driven.add(state.vehicleId);
    }
    for (const [id, v] of [...vehicles]) {
      if (!driven.has(id)) {
        root.remove(v.group);
        vehicles.delete(id);
        if (retired.delete(id)) ctx.onOccupyChange?.(id, false);
      }
    }
    for (const id of driven) {
      const entry = client.vehicles.get(id);
      if (!entry) continue;
      const pose = client.remoteVehicle(id, nowMs);
      if (!pose) continue;
      const v = vehicleFor(id, entry.template);
      if (!v.occupied && !retired.has(id)) {
        retired.add(id);
        ctx.onOccupyChange?.(id, true);
      }
      v.occupied = true;
      if (v.loaded) {
        v.group.visible = true;
        v.group.position.set(pose.x, pose.y, pose.z);
        v.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      }
    }
  }

  /** The gait/pose blend for one remote, per frame: stance via the state
   *  flags (crouch/prone press their own pose clips when the pair ships
   *  them, stand otherwise), gait via the speed estimate above — the
   *  snapshot cadence is the engine's 0.1 s and gait-select's heading
   *  hysteresis belongs to recordings; a live remote's speed over the lerp
   *  window is the honest approximation until P4 ports the full law. */
  function poseSoldier(s, state, dt) {
    const rig = s.rig;
    if (!rig?.families) return;
    // Stance and speed decide the family; `remote-gait.js` owns both the
    // bands (the engine's own speed tables) and the fallback chain.
    const want = remoteClipFamily(s.lastSpeed, state,
                                  family => !!rig.families[family]);
    if (want !== s.want) {
      s.want = want;
      for (const [family, actions] of Object.entries(rig.families)) {
        for (const a of actions) {
          a.setEffectiveWeight(family === want ? 1 : 0);
          if (family === want) {
            a.paused = false;
            a.reset();
            a.play();
          }
        }
      }
    }
    rig.mixer.update(dt);
  }

  function reset() {
    for (const s of soldiers.values()) root.remove(s.group);
    for (const v of vehicles.values()) root.remove(v.group);
    soldiers.clear();
    vehicles.clear();
    retired.clear();
  }

  /**
   * What each remote replica is currently drawing, for a headless check: the
   * clip family `poseSoldier` settled on, the families its rig actually bound,
   * and the smoothed speed that chose it. There is nothing else on the page
   * that can tell a walk from a stand on someone else's soldier.
   */
  function debugSoldiers() {
    return [...soldiers.values()].map(s => ({
      slot: s.slot, team: s.team, visible: s.group.visible,
      want: s.want, speed: +(s.lastSpeed ?? 0).toFixed(3),
      bound: s.rig?.families ? Object.keys(s.rig.families) : null,
      standIn: !!s.standIn,
    }));
  }

  return { update, reset, root, debugSoldiers };
}