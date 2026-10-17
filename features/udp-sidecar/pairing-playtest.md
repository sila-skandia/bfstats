# Pairing playtest: the owner on retail, the session in the browser

The owner joins the lab with the retail BF1942 client; the session plays a browser player
through the UDP sidecar; the owner watches that player and answers in game chat. It finds what
two-client checks between node clients cannot: what a retail player actually sees of a browser
player, and what breaks when a real person drives, shoots and captures beside it.

First session: 2026-10-17, El Alamein co-op, about 90 minutes.

## Setting it up

1. **The round** (shared lab; `python3 lab/lab.py status` first, and leave another session's
   run alone):
   `cd tools/bf1942-models && python3 lab/lab.py start lab/scenarios/sidecar-elalamein-play.json --wait 0`
   (32 slots, 4 bots, 1000 tickets a side; about 40 min before one side's tickets bleed out).
2. **The owner** joins with
   `~/.wine/bf1942-monitor/collector/bf1942-monitor.sh +joinServer 192.168.1.226:14568 +isInternet 0`.
   (The owner's own browser sidecar `skandia-bot` on ws 17942 can stay idle beside it.)
3. **The session's sidecar**, under a name the owner can find:
   `node sidecar/sidecar.mjs 192.168.1.226:14568 --name claude-browser --team 2 --ws 17970 --out <dir>/pilot.ndjson --review <dir>/pilot.review.ndjson`
   A name still held by a lingering player comes back with a suffix (`claude-browser_3`).
4. **The viewer** on a spare port (5273 is the owner's): `python3 serve_viewer.py 5292`.
5. **The browser player**: `node lab/pilot.cjs` (env `PILOT_DIR`, `SIDECAR_WS`, `VIEWER`, `MAP`),
   then append commands to `$PILOT_DIR/cmds.ndjson` and read `$PILOT_DIR/out.log`. First
   `{"k":"deploy","team":2,"flag":"British_Base","kit":"assault"}`.
6. **Game chat** is the owner's channel: watch the sidecar's recording for chat rows
   (`tail -F <dir>/pilot.ndjson | grep '"e":"chat"'`) and answer with `{"k":"chat",...}`.

## What was checked, and what the owner saw

| Step | Result |
|---|---|
| Spawn at British Base, walk 18 m, stop | "it looks great": position, facing and stop matched |
| Chat both ways | the owner's lines reached the page; the page's line reached the server's log and the owner's screen |
| Turn on the spot, crouch, prone, stand | crouch and prone seen ("yes you crouched"); the first crouch was missed on the owner's side |
| Jump, then a running circle | "that looked perfect" |
| Look down, burst into the ground, look up | seen; a one-frame look "snapped, didn't transition" (the harness's flick, not the page: the same look spread over 0.7 s was "perfect") |
| Walk to a Willys, board, drive, get out | "yep that looked good" (stuck on stairs on the way: the owner steered the session round them) |
| Ride as the owner's passenger | **defect, fixed**: the server seated the page and the page stayed on foot; after e8958941 the page rode in the owner's Sherman, the hull where the server had it for 18 s of driving |
| Fire the hull Browning from that seat | a 31-38 round burst at 0.1 s spacing, "yep perfect" on retail; the very first burst after boarding came out as single shots, not seen again |
| Reload the page while seated | the page came back in the same seat (adopted from the server) after deploying |
| Capture East outpost together | flag state matched; **defect, fixed**: no capture line printed (255da5b9); after the fix "[East outpost] Allies captured the control point" |
| Round end (Allied tickets bled out) | the page's TOTAL DEFEAT debrief matched the server's Axis win (w 1, victory type 3), then the restart |
| Shot by the owner (team kill) | three hit arcs from the front on the page, the team-kill line, death, spawn screen |

Second session: 2026-10-17 evening, same El Alamein round, El Alamein co-op.

| Step | Result |
|---|---|
| Ride in the owner's Willys, then board a PanzerIV and swap to its MG seat | the server seated the page where the owner saw it; `__switchSeat` moved between seats |
| Fire the Panzer MG, then the owner's Sherman hull MG | "nothing showed on my game" — the harness was pulling the wrong trigger (below) |
| Killed by the enemy while seated | **defect, open**: the page never noticed; see below |
| Fire the Sherman's main gun from seat 0 through `__setSeatFire` | "yep worked" — vehicle fire reaches retail once the right hook is pulled |

### The owner in the browser, 2026-10-17 late

The owner drove the page himself through the same sidecar while a retail client watched. What a
real player notices in a minute of play, with the mechanism behind each:

| What he saw | Mechanism |
|---|---|
| His own position in the browser is off, while retail has him right | the page draws its own prediction and reconciles against the server; corrections of tens of metres were live (`corr 210, err 76.1`) |
| A remote fires: the flash is at his position, his body never moves | `remoteRound` (net-room.js) draws flash and round through `net-remote-rounds.js`; nothing drives the body's animation, and net-room.js:805 drops the flash entirely for a seated shooter |
| A remote driving a Willys, and a Wespe, is drawn standing or running | `playerRow` gives a seated player the **hull's** position, and `netcode-render.js` places his on-foot body there and picks a gait from that position's speed (`remote-gait.js` BANDS). Nothing hides the body or poses it in the seat |
| An idling APC blew up in the browser 10 s before it blew up on retail | hull hp comes from the server (`hull` rows), but the page also runs its own physics and damage, so it can wreck a hull on its own schedule |
| A spawn lands somewhere, then snaps to the server's spot | the page's spawn is a prediction by design (net-room.js:1050, `spawnRefused` is the undo); the snap is the correction |

| Knifing: every stab came out as the main gun firing | the stab is sent correctly (a knife's attack is the primary `fire` bit), but a weapon change reaches the server only as a one-word MenuSelect press (`hand-weapon.js:296`), and `selectKitWeapon` drops that press while recoil runs or the fire cycle holds the item -- while the page switches its own model regardless. The page holds a knife, the server holds the rifle |
| A flown aircraft's propeller never turns | the spin is `Vehicle.advanceEngineLods` (`vehicle-base.js:1052`, the `PhysicsEngine::updatePhysics` tail, `engine-spin.js`) off `revs`. A remote is drawn by `netcode-render.js` as a plain loaded model, not a `Vehicle`, and the server sends no revs, so nothing turns it |

| A plane's guns show no fire, and its bombs never drop | two holes. The flash: net-room.js:805 drops a remote's trigger when he is `inVehicle`, so no vehicle-mounted weapon of any remote ever draws. The ordnance: `projPool` (the server's `CreateMultipleObjects`, `sidecar/record.mjs`) has **no case at all** in `viewer/net-sidecar.js` -- the sidecar decodes it and the recording keeps it, the replay path reads it, and the live page never turns it into an event. No server projectile is drawn: bombs, shells, remote grenades |

The owner's reading, which the code bears out: **in sidecar mode the page should render server
state, not simulate it.** Remote bodies, remote vehicles, damage and destruction all have a
server word and should wait for it. The one real exception is the player's own soldier, where
retail predicts and corrects too — there the bug is the size of the divergence, not the
prediction.

## Defects it found

- **Fixed, e8958941:** a gunless passenger seat reached the page as an object of its own and the
  page never followed the server into it.
- **Fixed, 255da5b9:** a real server's capture printed no line in the message log.
- **Open (2026-10-17 evening):** the page does not notice its own death. Killed in a seat at
  t=1034, it went on reporting `seat: PanzerIV/1`, accepted fire commands and never raised the
  spawn screen; only `alive:false, hp:null` in `__net().self` gave it away, and `__deploy.spawn()`
  could not recover it — the pilot had to be restarted. Two minutes of the owner's time went on
  bursts fired by a corpse before anyone could tell that from a broken fire path.
- **Open:** Chrome loses its GPU context under load (Vulkan device lost) and the page dies; the
  owner sees the same while the native game stays smooth. The page should rebuild on WebGL's
  context lost / restored instead of stopping (the sidecar already keeps the player through a
  reload), and use less GPU memory.
- **Checked live after the session (node target, not the owner):** the 2.5x view pitch (9acf8680,
  wire.md section 33). On Wake the page walked up the slope from Landing_Beach to a node client
  standing about 12 m higher, aimed at his chest with `__lookDelta` from 6.7 m and killed him with
  its first burst (three hits, then the team kill); before the fix eight bursts in the same setup
  hit nothing. The page's learned pitch per pixel is now -0.00177 rad (was -0.00071).

## Harness lessons

- **A seated player's trigger is not the soldier's.** `__setTrigger` is the weapon in hand;
  the vehicle's `c_PIFire` is `__setSeatFire(main, alt)`. `{"k":"fire"}` pulled the soldier's
  from every seat until 2026-10-17, which fires nothing and reaches no other client — it now
  picks by `__seat().onboard` and logs which hook it used.
- **Read `alive` before trusting a silent weapon.** Nothing visible on the owner's screen has
  three causes that look identical from here: a dead player, the wrong trigger, and a real
  parity defect. `state()` carries `alive` and `hp` on every line; check them first.
- `__lookDelta`'s dy is mouse-signed: negative pitches the view **up** (about -0.00177 rad a
  pixel). `{"k":"look","dy":-400}` is a 40 degree climb, not a glance down.
- `pilot.cjs` dismisses the briefing with a mouse click; under `?shots=1` that move reaches a
  live soldier as a look, and the server's aim register climbed 7.1 a reload to its limits
  (pitch 38, twist 20). Level the view after every reload (`look` until `pitch` is near 0), or
  dismiss the briefing without the mouse.
- A headless page runs at 1-3 fps: typed chat goes a character a rendered frame (a 60-character
  line took a minute), and a single large `look` snaps on the owner's screen.
- Keep the owner's feedback flowing through game chat; the session cannot see the screen.
- One headless Chromium at a time, and expect GPU losses while other sessions render: restart
  the pilot (the load is cached, about a minute) and `deploy` to pick the player back up.
