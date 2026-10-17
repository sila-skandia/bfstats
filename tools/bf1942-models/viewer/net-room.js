// The page in a room (`?room=`): the netcode client, the remote players'
// renderer, the prediction ledger and its reconciler, the seat rows on the
// control channel, the parked-hull replicas, and the room's error card.
// Lifted out of map.html (features/vehicle-instance-refactor Part 2); built
// where the block sat, and the join starts there as it did.

import * as THREE from 'three';
import { createRoomClient } from './netcode-client.js';
import { createSidecarClient, VIEW_PITCH_PER_AIM } from './net-sidecar.js';
import { createServerStatics } from './server-statics.js';
import { createRemoteRounds } from './net-remote-rounds.js';
import { createRemoteRenderer } from './netcode-render.js';
import { createServerRounds } from './net-server-rounds.js';
import { createHullReconciler, createReconciler } from './netcode-reconcile.js';
import { Knockback } from './knockback.js';
import { playerChatLine } from './chat-log.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `announceCapture`, `applyVisibility`, `bindDynamicShading`, `bust`,
 * `camera`, `captured`, `damageVisuals`, `deployActive`, `enterVehicle`,
 * `exitSeat`, `extras`, `flags`, `hoistCaptureFlag`, `loader`, `lockHeld`,
 * `logToConsole`, `manifest`, `MODELS_BASE`, `nearEntry`, `occupancy`,
 * `openDeploy`, `optOnFoot`, `optPilot`, `paintDeployChrome`, `params`,
 * `renderer`, `scene`, `setDeployTeam`,
 * `soldier`, `soldierArmor`, `soldierDead`, `syncVehicleSpawnOwnership`,
 * `templateNameOf`, `vehicleDamage`, `vehiclePads`, `remoteStand`, `remoteGone`,
 * `dropEntryPoints`, `handWeapon`, `playWorldReload`, `placeParkedHull`, `world`,
 * `currentRoot`, `collider`.
 */
export function createNetRoom(page) {
  const room = {};

  // --- the room (netcode-play-multiplayer P2) ----------------------------------
  //
  // `?room=<code>` joins the room server at the same origin (`/netcode` —
  // HAProxy's path-beg ACL rides it through, WS and the JSON lobby both).
  // netcode-client.js owns the wire (the engine's 104-bit input word, the 20 Hz
  // snapshots, the seq law); netcode-render.js draws the server-confirmed
  // remotes the way replay.js draws recordings; this page glues the two onto
  // the local sim's seams and sends the engine's control-channel rows (seat
  // enter/exit/switch, respawn) from the page's own mount/spawn code. Without
  // `?room=` every binding below is a no-op — single-player is untouched.
  const roomCode = page.params.get('room');
  // `?sidecar=ws://127.0.0.1:17942` plays against a real BF1942 server through
  // the UDP sidecar (features/udp-sidecar) instead of a room server: the same
  // page, the same renderer, the same input path, a different transport behind
  // the client seam (`net-sidecar.js`). The sidecar holds the connection to the
  // server, so the page's join asks it to spawn rather than opening anything.
  const sidecarUrl = page.params.get('sidecar');
  const roomName = page.params.get('name') || 'Player';
  room.roomClient = null;
  room.roomRenderer = null;
  room.roomJoined = false;
  room.roomPingTimer = null;
  room.roomTornDown = false;    // a deliberate teardown; not a join failure
  // P3: HP follows the server's word past this window — a destroyed-Armor decree
  // is a hard event (the page's own death loop latches the cam), but a drop
  // smaller than this is the prediction's own business, so the prediction stays
  // the predictor (netcode.md §4).
  const NET_HP_GRACE = 1.5;
  // P4: the correction law lives in netcode-reconcile.js — the hard-set limit,
  // the smoothing share and the replay of the client's unacknowledged ticks are
  // all its numbers, each justified from the sim in its own header. The page
  // keeps the ledger it needs (one pose per tick, flat xyz triples) and writes
  // the plan the module hands back.
  room.netReconciler = null;
  const netTickPoses = [];
  /** Numbers per tick in `netTickPoses` (local-look.js capturePresentationTick). */
  const TICK_POSE = 15;
  /** The last correction the reconciler asked for, for `?data` and the smoke. */
  room.netLastCorrection = null;
  room.netCorrectionCount = 0;
  room.netHardCorrectionCount = 0;

  /** A correction moves the body and touches nothing else.
   *
   *  NOT `Soldier.spawn()`, which is a respawn: it zeroes the velocity and the
   *  PHY-6 ramps, resets the stance, the gait, the bob, the view pitch and the
   *  soldier's own 60 Hz clock, and — called with no yaw — sets the facing to 0.
   *  The rigid body's `setPosition` moves `position` and `previous` together, so
   *  the render interpolation does not draw a smear across the correction
   *  either. */
  function netPlaceSoldier(x, y, z) {
    page.soldier.body.body.setPosition(x, Number.isFinite(y) ? y : page.soldier.y, z);
  }
  const parkedHullCache = new Map();   // room vehicle id -> local scene node
  // The room table id of the vehicle the local player is sitting in, cached on
  // entry: `netVehicleIdFor` is a matrix read over the room table, and the
  // seat-dot feed asks for it every frame while seated.
  room.netOccupiedVehicleId = null;
  /** The local player took a seat on `root`: the room's id for that hull. */
  room.noteOccupiedVehicle = root => { room.netOccupiedVehicleId = netVehicleIdFor(root); };
  /** The id, resolved late when the replica table was not ready at the entry. */
  room.occupiedVehicleIdFor = root => (room.netOccupiedVehicleId ??= netVehicleIdFor(root));
  room.forgetOccupiedVehicle = () => { room.netOccupiedVehicleId = null; };
  const netScratchV = new THREE.Vector3();

  // --- the room's hulls, by name (server/room-pads.mjs) -----------------------
  //
  // A room vehicle names its hull two ways the page can answer exactly: its
  // node's index in `scene.glb` (`node`; `level-load.js` stamps `levelNode` on
  // the page's copy from GLTFLoader's own associations), or, for a pad's
  // other-side vehicle that no scene node stands for, its pad (`pad`, the
  // layer's `objectSpawns` row, `level-statics.js` record `index`) and
  // template. Built once the level's hulls are registered.
  let hullNames = null;
  function hullIndex() {
    const root = page.currentRoot;
    if (hullNames && hullNames.root === root) return hullNames;
    hullNames = { root, byLevel: new Map() };
    root?.traverse(node => {
      if (node.levelNode != null && !hullNames.byLevel.has(node.levelNode)) {
        hullNames.byLevel.set(node.levelNode, node);
      }
    });
    return hullNames;
  }

  /** The owner id the level's collision index gave a placed node (`-1`, null
   *  here, for none): the key of its hit points and its wreck, when it has
   *  an Armor; a stationary gun has none and is only stood or not. */
  function ownerOfNode(node) {
    const owner = page.collider?.statics?.ownerOf?.(node);
    return Number.isInteger(owner) && owner >= 0 ? owner : null;
  }

  /** The page's own copy of a room vehicle, `{ node, owner }`, or null. */
  function pageHullOf(v) {
    if (!v) return null;
    let node = null;
    // A sidecar's vehicles carry no scene node or pad (a real server names
    // neither): bind each to the page's own copy once, the level node of the
    // same template nearest where the server first had it, so its parked hull
    // is hidden behind the replica rather than drawn twice.
    if (v.node == null && v.pad == null && sidecarUrl) v.node = sidecarNodeFor(v);
    if (v.node != null) node = hullIndex().byLevel.get(v.node) ?? null;
    else if (v.pad != null) {
      const record = page.vehiclePads?.pads?.find(r => r.index === v.pad);
      node = record?.nodes?.get(String(v.template).toLowerCase()) ?? null;
    }
    return node ? { node, owner: ownerOfNode(node) } : null;
  }

  /** The level node a sidecar vehicle stands for, or null (`pageHullOf`):
   *  same template, nearest the server's pose, and not already bound to
   *  another of the server's vehicles. */
  const SIDECAR_BIND = 25;
  const sidecarBound = new Map(); // levelNode -> room id
  function sidecarNodeFor(v) {
    const pose = room.roomClient?.remoteVehicle?.(v.id);
    if (!pose || !v.template) return null;
    const want = String(v.template).toLowerCase();
    // Nearest of the same template; one within SIDECAR_BIND is its own pad's
    // copy, and past it (the hull was driven off before this page joined)
    // the nearest free copy stands in and is moved to the server's pose.
    let best = null;
    let bestD = Infinity;
    for (const [levelNode, node] of hullIndex().byLevel) {
      if (sidecarBound.has(levelNode) && sidecarBound.get(levelNode) !== v.id) continue;
      if (String(page.templateNameOf(node) || '').toLowerCase() !== want) continue;
      // The hull itself, not a part of it: every node under a placed
      // Sherman carries its control tag (lodSherman, ShermanComplex,
      // ShermanEntry, ShermanEngine ...), and the nearest of those to the
      // server's pose bound a hull to its entry point, a node with no seats
      // and no drive: the page boarded a "Sherman" that never moved while the
      // server's drove off (live, 2026-10-16).
      if (String(page.templateNameOf(node.parent) || '').toLowerCase() === want) continue;
      node.updateWorldMatrix(true, false);
      const e = node.matrixWorld.elements;
      const d = (e[12] - pose.x) ** 2 + (e[13] - pose.y) ** 2 + (e[14] - pose.z) ** 2;
      // A far copy that another server hull of the template stands on is
      // that hull's own.
      if (d > SIDECAR_BIND ** 2 && padHeldByAnother(v, want, e)) continue;
      if (d < bestD) { bestD = d; best = levelNode; }
    }
    if (best != null) sidecarBound.set(best, v.id);
    return best;
  }

  /** Give a gone vehicle's level node back, so the server's replacement (a
   *  fresh netId on the same pad) can bind to it. The entry's own `node` goes
   *  too: `pageHullOf` binds once and would otherwise hand out the dead id's
   *  copy, and the parked-hull cache is keyed by room id, so its row for this
   *  id is stale the moment the id is retired. */
  function releaseSidecarBinding(id) {
    for (const [levelNode, boundId] of sidecarBound) {
      if (boundId === id) sidecarBound.delete(levelNode);
    }
    const v = room.roomClient?.vehicles.get(id);
    if (v) v.node = null;
    parkedHullCache.delete(id);
  }

  function padHeldByAnother(v, want, e) {
    for (const [id, other] of room.roomClient.vehicles) {
      if (id === v.id || String(other.template).toLowerCase() !== want) continue;
      const p = room.roomClient.remoteVehicle(id);
      if (p && (e[12] - p.x) ** 2 + (e[14] - p.z) ** 2 < SIDECAR_BIND ** 2) return true;
    }
    return false;
  }

  /** The room table id for a LOCAL vehicle node: by name first (its
   *  `scene.glb` node, else its pad and template), then — for a server whose
   *  table carries neither — the template name (the scene node's
   *  `userData.control`), closest to the server pose among the same
   *  template's entries, the `spawnDelayForNode` matching law over the wire
   *  table instead of the local scene. */
  function netVehicleIdFor(node) {
    if (!room.roomJoined || !node) return null;
    const record = node.levelNode == null ? page.vehiclePads?.padOf?.(node) : null;
    for (const [id, v] of room.roomClient.vehicles) {
      if (node.levelNode != null && v.node === node.levelNode) return id;
      if (record && v.pad === record.index
          && v.template.toLowerCase() === page.templateNameOf(node).toLowerCase()) return id;
    }
    const name = page.templateNameOf(node).toLowerCase();
    netScratchV.setFromMatrixPosition(node.matrixWorld);
    let best = null;
    let bestD = Infinity;
    for (const [id, v] of room.roomClient.vehicles) {
      if (v.template.toLowerCase() !== name) continue;
      const pose = room.roomClient.remoteVehicle(id);
      if (!pose) continue;
      const d = (netScratchV.x - pose.x) ** 2
        + (netScratchV.y - pose.y) ** 2 + (netScratchV.z - pose.z) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /** The team of the room's other players seated in the LOCAL hull `root`,
   *  0 when none is (or out of a room): the hull's team as the room sees it,
   *  for the human's entry rule (local-player.js `mayEnterHull`). They share
   *  one side by that same rule, so the first one found answers. */
  room.remoteCrewTeam = root => {
    if (!room.roomJoined || !room.roomClient || !root) return 0;
    const id = netVehicleIdFor(root);
    if (id == null) return 0;
    for (const slot of room.roomClient.remoteSlots()) {
      const p = room.roomClient.remotePlayer(slot);
      if (p?.seated && p.inVehicle && p.vehicleId === id) return room.roomClient.teamOf(slot);
    }
    return 0;
  };

  /** The active seat's position in the occupancy's own survey order, the same
   *  index the server's seat rows and the snapshot records carry (root = 0). */
  function netSeatIndex() {
    const occ = page.occupancy;
    if (!occ) return null;
    const i = occ.order.indexOf(occ.activeSeatId);
    return i >= 0 ? i : 0;
  }

  function netSeatRow(action) {
    const occ = page.occupancy;
    if (!occ?.root) return null;
    const id = netVehicleIdFor(occ.root);
    if (id == null) return null;
    return { type: 'seat', vehicle: id, seat: netSeatIndex() ?? 0, action };
  }

  // --- the round's clock ------------------------------------------------------
  //
  // What turns with the world's time and carries something the simulation
  // reads (FH's flying spawn, `held-arm.js`) must stand at one angle on the
  // server and on every page, so a page in a room names its ticks as the
  // server does: `World.tickBase` is the server's lead over this world's own
  // count, read off each snapshot's tick. A snapshot is late by its trip and
  // lands between this page's ticks, so one reading is a tick or two out
  // either way: the lead is closed a little per snapshot (a held craft does
  // 0.6 m a tick, and must not be seen to step) and taken whole only when it
  // is far out, which is the join, a stalled tab or a dropped backlog.
  const TICK_FOLLOW_SHARE = 0.02;
  const TICK_FOLLOW_SNAP = 15;
  let tickFollowed = false;
  function followRoomTick(tick) {
    const world = page.world;
    if (!world || !Number.isFinite(tick)) return;
    const lead = tick - world.ticks;
    if (!tickFollowed || Math.abs(lead - world.tickBase) > TICK_FOLLOW_SNAP) world.tickBase = lead;
    else world.tickBase += (lead - world.tickBase) * TICK_FOLLOW_SHARE;
    tickFollowed = true;
  }

  function netSendAction(row) {
    // Taking a seat the server already gave this player (a reloaded page,
    // adoptServerSeat) is the page catching up, not a press: sent, its Use
    // would get him out again.
    // A seat row moves the body somewhere the soldier sim did not walk it
    // (a hull pose, an exit point), so every pose in the prediction ledger
    // describes a different situation from the one the next snapshot will.
    // That holds for a seat the server gave or took as well, which is not sent.
    if (row?.type === 'seat') {
      room.netReconciler?.reset();
      netTickPoses.length = 0;
    }
    if (row?.type === 'seat' && adoptingSeat) return;
    if (room.roomJoined && room.roomClient) room.roomClient.action(row);
  }

  /** The local scene's parked hull for a room vehicle id: the level node whose
   *  template matches and whose position is closest to the server pose. The
   *  replica draws a remote driver's vehicle, so the parked hull under it must
   *  not double-draw (and it is asleep either way — `damageVisuals`' own node,
   *  the frozen spawn tree, not the body world). */
  function parkedHullFor(vehicleId) {
    // A sidecar's binding lives on the vehicle entry (`pageHullOf`), which a
    // hull out of scope and back replaces: a cache here kept the old node, the
    // hide went to it, and the bound copy stood visible (live: Sherman 532).
    if (sidecarUrl) return pageHullOf(room.roomClient?.vehicles.get(vehicleId))?.node ?? null;
    if (parkedHullCache.has(vehicleId)) return parkedHullCache.get(vehicleId);
    const v = room.roomClient?.vehicles.get(vehicleId);
    let found = pageHullOf(v)?.node ?? null;
    // A sidecar's hull has one copy, the one `pageHullOf` binds: a second,
    // nearest-node search here could pick the airfield's OTHER Corsair while
    // the level was still loading, hide that one, and leave the bound copy
    // standing on its pad under the server's flying plane. A miss waits for
    // the binding instead.
    if (v && !found && !sidecarUrl) {
      const want = v.template.toLowerCase();
      const pose = room.roomClient.remoteVehicle(vehicleId);
      let bestD = Infinity;
      for (const visual of page.damageVisuals.values()) {
        const node = visual?.node;
        if (!node || page.templateNameOf(node).toLowerCase() !== want) continue;
        const d = pose
          ? (node.position.x - pose.x) ** 2
            + (node.position.y - pose.y) ** 2 + (node.position.z - pose.z) ** 2
          : 0;
        if (d < bestD) { bestD = d; found = node; }
      }
    }
    // A miss is not kept: before the level's hulls are indexed every lookup
    // misses, and a cached miss left a bot-driven Sherman's parked copy
    // standing on its pad for the whole session (live, 2026-10-16: 532
    // occupied 38 m away, its copy visible).
    if (found) parkedHullCache.set(vehicleId, found);
    return found;
  }
  /** Sidecar vehicles another player occupies: their copies are off the
   *  page's field (syncHulls, applyHull). */
  const remoteHeld = new Set();

  function hideParkedHull(roomId, occupied) {
    const node = parkedHullFor(roomId);
    if (node) node.visible = !occupied;
    // Left by another player: the page's hull stands where the server's does,
    // not where this page last saw it (its pad).
    if (!occupied) placeAtServerPose(roomId);
  }

  /** The page's parked copy of room vehicle `id` put where the server's
   *  snapshot has it, when the two are more than `PARKED_DRIFT` apart. */
  const PARKED_DRIFT = 1.5;
  function placeAtServerPose(id) {
    const v = room.roomClient?.vehicles.get(id);
    const hull = pageHullOf(v);
    const pose = room.roomClient?.remoteVehicle(id);
    if (!hull || hull.owner == null || !pose || v.live === false) return false;
    if (page.occupancy?.root === hull.node) return false;
    hull.node.updateWorldMatrix(true, false);
    const e = hull.node.matrixWorld.elements;
    if (Math.hypot(e[12] - pose.x, e[13] - pose.y, e[14] - pose.z) <= PARKED_DRIFT) return false;
    return !!page.placeParkedHull?.(hull.owner, pose, pose.q);
  }

  /** Room vehicles whose page copy must be brought to the server's word,
   *  and whether the page has taken the server's pads over yet. */
  const hullDirty = new Set();
  /** Sidecar capture rows waiting for the page's flags (cp name -> row). */
  const pendingCaptures = new Map();
  /** The server's latest ticket row per side (team -> row), kept written. */
  const pendingTickets = new Map();
  let hullsSynced = false;
  let posesSynced = false;
  let sidecarPoseFrame = 0;

  /** A static's hit points by its `scene.glb` node (`object` rows and HELLO's
   *  `damage.objects`), waiting for the page's copy to exist. */
  const objectHp = new Map();
  const objectDirty = new Set();

  /** A static's row: the server's hit points for the node. */
  function noteObject(node, hp, destroyed) {
    objectHp.set(node, { hp, destroyed: !!destroyed });
    objectDirty.add(node);
  }

  /** The page's copy of a static brought to the server's hit points; its own
   *  damage pass draws the tiers and the death tier from there. */
  function applyObject(node) {
    const want = objectHp.get(node);
    const copy = hullIndex().byLevel.get(node);
    const owner = copy ? ownerOfNode(copy) : null;
    const local = owner != null ? page.vehicleDamage?.get(owner) : null;
    if (!want || !local) return;
    if (want.destroyed) {
      if (!local.destroyed) local.damage(local.hitPoints + 1);
      return;
    }
    const diff = local.hitPoints - want.hp;
    if (diff > 0.05) local.damage(diff);
    else if (diff < -0.05 && !local.destroyed) local.heal(-diff);
  }

  /**
   * One landing of the page's own round, to the room (`server/room-hits.mjs`
   * prices it): where it met what, the direct hit's damage as its round
   * computed it, and its blast's own fields. The object is named the way the
   * room names it, a room vehicle by its table id, a placed static by its
   * `scene.glb` node. A round that met nothing with hit points and carries no
   * blast is not sent: there is nothing to price.
   */
  room.reportImpact = record => {
    if (!room.roomJoined || !record) return;
    const splash = record.splashRadius > 0 && Number.isFinite(record.splashMaterial2)
      ? { radius: record.splashRadius, material2: record.splashMaterial2,
          yMod: record.splashYMod ?? null, force: record.splashForce ?? null }
      : null;
    let hit = null;
    let struck = null;
    if (record.owner != null && record.owner >= 0 && record.damage > 0) {
      struck = page.damageVisuals.get(record.owner)?.node ?? null;
      const id = struck ? netVehicleIdFor(struck) : null;
      if (id != null) hit = { vehicle: id };
      else if (struck?.levelNode != null) hit = { node: struck.levelNode };
    }
    if (!hit && !splash) return;
    // A fuse's end-of-life blast stands on the round (`point`); a hand-built
    // one (`__blast`) may name only its centre, and a hand-built direct hit
    // (`__roundHit`) nothing but the object, whose origin then stands for it.
    let point = record.point ?? record.splashPoint;
    if (!Array.isArray(point) && struck) {
      struck.updateWorldMatrix(true, false);
      const e = struck.matrixWorld.elements;
      point = [e[12], e[13], e[14]];
    }
    if (!Array.isArray(point) || point.length !== 3) return;
    netSendAction({
      type: 'impact', point: point.map(Number),
      splashPoint: Array.isArray(record.splashPoint) ? record.splashPoint.map(Number) : null,
      hit, damage: hit ? record.damage : 0, splash,
    });
  };

  /** A blast the room priced pushed this soldier (`room-hits.mjs`): the same
   *  push into the page's own body, its flight run by the page's own
   *  `Knockback` (the human's landing, KNOCK-8). The ledger's poses describe
   *  a soldier no blast had reached, so the prediction starts again from
   *  here, as after a seat change. */
  function takeBlast(row) {
    const body = page.soldier?.body;
    if (!body?.blast || page.soldierDead || !Array.isArray(row.push)) return;
    if (page.optPilot.checked || !page.optOnFoot.checked) return;
    const [ax, ay, az] = row.push.map(Number);
    if (![ax, ay, az].every(Number.isFinite)) return;
    body.knockback ??= new Knockback();
    body.blast(ax, ay, az, { ai: false });
    room.netReconciler?.reset();
    netTickPoses.length = 0;
  }

  /** A pad or hull row (`server/room-pads.mjs`), on the table's own record. */
  function noteHull(row) {
    // A destroyed hull takes its binding with it. The server gives the
    // replacement a fresh netId, and `sidecarNodeFor` passes over every level
    // node already bound to another id: with the dead id still holding the
    // level's only M3A1, El Alamein's respawned APC could never bind and was
    // never drawn — the page kept the wreck 108 m away and the owner, standing
    // beside the new one, saw the page walk past it (live, 2026-10-17).
    if (row.type === 'vehicleGone') releaseSidecarBinding(row.vehicle);
    const v = room.roomClient?.vehicles.get(row.vehicle);
    if (!v) return;
    if (row.type === 'padSpawn') {
      v.live = true; v.fresh = true; v.hp = null; v.destroyed = false;
    } else if (row.type === 'vehicleGone') {
      v.live = false;
    } else if (row.type === 'hull') {
      v.hp = row.hp; v.destroyed = !!row.destroyed;
    }
    hullDirty.add(row.vehicle);
  }

  /** The page's copy of one room vehicle brought to the server's word: on the
   *  field or off it (the pads' live set, `level-statics.js`
   *  `setRemoteLive`), stood up fresh on a `padSpawn` (`vehicle-wrecks.js`
   *  `remoteStand`), its wreck cleared on a `vehicleGone`, and its hit points
   *  the server's, which the page's own damage pass then draws (its tiers,
   *  its wreck, the crew it kills). */
  function applyHull(id) {
    const v = room.roomClient.vehicles.get(id);
    const hull = pageHullOf(v);
    if (!hull) return;
    // Another player's hull is drawn by its replica, not by this copy.
    if (remoteHeld.has(id)) {
      page.vehiclePads.setRemoteLive?.(hull.node, false);
      return;
    }
    page.vehiclePads.setRemoteLive?.(hull.node, !!v.live);
    if (v.live) placeAtServerPose(id);
    if (!v.live) {
      if (hull.owner != null) page.remoteGone?.(hull.owner);
      return;
    }
    if (v.fresh) {
      v.fresh = false;
      if (hull.owner != null) page.remoteStand?.(hull.owner);
    }
    const local = hull.owner != null ? page.vehicleDamage?.get(hull.owner) : null;
    if (!local || v.hp == null) return;
    if (v.destroyed) {
      if (!local.destroyed) local.damage(local.hitPoints + 1);
      return;
    }
    const diff = local.hitPoints - v.hp;
    if (diff > 0.05) local.damage(diff);
    else if (diff < -0.05 && !local.destroyed) local.heal(-diff);
  }

  /** Once a frame: once the level's pads and hulls exist, the server runs
   *  them (`remotePads`) and every room vehicle the rows have touched is
   *  brought to its word; the first time, all of them (HELLO's states). */
  // A BF42++ server's own statics and its StaticObjects.con switch
  // (`server-statics.js`): part of the world the player collides with.
  const serverStatics = sidecarUrl ? createServerStatics({
    get bindDynamicShading() { return page.bindDynamicShading; },
    get bust() { return page.bust; },
    get collider() { return page.collider; },
    get currentRoot() { return page.currentRoot; },
    get extras() { return page.extras; },
    get loader() { return page.loader; },
    get logToConsole() { return page.logToConsole; },
    get MODELS_BASE() { return page.MODELS_BASE; },
  }) : null;
  room.serverStatics = serverStatics;

  room.syncHulls = () => {
    if (serverStatics && room.roomClient?.serverStatics) serverStatics.sync(room.roomClient.serverStatics());
    // The level's load replaces its extras object, and with it the counts a
    // row wrote into the one before: the latest of each side is kept and
    // written again whenever the counters do not show it.
    if (pendingTickets.size && page.extras) {
      for (const row of pendingTickets.values()) {
        const key = `team${row.team}`;
        if (page.extras.tickets?.[key] !== row.count) page.extras.tickets = { ...page.extras.tickets, [key]: row.count };
      }
    }
    if (pendingCaptures.size && page.flags?.length && room.roomClient?.onevent) {
      const rows = [...pendingCaptures.values()];
      pendingCaptures.clear();
      for (const row of rows) room.roomClient.onevent(row);
    }
    if (!room.roomJoined || !page.vehiclePads?.pads || !page.damageVisuals?.size) return;
    // Against a real server the server's occupancy says which copies stand
    // down, every frame, whatever the renderer is doing (it does not run on
    // the deploy screen or between lives): a hull another player is in is
    // off the field on this page, the replica drawn in its place, and back on
    // it where the server has it when he leaves (`applyHull`). Hiding the node
    // instead was undone by the pads' own visibility pass every frame, and a
    // bot's Sherman stood on its pad while the server had it at the beach.
    if (sidecarUrl) {
      const mine = page.occupancy ? netVehicleIdFor(page.occupancy.root) : null;
      for (const id of room.roomClient.vehicles.keys()) {
        const remote = id !== mine && !!room.roomClient.remoteVehicle(id)?.occupied;
        if (remote !== remoteHeld.has(id)) {
          if (remote) remoteHeld.add(id); else remoteHeld.delete(id);
          hullDirty.add(id);
        }
      }
      for (const id of remoteHeld) if (!room.roomClient.vehicles.has(id)) remoteHeld.delete(id);
    }
    // Once the first snapshot is in: a hull another player moved before this
    // page joined stands where he left it.
    if (!posesSynced && room.roomClient.snapCount() > 0) {
      posesSynced = true;
      for (const id of room.roomClient.vehicles.keys()) placeAtServerPose(id);
    }
    // A sidecar's hulls come into scope over time, not in a join table, and a
    // hull someone drove and left stands where they left it: keep the page's
    // empty copies where the server has them (a copy left at its pad was the
    // one the player walked to and pressed E on, while the server's hull was
    // across the base, so the server seated nobody).
    if (sidecarUrl && ++sidecarPoseFrame % 30 === 0) {
      for (const id of room.roomClient.vehicles.keys()) {
        const pose = room.roomClient.remoteVehicle(id);
        if (pose && !pose.occupied) placeAtServerPose(id);
      }
    }
    if (!hullsSynced) {
      hullsSynced = true;
      page.vehiclePads.remotePads = true;
      // And the objects' damage: the server bills it, the page draws it.
      if (page.world) page.world.remoteDamage = true;
      // HELLO's word: each hull's state and the hit points of what is not at
      // its full count.
      const damage = room.roomClient.hello?.damage;
      for (const [id, hp] of damage?.hulls ?? []) {
        const v = room.roomClient.vehicles.get(id);
        if (v) { v.hp = hp; v.destroyed = hp <= 0; }
      }
      for (const [node, hp] of damage?.objects ?? []) noteObject(node, hp, hp <= 0);
      for (const id of room.roomClient.vehicles.keys()) hullDirty.add(id);
    }
    for (const node of objectDirty) applyObject(node);
    objectDirty.clear();
    if (!hullDirty.size) return;
    for (const id of hullDirty) applyHull(id);
    hullDirty.clear();
    parkedHullCache.clear();
    page.applyVisibility();
    page.syncVehicleSpawnOwnership();
    page.dropEntryPoints?.();
  };

  function netTeardownRoom() {
    room.roomTornDown = true;
    if (!room.roomJoined && !room.roomClient) return;
    room.roomJoined = false;
    if (room.roomPingTimer !== null) { clearInterval(room.roomPingTimer); room.roomPingTimer = null; }
    room.roomRenderer?.reset();
    room.serverRounds?.dispose();
    room.serverRounds = null;
    room.roomClient?.close();
    room.roomClient = null;
    room.netReconciler = null;
    netTickPoses.length = 0;
    room.netLastCorrection = null;
    parkedHullCache.clear();
    // Solo again: the page's own pads and damage run its level from here on.
    if (page.vehiclePads) page.vehiclePads.remotePads = false;
    if (page.world) page.world.remoteDamage = false;
    if (page.world) page.world.tickBase = 0;
    tickFollowed = false;
    hullsSynced = false;
    posesSynced = false;
    hullDirty.clear();
    objectHp.clear();
    objectDirty.clear();
  }

  // --- the room's trouble modal -------------------------------------------------
  //
  // A room that will not open must say so: the join fails with no feedback
  // today, and a player staring at an empty map navigates away. The modal is
  // the game's own panel (this page's tokens, the deploy family) with the
  // reason, RETRY (one reload — the URL holds the room), and PLAY SOLO.
  const ROOM_CLOSE_MESSAGES = {
    room_full: 'the room is full',
    bad_room: 'no room with that code',
    bad_name: 'that name is no good',
    no_peer: 'the server lost your connection',
    handler_error: 'the server had a problem',
    silent_timeout: 'the server dropped you (silence)',
  };
  const roomIssue = document.getElementById('roomIssue');
  const roomIssueCode = document.getElementById('roomIssueCode');
  const roomIssueMessage = document.getElementById('roomIssueMessage');

  function roomIssueShow(code, message) {
    roomIssueCode.textContent = code ? `· ${code}` : '';
    roomIssueMessage.textContent = message;
    roomIssue.hidden = false;
    (document.getElementById('roomIssueRetry'))?.focus?.();
  }

  function roomIssueHide() { roomIssue.hidden = true; }

  function roomPlaySolo() {
    roomIssue.hidden = true;
    netTeardownRoom();
    page.logToConsole('playing solo');
  }
  document.getElementById('roomIssueRetry').addEventListener('click',
    () => location.reload());
  document.getElementById('roomIssueSolo').addEventListener('click', roomPlaySolo);

  /** The rows the message log prints: another player's radio, the server's
   *  kills and captures (comms.js builds the engine's own lines from them). */
  function roomRowToComms(row) {
    const comms = page.comms;
    const client = room.roomClient;
    if (!comms || !client || !row) return;
    const who = slot => ({
      id: slot,
      name: slot === client.slot ? room.roomName : (client.nameOf(slot) ?? `Player ${slot}`),
      team: slot === client.slot ? client.hello?.team : client.teamOf(slot),
      local: slot === client.slot,
    });
    if (row.type === 'radio' && Number.isInteger(row.msg) && row.slot != null) {
      const at = Array.isArray(row.at) ? { x: row.at[0], y: row.at[1], z: row.at[2] } : null;
      comms.receive(row.msg, { ...who(row.slot), position: at });
    } else if (row.type === 'chat' && typeof row.text === 'string') {
      // Another player's line (the server never sends a player his own), or
      // the server's, which names nobody: the retail chat-box format.
      if (row.slot == null) { comms.chatLine?.(row.text, 0); return; }
      const sender = who(row.slot);
      comms.chatLine?.(playerChatLine(sender.name, row.text,
        { teamOnly: !!row.team, team: sender.team, strings: comms.lexicon?.()?.strings }), sender.team ?? 0);
    } else if (row.type === 'killed' && row.slot != null && !row.cleared) {
      // A round's end kills everyone (`clearWorld`) with no line of its own.
      comms.onKill(who(row.slot), row.other != null ? who(row.other) : null);
    } else if (row.type === 'captured' && !row.quiet && Number.isInteger(row.flag) && page.flags[row.flag]) {
      // The first report of a point is how the round stood at the join: no line.
      comms.onCapture(page.flags[row.flag], row.team);
    } else if (row.type === 'ctf') {
      // A CTF flag event of the server's law (`server/authority.mjs`): the
      // page's copy plays it, with the actor's name (`ctf-page.js` `onRow`).
      // A flag that went home on its own timer names nobody.
      page.ctfRow?.({ ...row, name: row.player != null ? who(row.player).name : '' });
    }
  }

  /** The local player's radio, to the room. */
  room.sendRadio = (msg, team) => {
    if (room.roomJoined) room.roomClient?.radio(msg, team);
  };

  /** The local player's typed chat line, all or team, to the server (the
   *  sidecar client only; a room has no chat). The server never echoes a
   *  line to its sender, so the page writes its own. */
  room.sendChat = (text, team = false) => {
    const client = room.roomClient;
    if (!room.roomJoined || typeof client?.chat !== 'function' || !String(text ?? '').trim()) return false;
    client.chat(text, team);
    const side = client.hello?.team ?? 0;
    page.comms?.chatLine?.(playerChatLine(room.roomName, text,
      { teamOnly: !!team, team: side, strings: page.comms?.lexicon?.()?.strings }), side);
    return true;
  };

  /** map.html's level list, once its top-level await has settled. */
  async function manifestWhenReady() {
    for (;;) {
      try { if (page.manifest) return page.manifest; } catch { /* still in its TDZ */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /** The hull the local player drives, corrected the retail client's way: at
   *  the acked tick, whole, the newer ticks on top (netcode-reconcile.js
   *  `createHullReconciler`). Against the present pose instead, the round
   *  trip read as error: 2 m at 12 m/s, the hull dragged back as it drove. */
  const hullLedger = createHullReconciler();
  function recordHullTick(seq, P, at, vAt) {
    hullLedger.record(seq, P[at], P[at + 1], P[at + 2], P[at + 3], P[at + 4], P[at + 5], P[at + 6],
      P[vAt], P[vAt + 1], P[vAt + 2]);
  }
  function correctDrivenHull() {
    const occ = page.occupancy;
    const st = occ?.drive?.state;
    if (!st?.position) return;
    const id = netVehicleIdFor(occ.root);
    const pose = id != null ? room.roomClient.remoteVehicle(id) : null;
    if (!pose) return;
    // Just seated: the page's parked copy can stand a metre or two from the
    // server's hull and holds no prediction yet, so it starts from the
    // server's pose exactly, and the ledger from here.
    const fresh = room.netHullRoot !== occ.root;
    room.netHullRoot = occ.root;
    // A drive that has gone non-finite is put back where the server has it.
    const lost = !Number.isFinite(st.position.x + st.position.y + st.position.z);
    if (lost) room.netHullBad = (room.netHullBad ?? 0) + 1;
    if (fresh || lost) {
      hullLedger.reset();
      st.position.set(pose.x, pose.y, pose.z);
      if (pose.q && st.orientation) st.orientation.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      st.velocity?.set(0, 0, 0);
      room.netHullSnaps = (room.netHullSnaps ?? 0) + 1;
      room.netHullCorrection = { id, error: 0, acked: null };
      return;
    }
    // The tick the server's state describes: the newest it acknowledged. The
    // ack row carries the hull's own state at that tick (sidecar.mjs), the
    // whole of what the retail client's readControlObjectState sets:
    // position, rotation and velocity. The newest transform row stands in
    // for an older sidecar's ack, without a velocity.
    const ack = room.roomClient.selfPlayer?.()?.ack ?? 0;
    const acked = room.roomClient.selfHull?.();
    const exact = acked && acked.id === id && acked.ack === ack ? acked : null;
    const plan = hullLedger.accept(exact ?? pose, ack, st);
    if (plan) room.netHullCorrection = { id, ...plan };
  }

  /** Remote soldiers holding a trigger (the sidecar's 'shot' rows with
   *  `hold`): their rounds at the weapon's own rate on the engine's whole
   *  1/30 s ticks (`net-remote-rounds.js` `cycle`, GUN-13: a Greasegun every
   *  4th tick), until the fire state ends. The vanilla automatic's 3 ticks
   *  until his weapon has loaded. The schedule keeps its phase, so the 25 ms
   *  poll does not stretch every interval. */
  const REMOTE_ROUND_MS = 100;
  const remoteTriggers = new Map(); // slot -> { weapon, next }
  const remoteRoundMs = (slot, weapon) => {
    const cycle = remoteRounds?.cycle?.(`slot${slot}`, weapon);
    return cycle > 0 ? cycle * 1000 : REMOTE_ROUND_MS;
  };
  setInterval(() => {
    if (!remoteTriggers.size || !room.roomJoined) return;
    const now = performance.now();
    for (const [slot, trig] of remoteTriggers) {
      if (now < trig.next) continue;
      trig.next = Math.max(trig.next + remoteRoundMs(slot, trig.weapon), now);
      const at = room.roomClient.remotePlayer(slot);
      if (!at?.alive || at.inVehicle) { remoteTriggers.delete(slot); continue; }
      page.playWorldShot?.(trig.weapon, at.x, at.y + 1.4, at.z, `remote:${slot}`);
      remoteRound(slot, trig.weapon, at);
      // The engine enters its one-shot fire state again on every round while
      // the trigger is down, so each round of a burst restarts the clip.
      room.roomRenderer?.fire?.(slot);
    }
  }, 25);

  /** The flash and the round of a remote soldier's shot (net-remote-rounds.js). */
  let remoteRounds = null;
  function remoteRound(slot, weapon, at) {
    if (!sidecarUrl || !at?.alive) return;
    remoteRounds ??= createRemoteRounds({
      scene: page.scene, loader: page.loader, modelsBase: page.MODELS_BASE, bust: page.bust,
      guns: () => page.guns, shadeModel: root => page.bindDynamicShading(root),
    });
    // Down his camera, not his body: the view yaw (the body plus the twist)
    // and the view pitch, 2.5 times the aim register (ledger VIEW-14).
    const rad = Math.PI / 180;
    remoteRounds.fire(`slot${slot}`, weapon, at, (at.viewYaw ?? at.yaw ?? 0) * rad,
      (at.aim ?? 0) * VIEW_PITCH_PER_AIM * rad).catch(() => {});
  }

  /** The kit row a server's kit name names (its casing is not the files'). */
  function kitRow(kit) {
    const kits = page.loadouts?.kits;
    if (!kits || !kit) return null;
    const want = String(kit).toLowerCase();
    const key = Object.keys(kits).find(k => k.toLowerCase() === want);
    return key ? kits[key] : null;
  }

  /**
   * A remote soldier's stab: the report of the FireArms his weapon carries on
   * the right button (`weapons.json` keys it by that FireArms, as the
   * player's own `hand-fire.js stepAltFire` plays it), at him, and the thrust
   * on his drawn body (`netcode-render.js stab`). A room row names both; a
   * sidecar's names his kit and the item his state says he holds
   * (`loadouts.json` `weapons[].slot`), and the FireArms is read off that
   * weapon's glb.
   */
  /** The weapon a remote has in his hands: the item his state names
   *  (`loadouts.json` `weapons[].slot`), else his kit's primary. */
  function heldWeapon(kit, item) {
    const row = kitRow(kit);
    return (Number.isInteger(item) ? row?.weapons?.find(w => w.slot === item)?.weapon : null)
      ?? row?.primary ?? null;
  }

  function remoteStab(row) {
    const at = room.roomClient.remotePlayer(row.slot);
    if (!at?.alive || at.inVehicle || !Number.isFinite(at.x)) return;
    room.netStabRows = (room.netStabRows ?? 0) + 1;
    const kit = kitRow(row.kit ?? at.kit);
    const weapon = row.weapon ?? kit?.weapons?.find(w => w.slot === row.item)?.weapon ?? kit?.primary ?? null;
    if (room.roomRenderer?.stab?.(row.slot, weapon)) room.netStabsDrawn = (room.netStabsDrawn ?? 0) + 1;
    const play = alt => {
      if (alt) page.playWorldShot?.(alt, at.x, at.y + 1.4, at.z, `remote:${row.slot}`);
    };
    if (row.alt) { play(row.alt); return; }
    if (!weapon) return;
    remoteRounds ??= createRemoteRounds({
      scene: page.scene, loader: page.loader, modelsBase: page.MODELS_BASE, bust: page.bust,
      guns: () => page.guns, shadeModel: root => page.bindDynamicShading(root),
    });
    remoteRounds.altName(weapon).then(play, () => {});
  }

  /** The stab the room was last told of: the hand weapon and its press count. */
  let stabTold = null;

  /** The local soldier's stab, to the room as it begins (`hand-alt-fire.js`
   *  counts the presses that began one), named by the weapon and the FireArms
   *  that went off, so the others can play its report at him
   *  (`server/room-control.mjs` `onStab`). */
  function tellStab() {
    const hw = page.handWeapon;
    const alt = hw?.alt;
    if (!alt) { stabTold = null; return; }
    const presses = alt.presses ?? 0;
    if (stabTold?.hw !== hw) { stabTold = { hw, presses }; return; }
    if (presses === stabTold.presses) return;
    stabTold.presses = presses;
    if (!page.soldierDead && hw.name) netSendAction({ type: 'stab', weapon: hw.name, alt: alt.name ?? null });
  }

  /** The server has this player in a hull the page does not: a page loaded
   *  (or reloaded) while he sat in it. The page takes the same seat on its
   *  own copy, quietly; without this its first E pressed Use on the server
   *  and got him out. */
  let adoptingSeat = false;
  let adoptTried = 0;
  function adoptServerSeat(self) {
    if (!page.soldier || page.soldierDead || performance.now() - adoptTried < 2000) return;
    const hull = pageHullOf(room.roomClient.vehicles.get(self.vehicleId));
    room.netAdoptNote = { vehicle: self.vehicleId, bound: !!hull?.node };
    // Only a hull the page cannot find waits to be asked again: a seat the
    // server gives is taken on the snapshot that says so.
    if (!hull?.node) { adoptTried = performance.now(); return; }
    adoptingSeat = true;
    try {
      page.enterVehicle({ vehicle: hull.node, seatId: null, granted: true });
      if (self.seatIndex > 0 && page.occupancy) page.switchSeat?.(self.seatIndex);
    } finally { adoptingSeat = false; }
    // Refused all the same (a seat this page holds for someone else): wait
    // before asking again rather than on every snapshot.
    if (!page.occupancy) { adoptTried = performance.now(); room.netAdoptNote.refused = true; return; }
    room.netSeatAdopted = (room.netSeatAdopted ?? 0) + 1;
  }

  /** Seated in the hull the server has him in, but not in its seat: take the
   *  server's seat (a switch it made, or one it refused). Once per 2 s for a
   *  seat index the page cannot take, rather than every snapshot. */
  let seatFollowTried = 0;
  function followServerSeat() {
    const self = room.roomClient.selfPlayer?.();
    const occ = page.occupancy;
    if (!occ || !self?.inVehicle || !Number.isInteger(self.seatIndex)) return;
    if (netVehicleIdFor(occ.root) !== self.vehicleId) return;
    const mine = occ.order.indexOf(occ.activeSeatId);
    if (mine === self.seatIndex || performance.now() - seatFollowTried < 2000) return;
    seatFollowTried = performance.now();
    adoptingSeat = true;
    try { page.switchSeat?.(self.seatIndex); } finally { adoptingSeat = false; }
    room.netSeatFollowed = (room.netSeatFollowed ?? 0) + 1;
  }

  /** The other way round: the page sits in a hull the server has the player
   *  out of (an exit the page's own rules refused, a hull the server took
   *  from him). Past a grace for the round trip of his own exit or seat row,
   *  the page gets out too, quietly. */
  let seatMismatchSince = 0;
  function leaveSeatServerLeft() {
    const self = room.roomClient.selfPlayer?.();
    if (!page.occupancy || !self?.alive || self.inVehicle) { seatMismatchSince = 0; return; }
    const now = performance.now();
    // With the server giving the seats the page never sits ahead of it, so
    // the server's word is the exit itself: no grace for a round trip.
    if (!room.serverSeats()) {
      if (!seatMismatchSince) { seatMismatchSince = now; return; }
      if (now - seatMismatchSince < 1500) return;
    }
    seatMismatchSince = 0;
    adoptingSeat = true;
    try { page.exitSeat(); } finally { adoptingSeat = false; }
    room.netSeatLeft = (room.netSeatLeft ?? 0) + 1;
  }

  /** Against a real server the seat is the server's to give. Retail's E is
   *  c_PIUse on the input word (SEAT-1); `checkPlayerTriggers` ->
   *  `toggleEntryPoint` -> `BFfindEntryPoint` decide on the server, from where
   *  the SERVER has the soldier, and the client changes seat only when the
   *  server's enter or exit arrives. A page that seated itself on its own copy
   *  boarded hulls the server had not given it: on 2026-10-16 the page sat in
   *  its parked copy of the south base Sherman while the server's (a bot's,
   *  at the beach) was 170 m away, its hull was then thrown to the beach and
   *  back, and the server never had the player in it. */
  room.serverSeats = () => !!(sidecarUrl && room.roomJoined);
  /** A seat switch (1..9), as the server hears it: c_PIMenuSelect on the
   *  input word, with no local change; the server's own seat row moves the
   *  page (`followServerSeat`). The adoption itself switches locally. */
  room.requestSeatSwitch = position => {
    if (!room.serverSeats() || adoptingSeat || !room.roomClient) return false;
    const id = page.occupancy ? netVehicleIdFor(page.occupancy.root) : null;
    room.roomClient.action({ type: 'seat', action: 'switch', vehicle: id, seat: position });
    return true;
  };
  /** E, as the server hears it: Use, with no local change. True when sent. */
  room.requestSeatToggle = () => {
    if (!room.serverSeats() || !room.roomClient) return false;
    room.roomClient.action({ type: 'seat', action: page.occupancy ? 'exit' : 'enter' });
    return true;
  };

  async function joinRoom() {
    if ((!roomCode && !sidecarUrl) || room.roomClient) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      // The sidecar's URL is the whole address (it is not behind the page's
      // own host), so it is used as given.
      const ws = new WebSocket(sidecarUrl || `${proto}${location.host}/netcode`);
      // The server only ever sends binary frames; say so before the first one
      // lands (the hello follows the join immediately).
      ws.binaryType = 'arraybuffer';
      room.roomClient = sidecarUrl
        ? createSidecarClient({ ws, now: () => performance.now() })
        : createRoomClient({ ws, now: () => performance.now() });
      // Against a real server, the retail client's own law: the control-object
      // state's handler (BF1942.exe 0x00491c90, reached from the client's
      // readControlObjectState at 0x00496be8 through IGameClient vt+0xa0)
      // drops the acknowledged actions, puts the body at the server's state and
      // re-runs every unacknowledged action at the fixed tick. No smoothing and
      // no threshold: the whole error at the acked tick, then the replay. The
      // reconciler's rebase is that replay (the recorded displacement since the
      // acked tick), so a smoothing of 1 is the port. y stays the local ground
      // solver's: the replay re-solves it against the same terrain.
      room.netReconciler = sidecarUrl ? createReconciler({ smoothing: 1, facing: 'acked' }) : createReconciler();
      room.roomRenderer = createRemoteRenderer({
        scene: page.scene, camera: page.camera, loader: page.loader, bust: page.bust,
        modelsBase: page.MODELS_BASE,
        // The engine's vehicle lighting, as the level's own vehicles get it —
        // replicas are drawn the way replay.js draws recorded ones.
        shadeModel: root => page.bindDynamicShading(root),
        onOccupyChange: hideParkedHull,
        // The hull this page is sitting in, or null. A replica of it must
        // never be drawn: the page already draws that hull from its own
        // simulation and the server's corrections, and a second, snapshot-lerped
        // copy of the same aircraft shivers against it (live, 2026-10-17: a
        // retail gunner in seat 2 of the page's Stuka, steady on his screen,
        // shaking left and right on the page's).
        ownVehicleId: () => (page.occupancy ? netVehicleIdFor(page.occupancy.root) : null),
        // A remote wears his side's soldier on this level and his kit: the
        // kit's primary in his hands and its helmet and packs on his bones,
        // as a bot does (bot-visuals.js). The kit is the server's template
        // name, whose casing the kit files do not share.
        soldierTemplateFor: team => page.soldierTemplateFor?.({ team }) ?? null,
        kitPrimary: kit => {
          const kits = page.loadouts?.kits;
          if (!kits || !kit) return null;
          const want = String(kit).toLowerCase();
          const key = Object.keys(kits).find(k => k.toLowerCase() === want);
          return key ? (kits[key].primary ?? null) : null;
        },
        soldierDress: page.soldierDress ?? null,
        // What he actually holds, so the body is built on that grip rather
        // than always on the kit's primary.
        kitHeld: (kit, item) => heldWeapon(kit, item),
      });
      // The server's own ordnance and the guns that threw it: a real server
      // pools its rounds (`projPool`) and names each vehicle shot (the `f`
      // row's hull, gun template, muzzle and axis). Neither was drawn before
      // -- bombs never fell, tank shells never flew and no vehicle weapon
      // ever flashed (live, 2026-10-17).
      room.serverRounds = sidecarUrl ? createServerRounds({
        scene: page.scene, loader: page.loader, modelsBase: page.MODELS_BASE, bust: page.bust,
        guns: () => page.guns, effects: () => page.guns?.effects ?? null,
        shadeModel: root => page.bindDynamicShading(root),
        templateOf: id => room.roomClient?.vehicles.get(id)?.template ?? null,
      }) : null;
      room.roomClient.onevent = row => {
        room.serverRounds?.onRow(row);
        if (row?.text) page.logToConsole(row.text);
        // First, so the message log below has the flag too (it printed no
        // capture line for a real server's capture, live 2026-10-17).
        // A sidecar names the point by its template (a real server sends no
        // flag index); the page's flag carries the same name.
        if (row.type === 'captured' && !Number.isInteger(row.flag) && row.cp) {
          const want = String(row.cp).toLowerCase();
          const index = page.flags.findIndex(f => String(f.controlPointName || '').toLowerCase() === want);
          if (index >= 0) row.flag = index;
          // The page's flags are built with its level, after the sidecar's
          // first rows: keep the row and try again each frame (syncHulls).
          else if (!page.flags.length) { pendingCaptures.set(want, row); }
        }
        roomRowToComms(row);
        // P3: death by server decree. The page's own death loop
        // (`soldierDead` latch on a destroyed Armor) is the cam, the deploy
        // screen and the spectator work — the decree only has to make the
        // Armor agree with the server's. The suicide path's own precedent
        // (`soldierArmor.applyDamage(maxHitPoints)`).
        // The server's wash and arc for this player's own hurt (HitFromPos):
        // on a real server the page's HUD takes them from here alone.
        if (row.type === 'hitFrom') page.triggerHitIndicator?.(row.dir, row.alpha);
        if (row.type === 'killed' && row.slot === room.roomClient.slot
            && page.soldierArmor && !page.soldierDead) {
          // Killed in a seat: the death loop latches on the Armor, and the
          // Armor is the soldier's, so a seated player took the decree and
          // went on sitting there -- `__seat()` still named the hull, the
          // trigger still went to its gun, and no deploy screen came up. The
          // seat is a prediction the server has just ended, the way
          // `seatRefused` ends one; put him out of it before he dies in it
          // (live, 2026-10-17: killed in a PanzerIV's MG, the page fired from
          // that seat as a corpse until the pilot was restarted).
          if (page.occupancy) page.exitSeat();
          page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
        }
        // The server would not spawn this body (ROUND-11: the round is not
        // playing, or the side is out of tickets): the page's own spawn was
        // only a prediction, so it dies back to the spawn screen.
        if (row.type === 'spawnRefused' && page.soldierArmor && !page.soldierDead) {
          page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
        }
        // The server would not seat him (the hull is the other side's, the
        // seat would not take him): the page's own seat was a prediction, so
        // he is put out of it, and the snapshots put him where the server
        // has him standing.
        if (row.type === 'seatRefused' && row.slot === room.roomClient.slot && page.occupancy
            && netVehicleIdFor(page.occupancy.root) === row.vehicle) {
          page.exitSeat();
        }
        // The round's end and the restart are the server's (ROUND-9): the
        // page's round takes the result and its debriefing shows it; the
        // restart row puts the field back the way the server has it.
        if (row.type === 'roundEnd') page.roundEndRow?.(row);
        if (row.type === 'restart') page.restartRow?.(row);
        // The server loaded a level (net-sidecar.js setLevel): another map,
        // or the same one restarted. Another map is a reload of the page on
        // it, the one clean way to switch (onjoined's own law); the same map
        // starts the round over -- the old world's replicas go, the flags
        // and tickets come from the rows the server resends behind the load,
        // and the player is back on the deploy screen.
        if (row.type === 'levelChange') {
          const asked = (page.params.get('map') || '').toLowerCase();
          const want = String(row.level || '').toLowerCase();
          // The server's game type too: another layer is another set of pads,
          // flags and hulls, and the page loads one layer per load.
          const askedMode = (page.params.get('mode') || '').toLowerCase();
          const otherMode = row.mode && String(row.mode).toLowerCase() !== (askedMode || 'conquest');
          if ((want && asked && want !== asked) || otherMode) {
            const q = new URLSearchParams(location.search);
            if (want) q.set('map', want);
            if (row.mode) q.set('mode', row.mode);
            room.leaving = true;
            location.replace(`${location.pathname}?${q}`);
            return;
          }
          room.roomRenderer?.reset();
          room.netReconciler?.reset();
          room.levelChanges = (room.levelChanges ?? 0) + 1;
          page.logToConsole(`the server restarted ${row.level ?? 'the map'}`);
          page.restartRow?.({ type: 'restart', flags: null });
        }
        // The pads and the hulls are the server's (`server/room-pads.mjs`).
        if (row.type === 'padSpawn' || row.type === 'vehicleGone' || row.type === 'hull') noteHull(row);
        if (row.type === 'object' && Number.isInteger(row.node)) noteObject(row.node, row.hp, row.destroyed);
        // A blast the room priced (`server/room-hits.mjs`): this soldier's own
        // push; another's flight is in the snapshot (`netcode.js` `FLIGHT_WIRE`).
        if (row.type === 'blast' && row.slot === room.roomClient.slot) takeBlast(row);
        // Another soldier's magazine change, where he stands: his weapon's
        // Reload slot, as a bot's plays (SND-17). Its own `Volume <- Distance`
        // ramps are why almost nobody hears it past a metre.
        if (row.type === 'reload' && row.slot != null && row.slot !== room.roomClient.slot) {
          const at = room.roomClient.remotePlayer(row.slot);
          if (at && !at.seated && Number.isFinite(at.x)) {
            // `remotePlayer` hands back a new state a call, so the slot's
            // number stands for the man who owns the patch (SND-33).
            page.playWorldReload?.(row.weapon, at.x, at.y + 1.4, at.z, `remote:${row.slot}`);
          }
        }
        // Another player's round (the sidecar's 'shot' row): the report at
        // the shooter, from his kit's primary, or at the hull for a vehicle
        // gun. The local player's own rounds are already his prediction's.
        if (row.type === 'shot') room.netShotRows = (room.netShotRows ?? 0) + 1;
        if (row.type === 'shot' && row.slot !== room.roomClient.slot) {
          const at = row.slot != null ? room.roomClient.remotePlayer(row.slot) : null;
          const hull = row.vehicle != null ? room.roomClient.remoteVehicle?.(row.vehicle)
            : (at?.inVehicle ? room.roomClient.remoteVehicle?.(at.vehicleId) : null);
          const where = hull ?? (at && Number.isFinite(at.x) ? at : null);
          const weapon = row.weapon ?? heldWeapon(row.kit ?? at?.kit, row.item);
          if (where && weapon) page.playWorldShot?.(weapon, where.x, where.y + 1.4, where.z, `remote:${row.slot ?? row.vehicle}`);
          if (at && !hull && weapon) remoteRound(row.slot, weapon, at);
          // And move the man: the flash and the round were drawn and his body
          // never fired (live, 2026-10-17).
          if (row.slot != null && !hull) room.roomRenderer?.fire?.(row.slot);
          if (row.hold && row.slot != null && weapon) remoteTriggers.set(row.slot, { weapon, next: performance.now() + remoteRoundMs(row.slot, weapon) });
        }
        if (row.type === 'shotEnd') remoteTriggers.delete(row.slot);
        if (row.type === 'reload' && row.slot != null && row.slot !== room.roomClient.slot) {
          room.roomRenderer?.reload?.(row.slot);
        }
        // Another soldier's stab (a sidecar's `Ub_AltFire` state, a room
        // page's own stab relayed): its report where he stands and the
        // thrust on his body.
        if (row.type === 'stab' && row.slot != null && row.slot !== room.roomClient.slot) remoteStab(row);
        // Flags move by decree too: the deploy screen's list and the map's
        // markers read `flags[]` live, so a team write is the whole repaint.
        if (row.type === 'captured' && Number.isInteger(row.flag)
            && page.flags[row.flag] && page.flags[row.flag].team !== row.team) {
          const prevTeam = page.flags[row.flag].team;
          page.flags[row.flag].team = row.team;
          page.hoistCaptureFlag(page.flags[row.flag]);
          if (!row.quiet) page.announceCapture(prevTeam, row.team);
          page.syncVehicleSpawnOwnership();
          page.applyVisibility();
          if (typeof page.paintDeployChrome === 'function') page.paintDeployChrome();
        }
        // The tickets: the layout's own group reads `extras.tickets` — the
        // memoised painters re-run when the object CHANGES, so a fresh object
        // per row is the page's own prescribed live-update path (the comment
        // at `ticketFlagTexture`: "mutated the counts IN PLACE would have to
        // bump the key here too" — a replacement bumps it for us).
        // Before the level's extras exist the count waits (syncHulls).
        if (row.type === 'ticket' && Number.isFinite(row.count)) pendingTickets.set(row.team, row);
        if (row.type === 'ticket' && Number.isFinite(row.count) && page.extras) {
          const key = `team${row.team}`;
          if (page.extras.tickets?.[key] !== row.count) {
            page.extras.tickets = {
              ...page.extras.tickets,
              [key]: row.count,
            };
          }
        }
      };
      // P3/P4: the snapshot is the server's word. HP drops apply (never heals —
      // the supply depots heal both sides, and the server's own count absorbs
      // the rest), and the position goes through the correction law: the error
      // is measured at the tick the authority acknowledges, the client's own
      // unacknowledged ticks are replayed on top, and what is left is closed a
      // fraction at a time unless it is large enough to be a different event
      // (netcode-reconcile.js owns every one of those decisions and its own
      // numbers). Only when the local player is alive and on foot — a seated
      // player's snapshot position is the hull's.
      room.roomClient.onsnapshot = snap => {
        followRoomTick(snap.tick);
        if (sidecarUrl && page.occupancy) { followServerSeat(); correctDrivenHull(); }
        // Out of the hull: the next seat, even in the same hull, starts fresh.
        else room.netHullRoot = null;
        if (sidecarUrl) leaveSeatServerLeft();
        if (!page.soldier || page.soldierDead || !page.soldierArmor) return;
        if (page.optPilot.checked || !page.optOnFoot.checked) return;
        let self = null;
        for (const p of snap.players) {
          if (p.slot === room.roomClient.slot) { self = p; break; }
        }
        if (!self || !self.alive) return;
        if (self.hp != null && self.hp < page.soldierArmor.hitPoints - NET_HP_GRACE) {
          page.soldierArmor.applyDamage(page.soldierArmor.hitPoints - self.hp);
        }
        if (self.seated || self.inVehicle) {
          if (sidecarUrl && !page.occupancy) adoptServerSeat(self);
          return;
        }
        const plan = room.netReconciler?.accept(self, page.soldier);
        if (!plan) return;
        netPlaceSoldier(plan.x, plan.hard ? plan.y : null, plan.z);
        // The facing: the one divergence that grows without bound if nothing
        // repairs it (netcode-reconcile.js's `yawDeltaOf`). Against a real
        // server it is the retail client's law: the server's view yaw at the
        // acked tick against this page's own yaw at that tick, closed whole,
        // the newer turns riding on top. (A pull toward the server's yaw
        // against the CURRENT one dragged the view back a round trip, and
        // taking it only on a hard set left a standing soldier's body yaw,
        // which is not his view, as the page's heading for a whole life: 48
        // degrees off, every ack dragging the body sideways, live 2026-10-16.)
        if (plan.yawDelta) page.soldier.body.yaw += plan.yawDelta;
        // The view's pitch, the same way (`look` keeps it in the soldier's
        // clamp).
        if (plan.pitchDelta) page.soldier.look(0, plan.pitchDelta);
        room.netLastCorrection = { error: plan.error, hard: plan.hard,
                              replayed: plan.replayed, acked: plan.acked };
        room.netCorrectionCount++;
        if (plan.hard) room.netHardCorrectionCount++;
      };
      room.roomClient.onclosed = code => {
        const wasIn = room.roomJoined;
        room.roomJoined = false;
        if (room.roomPingTimer !== null) { clearInterval(room.roomPingTimer); room.roomPingTimer = null; }
        room.roomRenderer?.reset();
        if (wasIn) page.logToConsole(`room closed (${code})`);
        // The reason, on the screen: a dropped round or a refused join both
        // end in this modal — the message names the failure and the two
        // ways back in.
        const message = ROOM_CLOSE_MESSAGES[code]
          ?? (typeof code === 'string' && code ? `the room closed: ${code}` : null);
        if (message) roomIssueShow(code, message.toUpperCase());
      };
      room.roomClient.onjoined = async () => {
        // A real server names the player (the sidecar's --name, or name_1 when
        // the server still holds a dropped connection's player under it): the
        // scoreboard, the message log and the kill lines use the server's.
        if (sidecarUrl && room.roomClient.hello?.name) room.roomName = room.roomClient.hello.name;
        // The page's level list is a top-level await in map.html that this
        // module can be called ahead of: reading it before it settles throws
        // (a TDZ ReferenceError). A room's hello used to arrive after it; the
        // sidecar replays its feed the moment the socket opens, so its join
        // lands first. Wait for the list rather than read it early.
        const manifest = await manifestWhenReady();
        room.roomJoined = true;
        roomIssueHide();
        // (The heartbeat was already running — it starts at open, see above,
        // so the join's own silence during the page's load is covered.)
        // The room names the level it runs. When the URL already asked for
        // that level the page's own load covers it; when it asked for
        // another (or nothing), the ONE clean way to switch is a reload with
        // the room's level in the URL — `show()` is not safe to run twice,
        // and the manifest flow would be mid-flight in the same breath. The
        // reload re-joins the same room from the URL and loads once.
        const want = (room.roomClient.hello.level || '').toLowerCase();
        const asked = (page.params.get('map') || '').toLowerCase();
        // The layer too: a room plays one (`?mode=`, the level's default when
        // its creator named none), and a page on another has other flags,
        // pads and vehicles. A page with no `?mode=` already has the default.
        const wantMode = room.roomClient.hello.mode || '';
        const askedMode = page.params.get('mode') || '';
        const otherMode = wantMode
          && (askedMode ? askedMode.toLowerCase() !== wantMode.toLowerCase()
            : room.roomClient.hello.modeDefault === false);
        const otherLevel = want && asked !== want && manifest.some(e => e.name.toLowerCase() === want);
        if (otherLevel || otherMode) {
          const q = new URLSearchParams(location.search);
          if (otherLevel) q.set('map', want);
          if (otherMode) q.set('mode', wantMode);
          // Leaving on purpose: the level load in flight is aborted with the
          // page, and its rejected fetch is not an error (map.html's first
          // `level.show`).
          room.leaving = true;
          location.replace(`${location.pathname}?${q}`);
          return;
        }
        // Joined mid-way through a round's end: its debriefing and countdown.
        if (room.roomClient.hello.round?.status === 'endGame') page.roundEndRow?.(room.roomClient.hello.round);
        page.logToConsole(`room ${room.roomClient.hello.room} · ${room.roomClient.hello.level} · slot ${room.roomClient.slot}`);
        page.logToConsole(`you are on team ${room.roomClient.hello.team === 1 ? 'AXIS' : 'ALLIED'}`);
        // The room names the team; the deploy screen rides it.
        page.setDeployTeam(room.roomClient.hello.team === 1 ? 1 : 2, false);
        if (!page.deployActive()) page.openDeploy();
      };
      ws.addEventListener('message', e => {
        // Binary frames only (see above); a string would be a server that is
        // not the room server, and is ignored rather than misparsed. The
        // sidecar is the exception: its feed is JSON text, one v5 record per
        // frame, so text is exactly what it is supposed to send.
        if (typeof e.data === 'string' && !sidecarUrl) return;
        room.roomClient?.handleMessage(e.data);
      });
      ws.addEventListener('error', e => {
        console.warn('room socket error', e.message ?? e);
        // The close that follows the error is the one that speaks.
      });
      ws.addEventListener('close', e => {
        // The room server's own close codes ride the wire as MSG_CLOSED rows
        // (netcode.js); a bare transport close is the silent-timeout law or a
        // network drop, and the console should say which side ended it.
        console.log('room socket closed', e.code, e.reason);
        // A join that never happened must say so: a missing room server
        // otherwise leaves a silently empty map. A deliberate teardown never
        // reaches the modal (the guard below reads the teardown flag).
        const failed = roomCode && !room.roomJoined && !room.roomTornDown;
        netTeardownRoom();
        if (failed) {
          roomIssueShow(null,
            "CAN'T REACH THE ROOM SERVER\n"
            + 'Make sure it is running, then RETRY — or play solo.');
        }
      });
      // What the other players in the room are drawing: the clip family each
      // replica settled on, what its rig bound, and the speed that chose it.
      window.__remotes = () => room.roomRenderer?.debugSoldiers() ?? [];
      window.__netDiag = () => ({
        readyState: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
        clientState: room.roomClient?.state ?? null,
        hello: room.roomClient?.hello ?? null,
        captured: page.captured,
        lockHeld: page.lockHeld,
        pointerLock: document.pointerLockElement === page.renderer.domElement,
      });
      // Send the join when the socket is open (or now, if it already is) —
      // `send` before the handshake throws, and a silent drop would just look
      // like a server that never answered.
      const sendJoin = () => room.roomClient?.join({
        room: roomCode,
        name: roomName,
        // A sidecar join may name a side (`?team=`, 1 Axis 2 Allied); the
        // spawn itself is the deploy screen's (spawning.js sends the side, the
        // kit and the spawn group, and the sidecar turns them into the
        // engine's SetTeam, ChangeKit and SpawnRequest). The room path's join
        // is unchanged: a room's team is chosen in the spawn screen.
        team: sidecarUrl ? Number(page.params.get('team') ?? 0) : 0,
        // Create-on-join names the level the room was made on (rooms.mjs),
        // and the layer (`?mode=`); joining an existing room ignores both.
        level: page.params.get('map') || undefined,
        mode: page.params.get('mode') || undefined,
      });
      // Heartbeat from the handshake on: the page's own level load starves
      // its main thread for seconds at a time (GLB parses), and the server's
      // silence window (rooms.mjs HEARTBEAT_TIMEOUT_MS) must not end a
      // connection whose join is still queued behind that burst.
      const startPing = () => {
        if (room.roomPingTimer !== null) clearInterval(room.roomPingTimer);
        room.roomPingTimer = setInterval(() => room.roomClient?.ping(), 4000);
      };
      if (ws.readyState === WebSocket.OPEN) {
        startPing();
        sendJoin();
      } else {
        ws.addEventListener('open', () => {
          startPing();
          sendJoin();
        });
      }
      window.addEventListener('beforeunload', netTeardownRoom);
      window.__net = () => ({
        levelChanges: room.levelChanges ?? 0,
        connected: room.roomJoined,
        slot: room.roomClient?.slot ?? null,
        level: room.roomClient?.hello?.level ?? null,
        remoteSlots: room.roomJoined ? room.roomClient.remoteSlots() : [],
        // Each remote slot's player name, as the roster has it.
        remoteNames: room.roomJoined ? Object.fromEntries(room.roomClient.remoteSlots().map(s => [s, room.roomClient.nameOf(s)])) : {},
        // `at` (performance.now()) reads the pose as drawn; without it, the newest sample.
        remote: (s, at) => room.roomJoined ? room.roomClient.remotePlayer(s, at ?? null) : null,
        snapCount: room.roomJoined ? room.roomClient.snapCount() : 0,
        feed: room.roomJoined ? [...room.roomClient.feed] : [],
        sent: room.roomJoined ? [...room.roomClient.sentActions] : [],
        // The authority's own row for this body, straight off the wire: what
        // the correction law measured against.
        self: room.roomJoined ? room.roomClient.selfPlayer() : null,
        // P4's correction ledger: what the last correction measured, how many
        // have run and how many of those had to be hard-set. A healthy room
        // walks with `hardCorrections` at 0 and `error` in centimetres.
        correction: room.netLastCorrection,
        corrections: room.netCorrectionCount,
        hardCorrections: room.netHardCorrectionCount,
        // The driven hull against the server's (correctDrivenHull).
        hull: room.netHullCorrection ?? null,
        shotRows: room.netShotRows ?? 0,
        stabRows: room.netStabRows ?? 0, stabsDrawn: room.netStabsDrawn ?? 0,
        seatAdopted: room.netSeatAdopted ?? 0,
        seatLeft: room.netSeatLeft ?? 0,
        seatFollowed: room.netSeatFollowed ?? 0,
        // Room vehicles a remote occupies, whose parked copies are held hidden.
        remoteHeld: [...remoteHeld],
        adoptNote: room.netAdoptNote ?? null,
        rounds: remoteRounds?.debug() ?? null,
        hullSnaps: room.netHullSnaps ?? 0,
        hullBad: room.netHullBad ?? 0,
        pending: room.netReconciler?.pending() ?? 0,
        // The room's hulls against the page's copies: the server's word
        // (`live`, its hit points) and whether the page stands the hull
        // (`level-statics.js` `vehicleSpawnActive`); null where the page
        // finds no copy of it.
        hulls: room.roomJoined ? [...room.roomClient.vehicles.values()].map(v => {
          const hull = pageHullOf(v);
          // Where the page looked for a copy it did not find: the node
          // index, and the pad's own record (its templates), if it has one.
          const record = v.pad != null ? page.vehiclePads?.pads?.find(r => r.index === v.pad) : null;
          const why = hull ? null : { node: v.node ?? null, record: record ? [...record.nodes.keys()] : null,
                                      levelNodes: hullIndex().byLevel.size };
          return { id: v.id, template: v.template, pad: v.pad ?? null, live: !!v.live, why,
                   hp: v.hp ?? null, owner: hull?.owner ?? null,
                   page: hull ? page.vehiclePads.vehicleSpawnActive(hull.node) : null,
                   pageHp: hull ? page.vehicleDamage?.get(hull.owner)?.hitPoints ?? null : null };
        }) : [],
        ack: room.netReconciler?.lastAck() ?? 0,
        sentSeq: room.roomJoined ? room.roomClient.sentSeq() : 0,
        close: netTeardownRoom,
      });
      // A room vehicle's pose as the server has it, in the page's frame.
      // `at` (performance.now()) reads the pose as drawn; without it, the newest sample.
      window.__sidecarPose = (id, at) => (room.roomJoined ? room.roomClient.remoteVehicle(id, at ?? null) : null);
      // And the page's own copy of it (the parked hull it is bound to).
      window.__roomHullAt = id => {
        const hull = pageHullOf(room.roomClient?.vehicles.get(id));
        if (!hull) return null;
        hull.node.updateWorldMatrix(true, false);
        const e = hull.node.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14], owner: hull.owner, visible: hull.node.visible };
      };
      // The E-key seat toggle, exposed the way __deploy and __keys are: the
      // smoke drives this instead of a pointer-lock keypress.
      window.__seatToggle = () => {
        if (room.requestSeatToggle()) return;
        if (page.optPilot.checked && page.occupancy) page.exitSeat();
        else if (page.optOnFoot.checked && page.soldier && page.captured && page.nearEntry) page.enterVehicle(page.nearEntry);
      };
      window.__seat = () => ({
        pilot: page.optPilot.checked,
        onboard: !!page.occupancy,
        vehicle: page.occupancy?.root?.userData?.control ?? null,
        seat: page.occupancy ? page.occupancy.order.indexOf(page.occupancy.activeSeatId) : null,
      });
    } catch (err) {
      console.warn('room unavailable', err);
      page.logToConsole('multiplayer unavailable — playing solo');
      room.roomClient = null;
    }
  }

  if (roomCode || sidecarUrl) joinRoom();


  /** The hand weapon whose magazine change the room was last told of. */
  let reloadTold = null;

  /** The local soldier's magazine change, to the room once as it starts
   *  (`hand-fire.js` `startReload` sets the weapon's `reload` clock, by key or
   *  on a dry magazine), named by its weapon so the others can play its Reload
   *  slot at him (`server/room-control.mjs` `onReload`). */
  function tellReload() {
    const hw = page.handWeapon;
    const changing = !!hw && hw.reload > 0 && !page.soldierDead;
    if (changing && reloadTold !== hw) {
      reloadTold = hw;
      if (hw.name) netSendAction({ type: 'reload', weapon: hw.name });
    } else if (!changing && reloadTold === hw) {
      reloadTold = null;
    }
  }

  /** The room's wire, right on the sim core's edge, once a frame after the
   *  world has stepped: `ticks` input words owed, then the remotes drawn. */
  /** The one-shot buttons: a press is an edge the server must see, not a
   *  level it can read again next word (`netcode.js` encodeInput). Held axes
   *  and the trigger are levels and need no carrying. */
  // Only what `encodeInput` carries AS an edge: the kit press and the jump.
  // The stances are levels in the page's word (`prone`, `crouch` are the
  // stance itself, re-sent every word) and need no carrying; the reload and
  // the stab are messages of their own (`tellReload`, `tellStab`).
  const ONE_SHOT_BITS = ['jump'];
  let pendingPress = {};

  room.sendTickInputs = (ticks, input, look, dt) => {
    // The room's wire, right on the sim core's edge: one input word per tick
    // the world consumed (the engine's one-buffered-input-per-tick law — the
    // same input this page just handed the local sim; an unticked frame sends
    // nothing). A frame longer than 33 ms ran several local ticks against this
    // word (world.js `#consume`), so it owes the server that many: one word a
    // frame would leave the authority's catch-up ticks on its zeroed idle word,
    // which is a held trigger released every frame below 30 fps. Then the
    // renderer draws the server-confirmed remotes after the local world's
    // readbacks.
    if (room.roomJoined && input) {
      // A non-repetitive press rides the next word that actually goes out.
      // `frameInput` drains the page's one-shot presses every RENDERED frame
      // (local-player.js `menu: page.takeMenuPress()`), but a word only
      // reaches the wire on a frame that ran a sim tick. The world ticks at
      // 30 Hz and the page paints at the display rate, so at 60 fps half of
      // every MenuSelect, Reload, Lie, jump and Drop was consumed into a
      // frame that sent nothing -- and the page acts on its own press at
      // once, so it switched weapon and the server did not. Live, 2026-10-17:
      // the owner knifed a man and every stab came out of his main gun. The
      // headless pilot runs at 1-3 fps, where `ticks` is never 0, which is
      // why no harness run ever saw it.
      if (!ticks) {
        if (input.menu) pendingPress.menu = input.menu;
        for (const k of ONE_SHOT_BITS) if (input[k]) pendingPress[k] = true;
      } else if (pendingPress.menu || ONE_SHOT_BITS.some(k => pendingPress[k])) {
        input = { ...input };
        if (!input.menu && pendingPress.menu) input.menu = pendingPress.menu;
        for (const k of ONE_SHOT_BITS) if (pendingPress[k]) input[k] = true;
        pendingPress = {};
      }
      // The ledger's tail holds this frame's ticks (capturePresentationTick
      // pushed one triple each); each word is recorded against the pose of the
      // tick it belongs to, so the authority's `ack` lands on the right one.
      // TICK_POSE numbers a tick: the soldier's x, y, z and facing, the
      // driven hull's position and quaternion (capturePresentationTick).
      const P = room.netTickPoses;
      const owed = Math.min(ticks, Math.floor(P.length / TICK_POSE));
      const base = P.length - owed * TICK_POSE;
      for (let i = 0; i < ticks; i++) {
        const seq = room.roomClient.sendInput(input, look);
        const at = base + i * TICK_POSE;
        if (seq && i < owed) {
          room.netReconciler?.recordTick(seq, P[at], P[at + 1], P[at + 2], P[at + 3], P[at + 11]);
          if (Number.isFinite(P[at + 4])) recordHullTick(seq, P, at + 4, at + 12);
        }
      }
    }
    // The ledger is per frame: whatever this frame's ticks produced has either
    // been recorded against a seq or belongs to a frame that sent nothing.
    if (room.netTickPoses.length) room.netTickPoses.length = 0;
    room.syncHulls();
    if (room.roomJoined) { tellReload(); tellStab(); }
    if (room.roomJoined && room.roomRenderer) {
      room.roomRenderer.update(dt, room.roomClient, performance.now());
      room.serverRounds?.update(room.roomClient, performance.now());
    }
  };

  Object.assign(room, {
    netSeatRow,
    netSendAction,
    netTeardownRoom,
    netTickPoses,
    netVehicleIdFor,
    roomName,
  });
  return room;
}
