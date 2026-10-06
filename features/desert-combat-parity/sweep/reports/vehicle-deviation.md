I've built it: vehicle, stationary and aircraft guns now fire in their own deviation cone, for the local player, the bots and any other player the world fires for. A bot pilot's own guns are the exception: I measured the jets as you asked, and they fit no draw index, so I left them firing straight. The full suite passes (5,039 tests, 10 skipped), and a live-page check of a Sherman hull gunner matched the harness.

**What was wrong.** `FireArms::fireBarrel` applies the deviation law (DEV-9) to every gun, but the viewer only gave hand weapons a cone. Every vehicle round flew exactly down its line, while the seat crosshair opened as if they scattered.

**Engine read (lnxded), new ledger rows DEV-11 to DEV-13 (claimed in the IDs file):**
- **DEV-11:** a seat gun's cone is just the floor (`setMinDev`) plus the fire bloom, plus a bot's AI term. It has no stance, speed, turn or misc channel, so neither the hull's motion nor the turret's traverse widens it. The bloom is the same per-pull raise hand weapons have. The seat updates its guns' cones once a tick while someone holds it.
- **DEV-12:** the cone total is stored once a tick, and both the round and the crosshair read that stored value. A pull's own bloom reaches neither, so the first round of a burst flies at the floor.
- **DEV-13:** a bot's trigger runs one extra update every tick it fires, so a bot's bloom decays twice a tick.

**Lab check (the 19 vanilla and 36 DC server recordings that track projectiles):**
- **DEV-12:** subtracting this law from the bots' MG round sizes leaves a residual whose most common value is +0.300 to +0.325, which is the AI term's 0.3125 floor. Under the other reading (the pull's bloom counted) it sits at +0.05 to +0.075.
- **DEV-13:** with one decay a tick, 19% (Browning) to 56% (coaxial MG) of bot rounds fall under that floor; with two a tick it's 1.6% to 8.6%, against a 2.2% baseline.
- **The owner's own seat-gun rounds:** only 14 coax rounds could be fitted, all from a moving Sherman. All fall inside their square, but that's too few to choose between the two DEV-12 readings.

**What changed in the viewer:**
- `fire-state.js` keeps the stored total and the bot's extra decay.
- New `seat-cone.js` hands each round its total and draws: random for humans, the bots' fixed point for bots.
- `round-launch.js` asks for that cone for every gun that isn't a hand weapon.
- A coax or pintle gun's square now sits on the seat camera's own axes, so it rolls with the hull.
- Replayed rounds and the model browser get no cone. The seat crosshair needed no code change and now reads the same total the rounds use.

**Your input on the bots work:**
- `bot-deviation.js` is now byte-identical to the bots branch head (7bba0873), and my code uses its index functions.
- Seat MGs still draw at index 617, so a seated bot's rounds land where the lab puts them.
- Trial merges show no conflict with main or the bots branch. If that file moves again, take the bots copy.

**Jets, measured, not built:**
- A-10 at 40° and MiG-29 at 27–37°; F-16 at −90° and F-14 at −88°, in the plane's frame.
- Their sizes match the AI term, but a seated bot's index would put them at 50.7°, which fits neither cluster.
- It isn't a mounting roll; the MiG-29's direction moves with bank, which suggests the platform-velocity estimate in turns contaminates the fit.
- Aircraft gunner seats do fit (the B-17's gunners sit at 79–84°, near 617), so those keep the cone.
- Hand-flown guns are unaffected either way; no fighter or jet gun has deviation words.

**Checks:**
- **Harness** (`test_vehicle_deviation.py`, 10 tests): 2,000 rounds from the Sherman's hull Browning all fall inside the ±0.5 square, uniformly. A held burst's totals go 0.5, 0.656, 0.812, 0.968, then a steady 1.056, exactly the law's. The Sherman's main gun stays tight.
- **The DC Bradley's 25 mm stays tight:** DC ships no deviation words for it (nor for the BMP-2 cannon or the Shilka), so it has no cone at all.
- **Page:** the Sherman hull gunner fired 30 rounds through the live map page and matched the harness totals, all inside their square.
- **Runner:** headless El Alamein bots' MG42 totals ran 1.01–2.40, against a lab median of 1.71.

**Behaviour change and expected test edits:** the replay HUD's seat crosshair now opens one tick later (first round 0.75, not 1.01). That's DEV-12, and I updated those tests; `replay*.js` itself is untouched. The feature README has the before/after spread for every gun with deviation words in vanilla, XPack1/2 and DC; vanilla MGs reach ±0.29° to ±0.43° at the floor and up to ±1.43° held.

**Files outside my list, and why:**
- `map.html`: the import plus five lines wiring the cone, next to the existing gun wiring.
- `sim/stage.mjs` and `sim/env.mjs`: the same wiring for the headless runner.
- `bot-deviation.js`: the identical copy of the bots branch's file.
- The replay HUD tests, which DEV-12 moved.
- Docs: the ledger, `symbols.json`, the deviation subsystem note, the knowledge skill's topic map, `features/README.md`, and the crosshair-hit-marks README's stale "vehicle guns have no cone" line.
- I also merged main (1cf7d440) into the branch to resolve a conflict in the knowledge skill's topic map.

**Assets:** none to re-extract; the shipped models and level bakes already carry each gun's deviation block.

**Open, or for other packages:**
- **Hand weapons (hand-weapons package):** under DEV-12 a hand weapon's round still includes its own pull's bloom, one shot early.
- **Bots (bots package):** the AI term's extra against air targets (30/10 for a single trigger, 3/1 for a held one) is never passed by `bot.js`.
- **Bot pilots' guns:** which draw index or frame they use is unread.
- **DEV-13's window:** the extra decay runs from each bot round for the gap to his next, and stops when the world reports the trigger released. That's a stand-in; the engine's exact window is the bot's trigger statement, which the viewer's bot plan doesn't expose.
- **Humans:** draws come from the viewer's random dice rather than the engine's input index. That only matters once the room server fires rounds itself.

**For the DC parity table** (your file, report only): "Vehicle guns fire with no deviation cone at all" can go to fixed, except bot pilots' guns.

**Commits** (`main..HEAD`): 582fc979, ac9be146, 0ac3d29c, ffe06ce4, the merge 6c4ad54a, 873bb6fd, d8a75f47, 657913c7, 94164052, c6272e67. Scratch scripts are in `~/.cache/dc-sweep/vehicle-deviation/`, and the build record is `features/vehicle-gun-deviation/README.md`.