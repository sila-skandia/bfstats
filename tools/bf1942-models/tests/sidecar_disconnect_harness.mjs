// The sidecar's goodbye (`sidecar/netconn.mjs` disconnect + close): three
// Disconnects reach the server even though the socket is closed straight
// after. Prints the count for `tests/test_sidecar_disconnect.py`.
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { NetConnection } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'netconn.mjs')).href);

const srv = dgram.createSocket('udp4');
const types = [];
srv.on('message', (m) => types.push(m[2] >> 4));
srv.bind(0, '127.0.0.1', () => {
  const c = new NetConnection('127.0.0.1', srv.address().port, { log: () => {} });
  c.state = 'connected';
  c.disconnect(0xd, '');
  c.close();
  setTimeout(() => { process.stdout.write(JSON.stringify({ types })); srv.close(); }, 300);
});
