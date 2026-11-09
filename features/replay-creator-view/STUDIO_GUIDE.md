# Creator studio guide

How to cut a kill from a round replay into a clip for YouTube or Shorts. The
design notes and the history of each control are in this folder's README.

## A clip in a minute

1. Open a round replay and sign in. Press the CREATOR button on the replay
   bar, or V.
2. Hover a kill on the round's timeline and click Kill shot. The clip opens
   on the strip under the view and loops, already filmed by three cameras:
   over the shooter's shoulder, the bullet chase from the shot, and a circle
   round the man it killed.
3. Click Studio on the strip. The page goes full screen with the view as
   the monitor.
4. On the Look tab, pick a recipe. Frag movie and Shorts are good starts.
5. On the Export tab, click Record the clip. The clip plays once at full
   size and downloads as a video file when it ends.

Everything after step 2 is optional. Kill shot on its own makes a usable
clip.

## The tour

The first time the studio opens in a browser it offers a tour. It is also
Take the tour in Help. It takes a good kill from the round you have open
(the kill on the strip, if the clip is already one) and makes it into a clip
with you, one step at a time: pick the kill, the cameras, change a camera,
move a hand-over, set your own camera, slow motion, a look, the lower third,
Record. Each step lights the control it means, and moves on once you have
done it. Next skips a step, Back goes back one, and the cross ends the tour.
Nothing the tour draws is recorded.

The same tour as videos, a step each and one of the whole tour, is made by
`make-tour-videos.sh` (the `replay-creator-studio` skill's scripts).

## The screen

- The top bar has undo and redo, Clear, the frame (16:9, 9:16, 1:1,
  2.39:1), Thumbnail, Record and Help. Esc or the cross leaves the studio.
- The monitor is the 3D view in the shape of the frame. What it shows is
  what gets recorded, text and colour included.
- The inspector on the right has six tabs: Kills, Camera, Look, Text,
  Effects and Export.
- Under the monitor: the transport (start, frame back, play, frame on, end),
  the video's clock, the camera switch (Clip camera, Orbit, His eyes, Free
  fly, Game view) and Camera here; then the tray; then the timeline. Game
  view is the game's own cameras on what he drives: it reads Chase, Front
  chase or Fly-by while one is on, and a click goes to the next (F10-F12 do
  the same).

## The timeline

The timeline is laid out in seconds of the video, not seconds of the round.
Bullet time turns a tenth of a second of the round into two and a half
seconds of video, and the timeline gives it that room, so the round's flight
is wide enough to work in. The clock says the same: 0:04.0 / 0:11.7 is four
seconds into an 11.7 second video.

The lanes from top to bottom are Clip, Camera, Speed, Text and FX. They all
follow the same rules:

- Click goes to that moment, and dragging scrubs. The monitor shows the
  clip's camera there, the bullet drawn where it would be.
- Dragging a thing moves it. The clip's gold edges trim it, and the gold
  rail along its top slides the whole clip. Slow motion and text bars move
  by their middle and resize by their ends.
- Right-click (a long press on touch) opens a menu of what you can do to
  whatever is under the pointer.
- The mouse wheel zooms the timeline round the pointer. Shift and the wheel
  pans it.
- Drags snap to the clip's ends, the shot, the hit, the man going down, the
  hand-overs and the playhead. A cyan line shows where.

The Clip lane marks the shot, the round in flight (a striped bar) and the
kill where the round hits.

## Cameras

The Camera lane is the clip's cameras in a row, each filming its part of the
clip. A kill shot opens with three:

1. **Over the shoulder**, up to the shot.
2. **Bullet chase**, from the shot: behind the round to the man it kills,
   then drawing back as he is hit.
3. **Circle the victim**, once he is down.

**To change a camera,** click it. A chooser opens with every camera:

| Camera | What it films |
|---|---|
| Your camera | A view you place yourself (see below) |
| His eyes | The shooter's own view, his gun and all |
| Over the shoulder | Behind the shooter, down his line of fire |
| Facing him | In front of the shooter, looking back at his muzzle |
| Bullet chase | Right behind the round, all the way to the man it kills |
| Bullet 360 | Swings round the round in flight, and round the man as he falls |
| Side-on | Alongside the shooter, then the round |
| From the victim | Beside the man it kills: the shooter, then the round coming at the lens |
| Circle the victim | Round the man killed, as he falls |
| Game chase | The game's own chase camera (F10): behind the tank or plane he is in, or over his shoulder on foot |
| Game front chase | The game's front chase (F11): ahead of what he drives, looking back at it; on foot, his chase |
| Game fly-by | The game's fly-by (F12): a camera on a tripod ahead of what he drives, watching it pass; on foot, his chase |

Each camera works at any moment of the clip: Bullet chase before the shot
waits over the shooter's shoulder, From the victim before the shot watches
the shooter from where the round will land.

Each camera has a camera icon at its start. Dashed means the camera frames
itself (its block says "automatic"): it works out where to stand from the
shooter, the round and the man it kills. **To set a camera yourself,** click
its icon, fly the view where you want it, and press Use this view (see Your
camera below). The icon turns solid with your view in it.

**To add a camera,** right-click the Camera lane where it should start and
pick it from the cards, or drag it from the tray onto the strip. It films
from there until the next camera takes over, and glides in. A click on a
tray chip puts it at the playhead. Right-clicking near the start of a camera
swaps that camera instead. The same menu loops, changes or takes away the
camera under the pointer.

**To change when a camera takes over,** drag the gold line between two
cameras. Inside the round's flight the line keeps its share of the flight
("60% of the way to him"), so it stays put even when the page's round flies
a little faster or slower than the strip drew it. While you drag, the line
says what it is kept at.

**How one camera hands over to the next** is the glyph on the gold line:
Cut (snap), Glide (eases across) or Whip (holds, then a fast swing). Click
the glyph to change it. A glide or whip is drawn as a pale wedge as long as
it takes.

**To take a camera away,** click it and choose Take it away; the camera
before it films on.

The camera on the round never leaves it early: a camera that takes over as
the round hits, or as the man goes down, waits for the page's own round.

### Your camera

1. Click a camera's icon, or click the camera and choose Your camera, or
   drag Your camera from the tray.
2. The clip pauses at the start of that camera's part and the view becomes
   a free camera, starting where that camera had it. Fly it: WASD moves,
   drag looks, Q and E go down and up, the wheel zooms.
3. Press Use this view (or Enter, or K). That camera's part plays over and
   over to show it. Esc or Cancel puts the cameras back as they were.

Click your camera for how it moves while it films: Still, Follow the action
(it stays put and turns to keep the shooter, the round and the man in frame,
from the framing you set), Push in, Pull back, Circle or Crane up. Your
camera keeps the field of view it was placed with, so zoom in before Use
this view for a tight shot.

K anywhere in the clip makes the view on screen a camera of yours from the
playhead on: fly with Free fly, press K.

### An end camera

A camera of yours can move from one view to another: its camera at the
start, its end camera where you put it on the block.

1. Click the + on your camera's block (or Add an end camera in its
   chooser), or drag the + along the block to when the camera should get
   there.
2. The clip pauses there. Fly to the second view and press Use this view.
3. The part loops: the camera goes from its camera to its end camera, then
   holds it to the end of its part. The held stretch is hatched, and the
   block says "then holds".

**To change when it gets there,** drag the end camera's picture along the
block. While you drag it says what it is kept at ("0.50 s before the shot"),
like a hand-over line, and it snaps to the shot, the hit and the playhead.
Dragged right to the block's end, it gets there as the part ends.

A whole shot made of several cameras: set a camera, drag its end camera to
half way, then right-click the Camera lane after it and pick Game chase (or
Over the shoulder) to follow the shooter again from there.

Click the camera to choose how it gets there: Glide (eases across), Orbit
(swings round the action), 360 (a full turn round the action on the way) or
Whip (holds, then whips across at the last moment). No end camera holds the
first view again. Click either icon to set that view again.

### Loop a part

To get one camera or one hand-over right without sitting through the whole
clip, play just that part over and over:

- Click a camera and choose Loop it: its part, with half a second either
  side.
- Click a hand-over's glyph and choose Loop it: a second and a half either
  side of it.

Every change you make to a camera or a hand-over loops the part it changed.
A cyan band on the timeline shows what is looping. Whole clip on the band,
or Play, plays the whole clip again; Esc stops.

A part that starts while the round is in the air starts just before the
shot instead: the round has to be fired for a camera to ride it.

### Starting over

Clear on the top bar offers Clear the cameras (back to the kill shot's
three; slow motion, look, text and effects stay) and Clear everything (the
clip as Kill shot made it). Ctrl+Z takes either back.

### Camera recipes

The Camera tab starts with recipes, a whole kill shot's cameras in one
click:

- **Kill cam**: over his shoulder, the chase, the man killed (the default).
- **Through his eyes**: his view as he fires, cut to the round, the man killed.
- **Incoming**: the round chased half way, then from the victim as it
  arrives.
- **Full 360**: facing him as he fires, round the round and round the man.
- **Side-on**: beside him, alongside the round, the man killed.
- **Their side**: from beside the man it kills throughout.
- **Game chase**, **Game front chase**: the game's own chase or front chase
  on him as he fires, the round chased, the man killed. Best for a kill
  from a tank or a plane.
- **Game fly-by**: the game's fly-by on him as he fires, then the man killed.

Under the recipes the tab lists the clip's cameras with what each is, its
part of the video and how it takes over. Each row can set the camera, add or
set its end camera and loop its part; a camera of yours also says how it
moves, or how it gets to its end camera. Bullet time and the lens are below.

A kill opened from the Kills tab starts on its own three cameras; the look,
text and effects carry over.

## Slow motion

The kill shot slows itself around the shot (bullet time). The Speed lane
shows it as "Bullet time · auto", from where the clock starts slowing for
the trigger until the man is down. Right-click it to make it subtle,
strong, extreme or off.

To slow a stretch yourself, drag across the Speed lane, or drag Slow-mo from
the tray. Your stretch plays at 1/4 and replaces the bullet time for that
clip; the timeline is laid out again when you let go. Drag it to move it,
drag its ends to resize it, and right-click it for 1/2, 1/4 or 1/10. Remove
it and the bullet time comes back.

## The hit on a beat

Cutting the clip to music, you know where the drums come in, say 0:41 of
the song, and want the round to hit there. Right-click the Kill mark on the
Clip lane and choose Land the hit at a time of the video, type `0:41` (or
`41`, or `0:41.5`) and press Enter. A blue pin marks 0:41 on the strip,
on the Kill mark, and the studio works the rest out:

- **Move the clip's start** (the default). The slow motion stays as you set
  it and the clip's start moves back until the hit lands on 0:41. With no
  slow motion of your own, it slows the whole run-up to the hit at 1/4 and
  comes back to normal speed as the round strikes. Drag the slow stretch so
  it kicks in later and the start moves again; the clip's start handle is
  striped while the studio sets it.
- **Work out the slow motion.** Drag the clip's start to the frame you want
  it to open on and it is held there (the handle gets a blue ring). The slow
  stretch's speed is worked out instead, any speed from a twentieth to
  normal: the Speed lane says "0.27x slow · worked out to the pin". Trim the
  start in close to the action and the hit stays on its time: if your slow
  stretch is too short to fill it, the slow motion is stretched back to the
  clip's start and slowed over all of it.

Whatever you touch is what stays put: drag the start and the speed is
worked out; pick a speed on the Speed lane and the start moves. The same
choice is in the pin's box (click the pin), with Take the pin away.

When it cannot fit, the pin turns red and says why, and the clip is left as
it was: "Too long by 32.5 s even at normal speed: start the clip later", or
"Short by 12.3 s even at 1/20 from the clip's start: start the clip
earlier". The
A dropped bomb is steered to land exactly as the target dies, so it is on
the pin from the first play. For a bullet or a shell, the first time the
clip plays the page measures where the round actually lands and the start is
nudged to match, so play it through once before you record. Record the clip
and the song lines up from 0:00 in any editor.

To hear it, add the song on the Export tab (Music, Add a song). It stays on
your computer. It plays with the clip from the clip's start, follows a loop
or a scrub, and the game is muted while it plays (untick Mute the game to
hear both). Song at the clip's start skips into the track when the clip
should start part way through it.

Record puts the song in the video file too (Put the song in the recording,
on by default): from the clip's first frame, on its own while the game is
muted, or mixed with the game's sound. The song is kept in step with the
clip's own clock while it records, so the drums land on the explosion.
Play the clip through once before recording: the first time an explosion is
drawn it can stall a frame. A montage records without the song.

## Look, text and effects

- Look: eight colour grades, a vignette, the frame, a thirds grid, and a
  safe-area guide (for 9:16, the strips that Shorts covers with its own
  buttons).
- Text: a title over the middle of the frame; a lower third that writes
  itself from the kill (who, with what, whom, how far) unless you type your
  own words; the round's kill feed in team colours; your channel tag. Titles
  and lower thirds are bars on the Text lane. Drag Title or Lower third from
  the tray to put one where you let go.
- Effects: fade in from black and out to black, and as the round hits a
  white flash, a zoom punch, a shake and a freeze frame. They show on the
  FX lane; right-click it to switch them. The tray's Hit effects turns on
  the flash, the punch and the shake at once; Freeze holds the picture.
- Recipes on the Look tab set a grade, frame and effects in one click. Ctrl+Z
  takes a recipe back in one step.

## Finding kills

The Kills tab lists the round's kills that have a round to chase. Best puts
the longest shots first and ranks multi-kills up; In order and His (the man
followed) are the other views. Tags mark long shots (100 m or more), multi-
kills and kills from a vehicle. Clicking one opens it as a kill shot without
leaving the studio, with your look, text and effects still on, so a run of
clips keeps one style.

## Export

- Share this edit: name it and click Share this edit. The link is copied:
  paste it in Discord or send it. Whoever opens it gets the studio on your
  clip with its cameras (yours too), slow motion, the hit's pin, look, text,
  effects and frame. The song is named, not sent: they add their own copy
  under Music. The round has to be shared on bfstats.io, and you have to be
  signed in. Their changes are theirs; they can share a link of their own.
- Music: Add a song to hear the clip with the track you are cutting it to
  (see The hit on a beat). Record puts it in the file unless you untick Put
  the song in the recording.
- Record the clip plays it once in real time at the monitor's full size and
  downloads it (MP4 or WebM, with the game's sound). Slow motion takes its
  time: the video clock says how long. Keep other windows quiet while it
  records; Esc stops and saves.
- Save a thumbnail downloads the frame on screen as a PNG, cropped, graded
  and with its text.
- Keep the clip adds it to Kept clips with its cameras, slow motion, look,
  text and effects. Names can be edited in the list.
- Record a montage records every kept clip in the order they happened, into
  one video, each with its own cameras and style.

## Keys

| Key | What it does |
|---|---|
| Space | Play or pause the clip |
| Left, Right | A frame back or on (with Shift, ten) |
| Home, End | The clip's start or end |
| K | The view on screen as your camera from the playhead; while placing, use this view |
| Enter | Use this view (while placing your camera) |
| G | The next camera on the round's flight (chase, 360, side-on, from the victim) |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| WASD, Q, E | Fly (Free fly, and while placing your camera) |
| F9, F10, F11, F12 | His eyes, and the game's chase, front chase and fly-by (lights Game view) |
| 5 | Kill shot of the followed man's next kill |
| Esc | Give up placing, leave a text box, close a menu, stop a loop, stop recording, leave the studio |

## Tips

- Try a camera recipe before anything else. Incoming on a long sniper shot
  often needs nothing more.
- A strong clip is usually your camera a second or two before the shot, a
  cut to the bullet chase on the shot, and From the victim for the last part
  of the flight.
- Drag a camera's line into the round's flight while the strip is zoomed in
  (the wheel) for fine control. Let go and the hand-over loops where you
  put it.
- Give the first camera an end camera close behind the shooter: the view
  glides in to his shoulder as he fires, and the chase takes the shot.
- For Shorts, turn on the safe-area guide before placing text.
- Keep the clips as you go and record them all at the end with Record a
  montage.
