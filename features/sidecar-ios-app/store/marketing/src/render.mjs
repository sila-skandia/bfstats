// node render.mjs <art-dir> <ext> <out-dir> [ratio,w,h ...]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('/home/dylan/projects/skandia/bfstats/ui/package.json');
const { chromium } = require('playwright');
const [art, ext, out, ...jobs] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const list = jobs.length ? jobs.map(j => j.split(',')) : [['16:9', 5244, 2950], ['21:9', 3840, 1646], ['3:2', 3840, 2560]];
const browser = await chromium.launch();
for (const [ratio, w, h] of list) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const url = `file://${here}/hand.html?w=${w}&h=${h}&ratio=${encodeURIComponent(ratio)}&art=${art}&ext=${ext}`;
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const file = path.join(out, `${ratio.replace(':', 'x')}-${w}x${h}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: +w, height: +h } });
  console.log(file);
  await page.close();
}
await browser.close();
