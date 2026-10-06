I recommend **LAND WITH FIXES**: the engine claims hold in the binary and in the lab's recordings, vanilla matches are unchanged, and I fixed two small defects on the branch. Everything is committed in `<repo>/.claude/worktrees/agent-afe34b28b14293bcc`, branch `worktree-agent-afe34b28b14293bcc`. Nothing is pushed.

**My commits** (no Co-Authored-By lines):
- `873f16a6`, `733d435f`, `f0c789d0`: merges of main, the last one of `a8bbe93e`. All were clean, including `hand-weapon.js` and `map.html`.
- `63100cf1` fix(viewer): a blast on a climber is not held for the let-go.
- `ad7ad2fa` fix(viewer): a man a blast threw has nothing in his hands.
- `16f1ee45`, `a373d0d6`: review notes and the open list in `features/bf1942-blast-and-bounce/README.md`.

**Tests on the `a8bbe93e` merge:** the full Python suite passes, 4904 tests, 10 skipped. The `test_bocage_match_route_failures` failure the fix report mentions is gone. A headless page check after the merge (DC and vanilla El Alamein) threw bots, held the dead landing, and had no page errors. Main has since moved to `5a3ba56c` (round-rules). It merges with no conflicts, but I have not run the suite on it.

**KNOCK-4..9 against the binary:** I re-read them instruction by instruction and all hold.
- **Push size:** `explosionForceMod × forceOnExplosion × (1/radius) × exposure`. The `1/radius` is computed once by `handleExplosion` and is not the damage falloff, so there really is no distance term. ×0.1 applies only when the underwater value is non-zero. The friendly-fire ratio is final over raw. Then it is capped at `explosionForceMax`.
- **"No falloff" and "nothing past half the radius" fit together:** the cut is a step. Past `d/r = 0.5` the force is set to 0, the zero push is still applied and the soldier is still stamped. Inside half the radius the push is the same at every distance.
- **Direction:** the axis choice (up, then forward, ties to right), its sign, and the `(1 − 5·d/r)`… more exactly `(1 − d/r) × 5` rise all match. I checked the subtraction's operand order by its opcode bytes.
- **One tick:** the push is added to the accumulator, spent over four quarter-ticks and zeroed, so he leaves at force ÷ 30 m/s.
- **Only bots get the get-up:** confirmed against the player's `getIsAIPlayer` check.
- **Defaults and fixed values:** 1 / 300 for the soldier pair, 150 for the round's force, and 0.5 / 5.0 for the cut and rise, with no console word that reaches the last two.
- **Vanilla's weapon-level `ForceOnExplosion`** is refused: the console only accepts it while a projectile template is active. A grenade's fuse explosion does pass its own projectile's force.

**Real game (65 lab server recordings, 114 thrown soldiers, speeds from the per-tick samples):**

| | Measured | The law |
|---|---|---|
| Largest single push, vanilla (Sherman, Priest, PanzerIV shells) | 19.0–20.5 m/s | 600 cap = 20 m/s |
| Largest single push, DC | 19.1–20.0 m/s | 20 m/s |
| DC RPG (force 20, radius 10) | 3.9–8.9 m/s | at most 10 m/s |
| Upward share of the push | 0.80–0.99 | matches the `(1 − d/r) × 5` rise |
| Landings | 112 dead `LandFront`/`LandBack`, 2 bot survive landings | KNOCK-2, KNOCK-8 |

Stacked blasts reached 28–35 m/s, consistent with pushes adding. Two things the data can't settle:
- No grenade victim was recorded, so the 12.5 m/s (vanilla) vs 20 m/s (DC) at 5 m is unmeasured.
- A round's last recorded position can be up to one tick of travel short of where it exploded. That is too imprecise to see the half-radius cut directly.

The RPG result does show the projectile's own force matters. Until the damage layer is re-baked, the page pushes RPGs at the default 150, which is about twice too hard.

**Vanilla:**
- **Seeded El Alamein (8 a side, 600 s, seeds 1 and 2):** both trace hashes are identical to main's, so kills and route failures are unchanged. Bots land almost no splash on men on foot.
- **Forced throws** (every bot on foot at the full 20 m/s, every 3 s or every 20 s), compared with the same seed unthrown:
  - No body went under the terrain, off the map or NaN, and no flight lasted more than 3.1 s or rose higher than 22 m.
  - El Alamein had 0 route failures.
  - Berlin went from 2 route failures to 183–225: bots thrown over rubble fail routes until the planner recovers.
  - Liberation of Caen throws bots into the river; its unthrown route failures are already about 26,000.

**Findings**

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| A blast on a soldier on a ladder was saved for the first tick after he let go: 3 s later he left the ladder at 22 m/s into the flight | The climb takes the tick whole, so the push was never spent; the engine sets the climber's speed each tick (LADDER-4) | Medium | Yes, `63100cf1`, with `tests/test_knockback_seams.py` |
| A thrown human could still fire, reload and zoom in first person | All ten lower explosion states set the hide-weapon flag; `Soldier.itemsLocked` only checked the swim | Medium | Yes, `ad7ad2fa`, tested |
| Bots still fire while thrown | The bots' on-foot fire loop checks no item gate (swimmers too) | Low | No |
| In a room, the local human is thrown locally and then pulled back | The page's splash isn't gated on room play, the server throws nobody, and corrections over 4 m snap | Medium (room play) | No, documented |
| Free fall can take over a flight in the real game; the page keeps the flight | 1 of 114 recorded throws went into free fall after 1.8 s | Low | No, documented |
| The headless runner pushes DC soldiers as vanilla (75 / 600) | `sim/stage.mjs` doesn't pass the soldier data | Low | No, documented |
| Before the re-bakes, every tree pushes at 75 / 600 and every round at 150 | The live DC soldier data lacks the new fields; a scratch extract has them (150 / 600, wrench 0.20) | Expected | Lead runs the asset commands |
| Soldier word survey across 16 mods: FH 150 / 600, EoD 75 / 600, no mod uses a `set`-prefixed spelling of the three words | Same data path as DC | None | n/a |

**Seams I checked and found right:**
- Seated soldiers aren't pushed (the engine gates on a victim with no parent; the page skips seated bots and a non-walking human).
- Under an open canopy he is pushed but not thrown into the flight.
- Water gives a tenth of the push.
- Landing is billed as an ordinary fall with the same law the game uses.
- An alive landing takes any contact; a dead one on a ceiling flies on.
- Replay files are untouched.

**New gaps for other packages:** the bots' item gate (weapons package), room-play splash and the server throwing soldiers (netcode), and passing soldier data to the runner (sim).