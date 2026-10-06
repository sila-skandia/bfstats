**Verdict: LAND WITH FIXES.** Land it after con-reader (`worktree-agent-afeb6e4077bf05be1`), and add one line to a con-reader test when merging (below). Nothing solid in retail loses collision in any tree we bake.

Merged onto current main plus con-reader, the full Python suite passes: 4,740 tests, 0 failures, 10 skipped. That is with the four textual conflicts resolved and my fix to con-reader's fixture. The merge guard `test_the_bare_spelling_reaches_the_word` passes on that merge.

**My commits on `worktree-agent-a3c87e7c8f9ebab90`:**
- `2de50cc5`: ledger renumber.
  - COL-15..17 are now COL-16..18 and the bool row CON-16 is now CON-17, with every citation updated.
  - This branch's duplicate CON-15 row is gone, so the citations now point at con-reader's CON-15.
  - The addresses that row had and con-reader's lacks went into BOMB-13 (`blastAmmoCount` registered as type 1 at `0x082ac0d0`; `getType` `0x080753e0` reads `+0x4`) and GUN-17 (the two stabilization words at `0x081b4736` and `0x081b4804`). I checked them in the binary.
- `6895e84d`: the A-10 test failed once merged with main (613 pulls instead of 1,350). It pinned the old heat law (146 rounds to first overheat, 106.4 s to empty) inside a 600 s cap, and main's newer heat law takes 1,371 s to empty the gun. The test now checks only the 1,350 pulls of one round, with an hour's cap.
- `5c1916a0`: two tests of my own through the real exporter build (detailed below). Each fails against a deliberately broken version of the rule.
- `08f891f2`: the feature README now records my two bakes, the census gap and the merge fixture.

**For the lead at merge time:**
- Four files conflict textually: `ledger.md`, `manned-guns.md`, `symbols.json` and `con.py`. In each, keep both sides; in `symbols.json`, join the two notes on `findLodGeometry`.
- After merging, add `ObjectTemplate.setHasCollisionPhysics 1` to the `Hull` bundle in `test_assemble.py` `GeometryScaleExportTests.LIBRARY`. Without it the new rule correctly gives that fixture no hull, and con-reader's `test_the_part_draws_and_collides_scaled_and_says_so` fails.
- A resolved reference merge is on the local branch `review-engine-reads-merge` (`cc2fccc6`). It predates the README commit `08f891f2`, so take the README from the branch.

**What I checked in the binary**
- **COL-16:** the setter (`0x081bcd20`) writes bit 1 of `+0x70`. The template constructors clear it (`& 0x90`). No other setter or template constructor writes that bit, except Projectile's, which sets it (`or 0x0f`). The object constructor turns it into flag `0x200` (`0x081da420`), and the flag-update code passes nothing to children.
- **COL-17:** the broadphase keeps a root only when `(flags & 0x2000200) == 0x2000200`. `setParent` sets `0x2000000` only for a null parent. A part joins its root's chain only with flag `0x200` and a geometry. A LodObject's alternatives are not linked as siblings (`setParent` zeroes the link), so only the first alternative is walked.
- **COL-18:** `findLodGeometry` reads as the row says.
- **BOMB-13:** the `blastAmmoCount` descriptor is a bool of type 1 that writes `+0x348`. `fireFinished` and `Fire`'s partial-salvo gate both test it as described.
- **CON-17:** the bool read stores a value only when it is 0 or 1 (`0x0867997c`).
- **GUN-17:** across the whole image, only the setters, the constructors and the printout touch `+0x1a5`/`+0x1a6`.

**The bakes.** I baked Gazala (vanilla) and Operation Bragg (DC) before and after the rule, both with con-reader merged; the fix agent had used El Alamein and Basrah's Edge. I probed every lost hull with the viewer's own collider: rounds and a 0.3 m soldier sphere, at three heights, four directions each.
- **Gazala** loses 8 roof lamps and nothing else. A lamp's hull is a 1 cm two-face quad, so nothing a player touches changes.
- **Bragg** loses:
  - the 4 roof lamps;
  - the barracks' far-mesh hull, while the near mesh still stops the sphere on all 12 probes;
  - the 21 × 5 × 17 m `Mi24DWreck`, which now lets spheres and rounds through. Its template never says the word, and neither do any of the 33 vanilla or 42 DC wreck templates;
  - 6 worn parts of kit pickups (helmets, a grenade).
- The hangars and factories I used as controls block the same before and after.
- The data matches the census: Basrah's Edge's fenceposts and treepots, and XPack2's Mimoyecques rail, say `setHasCollisionPhysics 0` explicitly in their level copies, which load first and win.

**BOMB-13 against main's hand weapons.** The A-10 GAU-8, the SU-25 gun and the Minigun have one barrel, and the SA-342 pods use `asynchronyFire`, so DC's refused `5` and `2` change nothing. In the hand, a shotgun has no magazine state of its own, so every pull fires all 8 pellets and `hand-fire.js` charges one round. Main's `test_hand_aim` already confirms the 8 pellets.

**Findings**

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| Ledger IDs collided with sibling branches | ID allocation file | Medium | Yes, `2de50cc5` |
| A-10 test pinned main's old heat law | 613 ≠ 1,350 on the merge | Medium (red suite after merge) | Yes, `6895e84d` |
| con-reader's scale fixture has no `hasCollisionPhysics` | Failed on the merge | Medium | Fix specified above; verified on the scratch merge |
| Census skips objects held by spawners | Bragg loses 6 kit-part hulls the census did not list | Low (blast-radius table is incomplete) | Documented in `08f891f2` |
| The deep borrowed-mesh search and the own-mesh root had only scope-level tests | My new tests | Low | Yes, `5c1916a0` |
| The engine tests a borrowed mesh at the root's transform; the exporter places it at the child's | Read in `getFaceCollision` | None in the trees we bake: 0 of 298 borrowing roots across the five trees have an offset | No change needed |
| Not stated in the report: weapon model files gain a `blastAmmoCount` field on their next re-extract | `Remington.glb` has 8 barrels and no flag today | None: nothing in the three vanilla packs or DC reads it with an effect | n/a |

**Gaps for other packages**
- Bots fire one ray per round, so bot shotguns hit with one pellet (`bot-referee.js`).
- The replay HUD (`replay-hud.js`) does not know `blastAmmoCount`.
- `hand-fire.js` charges one round a pull for multi-barrel hand weapons that lack the word (FH, FHSW, bf1918).
- Under main's heat law, a held A-10 cannon slows to about one round a second after 43 rounds; that is for the heat-law package to confirm against retail.
- Outside extraction scope: vanilla's own `stonebridge_1/2_m1` say 0, so bg42 and bf1918 bridges become passable if those mods are ever baked. Worth a lab check first.
- The level re-bake commands in the fix report stand. Bake only after con-reader is in.

Scratch is in `~/.cache/dc-sweep/review-engine-reads/` (6 MB, the bakes deleted): `probe.mjs`, `lent_offsets.py`, `gazala_probe.json`, `bragg_probe.json`, and suite logs under `logs/`.