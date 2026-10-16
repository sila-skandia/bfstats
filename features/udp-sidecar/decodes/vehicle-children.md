# Vehicle child networkable lists: the per-template tail of a composite ghost

The vehicle ghost body is a whole descriptor: the hull's
`SimpleObjectNetworkable` body followed by the bodies of every child
networkable in the object's template tree, concatenated and sharing one bit
budget. This file fixes the ordered child list per template and the per-class
sub-readers needed to consume it, and records the strict score each template
reaches.

Read-only inputs: the corpus `tools/bf1942-models/run.review.ndjson`
(one framed `action:1` record per line), the netId -> template map in
`tools/bf1942-models/run.ndjson`, the template graph under
`/home/dylan/bf1942-extracted/objects/Objects/` (the same data as the lab's
`archives/objects.rfa`), and `bf1942_lnxded.static`.

**2026-10-16: every vanilla vehicle is derived (section 6).** The tree walk
of section 1 is only half the rule: `NetworkManager::analyseObject`
(`0x0842d620`) then folds the walk's list into groups by
`compareProperties` (`0x0842d3e0`) and sends one networkable per group.
That settles section 4's open items 1 and 2 (Defgun, AA_Allies, the wing
counts) and the 582-bit Corsair bodies (its `O` child has no armour, so no
hit-point bits). `sidecar/ghost/derive-children.mjs` applies the whole rule to
the template graph and writes `derived-specs.json`, which `children.mjs`
falls back to for any template its hand specs do not name. The section 2
widths that were fitted (Daihatsu's gear field, every FireArms `wB`) were
wrong and are corrected in section 6.

Snapshot. `run.review.ndjson` is being appended to by a live sidecar. All
numbers below are from the snapshot taken while writing this file:
**86,951 lines**, 86,872 framed `action:1` records.

---

## 1. The mechanism (from the binary)

`NetworkManager::_analyseObject` (`0x0842d2f0`), decompiled whole, is:

```c
void _analyseObject(IObject* obj, vector<OBJECTINFO>& out) {
  if (*(u32*)(obj + 0x68) != 0)                    // obj has a networkable
     out.push_back({ netIdOf(*(obj+0x4c)), obj }); // (key, object)
  child = obj->getChild();                          // vtable +0x7c
  while (child) {
    if (child->queryInterface(0xc4c5) == 0)         // NOT a PlayerControlObject
       _analyseObject(child, out);
    child = child->sibling;                         // object +0x54
  }
}
```

So the list is **depth-first, pre-order, in `addTemplate` order**; every object
whose networkable component is set is pushed; a `PlayerControlObject` child is
skipped entirely (its own `PlayerControlObjectNetworkable` reader
`0x08232350` is an empty `ret`, so it would contribute zero bits anyway).

Which classes instantiate a networkable is fixed by each class's
`initNetworkableComp` (the gcc vtable slot `+0xcc`, read with
`features/bf1942-engine-reference/lnxded/vt.py`). `setNetworkableComp`
(`0x081d70d0`) then gates on the template's `networkableInfo` being non-empty
**and** registered with the `networkableInfoManager`. The resulting alphabet:

| letter | networkable class | object classes that use it |
|---|---|---|
| `E` | `EngineNetworkable` | `Engine` |
| `S` | `SpringNetworkable` | `Spring` |
| `R` | `RotationalBundleNetworkable` | `RotationalBundle`, and en masse `Camera`, `FloatingBundle`, `LandingGear`, `Wing` (all inherit `RotationalBundle::initNetworkableComp 0x081d85e0`) |
| `O` | `SimpleObjectNetworkable` | `SimpleObject` + `Bundle`, `EntryPoint`, `SeatObject`, `AnimatedBundle`, `SupplyDepot`, `SpawnPoint`, `ObjectSpawner`, `FireArmsBundle`, `SonarObject`, `Emitter`, `EffectBundle` (all inherit `SimpleObject::initNetworkableComp 0x081daaf0`) |
| `F` | `FireArmsNetworkable` | `FireArms` |
| `I/K/C/P/B/D/X` | `Item`/`Kit`/`ControlPoint`/`Projectile`/`Objective`/`BFSoldier`/`FreeCamera` | those classes |
| — | none | `LodObject` (no `initNetworkableComp` slot) |

Two object classes show up in vehicle trees that a `{E,S,R}` alphabet misses
entirely: `Wing` in `Objects/Vehicles/Air/*/Physics.con` (a RotationalBundle
descendant -> `R`) and the vehicle weapons (`Sherman/Weapons.con`,
`.../Coaxial_Browning/Objects.con`, ...) — `FireArms` -> `F`. The Corsair also
has a `Bundle` (`CorsairComplex`) carrying a `networkableInfo`, i.e. a
`SimpleObjectNetworkable` child -> `O`. So the true alphabet is
`{E, S, R, F, O}`, not the `{E, S, R}` the earlier best-fit searches used —
which is why those searches stopped short.

The M3A1 is the anchor and reproduces exactly: its tree,
`Objects/Vehicles/Land/m3a1/Objects.con`, is root `M3A1` (PCO) ->
`lodM3A1` -> `M3A1Complex` -> (two `M3A1Wheel1`, each carrying a `Spring`
`M3A1Spring1`) then `M3A1Engine` -> `m3a1TrackL` (four more `Spring` wheels) =
**`S S E S S S S`** — the only words that give the M3A1's two body lengths
(`59 = 11 + 42 + 6x1`, `108 = 11 + 49 + 48`).

## 2. The per-template child list

Derived by walking the template graph with the rule above and then confirming
each sequence against the corpus. The letters are the tail **after the hull**.

| template | netId(s) | child sequence | source of the shape |
|---|---|---|---|
| `M3A1` | 544 | `S S E S S S S` | `Land/m3a1/Objects.con` + `Physics.con`; the anchor |
| `Daihatsu` | 577 | `E R R` | `Sea/Daihatsu/Objects.con` (engine + `DaihatsuLanding1`->`Landing2`, two `Wing`s) |
| `Sherman` | 550, 560 | `E S S S S R R F F` | `Land/Sherman/Objects.con` + `Physics.con` + `Weapons.con`: engine -> four `Spring` wheels, turret -> gun base -> main gun `F` + coaxial `F` |
| `Zero` | 562 | `E R R R R R R F F` | `Air/Zero/Objects.con` + `Physics.con` + `Weapons.con`: engine, flaps/rudder (`Wing`), guns (`ZeroGuns`, `ZeroBombDummy`) |
| `Corsair` | 531 | `O E R R R R R F F` | `Air/Corsair/Objects.con`: `CorsairComplex` is a `Bundle` with `Corsair_body_info` -> `O`; engine; flaps/rudder; guns |
| `Chi-ha` | 620 | `R R F F E S S S S` | `Land/Chi-ha/Objects.con` + `Physics.con` + `Weapons.con`: tower -> gun base -> main + coaxial `F`; engine -> four `Spring` wheels |
| `Defgun` | 520-525 | `R R F R R F` (**unresolved**) | `.con` tree order; does not decode — see §4 |
| `AA_Allies` | 526, 527, 543, 553 | `R R F R` (**unresolved**) | `.con` tree order; does not decode — see §4 |

The child letters are a template property and are **not on the wire**. They live
in `tools/bf1942-models/sidecar/ghost/children.mjs`
(`CHILDREN_BY_TEMPLATE` / `TEMPLATE_SPECS`, plus `childrenFor(name)` which fell
back to the M3A1 spec for an unknown template until 2026-10-16; it now falls
back to `derived-specs.json`, section 6). `pco.mjs` consumes them.

### Per-template reader parameters that are not on the wire

Two widths inside a child body depend on the *template*, so the sequence alone
is not enough:

- **Engine gear field.** `EngineNetworkable::setNetUpdate 0x08227da0` reads
  `readUnsigned(0, EngineTemplate::getNumberOfGears())`, whose width is
  `rangedBits(0, gears)`. `Sherman` and `Chi-ha` set
  `ObjectTemplate.setNumberOfGears 5` (3 bits); the others do not, and the
  width was fitted: `M3A1` 3, `Daihatsu` 4, `Zero` 2, `Corsair` 2. The value is
  never used, only the width.
- **FireArms magazines.** `FireArmsNetworkable::setNetUpdate 0x08228f70` reads
  a 2-bit mask, then for bit 0 `readUnsigned(0, tmpl+0x228 + 1)` and for bit 1
  `readUnsigned(0, tmpl+0x234 + 1)`. The first bound is the gun's
  `ObjectTemplate.magSize`, so
  `wA = rangedBits(0, magSize + 1)`: `ShermanGunBarrel` 30 -> 6,
  `Coaxial_browning` 400 -> 9, `ZeroGuns` 900 -> 10, `ZeroBombDummy` 15 -> 5,
  `DefgunGunBarrel` 499 -> 9. The second bound (`tmpl+0x234`) is not a property
  I found in the `.con`; its width was fitted per child and is stored in
  `children.mjs`. Only a handful of records set either bit.
- **Hull hit points.** The `0x10` hull bit reads
  `readUnsigned(rangedBits(0, round(maxHp)))`. Almost every vehicle is
  `maxhitpoints 100` -> 7 bits; `Defgun` sets `maxhitpoints 50` -> 6.

## 3. Strict score per template, before and after

"Before" = the `{E,S,R}` best-fit sequences previously in `CHILDREN_BY_TEMPLATE`
(the numbers in `player-control-object.md`); "after" = this file. Strict =
`consumed == bodyBits` on every record of the netId, no swallowed underflow
(`verify.mjs`'s rule).

| template | before | after |
|---|---|---|
| `M3A1` (544) | 100% | **100%** |
| `Daihatsu` (577) | 1057/1058 | **1058/1058 (100%)** |
| `Sherman` (550, 560) | 700/781 + 67/68 | **849/849 (100%)** |
| `Zero` (562) | 668/688 | **688/688 (100%)** |
| `Corsair` (531) | 22/56 | **54/56 (96.4%)** |
| `Chi-ha` (620) | 1/1 (single fit) | **1/1 (100%)** |
| `Defgun` (520-525) | not claimed | 0/4 (unresolved) |
| `AA_Allies` (526,527,543,553) | not claimed | 0/4 (unresolved) |

`verify.mjs` on `pco.mjs / decodePcoBody` (which auto-detects the template when
none is named, so the per-netId table reflects each vehicle's own sequence):
`strict 76818 / 86872`, and the vehicles all read 100% in the netId table
except Corsair (54/56) and the two fixed guns. The non-vehicle netIds (soldiers,
control points, kits, projectiles) throw, as they should — they are not
composites and `pco.mjs` is only for vehicles.

## 4. Open

1. **`Defgun` and `AA_Allies` cannot be pinned from this capture.** Each has
   exactly one record per instance (4 instances each, all at 265 / 297 bits,
   hull mask `0x493`). With so few, highly-correlated bodies nothing is forced:
   an exhaustive search finds **118 different sequences** that decode all four
   `AA_Allies` records exactly and several that decode all four `Defgun`
   records. The `.con` tree order (`R R F R R F` for Defgun: root ->
   `lodDefgun` -> `DefgunOrginal` -> `DefgunTurret` -> `DefgunGunBase` ->
   `DefgunGunBarrel`, then the root's own `DefgunTurret`; `R R F R` for
   AA_Allies) does **not** decode either body, which says the descriptor's
   networkable list is not simply the `.con` tree here — but which element is
   missing, and why, needs a second capture with more than one record per gun.
   The `lowConfidence` flag on those entries in `children.mjs` records this.
2. **The wing count.** The `.con` gives Corsair 7 `Wing`s with
   `Corsair_wing_info` and Zero 7 with `Zero_wing_info`, but the corpus needs
   only **5** `R`s after the engine for Corsair and **6** for Zero (the floor
   bodies force this: a Corsair 274-bit body is `158 hull + 11 O + 66 E + 39
   tail`, and `39 = 5x7 + 2x2`). So two of the Corsair wings and one of the
   Zero's produce no networkable, and it is not simply "the last one" in either
   case. All seven of each carry an identical registered `networkableInfo`, so
   the gate in `setNetworkableComp` does not obviously distinguish them. Open.
3. **The Corsair's two 582-bit records.** 54 of 56 Corsair records decode
   exactly; the two exceptions are 582 bits — far outside the 274-338 mode —
   and carry a mask-`0x493` `O` body as well as a mask-`0x493` hull. They do not
   decode under any `{E,R,F,O}` tail up to 12 children. They look like a
   different (or mis-framed) object state; not chased.
4. **Several rare single records remain single-record fits.** The Chi-ha's
   only body (405 bits, mask `0x493`) decodes exactly, but as a 1-record
   template that is a weak claim; it is kept because its sequence is the `.con`
   tree order and it lands on the last bit.

## 5. Reproducing

```bash
cd tools/bf1942-models
node sidecar/ghost/verify.mjs sidecar/ghost/pco.mjs decodePcoBody \
     run.review.ndjson --names run.ndjson
```

`verify.mjs` calls the decoder without a template name, so `pco.mjs`
auto-detects: it tries each known template's sequence and uses the first that
consumes exactly `bodyBits`, falling back to the default (M3A1) and letting its
underflow propagate when none does. To score a single template without
auto-detection, bind it at the call site:
`decodePcoBody(hex, bits, { template: 'Sherman', strict: true })`.

The template graph reads used here: `/home/dylan/bf1942-extracted/objects/`
(`Objects/Vehicles/<type>/{Objects,Physics,Weapons}.con`), with the class ids
and readers from `features/udp-sidecar/decodes/class-map.md` and the
`initNetworkableComp` slots from
`features/bf1942-engine-reference/lnxded/vt.py <Class>`.

---

## 6. The derivation (2026-10-16)

### 6.1 The missing half of the rule: networkables are grouped

`NetworkManager::analyseObject` `0x0842d620` calls `_analyseObject` for the
section 1 list, then walks it in order and sorts it into groups: each object
joins the first existing group whose first member it matches under
`NetworkManager::compareProperties` `0x0842d3e0`, or starts a new group. The
descriptor carries one networkable per group, in order of the groups' first
members. Two exceptions, both in the same loop:

- an object whose `NetworkableInfo` answers `getIsUnique` (vt `+0x30`) true
  always starts a group of its own. In vanilla only `SpringInfo` sets
  `NetworkableInfo.setIsUnique 1` (`Objects/Vehicles/Common/Network.con`),
  which is why the M3A1's two `M3A1Spring1` instances stay two `S`;
- an object whose info answers `getForceNetworkableId` (vt `+0x38`) and is not
  the root is left out (vanilla: `HandFireArmsInfo`), as is a parented
  `CID_ProjectileTemplate` (`0x9495`). Neither occurs in a vehicle tree.

`compareProperties(a, b)` (decompiled whole) is true when `a` and `b` have the
same template, or when their keys match (the key `_analyseObject` pushes is
the template's class id, template vt `+0xc`), the template answers IID
`0x947d` (`RotationalBundleTemplate`: RotationalBundle, Engine, Wing, Camera,
LandingGear, FloatingBundle) and these are all equal: `automaticReset`
(`+0x1a4`), `inputToYaw` / `inputToPitch` / `inputToRoll`, `maxRotation`
(`+0x15c..`), `minRotation` (`+0x150..`), `maxSpeed` (`+0x174..`) and
`acceleration` (`+0x180..`), compared as floats. Geometry, placement,
`setPositionOffset`, the lift values and `setRegulateToLift` are not compared.

So a mirror pair of control surfaces that differs only in geometry and offset
is **one** `R` on the wire:

| template | Wings with an info | groups | the pairs folded |
|---|---|---|---|
| `Corsair` | 7 | **5** | `FlapLeftMiddle=FlapRightMiddle`, `FlapTailLeft=FlapTailRight` |
| `Zero` | 7 | **6** | `FlapLeftInner=FlapRightInner`; the elevators stay two because `ZeroFlapTailRight` has `setMaxSpeed 0/0/0` |
| `AichiVal` | 7 | **6** | `Flaps1=Flaps2`; `RudderRR` has `maxSpeed 0/0/0` |
| `SBD` | 8 | **5** | `FlapR=FlapL`, `RudderFR=RudderFL`, `RudderRL=RudderRR` |
| `Spitfire` | 7 | **5** | `AirbreakLeft=AirbreakRight`, `RudderBackLeft=RudderBackRight` |
| `Willy` | front wheels | `E R S S S S R` | `WillyFrontWheelR=WillyFrontWheelL` |

The angles confirm which bundle is which: decoded with the derived Corsair
spec, `R1` is never set (the regulator pair), `R2` and `R3` swing +-30 (the
ailerons), `R4` -10..20 (the elevator pair) and `R5` +-15 (the rudder), the
`.con` limits of exactly those surfaces. The Zero reads elevator, elevator,
rudder, a never-set regulator, aileron, aileron.

### 6.2 The widths

| field | rule | source |
|---|---|---|
| engine gear | `rangedBits(0, n)`, `n = clamp(setNumberOfGears, 1, 5)`, default **1** | `EngineNetworkable::setNetUpdate` `0x08227da0` reads `readUnsigned(0, getNumberOfGears())`; `setNumberOfGears` `0x0823fd10` clamps to [1, 5]; the ctor `0x0823efc0` writes `+0x360 = 1`. So 2 bits unless the engine sets 3..5 gears (3 bits) |
| FireArms magazine A | `rangedBits(0, magSize + 1)` | `FireArmsNetworkable::getNetUpdate` `0x08228e50`, bound `tmpl+0x228 + 1` |
| FireArms magazine B | `rangedBits(0, numOfMag + 1)` | the same, bound `tmpl+0x234 + 1`; `FireArmsTemplate::makeScript` `0x0828e3b0` prints `+0x234` as `ObjectTemplate.numOfMag` |
| hull hit points | `rangedBits(0, round(maxHitPoints))` | as section 2 (hulls.json) |
| an `O` child's hit points | its own template's `rangedBits(0, maxHitPoints)` with `hasArmor`, **0 bits** without | fitted: the Corsair's 27 full-state bodies (the two "582-bit" ones of section 4 among them) read to the last bit only with 0 bits for `CorsairComplex`, a `Bundle` with no armour |

The section 2 widths that were fitted are corrected by these. Daihatsu's gear
field is 2 bits, not 4 (78 Wake bodies set the gear bit; 4 bits read none of
them). Every `wB` is 2 bits (`numOfMag 1`): the fitted Sherman `[6, 1], [9, 3]`
summed to the same 12 bits on its 112 full-state bodies and so also "read",
but it reads the coaxial as 291 rounds and 5 magazines, where the rule reads
31 / 2 and 401 / 2, both magazines full (`magSize + 1`, `numOfMag + 1`); the
Zero's `[10, 0], [5, 9]` reads its bomb rack as 323 magazines.

### 6.3 What is built

- `sidecar/ghost/derive-children.mjs` reads every `.con` under the vanilla
  `Objects` tree (`/home/dylan/bf1942-extracted/objects/Objects`; vanilla only,
  the `xpack` trees are out of scope), walks each `hulls.json` template, groups
  as above and writes `sidecar/ghost/derived-specs.json`: per template the
  `children`, the `nodes` behind them (a folded pair as `A=B`), `gearBits`,
  `hpBits`, `mags` / `rof` / `guns` / `muzzles` per `F`
  (`muzzles` = the `addFireArmsPosition` count unless `setAsynchronyFire`),
  `objects` per `O`, the nested `seats` (each PlayerControlObject, DFS order,
  its own grouped descriptor: the gunner seats' `R R F`, a passenger seat
  empty) and `joints` (the `R`s that carry a gun, `[name, yaw|pitch, rest]`,
  emitted only when they are the descriptor's first `R`s, yaw then pitch, as
  `ghost-writer.mjs` pairs them). 54 of the 66 hulls; the other 12
  (`Hiryu`, `Hornet`, `Ju88A`, `Pak40`, the radar towers and factories, `CDNRaft`)
  are expansion-pack templates.
- `children.mjs`: `TEMPLATE_SPECS` keeps the six proven Wake specs (widths
  corrected as 6.2), `Defgun` and `AA_Allies` are dropped (their hand guesses
  read none of their bodies; the derived `R R F` and `R R F R` read all).
  `specFor` / `childrenFor` return the hand spec, else the derived one, else
  null (no more M3A1 fallback; `pco.mjs` auto-detects among the hand specs for
  an unknown template). `SEAT_SPECS` and `JOINT_PARTS` are the derived seats
  and joints with the hand ones over them seat by seat, so `seatSpecFor`
  (`body-decoder.mjs`), `gunFor` / `fireLagFor` and the joint rows
  (`ghost-writer.mjs`) and `control-state.mjs` all see every template.
- `pco.mjs` reads an `O` child with its own `objects[k]` widths and defaults
  the gear width to 2.
- `tests/test_sidecar_derived_children.py` pins the derivation against the
  six hand specs and the six hand gunner seats, that `derived-specs.json` is
  current, the folded pairs, and strict reads of 143 real bodies (130 of 18 hulls, 13 of
  6 seats; `tests/fixtures/sidecar_derived_children.json`, chosen for distinct
  masks, full states first) plus 12 of the driven Willy's control states.

Regenerate after a change to the rule or the tree:

```bash
cd tools/bf1942-models && node sidecar/ghost/derive-children.mjs
```

### 6.4 Scores on live wire bodies

Strict: the decode the sidecar runs (`decodePcoBody` with the template named,
maxHp and mobility from `hulls.json`, the block's reference; seats through
`seatSpecFor`) lands exactly on the last bit. "Before" is `HEAD`
(57bb341a: hand specs, M3A1 fallback); "after" is this change. Each record is
assigned the template its netId carried at that moment (the recording's `k:"o"`
rows, time-ordered: netIds are reused), and a hull's seats are the netIds
after it.

**El Alamein**, `ea2` (2026-10-16, the probe on the Allied side):

| template | before | after |
|---|---|---|
| `Willy` | 318 / 3828 (8.3%) | **3828 / 3828** |
| `Spitfire` | 0 / 13472 | **13472 / 13472** |
| `B17` | 0 / 394 | **394 / 394**; seats +1 `R R F` 2/2, +2 `R F` 2/2 |
| `M10` | 0 / 138 | **138 / 138** |
| `Priest` | 0 / 139 | **139 / 139**; seat +1 3/3 |
| `PanzerIV` | 0 / 108 | **107 / 108**; seat +1 1/1 |
| `AA_Allies` | 0 / 5 | **5 / 5** |
| `Stationary_Browning` | 0 / 6 | **6 / 6** |
| `flak38` | 0 / 4 | **2 / 4** |
| `Sherman` | 39747 / 39747 | 39769 / 39769 |
| `M3A1` | 134 / 134 | 134 / 134 |
| control states of the driven Willy that failed live | 0 / 30 | **30 / 30** |

**Wake**, `h5` (2026-10-16, about three hours):

| template | before | after |
|---|---|---|
| `AichiVal` | 475 / 86375 (0.5%) | **86375 / 86375**; seat +1 114/114 |
| `SBD` | 0 / 12782 | **12782 / 12782**; seat +1 27/27 |
| `Hatsuzuki` | 0 / 604 | **604 / 604**; seats +1..+3 `R R` 28/28 each (0 before) |
| `Defgun` | 0 / 332 | **332 / 332** |
| `AA_Allies` | 207 / 369 | **369 / 369** |
| `Corsair` | 66164 / 66191 | **66191 / 66191** |
| `Daihatsu` | 9332 / 9413 | **9410 / 9413**; seat +1 644/645 |
| `Zero` | 28972 / 28972 | 28972 / 28972 |
| `Sherman` | 107586 / 107726 | 107586 / 107726; seat +1 104/104 |
| `M3A1` | 132722 / 132726 | 132722 / 132726; seat +1 59/60 |

The remaining misses are not spec misses: every one is a body of 7 to 13 bits
(too short for the hull it is filed under) at the moment its netId is
re-created for a new object, i.e. the previous owner's last records; Sherman's
140 are all one reused netId at one re-creation. The 11 Wake control states
that fail are a gunner seat's (`control-state.mjs` has no reader for class
`Seat`), unchanged by this work.

Not yet seen live: the Axis side of El Alamein (`Tiger`, `Hanomag`,
`Kubelwagen`, `Wespe`, `Stuka`, `BF109`), Midway's ships and planes beyond the
Wake set, Kursk's. They are derived by the same rule and their specs are in
`derived-specs.json`; score them when a capture has them.

### 6.5 Open

1. The ledger has no row for the grouping (`analyseObject` /
   `compareProperties`); it belongs in the netcode section with the addresses
   above.
2. `hulls.json`'s `parts` pivots come from `JOINT_PARTS`
   (`build-hulls.mjs`); re-running it would give the derived joints their
   pivots. Until then a derived seat's rounds leave from the hull's origin.
3. A gunner seat's own control state (class `Seat`) has no reader.
