// A room's control channel: the engine's action rows (netcode.js MSG_ACTION)
// mirrored on the room's world — the deploy (spawn), the seat enter/exit/
// switch (J-1/J-3) and the radio relay — and the unmount the explicit exit,
// leave and drop paths share. Split out of `rooms.mjs`'s Room, which builds one of these and
// routes MSG_ACTION and its leave path through it.

import { RADIO_LOCAL_RANGE, SPAWN_INDEX_MAX } from './room-rules.mjs';
import { encodeJsonMsg, eventRow } from './room-wire.mjs';

/**
 * @param {object} options
 * @param {object} options.room   the Room (its `world`, `instance`,
 *                                `authority`, `code`)
 * @param {(type, connection, extra) => void} options.event  the room's
 *                                MSG_EVENT row to everyone but the actor
 */
export function createControlChannel({ room, event }) {
  function onAction(connection, row) {
    if (!row || typeof row !== 'object') return;
    if (row.type === 'spawn') onSpawn(connection, row);
    else if (row.type === 'seat') onSeat(connection, row);
    else if (row.type === 'radio') onRadio(connection, row);
  }

  /**
   * A radio message (`RadioMessageEvent`, 0x3A), relayed the way
   * `GameServer::radioMessage` (lnxded 0x0813a120) does: dropped from a
   * player who is not alive; team radio to every other player on the
   * speaker's team; a shout to every other player, of either team, within
   * 70 m of the speaker's controlled object. The speaker's own client has
   * already played it. The row carries the speaker's position so a shout
   * plays in 3D where he stands.
   */
  function onRadio(connection, row) {
    const slot = connection.slot;
    const id = row?.msg;
    if (!Number.isInteger(id) || id < 1 || id > 59) return;
    if (!room.authority.mayInput(slot)) return;
    const at = playerPoint(room.world.player(slot));
    const team = row.team === true;
    const bytes = encodeJsonMsg(eventRow('radio', room.tick, {
      slot, msg: id, broadcast: team, team: connection.team,
      at: at ? [at.x, at.y, at.z] : null,
    }));
    for (const [other, listener] of room.players) {
      if (other === slot) continue;
      if (team) {
        if (listener.team !== connection.team) continue;
      } else {
        const there = playerPoint(room.world.player(other));
        if (!at || !there) continue;
        if (Math.hypot(there.x - at.x, there.y - at.y, there.z - at.z) > RADIO_LOCAL_RANGE) continue;
      }
      listener.peer.send(bytes);
    }
  }

  /** The deploy action: place the soldier on the flag the row names (0-based
   *  into HELLO's flags), or the team's own flag when the row omits it. The
   *  P3 authority revives the player first — the fresh Armor at the kit's
   *  max (`authority.revive`, loadouts.json), the death decree lifted. */
  function onSpawn(connection, row) {
    const slot = connection.slot;
    const world = room.world;
    const player = world.player(slot);
    if (!player) return;
    if (player.occupancy) unmount(connection);   // defensive
    const flags = room.instance.flags;
    let flag = null;
    const index = row?.flag;
    if (Number.isInteger(index) && index >= 0 && index < flags.length) {
      flag = flags[index];
    }
    room.authority.revive(slot, connection.team, row?.kit ?? null);
    // ONE spawn pick, made once. A flag holds several spawn points and
    // `pickSpawn` walks them by `player.spawnIndex`; the deploy screen owns
    // that walk on the page (`spawnAtFlag`), so the row carries the index it
    // landed on and the authority spawns on exactly that point. Advancing
    // here as well put the two sims on DIFFERENT points of the same flag --
    // 45 m apart on Aberdeen's British_Base, and authored facing 17.7 deg
    // apart, so both integrated the same forward word along different
    // headings and the prediction splayed away from the authority at
    // ~1.9 m/s until the correction teleported the player back, twice a
    // second, forever (features/netcode-play-multiplayer/SNAPBACK.md).
    // A client that sends no index keeps the old behaviour: the authority
    // walks the list itself.
    const wanted = row?.spawnIndex;
    const pinned = Number.isInteger(wanted) && wanted >= 0 && wanted <= SPAWN_INDEX_MAX;
    if (pinned) player.spawnIndex = wanted;
    if (!world.spawnPlayer(slot, { flag, advance: !pinned })) return;
    event('spawn', connection, {});
  }

  /** The engine's control channel rows (netcode.js): enter/exit/switch.
   *  The seat index is the occupancy survey's order position, 0 = root —
   *  the same index the snapshot's seatIndex carries. */
  function onSeat(connection, row) {
    const slot = connection.slot;
    const world = room.world;
    const vehicleId = Number.isInteger(row?.vehicle) ? row.vehicle : 0;
    const vehicle = room.instance.table.find(v => v.id === vehicleId);
    if (!vehicle) return;
    const seatIndex = Number.isInteger(row?.seat) ? Math.max(0, row.seat) : 0;
    const action = row?.action;
    const player = world.player(slot);
    const current = player?.occupancy?.root;

    if (action === 'enter') {
      if (current) unmount(connection);
      let mounted = null;
      try {
        mounted = room.instance.mountIntoSeat(world, slot, vehicle, seatIndex);
      } catch (error) {
        console.error(`room ${room.code}: slot ${slot} seat enter on ${vehicle.template} THREW: ${error.stack?.slice(0, 400) ?? error.message}`);
        return;
      }
      if (!mounted) {
        console.error(`room ${room.code}: slot ${slot} seat enter on ${vehicle.template} FAILED (seatIndex ${seatIndex}, survey ${room.instance.seatSurveyOf?.(vehicle) ?? 'n/a'})`);
        return;
      }
      console.error(`room ${room.code}: slot ${slot} entered ${vehicle.template} seat ${mounted.occupancy.order.indexOf(mounted.seatId)}`);
      event('seatEnter', connection, {
        vehicle: vehicle.id,
        seat: mounted.occupancy.order.indexOf(mounted.seatId),
      });
    } else if (action === 'exit') {
      if (current && current === vehicle.root) unmount(connection);
    } else if (action === 'switch') {
      if (!current || current !== vehicle.root) return;
      const switched = room.instance.switchSeat(world, slot, vehicle, seatIndex);
      if (!switched || !switched.changed) return;
      event('seatEnter', connection, {
        vehicle: vehicle.id,
        seat: switched.occ.order.indexOf(switched.seatId),
      });
    }
  }

  /** Exit: the level's leave law (unmount + park + soldier placement), then
   *  the room's row. Shared by the explicit exit, leave and drop paths. */
  function unmount(connection) {
    const player = room.world.player(connection.slot);
    if (!player?.occupancy) return;
    const seat = player.occupancy.order.indexOf(player.occupancy.activeSeatId);
    const root = player.occupancy.root;
    const vehicle = room.instance.table.find(v => v.root === root);
    room.instance.unmountFromSeat(room.world, connection.slot, vehicle);
    if (vehicle) {
      event('seatExit', connection, {
        vehicle: vehicle.id,
        seat: seat >= 0 ? seat : 0,
      });
    }
  }

  return { onAction, unmount };
}

/** A world player's position, whatever holds it: the drive he sits on, the
 *  position the room feeds, or his soldier. */
function playerPoint(player) {
  if (!player) return null;
  const p = player.vehicle?.state?.position ?? player.position
    ?? (player.soldier ? { x: player.soldier.x, y: player.soldier.y, z: player.soldier.z } : null);
  if (!p) return null;
  return Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z };
}
