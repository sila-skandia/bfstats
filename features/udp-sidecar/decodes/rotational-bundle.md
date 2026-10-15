# RotationalBundleNetworkable ghost bodies

Read from `bf1942_lnxded.static` (1.61 Linux dedicated server). A
`RotationalBundle` is a turret / gun / ramp part that turns on its own
(`RotationalBundle` `0x081d73d0`, template `RotationalBundleTemplate`
`0x081d90c0`); `RotationalBundleNetworkable` is the class that carries its state
on the wire.

| function | address |
|---|---|
| `RotationalBundleNetworkable::getNetUpdate` (writer) | `0x082345c0` |
| `RotationalBundleNetworkable::setNetUpdate` (reader) | `0x082347f0` |
| `RotationalBundleNetworkable::updateStateMask` | `0x082341a0` |
| `RotationalBundleNetworkable::getBaseLine` | `0x08233f80` |
| `RotationalBundleNetworkable::getMinimumBitSize` | `0x08235900` (returns 7) |

Decoder: `tools/bf1942-models/sidecar/ghost/rotational-bundle.mjs` —
`decodeRotationalBundleBody`.

## 1. Verification against the review corpus: claims nothing

```
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/ghost/rotational-bundle.mjs \
     decodeRotationalBundleBody run.review.ndjson --names run.ndjson
```

```
decodeRotationalBundleBody over 31590 records: strict 0 (0.0%), under 31577, over 0, threw 13
...
claims nothing cleanly: no netId decodes to the last bit on every record.
```

**The corpus does not exercise this class.** No netId in the review log reads
to the last bit under this layout; every record comes out `under` (the 7-bit
mask names fewer fields than the body holds) or `threw` (the mask names fields
the body does not have, so the read runs off the end and the underflow
propagates). The 13 `threw`s are bodies shorter than their own first 7 bits call
for: the three 7-bit control-point bodies (netIds 517/518/519, masks
`0x53`/`0x03`/`0x4b`), the 11-bit bodies of 594 and 610, the 8-bit body of 602,
and 2 of `USMarineSoldier` 589's 1 811 bodies.

This is a negative result, and it is independently confirmed three ways:

- **Bit-length algebra.** Every body of this class is `7 + 16·popcount(mask)`
  bits — one of **7, 23, 39, 55, 71, 87, 103, 119** — where `mask` is the
  body's own leading 7 bits. Across all 34 512 bodies that prediction equals
  `bodyBits` **zero times**; no netId comes out clean and no individual record
  does either. (A few individual bodies do happen to land on 71 or 87 bits, but
  their own leading mask does not call for that many fields, so they read short
  or run off the end.) `getMinimumBitSize` = 7 confirms the empty body is 7
  bits.
- **Shape probe.** Reading the 7-bit mask of each body and comparing
  `7 + 16·popcount(mask)` to `bodyBits` gives **0 matches**, on every netId.
- **Framing-offset probe.** Re-testing every body at bit offsets 0–7 from the
  start of the recorded body still gives **0 matches**, and for the small
  candidate netIds a scan over skip 0–16 × mask width 1–16 finds no consistent
  `mask + 16-bit fields` layout either. So the recorded framing (validated
  independently by the control-point and soldier decoders) is not hiding an RB
  body one bit in.

Recorded corpus state at the time of the first run: 31 590 action-1 records,
`sha256(run.review.ndjson)` starting `7e8100a4…`, mtime 2026-10-15 22:40:29.
`run.review.ndjson` is being regenerated while agents work — the record count
grew from 20 864 to 34 050 during this task — so the totals above are a
snapshot; `strict 0` has held at every count checked (20 864, 22 962, 26 763,
28 536, 31 590, 33 920, 34 050).

The decoder itself is checked by construction: driving `BitWriter` the way
`getNetUpdate` does (7-bit mask + one `writeSignedFloat` per set bit) and
decoding back gives `consumed == bodyBits` for all 128 masks and every length
7…119. So the bit accounting is right; the corpus simply has no such body.

## 2. The body layout

Each `GhostNetworkable` subclass writes one **unsigned change mask** first
(*n* bits wide, one bit per changeable field, set by `updateStateMask`), then
each field whose bit is set, in mask-bit order. RotationalBundle's mask is **7
bits** (`writeBits(&mask, 7)` at `0x082345f8`; `readBits(&mask, 7)` at
`0x082348f0`), and every field is a 16-bit signed float
(`readSignedFloat(16, limit)` `0x083da200` → `2·readUnsigned(16)/(2^16−1) − 1`,
scaled by `limit`).

| mask bit | name | read | width | reader call (setNetUpdate) | writer call (getNetUpdate) | ring slot → bundle field | limit source | status |
|---|---|---|---|---|---|---|---|---|
| `0x01` | `angleX` | `readSignedFloat(16) · 180.0` (°) | 16 | `0x08234e8c` | `0x082347d6` | `+0x10` → `bundle+0x104` | immediate `0x43340000` = 180.0 | by binary, unexercised |
| `0x02` | `angleY` | `readSignedFloat(16) · 180.0` (°) | 16 | `0x08234e5d` | `0x082347ac` | `+0x14` → `bundle+0x108` | 180.0 | by binary, unexercised |
| `0x04` | `angleZ` | `readSignedFloat(16) · 180.0` (°) | 16 | `0x08234e33` | `0x08234786` | `+0x18` → `bundle+0x10c` | 180.0 | by binary, unexercised |
| `0x08` | `rateX` | `readSignedFloat(16) · \|template+0x174\|·16` (°/s) | 16 | `0x08234e09` | `0x08234760` | `+0x04` → `bundle+0x110` | `flds 0x174(%tmpl)` × `0x86cf24c` = 16.0f | by binary, unexercised |
| `0x10` | `rateY` | `readSignedFloat(16) · \|template+0x178\|·16` (°/s) | 16 | `0x08234dd0` | `0x08234728` | `+0x08` → `bundle+0x114` | `flds 0x178(%tmpl)` × 16.0f | by binary, unexercised |
| `0x20` | `rateZ` | `readSignedFloat(16) · \|template+0x17c\|·16` (°/s) | 16 | `0x08234d99` | `0x082346eb` | `+0x0c` → `bundle+0x118` | `flds 0x17c(%tmpl)` × 16.0f | by binary, unexercised |
| `0x40` | `aux` | `readSignedFloat(16) · 41.0` | 16 | `0x08234d6a` | `0x082346b9` | `+0x1c` → `bundle+0x12c` | immediate `0x42240000` = 41.0 | by binary, purpose open |

(mask itself: `readBits(&mask, 7)` at `0x082348f0`; `writeBits(&mask, 7)` at
`0x082345f8`. The mask-bit test chain in the reader is at `0x08234905` (bit 0),
`0x0823490b` (0x2), `0x08234917` (0x4), `0x08234923` (0x8), `0x0823492f`
(0x10), `0x0823493b` (0x20), `0x0823494a` (0x40) — each testing the 7-bit mask
word at `%ebp-0x16c` and jumping to the matching field block. `ring` is the
networkable's 16-entry ring buffer at `this+0x50`, stride `0x2c`, slot
`(index+1)&0xf`; `bundle` is the `RotationalBundle` at `this+0x3c`. Field order
on the wire is mask-bit order, and the angles come before the rates.)

Field naming, from the class that consumes the values:

- `RotationalBundle::setState` (`0x081d8110`) treats `bundle+0x104/+0x108/+0x10c`
  as the bundle's own rotation vector (`setRotation`, then multiplied into the
  world matrix). `RotationalBundle::calculateAndClipAngle` (`0x081d7490`) wraps
  each to ±180° (`180 < a → a−360`) — hence the wire's 180 limit and the name
  `angleX/Y/Z` (Euler x/y/z, i.e. roll/pitch/yaw axes).
- `calculateAndClipAngle` integrates `bundle+0x104/+0x108/+0x10c +=
  bundle+0x110/+0x114/+0x118 · dt` and clamps each `bundle+0x110…` to
  `input · template+0x174+4i`. So `bundle+0x110/+0x114/+0x118` are the per-axis
  angular **rates** (deg/s) and `template+0x174/+0x178/+0x17c` are the per-axis
  max-rate limits. The writer's `×16` is headroom on the range, not a different
  quantity.
- `aux` (limit 41.0) is applied to `bundle+0x12c` and to nothing else; its role
  is not identified (see Open).

`getBaseLine` (`0x08233f80`) copies only six of the seven ring fields
(`+0x04…+0x18`, i.e. the three rates and three angles) into a shared
`BaseLineData` buffer, so `aux` is not part of a baseline. Bit lengths are
`7 + 16·popcount(mask)`: 7 (mask only) up to 119 (all seven).

## 3. Why there is no such body in this corpus

The turret parts that are RotationalBundles — `M3A1Browning_Holder`,
`ShermanTower`, `ShermanGunBase`, `DefgunTurret`, `AA_Allies_Carriage`,
`DaihatsuLanding1/2`, the `M3A1Wheel*` — are **child networkables without a
netId of their own**, so they never appear as their own ghost record.

Evidence, from the bf42plus client recording of the same level
(`viewer/replays/20261003-205212-wake-coop-rec/`, 331 `jn` records):

- A `jn` record is `[root, part, template]` + the part's local position —
  e.g. `{"k":"jn","t":0.527,"o":[[520,1,"DefgunTurret",…]]}`,
  `[[532,32,"ShermanTower",…]]`, `[[526,13,"AA_Allies_Carriage",…]]`. The part
  is identified by a **part index** (`1, 32, 13`), not by an object id.
- No `k:"o"` record in that recording names any part template (grep for
  `ShermanTower|DefgunTurret|Browning_Holder|AA_Allies_Carriage|DaihatsuLanding`
  among `k:"o"` records: none). The viewer agrees in code
  (`viewer/replay-recording.js`, `case 'jn'`): "A v4 recorder keyed every part 0
  — **a child networkable has no id of its own**".
- In the corpus, the 39 ghost netIds are exactly the objects the server created
  (`createObject` / `k:"o"`), and none of them is a part template.

So the premise that the parts are "objects in the world in their own right" as
far as the ghost stream is concerned does not hold for this build: their state
rides inside their parent, and the parent's bodies (M3A1 netId 544: 59…306
bits; Defgun: 265; Sherman: 222/405; …) are a different class entirely, not a
7-bit mask.

## 4. Closest candidates, for the record

The only corpus netIds whose every body is small enough to *possibly* be a
RotationalBundle (7…119 bits) are:

| netId | records | body lengths | what it is |
|---|---|---|---|
| 517 / 518 / 519 | 1 / 1 / 3 | 7 | `ControlPointNetworkable` (2-bit mask + team + flag = 7) — claimed by `decodes/control-point.md`, mask non-zero so this decoder throws on them |
| 545 / 551 / 578 / 621 | 1 each | 91 | unnamed objects created right after a vehicle (M3A1 544, Sherman 550, Daihatsu 577, Chi-ha 620) — plausible *part* candidates, all four bodies byte-identical (`89ffbfff3fc9ffdfffdff505`) |
| 561 | 60 | 25…91 | unnamed, right after Sherman 560, same neighbourhood |
| 594 / 610 | 1 / 3 | 11 | unidentified; 11 equals `EngineNetworkable::getMinimumBitSize` (10-bit mask + 1 bool), but the engine decoder throws on these, so not Engine |
| 602 | 1 | 8 | unidentified |
| 601 / 593 / 609 | 2 each | 110…114 | soldiers' control objects |
| 1 / 3 | 61 / ~1400 | 26…50 / 33 | unidentified (netId 3's 33-bit body is the same two set bits every time) |

None of these has the RotationalBundle shape: 91 is not `7 + 16k` (7+16·5 = 87,
7+16·6 = 103), and 11, 33 and 114 are not either. The four identical 91-bit
bodies are the best guess for a networked vehicle part, but they belong to some
other class — the mask probe at every framing offset and mask width finds no
consistent `mask + 16-bit fields` layout for them. **They are not a
RotationalBundle body.**

Checked against the sibling decoders landed alongside this one
(`engine.mjs`, `simple-object.mjs`, `spring.mjs`, `firearms.mjs`,
`projectile.mjs`, `free-camera.mjs`, `item.mjs`, `kit.mjs`, run through the same
`verify.mjs`): none of them claims any of 1, 3, 545, 551, 561, 578, 594, 602,
610, 621 either. So the 91-bit companions are not RotationalBundle and not any
of the classes decoded so far — they are simply still unidentified.

## 5. How to re-run

```
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/ghost/rotational-bundle.mjs \
     decodeRotationalBundleBody run.review.ndjson --names run.ndjson
```

`verify.mjs`'s "claims cleanly" line needs ≥5 records per netId, so a class seen
here only 1–3 times would not print even if it were right; the per-netId table
is the real claim. This decoder has no internal `try/catch` around the reads, so
an overrun propagates and shows up as `threw` rather than as a false clean
consumption.

## 6. Open

- **The class is unverified against a capture.** Everything above is read from
  the binary (both the writer and the reader agree, and the bit accounting is
  round-trip checked), but no captured body exercises it. A capture that makes a
  turret or a gun turn should produce 7/23/39/55/71/87/103/119-bit bodies on
  some small netId; until then do not report this as a verified decode.
- **`aux` (mask `0x40`, limit 41.0).** Written to `bundle+0x12c` and read back;
  it is also the only field not in the baseline. What the 41.0 range bounds is
  not identified.
- **The axis ↔ dof mapping.** `angleX/Y/Z` are the x/y/z components of the
  bundle's rotation vector, but which of the three corresponds to the template's
  yaw, pitch and roll inputs (`setInputToYaw/Pitch/Roll`, template
  `+0x198/+0x19c/+0x1a0`) is not resolved here, and neither is which of
  `template+0x174/+0x178/+0x17c` bounds which axis' rate. The template limits
  themselves are per-template (a `DefgunTurret` is yaw −90…90, a
  `DaihatsuLanding1` pitch 0…65 — `viewer/models/*.report.json`), so a caller
  that wants real units passes `opts.rateLimits`; without it the rates come back
  normalised in [−1, 1].
- **Whether the parent's body carries child part state.** The M3A1 (netId 544)
  body is 59…306 bits and encodes its turret somewhere, or the client predicts
  turret rotation rather than receiving it. `netcode.md` (subsystems) records the
  disagreement: one reading says the client has no interpolation buffer and
  applies a single current state, the other finds a 16-entry history per
  networkable and "a RotationalBundle `predict` that interpolates between the two
  records around `now - delay`" (client `0x00559D40`). That decision — does the
  server ever send a RotationalBundle body of its own — determines whether this
  decoder can ever be verified from a capture at all, and this task did not
  settle it. Both readings agree each networkable keeps a 16-record ring that
  `getNetUpdate` serializes whole, so a RotationalBundle body, if sent, is
  self-contained and must be `7 + 16·popcount(mask)` bits — which is why the
  absence of any such length in the corpus is itself the evidence.
