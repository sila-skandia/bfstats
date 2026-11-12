---
name: bf1942-bot-rollout
description: >
  Give bots to Battlefield 1942 levels that ship without them, and get those
  levels live on play.bfstats.io, offered with bots in the level list: list a mod's
  botless levels, generate a bot layer for each, judge it in the headless
  runner, publish it, play it on the live page, and tag only what has a
  fight. Use it whenever the owner asks for bots on a mod's or pack's maps in
  any phrasing ("implement bots on FHSW Europe maps", "add bots to the EoD
  levels", "roll the bots out to Road to Rome", "which Desert Combat maps
  still have no bots", "that level's bots just stand there", "take the bots
  off X", "re-check the live bot levels after that fix"), when a generated
  level plays badly and needs diagnosing, or after any change to bot code
  that could move the generated levels already live. Do NOT hand-run
  botgen, botbatch, publish_bot_layers or pagematch for this: use the
  scripts here, which carry the gates.
---

# Bots for levels that ship without them

A generated bot layer is a set of AI files (`AI/*.con`, sometimes
`Pathfinding/*.raw`) kept as source under
`tools/bf1942-models/bot-layers/<mod>/<level>/` with what made it
(`generated.json`), how it was judged (`verdict.json`) and how it played on
the live page (`page.json`). The bake's `ai` layer reads one into a level's
`scene.json` only when the level ships no AI of its own and the gate is
open (a verdict of `pass`, or an `accepted` block). The level then needs
its menu flag to be offered to players.

**What a player sees.** A flagged level is listed like any level with
bots. Until 2026-11-12 its row read EXPERIMENTAL BOTS; the owner played
Galactic Conquest's and said to drop that and "just show bots". The row
now carries a small bfstats.io mark at its right edge, and pointing at it
shows "Bot support added by skandia | bfstats.io"
(`viewer/play/menu-screen.js hasBotCredit`, `BOT_CREDIT`); the briefing
screen carries the same line. In these notes "tag" and "flag" mean the
menu's `generatedBots` flag.

Everything here was learnt on 2026-11-10 to 12 taking 5 live levels to 29.
The full record is `features/bot-map-generation/`: `README.md` (status at
the top; section 20 has every level's runner figures, section 21 the walk
test), `page-matches.md` (section 6: the page check, the rollout floor,
every level's page figures), and one note a fault: `hold-fire.md`,
`hull-steering.md`, `wide-levels.md`, `no-live-strategy.md`,
`flag-binding.md`, `seat-behaviour.md`, `hull-box.md`. README section 22
has the four ways the lint refused walkable levels until generator 6. Read the README's status
paragraphs and `page-matches.md` section 6 before starting.

## The owner's rules

- **Roll them out.** After playing Tunis-1943 the owner said the bots are
  "a huge improvement on what we have. Might as well roll them out." A
  level does not have to beat a bar. It has to have a fight on the page.
- **The page is the judge, the runner is a screen.** The headless runner
  under-reads levels with vehicles (Tunis: 0.038 enemy kills a bot-minute
  in the runner, 0.17 on the page) and counts a no-progress redeploy as a
  death where the page does not. Never hold a level back on runner figures
  alone, and never tag one the page has not played.
- **Scope.** Only levels already exported (the rows of the tree's
  `maps.json`). No new exports or bakes. Big naval levels are out. Levels
  whose play surface is stacked floors, or that need ladders or jumps, get
  no bots: the lint classes them out and that is an accepted outcome.
- **Do not ask.** Decide, do it, report what went live with links and
  what did not and why. Publishing bot layers and menu flags is routine
  asset publishing (no confirmation); scaling, manifests and deleting
  volume content still are not.
- New subagents run on Opus 5.5 at medium effort. No attribution lines in
  commits. Commit only your own paths (`git commit --only`).

## The run, start to finish

Scripts are in `.claude/skills/bf1942-bot-rollout/scripts/`; below, `S` is
that folder. The mod folder names are `bf1942` (retail levels in the
vanilla tree), `community` (the community map pack, same tree), `xpack1`,
`xpack2`, `fhsw`, `fhsweurope`, `fh`, `desertcombat`, `bf1918`, `eod`,
`gcmod`. A mod imported later needs one line in `scripts/env.sh` (`mod_of`)
and its tree in the `TREES` lists of `status.py` and `live.py`; nothing
else is per mod.
Set `BOT_WORK` to a scratch folder you keep for the whole job (level
trees are tens of MB each); `BF1942_GAME` and `BF_MODELS` default to the
owner's machine.

```bash
export BOT_WORK=<scratch>/bot-rollout
S=.claude/skills/bf1942-bot-rollout/scripts
```

**1. See what there is.**

```bash
python3 $S/status.py maps/mods/fhsweurope   # every level with no AI of its own: live, turned down, out, judged, not screened
python3 $S/status.py                        # the same for every published tree (a few minutes)
bash $S/fetch.sh fhsweurope                 # every level: shipped / generated / botless, size, flags, vehicles
python3 $S/live.py                          # what carries the tag on the live site now
```

`status.py` is the work list: `not screened` rows have no verdict in the
repo yet, `judged` rows have one and have not been on the page. A level the
lint refuses still gets its layer folder and verdict from `screen.sh`, so
it shows as `out` with the reason and is never looked at twice. A level
that cannot be worked on for a reason outside the tools (Strasbourg: its
archive is not on the machine) gets a `held.json` with a `because` in its
layer folder and shows as `out` too.

Pick the `botless` rows. Drop the ones out of scope by inspection: world
8192 with few soldier spawns is a naval level; 0 capturable flags is not
Conquest on foot. Many mods ship AI for most levels (FHSWEurope: 260 of
274), so the list is usually short.

**2. Mirror the levels and screen them in the runner.**

```bash
bash $S/fetch.sh fhsweurope adak_race,kursk-1943        # scene, terrain, maps, the vehicles they place
bash $S/community_game.sh                               # once, only for the `community` folder
bash $S/screen.sh fhsweurope adak_race,kursk-1943       # generate + two seeds at 8 and 16 a side
```

`screen.sh` writes the layer folder and prints the outcome. Several levels
side by side: run several `screen.sh` in the background, at most about 10
runner jobs in all (`JOBS`). A wide level's generation takes about two
minutes; a level's matrix 10 to 40.

What to do with the outcome:

| Outcome | Next |
|---|---|
| lint errors | stop: read the errors (below). The level is out unless the error is a tool fault |
| `unsuitable` | out |
| lint error is stacked floors and nothing else | run it anyway with `DESPITE_LINT=1 bash $S/screen.sh ...`; `rollout.sh` accepts it as the owner (Raid on Agheila, and GC's Endor, Corellia, Lok, Alaris Prime, Mini Hoth went this way) |
| lint error is the choke rule and nothing else ("an open route to none of the flags in play") | run it with `DESPITE_LINT=1` too and read `stuckSecondsPerBotMinute` in `$BOT_WORK/runs/<mod>/<level>/verdict.json`: about 1 is DICE's, over 5 the bots are jammed in single file and the level is out (Deulemont 23, Roeselare 16). Under that, `rollout.sh` accepts it as the owner (Transcarpathia-1944, Somme Gasattack) |
| no verdict, and a `run.mjs` still at work after 15 minutes | a match is hung or crawling: see "Traps" |
| `pass`, `better-than-nothing`, `no-better-than-nothing`, `no-fight` | send it to the page (step 3), unless both side sizes show no kill at all AND no capture: that level is dead, diagnose or drop |

**3. Publish without the menu flag, and play it on the page.**

```bash
bash $S/rollout.sh batch1 fhsweurope:adak_race,kursk-1943 fhsw:iron_monster
bash $S/pagebatch.sh fhsweurope Adak_Race:adak_race Kursk-1943:kursk-1943      # the pairs rollout.sh printed
```

`rollout.sh` records the owner's-rollout acceptance, stages the layers,
saves rollback copies of the live files, holds the menu files back, and
publishes. `pagebatch.sh` plays one unseeded ten-minute match of each with
16 bots and prints `PASS` or `FAIL` by the rollout floor
(`sim/pagematch.mjs rolloutFloor`):

- some killing always, and either 0.15 enemy kills a bot-minute, or 3
  captures with 0.03, or 1 capture with 0.05;
- at most 0.10 deaths a bot-minute by a bot's own or its side's hand, or
  no more than a third of the match's enemy kills;
- no page error.

`pagebatch.sh` keeps a level's record: the earlier matches stay in front
of the new one in `page.json`, and the level stands when any counted match
passes. After a bot-code change only the new match may decide: set
`OLD_CODE="<what changed since>"` and every earlier match is kept and
marked `oldCode`, not counted. A match whose page never loads prints
`NO RESULT` and leaves the record as it was: play it again. The matches
are pinned to `spawnTime=wave`, the reinforcement wave every earlier match
was played on; a hand-typed play link gets single player's 3 s respawn.

At most five page matches at once, and run them in the background (ten
minutes each, real time). A level that fails is played **once more**
before it is turned down: one unseeded match is thin (shigaisen_B read
0.06 on the page against 1.8 in the runner; Basrah Nights once showed a
match that never got going).

**4. Tag what passed, withdraw what did not, record it.**

```bash
python3 $S/withdraw.py fhsweurope/kursk-1943 "page matches <date>: 0.03 and 0.04 enemy kills a bot-minute, 2 captures each; under the floor"
bash $S/menus.sh batch1 fhsweurope fhsw          # flags follow the gate; prints the live list
```

Then add each level's row to the tables in `page-matches.md` section 6,
update the README's status paragraph, and commit the layer folders,
verdicts and `page.json` files (`git add` the new folders, then
`git commit --only <paths>`, fetch, merge `origin/main`, push). Tell the
owner what went live with play links
(`https://play.bfstats.io/map.html?map=<PageName>&team=2&mode=Conquest&mod=<page mod>&botCount=16&botSkill=0.75`;
no `mod` for a retail level), what was turned down and why, and which
passes were marginal.

## Reading the lint

`node sim/botlint.mjs --map <level> --maps <tree> --source bot-layers/<mod>/<level>`

| It says | It means |
|---|---|
| a side sealed in / no spawn with a route | no spawn of that side reaches the main ground on foot. Real on island and ship levels. Before 2026-11-11 it was also a tool fault on every level wider than about 700 m (README 21); that is fixed (`joinThroughMap`). If a plainly open level still reads sealed, suspect the tool first |
| a side with no spawn at the start, or "the side starts at sea or in its vehicles" | the side's every spawn is on a ship, a landing craft or a vehicle seat when the round begins: out. Since generator 6 the lint counts what the page offers (a spawn's own team, groups no flag claims, carried spawns whose carrier stands at the start), so this is no longer said of a land base |
| route: N choke points, or "an open route to none of the flags in play" | every route of a side squeezes through single-file cells more often than the choke rule allows. Real on a causeway or a trench (BF1918's levels). Since generator 7 a way the generator opens is five cells wide over walked ground, so this is no longer the generator's own ways. See the outcome table: such a level may be run despite it |
| "the Infantry order position is not a free cell" | was a generator fault: a flag within 5 cm of a cell edge was written, to one decimal, into the blocked cell next door. Fixed 2026-11-13 (README 22.4); regenerate the level |
| no flag a soldier can stand in | every capturable flag is on a roof, a deck or in the air: out |
| stacked floors (classed out) | a tenth of the play surface has a second walked floor over it: out, by the owner's decision |
| warning: the walk test ran out of room | a wide level; its grounds were joined through the walk map. Expected, not a fault |
| warning `strategy` / `target` | a side starts with no strategy scoring, or with nothing to attack. The page's fallback covers it on generated layers; the level may still be quiet |

## When a level plays badly

Find which of these it is before changing anything. Each has a note with
the tools its author used.

| What you see | Likely cause | Where |
|---|---|---|
| bots stand at their base, no kill, no capture | no strategy live and nothing to attack: the copied DICE template (`few` is Kursk's, `symmetric` Kharkov's) does not fit the level's start, or a real flag sits in no area | `no-live-strategy.md`, `flag-binding.md` |
| flags change hands, almost no killing | the sides walk past each other or one side never arrives; check where each side's orders point | README 19.4, `no-live-strategy.md` |
| many deaths with no killer on a wide level | hulls burning on the ground outside the combat area (fixed for the bots' maps; the generator's walk test still treats that ground as reachable) | `wide-levels.md` |
| vehicles stuck for a large share of driving time | spawn pockets, street corners a turn radius cannot make; BF1918's levels still show 25 to 40 s a driving minute, undiagnosed | `hull-steering.md` |
| bots shoot their own side | fixed by the hold-fire; grenades and other explosives are not covered | `hold-fire.md` |
| a bot waits forever for a seat | the unit give-up covers a walk that fails; the garrison's seat-then-leave loop on fixed guns is open | `hold-fire.md`, `seat-behaviour.md` |
| one soldier redeploys again and again | a route its map says is open and is not (Mareth Line's dock edge, a Tunis order point): open | `wide-levels.md` |

## When bot code changes

Every generated level live runs the page's bot code, and so do DICE's.

1. **DICE's levels must not move.** Berlin, Stalingrad, Kharkov and Bocage,
   on foot and with vehicles, 8 and 16 a side, seeds 1 to 3: trace hashes
   identical before and after, or every difference explained. A rule that
   only makes sense for generated layers is gated on `ai.generated` and
   labelled INVENTION in the code and in `features/bf1942-ai-spec/KNOBS.md`.
   Retail levels with ship decks or orphan spawn groups (Midway, Gazala,
   Market Garden) are the ones a strategic-layer change moves: check them.
2. **Ask what retail does first.** Load `bf1942-knowledge`. Twice in this
   work the obvious rule was wrong for retail (with no strategy scoring the
   engine keeps the one it has; the engine's `ControlPoint` count differs
   from the page's, and switching to it cost the liked levels a third of
   their captures).
3. **Try the simple rule on the liked levels before keeping it.** The first
   no-live-strategy fallback halved The_Maze's kills.
4. **The bars** (`sim/baselines/*.json`) are rebuilt only when DICE's
   traces change. They record how far a level is from DICE's; they are not
   the gate.
5. **After it is live** (poll the changed module on play.bfstats.io for a
   new symbol), replay every live generated level once with `pagebatch.sh`
   and compare with its last `page.json`. `python3 $S/live.py` lists them.
   A level that fails twice loses its tag (`withdraw.py`, `menus.sh`).

## Traps that cost time

- **The page's hooks need `&shots`.** `pagematch.mjs` adds it. The local
  viewer falls back to another level for one missing from the local
  `maps.json`: check the `level` a result reports. Mod and community levels
  are played on the live site.
- **A page match can stall** with several playing side by side: tickets
  untouched, no kill. `pagematch` replays any match with no kill and no
  death and marks it `replayed`. Do not read one dead match as a broken
  level; play it again.
- **A share of a small number is noise.** The floor caps a rate of own-hand
  deaths, not the worse side's share of them (Red Square read 1.00 on one
  death).
- **Flags alone are not a fight** (Fall of Berlin: 7 captures, no kill).
- **Re-judging a level** keeps an owner's acceptance unless its outcome
  gets worse (`carryAccepted`). A changed acceptance text changes
  `scene.json`, so the layer is published again.
- **Never edit a script while it runs**, and never `pkill -f "botbatch"`:
  it matches every agent's runs on the machine.
- **A runner match is a few minutes.** One still running after 15 is hung
  or crawling, and the screen will wait on it for ever: find its PID
  (`ps -o pid,etime,command -ax | grep "run.mjs --map"`), kill that PID,
  and profile a short run (`node --prof sim/run.mjs ... --time 20` for a
  minute, then `node --prof-process isolate-*.log`). GC_BCanyon hung on a
  gunship whose box was 9 km long (`hull-box.md`); a level with a hundred
  vehicles crawls at a third of real time in the bots' line-of-sight
  re-tests (README 22.4). A run started before a fix has the old code
  loaded.
- **Stopping a batch means stopping its workers.** Killing the script that
  feeds `xargs -P` leaves `xargs` and its children running: on 2026-11-12 a
  stopped regeneration went on rewriting layer folders for forty minutes
  and seven of them were committed by mistake. After a stop, look
  (`ps -ax | grep -E "screen.sh|botbatch.mjs level|xargs -P"`), kill what
  is yours by PID, and check `git status bot-layers` before committing.
- **Queue page matches in one script** that calls `pagebatch.sh` group
  after group (`( pagebatch.sh a ... & pagebatch.sh b ... & wait )` fills a
  group of five from several mods). Several scripts each waiting on
  another with `pgrep` is how an order gets lost.
- **Somebody else can change the bot code mid-rollout.** A page result is
  of the code live when its match started. When a bot-code commit lands
  (ask in `git log -- tools/bf1942-models/viewer/bot-*.js`), matches from
  before it are the old code: replay them before tagging, and re-match the
  live levels ("When bot code changes", step 5).
- **A re-match of every live level fails some on noise.** On 2026-11-12,
  10 of 45 failed one match though the 45 together had not moved (median
  0.106 enemy kills a bot-minute before, 0.100 after). Play the fails
  again before reading anything into them.
- **mesh.bfstats.io answers 403 to a request with no User-Agent.**
- **Never fetch level trees or publish while page matches play.** A tree
  fetch starves the page of its assets: on 2026-11-12 fifteen matches timed
  out in one queue. Screens are CPU only and can run beside matches, on
  levels that are not in play (`pagebatch.sh` moves a level's `page.json`
  aside while its match plays, so do not commit or regenerate that folder
  until the batch has printed).
- **`status.py` takes over two minutes.** Run it once into a file and read
  the file.
- **A regenerated level is a new level to the page.** Its matches on the
  old layer are marked with `OLD_CODE` and do not count, for it or against
  it; compare old and new only between matches on the same bot code.
- **The repo's `verdict.json` keeps no figures.** The screen's kills and
  captures by side size are in `$BOT_WORK/runs/<mod>/<level>/verdict.json`
  (`sizes[n].checks[].metric` and `.median`), which is scratch.
- **Scratch is not durable.** Anything a later session needs goes in the
  repo: layers, verdicts, page.json, scripts, notes.

## Where it stood on 2026-11-13

68 levels live (`python3 $S/live.py`): FHSW 24, the vanilla tree 16 (15
community, Aberdeen), Desert Combat 7, Galactic Conquest 7, BF1918 6,
Secret Weapons 3, Road to Rome 2, FH 2, FHSWEurope 1. The day's record is
`page-matches.md` section 6 ("2026-11-13"), and `python3 $S/status.py`
gives today's state of every level.

**The owner's priority, said that day: the mods first, the community map
pack later.** The community levels with odd names (the jeep bowls and
races) "don't sound like bot friendly maps, or at least need some custom
mod logic to actually race". Do not spend matches, diagnosis or generator
work on a community level while a mod's level is open, and do not lead a
report with them. The ones live and passing stay as they are.

**Before anything else: more bot code is on its way.** The retail-parity
session is landing one large commit (radio, repairs, seat requests,
contact avoidance, hull TakeCover/Scout/Roam, grenade throws, sighting
decay, and `viewer/bot-rows.js botKind`: a bot flies a hull only when its
AI template is an aircraft's). It will message the hash. When
`git log -- tools/bf1942-models/viewer/bot-*.js` shows it and it is live:

1. Replay GC's Endor, BCanyon, Lok, Alaris Prime and Mini Wasteland first.
   They failed on own-hand deaths that were one vehicle: the Speederbike
   hovers on plane-type engines, the bots flew it as a plane and left the
   level at 109 m/s (16 of 17 suicides on Endor, 52 of 61 on Lok). With
   `botKind` fixed the runner's own-hand deaths on Mini Wasteland fall
   from 0.083 to 0.025 a bot-minute. A pass gets its flag back.
2. Then every live level once, with `OLD_CODE` set ("When bot code
   changes", step 5).

**What to do next, best lead first. Mods only.**

1. **Three mod levels refused for stacked floors and nothing else, not
   yet screened**: FHSW's kakazu_ridge-1945, korsun_pocket and
   siegfried_line-1945. The screen was stopped at the end of 2026-11-13
   and their layers put back; run `fetch.sh` and `DESPITE_LINT=1
   screen.sh` again, and send what is not dead to the page. Of the same
   class, fht_dinant-1940 showed no fight and BF1918's carriere was no
   better than nothing (8 a side failing 6 checks, 16 a side 2): carriere
   is worth a page match.
2. **The levels with a fight that no flag changes hands in.** FHSW's
   tunis-1943 (0.11 to 0.14 enemy kills a bot-minute, 4 and 10 captures on
   the earlier bot code, none on 3b1ebe45c) and the regenerated levels
   that kill and never capture. `no-live-strategy.md` and
   `flag-binding.md` are where to start.
3. **Levels where a side starts at sea or in its vehicles** are the
   largest refused class in the mods (15 in FHSW, 5 in FHSWEurope): they
   need bots that sail a landing craft to a beach, which is page bot code,
   not a layer.
4. **Generator leads left** (README 22.4): River Don needs bots that climb
   ladders; `extract_map.py` takes a placement's `Object.setTeam` over the
   template's; Invasion of the Philippines' East Harbor was not re-linted
   after the cell-edge fix.
5. **A match at a third of real time** on a level with a hundred vehicles
   (forgotten_hometown; README 22.4, item 5): page bot code.
6. **Strasbourg** (community) is held: its archive is not on the machine.

**What the day settled, so it is not tried again.**

- The choke rule is right about BF1918's Deulemont and Liberation of
  Roeselare: run despite it, their bots stand stuck 14 to 23 seconds a
  bot-minute (DICE's levels: about 1). Widening the generator's own ways
  (generator 7, `WAY_WIDEN`) does not help them: the single file is the
  level's trenches. Baghdad has no fight.
- A level run despite the choke rule may be accepted under the owner's
  rollout (`acceptVerdict`), as one with stacked floors may. Read its
  stuck seconds first.
- Westwall-1945 has no fight on generator 6 or 7.
- `pagematch.mjs` records what each own-hand death was in (`suicidesIn`,
  `teamKillsIn`). On a level that fails on own-hand deaths, read those two
  before anything else: one vehicle template at the top is a bot-code
  fault to hand to the parity session, not a layer fault.

The marginal ones live, to look at first if the owner finds a level not
worth having: FHSW stalingrad_redsquare, manchuria-1945, westminster-1942,
operation_coronet-1946 and fht_the_breaking_point-1940 (each passes on
about 0.05 enemy kills a bot-minute and a capture or two); BF1918
lutte_de_honneur, hindenburg_line (a walkover) and
fht_meuse_argonne_offensive; Desert Combat dc_lostvillage and
dc_oil_fields; FH seelow-heights-1945; GC's Ryloth, Tatooine and
Anchorhead (flags change hands, little killing).
