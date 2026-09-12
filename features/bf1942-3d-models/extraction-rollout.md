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

Five checks per model, folded into one clean / degraded / broken verdict:

1. **Silhouette** (hand weapons): assemble nothing, trust nothing — read the
   bound parts' world-space triangles back out of the `.glb`, read the
   weapon's shadow mesh out of the archives, rasterise both in the side (Z-Y)
   projection at 512 px with the silhouette dilated one pixel, and measure the
   bound area that falls outside. Side view only, because the shadows are
   near-flat cutouts (the Colt's is 3 cm wide) — a front projection of one is
   a line, and any part with sideways offset reads 100% outside of it.
2. **Origin pile**: three or more *unbound* visible parts on the origin. The
   qualifiers earn their keep — vanilla stacks bound parts on purpose (the
   Type99's mag and bolt bones rest exactly on its base bone; every soldier's
   body and head share a bind), so the check only counts parts no skeleton
   vouches for, and forgives a pile the report itself explains.
3. **Report findings**: unresolved meshes and geometry templates are broken
   (the part is absent); unresolved textures, shaderless materials, unreadable
   skeletons are degraded; the recorded vanilla facts are info. `--mod`
   other than bf1942 voids the fact lists — a mod's template names can collide
   with vanilla's without sharing its data.
4. **Dimensions**: measured longest side against real-world figures for the
   52 templates where the real figure is unambiguous (`KNOWN_LENGTHS_M`),
   18% tolerance. Entries deliberately omitted where the game leaves the
   variant ambiguous (PanzerIV barrel length, T34 vs T34-85) — a wrong
   expectation is worse than none.
5. **Geometry health**: non-finite vertices are broken; more than 2%
   zero-area triangles is degraded.

Broken exits non-zero; `--strict` promotes degraded. The full vanilla sweep is
the baseline: **93 clean, 1 degraded, 0 broken, exit 0.**

Proof it catches what it claims to, by reintroducing both historical bind bugs
against five weapons (K98, Colt, Thompson, Sg44, Mp18):

| Drill | Result |
|---|---|
| `.ske` read unmirrored | 4 of 5 broken by silhouette (41-76% outside); Colt also by length (+37%) |
| `bindToSkeletonPart` ignored | 5 of 5 broken by origin pile |

The one that slips the first drill is instructive: the Mp18's bones are
rotated almost purely about X, where the mirror conjugation barely shows — the
exact trap the README's `.ske` section documents — so its unmirrored render
measures only 4.6% outside. One check missing one weapon under one bug is why
there are five checks; the same bug expressed as unparsed binds trips all
five weapons at once.

### `texture_coverage.py` — the table above, on demand

One line per mod; `--missing` lists every unresolved reference with the first
`.rs` that asked for it. Run it after touching anything in the archive chain
and diff against the table here.

## Verification

Everything the new modules parse or compute is covered
installation-independently in `tests/test_verify.py` and
`tests/test_extract_all.py` — glb round-trips built with the project's own
`GlbBuilder`, synthetic silhouettes with known overlap fractions, the
origin-pile qualifiers (soldier stack allowed, Type99-style bound stack
allowed, unbound pile flagged), the authored-fact gating on and off vanilla,
the shadow-geometry walk over a synthetic `.con` library, and the effects-only
skip rule:

```bash
python3 -m unittest discover -s tools/bf1942-models/tests -v   # 150 tests
```

The silhouette thresholds themselves (warn 7%, fail 10%) are not delicate:
correct weapons measure 0-6%, the bug measured 15-60%, and nothing vanilla
sits in between.

## What the verifier does not check

Stated so nobody mistakes a passing run for more than it is: whether a
resolved texture is the *right* image for the part; rig behaviour (turret
inputs, engine accumulators — the shot matrix in `shoot.mjs --variants --rig`
remains the tool for that); Wreck and level-skin variants (the default variant
per model is what gets verified); soldier hand alignment beyond what the
existing unit tests assert; and anything about how the model animates, since
nothing in the export animates yet.
