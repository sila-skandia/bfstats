WP-A is fixed and committed as `b689bf32` on `worktree-agent-ae1becce9668d79aa`. Re-extracting loadouts and re-baking scenes no longer strips bot weapon AI or cover values. The 6-weapon vanilla `loadouts.json` is still what mesh.bfstats.io serves, so vanilla bots are crippled live until you re-extract and publish it (commands below).

**Root cause**
- `298b1cd1` (10-01) added the `/ai/` filter to `load_order` to match how LOAD-5 reads `Game::loadAllConFiles`. That reading covers only the non-AI branch.
- The disassembly confirms LOAD-8. At `0x0805b31e` the function calls `game->getIsAiLevel()` (vtable +0xb0, confirmed with `vt.py`; it returns the byte at `Game+0x64`). If that is set, `0x0805b1b3` skips both `/ai/` tests and the path sorts in with the rest.
- What the filter was protecting: in practice, nothing. The `/ai/` scripts of vanilla, XPack1, XPack2, DC and DC Final contain no ObjectTemplate or GeometryTemplate lines. Building each library both ways gives 0 object, geometry or selector differences; only the three AI tables change. So models and glbs are unaffected.
- The multiplayer (no bots) branch is kept as `ai_level=False`.

**Change**
- `extract_models.load_order(names, ai_level=True)` and `extract_map.LevelFirst(..., ai_level=True)` now follow LOAD-8. The default is on because the viewer's game has bots, which makes every level an AI level (`game.isAiLevel 1` from `AIDefault.con`).
- I added the addresses to ledger rows LOAD-5 and LOAD-8, and a note in `features/level-bake-layers/README.md` about the 10-01 to 10-06 window.
- No live scene tree lost its cover values. Vanilla, XPack1/2, DC and DC Final all still have them, so no re-patch is needed.

**Tests**
- New: `RetailAiWeaponTests` in `tests/test_extract_loadouts.py`, and `tests/test_ai_cover_values.py`. `test_level_mounts` now tests both branches.
- All four new tests fail on the old rule: 7 not ≥ 44, 24 ≠ 6, 26 ≠ 0, 27 ≠ 0.
- Full suite: 4598 tests OK, 10 skipped.
- `patch_scene --layer ai` on a scratch El Alamein keeps 26 cover values (DC's El Alamein keeps 27).
- DC gives 45 AI weapons. The 44 already in the tree come back identical; the new one is JohnsonLMG.
- Vanilla gives 24. Of the 28 items soldiers carry, Binoculars, Detonator, ExpPack and Landmine have no AI template. The 6 entries live today are Kasserine Pass's own level copies, which were the only ones left with `/ai/` dropped, so they applied to every vanilla level. The fix uses vanilla's own values (Bazooka infantry strength 10 → 2, grenade range 35 → 20).

**Headless runner** (El Alamein, 6 a side, `--no-vehicles --seed 2`, 240 s, under `sim.lock`)

| | Shots | Hits | Kills | Bot-seconds in Fire |
|---|---|---|---|---|
| Live tree | 38 | 26 | 5 | 86 |
| Fixed `loadouts.json` | 200 | 24 | 8 | 146 |

Both runs match the adv-modsystem runs exactly.

**Scratch loadouts vs live** (in `~/.cache/dc-sweep/ai-scripts/loadouts/`)

| Tree | AI weapons live → fixed | Other differences |
|---|---|---|
| vanilla | 6 → 24 | none |
| XPack1 | 0 → 28 | live is a 09-18 file: also kit names, 5 Canadian kits, Caen team 2 Canadian |
| XPack2 | 0 → 32 | same, plus Eagles Nest team 1 GermanElite, Telemark team 2 Commandos |
| DC | 44 → 45 (44 identical) | Canadian kits on Caen, Kasserine level kit, empty random-item lists |
| DC Final | 46 identical | Caen team 2 GB → US (the beginrem rule from `aabf919a`), level kits, empty random-item lists |

The non-AI differences all come from earlier exporter changes, not this fix.

**What is live**
- Every live probe used a `?cb=` cache-buster.
- Vanilla's file is the 10-03 one with 6 AI weapons, byte-identical to the local tree.
- XPack1 and XPack2 have 0, DC has 44, DC Final has 46.
- A ranged GET on the bare URL shows `cf-cache-status: DYNAMIC`, so the JSON is not held at the edge and a publish reaches players within the 300 s browser cache.

**Commands for you, after merging, from the main checkout's `tools/bf1942-models`**
```
python3 extract_loadouts.py --mod bf1942            # writes viewer/maps/_shared/loadouts.json, 24 AI weapons
stage=~/.cache/dc-sweep/ai-scripts/stage; rm -rf $stage; mkdir -p $stage/maps/_shared
cp -p viewer/maps/_shared/loadouts.json $stage/maps/_shared/
python3 ../../scripts/publish-mesh-delta.py maps --root $stage --dry-run
python3 ../../scripts/publish-mesh-delta.py maps --root $stage
curl -s "https://mesh.bfstats.io/maps/_shared/loadouts.json?cb=$RANDOM$RANDOM" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["aiWeapons"]))'   # 24
```
- For XPack1, XPack2, DC and DC Final, use the same commands with `--mod <M> --out viewer/maps/mods/<m>/_shared/loadouts.json`.
- **`--out` is required for those four:** the default output path is vanilla's file, so leaving it off overwrites vanilla.
- The DC and DC Final re-extract and full re-bakes are now safe to run.

**Still open**
- Kasserine Pass runs its own weapon AI scripts, but `loadouts.json` has one mod-wide table, so that level's own values are not represented.
- If `weaponTemplate` needs to be the first declaration that wins, nobody has read whether the engine does that (LOAD-1 covers ObjectTemplate and GeometryTemplate only).
- Not this fix, but worth a check before publishing: the Caen, Eagles Nest and Telemark binding changes that come from the beginrem rule.

**Rows for `features/desert-combat-parity/README.md`**: WP-A, MS-1 and MS-2 are fixed in `b689bf32`. Kit-pickups' re-extract and the DC/DC Final re-bakes are unblocked. Vanilla `loadouts.json` is waiting on your publish.

Files touched: `tools/bf1942-models/extract_models.py`, `tools/bf1942-models/extract_map.py`, `tools/bf1942-models/tests/test_extract_loadouts.py`, `tools/bf1942-models/tests/test_level_mounts.py`, `tools/bf1942-models/tests/test_ai_cover_values.py` (new), `features/bf1942-engine-reference/ledger.md`, `features/level-bake-layers/README.md`. Scratch scripts, diffs and runner output are in `~/.cache/dc-sweep/ai-scripts/`.