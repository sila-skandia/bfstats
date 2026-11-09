// A song under the clip (features/replay-creator-view, "The hit on a beat"):
// a creator cutting to music loads the track they will use and hears it with
// the clip as it plays in the studio, the game held quiet, so they can tell
// the hit lands on the drums. With `record` on (the default) Record puts it
// in the file too, mixed with the game's sound or alone while the game is
// muted (2026-11-09: "can you export with a song uploaded?"): the song plays
// in the page's audio context (`attach` answers its output node) so the
// recorder can take it with the rest.
//
// The song is a decoded AudioBuffer played by an AudioBufferSourceNode, not
// an <audio> element (2026-11-10). An element seeks with a stall: after
// `currentTime` is set the song stands still for 0.3-0.5 s in Safari with
// any file and in Chrome with an MP3 that has no seek table, so the song
// landed behind the clip by more than the seek tolerance and was seeked
// again, and again ("very stuttery, like it's playing forward and back").
// A buffer starts at an exact sample at once, in every browser, and a loop
// or a scrub puts the song back in place with a 15 ms crossfade.
//
// The song follows the clip's video time: it starts at `offset` seconds into
// the track as the clip starts, and is put back in place when the playhead
// jumps (a loop, a scrub, a seek). In between it runs on the audio clock and
// its rate is pulled a little toward where the clip's clock says it should
// be (`songRate`): a buffer's rate changes its pitch, so the pull is small
// and a drift it cannot close in a couple of seconds is a restart instead.
//
// `songPosition` and `songAction` are pure, so `tests/replay_sync_harness.mjs`
// runs them; ClipMusic wraps one buffer and the voice playing it.

/** A playhead move bigger than this in one frame is a jump the song follows. */
export const JUMP = 0.4;
/** Seconds the song may drift from the clip's clock before it is put back
 *  in place outright (a crossfaded restart); under it the song is eased
 *  back by its rate. */
export const DRIFT_SEEK = 0.15;
/** How much faster or slower the song may play to close a drift: a buffer's
 *  rate bends its pitch, so at most 3% (half a semitone), which closes
 *  DRIFT_SEEK in 2.5 s and the usual few hundredths in under a second. */
export const RATE_PULL = 0.03;
/** The crossfade of a restart and the fade of a stop, seconds: no click. */
export const FADE = 0.015;

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
 * time this frame and last, whether the song is silent now, where it is
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

/** Peaks a second the waveform keeps: fine enough to see a drum hit. */
export const PEAKS_PER_SECOND = 50;

/**
 * The song's waveform: the loudest sample of each 1/`perSecond` of it,
 * across its channels (`channels`, Float32Arrays at `sampleRate`). The
 * strip's Music lane draws it under the clip so the drop can be seen.
 */
export function songPeaks(channels, sampleRate, perSecond = PEAKS_PER_SECOND) {
  const n = channels[0]?.length ?? 0;
  const step = Math.max(1, Math.round(sampleRate / perSecond));
  const out = new Float32Array(Math.ceil(n / step));
  for (const ch of channels) {
    for (let b = 0; b < out.length; b++) {
      let peak = out[b];
      const end = Math.min(n, (b + 1) * step);
      for (let i = b * step; i < end; i++) {
        const v = ch[i] < 0 ? -ch[i] : ch[i];
        if (v > peak) peak = v;
      }
      out[b] = peak;
    }
  }
  return out;
}

/** The loudest peak from `from` to `to` seconds of the song (`peaks` at
 *  `perSecond`), 0 outside it. */
export function peakBetween(peaks, from, to, perSecond = PEAKS_PER_SECOND) {
  if (!peaks?.length || !(to > 0)) return 0;
  const a = Math.max(0, Math.floor(from * perSecond));
  const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil(to * perSecond)));
  let m = 0;
  for (let i = a; i < b; i++) if (peaks[i] > m) m = peaks[i];
  return m;
}

/** The song's start under the clip after a drag of `dx` seconds of the
 *  video (right is later in the clip, so earlier in the song), held inside
 *  the song. */
export function slidOffset(start, dx, duration = Infinity) {
  const most = Number.isFinite(duration) ? Math.max(0, duration - 0.5) : Infinity;
  return Math.min(most, Math.max(0, start - dx));
}

export class ClipMusic {
  /** `pageContext` answers the page's AudioContext, or null before the page
   *  has sound: the song plays there, where the recorder can take it. */
  constructor(pageContext = null) {
    this.pageContext = pageContext;
    this.file = null;
    this.name = '';
    this.offset = 0;
    this.volume = 0.9;
    this.quietGame = true;
    this.record = true;
    this.prevT = null;
    this.error = null;
    this.peaks = null;            // the song's waveform (`songPeaks`), once decoded
    this.onChange = null;         // called when the song or its waveform changes
    this.ownContext = null;       // a context of its own, on a page with no audio of its own
    this.context = null;          // the context the song plays in
    this.out = null;              // its output gain there (the volume), on to the speakers
    this.buffer = null;           // the decoded song
    this.voice = null;            // { src, gain, pos, since, rate }: the buffer playing, and where it is
    this.restarts = 0;            // how often the song was put back in place (a probe's count)
  }

  /** A song is on the lane, decoded or still decoding. */
  get loaded() {
    return Boolean(this.file);
  }

  /** The song can play. */
  get ready() {
    return Boolean(this.buffer);
  }

  get duration() {
    const d = this.buffer?.duration;
    return Number.isFinite(d) ? d : Infinity;
  }

  /** A song from the creator's own disk: it never leaves the page. */
  load(file) {
    this.clear();
    if (!file) return;
    this.file = file;
    this.name = file.name ?? 'Song';
    this.error = null;
    this.prevT = null;
    this.decode(file);
    this.onChange?.();
  }

  /** The context the song plays in: the page's, else one of its own. */
  contextFor() {
    const page = this.pageContext?.() ?? null;
    if (page) return page;
    if (!this.ownContext) {
      try { this.ownContext = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(); } catch { return null; }
    }
    return this.ownContext;
  }

  /** The song decoded into `context` (the one it plays in), and its
   *  waveform from the samples; a song the browser will not decode says so. */
  async decode(file, context = this.contextFor()) {
    if (!context) {
      this.error = 'This browser has no sound here';
      this.onChange?.();
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes);
      if (this.file !== file) return;
      this.use(context);
      this.buffer = buffer;
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      this.peaks = songPeaks(channels, buffer.sampleRate);
      this.onChange?.();
    } catch (error) {
      if (this.file !== file) return;
      console.warn('replay music: this song will not decode', error);
      this.error = 'This file will not play here: try an MP3';
      this.onChange?.();
    }
  }

  /** The song's output in `context`: a gain for its volume, on to the speakers. */
  use(context) {
    if (this.context === context && this.out) return;
    this.stop(0);
    if (this.out) { try { this.out.disconnect(); } catch {} }
    this.context = context;
    this.out = context.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(context.destination);
  }

  /**
   * The song's output node in `context` (the page's, else the one it plays
   * in), so a recorder of that context can mix it in. Null with no song. A
   * song decoded into another context is moved: its buffer plays in this
   * one from the next frame (it is put back in place there).
   */
  attach(context = null) {
    if (!this.file) return null;
    const ctx = context ?? this.context ?? this.contextFor();
    if (!ctx) return null;
    if (this.context !== ctx) {
      this.use(ctx);
      // The buffer was decoded elsewhere: Safari and Chrome play it all the
      // same, and where one would not, decode it again here.
      if (this.buffer && !this.plays(this.buffer, ctx)) {
        this.buffer = null;
        this.decode(this.file, ctx);
      }
    }
    if (ctx.state !== 'running') ctx.resume?.().catch?.(() => {});
    return this.out;
  }

  /** Whether `buffer` can be given to a source of `context`. */
  plays(buffer, context) {
    try {
      const src = context.createBufferSource();
      src.buffer = buffer;
      return true;
    } catch {
      return false;
    }
  }

  /** Where the song is now, its own seconds, or null while silent. */
  position() {
    const v = this.voice;
    if (!v) return null;
    return v.pos + (this.context.currentTime - v.since) * v.rate;
  }

  /** The song from `at` (its own seconds) at `rate`, faded in over `fade`. */
  start(at, rate = 1, fade = FADE) {
    const ctx = this.context;
    if (!ctx || !this.buffer || !this.out) return;
    const now = ctx.currentTime;
    let src;
    try {
      src = ctx.createBufferSource();
      src.buffer = this.buffer;
    } catch (error) {
      console.warn('replay music: the song cannot play here', error);
      return;
    }
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(fade > 0 ? 0 : 1, now);
    if (fade > 0) gain.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(gain);
    gain.connect(this.out);
    const voice = { src, gain, pos: at, since: now, rate, stopped: false };
    src.onended = () => {
      // The song ran out on its own: silent until the clip puts it back.
      if (this.voice === voice && !voice.stopped) this.voice = null;
      try { src.disconnect(); gain.disconnect(); } catch {}
    };
    src.start(now, Math.max(0, Math.min(this.buffer.duration, at)));
    this.voice = voice;
    if (ctx.state !== 'running') ctx.resume?.().catch?.(() => {});
  }

  /** The voice faded out over `fade` seconds and gone. */
  stop(fade = FADE) {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    v.stopped = true;
    const ctx = this.context;
    const now = ctx?.currentTime ?? 0;
    try {
      if (fade > 0 && ctx) {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + fade);
        v.src.stop(now + fade + 0.005);
      } else {
        v.src.stop();
      }
    } catch {}
  }

  /** The song put back in place at `at`: the old voice fades as the new one
   *  comes in, so a loop's return or a scrub does not click. */
  seek(at) {
    this.stop(FADE);
    this.start(at, 1, FADE);
    this.restarts++;
  }

  /** The song's rate, its position carried over so it stays known. */
  setRate(rate) {
    const v = this.voice;
    if (!v || Math.abs(v.rate - rate) < 1e-3) return;
    const now = this.context.currentTime;
    v.pos += (now - v.since) * v.rate;
    v.since = now;
    v.rate = rate;
    v.src.playbackRate.setValueAtTime(rate, now);
  }

  clear() {
    this.stop(0);
    if (this.out) {
      try { this.out.disconnect(); } catch {}
      this.out = null;
    }
    this.context = null;
    this.buffer = null;
    this.file = null;
    this.name = '';
    this.error = null;
    this.prevT = null;
    this.peaks = null;
    this.onChange?.();
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.out) this.out.gain.value = this.volume;
  }

  /** The song put back in place at the next frame (an offset changed). */
  resync() {
    this.stop(FADE);
  }

  /** Each frame: `{ on, playing, video, t }` (`on`: the studio is open on a
   *  clip and nothing is recording). */
  frame({ on, playing, video, t, frozen = false }) {
    if (!this.buffer) return;
    if (!on) {
      this.stop(FADE);
      this.prevT = null;
      return;
    }
    const step = songAction({
      playing, video, prevT: this.prevT, t, paused: !this.voice, offset: this.offset, duration: this.duration, at: this.position(), frozen,
    });
    this.prevT = t;
    if (step.act === 'pause') {
      this.stop(FADE);
    } else if (step.act === 'play') {
      this.start(step.at, 1, FADE);
    } else if (step.act === 'seek') {
      this.seek(step.at);
    } else {
      this.setRate(step.rate ?? 1);
    }
  }

  /** Whether the game is held quiet: a song loaded and the creator wants
   *  to hear it alone. */
  quietNow() {
    return Boolean(this.file && this.quietGame);
  }

  dispose() {
    this.clear();
  }
}
