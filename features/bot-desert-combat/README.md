# Bots on Desert Combat

Kind: fix. Package `bots` of the Desert Combat parity round
(`features/desert-combat-parity`), built 2026-10-06 from the census reports'
levels items 28 and 29, ground WP G6 and air item 25.

## 1. Every hull reaches its own AI template

**What was wrong.** `extract_vehicle_ai.py` keyed records by folder
(`Objects/Vehicles/<class>/<name>`), and the page finds a node's record by the
node's template name, a record's key first and then any record's seat
(`bot-units.js aiOf`). Three shapes fell through:

- a variant whose folder ships no `AI/Objects.con` and names another's
  template: DC's `A10_B` and `A10_C` (`aiTemplate A10`, 15 spawns on 8
  levels), vanilla's `Ho-Ha` (`aiTemplate Hanomag`, 5 Pacific levels), DC's
  `Mortar` (under `handweapons/`);
- several hulls in one folder: DC's `AV8` folder (AV-8A/B/C/H/M) and `SA-342`
  (S/G/H/L/M), DC Final's `H-6` (AH-6, OH-6, MH-6, MD-500, MH-500). Every hull
  after the first read the first one's Mobile, Physical and Unit words;
- a variant inside a folder whose template differs from the folder's root:
  the static `Fletcher2` (`FletcherStaticAI`, no Mobile plug-in) read the
  sailing Fletcher's `maxSpeed 15` on vanilla Omaha, Midway and Guadalcanal.

The engine looks the template up by the object's own name and nothing else
(AI-137, read 2026-10-06): an empty `aiTemplate` makes no AI object, an
unknown name is tried as a weapon template and otherwise makes none.

**What retail has no AI for, and stays without.** DC 0.7 comments out the
`aiTemplate` lines of the whole H-6 family and of the UH-60L and UH-60Q, and
its `Mirage` names a template (`Mirage`) that no AI file declares. The census
read the H-6 record's empty seat list as a bug; it is DC 0.7's data. DC
Final restores the H-6 family's lines, so there they are units.

**What changed.** After the folder records, `extract_vehicle_ai.py` gives
each root object (a PlayerControlObject no template adds) that the folder
records miss a record of its own, keyed by its template's name and built
from its own template wherever that is declared (`unanswered_roots`,
`object_record`). A root a record lists as a seat and whose own template is
a seat's (`aiTemplate.secondary`) keeps that record: these are passenger
templates no hull adds any more (DC's `UH-60_Passenger`). The folder records
are byte for byte what they were; the page needed no change, because a
record's key beats a seat listing in `aiOf`.

| tree | records before | after | added |
|---|---|---|---|
| vanilla | 45 | 48 | Ho-Ha, Fletcher2, FletcherStatic |
| XPack1 | 53 | 56 | the same three |
| XPack2 | 69 | 72 | the same three |
| Desert Combat | 98 | 112 | A10_B, A10_C, AV-8B/C/H/M, SA-342G/H/L/M, Mortar, Ho-Ha, Fletcher2, FletcherStatic |
| DC Final | 115 | 134 | the DC fourteen, M6-Linebacker, OH-6, MH-6, MD-500, MH-500 |

The counts are `--mod` runs of the extractor with levels (the published
vanilla table is one record short of either: it predates Caen's `Pak40`).

**How it was checked.** `tests/test_extract_vehicle_ai.py`
`ObjectAiTemplateTests` (a synthetic chain: a variant with no AI folder, two
hulls in a folder, an orphan passenger, a `rem`med line, an unknown name) and
the install tests `test_every_dc_hull_reaches_its_own_ai_template`,
`test_dc_final_gives_each_little_bird_its_own`,
`VanillaObjectAiTests`; `tests/bot_units_ai_of_harness.mjs` (a hull's own
record beats a folder record that lists it as a seat). Runner, DC Desert
Shield, `--seat bot_0=A10_B`: refused before ("no free A10_B"), seated after
and flown for the whole 20 s.

**Publishing.** The lead runs, from `tools/bf1942-models/`:

```sh
python3 extract_vehicle_ai.py --mod bf1942
python3 extract_vehicle_ai.py --mod XPack1 --out viewer/maps/mods/xpack1/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod XPack2 --out viewer/maps/mods/xpack2/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared/vehicle-ai.json
```

then publishes the five `_shared/vehicle-ai.json` files. No scene re-bake.
