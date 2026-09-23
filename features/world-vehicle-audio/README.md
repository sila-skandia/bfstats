# World vehicle and soldier audio: the FPOV gap

Reported 2026-09-23, while the bot AI was being built:

> when a bot is driving a vehicle there are no sounds. It is likely that we
> haven't implemented anything like this yet, as so far we assumed FPOV

Correct on both counts, and the assumption was wearing three coats. `map.html`
built **one** `EngineAudio` and **one** list of gun patches for the seat the
local player held; `playHandFire` is a single muzzle pick played 2D at the
shoulder; `playSoldierOneShot` is 2D and only ever fed from the local
`soldier`'s footstep clock and hurt grunts. A bot that took the driver's seat
of a Sherman drove in silence, a bot that fired a BAR across the field was
silent, and a squad crossing a field was silent.

## The data was never the problem

`engine-audio.js` is already multi-vehicle and multi-listener. The evidence is
in the scripts and in its own comments:

* A land engine's layers carry `Volume <- Distance` ramps written for a
  listener standing off the hull — meaningless if only the driver's own
  cockpit ever hears the patch.
* An aircraft's gun `.ssc` hands over from `CAMG1/CAMG2` (inside 4 m) to
  `CAMGdist/BFMGdist` (4 m to 250 m) so a chase camera hears the same gun as
  the cockpit. That hand-over exists for an *external* listener.
* A hand weapon does the same: Thompson's fire loop is two loads of
  `thompmlp.wav`, the first dying at 1 m and the second rising from 10 m to
  150. The K98's fire patch is **ten** layers — the report, the bolt foley,
  and four echo shells stepped out to 100 / 200 / 300 / 380 m.
* `EngineAudio.#play` starts every loop at a random point in its own buffer,
  and `features/vehicle-sound-coverage/README.md` D7 records why: "it is what
  stops two Corsairs locking together". DICE's own `randomStartPitch` is
  labelled in `engine-audio.js` as "DICE's own anti-phasing fix: without it
  two Corsairs running the same" sample comb.

So the machinery anticipates several hulls and an off-body listener. The page
only ever handed it one.

## What shipped

### `viewer/vehicle-audio.js` — every occupied hull

One entry per **vehicle**, claimed by the seats occupied on it.

* The driver's claim carries the drivetrain (and so the hull's `Engine .ssc`).
  A passenger's or a bare furniture mount's claim carries only its guns. Two
  Shermans are two entries and two notes; a driver and a hull gunner in one
  Sherman are one entry and one note.
* Gun patches are built once per hull and gated by the union of every claim's
  gun groups. `weaponFor` matches a firing group by **node identity first** —
  two Shermans both carry a bare `Coaxial_browning` and a suffix-stripping
  name match hands both groups the first hull's patch (the same class of bug
  as `bf109-cockpit-and-vehicle-gun-audio` D2).
* `chainOnShot(guns, …)` already fires for every group in the page, bot ones
  included, so a bot's trigger reaches its own hull's patches with no further
  wiring.
* The listener is the camera. First person, chase, fly-by, or standing on a
  hill watching a bot's tank cross a field: distance is the data's own
  `Volume <- Distance`, exactly as it already is for the map's area sounds.
* Budget: `MAX_LIVE_VEHICLES` (5) nearest hulls keep a graph. Beyond that,
  and past `AUDIBLE_RANGE` (300 m — beyond the longest vanilla ramp), a hull
  is held at master 0 rather than torn down, so a return to range does not
  re-roll every layer's phase.
* Lifecycle matches the single-seat path: `release` plays the shut-down
  one-shots, teardown waits `RELEASE_MS` (2400 ms), and a re-claim inside
  that tail keeps the graph.

### `viewer/world-fire.js` — gunfire from anyone but the player's own ear

`playHandFire` stays the shooter's path: one muzzle-audible sample, 2D, at
the shoulder. That is right for the player and wrong for a bot across the
field, because the sample is the *near* pick of a patch whose far layers hand
over on `Volume <- Distance`.

`world-fire.js` plays the whole firing patch through the same
`loadEngineAudio` a tank's coax uses, pooled per weapon, spatialised at the
shooter. The one twist is `loop: false` on every layer: a Fire Loop patch is
a held trigger's continuous rattle, and `EngineAudio.trigger` skips loops on
purpose. A bystander hears **rounds**, so each layer is forced to one cycle
and every shot is one `trigger` — and the near and far samples still hand
over on their Distance ramps, which is the whole point of shipping them.

`extract_weapon_sounds.py` now emits `layers` beside the first-person pick,
through the same `_firing_patch` + `_sound_layers` the vehicle guns use. A
manifest from before that field existed gets `FALLBACK_RAMP` (full at the
muzzle, gone at 80 m) over the pick; the entry is `fallback: true` in the
snapshot so a test can tell the two apart. Re-extract the armoury to get the
real ramps — vanilla's has been re-extracted (27 weapons, all with layers).

### Positional soldier foley

`playSoldierOneShot` takes an optional world position. Omitted is the
first-person ear (2D, as always); given, a panner with a 1 m reference and a
40 m cut — the soldier manifest is foley, not a sound script, and carries no
Distance ramps of its own.

* **Bot fire** (`botFireTick`): `playWorldShot` at the shooter's head.
* **Bot hurt** (`botDamageLanded`): the grunt is the soldier's, positional,
  on its own cooldown so a bot hit a second after the player took a round is
  not swallowed.
* **Bot footsteps** (`botFootstepTick`): the player's steps come off
  `soldier.drainFootstepEvents()`, a clock in the first-person soldier. A bot
  has no such body, so the cadence is driven from how far the controller
  actually moved, at the engine's own periods — `setRunFrequency 0.36` /
  `setWalkFrequency 0.66`, verbatim from
  `Objects/Soldiers/Common/Sounds/SoldierSound.inc`. `handleSoldierFootstep`
  does the surface pick (its collider probe is keyed off the local `soldier`,
  so a bot's step falls back to the heightfield material — close enough for a
  boot, and a per-shooter probe is a follow-up).

`map.html` keeps the seam: who claims what on board and leave, the decode
cache, the listener/limiter, and the player's ambient duck (still
player-centric — ducking the surf because a *bot's* tank is nearby would be
wrong).

## Still open

* **Which seats start the engine in the binary.** The rack starts the note
  when a *drivetrain* is claimed (someone is at the throttle), which is what
  the single-seat path did and what `state.throttle` existing implies. Whether
  retail starts the engine for a passenger in an otherwise empty hull is not
  read out of the client. Labelled **inferred**.
* **The engine's own voice pool.** `MAX_LIVE_VEHICLES` and `MAX_LIVE_SHOTS`
  are budgets for this page's CPU and limiter, not a reproduction of DICE's
  fixed 32-voice mixer. What the engine does when more than 32 voices are due
  is **open**.
* **A bot's surface probe.** `handleSoldierFootstep`'s material cast reads the
  local `soldier.collider` only; a bot's step uses the heightfield material
  even when it is walking on a road mesh. Per-shooter probe is a follow-up.
* **Remote humans.** A room's other players are replicas owned by
  `netcode-render.js`, not `world.players`, so the bot hooks do not reach
  them. The rack and `world-fire` are written for any claimer; the netcode
  just has to claim.
* **Mod weapons.json.** Only vanilla's armoury has been re-extracted with
  `layers`. A mod tree still on the old manifest plays under `FALLBACK_RAMP`
  — audible and positional, with the viewer's distance law rather than the
  script's.

## Pinned by

`tools/bf1942-models/tests/test_vehicle_audio.mjs` (run by
`test_vehicle_audio.py`) — a bot-driven hull builds an engine graph (the gap
itself), two hulls are two notes and one shared hull is one, `weaponFor`
distinguishes two `Coaxial_browning`s by node, the cap keeps the nearest, a
far hull is held rather than torn down, a re-claim inside the shut-down tail
survives, and dispose stops every source.

`tools/bf1942-models/tests/test_world_fire.mjs` (run by `test_world_fire.py`)
— a bot's shot plays both sides of the hand-over as one cycle per round (not
a held loop), a pre-layers manifest falls back and says so, the pool recycles
inside a burst, and dispose stops every source.

`tools/bf1942-models/tests/test_weapon_sounds.py` — `test_the_entry_ships_the_whole_firing_patch_for_a_bystander`
asserts the extractor writes `layers` with their modulators, beside the
first-person pick the player still fires through `playHandFire`.
