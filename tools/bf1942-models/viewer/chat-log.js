/* The in-game message log: kill lines, game information and chat/radio, the
 * three stacked sections at the top left of the screen, plus the centre kill
 * message.
 *
 * The box, its font, row height and divider come from `menu/InGame`, the
 * colours from `Game/Init/Menu.con` and the section sizes and timeout from the
 * default profile's `GeneralOptions.con`, all extracted to `chat-layout.json`
 * (`extract_radio.py`). What the client does with them is below, read out of
 * BF1942.exe (sha256 60c9452d...cd3699); the addresses and the evidence are
 * in `features/radio-and-chat-log/README.md`.
 *
 * `ChatLog` and the text builders import nothing and touch no DOM, so
 * `tests/chat_log_harness.mjs` runs them under node.
 */

/** Section indices, as `addChatMessageInternal` (0x006A89C0) numbers them:
 *  0 chat and radio, 1 game information, 2 kills. */
export const SECTION_CHAT = 0;
export const SECTION_INFO = 1;
export const SECTION_KILL = 2;

/** The engine's own "at most twelve rows in all" rule (the three setters and
 *  `setChatHistory` 0x006A8CA0 refuse more). */
export const MAX_TOTAL_ROWS = 12;

/**
 * The three sections and their rows.
 *
 * Kills are always the top section, starting at row 0; game information
 * starts one blank row below the kills; chat one blank row below that (the
 * profile re-apply 0x006A8DF0, which is what a player sees in a match). New
 * lines go at the bottom of their section; a full section drops its oldest
 * line first.
 *
 * Lines expire by section, not by line (update 0x006A8160): while a section
 * holds lines its one timer runs, and when it passes `timeUntilMessageRemoved`
 * (strictly greater) the oldest line goes and the timer restarts from 0. Any
 * new line restarts the CHAT section's timer only -- a hard-coded write at
 * 0x006A8BF9 -- so a steady kill feed never keeps the kills up longer. There
 * is no fade: a line is there at full alpha, then gone.
 */
export class ChatLog {
  constructor({ kill = 3, info = 2, chat = 6, timeUntilMessageRemoved = 5 } = {}) {
    this.limit = Math.min(10, Math.max(1, timeUntilMessageRemoved));
    this.sizes = { [SECTION_KILL]: kill, [SECTION_INFO]: info, [SECTION_CHAT]: chat };
    this.lines = { [SECTION_KILL]: [], [SECTION_INFO]: [], [SECTION_CHAT]: [] };
    this.timers = { [SECTION_KILL]: 0, [SECTION_INFO]: 0, [SECTION_CHAT]: 0 };
    this.version = 0;
  }

  /** The first row of each section, in the 15-row list box. */
  firstRow(section) {
    if (section === SECTION_KILL) return 0;
    const info = this.sizes[SECTION_KILL] + 1;
    if (section === SECTION_INFO) return info;
    return info + this.sizes[SECTION_INFO] + 1;
  }

  /** `line`: `{ text, team, buddy }` -- `team` 1 Axis, 2 Allies, 0 none
   *  (grey, no flag); `buddy` draws the text green, the flag still the
   *  team's. */
  add(section, line) {
    const rows = this.lines[section];
    if (!rows) return;
    const size = this.sizes[section];
    while (rows.length >= size) rows.shift();
    rows.push({ text: String(line.text ?? ''), team: line.team | 0, buddy: !!line.buddy });
    this.timers[SECTION_CHAT] = 0;
    this.version++;
  }

  tick(dt) {
    for (const section of [SECTION_CHAT, SECTION_INFO, SECTION_KILL]) {
      const rows = this.lines[section];
      if (!rows.length) continue;
      this.timers[section] += dt;
      if (this.timers[section] > this.limit) {
        rows.shift();
        this.timers[section] = 0;
        this.version++;
      }
    }
  }

  clear() {
    for (const s of [SECTION_CHAT, SECTION_INFO, SECTION_KILL]) {
      this.lines[s].length = 0;
      this.timers[s] = 0;
    }
    this.version++;
  }

  /** Every drawn row: `{ row, text, team, buddy }`, plus the divider of each
   *  section that holds lines (`{ firstRow, count }`). */
  rows() {
    const out = [];
    const dividers = [];
    for (const section of [SECTION_KILL, SECTION_INFO, SECTION_CHAT]) {
      const first = this.firstRow(section);
      const lines = this.lines[section];
      lines.forEach((line, i) => out.push({ row: first + i, section, ...line }));
      if (lines.length) dividers.push({ section, firstRow: first, count: lines.length });
    }
    return { rows: out, dividers };
  }
}

// --- the lines the game writes ----------------------------------------------

/** The bracketed word of a kill line: the lexicon string for the killer's
 *  vehicle template when he was in one (`[Tiger]`), else the lexicon's
 *  `DEFAULT_KILL_TEXT`. The server stamps the event with the root vehicle's
 *  template for a seated shooter (`FireArms::fireBarrel`); every on-foot kill
 *  in the retail captures reads `[killed]`, so a hand weapon's name is not
 *  printed here (the client's lookup for it is still an open question). */
export function killWord(vehicleTemplate, strings, names) {
  if (vehicleTemplate) return names?.[vehicleTemplate] ?? vehicleTemplate;
  return strings?.DEFAULT_KILL_TEXT ?? 'killed';
}

/** Kill (score event 3): `killer [word] victim`, the killer's team and flag. */
export function killLine(killer, victim, word) {
  return `${killer} [${word}] ${victim}`;
}

/** Team kill (6): `killer killed a teammate`, team 0. */
export function teamKillLine(killer, strings) {
  return `${killer} ${strings?.TEAM_KILL ?? 'killed a teammate'}`;
}

/** Death with a message (4): `name is no more`, team 0. The victim of a
 *  team kill gets this line under the killer's; an ordinary kill's victim
 *  gets the no-message death (5), and nothing prints for him. */
export function deathLine(name, strings) {
  return `${name} ${strings?.DEATH ?? 'is no more'}`;
}

/** A control point taken (0x006E4A60): `[name] Axis captured the control
 *  point ` -- with the trailing space the engine appends -- in the capturing
 *  team's colour, under its flag, to everyone. */
export function captureLine(pointName, team, strings) {
  const word = team === 1 ? strings?.AXIS_CAPTURED : strings?.ALLIES_CAPTURED;
  return `[${pointName}] ${word ?? (team === 1 ? 'Axis captured the control point' : 'Allies captured the control point')} `;
}

/** All points held (0x0046CAF1), team 0. */
export function allPointsLine(team, strings) {
  return (team === 1 ? strings?.AXIS_HOLD_ALL_CONTROLPOINTS : strings?.ALLIES_HOLD_ALL_CONTROLPOINTS)
    ?? `${team === 1 ? 'Axis' : 'Allies'} now hold all controlpoints!`;
}

/** Player chat (0x004919E0): team chat carries the team word. */
export function playerChatLine(name, text, { teamOnly = false, team = 0, strings } = {}) {
  if (!teamOnly) return `${name}: ${text}`;
  const word = team === 1 ? (strings?.TEAM_CHAT_AXIS ?? 'axis') : (strings?.TEAM_CHAT_ALLIES ?? 'allies');
  return `${name} [${word}]: ${text}`;
}

// --- geometry (800x600 virtual) ---------------------------------------------

/** The list box's first row sits two row heights below its top (the list
 *  draw 0x007D1390 starts at `top + 2 x 14`), which puts row 0's flag at
 *  box-relative y 17 -- the divider's own `firstRow x 14 + 17`. */
export const ROW_TOP = 17;
/** The flag: 16x16 at column 0, drawn 10 px in from the box and 11 above the
 *  row's baseline cursor. */
export const FLAG_X = 10;
export const FLAG_SIZE = 16;
/** The text column: box + 10 + the second column's 30 (0x006E2877). */
export const TEXT_X = 40;
/** The row's baseline, from the box top: 28 + 14 x row. */
export const BASELINE = 28;

export function rowGeometry(layout, row) {
  const [bx, by] = layout.box;
  const rh = layout.rowHeight;
  return {
    flag: [bx + FLAG_X, by + ROW_TOP + rh * row, FLAG_SIZE, FLAG_SIZE],
    textX: bx + TEXT_X,
    baseline: by + BASELINE + rh * row,
  };
}

export function dividerGeometry(layout, firstRow, count) {
  const [bx, by] = layout.box;
  const rh = layout.rowHeight;
  return { x: bx + layout.dividerX, y: by + ROW_TOP + rh * firstRow, h: rh * count };
}

/** The line colour: green for a buddy, else the team's radio colour, grey
 *  for no team (`Game.setAxisRadioColor` and friends; the chat-colour
 *  settings are never read by the log). */
export function lineColor(layout, line) {
  const c = layout.colors || {};
  if (line.buddy) return c.buddy ?? [0, 1, 0];
  if (line.team === 1) return c.axis ?? [1, 0.35, 0.35];
  if (line.team === 2) return c.allies ?? [0.4, 0.6, 1];
  return c.normal ?? [0.7, 0.7, 0.7];
}
