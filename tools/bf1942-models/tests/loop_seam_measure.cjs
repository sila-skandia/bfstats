#!/usr/bin/env node
/**
 * The loop seam, measured: a vehicle's engine loops rendered through
 * `viewer/engine-audio.js` in an OfflineAudioContext at 48 kHz (a Mac's
 * device rate), in headless Chromium and WebKit, from three decodes of the
 * same samples:
 *
 *   wav      the source wav from the game's archive: what retail loops
 *   plain    the published MP3 through `decodeAudioData` (the page before
 *            `gapless-decode.js`)
 *   gapless  the published MP3 through `decodeGapless` (the page now)
 *
 * Every loop starts at byte 0, as the client starts one (0x008367e0), with
 * the patch attached to the listener (the driver's seat) at rpm 0.5. Past
 * the gains' settling it reports the quietest 5 ms window against the median
 * one, how many 5 ms windows fall 12 dB under the median, and the longest run
 * of near-silence. features/world-vehicle-audio/loop-seam.md has the numbers.
 *
 *   node tools/bf1942-models/tests/loop_seam_measure.cjs \
 *     --base http://localhost:<port> --level mods/fhsw/tunis-1943 \
 *     --template Willy --wavs <dir of the source wavs>
 *
 * `--base` is a running `serve_viewer.py` of this tree (it fetches a missing
 * level from mesh.bfstats.io). The wavs are named as the scene's samples
 * (`Willyengine3.wav` for `../_shared/sounds/Willyengine3.mp3`); read them
 * out of `sound.rfa` with `bf42.rfa.ArchivePool`. Not run by verify.sh.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const pw = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base');
const level = arg('level', 'mods/fhsw/tunis-1943');
const template = arg('template', 'Willy');
const wavDir = arg('wavs');
if (!base || !wavDir) {
  console.error('usage: loop_seam_measure.cjs --base URL --wavs DIR [--level L] [--template T]');
  process.exit(2);
}

(async () => {
  const scene = await (await fetch(`${base}/maps/${level}/scene.json`)).json();
  const vehicle = scene.sounds.vehicles.find(v => v.template === template);
  if (!vehicle) throw new Error(`${template} has no sound on ${level}`);
  const loops = vehicle.layers.filter(l => l.loop);
  const wavs = {};
  for (const l of loops) {
    const stem = path.basename(l.file, path.extname(l.file));
    wavs[l.file] = fs.readFileSync(path.join(wavDir, `${stem}.wav`)).toString('base64');
  }
  const first = loops[0].file;

  for (const kind of ['chromium', 'webkit']) {
    const browser = await pw[kind].launch();
    const page = await browser.newPage();
    await page.goto(`${base}/gapless-decode.js`);
    const rows = await page.evaluate(async ({ base, level, vehicle, loops, wavs, first }) => {
      const { loadEngineAudio } = await import(`${base}/engine-audio.js`);
      const { decodeGapless } = await import(`${base}/gapless-decode.js`);
      const RATE = 48000, SECONDS = 4;
      const fromBase64 = s => {
        const t = atob(s); const u = new Uint8Array(t.length);
        for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
        return u.buffer;
      };
      const mp3 = {};
      for (const l of loops) mp3[l.file] = await (await fetch(`${base}/maps/${level}/${l.file}`)).arrayBuffer();

      async function render(layers, mode) {
        const ctx = new OfflineAudioContext(1, RATE * SECONDS, RATE);
        // An offline context reads 'suspended' until it renders, and the
        // module holds its loops for a running one.
        Object.defineProperty(ctx, 'state', { get: () => 'running' });
        const listener = { context: ctx, getInput: () => ctx.destination };
        const getBuffer = async (file) => {
          if (mode === 'wav') return ctx.decodeAudioData(fromBase64(wavs[file]));
          const bytes = mp3[file].slice(0);
          return mode === 'gapless' ? decodeGapless(ctx, bytes) : ctx.decodeAudioData(bytes);
        };
        const random = Math.random;
        Math.random = () => 0;
        const audio = await loadEngineAudio({ ...vehicle, layers }, { listener, getBuffer, rand: () => 0 });
        audio.start();
        Math.random = random;
        audio.setMaster(1);
        audio.setAttachedToListener(true);
        audio.update({ dt: 2, rpm: 0.5, speed: 8, acceleration: 0, diveAngle: 0,
          position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
          listenerPosition: { x: 0, y: 0, z: 0 }, listenerForward: { x: 0, y: 0, z: -1 } });
        const out = await ctx.startRendering();
        return { data: out.getChannelData(0), lengths: [...new Set(audio.voices.map(v => v.buffer.length))] };
      }

      function measure(d) {
        const from = Math.round(RATE * 0.6);
        const win = Math.round(RATE * 0.005);
        const rms = [];
        for (let i = from; i + win <= d.length; i += win) {
          let s = 0; for (let k = 0; k < win; k++) s += d[i + k] * d[i + k];
          rms.push(Math.sqrt(s / win));
        }
        const sorted = [...rms].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        let run = 0, longest = 0;
        const quiet = median / 50;                     // -34 dB under the median window
        for (let i = from; i < d.length; i++) {
          if (Math.abs(d[i]) < quiet) { run++; longest = Math.max(longest, run); } else run = 0;
        }
        const floor = sorted[0] > 0 ? +(20 * Math.log10(sorted[0] / median)).toFixed(1) : -Infinity;
        return {
          quietestDb: floor,
          dips: rms.filter(r => r < median / 4).length,
          silenceMs: +(1000 * longest / RATE).toFixed(1),
        };
      }

      const rows = [];
      for (const [name, layers] of [[`${first} alone`, loops.filter(l => l.file === first)],
                                    ['every loop of the patch', loops]]) {
        for (const mode of ['wav', 'plain', 'gapless']) {
          const r = await render(layers, mode);
          rows.push({ name, mode, lengths: r.lengths.join('/'), ...measure(r.data) });
        }
      }
      return rows;
    }, { base, level, vehicle, loops, wavs, first });
    for (const r of rows) console.log(kind.padEnd(8), JSON.stringify(r));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
