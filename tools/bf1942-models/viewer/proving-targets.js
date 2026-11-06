// The proving ground's silhouette range (features/proving-ground, "The
// silhouettes"): plywood men on posts down a lane beside the garage, one at
// each of nine ranges, named on their boards as the recruits in The Pacific
// named theirs. A round through one knocks it flat; it stands again a few
// seconds later. Nothing here is a level asset: the silhouettes are drawn
// on canvases and hung on planes in the page, and a hit is the page's own
// test of each round's last step against them, not the engine's collision,
// so they cost the world nothing.
//
// The pure parts (`silhouetteTargets`, `segmentHit`, `knockState`) run under
// node for the tests; `createSilhouetteRange` needs three.js and a canvas.

import * as THREE from 'three';
import { PG, PG_COLOURS } from './proving-ground.js';

/** The lane's x, right of the centre lane, between it and the airfield. */
export const SILHOUETTE_LANE_X = PG.LINE_X + 90;
/** The ranges the silhouettes stand at, metres from the firing line. */
export const SILHOUETTE_RANGES = [25, 50, 75, 100, 150, 200, 300, 400, 500];
/** The names on the boards, in turn down the lane. */
export const SILHOUETTE_NAMES = ['TOTO', 'FUCKFACE'];
/** A silhouette's size, metres: the plywood man, and the board under him. */
export const SILHOUETTE = Object.freeze({ width: 0.62, height: 1.6, boardWidth: 1.4, boardHeight: 0.42, postHeight: 0.5 });
/** Seconds a knocked silhouette lies before it stands again, and how long
 *  the fall and the rise take. */
export const KNOCK = Object.freeze({ down: 4, fall: 0.25, rise: 0.45 });

/**
 * Where each silhouette stands: `{ id, name, range, x, z, yaw }` down the
 * lane, facing the firing line (the glb frame: the line is at +z of them,
 * so they face +z, the engine's yaw 180).
 */
export function silhouetteTargets(ranges = SILHOUETTE_RANGES, names = SILHOUETTE_NAMES, laneX = SILHOUETTE_LANE_X) {
  return ranges.map((range, i) => ({
    id: `silhouette-${range}`, name: names[i % names.length], range,
    x: laneX, z: PG.LINE_Z - range, yaw: 180,
  }));
}

/**
 * A knocked silhouette's lean after `age` seconds, 0 standing to 1 flat:
 * it falls in `KNOCK.fall`, lies for `KNOCK.down`, rises in `KNOCK.rise`,
 * and is standing (null) after that.
 */
export function knockState(age, knock = KNOCK) {
  if (typeof age !== 'number' || !(age >= 0)) return null;
  if (age < knock.fall) return age / knock.fall;
  if (age < knock.fall + knock.down) return 1;
  const up = (age - knock.fall - knock.down) / knock.rise;
  return up < 1 ? 1 - up : null;
}

/**
 * Where the segment `a` to `b` (world, arrays) crosses the upright rectangle
 * of a target at `t` (`silhouetteTargets`' row), `width` across x and
 * `height` up from the floor at `floorY`: `{ point, s }` with `s` the
 * fraction along the segment, or null. The rectangle is in the plane
 * z = t.z, as a standing silhouette's is; a fallen one is not asked.
 */
export function segmentHit(a, b, t, floorY, size = SILHOUETTE) {
  const dz = b[2] - a[2];
  if (Math.abs(dz) < 1e-9) return null;
  const s = (t.z - a[2]) / dz;
  if (s < 0 || s > 1) return null;
  const x = a[0] + (b[0] - a[0]) * s;
  const y = a[1] + (b[1] - a[1]) * s;
  if (Math.abs(x - t.x) > size.width / 2) return null;
  const base = floorY + size.postHeight;
  if (y < base || y > base + size.height) return null;
  return { point: [x, y, t.z], s };
}

function silhouetteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 330;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 330);
  // Plywood: the board's colour, a shade darker at the edge.
  ctx.fillStyle = '#b89a62';
  // The man: a head, shoulders and a torso, the range's E-type outline.
  ctx.beginPath();
  ctx.arc(64, 42, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 118);
  ctx.quadraticCurveTo(64, 70, 114, 118);
  ctx.lineTo(118, 330);
  ctx.lineTo(10, 330);
  ctx.closePath();
  ctx.fill();
  // Rings on the chest, the scoring zone.
  ctx.strokeStyle = 'rgba(40, 30, 10, 0.55)';
  ctx.lineWidth = 3;
  for (const r of [14, 30, 46]) { ctx.beginPath(); ctx.arc(64, 185, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = 'rgba(40, 30, 10, 0.75)';
  ctx.beginPath(); ctx.arc(64, 185, 5, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function boardTexture(name, range) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2eee2';
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = '#1d1d1a';
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillRect(0, 150, 512, 10);
  ctx.font = '800 78px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1d1d1a';
  ctx.fillText(name, 256, 60);
  ctx.font = '700 44px "Courier New", monospace';
  const [r, g, b] = PG_COLOURS.range.map(v => Math.round(v * 255));
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillText(`${range} m`, 256, 120);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The range in the page: `scene` to hang it on, `floorY` the floor's
 * height. `hits(a, b)` tests one round's step against every standing
 * silhouette and knocks the first it meets, answering `{ target, point }` or
 * null; `tick(dt)` moves the fallen ones; `state` says who is down.
 */
export function createSilhouetteRange(scene, { floorY = PG.FLOOR } = {}) {
  const root = new THREE.Group();
  root.name = 'pgSilhouettes';
  scene.add(root);
  const man = silhouetteTexture();
  const manMat = new THREE.MeshLambertMaterial({ map: man, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4a30 });
  const targets = silhouetteTargets().map(t => {
    const hinge = new THREE.Group();
    hinge.position.set(t.x, floorY + SILHOUETTE.postHeight, t.z);
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(SILHOUETTE.width, SILHOUETTE.height), manMat);
    plank.position.y = SILHOUETTE.height / 2;
    hinge.add(plank);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, SILHOUETTE.postHeight, 0.08), postMat);
    post.position.set(t.x, floorY + SILHOUETTE.postHeight / 2, t.z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(SILHOUETTE.boardWidth, SILHOUETTE.boardHeight),
      new THREE.MeshLambertMaterial({ map: boardTexture(t.name, t.range), side: THREE.DoubleSide }));
    board.position.set(t.x, floorY + SILHOUETTE.boardHeight / 2 + 0.02, t.z + 0.6);
    root.add(hinge, post, board);
    return { ...t, hinge, plank, knockedAt: null, age: 0, hits: 0 };
  });
  let clock = 0;

  function hits(a, b) {
    for (const t of targets) {
      if (t.knockedAt != null) continue;
      const hit = segmentHit(a, b, t, floorY);
      if (!hit) continue;
      t.knockedAt = clock;
      t.hits++;
      return { target: t, point: hit.point };
    }
    return null;
  }

  function tick(dt) {
    clock += dt;
    for (const t of targets) {
      if (t.knockedAt == null) continue;
      const lean = knockState(clock - t.knockedAt);
      if (lean == null) { t.knockedAt = null; t.hinge.rotation.x = 0; continue; }
      // Falls away from the firing line: back, about the base.
      t.hinge.rotation.x = -lean * (Math.PI / 2) * 0.96;
    }
  }

  return {
    root,
    hits,
    tick,
    targets,
    get state() {
      return targets.map(t => ({ id: t.id, name: t.name, range: t.range, down: t.knockedAt != null, hits: t.hits }));
    },
  };
}
