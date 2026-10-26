#!/usr/bin/env node
// A scripted page: connects to a sidecar's page socket (or page-relay.mjs's)
// and plays a page-script JSON (the format page-relay.mjs --script reads:
// {t, open}, {t, close}, {t, text: <action row>}, {t, words: {secs, input,
// look, fireEvery}}, t in seconds from now). Exits after the last step.
//
//   node parity/live/page-script.mjs 17996 script.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { encodeInputFrame } = await import(path.resolve(HERE, '../../../bf1942-models/viewer/netcode.js'));
const [port, file] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
let ws = null, seq = 1;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
for (const st of steps) {
  const wait = st.t * 1000 - (performance.now() - t0);
  if (wait > 0) await delay(wait);
  if (st.open) {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    continue;
  }
  if (!ws) continue;
  if (st.close) { ws.close(); ws = null; continue; }
  if (st.text) { ws.send(`\x05${JSON.stringify(st.text)}`); console.log(st.t, st.text.type); continue; }
  if (st.words) {
    const w = st.words, until = performance.now() + w.secs * 1000;
    (async () => {
      while (ws && performance.now() < until) {
        const fire = w.fireEvery && seq % w.fireEvery === 0;
        ws.send(Buffer.concat([Buffer.from([2]), Buffer.from(encodeInputFrame(seq, fire ? { ...w.input, fire: true } : w.input, w.look ?? { x: 0, y: 0 }))]));
        seq++;
        await delay(1000 / 30);
      }
    })();
  }
}
await delay(500);
process.exit(0);
