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

## Rules and gotchas

Every rule here came from a take that broke it. A new one is added with its
fix; nothing is left as "known" (the owner, 2026-11-11: "keep a list of
rules and gotchas ... and fix them. I am never going to say no to fixing a
real bug").

1. **Only men the recorder saw whole.** No green stand-in, no stutter:
   everyone a beat films is replicated and hop-free while it films him
   (`seen`, the Shorts picker's `continuityOf`, sampled by moment).
2. **Never a bot**, killing, killed or aimed at.
3. **A shot worth riding is aimed at someone** (within 6 m of a man or hull
   of the other side) or is a bomb. Ridden 3 s at most.
4. **No act without a shooter to film**: mines and left charges are not
   acts, and thrown grenades are not rounds to ride.
5. **Nobody under a roof** is handed the camera (his sky shut 20 m up).
6. **A miss is let go, a fight is stayed in.** Recorded health says which
   before the camera chooses; a miss weighs 0.3, ends 0.35 s after it
   lands, no slow motion. A hit or kill with more going on within 80 m
   holds 1.5 s longer.
7. **No waiting on a man**: the next act's weight halves every 1.25 s it
   would keep the camera on him first.
8. **Stand off a blast**: 2.4 times further off a bomb's hit, 1.5 times a
   shell's; a lens in a fireball is a lost second.
9. **The chase sits off the round's smoke**: 7 m back, 2.2 up, 2.6 aside.
10. **Under the fog**: a flight rises 12 m plus a tenth of its length, at
    most 55 m. Bocage's fog whites out higher.
11. **Never in the ground, never through a cliff** (`clear`). A hand-over
    looks ahead along its path and rises over the highest ground there,
    6 m clear mid-flight; a settled camera keeps 1.1 m over the ground
    round it and rises when terrain climbs in front of the lens; a move
    that would pass through a wall or cliff rises 3 m a frame until it
    does not. Eased up fast, down slow, so it never pops. Each take logs
    the frames still under the ground, with the lens in terrain or a wall,
    or boxed in, and when (`clipping` in `beats.json`): a take with any is
    looked at before it is shown. The first detector only tested the
    ground under the lens and straight ahead, and logged nothing on a take
    that skimmed a Bocage hillside with grass filling the lower half: it now
    tests rays to the frame's bottom edge and corners within 2.5 m. On that
    stretch, 6 frames flagged without `clear`, none with it.
12. **One shot, one act.** FHSW logs a tank's gun once per ammo it carries
    (`StuG3GGunBarrel`, `...AP`, `...HE` at one instant); shots by one man
    within 0.08 s are one.
13. **A gun is not a shell.** MG and AA mounts named `_Gun`
    (`TB3_FrontMG_Gun`, `DShK38_V_Gun`), wing cannons (`Ki84-bomberCannons`,
    `I195CannonsPrm`), quad AA mounts, smoke and cartridge stand-ins, and
    any bore under 37 mm (`20mmType98_gun_barrel`) are not rounds to ride.
14. **4K, then every quality from it** (the owner, 2026-11-11: "1080p
    looks a bit dated ... we can record them in multiple qualities").
    Rendered at 3840x2160 (`--res`), written as `roll-2160p.mp4`,
    `roll-1440p.mp4` and `roll-1080p.mp4` (CRF 19/20/21, peaks
    45/24/12 Mbit/s, the same sound in each). The overlay is laid out for
    1080 lines and scaled.

15. **Never stand still.** When nothing the recorder saw whole is left in
    reach, the director looks to the end of the round and jumps there; with
    nothing at all left, the take fades out early. Meuse (2026-11-12) found
    nothing in 60 s and held one beat 26 s: "the camera gets stuck at that
    position and never moves again".
16. **No round into empty sky.** A shell aimed at a plane (its man 20 m or
    more over the ground) is not an act unless it kills: Manchuria's opening
    rode a dual-purpose gun's round toward a far plane for 9 s, "a weird
    chase but there's nothing out there".
17. **Paced to watch, not to make you dizzy** (2026-11-12: "it's cutting too
    hard. It makes me dizzy, I'd like to either hold on the action longer,
    or make the glides slower"). Lead-in 2.4 s before a shot (3 a kill, 3.6
    a bomb), 2.4-2.8 s held after, a miss 0.9; a fight 2.5 s more. A glide
    takes 2.3 s (was 1.25), a flight 4.4 (was 3.2); the settled camera
    follows and turns more gently (3.2 and 4 per second, were 5.5 and 7).
18. **4K and HD only** (2026-11-12: "either 4k or HD is enough"):
    `roll-2160p.mp4` and `roll-1080p.mp4`.
19. **Every take carries its script** (`roll.script.json`): the recording's
    SHA-256, the roll tool's last commit (and whether it had edits on top),
    a SHA-256 over the viewer modules the replay runs, the take's settings
    and every beat (kind, man, the act's round second, glide/fly/jump).
    `--script=<file>` films it again. It says whether it can: all three the
    same is the same take; otherwise it names what changed and refuses, and
    `--force` films it anyway, taking each scripted beat where the act is
    still there and choosing afresh where it is not. Versions are only
    compared, never supported side by side (the owner: "I'm not interested
    in keeping version support, but it would at least tell us if we could
    regenerate it or not"). Film from a committed tool, or the script says
    "+edits" and no later run can match it.

20. **Nothing solid at the lens.** A settled camera with a wall, fence
    rail or sandbag within 1.6 m low in its view moves in toward its man,
    or up 1-2 m, whichever is clear first (`clearLens`). Never a climb: a
    lift that rose while anything was near ran up onto a roof and lost the
    man (Meuse, 2026-11-12, a fence's base rail across the frame).
21. **Uploads go up in parts.** Cloudflare passes at most 100 MB a request
    and a 4K roll is 300-480 MB: each video is sent in 80 MiB parts to
    `POST /stats/shorts/parts`, then the upload names them (`videoUpload`,
    `videoHdUpload`). `--upload` films and sends; `--upload-take=<folder>`
    sends a take filmed before.

22. **No step in the camera's target** (Arnhem, 2026-11-12: "a cut that
    gets interrupted ... cuts to almost the same position, but the cut
    seems unnecessary"). The spring arm and the lens check move the wanted
    place in steps when a wall comes and goes; mid-glide a step read as a
    cut. The wanted place now eases itself (`goalEase`, about half a
    second for a step), reset only when a beat starts.
23. **Out of the smoke.** A smoke screen or blast covering a third of the
    picture near-white for 0.4 s ends the beat (`white`, `whiteFor`).
    Arnhem's smoke screen held 6 s of white; with this, about 2. Each take
    logs its near-white stretches beside its clipping.

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

## On the site: review of the REPLAY tab (2026-11-11)

The owner: "feel free to upload them to the site. We can make them part of
the regular recordings. But perhaps it's worth a UI review to find a way to
present shorts, recordings and these longer form recordings."

How the tab is today (play.bfstats.io `?tab=replay`, headless at 1440x900
and 390x844):

- Desktop: header and counts, one row of controls (sort, scope, server and
  uploader menus, storage meter, Record / Watch a file / Share), the
  "Shorts this week" strip (kind filters, Find a player, ~8 portrait
  cards), then a 5-column grid of round cards. The strip reads best.
- Phone: the header and controls wrap to five rows, 36% of the first
  screen; 2.3 Shorts fit; the first round card starts at the fold, one
  round per screen after that.
- A Short links to its round ("Watch the round", a few seconds before the
  kill). A round never links to its Shorts, and the strip disappears as soon
  as a server or uploader filter is set.
- Nowhere takes a 16:9 video.

Options:

- **A (recommended). An "Action rolls" row between the Shorts strip and
  the round grid.** 16:9 cards (poster, length, level), the newest a double
  hero on desktop; a one-card swipe row on a phone. Plays in the Shorts
  overlay at 16:9 with a quality menu (Auto picks 1080p on a phone, 1440p
  wide, 2160p only when chosen). Under the player: the round's Shorts and
  "Watch the round"; the beats as chapter ticks that open the replay at
  that second. Round cards gain a "Roll" badge and an "N Shorts" link. A
  resource of its own (`api/Rolls/`, `rolls/<slug>-{1080,1440,2160}.mp4`
  and `.jpg`, `GET /stats/rolls...`), not a Shorts kind: Shorts are one
  9:16 file keyed by a kill.
- B. A "Videos" sub-tab beside the rounds: clears the phone's controls, but
  hides the Shorts from the first view.
- C. The roll as its round card's cover, playing muted in view: no new
  layout, but rolls cannot be found and autoplaying 1080p grids are heavy
  on the one node.

Storage: the meter counted recordings only (241 MB) while the volume held
about 3.3 GB with the Shorts; fixed the same day (`VolumeUsage`). A 75 s roll
is 0.6-0.7 GB at three qualities (2160p 320-420 MB): one a night fills the
20 GiB volume in about a month. Keep three qualities for 14 days, then 1080p
only (about 7 GB a year at one a night), and serve 1080p unless asked.

## On the site (2026-11-12)

The six re-filmed rolls (r9: Arnhem 1944, Meuse River Line 1944, Manchuria
1945, Gazala, Omaha Beach, Bocage CTF; 90 s each, 4K and HD, filmed from the
committed tool, so each `roll.script.json` can say whether it can be filmed
again exactly) are in the REPLAY tab's Shorts strip as kind `roll`. Each went
up with `--upload-take`: about 480 MB of 4K in six 80 MiB parts and 105-130 MB
of HD in two. Titles read "Action roll: <level>", the level's name tidied
(`Arnhem-1944` reads "Arnhem 1944").

A take's process could hang closing the browser after its files were written
(Arnhem, six minutes); the close now gets ten seconds and the process exits,
so a batch moves on.
