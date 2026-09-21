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
 *   widget. The absolute base here is the viewer's own: the engine's crop is
 *   relative to its 175-unit quad and the level's `InGameMap` texture, and
 *   this widget is a different size, so level 0 is anchored to the span the
 *   widget already showed (`DEFAULT_SPAN`) and the levels step by the engine's
 *   2.3 ratio. That ratio is the part of the law that is engine-derived; the
 *   anchor is a viewer choice for the widget size.
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

/** The span (fraction of the combat-area art) the closed widget shows at
 *  level 0 — the value `map.html` has always used (`MINIMAP_SPAN`). The
 *  levels step down from here by the engine's 2.3 ratio. */
export const DEFAULT_SPAN = 0.25;

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

/** The closed widget's span (fraction of the art shown) at an eased zoom
 *  value, anchored so level 0 (`zoomEased` 0.5) is `baseSpan`. This is the
 *  HUD minimap only — the open spawn map draws the whole art (span 1) and
 *  never reads this. */
export function minimapSpan(zoomEased, baseSpan = DEFAULT_SPAN) {
  return baseSpan * Math.pow(CROP_BASE, 0.5 - zoomEased);
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

/**
 * The closed widget's state: the zoom counter, its eased value, and the static
 * flag. One instance per page; `map.html` steps it on `N`, eases it each frame
 * and reads `span()` / `rotation()` for the draw.
 */
export class BfMap {
  constructor(options = {}) {
    this.zoomLevel = 0;
    // Start settled at level 0 rather than at the engine's 0 and easing up:
    // the widget has always opened at its level-0 span, and a load-time zoom
    // drift would read as a regression.
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

  /** One frame: ease `+0x44` toward `+0x48`. */
  update(dt) {
    this.zoomEased = easeZoom(this.zoomEased, zoomTarget(this.zoomLevel), dt);
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
