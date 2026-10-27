// Drives `viewer/announcer.js`'s heartbeat (Heartbeats.ssc, ledger RADIO-14)
// headless for tests/test_heartbeat.py; prints one JSON object.
import {
  GameplayAnnouncer, heartbeatLevel, heartbeatUrls, GPM_CONQUEST, GPM_OBJECTIVE, AUTO_LOSE_TICKETS,
} from './announcer.js';

const out = {};
const level = (tickets, start, mode = GPM_CONQUEST) => heartbeatLevel({ mode, tickets, start });

// The local side's count against a start of 100, 200 and 300, down to none.
out.of100 = Array.from({ length: 22 }, (_, i) => level(21 - i, 100));
out.of200 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(t => level(t, 200));
out.of300 = [15, 14, 13, 12, 9, 6, 3, 2, 1].map(t => level(t, 300));
out.negative = level(-3, 100);
out.noStart = [level(2, 0), level(0, 0), level(2, undefined)];
out.objective = [12, 11, 10, 9, 5, 1, 0].map(t => level(t, 300, GPM_OBJECTIVE));

// A round: the side bleeds into the band, the round ends, a new one starts.
const a = new GameplayAnnouncer();
const frame = (tickets, extra = {}) => {
  a.frame({ mode: GPM_CONQUEST, team: 1, playing: true, held: { 1: 0, 2: 0 },
    tickets: { 1: tickets, 2: 50 }, start: { 1: 100, 2: 100 }, ...extra });
  return a.heartbeat;
};
out.round = [6, 5, 4, 3, 2, 1].map(t => frame(t));
out.roundOver = frame(1, { playing: false });
out.noSideHolds = (() => { frame(2); return frame(2, { team: 0 }); })();
out.backAbove = frame(7);
out.otherSideLow = frame(50, { tickets: { 1: 50, 2: 1 } });
out.reset = (() => { frame(1); a.reset(); return a.heartbeat; })();

// At no tickets the stop branch clears the heavy-casualties latch, so the
// line can play again on the next frame the flag is on.
const b = new GameplayAnnouncer();
const heavy = tickets => b.frame({ mode: GPM_CONQUEST, team: 1, playing: true,
  held: { 1: 0, 2: 100 }, tickets: { 1: tickets, 2: 50 }, start: { 1: 100, 2: 100 } });
out.heavyLatch = [heavy(3), heavy(2), heavy(0), heavy(0)]
  .map(f => f.includes(AUTO_LOSE_TICKETS));

// Where the loop is fetched from, per tree and manifest.
const script = { stem: 'heartbeatloop', pitch: [0, 1, 0, 1], volume: [0, 1, 0, 1] };
out.urls = {
  vanilla: heartbeatUrls('maps/_shared', { heartbeat: script }),
  modOwn: heartbeatUrls('maps/mods/fhsw/_shared', { heartbeat: script }),
  modStale: heartbeatUrls('maps/mods/fhsweurope/_shared', { radio: [], gameplay: [] }),
  modNoManifest: heartbeatUrls('maps/mods/eod/_shared', null),
  modUnresolved: heartbeatUrls('maps/mods/gcmod/_shared',
    { heartbeat: script, unresolved: ['Comms', 'heartbeatloop'] }),
  modOtherUnresolved: heartbeatUrls('maps/mods/gcmod/_shared',
    { heartbeat: script, unresolved: ['Comms'] }),
};

console.log(JSON.stringify(out));
