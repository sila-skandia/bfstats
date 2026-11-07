// The dogfight school's guide (features/dogfight-school): what to do with
// the stick right now, drawn. A stick gate where up is the nose going up,
// the stick where it should be (the filled dot) and where yours is (the
// ring), the arrows round it lit the way to move it, and a row per control
// with its default keys (`controls-defaults.js`, the Air map). A row turns
// green while you are doing it. The live fight and the ring courses share it.

import { clamp } from './dogfight-flight.js';

/** The deflection below which a channel says nothing. */
const DEAD = 0.2;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A design token's value, or `fallback` off the page. */
export function token(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

/** The guide, appended to `parent`. `draw(stick, yours, head)` takes
 *  `{ pitch, roll, rudder, throttle, fire }` in the engine's signs. */
export function createGuide(parent) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="dfl-guide" hidden>
      <span class="dfl-guide-head">DO THIS</span>
      <div class="dfl-guide-body">
        <div class="dfl-gate-box"><svg class="dfl-gate" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="dfl-gate-ring" r="36"></circle>
          <line class="dfl-gate-axis" x1="-36" y1="0" x2="36" y2="0"></line>
          <line class="dfl-gate-axis" x1="0" y1="-36" x2="0" y2="36"></line>
          <path class="dfl-arrow" data-dir="up" d="M0,-49 L-7,-40 L7,-40 Z"></path>
          <path class="dfl-arrow" data-dir="down" d="M0,49 L-7,40 L7,40 Z"></path>
          <path class="dfl-arrow" data-dir="left" d="M-49,0 L-40,-7 L-40,7 Z"></path>
          <path class="dfl-arrow" data-dir="right" d="M49,0 L40,-7 L40,7 Z"></path>
          <line class="dfl-want-line" x1="0" y1="0" x2="0" y2="0"></line>
          <circle class="dfl-want" r="6"></circle>
          <circle class="dfl-have" r="8"></circle>
        </svg><small>up is nose up</small></div>
        <ul class="dfl-guide-rows"></ul>
      </div>
    </div>`;
  const el = wrap.firstElementChild;
  parent.appendChild(el);
  const q = s => el.querySelector(s);
  const ui = {
    head: q('.dfl-guide-head'), rows: q('.dfl-guide-rows'),
    want: q('.dfl-want'), wantLine: q('.dfl-want-line'), have: q('.dfl-have'), arrows: [...el.querySelectorAll('.dfl-arrow')],
  };

  function draw(k, mine, head) {
    ui.head.textContent = head;
    const up = -clamp(k.pitch ?? 0), right = clamp(k.roll ?? 0);
    ui.want.setAttribute('cx', (right * 34).toFixed(1));
    ui.want.setAttribute('cy', (-up * 34).toFixed(1));
    ui.wantLine.setAttribute('x2', (right * 34).toFixed(1));
    ui.wantLine.setAttribute('y2', (-up * 34).toFixed(1));
    const myUp = -clamp(mine?.pitch ?? 0), myRight = clamp(mine?.roll ?? 0);
    ui.have.setAttribute('cx', (myRight * 34).toFixed(1));
    ui.have.setAttribute('cy', (-myUp * 34).toFixed(1));
    const lit = { up: Math.max(0, up), down: Math.max(0, -up), right: Math.max(0, right), left: Math.max(0, -right) };
    for (const el of ui.arrows) {
      const v = lit[el.dataset.dir];
      el.style.opacity = String(v > DEAD ? 0.45 + 0.55 * Math.min(1, v) : 0.12);
    }
    const near = (a, b) => Math.abs(a - b) < 0.35 || (Math.sign(a) === Math.sign(b) && Math.abs(b) > Math.abs(a) * 0.6);
    ui.have.classList.toggle('is-match', !!mine && Math.hypot(myUp - up, myRight - right) < 0.35);
    const rows = [];
    const hard = v => (Math.abs(v) > 0.7 ? 'hard ' : '');
    if (up > DEAD) rows.push(['pitch', `Pull ${hard(up)}· nose up`, 'down', ['\u2193', 'mouse back'], near(up, myUp)]);
    else if (up < -DEAD) rows.push(['pitch', `Push ${hard(up)}· nose down`, 'up', ['\u2191', 'mouse forward'], near(up, myUp)]);
    if (right > DEAD) rows.push(['roll', `Roll ${hard(right)}right`, 'roll-right', ['\u2192', 'mouse right'], near(right, myRight)]);
    else if (right < -DEAD) rows.push(['roll', `Roll ${hard(right)}left`, 'roll-left', ['\u2190', 'mouse left'], near(right, myRight)]);
    const rud = clamp(k.rudder ?? 0), myRud = clamp(mine?.rudder ?? 0);
    if (rud > 0.3) rows.push(['rudder', 'Rudder right', 'right', ['D'], myRud > 0.3]);
    else if (rud < -0.3) rows.push(['rudder', 'Rudder left', 'left', ['A'], myRud < -0.3]);
    const thr = k.throttle ?? 1;
    if (thr < 0.4) rows.push(['throttle', 'Throttle back', 'down', ['S'], (mine?.throttle ?? 0) < -0.3]);
    else rows.push(['throttle', 'Full throttle', 'up', ['W'], (mine?.throttle ?? 0) > 0.3 || thr >= 0.4]);
    if ((k.fire ?? 0) > 0.5) rows.push(['fire', 'Fire', 'fire', ['Space', 'click'], !!mine?.fire]);
    if (!rows.some(r => r[0] === 'pitch' || r[0] === 'roll')) rows.unshift(['pitch', 'Hold the stick steady', 'steady', [], Math.hypot(myUp, myRight) < 0.3]);
    const html = rows.map(([ch, words, icon, keys, ok]) =>
      `<li data-ch="${ch}" class="${ok ? 'is-match' : ''}">${ICONS[icon] ?? ''}<b>${esc(words)}</b>${keys.length ? `<kbd>${keys.map(esc).join(' or ')}</kbd>` : ''}</li>`).join('');
    if (ui.rows.innerHTML !== html) ui.rows.innerHTML = html;
  }

  return {
    el, draw,
    get state() { return el.hidden ? null : { head: ui.head.textContent, rows: [...ui.rows.children].map(li => li.textContent) }; },
  };
}

/** The guide's row icons: plain strokes, coloured by the row. */
const ICONS = {
  up: '<svg viewBox="0 0 16 16"><path d="M8 2 L13 8 H10 V14 H6 V8 H3 Z"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 14 L13 8 H10 V2 H6 V8 H3 Z"/></svg>',
  left: '<svg viewBox="0 0 16 16"><path d="M2 8 L8 3 V6 H14 V10 H8 V13 Z"/></svg>',
  right: '<svg viewBox="0 0 16 16"><path d="M14 8 L8 3 V6 H2 V10 H8 V13 Z"/></svg>',
  'roll-right': '<svg viewBox="0 0 16 16"><path class="is-stroke" d="M3 11 A6 6 0 0 1 13 6"/><path d="M14.5 2.5 L14 8.5 L9 6 Z"/></svg>',
  'roll-left': '<svg viewBox="0 0 16 16"><path class="is-stroke" d="M13 11 A6 6 0 0 0 3 6"/><path d="M1.5 2.5 L2 8.5 L7 6 Z"/></svg>',
  fire: '<svg viewBox="0 0 16 16"><circle class="is-stroke" cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.6"/></svg>',
  steady: '<svg viewBox="0 0 16 16"><circle class="is-stroke" cx="8" cy="8" r="5"/></svg>',
};

