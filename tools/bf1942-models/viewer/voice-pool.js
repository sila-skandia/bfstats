// The client's voice pool: how many sounds play at once, and which one a new
// sound takes when none is free (ledger SND-39, SND-44).
//
// `game.setChannels` is the size of the whole pool (`DAT_00a8fcd8`, built by
// 0x007fb640). Of `c` channels, `reserve2dMonoChans` (4) are mono 2D voices,
// `reserve2dStereoChans` (2) stereo 2D voices and the rest 3D voices: 26 at
// `SoundHigh.con`'s 32.
//
// A sample instance that starts asks 0x007fbdd0 for a voice of its kind (3D
// when the buffer's `+0x28` is set, else stereo 2D when `+0x30` is, else mono
// 2D):
//
//  1. A free voice of that kind is taken (the free list, 0x00a8fd5c).
//  2. With none free, the candidate is the FIRST busy voice of that kind in
//     the busy list (0x00a8fd88; 0x007fbe80..0x007fbeab stops at the first
//     match). A voice joins the back of that list when it starts
//     (0x004fdec0), so the candidate is the voice that has played longest.
//  3. A 2D candidate is taken outright (0x007fbeb2: only kind 1 is compared).
//  4. A 3D candidate is compared by `priority` (the `.ssc` word, instance
//     `+0x4c`, vt+0x44 0x007fed00): an asker with less gets no voice
//     (0x007fbecb), one with more takes it (0x007fbed1). Equal, by distance
//     to the listener (instance `+0x2c`, vt+0x6c 0x007fee00, written from
//     0x008003e0: the length of listener position less voice position): the
//     candidate is taken only when it is strictly FARTHER than the asker
//     (`fcomp` at 0x007fbeea with `test ah,0x41; jnp` skipping on candidate
//     <= asker).
//  5. A taken voice's sound is stopped (vt+0x58, 0x007fea80).
//
// Nothing looks past the one candidate: a loud near sound at the head of the
// list keeps its voice against an equal asker even when a fainter one plays
// behind it. Each update the pool sorts its voices back into the two lists by
// whether their buffer still plays (0x007fc040), which is how a finished
// one-shot's voice comes free.
//
// A looping sample asks again on every update while its volume is above zero
// (0x00802a40: `+0xc`, the loop flag, sends it to the start at 0x008022a0), so
// a loop that lost its voice or never got one comes back when one frees. A
// one-shot asks once.
//
// One pool per AudioContext. Imports nothing; the tests run it under node.

/** `SoundHigh.con`: `game.setChannels 32`. */
export const DEFAULT_CHANNELS = 32;
/** `Settings/Default.con`: `Sound.reserve2dMonoChans 4/4/4`. */
export const RESERVED_MONO = 4;
/** `Settings/Default.con`: `Sound.reserve2dStereoChans 2/2/2`. */
export const RESERVED_STEREO = 2;

export const KIND_3D = '3d';
export const KIND_MONO = 'mono';
export const KIND_STEREO = 'stereo';

/** The voice kind of a play: positional, else by the buffer's channels. */
export function voiceKind(positional, channels = 1) {
  if (positional) return KIND_3D;
  return channels >= 2 ? KIND_STEREO : KIND_MONO;
}

/** The three sizes a pool of `channels` splits into. */
export function poolSizes(channels = DEFAULT_CHANNELS) {
  const c = Math.max(1, Math.trunc(Number(channels)) || DEFAULT_CHANNELS);
  const mono = Math.min(RESERVED_MONO, c);
  const stereo = Math.min(RESERVED_STEREO, c - mono);
  return { [KIND_MONO]: mono, [KIND_STEREO]: stereo, [KIND_3D]: c - mono - stereo };
}

export class VoicePool {
  constructor(channels = DEFAULT_CHANNELS) {
    this.busy = [];          // oldest first: the busy list
    this.stolen = 0;
    this.refused = 0;
    this.granted = 0;
    this.setChannels(channels);
  }

  /** `game.setChannels`. Voices already playing keep playing. */
  setChannels(channels) {
    this.channels = Math.max(1, Math.trunc(Number(channels)) || DEFAULT_CHANNELS);
    this.sizes = poolSizes(this.channels);
  }

  /** Busy voices of `kind`. */
  count(kind) {
    let n = 0;
    for (const v of this.busy) if (v.kind === kind) n += 1;
    return n;
  }

  /**
   * A voice for a play that starts now, or null when the pool refuses it.
   *
   * `ask`: `{ kind, priority, distance, stop }`. `stop()` is called when a
   * later play takes this voice; the holder must go quiet and must not call
   * `release` for it (the pool already has). `distance` may be a number or a
   * function answering the voice's distance to the listener now.
   */
  claim(ask) {
    const kind = ask.kind ?? KIND_3D;
    if (this.count(kind) >= (this.sizes[kind] ?? 0)) {
      const at = this.busy.findIndex(v => v.kind === kind);
      if (at < 0) { this.refused += 1; return null; }
      const candidate = this.busy[at];
      if (kind === KIND_3D) {
        const mine = ask.priority ?? 0, theirs = candidate.priority ?? 0;
        if (mine < theirs
            || (mine === theirs && !(distanceOf(candidate) > distanceOf(ask)))) {
          this.refused += 1;
          return null;
        }
      }
      this.busy.splice(at, 1);
      this.stolen += 1;
      try { candidate.stop?.(); } catch (_) {}
    }
    const voice = { kind, priority: ask.priority ?? 0, distance: ask.distance ?? 0,
                    stop: ask.stop ?? null };
    this.busy.push(voice);
    this.granted += 1;
    return voice;
  }

  /** The play ended or was stopped by its owner. */
  release(voice) {
    if (!voice) return;
    const at = this.busy.indexOf(voice);
    if (at >= 0) this.busy.splice(at, 1);
  }

  /** For the page's readout and the headless checks. */
  stats() {
    return {
      channels: this.channels,
      sizes: { ...this.sizes },
      busy: { [KIND_3D]: this.count(KIND_3D), [KIND_MONO]: this.count(KIND_MONO),
              [KIND_STEREO]: this.count(KIND_STEREO) },
      granted: this.granted, stolen: this.stolen, refused: this.refused,
    };
  }
}

function distanceOf(v) {
  const d = typeof v.distance === 'function' ? v.distance() : v.distance;
  return Number.isFinite(d) ? d : 0;
}

const pools = new WeakMap();
let fallback = null;

/** The pool of an AudioContext (one mixer, one pool). */
export function voicePoolOf(ctx) {
  if (!ctx || typeof ctx !== 'object') return (fallback ??= new VoicePool());
  let pool = pools.get(ctx);
  if (!pool) {
    pool = new VoicePool(wantedChannels ?? DEFAULT_CHANNELS);
    pools.set(ctx, pool);
    known.add(new WeakRef(pool));
  }
  return pool;
}

let wantedChannels = null;
const known = new Set();

/** OPTIONS > SOUND > CHANNELS, for every pool there is and will be. Null is
 *  the default. */
export function setVoiceChannels(channels) {
  wantedChannels = channels == null ? null : Math.max(1, Math.trunc(Number(channels)) || DEFAULT_CHANNELS);
  for (const ref of known) {
    const pool = ref.deref();
    if (!pool) { known.delete(ref); continue; }
    pool.setChannels(wantedChannels ?? DEFAULT_CHANNELS);
  }
}
