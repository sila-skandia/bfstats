**Verdict: LAND WITH FIXES.** I added two commits on `worktree-agent-a08365fc0de41111f`: `5d3a6cab` (docs and comments) and `eedb8b6f` (a one-line fix). The branch merges cleanly onto current main, which already has air-input. On that merge the full suite passed (4,657 tests, 10 skipped; main alone passes 4,626, 10 skipped). After my commits, 558 neighbouring tests pass and a 55 s headless El Alamein match ran without errors.

**Should `ee962a9e` land? Yes. The real game backs it.**
- **Binary:** GUN-14 and GUN-15 hold, instruction by instruction:
  - A pull at heat 1 or more fires nothing (`Fire` `0x0828a0d3`).
  - The heat is added with no clamp (`0x0828a2f3`).
  - A refused pull starts the lockout only when the timer has run out (`0x0828ab30`..`0x0828ab6c`).
  - `handleUpdate` counts the timers down before its drain check, drains once per call only when both timers are out, and floors the heat at 0 (`0x08288ea4`..`0x08288f10`).
  - The `+0x304` field is already the per-tick drain: `makeScript` writes it ×30.0.
- **Lab recordings:** 35 vanilla server recordings hold 50,577 MG rounds. Bots stop a burst once heat reaches 0.8 (AI-130; I checked the 0.8 latch and the 0.5 release in `0x08555510`).
  - The longest bursts are 30 rounds on the MG42 and the Browning, and 20 on the coaxial Browning. That is exactly where the new law first reaches 0.8.
  - Under the old law that point would be the 60th round, never, and the 40th. No recorded burst ends above 0.827 under the new law.
  - `FireState` matches a float32 emulation of the binary over 46,714 recorded pulls, to within 8e-6.
- **What the recordings can't show:** bots never reach the lockout, so the 38 rounds to the first refused pull rests on the binary alone.

**Findings**

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| A hot M249 kept its heat into a new life | In the page: hold 65 rounds, redeploy with the same weapon, spawn at heat 0.86. The same-weapon spawn path re-pointed the rounds but not `hw.heat` | Medium | Yes, `eedb8b6f`: the probe now spawns at 0 |
| A held trigger after the lockout fires about twice the engine's rate (0.4–0.5 rounds/s against 0.2–0.3) | Every pull refused at heat 1 or more restarts the expired lockout (`0x0828ab30`), so each lockout buys one tick of cooling. `FireState` starts the lockout at the crossing round and never restarts it. The M249 and PKM also lock one round early (60/50 against the engine's 61/51) | Medium | Documented as open. The fix needs a refused-pull call from `hand-fire.js` and `world-vehicle-tick.js`; a `canFire` getter can't do it because it is read every frame |
| GUN-15 said the held trigger "fires one round before the next lockout" | Contradicted by GUN-14's restart. The MG42 actually fires one round per two lockouts, the coax one per four | Low | Yes, `5d3a6cab`, along with the lab confirmation in the ledger, README, test comment and `fire-state.js` comment |
| The page's bots don't stop firing at heat 0.8 | `bot-fire.js` mentions the overheat break but nothing implements it. Real bots never reach a lockout; under the new law, a page bot holding a vehicle MG's trigger locks out after 38 rounds | Medium | No, `bots` package |
| A kit picked up off the ground comes up cold | Not read in the binary. KITDROP-7 plus GUN-16's inference point to the heat coming with the kit | Low | Documented as open |
| DEV-10 | Server (`0x08293ff6`/`0x08294015`) and client (`0x005520b6`..`0x005520f4`, 0.01 at `0x8c409c`) agree on the deadzone and on `\|X\|` and `\|Y\|` times M times a per-weapon coefficient. The yaw is ×3.0 (`0x0827457d`), so 1.0 is 90°/s. Air-input reads the same mouse register (1.35 on foot, 3.85 in the air). Touch look also feeds it | OK | n/a |
| RPG-7 now spawns 0.73 m in front of the eye | Engine-faithful (XHIT-12/16). With the prone eye at 0.30 m, it spawns underground when aiming level up a slope steeper than about 21°, and it passes any wall closer than 0.73 m, because the round's sweep starts at the spawn point. Whether retail catches that segment is unread | Low | No, needs an engine read |
| "Vanilla unchanged" is not quite true | Vanilla bazookas are unchanged (no offset, no turn). Vanilla binoculars (`projectilePosition 0/0/2`) now launch 2 m ahead, which is engine-correct | Low | n/a |
| The single DC M249 bot burst ran 51 rounds, 3 past the 0.8 stop | One sample only; infantry fire-plan timing is unexplained. It doesn't contradict the law | Info | n/a |

**New gaps for other packages:**
- **`bots`:** port `BAPConWeaponHeat(0.8, 0.5)` to the fire plans, for vehicle MGs and hand MGs.
- **`fire-state` follow-up:** add the refused-pull call so a held trigger restarts the lockout.
- **`rounds` (already noted by the fix agent):** the engine's cone is a square in hundredths of a radian, not a disc in degrees (DEV-9), and bots fire shotguns as one pellet.
- **Engine read:** whether a projectile's first sweep starts at the eye or at the spawn point.

The re-extract commands in the fix report are unchanged. My scripts are in `~/.cache/dc-sweep/review-hand-weapons/`: `bursts.py`, `lawcheck.py`, `aicheck.py`, `restart.py`, `engine_hold.py`, `fsnode/cmp.mjs`, `fsnode/hold.mjs` and `respawn_heat.cjs`. The scratch worktrees are removed and the port 5634 server is stopped.