# The retail sound options and the hardware path

Status: **built** (2026-11-01). OPTIONS > SOUND has one row, HARDWARE
ACCELERATION, off by default. Ticked, every placed voice is heard through an
HRTF head at its real point, the browser's stand-in for a Creative card's
hardware 3D buffers. Nothing else about the mix changes.

The question was whether the retail game's Creative sound path, with its
extra "Ultra" or EAX settings, can be emulated, and whether the replayer's
sound can be improved. The engine facts are ledger rows SND-40 to SND-44
(`features/bf1942-engine-reference/ledger.md`, "Sound options"). This page
records what was built on them and what is still open.

## What the game has

- **No EAX and no reverb (SND-40).** The 1.61 client contains no EAX property
  set, no `IKsPropertySet`, no I3DL2 set and no DirectSound effect GUID. Its
  only DirectSound import is `DirectSoundCreate8`. The sound menu has no
  environment row. The `.ssc` language does know the words `Reverb`,
  `Chorus`, `Echo` and the other DirectX 8 effect names as
  `controlDestination`s. No script in any installed mod uses them; every
  effect drives `Volume` or `Pitch`.
- **HARDWARE ACCELERATION (SND-41)** is `game.setHardware`. It makes every
  voice a DSBCAPS_LOCHARDWARE buffer instead of a LOCSOFTWARE one. It also
  sizes the pool from the card: the smaller of its free hardware 3D buffers
  and `Sound.setHardwareVoiceLimit` (32), less one. The game asks for
  DS3DALG_NO_VIRTUALIZATION, but DirectSound applies that to software buffers
  only. A hardware 3D buffer is placed by the card's own engine, which on a
  Sound Blaster Live! or Audigy was Creative's HRTF or speaker placement.
  So the "Creative path" was the card placing voices, with height, in place
  of Windows' flat stereo pan (SND-31). Every profile the game ships has the
  setting off.
- **QUALITY (SND-42)** picks the `@RTD` folder (`11kHz`, `22kHz` or `44kHz`)
  and the primary buffer's rate. HIGH is 44 kHz.
- **SOUND DETAIL (SND-43)** is the `#templateLevel` tier (LOW, MEDIUM or HIGH)
  every `.ssc` is read at. It also picks the 2D reserves.
- **CHANNELS (SND-44)** is the whole voice pool: 4 mono 2D, 2 stereo 2D and
  the rest 3D. That is 26 3D voices at `SoundHigh.con`'s 32 and 58 at the
  shipped profiles' 64.

The menu (`menu/SoundOptionsPage1` and `Page2` in `menu.rfa`) has nine rows.
Page 1: SOUND DETAIL, QUALITY (11 / 22 / 44 KHZ), MUSIC VOLUME, MUSIC,
MASTER VOLUME, DISABLE ALL SOUNDS. Page 2: ENGLISH DIALOG, CHANNELS, HARDWARE
ACCELERATION. The last is disabled unless `Options/Sound/HardwareSupport` is
set, which needs more than one free hardware 3D buffer.

## What the page does about it

The page already plays at the game's HIGH settings:

- every `.ssc` at `#templateLevel HIGH`;
- the 44 kHz master for every gun, vehicle, soldier and effect sample;
- a limiter on the master bus (`page-audio.js` `ensureListener`);
- DirectSound's software pan (SND-31).

None of the HIGH rows would change anything, so they are not drawn. The
built row is the one with something behind it.

- `viewer/ds3d-pan.js`: `setDs3dHardware(on)`. With the setting on,
  `configureDs3dPanner` gives every placed voice Web Audio's `HRTF` model, and
  `ds3dRenderPoint` returns the voice's real point instead of the level render
  point that reproduces DirectSound's amplitude pan. Panners already made are
  kept in a weak list and switched where they stand, so a change in the Escape
  menu reaches the voices already playing. `stereo` layers have no panner and
  are untouched, as on a card, where they were 2D voices.
- `viewer/sound-options.js`: the stored choice (`localStorage` key
  `bf42-sound-hardware`: `1`, `0` or absent), `chooseHardware3d` (`?hw3d=0|1`
  wins over the choice; off with neither), and the plate. The plate is the
  VIDEO screen's art moved to SoundMenu's place (250,125), with the heading
  SOUND OPTIONS and the tick box on the first line. DEFAULT and SAVE stand at
  SoundNavigation's 453 and 561.
- `viewer/play/controls-screen.js`: a third section, `sound`, beside CONTROLS
  and VIDEO. The SOUND button of `menu/OptionsNavigation` opens it on the
  front end's OPTIONS and in the Escape menu. A tick is kept at once, and
  DEFAULT forgets it.
- `viewer/map.html`: applies the choice before the page audio is built.

Departures, all opt-in: the HRTF is the browser's, not Creative's, and the
setting does not shrink the voice pool to 31, because the page has no pool.

### The rest of the record, and the console (2026-11-01)

`viewer/sound-options.js` now keeps the rest of the settings record the
`game.set*` words of `Sound.con` write (`localStorage` key `bf42-sound`,
JSON), and owns MASTER VOLUME and DISABLE ALL SOUNDS, which the side panel's
old box and slider used to own:

| field | word | on the page |
|---|---|---|
| masterVolume 0..100 | `game.setMasterVolume` | the `Default` volume group, the percentage times 0.01 (SND-28): `page-audio.js` `masterVolume()`, every voice. 70 with nothing stored, the page's level before (SoundHigh writes 75, the Default profile 100) |
| disableSound | `game.setDisableSound` | that gain at 0 |
| channels | `game.setChannels` | the effect sounds' voice budget, channels less the six 2D reserves (SND-44); unset, the level manifest's |
| soundDetail | `game.setSoundDetail` | kept; the scripts are read at HIGH (SND-43) |
| quality | `game.setQuality` | kept; the samples are the 44 kHz masters (SND-42) |

The side panel's box and slider (`show.dev 1`) are views of the record: they
show it and write it. `game.setHardware b` stores HARDWARE ACCELERATION and
switches the pan at once (SND-41).

The `Sound` object's words (SND-45):

- `Sound.dopplerFactor`: built. The client hands it to DirectSound's
  listener unchanged, so it is a multiple of the real world's shift (0 none,
  1 real, at most 10). The page's doppler is `engine-audio.js`'s, on the
  layers that do not say `dopplerOff` (vehicle engine loops, and the world's
  gunfire layers that keep it); the factor scales the radial speed it is made
  from (`ds3d-pan.js` `ds3dDopplerApplied`). The page's other voices are
  one-shots placed once and carry no velocity: the gunfire and blasts that
  matter set `dopplerOff` in the data anyway.
- `Sound.rolloffFactor`, `distanceFactor`: *Method is not active!*. They act on
  DirectSound's distance law, and a page voice's fall-off is its script's
  ramp with the panner's rolloff off (map-sounds.md).
- `Sound.showSoundInfo`: the page audio's own state under the console's
  readout (context, master, the pan path, the doppler factor, the effect
  voices against the budget). The client's lines are its DirectSound pool's.
- `Sound.drawSoundObjects`: *Method is not active!*; no one place on the page
  knows every live voice's position.

## Checked

- `tests/test_ds3d_pan.mjs` (through `test_ds3d_pan.py`): off by default.
  Set, a panner made earlier switches to HRTF, a new one is HRTF, and the
  render point is the real point with its height. Clearing the setting
  switches everything back. An engine patch's panner moves to the gun's own
  point on its next frame.
- `tests/test_controls_menu.py` `SoundTests`: the plate, heading, row, box,
  mark, DEFAULT and SAVE rects. A pack without the VIDEO page has no SOUND
  section. The stored choice reads and writes, and a blocked storage never
  throws. `?hw3d` beats the stored choice.
- Headless Chromium (Vulkan) on port 5321, `play/index.html?tab=options`:
  SOUND opens the plate, a click on the row stores `1`, the page's
  `ds3dHardware()` turns true at once, and DEFAULT clears the key.
- `map.html?mod=bf1942&map=el_alamein&hw3d=1` after a click: all 14 panners the
  page made were `HRTF`, and `setDs3dHardware(false)` turned all 14 to
  `equalpower` in place. With `hw3d=0` all 14 were `equalpower`.

## Open

- **Level ambience is extracted at 22 kHz** (`extract_map.py`
  `AMBIENT_RATES`), while the game at HIGH loads the 44 kHz master (SND-42).
  This covers the wind bed, area sounds and the capture voices. The comment
  there calls the difference inaudible at a distance; nobody has measured
  it. Changing it is a `sounds` layer change in every tree, and existing
  `_shared/sounds` files of the same name would need re-encoding. **Todo,
  parked (owner, 2026-11-01): not worth the cost for now.** Pick it up
  only alongside a full `sounds` layer re-run for some other reason.
- **No voice pool.** The game holds 26 3D voices at HIGH with 32 channels
  (58 with 64) and steals by priority (SND-39). The page plays every voice it
  makes. This matters only in dense fights.
- **What the `.ssc` effect destinations 3..11 do** (`Controller`, `Reverb`
  and the rest) is not read. No data uses them.
- **Reverb as a page option.** The game has none, so a room or environment
  reverb would be an invention, not an emulation. Creative's own control
  panel could add a global EAX environment to everything a Live! played. That
  is the likeliest source of a remembered "reverb" setting, and it was the
  card's, not the game's. If wanted, it belongs on this plate as a second,
  clearly non-retail row.
- Only 1.61 was read. A pre-1.6 client was not available.
- MUSIC VOLUME, MUSIC and ENGLISH DIALOG (`game.setMenuMusicVolume`,
  `setMusicOnOff`, `setLocalizedDialog`) have no row or word on the page yet.
