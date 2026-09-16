# The checks only a person can do

About two minutes at a real mouse and keyboard. Everything else in this feature was
closed by automation; these three things cannot be:

- **The view snap.** CDP mouse input cannot reproduce the bogus `movementX` a real
  mouse produced when a second button joined one already held. The fix is verified
  at every other layer (19/19 through the real mouse API under real pointer lock,
  against 14/19 on the pre-fix build), but only a hand on a mouse closes it.
- **Whether Keyboard Lock actually holds Ctrl+W.** CDP injects key events *below*
  the layer that marks locked keys, so a native-keycode Ctrl+W closes the tab even
  with the lock held. Automation cannot tell the difference; you can.
- **How the fullscreen mode feels.** That is a judgement, not a measurement.

Serve the viewer (`model-viewer` in `.claude/launch.json`, port 5273) and open:

```
http://localhost:5273/map.html?mod=bf1942&map=Wake&weapon=Thompson
```

## The chord fix, and the snap

1. Click the view, tick **spawn on foot**, press SPAWN.
2. Hold left mouse (firing) and tap right. Zoom should go in **once**, and firing
   should continue.
3. Still holding left, tap right again. Zoom out once, still firing.
4. Release right, then left. Firing stops on the left release.
5. Repeat, but release **left first** while right is held. Firing must stop
   immediately. Then release right: zoom unchanged, nothing stuck.
6. Through steps 2-5, watch for any sudden swing of the view, roughly 90 degrees.
   That is the old snap. It should be gone.

## The Ctrl+W prompt

7. Crouch-walk while firing (left Ctrl + W + left mouse) and press **Ctrl+W**.
   Expect the browser's "Leave site?" prompt. Choose to stay.
8. Press Esc, then Ctrl+W: no prompt, the tab closes. Reopen, and before clicking
   into the view press Ctrl+W: no prompt.
9. Click the view but stay in fly mode, then Ctrl+W: no prompt.

## The Keyboard Lock prototype (opt-in, off by default)

Reload with `&kblock=1` on the URL.

10. Spawn on foot. The browser should go fullscreen, and the HUD should end with
    "Esc release · hold Esc exits full screen".
11. Crouch-walk while firing and press **Ctrl+W**. The tab should stay and the
    soldier should keep walking. **This is the one nothing else can confirm.**
12. Try **Ctrl+R** the same way (crouched reload — today it reloads the page) and
    **Ctrl+Shift+W**.
13. Tap Esc: the pointer is released, still fullscreen, and the gate reads "Click to
    resume · Esc exits full screen". Tap Esc again, or hold it about 2 seconds:
    windowed, HUD plain, and Ctrl+W closes the tab again.
14. Click to resume, press M, then Esc: the redeploy screen should cancel without
    leaving fullscreen.

## What to report back

Step 6 and step 11 are the two that decide something. If step 6 still snaps, the
chord fix is incomplete and the remaining cause is in the look path rather than the
button path. If step 11 closes the tab, Keyboard Lock does not hold here and
`beforeunload` stays the only guard, which would make `?kblock` not worth shipping.

Steps 10 and 13 are the fullscreen UX question: whether going fullscreen on every
on-foot spawn is worth the protection, or whether it should be an explicit toggle
instead. That one is only yours to answer.
