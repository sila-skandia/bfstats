# ControlPointNetworkable / ObjectiveNetworkable ghost bodies

Read from `bf1942_lnxded.static` (1.61 Linux dedicated). Both classes are
`GhostNetworkable` subclasses whose `setNetUpdate` (the reader the sidecar
mirrors) and `getNetUpdate` (the writer) share one layout. Verified against the
review corpus `tools/bf1942-models/run.review.ndjson` with
`tools/bf1942-models/sidecar/ghost/verify.mjs`.

| class | getNetUpdate (write) | setNetUpdate (read) | updateStateMask | getMinimumBitSize |
|---|---|---|---|---|
| `dice::ref2::world::ControlPointNetworkable` | `0x08226d20` | `0x08226de0` | `0x08226cb0` | `0x082272c0` (4) |
| `dice::ref2::world::ObjectiveNetworkable` | `0x08231a60` | `0x08231b20` | `0x08231900` | `0x08232130` (7) |

Decoders:
- `tools/bf1942-models/sidecar/ghost/control-point.mjs` — `decodeControlPointBody`
- `tools/bf1942-models/sidecar/ghost/objective.mjs` — `decodeObjectiveBody`

## The shared shape

Every subclass of `GhostNetworkable` writes one `unsigned` **change mask** first
(`writeBits(&mask, 2)` here — a per-class width), then each field whose mask bit
is set, in mask-bit order. The class keeps a **16-entry ring** of the last-known
field values (one ring slot per frame, `index = (index + 1) & 0xf`); the mask
has a 1:1 bit per changeable field, computed by `updateStateMask`, so an
unchanged field is not sent. `setNetUpdate` re-reads the mask and each present
field into the current ring slot. Bit *n* of the mask ↔ the n-th field written.

The ring slot stride differs per class (the fields it caches):
- ControlPoint: 8 bytes — `int team` at +0, `bool` at +4.
- Objective: 0x14 = 20 bytes — a float at +0 (written by the caller, not the
  wire), the value float at +4, the position vector at +8/+0xc/+0x10.

## ControlPointNetworkable

Body = **2-bit mask**, then:

| mask bit | name | read | width | member | status |
|---|---|---|---|---|---|
| 0x1 | team | `readSigned(4)` (sign bit + 3 magnitude, range −7..7) | 4 | ring+0 (`int`) | confirmed |
| 0x2 | flag | `readBool()` | 1 | ring+4 (`bool`) | confirmed |

Writer cross-check (`0x08226d20`): `writeBits(&mask,2)`; `if (mask&1)
writeSigned(ring+0, 4)`; `if (mask&2) writeBool(ring+4)`. `updateStateMask`
(`0x08226cb0`) sets 0x1 when the team at `object+0x174` changed and 0x2 when the
bool at `object+0x178` changed. `setNetUpdate` applies bit 0 via
`ControlPoint::setTeam` and bit 1 to `object@0x50 +0x178`.

A full body is 7 bits (mask 3); mask-only is 2 bits, mask+team 6, mask+flag 3.

**Verification (strict, underflow propagates).** Corpus bodies for the three
control points are all 7 bits:

| netId | template | records | strict | decoded |
|---|---|---|---|---|
| 519 | `ALLIES_north_village` | 3 | 3/3 (100%) | `53`→team 2 flag 1; `03`→team 0 flag 0; `4b`→team 1 flag 1 |
| 518 | `ALLIES_north_base` | 1 | 1/1 (100%) | `53`→team 2 flag 1 |
| 517 | `ALLIES_southbase` | 1 | 1/1 (100%) | `53`→team 2 flag 1 |

Every one of these reads to the last bit (consumed == 7) and no other netId in
the corpus does — the vehicles, soldiers and world objects all come out `under`
(the decoder reads fewer bits than their bodies), so nothing else is
mis-claimed. `decodeControlPointBody over 23160 records: strict 5, under 23154,
over 0, threw 1` (the one `threw` is a 0-bit body on netId 2, not a control
point). The three templates were captured as Axis-held (team 2) at first and
`ALLIES_north_village` flips to team 1, the classic conquest capture.

Team values seen: 0, 1, 2 — consistent with 1 = Allies, 2 = Axis, 0 = uncaptured
(vanilla `ControlPoint::setTeam` takes the BF1942 team id). `readSigned` (rather
than unsigned) is what the binary calls, so a negative value is possible but
never appears in this corpus.

`verify.mjs`'s "claims cleanly" line needs netId ≥ 5 records and prints
"claims nothing cleanly" here only because a control point sends a body every 7
bits and few of them — 3, 1, 1 records. The per-netId table is the claim.

## ObjectiveNetworkable

Body = **2-bit mask**, then:

| mask bit | name | read | width | member | status |
|---|---|---|---|---|---|
| 0x1 | position | `readFullVector()` (3 × float32, absolute) | 96 | ring+8 | by binary, unexercised |
| 0x2 | value | `readSignedFloat(5, 1.0f)` → 2·u/31 − 1 ∈ [−1, 1] | 5 | ring+4 | by binary, unexercised |

Writer cross-check (`0x08231a60`): `writeBits(&mask,2)`; `if (mask&1)
writeFullVector(ring+8)`; `if (mask&2) writeSignedFloat(ring+4, 5, 1.0f)`.
`updateStateMask` (`0x08231900`) sets 0x1 when the world-space position vector
changed and 0x2 when the float `objective@0xf8` (a virtual read) changed.
`getMinimumBitSize` = 7 = mask(2) + value(5), the cheapest non-empty body.

**Status: not verified — the corpus does not exercise this class.** There is no
`ObjectiveNetworkable` object in `run.review.ndjson` (the 39 netIds are control
points, soldiers, vehicles and world objects; none decodes to the last bit). The
layout above is read from the binary only. Do not report it as a verified
decode.

## Open

- **What the control-point `bool` (mask 0x2) means.** `setNetUpdate` stores it at
  `ControlPointNetworkable`'s ring+4 and applies it to `object@0x50 +0x178`; the
  field is not otherwise named here. Likely a capture/ownership or "team
  changed" latch, but not traced to a `ControlPoint` member.
- **`getMinimumBitSize` = 4 for ControlPoint.** With a 2-bit mask and a 1-bit
  bool the cheapest body is 3, so 4 is off by one (or counts a field that never
  travels alone). It does not affect the decode — the corpus bodies are 7 bits
  and decode to exactly 7 — but the constant is unexplained.
- **Objective's `value` (`readSignedFloat(5,1.0)`)** is a virtual method's return
  (`objective@0xf8`) in `updateStateMask`; what that method returns (a capture
  fraction, a timer, something else) is not identified. The position is a plain
  absolute world vector.
- No objective body wider than the class specific fields appeared, and the
  `param_3` float written to ring+0 is caller-supplied, not on the wire.
