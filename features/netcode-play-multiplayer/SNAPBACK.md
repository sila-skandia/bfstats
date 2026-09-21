# The snap-back: a walking player teleported backwards twice a second

W6-G, 2026-09-22. The owner created a game locally, joined it, and **his own
player view snapped constantly back a few steps while walking**. Locally, so not
latency and not jitter — a systematic divergence.

It was two defects, one on each side of the wire, and they fed each other.
Both are fixed, and P4's correction handling — input replay and correction
smoothing — is implemented, because the second defect *was* the missing
reconciliation.

---

## What was measured

One page (headless chromium, software GL, ~12 fps), one real room server over
real TCP, Aberdeen, W held for 25 s. Both sides instrumented: the page recorded
its own soldier and the authority's snapshot row per snapshot; the room logged
its tick count, its idle ticks, its buffer depth and its soldier's pose and
facing every 30 ticks. Driver kept at
`tests/p4_snapback_smoke.mjs` (the permanent version); the throwaway probes are
in the round's scratch directory.

### Before

```
snapshots seen      309        hard corrections (teleports)   9   in 20 s
                               later run, 25 s                12
|authority - prediction|   sawtooth 0.3 -> 4.2 m -> 0.3, period ~2.1 s
mean 2.06 m, max 4.34 m
client ticks        574 over 20 s wall (28.7/s)
server ticks        660, idle words consumed 96 (7 of them during the walk)
client soldier yaw   0.000 deg        server soldier yaw  17.719 deg
```

The divergence decomposed against the client's own direction of travel was
**almost entirely lateral** (`lat` up to -3.9 m, `along` within +-1 m): the two
bodies were not one behind the other, they were walking apart. The server's
velocity was `(1.825, 0, 5.713)` — 5.998 m/s at a heading 17.719 deg off the
client's, which walked with its `x` *exactly* constant.

Two bodies running the same forward word along headings `dTheta` apart separate
at `2 v sin(dTheta/2)`; at 17.719 deg and the 6 m/s run table that is
**1.85 m/s**, so the 4 m grace was crossed every ~2.2 s. Forever.

### After

```
snapshots seen      457        hard corrections (teleports)   0   in 30 s
|authority - prediction|   0.4 - 0.8 m, flat. mean 0.607, max 1.305
prediction error at the acknowledged tick   max 1.29 m (the join transient),
                                            mean 0.025, and 0.000 after ~2 s
client soldier yaw  17.719 deg    server soldier yaw  17.719 deg   gap 0.000
client travel       178.6 m in 30 s = 5.95 m/s, no teleports
server idle words   95 total, ~30 during the walk out of ~960 ticks (3%)
```

The remaining 0.4-0.8 m is **input latency and nothing else** — two or three
unacknowledged ticks of a 6 m/s walk — and it is flat, not growing. The honest
error, measured where both sides have run the same words, is zero.

---

## Root cause 1: the two sims spawned the soldier on different spawn points

`server/rooms.mjs` `#onSpawn` called
`world.spawnPlayer(slot, { flag, advance: true })`. The page's own deploy
(`map.html` `spawnAtFlag`) calls the same method with `advance: false` on a first
deploy. `advance` increments `player.spawnIndex`, and `pickSpawn` walks a flag's
spawn points by that index — Aberdeen's British_Base has seven.

So the authority stood the soldier on `alliesSpawnPoint_2` and the prediction on
`alliesSpawnPoint_1`. Measured, from both sides of the same run:

```
W6GSPAWN slot=1 flag=British_Base index=1 spawn=alliesSpawnPoint_2
         pos=[905.883, 93.0283, -913.563] rot=[162.281, ...] yawDeg=17.719
SPAWN client  flag=British_Base index=0 spawn=alliesSpawnPoint_1
         pos=[895.964, 93.4747, -868.823] rot=[162.281, ...] yawDeg=17.719
```

45 m apart. The page's own soldier then read `yawDeg: 0` at the first snapshot,
because the 45 m gap was past the grace and the old correction had already
teleported it — see root cause 2. From then on the facings were 17.719 deg apart
and the splay above ran.

**The fix** (`server/rooms.mjs:290-311`): the deploy row carries `spawnIndex` —
the point the prediction actually used — and the authority spawns on exactly
that point without advancing. The page sends it from
`world.player(LOCAL_PLAYER).spawnIndex` after its own `spawnPlayer` has walked
it (`map.html` `spawnAtFlag`). A row without an index keeps the old walk, so a
client that does not send one is unchanged. An absurd index is clamped out
(`SPAWN_INDEX_MAX`) rather than trusted into a modulo.

One spawn pick, made once, by the side that has to predict it.

## Root cause 2: the correction was a respawn, and it was measuring latency

`map.html`'s `onsnapshot` was:

```js
if (dx * dx + dz * dz > NET_POS_GRACE * NET_POS_GRACE) {
  soldier.spawn(self.x, self.y, self.z);
}
```

Four things wrong, each now a law in `viewer/netcode-reconcile.js`:

1. **The comparison was not like for like.** `self` describes server tick T; the
   client has already simulated the words for T+1..N. That difference is mostly
   input latency, and correcting to it drags the player backwards by it.
   The wire now carries **`ack`** — the highest input seq the authority has
   consumed for that player (`netcode.js`, 27 -> 31 bytes per player row, a
   cited departure from the engine's ghost state: the engine's client never
   reconciled, so it never needed to know). The error is measured at that tick.

2. **No input replay.** A predicted client owes a replay of its unacknowledged
   words on top of an accepted correction. The client keeps one pose per tick
   against the seq it sent (`capturePresentationTick` pushes the tick's finished
   pose; the send loop pairs it with `sendInput`'s returned seq), so the
   unacknowledged displacement is read straight off the ledger. The same words
   on the same integrator produced that motion once already, so re-stepping the
   soldier would reproduce it — and would also re-advance its bob, step and gait
   clocks N times per correction for no accuracy.

3. **`Soldier.spawn()` is a respawn, not a correction.** It zeroes the velocity
   and the PHY-6 movement ramps (127/20 = 6.4 ticks back to full speed, lost on
   every correction), resets the stance, the gait, the bob and the soldier's own
   60 Hz clock, resets the view pitch to 0 — and, **called with no yaw argument,
   sets the facing to 0**. That is where the client's 0.000 deg came from, and it
   is why the divergence was self-sustaining instead of one-off. The correction
   is now `soldier.body.body.setPosition(...)`, which moves `position` and
   `previous` and nothing else.

4. **An error under the grace was not corrected at all, so it could only grow.**
   Every accepted snapshot now closes `CORRECTION_SMOOTHING = 0.25` of what is
   left, position and facing both: a ~0.17 s time constant, so a 1 m standing
   error is spent in under a second and a 5 cm disagreement moves the body 12 mm.
   A hard set is reserved for `CORRECTION_HARD_LIMIT = 4.0` m, which is ten times
   the largest residual the two sims can legitimately produce over one snapshot
   period (0.4 m: two idle ticks of the 6 m/s run table; the input record's
   quantization is sub-millimetre and both sides run one build of one module).
   The number is unchanged from `NET_POS_GRACE` but it now means "this is a
   different event", not "this is the last line before a teleport".

Two further laws came out of measuring the fix rather than the defect:

5. **A correction must re-base the ledger.** The unacknowledged entries describe
   the trajectory the body was on before the correction; shifted by the same
   delta, they describe the corrected one. Without it the same error is
   re-measured against a stale ledger on every snapshot and re-applied in full:
   measured live at **1103 m, 2206, 4413, 8824, 17649, 35292** — a doubling per
   snapshot, the body thrown off the map in two seconds. This is the other half
   of a rollback and it is easy to forget; `tests/test_netcode_reconcile.py`
   pins it.

6. **No acknowledgement, no correction.** Before the authority has run one of
   this body's own words there is nothing to measure — only "where the authority
   had this player before it heard about the deploy" against "where the
   prediction put him after it". Acting on that teleported a freshly spawned
   player **1103 m** across Aberdeen on the first snapshot of every spawn. The
   acknowledgement arrives within a round trip.

## Root cause 3 (found while measuring): the wire's facing was in radians

`netcode.js` documents the snapshot player record's `yaw`/`pitch` as **degrees**
and `netcode-render.js:275` converts them back with its own `rad()`.
`World.playersSnapshot()` writes the soldier's facing in **radians**, and
`rooms.mjs` shipped it unconverted — measured: the server's soldier at
17.719 deg put `0.309` on the wire. Every remote soldier was therefore drawn at
a **57th** of its real heading, i.e. facing roughly north whatever it was doing.
`rooms.mjs`'s `snapshotPayload` now converts at the wire's edge, where the
conversion belongs.

---

## The fix, by file

| File | What |
|---|---|
| `server/rooms.mjs` `#onSpawn` | the deploy row's `spawnIndex` pins the authority's spawn point; no advance when it is given; `SPAWN_INDEX_MAX` clamp |
| `server/rooms.mjs` `#tick` | `connection.ack` — the highest input seq the world has consumed, monotonic (an idle tick carries no seq and must not withdraw an acknowledgement) |
| `server/rooms.mjs` `snapshotPayload` | `ack` on every player row; `yaw`/`pitch` converted to the degrees the record documents |
| `viewer/netcode.js` | the player record is 31 bytes: `u32 ack` appended, documented as the cited departure it is |
| `viewer/netcode-reconcile.js` (new) | the correction law: measure at the acked tick, replay the unacknowledged ticks, re-base the ledger, smooth under the hard limit, correct facing at the same share |
| `viewer/netcode-client.js` | `sendInput` returns the seq; `sentSeq()`; `selfPlayer()` — the authority's own row for the local body, un-lerped |
| `viewer/map.html` | the prediction ledger (one pose per tick, in `capturePresentationTick`, paired with the seq at the send), `spawnIndex` on the deploy row, the reconciler's lifecycle (join / respawn / seat row / teardown), `netPlaceSoldier` instead of `soldier.spawn`, and the correction counters on `__net()` |

## What the previous agent's hostname test was hiding

An uncommitted line in the main checkout's `map.html` added
`&& location.hostname !== '127.0.0.1' && location.hostname !== 'localhost'` to
the correction's condition. It was not in this worktree and is not on `main`.

What it actually hid: **both** root causes, and only where they could be seen.
The spawn-point mismatch happens on every deploy on every map, on a LAN and over
the internet alike; the correction's yaw wipe happens on every correction. All
the hostname test did was switch off the *symptom* on the one host where the
divergence is observable without a second machine — so a LAN player would have
had a correct-looking local body drifting silently away from an authority that
was scoring his shots, while an internet player kept the teleport. It shipped a
different game to two players and removed the evidence.

It also hid the third defect entirely: with corrections off on loopback, nobody
would have noticed that every remote soldier was facing the wrong way.

## Tests

* `tests/test_netcode_reconcile.py` + `tests/netcode_reconcile_harness.mjs`
  (new, 9 tests): the correction law under node — the acked-tick measurement,
  the replay, the no-acknowledgement rule, the geometric decay, the compounding
  regression, the hard limit, the facing arithmetic (including the 1.85 m/s
  splay number), the dropped-word fallback and the ledger's bound.
* `tests/test_room.py` scenario (m) (new, 4 tests): the deploy row's
  `spawnIndex` pins the authority to the page's own spawn point and agrees with
  it to 1e-6 m and 1e-9 rad; a row without one keeps the old walk; the snapshot
  acknowledges 501, 502, 503, 504 and does not withdraw an acknowledgement on an
  idle tick; the wire's facing is degrees.
  **All four fail on `main`** — measured on a clean `git archive HEAD` copy:
  `spawnIndex 3 != 0` with `name 'N2'` against the page's `'N1'`,
  `KeyError: 'ack'`, and `-1.2566370964050293 != -72.0`.
* `tests/p4_snapback_smoke.mjs` (new): the browser-level regression. One page,
  one room server over real TCP, W held for 14 s on the page's **real** rAF loop
  (not `__renderOnce` — the defect is a disagreement between the page's clock
  and the room's wall clock, which is the relationship under test), sampling the
  wire at 10 Hz. Bars: 0 hard corrections, `|authority - prediction| <= 2 m`,
  the acked error `<= 2 m` overall and `<= 0.25 m` after the join transient, the
  facing gap `<= 1 deg`, and the authority must actually be acknowledging.
  Last run: `walked 95.1 m, wire gap <= 1.00 m, acked error <= 1.146 m
  (0.006 m once settled), facing gap <= 0.000 deg, 0 teleports`.
* `tests/room_socket_test.py`: one stale assertion fixed (`hello.slots` is the
  roster of players already in the room, so the first joiner's is `[]`; the 16 is
  `maxPlayers`). It had been red on `main` and is not discovered by
  `unittest discover`'s default pattern, so nothing caught it.
* Full suite from the repo root: `python3 -m unittest discover -s
  tools/bf1942-models/tests` — **2381 tests, OK, 29.7 s**.

## What is still open

* **`tests/p2_two_browser_smoke.mjs` fails with "A never entered a vehicle"**,
  identically on `main` (verified on a clean `git archive HEAD` copy with the
  same asset links) and on this branch. It is not a regression from this work,
  but the P2 done-bar is currently red in this environment and somebody should
  own it. Everything before the seat step passes, so the failure is in the
  seat-search step under software GL, not in the wire.
* **`Room.start()` / `Room.stop()` are dead in the server path.**
  `RoomServerCore.start()` laps every room on its own 33 ms interval *and* calls
  `room.start()`, which would set a second one — but `createRoom` never starts a
  room's timer and production calls `start()` before any room exists, so no room
  is ever double-driven and a room's own timer is never set. The tick rate is
  measured at **30.0 ticks/s** (server log stamps: tick 135 at wall 9154 ms,
  tick 600 at wall 24660 ms — 465 ticks in 15.506 s). Worth deleting one of the
  two paths so the next reader does not have to work that out.
* **The authority's idle ticks are not free.** A tick whose word has not arrived
  consumes the engine's zeroed word, which runs the PHY-6 ramp *down* (decel 12
  against accel 20 per tick, out of 127) rather than holding. Below ~37.5% word
  arrival the authority's soldier stops moving altogether while the client walks.
  Measured here at 3% idle during a walk, so it is a 0.4 m effect that the
  smoothing absorbs — but it is the mechanism by which a client whose clock runs
  slow (the animation loop's 0.1 s frame clamp, a throttled tab) underfeeds the
  authority, and it is worth a P5 metric (`tick deficit` is already on P5's list).

## What of P4 should follow immediately

P4's correction smoothing and prediction tuning are done. Of its remaining
items, two are now cheap and one is newly justified:

1. **Snapshot interpolation order (position -> orientation -> seat linkage).**
   The facing on the wire is only now in the documented units, so the remote
   renderer's orientation path has never actually been exercised with a true
   heading. Worth doing next, and worth a look at what the remote soldiers
   look like once they point the right way.
2. **The seated correction.** `onsnapshot` returns early for a seated player, so
   a driven hull has no reconciliation at all — the same class of defect, one
   layer up, waiting for someone to drive for a minute. The hull pose is in the
   snapshot already; the ledger would have to record the hull's pose instead of
   the soldier's.
3. **The spectator/follow cameras and the recorded-match replay** are unaffected
   by any of this and can go in any order.
