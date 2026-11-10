// Score a level's detector rows against a baseline built from DICE's own
// layers run the same way (features/bot-map-generation, section 6.2). The
// bar is the baseline's spread, fixed here before any level is judged:
// a rate must be no worse than the baseline's 90th percentile, a count no
// lower than its 10th, and the outcome checks must hold.
//
// A rate over both sides halves a fault only one side has, so the rates a
// side can be told apart on are also judged on the worse side's figure,
// against the baseline's own worse-side spread (`WORSE_SIDE`).

export const LOWER_IS_BETTER = [
  'stuckSecondsPerBotMinute', 'idleShare', 'oscillationsPerBotMinute', 'selfDeathsPerBotMinute',
  'spawnTrapsPerBotMinute', 'routeFailuresPerBotMinute', 'redeploysPerBotMinute', 'teamKillsPerBotMinute',
];
export const HIGHER_IS_BETTER = ['capturesTotal', 'enemyKillsPerBotMinute'];
/**
 * The worse side's figure of each movement rate, and of the share of a
 * side's deaths and redeploys that no enemy caused (`detect.mjs
 * sideFigures`). Lower is better; the bar is the 90th percentile of the
 * baseline runs' own worse-side figures.
 */
export const WORSE_SIDE = [
  'stuckSecondsPerBotMinuteWorseSide', 'spawnTrapsPerBotMinuteWorseSide', 'routeFailuresPerBotMinuteWorseSide',
  'redeploysPerBotMinuteWorseSide', 'nonEnemyDeathShareWorseSide',
];
/**
 * The figures of a match played with the level's vehicles in (`detect.mjs
 * vehicleFigures`) that are judged, lower is better, by the same rule and
 * only against a baseline that carries them (`baselines/vehicles-dice.json`).
 */
export const VEHICLE_LOWER = [
  'hullStuckSecondsPerDrivingMinute', 'hullStuckSecondsPerDrivingMinuteWorseSide', 'unitsNeverUsedShare', 'tankSilentShare',
];
/**
 * Kept in a vehicles baseline for the reader and never judged. The mounted
 * share is context. Team kills from a seat have no bar to be held to: the
 * DICE runs made one in sixty matches (0 at the 10th, 50th and 90th
 * percentile at both sizes), and a bar of nothing with no spread fails a
 * level for a single one.
 */
export const VEHICLE_CONTEXT = ['mountedTeamKillsPerBotMinute', 'mountedShare'];
/** The most a share can be. A bar there can never fail, so it is no bar. */
export const SHARE_CEILING = 1;

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function spread(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  const r = x => (x === null ? null : +x.toFixed(4));
  return { n: v.length, min: r(v[0] ?? null), p10: r(quantile(v, 0.1)), p50: r(quantile(v, 0.5)), p90: r(quantile(v, 0.9)), max: r(v[v.length - 1] ?? null) };
}

/** The share of a level's capturable flags that changed hands in at least one of its matches. */
export function unionCoverage(rows, unreachable = []) {
  // A flag no soldier can stand inside (the lint's `unreachable`) is reported
  // apart and left out of the count: no layer can make bots take it.
  const out = new Set(unreachable.map(n => String(n).toLowerCase()));
  const skipped = new Set();
  let never = null;
  for (const r of rows) {
    const s = new Set();
    for (const n of r.flagsNeverChanged ?? []) (out.has(String(n).toLowerCase()) ? skipped : s).add(n);
    never = never === null ? s : new Set([...never].filter(n => s.has(n)));
  }
  const capturable = Math.max(0, ...rows.map(r => r.capturable ?? 0)) - skipped.size;
  if (capturable <= 0) return null;
  return { coverage: +(1 - (never?.size ?? 0) / capturable).toFixed(3), never: [...(never ?? [])], unreachable: [...skipped] };
}

/** How the rounds went by side: `[axis wins, allied wins, draws]`, and whether one side took every one. */
export function balance(rows) {
  const split = [1, 2, null].map(w => rows.filter(r => (r.winner ?? null) === w).length);
  return { split, oneSided: rows.length > 1 && (split[0] === rows.length || split[1] === rows.length) ? (split[0] ? 1 : 2) : null };
}

/**
 * The levels of a baseline's rows that have a fight by the alive checks at
 * every side size, and the ones dropped with what they fail: a level nobody
 * fights on is no standard (section 18.5 dropped Battleaxe and Wake the same
 * way). `{ alive: [level], dropped: [{ level, failed: ['8:bothSidesKill', ...] }] }`.
 */
export function aliveLevels(rows) {
  const alive = [], dropped = [];
  for (const level of [...new Set(rows.map(r => r.level))].sort()) {
    const mine = rows.filter(r => r.level === level);
    const failed = [...new Set(mine.map(r => r.botsPerSide))].sort((a, b) => a - b)
      .flatMap(size => aliveChecks(mine.filter(r => r.botsPerSide === size)).filter(c => !c.pass).map(c => `${size}:${c.metric}`));
    (failed.length ? dropped.push({ level, failed }) : alive.push(level));
  }
  return { alive, dropped };
}

/** A mod's own bar is the one a mod's level is judged against when it is built from at least this many of its levels that are alive. */
export const MOD_BAR_MIN_LEVELS = 3;

/**
 * Which bar a level's verdict is against. A mod's level (`mod` other than
 * bf1942) is judged against its own mod's bar (`own`, a baseline built by
 * `botbatch baseline --mod`) when that bar holds at least
 * `MOD_BAR_MIN_LEVELS` alive levels; otherwise, and for a vanilla or
 * community level, against DICE's (`dice`). The alive checks hold under
 * either bar: they are the same three tests whatever the baseline.
 * `{ against: 'dice' | <mod>, baseline, why }`.
 */
export function chooseBar({ mod = 'bf1942', dice, own = null }) {
  const m = String(mod).toLowerCase();
  if (m === 'bf1942' || !own) return { against: 'dice', baseline: dice, why: m === 'bf1942' ? 'a vanilla or community level: DICE\'s bar' : `no bar of ${m}'s own: DICE's` };
  const alive = own.levelsAlive ?? [];
  if (alive.length >= MOD_BAR_MIN_LEVELS) return { against: m, baseline: own, why: `${m}'s own bar, built from ${alive.length} of its levels that are alive (${alive.join(', ')})` };
  return { against: 'dice', baseline: dice, why: `${m}'s own bar holds ${alive.length} alive level${alive.length === 1 ? '' : 's'}, fewer than ${MOD_BAR_MIN_LEVELS}: DICE's` };
}

/** `rows`: detector rows of the baseline levels. One band per side size. */
export function buildBaseline(rows, note = '') {
  const sizes = {};
  for (const size of [...new Set(rows.map(r => r.botsPerSide))].sort((a, b) => a - b)) {
    const mine = rows.filter(r => r.botsPerSide === size);
    const levels = [...new Set(mine.map(r => r.level))].sort();
    const metrics = {};
    for (const k of [...LOWER_IS_BETTER, ...HIGHER_IS_BETTER, 'firstCapture', ...WORSE_SIDE]) metrics[k] = spread(mine.map(r => r[k]));
    // The vehicle figures only where a match has them: an on-foot baseline carries none, and none is judged against it.
    const vehicle = [...VEHICLE_LOWER, ...VEHICLE_CONTEXT].filter(k => mine.some(r => Number.isFinite(r[k])));
    for (const k of vehicle) metrics[k] = spread(mine.map(r => r[k]));
    const perLevel = Object.fromEntries(levels.map(l => {
      const lr = mine.filter(r => r.level === l);
      return [l, {
        matches: lr.length, flagCoverage: unionCoverage(lr)?.coverage ?? null, never: unionCoverage(lr)?.never ?? [],
        winners: balance(lr).split, oneSided: balance(lr).oneSided,
        medians: Object.fromEntries([...LOWER_IS_BETTER, ...HIGHER_IS_BETTER, ...WORSE_SIDE, ...vehicle].map(k => [k, spread(lr.map(r => r[k])).p50])),
      }];
    }));
    const cov = Object.values(perLevel).map(p => p.flagCoverage).filter(Number.isFinite);
    sizes[size] = { levels, matches: mine.length, duration: mine[0]?.duration ?? null, metrics, perLevel, flagCoverageMin: cov.length ? Math.min(...cov) : null };
  }
  return { version: 1, note, sizes };
}

/**
 * Whether anybody fights: each side kills an enemy in every match, both
 * lose tickets in every match, and no bot throws. The three checks a level
 * must pass before anything else about it means much (`botbatch.mjs ALIVE`).
 */
export function aliveChecks(rows) {
  const fights = rows.every(r => (r.enemyKills?.[1] ?? 0) > 0 && (r.enemyKills?.[2] ?? 0) > 0);
  const bled = rows.every(r => r.ticketsBled && r.ticketsBled[1] > 0 && r.ticketsBled[2] > 0);
  const errors = rows.reduce((s, r) => s + (r.botErrors ?? 0), 0);
  return [
    { metric: 'bothSidesKill', median: fights ? 1 : 0, bar: 'each side kills an enemy in every seed', pass: fights },
    { metric: 'ticketsBleed', median: bled ? 1 : 0, bar: 'both sides lose tickets in every seed', pass: bled },
    { metric: 'botErrors', median: errors, bar: '== 0', pass: errors === 0 },
  ];
}

/**
 * One worse-side or vehicle check: the median over the seeds that have the
 * figure must be no worse than the baseline's 90th percentile of the same
 * figure.
 *
 * It is not measured, and does not fail, when there is nothing to hold it
 * to: the rows are from before the detector kept the figure (an old
 * detect.json) or from a match without vehicles, the baseline is, or no seed
 * has a figure (the death share on a level where nobody dies or redeploys,
 * which the alive checks fail on their own lines; the silent share on a
 * level where no tank seat is held a minute), or the baseline's bar for a
 * share is the whole of it. The bar's text says which.
 */
export function worseSideCheck(k, rows, band) {
  const bar = band?.metrics?.[k]?.p90 ?? null;
  const s = spread(rows.map(r => r[k]));
  // A share whose baseline bar is the whole of it holds nothing to anything:
  // Wake's Axis with vehicles, every one of whose deaths is by no enemy's hand.
  const ceiling = /Share/.test(k) && bar !== null && bar >= SHARE_CEILING;
  const why = bar === null ? 'the baseline has no band for it'
    : ceiling ? "the baseline's bar is the measure's ceiling"
    : !rows.some(r => r[k] !== undefined) ? `no row carries the field, a detect.json from before it${VEHICLE_LOWER.includes(k) ? ' or a match without vehicles' : ''}`
    : !s.n ? 'neither side has a figure in any seed' : null;
  if (why) return { metric: k, median: null, bar: `${bar === null ? 'no bar' : `<= ${bar}`} (not measured: ${why})`, measured: false, pass: true };
  // In how many seeds each side was the worse one: the side a player would be watching.
  const by = /WorseSide$/.test(k) ? rows.map(r => r[k.replace(/WorseSide$/, 'BySide')]).filter(Boolean) : null;
  const worse = side => by.filter(b => Number.isFinite(b[side]) && (!Number.isFinite(b[3 - side]) || b[side] > b[3 - side])).length;
  return { metric: k, median: s.p50, min: s.min, max: s.max, bar: `<= ${bar}${s.n < rows.length ? ` (over the ${s.n} of ${rows.length} seeds that have it)` : ''}`,
           baselineP50: band.metrics[k].p50, measured: true, seeds: s.n, ...(by ? { worseSideSeeds: { 1: worse(1), 2: worse(2) } } : {}), pass: s.p50 <= bar };
}

/** Judge one level's rows (one side size) against the baseline. */
export function judge(rows, baseline, { unreachable = [] } = {}) {
  const size = rows[0]?.botsPerSide;
  const band = baseline?.sizes?.[size];
  if (!band) return { verdict: 'no-baseline', size, checks: [] };
  const checks = [];
  for (const k of LOWER_IS_BETTER) {
    const s = spread(rows.map(r => r[k]));
    checks.push({ metric: k, median: s.p50, min: s.min, max: s.max, bar: `<= ${band.metrics[k].p90}`, baselineP50: band.metrics[k].p50, pass: s.p50 <= band.metrics[k].p90 });
  }
  for (const k of HIGHER_IS_BETTER) {
    const s = spread(rows.map(r => r[k]));
    checks.push({ metric: k, median: s.p50, min: s.min, max: s.max, bar: `>= ${band.metrics[k].p10}`, baselineP50: band.metrics[k].p50, pass: s.p50 >= band.metrics[k].p10 });
  }
  const cov = unionCoverage(rows, unreachable);
  checks.push({ metric: 'flagCoverage', median: cov?.coverage ?? null, bar: `>= ${band.flagCoverageMin}`, never: cov?.never ?? [], unreachable: cov?.unreachable ?? [], pass: cov !== null && cov.coverage >= band.flagCoverageMin });
  const side = s => rows.some(r => (r.captures?.[s] ?? 0) > 0);
  checks.push({ metric: 'bothSidesCapture', median: side(1) && side(2) ? 1 : 0, bar: 'each side captures in at least one seed', pass: side(1) && side(2) });
  checks.push(...aliveChecks(rows));
  for (const k of WORSE_SIDE) checks.push(worseSideCheck(k, rows, band));
  // The vehicle checks, against a baseline of matches played with vehicles only.
  for (const k of VEHICLE_LOWER) if (band.metrics[k]) checks.push(worseSideCheck(k, rows, band));
  const winners = rows.map(r => r.winner ?? 0);
  // Balance is reported, not judged: DICE's own levels show one-sided rounds (Berlin at 16 a side).
  return { verdict: checks.every(c => c.pass) ? 'pass' : 'fail', size, seeds: rows.length, failed: checks.filter(c => !c.pass).map(c => c.metric), checks, winners, balance: balance(rows) };
}
