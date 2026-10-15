// Strict verification of a ghost-body decoder against the framed corpus.
//
// The corpus is the review log: every per-object ghost record with its netId
// and its body bit length. A class decoder is correct when, for every record
// of the objects it claims, the read completes without running past the end
// AND stops on exactly the last bit. Two numbers, both required:
//
//   threw   the read ran past the body (BitReader underflow) or the decoder
//           raised. A decoder that catches its own underflow hides this and
//           reports a clean consumption, so a decoder verified here must let
//           errors propagate.
//   over    the read completed but stopped short of the end, or past it.
//
// The trap this exists to catch: BitReader.readBit throws at the end of the
// body, so a decoder that swallows the throw and reports its cursor position
// reports exactly bodyBits and looks perfect while having decoded nothing.
// An early check of the M3A1 body scored 99.5% "exact" that way; strict, it
// is 0%, because its 0x1001 mask asks for a 113-bit position read inside a
// 108-bit body.
//
//   node sidecar/ghost/verify.mjs <decoder.mjs> <exportName> [corpus] [--names run.ndjson]
//
// The decoder module must export a function (bodyHex, bodyBits, opts) that
// returns an object with `consumed` (bits read) or throws.

import fs from 'node:fs';
import path from 'node:path';

export function loadCorpus(corpusPath) {
  const out = [];
  for (const line of fs.readFileSync(corpusPath, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.tag !== 'ghost-record' || j.action !== 1 || j.bodyBits == null) continue;
    out.push({ netId: j.netId, bodyBits: j.bodyBits, hex: j.hex, tick: j.tick, seq: j.seq });
  }
  return out;
}

// netId -> template name, from a recording's k:"o" records and createObject
// events (the sidecar writes both).
export function loadNames(recPath) {
  const tmpl = new Map();
  for (const line of fs.readFileSync(recPath, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.k === 'o') tmpl.set(j.id, j.tmpl || '');
    else if (j.k === 'e' && j.e === 'createObject' && j.tmpl) tmpl.set(j.netId, j.tmpl);
  }
  return tmpl;
}

// Run a decoder over the corpus. Returns { byNetId: Map, totals }.
//
// Beyond consumption, a decoded position is checked for plausibility: a body
// that reads to the last bit can still decode to nonsense, which is exactly
// what happened when a compressed vector's delta reference was taken from the
// object's last position instead of zero (a live soldier's track reached
// kilometres in seconds while every read landed exactly). `insane` counts
// records whose position is not a finite number, or is outside any BF1942 map.
const INSANE_ABS = 100000;
export function verifyDecoder(decode, corpus, opts = {}) {
  const byNetId = new Map();
  for (const rec of corpus) {
    const e = byNetId.get(rec.netId) ?? { records: 0, strict: 0, over: 0, under: 0, threw: 0, insane: 0, bits: 0 };
    e.records++;
    e.bits += rec.bodyBits;
    let consumed = null;
    let out = null;
    try {
      out = decode(rec.hex, rec.bodyBits, { ...opts, strict: true });
      consumed = out?.consumed ?? null;
    } catch { e.threw++; byNetId.set(rec.netId, e); continue; }
    if (consumed == null) { e.threw++; byNetId.set(rec.netId, e); continue; }
    if (consumed === rec.bodyBits) e.strict++;
    else if (consumed > rec.bodyBits) e.over++;
    else e.under++;
    const p = out?.pos;
    if (p && (!p.every(Number.isFinite) || p.some((v) => Math.abs(v) > INSANE_ABS))) e.insane++;
    byNetId.set(rec.netId, e);
  }
  const totals = { records: 0, strict: 0, over: 0, under: 0, threw: 0, insane: 0 };
  for (const e of byNetId.values()) {
    totals.records += e.records; totals.strict += e.strict;
    totals.over += e.over; totals.under += e.under; totals.threw += e.threw;
    totals.insane += e.insane;
  }
  return { byNetId, totals };
}

// netIds the decoder consumes cleanly on every record, with the template names
// they carry. This is how a class's objects are identified when the wire does
// not say which class an object is: only the right class's decoder reads its
// bodies to the last bit every time.
export function claimedNetIds(result, names, minRecords = 5) {
  const out = [];
  for (const [netId, e] of result.byNetId) {
    if (e.records >= minRecords && e.strict === e.records) out.push({ netId, tmpl: names?.get(netId) ?? '', records: e.records });
  }
  return out.sort((a, b) => b.records - a.records);
}

async function main() {
  const args = process.argv.slice(2);
  const namesIdx = args.indexOf('--names');
  const namesPath = namesIdx >= 0 ? args[namesIdx + 1] : null;
  const pos = args.filter((a, i) => !a.startsWith('--') && i !== namesIdx + 1);
  const [modPath, exportName, corpusPath = 'run.review.ndjson'] = pos;
  if (!modPath || !exportName) {
    console.error('usage: node sidecar/ghost/verify.mjs <decoder.mjs> <exportName> [corpus] [--names run.ndjson]');
    process.exit(2);
  }
  const mod = await import(path.resolve(modPath));
  const decode = mod[exportName];
  if (typeof decode !== 'function') { console.error(`no export ${exportName} in ${modPath}`); process.exit(2); }

  const corpus = loadCorpus(corpusPath);
  const names = namesPath ? loadNames(namesPath) : new Map();
  const result = verifyDecoder(decode, corpus);
  const t = result.totals;
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '-');

  console.log(`${exportName} over ${t.records} records: strict ${t.strict} (${pct(t.strict, t.records)}), under ${t.under}, over ${t.over}, threw ${t.threw}, insane ${t.insane}`);
  console.log('');
  console.log('netId  tmpl                    records  strict   pct   under   over  threw insane');
  for (const [netId, e] of [...result.byNetId].sort((a, b) => b[1].records - a[1].records).slice(0, 24)) {
    console.log(
      String(netId).padStart(5), (names.get(netId) || '?').padEnd(22),
      String(e.records).padStart(8), String(e.strict).padStart(7),
      pct(e.strict, e.records).padStart(6), String(e.under).padStart(7),
      String(e.over).padStart(6), String(e.threw).padStart(6), String(e.insane).padStart(6),
    );
  }
  const claimed = claimedNetIds(result, names);
  console.log('');
  if (claimed.length) {
    console.log(`claimed clean on every record (>=5): ${claimed.map((c) => `${c.netId}${c.tmpl ? `(${c.tmpl})` : ''}:${c.records}`).join(' ')}`);
  } else {
    console.log('claims nothing cleanly: no netId decodes to the last bit on every record.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
