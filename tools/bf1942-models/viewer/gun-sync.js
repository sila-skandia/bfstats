// A seat gun's magazine on a page in a room: the page's own FireState put
// right against the server's.
//
// In a room the server's FireArms is the one that fires (`server/room-guns.mjs`)
// and its magazine is the truth; the page predicts the same law on its own
// copy (`fire-state.js`), so its HUD counts down the moment the trigger is
// pulled. The server sends the holder each gun's state (`gun` rows: on taking
// the seat, on a reload starting or ending, on a spare magazine going or
// coming back, a few times a second while rounds leave, and every two seconds
// regardless). Retail does the same with the control object's state, which
// carries the player's own FireArms counter for the client to reconcile its
// predicted gun against (`GhostManager::writeControlObjectState`; the relay's
// `control` record, `net-room.js`).
//
// The page runs ahead of the server by the trip its input word takes, so
// while the trigger is held the page may have spent a few rounds the server
// has not yet: that lead is left alone (`slack`). Anything else is the
// server's word.

/** The lead a held trigger may have over the server, in seconds of fire. */
export const GUN_SYNC_LEAD_S = 0.5;
/** A reload clock this far from the server's is set to it, seconds. */
export const GUN_SYNC_RELOAD_S = 0.3;
/** Heat this far from the server's is set to it. */
export const GUN_SYNC_HEAT = 0.15;

/**
 * Put `state` (a `FireState`) right against the server's word for the same
 * gun: `{ ammo, mags, reload, heat, overheat }`, `mags` -1 for unlimited
 * spares. `barrels` is how many rounds one pull spends (a two-barrel gun's
 * two, BOMB-1). Returns the fields it changed, for a check.
 */
export function reconcileGun(state, server, { barrels = 1 } = {}) {
  const changed = [];
  if (!state || !server || state.unlimited) return changed;
  const set = (field, value) => {
    if (state[field] === value) return;
    state[field] = value;
    changed.push(field);
  };
  const mags = server.mags < 0 ? Infinity : server.mags;
  const serverReloading = server.reload > 0;
  const pageReloading = state.reloadRemaining > 0;
  if (serverReloading) {
    // The server is changing magazines: so is the page, on the server's clock.
    set('ammo', server.ammo);
    set('magsLeft', mags);
    if (!pageReloading || Math.abs(state.reloadRemaining - server.reload) > GUN_SYNC_RELOAD_S) {
      set('reloadRemaining', server.reload);
    }
  } else if (pageReloading) {
    // The page began a reload the server has not: its last rounds are still
    // on their way there (the server's own reload row follows), unless the
    // server holds a magazine the page's count says it cannot.
    const lead = Math.max(1, Math.ceil((state.stats?.roundOfFire ?? 1) * GUN_SYNC_LEAD_S)) * Math.max(1, barrels);
    if (server.ammo > lead) {
      set('reloadRemaining', 0);
      set('ammo', server.ammo);
      set('magsLeft', mags);
    }
  } else {
    const lead = state.held
      ? Math.max(1, Math.ceil((state.stats?.roundOfFire ?? 1) * GUN_SYNC_LEAD_S)) * Math.max(1, barrels) : 0;
    const ahead = server.ammo - state.ammo;   // rounds the page has spent that the server has not
    if (ahead < 0 || ahead > lead) set('ammo', server.ammo);
    set('magsLeft', mags);
  }
  if (state.hasHeat && Number.isFinite(server.heat) && Math.abs(state.heat - server.heat) > GUN_SYNC_HEAT) {
    set('heat', server.heat);
  }
  if (server.overheat > 0 && !(state.overheatRemaining > 0)) set('overheatRemaining', server.overheat);
  return changed;
}

/** Every FireArms node under a hull root, in the tree's own order: the place
 *  a `gun` row names its gun by (`server/room-guns.mjs` `fireArmsNodes`). */
export function fireArmsOrder(root) {
  const out = [];
  root?.traverse?.(node => { if (node.userData?.fireArms) out.push(node); });
  return out;
}
