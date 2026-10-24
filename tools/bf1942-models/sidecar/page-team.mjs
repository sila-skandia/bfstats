// The page's side choice (its `?team=`, the room protocol's `join` row), as
// the sidecar answers it.
//
// Retail's client chooses its side once the server can take it: SetTeam goes
// out from the spawn screen, after the world dump, never during a connect. A
// page may connect at any time, though: during the sidecar's first connect or
// a rejoin, before the server has a player for it. The choice used to be
// refused then and never sent again, so a page that loaded during the connect
// lost its `?team=` (browser.md, "The join"). It is now held, and sent at the
// session's join.
//
// Only before the player has ever spawned: a SetTeam kills whoever it moves,
// and a page carries its `?team=` in the URL, so every hard refresh would
// re-assert it (live, 2026-10-17: the owner, playing Axis, was switched back
// to Allies and killed by a reload alone). A side chosen after the first
// spawn is the deploy screen's business: its `spawn` row carries the team and
// the server changes sides there, where a death is expected.

const side = (t) => (t === 1 || t === 2 ? t : 0);

/**
 * `send(team)` puts the SetTeam on the wire; `log(line)` reports. Returns
 * `offer(team, state)` for the page's row and `joined(state)` for each
 * session's join, where `state` is `{ joined, team, everSpawned }`: whether
 * the server has the player now, the side it has him on, and whether he has
 * ever deployed. Each returns what it did: `sent`, `held`, `kept` (a switch
 * now would kill him), `same` or `none`.
 */
export function createPageTeam({ send, log = () => {} }) {
  let held = 0;
  function apply(team, state) {
    if (!team) return 'none';
    if (team === state.team) return 'same';
    if (state.everSpawned) {
      log(`page asked for team ${team}, keeping ${state.team}: a switch now would kill him`);
      return 'kept';
    }
    send(team);
    return 'sent';
  }
  return {
    offer(team, state) {
      const t = side(Number(team));
      if (!state.joined) {
        // The newest page's word wins; a page that names no side clears
        // nothing a page before it asked for.
        if (t) held = t;
        if (t) log(`page asked for team ${t}: held until the server has the player`);
        return t ? 'held' : 'none';
      }
      held = 0;
      return apply(t, state);
    },
    joined(state) {
      const t = held;
      held = 0;
      return apply(t, state);
    },
    get held() { return held; },
  };
}
