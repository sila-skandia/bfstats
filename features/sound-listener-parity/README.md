# Sound: the listener, attached parts, and DirectSound's distance law (2026-09-25)

Owner's reports: (A) a bot's K98 or pistol sounds as if fired right next to you,
on foot or in a tank; (B) turning a tank's turret moves its engine from ear to
ear, which retail does not do.

## What the game does (ledger SND-1..SND-7)

- **SND-1** `ObjectTemplate.setAttachToListener <bool>`: a byte at
  `SimpleSoundTemplate +4` (the sound sub-object at template +0x28 in lnxded,
  +0x58 in the client). Setter/getter lnxded `0x081de9c0` / `0x081de9d0`, console
  binding `ConsoleClass144::executeObjectMethod` `0x081c9bf0`, `makeScript`
  writes `ObjectTemplate.setAttachToListener 1`.
- **SND-2** The gate, `SimpleObject::attachToListener()` (lnxded `0x081db610`,
  client `0x00536390`): the flag is set, AND the local human player
  (`PlayerManager+0x20`) has a vehicle (`+0x3c`), AND the nearest
  PlayerControlObject up the parent chain from his vehicle equals the nearest
  one up from this part (client helper `0x00406840`), AND his camera's
  `getViewMode()` is 3 or 0, i.e. Inside (CAM-1). So chase, front and fly-by
  views, nested passenger seats and outside observers are not attached.
- **SND-3** Consumers, every frame: `Engine::updateSound` (`0x0823e930` /
  client `0x0057e924`), `RotationalBundle::updateSound` (`0x081d8630` /
  `0x0057cd1e`), `FireArms::updateSound` (`0x0828cc10` / `0x0053a0fe`) call
  `sound->setAttachToListener(attachToListener())`. The client's sound object
  (vtable `0x008fd31c`) fans it out to each patch (`0x00947948`, slot 0x30) and
  each sample (`0x00947bb8`, slot 0x2c = `0x008020e0`, byte `+0xc0`).
- **SND-4** The sample's per-voice update `0x00802330`: attached, the voice is
  placed AT the listener (`listener->getPosition()`, `0x0080237a`), with
  `relativePosition` ignored; otherwise at the owner's world transform times
  `relativePosition` (`0x00802620`). The `.ssc` `Distance` control is always
  the true voice-to-listener distance (`0x00802950` -> `0x008028c0`).
- **SND-5** The listener is the local player's camera transform
  (`0x00537390`): position, orientation, and the camera root's velocity.
- **SND-6** DirectSound's distance law is live: each voice gets
  `SetMinDistance(1.0)` / `SetMaxDistance(1e9)` at init (`0x007fefee` /
  `0x007feffa`), a per-layer minimum distance every frame (`0x00802444`), and
  the listener's rolloff is 1.0 (`0x00663eb0`). Which layer field feeds it is
  inferred to be the `.ssc` `minDistance` (only distance word; offsets not joined).
- **SND-7** Data (vanilla / XPack1 / XPack2): 65 / 9 / 31 flags, all value 1.
  Every sound-bearing land-vehicle Engine carries it (19 / 4 / 22), no aircraft
  or ship Engine does, no FireArms does; tank turrets and gun bases mostly do.
  So a plane's engine still moves between the ears when the pilot looks round.

## Root cause and what changed

- **(A)** `WorldFire.update()` was never called by the page, and `play()` fell
  back to the shooter's own position as the listener: every bot round was
  measured from 0 m, so the near `stereo` layer (K98 `k98LR`, Colt `coltLR`)
  played at full gain in both ears and the far layers never sounded, at any
  range. Fixed: `page-audio.updateAudio` feeds the camera's world point and
  facing every frame; `play()` uses the tracked point (or the listener's world
  matrix), snaps panners and gains per round. `EngineAudio` now applies
  DirectSound's fall-off per voice (`distanceRolloff`, `ROLLOFF_FACTOR`).
- **(B)** `EngineAudio.setAttachedToListener()`: panners go dead ahead of the
  listener (equal in both ears), no fall-off, no doppler, ramps keep the true
  distance. `VehicleAudioRack._attached()` reproduces SND-2 from the page's seat
  (`listenerSeat`: hull, PCO id, `view.inside`) and each part's `control`.
  Today's `scene.json` has no flag, so an engine whose script sits under
  `Objects/Vehicles/Land/` attaches (SND-7; inferred for mods).
- Extractor: `ObjectTemplate.attach_to_listener` (`bf42/con.py`) and
  `attachToListener` on each engine and weapon entry (`extract_map.py`).
- Also: `VehicleAudioRack._listenerPos()` read the listener's local position (origin).

## Verification

- Live, before (`probe-a`, Berlin, frozen pre-fix viewer): K98 / Colt at 5, 50
  and 200 m, left / right / front, on foot and in a T-34: every round played
  only the near stereo layer with ramp distance 0 and the pool's listener unset;
  L/R balance identical for left and right shooters (K98 +4 dB right, the
  recording's own image; Colt 0 dB), same level at 5 m and 200 m.
- Chromium HRTF, mono noise: 0.564 per channel at 0 deg, 0.858 / 0.219 at 90 deg.
- Node suites: `test_world_fire.mjs` (a round measured from the listener before
  and after the first frame; fall-off applies), `test_vehicle_audio.mjs`
  (attached only for the listener's own hull and PCO, Inside; not chase, not a
  nested seat, not another hull, not a BF109), `test_engine_audio_default.mjs`,
  `test_effect_audio.mjs`: pass. Parser: 65 vanilla templates flagged.

## Open

- After-fix live measurements (probe-a / probe-b in the session scratch dir) not
  run: budget stop. The turret-traverse L/R before/after and the Bocage cockpit
  check are still owed.
- Replays play every recorded shot through the 2D `playHandFire`: route through
  `playWorldShot` at the muzzle. Remote humans have no shot sound (netcode P4).
- `EffectAudio` pooled impacts should pass `snap` like `WorldFire`.
- Turret traverse (`RotationalBundle`) sounds are not extracted, so SND-3's
  second consumer has nothing to act on yet.
- A unit test of the parser/extractor flag over synthetic con input.
- Re-extraction owed: `patch_scene.py --layer sounds --mod bf1942 --all`, the
  same for `XPack1` and `XPack2`, then `scripts/publish-mesh-delta.py maps --hash`.
  Until then the viewer derives the flag from the engine script path.
