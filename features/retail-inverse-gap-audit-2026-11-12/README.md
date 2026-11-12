# Retail inverse gap audit, 2026-11-12

Status: audit done 2026-11-12; the DIFFERENT findings are being fixed by six fixers (section 3,
which the coordinator updates as they land). Nothing in section 4 is built: each entry waits for the
owner to pick it.

## What this is

This morning's [retail parity cross-check](../retail-parity-cross-check-2026-11-12/README.md) went
from our code to retail: it took every place the browser game cites retail and checked the value.
It could not see behaviour we never built, because nothing cites it. Two kinds of gap hide there:

- **412 live ledger rows that no game or extractor file names by id.** Most turned out to be built
  and cited by address or function name instead, but some were never built.
- **Retail behaviour with no ledger row at all.** The owner found three of these today just by
  playing: a soldier stuck under a vehicle that should push or run them over, bots that never gave
  up a tank seat on a radio command or a seat request, and bots single-firing automatic weapons.

This pass goes the other way, from retail to our code. Sixteen read-only auditors each took a
slice. Thirteen read their bucket's uncited rows. All sixteen swept the binary's own classes
(`bf1942_lnxded.static` for the server, `BF1942.exe` with the Mac dump's names for the client) for
behaviour that has no row. Three of them (`orphan-words`, `seams-players`, `seams-world`) had no
rows and worked only from a sweep: the console words our extractor drops, and the places where
players, bots, the mode and the physical world meet. Each auditor sorted what they found into
BUILT, NOT-GAME, MISSING, PARTIAL, DIFFERENT or UNREAD, and none of them edited the repo. Their
reports are in [`buckets/`](buckets/) (section 8).

## Counts

MISSING, PARTIAL, DIFFERENT and UNREAD are counted from each report's finding headings. BUILT and
NOT-GAME are counted from each auditor's own tallies, rows plus sweep. `orphan-words` groups
several words under one finding, and `ai-a` counts ten never-registered behaviour classes as
NOT-GAME. Some findings appear in two or more buckets: the totals count them once per bucket,
section 4 merges them, and the merged list has 68 entries.

| Bucket | BUILT | NOT-GAME | MISSING | PARTIAL | DIFFERENT | UNREAD |
|---|---|---|---|---|---|---|
| [ai-a](buckets/ai-a.md) | 33 | 18 | 2 | 3 | 3 | 2 |
| [ai-b](buckets/ai-b.md) | 29 | 2 | 1 | 9 | 1 | 2 |
| [console-menus](buckets/console-menus.md) | 30 | 4 | 4 | 4 | 1 | 1 |
| [damage](buckets/damage.md) | 20 | 5 | 2 | 1 | 0 | 2 |
| [hud](buckets/hud.md) | 27 | 2 | 7 | 1 | 2 | 2 |
| [modes](buckets/modes.md) | 17 | 6 | 3 | 2 | 2 | 1 |
| [netcode-server](buckets/netcode-server.md) | 27 | 14 | 7 | 2 | 3 | 1 |
| [orphan-words](buckets/orphan-words.md) | 2 | 38 | 11 | 1 | 2 | 7 |
| [render](buckets/render.md) | 15 | 10 | 4 | 2 | 2 | 3 |
| [seams-players](buckets/seams-players.md) | 17 | 3 | 4 | 1 | 2 | 2 |
| [seams-world](buckets/seams-world.md) | 18 | 0 | 3 | 2 | 3 | 1 |
| [seats-guns](buckets/seats-guns.md) | 14 | 3 | 1 | 1 | 1 | 2 |
| [soldier-body](buckets/soldier-body.md) | 26 | 1 | 5 | 3 | 0 | 2 |
| [soldier-weapons](buckets/soldier-weapons.md) | 32 | 2 | 2 | 1 | 3 | 1 |
| [sound-radio](buckets/sound-radio.md) | 13 | 1 | 3 | 4 | 3 | 2 |
| [vehicle-physics](buckets/vehicle-physics.md) | 30 | 3 | 2 | 2 | 0 | 2 |
| **Total** | **350** | **112** | **61** | **39** | **28** | **33** |

Three of the 28 DIFFERENT findings are departures we keep on purpose (section 5). Two more turned
out to be wrong on a second reading (section 6).

## Bugs fixed the same day

These are the DIFFERENT findings, plus the MISSING ones that undo a rule we already claim to follow.
Six fixers took them on the same afternoon, in the groups below; each line says how it landed. Each fixer confirms retail's rule on our binary before changing
anything, and leaves the code alone where the binary does not support the auditor.

**spawn-rules**

- Fixed. Reinforcement waves everywhere. Retail makes every player, bots included, wait
  for the next `serverSpawnTime` 20 + 5 s window (SPAWN-35, `killPlayer` `0x0814d920`). Ours does
  this only on a retail relay: the solo player respawns on the click, bots after a flat 8 s, and room
  players at once. (modes, netcode-server)
- Fixed. The room ignores a side change made on the deploy screen. `onSpawn` uses the
  joined side, so the server's friendly fire, tickets, capture and radio disagree with the player's
  screen. (netcode-server)
- Fixed. The room's auto-team breaks a tie onto team 1. Retail's `getTeamToAddPlayer`
  `0x08261670` weighs the sides by the team ratios and breaks a tie at random. (modes)
- Fixed. Instant Battle's defaults. Retail's NORMAL charges 5 tickets per player death and
  splits the bots 3:4 friendly:enemy. Ours charges the level's per-death loss and splits 1:1 (or 9
  against 7 with the human for 15 bots). (console-menus, seams-players)

**kits-healing**

- Fixed. The bot medic's heal law. Retail's `useMedPack` `0x082768d0` heals everyone
  within 10 m at 0.25 a round and the medic at 0.15. Ours heals one friend in a 20 degree cone at
  the wrench's 0.3. (seams-players, soldier-weapons)
- Fixed. The wrench's team and stance gates. Retail skips a hull held by the other side
  (`0x08276731`) and repairs nothing while crouched (`0x0827612d`). Ours repairs any hull in any
  stance. (soldier-weapons)
- Fixed. A dead engineer's mines and packs vanish with their kit (`releaseProjectilePool`
  `0x08287ee0`; 30 s after a death on foot, at once after a death in a seat). Ours leave them to
  run out their 240 or 360 s fuse and then explode. (soldier-weapons, damage)
- Fixed. The room heal path. Online, medic packs, wrenches and depots heal only the
  healer's page copy, and the server puts the old value back. (seams-players)

**camera-seat-hud-sound**

- The death camera. Fixed, with the auditor's reading corrected on the binary: the shot rises over the body from 1 m to 30 m in the first 3 s while it turns, then holds; past 10 s it rides with the next living human teammate (bots never count), C walks to the next, and the CHASE CAMERA lines show. Ours held a 1.2 s house shot. (hud)
- Fixed. E at a tank's gunner door seats you as gunner. Retail gives the driver's seat
  while it is free (SEAT-30, `getPreferredPco` `0x083193c0`). (seats-guns)
- Fixed. Name tags show to 75 m off a retail server. Retail's listen server caps them at
  50 m (`serverNameTagDistance`, NET-21, HUD-16). (netcode-server)
- Fixed. "Watch your aim!" plays from any soldier a teammate's round touches, damage or
  not, once every 3 s per soldier (`BFSoldier::projectileHit` `0x0827ea20`). Ours plays it only for
  the local player, and only when hurt. Hurt grunts share one 0.9 s cooldown across every bot, where
  retail keeps one per soldier at 1.0 +/- 0.2 s. (sound-radio)
- Fixed. Collision material 99, the 275 kill faces inside vanilla's closed buildings,
  kills a soldier who touches it (`0x0827d3c8` to `0x0827dd60`, 1e10 damage). Ours pushes them out.
  (soldier-body)

**world-physics**

- Fixed. A wreck stays a physical body until it is removed: it rolls, gets rammed and
  sinks. The physics manager `0x0825d0b0` never tests the destroyed flag. Ours freezes the wreck as
  scenery. (seams-world)
- Fixed. Ladders follow a moving ship. Retail measures the ladder in its object's live
  transform (`getLadderClosestPosition` `0x08280b40`). Ours indexes ladders once, at the moored pose.
  (seams-world)
- Fixed. The room server has no ladders, so a joined player's climb is corrected back
  down by the server. (seams-world)
- AI LOD 2 deck bots (AI-160). Confirmed, not changed: we have no AI level-of-detail system, and copying the defect would mean building one to reproduce it. (ai-b)
- The sea's swell. Fixed: retail fills the water grid flat once (`waveHeight` only widens each tile's culling radius), so the invented swell is gone. WATER-2's per-vertex depth colour stays per pixel. (render)

**bot-weights**

- Fixed. AI-43's vehicle weighting. `calculateVehicleUrgency`'s two weights are the bot's
  smoothed fire and move inclinations (`BotMain` vtable +0x16c and +0x168, `0x0852e280` and
  `0x0852e310`), not its order's attack and defence split. (ai-a)
- Fixed. `ChangeInhibit`. The file's values are Avoid 0.8, MoveTo 0, Idle 0.01, Fire 0.75,
  Special 0, Scout 0.5, and the column applies per row (infantry use `UnitWeights`). Ours zeroes
  MoveTo for every bot and leaves the rest at 1. (ai-a)

**ammo-and-words**

- Fixed. `ammoType` rearm rates. Depots pick the row that matches the gun's `ammoType`
  (SUP-2). Ours never exports the word, so grenades and rockets come back at the bullet row's 15/s
  instead of 1.2/s, and bombs at 100/s instead of 4/s. (orphan-words)
- Fixed. `noFFSound`. The five explosive rounds that set it never trigger the
  friendly-fire line (FF-6). (orphan-words)
- Fixed. The weapon-word table. The 14 bazooka deviation words, `projectileVisible` and
  the bare `startOnEffects` are dead in retail too (neither binary registers them); the table moves
  them from OPEN to PLUMBING. (orphan-words)

Four DIFFERENT findings have no fixer. They are low impact and appear in section 4: EoD's SAM sites
run the large-bore fire rule, HUD text metrics do not follow the display width (FONT-3), the sea's
depth colour is per pixel where retail is per vertex (WATER-2), and SPAWN-14's Wasserfall exemption
never fires.

## Found by playing, and what the fixes turned up

**Open, live since e5003c584: bot drivers run over their own side.** The run-over (a moving hull kills a
soldier at 8 m/s or more, as retail does) went live without retail's other half, the bot driver's
collision prediction (`BBAvoid::calculateUrgency` `0x0855c650`, `collisionPredicted` `0x0855d2f0`,
about 5 s ahead; entry 7 below). On the live page check that followed, 9 of the first 15 generated
levels failed the rollout floor's own-hand rule, the worst on driving levels (jeep_bowl 0.35,
rennpiste_gebirge 0.26, tl_race 0.24 own-side deaths a bot-minute). The check was stopped at 15
of 64 and its page.json files were put back, so no verdict from it is recorded; no tag was
withdrawn. Next: port the prediction (entry 7), then play the 64 live levels once on it.

The owner's four reports that started the audit, and three more the fixes uncovered:

- **A soldier stuck under a moving vehicle.** Retail resolves a hull meeting a soldier on the
  soldier's side even when the hull moved (lnxded `0x08259690`): pushed clear sideways, run over at
  8 m/s or more, billed once a second per hull and credited to the driver (`0x081551c0`), with a 2 s
  grace on a hull just left (SEAT-33). Ours only resolved the soldier's own moves, and the room
  never told its collider where a hull had moved. Fixed on the page and in the room.
- **Bots "single-firing".** Our bots fired whole magazines in one stream; retail's bots fire 1 or 2
  rounds at the weapon's cycle every 12 ticks (AI-174, from the lab's recordings of real bots) on
  a round budget truncated, not rounded (AI-131). Fixed.
- **Replay weapon sound.** The half-second rhythm did not reproduce; the first rounds of a burst
  were silent because weapon sounds were never pre-loaded. Fixed (`primeReports`).
- **Bots giving up a seat.** Confirmed: the radio's Bail out / Get in / Abandon ship reach
  same-side bots within 70 m, and E or a seat key at a seat a bot holds asks for it; the bot
  becomes likelier to climb out (AI-169..AI-173, SEAT-40, SEAT-41). No swap, as in retail. Built.
- **On-foot route failures rose four-fold with the reinforcement waves.** Not spawn stacking: bots
  kept a teammate's avoidance circle until 25.5 m away, so a wave leaving base blocked its own
  paths. Retail drops it once the body moves faster than 1.2 m/s, the distance only after 10 s
  (AI-176). Fixed; failures fell below their level before the waves.
- **Bots mounted vehicles less** after AI-43's weighting. The unarmed seats' threat score was the
  missing half (AI-177); with it, Wake's mounted share is 0.64 against the lab's 0.61 over seven
  retail recordings (the old code read 0.75).
- **DICE's bot bars, rebuilt on the final tree** (8 a side, p50, before -> after): on-foot route
  failures 0.021 -> 0.015 and team kills 0.014 -> 0.008 a bot-minute; vehicle-bar enemy kills 0.28 ->
  0.37, team kills 0.0065 -> 0 and hull stuck time 0.94 -> 0.54 s a driving minute; mounted share
  0.68 -> 0.58. Open: at 16 a side the on-foot route failures' p90 rose from 0.37 to 1.07 on one or
  two matches, most likely Berlin's single-door Soviet base, where the remaining failures follow
  retail's rule as read.
- **Bot sight lines were slow on vehicle-heavy levels** (a third of real time on a 103-vehicle FHSW
  level): the collider tested every moving hull twice per line. Fixed with identical trace hashes,
  2.2x faster.

## What we have not built

Every MISSING and PARTIAL finding, merged across buckets. An entry that several auditors found on
their own cites each of them, and that agreement makes the finding stronger. The tiers rank by
player impact. **Tier 1** is something a player notices in normal play, **tier 2** in specific
situations, **tier 3** in edge cases or on mod levels only. Within a tier, entries run from the
smallest effort (S, under a day) to M (a few days) and L (more).

| # | Tier | Title | Impact | Effort |
|---|---|---|---|---|
| 1 | 1 | Bots act on only 3 of 22 radio messages | high | S |
| 2 | 1 | An explosion never pushes a vehicle | high | S |
| 3 | 1 | A destroyed vehicle's own blast hurts and pushes nothing | medium-high | S |
| 4 | 1 | A crouched engineer cannot disarm mines and packs | high | S |
| 5 | 1 | Typed chat never leaves your screen in a room | high | S |
| 6 | 1 | A moving deck does not carry what stands on it | high | M |
| 7 | 1 | Bot drivers predict no collisions | high | M |
| 8 | 1 | Engineer bots never repair vehicles | high | M |
| 9 | 1 | Live soldiers never jump, backpedal or draw a weapon | high | M |
| 10 | 1 | Vehicle dust, wakes and placed smoke never play | high | M |
| 11 | 1 | No dynamic shadows | high | M |
| 12 | 1 | Soldier movement sounds: only walk and run | medium-high | M |
| 13 | 1 | Rooms have no bots (no online co-op) | high | L |
| 14 | 2 | No pre-game countdown | medium | S |
| 15 | 2 | A stranded side never loses in a room | medium | S |
| 16 | 2 | A late joiner's scoreboard starts at their join | medium | S |
| 17 | 2 | Soldiers walk through each other | medium | S |
| 18 | 2 | A bot on foot steps aside only on contact | medium | S |
| 19 | 2 | No "entered your vehicle" / "left your vehicle" lines | medium | S |
| 20 | 2 | No "joined the axis team" line | medium | S |
| 21 | 2 | A radio speaker does not blink on the minimap | medium | S |
| 22 | 2 | P does not pause single player | medium | S |
| 23 | 2 | No friendly-mine warning icon | medium | S |
| 24 | 2 | A stance change cuts the bolt cycle | medium | S |
| 25 | 2 | Trees do not sway | medium | S |
| 26 | 2 | A room has no host settings and no admin | medium | M |
| 27 | 2 | No team-kill punish, forgive, penalty or kick | medium | M |
| 28 | 2 | No votes (map, kick, team kick) | medium | M |
| 29 | 2 | A blocked exit puts you in the wall | medium | M |
| 30 | 2 | A blast on a hull never hurts its seated crew | medium | M |
| 31 | 2 | A bot tank takes cover like a soldier | medium | M |
| 32 | 2 | The commander ignores where its side is losing | medium | M |
| 33 | 2 | Bots rarely lob grenades | medium | M |
| 34 | 2 | No hand signals on a shout | medium | M |
| 35 | 2 | The Garand's clip eject has no animation | medium | M |
| 36 | 2 | Track belts stay rigid | medium | M |
| 37 | 3 | Explosions look the same on every surface | low-medium | S |
| 38 | 3 | No turning on the spot or idle fidgets | low-medium | S |
| 39 | 3 | A hull's Scout never turns the hull | low | S |
| 40 | 3 | Four AI placeholders labelled INVENTION | low | S |
| 41 | 3 | The bots' radio subscriptions are hard-coded per mod | low | S |
| 42 | 3 | No cap on live mines and packs per weapon | low | S |
| 43 | 3 | The hull push ignores rotation and mass | low | S |
| 44 | 3 | No depot icons while seated, no repair icon | low | S |
| 45 | 3 | Typed console words that answer "Unknown object" | low | S |
| 46 | 3 | No ping column in rooms | low | S |
| 47 | 3 | No auto-balance on death | low | S |
| 48 | 3 | No welcome message, password or reserved slots | low | S |
| 49 | 3 | No "connection problems" HUD line | low | S |
| 50 | 3 | HUD text spacing and glyph snap | low | S |
| 51 | 3 | Secret Weapons rocket details | low | S |
| 52 | 3 | Submarine spawns and the use-button spawner | low | S |
| 53 | 3 | Two mod-only fields never read | low | S |
| 54 | 3 | Sea depth colour per pixel | low | S |
| 55 | 3 | A room replays one map forever | low | M |
| 56 | 3 | No GENERAL OPTIONS screen | low-medium | M |
| 57 | 3 | No tooltips | low-medium | M |
| 58 | 3 | A remembered enemy weighs as much as a seen one | low-medium | M |
| 59 | 3 | BF1918 hulls never roam | low | M |
| 60 | 3 | EoD's SAM sites aim like a ship's gun | low | M |
| 61 | 3 | Large hulls meet the wrong collision layer | low | M |
| 62 | 3 | Terrain at full detail at every distance | low | M |
| 63 | 3 | No voice pool or priority stealing | low | M |
| 64 | 3 | No faces or lip-sync | low | L |
| 65 | 3 | A ship bot ignores a seat request | low-medium | S |
| 66 | 3 | Mod weather | medium on mods | M |
| 67 | 3 | No chat beep | low-medium | S |
| 68 | 3 | Vehicles on a moving deck | medium | M |

Entries 65 to 68 are tails of larger entries, listed on their own so that none is lost: 65 is
unread and waits on one function, 66 mostly comes with entry 10, 67 comes with entry 5, and 68 is
the vehicle half of entry 6.

### Tier 1

**1. Bots act on only 3 of 22 radio messages** (high, S)
- Retail: `AIRadio::getMessageStrength` `0x084825c0` is read by every behaviour, not just Change.
  The Fire behaviours multiply by `(1 + Fire)(1 + Cover me)(1 - Hold fire)` (`BBFire`
  `0x085652b5..0x08565329`), MoveTo by `(1 + Go)(1 - Hold position)(1 - Wait)` (`0x08575035..`),
  Scout by Check your six and the seven "spotted" calls (`0x0857a81a..`), TakeCover by Take cover
  (`0x0857d05f`, `0x08581039`, AI-41), and MedicAssist by Medic and Need repairs (`0x08573d55`,
  AI-42).
- A player notices: in single player and Instant Battle, "Hold fire!", "Hold position!", "Go go
  go!", "Take cover!" and "Medic!" do nothing to the bots nearby. In retail each one visibly moves
  them.
- Approach: `bot-radio.js` already stores every strength, and `bot-mount.js` reads three. Add one
  product per behaviour in `bot-decision.js`, `bot-fire.js` and `bot-behaviours.js`. Confirm each
  `fsubp` sign once on the binary first.
- Found by: ai-a, ai-b, seams-players, sound-radio.

**2. An explosion never pushes a vehicle** (high, S)
- Retail: KNOCK-4 and KNOCK-5 (`handleExplosionOnObject` `0x08156500`) push every root with a
  physics node, at the blast point clamped to its bounding sphere, so the hull spins as well as moves.
  Willy `explosionForceMod` 20, ExpPack `ForceOnExplosion` 50.
- A player notices: TNT under a jeep, a mine or a shell next to a parked plane damages it but never
  moves it. The satchel jeep launch is one of the game's best-known tricks.
- Approach: in the splash pass, add KNOCK-5's force to each damaged root body through
  `RigidBody.addAccelerationAtAbsolutePosition`, and hand it to `DrivenBody` for a driven hull.
  Do the same in `server/room-hits.mjs`.
- Found by: seams-world.

**3. A destroyed vehicle's own blast hurts and pushes nothing** (medium-high, S)
- Retail: `Armor::status` `0x081739e0` calls `handleExplosion` from its destroyed branch
  (`0x08173d60..0x08173df0`) with the hull's `explosionDamage` and `explosionRadius` (5 at 8 m on 52
  vanilla vehicles and planes), its force, and its last hitter as the attacker (HP-2, HP-8).
- A player notices: standing beside a tank, jeep or plane as it blows up costs nothing. In retail
  it hurts, shoves, and credits the kill to whoever destroyed the hull.
- Approach: export the Armor block's `explosion*` words (`bf42/con.py`, the `damage` layer), then
  run the existing `applySplash` and `knockback.js` at the hull's origin on death, with the dying hull
  excluded. Read the default `explosionMaterial` first.
- Found by: damage, orphan-words, vehicle-physics, seams-world.

**4. A crouched engineer cannot disarm mines and packs** (high, S)
- Retail: `BFSoldier::useRepairPack` `0x08276100`: while crouched, the wrench takes the first
  `LandmineProjectile` or `ExpPackProjectile` within its radius plus `disarmMinesDistance` (2.0,
  `0x0827613d`), friend or foe, removes it without a blast and gives the round back
  (`reloadAmmo(1)`, `0x082765f6`).
- A player notices: clearing a mine field with the wrench is standard engineer play. Ours can only
  set a mine off with a vehicle or wait out its 360 s fuse.
- Approach: in `hand-fire.js` `useRepairPack`, when crouched, retire the nearest mine or pack
  through the round pool and add one to the matching kit item. The room needs the same removal. The
  kits-healing fixer is adding the stance gate (no repair while crouched); the disarm is the build.
- Found by: soldier-weapons.

**5. Typed chat never leaves your screen in a room** (high, S)
- Retail: the server relays a line to everyone but the sender, or to the sender's side for team
  chat (CHAT-2, CHAT-4), cut to 63 bytes and paced at one piece every 0.5 s. Each player chat line
  plays the radio crackle (RADIO-12, patch 5 at `0x006a5550`), and sending too fast prints
  `CHAT_FLOOD_ERROR`.
- A player notices: in any room game, every line you type looks sent in your own log, and nobody
  else ever sees it.
- Approach: a `chat` action in `server/room-control.mjs`, a `chat` row in `room-wire.mjs`, and a
  `chat` method on the room client. `net-room.js` already draws incoming chat rows. Add the beep in
  `comms.chatLine` and the flood line from the rate limit.
- Found by: console-menus, netcode-server, sound-radio (beep), hud (flood line).

**6. A moving deck does not carry what stands on it** (high, M)
- Retail: object contacts feed the friction solve with the relative contact speed
  (`ResponsePhysics::addFriction` `0x0825b6e0`, collision-response.md section 8), so a light body on
  a heavy moving one is carried along. There is no parenting: the `+0x558` "standing on" pointer is
  read only by the netcode.
- A player notices: measured headless, a soldier on a deck moving at 8 m/s falls off the stern of a
  40 m deck within 3 s. That covers ship and carrier decks under way, riding on a tank, landing craft
  on Omaha, BF1918's trains, and a paratrooper landing on a ship. A plane let go on a moving carrier
  slides aft, and EoD's LCT keeps its tank held (entry 68).
- Approach: record the hull under the foot in `pushOutOfHulls` and subtract its point velocity,
  rotation included, in `walking-body.js` `#contactLaw`. The same term goes into
  `body-friction.js` for vehicles on decks. Extend `tests/hull_runover_harness.mjs` with the deck
  cases.
- Found by: seams-world (measured), vehicle-physics.

**7. Bot drivers predict no collisions** (high, M)
- Retail: every driven ground and boat row registers `Avoid BBAvoid BBPAvoidCollision2d`.
  `BBAvoid::calculateUrgency` `0x0855c650` looks 5 s ahead (AI-119) through `collisionPredicted`
  `0x0855d2f0`, and the plan side-steps (`0x08586420`).
- A player notices: bot tanks and jeeps drive into friendly soldiers, the player, friendly hulls and
  props instead of steering round them. This is the other half of the owner's "stuck under a
  vehicle" report.
- Approach: give driven hulls the pilots' `collisionPredicted` test in `bot-decision.js`
  `urgencyAvoid`, let `bot-route.js predictObstacles` run for a hull with its own sub-spheres, and
  port the 2d side-step in `bot-plans.js`.
- Found by: ai-a.

**8. Engineer bots never repair vehicles** (high, M)
- Retail: `BBMedicAssist::calculateUrgency` `0x08573840` scores every friendly unit, hulls included.
  The vanilla `RepairPackAI` rates every armour class 2.0 and infantry 0, so the RepairPack is the
  engineer's tool for every hull. A non-soldier target takes the Need repairs radio term
  (`0x08574320`).
- A player notices: a damaged tank parked next to a bot engineer is never repaired, and a human
  driver who shouts "Need repairs!" gets nothing. Bot tanks are repaired only at depots.
- Approach: add friendly hulls to `friends` in `bot-decision.js urgencySpecial`, with their armour
  class, hit-point fraction and radius, and route a bot's RepairPack round through a shared
  `useRepairPack` helper (`hand-fire.js`, `bot-referee.js`).
- Found by: ai-b, seams-players.

**9. Live soldiers never jump, backpedal or draw a weapon** (high, M)
- Retail: `Lb_Stand`, `Lb_Walk*` and `Lb_Run*` enter `Lb_StandJump` and `Lb_RunJump` on
  `c_PIAction` and `Lb_RunBackward` on negative throttle, and the engine sets
  `Ub_StandRaiseWeapon<W>` on an item change (vanilla `AnimationStatesLower.con`).
- A player notices: in every live match, other soldiers jump with their legs planted, back away on
  forward-walking legs, and swap weapons without lowering and raising them. Your own body in the
  F10 chase view does the same. Only replays play these clips.
- Approach: feed `soldier-actions.js` live events (the `POSE_FLAG_JUMP` edge, the backward sign,
  the item change) in `bot-visuals.js` and `remote-gait.js`. Remotes need the jump bit and the
  backward sign in the snapshot.
- Found by: soldier-body.

**10. Vehicle dust, wakes and placed smoke never play** (high, M)
- Retail: vehicles carry speed-driven emitters on their wheels, tracks and hulls (`e_wdustPanz` on
  27 tank tracks, `e_wdustPlane`, `e_WaterTouchPlane`, the boats' `e_waterBoat*` wakes and
  `e_WaterFront*` bow waves), filtered by surface and gated by depth (`Emitter::handleUpdate`
  `0x081e3200`). Statics carry looping smoke: Stalingrad's ten burning buildings, the factory
  chimneys on El Alamein, Tobruk, Gazala, Anzio and Peenemunde.
- A player notices: on every map. Tanks raise no dust, landing planes throw no spray, boats leave
  no wake on Wake, Midway or Coral Sea, and Stalingrad stands without smoke.
- Approach: the bake already keeps these bundles. Stop `idle-vehicle.js idleFirePose` hiding them,
  and run each as an attached `EffectPlayer` fed with the host's speed, ground material and depth.
  Placed statics loop from level start. Mod weather mostly follows from this (entry 66).
- Found by: render.

**11. No dynamic shadows** (high, M)
- Retail: `fx::ShadowManager` renders each `hasDynamicShadow 1` object within 50 m into a 128 px
  texture and projects it onto the ground, gated by the SHADOWS video row (VID-7). Vanilla has 244
  `hasDynamicShadow 1` lines (vehicles, soldiers, hand weapons) and `shadow.shadowColor` on 39 levels.
- A player notices: at once and everywhere. A low plane, a tank or a running soldier has no shadow,
  so height and ground contact read poorly.
- Approach: a projected silhouette per flagged object within 50 m, or a camera-following
  directional shadow map that only the terrain receives, tied to the SHADOWS row in
  `video-settings.js`. Confirm the 50 m and 128 px on `BF1942.exe` first: they come from the Mac dump.
- Found by: render.

**12. Soldier movement sounds: only walk and run** (medium-high, M)
- Retail: `SoldierSound.inc` loads 26 scripts, including crawl, crouch move, the four stance
  changes, jump, per-material landings, ladder, swim and healed-by-medic, with their own cadences
  (`setCrouchFrequency 0.50`, `setCrawlFrequency 0.6`, `setLadderFrequency 0.46`).
- A player notices: crawling sounds like walking, and climbing a ladder, jumping, landing, swimming
  and dropping prone are silent.
- Approach: extract the scripts (`extract_soldier_sounds.py`), route footsteps by gait, and fire the
  one-shots from the stance, jump, ladder and swim transitions, for bots and remotes too.
- Found by: sound-radio.

**13. Rooms have no bots (no online co-op)** (high, L)
- Retail: a dedicated server tops itself up with bots every tick (AI-7), so humans and bots share an
  online round. `listPlayers` prints "is an AI bot" for them (CON-24).
- A player notices: any online game with fewer players than a full room is an empty map. Co-op
  online cannot be played.
- Approach: run `bot-referee.js` inside the room's `World`, as `sim/match.mjs` already does headless,
  give bots roster and snapshot slots, and drive their damage through `authority.mjs`. The CPU budget
  per room on the single production node is the constraint. This is the owner's call: ai-a reads the
  bot-free room as a design choice.
- Found by: netcode-server, seams-players.

### Tier 2

**14. No pre-game countdown** (medium, S)
- Retail: status 3 holds every player at `serverGameStartDelay` (20 s) on a new map and 10 s on a
  restart, writing it into every player's spawn wait (`gameStatusPreGame` `0x08150950`, the loop at
  `0x081509e3`). The plate reads TIME UNTIL GAME STARTS (HUD-23).
- A player notices: in a room the fight starts the moment the level loads.
- Approach: a `preGame` status with its own clock in `round-state.js`. `maySpawn` already refuses
  outside `playing`. Send the status in HELLO and the round rows so the relay's plate lights up.
- Found by: modes, netcode-server.

**15. A stranded side never loses in a room** (medium, S)
- Retail: TKT-5 and TKT-8. A side with no spawn groups and nobody alive bleeds at 1000 tickets a
  minute. Built on the page.
- A player notices: on DC Weapon Bunkers, or any carrier side once its ships sink, a room round never
  ends.
- Approach: pass `sides` to `round.tick` in `server/authority.mjs` (and `sim/match.mjs`), computed
  with `spawn-flags.js`.
- Found by: modes.

**16. A late joiner's scoreboard starts at their join** (medium, S)
- Retail: the joining client gets every player's score, kills and deaths in the database (J-1,
  `sendDatabase` `0x08134400`).
- A player notices: someone joining mid-round sees everyone at 0, and the end-of-round best three can
  be wrong for them.
- Approach: keep per-slot tallies in `authority.mjs`, send them in HELLO and on change, and seed the
  board from them.
- Found by: netcode-server.

**17. Soldiers walk through each other** (medium, S)
- Retail: `ResponsePhysics::checkObjectVsObject` `0x08259690` pushes two overlapping soldiers apart
  to 1.0 m, by position, with no damage. A seated soldier does not move.
- A player notices: bots and players stand inside each other at spawns, in doorways and on ladders.
  Nobody can body-block a door.
- Approach: a pair pass in `world-soldier-tick.js` after the bodies step, shared with the server.
  Re-derive the signs at `0x082597xx` first.
- Found by: seams-world.

**18. A bot on foot steps aside only on contact** (medium, S)
- Retail: the infantry row's `BBAvoid` predicts contact 5 s ahead (AI-119), and
  `BBPAvoidCollisionInfantery::createPlan` `0x08588400` is a 9 KB side-step plan.
- A player notices: bot squads bump and shuffle through each other at doors and narrow paths.
- Approach: give `urgencyAvoid` the pilots' `collisionPredicted` test, and read `0x08588400` to
  replace the invented 45 degree, 5 m step in `bot-plans.js`.
- Found by: ai-a.

**19. No "entered your vehicle" / "left your vehicle" lines** (medium, S)
- Retail: `GameClient::handleGameEventManagerEvent` cases 7 and 8 print `ENTERED_YOUR_VEHICLE` and
  `LEFT_YOUR_VEHICLE` for anyone else who boards or leaves the local player's hull.
- A player notices: constantly in Instant Battle, as bots climb in and out of their tank or bomber.
- Approach: a builder in `chat-log.js`, called from the occupancy events in `comms.js`.
- Found by: hud.

**20. No "joined the axis team" line** (medium, S)
- Retail: event `0x36` and `GameServer::setTeam` print `name + JOINED_THE + AXIS_TEAM|ALLIED_TEAM`
  in that side's colour.
- A player notices: at round start and whenever someone picks or changes a side.
- Approach: a `joinLine` in `chat-log.js`, fed from the room's team rows. Check the `setTeam` guard
  (`this[0x2e8] == 0`) to see whether bots print it in single player.
- Found by: hud.

**21. A radio speaker does not blink on the minimap** (medium, S)
- Retail: `Radio::outputRadioMessage` adds any speaker other than the local player to
  `MenuMapNode`'s flash list for `game.setRadioFlashTime` blinks, drawn yellow.
- A player notices: when a teammate calls "Medic!", the map does not show who called. This holds only
  if the default count is not 0 (section 6).
- Approach: a flash list in `map-friendlies.js`, fed from `comms.js` `receive`. Settle the default
  first.
- Found by: hud, sound-radio.

**22. P does not pause single player** (medium, S)
- Retail: `c_GITogglePause` runs `Setup::toggleGamePause`: status 4, the Default volume group muted,
  and `GAME_PAUSE` ("PAUSED") on screen.
- A player notices: pressing P in Instant Battle does nothing, though the controls screen lists it.
- Approach: handle the key offline in `page-input.js` through the console's `toggleGamePause` seam,
  mute the master group, and draw the PAUSED node from `menu/InGame`.
- Found by: hud.

**23. No friendly-mine warning icon** (medium, S)
- Retail: the landmine's `projectileType 1` and `addToProjectileList 1` put it in the projectile map.
  `MenuMapNode::onPaint` lights `ShowMineIcon` when a friendly mine is within 15 or 30 m.
- A player notices: nothing warns them before they drive onto their own team's mines.
- Approach: keep a list of live friendly type-1 rounds and set `ShowMineIcon` per frame in
  `soldier-view.js`. The HUD pack already has the widget. Settle which radius applies on foot.
- Found by: orphan-words.

**24. A stance change cuts the bolt cycle** (medium, S)
- Retail: BODY-2. The torso changes stance only while `HandFireArms::isReadyToUse` answers true,
  which it does not while the fire, reload, eject or overheat timer runs. DIE-8 uses the same gate
  for the upper death state.
- A player notices: a bot with a K98 or No4 that crouches or drops prone within a second of a shot
  loses the bolt animation in third person.
- Approach: give the body a `ready()` callback from the hand weapon, and keep the torso in
  `soldier-actions.js stanceChanged` while it is false. Check against BODY-15's recording.
- Found by: soldier-body.

**25. Trees do not sway** (medium, S)
- Retail: `geom::Swayer::update` rocks 23 vanilla tree geometries (`swayEnable 1`, mostly
  `swayRangeDegrees 1.1`) with two sines, faded by `swayLodDistance`.
- A player notices: the European maps' pines stand perfectly still. Subtle.
- Approach: export the `sway*` words and add a vertex-shader rotation about the trunk base in
  `tree-foliage.js`. Read the Swayer in `BF1942.exe` before fixing the constants.
- Found by: render.

**26. A room has no host settings and no admin** (medium, M)
- Retail: CREATE GAME sets the `game.server*` words (time limit, score limit, ticket ratio, spawn
  time, friendly fire, password and the rest; NET-21 defaults), and an admin has `admin.kickPlayer`,
  `banPlayer`, `changeMap`, `restartMap` and `serverMessage`.
- A player notices: whoever creates a room cannot set a time limit, tickets, friendly fire or spawn
  time, and cannot remove anyone. Fourteen of CREATE GAME's rows are taken by no room.
- Approach: carry the settings in the room-create row, keep them in `room-registry.mjs`, and pass them
  to `createRoundState`, `friendlyDamage` and the wave law. Give the creator an admin flag with the
  `admin.*` words routed to the room.
- Found by: console-menus, netcode-server.

**27. No team-kill punish, forgive, penalty or kick** (medium, M)
- Retail: `_giveDamage` `0x0814c1bc` marks the victim's last team killer. With punish mode off the
  counts rise at once and the killer is killed at `nrOfTKToKick` 5 (`0x0814c224`); with it on, they
  rise only through `TKPunish` `0x081593d0` (`TKForgive` `0x081592e0` clears them), which kicks at the
  limit. `spawnPlayer` kicks at the limit (`0x0814d841`), `killPlayer` adds `spawnDelayPenaltyForTK`
  (1.0) per TK to the next wait, and `banPlayerOnTKKick` can ban.
- A player notices: online, a team killer is never penalised or kicked, and the victim is never
  asked. Offline it matters only once waves exist.
- Approach: per-player counts in `authority.mjs decreeDeaths`, a `punish`/`forgive` action and the
  console words, the penalty in the wave wait, and the kick through `room.leave`. Settle the penalty
  formula and the victim's prompt first (section 6).
- Found by: console-menus, damage, modes, netcode-server, seams-players.

**28. No votes (map, kick, team kick)** (medium, M)
- Retail: `GameServer::updateVoteSystem` `0x08149d60` steps four `Vote` objects every frame. Votes
  need `ceil(players x majority)` (0.6, 60 s in the shipped `AdminSettings.con`), counted over the
  target's side for a team kick, and `VoteEvent` reaches the clients (NET-20). The client has 7/8,
  Insert, the `VOTEMSG_*` lines and the scoreboard's buttons.
- A player notices: in a room there is no way to kick a griefer or change map, and 7/8 do nothing.
- Approach: a vote module on the room with a `VoteEvent`-shaped row, the console words and key
  handlers, and the map-vote list. Read `updateVoteSystemVote` `0x08149dc0` for timing and defaults.
- Found by: console-menus, hud, netcode-server.

**29. A blocked exit puts you in the wall** (medium, M)
- Retail: `GameServer::toggleEntryPoint` `0x0814ee70` asks `PlayerControlObject::isAllowedToExit`
  `0x08317490`. With `hasRestrictedExit` set (every vanilla tank and the Willy), it tests a segment
  from the hull to the exit point, tries the mirrored side on a hit, and refuses the exit when both
  are blocked.
- A player notices: a tank parked with one side against a wall, rock or another tank puts them into
  it, where retail steps them out on the other side or keeps them inside.
- Approach: in `vehicle-entry.js exitSeat`, cast the segment (+0.5 m up), mirror X on a hit, or keep
  the occupancy and consume the press. The room's exit needs the same. Check first whether the test
  sees terrain.
- Found by: seats-guns.

**30. A blast on a hull never hurts its seated crew** (medium, M)
- Retail: HFD-12. After the hull, `handleExplosion` `0x08156ef0` walks the seat map and splashes each
  seated soldier whose flag bit 0 is clear (`0x08157167..0x08157271`).
- A player notices: a grenade or shell on a jeep or an open gun seat wounds or kills the crew in
  retail. Ours leaves them untouched until the hull dies.
- Approach: settle which seats carry bit 0, then add the occupant pass to `applySplash` in
  `server/room-hits.mjs` and the page.
- Found by: hud.

**31. A bot tank takes cover like a soldier** (medium, M)
- Retail: the Tank and ArtilleryDriver rows register `BBTakeCover` `0x0857c120` and `BBPTakeCover`
  `0x085c6b80`: cover portals, vehicle occupancy, and a plan with no poses.
- A player notices: a bot tank under fire looks for soldier-sized cover within 20 m, or the lowest
  ground, instead of pulling behind a building.
- Approach: read both functions and add a hull TakeCover state in `bot-behaviours.js`, dispatched by
  the row's generator.
- Found by: ai-a.

**32. The commander ignores where its side is losing** (medium, M)
- Retail: `AIStrategicArea::update` `0x0863d6d0` adds `EnemyStatistics::sample` `0x0862dfa0` to the
  wanted strength of each area (AI-168, the sampler unread).
- A player notices: the bots never reinforce a flag where their side keeps dying. They spread by
  headcount alone.
- Approach: read the sampler and `SampleHelper::addSample` `0x0862e0a0` and what feeds them, then
  port them into `strategic-ai.js _updateAreas`.
- Found by: ai-b.

**33. Bots rarely lob grenades** (medium, M)
- Retail: AI-158. `BBPFireInfantery::createPlan` `0x085a3870` picks a thrown weapon as well
  (`soldier_choseThrownWeapon` `0x085cf300`) and has a throw mode in its eight-state switch.
- A player notices: bot infantry seldom put grenades over a wall at a held position.
- Approach: read the state switch, then add a throw plan to `bot-plans.js planFire`. The referee
  already flies thrown rounds.
- Found by: ai-b.

**34. No hand signals on a shout** (medium, M)
- Retail: a shout on foot plays the voice and then one of seven `HandSign_*` one-shots (RADIO-3,
  client `0x004feb20`; lnxded `speakLine` `0x0826e220`).
- A player notices: a teammate who shouts "Medic!" or "Follow me!" next to them does nothing with
  their arms.
- Approach: bake the seven `3pHandSign_*` clips, find which machine carries them, and play
  `radio.js`'s existing `sign` from `comms.js receive`.
- Found by: soldier-body, sound-radio.

**35. The Garand's clip eject has no animation** (medium, M)
- Retail: `BFSoldier::handleMessage` sets `Ub_StandEjectClip<W>` or `Ub_LieEjectClip<W>` on
  `FireArms::startedEjecting` (`0x082775d8`), with the weapon's own `WeaponEjectClipM1Garand`.
- A player notices: every US rifleman hears the ping while the first-person rifle stays still.
- Approach: bake the 1P state and the weapon clip into the Garand's arms rig, and play them from
  `stepDryMagazine`.
- Found by: soldier-body.

**36. Track belts stay rigid** (medium, M)
- Retail: `useAsBone` and `setBoneOriginOffset` (`0x082685a0`, `0x08268680`) bind each bogie to a
  bone of the track's skin on 44 tracks.
- A player notices: on rough ground the road wheels move but the tread does not wrap them.
- Approach: as `features/bf1942-3d-models/parity-audit/animation.md` lays out. It needs skinned glbs
  and a re-bake of every tree.
- Found by: orphan-words.

### Tier 3

**37. Explosions look the same on every surface** (low-medium, S). Retail: `useMMOnEndEffect` on
the two grenades, the satchel and the rifle grenade picks the end effect by material
(`Projectile::startEndEffect` `0x0831f602`). Notices: a grenade in water bursts like one on grass.
Approach: export the flag, and pick `impactEffect` by the surface in `round-impact.js detonate`.
(orphan-words)

**38. No turning on the spot or idle fidgets** (low-medium, S). Retail: `Lb_TurnLeft/Right` on
mouse-look X, `Lb_StandRelax`, and `Ub_Idle<W>1..3` / `Ub_CrouchIdle<W>1..3`. Notices: a soldier
standing still is frozen in the aim pose and turns on planted feet. Approach: bake the states and
drive them from the yaw rate and ANIM-6's dwell. (soldier-body)

**39. A hull's Scout never turns the hull** (low, S). Retail: `BBPScout` `0x085c3a70` turns the hull
when the gun cannot look. Notices: a tank destroyer sits facing away from a threat. Approach: branch
`bot-plans.js planScout` on `bot._turretCanPoint`. (ai-a)

**40. Four AI placeholders labelled INVENTION** (low, S). Retail: the tank's attack-portal firing
point (AI-116, `getAttackPortal`), the landing approach radius (AI-113), the pilot's break point
(AI-83, near `0x0859bc90`), and the air-avoid grid test and plan speed (AI-95). Notices: rarely.
Approach: read each function and replace the placeholder. (ai-b)

**41. The bots' radio subscriptions are hard-coded per mod** (low, S). Retail: each mod's
`Game/AI/radio.con`. Ours hard-codes vanilla's list (right for every shipped mod read so far). The
`bot-radio.js` header says 22 messages where the list has 21. Approach: read the level's file.
(ai-b)

**42. No cap on live mines and packs per weapon** (low, S). Retail: FA-2's pool of
`2 x magSize + 1` recycles the oldest, and a picked-up kit brings the dead player's laid packs onto
the new holder's detonator. Notices: an engineer who refills at a depot can carpet a road. Approach:
a pool per weapon in `round-launch.js`. The kits-healing fixer covers the release on kit death.
(damage, soldier-weapons)

**43. The hull push ignores rotation and mass** (low, S). Retail: COL-2's share snaps to 1 only
above 0.95, and the probe moves in the hull's full frame. Notices: a pivoting tank's stern sweeps a
soldier the probe misses, and a motorbike shoves like a tank. Approach: carry the probe through
`fwd_now * inv_prev` and pass the hull's mass. (seams-world)

**44. No depot icons while seated, no repair icon** (low, S). Retail: SUP-17's `ShowRepairIcon`,
`ShowHealIcon` and `ShowReloadIcon`. Ours sets only the last two, and only on foot. Approach: set
them from `vehicle-hud.js` with `canRepair` and `canRearm`. Read the client's writer first.
(modes)

**45. Typed console words that answer "Unknown object"** (low, S). Retail registers `suicide`,
`name`, `game.sayAll`, `ignore`/`unignore`/`ignorelist`, `ignoreRadioText`/`ignoreRadioAudio` and
the buddy list for players, and `outputRadioMessage` honours the ignore list. Approach: register
them against the deploy screen's suicide, `comms.sayLine`, and an ignore set in `chat-log.js`.
(console-menus, sound-radio)

**46. No ping column in rooms** (low, S). Retail: MEME-27 column six. Ours fills it only on a relay.
Approach: publish each connection's pong round trip in the roster. (console-menus)

**47. No auto-balance on death** (low, S). Retail: `killPlayer` `0x0814dc1f` moves a dead player
when `serverAutoBalanceTeams` is on and the sides differ by more than one. It is off by default.
Approach: one test in `decreeDeaths` once rooms have settings. (netcode-server)

**48. No welcome message, password or reserved slots** (low, S). Retail: `WelcomeMsgEvent`
`0x0811f8c0`, `serverPassword`, `serverNumReservedSlots`. Approach: optional fields on the create
row and a check in `room-registry.mjs join`. (netcode-server)

**49. No "connection problems" HUD line** (low, S). Retail: `GAME_MESSAGE_CONNECTION_PROBLEM` as a
red HUD line. Ours shows its own dialog. Approach: route `net-room.js`'s stall detection to the HUD
line. (hud)

**50. HUD text spacing and glyph snap** (low, S). Retail: FONT-3 rescales glyph metrics by display
width (a DIFFERENT with no fixer) and FONT-5 snaps glyphs in lists and text fields. Notices: text is
slightly tighter than a 1920 retail screen. Approach: a width table and a rounded pen in
`bitmap-text.js`. (hud)

**51. Secret Weapons rocket details** (low, S). Retail:
- the Wasserfall launcher is destroyed once out of ammo (`destroyVehicleWhenNoAmmo`,
  `disableWhenFired`, `FireArms::fireFinished` `0x0828853d`);
- riding the missile shakes the camera (`vehicleCameraShake`, `0x0831c010`);
- the camera lingers 15 m behind the rocket for 5 s after it hits (CAM-4, built only in replays);
- the Natter shows rocket burn on an inverted heat bar (`inverseHeatBar`, `setHeatBarType`);
- the Calliope's rocket seat cuts free look to a tenth (`*AngleMultiplier 0.1`);
- SPAWN-14's pad hold exempts the Wasserfall by its tooltip type (a DIFFERENT with no fixer).

Approach: each is a small read of an exported word. The tooltip type comes with entry 57.
(orphan-words, seats-guns, vehicle-physics)

**52. Submarine spawns and the use-button spawner** (low, S). Retail: `disableSpawnPointsOnEnter`
on the Gato and Sub7C, and `useButtonRadius 2` on their dinghy spawners (`getUseButtonRadius`
`0x08314980`). Neither reader is traced. Notices: players deploy onto a submarine that is under
way, and its dinghy appears without anyone asking for it. Approach: trace the readers, then gate
spawns and pads. (orphan-words, modes)

**53. Two mod-only fields never read** (low, S). `RotationalBundleTemplate.lesserYawAtSpeed`
(`0x081d9e90`, no vanilla writer) and SUB-6's `subPos`, which decides who sees the submarine HUD.
Approach: export both if a mod survey finds a writer. (vehicle-physics)

**54. Sea depth colour per pixel** (low, S). Retail: WATER-2 colours a 17 x 17 vertex grid every
16 m. Ours samples per pixel. A DIFFERENT with no fixer. Notices: retail's shoreline gradient is
blockier. Approach: optional. (render)

**55. A room replays one map forever** (low, M). Retail: `serverNumberOfRounds` (default 5) then
`nextLevelInMaplist` (ROUND-9, `gameStatusEndGame` `0x08153356`). Approach: a per-room map list and
a mid-session level swap. This is a product decision first, since a room is created for one level.
(console-menus, modes, netcode-server)

**56. No GENERAL OPTIONS screen** (low-medium, M). Retail: OPTIONS > GENERAL sets crosshair colour,
minimap transparency and rotation, tooltips and radio colour. Ours has the values but sets them only
from an imported profile or the console. Approach: a fourth section in `controls-screen.js` from the
extracted menu layout. (console-menus)

**57. No tooltips** (low-medium, M). Retail: `ToolTipManager` shows `TOOLTIP_CLOSE_TO_*`,
`TOOLTIP_SOLDIER_<kit>` and, on entering a vehicle, a 15 s help block for its class
(`setToolTipType` on 179 PCOs, `enableVehicleTooltip`), with T to toggle. The shipped profile
turns tooltips off (`game.setToolTip 0`). Approach: a tooltip plate in `hud.js` behind the profile
flag. (hud, orphan-words)

**58. A remembered enemy weighs as much as a seen one** (low-medium, M). Retail: AI-72,
`InformationKnown::getSecurity` `0x085e8670` decays from the last sighting. Ours is 1 always.
Notices: a bot that lost sight of a player keeps scoring and cowering from them at full weight.
Approach: trace the decay's record, then decay it in `bot-sense.js`. (ai-b)

**59. BF1918 hulls never roam** (low, M). Retail: BF1918 and GCMOD give armed hulls
`Special BBRoam`. Ours runs no Special on any seat. Approach: read `BBRoam` and `BBPRoam2d` first.
(ai-a, ai-b)

**60. EoD's SAM sites aim like a ship's gun** (low, M). Retail: `FixedGuidedMissileLauncher`
registers `BBFireGuided`. Ours falls to the large-bore rule. A DIFFERENT with no fixer: it needs the
two functions read first. (ai-a)

**61. Large hulls meet the wrong collision layer** (low, M). Retail: COL-22, a root of radius 4 m or
more meets a static's col0. Ours keeps one layer. No case has been found where it shows. (vehicle-physics)

**62. Terrain at full detail at every distance** (low, M). Retail: TERR-8's distance law and
WATER-3's skipped dry tiles. Ours draws full detail everywhere. The gain is performance.
(render)

**63. No voice pool or priority stealing** (low, M). Retail: SND-39 and SND-44, a `setChannels` pool
with priority stealing. Notices: a big fight sounds denser than retail. (sound-radio)

**64. No faces or lip-sync** (low, L). Retail: about 30 `Face*` states and the speak visemes. It
needs face bones on the soldier skin. Leave it for last. (soldier-body)

**65. A ship bot ignores a seat request** (low-medium, S). Retail: `BBChangeTeleport` scores a
standing request on its own seat (`0x085619ce`). Ours passes no request age to
`urgencyChangeTeleport`, so asking a destroyer's bot gunner for their seat does nothing. The plan
`0x08590590` is unread. (ai-b)

**66. Mod weather** (medium on mods, none in vanilla, M). Retail: 42 mod levels place rain or snow
statics whose child is a large-box emitter (FHSW 18 levels, bf1918 13, Battle_Of_Foy). Most of it
comes with entry 10. Survey the mods for `Weather.initWeather` before building
`WeatherParticleSystem`. (render)

**67. No chat beep** (low-medium, S). RADIO-12's patch 5 on every player chat line. It comes with
entry 5. (sound-radio)

**68. Vehicles on a moving deck** (medium, M). The vehicle half of entry 6: a plane released on a
carrier under way, EoD's LCT tank, and BF1918's trains. It is the same relative-velocity term in
`body-friction.js` and the ground laws. (seams-world)

## Kept on purpose, for the owner to confirm

These are departures from retail that our code already labels as our own choice. Each one needs
only a yes or no.

- **Bots hold fire when a teammate is in their line. Kept: the owner confirmed it on 2026-11-12.** Retail bots fire through a teammate, and the
  friendly-fire ratio decides the damage (FF-7). `bot-plans.js holdFireFor` is on by default and
  marked INVENTION; `?holdfire=0` and the engine-parity runs turn it off. (seams-players)
- **A sound loop starts at a random offset** (SND-47). Retail starts at 0. Ours is random so that
  engines do not phase-lock. (sound-radio)
- **Every bot runs the full mover** (AI-160). Retail's LOD 2 mover drops deck bots into the sea,
  which ai-b reads as a defect not worth copying. The world-physics fixer is looking at it (section 3).
- **Rooms have no bots** (AI-7). ai-a reads this as by design. Entry 13 is the build if the owner
  wants online co-op.
- **A room is made for one level** and restarts it. Entry 55 is the build if not.
- **Instant Battle's column redesign** in `play/bot-settings.js` is the owner's choice. Only the two
  lost rules (ticket penalty, bot ratio) are being restored (section 3).
- **The room's heartbeat timeout is 25 s** (NET-22) and **there is no input-clock steering** (D-8):
  both are documented departures.
- **Squad follow in `doctrine-squad.js` is an invention**, not a reply to "Follow me": retail bots
  ignore that call. Generated levels run the invented pathfinding layer because they have no
  strategic map. (ai-b)
- **The replay's chase camera on bots** is our own feature. Retail chases only a human occupant
  (CVM-3). (seats-guns)
- **Viewer caps with no retail number:** the swim speed (`SWIM_SPEED_CEILING_FACTOR`, about 2 m/s)
  and the free-fall look-steering cap (PARA-9, 12.28 m/s). Both are labelled viewer numbers until a
  lab recording settles them. (soldier-body)

## Settled along the way

**Things retail never does, so there is nothing to build.**

- **Retail bots never lay mines, plant charges, fetch ammo, repair through a behaviour, or speak on
  the radio.** `BBRepair`, `BBResupply`, `BBMine`, `BBExplosives`, `BBRadio`, `BBIndirect`,
  `BBCombatMovement` and `BBManWpn` have bodies, but nothing calls their constructors. `BBBailOut`
  has a create function, but no shipped `AIbehaviours.con` (vanilla, FH, FHSW, EoD, bf1918, GCMOD)
  registers it. soldier-weapons' "bots never lay mines" finding is closed by this. Engineer bots do
  repair, but through MedicAssist (entry 8). (ai-a, ai-b, seams-players)
- **Retail bots ignore** Follow me, Stick together, Fall back, Go for enemy flag, Pickup,
  Defending, Attacking, Roger and Negative: `radio.con` does not subscribe them. FireInHole is
  subscribed, but no behaviour reads it. `BFEnvironment::getRadioedObjects` `0x085e31d0` is an empty
  stub, so a "spotted" call never adds a known object. (ai-b, seams-players)
- **`PlaneWeights` is dead**: no `setStandardPersonality` line uses it. (ai-a)
- **Entering a burning vehicle changes nothing** (ARM-7). `PlayerControlObject::enter` calls
  `getHpLostWhileCriticalDamage` and jumps back at `0x083172c2` without storing the result.
  (vehicle-physics; damage had it UNREAD)
- **Retail has no heal, repair or resupply score and no assist credit.** `handleScore` kinds are
  0..9 only, and `ScoreManager` has kill, death, capture, TK, attack, defence, objective and
  objectiveTK. Conquest has no Defence award, and the takers score Attack (2). The capture loop
  (`0x08283d23..0x08283d6f`) pays every taker inside the radius, so `bot-referee.js`'s "INFERRED"
  can cite it. (modes, seams-players, damage)
- **Vanilla's bridges and buildings are indestructible.** Only `Window_m1`, a few gibs and the
  Battle of Britain objective targets carry Armor. Destructible scenery is a mod mechanism (FH's
  `brigde_dest`, FHSW's breakable trees). (damage, seams-world)
- **Vanilla has no weather, no night maps and no dynamic lights.** (render)
- **No fuel and no catapult exist in the binary.** Grenades have no cooking. Mines are never set off
  by soldiers. (vehicle-physics, soldier-weapons)
- **`serverCoopAiSkill` and `serverCoopCpu` are stored only** (AI-22). (netcode-server)
- **`exitTimer` is a dead word**: neither binary has the string. (seats-guns)
- **Twenty-two console words the data writes are dead in retail.** They are the 14 bazooka deviation
  words, `projectileVisible`/`setProjectileVisible`, `hasStartEffect`, `canBeRepaiedAsDestroyed`,
  `deathEffectName`, `noCollisionsAsDestroyed` (which COL-1 lists as live) and `stalingradHouse`,
  plus the bare `startOnEffects`. (orphan-words)

**Contradictions between auditors.**

- **`disarmMinesDistance` is live.** orphan-words called it NOT-GAME ("no reader"). soldier-weapons
  found its readers. Checked on lnxded for this report: `flds 0x2f0(%edx)` at `0x0827613d` and
  `fadds 0x2f0(%eax)` at `0x08276561`, both in `useRepairPack`, with the 2.0 default written at
  `0x0827a39a`. Entry 4 stands.
- **The restricted exit is not built.** vehicle-physics listed `hasRestrictedExit` as handled in
  `vehicle-entry.js`. seats-guns found it unbuilt, and the file's own comment (line 428) says it "is
  not implemented". Entry 29 stands.
- **The TK punish mode default.** modes said the shipped server settings turn it on, while damage and
  seams-players said off. netcode-server reconciles them: the constructor and the client's host file
  are 0 (single player and listen servers), and the shipped dedicated `serversettings.con` is 1.
- **The radio-flash count.** sound-radio says vanilla sets `Game.setRadioFlashTime 7`, while hud
  found no shipped file that sets it. Neither the lab's nor the client's `Mods/bf1942/init.con` has
  the line. This stays open (below).

**UNREAD items worth a read, with what would settle each.**

| Question | Why it matters | What settles it |
|---|---|---|
| Does `serverDeathCameraType` choose the death camera? hud reads `Setup+0x484` as choosing type 1; netcode-server finds the getter called only by the save code. The two also cite different `updateDeathCamera` addresses (`0x081b0350`, `0x081b73c0`). | The death-camera fix in section 3 | xref the getter's callers in lnxded and `BF1942.exe`, and name both addresses |
| The radio-flash count (`BfMenu+0x5d4`) | Entry 21 does nothing if it is 0 | the client's `BfMenu` constructor and the `setRadioFlashTime` static (`0x00963790`) |
| The TK spawn-penalty formula: three readings of `0x0814df1f..0x0814df85` | Entry 27 | one careful read of that range |
| `calcVotesNeeded`: cited at `0x08148880` and `0x0814a430` | Entry 28 | name the function at both addresses |
| Instant Battle's tickets: does a skirmish run the single-player ticket layer? | The spawn-rules fix | `Setup::startSinglePlayerGame`, or `map.html`'s `mode=CoOp` path |
| Bot side split: does the human count when the bots are topped up? | The spawn-rules fix | a lab run with an odd `setMaxNBots` |
| `serverFreeCamera 0`: does it keep a dead player out of the free camera? | Ours lets the dead fly anywhere | xref the setter to `FreeCamera::m_enableFreeCamera` |
| HFD-12: which seats carry flag bit 0 | Entry 30's scope | the writers of `[obj+4] & 1` |
| `addPcoPosId` on the destroyer PCOs: a driver answering for an empty gun seat? | Possibly a visible naval behaviour | callers of PCO vt+0x11c |
| AI-173: a seat request on a ship bot | Entry 65 | `BBPChangeTeleport::createPlan` `0x08590641..0x0859117b` |
| Does each seat keep its own view mode? | Re-entry opens in the wrong view | `PlayerControlObject::enter` `0x08316f00`, or a lab test |
| `exitSpeedMod` and `altSoldierExitPosition` | How fast a soldier leaves a moving hull | the setters' readers in `exit(bool)` `0x08317d00` |
| Wheel tracks and skid marks (`WheelTrackDB`, `numSkidMarks`) | Tank tracks in the sand, if drawn by default | `recorpus.py SkidMarkTemplate --build mac` and its caller |
| Debris "cascades" as physical bodies that sink | Cosmetic, on heavy impacts | whether `effects.js` gives `Gibb_*` ground contact |
| A mod's destroyed bridge: does the span's collision go, and does a hull on it fall? | FH levels | a headless `World` on FH's `brigde_dest` |
| KIT-5: does every machine see the kit variant the server rolled? | FHSW random kits online | `KitNetworkable` `0x0822b600..` |
| HP-6d: who writes `lastCollisionHeight` | Fall damage after a mid-air exit | `Armor::update`'s writes to `+0x28` |
| CA-10: a bot B17 past the edge loses no hit points | Whether we burn a plane retail spares | the seated branch at `0x08152445` |
| What plays `SoldierHealedByMedic.ssc`, and music slots 6 and 7 | Two silent sounds | callers of SoldierSound `vt+0xc(0x16)`, and of `playMusic(6)`/`(7)` |

The other UNREAD items (AI-15's plan-step half, AI-91, the strategy manager's con words,
`hasStaticColor`, `invisibleAtEndEffect 0`, `projectile2Template`, `setForwardMod`,
`removeAtRestart`, `setFireCameraShakeAnimationState`, `nextCamera`,
`getBotRequestedPlayerControlObject`, `isOccupied`, the dynamic envmap, the underwater view, FHR-9,
XHIT-9, HUD-4's nation key and `billboardLightScale`) are low impact. Each is in its bucket report
with what settles it.

## Rows the ledger needs

Retail behaviour that this audit read and that has no ledger row yet. Addresses are lnxded's unless
marked client or Mac.

- The AI's radio reads, one row per behaviour: Fire `0x085652b5..0x08565329` (37, 43, 38), MoveTo
  `0x08575035..0x08575096` (49, 44, 36), Scout `0x0857a81a..0x0857a98a` (52, 15..21), TakeCover
  `0x0857d05f` / `0x08581039` (41) and TakeCover3d `0x0857e651` (52), MedicAssist `0x08573d55` /
  `0x08574320` (40, 54), ChangeLandingCraft `0x085604c1` (53). ai-b proposed AI-174 and AI-175; those ids went to the burst clock and a bot-weights row the same day, so these take the next free AI ids.
- MedicAssist takes friendly hulls as RepairPack targets: `0x08573840`, `0x08574320`.
- The bot's fire and move inclinations: `BotMain` `0x0852e280..0x0852e395`, smoothed `0.8 v + 0.2 acc`.
  This is a correction to AI-43.
- `ChangeInhibit`'s values and the modifier column per row, from vanilla `AIbehaviours.con`.
- The hull rows' plans: `BBTakeCover` `0x0857c120` / `BBPTakeCover` `0x085c6b80`, `BBPScout`
  `0x085c3a70`, `BBPAvoidCollision2d` `0x08586420`, `BBPAvoidCollisionInfantery` `0x08588400`,
  `BBFireGuided`.
- The behaviour classes that are never constructed (`BBRepair`, `BBResupply`, `BBMine`,
  `BBExplosives`, `BBRadio`, `BBIndirect`, `BBCombatMovement`, `BBManWpn`), the unregistered
  `BBBailOut`, the dead `PlaneWeights`, and the `getRadioedObjects` stub `0x085e31d0`.
- Bot side assignment: `getTeamToAddPlayer` `0x08261670`, called from the top-up loop at
  `0x08150ee3` with the ratios at `GameServer+0x2bc` / `+0x2c0`.
- `GameServer::setTeam` `0x08131800`: `forcePlayerToTeam` `+0x2b8`, autobalance `+0x1d0`, a live
  player killed on a change (`0x08131950`). Autobalance on death: `0x0814dc1f`.
- Team kills: `_giveDamage` `0x0814c1bc`, `TKPunish` `0x081593d0`, `TKForgive` `0x081592e0`,
  the kill at the limit `0x0814c224`, the kick in `spawnPlayer` `0x0814d841`, the ban in
  `destroyPlayer` `0x08133f4c`, the wait penalty in `killPlayer` `0x0814df1f..`, the fields
  `+0x4d4` / `+0x4d8` / `+0x4e0` / `+0x4e1` and `BFPlayer+0x188` / `+0x18c` / `+0x190`, and the
  constructor defaults 1.0, 5.0 and off.
- Votes: `updateVoteSystem` `0x08149d60`, `calcVotesNeeded`, `Vote::layVote` `0x0815dc30`, the
  failure strings, and the shipped 0.6 / 60 s. A `VOTE` prefix is worth opening.
- Rounds per map: `setNrOfRounds` `0x0813dc90`, `gameStatusEndGame` `0x08153356`.
- Pre-game writes every player's wait: `gameStatusPreGame` `0x081509e3`.
- The capture loop pays every taker: `ControlPoint::handleFrameUpdate` `0x08283d23..0x08283d6f`.
- No heal, repair or resupply score: the complete `handleScore` list.
- `WelcomeMsgEvent` `0x0811f8c0`, and `serverDeathCameraType` stored only (settle it first).
- The death camera: `FreeCamera::updateDeathCamera`, `followNextPlayer` `0x081b0150`,
  `setDeathCamera` `0x081afce0`.
- The HUD's game-info lines: `ENTERED_YOUR_VEHICLE` / `LEFT_YOUR_VEHICLE` (events 7 and 8) and
  `JOINED_THE` (event `0x36`, `setTeam`).
- The minimap flash list (`MenuMapNode::addPlayerToFlashList`, `setRadioFlashTime`), the ignore list
  and `IgnoreRadioAudio` in `Radio::outputRadioMessage` (client).
- Pause: `Setup::toggleGamePause` and `GAME_PAUSE` (client).
- Tooltips: `ToolTipManager`, `enableVehicleTooltip` (Mac `0x0046b3b8`), `setToolTipType`
  `0x0831b9e0` with the `TT*` enum, and `c_PIToolTip`.
- GENERAL OPTIONS menu data (Mac `GeneralOptions::registerMenuData`).
- The vehicle's death blast: `Armor::status` `0x08173d60..0x08173df0`. HP-2 and HP-8 mention it
  but never say it is unbuilt.
- The restricted exit: `isAllowedToExit` `0x08317490`, the X-mirror retry, the instance's
  `+0x18c` / `+0x198`, and `exit(bool)` reading them at `0x08317e1d`. SEAT-5 says only that a check
  exists.
- The wrench: the crouched disarm (`disarmMinesDistance` `+0x2f0`, `0x0827613d`), the stance gate,
  the team gate `0x08276731`, and `BFSoldierTemplate+0x2a0` / `+0x2b4` = `ExpPackProjectile` /
  `LandmineProjectile`.
- The friendly-mine icon: `MenuMapNode::onPaint`, the projectile map, the 15 / 30 m radii and
  `ShowMineIcon` (client).
- `useMMOnEndEffect`: `Projectile::startEndEffect` `0x0831f602`.
- The dead console words (section 6), so that nobody builds them.
- `BFSoldier::projectileHit` `0x0827ea20` plays `SoldierFFHitDamage` (slot `0x13`, a 3 s stamp per
  soldier, the `noFFSound` opt-out). This is a correction to FF-6.
- Hand signs on lnxded: `speakLine` `0x0826e220` and `speak` `0x0826e3e0` push `HandSign_Freeze`
  `0x086d1dd8`.
- The eject-clip body state: `handleMessage` `0x082775d8`, `FireArms::startedEjecting` `0x0828f970`.
- The lower turn states on mouse-look X, the 3P idle fidgets and `Lb_StandRelax`, from the
  animation script data.
- Material 99 on a soldier: `handleCollision` `0x0827d3c8` to `0x0827dd60`, 1e10.
- The "standing on" pointer `+0x558` (`handleCollision` `0x0827d3b0`), read only by
  `BFSoldierNetworkable::updateStateMask` `0x082228e4`. It shows that the deck carry is friction,
  not parenting.
- No destroyed-state test in `ResponsePhysicsManager::update` `0x0825d0b0`: "a wreck stays a body
  until removed" (HP-19 or HP-21).
- KNOCK-4 and KNOCK-5's Where cells should say that the vehicle half of the push is unbuilt, with
  the data (Willy 20, Sherman 13, Spitfire 15).
- The soldier-soldier separation in `checkObjectVsObject` `0x08259690`.
- Ambient and motion emitters on vehicles and statics (`world::Emitter`, `Emitter::handleUpdate`
  `0x081e3200`).
- `fx::ShadowManager`'s pass (pool, 50 m gather, 128 px textures, `shadowColor`). Only VID-7's gate
  has a row.
- `geom::Swayer` and the `TreeRenderer` sway words.
- `fx::WeatherParticleSystem`, `RainParticle`, `SnowParticle` and `WeatherDB`.
- `SoldierSound.inc`'s 26-script index and per-gait cadences.
- `BfMenu::playMusic`'s seven slots, and the volume rule music x master.
- `EnemyStatistics::sample` `0x0862dfa0` and `SampleHelper::addSample` `0x0862e0a0` (AI-168's open
  half).
- ARM-7 can be closed: entering a burning vehicle does nothing (`0x083172c2`).

## Where the evidence is

Each auditor's full report is copied in [`buckets/`](buckets/), with local paths replaced by
neutral text (`<audit scratch>` for the audit's scratch folder, `~` for the home folder). The scratch
tools they name were not kept in the repo.

[ai-a](buckets/ai-a.md) (behaviour rows and classes) ·
[ai-b](buckets/ai-b.md) (radio, MedicAssist, the commander, pathfinding) ·
[console-menus](buckets/console-menus.md) ·
[damage](buckets/damage.md) ·
[hud](buckets/hud.md) ·
[modes](buckets/modes.md) ·
[netcode-server](buckets/netcode-server.md) ·
[orphan-words](buckets/orphan-words.md) (the console words our extractor drops) ·
[render](buckets/render.md) ·
[seams-players](buckets/seams-players.md) (players, bots and the mode) ·
[seams-world](buckets/seams-world.md) (the physical interactions) ·
[seats-guns](buckets/seats-guns.md) ·
[soldier-body](buckets/soldier-body.md) ·
[soldier-weapons](buckets/soldier-weapons.md) ·
[sound-radio](buckets/sound-radio.md) ·
[vehicle-physics](buckets/vehicle-physics.md)
