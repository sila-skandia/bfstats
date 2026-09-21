// The P2/P3 dev rig: one command to run the room server AND a static server
// with the production route in miniature (everything under `/netcode` — the
// rooms list and the WebSocket — proxied to the room server), the way the
// play site's HAProxy does it. Open the printed URL, click PLAY ONLINE on
// the Instant Battle screen, or go straight into a room with
// `map.html?room=MYROOM&name=You&map=aberdeen` in two browsers.
//
//   node server/dev.mjs [--static-port 8000] [--netcode-port 8080]
//                       [--level aberdeen] [--viewer viewer]
//
// The servers die together on Ctrl-C; no strays (the smoke's proven
// cleanup law).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootStatic } from '../tests/p2_two_browser_smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const of = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : fallback;
};
const STATIC_PORT = Number(of('--static-port', 8000));
const NET_PORT = Number(of('--netcode-port', 8080));
const LEVEL = of('--level', 'aberdeen');
const VIEWER = path.resolve(of('--viewer', path.join(ROOT, 'viewer')));

const kids = [];
const boot = (cmd) => {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', d => process.stdout.write(`[${cmd[0]}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${cmd[0]}] ${d}`));
  kids.push(child);
  return child;
};

const teardown = () => {
  for (const child of kids) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  try { statik?.close(); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGINT', teardown);
process.on('SIGTERM', teardown);

boot(['node', path.join(ROOT, 'server', 'server.mjs'),
  '--port', String(NET_PORT), '--viewer', VIEWER, '--default-level', LEVEL]);
const statik = bootStatic(STATIC_PORT, VIEWER, NET_PORT);

await new Promise(r => setTimeout(r, 1200));
const host = `http://127.0.0.1:${STATIC_PORT}`;
console.log(`
  netcode ready:
    play page   ${host}/play/
    straight in ${host}/map.html?room=MYROOM&name=You&map=${LEVEL}
    room list   ${host}/netcode/rooms
  (the second browser opens the same straight-in URL, same room code)
`);