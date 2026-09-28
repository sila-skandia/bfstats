# How BF1942 gets into the browser, and how a round is recorded

Two questions, answered from the code as it stood on 2026-09-29. The links at
the end go to the long versions.

## Part 1. Turning the game's files into web files

No model or level in the viewer is made or placed by hand. Python scripts in
[`tools/bf1942-models`](../../tools/bf1942-models) read the retail game's
`.rfa` archives and write files a browser can load:

| Game format | Web format |
|---|---|
| Meshes, skeletons, animations, placed objects | glTF binary, `.glb` |
| DDS and TGA textures | PNG, inside the `.glb` or beside it |
| WAV sounds and Bink music | MP3 |
| `.con` scripts, menu layouts, strings | JSON |

The viewer is three.js r169 and loads the models and levels with its stock
glTF loader.

### Archives

An `.rfa` is a flat archive of LZO-compressed segments.
[`bf42/rfa.py`](../../tools/bf1942-models/bf42/rfa.py) opens many archives as
one pool and matches names without regard to case, because
the game was authored on Windows and asks for `texture/Sherma_I` when the file
is `texture/sherma_i.dds`. A mod looks each name up in its own archives first
and then in its parent's, the way the game does, so Road to Rome falls back to
vanilla.

### Vehicles, weapons and buildings

A vehicle is spread over many files. The exporter follows the same chain of
lookups the engine does:

1. `Objects.con` builds the template tree. The hull adds the turret, the turret
   adds the gun, and a `setPosition` after an `addTemplate` places that child.
2. Each template names a geometry, and `Geometries.con` maps the geometry to a
   `.sm` mesh file. The `.sm` holds the triangles, up to six levels of detail
   and the collision meshes.
3. Each material in the `.sm` finds its texture through a `.rs` shader file.
   The exporter decodes the DDS or TGA and stores it as PNG.
4. Refractor's axes are left-handed with +Z forward, and glTF's are
   right-handed. The exporter negates Z, reverses the triangle winding and
   flips the sign of yaw and pitch, so the viewer needs no correction.

Each template becomes `<Name>.glb`, plus `<Name>.wreck.glb` for its wreck and
`<Name>.cockpit.glb` for the first-person interior where it has one. Each also
gets a `.report.json` listing every lookup that failed, because a missing
texture and a broken lookup look the same on screen. Vehicle and gun collision
meshes go into one `collision-meshes.json` for the physics.

### Soldiers, animations and kits

- A soldier is a skinned body, head and two hands. The meshes come from `.sm`
  files, the skin weights from `.skn` and the bones from `.ske`.
- Animations are the game's `.baf` clips, 1,154 of them in `animations.rfa`,
  split into upper and lower body. The exporter decodes them into glTF
  animations.
- A gun attaches by bone name. Every weapon skeleton is rooted at a bone
  called `Bip01 R Hand`, and the exporter grafts that root onto the soldier's
  hand, as the engine does. No config file holds a grip offset.
- A soldier holding each weapon in third person is
  `<Soldier>__<Weapon>.pose.glb`. First-person arms and gun are
  `<Soldier>__<Weapon>.fp.glb`, with idle, walk, run, fire and reload clips.
- Helmets and packs are `KitPart` templates, each tied to one of three bones:
  `A` under the head, `backpack` or `HipPack`. Each becomes `<Part>.kit.glb`,
  and a kit lying on the ground becomes `<Kit>__pickup.kit.glb`.
  [`extract_loadouts.py`](../../tools/bf1942-models/extract_loadouts.py) reads
  which soldier and kits each team gets from every level's `Init.con` and
  writes `loadouts.json`.

### Levels

[`extract_map.py`](../../tools/bf1942-models/extract_map.py) bakes one level
into a folder:

- `scene.glb` holds everything drawn. The terrain is the level's 16-bit
  heightmap, cut into 256 m tiles and painted with the level's own colour
  tiles. Every object placed by `StaticObjects.con` is in it, buildings,
  sandbags and trees included. Wake's is 48 MB.
- Beside it sit the game's own baked lightmaps for the placed objects, the six
  sky faces, the water's layers with its normal and depth maps, the minimap,
  and the bots' pathfinding maps, which stay in the game's own `.raw` format.
- `scene.json` holds everything the viewer reads rather than draws: control
  points, spawn points, tickets, game modes, fog and sun, damage tables, sound
  placements and AI settings. The exporter builds it in layers, so
  [`patch_scene.py`](../../tools/bf1942-models/patch_scene.py) can rewrite one
  layer without sending the 48 MB of geometry again.

### Sound, music, menus and fonts

- Sound effects are the `.wav` files in `sound.rfa`, converted to MP3 with
  ffmpeg and deduplicated into one shared folder. MP3 is the only format that
  loops cleanly in Chromium, because Chromium's decoder returns exactly the
  source's sample count. Vorbis leaves up to 12 ms of padding inside every
  loop, and Chromium builds without proprietary codecs cannot decode AAC. The
  `.ssc` sound scripts, which say what plays at which engine speed and
  distance, become JSON.
- Music is Bink video, and ffmpeg pulls the audio track out as MP3.
- Menu and HUD layouts are the game's binary `MemeFile` pages in `menu.rfa`,
  decoded to JSON. Each of the game's bitmap fonts, a `.dif` metrics file and
  a `.tga` atlas, becomes a JSON file and a PNG, and the viewer draws text
  glyph by glyph from them. Strings come from `lexiconAll.dat`.

The same scripts take `--mod EoD`, `--mod XPack1` and so on, and write to
`viewer/models/mods/<mod>` and `viewer/maps/mods/<mod>`.
[`scripts/publish-mesh-delta.py`](../../scripts/publish-mesh-delta.py) uploads
changed files to the production assets volume, which serves mesh.bfstats.io. On this PC the trees come to 5.7 GB of models and 19 GB of
maps, mods included.

## Part 2. How bf42plus records a round

The server sends events whenever something happens, not on a clock. Object
positions travel on a separate channel, every 0.1 s. The recorder captures them
as two feeds in one file. It logs every event as it arrives, and it separately
samples every object the client is currently receiving, 10 times a second.

### What the server sends

The client sends only its input, 30 times a second. The server runs the
simulation at the same 30 ticks a second and sends back two separate streams:

| | Events | Object state |
|---|---|---|
| Contents | Joins and leaves, team changes, spawns, kills with the weapon, vehicle entries and exits by seat, kit pickups, objects created at a position or destroyed, chat, radio, round start and end | Position and rotation, hit points, turret angles, engine revs, each soldier's stance, aim and held weapon, fire buttons, flag owners, ticket counts |
| When | The moment it happens, reliably and in order. The only timed event is a clock sync every 10 s | Every 0.1 s, only the fields that changed, ordered by priority within a bandwidth budget |
| Range | The whole map | Your own side's players, the flags and the tickets anywhere. Everything else only within the level's view distance plus 20 m of your viewpoint, which is 520 m on Wake, 420 m on Kursk and Bocage and 120 m on Berlin |

### What the recorder does

The recorder is our fork of bf42++,
[sila-skandia/bf42plus](https://github.com/sila-skandia/bf42plus), and the code
is in [`src/replay.cpp`](https://github.com/sila-skandia/bf42plus/blob/master/src/replay.cpp). The game loads it as `dsound.dll` from its own
folder, so it runs inside the player's game client, not on the server. It stays
off until `recordReplays` is set in `bf42++.ini` or `plus.recordReplays 1` is
typed in the console. It writes `replays/replay_<date>-<time>.ndjson` in the
game folder, one JSON record per line. It starts a new file on every server
join and flushes to disk every 2 s.

It writes two feeds into the same file:

1. Events. A hook on the game's incoming event queue writes every event as it
   arrives, before the game acts on it. Events with known layouts get names
   such as `createObject`, `score` and `enterVehicle`, and the rest go in as
   raw hex at their exact size. Two more hooks cover what the event stream
   misses. One writes every round the client fires. That includes other
   players' rounds, which the client simulates from the fire buttons the server
   replicates. The other writes each chat line as the chat box shows it,
   because the server never sends players their own chat.
2. The sampler. Once per rendered frame, throttled to 10 times a second, it
   walks the client's list of objects and writes what changed since it last
   wrote. That covers the position and rotation of every networked object that
   moved more than 1 cm or turned, hit points, turret angles, engine revs and
   gears, each soldier's animation state, aim and held item, who sits in which
   seat, flag owners and ticket counts.

So positions are a separate feed. No event from the server carries a position
except an object's creation, which gives its spawn point. The recorder decodes
nothing from the network packets either. It reads the game's own objects after
the client has applied the server's updates.

A 9-minute, 34-player Bocage round on a public server made a 9.9 MB file of
34,790 lines. Position samples were 57% of the bytes, and the 4,368 events were
4%. The map viewer plays a file back on the level extracted in Part 1.

### What one recording misses

- It has the whole map's events, so it knows every object, kill, vehicle entry
  and chat line. It has motion only where the server sends object state to
  that player. In the Bocage round that was 95% of the recording player's own
  side's time in the world and 78% of the other side's.
- Out of range, the replay holds an object at the last pose it saw.
- One recording from each side covers every player for the whole round. The
  network ids are the server's, so two files merge by id, which
  [round-replay-merge](../round-replay-merge/README.md) does.
- The sampler runs 10 times a second, but not in step with the server's 0.1 s
  updates. A sample can land between two updates, where the client moves
  remote objects on its own at zero input. Writing each object as its update
  is applied would be exact, and that is not built.
- The recording player's own soldier is the client's prediction, which the
  server corrects.
- For a server we run, the server's own event log adds kills and destroyed
  vehicles with their positions.

## Longer versions

- [round-replay-capture](../round-replay-capture/README.md) has the recorder
  research, the record format and the measurements behind Part 2.
- [netcode](../bf1942-engine-reference/subsystems/netcode.md) covers the wire
  format, the 30 Hz tick and the 0.1 s cadence.
- [level-bake-layers](../level-bake-layers/README.md) covers the level bake and
  its layers.
- The module docstrings in [`tools/bf1942-models/bf42/`](../../tools/bf1942-models/bf42)
  explain each file format.
