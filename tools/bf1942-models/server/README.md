# Room server — `tools/bf1942-models/server/`

The P2 server: the engine's multiplayer half, headless. One process serves
lobbies and rooms; one room steps one `World` (P1) at 30 Hz and streams 20 Hz
snapshots under the R-1 choke. The protocol law lives in
`viewer/netcode.js` (the wire, shared with the page's client) and
`viewer/world.js` (the sim + the receive law); these files only wire them
together.

```
glb-tree.mjs   the GLB JSON-chunk reader: a vehicle template's Object3D tree
               (seats, entries, extras) with no geometry
level.mjs      the level load: scene.json + scene.glb -> shared LevelData,
               per-room LevelInstance, the mount glue
rooms.mjs      the transport-agnostic room core: handshake, the 30 Hz loop,
               the 20 Hz broadcast, the R-1 choke, seat/spawn actions
server.mjs     the network half: GET /netcode/rooms + the WS upgrade on
               /netcode, on node:http — no npm, no deps
```

## Run

```
# one-time, per checkout: the vendored three.js as a resolvable package
# (the repo ignores node_modules, so this symlink is not in git)
mkdir -p tools/bf1942-models/node_modules/three
ln -sf ../../viewer/vendor/three.module.js \
  tools/bf1942-models/node_modules/three/three.module.js

node server/server.mjs --port 8787 --viewer viewer --default-level wake
```

`--viewer` defaults to `../viewer` beside the server dir; every
`viewer/maps/*` entry with a `scene.json` becomes a level, and a `test`
descriptor level is always registered (flat ground, two flags, a Willy and a
Zero — what `tests/room_socket_test.py` joins). The viewer modules import the
bare specifier `three`; `node_modules/three/` in this directory resolves it
headless (a symlink to the vendored copy — the repo still has zero installed
packages). The level load needs only the checkout's own maps tree; there is
no database, no audio, no GPU anywhere in the room's path.

## What each file pins

- **glb-tree.mjs** — the GLB container law (u32 magic 0x46546c67, version,
  length; JSON then BIN chunk) and the assembler's extras contract: the seat
  tree, `VehicleOccupancy` inputs, cameras, armor/physics and rigs all ride
  the JSON chunk's `nodes[].extras`, so no mesh accessor is ever read for a
  vehicle. `Object3D` node transforms compose like the loaded scene's, so
  `seats.js` surveys and the drive classes run the trees unchanged.
- **level.mjs** — `map.html`'s build sequence in miniature: heightfield from
  the scene's own terrain tiles (`buildHeightfield`'s snap law), the static
  collision index (`buildCollisionIndex`), `ownerRoots` id law, damageables,
  the body world with parked hulls, `settlePlacedVehicles` before the index,
  and the mount glue that mirrors `setPilot`/`exitVehicle`/`exitPoseManned`.
  One documented divergence: **one drive model per hull** (the World's
  `#vehicleTick` integrates `player.vehicle` once per seated player — two
  drivers would double-integrate one hull). Passengers ride without a drive;
  the room poses them off the root's live matrix.
- **rooms.mjs** — the receive law is *fed*, not enforced again: every wire
  input goes through `World.setInput(id, input, look, seq)` with the seq, so
  the world's own trim-≤4 / one-consume-per-tick / idle-zero / seq-dedupe /
  backlog-collapse logic is the one that runs. The seat/spawn actions mirror
  the engine's control channel (J-1/J-3); MSG_LEAVE is 0xd and the silent
  10 s sweep is its drop twin; snapshots go at each connection's own rate
  (default 20, floor 10) and fire events throttle at ~0.35 s per player.
- **server.mjs** — RFC 6455 handshake and frame codec only; every protocol
  decision stays in rooms.mjs. The adapter satisfies the core's peer
  contract: `{ send(bytes: Uint8Array), close(code?, reason?) }` where `send`
  takes the whole frame (type byte + payload) — that contract is the seam a
  different transport (a raw TCP listener, a mesh relay) would implement
  against.

## The two documented decisions

**Heightfield: recovered from the level's own `scene.glb` at load, not
baked.** The exporter writes terrain tiles at absolute world positions on
exact multiples of the sample spacing, and `collision.js`'s `buildHeightfield`
already owns the snap law — the server decodes the terrain tiles' POSITION
accessors from the BIN chunk (one element-wise accessor read per level,
~270 k vertices ≈ 10 ms on wake) and hands the page's own function its duck
meshes. The lattice and the material map are then shared read-only by every
room. The alternative — a python `bake_heightfield.py` writing
`maps/<level>/heightfield.json` at asset-publish time — would be faster at
room creation but adds a second source of truth that can drift from the
scene, needs a publish step for every re-extract, and cannot serve a level
the extractor already shipped. Runtime cost is the tradeoff: one decode per
level process, not per room. Materials travel the same route: the red
channel of `terrain/materials.png` (8-bit RGB(A), no interlace — the only
form the exporter emits), inflated with node's own zlib.

**Choke cap: 1044 × 16 × 20.** R-1 is the engine's capacity law —
`Σ(rate × 1044) ≤ cap`, offenders lose 5, never below 10 — but P0 never
recovered the engine's own cap value (netcode.md §5). This server documents
its choice: `RATE_BYTES × MAX_PLAYERS × SNAPSHOT_RATE_DEFAULT` = 334,080,
i.e. every player at the default rate. It is a number a Kubernetes QoS
engineer can reason about and a client can observe (rates arrive in the
constituent snapshot cadence); the law's shape is the engine's, the scale
is this project's.

## P3 seams

- `world.guns` stays `null` everywhere in this code — fire events reach the
  wire but nothing resolves them into rounds. Level the headless GunFire
  (collider/modifiers/projectileMaterials wiring) in `level.mjs`'s
  `instantiate()` — the groups/manned lists the mount glue builds are already
  the shape `GunFire.collect` feeds.
- `_shared/loadouts.json` is read but only its kit `maxHitpoints` is used
  (spawn armor); the deploy-screen kit pick and the `primary` weapon are the
  client's choice — the room's `#soldierMaxHp` is the seam.
- Supply: `World#supplyTick` runs with an empty depot field; `setSupplyDepots`
  wants the page's `collectSupplyDepots` equivalent over the scene tree.
- Spawner respawn windows (`objectSpawns[].minSpawnDelay`) are already in the
  vehicle table (`entry.window`) — P3's vehicle respawn loop reads them off
  the same rows the snapshot does.
- Kill feed: MSG_EVENT's `killed`/`captured`/`ticket` rows (netcode.js) have
  no emitter yet; `Room.#event` is the one place they will be raised from.
- The `test` descriptor level is registered by server.mjs unconditionally —
  a production deployment may drop it with a one-line config if the lobby
  should not list it.

## The peer contract (for the deploy agent)

A room peer is `{ send(bytes), close(code?, reason?) }`:
- `send(Uint8Array)` — one whole frame: type byte + payload (netcode.js's
  framing; binary for input/snapshots, JSON behind the same byte for control).
- `close(code, reason)` — terminate the connection and run the leave path.

`rooms.mjs` never imports net/socket code; `server.mjs`'s `SocketPeer` is
the reference adapter. The harnesses in `tests/` drive the same core with
in-memory peers — a virtual transport is a first-class citizen, and the
socket test proves the real junction end to end.