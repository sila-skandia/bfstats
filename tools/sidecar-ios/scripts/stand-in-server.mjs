#!/usr/bin/env node
// A stand-in BF1942 server on 127.0.0.1 for the iPhone app's simulator smoke
// test (CI never joins a real game server): it answers the GameSpy \status\
// query on the game port + 8433, as the sidecar's pre-join look guesses it
// (ServerQuery.kt), and accepts a ConnectRequest with a ConnectAccept, then
// says nothing more. The idea is tools/sidecar-desktop/scripts/smoke-sidecar.js's.
//
//   node tools/sidecar-ios/scripts/stand-in-server.mjs --port 14600 --status /tmp/stand-in.json
//
// Every second it writes what reached it to --status: the packet types by
// count, whether the query was asked, whether the connect was acked and
// whether a Disconnect came.
import dgram from 'node:dgram';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const PORT = Number(opt('port', 14600));
const STATUS = opt('status', null);
const PT = { ConnectRequest: 1, ConnectAccept: 2, ConnectAcceptAck: 4, Disconnect: 5 };
const GAMESPY_ANSWER = '\\gamename\\bfield1942\\gameId\\bf1942\\mapname\\Wake\\gametype\\coop\\hostname\\Smoke test server\\numplayers\\0\\maxplayers\\16\\final\\';

const seen = { packets: {}, gamespyAsked: 0, connectRequests: 0, accepted: 0, acked: false, disconnected: false, from: [] };

function bind(port, onMessage) {
  const s = dgram.createSocket('udp4');
  s.on('message', (msg, rinfo) => onMessage(msg, rinfo, s));
  s.bind(port, '127.0.0.1', () => console.log(`[stand-in] listening on 127.0.0.1:${port}`));
  return s;
}

bind(PORT, (msg, rinfo, s) => {
  const type = msg.length >= 3 ? msg[2] >> 4 : -1;
  seen.packets[type] = (seen.packets[type] ?? 0) + 1;
  const from = `${rinfo.address}:${rinfo.port}`;
  if (!seen.from.includes(from)) { seen.from.push(from); console.log(`[stand-in] first datagram from ${from}`); }
  if (type === PT.ConnectRequest) {
    seen.connectRequests++;
    // ConnectAccept: [8] the connection's id, [9..12] the server's clock (netconn.mjs).
    const accept = Buffer.alloc(13);
    accept[2] = PT.ConnectAccept << 4;
    accept[8] = 1;
    accept.writeUInt32LE(1000, 9);
    s.send(accept, rinfo.port, rinfo.address);
    seen.accepted++;
    console.log('[stand-in] ConnectRequest: accepted');
  }
  if (type === PT.ConnectAcceptAck && !seen.acked) { seen.acked = true; console.log('[stand-in] ConnectAcceptAck'); }
  if (type === PT.Disconnect && !seen.disconnected) { seen.disconnected = true; console.log('[stand-in] Disconnect'); }
});

bind(PORT + 8433, (msg, rinfo, s) => {
  if (msg.toString('latin1').includes('\\status\\')) {
    seen.gamespyAsked++;
    s.send(Buffer.from(GAMESPY_ANSWER, 'latin1'), rinfo.port, rinfo.address);
    console.log('[stand-in] answered the GameSpy \\status\\ query');
  }
});

if (STATUS) setInterval(() => fs.writeFileSync(STATUS, JSON.stringify(seen, null, 2)), 1000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (STATUS) fs.writeFileSync(STATUS, JSON.stringify(seen, null, 2)); process.exit(0); });
