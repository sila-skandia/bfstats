# Small object ghost bodies: SimpleObject, Kit, Item, FreeCamera

Field maps for the four small `*Networkable` ghost bodies, read from
`bf1942_lnxded.static` (`getNetUpdate` writes, `setNetUpdate` reads the same
layout, `updateStateMask` sets the mask bits; addresses are the unix `T`
symbols) and scored against the lab capture `run.review.ndjson`.

Method, per class: decompile `setNetUpdate` / `getNetUpdate` / `updateStateMask`,
implement the reader in `tools/bf1942-models/sidecar/ghost/<class>.mjs`, and run
the strict scoreboard:

```
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/ghost/<class>.mjs <export> run.review.ndjson --names run.ndjson
```

`strict` = the read completed and stopped on exactly the framed body length, on
every record of a netId, with the decoder letting an underflow propagate. The
same body-length arithmetic that makes the width table is `BitStream::readUnsigned(min,max)`
taking `rangedBits(min,max)` = the smallest n with `(1<<n)-1 >= max-min+1`
(so `readUnsigned(0,0x7f)` is 8 bits, not 7; `readUnsigned(0,0xff)` is 9;
`readUnsigned(0,0x100)` is 9; `readUnsigned(0,8)` is 4).

> Corpus note. `run.review.ndjson` is being appended to by a live sidecar run, so
> its record count grows between invocations. All numbers below are from the
> frozen snapshot `27421` records / `run.ndjson` taken during this work. The
> scoreboard's own `claimedNetIds` only prints a netId at 5+ records, so the kits
> (2 records each) show as "claims nothing" even though they are 100% strict.

## 1. KitNetworkable — `sidecar/ghost/kit.mjs` (`decodeKitBody`)

`setNetUpdate` 0x0822ba10, `getNetUpdate` 0x0822b8e0, `updateStateMask` 0x0822b710,
ring of 16 x 0x30-byte states at `+0x4c`.

| mask | name | read | width | field | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readBits(4)` | 4 | — | yes |
| 0x1 | position | `readFullVector` | 2 (mode is not sent; three float32) = 96 | state+4 | yes |
| 0x2 | weapon/part index | `readUnsigned(0, 0x100)` then `-1` | 9 | state+0x20 | yes |
| 0x4 | active/flag | `readBool` | 1 | state+0x28 | yes |
| 0x8 | slot index | `readUnsigned(0, 8)` then `-1` | 4 | state+0x2c | yes |

The two ranged fields store `value-1` after the read. A body is `4` bits plus the
present fields: mask `0x1` -> 100, mask `0xf` -> 114 (the common case).

**Verified.** The three named kits in the corpus decode to the last bit on every
record: netId 601 `Jap_AT` (2/2, 114), 593 `UsMarine_Assault` (2/2, 114),
609 `Jap_Assault` (2/2, one 114 mask `0xf`, one 110 mask `0x7`). No other netId
is claimed. `USMarine_Medic` is named in the task but has no records here.

## 2. SimpleObjectNetworkable — `sidecar/ghost/simple-object.mjs` (`decodeSimpleObjectBody`)

`setNetUpdate` 0x08236d00, `getNetUpdate` 0x08236770, `updateStateMask` 0x08235ee0,
ring of 16 x 0x90-byte states at `+0x54`.

| mask | name | read | width | field | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readBits(11)` | 11 | — | yes |
| 0x2 | position | `readCompressedVector(0.001)` | 2 + 96 (mode 0) / 2+3x20 / 16 / 12 | state+8 | yes, mode 0 |
| 0x1 | rotation | `readUnitQuaternion(32)` | 1 + 3x32 = 97 | state+0x14 | yes |
| 0x4 | vector A | `readCompressedVector(nullVec, 0.001)` | as above | state+0x40 | binary only |
| 0x20 | vector C | `readCompressedVector(nullVec, 0.0001)` | as above | state+0x4c | binary only |
| 0x8 | vector B | `readCompressedVector(nullVec, 0.001)` | as above | state+0x64 | binary only |
| 0x40 | vector D | `readCompressedVector(nullVec, 0.0001)` | as above | state+0x70 | binary only |
| 0x100 | vector E | `readCompressedVector(nullVec, 0.0001)` | as above | state+0x58 | binary only |
| 0x200 | vector F | `readCompressedVector(nullVec, 0.0001)` | as above | state+0x7c | binary only |
| 0x80 | flag | `readBool` | 1 | state+0x8c | binary only |
| 0x10 | hit points | `readUnsigned(0, round(maxHp))` | ranged (7 for 100) | state+0x88 | binary only |
| 0x400 | sub-state | `readUnsigned(2)` | 2 | state+0x8d | binary only |

Order is the decompile's, not the mask order: position, rotation, then the
`0x4/0x20/0x8/0x40/0x100/0x200/0x80` block, then hit points, then `0x400` last.

Two runtime gates sit outside the wire: the `0x4..0x200` vectors and the `0x80`
bool are read only when the object's controller reports one (`updateStateMask`
sets those bits inside the same `if`), and hit points only when a sub-object
resolves. Because the writer never sets a bit the reader would not consume, a
decoder may simply read each field when its mask bit is set; an object whose
controller is absent never has those bits.

Quaternion width: `setNetUpdate` passes `((flag) - 1 & ~0xf) + 0x20`, i.e. 32 bits
when its last bool argument is set, 16 otherwise. `opts.quatBits` selects it and
defaults to **32** — the corpus object's updates are all high precision.

**Verified, with one open burst.** netId 544 `M3A1` is a SimpleObject: its
ordinary update is `mask 0x1` (rotation only) -> `11 + 97 = 108` bits, and its
range-entry full update is `mask 0x3` -> `11 + 98 + 97 = 206` bits. All 20244 of
its 108-bit records and 12 of its 206-bit records decode to the last bit
(20256 / 20302 = 99.8% of its records), which is why the task's M3A1 note ("the
M3A1 body scored 99.5% ... and is really 0%") is a soldier-decoder artefact: as a
SimpleObject it is real. It does **not** reach 100%: 46 records do not fit.

The 46 that miss are not scattered — every one is inside a single 3-second window
(`t 88.03-90.98 s`) whose ghost blocks all report `tick 0`, an anomalous
baseline/range-entry burst. Their bodies carry a 12-bit (mask `0x1`/`0x3`) or
48-bit (mask `0x0`/`0x2`) tail beyond the SimpleObject layout, and mask `0x3`
appears at both 206 (fits) and 218 (12 extra) — so the length is not a function
of the 11-bit mask, i.e. those blocks are either a fuller pre-baseline body or
mis-framed at the tick-0 header. Left as open; the alleged facts are recorded,
not guessed.

## 3. ItemNetworkable — `sidecar/ghost/item.mjs` (`decodeItemBody`)

`setNetUpdate` 0x0822ad90, `getNetUpdate` 0x0822ac30, `updateStateMask` 0x0822aa30,
ring of 16 x 0x30-byte states at `+0x4c`.

| mask | name | read | width | field | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(5)` (5-bit integer) | 5 | — | binary only |
| 0x1 | position | `readFullVector` | 96 | state+4 | binary only |
| 0x2 | value2 | `readBits(32)` | 32 | state+0x20 | binary only |
| 0x4 | value4 | `readBits(32)` | 32 | state+0x24 | binary only |
| 0x8 | active | `readBool` | 1 | state+0x28 | binary only |
| 0x10 | value10 | `readBits(32)` | 32 | state+0x2c | binary only |

A body is `5` bits plus the present fields (a single 32-bit value -> 37 bits). The
corpus does not exercise this class: no netId decodes, and no 5-bit-mask body is
present.

## 4. FreeCameraNetworkable — `sidecar/ghost/free-camera.mjs` (`decodeFreeCameraBody`)

`setNetUpdate` 0x08229ba0, `getNetUpdate` 0x08229a70, `updateStateMask` 0x08229800,
ring of 16 x 0x38-byte states at `+0x4c`.

| mask | name | read | width | field | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readBits(4)` | 4 | — | binary only |
| 0x2 | position | `readCompressedVector(0.001)` | 2 + 96 (mode 0) | state+8 | binary only |
| 0x1 | rotation | `readUnitQuaternion(32)` | 97 | state+0x20 | binary only |
| 0x4 | fov / zoom | `readSigned(8)` | 8 | state+0x30 -> FreeCamera+0x160 | binary only |
| 0x8 | enable | `readBool` | 1 | state+0x34 -> `FreeCamera::m_enableFreeCamera` | binary only |

Position (0x2) is read **before** rotation (0x1). The corpus does not exercise
this class: netId 2 `MultiPlayerFreeCamera` has a single record with `bodyBits 0`
(no body), so there is nothing to verify against a capture.

## 5. Object identification — who is which class

The wire never names a class, so a class is identified by its bodies decoding to
the last bit on every record. Scoreboard results on the frozen snapshot:

| class | netId | template | records | strict |
|---|---|---|---|---|
| Kit | 601 | Jap_AT | 2 | 2 (100%) |
| Kit | 593 | UsMarine_Assault | 2 | 2 (100%) |
| Kit | 609 | Jap_Assault | 2 | 2 (100%) |
| SimpleObject | 544 | M3A1 | 20302 | 20256 (99.8%) |
| Item | — | — | — | none |
| FreeCamera | — (2) | MultiPlayerFreeCamera | 1 | 0 (0-bit body) |

The task's expectation that "the unnamed netIds with ~32-bit bodies are
candidates for SimpleObject or Item" is **not** borne out. netId 1 and netId 3
are the two players — `run.ndjson` has `createPlayer` for `skandia` (netId 1)
and `sidecar` (netId 3) — and their 26/33/42/50-bit bodies are `dice::bf::BFPlayer`
(`setNetUpdate` 0x08053a40): a **24-bit** mask, then `0x2` `readUnsigned(0,0x7f)`
(8 bits), `0x4` bool, `0x8/0x10/0x20/0x40/0x80/0x100/0x200/0x400`
`readUnsigned(0,0xff)` (9 bits each), `0x800` `readSigned(16)`, `0x1000/0x4000/0x8000`
bools, `0x10000` `readUnsigned(0,0x3ff)` (11 bits), `0x2000` `readUnsigned(0,0x7f)`
(8 bits), `0x40000` `readUnsigned(0,0x12)` (5 bits) + bool, `0x80000..0x800000`
`readUnsigned(0,0xff)` (9 bits each), then one unconditional bool. A decoder for
that layout scores netId 3 (1055), 509 (659), 1 (61) and 511 (23) at 100% strict —
i.e. the ~32-bit objects are players, and netIds 509/511 are further BFPlayer
bodies. None of the four classes in this document are among them.

The remaining large netIds are other classes: 589/605/597 are soldiers
(162-bit bodies), 577/560/562/550/531 (Daihatsu/Sherman/Zero/Corsair) share a
`first11 = 0x493` vehicle body, 519/517/518 (the `ALLIES_*` control points) are
7-bit bodies.

## 6. Open

- **SimpleObject, mask 0x4/0x8/0x20/0x40/0x100/0x200/0x80/0x10/0x400.** Decoded
  from the binary but unexercised by the corpus (every M3A1 record uses `0x1` or
  `0x3`). The controller gate that decides whether they are present cannot be
  read off the wire; the decoder reads them whenever their bit is set, which is
  safe because the writer never sets a bit the reader would skip.
- **SimpleObject, the 46-record tick-0 burst (t 88-91 s).** Carries a 12- or
  48-bit tail; mask `0x3` is 206 in one place and 218 in another, so it is not a
  function of the 11-bit mask. Either a pre-baseline body or a mis-framed header
  — unresolved.
- **SimpleObject hit-point width.** `readUnsigned(0, round(maxHp))` takes the
  template Armor's maximum, which is not known per object here; the module
  defaults to `maxHp 100` (7 bits). No corpus record exercises it.
- **Item and FreeCamera are unverified.** Both are implemented from the binary
  and score 0 / 0-in-1 because the capture contains no bodies of either: no
  5-bit-mask Item body, and the only FreeCamera record (netId 2) is 0 bits.
  They must be re-scored against a capture that includes an item pick-up and a
  free-camera flight before their layouts can be called confirmed.
- **Kit `USMarine_Medic`** is named in the task but absent from this capture; the
  kit layout is confirmed only against Jap_AT / Jap_Assault / UsMarine_Assault.
