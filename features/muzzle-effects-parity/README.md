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
- Fallback: with no library (the model browser) or a gun in no scene at all,
  the baked emitters are still strobed, but with IMP-5's rule: a mesh never
  replays `sizeOverTime`.

Who gets it: every group `GunFire` collects in a scene, which is the local
player's seat guns (first and third person), the weapon in his hands (since
2026-10-12, below), bot- and remote-crewed hulls, bots' held weapons
(`bot-rounds.js`), and replays (`replay.js`).

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

- **Casing sound.** Built 2026-10-12, below ("The casing bundle's own
  sound").
- **`startoneffects`** (1 on the flash, 0 on the coaxial's casings) was not
  traced; every bundle is played on every shot.
- **The coaxial's flash** is authored inside the mantlet: `e_MuzzB17` sits
  1 m ahead of `Coaxial_browning` and `Em_MuzzB17_flash` is
  `relativePositionInDof -1`. The viewer follows the data.
- **Casing roll direction.** `startRotation 150` rolls the emitter frame
  (EMT-3); the casings go to the gun's left. The sign of the roll was not
  checked against a capture.

## The weapon in the player's hands (2026-10-12)

Reported from FHSW's M1 Garand on Battle_Of_Foy: the ejected casing "hovers
above the gun for the period of time it would animate, before disappearing.
In retail it flies out of the gun."

That was the fallback above. `playMuzzleBundles` played a bundle only when its
node hung in the player's own scene, and the first-person rig draws in a scene
of its own (`arms-rig.js`), so every bundle on it was refused and the parked
emitters were lit instead: `Em_Shell792mm`'s baked mesh, shown at the eject
port for the particle's one second of life.

What the game does is ledger EMT-12. An emitter under a first-person soldier
is handed the weapon's field of view, and the client gives that angle to the
mesh of every particle it spawns, so a casing is drawn in the pass that draws
the rifle, from its own place in the world. A sprite takes no angle and is
drawn with the world.

Built: `EffectPlayer` keeps one particle group per scene (`#worldOf`). A run
played from a node in another scene parents its mesh particles there, on that
node's layers, with pools of their own; its sprites stay in the world. The
group rides the camera from the simulation to the draw, because the page puts
the weapon's shake on the drawn view alone and the rig hangs off the camera
as drawn: without that the flash sat 5 cm under the muzzle on the frame of
the kick. No page wiring: the replay's first-person rig gets the same.

The flash changed with it. The parked `em_1P_MuzzGun` drew at the mesh's
authored size; as a particle it draws at its `size 0.2` (`sizeModifier 1/1/1`,
EMT-8), a small star on the muzzle where there was a ball of flame 350 px
across.

Checked on FHSW Battle_Of_Foy, Allied assault, headless Chromium (Vulkan),
one shot, the casing sampled every frame:

| | drawn as | 0.25 s | 0.5 s | 0.95 s |
|---|---|---|---|---|
| before | the baked emitter node, 1.01 s | 0.265 m from the port | 0.265 m | 0.265 m |
| after | a particle, 0.98 s | 0.62 m | 1.03 m | 3.03 m, 2.8 m down |

No program is linked on the first shot (40 before and after): the near
pass's lights and fog are the world's, so the pools the level warmed compile
to the same programs. `tests/test_muzzle_bundles.py` pins the scene, the
layers, the flight, the separate pools and the camera carry.

Shared by every hand weapon whose rig carries a casing bundle: 22 / 20 / 22 /
56 / 153 weapon names in the rigs of bf1942 / XPack1 / XPack2 / FH / FHSW.
All 31 bundle names FHSW's rigs use are in its effect library (8 / 8 / 10 /
13 in the other four), so no tree needed re-extracting.

Open: a casing has no collision here or in the data (`Fx_Shell792mm` is a
bare Particle), so it falls through the ground. FHSW rolls the emitter frame
through 300 degrees (`startRotation CRD_UNIFORM/-75/225/0`), so its casings
leave in any direction; that is the data.

## The casing bundle's own sound (2026-10-12)

Every `e_shell*` bundle binds `Common/Sounds/shells.ssc`, and the muzzle
plays were `silent`. The game sounds it: `FireArms::Fire` sends each child
bundle message 0 once a round and a bundle whose `timeToLive` is negative
triggers every patch of its own script on it. Read in the client this time
(ledger SND-34: the child loop at `0x0053dcc7`, `EffectBundle::handleMessage`
`0x00568f70`, the trigger `0x00572800`), since the server builds no sound.
The script is one patch of twelve `patron*.wav` loads at `volume 0.8`,
`randomPlay`, behind `Volume <- Time` at 0.07 s, full to 5 m and gone at
10 m, a 3D voice at the bundle. Nothing in the path tests the camera, so the
shooter hears his own.

Census, the weapons of each mod chain with a sounding child bundle: 26 / 30 /
32 / 153 / 393 in bf1942 / XPack1 / XPack2 / FH / FHSW (16 / 20 / 21 / 117 /
299 of them hand weapons), every one a direct `addTemplate` child with
`timeToLive -1` binding `shells.ssc` and nothing else. No flash bundle loads
a script and no weapon that carries a casing bundle is `asynchronyFire`.

Built: `playMuzzleBundles` calls `EffectPlayer.triggerSound(name, node,
bundle)` for each bundle it would play, library or not, and
`EffectAudio.play` takes the bundle's record as `owner`. The bundle is one
object with one patch and one clock, which every trigger zeroes (SND-33), so
an owner's play triggers the pooled slot its last one took. With a slot a
round the pool's three clocks ran out between their turns and an MG42 at
twenty rounds a second ticked through its burst; on one clock it ticks once,
0.07 s after the last round, and a Browning at ten a second after every
round. An owner with no slot yet waits for the pool to grow instead of
setting a neighbour's clock back. The scratch a play needs is kept on the
bundle's record: a held trigger allocates nothing.

Measured on FHSW Battle_Of_Foy, the M1 Garand in the player's hands, headless
Chromium, every `AudioBufferSourceNode.start` logged, seven rounds 0.2 s
apart:

| | bundle ticks | where | the Fire patch's own casings |
|---|---|---|---|
| before | 0 | | 5, once, 0.8 s after the last round |
| after | 7, one a round on the first frame past the gate | 1.02 m from the ear, gain 0.8 | 5, once, 0.8 s after the last round |

`tests/test_effect_audio.mjs` (ten and twenty rounds a second, two guns, the
10 m ramp) and `tests/test_muzzle_bundles.py` (one trigger a round, at the
bundle, one owner, nothing allocated, with no library and on the
first-person rig).

Open: the pool is three patches of `shells.ssc` for every gun within 10 m of
the ear; a fourth takes the one triggered longest ago. A bot's or a replayed
soldier's gun goes through the same `playMuzzleBundles`, pinned under node
and not measured in the page (twelve bots on Foy fired nothing in the twenty
seconds watched). Whether a bundle also ticks once when its weapon is created
was not read (SND-34).
