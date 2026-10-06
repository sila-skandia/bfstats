**Verdict: LAND WITH FIXES.** I added four commits on `worktree-agent-a84ec8081a9098a6d`. All are in the branch log and the tree is clean.
- `76e9c0c1` fix(exporter): only the kits among a level's pads open its own load (plus a test)
- `b8d2ce64` docs(engine): corrects one condition in SPAWN-13, and adds the review findings to the README
- `6b7f9138` docs: the service record's poses-only trees also need re-extracting
- `36f3de95` docs: the re-extract needs `9fc672db`, which has landed

The full Python suite passes on the final branch: 4619 tests OK, 10 skipped.

**For the lead when merging:**
- **Conflict with main.** `tests/test_extract_loadouts.py` conflicts with `9fc672db`, because both append a test class at the end of the file. Keep both blocks. I resolved it that way in a scratch merge and the loadouts, kit, viewmodel, deployables and ai-cover suites pass.
- **Conflict with spawner-pads.** The ledger's SPAWN-13 row conflicts with the spawner-pads branch (`agent-a779345840402c239`). Take kit-pickups' version; it has the corrected condition.
- **The /ai/ fix.** This package does not depend on the /ai/ bug or make it worse. Main's code and this branch's both gave DC 7 `aiWeapons` before `9fc672db`, and the agent's "52 kits" DC scratch file had lost them. In the scratch merge with `9fc672db`, DC's `loadouts.json` has 47 `aiWeapons`: the live 44 unchanged, plus `JohnsonLMG` from that commit and the pad kits' `M82Sniper` and `SA-7`. DC Final keeps 46, vanilla 24. The asset commands are safe to run once this is merged onto main.

**Findings**

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| The "byte-identical / only added fields" table is right in substance | My own scratch extractions, main's code against the branch's. Vanilla and XPack1: `loadouts.json`, `kits.json` and every glb identical, and vanilla matches the live tree. XPack2: only `pads`/`pickupSoldiers` on 2 kits. DC: exactly 2 new rows in each file and 2 pickup glbs (420 and 417 triangles, no missing textures). | — | — |
| The report understates DC Final | Its `kits.json` also widens `levels` on the three pad kits (7→22, 1→6, 1→2). XPack2's next `extract_viewmodel --kits` run will ask for 5 new `BritishCommandoSoldier` rigs. The report mentions neither. | Low | README corrected |
| The test for whether a level needs its own load counted vehicles on pads | Pads mostly place vehicles, so levels were opened for nothing: DC went from 1 such level to 11, bg42 from 1 to 17. Run time grew 4–7x (bf1918 17→71 s, bg42 16→112 s). The unfixed FHSW run reached 27 GB of memory and I stopped it. With the fix, output is byte-identical on 10 mods (DC, DC Final, XPack2, FH, bf1918, bg42, EoD, FinnWars, GCMOD, Interstate). The fixed FHSW run completed (2047 kits); I have no clean before/after time for it. | Med | Yes, plus `PadKitLevelLoadTests` |
| SPAWN-9..16 match the binary | I checked every cited address in `bf1942_lnxded.static`: symbol names, field offsets and defaults, word strings, the start delay, the delay formula, the slot loop, the control-point switch, the 2 m gate, the category strings, the class IDs, and `Kit::enable` (reached only through a vtable thunk at 0x082973e0, no direct call). | — | — |
| SPAWN-13 said a countdown "at 0 or below" bills damage | The binary bills only at exactly 0 (`and ah,0x45` / `xor ah,0x40` at 0x08319038). The viewer's `<= 0` gives the same result because the countdown is floored at 0, and no shipped `.con` in vanilla, the XPacks, DC or DC Final sets a negative `timeToLive`. | Low | Ledger corrected |
| vt+0xc8 against vt+0xcc | Settled. In the Armor vtable (0x0871d220), +0xc8 is `isDestroyed` (byte +0x110) and +0xcc is `isCriticalDamaged` (byte +0x111). `Armor::queryInterface` returns `this` and Armor has no secondary vtables, so the five calls through `[eax+0xc8]` in `handleFrameUpdate` are `isDestroyed`. The agent is right, and the sibling branch now uses the same text. | — | — |
| A team switch destroys the carried kit (a bug, but not new) | Retail `GameServer::setTeam` (0x08131800) kills a live player whose team changes, so his kit drops with its 30 s timer. The page's switch removes the soldier without a death, so the kit vanishes. Measured on port 5631: no kit dropped, the pad's slot emptied and its 45 s respawn delay began. The code dates from `cd9c15fc` (2026-09-19) and affects every kit, not just pad kits. | Med, pre-existing | Documented only |
| KITDROP-6 says "no team test" | The row says it, and `findKitObject` (0x0814a770) reads no team. | — | — |
| Pad kits in other mods (read-only scan of every level) | FHSW 1135 kits (836 placed only by pads), FH 237 (170), bf1918 164 (115), bg42 54 (16), EoD 51 (1), FinnWars 41 (29), Interstate 9 (7), GCMOD 6 (1); none in Pirates, vanilla or XPack1. Nothing crashed. Every bound template is a Kit with at least one soldier. The FH and FinnWars pad kits with no main weapon follow their mods' data (FH's slot kits are the same). EoD has 10 `_CHUTE` twins on pads that would draw no mesh, but EoD is out of scope. | Low | README updated |
| The agent's asset commands miss the service record's poses-only trees | `extract_kits` output changes for FH, bf1918, GCMOD, Interstate and FHSW, and the standing rule says those trees are re-run when it does. | Low | Commands added to README |
| Page re-check (my extraction, port 5631) | Desert Shield made 4 pads and left 0 baked piles. An Iraqi took the M82 and held it in `IraqSoldier__M82Sniper`. No page errors. | — | — |
| Other parts of the game | Pads are off in rooms (unchanged). Bots never pick up kits (KITDROP-8). The headless runner `sim/` looks kits up only by slot name, so no bot gets a pad kit. Replay files untouched. | — | — |

**New gaps for other packages**
- Switching teams on the deploy screen should kill the soldier, as retail does, so his kit drops at his feet.
- EoD's `_CHUTE` twins on pads draw no mesh.
- Already known from the agent's report:
  - Ordinary dropped kits still borrow the other side's arms in first person.
  - FHSW's `telemark-1943` ObjectSpawns file fails to parse.
  - `extract_pose --kit-poses` ignores pads.

Scratch outputs and scripts are in `~/.cache/dc-sweep/review-kit-pickups/` (the scan is `padscan/`, the page check `page_check.cjs`). The http server on 5631 is stopped.