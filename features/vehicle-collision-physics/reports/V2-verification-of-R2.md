# V2: adversarial verification of R2-integrator

Verifier V2, round 2026-09-19. Binary `bf1942_lnxded.static`; every address is lnxded. Method: objdump for every
order / gate / comparison claim, vtables through `SP/vt.py` (vptr = symbol + 8), a private Ghidra copy
(`SP/v2-proj`, decompiles in `SP/v2-decomp/`), whole-binary call-site scans on `SP/r2/r2-full.asm`, and two extra
Unicorn runs (`SP/v2-emu-extra.py`). Scratch asm: `SP/v2-simframe.asm`, `v2-simplayers.asm`, `v2-perform.asm`,
`v2-rpm.asm`, `v2-addfric.asm`, `v2-upd.asm`.

Verdict words: CONFIRMED / CORRECTED / REFUTED / NOT VERIFIED.

## Headline

R2 is sound where it matters for a rammed parked vehicle. Tick order, children-before-root, the sleep machinery,
both wakers, and the two-tick sequence all hold in objdump. **One claim is refuted** (a vehicle whose player
"delivered no input" is skipped - it is not; an empty action buffer is stepped with an all-zero input) and **one
evidence statement is wrong** (there IS an `ObjectTemplate.centerOfMassOffset` console word; the conclusion
"COM = 0 for every vehicle" survives only because no shipped `.con` uses it). Several gates were omitted.

---------------------------------------------------------------------------------------

## 0. The emulation harness (F3-F8) - CONFIRMED, with a coverage note

- Ran `r2_node_test.py` (worst abs err 6.5e-06 over 40 ticks, tangent speed matches) and `r2_node_test2.py`
  (A-G all agree with the model). Both pass.
- It executes the binary, not a re-implementation: `r2_emu.py` maps the ELF PT_LOAD segments and `emu_start`s at
  `0x082543d0`, `0x08255110`, `0x08254e50`, `0x08254c70`, `0x08254b90`, ctor `0x08252b70`. Only the composite
  object / template / geometry vtables are hand-written stubs, plus `finite@plt` `0x0804b3d4` (a 5-instruction
  exponent test; harmless).
- Vectors do hit the clamps: A acc 5000 -> 1000, B friction 300 dropped / 240 kept, C rot-friction 405 (Z-axis
  quirk), D fallback branch, E sleep countdown + wake at acc 1.6 but not 1.0, F soldier, G sleepiness -1.
- Not exercised by R2: the `|racc|^2 > 1e6` clamp and the fallback `|dw|^2 > 1e6` guard. I added the first
  (`v2-emu-extra.py` test H, |racc| = 2775): model and machine code agree to 3.9e-07. The fallback guard stays
  unexercised (dead branch anyway, flag 0x4000000 is never set).

---------------------------------------------------------------------------------------

## 1. F11 tick order, `GameServer::simulateFrame` 0x0815c2a0 - CONFIRMED, three omissions

Call sequence read in objdump, globals from the symbol table (`0x870d918` game, `0x871dc24` objectManager,
`0x871dc18` physicsNodeManager, `0x871dc1c` responsePhysicsManager, `0x871dc2c` playerManager):

| # | address | call | resolved |
|---|---|---|---|
| 0 | 815c2b1 / 815c2b7 `dec; je` | game `+0x74` getGameStatus == 1 -> 815c453 | `updateAI(dt)` 0x0813a3f0 |
| 1 | 815c2c8 | direct | `simulatePlayersUpdate` 0x0815bfa0 |
| - | 815c2d7..e0 | getGameStatus == 4 -> 815c433 | **omitted by R2**: `objectManager->destroyObjects()` (+0x60) then jump to 815c37d, skipping steps 2-6 and the death cameras; `updateGameLogic` / `updatePortals` are also status != 4. Status 4 freezes the world. |
| 2 | 815c2f1, 815c304 | objectManager `+0x1c`, `+0x14`(dt, 0, 3) | `updateTweakingObjects` 0x0819c060, `updateObjects` 0x0819be10 |
| 3 | 815c312 | direct | `simulatePlayersPhysics` 0x0815c0f0 |
| 4 | 815c327 | physicsNodeManager `+0x14`(dt, 0, 0) | `PhysicsNodeManager::update` 0x08255740 |
| 5 | 815c335, 815c342 | rpm `+0x1c`; direct | `resetCachedCollisionObjects` 0x0825e190 (byte +0x1c = 1); `Game::updateWorldCollision` 0x0805da00 = objectManager `+0x6c` updateObjectsInGrid, rpm `+0x18` reset (`inc 0x872e2d8`), rpm `+0x14`(dt, 0) |
| 6 | 815c351, 815c35e | rpm `+0x1c`; direct | `simulatePlayersCollisions` 0x0815c140 |
| 7 | 815c36d.., 815c39d, 815c3c5, 815c3d0 | playerManager `+0x2c` getPlayers, death cameras, `updateGameLogic`, `updatePortals`, `++this[+0x1b4]` | |

Integration (3, 4) precedes every contact step (5, 6): CONFIRMED. `updateObjects` (v2-decomp/0819be10.c) calls
`handleUpdate` (+0x54) on map entries with `!(flags & 1)` and `getUpdateFrequencyType()` (+0x64) == 0: CONFIRMED.

The three walkers:

- `performHandleUpdate(dt, obj, uint, bool)` 0x08147300: **gate omitted by R2** - `testb $0x10,0x5(obj)` (8147310):
  `handleUpdate` (+0x54) runs only when object flag `0x1000` is set. **Also omitted**: when the object's template
  class is 0xc4c2 it does `queryInterface(0xc4c5)->vtbl[+0x10]()` and, if that object's class is 0x9493, calls its
  `handleUpdate` too (81473fb-8147460): a PCO forwards the update to its occupant soldier. Children: first
  `obj->getChild()` (+0x7c), next sibling `+0x54`, each through `queryInterface(0xc378)`; skipped if `flags & 1`,
  or (bool false) template class 0xc4c2 / 0x9493 (constants `0x86d3c44`, `0x86c2b88`). CONFIRMED otherwise.
- `performMobilePhysicsUpdate(dt, obj, bool)` 0x08147470: **gate omitted** - `node(+0x60)->getIsMobile()` (+0xe0,
  8147488); false returns without recursing. Then children first (same skip rules, recursion 8147534), then
  `physicsNodeManager->update(dt, 0, ownNode)` (814751d). Children-first: CONFIRMED.
- `performMobileCollisionUpdate` 0x08147580: own object first - `if (obj+0x64 && flags & 0x200) rpm->update(dt,
  obj)` (8147590-814766c) - then the same child walk. CONFIRMED.

`player+0x14b`: tested at 815c04c (physics) and 815c0af (collisions, cleared at 815c0c5). The only store of 1 to a
`+0x14b` field in the binary is 815bdec. CONFIRMED as a gate; its meaning is CORRECTED in section 5.

`handleUpdate` "only feeds controls": spot-checked, not proven. A scan of every `*::handleUpdate` for a load of
`obj+0x60` followed by a node adder slot finds only `BFSoldier` and `Emitter`. `Engine`, `Wing`, `FloatingBundle`,
`RotationalBundle`, `Projectile` load the node but call no adder.

---------------------------------------------------------------------------------------

## 2. Children precede their root - CONFIRMED (could not break it), one edge case

- `addPhysicsNode` 0x08255680: returns unless `getIsMobile()`; `pos = sentinel->next` (82556a5-ab), `new->next =
  pos` (82556c7), `new->prev = pos->prev` (82556cf), relink, `node[+4] = begin()` (82556eb). That is
  `insert(begin())` = push_front.
- `update(dt, 0, 0)` 0x08255740 starts at `sentinel->next` (8255797) and advances through `_M_next` (82557c5) until
  it meets the sentinel: front to back. Per node: skip if `obj.flags & 1` (82557b8) or
  `getHasSeparatePhysicsUpdate()` (+0xbc, 82557dc), else `updatePhysics` (+0x90).
- `SimpleObject` ctor calls `tmpl->vtbl[+0x64]` at 81da181 (bit 4 of tmpl+0x70 set; clear takes the legacy
  `+0x5c` at 81da43c - also inside the ctor). `Bundle` ctors 0x081a72c0 / 0x081a7300 call the `SimpleObject` ctor
  (81a72cf / 81a730f) and only then `tmpl->vtbl[+0x7c]` (81a72e7 / 81a7327) = `addBundleChilds` 0x081a8300 for
  PlayerControlObject / Spring / Engine / Wing templates alike. `addBundleChilds` does `createObject()` (+0x2c)
  per child and `parent->addChild` (+0x80). So for any bundle tree the list holds every descendant ahead of its
  ancestors (later siblings first).
- Attempts to break it: `addPhysicsNode` has exactly seven callers (SimpleObject / Engine / FloatingBundle /
  Spring / Wing `setPhysicsNodeComponent`, two `Particle` ctors); `removePhysicsNode` only unlinks; the one
  remove-then-set site is a console tweak method (0x0817aa90). Runtime attachments (soldier into a seat, kit
  parts) involve nodes that add no force to a vehicle root.
- Edge case R2 does not mention: in step 3 the walk **skips child PCOs and their subtrees**, and `disablePhysics`
  (non-recursive form) does not mark them. A force node under an unoccupied child PCO therefore runs in step 4,
  after an occupied root integrated in step 3, and lands one tick late. Whether any shipped vehicle nests an
  Engine / Wing / Spring under a child PCO was not surveyed.

---------------------------------------------------------------------------------------

## 3. F8 / F10 sleeping - CONFIRMED; the ram sequence is right and the first impulse is NOT lost

Basics, all objdump:
- `isSleeping` 0x0824d480: `test; setle`. `setIsAwake` 0x08255330: `mov 0x872deec,%dl` -> +0x94; the byte is 100;
  that instruction is the only reference in .text and no data pointer to it exists. Ctor tail-jumps to it (8252c31).
- `updatePhysics`: `js` at 82543f2 skips the tests when sleepiness < 0; `cmp %esi,%edi` 82543f8 root only; class
  0x9493 exempt (8254787). Test 1 (82547ad-ba): st0 = 2.5, st1 = |acc|^2, `fucompp`, `jne` on C0|C2|C3 -> wake when
  `|acc|^2 >= 2.5`. Tests 2 and 3 (82547e2, 825480d) the same shape with 0.25 for |v|^2 and |w|^2. Countdown
  `jle` / `dec` 825481e. Constants `0x86d13a0` = 2.5, `0x86c08ac` = 0.25.
- Zero branch 8254417-8254483: `this.setSleepiness(root.getSleepiness())`, zero +0x10..+0x57 and +0x64, return.
  Gravity is seeded only on the integrate path (82544e9-8254502). CONFIRMED.
- Wakers: a whole-binary scan of `call *0xd4(` gives R2's list - `updatePhysics` x3, `addFriction` 825bdd1,
  `PhysicsEngine` (|input| >= 0.05, constant is a double at `0x86d0ce8`; `fucompp` direction checked at 824cbdc),
  `PhysicsFloatingBundle` x2 (wakes `getParent()`, with no sleepiness >= 0 test), `handleExplosionOnObject`
  8156aa4, `PlayerControlObject::enter` 83172b9, `FireArms::Fire` 828a44e, `AIObjectPhysical::enablePhysics`
  85d6452, bot code - **plus one R2 missed: `ObjectSpawner::~ObjectSpawner` / `destroy`** (8313264, 83133c4,
  8313524, 8313724). Nothing in `impulseOn`, `solveImpulse`, `checkObjectVsObject` or `handleCollision*` wakes.
  `ObjectSpawner::handleFrameUpdate` `setSleepiness(0)` 8313e0d and `AIObjectPhysical::disablePhysics`
  `setSleepiness(-1)` 85d63f3: CONFIRMED.

(a) `ResponsePhysicsManager::update` 0x0825d0b0 - CONFIRMED. Root list pass 1: `+0xbc` at 825d379 then `+0xcc`
at 825d38c, both must be 0. Root list pass 2: only `+0xbc` at 825d581, then `+0x1c` (825d594) and `+0x20`
(825d5b3). Flat list: pass 1 `+0xbc` only (825d1cf), pass 2 `solveImpulse` alone (825d4e4). Single-object mode:
`setCollisionChecked(counter - 1)` 825d0f5, `isSleeping` 825d101 gates detection only, then always 825d118 /
825d137. Note the node tested is each chain element's own `obj+0x60`.

(b) `ResponsePhysics::addFriction` 0x0825b6e0 - CONFIRMED. It walks `getParent()` to the root into `%edi`
(825b852-73). At 825bd1b: |+0x74|^2, `flds 0x86b1ca0` (0.1), `fxch`, `fucompp`, `je 825bdb4` taken when
C0 = C2 = C3 = 0, i.e. strictly `> 0.1`; then `getSleepiness()` 825bdba, `js` skips, `setIsAwake()` 825bdd1; then
the accumulators are cleared (825bd43-af). Every normal path reaches this test. It is not reached when the
contact count is 0 (825b761), when permanent grip is 0 (825b78e), or on the EngineDummy path (825c660).

**The sequence, step by step (unoccupied sleeping plane, occupied jeep):**

| tick.step | what runs |
|---|---|
| N.3 | jeep integrates into overlap |
| N.5 | pair untouched: plane asleep (no detection), jeep hasSeparate (skipped in both passes) |
| N.6 | jeep detects (plane's `collisionChecked` is stale, so the pair is not de-duplicated); `impulseOn` loads **both responses**; only the jeep is resolved |
| N+1.4 | plane root asleep -> zero branch. Nothing is lost: the contact lives in the ResponsePhysics, the node's `acc` is still 0 |
| N+1.5 pass 1 | plane skipped (asleep) |
| N+1.5 pass 2 | plane `solveImpulse`: **position snapped now** by the positional adjust (no sleep gate), impulse into root `acc` / `racc`; `addFriction` posts friction and calls `root.setIsAwake()` |
| N+1.6 | jeep detects again if still overlapping, reloading both responses |
| N+2.4 | plane's children run first and see sleepiness 100 (springs push); root integrates `v += acc*dt`; no gravity this tick, seeded for N+3 |
| N+2.5 | plane, now awake, does its own detection; the pair flips to plane-vertices vs jeep-faces and the jeep de-duplicates in step 6 |

Is the first impulse lost? **No.** The zeroing of a sleeping root happens only inside its own `updatePhysics`
(step 4), which runs *before* the step-5 resolve that posts the impulse; `addFriction` wakes the root in the same
pass-2 visit, right after `solveImpulse`; and even without it the F8 wake test reads `acc` before the zero branch
of the same call. Emulated on the real code (`v2-emu-extra.py` I): asleep root, acc 7.5 posted, `setIsAwake`,
next `updatePhysics` gives v = 0.25 = acc*dt exactly, with `acc` re-seeded to (0, -14.73, 0) afterwards.

The impulse IS lost only when both wakers fail - |share*relSpeed|^2 <= 0.1 **and** |acc|^2 < 2.5 (test J: acc
1.5 on a sleeper -> v = 0, acc wiped). The positional correction still applies, so a slow shove slides a sleeping
body out of penetration each tick without ever giving it velocity. Also lost: a spawner-held object (carrier
deck), whose node is `reset()` every frame while held.

R2's "two ticks from touch to motion" is right for velocity; the first visible displacement is one tick after
the touch. A sleeping *occupied* victim is resolved in its own step-6 turn, so it moves at N+1 or N+2 depending
on player-list order.

---------------------------------------------------------------------------------------

## 4. F9 - CONFIRMED

`setPhysicsNodeComponent` 0x081dd490 (decomp/081dd490.c): bit0 clear -> `StaticPhysicsNode` (0x10), unregistered;
bit3 -> `PointPhysicsNode` (0x50); else `PhysicsNode` (0x98) with `setComponent(0xc422)`, `updateFlags(8, 0)`
(obj +0x2c), `setDrag(tmpl+0x44)` +0x94, `setDragOffset(+0x48)` +0x88, `setMass(+0x54)` +0x9c,
`setCenterOfMassOffset(+0x58)` +0xa4, `setInertiaModifier(+0x64)` +0xac, `addPhysicsNode`. The point branch is
the same minus the COM call. gravityModifier, +0x90, +0x91, sleepiness are not copied. The only `call *0xb4`
(setGravityModifier slot) sites near object construction are the `Projectile` ctors 831de73 / 831df63 (receiver
not traced), so a vehicle keeps the ctor's 1.0.

Subclass nodes address the root directly: `PhysicsEngine` `root->+0x68` (r2-decomp/0824cbb0.c:108), `PhysicsSpring`
`root->+0x6c`, `PhysicsFloatingBundle` `root->+0x68`, `PhysicsWing` via `getTopFixParent` (which re-tests the
original node's +0x91; v2-decomp/08252d90.c). Spring and FloatingBundle copy the root's sleepiness then test their
own `isSleeping`; Engine copies only when |input| < 0.05; Wing has no +0xcc / +0xd8 / +0xdc call at all.

Byte +0x91: ctor `movb $1` (8252c25, 8252cf5); the only other writers on a node are the `PhysicsSpring` ctors
(824dcc3, 824dd73) with 0. Readers: the four forwarding adders (8254c8f, 8254daf, 825512f, 825524f),
`addFrictionAtAbsolutePosition` (8254e72 -> Debug "addFriction only works on rootParents.", dropped), and
`getTopFixParent`. Meaning "forward to parent when a parent exists": CONFIRMED.

---------------------------------------------------------------------------------------

## 5. hasSeparatePhysicsUpdate - mechanism CONFIRMED, the "no input" claim REFUTED

- `disablePhysics(obj, all)` 0x08147730: `node->setHasSeparatePhysicsUpdate(1)` (+0xb8, 814774a),
  `obj->setUpdateFrequencyType(10)` (+0x68, 814775a), children recursed unless (all == false and the child answers
  IID 0xc4c5). `reenablePhysics` 0x08147680 writes 0 and 0. Callers: `enterVehicle` 814e91d (on
  `player->getVehicle()` after `enter`, non-recursive form), `exitVehicle` (reenable the old vehicle 814e84e,
  then disable the soldier 814e6ee + `resetPhysics`), `BFSoldier::addItem`, `Projectile::handleCollision`;
  reenable also from `FireArms::fireBarrel` 828b613. CONFIRMED.
- Effect on the passes: leaves step 2 (type 10 != 0), step 4 (82557dc), step 5 both passes (825d379 / 825d581);
  handled in 1 / 3 / 6. CONFIRMED. Others can still detect *against* it.
- **REFUTED: "If the server processed no input for that player this tick, +0x14b stays 0 and the vehicle is
  neither integrated nor collided."** `simulatePlayerUpdate` 0x0815bd00 clears +0x14b at 815bd46 and sets it at
  815bdec on **every** path; the function has one `ret` and always returns 1. With an empty action buffer
  (`cmp %eax,(%eax)` 815bd4f) it zeroes the PlayerInput (815bd85-92, after a pointless `PlayerAction::get` of the
  cached last action), advances the tick stamp, and carries on through `handleInput` and `performHandleUpdate`.
  So a missing packet means **a tick simulated with all-zero input**, not a skipped tick. The real skip is in
  `simulatePlayersUpdate` 0x0815bfa0: `client = getClient(player->getId())`; called when `client == 0` (bot) or
  `client[+9] != 0` (the `isClientReady` byte, 0x0813ad20); skipped only for a connected client that is not ready
  (815c003-07). `processOutstandingTicks` 0x0815c190 has no caller. "Driven once per player input" should read
  "once per server tick, consuming one buffered input when there is one".

---------------------------------------------------------------------------------------

## 6. The six corrections in R2 section 3

1. **CONFIRMED** against HEAD's physics.md. +0xcc is `isSleeping`; the branch is `isSleeping() || this != root`
   (8254406-15); the two virtual calls are `root+0xdc` / `this+0xd8`; then zeroing. Note: the working-tree
   `subsystems/physics.md` (modified 22:59, uncommitted) already carries this wording.
2. **CONFIRMED.** +0x10, +0x40, +0x64 by the emulation; +0x91 default, writers and the dropped friction as in
   section 4.
3. **CONFIRMED** (section 3a). "Ungated" means no node-state test; the object-flag test still applies.
4. **CORRECTED.** Arms and the z, y, x out order: confirmed by emulation. But R2's evidence for "no `.con` word
   sets it (no 'centerOfMass' string in the binary)" is false: the string `centerOfMassOffset` is at `0x086c5861`
   and is registered at 81b812b inside the `ObjTemplBaseModule` static initialiser 0x081b2ce0, next to
   `inertiaModifier` (81b804c) and `dragOffset` (81b82e7). `ObjectTemplate.centerOfMassOffset` is a live console
   word feeding tmpl+0x58. The conclusion survives on data alone: my census finds zero uses in bf1942, XPack1,
   XPack2, DesertCombat, DC_Final, FH and FHSW. A mod could set it, and the world-axis (unrotated) subtraction
   would then matter.
5. **CONFIRMED.** `updateFlags(8, 0)` is in both the PhysicsNode and the PointPhysicsNode branch.
6. **CONFIRMED as fact, overstated as a correction.** `updatePositionalPhysics` has no loop (one backward `jmp`,
   an out-of-line block) and the emulation shows one step. HEAD's physics.md section 3 already attributed the
   four sub-steps to `PointPhysicsNode`; it never claimed them for `PhysicsNode`.

---------------------------------------------------------------------------------------

## 7. Not verified

F12 (client twin); `ObjectSpawner::spawnObject` touching no sleep slot; the hold / release logic of
`ObjectSpawner::handleFrameUpdate` beyond the `setSleepiness(0)` + `setPositionalSpeed` pair at 8313e0d-1c; the
`.con` census numbers other than centre of mass; whether any vehicle nests a force node under a child PCO.

## 8. What an implementer should change in R2 section 5

- Drop the idea that a driven vehicle can miss a tick for lack of input: step it every tick, with zero controls
  when no input is buffered.
- Keep "contacts resolved even when asleep", and add: the positional correction is applied to a sleeping body
  immediately; velocity follows one integrate later; an impulse below both wake thresholds is discarded.
- Paused state (status 4) runs player input only.
