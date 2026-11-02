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
