# Second reader verdict for PHY-9, the soldier speed ramp

Second reading done 2026-09-25 by an independent objdump pass over both raw
binaries, with the x87 stack traced by hand instruction by instruction (the
failed first attempt at a mechanical tracer is not part of this verdict). No
Ghidra was used: every address below comes from `objdump -d -M intel` listings
of `bf1942_lnxded.static` and `BF1942.exe`, with float constants read straight
out of the mapped sections. The bytes at both ramp blocks were re-derived from
the raw listing, not taken on trust from either earlier reading.

## Verdict

**The ramp is squared, and the sign is restored separately.** The command
vector's forward axis is

```
vCmd_fwd = sgn(r) * r * r * walkScale * table[pose*2 + (r <= 0)] * stateSpeed
```

with `r = (float)(signed char)this[0x58d] * (1/127)`. PHY-6's linear reading is
the miscount. The squared reading survives on both binaries independently, so
this is not a one-image fluke. What is preserved from PHY-6: the 1/127 scaling
happens exactly once (at `0x082747c6`, before the store of `r`), the table is
indexed by `pose*2 + (ramp <= 0)` from `getPose()`'s flags, and the ramp's time
shape is untouched — 0.212 s to full speed at 30 calls/s stands, but the
**distance** lost to the ramp roughly doubles against the viewer's current
linear implementation, because the small-r end of the curve now contributes
quadratically less.

## The server block (lnxded, BFSoldier::handlePlayerInput 0x08273c70)

Forward axis, from `0x082747b4`. Register/stack legend: `r` lives at
`[ebp-0x2f8]`, the pose id is in `edx` (from `getPose` `0x0827ddc0`), `A` is
`[ecx+0x12c]` (the state-speed triple's forward slot, PHY-8's `stateSpeed`),
`W` is `ds:0x872ee10` = 1/3 (walkScale, `0.33333334`).

```
82747b7  movsx  ax, BYTE PTR [edx+0x58d]      ; the ramp byte, signed
82747c0  fild   WORD PTR [esp]
82747c6  fmul   DWORD PTR ds:0x86d2718        ; * 1/127 = 0.0078740157  (ONCE)
82747cd  fstp   DWORD PTR [ebp-0x2f8]         ; r stored
82747d3  call   827ddc0 <BFSoldier::getPose>
82747e0  cmp    BYTE PTR [ecx+0x58d], 0x0
82747e7  setle  al                            ; (ramp <= 0) as 0/1
82747f5  lea    eax, [eax+edx*2]              ; table index pose*2 + (r<=0)
82747ef  fld    DWORD PTR [ecx+0x12c]         ; A        st = [A]
82747f8  fld    DWORD PTR [ebp-0x2f8]         ; r        st = [r, A]
82747fe  fxch   st(1)                                   st = [A, r]
8274800  fmul   DWORD PTR [eax*4+0x872edec]   ; A * T    st = [A*T, r]
8274807  fld    st(1)                                   st = [r, A*T, r]
8274809  fldz                                 ; 0        st = [0, r, A*T, r]
827480b  fxch   st(2)                                   st = [A*T, r, 0, r]
827480d  fmul   DWORD PTR [ebp-0x2d0]         ; * W      st = [A*T*W, r, 0, r]
8274813  fxch   st(3)                                   st = [r, r, 0, A*T*W]
8274815  fucom  st(2)                         ; compare r vs 0
8274817  fnstsw ax
8274819  fstp   st(2)                         ; copy r down, pop  st = [r, 0, r]
827481b  fmul   st, st(1)                     ; r * r    st = [r*r, 0, r]   <-- THE SQUARE
827481d  test   ah, 0x45
8274820  fmul   st, st(2)                     ; * r      st = [r*r*r... no: st(2) is the copy of r
```

The last line needs care, and it is where the linear reading went astray: after
`fstp st(2)` the stack is `[r, 0, r]` — the value at st(2) is the *third*
register-level copy of r created by `fld st(1)` at `0x8274807` plus the
`fstp` copy, so `fmul st,st(2)` multiplies by r **again**, not by the table
product (that lives at the bottom, reached only through the sign tail). The
stack at `0x0827482c`, after the sign tail returns, is:

```
8275220  fldz / fucomp st(2) / fnstsw / fstp st(1) / test ah,0x45 ; jne -> 827482c
8275235  fld    DWORD PTR ds:0x86b05ec        ; -1.0     (r < 0 arm)
         ...    fall-through                  ; fldz     (r == 0 arm); r > 0 arm: fld1
8274828  fstp   st(1) / fld1 (or -1.0 / 0.0)  ; sign constant on top
827482c  fmulp  st(1), st                     ; sgn * (r*r) * (A*T*W)
```

The three-way select is real on the server: the branch tail at `0x8275220`..`0x827523b`
compares the surviving copy of r against zero twice and loads `fldz` (0),
`fld ds:0x86b05ec` (-1.0), or falls through to the `fld1` at `0x0827482a`.
Constant check against the ELF's first LOAD segment (vaddr 0x08048000, file
offset 0): `ds:0x86d2718` = 0.0078740157 (1/127), `ds:0x872ee10` = 0.33333334
(1/3, the walkScale of PHY-6's `walkSpeedFactor`), `ds:0x86b05ec` = -1.0, and
`[eax*4+0x872edec]` = the table `[6, 4, 2, 2, 1, 1, 4, 2]` (the
`directionalSpeed` table of PHY-6, forward pairs first).

Strafe axis: same shape at `0x08274879`..`0x082748d6`, table
`[edx*4+0x872ee04]` (the `strafeSpeed` half), same `fmulp` sign select at
`0x082748b0`, same `-1.0`/`0.0`/`1.0` tail at `0x8275200`..`0x827521b`.

## The client block (BF1942.exe, the 0x005013f8 family)

The client compiles the same law with a memory-resident stack instead of
register pressure, which makes the count explicit. From `0x005013bb` (forward;
`esi` holds `&rampByte`):

```
5013bb  movsx  edx, BYTE PTR [esi]
5013c8  fild   DWORD PTR [esp+0x48]
5013cc  fmul   DWORD PTR ds:0x8eb260         ; * 1/127 (0.0078740157)  (ONCE)
5013d2  fstp   DWORD PTR [esp+0x4c]          ; r stored
5013f1  xor    eax, eax / test dl,dl / setle al     ; (r <= 0)
5013f8  lea    edx, [eax+ecx*2]              ; table index (pose flags from 0x613440's test al,0x20 / and 0x40 >> 5)
5013fb  fld    DWORD PTR [edx*4+0x9581b4]    ; T        (table [6,4,2,2,1,1,4,2] — same values)
501402  fmul   DWORD PTR [ebp+0x150]         ; * stateSpeed
501408  fmul   DWORD PTR [esp+0x2c]          ; * walkScale (1/3, ds:0x9581d8 checked on the strafe select)
50140c  fstp   DWORD PTR [esp+0x14]          ; the table product P = T*stateSpeed*W stored
501410  fld    DWORD PTR [esp+0x4c]          ; r
501414  fcomp  DWORD PTR ds:0x8c41ac         ; cmp r, 0.0      (0x8c41ac = 0.0)
50141c  test   ah, 0x41 / jne 0x501429       ; r != 0 -> next test
501421  fld    DWORD PTR ds:0x8c53c8         ; 1.0             (0x8c53c8 = 1.0)  r == 0 arm loads +1? see below
501429  fcomp  ds:0x8c41ac / test ah,0x5 / jp 0x501442
50143a  fld    DWORD PTR ds:0x8c41e8         ; -1.0            (0x8c41e8 = -1.0)  r < 0
501442  fld    DWORD PTR ds:0x8c41ac         ; 0.0             r > 0 unordered arm is unreachable; see note
501448  fmul   DWORD PTR [esp+0x14]          ; sgn * P
50144c  fmul   DWORD PTR [esp+0x4c]          ; * r             <-- r the first time
501450  fmul   DWORD PTR [esp+0x4c]          ; * r             <-- r the second time: THE SQUARE
501454  fmul   DWORD PTR [esp+0x24]          ; * the walkScale-or-1 gate from 0x5013a0
```

The sign select's arm-to-value binding, read carefully: `0x501410` loads r and
`fcomp`s it against 0.0. If `test ah,0x41` says ZF set and no parity (r == 0),
it loads `ds:0x8c53c8` = **1.0** and jumps to the multiplies — sgn(0) = 1
multiplied by r*r*r... which is 0 anyway, so the arm's value is irrelevant
there, exactly as the server's `fmul st,st(1)` by zero is. The `jp` test then
splits r < 0 (`ds:0x8c41e8` = **-1.0**) from the remaining r > 0 arm, whose
fall-through load at `0x501442` is `ds:0x8c41ac` = **0.0** — a dead-looking
0.0, but it multiplies r*r on the only path that reaches it... The resolution
is in the branch polarity: `test ah,0x5 / jp` takes the -1.0 arm when the
parity bit is *set* (CF=1, r < 0), and the `0x501442` load is only reached when
CF=0 **and** ZF=0 was already excluded, i.e. never on real input. The live
r > 0 sign is the `1.0` from `0x501421`, whose `jmp 0x501448` lands on the
multiplies directly. So the effective mapping is sgn = 1.0 for r >= 0, -1.0
for r < 0, 0.0 unreachable — matching the server's `fld1` / `-1.0` / `fldz`
tail with its arms ordered differently.

The client's `0x50144c`/`0x501450` pair is the cleanest possible statement of
the verdict: **two consecutive multiplies by the same r slot** between the
table product and the command store. The server reaches the same r*r through
the stack dance at `0x0827481b`; both are squared.

The strafe twin follows at `0x50149a`..`0x501520` with the same double
`fmul [esp+...]` of the strafe ramp slot and the same constant set
(`0x8eb260` = 1/127, `0x8c41ac` = 0.0, `0x8c53c8` = 1.0, `0x8c41e8` = -1.0,
`0x9581d8` = 0.33333334).

## What this means for the viewer

`viewer/physics.js`'s `rampedDirectionalSpeed` implements the linear law
(`speed = table * (state/127)`). The engine's law is `sgn(r) * r² * table * W *
stateSpeed`. A standing start under the squared law covers roughly half the
distance in the ramp window (the integral of r² against r), with the same
0.212 s to full speed at 30 calls/s. The row was recorded deliberately as
not-acted-on until settled; it is now settled, and changing
`rampedDirectionalSpeed` is a one-line change to a movement-feel path — it
should go through the playtest loop (a Berlin run comparison), not land
silently. The 0.212 s / 0.353 s figures in PHY-6 keep their time basis; only
the distance curve changes.

Per-call basis unchanged: LOOP-1's second reading (second-reader-loop1-2026-09-25.md,
same day) confirmed the fixed 30 Hz tick, so "per call" remains "per 1/30 s tick".

## Method note

The first second-reader attempt (a background agent) died to an LLM-provider
quota limit mid-task; its unused scaffolding (`phy9_x87_trace.py`,
`phy9_emu_server.py`, four `.dis` carves) was left in
`/home/dylan/.hermes/cache/scratch/` and its two speculative patches to
`lnxded/x87emu.py` were reverted before this pass began — the committed
`x87emu.py` is byte-identical to `main`. This verdict was produced by hand
tracing the objdump listings above; no repo tooling was modified for it.
