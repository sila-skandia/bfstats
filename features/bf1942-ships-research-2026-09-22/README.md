# Ships: buoyancy, deck spawns and the team a spawner picks

Stream **W6-E** of the parity round, research only. Nothing outside this folder
was changed.

The owner's three reports, in one sentence each:

1. **Destroyers sit too high — the propeller shows.** Two separate causes, and
   the larger one is report 3. `PhysicsFloatingBundle::updatePhysics` is read in
   full below; the authored spawner `y` is **not** the floating equilibrium, the
   engine settles a ship both up and down, and the viewer has no buoyancy at all
   because `viewer/map.html:5755` deliberately excludes every `VCSea` vehicle
   from the body world.
2. **You can spawn on a destroyer or carrier in game; here it puts you in the
   ocean.** The mechanism is settled: a `SpawnPoint` is an ordinary child of the
   ship object and `BFSpawnPoint::spawn` writes the soldier to **the spawn
   point's live absolute position**, so the deck spawns move with the hull. The
   deck itself is the ship's own collision mesh — a soldier is always the
   **vertex** side against ship **faces from col1** — not the static index. Our
   extractor bakes the deck spawn at the authored spawner pose
   (`extract_map.py:1856-1893`), which is wrong twice over: wrong ship, and
   frozen against a hull that should be settling and moving.
3. **Midway spawns the Axis ships for both fleets.** Confirmed, and the engine
   semantics are now read: **`teamOnVehicle` is a `bool`**, parsed with
   `std::istream::operator>>(bool&)`, stored in one byte, and used only to stamp
   the spawner's team onto the spawned `PlayerControlObject`. It is **not** a
   template index. The template index is the spawner's *own* team.
   `bf42/level.py:1355-1356` is refuted.

All addresses are `bf1942_lnxded.static`
(`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`) unless marked
*client*. Client addresses are in `BF1942.exe`, sha256
`60c9452d1ddb6a09a7b2bd6aa49a8a5508504d0f0e458cc61f0aebff53cd3699`;
`./xref.py check` was run and reported MATCH before any client address below was
taken. Decompiles were produced with
`features/bf1942-engine-reference/lnxded/decompile.sh`, and every sign,
comparison direction and subtraction order that a builder depends on was
re-read in `objdump -d -M intel` — the places where that mattered are called out.

Notation: `dt` = one tick. `g = getGravity()` = **−14.73**
(`BasicPhysicsSystem::getGravity`, vtable `+0x14`, `0x08251ec0`). `wl` = the
level's water level. A ship's root object is its `PlayerControlObject`; the
float nodes are `FloatingBundle` children of the hull `Bundle`.

---

## 1. The buoyancy law

### 1.1 Where it lives

| | server | client |
|---|---|---|
| `PhysicsFloatingBundle::updatePhysics(float)` | **`0x0824d640`** | **`0x0057e980`** |
| `PhysicsFloatingBundle` ctor | `0x0824d580` | ends `0x0057e97c` (entry not isolated) |
| `FloatingBundleTemplate::setPhysicsNodeComponent` | `0x08241090` | — |
| `FloatingBundle::handleUpdate(float, uint)` | `0x08240180` | — |
| `FloatingBundle::handleMessage(TemplateMessage, IPlayer*)` | `0x082402b0` | — |
| `FloatingBundleTemplate` ctor (defaults) | `0x08240880` / `0x082408f0` | — |
| `FloatingBundleTemplate::makeScript` (the field↔name anchor) | `0x08240a50` | string ref at `0x00571a82` |

The client entry `0x0057e980` was derived, not guessed: the string
`"No geometry for parent in floatingBundle."` (`0x008fe670`) is referenced from
`0x0057ecbc`; reading back through `read_memory` the preceding function ends
`ret 8` at `0x0057e97c` after writing `[esi+0xac]`, `[esi+0xb0]`, `[esi+0x9c]`
(the ctor), four `nop`s follow, and `0x0057e980` is
`sub esp,0x140; push esi; mov esi,ecx; fld [esi+0xa0]` — the same first field
read as the server's `fld [esi+0xa0]`. Ghidra has **no function created** there;
one was not created (the corpus rule), so treat `0x0057e980` as a proved entry
point rather than an existing symbol.

### 1.2 The template's fields, defaults, and the two that are dead

`FloatingBundleTemplate` ctor `0x08240880` plus `makeScript`'s own printed names
(the string at each print site resolves the offset unambiguously):

| `.con` word | template offset | default | read by |
|---|---|---|---|
| `setWaterHeight` | `+0x1b0` | **0.0** | **nothing** — `makeScript` only |
| `setHullHeight` | `+0x1b4` | **1.0** | `updatePhysics` |
| `setFloatMaxLift` | `+0x1b8` | **10.0** | copied to node `+0xa4` |
| `setFloatMinLift` | `+0x1bc` | **10.0** | copied to node `+0xa8` |
| `setDragModifier` | `+0x1c0` | **400.0** | **nothing** — `makeScript` only |
| `setSinkingSpeedMod` | `+0x1c4` | **1.0** | `handleMessage` only (§2) |

**`setWaterHeight` and `setDragModifier` are inert.** A whole-binary scan for
every instruction with a `+0x1c0` or `+0x1c4` displacement (2.4 M-line
`objdump` dump, 82 functions matched across the image) finds `+0x1c0` only in
the two constructors, `setDragModifier`, and `makeScript`'s two compares. So
`Hatsuzuki`'s `setDragModifier 8000` and the torpedoes' `8000.0` do nothing at
all; the drag in the buoyancy term is the **hull's** `ObjectTemplate.drag`.
`setWaterHeight` is never read either — the waterline comes from the terrain
(§1.4).

`setPhysicsNodeComponent` (`0x08241090`) allocates a `0xb4`-byte node and copies
only two fields: `node+0xa4 = template+0x1b8` (maxLift), `node+0xa8 =
template+0x1bc` (minLift). Node layout used by `updatePhysics`:

| node offset | meaning |
|---|---|
| `+0x98` | 1 (ctor) |
| `+0x9c` | the `FloatingBundleTemplate*` |
| `+0xa0` | the bundle **angle**, written every update by `FloatingBundle::handleUpdate` as `−angle[1]` |
| `+0xa4` | floatMaxLift |
| `+0xa8` | floatMinLift |
| `+0xac` | the **sink offset** accumulator, metres |
| `+0xb0` | the **sink rate**, metres per tick (0 until §2 arms it) |

### 1.3 The law, as a builder can implement it

```
// PhysicsFloatingBundle::updatePhysics(dt)      lnxded 0x0824d640 / client 0x0057e980
if (angle    != 0) getParent()->setIsAwake();                     // +0xa0
if (sinkRate != 0) { sinkOffset += sinkRate; getParent()->setIsAwake(); }   // +0xb0, +0xac
setSleepiness(getRootNode()->getSleepiness());
if (isSleeping()) return;                                          // a sleeping ship makes no lift

P  = this->getAbsolutePosition();                                  // the FLOAT NODE's world position
wl = terrainBase->getWaterLevel(P.x, P.z);                         // vtable +0x5c
H  = template->hullHeight;

f  = ((P.y - H) - wl + sinkOffset) / H;        // signed; 0 at y = wl+H, -1 at y = wl
t  = clamp(angle - f*H, 0, 1);                 // angle is ALREADY negated (see below)
if (!(f < 0)) return;                          // above the reference: no force, no drag, nothing
f  = max(f, -1.0);                             // the floor is the float32 -1.0 at 0x086b05ec

hull = this->getParent();  if (!hull) return;
geom = hull->getCompositeObject()->queryComponent(IID_IGeometry 0x492fe0fe)
    ?? findLodGeometry(that, CID_LodObjectTemplate, CID_DistCompareLodSelector,
                       CID_PlayerControlObjectTemplate);
if (!geom) { Debug("No geometry for parent in floatingBundle."); return; }
bb = geom->getBoundingBox();                   // vtable +0x1c: min at +0x00, max at +0x0c
DX = bb.max.x - bb.min.x;   DZ = bb.max.z - bb.min.z;

vy   = hull->getTangentSpeed(P).y;             // PhysicsNode +0x74
lift = (1 - t)*floatMinLift + t*floatMaxLift;

a_y  =  ( hull->getDrag() * (1 + 24*f) * 100.0 * DX*DZ / hull->getMass() ) * vy    // heave damping
      + ( g * (-f) * lift ) / -9.82;                                              // buoyancy

hull->addAccelerationAtAbsolutePosition(P, Vec3(0, a_y, 0));       // WORLD vertical, at the node
```

Every constant was read: `−9.82` at `0x086d0d6c`, `25.0` at `0x086ccce0` (the
code is literally `(1 − f) + f·25`, which is `1 + 24f`), `100.0` at
`0x086b01ac`, `−1.0` at `0x086b05ec`. The two vtable slots the arithmetic hangs
on are `PhysicsNode::getDrag` `+0x98` and `PhysicsNode::getMass` `+0xa0`
(`lnxded/vt.py 'world::PhysicsNode'`); the force adder is
`addAccelerationAtAbsolutePosition` `+0x68` and the velocity probe
`getTangentSpeed` `+0x74`, both already in collision-response.md §4.1.

Things worth saying out loud:

- **The force is purely world-vertical and applied at the float node's world
  position.** It is not along the hull's up axis. Because
  `addAccelerationAtAbsolutePosition` sums `(P − pos − com) × a` into the torque
  accumulator, a hull with eight nodes at different fore/aft and port/starboard
  offsets gets its pitch and roll righting for free out of the differing depths.
  Nothing else levels a ship.
- **`hullHeight` is not the hull's height.** It is the offset, above the
  waterline, of the reference plane the float node's own `y` is measured
  against: `f = 0` when the node sits at `wl + H`, `f = −1` when the node sits
  exactly at `wl`. Read as a datum, not a dimension — `Fletcher_Floater` has
  `hullHeight 20` while sitting 7.5 m above the hull origin on a ship with
  ~8 m of freeboard.
- **`f` is clamped at −1, so buoyancy saturates.** Maximum lift from one node is
  `1 × lift × 1.49995`. If `N × lift × 1.49995 < |g|` the ship cannot float at
  all, whatever its depth. That is the whole submarine dive (§4).
- **`t` only matters in the first metre.** `t = clamp(angle − f·H, 0, 1)` and
  `−f·H` is the submersion depth in metres, so for any ship whose equilibrium
  depth exceeds 1 m and whose bundle angle is 0, `t = 1` and the lift is
  **`floatMaxLift`, always**. That is why every vanilla ship authors
  `floatMinLift == floatMaxLift`: the min end is unreachable for them. It bites
  only on the small craft (`Elco80_MiddleFloater` 9/3, `Gato`/`Sub7C` 1.6275/0.8275).
- **The damping term's sign is deliberate but reversed near the surface.**
  `1 + 24f` with `f ∈ [−1, 0)` runs from `+1` at the surface to `−23` fully
  submerged; the product `A·vy` only *damps* when `A < 0`, i.e. `f < −1/24`
  (deeper than `H/24`). Inside that sliver it is anti-damping. Re-read from the
  bytes at `0x0824d890`–`0x0824d8cc` (`fld f; fld1; fxch; fmul 25.0; fxch;
  fsub f; ... faddp st(2)` → `1 + 24f`), so it is the code and not a decompiler
  artefact. It reads like an intended `lerp(1, 25, |f|)` with a sign slip;
  port it as written, because the sliver is never an equilibrium.
- **Drag and mass come from the hull, and the area is the hull's bounding-box
  footprint `DX·DZ`.** For a Fletcher (`drag 3`, `mass 2 500 000`, hull box
  roughly 12 × 120 m) each node contributes about `−2.4·vy` m/s², so eight of
  them heave-damp at ~`−19·vy`: a ship settles inside a second and does not
  oscillate. That the damping scales with the node *count* while the area does
  not is the engine's, not a porting error.

### 1.4 The waterline is flat — `PatchTerrain::getWaterLevel(float, float)`

```
longdouble PatchTerrain::getWaterLevel(float x, float z) const   // 0x083d7a80
{ return *(float *)(this + 0x30); }
```

**It ignores `x` and `z` entirely** and returns one scalar — the level's
`GeometryTemplate.waterLevel`. `WaterPatch::getWaterLevel(x,y,z)`
(`0x083d9700`) *does* add `waterWave()` (`0x083d98d0`, a clamped `sinf`) times a
per-patch amplitude, but nothing on the physics path calls it. So buoyancy sees
a **perfectly flat sea** and ships do not bob on the swell. That is a real
simplification the viewer gets for free; the vtable slot is
`terrainBase(0x087435f0)->+0x5c`, and the same slot is used by
`PhysicsEngine::updatePhysics` (§5) and `BFSpawnPoint::getActive` (§3.3).

### 1.5 The equilibrium, and the arithmetic for a Fletcher

At rest `vy = 0` and the sum over the float nodes must cancel gravity, which
the integrator seeds as `acc = (0, g·gravityModifier, 0)`
(collision-response.md §4.2):

```
Σ_i  (−f_i) · lift_i · (g / −9.82)  =  |g|           and  g / −9.82 = 1.49995

  ⇒  Σ_i (−f_i) · lift_i  =  9.82

with all nodes at the same height and the same template, and t = 1:

  (−f)  =  9.82 / (N · floatMaxLift)
  depth =  (−f) · H                      // metres the node sits below wl + H
  node_y =  wl + H − depth
  root_y =  node_y − relY                // relY = the float node's authored y offset
```

Worked for the **Fletcher**: `Fletcher_Floater` is `hullHeight 20`,
`floatMin/MaxLift 2`, and `Objects/Vehicles/Sea/fletcher/Objects.con` hangs
**eight** of them, all at `relY = 7.5` (`±1.999/2` at `z = ±50`, `±4.999/5` at
`z = ±17`). Midway's `GeometryTemplate.waterLevel` is 20.

```
(−f)   = 9.82 / (8 · 2) = 0.61375
depth  = 0.61375 · 20   = 12.275
node_y = 20 + 20 − 12.275 = 27.725
root_y = 27.725 − 7.5     = 20.225      ← the Fletcher's waterline
```

The destroyer spawner instance is authored at **y = 20.4371**, so the Fletcher
settles **0.21 m**. Run over the whole vanilla fleet (all eight floaters per
hull; `hullHeight`/`lift`/`relY` read out of each `Physics.con` and
`Objects.con`), against the authored Midway spawner `y`:

| ship | N | relY | H | maxLift | equilibrium root y | Midway spawner y | settles |
|---|---|---|---|---|---|---|---|
| Fletcher / Fletcher2 | 8 | 7.5 | 20 | 2 | **20.225** | 20.4371 / 20.4372 | −0.21 |
| Hatsuzuki / Hatsuzuki2 | 8 | 9.5 | 10 | 2 | **14.362** | 20.4371 / 20.4372 | **−6.08** |
| Enterprise | 8 | 14.8 | 17 | 7 | **19.219** | 19.8651 | −0.65 |
| Shokaku | 8 | 11.0 | 15 | 5 | **20.317** | 19.8651 | +0.45 |
| PrinceOW | 8 | 14.0 | 17 | 2 | **12.566** | 12.7351 | −0.17 |
| Yamato | 8 | 10.5 | 10 | 6 | **17.454** | 12.7351 | **+4.72** |
| Gato | 8 | 2.0 | 3.3 | 1.6275 | **18.811** | 12.7078 | **+6.10** |
| Sub7C | 8 | 2.0 | 4.3 | 1.6275 | **19.057** | 12.7078 | **+6.35** |

The "Midway spawner y" column is the **team-2 (Allied)** fleet's pad, because
that is where the viewer currently draws every one of these ships. The team-1
pads differ by under 0.1 m — `Destroyerspawner` 20.473, `Destroyerspawner2`
20.451, `Battleshipspawner` 12.6481, `carrierSpawner` 19.5996,
`SubmarineSpawner` 12.6481 — so against their own pads the Axis ships settle
Hatsuzuki −6.11, Yamato +4.81, Shokaku +0.72, Sub7C +6.41. The story does not
change.

This table is the strongest single piece of evidence for the law, and it also
settles the framing question. The authored `y` of every spawner on Midway is
within 0.7 m of the **Allied** ship's equilibrium — `princeow` at 12.7,
`fletcher` at 20.44, `enterprise` at 19.87 — including at the Japanese fleet,
where the Axis ship's own draft is metres away. So the level author placed each
pad at one fleet's draft and let the engine settle the other, which is
**exactly** the corpus's "the authored y is not the equilibrium": the engine
lifts a Yamato 4.7 m and drops a Hatsuzuki 6.1 m from the same pad. The
submarines are authored 6.1–6.4 m *below* their draft and surface on spawn.

**Report 1, answered.** A Fletcher drawn at its authored pad is 0.21 m high —
not enough to show a propeller (`Fletcher_propeller` sits at `relY = −2.63`,
still 2.2 m under). What the owner is looking at is a **Hatsuzuki drawn at the
Fletcher's pad, 6.08 m above its own waterline** — the wrong-team bug of
report 3 — and, once that is fixed, a fleet that never settles at all because
nothing in the viewer reads `FloatingBundle`.

---

## 2. Sinking — `sinkingSpeedMod` and `FloatingBundle::handleMessage`

`0x082402b0`. `sinkingSpeedMod` (`template+0x1c4`) has exactly **one** reader:
`fmul DWORD PTR [edx+0x1c4]` at `0x08240551`.

```
tmpl = this+0x4c;   node = this+0x60;   if (!node) { Debug("No pshyicsNodeComp!"); return; }
armor = the first IID_IArmor (0xc4a4) found down the chain from this
if (!armor || !armor->isSendingMessage())  return;               // Armor vtable +0x94, 0x081741c0

msg 0x13:  this+0xee = 0
msg 0x15:  this+0xed = 1
msg 0x14:  this+0xee = 1
           P = this->getAbsolutePosition();  C = getRootParent(this)->getAbsolutePosition();
           R = getRootParent(this)->getBoundingRadius();
           q = clamp( (2R + (P.z - C.z) + (P.x - C.x)) / (4R), 0, 1 );
           node->sinkRate(+0xb0) = (q + 0.1) * 0.05 * tmpl->sinkingSpeedMod;
```

`0xc4a4` is the Armor component id — `Armor::queryInterface` (`0x08173ee0`) and
`SimpleObjectTemplate::setArmorComponent` (`0x081ddae0`) are among its 173 use
sites. The three message ids are `Armor::status(float)`'s own
(`0x081739e0`: `push 0x14` at `0x08173ad6`, `push 0x13` at `0x08173bfd`,
`push 0x15` at `0x08173d62`), the same set hitpoints-and-damage.md §7 already
records as the critical/safe/destroyed trio.

What follows:

- **A ship starts sinking at `criticalDamage`, not at death.** Only `0x14` arms
  the rate; `0x15` (destroyed) sets the wreck byte and leaves the rate alone.
  For a Fletcher that is 50 of 300 HP. (If a single blow took a ship from
  healthy straight past zero, `0x14` might never fire — `Armor::status`'s exact
  crossing logic was not fully re-derived, so treat "a one-shot kill does not
  arm the sink" as **UNVERIFIED**.)
- **Each float node sinks at its own rate**, because `q` depends on where that
  node sits relative to the hull centre along `x + z`, normalised by twice the
  hull's bounding radius. A bow-starboard node gets `q ≈ 1`, a stern-port node
  `q ≈ 0`. So the ship goes down by one end and rolls as it goes. That
  asymmetry is the whole visual, and it is free once the per-node rate is right.
- **The rate is a virtual rise of the waterline, not a velocity.** `sinkOffset`
  is added to the numerator of `f`, in metres, once per tick: `+= (q+0.1)·0.05·
  sinkingSpeedMod`. At `sinkingSpeedMod 1` that is 0.005–0.055 m/tick, i.e. an
  equilibrium that drops 0.15–1.65 m/s. Multiply through `sinkingSpeedMod` for
  the fast sinkers: `lcvp_floater2` and `ptraft_floater2` are **7**,
  `daihatsufloater` and `floatingmine_floater` **5**, `elco80_floater` **3**.
- **`sinkingSpeedMod 0` means "never sinks"** — `ptraft_floater` sets it, and
  the raft's other two floaters set 7, so a shot-up raft rolls over rather than
  going down level.
- **A sinking ship never sleeps.** The non-zero rate calls
  `getParent()->setIsAwake()` every tick, which is the first thing
  `updatePhysics` does.

---

## 3. Spawning on a deck

### 3.1 The spawn point is a child of the ship, resolved live

```
bool BFSpawnPoint::spawn(IObject* soldier, float dt)          // 0x08163d70
{ if (soldier) soldier->setAbsolutePosition( this->getAbsolutePosition() );   // +0x3c from +0x38
  return soldier != nullptr; }
```

That is the whole of it. A `SpawnPoint` reached the ship's tree through
`ObjectTemplate.addTemplate <SpawnPoint>` + `setPosition` in the ship's
`Objects.con`, so its absolute position is its offset through the hull's live
transform, evaluated **at the moment of the spawn**. A settling ship, a moving
ship and a sinking ship all carry their deck spawns; there is no baked world
position anywhere in the engine.

The soldier is then an ordinary body: nothing snaps him to a surface at spawn
and nothing parents him to the ship. Note that the authored offsets are
deliberately *inside* the hull on some ships — `FletcherSoldierSpawn` is at
`relY 5` on a hull whose deck furniture sits at `relY 7.5–8.22` — so the
engine's own push-out is what puts him on the deck, which is why our `settle()`
(a downward probe, `viewer/soldier.js:480-520`) is a reasonable stand-in and why
it must probe from the spawn point *and* be allowed to go **up**.

### 3.2 What gives a soldier a deck to stand on

A ship is a dynamic object, so it is not in the static collision set, and the
prior round's guess ("the carriers are not in the static collision index at
those spawn points, so there is no deck to land on") is the wrong model of the
engine. From collision-response.md §5.2–§5.4, which this stream re-read rather
than re-derived:

- The pair filter skips a pair only when **neither** side is a mobile awake
  body. A soldier is mobile and awake, so soldier-versus-ship is always tested,
  including against a sleeping ship.
- §5.3: when one side is a soldier, **the soldier is the vertex side, weight
  1.0**. So the test is the soldier's col0 vertices against the **ship's
  faces**.
- §5.4: faces come from **col1** when the vertex side is a soldier. The deck a
  soldier stands on is the ship hull's **collision layer 1**.
- §8: object contacts feed the share-scaled **relative** velocity into the
  friction solve, so "a light body standing on a heavy moving one is carried
  along" — that is the moving-platform carry, and it needs no parent link, no
  ride offset and no special case. A soldier walking on a moving destroyer is
  an emergent property of the ordinary contact path.
- The mass share (§6.1) snaps: `s = 2.5e6/(2.5e6 + m_soldier) > 0.95`, so the
  soldier takes the whole correction and the ship does not notice him.

The shipped Midway scene does carry the hull layer:
`spawners/Hatsuzuki/lodHatsuzuki/HatsuzukiComplex/HatsuzukiComplex collision 1`
is a node in `viewer/maps/midway/scene.glb`, so the triangles exist and are in
`buildCollisionIndex`'s output. **What I could not close** is why a spawn still
lands in the sea; see §7.

### 3.3 `getActive` — a critically damaged ship stops being a spawn point

`BFSpawnPoint::getActive(bool, int)` `0x08163dd0`, in order:

1. the object's own active byte (`+0x13c`);
2. the first `IID_IArmor` down the chain — if `armor->isCriticalDamaged()`
   (Armor vtable `+0xcc`, `0x08174320`) the point is **inactive**. Same
   threshold that arms the sink (§2), so a burning destroyer stops being a
   spawn point at the moment it starts going down;
3. the active combat area in x/z (`Game+0xc4`, else the terrain extents);
4. a terrain-material veto against `GameServer` vtable `+0x2c0`;
5. a height gate: if `template+0x164 != −1.0` and
   `spawnPos.y − max(terrainHeight(x,z), waterLevel(x,z)) < template+0x164`,
   inactive. `BFSpawnPointTemplate`'s ctor (`0x0816a510`) seeds `−1.0`, and its
   `makeScript` (`0x0816a8e0`) never prints the field — **the `.con` name of
   `+0x164` is UNVERIFIED** and no console word for it was found;
6. with `setEnterOnSpawn`/`setAIEnterOnSpawn` (`template+0x161`/`+0x162`),
   `BFfindEntryPoint(pos, 5.0 or 15.0, team, …)` must find a vehicle to enter.

`BFSpawnPointTemplate` offsets read from the ctor and `makeScript`:
`setSpawnPreventionDelay +0x154`, `setSpawnId +0x158` (default 0),
`setGroup +0x15c` (default **−1**), `+0x160` active byte (default 1),
`setEnterOnSpawn +0x161`, `setAIEnterOnSpawn +0x162`,
`setSpawnAsParaTroper +0x163`, the unnamed height gate `+0x164` (−1.0).

### 3.4 The deck spawn's *team* is not separately broken

Midway's Allied pad carries `team: 1` in `scene.json` only because the ship on
it is a Hatsuzuki. `Bf1942/Game/GlobalSpawnGroups.con` binds the fleet groups to
sides directly: **64/65 Yamato → 1, 66/67 PrinceOW → 2, 68/69 Fletcher → 2,
70/71 Hatsuzuki → 1, 72–74 Enterprise → 2, 75+ Shokaku → 1**. The Hatsuzuki's
own `setGroup 70`/`71` are team 1, so the extractor's group→team lookup
(`extract_map.py:1881-1884`) is doing the right thing with the wrong ship. Fix
the template and the spawn team follows with no other change. W6-F does **not**
need a separate soldier-team fix.

---

## 4. `teamOnVehicle` — a bool, and it does not choose the template

### 4.1 What it is

| | server | client |
|---|---|---|
| `ObjectSpawnerTemplate` ctor | `0x08314a70` / `0x08314ba0` | `FUN_00547c90` |
| `ObjectSpawnerTemplate::makeScript` | `0x08314f70` | string ref `0x00546f1c` |
| `ObjectSpawner::spawnObject` | `0x083140a0` | **`FUN_00546f90`** |
| `ObjectSpawner::setTeam(int)` | `0x08313810` | — |
| `ObjectSpawner` ctor | `0x08312910` | — |
| `teamOnVehicle` byte | template **`+0x185`** | template **`+0x249`** |
| `holdObject` byte | template **`+0x184`** | template **`+0x248`** |
| the spawner's live team | object **`+0x134`** | object **`+0x154`** |
| `ObjectTemplate.team` | template **`+0x15c`** | template **`+0x220`** |

Three independent proofs that it is a **bool**, not a team index:

1. **It is one byte, defaulted to 0.** Both constructors write
   `*(char*)(this + 0x185) = 0` (server, `0x082408dc`-style store visible in
   the ctor decompile) / `*(char*)(this + 0x249) = 0` (client,
   `0x00547d47 MOV byte ptr [ESI + 0x249], AL`). A team index would not be a
   byte defaulted to a value that is not a team.
2. **`makeScript` prints it with a hard-coded `1`.** The format string at
   `0x086e15e0` is the literal `"ObjectTemplate.teamOnVehicle 1"` — no `<<` of
   the value follows it, unlike every numeric field beside it. The engine's own
   serializer round-trips any non-zero value as `1`. Its neighbour at
   `0x086e1477` is `"ObjectTemplate.holdObject 1"`, the same shape.
3. **The console property is typed `bool`.** The property is registered in
   `__static_initialization_and_destruction_0` at `0x082a8932`
   (`mov ds:0x87a70cc, 0x86d4eda` — the name string `"teamOnVehicle"`), with
   vptr `0x8736fa8` = `ConsoleClass437` (`vtable for …ConsoleClass437`
   `0x08736fa0`). That class's `checkObjectRange(**bool**)` gives the type away,
   and `setArgFromString` (`0x082e9780`) parses the argument with
   **`std::basic_istream::operator>>(bool&)`** into a function-local static, and
   `executeObjectMethod` (`0x082e9880`) stores that single byte into
   `getActiveTemplate(0x94a1) + 0x185`.

**A survey over all 18 installs** (every `.rfa`, every `.con`) finds
`teamOnVehicle` written **11 351×** as `1`, **21 998×** as `0`, **242×** as
`2`, and once as `1z` (FHSW). The `2`s are modder cargo-cult — `mobileaaUSspawner`,
`zpuUSspawner`, `sa-3usspawner`, DC's Coral Sea `DestroyerSpawner` and
`carrierSpawner_2` — people who read it as "team 2". Under `>> bool` in the
default (non-`boolalpha`) mode, `2` is **not a valid bool token**: the
extraction fails. What ends up in the byte then depends on this libstdc++'s
`num_get<bool>` and, because the destination is a **static**, possibly on the
previous parse — **UNVERIFIED**, and left that way deliberately. It does not
matter for behaviour: `spawnObject` only ever tests the byte against zero, so
`1` and a hypothetically-stored `2` are the same, and a failed parse is at worst
the same as `0`.

### 4.2 What `spawnObject` actually does

Server `0x083140a0`; client `FUN_00546f90` is the same function instruction for
instruction in shape, including the two template bytes and the same interface
slots.

```
key = this->mTeam;                                     // +0x134 server / +0x154 client
it  = this->mObjectTemplates.find(key);                // the setObjectTemplate <n> <name> map
if (it == end) return -1;                              // NO FALLBACK. Wrong team -> nothing spawns.
rot = getRotation(this->getAbsoluteTransformation());
pos = this->getAbsolutePosition() + this->spawnOffset;  // +0x150/154/158 <- template spawnOffset
obj = game->createObject(it->second.template, pos, rot);
if (!obj) return -1;
if (this->mRemaining > 0) this->mRemaining--;
id = obj->queryInterface(IID_ICompositeObject)->+0x48;
this->calcSpawnDelay();

pco = the first IPlayerControlObject (IID 0xc4c5) found walking obj's composite tree
if (pco) {
    pco->setObjectSpawnerId(this->mOSId);               // iface +0x84
    pco->setTimeToLiveUnused(template->TimeToLive);     // iface +0x80, template+0x154 / +0x218
    if (template->teamOnVehicle) {                      // +0x185 / +0x249
        pco->setTeam(this->mTeam);                      // iface +0x6c  -> PCO+0x170, ++PCO+0x174
        if (auto* x = *(void**)((char*)pco - 0xac))     //  client: -0xc4
            x->vtable[+0x24](this->mTeam);              //  client: +0x20 — UNIDENTIFIED
    }
    if (template->holdObject) {                         // +0x184 / +0x248
        pco->setObjectSpawnerHolding(true);             // iface +0x8c
        ... getRootParent(this) -> its PCO -> getTeam() (iface +0x74) -> byte obj+0x102 / +0x11a
    }
}
if (this->getHasUseButton()) gameServer->vtable[+0x190](this->mOSId);
this->mHolding = template->holdObject;
return id;
```

The interface slot names come from the **secondary** vtable of
`PlayerControlObject` — `vtable for dice::ref2::world::PlayerControlObject`
`0x0873eec0`, whose second sub-object table begins at symbol `+0x1b8`
(offset-to-top `−0x104` at symbol `+0x1b0`). From that vptr: `+0x6c setTeam`,
`+0x70 clearTeam`, `+0x74 getTeam`, `+0x80 setTimeToLiveUnused`,
`+0x84 setObjectSpawnerId`, `+0x8c setObjectSpawnerHolding`. `vt.py` stops at
`+0xfc` on the primary table, so this table was read with a raw word dump —
worth knowing for the next reader.

`PlayerControlObject::setTeam(int)` (`0x0831a5f0`) is two instructions:
`this+0x170 = team; ++this+0x174` (a net-dirty counter). So `teamOnVehicle`'s
whole effect is **ownership of the spawned vehicle** — which is what
`validateBFEntryPoint` tests when a soldier tries to get in
(seats-and-entry-points.md SEAT-3) — and nothing else.

### 4.3 What *does* choose the template

`this->mTeam`, and only that. `ObjectSpawner`'s ctor (`0x08312910`) seeds both
`+0x134` and `+0x138` from `template+0x15c` (`ObjectTemplate.team`, default 0),
and `ObjectSpawner::setTeam(int)` (`0x08313810`) is the only writer of `+0x134`.
It has exactly **three** callers in the image (scanned every `call 8313810` in
the full disassembly):

- `ControlPoint::CPEnable()` `0x082840e0`
- `ControlPoint::CPDisable()` `0x08284200`
- the instance-level console property's `executeObjectMethod`
  `0x082b5be0`, which fetches the active object, checks its CID and tail-calls
  `ObjectSpawner::setTeam(spawner, arg)` — this is the path a level's
  `Object.setTeam <n>` on a spawner instance takes.

So: **a level's `Object.setTeam` on the spawner instance picks the template, and
a captured control point re-picks it at runtime.** `teamOnVehicle` never
touches the map lookup.

Note the missing fallback: if `mTeam` has no entry in the `setObjectTemplate`
map, `spawnObject` returns `-1` and spawns nothing. Our
`spawn_vehicle` falls back to `vehicles[2] or vehicles[1]`
(`bf42/level.py:1356`), which is a viewer-friendly lie but not the engine.

### 4.4 The verdict W6-F asked for

`bf42/level.py:1309-1312` reads `teamonvehicle` into `SpawnTemplate.owner_team`
and `bf42/level.py:1355-1356` lets it override the instance's `Object.setTeam`.
**Both are wrong.** The correct model:

- `teamonvehicle` is a **bool** (`value != 0`), and its only meaning is "the
  spawned vehicle is owned by the spawner's team". If the pipeline wants to
  carry it, carry it as `team_on_vehicle: bool` and use it for vehicle
  *ownership* (who may enter), not for template selection.
- the selector is `inst.team` — the instance's `Object.setTeam` — falling back
  to the spawner template's `ObjectTemplate.team`, which defaults to 0. A
  spawner with `team 0` and no instance `setTeam` spawns **nothing** in the
  engine; the viewer's `vehicles[2] or vehicles[1]` fallback should be kept but
  labelled as a deliberate divergence.

That single change turns Midway's fleet into `fletcher`/`fletcher2`,
`enterprise`, `princeow` on the team-2 pads and `hatsuzuki`/`hatsuzuki2`,
`shokaku`, `yamato` on the team-1 pads, and — via §3.4 — fixes the deck spawn
teams at the same time. 127 spawners across 10 levels (Battle of Britain, Coral
Sea, Guadalcanal, Invasion of the Philippines, Iwo Jima, Midway, Omaha Beach,
Truk, Wake, and Midway's sibling layers) declare both templates with
`teamOnVehicle 1` and are all currently resolving to the Axis side.

---

## 5. Does a ship need a drive model? — `c_ETShip` in `PhysicsEngine::updatePhysics`

`0x0824cbb0`, read in full this round. `engineType` is the bit field
tank-driving.md §2 documents; `c_ETShip = 9` = bits 0 and 3.

```
root = getRootNode()
if |throttle| >= 0.05: if root->getSleepiness() > -1: root->setIsAwake();
else                 : this->setSleepiness(root->getSleepiness());

if (!(engineType & 1)) return;                      // a car or a tank stops here

P  = this->getAbsolutePosition();                   // the ENGINE node, not the hull
wl = terrainBase->getWaterLevel(P.x, P.z);
if (P.y < wl) {                                     // the screw is in the water
    if (!(engineType & 8)) { throttle = 0; goto propellerVisual; }      // a PLANE drowns its engine
} else {                                            // the screw is out of the water
    if ((engineType & 8) && |throttle| > 0.02) { throttle = 1.0; goto propellerVisual; }
}
                                                    // ---- the thrust body ----
fwd  = row 2 of this->getAbsoluteTransformation()   // +0x20/+0x24/+0x28
top  = walk this->getParent() to the topmost node
rho  = 1 - clamp(P.y / basicPhysicsSystem->getAirDensityZeroAtHeight(), 0, 1)
e    = throttle - (top->getPositionalSpeed() . fwd) * rho / template->noPropellerEffectAtSpeed
K    = 0.1*|throttle| + |e|*e                       // SIGNED square
feedbackLoop(fwd*K, fwd)                            // engine SOUND only (physics.md section 5)
F    = fwd * (getCurrentRatio() * K)
root->addAccelerationAtAbsolutePosition(P, F)        // at the SCREW, not the CoM
propellerVisual:
   c = this->getCompositeObject()->queryInterface(IID_ICompositeObject)->getChild()   // +0x7c
   lod = c ? c->queryInterface(IID_ILodObject 0xc4e0) : null
   if (lod) { lod->+0xc->+0x10(|throttle|);                       // the LOD selector's input
              M = the active LOD's transform;
              roll(M, throttle * (|throttle| >= 0.08 ? 20.0 : 400.0));
              setTransformation(activeLod, M); }
```

The propeller visual is a bonus: the engine node's first child is a
`LodObject`, its selector is fed `|throttle|`, and the **active** LOD is rolled
per tick by `throttle·20` above a `|throttle|` of 0.08 and by `throttle·400`
below it. The fast-spin arm is the low-throttle one, which only makes sense if
the above-threshold LOD is a motion-blur disc — a discrete-blade mesh spun 32°
a tick would strobe. Not something a build stream needs, but it explains why
propellers have two LODs at all.

So, for the owner's question:

- **A ship is on the same thrust law as an aircraft.** There is no ship-specific
  propulsion code. `viewer/seats.js:186-196` falling a ship helm through to
  `'seat'` is not wrong-in-principle — it is just unfinished, and the law is
  four lines long.
- **The `& 8` branch is the ship's own rule**: a ship's Engine node is authored
  *below* the waterline (`Fletcher_Engine` at `0/−4/−40`, abs y ≈ 16.2 against
  `wl 20`), which is the normal case and runs the thrust body. When the screw
  comes **out** of the water — a bow-up sinker, a capsize, a ship lifted too
  high — the branch **skips the thrust entirely and pins the stored throttle to
  1.0**. A plane with `& 8` clear gets the mirror rule: an engine below the
  waterline has its throttle **zeroed**. This is `0x0824cc89` / `0x0824d047`,
  which tank-driving.md records as "pinning `PhysicsEngine+0xa0` to 1.0" —
  now with the condition attached.
- `getCurrentRatio()` = `3.5 · setDifferential / gearRatioCurve[100]` and
  `gearRatioCurve[100] = 0.94` (physics.md §5), so Fletcher (`setDifferential 2`)
  has ratio **7.447** and Gato (`1`) **3.723**. Full throttle from rest is
  `K = 1.1`, so `8.19 m/s²` forward for a Fletcher — applied at the screw, on
  the centreline, so no yaw.
- **`setTorque 2` on `Fletcher_Engine` is the engine sound, not thrust**
  (physics.md §5, unchanged). **`setNoPropellerEffectAtSpeed 120`** is the speed
  at which `e` reaches zero — but the *actual* top speed is set by the box drag
  law against the submerged drag multiplier `1 + 24·min(depth/DY, 1)`
  (physics.md §3), which for a hull several metres under is a large number. **I
  did not calibrate a ship's top speed** and a builder should not take 120 m/s
  as one; that is a measurement job against the game.
- Steering is `Fletcher_rudder` and `Fletcher_HullWing`, two ordinary `Wing`
  nodes with `setWingLift 0 / setFlapLift 2` on `c_PIYaw` — physics.md §4's
  lift law with no new code. The engine has no ship-specific turning law either.

**Cheap to fix? Yes, but not first.** It is one engine + two wings on top of the
buoyancy body, and all three laws are already implemented in the viewer for
aircraft. It is worth nothing until a ship is a body at all.

---

## 6. Submarines

`Gato` and `Sub7C` need buoyancy and **one** extra thing, which is already in
the law above: `GatoFloater` and `Sub7C_Floater` are the **only** vanilla
`FloatingBundle`s that declare `RotationalBundle` words —

```
ObjectTemplate.create FloatingBundle GatoFloater
ObjectTemplate.setMinRotation 0/0/0
ObjectTemplate.setMaxRotation 0/50/0
ObjectTemplate.setMaxSpeed    0/2/0
ObjectTemplate.setAcceleration 0/1/0
ObjectTemplate.setInputToPitch c_PIPitch
rem ObjectTemplate.setAutomaticReset 1        <- commented out
ObjectTemplate.setHullHeight 3.3
ObjectTemplate.setFloatMaxLift 1.6275
ObjectTemplate.setFloatMinLift 0.8275
```

`FloatingBundle::handleUpdate` (`0x08240180`) runs
`RotationalBundle::calculateAndClipAngle(this, tmpl, axis 1, dt)` — gated on
`maxRotation.y > 0`, which manned-guns.md already records — and then writes
`node+0xa0 = −angle[1]` (`*(uint*)(this+0x144) = *(uint*)(this+0x108) ^ 0x80000000`,
`this+0x108` being `angle[1]` of the `+0x104` Vec3).

**That is the dive law, and it is the `t` term of §1.3.** With
`t = clamp(−angle_Y − f·H, 0, 1)` and `angle_Y ∈ [0, 50]`:

| `angle_Y` | `t` | lift | what happens |
|---|---|---|---|
| 0 | 1 (depth 2.49 m ≫ 1) | `floatMaxLift` 1.6275 | surfaced, `(−f)·L = 1.2275` ⇒ root y = wl − 1.19 (Gato) |
| ~1.5 … ~2.8 | between | between | a trimmed equilibrium exists, `(−f)` from 0.754 to 1.0 |
| > ~2.8 | 0 | `floatMinLift` 0.8275 | `8 × 1 × 0.8275 × 1.49995 = 9.93 m/s² < 14.73` — **buoyancy can never cancel gravity, the boat sinks without limit** |

So: pitch-down winds the angle up at 2 units/s (accel 1), the boat loses lift
and goes down; pitch-up unwinds it (there is no `automaticReset`, so the plane
of trim stays where you leave it — `setMinRotation 0/0/0` also means the angle
can never go negative, i.e. there is no "extra buoyancy" setting). The depth is
then limited by `submarineData`'s crush depth and the oxygen drain
(physics.md PHY-3, already closed for five of its seven parameters);
`Gato` declares `submarineData 0.009 0.03 1 10 19.5 40 5`.

One quirk to record: `angle_Y` is a `RotationalBundle` angle, i.e. **degrees**,
and it is subtracted from a **metre**-valued submersion depth. The clamp to
`[0, 1]` hides it — 50 "degrees" just saturates `t` at 0 — but a builder should
not try to make the units agree.

Beyond that, submarines need nothing ships do not: same hull drag, same engine
(`c_ETShip`, `setDifferential 1`), same rudder/hullwing pair, plus
`GatoRudderFrontL/R` and `GatoRudderBackUD` on `c_PIPitch` for the visible dive
planes (`setFlapLift 0.025`/`0.08` — trivial lift, they are mostly cosmetic).

---

## 7. What I could not close

| | how far I got |
|---|---|
| **Why a deck spawn actually lands in the sea in the viewer** | The engine side is closed (§3) and the hull's `collision 1` node *is* in `viewer/maps/midway/scene.glb`. I did not run the viewer, so the remaining candidates are untested: the soldier's `settle()` probe starts at `y + 0.5` and only ever moves him **down** (`viewer/soldier.js:493-501`), so a spawn authored *inside* the hull — which several are (`FletcherSoldierSpawn` `relY 5` under a `relY 7.5` deck) — has no way up; or the ship's col1 has no upward face at the pad. **The 2-minute check:** load `map.html?mod=bf1942&map=midway&shots`, `__deploy.select('Hatsuzuki')`, `__deploy.spawn()`, then read `__hud`/the soldier's `y` and compare against `collider.statics.cast(x, y+0.5, z, 0,-1,0, 600)`. |
| **The second team consumer in `spawnObject`** | `*(void**)((char*)pco_iface − 0xac)` server / `− 0xc4` client, called at its own vtable `+0x24` / `+0x20` with the team. On the server that member lives at `PlayerControlObject + 0x58`. Not identified; it is not `Armor` (whose team-ish setters are elsewhere) and not the PCO itself. Harmless to ignore for the viewer. |
| **`teamOnVehicle 2`'s stored byte** | The parse is `>> bool` and `2` is not a valid token, so the extraction fails; whether the byte becomes 0 or keeps the previous static's value is this libstdc++'s `num_get<bool>` behaviour and I did not read `_M_extract_int`. Behaviourally moot (§4.1). |
| **`BFSpawnPointTemplate+0x164`'s `.con` name** | Default `−1.0`, gates `spawnPos.y − max(terrain, water) < value`, printed by no `makeScript` branch and matched by no console string I could find. Recorded as unnamed rather than guessed. |
| **Whether a one-shot kill skips the sink** | `0x14` is the only message that arms it, and `0x15` does not. Whether `Armor::status` can reach `0x15` without having passed `0x14` needs its crossing logic (`0x08173a0c`–`0x08173b7a`, `[esi+0x38]` vs `[esi+0xf0]`) read properly. I read the shape, not the edges. |
| **Ship top speeds** | The law is read; the terminal speed depends on the submerged-drag multiplier against the hull's own bounding box, which I did not evaluate per ship. No numbers offered. |
| **Client addresses for the `FloatingBundleTemplate` and `ObjectSpawner` bodies other than the two named** | `FUN_00547c90` (spawner template ctor) and `FUN_00546f90` (`spawnObject`) are confirmed; `0x0057e980` was derived byte-by-byte. `FloatingBundleTemplate::makeScript` and the `FloatingBundle` object methods were not isolated on the client — the string references (`0x00571a82`, `0x008fcde8`, `0x008f7ef4`, `0x008e4dc4` → `FUN_004de8c0`) are anchors for whoever needs them. |
| **Elco80 / Type38 equilibria** | Those hulls mix two floater templates (`8/8` and `9/3`) at four different heights, so the equilibrium is a 2-D solve rather than the closed form of §1.5. Not computed. |
| **Ship-to-ship ramming** | The corpus's open item. Everything in collision-response.md applies unchanged once a ship is a body (mass 2.5e6–3.5e7 snaps every share, `speedMod` defaults to 0.05 so the `> 1.0` damage gate is 14 m/s), but I did not read anything new about it. |

---

## 8. What changes in our code

| file:line | today | should be |
|---|---|---|
| `bf42/level.py:1309-1312` | `teamonvehicle` → `SpawnTemplate.owner_team` (an int team) | a bool `team_on_vehicle = value != 0` |
| `bf42/level.py:1355-1356` | `if spec.owner_team is not None: team = spec.owner_team` — overrides the instance | **delete**. The selector is `inst.team`, then `ObjectTemplate.team`. Keep the `vehicles[2] or vehicles[1]` fallback (line 1359) but comment it as a divergence: the engine spawns nothing |
| `extract_map.py:1820` | `spawn_vehicle(inst.template, inst.team, …)` — gets the Axis ship through the override above | fixed by the `level.py` change; re-extract is what moves `scene.json` |
| `extract_map.py:1856-1893` | deck spawn baked at `[ox + rot(lx,lz), oy + ly, -oz…]` from the **spawner's** authored pose | emit the **ship-local offset** (`lx, ly, lz`) alongside the world position, so the viewer can re-resolve it against the hull's live matrix once ships settle and move. The world position stays useful as the no-physics fallback |
| `viewer/map.html:5755` | `if (node?.userData?.physics?.vehicleCategory === 'VCSea') return null;` — every ship excluded from the body world | the hook. Return a spec that carries the hull's float nodes, and let the body world run §1.3 |
| `viewer/map.html:5773-5790` (`settlePlacedVehicles`) | 300 ticks of gravity + wheel springs + terrain, no buoyancy | with §1.3 in the body world this is already the right place and the right budget: a Fletcher's heave damping is ~`−19·vy`, so it settles well inside 300 ticks |
| `viewer/vehicle-bodies.js:182-233` (`describeVehicleParts`) | a part is `'body'` or `'spring'`; `FloatingBundle` children carry no collision node so they never become parts | a third part kind, `'float'`, taken from `templateKind === 'FloatingBundle'` nodes (offset + the five extras `con.py` already emits) — no collision mesh needed, a float node is a point |
| new module, e.g. `viewer/body-float.js` | — | §1.3, per float node, called from the same pass as the wheel springs. Testable under node like `body-friction.js` (no `three` import) |
| `bf42/con.py:1348-1355` | emits `hullHeight`, `floatMaxLift`, `floatMinLift`, `sinkingSpeedMod`, `dragModifier` | already correct and already shipped in the glbs. Worth a comment that `dragModifier` and `waterHeight` are **dead in the engine** so nobody wires them |
| `bf42/con.py:879-884` | the comment guesses the asymmetric min/max lift "is the dive" | right conclusion, now with the mechanism: it is the `RotationalBundle` angle on axis 1 biasing `t` |
| `viewer/seats.js:186-196` | a ship helm falls through to `'seat'` | `c_ETShip` → a new `'ship'` seat kind once §5 exists. Not before |
| `viewer/soldier.js:480-520` (`settle`) | probes from `y + 0.5` **downward** only | a deck spawn authored inside a hull needs an upward escape too (see §7) |

---

## 9. Build order for a ships stream

Smallest useful first, each step shippable on its own.

1. **`teamOnVehicle` (half a day).** `bf42/level.py` only, plus a unit test per
   §4.4, plus a re-extract of the ten affected levels. This alone turns Midway's
   US fleet American, fixes the deck spawn teams for free, and removes 6.08 m of
   the destroyer's height error. **Do this first even if nothing else lands** —
   it is a data fix with no runtime risk, and W6-F has it in hand.
2. **Buoyancy as a static settle (1–2 days).** `'float'` parts in
   `describeVehicleParts`, `viewer/body-float.js` with §1.3, and drop the
   `VCSea` guard *only inside `settlePlacedVehicles`*. Ships still never
   simulate at runtime; they just get placed at their real draft, and the
   collision index bakes them there. Verify against §1.5's table: eight ships,
   eight predicted `y` values, each within a few centimetres.
3. **Buoyancy at runtime (1 day).** Remove the `VCSea` guard from
   `bodySpecFor` outright, so a ship is a sleeping rigid body: rammable,
   pushable, and it stays afloat when woken. This is the step that needs the
   heave-damping term to be right; a ship that oscillates means the
   `1 + 24f` sign or the `DX·DZ` area is wrong.
4. **Deck spawns resolved live (half a day).** Emit the ship-local offset from
   the extractor, resolve it against the hull node's matrix at spawn time, and
   fix `settle()`'s downward-only probe. Depends on 2 or 3 having moved the hull.
   Close §7's open question here, because this is the step that would expose it.
5. **Sinking (1 day).** §2, driven off the existing `armor.js` critical-damage
   state, plus `BFSpawnPoint::getActive`'s critical gate so a burning ship stops
   offering deck spawns. This is the most visible single feature per line of
   code in the whole list.
6. **Propulsion (1–2 days).** §5: one `Engine` on the existing thrust law, two
   `Wing`s on the existing lift law, the `& 8` water gate, and a `'ship'` seat
   kind. Needs calibration against the game, which is the expensive part, not
   the code.
7. **Submarine dive (half a day on top of 6).** §6 is `t` plus a
   `RotationalBundle` on the float node, both of which exist by then, plus
   `submarineData`'s crush/oxygen from PHY-3.

Staged cost: **step 1 alone is most of the visible fix**; steps 1–2 are about
two to three days and make the fleet sit right; 1–5 is a week and makes ships
behave; 6–7 is another two to three days plus calibration and is the only part
that needs someone at the game.

---

## 10. Ledger rows, ready to paste

Ledger section suggestion: a new `## Ships and buoyancy (2026-09-22)` block, and
the `ObjectSpawner` rows into the existing spawner/seat area.

| # | Assumption in our code | Where | Status | Evidence |
|---|---|---|---|---|
| SHIP-1 | `FloatingBundle` is decorative; ships need no buoyancy force | [vehicle-bodies.js:182](../../tools/bf1942-models/viewer/vehicle-bodies.js#L182), [map.html:5755](../../tools/bf1942-models/viewer/map.html#L5755) (`VCSea` excluded from the body world) | **refuted** | `PhysicsFloatingBundle::updatePhysics` `0x0824d640` (*client* `0x0057e980`, derived: the ctor's `ret 8` at `0x0057e97c`, four `nop`s, then `sub esp,0x140; mov esi,ecx; fld [esi+0xa0]` matching the server's first field read) adds a world-vertical acceleration at each float node's world position: `a_y = (drag·(1+24f)·100·DX·DZ/mass)·vy + g·(−f)·lift/−9.82`, with `f = ((y − hullHeight) − waterLevel + sinkOffset)/hullHeight` clamped at −1 (`0x086b05ec`), `lift = (1−t)·floatMinLift + t·floatMaxLift`, `t = clamp(angle − f·hullHeight, 0, 1)`. Constants `−9.82` `0x086d0d6c`, `25.0` `0x086ccce0`, `100.0` `0x086b01ac`. Drag and mass are the **parent hull's** (`PhysicsNode` vtable `+0x98`/`+0xa0`); the area is the parent's geometry bounding box, `IID_IGeometry 0x492fe0fe` then `findLodGeometry`, else `Debug("No geometry for parent in floatingBundle.")` and no force. See [bf1942-ships-research-2026-09-22/README.md](../bf1942-ships-research-2026-09-22/README.md) §1 |
| SHIP-2 | A ship spawner's authored `y` is where the ship sits | [extract_map.py:1856](../../tools/bf1942-models/extract_map.py#L1856), the `objectSpawns[].position` the viewer draws at | **refuted** | The equilibrium is `Σ_i (−f_i)·lift_i = 9.82`. For the eight vanilla capital ships, all with 8 float nodes at one height, `root_y = waterLevel + hullHeight − 9.82·hullHeight/(N·floatMaxLift) − relY`: Fletcher **20.225**, Hatsuzuki **14.362**, Enterprise **19.219**, Shokaku **20.317**, PrinceOW **12.566**, Yamato **17.454**, Gato **18.811**, Sub7C **19.057** against `waterLevel 20`. Midway authors its pads at the **Allied** ship's draft on both fleets (20.4371, 19.8651, 12.7351), so the engine lifts a Yamato 4.72 m and drops a Hatsuzuki 6.08 m from the same pad, and surfaces both submarines by 6.1–6.4 m. §1.5 |
| SHIP-3 | `setDragModifier` and `setWaterHeight` are live `FloatingBundle` parameters | [con.py:1348](../../tools/bf1942-models/bf42/con.py#L1348) emits both | **moot** | `FloatingBundleTemplate+0x1c0` (dragModifier, default 400.0) and `+0x1b0` (waterHeight, default 0.0) have no reader anywhere: a whole-image scan of every instruction with a `+0x1c0`/`+0x1c4` displacement finds `+0x1c0` only in the two ctors `0x08240880`/`0x082408f0`, `setDragModifier` `0x08241070` and `makeScript` `0x08240a50`'s compares. `Hatsuzuki`'s `setDragModifier 8000` and the torpedoes' `8000.0` do nothing. The buoyancy drag is the hull's `ObjectTemplate.drag` |
| SHIP-4 | (new) `sinkingSpeedMod` is a sink velocity | — | **confirmed as something else** | It is a per-node multiplier on a **waterline-rise rate**. `FloatingBundle::handleMessage` `0x082402b0`, the field's only reader (`fmul [edx+0x1c4]` at `0x08240551`), on TemplateMessage **`0x14`** (critical damage, `Armor::status` `0x08173ad6`) and gated on `Armor::isSendingMessage()` (vtable `+0x94`, `0x081741c0`): `node+0xb0 = (q + 0.1)·0.05·sinkingSpeedMod` with `q = clamp((2R + Δz + Δx)/(4R), 0, 1)`, `R` the hull's bounding radius and `Δ` the node's offset from the hull centre. `updatePhysics` then does `sinkOffset += rate` every tick and wakes the hull. So a ship starts sinking at `criticalDamage`, not at death, and goes down by one end because `q` differs per node |
| SHIP-5 | (new) Buoyancy sees a wave surface | — | **refuted** | `PatchTerrain::getWaterLevel(float, float)` `0x083d7a80` is `return *(float*)(this+0x30)` — it discards `x` and `z` and returns the level's single `GeometryTemplate.waterLevel`. `WaterPatch::getWaterLevel(x,y,z)` `0x083d9700` does add `waterWave()` `0x083d98d0`, but nothing on the physics path calls it. Ships do not bob |
| SHIP-6 | A ship's helm has no engine law, so it must stay a passenger seat | [seats.js:186-196](../../tools/bf1942-models/viewer/seats.js#L186) | **refuted** | `c_ETShip = 9` sets bits 0 and 3 of `engineType`, so `PhysicsEngine::updatePhysics` `0x0824cbb0` runs the **same** thrust body an aircraft does (`rho`, the signed-square `K`, `getCurrentRatio()`, force at the engine node). Bit 3 adds the ship's own water rule, read at `0x0824cc89`/`0x0824d047`: screw **below** the waterline → thrust runs; screw **above** it and `|throttle| > 0.02` → thrust is skipped and the stored throttle is **pinned to 1.0**. A plane (bit 3 clear) gets the mirror: an engine below the waterline has its throttle **zeroed**. `setTorque` remains the sound (physics.md §5); ratio is `3.5·setDifferential/0.94`, so Fletcher 7.447 |
| SHIP-7 | (new) A submarine needs a bespoke dive law | — | **confirmed as the same law** | `GatoFloater`/`Sub7C_Floater` are the only vanilla `FloatingBundle`s with `maxRotation.y != 0`. `FloatingBundle::handleUpdate` `0x08240180` calls `RotationalBundle::calculateAndClipAngle(axis 1)` — gated on `maxRotation.y > 0`, `0x082401cd` — and writes `node+0xa0 = −angle[1]` (`+0x144 = +0x108 ^ 0x80000000`). That angle is SHIP-1's `t` term, so `angle_Y` from 0 to 50 walks the lift from `floatMaxLift 1.6275` down to `floatMinLift 0.8275`; at minLift `8·1·0.8275·1.49995 = 9.93 m/s² < 14.73`, and since `f` is clamped at −1 buoyancy can never cancel gravity — the boat sinks without limit. `setMinRotation 0/0/0` and the commented-out `setAutomaticReset` are why trim is one-directional and sticky. The angle is in degrees and is subtracted from a metre-valued depth; the `[0,1]` clamp hides it |
| SPAWN-1 | `teamOnVehicle` names the team whose `setObjectTemplate` entry the spawner uses, overriding the instance's `Object.setTeam` | [level.py:1309-1312](../../tools/bf1942-models/bf42/level.py#L1309), [level.py:1355-1356](../../tools/bf1942-models/bf42/level.py#L1355) | **refuted** | It is a **bool** in one byte — `ObjectSpawnerTemplate+0x185` (*client* `+0x249`), default 0 in both ctors (`0x08314a70`, *client* `FUN_00547c90`). Three proofs: `makeScript` `0x08314f70` prints the literal `"ObjectTemplate.teamOnVehicle 1"` (`0x086e15e0`) with no value `<<`; the console property registered at `0x082a8932` is `ConsoleClass437` (vptr `0x8736fa8`), whose `checkObjectRange(bool)` types it and whose `setArgFromString` `0x082e9780` parses with `std::istream::operator>>(bool&)`; and `ObjectSpawner::spawnObject` `0x083140a0` (*client* `FUN_00546f90`) only tests it against zero. Its whole effect is `pco->setTeam(spawner.mTeam)` (`IPlayerControlObject` iface `+0x6c`, `PlayerControlObject::setTeam` `0x0831a5f0` → `+0x170`, `++0x174`) — vehicle **ownership**, which is what `validateBFEntryPoint` reads. Survey of 18 installs: `1` ×11351, `0` ×21998, `2` ×242 (all modder cargo-cult, e.g. `mobileaaUSspawner`), `1z` ×1 |
| SPAWN-2 | (new) What selects the `setObjectTemplate <n>` entry | [level.py:1357-1359](../../tools/bf1942-models/bf42/level.py#L1357) | **confirmed** | The spawner's own live team, `ObjectSpawner+0x134` (*client* `+0x154`), used as the `std::map<uint, IObjectTemplate*>` key at the top of `spawnObject`. Seeded by the ctor `0x08312910` from `ObjectSpawnerTemplate+0x15c` = `ObjectTemplate.team` (default 0), and written **only** by `ObjectSpawner::setTeam(int)` `0x08313810`, whose three callers in the whole image are `ControlPoint::CPEnable` `0x082840e0`, `ControlPoint::CPDisable` `0x08284200`, and the instance console property's `executeObjectMethod` `0x082b5be0` — the path a level's `Object.setTeam` takes. A key with no map entry returns −1 and spawns **nothing**; our `vehicles[2] or vehicles[1]` fallback is a deliberate divergence |
| SPAWN-3 | (new) A spawned object's position | [extract_map.py:1856](../../tools/bf1942-models/extract_map.py#L1856) | **confirmed** | `spawnObject` places it at `spawner.getAbsolutePosition() + spawnOffset`, where `spawnOffset` is `ObjectSpawner+0x150/0x154/0x158` copied by the ctor from `ObjectSpawnerTemplate+0x174/0x178/0x17c`, default `0/0/0`. Rotation is `getRotation(spawner.getAbsoluteTransformation())`. No vanilla ship spawner authors `spawnOffset`, so ship position **is** spawner position |
| SPAWN-4 | Deck spawns can be baked at the spawner's authored pose | [extract_map.py:1856-1893](../../tools/bf1942-models/extract_map.py#L1856) | **refuted** | `BFSpawnPoint::spawn(IObject*, float)` `0x08163d70` is `soldier->setAbsolutePosition(this->getAbsolutePosition())` and nothing else — the spawn point is an ordinary composite child of the ship (`addTemplate <SpawnPoint>` + `setPosition`), so its world position is its ship-local offset through the hull's **live** transform at spawn time. A settling, moving or sinking ship carries its deck spawns; the soldier is not parented to it afterwards |
| SPAWN-5 | (new) When a deck spawn stops working | — | **confirmed** | `BFSpawnPoint::getActive(bool, int)` `0x08163dd0` returns 0 when the nearest `IID_IArmor` (`0xc4a4`) reports `isCriticalDamaged()` (Armor vtable `+0xcc`, `0x08174320`) — the same threshold that arms the sink (SHIP-4). Also gated on the object's active byte, the active combat area, a terrain-material veto via `GameServer` vtable `+0x2c0`, `BFfindEntryPoint(pos, 5.0 or 15.0, team)` when `setEnterOnSpawn`/`setAIEnterOnSpawn` are set, and an unnamed float at `BFSpawnPointTemplate+0x164` (ctor default **−1.0**, gate off) requiring `y − max(terrainHeight, waterLevel) >= value`. That field is printed by no `makeScript` branch and its `.con` name is **unverified** |
| SPAWN-6 | A soldier stands on a ship because the ship is in the static collision index | [collision.js:719](../../tools/bf1942-models/viewer/collision.js#L719), the prior round's note on Wake's fleet flags | **refuted** | A ship is a dynamic body, in neither manager list as a static. A soldier meets it through the ordinary contact path: the pair filter never skips it (one side is a mobile awake body), §5.3 makes **the soldier the vertex side at weight 1.0**, and §5.4 takes the faces from the ship's **col1** layer. The moving-platform carry is §8's friction solve on the share-scaled *relative* velocity, with no parent link. Mass share `2.5e6/(2.5e6+m)` > 0.95 snaps, so the soldier takes the whole correction. All three from [collision-response.md](subsystems/collision-response.md) §5.2–5.4 and §8, re-read not re-derived |
| SPAWN-7 | (new) A ship deck spawn's team | [extract_map.py:1881-1884](../../tools/bf1942-models/extract_map.py#L1881) | **confirmed** | It is the spawn **group**'s team, not the ship's or the spawner's. `Bf1942/Game/GlobalSpawnGroups.con`: 64/65 Yamato → 1, 66/67 PrinceOW → 2, 68/69 Fletcher → 2, 70/71 Hatsuzuki → 1, 72–74 Enterprise → 2, 75+ Shokaku → 1, with a level's own `spawnPointManagerSettings.con` taking precedence. Midway's Allied pad reading `team: 1` is purely a consequence of SPAWN-1 putting a Hatsuzuki on it; fixing the template fixes the spawn team with no separate change |

### Symbols to add

| address | name | subsystem | confidence |
|---|---|---|---|
| `0x0824d640` | `dice::ref2::world::PhysicsFloatingBundle::updatePhysics(float)` | physics | verified |
| `0x0824d580` | `dice::ref2::world::PhysicsFloatingBundle::PhysicsFloatingBundle(FloatingBundleTemplate const*, ICompositeObject const*)` | physics | verified |
| `0x0057e980` | *client* `PhysicsFloatingBundle::updatePhysics` (entry derived; no Ghidra function created) | physics | verified |
| `0x08240180` | `dice::ref2::world::FloatingBundle::handleUpdate(float, unsigned int)` | physics | verified |
| `0x082402b0` | `dice::ref2::world::FloatingBundle::handleMessage(TemplateMessage, IPlayer*)` — the sink arm | physics | verified |
| `0x08240880` | `dice::ref2::world::FloatingBundleTemplate::FloatingBundleTemplate()` — defaults 0.0/1.0/10.0/10.0/400.0/1.0 at `+0x1b0…+0x1c4` | physics | verified |
| `0x08240a50` | `dice::ref2::world::FloatingBundleTemplate::makeScript(IStream*)` — the field↔`.con` anchor | physics | verified |
| `0x08241090` | `dice::ref2::world::FloatingBundleTemplate::setPhysicsNodeComponent(ICompositeObject*)` — copies maxLift→`node+0xa4`, minLift→`node+0xa8` | physics | verified |
| `0x083d7a80` | `dice::ref2::geom::PatchTerrain::getWaterLevel(float, float) const` — ignores both arguments | geom | verified |
| `0x083d9700` | `dice::ref2::geom::WaterPatch::getWaterLevel(float, float, float) const` — the wave form, unused by physics | geom | verified |
| `0x08251f30` | `dice::ref2::world::BasicPhysicsSystem::getAirDensityZeroAtHeight()` (vtable `+0x24`) | physics | verified |
| `0x083140a0` | `dice::ref2::world::ObjectSpawner::spawnObject()` | spawn | verified |
| `0x00546f90` | *client* `ObjectSpawner::spawnObject` (`FUN_00546f90`) | spawn | verified |
| `0x08314a70` | `dice::ref2::world::ObjectSpawnerTemplate::ObjectSpawnerTemplate()` — `teamOnVehicle` `+0x185`, `holdObject` `+0x184`, `team` `+0x15c`, `spawnOffset` `+0x174` | spawn | verified |
| `0x00547c90` | *client* `ObjectSpawnerTemplate::ObjectSpawnerTemplate` (`FUN_00547c90`) — `teamOnVehicle` `+0x249`, `holdObject` `+0x248`, `team` `+0x220` | spawn | verified |
| `0x08314f70` | `dice::ref2::world::ObjectSpawnerTemplate::makeScript(IStream*)` | spawn | verified |
| `0x08313810` | `dice::ref2::world::ObjectSpawner::setTeam(int)` — the only writer of the template-selecting team | spawn | verified |
| `0x08312910` | `dice::ref2::world::ObjectSpawner::ObjectSpawner(ObjectSpawnerTemplate const*)` | spawn | verified |
| `0x082b5be0` | `ConsoleClass137::executeObjectMethod` — the spawner instance's `team` property, tail-calls `ObjectSpawner::setTeam` | console | verified |
| `0x082e9780` | `ConsoleClass437::setArgFromString` — `>> bool`, the `teamOnVehicle` parse | console | verified |
| `0x082e9880` | `ConsoleClass437::executeObjectMethod` — stores the byte into `getActiveTemplate(0x94a1)+0x185` | console | verified |
| `0x08163d70` | `dice::bf::BFSpawnPoint::spawn(IObject*, float)` | spawn | verified |
| `0x08163dd0` | `dice::bf::BFSpawnPoint::getActive(bool, int)` | spawn | verified |
| `0x08164130` | `dice::bf::BFSpawnPoint::getObjectToEnter(bool, int)` | spawn | verified |
| `0x0816a510` | `dice::bf::BFSpawnPointTemplate::BFSpawnPointTemplate()` — `+0x164` default −1.0, name unknown | spawn | verified |
| `0x08167f10` / `0x08167f50` | `BFSpawnPointManager::getObjectSpawner` / `addObjectSpawner` — an id→`ObjectSpawner*` registry only; no team logic | spawn | verified |
| `0x081741c0` | `dice::ref2::world::Armor::isSendingMessage()` (vtable `+0x94`) | hitpoints | verified |
| `0x08174320` | `dice::ref2::world::Armor::isCriticalDamaged()` (vtable `+0xcc`) | hitpoints | verified |
| `0x0873f078` | vptr of `PlayerControlObject`'s `IPlayerControlObject` sub-object (symbol `0x0873eec0` + `0x1b8`; offset-to-top −0x104): `+0x6c setTeam`, `+0x74 getTeam`, `+0x80 setTimeToLiveUnused`, `+0x84 setObjectSpawnerId`, `+0x8c setObjectSpawnerHolding` | seat | verified |
| `0x0000c4a4` | the `IID_IArmor` component id (no named global; `Armor::queryInterface` `0x08173ee0`, `SimpleObjectTemplate::setArmorComponent` `0x081ddae0`) | hitpoints | verified |

---

## 11. Scratch

Decompiles, the full `objdump` dump and the survey scripts are in
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/78a7d3df-ad46-4e60-a3e6-58ed1c628d1e/scratchpad/W6-E/`
(`d1`–`d4` per-function `.c`, `lnxded.asm`, `survey_float.py`, `survey_tov.py`,
`floaters.json`, `dump.py`, `dumplvl.py`). They are session-scoped; every claim
above carries the address that regenerates them.
