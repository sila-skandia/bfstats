---
name: bf1942-bot-rollout
description: >
  Give bots to Battlefield 1942 levels that ship without them, and get those
  levels live on play.bfstats.io with the EXPERIMENTAL BOTS tag: list a mod's
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

Everything here was learnt on 2026-11-10 to 12 taking 5 live levels to 29.
The full record is `features/bot-map-generation/`: `README.md` (status at
the top; section 20 has every level's runner figures, section 21 the walk
test), `page-matches.md` (section 6: the page check, the rollout floor,
every level's page figures), and one note a fault: `hold-fire.md`,
`hull-steering.md`, `wide-levels.md`, `no-live-strategy.md`,
`flag-binding.md`, `seat-behaviour.md`. Read the README's status
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
`xpack2`, `fhsw`, `fhsweurope`, `fh`, `desertcombat`, `bf1918`, `eod`.
Set `BOT_WORK` to a scratch folder you keep for the whole job (level
trees are tens of MB each); `BF1942_GAME` and `BF_MODELS` default to the
owner's machine.

```bash
export BOT_WORK=<scratch>/bot-rollout
S=.claude/skills/bf1942-bot-rollout/scripts
```

**1. See what there is.**

```bash
bash $S/fetch.sh fhsweurope            # every level: shipped / generated / botless, size, flags, vehicles
python3 $S/live.py                     # what carries the tag on the live site now
```

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
- at most 0.10 deaths a bot-minute by a bot's own or its side's hand;
- no page error.

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
| a side with no spawn at the start | the side holds no spawn group when the round begins (often a ship or a parachute start): out |
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
- **mesh.bfstats.io answers 403 to a request with no User-Agent.**
- **Scratch is not durable.** Anything a later session needs goes in the
  repo: layers, verdicts, page.json, scripts, notes.

## Where it stood on 2026-11-12

29 levels live (`python3 $S/live.py`). Judged and waiting for a page match
after the flag-binding fix went live: the levels the runner calls
`no-fight` (bf1918 battle_of_cambrai, chemin_des_dames, dawnville,
saint_quentin_canal; desertcombat dc_medina_ridge, dc_operation_bragg;
fhsw berlin-1945-streets, fht_battle_of_kohima-1944,
in_the_hell_of_bocage-1944, monte_cassino-1944,
stalingrad_urban_area-1942, ural_mountains-1947, warsaw_uprising,
way_to_paris-1946) and the last FHSW verdicts (eagles_nest-1946,
fht_dinant-1940, fht_operation_longcloth-1943, fht_pasir_panjang-1942,
gazaps-1945, hungary_forest-1945, iron_monster, manchuria-1945,
ramelle_neuville-1944, westwall-1945). Turned down on the page and worth
another match after any fix that could help them: the_bridge, fhsw
pegasus, mauerfall, roye, bizerte-1943, fht_meuse_argonne_offensive,
sanaga_river, operation_gericht, seelow-heights-1945,
fall_of_berlin-1945. Each has its layer folder and verdict in the repo:
start at step 3.

Not started: Road to Rome, Secret Weapons and EoD. FHSWEurope ships AI
for 260 of its 274 levels; of its 13 botless ones eleven are 8 km naval
levels or have no capturable flag, which leaves adak_race and
escape_from_leyte to look at. Open faults are listed at the end of each
note and in the README's section 20.
