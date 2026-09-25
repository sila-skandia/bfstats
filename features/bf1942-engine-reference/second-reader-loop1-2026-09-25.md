# Second reader verdict for LOOP-1, the game loop rate

Second reading done 2026-09-25 by an independent objdump pass over both raw binaries.
No Ghidra was used. The pre-analyzed project at ~/ghidra/linux-server.rep turned out
to hold an unanalyzed import, so every address below comes from `objdump -d -M intel`
listings of the whole images, with symbols from `nm` and immediate values from
`objdump -s`. The byte-level claims in LOOP-1's evidence column were re-derived from
the raw listing, not taken on trust.

Binaries: `bf1942_lnxded.static` and `BF1942.exe` in `/home/dylan/projects/public/bf42plus/`.

## Verdict

LOOP-1's challenge is **refuted**. The dedicated server simulates the world at exactly
30 Hz with a fixed dt of 1/30 s per frame step. The 2026-09-20 reading described every
mechanism correctly but misread what the measured frame dt is used for. The loop does
spin to a 1/60 s target and it does store measured elapsed time, but that value never
reaches the soldier and vehicle simulation. A whole-tick accumulator in
`Setup::updateInputs` counts elapsed time in 1/30 s quanta, and `Setup::mainLoop` calls
`GameServer::update(nTicks, 1/30)`, which runs `simulateFrame(1/30)` nTicks times. The
client has the same shape, so client and server do not differ in the way LOOP-1
imagined. The corpus README's "settled 30 Hz loop" claim stands.

The original row was right about: `g_simulationFps` having no writer, `initEngine`
doubling it into Setup+0xc4, `mainLoop` pacing on 1/60 s, and the measured elapsed
time being stored to Setup+0xc8. It stopped reading one function too early:
`Setup::updateInputs`, called from `mainLoop` at 0x080bc107, is the accumulator the
row concluded did not exist.

## Check 1: every reader and writer of Setup+0xc4 and Setup+0xc8

A full-image scan of the lnxded listing found every instruction with a `[reg+0xc4]` or
`[reg+0xc8]` displacement and attributed each to its enclosing function. The offsets
are common field offsets, so hundreds of hits belong to other classes (BFPlayer,
DownloadManager, ResponsePhysics, PatchTerrain, NetServer, AI classes, libc locale
internals). Every hit inside code that operates on a `Setup` object is listed below,
and they are the only ones: Setup methods are the enclosing symbol for each.

Writers of Setup+0xc4:

- 0x080b7cf1 and 0x080b8921, the two constructors, store `0x42c80000` = 100.0.
  The default loop rate before init is 100, matching the client's default frame cap
  (GL-2).
- 0x080bc641 in `Setup::initEngine`: `fld ds:0x08716b5c` (30.0), `fadd st,st(0)`,
  `fstp DWORD PTR [ecx+0xc4]`. Stores 60.0, doubling `g_simulationFps`, exactly as
  the row said. The write is gated on `useNullDeviceRenderer` (byte at 0x08716b54,
  set 0 at 0x080bc638) being clear and `Setup+0x70` clear, which is the normal server
  path. The branch at 0x080bd647 loops back to the same block when `Setup+0x216` is
  set, so the host path reaches the same store.

Readers of Setup+0xc4, all three inside `Setup::mainLoop`:

- 0x080bc0b2: `fld1; fdiv DWORD PTR [ebx+0xc4]` computes the 1/60 s pacing target.
- 0x080bc20a and 0x080bc252: two more divisions by the same field inside the
  end-of-frame pacer at 0x080bc205 to 0x080bc2b8, which compares the frame's wall
  time against the target and can `Sleep(ms)` (0x080bc2b0) when the host runs ahead.

No other function touches the field. Nothing rewrites it after `initEngine`, and
`mainLoop` uses it only as a division divisor, which is what a period is.

Writers of Setup+0xc8:

- 0x080bc0f8 only: `fsubrp st(1),st; fstp DWORD PTR [ebx+0xc8]` in `mainLoop`,
  storing `now - lastFrameTime` measured by `System::getExactTime` (0x08418160, an
  rdtsc wrapper scaled by `dice::ref2::io::frequencyFactor` at 0x087bb468). The frame
  timestamp pair lives in `Setup::mainLoop::oldTime` at 0x08716b78.

Readers of Setup+0xc8, all inside `mainLoop`:

- 0x080bc1af: copied into a ring buffer indexed by `Setup+0xdc`, modulo
  `Setup+0xe0`, a frame-time history used by the pacer.
- 0x080bc325: pushed as the argument to a virtual call on
  `dice::ref2::world::objectManager` (global at 0x0871dc24, vtable slot +0x18).

So both fields are what the row said they are: the pacing period and the measured
frame dt. But the frame dt's only consumers are the frame-time history, the pacer,
and the objectManager per-frame entry point at slot +0x18. It is never passed to
anything named update, simulate, or tick.

## Check 2: what the client does

The client's loop has the same three layers, and the tick accumulator is present
there too.

- Client `Setup::mainLoop` 0x0044abc0 measures elapsed time and stores it to
  Setup+0x180 at 0x0044acbe (with a 0.01 s floor at 0x0044ac37, constant 0x8c409c).
  The value is consumed by a render-time accumulator at 0x458ea0 (adds into +0x44,
  fires a render pass at a threshold from 0x8c53c8) and other per-frame paths. Same
  role as the server's Setup+0xc8.
- The client's tick dt lives at Setup+0x184, written at 0x0044502a as
  `1.0 / [eax+0x1c]` where the divisor is read from `g_simulationFps`'s client twin
  0x00957640 = 30.0 (DEV-5 already has this chain: `Setup::initInputDevices`
  0x00444e70). So the client also carries a fixed 1/30 s tick dt next to its
  measured frame dt, at a different offset.
- `InputManager::update` 0x0049ce70 is a whole-tick accumulator over doubles at
  0x97b5f8 and 0x97b600: `elapsed = now - base`; while `elapsed >= tickDt` (the
  divisor 1.0 at 0x8d1a60) it counts a tick and advances the base by tickDt; a
  backlog over 10 ticks collapses to 1 with the base reset to now (0x0049cfb3 to
  0x0049cfdb). This is the same arithmetic the server uses.
- Client `Setup::updateInputs` (0x00449470, per GL-1) stores the pending tick count
  into Setup+0x31c at 0x004494e6 via `InputManager::getPendingTicks` 0x0049d1c0.
- `GameClient::update(int, float)` 0x0048fca0 takes the tick count in its second
  argument, clamps counts over 9 down to 1 (0x0048fca8), and loops the count times
  over vtable slot +0x13c with the same dt each iteration (0x0048fcd0 to 0x0048fcdc),
  mirroring the server's `GameServer::update` structure exactly.

One gap to state plainly: the direct call site that pairs Setup+0x31c with
Setup+0x184 into `GameClient::update` was not located in the client listing. The
call into `GameClient::update` is virtual (a grep for direct calls to 0x48fca0 finds
only its own prologue), and the client binary is stripped, so the connecting edge
rests on GL-1's 2026-09-15 Ghidra reading of `Setup::mainLoop`. Both endpoints of
that edge were re-verified here independently, and GL-1 documents the edge itself.

The client is therefore not a fixed-30 Hz counter that the server lacks. Both sides
pace wall clock faster than 30 Hz and both re-quantise into whole 1/30 s ticks. The
client's pacing target is the render frame cap (GL-2), the server's is the doubled
constant, but the simulation clock is the same on both.

## Check 3: anything between mainLoop and simulateFrame that re-quantises dt

Yes, and this is the finding that overturns the row.

`Setup::updateInputs` lnxded 0x080bc540 is a fixed-step accumulator, called from
`mainLoop` at 0x080bc107 once per frame:

- `Setup+0xcc` holds the tick period, written by `Setup::initInputDevices`
  0x080be490: `fld1; fdiv ds:0x08716b5c; fstp [eax+0xcc]` = 1/30 s. This is the
  real consumer of `g_simulationFps` in the loop, not the doubling at 0x080bc632.
- The accumulator state is `Setup::updateInputs::oldTime` (double, 0x08716b80) and
  the per-second gauge pair `thisSecond` / `ticksThisSecond` (0x08716b88,
  0x08716b90).
- The loop body: elapsed = now - oldTime; while elapsed >= 1/30, count a tick into
  `Setup+0x1c4` and advance oldTime by exactly 1/30 (compare/fucom pairs at
  0x080bc579 and 0x080bc5b4, counter increment at 0x080bc596, base advance at
  0x080bc5a4). The count is unbounded here, unlike the client's backlog clamp.

Back in `mainLoop`, the tick count is consumed at 0x080bc33a to 0x080bc38a:

- 0x080bc342 reads `Setup+0x1c4`, the whole-tick count.
- 0x080bc34c to 0x080bc363 loads `dice::bf::game` (0x0870d918, set by `setGame`
  0x08062ad0; on the dedicated server the object behind it dispatches to
  `GameServer::update(int,float)` 0x08132940, GameServer vtable 0x0871b0e8 slot
  +0x28 = 0x08132940) and calls vtable slot +0x28 with arguments (nTicks,
  Setup+0xcc, nTicks). The float argument is Setup+0xcc, the fixed 1/30, not the
  measured frame dt.
- 0x080bc369 to 0x080bc37b times the call into `g_phyUpdateTime` (0x08716b50).

`GameServer::update` 0x08132940: takes nTicks from its second argument, clamps
counts over 9 down to 1 (0x08132955, writing the remainder to +0x4f8), processes
local player inputs and packets, then loops nTicks times over vtable slot +0x140
with the same dt every iteration (0x081329a0 to 0x081329b0). Slot +0x140 on the
GameServer vtable is 0x0815c2a0, `simulateFrame(float)`.

`simulateFrame` 0x0815c2a0 forwards that dt unchanged into
`simulatePlayersUpdate` (0x0815c2c8), `simulatePlayersPhysics` (0x0815c312),
`updateWorldCollision` (0x0815c342), `simulatePlayersCollisions` (0x0815c35e),
`updateGameLogic` (0x0815c39d) and `updatePortals` (0x0815c3c5), and passes it to
`objectManager` slot +0x14 as (dt, 0, 3) and to `physicsNodeManager` slot +0x14 as
(dt, 0, 0) at 0x0815c31a. It also increments `GameServer+0x1b4`, a frame counter,
at 0x0815c3d0.

`BasicPhysicsSystem::update` 0x08251ef0 is the empty stub the row described
(`push ebp; mov ebp,esp; pop ebp; ret`), but it is not on the simulation path that
matters. The physics nodes are stepped through `physicsNodeManager` vtable +0x14
from `simulateFrame`, and PHY-1/PHY-2 already derived the integrator from
`PointPhysicsNode::updatePositionalPhysics` 0x082560c0 and `ResponsePhysics` code,
which is inside this path and receives 1/30.

`Game::updateWorld` 0x0805d9b0 is a near-copy of `simulateFrame`'s manager calls
and has no callers in the binary. It is dead code on the dedicated server, and the
row's use of it as the dt forwarding step was the wrong function.

The answer to check 3 is yes. `Setup::updateInputs` re-quantises elapsed wall
time into whole 1/30 s ticks exactly the way the client's `InputManager::update`
does, and the measured dt from Setup+0xc8 dies at the objectManager slot +0x18 call.
It does not reach `simulateFrame`.

## What the measured frame dt actually drives

The measured value is not inert. It goes to `objectManager` vtable slot +0x18
(0x080bc32f) once per frame. Which subsystems sit behind that slot was not traced to
individual classes: the object behind the global at 0x0871dc24 is created at runtime
and its class was not pinned down in this pass. Slot +0x18 is a distinct entry point
from the world-update slot +0x14 that `simulateFrame` drives with the fixed 1/30.
A plausible reading is world maintenance that legitimately wants wall time, but that
is inference, not evidence. Any future claim that a specific quantity steps per
rendered frame needs to find its call chain under slot +0x18, not assume it.

## Consequences for the corpus

None of the corpus constants change. The quantities LOOP-1 flagged were all already
tied to per-tick stepping by earlier rows, and those rows now survive a second look:

- PHY-1 jump impulse 6.0 m/s: applied inside `BFSoldier::handlePlayerInput`, which
  runs once per simulation tick (DEV-5 chain), scaled by `g_simulationFps` = 30. The
  1.12 m apex and the sub-step integrator notes stand at 1/30 s.
- PHY-6 locomotion ramp: `applyMovementFactors` is called from `handlePlayerInput`,
  once per tick. The 0.212 s and 0.353 s wall-clock figures are 30 Hz figures, as
  PHY-6's 2026-09-20 rate qualifier already stated. The qualifier's worry, that the
  calls-per-second was unproven, is resolved in its favor.
- DEV-4/DEV-5 deviation decay: one step per `handlePlayerInput`, 30 Hz, fixed.
  DEV-5's chain was derived on the client and is now matched link for link on the
  server (0x080bc540 accumulator, 0x080bc363 dispatch, 0x08132940 tick loop,
  0x0815c2a0 frame step).
- The rev filter and any other per-tick constant stepped from `updateGameLogic`
  (0x081505c0) or `simulatePlayersUpdate` (0x0815bfa0) runs at 30 Hz.

What falls is LOOP-1's own reading: the server does not step at a nominal 60 Hz with
a real varying dt, PHY-1's apex is not a 30 fps-machine figure, and the README's
game-loop section does not need the caveat the row asked for.

## Not verified in this pass

- The concrete class behind `dice::ref2::world::objectManager` and what its slot
  +0x18 per-frame entry point drives (see above).
- The client call edge into `GameClient::update` (virtual, stripped binary; relies
  on GL-1's Ghidra reading, with both endpoints independently re-verified).
- Whether anything in the per-frame path scales gameplay quantities with fps. The
  known gameplay-stepping functions (`handlePlayerInput`, the simulate family) are
  on the 30 Hz path and are not fed the measured dt.
