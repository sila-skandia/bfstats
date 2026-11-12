#!/usr/bin/env node
// Renders the remaster audio scenarios to WAVs (features/remaster-browser/
// AUDIO.md) and checks map.html under `?remaster` for page errors.
//
//   python3 tools/bf1942-models/serve_viewer.py 5391 &
//   node tools/bf1942-models/tests/remaster_audio_render.mjs [--port 5391] [--only a_retail,...] [--no-page]
//
// Headless Chrome (Playwright from ui/node_modules). Nobody can listen in a
// headless browser, so every scenario is an OfflineAudioContext render
// (`remaster_audio_rig.html`, routed in at the viewer's root) through the
// page's own modules and real samples; the WAVs land in
// features/remaster-browser/audio/ and the numbers (levels, onsets,
// spectral centroids, the chain's snapshot) in audio/measurements.json.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(REPO, 'features', 'remaster-browser', 'audio');
const require = createRequire(path.join(REPO, 'ui', 'package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const PORT = Number(opt('port', 5391));
const ONLY = opt('only', null)?.split(',');
const BASE = `http://127.0.0.1:${PORT}`;

const SCENARIOS = {
  a_retail: 'a_rifle_20m_left_retail.wav',
  a_remaster: 'a_rifle_20m_left_remaster.wav',
  b_retail: 'b_rifle_350m_retail.wav',
  b_remaster: 'b_rifle_350m_crack_then_report_remaster.wav',
  c_retail: 'c_tank_passby_retail.wav',
  c_clear: 'c_tank_passby_remaster_occlusion_off.wav',
  c_occluded: 'c_tank_passby_remaster_behind_house.wav',
  d_open_dry: 'd_gunshot_dry_remaster_reference.wav',
  d_open: 'd_gunshot_open_remaster.wav',
  d_woods: 'd_gunshot_woods_remaster.wav',
  d_builtup: 'd_gunshot_builtup_remaster.wav',
  d_inside: 'd_gunshot_inside_remaster.wav',
  e_retail: 'e_ambient_wake_beach_retail.wav',
  e_remaster: 'e_ambient_wake_beach_then_bunker_remaster.wav',
  // The reverb's return alone, measured, never kept (`--only` to run them).
  d_open_wet: null,
  d_woods_wet: null,
  d_builtup_wet: null,
  d_inside_wet: null,
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const measurements = {};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__remaster_audio_rig.html', route => route.fulfill({
    contentType: 'text/html', body: fs.readFileSync(path.join(HERE, 'remaster_audio_rig.html'), 'utf8'),
  }));
  await page.goto(`${BASE}/__remaster_audio_rig.html`);
  await page.waitForFunction(() => window.rigReady === true, null, { timeout: 30000 });
  for (const [name, file] of Object.entries(SCENARIOS)) {
    if (ONLY ? !ONLY.includes(name) : !file) continue;
    const t0 = Date.now();
    const result = await page.evaluate(n => window.rig.run(n), name);
    const bytes = Buffer.from(result.wav, 'base64');
    if (file) fs.writeFileSync(path.join(OUT, file), bytes);
    delete result.wav;
    measurements[name] = { file, kb: Math.round(bytes.length / 1024), ...result };
    console.log(`${name} -> ${file} (${Math.round(bytes.length / 1024)} KB, ${Date.now() - t0} ms)`,
      JSON.stringify(result.stats));
  }
  if (errors.length) console.log('rig errors:', errors);
  measurements.rigErrors = errors;

  if (!args.includes('--no-page')) {
    const live = await browser.newPage();
    const pageErrors = [];
    live.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
    live.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
    await live.goto(`${BASE}/map.html?map=wake&remaster&remasterAudio=1&shots=1&mute`, { timeout: 120000 });
    await live.waitForTimeout(25000);
    // A window of frames, its cost measured from a clean count.
    await live.evaluate(() => window.__remasterAudio?.()?.resetStats());
    await live.waitForTimeout(10000);
    const snap = await live.evaluate(() => ({
      installed: !!window.__remasterAudio?.(),
      snapshot: window.__remasterAudio?.()?.snapshot() ?? null,
    })).catch(e => ({ error: String(e) }));
    // Counted, not listed: a renderer mid-port can log the same error a frame.
    const counted = new Map();
    for (const e of pageErrors) counted.set(e.slice(0, 200), (counted.get(e.slice(0, 200)) ?? 0) + 1);
    const errors = [...counted].map(([text, count]) => ({ count, text }));
    measurements.page = { url: 'map.html?map=wake&remaster&remasterAudio=1&shots=1&mute', errors, ...snap };
    console.log('page:', JSON.stringify(measurements.page, null, 1));
  }
} finally {
  await browser.close();
}
const file = path.join(OUT, 'measurements.json');
const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
fs.writeFileSync(file, `${JSON.stringify({ ...prior, ...measurements }, null, 1)}\n`);
