// A human's rounds at the server's input index (ledger DEV-14): the sidecar's
// serials for the page's words (sidecar/input.mjs InputSender, actionIndexOf),
// the page's prediction of them from an ack (viewer/input-index.js), and the
// dice that put a round on the index's point (viewer/bot-deviation.js
// pointDice, inputDice, through round-launch.js deviate). Run by
// tests/test_human_deviation.py; one JSON object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir } from '../sim/env.mjs';
import { InputSender, actionIndexOf, BUTTON } from '../sidecar/input.mjs';

const viewer = viewerDir();
await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { createInputIndex, MAX_GAP_TICKS } = await imp('input-index.js');
const { deviationPoint, deviationIndex, declaredBarrels, pointDice, inputDice, botDeviate } = await imp('bot-deviation.js');
const { deviate } = await imp('round-launch.js');
const THREE = await import('three');

const log = console.log;
console.log = () => {};
const out = {};

// --- the sidecar's serials and the page's prediction ------------------------
//
// A page word a world tick, seq = tick; the sender assigns serials as it
// enqueues and the server runs each released record under its serial. The
// ack of one word says its index (`ai`), and the page predicts every later
// word's from it.
{
  const records = [];   // { serial, tag } in release order: what the server runs
  const session = { joined: true, conn: { state: 'connected', sendData: () => records.length } };
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  // The merge law before 2026-10-25 (above three), so the burst merges.
  const s = new InputSender(session, { rate: 30, idle: 'zero', firstSerial: 5001, clock: () => now, mergeAbove: 3 });
  s.on('sent', x => records.push({ serial: x.serial, tag: x.tag, idle: x.idle }));
  const serialOfSeq = new Map();
  s.on('sent', x => { if (Number.isInteger(x.tag)) serialOfSeq.set(x.tag, x.serial); });
  const merges = [];
  s.on('merged', m => merges.push(m));
  let ack = null;
  const ix = createInputIndex({ ackOf: () => ack });
  let seq = 0;
  const word = (fire = false) => { seq += 1; s.enqueue({ buttons: fire ? BUTTON.FIRE : 0 }, seq); ix.noteSent(seq, seq); };
  const tick = () => { now += 1000 / 30; s._tick(now); };
  const ackLast = () => {
    // The server's control state for the newest record it ran that was a page word.
    const r = [...records].reverse().find(x => Number.isInteger(x.tag));
    ack = { seq: r.tag, index: actionIndexOf(r.serial) };
  };
  // What the server runs each page seq under: the first record released at
  // or past it, which is its own or the merged one carrying it (a merge
  // keeps the newest word's serial and tag, and may be merged again).
  const carrier = (q) => records.find(r => Number.isInteger(r.tag) && r.tag >= q) ?? null;

  // 1. Steady: a word a tick, one ack early on.
  for (let i = 0; i < 20; i++) { word(i % 5 === 0); tick(); }
  ackLast();
  const steady = [];
  for (let i = 0; i < 40; i++) { word(i % 5 === 0); steady.push({ seq, predicted: ix.indexAt(seq) }); tick(); }
  // 2. A hitch: nine words at once (above mergeAbove: merged), then steady.
  const hitch = [];
  for (let i = 0; i < 9; i++) { word(); hitch.push({ seq, predicted: ix.indexAt(seq) }); }
  for (let i = 0; i < 10; i++) tick();
  // 3. The page quiet for a second: idle records, each a serial.
  now += 1000;
  for (let i = 0; i < 30; i++) s._tick(now + i * (1000 / 30));
  now += 1000;
  const afterQuiet = [];
  for (let i = 0; i < 5; i++) { word(); afterQuiet.push({ seq, predicted: ix.indexAt(seq) }); tick(); }
  ackLast();
  const reacked = [];
  for (let i = 0; i < 10; i++) { word(); reacked.push({ seq, predicted: ix.indexAt(seq) }); tick(); }
  const score = rows => rows.map(r => {
    const c = carrier(r.seq);
    return { ...r, ran: c?.serial ?? null, carrierTag: c?.tag ?? null, own: serialOfSeq.has(r.seq) };
  });
  out.prediction = {
    steady: score(steady), hitch: score(hitch), afterQuiet: score(afterQuiet), reacked: score(reacked),
    merges, idle: records.filter(r => r.idle).length,
  };
  // A word further past the newest sent than a frame's catch-up: not known.
  out.gap = { at: ix.seqAt(seq + MAX_GAP_TICKS), past: ix.seqAt(seq + MAX_GAP_TICKS + 1), noAck: createInputIndex().indexAt(1) };
  out.actionIndexOf = [actionIndexOf(5623), actionIndexOf(null), actionIndexOf(1.5)];
  Date.now = realNow;
}

// --- the dice ---------------------------------------------------------------
{
  // Looking down -z with no frame: deviate's right is +x and its up +y, each
  // `u x total / 100` (DEV-9).
  const off = (k, total) => {
    const d = new THREE.Vector3(0, 0, -1);
    deviate(pointDice(k), d, total, null);
    return [d.x, d.y];
  };
  out.dice = {
    point: deviationPoint(538), off538: off(538, 0.75),
    // The bots' own path to the same point agrees.
    bot538: botDeviate([0, 0, -1], 0.75, 538),
    // A barrel-less gun (one glb muzzle, `declaredBarrels`) draws at index - 1.
    inputK: [deviationIndex(5659, declaredBarrels([{}]), 0), deviationIndex(5659, declaredBarrels(new Array(8).fill({})), 3)],
    inputOff: (() => { const d = new THREE.Vector3(0, 0, -1); deviate(inputDice(5659, [{}], 0), d, 0.75, null); return [d.x, d.y]; })(),
    none: inputDice(null, [{}], 0),
  };
}

log(JSON.stringify(out));
