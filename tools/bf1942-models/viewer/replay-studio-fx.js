// The creator studio's edits (features/replay-creator-view, "The studio"):
// the look, the text over the footage, and the effects on the kill, as one
// record kept with the clip (`edits`), and what each of them does at a
// moment of the clip. Pure, and drawn the same way twice: over the view
// while the clip is edited (replay-studio.js, the overlay canvas) and into
// every frame of a recording (replay-creator.js `afterRender`), so what is
// seen is what is exported.
//
// Times are the round's. A clip's own text is placed from the clip's start
// (`title.t`, `lower.t`), so sliding the clip takes it along; the effects on
// the kill (flash, zoom punch, shake, freeze) are placed by the kill.

/** Colour grades: `[id, label, CSS filter, tint]`. The filter is the same
 *  string for the view's canvas (CSS) and the recording's (`ctx.filter`); a
 *  tint is laid over in `soft-light`. */
export const GRADES = Object.freeze([
  ['none', 'Natural', '', null],
  ['cinematic', 'Cinematic', 'contrast(1.16) saturate(0.82) brightness(0.97)', 'rgba(255, 170, 90, 0.16)'],
  ['warm', 'Golden hour', 'saturate(1.12) contrast(1.05) sepia(0.22)', 'rgba(255, 150, 40, 0.22)'],
  ['cold', 'Cold steel', 'saturate(0.78) contrast(1.12) brightness(1.02)', 'rgba(70, 130, 220, 0.28)'],
  ['bleach', 'Bleach bypass', 'saturate(0.42) contrast(1.32) brightness(1.04)', null],
  ['vivid', 'Vivid', 'saturate(1.45) contrast(1.1)', null],
  ['bw', 'Black and white', 'grayscale(1) contrast(1.22) brightness(1.02)', null],
  ['night', 'Night vision', 'grayscale(1) contrast(1.35) brightness(1.18)', 'rgba(60, 255, 110, 0.42)'],
]);

export const gradeOf = id => GRADES.find(([g]) => g === id) ?? GRADES[0];

/** The frames a clip is made in: `[id, label]`, the crop the recording takes
 *  (replay-creator.js `cropOf`). */
export const FRAMES = Object.freeze([
  ['169', '16:9 · YouTube'],
  ['916', '9:16 · Shorts'],
  ['11', '1:1 · square'],
  ['239', '2.39:1 · cinema'],
  ['none', 'The whole view'],
]);

export const FADES = Object.freeze([0, 0.5, 1, 2]);
export const FREEZES = Object.freeze([0, 0.5, 1, 1.5]);

/** A clip's edits with nothing on. */
export function defaultEdits() {
  return {
    grade: 'none',
    vignette: 0,
    title: { on: false, text: '', t: 0.2, dur: 2.4 },
    lower: { on: false, text: '', t: null, dur: 3.5 },
    tag: { on: false, text: '' },
    feed: false,
    safe: false,
    fadeIn: 0,
    fadeOut: 0,
    flash: false,
    punch: false,
    shake: false,
    freeze: 0,
  };
}

const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');

/** Edits read back from storage: every field checked, unknown ones dropped. */
export function editsOf(raw) {
  const d = defaultEdits();
  if (!raw || typeof raw !== 'object') return d;
  const text = (r, def) => ({
    on: Boolean(r?.on), text: str(r?.text),
    t: r?.t === null && def.t === null ? null : num(r?.t, 0, 600, def.t), dur: num(r?.dur, 0.3, 30, def.dur),
  });
  return {
    grade: gradeOf(raw.grade)[0],
    vignette: num(raw.vignette, 0, 1, 0),
    title: text(raw.title, d.title),
    lower: text(raw.lower, d.lower),
    tag: { on: Boolean(raw.tag?.on), text: str(raw.tag?.text, 40) },
    feed: Boolean(raw.feed),
    safe: Boolean(raw.safe),
    fadeIn: FADES.includes(raw.fadeIn) ? raw.fadeIn : 0,
    fadeOut: FADES.includes(raw.fadeOut) ? raw.fadeOut : 0,
    flash: Boolean(raw.flash),
    punch: Boolean(raw.punch),
    shake: Boolean(raw.shake),
    freeze: FREEZES.includes(raw.freeze) ? raw.freeze : 0,
  };
}

/** Whether the edits draw anything over the footage or change its colour. */
export function editsShow(e) {
  return Boolean(e && (e.grade !== 'none' || e.vignette > 0 || e.title.on || e.lower.on || (e.tag.on && e.tag.text)
    || e.feed || e.fadeIn > 0 || e.fadeOut > 0 || e.flash));
}

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** How long a piece of text takes to come in and to go, seconds of the round. */
export const TEXT_EASE = 0.3;

/** Where the lower third sits in the clip when it was not placed by hand:
 *  just before the shot, else the clip's start. */
export function lowerStart(edits, span, shotT = null) {
  if (Number.isFinite(edits.lower.t)) return edits.lower.t;
  return Number.isFinite(shotT) ? Math.max(0, shotT - span.t0 - 0.6) : 0;
}

/**
 * What is over the footage at round time `t` of the clip `span`: `{ black,
 * white, title: { text, a } | null, lower: { lines, a } | null, tag }`.
 * `kill` is the take's kill time (the flash), `shotT` its shot's (where the
 * lower third goes by default), `lowerLines` the lower third's words when no
 * text of its own is set.
 */
/** How long a kill stays in the kill feed, seconds of the round. */
export const FEED_HOLD = 4;

export function overlayAt(edits, span, t, { kill = null, shotT = null, lowerLines = null, kills = null } = {}) {
  const out = { black: 0, white: 0, title: null, lower: null, tag: null, feed: null };
  if (!edits || !span) return out;
  if (edits.fadeIn > 0) out.black = Math.max(out.black, 1 - smooth(span.t0, span.t0 + edits.fadeIn, t));
  if (edits.fadeOut > 0) out.black = Math.max(out.black, smooth(span.t1 - edits.fadeOut, span.t1, t));
  if (edits.flash && Number.isFinite(kill) && t >= kill) {
    const dt = t - kill;
    if (dt < 0.4) out.white = 0.85 * Math.exp(-dt / 0.09);
  }
  const textAt = (t0, dur) => {
    const a = Math.min(smooth(t0, t0 + TEXT_EASE, t), 1 - smooth(t0 + dur - TEXT_EASE, t0 + dur, t));
    return a > 0.002 ? a : 0;
  };
  if (edits.title.on && edits.title.text.trim()) {
    const a = textAt(span.t0 + edits.title.t, edits.title.dur);
    if (a) out.title = { text: edits.title.text.trim(), a };
  }
  if (edits.lower.on) {
    const lines = edits.lower.text.trim() ? [edits.lower.text.trim()] : (lowerLines ?? []).filter(Boolean);
    const a = lines.length ? textAt(span.t0 + lowerStart(edits, span, shotT), edits.lower.dur) : 0;
    if (a) out.lower = { lines, a };
  }
  if (edits.tag.on && edits.tag.text.trim()) out.tag = edits.tag.text.trim();
  // The kill feed, the game's way: the newest on top, each a few seconds.
  if (edits.feed && kills?.length) {
    const lines = kills.filter(k => k.t <= t + 1e-6 && t - k.t < FEED_HOLD).sort((a, b) => b.t - a.t).slice(0, 5)
      .map(k => ({ ...k, a: Math.min(smooth(k.t, k.t + 0.15, t), 1 - smooth(k.t + FEED_HOLD - 0.4, k.t + FEED_HOLD, t)) }));
    if (lines.length) out.feed = lines;
  }
  return out;
}

/** The colour a side's names are drawn in, as the replay draws them. */
const TEAM_INK = { 1: '#ff5959', 2: '#6699ff' };

/** The zoom punch on the kill: the field of view's factor at round time `t`
 *  (1 none): in by a quarter over 0.08 s, out again over half a second. */
export function punchAt(edits, kill, t) {
  if (!edits?.punch || !Number.isFinite(kill) || t < kill) return 1;
  const dt = t - kill;
  if (dt < 0.08) return 1 - 0.26 * (dt / 0.08);
  const f = 1 - 0.26 * Math.exp(-(dt - 0.08) / 0.22);
  return f > 0.999 ? 1 : f;
}

/** The shake on the kill: `{ yaw, pitch }` radians at round time `t`,
 *  dying away over about a second; the same every time round. */
export function shakeAt(edits, kill, t) {
  if (!edits?.shake || !Number.isFinite(kill) || t < kill) return null;
  const dt = t - kill;
  if (dt > 1.4) return null;
  const amp = 0.022 * Math.exp(-dt / 0.3);
  return {
    yaw: amp * (Math.sin(dt * 53 + 1.3) * 0.7 + Math.sin(dt * 31 + 0.2) * 0.3),
    pitch: amp * 0.8 * (Math.sin(dt * 67 + 0.4) * 0.6 + Math.sin(dt * 23 + 2.1) * 0.4),
  };
}

/** The display font the text is set in, with what stands in for it. */
export const TEXT_FONT = "'Geist Variable', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

/**
 * Draw what is over the footage (`overlayAt`'s `state`) into a 2D context,
 * inside the frame `box` ({ x, y, w, h } in the context's pixels): the tint
 * and vignette of the look, the text, the flash and the fade. `grade` is the
 * GRADES row whose tint is laid; `vignette` 0 to 1.
 */
export function drawOverlay(ctx, box, state, { grade = null, vignette = 0 } = {}) {
  const { x, y, w, h } = box;
  const u = Math.min(w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const tint = grade?.[3];
  if (tint) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (vignette > 0) {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.32, x + w / 2, y + h / 2, Math.hypot(w, h) * 0.56);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, `rgba(0, 0, 0, ${0.85 * vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.textBaseline = 'middle';
  if (state.title) {
    const a = state.title.a;
    const size = Math.round(u * 0.085);
    ctx.font = `800 ${size}px ${TEXT_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.06)}px`;
    const text = state.title.text.toUpperCase();
    const tw = Math.min(w * 0.9, ctx.measureText(text).width);
    const cy = y + h * 0.42 - (1 - a) * size * 0.25;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + (w - tw) / 2 - size * 0.6, cy - size * 0.9, tw + size * 1.2, size * 1.8);
    ctx.fillStyle = '#e8c35a';
    const rule = Math.max(2, Math.round(size * 0.06));
    ctx.fillRect(x + (w - tw) / 2, cy - size * 0.78, tw * a, rule);
    ctx.fillRect(x + (w + tw) / 2 - tw * a, cy + size * 0.78 - rule, tw * a, rule);
    ctx.fillStyle = '#f6f2e2';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, cy, w * 0.9);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  if (state.lower) {
    const a = state.lower.a;
    const [first, ...rest] = state.lower.lines;
    const big = Math.round(u * 0.05);
    const small = Math.round(u * 0.032);
    ctx.font = `800 ${big}px ${TEXT_FONT}`;
    const w1 = ctx.measureText(first).width;
    ctx.font = `600 ${small}px ${TEXT_FONT}`;
    const w2 = rest.length ? Math.max(...rest.map(l => ctx.measureText(l).width)) : 0;
    const pad = big * 0.45;
    const bw = Math.min(w * 0.86, Math.max(w1, w2) + pad * 2);
    const bh = big * 1.35 + (rest.length ? small * 1.5 * rest.length : 0);
    const left = x + w * 0.05 - (1 - a) * w * 0.04;
    // In a vertical frame the bottom fifth is the player's own buttons
    // (Shorts, Reels, TikTok): the lower third sits above them.
    const top = y + h * (h > w ? 0.74 : 0.9) - bh;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#e8c35a';
    ctx.fillRect(left, top, bw, big * 1.35);
    if (rest.length) {
      ctx.fillStyle = 'rgba(14, 14, 11, 0.86)';
      ctx.fillRect(left, top + big * 1.35, bw, bh - big * 1.35);
    }
    ctx.textAlign = 'left';
    ctx.font = `800 ${big}px ${TEXT_FONT}`;
    ctx.fillStyle = '#17150f';
    ctx.fillText(first, left + pad, top + big * 0.7, bw - pad * 2);
    ctx.font = `600 ${small}px ${TEXT_FONT}`;
    ctx.fillStyle = '#eeecd9';
    rest.forEach((line, i) => ctx.fillText(line, left + pad, top + big * 1.35 + small * 0.78 + i * small * 1.5, bw - pad * 2));
  }
  if (state.tag) {
    const size = Math.round(u * 0.03);
    ctx.globalAlpha = 0.72;
    ctx.font = `800 ${size}px ${TEXT_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.12)}px`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = size * 0.4;
    // Vertical: top right, clear of the player's buttons down the side.
    ctx.fillText(state.tag.toUpperCase(), x + w - size * 1.1, h > w ? y + size * 2.2 : y + h - size * 1.2);
    ctx.shadowBlur = 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  if (state.feed) {
    const size = Math.max(10, Math.round(u * 0.026));
    const lineH = size * 1.7;
    const pad = size * 0.55;
    let cy = y + (h > w ? h * 0.16 : size * 1.4);
    ctx.textAlign = 'left';
    for (const k of state.feed) {
      ctx.font = `700 ${size}px ${TEXT_FONT}`;
      const killer = k.killer ?? '';
      const victim = k.victim ?? '';
      ctx.font = `700 ${size}px ${TEXT_FONT}`;
      const wk = ctx.measureText(killer).width;
      const wv = ctx.measureText(victim).width;
      ctx.font = `600 ${Math.round(size * 0.86)}px ${TEXT_FONT}`;
      const weapon = k.weapon ? `[${k.weapon}]` : '';
      const ww = weapon ? ctx.measureText(weapon).width : 0;
      const gap = size * 0.5;
      const total = wk + wv + ww + gap * (weapon ? 2 : 1) + pad * 2;
      // Vertical: from the left, clear of the player's buttons down the right.
      const left = h > w ? x + size * 0.9 : x + w - total - size * 0.9;
      ctx.globalAlpha = k.a;
      ctx.fillStyle = 'rgba(10, 10, 8, 0.62)';
      ctx.fillRect(left, cy - lineH / 2, total, lineH);
      let cx = left + pad;
      ctx.font = `700 ${size}px ${TEXT_FONT}`;
      ctx.fillStyle = TEAM_INK[k.kteam] ?? '#eeecd9';
      ctx.fillText(killer, cx, cy);
      cx += wk + gap;
      if (weapon) {
        ctx.font = `600 ${Math.round(size * 0.86)}px ${TEXT_FONT}`;
        ctx.fillStyle = '#d8d3b8';
        ctx.fillText(weapon, cx, cy);
        cx += ww + gap;
      }
      ctx.font = `700 ${size}px ${TEXT_FONT}`;
      ctx.fillStyle = TEAM_INK[k.vteam] ?? '#eeecd9';
      ctx.fillText(victim, cx, cy);
      cy += lineH + size * 0.3;
    }
  }
  ctx.globalAlpha = 1;
  if (state.white > 0.002) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.white})`;
    ctx.fillRect(x, y, w, h);
  }
  if (state.black > 0.002) {
    ctx.fillStyle = `rgba(0, 0, 0, ${state.black})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/**
 * The safe area over the monitor (never recorded): for a vertical frame the
 * strips Shorts and the like cover with their own captions and buttons (the
 * bottom fifth, the right eighth, the top tenth); for any other, the title
 * safe 90% box.
 */
export function drawSafeArea(ctx, box) {
  const { x, y, w, h } = box;
  ctx.save();
  ctx.strokeStyle = 'rgba(110, 231, 255, 0.85)';
  ctx.fillStyle = 'rgba(110, 231, 255, 0.10)';
  ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) / 400));
  ctx.setLineDash([8, 6]);
  if (h > w) {
    ctx.fillRect(x, y + h * 0.8, w, h * 0.2);
    ctx.fillRect(x + w * 0.875, y + h * 0.1, w * 0.125, h * 0.7);
    ctx.fillRect(x, y, w, h * 0.1);
    ctx.strokeRect(x + w * 0.04, y + h * 0.1, w * 0.835, h * 0.7);
  } else {
    ctx.strokeRect(x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.9);
  }
  ctx.restore();
}
