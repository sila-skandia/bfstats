# 3D name tags

Status: built 2026-10-24. Offline bots and server rows (room and relay) get
tags, and since 2026-11-01 a round replay's players in the followed man's
first person; buddies and the hulls' `nameTagOffset` are open (below). A retail
server's distance caps ride its SetLevel (`net-relay.js` `serverNameTags`).

The engine side is ledger HUD-16..HUD-22 (`### 3D name tags` in
`features/bf1942-engine-reference/ledger.md`) and section 10 of
`subsystems/ingame-hud.md`, read from BF1942.exe with lnxded's
`dice::bf::Nametags` as the named twin. Spot-checked in the exe: the format
strings `[%s]` (0x008d1a80) and `[%s] (%d%c)` (0x008d1a48), the side table
0x00957614 (0, 0xff2828, 0x1030ff), the 75.0 / 300.0 defaults written at
0x00456cc5 / 0x00456ccf, 2 pi at 0x008d1a68 and the 25 s call lifetime at
0x008d6478.

## What retail does, in short

- Teammates within 75 m get a tag whose alpha falls as `cos(d / 75 * pi/2)`,
  through walls (no line-of-sight test).
- Anyone under the crosshair, enemies included, out to 300 m: the aim ray
  lights the tag within about 0.1 s and it fades over 0.5 s after the aim
  leaves. Terrain, statics or a hull in front stop the ray.
- Colour is the target's own side (Axis red, Allies blue), not friend or foe.
- Text is `[Name]`; a medic on foot sees a teammate soldier's health
  `[Name] (85%)`, an engineer on foot a teammate vehicle's.
- A flag carrier's tag is always drawn and pulses pale yellow once a second.
- Fixed size, centred on a point 1.5 m up from the object's origin (2.5 m over
  a soldier's feet), in `Font/BF1942.font`.

## Built

| File | What |
|---|---|
| `viewer/nametags.js` | The law: distances, the aim timer and fade, alpha, colour and pulse, text. No DOM. |
| `viewer/nametag-layer.js` | Candidates (bots offline, `roomClient` rows on a server, a replay's `nametagFeed`), the aim ray (`world.collider.cast` for the wall, the soldier capsules or the stand-in sphere, a hull's bounding sphere), projection and paint on `#nametag-canvas` (under the HUD). Off under the deploy screen, and in a replay outside the followed man's first person, where the replay's own clickable tags are drawn. |
| `viewer/console-view.js` | `drawFontLine`, the console font's line drawer, shared. |
| `viewer/ctf-page.js` | `carriers()`, who holds a flag. |

`?shots` exposes `window.__nametags` (`last` is the frame's tags, `state(key)`
a player's aim timer and fade).

## Checked

- `tests/test_nametags.py`: distances and caps, the near and aim alphas, the
  aim lighting under 0.11 s and fading in 0.5 s, the text with both health
  suffixes, the colours and the pulse.
- Headless Wake with six frozen bots: a teammate 20 m off drew blue at alpha
  232; an enemy 14 m ahead drew only once the camera was turned onto him
  (red, alpha 254, fade 1); an enemy 60 m up a slope stayed untagged because
  the ray met the terrain at 5.8 m.

## In a replay (2026-11-01)

Entry 10 of `features/replay-feature-sweep-2026-11-01`. In the followed
player's first person (`replay.camera.sight` set) the layer draws the retail
tags from `replay.js` `nametagFeed()`:

- every other player the replay draws: on foot at his drawn soldier, origin a
  metre over the feet (HUD-22); in a seat at that seat's node in the hull's
  glb (`occupancy.survey.seats`), its own up axis, else the hull's root;
- each with his side at that instant (`teamAt`), so the colours are HUD-20's
  team colours, and the friend test is against the followed man's side;
- hit points as recorded, or his spawn's full health where the file has none
  yet, so a followed medic on foot reads `[Name] (100%)` (HUD-21; the kit
  index from the followed man's kit class);
- the caps from the recording's `setLevel` `nameTags` (`rec.nameTags`, which
  the relay's recorder writes), else the client's own 75 / 300 m (HUD-16).
  No recording in `viewer/replays` carries them yet;
- the aim ray is the page's own, from the replay camera, which is his view.

`replay.js` `tagTargets` returns nothing then, so the replay's DOM tags stand
down in first person and come back in the orbit, the free camera and the
outside views. No carriers and no medic or engineer calls in a replay yet.

Checked headless on `replays/20261004-175102-elalamein-coop-rec/replay_1791100268`
(screenshots `tags-foot-pov-231.png` and `tags-foot-orbit-231.png` in the
session's scratchpad): followed medic Keith Taunton (pid 231) at 60 s, his
teammate Charlie Pike 31 m ahead drawn `[Charlie Pike] (100%)` in
`0x1030ff` at alpha 204, no DOM tags; the orbit at the same instant, two DOM
tags and no retail ones. `game.useHud` hides `#nametag-canvas` as before.

## Open

- **Medic and engineer calls.** Built 2026-10-25 (ledger HUD-25): a
  teammate's "Medic!" (40) or "Need repairs!" (54) shout, heard by a local
  medic or engineer on foot, is kept for 25 s by `support-calls.js`; his tag
  pulses (`nameTagRgb` `call`) and his minimap arrow becomes `map_medic` or
  `map_engineer`. Raised for the players a room's or a server's radio rows
  name (`slot:<n>`); an offline bot's shout passes no key and raises none.
- **Buddies** (green): the page has no buddy list.
- **`nameTagOffset`** (49 vanilla vehicle and seat templates) is not
  exported, so a seated player's tag sits 1.5 m over his hull's origin, and
  several crew stack on one point. The per-seat anchor needs the exporter to
  carry the field and the seat node per occupant.
- **The server's caps** (`game.serverNameTagDistance` / `...Scope`): a
  retail server's ride the level's SetLevel event, the relay's `setLevel`
  row carries them as `nameTags`, and the layer caps 75 / 300 with them
  (`net-relay.js` `serverNameTags`). On the lab a server set to 40 / 210
  sent 40 / 210 (2026-10-25), and the shipped lab settings send 100 / 300.
  The page's own room passes none yet.
- Engine reads still open are in HUD-16..HUD-22 (kit indices 3 and 4
  inferred, the meaning of the control object's hide bit).
