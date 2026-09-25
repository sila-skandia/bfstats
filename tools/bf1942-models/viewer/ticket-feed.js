/**
 * The ticket counter's HUD variables and the flag icons beside them, fed
 * from the live round (`round-state.js`). Split out of `map-surfaces.js`.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `capturePosition`, `currentDir`, `deployTeamId`, `extras`, `hudPack`,
 * `LOCAL_PLAYER`, `nearestEnemyFlag`, `optOnFoot`, `round`, `soldier`,
 * `soldierDead`, `spawnersRoot`, `teamNation`, `world`.
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
    // The layout's own literal is `flag_ticket_ger.tga` and the pack ships
    // brit/can/ger/jp/rus/us. `teamNation` answers in exactly those codes.
    return `flag_ticket_${page.teamNation(team)}.tga`;
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
  ticketFeed.ticketMemoSpawners = null;
  ticketFeed.ticketMemoCounts = null;
  const ticketMemo = {
    show: false, axis: '', allied: '', axisFlag: '', alliedFlag: '',
  };
  function ticketMemoFor() {
    // The counts are the LEVEL's object, replaced (never mutated in place) by
    // whoever moves them: the page's round (`map.html` `syncTickets`) or a
    // room's own `ticket` rows (`net-room.js`). Its identity is therefore the
    // change signal, and the reason this is a key of its own rather than part
    // of the `extras` one.
    const counts = page.extras.tickets;
    if (ticketFeed.ticketMemoDir === page.currentDir && ticketFeed.ticketMemoExtras === page.extras
        && ticketFeed.ticketMemoNations === page.hudPack.nations
        && ticketFeed.ticketMemoSpawners === page.spawnersRoot
        && ticketFeed.ticketMemoCounts === counts) {
      return ticketMemo;
    }
    ticketFeed.ticketMemoDir = page.currentDir;
    ticketFeed.ticketMemoExtras = page.extras;
    ticketFeed.ticketMemoNations = page.hudPack.nations;
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
  function feedTicketVars(vars) {
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
    // The two red 50%-alpha quads over the numbers are the engine's low-ticket
    // warning, and it is a live-round state on a timer nothing here runs.
    // Fed false rather than left unfed so the leaves cull deterministically
    // instead of on whatever happened to be in the table.
    vars['Ticket/ShowAxisTicketBlink'] = false;
    vars['Ticket/ShowAlliedTicketBlink'] = false;
    return true;
  }

  /** Fill in the `ShowFlagIcon` group's variables: the neutral white-flag disc
   *  the game paints beneath the minimap while the local player is inside a
   *  neutral control point's capture radius.
   *
   *  The layout's own condition is `ShowFlagIcon && !AxisFlagIcon &&
   *  !AlliedFlagIcon` (the 64x64 `icon_flag` leaf at (720,230)): the disc is up
   *  exactly while no side's CTF flag is up, which in conquest is the whole
   *  round. So the feed is one question — is the player standing in a neutral
   *  point's radius? — answered from the same `nearestEnemyFlag` the capture
   *  loop runs, over the same `flags` it reads. A stale true would leave the
   *  white flag up after walking away or after the take, so every path that
   *  takes the player off a flag (leave radius, take, death, mode switch)
   *  clears this too, through the same `updateSoldierHud` frame path. CTF leaves
   *  (`AxisFlagIcon`, `AlliedFlagIcon`, `ShowNonTakeableFlagIcon`) are fed false
   *  rather than left unfed so they cull deterministically. */
  function feedFlagIconVars(vars) {
    vars['AxisFlagIcon'] = false;
    vars['AlliedFlagIcon'] = false;
    vars['ShowNonTakeableFlagIcon'] = false;
    if (!page.optOnFoot.checked || !page.soldier || page.soldierDead) {
      vars['ShowFlagIcon'] = false;
      return false;
    }
    const player = page.world?.player(page.LOCAL_PLAYER);
    const team = player?.team ?? page.deployTeamId;
    const target = page.nearestEnemyFlag(team, page.capturePosition());
    // Neutral only: an enemy-held point is a take-back, not the white flag —
    // the disc is the "this point belongs to nobody" marker.
    const show = !!target && target.team !== 1 && target.team !== 2;
    vars['ShowFlagIcon'] = show;
    return show;
  }

  Object.assign(ticketFeed, {
    feedFlagIconVars,
    feedTicketVars,
    ticketFlagTexture,
    ticketMemoFor,
  });
  return ticketFeed;
}
