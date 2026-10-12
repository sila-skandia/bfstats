# Viewmodel motion audit

Status: built 2026-10-12. `tools/bf1942-models/audit_viewmodel_motion.py`, also
`audit_mod.py --mod <id> --audit animation`. Guard: `tests/test_viewmodel_motion_audit.py`.

## Why

The owner found by hand, on FHSW's Hungary Forest, that the K98's reload spun
the rifle like a clock hand. Nothing we ran could have told us: the rigs were
checked for which clips they carry, never for what the clips do. This plays
every first-person rig offline and measures what a player would see.

## What it does

Each `*.fp.glb` of a tree's `viewmodels/` is read, every baked clip is sampled
at 41 times, and the node chains are multiplied out in Python. The weapon's
body (the longest mesh under the grip wrapper, effects left out), its larger
bound parts and both hands are followed. No browser and no game archives;
FHSW's 707 rigs take about a minute on twenty processes.

The module docstring lists the findings. The two that carry the class the owner
reported:

- `body-turns-in-hands`: a weapon is still against something, a hand that
  carries it or the view while it rests and both hands work on it. The body
  turning more than 60 degrees against both hands and in the rig's space is
  none of those.
- `body-leaves-hands`: the same for distance, 0.20 m, outside a throw (a clip
  that moves the grip wrapper).

Limits are set above the worst value of any vanilla rig, written beside each
constant: in vanilla the weapon is welded to a hand, so the two numbers above
are 0.24 degrees and 0.00 m there.

## The defect it was built on

`extract_viewmodel.weapon_part_locals` wrote a weapon part's transform in the
weapon model's convention (raw, conjugated by the Z mirror). Under the grip
wrapper the weapon hangs from a clip-posed hand through `CLIP_WORLD_YAW`, and a
part has to be the raw transform conjugated by that yaw (`_under_grip`). The
two differ by the X mirror, which reverses a roll about the barrel. FHSW's bolt
rifles carry the whole rifle on a `GUNBODY` bone that the weapon clip
counter-rolls against the right hand (K98BoltOperate.baf: hand 113 degrees,
GUNBODY 112 back); mirrored, the rolls added. Fixed in d758adb2, every rig of
the five trees re-exported in place.

K98 body, bolt and reload, measured on the glb's channels: 178.6 degrees at the
peak in the rig's space and 178.4 against the left hand before; 3.4 and 0.02
after.

## Counts, 2026-10-12

Findings (rigs x clips) before the fix and after, per tree:

| Tree | Rigs | Before | After |
|---|---|---|---|
| bf1942 | 219 | 0 | 0 |
| XPack1 | 147 | 0 | 0 |
| XPack2 | 145 | 27 on 2 weapons | 30 on 2 weapons |
| FH | 211 | 3 on 2 weapons | 3 on 2 weapons |
| FHSW | 707 | 1,298 on 76 weapons | 132 on 36 weapons |

FHSW by finding, before and after: body-turns-in-hands 386 / 21,
body-leaves-hands 276 / 79, body-spins 273 / 3, body-revolves 202 / 0,
bolt-moves-the-rifle 116 / 0, part-leaves-body 24 / 24, body-leaves 20 / 4,
no-return 1 / 1.

## Open, none of it diagnosed

Each is a flag the detector still raises; whether the game's own clip is
authored that way has not been read.

- FHSW `RandomGerSeizedRifle10` (VG-1), prone reload: the body turns 104
  degrees against a left hand that stays put. The K98's signature, one weapon.
- FHSW `HF_S18-*` anti-tank rifles, standing reload: 110 degrees against the
  right hand, 65 in the view. Prone and the `_Lay` forms are at rest (1 degree).
- FHSW rifle grenades (`K98Grenade`, `GarandGrenade`, `No4Grenade`,
  `NagantGrenade*`, `SG44Grenade*`, `HF_35M_riflegrenade`) and `M18_57mm_RLR`,
  reload: the body moves 0.23 to 0.41 m against the nearer hand and 0.6 to
  0.9 m in the view while both hands are off it.
- FHSW `Piat` (`BOMB` ends 1.73 m from the body after a reload),
  `Panzershreck` (rocket travels 0.87 m, returns), FH and FHSW `MillsGrenade`
  (`pigg` ends 0.81 m off after the throw; vanilla's pin does the same at a
  smaller size), `RandomGerHEAT14` (reload ends 128 degrees from its start),
  `FG42` fire (1.24 m of travel against a 1.20 limit), `Katana` swings.
- XPack2 `CommandoKnife` and `EliteKnife`: the thrown knife's fire and reload
  families leave the hands, jump at the start and do not return.
