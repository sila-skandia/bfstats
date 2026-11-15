# Match recap

A round's key moments, faded one into the next, then the round's angriest
chat as a slide show: the weekly video in place of the action roll.

## The ask (owner, 2026-11-15)

> I think the weekly action rolls are a bit too extreme in their panning for
> regular players. The 3d is very neat ... so it's something we can keep in
> our arsenal, and the ones that are live keep live. But perhaps we pivot to
> generating match recaps. Where we fade between key moments. Like streaks,
> interesting kills, and just other interesting moments from gameplay.
> Remember it all needs to be well within the recording player's FOV to get
> nice play back. They can be a little longer than the current action rolls,
> but too much longer and people will lose interest.

> Maybe also we look for text that shows someone losing their temper ...
> full of swear words, accusations and general being a bitch and just add it
> at the end of the clip in a slide show of whining. It's optional if there
> is none.

> maybe just in a couple of interesting frames, like a 1 v1 could split the
> screen looking from each player

## What a recap is

1. **The card** (3.6 s): "Match recap", the level, the server and date, who
   recorded it, over the round held still and blurred.
2. **The moments** (about 55-100 s, round dependent): each filmed with the
   roll's beat camera (over the shooter's shoulder toward his man, the round
   ridden for a heavy shot, a slow circle round the man going down) but never
   panned across the map: one moment fades through black into the next
   (0.55 s out, 14 hidden frames while the seek settles, 0.5 s in), two parts
   of one moment dip in 0.3 s, and the same man again within 2.2 s is a glide.
   A caption low left says what it is ("7 kill streak", "Kill 5 of 7"), who,
   and what with.
3. **1 v 1s split the screen** (at most two a recap): the left half over the
   killer's shoulder at his man, the right over the victim's shoulder at his
   killer, held where it was once he falls. Each pane is the middle half of
   its own camera's 16:9 frame, rendered twice a frame; names on dark plates
   in team colours, "1 V 1" on the seam.
4. **The salt** (optional, up to 5 slides, 2.6-5 s each), behind a warning
   card first (2.8 s; the owner, 2026-11-15: "a little bfstats site logo with
   red Following content is NSFW"): the site's mark (`/bfstats-logo.webp`),
   "FOLLOWING CONTENT IS NSFW" in red, "The round's chat, uncensored". Then
   "Salt of the round",
   who said it, when, to whom, and the lines, the angry words in the salt
   colour, over the round blurred.
5. **The closing card** (3.4 s), out to black.

The sound is the round's own, dipped to nothing through each fade (the WAV is
built frame by frame with a gain; hidden frames are passed over), at a fifth
under the salt.

## Well within the recorder's view

Measured on Kursk and Liberation of Caen (MoonGamers, 2026-11-14), the gap
between a man's samples against his distance from the recording player:

| From the recorder | Median gap | 90th percentile |
|---|---|---|
| 0-250 m | 0.104 s | 0.107-0.111 s |
| 300-350 m | 0.104 s | 0.207 s |
| 400-450 m | 0.105 s | 0.21 s and gaps of seconds |

So every man a moment films (each killer from 3.6 s before each kill to 2.5 s
after, each victim from 2.1 s before to his death) must be, every 0.25 s:
replicated, hop-free (the Shorts picker's `continuityOf`), within **200 m**
of the recorder (his last place alive within 12 s while he waits to spawn),
and never in a gap between samples over **0.16 s while moving** more than
0.6 m across it. A man standing still has no keys and does not stutter; the
first version counted him and dropped nearly every moment.

On the 40 newest rounds that leaves 1-12 moments a round. A round with fewer
than 4 makes no recap (the tool exits 3 and the weekly job moves on).

## The moments (`replay-recap-pick.js`)

Pure, run in node on the parsed recording. Weighted, then taken best first
with no two within 6 s of each other, at most 3 of one man, 2 split screens,
until about 96 s of video:

| Kind | Weight | What |
|---|---|---|
| Tank downs a plane | 95 | the Shorts picker's `tank-to-air` |
| Air to air, ground to air | 70, 68 | the picker's kinds |
| Tank buster, tank duel | 58, 52 | |
| 1 v 1 | 56 + 2 a round exchanged | the man killed fired at his killer 2+ times within 7 degrees in the 5 s before; both on foot or both in hulls, 6-150 m, no planes |
| Bombs away | 50 | a bomb kill |
| Streak | 44 + 4 a kill | a life of 5+ kills, its closest 3 in 30 s |
| Long shot | 40 + metres / 12 | |
| Revenge | 38 | the man killed comes back and kills his killer within 45 s |
| Double, triple, quad kill | 34 + 18 a kill | kills by one man within 5 s of each other |
| The recorder's own kill | 14 | so he is in his own recap |

The recorder's moments weigh 14 more. Bots are never in one.

## The salt

A line scores for swearing (2 each, at most 6: English and the common German,
Polish, French, Russian, Spanish, Italian, Finnish and Swedish ones),
accusations (2, at most 4: hacks, aimbots, camping, spawn and base raping,
team kills, lag, rigged, unbalanced, calls for an admin, a kick or a ban) and
insults (1.5, at most 3: noob, idiot, stupid, useless, trash, ez...).
Capitals add 2 and stacked `!?` 1, but only to a line already angry:
"LETS SINK THESE JERMANS" (Corfu) is a man enjoying himself. An apology takes
3 off, a laugh 1. A man's lines within 18 s are one slide (his rant, 3 lines
at most); a slide needs 3 points; at most 2 slides of one man.

Never shown: bots, the server's own lines, commands (`!kick`, `admin.`), a
line said twice, and any line with a slur, or from a man whose name carries
one. The recap is a joke at the round's expense, not a platform for that.

Measured on the 40 newest recordings: 26 have salt. Omaha's (`ku8gdc58b6`):

- SGT RICK: "an admin camping the beach? nothing new"
- Maj.MerliN: "HOW FUQING STUPID ARE U / UR AN IDIOT AND THIS IS PROOF"
- Maj.MerliN: "UR FULL OF SHIT / U FUQING GOOF"
- SPEEDofPAIN: "okay, no admin to clean up spammers / no admin to help here"
- Captain Pickled Pope: "ships wait in ocean and tk ship / tk the ship that's why"

## Making one

    node scripts/action-roll.mjs --recap --recording=<slug> --gpu --channel=chrome --sound [--upload]

`--res=1080` and no `--sound` for a quick look. The take is in
`~/.cache/bfstats-recap/<slug>-recap/`: `roll-2160p.mp4`, `roll-1080p.mp4`,
`roll-link.mp4` (Discord), `poster.jpg` (the best moment, a split screen's
first), `meta.json`, `beats.json` (each beat's moment, the salt) and
`roll.script.json`, which carries the whole plan: `--script=` films the same
moments and salt again.

On the site it is kind `recap` (`api/Shorts/ShortKinds.cs`): 16:9 like a
roll, keyed `<recording>:<start>:-11`, up to 180 s and the roll's size
limits (raised to 1000 MiB for the 4K and 320 MiB for the HD). The strip has
a Recaps filter.

**Weekly.** `scripts/shorts-nightly.sh` films one on the first night of each
ISO week (`roll-weekly.mjs --recap`: the week's busiest round of 5 minutes or
more with no recap yet), stamped `recap-<week>.done`; `RECAP_WEEKLY=0` skips
it. The weekly roll is off (`ROLL_WEEKLY=1` films one); the rolls already
live stay live.

## Trials

- **t1, Omaha Beach, 1080p, no sound** (2026-11-15): 8 moments, 54 s of
  them, 2 split screens, 5 salt slides, 78 s in all. What it showed, fixed
  before the next take: the title card covered the first split screen's left
  half (now its own card over the blurred round); the names over the split
  panes were lost against the sky (now on dark plates); the clipping log
  counted the frames behind the salt's blur (no longer measured); and the
  picker ran out of moments under its 10 s spacing and 2 per man (now 6 s and
  3: Kursk goes from 69 s of moments to 84).
- **t2, Omaha Beach, 4K with sound**: no clipping frames; 281 MB 4K, 62 MB
  HD. The first 1 v 1 held 2.3 s: the round ran on behind the opening card,
  as the replay reads a speed of 0 as 1 (`replay.js` resets it); the card now
  pauses the round. The salt's faint quote mark sat over the speaker's name
  and went; the NSFW card came in on the owner's review.

## On the site (2026-11-15)

The first recap is live: Omaha Beach (`ku8gdc58b6`), slug `2v7vt4wata`,
83.7 s (the card, 57 s of moments with two 1 v 1s, the NSFW card and five
salt slides, the closing card); 306 MB 4K, 67 MB HD, a 40 MB link copy the
share page names, so it plays in a Discord embed. In the REPLAY tab under
Recaps, a 16:9 card. The nightly films the next on the first night of ISO
week 47.

## Review of the first: more action, long shots ride the bullet (2026-11-15)

The owner, on the Omaha recap:

> the long shots need to chase the bullet because for sniper it's hard to
> sometimes see the victim

> I think the clip is too short, it's not really a recap but a higlight reel
> of a very brief number of kills. So we probably newd to film more action,
> eithe by shortening what already film or making the reel longer

What changed:

- **A long shot rides its bullet.** A kill of 60 m or more on foot, and every
  long-shot moment, is handed to the creator's round cam as a Short's kill
  shot is (`replay-roundcam.js`): armed 2.6 s before the recorded round
  leaves (its own set-up lead), the round held back to land as he dies, the
  camera behind it at the Shorts' pace (0.45-1.4 s on screen by distance, the
  hold 1 s at 0.6x). The recap's camera keeps the lead-in over his shoulder,
  gives the camera to the round cam while it rides, and after the hold stays
  exactly where it left it until the cut (eased on, it pushed through the
  landing craft the man fell beside). The round cam owns the clock while it
  rides. A round that never leaves (1.5 s past the kill) falls back to the
  kill's own circle. The creator view is on for a recap's take.
- **More action.** Beats are shorter (2.4 s before a kill, 2.2 s held after,
  a fight 1.2 s more; fades 0.45 s, dips 0.25 s), moments may be 4 s apart
  and 4 of one man, and the budget is 125 s of moments (was 96). Two kinds
  fill a round without streaks: a **firefight** (3 or more kills by 2 or
  more men within 15 s and 80 m, up to 4 of them, weight 30 + 6 a kill) and
  **any other kill** the recorder saw well (weight 8). Omaha went from 9 beats
  in 57 s to 23 beats in 125 s; Kursk picks 23 moments, Caen 10 bigger ones
  (seven streaks).

The 1080p check of Omaha (`t5-omaha`): all four long shots rode their bullet
(116, 115, 131, 102 m). Two beats on the bluff log the lens near terrain: the
camera is tucked against the slope with the man and the fight in view, left
as it is.

Re-filmed in 4K with sound and swapped on the site the same day: `rjaqdw87yb`
(158.9 s: the card, 129 s of moments in 23 beats with four bullet rides and
two 1 v 1s, the NSFW card and five salt slides, the closing card; 665 MB 4K,
147 MB HD, a 40.5 MB link copy). The first (`2v7vt4wata`) was taken down.
