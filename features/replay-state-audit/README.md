# Replay state audit

**Question:** for a recording, how many of the states the file records for
each soldier on foot does the replay draw?

**Tool:** [`tools/bf1942-models/audit_replay_states.mjs`](../../tools/bf1942-models/audit_replay_states.mjs).
Tests: `tools/bf1942-models/tests/test_audit_replay_states.py`.

## Why

Between 2026-10-25 and 2026-11-02 users reported fifteen small replay
defects (the review is in the `replay-forensics` skill, section 5). Six were
states the recording carried that the page never drew: a kit pickup drawn in
the spawn kit, the recorded lower state replaced by one picked from speed,
survived hit flinches, the crouched and lying weapon draws. Every one of those
fixes quotes a count ("61 of 70", "49 of 152") made by hand after the report.
Checking the game binary would not have found them, because the recording
already held the answer. This audit makes that count before a user does.

## What it counts

The page plays the recording forward at 1x and records, every frame, what
each soldier it has a body for is drawn doing: whether a body is loaded and
visible, the lower and upper clip, and the kit. Node reads the same file with
the viewer's own reader (`replay-recording.js` `bodyAt`, `kitAt`, `lifeAt`,
`lowerHeldByLod`; `remote-gait.js` `recordedGait`) and compares the two. Only
soldiers alive and on foot are judged, and not while a blast or a parachute
holds the recorded pair.

| check | episode | drawn when |
|---|---|---|
| `lower` | a run of one recorded `Lb_*` state | half its frames (after 0.15 s) draw the state's gait family |
| `upper` | a run of one recorded torso action: fire, alt fire, reload, bolt, hit flinch, weapon draw, jump | any frame from its start to 0.3 s after its end draws that action |
| `kit` | a stretch where the drawn kit is not `kitAt` | a miss from 0.3 s; a failure over 1 s |
| `body.drawn` | a stretch with no body loaded and visible | a miss from 0.5 s; a failure over 2 s |
| `seek` | each soldier after each seek | the wait until his body is drawn (the first 3 s are not judged above) |

A far bot's resting lower state (AI LOD 1 or 2, AI-136) is excused frame by
frame: the page draws his speed there on purpose.

The run fails (exit 1) when a lower state or torso action with 5 or more
episodes is drawn under 80 % of the time (`--min-episodes`, `--min-share`),
or on any kit or body failure.

Out of scope: first person (eye, arms, viewmodel), hulls, sound, effects and
the HUD. The second row of the review (rules the engine reference already
had) and the third (laws only the binary gives) still need the checklist in
the skill.

## Running it

```bash
# the live site, the newest recording
flock /tmp/claude-1000/chromium.lock node tools/bf1942-models/audit_replay_states.mjs --recent 1

# local viewer code (a worktree's viewer needs link_viewer_assets.sh first)
flock /tmp/claude-1000/chromium.lock node tools/bf1942-models/audit_replay_states.mjs \
  --recording 8t224pppqe --serve tools/bf1942-models/viewer --json /tmp/claude-1000/states.json
```

`--serve <viewer dir>` serves that directory itself on the first free port of
5310-5359 (never 5273) and hands the page the recording from `/__audit/`.
The local glb store drifts from the live volume, so an asset the local tree
lacks is fetched from `--asset-fallback` (the live site; `none` turns it off).
Code (`.js`, `.html`) never falls back, so the page runs the code under audit.
A round of 240 s or less plays whole; a longer one plays four 60 s windows
spread over it (`--windows`, `--window`, or `--from`/`--to`). Allow about
real time plus a minute to load.

## Proof it catches the reported defects

Berlin, `8t224pppqe` (185 s, the recording the 2026-10-29 fixes were made
on), against the viewer at `47c8ce31`, before them, and at the current tree:

| | before the fixes | now |
|---|---|---|
| hit flinches drawn | 0 of 56 | 56 of 56 |
| weapon draws | 0 of 122 | 129 of 129 |
| jumps | 0 of 29 | 30 of 30 |
| `Lb_LieToStand` (the get-up) | 0 of 98 | 98 of 98 |
| `Lb_RunBackward` / strafes | 18 of 48 / 28 of 68 | 49 of 49 / 70 of 70 |
| kit | BF6 drawn as German_Scout from 24.0 s; he picked it up at 169.7 s | right |
| bodies after a seek | p50 6.5 s, 34 gaps over 2 s | p50 0.02 s, none |
| result | FAIL (9 rules) | pass |

Each line of the "before" column is one of the commits `7feb5ff1`,
`dd56cce6`, `f7a05f2d`, `80ca4a58`, `921acb3f` and `46501f33`.

## Findings on current code

- **Fixed:** a recorded hit flinch that lands in the tail of a reload the page
  is still playing was dropped (`SoldierActions.hit` refused any flinch over a
  reload). The engine takes the blow on the torso only once its reload is
  done, so a recorded flinch proves the reload was over. A replay's flinch now
  passes `recorded` and cuts the page's reload. Berlin: 50 of 56 before, 56 of
  56 after.
- **Open:** one lying grenade throw (`Ub_LieFireGrenadeAllies`, Berlin pid
  244 at 100.7 s) is drawn as the lying pose.

Omaha Beach, `ku8gdc58b6` (880 s, a public round of humans, four 60 s
windows), at the current tree: FAIL on jumps, 53 of 74 drawn. Fire 659 of
683, weapon draws 275 of 296, hit flinches 91 of 109; every lower state 95 %
or better; body and kit right on every frame. Open:

- **The held weapon does not follow the recorded item for some players.**
  Kerem (pid 30) at 103-108 s: the file has him jump with the Thompson, draw
  and throw two grenades and draw the Thompson again; his body holds a Colt
  the whole time, so every one of those torso states is drawn as the run.
  The jump, draw and fire misses largely cluster on players like this.
- **Hit flinches on humans not drawn** with no reload to blame (Thoibi,
  SrAGato, Slayer at 99.6-101.3 s, drawn `run.upper`): the page enters a
  flinch on a recorded hit-point drop, so check whether the file has the drop
  for these.
- **Lying draws and fires drawn as the lying pose** (SPEEDofPAIN with the
  No4Sniper at 92.7 and 97.4 s; JUNIOR's knife draw at 304-318 s).

Meuse River Line, `xhf8sfkt7k` (FHSWEurope, 1800 s): nothing judged. The
file has no `anim` state table (recorded before 2026-10-18), so no state can
be read; the audit says so.
