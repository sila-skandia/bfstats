/* The HUD minimap's zoom and rotation, the engine's `BfMap` law.
 *
 * The minimap is one `BfMap` object (a `TransformNode` subclass, ctor
 * 0x0046e230). Two of its members drive what the player sees, and both were
 * read out of the client (BF1942.exe, sha256 60c9452d...cd3699) and confirmed
 * by a second reader (W4-F, 2026-09-21):
 *
 * ZOOM — three levels, not two.
 *   The `N` key (`c_PIZoomMap`) steps a 3-value counter, level in {0,1,2}.
 *   The HUD frame writes `BfMap+0x48 = level + 0.5`. A second member, `+0x44`,
 *   eases toward `+0x48` at rate 6 (`BfMap__animate` 0x00468fb0), and the
 *   texture crop is
 *
 *       crop = pow(2.3, (1 - z) * [+0x44])
 *
 *   where `z` is the open/close fraction (0 = the closed HUD minimap, 1 = the
 *   open spawn map; `BfMap__animate` eases it toward 0 or 1 at rate 9, ledger
 *   MMAP-1). The `2.3` is a DOUBLE constant at 0x008d62a0
 *   (2.2999999523...), not a float — read it as 8 bytes if you re-derive it.
 *
 *   So the closed minimap (z = 0) crops by pow(2.3, level + 0.5) at steady
 *   state: 1.517 / 3.488 / 8.012 across the three levels, a factor of 2.3
 *   between each. The open spawn map (z = 1) crops by 1 — the whole map —
 *   whatever the level, which is why the zoom only ever shows on the closed
 *   widget.
 *
 *   The crop is a fraction of the WHOLE map texture, so the span is absolute
 *   and engine-derived, not anchored by this viewer. `minimap_screenTransform`
 *   0x00469360 (the pointer's screen-to-texture inverse of the draw) maps an
 *   offset from the widget's centre, in the node's own units, to texture uv as
 *
 *       uv = centre + R(-[+0x64]) * offset / (nodeSize * crop)
 *       centre = (1 - z) * ([+0x5c], [+0x60]) + z * (0.5, 0.5)
 *
 *   so the widget's full width covers 1/crop of the texture whatever the
 *   widget's size: 0.659 / 0.287 / 0.125 of the map across the three levels.
 *   (+0x5c, +0x60) is the player's position normalised by the world size and
 *   +0x68 his heading, all three stored by the one setter 0x00467810, whose
 *   only caller is the HUD frame (call at 0x006ada0f: position times
 *   1.0 / worldSize, the 1.0 at 0x008c53c8; v negated; heading by `fpatan`).
 *   The centre is the player with NO clamp at the map's edge, static or not —
 *   a widget at the edge shows what lies past the texture.
 *
 *   The other two setters sit beside it: 0x00467910 stores `+0x48 = arg + 0.5`
 *   (the 0.5 at 0x008c4220), and 0x00467940 stores the static byte `+0x58` and
 *   zeroes `+0x64` in the same breath (callers 0x006d563b and 0x006d5e65, the
 *   general-options apply path). `BfMap__animate` snaps `+0x44` onto `+0x48`
 *   once they are within 0.01 (0x008c409c) rather than easing forever.
 *
 * ROTATION — follows the player unless the map is static.
 *   `BfMap+0x68` is the player's heading, written every frame. The DISPLAYED
 *   rotation `+0x64` is recomputed every frame by `BfMap__animate` (write
 *   0x004691c8) with NO easing:
 *
 *       +0x64 = (1 - z) * wrapped(+0x68)
 *
 *   taking the shorter of the two +-2*PI windings. With the static byte `+0x58`
 *   set (`game.setStaticMinimap 1` — the shipped default, every stock profile)
 *   the map stays north-up: `+0x64` only re-wraps itself and never tracks the
 *   heading. A fully open map (z = 1) is north-up either way, because
 *   (1 - z) = 0.
 *
 *   The sign here is the viewer's: the engine stores +(1-z)*heading, and the
 *   canvas transform negates it so the player's forward reads UP, the same
 *   convention the deploy transition already uses (`-(1 - z) * heading`).
 *
 * This module is deliberately free of `three` and of the DOM: it is the zoom
 * counter, the two easings and the rotation, so `tests/bfmap_harness.mjs` runs
 * the real thing under node with no WebGL.
 */

/** The engine's crop base, the double at 0x008d62a0 (2.2999999523...). 2.3
 *  to the precision that matters: the difference moves the crop by ~2e-8
 *  relative, far under a pixel at any widget size. */
export const CROP_BASE = 2.3;

/** `+0x44` eases toward `+0x48` at this rate (`BfMap__animate`). */
export const ZOOM_EASE_RATE = 6;

/** The three zoom levels; `N` wraps 0 -> 1 -> 2 -> 0. */
export const ZOOM_LEVELS = 3;

/** `BfMap__animate` stops easing `+0x44` and stores `+0x48` outright once the
 *  two are this close (the float at 0x008c409c). */
export const ZOOM_SNAP = 0.01;

/** `N` (`c_PIZoomMap`): step the 3-value counter, wrapping. */
export function stepZoomLevel(level) {
  return (level + 1) % ZOOM_LEVELS;
}

/** `BfMap+0x48`, what the HUD frame writes: `level + 0.5`. */
export function zoomTarget(level) {
  return level + 0.5;
}

/** One frame of the `+0x44` ease toward `+0x48`, the engine's pure
 *  exponential `x += (t - x)(1 - e^(-rate*dt))`. A non-positive or non-finite
 *  dt holds the value, so a paused frame cannot move it. */
export function easeZoom(current, target, dt, rate = ZOOM_EASE_RATE) {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return current + (target - current) * (1 - Math.exp(-rate * step));
}

/** The texture crop, `pow(2.3, (1 - z) * zoomEased)`. `z` is the open/close
 *  fraction (0 closed, 1 open); `zoomEased` is the eased `+0x44`. */
export function crop(z, zoomEased) {
  return Math.pow(CROP_BASE, (1 - z) * zoomEased);
}

/** The fraction of the map texture the widget's width covers: `1 / crop`
 *  (`minimap_screenTransform` 0x00469360 divides the offset by
 *  `nodeSize * crop`). 0.659 / 0.287 / 0.125 closed at the three levels, 1
 *  open. */
export function minimapSpan(zoomEased, z = 0) {
  return 1 / crop(z, zoomEased);
}

/** The texture point at the widget's centre: the player closed, the middle of
 *  the map open, `(1 - z) * player + z * 0.5` between (0x00469360). */
export function mapCentre(z, here) {
  return { u: (1 - z) * here.u + z * 0.5, v: (1 - z) * here.v + z * 0.5 };
}

/** The shorter of the two +-2*PI windings of an angle, in (-PI, PI]. */
export function wrapAngle(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** The displayed rotation `BfMap+0x64`, as a canvas angle: 0 when the map is
 *  static (the shipped default) or fully open (z = 1), else
 *  `-(1 - z) * wrapped(heading)` so the player's forward reads up. No easing —
 *  the engine recomputes it from the live heading every frame. */
export function displayRotation(z, heading, isStatic) {
  if (isStatic) return 0;
  return -(1 - z) * wrapAngle(heading);
}

/** The top-left corner of the window of art the closed widget shows, for a
 *  player at art coordinates `here` ({u, v} in 0..1) and a span: centred on
 *  the player, with no stop at the art's edge — the engine's centre is the
 *  player's own uv whatever the static byte says (0x00469360), and the turn
 *  of the rotating map is about that same point. */
export function minimapWindow(here, span) {
  const half = span / 2;
  return { u0: here.u - half, v0: here.v - half };
}

/** A point of the unrotated surface turned by the canvas angle `rot` about
 *  the surface's centre `mid` — the same mapping `ctx.rotate(rot)` applies
 *  about that centre (y down, positive clockwise), so a marker placed with
 *  this lands on the art drawn under that transform. */
export function rotateAbout(x, y, mid, rot) {
  if (!rot) return { x, y };
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - mid, dy = y - mid;
  return { x: mid + dx * c - dy * s, y: mid + dx * s + dy * c };
}

/** The source rectangle (art fractions) and destination rectangle (surface
 *  pixels, before the rotation transform) that cover a square surface of
 *  `size` pixels showing the window (`u0`, `v0`, `span`) turned by `rot`.
 *
 *  A turned square needs |cos| + |sin| times its own side of art to leave no
 *  corner bare, so the window is grown by that factor about its centre and
 *  then cut to the art (0..1). Null when nothing of the art is in reach. */
export function coverRect(u0, v0, span, size, rot) {
  const cover = Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot));
  const grow = (span * (cover - 1)) / 2;
  const su0 = Math.max(0, u0 - grow), sv0 = Math.max(0, v0 - grow);
  const su1 = Math.min(1, u0 + span + grow), sv1 = Math.min(1, v0 + span + grow);
  if (su1 <= su0 || sv1 <= sv0) return null;
  const k = size / span;   // surface pixels per unit of art
  return {
    src: { u: su0, v: sv0, w: su1 - su0, h: sv1 - sv0 },
    dst: { x: (su0 - u0) * k, y: (sv0 - v0) * k, w: (su1 - su0) * k, h: (sv1 - sv0) * k },
  };
}

/**
 * The closed widget's state: the zoom counter, its eased value, and the static
 * flag. One instance per page; `map.html` steps it on `N`, eases it each frame
 * and reads `span()` / `rotation()` for the draw.
 */
export class BfMap {
  constructor(options = {}) {
    this.zoomLevel = 0;
    // Start settled at level 0 rather than at the constructor's 0 and easing
    // up (a viewer choice): a zoom drift on every page load would read as a
    // glitch, and the game's own first frames are behind a loading screen.
    this.zoomEased = zoomTarget(0);
    // The shipped default is static (north-up): every stock profile sets
    // `game.setStaticMinimap 1`.
    this.isStatic = options.isStatic !== false;
  }

  /** `N`: step to the next level, wrapping 2 -> 0. */
  zoomIn() {
    this.zoomLevel = stepZoomLevel(this.zoomLevel);
  }

  setStatic(v) {
    this.isStatic = !!v;
  }

  /** One frame: ease `+0x44` toward `+0x48`, storing it outright once the
   *  two are within `ZOOM_SNAP`, as `BfMap__animate` does. */
  update(dt) {
    const target = zoomTarget(this.zoomLevel);
    this.zoomEased = Math.abs(this.zoomEased - target) < ZOOM_SNAP
      ? target : easeZoom(this.zoomEased, target, dt);
  }

  /** The closed widget's span this frame. */
  span() {
    return minimapSpan(this.zoomEased);
  }

  /** The displayed rotation for an open/close fraction `z` and a live
   *  `heading` (the player's, in the viewer the camera's). */
  rotation(z, heading) {
    return displayRotation(z, heading, this.isStatic);
  }
}
