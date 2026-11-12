# Replay match-up: two that fought, brought to the front and taken apart

The owner's idea (2026-11-12): in a replay, switch into a match-up mode where
two things that fought (planes, tanks, soldiers) pause, their vehicles come
apart into parts, and each shows where it is vulnerable to the other. The model
is History's *Dogfights*, which stopped a fight to model both planes side by
side and show where each was better and weaker. Because the replay is our own
3D playback, the battlefield itself can be sliced open: a way for the data nerds
to examine a battle and see whether the two ever had a chance against each other
(some FHSW tanks cannot be hurt from the front by some guns at all). The
forensic-show look is in, its name and branding are not.

Then: "just have a go, as long as it's opt in from the replay controls that's
fine, we'll advertise it more broadly when it's in."

The first cut froze the round the moment Match-up was chosen. The owner's
verdict the same day: not intuitive, "it stops the game when I use it, so it
means i have to precisely scrub to where I want to look at, then see the
action." Their direction: bring the two to the front by dulling the rest of the
scene and let the battle play; give a kill a match-up option, seen only with the
mode on, that opens the detailed breakdown. That is the second cut (below).

Status: **built**, opt-in from the replay bar's More menu (Match-up, a switch).
Checked headless on a real FHSW Europe tank fight (see "Checked"); not looked
at by hand in a browser. Nothing is published: no asset is involved.

## Using it

- **More (...) > Match-up** on the replay bar turns the mode on (the row reads
  ON), and again off. Nothing of it runs until then.
- **While it is on, the round plays.** Whenever a fight is on at the playhead
  (two things that hit each other, or one that killed the other), the rest of
  the view is dulled and the two, with whoever rides with them, stay at full
  colour over it. Their rounds are drawn as they fly, a bright streak each:
  orange for one that did damage, pale khaki for one that missed or did none.
  Each hit's damage rises over whoever took it ("-88"), and DESTROYED or KILLED
  on the round that ends it. Each of the two has a tag with their name, what
  they are in and their hit points, kept a short way above them on the screen
  (close to the camera, a point over a hull projects towards the horizon, over
  whatever is beyond); one off the screen is held at its edge, above the bar
  and the player card, with an arrow towards them. The replay's own name tags
  give way while a fight is on.
- **The strip** at the top: both sides, their hit points as they fall, the hits
  each has landed and the range between them. *Break it down* freezes the round
  there (below). With no fight on it says so and offers *Next fight*, which
  jumps to 4 s before the next one begins. The cross turns the mode off. The
  fronts' tabs, which sit in the same place, give way while the mode is on
  (*Next fight* is the way to the fighting then); where the page's minimap
  would cover the strip (a phone, a narrow window) it keeps to its left.
- **The camera** is the viewer's. Once, as a fight comes on with the other
  off the screen, the orbit (not Auto's director, not first person or the
  free camera) swings round to behind the followed player, looking at who
  they are fighting.
- **Which fight**: with a player followed, only theirs (a fight elsewhere would
  dull the one being watched); with the free camera, any. A fight is on from
  4 s before its first hit to 4 s after its last event, and the one shown stays
  while it lasts, giving way only once it is past its last hit and another is
  under way. The same two meeting again after 20 s without a hit is a new fight.
- **Kills in the timeline**: with the mode on, every kill in the timeline's
  tooltip has a *Match-up* button (beside *Kill shot*, where the creator view
  is granted). It freezes the round 0.15 s before that kill on the fight it
  ended: the breakdown below.
- **The breakdown** freezes the round on the fight. Everyone else is put away
  (the replay's focus, as the dogfight school uses it), the view gets a
  vignette and a FROZEN stamp with the clock, and the free camera moves off to
  one side of the two, high enough to see the rounds' arcs. *Back to the
  round* (or Esc) puts the camera back as it was and plays on if the round was
  playing; Play, or a seek away, ends the freeze too.
- **Every round between them hangs in the air** where it flew, on the server's
  flight law: orange for one that did damage, blue for one that struck the hull
  and did none, khaki for a miss, gold for a hit whose place could not be
  rebuilt for certain. Each strike is a bead where it landed. Rounds still to
  come after the frozen moment are drawn fainter. A dashed line joins the two,
  with the range on it, and each has a tag (name, what they are in).
- **The panel** (right, a bottom sheet on a phone):
  - *Fights near* the playhead, up to eight; a click freezes on another.
  - *The two*: name, vehicle, hit points at the moment and at the end of the
    fight (a bar of both), the gun that fired at the other, and their rounds:
    fired, damage, struck without damage, missed.
  - *What happened*, in plain words (below).
  - *The ground between them*: a cut through the terrain along the line
    between them, both at their heights, every round's path laid on it.
- **Take them apart** opens the stage: both hulls side by side on a stage of
  their own. Each one's collision faces are painted by the hits the *other's*
  gun needs there (the tank school's bands: 1, 2, 3, 4 to 5, 6 or more, and
  dark grey for no damage), its paint faded to a ghost, its parts flown out from
  the middle the way the model viewer's part inspector takes a model apart, and
  every round that met it pinned where it struck, with a short rod for the line
  it came in on and its damage over it. Each is turned so the camera looks at it
  from where the other was ("King Tiger, as Kai saw it"). Under each, one row per
  round that met it: when, the plate, how far off square, the damage, and
  whether the plate's price matches the recorded drop. A click on a row pulses
  its pin. Put back together / Take apart, As they saw it (the camera back),
  and drag to orbit both.
- **Esc** closes the stage, then the freeze. **Play** (or a seek away) ends
  the freeze and puts the round back as it was, the page's own focus included,
  with the mode still on.

## What the words say

Never who should have won. That was learnt in the model browser, whose Compare
panel was taken out because a who-wins verdict read off a shots-to-kill table
was "an unintuitive way to ask the question" (battle-schools, tank-matchup.md,
"Lesson from the model browser: no verdict"). The words say what happened and
what the numbers allowed, for each side:

- `Ann fired 6 rounds at Kai: 2 did damage, 3 struck and did none and 1 missed.`
- `Their hits took 76.2 of Kai's hit points.`
- `Their 75 mm L37,5A gun does nothing to 16 of the 25 armour materials on the King Tiger: every plate from 100 mm up.`
  (the "every plate from" part only where the mod names its plates by
  thickness and no thicker plate still gives)
- `From 312 m they saw Kai head on, and 22% of what they could see was armour their gun gets through; 6 hits there destroy it from full health.`
- against a soldier: what a hit from that gun costs head, chest and limbs;
- the ground: whether it rises across the line between their guns, or by how
  much the line clears it;
- the ending: who killed whom, or that neither was killed.

## How it works

Four modules, the pure one under node:

| File | What |
|---|---|
| `viewer/replay-matchup.js` | Pure. The round's fights (`fightEpisodes`), the one on at a time (`fightOn`), the next (`nextFight`), the one a kill ended (`fightOfKill`), the fights near a time (`fightsNear`), the rounds between two things (`roundsBetween`), each hit's recorded drop given once (`assignDrops`), where one was seen from the other (`seenFrom`), the body part a drop names (`bodyPartFor`), what one gun does to a hull's armour (`armourAgainst`), the tallies and the words. |
| `viewer/replay-matchup-strike.js` | Where a round struck a hull (`HullCaster`), the gun a round left (`gunSpecOf`), its price (`priceOf`) and flight (`flightOf`). |
| `viewer/replay-matchup-live.js` | The mode while the round plays: the spotlight pass, the two's tags and damage, their rounds in flight, the strip. |
| `viewer/replay-matchup-view.js` | The page: the menu switch, the breakdown's freeze, the rounds in the world, the panel and its ground cut, and the stage. |

**The spotlight** is one more pass after the page's render, before the
followed player's arms (`replay.js` `renderViewmodel`): a dark sheet over the
whole frame, then the two drawn again through a small scene of the pass's own.
That scene is lent, for the one render, the two's drawn objects (their hulls'
groups and the soldier bodies of everyone in them, `replay-bodies.js`
`botVisuals`), the level's lights and their rounds in flight, by setting its
`children`; no object's parent changes, and the scene does not update their
matrices, which the page's render has just set. So it costs the two's own
draw calls, not a walk of the level's scene (67,518 nodes on Meuse River
Line), and draws them exactly as the page did: the camera's own layers (a nose
the cockpit hides stays hidden), the level's fog, its shadows as already drawn.
The depth the page's render left is kept, so a hill in front of one of them
still hides it. The renderer's settings the pass changes are put back in a
`finally`. The timeline keeps no thumbnail of a dulled frame.

**The round's fights** are each pair's hits and kills, split where 20 s passed
with neither (`fightEpisodes`), with everyone who was in each side at each
event, so a followed player killed in their tank still counts as in the fight
while it holds on. They are worked out when the mode comes on and again
whenever the Accuracy rebuild changes (a hull's model landing names its gun's
rounds).

**A thing** is a life: a hull (whoever is in it) or a soldier on foot. A round's
thing is the hull its FireArms hangs under, else the man (`shooterOf`); what it
hit is the life whose hit points dropped as it got there, the Accuracy rebuild's
victim (replay-accuracy.js `rebuildTallies`, features/replay-accuracy). A kill is
the killer's thing against the thing the victim was in 0.15 s before they died.

**Which fight comes first**: hits count by their logarithm (a machine gun's 36
small hits on an open-topped M36 are not twelve times the fight two shells
make), then a kill (+3), both sides landing (+2), the followed player in it
(+4), the playhead inside it (+4), less a tenth a second it is away.

**The rounds between them** are each one's rounds (`f`) from 4 s before the
fight's first round to 2 s after its last: a hit on the other (the Accuracy
verdict), or a round that passed within 12 m of them (a tank's shell 11 m wide
is a miss at it; its coaxial gun 16 m off was at the men beside it). FHSW's
`_Dummy` rounds, fired beside a real one only to draw, are left out. Each hit
is checked against the first drop of the other's hit points at or after its
arrival, and a drop is given to one round only: two rounds arriving together
cannot both be one drop of 30. A round no verdict credited that passed within
4 m of a hull's middle (1.2 m of a soldier's) just before a drop nobody took is
that drop's hit, marked inferred: on Meuse River Line the Tiger's killing round
on the M6 was one.

**Where each round struck** is not in a client recording: it holds the round as
it left (where, which way, which gun) and each hull's hit points as they changed.
So the round is flown again on the server's law, `tank-ballistics.js` (muzzle
speed plus the firing hull's velocity, FA-23's lift, IMP-8's first tick without
gravity), from 0.45 s before its expected arrival to 0.45 s after, in 1/240 s
steps, into the struck hull's collision faces as the recording had them then:
its root where it was at that moment and its turret and gun at their recorded
angles (`ReplayHull.applyJoints`, a v5 recording's `j` parts; a v4 file's
decoded aim through `applyAim`). The faces are worked out in the hull's own
frame, once per quarter second of its moving parts, and the round's path is
carried into that frame by the root's recorded pose at its arrival (with
whatever offset the drive puts between the recorded pose and the drawn one). An
FHSW tank's `BulletCatcher` cubes are left out (COL-20).

The face it meets is priced on the engine's direct-hit law, the tank school's
arithmetic (`tank-armour.js`): `materialDamage x damageMod x angleFactor`
(DMG-3, DMG-4), a hand weapon's falloff with range, plus a shell's blast where
it reaches armour (HP-9). That price is checked against the recorded drop:

| Status | Means |
|---|---|
| matched | the face's price is the drop, within a tenth (0.6 at least); for a killing drop, no less than it |
| solved | it was not, and a face within 0.5 m of the path is (a 1/8 m grid across it): the round is put there. Hulls are drawn from 10 Hz samples, and guns have spread |
| unexplained | no face near the path costs the drop (a blast, two rounds in one sample): the first face is kept, the pin gold |
| glanced | a round with no drop that met the hull: a plate its gun cannot hurt, or one the recording saw do nothing |
| approximate | the path never met the faces; the nearest face to where it passed is taken, the pin gold |

A soldier has no faces: a hit on one is matched to the body part (head 40,
chest 41, limbs 42, DIE-10) whose price is the drop, and a killing drop names a
part only when one part alone costs that much.

**The gun** a round left is read off the shooter's own model (the FireArms node
of the round's weapon, with the projectile the assembler resolved for it), else
the weapon table from `damage.json` (which now carries each weapon's attacker
material and falloff, `replay-accuracy.js` `weaponTableFrom`). The tables are the
level's (the page's guns hold them), else the models tree's `damage.json`, which
the HUD now keeps (`replay-hud.js` `damageTables`). A side is painted by the
gun it fired at the other most, else its main gun.

**What each saw of the other** is the tank school's rose at one bearing
(`tank-armour.js` `bearingShots`): a grid of rays at a copy of the other's hull
from where this side was at the moment, the share of hits on plates this gun
gets through, and the median such hit's shots to kill. It is worked out after
the panel is up.

**The stage** is a second WebGL renderer over the replay, made when it first
opens and let go when the match-up closes. Each hull is a `skeletonClone` of the
live hull as it stands at the moment (so its turret is where it was), its
meshes matched one for one with the live hull's, so a strike found on a live
mesh is pinned on its copy in that mesh's own frame and moves with its part
when the parts fly. The parts are the model viewer's part index
(`model-parts-index.js` `buildPartIndex`) and its `popVector`, depth by depth.

## Checked

**Unit**: `tools/bf1942-models/tests/test_replay_matchup.py` over
`replay_matchup_harness.mjs` (32 tests): small recordings written line by
line. A Sherman and a Tiger 200 m apart (the fight, its moment inside and
outside it, the rounds between them with the 30 m one left out, each hit's own
drop, the tallies, the bearings each was seen from); two rounds on one drop; a
round no verdict credited that passed through the hull before an unclaimed drop,
with a dummy round beside it; a Thompson's body parts, killing drops included;
what one gun does to a hull's armour; the words; a soldier against a tank; the
round's fights for the live mode (the same two meeting twice 50 s apart are two
fights, the one on at a time, the next, the one a kill ended, the one shown
staying while it goes on and giving way once it is only holding on, a followed
player's fights alone); and the wiring (the menu switch, the frame hooks, the
key routing, the timeline's button, the pass lending the two to its own scene
and putting the renderer back).

**The real page**, headless Chromium, through `serve_viewer.py` on :5273 (its
remote fallback for the FHSW Europe trees this machine has not extracted, the
live `models/mods.json` handed to the page): the shared recording `xhf8sfkt7k`
(Meuse River Line 1944, 2026-10-25, a public FHSW Europe round, v5), playhead
at 3:20, More > Match-up with real clicks. 30.7 s to load, the match-up built
in under a second after its two frames.

- Eight fights found near 3:20. First: a Sherman Jumbo against a late Tiger
  (hits 3 to 2, the Tiger's kill), then the Tiger against an M6 heavy (1 to 3,
  its kill), each of whose rounds the probe lists. The Panther's 36 small hits
  on an open-topped M36 at 3:03 rank fifth, as they should, behind the fights
  the playhead is inside.
- 29 rounds between the Jumbo and the Tiger. **Every hit's place was rebuilt
  and explained by the recorded drop**: 4 matched on the face the rebuilt
  round met (the Jumbo's 76 mm on the Tiger's 100 mm plate 8 degrees off square,
  priced 87.1, the drop 88; its 120 mm plates at 18 and 20 degrees, 8.3, the
  drops 8), 2 matched on a face 0.3 and 0.35 m off the path (the Tiger's 88 on
  the Jumbo's 80 mm plate, 105.5 for a drop of 105). 6 rounds struck and did
  nothing: 160 and 200 mm plates the 76 mm cannot get through (the stage
  paints them dark), and one 160 mm plate where the 88's price is 0.6 and the
  recording has no drop. A Tiger round that reached the Jumbo after it was
  dead is left out.
- The words: "Their 76 mm L52 gun does nothing to 10 of the 22 armour materials
  on the Tiger Late: every plate from 140 mm up." "From 67 m they saw
  LOUISTERRIBLE :D head on, and 58% of what they could see was armour their
  gun gets through; 5 hits there destroy it from full health." The Tiger's 88,
  seen from the Jumbo head on: 72%, 3 hits. The ground cut: open ground, the
  line between them clearing it by 3 m.
- The stage: 2 hulls (32 and 35 parts flown apart), 11 pins with labels, each
  turned to where the other was; Put back together, and Esc back to the frozen
  round, Esc again to the round with the focus and the drawing gone; Play
  while frozen ends the freeze.
- At 390x844: the panel a bottom sheet, the stage's two stacked, the legend a
  row under the head, no sideways scroll.
- No page errors, no match-up warnings in the console.

**The live mode**, the same recording and page, the camera on the Jumbo's
driver in the orbit, everything through real clicks (the menu, the strip's
buttons, the timeline's tooltip):

- At 3:06 the strip says no fight is on for them and offers the next at 3:10,
  4 s before the Tiger's first hit at 3:14.7. *Next fight* goes there; the
  fight comes on (hits 0 : 0, 133 m), the view dulls and the orbit swings round
  to behind the Jumbo, the Tiger down the road in view.
- The dulling, measured off two screenshots of 3:23.95 with the mode on and
  off: the Jumbo's pixels are the same (mean 108.6 both), the ground round it
  0.44 to 0.47 of its brightness, the sky 0.54. A tank between the two is
  dulled with the rest.
- At 3:23.62 the Jumbo's 88-point round is in the air; at 3:23.95 "-88" rises
  over the Tiger and the strip reads 2 : 1. At 3:30.85 five rounds of the
  Tiger's machine-gun burst are in flight at once. 31 rounds between them
  over the fight.
- The pass costs a median 0.6 to 0.7 ms a frame in headless Chromium's software GL
  (90th percentile 1.7 to 1.8 ms, two runs); a first version that drew the level's scene again
  with the camera on one layer walked all 67,518 of its nodes and cost 1.5 ms
  (8.6 ms). After each pass its scene holds nothing and both hulls' parents are
  the page's own.
- *Break it down* while playing: frozen at the playhead, the panel up, the
  free camera off to the side; *Back to the round*: the orbit back on the
  Jumbo's driver and the round playing on.
- The timeline at the Jumbo's death (3:47.9): the tooltip's two kills each
  carry Match-up (the Tiger's also Kill shot). The Tiger's freezes at 3:47.7
  on the fight it ended (29 rounds), hits 3 : 2 from 3:14 to 3:47, the Jumbo 24 to 0 of
  142; Esc goes back to the live mode.
- At 1:00, long before the fight, the dulling fades out and the strip offers the next
  one again; the strip's cross turns the mode off and the menu's switch reads
  OFF.

On the same recording under node, the Tiger against the M6 heavy shows the
inferred kill shot: the Tiger's round at 3:38.6 passed 0.9 m from the M6's
middle just before its hit points went from 46 to 0, which the Accuracy rebuild
had not credited (its crew died on the same tick). The Tiger was being repaired
through the fight (+1 every 0.3 s), so its drops are net of that.

## Open

- A server recording carries the server's own collisions (`i`, IMP-9: barrel,
  contact point, whether it did damage). Those could replace the rebuilt
  strike outright where they exist; the first cut always rebuilds.
- Planes have no airframe numbers on the stage yet (the dogfight school's
  climb, turn and gun convergence), and soldiers no figure: a soldier's column
  is words only.
- The breakdown is a pause, not a clip: the creator studio could take its
  freeze and its stage as a beat of a Short. The live mode's look (the dulling,
  the rounds, the damage) is drawn into the frame, so a creator recording with
  it on already gets it.
- The live mode marks a soldier's body and a hull alike; a plane's fight at
  1 km reads only by its tags.
- What each saw is read at the frozen moment only, not per round.
