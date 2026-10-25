'use strict';
// Where the popup panel goes. Pure: Electron's tray bounds, the display's
// work area and the panel's size in, a top-left point out.
//
// Windows and KDE report where the tray icon is (tray.getBounds()); the panel
// opens against it, on the side of the work area the taskbar is on. Linux
// trays over StatusNotifierItem (GNOME's AppIndicator) report nothing, so the
// panel opens in a corner of the primary display's work area instead.

const GAP = 8;

const validRect = (r) => !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

/** Keep a `size` box at `x, y` inside `area` (its top-left wins when it does not fit). */
function clampToArea({ x, y }, size, area) {
  const maxX = area.x + area.width - size.width;
  const maxY = area.y + area.height - size.height;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(y, maxY))),
  };
}

/**
 * Which side of the work area the tray sits on: 'bottom', 'top', 'left' or
 * 'right'. A tray outside the work area is on the taskbar's side; one inside
 * it (an auto-hiding panel) takes the nearest edge.
 */
function trayEdge(tray, area) {
  const cx = tray.x + tray.width / 2;
  const cy = tray.y + tray.height / 2;
  if (cy >= area.y + area.height) return 'bottom';
  if (cy <= area.y) return 'top';
  if (cx <= area.x) return 'left';
  if (cx >= area.x + area.width) return 'right';
  const d = {
    bottom: area.y + area.height - cy, top: cy - area.y,
    left: cx - area.x, right: area.x + area.width - cx,
  };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}

/** The panel against the tray icon, or null when the tray reports no bounds. */
function trayAnchoredPosition({ trayBounds, size, workArea, gap = GAP }) {
  if (!validRect(trayBounds) || !validRect(workArea)) return null;
  const cx = trayBounds.x + trayBounds.width / 2;
  const cy = trayBounds.y + trayBounds.height / 2;
  let p;
  switch (trayEdge(trayBounds, workArea)) {
    case 'bottom': p = { x: cx - size.width / 2, y: trayBounds.y - size.height - gap }; break;
    case 'top': p = { x: cx - size.width / 2, y: trayBounds.y + trayBounds.height + gap }; break;
    case 'left': p = { x: trayBounds.x + trayBounds.width + gap, y: cy - size.height / 2 }; break;
    default: p = { x: trayBounds.x - size.width - gap, y: cy - size.height / 2 }; break;
  }
  return clampToArea(p, size, workArea);
}

/** The panel in a corner of a work area (GNOME's tray sits top right). */
function cornerPosition({ workArea, size, corner = 'top-right', margin = GAP }) {
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  const p = {
    x: right ? workArea.x + workArea.width - size.width - margin : workArea.x + margin,
    y: bottom ? workArea.y + workArea.height - size.height - margin : workArea.y + margin,
  };
  return clampToArea(p, size, workArea);
}

/** A panel taller than the work area shrinks to it (a small laptop screen). */
function fitSize(size, workArea, margin = GAP) {
  return {
    width: Math.min(size.width, workArea.width - 2 * margin),
    height: Math.min(size.height, workArea.height - 2 * margin),
  };
}

module.exports = { trayAnchoredPosition, cornerPosition, clampToArea, trayEdge, fitSize, validRect };
