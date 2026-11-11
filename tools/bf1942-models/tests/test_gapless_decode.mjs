// watches: tools/bf1942-models/viewer/*.js
/**
 * A looping sample wraps where its wav did, in every browser
 * (`viewer/gapless-decode.js`, features/world-vehicle-audio/loop-seam.md;
 * ledger SND-46).
 *
 * Owner's report, FHSW Tunis 1943: "the jeep plays a repeated driving sound,
 * and as the loop ends it cuts back to the start." The published samples are
 * MP3s whose LAME header records 576 samples of encoder delay and the last
 * frame's padding; WebKit decodes every frame and keeps both, so each pass of
 * `Willyengine3` carried 1876 samples (42.5 ms) of silence. Retail copies the
 * wav's data chunk straight round (client 0x008363b0) and has nothing to cut.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeGapless, gaplessAudioLoader, gaplessWindow, mp3GaplessInfo, trimToGapless,
} from '../viewer/gapless-decode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.join(here, '..', 'viewer');

/** The head of an MP3 as ffmpeg's libmp3lame writes it: an ID3v2 tag, then
 *  the Info/Xing frame with a LAME extension. */
function mp3Head({ id3 = 126, header = [0xff, 0xfb, 0x50, 0xc4], mono = true,
                   tag = 'Xing', frames, delay, padding, encoder = 'Lavc63.1.' } = {}) {
  const bytes = [];
  if (id3) {
    bytes.push(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, (id3 >> 7) & 0x7f, id3 & 0x7f);
    for (let i = 0; i < id3; i++) bytes.push(0);
  }
  bytes.push(...header);
  const version = (header[1] >> 3) & 3;
  const side = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  for (let i = 0; i < side; i++) bytes.push(0);
  for (const c of tag) bytes.push(c.charCodeAt(0));
  bytes.push(0, 0, 0, 0x0f);                                  // frames, bytes, toc, quality
  bytes.push((frames >>> 24) & 255, (frames >>> 16) & 255, (frames >>> 8) & 255, frames & 255);
  bytes.push(0, 0, 0x20, 0);                                  // byte count
  for (let i = 0; i < 100; i++) bytes.push(i);                // seek table
  bytes.push(0, 0, 0, 100);                                   // quality
  for (const c of encoder) bytes.push(c.charCodeAt(0));       // 9 bytes
  for (let i = 9; i < 21; i++) bytes.push(0);
  bytes.push(delay >> 4, ((delay & 15) << 4) | (padding >> 8), padding & 255);
  for (let i = 0; i < 64; i++) bytes.push(0);
  return new Uint8Array(bytes);
}

// 1. The header of the published `Willyengine3.mp3` (FHSW, 2026-11-11):
//    25 frames, delay 576, padding 1300, so the wav's 26924 samples.
const WILLY = { frames: 25, delay: 576, padding: 1300 };
{
  const info = mp3GaplessInfo(mp3Head(WILLY));
  assert.deepEqual(info, {
    sampleRate: 44100, channels: 1, frames: 25, samplesPerFrame: 1152,
    delay: 576, padding: 1300, samples: 26924,
  });
  // An ArrayBuffer as the page has it, and the `Info` spelling of a CBR file.
  assert.equal(mp3GaplessInfo(mp3Head(WILLY).buffer).samples, 26924);
  assert.equal(mp3GaplessInfo(mp3Head({ ...WILLY, tag: 'Info', id3: 0 })).samples, 26924);
  assert.equal(mp3GaplessInfo(mp3Head({ ...WILLY, encoder: 'LAME3.100' })).delay, 576);
}

// 2. MPEG-2 at 22.05 kHz (a 22 kHz master, `AMBIENT_RATES`): 576 a frame and
//    nine bytes of mono side info.
{
  const info = mp3GaplessInfo(mp3Head({ header: [0xff, 0xf3, 0x50, 0xc4], frames: 40, delay: 576, padding: 300 }));
  assert.equal(info.sampleRate, 22050);
  assert.equal(info.samplesPerFrame, 576);
  assert.equal(info.samples, 40 * 576 - 576 - 300);
  // Stereo MPEG-1: 32 bytes of side info.
  const st = mp3GaplessInfo(mp3Head({ header: [0xff, 0xfb, 0x90, 0x44], mono: false, frames: 10, delay: 576, padding: 100 }));
  assert.equal(st.channels, 2);
  assert.equal(st.sampleRate, 44100);
}

// 3. Anything else is left alone: a wav, a bare MP3, no frame count, no LAME
//    extension, an empty file.
{
  const wav = new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ');
  assert.equal(mp3GaplessInfo(wav), null);
  assert.equal(mp3GaplessInfo(new Uint8Array(0)), null);
  const bare = mp3Head(WILLY);
  const x = bare.indexOf(0x58);                               // the 'X' of Xing
  bare[x] = 0;
  assert.equal(mp3GaplessInfo(bare), null);
  const noLame = mp3Head({ ...WILLY, encoder: '\0\0\0\0\0\0\0\0\0' });
  assert.equal(mp3GaplessInfo(noLame), null);
}

// 4. The cut, measured on WebKit (2026-11-11): every frame kept, the signal
//    576 samples in. At the file's rate and at a Mac's 48 kHz.
{
  const info = mp3GaplessInfo(mp3Head(WILLY));
  assert.deepEqual(gaplessWindow(info, 28800, 44100), { start: 576, length: 26924 });
  const at48 = gaplessWindow(info, 31346, 48000);
  assert.equal(at48.length, 29305);
  assert.ok(Math.abs(at48.start - 576 * 48000 / 44100) <= 1, `48 kHz head ${at48.start}`);
  // Chromium's buffer is already the wav's length, give or take resampling.
  assert.equal(gaplessWindow(info, 26924, 44100), null);
  assert.equal(gaplessWindow(info, 29305, 48000), null);
  assert.equal(gaplessWindow(info, 29306, 48000), null);
  // A decoder that also kept the 1152 silent samples of the Info frame.
  assert.deepEqual(gaplessWindow(info, 28800 + 1152, 44100), { start: 576 + 1152, length: 26924 });
  // Shorter than the wav: nothing to cut from.
  assert.equal(gaplessWindow(info, 20000, 44100), null);
  assert.equal(gaplessWindow(null, 28800, 44100), null);
}

// 5. The cut buffer starts on the signal's first sample and ends on its last,
//    so a loop of it wraps from the wav's last sample to its first.
function stubBuffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: c => data[c],
  };
}
const stubCtx = {
  createBuffer: (channels, length, rate) => stubBuffer(channels, length, rate),
};
{
  const info = mp3GaplessInfo(mp3Head(WILLY));
  const decoded = stubBuffer(1, 28800, 44100);
  const ch = decoded.getChannelData(0);
  for (let i = 0; i < 26924; i++) ch[576 + i] = 0.25 + (i % 100) / 1000;
  const cut = trimToGapless(stubCtx, decoded, info);
  assert.equal(cut.length, 26924);
  assert.equal(cut.sampleRate, 44100);
  const out = cut.getChannelData(0);
  assert.equal(out[0], ch[576]);
  assert.equal(out[26923], ch[576 + 26923]);
  for (let i = 0; i < out.length; i++) assert.ok(out[i] >= 0.25, `silence left at ${i}`);
  // A right-length buffer comes back as itself.
  const exact = stubBuffer(1, 26924, 44100);
  assert.equal(trimToGapless(stubCtx, exact, info), exact);
}

// 6. `decodeGapless` reads the header before `decodeAudioData` takes the
//    bytes (which detaches them), and cuts what comes back.
{
  const bytes = mp3Head(WILLY).buffer;
  let seen = null;
  const ctx = {
    ...stubCtx,
    async decodeAudioData(b) { seen = b; return stubBuffer(1, 28800, 44100); },
  };
  const buffer = await decodeGapless(ctx, bytes);
  assert.equal(seen, bytes);
  assert.equal(buffer.length, 26924);
  // A wav is decoded as it is.
  const wavCtx = { ...stubCtx, decodeAudioData: async () => stubBuffer(1, 1000, 44100) };
  assert.equal((await decodeGapless(wavCtx, new TextEncoder().encode('RIFF....WAVE').buffer)).length, 1000);
}

// 7. The loader the radio and the heartbeat take.
{
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: url.endsWith('ok.mp3'), status: 404,
    arrayBuffer: async () => mp3Head(WILLY).buffer,
  });
  const ctx = { ...stubCtx, decodeAudioData: async () => stubBuffer(1, 28800, 44100) };
  try {
    const loader = gaplessAudioLoader(() => ctx);
    assert.equal((await loader.loadAsync('x/ok.mp3')).length, 26924);
    await assert.rejects(loader.loadAsync('x/missing.mp3'), /HTTP 404/);
  } finally {
    globalThis.fetch = saved;
  }
}

// 8. Every sample the page plays is decoded through it: the map page's one
//    decode and its URL loader. No other module decodes a game sample.
{
  const page = fs.readFileSync(path.join(viewer, 'page-audio.js'), 'utf8');
  assert.match(page, /return await decodeGapless\(ctx, bytes\)/);
  assert.match(page, /audioLoader = gaplessAudioLoader\(/);
  assert.doesNotMatch(page, /\.decodeAudioData\(/);
  assert.doesNotMatch(page, /new THREE\.AudioLoader\(/);
  for (const name of fs.readdirSync(viewer)) {
    if (!name.endsWith('.js') || name === 'gapless-decode.js' || name === 'replay-music.js') continue;
    const text = fs.readFileSync(path.join(viewer, name), 'utf8');
    assert.doesNotMatch(text, /decodeAudioData\(|new THREE\.AudioLoader\(/, name);
  }
}

console.log('gapless-decode: ok');
