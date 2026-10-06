/**
 * The end of a round on the page: the debriefing over the held score board,
 * the win or lose cue, the countdown and the restart into the next round.
 *
 * What the game does (ledger ROUND-1..ROUND-9, read 2026-10-06):
 *
 *  - `round-state.js` decides the winner the server's way and turns the
 *    status to EndGame, where nothing scores and no bot thinks (the AI runs
 *    only while the status is Playing, AI-4);
 *  - the score board stands without its buttons (`Scoreboard/
 *    GameStatusEndGame`) and counts each side's rounds won (ROUND-5);
 *  - the debriefing (`0x006aad90`, ROUND-8) titles the local side's result
 *    by the victory type, `DEBRIEFING_TOTAL / MAJOR / MINOR_VICTORY` or
 *    `_DEFEAT` (`DEBRIEFING_DRAW` for a draw), and under it the LEVEL's own
 *    line for the local side: its Major line for a total victory or defeat,
 *    its Minor line for a major or a minor one. Then the win cue
 *    (`setMusic(3)`) or the lose cue (`setMusic(5)`), once; a draw plays
 *    neither;
 *  - ObjectiveMode is its own branch (`cmp eax,5` at 0x006aae16): a winner's
 *    title is the bare `VICTORY` or `DEFEAT` whatever the victory type, and
 *    the line is the level's `game.setObjective<Side>Victory` / `Defeat`
 *    (0x006ab0bc..0x006ab274); the cues are the same, and a draw takes the
 *    common `DEBRIEFING_DRAW` path;
 *  - `giveMedal` (ROUND-9) gives the top three by score gold, silver and
 *    bronze, which the multiplayer debriefing lists under `BEST PLAYERS`;
 *  - a multiplayer server restarts the map 10 s later (`+0x21c`, ROUND-9).
 *
 * What is the page's choice: the debriefing's placement. The game draws it
 * from `menu/LoadMenu`, whose TrueType text nodes the MemeFile flattener does
 * not read yet, so the plate (`mp_debriefing_512x512`, the extracted art) is
 * centred over the 800x600 virtual screen and the text sits in its three
 * bands: the title over the first, the level's line in it, the best players
 * in the second and the countdown in the third. The words are the game's
 * (`scene.json.briefing.debriefing`, the mod chain's lexicon); a tree baked
 * before they were exported falls back to the English below.
 *
 * The top half of the file is pure (no DOM, no page) so
 * `tests/round_end_harness.mjs` runs it; `createRoundEnd` is the page's.
 */

import { GAME_PLAY_MODE, VICTORY } from './round-state.js';

/** The debriefing's titles and heading in vanilla's English, for a tree
 *  whose `scene.json` predates `briefing.debriefing.titles`. */
export const DEBRIEFING_ENGLISH = Object.freeze({
  DEBRIEFING_TOTAL_VICTORY: 'TOTAL VICTORY', DEBRIEFING_MAJOR_VICTORY: 'MAJOR VICTORY',
  DEBRIEFING_MINOR_VICTORY: 'MINOR VICTORY', DEBRIEFING_TOTAL_DEFEAT: 'TOTAL DEFEAT',
  DEBRIEFING_MAJOR_DEFEAT: 'MAJOR DEFEAT', DEBRIEFING_MINOR_DEFEAT: 'MINOR DEFEAT',
  DEBRIEFING_DRAW: 'DRAW', DEBRIEFING_HEADING: 'BEST PLAYERS',
  VICTORY: 'VICTORY', DEFEAT: 'DEFEAT',
});

/**
 * What the debriefing shows for the local side (ROUND-8). `winner` is 1, 2
 * or 0 for a draw, `victoryType` a `VICTORY` value, `localTeam` the reader's
 * side. Null when the round has no result yet (type 4, `none`, which the
 * client refuses to build on).
 *
 * Returns `{ result, titleKey, lineKey, side, music }`: `result` 'victory',
 * 'defeat' or 'draw'; `lineKey` the level line's key under `side` ('allied'
 * for team 2, else 'axis', the client's own `== 2` test), null on a draw;
 * `music` 'win', 'lose' or null.
 */
export function debriefingOf({ winner = null, victoryType = VICTORY.none, localTeam = 0,
                               objective = false } = {}) {
  if (victoryType === VICTORY.none || victoryType == null) return null;
  const side = localTeam === 2 ? 'allied' : 'axis';
  if (victoryType === VICTORY.draw || (winner !== 1 && winner !== 2)) {
    return { result: 'draw', titleKey: 'DEBRIEFING_DRAW', lineKey: null, side, music: null };
  }
  const won = winner === localTeam;
  if (objective) {
    // The level's objective lines: allied victory at `+0x1c`, allied defeat
    // `+0x38`, axis victory `+0x54`, axis defeat `+0x70` of the block at
    // `LevelManager+0x308`, by the same `== 2` side test.
    return {
      result: won ? 'victory' : 'defeat',
      titleKey: won ? 'VICTORY' : 'DEFEAT',
      lineKey: `${side}${won ? 'Victory' : 'Defeat'}`,
      side: 'objective',
      music: won ? 'win' : 'lose',
    };
  }
  const size = victoryType === VICTORY.total ? 'TOTAL'
    : victoryType === VICTORY.major ? 'MAJOR' : 'MINOR';
  const result = won ? 'victory' : 'defeat';
  // The level writes four lines a side: the total class reads the Major one,
  // the major and minor classes the Minor one (0x006aae86..0x006ab0b2).
  const lineSize = victoryType === VICTORY.total ? 'major' : 'minor';
  return {
    result,
    titleKey: `DEBRIEFING_${size}_${won ? 'VICTORY' : 'DEFEAT'}`,
    lineKey: `${lineSize}${won ? 'Victory' : 'Defeat'}`,
    side,
    music: won ? 'win' : 'lose',
  };
}

/** The words for a `debriefingOf` answer out of `scene.json.briefing`:
 *  `{ title, line, heading }`. A missing line is the empty string. */
export function debriefingWords(result, briefing = null) {
  const titles = { ...DEBRIEFING_ENGLISH, ...(briefing?.debriefing?.titles ?? {}) };
  if (!result) return { title: '', line: '', heading: titles.DEBRIEFING_HEADING };
  const line = result.lineKey ? briefing?.debriefing?.[result.side]?.[result.lineKey] ?? '' : '';
  return { title: titles[result.titleKey] ?? '', line: String(line).trim(), heading: titles.DEBRIEFING_HEADING };
}

/** The medal art `extract_hud_pack.py` writes: the 32x32 kind, in the
 *  medal winner's own side's set (`allied` for team 2, `axis` otherwise). */
export function medalSprite(medal, team) {
  return `${team === 2 ? 'allied' : 'axis'}_xl_${medal}_32x32.png`;
}

/** The countdown the third band shows: whole seconds left, never below 0,
 *  and nothing while the round waits for nobody (a single-player round). */
export function countdownText(restartIn) {
  return Number.isFinite(restartIn) ? String(Math.max(0, Math.ceil(restartIn))) : '';
}

// --- the page ------------------------------------------------------------------

const STYLE = `
#round-end { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: none; z-index: 40; }
#round-end[hidden] { display: none; }
#round-end .re-plate { position: relative; width: 512px; height: 324px;
  transform-origin: center; background: #4c4e46 no-repeat 0 0 / 512px 512px;
  font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #e8e4d2;
  text-shadow: 1px 1px 0 #000; }
#round-end .re-title { position: absolute; left: 0; right: 0; top: 4px; height: 70px;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; font-weight: bold; letter-spacing: 3px; }
#round-end .re-line { position: absolute; left: 14px; right: 14px; top: 84px; height: 80px;
  overflow: hidden; font-size: 11px; line-height: 13px; text-align: justify; }
#round-end .re-heading { position: absolute; left: 14px; top: 176px; font-size: 11px;
  font-weight: bold; letter-spacing: 1px; }
#round-end .re-medals { position: absolute; left: 14px; right: 14px; top: 192px; height: 48px;
  display: flex; gap: 10px; }
#round-end .re-medal { flex: 1; display: flex; align-items: center; gap: 6px; font-size: 11px;
  min-width: 0; }
#round-end .re-medal img { width: 32px; height: 32px; image-rendering: pixelated; flex: none; }
#round-end .re-medal span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#round-end .re-countdown { position: absolute; left: 0; right: 0; top: 256px; height: 60px;
  display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: bold; }
`;

/**
 * Built once by the page. `page` hands in, as getters or functions:
 * `round` (the live `round-state.js` round, rebuilt per level), `extras`
 * (the level's `scene.json`), `stage` (the element to draw over),
 * `spriteUrl(rel)` (a HUD-pack path to a URL), `localTeam()`, `nameOf(id)`,
 * `roster()` (`[{ id, team }]`, everyone on the page), `holdScoreboard(on)`,
 * `playRoundMusic(kind)`, `stopRoundMusic()`, `releasePointer()`,
 * `clearWorld()`, the end game's first tick, and `restartRound()`, which runs
 * the page's `restartMap`.
 */
export function createRoundEnd(page) {
  const roundEnd = { shown: false, model: null, restarts: 0 };
  let root = null;
  let parts = null;
  /** The round the screen opened for: a new level's round closes it. */
  let openedFor = null;

  function build() {
    if (root || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'round-end';
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    const plate = document.createElement('div');
    plate.className = 're-plate';
    const part = cls => { const el = document.createElement('div'); el.className = cls; plate.appendChild(el); return el; };
    parts = { plate, title: part('re-title'), line: part('re-line'), heading: part('re-heading'),
              medals: part('re-medals'), countdown: part('re-countdown') };
    root.appendChild(plate);
    (page.stage ?? document.body).appendChild(root);
  }

  /** Fit the 512-wide plate to the stage as the 800x600 virtual screen does. */
  function fit() {
    if (!parts) return;
    const stage = page.stage ?? document.body;
    const k = Math.min((stage.clientWidth || 800) / 800, (stage.clientHeight || 600) / 600);
    parts.plate.style.transform = `scale(${Math.max(0.4, k)})`;
  }

  function open(round) {
    const result = debriefingOf({ winner: round.winner, victoryType: round.victoryType,
                                  localTeam: page.localTeam(),
                                  objective: round.gamePlayMode === GAME_PLAY_MODE.objective });
    const words = debriefingWords(result, page.extras?.briefing ?? null);
    const medals = round.medals(page.roster?.() ?? []).map(m => ({
      ...m, name: page.nameOf?.(m.playerId) ?? String(m.playerId), sprite: medalSprite(m.medal, m.team),
    }));
    roundEnd.model = { result, words, medals, winner: round.winner, victoryType: round.victoryType,
                       reason: round.endReason, music: result?.music ?? null };
    // The end game's first tick empties the field (`clearWorld`, ROUND-10),
    // once the medals have been read off the players still standing.
    page.clearWorld?.();
    roundEnd.shown = true;
    openedFor = round;
    build();
    if (parts) {
      const plateArt = page.spriteUrl?.('mp_debriefing_512x512.png');
      if (plateArt) parts.plate.style.backgroundImage = `url("${plateArt}")`;
      parts.title.textContent = words.title;
      parts.line.textContent = words.line;
      parts.heading.textContent = words.heading;
      parts.medals.replaceChildren(...medals.map(m => {
        const row = document.createElement('div');
        row.className = 're-medal';
        const img = document.createElement('img');
        img.alt = m.medal;
        img.onerror = () => { img.style.visibility = 'hidden'; };
        const src = page.spriteUrl?.(m.sprite);
        if (src) img.src = src;
        const name = document.createElement('span');
        name.textContent = m.name;
        row.append(img, name);
        return row;
      }));
      parts.countdown.textContent = countdownText(round.restartIn);
      fit();
      root.hidden = false;
    }
    page.releasePointer?.();
    page.holdScoreboard?.(true);
    if (result?.music) page.playRoundMusic?.(result.music);
  }

  function close() {
    roundEnd.shown = false;
    openedFor = null;
    if (root) root.hidden = true;
    page.holdScoreboard?.(false);
    page.stopRoundMusic?.();
  }

  /**
   * One frame, after the round's own tick: open on the edge into EndGame,
   * count down, and run the restart when the multiplayer timer is out
   * (`restartDue`). A level change (a new round object) closes the screen.
   */
  roundEnd.tick = () => {
    const round = page.round;
    if (roundEnd.shown && openedFor && openedFor !== round) close();
    if (!round) return;
    if (!roundEnd.shown && round.status === 'endGame') open(round);
    if (!roundEnd.shown) return;
    if (parts) {
      const text = countdownText(round.restartIn);
      if (parts.countdown.textContent !== text) parts.countdown.textContent = text;
    }
    if (round.restartDue()) {
      roundEnd.restarts += 1;
      close();
      page.restartRound?.();
    } else if (round.status === 'playing') {
      close();
    }
  };

  roundEnd.close = close;
  roundEnd.resize = fit;
  /** What the screen shows, for the test hooks. */
  roundEnd.state = () => ({
    shown: roundEnd.shown,
    restarts: roundEnd.restarts,
    title: parts?.title.textContent ?? roundEnd.model?.words.title ?? '',
    line: parts?.line.textContent ?? roundEnd.model?.words.line ?? '',
    heading: parts?.heading.textContent ?? roundEnd.model?.words.heading ?? '',
    countdown: parts?.countdown.textContent ?? (roundEnd.shown ? countdownText(page.round?.restartIn) : ''),
    medals: roundEnd.model?.medals ?? [],
    result: roundEnd.model?.result ?? null,
    music: roundEnd.model?.music ?? null,
  });
  return roundEnd;
}
