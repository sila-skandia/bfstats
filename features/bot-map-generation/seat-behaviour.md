# Seated bots: why a side with vehicles stops fighting (2026-11-11)

Section 18.5 of the README measured that, with a level's vehicles in, the
page's bots kill a fifth as often as on foot (DICE's four levels, 8 a side,
median 0.111 enemy kills a bot-minute against 0.596) and that mod levels
mostly have no fight at all. This note separates the causes, one behaviour
at a time, with the trace that shows each; says what was fixed and on what
source; and gives the bars before and after.

Tools (scratch, not in the repo): a probe that runs the runner's own match
and calls a hook on one bot every N ticks (`probe.mjs`), per-seating
summaries of a trace (`seatlook.py`), and page matches read through the
page's `?shots` hooks (`pm2.mjs`, `pm3.mjs`, after `sim/pagematch.mjs`).

## 1. What was measured

Stalingrad, seed 3, 8 a side, 300 s, every tick traced. Of 16 bots, 13 were
seated for most of the match. Seated, they spent their time in Scout (a T34
crew at its base for 296 s, the base's order area asks nothing of a bot
inside it), TakeCover (a PanzerIV's bow gunner 220 s, a Kubelwagen driver
187 s) and Fire with a target and almost no rounds (a PanzerIV and its bow
MG on one soldier 50 m off: 14 and 27 rounds in 170 s, no hit).

## 2. Causes, each with its trace

### 2.1 A round that flew past the target lifted the aim off it (departure, fixed)

The PanzerIV's turret converged on the target and its miss then sat at a
constant 4.70 m with the trigger up. `turretMiss` is measured against the
uncorrected target while the barrel points at the corrected one (ledger
AI-105, the engine's own), so a correction of 4.7 m holds the trigger until
it decays. The correction came from `correctAim`'s "short" branch:

    133.43 obs 1 passed false pre 563.5,40.1,-322.4 tgt 559.1,39.0,-307.3 sum 0,1.6,0
    133.53 obs 2 passed false pre 563.5,40.1,-322.4 ...                   sum 0,3.2,0
    133.63 obs 3 ...                                                      sum 0,4.7,0
    lasthit object 558.6,40.1,-304.0

Each round was judged at the last point the bot's 30 Hz tick had seen it,
15 m short of the target; its hit was 3 m beyond the target (the wall behind
a crouched soldier). A round at 800 to 1000 m/s covers 27 to 33 m a tick, so
inside 60 m it is seen once and gone. The engine's `updateBotProjectiles`
follows the round to where it struck (AI-105). Fix: the watched round's last
step is its impact (`bot-aim.js landRound`). After it, the same tank and gun
on the same soldier: passed rounds, sideways corrections under a metre,
hits on the target at 135 s, 174 s and on. Vehicle rounds in that match 58
to 163.

### 2.2 Every seat ran the Tank rows, and the Fire rule by vanilla's numbers (departure, fixed)

`bot-decision.js registered` gave every seat the vanilla `Tank` row's seven
behaviours. The shipped `Game/AIbehaviours.con` registers behaviours per row:
vanilla's `Fixed` row (every stationary MG, AA gun and hull-top MG) has
MoveTo, Idle, Fire, Scout and Change and no Avoid or TakeCover; `Car` and
`Passenger` no TakeCover; FH's and FHSW's `Tank` no TakeCover; BF1918's
armed hulls no Scout or TakeCover. The bow gunner's 220 s of TakeCover is a
behaviour the engine never evaluates for that seat.

`bot-perception.js fireMode` read the Fire rule off vanilla's row numbers
(0, 4, 11 the infantry rule). A mod writes its own list: BF1918's 9 is
`Gunner` (`BBFireInfantery`: every MG it places, the A7V's side MGs), where
vanilla's 9 is `BoatFixed` (`BBFireLargeBore`). So every BF1918 gunner ran
the large-bore rule, whose `getEnemyObjects` pass hands it unseen enemies:
on Mauerfall the A7V's five gunners and a Hotchkiss held an enemy they had
never seen (memory empty, `visible` false) for 265 to 295 s and fired
nothing. FH and FHSW rows 18, 20 and 21 (`ArmedBoat`, `BoatFixedNonArty`,
`FixedNoChange`, 489 FHSW seats) are `BBFireInfantery` too.

Fix: `viewer/bot-rows.js` transcribes each mod's rows (vanilla, FH, FHSW,
BF1918, EoD, GCMOD; Desert Combat, DC Final and the expansions ship none and
run vanilla's), a seat reads its row by name (`equipment`, stamped by the
extractor) or by number through its mod's list, and both the registered
behaviours and the Fire rule (and the artillery driver's gun seat) come from
it. `tests/test_seat_behaviour.py` checks the table against the shipped
files where the game is installed. After it, Mauerfall's A7V gunners Scout
instead of holding an unseen target. Not changed, and labelled: an aircraft
keeps the Tank rows (the Plane row registers no Avoid in any file, and the
viewer's pilots fly their own avoid), Special stays off every seat
(BF1918's `BBRoam` is not modelled).

### 2.3 The runner plays a different doctrine from the page (the runner's configuration)

The coordinator's page matches put DICE's levels with vehicles at 0.22 to
0.40 enemy kills a bot-minute against the runner's bar median of 0.111. A
page match of Stalingrad read the same way as a runner trace:

| Stalingrad, 8 a side, 600 s | page (published) | runner seed 1 | runner seed 2 |
|---|---|---|---|
| enemy kills a bot-minute | 0.27 | 0.18 | 0.013 |
| seated share of alive time | 0.54 | 0.79 | 0.80 |
| seated time in Fire | 0.29 | 0.05 | 0.03 |
| seated time in Scout | 0.41 | 0.79 | 0.89 |

The runner's seated bots sit in their bases: at 120 to 150 s every crew of
both sides is in Scout with no enemy in a clear line inside 200 m. On the
page, at 120 s the Allies are out of their T34s and both sides are ordered
to the flags. The page's default doctrine is the garrison
(`map.html BOT_DOCTRINE`, `doctrine-garrison.js`: one bot posted on each
held flag, everyone else attacks, a fixed gun only for an enemy in its
traverse); `sim/run.mjs` and `botbatch.mjs` run the engine's SAI unless told
otherwise, which keeps half of each side defending its base. So the bar the
generated layers are judged against is not what a player meets. Measured
with `--doctrine garrison` in section 3: it is the factor of three. Not
changed here: `botbatch.mjs` (which would pass the doctrine) is not this
work's file, and the committed `vehicles-dice.json` stays the SAI's, the
doctrine `botbatch` runs, so the two stay consistent.

### 2.4 Settled as the engine's own, or the data's, and left

- **A gun with nothing to shoot keeps its gunner.** With no enemy spotted a
  fixed gun scores a flat 5.0 (`_fixedAimable`), its seat's `u` is about
  4.25 against the foot's 0.6, and a bail needs the foot to beat
  `1.25 x u`: it never does. That is `BBChange`'s law (AI-44, AI-46, AI-63).
  Under the garrison a bot not on a post leaves a gun once it has no enemy.
- **Passengers stay seated at the objective.** A rider's `u` carries the
  hull's top speed while the hull is driven (AI-46), not its current speed,
  so stopping does not make the foot better. Engine's law.
- **A tank at its base with an order inside it.** The SAI's base defence
  orders it to the area it stands in, whose urgency is 0 inside a held area
  (strategic.md, `WPMoveTo`). Engine's law; the garrison does not do it.
- **Mauerfall's bots on foot chasing a gun they cannot reach.** The
  Maxima at the `Turm` control point is placed 16.5 m up a tower
  (scene.json `maximm`, y 94.39). Its reach test is the engine's 2D one (a
  walkable cell on the line 12 m behind, AI-92), the walk ends on the ground
  behind the tower, and the Use needs the seat within 12.375 m in 3D
  (AI-138), so five Allied bots wait under it all match, the engine's plan
  rebuilt with no give-up (AI-140). The data and the generated walk map
  decide it, not the seat code: a generator change, described in the report.
- **lutte_de_honneur.** The 4,958 to 6,473 rounds a match are trench MGs
  dueling at 100 to 200 m: one round in 174 observed hit, the correction
  random-walking on the MG's spread (the engine's 0.8 gain), the rest on
  the sandbags. On-foot bots there stand in Change for 300 s pressed
  against trench walls the walk map calls open (stall counter climbing, no
  route failure): the walk map's, not the seats'.
- **FHSW Pegasus hulls.** The stuck hulls are drivers in `actionStatusDecision`
  states 8 and 9 (reverse-turn) at a speed near 0, pinned in a street. Not
  diagnosed further.

### 2.5 DC_DesertShield's suicides

A runner match (after the fixes, garrison, 8 a side, seed 1) has 10 deaths
with no killer of 44, every one a crew killed with its own aircraft: an
SU-25, two Mi-24Ds, an A-10, an Mi-8, between 43 and 61 s, the bots
flying them into the ground on their first takeoff (`hull <template>` in the
kill line, `bot-referee.js` unseats and kills the crew of a destroyed hull
with `killedBy` null). That is the page's "is no more" for 8 of 15 deaths.
The flying is `bot-pilot.js` / `bot-vehicle-air.js`, outside this note.

## 3. Bars

DICE's four levels, 10 seeds, 600 s, with vehicles, each bar 80 matches.
"Before" is the commit this work started from (its SAI bar is byte for
byte the committed `vehicles-dice.json`), "after" is 2.1 and 2.2. The
garrison bars are the same matches with `--doctrine garrison`, the page's
default. Medians (p10 / p90 where it matters).

| 8 a side | SAI before | SAI after | garrison before | garrison after |
|---|---|---|---|---|
| enemy kills a bot-minute | 0.111 (0.063 / 0.333) | 0.121 (0.038 / 0.48) | 0.304 (0.174 / 0.649) | 0.315 (0.180 / 0.633) |
| captures | 3 | 2 | 2.5 | 2.5 |
| stuck seconds a bot-minute | 0.151 | 0.152 | 0.314 | 0.343 |
| route failures a bot-minute | 0.026 | 0.006 | 0.193 | 0.115 |
| redeploys a bot-minute | 0.0096 | 0.0095 | 0.027 | 0.033 |
| deaths no enemy caused, worse side | 0.341 | 0.312 | 0.260 | 0.268 |
| hull stuck s a driving minute | 0.492 | 0.220 | 0.721 | 0.602 |
| hull stuck, worse side | 0.732 | 0.434 | 1.40 | 1.03 |
| idle share | 0.422 | 0.509 | 0.205 | 0.248 |
| mounted share | 0.842 | 0.839 | 0.714 | 0.706 |

| 16 a side | SAI before | SAI after | garrison before | garrison after |
|---|---|---|---|---|
| enemy kills a bot-minute | 0.178 (0.121 / 0.518) | 0.158 (0.076 / 0.586) | 0.456 (0.396 / 0.867) | 0.458 (0.379 / 0.739) |
| captures | 2 | 2 | 3 | 2 |
| stuck seconds a bot-minute | 0.339 | 0.324 | 0.400 | 0.625 |
| route failures a bot-minute | 0.044 | 0.035 | 0.213 | 0.195 |
| redeploys a bot-minute | 0.024 | 0.026 | 0.033 | 0.039 |
| deaths no enemy caused, worse side | 0.261 | 0.225 | 0.220 | 0.238 |
| hull stuck s a driving minute | 0.518 | 0.363 | 0.880 | 0.464 |
| hull stuck, worse side | 0.843 | 0.541 | 1.44 | 0.80 |

Enemy kills a bot-minute by level, 8 / 16 a side: SAI before Berlin
0.325 / 0.498, Bocage 0.102 / 0.149, Kharkov 0.128 / 0.135, Stalingrad
0.066 / 0.188; garrison after 0.621 / 0.708, 0.230 / 0.438, 0.305 / 0.454,
0.327 / 0.408. The page (one match each, published code, the coordinator's):
0.40, 0.22, 0.34, 0.31.

Read plainly:

- The two fixes do not move the kill rate beyond the seed spread (0.111 to
  0.121 and 0.178 to 0.158 under the SAI, 0.304 to 0.315 and 0.456 to
  0.458 under the garrison). They take hull-stuck time down by a third to
  a half and route failures down under both doctrines; the idle share rises
  (a gun's crew no longer has TakeCover to run). Stuck seconds at 16 a side
  under the garrison rise, 0.40 to 0.63, inside the p90 of either bar (2.2,
  2.8): not argued away, recorded.
- The doctrine is the factor of three: the runner's SAI keeps half of each
  side in its base, the page's garrison sends it to the flags. With the
  garrison the runner's four levels sit where the page's single matches do.
- On-foot traces of the four levels (seed 1, 8 and 16 a side, 600 s) are
  byte for byte the same before and after.

The mod levels, one 300 s match each, 8 a side, seed 1, SAI, on copies of
the trees with their generated layers (before / after):

| Level | enemy kills a bot-minute | captures | seated share | route failures a bot-minute | hull stuck |
|---|---|---|---|---|---|
| BF1918 mauerfall | 0 / 0 | 0 / 0 | 0.67 / 0.66 | 0.21 / 0.38 | 41.8 / 36.8 |
| BF1918 lutte_de_honneur | 0.013 / 0.013 | 0 / 0 | 0.55 / 0.50 | 2.28 / 2.28 | - |
| BF1918 battle_of_cambrai | 0 / 0 | 0 / 1 | 0.77 / 0.79 | 3.36 / 4.06 | 31.4 / 1.9 |
| FH pegasus | 0 / 0.101 | 1 / 1 | 0.53 / 0.44 | 2.49 / 2.71 | - / 0 |
| FHSW battle_for_ortona-1943 | 0 / 0 | 0 / 0 | 0.91 / 0.91 | 9.85 / 9.95 | 0 / 0 |
| FHSW pegasus | 0.063 / 0.063 | 0 / 0 | 0.54 / 0.42 | 3.23 / 4.07 | 12 / 0 |
| DC inshallah_valley | 0.179 / 0.206 | 3 / 2 | 0.73 / 0.70 | 1.05 / 2.37 | 2.05 / 3.92 |
| DC dc_basrah_nights | 0.115 / 0.025 | 4 / 1 | 0.44 / 0.62 | 0.70 / 0 | 0 / 0 |

One seed a level: the mods have no fight before or after, as the page has
none. What stops them is in 2.4 (the guns the walk map cannot reach, the
trench walls, the street hulls), not the seat code.

## 4. The "is no more" lines on The_Maze (section 18.2's open question)

Settled by a headless page match: a redeploy prints nothing. Every bot
"is no more" on The_Maze was the second line of a team kill (`chat-log.js
deathLines`: "<killer> killed a teammate", then "<victim> is no more"),
reached through `bot-referee.js fireRays` -> `applyDamage` ->
`damageLanded` -> `map.html` `onDeath` -> `comms.onKill`; 7 of 7 lines in
450 s were paired. The -2 is the killer's: The_Maze's score table is
`{kill:1, death:0, tk:-2, attack:2}`, and `round-state.js kill` charges `tk`
to the killer. The bot names repeat (two of several names a match), which
is how a redeployed bot and a team-kill victim were taken for one. The
runner counts these deaths the same way (`match.mjs onDeath`); its counts
can differ only through its hit stand-ins (rounds meet a sphere, `stage.mjs
capsulesOf: () => null`) and its rockets and grenades as rays (no
`launchRound`).

## 5. Not verified

- Nothing here was checked against the real game in the lab; the rows are
  the shipped files, the round's last step follows AI-105's reading.
- The page was run as published (the code before these fixes). The fixes
  were not run on the page.
- One page match a level is a direction, not a bar.
