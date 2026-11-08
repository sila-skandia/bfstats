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
- **Under fire: the rounds going past (2026-11-07).** The owner: "record
  plenty of sounds from different weapons from the suppressed (the person
  being fired at's) point of view ... in FHSW the bullet / weapon whips as
  the rounds land close is incredible". Two halves:
  - *The crack, in the replay.* A bullet's script is its passing crack
    (`Projectile_High.ssc`, FHSW's `bulletair1..7`: full inside 10 m, open
    from 75 ms; ledger SND-19, SND-37), and only a bot's round flew it
    (`passing-rounds.js`). A replayed bullet is a tracer with no script, so
    no replay ever cracked past the camera. `spawnTracer` now hands a round
    from a `replay` group (the replay's soldiers, hulls and first-person
    gun, and another player's on a live server) to `guns.onBullet`, which
    `map.html` gives to `PassingRounds`. A round is flown only when its line
    comes within the script's reach of the ear after the script can open
    (`EffectAudio.opensAt`): a camera over the shooter's shoulder is near
    every round at the gun, and each would have held a voice all its life.
    It is let go once past the ear by its reach, or where its tracer struck
    (`land()`), its crack ringing out. It ticks on the rounds' clock
    (`guns.timeScale`), so slow motion slows it.
  - *The moments.* `underFireMomentsOf`: a man on foot, a shot whose line
    passes 0.6-6 m from his eye at least 15 m from the gun is a pass; his
    busiest 6 s with 12 or more is a moment, scored on the passes and more
    on the guns and shooters in it, cut 0.4 s short of his death. Dummy
    FireArms beside a gun, flame and bots count for nothing. Over five FHSW
    rounds: 14-90 moments a round, 25-73 passes each, under 0.1 s a round.
    The take (`UNDER_FIRE_CAM`) is the owner's style, the ground at the base
    of the hits ("Band of Brothers ... the soldiers are under fire and it
    makes this nice thumping sound of the bullets hitting the ground"): the
    camera lies 0.45 m over the ground, 1.6 m behind him and 0.9 m to his
    side, away from the men firing at him, looking 45% of the way from them to
    him so he stands in the picture with the fire beyond him. A round that
    strikes near the lens thumps (`richoground`, `richostone` within 25 m,
    wood and metal 10) while the cracks go over. It draws nothing within
    0.6 m of the lens (a hit's dust there filled the frame white). Blocked
    (the depth probe), it rises to 1.2 m behind his eye, then over him. A take
    is left out with fewer than 4 cracks and 4 impacts heard, the view still
    blocked, or 15% of its frames white. It slows on his busiest second
    (`slowAt`). "UNDER FIRE" on top, the gun that fired most under it.
    First live: `29cvwh4e5b` (2026-11-07), four pieces from Ortona, Savoy and
    Soletschnogorsk, 32 s, 6-21 cracks and 8-25 impacts a piece; a Savoy piece
    in bright fog and a Meuse one under a concrete ledge were cut by hand.
  - *The formula.* Every week's mix (`asmrWeekOf`) sets two under-fire
    moments between its pieces, in their place (six pieces still); the
    fourth theme, `--asmr-mix=under-fire` ("rounds going past"), is those
    alone. Every theme now prefers a gun not yet heard (`gunFamily`: a coax
    MG34 and a bow MG34 are one sound) before a second of one. "Big guns" no
    longer takes a tank's flamethrower (`TankFlamethrower_GunBarrel`), which
    its words had matched.
  - *Vanilla is silent (2026-11-07, the first weekly run).* The week's two
    under-fire moments and their stand-ins were all Omaha Beach's, and the
    page flew no round for any: vanilla's exported `_shared/effects.sounds.json`
    has no passing-crack script at all (no hand weapon's bullet bundle; the
    game's `Projectile_High.ssc` never made the export), where FHSW's has 9
    and both expansion packs some. The runner now takes under-fire moments
    only from a mod whose table has one (`modCracks`). The same day vanilla's
    table was re-exported (it predated cracks becoming flight sounds;
    features/flyby-bullet-cracks), and its bullets crack: 61 cracks from 166
    rounds past Merde on Omaha Beach.
- **ASMR is the game, unedited (2026-11-07, later).** The owner: "for these
  shorts we don't want slo mo, it's like a tribute to the beauty of the
  game, so don't edit it". Every ASMR moment now runs in real time to its
  end; the slow tail of 2026-11-04, its tape-slowed sound and the mastering
  (compression, a room's echo, a bass lift) are gone, leaving a half-second
  fade-in and levelled loudness (`ASMR_SOUND`). And a moment of fire is no
  longer filmed from behind the shooter: he named The Clëäner's flak gun on
  Soletschnogorsk (zjd8x9q6n6), seen from in front as it fires, "from the
  victim's point of view ... great sounds". `FACING_CAM` stands downrange of
  the gun, off its line of fire (5 m out and 1.8 to the side of a man's
  muzzle, 10 and 3.5 of a hull's), looking back at it along his aim
  (`aimsOf`, each shot's launch point and direction from the picker), so
  the report comes at the lens (a crack opens about 55 m out, so its rounds
  seldom crack here; the under-fire pieces carry the cracks). Blocked (the
  lens in a wall, or the gun hidden behind something drawn short of it on
  two probes running), it crosses to his other side, then rises 4 m; still
  blocked, or more than 6% of it white or black, the moment is left out:
  Ortona's Sherman drove behind a lamppost and a flag and ran 18%, the good
  pieces 1% at most. Checked on six FHSW rounds: the Panzer IIIs' MG34s on
  Soletschnogorsk's snowy road, a T-26's DT in the woods there and a tank
  under Savoy's cliffs firing at the lens. The "big guns" ASMR of the first weekly
  run (n2vwcykwba) came down at his word; the under-fire one (29cvwh4e5b)
  was filmed again in real time and replaced.
- **The arsenal, turned down (2026-11-08).** The first one (5 guns, 35 s:
  a Flak 38, a 105 mm howitzer, a Sherman's coax, a Panzer II's MG34, a
  Hanomag's MG42) was shown to the owner before upload: "nah I don't like
  it. Don't upload it". Never uploaded; its folder's meta is
  `meta.rejected.json`. The nightly's weekly ASMR is paused
  (`ASMR_WEEKLY=1` runs it) until the next form is chosen; the code below
  stays as the record. "Rounds going past" (k5yft99jsp) is the live ASMR.
- **The arsenal replaces the replay ASMR (2026-11-07, later).** The owner:
  following a player "seems more distracting ... like those weird youtube
  videos where someone plays a random speed running game"; instead "show
  the thing on the screen (the model of it from the game) ... while it's
  firing, if it has multiple firing weapons we highlight which one ... mute
  all sounds, except for the sound of that round whizzing by ... record more
  sounds in one clip". His choices: report then whizz, its own level
  blurred behind it, and it replaces the weekly replay ASMR.
  - *The range.* `scripts/shorts-range.mjs` `rangeRecording` cuts one gun
    out of a real recording: the header and the level's set-up events, that
    object's own lines (made, placed, its joints, its damage) from 6 s before
    its window, and only the chosen weapon's shots in it; no players, no
    other object, no chat. The runner serves it in place of a recording
    (`RANGES`, a route in `openPage`) to the live page, so the replay draws
    that hull where it stood, turret and all, firing as it fired, with every
    sound the game makes for it and nothing else in the world. Soletschnogorsk's
    Panzer II G: 324 lines, 27 KB, its coax fired 41 times in 3 s alone.
  - *The guns.* `arsenalOf`: the week's moments of fire (`asmrMomentsOf`,
    now carrying the object that fired, `nid`, and its template), eight at
    most, three a round, three big guns, three machine guns, two rifle
    clips, a gun not heard yet first; each cut to 4.5 s from 0.8 s before
    its first shot. Guns on hulls and emplacements only for now: a man cut
    out of a round also needs his player rows and kit, not yet tried.
  - *The beats* (`filmArsenalTake`, `ARSENAL_CAM`), real time, unedited.
    The report: 8 m along its aim and 5.5 to the side, 1.8 up, three
    quarters from in front. The whizz: 70 m downrange, 2.5 off the line of
    fire, a long lens holding 7 m of height at the gun, so it fills the
    frame firing at the lens and its rounds crack past (a crack opens about
    55 m out). Hidden from there (the depth probe at the gun), the camera
    crosses the line, then comes in to 75%; still hidden, the whizz is left
    out and the gun keeps its report. The downrange camera stands on its
    line of fire as it is (up the sky for an AA gun: the Flak 38's rounds
    went 2 cracks to 8) and inside how far its rounds flew in the report
    beat; rounds that flew under 62 m never crack, and a bullet gun's whizz
    with fewer than 3 cracks is left out (a Hanomag's MG42 on Omaha, a
    Sherman's coax: none); a big gun's shell whistles rather than cracks and
    keeps its whizz. The Panzer II G's coax on Soletschnogorsk: 29-36 cracks.
    A hull over 14 m long (a ship) is left out for now: framed on its gun's
    mount, the lens found a deck rail and grey sky. The level is drawn blurred and the gun, its
    flash and its tracers drawn sharp over it: a second render of them
    alone on magenta, keyed out. Its name on top (a template the game has
    no name for, tidied: "Fletcher2" is "Fletcher"), the weapon under it in
    gold, and in the report a ring on the firing barrel, joined to the
    weapon's name, when it has more than one gun.
  - `--asmr-mix=week` (the nightly's) and `--asmr-mix=arsenal` film it,
    titled "Battlefield ASMR: the arsenal"; a theme name still films the
    old mix of moments.
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

`MmShortsPanel` (now `MmShortsRow`, below) sat under the replays panel on both pages' Overview tab: a
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

### One panel with the replays (2026-11-05)

The owner: "Can we incorporate the shorts and replays into one panel. Do it
like the replay site does it, shorts first above videos".

The Shorts are now the first row of the replays panel (`MmShortsRow`, inside
`MmRecordingsPanel`), set off from the rounds by a rule, as the REPLAY feed
puts its Shorts strip above the rounds. The panel's bar counts both
("20 shorts · 12 rounds"). It shows when either has something: a player with
Shorts but no recordings of their own still gets the panel. The section is
`v-show`, not `v-if`, because the row inside it has to be mounted to ask for
its count; an empty panel is hidden, not absent. The row still asks only
once the panel is near the viewport (the panel's `useInViewport` drives the
row's `load` prop).

Before the merge, the owner looked for MoonGamers' Shorts and saw none. The
live page did have them (20, under the replays). The panel loads only when
scrolled near, and the page had probably been opened before Jenkins deployed
the change.

Verified: `e2e/stats-page-shorts.spec.ts` (Shorts above the rounds, a panel
for Shorts alone, paging, the row left out, the panel hidden) and
`e2e/stats-page-replays.spec.ts`.

### Creators' shares: the poster, Cancel and Take down (2026-11-08)

The owner shared two studio clips of Germans crossing Arnhem bridge
(`ky5wexau46`, then `mdtqtue2k8`), cancelled the first, and found it live
anyway; the second "is missing the thumbnail". Both posters were the same
all-black JPEG, and there was no way to take a Short down from the page,
though the dialog said "You can take it down again".

- **The black poster was Safari.** Both shares came from Safari 26.5 (the
  API's request log). `posterOf` drew the middle frame as soon as the seek
  said it was found; WebKit draws a video it has not shown a frame of as
  black. Measured in Playwright's WebKit on the live `mdtqtue2k8.mp4`: the
  old code's poster had a mean brightness of 0, Chrome's 51.8. Now the video
  sits in the page (4 px, nearly transparent), the poster waits for
  `loadeddata` and a frame shown (`requestVideoFrameCallback`), and a frame
  darker than 4 of 255 is tried again at 35%, 65%, 20% and 80% of the clip,
  played a moment first. The real module, in WebKit and in Chrome: 51.5 and
  51.8, about 1.2 s, no video left behind.
- **Cancel cancels.** Not now closed the dialog and left the upload running
  (the first share took 67 s, 04:10:42 to 04:11:49). While it uploads the
  button reads Cancel upload, and it, Esc or a click outside abort the
  request (`shareShort({ signal })`).
- **Take down in the player** (`replay-shorts.js` `mayTakeDown`,
  `recordings-api.js` `removeShort`): for an admin on any Short, and for a
  creator on the ones shared under their linked names (the API already
  allowed both). It asks first, then the Short leaves the strip and the
  player goes on to the next.
- **A poster can be replaced**: `PUT /stats/shorts/{slug}/poster`, a JPEG
  in the body, for the key, an admin or its creator. Posters are served for
  a year (`immutable`, cached at Cloudflare), so the link now carries the
  poster's size as a version (`.jpg?v=<bytes>`), in the strip and in the
  share link's unfurl.

Verified: `ShortsControllerTests` (33, a poster replaced by its creator and
by the key, refused to nobody, to someone else and for a file that is not a
JPEG, its new link), `test_recordings_api` (who sees Take down), and Take
down driven in WebKit and Chrome against a stand-in API: shown on the
creator's own Short, asked, gone from the strip and the player, the next
one open, hidden on the render job's Short.

### Studio shares embed in Discord (2026-11-08, later)

The owner posted `replay.bfstats.io/s/mdtqtue2k8` in Discord and no preview
came. The page's tags were right and its poster and video loaded for
Discordbot; the video was not. A browser's MediaRecorder writes MP4 in
fragments: the index at the front is empty (`mvhd` duration 0) and the clip
follows as 16 `moof`/`mdat` pairs. A player copes; Discord's preview reads
the index. The render job's Shorts are one `mdat` behind a full `moov`, and
embed.

- A share's video is flattened on the way in (`api/Shorts/VideoFlattener.cs`,
  `Mp4Flattener`), in C#: the fragments' `trun`s (with the `tfhd`'s and
  `trex`'s defaults) give every sample's place, size, duration, composition
  offset and sync flag; the samples go into one `mdat`, a run a chunk in
  the order they came, behind a `moov` with full tables (`stts`, `ctts`,
  `stss`, `stsc`, `stsz`, `stco`) and its durations, `mvex` dropped. Only
  the index boxes are read into memory; the media is streamed across. A
  track whose first fragment starts late (Safari's video, 26/600 s after its
  audio) gets an edit list that waits that long. Anything it does not
  understand leaves the file as it came. The Arnhem clip: 30 ms, and
  ffmpeg finds the two files the same, packet for packet (timing, sizes,
  key frames) and decoded frame for frame, the video still starting at
  0.043 s.
- First tried with ffmpeg in the API image (`7b99094d`, reverted in
  `d55efb59`): Ubuntu's ffmpeg brings every codec's libraries, about 650 MB
  on the image, to copy one layout into another.
- `POST /stats/shorts/{slug}/flatten` (the key, an admin or its creator)
  flattens a Short already live. The video's link carries its size as a
  version too (`.mp4?v=<bytes>`), so the cached fragmented file is not what
  the next preview reads.

Verified: `ShortsControllerTests` (37): a share flattened and a render job
upload left; a live one flattened to a new link; a fragmented test clip
(`tests/api/Shorts/Fixtures/fragmented.mp4`, ffmpeg's
`frag_keyframe+empty_moov+default_base_moof`, B-frames, AAC) made one piece
with every sample's bytes in order, its length in the index and its tables
counted; a late video track kept as an edit list; a plain file and a cut-off
one left as they came. The flattened test clip differs from its source only
in its last AAC frame: the index now gives the audio's real length, so a
player trims the 164 samples of padding.

### The loader (2026-11-05)

The owner: "When we deep link into a short, if the server is a tad slow it
just shows nothing until the short loads. We must implement a spinner. Make
it a fancy one ... we can create it from a clip in the game, maybe a cute
prone soldier shooter with the bullets stacking up".

**Why it was blank.** A `?tab=replay&short=` link had to load the REPLAY tab
(the menu pack and the feed), then the strip's page of Shorts, then the Short
itself, before the player appeared. Until then nothing was drawn, and once
the player was up there was only the poster until the clip played.

**What shows now** (`viewer/play/short-loader.js`): a prone British rifleman
with a BAR, drawn from the game, fires short bursts. Each shot has a muzzle
flash, a glow, a tracer, a kick and some smoke. Each spent case arcs out of
the port, tumbling, and lands end-on in a pile in front of him. The pile
stacks into a pyramid of 28 (seven rows). A full pyramid settles away and he
starts another. Every twentieth round (a BAR magazine) he pauses to change
mags. After 7 s a line admits the server is slow. With reduced motion, it is
a still picture: him, a small pile, the words.

- **From the first frame:** `front-end.js` calls `bootShortLoader()` at boot
  when the address has `tab=replay` and `short=`. The player's `open()` ends
  it (`endBootShortLoader`) whether the Short opened or was gone. So does
  leaving the REPLAY tab, or the tab failing to load.
- **Over the poster:** the player puts the same loader over the active
  Short's poster until its video plays, with a 250 ms grace so a quick clip
  never flashes it. It comes back for a stall longer than 400 ms. A pause
  hides it.
- **Faster too:** `open()` asks for the Short alongside the strip's page,
  not after it.

**The soldier is the game's.** `scripts/render-game-sprite.mjs` poses
`BritishSoldier__Bar1918.pose.glb` at its `lie` clip in three.js and draws it
in plain JS: textured, z-buffered, 4x supersampled, transparent. It needs no
browser, because a headless render job held the one browser when it was made.
It crops the result to `play/loaders/brass-soldier.webp` (8 KB, drawn at 2x;
it was `play/short-loader-soldier.webp` until the loaders below) and prints
where the muzzle and the ejection port land, which are `loaders/brass.js`'s
`MUZZLE` and `PORT`.

Verified:
- `tests/test_short_loader.py` (the pyramid's rows, no two cases in one
  place, each row in the notches of the one below, the sprite ships);
- the real deep link on the local viewer: the boot loader from the first
  frame, then the player with the clip playing;
- the slide loader, with `play()` held back 3 s: it showed over the poster at
  250 ms, stacking brass, and was gone once the clip played;
- frames stepped by hand: the flash, tracer and case in flight sit on the
  rifle, and the 27-case pyramid stays clear of it.

### The loaders (2026-11-05)

The owner: "create some new loading animations. To make it fun, use sprites
across all the mods. Look into comedic timing such as two soldiers firing at
each other, but each knees down first so the tracers go over their head. Then
maybe do some research about realistic WWII military tactics about using
cover". Then, while it was being built: make the transitions smooth, no hard
cuts ("the smooth loading animations you see from the big tech companies"),
and do not name the mods on screen ("the joy is that players will recognise
the models").

The Short loader now plays one of five scenes, picked at random each time it
shows and never the same twice running. They play side by side on
`play/loaders.html` (`?scene=<id>` for one, `?step` to freeze time, below).

| Scene | Module | The models | What accumulates |
| --- | --- | --- | --- |
| Brass | `loaders/brass.js` | BF1942's British BAR gunner | spent cases, a pyramid of 28 |
| Duck | `loaders/duel.js` | BF1942 US v FH German, two pirates, a Mon Calamari rebel v an Imperial trooper (GC), a Tommy v a Fritz (BF1918) | chalk tally marks of misses, fives struck through |
| Hull down | `loaders/hulldown.js` | FHSW's Tiger, FH's M4A1 Shermans | white kill rings on the Tiger's barrel; twelve and the barrel is changed |
| Fire and movement | `loaders/rush.js` | Secret Weapons' commandos (Bren, No. 4), FH's MG 42 gunner, the game's flags, sandbags from the Bulge bake | captured Union flags in the corner |
| Hedgerow | `loaders/ambush.js` | FH's Panzerschreck gunner and loader, FH's M4A1 Sherman | tank destruction badges, five silver make a gold |

**Duck** (comedy). Two men ten paces apart. A beat of stillness; one fires
and the other is already going down, so the burst passes over his head; then
the same the other way. Both lean back to look after the rounds (the
double-take), both fire and duck at once so the rounds cross over two heads,
up together and down together, then escalation: one goes prone, the other
drops behind sandbags and takes the burst in the bags, then rises and fires
over the prone man's back. The next pair fades in. Musket balls are slow and
smoky, blaster bolts red and green. Every round misses; the test checks each
standing muzzle is at least 3 px above the other man's kneeling head.

**Hull down.** Drawn the way the manuals draw it: a cross-section with the
enemy's line of sight dashed in, grazing the crest. The Tiger waits turret
down, gun and all under the line. A Sherman comes up on the far ridge and
fires at the crest on suspicion: the round goes into the earth. The Tiger
climbs, pitched, onto a level shelf behind the crest where only its turret
and gun clear the line, fires once (the muzzle blast lifts dust off the
crest), and backs straight down before the reply. It never shows the hull and
never stops on the crest. The test checks every point of the tank against
the line in both positions. Getting this right needed two level steps joined
by a slope: on a plain slope the Tiger's nose-up pitch either lifted the
glacis over the line or poked the gun over it when turret down, because its
gun sits barely above the hull roof. A real hull-down position is chosen level
for the same reason.
Sources: FM 17-12, *Tank Gunnery* (1943), paras 46-47,
https://www.ibiblio.org/hyperwar/USA/ref/FM/PDFs/FM17-12.PDF ; FM 17-30,
*Tank Platoon* (1942, C1 1944),
https://archive.org/download/MManuals/UsArmyWwiiArmoredForceTankPlatoon1942.pdf ;
kill rings, https://en.wikipedia.org/wiki/Kill_marking .

**Fire and movement.** A commando section pinned by an MG 42 behind sandbags.
The Bren opens up as the base of fire and the German gun goes quiet. Then
one man at a time gets up, rushes a short bound bent low (the run gait, eight
frames), drops and fires. The Bren moves up under the riflemen's fire. Two
groups are never moving at once, and the covering group fires faster while
someone is up. The view pans with the section. At the end a grenade goes over
the bags, the gunner is gone, the German flag comes down and the Union flag
goes up. The bounds are a single list (`PLAN`) so nobody can move together.
The real bound is 15-20 paces in 3-4 s; here it is about 5 m in 1.5 s, with
the run cycle slowed to match so the feet do not slide.
Sources: FM 7-10, *Rifle Company* (1942), para 144,
https://archive.org/details/Fm7-10 ; FM 22-5 (1941), para 260, rushes,
https://www.ibiblio.org/hyperwar/USA/ref/FM/PDFs/FM22-5.PDF ; MIS Special
Series 9, *The German Squad in Combat* (1943), bound lengths,
https://archive.org/details/TheGermanSquadInCombat .

**Hedgerow.** A Panzerschreck team in the ditch of a Normandy hedgerow, seen
from behind. A Sherman comes along the sunken lane beyond the bank; they stay
down, below the bank, while it passes their gap front first. Once it is past,
the loader steps out to the side, clear of the backblast, the gunner rises in
the gap, and the rocket goes into the engine deck from a few tens of metres.
The backblast throws dust back at the viewer. The tank rolls on a few metres
and burns. Both go flat and crawl away along the ditch before anyone answers.
Sources: OKH Merkblatt 77/3, *Der Panzerknacker* (1944), side and rear as the
weak points, Panzerschreck to 150 m,
https://pbc.gda.pl//Content/57971/Der%20Panzerknacker.pdf ; Intelligence
Bulletin, Feb 1945, "More Notes on Antitank Tactics",
https://lonesentry.com/articles/german-bazooka/index.html ; Doubler,
*Busting the Bocage* (CSI, 1988),
https://www.ibiblio.org/hyperwar/USA/CSI/CSI-Bocage/ ; the badge,
https://en.wikipedia.org/wiki/Tank_Destruction_Badge .

The full research note, with the techniques not used (bounding overwatch,
smoke before an advance, infantry with a tank, skylines, the bocage
leapfrog) and the timing numbers, is
`~/.config/Claude/side-session-notes/local_8e413dff-7f4a-4177-83bb-1d0895f94485/wwii-tactics-research.md`
on this PC; the short version is the sources above.

**How it is built.**
- `loaders/kit.js` is the shared skeleton lifted out of the first loader: the
  380 x 150 stage and its scaling, the words and the slow-wait line, the
  timers (`kit.wait`, `kit.after`), reduced motion, the boot shade, the
  common effects (tracer, muzzle flash, smoke, dust), sprite strips, and
  `kit.man`, a soldier made of a pose strip and a run strip. A scene is
  `{ id, title, tactic, words, sub, css, mount(stage, kit) }`, and `mount`
  returns `{ play, still }`. `loaders/scenes.js` lists them.
  `short-loader.js` keeps its three exports and is now the rotation.
- **No hard cuts.** Every change of stance plays in-between frames. The sprite
  script's `--tween n` blends the pose glb's own `stand`, `crouch` and `lie`
  clips by weight in three.js, so a strip is stand, four blends, crouch, four
  blends, lie, and `strip.to(frame, ms)` steps through them on an eased
  curve. It works for every mod's poses, because it needs only the three
  clips. Moves, pans and recoil are eased Web Animations. The stage's edges
  fade, so tanks and tracers come and go softly.
- **Sprites:** `scripts/render-loader-sprites.sh` holds every sprite's exact
  command (`scripts/render-loader-sprites.sh duel` redraws one scene). New
  in the sprite script: `--clips a,b,c` and `--tween n` (pose strips),
  `--gait run --frames 8` (a run cycle from the gait glbs; mod trees without
  a `.pose.json` use `gaits/lower` and `gaits/<weapon>`), and `--pick k` with
  `--only <name>` (one static, such as a sandbag wall, lifted out of a level
  bake at the origin). The projectile, tracer and trail meshes a vehicle
  carries are left out. The defaults still draw the brass soldier byte for
  byte. `scripts/sprite-anchors.py` reads the muzzle and head of each pose
  out of a strip's pixels. Every sprite is under 30 KB.
- **The step clock:** `createLoader({ step: true })`, the gallery's `?step`:
  time moves only on `loaders.<id>.advance(ms)`, waits wake in order, and
  every animation on the stage is paused and seeked to the clock. A beat can
  be looked at exactly, whatever the browser does with a background tab's
  timers (the app's browser pane throttled them so much that real-time
  screenshots showed beats out of order).

Verified:
- `tests/test_loaders.py`: the duel's rounds over every kneeling head and the
  prone burst into the bags; turret down and hull down against the line of
  sight; one man moving at a time; the gunner hidden crouching and clear
  standing, the rocket meeting the tank after it has passed; the badges; every
  sprite small, shipped, and in the render script; the brass sprite redrawn
  byte for byte. `tests/test_short_loader.py` still checks the pyramid.
- Each scene stepped beat by beat in `loaders.html?scene=<id>&step` with
  screenshots; the gallery with all five; and the real Short player with
  `play()` held back 3 s, where the over-poster loader showed the ambush, then
  the brass gunner on the next Short, then the duel.

**The dogfight (2026-11-07).** A sixth scene, made for the dogfight school's
briefing and in the rotation everywhere: a Spitfire on a BF109's tail, holding
fire while it jinks and firing when it steadies; kill marks stack on a row
under the Spitfire. Its design and checks are in
`features/dogfight-school/README.md`, "The briefing".

### The loaders on the stats site (2026-11-05)

bfstats.io shows the same scenes in place of its loading bar: the server list
on the landing page, a server's page, and the round report. Each shows one
scene at random, with the page's own words ("Loading the servers").

- **A synced copy.** The ui image builds from `ui/` alone (`ui/Dockerfile`,
  Jenkins `docker buildx build -f ui/Dockerfile ui/`), so it cannot import
  from `tools/`, and mesh.bfstats.io sends no CORS headers for a cross-origin
  module import. `scripts/sync-ui-loaders.sh` copies the scene modules to
  `ui/src/components/common/game-loaders/play/loaders/`, where Vite bundles
  and hashes them, and the sprites to `ui/public/game-loaders/play/loaders/`.
  `tests/test_loaders.py` fails while the copy differs, so after changing a
  scene or a sprite, run the script.
- **`viewer-root.js` stand-in.** `kit.js` imports `../../viewer-root.js`; the
  ui's copy of that file points `VIEWER_ROOT` at `/game-loaders/`, so the
  sprites resolve without touching the scene code.
- **`BfGameLoader.vue`** (`@/components/common`): `status-text` sets the
  words, `scene` pins one. It recolours the words with `--mm-*` tokens. If a
  scene fails to start, it shows `BfLoadingBar` instead.
- The scene copy is no longer about the Short: the duel's slow line reads
  "Nobody has hit anybody yet. Still loading.", and the brass scene's own words
  are "Loading" (the Short loader passes "Loading the Short" itself).

Verified on a local dev server with every request held open, so each page sat
in its loading state: the server page (brass, desktop), the round report
(fire and movement, 375 px wide, no horizontal scroll, the slow line wrapping
inside the screen), and the landing page (the hedgerow ambush). Sprites load
from `/game-loaders/`, and the console showed no errors.

**Every page-sized wait (2026-11-05, later).** The rest of the site's full-page
loading states moved to the scenes too: the leaderboard, the three trivia games
(`MmArcadeLoader`, see `features/arcade-trivia-performance`), a player's page
(beside the hero, as on a server's page), Player and Server Wrapped (over their
smoke and embers), compare, the rounds and sessions pages (`MmSessionsPage`),
all achievements (also its slideover), map popularity (also a server's Maps
tab), a community, the dashboard, system stats, the public tournament page (its
words in the tournament's own type, since the `--mm-*` tokens are not set
there), Discord sign-in and its callback, and the two tournament-admin pages.

The rule: one scene on screen, only where the page's main content is what is
loading and nothing else worth reading is up yet. These keep their skeletons or
spinners: in-page panels on a page that has already painted (KPI cells, trend
charts, rankings, the network graph), player and server search results (they
reload as you type, so a fresh scene per keystroke would flicker), the
leaderboard's filter dropdowns, the tournament tabs and modals, and the admin
tools' tabs.

`BfGameLoader` carries `contain: inline-size`. The stage is a fixed width until
the scene measures its parent, and in a shrink-to-fit parent (the sign-in panel,
a centred grid item) that first width widened the parent past a 375 px screen,
so the scene then measured the overflow and kept it.

Verified on a local dev server with every `/stats` and `/api` request held open:
each page above sat in its loading state with its own words, at 1024 and 375 px
wide, no horizontal scroll, the stage inside its frame. The dashboard and the
admin pages need a signed-in account and were not seen in a browser.

### The boot loader (2026-11-05)

A shared replay link (`map.html?...&replay=`) was black for about twelve
seconds on a cold cache before its load screen drew, measured on production:
the page's module is ~245 files and 2.6 MB, fetched together over ~400
parallel requests (the stamper's modulepreloads) that all finish around 5.9 s,
and nothing runs until the last has. Cold means a first visit and the first
load after every deploy, since a deploy moves every module to a new URL;
warm, the same page is up in 0.75 s. The front page (`play/index.html`, ~80
modules) showed a black canvas reading "Loading…" the same way.

Now both pages show a loading scene from their first frame:

- `play/boot-loader/entry.js` starts `bootLoader` from kit.js with the page's
  words: "Loading the replay" or "Loading the battle" on map.html; "Loading",
  "Loading BattleView" or "Loading the Short" on the front page. It shows
  nothing for a relay join (retail's own connect screen, `#preboot`), a
  headless `?shots` capture, or map.html with no level.
- It is not a module: a module would wait in the same queue as the 400.
  `scripts/build-boot-loader.mjs` bundles it with kit.js and the scenes into
  one classic script, `play/boot-loader.bundle.js` (40 KB, 15 KB gzipped;
  esbuild from ui/node_modules), and `mesh/stamp-viewer.mjs` inlines any
  `<script src data-inline>` into the page at image build. The tag is first in
  `<body>`, ahead of the import map and the modulepreloads, so the scene's two
  or three sprites are the first requests after the page. A local server
  loads it by its `src`. Its `viewer-root.js` stand-in takes the root from
  the tag (`data-viewer-root`), since a classic script has no `import.meta`.
- The page hands over with `window.__bootLoader.end()`: any load overlay's
  `begin()` (progress.js; every level load on map.html goes through it), the
  front end once the screen that is up has drawn or failed to, and the Short
  loader, which keeps it up as its own for a `?short=` link (`held`). A script
  that fails to load, or an uncaught error, ends it too, so a broken page is
  not hidden behind a scene.
- After changing a scene, the kit or the entry, run
  `node scripts/build-boot-loader.mjs`. The bundle's first line is a hash of
  its sources and `tests/test_loaders.py` fails while it is stale;
  `tests/test_stamp_viewer.py` checks it is inlined ahead of the modules.

The mesh pages (`index.html`, `kits.html`) draw their nav and inspector
before any script, and bfstats.io paints its skeleton shell before Vue, so
neither needed it.

Verified on a local server: the scene is up 22-29 ms after navigation on
both pages; the front page hands over as Instant Battle draws; a `?short=`
link keeps one scene up through the Short loader until the Short opens or is
not found; a relay link shows none; a load overlay's `begin()` ends it and
leaves a held one. On a GPU (headless Chromium, Vulkan) with the network
held to 150 ms and 2 MB/s and the cache off, `map.html?map=wake` showed the
scene at 0.26 s; its modules took until 13.5 s, and the scene went the moment
the load overlay began, with no page errors. (The browser pane has no WebGL:
there map.html's renderer throws, and the error rule ends the scene, which
is that rule working.)

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
looping, with sound (2026-11-06: it opened muted, and the owner found the
Unmute tap "annoying"; the click that opens it is the gesture the browser
wants, so a muted Short was a tap for nothing). Mute lasts the visit. A
Short opened from a link with no tap, which the browser refuses sound, falls
back to muted and the button says so. Scroll, swipe or the arrow keys move
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
