// The respawn HUD's status line (`menu/InGame` group `statusMessage`, the
// `textmessBG_2line` plate at (305, 65)): "ADDITIONAL PLAYERS NEEDED UNTIL
// GAME STARTS: n" while a joined game is short of players, and "GAME IS
// RESTARTING" for five seconds once it is not. Pure, so
// `tests/status_message_harness.mjs` runs it under node.
//
// The client's law (BF1942.exe `FUN_006ad0a0`, the per-frame HUD feed; ledger
// HUD-24), in a game joined or hosted (`BfMenu+0x6dc` 2 or 3), on every frame
// the game status is not 2:
//
//   - while its latch (`BfMenu+0xec`) is clear: n = game vt+0x100
//     (`getMinNrOfPlayers`) - PlayerManager vt+0x58 (the player count).
//     n > 0 shows INFO_MESSAGE_GAME_NOT_STARTED + " %d" of n (0x006ad442..
//     0x006ad4a0) and leaves the latch clear, so the count follows the
//     players; n < 1 shows INFO_MESSAGE_GAME_IS_RESTARTING, sets the timer
//     `+0xf0` to 6.0 and the latch (0x006ad4d5..0x006ad513);
//   - while the timer is above 0 it loses the frame's dt, and once under 1.0
//     the line is hidden (`FUN_006a7dd0`, 0x006ad51a..0x006ad54f): five
//     seconds on screen.
//
// The latch is clear when the menu is built and is cleared again by the end
// of a round (`FUN_006aaaa0`, reached on game status 2, the write at
// 0x006aab9f), so every round that follows opens on the line once more.
// `FUN_006a7d80` sets `ShowStatusMessage` (`+0x4c0`, registered at
// 0x006e28a9) and the text; `FUN_006a7dd0` clears both.

export const RESTART_SECONDS = 6;
const HIDE_UNDER = 1;

const ENGLISH = {
  INFO_MESSAGE_GAME_NOT_STARTED: 'ADDITIONAL PLAYERS NEEDED UNTIL GAME STARTS:',
  INFO_MESSAGE_GAME_IS_RESTARTING: 'GAME IS RESTARTING',
};

export function createStatusMessage() {
  return { latched: false, timer: 0, show: false, text: '' };
}

/**
 * One frame. `s` from `createStatusMessage`; `dt` seconds; `status` the
 * server's game status (null before one); `minPlayers` the server's (null
 * when unknown, which shows nothing); `players` the player count; `strings`
 * the lexicon (English when it lacks the keys). Returns `s`.
 */
export function stepStatusMessage(s, dt, { status = null, minPlayers = null, players = 0, strings = null } = {}) {
  if (status === 2) {
    // The end of a round clears the latch (0x006aab9f); the debriefing has
    // the screen, and the line keeps whatever it last showed underneath.
    s.latched = false;
    return s;
  }
  if (status == null || !Number.isFinite(minPlayers)) return s;
  if (!s.latched) {
    const n = minPlayers - (Number(players) || 0);
    if (n > 0) {
      s.show = true;
      s.text = `${strings?.INFO_MESSAGE_GAME_NOT_STARTED ?? ENGLISH.INFO_MESSAGE_GAME_NOT_STARTED} ${n}`;
    } else {
      s.show = true;
      s.text = strings?.INFO_MESSAGE_GAME_IS_RESTARTING ?? ENGLISH.INFO_MESSAGE_GAME_IS_RESTARTING;
      s.timer = RESTART_SECONDS;
      s.latched = true;
    }
  }
  if (s.timer > 0) {
    s.timer -= Math.max(0, dt);
    if (s.timer < HIDE_UNDER) { s.timer = Math.max(s.timer, 0); s.show = false; s.text = ''; }
  }
  return s;
}
