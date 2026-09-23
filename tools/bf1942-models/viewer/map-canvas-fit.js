// The map surfaces' two canvases, sized to the boxes they are shown in without
// asking layout on the frame path. Built by `map-surfaces.js` with the two
// canvases it paints; `fitCanvas` treats the minimap's box as not square.

/** `cssWidthOf(canvas)` and `fitCanvas(canvas)` over `minimapCanvas` and
 *  `fullmapCanvas`, with the width cache and its ResizeObserver owned here. */
export function createCanvasFit(minimapCanvas, fullmapCanvas) {
  // The CSS widths of the two map canvases, kept by a ResizeObserver so no
  // frame asks layout for them: `getBoundingClientRect` after the frame's own
  // DOM writes forces a synchronous layout, 1.4-1.8% of the on-foot frame on
  // its own (features/mesh-viewer-performance, rule 3). A canvas the observer
  // has not reported yet — or reports at 0 because it is hidden — falls back
  // to one measured read, so the first frame after the map opens is right.
  const canvasCssWidth = new Map();
  const canvasObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      // A 0 here means `display: none` — the box the surface lives in is hidden —
      // and it is reported at the end of the frame that hid it. Dropping the
      // entry rather than caching the 0 is what lets the frame that UNHIDES the
      // surface measure it, in that same frame, before this observer has had a
      // chance to speak: the alternative paints one frame into the previous
      // backing size (confirmed: 283 px instead of 562). Neither painter reads a
      // width while its own box is hidden, so nothing else is asking meanwhile.
      if (width) canvasCssWidth.set(entry.target, width);
      else canvasCssWidth.delete(entry.target);
    }
  });
  canvasObserver.observe(minimapCanvas);
  canvasObserver.observe(fullmapCanvas);
  function cssWidthOf(canvas) {
    const known = canvasCssWidth.get(canvas);
    // `!== undefined`, not truthiness, and a measured 0 is cached too: a width
    // of 0 is an ANSWER, and treating it as a miss meant `getBoundingClientRect`
    // — a synchronous layout, rule 3 — ran again on every call that got one, for
    // exactly the surface this cache exists to keep off the frame path. The
    // observer above never stores a 0 (see there), so the only way to hold one is
    // to have measured it, and the observer overwrites that the moment the box
    // has a size.
    if (known !== undefined) return known;
    const measured = canvas.getBoundingClientRect().width;
    canvasCssWidth.set(canvas, measured);
    return measured;
  }

  /** Match a canvas's backing store to the box it is displayed in.
   *
   *  Returns the device ratio so markers can be sized in CSS pixels. Without
   *  this the HUD widget draws into a 376 px buffer shown at 186 px and every
   *  marker comes out half the size it was asked for. The HUD widget's box is
   *  not square (`MINIMAP_RECT` through the stage's sx and sy), so the height
   *  follows the box — not the width — and only the fullscreen map stays
   *  square. */
  function fitCanvas(canvas) {
    const css = cssWidthOf(canvas);
    if (!css) return canvas.__ratio || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = Math.round(css * dpr);
    const boxH = canvas.clientHeight || 0;
    const wantH = canvas === minimapCanvas && boxH
      ? Math.round(boxH * dpr) : want;
    if (canvas.width !== want || canvas.height !== wantH) {
      canvas.width = want;
      canvas.height = wantH;
    }
    canvas.__ratio = dpr;
    return dpr;
  }

  return { cssWidthOf, fitCanvas };
}
