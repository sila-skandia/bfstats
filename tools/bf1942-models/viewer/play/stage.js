// The canvas half every front-end screen shares: fitting the canvas to its
// box at the device pixel ratio with the layout's virtual stage mapped onto
// it, and a pointer event back into virtual units. `skirmish.js`,
// `multiplay.js` and `mod-picker-screen.js` each carried these lines; the
// arithmetic itself is `menu-screen.js`'s `stageScale`/`toVirtual`.

import { stageScale, toVirtual } from './menu-screen.js';

/** Size the canvas to its box (device pixels, the ratio capped at 3), clear
 *  it black, and set the transform that draws the layout's virtual units
 *  onto it. False when the canvas has no size yet: nothing to paint. */
export function beginStage(canvas, ctx, virtual) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return false;
  const cw = Math.round(w * dpr);
  const chh = Math.round(h * dpr);
  if (canvas.width !== cw || canvas.height !== chh) {
    canvas.width = cw;
    canvas.height = chh;
  }
  const s = stageScale(w, h, virtual);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, chh);
  ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
  return true;
}

/** A pointer event's position in the layout's virtual units. */
export function pointerToVirtual(canvas, event, virtual) {
  const r = canvas.getBoundingClientRect();
  const s = stageScale(r.width, r.height, virtual);
  return toVirtual(s, event.clientX - r.left, event.clientY - r.top);
}
