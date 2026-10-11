/**
 * Measure how far to one side a seat hears each gun of its own hull.
 *
 * For every seat Camera of a vehicle glb and every FireArms on the same hull,
 * at rest: where the gun's origin stands in the camera's frame (the listener
 * is the camera, ledger SND-5; an unattached voice stands at its owner's
 * origin, SND-4), and the left/right balance of a mono broadband burst played
 * from there three ways, rendered by Chromium's own OfflineAudioContext:
 *
 *   hrtf   an HRTF PannerNode at the real point (the page before 2026-10-11)
 *   ds3d   the page now: `viewer/ds3d-pan.js`, an equal-power panner stood at
 *          `ds3dRenderPoint`
 *   law    DirectSound's no-virtualization pan as Wine computes it, from
 *          `ds3dGains`: what `ds3d` has to equal
 *
 * dB is right over left: negative leans left. `far` is the far ear's level
 * against a voice dead ahead through the same panner, which is what "out of
 * one speaker" is.
 *
 *   node tests/sound_pan_measure.cjs mods/fh/M4A1Sherman.glb mods/fh/Tiger.glb Sherman.glb
 *
 * With `--scene <maps/.../scene.json>` each gun of the seat's own is split
 * into the voices of its script that sound for that seat: one row per place
 * (a layer's `relativePosition` moves it off the gun's origin), and a
 * `stereo` layer, which is a 2D voice and never panned, says so. The script
 * is taken whole, every patch of it: the report, the reload, the shell case.
 *
 * Needs `viewer/models` and `ui/node_modules/playwright`. One headless
 * Chromium, closed on exit.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));
const PORT = 8733;

const args = process.argv.slice(2);
let scenePath = null;
const models = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scene') scenePath = args[++i];
  else models.push(args[i]);
}
if (!models.length) models.push('mods/fh/M4A1Sherman.glb');

// --- glb geometry -----------------------------------------------------------

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  }
  return o;
};
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

/** A node's local matrix, row-major. */
function local(node) {
  if (node.matrix) {
    const m = node.matrix;
    return [0, 1, 2, 3].flatMap(r => [0, 1, 2, 3].map(c => m[c * 4 + r]));
  }
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y - z * w) * sy, 2 * (x * z + y * w) * sz, tx,
    2 * (x * y + z * w) * sx, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z - x * w) * sz, ty,
    2 * (x * z - y * w) * sx, 2 * (y * z + x * w) * sy, (1 - 2 * (x * x + y * y)) * sz, tz,
    0, 0, 0, 1,
  ];
}

/** The inverse of a rotation-and-translation matrix. */
function rigidInverse(m) {
  const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  for (let r = 0; r < 3; r++) o[r * 4 + 3] = -(o[r * 4] * m[3] + o[r * 4 + 1] * m[7] + o[r * 4 + 2] * m[11]);
  return o;
}

function survey(file) {
  const data = fs.readFileSync(file);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'));
  const nodes = json.nodes;
  const parent = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const worlds = new Map();
  const world = i => {
    if (!worlds.has(i)) {
      worlds.set(i, mul(parent.has(i) ? world(parent.get(i)) : IDENT, local(nodes[i])));
    }
    return worlds.get(i);
  };
  const cameras = new Map();
  const arms = [];
  nodes.forEach((n, i) => {
    const e = n.extras || {};
    if (e.templateKind === 'Camera' && !cameras.has(e.control)) {
      // The eye is the node plus its pivot (`viewer/camera-pivot.js`).
      const p = e.physics?.pivotPosition;
      const eye = p && p.some(v => v) ? mul(world(i), translate(p[0], p[1], -p[2])) : world(i);
      cameras.set(e.control, { name: n.name, eye });
    } else if (e.templateKind === 'FireArms' && e.fireArms) {
      arms.push({ name: n.name, control: e.control, world: world(i) });
    }
  });
  const rows = [];
  for (const [seat, camera] of cameras) {
    const inverse = rigidInverse(camera.eye);
    for (const gun of arms) {
      const m = mul(inverse, gun.world);
      rows.push({
        seat, camera: camera.name, gun: gun.name, own: gun.control === seat,
        at: [m[3], m[7], m[11]],   // camera frame: x right, y up, -z ahead
        // A layer's `relativePosition`, in the gun's frame, to the same frame.
        offset: ([x, y, z]) => [
          m[0] * x + m[1] * y + m[2] * z + m[3],
          m[4] * x + m[5] * y + m[6] * z + m[7],
          m[8] * x + m[9] * y + m[10] * z + m[11]],
      });
    }
  }
  return rows;
}

// --- which layers of a script sound at a distance ---------------------------

function rampAt([a = 0, b = 0, base = 0, delta = 0], x) {
  if (x <= a) return base;
  if (x >= b) return base + delta;
  return b - a <= 0 ? base + delta : base + delta * ((x - a) / (b - a));
}

/**
 * The voices of a gun's fire script that sound for this seat, one per distinct
 * place: `{ at, layers, placed }`, `placed` false for a `stereo` layer (a 2D
 * voice). Each layer stands at the gun's origin moved by its own
 * `relativePosition`, and its `Distance` ramps are read at that distance.
 * Null when the scene has no script for the gun.
 */
function soundingVoices(scene, row) {
  const bare = row.gun.replace(/_\d+$/, '');
  for (const vehicle of scene?.sounds?.vehicles || []) {
    for (const weapon of vehicle.weapons || []) {
      if (weapon.fireArms !== row.gun && weapon.fireArms !== bare) continue;
      const voices = new Map();
      for (const layer of weapon.layers) {
        const at = layer.relativePosition?.some(v => v) ? row.offset(layer.relativePosition) : row.at;
        const distance = Math.hypot(...at);
        let volume = Math.min(1, layer.volume ?? 1);
        for (const mod of layer.modulators || []) {
          if (mod.dest === 'volume' && mod.source === 'distance' && mod.envelope === 'ramp') {
            volume *= rampAt(mod.params, distance);
          }
        }
        if (!(volume > 0)) continue;
        const key = `${layer.stereo ? '2D' : '3D'} ${at.map(v => v.toFixed(3)).join(',')}`;
        if (!voices.has(key)) voices.set(key, { at, placed: !layer.stereo, layers: new Set() });
        voices.get(key).layers.add(path.basename(layer.file, '.mp3'));
      }
      return [...voices.values()];
    }
  }
  return null;
}

// --- the render -------------------------------------------------------------

const TYPES = { '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  if (rel === 'blank') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>pan</title>');
    return;
  }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('no');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function render(page, points) {
  return page.evaluate(async (points) => {
    const pan = await import('/viewer/ds3d-pan.js');
    const RATE = 44100, LENGTH = RATE;
    // One burst of white noise for every render, so the figures compare.
    let seed = 12345;
    const noise = new Float32Array(LENGTH);
    for (let i = 0; i < LENGTH; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = seed / 2147483648 - 1;
    }
    const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    // The listener of a fresh context: at the origin, facing -z, +y up.
    const LISTENER = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    async function play(model, [x, y, z]) {
      const ctx = new OfflineAudioContext(2, LENGTH, RATE);
      const buffer = ctx.createBuffer(1, LENGTH, RATE);
      buffer.copyToChannel(noise, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const panner = ctx.createPanner();
      panner.rolloffFactor = 0;
      let at = { x, y, z };
      if (model === 'ds3d') {
        pan.configureDs3dPanner(panner);
        at = pan.ds3dRenderPoint(LISTENER, x, y, z, {});
      } else {
        panner.panningModel = 'HRTF';
      }
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
      source.connect(panner).connect(ctx.destination);
      source.start();
      const out = await ctx.startRendering();
      // Past the HRTF's own onset.
      return [rms(out.getChannelData(0).subarray(4096)), rms(out.getChannelData(1).subarray(4096))];
    }
    const ahead = { hrtf: await play('hrtf', [0, 0, -1]), ds3d: await play('ds3d', [0, 0, -1]) };
    const rows = [];
    for (const at of points) {
      const d = Math.hypot(...at);
      rows.push({
        hrtf: await play('hrtf', at),
        ds3d: await play('ds3d', at),
        law: pan.ds3dGains(d > 0 ? at[0] / d : 0),
      });
    }
    return { ahead, rows };
  }, points);
}

const dB = v => 20 * Math.log10(v);
const signed = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

(async () => {
  const scene = scenePath ? JSON.parse(fs.readFileSync(path.resolve(ROOT, 'viewer', scenePath), 'utf8')) : null;
  await new Promise(done => server.listen(PORT, '127.0.0.1', done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/blank`);
    for (const model of models) {
      // With a scene, a seat's own guns are split into the voices that sound
      // there, each at its own place; every other row is the gun's origin.
      const rows = [];
      for (const row of survey(path.resolve(ROOT, 'viewer', 'models', model))) {
        const voices = scene && row.own ? soundingVoices(scene, row) : null;
        if (!voices) { rows.push({ ...row, placed: true, label: '' }); continue; }
        for (const voice of voices) {
          rows.push({ ...row, at: voice.at, placed: voice.placed, label: [...voice.layers].join(' ') });
        }
      }
      const { ahead, rows: heard } = await render(page, rows.map(r => r.at));
      console.log(`\n${model}`);
      console.log('  seat / gun                                          d m   side   '
        + 'hrtf R/L  far ear | ds3d R/L  far ear | law R/L');
      rows.forEach((row, i) => {
        const [x, , z] = row.at;
        const d = Math.hypot(...row.at);
        const lateral = d > 0 ? Math.asin(x / d) * 180 / Math.PI : 0;
        const h = heard[i];
        const far = (pair, base) => dB(Math.min(...pair) / base[0]);
        const head = `  ${(row.seat + ' / ' + (row.own ? '' : '(other) ') + row.gun).padEnd(50)}`
          + ` ${d.toFixed(2).padStart(5)} ${signed(lateral).padStart(6)}${z > 0 ? 'b' : ' '}  `;
        console.log(head + (row.placed
          ? `${signed(dB(h.hrtf[1] / h.hrtf[0])).padStart(7)}  ${signed(far(h.hrtf, ahead.hrtf)).padStart(7)} | `
            + `${signed(dB(h.ds3d[1] / h.ds3d[0])).padStart(7)}  ${signed(far(h.ds3d, ahead.ds3d)).padStart(7)} | `
            + `${signed(dB(h.law.right / h.law.left)).padStart(6)}`
          : '2D voice: no place, never panned'.padEnd(46))
          + (row.label ? `   ${row.label}` : ''));
      });
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
