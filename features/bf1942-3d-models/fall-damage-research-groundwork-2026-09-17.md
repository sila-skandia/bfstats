# Fall damage — groundwork + resolution (2026-09-17→18, lead's binary reading)

> **Corrected 2026-09-19.** The conclusion below — a falling soldier loses hit
> points — stands, but the mechanism it names does not. The `*0x15c` call is
> made on the **GameServer** (`this`), not on the colliding object, and slot
> `+0x15c` of the GameServer vtable is `GameServer::giveDamage` `0x0814b2e0`;
> the BFSoldier sub-vtable reading was a coincidence that happened to reach a
> true conclusion. The consequence it missed: vehicles are damaged the same
> way. The exact soldier formula, with every branch polarity settled in
> `objdump`, and the per-surface scalars this file lists as outstanding
> (terrain `materialDamage` = 30 for all 16 terrain materials; the cell
> terrain -> soldier material from `materialManagerSettings.con`) are in
> `features/bf1942-engine-reference/subsystems/collision-response.md` §9.3-9.5.

Trigger: the user reports that a soldier **dies on any fall from height** in
retail BF1942. This contradicts ledger row **HP-6** ("a collision never costs
hit points… only a projectile damages anything", closed in the negative
2026-09-17). Empirical ground truth (the user has played it) outranks the
ledger conclusion, so the conclusion must be wrong somewhere.

All addresses below are `bf1942_lnxded.static`
(`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`), the Linux
dedicated server, which is the authoritative gameplay sim.

## What the earlier research proved (and I re-confirmed)

1. **`SimpleObject::handleCollision`** `0x081dab40` (spans to `0x081db230`) —
   called by soldiers too (`BFSoldier::handleCollision` `0x0827d3b0` delegates
   to it at `0x827d4a5`). Read in full:
   - Finds nearest Armor (getComponent 0xc4a4 walk) but **never** calls Armor
     `damage` (+0x20) / `heal` (+0x24).
   - Records fall height: `setLastCollisionHeight` (+0xf8) at `0x81dae83`–98,
     reading the object's world Y via `*0x38` (getPos).
   - Dispatches to `Game::handleCollision` (vtable +0x34/+0x30) → handled by
     the GameServer override.
2. **`Game::playCollisionEffect`** `0x0805de20` (spans to `0x0805df80`) — the
   effect spawner. Read in full: only EffectTemplate-related vtable calls
   (+0x3c, +0x8, +0x74, +0x78, +0x14, +0xc, +0x9c). **No Armor HP mutator.**
   This part of HP-6 is correct.

## The gap the research missed — the soldier fall branch

`GameServer::handleCollisionLandOrWater` `0x08154960` (spans to `0x081551c0`).
It has a **soldier-specific branch**:

- `0x8154c43`: `cmp $0x86c2b88` — CID == `CID_BFSoldierTemplate`
  (`0x86c2b88`, confirmed via nm) → jump to soldier branch at `0x8154d20`.
- Soldier branch `0x8154d20`:
  - `0x8154d27` calls `BFSoldier::getDamageDampingFromActiveKitParts` `0x0827ec00`
  - `0x8154d37` calls `*0xfc(%eax)` on Armor = `getLastCollisionHeight` (per ARM-4/6d)
  - `0x8154d4b` calls `*0x38` (getPos) on soldier; `0x8154d58` `fsubs 0x4(%eax)`
    → **fall distance = lastCollisionHeight.Y − current.Y**
  - Clamps / scales against constants:
    `0x86b01b4`, `0x86b9314`, `0x86c0314`, `0x86c08c4`, `0x86c08c0`
  - **`0x8154d12` calls vtable slot `*0x15c(%ebx)`** with many args
    (pos, flags, severity float, root parent…).
    There is a **second** identical `*0x15c` call at `0x815505b` in the other
    land/water branch.

## The open decision

**Vtable slot `0x15c` is the unresolved consumer.** It is:
- NOT `playCollisionEffect` (that is a direct `e8` call at `0x8154b72`).
- NOT Armor `+0x20`/`+0x24` (damage/heal).
- Not obviously an Armor slot at all (Armor vtable has 82 slots; `0x15c`
  = 348 = slot 87 — outside it).
- Called on the **colliding object** (`%ebx = (%esi)`).

If `*0x15c` resolves to a method that costs hit points (e.g. on the object or
its root that funnels into `handleDamage`/`Armor::damage`), then **fall damage
is real and HP-6's headline is wrong** — the earlier research only checked
`playCollisionEffect` and Armor damage/heal, not this second dispatch.

## What must be settled

- (a) Identify the object `%esi`/`%ebx` points at in the fall branch, and
  resolve vtable slot `0x15c` → method. Does it damage?
- (b) The fall-damage arithmetic: constants and clamps, exact HP loss per
  fall distance, damping application.
- (c) Cross-check the **client** (`BF1942.exe`, in Ghidra as `bf1942-mp-enabler`,
  sha `60c9452d...` MATCH: player death on fall must also be simulated/
  simulated-compensated client-side).
- (d) The consequence for the viewer: `map.html:4422` runs an *invented*
  fall-damage safe-height/lethal-speed ramp labelled "approximation".
  `viewer-collision-damage/README.md` recommends deleting it for engine
  fidelity (retail "has no such rule"). If fall damage IS real, that ramp may
  be closer to right than the research believed — but the numbers come from
  this binary, not from the invented values.
- (e) Update ledger HP-6 (and ARM/COL rows if affected) + the
  hitpoints-and-damage doc + `viewer-collision-damage/README.md` fall-damage
  decision.

## Lead's resolution (slot 0x15c = the shared damage dispatch — HP-6 headline is falsified)

**Vetting slot 0x15c.** Enumerating every `*0x15c` vtable call in the whole
`bf1942_lnxded.static` binary, the receiver contexts are all damage/kill:

| Call site | Enclosing function | Why it damages |
|---|---|---|
| `0x814bf23` | `GameServer::_giveDamage` (`0x0814b870`) | core damage routine pushes a damage float and the damaged entity, dispatches `*0x15c` |
| `0x814e0a8` | `GameServer::killPlayer` | kill path |
| `0x81544bc` | `GameServer::handleCollisionForProjectile` | **the bullet path (the one path HP-6 agrees damages)** |
| `0x8154d12`,`0x815505b` | `GameServer::handleCollisionLandOrWater` | **terrain/water fall** |
| `0x81558d6` | `GameServer::handleCollisionObjectVsObject` | vehicle collision |

So slot `0x15c` is unquestionably the **object-level damage/kill dispatch**,
and the fall branch delivers its severity through the exact same slot that a
projectile hit and `_giveDamage` use.

**HP-6's core claim is falsified by direct reading.** HP-6 asserts "the one
consumer of the severity number is `Game::playCollisionEffect`". The soldier
fall branch in `handleCollisionLandOrWater` (reached when the colliding object's
class `== CID_BFSoldierTemplate` `0x86c2b88`) computes `getLastCollisionHeight
- current Y`, clamps/scales it (fall height x `BFSoldier::getDamageDampingFromActiveKitParts`),
then delivers it via `*0x15c(self, rootParent, <severity float>, <pos>, <0x20
param>, 0, 1)` at `0x8154d12` — **NOT** via `Game::playCollisionEffect`.
`playCollisionEffect` (a direct `e8` call) appears only in the other branches
at `0x8154b72`/`0x8154f0b`. The `*0x15c` dispatch is the fall branch's
separate, un-resolved consumer.

The earlier HP-6/ARM-6 sweep only mapped `getComponent(0xc4a4)` (who *resolves
an Armor*) — it never resolved the object-level slot `0x15c` dispatch, so it
missed that the fall term reaches the same damage delivery as a bullet. HP-6's
direct Armor `damage`/`heal` (`+0x20`/`+0x24`) enumeration is correct but moot:
the damage travels through slot `0x15c` -> the object's own handleDamage
(`BFSoldier::handleDamage` `0x08270980` -> `SimpleObject::handleDamage`
`0x081db230` -> find-nearest-Armor `damage(amt)`), not through an in-place
`+0x20` call inside the collision handler.

**Client cross-check (agent + lead re-verification).** `xref.py xrefs
0x004bbfe0` (client `Armor::damage`) returns a single DATA xref (vtable slot
`0x008dc7c8`); `getLastCollisionHeight` `0x00836050` has one code caller at
`0x005f3763` that stores to `this+0xa4` (a cache). So the client does **not**
compute fall damage locally — HP is **server-authoritative**, which is exactly
why the server's `*0x15c` fall dispatch is the deciding code, and why a client
xref sweep cannot by itself refute server-side fall damage.

**Resolution below (RESOLVED 2026-09-18).** The one convergence-by-sign in the
paragraph above — that `*0x15c(self)` reaches `BFSoldier::handleDamage` — is
now verified directly against the dispatch vtable (see the next block). The
consequence for HP-6 and the viewer is stated there. The earlier recommendation
("do not rewrite HP-6 on this alone") is satisfied.

**RESOLVED 2026-09-18 (lead re-verification).** Slot `0x15c` on the
BFSoldier's world-facing multi-inheritance sub-vtable (`vtable` VA `0x0872efc4`)
is **`BFSoldier::handleDamage` (`0x08270980`)**. Lead independently re-verified:
slot `0x15c` = VA `0x0872efc4+0x15c` = file offset `0x6e5fc4+0x15c` =
`0x6e6120` = value `0x08270980` (`BFSoldier::handleDamage(float)`) — exactly the
value the lead read at `0x6e6120` while dumping the BFSoldier vtable.

**Closed chain (all addresses `bf1942_lnxded.static`):**
fall landing → `GameServer::handleCollisionLandOrWater` `0x08154960` → soldier
branch (CID == `CID_BFSoldierTemplate` `0x86c2b88`) at `0x8154d20` computes
fall severity = `(getLastCollisionHeight.Y − current.Y)` clamped/scaled x
`getDamageDampingFromActiveKitParts` (`0x0827ec00`) → delivered via `*0x15c`
(`0x8154d12` / second at `0x815505b`) on the falling soldier's world vtable →
`BFSoldier::handleDamage` `0x08270980` → `SimpleObject::handleDamage`
`0x081db230` → find-nearest-Armor → `Armor::damage` `0x08172730` (subtracts HP).
**Verdict: fall damage is real and applies to soldiers.** HP-6's headline —
”a collision never costs hit points / only a projectile damages anything” — is
**refuted** for soldiers. The earlier research missed this because it only swept
`Game::playCollisionEffect` and raw `Armor` `+0x20`/`+0x24` call-sites; the fall
severity travels through the object-level `*0x15c` (handleDamage) dispatch, not
an in-place `playCollisionEffect`.

Remaining (smaller): pin the numeric fall-damage curve. Constants extracted and
documented below (step (a)); the exact branch polarity still stands on a
verifier pass per the project discipline.

## (a) Numeric fall-damage model (constants + structure)

`Armor::damage` (`0x08172730`) confirmed as a straight HP subtraction (`fsubp`
on `Armor+0x38`, then `Armor::status` `0x081739e0` death gate), and
`SimpleObject::handleDamage` (`0x081db230`) routes into it via find-nearest-Armor.
So the fall severity delivered through `*0x15c` **is** the hit-point damage
amount. `BFSoldier::handleDamage` (`0x08270980`) → `SimpleObject::handleDamage`
(`0x081db230`) → `Armor::damage(dmg)` where `dmg` = the severity.

The soldier branch of `GameServer::handleCollisionLandOrWater` computes that
severity on the FPU stack (both the land branch at `0x8154d20` and the
land/water twin at `0x8155066`, identical shape). Decoded inputs and constants:

| Value | Float | Role (mechanism-confirmed) |
|---|---|---|
| `0x86b01b4` | **30.0** | impact-speed threshold 1 (`fucompp` vs `-0x180` \|v\|) |
| `0x86b9314` | **10.0** | impact-speed threshold 2 (`fucomp` vs \|v\|) |
| `0x86c0314` | **20.0** | speed-falloff scaler (`fdivs`) |
| `0x86c08c4` | **2.0** | clamp/low-damage bound |
| `0x86c08c0` | **8.0** | damage/no-damage gate (below → no HP) |
| `-0x1b4`-`0x4(eax)` | fleet height | `getLastCollisionHeight().Y − current.Y` = **fall distance F** |
| `-0x1b0` | damping | `BFSoldier::getDamageDampingFromActiveKitParts` (`0x0827ec00`) |
| `-0x180` | speed | \|v\| impact speed magnitude |
| `-0x17c` | v·n | impact speed along the surface normal |
| `1.0` | free-fall tolerance | `(F − 1.0)` — a fall must exceed 1 m to register |

Structure (mechanism-confirmed, order verified):
`severity = [(F − 1.0) × damping]` then shaped by the \|v\| thresholds
(10/30), a `/20` speed-falloff, and the 2.0/8.0 bounds, then gated:
`test $0x45` at `0x8154c71` decides damage-vs-return before `*0x15c` at
`0x8154d12` — **small impacts deal nothing, only a fall that clears the
the 8.0 (and height-tolerance) threshold reaches `Armor::damage`.**

Exact branch polarity (which threshold means "below → no damage" vs
"above → ramp") still needs a verifier re-derivation — the x87 `fsubp/`
`fucompp`/`test $0x45` operand-order trap the project has been burned by
(R2 corrected V1 on exactly this class of error). The mechanism and all
constants above are solid; do not gate the viewer fix on the unresolved
branch detail, but do flag the doc if it is later settled.

## Addresses / symbols sheet

| Address | Symbol / role |
|---|---|
| `0x081dab40` | `SimpleObject::handleCollision` |
| `0x081db230` | `SimpleObject::handleDamage` (per HP-7) |
| `0x0827d3b0` | `BFSoldier::handleCollision` (delegates to SimpleObject at `0x827d4a5`) |
| `0x0827ec00` | `BFSoldier::getDamageDampingFromActiveKitParts` |
| `0x08270980` | `BFSoldier::handleDamage` |
| `0x0805de20` | `Game::playCollisionEffect` (no HP mutator — confirmed) |
| `0x08154960` | `GameServer::handleCollisionLandOrWater` (soldier branch at `0x8154d20`) |
| `0x081551c0` | `GameServer::handleCollisionObjectVsObject` |
| `0x08156020` | `GameServer::handleCollision` (dispatcher) |
| `0x0x86c2b88` | `CID_BFSoldierTemplate` |
| `0x86c2b90` | `CID_ProjectileTemplate` |
| `0x86c2b28` | `CID_EffectBundleTemplate` |
| vtable +0x20 | Armor `damage` |
| vtable +0x24 | Armor `heal` |
| vtable +0xf8 | Armor `setLastCollisionHeight` |
| vtable +0xfc | Armor `getLastCollisionHeight` |
| vtable +0x38 | `getPos` (position) on the object |
| vtable +0xc8 | Armor `isDestroyed` |

Ghidra bridge: open on `BF1942.exe` (client), sha MATCH. The Linux dedicated
server is NOT in Ghidra — use `objdump -d --start-address=... --stop-address=...`
on it directly (as done above), plus `nm -C` for symbol names.

## How the next agent resumes this (exact material scalar)

**Goal:** turn `FALL_KINETIC_HP = 10` (currently calibrated by hand against the
user's Wake-airstrip lethal fall) into the exact engine constant, and settle
the `test $0x45` branch polarity. The mechanism and the kinetic shape are
**fully resolved** — the only genuine unknowns are the numeric value of the
per-surface `S_obj·M1·M2` MaterialManager scalars for a ground/terrain fall.

**What is already settled (do not re-derive):**
- A soldier who falls far enough **loses HP via `Armor::damage`** (HP-6
  refuted). Chain: `GameServer::handleCollisionLandOrWater` `0x08154960`
  soldier branch `0x8154d20` → severity → `*0x15c` (`0x8154d12`/`0x815505b`)
  = `BFSoldier::handleDamage` `0x08270980` → `SimpleObject::handleDamage`
  `0x081db230` → `Armor::damage` `0x08172730`.
- The severity (landed, straight-down fall) is `severity = cos³θ ·
  (S_obj·|v|²) · M1 · M2`, i.e. **HP ∝ impact speed squared** (`|v|² = 2|g|h`),
  times the material/damage scalars. The factors are built at `0x8154a93`–
  `0x8154c2f`: `-0x1a0 = cos³θ`, `-0x1a8 = (S_obj · |v|²)` where `S_obj` =
  `*0x4c` on the colliding object, `-0x1a4 = M1 = *0x4c` on MaterialManager
  `0x871d43c`, `-0x1ac = M2 = *0x54` on `0x871d43c`.
- Confirmed float constants: `0x86b01b4`=30.0, `0x86b9314`=10.0,
  `0x86c0314`=20.0, `0x86c08c4`=2.0, `0x86c08c0`=8.0.

**The one real task:** find what `*0x4c` and `*0x54` on the MaterialManager
(resolve the method at vtable `+0x4c`/`+0x54` of `0x871d43c`'s vtable, and of
the colliding object's `+0x4c`) return for a ground/terrain material, and the
`test $0x45` truth table at `0x8154c71` and the 10/30 compares. Then verify
against one clean in-game measurement: `damage = k · 2·|g|·(drop − 1)` where
`k = S_obj·M1·M2`; the user can report a height→HP pair. Watch the x87
`fsubp`/`fucompp`/`fnstsw` operand-order trap — the exact polarity has bit
this project twice; have a verifier re-derive before shipping another number.

## Empirical calibration (2026-09-18, user report) — my first magnitude reading was WRONG

The viewer's first engine-faithful pass shipped `damage = (drop − 1.0) ×
damping`, gated at 30 m/s. **That under-fits badly.** Ground truth from the
user (Wake Island, Allied airstrip spawn — a brief ledge fall):

- In-game: jumping from the airstrip ledge **kills** the soldier (≥ 30 HP, all
  of it — soldier max HP is 30, `_shared/loadouts.json`).
- In the viewer (same fall): the soldier lost only **2 HP** — i.e. my model
  read the drop as ~3 m.

So the engine's real damage per given fall is at least ~15x more than my
linear `(drop − 1.0)` reading. Re-reading the soldier span branch with that in
mind, the earlier structure reading was wrong in its *magnitude-deciding* term.

**Corrected structural reading of the severity.** The span severity delivered
to `*0x15c` (saved to `-0x1d8` at `0x8154c89`, re-loaded at `0x8154d04`) is,
in the land branch (`0x8154d20`→`0x8154e4f`, converging on `0x8154c6b` gate →
`0x8154c80`), the product:

```
severity  = (-0x1a0) × (-0x1a8) × (-0x1a4) × (-0x1ac)
```

where (setup in the land/water common path `0x8154a93`–`0x8154c2f`):

| local | built as | meaning |
|---|---|---|
| `-0x1a0` | `(v·n)`-derived, squared/cubed at `0x8154aa4`/`0x8154aac` | impact speed along the surface normal |
| `-0x1a8` | `*0x4c(MaterialManager)` result then `fmuls -0x180` twice → **×|v|²** | **kinetic term — the magnitude driver** |
| `-0x1a4` | `*0x4c(MaterialManager)` result | surface/damage scalar |
| `-0x1ac` | `*0x54(MaterialManager)` result | surface/damage scalar |

Then scaled by `BFSoldier::getDamageDampingFromActiveKitParts` (`× -0x1b0`,
`0x8154d73`), shaped by the 10/30 m/s thresholds, and gated by the `test $0x45`
at `0x8154c6b` (below → `0x8154c78 ret`, no damaging dispatch).

So the engine damage is **kinetic / speed-squared** (a `|v|²` term), not linear
in drop height. For a Wake-airstrip fall that reaches ~15–20 m/s, `|v|²` ≈
225–400 × the material/scalar factors → easily ≥ 30 HP, lethal. The prior
`(drop − 1.0)` reading (which I shipped) structurally omitted this `|v|²`
term and under-fit by an order of magnitude.

**Outstanding (do not ship another hand-calibrated guess):**
1. Exact numeric value of `-0x1a0` and whether it is `(v·n)`² or a `v·n`-times-constant.
2. What `*0x4c`/`*0x54` on the MaterialManager return for terrain/ground (the
   per-surface scalar), and the constant scalar that turns `|v|²` into HP.
3. Exact `test $0x45` branch polarity (`0x8154c71`, and the 10/30 compares).
4. The freezing of `-0x1d8` relative to the `+height` term — confirm the fall
   height term (`0x8154d20` block) is folded into `-0x1a8/-0x1a0` or replaces
   one of the factors.

Best calibration anchor: the user's measured Wake-airstrip fall is lethal in
game (≥30 HP). Fix the viewer model with the confirmed kinetic shape and
calibrate the scalar against that ground truth.

### Decode result (2026-09-18, agent re-derived + lead cross-checked)

`-0x17c` = `cosθ` = dot(unit impact speed, unit surface normal) ∈ [-1,1]
(prologue normalizes both via `BaseVector3::normalize` at `0x08061d10`, then
dots them at `0x81549a8`–`0x81549d5`). Therefore:

```
-0x1a0 = cos³θ                       (0x8154a93–8154ab2: flds -0x17c; fmul st,st; fmuls -0x17c)
-0x1a8 = (S_obj · |v|²)              (0x8154c01–8154c1f; the *0x4c(%ebx) object result, then ×|v| twice)
-0x1a4 = M1  (= *0x4c on MaterialManager 0x871d43c)
-0x1ac = M2  (= *0x54 on MaterialManager 0x871d43c)
severity = cos³θ · (S_obj·|v|²) · M1 · M2     → *0x15c (handleDamage) → Armor::damage
```

For a straight-down foot fall cosθ = 1 → damage ∝ `(S_obj · M1 · M2) · |v|²`
with `|v|² = 2|g|h` — a **kinetic (½µv²) collision law**, matching the
`projectiles-collision.md`/Damage-System family
(`damage = MaterialDamage·DamageMod·cos(angle)·DistanceMod`). This is why the
linear `(drop−1.0)` reading under-fit ~15x: it omitted the |v|² kinetic term.

Confirmed constants (agent + lead): `0x86b01b4`=30.0, `0x86b9314`=10.0,
`0x86c0314`=20.0, `0x86c08c4`=2.0, `0x86c08c0`=8.0 (all floats verified).
Still to settle: the exact value of `S_obj` / the MaterialManager M1·M2
scalars for ground/terrain (the per-surface DamageMod from the damage tables),
and the `test $0x45` exact truth table. Viewer model: use the kinetic shape
and calibrate the scalar against the user's measured Wake-airstrip lethal fall.

---

## Correction and closure, 2026-09-19 (parity round, stream F1 + verifier V1)

Everything this document reaches for is now read. Three corrections and the
numbers, in the order they matter.

**1. The dispatch slot.** `*0x15c` is **not** `BFSoldier::handleDamage` on a
soldier sub-vtable. The receiver at every site is `this`, the **GameServer**
(`mov esi,[ebp+0x8]` `0x08154cb3`; `mov ebx,[esi]` `0x08154cee`; `push esi`
`0x08154d11`; `add esp,0x30` = 12 words, matching a 9-argument signature and not
`handleDamage(float)`'s 2), and slot `+0x15c` of the GameServer vtable
(`0x0871b0e0`) is
`GameServer::giveDamage(IObject*, float, int, int, int, Pos3, int, bool, bool)`
`0x0814b2e0`. The actual call is
`giveDamage(getRootParent(obj), severity, -1, -1, -1, hitPos, attMaterial, false, true)`.
The conclusion — a falling soldier loses hit points — stands; only the mechanism
was misidentified, and it is *not* soldier-specific: **vehicles take collision
and ground-impact damage through the same call** (see
`features/bf1942-engine-reference/subsystems/collision-response.md` §9, read
independently the same day).

**2. The 8.0 is on the soldier path after all**, and it is the reason this
document's calibration attempts kept over-fitting. The soldier branch starts
*earlier* than the range read here: the `CID_BFSoldierTemplate` test at
`0x08154a81` jumps to `0x08155189`, which does `fsub ds:0x86c08c0` (the 8.0),
**overwrites `|v|` with the reduced value**, and **returns with no damage at all
if the result is negative**. Every downstream use — the `speedMod·|v|²` kinetic
term, the 30.0 saturation, the 10/20 lerp — then uses `|v| − 8`.

**3. There are two formulas.** `arg6 == 1` (material 1 = Water) branches at
`0x08154a89` to a duplicate of the whole path at `0x08154e4f` whose only
difference is a single `fmul st,st(0)`: `A = |cosθ|²` in water,
`|cosθ|³` on land. That is what "LandOrWater" in the function name means.

The settled soldier formula, with the height term this document only had in
part, and the branch polarity it flagged as unresolved:

```
|v| -= 8.0 ;  if (|v| < 0) return
F   = getLastCollisionHeight() - pos.y
X   = (F < 2) ? 1 : F - 1
Q   = max(1, X * getDamageDampingFromActiveKitParts())
A   = |cos|^3 (land) or |cos|^2 (water), lerped to 1 over 2 <= F < 3 and over 10 < |v| <= 30
severity = Q^2 * A * (Armor.speedMod * |v|^2) * damageMod(att, def) * materialDamage(att)
applied only when severity > 1.0        // fucom vs 1.0 at 0x08154c6b, je taken on >
```

The `Q²` is `d8 ca` then `de ca` at `0x08154dbb`/`0x08154dbd` with `Q` in
`st(2)` — unusual, flagged for a verifier by the research pass, and confirmed.

**The scalars this document lists as outstanding.** `S_obj` is
`ObjectTemplate.speedMod` on the victim's Armor (`Armor::getSpeedMod`, vtable
`+0x4c`, `0x08173fc0`) — **0.5** for a vanilla soldier. Extracted from
`Game.rfa`, for **every** terrain material 0–15,
`damageMod(ground, 40) = 0.001` and `materialDamage(ground) = 30`, so
**M1·M2 = 0.030**; water is `1.5e-05`, i.e. `0.00045`, about 67× gentler. That
independently corroborates this document's fitted `M1·M2 ≈ 0.026`.

**Where the live version lives now.** Ledger row **HP-14**, and
`features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md` §5, which
carries the formula and a worked table at the engine's own `g = −14.73`:
nothing below ~3.5 m, first damage at ~4 m, death at ~7.5 m for a 30 HP
soldier landing flat. The vehicle and object-versus-object cases are ledger
COL-3/COL-4 and `collision-response.md` §9.3–9.5. This document is history from
here.

Still genuinely open: whether `Armor+0x28` tracks the apex of a fall rather
than the last contact height.

## Closed (2026-09-20, wave-2 stream A): the scalars were in the damage tables all along

The two things this document left open are settled, and the viewer no longer
carries a fitted constant. Ledger **HP-14** is the row; the verified brief is
`features/bf1942-parity-round-2026-09-19/viewer-changes.md` item 23.

**The missing 8.0.** `0x086c08c0` was on the "confirmed constants" list above
but not in the model. It is subtracted from `|v|` *first* — `fsub ds:0x86c08c0`
at `0x08155189` overwrites the speed at `0x0815519b` and the function returns
at `0x0815519e` when the result is negative — so the kinetic term, the 30.0
saturation and the 10/20 lerp all read the **reduced** speed, and an arrival
under 8 m/s does no damage at all. That single omission is most of why the
first magnitude reading missed: without it the formula is about 8x too severe
at 5 m, which is the error the fitted constant was quietly cancelling.

**`S_obj` and `M1·M2` are ordinary table entries.** `S_obj` is
`Armor::getSpeedMod` (vtable `+0x4c`, `0x08173fc0`) and the vanilla soldier
declares `SpeedMod 0.5`. `M1` and `M2` are `damageMod(att, def)` and
`materialDamage(att)` with the **ground** as attacker and the soldier's
`Material 40` as defender — which the extractor has been writing into
`_shared/damage.json` since long before this question was asked. Read out of
the shipped file: for **every** terrain material 0–15,
`materialDamage = 30` and `damageMod = 0.001`, so `M1·M2 = 0.030`. Water
(material 1) is `1.5e-05`, about 67x gentler, and takes `cos²θ` instead of
`cos³θ` through the duplicated path at `0x08154e4f`.

The old fitted `FALL_KINETIC_HP = 10` implied about 0.026. It was close because
0.030 is the real number; it was wrong because one scalar cannot also carry the
8.0, the squared height term, the angle and the water case.

**Two more terms the groundwork did not have.** `Q = max(1, X·kitDamping)` with
`X = 1` below a 2 m fall and `F − 1` above it, and **`Q` is squared**
(`fmul st,st(2)`, `fmulp st(2),st` at `0x08154dbb`/`0x08154dbd`). And the whole
severity is delivered only when it exceeds **1.0**.

### Where it lives now

`tools/bf1942-models/viewer/fall-damage.js` — the formula, the constants and
the table lookup, importing nothing so it tests under node.
`tests/test_fall_damage.py` is 15 assertions over
`tests/fall_damage_harness.mjs`.

`SoldierBody` supplies the inputs, and two of them needed the body's help:
the impact speed has to be sampled **before** `#settle` zeroes `velocity.y` to
plant the feet, and the height is `getLastCollisionHeight() − pos.y` — the
height of the last *contact*, not the airborne apex the viewer used to track.
That difference is visible: a jump straight up is billed `F = 0`, and a jump
off a ledge is billed the ledge rather than the apex above it.

### Measured

Driven on the page (`map.html?mod=bf1942&map=wake&shots`, The Airfield, dry
sand, 30 HP, no kit damping, `g = −14.73`), health restored between drops:

| drop | HP lost | HP left |
|---|---|---|
| 1.0 – 3.9 m | 0 | 30 |
| 4.0 m | 1.19 | 28.81 |
| 4.5 m | 2.19 | 27.81 |
| 5.0 m | 4.18 | 25.82 |
| 6.0 m | 10.86 | 19.14 |
| 7.0 m | 21.74 | 8.26 |
| 7.4 m | 28.63 | 1.37 |
| 7.6 m | 30 | **dead** |

By bisection in the node harness: first damage at **3.97 m**, death at
**7.55 m**. The same 10 m drop into water costs **1.55 HP** against 103 on
land — the 67x the two `damageMod`s predict.

### Still open

`Armor.speedMod` is read from the vanilla soldier's `.con` rather than from a
per-template field the viewer tracks, so a mod declaring a different `SpeedMod`
is not yet honoured. `kitDamping` is 1.0 because no vanilla kit declares
`DamageDamping`; `BFSoldier::getDamageDampingFromActiveKitParts` `0x0827ec00`
has not been read, so what a kit that *did* declare it would produce is
unverified. Neither affects any vanilla fall.
