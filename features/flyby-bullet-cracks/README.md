# Flyby bullet cracks

Status: built 2026-10-13. The code is on branch `claude/flyby-bullet-cracks`. The FHSW
data is regenerated in the shared checkout's `viewer/maps` tree, which is not in git, and
is not published yet. The viewer change reaches players with the next Jenkins build.
Vanilla, the packs and the other mods are not regenerated.

## What a player hears

A passing bullet cracks as it comes within 15 m of the listener. `Bullet_Heavy.ssc`
(`bulletair_heavy1..7`) gates each of seven one-shots on `Volume <- Distance` 10..15 m with
`trigger Volume`, and `randomPlay 1` picks one per round. A round made at the muzzle and
flying away never cracks: its `Time` gate has closed before the round is audible. That is
read from the script and SND-19, not heard in retail (see Open).

## What was wrong

1. `extract_effects.py` kept only a round's looping samples. Its docstring said "a bullet's
   seven passing cracks are not played". 154 FHSW rounds had no bundle, so `hasSound` was
   false and the viewer never asked for them.
2. The viewer already plays each round's own script while it flies: `round-launch.js`
   calls `effects.playSound(spec.template, mesh)`, which goes through `EffectAudio`. So the
   data was the only missing piece for the mod-shared rounds.
3. Three viewer gates would still have killed a passing round, because a round starts far
   from the listener and its crack comes later:
   - the inaudible-at-creation gate in `#playScript` dropped a play whose script was out of
     its distance ramp when it was made;
   - the pool's three slots per script were reused as soon as they were busy, so a burst
     orphaned the rounds nearest their crack;
   - the window-close rule disarmed a latch after the script's `hold` (0.325 s here), which
     is about when a round from 300 m reaches 15 m.
4. The P-40's round (`Incendiary_12,7x99_Projectile`) is defined in Adak's own archive. Its
   crack is in the level's `effects.sounds.json`, which FHSW never had: the pipeline's
   `effects` step writes only the mod-shared file. Per-level manifests come from
   `extract_effects.py --levels --sound-only`.

## Changes

- `tools/bf1942-models/extract_effects.py`: `flight_sample` (a loop, or a `trigger Volume`
  one-shot) replaces the loop-only filter in `build_sound_manifest`. A one-shot with no
  trigger is the launch report or a release clack, and stays with its weapon.
- `tools/bf1942-models/viewer/effect-audio.js`: `approachesListener`; a script's
  `approaches` flag is set only for `#flight` scripts with a distance-gated `trigger Volume`
  layer. For those scripts, `#playScript` skips the inaudible gate for a followed play, the
  pool holds eight slots (`INSTANCES_PER_SAMPLE`, SND-14), and a slot is owed until its
  crack (`Slot.owed`). A full pool drops the new round instead of stealing an owed slot.
  Slots grow synchronously once their buffers are cached (`#addSlot`), and the window-close
  disarm skips these scripts. Other scripts are unchanged.
- Tests: `tests/test_effects.py` `FlybyTests`; `tests/test_flyby_cracks.mjs` and its
  wrapper `tests/test_flyby_cracks.py`.
- Ledger row SND-36 and this folder's index line.

## Data

FHSW `_shared/effects.sounds.json`, against the 2026-10-12 copy:

- 236 round bundles added, none removed, no non-flight script changed.
- 8 flight scripts added, with 26 layers. Every one is a `trigger Volume` one-shot, and none
  loops.
- Silent entries 866 -> 630. The 236 moved to bundles.

Per-level manifests (`--levels --sound-only`):

- 10 of the 50 levels now have a manifest (none did before). Each row's `effectSounds` key
  points at it, and no other row key changed.
- Adak Island, Battle of Valirisk and Moscow Outskirts: all 141 of each level's
  level-declared rounds are bullets, and each now has a crack. The P-40's round is one of
  them.
- Midway (47 bundles), Wake Night (69) and Monster des Stahles (71 rocket and shell loops)
  gain level-declared effects that were silent before. These are not cracks. They come from
  the same extractor, and they are not in the flyby change's scope.
- 25 new samples in FHSW `_shared/sounds`, all for those effects (`expARM*`, `fire`,
  `rain`, `smokegren`, `waterfront1/2`). None is a crack sample.
- Nothing is published. The level manifests and the 25 samples are in the shared checkout's
  `viewer/maps` tree, not in git.

## Checks

- Python: 152 tests pass across `test_effects`, `test_flyby_cracks`, `test_effect_audio`,
  `test_effect_objects`, `test_extract_maps_all` and `test_engine_audio`.
- Node `test_flyby_cracks.mjs`:
  - one round from 100 m at 400 m/s cracks exactly once, opening within 15 m;
  - `randomPlay` picks a different one of the seven for each round;
  - a round 40 m off the listener never cracks;
  - six rounds fired one a frame give six cracks, and twelve give twelve.
- Node `test_effect_audio.mjs` still passes.
- Burst probe, not a test: 30 rounds a frame (900 a second) for 3 s gives 56 cracks, and the
  update costs 0.05 ms on average, 0.36 ms worst.
- Real data: Adak's P-40 round now has its seven crack layers.

## Open

- No retail capture of a passing round has been compared. The 15 m threshold, the muzzle
  silence and the clock starting at creation are inferred from the script and SND-19/33.
- The same extractor rule applies to vanilla and the packs, which have their own bullet
  scripts. They are not regenerated, so they still have no cracks.
- `mod_pipeline.py`'s `effects` step writes only the shared manifest. FHSW's level manifests
  need a `--levels --sound-only` step to be part of a rebuild. That file is another
  session's and is not changed here.
- 61 projectile scripts load `..\..\common\Sounds\Bullet_Heavy.ssc`, which does not resolve
  in the install (the pack's virtual folder). Those rounds stay silent; this matters only
  once their paths are settled.
- The data is not published. The viewer change needs a Jenkins build.

## 2026-10-17: what `trigger Volume` waits on, read in the client (FHX-13)

The "Open" item above, that a crack sounds whenever its round comes within the
Distance ramp, is overturned for any tree extracted with the flag below.
Ledger SND-37 has the addresses; in short:

- `trigger Volume` flags the Volume effect declared last above the line
  (0x00801380 -> 0x008017e0). It does not change the sample's kind.
- The sample waits while a flagged effect reads zero (0x00803c00, 0x00803400,
  0x00802820). On the first update they all read above zero it plays if its
  whole volume is above zero, and is spent either way (0x00802a40).
- Vanilla's `Objects/Common/Sounds/Projectile_High.ssc` (FH and FHSW load the
  same file) flags `Time` on `bulletair1` and `Distance` on `bulletair2..7`.
  Six picks of seven crack as the round first comes within 10 m, provided its
  75 ms gate is already open; the seventh cracks only if the round is within
  10 m as the gate opens (about 75 m from a 1000 m/s muzzle). A listener
  within about 75 m of the shooter hears no crack from the six.

The extractor now records the flag (`"trigger": true` on the modulator;
`bf42/level.py`, `extract_map._modulator_report`, `bf42/effects.sound_layers`)
and `engine-audio.js` applies the rule where it is present. Until a tree is
re-extracted its layers keep the older first-rise rule.

A bot's bullet, an instant ray, now flies its round's script too
(`passing-rounds.js`, from `bot-referee.js` `env.onRound`). Checked headless
on FHSW Battle_Of_Foy: bots in two lines 90 m apart, the camera in the target
line, default autoplay and one real click: one crack among 43 rounds flown;
lines 30 m apart gave none. `tests/test_sound_voice_rules.{py,mjs}`.

Still open: whether the client's sound update runs once a rendered frame or
once a 30 Hz tick, and whether it reads a round's interpolated position. At
1000 m/s a round moves 17 m a 60 Hz frame and 33 m a tick, against a 20 m
chord through the 10 m sphere, so the rate decides how many passes are
sampled inside it. The page samples once a frame.
