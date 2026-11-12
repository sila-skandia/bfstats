// Tracers: a round drawn as it flies, a bright streak with a glowing head,
// and the faint line it leaves behind from where it left to where it ended,
// with a flash there. Orange for a round that did damage, pale khaki for one
// that did not. Shared by the replay's shot lines (replay-shotlines.js) and
// its spotlight on a kill (replay-spotlight.js), so a round looks the same
// in both.
//
// One LineSegments and one Points, filled again each frame: `begin()`, then
// `segment`, `head` or `straight` for each round, then `end()`. Colours carry
// their own alpha (a four-wide colour attribute), blended normally, so a line
// reads on snow as well as at night.

import * as THREE from 'three';

/** A round that did damage, and one that did not. */
export const TRACER_HIT = new THREE.Color(0xf0913c);
export const TRACER_MISS = new THREE.Color(0xe4ddb0);
/** A streak is this many seconds of the round's flight, at most this many metres. */
export const TRACER_TAIL = 0.06;
export const TRACER_TAIL_MAX = 40;
/** Seconds of replay the line a round leaves stays after it lands, fading
 *  out over the last half. */
export const TRACER_LIFE = 4;
/** Seconds the flash where a round ended takes to go. */
export const TRACER_FLASH = 0.5;
/** How strong the line a round leaves is, at its end and at its start. */
const TRAIL_END = 0.6;
const TRAIL_START = 0.18;

let glow = null;
/** A soft round spot for the heads (none under node). */
function glowTexture() {
  if (glow || typeof document === 'undefined') return glow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

const X = v => (v.isVector3 ? v.x : v[0]);
const Y = v => (v.isVector3 ? v.y : v[1]);
const Z = v => (v.isVector3 ? v.z : v[2]);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class Tracers {
  /** `capacity` segments and as many heads. */
  constructor(capacity, { size = 9, name = 'tracers' } = {}) {
    this.capacity = capacity;
    this.n = 0;
    this.m = 0;
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 8), 4).setUsage(THREE.DynamicDrawUsage));
    lineGeometry.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
    }));
    const headGeometry = new THREE.BufferGeometry();
    headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    headGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    headGeometry.setDrawRange(0, 0);
    this.heads = new THREE.Points(headGeometry, new THREE.PointsMaterial({
      size, sizeAttenuation: false, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.group = new THREE.Group();
    this.group.name = name;
    for (const node of [this.group, this.lines, this.heads]) {
      node.frustumCulled = false;
      node.matrixAutoUpdate = false;
    }
    this.lines.renderOrder = 10;
    this.heads.renderOrder = 11;
    this.group.add(this.lines, this.heads);
    this.group.updateMatrixWorld(true);
    this.group.visible = false;
  }

  begin() {
    this.n = 0;
    this.m = 0;
  }

  /** A line from `a` to `b` (Vector3s or [x, y, z]), its alpha from `alphaA`
   *  to `alphaB`. */
  segment(a, b, colour, alphaA, alphaB) {
    if (this.n >= this.capacity || !(alphaA > 0.004 || alphaB > 0.004)) return;
    const p = this.lines.geometry.attributes.position.array;
    const c = this.lines.geometry.attributes.color.array;
    const o = this.n * 6;
    p[o] = X(a); p[o + 1] = Y(a); p[o + 2] = Z(a);
    p[o + 3] = X(b); p[o + 4] = Y(b); p[o + 5] = Z(b);
    const k = this.n * 8;
    c[k] = colour.r; c[k + 1] = colour.g; c[k + 2] = colour.b; c[k + 3] = alphaA;
    c[k + 4] = colour.r; c[k + 5] = colour.g; c[k + 6] = colour.b; c[k + 7] = alphaB;
    this.n++;
  }

  /** A glowing spot at `at`. */
  head(at, colour, alpha) {
    if (this.m >= this.capacity || !(alpha > 0.004)) return;
    const p = this.heads.geometry.attributes.position.array;
    const c = this.heads.geometry.attributes.color.array;
    p[this.m * 3] = X(at); p[this.m * 3 + 1] = Y(at); p[this.m * 3 + 2] = Z(at);
    c[this.m * 4] = colour.r; c[this.m * 4 + 1] = colour.g; c[this.m * 4 + 2] = colour.b; c[this.m * 4 + 3] = alpha;
    this.m++;
  }

  /**
   * A round down any path at time `t`: `at(s, out)` its place `s` seconds
   * into its flight, `span` the seconds it flew. In the air, its streak and
   * head, with the line it has left so far; once it has ended, that line
   * whole and the flash where it ended. `k` fades it all (0 to 1), `trail`
   * how much of the line it leaves (0 for none), `steps` how many pieces a
   * curved path is drawn in.
   */
  flight(at, span, age, colour, { k = 1, trail = 1, tail = TRACER_TAIL, steps = 1 } = {}) {
    if (!(age >= 0) || !(span > 0)) return;
    const head = Math.min(age, span);
    const back = Math.min(Math.max(0, age - tail), span);
    // The line left behind, from where it left to where the streak begins.
    if (trail > 0 && back > 0) {
      const pieces = Math.max(1, Math.ceil((steps * back) / span));
      at(0, _p);
      for (let i = 1; i <= pieces; i++) {
        at((back * i) / pieces, _q);
        const u0 = (back * (i - 1)) / pieces / span;
        const u1 = (back * i) / pieces / span;
        this.segment(_p, _q, colour, k * trail * (TRAIL_START + (TRAIL_END - TRAIL_START) * u0),
          k * trail * (TRAIL_START + (TRAIL_END - TRAIL_START) * u1));
        _p.copy(_q);
      }
    }
    // The streak, while any of it is in the air.
    if (back < head) {
      at(back, _p);
      const tip = at(head, new THREE.Vector3());
      this.segment(_p, tip, colour, k * 0.3, k);
      if (age <= span) this.head(tip, colour, k);
    }
    // The flash where it ended.
    if (age > span) this.head(at(span, _q), colour, k * Math.max(0, 1 - (age - span) / TRACER_FLASH));
  }

  /** A round straight from `a` to `b`, `span` seconds in the air, `age`
   *  seconds after it left. */
  straight(a, b, span, age, colour, options = {}) {
    const ax = X(a); const ay = Y(a); const az = Z(a);
    const dx = X(b) - ax; const dy = Y(b) - ay; const dz = Z(b) - az;
    const length = Math.hypot(dx, dy, dz);
    const tail = Math.min(TRACER_TAIL, length > 0 && span > 0 ? (TRACER_TAIL_MAX * span) / length : TRACER_TAIL);
    const at = (s, out) => {
      const u = span > 0 ? Math.min(1, s / span) : 1;
      return out.set(ax + dx * u, ay + dy * u, az + dz * u);
    };
    this.flight(at, span, age, colour, { ...options, tail, steps: 1 });
  }

  end() {
    const lines = this.lines.geometry;
    const heads = this.heads.geometry;
    lines.setDrawRange(0, this.n * 2);
    heads.setDrawRange(0, this.m);
    lines.attributes.position.needsUpdate = true;
    lines.attributes.color.needsUpdate = true;
    heads.attributes.position.needsUpdate = true;
    heads.attributes.color.needsUpdate = true;
    this.group.visible = this.n + this.m > 0;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const node of [this.lines, this.heads]) {
      node.geometry.dispose();
      node.material.dispose();
    }
  }
}
