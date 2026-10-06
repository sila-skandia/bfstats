# Three Desert Combat words, read before building

Status: `blastAmmoCount` built (2026-10-06); the stabilization words need
nothing; `hasCollisionPhysics` built for placed statics, vehicles open
(section 3).

Package H of the Desert Combat sweep's word census
(`~/.cache/dc-sweep/reports/adv-conwords.md`, findings CW6, CW7 and CW14).
Each word had two plausible readings that differ in what a player sees, so
each was read in the Linux server (`bf1942_lnxded.static`, symbols) and the
client (`BF1942.exe`) before any code. The engine side is in the ledger:
BOMB-4 (corrected), BOMB-13, CON-15, CON-16, GUN-17 and COL-15..COL-17.

Two console rules the reads turned up apply to every word, not just these:

- **A `set` or `get` prefix names the same word** (CON-15).
  `ObjectTemplate.setBlastAmmoCount` is `blastAmmoCount`;
  `setHasCollisionPhysics` is `hasCollisionPhysics`; `setGeometry` is
  `geometry`. The census's CW1 (`setGeometry` meshes missing on the AH-64,
  Mi-24 and AV-8) rests on this.
- **A `bool` argument is `0` or `1`** (CON-16). The server's libstdc++ reads
  `istream >> bool` as an integer and stores it only when it is 0 or 1;
  anything else sets failbit, and the setter then writes whatever that word's
  static argument held from its last good read in the process. `con.py`'s
  `truthy()` calls every non-zero true, which is wrong for 2 and up. The new
  `con.engine_bool()` is the engine's rule; nothing else was switched to it in
  this package.

## 1. `blastAmmoCount`: a salvo that costs one round (BOMB-13)

CW6 asked whether DC's `setBlastAmmoCount 5` on the A-10's GAU-8 means five
rounds used per pull (the 1,350-round drum lasts 13.5 s) or five projectiles
per pull (five times the damage). **Neither.** The word is a bool at
`FireArmsTemplate+0x348`, the flag BOMB-4 had guessed as `fireAllAtOnce`:

- A FireArms with more than one `addFireArmsPosition` barrel and no
  `asynchronyFire` fires every barrel on a pull and is charged one round per
  barrel (BOMB-1), and on its last rounds fires only as many barrels as it has
  rounds (BOMB-5).
- With `blastAmmoCount` set, that salvo is charged **one** round and always
  fires in full.
- On one barrel, or under `asynchronyFire`, the flag is never consulted.

Desert Combat's `5` (A-10 `A10Guns`, SU-25 `SU-25Guns`, `Minigun`) and `2`
(SA-342 `SA342LFFARFirearms_L/_R`) fail the bool read, and every one sits on a
gun that fires no salvo: the A-10 and SU-25 guns have one barrel ("Tan removed
doublegun"), the Minigun none, the SA-342 rocket pods are `setAsynchronyFire
1`. The comment beside the A-10's line, "to make it look like more is being
fired than really is", describes an intent the engine never carried out. So
the A-10 fires one round a pull, 1,350 pulls to a drum, as before.

The word does matter where it is a 1: the shotguns (XPack2's `Shotgun`, DC's
`Remington` and `Saiga12k`, five or eight pellets for one shell) and 111 of
FHSW's canister and shrapnel shells, 20 to 155 barrels each, which without it
would empty a magazine in a pull. Census: `features/bf1942-engine-reference/surveys/blast_ammo_count.py`.

**Built:**

- `bf42/con.py`: `blast_ammo_count`, both spellings, read with
  `engine_bool` (a refused value leaves it None).
- `bf42/assemble.py`: `blastAmmoCount` in the firing extras.
- `viewer/bomb-release.js` `salvo({blastAmmoCount})`, passed by
  `viewer/gunfire.js` `fireShot`; `viewer/fire-state.js`'s charge already takes
  the count `salvo` returns. `sim/stage.mjs` counts a blast salvo's projectiles
  as its barrels.

**Checked:** `tests/test_bomb_release.py` (BOMB-13 group) drives the real
`gunfire.js`: the Remington's eight-round tube is eight pulls of eight pellets
(without the word, one pull of eight empties it); the last round still fires
all eight; one barrel and the SA-342 pods are unchanged; the A-10's drum is
1,350 pulls of one round, first overheating after 146 and dry in 106.4 s on the
30 Hz tick. `tests/test_dc_engine_reads.py` covers the parse and the export.

**Open:**

- The hand path (`viewer/hand-fire.js`, owned by the hand-weapons package)
  charges `hw.rounds - 1` per pull whatever `salvo` says and gives `gunfire.js`
  no `roundsLeft`. That is right for every shotgun above (they declare the
  word) but wrong for the multi-barrel hand weapons that do not: FH 36, FHSW
  73, bf1918 20, FinnWars 2. `HandFireArms` overrides neither `Fire` nor
  `fireFinished`, so they pay one round per barrel in retail. The fix is two
  lines in `hand-fire.js`: charge the `rounds` argument of `onShot`, and have
  `guns.roundsLeft` answer `hw.rounds` for the hand weapon's group.
- `viewer/replay-hud.js` (owned by the replay session) works out a pull's
  rounds itself and does not know the word.
- No asset job is needed for vanilla or DC to behave: the only DC values are
  refused, and every shotgun already fired one shell a pull through the hand
  path. A model re-extract of the shotguns and FHSW's canister guns carries the
  flag into their glbs (section 4).

## 2. `automaticYaw/PitchStabilization`: stored, never read (GUN-17)

CW7 asked whether DC's Humvee, DPV, BRDM-2, EE-9, M1A1/M-109 MG and MH-53
gunners hold their world heading while the hull turns. **They do not.** Both
binaries parse the two words into the RotationalBundle template (`+0x1a5` and
`+0x1a6` on the server, `+0x255`/`+0x256` on the client) and the server prints
them back in `makeScript`, and that is all: no servo, state, input or network
code reads either byte (the image-wide operand scan is in the ledger row). A
"stabilized" gun is a plain bundle whose angle is relative to its parent, so it
turns with the hull.

**Built:** nothing, on purpose. The viewer's rig already composes a bundle's
angle under its hull (`turret-rig.js`), and the words stay unexported.
`tests/test_dc_engine_reads.py` (`StabilizationTests`) pins that nothing is
exported for them.

## 3. `hasCollisionPhysics`: which hulls the engine tests (COL-15..COL-17)

Being built; see the next commit.

## 4. Asset commands

Being written with section 3.
