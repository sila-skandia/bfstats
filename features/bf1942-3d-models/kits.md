# Kits: what a soldier wears

Every soldier the extractor has ever produced is bare-headed. That is not a bug
in the assembler — it is correct for the template it was given. A `BFSoldier`
declares a body, a head and two hands, and nothing else. The helmet is not his.
It belongs to the kit he picked at the spawn screen, and the kit is a separate
object tree the extractor has never walked.

This document settles how the engine dresses a soldier, what that means for
extraction, and how kits become something you can browse.

## What shipped

```bash
cd tools/bf1942-models
python3 extract_kits.py --out ./viewer/models
python3 extract_kits.py --mod EoD --out ./viewer/models/mods/eod
```

Then **Kits**, the fourth tab of the mesh viewer, beside Models / Maps / Poses.

| | kits | worn meshes | parts placed |
|---|---|---|---|
| bf1942 | 35 | 77 | **89 of 89** |
| EoD | 128 | 186 | 358 |

- `bf42/kit.py` — kit collection, part resolution, the level sweep, the
  parachute-twin fold.
- `extract_kits.py` — one `.glb` per distinct worn geometry, one per ground
  pickup, and `kits.json`.
- `viewer/kits.html` — the browser.
- `bf42/con.py` learned `setBoneName`, `setType` and `setKitTeam`;
  `bf42/roster.py` learned EoD's nations.
- `tests/test_kit.py` — 16 tests, installation-free like the rest.

Measured in the browser against the real extraction: **89 of 89 vanilla worn
parts place** (35 head, 22 back, 32 hip) and head parts land at y = 1.73–1.77 m
against a naive ungrafted y ≈ 0. Orientation is checked by recovering the
rotation between each part standalone and grafted, which must be the identity:
**447 of 447 parts across vanilla and EoD, maximum deviation 0.00°.**

It took three metrics to get there, and the first two were each green while the
helmets were visibly wrong. That story is worth more than the number — see
"The graft, and the trap it walked into".

## Scope

**Vanilla BF1942 and Eve of Destruction first. Road to Rome and Secret Weapons
next. Everything else later.** The mechanism was verified across all 16 installed
mods because that is how you learn a format's real vocabulary rather than one
mod's habits — but the survey is evidence, not a work list. The other mods sit in
an appendix at the end, and the only reason to read it now is that FH/FHSW and
DC break assumptions the first four do not, so the interfaces should not be built
in a way that forecloses them.

| | declared | bound by a level | browsable | worn geometries (head / back / hip) |
|---|---|---|---|---|
| **bf1942** | 45 | 35 | **35** | 50 — 25 / 14 / 11 |
| **EoD** | 240 | 194 | **102** | 50 — 29 / 11 / 10 |
| XPack1 — Road to Rome | 14 | 13 | **13** | 25 — 10 / 8 / 7 |
| XPack2 — Secret Weapons | 18 | 11 | **11** | 21 — 11 / 7 / 3 |

**161 browsable kits and 101 distinct worn geometries across all four** — 56
headgear, 23 backpack, 22 hip. That is the entire extraction job: about a hundred
small static meshes, a few hundred KB each. Vanilla alone is 35 kits and 50
meshes.

Three reasons those columns differ, and each is a rule the pipeline needs:

- **`BaseKit` is dead everywhere.** `Kit USKit` / `GerKit` / `BritKit` /
  `RussKit` / `JapKit` appear in vanilla, XPack2 and EoD, point at older
  `Soldier/USHelmet`-style meshes, and no level's `game.setKit` ever names one.
  XPack2 adds `CommandoKit` and `GerEliteKit` to the dead pile.
- **Vanilla's Canadian kits are overwritten before they spawn.** Exactly one
  level names them, `Liberation_of_Caen`, and it sets team 2 *twice* in the same
  file — five `Canadian_*` kits under `CanadianSoldier`, then immediately five
  `GB_*` kits under `BritishSoldier`. `Init.con` runs top to bottom and a later
  `game.setKit 2 0 <x>` replaces slot 0 rather than adding to it, so what
  actually loads is the British set. Counting *mentions* makes all five Canadian
  kits look live; replaying the file the way the engine does shows they never
  reach a player. That also explains why all five wear the same
  `Canadian_helmet` and why `CanadianKit/Medic/Objects.con` declares a
  `Medic_helm_brit` part it never uses — unfinished content. (bg42 later binds
  its *own* `Canadian_*` kits; different templates.)
- **EoD ships every kit twice.** 116 of its 240 are `_CHUTE` twins, and 115 of the
  116 differ from their base by exactly one thing: the base carries a `nochute`
  flag and the twin does not. Same weapons, same hat. Collapsing them takes 194
  bound kits to 102. The 36 `_Night` variants are *not* duplicates and must stay —
  the VC scout swaps his `mosinSniper` for a plain `mosin` and picks up a `Flare`.

**A kit is only real if a level binds it.** `game.setKit` is the liveness test and
it needs sweeping anyway for the map facet, so filtering on it costs nothing and
removes 10 dead vanilla kits, 7 dead XPack2 kits and 46 dead EoD kits before they
ever reach a UI.

## The mechanism

A `Kit` template `addTemplate`s two kinds of thing: the weapons it carries, and
`KitPart` templates that are its appearance. A `KitPart` has exactly three
properties and has never in the history of the game had a fourth:

```con
ObjectTemplate.create KitPart Medic_helm_us
ObjectTemplate.geometry Medic_helm_us
ObjectTemplate.setBoneName A
ObjectTemplate.setCopyLinksCount 0
```

`Objects/Items/USKit/Common/Objects.con`, vanilla `objects.rfa`. A census of all
66 vanilla `KitPart`s finds those three properties on all 66 and nothing else.

**`setBoneName` is the entire appearance channel.** Across all 16 installed mods
it occurs 1,320 times, only ever on `KitPart` (1,301) and `ActiveKitPart` (19),
and the value is one of exactly three names:

| bone | slot | occurrences |
|---|---|---|
| `A` | headgear | 698 |
| `backpack` | back | 429 |
| `HipPack` | hip | 192 |

Plus one outlier — GCMOD's `ActiveKitPart Sprint2` names a quoted
`"Bip01 R UpperArm"`. That is the whole vocabulary. A closed three-value set
across 5,886 kits is what makes this tractable.

All three are real bones in `animations/UsSoldier.ske`:

```
 13 parent= 12 'Bip01 Spine3'
 15 parent= 14 'Bip01 Neck'
 16 parent= 15 'Bip01 Head'
 17 parent= 16 'A'              <- head attach, local t = (0.123, 0.0254, 0.0049)
 65 parent= 13 'backpack'
 66 parent= 11 'HipPack'
```

Bone `A` is a child of `Bip01 Head`, so anything bound to it rides the animated
head for free. Every vanilla `BFSoldier` — and EoD's Viet Cong, and everyone
else's — declares `createSkeleton animations/UsSoldier.ske`, which is why kits
are interchangeable across nations and mods. (`animations/JapSoldier.ske` exists,
has `Bip01 Head` and no `A`, and is referenced by no template. Dead file.)

`setCopyLinksCount` is inert: 1,319 of 1,320 occurrences are the literal `0` and
the last is the typo `0^`. Ignore it.

### The graft, and the trap it walked into

A KitPart mesh comes out of the exporter **crown up**, centred on its own origin.
That is measurable without looking at it: slice the vertex cloud at both ends of
each axis and compare the spread of the other two. A helmet is a dome, so the
open rim is wide and the crown converges — `Us_Helmet` reads 0.163 at −Y against
0.101 at +Y, and `Jap_Helmet` 0.196 against 0.096. Rim at the bottom, crown at
the top.

The bone it hangs on is a different matter. `Bip01 Head` — and `A`, its
pure-translation child, which inherits its rotation exactly — carries a 3ds Max
Biped frame that runs along the limb and has nothing to do with world up:

```
A / Bip01 Head rest rotation
  [ 0.187  0.097 -0.978 ]
  [ 0.348  0.924  0.158 ]
  [ 0.919 -0.370  0.139 ]
```

A *skinned* mesh never notices, because its inverse-bind matrices cancel that
frame for it. **A rigid graft has no inverse bind**, so parenting a helmet
straight onto the bone hands it the Biped frame raw — 115 to 147 degrees out,
depending on the bone. The graft must supply the inverse bind itself:

```
world = posed(bone) * inverse(world_rest(bone)) * mesh
```

which is rigid skinning to a single bone, and is what the engine does with a
KitPart.

**Where that rotation comes from is the whole lesson.** Computing it in
`extract_kits.py` from `UsSoldier.ske` — transpose the bone's rest rotation, ship
it in the manifest — is the obvious move and it is wrong, by 77 to 95 degrees.
The skeleton file is several conversions upstream of the thing being posed: the
`.ske` is stored mirrored in Z against the `.sm` it drives, `gltf.py` applies the
Refractor-to-glTF mirror on the way out, and `assemble.py` adds `pitch -= 90` to
stand a `BFSoldier` up on +Y. Reproducing that stack by hand is how you land 80
degrees out.

The exported pose glb is the one place where **every** conversion has already
been applied. So the viewer reads the correction straight off the loaded
skeleton — `inverse(bone.getWorldQuaternion())`, captured once per figure — and
measures 0.00 degrees. Three candidates, measured against the standalone part:

| local rotation | head | back | hip |
|---|---|---|---|
| none | 125.5° | 146.9° | 115.5° |
| `inverse(rest)` from `UsSoldier.ske` | 77.7° | 94.9° | 79.3° |
| **`inverse(world(bone))` off the pose glb** | **0°** | **0°** | **0°** |

It is captured with the **standing** clip forced on, never whatever stance the
viewer happens to be in: the value is a property of the bind pose, and taking it
mid-crouch would freeze that crouch's head tilt into the helmet permanently.
Being a *local* rotation it then costs nothing per stance — the bone moves, the
helmet moves.

### Two blind metrics in a row

This is [`weapon-grip.md`](weapon-grip.md)'s fourth trap, hit twice more.

**A distance cannot see a rotation.** The first check here was a gap metric and
it passed everything: 1 cm helmet-to-head-bone, median 8.4 cm across 89 parts,
against a naive ungrafted control of ~1.75 m. All green, every helmet upside
down. A human looking at the screen caught it.

**A dome cannot see a yaw.** The replacement was a rim test — slice the vertex
cloud at both ends of world Y and compare the spread of the other two axes; the
open rim is wide, the crown converges. It correctly caught the inversion (9 of 12
heads flagged without the correction, 0 with it). But a helmet is *rotationally
symmetric about its own axis*, so the rim test is structurally incapable of
seeing a yaw — and the parts were still 90 degrees off. A human caught that one
too.

The check that actually works is Kabsch: recover the rotation that best maps the
standalone part's vertex cloud onto the grafted one, and require it to be the
identity. It is sensitive to yaw, pitch and roll together, it needs no assumption
about the part's shape — so it covers `Us_Glasses` and the 0.6 m `VCCamoHat` bush
as well as it covers a helmet — and it is one number per part:

> **447 of 447 parts** (89 vanilla, 358 EoD), **maximum deviation 0.00°.**

Validate the estimator against a known rotation before trusting it; a recovery
routine that silently returns the identity would report a perfect score. The
version here recovers a 61.44° test rotation to within 0.00°.

The through-line: each metric was fine as far as it went, and each had a
*structural* blind spot that no amount of running it would reveal. Ask what a
measurement cannot see before trusting a green result from it.

### This is the weapon weld again

The pipeline already grafts a foreign template tree onto a named joint of a
posed skeleton: [`extract_pose.py:428`](../../tools/bf1942-models/extract_pose.py:428)
welds a weapon to `Bip01 R Hand` and needs no animation channels, because the
joint is what moves. Headgear at bone `A` is the same operation at a different
joint, and [`weapon-grip.md`](weapon-grip.md) is the prior art for both the
method and its traps.

One difference that simplifies it: **kit headgear is always a `StandardMesh`,
never an `AnimatedMesh`.** The only six `setSkin` calls under vanilla
`Objects/Items/` are flags. Do not look for a `.skn` on a hat.

### The binding chain

Nothing in the object tree says which kit a soldier wears. The level does:

```con
game.setTeamSkin 1 GermanDesertSoldier        # the body, per team
game.setKit      1 0 German_Scout_Desert      # the kit, per team per slot
game.setKit      1 3 German_Medic_Desert
```

`bf1942/Levels/aberdeen/Init.con`. Measured across 1,312 levels that carry a
binding: `game.setKit` 13,874 times, `game.setTeamSkin` 2,665. There is no
`ObjectTemplate.addTeam*` family — the whole chain is level → team → kit →
`KitPart` → bone. Slots 0–4 are near-universal; slot 5 exists and is used by 572
team-entries (bg42 400, DC_Final 96, DesertCombat 70, XPack2 4).

**One soldier per team, enforced by the engine.** Across those 1,312 levels no
level ever binds two skins to one team, and a survey of `create BFSoldier` across
all 16 mods turns up exactly one class-sounding name — GCMOD's `ScoutSoldier`,
which is a Star Wars Scout Trooper, a faction, not a class. So "maybe a mod just
ships a separate VietCongSniper soldier" is false everywhere, and grafting is not
one option among several. It is the only one.

## The medic helmet is real, and it is a texture swap shipped as a duplicate mesh

The premise that started this holds up. `texture/amedhelm_m.dds` carries white
roundels with red crosses; the plain `texture/ahelm_r.dds` is flat olive. But the
geometry underneath is the same helmet:

| pair | verts | indices | max position delta | max UV delta | indices identical |
|---|---|---|---|---|---|
| `Medichelm_ger_m1` vs `Germ_Helmet_m1` | 114 vs 114 | 540 vs 540 | **0.000040 m** | 0.130 | yes |
| `Medichelm_us_m1` vs `US_Helmet_m1` | 128 vs 104 | 504 vs 504 | — (extra UV seam splits) | — | same tri count |
| EoD `VCHat` vs `VCHat_green` | 226 vs 226 | 960 vs 960 | **0.000000** | **0.000000** | yes |

Refractor has no per-instance texture override on a `KitPart` — the shader
binding lives in the `.rs` beside the mesh file — so the only way to ship a
recolour is to ship another mesh. `VCHat`/`VCHat_green` is the pure case:
byte-identical geometry and UVs, two `.sm` files, two `.rs` files, two textures.

**The scout helmet is genuinely different geometry.** `US_ScoutHelm_m1` is 194
triangles across two materials against the plain helmet's 168 across one, and its
bounding box grows from 0.19 x 0.27 x 0.23 m to 0.31 x 0.39 x 0.39 m — the
netting is real added geometry, alpha-tested and two-sided.

### Vanilla, in full

| nation | AT / Assault / Engineer | Medic | Scout |
|---|---|---|---|
| US | `Us_Helmet` → `ahelm_r` | `Medic_helm_us` → `amedhelm_m` | `US_Scout_Helm` → `ahelmscout_o` + `scoutcover01_o` |
| US Marine | `UsMarine_Helmet` → `US_Mar_helm` | `Medic_helm_us` (shared) | `US_Scout_Helm` (shared) |
| British | `brit_Helmet` → `brihelm_r` | `Medic_helm_brit` → `brihelm_med_o` | `brit_Scout_Helm` → `brihelmscout_o` + `scoutcover03_o` |
| German | `German_Helmet` → `ghelm_r` | `Medic_helm_ger` → `ghelm_med_o` | `german_Scout_Helm` → `ghelmscout_o` + `scoutcover04_o` |
| German desert | `Germ_DesertHelmet` → `ghelm_Desert_r` | `Medichelm_Desert_ger` → `ghelm_Desert_med_o` | `Germ_ScoutHelm_Desert` → `ghelmscout_Desert_o` + `Desertscoutleaf_s` |
| Japanese | `Jap_Helmet` → `jhelm_r` | `Medichelm_jap` → `jhelm_med_o` | `Jap_ScoutHelm` → `jhelmscout_o` + `scoutcover02_o` |
| Russian | `Russ_Helmet` → `ruhelm_r` + `Ryssun_r` | `medichelm_Russ` → `ruhelm_med_o` | `Russ_ScoutHelm` → `ruhelm_r` + `scoutcover01_o` |
| **Canadian** | `Canadian_helmet` → `Can_helm` | **`Canadian_helmet`** | **`Canadian_helmet`** |

Canada is the exception, and the liveness test explains it: the only level that
names a Canadian kit overwrites it with the British set in the same file (see
Scope). `Objects/Items/CanadianKit/Medic/Objects.con` declares a
`KitPart Medic_helm_brit` and then never uses it — the kit line reads
`addTemplate Canadian_helmet` — and all five classes wear the same helmet. That
is unfinished content rather than a design choice, and replaying `game.setKit`
the way the engine does removes it before a UI has to explain five identical
Canadians.

So the live vanilla rule is clean with no exceptions: **AT, Assault and Engineer
share the national helmet; Medic and Scout each get their own.** Six nations
across seven wardrobes — Germany fields two, European and Afrika Korps — and all
seven follow it.

`Objects/Items/BaseKit/Objects.con`'s `Kit USKit` / `GerKit` / `BritKit` /
`RussKit` / `JapKit` are dead the same way. They are five of the ten "missing"
kits the current roster regex fails to classify — and they should stay
unclassified, because they are not in the game.

## Eve of Destruction: the Viet Cong

Same mechanism, no extensions. `objects/Soldiers/VietCongSoldier/Objects.con` is
body/head/hands and reuses vanilla's skeleton, so bone `A` is available.

```
objects/Items/VCKit/VC_Scout/Objects.con
    ObjectTemplate.create Kit VC_Scout
    ObjectTemplate.setType Scout
    ObjectTemplate.geometry kit_vc-mosin          <- ground pickup, not worn
    ObjectTemplate.addTemplate VCCamoHat          <- the hat
    ObjectTemplate.addTemplate Jap_Hip_Pack
    ObjectTemplate.addTemplate Radio
        |
objects/Items/BaseKit/Objects.con:313
    ObjectTemplate.create KitPart VCCamoHat
    ObjectTemplate.setBoneName A
        |
standardmesh/VCCamoHat.sm   38 tris LOD0, 2 materials
standardmesh/VCCamoHat.rs   → texture/VCCamo1 (foliage), texture/VCCamo2 (alpha-cut leaves)
```

| VC class | bone-`A` part | mesh | LOD0 tris |
|---|---|---|---|
| Scout / SpecOps | `VCCamoHat` | `VCCamoHat.sm` | 38, 2 materials |
| Engineer / Medic | `VCConeHat` | `VCConeHat.sm` | 12 |
| Rifleman / Assault / AT / GL | `VCHat` + `setRandomGeometries 3` | `VCHat.sm` / `VCHat_green.sm` | 320 |
| Female assault | `VCFSoldierHelmet` | `VCFhelmet.sm` | — |

These are four genuinely different meshes, not recolours. The sniper's "little
hat" is a 38-triangle foliage hat; the engineer and medic get a 12-triangle
conical straw hat; everyone else gets a 320-triangle boonie.

`VC_Rifleman` shows the one wrinkle, and it is a trap with teeth. There is **no**
`KitPart VCHat` — only `VCHat1`, `VCHat2`, `VCHat3`. `setRandomGeometries N` on a
kit child means "pick among `<name>1..<name>N`" and the bare name is deliberately
absent. [`con.py`'s `instance_template_name()`](../../tools/bf1942-models/bf42/con.py:224)
already implements exactly this rule for soldier heads and applies unchanged.

**A naive walk reports these kits as bare-headed.** The first census pass did
exactly that: it put EoD at 208 of 240 kits with headgear, and 26 of the 32
"bare" kits are the `VCHat` roll — `VC_Rifleman`, `VC_Assault`, `VC_AT`,
`VC_Grenadelauncher` and their Night and `_CHUTE` twins. Resolve the roll and the
real figure is 234 of 240. The six genuinely bare-headed kits are `Rambo_*` (bare
by design) and `CivilVC_*` (civilians). So the "kit with no headgear is
legitimate, not an error" rule still holds — it just holds for six kits, not
thirty-two, and the difference is entirely this one property.

Usage: EoD 26, vanilla and both XPacks zero. (FHSW 3,132 and FH 394, which is why
it cannot be skipped even though the first four mods barely need it.)

## Road to Rome and Secret Weapons

Both follow vanilla's rule exactly — national helmet for AT/Assault/Engineer, a
medic helmet, a scout helmet — and neither introduces a single new mechanism. No
`setRandomGeometries`, no container parts, no backslash paths. If the vanilla
extractor works, these work.

**XPack1 (Road to Rome)** adds two nations and three cross-nation engineers:

| kit | headgear |
|---|---|
| `French_AT` / `_Assault` / `_Engineer` | `Fr_helmet` |
| `French_Medic` | `Medic_helm_Fr` |
| `French_Scout` | `Fr_Scout_helm` |
| `Italian_AT` / `_Assault` / `_Engineer` | `It_Helmet` |
| `Italian_Medic` | `Medic_helm_it` |
| `Italian_Scout` | `It_Scout_Helm` |
| `It_GB_Engineer` / `It_German_Engineer` / `It_US_Engineer` | `Brit_helmet` / `German_Helmet` / `Us_Helmet` |

`It_GB_Medic` exists, wears `Medic_helm_brit`, and is bound by no level — the one
dead kit in the pack.

**XPack2 (Secret Weapons)** is the cleanest per-class set in the whole game: two
elite factions, and a distinct head mesh for three of five classes on *both*
sides.

| kit | headgear |
|---|---|
| `Commando_AT` / `_Assault` / `_Engineer` | `BritCommando_Helmet` |
| `Commando_Medic` | `BritCommandoMedic_Helmet` |
| `Commando_Scout` | `BritCommandoScout_Helmet` |
| `GermanElite_AT` / `_Assault` / `_Engineer` | `GermanElite_Helmet` |
| `GermanElite_Medic` | `GermElite_Medic_Helmet` |
| `GermanElite_Scout` | `GermElite_scout_Helmet` |

It also holds the one in-scope `ActiveKitPart` that is both appearance and
behaviour: `GermanElite_JetPack` (`setType RocketPack`) carries
`GermanElite_RocketPack` on the `backpack` bone with
`setActiveAcceleration 0/72/0`. It wears the ordinary `GermanElite_Helmet`, so
nothing about the head changes — but it is the argument for extracting the
`backpack` bone rather than head-only, because a jetpack trooper without the
jetpack is not the kit.

## The extraction rule

```
for each ObjectTemplate of kind Kit:
    for each addTemplate child C:
        if C.setRandomGeometries == N and no template named C exists:
            candidates = [C1 .. CN]              # weighted set; bare name absent by design
        else:
            candidates = [C]
        for P in candidates:
            T = lookup(P)
            if T.kind not in (KitPart, ActiveKitPart): continue      # weapons, ammo, chute flags
            if T.setBoneName is None: continue                       # behaviour-only ActiveKitPart
            slot = {"a": "head", "backpack": "back", "hippack": "hip"}[bone.lower()]
            files = []
            if T.geometry:                        # may be empty -> container
                G = geometryTemplate(strip_type_qualifier(T.geometry))
                files.append(G.file or G.name)
            for child in T.children:              # FH CapHolder pattern
                files.append(geometry of that SimpleObject, offset by child.setPosition)
            for f in files:
                f = f.replace("\\", "/").lstrip("/")     # DC: \DesertCombat\Helmets\X
                mesh   = resolve("standardmesh/" + f + ".sm")
                shader = resolve("standardmesh/" + f + ".rs")   # then Art/<f>.rs override
            place at bone, then apply T.setPosition / T.setRotation
```

Resolution notes that bite:

- **Resolve along the mod chain** (`mod → parents → bf1942`). Name-level override
  is the mod idiom — DC Final's `Medic_helm_us` is a `GeometryTemplate`
  redefinition, not a new template.
- The `Kit`'s own `ObjectTemplate.geometry` is the **dropped-pickup mesh** lying
  on the ground (`Kit_AlliesMedic_m1.sm`, 209 tris, with a `Kits_Shade_H` shadow
  decal). Exclude it from the worn silhouette. It is a fine thing to extract as
  its own browsable object; it is not what the soldier wears.
- `setCopyLinksCount` is noise.

### The one parser change

`bf42/con.py` does not parse `setBoneName` anywhere. `ObjectTemplate` carries
`skeleton` / `skeleton_main` and `ChildRef.skeleton_part` for `bindToSkeletonPart`
([`con.py:704`](../../tools/bf1942-models/bf42/con.py:704), the weapon path), but
nothing reads the KitPart bone. Adding a `bone_name: str | None` populated from
`setBoneName` — accepting an optionally quoted argument, for GCMOD — is the whole
parser change. `setPosition` on a `KitPart` already reads correctly, because it
lands before any `addTemplate` and so binds to the template rather than a child.

## What the roster parser misses today

[`roster.py:78`](../../tools/bf1942-models/bf42/roster.py:78) is the existing kit
awareness, and it is leakier than it looks:

```python
KIT_SOURCE = re.compile(r"objects/items/(\w+?)kit/(\w+)/objects\.con$")
```

It matches **4,324 of 5,886** kit blocks, and `nation_label()` then resolves a
nation for only **2,946**.

| mod | kits | regex match | nation resolved |
|---|---|---|---|
| FHSW | 3,210 | 2,392 | 2,392 |
| FH | 672 | 469 | 469 |
| bf1918 | 465 | 192 | 85 |
| bg42 | 449 | 342 | 223 |
| WarFront | 435 | 373 | 276 |
| EoD | 240 | 232 | 50 |
| FinnWars | 128 | 70 | 35 |
| GCMOD | 43 | 40 | 0 |
| bfheroes | 36 | 0 | 0 |
| Pirates | 15 | 15 | 0 |
| XPack2 | 18 | 11 | 0 |

Three separable causes:

1. The nation segment must *end* in `kit`, so `GerKitdesert/`, `ItaKitdesert/`
   and `GerKitWinter/` never match. **These are the Afrika Korps kits — the ones
   `GermanDesertSoldier` actually wears**, and theatre is already a first-class
   facet.
2. Exactly two path segments are required, so FH/FHSW's unit folders
   (`JapKit/SNLF/1SNLF_OfficerMp18/`, `USKit/Marine/`, `PolKit/RandomArmiaKrajowa/`)
   never match — 40 kits in FH, 242 in FHSW.
3. `NATION_LABELS` has no entry for bf1918's `english`/`serbia`/`austrian`/`turkish`,
   EoD's `nva`/`arvn`/`pathetlaos`, GCMOD's `emp`/`reb`, Pirates' `bp`/`rp`, or
   XPack2's `gerelite`/`commando`.

Two further blind spots, neither of which is a regex problem:

- **1,869 kits — 24% of the corpus — are declared inside level archives**, under
  `bf1942/levels/<Map>/objects/…`, not in `objects.rfa`. FHSW 1,397, bf1918 116,
  FH 100, FHSWEurope 95, FinnWars 87, DC_Final 49.
- **FHSW packs 3,144 of its 3,210 kits** into 23 `!_PACK_<FACTION>/Compressed.con`
  bundles inside `objects.rfa`. `build_library`'s `rem folder =` unpacking is
  required to see them at all.

Only 47 kit references across the whole install dangle after resolving the mod
chain and level-local declarations, so the data is otherwise sound.

## Output shape: a graft, not more files

The pose tree today is **224 `.pose.glb`, 269 MB, 1.18 MB median**, and it is
**83% texture bytes** — `britt1_r.dds` is embedded 28 times, once per British
weapon pair. Four options were weighed against that.

| option | files | size | verdict |
|---|---|---|---|
| (a) one glb per soldier x weapon x kit | 400–1,120 | 480 MB – 1.35 GB | multiplies an already-redundant tree; ~1.2 MB refetch per kit toggle |
| (b) all kit heads as sibling nodes per pose file | 224 | ~400 MB | free toggle, but re-encodes a 35-cell table into a 224-cell one |
| (c) morph targets / `KHR_materials_variants` | — | — | **impossible** |
| (d) **one small glb per headgear, grafted at runtime** | **~35** | **3–9 MB** | **recommended** |

(c) fails twice over. Morph targets are per-vertex deltas over fixed topology, and
a bare head and a helmet have different vertex counts — and `bf42/gltf.py` has no
`targets` support anyway. `KHR_materials_variants` is not in the vendored
GLTFLoader (three.js r169 ships 14 `KHR_*` extensions and that is not one of
them), and it is the wrong tool regardless: a cone hat versus a boonie is
geometry, not a material binding.

(d) wins on five counts, in order of weight:

1. **The precedent exists twice already** — the weapon weld, and the `--cockpit`
   export that already ships "a graft, not a model" in a sibling file keyed by
   node name.
2. **Every soldier's head is a 2-joint skin anchored at `Bip01 Head`** (verified
   across Brit/Ger/Jap/Russ/US), and bone `A` is that head's child. A rigid attach
   introduces error of the same order as the head's own second influence — far
   below the 2–4 cm palm band the weapon weld already ships at.
3. **It stores each fact once.** Appearance is a function of (nation, class).
   Options (a) and (b) re-encode 35 cells into 224 or 1,120.
4. **Stance-free by construction** — the joint carries the clips, the graft
   inherits them, exactly as the weapon does. Parenting rather than welding means
   `advanceStanceBlend()` needs no change at all.
5. **It generalises**, because `backpack` and `hippack` are the same operation at
   two more bones, and the radio on a scout's back is already in the data.

The kit glb's root node carries `extras: { kitPart: "headgear", attachBone: "A" }`,
vertices in the soldier's bind space so the bone's rest transform is the
placement. One trap: GLTFLoader sanitises node names, so `Bip01 Head` arrives
underscored — [`poses.html:429`](../../tools/bf1942-models/viewer/poses.html:429)
already carries that fix and the comment explaining it.

## Manifest: a sibling `kits.json`, not rows in `models.json`

`roster.entry()` flattens kits onto two independent axes and destroys the cross
product. `Bazooka` records `factions: [British, Canadian, Soviet, US, US Marines]`
and `kitClasses: ["Anti-tank"]`, so nothing in `models.json` can answer *what are
the five items in the Soviet Anti-tank kit*. The rows exist inside `add_kits` and
are thrown away at write time. Keeping them is the change that unlocks everything
else.

They must not go into `models.json` either, because five pieces of existing
machinery assume a manifest row is one `.glb` plus one report — `SORTS` reads
`triangles`/`parts`/`dimensions.length`/`hitpoints`, `renderScale` needs
`dimensions.maxExtent`, `showVariant` needs `variant.glb`, `fromHash` would
resolve a name that then fails to load, and `shoot.mjs --thumbs` would shoot
nothing. A kit has none of those and is not one model.

```jsonc
{
  "mod": "bf1942",
  "classes": ["Anti-tank", "Assault", "Engineer", "Medic", "Scout"],
  "kits": [{
    "template": "German_Medic",
    "nation": "German", "class": "Medic", "side": "Axis",
    "soldiers": ["GermanSoldier", "GermanDesertSoldier"],
    "theatres": ["Western Europe", "Eastern Front", "North Africa"],
    "pickup": { "geometry": "Kit_Axis_Medic", "glb": "kits/Kit_Axis_Medic.glb" },
    "worn": [
      { "template": "Medic_helm_ger", "slot": "head", "bone": "A",
        "glb": "kits/Medic_helm_ger.glb" },
      { "template": "Ger_Medic_Bacpac", "slot": "back", "bone": "backpack",
        "glb": null }
    ],
    "items": [
      { "template": "Mp40", "model": "Mp40", "slot": "primary" },
      { "template": "MedPack", "model": "MedPack", "slot": "tool" }
    ]
  }]
}
```

Rules that keep it honest:

- **`items` is in `addTemplate` declaration order**, which is the in-game slot
  order. `slot` is a label, not a sort key. A mod that puts the satchel first is
  showing you what it does.
- **`model` and `glb` are a `models.json` name or `null`.** The viewer never
  guesses; `null` renders as a visible gap.
- **No pose information.** Whether `<Soldier>__<Weapon>.pose.glb` exists is
  already in `poses-matrix.json`; the viewer joins rather than having the
  extractor restate a fact that can go stale.
- **`soldiers` is a list**, because a nation fields more than one.
- **Class names are pass-through.** `KIT_CLASS_LABELS.get(..., .title())` already
  title-cases the unrecognised, so EoD's `Sniper` arrives as `"Sniper"` with no
  code change — and therefore **nothing in the UI may hard-code the five vanilla
  classes.** Every strip, facet and select is built from the data.

## The kit browser

**A separate surface from the pose viewer, answering a different question.**
`poses.html` is about *how a soldier handles a weapon* — the grip, the stance, the
weld onto `Bip01 R Hand`. It exists to be judged on whether the hands look right.
The kit browser is about *what a kit is*: the man as he spawns, dressed, with
everything he carries laid out beside him. One is a rig test; the other is an
equipment catalogue. Sharing a page would make both worse.

So: a third top-level surface, `kits.html`, beside Models / Maps / Poses in the
shell nav. It reuses the viewer's machinery — the same three.js setup, the same
facet rail, the same card grid — but it is its own page with its own manifest and
its own URL space.

### The unit is the kit

161 cards across the four in-scope mods. A card is one kit: nation, class, its
headgear, and its weapons. Not a soldier, and not a weapon — those already have
homes in the armoury.

The soldier underneath is **not** a browsable axis and should not be presented as
one. His head and body never change; the kit is the whole variable. He is a
mannequin, and the only reason his identity matters at all is that a kit is bound
to one nation and that nation's levels set one team skin, so the mannequin is
determined rather than chosen. Where a nation fields more than one body
(`GermanSoldier` / `GermanDesertSoldier`) the theatre picks it, with a quiet
override for anyone who wants to see the Afrika Korps helmet on the European
uniform.

### The card, and the detail view

**Grid card** — the kit's ground-pickup mesh as the thumbnail. This is the right
image and it is free: every kit already declares one (`Kit_Allies_Medic`, 209
triangles with a shadow decal, one per side-and-class in vanilla), it is what the
kit looks like lying on the floor of a map, and it is instantly recognisable to
anyone who has played. Under it: nation, class, weapon count.

**Detail view** — the figure wearing the kit in the stage, and the loadout beside
him:

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ ┌──────────┐ │  German Medic                                            │
│ │ [pickup] │ │                                                          │
│ └──────────┘ │                 ▟▀▙   <- figure, helmet + packs on       │
│              │                ▟███▙                                     │
│ Nation  [▾]  │                 ███                                      │
│ Class   [▾]  │                                                          │
│              ├──────────────────────────────────────────────────────────┤
│ ── WORN ──   │ Drag orbit · Scroll zoom · 1–5 weapon · Esc browse        │
│ head  Medic… ├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ back  Ger_M… │[▤] 1     │[▤] 2     │[▤] 3     │[▤] 4     │[▤] 5         │
│ hip   —      │ Mp40     │ WalterP38│ KnifeAxis│ Grenade… │ MedPack      │
│              │ PRIMARY  │ SIDEARM  │ MELEE    │ GRENADE  │ TOOL         │
│ ── CARRIED ──│ 0.83 m   │ 0.22 m   │ 0.28 m   │ 0.24 m   │ 0.21 m       │
│ ── MAPS ──   └──────────┴──────────┴──────────┴──────────┴──────────────┘
└──────────────┘                                  ^ olive bar = in his hands
```

The weapon rack is the crew console component reused wholesale — `.crew`'s head,
collapse button, collapse memory and horizontally-scrolling row, with only
`.slot` as new CSS. A kit's weapon slots are to infantry what a tank's seats are
to armour: the set of things you switch between while looking at one model. Click
a slot or press `1`–`9` and that weapon goes in his hands.

**`items` is in `addTemplate` declaration order**, which is the in-game slot
order. `slot` is a label, not a sort key.

### Where the pose files come in

Putting a weapon in his hands means loading `<Soldier>__<Weapon>.pose.glb` — the
224 files that already exist — and grafting the kit's worn parts onto the
skeleton's `A`, `backpack` and `HipPack` bones. So the kit browser *consumes* the
pose extraction without being it. If a (soldier, weapon) pair has no pose clip the
slot is disabled with a title saying so; if no weapon in the kit is posed, the
figure falls back to the static armoury soldier and the rack still lists the kit.
A kit is browsable whether or not anyone can be shown holding it.

`poses-matrix.json` already records which pairs resolve, so the page joins rather
than having the extractor restate a fact that can go stale.

### Facets

Mod, nation, class, side, theatre, **carries**, map, extraction health. `carries`
is the one that pays for the exercise — tick `Bazooka` and the rail answers which
nations' Anti-tank kits actually hold one, the question `models.json` structurally
cannot answer today because `roster.entry()` flattens the cross product away.

`#kit:German/Medic[|Mp40][/crouch]` for the hash. Class names are pass-through
from the data, so EoD's extra classes and its `_Night` variants appear with no
code change — **nothing in the UI may hard-code the five vanilla classes.**

### The armoury's existing `kit` facet is broken and should say so

[`index.html:3972`](../../tools/bf1942-models/viewer/index.html:3972) —
`values: entry => entry.kitClasses || []` — today **hides every soldier**. Of 94
manifest entries exactly 26 carry a non-empty `kitClasses` and all 26 are
`category: "handweapon"`; all 8 soldiers are empty. Ticking Kit → Medic returns
MedPack and a Thompson and filters out every medic.

It is not wrong, just badly named: it means *which kit classes carry this weapon*.
Retitle it **Kit class**, and once `kits.html` exists give it a note pointing
there.

### Degradation

The default state is the degraded one, so this matters more than usual. No
`kits.json` — every tree published before this exists — and the nav entry does not
appear at all; the `damage.json` precedent at `index.html:1683` is the pattern,
and the armoury is byte-for-byte what it is today. A kit whose headgear failed to
extract shows a dashed slot reading `not extracted` and a bare-headed figure,
labelled. A medic identical to a rifleman with no explanation is the failure; a
medic labelled *bareheaded* is a working UI telling the truth.

## Verification

Three things are checked, and only the third one earns its keep.

**Placement.** Every worn part a live kit declares must find its bone and land.
89 of 89 vanilla, 358 of 358 EoD. Head parts sit at y = 1.73–1.77 m against a
naive ungrafted y ≈ 0, which is the control that makes the number mean something.

**Orientation — the one that matters.** Recover the rotation between the part
standalone and the part grafted (Kabsch, via the polar decomposition of the
cross-covariance) and require the identity. Shape-independent, so it covers
glasses and foliage hats as well as helmets, and sensitive to yaw, pitch and roll
together — which the two metrics it replaced were not. **447 of 447 parts,
maximum deviation 0.00°.** Validate the estimator against a known rotation first:
it recovers a 61.44° test case to 0.00°, so a green score is not just the routine
returning the identity.

**Textures.** Per-part `texturesMissing` in each `.kit.report.json`, because an
unresolved texture paints a white helmet that is indistinguishable on screen from
a bad graft.

And the standing invariant: **kits must not perturb a byte of
`poses-matrix.json`.** They add files; the 224 pose pairs are not theirs to move.

The checks live in the browser rather than in `bf42/verify.py`, because the thing
being verified is the *graft* — a viewer-side composition of two files — and
`weapon-grip.md`'s third trap is exactly that a viewer-side bind convention can
diverge from what the file says. Checking it anywhere but in the renderer would
be checking the wrong thing.

## How it was built

Scoped to vanilla + EoD. Steps 1 and 2 fixed measured bugs and stand on their
own; 7 is still open.

1. **Fix the kit census** — `KIT_SOURCE` to allow a theatre suffix and a unit
   segment; extend `NATION_LABELS` with EoD's `nva` / `arvn` / `pathetlaos`; add
   `Roster.kits` as a parallel record, leaving `entry()` untouched so the facet
   contract does not change. Prove: **vanilla 45/45 classified, EoD 50 → 240.**
2. **Parse `setBoneName`** — one field on `ObjectTemplate` in `bf42/con.py`,
   accepting a quoted argument. Tests with synthetic libraries, installation-free
   like the rest of `tests/`.
3. **`bf42/kit.py`** — `kit_parts(library, kit) -> list[KitPart]` resolving the
   `setRandomGeometries` roll and the mod chain, and the liveness filter against
   `game.setKit`. Slot from the bone, never from the template name. Prove: **EoD
   234/240 kits resolve headgear**, and the six that do not are `Rambo_*` and
   `CivilVC_*`.
4. **`extract_kits.py`** — one glb per distinct worn geometry (101 across all four
   mods; 50 for vanilla alone), plus `kits.json`. Dedupe by geometry *name*, which
   is safe because a recolour ships as its own `.sm`.
5. **`kits.html`** — kit list, worn rows, weapon rack, stance blend, hash.
   This is where the inverse bind is captured, off the loaded skeleton.
6. **Verification** — placement, then orientation by Kabsch against the
   standalone part, with the estimator itself validated first.
7. **Road to Rome and Secret Weapons** — still open. Should be a re-run rather
   than new code: neither pack uses `setRandomGeometries`, container parts or
   backslash paths. If either needs a code change, step 3 got something wrong.
   Both need their models and poses extracted first; kits alone would give a
   browser with no figure to dress.
8. **Docs** — this file and the README companion table.

## Decisions

Four things that were open and are now settled.

**All three bones in the first cut, not head only.** 101 geometries against 56 —
a few hundred KB more for the complete silhouette. The scout's `Radio` is a back
part and a scout without it is half the kit; XPack2's `GermanElite_JetPack` is
*entirely* a back part. Head-only would ship a jetpack trooper with no jetpack.

**Dedupe worn parts by geometry name.** The medic-vs-rifleman worry does not
apply: Refractor has no per-instance texture override, so a recolour is already a
separate `.sm` with a separate `.rs` (`Medichelm_ger_m1` and `Germ_Helmet_m1` are
different files even though the vertices agree to 0.00004 m). Two kits that must
look different always name different geometries. Name is a sufficient key.

**The ground-pickup mesh is the kit card thumbnail.** 209 triangles, one per
side-and-class, already declared by every kit, and it is what the thing looks like
lying on a map floor. Extract it as part of the kit rather than as a separate
browsable object — it belongs to the kit, not the armoury.

**The soldier is a mannequin, not an axis.** His head and body are constant; the
kit is the whole variable. Theatre picks the body where a nation has more than one
(`GermanSoldier` / `GermanDesertSoldier`), with a quiet override rather than a
prominent selector.

## Still open

- **`_Night` kits in EoD** — 36 of the 102 browsable. They genuinely differ in
  loadout but never in appearance. One card each, or a toggle on the day kit?
  Cards are simpler and honest; a toggle is tidier. Decide when the grid is real
  and 102 cards can be looked at.
- **Whether `kits.html` needs its own thumbnail shoot.** `shoot.mjs --thumbs`
  currently walks `models.json`. Kit pickup meshes would need either a second pass
  or a `--kits` mode.


## Appendix: what the later mods do differently

Out of scope for now. Recorded because these are the assumptions the first four
mods let you get away with, and the interfaces should not be built in a way that
forecloses them.

**Desert Combat / DC Final — override by name.** Neither invents anything; both
reuse vanilla `KitPart` names and redefine the `GeometryTemplate` underneath:

```con
GeometryTemplate.create StandardMesh Medic_helm_us
GeometryTemplate.file \DesertCombat\US_Soldier\US_Helmet    ; the *plain* helmet
```

So **DC Final silently deletes the red-cross medic helmet** — the KitPart still
sits on bone `A`, its geometry is now ordinary desert kevlar. Iraq has zero class
differentiation: all 14 Iraqi kits add the same `German_Helmet` template pointing
at `Iraq_Helmet.sm`. And `GeometryTemplate.file` carries a **Windows backslash
sub-path** — a resolver that only tries `standardmesh/<name>.sm` misses every DC
helmet.

**FH / FHSW — weights and containers.** `setRandomGeometries 8` on `Us_Helmets`
resolves to `Us_Helmets1..8`, which map onto only *two* geometries (`Us_Helmet`
in slots 1,2,5,7; `Us_LuckyHelmet` in 3,4,6,8). The count is a probability
weight, not a variant count. Separately, 26 FH bone-`A` KitParts have an **empty**
`ObjectTemplate.geometry` and delegate to a `SimpleObject` child at an offset:

```con
ObjectTemplate.create KitPart German_Helmets3
ObjectTemplate.geometry
ObjectTemplate.setBoneName A
ObjectTemplate.addTemplate German_CapHolder
ObjectTemplate.setPosition -0.005/0/0
```

That is how FH mixes bare heads and soft caps into a helmet roll. Resolving a
KitPart's mesh needs one extra child hop in these two mods. FH/FHSW also use
bone-relative `setPosition` (FHSW 48, FH 28, DC_Final 3, DC 2) and `setRotation`
(FH 1, FHSW 2); vanilla uses neither.

**bfheroes** abandons the layout entirely — kits live in
`Objects/Kits/<Shop>/<KitName>/` and reference zero KitParts; appearance is the
kit's own `geometry`. **GCMOD** has 43 kits and one headgear part, because Star
Wars armour is baked into the soldier body. A kit with no bone-`A` part is
legitimate and must not be treated as an extraction failure.

**`ActiveKitPart`** (19 across 9 mods) is appearance plus behaviour. Some have no
geometry at all — EoD's `nochute`, FH's `Chutedisabler` — and only set
`OverrideAirMovementInhibitations`. Others are both: XPack2's
`GermanElite_RocketPack` is a backpack mesh with `setActiveAcceleration 0/72/0`,
and bf1918's `GasMask` is a bone-`A` part with behaviour.

### Wardrobes worth getting to eventually

- **Pirates** — the sharpest silhouettes in the install, and the only mod with
  zero pack parts, so every class reads off the head alone. Tricorns, feathered
  hats, bandanas, eyepatches. The engineer is a drunkard in an eyepatch carrying
  a `Tankard`.
- **bf1918** — 54 headgear parts and the widest period range: `Ger_PHaube`
  (Pickelhaube, 17 kits), `Turban` (18), `Tur_Kalpak` (14), `Kuk_Hut` (17),
  `Serb_Hut` (27). Plus four gas-mask `BFSoldier` variants.
- **FHSW** — 65 headgear and 55 pack parts, the largest wardrobe, 2,111 kits
  randomising it. `Brit_helmet` on 180 kits, `Brit_para_beret` on 168,
  `GerOfficerCap` on 149, `Fre_OfficerCap_m1` on 71, `Finnish_Helmet_Skull` on 61.
- **FinnWars** — uniquely granular packs: `pistoolikotelo` (holster, 51 kits),
  `puukon_tuppi` (knife sheath, 37), `kiikarikotelo` (binocular case, 34).
- **interstate** — the only mod where headgear is eyewear: `glasses_black`,
  `glasses_red`, `glasses_purple`, `glasses_yellow`.
