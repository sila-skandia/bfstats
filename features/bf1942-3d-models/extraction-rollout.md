# Extraction rollout: the full armoury, and a verifier

The follow-up pass to the [feature README](README.md): the whole vanilla
catalogue extracted, three more SMGs brought to the Colt/K98 standard, the
texture coverage re-measured after the install was made whole, and — the part
that outlives any one extraction — scripts that answer "did this come out
right?" without a human looking at a render.

## The install is whole again

The README documents an interrupted DataField42 sync that left the install
with no vanilla `texture.rfa`, and predicts what a re-fetch would restore from
the two largest sizes in `ChecksumCache.yaml`. That re-fetch has happened:

```
Mods/bf1942/Archives/texture.rfa        98,885,015 bytes, 1,605 entries
Mods/bf1942/Archives/standardMesh.rfa   40,426,408 bytes
```

Both sizes match the cache entries the README flagged as absent. Everything
downstream of that changes:

- **The six `--texture-fallback` flags in the README's headline command are
  dead weight for vanilla.** The minimal command is now just the template
  names:

  ```bash
  cd tools/bf1942-models
  python3 extract_models.py Thompson Sg44 Mp18 --out ./viewer/models
  ```

  Fallbacks remain useful only for what they were built for — mods whose own
  chains have gaps.

- **PanzerIV, recorded as unfixable ("stays white because no mod ships
  `texture/P4Main_f`"), paints fully from vanilla**: 30 parts, 10 textures,
  nothing unresolved.

- Of the four references the README lists as resolving from no installed mod,
  three now resolve from `texture.rfa` (`GunMag_o`, `1p_ATrocket_h`,
  `demokit2_o` — the pistol magazines, the AT rocket and the detonator box all
  texture). The fourth, `sherW2_f`, resolves nowhere for a better reason: no
  vanilla install ever shipped it. See the census below.

## Coverage, re-measured

Same measurement as the README's table — every distinct texture reference in
the `.rs` files reachable from a mod's chain (references deduplicated as
written, so case variants count separately, which keeps the counts comparable
with the old table), resolved the way the extractor resolves them. Now a
script:

```bash
python3 texture_coverage.py                  # the six mods below
python3 texture_coverage.py bf1942 --missing # and name what does not resolve
```

| Mod | Refs (was) | Resolved | Coverage (was) |
|---|---|---|---|
| **bf1942** | 1,415 (1,392) | 1,359 | **96.0%** (6.2%) |
| bg42 | 3,935 (3,912) | 3,859 | 98.1% (71.5%) |
| FH | 3,642 (3,610) | 3,509 | 96.3% (63.5%) |
| WarFront | 2,584 (2,561) | 2,452 | 94.9% (53.4%) |
| GCMOD | 2,427 (2,404) | 2,288 | 94.3% (43.5%) |
| FinnWars | 1,989 (1,966) | 1,880 | 94.5% (35.7%) |

Two things the deltas say. The ref counts rose slightly because the restored
`standardMesh.rfa` carries `.rs` files of its own (+23 references for every
chain that ends at vanilla). And every mod's coverage jumped, not just
vanilla's — each of these chains inherits from bf1942, so the missing archive
had been silently failing *their* lookups too.

Vanilla's remaining 56 unresolved references are not damage; they are
references no complete install ever satisfied — `.rs` files naming art that
was never shipped. The census: menu-scene skybox meshes (`SkyC`,
`SkyBocage_M1`, `SkyElala_m1` — 17 references), road-wheel texture variants
(`sherW2_f`/`sherW6_f`/`sherW8_f`, `HanWh1_f`..`HanWh6_f`,
`M3APC_Whell1_Z`), one-off oddities (`Lionfish_Scope01_H copy`, an empty
`texture/`), and detail passes on meshes nothing spawns. Only three of the 56
reach an extracted model:

| Reference | Where it shows |
|---|---|
| `texture/sherW2_f` | one road-wheel variant on Sherman, M10 and Priest |
| `texture/B17Win_L` | the B17's window panes |
| `texture/` | an empty ref in `BlackMedal_Hull_L1.rs` and two Yamato turret meshes |

The verifier records these as facts (`VANILLA_UNRESOLVED_TEXTURES` in
`bf42/verify.py`) rather than penalising models for them — the same pattern
the damage loader uses for the ten `run` targets vanilla `Game.rfa` names but
does not contain.

## Thompson, Sg44, Mp18

Extracted with no fallback flags, verified by the shadow-silhouette method the
README established:

| | Parts | Tris | Textures | Silhouette outside | Length vs real |
|---|---|---|---|---|---|
| Thompson | 3 | 878 | 1 | **6.0%** | 0.815 m vs 0.85 m (M1928A1) |
| Sg44 | 3 | 1,353 | 2 | **0.3%** | 1.011 m vs 0.94 m (StG 44) |
| Mp18 | 4 | 1,217 | 1 | **0.0%** | 0.785 m vs 0.815 m |

All three land their `bindToSkeletonPart` sub-parts inside the published
1.9-6.4% band for the weapons already done. Three details worth recording:

- **The Thompson's `Thompson_m1_Material0` has no shader** — vanilla
  `StandardMesh/Thompson.rs` defines subshaders for materials 1, 2 and 3 and
  simply omits 0, a 2-triangle sliver. The StG 44 is the same story:
  `SG44_Material1` (a 29-triangle sight detail) has no block in `SG44.rs`.
  Both are authored gaps, recorded in `MATERIALS_WITHOUT_SHADER_AUTHORED`.
- **The Mp18's texture reference ends in a space** — the `.rs` asks for
  `texture/jap_mgun_T ` and the archive genuinely stores
  `Texture/jap_mgun_T .dds`, trailing space and all. Same class of authoring
  artefact as the case-insensitivity the README documents (and the K98's
  `"SIKTE     "` bone): the archives were written on Windows, where the tools
  that produced them never round-tripped the name through a filesystem that
  would have rejected it. Nothing in the lookup chain breaks on it because
  nothing in the chain normalises whitespace: the `.rs` parser captures
  everything between the quotes, `ArchivePool` keys entries by
  lowercased-but-otherwise-verbatim name, and both the exact-path and the
  basename fallback therefore carry the space on both sides of the
  comparison. The two ways to break it are both "cleanups": a `.strip()`
  anywhere in `rs.py` or `rfa.py` orphans the Mp18's only texture, and
  extracting the archive to a real Windows filesystem silently drops the
  space (Win32 forbids trailing spaces in filenames), after which repacking
  produces an archive whose stored name no longer matches the reference.
- **The Mp18 measures 0.23 m wide** against 3-5 cm for every other SMG. That
  is the snail-drum magazine hanging off the left side, and the weapon's
  shadow mesh agrees — at 0.275 m it is the widest shadow in the armoury.

## The armoury, measured

The rollout evidence: every vanilla hand weapon, silhouette figure and length
check, from `verify_models.py --json`. "Outside" is the aggregate fraction of
bound-part area outside the weapon's own shadow silhouette; "worst part" is
the single worst sub-part.

| Weapon | Outside | Worst part | Length vs real |
|---|---|---|---|
| Bazooka | 0.0% | — | 1.548 m vs 1.37 m |
| Mp18 | 0.0% | — | 0.785 m vs 0.815 m |
| Type99 | 0.0% | — | 1.226 m vs 1.118 m |
| Sg44 | 0.3% | mag 0.3% | 1.011 m vs 0.94 m |
| Colt | 1.3% | hammer 8.0% | 0.241 m vs 0.216 m |
| K98 | 1.3% | trigger 61.9% | 1.131 m vs 1.11 m |
| JohnsonLMG | 1.5% | trigger 62.5% | 1.234 m vs 1.066 m |
| M1Garand | 1.6% | trigger 32.9% | 1.104 m vs 1.10 m |
| No4 | 1.8% | trigger 34.0% | 1.066 m vs 1.129 m |
| Bar1918 | 3.0% | mag 3.0% | 1.185 m vs 1.194 m |
| Mp40 | 4.4% | trigger 62.7% | 0.842 m vs 0.833 m |
| WalterP38 | 5.2% | trigger 81.5% | 0.232 m vs 0.216 m |
| Thompson | 6.0% | mag 6.0% | 0.815 m vs 0.85 m |
| Panzershreck | 9.0% (authored) | trigger 81.0% | 1.412 m vs 1.64 m |
| DP | 15.4% (authored) | pan mag 17.2% | 1.269 m vs 1.27 m |
| Detonator | 22.6% (authored) | plunger 22.6% | 0.132 m |
| Type5 | 58.8% (authored) | mag 72.6% | 1.106 m vs 1.10 m |
| Binoculars, ExpPack, GrenadeAxis, KnifeAllies, KnifeAxis, Landmine, MedPack, RepairPack, riflebulletclip_m1 | not measurable | single-part weapons, nothing bound | — |
| GrenadeAllies | not measurable | corrupt `.ske`, see triage | — |

Two systematic effects in that table, both worth understanding before reading
any number as a defect:

- **Triggers post terrible worst-part figures on perfectly placed weapons.**
  The shadow meshes are coarse cutouts that do not carve the trigger-guard
  opening, so a correctly seated trigger has almost nowhere legal to be. The
  aggregate weights parts by projected area, which is the point: the mag and
  the bolt — the parts a bind error actually throws across the weapon — are
  the area, and the 22-triangle trigger cannot drown them out.
- **Four weapons carry authored mismatches, recorded with ceilings and
  reasons** (`SILHOUETTE_AUTHORED`). The Type5 is the striking one — vanilla
  ships the K98's shadow as its simple LOD:

  ```con
  GeometryTemplate.create StandardMesh Type5Simple
  GeometryTemplate.file Shad_K98_m1
  ```

  so the Type 5's Garand-style box magazine measures 72.6% outside a
  silhouette that has a flush-stocked K98 where the mag should hang. The
  Detonator's only bound part is its 6 cm plunger handle, all fine detail no
  crude shadow covers; the DP's shadow draws the pan magazine lower and
  thinner than the `DPMag` bone rests it; the Panzershreck's shadow is tighter
  than the weapon body itself (the *unbound* body measures 11.3% outside it).
  Bounding-box comparison against the shadow confirms each of the four is
  placement-correct. Each entry carries a ceiling (1.25-1.5x the measured
  value) that a real regression would still have to break — the historical
  mirror bug threw parts 15-60% out on top of whatever the shadow already
  missed.

The length column is a genuinely external check: it ties the whole chain —
`.sm` units, `.ske` bind poses, the Z-mirror conjugation, glTF export —
to figures the game's authors never wrote down. The two largest deviations are
themselves informative: the JohnsonLMG draws 15.8% long and the Colt 11.6%
long, both consistent modelling licence, both stable — while the deliberate
regressions below move the Colt to +37%.

## Full-catalogue triage

`extract_all.py` sweeps everything `--list` prints — 96 templates: 13 air, 22
land, 16 sea, 8 soldiers, 10 emplacements, 27 hand weapons.

**Skipped up front, with reasons (2):** `Coaxial_browning` and `Coaxial_MG42`
carry no geometry anywhere in their template trees — they are the muzzle-flash
and shell-eject logic of a tank's coax MG, whose visible barrel belongs to the
tank mesh. Extraction of them can only ever fail, so the script says so
instead of trying.

**Exported (94), then verified:**

| Verdict | Count | Which |
|---|---|---|
| clean | 93 | everything else, including all ships, aircraft, armour, soldiers and emplacements |
| degraded | 1 | GrenadeAllies |
| broken | 0 | — |

On the 2026-09-20 rebuild the same sweep over 96 models reads **94 clean, 2
degraded, 0 broken, exit 0** — the second degradation is `No4Sniper`, which
measures 14.4% outside `Shad_No4_Scope`, its trigger 33% and its scope 25%.
Whether that is the shadow being coarse around the scope mount or a real
placement is not settled; it is the one vanilla weapon worth a look.

GrenadeAllies is the README's corrupt `.ske` (header claims version 278; no
byte offset parses). Its pin and spoon sit at the weapon origin — inside the
8 cm grenade body, so the render is mildly rather than grotesquely wrong — and
the verifier classifies it degraded *because* the report explains the pile
(`skeletonsNotRead`); the same pile without that explanation is a broken
verdict. The fix is not code: restore the file from a pristine source
(`~/gaming/bf1942/data.bin`, per the README) or a re-sync.

Recorded authored gaps that are extraction-clean but worth knowing (all
surfaced as `info` findings, none of them penalised): the five models touching
never-shipped textures (Sherman, M10, Priest — `sherW2_f`; B17 — `B17Win_L`;
Yamato — the empty `texture/`), the Thompson and StG 44 shaderless materials,
and the four silhouette ceilings above.

**What to fix next, in order:** nothing is actually broken. The queue is
(1) GrenadeAllies' `.ske`, a file-restore rather than a parser job;
(2) the Corsair measures 11.04 m across against a 12.5 m real wingspan — the
only aircraft that matches neither its type's span nor length, unverified
whether the model is undersized or mislabelled, so it has no entry in the
known-lengths table yet; (3) the authored gaps, which only new art could fill.

## The scripts

### `extract_all.py` — the catalogue in one command

```bash
python3 extract_all.py                              # vanilla, everything, ./viewer/models
python3 extract_all.py --categories handweapon      # just the armoury
python3 extract_all.py --mod FH --out ./out-fh --texture-fallback WarFront
python3 extract_all.py --level-all --configuration-all --verify
```

The template list is derived, not pasted: the same catalogue `--list` prints,
filtered by `--categories`/`--exclude`, minus templates with no renderable
geometry (announced, with the reason). One `extract_models.py` invocation does
the work so `models.json` comes out complete, per-template failures are
counted rather than fatal, and the run ends by diffing what landed against
what was asked. `--verify` chains straight into the verifier.

### `verify_models.py` — the answer to "did it come out right?"

```bash
python3 verify_models.py                            # ./viewer/models
python3 verify_models.py --models ./out --only Thompson Sg44 Mp18
python3 verify_models.py --strict --json findings.json
```

Five checks per model, folded into one clean / degraded / broken verdict.

**Every one of them asks the extras the exporter stamps on a node what that
node is, and none of them reads its name.** That is the whole of the
2026-09-20 repair and it is worth stating first, because for a while it was
not true and the verifier was useless as a result — see *When it cried wolf*
below.

1. **Silhouette** (hand weapons): assemble nothing, trust nothing — read the
   bound parts' world-space triangles back out of the `.glb`, read the
   weapon's shadow mesh out of the archives, rasterise both in the side (Z-Y)
   projection at 512 px with the silhouette dilated one pixel, and measure the
   bound area that falls outside. Side view only, because the shadows are
   near-flat cutouts (the Colt's is 3 cm wide) — a front projection of one is
   a line, and any part with sideways offset reads 100% outside of it.

   Two things decide what the reading *means*. First, the premise is checked:
   a shadow mesh is a low-poly stand-in, so the check only runs where the
   simple LOD is at most 35% of the model's triangles. Vanilla's JohnsonLMG
   points its Simple alternative at the weapon's own body (1,183 against
   1,520) and Secret Weapons' Gewehr43_zf4 at 1,285 of 1,555; comparing a
   weapon against itself measures the trigger-guard hole, and read the G43's
   trigger, bolt and clip as 85-90% outside on a perfectly good model.
   Second, one weapon reading high is a *degradation*, because vanilla itself
   borrows shadows between weapons; it is the **catalogue's median** reading
   high that is broken, which is the shape the mirrored-`.ske` bug has.
   Vanilla's median is 3.0% over 19 weapons, EoD's 3.2% over 28.
2. **Origin pile**: three or more *unexplained* parts collapsed onto the
   origin. Four kinds of node are explained and do not count: a part with a
   `boundBone` (a skeleton put it there — the Type99's mag and bolt rest
   exactly on its base bone), a part with a `skin` (authored in bind space,
   which is why every soldier's body, head and two hands sit on the origin),
   the exporter's own collision hulls, emitters, tracers and projectile
   previews, and any part the report already reports as a bind it could not
   apply.

   "Collapsed" means both halves: the node is at the origin *and* the part's
   own geometry is, within 5% of the model's longest side. A `.con` gives a
   sub-part no `setPosition` whenever the mesh already sits where it belongs,
   which is how most mod vehicles are built — EoD's LCT-Mk6 has five such
   parts and their geometry is 1.6 m, 8.7 m, 7.5 m, 17.3 m and 13.8 m from
   the origin of a 35 m craft. A sub-part whose placement was genuinely lost
   is authored around its own local origin, so it lands on the model origin
   too: a rifle trigger is 2 cm of mesh, a centimetre from the origin of a
   1.1 m weapon.
3. **Report findings**: an unresolved mesh or geometry template is weighed by
   *what in that model's own template tree wanted it*, walked through the
   library from the model's root including `projectileTemplate` edges. EoD's
   BF109 reports `Big_Bomb_M1` unresolved and the only thing naming it is
   `FighterBomb`, the bomb the rack fires — degraded, the aeroplane is whole.
   Per model and not globally, because vanilla's `IlyushinDummyBomb` carries
   that very mesh under the Il-2's wing as a drawn part, and the Il-2 losing
   it would be a hole. Unresolved textures, shaderless materials and
   unreadable skeletons are degraded; the recorded vanilla facts are info.
   `--mod` other than bf1942 voids the per-model fact lists — a mod's template
   names can collide with vanilla's without sharing its data — but not
   `BASE_GAME_ABSENT_MESHES`, which is a statement about a *file* every mod
   chain inherits.

   A bound part naming a bone its skeleton lacks is broken only when no bind
   on that model applied at all; beside binds that did apply, the skeleton was
   read and the gap is the game's own data (EoD's M40 inherits the No4's
   `Block` and `Mag` sub-parts without their bones).
4. **Dimensions**: longest side **of the model's own geometry** against
   real-world figures for the templates where the real figure is unambiguous
   (`KNOWN_LENGTHS_M`), 18% tolerance. Measuring the whole file is what
   produced a 3.56 m Browning (its muzzle flash reaches 2.56 m from a 1.65 m
   gun) and a 2.02 m Bar1918 against 1.19 m real. Entries deliberately
   omitted where the game leaves the variant ambiguous (PanzerIV barrel
   length, T34 vs T34-85) — a wrong expectation is worse than none, which is
   also why `Stationary_mg42` no longer has one: it is the gun on its Lafette
   42 mount, and the mount is the longest side.
5. **Geometry health**: non-finite vertices are broken; more than 2%
   zero-area triangles is degraded.

Broken exits non-zero; `--strict` promotes degraded.

### When it cried wolf, and what it says now

The 2026-09-19 rebuild produced this:

| catalogue | before | after |
|---|---|---|
| vanilla (96) | 53 clean, 1 degraded, **42 broken** | 94 clean, 2 degraded, **0 broken** |
| Eve of Destruction (285) | 152 clean, 37 degraded, **96 broken** | 221 clean, 56 degraded, **8 broken** |
| Road to Rome (15) | 9 clean, 0 degraded, **6 broken** | 13 clean, 2 degraded, **0 broken** |
| Secret Weapons (29) | 20 clean, 2 degraded, **7 broken** | 25 clean, 4 degraded, **0 broken** |

Every one of the 151 "broken" verdicts on the left was checked by eye and was
wrong, and four things accounted for all of them:

| class | count | what it really was |
|---|---|---|
| origin pile | 88 | the exporter's muzzle-flash emitters, tracers, projectile previews and cockpit meshes, all spawned at the object's own origin; and every soldier's four skinned meshes |
| length | 48 | measured across those same emitters — Browning 3.56 m against 1.65 m real, Bar1918 2.02 m against 1.19 m |
| `bodycollision_m1` | 31 | a `SkeletonCollisionMesh` every `BFSoldier` references and no archive of a complete install ships; a hitbox, not render geometry |
| silhouette / unresolved geometry | 24 | coarse or borrowed shadow meshes, simple LODs that are the weapon itself, and geometry only a projectile wanted |

The eight that remain in Eve of Destruction are true positives, each a
`GeometryTemplate` its own `.con` files reference and never declare, confirmed
by resolving the name against the whole EoD mod chain:

| model | unresolved | what is missing |
|---|---|---|
| `M79` | `M79`, `remingtonMag`, `remingtonTrigger` | the launcher body, magazine and trigger |
| `M79Flare`, `M79smoke` | `M79Smoke`, `remingtonMag`, `remingtonTrigger` | the same three |
| `Vietcong_Grenadelauncher` | `Vietcong_Grenadelauncher`, `remingtonMag`, `remingtonTrigger` | the body has a `.sm` but no `GeometryTemplate` declares it |
| `M125Mortar` | `M125_TurretMG` | the turret machine gun |
| `Cammo_Raft` | `CammoRaft_Motor_M1` | the outboard motor |
| `EoD_Raft` | `EoD_Raft_Motor_M1` | the outboard motor |
| `EoD_LCT-Mk6_ChopperCarrier` | `EoD_LCT-Mk6CC-Ramp` | the bow ramp (the two sibling LCTs declare theirs and are clean) |

And one true positive against this project rather than the game: the
`Stationary_mg42` row of `KNOWN_LENGTHS_M` gave the emplacement the bare gun's
1.22 m, while the model is the gun on its tripod and measures 1.715 m. The row
is gone. `Stationary_Browning` keeps its row because the M2HB is still the
longest side of that assembly (measured 1.756 m, 6.2% over).

### Does it still catch the bugs it was built for?

The original proof, run in 2026-09 by reintroducing both historical bind bugs
against five weapons (K98, Colt, Thompson, Sg44, Mp18):

| Drill | Result then |
|---|---|
| `.ske` read unmirrored | 4 of 5 broken by silhouette (41-76% outside); Colt also by length (+37%) |
| `bindToSkeletonPart` ignored | 5 of 5 broken by origin pile |

Read against the severities as they now stand, without re-running the drill:

* **Unparsed binds** still trip the origin pile on all five. The sub-parts a
  lost bind leaves behind are authored around their own bone, so their
  geometry lands on the model origin — which is exactly what the tightened
  check requires, and `tests/test_verify_false_alarms.py` asserts on a
  synthetic weapon built that way.
* **A mirrored `.ske`** throws 41-76% outside on four of five weapons, so the
  median of a real catalogue is far over the 12% that makes a high reading
  fatal. A *whole-catalogue* run is therefore still broken, and so is an exit
  code of 1. A targeted `--only` run over fewer than eight weapons with a
  shadow has no median worth the name and reports degraded instead: it still
  exits 1 under `--strict`, and the numbers are still in the output, but the
  verdict is weaker. Run the whole catalogue when the question is whether an
  extraction is sound.
* The one that slipped the first drill is still instructive: the Mp18's bones
  are rotated almost purely about X, where the mirror conjugation barely
  shows — the exact trap the README's `.ske` section documents — so its
  unmirrored render measured only 4.6% outside. One check missing one weapon
  under one bug is why there are five checks; the same bug expressed as
  unparsed binds trips all five weapons at once.

### `texture_coverage.py` — the table above, on demand

One line per mod; `--missing` lists every unresolved reference with the first
`.rs` that asked for it. Run it after touching anything in the archive chain
and diff against the table here.

## Verification

Everything the new modules parse or compute is covered
installation-independently in `tests/test_verify.py`,
`tests/test_verify_false_alarms.py` and `tests/test_extract_all.py` — glb
round-trips built with the project's own `GlbBuilder`, synthetic silhouettes
with known overlap fractions, the origin-pile qualifiers (soldier stack
allowed, Type99-style bound stack allowed, unbound pile flagged), the
authored-fact gating on and off vanilla, the shadow-geometry walk over a
synthetic `.con` library, and the effects-only skip rule:

```bash
python3 -m unittest discover -s tools/bf1942-models/tests   # 1,566 tests
```

`test_verify_false_alarms.py` is one test per class of thing the verifier used
to get wrong, each built as a small synthetic `.glb` carrying the extras the
exporter really writes — a weapon with its muzzle flash and tracer, a
four-part skinned soldier, a landing craft whose sub-parts are modelled in
hull space, a weapon whose sub-parts genuinely collapsed. Each one asserts
both halves: the false alarm is gone *and* the real failure still fails.

The silhouette thresholds themselves are not delicate: correct weapons measure
0-6% and the mirror bug measured 15-60%, with the per-catalogue median at
3.0% (vanilla) and 3.2% (EoD) against the 12% that makes a high reading
fatal.

## What the verifier does not check

Stated so nobody mistakes a passing run for more than it is: whether a
resolved texture is the *right* image for the part; rig behaviour (turret
inputs, engine accumulators — the shot matrix in `shoot.mjs --variants --rig`
remains the tool for that); Wreck and level-skin variants (the default variant
per model is what gets verified); soldier hand alignment beyond what the
existing unit tests assert; and anything about how the model animates, since
nothing in the export animates yet.
