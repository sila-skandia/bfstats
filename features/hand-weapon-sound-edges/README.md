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
