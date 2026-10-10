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
route-by-route fixing with a guard on the invariant itself. **D8 (2026-09-29) is
the fourth time: two patches rather than two layers of one, so D7's guard, which
runs inside a patch, never saw it. The guard now runs across the rack too.**

**D9 (2026-09-30) is not the horn: DC Final's guns, grenade launchers and forests,
and three engine rules the extractor had guessed at (ledger SND-12..15, SSC-6).**

**D11 (2026-10-06): a vehicle gun's release tails never reached the rack (the spec
lookups dropped them), and turrets, gear, flaps and tracks now sound by their own
classes' rules (ledger SND-18..SND-23).**

**D12 (2026-10-10): a round's own script plays for its flight. The bazooka's
rocket motor, a shell's whistle and a bomb's had never sounded.**

**D13 (2026-10-11): a rocket launcher with no script of its own was given its
round's motor loops as a fire sound. The Flettner roared a rocket motor at its
own cockpit for six seconds a missile (ledger SND-25).**

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

(Since 2026-09-24 `--sounds-only` is an alias for `patch_scene.py --layer
sounds`, which rebuilds the whole `sounds` block the same way; see
`features/level-bake-layers/README.md`.)

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

---

# D8 — the fourth time: two patches, not two layers (2026-09-29)

Reported watching the Bocage round (`replay_20260928-133433`): *the tank firing
its machine gun makes the car horn noise*, having sounded right an hour before.
D7's guard was in the tree and running. Nothing on the audio path had changed
that morning either; the hour was the random draw D7 describes.

## What D7 could not see

`#resolveCoherent` runs inside one `EngineAudio`, one patch. A hull is several:
the rack builds one patch per FireArms. The PanzerIV's coaxial MG42 (the
driver's alternate fire) and its cupola MG42 (seat 2, `PanzerIV_Browning_PCO1`)
each load `mg42.ssc`, so both play `MG42_fire`. With the driver and the cupola
gunner firing together, which this round's PanzerIV at the barn by the Axis
bridge base does at 3:04 (184 s) and again at 190 s, the two patches' loops summed
at a fixed random offset: the horn, from a route no patch could see. The
Sherman's coaxial and turret Brownings share `brownmlp` the same way, and so do
two hulls of one type.

D7 left "one sample at two points" alone on purpose, and inside a patch that is
still right: an authored spread starts its copies together. Between patches the
point stops mattering, because a Web Audio panner delays nothing. Two copies of
one loop keep their fixed random offset wherever they stand, and where they
stand only decides how much of each reaches each ear, which is how deep the comb
is.

## Found in the page, not argued

`map.html` does run headless for this after all: with the Vulkan flags
(`--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist`) the replay
page runs at about 30 fps, and `window.__vehicleAudio()` is the live rack. A probe
seeked to every MG burst in the round (176 bursts, the gunner's own view and the
orbit), read every sounding voice's real bus and node gain every 100 ms, and
listed pairs of one buffer at one rate. The commonest by far was the PanzerIV's
own pair, `Coaxial_MG42` x `MG42` (88 samples), then a PanzerIV's MG42s against a
`Stationary_mg42` beside it, then engines (two idling Kubelwagens on
`kblwgnngn2`, a Mustang's `prop` against a BF109's).

## Measured

`sound_coherence_measure.cjs` takes a `+`-joined pair now and adds a row for
yesterday's code ("each patch alone"). Both guns are stood at one point, ten
renders a row:

| pair, 16 m | unarbitrated | each patch alone (before) | arbitrated (after) |
|---|---|---|---|
| Sherman `Coaxial_browning+Browning` | 67.4..84.7 | **53.4..86.1** | **61.4..62.4** |
| PanzerIV `Coaxial_MG42+MG42` | 53.8..84.3 | 60.1..76.1 | 57.4..66.0 |

The Brownings are the clean case: `brownmlp` carries no `randomStartPitch`, so
the two are always at one rate and the spread of 33 points collapses to one. The
MG42 carries `randomStartPitch 0.01/0.01`, drawn once per loop, so two guns land
0..2% apart and only about a third of draws meet inside the tolerance. The rest
drift, which is what the arbitrated row's remaining spread is. Pinned to matched
rates in a separate rig, the pair measures 61.6..81.5 together against 73.0..73.7
for the coax alone.

The 0.4% line holds between patches as it does inside one. Swept on the same
pair (the coax alone: 72.9..73.7):

| apart | 0.0% | 0.2% | 0.3% | 0.4% | 0.5% | 0.8% | 1.0% |
|---|---|---|---|---|---|---|---|
| tonality | 73.1..81.5 | 64.2..80.7 | 59.8..75.4 | 55.0..68.6 | 60.6..64.2 | 54.4..64.6 | 54.3..61.2 |

From 0.4% on, the pair never reads more tonal than one gun: it smears (a
flanging drift, as the game's own `randomStartPitch` intends) rather than
holding a pitch.

In the page, on the replay's 182..192 s with both guns forced to one rate: the
share of 100 ms samples in which the weaker copy was at least 30% of the stronger
(a comb deep enough to hear) went from **48% to 4%**. The remainder are hand-overs:
the cupola's recorded rounds leave gaps of 0.27..0.73 s, its gate shuts and
reopens, and each change is a 50 ms-tau crossfade with both copies partly up.

## The fix

`EngineAudio.update` is now `evaluate` (panners, curves, the patch's own twins)
then `apply` (the `trigger Volume` gate and the ramps). The rack evaluates every
patch, runs `ssc-coherent.js` `resolveAcross` over all of them, then applies them
all. `resolveAcross`:

* **Loops only.** A one-shot starts at the head of its buffer, so two patches'
  shots are sample-aligned when they are one event and two events when they are
  not. Two tanks firing a second apart are two bangs.
* **One decoded buffer at one rate** (`COHERENT_RATE_TOL`), anywhere on the rack.
  The page decodes each file once, so buffer identity is the test.
* **Only what sounds.** A patch at master 0 (a gun nobody fires, a hull out of
  earshot) contests nothing; a silent loop must never mute a firing one. Voices a
  patch has already arbitrated away stay out, and a spread one patch authors at
  two offsets survives.
* **The loudest as heard wins** (script gain x fall-off x bus), with last frame's
  winner held until a rival is 25% (2 dB) louder, then patch order. Without the
  hold, two guns at one distance trade the voice as the camera moves, and every
  trade is a crossfade with both up. A copy 34 dB under its rival is left alone,
  as `COHERENT_FLOOR` leaves a quiet twin inside a patch.

It covers engines by the same rule: two idling Kubelwagens are one voice until
their revs part, which is when they stop combing.

## Verified / tests

* `tests/test_vehicle_audio.mjs`: the PanzerIV pair (two firing, one heard, one
  reported suppressed); a silent gun never muting a firing one; a 1% detune
  keeping both; the hold (4% louder does not take the voice, 3 dB does, and it
  then holds the same way); two guns' one-shots both heard; two Kubelwagens one
  voice at one rate and two at different revs. And a sweep of every extracted
  level's hulls, all guns firing at one point and the engine running, heard from
  0.3 to 60 m: no two audible loops of one file at one rate between patches, 279
  arbitrations across 23 levels (the sweep asserts it met twins, so it cannot
  pass empty). Taking `resolveAcross` out fails the first case.
* The D7 cases in `test_engine_audio_default.mjs` are unchanged and pass: the
  split is behaviour-neutral for every caller of `update`.

## Measuring it next time

```bash
node tools/bf1942-models/tests/sound_coherence_measure.cjs bocage sherman Coaxial_browning+Browning 16
```

For the page itself, drive the replay with the Vulkan flags and read the rack:
every built entry's `engineAudio` and `weapons[].audio`, each voice's
`source.playbackRate.value`, `gain.gain.value` times the patch's `bus.gain.value`,
and `suppressed`. Group by `voice.buffer`. Pin every loop's `jitter` to 1 first
if you want the worst case rather than the session's draw.

---

# D9 — guns whose Fire Loop loops nothing, and what `randomPlay` really picks (2026-09-30)

Reported by the DC sound audit: DC Final's MG42 (22 levels' `Stationary_mg42`
and the pintle guns of eleven hulls) played only its shell casings, the M2A3,
M6 Linebacker and BMP-2 cannons only `tigerrev`, and the CAR-15, M203,
AK47GP30 and Skorpion nothing at all; every tree on a DC Final forest level
sang the same bird; helicopters and jets shared one another's samples.

## The engine rules, read out of the client

All five are ledger rows with their addresses; this is what they say.

* **SND-13.** Every round a FireArms lets out triggers slot 0 (Fire) and slot 5
  (Fire Loop) of its script, whatever they hold (`FireArms::Fire`, lnxded
  `0x0828a090`, client `0x0053d7b0`). A script with fewer than six patches has
  no slot 5.
* **SND-12.** When the rounds stop (no round for 1 / 20 s), slot 5 is released
  and slots 2 (Release) and 3 (Shell Bounce) triggered, slot 4 (MG distance) at
  most once per 0.5..1.5 s (`FireArms::updateSound`, `0x0828cc10`).
* **SND-14.** A patch holding a `loop` sample latches on its first trigger and
  ignores the rest until it stops: the Fire Loop of every vanilla MG starts once
  per trigger press. A patch without one starts every sample again on every
  trigger, each on a NEW instance of its buffer, the old one left to ring; a
  buffer holds at most eight instances and a ninth steals one.
* **SND-15.** `randomPlay n` is stored on the sample it follows, and the patch
  takes the value of each load in turn, so it picks exactly when its LAST load
  carries it. A trigger then plays one load, `rand() % loads`, and a
  `silence.wav` load counts and plays nothing.
* **SSC-6.** `#templateLevel` is per file, and an `#include` under another tier
  is never opened.

## What was wrong, and what changed

| | cause | fix |
|---|---|---|
| H1 MG42, M2A3, BMP-2 | DC Final took `loop` off the Fire Loop samples (`mg_temp.wav`, `autocannon_loop_*`, `bmp-2_*`: one shot and its tail each); `_firing_patch` found no loop and took the first sounding patch, Shell Bounce | `_firing_patch`: with the Fire slot silent, slot 5 is the round's voice, looping or not; with slots 0 and 5 both silent, the release slots 2..4 (never Reload). The viewer's `trigger()` already plays a gun's one-shots per round |
| H2 CAR-15, Skorpion, M203, AK47GP30 | `fire_sample` took only looped samples from the Fire Loop | the same two rules; slot `release` carries `delay` 0.05 s (SND-12). DC Final's CAR-15 Fire Loop is a `randomPlay` of two recordings: `weapons.json` `randomPlay` lists one mp3 per load (`null` where a roll plays nothing at the muzzle) and `hand-fire-sound.js` rolls one per shot |
| instance pool | `trigger()` stacked every round's tail unbounded: 26 deep for the MG42 (1.7 s at `roundOfFire 15`) | `INSTANCES_PER_SAMPLE` = 8 in `engine-audio.js` and `hand-fire-sound.js`, oldest stolen (which one the engine steals is inferred) |
| M1 shared names | `sample_writer` named an mp3 by the wav's file name, first writer wins: DC Final's `Helicopter_far.wav` is four recordings, `enginewhine.wav` three | `extract_map.SampleNames`: a wav keeps its bare name when it is the only one of its name at its rate, the one at the rate root, or byte-identical to one of those; any other is `<stem>~<sha1[:8]>`. One wav, one name, so the coherent-twin guards still see twins. The effect extractor uses the same rule |
| M5 bombs and mines | `_sound_layers` dropped `randomPlay`, so a release played `bmbreal1` and `bmbreal3` together (vanilla too) | layers of a picking patch carry `patch`, `randomPlay`, `slot`, `slots`; `EngineAudio.#rollRandomPlay` rolls over `slots` when a layer says so |
| M4 birds | `discover_level_sounds` kept a looping pick's first load: every tree on kursk sang `Env_Birds5` (1,334 emitters) | `picked_voice` rolls each emitter's load once (a stable hash of template and position) over every load, silences included: 8 of 27 on `birds_eu.ssc`. Kursk 1,334 emitters to 410, eight different birds |
| parser | `parse_ssc` set `random_play` on the patch wherever `randomPlay` appeared, and opened MEDIUM files at HIGH, whose own includes then leaked HIGH samples into the open patch (46 into vanilla `Browning.ssc`'s Fire Loop, with `randomPlay`) | SND-15 and SSC-6 as read. Vanilla's M1 Garand, Type 5, Gewehr43 and shotgun Fire patches stop being picks; 28 vanilla effect scripts lose phantom patches |
| H3 soldier | DC trees had no `soldier.json`, and the page asked again on every footstep | extracted for both trees (DC's own footstep wavs); `page-audio.js` remembers a 404 per models base |
| L1 | DC places no depot whose give sound is `Ammorefill.wav` | `extract_vehicle_sounds.write_refill_sample` writes `SoldierRefillAmmo.ssc`'s sample into every tree's `_shared/sounds` |
| L2 | `kits.json` `MK23` against `weapons.json` `Mk23` | `weaponSpec` in `hand-fire-sound.js`, and `world-fire.js` keys by lower case |
| level-local scripts | a template the level declares in its own root `objects.con` names a script only its archive holds (DC Al Nas's radios) | `discover_level_sounds` reads the script from the level archive when the objects pool has none |

## Not done here

* Release tails (SND-12): built since, and reaching the rack since D11 ("The
  burst edges reached no rack"). The reading here, that a held M2A3 or BMP-2
  releases between its rounds, was wrong: `handleMessage` holds +0x225 on
  every tick the trigger is down, so a held gun releases once a burst.
* One-shots inside a looping Fire Loop (the stationary MG's shell layers):
  played once a press as the gun's `press` edge, since D11.
* When a static object's sound is triggered is not traced; the per-emitter roll
  stands in for it.

## Verified / tests

* `tests/test_sound_slots_and_picks.py`: the tier include, the last-load rule,
  the bird roll's share (8 of 27), the slot picks for the MG42 and M203 shapes,
  the layer keys, the naming rule, the weapon alternates and delay, the in-place
  rewrite of a stale weapon mp3.
* `tests/test_gun_one_shots.mjs` (run by `test_gun_one_shots.py`): 26 rounds
  leave eight plays ringing, oldest stolen; a roll onto a silence plays nothing;
  the case-blind lookups.


# D10 — FHSW's hand weapons named scripts beside the wrong file (2026-09-30)

Found by the FHSW audit: 277 hand weapons (K98, MP40, No4, Colt, Thompson,
Springfield03, Sten, ...) were quiet with `sound script missing:
objects/Handweapons/!_PACK_COMMON/Sounds/<name>.ssc`.

## The engine rule (ledger CON-14)

A `loadSoundScript` path is relative to the file its line is in. The client
joins the console's working path to the argument (`0x0054d8c3`), and `include`
and `run` set the working path to the opened file's folder while its lines run
and restore it after (lnxded `OldConsole::include` `0x083ed110`). FH's packer
rewrote the lines it copied into each `!_PACK_*/Compressed.con`
(`../345RCL/Sounds/345RCL.ssc`) and left the `.inc` files it includes alone:
`K98.inc` says `Sounds/k98.ssc`, meaning `Handweapons/K98/Sounds/k98.ssc`.

## What was wrong, and what changed

`extract_models._inline_includes` splices an include's text in place, which
loses which file each line came from, and `ObjectLibrary` resolves every
template's `sound_script` against `template.source`, the including file. The
splice now rebases each spliced `loadSoundScript` onto the includer's folder
(`_rebase_sound_scripts`), innermost include first, so every consumer of
`sound_script` (`extract_weapon_sounds`, `effects.bundle_sound_scripts`, the
weapon stats) gets a path that names the script the game loads.

Blast radius, measured by resolving every template's script in every chain
before and after: only misses turn into hits, none moves. FHSW 317
templates (the hand weapons plus the soldiers), FH 16, EoD 19, XPack1 11
(its soldiers and `e_SmokeIdleXpack`), XPack2 10, DC 9, DC Final 9, vanilla 8
(the soldiers' `SoldierSound.inc`, which no output reads). `weapons.json` is
byte-identical for vanilla, XPack1, XPack2, DC, DC Final and EoD.

| FHSW hand weapons (869) | before | after |
|---|---|---|
| reach their script | 494 | 778 |
| with a fire sound in `weapons.json` | 307 | 501 |
| with a sounding Reload slot | 289 | 570 |

## Not done here

* 277 FHSW weapons stay quiet because their wav is in no installed archive
  (FHSW ships no `sound.rfa`; the game mounts FH's and vanilla's). The game
  plays nothing for those loads either (SND-16): `grenthrow1.wav` (76 weapons),
  `KampfPistole.wav` (45), `20mmS18-1000ST.wav` (17), `no2ST.wav` (16),
  `M1917_ST.wav` (9) and a tail of others. 47 name a script the install does
  not ship (the `Deploy_*` family), and 44 declare none.
* `weapons.json` `randomPlay` lists a load whose wav is missing as `null`, which
  counts it in the roll; the engine drops it (SND-16).
* `extract_map.find_engine_script`, `_weapon_script` and
  `level._find_template_sound_script` re-read the raw `.con` at
  `template.source` and so miss any `loadSoundScript` an include supplies. No
  vehicle, gun or static in the eight surveyed chains takes its script through
  an include (only hand weapons, soldiers and one XPack1 effect do), so nothing
  is lost today.
* `build_library`'s `Compressed.con` split looks for `rem folder =` markers
  after `_inline_includes` has stripped comments, so any pack file with an
  include (all of FHSW's) is never split and every template in it has the pack
  file as its `source`. Correct for path resolution (the pack file is where
  the engine's working path points); what else keys on `source` was not
  audited.

## Verified / tests

* `tests/test_extract.py` `IncludedSoundScriptPathTests`: the K98 shape, a pack
  line left alone, a same-folder include, a nested include, a quoted
  backslash path; the XPack1 `e_SmokeIdleXpack` test now expects
  `Sounds/SmokeIdle.ssc`.
* Scratch runs in `~/.cache/fix-sounds/{before,after}` (`weap-<mod>/`,
  `lib-<mod>.json`).


# D11 — burst edges that never sounded, and the parts nothing played (2026-10-06)

Built in the Desert Combat parity round (package `sounds`, from the soldier
census items A2 and A6). Read section 11 of the mod-extraction skill first:
everything here keeps the one invariant, and both coherence sweeps run with
the parts in.

## The burst edges reached no rack

D9 left "the viewer does not trigger slots 2..4 on release" open, and 75edb204
built both halves of that. `gun-cycle.js` `releaseTick` (SND-12) tells the page
when a burst stops. `map.html` `guns.onRelease` hands it to `vehicle-audio.js`
`release`, which triggers the gun's Release, Shell Bounce and MG-distance
patches. A press plays the latched Fire Loop's one-shots once (`trigger`).
Nothing tested the two halves together, and they never met.
`ssc-specs.js` `findWeaponSpecs` and `findWeaponSpecsByFireArms` rebuilt each
gun spec field by field and left out `press` and `release`. So
`loadBurstEdges` saw no edges on any tree, and no stop played a tail. That
includes vanilla, whose scenes have carried the edges since the 10-03 sounds
patch. The lookups now carry `press`, `release` and `reload` (the Reload slot,
`features/hand-weapon-sound-edges`). No second trigger was added; the one
trigger now finds its data.

DC's own tree was stale besides: its scene.json files date from 09-30 15:21,
before the edges existed, and carry none.

## The parts

Only an Engine's and the FireArms' scripts shipped (`extract_vehicle_sounds`).
So a turret traversed in silence, and so did a gun's elevation, a ramp, a
landing gear, a flap and a tank's tracks, in every mod. Vanilla binds 82
RotationalBundle scripts (turrets, the B17's gun mounts), 14 LandingGear, 22
Wing (the flap creak) and track AnimatedBundles on its tanks. DC binds 148,
75, 40 and 36, plus the M-109's tracks on a PlayerControlObject.

What plays them was read out of both binaries (ledger SND-18..SND-23):

* Every object's patches all start once, when the client builds its sound
  (SND-19). The dedicated server builds none, which is why every lnxded sound
  call is client-only code.
* A RotationalBundle presses every patch each frame it turns and lets them go
  each frame it does not. `Default` is its turning rate in deg/s: the largest
  over its axes of the speed register plus `continousRotationSpeed` (SND-20).
  DC's `m1turretservo` goes from silent at 0.1 deg/s to full at 20, at pitch
  0.5 to 0.6 over 0 to 10.
* A LandingGear is skipped by that rule and runs its own: patch 0 while it
  travels up, patch 1 while it comes down, and the other one let go. Stopping
  lets go of the one it played, so its `trigger release` clunk plays and its
  motor loops fade on `TimeRelease` (SND-21).
* A Wing, an AnimatedBundle and a PlayerControlObject never touch their sound
  again, so their scripts play from creation for good. They run on their own
  Speed and Acceleration, with `Default` 0 (SND-22). That is why a track's
  `Pitch <- Default` ramp sits at its base.
* A patch can be pressed and let go over and over: a trigger is ignored while
  it is latched, a release is one-off, and once nothing of it sounds it starts
  over on the next trigger (SND-23).

| | change |
|---|---|
| extractor | `extract_map.PART_SOUND_KINDS`, `find_part_scripts`: every part of those classes that binds a script, as `sounds.vehicles[].parts[]` `{node, kind, script, patches, attachToListener}`. `patches` is one layer list per patch in script order, silent ones `[]`, because the gear tells its two apart by index. The same entries reach `_shared/vehicle-sounds.json` (`extract_vehicle_sounds`, whose summary now counts parts) |
| `engine-audio.js` | `relatch`: `trigger()` and `release()` run the engine's patch runtime instead of the engine's one-way release. Loops run from `start()`, held at nothing while the patch is idle, and while it is released unless they fade on `TimeRelease`. `control.default` feeds `Default` where an object writes its own; unset, `Default` still reads the rpm as before |
| `vehicle-audio.js` | `PART_RULES` (`turn`, `gear`, `always`) by `kind`. Each part's patches are relatched `EngineAudio`s on its own node (`partNodeOf`), built idle, except an `always` part's loops, which are pressed at the claim (its one-shots went off when the object was made, so they are not built). Each frame `_partTick` reads the part's turn off its node's local rotation (`turnRate`), applies its rule, and evaluates. Every part patch goes into `resolveAcross` with the engine and the guns. The rack also reads a gun's `FireState` reload clock (`reloadOf`) for its Reload slot |
| `ssc-specs.js` | `findPartSpecs`; the gun lookups carry their edges |
| `ssc-curves.js` | `Default` reads `c.default ?? c.rpm` |

The twins this makes are arbitrated, not shipped. A Corsair's two legs both
play `LandingGear.ssc`, an M1A1's two tracks both run `moderntreads` at the
one pitch `Default` 0 gives, and a Sherman's two tracks both play
`VEALTTRACK`. `resolveAcross` keeps the louder copy as heard.

## Found in review (2026-10-07)

* **DC's right-hand tracks never started.** `M1A1TrackR`, `T72TrackR`,
  `BMP2TrackR`, `M2A3TrackR` and `ShilkaTrackR` (DC and DC Final) load their
  loop as `trigger Volume` with a `Volume <- Time` fade-in. A relatched patch
  never armed a looping `trigger Volume` layer (`#fire` skipped every loop),
  so on the IFVs the authored detune pair (`VEALTTRACK` at 0.65 + 0.02 s
  against 0.55 + 0.025 s) lost its right half. `#fire` now arms such a loop
  once, while it has no source; started, it runs on muted between presses,
  so stopping and going again never stacks a second copy. `resolveAcross`
  counts an armed loop as a contender on the frame it is due to start, or
  that frame sounds it beside its twin (measured: one frame of two
  `moderntreads` on an M1A1 before).
* **A replayed gun played a release tail after every round.** A replayed
  group has no trigger (`group.firing` stays false), so `releaseTick` saw an
  unheld gun 50 ms after each recorded round: 9 Release tails a second at 10
  rounds a second. The engine's remote players hold +0x225 every tick their
  fire message passes (SND-12). `advanceGroups` now holds a replayed gun's
  trigger while `replay-hulls.js` `holdSound` keeps its window open, the
  window its Fire Loop is gated on, so it releases once, when that shuts.

## Verified / tests

* `tests/test_vehicle_parts.mjs` (run by `test_vehicle_parts.py`), on DC's own
  M1A1 tower and track scripts and an A-10's gear and flap:
  - The tower is silent at rest. Turning at 20 deg/s plays the servo at full
    volume and pitch 0.6, and 5 deg/s at the ramp's 0.246 and 0.55. It stops
    the frame the tower stops (no `TimeRelease`) and starts again on the next
    turn.
  - The tracks are silent at rest. At 5 m/s they sound at half volume, pitch
    0.8, and both tracks are one voice.
  - The gear is silent and clunks nothing when built. Retracting presses
    patch 0, not patch 1, and plays its start one-shot once per travel.
    Stopping plays `LG2` once, and its motor fades out over 0.4 s. Coming down
    presses patch 1.
  - The flap's creak runs from the claim on the hull's acceleration and speed,
    and its creation one-shot is not built.
  - A right-hand track as DC ships it (`trigger Volume`, `Time` fade-in) starts
    once the hull moves, once, and beside the left track the two are never
    two voices, not even on the frame it starts.
* `tests/test_vehicle_part_sounds.py`: `find_part_scripts` by class, a
  parts-only hull still gets an entry, a SimpleObject's script is not a part,
  the gear keeps its two patches in order with an empty one, and the flap
  ships its creak.
* `tests/test_gun_burst_edges.mjs` (run by `test_gun_burst_edges.py`): gun-cycle
  and the rack wired as `map.html` wires them, plus a sweep of every edge of
  every level. A replayed burst (no trigger, `group.sounding` held) releases
  once, at 10 and 5.7 rounds a second. Vanilla: 230 guns. DC live: 0, since its scenes predate the
  edges. DC patched into scratch: 565 guns and 581 edge samples.
* The coherence sweeps take a tree from the environment
  (`VEHICLE_AUDIO_MAPS`, `ENGINE_AUDIO_MAPS`). With the parts in, every turret
  turning, the gear travelling and the hull at 8 m/s, both pass on the live
  vanilla tree and on scratch trees with the sounds layer patched by this code
  (`~/.cache/dc-sweep/sounds/maps-after/{bf1942,desertcombat}`). Between
  patches: vanilla 731 arbitrated and 3,409 part loops heard (279 before the
  parts), DC 1,229 and 5,384 (100 before). Inside a patch: no offence in
  either tree.

### In the page

`~/.cache/dc-sweep/sounds/part_probe.cjs` drives `map.html` headless (Vulkan
flags, under the shared browser lock). It serves each level's scene.json and
any new samples from the scratch-patched tree through `page.route`, so the
shared maps tree is never written. It boards a hull and reads
`__vehicleAudio().snapshot()`:

* **Aberdeen, Sherman.** At rest the tower is silent and the tracks run at
  gain 0 (speed 0). Traversed with the mouse at 16.8 deg/s, the three tower
  loops (`VEFTRTYAW2`, `WWSXCGYAW`, `VEFTRTYAW`) play at 0.42, 0.16 and 0.43.
  At 5.3 deg/s they fall to 0.13, 0.05 and 0.14. After 1.5 s still, all are
  silent again.
* **DC Medina Ridge, M1A1.** At 8.4 deg/s `m1turretservo` plays at 0.415,
  pitch 0.584. The script's own ramps give (8.4 - 0.1) / 19.9 = 0.417 and
  0.5 + 0.1 x 0.84 = 0.584. Stopped, it is silent.
* **El Alamein, Spitfire, gear.** Placed at 300 m, the legs retract at
  33.5 deg/s: patch 0 is pressed and its motor loops rise on their `Time`
  ramps (`lghi` 0.2, `lcvphirpm` 0.9 at pitch 1.41). Placed at 3 m before the
  legs were up, the gear reverses: patch 0 lets go with its `LG2` clunk and
  patch 1 presses. The right leg's `lcvphirpm` is arbitrated against the
  left's, as one buffer at one rate.
* **Midway, Corsair on the carrier.** Boarding plays one `lg1` clunk. The
  legs really move there, by 0.6 degrees out and back over three frames at
  21, 2 and 11 deg/s. That is `aircraft.js` `autoGear`: it retracts on height
  alone, and the carrier deck is 38.8 m above the sea. The engine also
  requires the engine's differential rpm at or above `gearUpEngineInput`
  (SND-21), which `con.py` extracts and the viewer never reads. That belongs
  to the aircraft code, not here. A leg that is re-posed rather than
  travelling (faster than twice its `setMaxSpeed`, a replay seek) plays
  nothing (`GEAR_SNAP`).

## Not done here

* `Speed` and `Acceleration` are the voice's own motion in the engine (patch
  +0xb0, +0xa0), sampled each update from the patch owner's root object's
  physics velocity (SND-18, traced in review). That is the hull's, which is
  what a part gets. The viewer's acceleration is the rack's smoothed hull
  acceleration, which is 0 on a hull built without an engine patch, and its
  speed is `airspeed` where the drive keeps one, not the velocity.
* A part's turn is read off its node's local rotation. At a stop, the engine's
  speed register can stay non-zero while the angle is clipped, so the servo
  would keep running under a hand that pushes against the stop. The node does
  not move there, and the viewer falls silent.
* The creation trigger's one-shots, and the release a spawn frame gives a
  RotationalBundle or a gear, are not played: the rack builds a hull when it
  is claimed, not when it spawns.
* A part template met twice under one hull sounds from its first node only.
* Unoccupied hulls are not in the rack, so a parked tank's tracks and a
  dropped plane's creak are not heard. Both need Speed, so they are near
  silent anyway.
* FloatingBundle and Camera inherit the RotationalBundle rule if their
  `handleUpdate` chains to it (not checked). No surveyed tree binds a script
  to either.
* A turret re-posed in one frame (a replay's seek) reads as a turn at
  thousands of deg/s and opens its servo for that frame; only the gear has
  the `GEAR_SNAP` guard. A blip, not a drone.
* `resolveAcross` spans the rack only. A ship's or a PT boat's flag
  (`flag.ssc`, `flag.mp3` at rate 1, faded out by 15 m) and the area pool's
  control-point flags loop one sample at one rate in two systems, so standing
  within 15 m of both would comb. No case was met. DC and DC Final also
  place `VEFTRTYAW2` as an area sound on a few levels (not checked against a
  turret's rate).

# D12 — a round's own script: the rocket motor nothing played (2026-10-10)

Reported: the bazooka "is more crisp in the real game", from two recordings of
the page (no retail capture in hand).

## What the data says

`Bazooka/Sounds/High.ssc`'s fire patch is `rktfirest.wav`, a 0.37 s stereo
crack, and a mono copy for bystanders. The rest of a launch is the round's:
`BazookaProjectile` loads `Common/Sounds/BazookaProjectile.ssc`, four loops
(`rcktlp1`, `rcktlp2` twice, `haxxar`) that fade in over 0.06..0.3 s on `Time`
and out over 2..90 m on `Distance`. An object's patches start when it is
created (SND-19), so the motor burns from the muzzle to the hit. The page
played the crack and nothing else.

58 of vanilla's and the two expansion packs' Projectile templates load a
script. Those with a looping sample: the rockets (Bazooka; XPack2's Calliope,
AW52, HO229, Natter), every tank and gun shell (`Shellwhine`), the three bombs
(`shellair`, `Shellwhine`, `haxxar`), and XPack2's thrown knives (`knife_air`).

## What changed

| | change |
|---|---|
| extractor | `extract_effects.flight_sound_names`: every Projectile with a script. `build_sound_manifest(rounds=)` lists each under its own name in `_shared/effects.sounds.json`, looping samples only, under a `<script>#flight` key. Vanilla gains 11 names and 4 scripts, XPack1 17 and 5, XPack2 21 and 11; no entry that was there moved |
| player | `effects.js` `EffectPlayer.playSound(name, object)`: the sound half of `play()` for a name that is no bundle, following the object, with a `stop()`. `hasSound` (the page's `effectAudio.has`) answers first, so a bullet costs one map lookup |
| rounds | `round-launch.js` starts it on every drawn round (`shot.sound`), and it stops wherever the trail does: `endRound`, `recycle`, `GunFire`'s clear |
| pool | `EngineAudio.restart()`, which `EffectAudio` calls for a slot it has silenced (`slot.cut`). A pooled slot that had been stopped never started its loops again, so the second rocket was mute. The same held for a wreck's fire on a reused slot. `silence()` itself is unchanged: a cut gun patch still fires on its next `trigger()` |
| pool | `EffectAudio` forgets a play that is stopped while its samples decode (`waiting`). A first rocket fired into a wall would otherwise start its loop after the round was gone, with nothing to stop it |

## Verified / tests

* `tests/test_effects.py` `FlightSoundTests`: a rocket ships its loops under
  its own name, a bomb its whistle without the release clack, a bullet nothing,
  and a bundle loading the same script keeps all of it.
* `tests/test_effect_audio.mjs`: the four loops start, follow the round, stop
  with it and start again for the next; a play stopped before its decode stays
  silent.
* Headless Bocage, Axis anti-tank, Panzerschreck raised 0.5 rad: the
  `bazookaprojectile.ssc` slot holds 4 sources for as long as `inFlight` is 1
  and 0 from the frame the round lands.

## Not done here

* A bullet's `Projectile.ssc` is seven one-shots, the crack of a round going
  past. Not played: it is one play per round of every automatic weapon, and
  wants its own budget.
* A bomb's two one-shot patches stay with its rack's trigger
  (`_firing_patch`, `from_round`). In the engine they are the bomb's own, at
  the bomb.
* Two rockets in flight loop the same samples. `randomStartPitch 0.05/0.05`
  keeps most pairs outside `COHERENT_RATE_TOL`, and nothing arbitrates the
  pairs it does not (`resolveAcross` covers the vehicle rack only).
* The pitch effects read `Default`, which a round's slot gets as 0. What the
  engine feeds a Projectile's control slot 0 was not read.
* Replayed rounds (`replay-*.js`) do not go through `round-launch.js`.
* Mod trees other than the three in scope keep their old manifests and stay
  as they were.

# D13 — the helicopter that played a rocket motor at its own cockpit (2026-10-11)

Reported from a Secret Weapons + Road to Rome replay (`4dbzkzc6sv`, Raid on
Agheila): "look at 1:35 when they fire it, it makes this strange noise when the
missiles are fired". The recording is the client's own (kind 2 `fire`, weapon
`FlettnerRocketLauncher`, 59.3, 73.5, 81.8, 95.466, 112.4, 148.7 s).

## What the data says

`Raid_on_Agheila/Objects/Flettner/Weapons.con`:

* `FlettnerMG` has `loadSoundScript Sounds/FlettnerMG.ssc` (`BFMG1`, `BFMG2` and
  two `BFMGdist` loops).
* `FlettnerRocketLauncher` has **no** `loadSoundScript`. Its round,
  `FlettnerRocketProjectile`, does: `Sounds\FlettnerRocketProjectile.ssc`, one
  patch of four loops (`rcktlp1`, `rcktlp2` twice, `haxxar`) that fade in over
  0.06..0.3 s and out over 2..90 m. It is the rocket's motor.

The extractor's `find_weapon_scripts` falls back to the round's script for a
weapon with none (a bomb rack's release clack lives there), and
`_firing_patch(release=True)` takes the round's first ONE-SHOT. With no
one-shot it took "the first sounding patch": the motor. So the entry the
level shipped for the launcher was four `loop: true` layers, which the rack
sounds while `group.firing || group.sounding`, and the replay holds `sounding`
for 1.5 rounds at the weapon's rate of fire (`replay-hulls.js` `holdSound`,
`roundOfFire 0.25` is 6 s). A loop at 1 m in the cockpit, from the launcher,
for six seconds, with the rocket long gone and no Doppler or fall-off to say
so.

The same fallback bound the same four samples to three more launchers:
`Sherman_T34CalliopeBundle` (the Calliope, in four SW levels), Raid on
Agheila's `Krupp_RocketLauncher` and its `RocketLauncher_RocketLauncher`.

## What changed

| | change |
|---|---|
| `extract_map._firing_patch` | `release=True` with no one-shot patch returns `[]`: a weapon whose sound is only its round's loops is mute at the muzzle, and the loops are the round's flight |
| `extract_effects.level_flight_sound_names` | the rounds a level's own archive declares that load a script, listed in the level's `effects.sounds.json` beside its bundles (`flight_sound_names` only ever saw the mod's). `--levels ... --sound-only` rewrites just that file and the `maps.json` row |
| `census_vehicle_weapon_sounds.py` | walks every FireArms under every vehicle (the mod's global templates, then each of the pack's levels, level objects included), classifies where its sound lives (own, round-shot, round-flight, silent, unresolved), builds the table in memory and fails on a looping layer bound to a launcher, a dropped sample, a missing entry, or a flight the manifests do not list |
| tables | XPack2: `_shared/vehicle-sounds.json` (Calliope entry gone), `scene.json` `sounds` of Eagles_Nest, Gothic_Line, Peenemunde, Raid_on_Agheila; `raid_on_agheila/effects.sounds.json` (new, the Flettner motor) |

Kasserine Pass declares its own tank shells (`PanzerIVProjectile`,
`ShermanProjectile`, `TigerProjectile`): its manifest now lists their `Shellwhine`
flights as the mod's shells have since D12 (`kasserine_pass/effects.sounds.json`
in the vanilla, XPack1 and XPack2 trees).

## Census (2026-10-11, from the install)

| tree | weapons | own | round-shot | round-flight | silent | unresolved | problems |
|---|---|---|---|---|---|---|---|
| XPack2, before | 150 | 119 | 19 | 0 | 10 | 2 | 4 `loop-on-launcher` |
| XPack2, after | 150 | 119 | 15 | 4 | 10 | 2 | 0 |
| XPack1 | 125 | 103 | 13 | 0 | 9 | 0 | 0 |
| vanilla | 139 | 110 | 13 | 0 | 16 | 0 | 0 |

`unresolved` are scripts the game's own data names and no archive holds
(`WasserFallGuns` -> `Sounds/spitfirefire.ssc` under the Wasserfall rocket's
folder; Raid on Agheila's `Landmine_Launcher` -> `ammobox.ssc`): the game plays
nothing either. `silent` are weapons with no script and a round with none
(depth charges, torpedoes, the Katyusha rocket) or an authored `silence.wav`
(Battle of Britain's Ju88A right rear gun).

## Not done here

* The three rocket aircraft (AW52, HO229, Natter) keep a one-shot launch crack
  (`rcktfiremono`, the round's second patch) on the rack's trigger, as the
  bombs do (D12 "Not done").
* The Calliope's and Krupp's and the platform's rounds use `CalliopeProjectile`
  from the mod's manifest; nothing level-local was needed for them.
