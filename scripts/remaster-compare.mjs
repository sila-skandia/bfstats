// Remaster before/after (features/remaster-browser, "Marketing captures"):
// the same replayed moments drawn twice, once by the retail page and once
// by the remaster, stepped in lockstep on one virtual clock so both halves
// show the same frame of the round. Writes, per shot, a still from each
// mode and the two side by side, and one side-by-side MP4 of every shot.
//
//   node scripts/remaster-compare.mjs [--shots=<file.json>] [--out=<dir>]
//        [--base=http://localhost:5390] [--w=1600] [--h=900] [--fps=30]
//        [--stills-only] [--only=<shot name,...>]
//
// The viewer must be served at --base (`python3 serve_viewer.py 5390` in
// tools/bf1942-models) and each shot's recording copied under
// tools/bf1942-models/viewer/replays/. A shot is
//   { name, title, map, mod, replay, at, len, pid, mode, yaw, pitch, zoom, still }
// for a replayed moment (the camera follows `pid` in `mode`, `orbit` taking
// `yaw`/`pitch`/`zoom`), or
//   { name, title, map, mod, level: true, from: [x,y,z,yaw,pitch], to: [...], len, still }
// for a camera glide over the level with nothing playing. `still` is the
// second into the shot the stills are taken at.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(REPO, 'ui/package.json'))('playwright');
const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const BASE = opt('base', 'http://localhost:5390');
const OUT = opt('out', path.join(os.homedir(), '.cache/bfstats-remaster-compare'));
const W = Number(opt('w', 1600)), H = Number(opt('h', 900)), FPS = Number(opt('fps', 30));
const STILLS_ONLY = args.includes('--stills-only');
const PROBE = opt('probe', null)?.split(',').map(Number) ?? null;
let probed = null;
const ONLY = opt('only', null)?.split(',');
const SHOTS = JSON.parse(fs.readFileSync(opt('shots', path.join(REPO, 'scripts/remaster-compare.shots.json')), 'utf8'))
  .filter(s => !ONLY || ONLY.includes(s.name));
const MODES = [['retail', 'remaster=0'], ['remaster', 'remaster']];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(OUT, { recursive: true });

function clockInit() {
  const realNow = performance.now.bind(performance);
  let virtual = null;
  performance.now = () => (virtual === null ? realNow() : virtual);
  window.__clock = { take() { if (virtual === null) virtual = realNow(); }, step(ms) { virtual += ms; } };
}

async function open(browser, shot, query) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => log('pageerror', query, e.message.slice(0, 200)));
  await page.addInitScript(clockInit);
  const q = `mod=${shot.mod}&map=${shot.map}${shot.level ? '' : `&replay=${shot.replay}`}&shots&mute&botCount=0&quality=full&${query}`;
  await page.goto(`${BASE}/map.html?${q}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  if (shot.level) {
    await page.waitForFunction(() => window.__renderOnce && window.__scene, null, { timeout: 480000, polling: 500 });
    for (let i = 0; i < 240; i++) {
      const s = await page.evaluate(() => document.querySelector('.ld-overlay')?.dataset.state ?? 'done');
      if (s === 'briefing') await page.evaluate(() => document.querySelector('.ld-brief-btn')?.click());
      else if (s === 'done' || s === 'error') break;
      await page.waitForTimeout(250);
    }
  } else {
    await page.waitForFunction(() => window.replay?.statusLine && window.__renderer, null, { timeout: 480000, polling: 500 });
  }
  await page.waitForTimeout(6000);
  await page.evaluate(() => { window.__renderer.setAnimationLoop(null); window.__clock.take(); });
  return page;
}

/** Put the shot's camera on, at `s` seconds into it (a level glide only). */
async function frame(page, shot, s, label, clean = false) {
  return page.evaluate(async ({ shot, s, W, H, FPS, label, clean }) => {
    if (shot.level) {
      const u = Math.min(1, s / Math.max(shot.len, 1e-3));
      const e = u * u * (3 - 2 * u);
      const [x, y, z, yaw, pitch] = shot.from.map((a, i) => a + (shot.to[i] - a) * e);
      const cam = window.__camera;
      cam.position.set(x, y, z);
      if (window.__look) { window.__look.yaw = yaw; window.__look.pitch = pitch; }
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      cam.updateMatrixWorld();
    }
    window.__clock.step(1000 / FPS);
    window.__renderOnce(W, H, 1 / FPS);
    const cv = (window.__cmpCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
    const g = cv.getContext('2d');
    g.drawImage(window.__renderer.domElement, 0, 0, W, H);
    const still = clean ? cv.toDataURL('image/jpeg', 0.95) : null;
    if (label) {
      const k = H / 900;
      g.save();
      g.font = `800 ${22 * k}px system-ui, "Segoe UI", sans-serif`;
      const w = g.measureText(label).width + 28 * k;
      g.fillStyle = 'rgba(12,14,16,0.62)';
      g.fillRect(24 * k, 24 * k, w, 40 * k);
      g.fillStyle = label === 'REMASTER' ? 'rgba(255,196,110,0.98)' : 'rgba(236,232,220,0.95)';
      g.textBaseline = 'middle';
      g.fillText(label, 38 * k, 44 * k);
      g.restore();
    }
    return { still, url: label ? cv.toDataURL('image/jpeg', 0.92) : null };
  }, { shot, s, W, H, FPS, label, clean });
}

async function start(page, shot) {
  if (shot.level) return;
  await page.evaluate(shot => {
    const r = window.replay;
    r.creator?.toggle?.(false);
    r.playing = false;
    r.seek(shot.at);
    r.follow(shot.pid);
    const cam = r.camera;
    cam.setMode(shot.mode ?? 'orbit');
    if ((shot.mode ?? 'orbit') === 'orbit') {
      cam.yaw = cam.eased.yaw = shot.yaw ?? cam.yaw;
      cam.pitch = cam.eased.pitch = shot.pitch ?? cam.pitch;
      cam.zoom = cam.eased.zoom = shot.zoom ?? cam.zoom;
    }
    r.speed = 1;
    r.playing = true;
  }, shot);
}

const save = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const clips = [];
try {
  for (const shot of SHOTS) {
    log('shot', shot.name, shot.title);
    const pages = [];
    for (const [, query] of MODES) pages.push(await open(browser, shot, query));
    const dir = path.join(OUT, shot.name);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [m] of MODES) fs.mkdirSync(path.join(dir, m), { recursive: true });
    for (const p of pages) await start(p, shot);
    // Settle: the bodies and hulls near the start build, the camera eases in.
    for (let k = 0; k < 20; k++) for (const p of pages) await frame(p, shot, 0, null);
    for (const p of pages) await start(p, shot);
    const total = STILLS_ONLY ? Math.round((shot.still ?? 0) * FPS) + 1 : Math.round(shot.len * FPS);
    const stillAt = Math.round((shot.still ?? shot.len / 2) * FPS);
    for (let k = 0; k < total; k++) {
      for (let i = 0; i < MODES.length; i++) {
        const [m] = MODES[i];
        const { still, url } = await frame(pages[i], shot, k / FPS, STILLS_ONLY ? null : m.toUpperCase(), k === stillAt);
        if (still) save(path.join(OUT, `${shot.name}_${m}.jpg`), still);
        if (PROBE && k >= PROBE[0] && k <= PROBE[1]) {
          // A debugging aid: the distinct materials of every visible effect
          // particle in this frame, to name one that draws wrong.
          const seen = await pages[i].evaluate(([W, H]) => {
            const out = {};
            const THREE = window.__THREE, v = new THREE.Vector3();
            window.__scene.traverseVisible(o => {
              const fx = o.parent?.name === 'effects' || o.userData?.remasterFlash || o.userData?.projectileMesh || o.userData?.tracerMesh;
              if (!fx || !(o.isMesh || o.isSprite)) return;
              const m = [o.material].flat()[0];
              v.setFromMatrixPosition(o.matrixWorld).project(window.__camera);
              const sig = JSON.stringify({ type: o.type, name: o.name, mat: m?.type, blend: m?.blending, src: m?.blendSrc, dst: m?.blendDst,
                at: m?.alphaTest, glow: !!m?.remasterGlow, tex: m?.map?.name || '' });
              (out[sig] ??= []).push(`${Math.round((v.x * 0.5 + 0.5) * W)},${Math.round((0.5 - v.y * 0.5) * H)}@${o.scale.x.toFixed(1)}`);
            });
            return out;
          }, [W, H]);
          for (const [sig, at] of Object.entries(seen)) log('probe', m, k, sig, at.slice(0, 4).join(' '));
        }
        if (STILLS_ONLY) continue;
        save(path.join(dir, m, `f${String(k).padStart(5, '0')}.jpg`), url);
      }
      if (k % FPS === 0) log(`  ${shot.name} ${(k / FPS).toFixed(0)} s`);
    }
    for (const p of pages) await p.close();
    // The stills side by side.
    const [a, b] = MODES.map(([m]) => path.join(OUT, `${shot.name}_${m}.jpg`));
    if (fs.existsSync(a) && fs.existsSync(b)) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex',
        '[0:v]pad=iw+8:ih:0:0:color=black[l];[l][1:v]hstack', '-q:v', '2', path.join(OUT, `${shot.name}_side_by_side.jpg`)]);
    }
    if (STILLS_ONLY) continue;
    const clip = path.join(OUT, `${shot.name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'retail', 'f%05d.jpg'),
      '-framerate', String(FPS), '-i', path.join(dir, 'remaster', 'f%05d.jpg'), '-filter_complex',
      '[0:v]pad=iw+8:ih:0:0:color=black[l];[l][1:v]hstack,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', clip]);
    clips.push(clip);
    log('  wrote', clip);
  }
} finally {
  await browser.close();
}
if (clips.length > 1) {
  // Every shot in order, a short fade between them.
  const list = path.join(OUT, 'clips.txt');
  fs.writeFileSync(list, clips.map(c => `file '${c}'`).join('\n'));
  const reel = path.join(OUT, 'remaster_side_by_side.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', reel]);
  log('reel', reel);
}
