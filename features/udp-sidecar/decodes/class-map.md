# Which networkable class does each captured object instantiate?

The wire never names the class of the object a `createObject` event or a ghost
record belongs to: `CreateObjectEvent::serialize` (`0x0811d360`) writes a 32-bit
**template id** and a 16-bit net id, and nothing else that identifies the class.
The template id is not a hash and not a class — it is a slot in the server's
template list, assigned in load order. This file establishes the whole chain

```
tid  ->  template name  ->  the template's object class (the .con)
     ->  that class's networkable class  ->  that class's setNetUpdate
```

from the game's own data and from `bf1942_lnxded.static` (1.61 Linux dedicated,
sha256 `496672…447cf2`, the same build the lab runs), and then applies it to
every object in `tools/bf1942-models/run.ndjson` / `run.review.ndjson`.

Read-only inputs used: the lab capture (`run.ndjson`, `run.review.ndjson`), the
lab's archive tree `/home/dylan/bf1942-lab/server/mods/bf1942/archives/`, and the
retail client's recording of the same round
(`~/.wine/drive_c/EA Games/Battlefield 1942/replays/replay_20261015-221500.ndjson`).
The lab's `mods/bf1942/archives/objects.rfa` and the client's
`Mods/bf1942/Archives/Objects.rfa` are byte-identical (`sha256 eb8e9422d0270649…`,
1,284,700 bytes).

> Snapshot. `run.review.ndjson` is being appended to by a live sidecar, so its
> record count moves. All numbers below are from the snapshot measured while
> writing this file: 36,217 framed records over 39 net ids in
> `run.review.ndjson`, and 48 net ids in `run.ndjson`. The two files are not the
> same snapshot — seven ids that `run.ndjson` names appear in no record of the
> review export.

Summary: **every named object in the corpus is mapped** (24 templates over 6
object classes: `FreeCamera`, `ControlPoint`, `PlayerControlObject`,
`BFSoldier`, `Kit`, `Projectile`). 21 net ids carry no template id and are not
mapped; they are listed, with what is known about each, in section 6.

---

## 1. The class table in the binary (the link that was missing)

`dice::ref2::world::ObjTemplNetworkModule::getClassList`
(`0x0822c360`) builds a `std::vector<ClassRegInfo>` of `{u32 id, std::string
name, create-fn}` — the object-template networkable classes, registered by name
with the class manager. Decompiled whole (one function, `TMPDIR=/tmp
./lnxded/decompile.sh /tmp/clm 0x0822c360`), the entries are:

| class id | registered name | create fn |
|---|---|---|
| `0xcccce9fb` | `dice.ref2.world.NetworkableInfoManager.Standard` | `NetworkableInfoManager::create` |
| 39000 (`0x9858`) | `dice.ref2.world.Networkable.SimpleObject` | `SimpleObjectNetworkable::create` |
| 39001 (`0x9859`) | `dice.ref2.world.Networkable.RotationalBundle` | `RotationalBundleNetworkable::create` |
| 39002 (`0x985a`) | `dice.ref2.world.Networkable.FreeCamera` | `FreeCameraNetworkable::create` |
| 39003 (`0x985b`) | `dice.ref2.world.Networkable.BFSoldier` | `BFSoldierNetworkable::create` |
| 39004 (`0x985c`) | `dice.ref2.world.Networkable.Spring` | `SpringNetworkable::create` |
| 39005 (`0x985d`) | `dice.ref2.world.Networkable.Item` | `ItemNetworkable::create` |
| 39006 (`0x985e`) | `dice.ref2.world.Networkable.Kit` | `KitNetworkable::create` |
| 39007 (`0x985f`) | `dice.ref2.world.Networkable.PlayerControlObject` | `PlayerControlObjectNetworkable::create` |
| 39008 (`0x9860`) | `dice.ref2.world.Networkable.Projectile` | `ProjectileNetworkable::create` |
| 39009 (`0x9861`) | `dice.ref2.world.Networkable.FireArms` | `FireArmsNetworkable::create` |
| 39010 (`0x9862`) | `dice.ref2.world.Networkable.ControlPoint` | `ControlPointNetworkable::create` |
| 39011 (`0x9863`) | `dice.ref2.world.Networkable.Engine` | `EngineNetworkable::create` |
| 39012 (`0x9864`) | `dice.ref2.world.Networkable.Objective` | `ObjectiveNetworkable::create` |

The name strings are contiguous in `.rodata` at `0x086ce920`… (`SimpleObject` at
`0x086ce920`, `RotationalBundle` at `0x086ce960`, …), and the ids in the same
order at `0x086ce7e4`… (39000 at `0x086ce7e4` … 39012 at `0x086ce814`). Those
thirteen names are **all** of them: `strings -a bf1942_lnxded.static | grep -E
'dice\.ref2\.[A-Za-z.]*\.(Networkable|GhostNetworkable)\.'` returns exactly those
thirteen, so no object in any mod can instantiate a networkable class outside
this list.

## 2. template name -> networkable class (the link the .con gives)

Every object class has a member `initNetworkableComp()` that passes a hardcoded
class id to `dice::ref2::world::setNetworkableComp(IObject*, u32)` (`0x081d70d0`).
That function reads the template at `object+0x4c`, checks
`template->getNetworkableInfo()` (vptr `+0x54` = `0x0816afa0`, the string at
`ObjectTemplate+0xc`; an empty string means "no networkable") and then
`classManager->createInstance(classID, CID, …)`. So the class id is a constant per
object class:

| object class | `initNetworkableComp` | class id passed | -> networkable class | `setNetUpdate` |
|---|---|---|---|---|
| `SimpleObject` | `0x081daaf0` | 39000 | `SimpleObjectNetworkable` | `0x08236d00` |
| `RotationalBundle` | `0x081d85e0` | 39001 | `RotationalBundleNetworkable` | `0x082347f0` |
| `FreeCamera` | `0x081afc60` | 39002 | `FreeCameraNetworkable` | `0x08229ba0` |
| `BFSoldier` | `0x0827a1c0` | 39003 | `BFSoldierNetworkable` | `0x08224e40` |
| `Spring` | `0x0824f660` | 39004 | `SpringNetworkable` | `0x08239270` |
| `Item` | `0x08295c40` | 39005 | `ItemNetworkable` | `0x0822ad90` |
| `Kit` | `0x08296910` | 39006 | `KitNetworkable` | `0x0822ba10` |
| `PlayerControlObject` | `0x08316ea0` | 39007 | `PlayerControlObjectNetworkable` | `0x08232350` |
| `Projectile` | `0x0831f800` | 39008 | `ProjectileNetworkable` | `0x08232be0` |
| `FireArms` | `0x0828dca0` | 39009 | `FireArmsNetworkable` | `0x08228f70` |
| `ControlPoint` | `0x08284500` | 39010 | `ControlPointNetworkable` | `0x08226de0` |
| `Engine` | `0x0823ebe0` | 39011 | `EngineNetworkable` | `0x08227da0` |
| `Objective` | `0x08311440` | 39012 | `ObjectiveNetworkable` | `0x08231b20` |

(`setNetUpdate` addresses from `nm -C bf1942_lnxded.static | grep
'Networkable::setNetUpdate'`; the reader each of the other decoders in this
directory mirrors.)

`ControlPoint::initNetworkableComp` and `FireArms::initNetworkableComp` also
print `"Failed to create ControlPointNetworkable"` / `"Failed to create
FireArmsNetworkable"` (`0x086d2ba0`, `0x086d3260`) when the call fails, which is
the same constant path.

**`PlayerControlObject` is conditional, and this changes the answer for
vehicles.** `0x08316ea0` is:

```c
void PlayerControlObject::initNetworkableComp() {
    IObjectTemplate* t = *(IObjectTemplate**)(this + 0x4c);
    if (*(u32*)(this + 0x50) == 0) {
        SimpleObject::initNetworkableComp(this);          // -> SimpleObjectNetworkable
    } else if (t != 0 && t->getNetworkableInfo() != "") {
        setNetworkableComp(this, 0x985f);                 // -> PlayerControlObjectNetworkable
    }
}
```

and `PlayerControlObjectNetworkable::setNetUpdate` (`0x08232350`) is an empty
stub — a one-byte `ret` — with `getNetUpdate`
(`0x08232340`) returning 1 and writing nothing. A `PlayerControlObjectNetworkable`
therefore contributes **no body bits at all**. Every vehicle and fixed gun in the
corpus carries a non-zero body (108 bits for M3A1 up to 405 for Chi-ha), so none
of them can be the `PlayerControlObjectNetworkable`: they take the
`SimpleObject::initNetworkableComp` branch and are read by
**`SimpleObjectNetworkable::setNetUpdate` `0x08236d00`**. Section 4 confirms this
against the corpus for M3A1 independently. What `object+0x50` is stays open
(section 7) — it is enough that the bodies rule the PCO networkable out.

## 3. tid -> template name, and the object class of each template

`ObjectTemplateManager::createTemplate(u32 classID, string name)`
(`0x081d5a30`) allocates the template, calls `setId(param_1[8])` and then
`param_1[8]++`, with the counter initialised to 0 in the ctor (`0x081d52c0`,
`param_1[8] = 0`) and the `id -> template` map at `+0x8`; a repeated name is
refused by `strcasecmp` and **does not** bump the counter. `ObjectTemplate.create
<Class> <Name>` reaches it through `createTemplate(string className, string
name)` (`0x081d5ea0`), whose body is two vtable calls —
`getClassIDFromTemplateClassName` (`0x081d63e0`, at vptr `+0x18`) and then
`createTemplate(uint, string)` (`0x081d5a30`, at vptr `+0x48`) — so the class
name in the `.con` is resolved to a class id and the template is created under
it. The tid is therefore the ordinal of the
`ObjectTemplate.create` statement in the server's load order, and the object
class is the first token of that statement, read straight out of the `.con`.

For this corpus the tid -> name map does not have to be derived: the retail
client's own bf42plus recording of the same round names each template, and the
sidecar carries that map (`tools/bf1942-models/sidecar/templates/wake.json`,
built by `build-names.mjs`; the same map falls out of `replay_20261015-221500.ndjson`
`k:"o"` lines). The recording and the capture agree on every template observed:
`3601 The_Airfield`, `3602 The_Beach`, `3603 ALLIES_southbase`, `3604
ALLIES_north_base`, `3605 ALLIES_north_village`, `3318 Hatsuzuki`, `3135
Daihatsu`, `2916 Sherman`, `2790 M3A1`, `2511 Defgun`, `2476 Chi-ha`, `2430
AA_Allies`, `2383 Zero`, `2073 Corsair`, `1941 AichiVal`, `2236 SBD`, `3427
Shokaku`, `1754 USMarineSoldier`, `1732 JapaneseSoldier`, `1571
MultiPlayerFreeCamera`, `1531 USMarine_Medic`, `1488 Jap_Assault`, `1293
GrenadeAxisProjectile`, `1288 GrenadeAlliesProjectile`.

Section 5 shows how to reproduce that map without a recording.

## 4. The observed objects

One row per net id that produced a `createObject` (or `projPool`) event. `-` in
the last two columns means the id has no `ghost-record` line in the review
export. Body stats are `run.review.ndjson`, `action:1` records only. `[PCO]`
marks the rows where the object class is `PlayerControlObject` and the class
that ends up reading the body is `SimpleObjectNetworkable` rather than
`PlayerControlObjectNetworkable` — see section 2.

| netId | tid | template | object class | networkable class | `setNetUpdate` | records | bits avg (min–max) |
|---|---|---|---|---|---|---|---|
| 2 | 1571 | `MultiPlayerFreeCamera` | FreeCamera | FreeCameraNetworkable | `0x08229ba0` | 1 | 0.0 (0–0) |
| 4, 510, 512 | 1571 | `MultiPlayerFreeCamera` | FreeCamera | FreeCameraNetworkable | `0x08229ba0` | - | - |
| 515 | 3602 | `The_Beach` | ControlPoint | ControlPointNetworkable | `0x08226de0` | - | - |
| 516 | 3601 | `The_Airfield` | ControlPoint | ControlPointNetworkable | `0x08226de0` | - | - |
| 517 | 3603 | `ALLIES_southbase` | ControlPoint | ControlPointNetworkable | `0x08226de0` | 1 | 7.0 (7–7) |
| 518 | 3604 | `ALLIES_north_base` | ControlPoint | ControlPointNetworkable | `0x08226de0` | 1 | 7.0 (7–7) |
| 519 | 3605 | `ALLIES_north_village` | ControlPoint | ControlPointNetworkable | `0x08226de0` | 3 | 7.0 (7–7) |
| 520 | 2511 | `Defgun` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 265.0 (265–265) |
| 521 | 2511 | `Defgun` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 265.0 (265–265) |
| 522 | 2511 | `Defgun` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 265.0 (265–265) |
| 523, 524 | 2511 | `Defgun` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 525 | 2511 | `Defgun` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 265.0 (265–265) |
| 526 | 2430 | `AA_Allies` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 297.0 (297–297) |
| 527 | 2430 | `AA_Allies` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 297.0 (297–297) |
| 528, 552 | 2430 | `AA_Allies` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 529 | 2236 | `SBD` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 531 | 2073 | `Corsair` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 56 | 337.9 (274–582) |
| 532, 554, 606 | 2790 | `M3A1` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 534 | 3427 | `Shokaku` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 539 | 3318 | `Hatsuzuki` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 543 | 2430 | `AA_Allies` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 297.0 (297–297) |
| 544 | 2790 | `M3A1` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 29002 | 108.1 (59–306) |
| 550 | 2916 | `Sherman` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 68 | 157.3 (87–405) |
| 553 | 2430 | `AA_Allies` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 297.0 (297–297) |
| 560 | 2916 | `Sherman` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 781 | 237.4 (75–405) |
| 562 | 2383 | `Zero` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 688 | 275.8 (100–444) |
| 563 | 1941 | `AichiVal` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 565, 571, 583, 613 | 3135 | `Daihatsu` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 577 | 3135 | `Daihatsu` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1058 | 214.5 (67–378) |
| 589 | 1754 | `USMarineSoldier` | BFSoldier | BFSoldierNetworkable | `0x08224e40` | 1854 | 112.8 (26–285) |
| 590, 591, 592 | 1293 | `GrenadeAxisProjectile` | Projectile | ProjectileNetworkable | `0x08232be0` | - | - |
| 593 | 1488 | `Jap_Assault` | Kit | KitNetworkable | `0x0822ba10` | 2 | 114.0 (114–114) |
| 597 | 1754 | `USMarineSoldier` | BFSoldier | BFSoldierNetworkable | `0x08224e40` | 586 | 34.5 (15–285) |
| 598, 599, 600 | 1288 | `GrenadeAlliesProjectile` | Projectile | ProjectileNetworkable | `0x08232be0` | - | - |
| 601 | 1531 | `USMarine_Medic` | Kit | KitNetworkable | `0x0822ba10` | 2 | 114.0 (114–114) |
| 605 | 1732 | `JapaneseSoldier` | BFSoldier | BFSoldierNetworkable | `0x08224e40` | 471 | 116.7 (15–285) |
| 609 | 1488 | `Jap_Assault` | Kit | KitNetworkable | `0x0822ba10` | 2 | 112.0 (110–114) |
| 619 | 2383 | `Zero` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | - | - |
| 620 | 2476 | `Chi-ha` | PlayerControlObject `[PCO]` | SimpleObjectNetworkable | `0x08236d00` | 1 | 405.0 (405–405) |

Evidence for each row, in the order of the chain:

- **tid -> name**: the `createObject` event in `run.ndjson` and the `k:"o"`
  line of `replay_20261015-221500.ndjson` for the same net id / same round,
  agreeing on tid and template.
- **name -> object class**: the `ObjectTemplate.create <Class> <Name>` line in
  the `.con`, read out of the lab's `archives/objects.rfa` (vanilla vehicles,
  soldiers, kits, hand weapons) or `archives/bf1942/levels/wake.rfa` (the five
  Wake control points, declared `ControlPoint` in
  `bf1942/levels/Wake/SinglePlayer/ControlPointTemplates.con`; the capture's
  `setLevel` event says `coop.con`, and `bf1942/levels/Wake/Coop.con` runs
  `SinglePlayer/ControlPointTemplates`. The `Conquest/` and `TDM/` copies of the
  same file declare the same five names as `ControlPoint` too). The
  exact files: `Objects/Vehicles/Land/m3a1/Objects.con` line 1,
  `Objects/Vehicles/Land/Sherman/Objects.con` line 1,
  `Objects/Vehicles/Air/Zero/Objects.con`, `Objects/Vehicles/Air/Corsair/Objects.con`,
  `Objects/Vehicles/Air/SBD/Objects.con`, `Objects/Vehicles/Air/AichiVal/Objects.con`,
  `Objects/Vehicles/Sea/Daihatsu/Objects.con`, `Objects/Vehicles/Sea/Shokaku/Objects.con`,
  `Objects/Vehicles/Sea/Hatsuzuki/Objects.con`, `Objects/Vehicles/Land/Chi-ha/Objects.con`,
  `Objects/Vehicles/Land/Defgun/Objects.con`, `Objects/Vehicles/Land/AA_Allies/Objects.con`,
  `Objects/MOVE_FILES/FreeCamera/Object.con`, `Objects/Soldiers/USMarineSoldier/Objects.con`,
  `Objects/Soldiers/JapaneseSoldier/Objects.con`,
  `Objects/Items/USMarineKit/Medic/Objects.con`, `Objects/Items/JapKit/Assault/Objects.con`,
  `Objects/HandWeapons/GrenadeAxis/Objects.con`, `Objects/HandWeapons/GrenadeAllies/Objects.con`.
- **object class -> networkable class**: section 2's table (the
  `initNetworkableComp` constant) plus section 1's registration table (the
  constant's name). These are two independent reads that agree: the class id
  `0x985b` in `BFSoldier::initNetworkableComp` is registered as
  `dice.ref2.world.Networkable.BFSoldier` with factory
  `BFSoldierNetworkable::create`.
- **networkable class -> `setNetUpdate`**: the symbol table.

### The corpus agrees, where a reader exists

`tools/bf1942-models/sidecar/ghost/` already holds readers for eleven of the
thirteen classes. Run each over every record of every net id
(`verify.mjs`'s own strict rule: consumed == framed bodyBits, no swallowed
underflow). Strict fraction per net id:

| netId | template | class the chain predicts | decoder that consumes it strictly |
|---|---|---|---|
| 517, 518, 519 | `ALLIES_southbase` / `_north_base` / `_north_village` | ControlPoint | `control-point.mjs` — 1/1, 1/1, 3/3 (100%) |
| 589, 597, 605 | soldiers | BFSoldier | `soldier-ghost.mjs` — every record of each (100%) |
| 593, 601, 609 | kits | Kit | `kit.mjs` — 2/2 each (100%) |
| 544 | `M3A1` | SimpleObject (via the PCO branch) | `simple-object.mjs` — 99.8%, the misses being one 405-bit outlier record |
| 545, 551, 578, 621 | (unnamed) | SimpleObject | `simple-object.mjs` — 1/1 each, clean to the last bit (91 bits, mask `0x789`) |
| 561 | (unnamed) | SimpleObject | `simple-object.mjs` — 56/60 (the four misses are 14 bits short) |
| the other vehicles | Corsair, Sherman, Zero, Daihatsu, Chi-ha, Defgun, AA_Allies | SimpleObject (via the PCO branch) | **not yet** — `simple-object.mjs` stops short on every one of their records |

The vehicles that do not decode are the open thread for whoever owns the vehicle
reader, not a hole in the class map: the chain fixes the class, and the class's
body cannot be the `PlayerControlObjectNetworkable` one (it is empty). Measured
shortfalls of `simple-object.mjs` on them, for reference (body bits minus
consumed bits, in bits):

- `577 Daihatsu` (1058 recs): gaps cluster at 8, 24, 40, 56, 72, 162 — i.e.
  multiples of 16 plus two larger values; the 67-bit records read mask `0x000`
  and then leave 56 bits.
- `560 Sherman` (781): 16 (on the 222-bit records, mask `0x3`), and 28–106 elsewhere.
- `562 Zero` (688): 128 on the 139-bit and 237-bit records (mask `0x0` and `0x2`).
- `531 Corsair` (56): 116/132 on the 322–338-bit records, 366 on the 582-bit one.
- `550 Sherman` (68): 28 and 189.
- One record each: `520 Defgun` 49, `526 AA_Allies` 81, `620 Chi-ha` 189 — all
  with mask `0x493`.

A constant gap of 16 or 128 bits on *every* record of a net id is a missing
field, not misalignment: a wrong mask width would make the readings diverge.

## 5. Getting this for another level or mod

The chain is the same four steps; only step 3 is work.

1. **tid -> template name.** Two routes.
   - *From a recording* (cheap, and what this corpus used): have bf42plus record
     a round on the level/mod and read `k:"o"` / `createObject` `tid`+`tmpl`
     pairs; `tools/bf1942-models/sidecar/build-names.mjs` merges them into
     `sidecar/templates/<level>.json`. Two recordings of one level agree.
   - *From the data, no client needed*: reproduce the server's enumeration. Walk
     the mod's `objects.rfa` (and `ai.rfa`, which holds `ObjectTemplate.create
     shermanSpawner`) and then the level's archives, in the archive's own entry
     order, and for every `ObjectTemplate.create <Class> <Name>` assign the next
     id, skipping a name already seen (the engine's check is `strcasecmp`, so
     case-insensitively). This walk reproduces the engine's order exactly on
     this corpus and lands within 0–6 of the observed id on 14 check points
     spanning tids 1488–3318 (e.g. it puts `M3A1` at 2789 where the engine says
     2790, `Sherman` at 2916 where the engine says 2916, `Jap_Assault` at 1482
     where the engine says 1488); the residual is a handful of templates the
     walk and the engine count differently and is not pinned.
2. **template name -> object class**: read `Objects.con` for that template. It is
   always `ObjectTemplate.create <Class> <Name>`. Watch the shared `include`:
   the soldier classes take their properties from
   `Objects/Soldiers/Common/CommonSoldierData.inc` (`ObjectTemplate.networkableInfo
   NetSoldierInfo`), which is why a soldier's own `Objects.con` does not mention
   one.
3. **object class -> networkable class**: section 2's table; the class ids are
   fixed by the binary and do not vary by mod.
4. **networkable class -> reader**: `nm -C bf1942_lnxded.static | grep
   'Networkable::setNetUpdate'`.

Commands that produce sections 1 and 2 of this file:

```bash
cd features/bf1942-engine-reference
TMPDIR=/tmp ./lnxded/decompile.sh /tmp/clm 0x0822c360        # the class table
TMPDIR=/tmp ./lnxded/decompile.sh /tmp/nc 0x081daaf0 0x0827a1c0 0x08316ea0 \
    0x08296910 0x08284500 0x0831f800 0x081d70d0 0x081d5a30
nm -C /home/dylan/projects/public/bf42plus/bf1942_lnxded.static \
    | grep -E 'Networkable::(set|get)NetUpdate'
```

## 6. Net ids that are NOT mapped, and why

These net ids carry no tid: the capture has a `k:"o"` line for them with
`tid: 0` and no template, and no `createObject` event, so there is nothing to
look up. Body statistics are `run.review.ndjson`; "-" means the id has an `o`
line in `run.ndjson` but no ghost record in the review export.

| netId | records | bits avg (min–max) | shape in the corpus |
|---|---|---|---|
| 1 | 61 | 31.4 (26–50) | bytes `00 20 00 0X 0Y`, `0X` counting 10→00 |
| 3 | 1487 | 33.0 (33–33) | same first bytes, `0Y` fixed — a 33-bit body, every record |
| 509 | 659 | 26.5 (26–195) | mostly 26 bits `00 80 00 0X`; one 195-bit record |
| 511 | 23 | 40.4 (33–195) | 33-bit records plus a 195-bit one |
| 513 | 5 | 180.4 (46–550) | one 46-, 130- and 550-bit body |
| 514 | 17 | 67.1 (42–426) | — |
| 545 | 1 | 91 | reads clean as `SimpleObjectNetworkable` (mask `0x789`) |
| 551 | 1 | 91 | same |
| 561 | 60 | 73.4 (25–91) | 56/60 read clean as `SimpleObjectNetworkable` |
| 578 | 1 | 91 | same |
| 621 | 1 | 91 | same |
| 594 | 1 | 11 | — |
| 602 | 1 | 8 | — |
| 610 | 3 | 11 (11–11) | — |
| 533, 595, 596, 24227, 61440, 61600, 65235 | - | - | named in `run.ndjson` with `tid: 0`, no record in the review export |

Why they are not mapped, honestly:

- **No tid.** The sidecar learns an object's template only from the
  `CreateObjectEvent` (or the pool event). These ids never produced one. A
  sidecar that joins after the server's `sendDatabase`, or that missed the event,
  cannot recover the template for an object it only ever sees in the ghost
  stream. That is the general limit behind this whole list, and it is why these
  21 ids rather than a different set: 27 of the corpus's 48 ids do have a
  `createObject`.
- **Five of them are almost certainly child parts of their neighbour**, not
  objects in their own right: `545` sits next to `544 M3A1`, `551` next to `550
  Sherman`, `561` next to `560 Sherman`, `578` next to `577 Daihatsu`, `621`
  next to `620 Chi-ha`. The four 91-bit ones read to the last bit with the
  `SimpleObjectNetworkable` reader (mask `0x789`), which is exactly the body a
  vehicle's moving child would have — `ShermanWheelL1`, `M3A1Wheel1` and friends
  are `SimpleObject` templates in the same `Objects.con`. That is a strong hint
  and it names the class, but it is not a mapping: nobody observed their
  `createObject`, and the tid that would name the exact template is missing.
- **`1` and `3` are not vehicle parts.** They exist from before the first
  `createObject` the sidecar saw, their bodies are short and near-constant, and
  the round's event log has `createPlayer` ×4 and `setTeam` ×3.
  `NetworkManager::addPlayerNetworkable(BFPlayer*)` (`0x0842c310`) exists, so a
  per-player networkable id is a plausible reading — but a player is not one of
  the thirteen classes, so it would not fit the table in section 1, and I did
  not establish it.
- **`24227, 61440, 61600, 65235`** are in `run.ndjson` only, far above the id
  range of everything else in the round (the other ids are 1–621). Nothing in
  `run.review.ndjson` has them, so they cannot even be measured; they look like
  mis-framed records rather than objects, and I did not chase them.

For completeness: the capture's `projPool` event names a `tid` but the sidecar
writes `netId: ev.firstNetId` with a `count`, so the pool's rounds other than the
first have no net id either. No `projPool` line in this round resolved to a ghost
record.

## 7. Left open

1. **`object+0x50`, the PlayerControlObject branch condition.** Read in
   `0x08316ea0`; not identified. It does not affect any row above (the bodies
   rule out `PlayerControlObjectNetworkable` for every vehicle observed), but a
   mod or a case where it is non-zero would put a vehicle on the empty PCO
   reader, and that deserves an answer before the vehicle decoder is trusted.
2. **The 0–6 residual in the tid enumeration** (section 5, step 1). The order is
   right and the ids are right to within six over three thousand templates; six
   templates are counted by the engine and not by a walk of `objects.rfa` +
   `ai.rfa` + the level. Finding the loader that creates them would make the
   tid -> name map derivable with no recording at all.
3. **The `networkableInfo` gate.** `getNetworkableInfo()` must be non-empty for a
   networkable to be created at all, and every template this corpus instantiates
   does declare one. Read from the `Objects.con` that declares each template:
   `M3A1BodyInfo`, `ShermanBodyInfo`, `Zero_body_info`, `Corsair_body_info`,
   `SBDBodyInfo`, `AichiVal_body_info`, `DaihatsuBodyInfo`, `HatsuzukiBodyInfo`,
   `Chi-ha_BodyInfo`, `DefgunBodyInfo`, `AA_Base_BodyInfo` (note the lowercase
   `ObjectTemplate.networkableInfo` spelling in that file), `FreeCameraInfo`,
   `KitInfo` for both kits, `ProjectileInfo` for both grenade projectiles; the
   two soldiers take `NetSoldierInfo` from the `include
   ../Common/CommonSoldierData.inc` on the line after their
   `ObjectTemplate.create`. `NetworkableInfo.createNewInfo <Name>` declares the
   profiles (`Objects/HandWeapons/Common/Network.con`,
   `Objects/Items/BaseKit/Network.con`, …). Read as a *constraint* rather than as
   a mapping input, and it is not needed to answer the class question.
4. **The vehicle bodies that `simple-object.mjs` does not yet consume**
   (section 4). Constant 16-bit and 128-bit shortfalls on every record of a net
   id, and 67-bit bodies that read as mask `0x000`; the class is fixed, the
   reader is what is missing.

## 8. If a skill or the sidecar needs this

The two things worth reusing, rather than re-deriving:

- the class-id constants `39000…39012` and the thirteen registered names in
  section 1 are a property of the binary, not of the mod — hardcode them;
- the tid -> name map is a property of *(mod, level)* and belongs next to the
  level, as `tools/bf1942-models/sidecar/templates/wake.json` already does.

## 8. Computed for every level and mod (2026-10-17)

Section 5's four steps are now the sidecar's own, from the install, with no
recording: the tid -> name step is wire.md section 25, the name -> class step
is the class each `create` line resolves to (ledger LOAD-19: the first
registered class name the word starts, in class-id order; a word that starts
none makes nothing), and the class -> networkable step is section 2's table
completed for every registered class (ledger NET-8). `sidecar/classes.json`,
this file's table, is a test fixture: the computed Wake co-op table agrees
with it on all 24 tids and 52 net ids (`tests/test_sidecar_template_objects.py`).
Section 7's item 2 is closed by section 25 of wire.md.
