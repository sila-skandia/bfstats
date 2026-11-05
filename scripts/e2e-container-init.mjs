// PID 1 of verify.sh's Playwright container.
//
//   node e2e-container-init.mjs --port <ui port> [--relay] -- <command> [args...]
//
// It does three things, on Linux and macOS alike, so CI runs the init a Mac runs.
//
// 1. Waits, for up to 15 s, until the UI answers from inside the container, and
//    says why if it never does. verify.sh has already seen the UI answer on the
//    host, so silence here means the container cannot see the host's loopback,
//    and every test would otherwise fail on an empty response.
//
// 2. Lets Ctrl+C stop the run. A terminal's Ctrl+C signals the whole foreground
//    process group, but `docker run` forwards it to PID 1 alone, and
//    `npx playwright test` is npm running a shell running Playwright: a signal
//    to npm never reached Playwright, so the suite ran to the end before
//    verify.sh could clean up. This runs the command in a process group of its
//    own and passes each signal to all of it, as the terminal would.
//
// 3. --relay, the fallback for Docker on macOS other than Colima (Docker
//    Desktop, OrbStack). Docker there runs containers in a VM, so
//    `--network host` is the VM's network. With --relay the container runs on
//    Docker's default network and this listens on its own 127.0.0.1:<port>,
//    piping each connection to the same port on the host (E2E_RELAY_TARGET,
//    default host.docker.internal). Plain TCP, so the browser still loads
//    http://127.0.0.1:<port>: Vite's allowed-hosts check sees the same Host
//    header, the page is still a secure context (host.docker.internal is not
//    one, and would switch off crypto.subtle), and the JWT audience matches.
//    Colima does not use this: its user-mode network loses requests under a
//    browser's load, so verify.sh tunnels the port into the VM over ssh instead
//    (features/verify-on-macos/README.md).
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';

function usage() {
  console.error('usage: node e2e-container-init.mjs --port <ui port> [--relay] -- <command> [args...]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let port = 0;
let relayMode = false;
while (argv.length && argv[0] !== '--') {
  const flag = argv.shift();
  if (flag === '--port') port = Number(argv.shift());
  else if (flag === '--relay') relayMode = true;
  else usage();
}
if (!port || argv[0] !== '--' || !argv[1]) usage();
const [command, ...args] = argv.slice(1);
const target = relayMode ? (process.env.E2E_RELAY_TARGET || 'host.docker.internal') : '127.0.0.1';

function answers(host) {
  return new Promise(resolve => {
    const probe = net.connect({ port, host });
    probe.setTimeout(2000);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('timeout', () => { probe.destroy(); resolve(false); });
    probe.once('error', () => resolve(false));
  });
}

const deadline = Date.now() + 15_000;
while (!(await answers(target))) {
  if (Date.now() > deadline) {
    console.error(`e2e-container-init: nothing answers on ${target}:${port} from inside the container.`);
    console.error('  The UI is up on the host, so the container cannot see the host loopback.');
    console.error(relayMode
      ? '  Set E2E_RELAY_TARGET to an address that reaches it.'
      : '  On macOS, check the tunnel log verify.sh names, or try E2E_PW_NETWORK=relay.');
    process.exit(1);
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}

if (relayMode) {
  const server = net.createServer({ allowHalfOpen: true }, client => {
    const upstream = net.connect({ port, host: target, allowHalfOpen: true });
    const drop = () => { client.destroy(); upstream.destroy(); };
    client.on('error', drop);
    upstream.on('error', drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

// detached: the command leads a process group of its own, so -pid reaches
// npm, the shell it starts, Playwright and Playwright's workers.
const child = spawn(command, args, { stdio: 'inherit', detached: true });
child.on('error', err => {
  console.error(`e2e-container-init: ${command}: ${err.message}`);
  process.exit(127);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is already gone; 'exit' follows.
    }
  });
}
child.on('exit', (code, signal) => {
  process.exit(code ?? 128 + (os.constants.signals[signal] ?? 1));
});
