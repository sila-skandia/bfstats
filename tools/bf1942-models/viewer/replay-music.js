// A song under the clip (features/replay-creator-view, "The hit on a beat"):
// a creator cutting to music loads the track they will use and hears it with
// the clip as it plays in the studio, the game held quiet, so they can tell
// the hit lands on the drums. It is for hearing, not for the file: Record
// puts the game's sound in the video, and the song goes on in their editor
// from 0:00.
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
 * `s` is `{ playing, video, prevT, t, paused, offset, duration }`: whether
 * the clip plays (a freeze on the kill counts as playing, its picture held
 * and its music not), the clip's video seconds now, the round's time this
 * frame and last, and whether the song is paused now.
 */
export function songAction(s) {
  const at = songPosition(s.video, s.offset, s.duration);
  if (!s.playing || at === null) return { act: 'pause' };
  const jumped = s.prevT !== null && (s.t < s.prevT - 0.05 || s.t > s.prevT + JUMP);
  if (s.paused) return { act: 'play', at };
  if (jumped) return { act: 'seek', at };
  return { act: 'keep' };
}

export class ClipMusic {
  constructor() {
    this.audio = null;
    this.url = null;
    this.name = '';
    this.offset = 0;
    this.volume = 0.9;
    this.quietGame = true;
    this.prevT = null;
    this.error = null;
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
    audio.src = this.url;
    audio.volume = this.volume;
    audio.addEventListener('error', () => { this.error = 'This file will not play here: try an MP3'; });
    this.audio = audio;
    this.name = file.name ?? 'Song';
    this.error = null;
    this.prevT = null;
  }

  clear() {
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
    if (this.audio) this.audio.volume = this.volume;
  }

  /** The song put back in place at the next frame (an offset changed). */
  resync() {
    if (this.audio && !this.audio.paused) this.audio.pause();
  }

  /** Each frame: `{ on, playing, video, t }` (`on`: the studio is open on a
   *  clip and nothing is recording). */
  frame({ on, playing, video, t }) {
    const audio = this.audio;
    if (!audio) return;
    if (!on) {
      if (!audio.paused) audio.pause();
      this.prevT = null;
      return;
    }
    const step = songAction({ playing, video, prevT: this.prevT, t, paused: audio.paused, offset: this.offset, duration: this.duration });
    this.prevT = t;
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
