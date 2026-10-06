I recommend **LAND WITH FIXES**. The motor law itself is right: the lab's recorded rockets confirm it. But on its own branch it was off by up to 20%, and the AT-2 diverged numerically. Once I corrected two inputs to the motor and drag code, it matches the real game within 1%. The DEV-9 square cone is what the server recordings show for a human player. I merged the branch onto current main (dbbf7f11) and ran the full Python suite: 4758 tests pass, 10 skipped.

**The deviation cone (DEV-9) is correct.**
- **Binary:** I decompiled `FireArms::fireBarrel` and traced the x87 stack myself. Each axis draws its own uniform value in (−total, +total], scaled by velocity/100 (100.0 at `0x86b01ac`, 2⁻²⁴ at `0x86c4c10`), on the barrel-turned frame's up and right rows. Nothing is drawn at a total of 0.01 or less. The total is just minDev plus the channels plus the bot's AI deviation; `maxDeviation` plays no part (DEV-8 already says the engine ignores it).
- **Recordings:** the owner's 38 StG44 rounds in the 2026-10-05 parity run were fired running, so I took the soldier's own velocity out of each round's flight. Against the total predicted for each shot, all 76 per-axis offsets fall inside the square, the largest at 0.98 of it. A disc in degrees would have put about 31% of them outside.
- **Bots are different:** within a burst, a bot's rounds differ shot to shot only by recorder rounding (about 0.05 to 0.07 hundredths of a radian, over roughly 2,000 pairs). Every shot lands on the same point of the square, scaled by the total. The draw is seeded from `Game+0x68`, which `simulatePlayerUpdate` sets from the player's action buffer; I infer, without reading the writer, that a bot's buffer never advances.

**The rocket motor needed two fixes.** I measured speed against time for 25 MLRS, 53 AIM-9 and 7 AA-10 flights in the DC recordings.
- **Drag box:** the engine drags a round by its own `.sm` header box, not the mesh drawn for it. Main had already recorded this as COL-14. The branch used the drawn mesh, which is often a different dummy model. The AT-2 draws 1.44 m wide against a 0.25 m header, so it crawled at 16 m/s. The AIM-9's terminal speed came out 18% fast.
- **Acceleration cap:** the engine holds a full body's summed push to 1000 m/s² (already in the ledger as COL-8). The branch had no cap. Recorded AA-10s lose exactly 33.3 m/s a tick for five ticks; without the cap the AT-2 at 30 Hz reversed and ran away to 4×10¹¹ m/s.
- **After the fixes:**

| Round | t | Recorded (m/s) | Viewer (m/s) |
|---|---|---|---|
| MLRS | 0.5 s | 88.5 | 88.5 |
| MLRS | 3 s | 108.9 | 108.6 |
| AIM-9 | 1 s | 153.0 | 151.6 |
| AIM-9 | 10 s | 86.2 | 86.3 |
| AA-10 | 5 s | 70.9 | 71.0 |

- **The surprising speeds:**
  - **TOW and AT-5:** DC 0.7's versions have no Engine and this branch doesn't touch them. They fly straight at 100 m/s, as the lab shows.
  - **TOW past 800 m/s:** that figure is DC Final's `DefenderTOW`, which nobody fired in a recorded round.
  - **Hellfire:** about 83 m/s is the measured laws' answer. Its header box equals its drawn box, and drag 2 over mass 5 really is that strong. It is unrecorded.
  - **Spandrel:** both recorded Spandrels leave at 200.4 and 201.1 m/s relative to the BRDM-2 that fired them. The 191.3 m/s in the lab notes was the vehicle reversing at 9 m/s, so the 200 m/s default (FA-3) stands.

**Gravity, ID clash, and end-of-life burst:**
- **Gravity:**
  - **Vanilla rounds unchanged:** all 212 vanilla bullet entries in the shipped glbs declare their gravity, so nothing starts falling. Old tracers fall back to 0.
  - **Bots aimed flat:** they assumed no gravity for anything but shells, so their MLRS, Katyusha, BM-21 and SCUD-B rockets would have fallen short. The engine's bot aimer reads the projectile's own modifier, default 1.0; I fixed `bot-pilot.js` to match.
- **ID clash:** I renumbered this branch's rows to PHY-18..PHY-22 and SM-13 to SM-14, with every citation, per the registry. I claimed PHY-23 for the acceleration cap, then released it in the registry, because COL-8 already covers it.
- **`hasOnTimeEffect`:**
  - **Flak:** vanilla's AA_Allies, Flak38 and Carrier_AA guns set it and keep their airbursts. AA_POW and Yamato flak lose only the expiry burst and keep their proximity fuse, which is what the engine does.
  - **Artillery:** Priest, Wespe, Sexton, Katyusha and the mortars all land inside their lifetime at 45°.
  - **Naval guns:** the naval guns (Yamato, Fletcher, Prince of Wales, Hatsuzuki) can outlast their 10 s lifetime at extreme range and now vanish mid-air. That is engine-correct.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| Drag box measured from the drawn mesh, not the `.sm` header | COL-14; header boxes; recorded flights now within 1% | High (AT-2 at 16 m/s, AIM-9 18% fast) | Yes, `05a5dddd` (exporter writes `box`, viewer uses it) |
| No 1000 m/s² cap on a full body's summed push | COL-8, read at `0x08253570`; AA-10 loses 33.3 m/s a tick | High (AT-2 runaway at 30 Hz) | Yes, `8e52e7aa` |
| Bots aim rockets and bomblets without gravity | `WeaponFireArm::init` reads the projectile's +0x164 | Medium | Yes, `420ad1bd` (in the bots package's file) |
| PHY-16..20 and SM-13 clash with other branches | Registry | Docs | Yes, `322ab7ce`, `ad9c9c27` |
| The README's motor table was flown on the drawn boxes | — | Docs | Marked stale, `4138260b` |
| FHSW's tilted rocket engines push along the flight path | 66 of 237 engines tilted (Norden bombs at 0/30/0, lantern at 0/90/0) | Low (FHSW only; no worse than before) | Documented, `8677593d` |

**Assets for the lead, beyond the agent's list:** a model and level re-bake in DC and DC Final, so their glbs carry the new `box` word. The AT-2, Hydra, AIM-9, MLRS and Maverick boxes change. Vanilla and XPack header boxes equal their drawn ones, so their re-bake is optional. Until the re-bake, the viewer flies the drawn box with the cap.

**Gaps that belong to other packages:**
- **Bots:** `rollCone` rolls a fresh disc in degrees every shot, where the engine's bots hit one fixed point of the square scaled by the total. The bot aimer's drag term is also still passed as 0.
- **Vehicle guns:** they get no deviation at all in the viewer. Only hand weapons pass a cone. The engine applies minDev plus fire bloom to vehicle guns too: the Sherman's Browning has minDev 0.5.
- **Lab doc:** the Spandrel row in `lab-ground-truth.md` misreads the firer's own motion as a slower launch speed and should be corrected.
- **Unrecorded rockets:** Hellfire, Hydra, AT-2 and DC Final's TOW. A lab round with bots in AH-64s or Mi-24s at AI LOD 0 would settle the first three.

Everything is in `<repo>/features/rocket-flight/README.md` (new section 3a and Open items 9 and 10). Scratch scripts and the recordings analysis are in `~/.cache/dc-sweep/review-rounds/`.