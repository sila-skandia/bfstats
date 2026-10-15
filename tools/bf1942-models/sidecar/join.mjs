#!/usr/bin/env node
// Join a BF1942 server as a bare client and log everything — the POC tester
// for features/udp-sidecar. Thin CLI over Session (session.mjs); sidecar.mjs
// is the browser bridge over the same session.
//
//   node join.mjs 192.168.1.226:14568 --name sidecar --stay 60 --log run.ndjson
//
// The log is a raw NDJSON trace of the session (one line per milestone, event,
// ghost block, unknown and stat) for inspection; it is NOT the replay format
// (that is sidecar.mjs). Use it to see what the server sends.

import fs from 'node:fs';
import { Session } from './session.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? '127.0.0.1:14567';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [host, portStr] = target.split(':');
const port = Number(portStr ?? 14567);
const name = opt('name', 'sidecar');
const team = Number(opt('team', 0));
const stay = Number(opt('stay', 30));
const logPath = opt('log', null);
const verbose = args.includes('--verbose');

const logFile = logPath ? fs.createWriteStream(logPath) : null;
function log(kind, rec = {}) {
  const line = JSON.stringify({ kind, t: Date.now(), ...rec });
  if (logFile) logFile.write(line + '\n');
  if (verbose || !['event', 'ghost', 'pong'].includes(kind)) console.log(line);
}

const s = new Session(host, port, { name, team });
let ghostBlocks = 0, ghostRecords = 0, unknownEvents = 0;

s.on('open', (i) => log('open', { host, port, name, stay, ...i }));
s.on('connected', (i) => log('connected', i));
s.on('joined', (i) => log('joined', i));
s.on('event', (ev) => log('event', { type: ev.type, playerId: ev.playerId, netId: ev.netId, name: ev.name }));
s.on('unknown-event', (u) => { unknownEvents++; log('unknown-event', u); });
s.on('unknown-datagram', (u) => log('unknown-datagram', u));
s.on('decode-error', (e) => log('decode-error', e));
s.on('ghost', (g) => { ghostBlocks++; ghostRecords += g.records ? g.records.length : 0; if (verbose) log('ghost', g); });
s.on('denied', (i) => { log('denied', i); finish(1); });
s.on('disconnected', (i) => { log('disconnected-by-server', i); finish(1); });
s.on('stats', (st) => log('stats', { ...st, ghostBlocks, ghostRecords, unknownEvents }));

let finished = false;
function finish(code) {
  if (finished) return; finished = true;
  clearTimeout(stayTimer);
  if (logFile) logFile.end();
  setTimeout(() => process.exit(code), 120);
}

await s.start();
const stayTimer = setTimeout(() => { log('leave'); s.leave(); finish(0); }, stay * 1000);
process.on('SIGINT', () => { log('leave'); s.leave(); finish(0); });
