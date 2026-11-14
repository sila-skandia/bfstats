// The remaster's showreel (features/remaster-browser, "Marketing captures"):
// what the remaster adds, one feature at a time: a clip drawn by the remaster
// alone with a caption saying what to look at, then the same thing drawn
// twice, the retail page beside the remaster, stepped in lockstep on one
// virtual clock so both halves show the same frame. The reel takes the shots
// in the order of the shot file.
//
//   node scripts/remaster-compare.mjs [--shots=<file.json>] [--out=<dir>]
//        [--base=http://localhost:5390] [--w=1920] [--h=1080] [--fps=30]
//        [--stills-only] [--only=<shot name,...>] [--reel-only]
//
// The viewer must be served at --base (`python3 serve_viewer.py 5390` in
// tools/bf1942-models) and each shot's recording copied under
// tools/bf1942-models/viewer/replays/. Every shot carries
//   { name, part, title, note, map, mod, len, still }
// `part` is `feature` (the remaster alone, full frame, `title` and `note`
// as its caption) or `compare` (retail and remaster side by side, `title`
// over them). `still` is the second into the shot the stills are taken at.
// A shot is a replayed moment,
//   { replay, at, pid, mode, yaw, pitch, zoom }
// (the camera follows `pid` in `mode`, `orbit` taking `yaw`/`pitch`/`zoom`),
// or a camera glide over the level with the level's own bots,
//   { level: true, from: [x,y,z,yaw,pitch], to: [...] }
// (without `from`, the page's own camera: a player spawned by `setup`)
// and either may have
//   setup: "<js>"  run once in the page when the shot starts (async allowed)
//   each:  "<js>"  run in the page before every frame, `s` the second
// to stage what it shows: a vehicle set burning, an effect played.
// `liveMods: true` hands the page the live mod registry (a mod's recording);
// `init: "<js>"` runs in the page before its own scripts.
//
// A level shot may stage a fight: `gunners: { bots, seats: { <team>: <template> },
// perTeam, warm, focus, field, northTeam, bursts }` plays the level with
// `bots` bots and seats up to `perTeam` bots of a team on that team's guns of
// that template, the guns nearest `focus` ([x, z], the glide's start when
// not given) first, so the gun in the picture is manned in both pages. A
// seated gunner cannot leave (its own plans would take it to a tank; it
// set its exit between two frames and was back in its seat 22 frames later,
// a body that blinked in and out of the nest); one killed is seated again on
// its own gun. `field: [x0, z0, x1, z1]` stands the bots on foot back inside
// it every two seconds; `bursts: [on, off]` aims each gunner at a gunner
// across the gap (at `aimAt: [x, y, z]` in the sky, for flak) and fires in
// bursts of `on` seconds every `on + off`;
// `warm` seconds of the fight run before the shot starts. The bots' choices
// are each page's own dice, so two halves show the same fight, not the same
// rounds.
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
const W = Number(opt('w', 1920)), H = Number(opt('h', 1080)), FPS = Number(opt('fps', 30));
const STILLS_ONLY = args.includes('--stills-only');
const REEL_ONLY = args.includes('--reel-only');
// `--trace=<expression>`: a debugging aid, the expression evaluated in each
// page after every frame and logged beside the frame's number.
const TRACE = opt('trace', null);
// `--probe=<from>,<to>`: every effect, round and burst drawn in those frames.
const PROBE = opt('probe', null)?.split(',').map(Number) ?? null;
const ONLY = opt('only', null)?.split(',');
const ALL = JSON.parse(fs.readFileSync(opt('shots', path.join(REPO, 'scripts/remaster-compare.shots.json')), 'utf8'));
const SHOTS = ALL.filter(s => !ONLY || ONLY.includes(s.name));
const modesOf = shot => (shot.part === 'feature'
  ? [['remaster', 'remaster']]
  : [['retail', 'remaster=0'], ['remaster', 'remaster']]);
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
  page.on('console', m => { if (m.type() === 'error') log('console', query, m.text().slice(0, 300)); });
  await page.addInitScript(clockInit);
  if (shot.init) await page.addInitScript(shot.init);
  if (shot.liveMods) {
    // The local registry carries no counts, so the page serves vanilla only:
    // hand it the live one, for that one file.
    await page.route('**/models/mods.json', async route => {
      const res = await fetch('https://mesh.bfstats.io/models/mods.json');
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
  }
  const q = `mod=${shot.mod}&map=${shot.map}${shot.level ? '' : `&replay=${shot.replay}`}&shots&mute&botCount=${shot.gunners?.bots ?? shot.bots ?? 0}&quality=full&${query}`;
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

/** One frame of the shot at `s` seconds: the camera on (a level glide), the
 *  staged fight kept up, `each` run, the world stepped and drawn. */
async function frame(page, shot, s, keep = true) {
  return page.evaluate(async ({ shot, s, W, H, FPS, keep }) => {
    if (shot.level && shot.from) {
      const u = Math.min(1, s / Math.max(shot.len, 1e-3));
      const e = u * u * (3 - 2 * u);
      const [x, y, z, yaw, pitch] = shot.from.map((a, i) => a + (shot.to[i] - a) * e);
      const cam = window.__camera;
      cam.position.set(x, y, z);
      if (window.__look) { window.__look.yaw = yaw; window.__look.pitch = pitch; }
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      cam.updateMatrixWorld();
    }
    const g = window.__gunners;
    if (g) {
      // A gunner killed on its gun is seated on the same gun once it is back.
      if ((g.tick = (g.tick ?? 0) + 1) % 15 === 0) {
        for (const id of g.ids) {
          const bot = window.__botCtl(id);
          if (bot && !bot.vehicle) window.__botMount(id, g.seats[bot.team], 'driver', g.home[id]);
        }
      }
      // `field: [x0, z0, x1, z1]`: every two seconds the bots on foot that
      // have left it are stood back in it, facing the other side, so the
      // guns always have someone in front of them.
      if (g.field && g.tick % 60 === 1) {
        const [x0, z0, x1, z1] = g.field;
        for (const b of window.__bots()) {
          if (g.ids.includes(b.id) || b.vehicle) continue;
          const [x, , z] = b.pos;
          if (x >= x0 && x <= x1 && z >= z0 && z <= z1) continue;
          const team = window.__botCtl(b.id)?.team;
          const rx = x0 + (x1 - x0) * Math.random(), rz = z0 + (z1 - z0) * (team === g.northTeam ? 0.55 + 0.2 * Math.random() : 0.25 + 0.2 * Math.random());
          // The side further along +z stands on the +z half facing -z (the
          // soldier's yaw is atan2(x, z)).
          window.__botPlace(b.id, rx, rz, team === g.northTeam ? Math.PI : 0);
        }
      }
    }
    if (shot.flyby && window.replay) {
      // A camera stood beside the path the followed man takes, `ahead`
      // seconds along it, `side` metres off it and `up` over the ground,
      // turned to keep him in frame: a plane passes it low, its shadow
      // running over the ground below.
      const r = window.replay, cam = r.camera;
      const fb = shot.flyby;
      if (!window.__flyby) {
        const at = t => { const q = cam.targetAt(t)?.point; return q ? { x: q.x, y: q.y, z: q.z } : null; };
        const p0 = at(r.time), p1 = at(r.time + (fb.ahead ?? 1.5));
        if (p0 && p1) {
          let dx = p1.x - p0.x, dz = p1.z - p0.z;
          const n = Math.hypot(dx, dz) || 1;
          dx /= n; dz /= n;
          const x = p1.x + dz * (fb.side ?? 25), z = p1.z - dx * (fb.side ?? 25);
          const ground = window.__groundAt?.(x, z);
          window.__flyby = [x, (Number.isFinite(ground) ? ground : p1.y) + (fb.up ?? 3), z];
        }
      }
      const at = window.__flyby, p = cam.targetAt(r.time)?.point;
      if (at && p) {
        cam.setMode('free');
        cam.free.pos.set(at[0], at[1], at[2]);
        const dx = p.x - at[0], dy = p.y + (fb.lift ?? 0) - at[1], dz = p.z - at[2];
        cam.free.yaw = Math.atan2(-dx, -dz);
        cam.free.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
    }
    if (shot.each) await new Function('s', `return (async () => { ${shot.each} })()`)(s);
    window.__clock.step(1000 / FPS);
    window.__renderOnce(W, H, 1 / FPS);
    // The remaster builds a new material's pipeline off the thread and skips
    // its draw until it is ready; stepped faster than real time, a muzzle's
    // flash never got its turn. Wait for them, then draw the same moment
    // again (no time passes).
    const building = () => window.__remaster?.asyncPipelines?.().pending ?? 0;
    if (building() > 0) {
      for (let t = 0; t < 200 && building() > 0; t++) await new Promise(r => setTimeout(r, 10));
      window.__renderOnce(W, H, 0);
    }
    if (!keep) return null;
    const cv = (window.__cmpCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
    cv.getContext('2d').drawImage(window.__renderer.domElement, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', 0.93);
  }, { shot, s, W, H, FPS, keep });
}

async function start(page, shot) {
  if (shot.level) {
    if (shot.gunners) await seatGunners(page, shot);
    return;
  }
  await page.evaluate(shot => {
    const r = window.replay;
    window.__flyby = null;
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

async function seatGunners(page, shot) {
  const gun = shot.gunners;
  const staged = await page.evaluate(([g, focus]) => {
    if (window.__gunners) return null;
    // At most `perTeam` gunners a side, on the guns nearest the focus; the
    // rest fight on foot, which gives the guns something to fire at.
    const per = {};
    const ids = [];
    const home = {};
    for (const b of window.__bots()) {
      const bot = window.__botCtl(b.id);
      const want = g.seats[bot?.team];
      if (!want || (per[bot.team] ?? 0) >= (g.perTeam ?? Infinity)) continue;
      if (!window.__botMount(b.id, want, 'driver', focus)) continue;
      ids.push(b.id);
      per[bot.team] = (per[bot.team] ?? 0) + 1;
      const p = bot.getPosition();
      home[b.id] = [p[0], p[2]];
      // Its own plans would take it to a better vehicle: the exit it asks
      // for inside its tick is dropped there, not after the frame.
      Object.defineProperty(bot, 'exitRequest', { configurable: true, get: () => false, set() {} });
      Object.defineProperty(bot, 'switchRequest', { configurable: true, get: () => null, set() {} });
    }
    window.__gunners = { seats: g.seats, ids, home, tick: 0, field: g.field ?? null, northTeam: Number(g.northTeam ?? 0) };
    return ids.length;
  }, [gun, gun.focus ?? (shot.from ? [shot.from[0], shot.from[2]] : null)]);
  if (staged === null) return;
  if (gun.bursts) {
    // A director's crossfire: each gunner aims at a gunner across the gap
    // (sweeping a few metres either side) and fires in bursts on its own
    // rhythm, through the bots' own aim and trigger (`bot-aim.js`
    // `turretAimAt`, the input word the world fires the seat's gun from).
    // Left to their own plans they found a target now and then.
    await page.evaluate(async ([on, off, sky]) => {
      const aiming = await import(new URL('bot-aim.js', location.href).href);
      const g = window.__gunners;
      g.ids.forEach((id, i) => {
        const bot = window.__botCtl(id);
        const write = bot._writeInput.bind(bot);
        const phase = i * 0.37 * (on + off);
        bot._writeInput = () => {
          const enemies = g.ids.map(e => window.__botCtl(e)).filter(e => e && e.team !== bot.team && e.vehicle);
          const t = (bot._now ?? 0) + phase;
          if (bot.vehicle && sky) {
            // `aimAt`: a point in the sky, swept a little, for flak.
            aiming.turretAimAt(bot, [sky[0] + Math.sin(t * 0.7 + i) * 30, sky[1] + Math.sin(t * 0.5 + 2 * i) * 15, sky[2] + Math.cos(t * 0.6 + i) * 30]);
            bot.isFiring = (t % (on + off)) < on;
          } else if (bot.vehicle && enemies.length) {
            const target = enemies[(i + Math.floor(t / (on + off))) % enemies.length].getPosition();
            const sweep = Math.sin(t * 0.9 + i) * 6;
            aiming.turretAimAt(bot, [target[0] + sweep, target[1] + 0.8, target[2]]);
            bot.isFiring = (t % (on + off)) < on;
          }
          write();
        };
      });
    }, [...gun.bursts, gun.aimAt ?? null]);
  }
  log(`  ${staged} gunners seated; the fight runs ${gun.warm ?? 0} s first`);
  for (let k = 0; k < (gun.warm ?? 0) * FPS; k++) await frame(page, shot, 0, false);
}

// --- the overlays: cards, captions and the before/after header ------------

const CSS = `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; background: transparent; overflow: hidden;
    font-family: "SF Pro Display", "Helvetica Neue", system-ui, sans-serif; color: #f2eee4; }
  .kick { font: 800 22px/1 "SF Pro Display", system-ui, sans-serif; letter-spacing: 0.32em; color: #ffc46e; text-transform: uppercase; }
`;
const esc = t => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function overlay(browser, file, body, opaque = false) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>${body}</body></html>`);
  await page.screenshot({ path: file, omitBackground: !opaque });
  await page.close();
}

const captionHtml = shot => `
  <div style="position:absolute;left:0;right:0;bottom:0;height:360px;background:linear-gradient(to top, rgba(6,8,10,0.78), rgba(6,8,10,0.45) 55%, rgba(6,8,10,0))"></div>
  <div style="position:absolute;left:96px;bottom:92px;max-width:1300px">
    <div class="kick">Remaster</div>
    <div style="font:800 58px/1.08 'SF Pro Display',system-ui,sans-serif;margin-top:16px;text-shadow:0 2px 18px rgba(0,0,0,0.5)">${esc(shot.title)}</div>
    <div style="font:500 30px/1.35 'SF Pro Text',system-ui,sans-serif;margin-top:14px;color:#e4dfd2;text-shadow:0 2px 12px rgba(0,0,0,0.6)">${esc(shot.note)}</div>
  </div>`;

const compareHtml = shot => `
  <div style="position:absolute;left:0;right:0;top:118px;text-align:center">
    <div class="kick">Before and after</div>
    <div style="font:800 48px/1.1 'SF Pro Display',system-ui,sans-serif;margin-top:16px">${esc(shot.title)}</div>
  </div>
  <div style="position:absolute;top:840px;left:16px;width:944px;text-align:center;font:800 26px/1 system-ui;letter-spacing:0.24em;color:#d8d3c6">RETAIL</div>
  <div style="position:absolute;top:840px;left:960px;width:944px;text-align:center;font:800 26px/1 system-ui;letter-spacing:0.24em;color:#ffc46e">REMASTER</div>
  <div style="position:absolute;left:0;right:0;top:900px;text-align:center;font:500 26px/1.35 system-ui;color:#bdb7a8">${esc(shot.note)}</div>`;

// The title and end cards, after the BattleView trailer's end card
// (features/battleview-install-page, "Hero video"): an olive vignette, the
// bfstats badge over a two-part title, a short gold rule and the credit
// line in spaced capitals. Two layers: the title comes up first, the badge
// and the credit after it.
const LOGO = `data:image/webp;base64,${fs.readFileSync(path.join(REPO, 'tools/bf1942-models/viewer/bfstats-logo.webp')).toString('base64')}`;
const cardBack = `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 62% 70% at 50% 46%, #232a17 0%, #12170c 45%, #030504 100%)"></div>`;
const cardTitle = (lead, rest) => `
  <div style="position:absolute;left:0;right:0;top:560px;text-align:center;font:400 84px/1 'Helvetica Neue','SF Pro Display',system-ui,sans-serif;color:#d9dcd2;letter-spacing:-0.01em">
    <b style="font-weight:800;color:#fbfbf6;letter-spacing:-0.025em">${esc(lead)}</b><span style="display:inline-block;width:2px;height:74px;background:#8c8a55;margin:0 34px;vertical-align:-10px"></span>${rest}
  </div>`;
const cardCredit = site => `
  <img src="${LOGO}" style="position:absolute;left:50%;top:190px;width:330px;transform:translateX(-50%);filter:drop-shadow(0 10px 40px rgba(0,0,0,0.6))">
  <div style="position:absolute;left:50%;top:712px;width:90px;height:2px;margin-left:-45px;background:linear-gradient(90deg,transparent,#c9b26a,transparent)"></div>
  <div style="position:absolute;left:0;right:0;top:766px;text-align:center;font:500 28px/1 'SF Mono',Menlo,monospace;letter-spacing:0.42em;color:#8d9184">A PROJECT BY AND FOR THE COMMUNITY <span style="color:#6f735f">&middot;</span> <span style="letter-spacing:0.06em;color:#c8d88c">${esc(site)}</span></div>`;

/** A card as two layers (`<file>.base.png`, opaque, and `<file>.over.png`)
 *  and its clip: the base fades in, the badge and credit after it. */
async function brandCard(browser, file, lead, rest, site, secs) {
  await overlay(browser, `${file}.base.png`, cardBack + cardTitle(lead, rest), true);
  await overlay(browser, `${file}.over.png`, cardCredit(site));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', `${file}.base.png`,
    '-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', `${file}.over.png`, '-filter_complex',
    `[1:v]format=rgba,fade=t=in:st=0.9:d=0.8:alpha=1[o];[0:v][o]overlay=0:0,fade=t=in:st=0:d=0.6,fade=t=out:st=${secs - 0.7}:d=0.7`,
    ...ENC, `${file}.mp4`]);
  return `${file}.mp4`;
}

const ENC = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

function cardClip(png, secs, out) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', png, '-vf',
    `scale=1920:1080,fade=t=in:st=0:d=0.5,fade=t=out:st=${secs - 0.5}:d=0.5`, ...ENC, out]);
}

function featureClip(shot, dir, png, out) {
  const len = shot.len;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'remaster', 'f%05d.jpg'),
    '-loop', '1', '-framerate', String(FPS), '-i', png, '-filter_complex',
    `[0:v]scale=1920:1080,fade=t=in:st=0:d=0.35,fade=t=out:st=${len - 0.35}:d=0.35[v];`
    + `[1:v]format=rgba,fade=t=in:st=0.5:d=0.6:alpha=1,fade=t=out:st=${Math.max(1, len - 1.1)}:d=0.6:alpha=1[c];`
    + '[v][c]overlay=0:0:shortest=1', ...ENC, out]);
}

function compareClip(shot, dir, png, out) {
  const len = shot.len;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'retail', 'f%05d.jpg'),
    '-framerate', String(FPS), '-i', path.join(dir, 'remaster', 'f%05d.jpg'),
    '-loop', '1', '-framerate', String(FPS), '-i', png,
    '-f', 'lavfi', '-i', `color=c=0x0b0b0c:s=1920x1080:r=${FPS}`, '-filter_complex',
    '[0:v]scale=944:531[a];[1:v]scale=944:531[b];'
    + '[3:v][a]overlay=16:290:shortest=1[l];[l][b]overlay=960:290[lb];[lb][2:v]overlay=0:0,'
    + `fade=t=in:st=0:d=0.35,fade=t=out:st=${len - 0.35}:d=0.35`, '-t', String(len), ...ENC, out]);
}

const save = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const clipOf = shot => path.join(OUT, `${shot.name}.mp4`);
try {
  for (const shot of REEL_ONLY ? [] : SHOTS) {
    log('shot', shot.name, shot.part ?? 'compare', shot.title);
    const modes = modesOf(shot);
    const pages = [];
    for (const [, query] of modes) pages.push(await open(browser, shot, query));
    const dir = path.join(OUT, shot.name);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [m] of modes) fs.mkdirSync(path.join(dir, m), { recursive: true });
    for (const p of pages) await start(p, shot);
    if (shot.setup) {
      for (const p of pages) log('  setup', JSON.stringify(await p.evaluate(code => new Function(`return (async () => { ${code} })()`)(), shot.setup)));
    }
    // Settle: the bodies and hulls near the start build, the camera eases in.
    for (let k = 0; k < 20; k++) for (const p of pages) await frame(p, shot, 0, false);
    if (!shot.level) for (const p of pages) await start(p, shot);
    const total = STILLS_ONLY ? Math.round((shot.still ?? 0) * FPS) + 1 : Math.round(shot.len * FPS);
    const stillAt = Math.round((shot.still ?? shot.len / 2) * FPS);
    for (let k = 0; k < total; k++) {
      for (let i = 0; i < modes.length; i++) {
        const [m] = modes[i];
        const keep = !STILLS_ONLY || k === stillAt;
        const url = await frame(pages[i], shot, k / FPS, keep);
        if (k === stillAt) save(path.join(OUT, `${shot.name}_${m}.jpg`), url);
        if (TRACE) log('trace', m, k, JSON.stringify(await pages[i].evaluate(TRACE)));
        if (PROBE && k >= PROBE[0] && k <= PROBE[1]) {
          // The distinct materials of every visible effect particle in this
          // frame, to name one that draws wrong.
          const seen = await pages[i].evaluate(([W, H]) => {
            const out = {};
            const THREE = window.__THREE, v = new THREE.Vector3();
            window.__scene.traverseVisible(o => {
              const fx = o.parent?.name === 'effects' || o.userData?.remasterFlash || o.userData?.projectileMesh || o.userData?.tracerMesh;
              if (!fx || !(o.isMesh || o.isSprite)) return;
              const mat = [o.material].flat()[0];
              v.setFromMatrixPosition(o.matrixWorld).project(window.__camera);
              const sig = JSON.stringify({ type: o.type, name: o.name, mat: mat?.type, blend: mat?.blending, src: mat?.blendSrc, dst: mat?.blendDst,
                at: mat?.alphaTest, glow: !!mat?.remasterGlow, tex: mat?.map?.name || '' });
              (out[sig] ??= []).push(`${Math.round((v.x * 0.5 + 0.5) * W)},${Math.round((0.5 - v.y * 0.5) * H)}@${o.scale.x.toFixed(1)}`);
            });
            return out;
          }, [W, H]);
          for (const [sig, at] of Object.entries(seen)) log('probe', m, k, sig, at.slice(0, 4).join(' '));
        }
        if (!STILLS_ONLY) save(path.join(dir, m, `f${String(k).padStart(5, '0')}.jpg`), url);
      }
      if (k % FPS === 0) log(`  ${shot.name} ${(k / FPS).toFixed(0)} s`);
    }
    for (const p of pages) await p.close();
    if (modes.length === 2) {
      const [a, b] = modes.map(([m]) => path.join(OUT, `${shot.name}_${m}.jpg`));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex',
        '[0:v]pad=iw+8:ih:0:0:color=black[l];[l][1:v]hstack', '-q:v', '2', path.join(OUT, `${shot.name}_side_by_side.jpg`)]);
    }
    if (STILLS_ONLY) continue;
    const png = path.join(OUT, `${shot.name}_overlay.png`);
    if (shot.part === 'feature') {
      await overlay(browser, png, captionHtml(shot));
      featureClip(shot, dir, png, clipOf(shot));
    } else {
      await overlay(browser, png, compareHtml(shot));
      compareClip(shot, dir, png, clipOf(shot));
    }
    log('  wrote', clipOf(shot));
  }
  if (!STILLS_ONLY && (!ONLY || REEL_ONLY)) {
    // The reel: a title card, then each feature on its own and straight
    // after it the same thing beside retail, in the order of the shot file,
    // and an end card.
    const intro = await brandCard(browser, path.join(OUT, 'card_intro'), 'Remaster', '<b style="font-weight:800;color:#fbfbf6">BF1942</b> in the browser', 'bfstats.io', 4.5);
    const outro = await brandCard(browser, path.join(OUT, 'card_outro'), 'Remaster', 'play it at <b style="font-weight:800;color:#fbfbf6">play.bfstats.io</b>', 'bfstats.io', 5);
    const order = [intro, ...ALL.map(clipOf), outro];
    const missing = order.filter(f => !fs.existsSync(f));
    if (missing.length) log('reel: missing', missing.join(' '));
    const list = path.join(OUT, 'clips.txt');
    fs.writeFileSync(list, order.filter(f => fs.existsSync(f)).map(c => `file '${c}'`).join('\n'));
    const reel = path.join(OUT, 'remaster_reel.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', reel]);
    log('reel', reel);
  }
} finally {
  await browser.close();
}
