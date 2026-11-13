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

/** The bracketed word of a kill line: the lexicon string for the template the
 *  server stamped on the kill (`stamp`), else the lexicon's
 *  `DEFAULT_KILL_TEXT`. The client (`FUN_004933d0` case 3, 0x00494342) starts
 *  from the key `"DEFAULT_KILL_TEXT"`, replaces it with the stamped template's
 *  name when the template manager resolves the id (`DAT_0097d768` vt+0x1c,
 *  the name vt+0x14), and localises whichever key it holds through
 *  `Locale::getWide` 0x005815b0 -- which, on a key no lexicon has, widens the
 *  key itself (0x00581470). So `Sg44` prints `[StG 44]`, `K98` `[K 98]`, and a
 *  `K98Sniper`, which no vanilla lexicon names, prints `[K98Sniper]`. */
export function killWord(stamp, strings, names) {
  if (stamp) return names?.[stamp] ?? stamp;
  return strings?.DEFAULT_KILL_TEXT ?? 'killed';
}

/** The template a kill is stamped with, `null` for none. A seated killer's is
 *  his root vehicle's (`FireArms::fireBarrel`: `[Tiger]`), whatever the round
 *  did. On foot it is the hand weapon that fired the killing round
 *  (`[Thompson]`); a death by an explosion's area damage or under a vehicle
 *  carries none and prints `[killed]` (the owner's reading of retail play,
 *  2026-09-24: on-foot kills always name the weapon, `[killed]` is a man run
 *  over or caught by splash). `how` is `{ weapon, splash, roadkill, stamped }`
 *  from the damage that killed him; `stamped` marks a live path that names its
 *  own weapon (explosions included). `killer.weapon`, the weapon he holds now,
 *  stands in only when the damage path did not say which (a replay's kill). */
export function killStamp(killer, how = null) {
  if (how?.roadkill) return null;
  if (killer?.vehicle) return killer.vehicle;
  // A live damage path states its stamp itself, `null` included (the round
  // had no weapon template, or the call passed -1): the retail server hands
  // `handleScore` the lethal call's stat id, the projectile's `+0x140`,
  // whatever the killer holds by then, and an explosion's queued damage
  // carries it too (ledger KILLSTAMP-1).
  if (how?.stamped) return how.weapon ?? null;
  if (how?.splash) return null;
  return how?.weapon ?? killer?.weapon ?? null;
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

/**
 * The kill-section lines one death writes, and the text the victim sees in
 * the centre of his screen: `[{ text, team, who }]` plus `centre`, `who`
 * being `'killer'` or `'victim'` (whose buddy colour the line takes).
 * `victim` and `killer` are `{ id, name, team, vehicle, weapon }`, `killer`
 * null for a death nobody caused; `how` is the killing damage's
 * `{ weapon, splash, roadkill }` (`killStamp`), `inferred` when a replay
 * guessed the weapon.
 *
 * A death is the same event whatever killed him: a soldier shot on foot and a
 * crewman who dies with his hull both come off the server as score event 3
 * against the killer (`GameServer::_giveDamage`, lnxded 0x0814c122 for a
 * hull's crew), which the client prints `killer [word] victim`
 * (0x00494342..0x00494419: the wide `" ["` at 0x008d89a4 and `"] "` at
 * 0x008d96b0 around the lexicon word). A team kill is 6 then 4, both team 0;
 * no killer, or his own hand, is 4, `is no more`.
 *
 * `how.teamKill`, when it is a boolean, is the server's own verdict (a
 * recorded score event's 3 or 6, replay-feed.js) and wins over the sides:
 * a player killed as he switched sides is still an enemy kill.
 */
export function deathLines(victim, killer, strings, names, how = null) {
  if (killer && killer.id !== victim.id) {
    const teamKill = typeof how?.teamKill === 'boolean'
      ? how.teamKill : Boolean(killer.team && killer.team === victim.team);
    if (teamKill) {
      // The victim's centre text is his own `is no more`, not the team-kill
      // line: case 6 hands the TEAM_KILL line to the centre for the victim
      // (`[esi+0x11]`, 0x004942cd..0x00494303), and the 4 that follows on the
      // same `_giveDamage` call (killPlayer(victim, false), lnxded 0x0814c142)
      // hands it the DEATH line, which `0x006a88e0` writes over the first
      // (`operator=` into BfMenu+0x568).
      const tk = teamKillLine(killer.name, strings);
      const death = deathLine(victim.name, strings);
      return {
        lines: [{ text: tk, team: 0, who: 'killer' },
                { text: death, team: 0, who: 'victim' }],
        centre: death,
      };
    }
    // A replay's guess at a weapon the kill named none for (`how.inferred`,
    // replay-feed.js) is marked: `[BF 109?]`.
    const stamp = killStamp(killer, how);
    const guessed = Boolean(how?.inferred) && stamp !== null && stamp === how.weapon;
    const text = killLine(killer.name, victim.name, `${killWord(stamp, strings, names)}${guessed ? '?' : ''}`);
    return { lines: [{ text, team: killer.team, who: 'killer' }], centre: text };
  }
  const text = deathLine(victim.name, strings);
  return { lines: [{ text, team: 0, who: 'victim' }], centre: text };
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

/** Someone else got into, or out of, the hull the local player sits in
 *  (`GameClient::handleGameEventManagerEvent` cases 7 and 8, BF1942.exe
 *  0x00493b59 and 0x00493ca7): the player's name, the wide `" "` at
 *  0x008d636c and the lexicon's `ENTERED_YOUR_VEHICLE` (0x008d9704) or
 *  `LEFT_YOUR_VEHICLE` (0x008d96f0), a game-information line of team 0 (the
 *  `push ebx`, zero, at 0x00493c39). Never for the local player's own move,
 *  and only while the vehicle ids match (`[+0x48]`, 0x00493b8f / 0x00493cfe). */
export function vehicleLine(name, entered, strings) {
  const word = entered ? (strings?.ENTERED_YOUR_VEHICLE ?? 'entered your vehicle')
    : (strings?.LEFT_YOUR_VEHICLE ?? 'left your vehicle');
  return `${name} ${word}`;
}

/** A player took a side (client event 0x36, BF1942.exe 0x00493fa4, and the
 *  listen server's own `GameServer::setTeam`, 0x00487ec8): the name, `" "`,
 *  `JOINED_THE` (0x008d8940), `" "` and `AXIS_TEAM` (0x008d8928) or
 *  `ALLIED_TEAM` (0x008d8934), a game-information line in that side's colour
 *  under its flag (the player's `+0xac` pushed at 0x00494138). A side that is
 *  neither prints nothing (both compares fail, 0x00494090 / 0x004940e2). */
export function joinLine(name, team, strings) {
  if (team !== 1 && team !== 2) return null;
  const side = team === 1 ? (strings?.AXIS_TEAM ?? 'axis team') : (strings?.ALLIED_TEAM ?? 'allied team');
  return `${name} ${strings?.JOINED_THE ?? 'joined the'} ${side}`;
}

/**
 * Who else sits in the local player's hull, frame to frame: the page's stand-in
 * for the enter and exit events `vehicleLine` prints from. `observe(hull, ids)`
 * takes the hull (any identity, null when the local player is in none) and the
 * ids of everyone else aboard, and returns who entered and who left since the
 * last call. A new hull is the local player's own move: it sets the baseline
 * and reports nobody, as the client prints nothing for those already aboard.
 */
const NO_CREW_CHANGE = Object.freeze({ entered: Object.freeze([]), left: Object.freeze([]) });

export class CrewWatch {
  constructor() {
    this.hull = null;
    this.aboard = new Set();
  }

  observe(hull, ids = []) {
    // Out of every hull, as on the frame before: nothing to do, nothing made.
    if (hull == null && this.hull == null) return NO_CREW_CHANGE;
    const now = new Set(hull == null ? [] : ids);
    const out = { entered: [], left: [] };
    if (hull != null && hull === this.hull) {
      for (const id of now) if (!this.aboard.has(id)) out.entered.push(id);
      for (const id of this.aboard) if (!now.has(id)) out.left.push(id);
    }
    this.hull = hull ?? null;
    this.aboard = now;
    return out;
  }
}

// --- the typed line on the wire (CHAT-2) --------------------------------------

/** `StringManager::addStringMsg` (lnxded 0x0815d280) cuts a line to 63 bytes
 *  (`mov eax, 0x3f`, 0x0815d30a). */
export const SAY_LINE_BYTES = 63;
/** The lines one sender may have waiting: 4 for a player's (`0x086c0d28`), 16
 *  for the server's own (`0x086c0d2c`); a line past that is refused. */
export const SAY_WAITING_MAX = 4;
export const SAY_WAITING_MAX_SERVER = 16;
/** `StringManager::updateSendStream` (0x0815d3c0): one piece of at most 15
 *  bytes (`0xf`, 0x0815d425) once 0.5 s (the double at 0x086be450) have
 *  passed since the last piece. */
export const SAY_PIECE_BYTES = 15;
export const SAY_PIECE_SECONDS = 0.5;
/** A refused line raises the choke flag (client `StringManager+0x70`, its
 *  time at `+0x78`), and `shouldDisplayChokeMessage` (BF1942.exe 0x004b4910)
 *  answers true until 10.0 s (the double at 0x008dc0b8) have passed. */
export const SAY_CHOKE_SECONDS = 10;

const utf8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const byteLength = text => (utf8 ? utf8.encode(text).length : text.length);

/** A line cut to `SAY_LINE_BYTES` bytes, never through the middle of a
 *  character (the engine's lines are one byte a character; the page's are
 *  UTF-8). */
export function cutSayText(text, max = SAY_LINE_BYTES) {
  let out = '';
  let used = 0;
  for (const ch of String(text ?? '')) {
    const n = byteLength(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * One sender's waiting lines (`StringManager`, CHAT-2): `add` queues a line
 * unless `limit` already wait, `update(now)` sends the head line's next piece
 * when 0.5 s have passed since the last one and returns the line once its
 * last piece has gone (a whole line is what the page's wire carries, so that
 * is when it leaves). `now` is seconds on any steady clock.
 */
export class SayQueue {
  constructor({ limit = SAY_WAITING_MAX } = {}) {
    this.limit = limit;
    this.lines = [];
    /** The engine's `-100.0` (StringManager ctor, the double at `+0x60`). */
    this.lastPiece = -100;
    this.choked = false;
    this.chokedAt = -100;
  }

  /** `addStringMsg`: false, and the choke flag, when `limit` lines wait. */
  add(line, now) {
    if (this.lines.length >= this.limit) {
      this.choked = true;
      this.chokedAt = now;
      return false;
    }
    const text = cutSayText(line.text);
    this.lines.push({ ...line, text, total: byteLength(text), sent: 0 });
    return true;
  }

  /** `updateSendStream`: at most one piece a call. Returns the finished
   *  line, else null. */
  update(now) {
    const head = this.lines[0];
    if (!head) return null;
    if (now - this.lastPiece < SAY_PIECE_SECONDS) return null;
    this.lastPiece = now;
    head.sent += Math.min(head.total - head.sent, SAY_PIECE_BYTES);
    if (head.sent < head.total) return null;
    this.lines.shift();
    return head;
  }

  /** `shouldDisplayChokeMessage`: true for `SAY_CHOKE_SECONDS` after a
   *  refused line, then the flag clears. */
  showChoke(now) {
    if (!this.choked) return false;
    if (now - this.chokedAt < SAY_CHOKE_SECONDS) return true;
    this.choked = false;
    this.chokedAt = -100;
    return false;
  }
}

// --- the warning plate (`DisconnectMessage`) -----------------------------------

/** `GameClient::update` (BF1942.exe 0x00495f02..0x00496075) reads the local
 *  player's `ActionBuffer::size`, the input ticks the server has not answered:
 *  above 45 (`cmp eax, 0x2d`, 0x00495f1b) the plate shows
 *  `GAME_MESSAGE_CONNECTION_PROBLEM`; above 450 (`0x1c2`, 0x00495fef) the
 *  client disconnects, writes `DISCONNECTED_FROM_SERVER` to the message log
 *  and shows `GAME_MESSAGE_DISCONNECTED`. At 45 or under the plate is the
 *  chat flood warning while `shouldDisplayChokeMessage` says so, else clear. */
export const CONNECTION_PROBLEM_TICKS = 45;
export const DISCONNECT_TICKS = 450;

const PLATE_ENGLISH = {
  GAME_MESSAGE_CONNECTION_PROBLEM: 'Warning! Connection problems detected!',
  GAME_MESSAGE_DISCONNECTED: 'Warning! Disconnected from server!',
  DISCONNECTED_FROM_SERVER: 'Disconnected from server',
  CHAT_FLOOD_ERROR: 'Warning: Sending messages too fast, discarding',
};
/** A lexicon string of the plate's, English where `strings` lacks the key. */
export const plateString = (key, strings) => strings?.[key] ?? PLATE_ENGLISH[key] ?? key;

/** The plate for this frame: `{ show, text, disconnected }`. `ticks` is how
 *  many 30 Hz ticks the server has left unanswered, `choke` whether the chat
 *  flood warning is up. */
export function warningPlate(ticks, choke, strings = null) {
  if (ticks > DISCONNECT_TICKS) {
    return { show: true, disconnected: true, text: plateString('GAME_MESSAGE_DISCONNECTED', strings) };
  }
  if (ticks > CONNECTION_PROBLEM_TICKS) {
    return { show: true, disconnected: false, text: plateString('GAME_MESSAGE_CONNECTION_PROBLEM', strings) };
  }
  if (choke) return { show: true, disconnected: false, text: plateString('CHAT_FLOOD_ERROR', strings) };
  return { show: false, disconnected: false, text: '' };
}

// --- the ignore list (`chat.addToIgnoreList`) ----------------------------------

/**
 * The players whose chat and radio the local player has muted, by the id the
 * server knows each by (`BfMenu`'s list, tested by `isInIgnoreList`
 * 0x006a8db0 before a chat line or a radio message is written). The console
 * words answer with the client's own strings.
 */
export class IgnoreList {
  constructor() { this.keys = new Set(); }

  /** `key` is the page's own handle on a player (a room slot, a bot's player
   *  id), which is what a line's sender carries. */
  has(key) { return key != null && this.keys.has(key); }

  /** `chat.addToIgnoreList <id>`: the error line, else ''. `key` is null
   *  when no player holds the typed `id`. */
  add(id, key) {
    if (key != null && this.keys.has(key)) return 'Error: Player is already ignored!';
    if (key == null) return `Error: Could not locate player: ${id}`;
    this.keys.add(key);
    return '';
  }

  /** `chat.removeFromIgnoreList <id>`: silent either way. */
  remove(key) { this.keys.delete(key); }

  /** `chat.ignoreList`: `id: %d name: %s` a line for each ignored player in
   *  `players` (`[{ key, id, name }]`, everyone the server has); one who has
   *  left is dropped from the list as the walk meets them. */
  lines(players) {
    const here = new Map(players.map(p => [p.key, p]));
    const out = [];
    for (const key of [...this.keys]) {
      const p = here.get(key);
      if (!p) { this.keys.delete(key); continue; }
      out.push(`id: ${p.id} name: ${p.name}`);
    }
    return out.join('\n');
  }
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
