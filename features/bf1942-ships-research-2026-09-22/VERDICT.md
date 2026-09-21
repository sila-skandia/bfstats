# Second reader's verdict on W6-E (ships)

Adversarial re-derivation of [README.md](README.md) (committed `6024efd`). Every
address below was re-read from the binaries by this reader, not taken from the
report. Decompiles via `features/bf1942-engine-reference/lnxded/decompile.sh`;
every sign, comparison direction, subtraction order and clamp sense re-read in
`objdump -d -M intel`; `./xref.py check` reported MATCH
(`60c9452d…cd3699`, 16,611 functions) before the one client address was taken,
and the client bytes were additionally read straight out of the PE by file
offset rather than through Ghidra.

**Headline: the report is unusually solid on the law itself and wrong on what
the law implies for submarines, on how fast a ship settles, and on the one thing
it could not test.** Two of its conclusions reverse, one build-order step does
not survive, and the open question in §7 has a different primary cause than the
one it nominated.

---

## 1. Per-claim table

| # | Verdict | Evidence, one line |
|---|---|---|
| SHIP-1 | **CONFIRMED** (with two corrections to the wording) | `0x0824d640` re-read instruction by instruction: `f`, the `!(f<0)` early return, `max(f,−1.0)` at `0x086b05ec`, `lift=(1−t)·min+t·max`, `DX·DZ` from bb `+0xc−+0x00` and `+0x14−+0x08` (x and z, *not* x and y, from the two `fsubr` at `0x0824d878`/`0x0824d87d`), `/−9.82` at `0x086d0d6c`, world-vertical `addAccelerationAtAbsolutePosition` at `+0x68` with the node's own `P`. Vtable slots `+0x98 getDrag` / `+0xa0 getMass` / `+0x74 getTangentSpeed` / `+0x68` all confirmed against `vt.py 'world::PhysicsNode'`. Client entry `0x0057e980` confirmed from PE bytes. Corrections: `t` is computed from the **unclamped** `f`, and `g/−9.82` is **exactly 1.5**, not 1.49995 |
| SHIP-2 | **CONFIRMED** (one sentence corrected) | All eight equilibria reproduce to 4 dp from the archives (`Fletcher_Floater` H 20 lift 2 relY 7.5 ×8, etc., `GeometryTemplate.waterLevel 20`); Midway's pads read 20.4371/20.4372/19.8651/12.7351/12.7078 (team 2) and 20.473/20.451/19.5996/12.6481/12.6481 (team 1) exactly as the report says. The framing sentence "every spawner on Midway is within 0.7 m of the Allied ship's equilibrium" is false for the two submarine pads (6.10 m out) |
| SHIP-3 | **CONFIRMED** (scan re-run independently, and strengthened) | My own function-scoped scan of all 2,359,213 `objdump` lines: `+0x1b0` and `+0x1c0` appear on a `FloatingBundleTemplate` only in the two ctors `0x08240880`/`0x082408f0`, the setters `0x08240ff0`/`0x08241070`, and `makeScript` `0x08240a50`. Stronger than the report: **no getter exists at all** (`nm -C` lists no `getWaterHeight`/`getDragModifier`), and the two setters have exactly one caller each — `ConsoleClass86::executeObjectMethod` `0x082492c0` and `ConsoleClass87::executeObjectMethod` `0x08249590`, i.e. console glue only |
| SHIP-4 | **CONFIRMED** (three numeric/wording corrections) | `0x082402b0` re-read: only `0x14` arms `node+0xb0`; `0x15` sets `+0xed` and leaves the rate; `0x13` clears `+0xee`; `q = clamp((2R+Δz+Δx)/(4R),0,1)`, rate `= (q+0.1)·0.05·tmpl[0x1c4]`, single reader `fmul [edx+0x1c4]` at `0x08240551`. Corrections: it lowers the reference plane rather than raising the waterline; `q` spans ~0.30–0.70 on a capital ship, not 0–1; and the raft claim is wrong |
| SHIP-5 | **CORRECTED** — conclusion stands, the quoted body does not | `0x083d7a80` is **not** `return *(float*)(this+0x30)`. It is `ecx = this+0x18; jmp WaterPatch::getWaterLevel()` → `0x083d96f0` = `fld [eax+0x18]`. The net read is `*(float*)(patchTerrain+0x30)`, so the *conclusion* (flat sea, both arguments discarded) is right, but "nothing on the physics path calls `WaterPatch::getWaterLevel`" is false — it calls the no-argument overload every tick. The **wave-adding 3-arg overload `0x083d9700` has zero callers and appears in no vtable** anywhere in the image, which is a stronger negative than the report claims |
| SHIP-6 | **CONFIRMED** (one qualifier, one addition) | `0x0824cbb0` re-read in full: `& 1` early return, the `P.y < wl` / `& 8` pair at `0x0824cc89`/`0x0824d047` exactly as described, `rho`, the signed-square `K`, force at the engine node via the **root**'s `+0x68`, the two propeller roll arms (20.0 / 400.0). `c_ETShip = 9` proved from `operator<<(ostream&, EngineType)` `0x0823ef60`: case 1 → `c_ETPlane`, 2 → `c_ETCar`, 6 → `c_ETTank`, **9 → `c_ETShip`**, 0x11 → `c_ETRocket`, 0x19 → `c_ETTorpedo`. Qualifier: `getCurrentRatio()` is **rev-dependent**, so 7.447 is a max-rev value, not a constant. Addition: `c_ETTorpedo` also carries bit 3 |
| SHIP-7 | **REFUTED** on its headline claim | The submarine does **not** "sink without limit". `t` is computed from the *unclamped* `f`, so as the boat goes deeper `t` climbs back toward 1 and the lift recovers. The stable equilibrium is at **depth = angle_Y + 0.5 m**, where `t = 0.5` and `lift = (min+max)/2 = 1.2275`, and `8 × 1.5 × 1.2275 = 14.73 = |g|` **exactly**. The trim angle is a **dive-depth setpoint in metres**, capped at 50.5 m by `setMaxRotation 0/50/0`. Also refuted: Gato/Sub7C are **not** the only vanilla `FloatingBundle`s with `maxRotation.y != 0` |
| SPAWN-1 | **CONFIRMED** | `0x083140a0` re-read: `*(char*)(template+0x185)` tested against zero only; ctor `0x08314a70` defaults it to 0; whole effect is `pco_iface->+0x6c(mTeam)` → `PlayerControlObject::setTeam` `0x0831a5f0` = `+0x170 = team; ++0x174`. Midway's four ship spawners all declare `teamOnVehicle 1` with `setObjectTemplate 2 <US>` / `1 <IJN>` and instance `Object.setteam 1`/`2` — the data matches the model. (The string-literal and `>> bool` proofs were already settled by the lead; not re-spent) |
| SPAWN-2 | **CONFIRMED** | `iStack_70 = param_1[0x4d]` (+0x134) is the `std::map` key at the top of `spawnObject`; miss → returns `0xffffffff` with no fallback; ctor `0x08312910` seeds `[0x4d]` and `[0x4e]` from `template+0x15c`; `setTeam` `0x08313810` has exactly three callers, confirmed by `--sym`: `ControlPoint::CPEnable` `0x082840e0` (site `0x8284182`), `ControlPoint::CPDisable` `0x08284200` (site `0x82842e0`), `ConsoleClass137::executeObjectMethod` `0x082b5be0` (site `0x82b5c3d`) |
| SPAWN-3 | **CONFIRMED** | `pos = this->+0x38() + (param_1[0x54],[0x55],[0x56])` = `+0x150/154/158`, ctor-copied from `template+0x174/178/17c`; rotation from `getRotation(this->+0x40())`; no vanilla sea spawner authors `spawnOffset` |
| SPAWN-4 | **CONFIRMED** | `0x08163d70` is `if (soldier) soldier->vtable[+0x3c](this->vtable[+0x38]()); return soldier != nullptr;` — nothing else, `mov eax,0x1` / `ret` in 0x2f bytes |
| SPAWN-5 | **CONFIRMED** | `0x08163dd0` re-read in the report's stated order: object active byte `+0x13c`; nearest `IID_IArmor 0xc4a4` → `+0xcc isCriticalDamaged` → return 0; combat area in x/z (`game+0xbc`/`+0xc4`, else `terrainBase +0xc`/`+0x10`); material veto `terrainBase+0x4c` vs `GameServer+0x2c0 & 0xff`; height gate on `template[0x59]` = `+0x164` vs `spawnPos.y − max(terrainHeight +0x44, waterLevel +0x5c)`; `BFfindEntryPoint` with `0x40a00000` = 5.0 / `0x41700000` = 15.0 behind `+0x161`/`+0x162` |
| SPAWN-6 | **CONFIRMED where it is the report's own work; the rest is FLAGGED as re-read** | The report's own new claim — that Midway's shipped scene carries the hull collision layer and the triangles are in the index — I verified in the running viewer: a downward cast at each of the ten fleet instances' origins hits that instance's own owner id (261–270). The engine half (pair filter, soldier-is-vertex-side, faces-from-col1, friction carry, mass share) is a **re-read of `collision-response.md` §5.2–5.4 and §8**, which the report says plainly and which I did not re-derive either. It should enter the ledger citing those rows, not as a fresh read |
| SPAWN-7 | **CONFIRMED** (table incomplete) | `Bf1942/Game/GlobalSpawnGroups.con` (in `Mods/bf1942/Archives/bf1942/Game.rfa`) reads exactly 64/65 → 1, 66/67 → 2, 68/69 → 2, 70/71 → 1, 72/73/74 → 2, 75/76/77 → 1. The report's "75+ Shokaku → 1" hides four more groups and gets one wrong by implication: **78 Sub7c Driver → 1, 79 Gato Driver → 2, 80/81 Alternative Fletcher → 2, 82/83 Alternative Hatsuzuki → 1**. Groups 72 and 75 also carry `onlyForHuman 1` |

---

## 2. Corrections in full

### 2.1 SHIP-7 reverses. The submarine's trim angle is a depth setpoint. (load-bearing)

This is the one claim that would wreck a build. The report's §6 table says that above
`angle_Y ≈ 2.8` the lift is `floatMinLift`, `8 × 1 × 0.8275 × 1.49995 = 9.93 < 14.73`,
and "**buoyancy can never cancel gravity, the boat sinks without limit**". Ledger
row SHIP-7 repeats it.

It is a fixed-point error: `t` was evaluated at the *surfaced* depth and then
treated as constant while the boat sinks. In `0x0824d640` the order is

```
 824d716:  fdiv st,st(1)        ; f = ((P.y - H) - wl + sinkOffset) / H
 824d718:  fst  [ebp-0x17c]     ; store f  -- NOT a pop
 824d71e:  fmulp st(1),st       ; f * H          <-- uses the UNCLAMPED f
 824d724:  fsub [esi+0xa0]      ; f*H - angle
 824d72a:  fchs                 ; angle - f*H
 824d72c..824d74a               ; clamp to [0,1]  -> t
 824d756:  fucomp st(1)         ; the  f < 0  gate
 824d763:  fld [0x86b05ec]      ; -1.0
 824d76f:  test ah,0x45 / jne   ; f = max(f, -1.0)
 824d778:  fstp [ebp-0x17c]     ; only NOW is the clamped f stored
```

So the force uses `max(f, −1)` but **`t` uses `f` unclamped**. Submersion depth
`−f·H` therefore keeps growing past `H`, `t = clamp(−angle_Y + depth, 0, 1)`
climbs back to 1, and `lift` climbs with it. The equilibrium is a proper root:

```
solve   N · min(depth/H, 1) · lift(depth) · 1.5  =  14.73
with    lift = (1-t)·floatMinLift + t·floatMaxLift,  t = clamp(depth - angle_Y, 0, 1)
```

Numerically (bisection on the exact law, both boats, N = 8):

| `angle_Y` | Gato depth | Sub7C depth | `t` at equilibrium |
|---|---|---|---|
| 0 | 2.489 | 3.243 | 1.0 |
| 2.0 | 2.784 | 3.243 | 0.784 |
| 2.8 | 3.300 | 3.599 | 0.500 |
| 5 | **5.500** | **5.500** | 0.500 |
| 10 | **10.500** | **10.500** | 0.500 |
| 20 | **20.500** | **20.500** | 0.500 |
| 50 | **50.500** | **50.500** | 0.500 |

Once the hull is fully submerged the solution is `depth = angle_Y + 0.5` for both
boats, independent of `hullHeight`, and it is stable (deeper → `t` up → lift up →
pushed back; shallower → the reverse).

The reason it lands on `t = 0.5` is the clincher that this is deliberate design,
not an engine accident:

```
floatMinLift 0.8275 , floatMaxLift 1.6275   ->  midpoint 1.2275
8 nodes x 1.5 x 1.2275  =  14.73  =  |g|      EXACTLY
```

DICE centred the pair on `|g| / (N · 1.5)`. The report's 1.49995 for `g/−9.82`
obscures this — the ratio is exactly 1.5 (`9.82 × 1.5 = 14.73`).

**Corrected ledger wording for SHIP-7** (replace the row's verdict and evidence):

> SHIP-7 | (new) A submarine needs a bespoke dive law | — | **confirmed as the
> same law, and the angle is a depth setpoint** | `GatoFloater`/`Sub7C_Floater`
> declare `RotationalBundle` words on axis 1. `FloatingBundle::handleUpdate`
> `0x08240180` calls `RotationalBundle::calculateAndClipAngle(axis 1)` — gated on
> `maxRotation.y > 0` (`0x082401cd`, `tmpl+0x160`) **and** on `this+0x50 != 0` —
> and writes `node+0xa0 = −angle[1]` (`+0x144 = +0x108 ^ 0x80000000`), then
> copies `+0x144` into `node+0xa0` unconditionally. That angle is SHIP-1's `t`
> term. **`t` is computed from the UNCLAMPED `f`** (`fst`, not `fstp`, at
> `0x0824d718`; the `max(f,−1)` store is at `0x0824d778`), so submersion depth
> keeps driving `t` after the buoyancy magnitude has saturated. The fully
> submerged equilibrium is therefore `t = 0.5`, `lift = (min+max)/2 = 1.2275`,
> and `8 × 1.5 × 1.2275 = 14.73 = |g|` exactly — so **the trim angle is a dive
> depth in metres: the boat settles at `depth = angle_Y + 0.5`, stable, capped at
> 50.5 m by `setMaxRotation 0/50/0`.** It does not sink without limit. The
> degrees/metres mixing is real but is the point, not a bug; `setMinRotation
> 0/0/0` and the commented-out `setAutomaticReset` are why trim is
> one-directional and sticky, and `setMaxSpeed 0/2/0` + `setAcceleration 0/1/0`
> make the setpoint move at up to 2 m/s.

Consequential corrections elsewhere in §1.3:

- "**`t` only matters in the first metre.**" → true **only when the bundle angle
  is 0**. With a non-zero angle `t` transitions over `depth ∈ [angle_Y,
  angle_Y+1]`, at any depth.
- "If `N × lift × 1.49995 < |g|` the ship cannot float at all, whatever its
  depth." → the bound is `N × floatMaxLift × 1.5`, not `N × lift`. For Gato that
  is `8 × 1.6275 × 1.5 = 19.53 > 14.73`, so it floats.

### 2.2 The `1 + 24f` damping is real, and so is the reversal — but "settles inside a second" is wrong by 1–2 orders of magnitude

The formula is confirmed from the bytes, exactly as the report transcribes them:

```
 824d890:  fld  [ebp-0x17c]        ; f
 824d896:  fld1
 824d898:  fxch st(1)
 824d89a:  fmul [0x86ccce0]        ; f * 25.0
 824d8a0:  fxch st(1)
 824d8a2:  fsub [ebp-0x17c]        ; 1 - f
 824d8b3:  faddp st(2),st          ; (1-f) + 25f  =  1 + 24f
 824d8c3:  fmul [0x86b01ac]        ; * 100.0
 824d8cc:  fmulp st(1),st          ; * DX*DZ
 824d8d7:  call [eax+0x98]         ; * getDrag
 824d8f7:  fdivr [ebp-0x17c]       ; / getMass
 824d90b:  fmul [ebp-0x24]         ; * vy
```

`0x086ccce0` = 25.0, `0x086b01ac` = 100.0, `0x086b05ec` = −1.0, `0x086d0d6c` =
−9.819999694824219: all four verified with `vt.py --float`. So `1 + 24f` with
`f ∈ [−1,0)` runs `+1 → −23` and the sliver `f ∈ (−1/24, 0)` really is
anti-damping. **The reversal is real; the report's reading survives.** That it
"reads like an intended `lerp(1, 25, |f|)` with a sign slip" is the author's
inference, not a read — label it as such — but it is a reasonable one and "port
it as written" is the right instruction.

What does **not** survive is the settling claim. Heavy damping on a soft spring
makes settling *slower*, not faster. Simulating the exact law at 1/30 s, using
the measured glb bounding box (`DX·DZ` = 18.73 × 133.86 = 2507 m² for the
destroyer hull, not the report's "roughly 12 × 120" = 1440), from each ship's
own authored pad:

| ship | pad y | equilibrium | y after **300 ticks** | still out by | ticks to ±1 cm |
|---|---|---|---|---|---|
| Fletcher | 20.4371 | 20.2250 | 20.3716 | **0.147 m** | ~2,510 (83.6 s) |
| Hatsuzuki | 20.4371 | 14.3625 | 14.5425 | **0.180 m** | ~655 (21.8 s) |
| Yamato | 12.7351 | 17.4542 | 17.4542 | 0.000 | ~101 (3.4 s) |
| Shokaku | 19.8651 | 20.3175 | 20.3175 | 0.000 | ~75 (2.5 s) |

Slow pole `≈ k/c` with `k = N·1.5·lift/H` and `c = N·drag·|1+24f|·100·DX·DZ/mass`:
Fletcher `1.2 / 33 = 0.036 s⁻¹` (τ ≈ 28 s), Hatsuzuki `2.4 / 10.1 = 0.24 s⁻¹`
(τ ≈ 4.2 s). Omitting the hull's own box drag makes this an *optimistic* bound.

**Corrected wording for the §1.3 bullet:**

> Drag and mass come from the hull and the area is the hull's bounding-box
> footprint `DX·DZ` (18.73 × 133.86 m ≈ 2,507 m² for the destroyer hull as
> exported). For a Fletcher (`drag 3`, `mass 2 500 000`) each node contributes
> about `−4.1·vy` m/s², so eight heave-damp at ~`−33·vy`. The system is
> **heavily overdamped** (ζ ≈ 15 for a Fletcher), so a ship never oscillates —
> and for the same reason it settles **slowly**: the slow pole is `k/c` ≈
> 0.036 s⁻¹, i.e. a 28 s time constant for a Fletcher and 4 s for a Hatsuzuki. A
> viewer that settles a fleet by iterating this law needs thousands of ticks, or
> should place the hull at §1.5's closed-form equilibrium instead.

### 2.3 SHIP-5: the body is a tail call, and the 3-arg wave overload is dead everywhere

```
083d7a80 <PatchTerrain::getWaterLevel(float,float) const>:
  mov  ecx,[ebp+0x8]
  add  ecx,0x18
  mov  [ebp+0x8],ecx
  jmp  83d96f0 <WaterPatch::getWaterLevel() const>     ; fld [eax+0x18]; ret
```

**Corrected ledger wording for SHIP-5:**

> `PatchTerrain::getWaterLevel(float, float)` `0x083d7a80` discards both
> arguments and tail-jumps to `WaterPatch::getWaterLevel()` `0x083d96f0` on the
> sub-object at `this+0x18`, which returns `*(float*)(that+0x18)` — the level's
> single `GeometryTemplate.waterLevel`, i.e. `*(float*)(patchTerrain+0x30)`. The
> wave form `WaterPatch::getWaterLevel(float,float,float)` `0x083d9700` (which
> does add `waterWave()` `0x083d98d0` times `[ebx+0x20]` to `[ebx+0x18]`) is
> **dead in the whole server image**: no `call` reaches it and its address
> appears in no vtable. Buoyancy, `PhysicsEngine::updatePhysics` and
> `BFSpawnPoint::getActive` all read the flat scalar through the same
> `terrainBase` vtable slot `+0x5c`. Ships do not bob.

### 2.4 SHIP-4: three smaller corrections

1. **Direction.** "The rate is a virtual **rise** of the waterline" is backwards.
   `f = ((P.y − H) − wl + sinkOffset)/H`, so a positive `sinkOffset` is
   equivalent to `wl_eff = wl − sinkOffset` — the reference plane **falls** and
   the hull chases it down. The consequence the report draws (the equilibrium
   drops by `sinkOffset` metres, 0.15–1.65 m/s at `sinkingSpeedMod 1`) is right;
   only the description of the mechanism is inverted. Say: *a per-node
   accumulator added to the numerator of `f`, which lowers that node's reference
   plane one tick at a time.*
2. **`q` does not span 0–1 on a real ship.** `q = clamp((2R + Δz + Δx)/(4R),0,1)`
   with `R` the hull's bounding radius (~70 m for a destroyer) and the float nodes
   at `Δz = ±50`, `Δx = ±5` gives `q ∈ [0.30, 0.70]`, so the rate spread is about
   **2:1** (0.020–0.040 m/tick at `sinkingSpeedMod 1`, i.e. 0.61–1.19 m/s at
   30 Hz), not the 11:1 that "a bow-starboard node gets `q ≈ 1`, a stern-port node
   `q ≈ 0`" implies. The bow-first pitch is real; its magnitude is not.
3. **The raft example is wrong.** `Elco80Raft` and `Type38Raft` each hang **four**
   floaters and all four are `PTRaft_Floater` / `Type38Raft_Floater` with
   `sinkingSpeedMod 0` — a shot-up raft does not sink *at all*, and it does not
   roll. The `_Floater2` variants (mod 7) are declared and **never added to any
   vanilla hull**. The ship that actually rolls as it goes down is the **LCVP**:
   three `Lcvp_Floater` at mod 1 and one `Lcvp_Floater2` at mod 7.

### 2.5 SHIP-6: `getCurrentRatio()` is not a per-ship constant

`PhysicsEngine::getCurrentRatio()` `0x0824ca70`:

```
ratio = 3.5 * *(float*)(tmpl+0x364)
      / lerp( curve[i], curve[i+1], frac )      i,frac from  (this[0x2f] / *(int*)(tmpl+0x360)) * 100
```

`this[0x2f]` is `PhysicsEngine+0xbc`, the current rev. So `3.5 · setDifferential
/ gearRatioCurve[100] = 7.447` is the value **at maximum rev only**, and "full
throttle from rest is `K = 1.1`, so 8.19 m/s² for a Fletcher" mixes a from-rest
`K` with a max-rev ratio. The arithmetic is right, the composition is not. Mark
the 7.447/3.723 figures as max-rev, and mark the 8.19 m/s² as **not a from-rest
figure** — it depends on TANK-12's rev filter.

Additions worth carrying, both new: `c_ETCar = 2` and `c_ETTank = 6` have bit 0
**clear**, which is why they return at the `& 1` gate; and **`c_ETTorpedo = 0x19`
carries bit 3**, so a torpedo's engine follows the *ship* water rule (throttle
pinned to 1.0 when the node is above the waterline), while `c_ETRocket = 0x11`
does not. That bears on BOMB-12's open torpedo-water-run item in W6-A's stream.

### 2.6 SHIP-7's "only vanilla FloatingBundles with maxRotation.y != 0" is false

Surveying every `FloatingBundle` in the vanilla `Objects` archives:

| template | maxRotation | minRotation | maxSpeed | acceleration | inputToPitch | autoReset |
|---|---|---|---|---|---|---|
| `GatoFloater` | 0/**50**/0 | 0/0/0 | 0/2/0 | 0/1/0 | `c_PIPitch` | (remmed) |
| `Sub7C_Floater` | 0/**50**/0 | 0/0/0 | 0/2/0 | 0/1/0 | `c_PIPitch` | (remmed) |
| `Torpedo_Floater` | 0/**1**/0 | 0/−1/0 | 0/0.1/0 | 0/−0.1/0 | `1` | **1** |
| `Shallow_Torpedo_Floater` | 0/**0.5**/0 | 0/0.5/0 | 0/0.1/0 | 0/−0.1/0 | `1` | **1** |

The two torpedo floaters declare the same words and pass the same
`maxRotation.y > 0` gate. They are behaviourally moot for lift (both author
`floatMinLift == floatMaxLift`), but the ledger must not say "the only". Note
also that `Shallow_Torpedo_Floater` has `min == max == 0.5`, which per GUN-2 is
*pinned at 0.5*, and both bind a raw integer `1` to `setInputToPitch` rather
than a `c_PI*` name.

### 2.7 Smaller factual fixes

- `g / −9.82` is **exactly 1.5**, not 1.49995. `getGravity` is
  `BasicPhysicsSystem::getGravity` `0x08251ec0` = `fld [eax+0x8]` — a field read,
  so −14.73 comes from configuration, not a literal in that function. Every
  1.49995 in §1.5, §6 and the SHIP-7 row should read 1.5; `8 × 0.8275 × 1.5 =
  9.93` and `8 × 1.2275 × 1.5 = 14.73` both stay true.
- The client ctor's `ret 8` is at **`0x0057e979`**, not `0x0057e97c`;
  `0x0057e97c`–`0x0057e97f` are the four `nop`s. Bytes at `0x0057e980`:
  `81 ec 40 01 00 00 / 56 / 8b f1 / d9 86 a0 00 00 00` =
  `sub esp,0x140; push esi; mov esi,ecx; fld [esi+0xa0]`, then `getParent` at
  `+0x18` and `setIsAwake` at `+0xd4`, then `fld [esi+0xb0]` — the server's shape
  exactly. The entry is proved; only the address of the `ret` is misquoted.
- `FloatingBundle::handleUpdate` `0x08240180` has a **second** gate the report
  omits: `if (*(int*)(this+0x50) != 0 && 0.0 < *(float*)(tmpl+0x160))`. `tmpl+0x160`
  is `maxRotation.y` (`maxRotation` is the Vec3 at `+0x15c`, GUN-1), confirming
  the report's gate; `this+0x50` is **not identified** and should be recorded as
  unknown rather than dropped. Note also that `node+0xa0 = this+0x144` happens
  *outside* both gates, every update.
- SHIP-2's framing sentence. "The authored `y` of every spawner on Midway is
  within 0.7 m of the Allied ship's equilibrium" holds for the destroyer, carrier
  and battleship pads (0.08–0.65 m) but not the submarine pads, which sit
  **6.10 m and 6.35 m below** the Gato's and Sub7C's draft. The paragraph says so
  two sentences later, so it contradicts itself; the ledger row must say "every
  pad except the two submarine pads".
- SPAWN-7's group table is incomplete: add 78 → 1, 79 → 2, 80/81 → 2, 82/83 → 1,
  and note `onlyForHuman 1` on 72 and 75. Midway's Hatsuzuki2 deck spawns use
  groups 82/83, which is why they read `team: 1` even on the team-2 pad — the
  report's mechanism is right but its table does not contain the groups its own
  example uses.
- `ObjectSpawner::setTeam` `0x08313810` does more than write `+0x134`: when
  `game->+0x74() == 3` it also writes `+0x120 = −1.0` and `+0x138 = team`. Not
  load-bearing for SPAWN-2, but the ledger row should not imply a one-line body.

---

## 3. Stated as fact, actually single-reader inference

Flagged so the ledger can carry them as `open`/attributed rather than as reads:

1. **"It reads like an intended `lerp(1, 25, |f|)` with a sign slip."** The bytes
   are read; the author's intent is not readable. Keep as commentary.
2. **"`hullHeight` … Read as a datum, not a dimension."** Correct as a
   description of the arithmetic, but "not the hull's height" is an
   interpretation; three of eight vanilla floaters set it close to the hull's
   actual freeboard.
3. **§1.5's "the level author placed each pad at one fleet's draft and let the
   engine settle the other."** An inference about authoring intent. It fits the
   destroyer, carrier and battleship pads and does **not** fit the submarine
   pads, so it should not be asserted.
4. **SPAWN-6's engine half** (pair filter, soldier-as-vertex-side, faces from
   col1, the friction carry, the mass share). The report says it "re-read rather
   than re-derived" `collision-response.md`; neither the author nor I went to the
   binary. The ledger row should cite COL rows, not present a new read.
5. **`getCurrentRatio` = `3.5 · setDifferential / 0.94`** — the `0.94` is cited
   from physics.md §5 and I did not re-derive `gearRatioCurve[100]`. With the
   rev-dependence above, treat the whole figure as inherited, not established.
6. **"a Fletcher's heave damping is ~`−19·vy`, so it settles well inside 300
   ticks"** — this was arithmetic on an estimated bounding box plus an
   unstated (and wrong) inference that large damping means fast settling. See §2.2.
7. **The `hull box roughly 12 × 120 m`** is a guess, hedged as "roughly" in §1.3
   but then load-bearing in the damping number. Measured: 18.73 × 133.86 m.

---

## 4. The deck-spawn page result — the report's biggest open item, closed

I ran the check the report proposed and then went further. Server:
`python3 -m http.server 5273` already serving the main checkout's
`tools/bf1942-models/viewer`; Playwright chromium; page
`map.html?mod=bf1942&map=midway&shots`; `__setOnFoot(true)` →
`__deploy.setTeam(1)` → `__deploy.select(i)` → `__deploy.spawn()` →
`__soldier()`, and `__colliderRef().statics.cast(...)` for the probes. Scripts:
`deckspawn2.mjs` … `deckspawn6.mjs` in this session's scratch.

### 4.1 What actually happens

Spawning on each of the eight fleet flags (`waterLevel` = 20):

| flag | soldier `y` | `statics.cast` down from `y+0.5` | up from `y+0.5` | verdict |
|---|---|---|---|---|
| Hatsuzuki (pad 1) | **20.000** | none | none | in the sea; authored 32.437 |
| Sub7c (pad 2) | 14.928 | none | none | 5 m under water, never placed |
| Shokaku (pad 3) | **20.000** | none | none | in the sea; authored 32.865 |
| Yamato (pad 4) | 23.994 | 23.994 (owner 265) | **27.979** | inside the hull, 4 m under the deck |
| Shokaku (pad 5) | **20.000** | none | none | in the sea |
| Sub7c (pad 6) | 14.780 | 14.780 (owner 267) | **16.760** | inside the hull, 5 m under water |
| Yamato (pad 7) | 23.907 | 23.907 (owner 268) | **27.892** | inside the hull |
| Hatsuzuki (pad 8) | 31.939 | 31.939 (owner 269) | none | **on the deck** — the only one that works |

The hull *is* in the collision index — §3.2 is right. A downward cast at each of
the ten fleet instances' own origins hits that instance's own owner (261–270),
and the Hatsuzuki carries 25 collision nodes / 1,414 triangles, the Shokaku 51 /
2,162, the Yamato 46 / 1,667, the Sub7C 4 / 275.

### 4.2 The primary cause is not `settle()` — it is a sign error in the extractor

`extract_map.py`'s `_vehicle_soldier_spawn_report` bakes

```python
wx = ox + (lx * cos_y - lz * sin_y)
wz = oz + (lx * sin_y + lz * cos_y)
... "position": [round(wx, 3), round(oy + ly, 3), round(-wz, 3)]
```

The rotation it uses is already the viewer-handed one (`gltf.quat_from_ypr`
gives the hull node `Ry(−yaw_con)`, and the ship's world quaternion measures as
yaw **+127.767°** for an authored `−127.767`, scale 1, with no rotation anywhere
in the parent chain). The extra `-wz` therefore applies the Z-mirror a **second
time**, to the rotated offset as well as to the pad origin. Net effect: the
cross terms flip sign.

```
baked    Δ = ( lx·c − lz·s ,  −lx·s − lz·c )
correct  Δ = ( lx·c + lz·s ,   lx·s − lz·c )       ( = shipNode.localToWorld(lx, ly, −lz) )
```

Measured against the live collision index, for all 26 deck spawns Midway's fleet
carries (`localToWorld(lx, ly, −lz)` on the drawn node vs. the value in
`scene.json`):

| ship / spawn | as baked | corrected |
|---|---|---|
| Hatsuzuki `DriverSoldierSpawn` (0/12/26) | **no hit** | deck 0.73 m below |
| Hatsuzuki `SoldierSpawn` (±4/9.4/−57) ×2 | **no hit** | deck 0.17 m below |
| Hatsuzuki2, same three | **no hit** | 0.73 / 0.17 / 0.17 |
| Sub7C `DriverSoldierSpawn` (0/2.22/−4.7), pad 2 | **no hit** | hull 0.09 m below |
| Sub7C, pad 6 | hit, but **3.6 m inside** the hull | hull 0.09 m below |
| Shokaku `DriverSoldierSpawn` ×2 (both pads) | **no hit** | deck 1.20 m below |
| Shokaku `AirCraftSoldierSpawn` ×2 (both pads) | **no hit** (one grazes) | deck 1.73 / 1.84 m below |
| Shokaku `DaihatsuSoldierSpawn` ×2 (both pads) | **no hit** | inside the boat bay, deck 2.7 m **above** |
| Yamato `DriverSoldierSpawn` (both pads) | hit, **2.7–3.1 m inside** | inside, deck 1.6 m **above** |
| Yamato `SoldierSpawn` ×2 (both pads) | **no hit** (one grazes) | deck 1.24 m below |

**26 of 26 baked positions are wrong. 21 of 26 have no hull under them at all**,
which is why the soldier lands on `surfaceHeight` = the water at y = 20 (or, when
the water is *above* the authored point, is never placed at all and stays where
the spawn put him — Sub7c pad 2 at y 14.928, five metres under). The corrected
positions all land over the hull, and — the decisive check — the drop to the deck
is **identical per template across both pads**, at two quite different yaws
(Hatsuzuki 0.732 / 0.166 / 0.165 on both; Shokaku 1.203 / 1.836 / 1.726 / −8.29
on both). A wrong convention could not do that.

The reason pad 8's Hatsuzuki works is degenerate: its authored yaw is 88.19°, so
`cos ≈ 0.03` and the mis-signed term is worth under a metre. Every pad whose yaw
is away from ±90° fails.

### 4.3 `settle()`'s down-only probe is real, and secondary

Three of the 26 spawns are authored genuinely inside the hull even at the
corrected position, and there the report's hypothesis is exactly right:

- `ShokakuDaihatsuSoldierSpawn` (con y 3.47, the stern boat bay) — 8.2–8.3 m
  below the first surface above it, deck at 26.0 against an authored 23.335.
- `YamatoDriverSoldierSpawn` (con (0/12.5/3.5)) — under the superstructure, with
  a surface at 26.85 above an authored 25.235.

`settle()` (`viewer/soldier.js:481-513`) probes from `y + 0.5` **downward** only
and then takes `max(staticHit, surfaceHeight)` with the ground candidate
rejected unless `ground <= from`, so the soldier stays under the deck. So the
report's candidate is confirmed — for 3 spawns out of 26, not for the 21 that are
simply in the water.

**Two independent defects, and the report nominated the smaller one.** Both are
worth ledger rows; the extractor one is a one-line fix, needs no buoyancy work at
all, and is what the owner is actually looking at.

Caveat: this ran against the **current** `scene.json`, which still has
`hatsuzuki` on the team-2 pads — `bf42/level.py` already carries W6-F's bool fix
(`spawn_vehicle` explicitly does not consult `team_on_vehicle`) but Midway has
not been re-extracted. Once it is, the Fletcher's own `FletcherSoldierSpawn` at
`relY 5` under a `relY 7.5` deck will be a *fourth* authored-inside case for
`settle()`. I could not test that: no Fletcher exists in Midway's current glb.

---

## 5. Does §8 and §9 survive?

`§8`'s file/line table survives with one addition and one deletion:

- **Add** `extract_map.py:1856-1860` (`_vehicle_soldier_spawn_report`'s
  `wx`/`wz`/`-wz`) as a **defect**, not a design change: negate only the pad
  origin, or equivalently mirror `lz` before rotating. This is the single
  highest-value line in the whole report's scope.
- `viewer/soldier.js:480-520` stays, downgraded to "needed for 3 of 26 deck
  spawns on Midway, and for the Fletcher once the team fix is re-extracted".
- `bf42/level.py:1309-1312` and `:1355-1356` are **already done** on main —
  `parse` stores `team_on_vehicle = flag != 0` and `spawn_vehicle`'s comment says
  it deliberately does not consult it. The rows should be marked landed, with the
  outstanding work being the re-extract of the ten levels.

`§9`'s build order **does not survive step 2**, and step 4 should move:

| step | verdict |
|---|---|
| 1 `teamOnVehicle` | survives; code landed, re-extract outstanding |
| **new 1b — the deck-spawn sign fix** | should be here, not at step 4. One line in `extract_map.py` plus a re-extract; no dependency on buoyancy; fixes 26/26 of Midway's deck spawns. An hour, not half a day |
| 2 buoyancy as a static settle | **does not survive as written.** "with §1.3 in the body world this is already the right place and the right budget" is false: 300 ticks leaves a Fletcher 0.147 m and a Hatsuzuki 0.180 m high, and its own acceptance test ("each within a few centimetres") would fail on two of eight ships. Either place hulls from §1.5's closed form (recommended — it is exact and free) or budget ~2,500 ticks and assert convergence rather than a tick count |
| 3 buoyancy at runtime | survives. Correct the diagnostic: a wrong `1 + 24f` sign or `DX·DZ` shows up as **divergence in the first `H/24` of submersion**, never as oscillation — the system is overdamped by a factor of ~15 and cannot oscillate |
| 4 deck spawns resolved live | survives as the *live-resolution* step, but it no longer "closes §7's open question" — §4 above closes it. Its remaining content is the ship-local offset in `scene.json` plus `settle()`'s upward escape |
| 5 sinking | survives. Correct the per-node spread to ~2:1 and the raft example to the LCVP |
| 6 propulsion | survives; add that calibration needs TANK-12's rev filter because `getCurrentRatio` is rev-dependent |
| 7 submarine dive | survives in cost (still `t` + a `RotationalBundle`) but its **acceptance test inverts**: a Gato must settle at `depth = angle_Y + 0.5`, stable, to a maximum of 50.5 m — not sink through the seabed |

Staged cost: "step 1 alone is most of the visible fix" is right for the *ship*
being wrong, but the deck-spawn sign fix is a comparable amount of visible fix
for an hour's work and belongs beside it. "steps 1–2 are about two to three days"
holds only if step 2 places from the closed form; an iterative settle needs a
convergence loop and its own budget experiment. 1–5 as a week still looks right.

---

## 6. What I could not reach

- **The 18-install survey counts** for `teamOnVehicle` (11,351 / 21,998 / 242 / 1).
  Not re-run; I verified only vanilla Midway's four ship spawners.
- **`Armor::status`'s crossing logic** `0x08173a0c`–`0x08173b7a`, so "a one-shot
  kill does not arm the sink" stays UNVERIFIED for me too. The report labels it
  correctly.
- **`teamOnVehicle 2`'s stored byte** — libstdc++'s `num_get<bool>`. Not read.
- **`BFSpawnPointTemplate+0x164`'s `.con` name.** Not attempted; the report's
  "unnamed rather than guessed" is the right call.
- **The second team consumer** at `*(void**)(pco_iface − 0xac)`, vtable `+0x24`.
  Not attempted.
- **`FloatingBundle+0x50`**, the second gate in `handleUpdate`. Not identified.
- **`gearRatioCurve[100] = 0.94`** and the rev filter's steady value. Inherited
  from physics.md, not re-derived.
- **Elco80 / Type38 mixed-floater equilibria** and **ship top speeds** — the
  report declines both and I did not attempt either.
- **Client twins** beyond `0x0057e980`. Not attempted.
- **The Fletcher's deck spawns after the team re-extract.** Not in Midway's
  current glb; predicted (relY 5 under a relY 7.5 deck) but untested.
- **The engine's own geometry bounding box.** My `DX·DZ` is measured off the
  exported glb, which includes masts and davits the engine's LOD geometry box may
  or may not. It is the right order of magnitude and it only strengthens §2.2's
  conclusion, but it is not the engine's number.
- **SPAWN-6's engine claims.** Re-read from `collision-response.md` by the
  author; not re-derived by either of us.

---

## 7. Symbols to add or amend

Every row in §10 of the report that I checked verifies at the address given, with
these amendments:

| address | amendment |
|---|---|
| `0x083d7a80` | `PatchTerrain::getWaterLevel(float, float) const` — discards both arguments and **tail-jumps to `WaterPatch::getWaterLevel()`** |
| `0x083d96f0` | **add**: `dice::ref2::geom::WaterPatch::getWaterLevel() const` — `fld [this+0x18]`, the scalar every physics reader ends at | 
| `0x083d9700` | `WaterPatch::getWaterLevel(float,float,float) const` — the wave form; **no caller and no vtable slot anywhere in the image** |
| `0x0823ef60` | **add**: `dice::ref2::world::operator<<(std::ostream&, EngineType)` — the enum table: 1 Plane, 2 Car, 6 Tank, **9 Ship**, 0x11 Rocket, 0x19 Torpedo |
| `0x0824ca70` | **add**: `dice::ref2::world::PhysicsEngine::getCurrentRatio() const` — `3.5·tmpl[0x364] / lerp(curve[i], curve[i+1])`, index `round(100·(this+0xbc)/tmpl[0x360])`; **rev-dependent** |
| `0x08240ff0` / `0x08241070` | **add**: `FloatingBundleTemplate::setWaterHeight` / `::setDragModifier` — one caller each, `ConsoleClass86::executeObjectMethod` `0x082492c0` and `ConsoleClass87::executeObjectMethod` `0x08249590`; no getters exist |
| `0x08251ec0` | `BasicPhysicsSystem::getGravity` (vtable `+0x14`) is `fld [this+0x8]` — a field read; −14.73 is configured, not literal |
| `0x0057e980` | keep, but the preceding ctor's `ret 8` is at **`0x0057e979`** |
| `0x0824d640` | note in the row: **`t` is computed from the unclamped `f`** (`fst` at `0x0824d718`, the `max(f,−1)` store at `0x0824d778`), which is what makes the submarine dive a depth setpoint |
