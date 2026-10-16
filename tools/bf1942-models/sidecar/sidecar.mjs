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
import { InputSender, spawnSequence, sendTeam, BUTTON } from './input.mjs';

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
const names = namesFile ? loadTidNames(namesFile) : { tidNames: {}, animStates: null };
// Without --names, the level's saved map (templates/<level>.json) and the
// class map name the objects once setLevel says which level this is.
const tidNames = names.tidNames;
// The engine's animation state table (from the same source) names the lower
// and upper state indices in a soldier's body: the replayer reads a stance
// (prone, crouch) and a fire from them through the v4 `anim` record.
let animStates = names.animStates;

const out = fs.createWriteStream(outPath);
const review = new ReviewLog(reviewPath);
let t0 = Date.now();
const now = () => +((Date.now() - t0) / 1000).toFixed(3);

let ws = null;
function writeRec(obj) {
  const line = JSON.stringify(obj);
  out.write(line + '\n');
  if (ws) ws.broadcast(line);
}

const stats = { events: 0, records: 0, raws: 0, ghostBlocks: 0, ghostRecords: 0, samples: 0, stances: 0, objects: 0, unknownEvents: 0 };
// Per-object identity, to name each object when it comes into scope (k:"o").
const objInfo = new Map(); // netId -> {tid, tmpl, team}
const pidTeam = new Map();
const ghosts = new GhostWriter({ write: (row) => writeRec(row), objInfo, cpNames: names.cpNames ?? {} });

// The session is replaced when the server drops the connection (a round or
// map change ends it; a retail client reconnects then too), so it is a `let`
// and every handler is attached by wire() below.
const newSession = () => new Session(host, port, { name, team, animStates: animStates ? animStates.length : 0 });
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
function press(mask) {
  pulse.mask = mask >>> 0;
  pulse.until = Date.now() + PULSE_MS;
}
const pageSeqBySerial = new Map();

// A page leaving idles the input, it does not stop the sender: the server
// keeps only a serial newer than the last it ran (D-4), so a fresh sender
// starting again at serial 1 for the next page was silently ignored for the
// rest of the session (live, 2026-10-16: a reloaded page sent 800 words and
// the server ran none; its control state's serial never moved).
function pageGone() {
  if (inputSender) inputSender.setInput(null);
  lastPageSeq = 0;
  pageSeqBySerial.clear();
}

function ensureSender() {
  if (inputSender || !s.joined) return;
  inputSender = new InputSender(s, { rate: 30, idle: 'zero' });
  inputSender.on('sent', ({ serial }) => {
    pageSeqBySerial.set(serial, lastPageSeq);
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
  // Anything else the page sends has no counterpart on this wire yet.
}

function onPageFrame(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) return;
  const type = buf[0];
  if (type === PAGE.INPUT) {
    ensureSender();
    if (!inputSender) return;
    try {
      const action = actionFromPageBytes(buf.subarray(5));
      if (Date.now() < pulse.until) action.buttons = (action.buttons | pulse.mask) >>> 0;
      inputSender.setInput(action);
      if (buf.length >= 5) lastPageSeq = buf.readUInt32LE(1);
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
      try { for (const l of fs.readFileSync(outPath, 'utf8').trim().split('\n')) if (l) sock.send(l); } catch {}
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
  // Back after the server dropped us: the page's last deploy stands, so the
  // new player is sent to the same spawn group with the same kit rather than
  // left dead on a page that thinks it has already deployed.
  if (reconnects > 0 && lastSpawn) {
    try { spawnSequence(s, lastSpawn); console.log('[sidecar] respawning after the reconnect:', JSON.stringify(lastSpawn)); }
    catch (e) { console.log('[sidecar] respawn after reconnect failed:', e.message); }
  }
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
  if (rec.e === 'setLevel' && !namesFile) {
    const auto = namesForLevel(rec.level);
    for (const [tid, n] of Object.entries(auto.tidNames)) if (!tidNames[tid]) tidNames[tid] = n;
    Object.assign(ghosts.cpNames, auto.cpNames);
    if (!animStates && auto.animStates) {
      animStates = auto.animStates;
      writeRec({ k: 'anim', t: 0, states: animStates });
    }
  }
  if ((rec.e === 'createObject' || rec.e === 'projPool') && rec.tid != null && tidNames[rec.tid]) rec.tmpl = tidNames[rec.tid];
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
  ghosts.block(now(), records);
  if (g.raw) review.ghostBlockRaw({ seq: g.seq, reason: g.reason, hex: g.raw });
});

s.on('control-state', (c) => {
  if (!c.ok && c.reason === 'no-baseline') return; // a delta before its first full state, joined mid-stream
  if (!c.ok) { review.decodeError({ where: 'control-state', seq: c.seq, message: c.reason ?? 'short read', hex: c.hex ?? null }); return; }
  if (!ws || c.controlId == null) return;
  const seq = pageSeqBySerial.get(c.controlId);
  // The soldier's hit points ride along: the page's own Armor takes the
  // server's drops (net-room.js onsnapshot), which is how it is hurt and dies.
  const hp = c.cls === 'BFSoldierNetworkable' && Number.isFinite(c.body?.hp) ? c.body.hp : undefined;
  if (seq) ws.broadcast(JSON.stringify({ k: 'ack', t: now(), seq, serial: c.controlId, id: c.netId, ...(hp !== undefined ? { hp } : {}) }));
});

s.on('unknown-datagram', (u) => review.unknownDatagram(u));
s.on('decode-error', (e) => review.decodeError(e));
s.on('denied', (i) => { console.log('[sidecar] denied:', i.name); finish(1); });
s.on('disconnected', (i) => {
  // A disconnect datagram can arrive more than once, and a replaced session
  // can still hear its own: only the live session's first one reconnects
  // (three reconnects at once put three copies of the player on the server).
  if (s !== current() || reconnectPending) return;
  console.log('[sidecar] server disconnected us:', i.name, i.message);
  try { s.conn.close(); } catch { /* already closed */ }
  reconnect();
});
}
let opened = false;
wire(s);

// The server ended the connection (seen: reason 0x19 at a round restart on the
// lab). Join again as a retail client does, with the same recording and the
// same page socket; the page adopts the new player by name.
let reconnects = 0;
let reconnectPending = false;
function current() { return s; }
function reconnect() {
  if (finished) return;
  reconnectPending = true;
  if (++reconnects > 20) { console.log('[sidecar] giving up after 20 reconnects'); finish(1); return; }
  if (inputSender) { inputSender.stop(); inputSender = null; }
  pageSeqBySerial.clear();
  setTimeout(async () => {
    if (finished) return;
    console.log('[sidecar] reconnecting');
    reconnectPending = false;
    s = newSession();
    wire(s);
    try { await s.start(); } catch (e) { console.log('[sidecar] reconnect failed:', e.message); reconnect(); }
  }, 3000);
}

let finished = false;
function finish(code) {
  if (finished) return; finished = true;
  clearTimeout(stayTimer);
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
