# Bot weapons: the rocket that flies, the reload, the burst

Asked 2026-09-24. The owner's three reports, about bots on foot in the map
viewer (`tools/bf1942-models/viewer`):

1. "Projectiles from bazookas don't show when fired from bots. you hear the
   sound but no visual."
2. "Bots with an assault rifle (e.g. STG44, MP18) etc will fire one bullet at
   a time - since it's a machine gun they should fire bursts."
3. "The bazooka sounds glitchy in the game, it sounds like a bot is shooting
   multiple times in second intervals, but in the real game you have to
   reload, so the bots should show the reload animation." The animation is
   the bot-body work's (it reads `bot._mags.get(bot.weaponAi.name)`'s
   `reloadLeft` / `reloadTime`); the reload itself is here.

The engine reads are ledger AI-130 to AI-132 in
`features/bf1942-engine-reference/ledger.md`, from `bf1942_lnxded.static`.

## What was wrong

**No bot on the page ever reloaded.** `referee.magazineTick` made the bot's
magazine entry on its first tick. The page fetches each weapon's fire data
afterwards (map.html `loadBotWeapons`, one glb per weapon), so the size read 0,
the entry was made with `rounds: Infinity`, and it was kept for good. Every
weapon of every bot was bottomless. A Bazooka (`roundOfFire 1.0`, `magSize 1`,
`reloadTime 5.6`) fired once a second for as long as it was held: 25 rounds in
25 s, exactly 1.0 s apart, measured on El Alamein. An Mp40 fired 214 rounds in
25 s without a reload.

**A bot's rocket was a ray.** The referee resolved every bot round at once
(`resolveShot`) against soldier bodies. No round was launched, so nothing was
drawn and nothing exploded. A tank took no damage, because the ray meets
soldiers only and a tank's driver is not drawn: a PanzerIV held at 100 HP
through 25 "rockets".

**The bursts were fired but not heard.** Live, an SMG bot held the trigger
and fired at its rate: an Mp40 at 30 m, 172 rounds in 20 s, unbroken. The
sound dropped them. `world-fire.js` held a pooled slot for a second after
every round, and its `prime` never built a second slot. So a weapon type was
heard once a second however fast it fired, and bots with the same weapon
shared that one slot. Measured: an Sg44 bot fired 86 rounds in 9.8 s, 76 were
dropped, and the listener heard one round every 1.026 s. The fire patches of
the automatic weapons are one-round loop cycles (`mp40mlp` 0.089 s,
`thompmlp` 0.100 s, `Weapon_STG44_fire` 0.091 s), so one cycle per round is
the whole rattle when every round plays.

**The rate itself was quantised.** Each round restarted the cooldown from a
full period, so a round waited for the next whole frame. A 9 rps Mp40 fired
8.57 rounds a second at 60 fps and 7.5 at 30 Hz. *Reversed 2026-10-07:* the
engine fires on whole ticks too (GUN-13: a round sets `timeToFireFinished`,
it is not added to), so 7.5 at the world's 30 Hz is the engine's rate, and
the referee sets the timer again (features/bot-desert-combat, section 9).

**A soldier scored every target as infantry.** The weapon is chosen by its
strength against the target's class, and the class was always Infantry. A
German AT soldier's WalterP38 (3 against infantry) beat his Panzershreck (2),
so he never fired it at a tank.

## What the engine does

- **The trigger (AI-130).** A burst weapon's trigger is
  `BAPATriggerContinously`. It holds the Fire channel down while the plan's
  precision condition holds, and it ends when the round has left (the
  magazine differs from the count recorded before it) or the magazine is
  empty. A single-shot weapon's `BAPATrigger` pulses for one tick. The fire
  plan loops the trigger one round an iteration, for a round budget, while
  the target lives. An empty magazine breaks the loop only for a weapon
  without `autoReload` that carries more than one magazine, so a Bazooka's
  plan waits out its reload aiming.
- **The round budget (AI-131).** A single-shot weapon gets 2 to 5 pulses. A
  burst weapon gets 1 to 10 rounds: `n` is the rounds its kit carries, held
  to 10. Not ported (Open).
- **The weapon choice (AI-132).** `BBFire` divides each weapon's strength
  against the target's class by `(20 misses + 10) / rounds carried + 1`.
- **The reload (AI-133, BODY-7).** A reload starts only once the last
  round's fire cycle has run out: `Fire` sets `timeToFireFinished` to
  1 / roundOfFire, and the reload message starts `Reload` only when it is
  spent. A Bazooka's reload starts a second after its round, so it fires
  once every 6.6 s.

## What was built

| Piece | Where |
|---|---|
| A magazine is made only from the weapon's fire data (`magazineOf`), for every weapon carried. The held one reloads, once its last round's fire cycle is spent. A respawn refills the kit. A mounted bot's `magazineEmpty` is cleared, because a plane's attack plan reads it too | `viewer/bot-referee.js` |
| The rate-of-fire timer is set to `1 / roundOfFire` by each round and runs down a tick at a time, flooring at 0 when idle, as the human's gun does (`gun-cycle.js`, GUN-13) | `viewer/bot-referee.js` `fireTick` |
| `env.launchRound(bot, stats)`: true means the caller flew the round, so the referee does not resolve it. `env.onShot` still fires once per round, rockets included. The runner passes no hook and keeps its rays | `viewer/bot-referee.js` `fireTick` |
| The page flies a rocket launcher's round, collected per bot off a clone of `models/<Weapon>.glb` (the pose glb carries only the drawn weapon). The group is tagged `firer` / `weapon`, fired down the bot's aim ray rolled into its deviation cone, and laid at the bot's drawn weapon node so the rear blast leaves the tube | `viewer/bot-rounds.js` (new); map.html wiring |
| A round's hull and splash damage are billed to the round's firer (`roundFirer`), which is a bot for his flown rockets | `viewer/vehicle-hits.js` `applyVehicleHit` |
| The plan ends on an empty magazine only where the engine adds that break (`bot.magazineEndsPlan`), and only on a magazine this plan ran dry, so a plan made during a reload rides it out | `viewer/bot-plans.js` `firePlanDone` |
| On foot, a target is scored as its own class, a seated man as his hull's | `viewer/bot-perception.js` `chooseFiringTarget` |
| A Fire Loop patch's slot is held for one cycle, not a second. The pool grows to three slots | `viewer/world-fire.js` |
| `window.__botRounds()` under `?shots` | `viewer/test-hooks-bots.js` |

**Kill attribution.** Every path that can kill a bot says which weapon, and
whether it was splash. The kill line prints the weapon, or `[killed]` for
splash:

- A rocket's direct hit on a bot: `applyDamage(id, dmg, bot, from, { via: 'round <gun>', hit, weapon: group.weapon })`.
- A rocket's splash on a bot: `damageLanded(id, lost, bot, at, { via: 'splash <gun> d <m>', splash: true, weapon: group.weapon })`.
- A rocket on the human: `noteLocalAttack(bot, { weapon })` for a direct hit, `{ splash: true }` for splash.
- A hand-weapon ray (the referee): `applyDamage(id, dmg, bot, at, { weapon: bot.weaponAi.name, dist, hit })`.
- A crew killed by a hull the rocket destroyed: `applyDamage(crew, 1e6, bot, null, { via: 'hull <template>' })`. The line falls back to the killer's held weapon. A hull that burns out names nobody, as in the engine.

**PARITY DEPARTURE, measured.** Handed the kit's real round counts, `BBFire`'s
formula sent the page's bots to their knives. They land 5 to 7 % of their
rounds at 40 m (27 hits in 557 rounds in a 30 s squad fight on the old code,
22 in 302 on this one), and the knife is unlimited at strength 1.0, so it
wins after about 22 misses on one target with an SMG and after 2 with a
pistol. In the squad fight seven of the eight bots drew their knives, the two
AT soldiers for 98 % and 93 % of it. The AI entry's `ammo` therefore reads
unlimited while the weapon has a round, and 0 when it is dry, so a dry weapon
is dropped. The magazine itself, the reload and the fire plan's end are real.
The runner, whose data arrives before the first tick, had written a weapon's
real count into its entry once the weapon was held, while the others read
unlimited. Both now read the same.

## How it was verified

Tests: `tests/test_bot_weapons.py` (11 tests, harness
`tests/bot_weapons_harness.mjs`) and three new cases in
`tests/test_world_fire.mjs`. They fail on the old code: an entry is cached
before the data, a Bazooka fires 38 rounds at 1.03 s with no reload, a
Thompson fires 7.5 rps at 30 Hz, a reload starts on its round's own tick,
and a Fire Loop patch drops rounds.

Live, El Alamein, seed-fixed Playwright runs of the page stepped at 60 Hz,
before (the code at 07e83e9e) and after (this branch on main 5c2a38b0):

| | Before | After |
|---|---|---|
| Bazooka bot against a crewed PanzerIV at 30 m | 25 rounds in 25 s at 1.000 s, no round in the air, tank at 100 HP | 6 rockets exactly 6.6 s apart (the round's 1.0 s fire cycle, then the 5.6 s reload), each in flight at 50 m/s with its trail and an `e_ExplBazooka` on the hull; tank 100 → 78 → 56 → 33 → 22 → 11 HP, burning to 2 HP, destroyed by the sixth, its crew's death billed to the bot. His torso holds `Ub_LieFire` for each round's second, then plays `Ub_LieReload` |
| Panzershreck bot against a crewed Sherman at 30 m | not measured | one rocket, 96.7 HP off the hull, the tank gone 3 s later |
| Mp40 bot at 30 m, trigger held | 214 rounds in 25 s at 8.57 rps, no reload | 32-round bursts at 9.03 rps, 4.43 s apart (the 0.11 s fire cycle, then `reloadTime 4.3`) |
| What a bystander hears of an Sg44 bot | 10 of 86 rounds, one every 1.026 s | all 56 rounds, 0 dropped, 0.109 s apart in a burst |
| Squad fight, 4 a side at 40 m, 30 s | 557 rounds, 27 hits, 6 kills; the SMGs never reloaded | 302 rounds, 22 hits, 5 kills; no knives |
| Rocket kills | none | direct hit `Smith [Bazooka] Dieter`; splash `Smith [killed] Dieter`; a crewed PanzerIV destroyed by the rocket, `Smith [Bazooka] Hans` |

The destroyed-hull kill line was read before the reload waited for the fire
cycle. On the final code the same run's first rocket struck the ground just
short of the hull, and the tank, set to 10 HP, burned out first, which names
nobody, as in the engine; the PanzerIV run above shows the billing instead.

The rocket was photographed in flight, with its motor flame and smoke puffs,
from beside it and from behind the shooter, and at the moment of the
explosion on the tank.

Test controls, named so nobody reads them as behaviour: the AT bot held its
ground (its MoveTo, Change and TakeCover urgencies set to 0), a tank's crew
was frozen, the splash victim stood beside the tank with 3 HP, and the tank
for the destroyed-hull kill started at 10 HP.

The headless runner keeps its rays and never had the race, but the ammo
reading, the plan's end, the target's class, the rate timer and the respawn
refill all reach it. The seeded Bocage match (600 s, 8 a side), seeds 1 to 5:

| | main 5c2a38b0 | this branch |
|---|---|---|
| Captures | 21 | 22 |
| Soldier kills | 69 | 66 |
| Vehicles destroyed | 49 | 65 |
| Rounds fired from vehicles | 3692 | 2511 |
| Route failures, per seed | 58, 0, 30, 0, 60 | 13, 0, 62, 97, 0 |

## Open

- **The round budget.** Both fire plans keep the viewer's count: 1 to 10
  pulses for a single-shot weapon, no limit for a burst weapon. The engine
  re-plans from `actionDecisionMaking`'s budgeted queue (AI-129), so a spent
  budget is a pause. The viewer re-plans in the same frame, so the budget
  alone makes no pause, and each re-plan drops the bot's route: with it, the
  runner's seed-1 Bocage match had 123 route failures (the test's bar is 100)
  against 13 without.
- **The rocket's drop.** The engine's `Aimer` lays a round onto its target,
  but the page's infantry aim is the straight line (`execMouseTurretAimAt`).
  A Bazooka round (`gravityModifier 0.2`) falls about 0.5 m short at 30 m,
  1.5 m at 50 m and 5.9 m at 100 m.
- **Grenades** fly since 2026-10-21 (below). Still open there: the
  thrown-weapon branch of `createPlan` (`soldier_choseThrownWeapon`, AI-158),
  so a bot throws only when `BBFire` or `choseWeapon` hands him the grenade;
  the torso's throw is skipped while his drawn body is still loading the
  grenade's pose (`botFired` checks the drawn weapon); and `bot-units.js`'s
  unit table still takes the float max of its weapons' strengths (AI-159).
- **The weapon choice's ammo term** is the departure above. The next step is
  to hold the bots' accuracy against the engine's. Also open: who writes the
  per-slot hits (+0x54, AI-132), and `handleCollision`'s per-object hit
  (+0x30), which is not booked when a bot's round strikes a hull.
- **A crew killed by a destroyed hull** gets no `weapon` in the opts: the
  hull keeps its killer, not his weapon.
- **The human's reload** (`hand-fire.js`) still starts on the frame his
  magazine runs dry. The engine's waits for the fire cycle too (AI-133): a
  second for a Bazooka, 2.7 s for a K98's bolt.
- **A weapon change has no deploy time.**
- **One-shot patches keep a one-second hold**, so a pistol bot at 6 rps is
  heard at most three rounds a second.
- **Before the weapon data arrives**, in about the first second after a bot
  is created, it fires at `BOT_FALLBACK_ROF` with no magazine, and a rocket
  there is a ray.
- **A rocket leaves the eye** (`fireInCameraDof`, as the human's does), not
  the tube.

## Thrown weapons and the officer's binoculars (2026-10-21)

The owner's report from FHSWEurope's Ulsnes: "bots holding grenades throw them
endlessly (they keep doing the throw animation) but nothing leaves their hand
and nothing explodes", and then "the repeat fire issue is not just the
molotov, but every weapon. E.g. they can rapid fire the bolt weapons."

### What was wrong

1. **A bot's hand grenade was a ray.** `bot-rounds.js` flew only rounds that
   were not fuse rounds, so every hand grenade fell to the referee's
   `fireRays`: the torso swung the throw, nothing left the hand, nothing went
   off, and whoever stood on the eye line took the blast's damage at once.
   The `fireDelay` wind-up (FA-13: 1.0 s for the Mills and `GrenadeAllies`,
   0.8 s for `GrenadeAxis` and the Molotov) was skipped too. The Molotov, an
   impact round, was flown, but down the eye line at 20 m/s, so it came down
   about 8 m out: one Ulsnes engineer set himself alight
   (`[splash Molli5 d 7.9]` on himself). Every mod and vanilla is affected;
   it is the bots' code, not FHSWEurope's data.
2. **Officers "fired" their binoculars a second, for the whole round.** FH,
   FHSW and FHSWEurope give the binoculars an AI template, `BinocularAI`,
   with Infantry `0.5` at 75..200 m. The engine parses `setStrength` with
   `istream >> int`, so that is 0 and the binoculars are never chosen against
   a soldier (ledger AI-159). The page rounded it to 1, so against any soldier
   75..200 m off every officer raised his binoculars and played the fire clip
   once a second, unlimited, with nothing leaving his hands: 92 to 108 such
   "rounds" per officer in two minutes of a 16-bot Ulsnes match. In a
   soldier's hands at that range the binoculars look much like a grenade
   being thrown again and again.
3. **The bolt rifles were not fast.** Measured in the page on Ulsnes before
   any change (16 bots, 7,200 stepped frames, every round's referee clock):
   K98 and Krag 1.333 s between rounds in a magazine, the float timer's 40
   ticks for `roundOfFire 0.769` (GUN-13, AI-155); Mp40 0.133 s (8.33 rps on
   whole ticks); PzB35 2.033 s; the Hagle shotgun's two barrels 0.433 s apart
   (`roundOfFire 2.5`, `magSize 2`); the Walther P38 0.1 s (`roundOfFire 10`,
   its own data). The torso's `Ub_Fire` → `Ub_StandBoltOperate` →
   `c_PIFire` → `Ub_Fire` cut is FHSW's own state machine
   (`AnimationStates_module_GER.con`: the bolt state's `addTransitionOne
   c_PIFire 0.5 1 Ub_FireBase_GER`). No hand weapon fired faster than its
   `1 / roundOfFire`, so nothing there was changed.

### What was built

- `bot-referee.js`: a `fireDelay` weapon's press starts the throw
  (`pressThrow`: the torso's clip through `env.onWindUp`, no round, no
  report) and its round leaves when the delay is out (`stepThrow`), counted
  as the bayonet's stab is (`pressAlt`, fire-timer.js): 29 ticks after the
  press for a 1.0 s delay, then the `1 / roundOfFire` cycle. A weapon put
  away or a man killed mid-wind-up throws nothing and spends nothing. The
  round itself is `fireRound`, shared with every other weapon.
- `bot-rounds.js`: every `shell` and `rocket` round is flown
  (`launchesDrawnRound`); a thrown one (`throwsRound`: a `fireDelay` weapon or
  a fuse round) leaves on the arc `Aimer::getFiringDirection` finds for its
  speed and gravity to the point the bot sensed on his target
  (`thrownAim`, through bot-aim.js `firingDirection`, the `indirect` byte
  as the engine passes it), then into the deviation cone. A target out of
  reach is thrown at 45 degrees (INVENTION: the engine's Aimer calls that aim
  invalid and the precision test holds the trigger; the page's infantry
  trigger has no precision test). The round is the human's: it bounces,
  rests, goes off at the end of its `timeToLive` and splashes through
  `vehicle-hits.js` billed to the bot.
- `map.html`: `onShot` skips the torso's fire for a thrown round (it moved at
  the press) and `onWindUp` plays it.
- `bot-fire.js` `aiStrength`: a weapon's strength is the int the engine
  parses (AI-159), in `choseWeapon`, `scoreTargets` and the seat scorers.

### How it was checked

- `tests/test_bot_weapons.py` (harness `bot_weapons_harness.mjs`): a Mills
  bot winds up twice and throws twice, 29 ticks after each press, both
  flown, none a ray, then nothing with the trigger still held; a throw put
  away mid-wind-up throws nothing; `thrownAim` at 20 m/s lands within 0.5 m
  of a target 10, 20 and 25 m off under the page's gravity where the eye
  line lands 2 to 16 m short; the int strengths; the officer's choice
  (Mp40 against a soldier 100 m off, binoculars against a tank).
- In the page on Ulsnes (headless, stepped, `?botDebug`), every bot forced to
  its grenade: each throw was in flight for about 2.4 s and went off, and the
  log carries the blasts (`[bots] bot_2 hit bot_5 for 30: 0/30 (killed)
  [splash MillsGrenade d 7.5]`, eight such lines from four throwers in 20 s);
  before the change the same staging threw rays and logged no blast.
  Throws are 2.0 s apart (the 1.0 s wind-up, then the 1.0 s cycle), where
  they were 1.0 s apart as rays.
- The natural 16-bot Ulsnes match again: no officer fires his binoculars
  (each fights with his Mp40, 0.133 s rounds); K98, Krag, Mp40, PzB35 and the
  Hagle keep the cadences above.

