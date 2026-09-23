// Reading a trace back: `--replay-summary` (a compact timeline) and `--why`
// (the decision inspector). Both read only the trace file, so a match run
// once can be questioned any number of times.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const SIDE = { 0: 'N', 1: 'Axis', 2: 'Allies' };

async function* lines(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield JSON.parse(line);
  }
}

function clock(t) {
  const m = Math.floor(t / 60), s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

/** A compact timeline: the match header, the state every `step` seconds,
 *  every capture / strategy change / mount / vehicle loss as it happens,
 *  kills and route failures rolled up per window, then the totals. */
export async function replaySummary(file, { step = 30, out = console.log } = {}) {
  let header = null;
  const bots = new Map();
  const windows = new Map();       // window start -> { kills: {1,2}, routeFailed: n, redeploys: n }
  const timeline = [];
  let lastSample = null;
  let nextState = 0;
  const behaviourTicks = new Map();  // bot -> { beh: ticks }
  const winOf = (t) => Math.floor(t / step) * step;
  const win = (t) => {
    const k = winOf(t);
    if (!windows.has(k)) windows.set(k, { kills: { 1: 0, 2: 0 }, routeFailed: 0, redeploys: 0 });
    return windows.get(k);
  };
  for await (const r of lines(file)) {
    if (r.k === 'match') {
      header = r;
      for (const b of r.bots) bots.set(b.id, { ...b, kills: 0, deaths: 0, captures: 0, routeFailed: 0, mounts: 0 });
    } else if (r.k === 'sample') {
      lastSample = r;
      if (r.t + 1e-9 >= nextState) {
        timeline.push({ t: r.t, text: `state    tickets ${r.tickets[1]} / ${r.tickets[2]}   flags N:${r.flags[0]} Axis:${r.flags[1]} Allies:${r.flags[2]}   alive ${r.alive[1]} / ${r.alive[2]}   mounted ${r.mounted[1]} / ${r.mounted[2]}` });
        nextState += step;
      }
    } else if (r.k === 'ev') {
      const b = r.bot ? bots.get(r.bot) : null;
      switch (r.type) {
        case 'capture':
          timeline.push({ t: r.t, text: `capture  ${r.flag}: ${SIDE[r.from]} -> ${SIDE[r.to]} by ${r.by}${r.alive === false ? ' (dead)' : ''}` });
          if (bots.get(r.by)) bots.get(r.by).captures++;
          break;
        case 'strategy':
          timeline.push({ t: r.t, text: `strategy ${SIDE[r.side]}: ${r.from ?? '-'} -> ${r.to ?? '-'}` });
          break;
        case 'mount':
          timeline.push({ t: r.t, text: `mount    ${r.bot} (${SIDE[r.side]}) ${r.template} ${r.driver ? 'driver' : 'seat ' + r.seat}` });
          if (b) b.mounts++;
          break;
        case 'dismount':
          timeline.push({ t: r.t, text: `dismount ${r.bot} ${r.template ?? ''}${r.killed ? ' (killed)' : ''}` });
          break;
        case 'vehicle_destroyed':
          timeline.push({ t: r.t, text: `wreck    ${r.template} ${r.vehicle}` });
          break;
        case 'kill': {
          const w = win(r.t);
          if (r.killerSide) w.kills[r.killerSide]++;
          if (bots.get(r.killer)) bots.get(r.killer).kills++;
          if (bots.get(r.victim)) bots.get(r.victim).deaths++;
          break;
        }
        case 'route_failed':
          win(r.t).routeFailed++;
          if (b) b.routeFailed++;
          break;
        case 'redeploy':
          win(r.t).redeploys++;
          break;
        default:
          break;
      }
    } else if (r.k === 'tick' && r.alive) {
      let m = behaviourTicks.get(r.bot);
      if (!m) behaviourTicks.set(r.bot, (m = {}));
      m[r.beh ?? 'none'] = (m[r.beh ?? 'none'] ?? 0) + 1;
    }
  }
  if (!header) throw new Error(`${file}: no match header`);
  for (const [k, w] of windows) {
    const parts = [];
    if (w.kills[1] || w.kills[2]) parts.push(`kills Axis ${w.kills[1]} Allies ${w.kills[2]}`);
    if (w.routeFailed) parts.push(`route failures ${w.routeFailed}`);
    if (w.redeploys) parts.push(`redeploys ${w.redeploys}`);
    if (parts.length) timeline.push({ t: k + step - 1e-6, text: `window   ${clock(k)}-${clock(k + step)} ${parts.join(', ')}` });
  }
  timeline.sort((a, b) => a.t - b.t);
  out(`match ${header.level}  seed ${header.seed}  ${header.botsPerSide} bots a side  skill ${header.botSkill}  `
      + `${header.duration} s  trace every ${header.traceEvery} tick(s)`);
  out(`flags: ${header.flags.map(f => `${f.name}${f.uncapturable ? '*' : ''}(${SIDE[f.team]})`).join(', ')}   (* uncapturable)`);
  for (const e of timeline) out(`${lpad(clock(e.t), 6)}  ${e.text}`);
  if (lastSample) out(`end      tickets ${lastSample.tickets[1]} / ${lastSample.tickets[2]} at ${clock(lastSample.t)}`);
  out('');
  out(`${pad('bot', 8)} ${pad('side', 7)} ${pad('kit', 24)} ${lpad('K', 3)} ${lpad('D', 3)} ${lpad('cap', 4)} ${lpad('mnt', 4)} ${lpad('rtf', 4)}  behaviour share`);
  for (const [id, b] of bots) {
    const m = behaviourTicks.get(id) ?? {};
    const total = Object.values(m).reduce((a, c) => a + c, 0) || 1;
    const share = Object.entries(m).sort((a, c) => c[1] - a[1]).slice(0, 4)
      .map(([k, v]) => `${k} ${Math.round(100 * v / total)}%`).join(', ');
    out(`${pad(id, 8)} ${pad(SIDE[b.side], 7)} ${pad(b.kit ?? '-', 24)} ${lpad(b.kills, 3)} ${lpad(b.deaths, 3)} ${lpad(b.captures, 4)} ${lpad(b.mounts, 4)} ${lpad(b.routeFailed, 4)}  ${share}`);
  }
}

/** The shape of each behaviour's urgency, for the inspector. */
const FORMULA = {
  MoveTo: 'u = clamp(d^2 / (4 (R + r)^2), 0.1, 1) x factor x mod      (WPMoveTo::getUrgency; factor 2 not owned, 1 owned outside, 0 owned inside)',
  Fire: 'u = Declein(2 x score) x mod      (BBFire; score = curve x range x weapon x sight x speed x attacked x area x strength x rangeFactor)',
  Scout: 'u = Declein((accum x 0.2 + interest x 0.1) x boost) x mod',
  TakeCover: 'u = Declein(danger) x Declein(clamp(d_threat, 2, 100) x 0.01) x mod',
  Special: 'u = Declein(sum value / (d x SCurve(health))) x 4 x mod',
  Change: 'u = Declein(0.5 x best / staying) x mod x 4 x ramp x area   (seated: x2 when bailing; or the seat swap)',
  Avoid: 'u = |relative velocity| / distance x mod',
  Idle: 'u = mod',
};

const FIRE_MOUNTED = 'u = Declein(2 x score) x mod      (BBFireLargeBore / BBFire3d; score = facing x distance x weapon x sight x move x attacked x base)';

/** For the inspector's explanation only (bot.js STANDARD_WEIGHTS and URGENCY_CURVE). */
const PERSONALITY = { Avoid: 1.0, MoveTo: 1.5, Idle: 0.1, Fire: 7.5, Special: 1.0, Scout: 1.0, TakeCover: 2.0, Change: 1.9 };
const CURVE = {
  Fire: t => Math.max(0, -0.22 * t + 1.3),
  Scout: t => Math.max(0, 2.5 / (t + 0.9) + 0.5),
};

/** The decision inspector: the tick at or just before `time` for `botId`. */
export async function why(file, botId, time, { out = console.log } = {}) {
  let header = null, best = null, prev = null, lastEvents = [];
  for await (const r of lines(file)) {
    if (r.k === 'match') header = r;
    if (r.k === 'ev' && r.t <= time && (r.bot === botId || r.victim === botId || r.killer === botId || r.by === botId)) {
      lastEvents.push(r);
      if (lastEvents.length > 5) lastEvents.shift();
    }
    if (r.k !== 'tick' || r.bot !== botId) continue;
    if (r.t > time + 1e-9) break;
    prev = best;
    best = r;
  }
  if (!header) throw new Error(`${file}: no match header`);
  if (!best) { out(`${botId}: no trace line at or before t=${time}`); return; }
  const r = best;
  out(`${r.bot} (${SIDE[r.side]}) at t=${r.t} s (tick ${r.n})  level ${header.level}  seed ${header.seed}`);
  if (!r.alive) { out(`  dead, respawn in ${r.respawnIn} s`); return; }
  out(`  pos (${r.pos.join(', ')})  yaw ${r.yaw}  stance ${r.stance}  hp ${r.hp}`);
  out(`  order: ${r.order ? `${r.order.src} to ${r.area ?? '?'} at (${r.order.point.join(', ')}) radius ${r.order.radius}` : 'none'}`);
  out(`  mounted: ${r.veh ? `${r.veh.template} ${r.veh.id} seat ${r.veh.seat}${r.veh.drives ? ' (drives)' : ''}` : 'no'}`);
  out(`  winner: ${r.beh ?? 'none'}, active ${r.since} s (since t=${Math.round((r.t - r.since) * 100) / 100})`);
  out('');
  out(`  ${pad('behaviour', 10)} ${lpad('urgency', 9)} ${lpad('mod', 8)} ${lpad('snapshot', 9)} ${lpad('ratio', 7)}  note`);
  const names = header.behaviours;
  const U = {}, A = {}, MOD = {};
  names.forEach((name, i) => { U[name] = r.u[i]; A[name] = r.act[i]; if (r.mod[i] !== null) MOD[name] = r.mod[i]; });
  r.u = U; r.act = A; r.mod = MOD;
  for (const name of names) {
    const u = r.u[name], a = r.act[name];
    const evaluated = name in r.mod;
    const ratio = a > 0 ? u / a : (u > 0 ? Infinity : 1);
    const outside = !(ratio >= 0.87 && ratio <= 1.15);
    const notes = [];
    if (name === r.beh) notes.push('WINNER');
    if (!evaluated && r.veh && name === 'Special') notes.push('not registered for a vehicle (the Tank rows have no Special)');
    else if (!evaluated) notes.push('not evaluated (mod <= 0), old urgency kept');
    if (outside && r.beh && name !== r.beh) notes.push('outside 0.87..1.15: re-opens the contest');
    out(`  ${pad(name, 10)} ${lpad(u.toFixed(4), 9)} ${lpad(evaluated ? r.mod[name].toFixed(4) : '-', 8)} ${lpad(a.toFixed(4), 9)} `
        + `${lpad(Number.isFinite(ratio) ? ratio.toFixed(3) : 'inf', 7)}  ${notes.join('; ')}`);
  }
  out('');
  if (r.beh && r.mod[r.beh] !== undefined) {
    // The winner's modifier: personality x its own urge curve over the
    // seconds it has been active x its own inhibitor column (1 for itself).
    const p = PERSONALITY[r.beh] ?? 1;
    const curve = CURVE[r.beh] ? CURVE[r.beh](r.since) : 1;
    out(`  mod(${r.beh}) = ${p} (StandardWeights) x ${Math.round(curve * 1e4) / 1e4} (urge curve at ${r.since} s active) = ${Math.round(p * curve * 1e4) / 1e4}`
        + `${Math.abs(p * curve - r.mod[r.beh]) > 1e-3 ? `  [trace: ${r.mod[r.beh]}]` : ''}`);
  }
  const mounted = !!r.veh;
  if (r.beh === 'Fire' && mounted) out(`  Fire: ${FIRE_MOUNTED}`);
  else if (r.beh && FORMULA[r.beh]) out(`  ${r.beh}: ${FORMULA[r.beh]}`);
  const t = r.terms ?? {};
  const w = r.beh ? t[r.beh.charAt(0).toLowerCase() + r.beh.slice(1)] : null;
  if (r.beh === 'MoveTo' && w) {
    out(`    source ${w.src}, area ${w.area}, d = ${w.dist} m, R = ${w.radius}, r = ${w.unitRadius}, `
        + `d^2/(4(R+r)^2) = ${w.q} -> clamp ${w.shaped}, factor ${w.factor}, mod ${r.mod.MoveTo ?? '-'}: `
        + `u = ${Math.round(w.shaped * w.factor * (r.mod.MoveTo ?? 0) * 1e4) / 1e4}`);
  } else if (w) {
    out(`    ${JSON.stringify(w)}`);
  }
  if (t.fire) {
    out(`  firing target ${t.fire.target}: score ${t.fire.score} with ${t.fire.weapon} at ${t.fire.dist} m`
        + `${t.fire.visible ? ' (seen)' : ' (lost)'}; Fire u = Declein(${Math.round(2 * t.fire.score * 1e4) / 1e4}) x ${r.mod.Fire ?? '-'} = ${r.u.Fire}`);
  }
  out(`  plan: ${r.plan ?? 'none'} (${r.planLen} action(s))  route: ${r.route ? `${r.route.points} point(s)${r.route.failed ? ', failed' : ''}` : 'none'}`);
  if (prev && prev.beh !== r.beh) out(`  changed this tick: ${prev.beh} -> ${r.beh}`);
  if (lastEvents.length) {
    out('  recent events:');
    for (const e of lastEvents) out(`    t=${e.t} ${e.type} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['k', 't', 'type'].includes(k))))}`);
  }
}
