// A match on the page itself, headless, read through the page's own test
// hooks (features/bot-map-generation, section 20).
//
//   node sim/pagematch.mjs --map The_Maze --mod community [--seconds 600] [--bots 16]
//   node sim/pagematch.mjs --url "<a map.html URL>" [--seconds 600]
//
// The runner (`sim/run.mjs`) plays the page's bot code on stand-ins. This
// plays the published level on the published page, so it answers what the
// runner cannot: is what the runner measured what a player meets? It found,
// the first day it ran, that every community level had been judged with bots
// holding a stand-in weapon (the scratch tree's `loadouts.json` had no row
// for them), and that the page's bots kill their own side several times as
// often as the runner's.
//
// It reports, by side: kills, deaths, team kills, suicides, captures and the
// share of deaths no enemy caused; the tickets over time; and for every team
// kill who fired, what they held, how far off the victim was and how far the
// victim stood from the line between the shooter and their target.
//
// The hooks it reads (`__bots`, `__round`, `__scoreboard`) are installed
// only with `?shots` on the URL, which this adds. The local player is left
// on the deploy screen. One match is one sample: the page is not seeded.
//
// Needs Playwright (the UI's own install, `ui/node_modules`) and the network.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = 'https://play.bfstats.io';

/** The URL of a bot match on the page. `bots` is both sides together, as the page counts them. */
export function matchUrl({ site = SITE, map, mod = null, mode = 'Conquest', bots = 16, skill = 0.75, team = 2 }) {
  const q = new URLSearchParams({ map, team: String(team), mode });
  if (mod && mod !== 'bf1942') q.set('mod', mod);
  q.set('botCount', String(bots));
  q.set('botSkill', String(skill));
  return `${site}/map.html?${q}&mute&shots`;
}

/**
 * The page's own tally by side. `counts` is `__round().counts` (one row per
 * player the round has counted something for), `listed` the number of bots
 * the score board lists, `minutes` the page time played.
 *
 * A side's deaths no enemy caused are its deaths less the other side's
 * kills: team kills and suicides (a redeploy is not a death on the page).
 */
export function summarise(counts, listed, minutes) {
  // A row the round holds with no side (team 0) is kept apart: it has been
  // seen carrying captures, and belongs in the totals, not in either side.
  const sides = {}, unassigned = { counted: 0, kills: 0, deaths: 0, teamKills: 0, suicides: 0, captures: 0, score: 0 };
  for (const c of counts ?? []) {
    const s = c.team === 1 || c.team === 2
      ? (sides[c.team] ??= { counted: 0, kills: 0, deaths: 0, teamKills: 0, suicides: 0, captures: 0, score: 0 }) : unassigned;
    s.counted++;
    for (const k of ['kills', 'deaths', 'teamKills', 'suicides', 'captures', 'score']) s[k] += c[k] ?? 0;
  }
  for (const [team, s] of Object.entries(sides)) {
    const other = sides[team === '1' ? '2' : '1'];
    s.deathsNoEnemyCaused = Math.max(0, s.deaths - (other?.kills ?? 0));
    s.nonEnemyDeathShare = s.deaths ? +(s.deathsNoEnemyCaused / s.deaths).toFixed(3) : 0;
  }
  const total = k => [...Object.values(sides), unassigned].reduce((n, s) => n + s[k], 0);
  const botMinutes = Math.max(1e-9, listed * minutes);
  const worst = Math.max(0, ...Object.values(sides).map(s => s.nonEnemyDeathShare));
  return {
    sides,
    ...(unassigned.counted ? { unassigned } : {}),
    minutes: +minutes.toFixed(2),
    listed,
    enemyKillsPerBotMinute: +(total('kills') / botMinutes).toFixed(4),
    teamKillsPerBotMinute: +(total('teamKills') / botMinutes).toFixed(4),
    suicidesPerBotMinute: +(total('suicides') / botMinutes).toFixed(4),
    capturesTotal: total('captures'),
    nonEnemyDeathShareWorseSide: worst,
  };
}

/**
 * Where a team-kill victim stood against the shooter's line of fire:
 * `along` the line to the target and `off` it, in metres, in the ground
 * plane. A victim a metre off the line at most, between the two, was in the
 * way; one behind the shooter or metres to the side was not.
 */
export function onTheLine(shooter, target, victim) {
  const tx = target[0] - shooter[0], tz = target[2] - shooter[2];
  const vx = victim[0] - shooter[0], vz = victim[2] - shooter[2];
  const len = Math.hypot(tx, tz) || 1;
  return { along: +((vx * tx + vz * tz) / len).toFixed(2), off: +Math.abs((vx * tz - vz * tx) / len).toFixed(2), target: +len.toFixed(1) };
}

/** Runs in the page: samples the bots five times a second and logs each team kill. */
function installSampler() {
  const hist = new Map(), tks = new Map(), wasDead = new Map();
  window.__pm = { teamKills: [], t0: performance.now() / 1000, tickets: [] };
  let n = 0;
  setInterval(() => {
    const now = performance.now() / 1000, bots = window.__bots(), round = window.__round();
    if (!round) return;
    const by = new Map(bots.map(b => [b.id, b]));
    for (const b of bots) {
      const h = hist.get(b.id) ?? [];
      h.push({ t: now, weapon: b.weapon, firing: b.firing, target: b.target, pos: b.pos });
      while (h.length && now - h[0].t > 10) h.shift();
      hist.set(b.id, h);
    }
    const died = bots.filter(b => b.dead && !wasDead.get(b.id));
    for (const c of round.counts) {
      const had = tks.get(c.id) ?? 0;
      if ((c.teamKills ?? 0) > had) {
        const h = hist.get(c.id) ?? [], shot = h.filter(x => x.firing).at(-1) ?? h.at(-1) ?? null;
        const target = shot?.target != null ? by.get(shot.target) : null;
        window.__pm.teamKills.push({
          t: +(now - window.__pm.t0).toFixed(1), killer: c.id, team: c.team, kit: by.get(c.id)?.kit ?? null, kills: c.teamKills - had,
          fired: [...new Set(h.filter(x => x.firing).map(x => x.weapon))],
          shooter: shot?.pos ?? null, target: target?.pos ?? null, targetTeam: target?.team ?? null,
          victims: died.filter(v => v.team === c.team && v.id !== c.id).map(v => ({ id: v.id, pos: v.pos })),
        });
      }
      tks.set(c.id, c.teamKills ?? 0);
    }
    for (const b of bots) wasDead.set(b.id, b.dead);
    if (n++ % 150 === 0) window.__pm.tickets.push([Math.round(now - window.__pm.t0), round.tickets[1], round.tickets[2]]);
  }, 200);
}

export async function pageMatch({ url, seconds = 600, loadTimeout = 240 }) {
  const require = createRequire(path.join(HERE, '..', '..', '..', 'ui', 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__bots === 'function' && (window.__bots()?.length ?? 0) > 0 && !!window.__round?.(),
                               null, { timeout: loadTimeout * 1000 });
    const level = await page.evaluate(() => {
      const w = window.__world?.();
      return { level: w?.extras?.level ?? null, generated: w?.extras?.ai?.generated ?? null };
    });
    await page.mouse.click(392, 438);            // READY: the local player stays on the deploy screen
    await page.evaluate(installSampler);
    await page.waitForTimeout(seconds * 1000);
    const raw = await page.evaluate(() => {
      const r = window.__round(), rows = window.__scoreboard.rows();
      return { minutes: (performance.now() / 1000 - window.__pm.t0) / 60, counts: r.counts, tickets: r.tickets, restarts: r.restarts ?? 0,
               listed: Object.values(rows ?? {}).flat().filter(p => p.bot).length, series: window.__pm.tickets, teamKills: window.__pm.teamKills };
    });
    const teamKills = raw.teamKills.map(k => ({
      ...k, victims: k.victims.map(v => ({ id: v.id, ...(k.shooter && k.target ? onTheLine(k.shooter, k.target, v.pos) : {}),
                                           dist: k.shooter ? +Math.hypot(v.pos[0] - k.shooter[0], v.pos[2] - k.shooter[2]).toFixed(1) : null })),
    }));
    for (const k of teamKills) { delete k.shooter; delete k.target; }
    return { url, ...level, ...summarise(raw.counts, raw.listed, raw.minutes), tickets: raw.tickets, restarts: raw.restarts,
             ticketsOverTime: raw.series, teamKills, pageErrors: errors.slice(0, 5) };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.url && !a.map) {
    console.error('usage: node sim/pagematch.mjs --map <Level> [--mod <mod>] [--mode Conquest] [--bots 16] [--seconds 600] [--site https://play.bfstats.io]\n'
      + '       node sim/pagematch.mjs --url "<map.html URL>" [--seconds 600]');
    process.exit(2);
  }
  const url = a.url ? (String(a.url).includes('shots') ? a.url : `${a.url}&shots`)
    : matchUrl({ site: a.site ?? SITE, map: a.map, mod: a.mod ?? null, mode: a.mode ?? 'Conquest', bots: Number(a.bots ?? 16) });
  try {
    console.log(JSON.stringify(await pageMatch({ url, seconds: Number(a.seconds ?? 600) }), null, 1));
  } catch (e) {
    console.error(`pagematch: ${String(e).slice(0, 400)}`);
    process.exit(1);
  }
}
