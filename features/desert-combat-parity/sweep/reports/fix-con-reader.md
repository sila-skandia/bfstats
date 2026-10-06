The `con-reader` package is done in five commits on `worktree-agent-afeb6e4077bf05be1`, and the branch merges cleanly into current main. Both fixes are confirmed in the binary. The four parts you named now carry meshes, and the AC-130 fuselage is 35.76 m. Nothing in `viewer/` or the shared asset trees was changed.

## What was wrong
- **Spellings (CW1, CW16).** The engine looks a word up case-blind. If that misses and the word starts with `get`/`set`, it tries again without those three letters, and the second answer only counts if the word is a property. A method like `setPosition` answers only to its own name (`getConsoleObject`, lnxded `0x08359b10`, client `0x005ac750`). `con.py` read one spelling per word, so DC's 23 `setGeometry` parts were dropped. The same miss hit DC Final's bare `damping`/`strength` and `setHasMobilePhysics`, and vanilla's 1,923 bare `hasCollisionPhysics`.
- **Scale (CW5).** `GeometryTemplate.scale` was never read. The engine reads a short value as uniform (`1.25` means 1.25/1.25/1.25). It scales a StandardMesh's drawing and the face side of its collision in the mesh's own axes. It does not scale the instance's bounding box or a body's own vertex probes. Those two points rest on one reading of the decompile.

## What changed
- **`bf42/con.py`:**
  - `console_word()` maps the other spelling onto the one con.py reads, before the elif chain. The 160 ObjectTemplate words in its table were each checked against lnxded's registrations.
  - Three pairs are deliberately left out, because the engine treats each pair as two different words: `lodDistance`/`setLodDistance`, `objectTemplate`/`setObjectTemplate`, `type`/`setType`.
  - A word not in the table still reads under the spelling con.py already uses, so words other agents add can't be broken by this.
  - `stream_vec3` reads `GeometryTemplate.scale`.
  - The Camera's `toggleMouseLook` is now parsed.
- **`bf42/assemble.py`:**
  - The scale is baked into the drawn mesh, its LOD rungs and its collision, and stamped as `extras.geometryScale`.
  - A ladder's climb measure stays unscaled, because the climb reads the unscaled bounding box. The blast-radius run caught a first version that moved the Pantsyr's ladder.
  - Every Camera node now carries `cameraView.toggleMouseLook`, plus `cameraView.look` (bound axes, limits, pitch `direction`, acceleration), as you asked.
- **`extract_collision_meshes.py`:** keeps the file's vertices and adds a `"scales"` map.
- **Ledger:** CON-15 (the strip), CON-16 (the stream read), SM-13 (the scale). HP-4's open case-compare question is settled as `strcasecmp`. I also updated `subsystems/console.md` and recorded the two client lookup functions in `symbols.json`.

## Tests and blast radius
- New tests in `tests/test_con.py` and `tests/test_assemble.py`; those suites pass.
- Whole suite: 4,610 tests, 2 failures. One was the feature catalogue, fixed by the `features/README.md` line. The other, `test_nav_baked` Bocage (306 route failures against a limit of 100), runs the JS sim on the owner's live baked maps; I touched no sim, viewer or tree, so I believe it isn't mine.
- I extracted every model of all five trees before and after and diffed the glbs' JSON:

| Tree | glbs | camera fields only | other changes |
|---|---|---|---|
| vanilla | 396 | 147 | 8 |
| XPack1 | 118 | 19 | 0 |
| XPack2 | 225 | 45 | 6 |
| DC 0.7 | 640 | 164 | 81 |
| DC Final | 801 | 220 | 106 |

- **Vanilla's 8** are Fletcher, Fletcher2, Hatsuzuki, Hatsuzuki2 and their Truk skins. Both changes are what the engine does:
  - The depth-charge launcher's projectile gains `hasPointPhysics: false`, from a bare vanilla line.
  - Its drawn projectile is now `DepthChargeLauncherDummy`. That is the same mesh, so it looks identical.
- **The 534 vanilla `hasCollisionPhysics` changes reach no glb**, because the exporter only gates tree meshes on that flag and none of them is one.
- **XPack2's 6:**
  - The Flettner and its wreck, each with a Raid on Agheila skin, lose the three invisible wheels.
  - The Wasserfall flies at 0.3/1/1.
  - The K98 rifle-grenade round is drawn ×2.
- **Side files:**
  - Only DC Final's `effects.glb` changes (its bunker-buster craters, ×0.85).
  - Vanilla `collision-meshes.json` is byte-identical.
  - `deployables.json` and a sample pose are identical.

## For you to run (full commands in the feature README, section 5)
- **Models:** `extract_all.py --level-all --configuration-all --cockpit` for all five trees, with `--own` for the two packs. Then the usual in-place install, `optimise_mesh.py`, and new thumbnails for the models whose drawing moved.
- **Side files:** `extract_collision_meshes.py` for DesertCombat, DC_Final and XPack2; `extract_effects.py` for DC_Final.
- **Level bakes** (`extract_maps_all.py --levels …`):

| Tree | Levels |
|---|---|
| vanilla | guadalcanal, invasion_of_the_philippines, midway, omaha_beach, truk, wake |
| XPack1 | the same six, plus husky |
| XPack2 | raid_on_agheila, plus the same six |
| DC 0.7 | all 35 |
| DC Final | 47 of 48 (all but dc_bridge) |

- Every other level only gains the camera fields. The viewer change below falls back when they're missing, so those can wait for the next full pass.

## Viewer change for `air-input-2` (I didn't edit it)
- In `seatNeedsMouseLookKey`, return `seat.toggleMouseLook` when it is a boolean, and keep the "root seat of an air hull" rule only for older assets. In `lookNeedsKey()`, pass `seat.cameraNode()?.userData?.cameraView?.toggleMouseLook`.
- This adds five DC seats that need the key: the H-6 and SA-342 co-pilots, the SA-342 and MH-6 passengers, and the Stryker passenger. The Stryker is a land vehicle with no mouse-look key bound, so in retail that seat never looks around.
- In `local-look.js`, replace the fixed sign. Take `sign` from `cameraView.look.axes.pitch.direction`; use 0 if the camera has no pitch acceleration, and -1 if the asset has no `look` at all. Then `flip = held ? sign * (invertFor('air') ? -1 : 1) : 1`. With a sign of -1 this is exactly today's line.
- The exported positive pilot cameras match your list. One addition: Battle of Britain's level-local `Ju88A_Camera` is also positive, which the MLK-13 survey didn't reach. XPack2's C47 has no vertical look.

## DC parity rows (for you to apply)
CW1 and CW16 are fixed (CON-15). CW5 is fixed for drawing and collision (SM-13); the vertex side and LOD bounds are open. CW13 is exported; the viewer half belongs to `air-input-2`.

## Still open
- `bf42/level.py` has its own one-spelling readers for control points, spawners and placements. No affected line turned up in the five trees.
- The `weaponTemplate` and `aiTemplatePlugIn` branches have the same twins, but no shipped line uses the other spelling, so I left them out.
- Nothing in the viewer reads `collision-meshes.json`'s new `scales` yet.
- Whether a scaled wheel's ground contact or LOD distance uses the scale is unread. The viewer now measures wheel radius off the scaled mesh.
- DC's `glow_tracer` (scale 300) moved no glb in either DC tree. I didn't chase why.

The before/after JSON and the scripts are in `~/.cache/dc-sweep/con-reader/`, about 700 MB; the disk is at 96%.

Files touched:
- `tools/bf1942-models/bf42/con.py`
- `tools/bf1942-models/bf42/assemble.py`
- `tools/bf1942-models/extract_collision_meshes.py`
- `tools/bf1942-models/tests/test_con.py`
- `tools/bf1942-models/tests/test_assemble.py`
- `features/bf1942-engine-reference/ledger.md`
- `features/bf1942-engine-reference/symbols.json`
- `features/bf1942-engine-reference/subsystems/console.md`
- `features/con-reader-spellings/README.md`
- `features/README.md`