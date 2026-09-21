# Four defects from a session in the map viewer, 2026-09-21

Reported together, fixed together, because three of the four turned out to be
the same class of thing: the viewer reconstructs a level from its archives and
had been reconstructing something the engine never meant.

| # | Reported as | Cause | Where |
|---|---|---|---|
| 1 | "most of the EoD kits don't have any sounds — the NVA sniper, the Colt" | the per-mod weapon-sound tree was never extracted | `extract_weapon_sounds.py`, run per mod |
| 2 | "the engineer has exp packs with a detonator, same slot, right mouse click" | the detonator was never wired to anything | `map.html`, `gunfire.js` |
| 3 | "the exp packs slide perfectly, then tip up on their end and dig into the ground" | `lookAt(velocity)` on a round whose velocity is spent | `gunfire.js` |
| 4 | "on Battle of Britain you spawn inside the factory and can't get out" | two separate reconstruction bugs, below | `bf42/level.py`, `bf42/assemble.py`, `extract_map.py`, `soldier.js`, new `spawn-safety.js` |

---

## 1. A mod's hand weapons had no fire sounds at all

`map.html` fetches `${MODELS_BASE}/sounds/weapons.json`, and `MODELS_BASE` for a
mod is `models/mods/<id>`. The per-mod directory did not exist — `models/sounds`
held vanilla's 28 weapons and nothing else — so every EoD, Secret Weapons and
Road to Rome weapon resolved `null` and fired silently. Nothing was broken in
the code; the extractor had simply never been run with `--mod`.

```
python3 extract_weapon_sounds.py --mod eod    --out viewer/models/mods/eod/sounds
python3 extract_weapon_sounds.py --mod xpack1 --out viewer/models/mods/xpack1/sounds
python3 extract_weapon_sounds.py --mod xpack2 --out viewer/models/mods/xpack2/sounds
```

73 EoD weapons with a report (5 quiet, each named with the reason), 31 for Road
to Rome, 35 for Secret Weapons. Verified in the browser on `?mod=eod&map=a_shau`:
the Type 56 opens its 0.1 s fire loop and the Vietcong pistol plays its 0.897 s
one-shot, where both were silent before.

The five quiet EoD entries are honest data, not failures — three smoke grenades
point `loadSoundScript` at a `GrenadeAllies.ssc` that is not in the archives,
and the binoculars and the rifle clip declare no script at all.

---

## 2. The engineer's plunger

### What the engine does

`BFSoldierTemplate::init` (lnxded `0x0827a8a2`) resolves five templates **by
name** — `ExpPackProjectile`, `ExpPack`, `Detonator`, `MedPack`, `RepairPack` —
and caches them at `+0x2a4`..`+0x2b0`. `BFSoldier::handleMessage`
(`0x08277260`) then compares whatever is in hand against those pointers. Four
rules come out of it, and together they are exactly what the report described:

| Input | Held | What happens | Address |
|---|---|---|---|
| AltFire (msg 7) | ExpPack | `selectItem(11)` — the Detonator's `itemIndex` | `0x82779c0` → `0x82775ed` |
| AltFire | Detonator | posts message 13 to itself, which is MenuSelect4 → `selectItem(4)` | `0x82779a9` |
| Fire (msg 6) | Detonator | `getItemFromIndex(4)`; if that is the ExpPack, `FireArms::detonateProjectiles` | `0x082778f4` |
| MenuSelect4 ("4") | anything | `selectItem(4)`; if what came up is not the ExpPack, `selectItem(11)` | `0x08277a65` |

The last rule is why the plunger is reachable at all once the pouch is empty:
`ExpPack` declares `cantSelectWhenNoAmmo 1`, so with four charges already down
`selectItem(4)` refuses and the fallback hands you the detonator. The engine
even keeps a debug string for the Fire path — `"ExpPack NotFound!"` at
`0x86d2091`.

`FireArms::detonateProjectiles` (`0x08287f80`) walks the array of live
projectiles the weapon holds at `+0x1d8` (count at `+0x1e4`) and calls
`Projectile::detonate()` on each. That is the **same call the end of a fuse
makes**, so a hand-detonated pack does exactly the damage a timed-out one does.
The array is per weapon, so one engineer's plunger cannot set off another's
charges.

### What the viewer does now

`GunFire.detonateProjectiles(group)` and `liveProjectiles(group)` in
`gunfire.js`; the four rules in `map.html`'s demolitions block. Two things the
port has to bridge:

* **The engine's array lives on the weapon, which survives a switch.** This
  page destroys a hand weapon when it leaves the hand. The gun group is
  remembered page-side instead (`thrownPackGroup`), which is survivable only
  because rounds already in the air keep their own reference to the group —
  `disposeHandWeapon` splices the group out of `guns.groups` rather than
  freeing it. Cleared on every spawn: a new life is a new kit and an empty
  array, and charges left over from the last one run their own 240 s fuse.
* **Ammo does not persist across a weapon switch here.** Every
  `loadHandWeapon` starts a fresh magazine, which for every other weapon is
  harmless and for this one is not — swapping to the plunger and back would
  refill the pouch. `packsDown` / `packCapacity` count it page-side, and the
  pack's `rounds` is seeded from what is left.

The detonator also has no `projectileTemplate`, so `collect` builds it no gun
group and the ordinary trigger path never sees it. It gets its own branch:
`beginHandFire` for the clip and the `Detonator.ssc` report, then the
detonation. The Fire message reaches the held weapon as well as the packs in
the engine too, so the plunger clicks whether or not anything went off.

One HUD fix fell out of it: the detonator declares `magSize -1` (unlimited) and
`setHudAmmoType ATIcon`, which prints a round count — so the panel painted the
word "Infinity" beside the demokit icon. An unlimited weapon now gets no count.

---

## 3. A thrown charge lies flat

`gunfire.js` aims every round nose-along-flight with
`mesh.lookAt(position - velocity)`. For a shell in the air that is right. For
the four rounds that survive contact it is wrong the moment they touch
anything, and wrong in a way that is easy to watch: the pack slides flat,
friction takes the along-surface component (`contact-response.js` gives it the
engine's own budgets), and then the only velocity left is the hair of downward
that gravity adds and the contact cancels every tick — so `lookAt` swung the
slab onto its end and stood it in the dirt.

`layOnSurface` replaces it whenever the body has a contact: the contact normal
is the round's up, the flattened heading it was travelling on is the direction
it faces. A pack on a slope tilts with the slope; one against a wall lies
against the wall.

Measured by `tests/fuse_round_rest_harness.mjs` on a flat floor: **79.8 degrees
of tilt before, 0.0 after**, with the basis determinant checked at +1 so a
wrong-handed basis cannot creep in as a mirror. Measured in the real level
(Berlin, four charges put down by an engineer): 0.4 degrees, which is the slope
of the ground under them.

---

## 4. Spawning inside a building

Two independent bugs, both in the reconstruction, both on Battle of Britain.

### 4a. `spawnPointManager.OnlyForAI` was never read

The level declares each of its four radar towers **twice**: an `OnlyForHuman 1`
group of five points spread around the building, and an `OnlyForAI 1` group of
**one** point at the building's own origin. Probed with the viewer's own
collider, that point sits under a ceiling 2.25 m up with walls 3.8–5.2 m out —
it is inside the bunker. The engine never gives it to a player.

`parse_spawn_point_manager` could not have seen the word: it closed a group
block on `groupTeam`, and `OnlyForAI` is the line immediately after it in every
vanilla file. `parse_spawn_point_groups` now reads a block through to the next
`group` line and carries both filters; `pickSpawn` refuses an `onlyForAI` spawn.

The same pass fixed a second thing on the same level. `_vehicle_soldier_spawn_report`
took its group→side map from `Game/GlobalSpawnGroups.con`, which binds the
64..77 range to the fleet's decks — and Battle of Britain reuses those numbers
for its radar towers, declaring all four `groupTeam 2`. Reading the global file
alone put three of the four on the German side of the spawn screen, which is
the wrong end of the English Channel. The level's own layer now wins.

Only two vanilla levels declare the filter at all (Battle of Britain and Coral
Sea) and no mod in the install does, so the re-extract for this is two levels.

### 4b. A standing building wore the collision hull of its own wreck

`_collision_alternative` picks whichever LodObject alternative carries the most
collision triangles, on the reasoning that a drawn mesh with no hull of its own
still owes the world one. For a LOD ladder that is right. For a **wreck** it is
not: `LodSelectorTemplate.hasDestroyedLod 1` marks the last alternative as the
object's destroyed state, and grafting its rubble onto the intact object fills
the standing building with the collapsed one.

Battle of Britain's factory drew its own 210-triangle hull and
`Britain_Factory_Wreck_m1`'s 244 on top of it, both at the same transform,
across the same 44 x 40 m footprint up to y = 119.4. Walk in through the
doorway you can see and you are inside a building that is not there.

`hasDestroyedLod` is now parsed (`con.destroyed_alternative`) and the destroyed
alternative is excluded from the donor pick. It is declared on **34 selectors in
vanilla** — every aircraft, every tank and car, the Defgun, the breakable
window, and this factory — and in all 34 the destroyed alternative is the last
child. The name is kept as a fallback for a mod that skips the word.

The published trees carried the graft on **55 levels**: the factory
(Battle of Britain), `Mi8AWreck` and `SampanWreck` across 50 EoD levels, and
`AW52Wreck` / `GoblinWreck` on four Secret Weapons levels. All re-extracted.

### 4c. And a general check, for everything the data cannot say

`viewer/spawn-safety.js`. `pickSpawn` now walks on from a point a body cannot
stand up in and, failing that, hands back the asked-for one flagged
`blockedReason` — a deploy button that does nothing is worse than a bad spawn.

What it tests is deliberately narrow: **is the body jammed inside solid
geometry, or in a pocket too small to walk out of**. Eight capsule sweeps at
two heights, 8 m of reach, 1.5 m of clearance needed in any one direction.

What it does **not** test is whether a room is sealed. That needs a flood fill
over the collision world, it costs far more than a spawn is worth, and every
cheap approximation of it rejects the legitimate indoor spawns in Stalingrad,
Berlin and Market Garden. The bunker point that started this is kept away from
players by `OnlyForAI`, which is the engine's own answer and needs no geometry
at all. `test_spawn_safety` asserts the sealed room as a **pass**, so the limit
is a decision on the record rather than a gap somebody trips over later.

---

## Tests

| File | What it pins |
|---|---|
| `tests/test_fuse_round_rest.py` | the pack lies flat (0 degrees, against 79.8 pre-fix), stays put, and the plunger sets off exactly this weapon's charges with the end-of-life blast |
| `tests/test_spawn_safety.py` | embedded / boxed / open, the walk-past, the flagged fallback, and the sealed room as an allowed case |
| `tests/test_soldier.py` | `pickSpawn` never offers an `OnlyForAI` point, and walks past one the collider calls solid |
| `tests/test_level.py` | a group block runs to the next `group` line, so the filter is visible at all |
| `tests/test_assemble.py` | the wreck is never the collision donor, a real LOD ladder still is, and the selector word is read |
