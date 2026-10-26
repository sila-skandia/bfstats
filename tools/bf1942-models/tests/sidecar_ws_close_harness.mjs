// A page socket closing (sidecar/wsserver.mjs): a page that sends a close
// frame, one that just drops the TCP connection, and one the server closes,
// each counted as the sidecar sees them ('close' events). Prints one JSON
// object for test_sidecar_cli.py.
import net from 'node:net';
import { WSServer } from '../sidecar/wsserver.mjs';

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const upgrade = Buffer.from(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade',
  `Sec-WebSocket-Key: ${KEY}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'), 'latin1');
const closeFrame = Buffer.from([0x88, 0x80, 1, 2, 3, 4]);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(how) {
  const server = new WSServer({ port: 0 });
  let closes = 0, sockets = [];
  server.on('connection', (ws) => { sockets.push(ws); ws.on('close', () => { closes++; }); });
  const { port } = await server.listen();
  const c = net.connect(port, '127.0.0.1');
  c.on('error', () => {});
  await new Promise((r) => c.on('connect', r));
  c.write(upgrade);
  await delay(100);
  if (how === 'frame') c.write(closeFrame);
  if (how === 'drop') c.destroy();
  if (how === 'server') sockets[0].close();
  await delay(300);
  c.destroy();
  await delay(100);
  server.close();
  return { closes, clients: server.clients.size };
}

const out = {};
for (const how of ['frame', 'drop', 'server']) out[how] = await run(how);
console.log(JSON.stringify(out));
process.exit(0);
