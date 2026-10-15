# BFSoldierNetworkable ghost body: the residual, the aim limits, the hit points

Read from `bf1942_lnxded.static` (1.61 Linux dedicated server) and verified
against the review corpus `tools/bf1942-models/run.review.ndjson` with
`tools/bf1942-models/sidecar/ghost/verify.mjs`. Decoder:
`tools/bf1942-models/sidecar/soldier-ghost.mjs` (`decodeSoldierBody`).

| function | address |
|---|---|
| `BFSoldierNetworkable::setNetUpdate` (reader) | `0x08224e40` |
| `BFSoldierNetworkable::getNetUpdate` (writer) | `0x082246e0` |
| `BitStream::readSignedFloat(int bits, float scale)` | `0x083da200` |
| `BitStream::readSignedFloat(int bits)` | `0x083da280` |
| `BFSoldier::handlePlayerInput` | `0x08273c70` |
| `Armor::getMaxHitPoints` | `0x08173f20` (returns `Armor+0x3c`) |
| `Armor::getHitPoints` | `0x08173f30` (returns `Armor+0x38`) |
| `vtable for dice::ref2::world::Armor` | `0x0871d220` (vptr `0x0871d228`) |

The field map lives in `soldier-ghost.mjs`'s header comment and wire.md §13;
this note records only what changed and what settled two fields that were open.

## 1. The residual: every remaining underflow was the hit-point width

The decoder was strict on every soldier body that did **not** carry mask `0x80`
(`hp`), and threw on every body that did. On one snapshot of the corpus
(`run.review.ndjson` was being appended to by another agent while this was
measured, so absolute counts move between runs; take the ratios):

```
cd tools/bf1942-models
# BEFORE, forced back to the old widths (maxHp 100 -> 7-bit hp):
#   netId 589 USMarineSoldier  1787 of 1788
#   netId 605 JapaneseSoldier   459 of  471
#   netId 597 JapaneseSoldier   515 of  518
# AFTER:
#   netId 589 USMarineSoldier  1788 of 1788
#   netId 605 JapaneseSoldier   471 of  471
#   netId 597 JapaneseSoldier   518 of  518
# A later run, corpus 83 lines longer: 1804/1804, 471/471, 536/536.
```

(the task's quoted snapshot — 1514/1515, 459/471, 237/240 — is the same three
netIds at an earlier, smaller corpus size.)

Every failing body, grouped by mask and framed bit length:

| mask | bits | what it carries | count |
|---|---|---|---|
| `0x39fd` | 285 | pos, rot, aimB, aimA, lower, upper, hp, held, stateBits, bytes, kitPart | 14 |
| `0x00d5` | 194 | pos, rot, aimA, upper, hp | 1 |
| `0x01e0` |  74 | lower, upper, hp, held | 1 |

All three carry `0x80`. Two examples:

```
0x39fd 285 bits  fd399c424c8948dbb28506802789fcffe595fcfffdfffdff7d273c00007e000000000008
0x00d5 194 bits  d50002761b8900337f85f8752989fcff198dfcff0d1979e702
0x01e0  74 bits  e001e94c07fcffffff03
```

The mask is not the problem — the *width* of one field is. With the field map
unchanged, `mask 0x39fd` sums to

```
14 mask + 1 flag + 98 pos + 49 rot + 16 aimB + 16 aimA + 11 lower + 11 upper
  + 16 bytes + HP + 32 held + 15 stateBits + 1 kitPart = 280 + HP
```

against 285 framed bits, i.e. the old `HP = 7` over-read the body by 2. The
smaller two pin it independently:

- `0x00d5` = `14+1 + 98 pos + 49 rot + 16 aimA + 11 upper + HP` = `189 + HP` = 194  ->  **5**
- `0x01e0` = `14+1 + 11 lower + 11 upper + HP + 32 held` = `69 + HP` = 74  ->  **5**

So the hit-point field is **5 bits**, not 7, and the read of a body carrying
`hp` no longer runs past the end. Nothing else changed: every other netId's
strict/under/over/threw row is identical before and after (`diff` of the two
verifier runs shows only 589/597/605 and the totals).

## 2. Hit points: the Armor's **max** hit points, 30 for a vanilla soldier

`setNetUpdate` reads the field after the `0x1000` two bytes and before `0x100`:

```
mov    0x3c(%ebx),%eax        ; eax = this->[0xf]    = the BFSoldier
mov    (%eax),%edx            ;       its vtable
push   $0xc4a4
push   $0xc4a4
push   %eax
call   *0x28(%edx)            ; getComponent(0xc4a4, 0xc4a4) -> the Armor
mov    %eax,%edi
...
mov    (%edi),%eax
push   %edi
call   *0x14(%eax)            ; Armor vt+0x14
```

`0xc4a4` is `IID_IArmor` (`Armor::queryInterface` `0x08173ee0` answers it with
`this`; the same pair appears all over the damage path, ledger HP-7 / HP-21 /
SEAT-28). Slot `+0x14` of the Armor vtable `0x0871d228` is `Armor::getMaxHitPoints`
— the slot order read off the table is `+0x10 setMaxHitPoints 0x08173680`,
`+0x14 getMaxHitPoints 0x08173f20`, `+0x18 setHitPoints 0x081726c0`,
`+0x1c getHitPoints 0x08173f30`, `+0x20 damage`, `+0x24 heal`. The result is
rounded to an integer and passed as the **max** argument of
`BitStream::readUnsigned(0, max)` (the min argument is a literal 0):

```
call   *0x14(%eax)            ; getMaxHitPoints()  -> st(0)
fistpll -0x180(%ebp)          ; round to int
push   %eax                   ; max
push   $0x0                   ; min
mov    0xc(%ebp),%eax
push   %eax                   ; the BitStream
call   BitStream::readUnsigned(uint, uint)      ; 0x083da040
```

So the field is `readUnsigned(0, round(maxHitPoints))`, not the *current* hit
points — the current value is what the `hp` field then carries.

A vanilla soldier's template sets both words to 30
(`Objects/Soldiers/Common/CommonSoldierData.inc`, extracted at
`/home/dylan/bf1942-extracted/objects/...`):

```
ObjectTemplate.HasArmor 1
ObjectTemplate.HitPoints 30
ObjectTemplate.MaxHitPoints 30
```

`SimpleObjectTemplate::setArmorComponent` (`0x081ddae0`) pushes the template word
`+0x84` (max) through `setMaxHitPoints` and then `+0x80` (hitPoints) through
`setHitPoints` (ledger HP-17/HP-1); `setMaxHitPoints` ceilings at 128,
`setHitPoints` raises the max to the spawned value. For a soldier both words are
30, so the Armor's max is 30 and the question's `126` was simply a wrong read:
`0xd5`'s "126" is its nonsense 7-bit value.

`rangedBits(0, 30) = 5`, which is what the corpus arithmetic demands. Decoded,
the field now reads what the round did:

| netId 605, `dt` | hp |
|---|---|
| spawn, all cases | **30** |
| 164.7 s | 23 |
| 167.8 s | 0 |

`VANILLA_SOLDIER_HP` in the decoder is 30 (was 100), so the width is 5 by
default; `opts.maxHp` still overrides it for a mod's template.

## 3. Aim limits: template `+0x184`/`+0x188` (twist) and `+0x18c`/`+0x190` (pitch), in degrees

`setNetUpdate` and `getNetUpdate` compute the two aim limits the same way, from
four floats on the soldier template (`template = *(BFSoldier + 0x4c)`):

```
twist   = max( |tmpl + 0x184|, |tmpl + 0x188| )     ; mask 0x8  -> record+0x6c
pitch   = max( |tmpl + 0x18c|, |tmpl + 0x190| )     ; mask 0x10 -> record+0x68
```

and pass them to the 16-bit signed read, whose two-argument form is a scale:

```
083da200  BitStream::readSignedFloat(int bits, float scale):
   call readSignedFloat(bits)        ; 0x083da280 = 2 * readUnsignedFloat(bits) - 1
   fmuls 0x10(%ebp)                  ; * scale
```

So the decoded aim is `readSignedFloat(16) * limit`, i.e. **degrees**, bounded by
the template's own limits. That is what bf42plus records and what the replayer's
`st` rows carry: `BFSoldier::handleUpdate` builds `setRotateYDeg(-3.0 x +0x288)`
beside `setRotateXDeg(-2.5 x +0x284)` — the same 3.0/2.5 gains
`replay-recording.js` applies to the recorded `twist`/`pitch` as degrees.

**Which record slot is which** is settled by the consumer. `setNetUpdate` writes
record `+0x68` (mask `0x10`) into `BFSoldier+0x284` and record `+0x6c` (mask
`0x8`) into `BFSoldier+0x288`. `BFSoldier::handlePlayerInput` (`0x08273c70`)
loads `+0x18c` then `+0x190` off the template and immediately clamps
`BFSoldier+0x284` against them:

```
82744f2  mov -0x274(%ebp),%eax        ; eax = template
82744ff  flds 0x18c(%eax)             ; limit a
827450b  flds 0x190(%eax)             ; limit b
8274537  fsubrs 0x284(%eax)           ; ... BFSoldier + 0x284  (the aim pitch)
827453d  fsts  0x284(%eax)
827454b  fucomp                        ; against limit a
```

so **`+0x18c`/`+0x190` are the pitch pair**, and `+0x184`/`+0x188` (loaded at the
top of the same function into the yaw/turn-rate path) are the torso-twist pair.
The property names and values are in the same file:

```
ObjectTemplate.setTurnLeftRightAngle 20.0 14.0
ObjectTemplate.setPointUpDownAngle 38.0 38.0
ObjectTemplate.setLiePointUpDownAngle 0.0 -6.0
```

i.e. the turn-left/right pair (+0x184/+0x188) is 20/14 and the point-up/down pair
(+0x18c/+0x190) is 38/38. The engine takes the max of each, so

- **twist limit = 20 degrees**
- **pitch limit = 38 degrees**

There is no named accessor to read the offsets straight off (`nm -C` has no
`setTurnLeftRightAngle`, `setPointUpDownAngle` or `getPointUpDownAngle`); the
three strings occur only in the generic console registration inside
`__static_initialization_and_destruction_0` (`0x082b2029` lie, `0x082b2135`
point, `0x082b2244` turn), which registers type descriptors and no offset. The
offset↔property pairing above is therefore by the clamp's own use (pitch vs yaw)
plus the pair values, not by a setter symbol.

**Corroboration from the data.** Decoding the corpus with the limits applied:

- netId 589 twist spans **-14.00 .. +20.00** — the exact `20.0 14.0` bounds;
- netId 605 twist spans -2.68 .. +20.00; netId 597 reaches +20.00;
- the independent bf42plus recording of a Wake coop round
  (`~/bf1942-lab/runs/20261015-173425-capture-wake/client/replay_20261015-193355.ndjson`)
  records `st` twist exactly -14.0 .. +20.0 over 290 rows. Same asymmetric band,
  which is the `setTurnLeftRightAngle 20.0 14.0` clamp.

The decoded pitch in the corpus reaches only 15.03 degrees and the bf42plus
recording's only 6.6, so the **38** rests on the property value plus the clamp
address above, not on the lab data hitting the bound. The twist's 20, by
contrast, is hit exactly.

Decoder defaults: `VANILLA_AIM_PITCH_DEG = 38`, `VANILLA_AIM_TWIST_DEG = 20`;
`opts.aimPitchLimit` / `opts.aimTwistLimit` override them for another mod's
soldier template. `aimA` (pitch) and `aimB` (twist) come back in **degrees**,
which is a behaviour change from the earlier normalised `[-1, 1]`, and is what
`SoldierStateTracker`'s `pitch`/`twist` columns now mean.

## 4. Verified

```
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/soldier-ghost.mjs decodeSoldierBody \
     run.review.ndjson --names run.ndjson
```

`589(USMarineSoldier)`, `597(JapaneseSoldier)` and `605(JapaneseSoldier)` are
claimed clean on every record; every other netId is byte-for-byte the same row
as before the change. `enrich.mjs`, `session.mjs`, `sidecar.mjs` and
`replay-recording.js` keep the same API (`decodeSoldierBody`,
`decodeSoldierTransform`, `decodeSoldierPosition`, `SoldierStateTracker`).

## 5. Open

- **The individual pair members.** Which of `+0x184`/`+0x188` is the left and
  which the right turn angle (20 vs 14), and likewise nothing distinguishes
  `+0x18c` from `+0x190` (both 38). The engine only ever takes `max`, so the
  decode is right either way, but the two floats were not read apart.
- **`setLiePointUpDownAngle 0.0 -6.0`** registers a third pair by the same
  pattern; its template offsets were not chased (it is the prone pitch range,
  not read by `setNetUpdate`).
- **Per-mod limits and hit points.** 30 and 38/20 are vanilla
  `CommonSoldierData.inc`; a mod that overrides `HitPoints`, `MaxHitPoints`,
  `setTurnLeftRightAngle` or `setPointUpDownAngle` needs the matching
  `opts.maxHp` / `opts.aimPitchLimit` / `opts.aimTwistLimit`. Nothing in the
  names file carries them yet.
- **`stateBits` (`0x800`) and `bytes` (`0x1000`).** Read at 15 and 16 bits
  respectively, both consumed correctly, but their individual bit meanings are
  not mapped here beyond `0x10` chute / `0x20` zoom from wire.md §13 (a
  `stateBits` of `0x4000` was observed on a chute-less body).
- **Velocity and the two `0x200`/`0x400` vectors** are still consumed and
  discarded; `0x200`/`0x400` never appeared in the soldier corpus, so their
  reference vector for a delta mode is unverified.
- **The `0x1000` two bytes** are `soldier+0x58c`/`+0x58d` (the `readBits(16)`
  target and the byte beside it); neither is decoded into a named value.
