# Action roll

A long-form video of one round, cut to a song: one continuous take that
passes the camera from one man's action to the next man near where it
landed. Made to show off what the replay can do, and deliberately longer
than a Short.

## The ask (owner, 2026-11-11)

> a video that will sync to a song I choose, that will record a continuous
> roll of footage using all the players in view, passing from one kill, or
> shot, or victim angle, and just keep passing the camera to someone in
> range. E.g. a plane could bomb and get the kill, then camera smoothly
> transitions to someone who was near the explosion running and then
> something happening to them. It can zoom to a new location to continue
> the action ... it wouldn't even need to be a kill, but perhaps a bazooka
> shot that we follow briefly before it hits a tank, but doesn't get the
> kill, then we circle the opponent firing back at the player, and then
> zoom to another battle.

Then: "just try a few yourself, before confirming with approach. I'll watch
back what you come up with." So these are trials, not a built feature.

## How the trials are made

`scripts/action-roll.mjs` films through the live play page the way the
Shorts runner does: a virtual clock stepped one frame at a time, the page's
sound rendered offline in step, ffmpeg for the MP4. 1920x1080, 30 fps.

The director runs in the page (`ROLL_SRC`), so every hand-over is judged on
where the page's round really landed:

- **Acts.** Every heavy shot (rockets, tank and SPG shells, bombs, thrown
  charges) and every kill by a man (never a bot). A heavy shot that kills is
  one act with its kills.
- **A beat** is one man's act: `lead` seconds on him from over his shoulder
  toward where he is aiming, then either the round ridden from behind (a
  bomb watched falling from off its side) and held on where it lands, or,
  for a kill, a slow circle round the man going down.
- **The hand-over.** When a beat ends, every act in the next `look` seconds
  is scored: its weight, how soon, how close its man is to where the last
  one landed (a glide within `near` m, a flight over the level up to `far`),
  doubled for the man just hit firing back, raised for whoever shoots the
  man just filmed, lowered for men filmed a lot already. Nothing in reach:
  the best act in the next minute, with the clock jumped forward while the
  camera is at the top of its flight.
- **The clock** eases to 0.4x at each hit for about a second, the sound
  slowed like tape with it.
- **`--bpm`** holds each hand-over to the next bar line of the song, so the
  passes land on the music.

Each take writes `beats.json` (who, what, how it was reached) beside
`roll.mp4` in `~/.cache/bfstats-roll/<take>/`.

## Trials (2026-11-11)

Three 75 s takes with the game's sound, no music yet, each opened on the
round's busiest 40 s. Copies for the owner at the repo root
(`roll-trial-*.mp4`, untracked); the takes and their `beats.json` are in
`~/.cache/bfstats-roll/v3-*`. 75 s films in about 2 min, its sound in 3 more.

| Take | Round | Beats | Glides / flights / jumps | Notes |
|---|---|---|---|---|
| `v3-gazala` | Gazala (`qu3znew633`) | 11 | 5 / 5 / 1 | The owner's example happened on its own: Grandes' bazooka rocket ridden into Rum&CocaCola's Panzer IV, held on the hit, then the camera turns to the tank firing back at him (1 m away). Dogfights and Spitfire bombs seen falling. |
| `v3-omaha` | Omaha Beach (`ku8gdc58b6`) | 14 | 8 / 5 / 1 | The most "passed along": men up the beach killing each other 10-50 m apart, a Panzershreck into a landing craft. One flight clips the cliff, one frame sits in the ground. |
| `v3-bocage` | Bocage (`zz4g8tz9ph`) | 14 | 7 / 7 / 0 | Bombs from Mustangs and SBDs, Sherman and Panzer shells ridden. A CTF round spread over the map, so half the hand-overs are flights. |

What the first takes taught (fixed before these):

- **A grenade thrown indoors** opened the first take on a dark roof. Thrown
  charges are not shots to ride, and a man whose sky is shut 20 m up is not
  handed the camera.
- **A mine or a left charge has no shooter**: kills by them are not acts.
- **A rocket at nothing** flew out of shot for 6 s. A shot is ridden only
  when it is aimed within 6 m of a man or hull of the other side (bombs
  always), and never more than 3 s.
- **The chase sat in the rocket's smoke** at 5.5 m behind: now 7 m back,
  2.2 up, 2.6 to the side.
- **Flights climbed into the fog** (white frames at the top of the arc):
  the rise is 12 m plus a tenth of the distance, at most 55 m.
- **A bomb's blast filled the lens**: the camera stands 2.4 times further
  off a bomb's hit, 1.5 times off a shell's.
- **Too many flights.** With only rockets, shells, bombs and kills, the
  next act near the last one was rare (9 of 13 hand-overs on Bocage were
  flights). Bursts of fire at someone are acts now, near only: a man
  firing within 120 m of where the last one landed takes the camera, and
  the man he is shooting at is the next hand-over point. Each recorded fire
  is one trigger press, so a burst is 2 presses within 1.2 s.

Known, not fixed yet:

- A flight is a straight line with a rise; it can pass through a cliff
  (Omaha). It needs the ground under the path checked, or a higher arc
  over high ground.
- Some flights are still long (300-500 m) on spread-out rounds; the
  balance between "stay local" and "go where it's happening" is the
  owner's call.
- `--bpm` is built but untried: no song yet.

## Review of the trials (owner, 2026-11-11)

> they're really great. Only nit pick is there is some footage filmed right
> on the edge of the range. So in all clips there was at least one clip
> showing the green model indicating they're out of range, as well as
> stuttery gameplay, meaning we have low fidelity play back, and should
> drop those.

> if we glide to a fight, show it for a bit, that's an excellent idea, if
> we're just gliding to someone not doing much or missing their shot just
> stay shortly. It does cut a fair bit, I think people will love it or hate
> it, so for now it's nice.

What changed:

- **Only men the recorder saw whole.** Every man a beat films is sampled
  every 0.2 s over the time it films him (the shooter from the glide in to
  the end of his beat; his target or victim from 0.8 s before the hit): at
  each sample whatever he is in (on foot, then a tank) must be replicated,
  and each of those lives must pass the Shorts picker's `continuityOf` (no
  hop of 15 m across a gap) over its own part. Sampling by moment matters:
  tested life by life over the whole window, a man who climbed into a tank
  failed because his soldier is not replicated while he rides. On Gazala's
  365 shooters, 62 were out of view (mostly pilots far off) and 19 hopped;
  with long-range targets as well, about a third of the round's acts go.
- **A miss is let go, a fight is stayed in.** A shot that neither kills nor
  lands within reach of its man (3.5 m, a hull's radius plus 4) ends 0.35 s
  after it lands, with no slow motion. A hit or a kill with two more acts
  (a burst counts half) within 80 m in the next 5 s holds 1.5 s longer.
  `beats.json` and the log mark each beat MISS or FIGHT and how long it held.
- **Misses known before they are chosen.** Every life carries its recorded
  health, so a shot or burst is marked as landing when its man's hull or
  body loses health (or dies) within 2.5 s. A miss weighs 0.3 of a hit
  when the next man is chosen, so the camera rarely glides to one; when it
  does, the beat ends 0.35 s after. v5 had chosen Omaha's Tiger five times,
  all misses.
- **No waiting on a man.** The next act is looked for 5 s ahead (was 6),
  and its weight halves every 1.25 s it would keep the camera waiting
  (`soon`).

Re-filmed as `v6-*` (the copies at the repo root are these now). Of each
round's acts, 74 of 203 went on Gazala, 94 of 324 on Omaha and 256 of 644
on Bocage, where the recorder saw less of a spread-out map. With fewer
acts to pass between, more hand-overs are flights or clock jumps (Omaha:
4 jumps), and the camera still dips into the ground on some glides.
