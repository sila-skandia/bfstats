---
name: replay-forensics
description: >
  Examine the shared round recordings on bfstats.io for defects, and answer
  targeted questions about one recording at a timestamp. Use whenever the owner
  says "check the latest replays", "examine the last 3 recordings and look for
  defects", "look at the recent <level> recording around <time>", or relays a
  user report like "crouching / reloading / a vehicle is not showing in the
  replay — is it recorded or a viewer bug". The job is always to land the
  answer in one of three buckets with evidence: not in the data
  (recorder-side), in the data but not drawn (viewer-side, goes to the
  tracker), or drawn fine (mis-report). Also use it to fetch the newest
  recordings from the feed or to find the latest recording of a given level.
---

# Replay forensics

Shared recordings are ndjson files the server recorder writes
(`features/server-replay-recorder/README.md` has the row table: `s` poses,
`st` soldier animation states — stance lives there — `anim` the state table,
`g` engines, `f` shots, `e` events). The replay page draws only what it can
read back out of that file, so every "X is wrong in the replay" question
decomposes into: what does the file say, and what did the page draw.

## House rules

- **One headless Chromium at a time**: wrap every browser run in
  `flock /tmp/claude-1000/chromium.lock <cmd>`. If the environment refuses
  flock-with-a-command, take the lock on a file descriptor instead:
  `( flock 9 && <cmd> ) 9>/tmp/claude-1000/chromium.lock`.
- **Never port 5273** (the owner's dev server). A local server for a worktree
  uses 5310–5359.
- A fresh worktree's viewer has no assets: run
  `tools/bf1942-models/link_viewer_assets.sh <worktree>` (links `maps`,
  `models`, `textures` **and `glbs`** — check `viewer/glbs` exists after; the
  glb store is required since `features/mesh-asset-size`).
- Prefer JSON evidence out of hooks (`window.replay`, the scripts below) over
  screenshots. A screenshot proves a frame; a JSON dump proves the state.
- Findings land in the mod's tracker under `features/` (e.g.
  `features/fhsweurope-extraction/README.md`), classified
  harness-vs-data-vs-viewer — say which of the three the evidence shows.

## 1. The latest N recordings

The feed is the public API (no auth):

```bash
curl -s 'https://bfstats.io/stats/recordings?pageSize=3&sort=recent' \
  | python3 -c 'import json,sys; [print(i["slug"], i["mod"], i["level"], i["recordedLocal"], round(i["durationSeconds"]))\
      for i in json.load(sys.stdin)["items"]]'
```

Each item carries `slug`, `mod`, `level`, `recordingUrl`
(`/stats/recordings/<slug>.ndjson`), `durationSeconds`, `uploaderName`. There
is **no server-side level filter** (only `server`/`uploader`/`sort`/paging) —
find "the most recent Ramelle recording" client-side:

```bash
curl -s 'https://bfstats.io/stats/recordings?pageSize=50&sort=recent' \
  | python3 -c 'import json,sys; print(next(i["slug"] for i in json.load(sys.stdin)["items"] if i["level"]=="road_to_ramelle"))'
```

The live page for a recording is
`https://play.bfstats.io/map.html?mod=<mod>&map=<level>&replay=/stats/recordings/<slug>.ndjson`
(append `&shots` for the headless hooks). Download the raw file with
`curl -s -o <slug>.ndjson 'https://bfstats.io/stats/recordings/<slug>.ndjson'`
(20–50 MB for a full round) into the scratchpad.

## 2. The defect sweep ("examine the last 3 replays")

`tools/bf1942-models/audit_replay_assets.mjs` replays the N newest public
recordings headless on the live site and classifies every 404 by owning
extractor (usage in its header; the verdict table and first-run findings are
in `features/mod-extraction-pipeline/README.md` under "The gates"):

```bash
cd tools/bf1942-models
flock /tmp/claude-1000/chromium.lock \
  node audit_replay_assets.mjs --recent 3 --json /tmp/replay-audit.json
```

Exit 0 clean-or-accepted, 1 on any unaccepted major, 2 when the run could not
be staged. Read the JSON's `findings[]` (`cause_key`, `owner`, `path`,
`accepted`) and the `causes` tally. The cause keys:

| cause_key | severity | meaning |
|---|---|---|
| `asset.extraction-gap` | major | absent locally too: the pipeline missed it |
| `asset.unpublished` | minor | present locally, 404 live: publish pending |
| `asset.follows-base-gap` | minor | wreck/cockpit probe of an unlisted template: fix the base model's gap |
| `asset.optional-probe` | info | cockpit/wreck the manifests say was never exported |
| `api.error` | info | a `/stats/*` response, not an asset |
| `replay.stalled` | info | playback stuck; a harness problem, not an asset |

Known-impossible probes live in
`tools/bf1942-models/audit_replay_assets_accepted.json` (rows match on
check + cause_key + template_or_kit + path, each carrying `evidence`).

The sweep covers **assets**. For behaviour defects seen while a recording
plays (a vehicle drawn wrong, sound, stance), go targeted (below), then route
through the hand-offs at the end.

## 3. A targeted question at a timestamp

"Users report crouching is not showing — look at the recent Ramelle recording
around 1:26." The replay bar's 1:26 is the recording clock's t=86 (`seek(t)`
clamps to `[0, rec.duration]`; rows start near 0, nothing is rebased — the
bar's tooltip also shows a separate "ROUND m:ss" clock, the in-game round
timer, which is NOT `t`). Two probes, data first:

**What the data says** — `scripts/body_states.mjs` parses the ndjson with the
viewer's own reader (`viewer/replay-recording.js`, via `sim/env.mjs` hooks) and
dumps every soldier's recorded animation states around the time (no browser):

```bash
node .claude/skills/replay-forensics/scripts/body_states.mjs \
  <slug>.ndjson --at 86 --window 10 [--player <name substring>]
```

Read the `header` first: `animStates: 0` with `soldiersWithStances > 0` means
the file carries `st` rows but **no `anim` state table**, so no stance can
resolve — the reader prints its own warning saying exactly that, and the
verdict is already recorder-side. Otherwise `crouchedOrProne` lists who the
data has off their feet at `--at`, and each soldier's `changes` show the
recorded state names (`Lb_Crouch`, flags 0x20 crouch / 0x40 prone,
`replay-recording.js` `ANIM_FLAGS`).

**What the page drew** — `scripts/viewer_drawn.mjs` loads the real page
headless, pauses, seeks, and reads the drawn bodies
(`window.replay.soldiers.bodies.debug().live`: lower/upper clip name, stance,
weapon, visibility) plus the page's own `replay:` console warnings:

```bash
( flock 9 && node .claude/skills/replay-forensics/scripts/viewer_drawn.mjs \
  --url 'https://play.bfstats.io/map.html?mod=fhsweurope&map=road_to_ramelle&replay=%2Fstats%2Frecordings%2F<slug>.ndjson&shots' \
  --at 86 --player <name> ) 9>/tmp/claude-1000/chromium.lock
```

`--player` follows that player so his body is in camera range and built
(`visible: true`); bodies out of range report `visible: false` and prove
nothing. To test local viewer code instead of live, copy the ndjson under
`tools/bf1942-models/viewer/replays/`, serve the viewer dir on 5310–5359
(`python3 -m http.server 5311`), and point `--url` at
`http://localhost:5311/map.html?mod=<mod>&map=<level>&replay=replays/<f>.ndjson&shots`
(a `/stats/...` replay path is origin-relative and 404s locally).

**The three buckets**:

| data says | page draws | verdict |
|---|---|---|
| no crouch resolvable (no state rows, or no `anim` table) | standing | **recorder-side**: not in the data. Re-record with a recorder build that captures it; nothing to fix in the viewer |
| `Lb_Crouch` / flags 0x20 at t | `stand.lower` | **viewer-side**: in the data, not drawn. Tracker entry + fix |
| `Lb_Crouch` at t | `Lb_Crouch`, visible | **mis-report**: drawn fine; answer with the evidence |

### Worked example (measured 2026-10-19)

Most recent `road_to_ramelle` recording: slug `nnnzjz8myz` (FHSWEurope,
recorded 2026-10-17, 1974 s, uploader Chief-H.E.M.P). At 1:26 (t=86):

- `body_states.mjs --at 86 --window 10`: header
  `{ v: 5, animStates: 0, animStatesSkipped: null, soldiersWithStances: 294 }`
  — the file carries `st` state rows for 294 soldiers (indices change
  constantly, e.g. pid 0 " FreedomEr" lower `#11489 → #11845 → #14970…`
  through 76–96 s) but **no `anim` state table**, so no index resolves to a
  name and no crouch flag can be read. `crouchedOrProne: []`.
- `viewer_drawn.mjs --at 86 --player freedomer`: 9 visible bodies, every one
  drawn `stand.lower`/`stand.upper`, and the page's own console warning:
  "294 soldiers carry recorded animation states, but this file has no \"anim\"
  state table … Written by bf42plus 2.0 (no build stamp, so written before
  2026-10-18); re-record with a build that clears the mod's table to capture
  it."
- **Verdict: recorder-side.** The crouch is not readable from the data; the
  viewer draws the only stance it can resolve and says so itself. The users'
  report is accurate but the fix is a re-record with the recorder build that
  captures the mod's state table (≥ 2026-10-18), not a viewer change. See
  `features/soldier-locomotion-animation/README.md` (the missing-table
  warning) and `features/server-replay-recorder/README.md` (the `anim` row).

## 4. Hand-offs

- **A 404 / `asset.extraction-gap`** → the extraction-gap flow: `python3
  mod_pipeline.py reextract --mod <Mod> <templates>` (never a bare
  `extract_models.py --out` — it clobbers `models.json`); the full recipe and
  regression corpus are in `features/mod-extraction-pipeline/README.md`.
- **A behaviour defect** (in the data, drawn wrong) → the classification table
  in the `bf1942-mod-pipeline` skill ("Fix what the run finds, in the same
  run"), and the finding goes in the mod's tracker under `features/`.
- **A recorder gap** (not in the data) → `features/server-replay-recorder/`;
  if a fresh capture is needed, the `bf1942-server-lab` skill records a round
  with the current recorder build.
