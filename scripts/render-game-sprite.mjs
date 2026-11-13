#!/usr/bin/env node
// Draws a sprite of anything in the game for a loading animation (skill
// `game-loading-animations`; the first is the Short loader's soldier,
// tools/bf1942-models/viewer/play/loaders/brass.js). A model or pose glb from
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
//   --gait <name>        pose a pose glb at one of its gaits instead (run, walk, crouchwalk,
//                        crawl): the lower and upper clips from its .pose.json's gaitAssets,
//                        or any lower/upper clip pair by name, e.g. --gait Lb_StandToCrouch+crouch.upper
//   --frames <n>         draw n frames from --time to --to (default the clip's end) side by
//                        side into one strip, one camera and one crop: a sprite strip for CSS
//                        steps(). Each frame is the strip's height tall and its width / n wide.
//   --clips a,b,c        a strip of the pose glb's clips instead, one frame each at --time (stand,crouch,lie):
//                        one sprite holds every pose a soldier takes, all lined up on his feet
//   --tween <n>          with --clips: n frames between each pair of clips, the bones blended
//                        from one clip to the next (three.js mixes the two by weight), so a
//                        stand -> crouch is a smooth sequence instead of a cut
//   --to <s>             the strip's last frame time      (the clip's length, exclusive)
//   --yaw/--pitch <rad>  the camera, orthographic: yaw about up, then pitch (positive looks
//                        down). A negative value needs '=': --yaw=-1.2
//   --scale <px/m>       pixels per metre at 1x before supersampling
//   --centre x,y,z       the world point at the canvas centre
//   --size WxH           the canvas before cropping      (700x240)
//   --only a,b / --skip a,b   mesh names (prefixes) to draw or leave out: layers
//                        (collision hulls, Em_ emitters, _projectile, _tracer and _trail are always left out)
//   --pick <k>           with --only <name>: draw just the k-th object of that exact name (from 0),
//                        in its own frame at the origin, without its LODs. For a static out of a
//                        level bake (maps/<level>/scene.glb): a sandbag wall, a hedge, a ruin
//   --no-crop            keep the whole canvas, so layers drawn with one camera line up
//   --mark name=x,y,z    a world point to report in sprite pixels (repeatable)
//   --bounds             print each mesh's world bounds and stop (to pick a camera)
//   --sheet              draw eight yaws in a contact sheet instead (to pick an angle)
//   --out <path>         the webp                       (play/loaders/brass-soldier.webp)
//
// For stills (the forum signatures, scripts/signatures/render_signature_art.py):
//   --rot rx,ry,rz       turn the model before posing it (radians, Euler YXZ: yaw, then
//                        pitch, then roll about its own nose): a fighter banked into a turn,
//                        a dive bomber nose down
//   --fit <margin>       choose --scale and --centre so the drawing fills the canvas, leaving
//                        <margin> of it free on every side (0.06); the chosen values go to
//                        --marks-json, so a second layer can be drawn with the same camera
//   --shading studio     a key light, a cool fill and a rim light from behind, each face lit
//                        on the side the camera sees, instead of the flat loader look
//   --projectiles        draw the _projectile meshes too (a plane's bombs, a tank's shell)
//   --mark-extreme n=prefix:dx,dy   the drawn vertex of the meshes named prefix* (or
//                        @rigid: every mesh that is not skinned, i.e. the weapon in a pose;
//                        @all: everything) furthest along the screen direction dx,dy (y down):
//                        a muzzle. prefix:w:x,y,z goes along a world direction instead (a
//                        barrel's tip), and prefix:centre takes the middle of its bounds (a hub)
//   --kit <kits.json>#<template>   hang the kit's worn parts (helmet, packs) on the
//                        soldier's bones, as the viewer does; part glbs are looked up beside
//                        kits.json, then in each --kit-fallback directory
//   --marks-json <path>  write the marks (in pixels of the written sprite), the crop and
//                        the camera as JSON
//
// The marks are printed in CSS pixels of the sprite as shown at half its size
// (it is drawn at 2x): loaders/brass.js's MUZZLE and PORT are those numbers.
// Needs ui/node_modules (three) and python3 with Pillow (webp).

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
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
  gait: { type: 'string' },
  frames: { type: 'string', default: '1' },
  clips: { type: 'string' },
  tween: { type: 'string', default: '0' },
  to: { type: 'string' },
  yaw: { type: 'string', default: '-1.45' },
  pitch: { type: 'string', default: '-0.14' },
  scale: { type: 'string', default: '230' },
  centre: { type: 'string', default: '-0.05,0.15,0.3' },
  size: { type: 'string', default: '700x240' },
  only: { type: 'string' },
  skip: { type: 'string' },
  'no-crop': { type: 'boolean', default: false },
  pick: { type: 'string' },
  mark: { type: 'string', multiple: true, default: ['muzzle=-0.14,0.16,1.67', 'port=-0.13,0.19,0.97'] },
  bounds: { type: 'boolean', default: false },
  sheet: { type: 'boolean', default: false },
  out: { type: 'string', default: 'play/loaders/brass-soldier.webp' },
  rot: { type: 'string' },
  fit: { type: 'string' },
  shading: { type: 'string', default: 'flat' },
  projectiles: { type: 'boolean', default: false },
  'mark-extreme': { type: 'string', multiple: true, default: [] },
  'marks-json': { type: 'string' },
  kit: { type: 'string' },
  'kit-fallback': { type: 'string', multiple: true },
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
// Collision hulls, effect emitters and the projectile, tracer and trail
// meshes a weapon carries are never drawn.
const NEVER = opt.projectiles ? /collision|^Em_|_tracer$|_trail$/i : /collision|^Em_|_projectile$|_tracer$|_trail$/i;
const keep = name => !NEVER.test(name) && (!opt.only || opt.only.split(',').some(p => name.startsWith(p)))
  && !(opt.skip && opt.skip.split(',').some(p => name.startsWith(p)));

const THREE = await import(join(ROOT, 'ui/node_modules/three/build/three.module.js'));
const { GLTFLoader } = await import(join(ROOT, 'ui/node_modules/three/examples/jsm/loaders/GLTFLoader.js'));

// --- pose: the glb without its textures (no DOM to decode them), each
// material's image remembered ---------------------------------------------------
/** A glb parsed without its textures, with each material's image index and
 *  every image's path (resolved against the glb's own directory). */
async function loadStripped(path) {
  const buf = readFileSync(path);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString());
  const imageOf = (json.materials ?? []).map(m => {
    const ref = m.pbrMetallicRoughness?.baseColorTexture;
    const tex = ref && json.textures[ref.index];
    return tex ? (tex.source ?? Object.values(tex.extensions ?? {})[0]?.source ?? -1) : -1;
  });
  const imageUris = (json.images ?? []).map(i => resolve(dirname(resolve(path)), i.uri));
  // Every texture reference goes, at any depth (a level bake's materials carry
  // lightmaps and other maps in extensions too).
  const dropTextures = o => {
    for (const k of Object.keys(o)) {
      if (/Texture$/.test(k)) delete o[k];
      else if (o[k] && typeof o[k] === 'object') dropTextures(o[k]);
    }
  };
  (json.materials ?? []).forEach(dropTextures);
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
  return { gltf, imageOf, imageUris };
}
const main = await loadStripped(glbPath);
const { gltf, imageOf } = main;
const imageUris = [...main.imageUris];
// Worn kit parts (a helmet on bone A, a pack on backpack or HipPack), hung the
// way the viewer hangs them (viewer/kit-graft.js): world(part) = world(bone) * slot.
if (opt.kit) {
  const { wornGrafts, bonePattern, kitsByTemplate } = await import(join(VIEWER, 'kit-graft.js'));
  const [kitsPath, template] = opt.kit.split('#');
  const kit = kitsByTemplate(JSON.parse(readFileSync(kitsPath, 'utf8'))).get(template.toLowerCase());
  if (!kit) throw new Error(`--kit: no kit ${template} in ${kitsPath}`);
  const searched = [dirname(kitsPath), ...(opt['kit-fallback'] ?? [])];
  for (const graft of wornGrafts(kit)) {
    const pattern = bonePattern(graft.bone);
    let bone = null;
    gltf.scene.traverse(o => { if (!bone && pattern.test(o.name)) bone = o; });
    const file = searched.map(d => join(d, graft.glb)).find(f => existsSync(f));
    if (!bone || !file) { console.warn(`kit part ${graft.glb}: ${bone ? 'no file' : `no bone ${graft.bone}`}`); continue; }
    const part = await loadStripped(file);
    const offset = imageUris.length;
    imageUris.push(...part.imageUris);
    part.gltf.scene.traverse(o => {
      if (o.isMesh) o.userData.imageOf = m => {
        const i = part.imageOf[part.gltf.parser.associations.get(m)?.materials ?? -1] ?? -1;
        return i < 0 ? -1 : i + offset;
      };
    });
    part.gltf.scene.quaternion.set(...graft.quaternion);
    part.gltf.scene.position.set(...graft.position);
    bone.add(part.gltf.scene);
  }
}
if (opt.rot) {
  const [rx, ry, rz] = vec(opt.rot);
  const turn = new THREE.Object3D();
  turn.rotation.set(rx, ry, rz, 'YXZ');
  turn.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  // collect() draws gltf.scene's world matrices, which now include the turn.
  turn.updateMatrixWorld(true);
  gltf.turn = turn;
}
// The clips to play together: the pose glb's own clip, or a gait's lower and
// upper body clips from the shared gait glbs (they animate the same bone names).
async function parseGlb(path) {
  const b = readFileSync(path);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '');
}
const clips = [];
if (opt.gait) {
  // A mod tree's poses carry no recipe: its gaits are gaits/lower and gaits/<weapon>.
  const recipePath = glbPath.replace(/\.glb$/, '.json');
  const weapon = glbPath.match(/__([^/]+)\.pose\.glb$/)?.[1];
  const recipe = existsSync(recipePath) ? JSON.parse(readFileSync(recipePath, 'utf8'))
    : { gaitAssets: { lower: 'gaits/lower.gait.glb', upper: `gaits/${weapon}.gait.glb` } };
  const [lower, upper] = opt.gait.includes('+') ? opt.gait.split('+') : [`${opt.gait}.lower`, `${opt.gait}.upper`];
  for (const [file, name] of [[recipe.gaitAssets.lower, lower], [recipe.gaitAssets.upper, upper]]) {
    const anims = (await parseGlb(resolve(dirname(glbPath), file))).animations;
    const found = anims.find(a => a.name === name);
    if (!found) throw new Error(`no clip ${name} in ${file}; it has: ${anims.map(a => a.name).join(', ')}`);
    clips.push(found);
  }
} else {
  const clip = gltf.animations.find(a => a.name === CLIP);
  if (clip) clips.push(clip);
  else if (gltf.animations.length && CLIP !== 'none') {
    console.warn(`no clip ${CLIP}; the glb has: ${gltf.animations.map(a => a.name).join(', ')}`);
  }
}
const mixer = clips.length ? new THREE.AnimationMixer(gltf.scene) : null;
for (const c of clips) mixer.clipAction(c).play();
const poser = mixer ?? new THREE.AnimationMixer(gltf.scene);
const length = Math.max(0, ...clips.map(c => c.duration));
const clipFrames = opt.clips ? opt.clips.split(',') : null;
let FRAMES = Math.max(1, +opt.frames | 0);
const T0 = +opt.time;
const T1 = opt.to !== undefined ? +opt.to : length;
const clipNamed = name => {
  const c = gltf.animations.find(a => a.name === name);
  if (!c) throw new Error(`no clip ${name}; the glb has: ${gltf.animations.map(a => a.name).join(', ')}`);
  return c;
};
const TWEEN = Math.max(0, +opt.tween | 0);
const frameTimes = clipFrames
  ? clipFrames.flatMap((name, i) => {
    const frame = { clip: clipNamed(name), t: T0, toFixed: () => name };
    if (i === clipFrames.length - 1 || !TWEEN) return [frame];
    const next = clipNamed(clipFrames[i + 1]);
    return [frame, ...Array.from({ length: TWEEN }, (_, k) => {
      const w = (k + 1) / (TWEEN + 1);
      return { clip: frame.clip, to: next, w, t: T0, toFixed: () => `${name}>${clipFrames[i + 1]}@${w.toFixed(2)}` };
    })];
  })
  : Array.from({ length: FRAMES }, (_, i) => (FRAMES === 1 ? T0 : T0 + ((T1 - T0) * i) / FRAMES));
FRAMES = frameTimes.length;

/** The scene's triangles posed `t` seconds into the clips. */
function collect(t) {
  if (typeof t === 'object') {
    poser.stopAllAction();
    const a = poser.clipAction(t.clip);
    a.reset().play();
    a.setEffectiveWeight(t.to ? 1 - t.w : 1);
    if (t.to) {
      const b = poser.clipAction(t.to);
      b.reset().play();
      b.setEffectiveWeight(t.w);
    }
    poser.setTime(t.t);
  } else if (mixer) { mixer.setTime(t); }
  (gltf.turn ?? gltf.scene).updateMatrixWorld(true);
  const tris = [];
  const v = new THREE.Vector3();
  let from = gltf.scene;
  const local = new THREE.Matrix4();
  if (opt.pick !== undefined) {
    const named = [];
    gltf.scene.traverse(o => { if (opt.only.split(',').includes(o.name)) named.push(o); });
    from = named[+opt.pick];
    if (!from) throw new Error(`--pick ${opt.pick}: there are ${named.length} objects named ${opt.only}`);
    local.copy(from.matrixWorld).invert();
  }
  from.traverse(o => {
  if (!o.isMesh || !keep(o.name) || (opt.pick !== undefined && /_lod\d+$/.test(o.name))) return;
  const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, index = g.index;
  if (o.isSkinnedMesh) o.skeleton.update();
  const world = [];
  for (let i = 0; i < pos.count; i++) {
    if (o.isSkinnedMesh) o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
    else v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    if (from !== gltf.scene) v.applyMatrix4(local);
    world.push([v.x, v.y, v.z]);
  }
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const group of groups) {
    const m = mats[group.materialIndex];
    const img = o.userData.imageOf ? o.userData.imageOf(m) : imageOf[gltf.parser.associations.get(m)?.materials ?? -1] ?? -1;
    for (let k = group.start; k < group.start + group.count; k += 3) {
      const ids = [0, 1, 2].map(j => (index ? index.getX(k + j) : k + j));
      tris.push({ mesh: o.name, rigid: !o.isSkinnedMesh && !o.userData.imageOf, p: ids.map(i => world[i]), uv: uv && ids.map(i => [uv.getX(i), uv.getY(i)]), img,
        c: [m.color.r, m.color.g, m.color.b], cutout: m.alphaTest > 0 || m.transparent });
    }
  }
  });
  return tris;
}
let tris = collect(frameTimes[0]);

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

// --- fit: the scale and centre that make the drawing fill the canvas ---------------
if (opt.fit !== undefined) {
  const margin = +opt.fit;
  const probe = projector({ ...CAMERA, centre: [0, 0, 0], scale: 1, w: 0, h: 0 }, 1);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of tris) for (const p of t.p) {
    const [x, y] = probe(p);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const scale = Math.min((CAMERA.w * (1 - 2 * margin)) / (x1 - x0), (CAMERA.h * (1 - 2 * margin)) / (y1 - y0));
  // The screen point to centre, back in world terms: x right, y up in the camera's frame.
  const sx = (x0 + x1) / 2, sy = -(y0 + y1) / 2;
  const cy = Math.cos(CAMERA.yaw), syw = Math.sin(CAMERA.yaw), cp = Math.cos(CAMERA.pitch), sp = Math.sin(CAMERA.pitch);
  // Inverse of the projection's rotation for a point at camera depth 0.
  const y = cp * sy, z1 = -sp * sy;
  CAMERA.centre = [cy * sx + syw * z1, y, -syw * sx + cy * z1];
  CAMERA.scale = scale;
}

// --- raster ------------------------------------------------------------------------
const S = CAMERA.ss;
const light = LIGHT.map(c => c / Math.hypot(...LIGHT));
const STUDIO = opt.shading === 'studio';
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
/** The direction from the scene towards the camera, in world terms. */
function towardCamera(camera) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  // Depth (z2) grows away from the viewer, so the camera is along (0, 0, -1) in
  // camera space; the rotation's transpose takes that back to the world.
  const Y = -sp, Z1 = -cp;
  return unit([sy * Z1, Y, cy * Z1]);
}
const KEY = unit([-0.55, 0.75, 0.35]), FILL = unit([0.7, 0.2, 0.3]), RIM = unit([0.2, 0.45, -0.85]);

/** Where a world point lands on the supersampled canvas of `camera`. */
function projector(camera, ss = S) {
  const W = camera.w * ss, H = camera.h * ss;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  return ([x, y, z]) => {
    x -= camera.centre[0]; y -= camera.centre[1]; z -= camera.centre[2];
    const x1 = cy * x - sy * z, z1 = sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    return [W / 2 + x1 * camera.scale * ss, H / 2 - y2 * camera.scale * ss, z2];
  };
}

/** The triangles drawn by `camera`: RGBA bytes at 1x. */
function draw(camera) {
  const OW = camera.w, OH = camera.h, W = OW * S, H = OH * S;
  const project = projector(camera);
  const view = towardCamera(camera);
  const colour = new Float32Array(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  for (const t of tris) {
    const P = t.p.map(project);
    const [a, b, c] = t.p;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(...n) || 1;
    let shade = AMBIENT + (1 - AMBIENT) * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl);
    let tint = null;
    if (STUDIO) {
      // Face the normal towards the camera: the winding is not to be trusted.
      let N = n.map(c => c / nl);
      const V = view;
      if (N[0] * V[0] + N[1] * V[1] + N[2] * V[2] < 0) N = N.map(c => -c);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const key = Math.max(0, dot(N, KEY)), fill = Math.max(0, dot(N, FILL));
      const rim = Math.pow(1 - Math.max(0, dot(N, V)), 2.2) * Math.max(0.25, dot(N, RIM) + 0.6);
      tint = [0.22 + 1.0 * key + 0.16 * fill + 0.55 * rim,
        0.22 + 0.93 * key + 0.20 * fill + 0.50 * rim,
        0.25 + 0.82 * key + 0.28 * fill + 0.42 * rim];
      shade = 1;
    }
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
      if (tint) colour.set([Math.min(1.4, r * tint[0]), Math.min(1.4, g * tint[1]), Math.min(1.4, bl * tint[2]), 1], i * 4);
      else colour.set([r * shade, g * shade, bl * shade, 1], i * 4);
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
// A strip draws every frame with one camera, crops them all to the union of
// what any frame drew, and lays them side by side.
const rawPaths = frameTimes.map((t, i) => {
  if (i > 0) tris = collect(t);
  const f = join(work, `sprite${i}.rgba`);
  writeFileSync(f, rgba(CAMERA.w, CAMERA.h, draw(CAMERA)));
  return f;
});
const crop = JSON.parse(execFileSync('python3', ['-c', `import sys, json
from PIL import Image
ims = []
for f in sys.argv[4:]:
    b = open(f, 'rb').read()
    w, h = int.from_bytes(b[:4], 'little'), int.from_bytes(b[4:8], 'little')
    ims.append(Image.frombytes('RGBA', (w, h), b[8:]))
w, h = ims[0].size
if sys.argv[3] == '1':
    box = (0, 0, w, h)
else:
    bbs = [im.getbbox() for im in ims if im.getbbox()]
    l, t, r, bt = min(b[0] for b in bbs), min(b[1] for b in bbs), max(b[2] for b in bbs), max(b[3] for b in bbs)
    box = (l - 4, t - 4, r + 4, bt + 4)
    if len(ims) > 1:
        box = (box[0], box[1], box[2] + (box[2] - box[0]) % 2, box[3] + (box[3] - box[1]) % 2)
fw, fh = box[2] - box[0], box[3] - box[1]
if len(ims) == 1:
    out = ims[0].crop(box)
else:
    out = Image.new('RGBA', (fw * len(ims), fh), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        out.paste(im.crop(box), (i * fw, 0))
out.save(sys.argv[2], 'WEBP', quality=88, method=6)
print(json.dumps({'left': box[0], 'top': box[1], 'w': fw, 'h': fh}))`, rawPaths[0], outPath, opt['no-crop'] ? '1' : '0', ...rawPaths]).toString());

const project = projector(CAMERA);
const at = p => { const [x, y] = project(p); return [+((x / S - crop.left) / 2).toFixed(1), +((y / S - crop.top) / 2).toFixed(1)]; };
const strip = FRAMES > 1 ? `, ${FRAMES} frames of ${crop.w / 2} x ${crop.h / 2} CSS px at ${frameTimes.map(t => t.toFixed(3)).join(', ')}` : '';
console.log(`wrote ${outPath}: ${crop.w * FRAMES} x ${crop.h} (${(crop.w * FRAMES) / 2} x ${crop.h / 2} CSS px at 2x), ${tris.length} triangles${strip}`);
for (const [name, p] of Object.entries(MARKS)) console.log(`${name}: ${at(p).join(', ')} (CSS px in the sprite${FRAMES > 1 ? "'s first frame" : ''})`);
// Marks found from the drawing itself: the vertex furthest along a screen direction.
const extremes = {};
for (const spec of opt['mark-extreme']) {
  const [name, rest] = spec.split('=');
  const [prefix, ...how] = rest.split(':');
  const matches = t => (prefix === '@rigid' ? t.rigid : prefix === '@all' ? true : t.mesh.startsWith(prefix));
  let best = null, bestScore = -Infinity;
  if (how[0] === 'centre') {
    // The middle of the meshes' world bounds: a propeller's hub.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) if (matches(t)) for (const p of t.p) p.forEach((c, i) => { lo[i] = Math.min(lo[i], c); hi[i] = Math.max(hi[i], c); });
    if (lo[0] !== Infinity) best = lo.map((c, i) => (c + hi[i]) / 2);
  } else {
    // Along a screen direction (dx,dy, y down), or a world one (w:x,y,z).
    const world = how[0] === 'w';
    const d = vec(world ? how[1] : how[0]);
    for (const t of tris) {
      if (!matches(t)) continue;
      for (const p of t.p) {
        let score;
        if (world) score = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
        else { const [x, y] = project(p); score = x * d[0] + y * d[1]; }
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
  }
  if (best) { extremes[name] = best; console.log(`${name}: ${at(best).join(', ')} (CSS px, extreme of ${prefix})`); }
  else console.warn(`--mark-extreme ${name}: no mesh matches ${prefix}`);
}
if (opt['marks-json']) {
  const px = p => { const [x, y] = project(p); return [+(x / S - crop.left).toFixed(1), +(y / S - crop.top).toFixed(1)]; };
  const marks = Object.fromEntries([...Object.entries(MARKS), ...Object.entries(extremes)].map(([k, p]) => [k, px(p)]));
  writeFileSync(opt['marks-json'], JSON.stringify({
    width: crop.w * FRAMES, height: crop.h, crop, marks,
    camera: { yaw: CAMERA.yaw, pitch: -CAMERA.pitch, scale: CAMERA.scale, centre: CAMERA.centre.map(c => +c.toFixed(4)), size: `${CAMERA.w}x${CAMERA.h}` },
  }, null, 1));
}
