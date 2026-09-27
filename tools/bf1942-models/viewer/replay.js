// Round replay: a bf42plus recording played back over the level map.html has
// loaded, with the dedicated server's event log as an optional overlay.
//
//   map.html?replay=replays/<recording>.ndjson
//   map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
//
// or open one from disk: picked with Open recording or dropped anywhere on
// the page, it is kept in the browser and played as `?replay=local:<name>`
// (replay-open.js).
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
// plain soldier fallback), replay-gunfire.js, and the viewing experience
// (features/round-replay-ux): replay-camera.js (orbit, first person, free),
// replay-chapters.js (the round's events), replay-feed.js (the game's own
// message log), replay-timeline.js and replay-ui.js (the chrome and the
// replay's input).

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import {
  parseRecording, placeholderWeaponFor, primaryWeaponFor, controlledAt, lifeAt, rootOf, bodyAt,
} from './replay-recording.js';
import { parseServerLog, alignServerLog, serverRows } from './replay-server-log.js';
import { ReplayUi, toast } from './replay-ui.js';
import { phaseFor, buildGaitRig } from './replay-gait.js';
import { ReplayAssets } from './replay-assets.js';
import { toViewPosition, place } from './replay-actors.js';
import { ReplayCamera, hullRadius } from './replay-camera.js';
import { buildChapters, killsOf, recordingPlayer } from './replay-chapters.js';
import { ReplayFeed } from './replay-feed.js';
import { dynamicCast } from './replay-gunfire.js';
import { ReplayHull } from './replay-hulls.js';
import { ReplaySoldiers } from './replay-bodies.js';
import { ReplayProps } from './replay-props.js';
import { ReplayRound } from './replay-round.js';
import { ReplayHighlights } from './replay-highlights.js';
import { isLocalReplay, readLocalRecording, recordingSummary } from './replay-open.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';

export { parseRecording, parseServerLog, alignServerLog };
/** The player itself, for the node harness (it needs a DOM to construct). */
export { ReplayPlayer };
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
    this.serverRows = log && alignment ? serverRows(rec, log, alignment) : [];
    this.rows = [...rec.events, ...this.serverRows].sort((a, b) => a.t - b.t);
    // The round's kill lines (a v3 file's weapons filled from the server's
    // log) and its chapters: the timeline's marks, the message log's lines,
    // the scoreboard's tallies (replay-chapters.js).
    this.kills = killsOf(rec, this.serverRows);
    this.chapters = buildChapters(rec, this.serverRows, this.kills);
    const pids = [...new Set([...rec.players.keys(), ...rec.control.map(c => c.pid)])];
    // The recording's own player first: the one person in a bot round, and
    // the one whose view the recording was made from.
    this.recordingPid = recordingPlayer(rec);
    const human = pids.find(pid => rec.players.get(pid) && !rec.players.get(pid).ai);
    this.followPid = this.recordingPid ?? human ?? (pids.length ? pids[0] : null);
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.tagPoints = new Map();
    this.lastFiredTime = 0;
    this.soldiers = ctx.makeReplayBodies ? new ReplaySoldiers(this) : null;
    this.props = new ReplayProps(this);
    this.camera = new ReplayCamera(this);
    if (this.followPid === null) this.camera.setMode('free');
    this.feed = new ReplayFeed(this, this.kills);
    // The level's flags and the ticket counter, as the recording has them.
    this.round = new ReplayRound(rec, log, ctx);
    this.roundNoted = false;
    this.ui = new ReplayUi(this);
    // The battles, streaks and plays worth watching, the battle map and the
    // Auto camera (features/round-replay-highlights).
    this.highlights = new ReplayHighlights(this);
  }

  /** Follow `pid` from now on: the camera eases over to him. */
  follow(pid) {
    if (pid === this.followPid || pid === null || pid === undefined || Number.isNaN(pid)) return;
    this.followPid = pid;
    this.camera.followChanged();
  }

  /** How fast the game's message log runs against the page's clock: the
   *  replay's speed while it plays, still while it is paused or dragged. */
  feedRate() {
    return this.playing && !this.ui.scrubbing ? this.speed : 0;
  }

  /** After the frame is rendered: the timeline keeps a frame of it when it
   *  asked for one (replay-timeline.js). */
  afterRender(canvas) {
    this.ui.timeline.capture(canvas);
  }

  /** A kit template's class as the game names it (`loadouts.json`). */
  kitClass(kit) {
    const kits = this.ctx.loadouts?.()?.kits;
    if (!kits || !kit) return null;
    const entry = kits[kit] ?? Object.entries(kits).find(([name]) => name.toLowerCase() === kit.toLowerCase())?.[1];
    return entry?.class ?? null;
  }

  /** The weapon a soldier life holds at `t`: the item a v4 recording says
   *  is in his hands, else his kit's primary. */
  heldWeapon(life, t) {
    const loadouts = this.ctx.loadouts?.() ?? null;
    const item = bodyAt(this.rec, life.nid, t)?.item;
    if (item && life.kitTemplate && loadouts?.kits) {
      const kits = loadouts.kits;
      const kit = kits[life.kitTemplate]
        ?? Object.entries(kits).find(([name]) => name.toLowerCase() === life.kitTemplate.toLowerCase())?.[1];
      const weapon = kit?.weapons?.find(w => w.slot === item)?.weapon;
      if (weapon) return weapon;
    }
    return primaryWeaponFor(life, loadouts);
  }

  /** Where the name tags go this frame (replay-ui.js): every living soldier
   *  on foot, and every crewed or damaged hull (`vehicle`), as `{ key, pid,
   *  pids, name, extra, team, at, hp, vehicle }`. */
  tagTargets() {
    const out = [];
    const point = key => {
      let p = this.tagPoints.get(key);
      if (!p) {
        p = new THREE.Vector3();
        this.tagPoints.set(key, p);
      }
      return p;
    };
    const name = pid => this.rec.players.get(pid)?.name ?? `player ${pid}`;
    const names = this.ctx.comms?.lexicon?.()?.names ?? null;
    if (this.soldiers?.available) {
      for (const actor of this.soldiers.drawn) {
        if (actor.state.dead || actor.seat) continue;
        const s = actor.state.soldier;
        const lift = actor.stance === 'prone' ? 0.9 : actor.stance === 'crouch' ? 1.6 : 2.1;
        out.push({ key: actor.playerId, pid: actor.pid, pids: [actor.pid], name: actor.name, team: actor.team,
                   at: point(actor.playerId).set(s.x, s.y + lift, s.z) });
      }
    } else {
      for (const entity of this.entities) {
        if (!entity.group.visible || entity.ghost || entity.life.pid === undefined) continue;
        const at = point(entity).copy(entity.group.position);
        at.y += 2.1;
        out.push({ key: entity, pid: entity.life.pid, pids: [entity.life.pid], name: name(entity.life.pid),
                   team: entity.life.team || this.rec.players.get(entity.life.pid)?.team || 0, at });
      }
    }
    for (const hull of this.hulls.values()) {
      if (!hull.group.visible || hull.ghost) continue;
      const { life } = hull;
      const crew = hull.crew ?? [];
      const damaged = life.maxhp > 0 && hull.hp !== null && hull.hp < life.maxhp;
      if (!crew.length && !damaged) continue;
      const lead = crew.find(c => c.seat === 0) ?? crew[0] ?? null;
      const at = hull.root.getWorldPosition(point(hull));
      at.y += Math.min(hullRadius(hull), 12) * 0.9 + 1;
      const vehicle = names?.[life.tmpl] ?? life.tmpl;
      out.push({
        key: hull,
        vehicle: true,
        pid: lead?.pid ?? null,
        pids: crew.map(c => c.pid),
        name: lead ? name(lead.pid) : vehicle,
        extra: lead ? `${vehicle}${crew.length > 1 ? ` +${crew.length - 1}` : ''}` : '',
        team: lead ? this.rec.players.get(lead.pid)?.team ?? life.team : life.team,
        at,
        hp: life.maxhp > 0 && hull.hp !== null ? { hp: hull.hp, max: life.maxhp, crit: life.crit } : null,
      });
    }
    return out;
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
    this.statusLine = `${this.label} · ${this.rec.level || 'level ?'} · ${this.hulls.size} vehicles${bodies}${aligned}`;
    this.ui.status(this.statusLine);
    this.ui.renderFeed();
    // The chrome shows itself for a while once the round is ready to watch.
    this.ui.activity(4);
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
      if (row.atPlayer) this.restOnSurface(marker.position);
      marker.visible = false;
      this.root.add(marker);
      this.markers.push({ row, marker, material });
    }
  }

  /** A player's place in the server's log is his origin, a metre over his
   *  feet (replay-recording.js `standOnFeet`): his ring lies on the surface
   *  under him when he stood within a man's height of one. A spawn is on the
   *  ground already, and a man in the air keeps his height. */
  restOnSurface(p) {
    const floor = this.ctx.groundHeight?.(p.x, p.z, p.y + 0.1);
    if (Number.isFinite(floor) && p.y >= floor && p.y - floor <= CHARACTER_HEIGHT + 0.5) p.y = floor;
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
    // The message log is rebuilt for the new instant, and the camera starts
    // from wherever its target now is.
    this.feed?.invalidate();
    this.camera?.snap();
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
    // A drag along the timeline since the last frame lands first.
    const scrub = this.ui.timeline.takeScrub();
    if (scrub !== null) this.seek(scrub);
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
    // The rounds in the air and the effects run on the same clock: the page
    // advances both on its own, and a paused replay's bombs kept falling.
    const rate = this.feedRate();
    if (this.ctx.guns) this.ctx.guns.timeScale = rate;
    if (this.ctx.effects) this.ctx.effects.timeScale = rate;
    for (const hull of this.hulls.values()) hull.update(t, step);
    for (const entity of this.entities) place(this, entity, t);
    // The camera after the hulls (the orbit centres on a hull as drawn this
    // frame) and before the soldiers: their renderer culls each body against
    // the camera as it stands when it draws him (bot-visuals.js
    // `updateBotVisuals`). Placed after them, the cull read whatever the
    // camera was aimed at before the replay ran, and the followed player
    // vanished at some angles of the orbit. The Auto camera's director and
    // the highlight reel choose whom it is on first.
    this.highlights?.lead(t, dt);
    this.camera.update(dt, t);
    this.soldiers?.update(t, step, this.hulls);
    this.props.update(t);
    this.round?.update(t);
    if (!this.roundNoted && this.round?.points && this.statusLine) {
      // Once the level's points are matched: where the counter's numbers
      // come from.
      this.roundNoted = true;
      const tickets = this.round.source === 'recorded' ? 'tickets recorded'
        : this.round.source === 'estimated' ? 'tickets estimated from the recorded deaths and flags'
        : 'no tickets (the recording joined mid-round, before the recorder kept them)';
      this.statusLine += ` · ${tickets}`;
      this.ui.status(this.statusLine);
    }
    // The server log's rings on the level are the replay log's, a debug
    // overlay: up while that panel is.
    const rings = this.showServer && this.ui.logOpen;
    for (const m of this.markers) {
      const age = t - m.row.t;
      const on = rings && age >= -MARKER_LEAD && age <= MARKER_TAIL;
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
    this.hideOwnBody(this.camera.hidePid);
    // The game's message log, and in the recording player's own first
    // person his hits' red wash.
    const ownView = this.camera.mode === 'pov' && this.camera.hidePid !== null
      && this.followPid === this.recordingPid;
    this.feed.update(t, ownView);
    this.ui.timeline.plan(prevT, t, this.playing);
    this.ui.update(t, dt);
    this.highlights?.update(t, dt);
  }

  /** First person looks out of the followed player's head: his own body,
   *  standing or seated, is not drawn around the camera. */
  hideOwnBody(pid) {
    if (pid === null) return;
    const vis = this.soldiers?.bodies?.botVisuals?.get(`replay:${pid}`);
    if (vis) {
      vis.group.visible = false;
      if (vis.seat?.scene) vis.seat.scene.visible = false;
    }
    for (const entity of this.entities) {
      if (entity.life.pid === pid) entity.group.visible = false;
    }
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
    if (this.ctx.guns) this.ctx.guns.timeScale = 1;
    if (this.ctx.effects) this.ctx.effects.timeScale = 1;
    this.camera.dispose();
    for (const hull of this.hulls.values()) hull.dispose();
    this.hulls.clear();
    this.soldiers?.dispose();
    this.props.dispose();
    this.ctx.guns?.clear();
    this.ctx.scene.remove(this.root);
    this.feed.dispose();
    this.highlights?.dispose();
    this.ui.dispose();
  }
}

// --- entry points for map.html --------------------------------------------------

const textCache = new Map();
const infoCache = new Map();

/** A recording or server log by URL; `local:<name>` is one this browser keeps
 *  (replay-open.js). */
function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, isLocalReplay(url) ? readLocalRecording(url).then(kept => kept.text) : fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    }));
  }
  return textCache.get(url);
}

/** What map.html reads of a recording before its level loads: the level it
 *  was made on (its SetLevel event), its game type (the mode file: `coop.con`
 *  is `coop`, which `?mode=` reads as CoOp's layer; '' for a recording that
 *  joined without one), its mod, and when and where it was recorded
 *  (replay-open.js `recordingSummary`). */
export function recordingInfo(url) {
  if (!infoCache.has(url)) infoCache.set(url, fetchText(url).then(text => recordingSummary(parseRecording(text))));
  return infoCache.get(url);
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
 *        playSoldierDeathSound(position, team), ensureAudio(),
 *        comms, teamFlag(team), triggerHitIndicator(octant, alpha),
 *        keyboardTaken(), mapArt(), mapProjection(), viewDistance(), opened(player) }
 * Everything after `effects` is the map's own machinery and optional: then
 * the page's message log (comms.js), a side's flag sprite, the HUD's
 * hit-direction wash, whether the console, the Escape menu or the briefing
 * has the keyboard, and for the battle map the level's map art, its
 * projection (`extras.minimap.worldToImage`) and its view distance, and
 * `opened`, handed each player once its chrome is built (the page's additions
 * to the bar, replay-open.js). The page calls `afterRender(canvas)` after each
 * render and runs its message log at `feedRate()`.
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
    ctx.opened?.(player);
    await player.load();
    return player;
  }

  return {
    update(dt) {
      player?.update(dt);
    },
    afterRender(canvas) {
      player?.afterRender(canvas);
    },
    /** The page's message log runs at this rate: 1 with no replay open. */
    feedRate() {
      return player ? player.feedRate() : 1;
    },
    /** Whether a replay has the page (its input is the replay's). */
    active() {
      return player !== null;
    },
    async openFromUrl(url, logUrl) {
      // A kept recording brings the server log it was opened with.
      if (isLocalReplay(url)) {
        const kept = await readLocalRecording(url);
        const logText = logUrl ? await fetchText(logUrl).catch(() => null) : kept.log?.text ?? null;
        return open({ recordingText: kept.text, logText, label: kept.name });
      }
      const [recordingText, logText] = await Promise.all([
        fetchText(url),
        logUrl ? fetchText(logUrl).catch(() => null) : null,
      ]);
      return open({ recordingText, logText, label: url.split('/').pop() });
    },
  };
}
