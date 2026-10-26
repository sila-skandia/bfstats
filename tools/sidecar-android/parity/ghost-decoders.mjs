// Writes core/src/test/resources/parity/ghost-decoders.json.gz: every ghost
// body decoder (ghost/*.mjs, soldier-ghost.mjs) run over real framed records
// with several option sets, strict and lenient, and verify.mjs's strict
// census of each decoder over the whole corpus. The records are the review
// logs parity/rebuild.mjs committed; the ones read in full are listed in the
// fixture, so the Kotlin GhostDecodersTest reads exactly them.
//   node parity/ghost-decoders.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RES, SIDECAR, gunzip, writeGz, scratchCache, parityEnv, ensureTables } from './lib.mjs';

ensureTables();
Object.assign(process.env, parityEnv(scratchCache(false)));
const imp = (f) => import(path.join(SIDECAR, f));
const { decodeSoldierBody } = await imp('soldier-ghost.mjs');
const { decodePcoBody, decodeSeatBody } = await imp('ghost/pco.mjs');
const { decodePlayerBody } = await imp('ghost/player.mjs');
const { decodeControlPointBody } = await imp('ghost/control-point.mjs');
const { decodeKitBody } = await imp('ghost/kit.mjs');
const { decodeProjectileBody } = await imp('ghost/projectile.mjs');
const { decodeEngineBody } = await imp('ghost/engine.mjs');
const { decodeFireArmsBody } = await imp('ghost/firearms.mjs');
const { decodeFreeCameraBody } = await imp('ghost/free-camera.mjs');
const { decodeItemBody } = await imp('ghost/item.mjs');
const { decodeObjectiveBody } = await imp('ghost/objective.mjs');
const { decodeRotationalBundleBody, rotationalBundleBodyBits } = await imp('ghost/rotational-bundle.mjs');
const { decodeSimpleObjectBody } = await imp('ghost/simple-object.mjs');
const { decodeSpringBody } = await imp('ghost/spring.mjs');
const { decodeScoreBody, looksLikeScoreBody } = await imp('ghost/score-manager.mjs');
const { decodeSpawnManagerBody, looksLikeSpawnManagerBody } = await imp('ghost/spawn-manager.mjs');
const { seatSpecFor } = await imp('ghost/children.mjs');
const { verifyDecoder, claimedNetIds, loadCorpus } = await imp('ghost/verify.mjs');

const REF = [870, 97, 873];
// name -> (hex, bits) => result; the option sets are part of the name.
const SETS = {
  soldier: (h, b) => decodeSoldierBody(h, b, {}),
  soldier_anim: (h, b) => decodeSoldierBody(h, b, { animStates: 1395 }),
  soldier_wide: (h, b) => decodeSoldierBody(h, b, { animStates: 2000, maxHp: 100, aimPitchLimit: 30, aimTwistLimit: 10, baselinePos: REF }),
  soldier_base: (h, b) => decodeSoldierBody(h, b, { animStates: 1395, quatBits: 32, baseline: { pos: [1, 2, 3], vel: [0.1, 0.2, 0.3], vecA: null } }),
  soldier_strict: (h, b) => decodeSoldierBody(h, b, { animStates: 1395, strict: true }),
  player: (h, b) => decodePlayerBody(h, b, { strict: false }),
  cp: (h, b) => decodeControlPointBody(h, b, {}),
  kit: (h, b) => decodeKitBody(h, b, { strict: false }),
  kit_strict: (h, b) => decodeKitBody(h, b, { strict: true }),
  projectile: (h, b) => decodeProjectileBody(h, b, { ref: REF, strict: false }),
  projectile_strict: (h, b) => decodeProjectileBody(h, b, { strict: true }),
  engine: (h, b) => decodeEngineBody(h, b, {}),
  engine_gears: (h, b) => decodeEngineBody(h, b, { numGears: 2, strict: true }),
  firearms: (h, b) => decodeFireArmsBody(h, b, { magA: 30, magB: 4 }),
  firearms_strict: (h, b) => decodeFireArmsBody(h, b, { strict: true }),
  freecam: (h, b) => decodeFreeCameraBody(h, b, { baselinePos: REF }),
  item: (h, b) => decodeItemBody(h, b, { strict: false }),
  objective: (h, b) => decodeObjectiveBody(h, b, {}),
  rotational: (h, b) => decodeRotationalBundleBody(h, b, { rateLimits: [2, 3, 4] }),
  simple: (h, b) => decodeSimpleObjectBody(h, b, { maxHp: 50, quatBits: 16 }),
  simple_full: (h, b) => decodeSimpleObjectBody(h, b, { fullQuat: false, baselinePos: REF, strict: true }),
  spring: (h, b) => decodeSpringBody(h, b, { refA: REF }),
  score: (h, b) => ({ looks: looksLikeScoreBody(h, b), body: decodeScoreBody(h, b) }),
  spawn: (h, b) => { const n = looksLikeSpawnManagerBody(h, b); return { n, body: decodeSpawnManagerBody(h, b, n || 24) }; },
  pco_m3a1: (h, b) => decodePcoBody(h, b, { template: 'M3A1', strict: false }),
  pco_sherman_ref: (h, b) => decodePcoBody(h, b, { template: 'Sherman', strict: false, ref: REF, maxHp: 120, mobile: true }),
  pco_auto: (h, b) => decodePcoBody(h, b, { strict: false }),
  pco_children: (h, b) => decodePcoBody(h, b, { children: ['E', 'S', 'R', 'O', 'F'], mags: [[5, 3]], objects: [{ hpBits: 4, mobile: false }], strict: false }),
  pco_strict: (h, b) => decodePcoBody(h, b, { template: 'Zero', strict: true, quatBits: 32 }),
  seat_m3a1: (h, b) => decodeSeatBody(h, b, seatSpecFor('M3A1', 1), { strict: false }),
};
// The decoders verify.mjs takes, census over every record.
const CENSUS = ['soldier_anim', 'soldier_strict', 'player', 'cp', 'kit', 'projectile', 'engine', 'firearms', 'freecam', 'item',
  'objective', 'rotational', 'simple', 'spring', 'pco_m3a1', 'pco_auto', 'seat_m3a1'];

const run = (f, h, b) => { try { return { ok: f(h, b) }; } catch (e) { return { threw: e?.message ?? String(e) }; } };

// The corpus: every framed action-1 record of the committed review logs.
const corpus = [];
for (const name of ['run', 'm3a1', 'zero_sherman', 'player_stats', 'fire_line', 'detonate']) {
  const text = gunzip(path.join(RES, 'rebuild', `${name}.review.ndjson.gz`));
  for (const r of loadCorpusText(text)) corpus.push({ ...r, src: name });
}
function loadCorpusText(text) {
  const tmp = path.join(os.tmpdir(), `parity-corpus-${process.pid}.ndjson`);
  fs.writeFileSync(tmp, text);
  try { return loadCorpus(tmp); } finally { fs.rmSync(tmp); }
}

// Read in full: 140 records spread over the corpus, and a few edge cases.
const step = Math.max(1, Math.floor(corpus.length / 140));
const picked = corpus.filter((_, i) => i % step === 0).slice(0, 140).map((r) => [r.hex, r.bodyBits]);
picked.push(['', 0], ['00', 8], ['ff', 3], ['ffffffffffffffffffff', 80], ['0123456789abcdef', 64], ['ffffff', 24], ['ffffff00000000000000000000000000000000', 200]);

const decoded = {};
for (const [name, f] of Object.entries(SETS)) decoded[name] = picked.map(([h, b]) => JSON.stringify(run(f, h, b)));
const census = {};
for (const name of CENSUS) {
  const r = verifyDecoder((h, b, o) => SETS[name](h, b, o), corpus);
  census[name] = { totals: r.totals, byNetId: [...r.byNetId].map(([k, v]) => [k, v]), claimed: claimedNetIds(r, new Map()) };
}
const misc = { rotationalBits: Array.from({ length: 130 }, (_, m) => rotationalBundleBodyBits(m)) };

writeGz(path.join(RES, 'ghost-decoders.json.gz'), JSON.stringify({
  logs: ['run', 'm3a1', 'zero_sherman', 'player_stats', 'fire_line', 'detonate'], corpusSize: corpus.length, records: picked, decoded, census, misc,
}));
console.log(`${picked.length} records x ${Object.keys(SETS).length} option sets; census of ${CENSUS.length} decoders over ${corpus.length} records`);
