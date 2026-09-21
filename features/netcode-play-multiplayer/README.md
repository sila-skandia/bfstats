# Netcode for the play site: multiplayer over the existing viewer

Investigation, 2026-09-20. No code was written; this is the design and the
evidence it rests on. The owner asked how to add multiplayer to the play
experience (`viewer/play/` and `viewer/map.html`): several players join a map
and play together, the netcode leverages everything built so far, and the
ceiling is 16 concurrent players.

**Constraint decision, 2026-09-20 (owner):** do not design around the node's
memory/CPU budget. Keep the result lean and well-architected; the owner will
host it accordingly (plan bump included) and we will profile on the real
node. Capacity notes below stay as context, not as gates — nothing in the
design depends on them.

## The thesis

BF1942's own netcode is the reference architecture, and it is not a mystery:
**the dedicated server binary with symbols is already on this machine**, and
the corpus already indexes the netcode's seams on both sides. The engine is —
verified, not assumed — an **authoritative server stepping a fixed 30 Hz
simulation, consuming one buffered `PlayerInput` per tick per player, with the
client predicting and interpolating**. That is the "well solved problem", and
it survived 64 players in 2002 on hardware this node beats by two orders of
magnitude.

The viewer already runs a faithful version of that simulation in the browser.
The plan is: **run the same sim modules headless in a Node.js room server
inside the cluster, feed it the same input struct the page already builds, and
have the page render remote players the way it already renders replays.**
No lockstep, no P2P, no rewrites. Almost every hard problem of netcode has a
built, tested answer somewhere in this repo already.

## What the engine's netcode actually was (from the binaries)

| Evidence | Address | What it says |
|---|---|---|
| One buffered input per tick reaches the player | `Setup::dispatchPlayerInput` client `0x00448520`; `Game__addPlayerInput` `0x0040ecb0` | The wire carries **input**, one tick's worth per tick — the client does not run a second world sim and reconcile it; it predicts locally and the server is final |
| The server consumes per-player per-tick input | `GameServer::checkPlayerTriggers(BFPlayer*, PlayerInput)` lnxded `0x0814f2c0` | Authority lives in `GameServer`; the soldier is a plain consumer of the same `PlayerInput` type the client serializes |
| Input has a wire format | `operator<<(ostream&, PlayerInputMap)` / `operator>>` lnxded `0x081d89f0` / `0x081d8bc0` | The engine shipped a serialization for exactly the structure we need to send |
| The client's netcode classes are named | `IService` / `IJoinService` / `IHostService` (client classes recovered in Ghidra) | Join/host split: a dedicated host service, joiners connect to it |
| The loop is fixed-step on both binaries | W3-F closed LOOP-1: **fixed 30 Hz, `dt = 1/30` exactly, server and client**, backlog above 9-10 ticks collapses to one | The tick discipline the viewer already implements (`physics.js` `ENGINE_TICK_RATE = 30`, `TICK_RATE = 60`, `MAX_CATCH_UP_TICKS = 12`) is the engine's own trade-off |
| Pain points were real and dealt with | `patch__*` symbols (bf42plus): `GameClient_disconnect_udp`, `force_disconnect_msg`, `network_error_debug`, `skip_spawn_screen_join` | The 2004 netcode had the classic problems — disconnects, spawn-join stalls. We get to skip the ones that were hardware-era (UDP hole punching is moot: the server is in our cluster) |

A research stream (P0 below) reads the rest: how `PlayerInputMap` composes
(with the delightfully old `PartHash`-style fidelity the engine used), what
`IService` does on the wire, and whether the client's prediction window is
readable. None of it is required to start; all of it makes the protocol
decisions *the game's* rather than ours.

## What the codebase already gives us (the leverage)

### 1. A compact input struct that is already the engine's

`map.html:7021` builds `{ forward, strafe, walk, crouch, prone, jump }` and
`stepSoldierLook(pumpLook(dt))` carries the look axis. The same `input` object
feeds the soldier (`soldier.step(dt, input)`), `drive(dt)`, `pilot(dt)`
(`aircraft.setInput(name, value)`) and `manned()`. The look law is the
engine's rate formula (`mouse-input.js`, with the +-16 clamp, 4096-step
quantization, per-seat sensitivity — GUN-2b). **A netcode input packet is
almost literally the object that already travels from the keyboard to the sim
every frame.** The mutable/mobile equivalents (`mobilePadAxis`, touch fire,
touch look) collapse into the same fields at the same point.

### 2. A sim that already runs headless

The codebase keeps a deliberate sim/render discipline: `armor.js` "imports
nothing", `effects-core.js` "imports nothing, which is what makes this
possible"; dozens of harnesses drive sim modules under node
(`tests/*_harness.mjs`, `node:assert/strict`). What remains THREE-coupled for
math (`gunfire.js`, `ground.js`) is fine — three.js is pure JS and runs
headless under Node; the *rendering* half (scene graph, GLTF, cameras) never
enters the server. The world data the server needs — `buildHeightfield`,
`buildCollisionIndex`, spawns, flags, tickets, damage tables, combat-area
rects — is extracted JSON/glb on the volume, already consumed without a
browser by tests.

**The one real refactor** is what P1 exists for: today `map.html`'s `frame()`
steps one local soldier plus the world glue (HUD feeds, camera, audio). A
server needs a `World` object that owns N soldiers, the vehicles, the guns,
tickets, flags and the collider, and steps them at 30 Hz from per-player
input queues. The modules underneath (the expensive, verified parts) move
unchanged. This is the "leverage everything built so far" line item: the
server is a new *owner* of existing parts, not a new simulation.

### 3. A remote-entity renderer that already works

`replay.js` draws bf42plus recordings: tick-stamped samples at 10 Hz,
interpolated between samples, entities parented into vehicles, projectiles,
labels, kill-feed text (`SCORE_TEXT`: captured / killed / team-killed /
objective), game status, a server event log aligned by clock. Multiplayer
remote rendering is *the replay renderer with a live feed instead of a file*
— including the follow cameras and the `MultiPlayerFreeCamera` spectator
mode it already names. The interpolation constants, coordinate flip
(`toViewPosition`) and label rules transfer directly. Even the format is a
head start: **the room server can record the authoritative match in the
recording format and a match replay exists for free, with no extra code path**
(`?replay=` already plays it back).

### 4. The game loop research that makes the protocol obvious

The engine's `PlayerInput` cadence (30 Hz, one per tick, backlog collapses) is
settled corpus (W3-F). The viewer's own accumulator discipline (`TICK_RATE`
60, `ENGINE_TICK_RATE` 30, catch-up cap) means the client already has the
machinery for a 30 Hz wire tick rendered at whatever the display needs. The
replay system's `SAMPLE_PERIOD = 0.1` (10 Hz) is a proven interpolation
cadence for exactly this game's movement — including aircraft, which is the
stress case. Nothing about the protocol has to be invented on first
principles; every number already has an owner in the repo.

### 5. Bugs the netcode will inherit (and why that is fine)

The parity round's open list is the server's bug list too: the M3A1's lean,
vehicles against statics, a driven hull that tumbles on crash, the wake-up
bounce, the tick-rate LOOP-1 caveats. **Server-authoritative play makes every
simulation bug a shared, visible bug** — but it also makes them *chaotic
strawmen* instead of blockers for AI, because there is no AI: the server runs
the same physics the page runs, and the page's fixes arrive on the server by
the same merge. The netcode does not need the sim to be finished; it needs
the sim's *inputs and outputs* to be honest, which they are.

## Architecture

### The shape

```
browser (viewer/play or map.html)
  ├── local sim (unchanged: soldier.step, drive, pilot, guns.advance)
  ├── prediction: local entity is whatever the local sim says
  └── net layer: input packets out, snapshots + events in
        │  (wss://play.bfstats.io/netcode — HAProxy mode http + cloudflared)
        ▼
Room server (Node.js, new small pod)
  ├── World: the viewer sim modules, headless, 30 Hz fixed tick
  ├── per-player input queues (one PlayerInput per tick, engine-style)
  ├── authority: armor/damage/tickets/flags/seat changes all final here
  └── broadcaster: 10-20 Hz snapshots + event messages (kill, flag, ticket)
        │
        ▼  (optional project, P5)
recorder: same tick/event stream → replay.js format, zero new player-visible
code beyond "this match has a replay"
```

- **Authoritative server, client prediction of self**. The client keeps
  rendering its own entity from the local sim (no change to feel: input
  latency stays ~0 locally), corrects from server snapshots (position/
  vault corrections happen client-side, the same way the engine's client
  would have). Remote entities render at interpolated 10 Hz (the replay
  path). Server confirms kills/damage with short grace windows.
- **Input-only up, snapshots down**. 16 players × 30 Hz × ~20-40 B input is
  trivial (≈20 KB/s up in the worst case). Snapshots down: 16 entities +
  projectiles + vehicles at 15 Hz, binary-framed, is well under 100 KB/s
  down. JSON would work at this scale; binary framing (a tiny codec beside
  the wire format, or protobuf if the owner prefers a schema) keeps it
  boring. The engine's own `PlayerInputMap << >>` is the precedent to copy
  the field layout from.
- **Why not P2P / host migration**: the server is in the cluster we control.
  No NAT traversal, no host disconnects, no trust questions, no anti-cheat
  needed among friends, and a recording facility for free. At 16 players the
  cost of a server pod is one small container; the alternative costs the
  hardest networking code there is. This is the same choice the 2002 game
  made (it shipped a dedicated server for exactly this).
- **Why not lockstep**: lockstep needs deterministic sims and perfect input
  delivery; the corpus has spent weeks proving how *carefully* the engine's
  physics behaves, and the viewer's sim is not provably bit-deterministic
  across machines (and does not need to be — the server never has to agree
  with a client, it just has to be right). Authoritative is the tolerance the
  existing bug list needs.

### Transport: WebSocket first

- HAProxy is `mode http` on `:8080` (`deploy/app/ingress/deployment.yaml`) —
  upgrade requests pass through unchanged; the cloudflared tunnel carries
  WebSockets. So `wss://` reaches a new backend with the same Host-ACL
  pattern as `play_frontend`, no new ingress machinery.
- Latency reality at this scale: WebSocket costs ~one TCP round trip of
  headroom over UDP, and TCP head-of-line blocks a stalling packet — but
  with client prediction and 10 Hz interpolation, that hides inside the same
  budget the 2002 game's UDP path was designed around. The project already
  documents the real constraint: AU vs EU round trips
  (`features/perf-latency-au`). A 16-player room on one node in Germany is
  the *same geography problem the original game had*, and its answer was
  prediction, not a better transport.
- **WebRTC DataChannel / direct UDP is the designated later upgrade, not part
  of the first build.** The net layer should keep a one-interface seam
  (`send(input)`, `on(snapshot|event)`) so a transport swap never touches the
  sim or the renderer. Note that the tunnel/ingress path today has no UDP
  route at all; making one is a project of its own and is not justified at
  16 players.

### Join and lobby

- The Instant Battle screen (`viewer/play/`) is the lobby: it already picks a
  mod, a level and a team, and START already launches `map.html?map=&team=`.
  Multiplayer extends it: a room list (who/how many/both teams' flags),
  CREATE ROOM and JOIN ROOM rows in the game's own list-box idiom (the
  `BfNewListBoxNode` well is already decoded), and room codes. `map.html`
  gains `?room=<id>` on top of `?map=` — the room names the level, the map
  page joins it.
- Spawns: the server owns the entity slots and uses the same
  `pickSpawn`/`spawnYaw`/`spawnFlags` the page uses; `deployFlagIndices` and
  the "a side with no flag gets them all" rule transfer verbatim. Teams are
  balanced by the same rule the page already holds (Instant Battle's team
  rows; tickets from the level's own data).
- Seeds: a player who joins an in-progress room gets a state snapshot
  (spawns, flags, tickets, entities) before live snapshots start — the
  replay format's v3 already carries the fields a late join needs (positions,
  hit points) which is the same set a snapshot needs.

### Server capacity on the node

| Metric | Estimate | Note |
|---|---|---|
| Sim cost | 16 soldiers + ~30-60 vehicles + projectiles at 30 Hz | The page steps one soldier at 60 Hz inside one frame budget on client iron; 16 at 30 Hz on a server is a fraction of one core. Real measure in P1 |
| Bandwidth | « 100 KB/s both directions for 16 players | Binary frames; even JSON is not absurd |  
| Memory | Node RSS ~120-200 Mi with level data + rooms | Room data is small; the big assets (glb scenes) never load server-side — only `scene.json`, heightfield/collision index, damage tables |
| The actual blocker | None, by the owner's decision | The node is at 7296/7741 Mi today, but hosting is the owner's to arrange; a ~192 Mi-limit pod is a rounding error on the plan the owner named. Profile on the real node, P1 onward |

### The player-count ceiling

16 comes for free with this design — it is not a scaling constraint, it is a
lobby rule (a room has 16 slots, `MAX_PLAYERS`). What actually bounds *feel*,
as in the original game, is region latency, and the mitigation is the same
the original shipped: prediction for self, interpolation for others, and the
10 Hz render path already proven by the replay work.

## Phases

Same shape as the parity round: one stream per phase, spec says what done
means, a reviewer re-derives before merge, research streams change no code.

### P0 — Research: the engine's netcode, read from the binaries (no code)

Read from the client and `lnxded` (decompile by name, `lnxded/decompile.sh`):
how `PlayerInputMap` serializes (field order, widths, quantization — the
`>>` operator is the spec for our wire format), `IService`/`IJoinService`/
`IHostService`'s lifecycle (join handshake, reservation, the disconnect
paths the patches fought), `GameServer::checkPlayerTriggers`'s lag handling
(did the engine buffer `PlayerInput` on a queue? drop on backlog? the
viewer's `MAX_CATCH_UP_TICKS` should match the engine's own answer), and how
the client reconciled remote entities (the thing `replay.js` approximates).
Deliverable: a `subsystems/netcode.md` write-up + ledger rows, all claims
verified by a second reader. Done means every protocol decision we later make
is either "the engine's" or a cited deliberate departure.

### P1 — The headless world server (the refactor)

Factor a `World` out of `map.html`'s `frame()`: owns N `Soldier`s, the
vehicle bodies (existing `BodyWorld`/`DrivenBody`), `guns`, tickets, flags,
combat areas, supply fields, collider; steps at 30 Hz with the engine's tick
discipline from per-player input queues. Run it under Node with the existing
harness pattern, driven by scripted input; the test of done is that a
recorded bf42plus replay's entities can be *instanced and stepped* in the
headless world (replay.js already places them — the world must reproduce
their motion within the interpolation tolerance). No networking in P1.

### P2 — Transport and room lifecycle

**Implemented 2026-09-21** — the done-bar holds on this box:
`tools/bf1942-models/tests/p2_two_browser_smoke.mjs` boots the room server
over real TCP plus a static server, drives two Playwright chromium pages
into one room, deploys both, walks A two deterministic seconds
(`__renderOnce`, the page's own headless clock), asserts B's confirmed ghost
tracks A within 2 m, has A enter the nearest vehicle (matched to the room's
vehicle table by template + pose, the ID rides `MSG_ACTION`), asserts the
server mounts it (its own snapshot stream now carries A seated — B sees the
seat even though the seat row excludes the actor), holds the trigger and
sees the server's throttled `fire` rows on B, then explicitly leaves and
sees the leave row land. Exit 0 is the done-bar; `--port`/`--static` pick
free ports so runs never collide (and the smoke SIGKILLs its room server,
static server, and both chromium processes on any exit — no strays).

What P2 delivered:

- `viewer/netcode.js` — the wire: the engine's 104-bit `PlayerAction` record
  (six 12-bit channels, bit-packed, the u32 button mask, ±16 headroom) with
  `mouse-input.js`'s own quantization, plus a one-byte extension for the
  page's raw key pairs (the aircraft's `forwardKeys`/`rudder`), the frame
  types, and the 27-byte player / 30-byte vehicle snapshot records. Two
  cited departures: bits 22/23 for the page's jump and pad marker, and the
  byte-13 key pairs — the engine's own record is untouched otherwise.
- `tools/bf1942-models/server/` — the room server, zero npm deps:
  `server.mjs` (RFC6455 handshake + frame codec on `node:http`, ~150 lines;
  a handler exception severs the peer, never the listener), `rooms.mjs`
  (rooms, join/leave, heartbeat with `HEARTBEAT_TIMEOUT_MS = 15 s` — the
  page's own level load starves its main thread for seconds, and the ping
  starts at socket open, not after the hello), the 20 Hz snapshot streams
  with the R-1 choke law, `MSG_ACTION` seat enter/exit/switch + spawn,
  fire-row throttling at the SMG cadence), `level.mjs` (headless level
  loading: scene.json, the scene.glb JSON chunk trees, the heightfield from
  the terrain geometry, collision sidecars; template resolution is
  case-insensitive — scene.json spells `sherman`, the files are
  `Sherman.Kasserine_Pass.glb` — and mesh nodes get real (empty)
  `BufferGeometry` so wheel/tracer measurement answers instead of throwing;
  `mountIntoSeat` mirrors the page's enter flow), `glb-tree.mjs` (GLB JSON
  chunk reader, no mesh data).
- `viewer/netcode-client.js` + `viewer/netcode-render.js` — the page's
  seam: one client object (join, seq-managed input word per consumed tick,
  snapshot buffer lerped at `t − 50 ms` — render-side smoothing the engine
  never shipped, the wire stays the law), a replay-style remote renderer
  (pose-pair soldier replicas, template vehicle replicas, seat parentage,
  stance from flags, gait from a measured speed, parked-hull handover via
  `onOccupyChange`), and the `?room=` glue in `map.html` (join rides the
  page's own load — the room block runs before the level manifest — a
  mismatched level reloads ONCE with the room's level in the URL, the room
  names the team, the deploy flow is unchanged).
- `viewer/play/rooms.js` + the Instant Battle screen's PLAY ONLINE panel —
  the lobby: `/netcode/rooms` list (polled), create/join with a name and a
  room code, launch via `?room=&name=&map=`. Single-player START is
  untouched.
- `netcode/Dockerfile`, `deploy/app/netcode-deployment.yaml`,
  `deploy/app/ingress/deployment.yaml` (path-beg `/netcode` ACL, `timeout
  tunnel`, `init-addr` caution), the Jenkinsfile's `NETCODE_ENABLED=false`
  stage, and the Deployment section below. Nothing was applied to any
  cluster — the owner's call, per repo convention.

The room server's vehicle table is every seatable spawn (`objectSpawns` ∪
`vehicleSoldierSpawns`) with a published template — 33 on Aberdeen, each
with its template, pose-frozen on real slopes, drive-mountable headless.

What is NOT in P2 (deliberate, next phases): damage/kills authority (P3 —
the server's world has no armor tables wired yet; a player's HP in
snapshots is the kit max), remote fire visuals beyond the feed rows (P4),
the spectator cameras (P4), recording (P4), and any client correction
(P4 — the smoke asserts prediction ≈ authority within 2 m at tick
boundaries, which is the honest P2 state).

### P3 — Authority: damage, kills, tickets, flags

**Slice A implemented 2026-09-21** — the authority lives in
`tools/bf1942-models/server/authority.mjs`, wired into every room's
post-step pass (`rooms.mjs`), and pinned by the room harness's (k)/(l)
scenarios:

- **Armor on the server** — each spawn builds the player's Armor from
  `_shared/loadouts.json` the page's own way (`kits[kit].maxHitpoints`,
  fallback 30; the deploy's spawn row now carries the kit). One law, two
  constructions, one sidecar.
- **The death decree** — every damage the world's own sim lands (combat
  area, crash costs, the vehicle water/critical pass) lands on a player's
  Armor during `step`; the authority notices a destroyed Armor and makes it
  a death: the `killed` row (crash/vehicle attribution where the report
  names the other object, else null — Armor's own `lastHit` is the seam for
  slice B's splash), one ticket (`LOSS_PER_DEATH = 1`, the engine's
  `setTicketLosePerDeath`), the dead-until-respawn latch, the input gate
  (a dead player's word never reaches the world), and `alive: false` in
  the snapshots. The deploy action revives with fresh Armor.
- **The ticket law** — one per death; plus `lossPerMin` drained once a
  second while the other side holds more than half the capturable flags
  (`setTicketLostPerMin`'s majority gate — the parity round's missing
  server-side timer). `ticket` rows carry the fresh counts.
- **Flag capture** — a live, un-contested enemy inside the flag's ring for
  `FLAG_CAPTURE_SECONDS` flips the owner (`captured` rows; the deploy
  screen's list and the map markers repaint from the `flags[]` write).
  **`FLAG_CAPTURE_RADIUS_MS = 8` and `FLAG_CAPTURE_SECONDS = 8` are
  authored constants** — the capture law was never corpus-read, so P5
  confirms or corrects them in one place. Uncapturable points (the fleet)
  never count toward the majority.
- **Client consumption** — a `killed` row for the local slot drives the
  page's own death loop (destroyed Armor ⇒ the existing death cam and
  deploy screen — the suicide path's precedent), snapshots correct HP
  (server word, 1.5 HP grace, never heals — the supply depots heal both
  sides) and position (4 m grace snap; P4's smoothing owns the small
  stuff), `ticket` rows replace `extras.tickets` (the page's own
  prescribed live-update path for the HUD's memoised painters), and the
  feed speaks the kill/ticket/captured vocabulary on both sides.

**Slice B — the projectile path — is the remaining P3 work**: the
headless `GunFire` wiring (`instantiate`'s "P3 seam: `guns: null`") so
rounds and fuse contacts resolve server-side from damage.json, and
`splashTargets`/`applySplash` over the server's own players and damageables
(the page glue `map.html:5828`; the server's `onImpact` hook is the seam).
Until it lands, the only damage in a room is combat-area, water/critical
and crash damage — which is exactly the harness's tested shape.

### P4 — Feel and correctness

Client prediction tuning: input latency stays ~0 for self (already true — the
local sim is the predictor), correction smoothing, snapshot interpolation
order (position → orientation → seat linkage), the spectator/multiplayer
follow cameras (replay.js's exist), sound for remote entities (the S4 sound
lifecycle work covers attachment), and the recorded-match replay (server
writes the recording format; `?replay=` works unchanged).

### P5 — Hardening and the bug list

Deterministic-server tests (the same input stream lands the same world state
— the server *can* be deterministic on one machine even though cross-machine
determinism was never required), reconnect/backlog tests, the 16-slot lobby
limits, and draining the inherited sim bug list (M3A1 lean, vehicles vs
statics, crash tumble) now that their impact is shared. Metrics into the
existing Seq/telemetry path (room count, tick deficit, snapshot size) —
the telemetry feature (`Telemetry/`) already classifies page types; rooms
slot into the same shape.

## Open questions for the owner (not blockers)

1. ~~**The pod budget.**~~ **Settled by the owner, 2026-09-20: not a design
   constraint.** The node is over headroom before this project starts
   (`features/bf1942-in-the-browser` §"The node does not have room for this
   yet") and the owner will host accordingly and profile on the machine. The
   netcode pod stays lean by construction (one Node process, no framework,
   level data without glb scenes); no deployment arithmetic gates any phase.
2. **Transport:** WebSocket-first is recommended. If the owner has seen
   jitter pain in EU-vs-friends play that prediction cannot absorb, WebRTC
   DataChannel becomes a P2 scope change — say so before P2.
3. **Rooms vs. always-on servers:** rooms created on demand (a lobby the
   size of the Instant Battle screen) vs. persistent servers per map. Rooms
   are recommended: 16 players, friends, and the pod is tiny either way —
   but a persistent "server browser" is the authentic-2002 shape if the
   owner wants the map list to become the game's own browser.
4. **Recording**: matches recorded by default (replay for free, also the
   bug-hunting prize) or only when a room opts in. Recording by default is
   recommended — the format and the player are done.
5. **Accounts vs. handles:** the page has no identity today (the API's auth
   is for tournaments/discord). A name field per room (the game's own
   entry-point style: type a name into a list box) is recommended; wiring
   bfstats logins is a separate feature, not a netcode prerequisite.

## What was checked, and how

- The viewer's sim structure: `map.html` `frame(dt)` (line 11179) steps the
  one local soldier/vehicle then the world; the `input` object at line 7021
  is the engine's `PlayerInput` shape, look via `mouse-input.js` (GUN-2b
  law). Verified by reading the code cited above.
- Headless viability: `tests/*_harness.mjs` already import sim modules under
  plain node (`armor_harness.mjs`: "The module imports nothing"); the
  codebase's own comments name the discipline. THREE-importing modules are
  math-only for our purposes.
- The engine's netcode is in the corpus *index* today (the symbols in the
  first table are in `symbols.json`), and `lnxded` decompiles by name — the
  deeper read is P0, but the classes and the loop are not speculation.
- Transport path: `deploy/app/ingress/deployment.yaml` is `mode http`,
  cloudflared tunnels carry WebSockets, Host-ACL `play_frontend` pattern
  already drafted in the play-site feature doc.
- The budget numbers are the same sweep the play-site doc made (7296/7741 Mi
  with the limits of `deploy/app/*.yaml` summed), unchanged since 2026-09-19;
  recorded here as context only, per the owner's constraint decision.

## Deployment (P2)

Written, reviewed, **not applied** — the same convention the play site
followed (`features/bf1942-in-the-browser/README.md` §Deployment): the
manifests, the image build and the pipeline stage land in the repo, and
`kubectl` does not run until the owner says so.

What now exists, one line each:

- `netcode/Dockerfile` — the room server image (`node:22-alpine`): copies
  `tools/bf1942-models/server/` plus the whole `tools/bf1942-models/viewer/`
  tree (mesh's copy-wholesale rule), stands the vendored `three.module.js`
  up as `node_modules/three` the way the test harnesses do, and fixes
  `node /app/server/server.mjs --port 8080 --viewer /app/viewer` as the
  entrypoint. `deploy/app/netcode-deployment.yaml` mounts `assets/mesh/maps`
  and `assets/mesh/models` (same PVC, same subPaths as the mesh pod) over
  `/app/viewer/maps` and `/app/viewer/models`, read-only, so level data is
  never copied and the server reads exactly what the browser reads.
- `deploy/app/netcode-deployment.yaml` — Deployment + Service in
  `bf42-stats`: `anskia/bfstats-netcode:latest`, containerPort 8080 (Node
  convention, matching the API pods; mesh is 80 because nginx), requests
  96Mi/50m CPU, limits 192Mi/400m CPU — the estimate above, with the
  cgroup/back-pressure relationship commented in. No priorityClassName: a
  30 Hz tick absorbs scheduler delay, and the 1942-services class must
  never ride this pod.
- `deploy/app/ingress/deployment.yaml` — additive only: `acl is_netcode
  path_beg /netcode`, `use_backend netcode if is_netcode` before the
  default, and a `netcode` backend with `timeout tunnel 4h` and
  `init-addr last,libc,none`. Every pre-existing line is untouched.
- `Jenkinsfile` — a Netcode Pipeline stage (build + apply) mirroring the
  play stage's mechanics exactly, gated on `NETCODE_ENABLED = 'false'`.
- `deploy/app/ingress/README.md` — a netcode section: the route, the apply
  order and the manual-steps reminder.

Apply order, when the owner chooses to:

1. Apply `deploy/app/netcode-deployment.yaml` — the Service must exist
   before the ingress step, because…
2. Apply the ingress ConfigMap and `kubectl -n haproxy rollout restart
   deployment/haproxy`. HAProxy has no `resolvers` section, so backend names
   resolve once at boot; a name that resolves only after the ConfigMap
   applies sits DOWN (503) until the restart. The ConfigMap apply is a
   **manual step** — the Jenkins stage stops at the pod. `init-addr
   last,libc,none` is what makes step 2 order-safe: without it, an
   unresolvable server address is a fatal HAProxy startup error and every
   site behind this frontend dies, not just `/netcode`.

DNS/tunnel: `wss://play.bfstats.io/netcode` is the intended public URL, but
hosting is the play-site deployment's open question — the netcode route is
host-agnostic, it rides whatever host serves the play site (the `is_netcode`
ACL is path-based), and the tunnel needs no new rule for it. The budget is
not a gate (the constraint decision above); the pod's declared ceiling is
192Mi of the 7296/7741 Mi sweep either way.