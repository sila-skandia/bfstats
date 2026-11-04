# Streak Shorts: review and rework (2026-11-04)

The owner on ration's 16-kill streak on Baytown (Short `2tenez5h7c`, recording
`4jxespez6a`): it is unclear why those kills were picked; long kills shown from
the victim's side are him "just standing there then dying"; at the ending "I
don't know what team the player is on"; the whole thing is "clunky and slow".

## What the Short is

66 s: a 1.5 s cold open (kill 16), five kill shots (kills 2, 4, 9, 14, 16),
three map cards, the kill that ended it, and a 2.4 s end card. Each part is a
whole kill shot: the shoulder, the bullet chase, a slow hold, about 9-10 s.

| # | t | gap | weapon | m | picked |
|---|---|---|---|---|---|
| 1 | 985.1 | | Breda | 22 | |
| 2 | 1002.3 | 17 s | Breda | 130 | yes |
| 3 | 1029.7 | 27 s | Breda | 79 (victim in a vehicle) | |
| 4 | 1035.5 | 6 s | Breda | 94 | yes |
| 5 | 1037.4 | 2 s | Breda | 39 | |
| 6 | 1042.8 | 5 s | Breda | 58 | |
| 7 | 1058.8 | 16 s | Breda | 20 | |
| 8 | 1060.7 | 2 s | Breda | 31 | |
| 9 | 1062.9 | 2 s | Breda | 66 | yes |
| 10 | 1071.6 | 9 s | Breda | 7 | |
| 11 | 1072.1 | 0.5 s | Breda | 19 | |
| 12 | 1084.2 | 12 s | Breda | 45 | |
| 13 | 1087.1 | 3 s | Breda | 34 | |
| 14 | 1091.4 | 4 s | WalterP38 | 59 | yes |
| 15 | 1096.0 | 5 s | Colt | 3 | |
| 16 | 1117.3 | 21 s | Breda | 118 | yes |
| end | 1121.4 | 4 s | pipi's Sten kills ration | 3 | |

ration is Italian (team 1); every victim and pipi are British. pipi was kills
1, 13 and 15 before ending the streak.

## Why it fails

1. **The picker took the five longest kills.** `filmablePart` scores a kill
   on foot by `distance / 10` and nothing else, so a streak's parts are its
   longest shots. 11 of the 16 were under 60 m; the three tight stretches
   (kills 3-6 in 13 s, 7-11 in 13 s with three in 4 s and two in 0.5 s,
   12-15 in 12 s) are left out but for one kill each.
2. **A bullet chase does not suit a light machine gun at 100 m.** Kill 2 is 8 s of
   hillside over a roof with the target a speck. Kill 4 is the director's
   reverse (3.5 m behind the victim, looking back toward the shooter): a
   British medic stands for 5 s and falls, with ration nowhere in the picture.
   The bullet chase suits one aimed round (the Garand at 137 m); a Breda kill is a
   burst, like the air volley.
3. **The counter jumps.** A part shows the count before its kill for most of
   its length, so the viewer reads 1, 3, 8, 13, 15 with nothing on screen
   about kills 5-7 or 10-12.
4. **No side is shown.** Nothing says which side ration is on, and nothing
   marks who is who; the ending is two soldiers 3 m apart in similar
   uniforms. The studio's kill feed (`feedKills`, team colours) and the
   replay's name tags (`updateTags`) exist but are off in the Shorts look.
5. **The ending has no setup.** "Ended by pipi" is small text over the name,
   and pipi appears for the first time as he fires. That he had been killed
   three times in this life is not said.
6. **Every part has the same rhythm and runs too long.** Most of each part
   is the lead-in and the hold. 66 s against the 45 s ceiling in `EDITS.md`. The
   three map cards add 3 s and say little on a map he barely left.

## The rework

**Pick stretches, not shots.** Split the life into stretches (kills under
about 10 s apart). Score a stretch on its kills per second, close range
(both men in one frame), a weapon change and a kill of the man who later ends
it. Film the best two or three stretches. A long kill from an automatic
weapon scores low; a rifle's long shot keeps its bonus.

**One take per stretch, behind him.** The burst's take (`filmBurst`): the
clock at 1.5-2x between kills and slowed on each, the tracers carrying the
eye, the `CLEAN` test per kill. Never the reverse inside a player's package:
if he cannot be framed, the kill drops out.

**Count every kill.** Inside a take the counter ticks on each hit. Between
takes, the dip rolls the counter through the kills skipped ("7, 8, 9") with
"+16 s" under it, in place of the map card.

**Say who is who.** In the title card, his name and side ("ration, Italy,
16 kills in one life"). A gold tag over him and red tags over the enemy near
him. A kill feed row on each hit in team colours, "ration [Breda] Upyerkilt".

**End where the story ends.** Kill 16 and his death are 4 s apart: one take,
the camera staying behind ration. pipi is tagged as he comes in, the kill
feed row reads "pipi [Sten] ration" in the other side's colour, and the line
is "pipi, killed 3 times by ration, ends it". Slow, grey, end card.

**Open on a kill that reads on a phone.** The cold open is a close kill with
both men in frame (kills 10-11, two in 0.5 s), not a prone man firing at a
speck.

Expected length: about 35-40 s (cold open 1.5 s, title 1.5 s, three
stretches at 9-10 s, the ending 6 s, end card 2 s).

## Built (2026-11-04)

Filmed locally on the same streak, four takes:

1. Stretches, tags, feed, bridges and the ending: 33.8 s. The second
   stretch saw 1 of 4 kills (the chase points the way he faces), and the
   ending's draw-back backed into a wall.
2. Over his shoulder toward each victim from 1.6 s before the kill (`AIM`),
   and a side-on two-shot at his death: every kill seen. About a second of
   empty field before the death, between kill 16 and the aim at pipi.
3. The aim from 3 s before: the run-up to the death is over his shoulder
   toward pipi. A third of a second of grass remains as the camera turns
   across a slope.
4. The camera kept above the ground while it turns (no change seen).
5. The owner on take 4: "much better", but "use the terminology streak, so
   16 kill streak", and the "+0:12" card "doesn't really add value, the fast
   forwarded gameplay is nice I think it speaks for itself". The title and
   the closing card say "16 kill streak"; takes are joined by the dip alone,
   kills not shown rolling by on the count as the next take fades in.
   Uploaded as `hxjv5u45a6` (32.5 s), the old `2tenez5h7c` taken down.

## rafal_pl's 18 from a Panther bunker (kevffebkkt, Ortona, FHSW)

The owner: "already pretty good, particularly when we have vehicle involved
the raw sounds are great, but it's slightly clunky". 18 kills over 14 minutes
from one place, 40-196 m, mostly 40-130 s apart: no stretches to take in
one, so the shell shots stay, a kill each. What was clunky: the count jumped
(2, 4, 5, 15, 17 before each shot), the same view over the bunker's turret
opened all five, a "+1:20" map card for a man who never moved, and the
ending was filmed from behind the Sherman that killed him.

Filmed locally in the stretch style: "GERMAN" in his pill, the tanks he hits
tagged red, the feed row on each hit, the count rolling 6 to 17 between two
shots, a 1.2 s lead-in after the first shot, no map card, four shots rather
than five, and his death from the bunker toward Kast7n's Sherman ("[TRIBUNAL]
Kast7n ends it / after rafal_pl killed him 3 times", set smaller to fit).
40.9 s against 56.9 s. Still rough: the 181 m Sherman's hold sits close
behind its hull for about 3 s (the kill shot's camera, as before).
