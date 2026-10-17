# FHSW hand weapons in the lab (2026-10-17)

The rows FHR-1 to FHR-6 rested on reading the binaries. This page is what the
lab server recorded when sidecar soldiers pressed the buttons, with no game
client and nobody at the keyboard, and what still needs a capture of the
retail client.

## How it was recorded

* A private lab beside the shared one (`tools/bf1942-models/lab/README.md`,
  "A second lab beside the shared one"; `BF42_LAB_PORT_OFFSET=10`, port 14578),
  FHSW 0.81 `Battle_Of_Foy` Conquest, no bots
  (`lab/scenarios/fhsw-battle_of_foy-cq-firearms-rec.json`), and vanilla
  `berlin` Conquest for the German knife.
* The server recorder built from this branch: the `anim` record carries a
  mod's whole table (FHSW's was over the old 8,192 cap and never written), each
  state's clip slots, and a clipless state's random-transition names.
* `lab/firearms_probe.mjs`: two sidecar soldiers on the US side. Kit 0 is
  `1Us_ClosequartersGreasegunSmoke2R` (Greasegun, no `autoReload`;
  `Knife_M1Bayonet`), kit 1 `2Us_AssaultGarand` (`M1GarandBay` with
  `BayonetM1Garand`, `Knife_M1Bayonet_ID2`, `GrenadeAllies`). The server's
  rounds are the recorder's `f` rows (one per barrel), its soldier states the
  `st` rows.
* Buttons are sent as held bits. The retail client sends a `fireOnce` /
  `altFireOnce` weapon's button only on a fresh press (ZOOM-1), so for those
  weapons only the taps (two ticks) stand for a player; the holds are
  recorded below but say nothing about retail.

Runs (under `~/.cache/agfhr/lab/runs/`, server files `server/replay_*.ndjson`):

| Run | What |
|---|---|
| `20261017-093245-fhsw-battle_of_foy-cq-firearms-rec` | Greasegun dry, Garand clip, bayonet blocking, both knives, two Allied grenades |
| `20261017-100430-fhsw-battle_of_foy-cq-firearms-rec` | The table with the hubs' random names (the fixture of `test_animstates.ServerStateTableTests`) |
| `20261017-101236-fhsw-battle_of_foy-cq-firearms-rec` | Bayonet holds and taps |
| `20261017-095052-vanilla-berlin-cq-knife-rec` | Vanilla `KnifeAxis`, eight clicks |

## What it showed

**FHR-1, the copied knives: refuted. They swing.** On every click of
`Knife_M1Bayonet_ID2` the server's soldier went `Ub_Fire` ->
`Ub_FireKnifeAllies1`, `2`, `2`, `4` (four clicks), and on `Knife_M1Bayonet`
`Ub_FireKnifeAllies2`, `2`, `4`; each a state with both clips (mask 3), and
five knife rounds (`f`) on each click. The table says why: the hubs
`Ub_FireKnife_M1Bayonet_ID2`, `Ub_FireKnife_M1Bayonet` and `Ub_FireKnifeAxis`
have no clip and hand to `Ub_FireKnifeAllies1..5`, and
`Knife_SG98Bayonet_ID2` to `Ub_FireKnife_GER1..5`. `copyState` (lnxded
`0x08327c70`) renames the name, the transitions (+0xe0), the idles (+0xd4),
the two return states and the two other-states (seven `replaceSubString`
calls); the random-transition names are a `vector<string>` at +0xc
(`ConsoleClass64::executeObjectMethod` `0x0833c490` pushes them, indices at
+0x18) that `copyStateData` `0x08327780` copies and nothing renames.
`AnimationState::update` `0x08329f00` draws `rand() % n` over them. The
client's `copyState` `0x00616200` makes the same seven calls (`0x00612490`
over the name, +0x120, +0x110, +0x3c, +0xe4, +0x168, +0x184). Vanilla is the
same: a German's `KnifeAxis` swung `Ub_FireKnifeAllies5, 4, 2, 1, 1, 2, 5, 3`
on eight clicks and never a `Ub_FireKnifeAxis<n>`. The copies of the swings
themselves (`Ub_FireKnife_M1Bayonet_ID21..5`) are deleted, as ANIM-16 says;
the hub just never asks for them. The parser and the rig and pose
extractors follow it from `9b25ab55`; the rigs and pose trees are not yet
re-extracted.

**FHR-3, a dry magazine waits for the key: verified on the server.** The
Greasegun held from a full magazine fired 30 rounds in 3.87 s and then
nothing for the 6.1 s it stayed held, three more pulls fired nothing, and no
reload state came until the reload key (`Ub_StandReloadGreasegun` 0.03 s after
it); a pull after the reload fired. The Garand: eight clicks, eight rounds,
the ninth and tenth nothing, no reload until the key.

**FHR-4, the bayonet rifle: verified on the server, from taps.** Left fires
`M1GarandBay` (one round), right thrusts `BayonetM1Garand` (five rounds, 0.07
to 0.1 s after the press, the `fireDelay`), with `Ub_AltFireM1GarandBay`. A
right tap 0.02 to 0.09 s after a round: no thrust. A left tap 0.2 s after a
thrust: no round. A right tap 1 s into a reload: nothing; a tap after it: a
thrust. Held buttons (not what a retail client sends for these weapons): a
right hold that began inside the rifle's 1/6 s thrust once it ended, and a
held right button thrust again every 2.2 s; a held left fired again after 0.84
to 1.03 s.

**FHR-5, the Allied grenade's weapon state: verified in the server's table.**
`WeaponFireGrenadeAllies` holds no clip (mask 0) and is made right after
`WeaponFiretaimatu` (indices 25356 and 25355), before the real one could be
copied. The soldier's own throw state `Ub_FireGrenadeAllies` has both clips;
the server entered it on each throw and the grenade left 0.96 to 1.0 s after
the press. That the grenade model then draws no pin pull is the client's
drawing and is not recorded.

**FHR-2 and FHR-6 are the client's alone** (the server builds no sound and
draws nothing). Both readings were taken again from `BF1942.exe` and stand:
`FireArms__Fire` sends message 0 to every child after the round
(`0x0053dcbd`..`0x0053dd05`, skipped when template `+0x534` is set);
`EffectBundle` slot `+0x98` `0x00568f70` acts only when the template's
`timeToLive` (`+0x200`) is below 0.0 (`0x008c41ac`) and on message 0 calls the
bundle's sound `+0x110` vt+0x10 (`0x0056912b`..`0x00569137`);
`shells_High.ssc` gates each patch with `Time Ramp 0.07 0.07 0 1`. The
`EmitterTemplate` constructor clears its seven flag bytes `+0x4dc`..`+0x4e2`
(`0x0050b75f`..`0x0050b783`).

## What would settle FHR-2 and FHR-6

One sitting in retail FHSW 0.81, `Battle_Of_Foy`, US side, the deploy
screen's second kit (`2Us_AssaultGarand`), OBS at 60 fps with the game's
audio:

1. **FHR-2** (15 s): stand still on open ground, key 3 for the M1 Garand,
   eight clicks about half a second apart, then wait 3 s. Heard: a tick about
   70 ms after every report, and the clip's ping 0.6 s after the eighth. Then
   key 4 is not needed; a Greasegun burst from the first kit adds an MG case.
2. **FHR-6** (20 s): same kit, lie down on flat ground, look 30 to 45 degrees
   down and to the right, eight slow shots. Frame-step: does a casing stay
   drawn after it passes the ground line. Repeat standing, looking down.

The bf42plus client recorder adds nothing to either (it records no sound and
no first-person particles).

## Recordings on this PC the tracker missed

* `~/bf1942-lab/runs/20261013-212407-fhsw-arnhem-coop-rec/client/replay_20261013-212556.ndjson`:
  a bf42plus client recording in FHSW (Arnhem co-op, the owner on the British
  side). It has the owner's `No4`, `No4Grenade`, `No2` and `Piat` rounds and
  none of the FHR weapons, and no `anim` row.
* The same run's server recording, and `20261016-213537-fhsw-operation_springawakening-cq-rec`
  (no soldiers spawned).
* `~/2026-10-12 21-43-19.mp4` and `21-49-24.mp4` are captures of the map
  viewer (`localhost:5273` on `Battle_Of_Foy`), not of the game.

## The `fireDelay` count, recorded (2026-10-17)

Ledger GUN-13 / FA-13 say a FireArms timer counts whole 1/30 s ticks on a
float32 countdown. A delay that is not a whole number of ticks in real
numbers tells the two readings apart: vanilla's ExpPack and Landmine
(`fireDelay 0.4`) count 13 ticks in float32 against 12 in real numbers;
GrenadeAxis (`0.8`) counts 24 either way and is the control.

* `lab/scenarios/bf1942-berlin-cq-firedelay-rec.json` (private lab,
  `BF42_LAB_PORT_OFFSET=40`), `SCRIPT=delay` and `SCRIPT=delayhold` in
  `lab/firearms_probe.mjs`, both with `TURN=1`: the soldier turns on every
  word, so his `s` row is written on every tick and the rows count ticks (the
  recorder's `t` is a wall clock, and the lab's ticks are not evenly spaced
  in it). The press is the tick the player's `p` row's last field (the fire
  button as the server holds it) goes 1; the round is the `f` row, which is
  written inside its tick, before that tick's sample.
* Runs: `~/.cache/agperf/lab/runs/20261017-133830-bf1942-berlin-cq-firedelay-rec`
  (taps) and `20261017-135951-...` (a held button, then a press on every other
  tick).

**Press to round.** All eight ExpPack and Landmine rounds left 12 ticks after
the press's tick; the GrenadeAxis 23. So the press's own tick counts down the
first tick (its message 6 runs before the objects' `handleUpdate`, IMP-8),
and the round leaves on the float32 count's last tick: `timerTicks - 1`
ticks after the press (`viewer/fire-timer.js` `delayTicks`). For Secret
Weapons' `CommandoKnifeStab` (`0.3`, 10 in float32) that is 9 ticks.

**The next press after a delayed round.** Pressed on every other tick, ExpPack
(`roundOfFire 1`, a 30-tick fire timer) fired its rounds 44 ticks apart: 12 of
delay, then the first even tick at or after 31 past the round. 30 would have
given 42. `handleUpdate` counts the fire timer down (lnxded `0x08288a0e`,
decrement `0x08289388`) before the delay (`0x08288a9c`), so the timer the
delay's `Fire` sets first counts down a tick later: `fireTicks + 1`
(`delayedFireCycle`). A held button placed one pack and no more.

**Not recorded: Secret Weapons.** The sidecar does not get past an SW
server's challenge: its Challenge carries `xpack 783`, the sidecar echoes it in
ChallengeResponse, and the server sends nothing more (no SetLevel, no
denial). `lab/scenarios/xpack2-raid_on_agheila-cq-knife-rec.json` and
`SCRIPT=stab` are ready for when it does.
