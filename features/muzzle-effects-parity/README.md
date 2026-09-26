# Muzzle flashes and spent casings from the game's own effect bundles

Owner report (2026-09-26): a retail screenshot of a US M3A1 halftrack gunner on
Wake firing the ring-mounted Browning from third person shows a small
orange/yellow glow puff past the barrel tip, about the size of the gunner's
head, and a little stream of dark brass casings dropping beside the receiver.
The viewer drew a fireball several metres across and no casings, and the flash
on most vehicles "appears to be one we made up".

## The retail mechanism

Nothing about a muzzle is hard-coded. A gun's flash and casings are ordinary
`EffectBundle`s hung on the `FireArms` template in `Objects.rfa`:

```
ObjectTemplate.create FireArms Browning            (Stationary_Weapons/Browning)
ObjectTemplate.addTemplate e_MuzzHeavy
ObjectTemplate.startoneffects 1
ObjectTemplate.setPosition 0/0.1/0.8
ObjectTemplate.addTemplate e_Shell1250mm
ObjectTemplate.startoneffects 1
ObjectTemplate.setPosition 0/0.12/0.16
```

Plane guns name theirs with `ObjectTemplate.visibleBarrelTemplate e_MuzzHeavy`,
stood up under every `addFireArmsPosition` barrel. Both bundles live in
`Objects/Effects/<name>/effects.con`:

```
e_MuzzHeavy     = em_MuzzHeavy + em_1P_MuzzHeavy + em_MuzzHeavy_glow
em_MuzzHeavy       Emitter  timeToLive 0.1, intensity 10, startRotation U(0,180)±,
                            addChild 1, showInThirdPerson 1, lodDistance 500
  fx_MuzzHeavy     Particle geometry MuzzHeavy_m1, timeToLive 0.07,
                            sizeOverTime 0/0.12|100/9.4   (no size, no sizeModifier)
em_MuzzHeavy_glow  Emitter  timeToLive 0.1, relativePositionInDof 0.2,
                            addEmitterSpeed 1, showInThirdPerson 1
  fx_MuzzHeavy_glow Sprite  texture e_fire4, size 0.43, timeToLive N(0.07, 0.07),
                            BMOne, colorRGBAOverTime 255/255/128/255 -> 255/128/0/65
em_1P_MuzzHeavy    Emitter  showInFirstPerson 1  ->  FX_1P_MuzzHeavy sprite 0.4 m

e_shell1250mm   = Em_shell1250mm (placed 0/0.01/-0.264, yaw -10, pitch -5)
                  loadSoundScript ../common/Sounds/shells.ssc
Em_shell1250mm     Emitter  timeToLive 0.1, intensity 10, startRotation 150,
                            positionalSpeedInRight U(0.9,1.1), InUp U(0,0.4)±,
                            InDof U(0,0.5)±, addEmitterSpeed 1, lodDistance 45,
                            showInThirdPerson 1
  Fx_shell1250mm   Particle geometry shell1250mmHI_m1 (8.5 cm), timeToLive 1,
                            size 1.7 (no sizeModifier), gravityModifier 0.5
```

So each round is one flash mesh, one glow sprite and one casing: `intensity 10`
over `timeToLive 0.1` spawns exactly once (EMT-1/2). The flash lives 0.07 s, so
at 10 rounds a second it is lit 70% of the time.

**The size rule is IMP-5** (ledger, verified in `Particle::handleUpdate`): a
mesh particle with no `sizeModifier` draws at its authored size, whatever its
`size` and `sizeOverTime` say. `fx_MuzzHeavy` declares neither `size` nor
`sizeModifier`, only the 0.12 -> 9.4 ramp, so retail draws the 0.63 x 0.63 x
1.76 m `MuzzHeavy_m1` at scale 1, and its `.rs` (`blendDest one` and
`alphaTestRef 0.7`) keeps only the texture's hard core (alpha > 0.7 is 12.5% of
`MuzzHeavy_o` against 19.8% above 0.1). Seen from behind the gunner that is the
star end of the mesh, about 0.3 m of flame, plus the orange glow, whose
`size 0.43` is a half-extent (ledger SPR-7): an 0.86 m quad of a soft 16 px
`e_fire4` whose bright core is about a third of that. Head sized. The casing's `size 1.7` is inert for the same reason: it is 8.5 cm.

### What the viewer did instead

`gun-cycle.js` strobed the emitter nodes the bake parks under each bundle node,
and replayed `sizeOverTime` as node scale for every emitter, mesh or not,
capped at 3. `em_MuzzHeavy` reaches 2.3 in the first 60 Hz frame, so the
halftrack's flash was a 1.9 m star and 5 m of flame. Mesh particles never
moved, so the casing emitter was a mesh parked at the ejection port for 1 s
and no casing ever fell. The exporter also dropped the additive meshes'
`alphaTestRef` ("keeping MASK would kill the flash's soft falloff").

## Survey

`FireArms` + `HandFireArms` templates and the bundles they carry
(`tools/bf1942-models`, a `Counter` over `build_library`):

| | FireArms | with effects | references | distinct bundles |
|---|---|---|---|---|
| bf1942 | 100 | 68 (18 hand, 8 stationary, 17 air, 13 land, 12 sea) | 110 (96 addTemplate, 14 visibleBarrelTemplate) | 16 |
| XPack1 | 119 | 83 | 129 (113 + 16) | 16 |
| XPack2 | 131 | 85 | 133 (115 + 18) | 19 |

Vanilla bundles by use: `e_MuzzHeavy` 25 (every .50/.30 MG, plane guns),
`e_MuzzDefGun` 15 (naval and AT guns), `e_MuzzAAgunB` 9, `e_MuzzGun` 8
(rifles), `e_MuzzSG44` 7, `e_Shell792mm` 7, `e_shell9mm` 7, `e_shell1250mm` 7,
`e_MuzzPanz` 7 (tank guns), `e_Shell792D` 4, `e_MuzzB17` 4 (coaxials, B17
turrets), `e_MuzzThomp` 3, `e_rocketFumeBack` 2, `e_shellM1Garand` 2,
`e_MuzzPriest` 2, `e_MuzzSexton` 1. XPack2 adds `e_MuzzShotgun`,
`e_shell_Shotgun` and `e_MuzzFlakP`.

Mesh flashes whose ramp the viewer replayed but IMP-5 ignores: `em_MuzzHeavy`
and `Em_MuzzB17_flash` (both `0.12 -> 9.4`). The one mesh flash that really
scales is `Em_MuzzAAgunB_mesh` (`size 2`, `sizeModifier 4/4/4`, ramp 0.1 -> 1):
the flak gun's flash grows from 0.8 to 8 times `muzzSG44_m1`.

## The fix

- **Exporter** (`bf42/effects.py effect_names_for_firearms`,
  `extract_effects.py`): every bundle a FireArms carries goes into
  `_shared/effects.glb` with its full emitter specs, and the effect library
  bake carries an additive shader's `alphaTestRef` as `extras.alphaTest`
  (`Assembler.additive_alpha_test`, on only for this bake, so the model and
  level trees are byte-identical and need no re-bake). Nothing else changed:
  the weapon, vehicle and level glbs already hang a node named for each bundle
  at its authored placement.
- **Viewer** (`round-launch.js playMuzzleBundles`, `gun-groups.js`): each
  shot plays the gun's bundles through the particle runtime
  (`effects.js`/`effects-core.js`, the same one that plays impacts) attached
  to that node, with the firer's view (`flashView`) choosing the first- or
  third-person emitters. The parked emitters under a played bundle stay dark.
  IMP-5, CRD sampling, the emitter clock, gravity, the casing's thrown
  velocity and `lodDistance` all come from the existing runtime.
- `addChild 1` (EMT-7, inferred) is honoured: such particles ride the anchor
  (`effects.js #follow`), so a flash stays on a moving barrel.
- `effects.js` honours `extras.alphaTest` on additive mesh particles.
- Cost: a muzzle play is `pooled` (no handle returned); its run, emitter
  slots and clocks go back to `runPool`, and particle records to
  `recordPool` (`spawnParticleInto`). A held trigger allocates nothing per
  round on this path; `tests/test_muzzle_bundles.py` checks the pools reach a
  steady state.
- Fallback: with no library (the model browser) or a gun outside the player's
  scene (the first-person viewmodel draws in its own scene), the baked
  emitters are still strobed, but with IMP-5's rule: a mesh never replays
  `sizeOverTime`.

Who gets it: every group `GunFire` collects in the world scene, which is the
local player's seat guns (first and third person), bot- and remote-crewed
hulls, bots' held weapons (`bot-rounds.js`), and replays (`replay.js`).

## Verified

Wake, `?mod=bf1942`, headless Playwright (Vulkan), before = base commit
`847813b8`, after = this branch, both against the re-extracted library.
Scratchpad images `flash_compare_m3a1left.jpg` (halftrack gunner, 2x crops),
`flash_compare_m3a1.jpg`, `flash_compare_shermanmain.jpg`,
`flash_compare_shermancoaxF.jpg`. The halftrack flash went from roughly four
head-widths of flame to about one head, orange-yellow; casings leave the
receiver to the gun's left and fall.

### Merged with main's sprite fixes (fd3ca777, efcc599c)

`fd3ca777` settled SPR-7..9: sprite `size` is a half-extent (the player draws
sprites at `2 x size`), colour ramps are gamma-space, sprites fall at -9.82.
The muzzle path now goes through that same player, so all three apply to the
glow and the tank flares; the parked fallback in `gun-cycle.js` also draws a
sprite at `2 x size x sizeOverTime` (a mesh stays at its authored size,
IMP-5). `dece98ff`'s derived attach velocity is kept, written into the run's
own array so a pooled muzzle run still allocates nothing. `efcc599c` (retail
LOD chains) shrinks the effect library (vanilla 2,555,528 -> 2,007,540 B); it
was re-extracted with both changes and republished.

## Open

- **Casing sound.** Every `e_shell*` bundle binds `common/Sounds/shells.ssc`
  (12 `patron*.wav` alternates, `randomPlay`, `Volume <- Time`). It is now in
  `effects.sounds.json` but the muzzle plays are `silent`: whether the engine
  sounds a FireArms child bundle on each fire, and how that sits with the
  weapons' own `.ssc` casing layers, is not traced.
- **The first-person hand weapon** keeps the parked emitters: its rig draws
  in the viewmodel scene. A second `EffectPlayer` on that scene would give it
  real casings.
- **`startoneffects`** (1 on the flash, 0 on the coaxial's casings) was not
  traced; every bundle is played on every shot.
- **The coaxial's flash** is authored inside the mantlet: `e_MuzzB17` sits
  1 m ahead of `Coaxial_browning` and `Em_MuzzB17_flash` is
  `relativePositionInDof -1`. The viewer follows the data.
- **Casing roll direction.** `startRotation 150` rolls the emitter frame
  (EMT-3); the casings go to the gun's left. The sign of the roll was not
  checked against a capture.
