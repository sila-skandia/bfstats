# BattleView install page

`/battleview` tells players how to install the BF42++ client recorder and
server admins how to install the server recorder, and where the recordings go
(replay.bfstats.io). Built 2026-11-01. The page is
`ui/src/views/v4/BattleViewV4.vue`.

## What it links to

- BF42++ release `v2.0-round-replay` (sila-skandia/bf42plus): `dsound.dll`
  goes next to `BF1942.exe`; `plus.recordReplays 1` in the console turns it on
  and is saved to `bf42++.ini`.
- Server recorder release `recorder-v0.2.1` (this repo, `SERVER_VERSION`),
  under a Linux / Windows toggle (2026-11-03). Linux: `recorder.so` loaded with
  `LD_PRELOAD`, and `recorder.con` in the server root. Windows (experimental):
  `WINMM.dll` and `recorder.con` next to `BF1942_w32ded.exe`, checked through
  `recorder.log`. The full guide is
  [server-replay-recorder/INSTALL.md](../server-replay-recorder/INSTALL.md);
  the page links to it on GitHub (the Windows tab to its `#windows-server`
  section) rather than repeating the systemd and BFSMD setups.
- The hero is the cover of recording `ymdy248edr` (Operation Battleaxe on
  MoonGamers.com, a Spitfire chasing a 109), copied into
  `ui/src/assets/battleview/battleaxe-dogfight.jpg`; it links to
  `replay.bfstats.io/ymdy248edr`. Swap both together for a new grab.

When a release moves, change the constants at the top of the page; every
`recorder-v*` release moves `SERVER_VERSION`
([server-replay-recorder/README.md](../server-replay-recorder/README.md#releasing)).

## Watch now, latest round and Shorts (2026-11-04)

The owner asked for the page to show recent rounds and Shorts in place of the
single replay link, with a prominent Watch now up front. A list of recordings
was tried and dropped the same day: the page exists to get people installing,
and a long list pushed the instructions out of sight.

- **The strip** under the lede, above the hero: Watch now (olive) opens the
  replays home (`feedHref({})`); beside it the newest shared round
  (`/stats/recordings?pageSize=1`) links straight to its replay, with its level
  and age; Install BattleView (outlined) scrolls down to the two recorders'
  steps (`#bv-install`). With nothing shared the round's slot says the replay
  plays in the browser.
- **Shorts**: `MmShortsStrip.vue`, the six newest of the last 30 days from
  `/stats/shorts` (`shortsService.ts`), 9:16 posters that play muted on hover
  and open `play.bfstats.io/play/?tab=replay&short=<slug>`. One row of six from
  981px, a swipeable row below. Loads near the viewport; stays out while empty.

E2E: `ui/e2e/battleview-replays.spec.ts`.

## The header link

`ModernShell.vue` renders "Try BattleView" twice. From 1200px it is a pill in
the top bar (with "1942 3D recorder" beside it from 1340px). Narrower, the top
bar has no room (the nav squeezes until the Trivia icon collapses), so the
link sits in the breadcrumb strip instead of the UTC clock.

## Search

- `/battleview` is in `ui/public/sitemap.xml`; robots.txt allows it.
- `index.html` shipped one canonical, the homepage, for every route. The
  router's meta handler now points `link[rel=canonical]` at
  `https://bfstats.io<path>` on each navigation, so this page (and every other)
  is no longer declared a duplicate of the homepage.
