// The units the map surfaces mark: the side the map is drawn for, the on-foot
// teammates that get an arrow, the hulls it shows (`map-vehicle-marks.js`'s
// rule) and which of them a teammate is riding, and the repaint key that
// changes as they move. Built by `map-surfaces.js`, which hands in the things
// these read: `world`, `LOCAL_PLAYER`, `deployTeamId`, `hudPack`, `mapVehicles`,
// `occupancy`, `vehicleSpawnActive` — and, in a room or on a real server,
// `roomJoined`, `roomClient` and `serverEntities`, because there the other
// players are the net client's rows, not `world.players` (which holds only
// the local player and this page's own bots; a joined page spawns none).
// Reading only the world left a real server's map empty: five players walking
// and driving around El Alamein, not one arrow, every hull grey (live,
// 2026-10-18).

import * as THREE from 'three';
import { mapVehicleMark } from './map-vehicle-marks.js';

const DEG = Math.PI / 180;

export function createMapFriendlies(page) {
  // Scratch for the crewed hulls' pose in `friendlyMarkerKey`.
  const vehiclePos = new THREE.Vector3();
  const vehicleQuat = new THREE.Quaternion();
  const vehicleFwd = new THREE.Vector3();

  /** The room's remote players as drawn this frame (the same lerped read the
   *  renderer draws bodies from), or null when this page is not on a server.
   *  Each row carries `team`, `alive`, `seated`/`inVehicle`, `vehicleId`,
   *  the position and the body yaw in degrees (`net-sidecar.js` playerRow,
   *  `netcode-client.js` for a room). */
  function netRemotes() {
    const client = page.roomJoined ? page.roomClient : null;
    if (!client?.remoteSlots) return null;
    const now = typeof performance !== 'undefined' ? performance.now() : null;
    const out = [];
    for (const slot of client.remoteSlots()) {
      const p = client.remotePlayer(slot, now);
      if (p) out.push(p);
    }
    return out;
  }

  /** Who sits in which server entity: entity id -> the riders' teams. */
  function netCrews(remotes) {
    const out = new Map();
    for (const p of remotes) {
      if (!p.alive || !(p.seated || p.inVehicle) || p.vehicleId == null) continue;
      if (!out.has(p.vehicleId)) out.set(p.vehicleId, []);
      out.get(p.vehicleId).push(p.team);
    }
    return out;
  }

  /** The scene node standing for a server entity, or null while it loads. */
  function entityNode(id) {
    const e = page.serverEntities?.entityFor?.(id);
    return e?.posed && e.loaded ? e.group : null;
  }

  /** The side the map is drawn for: whose units get an arrow and what colour
   *  everything friendly is modulated with. The deploy screen runs before a
   *  soldier exists, so it falls back to the team the player has chosen. */
  function localMapTeam() {
    return page.world?.player(page.LOCAL_PLAYER)?.team ?? page.deployTeamId;
  }

  /**
   * Friendly units, the way retail marks them: an on-foot teammate is a small
   * arrow in the side's own colour, pointing where he faces
   * (`minimap_icon_soldier_16x16`, white in the archive and modulated by the
   * engine); a seated one is not marked here at all, because his VEHICLE is
   * the mark and `drawVehicles` tints that instead. The local player is the
   * disc-and-arrow ring (`drawPlayer`), so he is not doubled.
   *
   * The list is the net client's rows on a server (every other player the
   * server tells this page about), else the world's own players — the local
   * sim's bots — filtered to the local side; a destroyed body has no arrow.
   *
   * The arrow is the whole reason a bot is findable: a squad spawning on a
   * capped flag and advancing on an objective leaves the player's own corner
   * of the map within seconds, and the map is the only surface that still
   * shows them. The heading is what the dot it replaces could not say — which
   * way the line is moving, and so whether it is coming to help.
   */
  function friendlyMapUnits() {
    const out = [];
    const localTeam = localMapTeam();
    // On a server the teammates are the net client's rows. A seated one is
    // not marked here either: his hull is the mark. The row's yaw is degrees
    // in the page's own forward convention (sin yaw, 0, cos yaw), the same
    // the sim's soldiers walk, so only the unit changes.
    const remotes = netRemotes();
    if (remotes) {
      for (const p of remotes) {
        if (p.team !== localTeam || !p.alive) continue;
        if (p.seated || p.inVehicle) continue;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        out.push({ x: p.x, z: p.z, yaw: (p.yaw ?? 0) * DEG });
      }
      return out;
    }
    const players = page.world?.players;
    if (!players) return out;
    for (const [id, player] of players) {
      if (id === page.LOCAL_PLAYER) continue;
      if (player.team !== localTeam) continue;
      if (player.armor?.destroyed) continue;
      // Seated: `drawVehicles` paints the hull he is in. Two marks for one man
      // is what retail does not do.
      if (player.occupancy?.root) continue;
      const s = player.soldier;
      if (!s) continue;
      out.push({ x: s.x, z: s.z, yaw: s.yaw });
    }
    return out;
  }

  /** The hull the map draws for a seat node: a carrier's AA gun is a seat of
   *  the carrier. */
  function hullOf(root) {
    for (let n = root; n; n = n.parent) if (page.mapVehicles.includes(n)) return n;
    return root;
  }

  /** Every living seated player's team, by the hull the map draws, the local
   *  player included: `mapVehicleMark`'s occupant walk. */
  function vehicleOccupantTeams() {
    const out = new Map();
    const players = page.world?.players;
    if (!players) return out;
    for (const [, player] of players) {
      if (player.armor?.destroyed) continue;
      const root = player.occupancy?.root;
      if (!root) continue;
      const hull = hullOf(root);
      if (!out.has(hull)) out.set(hull, []);
      out.get(hull).push(player.team);
    }
    return out;
  }

  /** The scene nodes a friendly (not the local player) is riding. A Set rather
   *  than a walk per vehicle: this runs once per surface, not once per
   *  spawner. */
  function friendlyVehicleNodes() {
    const out = new Set();
    const localTeam = localMapTeam();
    const remotes = netRemotes();
    if (remotes) {
      for (const [id, teams] of netCrews(remotes)) {
        if (!teams.includes(localTeam)) continue;
        const node = entityNode(id);
        if (node) out.add(node);
      }
      return out;
    }
    const players = page.world?.players;
    if (!players) return out;
    for (const [id, player] of players) {
      if (id === page.LOCAL_PLAYER) continue;
      if (player.team !== localTeam) continue;
      if (player.armor?.destroyed) continue;
      const root = player.occupancy?.root;
      if (!root) continue;
      out.add(hullOf(root));
    }
    return out;
  }

  /**
   * The hulls the map surfaces draw, each with its mark (`'friendly'` or
   * `'empty'`), by the client's own rule (`map-vehicle-marks.js`): a wreck,
   * an unarmoured object and a hull the other side is crewing are not on the
   * list. The local player's own hull is left out too: the ring is his mark,
   * in a vehicle as on foot. A spawner whose flag is neutral has no hull.
   */
  function mapVehicleMarks() {
    // On a server in authority mode the field is the server's own entities
    // (`server-entities.js`), not the level's parked copies -- those were
    // cleared at the join, and marking them drew the level's layout, not the
    // round: a hull driven across the map kept its pad's mark and a wreck
    // stayed drawn (live, 2026-10-18). The crews are the net client's rows.
    const remotes = page.serverEntities?.entities?.size ? netRemotes() : null;
    if (remotes) return serverEntityMarks(remotes);
    const out = [];
    const localTeam = localMapTeam();
    const crews = vehicleOccupantTeams();
    const own = page.occupancy?.root ? hullOf(page.occupancy.root) : null;
    for (const node of page.mapVehicles) {
      if (!page.vehicleSpawnActive(node)) continue;
      const armor = page.world?.damageableOf?.(node) ?? null;
      const kind = node === own ? null : mapVehicleMark({
        hitPoints: armor?.hitPoints ?? 0,
        occupantTeams: crews.get(node) ?? [],
        localTeam,
      });
      if (kind) out.push({ node, kind });
      // The objects the hull's own spawners hold (AI-121: each is an object
      // of its own, held at its spawner), drawn as marks of their own when
      // their template has a map symbol: FHSW's bombers carry an attitude
      // indicator, a cross and a horizon ball 100 m up the plane's own up
      // axis, that turn and slide with it. The ring does not stand in for
      // them on the player's own bomber.
      const hostHp = armor?.hitPoints ?? 0;
      for (const held of heldMapObjects(node)) {
        const heldKind = mapVehicleMark({ hitPoints: hostHp, heldTeam: held.userData.heldSpawner.team ?? 0,
          localTeam });
        if (heldKind) out.push({ node: held, kind: heldKind, held: true });
      }
    }
    return out;
  }

  /**
   * The server's hulls, marked by the same client rule (`mapVehicleMark`):
   * never a wreck, never one the other side is crewing, the side's colour
   * when a teammate rides it. The local player's own hull is left out — the
   * ring is his mark — and an entity still loading has nowhere to stand a
   * mark. Hit points are the entity's server-fed Armor; one registered
   * without an Armor (a stationary gun) is simply standing, so it draws.
   */
  function serverEntityMarks(remotes) {
    const out = [];
    const localTeam = localMapTeam();
    const crews = netCrews(remotes);
    const ownRoot = page.occupancy?.root ?? null;
    for (const e of page.serverEntities.entities.values()) {
      if (!e.posed || !e.loaded) continue;
      let own = false;
      for (let n = ownRoot; n; n = n.parent) if (n === e.group) { own = true; break; }
      if (own) continue;
      const kind = mapVehicleMark({
        hitPoints: e.damageable ? (e.damageable.destroyed ? 0 : e.damageable.hitPoints) : 1,
        occupantTeams: crews.get(e.id) ?? [],
        localTeam,
      });
      if (kind) out.push({ node: e.group, kind });
    }
    return out;
  }

  /** A hull's held objects with a map symbol (`mapVehicleMarks`), found once
   *  per hull node. */
  const heldByHull = new WeakMap();
  function heldMapObjects(hull) {
    let held = heldByHull.get(hull);
    if (held) return held;
    held = [];
    hull.traverse(obj => {
      if (obj === hull || obj.userData?.templateKind !== 'PlayerControlObject') return;
      if (!obj.userData.heldSpawner || obj.userData.heldSpawner.holdObject === false) return;
      const template = String(obj.userData.control || obj.name).toLowerCase();
      if (page.hudPack?.icons?.[template]?.icon) held.push(obj);
    });
    heldByHull.set(hull, held);
    return held;
  }

  /** A cheap key that changes as the units move, so a map surface repaints on a
   *  bot's step and not only on the camera's. The heading is in it to a tenth
   *  of a radian — the arrow turns visibly at this size well before it moves a
   *  backing pixel, so a position-only key would freeze a teammate mid-turn. */
  function friendlyMarkerKey() {
    let key = '';
    for (const { x, z, yaw } of friendlyMapUnits()) {
      key += `${Math.round(x)},${Math.round(z)},${Math.round(yaw * 10)};`;
    }
    // Every drawn hull is in the key, so one that dies or comes back on its
    // pad repaints the map; a crewed one moves and turns under its crew, so
    // its pose is in the key the way an on-foot arrow's is.
    for (const { node, kind } of mapVehicleMarks()) {
      key += `v${node.id}`;
      if (kind === 'friendly') {
        node.getWorldPosition(vehiclePos);
        node.getWorldQuaternion(vehicleQuat);
        vehicleFwd.set(0, 0, -1).applyQuaternion(vehicleQuat);
        key += `,${Math.round(vehiclePos.x)},${Math.round(vehiclePos.z)},`
          + `${Math.round(Math.atan2(vehicleFwd.x, -vehicleFwd.z) * 10)}`;
      }
      key += ';';
    }
    return key;
  }

  return {
    localMapTeam, friendlyMapUnits, friendlyVehicleNodes, mapVehicleMarks, friendlyMarkerKey,
  };
}
