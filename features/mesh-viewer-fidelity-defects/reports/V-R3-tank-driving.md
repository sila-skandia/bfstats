## Verdict summary

**18 confirmed, 1 corrected, 0 refuted, 1 unverifiable** among claims marked confirmed/corrected. Bridge MATCH. Safe to plan against for body thrust, SpinWheel, EngineGrip `v_tgt`, and the viewer double-thrust bug; do **not** trust the “no `materialFriction` in vanilla” sweep, and treat video speed bars as inference.

## Per claim

| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| 1 | Bridge / sha256 MATCH | CONFIRMED | `./xref.py check` → `60c9452d… MATCH` |
| 2 | Body thrust `a = fwd·K·ratio` at engine node | CONFIRMED | Client `0x0057bfb0`: `e=τ−ρ(v·fwd)/fade`, `K=0.1\|τ\|+e\|e\|`; lnxded `0x0824cfe6`–`0x0824d020` multiplies by `getCurrentRatio` then vtable `+0x68`. Throttle at `+0xa0` only |
| 3 | Gate `getFlags()&1` = `hasMobilePhysics` | CONFIRMED | lnxded `and $1` at `0x0824cc16`; console ctor `0x00511510` sets `param_1[1]=1`, name `hasMobilePhysics`; ShermanEngine `.con` sets it |
| 4 | `setTorque` sound-only (TANK-4) | CONFIRMED | Sole `getCurrentTorque` call site is `feedbackLoop` `0x0824c88a`; absent from thrust apply |
| 5 | Sherman ratio 4.0, gears 5 | CONFIRMED | `Physics.con`: `differential 4`, `numberOfGears 5`; matches settled TANK-3 |
| 6 | `SpinWheel` visual-only | CONFIRMED | `0x0825b440`: radius floor `0.05`, `angle += speed/radius`, wrap ±360°, `pitchIf` + `setTransformation`; no force apply |
| 7 | EngineGrip `v_tgt=(1−0.5·b)·R·diffRPM`, default `b=1` → 0.5 → 2.0 m/s | CONFIRMED | `addFriction` `0x0825c252`–`0x0825c346`: ratio×diffRPM, then `1−0.5·[+0xb8]`; ctor `0x0824c74c`/`0x0824c7cc` write `1.0f` to `+0xb8` only (no later PE stores) |
| 8 | Friction result × `g_simulationFps` (30) → vtable `+0x70` | CONFIRMED | `0x0825bc67` loads `0x08716b5c` = **30.0f**, scales, `call *0x70` |
| 9 | Coulomb / `RP+0xa8` / 9.82, 2.25, 1.5 (open) | CONFIRMED (partial as stated) | Cap setup at `0x0825b7c9` uses those constants; full µ·N form left open — agree |
| 10 | MaterialManager API; **no** `materialFriction` in vanilla RFAs | CORRECTED | API: `getFrictionForMaterial` `0x081751b0` reads mat `+0xc`; ctor sets manager `+0x20=0.1`; **no** direct CALL from `addFriction` (also **zero** direct calls binary-wide). **But** vanilla `bf1942/Archives/bf1942/Game.rfa` → `Bf1942/Game/materialManagerdefine.con` has **20** `MaterialManager.materialFriction` lines (0.1…10). Sweep “0 hits” is wrong |
| 11 | Wake mat 13 Sand Road; contact mostly 11 | CONFIRMED | `viewer/maps/wake/scene.json` histogram: `11` Wet sand 249019, `13` Sand Road 637 |
| 12 | Sherman mass/drag/diff/gears/4× EngineGrip… | CONFIRMED | Objects/Physics `.con`; TrackL/R each `addTemplate ShermanWheelL3/R3` **twice** → 4 EngineGrip @ strength 18 / damping 4 |
| 13 | Driven-wheel radius ≈0.255 m | UNVERIFIABLE (this pass) | No Sherman wheel mesh under tools to re-measure; accepted only as prior TANK-6, not re-derived |
| 14 | `fadeSpeed` default 100 | CONFIRMED | EngineTemplate ctor `movl $0x42c80000` → `+0x520`; thrust divides by that field |
| 15 | Launch **4.4** m/s²; sphere-drag top ~**31** m/s | CONFIRMED (formula) | Re-ran `vr3_predict_speed.py`: a0=4.40; v@10s ≈31.1–31.6 for r∈1.5–4 |
| 16 | Wake spawn / farm geometry + video timing | CONFIRMED (geometry) | Spawn `(1389.67, …, 737.147)`; farm2 ~11 m; farm1 ΔZ ~30.4 m. Timing→speed stays **inferred** as report says |
| 18 | Launch agrees; sphere-drag asymptote disagrees with video band | CONFIRMED | 4.4 vs ~3.5 compatible; ~31 vs ~8 band is real disagreement with that drag model |
| 19 | Body thrust undivided throttle; yaw only splits wheel targets | CONFIRMED (thrust) | updatePhysics reads `+0xa0` only; yaw via TANK-2 in `getCurrentDifferentialRPM` |
| 20 | Hull collision/response flags; viewer vertical-ray only | CONFIRMED | `.con` flags on PCO/Complex/springs; lnxded `checkObjectVsObject` / `checkVsTerrain`; `TrackedVehicle.#step` uses `groundHeight` rays only |
| 21 | Doc says TrackedVehicle unwired; map.html selects it | CONFIRMED | `ground-vehicles.md` still “Not wired into map.html”; `map.html` ~3659 maps tanks → `TrackedVehicle` |
| 22 | Viewer `driveAccel` per side → ~8.8 at yaw 0 | CONFIRMED | `driveAccel` returns `K*ratio` per side; `#step` applies both sides → 2×4.4=8.8 before circle |

## Load-bearing inferences

- **Video a₀ / v_cruise (± bars)** — implementer must not treat 8±4 or 3.5±1.5 as engine constants; hut timing without FOV/path calibration. Wrong bars → wrong “drop trackResistance” target.
- **EngineGrip opposition above 2 m/s as top-speed governor** — likely but open; shipping friction-only closure without Coulomb magnitudes can still overshoot.
- **“Barely moves” = throttle/surfaces or hull snag** — not proven; wrong diagnosis wastes the thrust fix.
- **Claim 13 radius** — if 0.255 is wrong, visual spin rate is wrong; longitudinal force law does not use `.con` radius.

## Anything the report missed

- Vanilla **does** author per-material friction via `MaterialManager.materialFriction` in `Game.rfa`; coupling into `addFriction` remains open, but “no strings” is false.
- `getFrictionForMaterial` has **no** direct near-call sites in lnxded `.text` (vtable-only or unused on dedicated) — stronger than “not from addFriction”.
- Manager `+0x20=0.1` is a ctor default field; `getFrictionForMaterial` itself reads material `+0xc` (or falls back toward 1.0), not `+0x20`.
