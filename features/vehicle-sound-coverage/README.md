# Vehicle sound coverage: four silent classes and one that honked

Reported 2026-09-21:

> 1. The machine gun fire sound for tanks sounds like a car horn.
> 2. There are no sounds at all for the Axis Panzer (do a general sweep here to
>    check we have sounds for all vehicles). Same issue for the Axis Hanomag.

Five defects, in three layers: two in `extract_map.py`'s vehicle-sound list, one
in its sample resolution, and two in `engine-audio.js`'s evaluation of a patch.
None of them is about the Axis.

**The horn was reported a third time on 2026-09-23 and is written up as D7 at the
bottom of this file. Read that first.** D4 and D5 below are both still correct and
both still in the tree; the horn came back through a route neither of them covers,
which is the point. D7 states the invariant all three share and replaces
route-by-route fixing with a guard on the invariant itself.

---

## D1 — the sound list was one mode and one team; the scene is neither

**What it looked like.** A vehicle with no engine note *and* no gun report —
completely dead — while the same vehicle on another map was fine. `map.html`
logged `no engine sound for PanzerIV`.

**Why.** The scene glb holds the **union over every game mode** of every vehicle
pad (`union_object_spawns`). The sound list was built from `info.spawn_objects`,
which is the *default* mode's spawners alone (`load_level` sets
`info.spawn_objects = info.modes[default].object_spawns`), and through
`spawn_vehicle`, which returns **one team's** template per spawner — team 2 by
preference. So two whole classes of vehicle were in the scene with no entry in
`scene.json`'s `sounds.vehicles`, and because `findWeaponSpecs` hangs the guns
off that same entry, `setupEngineAudio` returned before building either.

Surveyed by walking each `scene.glb`'s top-level `PlayerControlObject` nodes
(the same set `findAllVehicleRoots` gives the viewer) and comparing their
`extras.control` against that level's `sounds.vehicles`:

| tree | vehicles in the scene with no sound entry (before) |
|---|---|
| vanilla | 16 across 10 levels — PanzerIV@bocage, Hanomag+M3A1@stalingrad, Sherman+AA_Allies@iwo_jima, Tiger@berlin, T34@kharkov, Priest@market_garden, SBD@kasserine_pass, Chi-ha/Ho-Ha/BlackMedal/flak38@wake, AA_Allies@tobruk |
| xpack1 | 0 |
| xpack2 | 5 (all genuinely soundless templates — see the residual list) |
| eod | 85 |

**Fixed** in `extract_map.py`: `spawned_vehicle_templates(info)` walks every
mode's `object_spawns` and takes both halves of each spawner's `vehicles` map,
skipping the other half when `ownerTeam` locks the pad. Deduped
case-insensitively, with the old default-mode order kept as a prefix and the
additions appended, so an existing `scene.json` grows rather than being
reshuffled.

## D2 — `find_engine_script` stopped at the first `Engine`, not the first one with a script

**What it looked like.** EoD's transport helicopters — Loach, Mi4T, Mi8T — and
its SAM launchers had no engine note anywhere.

**Why.** `loadSoundScript` binds to a template, so the walk finds the vehicle's
`Engine` child and reads the script bound to *that name*. It stopped at the
first `Engine` it met. The Loach declares five (`LoachTailEngine`, two hover
engines, two dummies) and binds `Sounds/HueyEngine.ssc` to exactly one of them,
`LoachDummyEngine1`, which is not the one BFS reaches first — so the helicopter
reported as having no engine sound at all.

**Fixed**: the walk keeps going past an `Engine` that binds nothing. Order is
otherwise untouched, so a vehicle whose first `Engine` carries the script —
every vanilla one — resolves exactly as before. Verified: re-running the
sounds-only patch over all 23 vanilla levels after this change rewrote **zero**
bytes.

## D3 — a sample the level ships for itself was dropped in silence

**What it looked like.** Liberation of Caen's Pak40 anti-tank gun fired with no
muzzle blast; the first thing you heard was its reverb tail, 0.85 s later.

**Why.** `_sound_layers` drops a layer whose sample cannot be resolved, quietly.
It passed `None` where `resolve_sound` takes the level archive, so it only
searched the mod's shared `Sound*.rfa` — and Caen keeps `pak40fireST.wav` and
`pak40fire.wav` inside its own level archive. Two layers, gone.

Measured: the whole `Pak40Gun` patch rendered at **RMS 0.0000**; with the two
layers back, 16 layers and **RMS 0.1954**.

**Fixed**: `level_files` is threaded through `extract_vehicle_sounds` ->
`_sound_layers` -> `resolve_sound`, which is the order the engine itself
resolves a path and the order the ambient and area paths already used. Swept
across all 23 vanilla levels first: exactly 2 samples were being dropped, and
**0** whose level-local copy differs in payload from the shared one, so
consulting the level first cannot change any sample already published.

## D4 — `stereo` froze a layer's Distance channel at zero (**the car horn**)

**What it looked like.** A tank's coaxial machine gun as a low honking drone
rather than gunfire. Aircraft guns, on the same machinery, were fine.

**Why.** `mg42.ssc`'s Fire Loop is two loads of one 114 ms `MG42_fire.wav`: a
`stereo` near layer at `Volume <- Distance ramp 1/1/1/-1` (1 below a metre, 0
above) and a spatialised far layer at the exact complement, `1/1/0/1`. It is a
hard hand-over on one number, and **exactly one of them is meant to sound.**

`EngineAudio`'s constructor short-circuited `stereo` layers out of the group
bookkeeping entirely and handed each one a throwaway group frozen at
`distance: 0`. `stereo` is about *panning* — HRTF at 1.2 m is wrong when the
data says 2D — but the ramp still reads a real distance. Frozen at zero, the
near layer read "below a metre" wherever the listener actually was. At the
gunner's real 1.4 m **both halves ran at full gain**: two coherent copies of one
short buffer, +6 dB and flanging, out of one shared decoded buffer.

Looping a 114 ms sample already puts the whole spectrum into a harmonic comb at
8.8 Hz (MG42) or 7.7 Hz (Browning). Doubling it coherently is what turns that
comb into a pitch. **Aircraft escaped it** because their near/far split is at
4 m, not 1 m: the Spitfire's cockpit pair are two *different* samples of
different lengths (SFMG1 6.53 Hz, SFMG2 13.61 Hz — incommensurate combs that
smear each other) and its far pair correctly reads 0 below 4 m.

**Fixed**: a `stereo` layer gets a group like any other, keyed
`stereo:<offset>` so it never shares one with a spatialised layer at the same
offset, with `panner: null`. `update()` computes its distance and radial
velocity exactly as it does for a panner group; only `#placePanner` is skipped.

## D5 — `volume 10` was taken literally

**Why.** `Coaxial_Browning/Sounds/High.ssc` says `volume 10` on its near layer.
Across the 23 vanilla levels that is one of three authoring outliers: **5,458 of
5,484 layers are at or below 1**, and the 26 that are not are the Sherman's and
M10's coaxial Browning (25, at 10.0) and the KettenKrad's engine-start one-shot
(1, at 5.0). A 0..1 mixer scalar with a round "max it out" value in it.

Read literally it put that patch 20 dB hot: **pre-limiter peak 5.02, RMS 1.51**,
against 0.596/0.185 for the BAR measured in the same scene. That drove the
master limiter 14 dB into 20:1 limiting with a 3 ms attack, which flattens a
periodic 7.7 Hz comb into a squared-off drone — a honk on top of D4's honk.

**Fixed** in `engine-audio.js`: one voice never plays above unity. Clamped on
the *modulated* result, so a ramp that overshoots cannot get round it either,
and clamped at runtime rather than in the extractor deliberately — `volume 10`
is what the game's own script says, so the data stays faithful and every
already-published maps tree is fixed without a re-extraction.

## D6 (resilience) — the guns are not the engine's to lose

`setupEngineAudio` returned outright when the report had no entry for the
template, taking the guns with it. A gun patch is looked up by FireArms *node
name*, and the same `.ssc` is almost always extracted next to some other vehicle
on the same map that carries that gun. `setupEngineAudio` now falls back to
`findWeaponSpecsByFireArms` over the names it finds under the vehicle
(`listSeatFireArms`), so a map whose data is a re-extraction behind at least
still shoots audibly.

---

## The horn, measured

Two seconds of held fire through the real `EngineAudio` on a real
`AudioContext`, with the page's own limiter, master 0.7, `WEAPON_HEADROOM`
0.75, listener at the gunner's distance. `tonality` is the share of band energy
in the eight strongest narrow bins — a pure tone approaches 1, broadband noise
approaches 0.

| patch | peak | RMS | tonality | strongest partials |
|---|---|---|---|---|
| Sherman `Coaxial_browning` **before** | 1.336 | **0.429** | **1.226** | 31/38/40/45/47 Hz |
| Sherman, D5 fixed only | 0.902 | 0.224 | 0.837 | 31/40/45/47 Hz |
| Sherman `Coaxial_browning` **after** | 0.988 | **0.195** | **0.492** | 31/40/47 Hz |
| PanzerIV `Coaxial_MG42` **before** | 0.960 | 0.227 | 0.515 | 51/53/62/79 Hz |
| PanzerIV `Coaxial_MG42` **after** | 0.954 | 0.175 | 0.367 | 53/62/70/97 Hz |
| Spitfire `SpitfireGuns` (control, unchanged) | 0.857 | 0.249 | 0.497–0.573 | 148/152/163/166 Hz |
| BAR, hand weapon (prior measurement) | 0.596 | 0.185 | — | — |

The Sherman's coaxial Browning went from 2.3x the BAR's RMS and 2.5x the
known-good Spitfire's tonality to just under both. The PanzerIV's coax ends
*below* the control on both. The Spitfire measures the same before and after,
which is the point: the fix is a hand-over the data already asked for, and an
aircraft's data never asked for the broken one.

Ruled out along the way, with measurements:

* **MP3 encoder padding.** `MG42_fire.wav` is 5,025 frames at 44.1 kHz =
  0.113946 s; Chromium's `decodeAudioData` returns 5,469 frames at 48 kHz =
  0.1139375 s. Sample-exact to within half a frame — LAME's Xing header is being
  honoured, as `transcode_to_mp3`'s docstring claims. The loop period is right.
* **The gain gate flapping between rounds.** `guns.setFiring` is idempotent and
  `group.firing` stays true for as long as the trigger is held
  (`gunfire.js`), so the bus is not being re-gated per round.
* **playbackRate.** The MG layers carry no pitch modulator and `dopplerOff`;
  measured rates are 0.994–1.008, which is `randomStartPitch 0.01/0.01` alone.
* **Two patches un-gating at once.** The PanzerIV carries both `Coaxial_MG42`
  and a hull `MG42` off one sample, but the hull gun is not in the driver
  seat's `vehicleGuns` and its master stays 0 (measured).

---

## The sweep

Every vehicle template across the 23 vanilla levels, deduped, plus the
`--mod XPack2` land vehicles the vanilla set does not carry. Each engine patch
rendered for a second at `Default`/rpm 0 and 1, each gun patch for a second of
held fire, through the real `EngineAudio`, and reported as the RMS of the
listener's own output. A patch whose entry is missing, whose layers fail to
decode, or whose gain never leaves zero shows up as a zero.

58 vanilla templates: 45 with an engine patch, 86 gun patches. **One anomaly,
which was D3.** Full table below; the land vehicles the report asked about are
marked.

| template | engine layers | RMS idle | RMS full | gun patches (RMS) |
|---|---|---|---|---|
| sherman * | 11 | 0.1436 | 0.2192 | ShermanGunBarrel 0.412, Coaxial_browning 0.206, Browning 0.162 |
| m10 * | 14 | 0.1788 | 0.2275 | M10Cannon 0.411, Coaxial_browning 0.212 |
| panzeriv * | 12 | 0.1259 | 0.2175 | PanzerIVGunBarrel 0.399, Coaxial_MG42 0.172, MG42 0.148 |
| Tiger * | 14 | 0.1604 | 0.2440 | TigerGunBarrel 0.379, Coaxial_MG42 0.174 |
| T34 * | 13 | 0.2133 | 0.2402 | T34GunBarrel 0.413, Coaxial_MG42 0.176 |
| T34-85 * | 13 | 0.2166 | 0.2687 | T34-85GunBarrel 0.362, Coaxial_MG42 0.175, MG42 0.150 |
| chi-ha * | 11 | 0.2561 | 0.3262 | Chi-ha_GunBarrel 0.436, Coaxial_MG42 0.175, MG42 0.150 |
| Hanomag * | 10 | 0.1576 | 0.2332 | MG42 0.149 |
| M3A1 * | 10 | 0.1468 | 0.1971 | Browning 0.163 |
| Ho-Ha * | 10 | 0.1541 | 0.2351 | MG42 0.149 |
| Willy * | 7 | 0.1536 | 0.2148 | — |
| Kubelwagen * | 7 | 0.1620 | 0.3092 | — |
| Priest * | 12 | 0.1197 | 0.2344 | PriestCannon 0.335 |
| Wespe * | 12 | 0.1288 | 0.2465 | WespeCannon 0.363 |
| Sexton * | 12 | 0.1283 | 0.2432 | SextonCannon 0.336 |
| Katyusha * | 8 | 0.0959 | 0.1327 | — |
| Lynx * | 12 | 0.1289 | 0.2194 | LynxHorn 0.109 |
| BlackMedal * | 7 | 0.0964 | 0.1256 | BlackMedalHorn 0.111 |
| KettenKrad * (xpack2) | 7 | 0.1280 | 0.1807 | KettenkradHorn 0.155, MG42 0.149 |
| PAK40 | — | — | — | Pak40Gun **0.000 -> 0.195** (D3) |
| Spitfire | 12 | 0.1033 | 0.2957 | SpitfireGuns 0.246 |
| bf109 | 11 | 0.1553 | 0.1965 | BF109Guns 0.191 |
| stuka | 12 | 0.0929 | 0.2649 | StukaGuns 0.224, MG42_Air 0.150 |
| corsair | 11 | 0.0928 | 0.2283 | CorsairGuns 0.180 |
| zero | 12 | 0.0836 | 0.2605 | ZeroGuns 0.272 |
| mustang | 11 | 0.0904 | 0.2491 | MustangGuns 0.227 |
| yak9 | 11 | 0.0914 | 0.2360 | Yak9Guns 0.172 |
| Ilyushin | 12 | 0.0982 | 0.2991 | IlyushinGuns 0.184, Ilyushin_Rearguns 0.263 |
| sbd | 12 | 0.0987 | 0.3045 | SBDGuns 0.183, SBD-6_guns 0.264 |
| sbd-t | 12 | 0.0983 | 0.3070 | SBD-TGuns 0.183, SBD-T6_guns 0.263 |
| aichival | 11 | 0.1510 | 0.1876 | AichiValGuns 0.269, MG42_Air 0.150 |
| aichival-t | 11 | 0.1545 | 0.2127 | Aichival-TGuns 0.272, MG42_Air 0.151 |
| B17 | 4 | 0.0725 | 0.2258 | B17_MG1_FB 0.262, B17_MG2_FB 0.264 |
| Ju88A | 3 | 0.0724 | 0.2371 | Ju88A_NoseGunner_Gun 0.258, Ju88A_BellyGun 0.265, Ju88A_RearGunner_LeftGun 0.257 |
| yamato | 7 | 0.1316 | 0.1778 | YamatoMediumCannon 0.363, YamatoFatCannon 0.374, YamatoSmall1Cannon 0.215, YamatoSmall2Cannon 0.217 |
| princeow | 7 | 0.1470 | 0.1753 | PrinceOW_CannonPipes4 0.385, PrinceOW_CannonPipes2 0.364, AA_POW_GunBarrel2 0.217 |
| fletcher | 4 | 0.1495 | 0.1965 | fletcher_GunBarrel 0.365, Browning 0.162 |
| hatsuzuki | 4 | 0.1356 | 0.1862 | HatsuzukiGun 0.358, MG42_unlimited 0.150 |
| hatsuzuki2 | 4 | 0.1408 | 0.1821 | HatsuzukiGun 0.367, MG42_unlimited 0.150 |
| shokaku | 7 | 0.1204 | 0.1779 | Carrier_AA_GunBarrel 0.284 |
| enterprise / Hiryu / Hornet | — | — | — | Carrier_AA_GunBarrel 0.281 / 0.284 / 0.272 |
| elco80 | 7 | 0.1948 | 0.2523 | Elco80_Torpedos 0.164, FloatingMineLauncher 0.197, Elco80_SideGunner 0.162 |
| type38 | 7 | 0.1949 | 0.2617 | Type38_Torpedos 0.163, FloatingMineLauncher 0.198, Type38_Oerlikon 0.163 |
| Sub7c | 7 | 0.0716 | 0.1325 | — |
| lcvp | 7 | 0.3070 | 0.4223 | Browning 0.162 |
| daihatsu | 7 | 0.2293 | 0.3951 | MG42 0.149 |
| CDNRaft | 3 | 0.0827 | 0.0800 | — |
| Defgun | — | — | — | DefgunGunBarrel 0.386 |
| AA_allies | — | — | — | AA_Allies_GunBarrel 0.289 |
| flak38 | — | — | — | flak38_gun_fire 0.284 |
| Stationary_mg42 | — | — | — | MG42_unlimited 0.149 |
| Stationary_browning | — | — | — | Browning_unlimited 0.161 |
| 4x `*_RadarTower` | — | — | — | Radar_AA_Allies_GunBarrel 0.284–0.289 |
| sturmtiger (xpack2) | 14 | 0.1671 | 0.2270 | SturmTigerGunBarrel 0.367 |
| FlakPanzer (xpack2) | 12 | 0.1173 | 0.2238 | FlakPanzer_MG42 0.175, FlakPanzerGunBarrel 0.156 |
| r75 (xpack2) | 9 | 0.1297 | 0.1431 | R75Horn 0.106, MG42 0.150 |
| Schwimmwagen (xpack2) | 7 | 0.1641 | 0.3066 | MG42 0.149 |
| hd_xa42 (xpack2) | 7 | 0.1300 | 0.1792 | HarleyHorn 0.101, HDBrowning 0.160 |

A template with no engine row is a mount, a ship's AA battery or a building: no
`Engine` child, so no engine patch, which is what the data says.

### The `Default` channel on a tank

`engineControl` feeds `state.throttle` as the `Default`/`Engine::Rpm` channel,
and a NaN or a stuck zero there would mute every `Volume <- Default` layer.
Read live on Kursk, seated and idling:

| | bus | layers playing | layer gains | playbackRates |
|---|---|---|---|---|
| panzeriv | 0.700 | 10 of 12 | 1, 0.144, 0.217, 0, 0.093, … 0.81 | 0.4–1.0 |
| Hanomag | 0.700 | 8 of 10 | 1, 0.741, 0, 0.285, … 0.977 | 0.3–1.0 |
| Tiger | 0.700 | 12 of 14 | 1, 0.241, 0.169, … 0.96 | 0.2–1.0 |
| T34 | 0.700 | 12 of 13 | 1, 0.241, 0.241, … 0.942 | 0.19–1.0 |

No NaN, no all-zero stack, sane rates. The Hanomag's and PanzerIV's silence was
D1 alone.

### Seat templates with no entry of their own

Confirmed expected, not gaps: `*_PCO*`, `*Passanger*`, `*RearGunControl*`, a
ship's AA battery and the generic `vehicle` control. A nested seat is a
`PlayerControlObject` under another one, so `findAllVehicleRoots` never returns
it and `setupEngineAudio` is never asked about it; sitting in one goes through
`switchSeat` -> `collectMannedGuns`, and the **parent** vehicle's patches are
already built (`setupWeaponAudio` walks the whole `vehicle.node`, every seat's
FireArms included) and gated per seat by `firingGroupFor`. A bare furniture
mount with no drivetrain goes through `setupMannedWeaponAudio`, which is the
`findWeaponSpecsByFireArms` path; the sweep shows `MG42_unlimited` and
`Browning_unlimited` resolving that way at RMS 0.149/0.161.

### Residual: templates in a scene with no sound entry, after the fix

| tree | residual | why |
|---|---|---|
| vanilla | `Britain_Factory`, `Britain_Factory_AI` | no `Engine` child and no `FireArms` in the game data |
| xpack1 | none | |
| xpack2 | `Wasserfall` (x3), `RocketPlatform`, `ParatrooperSpawner` | same |
| eod | 27 across 239 levels: `SA2`, `eod_SA2_Bunker_1/2/3`, `Hawk`, `LogTrap`, `stebarrel3_m1`, `Britain_Factory` | same — EoD's SA2 and Hawk launchers bind no `loadSoundScript` at all (their `Weapons.con` sound-script table is empty) |

Each was checked template by template with `find_engine_script` and
`find_weapon_scripts`: all return nothing, so no entry is the correct output.

---

## Getting the fix into a 15 GB shared tree

`extract_map.py --sounds-only` recomputes **only** the `sounds.vehicles` key of
an already-published `<out>/<level>/scene.json`, writing any newly needed samples
into the shared directory through the same `sample_writer` (lifted out of
`extract_sounds` for exactly this: one naming rule and one set of LAME settings,
or the dedupe stops holding). The glb is never opened; no other key is touched.

`json.dumps(json.loads(text), indent=2)` reproduces all 23 vanilla `scene.json`
byte for byte, so the rewrite is provably confined. Every level was staged into a
scratch tree first, diffed against the live file with the `sounds.vehicles` key
removed from both, and only then applied — the apply step re-checks that
invariant and refuses a level whose live file has changed outside that key.
Backups of every file touched are in the session scratch directory.

| tree | scene.json rewritten | of | new samples |
|---|---|---|---|
| vanilla | 18 | 23 | 2 (`pak40fire.mp3`, `pak40fireST.mp3`) |
| xpack1 | 6 | 6 | 0 |
| xpack2 | 8 | 9 | 4 (`flettner_engine.mp3`, `flettner_engine2.mp3`, `v_mortar_fire1_mono.mp3`, `w_svd_fire_mono2.mp3`) |
| eod | 217 | 239 | 31 |

249 `scene.json` in total, and 37 new `.mp3` under the three
`_shared/sounds/` directories. Verified afterwards: not one of the 249 differs
from its backup outside `sounds.vehicles`.

Nothing was published to the cluster.

---

## Verified / tests

* `tests/test_map_sounds.py` — `SpawnedVehicleListTests` (the mode union, both
  teams, the `ownerTeam` exception, order stability, case-insensitive dedupe),
  `EngineScriptWalkTests` (walk past an `Engine` that binds nothing; the first
  one with a script still wins), `LevelLocalSampleTests` (the level archive is
  searched; a genuinely absent sample still drops the layer).
* `tests/test_engine_audio_default.mjs` (run by `tests/test_engine_audio.py`) —
  the near/far hand-over on a real distance with `stereo` included, a stereo
  layer still gets no panner, and the unity clamp on both an authored `volume 10`
  and a modulator overshoot, with sub-unity volumes untouched.
* Full suite: `python3 -m unittest discover tests` — 2,071 tests, OK.

### A note on driving this headless

`requestAnimationFrame` in headless Chromium runs at about **2 Hz** (measured),
so `map.html`'s whole simulation — the input word, the fire dispatch,
`updateAudio`'s gain gate — effectively does not run, while the Web Audio graph
keeps rendering on its own thread. Shimming rAF onto a timer gets frames back,
but the world's fire loop still never latches: `world.step` consumes one
buffered input word per 30 Hz tick, and a frame longer than 33 ms runs several
ticks, the later ones against the engine's zeroed idle word, so
`guns.setFiring(group, false)` ends every frame. `group.firing` therefore reads
false and `shots` stays 0 no matter how the trigger is held. That is why the
audible half of the sweep is measured by building the real `EngineAudio` from the
shipped layer data on a bare page and tapping the listener, rather than by
holding a trigger in `map.html`.

The same arithmetic meant a **real** machine running below about 30 fps ended
each frame with `group.firing` false, so a vehicle gun's *looping* patches (every
MG) stuttered with the trigger held. **Fixed 2026-09-21**, in `world.js`
`#consume`: the page's un-sequenced word is the frame's device state, so it is
held for every tick of the `step()` it was fed for (the client's own law --
`InputManager::update` 0x0049cff7 samples once for `nTicks`, and
`mouse-input.js` divides the counts by `nTicks / 30` expecting each tick to
apply the axis). A sequenced packet is still never replayed, and a step the
page fed nothing for still idles. Every channel of the word is a level, so
nothing in it needed consuming once; the jump press edge is derived inside
`soldier.js`, which is why the old idle word also turned a held jump into a
hop per frame. The room wire sends one word per tick run, for the same reason.

Measured on Kursk, T-34 coax (`Coaxial_MG42`, 12 rps, two looping layers),
trigger held for one simulated second through `__setSeatFire(false, true)` and
`__renderOnce(w, h, dt)` -- the third argument is new, the frame time to
simulate:

| frame rate | before: frames `firing` / gate open / rounds | after |
| --- | --- | --- |
| 60 fps | 59 of 60 / 59 / 13 | 60 of 60 / 60 / 13 |
| 30 fps | 30 of 30 / 30 / 13 | 30 of 30 / 30 / 13 |
| 15 fps | **0 of 15 / 0 / 12** | 15 of 15 / 15 / 13 |
| 10 fps | **0 of 10 / 0 / 10** | 10 of 10 / 10 / 13 |

The throttle was dropped on the same ticks (a T-34 held on W for 2 s now
reaches 9.44 / 9.46 / 9.46 m/s at 60 / 15 / 10 fps). On-foot fire was never
affected: the page latches `guns.setFiring` itself once a frame and the world
never touches a hand weapon's group (DP, 10 rounds a second at 60 and 15 fps
alike). Note that a headless run has to spawn before `__enterOwner` -- the
local player only joins the world at deploy, and a mount with no player is a
silent no-op. Pinned by `tests/test_world_held_input.py`
(`world_held_input_harness.mjs`).

## The ammo box that never stopped reloading (2026-09-21)

`discover_level_sounds` harvests `loadSoundScript` out of static objects as
building ambience, and a SupplyDepot's script is not ambience: it is the *give*
sound, `Ammorefill.wav`, heard while the depot hands over ammunition. It shipped
as a for-ever loop beside all 621 vanilla ammo boxes and airfield depots.
`_find_template_sound_script` now skips a script bound to a `SupplyDepot`, and —
so published scene.json files are right without a re-extract — `setupSounds`
pulls any single-point `*_static` area standing on a SupplyDepot node out of the
ambient pool and keeps its sample as `supplyGive`. `supplyTarget.refillAmmo`
plays one pass of it only when the held weapon was actually owed something, and
never over a pass still sounding. Vehicles re-arming at an airfield depot do not
play it yet (the viewer has no vehicle re-arm at all). `barbwire1` is exported
the same way — 553 loops — and is probably a touch sound too; left alone until
someone confirms what the game does.

---

# D7 — the horn came back a third time (2026-09-23)

Reported again, same words: *the machine gun sounds on a tank sound like a car
horn.* D4 and D5 were both still in the tree and both still correct. The horn
was a third, independent route to the same acoustic event.

## The invariant that should have been written down the first time

> **No two voices of a patch may sound at once out of the same sample, at the
> same point in space, at the same playback rate.**

D4 was one way to break it, D5 made it audible, and D7 is a third way. Each fix
closed its own route and the bug came back through the next one, because each
fix was a patch to a *cause* and the defect is a *consequence*. `engine-audio.js`
now arbitrates the consequence — see `#resolveCoherent` — and the routes stop
mattering.

## Why coherent doubling is a horn and not just "louder"

`#play` starts a loop at a random point in its own buffer (that line is
deliberate: it is what stops two Corsairs locking together). So two copies of
one sample at one rate do not add to +6 dB — they sit at a **fixed random phase
offset for as long as both run**, which is a static comb filter across the whole
spectrum. A 114 ms loop is already a harmonic comb at 8.8 Hz; combing it again
at a fixed offset turns texture into pitch, and the page's limiter then pumps at
the comb period and squares it off.

The random offset is also why this bug is so slippery. Ten renders of the *same*
Sherman coax patch at the *same* distance, unarbitrated, measure tonality
**57.1..81.4**. Some sessions honk; some do not. "It's back" and "I can't
reproduce it" were both true.

## The data, from the game's own script

`Objects/Stationary_Weapons/Coaxial_Browning/Sounds/High.ssc`, Fire Loop patch —
read out of `Objects.rfa`, not inferred:

```
load @ROOT/Sound/@RTD/brownmlp.wav      load @ROOT/Sound/@RTD/brownmlp.wav
loop  stereo  volume 10                 loop
minDistance 2                           minDistance 6
relativePosition -1/0/1                 relativePosition -1/0/1
priority 10                             priority 8
Volume <- Distance Ramp 2 2 1 -1        Volume <- Distance Ramp 1 1 0 1
     (1 below 2 m, 0 above)                  (0 below 1 m, 1 above)
                                        Volume <- Distance Ramp 130 150 1 -1
```

The two ramps are **not** complements. Below 1 m and above 2 m exactly one is
up; **between 1 m and 2 m both are at full**, one sample, one point, no
`randomStartPitch`, `dopplerOff` — identical playback rate, measured 1.0000 /
1.0000. The driver's camera sits 1.4 m from the coax node, i.e. inside the
window, every time you fire it.

D4's note reads the MG42's pair as a complementary hand-over and it is; the
Browning's is not, and nobody checked the second one. 172 of 981 vanilla `.ssc`
patches load one sample twice at one offset, so this shape is the house idiom
for every automatic weapon, not an oddity of one file.

## The fix

`EngineAudio` builds a list of **twin sets** once, in the constructor: voices
sharing one sample file and one offset. Keyed on the *offset*, not on the group
object, because the `stereo` half and the spatialised half of a hand-over
deliberately live in separate groups (D4) — they are the pair that honks, so
they have to meet. Nearly every patch ends up with an empty list and pays
nothing.

Per frame, between the modulate pass and the trigger/ramp pass,
`#resolveCoherent` zeroes every voice that would sum coherently with a louder
twin. Two things make it narrow enough to be safe:

* **Rate.** Only voices at the same playback rate contest, within 0.4%. Stacking
  one sample at *different* pitches is how Refractor builds a rich engine — the
  Willy runs two loads of `WillyHiRPM2` at 0.40 and 0.875, the T34 two of
  `t34eng2` 0.9% apart — and detuned copies beat and smear each other instead of
  combing. That is the authored sound and it survives untouched.
* **Priority.** The winner is the one the script itself nominates. `priority` is
  the only word a `.ssc` has for arbitration, and the Browning says 10 for the
  near half against 8 for the far. Then loudness, then declaration order, so a
  set of equals resolves identically every frame and the arbitration is never
  itself a source of flutter.

It runs *before* the `trigger Volume` gate, so a one-shot that loses never spends
its latch on a round nobody hears; and a voice zeroed by arbitration does not
re-arm that latch, or it would fire again the moment its twin walked out of range.

## Measured

Real `EngineAudio`, real shipped layers, real `AudioContext`, the page's own
limiter, master 0.7, `WEAPON_HEADROOM` 0.75 — ten renders per row, Sherman
`Coaxial_browning` on Aberdeen. `tonality` is the share of band energy in the
eight strongest bins, scaled so a flat spectrum reads 1.

| listener | | tonality (10 renders) | RMS | peak |
|---|---|---|---|---|
| 1.4 m, inside the overlap | before | **57.1 .. 81.4** (mean 70.5) | 0.211..0.244 | 0.716..0.801 |
| 1.4 m, inside the overlap | after | **61.6 .. 62.9** (mean 62.2) | 0.182..0.184 | 0.611 |
| 8 m, outside it | before | 62.6 .. 63.4 | 0.118..0.120 | 0.530 |
| 8 m, outside it | after | 62.6 .. 63.7 | 0.118..0.119 | 0.530 |

Three things to read off it. The spread collapses from 24 points to 1.3 — the
comb is gone, not averaged. The arbitrated figure at 1.4 m lands on the 8 m
baseline, which is the same patch with one layer up, i.e. what it should have
sounded like all along. And outside the overlap nothing changes at all, before
or after, which is the proof that the fix touches only the window it is for.

Pre-limiter the doubling is +2.1 to +2.6 dB rather than +6 — coherent-with-random-
offset, not coherent-in-phase — and the limiter then turns that into the tonality
jump. Both halves of the D5 story, again.

## Measuring it next time

```bash
node tools/bf1942-models/tests/sound_coherence_measure.cjs [level] [template] [fireArms] [metres]
```

Renders the named patch offline through the page's own limiter with the
arbitration on and off, ten times each. **Read the spread, not the figure**; and
compare a distance inside the suspected band against one well outside it, which
is the patch's own control. `tests/sound_coherence_rig.html` is the page it
drives; `arbitrate: false` is exactly the pre-fix behaviour.

The "driving this headless" note above still applies — `map.html` itself cannot
be measured this way, which is why the rig builds `EngineAudio` on a bare page.

## Verified / tests

* `tests/test_engine_audio_default.mjs`, new section — the Browning's authored
  ramps swept at 13 distances (no doubling anywhere, and no hole at the
  hand-over either); the Willy and T34 detunes surviving; a 0.1% "detune"
  correctly treated as a duplicate; two different samples at one point and one
  sample at two points both left alone; the `stereo`/panned pair still meeting;
  the three tie-breaks; and a losing one-shot keeping its latch.
* The same file sweeps **every extracted level's shipped layer data** at 24
  distances (and three rpm values for engines) for the fingerprint. It skips
  when `viewer/maps` is absent, and swept 23 levels clean here.
* Removing `#resolveCoherent` fails the suite loudly; the full Python suite is
  2,698 tests, OK.

Not affected, and checked: hand weapons. `models/sounds/weapons.json` picks a
**single** `fireLoop` sample per weapon rather than the near/far pair, and
`map.html` already clamps its `volume` to unity — which is why the BAR was the
known-good control in D5 and still measures the same.
