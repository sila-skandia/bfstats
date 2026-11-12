// A match on the page itself, headless, read through the page's own test
// hooks (features/bot-map-generation, section 20).
//
//   node sim/pagematch.mjs --map The_Maze --mod community [--seconds 600] [--bots 16]
//   node sim/pagematch.mjs --url "<a map.html URL>" [--seconds 600]
//   node sim/pagematch.mjs bar --levels Berlin,Stalingrad,Kharkov,Bocage [--matches 3] [--out sim/baselines/page-dice.json]
//   node sim/pagematch.mjs check --map The_Maze --mod community [--matches 3] [--bar sim/baselines/page-dice.json] [--out <file>]
//
// `bar` plays DICE's own levels on the page and keeps, for each figure, the
// worst any of those matches showed. `check` plays a published level the
// same way and holds the median of its matches to that: what the runner's
// verdict cannot see is judged where the player meets it.
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

/**
 * A match in which nobody was killed and nobody died by any hand in ten
 * minutes. On a level with a fight that is a round that never got going
 * (the READY click landed before the button did, or the page stalled with
 * several matches playing side by side), so `pageMatch` plays it once more
 * and says so (`replayed`); a level that is void twice is void, and its
 * figures stand.
 *
 * Captures do not make a match: DC_Basrah_Nights, the liveliest generated
 * level live, once showed 2 captures, no kill and tickets untouched at
 * 106:106 in a match played beside four others, and 0.75 enemy kills a
 * bot-minute with 13 captures when played again (2026-11-11).
 */
export const isVoid = m => !m.enemyKillsPerBotMinute && !m.teamKillsPerBotMinute && !m.suicidesPerBotMinute;

export async function pageMatch(options) {
  const first = await playOnce(options);
  if (!isVoid(first)) return first;
  return { ...await playOnce(options), replayed: true };
}

async function playOnce({ url, seconds = 600, loadTimeout = 240 }) {
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
    // READY: the local player stays on the deploy screen. The round waits for it, so the click is made again
    // until a bot has moved (a click that lands before the button is drawn starts nothing).
    const where = () => page.evaluate(() => JSON.stringify(window.__bots().map(b => b.pos ?? null)));
    for (let tries = 0; tries < 4; tries++) {
      const before = await where();
      await page.mouse.click(392, 438);
      await page.waitForTimeout(8000);
      if (await where() !== before) break;
    }
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

/** The figures a page match is held to, and which way is worse. */
export const PAGE_CHECKS = [
  ['teamKillsPerBotMinute', 'max'], ['suicidesPerBotMinute', 'max'], ['nonEnemyDeathShareWorseSide', 'max'], ['enemyKillsPerBotMinute', 'min'],
];

const median = xs => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

/**
 * The bar from page matches of DICE's own levels: for each figure the worst
 * any one match showed (the most team kills, the fewest enemy kills). The
 * page is not seeded and a match is ten minutes, so this is a ceiling a
 * generated level's median must stay under, not a percentile.
 */
export function buildPageBar(matches, note = '') {
  const bar = {};
  for (const [k, worst] of PAGE_CHECKS) {
    const xs = matches.map(m => m[k]).filter(Number.isFinite);
    bar[k] = { worst, limit: xs.length ? (worst === 'max' ? Math.max(...xs) : Math.min(...xs)) : null, median: median(xs) };
  }
  return { note, matches: matches.map(m => ({ level: m.level, minutes: m.minutes, ...Object.fromEntries(PAGE_CHECKS.map(([k]) => [k, m[k]])), capturesTotal: m.capturesTotal })), bar };
}

/** A published level's page matches against the bar: the median of each figure, no worse than DICE's worst match. */
export function judgePage(matches, pageBar) {
  const checks = PAGE_CHECKS.map(([k, worst]) => {
    const value = median(matches.map(m => m[k]).filter(Number.isFinite)), limit = pageBar?.bar?.[k]?.limit ?? null;
    const pass = value == null || limit == null ? null : worst === 'max' ? value <= limit : value >= limit;
    return { metric: k, median: value, bar: limit == null ? 'not measured' : `${worst === 'max' ? '<=' : '>='} ${limit}`, pass };
  });
  const failed = checks.filter(c => c.pass === false).map(c => c.metric);
  return { verdict: failed.length ? 'fail' : 'pass', failed, checks, matches: matches.length };
}

/**
 * The owner's rollout floor (2026-11-11, features/bot-map-generation/
 * page-matches.md section 6): whether one page match shows enough of a fight
 * for a generated layer to keep its menu flag. INVENTION, the coordinator's
 * rule under the owner's "roll them out":
 *  - some killing always, and either real killing (0.15 enemy kills a
 *    bot-minute), or flag play with a little (3 captures and 0.03), or some
 *    of both (0.05 and 1 capture). Flags alone are not a fight: FHSW's Fall
 *    of Berlin took 7 with no enemy kill;
 *  - at most 0.10 deaths a bot-minute by a bot's own or its side's hand
 *    (suicides and team kills; DICE's worst match shows 0.056 and 0.025),
 *    or, on a level with more killing than that allows for, no more than a
 *    third of its enemy kills (2026-11-12: DICE's own levels on the page
 *    run to 0.31, Berlin 0.080 of 0.268 and Kharkov 0.080 of 0.259; the
 *    flat cap alone turned down Happy Saint Patrick's Day at 0.58 enemy
 *    kills for 0.119 by its own hand, a better ratio than Berlin's). The
 *    second clause only ever applies above 0.30 enemy kills a bot-minute,
 *    so it is never a share of a handful of deaths: with few deaths a share
 *    is noise (Red Square read 1.00 on one death);
 *  - no page error.
 * `{ pass, why }`, `why` the clauses it fails.
 */
export const ROLLOUT_FLOOR = Object.freeze({ kills: 0.15, killsWithFlags: 0.03, flags: 3, killsWithAFlag: 0.05, ownHand: 0.10, ownHandOfKills: 1 / 3 });
export function rolloutFloor(m, floor = ROLLOUT_FLOOR) {
  const k = m.enemyKillsPerBotMinute ?? 0, c = m.capturesTotal ?? 0;
  const own = (m.suicidesPerBotMinute ?? 0) + (m.teamKillsPerBotMinute ?? 0);
  const why = [];
  if (!(k >= floor.kills || (k >= floor.killsWithFlags && c >= floor.flags) || (k >= floor.killsWithAFlag && c >= 1))) why.push('activity');
  if (own > floor.ownHand && !(own <= k * (floor.ownHandOfKills ?? 0))) why.push('ownHand');
  if ((m.pageErrors ?? []).length) why.push('pageErrors');
  return { pass: !why.length, why, enemyKills: k, captures: c, ownHand: +own.toFixed(4) };
}

/** `n` matches of one URL, a few at a time (each is a browser playing in real time). */
async function playMany(url, n, seconds, parallel = 3) {
  const out = [];
  for (let i = 0; i < n; i += parallel) {
    out.push(...await Promise.all(Array.from({ length: Math.min(parallel, n - i) }, () => pageMatch({ url, seconds }))));
  }
  return out;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = ['bar', 'check', 'rescore'].includes(process.argv[2]) ? process.argv[2] : null;
  const a = parseArgs(process.argv.slice(cmd ? 3 : 2));
  const { readFileSync, writeFileSync } = await import('node:fs');
  if (cmd === 'rescore') {
    // Ask today's floor of a page.json's matches again, in place. `--earlier <page.json>` puts that file's
    // matches in front (an earlier match of the same level the last `check` wrote over); with `--old-code
    // "<what changed>"` they are kept for the record and not counted, having been played on other bot code.
    if (!a.file) { console.error('rescore: --file <page.json> [--earlier <page.json> [--old-code "<what changed since>"]]'); process.exit(2); }
    const file = path.resolve(a.file), page = JSON.parse(readFileSync(file, 'utf8'));
    const earlier = a.earlier ? JSON.parse(readFileSync(path.resolve(a.earlier), 'utf8')).runs.map(r => ({ ...r, ...(a['old-code'] ? { oldCode: String(a['old-code']) } : {}) })) : [];
    const same = (x, y) => JSON.stringify({ ...x, rollout: 0, oldCode: 0 }) === JSON.stringify({ ...y, rollout: 0, oldCode: 0 });
    page.runs = [...earlier.filter(e => !page.runs.some(r => same(e, r))), ...page.runs].map(r => ({ ...r, rollout: rolloutFloor(r) }));
    page.matches = page.runs.length;
    page.rollout = { pass: page.runs.some(r => !r.oldCode && r.rollout.pass), floor: ROLLOUT_FLOOR };
    writeFileSync(file, JSON.stringify(page, null, 1) + '\n');
    console.log(`${page.level}: ${page.rollout.pass ? 'PASS' : 'FAIL'} | ${page.runs.map(r => `${r.oldCode ? '(old code) ' : ''}kills ${r.enemyKillsPerBotMinute} captures ${r.capturesTotal} own-hand ${r.rollout.ownHand}${r.rollout.pass ? '' : ' ' + JSON.stringify(r.rollout.why)}`).join('; ')}`);
    process.exit(0);
  }
  const BAR_FILE = path.join(HERE, 'baselines', 'page-dice.json');
  const slim = m => { const { teamKills, ticketsOverTime, generated, ...rest } = m; return { ...rest, generated: generated ? { version: generated.version, template: generated.template ?? null } : null }; };
  if (cmd === 'bar') {
    const levels = String(a.levels ?? 'Berlin,Stalingrad,Kharkov,Bocage').split(','), n = Number(a.matches ?? 3), seconds = Number(a.seconds ?? 600);
    // The levels side by side, one match of each at a time.
    const rounds = [];
    for (let i = 0; i < n; i++) rounds.push(...await Promise.all(levels.map(map => pageMatch({ url: matchUrl({ site: a.site ?? SITE, map, bots: Number(a.bots ?? 16) }), seconds }))));
    const bar = buildPageBar(rounds.map(slim), `DICE levels on the page, ${n} matches each of ${seconds} s, ${Number(a.bots ?? 16)} bots: ${levels.join(', ')}; ${new Date().toISOString().slice(0, 10)}`);
    writeFileSync(path.resolve(a.out ?? BAR_FILE), JSON.stringify(bar, null, 1) + '\n');
    console.log(JSON.stringify(bar.bar, null, 1));
    process.exit(0);
  }
  if (cmd === 'check') {
    if (!a.map) { console.error('check: --map <Level> [--mod <mod>]'); process.exit(2); }
    const url = matchUrl({ site: a.site ?? SITE, map: a.map, mod: a.mod ?? null, mode: a.mode ?? 'Conquest', bots: Number(a.bots ?? 16) });
    const bar = JSON.parse(readFileSync(path.resolve(a.bar ?? BAR_FILE), 'utf8'));
    const matches = (await playMany(url, Number(a.matches ?? 3), Number(a.seconds ?? 600))).map(slim);
    // The rollout floor is asked of each match; the level keeps its flag when any one passes (page-matches.md, section 6).
    const result = { level: a.map, mod: a.mod ?? 'bf1942', url, date: new Date().toISOString().slice(0, 10), bar: bar.note, ...judgePage(matches, bar),
                     rollout: { pass: matches.some(m => rolloutFloor(m).pass), floor: ROLLOUT_FLOOR },
                     runs: matches.map(m => ({ generated: m.generated, minutes: m.minutes, tickets: m.tickets, capturesTotal: m.capturesTotal, ...Object.fromEntries(PAGE_CHECKS.map(([k]) => [k, m[k]])),
                                               rollout: rolloutFloor(m), ...(m.replayed ? { replayed: true } : {}), ...(m.pageErrors?.length ? { pageErrors: m.pageErrors } : {}),
                                               teamKillsBySide: Object.fromEntries(Object.entries(m.sides).map(([t, s]) => [t, s.teamKills])) })) };
    if (a.out) writeFileSync(path.resolve(a.out), JSON.stringify(result, null, 1) + '\n');
    console.log(JSON.stringify(result, null, 1));
    process.exit(result.verdict === 'pass' ? 0 : 1);
  }
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
