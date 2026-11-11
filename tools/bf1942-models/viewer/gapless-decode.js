// A sample decoded to exactly the frames its wav had, in every browser.
//
// The game's samples are wavs, played whole: the client reads the `fmt `
// and `data` chunks into memory (no `smpl` loop points, nothing trimmed or
// faded) and its mixer copies the data into a running DirectSound voice,
// wrapping a loop straight from the last byte back to byte 0 (client
// 0x00837b20, 0x008363b0; ledger SND-46). A wav authored to loop therefore
// loops as seamlessly as it was cut, and the jeep's are cut to: the step
// across `Willyengine3.wav`'s wrap is 0.0004 of full scale, under a tenth of
// its ordinary sample-to-sample step.
//
// The published trees carry those wavs as MP3 (`extract_map.py`
// `transcode_to_mp3`, features/mesh-mod-assets/audio-compression.md). An MP3
// is a whole number of 1152-sample frames, and the encoder adds silence at
// both ends: 576 samples of encoder delay before the signal and the rest of
// the last frame after it. The LAME/Xing header in the file's first frame
// records both counts, and Chromium and ffmpeg trim them, so there the
// decoded buffer is sample-exact. WebKit (Safari) does not: it hands back
// every frame, the signal 576 samples late and up to 1500 samples of silence
// at the end. `AudioBufferSourceNode.loop` wraps at the buffer's end, so
// each pass of a loop carried 30 to 50 ms of near-silence, a hard dip at the
// wrap: the owner's "the jeep's driving sound cuts back to the start"
// (features/world-vehicle-audio/loop-seam.md).
//
// `decodeGapless` reads the counts from the header before the browser takes
// the bytes, and cuts a buffer the browser left long down to the samples
// the encoder was given. A buffer already the right length (Chromium) is
// handed back untouched.

/** MPEG audio sample rates by version (0: 2.5, 2: 2, 3: 1) and index. */
const RATES = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

/**
 * The gapless counts of an MP3 written by LAME or ffmpeg's libmp3lame:
 * `{ sampleRate, channels, frames, samplesPerFrame, delay, padding, samples }`,
 * where `samples` is what the encoder was given (`frames * samplesPerFrame -
 * delay - padding`). `null` for anything that is not an MP3 with a Xing or
 * Info frame carrying a LAME extension (a wav, an Ogg, a bare MP3).
 *
 * @param {ArrayBuffer|Uint8Array} input
 */
export function mp3GaplessInfo(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let i = 0;
  // ID3v2: a 10-byte header, a syncsafe size, and a 10-byte footer if flagged.
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + ((b[5] & 0x10) ? 10 : 0);
  }
  // The first frame header within a few KB of where the tags end.
  const limit = Math.min(b.length - 4, i + 4096);
  while (i < limit && !(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0)) i++;
  if (i >= limit) return null;
  const version = (b[i + 1] >> 3) & 3;         // 0: 2.5, 1: reserved, 2: 2, 3: 1
  const layer = (b[i + 1] >> 1) & 3;           // 1: Layer III
  const rateIndex = (b[i + 2] >> 2) & 3;
  const mode = (b[i + 3] >> 6) & 3;            // 3: mono
  if (version === 1 || layer !== 1 || rateIndex === 3) return null;
  const mono = mode === 3;
  const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const x = i + 4 + sideInfo;
  if (x + 8 > b.length) return null;
  const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const flags = ((b[x + 4] << 24) | (b[x + 5] << 16) | (b[x + 6] << 8) | b[x + 7]) >>> 0;
  if (!(flags & 1)) return null;               // no frame count, no length
  let y = x + 8;
  const frames = ((b[y] << 24) | (b[y + 1] << 16) | (b[y + 2] << 8) | b[y + 3]) >>> 0;
  y += 4;
  if (flags & 2) y += 4;                       // byte count
  if (flags & 4) y += 100;                     // seek table
  if (flags & 8) y += 4;                       // quality
  // The LAME extension: a 9-byte encoder name ("LAME3.100", "Lavc63.1."),
  // and the 12-bit delay and padding 21 bytes in.
  if (y + 24 > b.length) return null;
  for (let k = 0; k < 4; k++) {
    const c = b[y + k];
    if (c < 0x20 || c > 0x7e) return null;
  }
  const delay = (b[y + 21] << 4) | (b[y + 22] >> 4);
  const padding = ((b[y + 22] & 0x0f) << 8) | b[y + 23];
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const samples = frames * samplesPerFrame - delay - padding;
  if (!(frames > 0) || samples <= 0) return null;
  return {
    sampleRate: RATES[version][rateIndex],
    channels: mono ? 1 : 2,
    frames, samplesPerFrame, delay, padding, samples,
  };
}

/**
 * Where the encoder's samples sit in a decoded buffer of `length` frames at
 * `rate`: `{ start, length }`, or `null` when the buffer is already the
 * encoder's length (to within a frame of resampling) or shorter than it.
 *
 * A decoder that ignores the header keeps the padding at the tail and some
 * or all of the delay at the head (WebKit keeps the 576 and drops its own
 * 529-sample decoder delay), so the head is what is left once the padding
 * and the signal are taken off: `length - samples - padding`.
 */
export function gaplessWindow(info, length, rate) {
  if (!info || !(length > 0) || !(rate > 0)) return null;
  const r = rate / info.sampleRate;
  const want = Math.round(info.samples * r);
  if (length <= want + Math.ceil(r)) return null;
  const head = Math.round(length - want - info.padding * r);
  const start = Math.min(Math.max(head, 0), length - want);
  return { start, length: want };
}

/**
 * `buffer` cut to the encoder's samples, or `buffer` itself when it needs no
 * cut (see `gaplessWindow`). `ctx` makes the new buffer.
 */
export function trimToGapless(ctx, buffer, info) {
  const cut = gaplessWindow(info, buffer?.length, buffer?.sampleRate);
  if (!cut) return buffer;
  const out = ctx.createBuffer(buffer.numberOfChannels, cut.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c).subarray(cut.start, cut.start + cut.length));
  }
  return out;
}

/**
 * `ctx.decodeAudioData(bytes)`, cut to the encoder's samples. The header is
 * read first because `decodeAudioData` detaches the ArrayBuffer it is given.
 */
export async function decodeGapless(ctx, bytes) {
  let info = null;
  try { info = mp3GaplessInfo(bytes); } catch (_) { info = null; }
  const buffer = await ctx.decodeAudioData(bytes);
  return info ? trimToGapless(ctx, buffer, info) : buffer;
}

/**
 * A stand-in for three's `AudioLoader` (`loadAsync(url)`) that decodes
 * through `decodeGapless`, for the page's loaders that take a URL (the
 * radio, the heartbeat loop). `context()` is the listener's context.
 */
export function gaplessAudioLoader(context) {
  return {
    async loadAsync(url) {
      const reply = await fetch(url);
      if (!reply.ok) throw new Error(`HTTP ${reply.status} for ${url}`);
      return decodeGapless(context(), await reply.arrayBuffer());
    },
  };
}
