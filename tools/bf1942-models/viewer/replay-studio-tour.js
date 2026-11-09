// The studio's tour (features/replay-creator-view, "The tour"): a kill of
// the round the creator has open made into a clip, a step at a time, in the
// studio itself. Each step lights the control it is about, says in a line
// what to do with it, and moves on when the studio's own state shows it
// done (the cameras changed, a part looping, slow motion of the clip's own,
// a recipe, a recording started) -- never on a button alone, so a step that
// stops matching the studio fails its test rather than a creator.
//
// The steps and what each one waits for are pure (`TOUR_STEPS`, `tourFacts`
// reads the creator into plain values, `stepState`); the harness drives them
// with made-up facts. The ring and the card are page chrome over the
// studio: nothing here is drawn by `drawOverlay`, so none of it is recorded,
// and the layer hides while a recording runs.
//
// The same steps drive the tutorial videos: `.claude/skills/
// replay-creator-studio/scripts/steps-tour.js` walks them with the mouse
// in a headless page and `make-tour-videos.sh` cuts a video of each.

/** Where a soldier is still in the frame from behind the round: not a
 *  point-blank kill the camera cannot get between, not a speck. */
const TOUR_RANGE = Object.freeze([15, 200]);

/**
 * The kill the tour makes a clip of, from the round's `moments`: the one on
 * the strip when the clip is already a kill shot (`currentT`), else the best
 * kill on foot at a range that films well, else the best kill at all. Null
 * when the round has none.
 */
export function pickTourKill(moments, currentT = null) {
  if (!moments?.length) return null;
  if (Number.isFinite(currentT)) {
    const here = moments.find(m => Math.abs(m.t - currentT) < 1e-3);
    if (here) return here;
  }
  const good = moments.filter(m => m.from !== 'vehicle' && (m.distance ?? 0) >= TOUR_RANGE[0] && (m.distance ?? 0) <= TOUR_RANGE[1]);
  const pool = good.length ? good : moments;
  return [...pool].sort((a, b) => b.score - a.score || a.t - b.t)[0];
}

const viewSig = v => (v?.pos ? v.pos.map(x => x.toFixed(2)).join(',') : null);

/** The studio as the tour's steps read it: plain values, compared between
 *  a step's start and now. */
export function tourFacts(creator, studio) {
  const take = creator.take ?? creator.takeInside?.() ?? null;
  const cams = creator.span ? creator.camList() : [];
  const e = creator.edits ?? {};
  const ramp = creator.ramp ?? {};
  return {
    open: Boolean(studio?.open),
    tab: studio?.tab ?? null,
    killT: take?.kill?.t ?? null,
    cams: cams.map(c => ({
      cam: c.cam, at: c.at ? JSON.stringify(c.at) : null, into: c.into ?? null,
      view: c.cam === 'placed' ? viewSig(c.view) : null, end: viewSig(c.end),
    })),
    placing: creator.placing ? { i: creator.placing.i, which: creator.placing.which } : null,
    part: creator.part?.label ?? null,
    slow: { own: Boolean(creator.ownSlow?.()), sig: `${ramp.in}|${ramp.out}|${ramp.speed}` },
    look: [e.grade, e.vignette, e.fadeIn, e.fadeOut, e.flash, e.punch, e.shake, e.freeze, creator.prefs?.frame].join('|'),
    lowerOn: Boolean(e.lower?.on),
    lower: (creator.lowerLines?.() ?? []).filter(Boolean).join(' · ').replace(/\s+/g, ' '),
    recording: Boolean(creator.recorder),
  };
}

const names = cams => cams.map(c => c.cam).join(',');
const handOvers = cams => cams.map(c => `${c.at}|${c.into}`).join(',');
const views = cams => cams.map(c => `${c.view}|${c.end}`).join(',');
const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const killWords = k => (k ? `${String(k.killerName).trim()} → ${String(k.victimName).trim()}${k.weapon ? ` (${k.weapon}${k.distance ? `, ${k.distance} m` : ''})` : ''}` : 'a kill');
const camWords = { placed: 'your camera', pov: 'their eyes', shoulder: 'over the shoulder', front: 'facing them', chase: 'the bullet chase',
  orbit: 'Bullet 360', side: 'side-on', incoming: 'from the victim', victim: 'circling the victim', free: 'the replay camera' };

/**
 * The tour, a step at a time. Each step: `id`; `title`; the inspector tab it
 * opens (`tab`); `words(facts, ctx)`, what to do; `target(facts)`, CSS
 * selectors for what to light, the first one on screen wins; `done(now,
 * start, ctx)`, whether the studio shows it done since the step began (none:
 * read it and go on); `skip(facts)`, a step that cannot apply.
 */
export const TOUR_STEPS = Object.freeze([
  {
    id: 'kill', title: 'Pick a kill', tab: 'kills',
    words: (f, ctx) => (f.killT !== null && ctx.kill && Math.abs(f.killT - ctx.kill.t) < 1e-3
      ? `This clip is ${killWords(ctx.kill)}. Every kill of the round is on the Kills tab, best first.`
      : `Click ${killWords(ctx.kill)} on the Kills tab. Kill shot opens it here, already filmed and looping.`),
    target: (f, ctx) => [`.st-moment[data-t="${ctx.kill?.t}"]`, '.st-moments'],
    done: (now, start, ctx) => now.killT !== null && Boolean(ctx.kill) && Math.abs(now.killT - ctx.kill.t) < 1e-3,
  },
  {
    id: 'cameras', title: 'The cameras',
    words: f => `${f.cams.length === 1 ? 'One camera films' : `${COUNT_WORDS[f.cams.length] ?? f.cams.length} cameras film`} the clip, one after another: `
      + `${f.cams.map(c => camWords[c.cam] ?? c.cam).join(', then ')}. The strip is laid out in seconds of the video, `
      + 'so the bullet time round the shot gets the room it plays in.',
    target: () => ['.rc-cb-camera'],
  },
  {
    id: 'swap', title: 'Change a camera',
    words: f => (f.cams.length > 1
      ? 'Click the second camera on the strip and pick another: From the victim films the round coming at the lens.'
      : 'Click the camera on the strip and pick another.'),
    target: f => ['.rc-cb-pop:not([hidden])', `.rc-cb-cam[data-i="${f.cams.length > 1 ? 1 : 0}"]`],
    done: (now, start) => names(now.cams) !== names(start.cams),
  },
  {
    id: 'handover', title: 'When it takes over',
    words: () => 'Drag the gold line between two cameras to change when the next one takes over. Click its glyph for a Cut, a Glide or a Whip. The part you changed loops at once.',
    target: () => ['.rc-cb-pop:not([hidden])', '.rc-cb-cut[data-i="1"]', '.rc-cb-cut'],
    done: (now, start) => handOvers(now.cams) !== handOvers(start.cams),
    skip: f => f.cams.length < 2,
  },
  {
    id: 'place', title: 'Your own camera',
    words: f => (f.placing
      ? 'Fly the view where you want it: WASD moves, drag to look, Q and E go down and up, the wheel zooms. Then press Use this view.'
      : 'A dashed icon means the camera frames itself. Click the first camera\'s icon to set it yourself.'),
    target: f => (f.placing ? ['.rc-place'] : ['.rc-cb-cam[data-i="0"] .rc-cb-camicon.start', '.rc-cb-camicon.start']),
    done: (now, start) => !now.placing && views(now.cams) !== views(start.cams) && now.cams.some(c => c.view),
  },
  {
    id: 'slow', title: 'Slow motion',
    words: () => 'Drag Slow-mo from the tray onto the Speed lane, just before the kill. Drag its ends to stretch it; right-click it for how slow.',
    target: () => ['.st-chip[data-tray="slow"]'],
    done: (now, start) => now.slow.own && now.slow.sig !== start.slow.sig,
  },
  {
    id: 'look', title: 'Pick a look', tab: 'look',
    words: () => 'One click sets the colour, the frame and the effects on the kill. Frag movie is a good start; Shorts makes it vertical.',
    target: () => ['.st-recipe[data-recipe="frag"]', '.st-recipes'],
    done: (now, start) => now.look !== start.look,
  },
  {
    id: 'text', title: 'Text', tab: 'text',
    words: f => (f.lowerOn
      ? `The lower third writes itself from the kill: ${f.lower || 'who, with what, whom, how far'}. Type in Words to change it, or drag it on the Text lane.`
      : 'Tick Lower third: it writes itself from the kill, the shooter, the weapon, the player killed and how far.'),
    target: f => (f.lowerOn ? ['.rc-cb-seg.txt.lower', '[data-tour="lower"]'] : ['[data-tour="lower"]']),
    done: now => now.lowerOn,
  },
  {
    id: 'record', title: 'Record it', tab: 'clips',
    words: () => 'Record the clip. It plays once, full size in its frame, and downloads when it ends. Esc stops it early.',
    target: () => ['[data-tour="record"]'],
    done: now => now.recording,
  },
  {
    id: 'end', title: 'That is a clip', tab: 'clips',
    words: () => 'Keep it here, open the next kill from the Kills tab, and the Montage tab plays your kept clips together and records them as one video. Help has the keys; Clear starts a clip over, Ctrl+Z takes back a step.',
    target: () => ['[data-tour="keep"]'],
  },
]);

/**
 * Where step `i` stands: `done` (shown done since it began), `ready` (done
 * when it began, or a step to read: the creator goes on), `waiting` (the
 * studio has not shown it yet). A step done since it began moves on by
 * itself; one done when it began does not, or it would flash past.
 */
export function stepState(step, now, start, ctx) {
  if (!step.done) return 'ready';
  if (step.done(start, start, ctx)) return 'ready';
  return step.done(now, start, ctx) ? 'done' : 'waiting';
}

/** The next step from `i` on that applies to `facts` (`dir` -1 for back),
 *  or -1 past either end. */
export function nextStep(i, facts, dir = 1) {
  for (let j = i + dir; j >= 0 && j < TOUR_STEPS.length; j += dir) {
    if (!TOUR_STEPS[j].skip?.(facts)) return j;
  }
  return -1;
}

const SEEN_KEY = 'bf42.replay.studioTour';
const AUTO_NEXT_MS = 1100;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === 'done'; } catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, 'done'); } catch {}
}

/** The first of `selectors` on screen, as a rect. */
function targetRect(selectors) {
  for (const sel of selectors) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const n of nodes) {
      if (n.closest('[hidden]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      return r;
    }
  }
  return null;
}

/** The tour over the open studio: the ring on a step's control, the card
 *  beside it, the facts read a few times a second. */
export class StudioTour {
  constructor(studio) {
    this.studio = studio;
    this.creator = studio.creator;
    this.i = -1;
    this.ctx = { kill: null };
    this.start0 = null;
    this.doneAt = null;
    this.frame = 0;
    this.facts = null;
    injectStyle();
    this.layer = el('div', 'stt');
    this.layer.hidden = true;
    this.ring = el('div', 'stt-ring');
    this.card = el('section', 'stt-card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.card.addEventListener('pointerdown', e => e.stopPropagation());
    this.layer.append(this.ring, this.card);
    document.body.append(this.layer);
    this.tick = () => this.update();
  }

  get running() {
    return this.i >= 0 || this.offering;
  }

  /** On the studio's first opening in this browser: the tour offered. */
  offer() {
    if (seen() || this.running) return;
    this.offering = true;
    this.fill({ offer: true });
    this.ring.hidden = true;
    this.show(true);
  }

  begin() {
    const creator = this.creator;
    this.offering = false;
    const facts = tourFacts(creator, this.studio);
    this.ctx = { kill: pickTourKill(creator.moments(), facts.killT) };
    if (!this.ctx.kill) {
      creator.ui.flash('This round has no kill the recording ties a round to: the tour needs one', 2600);
      this.end(false);
      return;
    }
    this.studio.toggleHelp(false);
    this.go(0);
    this.show(true);
  }

  go(i) {
    const step = TOUR_STEPS[i];
    if (!step) {
      this.end(true);
      return;
    }
    this.i = i;
    this.doneAt = null;
    if (step.tab && this.studio.tab !== step.tab) this.studio.setTab(step.tab);
    this.start0 = tourFacts(this.creator, this.studio);
    this.facts = this.start0;
    this.fill();
    // What the step is about scrolled into its panel, once the tab is drawn.
    requestAnimationFrame(() => {
      for (const sel of step.target(this.start0, this.ctx)) {
        const n = document.querySelector(sel);
        if (n && !n.closest('[hidden]')) {
          n.scrollIntoView?.({ block: 'nearest' });
          break;
        }
      }
    });
  }

  next() {
    const j = nextStep(this.i, this.facts ?? this.start0);
    if (j < 0) this.end(true);
    else this.go(j);
  }

  back() {
    const j = nextStep(this.i, this.facts ?? this.start0, -1);
    if (j >= 0) this.go(j);
  }

  /** The tour put away: `finished` or skipped, it is not offered again. */
  end(finished = false) {
    if (this.i >= 0 || this.offering || finished) markSeen();
    this.i = -1;
    this.offering = false;
    this.show(false);
    if (finished) this.creator.ui.flash('Tour done · Help has it all again', 2000);
  }

  show(on) {
    this.layer.hidden = !on;
    cancelAnimationFrame(this.raf);
    if (on) this.raf = requestAnimationFrame(this.tick);
  }

  /** The card: the step's words and its buttons, or the offer. */
  fill({ offer = false } = {}) {
    const card = this.card;
    card.textContent = '';
    const head = el('header', 'stt-head');
    const close = el('button', 'stt-x', '');
    close.type = 'button';
    close.title = 'Close the tour';
    close.setAttribute('aria-label', 'Close the tour');
    close.addEventListener('click', () => this.end(false));
    if (offer) {
      head.append(el('b', '', 'New to the studio?'), close);
      const go = this.button('Take the tour', () => this.begin(), 'on');
      const later = this.button('Not now', () => this.end(false));
      const row = el('div', 'stt-row');
      row.append(later, go);
      card.append(head, el('p', 'stt-words', 'Two minutes: a kill from this round made into a clip, a step at a time, in the studio itself.'), row);
      card.dataset.step = 'offer';
      return;
    }
    const step = TOUR_STEPS[this.i];
    const count = TOUR_STEPS.filter(s => !s.skip?.(this.facts ?? {})).length;
    const at = TOUR_STEPS.slice(0, this.i + 1).filter(s => !s.skip?.(this.facts ?? {})).length;
    head.append(el('span', 'stt-count', `${at} of ${count}`), el('b', '', step.title), close);
    this.words = el('p', 'stt-words', '');
    this.status = el('span', 'stt-status', '');
    const row = el('div', 'stt-row');
    const back = this.button('Back', () => this.back());
    back.disabled = nextStep(this.i, this.facts ?? {}, -1) < 0;
    this.nextBtn = this.button(this.i === TOUR_STEPS.length - 1 ? 'Finish' : 'Next', () => this.next());
    row.append(this.status, back, this.nextBtn);
    card.append(head, this.words, row);
    card.dataset.step = step.id;
    this.wordsSig = '';
    this.refresh();
  }

  button(label, fn, cls = '') {
    const b = el('button', `stt-btn ${cls}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', e => {
      e.stopPropagation();
      try { fn(); } catch (error) { console.warn('studio tour:', error); }
    });
    return b;
  }

  /** The words and the step's state from the facts now. */
  refresh() {
    const step = TOUR_STEPS[this.i];
    if (!step || !this.words) return;
    const f = this.facts;
    const words = step.words(f, this.ctx);
    if (words !== this.wordsSig) {
      this.wordsSig = words;
      this.words.textContent = words;
    }
    const state = stepState(step, f, this.start0, this.ctx);
    this.state = state;
    this.card.dataset.state = state;
    this.status.textContent = state === 'done' ? 'Done' : state === 'waiting' ? 'Your turn' : '';
    this.nextBtn.classList.toggle('on', state !== 'waiting');
    if (state === 'done' && this.doneAt === null) this.doneAt = performance.now();
  }

  /** Each frame: the ring on the step's control and the card beside it; the
   *  facts a few times a second; a step shown done moves on by itself. */
  update() {
    if (this.layer.hidden) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.studio.open) {
      this.end(false);
      return;
    }
    const recording = document.documentElement.classList.contains('st-rec');
    this.layer.classList.toggle('rec', recording);
    if (this.offering) {
      this.placeCard(null);
      return;
    }
    const step = TOUR_STEPS[this.i];
    if (!step) return;
    if (this.frame++ % 6 === 0) {
      try {
        this.facts = tourFacts(this.creator, this.studio);
        this.refresh();
      } catch (error) {
        console.warn('studio tour: reading the studio', error);
      }
      if (this.state === 'done' && this.doneAt !== null && performance.now() - this.doneAt > AUTO_NEXT_MS
        && !this.facts.placing && this.creator.clipbar?.pop?.hidden !== false) {
        this.next();
        return;
      }
    }
    if (recording) return;
    const r = targetRect(step.target(this.facts ?? this.start0, this.ctx));
    this.ring.hidden = !r;
    if (r) {
      const pad = 5;
      const s = this.ring.style;
      s.left = `${r.left - pad}px`;
      s.top = `${r.top - pad}px`;
      s.width = `${r.width + pad * 2}px`;
      s.height = `${r.height + pad * 2}px`;
    }
    this.placeCard(r);
  }

  /** The card above what is lit, else to its left, else below; the top
   *  right of the monitor with nothing lit. */
  placeCard(r) {
    const card = this.card;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const gap = 16;
    let x;
    let y;
    if (!r) {
      const stage = this.studio.stage.getBoundingClientRect();
      x = stage.right - w - gap;
      y = stage.top + gap;
    } else if (r.top - h - gap > 8) {
      x = r.left + r.width / 2 - w / 2;
      y = r.top - h - gap;
    } else if (r.left - w - gap > 8) {
      x = r.left - w - gap;
      y = r.top + r.height / 2 - h / 2;
    } else {
      x = r.left + r.width / 2 - w / 2;
      y = r.bottom + gap;
    }
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.layer.remove();
  }
}

function injectStyle() {
  if (document.getElementById('stt-style')) return;
  const style = el('style');
  style.id = 'stt-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const STYLE = `
.stt { --stt-gold: #e8c35a; --stt-ink: #eeecd9; --stt-muted: #a9a690; --stt-plate: rgba(20, 20, 17, .97); --stt-edge: rgba(200, 194, 152, .34);
  position: fixed; inset: 0; z-index: 1010; pointer-events: none; font: 13px/1.45 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; }
.stt[hidden], .stt.rec { display: none; }
.stt-ring { position: fixed; border: 2px solid var(--stt-gold); border-radius: 8px; box-sizing: border-box;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .28), 0 0 18px rgba(232, 195, 90, .55);
  transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease; animation: stt-pulse 1.6s ease-in-out infinite; }
.stt-ring[hidden] { display: none; }
@keyframes stt-pulse { 50% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, .28), 0 0 30px rgba(232, 195, 90, .9); } }
.stt-card { position: fixed; left: 0; top: 0; width: 300px; box-sizing: border-box; padding: 12px 14px 12px; pointer-events: auto;
  border: 1px solid var(--stt-edge); border-top: 3px solid var(--stt-gold); border-radius: 8px; background: var(--stt-plate);
  color: var(--stt-ink); box-shadow: 0 14px 40px rgba(0, 0, 0, .6); transition: transform .18s ease; }
.stt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.stt-head b { flex: 1; font-weight: 800; font-size: 14px; color: var(--stt-ink); }
.stt-count { font: 700 11px ui-monospace, monospace; color: var(--stt-gold); letter-spacing: .06em; white-space: nowrap; }
.stt-x { appearance: none; position: relative; width: 24px; height: 24px; border: 0; border-radius: 4px; background: none; cursor: pointer; }
.stt-x::before, .stt-x::after { content: ''; position: absolute; left: 6px; right: 6px; top: 11px; height: 2px; background: var(--stt-muted); transform: rotate(45deg); }
.stt-x::after { transform: rotate(-45deg); }
.stt-x:hover { background: rgba(255, 255, 255, .08); }
.stt-words { margin: 0 0 10px; color: var(--stt-ink); }
.stt-row { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.stt-status { flex: 1; font: 700 11px ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--stt-muted); }
.stt-card[data-state="done"] .stt-status { color: #8fd18a; }
.stt-card[data-state="waiting"] .stt-status { animation: stt-blink 1.6s ease-in-out infinite; }
@keyframes stt-blink { 50% { color: var(--stt-gold); } }
.stt-btn { appearance: none; height: 30px; padding: 0 12px; border: 1px solid var(--stt-edge); border-radius: 6px; background: rgba(255, 255, 255, .04);
  color: var(--stt-ink); font: 700 12px inherit; font-family: inherit; cursor: pointer; }
.stt-btn:hover { background: rgba(255, 255, 255, .1); }
.stt-btn:disabled { opacity: .35; cursor: default; }
.stt-btn.on { border-color: var(--stt-gold); background: var(--stt-gold); color: #15150e; }
.stt-btn:focus-visible, .stt-x:focus-visible { outline: 2px solid var(--stt-gold); outline-offset: 1px; }
`;
