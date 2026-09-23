// The hand weapon's report: the per-round one-shots and the Fire Loop, on one
// shared bus, from `models/sounds/weapons.json`. Owns the manifest promise,
// the bus and the loop voice. Lifted out of hand-weapon.js
// (features/vehicle-instance-refactor).

import { WEAPON_HEADROOM } from './engine-audio.js';

/**
 * Built once by `createHandWeapon`. `page` is the narrow bag of getters it
 * builds, naming what this module reads:
 * `AUDIO_OFF`, `audioListener`, `bust`, `masterVolume`, `MODELS_BASE`,
 * `modelSoundBuffer`, `weaponToken`.
 */
export function createHandFireSound(page) {
  const sound = {};

  // --- the shot it makes -------------------------------------------------------
  //
  // Per-round one-shots from `models/sounds/<Name>.mp3` — the fire sample
  // `extract_weapon_sounds.py` picked out of the weapon's own `.ssc`, with the
  // authored volume, pitch jitter and time gate riding alongside in
  // `weapons.json`. The vehicle guns hold a muted loop and gate it with gain
  // because their fire is authored as a loop patch on a vehicle that outlives
  // any burst; a hand weapon's round is an event, so each shot gets its own
  // BufferSource into one shared bus. Overlap comes free — a Thompson's 0.1 s
  // loop cycle at 700 rpm stacks instead of restarting, so rapid fire never
  // cuts its own tail off — and the bus follows the master volume from
  // updateAudio like every other voice on the page. Decodes go through the
  // shared cache, so the one-decode-per-wav rule holds here too.
  sound.weaponSoundsIndex = null;   // promise for models/sounds/weapons.json
  sound.handFireBus = null;         // every hand-shot voice sums here

  function weaponSoundsManifest() {
    if (!sound.weaponSoundsIndex) {
      sound.weaponSoundsIndex = fetch(`${page.MODELS_BASE}/sounds/weapons.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        // A fetch that lost its race with the page's own load storm must not
        // memoise silence for the rest of the session: drop the cached promise
        // so the next weapon — or the next shot, through `refetchHandFireSound`
        // — asks again. Only a manifest that actually arrived is kept.
        .then(doc => { if (!doc) sound.weaponSoundsIndex = null; return doc; });
    }
    return sound.weaponSoundsIndex;
  }

  /** Resolve + decode `name`'s fire sample; inert until a shot actually plays
   *  it. Takes the bare template name rather than `hw` so `loadHandWeapon` can
   *  fire this off *before* `hw` exists — see the call site's comment on why
   *  that ordering is the whole fix for a shot going silent right after spawn. */
  async function fetchHandFireSound(name) {
    if (page.AUDIO_OFF) return null;
    const manifest = await weaponSoundsManifest();
    const spec = manifest?.weapons?.[name];
    if (!spec) return null;   // a quiet weapon (binoculars), or a mod without the tree
    const buffer = await page.modelSoundBuffer(`sounds/${spec.file}`);
    return buffer ? { spec, buffer } : null;
  }

  /** One more try for a weapon whose report never landed, asked from the shot
   *  path. Once per weapon: a fetch is cheap, but a round is not the place to
   *  queue one every time the trigger falls. */
  function refetchHandFireSound(hw) {
    if (hw.fireRetry) return;
    hw.fireRetry = true;
    const token = page.weaponToken;
    fetchHandFireSound(hw.name).then(fire => {
      if (fire && page.weaponToken === token) hw.fire = fire;
    });
  }

  function ensureHandFireBus(ctx) {
    if (!sound.handFireBus) {
      sound.handFireBus = ctx.createGain();
      sound.handFireBus.gain.value = page.masterVolume() * WEAPON_HEADROOM;
      sound.handFireBus.connect(page.audioListener.getInput());
    }
    return sound.handFireBus;
  }

  // The active Fire Loop voice, for weapons whose .ssc marks the fire patch
  // `loop` + `stop FinishSample`: the engine starts the loop when the trigger
  // closes and, on release, lets the playing cycle run out rather than cutting
  // it. Web Audio spells FinishSample as `source.loop = false` mid-play — the
  // buffer is one authored cycle, so it ends exactly at the boundary.
  sound.handFireLoop = null;

  function startHandFireLoop(fire) {
    if (sound.handFireLoop || !fire || !page.audioListener || page.masterVolume() <= 0) return;
    const ctx = page.audioListener.context;
    const source = ctx.createBufferSource();
    source.buffer = fire.buffer;
    source.loop = true;
    // The script's own per-play jitter (`randomStartPitch 0.02/0.01` on the
    // distance layer); the close stereo layer plays straight.
    const gain = ctx.createGain();
    gain.gain.value = Math.min(fire.spec.volume ?? 1, 1);
    source.connect(gain);
    gain.connect(ensureHandFireBus(ctx));
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
      if (sound.handFireLoop && sound.handFireLoop.source === source) sound.handFireLoop = null;
    };
    try { source.start(); sound.handFireLoop = { source, gain }; } catch (_) {}
  }

  function releaseHandFireLoop() {
    // FinishSample: the cycle in flight completes, nothing is cut.
    if (sound.handFireLoop) sound.handFireLoop.source.loop = false;
    sound.handFireLoop = null;
  }

  function playHandFire(fire) {
    if (!fire || !page.audioListener || page.masterVolume() <= 0) return;
    const ctx = page.audioListener.context;
    // A context built before the first gesture starts suspended and stays that
    // way until something resumes it. Pulling a trigger is a gesture, and when
    // the listener was created by a load rather than by a click this is the
    // difference between an audible session and a silent one.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // A looped fire patch is trigger-held, not per-round: `onShot` only has to
    // make sure the loop is running.
    if (fire.spec.loop) {
      startHandFireLoop(fire);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = fire.buffer;
    // The same per-play jitter DICE puts on the loops, applied per shot: a
    // burst reads as many rounds rather than one report stuttering.
    const [up = 0, down = 0] = fire.spec.randomStartPitch || [];
    source.playbackRate.value = 1 + (Math.random() * (up + down) - down);
    const gain = ctx.createGain();
    // The M1's report is authored at volume 10 against the game mixer's own
    // headroom; Web Audio has none to give, so the manifest keeps the authored
    // number and the clamp lives here, next to the bus that motivates it.
    gain.gain.value = Math.min(fire.spec.volume ?? 1, 1);
    source.connect(gain);
    gain.connect(ensureHandFireBus(ctx));
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
    };
    // `delay` is the script's own `Volume <- Time` gate — the knife's swish
    // lands 0.4 s into the swing, and starting it early would un-author that.
    try { source.start(ctx.currentTime + (fire.spec.delay || 0)); } catch (_) {}
  }

  Object.assign(sound, {
    ensureHandFireBus,
    fetchHandFireSound,
    playHandFire,
    refetchHandFireSound,
    releaseHandFireLoop,
    weaponSoundsManifest,
  });
  return sound;
}
