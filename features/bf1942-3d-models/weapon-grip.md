# Posing a soldier around his weapon

`extract_pose.py` exports any vanilla soldier holding any hand weapon, posed
the way the game poses him — skinned to the shared skeleton, driven by the
game's own animation clips, weapon welded to the hand:

```bash
cd tools/bf1942-models
python3 extract_pose.py BritishSoldier Colt GermanSoldier K98 --out ./viewer/models
python3 extract_pose.py --matrix            # every soldier against every weapon
python3 -m unittest discover -s tests       # 189, installation-independent
```

Each pair becomes `<Soldier>__<Weapon>.pose.glb`: body, one head variant and
both hands as glTF skins over one joint hierarchy, the weapon's full template
tree parented under the `Bip01 R Hand` joint. GPU skinning works — no baked
fallback was needed — and a `.pose.report.json` beside each file carries the
weld metrics.

## The mechanism

Nothing on a weapon template names a pose. Three files that never mention each
other supply it:

- **The state machine names the clip.** `animations/AnimationStates.con`
  declares `Ub_StandAimThompson` longhand and clones everything else through
  `copyState2` includes, substituting the weapon name into the state name and
  the clip paths. The six-argument `copyState` names donors: the K98 has no 3P
  clip set of its own and borrows the No4's, the Panzershreck the Bazooka's,
  the WalterP38 the Colt's. Resolving "the K98 stand pose" must go through
  this replay — the path convention alone dead-ends.
- **Two clips make one pose.** `Lb_Stand` carries `Bip01`, the pelvis and the
  legs; `Ub_StandAim<Weapon>` carries `Bip01 Spine` out to the fingertips.
  Their union covers every bone the soldier skins reference; the `.ske` rest
  fills in only helper bones no clip names.
- **The weld is a bone-name identity.** Every hand-weapon skeleton is rooted
  at a bone literally named `Bip01 R Hand`, exported off the same Max rig, so
  grafting that root onto the soldier's posed hand bone is the whole
  attachment: `weapon_world = posed(Bip01 R Hand) * rest(root)^-1 * rest(main)`
  with `main` resolved the way `ske.py` already does. There is no attach
  command anywhere in `Objects.rfa`.

## The `.baf` layout

`animations.rfa` carries 1,154 clips. Reader in
[`bf42/baf.py`](../../tools/bf1942-models/bf42/baf.py); its docstring is the
byte-level reference. The shape:

```
u32 version (3)   u16 boneCount   per bone: u16 nameLen (incl NUL), name
u32 frameCount    u8 precision    -- fraction bits, positions only
per bone: u16 dataWords, then 7 channels (quat x,y,z,w, pos x,y,z)
  u16 wordCount, then RLE segments: u16 control
    low byte  runLength | 0x80 when the run is a hold (1 value word)
    high byte segment words incl control (redundant)
```

Values are signed 16-bit fixed point. Quaternions are always 1.15; the header
precision applies to positions only — the tell is the 33 clips (dying,
ladders, the parachute) that drop to 14, 12 or 11 to reach offsets past
±1 m while their quaternions still only land at unit norm under /2^15. Run
lengths live in 7 bits, so a constant channel over 231 frames is two holds.
One vanilla file is corrupt (`MedPack/MedPackFire.baf`, a stray leading byte
that folds into version 801) — same class as `GrenadeAllies.ske`.

A `.baf` transform **replaces** the bone's `.ske` local outright — rotation
as a quaternion, translation absolute in parent space. The decode that
survives measurement:

```
quat (x, y, z, w)  ->  matrix of (-x, -y, -z, w)    the conjugate
pos  (x, y, z)     ->  (x, y, z)                    as stored
root track only    ->  left-multiplied by Ry180 = diag(-1, 1, -1)
```

Unlike the `.ske`, the stored values are not Z-mirrored; the one global
transform is a proper 180-degree yaw, and only the root track carries it
because only the root's local is expressed in world space. `baf.ROOT_ALIGN`
holds it; `pose.align_clip_roots` applies it, because the skeleton, not the
clip, knows which bone is root.

## The traps

Four of them, and each passed at least one plausible verification while
wrong. The common thread: **a symmetric standing body absorbs enormous
errors. Fingers, faces and renderers do not.**

### The decode that poses every bone backwards

The first working decode read the quaternion as stored (up to a sign
convention) — which is this format's *inverse*: the stored values follow the
row-vector convention and need conjugating. That decode stood the figure
upright, facing forward, feet within 2.2 cm of the body skin's bind stance —
because a standing leg's local rotations are near identity, where a rotation
and its inverse are indistinguishable. Finger and wrist bones carry large
multi-axis rotations, and under the inverse every bone cluster swings the
wrong way: both hands and the face rendered as shards.

The instrument that catches it is **edge stretch**: a skinned mesh must keep
its triangle edge lengths near rest, so `|posed edge − rest edge|` over every
mesh edge scores a candidate decode without any eyeballing. Median hides it —
most edges live inside one bone cluster and stay rigid under any decode; the
tail is the tear:

| decode | body p95 | right hand p95 | left hand p95 |
|---|---|---|---|
| as stored | 291 mm | 196 mm | 183 mm |
| conjugated | 9 mm | 0.4 mm | 7 mm |

The residual global transform between the conjugate-decoded figure and mesh
space, fitted over the lower-body bone origins against the body skin's own
binds across all 48 signed axis permutations, is the proper rotation
`diag(-1, 1, -1)` at 16 mm rms — the best mirror fits 7x worse, and that
measurement is what pins chirality, because a left-right-mirrored decode also
stands upright and forward and a symmetric uniform hides it until the weapon
lands in the wrong hand.

### Exporter-default bone names collide across rigs

`Brit1Face.skn` weights 39 vertices to `Bone07`, a face bone 10 cm from the
skull. `UsSoldier.ske` also has a `Bone07` — a helper chain hanging off
`Bip01 L Forearm`, half a metre away on a different limb. Both are 3ds Max
default names. Matching skin bones to skeleton bones by name therefore tore
the face off the skull *even in the rest pose*: head-weighted vertices stayed
on the neck while `Bone07..09` vertices flew to the forearm, and the clip
then waved the shards around.

`pose.remap_influences` now demands geometric agreement on top of the name:
walk the matched bone's `.ske` parent chain to the nearest bone that is also
in this skin with a recovered bind, and the bind-to-bind distance must
reproduce the same distance at `.ske` rest. When that neighbour is the direct
parent the distance is the bone's length — invariant across stances, which
makes the check immune to the skins being authored in different poses than
the skeleton, and to the right-hand skins being X-mirrored against it
(distances survive mirrors). A failed bone anchors, and drags every skin bone
whose ancestor path runs through it — the rest of the misnamed chain.
Unrecoverable binds anchor too, which also removed the four zero-weight head
vertices that three.js `normalizeSkinWeights` "repairs" into joint 0,
weight 1.

### three.js does not ignore a skinned node's transform

Recorded precisely because the file was valid the whole time. glTF says a
skinned mesh node's transform MUST be ignored — vertices are already in skin
space — but three.js binds the skeleton with `mesh.matrixWorld` as the bind
matrix and the renderer applies that same matrix again as the model matrix,
so the node's world transform lands on the vertices *before* skinning.
Parenting the skinned meshes under the root that pitches Refractor +Z onto
glTF +Y therefore rotated every vertex 90 degrees out of skin space and
collapsed the figure, while the file measured correct against the spec
formula. The fix: skinned mesh nodes sit at the scene root with no transform,
inherited or otherwise; the joints keep the pitch, and the render is
identical under a spec-exact reader and under three.js.

### The reconstruction test that reports a stance as an error

The natural sanity check — with no animation, skinning must reproduce the
mesh — is right, but only in the right frame. Composing
`skeRest(j) · sknBind(j)^-1` reports ~0.3 m median error for every part
*including the body that renders correctly*, because the `.ske` rest is a
Thompson-holding stance and each part's `.skn` was authored in its own: the
"error" is the stance delta, re-posing the part into the skeleton's stance,
and nothing in the pipeline ever composes those two transforms. The identity
that actually pins the pipeline poses each part at **its own recovered
binds**:

| part (x8 soldiers) | median | worst case |
|---|---|---|
| heads | 0.00 mm | 0.00 mm |
| bodies | 0.00 mm | 17.65 mm (Marine, Canadian) |
| right hands | 0.00 mm | 6.39 mm |
| left hands | 0.00-0.03 mm | 11.70 mm (Russian) |

The worst cases are `refine_binds` recovering a slightly non-rigid
least-squares transform on sparsely-weighted bones, and they bound the GPU
render's deviation from the CPU ground truth, because the glTF inverse bind
matrices come from those same binds.

## Verification

Rendered verification is three.js itself (GLTFLoader + SwiftShader raster),
not only numeric recompute — the third trap above is why the two must both be
checked. A per-vertex probe loads each `.pose.glb`, runs
`applyBoneTransform` over every skinned vertex and compares against a
spec-exact recompute from the file bytes: **worst disagreement 0.0 mm across
every primitive of both test soldiers**, and the rendered figures are intact
from every angle.

The full matrix — `extract_pose.py --matrix` — is 8 soldiers x 28 weapons
with a 3P `StandAim` clip:

- **224/224 pairs resolve.** No errors, no skipped weapons.
- **Right palm to weapon surface: median 2.6 cm, p95 8.1 cm, worst 8.7 cm**
  (the RepairPack, whose skeleton's main bone is the exporter default
  `Object01`). The same measurement with the weapon left at the soldier's
  origin — the number this feature exists to shrink — has median 0.97 m.
- **Left palm lands on the weapon (under 6 cm) exactly where the pose says
  both hands hold it**: Bazooka, Panzershreck, JohnsonLMG, Mp40, Landmine,
  MedPack, Binoculars, and both pistols in their two-handed grip. Rifles at
  `StandAim` are a diagonal ready carry with the left arm down — that is the
  game's third-person stance, not a weld error — so their left palms sit
  0.2 m off, and grenades and knives leave the left hand free entirely.
- **GrenadeAllies attaches at the hand root**: its `.ske` is the one corrupt
  skeleton (version 278), so there is no main-bone offset to apply. Recorded
  in the report as such.

`Ub_StandAim` frame 0 is the stand-ready stance; in game, aiming raises it by
an input-driven blend the browse model does not run. `--state` and `--frame`
select other families and frames when a different still is wanted.
