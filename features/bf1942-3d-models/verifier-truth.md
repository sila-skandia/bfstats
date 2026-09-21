# Making `verify_models.py` tell the truth

Stream W6-H, 2026-09-22. The verifier's job is to answer "did this extraction
come out right?" without anyone looking at a render. On the 2026-09-19 vanilla
rebuild it called 42 of 96 models broken and every one was a false alarm, which
is the same as having no verifier — and worse, because it hides the day it is
right. Streams before this one repaired most of that. This one finishes the
severity question, gives the verifier three checks it was missing, and then
does the thing none of them had done: hands it models that really are broken and
makes sure it says so.

Everything below is reproducible. `$M` is the shared extraction tree
(`tools/bf1942-models/viewer/models` in the main checkout).

```
cd tools/bf1942-models
python3 verify_models.py --models $M              --mod bf1942
python3 verify_models.py --models $M/mods/xpack1  --mod XPack1
python3 verify_models.py --models $M/mods/xpack2  --mod XPack2
python3 verify_models.py --models $M/mods/eod     --mod EoD
```

## The baseline

Measured on the shared tree at `4573424` (which already carries S3's
origin-pile repair, `e089c4f`, and the 2026-09-20 repair, `60f2e88`):

| catalogue | clean | degraded | broken | exit |
|---|---|---|---|---|
| vanilla (96) | 94 | 2 | 0 | 0 |
| XPack1 (15) | 13 | 2 | 0 | 0 |
| XPack2 (29) | 25 | 4 | 0 | 0 |
| EoD (285) | 221 | 56 | **8** | **1** |

The pre-repair verifier cannot be re-run in place to reproduce the historical
42-of-96 directly: `git archive 49b5433 tools/bf1942-models` imports
`extract_hud_assets`, a sibling module that has since been renamed, so the old
tree no longer starts. The recorded figures stand in the module docstrings and
in this round's tracker; what is measured here is the state this stream
inherited.

### The eight EoD broken verdicts, and why all eight were false alarms

| model | complaint |
|---|---|
| `M79`, `M79Flare`, `M79smoke`, `Vietcong_Grenadelauncher` | geometry templates unresolved: `M79` / `M79Smoke` / `Vietcong_Grenadelauncher`, `remingtonMag`, `remingtonTrigger` |
| `Cammo_Raft` | `CammoRaft_Motor_M1` |
| `EoD_Raft` | `EoD_Raft_Motor_M1` |
| `M125Mortar` | `M125_TurretMG` |
| `EoD_LCT-Mk6_ChopperCarrier` | `EoD_LCT-Mk6CC-Ramp` |

Each of those names is referenced by a *drawn* part of the model — the M79's
Complex body, its trigger and magazine, a raft's outboard motor, the M113's
turret MG, the landing craft's stern ramp — so the role classifier already in
place called them parts and the verdict was broken.

They are not our bug. **No `.con` anywhere in EoD's chain creates any of those
geometry templates.** Checked two ways:

- `library.geometry(name)` is `None` for all eight after `build_library` has
  parsed all 4,295 `.con` entries of the chain (0 unreadable);
- a raw-text scan for `GeometryTemplate.create` finds 3,345 names against the
  library's 3,335, and all ten of the difference are inside `beginrem` blocks
  (six commented-out Bofors templates in `Objects/Vehicles/Sea/Type38/`, and
  four more) — so the parser is *right* and the raw scan is the naive one.

`objects/HandWeapons/M79/Geometries.con` defines `M79_Stock`, `M79_Barrel` and
`Shad_M79` and nothing named `M79`; `objects/HandWeapons/Remington/Geometries.con`
defines `Remington` and `Shad_Remington` and nothing named `remingtonMag`. EoD's
`archives/` holds one `objects.rfa` with no patch beside it, so there is nowhere
else for them to be. The engine builds its geometry-template registry from the
same scripts we parse, so it draws nothing there either: the M79 in the game is
its stock plus its barrel, 1,522 triangles, which is exactly what we export.

Across all four catalogues, **every** unresolved asset is genuinely absent:
20 missing-template rows all `library=absent`, 31 missing-mesh rows
(`bodycollision_m1`, 19+ soldiers) all unresolvable by basename too. There is
not one case in 425 models where the archives hold an asset the assembler
failed to find. The "broken" severity on unresolved assets had therefore never
once fired truthfully.

## The fixes, by class

### 1. An unresolved asset is only our bug when the chain can resolve it

`verify_models.py:unresolvable_assets` (new) asks the library and the mesh pool,
per asset, whether the chain defines it at all, and `bf42/verify.py`'s
`classify_missing` takes the answer as `missing_asset_absent`:

- absent from the chain → **degraded**, "defined nowhere in the mod chain, so
  the engine draws nothing there either and the extraction matches the game";
- present in the chain → **broken**, "the assembler lost something that is
  there";
- no archives read at all (`--skip-silhouette`, or no game dir) → **degraded**,
  saying so, because an unknown is not a verdict.

A mesh that was *found* and could not be used keeps its broken verdict for
free: `assemble.py` appends the reason in parentheses (`foo_m1 (no lods)`), the
leaf name still resolves, and it is never in the absent set.

### 2. A skinned mesh is excused only while something can pose it

`Part.is_skinned` excused any node carrying a `skin` or `skeleton` extra from
the placement check, unconditionally. That is what "does not understand a
skinned soldier" really amounted to: a soldier whose `.ske` went missing is
four meshes stacked in bind space, the body inside the head, and the old check
called it clean.

`scene_parts` now propagates whether the node or any ancestor carries an
`extras.skeleton` (`Part.skeleton_in_scope`), `Part.is_posed` is the conjunction,
and `origin_pile` excuses `is_posed` rather than `is_skinned`. `unposed_skins`
names the failure directly. Measured first: all 425 models, and all 32
soldiers, have a skeleton in scope for every skinned part, so this is pure new
failure capability.

### 3. A soldier is measured against something

A soldier is the one model in the set whose every mesh is excused from the
placement check, so without a size nothing objective was said about it at all.
`CATEGORY_LENGTHS_M = {"soldier": 1.85}` and `dimension_check(..., category=)`
give it the one external fact it has. Measured over their own geometry the 32
soldiers run 1.869 m (`GermanSoldier`) to 2.011 m (`GermanEliteSoldier`,
`VCFemaleSoldier` — helmets and licence); 1.85 m at the standard 18% tolerance
spans 1.517–2.183 m, so all of them pass and a soldier at a tenth or three
times scale does not. `BritishSoldier` reads 1.874 m, 1.3% off.

### 4. A part that is simply gone

Nothing could see it. A lost placement makes a pile, a lost mesh makes a report
line, but a node dropped between the assembler's count and the bytes on disk
leaves no trace anywhere else. `inventory_check` holds the scene's own body
parts and triangles against the `parts` and `triangles` the exporter wrote into
its report. They agree **exactly** on all 425 models of the four catalogues, so
no tolerance is warranted and a disagreement is a fact rather than a reading.

### 5. Binds, from both ends

Losing a bind silences *both* existing checks at once, which is the worst shape
a verifier can have: the silhouette check measures bound parts, so with no
bound parts it measures nothing, and the pile check sees two collapsed parts
where it allows two. Proved on the real Bar1918 — see `m3` below.

- `verify.unstamped_binds` — a part the report placed from a bone that carries
  no `boundBone` in the file. Exceptions are exact, not fuzzy: the 32 soldiers'
  skinned heads say `(skinned, bind pose is identity)` in the line itself and
  stamp no offset by design, and four EoD parts never reached the scene at all.
- `verify_models.declared_binds` — the game data's own
  `bindToSkeletonPart` count against what the assembler recorded. This is the
  only check that can see `bindToSkeletonPart` parsed wrong, because in that
  shape every artefact-only check agrees that nothing is wrong. Declared equals
  recorded on all 425 models, including the cases where the bind could not be
  applied (EoD's `M40` inherits the No4's bones and misses two; the count still
  matches, because the assembler records the attempt).

### 6. A fact about a file holds in every chain that inherits the file

`BASE_GAME_ABSENT_MESHES` already says this of itself. Two neighbouring tables
did not follow it:

- `VANILLA_UNRESOLVED_TEXTURES` (`texture/`, `texture/sherW2_f`,
  `texture/b17win_l`) was gated on the extraction being vanilla, yet 19 of the
  22 unresolved-texture rows across XPack2 and EoD are those same three names,
  reached through vanilla's own `.rs` files. None of the three is in any
  archive of the chain (checked).
- `MATERIALS_WITHOUT_SHADER_AUTHORED` likewise: EoD's Thompson and Sg44 *are*
  vanilla's meshes with vanilla's two shaderless materials. Keying on the
  material name is what makes this safe — a mod weapon that merely shares a
  template name carries its own mesh and so its own material names.

### 7. A shaderless material on the exporter's own furniture

Thirteen EoD vehicles reported `bullet_m1_Material0` as a degradation. That is
the material of `bullet_m1` — the round the gun fires, baked hidden on the
barrel as a `projectileMesh`, the same furniture the placement and size checks
already exclude. A material name carries the mesh it came from (`Foo_M1.sm`
names its materials `Foo_M1_Material0`), so `helper_geometry_names` collects the
geometries only helper nodes use and `material_mesh` matches the two up. A
geometry any drawn part also uses keeps its degradation.

## Final counts

| catalogue | clean | degraded | broken | exit |
|---|---|---|---|---|
| vanilla (96) | 94 | 2 | 0 | 0 |
| XPack1 (15) | 13 | 2 | 0 | 0 |
| XPack2 (29) | **27** | 2 | 0 | 0 |
| EoD (285) | **251** | 34 | **0** | 0 |

## The deliberately broken models, and what it said

Built by `tests/glb_mutate.py`, which rewrites only the JSON chunk of a real
`.glb` and copies the binary chunk through untouched, so every reading is a
reading of real geometry. Each went into its own throwaway catalogue with the
original template name and the unmutated report, and the full CLI was run over
it. **All seven exit 1.**

| | mutation | what it said |
|---|---|---|
| m1 | `Sherman`, every sub-node's translation zeroed | `[broken] 25 unexplained parts piled on the origin: ShermanCockpitExternal, ShermanWheelL1, ... sherman_Browning_console` — W3-E's case, and S3's clustering fix does hold: the anchor follows the parts. |
| m2 | `Bar1918` scaled 3x at the root | `[broken] length 3.556 m vs 1.194 m real (197.8% off)` |
| m3 | `Bar1918`, bound sub-parts collapsed to the origin and `boundBone` stripped | `[broken] 3 part(s) the report placed from a bone carry no bind in the file: Bar1918Mag, Bar1918Plupp, Bar1918Trigger`. Before this stream: **clean**, and that is the bug the module was written for. |
| m4 | `BritishSoldier` with its `skeleton` extras removed | `[broken] 4 skinned mesh(es) with no skeleton in scope to pose them: BritSoldier3PBody, BritSoldierComplexHead1, BritSoldierLeftHand, BritSoldierRightHand`. Before: **clean**. |
| m5 | `Sherman` with `ShermanTower` unlinked from the scene | `[broken] the scene holds 26 parts and 2792 triangles; the exporter's own report counted 32 and 5614`. Before: **clean**. |
| m6 | all 29 vanilla hand weapons, bound parts' Z negated (the unmirrored `.ske` read) | 11 broken, each `[broken] N% of bound-part area outside the shadow silhouette — and so does the median weapon in this catalogue`: Mp40 95.7%, No4Sniper 77.8%, Sg44 75.5%, WalterP38 59.1%, Thompson 55.6%, No4 52.1% and five more. The catalogue-median gate does what it says. |
| m7 | `Bar1918` as m3, plus a report with `boundParts` emptied — the `bindToSkeletonPart` parse failure in full | `[broken] the game data binds 3 sub-part(s) to a bone and the assembler recorded 0, so 3 bind(s) were never read`. Before: **clean**. |

Four of the seven passed the verifier before this stream. `m3` is the one that
matters most: the historical bug, on a real weapon, called clean.

Re-runnable: `tests/test_verify_mutations.py` carries m1–m5 and m7 as tests. The
two `.fp.glb` viewmodels are tracked so half the file runs anywhere; the
catalogue cases run when `viewer/models` is present or `BF1942_MODELS` points at
a checkout that has it.

## Every remaining complaint

Nothing is broken in any catalogue. The 40 remaining degradations:

**True positives about the game data** (28 rows). The extraction is faithful;
the data has a hole.

- `GrenadeAllies` and seven EoD grenades/flares (22 rows): `skeletons
  unreadable: animations/GrenadeAllies.ske` and two bound parts left unplaced.
  A corrupt `.ske` in the shipped archive — the file is already kept as
  `tests/fixtures/grenadeallies.ske.lzo`. `Molotov` is the same with its own
  `.ske`.
- 12 rows of `geometry templates unresolved and defined nowhere in the mod
  chain` on the eight EoD models above plus `Big_Bomb_M1` on BF109 / Mustang /
  Yak9 / Zero (that one only a projectile wanted). The models are whole; the
  mod's references dangle. Worth knowing, not worth failing.
- 6 EoD texture rows the mod itself never shipped: `texture/50cal_b` and
  `texture/brnhol_h` (Elco80), `texture/hull` (three Loach variants),
  `texture/EoD_Flexgunmount` (EoD_Huey), `texture/Ve_M113`
  (EoD_T63apcmortar). Checked absent from every archive of the chain.
- `EoD_Raft` 688/3602 and `Vespa` 112/2480 zero-area triangles, plus
  `EoD_Raft_01_M1_Material1/2` with no shader — EoD's own meshes.
- Four `bound part names a bone its own skeleton lacks` rows (EoD `M40`,
  `M79Flare`, `M79smoke`, XPack1 `No4Bayonet`), each beside binds that did
  apply on the same skeleton, so the skeleton was read and the gap is the
  data's.

**Known limitations** (12 rows), each a silhouette reading against a coarse or
borrowed shadow mesh:

- `CommandoKnife` and `EliteKnife` (XPack2) at 100.0%. **Settled as authored**:
  both knives are modelled as a single sub-part bound to a `Mag` bone, and
  `Animations/CommandoKnife.ske` rests `Mag` at (0.0633, 0.0147, 0.1022) — which
  is the exported node's translation exactly, Z mirrored. Their shadow is
  vanilla's `Shade_knife_al_m1`, a 2 cm-wide cutout drawn for a knife modelled
  at the origin, so a 6 cm offset puts the whole blade outside it. Our bind is
  right; the comparison is against the wrong knife's shadow.
- `Type5` 58.8%, `Detonator` 22.6%, `DP` 15.4%, `Panzershreck` 9.0% in **EoD**.
  These four are vanilla weapons EoD inherits and they have recorded authored
  ceilings, but `SILHOUETTE_AUTHORED` is gated on `vanilla_facts`, which is off
  for a mod. Unlike the two file-level tables this gate is defensible (the
  table is about a model's whole shadow relationship, and a mod's `Type5` need
  not be vanilla's), but the fix shape is clear if someone wants those four
  quiet: record the shadow mesh file beside the ceiling
  (`Type5 -> Shad_K98_m1`) and let the fact apply wherever the measured shadow
  mesh matches, mod or not. That cannot misfire on a name collision.
- `K98Bayonet` 38.0% and `No4Bayonet` 26.4% (XPack1): the bayonet object reads
  99.5% and 77.8% outside on its own, because a bayonet is bolted in front of
  the muzzle and the rifle's shadow mesh ends at the muzzle. Same gate as
  above — there is no way to record an authored fact for a mod weapon today.
- `Colt_Silenced` 7.2% (EoD), just over the 7% warn line.
- `No4Sniper` 14.4%, in vanilla and again in EoD. **Not settled**, and the one
  reading worth a render. `No4Scope` is 25.5% outside, against a shadow that
  *does* have a scope (`Shad_No4_Scope_m1`), while K98Sniper's scope reads only
  5.2% against its equivalent. Measured: the shadow's upper region spans
  z −0.710..−0.058 and the scope spans z −0.304..−0.017, so the eyepiece
  overhangs 4.1 cm to the rear of the cutout, and its top is 6 mm above the
  shadow's. Either the artist's cutout is short or the scope's bind is 4 cm
  out, and 4 cm on a 1.07 m rifle is not decidable from the boxes. Deliberately
  *not* given an authored ceiling: a wrong expectation is worse than none, and
  degraded costs nothing while keeping the question visible.
  Reproduce with `scratch probe_scope.py` (recorded in this stream's scratch) or
  by comparing `No4Scope`'s box against `shadow_triangles(lib, meshes,
  "No4Sniper")`.

## What the noise was hiding

Two real findings, neither in our pipeline:

1. **EoD's M79 family draws no receiver, trigger or magazine, and its
   `Vietcong_Grenadelauncher` no body at all** — the mod's `.con` points their
   Complex bundles and sub-parts at geometry templates it never creates, even
   though `standardmesh/EoD/Vietcong_Grenadelauncher/Vietcong_Grenadelauncher.sm`
   is sitting in the archive unreferenced. Same for a raft motor, an M113 turret
   MG and the LCT's stern ramp. The game has the same holes; anyone comparing
   the viewer against a screenshot should not go looking for our bug.
2. **The origin-pile check cannot catch a weapon's collapse on its own**, and
   nobody knew. The allowance of 2 is load-bearing — 42 of the 285 EoD models
   legitimately put two parts on one point, almost all of them the
   `PropellerStatic`/`PropellerBlurred` pair, so it cannot be lowered — and the
   5% centroid radius that keeps EoD's LCT-Mk6 quiet is smaller than a rifle
   sub-part's own mesh offset (the Bar1918's trigger is authored 11.5 cm from
   its bone, 9.7% of the weapon). A collapsed Bar1918 therefore shows two
   collapsed parts against an allowance of two. The two bind checks in §5 are
   what cover that gap now; the pile check's own gates were left exactly as S3
   set them.

## Tests

`python3 -m unittest discover -s tools/bf1942-models/tests` from the repo root:
**2,368 tests, OK** (13 skipped), about 42 s. 2,337 before this stream; the
verifier's own share went 68 → 99 (`test_verify.py` 34 → 37,
`test_verify_false_alarms.py` 34 → 45, and 17 new), in three files:

- `tests/test_verify.py` — unit behaviour, including the new severity ladder
  for unresolved assets.
- `tests/test_verify_false_alarms.py` — one test per false-alarm class, each
  asserting both halves: the false alarm is gone *and* the real failure the
  check exists for still fails.
- `tests/test_verify_mutations.py` — real `.glb` files broken on purpose.
- `tests/glb_mutate.py` — the mutation helper, with its own round-trip tests.

## Commits

On `worktree-agent-a4b6580013938387c`:

- `2143572` fix(mesh): the model verifier can fail again, and stops blaming us
  for the mod's own gaps
- `5afd3e1` fix(mesh): a missing file the base game never shipped is missing in
  every mod too
