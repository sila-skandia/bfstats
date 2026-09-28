// One real recording split into the files other clients of the same round
// would have written, by the server's rule (features/round-replay-capture
// §19): every event reaches every client, but an object's state only within
// the view distance plus 20 m of the client's viewpoint, save the controlled
// object of every living player on the client's own side, which reaches it
// wherever he is. The original is the truth, so a split file holds a subset
// of it, and merging the splits must give the original back where they
// cover it (tests/replay_merge_harness.mjs, features/round-replay-merge).
//
// A split file can begin after the join, as a recorder switched on mid-round
// does: it opens with what the recorder keeps of the join (`ago`) and a
// roster. Its clock can run from another origin at another rate, its events
// can arrive up to `jitter` seconds apart from the original's (in their own
// order), and its parts and engines are numbered in its own first-seen order.

const OWN = new Set(['hitFrom', 'special', 'fire']);
const JOIN = new Set(['serverInfo', 'serverName', 'challenge', 'gameRules', 'setLevel']);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lastAt(list, t) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The original, indexed: every record in order, and per object, player and
 *  part what the split needs to ask at a time. */
export function indexRecording(text) {
  const rec = {
    records: [], keys: new Map(), spans: new Map(), opens: new Map(), hp: new Map(), bodies: new Map(),
    players: new Map(), tmpl: new Map(), joinT: null,
  };
  const list = (map, id) => {
    if (!map.has(id)) map.set(id, []);
    return map.get(id);
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const t = typeof r.t === 'number' ? r.t : 0;
    rec.records.push({ t, r });
    if (r.k === 'h') rec.header = r;
    else if (r.k === 's') for (const e of r.o) list(rec.keys, e[0]).push([t, ...e.slice(1)]);
    else if (r.k === 'a') for (const e of r.a) list(rec.hp, e[0]).push([t, e]);
    else if (r.k === 'st') for (const e of r.o) list(rec.bodies, e[0]).push([t, e]);
    else if (r.k === 'o') {
      list(rec.opens, r.id).push([t, r]);
      const spans = list(rec.spans, r.id);
      if (spans.length && spans[spans.length - 1][1] === Infinity) spans[spans.length - 1][1] = t;
      spans.push([t, Infinity]);
      if (!rec.tmpl.has(r.id)) rec.tmpl.set(r.id, r.tmpl ?? '');
    } else if (r.k === 'd') {
      const last = rec.spans.get(r.id)?.at(-1);
      if (last && last[1] === Infinity) last[1] = t;
    } else if (r.k === 'p') {
      for (const e of r.p) list(rec.players, e[0]).push([t, e]);
    } else if (r.k === 'e' && r.e === 'dbComplete' && rec.joinT === null) {
      rec.joinT = t;
    } else if (r.k === 'e' && r.e === 'createObject' && !rec.tmpl.has(r.netId)) {
      rec.tmpl.set(r.netId, r.tmpl ?? '');
    } else if (r.k === 'end') {
      rec.end = t;
    }
  }
  rec.end ??= rec.records.at(-1)?.t ?? 0;
  rec.local = rec.records.find(x => x.r.k === 'f' && x.r.local)?.r.pid ?? null;
  return rec;
}

/** `pid`'s player record at `t`, or null. */
export function playerAt(rec, pid, t) {
  const list = rec.players.get(pid);
  const i = list ? lastAt(list, t) : -1;
  return i >= 0 ? list[i][1] : null;
}

const rootOf = e => (e.length >= 4 && e[3] >= 0 ? e[3] : e[2]);

/** Where `id` was at `t` in the original, or null. */
export function positionAt(rec, id, t) {
  const keys = rec.keys.get(id);
  const i = keys ? lastAt(keys, t) : -1;
  return i >= 0 ? keys[i] : null;
}

/**
 * When a client whose player is `player` would have had each object in
 * range: `Map(id -> [[from, to]])`, original time, from `from` to `to`. At
 * each of the original's samples an object the original had is in range when
 * it is the controlled object of a living player on `player`'s side, or
 * within `radius` of what `player` controls (where the original last had it).
 */
export function rangeOf(rec, player, radius, from = 0, to = Infinity) {
  const ticks = [...new Set(rec.records.filter(x => x.r.k === 's').map(x => x.t))]
    .filter(t => t >= from && t <= to).sort((a, b) => a - b);
  const out = new Map();
  const open = new Map();   // id -> [its split span, the original's span holding it]
  let eye = null;
  for (const tick of ticks) {
    const mine = playerAt(rec, player, tick);
    const view = mine ? positionAt(rec, rootOf(mine), tick) : null;
    if (view) eye = view;
    const friends = new Set();
    for (const list of rec.players.values()) {
      const e = list[lastAt(list, tick)]?.[1];
      const root = e ? rootOf(e) : -1;
      if (e && e[1] === mine?.[1] && root >= 0 && !/camera/i.test(rec.tmpl.get(root) ?? '')) friends.add(root);
    }
    for (const [id, spans] of rec.spans) {
      const span = spans[lastAt(spans, tick)];
      const had = span && tick < span[1];
      const at = had ? positionAt(rec, id, tick) : null;
      const near = eye && at && Math.hypot(at[1] - eye[1], at[2] - eye[2], at[3] - eye[3]) <= radius;
      const now = open.get(id);
      if (had && (friends.has(id) || near)) {
        if (!now) {
          const split = [tick, Infinity];
          if (!out.has(id)) out.set(id, []);
          out.get(id).push(split);
          open.set(id, [split, span]);
        }
      } else if (now) {
        // Out of range, or gone from the original: its own end then.
        now[0][1] = had ? tick : Math.min(tick, now[1][1]);
        open.delete(id);
      }
    }
  }
  for (const [split, span] of open.values()) split[1] = Math.min(span[1], to);
  return out;
}

const round3 = t => Math.round(t * 1000) / 1000;

/** What a recorder switched on at `from` keeps of the join and of what it
 *  made (bf42plus `0254e92`): the join's own events, each player's latest
 *  createPlayer, every object standing, the pools standing and each player's
 *  latest kit, in the order they came. */
function heldAt(rec, from) {
  const join = new Map();
  const players = new Map();
  const creates = new Map();
  const pools = new Map();
  const kits = new Map();
  for (const x of rec.records) {
    if (x.t > from) break;
    const r = x.r;
    if (r.k !== 'e') continue;
    if (JOIN.has(r.e)) join.set(r.e, x);
    else if (r.e === 'createPlayer') players.set(r.pid, x);
    else if (r.e === 'createObject') creates.set(r.netId, x);
    else if (r.e === 'projPool') pools.set(r.netId, x);
    else if (r.e === 'pickupKit') kits.set(r.pid, x);
    else if (r.e === 'destroyPlayer') {
      players.delete(r.pid);
      kits.delete(r.pid);
    } else if (r.e === 'destroyObject') {
      creates.delete(r.netId);
      pools.delete(r.netId);
      for (const [pid, k] of kits) if (k.r.netId === r.netId) kits.delete(pid);
    }
  }
  const inOrder = map => [...map.values()].sort((a, b) => a.t - b.t);
  return { held: [...join.values(), ...inOrder(players), ...inOrder(creates), ...inOrder(pools), ...inOrder(kits)], players };
}

/**
 * The file `player`'s client would have written of the original's `[from,
 * to]`. `radius` is the level's view distance plus 20 m; `drift` the file
 * clock's rate against the original's; `jitter` how far, in seconds either
 * way, each event arrives from the original's time (seeded by `seed`). Only
 * the original's own player's file keeps his hits, refills and presses.
 * Returns `{ text, range }`, `range` when each object was in range
 * (`rangeOf`, original time).
 */
export function splitRecording(rec, { player, radius, from = 0, to = rec.end, drift = 0, jitter = 0, seed = 1 }) {
  const range = rangeOf(rec, player, radius, from, to);
  const own = player === rec.local;
  const random = mulberry32(seed);
  const midRound = from > (rec.joinT ?? 0);
  const clock = t => round3(Math.max(0, t - from) * (1 + drift));
  const out = [];
  const put = (t, r) => out.push([t, out.length, r]);
  const team = t => playerAt(rec, player, t)?.[1] ?? 0;
  const held = (id, t) => {
    const s = range.get(id);
    const i = s ? lastAt(s, t) : -1;
    return i >= 0 && t < s[i][1];
  };

  put(0, { ...rec.header });
  if (midRound) {
    // Held records of a file that itself began mid-round came `ago` before it.
    const { held: kept, players } = heldAt(rec, from);
    for (const x of kept) put(0, { ...x.r, t: 0, ago: round3(from - x.t + (x.r.ago ?? 0)) });
    const roster = [...players.values()].map(({ r }) => [r.pid, playerAt(rec, r.pid, from)?.[1] ?? r.team, r.ai, r.name, r.pid === player ? 1 : 0]);
    put(0, { k: 'roster', t: 0, p: roster });
  } else {
    const roster = rec.records.find(x => x.r.k === 'roster')?.r;
    if (roster) put(0, { ...roster, t: 0, p: roster.p.map(e => [...e.slice(0, 4), e[0] === player ? 1 : 0]) });
  }

  // Events, each in its own time give or take the jitter, in their order:
  // the jittered times are handed out sorted, so the order holds and the
  // jitter stays zero-mean (clamping each to the one before biases it late).
  const events = [];
  const destroyed = new Set();
  for (const { t, r } of rec.records) {
    if (r.k !== 'e') continue;
    if (r.e === 'destroyObject' && t <= from) destroyed.add(r.netId);
    if ((midRound && t <= from) || t > to) continue;
    if (OWN.has(r.e) && !own) continue;
    const speaker = r.pid >= 0 ? playerAt(rec, r.pid, t)?.[1] : null;
    // Team chat and team radio reach the speaker's side; a shout only whoever
    // stood within 70 m, which only the original's player is known to have.
    if ((r.e === 'chat' || r.e === 'radio') && r.global === 1 && speaker !== null && speaker !== team(t)) continue;
    if (r.e === 'radio' && r.global === 0 && !own) continue;
    const fixed = r.ago !== undefined || t <= (rec.joinT ?? -1);
    events.push({ r, at: fixed ? clock(t) : Math.max(0, round3(clock(t) + (random() * 2 - 1) * jitter)) });
  }
  const times = events.map(e => e.at).sort((a, b) => a - b);
  events.forEach((e, i) => put(times[i], { ...e.r, t: times[i] }));

  // Each object while in range: its record on first sight, where it stands
  // then, every change, and its record when it goes.
  for (const [id, spans] of range) {
    for (const [a, b] of spans) {
      const opens = rec.opens.get(id);
      put(clock(a), { ...opens[Math.max(0, lastAt(opens, a))][1], t: clock(a) });
      for (const [kind, list, entry] of [
        ['s', rec.keys.get(id) ?? [], k => [id, ...k.slice(1)]],
        ['a', rec.hp.get(id) ?? [], k => k[1]],
        ['st', rec.bodies.get(id) ?? [], k => k[1]],
      ]) {
        const i = lastAt(list, a);
        if (i >= 0) put(clock(a), { k: kind, t: clock(a), [kind === 'a' ? 'a' : 'o']: [entry(list[i])] });
        for (let j = i + 1; j < list.length && list[j][0] < b; j++) {
          put(clock(list[j][0]), { k: kind, t: clock(list[j][0]), [kind === 'a' ? 'a' : 'o']: [entry(list[j])] });
        }
      }
      if (b < to) put(clock(b), { k: 'd', t: clock(b), id });
    }
  }

  // Parts and engines, numbered in the file's own first-seen order; a file
  // begun mid-round sees every standing one at its first sample.
  const childIds = new Map();
  const childId = id => {
    if (!childIds.has(id)) childIds.set(id, childIds.size + 1);
    return childIds.get(id);
  };
  const standing = new Map();
  for (const { t, r } of rec.records) {
    if (t > to) break;
    if (r.k !== 'jn' && r.k !== 'j' && r.k !== 'g') continue;
    for (const e of r.o) {
      const root = e[0];
      const id = r.k === 'g' ? e[5] : e[1];
      if (t <= from && midRound) {
        const was = standing.get(`${r.k === 'g' ? 'g' : 'p'}${id}`) ?? {};
        standing.set(`${r.k === 'g' ? 'g' : 'p'}${id}`, { ...was, root, [r.k]: e });
        continue;
      }
      const mapped = r.k === 'g' ? [...e.slice(0, 5), childId(id)] : [root, childId(id), ...e.slice(2)];
      put(clock(t), { k: r.k, t: clock(t), o: [mapped] });
    }
  }
  const atStart = [...standing.values()].filter(c => !destroyed.has(c.root));
  for (const c of atStart) {
    if (c.jn) put(0, { k: 'jn', t: 0, o: [[c.root, childId(c.jn[1]), ...c.jn.slice(2)]] });
    if (c.j) put(0, { k: 'j', t: 0, o: [[c.root, childId(c.j[1]), ...c.j.slice(2)]] });
    if (c.g) put(0, { k: 'g', t: 0, o: [[...c.g.slice(0, 5), childId(c.g[5])]] });
  }

  // The players, the flags, the tickets, the chat box and the rounds.
  const latest = new Map();
  for (const { t, r } of rec.records) {
    if (t > to) break;
    const early = midRound && t <= from;
    if (r.k === 'p') {
      if (early) for (const e of r.p) latest.set(`p${e[0]}`, { k: 'p', t: 0, p: [e] });
      else put(clock(t), { ...r, t: clock(t) });
    } else if (r.k === 'cp') {
      if (early) latest.set(`cp${r.id}`, { ...(latest.get(`cp${r.id}`) ?? {}), ...r, t: 0 });
      else put(clock(t), { ...r, t: clock(t) });
    } else if (r.k === 'tk') {
      if (early) latest.set('tk', { ...r, t: 0 });
      else put(clock(t), { ...r, t: clock(t) });
    } else if (r.k === 'anim') {
      put(clock(t), { ...r, t: clock(t) });
    } else if (r.k === 'chat' && !early) {
      const channel = / \[(allies|axis)\]: /i.exec(r.text ?? '');
      if (channel && r.team !== team(t)) continue;
      put(clock(t), { ...r, t: clock(t) });
    } else if (r.k === 'f' && !early && (held(r.id, t) || r.pid === player)) {
      const { local, ...rest } = r;
      put(clock(t), { ...rest, t: clock(t), ...(r.pid === player && (local || !own) ? { local: 1 } : {}) });
    }
  }
  for (const r of latest.values()) put(0, r);
  put(clock(to), { k: 'end', t: clock(to) });

  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // One line per kind of sample and moment, as the recorder writes them.
  const lines = [];
  const groups = new Map();
  for (const [, , r] of out) {
    const field = { s: 'o', a: 'a', st: 'o', jn: 'o', j: 'o', g: 'o', p: 'p' }[r.k];
    const key = `${r.k}|${r.t}`;
    if (field && groups.has(key)) {
      groups.get(key)[field].push(...r[field]);
      continue;
    }
    const line = field ? { ...r, [field]: [...r[field]] } : r;
    if (field) groups.set(key, line);
    lines.push(line);
  }
  return { text: `${lines.map(r => JSON.stringify(r)).join('\n')}\n`, range };
}
