# The combat area — leaving the map

`game.setActiveCombatArea` in a level's `Init.con`, and what the server does
when you are outside it. Read 2026-09-19 and re-derived by a second agent, who
corrected one row outright and closed three things the first pass had left
assumed. Ledger rows CA-1…CA-7. All addresses `bf1942_lnxded.static`.

**This is where level-scope rules live in this corpus.** Fog is in the ledger's
own `FOG-*` section (a level's `Init.con` words with no narrative of their own);
anything else that a level declares and the server enforces belongs here.

**How many levels have one:** all 23 vanilla `scene.json` files carry a
`combatArea` key and **twelve carry it as `null`** — aberdeen, battleaxe,
bocage, coral_sea, el_alamein, gazala, guadalcanal, iwo_jima, kharkov, kursk,
midway, wake. So **11 of 23**, not "all 23". `game.setActiveCombatArea` appears
in 17 vanilla archives, but six of those are `_003` patches re-declaring the
same level. Across all 277 extracted levels, mods included, 250 are non-null.

## 1. Origin and size, not two corners

`Game::setActiveCombatArea(float, float, float, float)` (`0x08061840`) stores
four floats at `Game+0x70`…`+0x7c` and sets `useActiveCombatArea` (`+0x6d`).

The four floats are an **origin and a size**. The evidence is the engine's own
arithmetic, not a level's numbers: `gameStatusPlaying` reads them back through
`getActiveCombatArea` (`0x08061870`) and **adds** the third to the first
(`0x0815237a fld`, `0x08152383 fadd`, `0x08152389 fstp` → maxX) and the fourth
to the second (`0x0815238f`, `0x08152395`, `0x0815239b` → maxZ). A corner pair
would never be summed.

Checked against seven levels' raw `.con` values versus the extracted
`scene.json`: Berlin, Stalingrad, Liberation_of_Caen, Omaha_Beach,
Market_Garden, Truk, Tobruk. **Tobruk is the one that discriminates** —
`1024 0 2048 2048` is x 1024…3072 as origin+size, and an innocent-looking
x 1024…2048 as corners. Berlin's `1536 1536 512 512` on a 2048 m world is the
one that is *impossible* as corners.

When no area is declared the same block falls through at `0x08152575` and uses
the terrain's own `getSizeX`/`getSizeZ` (`PatchTerrain` vtable `+0x0c`/`+0x10`)
— so a level with no combat area still has one: the heightfield.

## 2. Inclusive on all four edges, and altitude is never bounded

Four `fucomp`/`fucom` + `test ah,0x45` pairs, each decoded from the flag
encoding. The branch is taken only on `ah & 0x45 == 0`, i.e. ST(0) strictly
greater:

- `0x081523c1` — `minX > x` → outside
- `0x081523d7` — `minZ > z` → outside
- `0x081523ec` — `x > maxX` → outside
- `0x08152403` — `jne` to the **inside** branch unless `z > maxZ`

So inside is inclusive on every edge, and a `>=`/`<=` test reproduces it.

**Only the position's `+0` (x) and `+8` (z) are ever loaded.** Altitude is never
bounded: a bomber orbiting at 400 m over the middle of the map is safe, and one
that drifts sideways is not.

## 3. Ten seconds, then five hit points a second

- `Game::setTimeAllowedOutSideWorld(unsigned char)` (`0x08061800`) → `Game+0x6c`,
  **default 10**, written by `GameServer::init` at `0x08131dbb`
  (`mov BYTE PTR [ebx+0x6c],0xa`). **No `.con` verb sets it.**
- `GameServer::setDamageForBeingOutSideWorld(float)` (`0x0813dbc0`) →
  `GameServer+0x2e8`, **default 5.0** from the constructor at `0x08131db1`
  (`0x40a00000`). Every `.con` in all 72 vanilla archives was surveyed: vanilla
  never overrides it. Only bfheroes does, at 120–350.
- The accumulator is **per player**, at `player+0x178`: `fadd` at `0x0815241f`,
  compared against `Game+0x6c` at `0x0815242e`–`0x08152437`, zeroed on the
  in-bounds branch at `0x08152553`.
- The threshold is a **strict `>`**: the `jne 0x0815251a` at `0x08152437` takes
  the no-damage path on `<=`.
- Past the allowance, the damage is `dt · [GameServer+0x2e8]`
  (`0x0815247b`–`0x08152480`) through `GameServer::giveDamage` (vtable `+0x15c`,
  `0x0814b2e0`). **A rate, not a lump at the buzzer**: 30 HP at 5 HP/s is six
  more seconds, sixteen in all.
- After each damage frame the accumulator is **clamped back to the allowance**
  (`0x081524a8`/`0x081524ac`/`0x081524b2`), so it reads 10 forever rather than
  growing.

## 4. The object you occupy is what is tested, and what burns

The position tested at `0x081523a1` is `BFPlayer::getVehicle()`'s (vtable
`+0x3c` = `0x080560c0`, returning `BFPlayer+0x4c`), and the damage goes to the
same object. The target branches at `0x0815243f` on `BFPlayer+0x6c`, the
entry-point index (−1 from the constructor at `0x08050b1e`, restored by
`GameServer::exitVehicle` at `0x0814e5c2`); on foot it falls back to
`BFPlayer+0x68`, the default vehicle `setDefaultVehicle` stores (`0x08055879`),
which is the soldier.

**Seated, the hull burns and the pilot is untouched.** A reconstruction that
runs this check only while the player is on foot does nothing at all in the one
case the mechanic exists for — the plane flown out over the sea.

## 5. The second way to be outside: the terrain material

This is the row a second reading overturned (CA-5). The compare at `0x08152540`
is **not a team check**.

The in-bounds branch at `0x08152525` asks the terrain for the material under the
player — `dice::ref2::geom::terrainBase` (`0x087435f0`), vtable **`+0x4c` =
`PatchTerrain::getMaterial(float, float)` (`0x083d6800`)** — and compares it with
`GameServer+0x474`, which is `materialToGiveDamage`: setter
`GameServer::setMaterialToGiveDamage(unsigned char)` (`0x0813dff0`), getter
(`0x0813e020`), **constructor default 7** (`0x0812f287`).

**On a match it jumps to the same accumulate path**; only a mismatch zeroes the
accumulator. So standing on one particular terrain material bleeds a player
exactly as walking out of the box does, wherever he is standing. Nothing models
this, because nothing carries a terrain material channel — it is documented,
not implemented.

## 6. The warning on screen

The warning is `menu/InGame` **top-level entry #42**, gated `0 < Outside/OutsideTime`:
plate `textmessBG_3line_256x64` at (305,171), text at (310,174) in Trebuchet MS8
coloured (0.8516, 0.3516, 0.3516), right-aligned countdown at (536,189) in
Trebuchet MS11-Latin.

The string is the node's own Wstring — **"Warning! You are leaving the combat
area! Desserters will be shot!"**, misspelling included. It is **not** the
lexicon's `DESSERTION_MESSAGE` ("…combat area. Deserters will be shot."), which
that node never reads. Both ship; only one is ever on screen.

The plate's own name settles the layout question: it is a **three-line** plate,
so the 65-character string is meant to wrap.

Two traps a reconstruction hit here, both worth knowing because they generalise:

- **Its cull is a comparison, not a bool.** A HUD painter whose `condOk` answers
  `eq`/`ne`/`lt`/`le` and then `default: return true` **fails open**, so the
  plate and all 65 characters sat across the middle of every HUD on every level
  — including the twelve vanilla levels that have no combat area, where the
  countdown can only ever be zero. The same fail-open was already hiding a
  second bug: `ge` is used by the weapon-select bar's fifth and sixth slots, so
  a four-item kit drew six.
- **Reading the variable is not reading the screen.** The first verification
  watched `Outside/OutsideTime` go to 0 and never re-read the canvas.

## Open

- The terrain-material half (§5) is read and not modelled.
- Whether any `.con` word reaches `setTimeAllowedOutSideWorld` at all — none
  was found, but the search was over shipped data, not over the console
  registrars.
- `GameServer::gameStatusPlaying`'s own entry point is not recorded here; every
  address above is an instruction inside it, reached from the `0x0815237a`
  region.
