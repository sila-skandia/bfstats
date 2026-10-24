// Deploy-map spots: which rings a flag draws on the spawn screen.
//
// `soldier.js` `spawnFlags` gives every flag a `groups` array, but the array
// is heterogeneous by design: a control-point flag carries the numeric group
// ids it owns (`[spawnGroupId, secondSpawnGroupId]`, or `[group]` on a
// standalone base row), while a ship flag carries one per-deck-spot entry
// (`[{ group, position }]` — Wake's carrier draws three rings down its deck,
// its destroyer two). Only the ship shape carries per-spot positions, so
// only a ship draws per-group rings; everything else draws its single flag
// position.
//
// That distinction is the whole of this module, and getting it wrong draws
// nothing at all: mapping numeric ids through the ship shape
// (`groups.map(g => ({ group: g.group, position: g.position }))`) yields
// `{ group: undefined, position: undefined }` spots, and both the ring
// painter and the click picker skip position-less spots — the deploy screen
// then shows no white dots while number keys and the flag list still spawn.
// That is exactly the regression this pins: carrier + control-point parity
// gave land flags a `groups` array for the first time, and the painter read
// it as ship spots.
//
// Free of `three` and the DOM on purpose, so
// `tests/deploy_spots_harness.mjs` drives the same bytes the page loads.

/** The map spots a flag draws: one per spawn group on a ship (the game draws
 *  one ring per group down the hull), one for the flag itself otherwise.
 *
 *  Only ship flags (`flag.vehicle`) unpack `groups` into per-spot rings, and
 *  only from object entries that actually carry a position. Every other flag
 *  — numeric group ids, an empty list, a deck list with no positions — falls
 *  through to its single flag position, so a flag with a position always
 *  yields exactly one drawable spot and a flag without one yields none.
 *  Branching on the entry shape (not just `groups.length`) is what keeps a
 *  control-point flag with groups `[2, 6]` off the position-less path. */
export function flagMapSpots(flag) {
  if (flag?.vehicle && Array.isArray(flag.groups) && flag.groups.length) {
    const spots = [];
    let hidden = 0;
    for (const entry of flag.groups) {
      if (entry && typeof entry === 'object' && entry.position) {
        if (groupDown(flag, entry.group)) { hidden++; continue; }
        spots.push({ group: entry.group, position: entry.position });
      }
    }
    // A ship flag whose group entries carry no positions still gets its one
    // ring at the hull position below — a malformed deck list must never
    // take the whole flag off the map. One whose every group is off draws
    // nothing at all, as retail's map draws none of them.
    if (spots.length || hidden) return spots;
  }
  return flag?.position ? [{ group: null, position: flag.position }] : [];
}

/** Whether a human can spawn on none of `group`'s points: the group is off
 *  the screen. Retail's map draws a dot, and lets a click select, only for a
 *  group whose `getActive(false)` passes (BF1942.exe `BfMap::update`
 *  0x0046df22.., the pick in `minimap_screenTransform` at 0x004695d8; the
 *  client's `getActive` 0x00484bc0 is the byte the server sends, ledger
 *  SPAWNGRP-11). So Midway's helm group 72, whose door is beyond a human's
 *  5 m, is never on a player's screen, and a ship whose every group is down
 *  shows nothing. A point's `inactive` is that test: the server's word on a
 *  sidecar page (`server-spawn-groups.js`), the page's own SPAWN-5 and
 *  SPAWN-25 otherwise (`hull-bodies.js` `bindCarriers`). A group with no
 *  point on the flag is left drawn. */
function groupDown(flag, group) {
  const points = (flag.spawns ?? []).filter(p => p?.group === group);
  return points.length > 0 && points.every(p => p.inactive);
}

/** The group of `flag` the current selection points at: the chosen deck
 *  spot when one was clicked, else the ship's default group (`shipDefault`).
 *  `null` for a land flag — its single ring carries no group.
 *
 *  `deployGroup` is the page's own selection state, passed in rather than
 *  read, so this stays a pure function of its arguments. Only deck-spot
 *  object entries match: a numeric group id on a land flag must never match
 *  a deck choice made on a ship earlier, so switching from a carrier to an
 *  island flag always drops back to null. */
export function activeDeployGroup(flag, deployGroup = null) {
  if (!flag?.vehicle) return null;
  if (deployGroup != null && Array.isArray(flag.groups)) {
    for (const entry of flag.groups) {
      if (entry && typeof entry === 'object' && entry.group === deployGroup) {
        return deployGroup;
      }
    }
  }
  return shipDefault(flag);
}

/** The deck group a ship offers before any click: the first that stands a
 *  human somewhere, else the first a human may use at all, else the first.
 *
 *  Retail has no such default. Its selected group is the spawn map's own
 *  `BfMap+0xd4`, zeroed by `BfMap::BfMap` (0x0046e6be) and written only by a
 *  click, which takes the nearest drawn group within 0.15 of the map
 *  (`minimap_screenTransform` 0x00469360, the squared 0.0225 at 0x008d6298,
 *  the write at 0x0046981c); closing the screen commits it as it stands
 *  (0x004679e0, from 0x006ccfc6, through the game's `setSpawnGroup`), and a
 *  group 0, or one no longer active, is a spawn the server refuses
 *  (`GameServer::reSpawnPlayer` 0x0814c4b0 clears it). So a retail player who
 *  never clicks never spawns, and a click stays chosen across deaths. The
 *  page keeps a flag chosen for him (the round-open default) and, on a ship,
 *  this group, which is always one retail would have let him click: a
 *  group whose points are all off is not drawn (`groupDown`). Ledger
 *  SPAWNGRP-11.
 *
 *  A group of points that seat their player (`setEnterOnSpawn`) is on for a
 *  human only while a free seat's door is within 5 m of a point (SPAWN-25),
 *  and a real server answers a request for an inactive group with nothing
 *  (`GameServer::spawnPlayer` clears the choice, SPAWNGRP-10). Midway's
 *  Enterprise lists its helm point (`enterprise_driversoldierspawn`, group
 *  72) first: its door is beyond a human's 5 m, so the group spawns bots
 *  only, and a page that asked for it by default sat on the free camera
 *  while the server never answered (private co-op lab, 2026-10-25: 72 never
 *  answered, with bots or without; 73, 74, 68 and 69 each answered at
 *  once). A point's `inactive` (`hull-bodies.js` `bindCarriers`) carries the
 *  page's own SPAWN-25 test once the carrier is bound; before that the
 *  point's `enterOnSpawn` word alone says it is a seat. */
function shipDefault(flag) {
  const entries = (flag.groups ?? []).filter(e => e && typeof e === 'object' && e.group != null);
  if (!entries.length) return null;
  const points = (group) => (flag.spawns ?? []).filter(p => p?.group === group);
  const pick = (test) => entries.find(e => points(e.group).some(test));
  return (pick(p => !p.inactive && !p.enterOnSpawn)
    ?? pick(p => !p.inactive)
    ?? pick(p => !p.enterOnSpawn)
    ?? entries[0]).group;
}
