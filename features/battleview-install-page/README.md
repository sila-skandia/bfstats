# BattleView install page

`/battleview` tells players how to install the BF42++ client recorder and
server admins how to install the server recorder, and where the recordings go
(replay.bfstats.io). Built 2026-11-01. The page is
`ui/src/views/v4/BattleViewV4.vue`.

## What it links to

- BF42++ release `v2.0-round-replay` (sila-skandia/bf42plus, `CLIENT_TAG`):
  the download button is that release's `dsound.dll` itself, which goes next to
  `BF1942.exe`; `plus.recordReplays 1` in the console turns it on and is saved
  to `bf42++.ini`.
- Server recorder release `recorder-v0.3.0` (this repo, `SERVER_VERSION`),
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

## Which recorder (2026-11-05)

Players were downloading the server recorder. The card headed "For players"
did not say what it did, and the server card's Linux / Windows tabs read like
a choice of the player's own OS, so a Windows player took `WINMM.dll`.

- An "Install BattleView" eyebrow over the cards, with one line on which to
  pick: playing means BF42++; the server recorder is for dedicated servers.
- Player card: "Record your gameplay". Server card: "For server admins only",
  "Record your server", and a note that its files record nothing in a game
  folder, linking back to the player card.
- The tabs read "Linux server" / "Windows server".

## One file for players (2026-11-05)

The BF42++ release carried two installs of the same DLL: `dsound.dll`, which
the game loads from its own folder, and `bf42++.zip` (`bf42++.dll` plus the
`bf42++.exe` loader, which injects it). The page said to use `dsound.dll` but
linked to the release page, where the zip came first, and the zip was the more
downloaded of the two.

- The zip is off the release, and the bf42plus workflow
  (`.github/workflows/windows-build-msvc.yml`) now attaches `dsound.dll` alone,
  so a new release does not bring it back. The loader build is still in the
  Actions artifact.
- The button reads "Download dsound.dll" and downloads it directly.
- The install step covers an existing `dsound.dll` (an audio fix like DSOAL):
  rename it to `dsound_next.dll`, which BF42++ chains to (`src/dllmain.cpp`).
- "Why dsound.dll?" under the steps, at the owner's request: `dsound.dll` is
  DirectSound, which `BF1942.exe` loads at start and Windows finds in the game
  folder before the system one, so the game loads BF42++ and BF42++ hooks in.
  It forwards `DirectSoundCreate8` to `dsound_next.dll` or the system
  DirectSound (`src/dllmain.cpp`), which is why an existing one is renamed.
- A note under that: the x86 Visual C++ runtime for a `MSVCP140.dll` error,
  the `winecfg` override on Wine, and how to remove it.

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
