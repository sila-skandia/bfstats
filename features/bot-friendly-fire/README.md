# Bot friendly fire

Asked 2026-09-24. Since the crosshair's hit marks
([features/crosshair-hit-marks](../crosshair-hit-marks/README.md), ledger
XHIT-4), the human's rounds met his teammates, but a bot's still flew through
its own side. Two tests did it: `roundBodyCast`'s `passTeam` in
`viewer/vehicle-hits.js`, for every hull gun, and the team test in
`resolveShot` in `viewer/bot-referee.js`, for a bot's hand weapon. Both came
in with cc10a91e as a convenience. The binary never had them.

The evidence is ledger FF-1 to FF-8 in
`features/bf1942-engine-reference/ledger.md` ("Friendly fire", under "Hit
points and damage"), read in `bf1942_lnxded.static` (sha256
`49667237…c447cf2`).

## What the game does

- **A round meets any soldier in its path.** Nothing from the contact test to
  the damage compares teams. The contact test passes one soldier only: one
  whose root is the root of the firer's controlled object. That is the firer
  himself, and anyone seated in the hull he fires from, because a seated
  soldier is a child of his seat. Dead soldiers are passed. Collision groups
  are object classes (`c_CGProjectiles` and the like), never teams.
- **A friendly hit costs what the server says.** `GameServer::calcDamage`
  scales a hit only when the round's team (stamped when it is fired) is 1 or
  2 and matches the team at the victim's root. The factor is the server's
  percentage over 100, clamped to [0, 2]. There are four percentages: soldier
  and vehicle, each for direct hits and for splash. A man seated in a hull is
  priced as the hull. The shipped
  `Mods/bf1942/Settings/ServerSettings.con` sets all four to 100, so a friend
  takes exactly what a foe would.
- **Nothing is reflected.** `serverKickBack` and `serverKickBackOnSplash`, the
  share of friendly damage turned back on the shooter, ship at 0.
- **Every friendly kill by a round is a team kill.** `canTK`'s window,
  `timeToRemoveTK`, defaults to −1 (always) and no mod sets it.
- **A bot never holds fire for a teammate.** The fire plans gate the trigger
  on distance, a valid aim, the memory's seen flag and the precision. None of
  them casts a ray or asks a team. The one ray-based line of fire belongs to
  the TakeCover plan. A retail bot therefore shoots through a teammate
  standing in its line, and the server's settings decide what that costs. A
  bot hit that way registers incoming fire from the teammate like any other
  hit, but it never targets him: targets are enemies only (AI-33).

## What the viewer does now

| Piece | Where |
|---|---|
| The two rules: `roundPasses` (the firer and his own hull's crew) and `friendlyDamage` (`calcDamage` at the shipped percentages) | `viewer/friendly-fire.js` |
| Every gunfire.js round, a bot's or the human's, meets the first soldier on its way and passes only `roundPasses`'s two | `viewer/vehicle-hits.js` `roundBodyCast` |
| A bot's hand-weapon round does the same | `viewer/bot-referee.js` `resolveShot` |
| A friend's direct hit is priced by `friendlyDamage`: a soldier on foot by the soldier ratio, a seated man as his hull | `applyRoundToSoldier`, `resolveShot` |
| A hull's direct hit and every blast go through it too. A hull's side is its crew's, and 0 once empty. | `applyVehicleHit` → `vehicle-damage.js` `applyHit` / `applySplash` (`scale`) |
| The runner counts it: `metrics.friendlyFire` `{ hits, damage, teamKills }` | `sim/match.mjs` |

At the shipped 100 every ratio is 1.0, so the price of a hit is unchanged. What
changed is who a round can meet. The page and the runner pass no percentages
of their own. `page.friendlyFire` / `env.friendlyFire` exist for the tests,
which wire the paths at 50 / 25 / 10 / 5 so that a wrong pair shows.

Blasts and hull hits never had a team skip, so friendly splash (a grenade at
your own feet, a shell among your own squad) already cost full damage before
this change.

## Verified

- Tests: `test_friendly_fire.py` covers the rule, the page's round, hull and
  blast paths and the referee's. `test_hit_indication.py` now pins that a
  bot's round and an unnamed one meet the teammate in front, and that a round
  passes its own hull's crew but not another hull's. `test_sim_vehicles.py`
  (13, on El Alamein and Wake, including both tank-pair pins) passes
  unchanged.
- Live, headless El Alamein (Playwright on Vulkan, `?doctrine=sai`, the
  bots frozen but for the ones under test). The old code is the same page
  with the viewer's modules served from the main checkout:

  | recipe | before | after |
  |---|---|---|
  | a StG44 bot fires at an enemy 30 m off with a teammate kept on the line 12 m out | 2 hits on the enemy, killed; the teammate untouched | 3 hits on the teammate (10 HP each, full damage), killed; the enemy untouched |
  | two squads of four, 35 m apart, 1,500 frames | 26 hits, 7 kills, 0 friendly | 17 hits, 5 kills, 0 friendly |
  | a bot Sherman | coax kills two soldiers | the same two |
  | a Sherman with a bot driver and a bot in its Browning seat | driver 2 kills, gunner 1 hit, no hit on each other | the same |

  The squad fight is random (the deviation cone), so its counts vary from
  run to run. The squads stand abreast and never shot each other either way.

- Whole matches in the runner: El Alamein, 8 a side, 600 s, seeds 1..3,
  `sim/run.mjs` with this viewer and again with `--viewer` pointed at the
  main checkout's (the old rules). Both runs use this branch's runner, so
  both count `metrics.friendlyFire`:

  | doctrine, seed | friendly hits (HP), before → after | team kills after | deaths before → after | captures before → after |
  |---|---|---|---|---|
  | sai 1 | 0 → 0 | 0 | 18 → 18 | 3 → 3 |
  | sai 2 | 0 → 0 | 0 | 17 → 17 | 2 → 2 |
  | sai 3 | 0 → 0 | 0 | 12 → 12 | 3 → 3 |
  | garrison 1 | 0 → 1 (4.6) | 1 | 22 → 23 | 6 → 6 |
  | garrison 2 | 0 → 1 (15) | 0 | 19 → 20 | 5 → 7 |
  | garrison 3 | 0 → 0 | 0 | 17 → 17 | 3 → 3 |

  Under the SAI, the engine's doctrine and the runner's default, the three
  matches came out identical, tickets to the hundredth. Under the garrison,
  the page's default, two of the three matches had one friendly hit each,
  and one of those hits killed. After a friendly hit the match diverges.
  Bots do not shred their own squads.
- `python3 -m unittest discover -s tools/bf1942-models/tests`: 3132 OK, 19
  skipped. `./scripts/verify.sh --skip-e2e`, run after the viewer's assets
  were linked into the worktree: 3160 model tests OK, none skipped, and 394
  API tests passed.

## Decisions to know about

- **No avoidance was added.** The engine has none (FF-7), so a bot that fires
  with a teammate in its line hits him. Staying out of each other's way is up
  to movement and formation. If a viewer-only behaviour (a squad walking in
  file, say) puts friends in each other's line far more often than retail
  does, fix that behaviour, not the round.
- **One existing invention withholds fire through a hull.** The stalemate
  fix's `muzzleClear` (a30103aa, `bot-plans.js` `execFireApproach`) holds a
  driven tank's fire while any hull or static blocks the barrel's line,
  friend or foe. It is not a team test and not the engine's. It stays, and
  its own comment labels it INVENTION.
- **A round nobody can name** (replayed, or still flying from a seat since
  vacated) is taken for the human's in `roundBodyCast`, as `applyVehicleHit`
  bills it, and has no side, so it is never scaled.
- **Runner numbers from before this change are not comparable.** The doctrine
  table (`features/bot-doctrines`) and the garrison's measurements
  (`features/bot-garrison`) were taken with bots never damaging their own
  side, and both now say so.

## Open

- **FF-6:** a soldier struck by his own team's round plays a sound entry
  (0x13, `c_SstHitDamage` in the server's table) at most every 3 s. Vanilla
  ships a `SoldierFFHitDamage.ssc`. How the client picks between the two was
  not traced. The human's friendly-fire grunt (`local-player.js`) predates
  this change. A bot still plays the plain grunt for any hit.
- The kill feed already prints a same-team kill as "killed a teammate". The
  TK punishment settings (`serverTKPunishMode 0` shipped) were not read.
