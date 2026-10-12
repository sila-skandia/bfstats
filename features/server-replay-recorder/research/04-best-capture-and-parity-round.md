# The best capture, and the parity round (2026-10-04)

## The best capture (2026-10-04)

The owner's follow-up: cost is no object and the POC is not the design; what
captures a round at full fidelity? Three readings settle it (ledger P-3, P-4,
AI-135):

- **Inputs alone cannot rebuild a round.** The bots' scheduler runs tasks
  until the wall clock passes a frame budget, and the random numbers are
  seeded from `time(0)` (AI-135). The truly event-based recording, inputs
  plus a re-simulation, is out.
- **The server builds a client's view of an object only while a client
  ghosts it.** A probe recorder on a bots-only round read every soldier's,
  turret's and steered wheel's replication ring: index 0, default values, in
  every sample (P-3). Hooking the send therefore records nothing without
  clients, and with clients only what each is sent. The fields those rings
  are copied from are all live on the server objects, and the copy routine
  (`updateStateMask`) is the engine's own list of what a player can ever be
  shown (P-4).
- **The client derives some of what it draws.** Bots on a bots-only server
  never reach `Lb_RunForward` in the state the server would send; a client
  recording of a lab round shows bots in it 18% of the time. Either the client
  computes locomotion from motion, or the server simulates a bot far from any
  human in less detail (its AI LOD, which also makes its fire fake, AI-134).
  *Settled by the parity round below: the server simulates the bot in less
  detail (AI-136). The client derives none of it.*

### The options, ranked by what they can hold

| | Coverage | Rate | Precision | Server truth (projectiles, hits) | Client-derived cosmetics |
|---|---|---|---|---|---|
| Inputs + re-simulation | everything | any | exact | yes | yes |
| **Omniscient state capture in the server** | every object | every 30 Hz tick | unquantized | yes | held by the server too (the parity round) |
| Spectator client, relevance lifted | every object, if the budget allows | 0.1 s ghosts (P-2) | wire-quantized | no (its own re-simulation) | yes |
| Tap or phantom connection on the send path | what the connection is sent | 0.1 s | wire-quantized | no | no |

The first is impossible (AI-135). The spectator client's ceiling is the
wire's: one 1,024-byte send stream per connection (J-1) carrying the whole
map, so the priority scheduler starves the far objects. It also needs a
client process and a player slot per server, and whether a spectator raises
nearby bots' AI LOD, and so changes the round it records, is unread. The tap
records less than the rings it serializes.

### Recommended: the omniscient state capture

A recorder in the server that does, every tick and for every object, what
`updateStateMask` does for one connection's relevant set, and keeps what no
client is sent:

1. **Clock.** On the game thread, after each `simulateFrame` (GameServer
   vslot 0x140, D-1), stamped with the tick number. Direct reads (the game
   thread owns the world), no `/proc/self/mem`, no torn transforms.
2. **The client-visible state, unquantized.** Per networkable class, the live
   fields its `updateStateMask` copies: soldiers per P-4, vehicles
   (`SimpleObjectNetworkable`), turrets (`RotationalBundleNetworkable`),
   wheels and suspension (`SpringNetworkable`), engines, control points,
   kits, projectiles. The 13 classes are the checklist.
3. **The server's truth.** Every projectile in flight (a root in the
   registered map, vptr `0x0873f2c8`; the projectile map holds only mines),
   from its creation to its impact, which no client has: a client flies its
   own copy,
   every damage application with attacker, weapon and amount, every shot real
   and fake, each bot's AI LOD (so the viewer knows when the server itself
   simplified a bot), the seats (`getVehicle` `+0x4c`, `+0x54`), and each
   player's consumed `PlayerAction` (D-3), the input every client cosmetic is
   derived from.
4. **The events,** as now, plus the join database synthesised at file start.
5. **Binary records** into a buffer on the game thread, compressed and
   written by a writer thread; a converter to ndjson for the viewer.

The parity round below found nothing a client draws that the server does
not hold: locomotion states are the server's, for any bot a human is near.

### Experiments, in order

1. **The parity oracle.** One lab round with a human client recording beside
   the server recorder. Every record in the client's file, for objects in its
   relevance set, must be reproducible from the server's. It settles P-4's
   open question and is the acceptance test for the capture.
2. **Server projectiles.** Walk the projectile map per tick; check real
   rounds' flights against the event log's kills.
3. **AI LOD.** Record it per bot; a lab round with the LOD manager disabled
   (`AILODManager::lodEnable` `0x08476290`) shows what full detail looks like
   on a bots-only server.

### The parity round (2026-10-04)

`~/bf1942-lab/runs/20261004-083100-parity-elalamein-rec`: El Alamein co-op,
30 bots, the owner's client recording 78 s
(`client/replay_20261004-085232.ndjson`) beside a probe build of this
recorder (`server/replay_1791066665.ndjson`; the probe build was
`probes/parity-probe.patch`, in git at `cb3a15ce`, superseded by the new
recorder; scenario `lab/scenarios/parity-elalamein-rec.json`).
He rode a PanzerIV (net id 558) as gunner behind a bot driver, then drove it
with a bot gunner. Server time = client time + 1069.8 s, from his 30 shots
and two vehicle entries; six moving objects' tracks agree at 1069.75, to 5 to
15 cm at the median.

| | server against client | |
|---|---|---|
| Seats | the same transitions at the same times: pid 253 driving 558 (seat 0), out at 1113.3 when the owner took the wheel, back as gunner (seat 1) at 1122.4; pid 251 out of the gunner seat at 1101.8 | `getVehicle` `+0x4c`, its root, `+0x54` |
| Aim | live `BFSoldier+0x284` is the client's aim pitch (r 0.99, often the same value), `+0x288` the torso twist (r 0.91) | P-4 |
| Body states | lower and upper agree in 95% of 2,748 samples; the rest are transition timing (`Lb_Lie` against `Lb_LieForward`) | |
| Locomotion | bots at AI LOD 0 are in a moving state 54% of 804 on-foot samples, at LOD 2 never (0 of 87,868) | AI-136 |
| Replication rings | now moving (index not 0) in 2,602 of 2,748 samples of soldiers the client was sent; the ring's lower state is the client's | P-3 |
| Projectiles | every `PanzerIVGunBarrel` shot of his is a `PanzerIVProjectile` flying on the server, sampled along its path; MG42 bullets mostly outlive no 10 Hz sample | a Projectile (vptr `0x0873f2c8`) is a root in the registered map, ~150-170 pooled ones disabled. `ObjectManager::getProjectileMap` (`om+0x128`) is not a general registry: `Projectile::activate` adds a projectile only when its template's byte `+0x1d0` is set (the mine warning) |
| Turrets | the client's view lags the server's by 0.1 s: shifted by that, 1.5 degrees at the median (7 at p90); 0.75 while he gunned | |
| Vehicle slide | tracked hulls over 4 m/s more than 10 degrees off their heading: 24% under a LOD 2 bot (61,329 samples), 0% under a LOD 0 one (85, thin) | AI-136 |

What it settles:

- **The server holds everything the client drew,** at the client's values,
  and is ahead of it by the ghost delay. The omniscient capture loses nothing
  a client has.
- **The bots-only lab is the wrong yardstick.** A bot no human is near runs
  at AI LOD 2: no locomotion states, fake fire, and (by `updateBot`, which
  turns physics on at LOD 0) no physics, so its hull slides. That is what the
  server did, and what any client far from it would be shown. The "tanks
  slide, nobody has a pose" replays were bots-only rounds. Recording each
  bot's LOD lets the viewer mark those stretches instead of mistaking them for
  capture faults.
- **10 Hz misses bullets.** Most rounds live less than a sample; the capture
  needs projectile creation and destruction, not only a per-sample walk.

Two recorder defects the round found, both fixed in `src/`:

- The roster skipped player id 0 as invalid: the first human to join is
  pid 0, so the owner had no roster rows. A failed read is now an empty name.
- The sampler stopped writing at 1172 s, about 35 s after the client left,
  while the server ran on. `tree_successor`'s descent and climb were
  unbounded, and a node the game thread frees mid-walk can make them cycle;
  both are bounded at 64 now. Likely, not proven (no stack was taken).

