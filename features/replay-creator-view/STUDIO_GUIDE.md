# Creator studio guide

How to cut a kill from a round replay into a clip for YouTube or Shorts. The
design notes and the history of each control are in this folder's README.

## A clip in a minute

1. Open a round replay and sign in. Press the CREATOR button on the replay
   bar, or V.
2. Hover a kill on the round's timeline and click Kill shot. The clip opens
   on the strip under the view and loops, already filmed: the camera waits
   over the shooter's shoulder, rides the round in slow motion, and holds on
   the man it killed.
3. Click Studio on the strip. The page goes full screen with the view as
   the monitor.
4. On the Look tab, pick a recipe. Frag movie and Shorts are good starts.
5. On the Export tab, click Record the clip. The clip plays once at full
   size and downloads as a video file when it ends.

Everything after step 2 is optional. Kill shot on its own makes a usable
clip.

## The screen

- The top bar has undo and redo, the frame (16:9, 9:16, 1:1, 2.39:1),
  Thumbnail, Record and Help. Esc or the cross leaves the studio.
- The monitor is the 3D view in the shape of the frame. What it shows is
  what gets recorded, text and colour included.
- The inspector on the right has six tabs: Kills, Camera, Look, Text,
  Effects and Export.
- The timeline at the bottom has the transport (start, frame back, play,
  frame on, end), the clip and round clocks, the camera switch (Clip camera,
  Orbit, His eyes, Free fly) and the clip's lanes.

## The timeline

The lanes from top to bottom are Clip, Camera, Speed, Text and FX. They all
follow the same rules:

- Click goes to that moment, and dragging scrubs.
- Dragging a thing moves it. The clip's gold edges trim it, and the gold
  rail along its top slides the whole clip. Keyframes, slow motion and text
  bars move by their middle and resize by their ends.
- Right-click (a long press on touch) opens a menu of what you can do to
  whatever is under the pointer.
- The mouse wheel zooms the timeline round the pointer. Shift and the wheel
  pans it.
- Drags snap to the clip's ends, the shot, the kill, the keyframes and the
  playhead. A cyan line shows where.

## The kill shot's camera

A kill shot is filmed in three parts, and the Camera lane names each one.

1. The lead-in, up to the shot. With no keyframes of your own the camera
   waits over the shooter's shoulder. Keyframes you add before the shot
   replace that with your own run-up.
2. The chase, from the shot to the hit. The camera rides the round in its
   shot style: Chase (behind it), Chase 360 (in front of it, swinging round),
   Side-on, or From the victim (the round coming at the lens). Right-click
   the chase on the lane, or use the Camera tab, to pick one. Drag the view
   while the round flies to swing round it; the next time round keeps the
   swing.
3. The lead-out, after the hit. With no keyframes the camera holds the hit
   and then turns to the man killed. Keyframes after the kill replace that.

Your lead-in hands over to the chase as the round leaves, and the chase
hands over to your first lead-out keyframe once the round has landed. Each
hand-over is a Glide, a Whip (hold, then a fast swing at the last moment) or
a Cut (snap). Right-click the hand-over on the lane, or set Into the chase
and Out of the chase on the Camera tab.

Untick Chase the round on the Camera tab to film the whole clip with your
keyframes alone.

## Keyframes

A keyframe is the view on screen at a moment of the clip.

1. Pause where you want it.
2. Pick Free fly in the transport and fly the camera there: WASD moves, drag
   looks, Q and E go down and up.
3. Press K, or click the + at the playhead on the Camera lane.

Right-click a keyframe to choose how the camera goes on from it:

- To the next keyframe: Glide, Orbit (round the action), 360 round the
  action, Whip pan or Cut.
- From the last keyframe of a part, with no keyframe to go to: Hold, 360
  round the action, Push in, Pull back or Crane up. The last lead-in
  keyframe's move runs until the shot, and the last lead-out keyframe's
  until the end of the clip.

The same menu has Look through it, Replace with the view on screen and
Delete. The Camera tab lists every keyframe with a picture of its view,
whether it is lead-in or lead-out, and its move. A keyframe keeps the field
of view it was made with, so zooming in for the second of two keyframes
gives a push in.

## Slow motion

The kill shot slows itself around the shot (bullet time). The Speed lane
shows it as "Bullet time · auto". Right-click it to make it subtle, strong,
extreme or off.

To slow a stretch yourself, drag across the Speed lane. Your stretch plays
at 1/4 and replaces the bullet time for that clip. Drag it to move it, drag
its ends to resize it, and right-click it for 1/2, 1/4 or 1/10. Remove it and
the bullet time comes back.

## Look, text and effects

- Look: eight colour grades, a vignette, the frame, a thirds grid, and a
  safe-area guide (for 9:16, the strips that Shorts covers with its own
  buttons).
- Text: a title over the middle of the frame; a lower third that writes
  itself from the kill (who, with what, whom, how far) unless you type your
  own words; the round's kill feed in team colours; your channel tag. Titles
  and lower thirds are bars on the Text lane.
- Effects: fade in from black and out to black, and on the kill a white
  flash, a zoom punch, a shake and a freeze frame. They show on the FX lane;
  right-click it to switch them.
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

- Record the clip plays it once in real time at the monitor's full size and
  downloads it (MP4 or WebM, with the game's sound). Slow motion takes its
  time, so a 7 s clip with heavy slow motion can take 20 s. Keep other
  windows quiet while it records; Esc stops and saves.
- Save a thumbnail downloads the frame on screen as a PNG, cropped, graded
  and with its text.
- Keep the clip adds it to Kept clips with its camera, slow motion, look,
  text and effects. Names can be edited in the list.
- Record a montage records every kept clip in the order they happened, into
  one video, each with its own camera and style.

## Keys

| Key | What it does |
|---|---|
| Space | Play or pause the clip |
| Left, Right | A frame back or on (with Shift, ten) |
| Home, End | The clip's start or end |
| K | Keyframe the view on screen |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| WASD, Q, E | Fly (Free fly) |
| 5 | Kill shot of the followed man's next kill |
| Esc | Leave a text box, close a menu, stop recording, leave the studio |

## Tips

- Try the chase styles before keyframing anything. Chase 360 on a long
  sniper shot often needs no other camera.
- A strong clip is usually one lead-in keyframe a second or two before the
  shot, the chase, and a cut to one wide lead-out keyframe.
- For Shorts, turn on the safe-area guide before placing text.
- Keep the clips as you go and record them all at the end with Record a
  montage.
