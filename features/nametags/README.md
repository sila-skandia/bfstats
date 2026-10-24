# 3D name tags

Status: built 2026-10-24. Offline bots and server rows (room and sidecar) get
tags; the medic/engineer call pulse, buddies and the hulls' `nameTagOffset`
are open (below). A retail server's distance caps are taken from its SetLevel
(2026-10-25, HUD-23).

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
| `viewer/nametag-layer.js` | Candidates (bots offline, `roomClient` rows on a server), the aim ray (`world.collider.cast` for the wall, the soldier capsules or the stand-in sphere, a hull's bounding sphere), projection and paint on `#nametag-canvas` (under the HUD). Off under the deploy screen and in a replay, which has its own tags. |
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

## Open

- **Medic and engineer calls.** The law's pulse is in `nameTagRgb`, but the
  page's radio does not record which player made the call, so nothing feeds it.
- **Buddies** (green): the page has no buddy list.
- **`nameTagOffset`** (49 vanilla vehicle and seat templates) is not
  exported, so a seated player's tag sits 1.5 m over his hull's origin, and
  several crew stack on one point. The per-seat anchor needs the exporter to
  carry the field and the seat node per occupant.
- **The server's caps** (`game.serverNameTagDistance` / `...Scope`): built
  2026-10-25 for a retail server. They ride the level's SetLevel event (ledger
  HUD-23), the sidecar's `setLevel` row carries them as `nameTagNear` and
  `nameTagScope`, and the layer caps 75 / 300 with them
  (`net-sidecar.js` `nameTagCaps`). On the lab a server set to 40 / 210 sent
  40 / 210, and the shipped lab settings send 100 / 300. The page's own room
  passes none yet.
- Engine reads still open are in HUD-16..HUD-22 (kit indices 3 and 4
  inferred, the meaning of the control object's hide bit).
