# Replay spotlight: a kill played with the two lit

Hover a kill in a replay's timeline and press **Spotlight**: the round jumps to
just before the kill and plays it with the killer and the one they killed lit
and everything else dulled, their rounds flying as tracers and every hit's
damage rising over whoever took it.

It began as a match-up, the owner's idea of 2026-11-12: two things that fought
paused, taken apart side by side and each shown where it was vulnerable to the
other, the way History's *Dogfights* stopped a fight to compare two planes.
Three cuts on the same day led here (see "History" for what each was and what
it found):

- the first froze the round the moment Match-up was chosen: "it stops the game
  when I use it, so it means i have to precisely scrub to where I want to look
  at";
- the second dulled the rest of the scene around whatever fight was on at the
  playhead: "it doesn't really feel like it's adding any value", but "the fact
  it highlights the opponent is nice. It means you could zoom in on just that
  kill", so a kill's button should "just clip in before the kill and highlight
  the two opponents in the style you've built" (the owner's working name was
  "Highlighted"; Spotlight was proposed and kept: "good job");
- the third was that, opt-in from the bar's menu, with the breakdown behind it.
  Then: "I think we can get rid of the break down, and turn spotlight on by
  default ... make the spotlight option visible."

The tracers became the shot lines' look too: "I like the tracers, I feel like
we could use that style to replace the shot lines we already have"
(features/replay-accuracy, "Shot lines").

Status: **built**, on in every replay. Checked headless on a real FHSW Europe
tank fight (see "Checked"); not looked at by hand in a browser. Nothing is
published: no asset is involved.

## Using it

- **Spotlight on a kill**: every kill in the timeline's tooltip has a
  *Spotlight* button (beside *Kill shot*, where the creator view is granted).
- **It jumps in** 5 s before the kill, or 2 s before the killing round left if
  that is earlier (a shell long in the air), and plays.
- **The camera** stays on whoever it follows when they are one of the two, else
  goes over to the killer, in the orbit (out of Auto and the free camera), and
  swings round behind them to look at the other, so both are in the view, and
  again whenever the other's direction drifts more than 23 degrees, until you
  turn the camera yourself (or the death cam takes it). A recording holds a far
  player's last place until they come back into its range: an M6's victim
  stood 400 m from where they were, then jumped behind the camera once the
  recording caught up. (It first swung only when the other looked off the
  screen, judged from a camera still gliding over from the last player, and
  only the followed tank was ever seen lit.)
- **The two lit**: the rest of the view is dulled and the killer and the one
  they killed, with whoever rides with them, stay at full colour over it.
  Their rounds fly as tracers, the shot lines' (below), orange for one that
  did damage and pale khaki for one that did not. Each hit's damage rises over
  whoever took it ("-88"), and DESTROYED or KILLED on the round that ends it.
- **Their name tags**: the replay's own (name, vehicle, hit points, streak; a
  click follows them) stay on both of the two however far off, the other
  side's too in first person, and everyone else's give way. A first cut hid
  them all for a tag of its own: "you removed the opponents name tag, add it
  back". The spotlight still draws a tag where the replay draws none (a man
  just killed, a hull nobody is left in, one past the view distance, where the
  page draws nothing of them: an M6's victims on Meuse River Line were 300 to
  400 m off), kept a short way above them on the screen, and one off the
  screen is held at its edge, above the bar and the player card, with an arrow
  towards them. Whether they are behind the camera is read from the camera's
  own frame: a point past the far plane projects past 1 in depth too, and the
  M6's victims, dead ahead, were first sent to the bottom edge.
- **The strip** at the top while a kill is lit: both sides, their hit points as
  they fall, the hits each has landed and the range between them. *Again* plays
  it once more from the start; the cross lets go. The fronts' tabs, which sit
  in the same place, give way to it; where the page's minimap would cover it (a
  phone, a narrow window) it keeps to the minimap's left.
- **It lets go** 4 s after the kill, or on a seek outside that stretch; a scrub
  about inside it keeps it.

## How it works

| File | What |
|---|---|
| `viewer/replay-spotlight-fights.js` | Pure. The round's fights (`fightEpisodes`), the one a kill ended (`fightOfKill`), which side is whose (`orient`), the rounds between two things (`roundsBetween`), each hit's recorded drop given once (`assignDrops`), hit points (`healthOf`), names (`labelOf`). |
| `viewer/replay-round-flight.js` | A round's flight on the server's law (`flightOf`) and the speed and gravity its gun gives it (`roundOf`). |
| `viewer/replay-spotlight.js` | The page (`ReplaySpotlight`): the jump in, the camera, the pass, the two's tags and damage, their rounds, the strip. |
| `viewer/replay-tracers.js` | A round as a tracer (`Tracers`): its streak and head in the air, the line it leaves, the flash where it ended. The shot lines draw with it too. |

`replay.js` makes the spotlight with the player, runs it last in each frame
(`withSpotlight`), and gives it its pass after the page's render
(`renderViewmodel`); `replay-timeline.js` puts the button on each kill.

**The pass** comes after the page's render, before the followed player's arms:
a dark sheet over the whole frame, then the two drawn again through a small
scene of the pass's own. That scene is lent, for the one render, the two's
drawn objects (their hulls' groups and the soldier bodies of everyone in them,
`replay-bodies.js` `botVisuals`), the level's lights and their rounds in
flight, by setting its `children`; no object's parent changes, and the scene
does not update their matrices, which the page's render has just set. So it
costs the two's own draw calls, not a walk of the level's scene (67,518 nodes
on Meuse River Line), and draws them exactly as the page did: the camera's own
layers (a nose the cockpit hides stays hidden), the level's fog, its shadows as
already drawn. The depth the page's render left is kept, so a hill in front of
one of them still hides it. The renderer's settings the pass changes are put
back in a `finally`. The timeline keeps no thumbnail of a dulled frame.

**A thing** is a life: a hull (whoever is in it) or a soldier on foot. A round's
thing is the hull its FireArms hangs under, else the man (`shooterOf`); what it
hit is the life whose hit points dropped as it got there, the Accuracy rebuild's
victim (replay-accuracy.js `rebuildTallies`, features/replay-accuracy). A kill is
the killer's thing against the thing the victim was in 0.15 s before they died.

**The round's fights** are each pair's hits and kills, split where 20 s passed
with neither (`fightEpisodes`), with everyone who was in each side at each
event. A kill's is the one holding that kill (`fightOfKill`, the timeline's
mark within 0.6 s of the kill line). The fights are worked out when a kill is
lit, and again whenever the Accuracy rebuild changes (a hull's model landing
names its gun's rounds).

**The rounds between them** are each one's rounds (`f`) from 6 s before the
fight's first hit to 4 s after its last event: a hit on the other (the Accuracy
verdict), or a round that passed within 12 m of them (a tank's shell 11 m wide
is a miss at it; its coaxial gun 16 m off was at the men beside it). FHSW's
`_Dummy` rounds, fired beside a real one only to draw, are left out. Each hit
takes the first drop of the other's hit points at or after its arrival, and a
drop goes to one round only. A round no verdict credited that passed within
4 m of a hull's middle (1.2 m of a soldier's) just before a drop nobody took is
that drop's hit: on Meuse River Line the Tiger's killing round on the M6 was
one. Each flies on the server's law (`replay-round-flight.js`, after
`tank-ballistics.js`: muzzle speed plus the firing hull's velocity, FA-23's
lift, IMP-8's first tick without gravity), its speed off the shooter's own
model's FireArms, else the level's weapon table.

**The tracers** (`replay-tracers.js`) are one `LineSegments` and one `Points`
with a four-wide colour attribute, alpha per vertex, blended normally (an
additive line vanished on snow): a streak 0.06 s of the round's flight long
(at most 40 m) from 30% to full, a glowing spot at its head, the line it
leaves from 18% at the muzzle to 60% at its end, and a spot where it ended
that goes over 0.5 s. The line fades over the last half of the 4 s after the
round lands. A shell under gravity is drawn along its arc in eight pieces.

## Checked

**Unit**: `tools/bf1942-models/tests/test_replay_spotlight.py` over
`replay_spotlight_harness.mjs`: small recordings written line by line. A
Sherman and a Tiger 200 m apart (one fight, the followed player's side first,
the rounds between them with the 30 m one left out, each hit's own drop, hit
points, the label); two rounds on one drop; a round no verdict credited that
passed through the hull before an unclaimed drop, with a dummy round beside
it; a soldier against a tank; the round's fights (the same two meeting twice
50 s apart are two fights, the one a kill ended, found from the timeline's
mark, not from another victim or time); and the wiring (the button on every
kill, no switch under the menu and no match-up left, the spotlight's window
and its letting go, the pass lending the two to its own scene and putting the
renderer back, the tracers shared with the shot lines).

**The real page**, headless Chromium, through `serve_viewer.py` on :5273 (its
remote fallback for the FHSW Europe trees this machine has not extracted, the
live `models/mods.json` handed to the page): the shared recording `xhf8sfkt7k`
(Meuse River Line 1944, 2026-10-25, a public FHSW Europe round, v5), the camera
on the Sherman Jumbo's driver in the orbit, through real clicks (the timeline's
tooltip, the strip) unless said:

- The tooltip at the Jumbo's death (3:47.9) lists two kills, each with
  *Spotlight* (the Tiger's also *Kill shot*).
- *Spotlight* on the Tiger's kill of the Jumbo: the round jumps to 3:41.3, 2 s
  before the Tiger's killing shell left at 3:43.3 (earlier than 5 s before the
  kill), and plays, lit until 3:51.9. The camera stays on the Jumbo's driver
  (one of the two) and turns to face the Tiger. The strip reads 3 : 1, 34 m;
  the fronts' tabs give way.
- At 3:43.33 the killing shell is in the air between the two, an orange head
  and streak, with the lines the earlier rounds left (34 pieces, 6 spots); at
  3:43.6 "-105" rises over the Jumbo and the strip reads 3 : 2.
- *Again*: back to 3:41.3, playing. A seek to 3:52.5 lets it go; the dulling
  fades.
- At 390x844 the strip keeps left of the minimap, no sideways scroll.
- The dulling, measured off two screenshots of 3:23.95 lit and not: the Jumbo's
  pixels as they were (mean 108.6 both), the ground round it 0.44 to 0.47 of
  its brightness, the sky 0.54.
- The pass costs a median 0.6 to 0.7 ms a frame in headless Chromium's software
  GL (90th percentile 1.7 to 1.8 ms, two runs); a first version that drew the
  level's scene again with the camera on one layer walked all 67,518 of its
  nodes and cost 1.5 ms (8.6 ms).
- The shot lines as tracers: the Tiger's coaxial burst at 3:30.3 to 3:31,
  played through, is 20 lines with 9 rounds still in the air, a bundle of
  streaks from the Tiger past the jeep; with a kill lit they sit under the
  dulling with the two's own rounds over it.
- No page errors, no spotlight warnings in the console.

## History: the match-up and its breakdown

All on 2026-11-12, all in git; the breakdown's code is whole at `548fcf741`
(`viewer/replay-matchup-view.js`, `viewer/replay-matchup-strike.js`) should it
be wanted again.

- **The breakdown** (`4a9ac9a84`): More > Match-up froze the round on the best
  fight within 30 s of the playhead. Every round between the two hung in the
  air where it flew; a panel said what happened in plain words (never who
  should have won: battle-schools, "Lesson from the model browser"), gave a
  cut through the ground between them, and *Take them apart* put both hulls on
  a stage of their own, each painted by the hits the other's gun needed on each
  plate and taken apart the way the model viewer's part inspector does it, with
  every real hit pinned where it struck.
- **Where each round struck** was rebuilt, since a client recording never says:
  each round flown again on the server's law into the struck hull's collision
  faces as the recording posed them (turret and gun at their recorded angles),
  the face it met priced on the direct-hit law (DMG-3, DMG-4) and checked
  against the recorded drop. On `xhf8sfkt7k`, the Jumbo against the late Tiger,
  every hit was explained: 4 on the face the rebuilt round met (the Jumbo's
  76 mm on the Tiger's 100 mm plate 8 degrees off square, priced 87.1 for a
  drop of 88), 2 on a face 0.3 and 0.35 m off the path (the Tiger's 88 on the
  Jumbo's 80 mm plate, 105.5 for 105). The 76 mm did nothing to "10 of the 22
  armour materials on the Tiger Late: every plate from 140 mm up".
- **The live match-up** (`a3a342295`) lit whatever fight was on at the
  playhead while the round played, with *Next fight* to jump between them.
- **Spotlight behind a switch** (`548fcf741`): the kill's button, opt-in from
  the menu, with *Break it down* on its strip. Then the breakdown went and
  Spotlight became the default.

## Open

- Spotlight's look (the dulling, the rounds, the damage) is drawn into the
  frame, so a creator recording a lit kill already gets it; Kill shot and
  Spotlight could be one take.
- Spotlight lights a soldier's body and a hull alike; a plane's fight at 1 km
  reads only by its tags.
- A server recording carries the server's own collisions (`i`, IMP-9): a hit's
  place and whether it did damage, which the tracers could end on exactly.
