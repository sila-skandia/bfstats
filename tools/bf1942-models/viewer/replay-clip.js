// A stretch of the round recorded to a video file (features/replay-creator-
// view): the 3D canvas as it plays, through the browser's MediaRecorder, with
// the page's sound tapped where it leaves for the speakers. Only the canvas
// is recorded, so the file is the clean feed: no bar, no tags, no panels.
//
// MP4 (H.264) where the browser records it, since every editor opens it;
// WebM otherwise (Firefox). It records in real time, as the page draws: a
// machine that drops frames records a clip that drops them too.

/** What this browser can record, best first, with sound and without. */
const WITH_SOUND = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const SILENT = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** The type to record in, or null where the browser records no video. */
export function recorderMime(sound = true) {
  const Recorder = globalThis.MediaRecorder;
  if (!Recorder?.isTypeSupported) return null;
  return (sound ? WITH_SOUND : SILENT).find(type => Recorder.isTypeSupported(type)) ?? null;
}

/** A clip's file name: the level and the stretch, `wake-2m41s-2m52s.mp4`. */
export function clipName(level, t0, t1, mime) {
  const at = t => {
    const s = Math.max(0, Math.round(t));
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  };
  const ext = /mp4/.test(mime ?? '') ? 'mp4' : 'webm';
  const place = String(level || 'round').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'round';
  return `${place}-${at(t0)}-${at(t1)}.${ext}`;
}

/** Hand the browser `blob` to save as `name`. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * One recording of `canvas`. `sound()` answers `{ context, node }`, the
 * page's audio context and the node its mix leaves by, or null to record
 * without sound.
 */
export class ClipRecorder {
  constructor(canvas, { sound = () => null, fps = 60, bitrate = 16_000_000 } = {}) {
    this.canvas = canvas;
    this.sound = sound;
    this.fps = fps;
    this.bitrate = bitrate;
    this.recorder = null;
    this.chunks = [];
    this.tap = null;
    this.mime = null;
    this.startedAt = 0;
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Starts recording now. Throws where the browser cannot. */
  start() {
    if (this.recorder) throw new Error('already recording');
    const stream = this.canvas.captureStream(this.fps);
    let tap = null;
    try {
      const source = this.sound?.();
      if (source?.context && source?.node && source.context.state === 'running') {
        const dest = source.context.createMediaStreamDestination();
        source.node.connect(dest);
        const track = dest.stream.getAudioTracks()[0];
        if (track) {
          stream.addTrack(track);
          tap = { node: source.node, dest };
        } else {
          source.node.disconnect(dest);
        }
      }
    } catch (error) {
      console.warn('replay clip: recording without sound', error);
      tap = null;
    }
    const mime = recorderMime(Boolean(tap));
    if (!mime) {
      this.untap(tap);
      for (const track of stream.getTracks()) track.stop();
      throw new Error('this browser records no video');
    }
    this.tap = tap;
    this.mime = mime;
    this.stream = stream;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: this.bitrate });
    this.recorder.ondataavailable = e => {
      if (e.data?.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  untap(tap = this.tap) {
    if (!tap) return;
    try { tap.node.disconnect(tap.dest); } catch {}
  }

  /** Stops, and answers the clip as a Blob. */
  stop() {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(null);
    return new Promise(resolve => {
      recorder.onstop = () => {
        this.finish();
        resolve(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
      };
      try {
        recorder.stop();
      } catch {
        this.finish();
        resolve(null);
      }
    });
  }

  /** Stops and throws the clip away. */
  cancel() {
    const recorder = this.recorder;
    if (!recorder) return;
    recorder.onstop = () => this.finish();
    try { recorder.stop(); } catch { this.finish(); }
  }

  finish() {
    this.untap();
    this.tap = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
  }
}
