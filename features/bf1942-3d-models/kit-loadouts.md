# Kit loadouts: the deploy screen's kit decides the weapon in hand

The map page's deploy screen has had the game's five kit rows since the spawn
screen shipped (`first-person-soldier.md` §10), but a row only highlighted.
The weapon a soldier spawned holding came from `?weapon=`, or failing that
from a two-entry table — Mp40 for team 1, Thompson for team 2 — that stood in
for the kits. This settles it the way the game does: the row you pick is the
kit the level binds to that row, and you spawn with that kit's primary.

## What shipped

```bash
cd tools/bf1942-models
python3 extract_loadouts.py                                   # -> viewer/maps/_shared/loadouts.json
python3 extract_loadouts.py --mod XPack1 --out viewer/maps/mods/xpack1/_shared/loadouts.json
python3 extract_loadouts.py --mod XPack2 --out viewer/maps/mods/xpack2/_shared/loadouts.json
python3 extract_loadouts.py --mod EoD    --out viewer/maps/mods/eod/_shared/loadouts.json
python3 extract_loadouts.py --list                            # the tables, nothing written
```

- `bf42/con.py` learned `itemIndex` (`ObjectTemplate.item_index`).
- `bf42/kit.py` — `PRIMARY_ITEM_INDEX`, `carried_templates`, `primary_weapon`,
  `Kit.primary`; `TeamLoadout`, `parse_level_kits`, `level_loadouts`, with
  `sweep_levels` rebuilt on them (same answers, one reader).
- `extract_loadouts.py` — one small JSON per mod: every bound kit with its
  primary, every level's `setTeamSkin` and `setKit` bindings.
- `viewer/map.html` — loads `_shared/loadouts.json`, resolves row -> kit ->
  primary at spawn, picks the arms rig per soldier, exposes the choice to a
  check (`__deploy.kit`, `__deploy.setKit`, `__deploy.loadout`,
  `__handWeapon().rig`, `__loadouts()`).
- 33 more first-person arms rigs under `viewer/models/viewmodels/`, one per
  soldier and primary the vanilla levels pair.
- `tests/test_kit.py` (+11), `tests/test_extract_loadouts.py` (6).

## Where the game keeps it

Two places, neither of them the level's scene:

1. **The level's `Init.con`** names the soldier and the kit per row:

   ```
   game.setTeamSkin 1 JapaneseSoldier
   game.setKit 1 0 Jap_Scout
   game.setKit 1 1 Jap_Assault
   game.setKit 1 2 Jap_AT
   game.setKit 1 3 Jap_Medic
   game.setKit 1 4 Jap_Engineer
   ```

   The slot number is the row of the spawn screen — the game's
   `Kit/SelectedKit`, which the page already tracks as `KITS.indexOf(deployKit)`.
   Replayed top to bottom, last write wins; `kits.md` has the Liberation of
   Caen story for why that matters.

2. **The kit's `Objects.con`** `addTemplate`s its weapons, and each weapon's
   own file declares the inventory slot it occupies:

   ```
   ObjectTemplate.create HandFireArms Bazooka
   ObjectTemplate.itemIndex 3
   ```

   A census of vanilla's 28 `HandFireArms` fixes the convention: 1 is the
   knife, 2 the pistol, 4 the grenade or explosive pack, 5 binoculars, mine or
   medpack, 6 the repair pack, 11 the detonator — and **3 is every rifle, SMG,
   LMG and launcher, exactly one per kit**. It is the slot the engine selects on
   spawn, which is why a soldier appears holding his Thompson and not his knife.
   Declaration order is the tie-break (`GerKit/Assault/Objects.con`: "The order
   is important, first the best weapons!"), so a mod that files two weapons at
   3 spawns with the first.

The weapon comes back spelled as its own `create` line spells it. The kit
files write `k98Sniper`, `MP40`, `walterp38`; the weapons declare `K98Sniper`,
`Mp40`, `WalterP38`; the exported glb is named from the latter, and a
case-mismatched URL is a 404.

## The table, from the data

`extract_loadouts.py --list`, vanilla. Rows are the spawn screen's order.

| nation (soldier) | scout | assault | anti-tank | medic | engineer |
|---|---|---|---|---|---|
| US (`USSoldier`) | No4Sniper | Bar1918 | Bazooka | Thompson | No4 |
| US Marines (`USMarineSoldier`, Philippines only) | No4Sniper | Bar1918 | Bazooka | Thompson | M1Garand |
| British (`BritishSoldier`) | No4Sniper | Bar1918 | Bazooka | Thompson | No4 |
| Soviet (`RussianSoldier`) | No4Sniper | DP | Bazooka | Mp18 | No4 |
| German (`GermanSoldier`, `GermanDesertSoldier`) | K98Sniper | Sg44 | Panzershreck | Mp40 | K98 |
| Japanese (`JapaneseSoldier`) | K98Sniper | Type99 | Panzershreck | Mp18 | Type5 |

Three things in it that a hand-written table would have got wrong: the
Japanese scout carries a K98 sniper and the Japanese AT a Panzershreck (the
data has no Type 97 or Type 4 launcher); the Soviet and British riflemen
carry the No4 and the Bazooka; and the Marines differ from the Army by one
weapon, the Garand, on one level. Kasserine Pass dresses `GermanDesertSoldier`
in the non-desert `German_*` kits — same primaries, different helmet.

XPack1 binds 48 kits over 29 levels, XPack2 46 over 32, EoD 209 over 239.
Every vanilla and XPack kit has a slot-3 weapon; EoD's ten `*Pilot*_CHUTE`
kits carry a pistol and a knife and nothing else, and are written with
`primary: null` so the page falls back rather than inventing one.

## The file

`viewer/maps/_shared/loadouts.json` (16 KB for vanilla, 143 KB for EoD):

```json
{
  "mod": "bf1942",
  "primaryItemIndex": 3,
  "kits": {
    "Jap_AT": { "nation": "Japanese", "class": "Anti-tank", "team": 1,
                "primary": "Panzershreck",
                "items": ["Panzershreck", "WalterP38", "KnifeAxis", "GrenadeAxis"] }
  },
  "levels": {
    "wake": {
      "1": { "soldier": "JapaneseSoldier",
             "slots": { "0": "Jap_Scout", "1": "Jap_Assault", "2": "Jap_AT",
                        "3": "Jap_Medic", "4": "Jap_Engineer" } },
      "2": { "soldier": "USSoldier", "slots": { "0": "US_Scout", "..." : "..." } }
    }
  }
}
```

Levels are keyed by the lowercased archive stem — the directory
`extract_map.py` writes and the page's `currentDir` — and slots name the kit
as its `create` line spells it, which is the key into `kits`. Only kits some
level binds are listed. A level naming a kit the library does not declare keeps
the raw name in its slot, so the gap is visible in the file rather than dropped.

One shared file per mod rather than a field per level: `scene.json` carried
nothing about teams or kits, so adding it there would have meant re-extracting
every level (minutes each) for 400 bytes of `Init.con`, and the readers that
answer the question already sweep every level archive in seconds for the kit
browser. A mod tree without the file gets the page's fallback.

## The page

`weaponTemplateFor(flag)`:

1. `?weapon=<Template>` — wins outright, as before.
2. `loadouts.levels[currentDir][flag.team].slots[row]` -> `kits[kit].primary`.
   The row is `KITS.indexOf(deployKit)`. If the slot is empty or names an
   unknown kit, the team's kits are searched by class label (`Anti-tank`, the
   engine's own `setType`) before giving up, for a mod that files its rows in
   another order.
3. `FALLBACK_PRIMARIES[teamNation(team)][row]` — the vanilla table above by the
   nation a side's flags say it flies, frozen in the page for a maps tree
   published without the file. Then `ger`/`us` by team number.

The soldier goes with it: `soldierTemplateFor(flag)` is the level's
`setTeamSkin`, or the nation's soldier from the same fallback. The arms rig
(§11 of `first-person-soldier.md`) is `<Soldier>__<Weapon>.fp.glb`, so the
rig registry became a list of the 36 exported stems and `viewmodelRigFor`
matches the exact pairing case-insensitively, borrowing another nation's
sleeves for a weapon that only has those (`?weapon=Thompson` on the Axis side
has always drawn the US rig), and the bare 3P glb otherwise.

`ensureHandWeapon` compares the rig as well as the weapon name: a redeploy
across the team line with the same weapon still changes soldier.

## Verified in the browser

Headless recipe (`?shots`, `__renderOnce` stepping, per level):
`__setOnFoot(false)`, `__setOnFoot(true)`, `__deploy.setTeam(t)`,
`__deploy.setKit(k)`, `__deploy.select(<first flag of t>)`, read
`__deploy.loadout`, `__deploy.spawn()`, step until `__handWeapon()` reports the
expected weapon and rig, step 150 more so the deploy clip ends. Pass means the
weapon in hand is the file's primary, the rig is the level's soldier's, and the
answer came from the file (`fromFile`).

| level | side | soldier | rows proven | rigs |
|---|---|---|---|---|
| Wake | Allied | USSoldier | 5/5 | USSoldier__* |
| Guadalcanal | Axis | JapaneseSoldier | 5/5 | JapaneseSoldier__* |
| Guadalcanal | Allied | USSoldier | 5/5 | USSoldier__* |
| Bocage | Axis | GermanSoldier | 5/5 | GermanSoldier__* |
| Bocage | Allied | USSoldier | 5/5 | USSoldier__* |
| Berlin | Axis | GermanSoldier | 5/5 | GermanSoldier__* |
| Berlin | Allied | RussianSoldier | 5/5 | RussianSoldier__* |
| El Alamein | Axis | GermanDesertSoldier | 5/5 | GermanDesertSoldier__* |
| El Alamein | Allied | BritishSoldier | 5/5 | BritishSoldier__* |

Every row's weapon matched the table above, with the magazine the armoury
block declares (Bazooka 1, No4 5, Bar1918 20, Thompson 30, Mp40 32, DP 47),
and every rig came up with its mixer on `idle`. Two more checks on top:

- `?weapon=Mp40` on Bocage, Allied, anti-tank row: the kit resolves to
  `Us_AT` / Bazooka and the hand holds an Mp40 in the borrowed
  `GermanSoldier__MP40` rig — the override, and the sleeve-borrowing, exactly
  as before.
- El Alamein with its entry deleted from the loaded table: `fromFile` false,
  every row answers from `FALLBACK_PRIMARIES` by `teamNation` (`ger`, `brit`)
  with the same weapons, and a spawn on it loads the Panzershreck in
  `GermanSoldier__Panzershreck` — the nation's soldier rather than the desert
  one, which is what a table without the level can know.

Wake itself has no Axis-held ring in the viewer — every control point opens
US-held and the Japanese come from the fleet, which `spawnFlags` does not list
— so on Wake the Axis tab cannot select a flag and a spawn lands at the US
one, as a US soldier with US kits. The Japanese kits are proven on Guadalcanal.

## Decisions

- **Slot, not class, is the primary key.** `game.setKit <team> <slot> <kit>` is
  the engine's binding and the page's rows are the engine's rows; class is the
  recovery path, not the lookup.
- **The rigs are per soldier.** The sleeves are the nation's camo; a Japanese
  scout in US sleeves would be wrong in the one place the player always looks.
  All 33 pairings the vanilla levels produce exported cleanly with all six clip
  families (about 4 s each; 57 MB total, untracked like the rest of
  `viewer/models`).
- **`extract_kits.py` is untouched.** `Kit.primary` is now on the dataclass it
  reads, so the kit browser can show it when that manifest is next regenerated,
  but nothing there needed to change for this.

## Still open

- Wake's Japanese spawn from the carrier. `spawnFlags` only lists control
  points with soldier spawns; a spawn group attached to a ship is a separate
  piece of work.
- The deploy screen's row labels are the page's five names; the game reads
  them from each kit's `setKitName`. A mod whose slot 2 is not anti-tank will
  spawn the right weapon under the wrong caption.
- Crouch and prone still play the standing aim (§11); the new rigs inherit
  that.
