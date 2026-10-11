/**
 * What one locked-pointer `pointermove` is: motion, a button edge, or both.
 *
 * The page used to decide on `e.button !== -1` alone ("this move is really a
 * chorded button change") and drop `movementX/Y` of every such event. Per the
 * PointerEvents spec a plain move carries `button === -1`, but a browser or
 * compositor that reports the HELD button on every move (a Wayland session,
 * a coalesced event that merged a press) made the whole of a held right
 * button's mouse-look vanish: the aim button is held to zoom, so aimed look
 * stuttered or did not move at all, while an unzoomed hip look was fine.
 *
 * The edge is now read off the `buttons` bitmask against the last mask seen,
 * which is what actually changed; `button` only names the edge when the mask
 * did change. A move whose mask is unchanged is motion whatever `button` says.
 */

/** `e.buttons` bit -> `e.button` number (middle and right are swapped). */
const BIT_BUTTON = [[1, 0], [2, 2], [4, 1], [8, 3], [16, 4]];

/**
 * Route one move. `state.buttons` is the mask last seen (updated here and by
 * the page's pointerdown/pointerup). Returns what was done, for tests.
 *
 *  - mask changed: each differing bit goes to `buttonChange` as its own edge.
 *    The event's `movementX/Y` is NOT fed when `e.button !== -1`: that is the
 *    chorded edge whose delta can be a large synthetic one (the ~90 degree
 *    snap this guard was written for). An edge reported with `button === -1`
 *    (coalesced) is real travel and is fed.
 *  - mask unchanged: motion, always fed.
 */
export function routePointerMove(state, e, { buttonChange, lookDelta }) {
  const now = e.buttons | 0;
  const was = state.buttons | 0;
  state.buttons = now;
  const changed = now ^ was;
  let edges = 0;
  if (changed) {
    for (const [bit, button] of BIT_BUTTON) {
      if (!(changed & bit)) continue;
      buttonChange({ button, buttons: now });
      edges++;
    }
    if (e.button !== -1 && e.button !== undefined) return { edges, fed: false };
  }
  lookDelta(e.movementX, e.movementY);
  return { edges, fed: true };
}
