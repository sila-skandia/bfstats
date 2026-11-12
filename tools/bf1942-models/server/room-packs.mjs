// A room's medic bags and wrenches: each round of a pack a player's page
// fires, run on the room's own world by the law the page and the bots run
// (`viewer/healing-packs.js`), so a heal or a repair is the server's word and
// reaches every client: a soldier's hit points on the snapshot (`net-room.js`
// takes a rise as well as a drop), a hull's as a `hull` row (`room-pads.mjs`).
//
// Retail's server runs `BFSoldier::useMedPack` (lnxded 0x082768d0) and
// `useRepairPack` (0x08276100) from the Fire message of the held item (SUP-27).
// The room runs no hand weapons (the input word carries no weapon slot), so
// the page names the pack each round it fires (`MSG_ACTION {type: 'pack',
// weapon}`, `hand-fire.js`), a departure like `room-hits.mjs`'s; what the
// round does is decided here, off the room's own positions, stance and Armors:
//
//   * the bag heals every wounded soldier within `healDistance`, either side,
//     and then the holder (`medPackHeals`);
//   * the wrench repairs the closest wounded hull in reach that the other side
//     does not hold, and nothing while the holder crouches
//     (`repairPackTarget`, the gates at 0x0827612d and 0x08276731);
//   * crouched, the wrench disarms instead (`disarmTarget`, SUP-28): the first
//     mine or pack in reach, anyone's, unexploded. The room flies no rounds,
//     so the page finds the round and names it (`disarm: {at, template}`);
//     the room checks the holder could have reached it and tells every page
//     (`disarm` row), and each takes its copy out of its world, the layer's
//     own page among them, whose copy is the one that bills.
//
// A round is dropped from the dead, from a seated player (the packs are a
// soldier's), for a weapon that is no pack, for a pack the player's kit does
// not carry, and past the pack's rate (`PACK_ROUNDS`).

import { disarmItemOf, healingPackKind, medPackHeals, packParams, repairPackTarget, worldHulls }
  from '../viewer/healing-packs.js';

/** The rounds a page may claim: a bucket of `burst` refilled at `perSecond`.
 *  The vanilla packs fire at `roundOfFire` 10 (`MedPack.con`,
 *  `RepairPack.con`); the bucket leaves room for the rows a jittery link
 *  bunches together, and for a mod's pack a little faster. */
export const PACK_ROUNDS = Object.freeze({ perSecond: 12, burst: 6 });

/** The widest round radius a reported disarm may claim past
 *  `disarmMinesDistance`: vanilla's mine and pack bodies are well under it. */
export const DISARM_ROUND_RADIUS_MAX = 1.5;

/**
 * @param {object} options
 * @param {object} options.room   the Room (`instance`, `levelData`, `authority`, `now`)
 * @param {(row) => void} [options.onRow]   a MSG_EVENT row to everyone (the disarm)
 */
export function createRoomPacks({ room, onRow = null }) {
  const instance = room.instance;
  const world = instance.world;
  const soldierBody = room.levelData.soldierBody ?? null;
  const loadouts = room.levelData.loadouts ?? null;

  /** The soldier template a side's men wear on this level (`room-hits.mjs`'s). */
  function soldierTemplateOf(team) {
    return loadouts?.levels?.[room.levelData.name]?.[team]?.soldier ?? null;
  }

  /** Whether the kit `slot` spawned with carries `weapon`: true when the room
   *  cannot tell (no loadouts, a kit the file does not know). */
  function kitCarries(slot, weapon) {
    const kit = room.authority.kitOf?.(slot);
    const items = kit ? loadouts?.kits?.[kit]?.items : null;
    if (!Array.isArray(items)) return true;
    const want = weapon.toLowerCase();
    return items.some(item => String(item).toLowerCase() === want);
  }

  /** The rate gate: one token a round. */
  function spend(connection) {
    const now = room.now() / 1000;
    const bucket = connection.packBucket ??= { tokens: PACK_ROUNDS.burst, at: now };
    bucket.tokens = Math.min(PACK_ROUNDS.burst, bucket.tokens + (now - bucket.at) * PACK_ROUNDS.perSecond);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Where a player is: his seat's published position, else his soldier. */
  function pointOf(player) {
    if (player.occupancy?.root && Array.isArray(player.position)) {
      return { x: player.position[0], y: player.position[1], z: player.position[2] };
    }
    const s = player.soldier;
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /** A hull's side: its crew's, else the side a `dontClearTeamOnExit` hull
   *  kept (`room-control.mjs` `unmount`, SEAT-27), else none. */
  function hullTeam(owner) {
    for (const player of world.players.values()) {
      const root = player.occupancy?.root;
      if (root && instance.ownerOf(root) === owner && (player.team === 1 || player.team === 2)) {
        return player.team;
      }
    }
    return instance.ownerToEntry?.get(owner)?.keptTeam ?? 0;
  }

  /**
   * One round of the pack a slot's page fired (`{type: 'pack', weapon}`,
   * and for a crouched wrench that lifted a round, `disarm: {at, template}`).
   * Returns what it did, for a check: `{ kind, healed: [{slot, amount}] }`
   * for the bag, `{ kind, owner }` for the wrench (owner null: nothing in
   * reach), `{ kind, disarmed }` for the crouched wrench (`disarmed` the row
   * sent, or null), or null when the round was dropped.
   */
  function onPack(connection, row) {
    const slot = connection.slot;
    const weapon = typeof row?.weapon === 'string' ? row.weapon : '';
    const kind = healingPackKind(weapon);
    if (!kind || !room.authority.mayInput(slot)) return null;
    const me = world.player(slot);
    const s = me?.soldier;
    if (!s || me.occupancy || !me.armor || me.armor.destroyed) return null;
    if (!kitCarries(slot, weapon) || !spend(connection)) return null;
    const pack = packParams(kind, soldierBody, soldierTemplateOf(me.team));
    if (kind === 'medic') {
      const soldiers = [];
      for (const [other, player] of world.players) {
        if (other === slot || room.authority.dead.has(other)) continue;
        const at = pointOf(player);
        if (at) soldiers.push({ id: other, ...at, armor: player.armor });
      }
      const heals = medPackHeals({ id: slot, x: s.x, y: s.y, z: s.z, armor: me.armor }, soldiers, pack);
      for (const heal of heals) heal.armor.heal(heal.amount);
      return { kind, healed: heals.map(h => ({ slot: h.id, amount: h.amount })) };
    }
    if (s.stance === 'crouch') return { kind, disarmed: disarm(slot, s, row.disarm, pack) };
    const hulls = worldHulls(world, {
      teamOf: hullTeam,
      skip: owner => {
        const entry = instance.ownerToEntry?.get(owner);
        return !!entry && !entry.live;
      },
    });
    const hull = repairPackTarget({ x: s.x, y: s.y, z: s.z, team: me.team ?? 0,
                                    crouched: s.stance === 'crouch' }, hulls, pack);
    if (hull) hull.armor.heal(pack.repairHeal);
    return { kind, owner: hull?.owner ?? null };
  }

  /**
   * The crouched wrench's lift a page reported, checked against the room's
   * own soldier: a round the wrench lifts (`disarmItemOf`), within
   * `disarmMinesDistance` plus a round's radius of where the room has the
   * holder (`disarmTarget`'s gate, the radius bounded by
   * `DISARM_ROUND_RADIUS_MAX`). Passed, every page hears a `disarm` row and
   * takes its copy of the round out unexploded; the holder's page has
   * already, and has given its own pouch the round back.
   */
  function disarm(slot, s, claim, pack) {
    const at = claim?.at;
    if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isFinite)) return null;
    const template = typeof claim.template === 'string' ? claim.template : '';
    if (disarmItemOf(template) == null) return null;
    const reach = pack.disarmRadius + DISARM_ROUND_RADIUS_MAX;
    const dx = at[0] - s.x, dy = at[1] - s.y, dz = at[2] - s.z;
    if (dx * dx + dy * dy + dz * dz > reach * reach) return null;
    const out = { type: 'disarm', slot, at: [...at], template };
    onRow?.(out);
    return out;
  }

  return { onPack };
}
