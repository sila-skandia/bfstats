# Roadmap: the sidecar simulates a client, then the browser plays

Status: started 2026-10-15. The POC joins the lab and decodes the event stream
and the soldier body (see [wire.md](wire.md)); this file is the path from there
to playing in the browser, and the instrument that says how far along it is.

## The gate

Playing in the browser needs the sidecar to be a complete client: every event
the server sends understood, every object's update decoded, and the input path
working. "Understood" is not a feeling; it is a number.

Two tools measure it:

- `tools/bf1942-models/sidecar/coverage.mjs` reads a recording plus its review
  log and reports the share of the event stream decoded and the share of the
  ghost (object-update) stream decoded, grouped by object class.
- `tools/bf1942-models/sidecar/ghost/verify.mjs` reports, over the framed
  corpus, how many of one class's bodies a decoder reads cleanly. A clean read
  completed without running past the end and stopped on exactly the last bit.

The verifier is strict for a reason. `BitReader.readBit` throws at the end of a
body, so a decoder that swallows the throw and reports its cursor position
reports exactly `bodyBits` while having decoded nothing. The M3A1 body scored
99.5% "exact" that way on a first pass and is in fact 0%. A decoder under
verification must let underflows propagate.

## Baseline (2026-10-15, a 9-minute lab session, 18178 framed bodies)

| | |
|---|---|
| Events decoded | 237 of 240 (98.8%); the gap is one unknown 7-bit type, `0x0`, 3 occurrences |
| Bodies read cleanly | 2210 of 18178 (12.2%) |
| Classes with a decoder | 1 of 13 (`BFSoldierNetworkable`) |

Per class, by share of the body stream (template: bodies at average bits):

| template | bodies | bits/body | decoder |
|---|---|---|---|
| M3A1 | 11842 | 108 | none |
| USMarineSoldier | 1515 | 128 | 99.9% strict |
| Daihatsu | 1058 | 214 | none |
| Sherman | 849 | 230 | none |
| Zero | 688 | 275 | none |
| (unnamed objects) | 604 | 32 | none |
| JapaneseSoldier | 711 | 114 | 97.5-98.8% strict |
| Corsair | 56 | 326 | none |
| AA_Allies, Defgun, Chi-ha, ALLIES_*, kits, camera | 128 | 7-405 | none |

So the body stream is the work: the vehicles are about four fifths of it, and
one template (M3A1) is nearly two thirds on its own.

## Phases

**A. The instrument.** Done: `coverage.mjs`, `verify.mjs`, the strict-consumption
rule, and the baseline above.

**B. The object bodies, one class at a time.** Read the class's `setNetUpdate`
in `bf1942_lnxded.static` (the reader of the same layout `getNetUpdate` writes),
implement it in `sidecar/ghost/`, and verify it strict over the corpus. Order by
share: `PlayerControlObjectNetworkable` first (the vehicles, four fifths of the
stream), then `RotationalBundleNetworkable`, `ControlPointNetworkable`,
`SimpleObjectNetworkable`, `KitNetworkable`, `ItemNetworkable`,
`ObjectiveNetworkable`, `EngineNetworkable`, `SpringNetworkable`,
`ProjectileNetworkable`, `FireArmsNetworkable`, `FreeCameraNetworkable`. Done
when the class reads every record of its objects to the last bit.

**C. The soldier's residue.** `BFSoldierNetworkable` is 97.5-99.9% strict, not
100%: a few bodies per thousand take a path the field map does not cover. Then
the two open fields: the aim limits (the soldier template's pitch and twist
bounds, so `pitch`/`twist` carry degrees rather than [-1, 1]) and the hit-point
width (a 100 hp read gives 126 at spawn, so the max or the min argument is
wrong).

**D. The small gaps.** The unknown event type `0x0`; the control-object state a
ghost block can carry (`readControlObjectState` `0x081428a0` is not sized, so
such a block is logged raw); any unknown datagram type.

**E. Input (step 5 of the POC plan).** Team, kit and spawn, then the
`PlayerAction` records at 30 Hz (already read: ledger W-1..W-5, netcode.md §1-2,
and `events.mjs` has the writer). This is the outbound half of playing and it is
what makes the sidecar a client rather than an observer.

Built and verified live 2026-10-15. `sidecar/input.mjs` builds SetTeam,
ChangeKit and SpawnRequest and the PlayerAction stream (three records to a
datagram, serials strictly increasing, refused before the join because an input
datagram and a SpawnRequest both null-deref with no BFPlayer bound). The page's
frames reach it through the sidecar's WebSocket, and the movement is confirmed
by a second client watching the same round: 0 m per four-second window while
idle, then 8.6, 24.5 and 28.6 m once forward was held. Open: the spawn group and
point are the level's own numbers, so a page for another level must read that
level's data (`browser.md`).

**F. The browser page.** The sidecar already serves the decoded feed over a
localhost WebSocket and writes a bf42plus-v5 recording. The page becomes a real
client: connect to the sidecar, apply the object updates to the viewer's world,
and send input. The viewer's decoders and the sidecar's share their knowledge,
so this is where the two meet.

Started 2026-10-15. `viewer/net-sidecar.js` keeps the client surface
`net-room.js` reads and sources it from the sidecar's feed, and
`net-room.js` picks the transport from the query string, so
`map.html?sidecar=ws://127.0.0.1:17942` plays through the sidecar with the same
page, renderer, input path and reconciler. Tested by
`tests/test_sidecar_client.py`, and verified end to end against the lab: the page
spawns the sidecar's player and walks them, with a second client confirming the
movement. See [browser.md](browser.md).

## How each step is checked

- A class decoder: `verify.mjs` strict on every record of its objects.
- The whole stream: `coverage.mjs` before and after; the target is events at
  100% and bodies at 100%, with the review log empty.
- Input: the lab's own event log shows the sidecar spawning, moving and
  shooting, and `lab.py status` reports its kit and kills.
- The browser: the page drives a soldier on the lab and the lab's event log
  agrees with what the page shows.

## Live play: what works and what does not (2026-10-16)

The live page is `map.html?sidecar=ws://127.0.0.1:<port>`, joined to the lab
through `sidecar/sidecar.mjs --ws <port>`. Checked headless against the lab with
a Playwright driver and against the server's own event log.

| | state | evidence |
|---|---|---|
| Join, level, roster, tickets, flags | plays | hello names the level by folder (`wake`); the page waits for map.html's level list before acting on it |
| Spawn from the deploy screen | plays | the spawn action carries team, the chosen point's spawn group and the kit index; the sidecar sends SetTeam, ChangeKit and SpawnRequest(group, kit). Event log: `spawnEvent` at group 3, `pickupKit UsMarine_AT` |
| Own soldier from the server | plays | the control-object state (`ghost/control-state.mjs`) is decoded, 100% of live states to the last bit; the page gets an ack and corrects once on spawn (the server picks the point), then tracks within centimetres |
| Walking, facing | plays | body yaw is the replay's law (a half turn on the quaternion's yaw); before that fix the page walked backwards |
| A reloaded page | plays | the sidecar keeps one input sender, so serials keep rising |
| Remote soldiers and hulls | plays | engine frame converted to the page's (z negated); hulls bind to the page's parked copies by template and nearest position |
| Remote shots | sound only | a soldier entering an `Ub_*Fire` state, or a vehicle gun's magazine stepping down, plays the report at the shooter; no tracer or muzzle flash yet |
| Driven vehicle from the server | decodes | the control state of a driven Sherman reads 201/201; the page side of driving is being checked |
| Seat changes, reload | wired | page seat rows and reloads become c_PIUse / c_PIMenuSelect<n> / c_PIReload presses |
| Damage to the local soldier, deaths | open | the soldier body's hp field is its maximum; the current value is not on the page yet |
