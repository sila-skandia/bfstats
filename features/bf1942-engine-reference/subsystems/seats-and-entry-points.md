# Vehicle seats and entry points

Settled 2026-09-16 for the map viewer's `seats.js`. All addresses
`bf1942_lnxded.static` unless marked client. Entering, switching between, and
leaving anything a soldier can spawn into — a Defgun, a Sherman's five seats,
a ship's AA mount — turns out to run through a small, generic set of
functions shared by every `PlayerControlObject`, with two gates (a
per-player cooldown and a team/hostility check) that a naive
"press E, teleport into the nearest thing" implementation will miss.

## 1. Entering and leaving: one input, two independent gates

Vehicle entry/exit is triggered by **`c_PIUse`** — `PlayerInputMap` index
10, not a distinctly-named "enter" or "exit" input — on a rising edge above
the digital threshold `0.5` (SEAT-1). This was read byte-for-byte out of the
56-slot `operator<<` jump table at `0x081d89f0` and its string pool, and
`GameServer::checkPlayerTriggers` (`0x0814f2c0`) tests bit 10 first; it is
the only trigger that reaches `toggleEntryPoint`.

Two layers gate what happens next (SEAT-2), and both matter:

1. A hard-coded **1.0-second per-player cooldown**, tracked at `+0x98`
   against `WorldPref::mWorldTime` (`0x087435a0`).
2. `toggleEntryPoint` (`0x0814ee70`) itself compares the player's *cached*
   vehicle (`+0x74`) against `player->getVehicle()` (vtable `+0x3c`); only
   on a match does it additionally require a `GameServer+0x66` byte before
   actually calling `toggleEntryPoint(player, false)`.

A viewer that just "always toggles on press, once cooldown allows" will
diverge from retail specifically around vehicle-transition edges — entering
one seat while another toggle is still resolving, for instance.

## 2. Finding a target: nearest in range, with a double team gate

`findEntryPoint` (`0x0818df50`, SEAT-3) picks the **nearest** in-range
`EntryPoint`, explicitly excluding the player's own current vehicle's entry
point, walking an `ICompositeObject` parent chain (`+0x50`,
`IID_ICompositeObject` `0x086c2a58`) looking for the nearest
`IPlayerControlObject` (`IID_IPlayerControlObject` `0x086d3c50`).
`IID_IEntryPointObject` (`0x086c2a24`) both identifies the exclusion target
and filters candidates.

**`validateBFEntryPoint` adds a second, independent team gate (SEAT-4).**
Beyond `BFfindEntryPoint`'s own team/neutral test, `validateBFEntryPoint`
(`0x0831d590`) chooses between the caller's own search radius and the
`EntryPointTemplate`'s authored `entryRadius` (`+0x138`) via a bool, range
tests against absolute position, and then separately calls
`queryComponent(0xc4a4, 0xc4a4)` — walked up the `+0x50` parent chain if
needed — followed by `call [component_vtable+0xc8]`, rejecting the entry
point on failure. A viewer needs to reproduce **both** gates to match
retail's filtering; passing only the team check that lives in
`BFfindEntryPoint` will let a player enter entry points retail would refuse.

## 3. Entering and the vestigial low-level calls

`EntryPoint::enter`/`exit` (`0x081ae030`/`0x081ae070`, SEAT-6) are
near-vestigial: `enter` ignores both of its parameters and simply forwards
to the linked PCO's `init()`; `exit` unconditionally returns `1`.
`PlayerControlObject::enter(player, force)` (`0x08316f00`) refuses only when
the seat is already occupied **and** `force == false` — so a caller that
passes `force = true` steals an occupied seat outright.

**Who passes `true` (SEAT-11, closed 2026-09-19): only `exitVehicle`.**
`enter` is reachable only through `IPlayerControlObject` vptr+0x20 (the thunk
`0x0831ab50` at `vtable for PlayerControlObject` `0x0873eec0` + 0x1d8, the
secondary vptr being sym+0x1b8), and its single call site is `0x0814e90a`
inside `GameServer::enterVehicle(BFPlayer*, IPlayerObject*, bool, bool)`
(`0x0814e860`, itself `GameServer` vtable vptr+0x6c), which forwards its
**fourth** declared parameter as `force` (`[ebp+0x18]` → `[ebp-0x16a]` at
`0x0814e87b`; the third goes to `[ebp-0x169]` and is not it). Reading the five
callers' push order:

| caller | `force` |
|---|---|
| `checkPlayerTriggers` — the seat switch (`c_PIMenuSelect`) | **false** |
| `toggleEntryPoint` — `c_PIUse` entry | **false** |
| `spawnPlayer` | false |
| `killPlayer` | false |
| `exitVehicle` — re-entering the player's own soldier | **true** |

So **a seat switch into an occupied seat is refused, not stolen**, and so is
ordinary entry. A viewer that keeps refusing an occupied seat is matching
retail, and this row stops being a hazard the viewer has to hedge against. (No
direct call to `enter` or its thunk exists anywhere in the disassembly; that
`0x0814e90a` is the only *indirect* `call [reg+0x20]` reaching it was not
exhaustively proved, and no counter-example surfaced.)

## 4. Switching seats: a map built once, at spawn, root PCO only

Seat switching uses **`c_PIMenuSelect1..9`** (indices 14–22): the target
position id is `key − 1`, looked up in a `map<int, IPlayerControlObject*>`
(SEAT-7). That map is built by `PlayerControlObject::init()`
(`0x08316790`) calling six helpers — `collectWeapons`,
`findPlayerInputObjects` (unconditional), then, **only when `this+0x50 ==
0`** (i.e. only for a root PCO): `postInitPcoId`, `postInitCameras`,
`findPlayerControlObjects` (`0x08280880`, the function that actually builds
the map), and `findSpawnPoints`. **A non-root child PCO never rebuilds its
own copy of the map** — there is exactly one seat-switch table per vehicle,
owned by the root. The switch additionally requires the target seat's own
`init()` to have run, a `GameServer+0x64` byte, and that the requesting
player is not an AI (vtable `+0x5c`).

## 5. `SeatFlags`, pose, and the first-person override

`SeatFlags` (SEAT-8): `HalfBody=0x1, FullBody=0x2, HeadOfSoldier=0x4,
IsOutside=0x8, Standing=0x10`, stored at `SeatObjectTemplate+0x158` with
`|=` on each `setSeatFlags` call (`0x08321900`, enum read via `operator<<`
`0x083207f0`). `SeatObject::enter` passes `seatFlags = 0` — a fully-hidden
soldier — when none of `Half|Full|Head|Standing` (mask `0x17`) are set.

**Two animation-name strings, resolved (SEAT-9).** `+0x15c` is
**upperBody**, `+0x160` is **lowerBody**, feeding
`BFSoldier::setUseSeat` (`0x08271950`) — resolved this round via
`SeatObject::enter`'s push order cross-checked against `setUseSeat`'s own
branch semantics. When either string is empty, the soldier's own template
supplies a numeric fallback id: `+0x294` (lower body, non-standing),
`+0x298` (upper body, always used regardless of stance), `+0x29c` (lower
body, standing).

**Camera type 3 forces first person — and anything else explicitly forces
it off (SEAT-10, confirmed both directions).** `setUseSeat` compares a
seat's first camera-list entry's reporting type against the literal `3`,
and *both* branches explicitly call `setFirstPerson` — a viewer must not
assume "leave the player's own third/first-person toggle alone" is safe for
the non-3 case; the engine actively overrides it.

## 6. Leaving

`isAllowedToExit()` (`0x08317490`, SEAT-5, 561 instructions read in full)
is a **pure geometry/collision check** — there is no speed or altitude term
anywhere in it — and it only runs at all when the vehicle template's
`hasRestrictedExit` (`+0x192`) is set; otherwise exit is unconditionally
allowed. The function's body is `setRotation` ×2, `Mat4::mult` ×2,
`getRootParent` ×2 (a submarine's tail check) and pure
geometry/hierarchy vtable accessors — no physics state is read. `getSubPos()`
(vtable `+0x140`) is the genuine first check inside `isAllowedToExit`
specifically, but the equivalent call inside `exitPlayer()`
(`0x083183d0`) is reached only deep inside one particular sub-path (a
remote occupant, no child, null root) — not as a universal first step of
exiting in general.

**Exit places the soldier at a per-seat offset (SEAT-12).** Every
vehicle's `soldierExitLocation` places the exiting player at a fixed offset
and rotation relative to the seat. A full 16-archive survey of every
negative `exitTimer` (180 rows) found each one belongs to a boat, raft, or
an AI-only `Remote*` position (Daihatsu, Lcvp, Elco80Raft, Type38Raft,
Barkasse, Riverboat, Sampan, CDNRaft, Sturmboot, and others) — the pattern
holds without a single exception in the survey, though `exitTimer`'s
consuming function itself was not found.

## 7. Extracted (2026-09-17)

**Seat pose animation strings (SEAT-9).** `seatAnimationUpperBody` and
`seatAnimationLowerBody` are now parsed (`con.py`) and emitted as
`extras.seat.poseAnimation` on the SeatObject node: `{upperBody: "Ub_…",
lowerBody: "Lb_…"}`. Only passenger seats declare them — a survey of all 14
installed mods turns up 34 uses, all on passenger seats in vehicles, never on a
driver's seat or a manned gun's. Names like `Ub_PassengerInWilly`,
`Lb_PassengerInHanomag`, `Ub_PassengerInKubelWagen` resolve directly off the
animation state machine (`animations/AnimationStates*.con`), so a pose extractor
can retarget them without inventing a mapping. `viewer/seats.js` captures them as
`seat.poseAnimation` via `surveyVehicle`, null when absent (the driver seat fall-
back case).

**Seat pose models.** `extract_pose.py --seat-poses` resolves each upper-state
name to its `.baf` clip through the state machine (e.g.
`Ub_PassengerInWilly` → `animations/Vehicle/3pSitWillyPassUpper.baf`) and
bakes the soldier's body/head/hands into `${soldier}__${PoseName}.pose.glb`
under `viewer/models/poses/`. Four vanilla poses × 8 soldiers = 32 files;
`extract_all.py` runs the step automatically and writes `seat-poses.json` next
to them. When the mod pairs a non-matching lower (e.g. Black Medal's
`Ub_PassengerInWilly` + `Lb_PassengerInHanomag`) the matching pair from another
seat wins (`discover_seat_poses`). Vanilla declares none: `extract_all.py` still
runs the scan and finds them.

**Camera view modes (CVM*).** The `CVMInside`/`CVMChase`/`CVMFrontChase`/
`CVMFlyBy`/`CVMTrace`/`CVMExternTrace` booleans on Camera templates are parsed
and emitted as `extras.cameraView.cvm`, a dict of only the declared flags (absence
= "all on", per SEAT-10/camera-modes.md §3). `viewer/seats.js` captures them as
`seat.cameraViewModes`.

**Viewer wiring.** `map.html`'s `loadSeatPose` looks up the active seat's
`poseAnimation`, resolves the soldier template from the kit loadout, fetches
`${MODELS_BASE}/poses/${soldier}__${PoseName}.pose.glb`, parents it on the seat's
first EntryPoint so it moves with the vehicle, and drives the `seat.lower`/
`seat.upper` clips with an `AnimationMixer`. The soldier is hidden in the
cockpit (first-person, `CVMInside`) and shown in every external view (chase,
front, fly-by) — matching the game's own `C` cycle.

## Open

- ~~**SEAT-11**: which call site actually passes `force = true`~~ — **closed
  2026-09-19** (§3): only `GameServer::exitVehicle`. The seat switch and
  `c_PIUse` entry both pass `false`.
- The client-side (`BF1942.exe`) dispatch address for any of this — every
  function in this doc is lnxded-only; no client twin was located this
  round.
- `0x086d3c44`'s identity (an unidentified compare target inside
  `toggleEntryPoint`/`enter`/`exitPlayer`, plausibly
  `CID_PlayerControlObjectTemplate` — no `nm` symbol sits at that exact
  address).
- `PlayerControlObject::exit(bool)` (`0x08317d00`) and
  `getPreferredPco()`/`getPcoPosId()`'s own internals.
- Which sub-branch of `exitPlayer` (the untried "local", non-remote path at
  `0x831866f`) handles a bot/AI occupant.
- The exact semantics of `GameServer+0x66` and player `+0x74` in the
  `checkPlayerTriggers`/`toggleEntryPoint` pre-gate (§1), and of
  `validateBFEntryPoint`'s `queryComponent(0xc4a4)` + vtable `+0xc8` check
  (§2) — both confirmed to exist and to gate real behaviour, neither traced
  to what specifically they test.
- `exitTimer`'s consuming function (§6).
