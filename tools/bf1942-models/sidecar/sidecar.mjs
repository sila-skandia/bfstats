#!/usr/bin/env node
// The sidecar: join a real BF1942 server, decode its stream, and (a) write a
// bf42plus-v5 replay recording the existing replayer opens unchanged, and (b)
// send everything not yet decodable — the framed per-object ghost (movement)
// deltas and any unknown event or datagram — to a review log, the corpus to
// decode next. Optionally stream the recording live over a localhost
// WebSocket (--ws) for a direct browser link.
//
//   node sidecar.mjs 192.168.1.226:14568 --name sidecar \
//       --out run.ndjson --review run.review.ndjson --ws 17942 --stay 0
//
// The recording holds the static world, roster, and event timeline now;
// movement (k:"s" samples) waits on the ghost-stream decode, so objects sit at
// their created positions until then. Open run.ndjson in the replay viewer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { recordFor, header } from './record.mjs';
import { ReviewLog } from './review.mjs';
import { loadTidNames, namesForLevel } from './names.mjs';
import { GhostWriter } from './ghost-writer.mjs';
import { carrySelfAim } from './soldier-ghost.mjs';
import { gameTables } from './game-tables.mjs';
import { InputSender, PageButtonEdges, spawnSequence, sendTeam, sendChat, BUTTON, ONE_SHOT_BUTTONS } from './input.mjs';
import { Rejoiner, classifyDisconnect } from './rejoin.mjs';
import { probeServerInfo } from './netconn.mjs';
import { PLUS_RESTART, RETAIL_RESTART } from './plus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? '127.0.0.1:14567';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [host, portStr] = target.split(':');
const port = Number(portStr ?? 14567);
const name = opt('name', 'sidecar');
const team = Number(opt('team', 0)); // 0 = auto-assign; set to a human's team to receive their movement
const stay = Number(opt('stay', 0)); // 0 = until Ctrl-C
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const outPath = opt('out', `sidecar-${stamp}.ndjson`);
const reviewPath = opt('review', `sidecar-${stamp}.review.ndjson`);
const wsPort = opt('ws', null);
// Optional tid->template-name map (a bf42plus recording or a saved map), so
// objects carry a model name live. Without it the recording's objects are
// placed but blank. Build one with build-names.mjs.
const namesFile = opt('names', null);
// How long to keep trying to get back on after the server drops us (a level
// change restarts the server; a big mod level can take minutes to load).
const rejoinHorizonS = Number(opt('rejoin-horizon', 600));
// Join as a bf42++ client (the ConnectAcceptAck marker, plus.mjs) unless
// --retail: a bf42++-aware server then sends bf42++'s own events, which
// events.mjs decodes. --plus-version 2.0.0.0 overrides the version reported.
const retail = args.includes('--retail');
const plusVersion = (() => {
  const v = opt('plus-version', null);
  if (!v) return undefined;
  const [major = 0, minor = 0, patch = 0, build = 0] = v.split('.').map(Number);
  return { major, minor, patch, build };
})();
const plusIdentity = retail ? null : (plusVersion ? { version: plusVersion } : undefined);
const names = namesFile ? loadTidNames(namesFile) : { tidNames: {}, animStates: null };
// Without --names, the level's saved map (templates/<level>.json) and the
// class map name the objects once setLevel says which level this is.
const tidNames = names.tidNames;
// The engine's animation state table (from the same source) names the lower
// and upper state indices in a soldier's body: the replayer reads a stance
// (prone, crouch) and a fire from them through the v4 `anim` record.
let animStates = names.animStates;
const namesAnim = names.animStates; // a --names table's: fixed for the run
let serverMod = null; // the server's mod, from its ServerInfo event: picks the install's mod for the tables

const out = fs.createWriteStream(outPath);
const review = new ReviewLog(reviewPath);
let t0 = Date.now();
const now = () => +((Date.now() - t0) / 1000).toFixed(3);

let ws = null;
// Every line written, in memory, for a page that connects later: the file is
// a buffered stream, so reading it back missed whatever had not been flushed
// yet, and a page that joined mid-session could lose the very rows that say
// which object it controls (live, 2026-10-16: the page drew no self at all).
const lines = [];
function writeRec(obj) {
  const line = JSON.stringify(obj);
  out.write(line + '\n');
  lines.push(line);
  if (ws) ws.broadcast(line);
}

const stats = { events: 0, records: 0, raws: 0, ghostBlocks: 0, ghostRecords: 0, samples: 0, stances: 0, objects: 0, unknownEvents: 0 };
// Per-object identity, to name each object when it comes into scope (k:"o").
const objInfo = new Map(); // netId -> {tid, tmpl, team}
const pidTeam = new Map();
const ghosts = new GhostWriter({ write: (row) => writeRec(row), objInfo, cpNames: names.cpNames ?? {} });

// The session is replaced when the server drops the connection (a level
// change restarts the server; a retail client rejoins then too, rejoin.mjs),
// so it is a `let` and every handler is attached by wire() below.
// Without --names the session's body decoder takes the animation table's
// count from the install at each setLevel (body-decoder.mjs). A rejoin passes
// the reconnect password the last level's GameStatus 5 carried and the side
// the player was on.
const newSession = (o = {}) => new Session(host, port, {
  name, team: o.team ?? team, reconnectPassword: o.reconnectPassword ?? '',
  animStates: namesAnim ? namesAnim.length : 0,
  plus: plusIdentity,
  // A 3DO setting names a template; the level's table says whether it exists.
  templateExists: (n) => Object.values(tidNames).some((t) => String(t).toLowerCase() === String(n).toLowerCase()),
});
let s = newSession();

// ---- the page's own messages -----------------------------------------------
//
// The page sends the room protocol's frames (viewer/netcode.js), so the browser
// game's input path is unchanged: 0x02 input, 0x05 action JSON, 0x04 leave. The
// sidecar is the client, so these become the engine's own messages to the
// server. Nothing here is sent before the join: an input datagram and a
// SpawnRequest both null-deref with no BFPlayer bound (the crash class J-8
// belongs to), and the InputSender and spawnSequence refuse before it.
const PAGE = { INPUT: 0x02, PING: 0x03, LEAVE: 0x04, ACTION: 0x05 };
let inputSender = null;

// The page's input sequence against the engine's serials. The page numbers
// its input words (one per world tick, the room protocol's seq) and its
// reconciler measures the server's word against the tick that word names; the
// server echoes the last serial it ran in the control-object state
// (GhostManager+0xe0, ghost/control-state.mjs). So each serial sent remembers
// the newest page word it carried, and an echoed serial becomes the page's
// ack: the `k:"ack"` row, sent to the page only (it is not a recording row).
let lastPageSeq = 0;
let lastSpawn = null; // the page's last deploy, replayed after a reconnect
// A button the page asked for by message rather than in its input word, held
// for PULSE_MS so the server's tick sees it down (sidecar.mjs onPageAction).
const PULSE_MS = 200;
const pulse = { mask: 0, until: 0 };
// A non-repetitive trigger (Reload, a MenuSelect) is a one-tick press: it
// rides the next page word only. Use is push-and-hold, so it is held.
let oneShot = 0;
function press(mask) {
  if ((mask & ONE_SHOT_BUTTONS) === mask) { oneShot = (oneShot | mask) >>> 0; return; }
  pulse.mask = mask >>> 0;
  pulse.until = Date.now() + PULSE_MS;
}
// The page's word speaks levels; the engine's record wants the retail shape
// (input.mjs PageButtonEdges: one tick per press for every non-repetitive
// trigger). A message-borne press (Reload, a MenuSelect) rides the next word.
const pageEdges = new PageButtonEdges();
function edgesOf(action) {
  action.buttons = pageEdges.apply(action.buttons, oneShot);
  if (process.env.SIDECAR_DEBUG && (action.buttons & ONE_SHOT_BUTTONS)) console.log(`[sidecar] one-shot ${(action.buttons & ONE_SHOT_BUTTONS).toString(16)}`);
  oneShot = 0;
  return action;
}
const pageSeqBySerial = new Map();

// A page leaving idles the input, it does not stop the sender: the server
// keeps only a serial newer than the last it ran (D-4), so a fresh sender
// starting again at serial 1 for the next page was silently ignored for the
// rest of the session (live, 2026-10-16: a reloaded page sent 800 words and
// the server ran none; its control state's serial never moved).
function pageGone() {
  if (inputSender) { inputSender.pending.length = 0; inputSender.setInput(null); }
  lastPageSeq = 0;
  pageEdges.reset(); oneShot = 0;
  pageSeqBySerial.clear();
}

// A sender belongs to one session. The page sends input on every tick, so
// during a reconnect's wait the old session (closed, but still `joined`) was
// the one a page word found here: the sender bound to it, the new session's
// join then saw a sender and kept it, and every word after that went to a
// closed connection and was dropped. The server ran nothing, stood the soldier
// at his spawn, and with no input sent no control-object state either, so the
// page walked on its prediction with nothing to correct it (live, 2026-10-16:
// the page at the jeep, the server's soldier 37 m away at the spawn point for
// both lives, by the lab's own event log).
function ensureSender() {
  if (inputSender && inputSender.session === s) return;
  if (rejoiner.active || !s.joined) return;
  if (inputSender) { inputSender.stop(); console.log('[sidecar] input sender moved to the new session'); }
  pageSeqBySerial.clear();
  stalledSeen = 0;
  inputSender = new InputSender(s, { rate: 30, idle: 'zero', idleButtons: () => {
    // The page's message-borne presses ride the idle records too when the
    // page sends no words (its deploy screen): an E from there never reached
    // the server before.
    let b = Date.now() < pulse.until ? pulse.mask : 0;
    if (oneShot) { b |= oneShot; oneShot = 0; }
    return b;
  } });
  inputSender.on('sent', ({ serial, tag, action }) => {
    // Only a page word acknowledges a page tick; an idle record is a tick the
    // page never ran, and mapping it to the page's last word measured every
    // correction against the wrong tick.
    if (!Number.isInteger(tag)) return;
    pageSeqBySerial.set(serial, tag);
    if (pageSeqBySerial.size > 600) pageSeqBySerial.delete(pageSeqBySerial.keys().next().value);
  });
  inputSender.start();
  console.log('[sidecar] input path live: 30 Hz, idle = zero input');
}

// The page's 17-byte action carries the engine's own 104-bit record in its
// first 13 bytes: six 12-bit channels little-endian from bit 0, then the u32
// button mask at bit 72 (viewer/netcode.js encodeInput). That is exactly the
// record the server reads, so the values pass through rather than being
// re-encoded from a decoded shape.
function actionFromPageBytes(bytes) {
  const axes = [];
  for (let ch = 0; ch < 6; ch++) {
    let v = 0;
    for (let i = 0; i < 12; i++) { const bit = ch * 12 + i; if (bytes[bit >> 3] & (1 << (bit & 7))) v |= 1 << i; }
    axes.push(v);
  }
  let buttons = 0;
  for (let i = 0; i < 32; i++) { const bit = 72 + i; if (bytes[bit >> 3] & (1 << (bit & 7))) buttons = (buttons | (1 << i)) >>> 0; }
  // Two of the page's bits are the room protocol's own (netcode.js): bit 22 is
  // its jump, which the page binds to c_PIAction, the engine's bit 1; bit 23
  // is the touch pad's flag, which the engine reads as nothing. On the
  // engine's wire bits 22 and 23 are ch30 and ch31, so they are moved off.
  if (buttons & (1 << 22)) buttons = (buttons | BUTTON.ACTION) >>> 0;
  buttons = (buttons & ~((1 << 22) | (1 << 23))) >>> 0;
  return { axes, buttons };
}

function onPageAction(row) {
  if (!row || typeof row !== 'object') return;
  if (row.type === 'join') {
    // Joining is not spawning: the sidecar is already on the server, and the
    // page's deploy screen sends the spawn ('spawn' below) when the player
    // picks a flag and a kit. A side named here is chosen now (SetTeam), so
    // the deploy screen opens on the right tab.
    if (!s.joined) { console.log('[sidecar] page join refused: not joined yet'); return; }
    const team = Number(row.team);
    if ((team === 1 || team === 2) && team !== s.me.team) {
      try { sendTeam(s, team); } catch (e) { console.log('[sidecar] page team failed:', e.message); }
    }
    console.log(`[sidecar] page joined${team ? ` (team ${team})` : ''}`);
    return;
  }
  if (row.type === 'spawn') {
    // The deploy screen's commit: the side, the kit and the spawn group, as a
    // retail client sends them (SetTeam 0x39 when the side changes, ChangeKit
    // 0x3e, SpawnRequest 0x2f with the kit in its second byte). The server
    // picks the point inside the group and the page is corrected to it.
    if (!s.joined) return;
    const group = Number(row.spawnGroup);
    const kit = Number.isInteger(row.kitIndex) ? row.kitIndex : 0;
    if (!Number.isInteger(group) || group <= 0) { console.log('[sidecar] page spawn with no spawn group:', JSON.stringify(row)); return; }
    try {
      lastSpawn = { team: (row.team === 1 || row.team === 2) ? row.team : null, kit, spawnGroup: group };
      spawnSequence(s, lastSpawn);
      console.log(`[sidecar] page spawn: team ${row.team ?? s.me.team} kit ${kit} group ${group}`);
    } catch (e) { console.log('[sidecar] page spawn failed:', e.message); }
    return;
  }
  // The page's seat rows and its reload are buttons on the engine's input
  // word, not messages: entering and leaving a hull is c_PIUse (SEAT-1, rising
  // edge, a 1 s cooldown, SEAT-2), a seat switch c_PIMenuSelect<n> (SEAT-11),
  // a reload c_PIReload. The page has already acted on its own copy (its
  // prediction); the press is held for a few ticks so the server sees an edge.
  if (row.type === 'seat') {
    if (row.action === 'switch' && Number.isInteger(row.seat) && row.seat >= 0 && row.seat < 9) {
      press(BUTTON[`MENU${row.seat + 1}`]);
    } else {
      press(BUTTON.USE);
    }
    return;
  }
  if (row.type === 'reload') { press(BUTTON.RELOAD); return; }
  if (row.type === 'radio') {
    s.queue('RadioMessage', { message: row.msg, broadcast: !!row.team, playerId: s.me.playerId });
    return;
  }
  if (row.type === 'chat') {
    // The page's typed line, all or team (input.mjs sendChat, chat.mjs).
    if (!s.joined) return;
    try {
      if (!sendChat(s, String(row.text ?? ''), { team: !!row.team })) console.log('[sidecar] page chat dropped (empty, or four lines waiting)');
    } catch (e) { console.log('[sidecar] page chat failed:', e.message); }
    return;
  }
  // Anything else the page sends has no counterpart on this wire yet.
}

// Page words that never reach the wire are a soldier the server never moves,
// and nothing on the page shows it: say so, at most every five seconds.
let stalledWarnAt = 0, stalledSeen = 0;
function warnIfStalled() {
  const dropped = inputSender.stats.dropped ?? 0;
  if (dropped === stalledSeen || Date.now() < stalledWarnAt) return;
  console.log(`[sidecar] page input is not reaching the server: ${dropped - stalledSeen} words dropped (connection ${inputSender.session.conn.state}, joined ${inputSender.session.joined})`);
  stalledSeen = dropped;
  stalledWarnAt = Date.now() + 5000;
}

function onPageFrame(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) return;
  const type = buf[0];
  if (type === PAGE.INPUT) {
    ensureSender();
    if (!inputSender) return;
    try {
      const action = edgesOf(actionFromPageBytes(buf.subarray(5)));
      if (Date.now() < pulse.until) action.buttons = (action.buttons | pulse.mask) >>> 0;
      const pageSeq = buf.readUInt32LE(1);
      lastPageSeq = pageSeq;
      inputSender.enqueue(action, pageSeq);
      warnIfStalled();
    } catch { /* a malformed frame is not worth a crash */ }
    return;
  }
  if (type === PAGE.ACTION) {
    let row; try { row = JSON.parse(buf.subarray(1).toString('utf8')); } catch { return; }
    onPageAction(row);
    return;
  }
  if (type === PAGE.LEAVE) {
    // The page is done, not the sidecar: it is a long-lived process that serves
    // whatever page connects, so a page leaving (or reloading) stops the input
    // and leaves the player standing, rather than dropping the connection to
    // the server and exiting. Ctrl-C or --stay is how the sidecar leaves.
    pageGone();
    console.log('[sidecar] the page left; input idle, still on the server');
  }
}

function wire(s) {
s.on('open', async (i) => {
  if (opened) return;            // a reconnect keeps the recording and the page's socket
  opened = true;
  t0 = Date.now();
  writeRec(header(10, { host, port, name }));
  if (animStates) writeRec({ k: 'anim', t: 0, states: animStates });
  console.log(`[sidecar] ${host}:${port} as "${name}"  recording=${path.resolve(outPath)}  review=${path.resolve(reviewPath)}`);
  if (wsPort) {
    const { WSServer } = await import('./wsserver.mjs');
    ws = new WSServer({ port: Number(wsPort), staticFile: path.join(HERE, 'page', 'index.html') });
    ws.on('connection', (sock) => {
      // Replay the recording so far to a newly-connected page.
      for (const l of lines) sock.send(l);
      // The replay ends here: what follows is happening now (a level load
      // after this is one the page must act on, net-sidecar.js setLevel).
      sock.send(JSON.stringify({ k: 'live' }));
      // Who this client is, by the server's own player id: a page that went
      // by the name took the wrong player whenever the server still held a
      // dropped connection's player under it (the new one is "<name>_1").
      if (s.joined && s.me.playerId != null) sock.send(JSON.stringify({ k: 'me', pid: s.me.playerId }));
      // And listen for what the page sends back: its input, its join and its
      // leave (onPageFrame). The socket delivers both text and binary frames.
      sock.on('message', (data) => onPageFrame(data));
      sock.on('close', () => {
        // Same as an explicit leave: the player stands still rather than the
        // sidecar dropping the server because a tab was closed.
        pageGone();
      });
      ensureSender();
    });
    const addr = await ws.listen();
    console.log(`[sidecar] live feed: http://127.0.0.1:${addr.port}/  (ws on the same port)`);
  }
});

s.on('connected', (i) => console.log(`[sidecar] connected id=${i.id}`));
s.on('joined', (i) => {
  console.log(`[sidecar] joined as player ${i.playerId} team ${i.team}: ${i.players} players, ${i.objects} objects`);
  ensureSender();   // safe only now: the server has a BFPlayer bound
  if (ws) ws.broadcast(JSON.stringify({ k: 'me', pid: i.playerId }));
  // Back after the server dropped us (the lab drops every client at a map
  // load): the new session's world dump opens with SetLevel, which the page
  // reads as a level load and answers by going back to its deploy screen
  // (net-sidecar.js setLevel). The player deploys from there, as a retail
  // client does after a map change; respawning the old deploy here would put
  // a soldier on the field behind the page's deploy screen.
});

s.on('event', (ev) => {
  stats.events++;
  const rec = recordFor(ev);
  if (rec === undefined) return;             // client->server echo; nothing to record
  if (rec === null) {                        // parsed but no v5 mapping yet
    stats.raws++;
    writeRec({ k: 'e', t: now(), e: 'raw', type: ev.id ?? null, name: ev.type });
    return;
  }
  stats.records++;
  if (rec.e === 'serverInfo' && rec.mod) serverMod = rec.mod;
  if (rec.e === 'setLevel') {
    // The level's template ids, computed from the install for the server's
    // mod and this round's game type (names.mjs, template-table.mjs). A tid is
    // the level load's own order, so a new level replaces the whole table.
    const auto = namesForLevel(rec.level, { mod: serverMod, mode: rec.mode });
    if (!namesFile) {
      for (const k of Object.keys(tidNames)) delete tidNames[k];
      Object.assign(tidNames, auto.tidNames);
    }
    // The animation table and the control point names come from the install,
    // as the retail client builds them (game-tables.mjs); the recorded copies
    // in templates/<level>.json stand in only when that fails. A --names
    // file's own tables win.
    const g = gameTables({ mod: serverMod, level: rec.level, mode: rec.mode });
    if (!Object.keys(names.cpNames ?? {}).length) {
      if (!g.cpNames) console.error(`[sidecar] control point names for ${rec.level} fall back to the recorded table (${Object.keys(auto.cpNames ?? {}).length} names)`);
      for (const k of Object.keys(ghosts.cpNames)) delete ghosts.cpNames[k];
      Object.assign(ghosts.cpNames, g.cpNames ?? auto.cpNames);
    }
    // Rebuilt at every level load (Game::load), so a mod whose levels ship
    // their own animation scripts (FH, FHSW, FHSWEurope) has one per level:
    // a new table is a new `anim` row.
    if (!namesAnim) {
      if (!g.animStates && auto.animStates) console.error(`[sidecar] the animation state table falls back to the recorded one (${auto.animStates.length} states)`);
      const table = g.animStates ?? auto.animStates;
      if (table && JSON.stringify(table) !== JSON.stringify(animStates)) {
        animStates = table;
        writeRec({ k: 'anim', t: 0, states: animStates });
      }
    }
  }
  if ((rec.e === 'createObject' || rec.e === 'projPool' || rec.e === 'createStatic') && rec.tid != null && tidNames[rec.tid]) rec.tmpl = tidNames[rec.tid];
  // bf42++: a SpecialGame 2 ahead of this connection's SetLevel means the
  // level loads without its StaticObjects.con (session.mjs, wire.md §30).
  if (rec.e === 'setLevel' && s.plus.skipStaticObjects) rec.statics = 0;
  if (rec.e === 'createPlayer') pidTeam.set(rec.pid, rec.team);
  if (rec.e === 'createObject' && rec.netId != null) objInfo.set(rec.netId, { tid: rec.tid, tmpl: rec.tmpl || '', team: 0 });
  if (rec.e === 'control' && rec.netId != null && objInfo.has(rec.netId)) objInfo.get(rec.netId).team = pidTeam.get(rec.pid) ?? 0;
  const t = now();
  const extra = ghosts.note(rec, t);
  writeRec({ k: 'e', t, ...rec });
  for (const x of extra) { ghosts.note(x, t); writeRec({ k: 'e', t, ...x }); }
});

s.on('unknown-event', (u) => {               // 7-bit type with no decoder
  stats.unknownEvents++;
  review.unknownEvent(u);
  writeRec({ k: 'e', t: now(), e: 'raw', type: u.id });
});

s.on('ghost', (g) => {
  stats.ghostBlocks++;
  const records = g.records || [];
  stats.ghostRecords += records.length;
  for (const r of records) review.ghostRecord({ seq: g.seq, tick: g.tick, ...r });
  // Scope, transforms, soldier state, hull damage and vehicle rounds
  // (ghost-writer.mjs, shared with the offline rebuild).
  ghosts.block(now(), records, g.tick);
  if (g.raw) review.ghostBlockRaw({ seq: g.seq, reason: g.reason, hex: g.raw });
});

const r4 = (x) => +x.toFixed(4);
const r6 = (x) => +x.toFixed(6);
const selfAim = new Map(); // soldier netId -> { aim, twist, q } as of the newest control state
const selfAimOf = (netId, body) => carrySelfAim(selfAim, netId, body);
s.on('control-state', (c) => {
  if (!c.ok && c.reason === 'no-baseline') return; // a delta before its first full state, joined mid-stream
  // The serial echo is read ahead of the body (control-state.mjs), so a body
  // this reader cannot parse still acknowledges the page's words: a driver of a
  // hull with no child spec got no ack at all, and so no correction.
  if (!c.ok) review.decodeError({ where: 'control-state', seq: c.seq, message: c.reason ?? 'short read', hex: c.hex ?? null });
  if (!ws || c.controlId == null) return;
  const seq = pageSeqBySerial.get(c.controlId);
  // The soldier's hit points ride along: the page's own Armor takes the
  // server's drops (net-room.js onsnapshot), which is how it is hurt and dies.
  const hp = c.ok && c.cls === 'BFSoldierNetworkable' && Number.isFinite(c.body?.hp) ? c.body.hp : undefined;
  // So does his aim (the body's aimA register, degrees, up positive; the
  // twist; the body's rotation): the retail client takes the whole
  // control-object state at the acked tick, the aim with it, and the page
  // closes its own view to it (net-sidecar.js: the view's pitch is 2.5 times
  // the register, its yaw the body's plus 3 times the twist, ledger VIEW-14).
  // A state carries a field only when it changed, so each is carried forward
  // per soldier, as the client keeps what a state leaves out; the ghost rows
  // of the same datagram are written after this ack, so the page cannot take
  // them for the acked tick.
  const aimState = c.ok && c.cls === 'BFSoldierNetworkable' ? selfAimOf(c.netId, c.body) : null;
  // A driven hull's own state at the acked tick, whole: its root's position,
  // rotation and velocity (the body's vecA). The retail client's
  // readControlObjectState (BF1942.exe 0x004968a0) sets transform AND
  // velocities from it before replaying the unacked actions; the page used
  // to take the position from the newest transform row and leave its own
  // velocity, so a hull its own prediction drove into a static it missed
  // kept 12 m/s against a server stopped at the wall (Tobruk, 2026-10-17).
  const hull = c.ok && c.cls !== 'BFSoldierNetworkable' && c.body?.pos && c.body?.rot && c.body?.vecA
    ? { hp3: c.body.pos.map(r4), hq: c.body.rot.map(r6), hv: c.body.vecA.map(r4) } : null;
  if (seq) ws.broadcast(JSON.stringify({ k: 'ack', t: now(), seq, serial: c.controlId, id: c.netId, ...(hp !== undefined ? { hp } : {}), ...(aimState ?? {}), ...(hull ?? {}) }));
});

s.on('unknown-datagram', (u) => review.unknownDatagram(u));
s.on('decode-error', (e) => review.decodeError(e));
s.on('plus-settings', (st) => {
  writeRec({ k: 'e', t: now(), e: 'plusSettings', ui: st.UI, mine3DMap: st.mine3DMap,
    supplyDepot3DMap: st.supplyDepot3DMap, controlPoint3DMap: st.controlPoint3DMap, custom3DMaps: st.custom3DMaps });
  console.log(`[sidecar] bf42++ server settings: ${st.seen.join(', ')}${st.UI.allowFasterRestart ? '' : ' (no faster restart)'}`);
});
s.on('skip-static-objects', () => console.log('[sidecar] bf42++: the server says this level loads without its StaticObjects.con'));
s.on('level-change', (i) => console.log(`[sidecar] level over: the server will restart for mod "${i.mod}"; reconnect password ${i.password || '(none)'}`));
// The first join's refusal ends the run; a rejoin's refusals are the
// rejoiner's to weigh (a full server during the reconnect window is retried).
s.on('denied', (i) => { if (rejoiner.active) return; console.log('[sidecar] denied:', i.name); finish(1); });
s.on('disconnected', (i) => {
  // A disconnect datagram can arrive more than once, and a replaced session
  // can still hear its own: only the live session's first one rejoins
  // (three reconnects at once put three copies of the player on the server).
  // A rejoin attempt's own drops belong to the rejoiner.
  if (s !== current() || rejoiner.active) return;
  const kind = classifyDisconnect(i.reason, { levelChange: s.levelChange });
  console.log(`[sidecar] server disconnected us: ${i.name}${i.message ? ` "${i.message}"` : ''} (${kind})`);
  s.close();
  if (finished) return;
  if (inputSender) { inputSender.stop(); inputSender = null; }
  pageSeqBySerial.clear();
  rejoiner.start({
    kind, reason: i.reason,
    password: s.levelChange?.password ?? '',
    // The side we were on; the retail client asks for auto (0) after its relaunch.
    team: s.me.team === 1 || s.me.team === 2 ? s.me.team : team,
    // The client's pinger: bf42++'s, or the retail first delay if this
    // server's welcome lines said UI&nfr (plus.mjs restartTiming).
    timing: s.restartTiming(),
  });
  if (rejoiner.active) console.log(`[sidecar] probing the server after ${rejoiner.timing.firstProbeMs / 1000} s, then every ${rejoiner.timing.probeMs / 1000} s`);
});
}
let opened = false;

// Getting back on after a drop (rejoin.mjs): probe the server the way the
// retail client does while it waits for a restart, join with the reconnect
// password, keep the recording and the page socket. The page adopts the new
// player by the `me` row the new session's join sends.
function current() { return s; }
const rejoiner = new Rejoiner({
  ...(retail ? RETAIL_RESTART : PLUS_RESTART),
  horizonMs: rejoinHorizonS * 1000,
  probe: () => probeServerInfo(host, port),
  connect: ({ reconnectPassword, team: t }) => {
    s = newSession({ reconnectPassword, team: t });
    wire(s);
    s.start().catch((e) => console.log('[sidecar] rejoin socket failed:', e.message));
    return s;
  },
});
rejoiner.on('probe', (p) => { if (p.up || process.env.SIDECAR_DEBUG) console.log(`[sidecar] rejoin probe ${p.n}: ${p.up ? 'the server answers' : 'no answer'}`); });
rejoiner.on('attempt', (a) => console.log(`[sidecar] rejoining (attempt ${a.n}${a.reconnectPassword ? `, reconnect password ${a.reconnectPassword}` : ''}${a.team ? `, team ${a.team}` : ''})`));
rejoiner.on('retry', (r) => console.log(`[sidecar] rejoin: ${r.why}; next try in ${(r.delayMs / 1000).toFixed(1)} s`));
rejoiner.on('rejoined', (r) => {
  console.log(`[sidecar] back on after ${(r.elapsedMs / 1000).toFixed(1)} s, ${r.attempts} attempt(s)${r.usedKey ? ', through a reconnect slot' : ''}`);
  ensureSender();
});
rejoiner.on('give-up', (g) => {
  console.log(`[sidecar] not rejoining: ${g.why}${g.reason != null ? ` (reason 0x${g.reason.toString(16)})` : ''} after ${(g.elapsedMs / 1000).toFixed(0)} s`);
  finish(1);
});
wire(s);

let finished = false;
function finish(code) {
  if (finished) return; finished = true;
  clearTimeout(stayTimer);
  rejoiner.stop();
  if (inputSender) { inputSender.stop(); inputSender = null; }
  writeRec({ k: 'end', t: now() });
  out.end();
  const sum = review.summary();
  review.close();
  console.log('[sidecar] stats:', JSON.stringify({ ...stats, ...ghosts.stats }));
  console.log('[sidecar] review:', JSON.stringify(sum));
  if (ws) ws.close();
  setTimeout(() => process.exit(code), 150);
}

await s.start();
const stayTimer = stay > 0 ? setTimeout(() => { s.leave(); finish(0); }, stay * 1000) : null;
process.on('SIGINT', () => { console.log('\n[sidecar] leaving'); s.leave(); finish(0); });
