#!/usr/bin/env node
// A whole sidecar session, captured for the parity replays: this runs the Node
// sidecar against a BF1942 server through a UDP relay, and stands between the
// sidecar and its pages as a WebSocket relay, logging on one clock everything
// the sidecar was given: every datagram the server sent (per client socket, so
// the rejoin's probes and the new session's socket stay apart), every frame a
// page sent, each page's open and close, and the SIGINT that ended it. The
// replay (parity/sidecar-captures.mjs) feeds exactly that to the Node sidecar
// and to the Kotlin one under the fake clock, and requires the same output.
//
//   node parity/live/page-relay.mjs --to 127.0.0.1:14568 --out cap.ndjson \
//        --page-ws 17996 --secs 300 [--script page-script.json] -- --name skandia-sc --team 2
//
// The arguments after `--` go to sidecar.mjs, which is pointed at the relay
// (127.0.0.1:--listen) with --ws on --sidecar-ws and --no-prejoin (the
// pre-join look would ask the relay's address). A page (map.html, a lab probe)
// opens ws://127.0.0.1:--page-ws instead of the sidecar's port. `--script`
// adds a page of its own: a JSON list of {t, text} (a 0x05 action row) and
// {t, words: {secs, input, look, fireEvery}} (30 Hz input words), {t, open} /
// {t, close}, t in seconds from the sidecar's join.
//
// Lines: {k:"capture", args, to, ...} first; then {t, dir:"out"|"in", c, hex}
// per datagram (c: the client socket's index); {t, op:"pageOpen"|"pageClose",
// sock}; {t, op:"pageText", sock, text} / {t, op:"pageBin", sock, hex};
// {t, op:"sigint"}; {t, k:"log", line} for the sidecar's console. `t` is ms
// since the relay started. SIGINT here stops the sidecar with SIGINT, waits
// for it, and closes the file; --secs does the same on a timer.
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(HERE, '../../../bf1942-models');
const { WSServer } = await import(path.join(MODELS, 'sidecar', 'wsserver.mjs'));
const { encodeInputFrame } = await import(path.join(MODELS, 'viewer', 'netcode.js'));

const all = process.argv.slice(2);
const dd = all.indexOf('--');
const args = dd >= 0 ? all.slice(0, dd) : all;
const sidecarArgs = dd >= 0 ? all.slice(dd + 1) : [];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const listen = Number(opt('listen', 14600));
const [toHost, toPortStr] = String(opt('to', '127.0.0.1:14568')).split(':');
const toPort = Number(toPortStr);
const outPath = opt('out', 'capture.ndjson');
const pageWs = Number(opt('page-ws', 17996));
const sidecarWs = Number(opt('sidecar-ws', 17995));
const secs = Number(opt('secs', 0));
const scriptPath = opt('script', null);
if (toPort === 14567) { console.error('14567 is server1; refusing'); process.exit(2); }

const out = fs.createWriteStream(outPath);
const t0 = performance.now();
const t = () => +(performance.now() - t0).toFixed(3);
const row = (o) => out.write(JSON.stringify(o) + '\n');
const fullArgs = [`127.0.0.1:${listen}`, ...sidecarArgs, '--ws', String(sidecarWs), '--no-prejoin'];
row({ k: 'capture', to: `${toHost}:${toPort}`, listen, args: fullArgs, started: new Date().toISOString() });

// ---- UDP: one back socket per client socket ----------------------------------
const front = dgram.createSocket('udp4');
const clients = new Map(); // "addr:port" -> {idx, back}
const n = { out: 0, in: 0 };
front.on('message', (msg, rinfo) => {
  const key = `${rinfo.address}:${rinfo.port}`;
  let c = clients.get(key);
  if (!c) {
    c = { idx: clients.size, back: dgram.createSocket('udp4'), rinfo };
    clients.set(key, c);
    row({ k: 'client', t: t(), c: c.idx, port: rinfo.port });
    c.back.on('message', (m) => {
      row({ t: t(), dir: 'in', c: c.idx, hex: m.toString('hex') });
      n.in++;
      front.send(m, c.rinfo.port, c.rinfo.address);
    });
    c.back.bind(0);
  }
  row({ t: t(), dir: 'out', c: c.idx, hex: msg.toString('hex') });
  n.out++;
  c.back.send(msg, toPort, toHost);
});
await new Promise((res) => front.bind(listen, '127.0.0.1', res));

// ---- the page relay ------------------------------------------------------------
let pages = 0;
function upstream(idx, onOpen) {
  const up = new WebSocket(`ws://127.0.0.1:${sidecarWs}`);
  up.binaryType = 'arraybuffer';
  const q = [];
  let open = false;
  up.addEventListener('open', () => { open = true; row({ t: t(), op: 'pageOpen', sock: idx }); onOpen?.(); for (const f of q.splice(0)) send(f); });
  const send = (f) => {
    if (!open) { q.push(f); return; }
    if (typeof f === 'string') row({ t: t(), op: 'pageText', sock: idx, text: f });
    else row({ t: t(), op: 'pageBin', sock: idx, hex: Buffer.from(f).toString('hex') });
    up.send(f);
  };
  return { up, send, closeLogged: false };
}
const hub = new WSServer({ port: pageWs });
hub.on('connection', (page) => {
  const idx = pages++;
  const u = upstream(idx);
  u.up.addEventListener('message', (e) => page.send(typeof e.data === 'string' ? e.data : Buffer.from(e.data)));
  const closeBoth = () => { if (u.closeLogged) return; u.closeLogged = true; row({ t: t(), op: 'pageClose', sock: idx }); try { u.up.close(); } catch {} page.close(); };
  u.up.addEventListener('close', closeBoth);
  page.on('message', (data, isBin) => u.send(isBin ? data : String(data)));
  page.on('close', closeBoth);
});
await hub.listen();

// ---- the sidecar -----------------------------------------------------------------
const child = spawn(process.execPath, [path.join(MODELS, 'sidecar', 'sidecar.mjs'), ...fullArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
let joinedAt = null;
const onLine = (l) => {
  row({ t: t(), k: 'log', line: l });
  console.log(l);
  if (joinedAt == null && l.startsWith('[sidecar] joined as player')) { joinedAt = t(); runScript(); }
};
for (const s of [child.stdout, child.stderr]) {
  let buf = '';
  s.setEncoding('utf8');
  s.on('data', (d) => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) onLine(buf.slice(0, i)); });
}
let stopping = false;
const childDone = new Promise((res) => child.on('exit', (code) => { row({ t: t(), k: 'exit', code }); res(); }));

// ---- the scripted page -----------------------------------------------------------
function runScript() {
  if (!scriptPath) return;
  const steps = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  let mine = null, seq = 1;
  for (const st of steps) {
    setTimeout(() => {
      if (stopping) return;
      if (st.open) { const idx = pages++; mine = { idx, ...upstream(idx) }; mine.up.addEventListener('close', () => { if (!mine?.closeLogged) { row({ t: t(), op: 'pageClose', sock: idx }); } }); return; }
      if (!mine) return;
      if (st.close) { mine.closeLogged = true; row({ t: t(), op: 'pageClose', sock: mine.idx }); mine.up.close(); mine = null; return; }
      if (st.text) { mine.send(`\x05${JSON.stringify(st.text)}`); return; }
      if (st.words) {
        const w = st.words, until = performance.now() + w.secs * 1000;
        const tick = () => {
          if (!mine || stopping || performance.now() >= until) return;
          const fire = w.fireEvery && seq % w.fireEvery === 0;
          mine.send(Buffer.concat([Buffer.from([2]), Buffer.from(encodeInputFrame(seq, fire ? { ...w.input, fire: true } : w.input, w.look ?? { x: 0, y: 0 }))]));
          seq++;
          setTimeout(tick, 1000 / 30);
        };
        tick();
      }
    }, st.t * 1000);
  }
}

async function stop(signal = true) {
  if (stopping) return; stopping = true;
  if (signal) { row({ t: t(), op: 'sigint' }); child.kill('SIGINT'); }
  await Promise.race([childDone, new Promise((r) => setTimeout(r, 5000))]);
  await new Promise((r) => setTimeout(r, 300));
  console.log(`[page-relay] ${n.out} out, ${n.in} in, ${clients.size} client sockets, ${pages} pages`);
  hub.close(); front.close(); for (const c of clients.values()) c.back.close();
  out.end(() => process.exit(0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
child.on('exit', () => { if (!stopping) stop(false); });
if (secs > 0) setTimeout(() => stop(), secs * 1000);
console.log(`[page-relay] udp 127.0.0.1:${listen} -> ${toHost}:${toPort}; pages on ws ${pageWs} -> sidecar ${sidecarWs}; ${outPath}`);
