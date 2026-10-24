// What the page does with the local player's seat when a real server's row
// ends it (`net-room.js`, the sidecar's `onevent`). The page never decides a
// seat against a real server (`room.serverSeats`); it follows the server's
// rows, and three of them end a seat without an exit row of their own:
//
// - his own death (`killed`, ScoreMsg 4 or 5): the server's exit row comes
//   after it, and a dead man firing from his seat until it did was the live
//   PanzerIV of 2026-10-17;
// - the hull he sits in destroyed (`vehicleGone`, DestroyObject): the object
//   and its seats are gone, so there is nothing to sit in. Left in, the page
//   drove its copy of a hull that no longer existed;
// - the round restarted (`levelChange` with `same`, GameStatus 3 after 1 or
//   2): `restartMap` kills everyone and re-makes every hull (ROUND-10), and
//   the page starts the round over as a page that joined now would.
//
// The exit is quiet in every case (no Use goes back to the server: it moved
// him already). Kept pure so `tests/sidecar_round_restart_harness.mjs` drives
// the same decisions over a recorded session.

const NONE = Object.freeze({ leave: false, die: false, restart: false });

/**
 * `row` is one of the sidecar client's page rows; `me` says who the page is:
 * `slot` its room slot, `occupies(id)` whether its seat is on server hull
 * `id` (asked before the page forgets the hull's binding).
 */
export function seatPlanForRow(row, { slot = null, occupies = () => false } = {}) {
  if (!row || typeof row !== 'object') return NONE;
  if (row.type === 'killed' && slot != null && row.slot === slot) return { leave: true, die: true, restart: false };
  if (row.type === 'vehicleGone' && row.vehicle != null && occupies(row.vehicle)) {
    return { leave: true, die: false, restart: false };
  }
  if (row.type === 'levelChange' && row.same) return { leave: true, die: false, restart: true };
  return NONE;
}

/**
 * Which of the page's two copies of a server hull a seat is taken on:
 * `'copy'`, the level copy the page drives by its own prediction, or
 * `'entity'`, the server's own hull (`server-entities.js`), drawn where the
 * server's ghost puts it. Only the driver's seat of a drivable hull is the
 * page's to predict: there the hull is his control object, which the server
 * does not ghost to him (SEAT-36). In every other seat his control object is
 * the seat, and the hull is a ghost like any other, moved by whoever drives
 * it. A gunner seated on the copy rode a hull that never moved while the
 * server's drove off under someone else, and the server's own was not drawn
 * at all (the copy's drivetrain, built when the page took the root seat
 * first, kept `drivenId` set). `entityReady` is whether the server's hull
 * has its model. A gunner's seat of a drivable hull whose entity is not up
 * yet is `'wait'`: the entity is not drawn while the page drives the copy, so
 * a switch from the wheel to the gun finds none, and it comes up a frame or
 * two after the page lets the copy go. A gun with no drivetrain takes the
 * copy until then, as it always has.
 */
export function seatHost({ drivable, seatIndex, entityReady }) {
  const gunner = Number.isInteger(seatIndex) && seatIndex > 0;
  if (drivable) return !gunner ? 'copy' : (entityReady ? 'entity' : 'wait');
  return entityReady ? 'entity' : 'copy';
}

/**
 * A seat gun's `FireState` (`fire-state.js`) brought to the server's count
 * for it, the law of the retail client's `FireArmsNetworkable::setNetUpdate`
 * (0x08228f70, ledger SEAT-36): the magazines are resized to the server's
 * count and the loaded one holds the server's rounds. `rounds` / `mags` are
 * the control state's (sidecar `hmag`), either null when it was not sent.
 * Returns true when anything changed.
 *
 * In the page's terms the engine's vector of `mags` magazines is the loaded
 * one plus `magsLeft` spares. A gun with no magazine left holds nothing. A
 * reload the page is still running is over once the server's gun has rounds
 * again: its own `ReloadFinished` already spent the magazine, so the page's
 * would spend a second one.
 */
export function takeServerMagazines(state, rounds, mags) {
  if (!state || state.unlimited) return false;
  const before = [state.ammo, state.magsLeft, state.reloadRemaining];
  if (Number.isInteger(mags) && mags >= 0 && state.magsLeft !== Infinity) {
    state.magsLeft = Math.max(0, mags - 1);
    if (mags === 0) state.ammo = 0;
  }
  const loaded = !Number.isInteger(mags) || mags > 0;
  if (Number.isInteger(rounds) && rounds >= 0 && loaded) {
    state.ammo = rounds;
    if (rounds > 0 && state.reloadRemaining > 0) state.reloadRemaining = 0;
  }
  return before[0] !== state.ammo || before[1] !== state.magsLeft || before[2] !== state.reloadRemaining;
}

/**
 * Which of the server's guns (`[[gunTemplate, rounds, mags], ...]`, the
 * template's order) each of the page's seat guns is, by template name, the
 * case ignored: `names` is the page's FireArms nodes' names. A gun
 * the server does not name falls back to its place in the order when the two
 * lists are the same length. Returns, per page gun, the server's entry or null.
 */
export function matchServerGuns(names, guns) {
  if (!Array.isArray(names) || !Array.isArray(guns)) return [];
  const used = new Set();
  return names.map((name, i) => {
    const want = String(name ?? '').toLowerCase();
    const named = (g, j) => !used.has(j) && String(g?.[0] ?? '').toLowerCase() === want;
    // GLTFLoader suffixes a duplicate node name (`Browning_1`).
    const bare = want.replace(/_\d+$/, '');
    const suffixed = (g, j) => !used.has(j) && String(g?.[0] ?? '').toLowerCase() === bare;
    let at = want ? guns.findIndex(named) : -1;
    if (at < 0 && bare && bare !== want) at = guns.findIndex(suffixed);
    if (at < 0 && names.length === guns.length && !used.has(i) && guns[i]?.[0] == null) at = i;
    if (at < 0) return null;
    used.add(at);
    return guns[at];
  });
}

/**
 * How far the page's copy of the hull the player drives must move to stand
 * at the server's hit points: positive is damage, negative a repair, 0
 * nothing. `local` is the copy's Armor (`hitPoints`, `destroyed`), `server`
 * the server's last word on the hull (`hp`, `destroyed`; net-room.js
 * `takeServerHp`). The copy is never taken to destruction: the server's own
 * rows end that seat (`seatPlanForRow`), so a zero is held a hair above.
 */
export function hullHpChange(local, server) {
  if (!local || local.destroyed || !server || server.destroyed) return 0;
  if (!Number.isFinite(server.hp) || !Number.isFinite(local.hitPoints)) return 0;
  const diff = local.hitPoints - Math.max(server.hp, 1e-3);
  return Math.abs(diff) > 0.05 ? diff : 0;
}
