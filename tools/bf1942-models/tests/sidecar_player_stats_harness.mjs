// A retail server's player stats, end to end: real BFPlayer bodies out of a
// live sidecar session, through the sidecar's own rebuild (body-decoder.mjs,
// ghost-writer.mjs) into k:"ps" rows, through the page's sidecar state
// (net-sidecar.js statsOf) and onto the score board's rows (scoreboard.js
// boardRows). See test_sidecar_player_stats.py.
//
// The fixture is cut from a lab session on Kursk co-op (2026-10-16): the
// createPlayer rows and every framed BFPlayer record of the first 560 s (two
// bots trading attacks and kills) and of 4200..4246 s (the human's ping
// moving), from the recording and its review log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSidecarState } from '../viewer/net-sidecar.js';
import { boardRows } from '../viewer/scoreboard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-stats-'));
const unzip = (name) => {
  const p = path.join(dir, name.replace(/\.gz$/, ''));
  fs.writeFileSync(p, zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures', name))));
  return p;
};
const rec = unzip('sidecar_player_stats.ndjson.gz');
const review = unzip('sidecar_player_stats.review.ndjson.gz');
const out = path.join(dir, 'rebuilt.ndjson');
execFileSync('node', [path.join(here, '../sidecar/rebuild.mjs'), rec, review, out]);
const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse);
fs.rmSync(dir, { recursive: true, force: true });

const res = {};
const ps = rows.filter((r) => r.k === 'ps');
res.psRows = ps.length;
res.psKeys = ps.length ? Object.keys(ps[0]).sort() : [];
// The stat rows: a row the respawn wait (sw) alone moved is left out here.
const STATS = ['sc', 'md', 'kills', 'deaths', 'teamKills', 'captures', 'attacks', 'defences',
  'objectives', 'objectiveTeamKills', 'ping'];
const statKey = (r) => JSON.stringify(STATS.map((k) => r[k] ?? 0));
const ZERO = statKey({ md: [0, 0, 0] });
const lastStat = new Map();
res.firstRows = ps.filter((r) => {
  const key = statKey(r);
  if ((lastStat.get(r.pid) ?? ZERO) === key) return false;
  lastStat.set(r.pid, key);
  return true;
}).slice(0, 6);
// The server's respawn wait (BFPlayer +0x8c) per player: [t, sw] each time it moves.
res.swTrace = {};
for (const r of ps) if (r.sw != null) (res.swTrace[r.pid] ??= []).push([Math.round(r.t * 10) / 10, r.sw]);
res.pingRows = ps.filter((r) => r.ping > 0).map((r) => ({ t: r.t, pid: r.pid, ping: r.ping }));

// The page's side: the rebuilt rows as the sidecar would stream them, read
// back at three moments.
function stateAt(t) {
  const s = createSidecarState();
  for (const r of rows) if (r.k !== 'e' || r.e === 'createPlayer' || r.e === 'setLevel') { if ((r.t ?? 0) <= t) s.ingest(r); }
  return s;
}
const players = (s, killedFeed) => {
  const list = [];
  for (const [slot, r] of s.state.roster) list.push({ slot, name: r.name, team: r.team, local: r.name === 'hprobe', stats: s.statsOf(slot) });
  return list;
};
for (const t of [300, 560, 4246]) {
  const s = stateAt(t);
  const stats = {};
  for (const [slot, r] of s.state.roster) stats[r.name] = s.statsOf(slot);
  // A feed that disagrees with the server: the board must not read it for a
  // row that carries the server's stats.
  const feed = [...s.state.roster.keys()].map((slot) => ({ type: 'killed', slot, other: null }));
  const board = boardRows(players(s), feed);
  res[`at${t}`] = {
    stats,
    board: Object.fromEntries([...board[1], ...board[2]].map((r) => [r.name, { score: r.score, kills: r.kills, deaths: r.deaths, ping: r.ping }])),
  };
}
res.unknownSlot = stateAt(560).statsOf(99);
// The page's copy of the wait (net-sidecar.js st.spawnWait), as the plate reads it.
res.pageWait = [20, 25, 36].map((t) => stateAt(t).state.spawnWait.get(0) ?? null);

// A row from a sidecar older than the named fields: `sc` and `md` alone. The
// score moves, and the counters stay where the last full row left them.
{
  const s = createSidecarState();
  s.ingest({ k: 'e', t: 0, e: 'createPlayer', pid: 3, name: 'old', team: 1, ai: 1, netId: 7 });
  s.ingest({ k: 'ps', t: 1, pid: 3, sc: 5, md: [0, 0, 0], kills: 2, deaths: 1, ping: 40 });
  s.ingest({ k: 'ps', t: 2, pid: 3, sc: 6, md: [0, 0, 0] });
  res.legacy = s.statsOf(4);
}
console.log(JSON.stringify(res));
