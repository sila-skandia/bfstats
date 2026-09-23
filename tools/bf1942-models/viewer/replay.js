// Round replay: a bf42plus recording played back over the level map.html has
// loaded, with the dedicated server's event log as an optional overlay.
//
//   map.html?replay=replays/<recording>.ndjson
//   map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
//
// or drop a recording (and optionally its server log) onto the view.
//
// Everything drawn is a function of the recording's clock, so seeking is only
// setting that clock. Recording formats 1-3 are read; what an older format
// lacks (hit points and the player's own chat arrived in v3) is simply absent.
// bfstats features/round-replay-capture/README.md documents the format and how
// each mapping here was measured.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import {
  parseRecording, roundClock, sampleAt, placeholderWeaponFor,
} from './replay-recording.js';
import { parseServerLog, alignServerLog, serverRows } from './replay-server-log.js';
import { ReplayUi, toast } from './replay-ui.js';
import { phaseFor, buildGaitRig } from './replay-gait.js';
import { ReplayAssets, setReplayPropellerIdle } from './replay-assets.js';
import { toViewPosition, place } from './replay-actors.js';

export { parseRecording, roundClock, parseServerLog, alignServerLog, setReplayPropellerIdle };

// --- conventions --------------------------------------------------------------

// How long a server-log marker stays on the level around its event, seconds.
const MARKER_LEAD = 0.5;
const MARKER_TAIL = 4;

// Follow-camera distance from the followed object, and the lowest the orbit
// may go: close over a soldier, further back from a vehicle, and high above
// the spectator camera, which on the spawn screen is only a viewpoint.
const FOLLOW_SOLDIER = { distance: 9, minPitch: -0.15 };
const FOLLOW_VEHICLE = { distance: 20, minPitch: -0.15 };
const FOLLOW_SPECTATOR = { distance: 85, minPitch: 0.7 };

// Templates a recording names that have nothing to draw.
const NO_MODEL = new Set(['MultiPlayerFreeCamera']);

// --- drawing --------------------------------------------------------------------

class ReplayPlayer {
  constructor(ctx, rec, log, alignment, label, assets) {
    this.ctx = ctx;
    this.assets = assets;
    this.rec = rec;
    this.log = log;
    this.alignment = alignment;
    this.label = label;
    this.time = 0;
    this.speed = 1;
    this.playing = true;
    this.showServer = Boolean(alignment);
    this.showGhosts = true;
    this.entities = [];
    this.markers = [];
    this.root = new THREE.Group();
    this.root.name = 'replay';
    ctx.scene.add(this.root);
    this.rows = [...rec.events, ...(log && alignment ? serverRows(rec, log, alignment) : [])]
      .sort((a, b) => a.t - b.t);
    const pids = [...new Set([...rec.players.keys(), ...rec.control.map(c => c.pid)])];
    this.followPid = pids.length ? pids[0] : null;
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.followReady = false;
    // Where the follow camera sits around its object: dragged or turned with
    // the mouse, zoomed with the wheel.
    this.orbit = { yaw: -Math.PI / 4, pitch: 0.35, zoom: 1 };
    this.ui = new ReplayUi(this, pids);
  }

  async load() {
    this.ctx.hideBakedVehicles();
    const drawable = this.rec.lives.filter(l => l.tmpl && !l.kit && !l.controlPoint && !NO_MODEL.has(l.tmpl));
    const templates = [...new Set(drawable.map(l => l.tmpl))];
    const models = new Map();
    let done = 0;
    this.ui.status(`loading ${templates.length} models`);
    // One (soldier, weapon) pose pair per distinct soldier template present
    // (today, one pair per template -- every soldier gets the same
    // placeholder weapon), plus its gait clips. Both are cached per pair/grip
    // (posePair / gaitClipsFor in replay-assets.js), so this never refetches
    // per soldier instance, only per distinct pair actually seen in the
    // recording.
    const soldierPairs = [...new Set(
      drawable.filter(l => l.soldier).map(l => `${l.tmpl}|${placeholderWeaponFor(l)}`),
    )];
    let poseDone = 0;
    const poses = new Map();
    await Promise.all([
      ...templates.map(async name => {
        const [normal, wreck] = await Promise.all([this.assets.model(name), this.assets.model(`${name}.wreck`)]);
        models.set(name, { normal, wreck });
        this.ui.status(`loading models ${++done}/${templates.length}`);
      }),
      ...soldierPairs.map(async key => {
        const [soldier, weapon] = key.split('|');
        const [pose, gaitClips] = await Promise.all([this.assets.posePair(soldier, weapon), this.assets.gaitClipsFor(weapon)]);
        poses.set(key, pose ? { pose, gaitClips } : null);
        this.ui.status(`loading gaits ${++poseDone}/${soldierPairs.length}`);
      }),
    ]);
    for (const life of drawable) {
      const group = new THREE.Group();
      group.name = `replay ${life.tmpl} ${life.nid}`;
      group.visible = false;
      const rigged = life.soldier ? poses.get(`${life.tmpl}|${placeholderWeaponFor(life)}`) : null;
      let normal;
      let wreck = null;
      let anim = null;
      let gunGroup = null;
      if (rigged) {
        // A wrapper group carries the recorded transform, so the pose keeps
        // its own root orientation (see SOLDIER_YAW_FLIP in place()).
        //
        // Plain Object3D.clone() shares one Skeleton (and its bones) across
        // every clone (three.js SkinnedMesh.copy() copies the reference, not
        // the bones), so every soldier but the first would read bone
        // transforms off an unparented template that never gets
        // updateMatrixWorld() -- the hand (farthest from the root) is the
        // most visibly wrong. SkeletonUtils.clone() rebuilds a parallel bone
        // hierarchy per clone, same fix as the plain-model path below.
        normal = skeletonClone(rigged.pose.scene);
        anim = buildGaitRig(normal, rigged.pose.animations, rigged.gaitClips, phaseFor(life.nid));
        if (this.ctx.guns) {
          const found = this.ctx.guns.collect(normal, {
            replace: false,
            speedScale: 1,
            maxRange: 1200,
            roundLifetime: 'data',
          });
          gunGroup = found[0] || null;
        }
      } else {
        const model = models.get(life.tmpl);
        if (!model?.normal) continue;
        normal = skeletonClone(model.normal);
        if (model.wreck) {
          wreck = skeletonClone(model.wreck);
          wreck.visible = false;
        }
      }
      group.add(normal);
      if (wreck) group.add(wreck);
      const meshes = [];
      group.traverse(obj => { if (obj.isMesh) meshes.push({ mesh: obj, material: obj.material }); });
      this.root.add(group);
      this.entities.push({ life, group, normal, wreck, meshes, anim, gunGroup, ghost: false, label: null, hp: null });
    }
    if (this.ctx.guns?.collider) {
      this.ctx.guns.collider.dynamicCast = (ox, oy, oz, dx, dy, dz, maxDist, skipOwner) => {
        return this.dynamicCast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
      };
    }
    this.buildMarkers();
    const aligned = this.alignment
      ? ` · server log aligned on ${this.alignment.matched} of ${this.alignment.total} shared events`
      : this.log ? ' · server log loaded but could not be aligned' : '';
    this.ui.status(`${this.label} · ${this.rec.level || 'level ?'} · ${this.entities.length} objects${aligned}`);
    this.ui.renderFeed();
  }

  buildMarkers() {
    if (!this.alignment) return;
    const ring = new THREE.RingGeometry(1.0, 1.4, 40);
    ring.rotateX(-Math.PI / 2);
    const beam = new THREE.CylinderGeometry(0.05, 0.05, 24, 6);
    beam.translate(0, 12, 0);
    for (const row of this.rows) {
      if (row.source !== 'server' || !row.at) continue;
      const material = new THREE.MeshBasicMaterial({
        color: row.kind === 'destroyVehicle' ? 0xe07a5a : 0xd9b36a,
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const marker = new THREE.Group();
      marker.add(new THREE.Mesh(ring, material));
      if (row.kind === 'destroyVehicle') marker.add(new THREE.Mesh(beam, material));
      toViewPosition(row.at, marker.position);
      marker.visible = false;
      this.root.add(marker);
      this.markers.push({ row, marker, material });
    }
  }

  dynamicCast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
    if (!this.entities.length) return null;
    const rayOrigin = new THREE.Vector3(ox, oy, oz);
    const rayDir = new THREE.Vector3(dx, dy, dz).normalize();
    const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.01, maxDist);
    let bestHit = null;
    let bestDist = maxDist;

    for (const entity of this.entities) {
      if (!entity.group.visible || entity.life.soldier) continue;
      if (skipOwner >= 0 && entity.life.nid === skipOwner) continue;
      const targetObj = (entity.wreck && entity.wreck.visible) ? entity.wreck : entity.normal;
      if (!targetObj) continue;

      const hits = raycaster.intersectObject(targetObj, true);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        const hit = hits[0];
        bestDist = hit.distance;
        let nx = 0, ny = 1, nz = 0;
        if (hit.face) {
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          const worldNorm = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
          nx = worldNorm.x; ny = worldNorm.y; nz = worldNorm.z;
        }
        bestHit = {
          t: hit.distance,
          x: hit.point.x,
          y: hit.point.y,
          z: hit.point.z,
          nx, ny, nz,
          material: 61,
          owner: entity.life.nid,
          kind: 'object',
        };
      }
    }
    return bestHit;
  }

  triggerGunFire(f) {
    if (!this.ctx.guns) return;
    const entity = this.entities.find(e => e.life.soldier && (f.pid !== undefined ? e.life.pid === f.pid : true)) || this.entities.find(e => e.life.soldier);
    if (!entity?.gunGroup) return;

    const dirVec = f.dir ? new THREE.Vector3(f.dir[0], f.dir[1], -f.dir[2]).normalize() : new THREE.Vector3(0, 0, -1);
    const startPos = new THREE.Vector3(f.pos[0], f.pos[1] + 1.35, -f.pos[2]).addScaledVector(dirVec, 0.7);

    entity.gunGroup.aimRay = () => ({ origin: startPos, dir: dirVec });
    this.ctx.guns.fireShot(entity.gunGroup);

    if (this.ctx.fetchHandFireSound && this.ctx.playHandFire && f.weapon) {
      this.ctx.fetchHandFireSound(f.weapon).then(fire => {
        if (fire) this.ctx.playHandFire(fire);
      }).catch(() => {});
    }
  }

  seek(t) {
    this.time = Math.min(Math.max(0, t), this.rec.duration);
    this.lastFiredTime = this.time;
    if (this.ctx.guns) {
      this.ctx.guns.clear();
      if (this.rec.fires) {
        for (const f of this.rec.fires) {
          const age = this.time - f.t;
          if (age >= 0 && age <= 0.6) {
            this.triggerGunFire(f);
            this.ctx.guns.advance(age);
          }
        }
      }
    }
  }

  update(dt) {
    const prevT = this.lastFiredTime !== undefined ? this.lastFiredTime : this.time;
    if (this.playing && !this.ui.scrubbing) {
      this.time = Math.min(this.rec.duration, this.time + dt * this.speed);
      if (this.time >= this.rec.duration) this.playing = false;
    }
    const t = this.time;
    for (const entity of this.entities) place(this, entity, t);
    for (const m of this.markers) {
      const age = t - m.row.t;
      const on = this.showServer && age >= -MARKER_LEAD && age <= MARKER_TAIL;
      m.marker.visible = on;
      if (on) {
        const k = Math.max(0, age) / MARKER_TAIL;
        m.material.opacity = 0.6 * (1 - k);
        m.marker.scale.set(1 + k * 2.5, 1, 1 + k * 2.5);
      }
    }
    if (this.rec.fires && this.ctx.guns) {
      for (const f of this.rec.fires) {
        if (f.t > prevT && f.t <= t) {
          this.triggerGunFire(f);
        }
      }
    }
    this.lastFiredTime = t;
    if (this.followPid !== null) this.followCamera(dt, t);
    this.ui.update(t);
  }

  /** The followed player's controlled object: their soldier, their vehicle,
   *  or before spawning the spectator camera, which has a pose but no model. */
  focusLife(t) {
    let nid = null;
    for (const c of this.rec.control) {
      if (c.t > t) break;
      if (c.pid === this.followPid) nid = c.nid;
    }
    if (nid === null) return null;
    return this.rec.lives.find(l => l.nid === nid && t >= l.created && t < l.destroyed) || null;
  }

  followCamera(dt, t) {
    const life = this.focusLife(t);
    const s = life && sampleAt(life, t);
    if (!s) return;
    const focus = toViewPosition(s.a.p, this.v1);
    if (s.b) focus.lerp(toViewPosition(s.b.p, this.v2), s.k);
    focus.y += life.soldier ? 1.4 : 2.5;
    const cam = this.ctx.camera;
    const rig = life.tmpl === 'MultiPlayerFreeCamera' ? FOLLOW_SPECTATOR
      : life.soldier ? FOLLOW_SOLDIER : FOLLOW_VEHICLE;
    const pitch = Math.max(this.orbit.pitch, rig.minPitch);
    const offset = this.v3.set(
      Math.sin(this.orbit.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.orbit.yaw) * Math.cos(pitch),
    ).multiplyScalar(rig.distance * this.orbit.zoom);
    const desired = this.v2.copy(focus).add(offset);
    const jump = !this.followReady || desired.distanceTo(cam.position) > 150;
    cam.position.lerp(desired, jump ? 1 : 1 - Math.exp(-dt * 4));
    this.followReady = true;
    cam.lookAt(focus);
    // lookAt sets the rotation only. The page refreshed the camera's matrices
    // for its own free-look before this ran, so anything projected through
    // the camera before the render would otherwise use that stale view.
    cam.updateMatrixWorld();
  }

  dispose() {
    if (this.ctx.guns?.collider?.dynamicCast) {
      this.ctx.guns.collider.dynamicCast = null;
    }
    this.ctx.guns?.clear();
    this.ctx.scene.remove(this.root);
    this.ui.dispose();
  }
}

// --- entry points for map.html --------------------------------------------------

const textCache = new Map();

function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    }));
  }
  return textCache.get(url);
}

/** The level a recording was made on, from its SetLevel event. */
export async function recordingLevel(url) {
  return parseRecording(await fetchText(url)).level;
}

/**
 * The replay controller map.html creates once its level is showing.
 *
 * ctx: { scene, camera, loader, stage, bust, modelsBase, levelName(),
 *        hideBakedVehicles() }
 */
export function createReplayController(ctx) {
  const assets = new ReplayAssets(ctx);
  let player = null;

  async function open({ recordingText, logText, label }) {
    const rec = parseRecording(recordingText);
    const level = ctx.levelName();
    if (rec.level && level && rec.level.toLowerCase() !== level.toLowerCase()) {
      toast(ctx.stage, `${label} was recorded on ${rec.level}, and this view shows ${level}. Open it with ?map=${rec.level}.`);
      return null;
    }
    player?.dispose();
    const log = logText ? parseServerLog(logText) : null;
    const alignment = log ? alignServerLog(rec, log) : null;
    player = new ReplayPlayer(ctx, rec, log, alignment, label, assets);
    if (typeof window !== 'undefined') window.replay = player;
    await player.load();
    return player;
  }

  ctx.stage.addEventListener('dragover', e => {
    if ([...(e.dataTransfer?.items || [])].some(item => item.kind === 'file')) e.preventDefault();
  });
  ctx.stage.addEventListener('drop', async e => {
    const files = [...(e.dataTransfer?.files || [])];
    const recording = files.find(f => /\.ndjson$/i.test(f.name));
    if (!recording) return;
    e.preventDefault();
    const log = files.find(f => /\.xml$/i.test(f.name));
    open({ recordingText: await recording.text(), logText: log ? await log.text() : null, label: recording.name })
      .catch(error => toast(ctx.stage, `could not play ${recording.name}: ${error.message}`));
  });

  return {
    update(dt) {
      player?.update(dt);
    },
    async openFromUrl(url, logUrl) {
      const [recordingText, logText] = await Promise.all([
        fetchText(url),
        logUrl ? fetchText(logUrl).catch(() => null) : null,
      ]);
      return open({ recordingText, logText, label: url.split('/').pop() });
    },
  };
}
