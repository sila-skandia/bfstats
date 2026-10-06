# Vehicle and stationary gun deviation

Status: built 2026-10-07 (Desert Combat parity round, package `vehicle-deviation`).
Every vehicle, stationary and aircraft gun now launches its rounds in its own
deviation cone, for the local player, the bots and any other world player.
Hand weapons are unchanged.

## What was wrong

`FireArms::fireBarrel` applies one deviation law to every FireArms (ledger
DEV-9). The viewer only handed hand weapons a cone (`spreadDeg`), so every
round from a hull, a stationary gun or an aircraft flew exactly down its line.
The Sherman's hull Browning ships `setMinDev 0.5`, and its rounds never
scattered. The seat cross already opened by the gun's cone (62469b88), so the
cross and the rounds disagreed.

## The engine's law

| Row | What it says |
|---|---|
| DEV-9 | Each round is pushed off its line by `u x total / 100` on the launch frame's up and right rows, `u` uniform in (-1, +1] per axis: a square in hundredths of a radian. Nothing is drawn at a total of 0.01 or less |
| DEV-11 | A seat gun is a plain `FireArms`: `total = minDev + fire + AI`. The bloom is raised by `fireDev` b once a pull, capped at a, and decays by c a tick, with no stance divisor. There is no speed, turn or misc channel, so the hull's motion and the turret's traverse feed nothing. The seat's `PlayerControlObject::handlePlayerInput` runs the update on each of its weapons once a tick while anyone holds the seat |
| DEV-12 | The total is stored. A round and the cross read the stored value, and `Fire` raises the bloom without updating it. So the first round of a burst flies at the floor, and a pull's bloom shows from the next tick |
| DEV-13 | A bot's trigger statement runs `setBotSkill`, which runs the update once more, every tick it executes. So a bot's bloom decays twice a tick while he fires |
| AI-145 | A bot's two draws are always index 617's point, (0.9517, 0.2325) of the total; barrel i of a pull takes the point of index 617 + i |
| AI-68 | The bot's AI term, which rides on the FireArms' total |

The binary was read for DEV-11 to DEV-13. `FireArms::updateDeviation`
0x0828d410, `PlayerControlObject::handlePlayerInput` 0x08318900, the
`FireArms` vtable's slot +0x128, every writer and reader of `+0x188`,
`FireArms::Fire`'s raise against its barrel loop, and `WeaponFireArm::
setBotSkill` 0x085ee580 / `WeaponBundle::setBotSkill` 0x085ed050 are in the
rows and in `symbols.json`.

## What the viewer does

- `viewer/fire-state.js` `FireState` keeps the stored total (`total`, read as
  `spread`) a 1/30 s tick at a time (`stepCone`), and runs a bot's extra update
  while `holdAI` is armed. The world steps it while the seat is held
  (`world-vehicle-tick.js`, unchanged), and `registerShot` raises the bloom
  without touching the total.
- `viewer/seat-cone.js` builds the `GunFire.coneOf(group, barrel)` hook. It
  returns the state's total, plus a bot's AI term (`bot.deviation.aiPending`),
  and the dice the draws come from: the guns' own `rand` for a human, the
  fixed point for a bot (`bot-deviation.js`). It also arms the bot's extra
  update. A group whose seat holder the page cannot name gets no cone, which
  covers replayed rounds and hand weapons' groups.
- `viewer/round-launch.js` `muzzleVelocity` asks the hook for any group
  without `spreadDeg` and threads the barrel index through from
  `gunfire.js` `fireShot`. `deviate`'s law is unchanged.
- `viewer/gun-groups.js` `cameraLaunch` now hands the turned camera frame
  (`ray.frame`), so a coax's or pintle MG's square sits on the seat camera's
  own up and right and rolls with the hull.
- `map.html` and `sim/stage.mjs` wire the hook beside `roundsLeft`, and
  `sim/env.mjs` loads the module (absent from an older `--viewer`). The model
  browser wires nothing and is unchanged.
- `vehicle-hud.js` needs no code change: the cross already reads
  `FireState.spread`, which is now the same stored total the rounds use.

`viewer/bot-deviation.js` and the `export` on `deviate` are byte-identical to
the bots package's (worktree-agent-a28699fc8f9384781, a5e39fb6), which was
not yet on main. The two branches merge in either order without a conflict.

## How it was checked

**Harness.** `tests/vehicle_deviation_harness.mjs` fires through the page's
own `GunFire` and `seat-cone.js` on the shipped glbs' FireArms blocks, and
`tests/test_vehicle_deviation.py` runs it (9 tests).
- **Sherman hull Browning.** 2,000 single rounds at a cold barrel: none
  outside the ±0.5 square, mean |u| 0.493, 24.2% in the corners, KS distance
  0.019 from uniform. A held 3 s burst: totals 0.5, 0.656, 0.812, 0.968, then
  1.056 steady, each equal to the law recomputed from the round ticks alone.
- **Sherman coax.** 0.75, 0.86, 0.97, and so on up to 2.5.
- **Tight guns.** The Sherman's main gun and DC's M2A3 25 mm stay exactly on
  their line, and DC's M163 holds 0.5 for every round.
- **A bot.** Every round lands at (0.9517, 0.2325) of 0.5 + 0.3125. Barrel 1
  of a pull takes index 618's point, and the burst decays twice a tick.
- **Frame.** A camera-launched coax on a hull rolled 25° keeps the point on
  the camera's own axes.
- **Cross.** The cross equals the round's total on every one of 20 pulls.
- **No firer, no hook.** A replayed round and the model browser fly straight.

The replay HUD's seat-cross tests moved by DEV-12. The first round now shows
0.75, not 1.01, and one tick on it shows 0.96. The long burst's last round
shows 2.55, not 2.65.

**Runner.** Headless El Alamein, `~/.cache/dc-sweep/vehicle-deviation/
sim_cones.mjs`, 240 s, four bots seated in tanks (seed 2). The rounds came
from the stationary MG42s, which other bots mounted on their own.
- Every one of the 192 rounds asked for a cone and got the bots' dice.
- The MG42 totals ran from 1.012 (0.7 + 0.3125) up to 2.40, with a mean of
  1.72 and 1.91 on the two guns. The lab's bot MG42 rounds have a median of
  1.71.
- An unseated 240 s match: the Spitfire's and the Bf 109's guns (no words)
  left at the AI term alone, 0.313 to 0.813.

**Real game.** `~/.cache/dc-sweep/vehicle-deviation/seat_dev_fit.py` fits
every seat-gun round of the lab's server recordings: the 19 vanilla and 36
DC recordings that track projectiles, of 37 and 51. It takes each round's
launch velocity off its track, takes out the shooter's own motion, and
measures it in the frame of the recorded fire axis.
- **Bots** (`bot_law.py`, `bot_law_variants.py`).
  - **Fixed point.** The bots' seat and stationary MGs put the offset's median
    direction 74.8° to 76.2° up from the right axis; 617's point is at 76.3°.
  - **DEV-12.** A round's size / 0.980 is its total, and that less the law's
    total is the AI term, whose floor is 0.3125. The residual's mode sits at
    +0.300 to +0.325 for the Browning, the MG42, both coaxial MGs, the NSVT
    and the M163. Read with the pull's own bloom, it sits at +0.05 to +0.075.
  - **DEV-13.** One decay a tick leaves 19% of the Browning's rounds under the
    floor (less 0.0625), 18% of the MG42's and 56% of the coax's. Two a tick
    leave 1.6%, 6.1% and 8.6%. DC's `Iraqi_coaxialMG`, whose bloom never
    outlives a tick, has 2.2%.
- **The human.** The owner fired the Sherman coax in the 2026-10-06 parity
  run; 14 of those rounds could be fitted. All 28 axis draws fall inside
  their square at the DEV-12 total (largest |u| 0.978, mean 0.570). The
  sample is too small to choose between DEV-12 and the other reading.
- **No-word guns.** The bots' tank cannons (Sherman, Panzer IV, Tiger, T-34)
  land at a median of 1.21 to 1.33 hundredths off their line, the AI term
  alone (0.3125 plus up to 1.25 just after a target is taken). The owner's 14
  AA gun rounds scatter with a standard deviation of 0.06 hundredths across
  and 0.2 up and down, about a common upward offset of 0.18. A gun with
  `setMinDev 1` would scatter by 0.58 on each axis.

## Before and after

Before, every gun below fired with no deviation. After, a human's rounds fill
the square of the stored total, uniform on each axis. A bot's land on one
point of it, with his AI term on top. *Floor* is the cold barrel's reach, ±
on each axis. *Held* is the top total a 3 s burst reaches and the rounds'
rms angle off the line, from the harness.

| Pack | FireArms | Rate | Words | Floor | Held: top total | Held: rms |
|---|---|---|---|---|---|---|
| vanilla | `Browning` (hull, pintle, stationary) | 10/s | 0.5, 0.7 0.3 0.048 | ±0.29° | 1.056 (±0.61°) | 0.43° |
| vanilla | `Coaxial_browning`, `Coaxial_MG42` | 12/s | 0.75, 1.9 0.26 0.05 | ±0.43° | 2.5 (±1.43°) | 0.93° |
| vanilla | `MG42` (stationary) | 15/s | 0.7, 0.9 0.25 0.05 | ±0.40° | 1.5 (±0.86°) | 0.61° |
| vanilla | `Browning_Air`, `MG42_Air` (gunners) | 10, 12/s | 0.2, 0.2 0.3/0.25 | ±0.11° | 0.25 (±0.15°) | 0.11° |
| vanilla | `Elco80_SideGunner` | 7.5/s | 0.5, 0.7 0.3 0.048 | ±0.29° | 0.96 (±0.55°) | 0.35° |
| vanilla | `Type38_Oerlikon` | 11/s | 0.5, 0.7 0.3 0.048 | ±0.29° | 1.056 (±0.61°) | 0.43° |
| vanilla | `AA_POW_GunBarrel2` | 3/s | 1 | ±0.57° | 1 | 0.47° |
| vanilla | `fletcher_GunBarrel`, `HatsuzukiGun` | 0.2/s | 1 | ±0.57° | 1 | 0.47° |
| vanilla | `YamatoFatCannon`, `PrinceOW_CannonPipes2/4` | 0.15-0.2/s | 2 | ±1.15° | 2 | 0.94° |
| XPack2 | `FlakPanzer_MG42` | 12/s | 0.75, 1.9 0.26 0.05 | ±0.43° | 2.5 (±1.43°) | 0.93° |
| XPack2 | `HDBrowning`, `M1919A4` | 10, 15/s | as Browning, MG42 | ±0.29°, ±0.40° | 1.056, 1.5 | 0.43°, 0.61° |
| XPack2 | `SturmTigerGunBarrel` | 0.2/s | 2 | ±1.15° | 2 | 0.94° |
| DC | `Browning`, `NSVT` | 8.3/s | 0.3, 0.7 0.25 0.05 | ±0.17° | 0.8 (±0.46°) | 0.30° |
| DC | `Coaxial_MG42`, `Iraqi_coaxialMG` | 12/s | 0.4, 0.4 0.15 0.15 | ±0.23° | 0.4 | 0.17° |
| DC | `MG42` | 15/s | 0.3, 0.7 0.175 0.05 | ±0.17° | 0.9 (±0.52°) | 0.36° |
| DC | `M163_GunBarrel` | 20/s | 0.5, 0.5 0 0.05 | ±0.29° | 0.5 | 0.21° |
| DC | `AC-130_Vulcan` | 20/s | 0.5, 1 0.3 0.05 | ±0.29° | 1.4 (±0.80°) | 0.57° |
| DC | `Stryker_RWS_Firearm`, `M230Cannon`, `Mi24DGGunCannon` | 6-20/s | 0.2, 0.2 0.25 0.05 | ±0.11° | 0.2-0.3 | 0.07-0.12° |
| DC | `Minigun`, `AH6MinigunFirearms` | 20/s | 0.4, 0.75 0.175 0.06 | ±0.23° | 1.03 (±0.59°) | 0.41° |
| DC | `M2A3_TOW`, `BMP2_AT5`, `TOW`, `Mk19`, `RecoillessRifle` | 0.25-1.5/s | 0.5, 0.7 0.3 0.048 | ±0.29° | 0.5 | 0.23° |

Single-shot guns show the floor's rms, 0.468° per unit of total. These
ship no words and are unchanged for a human: every tank's main gun, every
aircraft's guns, `AA_Allies_GunBarrel`, `flak38_gun_fire`, the artillery and
rocket racks, and DC's `M2A3_GunBarrel` (the Bradley's 25 mm), `BMP2_GunBarrel`,
`ShilkaGunBarrel`, `ZPU-4GunBarrel` and `CIWS_GunBarrel`. A bot's rounds from
any of them now carry his AI term, as the lab shows, where before they flew
straight. Three effect FireArms inside rounds (`Aim54Fuel`, `SA3RocketGun`,
XPack2's `WasserFallGuns`) declare `setMinDev 15`. The viewer never fires
them as seat guns.

The survey is `~/.cache/dc-sweep/vehicle-deviation/firearms_survey.py`, and
the table is `spread_table.py`. Both read the installed archives.

## Assets

None to re-extract. The model and level bakes already carry each FireArms'
`deviation` block (73426358). It was checked in the vanilla and DC El Alamein
`scene.glb`, `Sherman.Kasserine_Pass.glb`, and DC's `M2A3.glb` and `M163.glb`.

## Open

- **Hand weapons, DEV-12.** `hand-fire.js` raises `hw.model` in `onShot`,
  before the round, and `hand-weapon.js` reads `current()` at launch. A hand
  weapon's round therefore still carries its own pull's bloom, one shot early.
  This belongs to the hand-weapons package.
- **Bots, AI-68's C.** `EntryTrigger` passes 30 or 10 against an air target,
  and `EntryTriggerContinously` 3 or 1. `bot.js` never passes it
  (`aaPenalty` 0), so a bot's AA and MG fire at aircraft runs without it.
  This belongs to the bots package.
- **Bots, DEV-13's window.** The viewer's bot plan does not tell the guns when
  its trigger statement runs. `holdAI` stands in, holding the extra update
  from each of a bot's rounds to the gap before his next, plus a tick.
- **A human's draw index.** The engine seeds a human's draw from his input
  index (AI-145's path), so a server and its client agree on every round. The
  viewer draws from `guns.rand`, which is the same distribution but not the
  same rounds. That matters only once the room server fires rounds; its World
  has no guns yet (netcode P3).
- **Barrel −1.** A FireArms with no barrel positions fires `fireBarrel(-1)`,
  so a bot's draw index is 616. The viewer passes barrel 0.
- **Human seat-gun samples.** Only 14 of the owner's seat-gun rounds were
  fittable, all from a moving Sherman. A lab round from a parked hull or a
  stationary MG would test the square on a human seat gun directly.
