// The failure-path probe: load map.html?room=X with NO room server running
// and assert the trouble modal appears with the reason — the user's exact
// "spun up the UI but not the room server" moment.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));
import { bootStatic } from './p2_two_browser_smoke.mjs';

const STATIC = 8951;
const statik = bootStatic(STATIC, path.join(ROOT, 'viewer'), 8949); // no server on 8949
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 160)));
await page.goto(`http://127.0.0.1:${STATIC}/map.html?room=ghost&name=Probe&map=aberdeen`);
let saw = null;
for (let i = 0; i < 60; i++) {
  saw = await page.evaluate(() => {
    const el = document.getElementById('roomIssue');
    return el ? { hidden: el.hidden, text: document.getElementById('roomIssueMessage')?.textContent ?? null } : null;
  }).catch(() => null);
  if (saw && !saw.hidden) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log(JSON.stringify({ modal: saw }));
await browser.close();
statik.close();
process.exit(saw && !saw.hidden ? 0 : 1);