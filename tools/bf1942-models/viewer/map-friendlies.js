// The units the map surfaces mark: the side the map is drawn for, the on-foot
// teammates that get an arrow, the hulls it shows (`map-vehicle-marks.js`'s
// rule) and which of them a teammate is riding, and the repaint key that
// changes as they move. Built by `map-surfaces.js`, which hands in the things
// these read: `world`, `LOCAL_PLAYER`, `deployTeamId`, `mapVehicles`,
// `occupancy` and `vehicleSpawnActive`.

import * as THREE from 'three';
import { mapVehicleMark } from './map-vehicle-marks.js';

export function createMapFriendlies(page) {
  // Scratch for the crewed hulls' pose in `friendlyMarkerKey`.
  const vehiclePos = new THREE.Vector3();
  const vehicleQuat = new THREE.Quaternion();
  const vehicleFwd = new THREE.Vector3();

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
   * The list is the world's own players — bots and, in a room, the other
   * humans — filtered to the local side; a destroyed body has no arrow.
   *
   * The arrow is the whole reason a bot is findable: a squad spawning on a
   * capped flag and advancing on an objective leaves the player's own corner
   * of the map within seconds, and the map is the only surface that still
   * shows them. The heading is what the dot it replaces could not say — which
   * way the line is moving, and so whether it is coming to help.
   */
  function friendlyMapUnits() {
    const out = [];
    const players = page.world?.players;
    if (!players) return out;
    const localTeam = localMapTeam();
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
    const players = page.world?.players;
    if (!players) return out;
    const localTeam = localMapTeam();
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
    const out = [];
    const localTeam = localMapTeam();
    const crews = vehicleOccupantTeams();
    const own = page.occupancy?.root ? hullOf(page.occupancy.root) : null;
    for (const node of page.mapVehicles) {
      if (node === own) continue;
      if (!page.vehicleSpawnActive(node)) continue;
      const armor = page.world?.damageableOf?.(node) ?? null;
      const kind = mapVehicleMark({
        hitPoints: armor?.hitPoints ?? 0,
        occupantTeams: crews.get(node) ?? [],
        localTeam,
      });
      if (kind) out.push({ node, kind });
    }
    return out;
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
