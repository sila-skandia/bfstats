# Hand-weapon part placement

**Status:** fixed in the exporter (`bf42/pose.py` `hand_weapon_part`,
`bf42/assemble.py`), the weapon models of all eleven trees re-extracted, and
the baked poses and level pickups patched in place (`patch_weapon_parts.py`).
The rollout record is at the end.

## The report (2026-11-28)

The owner, watching the Secret Weapons recording `5txd9vj8ap` (Hellendoorn):
"they're holding the knife on their sleeve, not in their hand".

## What was wrong

A hand weapon's `.ske` is rooted at `Bip01 R Hand`, and the engine draws each
of its parts at the hand times `rest(root)^-1 . rest(bone)`: the main geometry
at the main bone (`useSkeletonPartAsMain`), a part declared with
`bindToSkeletonPart <bone>` at that bone. A third-person pose welds the weapon
with `pose.weapon_attachment(clip_posed=True)`, which is `W . CLIP_WORLD_YAW`:
the weapon's geometry meets its skeleton through a half turn about Y.

The model exporter placed a bound part at the bone's parsed rest relative to
the main bone (`skeleton.relative`, in the Z-mirror convention `ske.parse`
reads). Against geometry that meets the skeleton through a half turn, that is
the right place mirrored in X. Welding the weapon at the part's own bone gives
the parsed rest conjugated by the X mirror instead (yaw x Z mirror);
`tests/test_weapon_grip.py` holds the identity for the two SW knives and the
Johnson's magazine.

The two differ only for a part off the weapon's YZ plane or turned about an
axis other than X. Most parts are on it (a K98's clip, a Thompson's drum), so
the fault hid. Secret Weapons' `CommandoKnife` and `EliteKnife` are the
extreme case: `Base` (the main bone) sits at the hand's origin, and the whole
blade hangs off `Mag`, 6 cm to the side of it. The blade went to the wrist.

`extract_viewmodel.py` had found the same rule for first-person rigs
(`_under_grip`, FHSW's bolt rifles' GUNBODY roll) and set every bound part
itself, so first person was right all along. It now uses the shared function.

## How it was checked

Right palm to the nearest weapon vertex, standing aim (the pose exporter's
palm, the weapon welded each way; `weld_metrics` measures the main geometry):

| Weapon | Parsed rest (before) | At its own bone (after) |
|---|---|---|
| XPack2 `EliteKnife` (German Elite) | 10.5 cm | 1.1 cm |
| XPack2 `CommandoKnife` (British Commando) | 11.8 cm | 1.3 cm |
| bf1918 `Axe` | 11.4 cm | 3.0 cm |
| FHSWEurope `SG44Grenade` | 7.0 cm | 3.0 cm |
| FHSWEurope `M18_57mm_RLR` | 6.0 cm | 2.0 cm |
| vanilla `KnifeAllies` (single bone, unaffected) | 1.4 cm | 1.4 cm |

Side magazines, in the weapon's own frame (x is across the gun): before, the
Johnson's (+0.089 m) and the FG42's (`Gewehr42`, +0.069 m) stood on one side
and the MP18's (-0.110 m) on the other. After, all three are on the same side
(-0.124, -0.133, -0.145 m), the left, where the real guns carry them.

The live page before the fix (`5txd9vj8ap`, 42 s, the studio probe): the blade
0.121 m from the hand bone at (-0.0256, -0.0034, 0.1183) in the hand's frame,
which is the old weld exactly; the engine's place is (0.0915, 0.0205, 0.0766),
beside vanilla's knife bone at (0.0867, 0.0213, 0.0634).

## Blast radius

Every hand weapon with a bound part off its centre plane, measured as the
largest vertex move of any part (5 mm threshold, `features` scratch survey):
bf1942 15 weapons, XPack1 18, XPack2 21, bf1918 72, DC Final 27, Desert
Combat 26, EoD 27, FH 60, FHSW 201, FHSWEurope 209, GCMOD 15. The biggest:
FHSW's `SG44Grenade` family (2.2 m: the whole rifle hangs off GUNBODY, so it
was mirrored about the main bone), the M18 recoilless rifle (45 cm), the
Johnson's magazine (21 cm), the FG42's (20 cm), the knives (13 cm).

They reach three kinds of published file:

- the weapon models (`<Weapon>.glb`, through the content store), which the
  recipe poses weld at load: re-extracted;
- the baked poses (`<Soldier>__<Weapon>.pose.glb`), which carry their weapon
  inside: patched;
- the level bakes, whose kit pickups carry their weapons: patched.

## `patch_weapon_parts.py`

Brings a glb baked before the fix to the bytes a re-bake would write, without
the re-bake. A bound part's node holds `P . B` (its `.con` placement times the
bone's rest), so it is right-multiplied by `B^-1 . rule(B)`, with `B` read from
the weapon's `.ske` through the mod's templates and the main bone found as the
exporter finds it. That is exact whatever `P` is: a few FHSW and GCMOD
grenades give a bound part a position of its own (FHSW's `MillsGrenadePigg`
at x = -0.266, GCMOD's `FragnadeSimple` at x = 1.0), where conjugating the
whole node would have thrown it up to 2 m. Checked against fresh bakes: the
SW knife models agree to 1e-7, an FHSWEurope `SG44Grenade` pose to 2e-7.

The exporter marks a part it placed by the rule (`extras.handWeaponPart`), and
the patcher marks what it moves, so a second run changes nothing. First-person
rigs are skipped.
