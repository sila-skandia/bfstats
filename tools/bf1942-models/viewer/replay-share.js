// Share a creator's clip as a Short (features/replay-shorts, "Creators share";
// the owner, 2026-11-04: "allow creators to create clips and share them as
// shorts"). After the studio records a clip it downloads as before; when the
// clip is 9:16, an MP4 and of a shared round, this offers it to the Shorts
// strip too: a title, the player's sign-in on bfstats.io, a poster from the
// clip's middle, and the upload (POST /stats/shorts/share). It goes live at
// once under the player's linked in-game name; he or an admin can take it down.
//
// A nicety: anything that fails here says so in the dialog and leaves the
// download as it was.

import { apiMode, sharedRecordingOf, sharedRecordingsApi, signInHref } from './recordings-api.js';

const STYLE = `
.rsh-back { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px;
  background: rgba(6, 7, 6, .72); font: 14px/1.45 'Trebuchet MS', 'Segoe UI', sans-serif; color: #ece6cf; }
.rsh-panel { display: grid; grid-template-columns: auto minmax(0, 300px); gap: 18px; max-width: 640px; width: 100%;
  padding: 18px; border-radius: 10px; background: #171814; border: 1px solid #3c3b2f; box-shadow: 0 18px 50px rgba(0, 0, 0, .5); }
.rsh-panel video { width: 200px; aspect-ratio: 9 / 16; border-radius: 8px; background: #000; object-fit: cover; }
.rsh-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.rsh-side h2 { margin: 0; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: #e8c35a; }
.rsh-side label { display: grid; gap: 5px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #b9b39a; }
.rsh-side input { height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid #4a4838; background: #0f100d; color: #f4f0dc;
  font: inherit; text-transform: none; letter-spacing: 0; }
.rsh-side input:focus-visible, .rsh-side button:focus-visible, .rsh-side a:focus-visible { outline: 1px solid #e8c35a; outline-offset: 1px; }
.rsh-note { margin: 0; font-size: 12.5px; color: #b9b39a; }
.rsh-status { min-height: 1.4em; margin: 0; font-size: 13px; }
.rsh-status.bad { color: #e08a7a; }
.rsh-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.rsh-row button, .rsh-row a { height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid #4a4838; background: #24251f; color: #ece6cf;
  font: 700 12px/32px 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; text-decoration: none; cursor: pointer; }
.rsh-row .go { background: #e8c35a; border-color: #e8c35a; color: #191a12; }
.rsh-row button:disabled { opacity: .5; cursor: default; }
@media (max-width: 560px) { .rsh-panel { grid-template-columns: 1fr; } .rsh-panel video { width: 140px; justify-self: center; } }
`;

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Whether a recorded clip can be shared as a Short: `{ ok, why }`. */
export function shareable({ mime, frame, replayUrl }) {
  if (frame !== '916') return { ok: false, why: 'Pick the 9:16 frame to share a clip as a Short.' };
  if (!/mp4/i.test(String(mime ?? ''))) return { ok: false, why: 'This browser records WebM; Shorts take MP4 (Chrome, Edge or Safari).' };
  if (!sharedRecordingOf(replayUrl)) return { ok: false, why: 'Only clips of a shared round can be Shorts.' };
  return { ok: true, why: null };
}

/** Resolves on `name` from `target`, or rejects after `ms`. */
const once = (target, name, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`the clip gave no ${name}`)), ms);
  target.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true });
  target.addEventListener('error', () => { clearTimeout(timer); reject(new Error('the clip would not load')); }, { once: true });
});

/** Resolves once `video` has put a frame on screen (or after `ms`). */
const frameShown = (video, ms = 1000) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  const done = () => { clearTimeout(timer); resolve(); };
  if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(done);
  else requestAnimationFrame(() => requestAnimationFrame(done));
});

/** The mean brightness of `canvas`, 0-255, from a sparse sample. */
export function brightnessOf(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const step = 4 * 97;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += step, n++) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return n ? sum / n : 0;
}

/** Below this mean brightness a poster is a black frame, not a picture. */
const BLACK = 4;
/** Where in the clip a poster is looked for: the middle, then either side. */
const POSTER_AT = [0.5, 0.35, 0.65, 0.2, 0.8];

/**
 * A JPEG of the clip's middle frame, for its poster. Safari draws a video it
 * has not shown a frame of as black, and a seek only says the frame is
 * found, not drawn (2026-11-08: both of skandia's first studio shares went up
 * with an all-black poster). So the video is kept in the page, the frame is
 * drawn once it is on screen, and a black one is tried again elsewhere in the
 * clip, played a moment the second time round.
 */
export async function posterOf(blob) {
  const video = el('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'fixed', left: '0', top: '0', width: '4px', height: '4px', opacity: '0.01', pointerEvents: 'none',
  });
  document.body.append(video);
  video.src = URL.createObjectURL(blob);
  try {
    await once(video, 'loadeddata', 15000);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const cv = el('canvas');
    cv.width = video.videoWidth;
    cv.height = video.videoHeight;
    const g = cv.getContext('2d');
    for (const [k, at] of POSTER_AT.entries()) {
      const sought = once(video, 'seeked', 5000);
      video.currentTime = duration * at;
      await sought;
      if (k > 0) {
        const shown = frameShown(video);
        await video.play().catch(() => {});
        await shown;
        video.pause();
      } else await frameShown(video);
      g.drawImage(video, 0, 0, cv.width, cv.height);
      if (brightnessOf(cv) >= BLACK) break;
    }
    const jpeg = await new Promise(resolve => cv.toBlob(resolve, 'image/jpeg', 0.88));
    return { jpeg, duration };
  } finally {
    URL.revokeObjectURL(video.src);
    video.remove();
  }
}

/**
 * Offers `blob` (a recorded clip, `mime`) as a Short, in a dialog. `clip` is
 * `{ t0, t1, kill, level, title }` from the creator: the clip's span in the
 * round, its kill (`{ t, victim }`), a title to start from and the names of
 * the two players in it. `save`, when given, is the studio's Post as a Short:
 * the clip was not downloaded, and Save the file does it.
 */
export function offerShare(blob, mime, clip, { frame, save = null, replayUrl = new URLSearchParams(location.search).get('replay') } = {}) {
  const can = shareable({ mime, frame, replayUrl });
  if (!can.ok) return { offered: false, why: can.why };
  const shared = sharedRecordingOf(replayUrl);
  const api = sharedRecordingsApi({ base: shared.base, mode: apiMode(shared.base) });
  if (!api.canWrite) return { offered: false, why: 'This round is read from another site.' };

  if (!document.getElementById('rsh-style')) {
    const style = el('style');
    style.id = 'rsh-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const back = el('div', 'rsh-back');
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', 'Share as a Short');
  const panel = el('div', 'rsh-panel');
  const preview = el('video');
  preview.muted = true;
  preview.loop = true;
  preview.autoplay = true;
  preview.playsInline = true;
  const url = URL.createObjectURL(blob);
  preview.src = url;
  const side = el('div', 'rsh-side');
  const title = el('input');
  title.maxLength = 120;
  title.value = clip.title ?? '';
  title.placeholder = 'What happens in it';
  const label = el('label', '', 'Title');
  label.append(title);
  const note = el('p', 'rsh-note',
    'It goes in the Shorts strip on the REPLAY tab under your linked in-game name, live at once. Take down, on the Short in the player, removes it again.');
  const status = el('p', 'rsh-status');
  status.setAttribute('aria-live', 'polite');
  const row = el('div', 'rsh-row');
  const share = el('button', 'go', 'Share');
  share.type = 'button';
  const signIn = el('a', '', 'Sign in');
  signIn.href = signInHref(location.href);
  signIn.target = '_blank';
  signIn.rel = 'noopener';
  signIn.hidden = true;
  const close = el('button', '', 'Not now');
  close.type = 'button';
  row.append(share, signIn);
  if (save) {
    const keep = el('button', '', 'Save the file');
    keep.type = 'button';
    keep.title = 'Download the clip as a video file too';
    keep.addEventListener('click', () => {
      try { save(); } catch (error) { console.warn('replay-share: saving the clip', error); }
      keep.disabled = true;
      keep.textContent = 'Saved';
    });
    row.append(keep);
  }
  row.append(close);
  side.append(el('h2', '', 'Share as a Short'), label, note, status, row);
  panel.append(preview, side);
  back.append(panel);
  document.body.append(back);
  title.focus();
  title.select();

  const say = (text, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };
  // Closing the dialog while it uploads stops the upload (2026-11-08: Not now
  // closed it and the clip went up anyway, a Short nobody meant to share).
  let upload = null;
  const shut = () => {
    upload?.abort();
    back.remove();
    URL.revokeObjectURL(url);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('focus', onFocus);
  };
  const onKey = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      shut();
    }
  };
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', shut);
  back.addEventListener('click', e => { if (e.target === back) shut(); });

  let done = false;
  // Whether they are signed in is said as the dialog opens, not after a
  // title is typed and Share pressed; coming back from the sign-in tab
  // clears it without another click.
  let asked = false;
  const checkSignIn = async () => {
    if (done || upload || asked) return;
    asked = true;
    try {
      const ok = await api.ready();
      if (done || upload) return;
      signIn.hidden = ok;
      if (!ok) say('Sign in on bfstats.io first (it opens in a new tab), then come back here.', true);
      else if (status.classList.contains('bad')) say('Signed in. Press Share.');
    } catch { /* Share says what is wrong */ } finally {
      asked = false;
    }
  };
  const onFocus = () => { if (!signIn.hidden) checkSignIn(); };
  window.addEventListener('focus', onFocus);
  checkSignIn();
  share.addEventListener('click', async () => {
    if (done) return;
    const words = title.value.trim();
    if (!words) {
      say('Give it a title.', true);
      title.focus();
      return;
    }
    share.disabled = true;
    try {
      if (!(await api.ready())) {
        say('Sign in on bfstats.io (it opens in a new tab), then press Share again.', true);
        signIn.hidden = false;
        return;
      }
      say('Making its poster');
      const { jpeg, duration } = await posterOf(blob);
      const params = new URLSearchParams(location.search);
      const meta = {
        recordingSlug: shared.slug,
        killTime: Math.max(0, Number(clip.kill?.t ?? clip.t0) || 0),
        victimPid: Number.isInteger(clip.kill?.victim) ? clip.kill.victim : 0,
        kind: 'creator',
        title: words,
        killer: clip.killer ?? '',
        victim: clip.victim ?? '',
        weapon: '',
        distance: 0,
        lengthSeconds: Math.max(1, Math.round(duration * 10) / 10),
        level: clip.level ?? params.get('map') ?? '',
        mod: params.get('mod') ?? '',
      };
      say('Uploading');
      upload = new AbortController();
      close.textContent = 'Cancel upload';
      const made = await api.shareShort({
        video: blob, poster: jpeg, meta, signal: upload.signal,
        onProgress: k => say(`Uploading ${Math.round(k * 100)}%`),
      });
      upload = null;
      done = true;
      signIn.hidden = true;
      say('Shared. It is in the Shorts strip now.');
      share.remove();
      const watch = el('a', 'go', 'Watch it');
      watch.href = `${shared.base || ''}/play/index.html?tab=replay&short=${encodeURIComponent(made?.slug ?? '')}`;
      watch.target = '_blank';
      watch.rel = 'noopener';
      row.prepend(watch);
      close.textContent = 'Close';
    } catch (error) {
      upload = null;
      if (error?.aborted) return;
      close.textContent = 'Not now';
      console.warn('replay-share: sharing the clip', error);
      say(error?.message || 'Sharing failed.', true);
    } finally {
      if (!done) share.disabled = false;
    }
  });
  return { offered: true, why: null, close: shut };
}
