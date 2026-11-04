# Edits for compilations: transitions, streaks, pacing

Research brief (2026-11-04) for the per-player and streak compilations. The
owner's bar: "engaging, not edgy". Rejected before: zoom punch on the hit,
camera shake, white flash, a "WASTED" overlay, rapid unexplained cuts. Liked:
slow motion on the hit, seeing the shot land and the wreck fall, staying
behind the shooter, the fade to black between crash clips, the player's name
on screen.

**How good the sources are.** Most numbers on editing and retention come from
vendor and creator blogs, not studies. Read them as conventions that guides
agree on, not as measured facts. Frame counts are at 30 fps.

## 1. Transitions between kills

| Edit | What it looks like | Why it works | Frames | Hurts readability when | How we build it |
|---|---|---|---|---|---|
| **Speed ramp out/in** | Clip A's last beat speeds up from the slow-mo hold to about 1.5x, and clip B starts fast and eases to 1x before its action | A smooth change of speed feels like motion, not a jump. Guides say step through speeds (1x, 2x, 4x, 2x, 1x) rather than jumping between them [1][2] | 8-15 per ramp | It ramps across the hit, or the ramp is so fast the wreck can't be read | In the renderer: each output frame moves the replay clock by `dt * speed(t)`, with `speed` eased by smoothstep. These are real rendered frames, not blended ones, so it costs nothing in ffmpeg |
| **Short dip to black** | The fade we have, shortened: down 6, black 2-3, up 6 | It keeps the "new chapter" signal the owner liked, at about a third of the dead time | 14-16 in total | Under about 8 frames, it reads as a flicker | Alpha on the 2D canvas, or `xfade=transition=fadeblack` (`fadefast` also exists; ffmpeg 9.0.2 here has 58 transitions, from `ffmpeg -h filter=xfade`) |
| **Sound bridge (J-cut)** | Clip B's sound (an engine, gunfire) starts under clip A's last frames, before B's picture | The sound tells the viewer the scene is changing before the picture does, so the cut feels continuous [3][4]. Editors use about 6-12 frames of audio lead at 30 fps [4] | 6-12 of audio lead | Rarely. It only goes wrong if B's sound is loud and A is still on its hit | `acrossfade` or `adelay` + `amix` at the join. This needs the Shorts to have sound, and the README still says they are silent because the sound tap only runs in real time |
| **Context bridge (map wipe)** | A 1 s top-down minimap card: the player's path from kill N to kill N+1, a dot moving along it, "+0:42" | It answers "where did he go, and how long did it take", so a cut stops being unexplained. That fits his liking for context | 24-36 | It is used between kills a few seconds apart (skip it under about 5 s), or it carries too many labels | Draw it on the canvas from the recording's positions, over the level's minimap image (we already extract these). Fade the card in and out over 4 frames |
| **Match cut on motion** | Clip A ends on movement in one direction, and clip B starts on movement the same way (a plane banking left, then a tank turret turning left) | The motion carries across the cut and hides it. This is the basis of cutting on action [5] | 0 (a hard cut) | The directions or speeds don't match, or the two places look alike so the viewer thinks it is still one scene | Score each candidate join by the camera's yaw rate at the end of A and the start of B, and use it only when the two agree. This is opportunistic, not a default |
| **Directional blur / whip** | A sideways blur slide between the clips | It reads as a fast camera move. Guides put it at 0.15-0.35 s [6] | 6-10 | It is easily the "rapid cut" he rejected. A badly matched whip looks worse than a plain cut [6] | `xfade=transition=hblur` or `smoothleft`. Low priority |
| Light leak, rewind/scrub, glitch, flashes | Stylised overlays | They're mostly decoration | n/a | They're close to the edgy register he rejected | Skip them |
| Cutting on the beat | Cuts land on musical hits | Montage guides call music sync the single biggest factor [7] | n/a | It is only possible with music. See section 3 | Skip unless we add music |

Plain cuts are still the default in most montage guides. Dissolves and match
cuts are offered as the "smoother" options [7]. Fast cutting builds energy
but costs comprehension unless something keeps the viewer oriented [5].

## 2. Streak conventions

- **The counter.** In-game HUDs show the current streak after each kill, and
  the count resets on death [8][9]. In a montage it should tick on the hit
  frame, not during the transition. The new digit slides up over about 6
  frames with the old one leaving the top, with no scale punch (the owner
  dislikes zooms). The counter stays in one corner for the whole clip.
- **Tiers and milestones.** Games give named milestones: Halo awards
  "Killing Spree" at 5 kills without dying, in steps of 5, and its
  multi-kill medals need each kill within about 4 s of the last [10][11].
  For us that means a small text badge under the counter at 5, 10, 15 and
  20, in our own words (IDEAS.md already plans this). A separate tag such as
  "2 IN 4 S" can mark two kills close together. Each badge holds about 45
  frames and needs no sound.
- **The ending.** IDEAS.md plans "ENDED BY X" (show the death in slow motion,
  from behind the killer) or "UNBEATEN" when the round ended first. It
  closes on an end card: the name, the final count, the time alive. Games
  treat the death as the thing that resets the count [9], so showing it
  closes the story.
- **Pacing for 5 kills in 30-45 s.** Guides say to enter each clip just
  before the action and leave just after the payoff, at about 5 s a
  clip [7]. Each kill gets 6-8 s: about 1.5 s of approach, the hit in slow
  motion, about 1.5 s on the wreck, and the transition. With 1.5 s of title
  and about 3 s of end card, that comes to 36-44 s. A streak is a story told
  in order, so the order of the kills must not change. Guides favour a
  themed arc over a random "best of" [7].

## 3. Pacing and retention in 9:16

- **The hook.** Most guides say the first 3 s decide whether a viewer stays.
  One claims 50-60% of drop-offs happen there and sets a target of 70% or
  more still watching at 3 s [12]. For TikTok-style feeds, guides say to
  lead with the best clip [7]. For a streak that is a cold open: about 1.5 s
  of the best kill's hit in slow motion, then the title card ("STREAK - 12"
  and the name), then kill 1 onward.
- **Length.** Vendor data puts the best retention at 15-30 s and reports
  drop-offs past 45 s [12]. Keep compilations at 45 s or under. Guides also
  say to show a new visual beat every 2-4 s [12]. The camera's own moves (the
  slow-motion hold, the draw-back) count as beats, so a 6-8 s clip isn't
  slow.
- **Sound.** Guides that use music mix it at 70-80% with the game at
  30-40% [7]. YouTube's Audio Library is royalty-free with no Content ID
  claims on YouTube [13], but each track's terms for use outside YouTube
  (we host on bfstats.io) would need checking. "Royalty-free" doesn't always
  mean claim-free [13]. **Recommendation: no music.** The game's own sound,
  bridged across the cuts, is the identity, and it avoids licensing.
- **Captions.** Figures for how many people watch with the sound off range
  from 60% to 85%, and some sources say the opposite [14]. Our clips carry no
  speech, so "captions" here means the on-screen text: the name, the
  counter, a short label per kill ("TIGER - 140 m"). Keep that text clear of
  the bottom and right edges, where the Shorts and TikTok UI sits.

## 4. Ranked: what to build first

1. **A 15-frame dip with a speed ramp.** Replace the full fade with: clip A
   leaves its slow-mo hold, ramps to 1.5x over 10 frames, then dips to black
   over 6. 3 frames of black. Clip B fades up over 6 frames, starting at
   1.3x and easing to 1x over 12. It keeps the fade he likes and cuts the
   dead time. It is all done in the renderer's clock and the canvas.
2. **A streak counter that ticks on the hit.** It sits top left under the
   name and slides to the new digit over 6 frames on the hit frame, with
   milestone text at 5, 10, 15 and 20 held for 45 frames. "3 of 6" stays for
   per-player compilations.
3. **A cold open and the end of the streak.** 1.5 s of the best hit in slow
   motion, the title card, the kills in order, and then "ENDED BY X" (the
   death in slow motion) or "UNBEATEN" with the end card.
4. **A map bridge when the gap between kills is long.** Only when kills are
   20 s or more apart: a 30-frame minimap card of the route with the time
   gap. It turns a jump in time into context.
5. **J-cut sound bridges, 8-10 frames of lead.** These arrive once the
   Shorts have sound (the render is still silent). With them, the dip can
   drop to 10-12 frames.

Not recommended: whip/blur wipes as a default (only as a rare match cut),
light leaks, rewinds, flashes, beat cutting.

## Sources

1. Kapwing, speed ramp effect: https://www.kapwing.com/resources/how-to-use-the-speed-ramp-effect
2. VideoProc, gaming montage speed ramps: https://videoproc.com/video-editor/how-to-make-a-gaming-montage.htm
3. Wikipedia, J cut: https://en.wikipedia.org/wiki/J_cut
4. CapCut, L-cut and J-cut: https://www.capcut.com/resource/l-cut-and-j-cut-in-films
5. Fiveable, action editing and fast cutting: https://fiveable.me/introduction-to-film-theory/key-terms/action-editing
6. No Film School, whip pans: https://nofilmschool.com/how-to-do-a-whip-pan ; FlexClip: https://www.flexclip.com/learn/whip-pan-transition.html
7. Eklipse, how to make a gaming montage: https://blog.eklipse.gg/beginner-guide-2/how-to-make-gaming-montage.html
8. EssentiallySports, MW3 kill counter: https://www.essentiallysports.com/esports-news-call-of-duty-modern-warfare-3-multiplayer-release-patch-notes-kill-counter-is-back/
9. ONE Esports, Warzone Mobile streak reset: https://www.oneesports.gg/call-of-duty/killstreaks-in-warzone-mobile/
10. Halopedia, Halo 3 medals: https://www.halopedia.org/List_of_Halo_3_and_Halo_3:_ODST_medals
11. TheGamer, Halo streak medals: https://www.thegamer.com/halo-every-kill-streak-medal-guide-tips/
12. OpusClip, Shorts length and retention: https://opus.pro/blog/ideal-youtube-shorts-length-format-retention
13. Foxi Music, Shorts music library: https://www.foximusic.com/blog/?p=387
14. OpusClip, captions: https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices ; PostEverywhere, sound on vs off: https://posteverywhere.ai/social-media-terms/sound-on-vs-sound-off
