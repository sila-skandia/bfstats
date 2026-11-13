// Typed chat, the message log's player lines, the warning plate, the board's
// numbers on the client and the typed words about players, under node. One
// run, one JSON blob for `tests/test_room_chat.py`. No DOM and no three.

import {
  SayQueue, cutSayText, SAY_LINE_BYTES, SAY_WAITING_MAX, SAY_WAITING_MAX_SERVER, SAY_PIECE_BYTES,
  SAY_PIECE_SECONDS, SAY_CHOKE_SECONDS, vehicleLine, joinLine, CrewWatch, IgnoreList,
  warningPlate, CONNECTION_PROBLEM_TICKS, DISCONNECT_TICKS, playerChatLine,
} from './chat-log.js';
import { createRoomClient } from './netcode-client.js';
import { MSG_HELLO, MSG_EVENT, MSG_PING, MSG_PONG, MSG_ACTION } from './netcode.js';
import { GameConsole } from './console.js';
import { registerViewerCommands } from './console-commands.js';
import { ALIASED_COMMANDS, runConText } from './console-aliases.js';

const results = {};

// --- the constants -----------------------------------------------------------
results.constants = {
  SAY_LINE_BYTES, SAY_WAITING_MAX, SAY_WAITING_MAX_SERVER, SAY_PIECE_BYTES, SAY_PIECE_SECONDS,
  SAY_CHOKE_SECONDS, CONNECTION_PROBLEM_TICKS, DISCONNECT_TICKS,
};

// --- the lines ---------------------------------------------------------------
const strings = { ENTERED_YOUR_VEHICLE: 'entered your vehicle', LEFT_YOUR_VEHICLE: 'left your vehicle',
                  JOINED_THE: 'joined the', AXIS_TEAM: 'axis team', ALLIED_TEAM: 'allied team' };
results.lines = {
  entered: vehicleLine('Bot A', true, strings),
  left: vehicleLine('Bot A', false, strings),
  enteredDefault: vehicleLine('Bot A', true, null),
  leftDefault: vehicleLine('Bot A', false, null),
  axis: joinLine('skandia', 1, strings),
  allied: joinLine('skandia', 2, null),
  none: joinLine('skandia', 0, strings),
  german: joinLine('skandia', 1, { JOINED_THE: 'tritt bei:', AXIS_TEAM: 'Achsenteam' }),
  chat: playerChatLine('skandia', 'hi'),
  teamChat: playerChatLine('skandia', 'hi', { teamOnly: true, team: 1 }),
};

// --- the cut ------------------------------------------------------------------
results.cut = {
  ascii: cutSayText('x'.repeat(80)).length,
  short: cutSayText('hello'),
  // Two bytes a character: 31 fit in 63, never half of one.
  wide: [...cutSayText('é'.repeat(40))].length,
};

// --- the sender's queue (CHAT-2) ---------------------------------------------
{
  const q = new SayQueue();
  const sent = [];
  let t = 100;
  const run = (seconds, step = 1 / 30) => {
    for (let i = 0; i < Math.round(seconds / step); i++) {
      t += step;
      const line = q.update(t);
      if (line) sent.push({ text: line.text, at: +(t - 100).toFixed(2) });
    }
  };
  // A short line to an idle sender leaves on the first update.
  q.add({ text: 'hello', team: false }, t);
  run(1 / 30);
  const first = sent.slice();
  // 63 bytes: five pieces, 2 s after the first of them.
  sent.length = 0;
  run(1);
  const start = t;
  q.add({ text: 'y'.repeat(80), team: true }, t);
  run(4);
  const long = sent.map(s => ({ bytes: s.text.length, after: +(s.at - (start - 100)).toFixed(2) }));
  // Five at once: the fifth is refused and the choke shows for ten seconds.
  sent.length = 0;
  run(1);
  const taken = [];
  for (let i = 0; i < 5; i++) taken.push(q.add({ text: `l${i}`, team: false }, t));
  const chokeAt = t;
  const chokeNow = q.showChoke(t);
  run(9.5);
  const chokeAt95 = q.showChoke(t);
  run(1);
  const chokeAt105 = q.showChoke(t);
  results.queue = {
    first, long, taken, sent: sent.map(s => s.text),
    gaps: sent.slice(1).map((s, i) => +(s.at - sent[i].at).toFixed(2)),
    chokeNow, chokeAt95, chokeAt105, chokeCleared: !q.choked, waited: +(t - chokeAt).toFixed(1),
  };
  const server = new SayQueue({ limit: SAY_WAITING_MAX_SERVER });
  results.queue.serverTakes = Array.from({ length: 17 }, (_, i) => server.add({ text: `s${i}` }, 0)).filter(Boolean).length;
}

// --- the crew watch ------------------------------------------------------------
{
  const w = new CrewWatch();
  const steps = [];
  const see = (hull, ids) => { const r = w.observe(hull, ids); steps.push([r.entered, r.left]); };
  see('tank', ['bot:1']);          // the local player gets in beside a bot: nothing
  see('tank', ['bot:1', 'bot:2']); // a second bot boards
  see('tank', ['bot:2']);          // the first leaves
  see(null, []);                   // the local player gets out: nothing
  see('tank', ['bot:3']);          // back in, another crew: nothing
  see('jeep', ['bot:3']);          // another hull: nothing
  results.crew = steps;
}

// --- the warning plate -----------------------------------------------------------
results.plate = {
  quiet: warningPlate(0, false),
  at45: warningPlate(45, false).show,
  at46: warningPlate(46, false),
  flood: warningPlate(10, true),
  problemOverFlood: warningPlate(60, true).text,
  at450: warningPlate(450, false).disconnected,
  at451: warningPlate(451, false),
  german: warningPlate(46, false, { GAME_MESSAGE_CONNECTION_PROBLEM: 'Warnung!' }).text,
};

// --- the ignore list ---------------------------------------------------------------
{
  const list = new IgnoreList();
  const out = [];
  out.push(list.add(7, null));
  out.push(list.add(3, 'slot3'));
  out.push(list.add(3, 'slot3'));
  out.push(list.has('slot3'));
  list.add(4, 'slot4');
  out.push(list.lines([{ key: 'slot3', id: 3, name: 'Mate' }]));   // slot4 has left
  out.push(list.has('slot4'));
  list.remove('slot3');
  out.push(list.has('slot3'));
  results.ignore = out;
}

// --- the room client -----------------------------------------------------------------
{
  let clock = 1000;
  const ws = { sent: [], send(b) { this.sent.push(b); }, close() {} };
  const client = createRoomClient({ ws, now: () => clock });
  const text = s => new TextEncoder().encode(JSON.stringify(s));
  const frame = (type, payload) => new Uint8Array([type, ...payload]);
  client.join({ room: 'abc', name: 'Me', team: 0 });
  client.handleMessage(frame(MSG_HELLO, text({
    slot: 2, room: 'abc', level: 'wake', team: 2, name: 'Me',
    slots: [{ slot: 1, name: 'A', team: 1, score: 12, kills: 5, deaths: 2, ping: 40 }],
    stats: { score: 0, kills: 0, deaths: 0, ping: 0 }, vehicles: [], flags: [],
  })));
  const atJoin = { a: client.statsOf(1), me: client.statsOf(2), nobody: client.statsOf(9) };
  const event = row => client.handleMessage(frame(MSG_EVENT, text(row)));
  event({ t: 1, type: 'stats', rows: [[1, 14, 6, 2, 38], [2, 2, 1, 0, 55]] });
  event({ t: 2, type: 'join', slot: 3, text: 'Late', team: 1 });
  event({ t: 3, type: 'name', slot: 1, text: 'Renamed' });
  const after = { a: client.statsOf(1), me: client.statsOf(2), late: client.statsOf(3),
                  lateTeam: client.teamOf(3), aName: client.nameOf(1) };
  event({ t: 3, type: 'chat', slot: 1, text: 'hello', team: false });
  event({ t: 4, type: 'leave', slot: 1, text: 'Renamed' });
  // The pong goes straight back with its own four bytes behind the client's.
  ws.sent.length = 0;
  client.handleMessage(frame(MSG_PONG, [0x10, 0x27, 0, 0]));
  const echo = Array.from(ws.sent[0]);
  ws.sent.length = 0;
  client.chat('hello there', true);
  const action = JSON.parse(new TextDecoder().decode(ws.sent[0].subarray(1)));
  results.client = {
    atJoin, after, gone: client.statsOf(1), echo: { type: echo[0] === MSG_PING, bytes: echo.length, tail: echo.slice(5) },
    chat: { type: ws.sent[0][0] === MSG_ACTION, row: action },
    feedText: client.feed.filter(r => ['stats', 'name', 'chat'].includes(r.type)).map(r => [r.type, r.text]),
  };
  // A server before the `stats` rows: the board falls back to its own tally.
  const ws2 = { sent: [], send(b) { this.sent.push(b); }, close() {} };
  const old = createRoomClient({ ws: ws2, now: () => clock });
  old.join({ room: 'abc', name: 'Me', team: 0 });
  old.handleMessage(frame(MSG_HELLO, text({ slot: 2, team: 2, name: 'Me', slots: [{ slot: 1, name: 'A', team: 1 }] })));
  results.client.oldServer = old.statsOf(1);
}

// --- the typed words --------------------------------------------------------------------
{
  const players = [
    { slot: 1, serverId: 1, name: 'Me', local: true },
    { slot: 2, serverId: 2, name: 'Mate' },
    { slot: 5, serverId: 5, name: 'Rival' },
  ];
  const social = { ignored: new IgnoreList(), buddies: new Set(), radioMute: { text: false, audio: false } };
  const calls = [];
  const con = new GameConsole();
  registerViewerCommands(con, {
    players: () => players, social: () => social,
    suicide: () => () => calls.push('suicide'),
    sayAll: () => text => calls.push(`say:${text}`),
    rename: () => name => { calls.push(`name:${name}`); return true; },
  });
  runConText(con, ALIASED_COMMANDS);
  const type = line => {
    const before = con.scrollback.length;
    con.setLine(line);
    con.asciiKey(0x0d);
    return con.scrollback.slice(before + 1).map(l => (typeof l === 'string' ? l : l.text ?? String(l)));
  };
  const out = {};
  out.suicide = type('suicide');
  out.say = type('say "hello all"');
  out.sayBare = type('game.sayAll hello');
  out.name = type('name Other');
  out.ignore = type('ignore 5');
  out.ignoreAgain = type('ignore 5');
  out.ignoreNobody = type('ignore 9');
  out.ignoreSelf = type('ignore 1');
  out.ignorelist = type('ignorelist');
  out.ignored = [...social.ignored.keys];
  out.unignore = type('unignore 5');
  out.ignoredAfter = [...social.ignored.keys];
  out.radioText = [type('chat.ignoreRadioText 1'), social.radioMute.text, type('chat.ignoreRadioText')];
  out.radioAudio = [type('chat.ignoreRadioAudio 1'), social.radioMute.audio];
  out.both = [type('chat.setIgnoreRadioAudioAndText 0'), { ...social.radioMute }, type('chat.getIgnoreRadioAudioAndText')];
  out.buddy = type('buddy 2');
  out.buddyByName = type('game.addPlayerToBuddyListByName Rival');
  out.buddyNobody = type('game.addPlayerToBuddyListByName Ghost');
  out.buddylist = type('buddylist');
  out.unbuddy = type('unbuddy 2');
  out.buddies = [...social.buddies];
  out.calls = calls;
  // Off the play page (a replay) the words about the local player are not active.
  const bare = new GameConsole();
  registerViewerCommands(bare, {});
  runConText(bare, ALIASED_COMMANDS);
  const typeBare = line => { const b = bare.scrollback.length; bare.setLine(line); bare.asciiKey(0x0d);
    return bare.scrollback.slice(b + 1).map(l => (typeof l === 'string' ? l : l.text ?? String(l))); };
  out.inactive = typeBare('suicide');
  results.words = out;
}

console.log(JSON.stringify(results));
