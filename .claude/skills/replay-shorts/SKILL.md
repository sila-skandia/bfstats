---
name: replay-shorts
description: Make, publish and fix Replay Shorts, the 9:16 kill clips in the REPLAY feed's "Shorts this week" strip on play.bfstats.io. Use whenever the owner asks to generate, film, render, upload, publish, re-do or delete Shorts ("make a couple of Shorts", "generate a short of that kill", "the Shorts strip is empty", "re-render the Shorts after the camera fix"), when a Short looks wrong (bad framing, a wrong title, a washed-out poster, "null" in a title), or when changing the kill picker, the render runner, the Shorts API or the strip and player.
---

# Replay Shorts

A Short is one kill from a shared recording, filmed in the creator's Shorts
look (1080x1920, bullet chase, grade, lower third), uploaded to the API and
shown in the REPLAY tab's strip and full-screen player. The design and every
decision are in `features/replay-shorts/README.md` (read "As built" first);
the frame-stepping measurements in `features/replay-shorts/CLOUD_RENDER_TEST.md`.

## What a good Short is (the owner's reviews, 2026-11-03)

Read this before changing how a Short is filmed or which kills qualify. Each
line is a review of real Shorts on the live site.

- **Show the hit, then pull out so the kill can be seen.** Not stylised for
  its own sake: the round arrives, then the camera draws back to show the
  victim whole, and for a vehicle the wreck going down. "A vehicle on vehicle
  kill should show the wreckage fall." A camera inside a fireball or tight
  on a hull is a failed Short (the Pak and the bunker on a Stuka).
- **No kill effects.** The punch zoom, the shake and the white hit flash are
  off in Shorts: "obnoxious", "hard to understand what happened". The
  studio's own Shorts recipe keeps them for creators who want them.
- **The long sniper shots work** (the 137 m Garand on Meuse, the Omaha
  K98s): over the shoulder, the round's flight, the man dropping. That is
  the bar the others are measured against.
- **No hops.** A kill where either man left the recorder's range around it
  shows a hull jumping (a Mustang moved 79.5 m in one 0.84 s gap). The picker
  rejects it (`continuityOf`); never hand-pick one past it.
- **No real-time replay after the edit.** Tried 2026-11-03: the game's chase
  camera points the way the killer faces, not where he fires, so the hit was
  off screen (a Pak aiming up at a Stuka); his own view from a tank was a
  letterboxed sight with the target out of frame. `--real-time` is kept only
  as the record of that experiment.
- **The opening shows the shooter whole.** Over the shoulder of a man in a
  hull is round the hull, in its radii (`HULL_SHOULDER`); a camera inside a
  mantlet was the first complaint of the day.
- **Per-player compilations** (the owner, 2026-11-03: air to air "per
  player in a round, if they have >= 5"; "same for ... vehicle to vehicle
  battles"). `vehicleKillsOf` gathers every kill with both men in hulls and
  whole in the recording; `playerReelsOf` makes one reel of a player's air
  kills and one of his other vehicle kills at 5 or more, his best 6 in time
  order, titled "<name>: 10 vehicle kills on Meuse River Line" (decoded).
  Each air part is the volley (below), led in 3.5 s, faded into the next;
  each vehicle part is the bullet chase; his name and
  "3 of 6" on top. Measured: 0-3 a round. `--kinds=player` films only these.
- **A round's crashes are a reel** (kept from the reel experiment: "the
  crashes are nice though, they're interesting"), each pilot named on his
  part. Made by default; falls, own charges and spawn deaths only with
  `--reels`.
- **Own goals and spawn deaths are not Shorts (2026-11-03, final).** Tried
  as single Shorts with a WASTED card, then as one reel a round; the owner
  on the reels: "the context is really hard to follow, especially in the
  short format. I don't think it's working." All were taken down; the runner
  films them only with `--reels`. The detection (`ownGoalOf`, spawn deaths
  in `shortCandidates`, `reelOf`) stays for the per-player packages in
  `IDEAS.md`, where a man's own round gives the context. What was tried:
- **Own goals and spawn deaths as reels (dropped).** Asked for 2026-11-03, then reworked the same day: a spawn death
  alone "lasts so quickly ... not coherent", and the WASTED card was "too
  forced"; "the clips are great ... the way they fade ... put them into a
  compilation". `reelOf` gathers a round's 3-5 best of a kind in time order
  (keyed on the first, victim -2 for own goals, -1 for spawn deaths);
  `filmReel` follows each man with the game's chase camera (4 s before an own
  goal; from his spawn with a life clock for a spawn death), and at his death
  the camera stands back (own goal: looking down, 6 m back 8 m up for a man,
  26/9 for a hull; spawn death: behind his body looking toward his killer),
  the clock slows, the picture drains to grey and fades to black into the
  next. No WASTED, no by-line; only the life clock and "2 of 5".
  Own goals are classed by `ownGoalOf`: a crash (his hull wrecked with him at
  speed), a fall (8 m in 4 s), his own charge. Spawn deaths: a real spawn
  (`spawnedLate`) killed within 5 s by a credited kill.
- **Air to air is the volley, not a bullet** (2026-11-03: "it's not one
  bullet that kills them it's the volley"): no bullet time; the chase camera
  behind the attacker at 1x from 5 s before, and it stays there through the
  kill (2026-11-04: cutting to a camera on the victim "snaps to the victim
  and loses context"). The clock eases from 1x to 0.3x over the 0.7 s before
  the kill, so the burst's last rounds fly slowly as it lands, and the slow
  hold runs 3.2 s. The lens widens (up to 80 degrees) only when the victim
  would leave the middle 80% of the frame, and goes back after the part
  (`REEL_BEAT.volley*`). When the victim is dead ahead on the chase line his
  own plane hides it (the BF109-on-SBD kill showed only debris): the eye
  rises 3 m, eased, and stays up for the part. Both live in a lens hook
  (`camera.setLensHook`), which runs after the chase places the camera and
  before the render; the chase keeps its own offset, so the lift never
  accumulates. Unless a kill is some kind of miracle, that is how
  air kills are filmed.
- **Sound is wanted.** Film with `--sound` (the nightly does).
- **Look at what went up.** The nightly uploads unreviewed; after a run,
  contact-sheet the new ones and take down a bad one rather than waiting
  for the owner to find it.

When a review adds to this list, add the line here with the Short it was
about.

- **The round lands as he dies** (2026-11-04: "dies prior to the bullet
  cam arriving", hulls exploding "too early, or too late", a close round
  zooming past the tail). The round cam now fires the kill round early by
  its flight and steers it onto him at the kill line, and the hull dies on
  it (`features/replay-creator-view/README.md`, "The round lands as he
  dies"). The Shorts look runs without the freeze on the kill: it held the
  frame still at the hit and every explosion came after it. To check a kill
  shot, film it with `--trace` (OUT/trace-<t>-<victim>.json, per frame) and
  compare the impact frame with the kill line and the death.
- **The camera stays put after the hold** (2026-11-04: "rapidly pan across
  the map for half a second"). Handed to the dead man, it flew to his
  respawn; `armCreator` sets `afterHit: 'stay'`.
- **Old rounds have compilations too.** The nightly reads the ten newest;
  to find more, scan every recording (`playerReelsOf` over
  `/stats/recordings?pageSize=100`) and film with `--recording=<slug>
  --kinds=player-air` (or `player-vehicle`).
- **Two Shorts of one moment.** A shell that kills both men in a hull writes
  two kill lines, and before the merge each could become a single Short
  ("Sherman kills PanzerIV at 73 m" twice). After a re-film, list live
  Shorts on one recording within a second of each other and take one of
  each pair down.
- **Streaks and bursts** (2026-11-04): a player's kill streak in one life
  ("15 kill streak" ticking on each hit, ending on the kill that stopped it
  and who did it) and his most kills in 60 s, filmed in one take, sped up
  between kills. `--kinds=streak` films both. Test a compilation that is
  already live with `--to=http://127.0.0.1:9` (no upload target: no live
  keys, so it films).
- **Transitions** are in `features/replay-shorts/EDITS.md` (research): the
  dip (`DIP`), the cold open (`coldOpen`), the J-cut (`jCut`) and the map
  card (`mapCard`) are built.
- **A scene must be clean** (2026-11-04: six kills from inside a hangar,
  all off screen): a burst's take checks each kill is in the picture and in
  line of sight (`CLEAN`, `window.__clean`), and falls back to the bullet
  chase kill by kill. Test edits to the runner in a copy
  (`scripts/shorts-runner-next.mjs`) while a batch runs: every round of a
  batch loads the runner afresh.
- **The recording's player always has a Short** (2026-11-04: "always
  prioritise the uploader"): when no pick features `recordedBy` (else the
  uploader), the runner adds his best candidate, else his longest filmable
  shot (`featuredOf`).
- **Never a bot** (2026-11-04: "We never want to clip bots in any clip").
  The picker's `isBot` (the player row's `ai`) keeps every bot out, killing
  or killed, in every kind; lab rounds with bots (Berlin) yield nothing.
- **A blast is the kill shot, not the chase** (2026-11-04: a grenade burst
  filmed in one take looked at the sky as he threw). A burst mostly inside
  one 1.5 s blast rides the round in and draws back as it lands.
- **Creators' Shorts and ASMR** (2026-11-04): players share studio clips
  through `POST /stats/shorts/share` (kind `creator`, their sign-in, never the
  upload key); the runner's `--kinds=asmr` films a round's Battlefield ASMR.
  ASMR is one a week (owner, 2026-11-04): `--asmr-mix=week`, never one a
  round in a routine pass. **No slow motion, no edits** (2026-11-07: "for
  these shorts we don't want slo mo, it's like a tribute to the beauty of
  the game, so don't edit it"): real time, the game's own sound, only faded
  in and levelled (`ASMR_SOUND`). A moment of fire is filmed from downrange
  facing the gun (`FACING_CAM`): his favourite shot was The Clëäner's flak
  gun on Soletschnogorsk firing at the lens, its rounds cracking past.
  A creator's Short is his: do not re-film or take one down unless the owner
  asks.
- **The weekly ASMR is the arsenal** (2026-11-07, later: following a player
  "seems more distracting ... like those weird youtube videos where someone
  plays a random speed running game"): each of the week's guns alone in its
  level, cut out of its round (`scripts/shorts-range.mjs`), its report up
  close then its rounds cracking past from downrange through a long lens,
  the level blurred, the firing barrel ringed and named
  (`arsenalOf`, `filmArsenalTake`; README "The arsenal"). Turned down
  2026-11-08 ("nah I don't like it"), never uploaded: the nightly's weekly
  ASMR is paused (`ASMR_WEEKLY=1` runs it) until the owner picks its next
  form.
- **ASMR from the man under fire** (2026-11-07: "plenty of sounds from
  different weapons from the suppressed ... point of view ... the bullet /
  weapon whips as the rounds land close is incredible"): every week's mix
  has two moments of rounds cracking past a man's head
  (`underFireMomentsOf`), filmed from just behind his eye looking at the men
  firing; `--asmr-mix=under-fire` is a whole one of them. Every theme
  prefers a gun not heard yet (`gunFamily`). The crack needs the viewer's
  replayed-bullet fly-by (`guns.onBullet`, README "Under fire"); before it
  deploys, film against a local viewer: `--play=http://localhost:<port>`
  (the `serve_viewer.py` server; the runner sends its `/stats` to the API).
- **A streak is not its five longest shots** (2026-11-04, ration's 16 on
  Baytown, 2tenez5h7c): "why we choose those kills"; long kills shown from
  behind the victim "just standing there then dying"; an ending where "I
  don't know what team the player is on"; "clunky and slow". The picker
  scored streak parts by distance alone (the 59-130 m Breda kills, 11 of
  16 were under 60 m), the counter showed 1, 3, 8, 13, 15 between parts,
  and the Short ran 66 s (`features/replay-shorts/STREAK_REVIEW.md`).
  Rebuilt the same day: a streak on foot is its best stretches, one take
  each, over his shoulder toward each man he kills, sides in gold and red,
  the ending with the man who ended it (README, "A streak on foot is its
  stretches"). `--player=<name>` with `--to=http://127.0.0.1:9` films one
  player's to look at before it goes up.
- **A bomb is seen falling** (2026-11-04, skandia's 109 on Battleaxe,
  3fumm77ubh): "way too tight on the victim, so it doesn't capture the epic
  bomb sent by the pilot. We need to zoom out." The chase rode the bomb into
  the blast; now it stands 40 m off the target and watches it fall
  (`replay-roundcam.js` `DROP`; `features/replay-creator-view/README.md`, "A
  bomb is seen falling"). The runner's director leaves a pilot's shot to the
  round cam (`fromAir`): its reverse and its last resort had put the camera
  on the ground under the bomb, white for three seconds. The round cam is a
  viewer change: film with
  `--override=tools/bf1942-models/viewer/replay-roundcam.js` until it is live.
  Re-filmed `3fumm77ubh` as `f2spvccnnm`.
- **The reverse must see him** (2026-11-05, ration's 122 m K98 on Omaha,
  re-recorded as h9ujnpuh9b): "it used to film over their shoulder, now it
  films from the [victim] but it's obscured by the hull". The director's
  hidden-victim rule cut to 3.5 m behind Tyson, who stood in a landing
  craft, and the craft's ramp filled the picture for six seconds. The
  reverse is now tried first in the depth picture: it must see the man it
  kills and not be all wall, else the crane, else no reverse at all and the
  bullet rides on (`st.noReverse`). Re-filmed as 6neh2d3f3h, then every
  single kill with it (91 over 21 recordings, the 28 the re-record had
  dropped among them; air kills are the volley and were left).
- **One shot that kills two is one part.** A shell into a crewed hull
  writes two kill lines at one moment; a compilation filmed both and showed
  the same footage twice (2026-11-04, almighty-_- on Rush to Baghdad).
  `playerReelsOf` merges a killer's kills within `PLAYER_REEL.sameMoment`
  (1 s) into one part with `count`, labelled "3 of 4 - 2 kills".

- **One round, two uploaders, one Short a moment** (2026-11-07, Chief's and
  Jan's halves of Soletschnogorsk both filmed XStefX's 13-kill streak). The
  runner reads the recording's `round` (its twins and their
  `roundOffsetSeconds`) and drops a pick a twin already has, live or filmed
  earlier in the run: a compilation by its kind and player, a single kill by
  killer, victim and round time within 1.5 s (`roundTwinMoments`).

- **Show where the shot came from** (2026-11-09, `ckpzprzru7`: "an almost
  300 metre kill so the shooter is off screen ... we need to zoom into the
  shooter at the end"). A single kill whose take never showed the shooter
  flies back up the round's path to him after the hold (`REVEAL` in the
  director), cutting to him where the way in passes through the level.
- **A streak's long shots go back to him too** (2026-11-09, `bb2ec8rr35`:
  "the long range sniper kills has no trace back to the shooter"; "the mini
  map shows between kills even though the player doesn't actually move").
  A compilation part of 80 m or more reveals (`REVEAL_PART`); the map card
  needs him 80 m from where the gap began, not 80 m of strafing; the
  reveal's end pose is fixed once judged clear (it followed a strafing
  sniper into his bunker's wall). Re-filmed as `yt7n9d5ejd`.
- **A long shot at a man in a hull counts** (2026-11-09: "we're missing
  some of the longest shots", a 428 m K98 kill of a PT boat's crewman on
  Midway; "a gun shot should not exclude anything"). `kindOfKill` needed
  both men on foot; now the victim may be in anything but a plane, a tank
  included when it lives through the kill (a tank-buster is one that dies
  with its man). When a long kill is missing, check the kind before the
  recorder's range. A round at a man in a hull is aimed at his seat, over the
  water: aimed at a PT boat's keel it fell in 20 m short. The brown sphere
  off an Elco80's stern is its loaded mine, not the round.
- **Less slow motion** (2026-11-09: "in general we're slowing down too much
  in the slow mo"). A round's time on screen grows with the distance
  (`SHORT_PACE`, 0.45-1.4 s), the hold on the hit is 1 s at 0.6x (the round
  cam's `hold` override), stretches and volleys slow less.
- **Close kills in a compilation are real time, cut between angles**
  (2026-11-09, `zz2hpmkt7m`: "super tight (close quarters) so the slow down
  kind of is annoying ... different angles and edits to keep it feeling
  fresh"). A burst's kills on foot within 60 m are the fast cut (`QUICK`,
  `filmQuick`); the one take behind him is `--burst-take`.

- **A man on foot who kills a tank is a Short** (2026-11-09: Arnhem's 351
  kills made none; "surely more interesting things happened than that").
  Kind `tank-buster`, in the picker, the API's `ShortKinds`, the strip's
  Vehicle filter and badge. A new kind must reach all four, and the API
  must be deployed before one is uploaded (it refuses unknown kinds).

- **A tank's shell into a plane is the shot to look for** (2026-11-10,
  `57su2b7u9y`: "incredible, this should be something we look for"; "favour
  shots from ground to air ... the longer distance the more epic"). Kind
  `tank-to-air` (base 120, every one of a round a Short, `ALWAYS`); an AA
  mount's kill of a plane stays ground to air (`AA_HULL`); shots at planes
  from the ground count their metres at 5 a point. Re-filmed The Clëäner's
  431 m IS-2 shell on a Ki-67 (Manchuria) under it. A gun named by its bore
  (`20mmType2Multi_wide`) is an AA mount, not a tank; and the best of every
  kind is a Short whatever `--max` (the 418 m sniper shot had fallen off).
- **Rounds under the ground on Manchuria** (2026-11-10, `57su2b7u9y`,
  `b4h2mruapn`): FHSW's `BulletCatcher` cubes 20-40 m under its tanks were
  in the drawn hull's box, so the round cam aimed every shell at a driver
  12-19 m under his tank, and the gun's pooled round stand-ins hang hidden
  19 m under it too. `ReplayHull` hides the catchers; `hullRadius` and the
  seat box (`drawnBox`) measure visible meshes only; `seatPointOf` refuses a
  seat farther than 1.5 radii from the origin. `--trace` records the camera
  and the ground under it: read it before guessing at a camera fault, and
  after a camera fix film one affected Short and sheet it before the batch.
- **A kill nobody heard fire is not filmed** (2026-11-10, `g5e45cdyby`: "no
  sound when the player fires"): a roundless kill needs the killer's
  recorded trigger within 1.5 s (`heardShot`).
- **Quality checks hold a Short back** (2026-11-10: "we should be picking up
  some basic issues like this when we export"). `QA` in the runner: the lens
  or the chased round under the terrain, a silent sound; written as
  `checks` in meta.json, "held back" in the log, never uploaded without
  `--ignore-checks`. When a run holds one back, look at why before sending
  it: film it alone with `--trace` (`--player=<name>` picks one player's
  streak or compilation) and read which camera state went under. The
  director's poses now stay `groundClear` over the ground too (Delta74's
  428 m battery shot, 17.6 m under its pit, 2026-11-10).
- **An air kill he never fired for is not a volley** (2026-11-11,
  `hj24y7v6zr`: "the first kill doesn't show, it's just them flying around").
  A pilot who crashes after being hit is credited to the last man who hit
  him: Tavington was 282 m off and silent for 3 s as OWLCAT's Spitfire went
  into a hill, and the volley camera behind him showed his own plane flying
  on. Every real air kill measured fired within 0.05 s of it.
  `volleyHeard` (his trigger within 1.5 s) gates every air part and single
  air Short. Of 301 live, it took down that compilation (4 real kills left)
  and `cj4z37wab2` (an SBD's bomb on a Zero parked on a carrier deck).
- **The editor's chase at 5 fps was the hull cast**, not the recording
  (2026-11-10): `replay-gunfire.js` now tests a hull's sphere before its
  meshes. Measure frame times per round-cam state in the page before
  blaming sample rates.

- **Retention: unwatched Shorts go after a week** (2026-11-12: "for any
  short >= week old with 0-1 views we get rid of"; rolls too). The nightly
  job runs `scripts/shorts-prune.mjs` after its uploads (`POST
  /stats/shorts/prune`, the upload key; `--dry-run` lists and changes
  nothing; `SHORTS_PRUNE=0` skips it). A player's studio share is never
  pruned. A pruned Short stays as a tombstone (`PrunedAt`, files gone, bytes
  0) so `/keys` still returns its kill and the runner never films it again.
  Never prune by hand outside the nightly unless the owner asks.
- **Action rolls share the strip** (kind `roll`, 16:9, 4K plus an HD copy,
  `features/action-roll`): made by `scripts/action-roll.mjs`, not this
  runner; uploaded in 80 MiB parts because Cloudflare passes 100 MB a request.
  Each also carries a 720p link copy under 48 MiB (`PUT <slug>/link-video`)
  that the share link names: Discord leaves a linked video over ~50 MB as a
  bare link. A Short whose share link will not embed: check the size of
  whatever `og:video` names.
  The nightly job films one roll a week (first night of the ISO week,
  `scripts/roll-weekly.mjs`, `ROLL_WEEKLY=0` skips it).

## On the Mac (2026-11-07)

The owner's machine is now an M5 Max MacBook Pro: no systemd (the nightly
timer is the Linux PC's), no Playwright Chromium, no extracted model trees.
Add `--channel=chrome` (the installed Google Chrome); `--gpu` is Metal there.
`modelsOf` reads the mod's `models.json` from the live play site when the tree
is not on disk. A recording loads in about a minute and a Short films in
11-13 s. `shorts-watch.sh` works there (BSD `stat`).

## The pieces

| Piece | Where |
|---|---|
| Picker (pure, node) | `tools/bf1942-models/viewer/replay-shorts-pick.js`; tests `tools/bf1942-models/tests/test_replay_shorts_pick.py` |
| Render and upload | `scripts/shorts-runner.mjs` |
| API | `api/Shorts/`, routes `/stats/shorts...`; tests `tests/api/Shorts/` |
| Strip and player | `tools/bf1942-models/viewer/play/replay-shorts.js`, wired in `play/recordings-feed.js`; client calls in `recordings-api.js` |
| The camera the Short opens on | the creator's round cam, `replay-roundcam.js` (`replay-creator-studio` skill) |

## Making Shorts (the whole job, no hand-off)

Run on this PC with the GPU. One headless browser at a time: check
`pgrep -c headless_shell` first.

```
node scripts/shorts-runner.mjs --recordings=6 --max=2 --gpu                 # film the newest, keep the files
SHORTS_UPLOAD_KEY=$(cat ~/.config/bfstats/shorts-upload-key) node scripts/shorts-runner.mjs --upload-filmed
SHORTS_UPLOAD_KEY=$(cat ~/.config/bfstats/shorts-upload-key) node scripts/shorts-runner.mjs --recordings=6 --gpu --upload
node scripts/shorts-runner.mjs --recording=<slug> --max=1 --gpu             # one recording
```

Each Short is the kill shot (about 10.5 s) with sound when `--sound` is
given. Other options: `--kill=<t>:<victim>` (film that kill whatever was
clipped before; it reaches every recording of the run, so with more than one
`--recording` write `--kill=<slug>:<t>:<victim>`; it reaches the uploader's
featured shot too), `--refilm-live` (film every live Short again and replace it;
one the picker no longer passes comes down), `--override=<viewer file>`
(film with a local viewer file in place of the live one, to check a viewer
change before it deploys), `--real-time` and `--real-view=...` (an
experiment the owner turned down, below). To keep a filmed kill from ever being uploaded, rename its
`meta.json` to `meta.rejected.json`; the runner then treats it as clipped.
`--refilm-live` re-films single kills only; compilations are not in it.

**Re-recording everything** (the owner, 2026-11-04: "while it's young we
can afford to re-record"): film every recording that has live Shorts with
`--fresh` (every pick, as if none were live) into a new `--out`, with the
`meta.rejected.json` markers of the old caches copied in at the same paths,
then per recording take down its live Shorts (never a creator's, never the
week's ASMR) and `--upload-filmed --out=<new out>/<slug>`. A recording with
nothing filmed keeps its old ones. Done 2026-11-05 over 21 recordings, into
`~/.cache/bfstats-shorts-rerecord`: 158 live before, 171 after, about six
hours. What it took:

- `--budget=60`: a round with twelve Shorts (El Alamein, Rush to Baghdad,
  Kharkov) runs 22-25 minutes and was abandoned at the default 25.
- One page's sound is 1200 s (`AUDIO_SPAN`) and renders in 75-90 s, so the
  sound step has its own five minutes (`SOUND_TIMEOUT`); at 300 s Kharkov's
  eleven Shorts lost their sound with "Offset is outside the bounds of the
  DataView".
- A take-down that fails on the network (curl 000) leaves the old Short up,
  and if the new one has its key the upload answers with the OLD slug and
  video. Re-check every recording's keys after a swap, retry the delete,
  and upload that folder again.
- Check each new Short before it goes up: an automatic test for runs of
  white or black frames holds a Short back, then look at it. Coral Sea's
  and Bocage's white skies were false alarms. These were real faults:
  Marduk's Savoy streak (fog, the bunker upside down), Paciencia's on Bocage
  (16 s behind a parked Mustang), Maj.MerliN's Stalingrad tank kills
  (inside the fireballs), and skandia's AA shot on Makin (the lens in
  foliage, the gun's raw template name).

**Nightly.** `scripts/shorts-nightly.sh` runs at 03:30 from the systemd user
timer `bfstats-shorts.timer` (units in `deploy/shorts-nightly/`, installed in
`~/.config/systemd/user/`): the 10 newest recordings, 3 Shorts each at most,
`--gpu --sound --upload`, log `~/.cache/bfstats-shorts/nightly.log`. It waits
for another headless browser to finish, and skips the night after 30 min.
Uploads are not reviewed: look at what it put up
(`curl -s https://bfstats.io/stats/shorts`) and delete a bad one.
`systemctl --user start bfstats-shorts.service` runs it now.
On the Mac (since 2026-11-07) it is the launchd agent `io.bfstats.shorts`
(`deploy/shorts-nightly/io.bfstats.shorts.plist`, installed in
`~/Library/LaunchAgents/`), same time and log; a Mac asleep at 03:30 runs it
on waking. `launchctl kickstart gui/$(id -u)/io.bfstats.shorts` runs it now.
It runs from its own checkout, `~/projects/skandia/bfstats-nightly`, which it
brings up to `origin/main` first (a working checkout is often on a branch), so
a change to the runner or the picker reaches the nightly once it is on main.
On the first night of each ISO week it also makes the week's ASMR
(`--asmr-mix=week`, uploaded) and stamps `~/.cache/bfstats-shorts/asmr-<week>.done`;
its log is `asmr-<week>.log` beside it. Delete the stamp to have it made again.
`--max` counts the recording's single-kill Shorts already live or turned down
(2026-11-07): before, it capped only the new picks, so every night topped each
of the ten newest recordings up by three more.

Filmed Shorts are kept in `~/.cache/bfstats-shorts/<recording>/<kill>/`
(`short.mp4`, `poster.jpg`, `meta.json`). Look at every one before it is
uploaded: a contact sheet (`ffmpeg -i short.mp4 -vf "select='not(mod(n\,24))',scale=180:320,tile=7x2" -frames:v 1 sheet.jpg`)
and the poster. A meta.json can be corrected by hand before `--upload-filmed`
(the title is free text). Then confirm on the live API:
`curl -s https://bfstats.io/stats/shorts | python3 -m json.tool`, and the
strip at `https://play.bfstats.io/play/index.html?tab=replay`.

Timings: 2.5-4 min to load a recording (once per recording), about 20-25 s
to film a 10.5 s Short.

## Production access: just do it

The cluster is reachable from this PC directly: `kubectl --context hetzner
-n bf42-stats ...` (this IP is allow-listed; no tunnel, no `KUBECONFIG_B64`,
that is the cloud-session path in `hetzner-cluster`). The owner has given a
standing OK for kubectl, so do not stop to ask, and do not hand the owner a
command to run.

- **The upload key** is the secret `bfstats-shorts` (key `upload-key`) in
  `bf42-stats`, mounted into the API as `Shorts__UploadKey` (optional in
  `deploy/app/deployment.yaml`); the runner's copy is
  `~/.config/bfstats/shorts-upload-key` (mode 600). Created 2026-11-03. If
  the file is missing, read it back from the secret:
  `kubectl --context hetzner -n bf42-stats get secret bfstats-shorts -o jsonpath='{.data.upload-key}' | base64 -d > ~/.config/bfstats/shorts-upload-key`.
  Never print the key into the conversation. After creating or changing the
  secret, restart the API so it reads it:
  `kubectl --context hetzner -n bf42-stats rollout restart deploy/bf42-stats`.
- **If the public route refuses an upload** (Cloudflare, ingress), go round
  it: `kubectl --context hetzner -n bf42-stats port-forward svc/bf42-stats-service 9223:8080`
  and upload with `--to=http://localhost:9223`.
- **Files on the volume.** Shorts live on the recordings volume under
  `shorts/<slug>.mp4` and `.jpg`, with a database row each, so the API is
  the way in (a file copied onto the volume without its row shows nowhere).
  To inspect or fix files, use the FileBrowser pod the way mesh assets do
  (`bfstats-mesh-assets` skill): `kubectl exec` or port-forward
  `svc/filebrowser-service`. Deleting a Short: `DELETE /stats/shorts/<slug>`
  with the key header.

## Guards: never leave a run unattended (the owner, 2026-11-03)

"Add guards to the expected time, and intervene when stuck, I don't ever
want to prompt you again." A run once sat 27 minutes on a page that never
loaded while the session waited.

- **The runner bounds itself.** Every step in the page (a frame, a seek, the
  sound) has 45 s (`STEP_TIMEOUT`); a recording, load to sound, has 25 min
  (`RECORDING_BUDGET`). Past either the recording is abandoned ("abandoned
  <slug>"), every browser process under the runner is killed and a fresh
  browser takes the next. A heartbeat logs the phase and the frames written
  every 30 s. The runner writes `<out>/runner.pid` and kills its browser on
  SIGTERM, so a stopped run leaves nothing on the GPU.
- **Every run of yours is watched.** Start it with its output going straight
  to a log file (no `| grep` into a file: grep block-buffers and the
  heartbeat arrives late), then put `scripts/shorts-watch.sh <log>
  <out>/runner.pid` under a Monitor (re-arm it at its 30 min expiry). It
  passes on started/filmed/uploaded/abandoned lines, says STALLED when no
  frame has been written for 6 min while filming, kills the runner (FROZEN)
  when the heartbeat stops for 2 min, and says ENDED with the last lines.
  On STALLED, FROZEN or an abandoned recording, act at once: stop the run by
  its pid file, check `pgrep -c headless_shell` is 0, and resume with
  `--recording=` / `--skip-recording=` or `--refilm-live --recording=`. Never
  wait for the owner to ask how it is going.
- **Expected times** to judge by: a recording loads in 1-4 min; a kill Short
  films in 20-30 s; a reel or compilation in 70-110 s; the sound for a
  recording's Shorts in under 30 s; an upload in under 15 s.
- **Stopping a run:** `kill $(cat <out>/runner.pid)`. Never `pkill -f` or a
  `ps | grep` loop from the Bash tool: the pattern matches the tool's own
  shell and kills it (exit 144), twice on 2026-11-03.

## Order on a change

1. Code and tests: `python3 -m unittest test_replay_shorts_pick test_recordings_api`
   from `tools/bf1942-models/tests`, `dotnet test tests/api --filter Shorts`,
   then `./scripts/verify.sh`.
2. Push to main: Jenkins deploys the API and the viewer (mesh image). Wait
   for both before uploading: `curl -s -o /dev/null -w '%{http_code}' https://bfstats.io/stats/shorts`
   is 200, and the live `replay-shorts.js` has your change.
3. A change to how a Short is filmed (the round cam, the recipe, the
   runner) only reaches Shorts filmed after it is live: re-film them
   (`DELETE` the old ones first, or the key returns the old Short).

## Verifying locally

Run the API on :9222 with a throwaway key and a scratch recordings folder
(`Recordings__Path=<scratch> Shorts__UploadKey=local-test-key dotnet run`
in `api/`), upload with `--to=http://localhost:9222`, and open the viewer's
`play/index.html?tab=replay&api=http://localhost:9222`. Playwright's bundled
Chromium has no H.264: drive `/usr/bin/google-chrome-stable` to play the
videos.

## Pitfalls already paid for

- **Over the shoulder of a tank was inside the mantlet**: a soldier's 2.4 m
  off the muzzle. The round cam now frames a hull by its radius
  (`HULL_SHOULDER`, 2026-11-02). If a Short opens on a wall of armour again,
  that is where to look.
- **"null" in a title**: some kill lines name no weapon; the picker takes the
  round's weapon, and a title drops the weapon when neither has one.
- **The poster on the hit flash**: the runner picks the frame after the hit
  whose brightness is nearest the middle (`posterFrame`).
- **A kill the page ties no round to** is skipped ("the page ties no round to
  the kill"); the next run will not retry it unless it is picked again.
- **The first page load can come up before the hulls are built**, and the
  shoulder shot then falls back to the soldier's. The runner waits 8 s after
  the status line; raise it if a Short opens inside a hull.
- **Sound** (`--sound`): the page's AudioContext is swapped for an
  OfflineAudioContext at 38.4 kHz (1/30 s is exactly ten render quanta) that
  renders one frame of audio per filmed frame, and says it is `running` (the
  page gates sounds on that). An offline render gives its buffer only at its
  end, so each page renders 300 s at most and the Shorts' stretches are cut
  out after the last one; ffmpeg muxes AAC. In bullet time the sounds play at
  normal speed against the slowed picture.
- **His own view from a tank** (`--real-view=pov`) is the replay's seat view:
  in 9:16 a letterboxed sight band, the barrel off to one side, the target
  out of frame (2026-11-03, the Tiger on Meuse). Hence chase for everything.
- **A failed recording download is not a verdict.** A run once got error
  bodies for four recordings, parsed them as empty rounds (0 candidates), and
  `--refilm-live` took down three good Shorts as no longer passing. The
  runner now refuses a recording that is not 200 or has no kills, never takes
  down Shorts of a recording with no candidates, and retries network
  failures (`fetchRetry`). A run cut short is resumed with
  `--refilm-live --recording=<slug>...` (or `--skip-recording=` for those
  done); a Short taken down by mistake comes back with
  `--recording=<slug> --kill=<t>:<victim> --upload` (the kills are the
  folder names under `~/.cache/bfstats-shorts*/<slug>/`).
- **Size is not capped for storage** (the owner, 2026-11-04: "I'm happy to
  resize the volume"). The API takes a video of 90 MiB, just under the
  100 MB Cloudflare passes in one request; the runner re-encodes only over
  90 MB (`fitSize`). Under the old 40 MiB every minute-long compilation was
  re-encoded, about seven minutes each. One refused upload never stops the
  rest of the recording's.
- **An upload that fails "fetch failed" or 524 is the network**, not the
  file: Cloudflare gives a request 100 s, and a slow link misses it with
  33 MB. Re-run `--upload-filmed`; a kubectl port-forward to the API does
  not help (it could not carry 33 MB at 390 ms round trips). To upload one
  filmed folder alone:
  `--upload-filmed --out=<that folder>` (never the whole cache: it holds
  Shorts that were taken down on purpose).
- **An upload never replaces a live Short.** The API is idempotent on the
  kill's key: `--upload-filmed` of a kill already live answers "uploaded"
  with the old slug and keeps the old video (2026-11-04). `--refilm-live`
  deletes before it uploads; by hand, `DELETE /stats/shorts/<slug>` first,
  then confirm the live `.mp4` size (with `?cb=`) matches the new file.
- **Every upload 401 "The upload key is not right"** (2026-11-03): the secret
  was made with `--from-file` from `openssl rand -hex 32`, whose newline went
  into the secret. The API now trims the configured key; still write the
  key file with `printf '%s'`. A changed secret only reaches the API when its
  pod restarts (a deploy, or `rollout restart deploy/bf42-stats`).
