# Download progress on the loading screen

The loading screen draws the game's own plate and bar. Since replays load
every vehicle's model, the soldiers' poses and their textures, the bar parks on
one number for seconds while hundreds of files keep arriving. Nothing on the
screen said it was still working.

## What changed (2026-11-03)

A line under PRESS ESCAPE TO CANCEL says what is downloading:

    388 / 449 FILES  ·  64.3 MB / 65.5 MB  ·  6.0 MB/S

and, once every file is in, what the load is still doing:

    992 FILES IN  ·  101.3 MB  ·  PREPARING THE LEVEL

It is not the game's (retail loaded from disk) and is drawn in the type of the
plate's prompt, so it reads as part of the screen. It shows only while the
loading picture is up, not on the briefing or after a failure.

## How it counts

`viewer/download-meter.js`, installed by `download-meter-install.js` right
after `asset-retry-install.js` (so a file retried three times is one file):

- `fetch`: a GET is one file from the call to the end of its body. Its size
  is `X-File-Size` (nginx sends it for a gzipped glb: the unzipped size) or,
  for a body that is not encoded, `Content-Length`. Bytes are counted as the
  stream delivers them, unzipped, which is what both headers measure. A 404,
  a POST and a server-sent event stream are not counted.
- three's `ImageLoader` (`<img>` textures): one file from the call to its
  load or error, its size from the resource timing entry.
- A file whose size is unknown counts what has arrived toward both sides.
- An answered body nobody reads stops counting after 20 s idle, so the line
  never waits on it.

`overlay.begin()` resets the count (files still downloading carry over, such
as the replay's recording) and polls it every 250 ms. The totals grow as the
page asks for more: the level first, then the replay's vehicles.

## Measured

Bocage replay `replays/replay_20260928-133433.ndjson`, local server, cache
off, throttled to 20 MB/s and 40 ms (`ldprobe.cjs` in the session scratch).
The bar sat at 83% from 6.7 s to 11.8 s and at 91% from 12.5 s to 16.7 s.
Over the same stretches the line counted from 8 to 992 files and from 20.8 to
101.3 MB.

## Tests

`tools/bf1942-models/tests/test_download_meter.py` (the meter against Node's
Response and streams, and the line's wording).
