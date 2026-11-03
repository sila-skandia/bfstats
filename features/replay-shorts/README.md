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
the victim would leave the frame.

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

**The strip** shows only on the unfiltered feed and only when the week has
a Short; a failing Shorts call leaves the recordings as they were. **The
player** opens with `&short=<slug>`; Watch the round fetches the recording
and opens the replay 5 s before the kill.

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
