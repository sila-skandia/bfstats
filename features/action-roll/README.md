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
