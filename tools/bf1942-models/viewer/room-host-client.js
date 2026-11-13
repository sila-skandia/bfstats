// The page's half of a room's host features (`server/room-host.mjs`): what a
// create or a join sends (CREATE GAME's settings, the password, the admin's
// key, the browser's id), and what the page does with the rows that come
// back: a vote's lines and its yes / no keys, the welcome lines, the live
// settings, and the lines a refused join shows.
//
// Pure where it can be (`voteLines`, `voteQuestion`, the storage keys), so
// `tests/room_host_client_harness.mjs` runs it under node.
//
// Retail's words, from the shipped lexicon (`lexiconAll.dat`): the keys
// below. A pack's `chat-layout.json` carries them once it is re-extracted
// (`extract_radio.py` `CHAT_STRING_KEYS`); until then, and for a mod whose
// lexicon lacks one, the English here is the engine's own.
//
// The client's handling is `GameClient::handleVoteEvent` and
// `menu::Scoreboard::processVoteKickEvent` / `MapVoteInterface::
// processVoteMapEvent` (named in the Mac client's symbols; a lead, the
// server's action codes it switches on are read from lnxded.static,
// `server/room-votes.mjs`): action 0 begins the vote and prints the
// `_PROGRESS` line, 3 updates the counts, 1 prints `_NONCONCLUSIVE`, 2 prints
// `_SUCCESS` with the player's or the map's name; a team kick is shown only
// to the target's side. The retail vote plate on the HUD
// (`Scoreboard/VoteMessageIngame`) is not drawn here: the question and the
// counts go to the message log instead, each time they change.

export const VOTE_STRINGS = Object.freeze({
  VOTEFEEDBACK_KICK: 'Vote to kick #PLAYERNAME# (#PLAYERID#)?',
  VOTEFEEDBACK_MAP: 'Vote for map #MAPNAME#?',
  VOTEFEEDBACK_TEAMKICK: 'Vote to kick #PLAYERNAME# (#PLAYERID#)? (Teamkick)',
  VOTEMSG_KICK_INACTIVE: 'No Kick Vote active',
  VOTEMSG_KICK_NONCONCLUSIVE: 'Kick Vote ended: non-conclusive',
  VOTEMSG_KICK_PROGRESS: 'Kick Vote in progress...',
  VOTEMSG_KICK_SUCCESS: 'Kick Vote ended: kicking player #PLAYERNAME#',
  VOTEMSG_MAP_INACTIVE: 'No Map Vote active',
  VOTEMSG_MAP_NONCONCLUSIVE: 'Map Vote ended: non-conclusive',
  VOTEMSG_MAP_PROGRESS: 'Map Vote in progress...',
  VOTEMSG_MAP_SUCCESS: 'Map Vote ended: changing to map #MAPNAME#',
  VOTEMSG_TEAMKICK_NONCONCLUSIVE: 'Team-Kick Vote ended: non-conclusive',
  VOTEMSG_TEAMKICK_PROGRESS: 'Team-Kick Vote in progress...',
  VOTEMSG_TEAMKICK_SUCCESS: 'Team-Kick Vote ended: kicking player #PLAYERNAME#',
  VOTE_CAST: 'Cast',
  VOTE_NEEDED: 'Needed',
  VOTE_NO: 'No',
  VOTE_TIME_LEFT: 'Time Left',
  VOTE_YES: 'Yes',
  MAPVOTE_HEADING: 'Map Vote',
  PASSWORD_INVALID: 'This server requires password. Please try again!',
  PASSWORD_INVALID_FIRST_ATTEMPT: 'This server requires password.',
  RESERVED_PASSWORD_INVALID: 'This server has reserved slots. Enter Reserved Password!',
  ERROR_KICKED_FROM_SERVER: 'KICKED FROM SERVER',
  ERROR_BANNED_FROM_SERVER: 'BANNED FROM SERVER',
  CONFIRMATION_FAILED_TO_CONNECT_SERVER_FULL: 'FAILED TO CONNECT TO SERVER! SERVER IS FULL!',
});

/** The VoteEvent's type and action (`server/room-votes.mjs`). */
export const VOTE_KIND = Object.freeze({ map: 0, kick: 1, teamKick: 2 });
export const VOTE_ACTION = Object.freeze({ issued: 0, failed: 1, passed: 2, laid: 3 });
const KIND_KEY = ['MAP', 'KICK', 'TEAMKICK'];

const word = (strings, key) => strings?.[key] ?? VOTE_STRINGS[key] ?? key;

/** A map list entry as a vote names it: the level, and its layer when the
 *  entry names one (retail's `"berlin" (TDM, bf1942)`). */
export function mapEntryName(entry) {
  if (!entry) return '?';
  return entry.mode ? `${entry.level} (${entry.mode})` : String(entry.level);
}

/**
 * The question a running vote asks (`VoteFeedback::generateMsg`): the
 * `VOTEFEEDBACK_*` line with its tokens filled, then the count and the keys.
 * The words are the lexicon's; the punctuation between them is this page's
 * (the client's own separators are unread).
 *
 * `ctx`: `strings`, `nameOf(slot)`, `maps` (the room's list), `yesKey` /
 * `noKey` (the bound keys' names), `left` (seconds).
 */
export function voteQuestion(row, ctx = {}) {
  const [text, counts, keys, left] = voteQuestionParts(row, ctx);
  return `${text} ${counts}  ${keys}${left ? `  ${left}` : ''}`;
}

/** The question's four parts, each a line of the vote plate: the
 *  `VOTEFEEDBACK_*` line, the count, the keys, the time left ('' when
 *  `ctx.left` is not given). */
export function voteQuestionParts(row, ctx = {}) {
  const s = ctx.strings;
  const kind = KIND_KEY[row.kind] ?? 'KICK';
  let text = word(s, `VOTEFEEDBACK_${kind}`);
  if (row.kind === VOTE_KIND.map) {
    text = text.replace('#MAPNAME#', mapEntryName(ctx.maps?.[row.target]));
  } else {
    text = text.replace('#PLAYERNAME#', ctx.nameOf?.(row.target) ?? `Player ${row.target}`)
      .replace('#PLAYERID#', String(row.target));
  }
  const parts = [`${row.yes ?? 0} ${word(s, 'VOTE_CAST')}`, `${row.required ?? 0} ${word(s, 'VOTE_NEEDED')}`];
  const keys = `${word(s, 'VOTE_YES')}: ${ctx.yesKey ?? '7'}  ${word(s, 'VOTE_NO')}: ${ctx.noKey ?? '8'}`;
  const left = Number.isFinite(ctx.left) ? `${word(s, 'VOTE_TIME_LEFT')}: ${Math.max(0, Math.ceil(ctx.left))}` : '';
  return [text, `[${parts.join(', ')}]`, keys, left];
}

/** The message-log lines one `vote` row prints. */
export function voteLines(row, ctx = {}) {
  const s = ctx.strings;
  const kind = KIND_KEY[row.kind] ?? 'KICK';
  const named = text => (row.kind === VOTE_KIND.map
    ? text.replace('#MAPNAME#', mapEntryName(ctx.maps?.[row.target]))
    : text.replace('#PLAYERNAME#', ctx.nameOf?.(row.target) ?? `Player ${row.target}`));
  switch (row.action) {
    // With the vote plate drawn (`ctx.plate`) the question and its counts
    // are on it, and only the engine's own lines go to the log.
    case VOTE_ACTION.issued:
      return [word(s, `VOTEMSG_${kind}_PROGRESS`),
              ...(ctx.plate ? [] : [voteQuestion(row, { ...ctx, left: row.time })])];
    case VOTE_ACTION.laid:
      return ctx.plate ? [] : [voteQuestion(row, ctx)];
    case VOTE_ACTION.failed:
      return [word(s, `VOTEMSG_${kind}_NONCONCLUSIVE`)];
    case VOTE_ACTION.passed:
      return [named(word(s, `VOTEMSG_${kind}_SUCCESS`))];
    default:
      return [];
  }
}

/** What a refused join or an ended session shows, by the room's close code:
 *  `{ title, text, password }` (`password` when the answer is to ask for
 *  one), or null for a code this file has no line for. */
export function closeNotice(code, strings = null) {
  switch (code) {
    case 'bad_password':
      return { title: 'PASSWORD', text: word(strings, 'PASSWORD_INVALID_FIRST_ATTEMPT'), password: true };
    case 'reserved_slots':
      return { title: 'PASSWORD', text: word(strings, 'RESERVED_PASSWORD_INVALID'), password: true };
    case 'kicked':
      return { title: word(strings, 'ERROR_KICKED_FROM_SERVER'), text: '', final: true };
    case 'banned':
      return { title: word(strings, 'ERROR_BANNED_FROM_SERVER'), text: '', final: true };
    case 'room_full':
      return { title: 'ROOM', text: word(strings, 'CONFIRMATION_FAILED_TO_CONNECT_SERVER_FULL') };
    default:
      return null;
  }
}

// --- what the browser keeps for a room --------------------------------------------

const CREATE_KEY = code => `bf42-room-create:${code}`;
const PASSWORD_KEY = code => `bf42-room-password:${code}`;
const ADMIN_KEY = code => `bf42-room-admin:${code}`;
const CLIENT_ID_KEY = 'bf42-room-client-id';

const read = (store, key) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
const write = (store, key, value) => {
  try { if (value == null) store?.removeItem(key); else store?.setItem(key, value); } catch { /* private mode */ }
};

/**
 * The per-room values a join row carries, kept in the tab's session storage
 * (the settings a CREATE GAME screen just set, the password typed for the
 * room, the admin's key) and the browser's local storage (its own id).
 * Nothing here rides in a URL.
 */
export function roomStore({ session = globalThis.sessionStorage, local = globalThis.localStorage,
                            random = () => Math.random() } = {}) {
  return {
    /** CREATE GAME's settings for a room about to be made. */
    setCreate(code, settings) { write(session, CREATE_KEY(code), settings ? JSON.stringify(settings) : null); },
    create(code) {
      const raw = read(session, CREATE_KEY(code));
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    setPassword(code, password) { write(session, PASSWORD_KEY(code), password || null); },
    password(code) { return read(session, PASSWORD_KEY(code)); },
    setAdminKey(code, key) { write(session, ADMIN_KEY(code), key || null); },
    adminKey(code) { return read(session, ADMIN_KEY(code)); },
    /** This browser's id: what a room's ban is kept by, beside the name. */
    clientId() {
      let id = read(local, CLIENT_ID_KEY);
      if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
        id = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
        write(local, CLIENT_ID_KEY, id);
      }
      return id;
    },
  };
}

/** The join row's host half for `code` (`netcode-client.js` `join`). */
export function joinExtras(store, code) {
  const out = { id: store.clientId() };
  const settings = store.create(code);
  if (settings) {
    out.settings = settings;
    // The creator's own password lets a reload back in.
    if (settings.password && !store.password(code)) store.setPassword(code, settings.password);
  }
  const password = store.password(code);
  if (password) out.password = password;
  const admin = store.adminKey(code);
  if (admin) out.admin = admin;
  return out;
}

/**
 * The live half, one per joined room.
 *
 * @param {object} ctx
 * @param {() => object|null} ctx.client   the room client (`netcode-client.js`)
 * @param {(text: string) => void} ctx.print  a line in the message log
 * @param {() => object|null} [ctx.strings]  the pack's lexicon strings
 * @param {() => number} [ctx.now]  seconds
 * @param {() => {yes: string, no: string}} [ctx.keys]  the bound vote keys
 */
export function createRoomHostClient(ctx) {
  const now = ctx.now ?? (() => Date.now() / 1000);
  /** kind -> the running vote's last row, with `endsAt`. */
  const running = new Map();
  let settings = null;
  let maps = [];
  let admin = false;
  /** The kind the yes / no keys answer: the vote that spoke last. */
  let lastKind = null;

  const lineCtx = extra => ({
    strings: ctx.strings?.() ?? null,
    nameOf: slot => ctx.client()?.nameOf?.(slot) ?? `Player ${slot}`,
    maps,
    yesKey: ctx.keys?.()?.yes, noKey: ctx.keys?.()?.no,
    plate: !!ctx.plate?.(),
    ...extra,
  });
  let voteSettings = null;

  function takeVote(row, { quiet = false } = {}) {
    const ended = row.action === VOTE_ACTION.failed || row.action === VOTE_ACTION.passed;
    const before = running.get(row.kind);
    if (ended) {
      running.delete(row.kind);
      if (lastKind === row.kind) lastKind = running.size ? [...running.keys()].at(-1) : null;
    } else {
      const endsAt = row.action === VOTE_ACTION.issued || !before
        ? now() + (Number(row.time) || 0) : before.endsAt;
      running.set(row.kind, { ...row, endsAt });
      lastKind = row.kind;
    }
    if (quiet) return;
    const left = ended ? null : running.get(row.kind).endsAt - now();
    for (const line of voteLines(row, lineCtx({ left }))) ctx.print(line);
  }

  return {
    /** The HELLO: the settings, the map list, the admin flag and its key,
     *  any vote already running. */
    onHello(hello, { store = null, code = null } = {}) {
      settings = hello?.settings ?? null;
      maps = Array.isArray(hello?.maps) ? hello.maps : [];
      admin = !!hello?.admin;
      voteSettings = hello?.voteSettings ?? null;
      running.clear();
      lastKind = null;
      for (const row of hello?.votes ?? []) takeVote(row, { quiet: false });
      if (store && code) {
        if (hello?.adminKey) store.setAdminKey(code, hello.adminKey);
        // The settings made the room (or it was there already): spent.
        store.setCreate(code, null);
      }
    },

    /** One event row; true when it was the host's. */
    onRow(row) {
      if (!row) return false;
      if (row.type === 'vote') { takeVote(row); return true; }
      if (row.type === 'welcome') {
        if (typeof row.text === 'string' && row.text) ctx.print(row.text);
        return true;
      }
      if (row.type === 'settings') { settings = row.settings ?? settings; return true; }
      return false;
    },

    /** The yes (0) or no (1) key: laid on the vote that spoke last. False
     *  when none is running. */
    castKey(option) {
      const vote = lastKind != null ? running.get(lastKind) : null;
      if (!vote || now() >= vote.endsAt) return false;
      ctx.client()?.vote?.(vote.kind, vote.target, option === 1 ? 1 : 0);
      return true;
    },

    /** Issue (or join) a vote. */
    vote(kind, target) { ctx.client()?.vote?.(kind, target, 0); },

    /** The map list as SHOW MAP VOTE prints it: one line a level, its id
     *  first (`game.listMaps`' own shape, CON-24), under the heading. */
    mapVoteLines() {
      const s = ctx.strings?.() ?? null;
      const vote = running.get(VOTE_KIND.map);
      const head = vote ? word(s, 'VOTEMSG_MAP_PROGRESS') : word(s, 'VOTEMSG_MAP_INACTIVE');
      return [`${word(s, 'MAPVOTE_HEADING')}: ${head}`,
              ...maps.map((entry, id) => `${id}: ${mapEntryName(entry)}`)];
    },

    get settings() { return settings; },
    get maps() { return maps; },
    get admin() { return admin; },
    running: kind => running.get(kind) ?? null,
    /** Whether this page is in a room of its own server (not a relay). */
    get live() { return !!ctx.client(); },
    /** Whether the room takes a vote of `kind` (`admin.enable*Vote`). */
    enabled: kind => voteSettings?.enabled?.[kind] !== false,
    /** The vote the plate shows and the keys answer: the one that spoke
     *  last and is still inside its time, as `{ row, lines, text }` (the
     *  plate's lines; `text` the status line a board shows), or null. */
    current() {
      const vote = lastKind != null ? running.get(lastKind) : null;
      if (!vote || now() >= vote.endsAt) return null;
      const lines = voteQuestionParts(vote, lineCtx({ left: vote.endsAt - now(), plate: false })).filter(Boolean);
      return { row: vote, lines };
    },
    /** The line a board shows for votes of `kind` (0 the map vote's, 1 the
     *  kick votes'): the running one's question, else `VOTEMSG_*_INACTIVE`. */
    statusLine(kind) {
      const s = ctx.strings?.() ?? null;
      const vote = kind === 0 ? running.get(0) : (running.get(1) ?? running.get(2));
      if (!vote || now() >= vote.endsAt) return word(s, kind === 0 ? 'VOTEMSG_MAP_INACTIVE' : 'VOTEMSG_KICK_INACTIVE');
      return voteQuestionParts(vote, lineCtx({}))[0];
    },
  };
}
