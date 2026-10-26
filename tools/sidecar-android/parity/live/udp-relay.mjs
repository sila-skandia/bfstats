#!/usr/bin/env node
// A UDP relay that sits between a sidecar and a BF1942 server and logs every
// datagram both ways with its time, so a real join can be replayed into the
// Node and Kotlin sessions (parity/session.mjs). Nothing in the sidecar
// changes: point it at the relay instead of the server.
//
//   node parity/udp-relay.mjs --listen 14600 --to 127.0.0.1:14568 --out capture.ndjson
//   node sidecar/sidecar.mjs 127.0.0.1:14600 ...
//
// One line per datagram: {t, dir, hex}, `t` in ms since the relay started
// (performance.now), `dir` "out" for client -> server and "in" for
// server -> client. A first line {k:"relay", to, listen} heads the file.
// SIGINT (or SIGTERM) closes the file.
import dgram from 'node:dgram';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const listen = Number(opt('listen', 14600));
const [toHost, toPortStr] = String(opt('to', '127.0.0.1:14568')).split(':');
const toPort = Number(toPortStr);
const outPath = opt('out', 'capture.ndjson');
if (toPort === 14567) { console.error('14567 is server1; refusing'); process.exit(2); }

const out = fs.createWriteStream(outPath);
const t0 = performance.now();
const t = () => +(performance.now() - t0).toFixed(3);
out.write(JSON.stringify({ k: 'relay', to: `${toHost}:${toPort}`, listen }) + '\n');

const front = dgram.createSocket('udp4');   // the sidecar talks to this
const back = dgram.createSocket('udp4');    // this talks to the server
let client = null;                          // the sidecar's address, from its first datagram
let n = { out: 0, in: 0 };

front.on('message', (msg, rinfo) => {
  if (!client || client.port !== rinfo.port || client.address !== rinfo.address) {
    client = { address: rinfo.address, port: rinfo.port };
    out.write(JSON.stringify({ k: 'client', t: t(), ...client }) + '\n');
  }
  out.write(JSON.stringify({ t: t(), dir: 'out', hex: msg.toString('hex') }) + '\n');
  n.out++;
  back.send(msg, toPort, toHost);
});
back.on('message', (msg) => {
  out.write(JSON.stringify({ t: t(), dir: 'in', hex: msg.toString('hex') }) + '\n');
  n.in++;
  if (client) front.send(msg, client.port, client.address);
});

front.bind(listen, '127.0.0.1', () => console.log(`[relay] 127.0.0.1:${listen} -> ${toHost}:${toPort}, logging to ${outPath}`));
back.bind(0);

const stop = () => {
  console.log(`[relay] ${n.out} out, ${n.in} in`);
  front.close(); back.close();
  out.end(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
