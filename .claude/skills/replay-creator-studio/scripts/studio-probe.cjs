// Drive the replay creator view and studio in a real page, one headless
// Chromium, and write what each step returned as JSON.
//
//   node studio-probe.cjs --steps steps.js [--base http://localhost:5273]
//        [--replay replays/replay_20260928-133433.ndjson] [--out probe.json]
//        [--shots probe] [--width 1600] [--height 900] [--video dir]
//
// `steps.js` exports `[[label, async (page, sleep) => result, waitMs, screenshot]]`.
// Each step's result (or `{ error }`) lands in `out.steps[label]`; with
// `screenshot` true a PNG `<shots>-<label>.png` is taken after it. Each
// step's start and end (seconds since the epoch) land in `out.marks`. With
// `--video dir` the page is captured as it runs (the DevTools screencast,
// JPEG frames in `dir/frames` with their times in `dir/frames.json`), which
// `cut-tour-videos.cjs` encodes and cuts by the marks. Downloads
// (recordings, thumbnails) are saved beside `--out`, the last one named in
// `out.download`. Console errors and warnings land in `out.console`.
//
// One headless browser at a time on this PC: check `ps -eo args | grep -c
// "[h]eadless_shell"` is 0 first (not `pgrep -f`, which matches itself).
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '../../../..');
const { chromium } = require(path.join(repo, 'ui/node_modules/playwright'));

const opts = {
  base: 'http://localhost:5273', out: 'probe.json', shots: 'probe', steps: '',
  replay: 'replays/replay_20260928-133433.ndjson', width: '1600', height: '900',
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
if (!opts.steps) {
  console.error('usage: node studio-probe.cjs --steps steps.js [--base ...] [--replay ...] [--out ...]');
  process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const report = { console: [], steps: {}, marks: {} };
  let cast = null;
  try {
    const page = await browser.newPage({ viewport: { width: Number(opts.width), height: Number(opts.height) } });
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning' || /creator|studio/.test(msg.text())) report.console.push(`${msg.type()}: ${msg.text()}`.slice(0, 400));
    });
    page.on('pageerror', err => report.console.push(`pageerror: ${err.message}`.slice(0, 400)));
    page.on('download', async d => {
      const file = path.join(path.dirname(path.resolve(opts.out)), d.suggestedFilename());
      await d.saveAs(file);
      report.download = { name: d.suggestedFilename(), size: fs.statSync(file).size, path: file };
    });
    if (opts.video) {
      const dir = path.resolve(opts.video, 'frames');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const cdp = await page.context().newCDPSession(page);
      cast = { cdp, dir, frames: [] };
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const file = `${String(cast.frames.length).padStart(6, '0')}.jpg`;
        fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
        cast.frames.push({ file, ts: metadata.timestamp ?? Date.now() / 1000 });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      report.video = { dir };
    }
    const t0 = Date.now();
    await page.goto(`${opts.base}/map.html?mod=bf1942&replay=${opts.replay}&shots`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 600000, polling: 500 });
    report.loadSeconds = (Date.now() - t0) / 1000;
    await sleep(2500);
    const steps = require(path.resolve(opts.steps));
    if (cast) {
      await cast.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: Number(opts.width), maxHeight: Number(opts.height) });
    }
    for (const [label, fn, wait = 0, shot = true] of steps) {
      report.marks[label] = { start: Date.now() / 1000 };
      try {
        const out = await fn(page, sleep);
        if (wait) await sleep(wait);
        report.steps[label] = out === undefined ? null : out;
      } catch (error) {
        report.steps[label] = { error: String(error?.message || error) };
      }
      report.marks[label].end = Date.now() / 1000;
      if (shot) await page.screenshot({ path: `${opts.shots}-${label}.png` });
    }
    if (cast) {
      await cast.cdp.send('Page.stopScreencast').catch(() => {});
      fs.writeFileSync(path.resolve(opts.video, 'frames.json'), JSON.stringify(cast.frames));
      report.video.frames = cast.frames.length;
    }
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    await browser.close();
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 1));
  }
}
main();
