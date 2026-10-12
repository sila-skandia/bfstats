# Hand-weapon sound edges: release tails and reload foley

Built 2026-10-06 in the Desert Combat parity round (package `sounds`, from the
soldier census, items A2 and A3). A hand gun's `.ssc` has six slots: Fire,
Reload, Release, Shell Bounce, MG distance, Fire Loop (ledger SND-12..SND-17).
The page played the rounds' own slots and, since 75edb204, the release tails.
It never played the Reload slot. And no tree on this PC had been re-extracted
since 75edb204, so none of them carried the tails either.

## What was wrong

* **Release tails were in the code, not in the data.** `extract_weapon_sounds.
  _burst_edges` writes a weapon's `release` groups (DC's `M16_release`,
  `akm_release`, the casings) and `hand-fire-sound.js` plays them when
  `gun-cycle.js` releases the burst (`map.html` `guns.onRelease`). Every
  `weapons.json` predated the commit: 0 of 54 DC entries carried `release`,
  and vanilla, XPack1, XPack2 and DC Final were stale the same way. FHSW's,
  extracted 10-01, is the only current tree.
* **Every reload in every mod was silent.** `FireArms::Reload` triggers
  patch 1 once, as the magazine change starts (SND-17). Nothing read the slot:
  no `weapons.json` carried it and no audio module triggered it.

## What changed

| | change |
|---|---|
| extractor | `extract_weapon_sounds._reload_edge`: slot 1 as `entry["reload"]`. `picks` are the loads the shooter hears, one mp3 each (`<Name>.r1.<load>.mp3`, the release groups' naming), each with the `delay` its `Volume <- Time` gate gives. `randomPlay`/`loads` are kept for a patch that rolls one load (SND-15). `layers` is the whole patch, for bystanders. The pick writer is shared with the release groups (`_edge_pick`, `_slot_group`) |
| shooter | `hand-fire.js` `startReload` calls `hw.fire.playReload()`. `startReload` is the one place both R and the automatic change on a dry magazine go through. `hand-fire-sound.js` plays each pick on the hand bus at its delay, under the same eight-instance cap as a shot (SND-14) |
| bots | `bot-referee.js` `magazineTick` calls `env.onReload(bot, weapon)` where it starts a change. `map.html` hands that to `page-audio.js` `playWorldReload`, which calls `world-fire.js` `playReload`: the patch's layers, pooled beside the weapon's rounds, positioned at the bot. The slot is held until the last gated load has played. Loads still armed then are disarmed, so walking up to the spot later sets nothing off |
| seated guns | `extract_map` ships a vehicle gun's slot 1 as `weapons[].reload`. The rack triggers it when the gun's reload clock (`FireState.reloadRemaining`, through `reloadOf`) comes off zero (`vehicle-audio.js` `_watchReload`). Only a few guns carry one: DC's TOW and Spandrel launchers, XPack1's M3 Grant gun, and DC Final's PKM and helicopter missile racks. No vanilla gun does |

Why bystanders still hear nothing: every one of vanilla's 239 reload loads,
and 563 of DC's 573, carries a `Volume <- Distance` ramp that ends at 1 m
(`~/.cache/dc-sweep/sounds/survey_reload.py`). The world path plays them
anyway and leaves the ramps to decide, as the game does. The ten DC loads that
reach 5 m are the only ones a neighbour can hear.

## How it was checked

* `tests/test_weapon_burst_edges.py`: DC's `M16.ssc` trimmed to one load per
  idea. Slot 2 and a three-way `randomPlay` Shell Bounce with its 0.2 s gate,
  nothing for a silent MG-distance slot, the Reload slot's three gated loads
  with their delays, volumes and pitch jitter, the bystander layers with their
  Time and Distance ramps, and no `reload` for a one-patch script.
* `tests/test_reload_sound.mjs` (run by `test_reload_sound.py`): the shooter's
  loads start on their gates from the moment the change starts, a manifest
  with no reload stays silent, and a `randomPlay` reload plays its one rolled
  load. For a bot, a listener within a metre hears every load, one at 10 m
  hears nothing, and a stale load does not fire when he walks up. A seated
  gun plays once a change, not every frame, and again on the next. The
  referee's `onReload` fires once when a dry magazine starts its change.
* A scratch re-extract of all five in-scope trees
  (`~/.cache/dc-sweep/sounds/weap-after/<mod>/weapons.json`). DC's M16 and
  AK47 now carry `release` and `reload`, and no field the old manifests had
  moved.

## Open

* Whether a reload's later loads still sound when the weapon is put away in
  the middle of the change. The engine's patch keeps updating only while it
  sounds (SND-23), and whether a disabled item's sound is still updated was
  not traced. The page lets them play out.
* Replayed soldiers' reloads (`replay-*.js`, another session's files) do not
  call `playWorldReload`, and nor does a remote player's in a room: no
  reload goes over the wire (`netcode*.js`). Only DC's ten loads that reach
  5 m would be heard.
* The template byte at FireArms +0x349 that restricts a reload to an empty
  magazine: its console word was not traced.

# The Fire slot's other one-shots (2026-10-10)

Reported, after the rocket motor landed (`vehicle-sound-coverage` D12): the
bazooka is "dull, muffled" where the game is "sharp and crisp".

## Measured

The page's launch and the game's `rktfirest.wav` have the same spectrum to
within a decibel in every band (the owner's recording at 3.50 s against the
wav: 0..500 Hz -0.5 / -0.4 dB of the total, 4..8 kHz -27.7 / -27.8). So the
sample was played faithfully, and the sample is a thump. What was missing is
the patch's second load:

| load | length | mean level | above 4 kHz | `Volume <- Distance` |
|---|---|---|---|---|
| `rktfirest.wav` (stereo) | 0.37 s | -6.6 dB | -37.0 dB | 1 below 2 m, 0 above |
| `rcktfiremono.wav` | 0.93 s | -11.5 dB | -24.1 dB | 1 to 50 m, 0 at 90 m |

Both are at full where the shooter stands, and a trigger starts every sample
of a patch (SND-14). `fire_sample` shipped the loudest one as "the report" and
the shooter heard nothing else.

## What changed

`extract_weapon_sounds._fire_companions` writes the Fire slot's other
one-shots the shooter hears as `entry["also"]`, one mp3 each
(`<Name>.f<load>.mp3`) with the `delay` its `Volume <- Time` gate gives.
`hand-fire-sound.js` `playHandFire` plays them with every report, on the hand
bus, under the same instance cap.

Left out: a second copy of the report's own wav (a near/far hand-over), a
second copy of a companion's wav (the Gewehr 43 loads `patron9` three times at
one gate), loops, and a `randomPlay` patch, which `_alternates` already rolls.

What it adds in the three trees:

| weapon | now also heard |
|---|---|
| Bazooka, Panzerschreck | `rcktfiremono`, with the report |
| K98, No 4 and their sniper and bayonet forms | the bolt (`snpreload_2` at 1.15..1.18 s) and four cloth and metal loads |
| M1 Garand, Type 5 | five casings at 0.8 s. Their include ends in `randomPlay 1`, but more loads follow it, so every one plays (SND-15 names these two) |
| XPack2 Gewehr 43, shotgun, K98 rifle grenade | casings, shells, and the grenade's `grenade_launcher_fire` 0.1 s after the pre-fire click |

No other field of any `weapons.json` entry moved.

## Checked

* `tests/test_weapon_sounds.py` `FireCompanionTests`: the hiss and a gated
  bolt ship, the report's twin and a layer that starts at 50 m do not, and a
  `randomPlay` patch and an automatic get none.
* `tests/test_reload_sound.mjs`: the report, its companion with it, and a
  gated one 1.18 s on.

## Open

* An automatic's other loops at the muzzle are still not played: the MP40's
  and MP18's `mgmetal3`, the DP's and Type 99's `weapon_common_metal`, the
  StG 44's `weapon_stg44_metal`, XPack1's Breda and Sten.
* Not compared with a retail capture: there is none in hand.

# One clock a patch (2026-10-12)

Reported from FHSW's M1 Garand: "the bullet casing sounds build up and so you
get this rattling for the entire clip expended quickly. In retail it doesn't
play in a row, just once."

## What the game does

The Garand's script is vanilla's in every mod (FH and FHSW load
`Sounds/M1Garand.ssc` through `M1Garand.inc` and ship none of their own). Its
Fire patch includes `ShellBounce.ssc`: six `patron*.wav` loads behind
`Volume <- Time` at 0.8 s, all of them played (the include's `randomPlay 1`
is not after the patch's last load, SND-15).

A gated sample is not scheduled when its patch is triggered. It starts on the
first update that finds its volume above zero, and the patch has one clock,
which every trigger sets back to nothing (ledger SND-33, read in the client).
A round every 0.167 s (FHSW's `roundOfFire 6`) or 0.3125 s (vanilla's 3.2)
never lets the clock reach 0.8 s, so the casings ring once, 0.8 s after the
last round. Fired slower than the gate, they ring after every round.

## What the page did

`hand-fire-sound.js` plays the manifest's flattened `delay`s. Every round
scheduled its five casings with `source.start(now + 0.8)` and nothing took
them back. `engine-audio.js` already ran a hull gun's patch on one clock
(`#fire` zeroes `elapsed`); the hand weapon's own player had none.

## What changed

`hand-fire-sound.js` keeps, per patch, the plays that are scheduled and not
yet begun (`waiting`). A trigger of the patch stops those and schedules it
again (`retrigger`); a sample already sounding plays out, as in the game. The
patches are the weapon's Fire slot (the report, its `randomPlay` picks and its
`also` companions), the Fire Loop's one-shots, each release group and the
Reload slot. No data changed.

Measured on FHSW Battle_Of_Foy, headless Chromium, every
`AudioBufferSourceNode.start` and `stop` logged, seven rounds 0.2 s apart:

| | casing voices scheduled | taken back | heard | onsets | most at once |
|---|---|---|---|---|---|
| before | 35 | 0 | 35 | 7, from 0.80 s to 1.99 s | 28 |
| after | 35 | 30 | 5 | 1, at 1.99 s | 5 |

The same rule covers FH's cloth and gear foley on its self-loaders (`SoMewa*`
and `SoFa*`, gated to 3.1 s on a G43 at eight rounds a second): 45 FH and 161
FHSW manifest entries fire faster than their longest gate, 2 in vanilla
(the Garand and the Type 5), 4 in XPack1, 2 in XPack2.
`tests/test_hand_fire_patch_clock.mjs` pins it.

## A bystander's rounds (2026-10-12)

`world-fire.js` plays another soldier's fire patch whole (near and far
layers, the casings, the bolt) out of pooled `EngineAudio` patches, up to
three a weapon name. A round took whichever slot was free and held it a
second, so the pool answered for the clock: a bot's Garand at six rounds a
second lost every round that found no free slot, and each slot that did play
rang its own casings 0.8 s later.

`WorldFire.play(name, position, owner)` now gives a shooter's round the slot
his last one took, busy or not: one patch a shooter, so one clock (SND-33),
and the report stacks on its own tail as it does in the game (SND-14).
Another shooter never takes a slot inside its hold, and the hold of a report
now runs 0.1 s past the patch's last `Time` gate (the K98's bolt at 1.18 s
was open to a second rifleman from 1.0 s). When a hold ends, what is still
armed behind a `Distance` band nobody stood in is spent, as the Reload slot
already did, and the slot is nobody's. The owner is the bot (`map.html`
`onShot`) or the replayed soldier (`replay-bodies.js` `fire`); a caller that
names none (the player's own stab, a rocket pack) keeps the free-slot rule.

Measured on FHSW Battle_Of_Foy, headless Chromium, every
`AudioBufferSourceNode.start` logged, `M1Garand` fired eight times at six
rounds a second from 3 m with the pool already at three slots:

| | reports heard | dropped | casing onsets | casing voices |
|---|---|---|---|---|
| no shooter named (the old rule) | 4 | 4 | 4, from 0.48 s to 1.59 s | 24 |
| one shooter | 8 | 0 | 1, at 1.58 s (0.8 s after the eighth round, less a frame) | 6 |

One of the six is the script's second `patron2` load, which the patch's
coherence guard starts muted. `tests/test_world_fire.mjs` pins the clip, two
shooters with a patch each, the hold past the bolt and the spent echo.

## Open

* The pool is still three patches a weapon name and twelve live in all: a
  fourth rifleman of one weapon inside the others' holds is not heard.
* The player's own stab and the rocket pack name no shooter.


# The clip's eject: slot 6 (2026-10-12)

The M1 Garand's ping was not played. `FireArms::EjectClip` triggers patch 6
of the script once, when the fire cycle of a magazine's last round is over,
on a weapon whose template writes `ejectClipTime` (ledger FA-7, SND-35).
`hand-fire.js` `stepDryMagazine` already called `hw.fire?.playEject?.()` at
that moment and nothing answered it.

| | change |
|---|---|
| extractor | `extract_weapon_sounds._eject_edge`: patch 6 as `entry["eject"]`, the reload's shape (`picks`, `<Name>.r6.<load>.mp3`, and `layers`). The word is the gate: a seventh patch without `ejectClipTime` ships nothing, and nor does the word over a shorter script |
| shooter | `hand-fire-sound.js` `playEject`, the slot's picks on the hand bus through `playSlot`, so the patch-clock rule holds (SND-33) |
| bots | `bot-referee.js` `magazineTick` throws the clip (`env.onEject`) before it starts a change, and the change waits `ejectClipTime` (FA-7); `map.html` -> `page-audio.js` `playWorldEject` -> `world-fire.js` `playEject`, pooled as `<name>#eject` with the bot as owner. The Garand's ping carries `Volume <- Distance` 1 to 10 m, 0 at 20, so unlike a reload it is heard |

Manifests regenerated in place for bf1942, XPack1, XPack2, FH and FHSW: one,
one, one, two and four entries gained `eject` and no other field of any
entry moved (FH also gained `KatanaYellFireArm`, an alternate fire the
extractor already listed and the tree predated). Nothing published.

Checked: `tests/test_weapon_burst_edges.py` `ClipEjectTests`,
`tests/test_reload_sound.mjs` (the shooter's one ping, a bystander at 5 m
and at 30 m, a bot's eject then reload). In the page on FHSW Battle_Of_Foy,
kit `2Us_AssaultGarand`, slot 3: eight reports, one `M1Garand.r6.0.mp3`
start 0.12 s after the eighth press, none after one round of the next clip
(`~/.cache/fhsw-bake-tmp/le/eject.cjs`).

Open: a replayed soldier's and a room's remote player's eject are not
played (no eject goes over the wire, and the replay has no magazine count).
