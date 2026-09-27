// The replay's timeline: the scrubber, the round's chapters on it (kills and
// deaths, vehicles destroyed, flags taken, the round's start and end), and a
// hover preview with a frame of the view grabbed as playback passed that
// moment (features/round-replay-ux). Plain pointer events throughout: the
// mouse reaches it without any pointer lock.

import { chapterText, involves } from './replay-chapters.js';
import { roundClock } from './replay-recording.js';

/** Markers closer than this, pixels, share one mark. */
const MERGE_PX = 7;
/** The hover picks up marks this close to the pointer, pixels. */
const HOVER_PX = 8;
/** One storyboard frame per this many recording seconds at least, and at
 *  most this many frames a round. */
const BUCKET_MIN = 5;
const MAX_BUCKETS = 120;
/** A chapter's frame is grabbed this long after its moment: the explosion,
 *  not the instant before it. */
const FRAME_AFTER = 0.35;
/** The preview's width, pixels; its height follows the view's aspect. */
const THUMB_W = 176;
/** Events listed in the tooltip at most. */
const TIP_EVENTS = 4;

export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The marks' glyphs, 12x12: a sight for a kill, a cross for a death, a burst
// for a hull, a pennant for a flag, an arrow up off the ground for a spawn.
const GLYPH = {
  sight: '<circle cx="6" cy="6" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 0v3.2M6 8.8V12M0 6h3.2M8.8 6H12" stroke="currentColor" stroke-width="1.6"/>',
  cross: '<path d="M2.2 2.2l7.6 7.6M9.8 2.2l-7.6 7.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  burst: '<path d="M6 .3l1.5 3.4 3.5-1.3-1.7 3.3 2.4 1.9-3.6.6.2 3.5L6 9.6l-2.3 2.1.2-3.5-3.6-.6 2.4-1.9L1 2.4l3.5 1.3z" fill="currentColor"/>',
  flag: '<path d="M2 .5h1.5v11H2z" fill="currentColor"/><path d="M3.5 1h7.2l-2 2.6 2 2.6H3.5z" fill="currentColor"/>',
  spawn: '<path d="M6 .6l4 4.5H7.3v3.8H4.7V5.1H2z" fill="currentColor"/><path d="M1.6 11h8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

export function glyphSvg(name) {
  return `<svg viewBox="0 0 12 12" aria-hidden="true">${GLYPH[name] ?? ''}</svg>`;
}

/** How a chapter is marked, for the followed player `pid`: `{ glyph, cls }`
 *  (a glyph null is a plain tick). */
export function markStyle(ch, pid) {
  const mine = involves(ch, pid);
  const team = ch.team === 1 ? 't1' : ch.team === 2 ? 't2' : 't0';
  switch (ch.kind) {
    case 'kill':
      if (mine && ch.victim === pid) return { glyph: 'cross', cls: 'death mine' };
      return mine ? { glyph: 'sight', cls: `kill mine ${team}` } : { glyph: null, cls: `kill ${team}` };
    case 'teamkill':
    case 'death':
      if (mine && ch.victim === pid) return { glyph: 'cross', cls: 'death mine' };
      return mine ? { glyph: 'sight', cls: 'teamkill mine' } : { glyph: null, cls: ch.kind };
    case 'vehicle':
      return { glyph: 'burst', cls: `vehicle${mine ? ' mine' : ''}` };
    case 'capture':
      return { glyph: 'flag', cls: `capture ${team}` };
    case 'spawn':
      return { glyph: 'spawn', cls: `spawn${mine ? ' mine' : ''}` };
    default:
      return { glyph: null, cls: 'round' };
  }
}

export class ReplayTimeline {
  constructor(ui) {
    this.ui = ui;
    this.player = ui.player;
    const duration = Math.max(0.001, this.player.rec.duration);
    this.duration = duration;
    // Not focusable: the arrow keys move the playhead from anywhere (the
    // replay's key map), and a click on the bar leaves no focus ring round it.
    this.el = el('div', 'rp-tl');
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', 'Replay position');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(Math.round(duration)));
    this.marks = el('div', 'rp-tl-marks');
    this.track = el('div', 'rp-tl-track');
    this.fill = el('div', 'rp-tl-fill');
    this.hoverLine = el('div', 'rp-tl-hover');
    this.knob = el('div', 'rp-tl-knob');
    // Before the round started and after it ended: the recording's warm-up
    // and teardown, hatched.
    const { rec } = this.player;
    const pre = rec.roundStarted ?? null;
    const post = Number.isFinite(rec.roundEnded) ? rec.roundEnded : null;
    if (pre !== null && pre > 0.5) {
      const zone = el('div', 'rp-tl-zone');
      zone.style.left = '0';
      zone.style.width = `${(pre / duration) * 100}%`;
      this.track.append(zone);
    }
    if (post !== null && post < duration - 0.5) {
      const zone = el('div', 'rp-tl-zone');
      zone.style.left = `${(post / duration) * 100}%`;
      zone.style.right = '0';
      this.track.append(zone);
    }
    this.track.append(this.fill, this.hoverLine, this.knob);
    this.el.append(this.marks, this.track);

    this.tip = el('div', 'rp-tip');
    this.tipImg = el('canvas', 'rp-tip-img');
    this.tipTime = el('div', 'rp-tip-time');
    this.tipList = el('ul', 'rp-tip-list');
    this.tip.append(this.tipImg, this.tipTime, this.tipList);

    this.clusters = [];
    this.hoverX = null;
    this.scrubbing = false;
    this.scrubTo = null;
    this.markPid = undefined;
    // Frames grabbed off the view: per chapter, and one per storyboard slot.
    this.bucket = Math.max(BUCKET_MIN, duration / MAX_BUCKETS);
    this.chapterFrames = new Map();
    this.bucketFrames = new Map();
    this.pending = null;
    this.aspect = 10 / 16;

    this.el.addEventListener('pointerdown', e => this.onDown(e));
    this.el.addEventListener('pointermove', e => this.onMove(e));
    this.el.addEventListener('pointerup', e => this.onUp(e));
    this.el.addEventListener('pointercancel', e => this.onUp(e));
    this.el.addEventListener('pointerleave', () => this.hideTip());
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.el);
  }

  get chapters() {
    return this.player.chapters;
  }

  timeAt(clientX) {
    const r = this.el.getBoundingClientRect();
    return Math.min(this.duration, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * this.duration));
  }

  /** The marks, merged where they would overlap at this width, emphasising
   *  the followed player's. */
  layout() {
    const width = this.el.clientWidth;
    if (!width) return;
    const pid = this.player.followPid;
    this.markPid = pid;
    this.marks.textContent = '';
    const clusters = [];
    const order = this.chapters.map((ch, i) => ({ ch, i, x: (ch.t / this.duration) * width }));
    for (const item of order) {
      const last = clusters[clusters.length - 1];
      // Round lines never merge: they are the round's own frame.
      if (last && item.ch.kind.startsWith('round') === last.round && !last.round && item.x - last.x < MERGE_PX) {
        last.items.push(item);
        continue;
      }
      clusters.push({ x: item.x, items: [item], round: item.ch.kind.startsWith('round') });
    }
    for (const cluster of clusters) {
      // The mark a cluster shows is its most telling member: the followed
      // player's own first (his death, then his kill), then a flag, a hull,
      // a kill.
      const rank = ({ ch }) => (involves(ch, pid) ? 0 : 10)
        + (ch.victim === pid && pid !== null ? 0 : { kill: 1, teamkill: 1, capture: 2, vehicle: 3 }[ch.kind] ?? 4);
      const lead = [...cluster.items].sort((a, b) => rank(a) - rank(b))[0];
      const style = markStyle(lead.ch, pid);
      const mark = el('button', `rp-mk ${style.cls}${style.glyph ? ' glyph' : ' tick'}`);
      mark.type = 'button';
      mark.tabIndex = -1;
      mark.style.left = `${(cluster.x / width) * 100}%`;
      if (style.glyph) mark.innerHTML = glyphSvg(style.glyph);
      mark.setAttribute('aria-label', chapterText(this.player.rec, lead.ch, this.ui.lexicon()));
      cluster.mark = mark;
      cluster.lead = lead;
      this.marks.append(mark);
    }
    this.clusters = clusters;
  }

  /** The playhead at `t`. */
  update(t) {
    if (this.markPid !== this.player.followPid) this.layout();
    // Written only when they move: a paused replay touches no style.
    const k = `${((t / this.duration) * 100).toFixed(3)}%`;
    if (k !== this.shownAt) {
      this.shownAt = k;
      this.fill.style.width = k;
      this.knob.style.left = k;
    }
    const second = Math.round(t);
    if (second !== this.shownSecond) {
      this.shownSecond = second;
      this.el.setAttribute('aria-valuenow', String(second));
      this.el.setAttribute('aria-valuetext', `${fmtClock(t)} of ${fmtClock(this.duration)}`);
    }
    if (this.hoverX !== null && this.tip.classList.contains('show')) this.showTip(this.hoverX, false);
  }

  // --- the pointer -----------------------------------------------------------

  clusterAt(clientX) {
    const r = this.el.getBoundingClientRect();
    const x = clientX - r.left;
    let best = null;
    for (const c of this.clusters) {
      const d = Math.abs(c.x - x);
      if (d <= HOVER_PX && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }

  onDown(e) {
    if (e.button !== 0) return;
    this.ui.activity();
    this.player.ctx.ensureAudio?.();
    const mark = e.target.closest?.('.rp-mk');
    const cluster = mark ? this.clusters.find(c => c.mark === mark) : null;
    if (cluster) {
      // A mark is a chapter: jump to just before it.
      e.preventDefault();
      this.ui.jumpTo(cluster.lead.ch);
      return;
    }
    this.scrubbing = true;
    this.el.classList.add('scrubbing');
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    this.scrubTo = this.timeAt(e.clientX);
    this.showTip(e.clientX, true);
  }

  onMove(e) {
    this.ui.activity();
    if (this.scrubbing) {
      this.scrubTo = this.timeAt(e.clientX);
    }
    this.showTip(e.clientX, true);
  }

  onUp(e) {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.el.classList.remove('scrubbing');
    try { this.el.releasePointerCapture(e.pointerId); } catch {}
    this.scrubTo = this.timeAt(e.clientX);
  }

  /** The time a drag has put the playhead at since the last frame, once. */
  takeScrub() {
    const t = this.scrubTo;
    this.scrubTo = null;
    return t;
  }

  // --- the tooltip -------------------------------------------------------------

  showTip(clientX, fromPointer) {
    this.hoverX = clientX;
    const rect = this.el.getBoundingClientRect();
    const stage = this.ui.root.getBoundingClientRect();
    const t = this.timeAt(clientX);
    const cluster = this.clusterAt(clientX);
    this.hoverLine.style.left = `${((clientX - rect.left) / Math.max(1, rect.width)) * 100}%`;
    const at = cluster ? cluster.lead.ch.t : t;
    const frame = cluster ? this.frameOfChapter(cluster) : this.frameAt(t);
    // The content is rebuilt only when it changes: the tooltip is refreshed
    // every frame while the pointer rests on a playing timeline.
    const key = `${cluster ? cluster.lead.i : ''}|${fmtClock(at)}|${frame?.id ?? ''}|${this.player.followPid}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      // The time, and the round's own clock beside it.
      const clock = roundClock(this.player.rec, at);
      this.tipTime.textContent = '';
      this.tipTime.append(document.createTextNode(fmtClock(at)));
      if (clock !== null) this.tipTime.append(el('span', '', `ROUND ${fmtClock(clock)}`));
      // What happened there.
      this.tipList.textContent = '';
      if (cluster) {
        const pid = this.player.followPid;
        const lexicon = this.ui.lexicon();
        for (const { ch } of cluster.items.slice(0, TIP_EVENTS)) {
          const style = markStyle(ch, pid);
          const li = el('li', style.cls);
          const icon = el('i', style.glyph ? 'g' : 'dot');
          if (style.glyph) icon.innerHTML = glyphSvg(style.glyph);
          li.append(icon, el('span', '', chapterText(this.player.rec, ch, lexicon)));
          this.tipList.append(li);
        }
        if (cluster.items.length > TIP_EVENTS) this.tipList.append(el('li', 'more', `+${cluster.items.length - TIP_EVENTS} more`));
      }
    }
    // The frame nearest that moment, if playback has been there.
    this.tipImg.hidden = !frame;
    if (frame) {
      const w = THUMB_W;
      const h = Math.round(THUMB_W * this.aspect);
      if (this.tipImg.width !== w || this.tipImg.height !== h) {
        this.tipImg.width = w;
        this.tipImg.height = h;
      }
      if (this.tipImg.dataset.frame !== frame.id) {
        this.tipImg.dataset.frame = frame.id;
        this.tipImg.getContext('2d').drawImage(frame.image, 0, 0, w, h);
      }
    }
    const width = this.tip.offsetWidth || THUMB_W + 16;
    const x = Math.min(stage.width - width / 2 - 8, Math.max(width / 2 + 8, clientX - stage.left));
    this.tip.style.left = `${x}px`;
    this.tip.style.bottom = `${stage.bottom - rect.top + 10}px`;
    if (fromPointer) this.tip.classList.add('show');
  }

  hideTip() {
    this.hoverX = null;
    this.tip.classList.remove('show');
  }

  // --- the frames ----------------------------------------------------------------

  frameOfChapter(cluster) {
    for (const { i } of cluster.items) {
      const f = this.chapterFrames.get(i);
      if (f) return f;
    }
    return this.frameAt(cluster.lead.ch.t);
  }

  frameAt(t) {
    const b = Math.floor(t / this.bucket);
    return this.bucketFrames.get(b) ?? this.bucketFrames.get(b - 1) ?? this.bucketFrames.get(b + 1) ?? null;
  }

  /**
   * Whether this frame's view should be kept: playback just passed a chapter
   * (a little after its moment) or entered a storyboard slot with no frame
   * yet. Only in steady forward play; a grab is taken after the render
   * (`capture`), never by rendering again.
   */
  plan(prevT, t, playing) {
    if (!playing || this.scrubbing || t <= prevT || t - prevT > 1) return;
    const chapters = this.chapters;
    for (let i = 0; i < chapters.length; i++) {
      const at = chapters[i].t + FRAME_AFTER;
      if (at > t) break;
      if (at > prevT && !this.chapterFrames.has(i)) {
        this.pending = { kind: 'chapter', key: i, t };
        return;
      }
    }
    const b = Math.floor(t / this.bucket);
    if (!this.bucketFrames.has(b) && t - b * this.bucket > 0.5 && !this.pending) {
      this.pending = { kind: 'bucket', key: b, t };
    }
  }

  /** After the render: keep the planned frame, scaled down. */
  capture(canvas) {
    const want = this.pending;
    if (!want || !canvas?.width) return;
    this.pending = null;
    this.aspect = canvas.height / canvas.width;
    const w = THUMB_W;
    const h = Math.max(1, Math.round(THUMB_W * this.aspect));
    const store = image => {
      const frame = { id: `${want.kind}${want.key}`, t: want.t, image };
      (want.kind === 'chapter' ? this.chapterFrames : this.bucketFrames).set(want.key, frame);
    };
    // Marked taken now, so the next frame does not ask again while the
    // bitmap is on its way.
    (want.kind === 'chapter' ? this.chapterFrames : this.bucketFrames).set(want.key, null);
    const drop = () => (want.kind === 'chapter' ? this.chapterFrames : this.bucketFrames).delete(want.key);
    if (typeof createImageBitmap === 'function') {
      // The drawing buffer is only whole in the task that rendered it, and
      // createImageBitmap snapshots it at the call.
      createImageBitmap(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
        .then(store, drop);
    } else {
      const copy = el('canvas');
      copy.width = w;
      copy.height = h;
      try {
        copy.getContext('2d').drawImage(canvas, 0, 0, w, h);
        store(copy);
      } catch {
        drop();
      }
    }
  }

  dispose() {
    this.resize.disconnect();
    for (const map of [this.chapterFrames, this.bucketFrames]) {
      for (const frame of map.values()) frame?.image?.close?.();
      map.clear();
    }
  }
}
