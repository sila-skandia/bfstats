# Vehicle rounds hit soldiers

Reported 2026-09-23: "I'm not convinced the AA gun does any damage."

## What was wrong

A round finds what it hits through `WorldCollider.cast`, which holds the
level and the hulls. Soldiers are not in it. So a round fired from any
vehicle or manned gun flew through every man on the map, and could only
hurt one by splash.

The AA shells (`AA_Allies_Projectile`, `Flak38_Projectile`,
`Carrier_AA_Projectile`) are `damageType 4`. That gives them no impact
blast (HP-9d, `effects-core.js` `splashSpec`), and their end-of-fuse burst
is `material2 199`, which the modifier table scores 0 against soldiers. A
direct hit is all they have: 5 x 10 = 50 HP against material 40. Since the
direct hit never registered, an AA gun could not hurt anyone on foot. A
tank's coax and a plane's guns had the same gap for the local player. Bots
got a hitscan cone test from the gun (`ce48782f`) that went around the
problem.

## The fix

`GunFire.bodyCast` (gunfire.js) is an optional soldier test inside `#sweep`.
It is only asked inside the collider's own hit distance, so a wall or
sandbag still stops the round first. The page's `roundBodyCast` (map.html)
tests every on-foot soldier: the bots and the local player. It uses the same
stand-in body the hand weapons use (`BOT_BODY_RADIUS` about
`BOT_BODY_HEIGHT`), and it passes through the firer and the firer's side.
The hit goes through `#impact`'s normal direct-hit formula (material 40,
incidence, falloff), and `applyVehicleHit` hands it to `applyRoundToSoldier`.

The bots' cone test is gone. Their rounds use the same body test, so a bot's
MG round is now a real round with flight time, and it no longer goes through
walls.

## Verified

Kasserine Pass, local player in `flak38_2`, aimed off the barrel at a frozen
enemy bot 110 m upslope: `[bots] local hit bot_0 for 30: 0/30 (killed)
[round flak38_gun_fire_2]`. With a 0.7 m sight-to-barrel miss, the same
rounds flew past him and hit the hillside behind. `python3 -m unittest
discover -s tests` passes.

## Not a bug: the sandbag lip

The flak38's muzzle is 3 m down the barrel (`projectilePosition 0/0/3`). The
pit's sandbags are 3.5 m out and 1.1 m above the pad, so below about 3
degrees of elevation every shell stops on the sandbags 0.5 m past the
muzzle. The gun also cannot depress enough to hit a man on flat ground
nearby. Both come from the level geometry and the gun's limits, not from
this code.
