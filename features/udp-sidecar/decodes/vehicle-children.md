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
(`CHILDREN_BY_TEMPLATE` / `TEMPLATE_SPECS`, plus `childrenFor(name)` which falls
back to the M3A1 spec for an unknown template). `pco.mjs` consumes them.

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
