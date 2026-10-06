// The page in a room (`?room=`): the netcode client, the remote players'
// renderer, the prediction ledger and its reconciler, the seat rows on the
// control channel, the parked-hull replicas, and the room's error card.
// Lifted out of map.html (features/vehicle-instance-refactor Part 2); built
// where the block sat, and the join starts there as it did.

import * as THREE from 'three';
import { createRoomClient } from './netcode-client.js';
import { createRemoteRenderer } from './netcode-render.js';
import { createReconciler } from './netcode-reconcile.js';
import { Knockback } from './knockback.js';

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
    if (v.node != null) node = hullIndex().byLevel.get(v.node) ?? null;
    else if (v.pad != null) {
      const record = page.vehiclePads?.pads?.find(r => r.index === v.pad);
      node = record?.nodes?.get(String(v.template).toLowerCase()) ?? null;
    }
    return node ? { node, owner: ownerOfNode(node) } : null;
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

  function netSendAction(row) {
    if (room.roomJoined && room.roomClient) room.roomClient.action(row);
    // A seat row moves the body somewhere the soldier sim did not walk it
    // (a hull pose, an exit point), so every pose in the prediction ledger
    // describes a different situation from the one the next snapshot will.
    if (row?.type === 'seat') {
      room.netReconciler?.reset();
      netTickPoses.length = 0;
    }
  }

  /** The local scene's parked hull for a room vehicle id: the level node whose
   *  template matches and whose position is closest to the server pose. The
   *  replica draws a remote driver's vehicle, so the parked hull under it must
   *  not double-draw (and it is asleep either way — `damageVisuals`' own node,
   *  the frozen spawn tree, not the body world). */
  function parkedHullFor(vehicleId) {
    if (parkedHullCache.has(vehicleId)) return parkedHullCache.get(vehicleId);
    const v = room.roomClient?.vehicles.get(vehicleId);
    let found = pageHullOf(v)?.node ?? null;
    if (v && !found) {
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
    parkedHullCache.set(vehicleId, found);
    return found;
  }

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
  let hullsSynced = false;
  let posesSynced = false;

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
    if (record.owner != null && record.owner >= 0 && record.damage > 0) {
      const node = page.damageVisuals.get(record.owner)?.node ?? null;
      const id = node ? netVehicleIdFor(node) : null;
      if (id != null) hit = { vehicle: id };
      else if (node?.levelNode != null) hit = { node: node.levelNode };
    }
    if (!hit && !splash) return;
    // A fuse's end-of-life blast stands on the round (`point`); a hand-built
    // one (`__blast`) may name only its centre.
    const point = record.point ?? record.splashPoint;
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
    page.vehiclePads.setRemoteLive?.(hull.node, !!v.live);
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
  room.syncHulls = () => {
    if (!room.roomJoined || !page.vehiclePads?.pads || !page.damageVisuals?.size) return;
    // Once the first snapshot is in: a hull another player moved before this
    // page joined stands where he left it.
    if (!posesSynced && room.roomClient.snapCount() > 0) {
      posesSynced = true;
      for (const id of room.roomClient.vehicles.keys()) placeAtServerPose(id);
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
    room.roomClient?.close();
    room.roomClient = null;
    room.netReconciler = null;
    netTickPoses.length = 0;
    room.netLastCorrection = null;
    parkedHullCache.clear();
    // Solo again: the page's own pads and damage run its level from here on.
    if (page.vehiclePads) page.vehiclePads.remotePads = false;
    if (page.world) page.world.remoteDamage = false;
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
    } else if (row.type === 'killed' && row.slot != null && !row.cleared) {
      // A round's end kills everyone (`clearWorld`) with no line of its own.
      comms.onKill(who(row.slot), row.other != null ? who(row.other) : null);
    } else if (row.type === 'captured' && Number.isInteger(row.flag) && page.flags[row.flag]) {
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

  async function joinRoom() {
    if (!roomCode || room.roomClient) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(`${proto}${location.host}/netcode`);
      // The server only ever sends binary frames; say so before the first one
      // lands (the hello follows the join immediately).
      ws.binaryType = 'arraybuffer';
      room.roomClient = createRoomClient({ ws, now: () => performance.now() });
      room.netReconciler = createReconciler();
      room.roomRenderer = createRemoteRenderer({
        scene: page.scene, camera: page.camera, loader: page.loader, bust: page.bust,
        modelsBase: page.MODELS_BASE,
        // The engine's vehicle lighting, as the level's own vehicles get it —
        // replicas are drawn the way replay.js draws recorded ones.
        shadeModel: root => page.bindDynamicShading(root),
        onOccupyChange: hideParkedHull,
      });
      room.roomClient.onevent = row => {
        if (row?.text) page.logToConsole(row.text);
        roomRowToComms(row);
        // P3: death by server decree. The page's own death loop
        // (`soldierDead` latch on a destroyed Armor) is the cam, the deploy
        // screen and the spectator work — the decree only has to make the
        // Armor agree with the server's. The suicide path's own precedent
        // (`soldierArmor.applyDamage(maxHitPoints)`).
        if (row.type === 'killed' && row.slot === room.roomClient.slot
            && page.soldierArmor && !page.soldierDead) {
          page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
        }
        // The server would not spawn this body (ROUND-11: the round is not
        // playing, or the side is out of tickets): the page's own spawn was
        // only a prediction, so it dies back to the spawn screen.
        if (row.type === 'spawnRefused' && page.soldierArmor && !page.soldierDead) {
          page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
        }
        // The round's end and the restart are the server's (ROUND-9): the
        // page's round takes the result and its debriefing shows it; the
        // restart row puts the field back the way the server has it.
        if (row.type === 'roundEnd') page.roundEndRow?.(row);
        if (row.type === 'restart') page.restartRow?.(row);
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
            page.playWorldReload?.(row.weapon, at.x, at.y + 1.4, at.z);
          }
        }
        // Flags move by decree too: the deploy screen's list and the map's
        // markers read `flags[]` live, so a team write is the whole repaint.
        if (row.type === 'captured' && Number.isInteger(row.flag)
            && page.flags[row.flag]) {
          const prevTeam = page.flags[row.flag].team;
          page.flags[row.flag].team = row.team;
          page.hoistCaptureFlag(page.flags[row.flag]);
          page.announceCapture(prevTeam, row.team);
          page.syncVehicleSpawnOwnership();
          page.applyVisibility();
          if (typeof page.paintDeployChrome === 'function') page.paintDeployChrome();
        }
        // The tickets: the layout's own group reads `extras.tickets` — the
        // memoised painters re-run when the object CHANGES, so a fresh object
        // per row is the page's own prescribed live-update path (the comment
        // at `ticketFlagTexture`: "mutated the counts IN PLACE would have to
        // bump the key here too" — a replacement bumps it for us).
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
        if (self.seated || self.inVehicle) return;
        const plan = room.netReconciler?.accept(self, page.soldier);
        if (!plan) return;
        netPlaceSoldier(plan.x, plan.hard ? plan.y : null, plan.z);
        // The facing, at the same share: the one divergence that grows without
        // bound if nothing repairs it (netcode-reconcile.js's `yawDeltaOf`).
        if (plan.yawDelta) page.soldier.body.yaw += plan.yawDelta;
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
        const otherLevel = want && asked !== want && page.manifest.some(e => e.name.toLowerCase() === want);
        if (otherLevel || otherMode) {
          const q = new URLSearchParams(location.search);
          if (otherLevel) q.set('map', want);
          if (otherMode) q.set('mode', wantMode);
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
        // not the room server, and is ignored rather than misparsed.
        if (typeof e.data === 'string') return;
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
        team: 0,
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
        connected: room.roomJoined,
        slot: room.roomClient?.slot ?? null,
        level: room.roomClient?.hello?.level ?? null,
        remoteSlots: room.roomJoined ? room.roomClient.remoteSlots() : [],
        remote: s => room.roomJoined ? room.roomClient.remotePlayer(s) : null,
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
      // The E-key seat toggle, exposed the way __deploy and __keys are: the
      // smoke drives this instead of a pointer-lock keypress.
      window.__seatToggle = () => {
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

  if (roomCode) joinRoom();


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
      // The ledger's tail holds this frame's ticks (capturePresentationTick
      // pushed one triple each); each word is recorded against the pose of the
      // tick it belongs to, so the authority's `ack` lands on the right one.
      const owed = Math.min(ticks, Math.floor(room.netTickPoses.length / 3));
      const base = room.netTickPoses.length - owed * 3;
      for (let i = 0; i < ticks; i++) {
        const seq = room.roomClient.sendInput(input, look);
        const at = base + i * 3;
        if (seq && i < owed) {
          room.netReconciler?.recordTick(seq, room.netTickPoses[at], room.netTickPoses[at + 1],
            room.netTickPoses[at + 2]);
        }
      }
    }
    // The ledger is per frame: whatever this frame's ticks produced has either
    // been recorded against a seq or belongs to a frame that sent nothing.
    if (room.netTickPoses.length) room.netTickPoses.length = 0;
    room.syncHulls();
    if (room.roomJoined) tellReload();
    if (room.roomJoined && room.roomRenderer) {
      room.roomRenderer.update(dt, room.roomClient, performance.now());
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
