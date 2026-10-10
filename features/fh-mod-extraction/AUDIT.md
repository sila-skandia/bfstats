# FH asset audit: the adversarial pass for simple defects

Status: built and run on the FH tree (2026-10-11). Nothing here is published.

The owner was finding simple defects by hand: a GMC with no engine sound, a
Nebelwerfer in the air, a rifle with no bolt, a red block where a crosshair
should be, a white tank turret. "Missing textures is not simply for me to
manually test." `tools/bf1942-models/audit_mod.py` is the answer: it reads a
published tree, the game archives behind it, and says what is wrong, grouped by
cause, with the number of assets each cause touches.

## Running it

```bash
cd tools/bf1942-models
python3 audit_mod.py --mod fh                      # every static audit, ~3 min
python3 audit_mod.py --mod fh --audit textures sound
python3 audit_mod.py --mod fhsw --audit textures   # read-only, any tree
python3 audit_mod.py --mod bf1942 --json out.json  # vanilla; json = every finding
python3 audit_mod.py --mod fh --verbose            # every finding, one per line

# the rendered smoke: one headless Chromium at a time, a port of your own
python3 serve_viewer.py 5303 &
flock /tmp/claude-1000/chromium.lock node audit_render.mjs --mod fh \
    --url http://localhost:5303 --all --levels
pkill -f "serve_viewer.py 5303"

python3 -m unittest tests.test_audit_mod tests.test_engine_script_candidates
```

Exit status 1 means a finding outside `ACCEPTED` (a list in `audit_mod.py`,
each entry with the reason it is a property of the install and not of the
extraction). Accepted causes are still printed, so a change in their count is
visible. The tool writes nothing; the audits that need the game archives say
so and skip when they are absent.

## What each sub-audit reads

| Audit | Reads | Finds |
|---|---|---|
| `textures` | every `.glb` under `models/mods/<id>` (models, kits, viewmodels, poses), each level's `scene.glb`, `_shared/effects.glb`; the shared `textures/` store; every `.report.json`; with the install, every `.rs` | a drawn material with no texture, attributed to its cause (absent from the install, a shader that declares none, a texture the reader could not resolve); texture files that are missing, empty, 1x1, opaque white, magenta or black (minus the flat ones the game names for the purpose); NaN or constant UVs and dangling material indices; opaque materials whose texture has alpha 0 texels; `.rs` texture lines the reader does not parse; unresolved lists in the reports |
| `placement` | each level's `scene.json` heightmap, `scene.glb` roots and their bounding boxes, `objectSpawns`, `soldierSpawns`, `controlPoints` | statics hanging above the highest ground under them (and not on another object), exact duplicates, objects outside the world or at the origin, spawners floating or buried, ships off the waterline, spawn points in the air |
| `sound` | `vehicle-sounds.json`, each level's `sounds`, the `_shared/sounds` files; with the install, every vehicle template's Engine and FireArms nodes | a layer whose sample is not in the tree; an Engine or gun with a bound script the table lacks. An independent oracle reads every `loadSoundScript` out of every objects `.con` (not through the template walk), and classes the script as absent, silent, samples-absent or ok |
| `models` | `models.json`, reports, `kits.json`, `viewmodels/`, the hud pack and the packs it inherits, `loadouts.json` | vehicles placed by a level with no seat, no collision, or no triangles; kit items with no viewmodel rig; viewmodels without the clips their weapon needs; bolt rifles without a bolt clip; kit, weapon and minimap icons missing from the (inherited) pack; thumbnails missing or shared |
| `data` | `scene.json` spawners, vehicle seats, control points; `loadouts.json`; voices | templates a level places that have no model or library entry (checked against the level's own archive); control points whose spawn group is empty or whose flag was not baked; kits a level names that resolve nowhere; voice files and nations |
| render (`audit_render.mjs`) | the viewer, headless | every vehicle the baked levels place (`--all`: the whole manifest) drawn on the model page, share of the model's pixels that are pure white, magenta or black; a model that draws under 200 pixels; per level, three frames at the first control points |

Coverage on FH: 2,416 glbs, 3,480 texture files, 727 manifest entries (543
vehicle templates in the sound walk), 82 kits, 211 viewmodels, 6 levels with
13,036 placed objects and spawners, 711 models rendered.

## Findings, FH tree, ranked by what each touches

Fixed in this pass (code, test, FH re-extraction; the cause is in shared code,
so the last column says how far it reaches in trees I did not modify):

| # | Cause | FH assets | Fix | Also hits (not modified) |
|---|---|---|---|---|
| 1 | **NaN texture coordinates on drawn triangles**: 4 source meshes carry NaN UVs on vertices a non-degenerate triangle uses (M3A1, Sherman, Panzer IV and Tank gun consoles and mounts, the 1P ship guns, RiBro30's body). A fragment shader samples whatever the GPU makes of a NaN | 88 model glbs (68 templates, incl. cockpits) and all 6 level scenes (84 primitives) | `bf42/gltf.py` `_vec2_accessor` writes NaN as 0 (texel 0,0, the same on every card); test `test_gltf.py`; 82 templates re-extracted into a scratch dir and copied, 6 levels re-baked | FHSW 358 glbs, vanilla 40 glbs |
| 2 | **A texture line with one quote missing**: `texture texture/stugrearwheel";` (StuG III rear wheel) and `texture "texture/pega_treeline01;` read as no texture, so the part draws flat white | StuG3G, StuG3GCamoEdition, StuG3GRandom, StuG3GSkirt; Gold Beach and Prokhorovka scenes (the pega tree-line is not drawn untextured in any of the six levels) | `bf42/rs.py` `texture_refs`: a whole line that starts with `texture` is read with or without either quote; a name with a space stays whole; `combine ... texture diffuse;` is not a stage. Tests in `test_rs.py`. Checked against 29,837 `.rs` across 14 mods: exactly 5 files change (FH 2, GCMOD 1, bf1918 2) | FHSW 18 glbs / 64 materials |
| 3 | **An engine whose first script cannot play silences the whole hull**: the walk stopped at the first Engine that binds a script. FH's Ju 52 binds `Ju52Engine.ssc` on engine 1, which `#include`s `High/EngineHigh.ssc` (not shipped), and `Ju52Engine1.ssc` (works) on engines 2 and 3; the B-25A's left engine binds an absent file | B25-A, Ju52, Ju-52 (3 templates) | `extract_map.py` `engine_script_candidates`; the extraction takes the first candidate that yields a layer. `tests/test_engine_script_candidates.py`; `patch_scene.py --layer sounds --mod FH --all` (vehicle-sounds.json) | see "Blast radius" |
| 4 | **A minimap sprite the pack never extracted**: the pack takes `Minimap/minimap_icon_*` only, and FH's PT boats name `minimap_pt_poat` | PT_Boat636, 637, 638 | `extract_hud_pack.py` also takes every `Minimap/` file a template names; `minimap_pt_poat.png`, `hud.json`, `pack.json` of the FH pack updated (a byte diff against a fresh `extract_hud_mods.py` run was those three files) | FHSW (3 PT boats) |
| 5 | **Two templates, one thumbnail**: `BrenCarrier` and `BrenCarrier-`, `M3A1` and `M3A1-` slug to one file, the second overwrote the first (this is the 727 entries, 725 thumbs) | 2 pairs | `shoot.mjs` resolves slug collisions over the whole manifest (`brencarrier-2.png`); the 2 thumbs re-shot | none seen |

Explained, accepted, and counted on every run (the install itself lacks the
thing; the audit searched all 1,541 `.rfa` files under the game folder):

| Cause | Count | Evidence |
|---|---|---|
| Texture in no archive | 16 refs | `sherW2_f` (23 materials, 19 glbs: Firefly, the LCTs, Priest ...), `ahelm2_r` (US helmets, only FHSW's `_TEXTURE_GENERAL` has it), the Ju 88 `*_MESH` set, `e_Jumplight_o`, `yamato_file8`, `Pipercub_fus_wreck`, `Wreck75mmDP_1` |
| Geometry or mesh in no archive / not declared | 54 | `bodycollision_m1`, shell meshes of 8 rifles, `Lorraine37L_Door_M1` |
| Engine with no bound script anywhere | 26 | carriers, `Remote*` bombers, Waco: no `loadSoundScript` names any of their Engines in any objects `.con` |
| Engine or gun script absent, includes a missing file, or every wav absent | 20 | Benson, Gloucester, Zuikaku (`includes High/ZuikakuEngine.ssc` from a folder holding `ShokakuEngine.ssc`), `coax1s.wav`, `jumplight.wav`, `HarleyHorn` (includes `R75Horn`) |
| Level `Object.create`s a template nobody defines | 2 | Omaha's `beachsound`, Iwo's `1jap_sniperarisaka` |
| Level object whose wav is in no archive, or only under `Ambience/` | 2 | Prokhorovka's `radio_german1.wav` (two radios); Gold Beach's 14 `linnut_metsa` bird emitters load `Sound/@RTD/linnut_metsa.wav`, the file ships as `Sound/<rate>/Ambience/linnut_metsa.wav`. The engine's folder search was not traced, so this one is "silent as far as the data says" |
| Flat textures the game itself names | 6 | `notexture`, `black_o`, `Black_L`, `e_richo_white_I` |
| Authored exact duplicates | 19 | editor leftovers in the level scripts; retail draws both at one pixel |
| Authored constant UVs, NaNs on zero-area triangles | 11, 10 | canopies and gun mounts; nothing is drawn from the NaNs |
| `bullet_m1` / `NULL_Mat0` without a shader | 3 | the round's own placeholder, baked hidden (`bf42/verify.py`) |

## Settled: authored-and-invisible geometry references

`45mmATGun` (0 triangles), `He111`'s `he111_fus2_m1` part and `SU76`'s
`SU76_Turret_M1` are not extractor defects. Each `ObjectTemplate.geometry` names
a template that no `GeometryTemplate.create` of any `.rfa` of the install
declares (a `.con` search of every archive, every mod and level). The engine's
lookup (`GeometryTemplateManager::getTemplate`, lnxded `0x0838b1e0`) is a
case-blind find on the whole name, plus the `Type:File` split; a miss returns
null and the object is built with no geometry (ledger GEO-1, LOD-4). The 45 mm
gun asks for `45mmATGun_carriage_M1` / `_crank` / `_gun_base` / `_gun` /
`_low` where `Geometries.con` declares `45mm_cart_M1`, `45mmATGun_crank1_m1`,
`45mm_cannon38_gun_m1`, `45mmATGunmm_low_m1`; the He111's fuselage mesh is
declared as `he111_NoseArea_M1` and drawn once through that object. They are
`report-geometry-undeclared` / `*-model-draws-nothing-geometry-undeclared` in
`audit_mod.py`'s `ACCEPTED`. Retail draws nothing for the 45 mm gun in any
level; no baked FH level places it.

## Open

Each has evidence; none is fixed here.

| Item | Evidence | Next step |
|---|---|---|
| **Opaque materials with cut-out textures in the layers the alpha-floor fix (`3f83aa8`) has not reached**: 14 textures in `effects.glb` (`PT_Guns`, `stugwheels_wreck`), 12 soldier `.pose.glb`, 2 kits (`itBersahelmet`, `itPitHelmet`) | `audit_mod.py --audit textures`, cause `opaque-material-cutout-texture`; this pass's re-extraction covers the 82 models it rebuilt. The audit counted 156 such textures before this pass's re-extraction of 82 models and 14 after | re-run `extract_kits.py`, `extract_pose.py --kit-poses`, `extract_effects.py` for FH (the standing rule: every layer the exporter touches) |
| 8 level objects float or sit outside the world (authored) | Iwo `stecrate2_M1` at y 253.5 in `StaticObjects.con`; Road to Ramelle's 5 `FH_coalCorridor*` pieces 4-12 m up; Gold Beach `EU_asp1_M1` 13 m; Prokhorovka 4 trees at x 2282..2308 and a plough at x -249, and the `dest_stonebridge_big_m1` spawner 19.7 m up | retail data; look only if a tester reports them |
| Level frames in the render smoke do not move past the briefing card | `audit_render.mjs --levels` loads each level (terrain, sky, no magenta) but the briefing overlay covers the frame; a level's vantage frames are a load check, not a content check | find the briefing's dismiss hook in `map.html` |

## Blast radius outside FH (read-only; nothing there was changed)

| Cause | FHSW | Vanilla |
|---|---|---|
| 1 NaN UVs | 358 glbs | 40 glbs |
| 2 missing quote | 18 glbs, 64 materials (StuG3G family, scene) | 0 |
| 3 engine candidates | see below | see below |
| 4 `minimap_pt_poat` | 3 vehicles | 0 |
| alpha-floor reach (`opaque-material-cutout-texture`) | 0 | 55 textures |
| a kit glb primitive whose material index is past the end of the list | 0 | 7 kit glbs (`GB_Medic`, `German_Engineer`, `Jap_Engineer`, `Rus_Medic` ...) |
| bolt rifle with no `bolt` viewmodel clip | 124 viewmodels | 35 viewmodels (`BritishSoldier__No4`, `__k98` ...) |

Cause 3, measured by building the table in memory with today's extractor and
comparing it with each tree's published `vehicle-sounds.json` (nothing
written): FHSW gains 18 engines (`bedford`, `gmc`, `m4a1(76mm)bagrandom` ...,
the `setRandomGeometries` families of b01483de and this pass's Ju 52/B-25A
class) and 32 guns; FH 0 and vanilla 0 once this pass's FH table is
written. FHSW's table is therefore stale: `patch_scene.py --layer sounds --mod
FHSW --all` (another session was patching it while this ran). The audit's own
residuals on FHSW (40 engines, 678 guns "script ok, not in table") are leads,
not findings: the oracle was calibrated to zero on FH and not on FHSW.

## Method notes

* A glb does not say which `.rs` its material came from, and shader names are
  not unique (`wreck_cub_Material0` is in two files, 'Material #2' in hundreds).
  The audit asks the model's own report first, then the shader table, and
  files an unattributable name under its own cause instead of guessing.
* "Retail does it too" is a claim about the install, so every accepted cause is
  backed by a search of every `.rfa` under the game folder, not by the report.
* The rendered smoke is the check that found `45mmATGun` (0 pixels): its report
  lists the missing geometry templates but the model was never placed, so no
  other audit looked at it.
* Hard links: files under `viewer/models/mods/fh` are linked to
  `~/.cache/fh-publish`; copy into them in place (as done here) and both
  change. Pre-bake level trees are in `~/.cache/fh-audit-prebake`.
