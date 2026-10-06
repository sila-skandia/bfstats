// Round replay: a bf42plus recording played back over the level map.html has
// loaded, with the dedicated server's event log as an optional overlay.
//
//   map.html?replay=replays/<recording>.ndjson
//   map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
//
// (`replays/` is the viewer's own folder locally, and on play.bfstats.io the
// assets volume's mesh/replays/: features/gameplay-recordings), or open one
// from disk: picked with Open recording or dropped anywhere on
// the page, it is held in the browser across the reload that loads its level
// and played as `?replay=local:<name>`, then let go (replay-open.js).
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
  parseRecording, placeholderWeaponFor, primaryWeaponFor, controlledAt, lifeAt, rootOf, bodyAt, markRounds,
  nameAt, teamAt, positionAt,
} from './replay-recording.js';
import { parseServerLog, alignServerLog, serverRows } from './replay-server-log.js';
import { ReplayUi, toast } from './replay-ui.js';
import { phaseFor, buildGaitRig, snapGait } from './replay-gait.js';
import { ReplayAssets } from './replay-assets.js';
import { toViewPosition, place } from './replay-actors.js';
import { ReplayCamera, hullRadius, killerToFollow } from './replay-camera.js';
import { buildChapters, killsOf, recordingPlayers } from './replay-chapters.js';
import { ReplayFeed } from './replay-feed.js';
import { dynamicCast } from './replay-gunfire.js';
import { ReplayHull, modelKind } from './replay-hulls.js';
import { ReplaySoldiers } from './replay-bodies.js';
import { addStandIns } from './replay-standins.js';
import { ReplayProps, networkedRounds } from './replay-props.js';
import { ReplayHud } from './replay-hud.js';
import { ReplayViewmodel } from './replay-viewmodel.js';
import { ReplayRound } from './replay-round.js';
import { ReplayHighlights } from './replay-highlights.js';
import { ReplayCreator } from './replay-creator.js';
import { minimapMarksAt } from './replay-minimap.js';
import { whereIs } from './replay-battles.js';
import { isLocalReplay, readLocalRecording, recordingSummary } from './replay-open.js';
import { FAULT_STREAK, ReplayGuard, finiteVector } from './replay-guard.js';
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

/** Milliseconds of a frame the hulls are built in: those the round has at
 *  the playhead while the timeline is dragged (every step can land among
 *  dozens not built yet), and those it has not reached, while it plays
 *  (`buildHulls`). One the playhead reaches in play is built at once. */
const BUILD_DRAG_BUDGET = 4;
const BUILD_AHEAD_BUDGET = 1.5;

/** An extra the replay can do without (the page's additions to its bar, the
 *  highlights): a throw in it is a console warning, never a replay that does
 *  not open. */
function extra(what, fn) {
  try {
    return fn();
  } catch (error) {
    console.warn(`replay: ${what} left out`, error);
    return undefined;
  }
}

/** The index of the first of `fires` (in time order, `parseRecording` sorts
 *  them) later than `t`: a frame fires the rounds between its two clocks
 *  without walking every shot of the round. */
function firstFireAfter(fires, t) {
  let lo = 0;
  let hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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
    // The frame's stages, each unable to stop the others (replay-guard.js).
    this.guard = new ReplayGuard();
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
    // Only what is drawn is walked. Every hull life of the round is built,
    // and every kit and round that ever lies somewhere (562 hulls of 63,650
    // nodes and 1,225 props in the 45-minute replay_20260928-161948), most
    // of them gone at any moment; three r169 recomposes every node's matrix
    // each frame whether it is shown or not, which was half the page's frame.
    // The group never moves, as the effects' does not (effects.js, and
    // features/mesh-viewer-performance rule 2). A hidden node's matrices are
    // brought up to date by `getWorldPosition` and its kind when read.
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrixWorld = function (force) {
      for (const child of this.children) {
        if (child.visible) child.updateMatrixWorld(force);
      }
    };
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
    // the one whose view the recording was made from. A merged recording
    // has one per file (replay-merge.js), and the first is followed first.
    this.recordingPids = recordingPlayers(rec);
    this.recordingPid = this.recordingPids[0] ?? null;
    // The rounds the recording carries as objects (grenades, mines, packs):
    // drawn from it (replay-props.js), never flown by the page's guns.
    this.networkedRounds = networkedRounds(rec);
    const human = pids.find(pid => rec.players.get(pid)?.ai === false);
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
    // His own HUD in first person: the crosshair, his health and ammo.
    this.hud = new ReplayHud(this);
    // And the weapon in his hands, his arms playing what his torso did.
    this.viewmodel = extra('the first-person weapon', () => new ReplayViewmodel(this)) ?? null;
    if (this.followPid === null) this.camera.setMode('free');
    this.feed = new ReplayFeed(this, this.kills);
    // The level's flags and the ticket counter, as the recording has them.
    this.round = new ReplayRound(rec, log, ctx);
    this.roundNoted = false;
    this.ui = new ReplayUi(this);
    // The battles, streaks and plays worth watching, the battle map and the
    // Auto camera (features/round-replay-highlights).
    this.highlights = extra('the highlights', () => new ReplayHighlights(this)) ?? null;
    // The creator view: picking, the round cam, a player's highlights, clips
    // and camera keys, for an admin (features/replay-creator-view).
    this.creator = extra('the creator view', () => new ReplayCreator(this)) ?? null;
  }

  /** The creator view's turn in a frame, switched off the way the
   *  highlights' is if it throws. */
  withCreator(fn) {
    if (!this.creator) return;
    try {
      fn(this.creator);
    } catch (error) {
      console.warn('replay: the creator view threw and is switched off', error);
      const creator = this.creator;
      this.creator = null;
      extra('taking the creator view down', () => creator.dispose());
    }
  }

  /** The highlights' turn in a frame. One that throws is switched off for the
   *  rest of the replay rather than stop every frame from drawing (the page's
   *  loop skips a frame that throws, render and all). */
  withHighlights(fn) {
    if (!this.highlights) return;
    try {
      fn(this.highlights);
    } catch (error) {
      console.warn('replay: the highlights threw and are switched off', error);
      const highlights = this.highlights;
      this.highlights = null;
      extra('taking the highlights down', () => highlights.dispose());
    }
  }

  /** Follow `pid` from now on: the camera eases over to him. */
  follow(pid) {
    if (pid === this.followPid || pid === null || pid === undefined || Number.isNaN(pid)) return;
    this.followPid = pid;
    this.camera.followChanged();
  }

  /** The followed player's death cam has held its beat: the camera goes on
   *  to the man who killed him (`killerToFollow`), as the Auto camera does
   *  (the 2026-10-06 request). Only while the round plays through that
   *  moment, and never under the Auto camera, which does it itself, a
   *  highlight's reel, a creator's rig or the free camera. */
  followKiller(prevT, t) {
    if (!this.playing || this.ui.scrubbing || this.followPid === null) return;
    if (this.camera.mode === 'free' || this.camera.rig || this.highlights?.auto || this.highlights?.reel) return;
    const killer = killerToFollow(this.rec, this.followPid, prevT, t, this.kills);
    if (killer === null) return;
    this.ui.follow(killer);
    this.ui.flash(`Killer: ${nameAt(this.rec, killer, t)}`, 1600);
  }

  /** How fast the game's message log runs against the page's clock: the
   *  replay's speed while it plays, still while it is paused or dragged. */
  feedRate() {
    return this.playing && !this.ui.scrubbing ? this.speed : 0;
  }

  /** What the game's minimap marks at the clock (replay-minimap.js): both
   *  sides, and the followed player as its ring while the camera is his. In
   *  his first person the ring turns with his view, as the player's turns
   *  with the camera in play: no heading of its own, so the page's camera's.
   *  Worked out once for each clock, camera and set of built hulls, however
   *  many surfaces ask. */
  minimapMarks() {
    const t = this.time;
    const followPid = this.camera.mode !== 'free' && !this.camera.rig ? this.followPid : null;
    const pov = this.camera.mode === 'pov';
    const built = this.hulls.size;
    const cached = this.minimap;
    if (cached && cached.t === t && cached.followPid === followPid && cached.pov === pov
        && cached.built === built) return cached.marks;
    const model = this.highlights?.model;
    const where = model ? model.where : (pid, at) => whereIs(this.rec, pid, at, this.kills);
    this.minimapPids ??= [...new Set([...this.rec.players.keys(), ...(this.rec.playerNids?.keys() ?? [])])];
    const marks = minimapMarksAt(this.rec, t, { where, pids: this.minimapPids, hullLives: this.hulls.keys(), followPid });
    if (pov && marks.focus) marks.focus.dir = null;
    this.minimap = { t, followPid, pov, built, marks };
    return marks;
  }

  /** After the frame is rendered: the timeline keeps a frame of it when it
   *  asked for one (replay-timeline.js). */
  afterRender(canvas) {
    this.ui.timeline.capture(canvas);
    // A creator's clip cropped to its frame is drawn from the same canvas.
    this.withCreator(c => c.afterRender(canvas));
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
    const name = pid => nameAt(this.rec, pid, this.time);
    const team = pid => teamAt(this.rec, pid, this.time);
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
                   team: entity.life.team || team(entity.life.pid), at });
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
        team: lead ? team(lead.pid) || life.team : life.team,
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
    // What the recording sees late or never -- a hull already there when it
    // came into range, the ships and craft of a file begun after the join --
    // carried back to its first trace in the part and engine records, or
    // stood in by the level's own vehicle where those say which
    // (replay-standins.js).
    const traced = extra('the stand-ins', () => addStandIns(this.rec, this.ctx.levelVehicles?.() ?? []));
    this.standIns = traced?.added ?? [];
    this.seenLate = traced?.extended ?? [];
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

    // Each hull is built when the round first has it (`buildHulls`), not all
    // of them before it shows: a 45-minute round has 562, 0.4 s of building.
    this.hullModels = models;
    this.unbuilt = hullLives.filter(life => models.get(life.tmpl)?.normal);
    this.hullCount = this.unbuilt.length;

    for (const life of soldierLives) {
      const rigged = poses.get(`${life.tmpl}|${placeholderWeaponFor(life, loadouts)}`);
      if (!rigged) continue;
      extra(`the plain soldier ${life.nid}`, () => this.addEntity(life, rigged));
    }


    // Dropped kits and thrown rounds, where the recording has them lying. A
    // round a hull lays (the PT boats' floating mines) is drawn from that
    // hull's own launcher, so the hulls' models go along.
    await this.props.load(this.rec.lives, [...models.values()].map(m => m.normal).filter(Boolean));

    if (this.ctx.guns?.collider) {
      this.ctx.guns.collider.dynamicCast = (ox, oy, oz, dx, dy, dz, maxDist, skipOwner) =>
        dynamicCast(this, ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
    }
    extra("the server log's rings", () => this.buildMarkers());
    const aligned = this.alignment
      ? ` · server log aligned on ${this.alignment.matched} of ${this.alignment.total} shared events`
      : this.log ? ' · server log loaded but could not be aligned' : '';
    const bodies = this.soldiers?.available ? ' · soldiers drawn by the map' : '';
    const unseen = this.standIns.length ? ` · ${this.standIns.length} never in range, stood in by the level` : '';
    const merged = this.rec.merged?.length ? ` · merged from ${this.rec.merged.length} recordings` : '';
    const damaged = this.rec.skipped ? ` · ${this.rec.skipped} damaged records left out` : '';
    this.statusLine = `${this.label} · ${this.rec.level || 'level ?'} · ${this.hullCount} vehicles${merged}${unseen}${bodies}${aligned}${damaged}`;
    this.ui.status(this.statusLine);
    this.ui.renderFeed();
    // The chrome shows itself for a while once the round is ready to watch.
    this.ui.activity(4);
  }

  /** `life`'s hull, built if it is not yet: undefined when its template has
   *  no model or it could not be made. */
  hullOf(life) {
    return this.hulls.get(life) ?? this.buildHull(life);
  }

  /** Build `life`'s hull, once. Each on its own: a model that cannot be made
   *  into one is a warning and a vehicle left out, not a replay that stops. */
  buildHull(life) {
    const model = this.hullModels?.get(life.tmpl);
    if (!model?.normal || this.hulls.has(life) || this.hullTried?.has(life)) return this.hulls.get(life);
    (this.hullTried ??= new Set()).add(life);
    return extra(`the ${life.tmpl} ${life.nid}`, () => {
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
      return hull;
    });
  }

  /**
   * The hulls not built yet (`unbuilt`) that the round has at `t`, built now,
   * and a few more of the rest, `BUILD_AHEAD_BUDGET` ms a frame, until every
   * one is: a seek never meets a region of the round with nothing built.
   * While the timeline is dragged, at most `BUILD_DRAG_BUDGET` ms a frame and
   * nothing ahead; a hull not built yet is not drawn yet.
   */
  buildHulls(t, dragging) {
    const list = this.unbuilt;
    if (!list?.length) return;
    const start = performance.now();
    let kept = 0;
    for (const life of list) {
      const due = t >= life.created && t < life.destroyed;
      if (due && !(dragging && performance.now() - start > BUILD_DRAG_BUDGET)) this.buildHull(life);
      else list[kept++] = life;
    }
    list.length = kept;
    if (dragging) return;
    let next = 0;
    while (next < list.length && performance.now() - start < BUILD_AHEAD_BUDGET) this.buildHull(list[next++]);
    list.splice(0, next);
  }

  /** What `life`'s hull is (`ReplayHull.kind`) whether or not it is built:
   *  its template's, surveyed once (replay-hulls.js `modelKind`). */
  hullKind(life) {
    const built = this.hulls.get(life);
    if (built) return built.kind;
    const model = this.hullModels?.get(life?.tmpl)?.normal;
    if (!model) return null;
    const kinds = this.templateKinds ??= new Map();
    if (!kinds.has(life.tmpl)) {
      kinds.set(life.tmpl, extra(`the ${life.tmpl}'s seats`, () => modelKind(model, this.ctx.vehicleClasses ?? {})) ?? null);
    }
    return kinds.get(life.tmpl);
  }

  /** The plain soldier fallback's body for `life`, on its (soldier, weapon)
   *  pose pair. */
  addEntity(life, rigged) {
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
    // A seek to no time at all is none: a clock that is not a number samples
    // every life at no time, frame after frame.
    if (!Number.isFinite(t)) return;
    this.time = Math.min(Math.max(0, t), this.rec.duration);
    const guard = this.guard ??= new ReplayGuard();
    guard.run('the seek', () => {
      this.ctx.guns?.clear();
      // A drag along the timeline seeks every frame it moves: its men are
      // moved, and built afresh on the seek it lets go on.
      if (this.ui?.timeline?.scrubbing) this.soldiers?.jump();
      else this.soldiers?.reset();
    });
    for (const hull of this.hulls.values()) {
      hull.lastT = null;
      // A hull put away for throwing gets another go at the new instant.
      hull.faulted = false;
      guard.run('the seek', () => hull.resetSound());
    }
    // A plain soldier cuts to his gait at the new instant rather than
    // morphing across the jump.
    for (const entity of this.entities ?? []) snapGait(entity.anim);
    // A round fired just before the new instant is still in the air, once a
    // drag lets go: every step of one fired them again, reports and all.
    if (!this.ui?.timeline?.scrubbing) {
      const fires = this.rec.fires;
      for (let i = firstFireAfter(fires, this.time - SEEK_SHOT_WINDOW - 1e-6); i < fires.length; i++) {
        const f = fires[i];
        const age = this.time - f.t;
        if (age < 0) break;
        if (age <= SEEK_SHOT_WINDOW) guard.run('a recorded round', () => this.fireShot(f));
      }
    }
    this.lastFiredTime = this.time;
    // The message log is rebuilt for the new instant, and the camera starts
    // from wherever its target now is.
    guard.run('the seek', () => {
      this.feed?.invalidate();
      this.camera?.snap();
      this.viewmodel?.snap();
    });
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
      this.hullOf(root.life)?.fire(root.seat, f.kind, f.press ? null : f);
      return;
    }
    // On foot: a v3 press of the alternate trigger is the zoom, not a round.
    if (f.press && f.kind === 2) return;
    if (pid !== null) this.soldiers?.fire(pid, f, f.t);
  }

  /** A recording player's ammo refilled at a depot at `t` (SpecialGameEvent
   *  0, replay-recording.js `refills`; a merged file names whose): his
   *  soldier's refill sound, at him. */
  refill(t, pid = this.recordingPid) {
    if (pid === null || !this.playing) return;
    const nid = controlledAt(this.rec, pid, t);
    const life = nid !== null ? lifeAt(this.rec, nid, t) : null;
    const p = life?.soldier ? positionAt(life, t) : null;
    if (p) this.ctx.playRefillSound?.({ x: p[0], y: p[1] + 1, z: -p[2] });
  }

  update(dt) {
    // Each stage of the frame runs through the guard (replay-guard.js): one
    // that throws is a console warning and its stand-in, and everything after
    // it still runs, the page's render and HUD included.
    const guard = this.guard ??= new ReplayGuard();
    // The frame's step, the speed and the clock stay numbers whatever
    // arrives: a clock that is not one sampled every life at no time, and
    // every frame after it did the same.
    if (!(dt >= 0 && dt < Infinity)) dt = 0;
    if (!(this.speed > 0 && this.speed < Infinity)) this.speed = 1;
    if (!Number.isFinite(this.lastFiredTime)) this.lastFiredTime = Number.isFinite(this.time) ? this.time : 0;
    if (!Number.isFinite(this.time)) this.time = this.lastFiredTime;
    // A drag along the timeline since the last frame lands first.
    const scrub = guard.run('the timeline', () => this.ui.timeline.takeScrub(), null);
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
    // Whatever throws below, the next frame steps from this one: a clock left
    // behind grew the step every frame and fired every round since again.
    this.lastFiredTime = t;
    // The rounds in the air and the effects run on the same clock: the page
    // advances both on its own, and a paused replay's bombs kept falling.
    const rate = this.feedRate();
    if (this.ctx.guns) this.ctx.guns.timeScale = rate;
    if (this.ctx.effects) this.ctx.effects.timeScale = rate;
    guard.run('building the hulls', () => this.buildHulls(t, this.ui.scrubbing));
    for (const hull of this.hulls.values()) this.updateHull(hull, t, step);
    for (const entity of this.entities) guard.item('a plain soldier', entity, () => place(this, entity, t));
    // The camera after the hulls (the orbit centres on a hull as drawn this
    // frame) and before the soldiers: their renderer culls each body against
    // the camera as it stands when it draws him (bot-visuals.js
    // `updateBotVisuals`). Placed after them, the cull read whatever the
    // camera was aimed at before the replay ran, and the followed player
    // vanished at some angles of the orbit. The Auto camera's director and
    // the highlight reel choose whom it is on first.
    guard.run('following the killer', () => this.followKiller(prevT, t));
    this.withHighlights(h => h.lead(t, dt));
    this.withCreator(c => c.lead(t, dt));
    guard.run('the camera', () => this.camera.update(dt, t), () => {
      // What the first person set this frame is not his: no body hidden,
      // no HUD over a view that did not come from his eyes.
      this.camera.hidePid = null;
      this.camera.sight = null;
    });
    // The weapon in his hands, before his rounds of this frame leave it.
    guard.run('the first-person weapon', () => this.viewmodel?.update(t), () => {
      if (this.viewmodel) this.viewmodel.shown = null;
    });
    guard.run('the soldiers', () => this.soldiers?.update(t, step, this.hulls));
    guard.run('the dropped kits and rounds', () => this.props.update(t));
    guard.run('the flags and tickets', () => this.round?.update(t));
    if (!this.roundNoted && this.round?.points && this.statusLine) {
      // Once the level's points are matched: where the counter's numbers
      // come from.
      this.roundNoted = true;
      const tickets = this.round.source === 'recorded' ? 'tickets recorded'
        : this.round.source === 'estimated' ? 'tickets estimated from the recorded deaths and flags'
        : 'no tickets (the recording joined mid-round, before the recorder kept them)';
      this.statusLine += ` · ${tickets}`;
      guard.run('the status line', () => this.ui.status(this.statusLine));
    }
    // The server log's rings on the level are the replay log's, a debug
    // overlay: up while that panel is.
    guard.run('the server log rings', () => this.updateMarkers(t));
    if (t > prevT) {
      const fires = this.rec.fires;
      for (let i = firstFireAfter(fires, prevT); i < fires.length && fires[i].t <= t; i++) {
        const f = fires[i];
        if (f.t > prevT) guard.run('a recorded round', () => this.fireShot(f));
      }
      for (const r of this.rec.refills ?? []) {
        if (r.t > prevT && r.t <= t) guard.run('a refill', () => this.refill(r.t, r.pid ?? this.recordingPid));
      }
    }
    guard.run('hiding his own body', () => this.hideOwnBody(this.camera.hidePid));
    // What his HUD shows through his eyes; the page paints it (`feedHud`).
    // One that cannot be worked out is no HUD, not a stale one.
    guard.run('the first-person HUD', () => this.hud?.update(t), () => {
      if (this.hud) this.hud.state = null;
    });
    // The game's message log, and in a recording player's own first person
    // his hits' red wash.
    const ownView = this.camera.mode === 'pov' && this.camera.hidePid !== null
      && this.recordingPids.includes(this.followPid);
    guard.run('the message log', () => this.feed.update(t, ownView ? this.followPid : null));
    guard.run('the timeline', () => this.ui.timeline.plan(prevT, t, this.playing));
    guard.run('the bar', () => this.ui.update(t, dt));
    this.withHighlights(h => h.update(t, dt));
    this.withCreator(c => c.update(t, dt));
  }

  /**
   * One hull's frame. One that throws, or is placed at no position (a pose
   * that is not all numbers draws nothing and poisons whatever reads it: the
   * camera over it, its engine's sound), is hidden with its sound let go; one
   * that keeps throwing is left out until the next seek rather than tried and
   * warned about every frame. The rest of the round draws on.
   */
  updateHull(hull, t, step) {
    if (hull.faulted) return;
    // Put away and outside its life: its frame would put it away again.
    if (hull.putAway === true && !(t >= hull.life.created && t < hull.life.destroyed)) return;
    const name = `the ${hull.life.tmpl || 'hull'} ${hull.life.nid}`;
    this.guard.item(name, hull, () => {
      hull.update(t, step);
      if (hull.group.visible && !(finiteVector(hull.root.position) && finiteVector(hull.root.quaternion))) {
        throw new Error(`${name} was placed at no position at ${t.toFixed(2)} s`);
      }
    }, (error, streak) => {
      hull.hide();
      if (streak >= FAULT_STREAK) hull.faulted = true;
    });
  }

  /** The server log's rings around their events (`buildMarkers`). */
  updateMarkers(t) {
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

  /** Everything the replay put on the page, taken down; a part that throws
   *  on the way is a warning, and the rest still goes. */
  dispose() {
    extra('taking the HUD down', () => this.hud?.dispose(this.ctx.hudVars?.() ?? null));
    if (this.ctx.guns?.collider?.dynamicCast) this.ctx.guns.collider.dynamicCast = null;
    if (this.ctx.guns) this.ctx.guns.timeScale = 1;
    if (this.ctx.effects) this.ctx.effects.timeScale = 1;
    extra('taking the camera back', () => this.camera.dispose());
    extra('taking the first-person weapon down', () => this.viewmodel?.dispose());
    for (const hull of this.hulls.values()) extra(`taking the ${hull.life.tmpl} down`, () => hull.dispose());
    this.hulls.clear();
    extra('taking the soldiers down', () => this.soldiers?.dispose());
    extra('taking the dropped kits down', () => this.props.dispose());
    extra('clearing the rounds', () => this.ctx.guns?.clear());
    this.ctx.scene.remove(this.root);
    extra('taking the message log back', () => this.feed.dispose());
    extra('taking the highlights down', () => this.highlights?.dispose());
    extra('taking the creator view down', () => this.creator?.dispose());
    extra('taking the bar down', () => this.ui.dispose());
  }
}

// --- entry points for map.html --------------------------------------------------

const textCache = new Map();
const infoCache = new Map();
/** url -> the parse `recordingInfo` made, handed to the open that follows it
 *  (`takeParsed`): a 45-minute recording takes a second to read, and the
 *  page used to read it twice, once for its level and again to play it. */
const parsedCache = new Map();

/** A recording or server log by URL; `local:<name>` is one the page that
 *  opened it holds for this page (replay-open.js). */
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
  if (!infoCache.has(url)) {
    const parsed = fetchText(url).then(text => ({ text, rec: parseRecording(text) }));
    parsedCache.set(url, parsed);
    infoCache.set(url, parsed.then(({ rec }) => recordingSummary(rec)));
  }
  return infoCache.get(url);
}

/** The recording `recordingInfo` already read from `url`, once, if it is
 *  `text`'s: the open that follows plays it rather than reading it again.
 *  Played, a recording is changed (its stand-ins, its rounds), so a second
 *  open reads its own. Null when there is none. */
async function takeParsed(url, text) {
  const parsed = parsedCache.get(url);
  if (!parsed) return null;
  parsedCache.delete(url);
  const got = await parsed.catch(() => null);
  return got && got.text === text ? got.rec : null;
}

/**
 * The replay controller map.html creates once its level is showing.
 *
 * ctx: { scene, camera, loader, stage, bust, modelsBase, levelName(),
 *        levelRoot(), hideBakedVehicles(), levelVehicles(), shadeModel(root), guns, effects,
 *        vehicleClasses, groundHeight(x, z), waterLevel(),
 *        claimVehicleAudio(key, node, drive, groups), releaseVehicleAudio(key, node),
 *        cutVehicleAudio(node), makeReplayBodies(shim), loadouts(),
 *        renderer, warmSubtree(root, camera, scene), isCollision(obj), lights(),
 *        playWorldShot(weapon, x, y, z), footstepTick(actor, dt),
 *        playSoldierDeathSound(position, team), playSoldierDeathEffects(feet, team, velocity),
 *        playRefillSound(position), ensureAudio(),
 *        comms, teamFlag(team), triggerHitIndicator(octant, alpha),
 *        keyboardTaken(), mapArt(), mapProjection(), viewDistance(), opened(player) }
 * Everything after `effects` is the map's own machinery and optional: then
 * the page's message log (comms.js), a side's flag sprite, the HUD's
 * hit-direction wash, whether the console, the Escape menu or the briefing
 * has the keyboard, and for the battle map the level's map art, its
 * projection (`extras.minimap.worldToImage`) and its view distance, and
 * `opened`, handed each player once its chrome is built (the page's additions
 * to the bar, replay-open.js). `renderer`, `warmSubtree`, `isCollision` and
 * `lights` (the world's `{ hemi, sun }`) draw the followed player's weapon in
 * his first person (replay-viewmodel.js). The page calls `renderViewmodel()`
 * after each render, then `afterRender(canvas)`, and runs its message log at
 * `feedRate()`.
 */
export function createReplayController(ctx) {
  const assets = new ReplayAssets(ctx);
  let player = null;

  /** Several recordings of one round, merged into one before it plays. A set
   *  the merge cannot line up, or whose alignment its guard finds incredible
   *  (two rounds, replay-merge-guard.js), plays the first alone and says why;
   *  the player carries the reason (`notMerged`) for the page's switch. */
  async function openMerged(urls, logUrl) {
    // The merge is read afresh; the first file's own reading (its level,
    // `recordingInfo`) is not held for it.
    for (const url of urls) parsedCache.delete(url);
    const [texts, logText] = await Promise.all([
      Promise.all(urls.map(fetchText)),
      logUrl ? fetchText(logUrl).catch(() => null) : null,
    ]);
    for (const url of urls) textCache.delete(url);
    const name = u => u.split('/').pop().split('?')[0];
    let merged = null;
    try {
      const { mergeRecordings, formatMergeReport, formatGuard } = await import('./replay-merge.js');
      try {
        merged = mergeRecordings(urls.map((u, i) => ({ name: name(u), text: texts[i] })));
      } catch (error) {
        if (error.guard) console.info(formatGuard(error.guard).join('\n'));
        throw error;
      }
      console.info(formatMergeReport(merged.report));
      console.info(formatGuard(merged.report.guard).join('\n'));
    } catch (error) {
      console.warn('replay: the recordings were not merged', error);
      const notMerged = { message: error.message, refused: Boolean(error.guard) };
      const played = await open({ recordingText: texts[0], logText, label: name(urls[0]), notMerged });
      if (played) toast(ctx.stage, `Not merged. ${error.message} Playing the first recording alone.`);
      return played;
    }
    return open({ recordingText: merged.text, logText, label: `${name(urls[0])} and ${urls.length - 1} more` });
  }

  async function open({ recordingText, logText, label, notMerged = null, parsed = null }) {
    const rec = parsed ?? parseRecording(recordingText);
    // A round is a round whatever its name, and the level's own projectile
    // table (`_shared/damage.json`) names them all: a mine from a pool made
    // before the recording began is not a hull to find a model for.
    markRounds(rec, tmpl => Boolean(ctx.guns?.projectileEntry?.({ template: tmpl })));
    const level = ctx.levelName();
    if (rec.level && level && rec.level.toLowerCase() !== level.toLowerCase()) {
      toast(ctx.stage, `${label} was recorded on ${rec.level}, and this view shows ${level}. Open it with ?map=${rec.level}.`);
      return null;
    }
    extra('closing the last replay', () => player?.dispose());
    player = null;
    const log = logText ? extra('the server log', () => parseServerLog(logText)) ?? null : null;
    const alignment = log ? extra('aligning the server log', () => alignServerLog(rec, log)) ?? null : null;
    player = new ReplayPlayer(ctx, rec, log, alignment, label, assets);
    // Several recordings asked for and one played: why (`openMerged`).
    player.notMerged = notMerged;
    if (typeof window !== 'undefined') window.replay = player;
    extra("the page's additions to the replay bar", () => ctx.opened?.(player));
    await player.load();
    return player;
  }

  // Nothing the replay does in the page's frame may throw into it: the page
  // skips the rest of a frame that throws, and a replay that threw every
  // frame froze the view and the Escape menu with it (replay-guard.js).
  const guarded = (what, fn, fallback) => (player ? player.guard.run(what, fn, fallback) : fallback);

  return {
    update(dt) {
      guarded('the frame', () => player.update(dt));
    },
    afterRender(canvas) {
      guarded("the timeline's frame", () => player.afterRender(canvas));
    },
    /** The followed player's weapon over the frame just drawn, in his first
     *  person (replay-viewmodel.js): after the render, before `afterRender`. */
    renderViewmodel() {
      guarded('the first-person weapon', () => player.viewmodel?.render());
    },
    /** The page's message log runs at this rate: 1 with no replay open. */
    feedRate() {
      return guarded('the feed rate', () => player.feedRate(), 1);
    },
    /** The followed player's HUD into the page's HUD variables, in his
     *  first person (replay-hud.js); `art` the page's sprite lookups. One
     *  that throws takes back whatever it had written. */
    feedHud(vars, art) {
      guarded('the HUD feed', () => player.hud?.feed(vars, art), () => {
        try {
          if (player.hud?.written) player.hud.clear(vars);
        } catch {
          // Nothing more to take back.
        }
      });
    },
    /** The crosshair his weapon or seat draws, in his first person; null
     *  otherwise (vehicle-hud.js `crosshairAim`). */
    crosshairAim() {
      return guarded('the crosshair', () => player.hud?.crosshairAim() ?? null, null);
    },
    /** The game's minimap's marks (replay-minimap.js), or null with no
     *  replay open, when the minimap marks the page's own world. One that
     *  throws marks nothing rather than the level's parked vehicles. */
    minimapMarks() {
      return guarded('the minimap', () => player.minimapMarks(),
                     player ? { focus: null, soldiers: [], hulls: [] } : null);
    },
    /** Whether a replay has the page (its input is the replay's). */
    active() {
      return player !== null;
    },
    /** `url` is one recording, or several of one round (`?replay=` once per
     *  recording, features/replay-feed "Rounds"), merged here the way
     *  several picked files are (replay-open.js): the first leads. */
    async openFromUrl(url, logUrl) {
      const urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
      if (urls.length > 1) return openMerged(urls, logUrl);
      url = urls[0];
      // A held recording brings the server log it was opened with.
      if (isLocalReplay(url)) {
        const kept = await readLocalRecording(url);
        const logText = logUrl ? await fetchText(logUrl).catch(() => null) : kept.log?.text ?? null;
        return open({ recordingText: kept.text, logText, label: kept.name, parsed: await takeParsed(url, kept.text) });
      }
      const [recordingText, logText] = await Promise.all([
        fetchText(url),
        logUrl ? fetchText(logUrl).catch(() => null) : null,
      ]);
      // Read once it plays: the text of a 45-minute round is 47 MB the page
      // has no more use for.
      textCache.delete(url);
      return open({ recordingText, logText, label: url.split('/').pop(), parsed: await takeParsed(url, recordingText) });
    },
  };
}
