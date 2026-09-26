// Round replay: a bf42plus recording played back over the level map.html has
// loaded, with the dedicated server's event log as an optional overlay.
//
//   map.html?replay=replays/<recording>.ndjson
//   map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
//
// or drop a recording (and optionally its server log) onto the view.
//
// Everything drawn is a function of the recording's clock, so seeking is only
// setting that clock. Recording formats 1-4 are read; what an older format
// lacks (hit points and the player's own chat arrived in v3, every shot, the
// engines and the seats in v4) is simply absent. bfstats
// features/round-replay-capture/README.md documents the format and how each
// mapping here was measured.
//
// The replay draws with the playable map's own machinery wherever the page
// hands it in (features/round-replay-fidelity): a recorded vehicle is the
// map's vehicle -- its drive's rig, its engine and guns on the page's audio
// rack, its damage tiers and death through the page's effects -- presented
// from the recorded motion (replay-hulls.js); a recorded soldier is the map's
// soldier body, in his own kit (replay-bodies.js); a recorded shot fires
// through the page's own guns. A page without that machinery (a node harness)
// gets the plain models this module always drew.
//
// This file is the player and the controller; the rest lives beside it:
// replay-recording.js (parsing, round clock, sampling), replay-kinematics.js,
// replay-hulls.js, replay-bodies.js, replay-server-log.js, replay-assets.js
// (models, pose pairs, gait clips), replay-gait.js and replay-actors.js (the
// plain soldier fallback), replay-camera.js (follow), replay-gunfire.js and
// replay-ui.js.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import {
  parseRecording, placeholderWeaponFor, controlledAt, lifeAt, rootOf,
} from './replay-recording.js';
import { parseServerLog, alignServerLog, serverRows } from './replay-server-log.js';
import { ReplayUi, toast } from './replay-ui.js';
import { phaseFor, buildGaitRig } from './replay-gait.js';
import { ReplayAssets } from './replay-assets.js';
import { toViewPosition, place } from './replay-actors.js';
import { followCamera } from './replay-camera.js';
import { dynamicCast } from './replay-gunfire.js';
import { ReplayHull } from './replay-hulls.js';
import { ReplaySoldiers } from './replay-bodies.js';
import { ReplayProps } from './replay-props.js';

export { parseRecording, parseServerLog, alignServerLog };
export { roundClock } from './replay-recording.js';
export { setReplayPropellerIdle } from './replay-assets.js';

// --- conventions --------------------------------------------------------------

// How long a server-log marker stays on the level around its event, seconds.
const MARKER_LEAD = 0.5;
const MARKER_TAIL = 4;

// Templates a recording names that have nothing to draw.
const NO_MODEL = new Set(['MultiPlayerFreeCamera']);

/** A shot this far back when the clock is set is still fired, its round in
 *  the air as it was (replay's `seek`). */
const SEEK_SHOT_WINDOW = 0.6;

/** A hull is a life with a body of its own that is not a man, a kit, a flag,
 *  a camera or a round. */
const isHull = life => life.tmpl && !life.soldier && !life.kit && !life.controlPoint
  && !life.camera && !life.projectile && !NO_MODEL.has(life.tmpl);

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
    this.entities = [];            // the plain soldier fallback's
    this.hulls = new Map();        // life -> ReplayHull
    this.markers = [];
    this.root = new THREE.Group();
    this.root.name = 'replay';
    ctx.scene.add(this.root);
    this.rows = [...rec.events, ...(log && alignment ? serverRows(rec, log, alignment) : [])]
      .sort((a, b) => a.t - b.t);
    const pids = [...new Set([...rec.players.keys(), ...rec.control.map(c => c.pid)])];
    // The recording's own player first: the one person in a bot round, and
    // the one whose view the recording was made from.
    const human = pids.find(pid => rec.players.get(pid) && !rec.players.get(pid).ai);
    this.followPid = human ?? (pids.length ? pids[0] : null);
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.followReady = false;
    // Where the follow camera sits around its object: dragged or turned with
    // the mouse, zoomed with the wheel.
    this.orbit = { yaw: -Math.PI / 4, pitch: 0.35, zoom: 1 };
    this.lastFiredTime = 0;
    this.soldiers = ctx.makeReplayBodies ? new ReplaySoldiers(this) : null;
    this.props = new ReplayProps(this);
    this.ui = new ReplayUi(this, pids);
  }

  async load() {
    this.ctx.hideBakedVehicles();
    // What a soldier carries is not a hull: every kit and every item a kit
    // hands out, by the level's own loadouts, lies on the ground as a plain
    // model when it lies there at all (a dropped kit, a thrown pistol).
    await Promise.race([
      Promise.resolve(this.ctx.loadoutsReady?.()).catch(() => null),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    const loadouts = this.ctx.loadouts?.() ?? null;
    const carried = new Set();
    for (const [name, kit] of Object.entries(loadouts?.kits ?? {})) {
      carried.add(name.toLowerCase());
      for (const item of kit.items ?? []) carried.add(String(item).toLowerCase());
    }
    for (const life of this.rec.lives) {
      if (life.tmpl && carried.has(life.tmpl.toLowerCase())) life.item = true;
    }
    // A press on foot names the weapon in his hands, now that the kits are
    // known.
    for (const f of this.rec.fires) {
      if (!f.row || !f.soldier || !f.kitTemplate) continue;
      const weapon = placeholderWeaponFor({ kitTemplate: f.kitTemplate }, loadouts);
      // A hand weapon's alternate trigger is its zoom (`c_PIAltFire` on the
      // right button), not a round.
      f.row.text = f.kind === 2 ? `${f.shooter} zoomed the ${weapon}` : `${f.shooter} fired the ${weapon}`;
    }
    const hullLives = this.rec.lives.filter(l => isHull(l) && !l.item);
    const soldierLives = this.soldiers?.available ? [] : this.rec.lives.filter(l => l.soldier);
    const templates = [...new Set(hullLives.map(l => l.tmpl))];
    const models = new Map();
    let done = 0;
    this.ui.status(`loading ${templates.length} models`);
    // The plain soldier fallback: one (soldier, weapon) pose pair per pair
    // present, plus its gait clips, cached per pair in replay-assets.js.
    const soldierPairs = [...new Set(
      soldierLives.map(l => `${l.tmpl}|${placeholderWeaponFor(l, loadouts)}`),
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

    for (const life of hullLives) {
      const model = models.get(life.tmpl);
      if (!model?.normal) continue;
      const scene = skeletonClone(model.normal);
      const wreck = model.wreck ? skeletonClone(model.wreck) : null;
      const hull = new ReplayHull(this, life, scene, wreck);
      // Its rounds skip its own body (`dynamicCast`), the way a level hull's
      // skip theirs through the collider's owner index.
      hull.ownerTag = -1000 - life.nid;
      for (const group of hull.groups) {
        group.owner = hull.ownerTag;
        group.ownerFor = this.ctx.guns?.collider;
      }
      this.root.add(hull.group);
      this.hulls.set(life, hull);
    }

    for (const life of soldierLives) {
      const rigged = poses.get(`${life.tmpl}|${placeholderWeaponFor(life, loadouts)}`);
      if (!rigged) continue;
      const group = new THREE.Group();
      group.name = `replay ${life.tmpl} ${life.nid}`;
      group.visible = false;
      // A wrapper group carries the recorded transform, so the pose keeps
      // its own root orientation (SOLDIER_YAW_FLIP in replay-actors.js).
      // SkeletonUtils.clone rebuilds a parallel bone hierarchy per clone;
      // Object3D.clone would share one skeleton across every soldier.
      const normal = skeletonClone(rigged.pose.scene);
      const anim = buildGaitRig(normal, rigged.pose.animations, rigged.gaitClips, phaseFor(life.nid));
      group.add(normal);
      const meshes = [];
      group.traverse(obj => { if (obj.isMesh) meshes.push({ mesh: obj, material: obj.material }); });
      this.root.add(group);
      this.entities.push({ life, group, normal, wreck: null, meshes, anim, gunGroup: null, ghost: false, label: null, hp: null });
    }

    // Dropped kits and thrown rounds, where the recording has them lying.
    await this.props.load(this.rec.lives);

    if (this.ctx.guns?.collider) {
      this.ctx.guns.collider.dynamicCast = (ox, oy, oz, dx, dy, dz, maxDist, skipOwner) =>
        dynamicCast(this, ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
    }
    this.buildMarkers();
    const aligned = this.alignment
      ? ` · server log aligned on ${this.alignment.matched} of ${this.alignment.total} shared events`
      : this.log ? ' · server log loaded but could not be aligned' : '';
    const bodies = this.soldiers?.available ? ' · soldiers drawn by the map' : '';
    this.ui.status(`${this.label} · ${this.rec.level || 'level ?'} · ${this.hulls.size} vehicles${bodies}${aligned}`);
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
    this.ctx.guns?.clear();
    this.soldiers?.reset();
    for (const hull of this.hulls.values()) hull.lastT = null;
    // A round fired just before the new instant is still in the air.
    for (const f of this.rec.fires) {
      const age = this.time - f.t;
      if (age >= 0 && age <= SEEK_SHOT_WINDOW) this.fireShot(f);
    }
    this.lastFiredTime = this.time;
  }

  /**
   * One recorded shot, through whatever fired it: a hull's seat gun, or a
   * soldier's hand weapon. A v4 shot names its root object; a v3 press is the
   * recording player's own, fired from whatever he controlled then.
   */
  fireShot(f) {
    if (f.feedOnly) return;
    const { rec } = this;
    let pid = f.pid ?? null;
    let root = null;
    if (f.nid !== null && f.nid !== undefined) {
      const life = lifeAt(rec, f.nid, f.t);
      if (life?.soldier) {
        pid = life.pid ?? pid;
      } else if (life) {
        root = { life, seat: f.seat ?? 0 };
      }
    } else if (pid !== null) {
      const nid = controlledAt(rec, pid, f.t);
      const found = rootOf(rec, nid, f.t, pid);
      if (found && !found.life.soldier && !found.life.camera) root = found;
    }
    if (root) {
      this.hulls.get(root.life)?.fire(root.seat, f.kind, f.press ? null : f);
      return;
    }
    // On foot: a v3 press of the alternate trigger is the zoom, not a round.
    if (f.press && f.kind === 2) return;
    if (pid !== null) this.soldiers?.fire(pid, f, f.t);
  }

  update(dt) {
    const prevT = this.lastFiredTime;
    if (this.playing && !this.ui.scrubbing) {
      this.time = Math.min(this.rec.duration, this.time + dt * this.speed);
      if (this.time >= this.rec.duration) this.playing = false;
    }
    const t = this.time;
    // The clock's own step: a frame's worth when playing, nothing when paused
    // or scrubbed. The presentation integrates over it, so a paused replay's
    // propellers hold still with everything else.
    const step = Math.max(0, t - prevT);
    for (const hull of this.hulls.values()) hull.update(t, step);
    for (const entity of this.entities) place(this, entity, t);
    this.soldiers?.update(t, step, this.hulls);
    this.props.update(t);
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
    if (t > prevT) {
      for (const f of this.rec.fires) {
        if (f.t > prevT && f.t <= t) this.fireShot(f);
      }
    }
    this.lastFiredTime = t;
    if (this.followPid !== null) followCamera(this, dt, t);
    this.ui.update(t);
  }

  /** What the labels float over this frame (replay-ui.js). */
  labelTargets() {
    const out = [];
    for (const hull of this.hulls.values()) {
      if (!hull.group.visible || hull.ghost) continue;
      out.push({ key: hull, life: hull.life, hp: hull.hp, node: hull.root, lift: 4.5 });
    }
    for (const entity of this.entities) {
      if (!entity.group.visible || entity.ghost) continue;
      out.push({ key: entity, life: entity.life, hp: entity.hp, node: entity.group, lift: 2.2 });
    }
    return out;
  }

  dispose() {
    if (this.ctx.guns?.collider?.dynamicCast) this.ctx.guns.collider.dynamicCast = null;
    for (const hull of this.hulls.values()) hull.dispose();
    this.hulls.clear();
    this.soldiers?.dispose();
    this.props.dispose();
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

/** The game type a recording was made in, from its SetLevel event's mode
 *  file (`coop.con` is `coop`, which `?mode=` reads as CoOp's layer), or ''
 *  for a recording that joined without one. */
export async function recordingMode(url) {
  return parseRecording(await fetchText(url)).modeFile.replace(/\.con$/i, '');
}

/**
 * The replay controller map.html creates once its level is showing.
 *
 * ctx: { scene, camera, loader, stage, bust, modelsBase, levelName(),
 *        hideBakedVehicles(), shadeModel(root), guns, effects,
 *        vehicleClasses, groundHeight(x, z), waterLevel(),
 *        claimVehicleAudio(key, node, drive, groups), releaseVehicleAudio(key, node),
 *        cutVehicleAudio(node), makeReplayBodies(shim), loadouts(),
 *        playWorldShot(weapon, x, y, z), footstepTick(actor, dt),
 *        playSoldierDeathSound(position, team), ensureAudio() }
 * Everything after `effects` is the map's own machinery and optional.
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
