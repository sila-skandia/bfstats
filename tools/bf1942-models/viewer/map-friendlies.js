// The friendly units the map surfaces mark: the side the map is drawn for, the
// on-foot teammates that get an arrow, the hulls a teammate is riding, and the
// repaint key that changes as they move. Built by `map-surfaces.js`, which
// hands in the four things these read: `world`, `LOCAL_PLAYER`,
// `deployTeamId` and `mapVehicles`.

import * as THREE from 'three';

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

  /** The scene nodes a friendly is riding, so `drawVehicles` can tell an
   *  occupied hull from a parked one. A Set rather than a walk per vehicle:
   *  this runs once per surface, not once per spawner. */
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
      // The hull the map draws: a carrier's AA gun is a seat of the carrier.
      let hull = root;
      for (let n = root; n; n = n.parent) if (page.mapVehicles.includes(n)) { hull = n; break; }
      out.add(hull);
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
    // A crewed hull moves and turns under its crew, so its pose is in the key
    // the way an on-foot arrow's is.
    for (const node of friendlyVehicleNodes()) {
      node.getWorldPosition(vehiclePos);
      node.getWorldQuaternion(vehicleQuat);
      vehicleFwd.set(0, 0, -1).applyQuaternion(vehicleQuat);
      key += `v${node.id},${Math.round(vehiclePos.x)},${Math.round(vehiclePos.z)},`
        + `${Math.round(Math.atan2(vehicleFwd.x, -vehicleFwd.z) * 10)};`;
    }
    return key;
  }

  return { localMapTeam, friendlyMapUnits, friendlyVehicleNodes, friendlyMarkerKey };
}
