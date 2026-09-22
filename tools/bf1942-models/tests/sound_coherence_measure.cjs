/**
 * Measure a vehicle sound patch for the car-horn fingerprint.
 *
 * Two voices out of one sample, at one point, at one playback rate, sum at a
 * FIXED random phase (`EngineAudio.#play` starts a loop at a random point in
 * its own buffer) -- a static comb over the whole spectrum, and on a 114 ms
 * loop that comb is already at 8.8 Hz. Through the page's own limiter it
 * flattens into a drone. That is the horn.
 *
 * `tonality` is the share of band energy in the eight strongest bins, scaled
 * so a flat spectrum reads 1. Compare a patch against ITSELF with
 * `arbitrate: false` (the pre-fix control) and against the same patch outside
 * the overlap -- the absolute figure means nothing on its own, the spread
 * across repeats means everything, because a different draw of the comb every
 * session is precisely why this bug reads as intermittent.
 *
 *   node tests/sound_coherence_measure.cjs [level] [template] [fireArms] [metres]
 *
 * Needs an extracted `viewer/maps` tree and `ui/node_modules/playwright`.
 * Serves `tools/bf1942-models` itself, on a port nothing else uses.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));

const [level = 'aberdeen', template = 'sherman',
       fireArms = 'Coaxial_browning', metres = '1.4'] = process.argv.slice(2);
const REPEATS = 10;
const PORT = 8731;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript',
                '.json': 'application/json', '.mp3': 'audio/mpeg' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('no');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const spread = xs => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} (mean ${mean.toFixed(1)})`;
};

(async () => {
  await new Promise(done => server.listen(PORT, '127.0.0.1', done));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page threw:', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/tests/sound_coherence_rig.html`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

  console.log(`${level} ${template}/${fireArms}, ${REPEATS} renders each\n`);
  for (const [label, distance] of [['as asked', Number(metres)], ['well outside any near band', 40]]) {
    for (const arbitrate of [false, true]) {
      const tonality = [], rms = [], peak = [];
      for (let i = 0; i < REPEATS; i++) {
        const out = await page.evaluate(
          c => window.__honk(c), { map: level, template, fireArms, distance, arbitrate });
        tonality.push(out.tonality); rms.push(out.rms * 1000); peak.push(out.peak * 1000);
      }
      console.log(`  ${distance} m ${label.padEnd(27)} ${arbitrate ? 'arbitrated' : 'unarbitrated'}`.padEnd(60)
        + ` tonality ${spread(tonality)}  rms/1000 ${spread(rms)}  peak/1000 ${spread(peak)}`);
    }
  }
  await browser.close();
  server.close();
})();
