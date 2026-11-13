// `viewer/room-host-client.js` under node: the vote lines in retail's words,
// the yes / no keys, what a join row carries, and CREATE GAME's settings.
import {
  VOTE_STRINGS, closeNotice, createRoomHostClient, joinExtras, roomStore, voteLines, voteQuestion,
} from './room-host-client.js';

const memory = () => { const m = new Map(); return {
  getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: k => m.delete(k) }; };
const results = {};
const ctx = { nameOf: slot => ({ 3: 'Griefer' }[slot] ?? `Player ${slot}`),
              maps: [{ level: 'wake', mode: null }, { level: 'berlin', mode: 'Tdm' }] };

results.lines = {
  kickIssued: voteLines({ kind: 1, action: 0, target: 3, yes: 1, no: 0, required: 4, time: 60 }, ctx),
  kickLaid: voteLines({ kind: 1, action: 3, target: 3, yes: 2, no: 1, required: 4 }, { ...ctx, left: 41.2 }),
  kickFailed: voteLines({ kind: 1, action: 1, target: 3 }, ctx),
  kickPassed: voteLines({ kind: 1, action: 2, target: 3 }, ctx),
  teamPassed: voteLines({ kind: 2, action: 2, target: 3 }, ctx),
  teamIssued: voteLines({ kind: 2, action: 0, target: 3, yes: 1, required: 2, time: 60 }, ctx)[0],
  mapIssued: voteLines({ kind: 0, action: 0, target: 1, yes: 1, required: 2, time: 60 }, ctx),
  mapPassed: voteLines({ kind: 0, action: 2, target: 1 }, ctx),
  mapFailed: voteLines({ kind: 0, action: 1, target: 1 }, ctx),
  // A pack's own words win over the engine's English.
  localised: voteLines({ kind: 1, action: 1, target: 3 }, { strings: { VOTEMSG_KICK_NONCONCLUSIVE: 'Nein' } }),
  question: voteQuestion({ kind: 1, target: 3, yes: 1, required: 4 }, { ...ctx, yesKey: 'F7', noKey: 'F8', left: 9.1 }),
};
results.strings = VOTE_STRINGS;
results.notices = Object.fromEntries(['bad_password', 'reserved_slots', 'kicked', 'banned', 'room_full', 'bad_name']
  .map(code => [code, closeNotice(code)]));

// The store and the join row.
{
  const session = memory(), local = memory();
  const store = roomStore({ session, local, random: () => 0.5 });
  const first = joinExtras(store, 'ROOM1');
  store.setCreate('ROOM1', { gameTime: 15, password: 'pw' });
  const creating = joinExtras(store, 'ROOM1');
  store.setAdminKey('ROOM1', 'abc123');
  const admin = joinExtras(store, 'ROOM1');
  results.join = { first, creating, admin, sameId: first.id === admin.id,
                   other: joinExtras(store, 'ROOM2') };
}

// The live half: a vote from issue to end, the keys, the welcome line.
{
  const printed = [];
  const sent = [];
  let t = 100;
  const session = memory();
  const store = roomStore({ session, local: memory() });
  store.setCreate('R', { gameTime: 5 });
  const host = createRoomHostClient({
    client: () => ({ nameOf: slot => `P${slot}`, vote: (kind, target, option) => sent.push([kind, target, option]) }),
    print: line => printed.push(line), now: () => t,
  });
  host.onHello({ settings: { gameTime: 5 }, maps: [{ level: 'wake', mode: null }], admin: true, adminKey: 'k1',
                 votes: [] }, { store, code: 'R' });
  const noVote = host.castKey(0);
  host.onRow({ type: 'welcome', id: 0, text: 'Welcome' });
  host.onRow({ type: 'vote', kind: 1, action: 0, target: 2, yes: 1, no: 0, required: 2, time: 60 });
  const yes = host.castKey(0);
  const no = host.castKey(1);
  t = 130;
  host.onRow({ type: 'vote', kind: 1, action: 3, target: 2, yes: 1, no: 1, required: 2 });
  const laid = printed.at(-1);
  t = 161;
  const late = host.castKey(0);
  host.onRow({ type: 'vote', kind: 1, action: 1, target: 2, yes: 1, no: 1, required: 1 });
  const after = host.castKey(0);
  host.onRow({ type: 'settings', settings: { gameTime: 20 } });
  results.live = { noVote, yes, no, late, after, sent, printed, laid, admin: host.admin,
                   storedKey: store.adminKey('R'), createSpent: store.create('R'),
                   settings: host.settings, mapLines: host.mapVoteLines(),
                   other: host.onRow({ type: 'killed' }) };
}

console.log(JSON.stringify(results));
