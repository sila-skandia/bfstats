// A song under the clip (features/replay-creator-view, "The hit on a beat"):
// a creator cutting to music loads the track they will use and hears it with
// the clip as it plays in the studio, the game held quiet, so they can tell
// the hit lands on the drums. With `record` on (the default) Record puts it
// in the file too, mixed with the game's sound or alone while the game is
// muted (2026-11-09: "can you export with a song uploaded?"): the song is
// routed through the page's audio context (`attach`) so the recorder can
// take it with the rest.
//
// The song follows the clip's video time: it starts at `offset` seconds into
// the track as the clip starts, and is put back in place when the playhead
// jumps (a loop, a scrub, a seek). In between it runs on its own clock rather
// than being pulled about every frame: the clip's clock is a model of the
// page's, a few hundredths out on a kill shot until its round has flown once,
// and a song nudged that often stutters.
//
// `songPosition` and `songAction` are pure, so `tests/replay_sync_harness.mjs`
// runs them; ClipMusic wraps one <audio> element.

/** A playhead move bigger than this in one frame is a jump the song follows. */
export const JUMP = 0.4;
/** Seconds the song may drift from the clip's clock before it is put back
 *  in place outright; under it the song is eased back by its rate. */
export const DRIFT_SEEK = 0.25;
/** How much faster or slower the song may play to close a drift (its pitch
 *  is kept): a tenth closes 50 ms in half a second, unheard. */
export const RATE_PULL = 0.1;

/**
 * The song's playback rate this frame to close `drift` seconds (where it
 * should be less where it is): 1 in step, faster behind, slower ahead,
 * never more than RATE_PULL off. The clip's clock wanders a little against
 * the wall's (a stalled frame, the clock's ease into slow motion), and the
 * recording's picture follows the clip's clock: a song left on its own ran
 * 0.2 s off the explosion in a recorded file.
 */
export function songRate(drift) {
  if (!Number.isFinite(drift)) return 1;
  return Math.min(1 + RATE_PULL, Math.max(1 - RATE_PULL, 1 + drift * 2));
}

/** Where in the song the clip is at `video` seconds in: the track's own
 *  seconds, or null before the clip's start or past the song's end. */
export function songPosition(video, offset, duration = Infinity) {
  if (!Number.isFinite(video) || video < 0) return null;
  const at = offset + video;
  return at >= 0 && at < duration ? at : null;
}

/**
 * What the song does this frame: 'pause', 'play' (from `at`, put in
 * place), 'seek' (put back in place while playing) or 'keep'.
 *
 * `s` is `{ playing, video, prevT, t, paused, offset, duration, at, frozen }`:
 * whether the clip plays (a freeze on the kill counts as playing, its
 * picture held and its music not), the clip's video seconds now, the round's
 * time this frame and last, whether the song is paused now, where it is
 * (`at`, its own seconds) and whether the clip is held on a freeze. Kept in
 * step it answers the `rate` to play at (`songRate`).
 */
export function songAction(s) {
  const at = songPosition(s.video, s.offset, s.duration);
  if (!s.playing || at === null) return { act: 'pause' };
  const jumped = s.prevT !== null && (s.t < s.prevT - 0.05 || s.t > s.prevT + JUMP);
  if (s.paused) return { act: 'play', at };
  if (jumped) return { act: 'seek', at };
  // Held on a freeze, the picture still and the song going on: no pull.
  if (s.frozen || !Number.isFinite(s.at)) return { act: 'keep', rate: 1 };
  const drift = at - s.at;
  if (Math.abs(drift) > DRIFT_SEEK) return { act: 'seek', at };
  return { act: 'keep', rate: songRate(drift) };
}

export class ClipMusic {
  constructor() {
    this.audio = null;
    this.url = null;
    this.name = '';
    this.offset = 0;
    this.volume = 0.9;
    this.quietGame = true;
    this.record = true;
    this.prevT = null;
    this.error = null;
    this.graph = null;            // { context, audio, src, out }: the song in Web Audio (`attach`)
    this.ownContext = null;       // a context of its own, on a page with no audio of its own
  }

  get loaded() {
    return Boolean(this.audio);
  }

  get duration() {
    const d = this.audio?.duration;
    return Number.isFinite(d) ? d : Infinity;
  }

  /** A song from the creator's own disk: it never leaves the page. */
  load(file) {
    this.clear();
    if (!file) return;
    this.url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.preservesPitch = true;
    audio.src = this.url;
    audio.volume = this.volume;
    audio.addEventListener('error', () => { this.error = 'This file will not play here: try an MP3'; });
    this.audio = audio;
    this.name = file.name ?? 'Song';
    this.error = null;
    this.prevT = null;
  }

  /**
   * The song's output node in `context` (the page's, else one of its own):
   * its element routed through Web Audio once, a gain for its volume, and on
   * to the speakers, so a recorder of that context can mix it in. Null with
   * no song, or where the browser will not route it.
   */
  attach(context = null) {
    if (!this.audio) return null;
    const ctx = context ?? (this.ownContext ??= new AudioContext());
    if (this.graph?.audio === this.audio) return this.graph.context === ctx ? this.graph.out : null;
    try {
      const src = ctx.createMediaElementSource(this.audio);
      const out = ctx.createGain();
      out.gain.value = this.volume;
      src.connect(out);
      out.connect(ctx.destination);
      // The gain sets the level now: the element's own would be applied twice.
      this.audio.volume = 1;
      this.graph = { context: ctx, audio: this.audio, src, out };
      if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
      return out;
    } catch (error) {
      console.warn('replay music: the song cannot be recorded here', error);
      return null;
    }
  }

  clear() {
    if (this.graph) {
      try { this.graph.src.disconnect(); this.graph.out.disconnect(); } catch {}
      this.graph = null;
    }
    if (this.audio) {
      try { this.audio.pause(); } catch {}
      this.audio.removeAttribute('src');
      try { this.audio.load(); } catch {}
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio = null;
    this.url = null;
    this.name = '';
    this.error = null;
    this.prevT = null;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.graph?.audio === this.audio) this.graph.out.gain.value = this.volume;
    else if (this.audio) this.audio.volume = this.volume;
  }

  /** The song put back in place at the next frame (an offset changed). */
  resync() {
    if (this.audio && !this.audio.paused) this.audio.pause();
  }

  /** Each frame: `{ on, playing, video, t }` (`on`: the studio is open on a
   *  clip and nothing is recording). */
  frame({ on, playing, video, t, frozen = false }) {
    const audio = this.audio;
    if (!audio) return;
    if (!on) {
      if (!audio.paused) audio.pause();
      this.prevT = null;
      return;
    }
    const step = songAction({
      playing, video, prevT: this.prevT, t, paused: audio.paused, offset: this.offset, duration: this.duration, at: audio.currentTime, frozen,
    });
    this.prevT = t;
    const rate = step.rate ?? 1;
    if (Math.abs(audio.playbackRate - rate) > 1e-3) audio.playbackRate = rate;
    if (step.act === 'pause') {
      if (!audio.paused) audio.pause();
    } else if (step.act === 'play') {
      try { audio.currentTime = step.at; } catch {}
      audio.play().catch(() => {});
    } else if (step.act === 'seek') {
      try { audio.currentTime = step.at; } catch {}
    }
  }

  /** Whether the game is held quiet: a song loaded and the creator wants
   *  to hear it alone. */
  quietNow() {
    return Boolean(this.audio && this.quietGame);
  }

  dispose() {
    this.clear();
  }
}
