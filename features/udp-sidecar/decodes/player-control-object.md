# PlayerControlObject (vehicles): the ghost body

Class assigned: `dice::ref2::world::PlayerControlObjectNetworkable` ("its
getNetUpdate is at `0x08232340`"). Read from `bf1942_lnxded.static` (1.61 Linux
dedicated server) on 2026-10-15. Decoder:
`tools/bf1942-models/sidecar/ghost/pco.mjs` (`decodePcoBody`).

## Verdict in one line

`PlayerControlObjectNetworkable` is a **decoy**: its `getNetUpdate`
(`0x08232340`) is `return 1;` and its `setNetUpdate` (`0x08232350`) is an empty
`ret`, so a PCO networkable contributes **zero body bits**. The vehicle bodies
are read by **`SimpleObjectNetworkable::setNetUpdate` `0x08236d00`**, and each
framed record is **not one networkable but the whole object's networkable list
concatenated** — the hull followed by its child Engine/Spring/RotationalBundle
bodies. Decoding the hull alone therefore always stops short on every vehicle.
With that model the **M3A1 (netId 544) is claimed clean: 40 762 of 40 762
records strict, 100%**. No other template is claimed; see Open.

```
node sidecar/ghost/verify.mjs sidecar/ghost/pco.mjs decodePcoBody run.review.ndjson --names run.ndjson
decodePcoBody over 49795 records: strict 40811 (82.0%), under 1013, over 0, threw 7971
claimed clean on every record (>=5): 544(M3A1):40762
```

## 1. Why the named class is a decoy

`nm -C bf1942_lnxded.static` shows `PlayerControlObjectNetworkable::getNetUpdate`
and `setNetUpdate` as **weak** symbols at `0x08232340`/`0x08232350`; `objdump`
confirms `getNetUpdate` is `mov eax,1; ret` and `setNetUpdate` is a bare `ret`
(the class's `predict` at `0x08232360` is a bare `ret` too, and its vtable at
`0x0872b628` points getNetUpdate/setNetUpdate at those stubs).

`PlayerControlObject::initNetworkableComp` (`0x08316ea0`):

```c
if (*(u32*)(this + 0x50) == 0)
    SimpleObject::initNetworkableComp(this);   // -> SimpleObjectNetworkable
else if (this+0x4c && template->getNetworkableInfo() != "")
    setNetworkableComp(this, 0x985f);          // -> PlayerControlObjectNetworkable
```

`SimpleObject::initNetworkableComp` (`0x081daaf0`) passes `39000` = `0x9858`
(`CID_SimpleObjectNetworkable`); `39007` = `0x985f` is
`CID_PlayerControlObjectNetworkable`. Every vehicle in the corpus has a
non-zero body, so every one of them took the `SimpleObject` branch. This agrees
with the sibling `class-map.md` §2 and with `server-replay-recorder` ledger P-3
("every vehicle and fixed gun `SimpleObjectNetworkable` (`0x0872b808`)").

## 2. The record is the whole descriptor, not one class

This is the piece that the sibling notes (`vehicle-subsystems.md` §Method,
`class-map.md` §2) get wrong: they read `GhostManager::readData` (`0x08141ed0`)
as "one framed record is exactly one networkable's body". It is the descriptor's
**networkable list**:

- `readData` resolves the netId to a `NetworkableDescriptor` (networkManager
  vtable `+0x2c`) and calls `NetworkManager::setNetUpdateDelta`
  (networkManager vtable `+0x38` = `0x08431a70`).
- `NetworkManager::getNetUpdateDelta` `0x084317b0` / `getNetUpdate` `0x08431400`
  loop `descriptor+0xc .. descriptor+0x10` (a vector, **3 words per element**)
  and call each networkable's `getNetUpdate` (net vtable `+0x18`) in turn.
- On the send side `GhostManager::writeData` `0x08141dd0` does the same: it
  writes the 2-bit action and netId, reserves the 11-bit length, calls
  networkManager vtable `+0x34` over `descriptor+0xc`, then patches the length
  to the bits consumed. So `bodyBits` is the **sum** over the object's
  networkables.
- `NetworkManager::_analyseObject` `0x0842d2f0` fills that vector: the object's
  own networkable first, then it recurses into every descendant that is **not**
  a `PlayerControlObject` (queryInterface `0xc4c5`) — i.e. into its Engine,
  Spring, RotationalBundle children, in tree order.

So a vehicle body = `SimpleObjectNetworkable` (hull) then each child
networkable, each self-describing (its own presence mask first). That is why the
sibling `engine.mjs`/`spring.mjs`/`projectile.mjs` report "no records": those
bodies only ever occur inside their parent's record, and why the hull-only
`simple-object.mjs` decoder stops short on every vehicle but the M3A1.

## 3. The hull — `SimpleObjectNetworkable` (reader `0x08236d00`, writer `0x08236770`)

Presence mask `readUnsigned(11)`, then in this order (order is the decompile's,
position before rotation):

| mask | field | read | width | address | confirmed |
|---|---|---|---|---|---|
| — | mask | `readUnsigned(11)` | 11 | `0x08236d00` | corpus |
| `0x2` | position | `readCompressedVector(0.0005)` | 2 + 96 (mode 0) | `0x08236d00` | corpus (spawn positions) |
| `0x1` | rotation | `readUnitQuaternion(16)` | 1 + 3·16 = 49 | `0x08236d00` | corpus (unit, pure yaw) |
| `0x4` | vector | `readCompressedVector(nullVec, 0.001)` | 2 + 3·{32,20,16,12} | `0x08236d00` | not exercised |
| `0x20` | vector | `readCompressedVector(nullVec, 1e-4)` | same | `0x08236d00` | not exercised |
| `0x8` | vector | `readCompressedVector(nullVec, 0.001)` | same | `0x08236d00` | not exercised |
| `0x40` | vector | `readCompressedVector(nullVec, 1e-4)` | same | `0x08236d00` | not exercised |
| `0x100` | vector | `readCompressedVector(nullVec, 1e-4)` | same | `0x08236d00` | not exercised |
| `0x200` | vector | `readCompressedVector(nullVec, 1e-4)` | same | `0x08236d00` | not exercised |
| `0x80` | flag | `readBool` | 1 | `0x08236d00` | not exercised |
| `0x10` | hit points | `readUnsigned(0, round(maxHp))` | `rangedBits(0,maxHp)` | `0x08236d00` | 1 M3A1 record |
| `0x400` | subState | `readUnsigned(2)` | 2 | `0x08236d00` | 1 M3A1 record |

- The `0x4`..`0x200` vectors and the `0x80` flag are written only when the
  object's component `*(*(this+0x3c)+0x60)` answers true at vtable `+0xe0`; the
  `0x10` hit points only when an Armor is present (queryInterface `0xc4a4`). No
  vehicle record in the corpus sets `0x4/0x8/0x20/0x40/0x80/0x100/0x200`, so
  those rows are read from the binary only.
- **The rotation is a 16-bit quaternion, not 32.** The engine's width is
  `((flag != 0) - 1 & ~0xf) + 0x20` — 32 when the caller flag is set, 16 when
  clear. Reading the M3A1's mask-0x1 body at 16 bits gives a clean pure-yaw unit
  quaternion (|q| = 1, x = z = 0); at 32 bits the same bits are not a unit
  quaternion (|q| ≈ 1.4, z saturated). `opts.quatBits` overrides it.
  *This contradicts `vehicle-subsystems.md`, which reads the 108-bit M3A1 as
  "mask 0x1 + readUnitQuaternion(32)" — that length is the coincidence
  11 + 97 = 11 + 49 + 48, and the 32-bit reading is the non-unit one.*
- `readCompressedVector` (`0x083db760`) uses `m_compressionVectorBitTable` =
  `[32,20,16,12]`; `readUnitQuaternion` (`0x083db4f0`) is `1 + 3n`.

## 4. The child tail

After the hull, each child networkable writes its own mask then its fields. The
**sequence of child types is not on the wire** — it is fixed by the object
template (the tree `_analyseObject` walks) and cannot be recovered from a body
alone. `decodePcoBody` takes it as `opts.children` (`'E'` engine, `'S'` spring,
`'R'` rotational bundle); the default is the M3A1's.

Child layouts, read from their readers and cross-checked against their writers:

**`E` EngineNetworkable** — reader `0x08227da0`, writer `0x082279d0`.
`readUnsigned(10)` mask, then: `0x1/0x2/0x4` `readBool` (Engine `+0x142`,
`+0xee`, `+0xb4`); `0x8` `readUnsigned(0, getNumberOfGears())`
(`EngineTemplate::getNumberOfGears` `0x0823fd40`, `*(tmpl+0x360)`);
`0x10/0x20/0x40` `readSignedFloat(16)`; `0x80/0x100/0x200` `readSignedFloat(12)`;
then `readUnsigned(32)` **unconditionally** — so a zero-mask engine is 42 bits.

**`S` SpringNetworkable** — reader `0x08239270`, writer `0x08239190`.
`readUnsigned(1)` mask; when set, two `readHighCompressedVector(0.002)`. The
high-compressed table is `m_highCompressionVectorBitTable` = **`[32,12,10,8]`**
(`0x08749254`), *different from* `readCompressedVector`'s `[32,20,16,12]`
(`0x08749244`) — using the compressed table here is a silent off-by-8-bits-per-axis
bug (it made the M3A1 tail unfindable in an earlier pass).

**`R` RotationalBundleNetworkable** — reader `0x082347f0`, writer `0x082345c0`.
`readUnsigned(7)` mask, then a `readSignedFloat(16)` per set bit (order
`0x1,0x2,0x4,0x8,0x10,0x20,0x40`).

### The M3A1 (netId 544) — claimed clean

`S S E S S S S`: two springs, one engine, four springs. With all-zero child
masks that is 48 bits, so the two common M3A1 bodies are
`11 (mask) + 49 (quat) = 60` → **108 bits** (mask 0x1), and
`11 + 0 = 11` → **59 bits** (mask 0, engine 42 + six springs 6 = 48). The 59-bit
body is what rules out the "32-bit quaternion, no children" reading: a mask-0
hull cannot produce 59 bits by itself.

One M3A1 record carries a gear (engine mask `0x3fc`, body 306 bits). It is
exact only at a 3-bit gear field, i.e. 3..6 gears; `DEFAULT_GEARS = 4`.
The width is pinned, the exact count is not (`getNumberOfGears` is a template
value and this is the only record that exercises it). With that, **40 762 of
40 762 M3A1 records are strict** — the whole netId, no misses.

### Other templates — not claimed

The child list per template was searched for over `{S,E,R}` with the corpus as
the oracle (brute force on a sample, then beam search). Best fits, none exact:

| template | netId | best sequence found | exact |
|---|---|---|---|
| M3A1 | 544 | `SSESSSS` | 100% (claimed) |
| Daihatsu | 577 | `ERR` | 1057 / 1058 |
| Sherman | 560 | `ESSSSRRSSSS` | 700 / 781 |
| Sherman (2nd) | 550 | `ESRRR` | 67 / 68 |
| Zero | 562 | `E RRRRRR SSSS` | 668 / 688 |
| Corsair | 531 | `RRRSREE` | 22 / 56 |
| Chi-ha | 620 | `SRSSS` | 1 / 1 |

The hull part of every one of these is right (both position and rotation land on
real Wake Island coordinates and a unit quaternion); what is unverified is the
child list. They are in `CHILDREN_BY_TEMPLATE` in `pco.mjs` but are **not** the
default and are not trusted. Two things are missing: at least one child type not
in `{E,S,R}` (the templates with 5–7 distinct body lengths per netId have
state-dependent tails longer than any `{E,S,R}` sequence produces), and the
number of children per template (the zero-mask floor, e.g. Sherman 64,
Daihatsu 56, Zero 112, Corsair 208 bits, is not explained exactly).

## 5. What this settles and what it changes

- **Settles:** the vehicle ghost body is not one class's body. It is the hull
  (`SimpleObjectNetworkable`) plus the descriptor's child networkables
  concatenated. Any decoder for a vehicle — or for an Engine/Spring/
  RotationalBundle in this world — has to walk the whole list.
- **Settles:** the M3A1's body, 4 fifths of the corpus body stream, decodes
  exactly, every record, with a fixed field map.
- **Corrects a sibling note:** `vehicle-subsystems.md` concludes the trace excess
  is "a real gap" in `SimpleObjectNetworkable::setNetUpdate`. It is not a gap in
  that function; it is the next networkable in the record. The same note's
  parenthetical that the sibling decoders have "no records" because their bodies
  are concatenated is the mechanism.
- **Contradicts `vehicle-subsystems.md`/`class-map.md`:** "one framed record is
  exactly one networkable's body". The M3A1's 59-bit body is the counter-example.

## 6. Open (not guessed)

1. **The child list is not on the wire.** It must come from the object's
   template tree (`Objects/Vehicles/<type>/Objects.con`, addTemplate order —
   the same `.con` files `class-map.md` §4 cites). Reading those, or the
   descriptor's networkable vector at runtime, is the way to pin every template
   rather than searching. Until then only the M3A1 is decoded.
2. **Zero-mask child floors are not matched** for Daihatsu (56), Sherman (64),
   Zero (112), Corsair (208). Something in `{E,S,R}` is still wrong or missing
   for those trees — most likely a child type not read here (Item? FireArms as a
   vehicle weapon? Objective?) or a different Spring/Engine field set.
3. **`EngineTemplate::getNumberOfGears`** is a template value; only its width
   (3 bits on the M3A1) is pinned, and from one record.
4. **The hull's `0x4..0x200` controller vectors and `0x80` flag** are never
   exercised by a vehicle in this corpus, so their widths are read from the
   binary, not confirmed on the wire.
5. **The `0x10` hit-point width** depends on the template's Armor maximum and is
   not pinned (the one M3A1 record that sets it is also the one with the gear, so
   the two unknowns could not be separated — either a 3-bit gear or a 9-bit hp
   makes it exact; the gear is preferred because the engine's `0x8` bit is
   actually set in it).
6. Whether `object+0x50` (the PCO branch selector) is a template flag or
   instance state stays open; `class-map.md` §7 has the same question.
