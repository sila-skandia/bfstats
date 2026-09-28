// A bf42plus recording read for merging (replay-merge.js): its records by
// kind, keyed the way the merge needs them, and the small helpers the merge,
// its clock fit and its report share. Three.js-free and pure.

// --- record classes -------------------------------------------------------------

/** Events a client is sent about its own connection, or sent again at every
 *  join: the join itself (the server, the level, the map list, the database
 *  and the world clock that answers it), the 10-second timer, the rules and
 *  the status. The merged file takes them from its owner file. */
const OWNER_EVENTS = new Set([
  'serverInfo', 'serverName', 'challenge', 'setLevel', 'sessionId', 'mapList', 'dbComplete', 'simStart',
  'welcome', 'gameRules', 'clock', 'gameStatus',
]);

/** Events only the recording player's own client has: the hits he took
 *  (0x3C), his refills at a depot (0x27), his trigger presses (v3 `fire`). */
const OWN_EVENTS = new Set(['hitFrom', 'special', 'fire']);

/** Raw event types (a recorder that did not name them) of either class. */
const OWNER_RAW = new Set([0x04, 0x13, 0x14, 0x16, 0x1a, 0x1b, 0x29, 0x36, 0x37]);
const OWN_RAW = new Set([0x27, 0x3c]);

/** Events that end something: the merged copy is the latest, so nothing a
 *  file recorded before its own copy falls after the merged one. */
export const ENDING_EVENTS = new Set(['destroyObject', 'destroyPlayer']);

/** Where a record goes among others of the same millisecond: a creation
 *  before the object's samples, its samples before its removal. */
export const RANK = {
  h: 0, head: 1, e: 2, anim: 3, o: 4, s: 5, a: 6, jn: 7, j: 8, g: 9, st: 10, tk: 11, p: 12, cp: 13,
  chat: 14, f: 15, other: 16, ending: 17, d: 18, end: 19,
};

export const SAMPLE_PERIOD = 0.1;

/** What an event says, whoever received it: the key its copies share. A
 *  score's `victim` is the dead man's only for a kill (3) or a team kill (6),
 *  and a spawn's weapon is uninitialised, so neither keys the others. */
export function eventKey(r) {
  switch (r.e) {
    case 'createObject': return `co|${r.netId}|${r.tmpl || r.tid}`;
    case 'destroyObject': return `do|${r.netId}`;
    case 'projPool': return `pp|${r.netId}|${r.count}|${r.tmpl || r.tid}`;
    case 'createPlayer': return `pl|${r.pid}|${r.name}`;
    case 'destroyPlayer': return `dp|${r.pid}`;
    case 'setTeam': return `tm|${r.pid}|${r.team}`;
    case 'score': return r.kind === 3 || r.kind === 6 ? `sc|${r.kind}|${r.pid}|${r.victim}` : `sc|${r.kind}|${r.pid}`;
    case 'control': return `ct|${r.pid}|${r.netId}`;
    case 'enterVehicle': return `en|${r.pid}|${r.netId}`;
    case 'exitVehicle': return `ex|${r.pid}`;
    case 'pickupKit': return `pk|${r.pid}|${r.netId}`;
    case 'chat': return `ch|${r.pid}|${r.global}|${r.text}`;
    case 'radio': return `ra|${r.pid}|${r.msg}|${r.global}`;
    case 'vote': return `vo|${r.action}|${r.type}|${r.pid}|${r.target}|${r.yes}|${r.required}`;
    case 'roundStats': return `rs|${r.stat}|${r.pid}|${(r.rows ?? []).map(x => `${x.tmpl || x.tid}:${x.n}`).join(',')}`;
    case 'raw': return `rw|${r.type}|${r.raw}`;
    default: return null;
  }
}

function eventClass(r) {
  if (r.e === 'raw') return OWNER_RAW.has(r.type) ? 'owner' : OWN_RAW.has(r.type) ? 'own' : 'match';
  if (OWNER_EVENTS.has(r.e)) return 'owner';
  if (OWN_EVENTS.has(r.e)) return 'own';
  return eventKey(r) ? 'match' : 'owner';
}

// --- small helpers --------------------------------------------------------------

export const ms = t => Math.round(t * 1000) / 1000;

/** The index of the last entry of `list` whose `list[i][0]` is at or before
 *  `t`, or -1. */
export function lastAt(list, t, at = e => e[0]) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at(list[mid]) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}


export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at];
}
export const median = values => quantile(values, 0.5);
export const mean = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function spread(values, digits = 3) {
  const round = v => (v === null ? null : Number(v.toFixed(digits)));
  return { n: values.length, median: round(median(values)), p95: round(quantile(values, 0.95)), max: round(values.length ? Math.max(...values) : null) };
}

export const count = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
export const plain = map => Object.fromEntries([...map].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** The span of `spans` (sorted `[from, to]`) holding `t`, or null. */
export function spanAt(spans, t) {
  const i = lastAt(spans, t);
  return i >= 0 && t < spans[i][1] ? spans[i] : null;
}

/** Seconds of `[a, b)` that `spans` cover. */
export function covered(spans, a, b) {
  let sum = 0;
  for (const [from, to] of spans) {
    if (to <= a) continue;
    if (from >= b) break;
    sum += Math.min(b, to) - Math.max(a, from);
  }
  return sum;
}

/** `spans` with `cuts` (sorted `[from, to]`) taken out. */
export function subtract(spans, cuts) {
  if (!cuts.length) return spans;
  const out = [];
  for (const [from, to] of spans) {
    let start = from;
    for (const [a, b] of cuts) {
      if (b <= start || a >= to) continue;
      if (a > start) out.push([start, a]);
      start = Math.max(start, b);
      if (start >= to) break;
    }
    if (start < to) out.push([start, to]);
  }
  return out;
}

/** A pose from change-only samples `[t, x, y, z, qx, qy, qz, qw]`, as the
 *  viewer reads them (replay-recording.js `sampleAt`): held, then eased over
 *  the last sample period before the next. */
export function poseAt(keys, t) {
  const i = lastAt(keys, t);
  if (i < 0) return null;
  const a = keys[i];
  const b = keys[i + 1];
  if (!b) return a;
  const start = Math.max(a[0], b[0] - SAMPLE_PERIOD);
  if (t <= start) return a;
  const k = (t - start) / (b[0] - start);
  const out = [t];
  for (let j = 1; j < 8; j++) out.push(a[j] + (b[j] - a[j]) * k);
  return out;
}

export const distance = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);

/** Degrees between two orientations. */
export function angle(a, b) {
  const dot = Math.abs(a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7]);
  const na = Math.hypot(a[4], a[5], a[6], a[7]) || 1;
  const nb = Math.hypot(b[4], b[5], b[6], b[7]) || 1;
  return (2 * Math.acos(Math.min(1, dot / (na * nb))) * 180) / Math.PI;
}

// --- reading a file -------------------------------------------------------------

/**
 * One recording, read for merging: its records by kind, keyed the way the
 * merge needs them. Times are the file's own until `retime` moves them onto
 * the merged clock.
 */
export function readRecording(file, text, index = 0) {
  const src = {
    index, file, header: null, version: 1, plus: '', start: '', hz: 10,
    level: '', modeFile: '', mod: '', server: '',
    events: [], chat: [], fires: [], cps: [], tickets: [], other: [],
    anim: null, animT: null, roster: null, joinT: null, endT: null, lastT: 0, records: 0, firstSample: null,
    objects: new Map(),   // id -> { opens: [{ t, r }], spans: [[from, to]], keys, hp, st }
    children: new Map(),  // root -> [child], a part (`jn`/`j`) or an engine (`g`), in first-seen order
    players: new Map(),   // pid -> [[t, entry]]
    local: null, localFrom: 'unknown',
  };
  const object = id => {
    let o = src.objects.get(id);
    if (!o) {
      o = { id, opens: [], spans: [], keys: [], hp: [], st: [] };
      src.objects.set(id, o);
    }
    return o;
  };
  const childrenOf = root => {
    if (!src.children.has(root)) src.children.set(root, []);
    return src.children.get(root);
  };
  const parts = new Map();
  const engines = new Map();
  const part = (root, id, t) => {
    let c = parts.get(id);
    if (!c) {
      c = { kind: 'part', root, id, tmpl: '', pos: null, first: t, keys: [] };
      parts.set(id, c);
      childrenOf(root).push(c);
    }
    return c;
  };
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;   // a crash can cut the last line short
    }
    if (!r || typeof r !== 'object') continue;
    const t = typeof r.t === 'number' ? r.t : 0;
    n += 1;
    if (t > src.lastT) src.lastT = t;
    if ((r.k === 's' || r.k === 'p') && src.firstSample === null) src.firstSample = t;
    switch (r.k) {
      case 'h':
        if (!src.header) {
          src.header = r;
          src.version = r.v ?? 1;
          src.plus = r.plus ?? '';
          src.start = r.start ?? '';
          src.hz = r.hz ?? 10;
        }
        break;
      case 'e': {
        const ev = { t, r, n, head: r.ago !== undefined, cls: eventClass(r), key: null, src };
        if (ev.cls === 'match') ev.key = eventKey(r);
        if (r.e === 'dbComplete' && !ev.head && src.joinT === null) src.joinT = t;
        if (r.e === 'setLevel') {
          src.level = String(r.level || '').split('/').filter(Boolean).pop() || src.level;
          src.modeFile = r.mode || src.modeFile;
        }
        if (r.e === 'serverInfo') src.mod = r.mod || src.mod;
        if (r.e === 'serverName') src.server = r.name || src.server;
        src.events.push(ev);
        break;
      }
      case 'o': {
        const o = object(r.id);
        const last = o.spans[o.spans.length - 1];
        if (last && last[1] === Infinity) last[1] = t;
        o.spans.push([t, Infinity]);
        o.opens.push({ t, r });
        break;
      }
      case 's':
        for (const e of r.o ?? []) object(e[0]).keys.push([t, e[1], e[2], e[3], e[4], e[5], e[6], e[7]]);
        break;
      case 'd': {
        const last = src.objects.get(r.id)?.spans.at(-1);
        if (last && last[1] === Infinity) last[1] = t;
        break;
      }
      case 'a':
        for (const e of r.a ?? []) object(e[0]).hp.push([t, e[1], e[2]]);
        break;
      case 'st':
        for (const e of r.o ?? []) object(e[0]).st.push([t, e]);
        break;
      case 'jn':
        // A v4 recorder keyed every part 0 (round-replay-capture §16): its
        // parts are one run per hull, which no merge keeps apart.
        if (src.version < 5) break;
        for (const [root, id, tmpl, x, y, z] of r.o ?? []) {
          const c = part(root, id, t);
          c.tmpl = tmpl ?? '';
          c.first = Math.min(c.first, t);
          if ([x, y, z].every(Number.isFinite)) c.pos = [x, y, z];
        }
        break;
      case 'j':
        if (src.version < 5) break;
        for (const [root, id, qx, qy, qz, qw] of r.o ?? []) part(root, id, t).keys.push([t, qx, qy, qz, qw]);
        break;
      case 'g':
        for (const [root, revs, throttle, flags, gear, id] of r.o ?? []) {
          // A v4 engine is keyed 0 and resolves by its root.
          const key = `${root}|${id ?? 0}`;
          let c = engines.get(key);
          if (!c) {
            c = { kind: 'engine', root, id: id ?? 0, first: t, keys: [] };
            engines.set(key, c);
            childrenOf(root).push(c);
          }
          c.keys.push([t, revs, throttle, flags, gear]);
        }
        break;
      case 'p':
        for (const e of r.p ?? []) {
          if (!src.players.has(e[0])) src.players.set(e[0], []);
          src.players.get(e[0]).push([t, e]);
        }
        break;
      case 'cp':
        src.cps.push({ t, r, n });
        break;
      case 'tk':
        src.tickets.push({ t, r, n });
        break;
      case 'chat':
        src.chat.push({ t, r, n, key: `${r.pid}|${r.team}|${r.text}`, src });
        break;
      case 'f':
        src.fires.push({ t, r, n, src });
        break;
      case 'anim':
        if (!src.anim) {
          src.anim = r.states ?? [];
          src.animT = t;
        }
        break;
      case 'roster':
        src.roster = { t, r, n };
        break;
      case 'end':
        src.endT = t;
        break;
      default:
        src.other.push({ t, r, n });
    }
  }
  src.records = n;
  if (!src.header) throw new Error(`${file} is not a bf42plus recording: it has no header.`);
  // A file begun by the join opens with the database the server sends every
  // joining client, the world as it stood, up to DataBaseComplete; one begun
  // after the join opens with what the recorder kept of it (`ago`).
  if (src.joinT !== null) {
    for (const ev of src.events) if (ev.t <= src.joinT) ev.head = true;
  }
  src.midRound = src.events.some(ev => ev.r.ago !== undefined) || Boolean(src.roster);
  [src.local, src.localFrom] = findLocal(src);
  return src;
}

/** The file's recording player: the roster marks him (a file begun after the
 *  join), his rounds are marked `local`, or his trigger presses name him. */
function findLocal(src) {
  const marked = (src.roster?.r.p ?? []).find(e => e[4]);
  if (marked && Number.isInteger(marked[0])) return [marked[0], 'roster'];
  const tally = list => {
    const counts = new Map();
    for (const pid of list) if (Number.isInteger(pid) && pid >= 0) count(counts, pid);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const rounds = tally(src.fires.filter(f => f.r.local).map(f => f.r.pid));
  if (rounds !== null) return [rounds, 'own rounds'];
  const presses = tally(src.events.filter(ev => ev.r.e === 'fire').map(ev => ev.r.pid));
  if (presses !== null) return [presses, 'trigger presses'];
  return [null, 'unknown'];
}

