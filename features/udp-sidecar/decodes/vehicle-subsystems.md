# Vehicle & weapon subsystems: the Engine, Spring, Projectile and FireArms ghost bodies

Read from `bf1942_lnxded.static` (1.61 Linux dedicated server) on 2026-10-15.
The four decoders live in `tools/bf1942-models/sidecar/ghost/`
(`engine.mjs`/`decodeEngineBody`, `spring.mjs`/`decodeSpringBody`,
`projectile.mjs`/`decodeProjectileBody`, `firearms.mjs`/`decodeFireArmsBody`).
This note is the per-field map and the corpus-exercise verdict.

## Method

For each class the **reader** is `…Networkable::setNetUpdate` and the **writer**
is the same class's `getNetUpdate`; the fields, their order and their widths are
taken from the reader and cross-checked against the writer (same fields, same
guards, same order). `updateStateMask` gives the meaning of each mask bit.

**Framing (corrected 2026-10-15, by decompiling the reader).** `GhostManager::readData`
(`0x08141ed0`) reads a 2-bit action, a 16-bit netId, and for action 1 a bool + an
11-bit body length, then resolves the netId to a **`NetworkableDescriptor`**
(`networkManager` vtable `+0x2c` = `NetworkManager::getDescriptor 0x0842d2a0`) and
hands that descriptor, not one networkable, to `networkManager` vtable `+0x38` =
**`NetworkManager::setNetUpdate 0x084315f0`**. It then requires
`getBitPosition() - start == bodyBits` (else the record is a decode failure), and
`skipBits(bodyBits)` when the netId is unknown.

`setNetUpdate` (`0x084315f0`) is a **nested loop**: it walks the descriptor's
networkable list at `descriptor+0xc … descriptor+0x10` (stride 3 words) and, for
each entry, an inner list, calling `(*networkable + 0x1c)(stream, …)` — each
networkable's own `setNetUpdate` — saving and restoring the bit position around
each. So **one framed record is a whole descriptor: the hull plus its child
networkables, concatenated, sharing one bit budget**, and `bodyBits` is the
length of all of them together.

This is not a reading, it is what the corpus shows: `ghost/pco.mjs` decodes
`544 M3A1` to **100.0% strict on 42772 of 42772 records** only when the hull
(SimpleObject) is followed by its children in tree order, and every hull-only
decoder stops short — `simple-object.mjs` alone, `engine.mjs` alone and the rest
all score 0 on the other vehicles for exactly that reason. An earlier version of
this section asserted the opposite ("one framed record is exactly one
networkable's body") and called it proven; it was read off `readData` without
following the call into `setNetUpdate`. The per-class field maps below are
unaffected — a class's fields are still that class's fields — but a decoder for a
composite object must read the hull **and** its children, and the child list is a
property of the template, not of the wire (`player-control-object.md`).

**BitStream primitives** (all `dice::ref2::io::BitStream`):

| what | address | semantics |
|---|---|---|
| `readUnsigned(int)` | `0x083da010` | `readBits(n)` — a literal n-bit field (this is the "fixed width" reader) |
| `readUnsigned(uint,uint)` | `0x083da040` | ranged `[min,max]`, width = smallest n with `(1<<n)-1 >= max-min+1` |
| `readSigned(int)` | `0x083da1b0` | sign bit + `n-1` magnitude bits |
| `readBool` | `0x083da120` | 1 bit |
| `readSignedFloat(int)` | `0x083da280` | `2*readUnsignedFloat(n)-1`; the 2-arg form `0x083da200` forwards and **ignores `max`** |
| `readUnsignedFloat(int)` | `0x083da440` | `readUnsigned(n) / ((1<<n)-1)` |
| `readCompressedVector(Vec3,float)` | `0x083db760` | 2-bit mode; mode 0 = 3 float32 (98 bits total), mode 1/2/3 = 3 × `readSigned` of `m_compressionVectorBitTable` = [32,20,16,12] (`0x08749244`) |
| `readHighCompressedVector(Vec3,float)` | `0x083db9e0` | same shape, coarser table `m_highCompressionVectorBitTable` = [32,12,10,8] (`0x08749254`) |
| `readUnitQuaternion(int)` | `0x083db4f0` | sign bit + 3 × `readSignedFloat(n)` = `1 + 3n` bits |

**Self-test.** Each decoder round-trips a body written by `BitWriter` to the
writer's field list and consumes exactly its length (engine 42/132 bits, spring
1/65, projectile 197, firearms 2/12), and each propagates an underflow in strict
mode.

## Engine — `EngineNetworkable`

reader `setNetUpdate` `0x08227da0`; writer `getNetUpdate` `0x082279d0`;
`updateStateMask` `0x08227620`; `EngineTemplate::getNumberOfGears` `0x0823fd40` (`*(tmpl+0x360)`).

`readUnsigned(10)` presence mask, then in this order:

| mask | field | read | width | address | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(10)` | 10 | `0x08227da0` | binary |
| 0x001 | flag (Engine `+0x142`) | `readBool` | 1 | `0x08227da0` | binary |
| 0x002 | flag (Engine `+0xee`) | `readBool` | 1 | `0x08227da0` | binary |
| 0x004 | flag (`+0xb4`) | `readBool` | 1 | `0x08227da0` | binary |
| 0x008 | gear | `readUnsigned(0, getNumberOfGears())` | `rangedBits(0,gears)` | `0x08227da0` | binary; **width template-dependent** |
| 0x010 | angle A | `readSignedFloat(16)` | 16 | `0x08227da0` | binary |
| 0x020 | angle B | `readSignedFloat(16)` | 16 | `0x08227da0` | binary |
| 0x040 | angle C | `readSignedFloat(16)` | 16 | `0x08227da0` | binary |
| 0x080 | value (1.25 range) | `readSignedFloat(12)` | 12 | `0x08227da0` | binary |
| 0x100 | value (1.25) | `readSignedFloat(12)` | 12 | `0x08227da0` | binary |
| 0x200 | value (1.25) | `readSignedFloat(12)` | 12 | `0x08227da0` | binary |
| — | counter | `readUnsigned(32)` | **32, unconditional** | `0x08227da0` / wr `0x082279d0` | binary |

The trailing 32-bit value is written and read unconditionally, so **every
engine body is at least 10 + 32 = 42 bits even with a zero mask**. The three
16-bit and three 12-bit fields come from `Engine::…` floats; the 12-bit ones are
written with the constant scale `0x3fa00000` (1.25) and the 16-bit ones with a
template-derived range, but the reader ignores the range argument, so only the
widths matter.

## Spring — `SpringNetworkable`

reader `setNetUpdate` `0x08239270`; writer `getNetUpdate` `0x08239190`;
`updateStateMask` `0x08239030` (sets bit 0 when the spring moved).

| mask | field | read | width | address | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(1)` | 1 | `0x08239270` | binary |
| 0x1 | point A | `readHighCompressedVector(0.002)` | 2 + 96, or 2 + 3·{12,10,8} | `0x08239270` | binary |
| 0x1 | point B | `readHighCompressedVector(0.002)` | same | `0x08239270` | binary |

Both vectors are read only when the mask bit is set. All widths are fixed by the
mode, so a spring body needs **no** template knowledge. Scale constant
`0x3b03126f` (0.002).

## Projectile — `ProjectileNetworkable`

reader `setNetUpdate` `0x08232be0`; writer `getNetUpdate` `0x082329f0`;
`updateStateMask` `0x08232630`.

| mask | field | read | width | address | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(8)` | 8 | `0x08232be0` | binary |
| 0x02 | position | `readCompressedVector(0.01)` | 2+96 / 2+3·{20,16,12} | `0x08232be0` | binary |
| 0x01 | rotation | `readUnitQuaternion(12)` | 37 | `0x08232be0` | binary |
| 0x04 | armed/active | `readBool` | 1 | `0x08232be0` | binary |
| 0x08 | detonate | `readBool` | 1 | `0x08232be0` | binary |
| 0x10 | velocity | `readCompressedVector(0.01)` | 2+96 / 2+3·{20,16,12} | `0x08232be0` | binary |
| 0x20 | field `+0x3c` | `readUnsigned(4)` | 4 | `0x08232be0` | binary |
| 0x40 | field `+0x40` | `readUnsigned(8)` | 8 | `0x08232be0` | binary |
| 0x80 | field `+0x44` | `readUnsigned(2)` | 2 | `0x08232be0` | binary |

Field order is pos, rot, bool, bool, vec, u4, u8, u2; all widths fixed, so no
template knowledge is needed. Scale constant `0x3c23d70a` (0.01).

## FireArms — `FireArmsNetworkable`

reader `setNetUpdate` `0x08228f70`; writer `getNetUpdate` `0x08228e50`;
`updateStateMask` `0x08228d10`.

| mask | field | read | width | address | confirmed |
|---|---|---|---|---|---|
| — | presence mask | `readUnsigned(2)` | 2 | `0x08228f70` | binary |
| 0x1 | magazine A | `readUnsigned(0, tmpl+0x228 + 1) − 1` | `rangedBits(0, magA+1)` | `0x08228f70` | binary; **width template-dependent** |
| 0x2 | magazine B | `readUnsigned(0, tmpl+0x234 + 1) − 1` | `rangedBits(0, magB+1)` | `0x08228f70` | binary; **width template-dependent** |

The writer emits `value+1` in `[0, *(tmpl+0x228)+1]`; the template bound `-1`
disables that field (`setNetUpdate` gates bit 2 on `tmpl+0x234 != -1` and bit 1
on `tmpl+0x228 != -1`). A gun that is not firing sends a bare 2-bit body. The
two bounds are the FireArms template's magazine sizes and are **not** known from
the corpus, so the widths cannot be pinned — the decoder takes them as
`opts.magA` / `opts.magB`.

## What the corpus exercises

`run.review.ndjson`, 2026-10-15 lab run (Wake Island co-op, sidecar on foot and
in vehicles). One corpus snapshot of 26 043 action-1 records over 39 netIds was
scanned (the live file keeps growing while other workers run the sidecar, so the
numbers below are from a snapshot; re-running `verify.mjs` on the live file gives
the same verdicts).

```
node sidecar/ghost/verify.mjs sidecar/ghost/<file>.mjs <export> run.review.ndjson --names run.ndjson
```

| class | strict (snapshot 26 043) | strict (live, 39 793) | verdict |
|---|---|---|---|
| `decodeSpringBody` | 0 | 0 | **not exercised** |
| `decodeEngineBody` | 0 | 0 | **not exercised** |
| `decodeProjectileBody` | 0 | 0 | **not exercised** |
| `decodeFireArmsBody` | 0 | 0 | **touched but unverified** (see below) |

Every decoder leaves an underflow to propagate, so these are strict scores, not
the swallowed-throw artefact `verify.mjs` warns about.

**Engine — no records.** No netId's bodies match the engine grammar for any gear
count, and the engine body has a floor of 42 bits while the only bodies that
short are accounted for by other classes. The vehicles that would carry an
engine never send one in this run.

**Spring — no records.** No body in the corpus is 1 bit, and none decomposes as a
mask bit plus two high-compressed vectors.

**Projectile — no records.** The only projectile objects in the world — netIds
590/591/592 (`GrenadeAxisProjectile`) and 598/599/600 (`GrenadeAlliesProjectile`)
— appear in `createObject` but never in the ghost stream. No 8-bit-mask body
exists. The class is unexercised.

**FireArms — five records, unverified.** By elimination it is the only one of the
13 networkable classes that can produce the three bodies seen:

| netId | records | body bits | mask | hex |
|---|---|---|---|---|
| 594 | 1 | 11 | 3 | `d703` |
| 610 | 3 | 11 | 3 | `d703` |
| 602 | 1 | 8 | 3 | `7b` |

A 2-bit mask of 3 with two magazine fields gives `2 + w1 + w2 = 11` (594/610) and
`2 + w1 + w2 = 8` (602); ControlPoint caps at 7 bits and every other class is far
longer for that mask, so FireArms is the only fit. And each length is exact once
the widths are right: with `magA ≈ 6..13` / `magB ≈ 14..29` (widths 4 and 5),
`decodeFireArmsBody` consumes **11/11** on all four records of 594 and 610;
with `magA = magB ≈ 2..5` (widths 3 and 3) it consumes **8/8** on 602's single
record. The two lengths need different magazine sizes — different weapons — so
one parameter set cannot cover both, and no netId reaches the 5-record threshold.
**The FireArms decode is therefore structurally forced and each body decodes to
the last bit under the right widths, but the widths are not knowable from this
corpus**: treat it as unproven until a firing-heavy run gives a netId enough
records to pin the magazine sizes.

## Open: the vehicle body (the transform class)

The vehicles carry a transform that the engine/spring sub-bodies would sit
beside, and pinning it down is what the four decoders here wait on. What the
corpus proves:

- The M3A1 (netId 544) is `SimpleObjectNetworkable` (`0x08236d00` /
  `0x08236770`): 18 984 of 19 042 of its bodies are exactly an 11-bit mask 0x1 +
  `readUnitQuaternion(32)` = 108 bits, and 12 more are mask 0x3 + position +
  rotation = 206 bits, both landing on the last bit.
- The other vehicles' bodies also start with an **11-bit mask of 0x3 and a
  position at bits 11..108**. Decoding bit 11 as a compressed vector (2-bit mode
  0, then three float32) puts the world position exactly where `createObject`
  says the object is: netId 577 `1173.44, 95.65, 360.75` (spawn 1173, 98, 361),
  netId 560 `1040.33, 110.42, 1231.55` (spawn 1040, 110, 1232), netId 562
  `421.07, 108.84, 1502.25` (spawn 405, 109, 1491). So the leading mask and the
  first field are SimpleObject's.
- But the bodies are then 8 (577), 28 (560), 64 (562) and 199 (620) bits longer
  than SimpleObject can produce for a mask of 0x3 (which is only position +
  rotation = 206 bits), and for 577/560/562 the whole excess is zero bits while
  620's is structured. No re-read of the mask bits explains it, and the excess
  is not a sum of the class's vector widths.

So the transform networkable is SimpleObject-shaped but its `setNetUpdate`
(`0x08236d00`) as decompiled does not account for the tail. That is a real gap in
the vehicle body, outside these four classes, and it is why the engine and spring
sub-bodies cannot be located: the run's vehicle records are attributed to a
class that is one step from identified. A second pass over `0x08236d00` /
`0x08236770` with the vehicle templates loaded is the next move.

This matches the sibling class map: `class-map.md` fixes the vehicles as
`SimpleObjectNetworkable` through the PlayerControlObject branch and lists them as
"not yet" decoded, with the same shortfall pattern (multiples of 16 bits plus a
few larger gaps; `577 Daihatsu` gaps 8, 24, 40, 56, 72, 162). `ghost/simple-object.mjs`
(`decodeSimpleObjectBody`) reproduces the 108-bit M3A1 exactly and stops short on
every other vehicle, as it does here. Cross-checked 2026-10-15: running that
decoder on the 91-bit unnamed netIds 545/551/578/621 (mask 0x789) underflows,
so their "clean at 91 bits" row in `class-map.md` does not reproduce with the
decoder as it stands — worth re-checking before it is relied on.

Other open items:

- The M3A1's rare bodies (59, 71, 121, 157, 218, 306 bits; 45 of 19 042 records)
  and the small unnamed netIds (1, 3, 509, 511, 513, 514, 545, 551, 561, 578,
  594, 602, 610, 621 — none of them in `createObject`) also match no grammar read
  here; 594/610/602 are the FireArms candidates above, the rest are unidentified.
- The Engine gear count (`EngineTemplate +0x360`) and the FireArms magazine bounds
  (`tmpl +0x228`, `+0x234`) are template values that are not in the corpus; the
  decoders take them as options with defaults.
- The aim/angle semantics of the six Engine float fields are only their widths
  here; the scale constants (`0x3fa00000` = 1.25 for the 12-bit fields) are
  written but the reader discards the range, so the decoded values are normalised.
