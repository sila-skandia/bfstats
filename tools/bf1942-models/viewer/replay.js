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
//
// This file is the player and the controller; the rest lives beside it:
// replay-recording.js (parsing, round clock, sampling), replay-server-log.js,
// replay-assets.js (models, pose pairs, gait clips), replay-gait.js,
// replay-actors.js (placing an object at a time), replay-camera.js (follow),
// replay-gunfire.js and replay-ui.js.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { parseRecording, placeholderWeaponFor } from './replay-recording.js';
import { parseServerLog, alignServerLog, serverRows } from './replay-server-log.js';
import { ReplayUi, toast } from './replay-ui.js';
import { phaseFor, buildGaitRig } from './replay-gait.js';
import { ReplayAssets } from './replay-assets.js';
import { toViewPosition, place } from './replay-actors.js';
import { followCamera } from './replay-camera.js';
import { dynamicCast, triggerGunFire } from './replay-gunfire.js';

export { parseRecording, parseServerLog, alignServerLog };
export { roundClock } from './replay-recording.js';
export { setReplayPropellerIdle } from './replay-assets.js';

// --- conventions --------------------------------------------------------------

// How long a server-log marker stays on the level around its event, seconds.
const MARKER_LEAD = 0.5;
const MARKER_TAIL = 4;

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
        return dynamicCast(this, ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
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

  seek(t) {
    this.time = Math.min(Math.max(0, t), this.rec.duration);
    this.lastFiredTime = this.time;
    if (this.ctx.guns) {
      this.ctx.guns.clear();
      if (this.rec.fires) {
        for (const f of this.rec.fires) {
          const age = this.time - f.t;
          if (age >= 0 && age <= 0.6) {
            triggerGunFire(this, f);
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
          triggerGunFire(this, f);
        }
      }
    }
    this.lastFiredTime = t;
    if (this.followPid !== null) followCamera(this, dt, t);
    this.ui.update(t);
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
