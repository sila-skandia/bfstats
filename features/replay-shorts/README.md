# Replay Shorts

The request (2026-11-02): Shorts in the REPLAY feed, cut from the shared
recordings. A machine finds interesting kills (air to air, ground to air,
tank to tank, long shots), films each in the creator's Shorts look, and
uploads it through an API, on a schedule. The feed shows the week's Shorts
in one horizontal strip among the recordings. The cards borrow YouTube's
fields.

## Status

Built (2026-11-03): the picker, the render job, the API and the strip and
player. Section 5 (the recording cards) is not done. The render job runs by
hand on this PC for now; a timer is not set up.

## As built (2026-11-03)

The design below is the plan; where the build differs, this section wins.

| Piece | Where |
|---|---|
| Picker | `tools/bf1942-models/viewer/replay-shorts-pick.js` (`shortCandidates`, `pickShorts`, `titleOf`, `shortKey`); tests `tools/bf1942-models/tests/test_replay_shorts_pick.py` |
| Render job | `scripts/shorts-runner.mjs` |
| API | `api/Shorts/`, routes under `/stats/shorts` (not `/api/shorts`), tests `tests/api/Shorts/` |
| Strip and player | `tools/bf1942-models/viewer/play/replay-shorts.js`, wired into `play/recordings-feed.js`; client calls in `recordings-api.js`; tests in `tests/test_recordings_api.py` |

**Classing a kill.** A hull's kind comes from the tree's `models.json`
(`category`, `hitpoints`): `air`, `sea`, armour (land with 100 hit points or
more that is not a gun on the ground), else land. Air to air and ground to
air need the victim in an aircraft; tank to tank needs armour on both sides
(a jeep, a lorry, a mortar is not); a long shot is foot on foot, 100 m or
more, an aimed weapon. The kill must have a round the dossier ties to it and
both men live in the recording (`fresh`). Score: a base per kind (air to air
100, ground to air 90, tank to tank 70, long shot 50) plus distance, plus 15
for a multi-kill. A recording gives at most three, the best of each kind
first, none within 8 s of another, none already clipped (the API's keys).

**Filming.** Not MediaRecorder in real time (section 2's plan): the runner
steps the replay clock frame by frame, as `CLOUD_RENDER_TEST.md` measured.
The page is the live play site with `&shots`; the creator's own
`recordShort` with the studio's Shorts recipe films the kill, MediaRecorder
is stubbed and each composed frame is read off `recorder.source`, and
`performance.now()` is a virtual clock moved 1/30 s a frame so the freeze on
the kill holds its length. ffmpeg encodes H.264 (CRF 22, capped 12 Mbit/s).
The poster is the frame of the three seconds after the hit whose mean
brightness is nearest the middle (ffmpeg `signalstats`), so not the white
of the hit flash. Silent: the sound tap is real time only. On this PC's
Intel GPU (`--gpu`): about 25 s to film a 10.5 s Short, 2.5-3 min to load a
recording, once per recording.

**Uploading.** `X-Shorts-Key` against `Shorts__UploadKey`, from the
Kubernetes secret `bfstats-shorts` (key `upload-key`, optional in
`deploy/app/deployment.yaml`); a signed-in admin can upload too. The same
kill uploaded twice returns the first (keyed `slug:killTime(2dp):victim`).
Files go on the recordings volume under `shorts/` and count against the
recordings' quota.

```
node scripts/shorts-runner.mjs --recordings=6 --max=2 --gpu            # film the newest, keep the files
SHORTS_UPLOAD_KEY=... node scripts/shorts-runner.mjs --upload-filmed     # upload what was filmed
SHORTS_UPLOAD_KEY=... node scripts/shorts-runner.mjs --gpu --upload      # both in one run
```

Files are kept under `~/.cache/bfstats-shorts/<recording>/<kill>/`
(`short.mp4`, `poster.jpg`, `meta.json`). `--to=<api>` uploads somewhere
else (a local API).

**Real time and sound (2026-11-03).** The owner asked for the kill again
unedited after the edit, and for sound. A Short is now the edit, then 7.5 s
of the round at 1x (5 s before the kill to 2.5 s after) through the game's
chase camera on the killer, tagged REAL TIME, 18 s in all. His own view from
a tank was tried first, as asked, and dropped: the seat view in 9:16 is a
sight band with the target out of frame. Sound is rendered offline in step
with the frames (an OfflineAudioContext standing in for the page's
AudioContext), so every sound lands on its frame. The nightly run
(`scripts/shorts-nightly.sh`, `bfstats-shorts.timer`, 03:30) films with both.

**Own goals (2026-11-03).** A fifth kind, `own-goal`: a crash, a fall or a
man's own charge (`ownGoalOf` in the picker), filmed with the chase camera
on him and a WASTED ending (`filmOwnGoal` in the runner). Measured on four
rounds: 1-14 a round, Battle of Britain and Savoy mostly plane crashes. The
picker ranks each kind's best by score, so a good crash takes a slot from a
third kill.

**Reels and the volley (2026-11-03, later).** Own goals and spawn deaths
became one reel a round each (`reelOf`, `filmReel`): one alone was too quick
or too forced, and WASTED went. Air to air stopped riding a bullet: the chase
camera behind the attacker at 1x, slowed at the kill, the victim's fall held.

**The volley stays behind the killer (2026-11-04).** The owner: at the kill
it was "snapping to the victim and loses context", and "I like the slo mo
bullets firing as the kill is received". The camera no longer cuts to a
stand on the victim: the chase stays behind the attacker, the clock eases
from 1x to 0.3x over the 0.7 s before the kill, and the lens widens only if
the victim would leave the frame. A victim dead ahead was hidden behind the
attacker's own plane (BF109 on SBD at 247 m showed only debris), so when the
victim falls inside the attacker's outline on screen the eye rises 3 m for
the part; the SBD then shows above the BF109 as it blows up.

**Filters, the end of a kill, more air compilations (2026-11-04).**

- The strip has filters, All, Air, Ground to air, Vehicle and Soldier (the
  owner: "use an asset icon from the game itself, maybe the radio icons").
  Each wears the radio menu's own 64x32 plate (`menu/Texture/Radio/
  icon_air_support`, `icon_air_spotted`, `icon_armor_spotted`,
  `icon_inf_spotted`), now in the HUD pack (`extract_hud_pack.py`
  `SPRITE_DIR_GLOBS`, 55 plates, published to `maps/_shared/hud/`). A filter
  pages its kinds from the API (`GET /stats/shorts?kind=a,b`; a filter naming
  no known kind is none) and the player follows it. The choice is kept in the
  browser. Crash reels are under All only.
- A kill shot's last half second flew across the map: after the hold the
  round cam handed the camera to the man it killed, who had already respawned
  elsewhere. Shorts now leave the camera where the hold put it
  (`afterHit: 'stay'`, the runner's `armCreator`).
- The nightly reads only the ten newest rounds, so older rounds with air aces
  never had their compilations: a scan of all 24 found eight players with 5+
  air kills (Chief-H.E.M.P 18 on El Alamein and 10 on Coral Sea, among
  them). `--kinds=player-air` films only air compilations (and
  `player-vehicle` only the others).

**Players, streaks, bursts and the dip (2026-11-04, later).**

- Each Short records its players (`ReplayShortPlayers`: its killer and
  everyone killed in it), and the strip finds a player's Shorts ("Find a
  player", `GET /stats/shorts/players`, `?player=`); a name in the player
  opens that player's Shorts. The name and count sit 160 px lower, clear of
  the card's kind badge.
- Streak compilations (`streakReelsOf`, kind `streak`): a player's kills in
  one life, 10 or more, a round's two longest. Five best kills in order with
  a "N KILL STREAK" badge that ticks on each hit; the kill that ended it
  filmed last under "Ended by X" when it can be (14 of 26); a closing card
  with the count and its end. Measured on 24 rounds: 33 streaks of 10-45.
  (Superseded the same day: on foot a streak is its stretches, from a hull
  its best four kills; both in the style below, "A streak on foot is its
  stretches".)
- Kill bursts (`burstReelsOf`, kind `streak`): the most kills a player made
  in 60 s, 5 or more, a round's two best not already a streak. One take
  behind him, the clock fast between kills (up to 4x, to about 30 s of
  video) and slow on each, a ticking "N KILLS"; the card says "N kills in S
  seconds". 26 on 24 rounds.
- Between a compilation's parts, the dip from `EDITS.md`: the last ten
  frames quicken (every third dropped), six go to black, the next part
  comes up over six. Air compilations keep their own fade.

**Creators share, and Battlefield ASMR (2026-11-04, later).**

- Creators share studio clips as Shorts (the owner: live at once, any
  signed-in player). A clip recorded in the studio still downloads; when it
  is 9:16, an MP4 (Chrome, Edge, Safari) and of a shared round, a dialog
  offers Share as a Short (`replay-share.js`): a title, the bfstats.io
  sign-in recordings already use (no new auth), a poster from the clip's
  middle, `POST /stats/shorts/share`. Kind `creator`, credited to the
  player's first linked in-game name (none linked: refused, as for
  recordings), ten an hour per account, his or an admin's to take down
  (`DELETE` checks `CreatorUserId`). The strip says "Shared by NAME" and
  has a Creators filter. Not tried end to end against production: that
  takes a real player's sign-in.
- Battlefield ASMR (`asmrReelOf`, kind `asmr`), one a round: up to six
  moments of fire, two of a kind (an M1 Garand's whole clip to its ping, the
  weapons whose sound table has `eject`; a long burst of automatic fire; a
  tank's gun twice or more, allied armour first), each over the shooter's
  shoulder at 1x with the game's sound and the weapon's name, joined by the
  dip. `--kinds=asmr` films only these.
- **One ASMR a week, slowed sound (2026-11-04, later).** The owner: "1 asmr
  clip a week ... it should include sounds slowed down. Right now only the
  footage slows down". A round pass no longer films ASMR unless asked
  (`--kinds=asmr`); the week's one is `--asmr-mix=week`, a cross-round mix
  whose theme takes turns by the week (big guns, machine guns, Garand
  pings). In a take the offline audio is stepped at the round's pace
  (`speed / FPS` a frame) instead of the video's, so the render holds the
  round's sound in real time; `__audioWavs` then reads it back like tape,
  one frame of samples per entry of the range's third element
  (`slowedSound`: each kept frame's share of the round, dropped dip frames
  folded into the one before). At the 0.25 tail a shot plays four times as
  long, two octaves down. The J-cut handles a slowed range by frames.
- **No map card for a pilot (2026-11-04, later).** "No mini map for
  planes": the card skipped only air-to-air kills, so a 109's bombing run on
  tanks (dr9mqnqfwv, Battleaxe) still drew one. Every kill now says whether
  its killer was flying (`flying`, the picker), and a pair with either kill
  from the air gets no card.
- **Walls and planes in the bullet chase (2026-11-04, later).** On
  23jay's streak (ernu2e2a79, Battleaxe) the Tiger's first kill showed 7 s
  of bunker wall and the second flew into a Spitfire's cockpit ("chase them
  f10 style if camera permits"). The director now also turns the flight to
  the reverse when the man it kills is hidden (something 4 m or more from
  the lens drawn 2 m or more short of him, twice running) or the picture is
  mostly wall (`wall` 0.75 of it within `wallFar` 8 m); when the reverse is
  as blocked (he died inside the bunker) it is the crane, 8 m up over the
  shooter looking at him. A plane victim (`victimFlying`, the picker) is
  chased from behind and above along its flight once the round's camera is
  within 60 m (`f10`), through the hit. Re-filmed: the bunker kill is the
  shell from over the Tiger into the bunker, the Spitfire is chased as it
  is hit. `--debug-director` logs each flight's probes.
- **A gunner on a big hull is filmed at his mount (2026-11-04, later).**
  "The ASMR short has no sound on the POW AA guns": two bugs. The vehicle
  sound rack hung one patch for the Prince of Wales's eight AA mounts on the
  first, 192 m from the gunner (fixed in `vehicle-audio.js`: the patch
  sounds from the mount that fired). And the chase follows the hull, 145 m
  from his mount, with the page's ear on the camera. The director now takes
  his eye from his latest shot's launch point when it is more than
  `mountFar` (15 m) from what the chase follows, and frames him from at
  least over the shoulder. Measured on the AA piece's sound before
  mastering: -25.5 dB mean before, -9.4 dB after.

**The rest of the edits, and clean scenes (2026-11-04, later still).**

- From `EDITS.md`, built: a compilation's cold open (about 1.5 s of its
  best hit first; a streak's from its later half, a look ahead at the
  count), the J-cut (each part's sound eight frames before its picture) and
  the map card (1 s of the level's map with the player's route and "+2:01"
  when two of his kills are 20 s or more apart).
- Clean scenes (the owner: "we're going to need a way to verify a scene is
  'clean'"): a burst's take tests each kill (`window.__clean`: the victim
  inside the middle 90% of the picture, and the level's collider clear from
  the camera to his chest); under 60% seen, the take is dropped and the
  burst filmed kill by kill as the bullet chase. A burst from a hull goes
  kill by kill from the start (KillKillKill's six from inside a hangar on
  Meuse saw none); one with under three filmable kills is not a Short.
- A burst that is one blast (a grenade's 7 kills in 3 s) is the kill shot
  on its round, the count jumping to its total as it lands.
- No bot is ever in a Short (`isBot`, the player row's `ai`).

**A streak on foot is its stretches (2026-11-04, latest).** The owner on
ration's 16 on Baytown (`2tenez5h7c`): the five longest kills were shown,
from behind the victim, with no sides and a 66 s run time
(`STREAK_REVIEW.md`). Now:

- The picker splits a streak on foot into stretches, kills under 10 s apart
  (`pickStretches`, `STRETCH`), ranks them on kills, density, close range,
  two kills within 2 s, a weapon change and kills of the man who ends it,
  and takes the best within about 22 s of video, in time order. The kill
  that ended the streak joins his last kill within 8 s of it. A streak with
  any kill from a hull stays kill by kill.
- Each stretch is one take behind him (`filmStretch`): fast between kills
  (up to 2.5x), slowed on each, the counter ticking on every hit, so no
  number is skipped inside a take. From 3 s before each kill the camera is
  over his shoulder toward the man he kills (`AIM`), on whichever shoulder
  the depth picture shows clear: the chase alone points the way he faces,
  and the first take saw 1 of 4 kills by a wall (all of them after). Takes
  are joined by the dip alone: a "+0:12" card between them "doesn't really
  add value, the fast forwarded gameplay ... speaks for itself" (the owner,
  2026-11-04). Kills not shown between two takes roll by on the count as
  the next fades in.
- Sides: his name pill carries his nation (`sideOf`, the soldier template),
  a gold marker over him, a red tag over each man he kills as he dies, and
  a kill feed row on each hit, gold for him and red for the other side.
- The ending stays with him: over his shoulder toward the man who kills
  him, tagged as he comes, the feed row red on gold; at the death the
  camera moves side on to both men (the side that sees both past the
  walls), "pipi ends it / after ration killed him 3 times" when he had
  killed him twice or more, grey, held, then the closing card.
- Measured on ration's 16 (filmed locally, 2026-11-04): 33.8 s against
  66 s; kills 7-11 and 12-15 and 16 into his death, every kill seen.
- The cold open is a close kill from the later half (two at once, or of the
  man who ends it). The first take carries the title and the closing card
  the count, both in the game's word: "16 kill streak" (the owner,
  2026-11-04: "use the terminology streak").
- A streak from a hull stays a shell shot a kill (the owner on rafal_pl's
  18 from a Panther bunker on Ortona, `kevffebkkt`: "already pretty good
  ... the raw sounds are great, but it's slightly clunky") in the same
  style: his side in the name pill (`sideOf` reads his own soldier's
  template while he sits in the hull, FHSW's `FMGermanSoldier` is German),
  the man he kills tagged red, the kill feed row on the hit, the count
  rolling through the kills between shots as the next fades in, the title
  over the first, a 1.2 s lead-in after the first shot (the same bunker
  five times over), and his death filmed from his side (`endTake`). No map
  card for a man who moved under 80 m, the first included (it drew a dot
  and "+1:20").
- A streak's key is its first kill, whichever kills it shows; the runner
  also counts a live Short with the same reel victim as that streak's, so a
  changed choice never films it twice. `--player=<name>` films one player's.

**What to build next** is in `IDEAS.md`: per-player packages (Player of the
Round, the streak, Nemesis, a vehicle's life, a 30 s recap) and new single
moments, from web research checked against four real rounds.

**Spawn and die (2026-11-03).** A sixth kind, `spawn-death`: a man killed
within 5 s of a real spawn, filmed from the spawn with a life clock and the
WASTED ending. 0-8 a round on the four measured.

**Real time was dropped (2026-11-03)** the same day: the chase camera points
the way the killer faces, so it missed the hit. Shorts are the kill shot
with sound, no punch, shake or flash; the hold on a hull draws back and
follows the wreck (`features/replay-creator-view`, "The hold on a hull").

**Filters in the address (2026-11-04).** The owner: "make sure the filters
update the URL, so people can share them". The strip writes
`shorts=<filter id>` and `shortsBy=<raw player name>` into the address as
they change (`shortsFilterAddress`, replaceState, no history entry), and a
page opened with them shows that filter and player whatever this browser
remembered (`shortsFilterOf`). Opening a Short keeps them beside `short=`.

**The strip** shows only on the unfiltered feed and only when the week has
a Short; a failing Shorts call leaves the recordings as they were. **The
player** opens with `&short=<slug>`; Watch the round fetches the recording
and opens the replay 5 s before the kill.

### On the stats pages (2026-11-04)

The owner: "on the stats site, the PlayerDetailsV4 and ServerDetailsV4 pages,
we include any shorts for that server / player".

`MmShortsPanel` sits under the replays panel on both pages' Overview tab: a
row of 9:16 posters, eight to a page, paged server-side with ‹ ›. Hovering a
poster plays the clip muted, the way BattleView's strip does. Each poster
opens the Short in play.bfstats.io's player. Like the replays panel, it asks
for nothing until it is near the viewport and stays out of the page when
there is nothing to show.

- **Server page:** the Shorts cut from recordings made on that server.
  `GET /stats/shorts?server=` goes through the recording's server index to
  the Shorts' `RecordingSlug` index.
- **Player page:** every Short the player is in. A card where they are not
  the killer says "Killed in it", or "Clipped by them" when they shared it.
  "In the Shorts feed" opens the strip with `shortsBy=`.
- **Names:** `player` and `server` now match both the site's form of a name
  and the recording's bytes (`PlayerNameDecoder.ToRecording`), as the
  recordings feed does.
- **Window:** `MaxDays` is now 3650 so a page lists all of a player's Shorts.
  The strip still asks for 7 days.
- **A player is known by the name they played under:** tragic! played
  Baytown as "ration", so that streak shows on ration's page, not tragic!'s.

Verified:
- `ShortsControllerTests.List_ByServer_IsTheShortsCutFromThatServersRecordings`;
- `e2e/stats-page-shorts.spec.ts` (server list, player roles, paging, empty);
- screenshots at 1400 px and 390 px with production's Shorts for ration
  proxied into the E2E stack.

## What already exists

| Need | Already in the viewer |
|---|---|
| A kill's distance, the killer on foot or in a vehicle, his weapon | `replay-dossier.js` (pure, runs under node), `replay-medals.js` (`LONG_SHOT = 100` m) |
| The vehicle he was in and what it is (`kind: 'air' \| 'ship' \| land`) | the recording's vehicle templates and the level's vehicle catalogue |
| A kill opened as a clip, already filmed | the creator's kill shot (`features/replay-creator-view`) |
| A 9:16 frame and a Shorts look | the studio's `Shorts` recipe (`replay-studio.js`), `916` frame |
| Rendering a clip to a video file | `replay-clip.js` (MediaRecorder), `creator.record()` |
| Driving the studio headless | `scripts/studio-probe.cjs` and its steps files |

So the pieces to build are: picking the kills, a render job, a Shorts API,
and the strip and player.

## 1. Picking the kills

A pure function, `replay-shorts-pick.js`, beside the dossier, so a node
harness tests it and the render job calls it without a browser.

For every kill in the recording (anyone's, not just the recorder's), read
the killer's and the victim's state at the kill, and class it:

| Kind | Rule |
|---|---|
| Air to air | killer and victim both in `kind: 'air'` vehicles |
| Ground to air | victim in an aircraft; killer on foot, in a land vehicle or on a stationary gun |
| Tank to tank | killer and victim both in armour (`LightArmour` / `HeavyArmour` types) |
| Long shot | killer on foot, direct fire, `distance >= LONG_SHOT`; ranked by distance |

Each candidate carries a score (long shots by distance, air kills higher
than ground, a bonus for a multi-kill or a streak at the same moment) and a
key `recording + kill time + victim` so the same kill is never clipped
twice. Only kills the recording saw both men for (`fresh`) qualify; a kill
across the map with nobody near the recorder renders as an empty sky.

At most 3 Shorts per recording, at most one per kind unless nothing else
qualifies, so one long round does not fill the week.

## 2. The render job

A headless browser on the live site, the way the BattleView page's clips
were made (2026-11-02, `features/battleview-install-page`): the Sherman
kill on Meuse River Line was Playwright driving the creator studio, opening
the kill as a kill shot, clicking Record and keeping the download. The job
does the same against production instead of a local viewer, so it films
what a visitor sees, with the live viewer and the live assets, and needs no
checkout, no level trees and no copy of the recording.

A recording's link, `replay.bfstats.io/<slug>`, goes on to
`play.bfstats.io/map.html?mod=<mod>&map=<level>&replay=/stats/recordings/<slug>.ndjson`.
The job opens that address with `&shots` added (the page's test hooks,
`window.replay`).

`scripts/shorts-runner.mjs`, on a schedule (nightly):

1. `GET /api/recordings?since=<last run>` for recordings not yet clipped.
2. For each, fetch the `.ndjson`, run the picker in node (the viewer's own
   parser, as `mk-kills.mjs` did for the Sherman clip), and ask the API
   which keys it already has.
3. One headless Chromium (Vulkan, as `studio-probe.cjs` launches it) opens
   the live page once per recording. For each new candidate:
   `replay.seek(kill - 6)`, `creator.killShotAt(kill.t, kill.victim)`,
   `studio.show()`, apply the `Shorts` recipe (9:16), click Record, wait
   for the recorder to finish, keep the download.
4. MediaRecorder gives WebM; `ffmpeg` transcodes to H.264 MP4 (Safari and
   iOS cannot play WebM reliably) and cuts a poster JPG at the hit.
5. `POST /api/shorts` with the MP4, the poster and the metadata.

**Where it runs.** MediaRecorder captures in real time, so the browser has
to render the level at full frame rate or the Short stutters. That needs a
GPU, so the job runs on this PC (a systemd user timer), not on the
production node: the node has no GPU, software rendering would drop frames,
and a Chromium holding a level is a gigabyte or two of the memory the node
is shortest of (CLAUDE.md, "Deployment constraints"). Nothing in the job
is tied to this PC beyond the GPU, so it can move to any machine with one.

A failed render (a level that will not load, a recorder that never
finishes) skips that candidate and logs it; the next run tries it again.

The runner authenticates with a service token, the same shape as the app
sign-in tokens, scoped to `shorts:write`.

## 3. The API (`api/Shorts/`)

| Endpoint | Who | What |
|---|---|---|
| `GET /api/shorts?week=2026-W45&page=` | anyone | the week's Shorts, newest or most viewed |
| `GET /api/shorts/{slug}` | anyone | one Short and the recording it came from |
| `GET /api/shorts/{slug}.mp4`, `.jpg` | anyone | the video and its poster |
| `GET /replay/s/{slug}` | anyone | the share link's page (`replay.bfstats.io/s/<slug>`), below |
| `GET /api/shorts/keys?recording={slug}` | runner | kill keys already clipped |
| `POST /api/shorts` (multipart) | runner, admin | upload one; idempotent on the key |
| `POST /api/shorts/{slug}/views` | anyone | the view counter, as recordings do |
| `DELETE /api/shorts/{slug}` | admin | take one down |

`Short`: slug, recording id, kill time, kind, killer, victim, weapon,
vehicles, distance, length, created at, views. Files go on the recordings
volume beside the recordings (`shorts/<slug>.mp4`). At ~15 s of 1080x1920
H.264 at 6 Mbit/s a Short is ~11 MB; 20 a week is ~220 MB a week, so keep
8 weeks and prune older ones unless pinned.

A Short's title is written from its facts: `Mustang downs BF109 · 2 km up`,
`Tiger kills Sherman at 180 m`, `412 m K98 shot on Bocage`. Names are
decoded for display (`PlayerNameDecoder`).

### Share links (2026-11-03)

The request: a Short should embed in Discord, playing in the chat, or at
least show its poster. A Short's share link is `replay.bfstats.io/s/<slug>`.
HAProxy already turns the replay host's path into the API's `/replay/<path>`
(the recordings' short links), so `/replay/s/{slug}` in `ShortsController`
answers it with no ingress change; `play.bfstats.io/replay/s/<slug>` works too.

The page (`api/Shorts/ShortLink.cs`) is the recordings' pattern: a refresh to
the Short in the player (`/play/?tab=replay&short=<slug>`) and the tags an
unfurl reads. `og:type video.other` with `og:video`, `og:video:secure_url`,
`og:video:type video/mp4` and 1080x1920 is what Discord plays inline; the
poster is `og:image`, the still before a click (and all an unfurl that does
not play video shows). `twitter:card player` with `twitter:player:stream`
is the same video for the other unfurlers that read Twitter's tags. The MP4
is H.264 High + AAC with `+faststart` and range requests, about 11 MB, which
Discord streams.

The player's Share button (top right, beside Unmute) copies the link; on a
touch screen it opens the phone's share sheet. Copying the address bar
instead (`play.bfstats.io/play/?tab=replay&short=...`) still unfurls to
nothing: that page is the mesh nginx's static file, the same for every
Short. A crawler rule in HAProxy could send it to the API too; not done.

Discord caches an unfurl per URL, so a Short re-filmed under a new slug gets
a fresh embed and a taken-down one keeps its old embed until the cache ages.

## 4. The strip and the player

**The strip** sits at the top of REPLAY, above the recordings: "Shorts this
week", a row of 9:16 cards that scrolls sideways (scroll-snap, arrows on
desktop). A card is the poster, its kind as a small badge, the title over
the bottom in two lines, and its views. A muted preview plays on hover.

**The player** opens on a click: one Short per screen, full height,
looping, sound on after the first tap. Scroll, swipe or the arrow keys move
to the next one, with the next video already loading. That is the trick
YouTube uses: one item per screen means each one gets watched for a second
before the viewer decides, and the next is always a flick away. Each Short
has **Watch the round**, which opens the replay at the kill
(`?replay=<slug>&t=<kill - 5>`), so a Short leads back into the recordings.

## 5. The recording cards, YouTube's fields

YouTube's card: cover with the length in the corner, the channel's avatar,
a title of up to two lines, the channel, then `views · age`. Ours already
has the cover, length, avatar, title and views and age, plus the level,
game type and server on a line of their own and a mod badge.

Changes:

- Title up to two lines, not one.
- Second line is the uploader (the channel), the third `views · age`, as
  YouTube orders them. The level · game type · server line moves into the
  cover: the level over the bottom-left, as YouTube puts a channel's
  branding on a thumbnail.
- A red progress bar under the cover for a recording this browser has
  partly watched (YouTube's "resume" bar), read from browser storage.
- The length badge as YouTube draws it: dark pill, bottom-right.

## Open questions

- Whether players can cut and upload their own Shorts from the studio (the
  same `POST`, signed in). The API allows it; the studio button is later.
