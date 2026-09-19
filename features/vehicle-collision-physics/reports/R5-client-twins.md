# R5-client-twins: the client's copy of collision response

Track goal: locate `BF1942.exe`'s (client) copies of the `ResponsePhysics`/
`ResponsePhysicsManager`/`PhysicsNode` collision-response code that lnxded's
symbols name, and establish what the client does differently. Bridge verified
(`./xref.py check` → sha256 MATCH, `60c945…cd3699`). All client addresses below
were cross-checked with `objdump` on `BF1942.exe` directly (PE32,
`.text` = 0x00401000–0x008c2b40) against lnxded's decompiles in `SP/decomp/`
and, for vtables, against `objdump` on `bf1942_lnxded.static`. I created Ghidra
functions at proven entry points only (`POST /create_function`); nothing else
in the project was mutated.

**Method note, since it drove everything below**: the client is MSVC-compiled
and stripped; lnxded is gcc and fully symbolled. Direct (non-virtual) calls
match by disassembling the call target. Virtual calls match by finding the
*vtable's own address* first — via the object's constructor (a
`mov dword ptr [eax], offset VTABLE` store, found either through a factory
string in `.rdata` like `"dice.ref2.world.ResponsePhysics.Basic"` or through a
`DATA` xref to a known method) — then reading the vtable's raw bytes with the
bridge's `/read_memory` (works for `.rdata`/`.text`; returns zeroed bytes for
uninitialized `.data`/`.bss` globals such as the singletons themselves, since
Ghidra has no running process). Once a vtable's base address is known, its
slot layout lines up 1:1 with `vt.py`'s lnxded dump (no GCC RTTI header on the
client, confirmed already by ARM-4 for `Armor`) — so `+0x1c` in one binary is
`+0x1c` in the other.

## 1. Findings

### 1.1 `ResponsePhysicsManager::update(float,IObject*)` is at vtable **+0x14**, not +0x1c — corrects the existing corpus

**verified.** `symbols.json`'s notes on `responsePhysicsManager` (`0x0097d75c`)
and on `GameClient__simulateFrame` (`0x004b6cb0`) both say the two calls
bracketing `Game::updateWorldCollision` in `simulateFrame` are to `update` at
vtable **+0x1c**. That is the address of the *call site*, but the wrong name.
Dumping the lnxded vtable directly (`vt.py 0x872e2e0`) shows:

```
+0x00c addObject            +0x010 removeObject
+0x014 update(float,IObject*)      <- 0825d0b0
+0x018 reset()                     <- 0825e1a0 (increments collisionCheckedCounter)
+0x01c resetCachedCollisionObjects()  <- 0825e190 (sets byte[this+0x1c]=1, nothing else)
```

`objdump` on lnxded's `GameServer::simulateFrame` (`0x0815c2a0`) confirms the
two calls at `0x815c335`/`0x815c351` really are `call *0x1c(%edx)` —
**`resetCachedCollisionObjects()`**, a two-instruction stub, called before and
after `Game::updateWorldCollision`, not the collision sweep. The real sweep is
one level down: `Game::updateWorldCollision` (`0x0805da00`) does
`responsePhysicsManager->reset()` (+0x18) then
`responsePhysicsManager->update(dt, NULL)` (**+0x14**, obj = NULL — confirmed
by the three pushed words `push $0; push ecx(dt); push eax(this)`).

The client is **byte-for-byte identical** in this structure:
`GameClient::simulateFrame` (`0x004b6cb0`) calls `DAT_0097d75c+0x1c` twice,
bracketing `FUN_0040bdc0`. Disassembling `FUN_0040bdc0`:

```
0040bdc0: mov ecx,[0x97d764]; call [ecx+0x6c]         ; objectManager, same as lnxded
0040bdcb: mov ecx,[0x97d75c]; call [ecx+0x18]          ; reset()
0040bdd6: mov ecx,[0x97d75c]; mov edx,[esp+4]
          push 0; push edx; call [eax+0x14]            ; update(dt, obj=0)
```

Client `Game::updateWorldCollision = 0x0040bdc0` (**verified**, already an
inferred symbol — now confirmed instruction-for-instruction). Client
`ResponsePhysicsManager::update = 0x00579fa0`, `reset() = 0x00579480`,
`resetCachedCollisionObjects() = 0x00579470` (**verified**: `reset()` does
`incl [0x959344]` — the client's `collisionCheckedCounter` twin, matching
lnxded's `incl 0x872e2d8` exactly; `resetCachedCollisionObjects()` does
`movb [ecx+0x1c],1; ret`, matching lnxded's `movb [eax+0x1c],1; ret`).

Client `ResponsePhysicsManager` vtable = **0x008fdce4** (found via its
constructor, reached from the factory chain
`"dice.ref2.world.ResponsePhysicsManager.Basic"` string `0x008f628c` →
registration site `0x00535f30` → allocator (32 bytes) → ctor `0x00579490`,
which writes vtable ptr `0x008fdce4` and zeroes fields `+0x8..+0x18`, matching
lnxded's flat/root list fields).

### 1.2 `ResponsePhysics` — full vtable located and matched slot-for-slot

Client `ResponsePhysics` vtable = **0x008fd770**, found the same way: factory
string `"dice.ref2.world.ResponsePhysics.Basic"` (`0x008f62bc`) → registration
`0x00535ee0` → pooled allocator (**228 bytes**, `0xe4`, matching lnxded's
`ResponsePhysics` size) → ctor `0x00574970`, which writes vtable ptr
`0x008fd770` and zeroes the same field layout the briefing already lists
(`+0xa8`=1.0, `+0xb4`/`+0xb5` grip bytes, etc. — **verified**, byte-identical
to the lnxded field offsets).

Reading the vtable (`/read_memory`) and lining it up against lnxded's
(`vt.py 0x872e240`) gives an exact, **verified** 1:1 match for every slot this
track needed:

| slot | method | lnxded | client |
|---|---|---|---|
| +0x18 | impulseOn | 0x08258900 | 0x00574bb0 |
| +0x1c | solveImpulse | 0x08258d30 | 0x005765d0 |
| +0x20 | addFriction | 0x0825b6e0 | 0x00576c50 |
| +0x24 | checkVsTerrain | 0x0825a960 | 0x00575cd0 |
| +0x60 | checkObjectVsObject | 0x08259690 | 0x00574e30 |
| +0x6c | getPermanentGrip | 0x0825ce40 | 0x00574b40 |
| +0x7c | getPositionalAdjusts | 0x0825ce80 | 0x00574b60 |
| +0x80 | getRootResponse | 0x08259640 | 0x00577c30 |

`ResponsePhysicsManager::checkObjectVsObjects` (lnxded `0x0825d820`, no
vtable slot — a plain member function) was matched by a different route:
inside `update`'s single-object branch (obj != NULL — see §1.5), lnxded calls
it directly (`call 825d820`) right after a `getHasSeparatePhysicsUpdate`
(+0xbc) check. The client's `update` (`0x00579fa0`) has the identical shape at
the identical point (`isSleeping` +0xcc check, then a direct **non-virtual**
`call 0x579820`) → client `checkObjectVsObjects = 0x00579820` (**verified** by
structural position; not independently diffed for constants, it is ~2.9 KB).

### 1.3 Constants: I found no arithmetic differences anywhere I could check

Every constant this track's anchor list named was present, at the **same
value**, in the matched client function — read from `.rdata` with
`/read_memory`, not trusted from a decompiler literal:

- **`addFriction` call site** (inside `update`'s single-object tail, both
  binaries): push order `0, 0, 0x40000000, 0x3ee66666, 0x3f666666, 0x3ee66666`
  — i.e. `addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)` — **identical bytes**
  at lnxded `0x825d11d..0x825d137` and client `0x57a01b..0x57a036`.
- **`checkObjectVsObject`** (client `0x00574e30`): scanned every float
  literal the function touches → `0.01` (`0x8c409c`, = 0.1², the relative
  speed² gate), `0.1` (`0x8c53cc`), `4.0` (`0x8d8f34`, LOD-radius threshold),
  `0.9` (`0x8d6470`), `0.65` (`0x8fd1f0`), `1.0` (`0x8c53c8`), `0.05`
  (`0x8dbe14`), `0.95` (`0x8fd7f4`) — every value the briefing's anchor list
  named, present and correct (0.95/0.05 mass-share snap, 0.9/0.65 soldier
  constants, 4.0 LOD radius, 0.1² relative-speed-squared gate).
- **`solveImpulse`** (client `0x005765d0`): `30.0` (`0x957640` — the same
  `g_simulationFps` global already known from `physics.md`), `0.5`
  (`0x8c4220`), `10.0`/`-10.0` (`0x8dbe18`/`0x8fd82c`) — matches
  `speedAdjust*30*(1+elasticity)*0.5` and the ±10° projectile clamp exactly.
- **`getGeometryInertia`** (client `0x0053fc30`): the 1/3 constant at
  `0x008dbe40` reads exactly `0.3333333432674408` (`0x3eaaaaab`) — used three
  times, once per axis, identical to lnxded's `0x08253930`.
- **`updateRotationalPhysics`** (client `0x005403b0`, decompiled): torque
  clamp literals `1e+06` and `1000.0` appear verbatim, matching lnxded's
  `082539e0` (`if (t² > 1e6) t *= 1000/|t|`).
- **`getHasSeparatePhysicsUpdate`/`setHasSeparatePhysicsUpdate`**: both read
  and write the **same byte offset, `+0x90`**, on both binaries (disassembled
  both sides; see §1.5).

**One structural (not behavioural) difference, found and resolved**: lnxded's
`impulseOn` calls the scalar `setAdjust(float&, float)` (`0x0825cec0`) **six**
times directly — once per axis, for two Vec3s (speed adjust, positional
adjust). The client's `impulseOn` (`0x00574bb0`) instead calls an unnamed
Vec3-level wrapper, **`0x00574810`**, only **twice** (once per Vec3). Inside
that wrapper, `0x00574810` calls a per-axis scalar helper, **`0x005745b0`**,
three times — and `0x005745b0`'s own logic (compare current value and new
value against 0.0 at `0x008c41ac`, same sign → keep, use `fcomps`; magnitude
comparison via the flags idiom the briefing warns about; opposite sign → `fadd`
then store) is the **same same-sign/opposite-sign rule** as lnxded's
`setAdjust`, just MSVC folded the 3-axis loop into one small function that
gcc's build apparently didn't factor out (or the source always had a
`setAdjust(Vec3&, Vec3 const&)` overload that gcc inlined and MSVC didn't —
either way the arithmetic is identical). **`setAdjust` (client) = 0x005745b0**,
confidence **verified**.

**Conclusion for Q1: the client runs the exact same arithmetic as the server
— predicted locally, not merely mirrored.** I checked every constant the
track's anchor list called out and found zero differences; the only
difference is cosmetic code shape (one helper split into two), not behaviour.

### 1.4 `PhysicsNode` — vtable and the rotational-physics chain

Client `PhysicsNode` vtable = **0x008f7218**, found from the single `DATA`
xref to the already-known `updatePhysics` (`0x00540920`, which lands at
vtable+0x90). Slot-for-slot match against lnxded's `vt.py PhysicsNode`
(`0x872df00`) gives, all **verified** by address + matching field offset:

| slot | method | lnxded | client |
|---|---|---|---|
| +0x68 | addAccelerationAtAbsolutePosition | 0x08255110 | 0x00540220 |
| +0x74 | getTangentSpeed | 0x08254b90 | 0x0053fe20 |
| +0xa0 | getMass | 0x0824d2e0 | 0x005fc3c0 |
| +0xb0 | getInertiaModifier | 0x0824d350 | 0x00653c00 |
| **+0xb8** | **setHasSeparatePhysicsUpdate(bool)** | 0x0824d3f0 | **0x0053f470** |
| **+0xbc** | **getHasSeparatePhysicsUpdate()** | 0x0824d410 | **0x0053f480** |
| +0xcc | isSleeping | 0x0824d480 | 0x0053f490 |
| +0xd4 | setIsAwake | 0x08255330 | 0x0053f4a0 |

`getHasSeparatePhysicsUpdate`/`setHasSeparatePhysicsUpdate` are
**byte-identical** on both sides: lnxded reads/writes `[this+0x90]`
(`824d417: mov al,[eax+0x90]`); client does the same
(`53f474: mov [ecx+0x90],al` / `53f480: mov al,[param_1+0x90]`).

`updatePhysics` (client `0x00540920`, decompiled) matches physics.md's
documented "Advanced/box" drag shape exactly (mass-zero debug string,
`0.785`≈π/4 area terms, the two drag calls `0x0053f5f0`/`0x0053f7c0` already
known), then calls, **in this order**: `FUN_0053f940(dt)` then
`FUN_005403b0(dt)`. lnxded's twin (`0x082543d0`, tail already read) calls
`updatePositionalPhysics` then `updateRotationalPhysics` in that same order —
so:

- **`PhysicsNode::updatePositionalPhysics`** — lnxded `0x08253570` → client
  **`0x0053f940`** (verified by call order + surrounding structure).
- **`PhysicsNode::updateRotationalPhysics`** — lnxded `0x082539e0` → client
  **`0x005403b0`** (verified; torque-clamp constants match exactly, see §1.3;
  calls `FUN_0053fc30` for inertia).
- **`getGeometryInertia`** — lnxded `0x08253930` → client **`0x0053fc30`**
  (verified; `1/3` constant identical, same 4-arg thiscall shape: `this`=
  geometry in `ecx`, three output floats via `edx`+stack, box-extent
  differences squared and summed pairwise).

### 1.5 `hasSeparatePhysicsUpdate` gates an *occupancy* switch, not a locality switch — and the single-object `update(dt,obj)` mode is real, live code

This directly answers Q3. Tracing lnxded's virtual-call table for slot +0xb8
(`setHasSeparatePhysicsUpdate`) across the whole `.text` (40 call sites, all
`call *0xb8(%eax/%edx)`) and resolving each caller to its enclosing symbol
turns up exactly two families:

- **`dice::bf::disablePhysics(IPlayerObject*, bool)`** (`0x08147730`) calls
  `physicsNode->setHasSeparatePhysicsUpdate(true)` (`push $0x1`); its mirror
  **`dice::bf::reenablePhysics(IPlayerObject*, bool)`** (`0x08147680`) calls
  it with `false`. Both are called from **`GameServer::enterVehicle`**
  (`disablePhysics` at `0x814e91d`) and **`GameServer::exitVehicle`**
  (`reenablePhysics` at `0x814e84e`, plus a second `disablePhysics` call at
  `0x814e6ee`). So the flag flips on **entering/leaving a vehicle**, not on
  ownership or network locality.
- The `BCompositeObject<...>::setAbsolutePosition/setAbsoluteTransformation/
  setRelativePosition/setRelativeTransformation` family also call
  `setHasSeparatePhysicsUpdate` (bit-tested against object flags, not
  literal true/false) — a second, more general trigger tied to how an
  object's transform is being driven.

Inside `ResponsePhysicsManager::update`'s all-objects branch (`obj == NULL`),
an object is skipped from `checkObjectVsObjects`/`checkVsTerrain` exactly when
`physicsNode->getHasSeparatePhysicsUpdate()` is true (read at `825d148`ff.,
confirming the briefing's existing item 1). **This does not mean the object
stops being collision-checked** — it means it is checked through a *different,
dedicated call* instead of the generic sweep:

`GameServer::simulatePlayerCollisions(BFPlayer*, float)` (`0x0815c0a0`) reads
the player's vehicle (`getVehicle`, vtable+0x3c) and, if the player's "has a
vehicle" flag (`+0x14b`) is set, **tail-calls**
`dice::bf::performMobileCollisionUpdate(float, IPlayerObject*, bool)`
(`0x08147580`), which itself calls
`responsePhysicsManager->update(dt, thatVehicle)` — the **single-object**
branch (`obj != NULL`) — at `0x8147662..0x814766c`
(`push 0; push vehicle; push this; call *0x14(%edx)`). This is called once
per player, from a per-player loop inside `GameServer::simulatePlayersCollisions`
(`update`'s single-object branch is therefore *not* dead code — it runs once
per occupied vehicle, per tick).

**The client runs this identically.** `FUN_004b788a`'s enclosing function,
**client `0x004b7870`**, is byte-for-byte the same shape:

```
4b7874: mov eax,[esi+0x64]        ; esi = player; +0x64 = vehicle pointer
4b7877: test eax,eax ; je skip
4b7882: mov eax,[esi+0x4]
4b7885: test ah,0x2  ; je skip     ; "has vehicle" flag test
4b788a: mov ecx,[0x97d75c]        ; responsePhysicsManager
4b7890: mov eax,[ecx]
4b7892: push esi ; push edi(dt)
4b7894: call [eax+0x14]           ; update(dt, vehicle) -- single-object mode
```

This is called from the client's per-player loop (`FUN_004b68c0`,
`simulatePlayersCollisions`, already named in the existing `physics.md`
GameClient::simulateFrame note) — which runs for **every player in the
session, with no local/remote branch anywhere in this chain**. Client
`performMobileCollisionUpdate`/`simulatePlayerCollisions`-equivalent =
**0x004b7870** (**verified**, instruction-for-instruction match against
lnxded's `0x0815c0a0`→`0x08147580` chain).

**Answer to Q3: remote vehicles are simulated bodies, not interpolated
ghosts, for collision purposes, on the client — identically to local ones.**
Every registered object gets exactly one `ResponsePhysicsManager::update`
pass per tick: unoccupied objects (including remote players' unoccupied
vehicles, static scenery, soldiers) through the manager-wide sweep
(`Game::updateWorldCollision`, `obj=NULL`); every occupied vehicle — whichever
player is driving it, local or remote — through the per-player targeted call
(`obj=thatVehicle`). `hasSeparatePhysicsUpdate` only routes an object between
these two paths so it is never double-processed in one tick; it is not a
network-authority or prediction gate, and I found no `isLocal`-style branch
anywhere in `simulateFrame`, `updateWorldCollision`, or the per-player
collision loop on either binary. I did not locate the *client's own*
`enterVehicle`/`exitVehicle` (the analog of the `disablePhysics`/
`reenablePhysics` callers) in the time available — flagged open below — but
since both call sites that matter for Q3 (the manager sweep and the per-player
loop) are demonstrably locality-blind on the client, this does not change the
answer.

### 1.6 Damage arithmetic: client does not compute it (Q2) — strong but not fully closed

I could not locate the client's `SimpleObject::handleCollision` (lnxded
`0x081dab40`) or `Game`/`GameClient::handleCollision` override despite several
approaches (constant-pattern search on the `0xc4a4` `getComponent(Armor)`
argument pair — 44 call sites in the client, none matched the 6-argument
`handleCollision` shape with an adjacent `Armor::collision()`/
`setLastCollisionHeight` pair within a tight window; the two candidates that
did contain both calls turned out to be unrelated, larger functions —
`makeScript`-style property dumps and an AI/proximity check). This stays
**open**.

What I *did* establish, extending ARM-4's existing finding (`Armor::damage`
has a single `DATA` xref — its own vtable slot, no code caller) to the rest of
the damage-formula chain, using the now-fully-read client `Armor` vtable
(`0x008dc7a8`, **verified**, read via `/read_memory`):

| slot | method | client addr | code-level (non-vtable) xrefs found |
|---|---|---|---|
| +0x20 | damage | 0x004bbfe0 | **0** (matches existing ARM-4 finding) |
| +0x3c | getDamageMod | 0x004bb800 | **0** |
| +0x4c | getSpeedMod | 0x005ad100 | **0** |
| +0xe8 | collision() | 0x004bba20 | **0** |
| +0xf8 | setLastCollisionHeight | 0x0072fc10 | 2 (unrelated: a lazy height-cache getter, `0x005f3740`) |
| +0x120 | addColObject | 0x004bbde0 | **0** |
| +0x12c | isInColList | 0x004bbe80 | **0** |
| +0x44 | **getAngleMod** | 0x004bb820 | **1** direct call, `FUN_00580d30` |

The one live caller of `getAngleMod`, `FUN_00580d30`, reads the value **once**
into `[this+0x3c]` and then loops over an unrelated collection copying floats
into a small buffer with bounds-checked inserts (`FUN_00831640`, a
vector-`push_back` shape) — it looks like a debug/HUD panel sampling the
coefficient for display, not a damage computation: there is no accompanying
`getSpeedMod`/`getDamageMod`/`getDamageForMaterial` chain, no `|speed|²` term,
no `sin`/π-2 blend, no `giveDamage`-shaped dispatch nearby.

**Caveat**: because this project's Ghidra analysis has essentially no
resolved xrefs through *virtual* calls (confirmed directly: even
`Armor::collision()`, which the server's `SimpleObject::handleCollision`
unconditionally calls, shows zero call-site xrefs on the client — only its own
vtable-slot `DATA` reference), "zero xrefs found" is suggestive, not proof of
"never called." `Game::playCollisionEffect` (`0x0040e590`, already verified
identical to lnxded) *is* a live, used client function, so *something* on the
client dispatches into a handleCollision-shaped chain for effects/sound; I
just could not pin down its address. Combined with the fall-damage precedent
(HP-6, client does not compute fall damage locally) and the complete absence
of a second, independent occurrence of the damage-formula's constant/call
shape (`getAngleMod`+`getSpeedMod`+`getDamageMod`+`getDamageForMaterial`
multiplied together, gated `>1.0`, feeding `giveDamage`) anywhere else in
`.text`, my answer is: **the client's `handleCollision` almost certainly
still runs effects and sound (confirmed) and touches `Armor::collision()`
for the smoke/fire-tier bookkeeping ARM-1 already established runs on the
client's own 30 Hz tick, but does not compute or apply a damage number itself
— HP stays server-authoritative for object-vs-object collisions exactly as it
does for falls.** Confidence: **inferred**, not verified — the exact client
`handleCollision` address is the best next lead (see §4).

## 2. Symbol table (this track's findings only)

| address | name | note |
|---|---|---|
| 0x00579fa0 | `ResponsePhysicsManager::update(float,IObject*)` [client] | vtable+0x14; twin of lnxded 0x0825d0b0 |
| 0x00579820 | `ResponsePhysicsManager::checkObjectVsObjects` [client] | direct call from `update`; twin of 0x0825d820 |
| 0x00579480 | `ResponsePhysicsManager::reset()` [client] | vtable+0x18; twin of 0x0825e1a0 |
| 0x00579470 | `ResponsePhysicsManager::resetCachedCollisionObjects()` [client] | vtable+0x1c; twin of 0x0825e190 |
| 0x00579490 | `ResponsePhysicsManager::ResponsePhysicsManager()` [client] ctor | writes vtable 0x008fdce4 |
| 0x008fdce4 | vtable for `ResponsePhysicsManager` [client] | 33-byte object, 32-byte alloc |
| 0x00535f30 | `createResponsePhysicsManagerBasic` factory [client] | reached via `"...ResponsePhysicsManager.Basic"` string 0x008f628c |
| 0x00574bb0 | `ResponsePhysics::impulseOn` [client] | vtable+0x18; twin of 0x08258900 |
| 0x005765d0 | `ResponsePhysics::solveImpulse` [client] | vtable+0x1c; twin of 0x08258d30 |
| 0x00576c50 | `ResponsePhysics::addFriction` [client] | vtable+0x20; twin of 0x0825b6e0 |
| 0x00575cd0 | `ResponsePhysics::checkVsTerrain` [client] | vtable+0x24; twin of 0x0825a960 |
| 0x00574e30 | `ResponsePhysics::checkObjectVsObject` [client] | vtable+0x60; twin of 0x08259690 |
| 0x00574b40 | `ResponsePhysics::getPermanentGrip` [client] | vtable+0x6c; twin of 0x0825ce40 |
| 0x00574b60 | `ResponsePhysics::getPositionalAdjusts` [client] | vtable+0x7c; twin of 0x0825ce80 |
| 0x00577c30 | `ResponsePhysics::getRootResponse` [client] | vtable+0x80; twin of 0x08259640 |
| 0x00574970 | `ResponsePhysics::ResponsePhysics()` [client] ctor | writes vtable 0x008fd770, 228-byte alloc |
| 0x008fd770 | vtable for `ResponsePhysics` [client] | matches lnxded 0x0872e240 slot-for-slot |
| 0x00535ee0 | `createResponsePhysicsBasic` factory [client] | reached via `"...ResponsePhysics.Basic"` string 0x008f62bc |
| 0x00574810 | `ResponsePhysics` Vec3-level adjust merge [client] | wraps setAdjust x3; no lnxded twin (inlined there) |
| 0x005745b0 | `setAdjust(float&,float)` [client] | twin of 0x0825cec0; same-sign/opposite-sign rule verified |
| 0x008f7218 | vtable for `PhysicsNode` [client] | matches lnxded 0x0872df00 slot-for-slot |
| 0x00540220 | `PhysicsNode::addAccelerationAtAbsolutePosition` [client] | vtable+0x68; twin of 0x08255110 |
| 0x0053fe20 | `PhysicsNode::getTangentSpeed` [client] | vtable+0x74; twin of 0x08254b90 |
| 0x0053f470 | `PhysicsNode::setHasSeparatePhysicsUpdate(bool)` [client] | vtable+0xb8; twin of 0x0824d3f0; writes byte+0x90 |
| 0x0053f480 | `PhysicsNode::getHasSeparatePhysicsUpdate()` [client] | vtable+0xbc; twin of 0x0824d410; reads byte+0x90 |
| 0x0053f940 | `PhysicsNode::updatePositionalPhysics` [client] | twin of 0x08253570 |
| 0x005403b0 | `PhysicsNode::updateRotationalPhysics` [client] | twin of 0x082539e0; torque clamp 1e6/1000.0 confirmed |
| 0x0053fc30 | `getGeometryInertia` [client] | twin of 0x08253930; 1/3 constant confirmed |
| 0x0040bdc0 | `Game::updateWorldCollision` [client] | twin of 0x0805da00; already inferred, now instruction-verified |
| 0x004b7870 | `GameClient` per-player mobile collision update [client] | twin of lnxded `GameServer::simulatePlayerCollisions` (0x0815c0a0) → `performMobileCollisionUpdate` (0x08147580) chain |
| 0x004bb800 | `Armor::getDamageMod` [client] | vtable+0x3c; 0 code-level xrefs |
| 0x004bb820 | `Armor::getAngleMod` [client] | vtable+0x44; 1 code-level xref (`0x00580d30`, looks cosmetic) |
| 0x005ad100 | `Armor::getSpeedMod` [client] | vtable+0x4c; 0 code-level xrefs |
| 0x004bbde0 | `Armor::addColObject` [client] | vtable+0x120; 0 code-level xrefs |
| 0x004bbe80 | `Armor::isInColList` [client] | vtable+0x12c; 0 code-level xrefs |

## 3. Corrections to the briefing / existing corpus

1. **`responsePhysicsManager` vtable +0x1c is `resetCachedCollisionObjects()`,
   not `update`.** `symbols.json`'s notes on `0x0097d75c` and on
   `GameClient__simulateFrame` both mislabel the two bracketing calls in
   `simulateFrame` as calls to `update`. They are correct about the call
   *sites* (`0x815c335`/`0x815c351` lnxded, the two `DAT_0097d75c+0x1c` calls
   client-side) but wrong about what runs there. The real `update(dt,obj)` is
   at vtable **+0x14**, called once per tick from `Game::updateWorldCollision`
   with `obj=NULL`, plus once per occupied vehicle per tick with a specific
   `obj` (§1.5). This should be fixed in `symbols.json` and in
   `subsystems/physics.md` if it's touched again.
2. Briefing item 1 (§4) is otherwise accurate about `update`'s internal
   4-loop structure (confirmed against the client instruction-for-instruction)
   — only the "called twice per tick" framing needed correcting to "the
   manager-wide sweep runs once per tick; a second, *different*, per-object
   call pattern exists and is live, not the same call repeated."
3. ARM-4's client Armor CID note (`0xc4a5`) is about `Armor::getClassID()`'s
   own registration value, found at one site (`0x0049cc9c`,
   `movl $0xc4a5,...`). The **interface query id** used everywhere Armor is
   actually looked up (`getComponent(0xc4a4, 0xc4a4)`) is **0xc4a4**, same as
   lnxded — I found 44 matching call-site pairs. This doesn't contradict
   ARM-4, just clarifies which of the two numbers is which (worth a one-line
   addition to the ARM-4 ledger row if anyone revisits it).

## 4. Still open / best next leads

- **Client `SimpleObject::handleCollision` and `Game`/`GameClient::handleCollision`
  override**: not located. Best next lead: find the client's
  `PlayerControlObject` vtable (the way `ResponsePhysics`'s was found — via a
  factory string or a `DATA` xref to a known method like `getSubPos`) and read
  its own +0x58 slot; lnxded's `PlayerControlObject::handleCollision`
  (`0x08318b00`) tail-calls `SimpleObject::handleCollision` directly
  (`call 81dab40`) for the common case, which would resolve both addresses at
  once by the same direct-call trick used for `checkObjectVsObjects` in §1.2.
- **Client `enterVehicle`/`exitVehicle`** (the `disablePhysics`/
  `reenablePhysics` callers): not located. Would close the very last piece of
  Q3 (confirming the occupancy gate flips identically for a remote player's
  vehicle on the client, not just that the two collision-update call sites
  are locality-blind).
- **`handleCollisionObjectVsObject`'s exact damage formula** (angleMod +
  (1-angleMod)·sin(...)·π/2, speedMod, `|speed|²`) was not found duplicated
  anywhere in client `.text` — consistent with §1.6's answer but not a proof
  of absence given the virtual-call-xref blind spot noted there.
- `checkVsTerrain` (client `0x00575cd0`) and `getPermanentGrip`/
  `getPositionalAdjusts`/`getRootResponse` were matched by vtable slot only,
  not independently diffed for constants — low-risk (their lnxded twins are
  short) but not literally checked.

## 5. Implementation notes for the JS re-implementation

- **The manager-wide sweep and the per-vehicle sweep are both real and both
  need porting.** A viewer only needs the *effect* (every physics-registered
  body gets exactly one broad-phase-then-narrow-phase-then-solve pass per
  30 Hz tick), so a single "process every dynamic body once per tick" loop is
  behaviourally sufficient — you do not need to reproduce the
  occupied/unoccupied routing split, only its outcome.
- **No client/server or local/remote special-casing exists in this
  subsystem.** A browser viewer replaying a demo, or predicting a remote
  player's vehicle, should run the identical collision-response step for
  every vehicle without a "is this mine" branch — that's what the retail
  client does.
- **Every constant in `SP/decomp/*.c` for this track's functions can be
  trusted as the client's too** (§1.3) — no per-platform tuning table is
  needed for `addFriction`/`checkObjectVsObject`/`solveImpulse`/
  `getGeometryInertia`/`updateRotationalPhysics`.
- **Damage should stay server-only in a viewer's local-prediction path**
  (§1.6): compute HP changes from the authoritative source only; local
  collision physics (position/velocity response, effects, sound) can run
  fully client-side/predicted with no risk of double-applying damage,
  because retail's own client apparently never applies it either.
