// The page in a room (`?room=`): the netcode client, the remote players'
// renderer, the prediction ledger and its reconciler, the seat rows on the
// control channel, the parked-hull replicas, and the room's error card.
// Lifted out of map.html (features/vehicle-instance-refactor Part 2); built
// where the block sat, and the join starts there as it did.

import * as THREE from 'three';
import { createRoomClient } from './netcode-client.js';
import { createRemoteRenderer } from './netcode-render.js';
import { createReconciler } from './netcode-reconcile.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `announceCapture`, `applyVisibility`, `bindDynamicShading`, `bust`,
 * `camera`, `captured`, `damageVisuals`, `deployActive`, `enterVehicle`,
 * `exitSeat`, `extras`, `flags`, `hoistCaptureFlag`, `loader`, `lockHeld`,
 * `logToConsole`, `manifest`, `MODELS_BASE`, `nearEntry`, `occupancy`,
 * `openDeploy`, `optOnFoot`, `optPilot`, `paintDeployChrome`, `params`,
 * `renderer`, `roomCapture`, `scene`, `setDeployTeam`, `soldier`,
 * `soldierArmor`, `soldierDead`, `syncVehicleSpawnOwnership`,
 * `templateNameOf`, `updateHud`.
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
  const netScratchV = new THREE.Vector3();

  /** The room table id for a LOCAL vehicle node: template name (the scene
   *  node's `userData.control`), closest to the server pose among the same
   *  template's entries — the `spawnDelayForNode` matching law, over the wire
   *  table instead of the local scene. */
  function netVehicleIdFor(node) {
    if (!room.roomJoined || !node) return null;
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
    let found = null;
    if (v) {
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
  }

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
        if (row?.type === 'capturing') {
          page.roomCapture = { name: row.name || 'flag', elapsed: 0,
            duration: Number(row.duration) > 0 ? Number(row.duration) : 8,
            contested: false, done: false };
        } else if (row?.type === 'captureContested' && page.roomCapture) {
          page.roomCapture.contested = true;
        } else if (row?.type === 'captureCancelled') {
          page.roomCapture = null;
          page.updateHud();
        }
        // P3: death by server decree. The page's own death loop
        // (`soldierDead` latch on a destroyed Armor) is the cam, the deploy
        // screen and the spectator work — the decree only has to make the
        // Armor agree with the server's. The suicide path's own precedent
        // (`soldierArmor.applyDamage(maxHitPoints)`).
        if (row.type === 'killed' && row.slot === room.roomClient.slot
            && page.soldierArmor && !page.soldierDead) {
          page.soldierArmor.applyDamage(page.soldierArmor.maxHitPoints);
        }
        // Flags move by decree too: the deploy screen's list and the map's
        // markers read `flags[]` live, so a team write is the whole repaint.
        if (row.type === 'captured' && Number.isInteger(row.flag)
            && page.flags[row.flag]) {
          const prevTeam = page.flags[row.flag].team;
          page.flags[row.flag].team = row.team;
          page.hoistCaptureFlag(page.flags[row.flag]);
          page.announceCapture(prevTeam, row.team);
          page.roomCapture = { name: row.name || page.flags[row.flag].name,
            elapsed: 0, duration: 0, contested: false, done: true,
            until: performance.now() + 2200 };
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
        if (want && asked !== want && page.manifest.some(e => e.name.toLowerCase() === want)) {
          const q = new URLSearchParams(location.search);
          q.set('map', want);
          location.replace(`${location.pathname}?${q}`);
          return;
        }
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
        // Create-on-join names the level the room was made on (rooms.mjs);
        // joining an existing room ignores it.
        level: page.params.get('map') || undefined,
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
