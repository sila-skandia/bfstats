# Tank doctrine, 1917-18: the WWI rules in the tank school

Status: **built** (2026-11-10). On a BF1918 arena the tank school's MATCHUP
board has a sixth card, **06 The rules of 1917-18**: eleven rules from the
British, American and German tank and anti-tank instructions of 1917 and
1918, each in our words with a few of its own, its source, and what
BF1918's own data says of it on the pairing on screen. The card opens with
the first tank against tank fight, Villers-Bretonneux on 24 April 1918, and
a button that stages it (Mark IV against A7V).

The owner's brief: "Just like the dogfights school does specific dogfight
research from Dicta Boelcke, see if there is similar but for WWI tanks, and
integrate that into the BF1918 lessons." The dogfight school's version is
[dogfight-doctrine](../dogfight-doctrine/README.md); this is the tank
school's, built on its MATCHUP ([battle-schools](../battle-schools/README.md),
[tank-matchup.md](../battle-schools/tank-matchup.md)).

## Where it is

- `tanks.html?mod=bf1918&arena=villers_bretonneux&yours=Mark4&theirs=A7V`,
  card 06 at the foot of the board; the link under the headline jumps to it.
  On any other BF1918 arena the card reads the pairing on screen, and its
  "Fight it" button goes to Villers-Bretonneux. Other mods do not show it.
- `viewer/tank-doctrine-1918.js` (pure): `RULES`, each with its source and a
  `check(ctx)` verdict (`holds`, `differs`, `partly`, `not here`),
  `rulesOn(ctx)`, `VILLERS_BRETONNEUX` (the story and `duel()`),
  `haltMeasure`, `arcWords`.
- `viewer/tank-school-page.js` `drawRules`: builds the context. Your tank and
  theirs, each with the other gun's clock; their tank's machine gun, else
  their side's emplaced one; their side's field guns on the arena's battles
  (`fieldGunsOf`, AI `Artillery` rated against armour); their soldiers'
  anti-tank weapons, pickups included. Everything is priced on your hull with
  its blast (below).
- Tests: `tests/test_tank_school.py` `DoctrineTests`, `BlastAndArcTests`;
  `tests/test_extract_loadouts.py` (`pads`).

## The rules, and what BF1918 says

Verdicts as the page reads them on Villers-Bretonneux, your Mark IV against
their A7V.

| # | Rule (source) | Verdict | BF1918's numbers |
|---|---|---|---|
| 1 | Keep moving under the guns (SS 164 §3(iii), May 1917) | holds | The 77 mm field gun kills a Mark IV in 2 hits; its shell takes 3 s to 300 m, in which a Mark IV crossing at 5.4 m/s goes 16 m, 2 hull lengths |
| 2 | Stop for the shot (SS 203 §E.2(ii), Feb 1918, said fire on the move; Mitchell stopped) | **the game differs from the manual** | The hull's speed rides on the shell: crossing at 5.4 m/s a shot lands 11 m off at 200 m. A WWI hull steadies fast: the Mark IV swings 1.6 deg and is still in 2.5 s |
| 3 | Turn to bring a gun to bear (Mitchell's account) | holds | Mark IV: two 6-pounders, one a sponson, 181 deg between them, both only within 15 deg of the nose. A7V: 57 mm 10 deg either side, aimed with the tracks. Saint-Chamond 8 left, 5 right; Schneider 1 left, 22 right; FT-17 a full turret |
| 4 | Off the skyline (US 301st Battalion's lessons, 1918; Haig on Flesquieres) | holds | Shells stop on the ground. To fire over a crest a Mark IV shows 1.1 m of hull above its gun (37% of its height), an A7V 1.3 m, an FT-17 0.7 m (22%). The school draws no ground yet |
| 5 | Never alone (Training Note 16, SS 164 §4(iv), SS 204's section of three) | partly | Arithmetic only: 4 hits, 12 s of loading alone, 6 s for two. The school fights one against one |
| 6 | Spread out, 100 yards (SS 164 §5) | holds | The 77 mm's blast reaches 12 m (the 60-pounder Gun Carrier's 24 m); 91 m is ample |
| 7 | The field gun is the answer (SS 203 §A) | holds | 77 mm, 75 mm and 18-pounder: 2 hits on any WWI tank but the K-Wagen, blast included. The Gun Carrier's 60-pounder: 1 |
| 8 | Don't waste bullets on it (SS 203 §B, §C.3) | partly | A machine gun needs 300 to 500 hits, a rifle about 900. Massed fire blinds nobody: the game has no vision slits |
| 9 | From the side or rear (German 119th Division, via Browne) | **the game differs** | A WWI hull here is armoured alike all round: Mark IV 4/3/3, A7V 4/4/4, FT-17 3/3/3 front/side/rear. The rear buys only the gun's arc |
| 10 | Bundled charges, not grenades (the same report) | holds | Geballte Ladung 4 throws on a Mark IV, the heavy one 2, a stick grenade 10. Each bursts on a 5 to 6 s fuse, in which a Mark IV drives 27 to 32 m |
| 11 | The anti-tank rifle: close or not at all (Fuller, ch. XXXIV) | holds | Tankgewehr: 6 hits on a Mark IV inside 100 m, 30% damage from 150 m (about 20 hits). No kit a soldier chooses carries it: 18 battles lay it out as a pickup (`ger_tank`) |

Where the game and the manuals part is the lesson, as Boelcke's rule 3
was for the dogfight school's BF1918 guns: rule 2 is the written doctrine
of February 1918 that the first tank duel disproved, and the engine sides
with Mitchell. Rule 9 is real doctrine the mod's armour does not reward.

### Villers-Bretonneux on this engine

The Mark IV's 6-pounder needs 4 hits on the A7V; Mitchell's three would
leave it about 25 of 100 hit points (on the day its crew got out). The
A7V's 57 mm needs 3 on the Mark IV. A female's machine guns would need 501
hits on the A7V: no answer to it, as on the day.

## The sources

Read in full from archived scans of the Defence Academy's First World War
British Tank Doctrine collection (Crown copyright, expired):

- **SS 164**, *Notes on the use of Tanks and on the general principles of their
  employment as an adjunct to the Infantry attack*, May 1917
  ([scan](https://web.archive.org/web/20170620125108/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_164.pdf)).
- **SS 203**, *Instructions for Anti-Tank Defence (Provisional)*, February 1918
  ([scan](https://web.archive.org/web/20170620113727/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_203.pdf)).
- **SS 204**, *Infantry and Tank Co-operation and Training*, March 1918
  ([scan](https://web.archive.org/web/20170620105027/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_204.pdf)).
- **G.S. 943**, *Instructions for the Training of the Tank Corps in France*, 1 December 1917
  ([scan](https://web.archive.org/web/20170620115659/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/G.S_943.pdf)).

Full texts on archive.org and Gutenberg: Fuller, *Tanks in the Great War*
(1920); Browne, *The Tank in Action* (1920, with Tank Corps translations of
German reports); Williams-Ellis, *The Tank Corps* (1919); *Tank Corps
Activities, A.E.F.* (1920); Haig's despatches (1919). Mitchell's *Tank
Warfare* (1933) is not online; a transcription of his account of the duel is.
The landships site compiles the 1st Battalion's war diary and the 3rd Tank
Brigade report for 24 April 1918. Links are on each rule in the page.

Not found or not verified:
- German originals (*Abwehr gegen Tanks*, the A7V detachments' instructions):
  only British translations survive online.
- A French 1918 text (Gallica refused automated reads).
- Training Note No. 16 itself (King's College London, FULLER 1/1/6): it is
  February 1917, for the spring battles, not Cambrai.
- Mitchell's halt in his own words; where the three hits struck *Nixe*.
- "Aim the anti-tank rifle at the vision slits": no primary source found.
- No commonly quoted list of "rules for tank commanders" traces to a document.

## The game against the real thing

| | 1918 | BF1918 |
|---|---|---|
| Mark IV speed | 3.7 mph top (1.7 m/s) | 5.4 m/s |
| A7V speed | about 8 mph on smooth ground | 6.1 m/s |
| Tank gun muzzle velocity | about 400 m/s (6-pdr, 57 mm, 37 mm) | 100 m/s for every one, 35% gravity: 1.4 m drop at 100 m, 8 m at 200 m |
| Mark IV armour | 6 to 12 mm; "practically proof" against the German AP bullet | 80 hit points, one material (47) all round |
| T-Gewehr | 26 mm at 100 m, 18 mm at 500 m | full damage to 100 m, 30% from 150 m |

The game runs its WWI tanks three times faster than the real ones and fires
their guns at a quarter of the speed. The rules that turn on time (rule 1,
the field gun's lead) and on the hull's motion (rule 2) hold all the same.

## Found and fixed on the way

- **A shell's blast hurts the hull it hits** (HP-9: an impact blast leaves
  out only the firer). The school priced the direct hit alone. Vanilla's
  tank shells have no blast cell against armour (DMG-2), so no vanilla
  pairing changes; BF1918's 75 mm and 77 mm do (17.5 hit points at the
  hull's origin), and so do 58 of Desert Combat's 210 pairings and 121 of
  EoD's 420. `tank-armour.js` `blastOf` adds it ray by ray; a blast's
  pull on a plate the round cannot pierce counts only where nothing on that
  side is pierced (a thrown charge), or every immune plate would drag the
  median down (`bearingShots`).
- **ON FOOT priced thrown charges at nothing.** The Geballte Ladung, the
  dynamite and every grenade hurt by blast on a fuse; their own material
  has no line against armour. They are now priced where they burst against
  the hull, said as throws, with the fuse and how far the tank drives in it.
  `PLACED` went from 10 to 5 m/s: a charge thrown at 8 to 9 m/s is a throw.
  Vanilla's grenade now shows against the Tiger (8 throws; DMG-2's 205
  against armour is 2.0).
- **ON FOOT ignored a bullet's falloff.** The Tankgewehr's hits now follow
  the distance slider (`damageFactor`).
- **Pickups were invisible.** `extract_loadouts.py` read the kits a level
  lays on pads and wrote their rows, but not which level lays which; the
  file now has `pads[<level>]`, and `sideWeapons` counts a pad's kit for its
  own team (or either, team 0). BF1918's Tankgewehr is a pickup only.
- **The Mark IV read as one gun.** three's loader names the second
  `Mark4Gun` `Mark4Gun_1`; `gunArcs` matches both.
- BF1918's tanks, guns and grenades by the names their crews knew them
  (`prettyTank`), and its lower-case level names given capitals.

## How it was checked

- Headless Chrome (ui's Playwright, the registry patched to count BF1918, as
  the local `mods.json` still counts it at 0): Villers-Bretonneux Mark IV v
  A7V, Chemin des Dames FT-17 v A7V and Saint-Chamond v Beute FT-17, vanilla
  Kursk (no card); no page errors.
- `surveys`-style scratch runs over BF1918's local tree for every WWI hull
  against every gun, field gun and hand weapon, with and without the blast.
- 36 tank-school tests, 35 loadouts tests.

## Open

- Rules 4 and 5 need ground and more than two tanks; the school has
  neither. Rule 4's verdict is the hull above the gun, not a crest.
- SS 203's "stop the infantry behind the tank" and SS 164's "tanks take
  ground but cannot hold it" are left out: nothing in a duel measures them.
- The other trees' `loadouts.json` gain `pads` on their next loadouts run;
  BF1918's is regenerated. FHSW and FHSW Europe wait on their installer.
