# Barbed-wire parity

Owner's request (2026-09-26): "Vehicles can drive through barbed wire with that
scraping sound, and players can walk through it but are slowed and receive
damage. Implement this. I think right now we block vehicles and it has no impact
on foot soldiers."

Before this round the viewer let a driven hull through wire (2026-09-24,
`6f8a192e`) but played nothing. A soldier met wire as ordinary static geometry:
he climbed over the low coils or was stopped by them. He was never slowed or
hurt. The wire's scrape had been taken out of the ambience because it looped
beside every fence, and nothing played it after that.

## What retail does

The retail rules come from the Linux dedicated server (`bf1942_lnxded.static`),
which decides hit points. Ledger rows **OBS-1..OBS-9** in
`features/bf1942-engine-reference/ledger.md` carry the addresses. In short:

| | Retail | Where |
|---|---|---|
| The class | `ObjectTemplate.create Obstacle`: a `Bundle` whose only field of its own is `ObjectTemplate.damage`, default **5.0**. Vanilla has `stebarbwire_m1` and `stebarbwire2_m1`. XPack2 has four `Milifence_*barb*` wire children of fence `Bundle`s. XPack1 has none of its own. No template sets `damage` | OBS-1 |
| A vehicle | `PlayerControlObject::handleCollision` messages the wire and returns 0, so there is **no response** (the vehicle rolls through) and **no damage** | OBS-3 |
| A soldier | `BFSoldier::handleCollision` sets a slow flag, messages the wire and bills `damage` through `giveDamage` unless the wire is still in his Armor's collision list. It returns 0: he **walks through**. Pose and stance make no difference | OBS-4 |
| The slow | `handlePlayerInput` reads and clears the flag on the next input tick and multiplies the forward and strafe commands by `ObjectTemplate.slowDownMod`, default **0.4**. No soldier template sets it | OBS-5 |
| The damage rate | The collision list keeps each entry for exactly **1.0 s**. Held in wire, a soldier loses 5 HP on the touch and 5 more each second: **30 HP is gone on the sixth bill, 5.17 s in at a 30 Hz tick** | OBS-6 |
| The credit | `giveDamage`'s attacker is -1, which the server replaces with whoever last hit him. The wire is nobody's kill | OBS-7 |
| The sound | The message reaches the wire's `e_Barbwire` child, which starts `e_Barbwire.ssc`: `randomPlay` of `barbwire1..3`, volume 0.5, `minDistance 3`, a `Volume <- Distance` ramp that is full inside 3 m of the wire's origin and silent past 4 m, and `randomStartPitch 0.03 / 0.0`. It is a one-shot, not a loop | OBS-8 |
| The gate | Every handler runs only when the contact speed squared is over 0.1 (`collision-response.md` §6.2). Slower than that, the wire is as solid as any static | §6.2 |
| The bots | The soldier nav map (`Infantry1`) blocks every wire, while the tank and car maps paint much of it free. This round leaves bot routing alone | OBS-9 |

## What the viewer does now

- **`viewer/obstacle.js`** holds the constants and `ColObjectList`, a port of the
  Armor's ring (`addColObject`, `isInColList`, the `Armor::update` ageing). It
  also has `obstacleDamage`, `obstacleOrigin` and `ScrapeVoices`, the scrape's
  one-voice policy.
- **`static-index.js`** knows wire **per triangle**. Each triangle carries the
  nearest `Obstacle` ancestor up to its owner, so XPack2's fence still stops a
  body while the wire child beside it does not. `sweepSphere` can look past wire
  (`passObstacles`). `WorldCollider.obstacleAt(hit)` and `obstacleNode(id)`
  answer for callers.
- **Soldier** (`soldier-resolve.js`, `walking-body.js`): above the gate, a
  capsule sweep that meets wire records the touch and sweeps again past it. The
  feet ray does not stand him on the wire. `SoldierBody.obstacleSlow` is the
  `+0x578` byte, read and cleared on the next step (`slowDownMod`, in
  `soldier-locomotion.js`).
- **Billing** (`world-soldier-tick.js`): the world's soldier tick ages the list
  every tick and bills each touch. It reports every touch as
  `report.obstacles` `{ id, x, y, z, origin, playerId, lost, killed }`. This
  covers the human, the bots and room players, because the room server runs the
  same world.
- **Vehicles** (`body-statics.js`, `body-world.js`, `world-bodies.js`): the
  driven hull's static pass asks per triangle and reports the vetoed touch as
  `report.obstacles` `{ ..., owner }`. The drive models' fallback sweeps
  (`wheeled-vehicle.js`, `tracked-vehicle.js`, used only without a static
  world) also look past wire above the gate. This covers wheeled, tracked, boat
  and aircraft hulls in the body world.
- **Page** (`map.html` `obstacleContacts`): every touch goes to
  `pageAudio.playObstacleScrape`. A bot the wire hurt goes through
  `referee.damageLanded`, so he gets the grunt, the death, the kit drop and the
  kill feed. The killer is the message log's last attack on him, and the wire
  raises no incoming-fire event (`opts.environment`). The human's HP drop and
  death go through the same watch a fall uses.
- **Audio** (`page-audio.js`): the level's one-shot static scripts are kept out
  of the bed pool and matched to a wire by origin, within 0.5 m. Each start
  picks one `randomPlay` sample, jitters the rate by `randomStartPitch`, and
  takes its gain from `area-sound.js`'s `emitterAt`, the law the beds use. A
  wire whose last scrape is still sounding is not restarted.
- **Data** (`bf42/level.py`, `extract_map.py`): a one-shot static area now ships
  `randomPlay` (every sample) and `randomStartPitch`. `file` stays the first
  sample, so an older page still loads the file. Patched with `patch_scene.py
  --layer sounds --all` in the bf1942, XPack1 and XPack2 trees, and published
  (below).

## INVENTION and inferred

- **INFERRED: one voice per wire at a time.** The server shows that message 0
  starts the sound (`EffectBundle::handleMessage` 0x081e1460 calls the sound
  object's vt+0x14). How the client treats a start while the last one-shot is
  still playing was not read. Restarting the voice on every contact tick would
  start it 30 times a second at one point, which breaks the .ssc rule of one
  voice per sample per point. So the viewer starts a new voice only once the
  last has ended.
- **INVENTION: a soldier standing still in wire is not pushed out.** Retail runs
  the static response below the gate, which would push him out of the mesh. The
  viewer's sweep resolver has no depenetration, so a soldier who stops inside a
  coil stays there. He is billed only on ticks where his small gravity step
  meets a wire face.
- **The billing tick.** The list is aged once per world tick (30 Hz), where
  `Armor::update` runs on the soldier's own update. At 30 Hz an entry lapses
  on the 31st tick after it went in, so the bill interval is 1.033 s.
- **The kill credit** uses the message log's five-second last-attack window. The
  length of retail's own `lastHitPlayer` timer (`Armor::update` clears `+0x14`)
  is open.
- **XPack2 wire origins.** The scrape sounds from the wire node's origin, which
  for `Milifence_*` is the Bundle's origin (the child has no `setPosition`). The
  scene's static script sits at the same point.

## Verification

Tests (`python3 -m unittest discover -s tools/bf1942-models/tests`: 3,555 run,
failures only in the known `test_verify_mutations` x7, `test_meme` clean page
count and `test_sim_vehicles` tank pair):

- `tests/test_obstacle.py` with `tests/obstacle_harness.mjs`, which loads the
  viewer modules in place through `sim/env.mjs`'s hooks, pins:
  - the engine numbers;
  - the collision list (an entry leaves 1.0 s after it went in);
  - held-in-wire billing: 25, 20, 15, 10, 5, 0 HP at 1.03 s spacing, dead at
    5.17 s;
  - a real `Soldier` crossing a coil through `soldierTick`: 6.0 m/s free, 2.40
    m/s the tick after every touch, billed on the touch and again 31 ticks
    later, and stopped by the same coil when it is a `SimpleObject`;
  - per-triangle wire in a Bundle;
  - the hull's static pass: no response above the gate, a response below it,
    and the touch reported;
  - the scrape starting once per contact, not once per tick;
  - the extracted Omaha data carrying the pick list.

Live, `map.html?mod=bf1942&map=omaha_beach` served from the worktree, stepped
headless at 30 Hz (`__renderOnce`). All runs use the first wire,
`stebarbwire_m1` at (1022.34, 22.39, -1093.38):

| Run | Result |
|---|---|
| Soldier running across the wire | 6.0 m/s free, 2.4 m/s touching. HP 30 -> 25 on the touch, one bill over the 19 ticks he was in it |
| Soldier running along the wire | Touching 93 of 180 ticks. HP 30 -> 25 (tick 15), 20 (46), 15 (77) on this wire, then 10 (100) and 5 (131) on the next coil (id 3). Speed 2.4 m/s touching |
| The same two runs with the veto switched off (`obstacleAt` forced to -1, the old behaviour) | No touch and no HP lost. Across, he climbed over at 6.0-7.0 m/s. Along, he stuck against the coil at 0.2-0.4 m/s |
| Willys at 6 m/s under throttle | Touched twice and kept accelerating (11.2 m/s at the wire). Ended 30.3 m past its origin at 15.6 m/s. One scrape voice started (gain above 0, a `barbwire*` buffer) |
| Sherman at 6 m/s under throttle | Touched 50 times (the hull is long) and kept accelerating (8.6 m/s at the wire). Ended 18.7 m past its origin at 13.6 m/s. One scrape voice |

`sim/run.mjs --map el_alamein --bots 8 --time 180 --seed 3` ran clean with the
bots on the new world tick.

## Published

The sounds layer was patched in all three trees: vanilla 16 levels, XPack1 22,
XPack2 25. The shared local tree carries other agents' unpublished bakes, so the
live `scene.json` of each level was fetched and given only the two new fields on
its wire areas (matched by name and point). Those files and `barbwire2.mp3` and
`barbwire3.mp3` in each tree's `_shared/sounds` were published with
`scripts/publish-mesh-delta.py maps --hash --root <stage>`: 64 `scene.json` and
5 samples, 0.04 GB. Live check: `mesh.bfstats.io/maps/omaha_beach/scene.json`
has `randomPlay` on all 77 wire areas. The deployed viewer ignores the new keys.

## Open

- The client's restart rule for a one-shot that is messaged while still playing
  (OBS-8).
- The length of the `lastHitPlayer` timer (OBS-7).
- Depenetrating a soldier who stops inside wire (the INVENTION above).
- The headless runner (`sim/`) bills wire through the world like the page. It
  has no `obstacleContacts`, though, so a bot the wire kills there respawns
  without an `onDeath`, as a bot killed by a fall already does.
