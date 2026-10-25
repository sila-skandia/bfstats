# Capture progress rings: the page's own addition

Status: **built** 2026-10-25. The page rings a control point on the minimap,
the full map and the HUD while it is being taken or run down. **Retail has
no such display.** The owner asked for it as a deliberate addition, so the
code and these notes label it as the page's own. It changes no law and
nothing a server is sent.

## What retail draws

- **No ring for a control point.** The client's map update walks the control
  points only to raise the white capture flag beneath the minimap (HUD-15).
- **ObjectiveMode's objectives get one.** `BfMap`'s ctor loads
  `Minimap/Objectives/Objective000..100.dds` into `BfMap+0xa4..+0xc4`. The
  objective loop in `BfMap::update` draws, around each objective, frame
  `trunc((1 - completion) * 8 + 0.5)` at 32 units, in a side's colour
  (`0x0046c84c..0x0046c9fd`). `completion` is the objective's
  `getCompletion` (`DestroyTargetObjective` `0x005558d0`: `1 - hp/maxHp`).
  So an intact target wears the full ring, and the ring empties as the target
  is destroyed. Only ObjectiveMode places objectives. The addresses and what
  is still unread are ledger OBJ-7.
- **The control point's ghost body carries no progress.** It is the team and
  the spawns-enabled byte (`+0x178`, `CPEnable`/`CPDisable`), nothing else.
  No timer, getting team or state reaches a client (ledger NET-16).

## What the page draws

The same nine frames (`extract_hud_pack.py` already put them in the shared
HUD pack, and they are live on mesh.bfstats.io; nothing new to extract or
publish), modulated by the map's measured side colours
(`MINIMAP_TEAM_TINT`):

| state of the law (AI-100) | ring | colour |
|---|---|---|
| being taken (state 3, the get timer +0x16c running) | fills, `1 - get/timeToGetControl` | the taker's |
| being run down (state 2, the lose timer +0x168) | drains, `lose/timeToLoseControl` | the holder's |
| lost, not yet retaken (state 1) | empty frame | the holder's |
| a take the server has not confirmed yet | full | the taker's |
| held, neutral and idle | none | |

- **Minimap and full map** (`map-surfaces.js` `drawCaptureRing`): around each
  point's flag, 32 units wide as the client draws an objective's ring, in the
  surfaces' repaint key. The frames' rings are centred on texel 15.5 of 32
  (alpha-weighted), half a texel up and left of the picture's centre, so both
  surfaces and the HUD draw the picture `RING_ART_BIAS` (0.5/32 of its width)
  down and right: the ring is then concentric with the flag at every zoom
  (measured from the canvas draw calls: ring art centre on the flag's to
  0.01 px). A ring that looks off its flag on a surface is the player's own
  marker drawn over the flag at his position, not the flag.
- **HUD** (`capture-rings.js` `hudOverlay`, a `hud.js` overlay): over the
  capture flag's place beneath the minimap (the layout's `icon_flag` rect, 64
  units), so the ring sits on the flag disc's rim. Up while the local
  player's controlled object stands in a point's radius and that point's ring
  moves, including his own side's point being run down, where retail shows no
  flag.

## Where the numbers come from

| play | source |
|---|---|
| solo | the law itself: `bot-referee.js` `captureTick` runs `control-point-law.js` `controlPointStep` on the flags, and the ring reads `flag._cp` |
| a real server (sidecar) | the estimate (below), over the server's newest positions of every player the client is sent (`remotePlayerAtTime(slot, null)`, the local player as the server has him), on the server's clock, carried by the page's between rows |
| a replay | the same estimate over the recording's fresh positions (`replay.js` `captureInput`), on the replay clock; a seek re-runs the law from 25 s before the clock |

**The estimate** (`capture-rings.js` `createCaptureEstimate`) keeps one shadow
point per control point and steps the server's law on it. The law was lifted
out of `bot-referee.js` into `control-point-law.js` so the referee, the
estimate and the lab checks run one copy. The shadow runs ahead of the word:
when its law loses or takes the point it moves on, and a lost point starts its
get timer at once, as the server's does. The word, when it comes, finds it
already there. A word it did not see coming puts it to the law's state after
that change (`gotControl`: held, timers full; `lostControl`: neutral, state
1). Its own change, unconfirmed for 2 s, is dropped for the server's team.

What it cannot see: an enemy beyond this client's ghost scope
(round-replay-capture section 19; a side's own players are sent everywhere),
and the timers' state when the page joined. A point far from the player can
run slow or not at all until the server's word puts it right.

## Measured on the lab (2026-10-25)

Gazala Conquest, no bots, `lab/capture_probe.mjs` (a sidecar soldier walks into
the radius and stands; it logs the server's own position of him and every
control point body by the server's tick), `lab/capture_check.py`:

| point | from, to | word after first in the radius (server's position) | estimate ahead of the word |
|---|---|---|---|
| 0PEN_BASE_crossing (neutral, get 10, radius 50) | 0, 1 | 10.00 s | 0.00 s |
| ALLIES_village (team 2, lose 10, get 10) | 2, 0 | 10.07 s | 0.03 s |
| ALLIES_village | 0, 1 | 20.07 s | 0.00 s |

The same capture recorded by a watching sidecar (`sidecar.mjs --out`) and fed
through the page's own sidecar state and tick: the ring filled through all
nine frames and stood full when the word came, 0.1 s after the estimate.
With the words held back 9 ticks (0.3 s), the estimate is 0.3 s ahead of each
and keeps the ring full until the take is confirmed.

Pinned by `tools/bf1942-models/tests/test_capture_rings.py` (fixtures
`capture_gazala_*`; harnesses `capture_ring_harness.mjs`,
`capture_ring_net_harness.mjs`).

Seen on the way: a second player joining a lab server with one player restarts
the round (game status 3, then 1), which kills the first player's soldier.
Several spawn points on Battleaxe, Kursk and Gazala sit inside walls a
straight walk cannot leave. The probe side-steps at an angle when stuck. The
Gazala villages' axis-side spawn at `[1271.6, -258]` never got out.

## Self-audit

A headless solo run on Kursk (`?shots=1`), the player teleported into
`openbasecammo` and later 15 m inside `openbase_lumbermill_Cpoint`: the HUD
showed the white flag with the red ring on its rim, filling. The minimap and
the open map showed the red ring round the flag, under the player's marker,
stepping `objective012 -> 025 -> 050 -> 062` over 6 s (a 10 s take).

## Open

- A contested point (both sides inside) was not walked on the lab. It runs the
  same law the referee's tests pin (`test_control_point_law.py`).
- A replay's ring was not run in a browser. It reads the same estimate,
  guarded.
- A page room (the browser's own server, `netcode-client.js`) has no server
  clock on its client. There the estimate does not run and no ring shows.
- The page does not ring ObjectiveMode's objectives, which retail does
  (OBJ-7). It would take `objectives.js` completion and the same frames.
