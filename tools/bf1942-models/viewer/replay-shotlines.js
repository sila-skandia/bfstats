// Shot lines: the engine's `game.drawDebug` for a replay (features/replay-accuracy,
// "Shot lines"). Retail keeps a line from where each round left the barrel to
// where it struck, green when it did damage and red when it did not (ledger
// IMP-9), and draws them only on the machine that hosted the round (IMP-10).
// Here every recorded round gets one, fading over a few seconds of replay.
//
// Where the line ends:
// - a server recording that carries the server's own collisions (`i`, IMP-9:
//   the barrel, the contact point, whether it did damage) draws those, as the
//   game would have;
// - anything else draws each recorded round (`f`) from where it left. Whether
//   it hit is the Accuracy rebuild's verdict (replay-accuracy.js: the round
//   passed through a victim whose hit points then dropped, or its blast hurt
//   an enemy): a hit ends where it met him, green; a miss ends where the
//   page's own replayed round struck (round-impact.js records), red. The
//   page's round does not stop on a replayed soldier, so it is never the hit
//   test here. A miss whose round struck nothing has no line, as in the game.
//
// Owns one LineSegments in the scene; `update(t)` each frame, `clear()` on a seek.

import * as THREE from 'three';

/** Seconds of replay a line stays, fading out over the last half. */
export const SHOT_LINE_LIFE = 4;
/** Lines held at once; the oldest goes first. */
const CAPACITY = 2048;
const HIT = new THREE.Color(0x45ff6a);
/** A miss waits this long, seconds, for where its round struck. */
const PENDING_LIFE = 4;
/** How near a struck round's launch point must be to a waiting miss's, and
 *  how close its line to the miss's direction (cos of ~3 degrees). */
const MATCH_REACH = 6;
const MATCH_COS = 0.9986;
const MISS = new THREE.Color(0xff4b3e);

export class ReplayShotLines {
  constructor(player) {
    this.player = player;
    this.on = false;
    this.lines = [];               // { t, a: [x,y,z], b: [x,y,z], hit }
    this.seen = new WeakSet();     // the page's impact records already taken
    this.pending = [];             // misses waiting for where their round struck
    this.nextFire = 0;             // index into rec.fires not yet drawn
    this.nextImpact = 0;           // index into rec.impacts not yet drawn
    this.lastT = null;
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(CAPACITY * 6);
    this.colors = new Float32Array(CAPACITY * 6);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.name = 'replay shot lines';
    player.ctx.scene?.add(this.mesh);
  }

  /** Whether the server's own collisions are in the file to draw. */
  get recorded() {
    return (this.player.rec.impacts?.length ?? 0) > 0;
  }

  setOn(on) {
    this.on = on;
    this.mesh.visible = on;
    this.clear();
  }

  /** Forget every line: a seek, or the switch going off. */
  clear() {
    this.lines.length = 0;
    this.lastT = null;
    this.nextImpact = 0;
    this.pending.length = 0;
    // What the page fired before now is not this stretch's.
    for (const record of this.player.ctx.guns?.hits ?? []) this.seen.add(record);
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(t) {
    if (!this.on) return;
    const impacts = this.player.rec.impacts ?? [];
    if (impacts.length) {
      // The server's collisions between the last frame and this one. After a
      // seek, those in the last line life, so a paused jump shows its fight.
      const from = this.lastT ?? t - SHOT_LINE_LIFE;
      if (this.lastT === null || t < this.lastT) this.nextImpact = firstAfter(impacts, from);
      while (this.nextImpact < impacts.length && impacts[this.nextImpact].t <= t) {
        const i = impacts[this.nextImpact++];
        if (i.t <= from || !i.origin || !i.point) continue;
        // BF1942's +Z is the page's -Z (replay-actors.js `toViewPosition`).
        this.add(i.t, [i.origin[0], i.origin[1], -i.origin[2]], [i.point[0], i.point[1], -i.point[2]], i.dmg);
      }
    } else {
      this.fromFires(t);
    }
    this.lastT = t;
    this.draw(t);
  }

  /** A client recording: each round, its verdict, and where a miss struck. */
  fromFires(t) {
    const fires = this.player.rec.fires ?? [];
    const verdicts = this.player.shotVerdicts?.() ?? null;
    if (this.lastT === null || t < this.lastT) this.nextFire = firstAfter(fires, t - 0.02);
    const conv = v => [v[0], v[1], -v[2]];
    while (this.nextFire < fires.length && fires[this.nextFire].t <= t) {
      const f = fires[this.nextFire++];
      if (f.press || !(f.pid >= 0) || !Array.isArray(f.pos) || !Array.isArray(f.dir)) continue;
      const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
      if (!(n > 0.1)) continue;
      const v = verdicts?.get(f);
      if (v?.hit && v.point) {
        this.add(f.t, conv(f.pos), conv(v.point), true, f);
        continue;
      }
      this.pending.push({ t: f.t, a: conv(f.pos), d: conv(f.dir.map(x => x / n)), f });
    }
    // Where the page's rounds struck, newest first until one already taken:
    // each goes to the waiting miss it left from (its launch point within a
    // few metres, its line within a few degrees).
    for (const record of this.player.ctx.guns?.hits ?? []) {
      if (this.seen.has(record)) break;
      this.seen.add(record);
      if (!record.firerGroup?.replay || !record.point) continue;
      const from = record.origin ?? null;
      let best = -1;
      let bestCos = MATCH_COS;
      for (let i = 0; i < this.pending.length; i++) {
        const m = this.pending[i];
        if (from && Math.hypot(from[0] - m.a[0], from[1] - m.a[1], from[2] - m.a[2]) > MATCH_REACH) continue;
        const dx = record.point[0] - m.a[0];
        const dy = record.point[1] - m.a[1];
        const dz = record.point[2] - m.a[2];
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 0.5)) continue;
        const cos = (dx * m.d[0] + dy * m.d[1] + dz * m.d[2]) / len;
        if (cos > bestCos) { bestCos = cos; best = i; }
      }
      if (best < 0) continue;
      const m = this.pending.splice(best, 1)[0];
      this.add(m.t, m.a, record.point, false, m.f);
    }
    this.pending = this.pending.filter(m => t - m.t < PENDING_LIFE && m.t <= t + 0.05);
  }

  /** A line from `a` to `b`. `f`, the recorded round, moves its start to
   *  the drawn gun's muzzle as it fired once the replay has fired it
   *  (`shotMuzzles`, replay-bodies.js / replay-hulls.js); until then, and for
   *  a gun not drawn, it starts at the recorded launch point (the eye). */
  add(t, a, b, hit, f = null) {
    this.lines.push({ t, a, b, hit: Boolean(hit), f, muzzle: false });
    if (this.lines.length > CAPACITY) this.lines.splice(0, this.lines.length - CAPACITY);
  }

  draw(t) {
    // Lines of the future (a seek back) or past their life go.
    this.lines = this.lines.filter(l => l.t <= t + 0.05 && t - l.t < SHOT_LINE_LIFE);
    const p = this.positions;
    const c = this.colors;
    let n = 0;
    const muzzles = this.player.shotMuzzles;
    for (const l of this.lines) {
      if (l.f && !l.muzzle) {
        const m = muzzles?.get(l.f);
        if (m) { l.a = m; l.muzzle = true; }
      }
      const age = Math.max(0, t - l.t);
      // Full for the first half of its life, then down to nothing; additive,
      // so a darker colour is a fainter line.
      const k = Math.min(1, 2 * (1 - age / SHOT_LINE_LIFE));
      const col = l.hit ? HIT : MISS;
      const o = n * 6;
      p[o] = l.a[0]; p[o + 1] = l.a[1]; p[o + 2] = l.a[2];
      p[o + 3] = l.b[0]; p[o + 4] = l.b[1]; p[o + 5] = l.b[2];
      for (let v = 0; v < 2; v++) {
        c[o + v * 3] = col.r * k;
        c[o + v * 3 + 1] = col.g * k;
        c[o + v * 3 + 2] = col.b * k;
      }
      n++;
    }
    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.setDrawRange(0, n * 2);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** The first of `list` (in time order) after `t`. */
function firstAfter(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
