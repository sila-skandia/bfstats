# Control points and spawn points

What Refractor declares, what it draws, and what of that we can rebuild in the
glTF map viewer. Everything below was read off the installed archives under
`~/.wine/drive_c/EA Games/Battlefield 1942` or off the decompiled `BF1942.exe`
(sha256 `60c9452d…cd3699`, the binary `features/bf1942-engine-reference/` is
pinned to). Claims that are inference rather than measurement say so.

Surveyed: every `Conquest/ControlPointTemplates.con`,
`Conquest/SoldierSpawnTemplates.con` and `Conquest/ObjectSpawnTemplates.con` in
all 20 installed mods — **7,853 ControlPoint templates, 41,086 SpawnPoint
templates, 32,139 ObjectSpawner templates**. Vanilla alone is 123 / 943 / 370.

---

## 1. The short answer

| Question | Answer |
|---|---|
| Why does one map show a flapping flag and another show nothing? | Nothing in the engine varies. The flag is two ordinary meshes named by the level's own `ControlPointTemplates.con`. A zone-only control point is one whose author deleted, `rem`-ed out, or blanked those names. |
| Flag pole and flag cloth: one mesh or two? | Two. Pole `flagbase_m1` is a `StandardMesh` on the ControlPoint itself; cloth `flag<nation>_m1` is an `AnimatedMesh` on a child object placed 8.2 m up. |
| Is the cloth animated by bones? | Yes. `animations/flag.ske` — 20 bones, four chains of five — driving `animations/flag.skn` at exactly one bone per vertex, weight 1.0, through `animations/Flag/FlagBlow.baf` (49 frames, looping). Not a shader, not UV scrolling, not vertex morphing. |
| How is the owning team expressed? | A whole-mesh swap (`setTeamGeometry <team> <geometry>`), never a texture swap. Every vanilla flag mesh binds the *same* texture `texture/flags_o.dds`; the nation is baked into each mesh's UVs as a rect of a 2x4 atlas. |
| Do soldier spawn points render anything? | No. Not one of 41,086 `SpawnPoint` templates across all mods carries a `geometry` line, and the engine's `SpawnPoint` template has no geometry command in its property table. |

---

## 2. The data model

### 2.1 Files, and the order the engine runs them

`GameTypes/Conquest.con` is the entry point; each game type has its own copy of
the whole set (`Conquest/`, `Ctf/`, `TDM/`, `SinglePlayer/`, `Coop/`).

```con
rem bf1942/levels/Wake/GameTypes/Conquest.con
Game.setNumberOfTickets 2 100
run Conquest/SpawnpointManagerSettings
run Conquest/SoldierSpawnTemplates
run Conquest/SoldierSpawns
run Conquest/ObjectSpawnTemplates
run Conquest/ControlPointTemplates
if v_arg1 == host
	run Conquest/ObjectSpawns
	run Conquest/ControlPoints
endIf
```

Two structural facts follow:

- **Templates load on every machine; placements only on the host.**
  `ControlPoints.con` and `ObjectSpawns.con` sit inside `if v_arg1 == host`, and
  the file itself repeats the guard. Clients receive the instances over the
  `ControlPointInfo` networkable. For extraction we simply read the host branch;
  `parse_static_objects` already ignores `if`/`endIf`.
- **A level may ship no control points at all.** `Coral_sea` runs
  `Conquest/ControlPointTemplates` and `Conquest/ControlPoints` but ships
  neither file; a missing `run` target is silently a no-op. Coral Sea's Conquest
  mode is a pure ticket-bleed carrier battle with spawn groups bound to the
  carriers.

| File | Declares |
|---|---|
| `Conquest/ControlPointTemplates.con` | `ObjectTemplate.create ControlPoint <name>` — one template per flag, including its geometry |
| `Conquest/ControlPoints.con` | `Object.create <name>` + `Object.absolutePosition` — where each one stands |
| `Conquest/SoldierSpawnTemplates.con` | `ObjectTemplate.create SpawnPoint <name>` — spawn id and spawn group |
| `Conquest/SoldierSpawns.con` | `Object.create` + `absolutePosition` + `rotation` — where a player materialises |
| `Conquest/spawnPointManagerSettings.con` | `spawnPointManager.group N` blocks — which team owns each group and its respawn-screen icon |
| `Conquest/ObjectSpawnTemplates.con` | `ObjectTemplate.create ObjectSpawner <name>` — what vehicle each team gets |
| `Conquest/ObjectSpawns.con` | `Object.create` + position + `Object.setOSId N` — spawner placements, bound to a control point by id |

There is no `SoldierSpawnTemplates.con` outside a game-type folder, and no
separate flag-zone file: the capture zone is the ControlPoint's `radius`.

### 2.2 ControlPoint template properties

The authoritative set is the engine's own serializer block, contiguous in
`.rdata` at `0x008f7c14`–`0x008f7dd0`, plus the descriptor names at
`0x008e8184`–`0x008e891c`. Everything a ControlPoint accepts beyond the generic
`ObjectTemplate` vocabulary is in those two runs.

| Property | Meaning | Visual consequence |
|---|---|---|
| `setControlPointName <key>` | Display/localisation key shown on the HUD and scoreboard (`Landing_Beach`). Distinct from the template name. | HUD only |
| `radius <m>` | Capture sphere radius. Vanilla 5–100; the engine also uses it for "close to flag" tooltips. | **None** — no mesh, no decal. The engine draws nothing for the zone. |
| `team <0\|1\|2>` | Owner at level start. 0 = neutral. | Picks which `setTeamGeometry` entry is live at t=0 |
| `spawnGroupId <n>` | The `SpawnPoint.setGroup` value this flag enables when held | none |
| `secondSpawnGroupId <n>` | A second group enabled with the first (vanilla: `Battle_of_Britain` only, 1 use; 10 across all mods) | none |
| `objectSpawnerId <n>` | The `Object.setOSId` value of the vehicle spawners this flag controls. `-1` = controls none. | none |
| `areaValue <n>` / `areaValueTeam1` / `areaValueTeam2` | Ticket-bleed weight contributed while held. Per-team forms exist in the engine; no installed level uses them. | none |
| `timeToGetControl` / `timeToLoseControl` <s> | Capture and neutralise time. `9999` is the idiom for "uncapturable". | none |
| `disableIfEnemyInsideRadius <0\|1>` | Suppress spawning here while an enemy is in the radius | none |
| `disableWhenLosingControl <0\|1>` | Suppress spawning the moment capture starts | none |
| `loseControlWhenEnemyClose <0\|1>` | Whether an enemy inside the radius alone starts neutralising | none |
| `loseControlWhenNotClose <0\|1>` | Whether the flag decays when its owner leaves | none |
| `unableToChangeTeam <0\|1>` | Permanently locked to `team` (main bases). 30 uses in vanilla, 1,990 across mods. | HUD uses `icon_non_takeable_flag.dds` |
| `onlyTakeableByTeam <n>` | Only this team may ever capture it (Iwo Jima's `Landing_Beach`). Misspelt `onlyTakableByTeam` in 31 EoD templates — the engine ignores those. | none |
| `minNrToTakeControl <n>` | Players needed inside the radius. 347 uses, all mods (EoD, FH). | none |
| `setTeamGeometry <team> <geometry>` | **Geometry shown for that owner.** See §3.3. | **yes** |
| `geometry <name>` | The ControlPoint's own static mesh — the pole. | **yes** |
| `hasCollisionPhysics <0\|1>` | Whether the pole is solid | none visually |
| `networkableInfo ControlPointInfo` | Replication class, declared by the same file's `NetworkableInfo.createNewInfo` header | none |
| `addTemplate <name>` + `setPosition` / `setRotation` | Child object, positioned in the parent's local frame. Always `AnimatedFlag` at `0/8.2/0`. | **yes** |

Mod-only strays seen in the survey and safe to ignore: `isNotSaveable`,
`hasDynamicShadow`, `setName`, `addVehicleType`, and a block of ObjectSpawner
properties pasted into a ControlPoint (`bf1918/dawnVille`, `FH/Karelia`'s
`setObjectTemplate 1 Flag`). One typo worth knowing about because it silently
disables collision: `bf1918/vitry` has `ObjectTemplate.hasCollisi50`.

### 2.3 ControlPoints.con

```con
rem bf1942/levels/Wake/Conquest/ControlPoints.con
if v_arg1 == host
Object.create The_beach
Object.absolutePosition 1144.53/97.6689/715.047
...
endIf
```

Across all mods only five commands appear: `Object.create` (7,631),
`Object.absolutePosition` (7,631), `Object.rotation` (451), `Object.setOSId`
(139, FH only), `Object.setTeam` (138, FH only). `bf42.level.parse_static_objects`
already handles `create` / `absolutePosition` / `rotation` / `setTeam`, so it
reads this file verbatim with no new code.

Positions are Refractor world space: +X east, +Y up, +Z north, origin at a map
corner. The Y is the terrain height at that spot — the flag stands on it, not
above it.

### 2.4 SpawnPoint templates

| Property | Meaning |
|---|---|
| `setSpawnId <n>` | Unique index within the level. Purely an identifier. |
| `setGroup <n>` | The group this point belongs to; matched against a ControlPoint's `spawnGroupId`. |
| `setSpawnPositionOffset x/y/z` | Offset from the placed position. Every observed value is `0/0/0`. |
| `setSpawnRotation y/p/r` | Extra rotation on top of `Object.rotation`. Every observed value is `0/0/0`. |
| `setSpawnPreventionDelay <s>` | Lock-out after use |
| `setSpawnAsParaTroper <0\|1>` | Spawn in mid-air under a chute (Coral Sea, Market Garden) |
| `setEnterOnSpawn` / `setAIEnterOnSpawn <0\|1>` | Drop the player straight into a nearby vehicle seat |

Nothing else, in any mod. **No `geometry`, no `addTemplate`, no mesh of any
kind.** The engine's `SpawnPoint` serializer block (`0x008dc980`–`0x008dca74`)
lists exactly these eight commands and no geometry command.

Placement is `SoldierSpawns.con`:

```con
rem bf1942/levels/Wake/Conquest/SoldierSpawns.con
Object.create alliesSpawnPoint_2
Object.absolutePosition 1358.17/116.098/740.747
Object.rotation 89.856/0/0.0279846
```

`Object.rotation` is `yaw/pitch/roll` in degrees — the direction the player faces
on spawn. 37,713 of 41,210 placements declare one.

### 2.5 Spawn groups

`spawnPointManagerSettings.con` keys groups to teams:

```con
rem bf1942/levels/Wake/Conquest/spawnPointManagerSettings.con
spawnPointManager.group 2
spawnPointManager.groupTeam 2
spawnPointManager.groupIcon test1.tga
```

Commands seen across all mods: `group`, `groupTeam`, `groupIcon`,
`groupStatus`, `groupEnableToChangeTeam`, `EnableToChangeTeam`, `OnlyForHuman`,
`OnlyForAI`. `groupIcon` names a respawn-screen sprite; `test1.tga` / `test2.tga`
are not present in `menu.rfa` at all, so the engine falls back on its built-in
`baseflag_conp_*.dds` set.

**The full binding chain**, verified on Wake:

```
ControlPoint.spawnGroupId 2
    -> spawnPointManager.group 2 / groupTeam 2
    -> SpawnPoint.setGroup 2         (alliesSpawnPoint_1..5)
       -> Object.create alliesSpawnPoint_1 @ 1453.39/116.679/718.81

ControlPoint.objectSpawnerId 2
    -> Object.setOSId 2 in ObjectSpawns.con
       -> ObjectSpawner template -> setObjectTemplate <team> <vehicle>
```

`objectSpawnerId -1` means the flag controls no vehicles (Wake's
`The_Beach`). Wake uses `Object.setOSId` on only 22 of its spawners and leans on
`Object.setteam` instead; El Alamein uses `setOSId` throughout. Both patterns are
normal.

---

## 3. The render model

### 3.1 What a stock control point is

```con
rem bf1942/levels/Wake/Conquest/ControlPointTemplates.con
ObjectTemplate.create ControlPoint The_Airfield
ObjectTemplate.radius 50
ObjectTemplate.team 2
ObjectTemplate.geometry flagbase_m1
ObjectTemplate.hasCollisionPhysics 1
ObjectTemplate.addTemplate AnimatedFlag
ObjectTemplate.setPosition 0/8.2/0
ObjectTemplate.setTeamGeometry 1 flagJp_m1
ObjectTemplate.setTeamGeometry 2 flagus_m1
```

Three objects, all resolvable from `Objects.rfa`:

```con
rem Objects.rfa : Objects/Items/Flag/Geometries.con
GeometryTemplate.create StandardMesh flagbase_m1
GeometryTemplate.file flagbase_m1
GeometryTemplate.setLodDistance 0 0
... 6 LOD distances ...

GeometryTemplate.create AnimatedMesh flagus_m1
GeometryTemplate.setSkin animations/flag.skn
GeometryTemplate.file flagus_m1
```

```con
rem Objects.rfa : Objects/Items/Flag/Objects.con
ObjectTemplate.create AnimatedBundle AnimatedFlag
ObjectTemplate.geometry flagso_m1
ObjectTemplate.createSkeleton animations/flag.ske
ObjectTemplate.setAnimationState FlagBlow
ObjectTemplate.loadSoundScript Sounds/flag.ssc
```

Note `AnimatedFlag`'s own geometry is `flagso_m1` — the Soviet flag. It is a
placeholder: every ControlPoint overrides it through `setTeamGeometry`. Anything
that draws `AnimatedFlag` without applying that override renders a Soviet flag
on Wake. (Measured: `Assembler.export("The_Airfield")` does exactly that today.)

### 3.2 The pole

| | |
|---|---|
| Mesh | `standardMesh.rfa : standardMesh/flagbase_m1.sm` |
| Shader | `standardMesh.rfa : standardMesh/flagbase_m1.rs` -> `texture "texture/flags_o"` |
| Version | 9 |
| LOD0 | 120 vertices, 106 triangles, one material, stride 32 (pos/normal/uv), `primitive 4` (triangle list) |
| LODs | 6, down to 16 vertices / 6 triangles |
| Collision | 1 layer, 9 vertices, 14 faces |
| Bounds | `(-0.29, -0.01, -0.26)` .. `(0.29, 8.52, 0.32)` — an 8.5 m mast |

The pole is a plain rigid `StandardMesh`. It samples the same atlas as the flags
(the grey metal strip down the atlas's right-hand column and the wood/concrete
footing tiles along the bottom), with `V` running to `-1.493` so the pole texture
tiles.

### 3.3 The cloth

| | |
|---|---|
| Meshes | `standardMesh/flagus_m1.sm`, `flagjp_m1.sm`, `flaguk_m1.sm`, `flagge_m1.sm`, `flagso_m1.sm` (all `standardMesh.rfa`), `flagcan_M1.sm` (`StandardMesh_001.rfa`) |
| Shaders | matching `.rs`, all `twosided true`, all `texture "texture/flags_o"` except `flagcan_M1.rs` -> `texture/flags_fc` |
| Skin | `animations.rfa : animations/flag.skn` — 20 vertices, **1 influence each at weight 1.0**, 20 bones |
| Skeleton | `animations.rfa : animations/flag.ske` — 20 bones, `Bone01`..`Bone20` |
| Clips | `animations/Flag/FlagBlow.baf` (49 frames), `FlagBlowIdle.baf` (49), `FlagIdle1.baf` (54), `FlagIdle2.baf` (49) — all version 3, precision 15, 20 tracks |
| LOD0 | 20 vertices, 24 triangles. 5 populated LODs (20/18/16/12/8 verts), 6th empty. |
| Collision | none |
| Sound | `Objects/Items/Flag/Sounds/flag.ssc` -> `HighMed.ssc` -> `Sound/@RTD/flag.wav`, looping, `minDistance 2`, distance-ramped volume out to 15 m |

The rig is a 5 x 4 lattice: four parallel chains of five bones
(`Bone01→02→03→04→05`, `06→07→08→09→10`, `11→…15`, `16→…20`), with each chain's
head parented to the previous chain's head (`Bone01` root, `Bone06` under
`Bone01`, `Bone11` under `Bone06`, `Bone16` under `Bone11`, each about +0.42 m
apart vertically). Links run ~0.55 m along the bone's local X. Every mesh vertex
is pinned rigidly to one bone, so the mesh *is* the lattice: hoist column on
`Bone01/06/11/16`, fly column on `Bone05/10/15/20`.

That settles the mechanism: **the cloth is bone animation, not a shader and not
UV scrolling.** There is no vertex morph track and no scrolling term in the
`.rs`.

The state machine is declared once, globally:

```con
rem animations.rfa : animations/AnimationStatesMisc.con
AnimationStateMachine.createState FlagBlow
AnimationStateMachine.addAnimation animations/Flag/FlagBlow.baf 0.8 c_AsmLooping
AnimationStateMachine.setMorphFactor 3.0
AnimationStateMachine.setUserRandomStartTime true
AnimationStateMachine.addIdle FlagIdle1
AnimationStateMachine.addIdle FlagIdle2
```

`FlagIdle1` / `FlagIdle2` are `c_AsmPlayOnce` with
`addTransitionWhenDone FlagBlow`. `setUserRandomStartTime true` is why no two
flags on a map wave in phase. `animations/MiscAnimationsTweaking.con` re-states
the 0.80 playback speed.

#### The bind-pose trap

**The `.sm` vertex positions are not where the engine draws the cloth.** The
`.skn` rest positions match the `.sm` exactly (all 20, to the millimetre), but
carrying each vertex's bone-local offset through the `.ske` rest pose lands
2.04 m away on average (max 4.10 m), with the X axis reversed — measured both
with and without `ske.parse`'s Z-mirror, which changes nothing here. The
skeleton's rest is simply not the mesh's authored pose, and since the object is
created with `setAnimationState FlagBlow` the engine never draws the rest pose
anyway.

Posed through `FlagBlow` frame 0 the cloth occupies, in the child's local frame:

| | X | Y | Z |
|---|---|---|---|
| Raw `.sm` (what a naive export draws) | -1.02 .. 1.10 | -0.64 .. 1.04 | -0.06 .. 0.72 |
| Skinned, `FlagBlow` frame 0 | 0.02 .. 2.14 | -1.70 .. -0.02 | -0.06 .. 0.72 |

With the child at `0/8.2/0` on an 8.52 m pole, the skinned form puts the hoist
edge on the pole axis (`x ≈ 0.02`) hanging from `y = 8.18` down to `y = 6.50` —
flush under the finial, streaming to one side. The raw form straddles the pole
and pokes 0.72 m above its top. Over the 49 frames the silhouette stays within
`X[-2.14, -0.02] Y[-1.76, -0.02] Z[-0.91, 0.38]` (values with `pose.align_clip_roots`
applied), i.e. the flutter is a few tens of centimetres of Z travel on a fixed
hoist.

`pose.align_clip_roots` yaws the root track 180 degrees, which for this rig only
decides whether the flag streams towards -X or +X. That constant was calibrated
on soldier clips; for a flag either direction is a plausible wind, so it is not
worth resolving.

### 3.4 How team is expressed: one atlas, six UV rects

Every vanilla flag mesh binds `texture/flags_o` — there is no per-team texture
and no material swap. The nation lives in the mesh's UVs.

`texture.rfa : texture/flags_o.dds`, 512x512, laid out 2 columns x 4 rows
(V is stored negative):

| Mesh | Archive | U | V | Slot |
|---|---|---|---|---|
| `flagus_m1` | `standardMesh.rfa` | 0.003 .. 0.425 | -1.000 .. -0.750 | row 0 left — Stars and Stripes |
| `flagjp_m1` | `standardMesh.rfa` | 0.434 .. 0.856 | -1.000 .. -0.750 | row 0 right — Hinomaru |
| `flaguk_m1` | `standardMesh.rfa` | 0.001 .. 0.422 | -0.734 .. -0.484 | row 1 left — Union Flag |
| `flagge_m1` | `standardMesh.rfa` | 0.438 .. 0.859 | -0.734 .. -0.484 | row 1 right — German tricolour with Iron Cross (the censored art) |
| `flagso_m1` | `standardMesh.rfa` | 0.001 .. 0.422 | -0.469 .. -0.219 | row 2 left — Hammer and Sickle |
| `flagcan_M1` | `StandardMesh_001.rfa` | 0.003 .. 0.425 | -1.000 .. -0.750 | same rect, but binds `texture/flags_fc` |
| `flagbase_m1` | `standardMesh.rfa` | 0.012 .. 0.999 | -1.493 .. -0.001 | pole strip + footing tiles |

`texture_001.rfa : texture/flags_fc.dds` is the same layout repainted: Canadian
Red Ensign where `flags_o` has the US flag, and the Kriegsmarine ensign where it
has the German tricolour. That is why `flagcan_M1` can reuse the US rect.

There is **no neutral flag mesh in vanilla**. Vanilla only ever declares
`setTeamGeometry 1 …` and `setTeamGeometry 2 …` — the team-0 slot exists in the
engine (702 mod control points use it, e.g. `bf1918`'s `neutral_flag_m1`) but
DICE left it unset, so a neutral vanilla control point has no team geometry to
show. See open questions.

### 3.5 Which object `setTeamGeometry` addresses

`setTeamGeometry` is a **ControlPoint template property**, not a generic one: in
the engine's serializer it heads the contiguous ControlPoint block at
`0x008f7c14`, immediately above `minNrToTakeControl`, `loseControlWhenNotClose`
and the rest. It is not the "last added child wins" rule that governs
`setPosition`.

What the ControlPoint *does* with the stored name is not settled from the con
files alone. The evidence says it replaces the flag child's geometry, not the
ControlPoint's own:

- In 7,853 templates, the `geometry` value is always a pole or base mesh and the
  `setTeamGeometry` value is always a cloth mesh. The two vocabularies do not
  overlap.
- `setTeamGeometry` never appears before `addTemplate`: 7,741 of 7,741 templates
  that carry both put it after.
- Interstate 82 blanks *both* (`geometry nothing` **and** `setTeamGeometry 1
  nothing`) to hide a control point — pointless if one command replaced the other.
- Battlefield Heroes' `Lunar_Landing_Day2` adds a deliberately invisible child
  (`addTemplate cq_stationary_invisible_moon`) and then gives it three team
  meshes, while keeping a separate visible `geometry ctf_flagbase_moon_m1` base.
- If the parent's own geometry were replaced, a captured flag would lose its
  pole, which is not what the game shows.

**Inference (high confidence, not read from engine code): the ControlPoint swaps
the geometry of its flag child.** A reconstruction should render `geometry` and
the team's `setTeamGeometry` mesh as two separate parts.

55 control points across the mods carry `setTeamGeometry` with no `addTemplate`
at all (FH's `The_Attack_on_Carentan-1944` and `Soletschnogorsk-1941`, FHSW's
`Mountain_King`). Whether those show a flag is the one loose end.

### 3.6 Does the flag rise and fall on capture?

Nothing in any `.con` in any installed mod controls it. The full ControlPoint
property table (§2.2) has no height, offset or animation-state command, and the
binary has no flag-height string anywhere — `0x008d5d88 'disabledFlag: %d'` is a
debug print and the rest of the `flag` strings are HUD icons and CTF radio
messages.

**Conclusion: the raise/lower is engine-internal, driven by capture progress,
with no data representation to extract.** For a static scene it does not exist:
export the flag at its declared `setPosition` height.

### 3.7 What makes a control point invisible

Four distinct mechanisms, all author-side. Counted over 7,853 templates:
33 have neither `geometry` nor `addTemplate`; another 57 have no
`setTeamGeometry`; the rest hide themselves by naming nothing.

**(a) Commented out.** `bf1942/Kasserine_Pass` — the vanilla zone-only map, all
five flags:

```con
rem bf1942/levels/Kasserine_Pass/Conquest/ControlPointTemplates.con
ObjectTemplate.create ControlPoint kasserine
ObjectTemplate.radius 5
ObjectTemplate.team 0
rem ObjectTemplate.geometry flagbase_m1
rem ObjectTemplate.addTemplate AnimatedFlag
rem ObjectTemplate.hasCollisionPhysics 1
rem ObjectTemplate.setTeamGeometry 1 flagge_m1
rem ObjectTemplate.setTeamGeometry 2 flagus_m1
```

Five 5 m radius trigger volumes over Tunisian towns, nothing drawn. (Kasserine's
CTF mode does place real `FlagPole` objects, so the pole art is in the level's
dependency set even though Conquest never shows it.)

**(b) Blank argument.** `FH/Pegasus`, `crashzone` and `pegasus`:

```con
ObjectTemplate.geometry 
ObjectTemplate.setTeamGeometry 1 
ObjectTemplate.setTeamGeometry 2 
```

No `addTemplate` either. Also used by `FH/Eastern_Blitz-1939`,
`FHSW/Battle_of_Biak-1944`, `FHSWEurope/gv_westerplatte-1939` — 59 templates
across the mods.

**(c) A name that resolves to nothing.** `DesertCombat/DC_Sea_Rigs`,
`OilRig1_Control_Room`:

```con
ObjectTemplate.geometry null
ObjectTemplate.hasCollisionPhysics 0
ObjectTemplate.addTemplate AnimatedFlag
ObjectTemplate.setPosition 0.000000/0.000000/0.000000
```

There is no `null` geometry template or `null.sm` anywhere in DC or vanilla, so
the pole vanishes — but the flag child survives, at offset 0, which is how an
indoor control point gets a flag lying at floor level with no mast. 11 templates
use `null` (DC, DC_Final, FinnWars).

**(d) A real but empty mesh.** Interstate 82 ships
`standardmesh/nothing.sm` — 53 bytes, version 10, one LOD with **zero
materials**, registered as `GeometryTemplate.create StandardMesh nothing`. Its
36 control points on `aurora_valley` set `geometry nothing` and
`setTeamGeometry 1 nothing` / `2 nothing`, keeping a valid geometry reference
that draws nothing at all. A reader that treats an unresolvable geometry as an
error must special-case this: it resolves fine, it is just empty.

### 3.8 Control points that are not flags

Vanilla has one: **Midway**'s two open-sea control points use a buoy.

```con
rem bf1942/levels/Midway/Conquest/ControlPointTemplates.con
ObjectTemplate.create ControlPoint North_Midway
ObjectTemplate.radius 100
ObjectTemplate.team 0
ObjectTemplate.geometry cpboj_m1
ObjectTemplate.addTemplate AnimatedFlag
ObjectTemplate.setPosition 0/9.7/-2.399
ObjectTemplate.setRotation 82/0/-10.998
ObjectTemplate.setTeamGeometry 1 flagJp_m1
ObjectTemplate.setTeamGeometry 2 flagUs_m1
```

`cpboj_m1` -> `Objects/MOVE_FILES/CPboj_M1/Geometries.con` ->
`standardMesh.rfa : standardMesh/CPboj_M1.sm`, version 10, 258 vertices, 750
indices, bounds `(-1.18, -1.67, -2.76)` .. `(1.26, 10.93, 1.30)`, shader
`texture "texture/CPboj_s"` (`texture.rfa`). The two are the only vanilla
control points with `setRotation` on the flag child.

Mod authors use anything: `podium` (Interstate 82 deathrace), `24pdr_base` and
`chestbase` (Pirates), `mushroom_m1` (FH Soletschnogorsk), `sculpture_angel_m1`
(WarFront Stalingrad), `bullet_m1` (FHSW Remagen), `ammobox_m1`, `umbrella01`.
These are ordinary object templates from the mod's own `Objects.rfa` and need no
special handling.

---

## 4. Per-level variation (vanilla)

| Level | CPs | with geometry | zone-only | pole mesh | soldier spawns | spawn groups |
|---|---|---|---|---|---|---|
| Aberdeen | 7 | 7 | 0 | `flagbase_m1` | 49 | 7 |
| Battle_of_Britain | 2 | 2 | 0 | `flagbase_m1` | 14 | 2 |
| Battle_of_the_Bulge | 6 | 6 | 0 | `flagbase_m1` | 42 | 6 |
| Battleaxe | 8 | 8 | 0 | `flagbase_m1` | 34 | 10 |
| Berlin | 4 | 4 | 0 | `flagbase_m1` | 28 | 4 |
| Bocage | 6 | 6 | 0 | `flagbase_m1` | 42 | 6 |
| Coral_sea | — | — | — | *no ControlPointTemplates.con at all* | 33 | 72 groups declared |
| El_Alamein | 5 | 5 | 0 | `flagbase_m1` | 30 | 7 |
| Gazala | 6 | 6 | 0 | `flagbase_m1` | 57 | 9 |
| GuadalCanal | 6 | 6 | 0 | `flagbase_m1` | 50 | 8 |
| Invasion_of_the_Philippines | 6 | 6 | 0 | `flagbase_m1` | 30 | 6 |
| Iwo_Jima | 5 | 5 | 0 | `flagbase_m1` | 38 | 5 |
| **Kasserine_Pass** | **5** | **0** | **5** | — | 35 | 6 |
| Kharkov | 5 | 5 | 0 | `flagbase_m1` | 35 | 5 |
| Kursk | 4 | 4 | 0 | `flagbase_m1` | 15 | 4 |
| Liberation_of_Caen | 6 | 6 | 0 | `flagbase_m1` | 30 | 6 |
| Market_Garden | 6 | 6 | 0 | `flagbase_m1` | 55 | 7 |
| **Midway** | **4** | **4** | **0** | `flagbase_m1`, **`cpboj_m1`** | 15 | 2 |
| Omaha_Beach | 3 | 3 | 0 | `flagbase_m1` | 37 | 4 |
| Stalingrad | 5 | 5 | 0 | `flagbase_m1` | 39 | 5 |
| Tobruk | 7 | 7 | 0 | `flagbase_m1` | 60 | 8 |
| Truk | 5 | 5 | 0 | `flagbase_m1` | 28 | 5 |
| Wake | 5 | 5 | 0 | `flagbase_m1` | 17 | 5 |

Flag child height, vanilla: `0/8.2/0` everywhere in Conquest; Wake's CTF
ControlPoints use `0/7.6/0`; Midway's buoys `0/9.7/-2.399`. The CTF `FlagBase`
templates in `Objects.rfa` use `setFlagLocation 0/7.6/0 0/0/0`.

Vanilla `setTeamGeometry` usage: `1 flagge_m1` x87, `2 flagus_m1` x52,
`2 flaguk_m1` x42, `1 flagjp_m1` x31, `2 flagso_m1` x18, `2 flagcan_m1` x6.

---

## 5. Mod coverage

### Desert Combat and DC Final — same objects, repainted atlas

Neither mod ships `Objects/Items/Flag/`, and neither ships any `flag*_m1.sm`.
Both inherit `AnimatedFlag`, `flagbase_m1` and all six cloth meshes from
`Mods/bf1942`. Their templates are byte-for-byte the vanilla shape:

```con
rem DesertCombat: bf1942/levels/DC_Sea_Rigs/Conquest/ControlPointTemplates.con
ObjectTemplate.geometry flagbase_m1
ObjectTemplate.addTemplate AnimatedFlag
ObjectTemplate.setPosition 0.000000/8.200000/0.000000
ObjectTemplate.setTeamGeometry 1 flagge_m1
ObjectTemplate.setTeamGeometry 2 flagus_m1
```

`flagge_m1` on a modern-Iraq map is not a mistake. DesertCombat overrides
`TEXTURE.rfa : TEXTURE/flags_o.dds` with its own 512x512 atlas in the same
layout: US in the US and UK slots, the Iraqi flag in the Japanese, German and
Soviet slots. **The mesh names never change; only the pixels do.** DC_Final
overrides nothing at all and inherits DesertCombat's.

Practical consequence: resolve `texture/flags_o` through the mod's search path
(`ArchivePool` already does) and DC renders correctly with zero special-casing.

### Forgotten Hope — its own copy of everything, plus theatre swaps

FH re-declares the whole `objects/Items/Flag/` folder and adds nations:
`flagit_m1`, `flagfr_m1`, `flagPo_m1` geometry templates and matching
`AnimatedItFlag` / `AnimatedFrFlag` / `AnimatedPolFlag` bundles, plus alternative
poles `flagbase2_m1` .. `flagbase5_m1`, `flagbaseAllieds_m1`, `flagbaseAxis_m1`,
`flagaxis_m1`. `flagbase2_m1` and `flagbase3_m1` carry three materials each
(`texture/flags_o`, `texture/flagPole2|3`, `texture/mineSignal2`).

FH's own flags break the one-atlas rule selectively: `flagit_m1` binds
`texture/flags_o_FH`, `flagfr_m1` binds `texture/Frflag_a`, `flagPo_m1` binds
`texture/Poflag_a`. The rest still bind `texture/flags_o`.

**The gotcha.** FH ships nine variants of `texture/flags_o.dds` in
`texture.rfa` — `texture/GENERAL_FRENCH/flags_o.dds`,
`GENERAL_ITALY/`, `GENERAL_POL/`, `GENERAL_AUS/`, `GENERAL_Canadian/`,
`GENERAL_FIN/`, `GENERAL_ITALY_EUROPE/`, `ENVIROMENT_NIGHT/` — selected by the
level's `Init.con`:

```con
textureManager.alternativePath Texture/GENERAL_FRENCH
```

That is the same mechanism `ArchivePool.set_alternative_paths` already
implements for vehicle skins, and `extract_map.py` already wires up from
`info.texture_alternative_path`. It resolves for flags for free. Note FH also
writes backslashes in some levels (`Texture\GENERAL_GER`), which the pool
normalises.

### Other mods, for awareness

| Mod | Divergence |
|---|---|
| FHSW / FHSWEurope | FH's set plus `flagita_m1`; per-CP `setMinimapIcon` / `setControlPointIcon` / `setTicketIcon` / `setTeamFlagIcon` on three `203_Hill-1904` templates |
| Battlefield Heroes | Wholly its own: `flagpole_m1` poles and `flag_neutral_m1` / `flag_na_m1` / `flag_ra_m1` cloths; uses all three team slots; `addTemplate s_flag_na_start` effect children |
| BF1918 | Heaviest team-0 user (553 `setTeamGeometry 0 neutral_flag_m1`); adds `ballonflag_neu` control points |
| FinnWars | Its own `flagpole_1ppl` / `_2ppl` / `_3ppl` poles (368 uses) |
| Interstate 82 | `nothing.sm` — the empty-mesh trick (§3.7d) |
| EoD | Vanilla assets throughout; 347 `minNrToTakeControl`; 31 misspelt `onlyTakableByTeam` |
| Pirates, GC, WarFront, bg42 | Vanilla `flagbase_m1` + `AnimatedFlag`, own atlases/nations |

---

## 6. Asset inventory

| Asset | Exact archive path (vanilla) |
|---|---|
| Flag object definitions | `Mods/bf1942/Archives/Objects.rfa : Objects/Items/Flag/Objects.con` |
| Flag geometry templates | `…Objects.rfa : Objects/Items/Flag/Geometries.con` |
| Flag networkable | `…Objects.rfa : Objects/Items/Flag/Network.con` |
| Flag sound script | `…Objects.rfa : Objects/Items/Flag/Sounds/flag.ssc`, `HighMed.ssc` |
| Pole mesh / shader | `standardMesh.rfa : standardMesh/flagbase_m1.sm` / `.rs` |
| Cloth meshes / shaders | `standardMesh.rfa : standardMesh/flag{us,jp,uk,ge,so}_m1.sm` / `.rs` |
| Canadian cloth | `StandardMesh_001.rfa : StandardMesh/flagcan_M1.sm` / `.rs` |
| Buoy | `standardMesh.rfa : standardMesh/CPboj_M1.sm` / `.rs`; template `Objects.rfa : Objects/MOVE_FILES/CPboj_M1/` |
| Skin | `animations.rfa : animations/flag.skn` |
| Skeleton | `animations.rfa : animations/flag.ske` |
| Clips | `animations.rfa : animations/Flag/FlagBlow.baf`, `FlagBlowIdle.baf`, `FlagIdle1.baf`, `FlagIdle2.baf` |
| Animation state machine | `animations.rfa : animations/AnimationStatesMisc.con`, `animations/MiscAnimationsTweaking.con` |
| Flag atlas | `texture.rfa : texture/flags_o.dds` (512x512) |
| Alt atlas (Canada / Kriegsmarine) | `texture_001.rfa : texture/flags_fc.dds` (512x512) |
| Buoy texture | `texture.rfa : texture/CPboj_s.dds` (256x256) |
| CTF flag meshes | `standardMesh.rfa : standardMesh/flag_ctf_{USA,Brit,Ger,Jap,Rus}.sm` |
| HUD icons (not world geometry) | `menu.rfa : menu/Texture/baseflag_conp_{us,brit,ger,jp,rus,can}.dds`, `icon_flag_*.dds`, `icon_non_takeable_flag.dds`, `flag_ticket_*.dds` |

Mod paths mirror these under `Mods/<Mod>/Archives/` with the same names; FH adds
`standardmesh/flagbase{2..5}_m1`, `flagbase{Allieds,Axis}_m1`, `flagaxis_m1`,
`flag{it,fr,Po}_m1` and the `texture/GENERAL_*/flags_o.dds` variants.

---

## 7. Feasibility

The verdicts below were established by running the existing library, not by
reading it. The load-bearing experiment: feed a level's
`Conquest/ControlPointTemplates.con` straight into the `ObjectLibrary` and ask
the `Assembler` for a node.

```python
library.add_con("bf1942/levels/Wake/Conquest/ControlPointTemplates.con", cpt_text)
glb, report = assembler.export("The_Airfield")
# -> 112,296 bytes, parts=2, triangles=130, missingMeshes=None, unresolvedTemplates=[]
# -> nodes: The_Airfield(mesh flagbase_m1), AnimatedFlag @ [0, 8.2, -0] (mesh flagso_m1)
```

| Element | Verdict | How |
|---|---|---|
| **Flag pole mesh** | **Works today, no new code.** | `library.add_con(...)` the level's `ControlPointTemplates.con`, then `Assembler.build_node(builder, "<CP template>", report, position=inst.position, rotation=inst.rotation)`. Resolves `flagbase_m1` -> `.sm` -> `.rs` -> `texture/flags_o` with 6 LODs and collision, zero missing assets. |
| **Control point placements** | **Works today, no new code.** | `bf42.level.parse_static_objects(files.read("Conquest/ControlPoints.con"))` — the file uses only `Object.create` / `absolutePosition` / `rotation` / `setTeam`, all already handled. Verified on Wake (5), Berlin (4), El Alamein (5), Midway (4), Kasserine (5). |
| **Flag cloth geometry** | **Works today** (it exports), **but wrong on two counts without new code.** | (1) `setTeamGeometry` is not parsed by `bf42/con.py`, so every flag comes out as `AnimatedFlag`'s placeholder `flagso_m1`. Fix: parse `setteamgeometry` into `ObjectTemplate` (about 5 lines beside the existing `geometry` branch at `con.py:495`) and override the child geometry for the chosen team. (2) It is drawn at raw `.sm` positions, ~2 m from where the engine draws it. |
| **Flag cloth pose** | **Needs new code, but only glue.** | `pose.skinned_positions(skin, pose.worlds_by_name(ske_obj, pose.posed_worlds(ske_obj, baf_clip.local_pose(0))))` with `animations/flag.skn`, `animations/flag.ske`, `animations/Flag/FlagBlow.baf`. Every one of those functions exists and was exercised for this document. Bake one frame into the glTF primitive; the whole clip (49 frames x 20 bones) is also cheap enough to export as a glTF animation if the viewer wants it waving. |
| **Team texture** | **Works today, no new code.** | Nothing to do beyond picking the right mesh — the atlas resolves through the normal `ArchivePool` path, including DC's override and FH's `textureManager.alternativePath` variants (already wired via `info.texture_alternative_path` in `extract_map.py`). |
| **Capture radius zone** | **Needs new code; trivial.** | No engine geometry exists. Emit `radius` (and `team`, `areaValue`, `unableToChangeTeam`) into `scene.json` extras and let the viewer draw a ring or dome. Values range 5–100 m in vanilla. |
| **Soldier spawn points** | **Data works today; no geometry exists to extract.** | `parse_static_objects(files.read("Conquest/SoldierSpawns.con"))` gives position and `yaw/pitch/roll` directly; `SoldierSpawnTemplates.con` needs an ~8-line parser for `setSpawnId` / `setGroup`. There is nothing to render — surface them as markers keyed to their group's `groupTeam`. |
| **Object spawners** | **Already in the pipeline.** | `parse_spawn_templates` + `spawn_vehicle` + `info.spawn_objects`; `extract_map.py:934` already places them under a `spawners` node. Only the `objectSpawnerId` -> `Object.setOSId` link back to a control point is unexported, and that is one extra field. |
| **Flag raise/lower on capture** | **Not feasible, and nothing is lost.** | Engine-internal, no data representation anywhere in the con files or the binary's string table. A static scene shows the flag at its declared height. |
| **Zone-only control points** | **Needs new code; trivial.** | Treat a control point as invisible when it has no `geometry` **and** no `addTemplate`, when either argument is empty or unresolvable (`null`), or when the resolved mesh has zero materials in LOD0 (`nothing.sm`). All four must be handled or Kasserine Pass, FH Pegasus, DC Sea Rigs and Interstate 82 each fail differently. |

### Suggested shape

A `parse_control_points(files)` in `bf42/level.py` returning
`list[ControlPoint]` with `template`, `display_name`, `position`, `rotation`,
`team`, `radius`, `area_value`, `spawn_group_id`, `second_spawn_group_id`,
`object_spawner_id`, `unable_to_change_team`, `only_takeable_by_team`,
`geometry`, `team_geometry: dict[int, str]`, `flag_child`, `flag_offset`,
`flag_rotation` — plus `parse_soldier_spawns(files)` returning position,
rotation, spawn id and group, and `parse_spawn_groups(files)` for the
`spawnPointManager` group/team map. `build_scene` then places each control point
through the existing `_place_template` path and appends the non-geometric fields
to `scene.json` extras.

`scripts/extract_map_dossiers.py:708` already has a 2D `parse_control_points`
for the stats site. It reads `team` off the template and `absolutePosition` off
the placement and ignores everything else; it is not a starting point for the 3D
case, but the two should agree on names so a dossier and a scene can be joined.

---

## 8. Reproduce

```bash
cd tools/bf1942-models
python3 - <<'PY'
import sys; from pathlib import Path
sys.path.insert(0, "."); sys.path.insert(0, str(Path.home()/".claude/skills/bf1942-map-images/scripts"))
from bf42.level import find_level_archives, load_level_files, parse_static_objects
G = Path.home()/".wine/drive_c/EA Games/Battlefield 1942"
f = load_level_files(find_level_archives(G, "bf1942", "Wake", chain=[G/"Mods/bf1942"]), "Wake")
print(f.read("Conquest/ControlPointTemplates.con").decode("latin-1"))
print([(i.template, i.position) for i in parse_static_objects(
    f.read("Conquest/ControlPoints.con").decode("latin-1"))])
PY
```

The flag pose measurement:

```bash
python3 - <<'PY'
import sys; from pathlib import Path
sys.path.insert(0, "."); sys.path.insert(0, str(Path.home()/".claude/skills/bf1942-map-images/scripts"))
from bf42.rfa import RfaArchive
from bf42 import ske, baf, skin, pose
a = RfaArchive(Path.home()/".wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/animations.rfa")
sk, sn = ske.parse(a.read("animations/flag.ske")), skin.parse(a.read("animations/flag.skn"))
clip = baf.parse(a.read("animations/Flag/FlagBlow.baf"))
pts = pose.skinned_positions(sn, pose.worlds_by_name(sk, pose.posed_worlds(sk, clip.local_pose(0))))
print("X", min(p[0] for p in pts), max(p[0] for p in pts))
print("Y", min(p[1] for p in pts), max(p[1] for p in pts))
PY
```

The mod surveys behind §4 and §5 were one-off scripts over
`find_levels_dir(find_archives_dir(mod_dir))`, counting
`ObjectTemplate.create ControlPoint` blocks and their properties; they are cheap
to rewrite and were not kept.

---

## 9. Open questions

1. **Does `setTeamGeometry` replace the flag child's geometry or the
   ControlPoint's own?** §3.5 gives five independent data arguments for the
   child, and none for the parent, but no engine code was read. Settling it
   means creating a function over the undefined region around `0x00545900`
   (the ControlPoint serializer) to recover the field offsets, then finding the
   reader. Worth doing only if a rebuilt flag looks wrong.

2. **What does vanilla draw for a neutral (`team 0`) control point?** El
   Alamein, Midway and Iwo Jima all start flags at `team 0` and declare team
   geometry only for 1 and 2. Either the flag child is hidden until capture, or
   it falls back to `AnimatedFlag`'s own `flagso_m1` — which would be a Soviet
   flag on Midway, so almost certainly hidden. Mods that care set
   `setTeamGeometry 0` explicitly (702 templates). Recommend rendering neutral
   as pole-only.

3. **The 55 mod control points with `setTeamGeometry` and no `addTemplate`** —
   FH's `The_Attack_on_Carentan-1944`, `Soletschnogorsk-1941`, FHSW's
   `Mountain_King`. If the engine creates its own flag object, they show one; if
   `setTeamGeometry` only retargets an existing child, they do not. Same
   experiment as (1).

4. **Which way the flag streams.** `pose.align_clip_roots` applies a 180-degree
   yaw calibrated on soldier clips; applied to `FlagBlow` it flips the fly edge
   from +X to -X. Both are physically plausible and the pole is near-symmetric,
   so this only matters if flags on one map must all agree with a screenshot.

5. **`Object.geometry.scale`** appears eight times on placed `SpawnPoint`
   objects in `FHSW/Cebu-1945` at `2.01e-07` — scaling something invisible to
   nothing. Harmless, but it means `Object.geometry.<sub>` commands exist in the
   placement grammar and `parse_static_objects` silently drops them.

6. **Nothing found here was written back to
   `features/bf1942-engine-reference/symbols.json` or `ledger.md`**, because
   this was a read-only pass. The ControlPoint serializer block
   (`0x008f7c14`–`0x008f7dd0`) and the SpawnPoint block
   (`0x008dc980`–`0x008dca74`) are both clean, verifiable symbols and should be
   recorded there when someone next has the binary open.
