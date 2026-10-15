// Decode coverage: how much of what the server sends a sidecar actually
// understands. Reads a sidecar recording plus its review log and reports, per
// event type and per object class, what came off the wire and what is still
// raw. This is the measure of "we collect and understand the events"; the
// review log is the corpus, this is the scoreboard.
//
//   node sidecar/coverage.mjs run.ndjson [run.review.ndjson] [--json]
//
// The recording holds what decoded (events, objects, transform samples, state
// rows). The review log holds what did not: unknown event types, framed ghost
// records whose class has no body decoder yet, ghost blocks that would not
// frame, unknown datagram types, decode errors.
//
// Two totals matter. Events: every event the server sent either decoded or was
// logged unknown, so decoded + unknown is the whole event stream. Object
// updates: the ghost stream frames every per-object delta, so each record is
// counted and grouped by the object's template, which says which class decoder
// buys the most.

import fs from 'node:fs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
const recPath = files[0] ?? 'run.ndjson';
const reviewPath = files[1] ?? recPath.replace(/\.ndjson$/, '.review.ndjson');

function readLines(path) {
  if (!fs.existsSync(path)) return null;
  return fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

const recLines = readLines(recPath);
const reviewLines = readLines(reviewPath);
if (!recLines) {
  console.error(`no recording at ${recPath}`);
  process.exit(1);
}

// ---- the recording: what decoded ------------------------------------------
const events = new Map();      // event type -> count
const netIdInfo = new Map();   // netId -> { tid, tmpl, team }
const samplesByNetId = new Map(); // netId -> transform sample count
const stateRows = new Map();   // netId -> state row count
let header = null, end = null, animStates = 0, duration = 0;
const createObjects = new Map(); // netId -> tid

for (const line of recLines) {
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.t > duration) duration = j.t;
  switch (j.k) {
    case 'h': header = j; break;
    case 'end': end = j; break;
    case 'anim': animStates = (j.states ?? []).length; break;
    case 'e':
      events.set(j.e, (events.get(j.e) || 0) + 1);
      if (j.e === 'createObject' && j.netId != null) createObjects.set(j.netId, j.tid);
      break;
    case 'o':
      netIdInfo.set(j.id, { tid: j.tid, tmpl: j.tmpl || '', team: j.team });
      break;
    case 's':
      for (const o of j.o) samplesByNetId.set(o[0], (samplesByNetId.get(o[0]) || 0) + 1);
      break;
    case 'st':
      for (const o of j.o) stateRows.set(o[0], (stateRows.get(o[0]) || 0) + 1);
      break;
  }
}

// ---- the review log: what did not -----------------------------------------
const tags = new Map();
const unknownEvents = new Map();  // event id -> count
const ghostByNetId = new Map();   // netId -> { records, action1, removed, bits }
const bodyLengths = new Map();    // bit length -> count
const rawBlocks = [];
const unknownDatagrams = new Map();
const decodeErrors = [];

for (const line of (reviewLines ?? [])) {
  let j; try { j = JSON.parse(line); } catch { continue; }
  tags.set(j.tag, (tags.get(j.tag) || 0) + 1);
  switch (j.tag) {
    case 'unknown-event':
      unknownEvents.set(j.id, (unknownEvents.get(j.id) || 0) + 1);
      break;
    case 'ghost-record': {
      const e = ghostByNetId.get(j.netId) ?? { records: 0, updates: 0, removed: 0, bits: 0 };
      e.records++;
      if (j.action === 1) e.updates++;
      else if (j.action === 3) e.removed++;
      if (j.bodyBits != null) { e.bits += j.bodyBits; bodyLengths.set(j.bodyBits, (bodyLengths.get(j.bodyBits) || 0) + 1); }
      ghostByNetId.set(j.netId, e);
      break;
    }
    case 'ghost-block-raw': rawBlocks.push(j); break;
    case 'unknown-datagram': unknownDatagrams.set(j.type, (unknownDatagrams.get(j.type) || 0) + 1); break;
    case 'decode-error': decodeErrors.push(j); break;
  }
}

// ---- the join: an object's class is its template --------------------------
const nameOf = (netId) => {
  const info = netIdInfo.get(netId);
  if (info?.tmpl) return info.tmpl;
  const tid = createObjects.get(netId);
  return tid != null ? `tid:${tid}` : '';
};

const byClass = new Map(); // template -> { objects, records, bits, decoded }
for (const [netId, g] of ghostByNetId) {
  const tmpl = nameOf(netId) || '(unknown object)';
  const e = byClass.get(tmpl) ?? { objects: 0, records: 0, bits: 0, samples: 0, decoded: false };
  e.objects++;
  e.records += g.records;
  e.bits += g.bits;
  e.samples += samplesByNetId.get(netId) || 0;
  if (e.samples > 0) e.decoded = true; // a transform sample means a body decoder ran
  byClass.set(tmpl, e);
}

const decodedEvents = [...events.values()].reduce((a, b) => a + b, 0);
const unknownEventTotal = [...unknownEvents.values()].reduce((a, b) => a + b, 0);
const ghostRecords = [...ghostByNetId.values()].reduce((a, b) => a + b.records, 0);
const decodedObjects = [...byClass.values()].filter((e) => e.decoded).reduce((a, b) => a + b.objects, 0);
const undecodedObjects = [...byClass.values()].filter((e) => !e.decoded).reduce((a, b) => a + b.objects, 0);

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '-');
const sortDesc = (m, key = 1) => [...m.entries()].sort((a, b) => (b[key]?.records ?? b[1]) - (a[key]?.records ?? a[1]));

if (json) {
  console.log(JSON.stringify({
    recording: recPath, review: reviewLines ? reviewPath : null,
    header, duration, animStates,
    events: { decoded: decodedEvents, unknown: unknownEventTotal, byType: Object.fromEntries(events) },
    unknownEvents: Object.fromEntries([...unknownEvents].map(([id, n]) => ['0x' + id.toString(16), n])),
    ghost: { records: ghostRecords, objects: ghostByNetId.size, decodedObjects, undecodedObjects },
    byClass: Object.fromEntries(byClass),
    bodyLengths: Object.fromEntries([...bodyLengths].sort((a, b) => b[1] - a[1])),
    rawBlocks: rawBlocks.length, unknownDatagrams: Object.fromEntries(unknownDatagrams),
    decodeErrors: decodeErrors.length,
  }, null, 2));
  process.exit(0);
}

console.log(`recording ${recPath}  (${recLines.length} lines, ${duration.toFixed(1)} s)`);
console.log(`review    ${reviewLines ? reviewPath : '(none)'}`);
console.log(`header    ${JSON.stringify(header)}`);
console.log('');

console.log('EVENTS');
console.log(`  decoded ${decodedEvents}   unknown ${unknownEventTotal}   coverage ${pct(decodedEvents, decodedEvents + unknownEventTotal)}`);
const evSorted = [...events].sort((a, b) => b[1] - a[1]);
for (const [name, n] of evSorted) console.log(`    ${String(n).padStart(6)}  ${name}`);
if (unknownEvents.size) {
  console.log('  unknown types (7-bit id):');
  for (const [id, n] of [...unknownEvents].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(6)}  0x${id.toString(16)}`);
  }
}
console.log('');

console.log('OBJECT UPDATES (the ghost stream)');
console.log(`  framed records ${ghostRecords} over ${ghostByNetId.size} objects`);
console.log(`  objects with a body decoder ${decodedObjects}   without ${undecodedObjects}   coverage ${pct(decodedObjects, decodedObjects + undecodedObjects)}`);
console.log('');
console.log('  by class (template):');
console.log(`    ${'records'.padStart(8)}  ${'objects'.padStart(7)}  ${'bits/rec'.padStart(8)}  ${'samples'.padStart(7)}  decoded  template`);
for (const [tmpl, e] of sortDesc(byClass, 'records')) {
  const bits = e.records ? (e.bits / e.records).toFixed(1) : '-';
  console.log(`    ${String(e.records).padStart(8)}  ${String(e.objects).padStart(7)}  ${String(bits).padStart(8)}  ${String(e.samples).padStart(7)}  ${(e.decoded ? 'yes' : 'NO ').padStart(7)}  ${tmpl}`);
}
console.log('');
console.log('  body bit lengths (the class signature):');
for (const [len, n] of [...bodyLengths].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`    ${String(n).padStart(6)}  ${len} bits (0x${len.toString(16)})`);
}
console.log('');

console.log('REMAINING RAW');
console.log(`  ghost blocks that would not frame ${rawBlocks.length}`);
for (const b of rawBlocks.slice(0, 3)) console.log(`    seq ${b.seq} ${b.reason ?? ''} ${String(b.hex).slice(0, 60)}`);
console.log(`  unknown datagram types ${unknownDatagrams.size}`);
for (const [t, n] of unknownDatagrams) console.log(`    ${n}  0x${t.toString(16)}`);
console.log(`  decode errors ${decodeErrors.length}`);
for (const e of decodeErrors.slice(0, 5)) console.log(`    ${e.where} seq ${e.seq}: ${e.message}`);
if (end) console.log(`\nend record ${JSON.stringify(end)}`);
