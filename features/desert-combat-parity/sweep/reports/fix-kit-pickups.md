I've fixed the extractors so Desert Combat 0.7's pad kits get loadout rows, pickup meshes and first-person rigs, and rewritten the lost mortar/pad record. The live DC trees only change once you run the extraction commands at the end.

**Root cause.** Kit extraction bound only `game.setKit` kits (`1d00baa7`). DC 0.7 hands out `US_Sniper_hvy` (M82, 18 levels) and `US_AA` (SA-7, 6 levels) only through level ObjectSpawners. So neither reached `loadouts.json`, `deployables-page.js` made no pads, and the bake's piles stayed inert. Operation Bragg's `ust`/`ist`/`usk`/`isk` are not kits: they are `PlayerControlObject` spawn carriers declared in the level's `objects/talilSpawns/objects.con`, so they are left alone (a test pins this).

**What changed**
- **`bf42/kit.py`**:
  - `level_pads` and `spawner_templates` read what each level's placed ObjectSpawners name, in every layer a bake writes `objectSpawns` for. A malformed layer is skipped instead of crashing.
  - `bind_pads` marks a pad kit live on that level, adds `pads`, and lists every soldier the level fields in `pickupSoldiers`, since the pickup has no team test (KITDROP-6).
- **`extract_loadouts.py`** writes a row for a kit only pads place. A kit some slot binds keeps exactly the row it had.
- **`extract_kits.py`** exports the pickup glbs and adds `pads`/`pickupSoldiers` to `kits.json`, only on kits a pad places.
- **`extract_viewmodel.py`**: a 2-line change so `kit_pairs` also asks for the pickup soldiers' sleeves.
- **`viewer/deployables.js`**: one comment line corrected (not in my file list, but it cited my rows and was wrong; details under the lost record).
- No other viewer change was needed, and `bf42/roster.py` needed none.

**Lost record.** The originals never existed. The agent that wrote the code (session 55c97186, "DC mortar and map kit pickups") hit its weekly limit before writing them. Its transcript has no write to any of the three files, and no branch, worktree, stash, reflog entry or dangling object holds them. I rewrote:
- `features/dc-mortar-and-kit-pads/README.md`, plus its line in `features/README.md`.
- `tests/test_deployables.py`, which wraps the existing harness and a new `tests/kit_pads_harness.mjs` that drives `deployables-page.js` under node.
- Ledger SPAWN-9..16, each checked against `bf1942_lnxded.static` (decompiles, vtables, string addresses).

The binary read corrected one claim: `SpawnerPad`'s `critical(id)` hook is really `Armor::isDestroyed` (vt+0xc8), not critical damage. I fixed that comment in `deployables.js`. The ledger, README, harness and census all called a source comment in DC Final's `Mortar_weap/Objects.con` a "changelog"; I corrected the ledger and README.

**Commits**
- `360b5582` fix(exporter): kits a level's ObjectSpawners lay on pads are bound, rowed and rigged
- `b2604f5f` docs(engine): SPAWN-9..16 and the dc-mortar-and-kit-pads record
- `f4f12c23` docs(engine): SPAWN-9..13 numbered by topic to match spawner-pads; the page check

**Tests**
- Full Python suite: 4617 tests OK (10 skipped). The kit, loadouts, viewmodel, deployables and kit-drops suites pass, including new cases against the installed DC archives.
- Before/after scratch extractions (HEAD's code vs mine):

| Tree | `loadouts.json` | `kits.json` | Kit glbs |
|---|---|---|---|
| Vanilla | byte-identical (also to the live tree) | byte-identical (also to the live tree) | identical |
| XPack1 | byte-identical | byte-identical | identical |
| XPack2 | identical | `pads`/`pickupSoldiers` added on `GermanElite_JetPack` and `GermanElite_Scout`; both were already slot-bound, so page behaviour is unchanged | identical |
| DC Final | identical | pad fields on 3 rows | identical |
| DC | exactly 2 new rows | 2 new rows | 2 new pickup glbs (417/420 tris, all textures resolved) |

- Every DC kit-pad entry in the live `scene.json` files went through the harness: 214 entries on 18 levels became 214 pads (0 with the live loadouts). DC Final: 266 of 266. The brief's "13 levels" is really 18.
- Headless page on Desert Shield, port 5616, scratch files served over the live ones:
  - **New loadouts:** 4 pads made, the 4 baked piles gone, the kits drawn with their pickup mesh. An Iraqi and a US soldier each took the kit and held `M82Sniper` in their own sleeves (`IraqSoldier__M82Sniper`, `USSoldier__M82Sniper`, 10 rounds, 4 magazines). No page errors.
  - **Live loadouts:** 0 pads, piles stay.
- The 6 new DC rigs export with all clips and no missing textures.

**Asset commands for you** (from `tools/bf1942-models`):
```bash
python3 extract_loadouts.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared/loadouts.json
python3 extract_kits.py --mod DesertCombat --maps viewer/maps/mods/desertcombat/maps.json --out viewer/models/mods/desertcombat
python3 extract_viewmodel.py --mod DesertCombat USSoldier SA-7 IraqSoldier SA-7 IraqSoldier KnifeAllies IraqSoldier M9_beretta USSoldier M82Sniper IraqSoldier M82Sniper --out viewer/models/mods/desertcombat/viewmodels
python3 extract_kits.py --mod DC_Final --maps viewer/maps/mods/dc_final/maps.json --out viewer/models/mods/dc_final
scripts/publish-mesh-delta.py --hash
```
Expected results:
- **DC `loadouts.json`:** 52 kits (live file has 45). It also picks up `random`, `levelKits` and the Canadian kits from HEAD that the live file predates.
- **DC `kits.json`:** 19 kits (was 17), plus 6 new files: `US_AA__pickup.kit` and `US_Sniper_hvy__pickup.kit` as `.glb`, `.glb.gz` and `.report.json`.
- **DC viewmodels:** 18 new files (6 rigs × `.fp.glb`, `.gz`, `.report.json`); `index.json` goes from 41 to 47 entries.
- **DC Final:** only `kits.json` changes. Its live viewmodels already hold all 9 pairs.
- **No level re-bake:** the page removes the baked piles itself. Re-running XPack2's `kits.json` is optional.

**Belongs to other packages or still open**
- **spawner-pads ledger rows:** that agent writes SPAWN-9..13 for the same functions. I renumbered mine by topic so the two sets line up row for row; my own rows are 14–16. Their SPAWN-11 says vt+0xc8 is `isCriticalDamaged`; the binary says vt+0xc8 is `isDestroyed` and +0xcc is `isCriticalDamaged`, and my SPAWN-11 has the reading.
- **DC 0.7 mortar (SPAWN-16):** its `projectilePosition 0/0/0` never clears the 2 m soldier clearance, so it places nothing on a level throw. This is derived, not measured; it needs a server-lab check before anyone changes it.
- **Pad kits in other mods:** FH has 217, bf1918 162, bg42 54, EoD 51, FinnWars 40, Interstate 9, GCMOD 6. Their trees change on the next kit re-extract. The pad scan adds about 35 s to EoD's kit extraction.
- **FHSW parse error:** `telemark-1943/ObjectiveMode/ObjectSpawns.con` has 10 `Object.absolutePosition` lines with no argument, which `level.parse_static_objects` raises on. A bake of that level likely fails the same way.
- **Service record:** `extract_pose.py --kit-poses` doesn't pass pads, so the service record has no poses for pad-only kits.
- **Cross-side sleeves:** only pad kits ask for the other side's sleeves. Ordinary dropped kits still borrow the original side's rigs.
- **Team switch:** in the page check, switching teams seemed to destroy the carried pad kit rather than drop it on foot. I didn't investigate.
- I did not add the new addresses to `symbols.json`.

**Rows for `features/desert-combat-parity/README.md`:** weapons item 13 and soldier S12 are fixed in code, live once the commands above are run and published. The lost-record item is done.

The new feature record is `features/dc-mortar-and-kit-pads/README.md`; scratch outputs and scripts are in `~/.cache/dc-sweep/kit-pickups/` (page check: `kit_pad_page.cjs`, screenshots in `shots/`).