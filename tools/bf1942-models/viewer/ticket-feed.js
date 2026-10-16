import { GAME_PLAY_MODE, gamePlayModeOf, holdWeight } from './round-state.js';

/** The weight an enemy holds that raises a side's ticket blink, and the
 *  tickets under which ObjectiveMode raises it instead (BF1942.exe map draw
 *  0x0046a680: `setge` against 100 at 0x0046ca3e..0x0046ca54, `setle` against
 *  10 at 0x0046ca5a..0x0046ca86; ledger RADIO-9). */
export const BLINK_WEIGHT = 100;
export const BLINK_OBJECTIVE_TICKETS = 10;
/** Painted frames per toggle of the blink: `menu/InGame`'s
 *  `TimeoutActionNode{1.0, ToggleVariableAction Ticket/<Side>TicketBlink}`
 *  under `CullNode(Ticket/Show<Side>TicketBlink)`, on the HUD's 1/30 clock
 *  (HFD-5, HFD-6). */
export const BLINK_TOGGLE_FRAMES = 30;

/**
 * Which sides' ticket counters blink, the client's own rule (ledger RADIO-9;
 * the writers are `0x006e3760`, team 1 -> `Ticket/ShowAxisTicketBlink` at
 * `+9`, and `0x006e3680`, team 2 -> `Ticket/ShowAlliedTicketBlink` at `+8`,
 * called from 0x0046e19f / 0x0046e1b2): in Conquest, Co-op and Objective
 * only, a side blinks while the ENEMY's summed area value over the points it
 * holds is 100 or more (Objective: while the side's own tickets are 10 or
 * fewer). The client computes it from the control points' replicated teams;
 * nothing the server sends says a side bleeds, and the rule is the side's
 * whatever its bleed rate (Wake co-op's Allies, at 10000 a minute, would
 * blink as readily as the Japanese at 15). `points` is `{ team, areaValue }`,
 * `tickets` `{ team1, team2 }`.
 */
export function ticketBlinks(gpm, points, tickets = null) {
  const off = { 1: false, 2: false };
  if (gpm !== GAME_PLAY_MODE.conquest && gpm !== GAME_PLAY_MODE.coop && gpm !== GAME_PLAY_MODE.objective) return off;
  if (gpm === GAME_PLAY_MODE.objective) {
    const n = (v) => (Number.isFinite(v) ? v : Infinity);
    return { 1: n(tickets?.team1) <= BLINK_OBJECTIVE_TICKETS, 2: n(tickets?.team2) <= BLINK_OBJECTIVE_TICKETS };
  }
  const held = holdWeight(points);
  return { 1: held[2] >= BLINK_WEIGHT, 2: held[1] >= BLINK_WEIGHT };
}

/**
 * The ticket counter's HUD variables and the flag icons beside them, fed
 * from the live round (`round-state.js`). Split out of `map-surfaces.js`.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `capturePosition`, `currentDir`, `deployTeamId`, `extras`, `hudPack`,
 * `LOCAL_PLAYER`, `nearestEnemyFlag`, `round`, `soldierDead`,
 * `spawnersRoot`, `teamArt`, `teamNation`, `world`, and `loadouts` (a memo
 * key).
 */
export function createTicketFeed(page) {
  const ticketFeed = {};

  /* The ticket counter.
   *
   * `ShowTicket` gates one top-level entry of `menu/InGame` — a sibling of the
   * spawn screen's `Kit/ShowKit`, not a child of it — so the game draws the same
   * nine leaves over the live world and over the deploy screen. Both painters
   * here read that one group: `hud.js` picks it up from `hud-layout.json`
   * generically (the group is new there this round; `extract_hud_layout.py`),
   * and `paintDeployChrome` draws it beside the spawn group.
   *
   * The counts are `scene.json.tickets`, parsed by `bf42/level.py` out of the
   * level's own `GameTypes/<mode>.con` (`Game.setNumberOfTickets`). Team 1 is
   * Axis and team 2 Allied, the reading this file already uses everywhere else
   * (`flag.team === 1 ? 'Axis' : ...`).
   *
   * They MOVE now. The page's round (`round-state.js`, wired in `map.html`)
   * spends a ticket per death and bleeds one per `60 / rate` seconds while the
   * enemy holds more than 99 weight of the map, and writes the result back
   * into `extras.tickets` on every change (`syncTickets`) — which is the
   * update path the memo below and `net-room.js` both use, and the reason the
   * key is the extras object's identity. A room is the server's: there its own
   * `ticket` rows are what lands in `extras.tickets`, and the round is not run
   * at all.
   */
  function ticketFlagTexture(team) {
    // The side's soldier's own `setTicketIcon` (BF1942.exe 0x006ac8a6: the
    // template `getTeamSkin(team)` names, vtable +0xc8, into the ticket
    // pictures), where the pack knows it. Otherwise the layout's own literal
    // family, `flag_ticket_<nation>.tga`, which `teamNation` answers in.
    const own = page.teamArt?.(team)?.ticket;
    return own ? own.replace(/\\/g, '/').split('/').pop() : `flag_ticket_${page.teamNation(team)}.tga`;
  }

  /* The four strings the group needs, memoised on the level.
   *
   * `feedTicketVars` runs from `updateSoldierHud` BEFORE every one of its early
   * returns, so it is on the frame path in every mode — and every input but the
   * counts is level data that cannot move under it. The counts are the round's
   * live ones (`round-state.js`): the page writes them back into
   * `extras.tickets` as a FRESH object whenever they move (`map.html`
   * `syncTickets`), and a room's server does the same with its `ticket` rows
   * (`net-room.js`), so the key below — the extras object's identity — is
   * exactly the change signal. One that mutated the counts IN PLACE would have
   * to bump the key here too. The two flag textures are `teamNation`, which is
   * the flag a side's control points fly.
   *
   * Unmemoised that cost, twice per frame: `nationFromVehicles` lowercasing all
   * 32 of Wake's spawner names into a Set, spreading that Set into a fresh array
   * once per nation stem inside a `.some`, and building a template literal per
   * name per stem; `teamNationRule` building a Map and re-scanning the control
   * points; and two `String()` conversions. `stanceNation` above already
   * memoises the identical rule for the stance icon for exactly this reason
   * (features/mesh-viewer-performance, rule 5).
   *
   * The key is every input that can move: the level directory; the gameplay-mode
   * `extras` (`show()` assigns `selectGameMode`'s fresh object roughly a hundred
   * lines before `currentDir`, so the dir alone is not enough on its own terms
   * even though no frame runs between the two); the flag-mesh table, which
   * `loadHudPack` fills asynchronously and can land after a level does; and the
   * spawner group, which `indexScene` rebuilds per level.
   *
   * That last one is also why this must NOT be recomputed per frame rather than
   * merely why it can be cached: `Vehicle`'s constructor reparents the driven
   * vehicle OUT of `spawnersRoot`, so a per-frame `nationFromVehicles` would flip
   * Wake's Axis ticket flag from Japanese to German for as long as a player sits
   * in the level's only Zero. Keying on the group's identity — not its contents —
   * holds the round-start answer for the whole round, which is the one the game
   * shows.
   */
  ticketFeed.ticketMemoDir = null;
  ticketFeed.ticketMemoExtras = null;
  ticketFeed.ticketMemoNations = null;
  ticketFeed.ticketMemoSoldiers = null;
  ticketFeed.ticketMemoLoadouts = null;
  ticketFeed.ticketMemoSpawners = null;
  ticketFeed.ticketMemoCounts = null;
  const ticketMemo = {
    show: false, axis: '', allied: '', axisFlag: '', alliedFlag: '',
  };
  // The layout's two blink timers: the phase variable (`BoolData{True}` in
  // the file) and the frames its `TimeoutActionNode` has counted, which runs
  // only while its cull shows and keeps its count while hidden (HFD-5).
  const blink = { 1: { on: true, frames: 0 }, 2: { on: true, frames: 0 } };
  ticketFeed.blink = blink;
  function ticketMemoFor() {
    // The counts are the LEVEL's object, replaced (never mutated in place) by
    // whoever moves them: the page's round (`map.html` `syncTickets`) or a
    // room's own `ticket` rows (`net-room.js`). Its identity is therefore the
    // change signal, and the reason this is a key of its own rather than part
    // of the `extras` one.
    const counts = page.extras.tickets;
    if (ticketFeed.ticketMemoDir === page.currentDir && ticketFeed.ticketMemoExtras === page.extras
        && ticketFeed.ticketMemoNations === page.hudPack.nations
        && ticketFeed.ticketMemoSoldiers === page.hudPack.soldiers
        && ticketFeed.ticketMemoLoadouts === page.loadouts
        && ticketFeed.ticketMemoSpawners === page.spawnersRoot
        && ticketFeed.ticketMemoCounts === counts) {
      return ticketMemo;
    }
    ticketFeed.ticketMemoDir = page.currentDir;
    ticketFeed.ticketMemoExtras = page.extras;
    ticketFeed.ticketMemoNations = page.hudPack.nations;
    // The soldiers' art and the level's team skins, which name the flags now
    // and both land asynchronously, like the flag-mesh table.
    ticketFeed.ticketMemoSoldiers = page.hudPack.soldiers;
    ticketFeed.ticketMemoLoadouts = page.loadouts;
    ticketFeed.ticketMemoSpawners = page.spawnersRoot;
    ticketFeed.ticketMemoCounts = counts;
    const t = counts;
    // Both counts or none: the group draws two numbers side by side and a lone
    // one would leave the layout's own sample literal ("300"/"500") showing
    // next to a real value, which reads as data rather than as a gap.
    ticketMemo.show = !!t && t.team1 != null && t.team2 != null;
    ticketMemo.axis = ticketMemo.show ? String(t.team1) : '';
    ticketMemo.allied = ticketMemo.show ? String(t.team2) : '';
    ticketMemo.axisFlag = ticketMemo.show ? ticketFlagTexture(1) : '';
    ticketMemo.alliedFlag = ticketMemo.show ? ticketFlagTexture(2) : '';
    return ticketMemo;
  }

  /** Fill in the `ShowTicket` group's variables on a table. Returns whether the
   *  group will draw. */
  function feedTicketVars(vars, { paint = false } = {}) {
    const memo = ticketMemoFor();
    if (!memo.show) {
      vars['ShowTicket'] = false;
      return false;
    }
    vars['ShowTicket'] = true;
    vars['AxisTicket'] = memo.axis;
    vars['AlliedTicket'] = memo.allied;
    vars['AxisTicketFlag'] = memo.axisFlag;
    vars['AlliedTicketFlag'] = memo.alliedFlag;
    // The two red 50%-alpha quads over the numbers: a side whose enemy holds
    // the map's weight (`ticketBlinks`), from the points' teams the page
    // keeps in `extras.controlPoints` -- the page's own captures offline, the
    // server's `cp` rows in a room or through the sidecar (net-room.js
    // `hoistCaptureFlag`), so both read the same rule. Each quad flashes on
    // the layout's own timer, advanced once per painted HUD frame (`paint`;
    // the deploy screen's repaint reads it without counting).
    const mode = page.round?.gamePlayMode ?? gamePlayModeOf(page.extras?.gameplayMode);
    const shows = ticketBlinks(mode, page.extras?.controlPoints, page.extras?.tickets);
    for (const [team, side] of [[1, 'Axis'], [2, 'Allied']]) {
      const b = blink[team];
      if (paint && shows[team] && ++b.frames >= BLINK_TOGGLE_FRAMES) { b.frames = 0; b.on = !b.on; }
      vars[`Ticket/Show${side}TicketBlink`] = shows[team];
      vars[`Ticket/${side}TicketBlink`] = b.on;
    }
    return true;
  }

  /** Fill in the `ShowFlagIcon` group's variables: the flag the game paints
   *  beneath the minimap while the local player stands where he takes a
   *  control point (`icon_flag`: vanilla's white flag, Forgotten Hope's Iwo
   *  Jima flag raising).
   *
   *  The client's rule is HUD-15, read in its map update's control point loop
   *  (BF1942.exe 0x0046c3db): a point whose team is not the local player's,
   *  whose template is not `unableToChangeTeam`, with the player alive and his
   *  controlled object (the hull, when mounted) within the template's radius
   *  in 3D. Neutral or enemy-held makes no difference, and a point of his own
   *  side or one the map fixes raises nothing: the same loop's
   *  `ShowNonTakeableFlagIcon` store sits behind the `unableToChangeTeam` test
   *  that has already left, so it is never reached. That is `nearestEnemyFlag`
   *  over the flags the capture law runs on.
   *
   *  Fed every frame from `updateSoldierHud`, so leaving the radius, the take,
   *  a death and leaving the world all clear it. The CTF leaves
   *  (`AxisFlagIcon`, `AlliedFlagIcon`) are fed false here and raised after by
   *  `ctf-page.js`. */
  function feedFlagIconVars(vars) {
    vars['AxisFlagIcon'] = false;
    vars['AlliedFlagIcon'] = false;
    vars['ShowNonTakeableFlagIcon'] = false;
    const player = page.world?.player(page.LOCAL_PLAYER);
    const position = player && !page.soldierDead ? page.capturePosition() : null;
    const show = !!position && !!page.nearestEnemyFlag(player.team ?? page.deployTeamId, position);
    vars['ShowFlagIcon'] = show;
    return show;
  }

  Object.assign(ticketFeed, {
    ticketBlinks,
    feedFlagIconVars,
    feedTicketVars,
    ticketFlagTexture,
    ticketMemoFor,
  });
  return ticketFeed;
}
