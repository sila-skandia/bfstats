**Verdict: LAND WITH FIXES.** I found two real defects in the package. Both are fixed on the branch, with regression tests that fail without the fix and pass with it. One defect would have reached the replay through the `ssc-specs.js` change.

My commits are on `worktree-agent-a20481fc1ba4e03dc`, in `<repo>/.claude/worktrees/agent-a20481fc1ba4e03dc`. None has a Co-Authored-By line.
- `26889a7c` fix(sound): DC's right-hand tracks start, and never beside their twin (`engine-audio.js`, `ssc-coherent.js`, `test_vehicle_parts.mjs`)
- `866b9a91` fix(audio): a replayed gun releases once a burst, not after every round (`gun-cycle.js`, `test_gun_burst_edges.mjs`)
- `a40960b5`, `884502d1`, `d2282fe8`, `c95484e4`: docs (ledger SND-12 and SND-18, `symbols.json`, the two feature READMEs)

## Findings

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| **A replayed gun played a release tail after every round.** A replayed group never sets `firing`, so `releaseTick` treated it as an unheld trigger 50 ms after each recorded round. This only became audible once `ssc-specs.js` began passing the edges. In the engine a remote player's held trigger holds the fire flag every tick (`handleMessage` 0x082895c0 sets +0x225, which I re-read). | My harness: 9 releases and 9 Release tails in a 1 s burst at 10 rounds a second, 6 at 5.7. After the fix: 1. The gun holds while `holdSound`'s window is open, the same window that already gates its Fire Loop. | High (a new per-round clatter on every replayed MG) | Yes |
| **DC's right-hand tracks never sounded.** `M1A1TrackR`, `T72TrackR`, `BMP2TrackR`, `M2A3TrackR` and `ShilkaTrackR` (in DC and DC Final) ship a looping `trigger Volume` layer. `#fire` skipped every loop, so a relatched patch never armed one. The IFVs lost half of their authored `VEALTTRACK` detune pair. | The real data shape had no source after 90 frames at 8 m/s. The agent's test modelled TrackR without the trigger, which hid this. | Medium | Yes: the loop is armed once while it has no source, so it never stacks |
| Arming that loop showed one frame of two `moderntreads` voices at one rate. `resolveAcross` skipped sourceless voices, and `apply` starts the armed loop after `resolveAcross` has run. | My platoon harness flagged 4 pairs for 1 frame each; 0 after the fix. | Low (about 70 ms of comb when a tank first moves) | Yes: an armed loop now contests on that frame |
| SND-12 was stale. It still said "Not built", and claimed a gun slower than 20 rounds a second releases between rounds, which the same `handleMessage` write contradicts. D9 in the README said the same. | Decompile of 0x082895c0 | Docs | Yes |
| SND-18 had left open what feeds `Speed` and `Acceleration`. I traced it: each update of a sounding patch (0x00802f70) calls 0x008026d0. That takes the patch owner (+0xbc), its root object (0x00508de0) and the root's physics-node velocity. So the agent's "part uses its hull's motion" is engine-correct. | Client disassembly | Was an inference, now verified | Ledger and `symbols.json` updated |
| SND-17, SND-20, SND-21 and SND-22 match the binary. | My own lnxded decompiles of `Reload`, `RotationalBundle::updateSound` and `LandingGear::handleUpdate`, plus vtables: PlayerControlObject and AnimatedBundle +0xe0 are the empty `SimpleObject::updateSound`, and `Wing::handleUpdate` never calls it. `initSound` runs from the SimpleObject constructor. | none | n/a |
| **A parked tank does not hum.** Every `always` loop in all 5 trees is silent at speed 0. The exceptions are ships' and PT boats' `flag.mp3` (only within 15 m) and DC Final's Humvee root radio chatter, which the engine rule says plays from creation. | `rest_volume.mjs`, using the viewer's own curve code | none | n/a |
| The coherence sweeps and edge sweeps pass on vanilla, XPack1, XPack2, DC and DC Final trees I patched in scratch with the branch code. The counts match the agent's (DC: 1229 arbitrated, 5384 part loops heard). The adversarial cases are clean after the fixes: two M1A1s turning together, an El Alamein platoon of 6 tracked templates ×2, a 4-Corsair squadron on Midway (staggered 0/4/20 frames), and DC Midway jets. FHSW's live scenes also gain 211 gun edges, and both sweeps pass there. | Logs in `~/.cache/dc-sweep/review-sounds/` | none | n/a |
| Vanilla guns' fire loops are unchanged. The `ssc-specs.js` change only adds the `press`, `release` and `reload` fields. The re-extracted `weapons.json` changes only `release` and `reload` in vanilla (14/18 weapons) and DC (25/43). The vehicle tables gain only `parts` and `reload`, apart from DC's stale entries. | Diffs against the live trees | none | n/a |
| The 3 failing `test_extract_vehicle_sounds` tests fail only because the trees still need re-patching. All 15 tests pass with `BF42_VIEWER_ASSETS` pointed at my re-patched scratch tree. | | none | n/a |
| `test_nav_baked` (306 route failures, limit 100) also fails. This is not from this branch: it fails identically at the branch base 70d0b6ea, and passes on current main and on the branch merged into main. The merge is clean. | | none | n/a |
| Many more audio voices per hull: a jet goes from 12 running loops and 5–7 HRTF panners to 42–54 loops and 22–29 panners, mostly muted. Headless Chromium benchmark: 150 HRTF panners cost about 21% of a core when silent and 79% when sounding. | `hrtf_bench.cjs` | Low/Med (audio-thread risk with 5 live jets) | No, reported |
| Two viewer-side constants (`GEAR_SNAP` = 2× maxSpeed, `PART_STILL` = 1e-3 deg/s) are documented heuristics, not engine laws. | | Low | No |

The full suite after my fixes: 4608 tests, the same 4 failures as above.

## New gaps for other packages
- **Air:** `aircraft.js` `autoGear` raises the gear on height alone and never reads `gearUpEngineInput`, so the Corsair's legs twitch on Midway's deck. Confirmed in SND-21's decompile.
- **Replay session:** seeking a replay re-poses turrets in one frame. That opens the servo for that frame (a small blip; only the landing gear has a guard against this). Replayed soldiers don't play reloads.
- **Netcode:** a remote player's reloads are not sent over the wire.
- **Cross-system arbitration:** `resolveAcross` covers only the vehicle rack. A ship's or PT boat's `flag.mp3` and the area pool's control-point flags would comb if you stood within 15 m of both. I met no such case.
- **DC Final re-patch:** it drops the AC-130's howitzer sound entry. Main's code does the same, so this is not this package. It looks related to MS-6.
- **Audio budget:** worth measuring in the page with several crewed jets.

**For the lead:** my fixes touch only the viewer and docs. The agent's re-extract and re-patch commands stand unchanged. New shared samples compared with the live trees: vanilla 17 (0.26 MB), DC 57 (0.75 MB), DC Final 74 (2.2 MB), XPack1 22, XPack2 21.