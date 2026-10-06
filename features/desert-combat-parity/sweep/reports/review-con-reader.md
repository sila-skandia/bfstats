**Verdict: LAND WITH FIXES.** I added five commits to this branch. One condition sits outside it: **air-input-2's `seatLookSigns` must be corrected before its branch lands or the con-reader re-bake goes out.** Otherwise six vanilla pilot cameras (BF109, Mustang, B17, both Aichi Vals, Battle of Britain's `Ju88A_Camera`) and DC's AC-130 will look the wrong way when the mouse-look key is held.

**My commits:** `12ee018c`, `9413b178`, `7d2c606b`, `403b4976`, `94a988ce`.

**The merge with current main (`dbbf7f11`) is clean, and the full suite passes on it:** 4,736 tests, 10 skipped. `test_nav_baked` Bocage passes on the merge when run on its own (172 s); the 306 failures the fix agent saw came from its branch base.

## What checks out
- **CON-15 holds in both binaries.**
  - lnxded `0x08359b10`: the `get` retry keeps entry type 1 or 3 (`cmp eax,0x3` at `0x08359c12`), the `set` retry keeps 1 or 2 (`0x08359ce3`). The literals at `0x086c543c`/`0x086be2d9` are "get"/"set".
  - Client `0x005ac750`: the same strip through `_strnicmp`, with type tests against 1/3 and 1/2.
- **The 160-word table holds, checked independently in the client binary (not the agent's lnxded harvest).**
  - Every bare word is a type-1 ObjectTemplate (or GeometryTemplate) property.
  - Only three set-spellings exist as strings at all: `setStrength` (a weaponTemplate method), `setTeam` (Game and Object methods) and `setTexture` (skidMark, Sky, Cloud, WPart). None is an ObjectTemplate word.
  - The three excluded pairs are right to stay out.
- **SM-13 holds.** The template's `loadHeader` reads the bounding box straight off the file. The instance constructor seeds the old scale equal to the new one, so `setScale` leaves the box and radius at the file's size. The terrain probe in `checkVsTerrain` `0x0825a960` transforms the vertices by the object's rigid matrix only, so the vertex probes are unscaled.
- **Blast radius re-derived exactly** from the scratch JSON: vanilla 241/147/8, XPack1 99/19/0, XPack2 174/45/6, DC 395/164/81, DC Final 475/220/106. The vanilla level list (six levels with the destroyers) matches the live bakes. Each vanilla and XPack2 change is engine-correct:
  - The Fletcher and Hatsuzuki depth-charge changes come from bare con lines the engine takes.
  - The Wasserfall at 0.3/1/1 makes its fin cross symmetric.
  - The K98 grenade is drawn at ×2.
- **Data questions:**
  - **Sandbag base ×0.001:** it should vanish. DC hides an M15 mine mesh under the visible `Bag` child that way.
  - **`glow_tracer` ×300 moved nothing because no weapon uses it:** its only user, `Minigun_Tracer_Projectile`, is never referenced in DC or DC Final.
  - **The camera exports match the con data.**
- **Other mods:** FH, FHSW, EoD, GCMOD, bf1918, Pirates and Interstate parse with identical template counts and no crash.
- **Page check:** one run under the browser lock on port 5642. The re-extracted AC-130 loads with no console errors, at a 35.76 m fuselage, and carries the camera fields. Server and browser are stopped.

## Findings

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| A pilot camera's look direction is `sign(acceleration) × sign(maxSpeed)`, not the acceleration sign alone. BF109 (`5000` with `-90`) looks the same way as Spitfire (`-5000` with `90`). Read that way, every key camera in vanilla, XPack1, XPack2 and DC 0.7 is negative. Only DC Final's AH64, H6Pilot, MH53Pilot, Mi8, SA342Pilot, UH-60 and UH-60Q cameras are positive | `calculateAndClipAngle` multiplies by the raw template `maxSpeed` (`0x081d7866`, no `fabs`); `ObjectTemplate.maxSpeed` (ConsoleClass194 `0x081ce090`) stores it raw | **High** (inverts vanilla once used) | The README's hand-off formula, table and test are fixed (`12ee018c`). **Not fixed:** air-input-2's `mouse-look-key.js` `seatLookSigns` on branch `worktree-agent-a378e38d6be9db02d` uses `direction` alone and must multiply by `Math.sign(maxSpeed)`. MLK-13 on main and the comment in main's `local-look.js` make the same mistake |
| A gun's drawn round and tracer are drawn scaled but did not carry `geometryScale`, so a consumer could not get back the file's size | OSA/AC-130/Mk19 `projectile_40mm` ×0.6, K98 grenade ×2 | Low | Yes (`9413b178`, plus a test). No new glbs enter the blast radius |
| `effects.py` looked up a particle's `hascollisionphysics` key, which the new spelling map files under `sethascollisionphysics`, so it could never match | key audit across effects.py and assemble.py | Low (no shipped particle writes it in the five trees) | Yes (`7d2c606b`, plus a test) |
| SM-13 said no installed mod scales a TreeMesh or AnimatedMesh. Several do | raw census: FH 88, FHSW 75 + 8, bf1918 70, EoD 2, FinnWars 7 | Docs | Yes (`403b4976`). The exporter still draws those at file size, as before |
| Viewer measurements taken off the drawn mesh now read the scaled size, where the engine reads the file's | `aircraft.js` wheel contact (AC-130 main gear 0.107 m lower, nose 0.085 m higher), `measureWheelRadius` (M-109, M2A3), chase radius (AC-130, Pickup, Wasserfall), `meshRadius` drag (inert today: those rounds have no mass or drag), repair reach | Low–Medium, DC only except the Wasserfall | Listed in the README's section 8; viewer files not touched |
| The Flettner loses its three invisible outrigger springs and their collision. The engine only hides them | existing `createInvisible` drop rule in the assembler | Low (the real gear still sits 0.25 m lower) | Listed in section 8 |
| The scratch `after` dumps predate the ladder fix for the Pantsyr | a targeted re-extract gives 2.7035 m, the file's length | Info | Noted in the README |

## Gaps for other packages
- **air-input-2:** correct the sign rule in `seatLookSigns` as above, and fix the MLK-13 and `local-look.js` claim that these cameras are inverted in retail.
- **Exporter:** keep the collision of invisible physics parts (Flettner, Elco, KettenKrad).
- **Viewer:** divide `geometryScale` back out of physics measurements taken off drawn meshes, and read `collision-meshes.json`'s `scales` for the face side.

Everything is in `<repo>/.claude/worktrees/agent-afeb6e4077bf05be1`. My scratch is in `~/.cache/dc-sweep/review-con-reader/` (6.5 MB); I removed the merge worktree and the scratch glbs.