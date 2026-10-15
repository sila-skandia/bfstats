# The BFPlayer ghost body (the per-player object)

Read from `bf1942_lnxded.static` (1.61 Linux dedicated server) on 2026-10-15.
The decoder is `tools/bf1942-models/sidecar/ghost/player.mjs`
(`decodePlayerBody`). This note is the field map, the player/soldier
relationship, and the corpus verdict.

## What a BFPlayer body is, and what it is not

A `dice::bf::BFPlayer` is **not** one of the thirteen networkable classes in
`class-map.md` §1. It is the per-player object the server adds with
`NetworkManager::addPlayerNetworkable(BFPlayer*)` (`0x0842c310`), and it reaches
the ghost stream under its own netId. That netId is the `netId` a `createPlayer`
event carries: in `run.ndjson` it is **1** (`skandia`, human), **3** (`sidecar`,
human), **509** (`Michael O'Brien`, AI) and **511** (`Kazuyoshi Shiokawa`, AI).
`class-map.md` §6 listed exactly these four ids as unmapped — "a per-player
networkable id is a plausible reading" — and this file settles it.

- **reader** `BFPlayer::setNetUpdate` `0x08053a40`
- **writer** `BFPlayer::getNetUpdate` `0x080534b0`
- **mask builder** `BFPlayer::updateStateMask` `0x08052f60`

Reader and writer agree field-for-field, guard-for-guard and in the same order,
and the mask builder writes each guard, so the layout is read three independent
ways.

Unlike a vehicle body (`ghost/pco.mjs`, the hull plus its child networkables
concatenated), a BFPlayer body is **one** `setNetUpdate`: the framed record is
just the player networkable, with no child tail. Every record of the four ids
decodes to its last bit with this reader alone, so no composite is needed.

## The field map

`readUnsigned(24)` presence mask. Then, in this order (the order in both the
reader and the writer), one field per guard bit:

| mask | name | read | width | BFPlayer off | address | confirmed |
|---|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(24)` | 24 | — | `0x08053a40` | binary (reader+writer+mask) |
| `0x000002` | `unk90` | `readUnsigned(0,0x7f)` | 8 | +0x90 | `0x08053a40` | binary; **meaning open** |
| `0x000004` | `f13c` | `readBool` | 1 | +0x13c | `0x08053a40` | binary; meaning open |
| `0x000008` | `stat1` | `readUnsigned(0,0xff)` | 9 | +0xa0 | `0x08053a40` | binary; stat block |
| `0x000010` | `stat2` | `readUnsigned(0,0xff)` | 9 | +0xa4 | `0x08053a40` | binary; stat block |
| `0x000020` | `stat3` | `readUnsigned(0,0xff)` | 9 | +0xa8 | `0x08053a40` | binary; stat block |
| `0x000040` | `stat4` | `readUnsigned(0,0xff)` | 9 | +0xac | `0x08053a40` | binary; stat block |
| `0x000080` | `stat5` | `readUnsigned(0,0xff)` | 9 | +0xb0 | `0x08053a40` | binary; stat block |
| `0x000100` | `stat6` | `readUnsigned(0,0xff)` | 9 | +0xb4 | `0x08053a40` | binary; stat block |
| `0x000200` | `stat7` | `readUnsigned(0,0xff)` | 9 | +0xb8 | `0x08053a40` | binary; stat block |
| `0x000400` | `stat8` | `readUnsigned(0,0xff)` | 9 | +0xbc | `0x08053a40` | binary; stat block |
| `0x000800` | `stat9` | `readSigned(16)` | 16 | +0xc0 | `0x08053a40` | binary; stat block (signed) |
| `0x001000` | `callMedic` | `readBool` | 1 | +0x14c | `0x08053a40` | binary; meaning inferred |
| `0x004000` | `callEngineer` | `readBool` | 1 | +0x148 | `0x08053a40` | binary; meaning inferred |
| `0x008000` | `f149` | `readBool` | 1 | +0x149 | `0x08053a40` | binary; meaning open |
| `0x010000` | `unk94` | `readUnsigned(0,0x3ff)` | 11 | +0x94 | `0x08053a40` | binary; **meaning open** |
| `0x002000` | `vehicleHp` | `readUnsigned(0,0x7f)` | 8 | +0x8c | `0x08053a40` | binary; vehicle HP (below) |
| `0x040000` | `vehValue` | `readUnsigned(0,0x12)` | 5 | slot+0x3c | `0x08053a40` | binary; controlled-object value |
| `0x040000` | `vehFlag` | `readBool` | 1 | slot+0x54 | `0x08053a40` | binary; **same guard as above** |
| `0x080000` | `f178` | `readUnsigned(0,0xff)` | 9 | +0x178 | `0x08053a40` | binary; clears in resetStats |
| `0x100000` | `score_e8` | `readUnsigned(0,0xff)` | 9 | +0xe8 | `0x08053a40` | binary; meaning open |
| `0x200000` | `score_ec` | `readUnsigned(0,0xff)` | 9 | +0xec | `0x08053a40` | binary; meaning open |
| `0x400000` | `score_f0` | `readUnsigned(0,0xff)` | 9 | +0xf0 | `0x08053a40` | binary; meaning open |
| `0x800000` | `unk80` | `readUnsigned(0,0xff)` | 9 | +0x80 | `0x08053a40` | binary; meaning open |
| (none) | `connected` | `readBool` | 1 | +0x164 | `0x08053a40` | binary; `setIsConnected` writes +0x164 |

Mask bits **0x000001 and 0x020000 are never read**; if either is set the body
still consumes (this decoder ignores them, matching the reader) but the record
is suspect.

### The two traps

1. **`readUnsigned(min,max)` (`0x083da040`) is the ranged reader**, width = the
   smallest n with `(1<<n)-1 >= (max-min)+1` (the engine's off-by-one,
   `bitstream.mjs` `rangedBits`). So `readUnsigned(0,0xff)` is **9 bits**, not 8,
   and `readUnsigned(0,0x3ff)` is **11**, not 10. Reading them at the naive
   width shifts every later field. The all-bits-set record is exactly 195 bits
   only with the ranged widths: `24 + 8 + 1 + 8*9 + 16 + 3 + 11 + 8 + 5 + 1 + 5*9
   + 1 = 195`, matching the corpus's `ffffff00…` body bit for bit.
2. **Guard `0x40000` covers two fields in a row** — a 5-bit ranged value
   (`slot+0x3c`) and then a bool (`slot+0x54`). A decoder that reads only one is
   exact only on bodies that never set the bit.

`getMinimumBitSize` (`0x08056170`) returns `0x30` (48), which is *not* the
wire minimum 25 (24 mask + 1 `connected`); treat it as a bandwidth estimate,
not the field width.

## Field meaning, where the binary carries it

`updateStateMask` (`0x08052f60`) builds the mask and names each field's source
in BFPlayer; `resetStats` (`0x080556e0`), the constructor (`0x080510a0`) and the
small accessors name a few outright.

- **`connected` (+0x164)** — set every body. `BFPlayer::setIsConnected`
  (`0x08055910`) writes `+0x164` and a timestamp at `+0x168`; the ctor inits it 0.
- **`vehicleHp` (+0x8c)** — the ctor inits `+0x8c = -1.0f` (`0xbf800000`);
  `getVehicleHp` (`0x08054720`) reads the Armor's HP off the controlled object
  (`0xc4a4`), `setVehicleHp` (`0x080546d0`) writes it. `updateStateMask`
  writes `round(+0x8c)` guarded by `0x2000`, so the field is the vehicle's hit
  points as a small non-negative int (`-1` → 0 when there is no vehicle).
- **`stat1`..`stat9` (+0xa0..+0xc0)** — `resetStats` (`0x080556e0`) zeroes
  exactly these nine consecutive dwords (and nothing else in `+0x80..+0xf0`), so
  they are the player's flat stat block; the ninth is signed.
- **`unk90` (+0x90)** — clamped to `0..0x7f` by `updateStateMask` and **reset to
  0 by `setTeam` (`0x080556b0`) when the team changes**, so it is a small
  team-scoped value. **Not identified** (open).
- **`callMedic` / `callEngineer`** — the two `+0x14c` / `+0x148` bools sit where
  `BFPlayer::setCallForMedic` (`0x080546b0`) and `setCallForEngineer`
  (`0x080546c0`) would write; on the dedicated server both are empty stubs, so
  the meaning is inferred from the offsets, not read from a body.
- **`vehValue` + `vehFlag` (`0x40000`)** — `updateStateMask` takes them from the
  object returned by the BFPlayer vtable slot `+0x38` (its vtables `+0x14` and
  `+0x18`), i.e. a value and a bool belonging to the player's current object.
  The object is not named here; the values are server-side per-slot baselines.

## The player and the soldier are different objects

This is the question the browser has: which netId to drive.

- A **BFPlayer** (netId 1/3/509/511) is the *player*: it carries the player-level
  state above (stat block, vehicle HP mirror, connected flag, a couple of small
  ids). It carries **no world transform** — there is no position, rotation or
  velocity in its body, and its fields are baselines for signalling, not motion.
- The object a player actually *controls* is named by the `createPlayer` event's
  **`vehNetId`** (and re-pointed by `SetVehicle`/`SetDefaultVehicle`). From
  `run.ndjson`:

  | player netId | player | `vehNetId` | what it is |
  |---|---|---|---|
  | 1 | skandia (human) | 2 | `MultiPlayerFreeCamera` (not spawned) |
  | 3 | sidecar (human) | 4 | `MultiPlayerFreeCamera` (not spawned) |
  | 509 | Michael O'Brien (AI) | 597 | a soldier (`BFSoldier`) |
  | 511 | Kazuyoshi Shiokawa (AI) | 589 | a soldier (`BFSoldier`) |

  So on foot the controlled object is a **BFSoldierNetworkable** (that netId
  carries position/rotation/animation and is what `soldier-ghost.mjs` decodes);
  in a vehicle it is the vehicle; before spawn it is the free camera. **A
  BFPlayer's own field bits do not move anything.**

- The consequence for the bridge: to make a player move, drive the object at
  `vehNetId`, not the BFPlayer's netId. The BFPlayer body is the player's
  *state* (and, being a baseline-diffed record, it is the natural place to read
  a player's status). The soldier body is the *pose*.

## Corpus verdict

```
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/ghost/player.mjs decodePlayerBody run.review.ndjson --names run.ndjson
```

Snapshot: `run.review.ndjson` at **60,037 lines / 59,997 action-1 records**
(the file is appended by a live sidecar, so the count moves).

| netId | records | strict | under | over | threw |
|---|---|---|---|---|---|
| 3 | 2639 | **2639 (100.0%)** | 0 | 0 | 0 |
| 509 | 659 | **659 (100.0%)** | 0 | 0 | 0 |
| 1 | 102 | **102 (100.0%)** | 0 | 0 | 0 |
| 511 | 23 | **23 (100.0%)** | 0 | 0 | 0 |

`verify.mjs` reports "claimed clean on every record: 3:2639 509:659 1:102
511:23" — exactly the four players, and nothing else. Every other netId in the
corpus scores 0 with this decoder (it is a different class), which is the
expected shape: only the right class's reader consumes its bodies to the last
bit every time.

The bodies seen: 33-bit (`00 20 00 …`, mask `0x2000` — `vehicleHp` + trailing),
26-bit (`00 80 00 …`, mask `0x8000` — one bool + trailing), and the one 195-bit
all-bits body (mask `0xffffff`) on netIds 509 and 511. All three land on the
last bit.

## Open

1. **`unk90` (+0x90, `0x2`)**, **`unk94` (+0x94, `0x10000`)** and **`unk80`
   (+0x80, `0x800000`)** are read exactly but not named. `unk90` is team-scoped
   (`setTeam` zeroes it) and `0..0x7f`; `unk94` is `0..0x3ff`. A fuller read of
   `BFPlayer::update`/`handleInput` and the spawn path would name them.
2. **`f13c` (`0x4`), `f149` (`0x8000`)** — bools with no accessor found.
3. **`score_e8`/`score_ec`/`score_f0` (+0xe8/+0xec/+0xf0, `0x100000`/`0x200000`/
   `0x400000`)** — three `0..0xff` fields the writer rounds from floats; they are
   not the block `resetStats` clears, and their meaning is open.
4. **`vehValue`/`vehFlag` (`0x40000`)** — read from the controlled object via
   BFPlayer vtable `+0x38` (`+0x14`/`+0x18`); the exact object and the two
   getters are not named.
5. **The stat block's nine fields** (`stat1`..`stat9`) are known to be
   stats (cleared together by `resetStats`) but not mapped to
   score/kills/deaths/etc. The per-weapon and per-template maps
   (`+0xc4`/`+0xd0`) are separate structures and are not on the wire here.
6. **`getMinimumBitSize` = 48** while the wire minimum is 25; the discrepancy is
   unexamined.
