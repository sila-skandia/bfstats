**Verdict: LAND WITH FIXES.** I added five commits to `worktree-agent-ae41727e97787bba1`: `0e03f3ff`, `d5619fda`, `14a9221f`, `e16bf417`, `7e948e9e`. After merging, the lead also needs to apply one small patch for a conflict with main's kit pads (item 9 below). With that patch on newest main (`e39fc803`) plus the branch, the full Python suite passes: 4783 tests, 0 failures, 10 skipped. The only merge conflict is in `ledger.md`, where both sides appended a section at the same spot; keep both.

**One mistake of mine to know about.** A `git stash` / `stash pop` I ran popped the shared stash@{0}, "in-flight work: 18 files overlapping agent landings", into this worktree. It conflicted, so git kept the entry. I reset those 20 files in this worktree to HEAD and changed nothing else. The stash list is unchanged.

**Engine claims.** I re-read the load-bearing rows in lnxded (decompiled, with objdump for the branches) and in BF1942.exe:
- **Verified:**
  - Pick-up: 3-D distance, strict `<`, soldier class `0x9493`, own flag home. The thief at a base is the nearest player of another team; `Flag::handlePickup` refuses a dead one.
  - Drop on death: from `killPlayer`; a live carrier's drop is the capture.
  - Return by touch vs the 30 s timer.
  - Scoring and cap limit: the cap limit is checked per team, team 1 first, unsigned in CTF and signed in TDM.
  - ROUND-2: tickets end only modes 2 and 4. ObjectiveMode does end on the time limit by ticket share.
  - Victory-type comparisons, `setWinner`, `giveMedal`, and the debriefing line offsets.
  - The client rows (CTF-7, CTF-9) and the CTF-10 minimap constants.
- **Double-counted attack/defence:** confirmed. `scoreEvent` adds an Attack to the side once (`+0x18`) and a Defence once (`+0xc`). The fix is right.
- **Errors I corrected in the ledger:** CTF-8's string addresses were 0x48000 too low, and its "case 4 (and the default)" is wrong: the default case loads no AI. ROUND-8 left out ObjectiveMode's own debriefing branch (titles `VICTORY` / `DEFEAT` and the `setObjective*` lines); I recorded it as not built.

**Invented values.** The dropped flag's tilt was already read in CTF-5: up axis = terrain normal, right axis laid into the slope. I built it. The carried flag's position is still unread. The server files the flag as an item of the carrier's soldier (`BFSoldier::addItem`, which puts it on his weapon list); where the client draws it is unknown, so the code and README now mark the 2.9 m as the page's own choice.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| 1. A human seated in a vehicle when the round ended came back with no body and no spawn screen | Page run: after the restart, no seat, no soldier, no deploy screen. `restartRound` reads the pilot box, which a seat checks, as "not playing" | High | Yes, `0e03f3ff` |
| 2. No room client ever applied a CTF row | `netcode-client.js` copies event rows into the feed's common keys only, so `kind`, `player` and `position` were dropped. Ticket rows lost `count` the same way, so room ticket counts never synced either (pre-existing) | High (rooms) | Yes, `0e03f3ff`; new client test fails before the fix |
| 3. A flag that went home on its own timer stayed on the ground on every room client | `net-room.js` dropped rows with no actor | Medium | Yes, `0e03f3ff` |
| 4. A client joining mid-round drew every flag on its pole, including a carried one, and rows that arrived while its level loaded were lost | HELLO carried no CTF state | Medium | Yes, `14a9221f`: HELLO now carries a snapshot, the client queues early rows; tests in authority, room and page harnesses |
| 5. A dropped flag stood upright, though CTF-5 had read the slope | `ctf-page.js` header | Low | Yes, `d5619fda`; tilt confirmed in the page on XPack1 Santo Croce. The flag keeps its pole's heading, since the law doesn't carry the dead carrier's |
| 6. CTF-8 addresses and default case wrong; ROUND-8 missing the ObjectiveMode branch | Jump table `0x086ba1a8`; client `0x006ab0bc` | Low | Yes, `e16bf417` |
| 7. **No ObjectiveMode round ends on the page** unless `?gameTime=` is set | Every such layer sets only one side's tickets (BoB team 1; XPack2's six team 2). The old ticket rule would have ended them on frame 1 and restarted every 10 s, so the agent's change is still the better behaviour | Medium | No. Needs a new package for the objectives (BoB: a 900 s timer for the Allies, five destroy targets for the Axis). Documented |
| 8. Vehicles keep their state across a restart | A Corsair at 260 m hung there, unpiloted, through three restarts | Medium (already admitted as open) | Documented |
| 9. Merge conflict with main's kit pads: after a restart every pad is empty for its 45 s delay | Page probe on Desert Shield's M82 pads | Medium | Patch in `~/.cache/dc-sweep/review-round-rules/merge-seam-deployables.patch` (adds `deployables.restartRound()` and one call in `restartRound`). Tested on the merge: pads refill at once |
| 10. The two-browser room smoke is broken on main | Same failure on clean main: it never presses READY on the briefing, then "A never entered a vehicle". With READY added, join, deploy and walk pass identically on the merge | Pre-existing | No |

**Restart in the page.** Each run did three restarts back to back on the merge, with the page's own render loop stopped:
- vanilla Wake Conquest, with the human alive, dead on the death cam, in a Sherman, and flying a Corsair;
- DC Desert Shield CTF, carrying the flag at the end and dying with it;
- DC Final Basrah's Edge CTF, carrying the flag and dying with it;
- XPack1 Santo Croce CTF and Anzio Co-op;
- XPack2 Eagle's Nest TDM and ObjectiveMode.

After each restart, nothing leaked: the round's scores, clock and tickets were fresh, the flags were home, the bots were alive and out of their seats with plans and magazines reset, the spawn screen opened and the next spawn worked. There were no page errors. In node, I also ran repeated restarts of the round and CTF modules, with cap ends, bleed timers and rounds won all coming out clean.

**New gaps for other packages:**
- ObjectiveMode objectives (item 7).
- Resetting hulls to their pads on restart (item 8).
- The room server never restarts a round: after a cap or ticket end it sits in EndGame for good.
- The stale room smoke (item 10).
- The players can still move and fight during the 10 s EndGame, where retail's `clearWorld` empties the field.

Scratch scripts and results are in `~/.cache/dc-sweep/review-round-rules/`; the page runs are `restarts.cjs` and `padprobe.cjs`.