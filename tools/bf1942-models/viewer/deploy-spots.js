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

/** The spawn group ids a flag stands for: a ship's one per deck ring, a
 *  control point's (its `groups`, else its `group`). Empty for a flag with
 *  none, which the screen still draws by its position. */
export function flagGroupIds(flag) {
  if (!flag) return [];
  const out = [];
  for (const entry of Array.isArray(flag.groups) ? flag.groups : []) {
    const id = entry && typeof entry === 'object' ? entry.group : entry;
    if (Number.isInteger(id) && !out.includes(id)) out.push(id);
  }
  if (!out.length && Number.isInteger(flag.group)) out.push(flag.group);
  return out;
}

/** Whether `group` is one of `flag`'s groups. */
export function flagHoldsGroup(flag, group) {
  return group != null && flagGroupIds(flag).includes(group);
}

/** The server's word on one group for the player's side: true when retail's
 *  map would draw it for `team` (the group's side is his and its active byte
 *  is set), false when it would not, null when the table says nothing of it
 *  (no sidecar page, no table yet, a group it does not name). `table` is
 *  `server-spawn-groups.js`'s: `live`, `team(group)`, `active(group)`. */
export function servedDraws(table, group, team) {
  if (!table?.live || group == null || (team !== 1 && team !== 2)) return null;
  const active = table.active(group);
  const side = table.team(group);
  if (active == null || side == null) return null;
  return !!active && side === team;
}

/** The map spots a flag draws: one per spawn group on a ship (the game draws
 *  one ring per group down the hull), one for the flag itself otherwise.
 *
 *  Only ship flags (`flag.vehicle`) unpack `groups` into per-spot rings, and
 *  only from object entries that actually carry a position. Every other flag
 *  — numeric group ids, an empty list, a deck list with no positions — falls
 *  through to its single flag position, so a flag with a position always
 *  yields exactly one drawable spot and a flag without one yields none.
 *  Branching on the entry shape (not just `groups.length`) is what keeps a
 *  control-point flag with groups `[2, 6]` off the position-less path.
 *
 *  `served` (`{ team, table }`) is a sidecar page's spawn table: where it
 *  names a group, its side and active byte decide whether the group is drawn
 *  for `team` (`servedDraws`), as on retail's map, and a control point's one
 *  spot carries the group the table draws (the holder's of two, SPAWNGRP-4).
 *  Where it says nothing the page's own state stands (`groupDown`, and the
 *  flag's single ring with no group). */
export function flagMapSpots(flag, served = null) {
  const team = served?.team;
  const table = served?.table;
  if (flag?.vehicle && Array.isArray(flag.groups) && flag.groups.length) {
    const spots = [];
    let hidden = 0;
    for (const entry of flag.groups) {
      if (entry && typeof entry === 'object' && entry.position) {
        const draws = servedDraws(table, entry.group, team);
        if (draws === false || (draws == null && groupDown(flag, entry.group))) { hidden++; continue; }
        spots.push({ group: entry.group, position: entry.position });
      }
    }
    // A ship flag whose group entries carry no positions still gets its one
    // ring at the hull position below — a malformed deck list must never
    // take the whole flag off the map. One whose every group is off draws
    // nothing at all, as retail's map draws none of them.
    if (spots.length || hidden) return spots;
  }
  if (!flag?.position) return [];
  if (!flag.vehicle && table?.live) {
    const ids = flagGroupIds(flag);
    const said = ids.map(id => [id, servedDraws(table, id, team)]).filter(([, d]) => d != null);
    if (said.length) {
      const drawn = said.find(([, d]) => d);
      return drawn ? [{ group: drawn[0], position: flag.position }] : [];
    }
  }
  return [{ group: null, position: flag.position }];
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

/** The group of `flag` the player's selection is, or null: the chosen group
 *  when it is one of the flag's, nothing otherwise. There is no default.
 *
 *  Retail's selected group is the spawn map's own `BfMap+0xd4`, zeroed by
 *  `BfMap::BfMap` (0x0046e6be) and written only by a click, which takes the
 *  nearest drawn group within 0.15 of the map (`minimap_screenTransform`
 *  0x00469360, the squared 0.0225 at 0x008d6298, the write at 0x0046981c);
 *  closing the screen commits it as it stands (0x004679e0, from 0x006ccfc6,
 *  through the game's `setSpawnGroup`), and a group 0, or one no longer
 *  active, is a spawn the server refuses (`GameServer::spawnPlayer`
 *  0x0814c990 clears it). So a retail player who never clicks never spawns
 *  (ledger SPAWNGRP-11, SPAWNGRP-12). The page used to pick a flag for him
 *  and, on a ship, a deck group (`shipDefault`, gone 2026-10-25).
 *
 *  `chosen` is the page's own selection state, passed in rather than read,
 *  so this stays a pure function of its arguments. */
export function activeDeployGroup(flag, chosen = null) {
  return flagHoldsGroup(flag, chosen) ? chosen : null;
}
