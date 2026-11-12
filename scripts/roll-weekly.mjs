#!/usr/bin/env node
// The week's action roll (features/action-roll; the owner, 2026-11-12: "for
// the recurring job to film these, we only need them once a week"). Run by
// shorts-nightly.sh on the first night of each ISO week.
//
// Picks the round to film: of the recordings shared in the last 7 days, those
// at least 5 minutes long and with no roll yet (the API's keys name a roll's
// kill as <recording>:<start>:-10, a pruned one's too), the most players
// first, the newest on a tie. Films it with scripts/action-roll.mjs (90 s,
// 4K and HD, sound) and uploads it with its link copy. A take that fails
// moves on to the next round, three at most.
//
//   SHORTS_UPLOAD_KEY=... node scripts/roll-weekly.mjs [--dry-run] [--count=1]
//       [--days=7] [--channel=chrome] [--api=https://bfstats.io]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const API = opt('api', 'https://bfstats.io');
const DAYS = Number(opt('days', 7));
const COUNT = Number(opt('count', 1));
const DRY = args.includes('--dry-run');
const MIN_SECONDS = 300;
const TRIES = 3;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function json(u) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
      throw new Error(`${res.status}`);
    } catch (e) {
      if (i >= 3) throw new Error(`${u}: ${e.message}`);
      await new Promise(ok => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}

/** The week's recordings, newest first, until one is older than the window. */
async function recent() {
  const since = Date.now() - DAYS * 86400e3;
  const found = [];
  for (let page = 1; page <= 20; page++) {
    const { items, totalPages } = await json(`${API}/stats/recordings?page=${page}&pageSize=50`);
    for (const r of items) if (Date.parse(r.createdAt) >= since) found.push(r);
    if (!items.length || page >= totalPages || items.every(r => Date.parse(r.createdAt) < since)) break;
  }
  return found;
}

/** Whether a roll was ever made of the recording, pruned or live. */
async function rolled(slug) {
  const { keys } = await json(`${API}/stats/shorts/keys?recording=${encodeURIComponent(slug)}`);
  return (keys ?? []).some(k => k.endsWith(':-10'));
}

/** The candidates in the order they are tried. Exported for the test. */
export function rank(recordings) {
  return recordings
    .filter(r => (r.durationSeconds ?? 0) >= MIN_SECONDS)
    .sort((a, b) => (b.playerCount ?? 0) - (a.playerCount ?? 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ranked = rank(await recent());
  const fresh = [];
  for (const r of ranked) {
    if (fresh.length >= COUNT + TRIES) break;
    if (!(await rolled(r.slug))) fresh.push(r);
  }
  log(`${ranked.length} rounds of ${DAYS} days long enough; ${fresh.length} without a roll looked at`);
  for (const r of fresh) log(`  ${r.slug} ${r.title} (${r.playerCount} players, ${Math.round(r.durationSeconds / 60)} min)`);
  if (DRY) process.exit(0);
  if (!process.env.SHORTS_UPLOAD_KEY) throw new Error('needs SHORTS_UPLOAD_KEY');

  const week = new Date().toISOString().slice(0, 10);
  let made = 0;
  for (const [i, r] of fresh.entries()) {
    if (made >= COUNT || i >= COUNT + TRIES) break;
    log(`filming ${r.slug} ${r.title}`);
    const run = spawnSync('node', [path.join(REPO, 'scripts/action-roll.mjs'), `--recording=${r.slug}`, '--length=90', '--gpu', '--sound',
      '--upload', `--name=weekly-${week}-${r.slug}`, `--api=${API}`,
      ...(opt('channel', null) ? [`--channel=${opt('channel')}`] : [])], { stdio: 'inherit', cwd: REPO });
    if (run.status === 0) made++;
    else log(`  ${r.slug} failed (exit ${run.status}); the next round`);
  }
  log(`the week's rolls: ${made} made`);
  process.exit(made > 0 || !fresh.length ? 0 : 1);
}
