#!/usr/bin/env node
// Draws a sprite of anything in the game for a loading animation (skill
// `game-loading-animations`; the first is the Short loader's soldier,
// tools/bf1942-models/viewer/play/short-loader.js). A model or pose glb from
// the viewer tree, posed at a clip if it has one, skinned in three.js and
// rasterised here (textured, z-buffered, 4x supersampled, transparent), then
// cropped and written as webp. No browser: the triangles are drawn in plain
// JS, so it runs while a headless render job holds the browser.
//
//   node scripts/render-game-sprite.mjs                       # the Short loader's soldier
//   node scripts/render-game-sprite.mjs --glb models/Sherman.glb --bounds
//   node scripts/render-game-sprite.mjs --glb models/Sherman.glb --clip none --yaw 0.79 --pitch 0.35 \
//        --scale 55 --centre 0,0.4,0 --size 420x240 --mark muzzle=0,1.15,-2.44 --out /tmp/sherman.webp
//
// Options (paths are relative to the viewer tree unless absolute):
//   --glb <path>         a model or pose glb             (models/poses/BritishSoldier__Bar1918.pose.glb)
//   --clip <name>        the animation clip to pose at   (lie; none for a model without clips)
//   --time <s>           seconds into the clip           (0)
//   --yaw/--pitch <rad>  the camera, orthographic: yaw about up, then pitch (positive looks
//                        down). A negative value needs '=': --yaw=-1.2
//   --scale <px/m>       pixels per metre at 1x before supersampling
//   --centre x,y,z       the world point at the canvas centre
//   --size WxH           the canvas before cropping      (700x240)
//   --only a,b / --skip a,b   mesh names (prefixes) to draw or leave out: layers
//                        (collision hulls and Em_ emitters are always left out)
//   --no-crop            keep the whole canvas, so layers drawn with one camera line up
//   --mark name=x,y,z    a world point to report in sprite pixels (repeatable)
//   --bounds             print each mesh's world bounds and stop (to pick a camera)
//   --sheet              draw eight yaws in a contact sheet instead (to pick an angle)
//   --out <path>         the webp                       (play/short-loader-soldier.webp)
//
// The marks are printed in CSS pixels of the sprite as shown at half its size
// (it is drawn at 2x): short-loader.js's MUZZLE and PORT are those numbers.
// Needs ui/node_modules (three) and python3 with Pillow (webp).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = join(ROOT, 'tools/bf1942-models/viewer');
const inViewer = p => (isAbsolute(p) ? p : join(VIEWER, p));
const { values: opt } = parseArgs({ options: {
  glb: { type: 'string', default: 'models/poses/BritishSoldier__Bar1918.pose.glb' },
  clip: { type: 'string', default: 'lie' },
  time: { type: 'string', default: '0' },
  yaw: { type: 'string', default: '-1.45' },
  pitch: { type: 'string', default: '-0.14' },
  scale: { type: 'string', default: '230' },
  centre: { type: 'string', default: '-0.05,0.15,0.3' },
  size: { type: 'string', default: '700x240' },
  only: { type: 'string' },
  skip: { type: 'string' },
  'no-crop': { type: 'boolean', default: false },
  mark: { type: 'string', multiple: true, default: ['muzzle=-0.14,0.16,1.67', 'port=-0.13,0.19,0.97'] },
  bounds: { type: 'boolean', default: false },
  sheet: { type: 'boolean', default: false },
  out: { type: 'string', default: 'play/short-loader-soldier.webp' },
} });
const vec = text => text.split(',').map(Number);
const glbPath = inViewer(opt.glb);
const outPath = inViewer(opt.out);
const [cw, ch] = opt.size.split('x').map(Number);
// Pitch is given looking down (positive: the camera above); the projection's is the other way.
const CAMERA = { yaw: +opt.yaw, pitch: -opt.pitch, centre: vec(opt.centre), scale: +opt.scale, w: cw, h: ch, ss: 4 };
const LIGHT = [-0.4, 0.8, 0.45];
const AMBIENT = 0.5;
const GAMMA = 1.12;
const MARKS = Object.fromEntries(opt.mark.map(m => { const [k, v] = m.split('='); return [k, vec(v)]; }));
const CLIP = opt.clip;
// Collision hulls and effect emitters are never drawn.
const keep = name => !/collision|^Em_/i.test(name) && (!opt.only || opt.only.split(',').some(p => name.startsWith(p)))
  && !(opt.skip && opt.skip.split(',').some(p => name.startsWith(p)));

const THREE = await import(join(ROOT, 'ui/node_modules/three/build/three.module.js'));
const { GLTFLoader } = await import(join(ROOT, 'ui/node_modules/three/examples/jsm/loaders/GLTFLoader.js'));

// --- pose: the glb without its textures (no DOM to decode them), each
// material's image remembered ---------------------------------------------------
const buf = readFileSync(glbPath);
const jsonLength = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString());
const imageOf = json.materials.map(m => {
  const ref = m.pbrMetallicRoughness?.baseColorTexture;
  const tex = ref && json.textures[ref.index];
  return tex ? (tex.source ?? Object.values(tex.extensions ?? {})[0]?.source ?? -1) : -1;
});
const imageUris = json.images.map(i => i.uri);
for (const m of json.materials) {
  if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  delete m.normalTexture;
}
delete json.textures; delete json.images; delete json.samplers;
let jsonChunk = Buffer.from(JSON.stringify(json));
jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc((4 - (jsonChunk.length % 4)) % 4, 0x20)]);
const binChunk = buf.subarray(20 + jsonLength);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const glb = Buffer.concat([header, jsonChunk, binChunk]);
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '');
const clip = gltf.animations.find(a => a.name === CLIP);
if (clip) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  mixer.update(+opt.time);
} else if (gltf.animations.length && CLIP !== 'none') {
  console.warn(`no clip ${CLIP}; the glb has: ${gltf.animations.map(a => a.name).join(', ')}`);
}
gltf.scene.updateMatrixWorld(true);

const tris = [];
const v = new THREE.Vector3();
gltf.scene.traverse(o => {
  if (!o.isMesh || !keep(o.name)) return;
  const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, index = g.index;
  if (o.isSkinnedMesh) o.skeleton.update();
  const world = [];
  for (let i = 0; i < pos.count; i++) {
    if (o.isSkinnedMesh) o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
    else v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    world.push([v.x, v.y, v.z]);
  }
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const group of groups) {
    const m = mats[group.materialIndex];
    const img = imageOf[gltf.parser.associations.get(m)?.materials ?? -1] ?? -1;
    for (let k = group.start; k < group.start + group.count; k += 3) {
      const ids = [0, 1, 2].map(j => (index ? index.getX(k + j) : k + j));
      tris.push({ mesh: o.name, p: ids.map(i => world[i]), uv: uv && ids.map(i => [uv.getX(i), uv.getY(i)]), img,
        c: [m.color.r, m.color.g, m.color.b], cutout: m.alphaTest > 0 || m.transparent });
    }
  }
});

if (opt.bounds) {
  const by = {};
  for (const t of tris) for (const p of t.p) {
    const b = (by[t.mesh] ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 });
    p.forEach((c, i) => { b.min[i] = Math.min(b.min[i], c); b.max[i] = Math.max(b.max[i], c); });
  }
  for (const t of tris) by[t.mesh].tris++;
  for (const [name, b] of Object.entries(by)) {
    console.log(`${name.padEnd(36)} ${String(b.tris / 3 | 0).padStart(5)} tris  min ${b.min.map(c => c.toFixed(2)).join(',')}  max ${b.max.map(c => c.toFixed(2)).join(',')}`);
  }
  console.log(`clips: ${gltf.animations.map(a => a.name).join(', ') || 'none'}`);
  process.exit(0);
}

// --- textures: webp decoded by Pillow into raw RGBA -------------------------------
const work = mkdtempSync(join(tmpdir(), 'game-sprite-'));
const glbDir = dirname(resolve(glbPath));
const textures = imageUris.map((uri, i) => {
  const raw = join(work, `t${i}.rgba`);
  try {
    execFileSync('python3', ['-c', `import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
open(sys.argv[2], 'wb').write(im.width.to_bytes(4, 'little') + im.height.to_bytes(4, 'little') + im.tobytes())`, resolve(glbDir, uri), raw]);
    const b = readFileSync(raw);
    return { w: b.readUInt32LE(0), h: b.readUInt32LE(4), px: b.subarray(8) };
  } catch (error) {
    console.warn('texture not read:', uri, error.message);
    return null;
  }
});

// --- raster ------------------------------------------------------------------------
const S = CAMERA.ss;
const light = LIGHT.map(c => c / Math.hypot(...LIGHT));

/** Where a world point lands on the supersampled canvas of `camera`. */
function projector(camera) {
  const W = camera.w * S, H = camera.h * S;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  return ([x, y, z]) => {
    x -= camera.centre[0]; y -= camera.centre[1]; z -= camera.centre[2];
    const x1 = cy * x - sy * z, z1 = sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    return [W / 2 + x1 * camera.scale * S, H / 2 - y2 * camera.scale * S, z2];
  };
}

/** The triangles drawn by `camera`: RGBA bytes at 1x. */
function draw(camera) {
  const OW = camera.w, OH = camera.h, W = OW * S, H = OH * S;
  const project = projector(camera);
  const colour = new Float32Array(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  for (const t of tris) {
    const P = t.p.map(project);
    const [a, b, c] = t.p;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(...n) || 1;
    const shade = AMBIENT + (1 - AMBIENT) * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl);
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const T = textures[t.img];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den;
      const w1 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
      const i = y * W + x;
      if (z >= depth[i]) continue;
      let [r, g, bl] = t.c;
      if (T && t.uv) {
        let tu = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0];
        let tv = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
        tu -= Math.floor(tu); tv -= Math.floor(tv);
        const k = (Math.min(T.h - 1, Math.floor(tv * T.h)) * T.w + Math.min(T.w - 1, Math.floor(tu * T.w))) * 4;
        if (t.cutout && T.px[k + 3] < 128) continue;
        r *= T.px[k] / 255; g *= T.px[k + 1] / 255; bl *= T.px[k + 2] / 255;
      }
      depth[i] = z;
      colour.set([r * shade, g * shade, bl * shade, 1], i * 4);
    }
  }
  const out = Buffer.alloc(OW * OH * 4);
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const k = ((y * S + j) * W + x * S + i) * 4;
      r += colour[k]; g += colour[k + 1]; b += colour[k + 2]; a += colour[k + 3];
    }
    const k = (y * OW + x) * 4, n = a || 1;
    out[k] = Math.min(255, Math.round((r / n) ** (1 / GAMMA) * 255));
    out[k + 1] = Math.min(255, Math.round((g / n) ** (1 / GAMMA) * 255));
    out[k + 2] = Math.min(255, Math.round((b / n) ** (1 / GAMMA) * 255));
    out[k + 3] = Math.round((a / (S * S)) * 255);
  }
  return out;
}

const rgba = (w, h, bytes) => Buffer.concat([Buffer.from(new Uint32Array([w, h]).buffer), bytes]);

// --- a contact sheet of eight yaws, to pick an angle ------------------------------
if (opt.sheet) {
  const yaws = Array.from({ length: 8 }, (_, i) => -Math.PI + (i * Math.PI) / 4);
  const files = yaws.map((yaw, i) => {
    const f = join(work, `y${i}.rgba`);
    writeFileSync(f, rgba(CAMERA.w, CAMERA.h, draw({ ...CAMERA, yaw })));
    return f;
  });
  const sheet = outPath.replace(/\.webp$/, '') + '.sheet.png';
  execFileSync('python3', ['-c', `import sys
from PIL import Image, ImageDraw
ims = []
for f in sys.argv[2:]:
    b = open(f, 'rb').read(); w, h = int.from_bytes(b[:4], 'little'), int.from_bytes(b[4:8], 'little')
    ims.append(Image.frombytes('RGBA', (w, h), b[8:]))
w, h = ims[0].size
s = Image.new('RGBA', (w * 2, h * 4), (18, 18, 16, 255))
for i, im in enumerate(ims):
    s.alpha_composite(im, ((i % 2) * w, (i // 2) * h))
    ImageDraw.Draw(s).text(((i % 2) * w + 6, (i // 2) * h + 4), 'yaw %.2f' % (-3.14159 + i * 0.785398), fill=(200, 194, 152, 255))
s.save(sys.argv[1])`, sheet, ...files]);
  console.log(`wrote ${sheet}`);
  process.exit(0);
}

// --- crop to what was drawn, write webp ---------------------------------------------
const rawPath = join(work, 'sprite.rgba');
writeFileSync(rawPath, rgba(CAMERA.w, CAMERA.h, draw(CAMERA)));
const crop = JSON.parse(execFileSync('python3', ['-c', `import sys, json
from PIL import Image
b = open(sys.argv[1], 'rb').read()
w, h = int.from_bytes(b[:4], 'little'), int.from_bytes(b[4:8], 'little')
im = Image.frombytes('RGBA', (w, h), b[8:])
l, t, r, bt = (0, 4, w, h + 4) if sys.argv[3] == '1' else im.getbbox()
box = (0, 0, w, h) if sys.argv[3] == '1' else (l - 4, t - 4, r + 4, bt + 4)
im.crop(box).save(sys.argv[2], 'WEBP', quality=88, method=6)
print(json.dumps({'left': box[0], 'top': box[1], 'w': box[2] - box[0], 'h': box[3] - box[1]}))`, rawPath, outPath, opt['no-crop'] ? '1' : '0']).toString());

const project = projector(CAMERA);
const at = p => { const [x, y] = project(p); return [+((x / S - crop.left) / 2).toFixed(1), +((y / S - crop.top) / 2).toFixed(1)]; };
console.log(`wrote ${outPath}: ${crop.w} x ${crop.h} (${crop.w / 2} x ${crop.h / 2} CSS px at 2x), ${tris.length} triangles`);
for (const [name, p] of Object.entries(MARKS)) console.log(`${name}: ${at(p).join(', ')} (CSS px in the sprite)`);
