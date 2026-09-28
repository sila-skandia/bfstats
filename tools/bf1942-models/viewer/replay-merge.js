// Several bf42plus recordings of one round, merged into one recording
// (features/round-replay-merge).
//
// A recording is one client's view. The server sends a client every event
// wherever it happens, but an object's continuous state (its pose, hit points,
// turrets, engines, body, and so its shots) only within the level's view
// distance plus 20 m of the client's viewpoint, save the controlled object of
// every living player on the client's own side, which it sends map-wide
// (features/round-replay-capture §19). One recording per side therefore covers
// every player for the whole round, and the files line up by the server's
// own ids.
//
// The merge reads the files' text and writes a v5 recording, so a merged
// file plays, and is shared, like any other:
//
// - Time. Each file's `t` is its own recorder's clock. Reliable events reach
//   every client in one order, so the event streams are matched on what each
//   event says (a kill by killer and victim, an object's creation by its id)
//   and each file's clock is fitted onto the first file's, an offset and a
//   drift over the matched pairs.
// - Events. One copy of each shared event. The join, the 10-second timer, the
//   tickets, the flags and the players' records come from one file at a time
//   (the first file recording then, its "owner"). Each file's own player's
//   hits, refills and trigger presses are kept from every file, each named for
//   its player.
// - State. Per object, per stretch of time, one file: the one whose player
//   rides it, else the one whose player is nearest it, held for a while so it
//   does not flap. Its pose, hit points, body, parts and engines all come from
//   that file. A part's or an engine's id is numbered by each recorder for
//   itself, so each file's are mapped onto one set of ids.
// - Players. The header's `merged` list names each file and its recording
//   player; the viewer follows the first.
//
// The report is the instrument for the first real pair: the fit and its
// residuals, what each file missed, how far the files disagree about the same
// object at the same moment, how often each wrote it, the players' time in
// range before and after, and what was collapsed.
//
// Three.js-free and pure: tests/replay_merge_harness.mjs runs it in node,
// merge_replays.mjs is its command line, and replay-open.js merges files
// picked together in the page. Beside it: replay-merge-read.js (a file read
// for merging), replay-merge-clock.js (the clock fit) and
// replay-merge-report.js (the report).

import {
  count, distance, ENDING_EVENTS, lastAt, ms, plain, poseAt, RANK, readRecording, spanAt, subtract,
} from './replay-merge-read.js';
import { alignAll, retime } from './replay-merge-clock.js';
import { alignmentReport, finishReport, formatMergeReport } from './replay-merge-report.js';

export { formatMergeReport };

// --- options ------------------------------------------------------------------

/**
 * Every choice the first real pair has to settle, with the default the
 * synthetic split of a real file supports (features/round-replay-merge,
 * "Options").
 */
export const MERGE_DEFAULTS = Object.freeze({
  /** Seconds apart two copies of one event may lie once the clocks are
   *  fitted. Two events of one key in one file are 0.4 s apart at the
   *  closest (an exit, replay_20260928-133433), and their order is kept. */
  eventWindow: 0.25,
  /** Seconds apart two copies of a chat-box line may lie: a player's own line
   *  shows on his screen 0.07 to 0.6 s before the server relays it to the
   *  others (round-replay-capture §11.8). */
  chatWindow: 2,
  /** A key seen at most this often in each file proposes clock offsets. */
  rareKey: 4,
  /** The offset vote's bin, seconds. */
  voteBin: 0.05,
  /** Fewer matched events than this and two files are not one round. */
  minMatches: 8,
  /** Matched events spanning fewer seconds than this fit an offset alone. */
  minDriftSpan: 120,
  /** A fitted rate further than this from 1 is refused: two PCs' clocks do
   *  not drift 0.1% apart. */
  maxDrift: 0.001,
  /** Residuals under this many seconds are never rejected as outliers. */
  outlierFloor: 0.05,
  /** How an object's file is chosen while several have it, in order:
   *  'riding' (the file whose player controls it or one of its seats),
   *  'nearest' (the file whose player is nearest it). The first file is the
   *  tie-break. */
  prefer: ['riding', 'nearest'],
  /** A nearer file takes an object over only when it is this many metres
   *  nearer than the file that has it ... */
  hysteresisMetres: 50,
  /** ... for this many seconds. */
  hysteresisSeconds: 2,
  /** Seconds between two looks at which file is nearest. */
  evalStep: 0.5,
  /** A file that will have an object for less than this many seconds more
   *  does not take it over. */
  minSwitchSpan: 0.5,
  /** How a moving part in one file is found in another: 'rank' (the k-th
   *  part of a template on the object is the k-th everywhere: the recorder
   *  walks one object's children in their creation order), 'position' (the
   *  nearest part of the template, by where `jn` places it on the object), or
   *  'disjoint' (none is; each file's parts keep ids of their own, and a part
   *  whose object changes files stops where the first file left it). Engines
   *  carry no name and match by rank unless 'disjoint'. */
  childMatch: 'rank',
  /** Whose copy of a round is kept: 'shooter' (a recording player's rounds
   *  from his own file, where they come from his input, and everybody else's
   *  from the file that has the shooter's object then) or 'state' (every
   *  round from the file that has the shooter's object then). */
  shotSource: 'shooter',
  /** Seconds added to the continuous records (samples, parts, engines,
   *  bodies, rounds) of every file after the first, beyond the event fit: a
   *  number, or one per file. The report's `pose.lag` measures it. */
  stateShift: 0,
  /** Each file's recording player, where the file cannot say (an array, one
   *  per file; null reads it off the file: its roster, its own rounds, its
   *  trigger presses). */
  local: [],
});

// --- the output --------------------------------------------------------------------

/** The merged file's records, sorted into time order at the end. Samples of
 *  one kind at one millisecond share a line, as the recorder writes them. */
class Output {
  constructor() {
    this.lines = [];
    this.groups = new Map();
    this.seq = 0;
  }

  line(t, rank, record) {
    this.lines.push({ t: ms(t), rank, seq: this.seq++, record });
  }

  entry(kind, t, entry) {
    const at = ms(t);
    const key = `${kind}|${at}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { t: at, rank: RANK[kind], seq: this.seq++, kind, entries: [] };
      this.groups.set(key, group);
      this.lines.push(group);
    }
    group.entries.push(entry);
  }

  text() {
    this.lines.sort((a, b) => a.t - b.t || a.rank - b.rank || a.seq - b.seq);
    const field = { s: 'o', a: 'a', p: 'p', jn: 'o', j: 'o', g: 'o', st: 'o' };
    const out = [];
    for (const item of this.lines) {
      if (item.record) {
        out.push(JSON.stringify({ ...item.record, ...(item.record.k === 'h' ? {} : { t: item.t }) }));
      } else {
        out.push(JSON.stringify({ k: item.kind, t: item.t, [field[item.kind]]: item.entries }));
      }
    }
    return `${out.join('\n')}\n`;
  }
}

/** `r` with its time replaced (the record's own field order kept). */
const at = (r, t) => ({ ...r, t: ms(t) });

// --- the merge ------------------------------------------------------------------------

/**
 * Merge several recordings of one round. `inputs` is `[{ name, text }]`, the
 * first the file whose clock the merge keeps and whose player it follows
 * first. Returns `{ text, report }`: a v5 recording, and what the merge
 * measured (`formatMergeReport` prints it).
 */
export function mergeRecordings(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) throw new Error('A merge needs at least two recordings.');
  const opts = { ...MERGE_DEFAULTS, ...options };
  const sources = inputs.map((input, i) => readRecording(input.name ?? `recording ${i + 1}`, input.text, i));
  sources.forEach((src, i) => {
    const forced = opts.local?.[i];
    if (Number.isInteger(forced)) {
      src.local = forced;
      src.localFrom = 'given';
    }
  });
  const report = { options: opts, warnings: [] };
  sameRound(sources, report);

  // One clock: every file's fitted onto the first's, then shifted so the
  // file that began first begins at 0.
  const fits = alignAll(sources, opts);
  const shift = -Math.min(...fits.map(f => f.a));
  const stateShift = i => (i === 0 ? 0 : Array.isArray(opts.stateShift) ? opts.stateShift[i] ?? 0 : opts.stateShift);
  const alignment = alignmentReport(sources, fits, opts);
  sources.forEach((src, i) => retime(src, t => shift + fits[i].a + fits[i].b * t, stateShift(i)));

  const ctx = new MergeContext(sources, opts, report);
  const out = new Output();
  ctx.header(out, fits);
  ctx.head(out);
  ctx.events(out);
  ctx.chat(out);
  ctx.anim(out);
  ctx.ownerStreams(out);
  ctx.objects(out);
  ctx.fires(out);
  ctx.end(out);
  const text = out.text();

  report.sources = sources.map(src => ({
    file: src.file, version: src.version, start: src.start, level: src.level, server: src.server,
    local: src.local, localFrom: src.localFrom, midRound: src.midRound, records: src.records,
    window: src.window.map(t => Number(t.toFixed(3))),
  }));
  report.alignment = alignment;
  report.merged = { duration: Number(ctx.endT.toFixed(3)), lines: text.split('\n').length - 1 };
  finishReport(ctx);
  return { text, report };
}

/** Recordings of different levels, mods or servers are not one round. */
function sameRound(sources, report) {
  const differ = field => new Set(sources.map(s => String(s[field] || '').toLowerCase()).filter(Boolean)).size > 1;
  if (differ('level')) {
    throw new Error(`These are not one round: they were recorded on ${[...new Set(sources.map(s => s.level).filter(Boolean))].join(' and ')}.`);
  }
  if (differ('mod')) report.warnings.push(`the files name different mods: ${sources.map(s => s.mod || '?').join(', ')}`);
  if (differ('server')) report.warnings.push(`the files name different servers: ${sources.map(s => s.server || '?').join(', ')}`);
  for (const src of sources) {
    if (src.version < 5) report.warnings.push(`${src.file} is format v${src.version}: its moving parts are left out`);
    if (src.local === null) report.warnings.push(`${src.file}: its recording player could not be told (no roster, no own rounds, no presses)`);
  }
}

/**
 * The merge proper, once every file is on one clock.
 */
class MergeContext {
  constructor(sources, opts, report) {
    this.sources = sources;
    this.opts = opts;
    this.report = report;
    this.endT = Math.max(...sources.map(s => s.window[1]));
    this.first = [...sources].sort((a, b) => a.window[0] - b.window[0] || a.index - b.index)[0];
    this.dropped = new Map();       // kind -> records left out as another file's copy or a file's own stale view
    this.merged = new Map();        // kind -> records written
    this.owners = this.ownerTimeline();
    this.locals = new Map();        // pid -> the file he recorded
    for (const src of sources) {
      if (src.local !== null && !this.locals.has(src.local)) this.locals.set(src.local, src);
    }
    this.creates = new Map();       // id -> sorted merged creation times
    this.destroys = new Map();      // id -> sorted merged destruction times
    this.segments = new Map();      // id -> [{ from, to, src, rep }]
    this.selection = new Map();     // how each replicated stretch's file was chosen -> seconds
    this.switches = new Map();     // why a file took an object over from another -> times
    this.childStats = { lives: 0, shared: 0, matched: 0, unmatched: 0, distances: [], rankVsPosition: 0 };
    this.playersOut = new Map();    // pid -> [[t, entry]], the merged player records
  }

  /** Which file holds the merged file's per-connection records when: the
   *  first file sampling the world then. */
  ownerTimeline() {
    const cuts = [...new Set(this.sources.flatMap(s => s.sampling))].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      const src = this.sources.find(s => s.sampling[0] <= mid && mid <= s.sampling[1]) ?? null;
      if (!src) continue;
      const last = out[out.length - 1];
      if (last && last.src === src && last.to === cuts[i]) last.to = cuts[i + 1];
      else out.push({ from: cuts[i], to: cuts[i + 1], src });
    }
    if (out.length) {
      out[0].from = -Infinity;
      out[out.length - 1].to = Infinity;
    }
    return out;
  }

  ownerAt(t) {
    for (const o of this.owners) if (t >= o.from && t < o.to) return o.src;
    return this.owners[this.owners.length - 1]?.src ?? this.sources[0];
  }

  drop(kind, n = 1) {
    count(this.dropped, kind, n);
  }

  wrote(kind, n = 1) {
    count(this.merged, kind, n);
  }

  header(out, fits) {
    const primary = this.sources[0];
    out.line(0, RANK.h, {
      k: 'h', v: 5, plus: primary.plus, start: this.first.start, hz: primary.hz,
      merged: this.sources.map((src, i) => ({
        file: src.file, start: src.start,
        offset: Number((src.window[0]).toFixed(4)),
        drift: fits[i].b === 1 ? 0 : Number((fits[i].b - 1).toExponential(3)),
        local: src.local,
      })),
    });
  }

  /** The file that began first opens the merged file with its own opening:
   *  its join, or what its recorder kept of the join (`ago`), and its roster. */
  head(out) {
    const src = this.first;
    for (const ev of src.events) {
      if (!ev.head) continue;
      out.line(ev.t, RANK.head, at(ev.r, ev.t));
      this.wrote('e');
      this.mark(ev);
    }
    if (src.roster) out.line(src.roster.t, RANK.head, at(src.roster.r, src.roster.t));
    for (const other of this.sources) {
      if (other === src) continue;
      const n = other.events.filter(ev => ev.head).length + (other.roster ? 1 : 0);
      if (n) this.drop('opening (another file began first)', n);
    }
  }

  /** An object's creation or removal, for the lives the merged file gives it. */
  mark(ev) {
    const r = ev.r;
    const add = (map, id) => {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(ev.t);
    };
    if (r.e === 'createObject' && r.netId) add(this.creates, r.netId);
    if (r.e === 'projPool' && r.netId) {
      for (let i = 0; i < Math.max(0, Math.min(r.count ?? 0, 64)); i++) add(this.creates, r.netId + i);
    }
    if (r.e === 'destroyObject' && r.netId) add(this.destroys, r.netId);
  }

  /** Each file's copies of the events `pick` chooses, clustered onto the
   *  copies of the files before it, per key and in order: `Map(key ->
   *  [{ t0, copies }])`. */
  cluster(pick, keyOf) {
    const { opts } = this;
    const clusters = new Map();
    for (const src of this.sources) {
      const mine = new Map();
      for (const ev of src.events) {
        if (ev.head || !pick(ev)) continue;
        const key = keyOf(ev, src);
        if (!mine.has(key)) mine.set(key, []);
        mine.get(key).push(ev);
      }
      for (const [key, list] of mine) {
        list.sort((a, b) => a.t - b.t || a.n - b.n);
        const have = clusters.get(key) ?? [];
        const fresh = [];
        let i = 0;
        let j = 0;
        while (j < list.length) {
          const ev = list[j];
          if (i >= have.length) {
            fresh.push({ t0: ev.t, copies: [ev] });
            j += 1;
            continue;
          }
          const d = have[i].t0 - ev.t;
          if (Math.abs(d) <= opts.eventWindow && !have[i].copies.some(c => c.src === src)) {
            have[i].copies.push(ev);
            i += 1;
            j += 1;
          } else if (d < 0) {
            i += 1;
          } else {
            fresh.push({ t0: ev.t, copies: [ev] });
            j += 1;
          }
        }
        clusters.set(key, [...have, ...fresh].sort((a, b) => a.t0 - b.t0));
      }
    }
    return clusters;
  }

  /** Every event once. */
  events(out) {
    // The shared ones: one copy each, the earliest (the latest of a removal).
    const missing = new Map(this.sources.map(s => [s, new Map()]));
    for (const list of this.cluster(ev => ev.cls === 'match', ev => ev.key).values()) {
      for (const { copies } of list) {
        const ending = ENDING_EVENTS.has(copies[0].r.e);
        const chosen = copies.reduce((best, ev) => ((ending ? ev.t > best.t : ev.t < best.t) ? ev : best));
        const record = at(chosen.r, chosen.t);
        if (record.e === 'radio') {
          // Who heard it: team radio reaches the speaker's side, a shout
          // anyone within 70 m (comms.js `receive` plays it in his tongue).
          const to = [...new Set(copies.map(c => c.src.local).filter(pid => pid !== null))];
          if (to.length) record.to = to;
        }
        out.line(chosen.t, ending ? RANK.ending : RANK.e, record);
        this.wrote('e');
        this.mark({ t: chosen.t, r: chosen.r });
        if (copies.length > 1) this.drop(`e:${chosen.r.e}`, copies.length - 1);
        for (const src of this.sources) {
          if (copies.some(c => c.src === src)) continue;
          if (chosen.t >= src.live[0] && chosen.t <= src.live[1]) count(missing.get(src), chosen.r.e);
        }
      }
    }
    this.report.events = {
      missing: this.sources.map(src => ({ file: src.file, byKind: plain(missing.get(src)) })),
    };
    // The owner's own: its timer, its status, its rules.
    for (const src of this.sources) {
      for (const ev of src.events) {
        if (ev.head || ev.cls !== 'owner') continue;
        if (this.ownerAt(ev.t) !== src) {
          this.drop(`e:${ev.r.e} (another file's own)`);
          continue;
        }
        out.line(ev.t, RANK.e, at(ev.r, ev.t));
        this.wrote('e');
      }
    }
    // Each file's own player's, named for him: once, where two files are
    // the same player's.
    const pidOf = (ev, src) => ev.r.pid ?? src.local;
    const own = this.cluster(ev => ev.cls === 'own', (ev, src) => {
      const { t, n, ...fields } = ev.r;
      return `${pidOf(ev, src)}|${JSON.stringify(fields)}`;
    });
    for (const list of own.values()) {
      for (const { copies } of list) {
        const chosen = copies[0];
        const record = at(chosen.r, chosen.t);
        const pid = pidOf(chosen, chosen.src);
        if (record.pid === undefined && pid !== null) record.pid = pid;
        out.line(chosen.t, RANK.e, record);
        this.wrote('e');
        if (copies.length > 1) this.drop(`e:${chosen.r.e}`, copies.length - 1);
      }
    }
    for (const list of [this.creates, this.destroys]) for (const times of list.values()) times.sort((a, b) => a - b);
  }

  /** Every chat-box line once: each client shows what it is sent, and its own
   *  player's lines before the server relays them. */
  chat(out) {
    const lines = this.sources.flatMap(src => src.chat).sort((a, b) => a.t - b.t || a.src.index - b.src.index);
    const open = new Map();
    for (const c of lines) {
      const list = open.get(c.key) ?? [];
      const twin = list.find(x => Math.abs(x.t - c.t) <= this.opts.chatWindow && !x.from.has(c.src));
      if (twin) {
        twin.from.add(c.src);
        this.drop('chat');
        continue;
      }
      list.push({ t: c.t, from: new Set([c.src]) });
      open.set(c.key, list);
      out.line(c.t, RANK.chat, at(c.r, c.t));
      this.wrote('chat');
    }
  }

  /** The animation state table, once. The same mod's is the same on every
   *  client; where one differs, its bodies' states are renumbered by name. */
  anim(out) {
    const withTable = this.sources.filter(src => src.anim);
    this.animMaps = new Map();
    if (!withTable.length) return;
    const table = withTable[0].anim.map(e => [...e]);
    const byName = new Map(table.map(([index, name]) => [name, index]));
    let next = Math.max(-1, ...table.map(e => e[0])) + 1;
    const identical = [];
    for (const src of withTable) {
      const same = src === withTable[0] || (src.anim.length === table.length
        && src.anim.every(([index, name], i) => table[i][0] === index && table[i][1] === name));
      identical.push({ file: src.file, identical: same });
      if (same) continue;
      const remap = new Map();
      for (const [index, name, flags] of src.anim) {
        if (!byName.has(name)) {
          byName.set(name, next);
          table.push([next, name, flags]);
          next += 1;
        }
        remap.set(index, byName.get(name));
      }
      this.animMaps.set(src, remap);
    }
    const t = Math.min(...withTable.map(src => src.animT));
    out.line(t, RANK.anim, { k: 'anim', t, states: table });
    this.report.anim = { tables: identical, states: table.length };
  }

  /**
   * The records a client keeps of state the server sends everyone -- the
   * players' records (side, controlled object, seat), the flags, the tickets
   * -- from the owner file. When another file becomes the owner, its view
   * of them is written where it differs from what the merged file says.
   */
  ownerStreams(out) {
    // The players.
    const current = new Map();
    const emitPlayer = (t, entry) => {
      const before = current.get(entry[0]);
      if (before && before.every((v, i) => v === entry[i])) return false;
      current.set(entry[0], entry);
      out.entry('p', t, entry);
      if (!this.playersOut.has(entry[0])) this.playersOut.set(entry[0], []);
      this.playersOut.get(entry[0]).push([t, entry]);
      this.wrote('p');
      return true;
    };
    const all = this.sources.flatMap(src => [...src.players.values()].flatMap(list => list.map(([t, e]) => ({ t, e, src }))));
    all.sort((a, b) => a.t - b.t || a.src.index - b.src.index);
    this.syncAtOwnerChanges(all, (item, isOwner) => {
      if (!isOwner) {
        this.drop('p');
        return;
      }
      emitPlayer(item.t, item.e);
    }, (t, src) => {
      for (const list of src.players.values()) {
        const i = lastAt(list, t);
        if (i >= 0) emitPlayer(t, list[i][1]);
      }
    });

    // The flags: a point's first record carries its name, template and place.
    const points = new Map();
    const firstOf = new Map();
    for (const src of this.sources) {
      for (const c of src.cps) if (c.r.name !== undefined && !firstOf.has(c.r.id)) firstOf.set(c.r.id, c.r);
    }
    const emitPoint = (t, r) => {
      const before = points.get(r.id);
      if (before !== undefined && before === r.team) return;
      const record = before === undefined && r.name === undefined && firstOf.has(r.id)
        ? { ...firstOf.get(r.id), team: r.team } : { ...r };
      if (before !== undefined) {
        delete record.name;
        delete record.tmpl;
        delete record.pos;
      }
      points.set(r.id, r.team);
      out.line(t, RANK.cp, at(record, t));
      this.wrote('cp');
    };
    const cps = this.sources.flatMap(src => src.cps.map(c => ({ ...c, src }))).sort((a, b) => a.t - b.t || a.src.index - b.src.index);
    this.syncAtOwnerChanges(cps, (item, isOwner) => {
      if (isOwner) emitPoint(item.t, item.r);
      else this.drop('cp');
    }, (t, src) => {
      const latest = new Map();
      for (const c of src.cps) if (c.t <= t) latest.set(c.r.id, c.r);
      for (const r of latest.values()) emitPoint(t, r);
    });

    // The tickets.
    let tickets = null;
    const emitTickets = (t, r) => {
      const v = r.v ?? [];
      if (tickets && tickets[0] === v[0] && tickets[1] === v[1]) return;
      tickets = v;
      out.line(t, RANK.tk, at(r, t));
      this.wrote('tk');
    };
    const tks = this.sources.flatMap(src => src.tickets.map(c => ({ ...c, src }))).sort((a, b) => a.t - b.t || a.src.index - b.src.index);
    this.syncAtOwnerChanges(tks, (item, isOwner) => {
      if (isOwner) emitTickets(item.t, item.r);
      else this.drop('tk');
    }, (t, src) => {
      const list = src.tickets.filter(c => c.t <= t);
      // A file's first count after it began mid-round can be 0 and 0 (the
      // server's first count not yet in): no count.
      const last = list[list.length - 1];
      if (last && (last.r.v?.[0] || last.r.v?.[1])) emitTickets(t, last.r);
    });

    // Any record this merge does not know, from the owner.
    for (const src of this.sources) {
      for (const c of src.other) {
        if (this.ownerAt(c.t) === src) out.line(c.t, RANK.other, at(c.r, c.t));
        else this.drop(`${c.r.k}`);
      }
    }
  }

  /** Walk `items` (sorted, each with `t` and `src`) handing each to `take`
   *  with whether its file is the owner then, and at each change of owner
   *  hand the new owner to `sync` first. */
  syncAtOwnerChanges(items, take, sync) {
    const changes = this.owners.slice(1).map(o => ({ t: o.from, src: o.src }));
    let c = 0;
    for (const item of items) {
      while (c < changes.length && changes[c].t <= item.t) {
        sync(changes[c].t, changes[c].src);
        c += 1;
      }
      take(item, this.ownerAt(item.t) === item.src);
    }
    for (; c < changes.length; c++) sync(changes[c].t, changes[c].src);
  }

  // --- objects -------------------------------------------------------------------

  /** The times an object with id `id` did not exist: from each removal to the
   *  next creation of that id. */
  deadSpans(id) {
    const out = [];
    const creates = this.creates.get(id) ?? [];
    for (const d of this.destroys.get(id) ?? []) {
      const next = creates.find(c => c > d) ?? Infinity;
      if (out.length && out[out.length - 1][1] >= d) continue;
      out.push([d, next]);
    }
    return out;
  }

  /** The object id's life at `t`: its index among the id's lives, counted by
   *  removals before `t`. */
  lifeIndex(id, t) {
    let i = 0;
    for (const d of this.destroys.get(id) ?? []) if (d <= t) i += 1;
    return i;
  }

  /** The object `src`'s recording player controls at `t` (the hull his seat
   *  is on), or null. */
  ridden(src, t) {
    if (src.local === null) return null;
    const list = src.players.get(src.local);
    const i = list ? lastAt(list, t) : -1;
    if (i < 0) return null;
    const e = list[i][1];
    return e.length >= 4 && e[3] >= 0 ? e[3] : e[2];
  }

  /** Where `src`'s recording player's view is at `t`: what he controls, where
   *  his own file has it. */
  viewpoint(src, t) {
    const id = this.ridden(src, t);
    if (id === null || id < 0) return null;
    const keys = src.objects.get(id)?.keys;
    return keys?.length ? poseAt(keys, t) ?? keys[0] : null;
  }

  /** How far `src`'s player is from object `id` at `t`, by `src`'s own view
   *  of both; Infinity where it cannot say. */
  distanceIn(src, id, t) {
    const eye = this.viewpoint(src, t);
    const keys = src.objects.get(id)?.keys;
    const at = keys?.length ? poseAt(keys, t) : null;
    return eye && at ? distance(eye, at) : Infinity;
  }

  /**
   * Which file each object's state comes from, when: `[{ from, to, src, rep }]`,
   * `rep` while some file has it in range (then `src` is one that does),
   * else the file that last had it (its parts and engines run on there, as
   * in a single file), or for one no file ever had in range the owner.
   */
  timeline(id) {
    const { opts } = this;
    const dead = this.deadSpans(id);
    const spansOf = new Map();
    let first = Infinity;
    for (const src of this.sources) {
      const o = src.objects.get(id);
      const spans = o ? subtract(o.spans.map(s => [...s]), dead) : [];
      spansOf.set(src, spans);
      if (spans.length) first = Math.min(first, spans[0][0]);
      for (const c of src.children.get(id) ?? []) first = Math.min(first, c.first, c.keys[0]?.[0] ?? Infinity);
    }
    if (first === Infinity) return [];
    const cuts = new Set([first]);
    for (const spans of spansOf.values()) {
      for (const [a, b] of spans) {
        cuts.add(a);
        if (b !== Infinity) cuts.add(b);
      }
    }
    for (const [a, b] of dead) {
      cuts.add(a);
      if (b !== Infinity) cuts.add(b);
    }
    for (const o of this.owners) if (Number.isFinite(o.from)) cuts.add(o.from);
    const points = [...cuts].filter(t => t >= first && t < this.endT).sort((a, b) => a - b);
    const segments = [];
    const state = { cur: null, challenger: null, since: 0, sticky: null };
    const push = (from, src, rep, why) => {
      const last = segments[segments.length - 1];
      if (last) last.to = from;
      if (last && last.src === src && last.rep === rep) return;
      if (last?.rep && rep && last.src !== src) count(this.switches, why === 'riding' || why === 'nearest' ? why : 'lost by the other');
      segments.push({ from, to: Infinity, src, rep, why });
    };
    for (let k = 0; k < points.length; k++) {
      const from = points[k];
      const to = points[k + 1] ?? this.endT;
      const inDead = dead.some(([a, b]) => from >= a && from < b);
      const candidates = inDead ? [] : this.sources.filter(src => spanAt(spansOf.get(src), from));
      if (!candidates.length) {
        state.cur = null;
        state.challenger = null;
        push(from, inDead ? null : state.sticky ?? this.ownerAt(from), false, 'none');
        continue;
      }
      // One look at the interval's start, and more every `evalStep` while
      // several files have it.
      for (let p = from; p < to; p += candidates.length > 1 ? opts.evalStep : Infinity) {
        const [src, why] = this.decide(id, p, candidates, spansOf, state);
        if (src !== state.cur || !segments.length || !segments[segments.length - 1].rep) push(p, src, true, why);
        state.cur = src;
        state.sticky = src;
        const seconds = Math.min(to, p + (candidates.length > 1 ? opts.evalStep : Infinity)) - p;
        count(this.selection, why, seconds);
      }
    }
    if (segments.length) segments[segments.length - 1].to = Infinity;
    return segments;
  }

  /** The file for object `id` at `p` among `candidates`, and why. */
  decide(id, p, candidates, spansOf, state) {
    const { opts } = this;
    if (candidates.length === 1) {
      state.challenger = null;
      return [candidates[0], 'only one file'];
    }
    if (opts.prefer.includes('riding')) {
      const riders = candidates.filter(src => this.ridden(src, p) === id);
      if (riders.length) {
        state.challenger = null;
        return [riders.includes(state.cur) ? state.cur : riders[0], 'riding'];
      }
    }
    const remaining = src => spanAt(spansOf.get(src), p)[1] - p;
    const usable = candidates.filter(src => src === state.cur || remaining(src) >= opts.minSwitchSpan);
    const pool = usable.length ? usable : candidates;
    const nearest = () => {
      let best = pool[0];
      let bestD = this.distanceIn(best, id, p);
      for (const src of pool.slice(1)) {
        const d = this.distanceIn(src, id, p);
        if (d < bestD) {
          best = src;
          bestD = d;
        }
      }
      return [best, bestD];
    };
    if (!opts.prefer.includes('nearest')) {
      state.challenger = null;
      return [pool.includes(state.cur) ? state.cur : pool[0], 'first file'];
    }
    const [best, bestD] = nearest();
    if (!pool.includes(state.cur)) {
      state.challenger = null;
      return [best, Number.isFinite(bestD) ? 'nearest' : 'first file'];
    }
    if (best !== state.cur && this.distanceIn(state.cur, id, p) - bestD > opts.hysteresisMetres) {
      if (state.challenger !== best) {
        state.challenger = best;
        state.since = p;
      } else if (p - state.since >= opts.hysteresisSeconds) {
        state.challenger = null;
        return [best, 'nearest'];
      }
    } else {
      state.challenger = null;
    }
    return [state.cur, 'held'];
  }

  /**
   * Each object's pose, hit points and body, its parts and engines, from the
   * file its timeline names, and `o`/`d` where any file has it in range or
   * none does.
   */
  objects(out) {
    const ids = new Set();
    for (const src of this.sources) {
      for (const id of src.objects.keys()) ids.add(id);
      for (const id of src.children.keys()) ids.add(id);
    }
    this.childIds = new Map();        // `${root}|${life}|${src.index}|${kind}|${id}` -> merged id
    this.named = new Set();           // merged part ids a `jn` has named
    this.nextChild = 1;
    for (const id of [...ids].sort((a, b) => a - b)) {
      const segments = this.timeline(id);
      this.segments.set(id, segments);
      this.mapChildren(id);
      let open = false;
      let lastRep = null;
      for (let k = 0; k < segments.length; k++) {
        const seg = segments[k];
        // No file has it any more, or it is gone: its `d`, as the recorder
        // writes one after a removal too.
        if (open && (!seg.rep || !seg.src)) {
          out.line(seg.from, RANK.d, { k: 'd', t: seg.from, id });
          open = false;
        }
        if (!seg.src) continue;
        const to = Math.min(seg.to, this.endT + 1);
        if (seg.rep) {
          if (!open) {
            const o = seg.src.objects.get(id);
            const opened = o.opens[lastAt(o.opens, seg.from, x => x.t)] ?? o.opens[0];
            out.line(seg.from, RANK.o, at(opened.r, seg.from));
            this.wrote('o');
          }
          open = true;
          // Another file's view taking over starts from where that file has
          // it; the same file's, back in range, goes on from its own records.
          this.emitState(out, id, seg.src, seg.from, to, lastRep !== seg.src);
          lastRep = seg.src;
        }
        const previous = segments[k - 1];
        this.emitChildren(out, id, seg.src, seg.from, to, previous?.src !== seg.src);
      }
    }
    // What each file had of the objects, left out where another's was used.
    for (const src of this.sources) {
      for (const [id, o] of src.objects) {
        const used = this.segments.get(id) ?? [];
        const kept = t => used.some(s => s.src === src && s.rep && t >= s.from && t < s.to);
        for (const [kind, list] of [['s', o.keys], ['a', o.hp], ['st', o.st]]) {
          const n = list.filter(e => !kept(e[0])).length;
          if (n) this.drop(`${kind} (another file's view)`, n);
        }
      }
    }
  }

  /** `src`'s pose, hit points and body of `id` for `[from, to)`: where they
   *  stand at `from` when `fresh` (the file has just taken the object over),
   *  then every change. */
  emitState(out, id, src, from, to, fresh) {
    const o = src.objects.get(id);
    const write = (kind, list, entry) => {
      const i = lastAt(list, from);
      if (i >= 0 && (fresh || list[i][0] >= from)) {
        out.entry(kind, fresh ? from : list[i][0], entry(list[i]));
        this.wrote(kind);
      }
      for (let j = i + 1; j < list.length && list[j][0] < to; j++) {
        out.entry(kind, list[j][0], entry(list[j]));
        this.wrote(kind);
      }
    };
    write('s', o.keys, k => [id, k[1], k[2], k[3], k[4], k[5], k[6], k[7]]);
    write('a', o.hp, k => [id, k[1], k[2]]);
    const remap = this.animMaps.get(src);
    write('st', o.st, ([, e]) => (remap ? [e[0], remap.get(e[1]) ?? e[1], remap.get(e[2]) ?? e[2], ...e.slice(3)] : e));
  }

  /** The merged id of `src`'s child `c` of object `root`. */
  childId(root, src, c) {
    return this.childIds.get(`${root}|${this.lifeIndex(root, c.first)}|${src.index}|${c.kind}|${c.id}`) ?? null;
  }

  /**
   * One set of ids for an object's parts and engines, whichever file writes
   * them: per life of the object, each file's are mapped onto the first
   * file's to have any (`childMatch`), and the rest take ids of their own.
   */
  mapChildren(root) {
    const { childMatch } = this.opts;
    const lives = new Map();
    for (const src of this.sources) {
      for (const c of src.children.get(root) ?? []) {
        // A part belongs to the life it was first seen in: lives are cut at
        // removals, and a part comes with its object's first sample.
        const key = `${this.lifeIndex(root, c.first)}`;
        if (!lives.has(key)) lives.set(key, new Map());
        const bySrc = lives.get(key);
        if (!bySrc.has(src)) bySrc.set(src, []);
        bySrc.get(src).push(c);
      }
    }
    for (const [life, bySrc] of lives) {
      const files = [...bySrc.keys()].sort((a, b) => a.index - b.index);
      const ref = files[0];
      const idOf = new Map();
      const assign = (src, c, merged) => this.childIds.set(`${root}|${life}|${src.index}|${c.kind}|${c.id}`, merged);
      for (const c of bySrc.get(ref)) {
        const merged = this.nextChild++;
        idOf.set(c, merged);
        assign(ref, c, merged);
      }
      this.childStats.lives += 1;
      if (files.length > 1) this.childStats.shared += 1;
      for (const src of files.slice(1)) {
        const mine = bySrc.get(src);
        const pairs = childMatch === 'disjoint' ? new Map() : this.pairChildren(bySrc.get(ref), mine, childMatch);
        for (const c of mine) {
          const twin = pairs.get(c);
          if (twin) {
            assign(src, c, idOf.get(twin));
            this.childStats.matched += 1;
            if (c.pos && twin.pos) this.childStats.distances.push(Math.hypot(c.pos[0] - twin.pos[0], c.pos[1] - twin.pos[1], c.pos[2] - twin.pos[2]));
          } else {
            assign(src, c, this.nextChild++);
            this.childStats.unmatched += 1;
          }
        }
        if (childMatch !== 'disjoint') {
          const other = this.pairChildren(bySrc.get(ref), mine, childMatch === 'rank' ? 'position' : 'rank');
          for (const [c, twin] of pairs) if (other.has(c) && other.get(c) !== twin) this.childStats.rankVsPosition += 1;
        }
      }
    }
  }

  /** `mine`'s parts and engines paired with `ref`'s: `Map(mine -> ref)`. */
  pairChildren(ref, mine, how) {
    const pairs = new Map();
    const group = list => {
      const out = new Map();
      for (const c of [...list].sort((a, b) => a.id - b.id)) {
        const key = c.kind === 'engine' ? 'engine' : `part|${c.tmpl}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(c);
      }
      return out;
    };
    const theirs = group(ref);
    for (const [key, list] of group(mine)) {
      const candidates = theirs.get(key) ?? [];
      if (how === 'position' && key !== 'engine') {
        const options = [];
        for (const c of list) {
          for (const r of candidates) {
            const d = c.pos && r.pos ? Math.hypot(c.pos[0] - r.pos[0], c.pos[1] - r.pos[1], c.pos[2] - r.pos[2]) : Infinity;
            options.push([d, c, r]);
          }
        }
        options.sort((a, b) => a[0] - b[0]);
        const taken = new Set();
        for (const [, c, r] of options) {
          if (pairs.has(c) || taken.has(r)) continue;
          pairs.set(c, r);
          taken.add(r);
        }
      } else {
        list.forEach((c, k) => {
          if (candidates[k]) pairs.set(c, candidates[k]);
        });
      }
    }
    return pairs;
  }

  /** `src`'s parts and engines of `root` for `[from, to)`, under merged ids:
   *  where they stand at `from` when the file changed there, then every
   *  change, and a `jn` for a part the merged file has not named. */
  emitChildren(out, root, src, from, to, changed) {
    for (const c of src.children.get(root) ?? []) {
      if (c.first >= to) continue;
      const id = this.childId(root, src, c);
      if (id === null) continue;
      const start = Math.max(from, c.first);
      if (c.kind === 'part' && !this.named.has(id)) {
        this.named.add(id);
        out.entry('jn', start, [root, id, c.tmpl, ...(c.pos ?? [])]);
        this.wrote('jn');
      }
      const kind = c.kind === 'part' ? 'j' : 'g';
      const entry = k => (c.kind === 'part' ? [root, id, k[1], k[2], k[3], k[4]] : [root, k[1], k[2], k[3], k[4], id]);
      const i = lastAt(c.keys, from);
      if (i >= 0 && (changed || c.keys[i][0] >= from)) {
        out.entry(kind, from, entry(c.keys[i]));
        this.wrote(kind);
      }
      for (let j = i + 1; j < c.keys.length && c.keys[j][0] < to; j++) {
        out.entry(kind, c.keys[j][0], entry(c.keys[j]));
        this.wrote(kind);
      }
    }
  }

  /** The file whose state object `id` has at `t` while one has it in range,
   *  or null. */
  stateFileAt(id, t) {
    const seg = (this.segments.get(id) ?? []).find(s => t >= s.from && t < s.to);
    return seg?.rep ? seg.src : null;
  }

  /**
   * Every round once. The same round is in every file that had its shooter
   * in range, each client firing it from the trigger flags the server sent
   * (round-replay-capture §14). A recording player's own rounds are kept from
   * his own file, where they come from his input; everybody else's from the
   * file whose view of the shooter's object is used then.
   */
  fires(out) {
    for (const src of this.sources) {
      for (const f of src.fires) {
        const shooter = f.r.pid;
        const own = this.opts.shotSource === 'shooter' ? this.locals.get(shooter) : null;
        let keep;
        if (own && f.t >= own.window[0] && f.t <= own.window[1]) {
          keep = own === src;
        } else {
          const file = this.stateFileAt(f.r.id, f.t);
          keep = file ? file === src : this.ownerAt(f.t) === src;
        }
        if (!keep) {
          this.drop('f');
          continue;
        }
        out.line(f.t, RANK.f, at(f.r, f.t));
        this.wrote('f');
      }
    }
  }

  end(out) {
    out.line(this.endT, RANK.end, { k: 'end', t: this.endT });
  }

}
