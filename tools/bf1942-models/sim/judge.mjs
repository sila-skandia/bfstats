// Score a level's detector rows against a baseline built from DICE's own
// layers run the same way (features/bot-map-generation, section 6.2). The
// bar is the baseline's spread, fixed here before any level is judged:
// a rate must be no worse than the baseline's 90th percentile, a count no
// lower than its 10th, and the outcome checks must hold.

export const LOWER_IS_BETTER = [
  'stuckSecondsPerBotMinute', 'idleShare', 'oscillationsPerBotMinute', 'selfDeathsPerBotMinute',
  'spawnTrapsPerBotMinute', 'routeFailuresPerBotMinute', 'redeploysPerBotMinute', 'teamKillsPerBotMinute',
];
export const HIGHER_IS_BETTER = ['capturesTotal', 'enemyKillsPerBotMinute'];

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

/** `rows`: detector rows of the baseline levels. One band per side size. */
export function buildBaseline(rows, note = '') {
  const sizes = {};
  for (const size of [...new Set(rows.map(r => r.botsPerSide))].sort((a, b) => a - b)) {
    const mine = rows.filter(r => r.botsPerSide === size);
    const levels = [...new Set(mine.map(r => r.level))].sort();
    const metrics = {};
    for (const k of [...LOWER_IS_BETTER, ...HIGHER_IS_BETTER, 'firstCapture']) metrics[k] = spread(mine.map(r => r[k]));
    const perLevel = Object.fromEntries(levels.map(l => {
      const lr = mine.filter(r => r.level === l);
      return [l, {
        matches: lr.length, flagCoverage: unionCoverage(lr)?.coverage ?? null, never: unionCoverage(lr)?.never ?? [],
        winners: balance(lr).split, oneSided: balance(lr).oneSided,
        medians: Object.fromEntries([...LOWER_IS_BETTER, ...HIGHER_IS_BETTER].map(k => [k, spread(lr.map(r => r[k])).p50])),
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
  const winners = rows.map(r => r.winner ?? 0);
  // Balance is reported, not judged: DICE's own levels show one-sided rounds (Berlin at 16 a side).
  return { verdict: checks.every(c => c.pass) ? 'pass' : 'fail', size, seeds: rows.length, failed: checks.filter(c => !c.pass).map(c => c.metric), checks, winners, balance: balance(rows) };
}
