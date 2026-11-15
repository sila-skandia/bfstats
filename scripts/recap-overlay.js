// What a match recap draws over the replay (features/match-recap): the title
// at its start, each moment's caption, the names over a split screen, the
// salt at the end and the closing card. Evaluated in the play page by
// scripts/action-roll.mjs --recap, as window.__recapDraw; drawn on a 2D canvas
// laid out for 1080 lines and scaled (`u`).
window.__recapDraw = (() => {
  const FONT = 'system-ui, "Segoe UI", sans-serif';
  const CREAM = 'rgba(246,241,226,0.96)';
  const MUTED = 'rgba(246,241,226,0.62)';
  const AMBER = 'rgba(232,196,120,0.98)';
  const SALT = '#ff6a3d';
  const TEAM = { 1: '#e3866b', 2: '#86b6ec', 0: 'rgba(246,241,226,0.9)' };
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const RED = '#ff3b30';
  // The site's mark (viewer/bfstats-logo.webp), for the warning before the
  // salt; `ready` resolves once it can be drawn (or failed: the card goes
  // without it).
  const logo = new Image();
  const ready = new Promise(done => { logo.onload = done; logo.onerror = done; });
  logo.src = new URL('/bfstats-logo.webp', location.href).href;
  /** Seconds the warning stands before the first slide. */
  const WARN = 2.8;
  const ease = x => x * x * (3 - 2 * x);
  const name = n => (window.__vp?.decodePlayerName?.(n ?? '') || n || '');

  // Letter-spaced capitals: the canvas's own letterSpacing where it has it.
  const tracked = (g, text, x, y, px, spacing) => {
    if ('letterSpacing' in g) { g.letterSpacing = `${spacing}px`; g.fillText(text, x, y); g.letterSpacing = '0px'; return; }
    g.fillText(text.split('').join(String.fromCharCode(8202)), x, y);
  };
  const shadow = (g, u, blur = 12) => { g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = blur * u; };

  // The round's clock as m:ss.
  const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  /** The opening card, over the round held still and blurred: what round
   *  this is. `length` s, faded in and out. */
  function intro(g, W, H, u, sec, info, length) {
    const a = Math.min(ease(clamp01((sec - 0.2) / 0.5)), ease(clamp01((length - sec) / 0.5)));
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    shadow(g, u, 14);
    const rise = (1 - ease(clamp01((sec - 0.2) / 0.7))) * 16 * u;
    g.fillStyle = AMBER;
    g.font = `800 ${28 * u}px ${FONT}`;
    tracked(g, 'MATCH RECAP', W / 2, H / 2 - 96 * u + rise, 28 * u, 7 * u);
    g.fillRect(W / 2 - 40 * u * ease(clamp01((sec - 0.4) / 0.6)), H / 2 - 76 * u + rise, 80 * u * ease(clamp01((sec - 0.4) / 0.6)), 3 * u);
    g.fillStyle = CREAM;
    g.font = `800 ${88 * u}px ${FONT}`;
    g.fillText(info.level, W / 2, H / 2 + 14 * u + rise);
    g.fillStyle = MUTED;
    g.font = `600 ${27 * u}px ${FONT}`;
    g.fillText([info.server, info.date].filter(Boolean).join('  ·  '), W / 2, H / 2 + 68 * u + rise);
    if (info.recordedBy) g.fillText(`recorded by ${name(info.recordedBy)}`, W / 2, H / 2 + 108 * u + rise);
    g.restore();
  }

  /** A moment's caption, low left: what it is, who, and what with. */
  function caption(g, W, H, u, c, weapon) {
    if (!c || c.alpha <= 0 || !c.name) return;
    g.save();
    g.globalAlpha = c.alpha;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const x = 80 * u;
    let y = H - 92 * u;
    const grad = g.createLinearGradient(0, H - 300 * u, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = grad;
    g.fillRect(0, H - 300 * u, W * 0.6, 300 * u);
    shadow(g, u);
    const line2 = [weapon ? String(weapon).toUpperCase() : '', c.sub].filter(Boolean).join('   ');
    if (line2) {
      g.fillStyle = MUTED;
      g.font = `600 ${25 * u}px ${FONT}`;
      g.fillText(line2, x + 2 * u, y);
      y -= 44 * u;
    }
    if (!c.split) {
      g.fillStyle = CREAM;
      g.font = `800 ${46 * u}px ${FONT}`;
      g.fillText(c.name, x, y);
      y -= 56 * u;
    }
    if (c.label) {
      g.fillStyle = AMBER;
      g.font = `800 ${27 * u}px ${FONT}`;
      tracked(g, c.label.toUpperCase(), x + 2 * u, y, 27 * u, 5 * u);
    }
    g.restore();
  }

  /** A split screen's seam and each half's man, named over his half. */
  function split(g, W, H, u, sp, alpha) {
    g.save();
    g.fillStyle = 'rgba(6,6,8,0.92)';
    g.fillRect(W / 2 - 3 * u, 0, 6 * u, H);
    g.fillStyle = AMBER;
    g.fillRect(W / 2 - 1 * u, H * 0.3, 2 * u, H * 0.4);
    g.globalAlpha = alpha;
    g.textBaseline = 'alphabetic';
    shadow(g, u);
    // "1 V 1" on the seam.
    g.fillStyle = 'rgba(8,8,10,0.86)';
    const bw = 116 * u, bh = 50 * u;
    g.fillRect(W / 2 - bw / 2, 70 * u, bw, bh);
    g.fillStyle = AMBER;
    g.textAlign = 'center';
    g.font = `800 ${28 * u}px ${FONT}`;
    tracked(g, '1 V 1', W / 2, 70 * u + 35 * u, 28 * u, 4 * u);
    // Each name on a dark plate: a pane is often all sky behind it.
    g.font = `800 ${36 * u}px ${FONT}`;
    for (const [i, x] of [[0, W / 4], [1, (W * 3) / 4]]) {
      const tw = g.measureText(sp.names[i]).width;
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(8,8,10,0.72)';
      g.fillRect(x - tw / 2 - 18 * u, 144 * u, tw + 36 * u, 58 * u);
      g.fillStyle = TEAM[sp.teams[i]] ?? TEAM[0];
      g.fillRect(x - tw / 2 - 18 * u, 198 * u, tw + 36 * u, 4 * u);
      shadow(g, u, 6);
      g.fillText(sp.names[i], x, 185 * u);
    }
    g.restore();
  }

  /** The salt's timeline: header, then each slide, then nothing. */
  function saltPlan(slides) {
    const out = [];
    let at = WARN + 0.5;
    for (const s of slides) { out.push({ s, from: at, to: at + s.secs }); at += s.secs; }
    return { slides: out, length: slides.length ? at + 0.4 : 0 };
  }

  // A line broken into words, each knowing whether it is hot (a swear, an
  // accusation, an insult): painted in the salt colour.
  const words = line => {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line.text))) {
      const a = m.index, b = a + m[0].length;
      out.push({ w: m[0], hot: (line.hot ?? []).some(([x, y]) => a < y && x < b) });
    }
    return out;
  };
  const wrap = (g, ws, max) => {
    const rows = [];
    let row = [], width = 0;
    const space = g.measureText(' ').width;
    for (const w of ws) {
      const ww = g.measureText(w.w).width;
      if (row.length && width + space + ww > max) { rows.push({ row, width }); row = []; width = 0; }
      width += (row.length ? space : 0) + ww;
      row.push({ ...w, ww });
    }
    if (row.length) rows.push({ row, width });
    return rows;
  };

  /** The salt over the blurred round: "Salt of the round", then the lines. */
  function salt(g, W, H, u, sec, slides) {
    const plan = saltPlan(slides);
    g.save();
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    // The warning first (the owner, 2026-11-15: "a little bfstats site logo
    // with red Following content is NSFW"): the chat is shown as it was.
    const warn = Math.min(ease(clamp01((sec - 0.1) / 0.4)), ease(clamp01((WARN - sec) / 0.35)));
    if (warn > 0) {
      g.globalAlpha = warn;
      const size = 230 * u;
      const top = H / 2 - 250 * u;
      if (logo.naturalWidth) {
        shadow(g, u, 24);
        g.drawImage(logo, W / 2 - (size * logo.naturalWidth / logo.naturalHeight) / 2, top, size * logo.naturalWidth / logo.naturalHeight, size);
      }
      shadow(g, u, 16);
      g.fillStyle = RED;
      g.font = `900 ${54 * u}px ${FONT}`;
      tracked(g, 'FOLLOWING CONTENT IS NSFW', W / 2, top + size + 92 * u, 54 * u, 5 * u);
      g.fillStyle = RED;
      g.fillRect(W / 2 - 230 * u, top + size + 118 * u, 460 * u, 3 * u);
      g.fillStyle = MUTED;
      g.font = `600 ${26 * u}px ${FONT}`;
      g.fillText("The round's chat, uncensored", W / 2, top + size + 164 * u);
    }
    const head = ease(clamp01((sec - WARN - 0.15) / 0.5)) * ease(clamp01((plan.length - sec) / 0.4));
    g.globalAlpha = head;
    shadow(g, u, 14);
    g.fillStyle = AMBER;
    g.font = `800 ${32 * u}px ${FONT}`;
    tracked(g, 'SALT OF THE ROUND', W / 2, 150 * u, 32 * u, 8 * u);
    g.fillStyle = MUTED;
    g.font = `600 ${23 * u}px ${FONT}`;
    g.fillText('What the chat said', W / 2, 192 * u);
    // One dot a slide, the current one lit.
    const n = plan.slides.length;
    for (let i = 0; i < n; i++) {
      const p = plan.slides[i];
      const on = sec >= p.from && sec < p.to;
      g.globalAlpha = head;
      g.fillStyle = on ? AMBER : 'rgba(246,241,226,0.28)';
      g.beginPath();
      g.arc(W / 2 + (i - (n - 1) / 2) * 30 * u, H - 110 * u, (on ? 7 : 5) * u, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of plan.slides) {
      if (sec < p.from || sec >= p.to) continue;
      const k = sec - p.from;
      const a = Math.min(ease(clamp01(k / 0.35)), ease(clamp01((p.to - sec) / 0.3)));
      const rise = (1 - ease(clamp01(k / 0.45))) * 26 * u;
      g.globalAlpha = a;
      const s = p.s;
      g.font = `800 ${48 * u}px ${FONT}`;
      g.fillStyle = TEAM[s.team] ?? TEAM[0];
      const top = 360 * u + rise;
      g.fillText(name(s.name), W / 2, top);
      g.fillStyle = MUTED;
      g.font = `600 ${22 * u}px ${FONT}`;
      g.fillText(`${clock(s.t)} into the round${s.teamChat ? ', to their team' : ''}`, W / 2, top + 42 * u);
      // The lines, wrapped and centred, the hot words lit.
      g.font = `700 ${58 * u}px ${FONT}`;
      let y = top + 150 * u;
      for (const line of s.lines) {
        for (const { row, width } of wrap(g, words(line), W * 0.74)) {
          let x = W / 2 - width / 2;
          g.textAlign = 'left';
          for (const w of row) {
            if (w.hot) { g.fillStyle = SALT; g.shadowColor = 'rgba(255,90,40,0.55)'; g.shadowBlur = 18 * u; }
            else { g.fillStyle = CREAM; g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 12 * u; }
            g.fillText(w.w, x, y);
            x += w.ww + g.measureText(' ').width;
          }
          g.textAlign = 'center';
          y += 76 * u;
        }
        y += 18 * u;
      }
    }
    g.restore();
    return plan.length;
  }

  /** The closing card. */
  function end(g, W, H, u, sec, info, length) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const a = ease(clamp01((sec - 0.1) / 0.5));
    g.globalAlpha = a;
    shadow(g, u, 14);
    g.fillStyle = AMBER;
    g.font = `800 ${26 * u}px ${FONT}`;
    tracked(g, 'MATCH RECAP', W / 2, H / 2 - 92 * u, 26 * u, 6 * u);
    g.fillStyle = CREAM;
    g.font = `800 ${72 * u}px ${FONT}`;
    g.fillText(info.level, W / 2, H / 2);
    g.fillStyle = MUTED;
    g.font = `600 ${28 * u}px ${FONT}`;
    g.fillText('Watch the whole round on play.bfstats.io', W / 2, H / 2 + 62 * u);
    g.restore();
    // Out to black over the last 0.8 s.
    const out = clamp01((sec - (length - 0.8)) / 0.8);
    if (out > 0) { g.fillStyle = `rgba(0,0,0,${out})`; g.fillRect(0, 0, W, H); }
  }

  return { intro, caption, split, salt, saltPlan, end, ready };
})();
