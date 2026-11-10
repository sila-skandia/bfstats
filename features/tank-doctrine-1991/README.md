# Tank doctrine, 1991: the Gulf War's rules in the tank school

Status: **built** (2026-11-10). On a Desert Combat arena the tank school's
MATCHUP board has a sixth card, **06 The rules of 1991**: twelve rules from
the US Army's manuals of the 1980s, the Soviet manuals behind the Iraqi
defence and the reports written after the war, each in our words with a few
of its own, its source, and what Desert Combat's own data says of it on the
pairing on screen. The card opens with the 2nd Armored Cavalry at the
73 Easting on 26 February 1991, and a button that stages it (M1A1 against
T-72). The same change gave Desert Combat tank arenas of its own.

The owner's brief (2026-11-10): "do what we've been doing with the other
mods like BF1918, where we research tank and dogfights relevant to that
theatre, e.g. modern theatre." BF1918's card is
[tank-doctrine-1918](../tank-doctrine-1918/README.md); the jets' is
[dogfight-doctrine-1991](../dogfight-doctrine-1991/README.md). The research
behind this page, with its 35 sources, is [research.md](research.md).

## Where it is

- `tanks.html?mod=desertcombat` opens on **Battle of 73 Easting**, M1A1
  against T-72; card 06 is at the foot of the board and the link under the
  headline jumps to it. On any other Desert Combat arena the card reads the
  pairing on screen, and "Fight it" goes to the 73 Easting.
- `viewer/tank-doctrine-1991.js` (pure): `RULES`, each with its source and a
  `check(ctx)` verdict (`holds`, `differs`, `partly`, `not here`),
  `rulesOn(ctx)`, `FIGHT` (the story and `duel()`), `CARD` (the card's words
  and what the page prices for it), `threats`, `weaponWords`, `vehicleWords`.
- `viewer/tank-school-page.js`: the card is a pack per war (`DOCTRINES`:
  BF1918's module and this one give the same exports). For this war the
  context also carries their side's aircraft and missile carriers on the
  arena's battles, each weapon priced on your hull (`armsOfSide`,
  `tank-launchers.js` `armsOf`), your own hull's automatic gun on theirs
  (`ownMg`), and what each gun fires: its round, how long the round lives,
  its magazine.
- Tests: `tests/test_tank_school.py` `Doctrine1991Tests` (through
  `tank_school_harness.mjs`).

## The rules, and what Desert Combat says

Verdicts as the page reads them on the Battle of 73 Easting, your M1A1
against their T-72 (headless Chrome over the published tree, 2026-11-10).

| # | Rule (source) | Verdict | Desert Combat's numbers |
|---|---|---|---|
| 1 | See first, shoot first (FM 71-1, 1988, p. 1-5) | **the game differs** | No thermal sight: both crews see as far as the level's fog. With equal sight it is who lays first: each gun needs 3 hits and 4 s of loading after the first. IDA's replay with equal sights went two to one against the M1A1s |
| 2 | Kill the most dangerous first (ARI 84-11, 1984, p. 14) | holds | By the hits each needs on an M1A1: Su-25's bombs 1, BRDM-2's AT-5 2, Mi-24's AT-2 2, T-72's gun 3, RPG-7 3, Su-25's 30 mm 7; the T-72's machine gun 201 |
| 3 | Sabot for tanks, HEAT for the rest (ARI 1532, 1989, pp. 38, 54) | **the game differs** | A tank carries one round: the M1A1 a sabot that bursts 3 m wide, the T-72 a shell that bursts 5 m. No HEAT to change to. A Bradley does carry two answers (TOW 2 hits on a T-72, its 25 mm 67): for it the rule holds |
| 4 | Lase if you can, battlesight if you cannot (ARI 1532, p. 53) | **the game differs** | The dart leaves at 250 m/s, not 1,600: 0.8 s to 200 m and 3.6 m of drop there, 39 m at 600 m. No one setting covers it. It lives 4 s, 1,000 m: the manual's 1,200 m battlesight is out of reach |
| 5 | Shoot on the move (ARI 1532, p. 57; FM 17-12 of 1943 said stop) | **the game differs** | Nothing stabilises a gun: the hull's speed rides on the shell. Crossing at 14.8 m/s a shot lands 12 m off at 200 m; at Eagle 66's 20 mph, 7 m. The M1A1 is the steadier hull: stopped hard it swings 0.6 deg and is still in 2.2 s, the T-72 1.3 deg and 2.7 s |
| 6 | Hull-down to shoot; a berm is not armour (FM 17-15, figure 4-5) | in part | Shells stop on the ground, so hull-down is real. So do darts: a sand berm here is armour, which in 1991 it was not |
| 7 | Never alone: the wingman (FM 17-15, chapters 1 and 3) | in part | Arithmetic only: 3 hits, 4 s of loading alone, 2 s for two. The school fights one against one |
| 8 | Front to the enemy, shoot for the flank (FM 71-1, p. 4-19) | **the game differs** | Both hulls take 3 hits front, side and rear: a front is worth no more than a rear, so a T-72 can win head on. No Abrams was lost to an enemy gun in 1991. The M1A1's side has one place that takes 1 |
| 9 | The reverse slope (FM 100-2-1, 1984, pp. 6-3, 6-4) | not in the school yet | No ground. What it turns on is reach, and here that runs the other way from Medina Ridge: the M1A1's dart lives 4 s (1,000 m), the T-72's shell 10 s (2,500 m) |
| 10 | The missile outranges the gun but must sit still (FM 71-1, p. 6-21) | **the game differs** | Nothing guides a missile here. The TOW and the BMP-2's AT-5 fly straight at 100 m/s for 10 s (1,000 m), the BRDM-2's Spandrel at 200 m/s for 5 s; the launcher can drive off at once. A T-72 crossing at 14.9 m/s is 74 m on in the 5 s a TOW takes to 500 m |
| 11 | The RPG: inside 300 m, from the flank (TRADOC Bulletin 3, 1976) | holds | RPG-7 (and the SMAW the other way): 4 hits on the front, 3 on the side or rear. It leaves at 100 m/s: 3 s to 300 m, in which an M1A1 crossing is 45 m on |
| 12 | Aircraft outrange armour; the ZSU is the answer (ARI 1532, pp. 30-31) | holds | Mi-24's AT-2 2 hits at 350 m/s (the AH-64's Hellfire the same on a T-72); Su-25's or A-10's 30 mm 7 rounds at 20 a second; a bomb 1. A tank gun lifts 20 deg. The Shilka's and the M163's rounds live 1 s, 1,000 m, against the real ZSU-23-4's 2,500 m |

Six of the twelve part from the manuals, and they part the same way: Desert
Combat gives 1991's vehicles 1943's fire control. The gun is not stabilised,
the dart is slow and drops, nobody sees further than anybody else, armour is
the same all round, and the missile is an unguided rocket. So the page's own
advice for a Desert Combat tank fight is the WWII school's: stop to fire,
judge the range, and get the first hit. What does carry over from 1991 is
what kills a tank from outside the duel: the aircraft, the missile carrier
and the launcher on the flank.

The 73 Easting on this engine, as the card says it: an even fight at best
(3 hits each way); three rounds leave in 4 s where Eagle 66 took seven;
its first shot, at 1,420 m, cannot be made (the dart is gone at 1,000 m);
the two that can are 2.4 s and 39 m of drop at 600 m, 1.6 s and 16.6 m at
400 m; and fired at 20 mph across their line the shot at 400 m lands 14 m
off.

Every quote on the card was checked against the scan's full text
(archive.org) after the research: all twelve are there as printed.

## Desert Combat's tank arenas

Before this the school had one Desert Combat arena, "Every tank", and opened
it on a T-72 against a Shilka. Three causes.

- **No battle had two sides.** The catalogue called every Desert Combat
  vehicle "Allied": its nations are not WWII's, and the roster's fix for
  that (SIDE-4, 2026-11-10: a side is the team the level data puts a
  template on, level by level in `levelSides`) had not reached the tree,
  because the `models` step that writes it re-exports every glb.
  `tools/bf1942-models/patch_roster.py --mod <tree>` now rewrites only
  `sides` and `levelSides` of a finished `models.json` from the roster a
  fresh extract builds (seconds; a second run moves nothing; on BF1918,
  extracted since the fix, no row moves). `--file` patches a catalogue
  elsewhere: the published one was fetched, patched and sent back, because
  the local Desert Combat tree is not the one the site serves ("Found on the
  way").
- **A borrowed map stood for the pair.** Desert Combat also plays vanilla's
  maps with its armour on them, and `ARENA_ORDER` put Kursk first, named
  "The Eastern Front". Its own battles now lead (`DC_Battle_of_73_Easting`,
  `DC_Medina_Ridge`, `DC_DesertShield`, `DC_Operation_Bragg`), `DC_` comes
  off a level's name and run-together words come apart (`levelWords`:
  "Desert Shield").
- **The Vulcan led its side.** The AI gives the M1A1, the Bradley and the
  M163 one worth (12), and the defaults fell to the alphabet. `tankRank`
  now breaks the tie by how hard the AI rates the hull's weapons against
  armour (`armourPunch`: 7, 6 and 1). No vanilla default moves: its tanks
  of one worth carry one rating.

Eight arenas now: Battle of 73 Easting (M1A1, Bradley v T-72, BMP-2), Medina
Ridge, Desert Shield, Operation Bragg, No Fly Zone, Inshallah Valley,
Midway, Stalingrad, then Every tank. Medina Ridge pairs only the Bradley and
the M163 against the BMP-2 and the Shilka: both teams spawn the M1A1 and
the T-72 there, and a tank both sides drive is neither's.

Also on the page: Desert Combat's hulls and weapons are named by their
designations (`prettyTank`: T-72, BMP-2, M2A3 Bradley, ZSU-23-4 Shilka,
RPG-7), and ON FOOT opens on the launcher (the SMAW or the RPG-7), not the
smoke grenade its slowest-first order put there.

## Found on the way

- **The local Desert Combat tree is not the published one.** The local
  `viewer/models/mods/desertcombat` was re-extracted on 2026-11-09 and never
  published: its catalogue has two rows the site lacks and no store `sha`,
  and its jets fly differently (dogfight-doctrine-1991, "Open"). Publishing
  from it would have replaced the site's catalogue with one whose glbs the
  volume does not hold. This change published only the patched copy of the
  site's own catalogue.
- **A launcher with no `velocity`.** The BRDM-2's Spandrel declares none.
  `armsOf` gives it the engine's default, 200 m/s (FA-3), which is what the
  lab server's 12 flights measured (200.5), not the school's old 100.
- **Two publishes at once.** The first dry run failed with "listing arrived
  short (0 of lines)": another session's publish shared the pod's temp file.
  Fixed upstream the same hour (98866dc69).

## Open

- **No ground.** Rules 6 and 9 need a crest, as BF1918's rules 4 and 5 did.
  The reach numbers in rule 9 are the round's life times its speed, flat.
- **How much hull a crest must show** is not quoted for Desert Combat: the
  side snapshot's height takes in the antennas (the M1A1 reads 5.1 m tall),
  so the BF1918 card's "metres above the gun" would mislead here.
- **The aircraft are priced from the side.** The clocks are the three
  horizontal faces'; nothing is priced from above, where an A-10 comes from.
- **Their aircraft, not yours.** Rule 12 says what their side flies against
  your hull. The other half, your side's Shilka or M163 against their
  aircraft, is quoted only when one of them is in the pairing (its reach).
- **The T-72's turret** reads as turning 160 deg either side with no free
  traverse in its rig, where the M1A1's turns all the way at 35 deg/s. Not
  checked against the game.
- **DC Final** takes the same card (`DOCTRINES`), but its tree is not
  published, so nobody has seen it there.
- **Not looked at by a person.** Checked headless (Chrome, 1440 px): five
  pairings' verdicts read, the card's screenshot looked at, no page errors.
  Live on play.bfstats.io since 2026-11-10 (the page opens on the 73
  Easting, M1A1 against T-72, with the twelve rules).
