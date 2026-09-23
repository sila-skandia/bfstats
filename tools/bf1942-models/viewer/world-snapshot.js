// The room server's reads of the world (P2): every player's snapshot row,
// a registered hull's pose and the owner ids the world holds state for.
// Plain functions of the `World` (world.js), which delegates its methods here.

import { quaternionFromAxes } from './vehicle-bodies.js';

/**
 * Every connected player's state, in the room snapshot's terms
 * (`viewer/netcode.js` encodes exactly this). The room server reads this
 * at the snapshot cadence (the engine's 20 Hz, P-2); the page reads the
 * same player records directly for its own HUD, so there is one state
 * source per side. `hp` is the owning Armor's hitPoints (null for a
 * player carrying none -- the page does not attach armor to every
 * soldier); `yaw`/`pitch` are the soldier's own facing (NaN while seated:
 * the hull owns the facing, and the vehicle record carries it).
 */
export function playersSnapshot(world) {
  const out = [];
  for (const [id, player] of world.players) {
    const soldier = player.soldier;
    const armor = player.armor;
    const occ = player.occupancy;
    const seated = !!occ?.root;
    let x = NaN, y = NaN, z = NaN, yaw = NaN, pitch = NaN;
    if (seated && player.vehicle) {
      const s = player.vehicle.state.position;
      x = s.x; y = s.y; z = s.z;
    } else if (soldier) {
      x = soldier.x; y = soldier.y; z = soldier.z;
      yaw = soldier.yaw; pitch = soldier.pitch;
    }
    out.push({
      id,
      team: player.team,
      alive: !(armor?.destroyed ?? false),
      seated,
      crouch: soldier?.stance === 'crouch',
      prone: soldier?.stance === 'prone',
      inVehicle: seated,
      x, y, z, yaw, pitch,
      hp: armor ? Math.max(0, armor.hitPoints) : null,
      // The room maps this to its own vehicle table id; the page's deploy
      // screen maps it to the scene node the same way (`nodeOwners`).
      vehicleOwner: occ?.root ? world.nodeOwners.get(occ.root) : null,
      // The seat's position in the occupancy's own survey order, root
      // first -- the same index the client's seat table reads on its side.
      seatIndex: occ && occ.activeSeatId != null
        ? Math.max(0, occ.order.indexOf(occ.activeSeatId)) : -1,
    });
  }
  return out;
}

/** A registered owner's hull pose for the snapshot: the driven vehicle's
 *  integrated state, or the parked body's rest pose. Returns
 *  `{ x, y, z, q: [x, y, z, w] }` in world space, or null for an owner
 *  the world holds no hull for (a static furniture root still answers
 *  from its registration pose).
 */
export function vehiclePose(world, owner) {
  const entry = world.bodyWorld ? world.bodyWorld.get(owner) : null;
  if (entry?.driven) {
    const s = entry.driven.vehicle.state;
    return {
      x: s.position.x, y: s.position.y, z: s.position.z,
      q: [s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w],
    };
  }
  if (entry?.parked) {
    const b = entry.parked.body;
    return { x: b.pos[0], y: b.pos[1], z: b.pos[2],
             q: quaternionFromAxes(b.axes, [0, 0, 0, 0]) };
  }
  const at = world.positions.get(owner);
  return at ? { x: at[0], y: at[1], z: at[2], q: [0, 0, 0, 1] } : null;
}

/** The owner ids the world holds hull or position state for: the room
 *  server's vehicle table, one entry per seatable hull it registered.
 */
export function vehicles(world) {
  const seen = new Set();
  if (world.bodyWorld) {
    for (const owner of world.bodyWorld.entries.keys()) seen.add(owner);
  }
  for (const owner of world.positions.keys()) seen.add(owner);
  return [...seen];
}
