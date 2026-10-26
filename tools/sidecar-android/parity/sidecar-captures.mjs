// The sidecar replays of whole live sessions (parity/live/page-relay.mjs
// captures): each capture's server datagrams, page frames and SIGINT are fed,
// on their recorded times, to the real sidecar.mjs under the fake clock
// (lib/sidecar-run.mjs), and the transcript is written for the Kotlin side to
// match (SidecarCapturesTest.kt for the big ones, SidecarTest.kt for the
// committed slices in resources/parity/captures/).
//
//   node parity/sidecar-captures.mjs              # the committed slices
//   node parity/sidecar-captures.mjs ~/.cache/bfstats-parity   # whole captures, kept out of git
//
// A capture folder holds capture.ndjson (page-relay.mjs's) and, written here
// the first time from this PC's install, cache/<mod>/<level>-<mode>.baked.json.gz
// for every level the session loaded (from the sidecar's own recording,
// live.ndjson, or the capture's console lines). The transcript goes to
// transcript.json.gz beside them. A slice is a capture folder under
// resources/parity/captures/ whose capture.ndjson.gz is cut with
// live/trim-capture.mjs; its tables are committed with it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RES, writeGz, gunzip, ensureTables, scratchCache, bakeFromInstall } from './lib/tables.mjs';
import { runScenario, KEY } from './lib/sidecar-run.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2].replace(/^~/, os.homedir())) : path.join(RES, 'captures');
if (!fs.existsSync(root)) { console.log(`no captures under ${root}`); process.exit(0); }

const readLines = (f) => (f.endsWith('.gz') ? gunzip(f) : fs.readFileSync(f, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The levels a capture loaded: [mod, level, mode] as the cache keys them. */
function levelsOf(rows, dir) {
  const out = new Map();
  const add = (mod, levelPath, modeFile) => {
    const level = String(levelPath).replace(/\/+$/, '').split('/').pop().toLowerCase();
    const mode = String(modeFile).replace(/\.con$/i, '').toLowerCase();
    out.set(`${mod}|${level}|${mode}`, [mod.toLowerCase(), level, mode]);
  };
  const live = path.join(dir, 'live.ndjson');
  if (fs.existsSync(live)) {
    let mod = null;
    for (const r of readLines(live)) {
      if (r.e === 'serverInfo') mod = r.mod;
      if (r.e === 'setLevel') add(mod ?? 'bf1942', r.level, r.mode);
    }
  }
  for (const r of rows) {
    const m = r.k === 'log' && /^\[sidecar\] loading (\S+) (\S+) \(mod (\S+)\)/.exec(r.line);
    if (m) add(m[3], m[1], m[2]);
  }
  return [...out.values()];
}

/** The scenario a capture replays as: its server datagrams per client socket,
 *  its pages, its SIGINT, on the clock of the first datagram out. */
// The datagram types whose header carries an ack (netconn.mjs: PingRequest,
// PingResponse, Data).
const ACKED = new Set([7, 8, 0xf]);
export function scenarioOf(rows) {
  const head = rows.find((r) => r.k === 'capture');
  const t0 = rows.find((r) => r.dir === 'out').t;
  const at = (t) => Math.max(0, +(t - t0).toFixed(3));
  const steps = [];
  for (const r of rows) {
    // The server's acknowledgements name the live run's sequence numbers; the
    // replay's own can drift from them (a word's 30 Hz slot falls a little
    // differently), so a Data or ping datagram acks what the replay sent, as
    // the fake server of the synthetic scenarios does.
    if (r.dir === 'in') steps.push({ t: at(r.t), op: 'udp', c: r.c, hex: r.hex, ...(ACKED.has(parseInt(r.hex.slice(4, 5), 16)) ? { ack: 'auto' } : {}) });
    else if (r.op === 'pageOpen' || r.op === 'pageClose') steps.push({ t: at(r.t), op: r.op, sock: r.sock });
    else if (r.op === 'pageText') steps.push({ t: at(r.t), op: 'pageText', sock: r.sock, text: r.text });
    else if (r.op === 'pageBin') steps.push({ t: at(r.t), op: 'pageBin', sock: r.sock, hex: r.hex });
    else if (r.op === 'sigint') steps.push({ t: at(r.t), op: 'sigint' });
  }
  const last = steps.length ? steps.at(-1).t : 0;
  steps.push({ t: +(last + 1000).toFixed(3), op: 'end' });
  // The live command line, less its files and its key (the replay's own).
  const args = [];
  for (let i = 0; i < head.args.length; i++) {
    const a = head.args[i];
    if (a === '--out' || a === '--review' || a === '--cdkey') { i++; continue; }
    args.push(a);
  }
  args.push('--cdkey', KEY);
  return { args, seed: 1942, steps };
}

ensureTables();
for (const name of fs.readdirSync(root).sort()) {
  const dir = path.join(root, name);
  const capFile = ['capture.ndjson', 'capture.ndjson.gz'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!capFile) continue;
  const rows = readLines(capFile);
  const tablesDir = path.join(dir, 'cache');
  for (const [mod, level, mode] of levelsOf(rows, dir)) {
    const f = path.join(tablesDir, mod, `${level}-${mode}.baked.json.gz`);
    if (fs.existsSync(f)) continue;
    const text = bakeFromInstall([mod, level, mode]);
    if (!text) { console.log(`${name}: no tables for ${mod} ${level} ${mode} (the replay runs without them)`); continue; }
    writeGz(f, text);
    console.log(`${name}: baked ${mod} ${level} ${mode}`);
  }
  const sc = scenarioOf(rows);
  const cache = scratchCache(true, fs.existsSync(tablesDir) ? tablesDir : null);
  const t = Date.now();
  const lines = runScenario(name, sc, cache);
  fs.rmSync(cache, { recursive: true, force: true });
  // The steps are not kept: SidecarCapturesTest builds them from the capture
  // as scenarioOf does.
  writeGz(path.join(dir, 'transcript.json.gz'), JSON.stringify({ args: [...sc.args, '--out', 'OUT', '--review', 'REVIEW'], seed: sc.seed, lines }));
  console.log(`${name}: ${sc.steps.length} steps, ${lines.length} lines (${Date.now() - t} ms)`);
}
