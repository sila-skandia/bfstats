// Medal callouts over the replay (features/round-replay-highlights): the
// followed player's medals stamped at the top of the view as he earns them,
// the way a modern shooter calls out a double kill or a spree, and everyone
// else's in a ticker above the bar -- each with Follow (watch him from now)
// and Replay (watch the play again from its start). The medals are
// replay-medals.js's; this only shows them, on the recording's clock.

/** How long a callout and a ticker line stay up, recording seconds, and at
 *  least in real seconds (a fast replay would flash them past). */
const CALLOUT_T = 3.2;
const CALLOUT_REAL = 1.8;
const TICK_T = 7;
const TICK_REAL = 3;
/** Medals this close together for one man are one moment, seconds. */
const SAME_MOMENT = 0.8;
/** Ticker lines at most. */
const TICK_MAX = 4;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A medal's colour, by how rare the play is. */
export function tierColour(score) {
  return score >= 8 ? '#e8c35a' : score >= 4 ? '#d9dde2' : '#c9c29a';
}

// The medals' art, 40x40: a shield in the tier's colour with the play's
// mark inside.
const FRAME = '<path d="M20 2.5 35 8.2V19.6c0 9.3-6.5 15.4-15 18-8.5-2.6-15-8.7-15-18V8.2z" fill="rgba(12,12,10,.82)" stroke="currentColor" stroke-width="2"/>'
  + '<path d="M20 6.2 31.6 10.6v9c0 7.4-5 12.3-11.6 14.6C13.4 31.9 8.4 27 8.4 19.6v-9z" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>';
const chevrons = n => Array.from({ length: n }, (_, i) => {
  const y = 12.5 + i * 4.6 + (4 - n) * 2.3;
  return `<path d="M12.5 ${y}l7.5 4.6 7.5-4.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`;
}).join('');
const STAR = '<path d="M20 9.5l2.9 6.4 7 .7-5.2 4.7 1.5 6.9L20 24.6l-6.2 3.6 1.5-6.9-5.2-4.7 7-.7z" fill="currentColor"/>';
const GLYPH = {
  multi: m => (m.count >= 5 ? STAR : chevrons(Math.min(4, m.count))),
  streak: () => '<path d="M20 8.5c3.2 4.6 7 7.4 6.3 13.6-.5 4.8-3.3 8.4-6.3 8.4-3.4 0-6.4-2.8-6.4-7 0-3.5 2.2-5.3 3.8-7.8.6 2.8 1.6 4 3 4.5.7-3.4.2-7.5-.4-11.7z" fill="currentColor"/>',
  firstblood: () => '<path d="M20 9.5c3.6 5.6 6.8 9.3 6.8 13.4a6.8 6.8 0 0 1-13.6 0c0-4.1 3.2-7.8 6.8-13.4z" fill="#e0503c" stroke="currentColor" stroke-width="1.2"/>',
  shutdown: () => '<circle cx="20" cy="20" r="7.8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M14.6 25.4l10.8-10.8" stroke="currentColor" stroke-width="2.4"/>',
  revenge: () => '<path d="M26.6 17.2a7.4 7.4 0 1 0 .3 5.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M28.6 10.6l-.9 7.6-7.3-2.4z" fill="currentColor"/>',
  longshot: () => '<circle cx="20" cy="20" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 9v6.5M20 24.5V31M9 20h6.5M24.5 20H31" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="1.6" fill="currentColor"/>',
  knife: () => '<path d="M13.6 26.4 25.8 10.4l2 1.9-10.9 16.6z" fill="currentColor"/><path d="M12.2 25.3l3.9 3.9-1.8 1.8-3.9-3.9z" fill="currentColor"/>',
  vehicle: () => '<path d="M20 8.6l2.7 6.2 6.4-2.4-3.1 6 4.4 3.4-6.6 1.1.4 6.4-4.2-4.8-4.2 4.8.4-6.4-6.6-1.1 4.4-3.4-3.1-6 6.4 2.4z" fill="currentColor"/>',
  leader: () => '<path d="M11 26h18l1.4-11-5.6 4.4L20 11.5l-4.8 7.9-5.6-4.4z" fill="currentColor"/><path d="M11 28.2h18" stroke="currentColor" stroke-width="2"/>',
};

/** A medal's badge as SVG markup. */
export function medalSvg(m) {
  const glyph = GLYPH[m.kind]?.(m) ?? STAR;
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${FRAME}${glyph}</svg>`;
}

export class ReplayCallouts {
  constructor(highlights) {
    this.hl = highlights;
    this.ui = highlights.ui;
    this.medals = highlights.model.medals;
    this.box = el('div', 'rp-hl-callouts');
    this.ticker = el('div', 'rp-hl-ticker');
    this.ui.card.before(this.ticker);
    this.ui.notice.before(this.box);
    this.callouts = [];       // { pid, t, main, rest, el, untilT, untilReal }
    this.ticks = [];          // { pid, t, key, main, rest, el, untilT, untilReal }
    this.ticker.addEventListener('click', e => {
      const button = e.target.closest?.('button');
      const row = e.target.closest?.('.rp-hl-tick');
      if (!button || !row) return;
      e.stopPropagation();
      const tick = this.ticks.find(x => x.el === row);
      if (!tick) return;
      if (button.dataset.act === 'follow') this.hl.follow(tick.pid);
      else this.hl.replay(tick.pid, tick.main.t0);
    });
  }

  update(t, prevT) {
    const jumped = t < prevT - 0.01 || t - prevT > 1.5;
    if (jumped) {
      this.rebuild(t);
    } else if (t > prevT) {
      for (const m of this.medals) {
        if (m.t <= prevT) continue;
        if (m.t > t) break;
        this.announce(m, t);
      }
    }
    this.expire(t);
  }

  /** After a seek: the ticker as it stood then, and no callout. */
  rebuild(t) {
    for (const c of this.callouts) c.el.remove();
    this.callouts = [];
    for (const k of this.ticks) k.el.remove();
    this.ticks = [];
    const follow = this.hl.player.followPid;
    for (const m of this.medals) {
      if (m.t > t) break;
      if (t - m.t > TICK_T || m.pid === follow) continue;
      this.tick(m, t, true);
    }
  }

  announce(m, t) {
    if (m.pid === this.hl.player.followPid) this.callout(m, t);
    else this.tick(m, t, false);
  }

  /** Several medals for one man in one moment are one entry: the rarest
   *  named, the rest as chips; a multi-kill that grows replaces itself. */
  merge(list, m, byKey) {
    return list.find(x => x.pid === m.pid && ((byKey && x.key === m.key) || Math.abs(m.t - x.t) <= SAME_MOMENT)) ?? null;
  }

  place(entry, m) {
    if (!entry.main) {
      entry.main = m;
      return;
    }
    // A grown multi-kill replaces the one it grew from.
    if (m.key === entry.main.key) {
      entry.main = m;
      return;
    }
    entry.rest = entry.rest.filter(r => r.key !== m.key);
    if (m.score > entry.main.score) {
      entry.rest.push(entry.main);
      entry.main = m;
    } else {
      entry.rest.push(m);
    }
  }

  callout(m, t) {
    let c = this.merge(this.callouts, m, true);
    if (!c) {
      c = { pid: m.pid, t: m.t, key: m.key, main: null, rest: [], el: el('div', 'rp-hl-callout') };
      this.callouts.push(c);
      this.box.append(c.el);
    }
    this.place(c, m);
    c.t = m.t;
    c.untilT = t + CALLOUT_T;
    c.untilReal = performance.now() + CALLOUT_REAL * 1000;
    this.draw(c, false);
    // Only one callout at a time: an older one bows out.
    for (const other of this.callouts) if (other !== c) other.untilT = Math.min(other.untilT, t);
    // Restart the stamp.
    c.el.style.animation = 'none';
    void c.el.offsetWidth;
    c.el.style.animation = '';
  }

  tick(m, t, quiet) {
    let k = this.merge(this.ticks, m, true);
    if (!k) {
      k = { pid: m.pid, t: m.t, key: m.key, main: null, rest: [], el: el('div', 'rp-hl-tick') };
      this.ticks.push(k);
      this.ticker.append(k.el);
      if (quiet) k.el.style.animation = 'none';
    }
    this.place(k, m);
    k.t = m.t;
    k.untilT = m.t + TICK_T;
    k.untilReal = quiet ? 0 : performance.now() + TICK_REAL * 1000;
    this.draw(k, true);
    while (this.ticks.length > TICK_MAX) {
      const old = this.ticks.shift();
      old.el.remove();
    }
  }

  draw(entry, row) {
    const m = entry.main;
    const colour = tierColour(Math.max(m.score, ...entry.rest.map(r => r.score)));
    entry.el.style.setProperty('--tier', colour);
    const detail = this.hl.describe(m);
    const medal = el('div', 'rp-hl-medal');
    medal.innerHTML = medalSvg(m);
    entry.el.textContent = '';
    if (row) {
      const text = el('div', 'rp-hl-tick-text');
      text.append(el('b', '', m.label), el('span', `nm t${this.hl.team(m.pid)}`, this.hl.name(m.pid)));
      text.append(document.createTextNode([detail, ...entry.rest.map(r => r.label)].filter(Boolean).join(' · ')));
      text.title = text.textContent;
      const follow = el('button', 'rp-btn', 'Follow');
      follow.type = 'button';
      follow.dataset.act = 'follow';
      follow.title = `Follow ${this.hl.name(m.pid)} from now`;
      const replay = el('button', 'rp-btn', 'Replay');
      replay.type = 'button';
      replay.dataset.act = 'replay';
      replay.title = 'Watch the play again from its start';
      entry.el.append(medal, text, follow, replay);
    } else {
      const text = el('div');
      text.append(el('b', '', m.label));
      if (detail) text.append(el('span', '', detail));
      if (entry.rest.length) {
        const chips = el('div', 'chips');
        for (const r of entry.rest) chips.append(el('i', '', r.label));
        text.append(chips);
      }
      entry.el.append(medal, text);
    }
  }

  expire(t) {
    const now = performance.now();
    const done = x => t >= x.untilT && now >= x.untilReal;
    for (const list of [this.callouts, this.ticks]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if (!done(x)) continue;
        if (!x.leaving) {
          x.leaving = true;
          x.el.classList.add('out');
          setTimeout(() => x.el.remove(), 420);
        }
        list.splice(i, 1);
      }
    }
  }

  dispose() {
    this.box.remove();
    this.ticker.remove();
  }
}
